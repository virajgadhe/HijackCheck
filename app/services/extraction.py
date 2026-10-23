import time

from pydantic import BaseModel
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

from app.security.url_policy import URLPolicyError, validate_url

DEFAULT_TIMEOUT_MS = 25_000
MIN_CONTENT_CHARS = 120
MAX_ATTEMPTS = 2
RETRY_DELAY_SECONDS = 0.4

ERROR_PAGE_MARKERS = (
    "access denied",
    "403 forbidden",
    "404 not found",
    "page not found",
    "request blocked",
    "unusual traffic",
    "captcha",
    "enable javascript and cookies",
)


class ExtractionResult(BaseModel):
    original_url: str
    final_url: str = ""
    title: str = ""
    body_text: str = ""
    dom_text: str | None = None
    extraction_method: str = "visible"
    success: bool = False
    error: str | None = None
    http_status: int | None = None
    attempts: int = 1
    retry_reason: str | None = None
    partial: bool = False
    warning: str | None = None


class _ContentError(Exception):
    """Raised when navigation succeeded but usable page text was not obtained."""

    def __init__(
        self,
        message: str,
        *,
        http_status: int | None = None,
        retryable: bool = True,
    ):
        super().__init__(message)
        self.http_status = http_status
        self.retryable = retryable


def _looks_like_error_page(title: str, text: str) -> bool:
    lowered = f"{title}\n{text}".lower()
    if len(text) > 2_000:
        return False
    return any(marker in lowered for marker in ERROR_PAGE_MARKERS)


def _error_preview(exc: Exception) -> str:
    message = " ".join(str(exc).split())
    return message[:600]


def _attempt_timeout(timeout_ms: int, attempt: int) -> int:
    if attempt == 1:
        return timeout_ms
    return min(timeout_ms * 2, 30_000)


DOM_TEXT_SCRIPT = """() => {
  const clone = document.body.cloneNode(true);
  clone.querySelectorAll("script, style, noscript, template").forEach((node) => node.remove());
  return clone.textContent || "";
}"""


def _capture_once(
    url: str,
    *,
    timeout_ms: int,
    allow_private: bool,
    attempt: int,
    include_hidden: bool = False,
) -> ExtractionResult:
    method = "dom" if include_hidden else "visible"
    result = ExtractionResult(
        original_url=url,
        attempts=attempt,
        extraction_method=method,
    )
    timed_out = False
    navigation_error = None

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            page = browser.new_page()
            navigation_response = None
            try:
                navigation_response = page.goto(
                    url, wait_until="domcontentloaded", timeout=timeout_ms
                )
            except PlaywrightTimeoutError as exc:
                timed_out = True
                navigation_error = _error_preview(exc)

            result.final_url = page.url or ""
            result.http_status = getattr(navigation_response, "status", None)
            if not result.final_url or result.final_url in {
                "about:blank",
                "chrome-error://chromewebdata/",
            }:
                raise _ContentError(
                    f"Timed out after {timeout_ms} ms and no navigable page URL was available."
                )
            validate_url(result.final_url, allow_private=allow_private)

            if result.http_status is not None and result.http_status >= 400:
                retryable = result.http_status >= 500 or result.http_status in {408, 425, 429}
                raise _ContentError(
                    f"Rendered page returned HTTP {result.http_status}; "
                    "the captured content is not treated as usable evidence.",
                    http_status=result.http_status,
                    retryable=retryable,
                )

            try:
                result.title = page.title()
            except PlaywrightError:
                result.title = ""

            try:
                if include_hidden:
                    text = page.evaluate(DOM_TEXT_SCRIPT)
                    result.dom_text = text
                else:
                    text = page.inner_text("body")
            except PlaywrightError as exc:
                text = ""
                navigation_error = navigation_error or _error_preview(exc)
            text = (text or "").strip()

            if len(text) < MIN_CONTENT_CHARS:
                if timed_out:
                    raise _ContentError(
                        f"Timed out after {timeout_ms} ms and no usable {method} text "
                        f"was rendered. {navigation_error or ''}".strip()
                    )
                raise _ContentError(f"Rendered page contained no usable {method} text.")

            if _looks_like_error_page(result.title, text):
                raise _ContentError(
                    "Rendered page appears to be an access-denied or error page; "
                    "the captured text is not treated as usable evidence.",
                    http_status=result.http_status,
                )

            result.body_text = text
            result.success = True
            if timed_out:
                result.partial = True
                result.warning = (
                    f"Navigation timed out after {timeout_ms} ms, but {method} text "
                    "that had already rendered was captured. Treat navigation "
                    "completeness as unverified."
                )
            return result
        finally:
            browser.close()


def extract_page(
    url: str,
    timeout_ms: int = DEFAULT_TIMEOUT_MS,
    *,
    allow_private: bool = False,
    include_hidden: bool = False,
) -> ExtractionResult:
    """Render a URL and capture visible text or the full DOM text with bounded retries."""
    method = "dom" if include_hidden else "visible"
    result = ExtractionResult(original_url=url, extraction_method=method)

    try:
        validate_url(url, allow_private=allow_private)
    except URLPolicyError as exc:
        result.error = f"URL policy violation: {exc}"
        return result

    last_reason = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        attempt_timeout = _attempt_timeout(timeout_ms, attempt)
        retryable = True
        try:
            captured = _capture_once(
                url,
                timeout_ms=attempt_timeout,
                allow_private=allow_private,
                attempt=attempt,
                include_hidden=include_hidden,
            )
            if last_reason:
                captured.retry_reason = last_reason
            return captured
        except URLPolicyError as exc:
            result.attempts = attempt
            result.error = f"URL policy violation: {exc}"
            return result
        except _ContentError as exc:
            last_reason = _error_preview(exc)
            result.attempts = attempt
            result.error = last_reason
            retryable = exc.retryable
            if exc.http_status is not None:
                result.http_status = exc.http_status
        except PlaywrightTimeoutError as exc:
            last_reason = f"Timed out after {attempt_timeout} ms: {_error_preview(exc)}"
            result.attempts = attempt
            result.error = last_reason
        except PlaywrightError as exc:
            last_reason = f"Playwright error: {_error_preview(exc)}"
            result.attempts = attempt
            result.error = last_reason
        except Exception as exc:  # pragma: no cover - defensive boundary
            last_reason = f"Unexpected extraction error: {_error_preview(exc)}"
            result.attempts = attempt
            result.error = last_reason

        if not retryable or attempt >= MAX_ATTEMPTS:
            break
        time.sleep(RETRY_DELAY_SECONDS)
        result.retry_reason = last_reason

    if result.attempts > 1:
        result.retry_reason = last_reason
    return result
