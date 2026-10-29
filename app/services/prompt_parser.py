"""Parse a single research prompt into the existing task-and-URLs request shape."""

import re
from collections.abc import Callable
from dataclasses import dataclass

from app.security.url_policy import URLPolicyError, canonical_url, validate_url
from app.services.fixture import variant_from_url

URL_PATTERN = re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE)
SCHEME_PATTERN = re.compile(r"(?<![A-Za-z0-9+.-])([A-Za-z][A-Za-z0-9+.-]*)://")
TRAILING_URL_PUNCTUATION = ".,;:!?"
CLOSING_PAIRS = {")": "(", "]": "[", "}": "{"}


class ResearchPromptError(ValueError):
    """Raised when a combined research prompt cannot be used safely."""


@dataclass(frozen=True)
class ResearchRequest:
    prompt: str
    task: str
    urls: tuple[str, ...]
    external_urls: tuple[str, ...]
    controlled_url: str
    variant: str


def _trim_url(candidate: str) -> str:
    url = candidate.strip()
    while url and url[-1] in TRAILING_URL_PUNCTUATION:
        url = url[:-1]
    while url and url[-1] in CLOSING_PAIRS:
        closing = url[-1]
        opening = CLOSING_PAIRS[closing]
        if url.count(closing) > url.count(opening):
            url = url[:-1]
            continue
        break
    return url


def extract_urls(text: str) -> list[str]:
    """Return HTTP/HTTPS URLs found anywhere in natural-language text."""
    if not isinstance(text, str):
        return []
    urls = []
    for match in URL_PATTERN.finditer(text):
        url = _trim_url(match.group(0))
        if url:
            urls.append(url)
    return urls


def _task_from_prompt(prompt: str) -> str:
    without_urls = URL_PATTERN.sub(" ", prompt)
    lines: list[str] = []
    for raw_line in without_urls.splitlines():
        line = re.sub(r"[ \t]+", " ", raw_line).strip()
        if not line:
            if lines and lines[-1] != "":
                lines.append("")
            continue
        lines.append(line)

    while lines and not lines[0]:
        lines.pop(0)
    while lines and not lines[-1]:
        lines.pop()

    task = "\n".join(lines).strip()
    task = re.sub(r"[\s,;:]+$", "", task).strip()
    return task


def parse_research_prompt(
    prompt: str,
    *,
    controlled_url: str,
    url_validator: Callable[..., str] | None = None,
) -> ResearchRequest:
    """Validate one composer prompt and reorder its URLs for the capture pipeline."""
    validator = url_validator or validate_url
    if not isinstance(prompt, str) or not prompt.strip():
        raise ResearchPromptError(
            "Enter a research task and include the webpage URLs."
        )

    unsupported = sorted(
        {
            match.group(1).lower()
            for match in SCHEME_PATTERN.finditer(prompt)
            if match.group(1).lower() not in {"http", "https"}
        }
    )
    if unsupported:
        raise ResearchPromptError(
            "Only http and https source URLs are allowed."
        )

    urls = extract_urls(prompt)
    controlled_key = canonical_url(controlled_url)
    controlled = [url for url in urls if canonical_url(url) == controlled_key]
    external = [url for url in urls if canonical_url(url) != controlled_key]

    if len(urls) != 3:
        raise ResearchPromptError(
            "Please include exactly two external product URLs and one "
            f"HijackCheck attack-page URL (found {len(urls)})."
        )
    if len(controlled) != 1:
        raise ResearchPromptError(
            "Include exactly one controlled HijackCheck attack-page URL."
        )

    try:
        variant = variant_from_url(controlled[0])
    except ValueError as exc:
        raise ResearchPromptError(f"The controlled attack-page URL is invalid: {exc}") from exc

    for index, url in enumerate(external, start=1):
        try:
            validator(url, allow_private=False)
        except URLPolicyError as exc:
            raise ResearchPromptError(
                f"Source {index} could not be validated: {exc}"
            ) from exc

    try:
        validator(controlled[0], allow_private=True)
    except URLPolicyError as exc:
        raise ResearchPromptError(
            f"The controlled attack-page URL is invalid: {exc}"
        ) from exc

    task = _task_from_prompt(prompt)
    if not task:
        raise ResearchPromptError(
            "Please describe the research task before the source URLs."
        )

    return ResearchRequest(
        prompt=prompt.strip(),
        task=task,
        urls=tuple(external + controlled),
        external_urls=tuple(external),
        controlled_url=controlled[0],
        variant=variant,
    )
