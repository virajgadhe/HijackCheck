from pydantic import BaseModel

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

from app.security.url_policy import URLPolicyError, validate_url

DEFAULT_TIMEOUT_MS = 15_000


class ExtractionResult(BaseModel):
    original_url: str
    final_url: str = ""
    title: str = ""
    body_text: str = ""
    success: bool = False
    error: str | None = None


def extract_page(
    url: str,
    timeout_ms: int = DEFAULT_TIMEOUT_MS,
    *,
    allow_private: bool = False,
) -> ExtractionResult:
    """Render a URL in Chromium and capture the visible text of the page."""
    result = ExtractionResult(original_url=url)

    try:
        validate_url(url, allow_private=allow_private)

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                page = browser.new_page()
                page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
                result.final_url = page.url
                validate_url(result.final_url, allow_private=allow_private)
                result.title = page.title()
                result.body_text = page.inner_text("body")
                result.success = True
            finally:
                browser.close()
    except URLPolicyError as exc:
        result.error = f"URL policy violation: {exc}"
    except PlaywrightTimeoutError as exc:
        result.error = f"Timed out after {timeout_ms} ms: {exc}"
    except PlaywrightError as exc:
        result.error = f"Playwright error: {exc}"
    except Exception as exc:  # pragma: no cover - defensive boundary
        result.error = f"Unexpected extraction error: {exc}"

    return result
