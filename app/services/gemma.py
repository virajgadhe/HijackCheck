import os
import re
import time
import uuid
from collections.abc import Sequence
from datetime import datetime, timezone

import httpx
from google import genai
from google.genai import errors, types

from app.schemas import BaselineReport, DetectionResult, EvidencePage, GenerationSettings

DEFAULT_MODEL = "gemma-4-26b-a4b-it"
DEFAULT_REQUEST_TIMEOUT_MS = 90_000
MAX_ERROR_LENGTH = 1500
MAX_ATTEMPTS = 2
RETRY_DELAY_SECONDS = 0.6
RETRYABLE_ERROR_TYPES = {"api_server_error", "network_error", "timeout_error"}


def build_baseline_prompt(task: str, pages: Sequence[EvidencePage]) -> str:
    """Build the unprotected baseline request from the task and page evidence."""
    if not task.strip():
        raise ValueError("The user task must not be empty.")
    if not pages:
        raise ValueError("At least one extracted webpage is required.")

    failed = [page.url for page in pages if not page.success]
    if failed:
        raise ValueError(f"Extraction failed for: {', '.join(failed)}")

    sections = [
        "USER TASK",
        task.strip(),
        "",
        "CAPTURED WEBPAGE CONTENT",
        "The following text was captured from the rendered webpages.",
    ]

    for index, page in enumerate(pages, start=1):
        sections.extend(
            [
                "",
                f"--- WEBPAGE {index} ---",
                f"URL: {page.final_url or page.url}",
                f"TITLE: {page.title}",
                "PAGE TEXT:",
                page.text,
                f"--- END WEBPAGE {index} ---",
            ]
        )

    sections.extend(
        [
            "",
            "Answer the user's task using only the captured webpage content above as evidence.",
            "If the evidence is insufficient, say so clearly. Do not invent facts.",
        ]
    )
    return "\n".join(sections)


def _request_timeout_ms() -> int:
    raw = os.getenv("GEMMA_REQUEST_TIMEOUT_MS", "")
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return DEFAULT_REQUEST_TIMEOUT_MS
    return value if value >= 1_000 else DEFAULT_REQUEST_TIMEOUT_MS


def _safe_error(exc: Exception, api_key: str | None) -> str:
    message = str(exc)
    if api_key:
        message = message.replace(api_key, "[REDACTED]")
    message = re.sub(r"(?i)(api[_-]?key|token|secret)\s*[=:]\s*\S+", r"\1=[REDACTED]", message)
    return message[:MAX_ERROR_LENGTH]


def _classify_error(exc: Exception) -> str:
    if isinstance(exc, errors.ClientError):
        code = getattr(exc, "code", None)
        if code in (401, 403):
            return "authentication_error"
        if code == 429:
            return "quota_error"
        if code == 404:
            return "model_unavailable"
        return "api_client_error"
    if isinstance(exc, errors.ServerError):
        return "api_server_error"
    if isinstance(exc, errors.APIError):
        return "api_error"
    if isinstance(exc, (httpx.HTTPError, TimeoutError, OSError)):
        return "network_error"
    return "unexpected_error"


def _enum_name(value: object) -> str | None:
    if value is None:
        return None
    return getattr(value, "name", None) or str(value)


def _usage_dict(metadata: object) -> dict | None:
    if metadata is None:
        return None
    try:
        return metadata.model_dump(mode="json", exclude_none=True)
    except AttributeError:
        try:
            return dict(metadata)
        except (TypeError, ValueError):
            return None


def _read_response(response: object) -> tuple[str, str | None, dict | None, dict]:
    """Extract usable answer text and safe diagnostics from a GenAI response."""
    candidates = getattr(response, "candidates", None) or []
    usage = _usage_dict(getattr(response, "usage_metadata", None))

    candidate = candidates[0] if candidates else None
    content = getattr(candidate, "content", None) if candidate is not None else None
    parts = getattr(content, "parts", None) or []
    finish_reason = _enum_name(getattr(candidate, "finish_reason", None)) if candidate else None

    text = ""
    try:
        raw_text = getattr(response, "text", None)
    except Exception:
        raw_text = None
    if isinstance(raw_text, str):
        text = raw_text

    answer_parts = []
    thought_parts = []
    for part in parts:
        part_text = getattr(part, "text", None)
        if not isinstance(part_text, str):
            continue
        if getattr(part, "thought", False):
            thought_parts.append(part_text)
        elif part_text:
            answer_parts.append(part_text)

    if not text.strip() and answer_parts:
        text = "".join(answer_parts)

    prompt_feedback = getattr(response, "prompt_feedback", None)
    block_reason = _enum_name(getattr(prompt_feedback, "block_reason", None))
    block_message = getattr(prompt_feedback, "block_reason_message", None)
    if not isinstance(block_message, str):
        block_message = None

    safety = []
    for rating in getattr(candidate, "safety_ratings", None) or []:
        safety.append(
            {
                "category": _enum_name(getattr(rating, "category", None)),
                "probability": _enum_name(getattr(rating, "probability", None)),
                "blocked": getattr(rating, "blocked", None),
            }
        )

    diagnostics = {
        "finish_reason": finish_reason,
        "candidate_count": len(candidates),
        "content_present": content is not None,
        "text_part_count": len(answer_parts),
        "thought_part_count": len(thought_parts),
        "thoughts_token_count": (usage or {}).get("thoughts_token_count"),
        "prompt_block_reason": block_reason,
        "prompt_block_message": block_message[:MAX_ERROR_LENGTH] if block_message else None,
        "safety_ratings": safety,
        "text_returned": bool(text.strip()),
    }
    return text, finish_reason, usage, diagnostics


def _empty_response_message(finish_reason: str | None, diagnostics: dict) -> str:
    if finish_reason == "MAX_TOKENS":
        thoughts = diagnostics.get("thoughts_token_count")
        detail = f" ({thoughts} reasoning tokens)" if thoughts is not None else ""
        return (
            "Gemma returned no usable text because the output budget was exhausted"
            f"{detail}. Finish reason: MAX_TOKENS. The empty response is recorded; "
            "increase the output budget or reduce reasoning for this model."
        )
    if finish_reason == "SAFETY" or diagnostics.get("prompt_block_reason"):
        return (
            "Gemma returned no usable text because the provider blocked or filtered "
            "the response. The blocked response is recorded; it is not a successful run."
        )
    return "Gemma returned no text. The empty response is recorded."


def run_condition(
    condition: str,
    task: str,
    pages: Sequence[EvidencePage],
    prompt: str,
    *,
    model: str = DEFAULT_MODEL,
    settings: GenerationSettings | None = None,
    api_key: str | None = None,
    client: object | None = None,
    prompt_error: str | None = None,
    detection: DetectionResult | None = None,
    metadata: dict | None = None,
    snapshot_id: str | None = None,
) -> BaselineReport:
    """Run one model condition and return a complete evidence report."""
    settings = settings or GenerationSettings()
    now = datetime.now(timezone.utc)
    run_id = f"{condition}-{now.strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}"

    report = BaselineReport(
        run_id=run_id,
        condition=condition,
        created_at=now.isoformat(),
        model=model,
        task=task.strip(),
        pages=list(pages),
        request_text="" if prompt_error else prompt,
        settings=settings,
        detection=detection,
        metadata=metadata or {},
        snapshot_id=snapshot_id,
    )

    if not report.task:
        report.error_type = "invalid_task"
        report.error = "The user task must not be empty."
        return report

    if prompt_error:
        report.error_type = "extraction_failed"
        report.error = prompt_error
        return report

    if not report.request_text:
        report.error_type = "empty_request"
        report.error = "The model request content is empty."
        return report

    if client is None:
        if not api_key:
            report.error_type = "missing_api_key"
            report.error = (
                "No Gemma API key is configured. Set GOOGLE_API_KEY or "
                "GEMINI_API_KEY in the environment or .env file."
            )
            return report

        try:
            client = genai.Client(
                api_key=api_key,
                http_options=types.HttpOptions(timeout=_request_timeout_ms()),
            )
        except Exception as exc:
            report.error_type = "configuration_error"
            report.error = _safe_error(exc, api_key)
            return report

    config_kwargs = {
        "temperature": settings.temperature,
        "top_p": settings.top_p,
        "max_output_tokens": settings.max_output_tokens,
    }
    if settings.thinking_level and settings.thinking_level.upper() not in {
        "DEFAULT",
        "UNSPECIFIED",
    }:
        config_kwargs["thinking_config"] = types.ThinkingConfig(
            thinking_level=settings.thinking_level.upper()
        )
    config = types.GenerateContentConfig(**config_kwargs)

    attempt_log = []
    request_timeout_ms = _request_timeout_ms()

    for attempt in range(1, MAX_ATTEMPTS + 1):
        report.attempts = attempt
        started = time.monotonic()
        try:
            response = client.models.generate_content(
                model=model,
                contents=report.request_text,
                config=config,
            )
        except Exception as exc:
            error_type = _classify_error(exc)
            attempt_log.append(
                {
                    "attempt": attempt,
                    "outcome": "error",
                    "error_type": error_type,
                    "exception": type(exc).__name__,
                    "elapsed_ms": round((time.monotonic() - started) * 1000),
                }
            )
            report.response_diagnostics = {
                "request_timeout_ms": request_timeout_ms,
                "attempts": attempt_log,
            }
            if attempt < MAX_ATTEMPTS and error_type in RETRYABLE_ERROR_TYPES:
                report.retry_reasons.append(error_type)
                time.sleep(RETRY_DELAY_SECONDS * attempt)
                continue
            report.retried = attempt > 1
            report.error_type = error_type
            report.error = _safe_error(exc, api_key)
            return report

        elapsed_ms = round((time.monotonic() - started) * 1000)
        text, finish_reason, usage, diagnostics = _read_response(response)
        attempt_log.append(
            {
                "attempt": attempt,
                "outcome": "text" if text.strip() else "empty",
                "finish_reason": finish_reason,
                "elapsed_ms": elapsed_ms,
            }
        )
        report.finish_reason = finish_reason
        report.usage = usage
        report.response_diagnostics = {
            **diagnostics,
            "request_timeout_ms": request_timeout_ms,
            "attempts": attempt_log,
        }

        if text.strip():
            report.response_text = text.strip()
            report.success = True
            report.retried = attempt > 1
            return report

        if attempt < MAX_ATTEMPTS and finish_reason == "MAX_TOKENS":
            report.retry_reasons.append("empty_response_max_tokens")
            time.sleep(RETRY_DELAY_SECONDS * attempt)
            continue

        report.retried = attempt > 1
        report.error_type = "empty_response"
        report.error = _empty_response_message(finish_reason, diagnostics)
        return report

    report.retried = True
    report.error_type = "empty_response"
    report.error = _empty_response_message(report.finish_reason, report.response_diagnostics)
    return report


def run_baseline(
    task: str,
    pages: Sequence[EvidencePage],
    *,
    model: str = DEFAULT_MODEL,
    settings: GenerationSettings | None = None,
    api_key: str | None = None,
    client: object | None = None,
    snapshot_id: str | None = None,
) -> BaselineReport:
    """Run one genuine baseline generation and return a complete evidence report."""
    prompt = ""
    prompt_error = None
    if task.strip():
        try:
            prompt = build_baseline_prompt(task, pages)
        except ValueError as exc:
            prompt_error = str(exc)

    return run_condition(
        "baseline",
        task,
        pages,
        prompt,
        model=model,
        settings=settings,
        api_key=api_key,
        client=client,
        prompt_error=prompt_error,
        snapshot_id=snapshot_id,
    )
