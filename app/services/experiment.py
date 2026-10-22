import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

from app.schemas import (
    EvidencePage,
    EvidenceSnapshot,
    ExperimentReport,
    GenerationSettings,
)
from app.security.url_policy import URLPolicyError, validate_url
from app.services.evaluation import compare_conditions, evidence_sha256
from app.services.extraction import extract_page
from app.services.gemma import run_baseline
from app.services.protection import run_protected
from app.services.reporting import save_report


class ExperimentValidationError(ValueError):
    """Raised when the experiment request is not valid."""


@dataclass
class ExperimentOutcome:
    report: ExperimentReport
    status_code: int
    experiment_path: Path


def canonical_url(url: str) -> str:
    try:
        parsed = urlsplit(url.strip())
    except ValueError:
        return url.strip().lower()
    path = parsed.path.rstrip("/") or "/"
    return f"{parsed.scheme.lower()}://{parsed.netloc.lower()}{path}"


def _validate_experiment_urls(urls: Sequence[str], controlled_url: str) -> None:
    if len(urls) != 3:
        raise ExperimentValidationError("'urls' must contain exactly three URLs.")
    if not all(isinstance(url, str) for url in urls):
        raise ExperimentValidationError("Every URL must be a string.")

    controlled = canonical_url(controlled_url)
    if canonical_url(urls[2]) != controlled:
        raise ExperimentValidationError(
            "Website 3 must be the controlled HijackCheck attack page."
        )

    for index, url in enumerate(urls, start=1):
        try:
            validate_url(url, allow_private=canonical_url(url) == controlled)
        except URLPolicyError as exc:
            raise ExperimentValidationError(f"Website {index}: {exc}") from exc


def _condition_error(report) -> str:
    return f"{report.condition} {report.error_type or 'error'}: {report.error or 'unknown error'}"


def run_experiment(
    task: str,
    urls: Sequence[str],
    *,
    controlled_url: str,
    model: str,
    settings: GenerationSettings | None = None,
    api_key: str | None = None,
    runs_dir: str | Path,
    extraction_timeout_ms: int,
    extractor: Callable = extract_page,
    baseline_runner: Callable = run_baseline,
    protected_runner: Callable = run_protected,
) -> ExperimentOutcome:
    """Extract once, run both conditions on that snapshot, and save all evidence."""
    if not isinstance(task, str) or not task.strip():
        raise ExperimentValidationError("'task' must be a non-empty string.")

    _validate_experiment_urls(urls, controlled_url)
    urls = [url.strip() for url in urls]
    settings = settings or GenerationSettings()

    now = datetime.now(timezone.utc)
    experiment_id = f"experiment-{now.strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}"
    controlled = canonical_url(controlled_url)

    pages = []
    for url in urls:
        result = extractor(
            url,
            timeout_ms=extraction_timeout_ms,
            allow_private=canonical_url(url) == controlled,
        )
        pages.append(
            EvidencePage(
                url=result.original_url,
                final_url=result.final_url,
                title=result.title,
                text=result.body_text,
                success=result.success,
                error=result.error,
            )
        )

    extraction_success = all(page.success for page in pages)
    digest = evidence_sha256(pages)
    snapshot = EvidenceSnapshot(
        snapshot_id=f"evidence-{now.strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}",
        created_at=now.isoformat(),
        task=task.strip(),
        pages=pages,
        evidence_sha256=digest,
        extraction_success=extraction_success,
    )
    snapshot_path = save_report(snapshot, runs_dir)

    report_files = {
        "snapshot": snapshot_path.name,
        "experiment": f"{experiment_id}.json",
    }

    if not extraction_success:
        failed = [page.url for page in pages if not page.success]
        report = ExperimentReport(
            experiment_id=experiment_id,
            created_at=now.isoformat(),
            status="incomplete",
            task=task.strip(),
            model=model,
            settings=settings,
            snapshot_id=snapshot.snapshot_id,
            evidence_sha256=digest,
            pages=pages,
            extraction_success=False,
            error=(
                "Extraction failed for one or more sources; model conditions were not run. "
                f"Failed: {', '.join(failed)}"
            ),
            report_files=report_files,
        )
        experiment_path = save_report(report, runs_dir)
        return ExperimentOutcome(report=report, status_code=502, experiment_path=experiment_path)

    baseline = baseline_runner(
        task.strip(),
        pages,
        model=model,
        settings=settings,
        api_key=api_key,
    )
    baseline_path = save_report(baseline, runs_dir)
    report_files["baseline"] = baseline_path.name

    protected = protected_runner(
        task.strip(),
        pages,
        model=model,
        settings=settings,
        api_key=api_key,
    )
    protected_path = save_report(protected, runs_dir)
    report_files["protected"] = protected_path.name

    comparison = compare_conditions(baseline, protected)
    comparison_path = save_report(comparison, runs_dir)
    report_files["comparison"] = comparison_path.name

    errors = []
    if not baseline.success:
        errors.append(_condition_error(baseline))
    if not protected.success:
        errors.append(_condition_error(protected))

    status = "complete" if not errors else "incomplete"
    status_code = 200
    if errors:
        if any(
            report.error_type == "missing_api_key" for report in (baseline, protected)
        ):
            status_code = 503
        else:
            status_code = 502

    report = ExperimentReport(
        experiment_id=experiment_id,
        created_at=now.isoformat(),
        status=status,
        task=task.strip(),
        model=model,
        settings=settings,
        snapshot_id=snapshot.snapshot_id,
        evidence_sha256=digest,
        pages=pages,
        extraction_success=True,
        baseline=baseline,
        protected=protected,
        comparison=comparison,
        error="; ".join(errors) or None,
        report_files=report_files,
    )
    experiment_path = save_report(report, runs_dir)
    return ExperimentOutcome(report=report, status_code=status_code, experiment_path=experiment_path)
