import re
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

from app.schemas import (
    BaselineReport,
    BudgetValidation,
    ComparisonReport,
    EvidencePage,
    EvidenceSnapshot,
    ExperimentReport,
    GenerationSettings,
)
from app.security.url_policy import URLPolicyError, validate_url
from app.services.evaluation import compare_conditions, evidence_sha256
from app.services.extraction import extract_page
from app.services.gemma import run_baseline
from app.services.protection import (
    assess_controlled_instruction_relevance,
    extract_budget_inr,
    run_protected,
    validate_recommendation,
)
from app.services.reporting import save_report

SNAPSHOT_ID_PATTERN = re.compile(r"^evidence-[A-Za-z0-9_-]+$")


class ExperimentValidationError(ValueError):
    """Raised when the experiment request is not valid."""


class SnapshotNotFoundError(LookupError):
    """Raised when a requested evidence snapshot does not exist."""


class SnapshotNotUsableError(ValueError):
    """Raised when model runs are requested for incomplete evidence."""


class MissingConditionRunError(LookupError):
    """Raised when a paired comparison lacks one of its saved conditions."""

    def __init__(self, condition: str):
        self.condition = condition
        super().__init__(
            f"No saved {condition} run was found for this evidence snapshot."
        )


class IncompatibleRunsError(ValueError):
    """Raised when saved runs cannot be compared fairly."""


@dataclass
class ExperimentOutcome:
    report: ExperimentReport
    status_code: int
    experiment_path: Path


@dataclass
class CaptureOutcome:
    snapshot: EvidenceSnapshot
    status_code: int
    snapshot_path: Path


@dataclass
class ConditionOutcome:
    report: BaselineReport
    status_code: int
    report_path: Path


@dataclass
class ComparisonOutcome:
    comparison: ComparisonReport
    status_code: int
    comparison_path: Path
    baseline_report: BaselineReport
    protected_report: BaselineReport
    baseline_path: Path
    protected_path: Path


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


def _condition_error(report: BaselineReport) -> str:
    return f"{report.condition} {report.error_type or 'error'}: {report.error or 'unknown error'}"


def _condition_status(report: BaselineReport) -> int:
    if report.success:
        return 200
    if report.error_type in {"missing_api_key", "configuration_error"}:
        return 503
    return 502


def _attach_validation(report: BaselineReport) -> None:
    if report.validation is not None:
        return
    if report.response_text:
        report.validation = validate_recommendation(
            report.response_text, report.pages, report.task
        )
        return

    budget = extract_budget_inr(report.task)
    report.validation = BudgetValidation(
        validation_uncertain=True,
        budget_inr=budget,
        budget_status="not_applicable" if budget is None else "unknown",
        reason="No model response was available for validation.",
    )


def _extract_pages(
    urls: Sequence[str],
    *,
    controlled_url: str,
    extraction_timeout_ms: int,
    extractor: Callable,
) -> list[EvidencePage]:
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
    return pages


def capture_evidence(
    task: str,
    urls: Sequence[str],
    *,
    controlled_url: str,
    runs_dir: str | Path,
    extraction_timeout_ms: int,
    extractor: Callable = extract_page,
) -> CaptureOutcome:
    """Capture and save evidence without invoking a model."""
    if not isinstance(task, str) or not task.strip():
        raise ExperimentValidationError("'task' must be a non-empty string.")

    _validate_experiment_urls(urls, controlled_url)
    urls = [url.strip() for url in urls]

    now = datetime.now(timezone.utc)
    pages = _extract_pages(
        urls,
        controlled_url=controlled_url,
        extraction_timeout_ms=extraction_timeout_ms,
        extractor=extractor,
    )
    extraction_success = all(page.success for page in pages)
    snapshot = EvidenceSnapshot(
        snapshot_id=f"evidence-{now.strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}",
        created_at=now.isoformat(),
        task=task.strip(),
        pages=pages,
        evidence_sha256=evidence_sha256(pages),
        extraction_success=extraction_success,
        controlled_instruction_note=assess_controlled_instruction_relevance(task),
    )
    snapshot_path = save_report(snapshot, runs_dir)
    return CaptureOutcome(
        snapshot=snapshot,
        status_code=200 if extraction_success else 502,
        snapshot_path=snapshot_path,
    )


def load_snapshot(snapshot_id: str, runs_dir: str | Path) -> EvidenceSnapshot:
    """Load a saved snapshot by its safe identifier."""
    if (
        not isinstance(snapshot_id, str)
        or not SNAPSHOT_ID_PATTERN.fullmatch(snapshot_id)
        or Path(snapshot_id).name != snapshot_id
    ):
        raise SnapshotNotFoundError("The evidence snapshot was not found.")

    path = Path(runs_dir) / f"{snapshot_id}.json"
    if not path.is_file():
        raise SnapshotNotFoundError("The evidence snapshot was not found.")

    try:
        snapshot = EvidenceSnapshot.model_validate_json(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise SnapshotNotFoundError("The evidence snapshot could not be read.") from exc

    if snapshot.snapshot_id != snapshot_id:
        raise SnapshotNotFoundError("The evidence snapshot was not found.")
    return snapshot


def run_saved_condition(
    snapshot_id: str,
    condition: str,
    *,
    model: str,
    settings: GenerationSettings | None = None,
    api_key: str | None = None,
    runs_dir: str | Path,
    baseline_runner: Callable = run_baseline,
    protected_runner: Callable = run_protected,
) -> ConditionOutcome:
    """Run exactly one model condition against an existing evidence snapshot."""
    if condition not in {"baseline", "protected"}:
        raise ExperimentValidationError("Condition must be 'baseline' or 'protected'.")

    settings = settings or GenerationSettings()
    snapshot = load_snapshot(snapshot_id, runs_dir)
    if not snapshot.extraction_success:
        raise SnapshotNotUsableError(
            "Model runs require a complete evidence snapshot with all three sources extracted."
        )

    if condition == "baseline":
        report = baseline_runner(
            snapshot.task,
            snapshot.pages,
            model=model,
            settings=settings,
            api_key=api_key,
        )
    else:
        report = protected_runner(
            snapshot.task,
            snapshot.pages,
            model=model,
            settings=settings,
            api_key=api_key,
        )

    report.snapshot_id = snapshot.snapshot_id
    _attach_validation(report)
    report_path = save_report(report, runs_dir)
    return ConditionOutcome(
        report=report,
        status_code=_condition_status(report),
        report_path=report_path,
    )


def _saved_condition_runs(
    condition: str,
    snapshot_id: str,
    runs_dir: str | Path,
) -> list[tuple[BaselineReport, Path]]:
    runs = []
    for path in Path(runs_dir).glob(f"{condition}-*.json"):
        try:
            report = BaselineReport.model_validate_json(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if report.condition == condition and report.snapshot_id == snapshot_id:
            runs.append((report, path))
    return sorted(runs, key=lambda item: item[0].created_at, reverse=True)


def compare_saved_snapshot(
    snapshot_id: str,
    *,
    runs_dir: str | Path,
) -> ComparisonOutcome:
    """Compare the latest compatible saved baseline and protected runs."""
    load_snapshot(snapshot_id, runs_dir)
    baseline_runs = _saved_condition_runs("baseline", snapshot_id, runs_dir)
    protected_runs = _saved_condition_runs("protected", snapshot_id, runs_dir)

    if not baseline_runs:
        raise MissingConditionRunError("baseline")
    if not protected_runs:
        raise MissingConditionRunError("protected")

    pair = None
    for baseline, baseline_path in baseline_runs:
        for protected, protected_path in protected_runs:
            if (
                baseline.model == protected.model
                and baseline.settings == protected.settings
            ):
                pair = (baseline, baseline_path, protected, protected_path)
                break
        if pair is not None:
            break

    if pair is None:
        raise IncompatibleRunsError(
            "No baseline and protected runs for this snapshot share the same model "
            "and generation settings."
        )

    baseline, baseline_path, protected, protected_path = pair
    comparison = compare_conditions(baseline, protected)
    comparison_path = save_report(comparison, runs_dir)
    return ComparisonOutcome(
        comparison=comparison,
        status_code=200,
        comparison_path=comparison_path,
        baseline_report=baseline,
        protected_report=protected,
        baseline_path=baseline_path,
        protected_path=protected_path,
    )


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
    """Run the legacy one-shot workflow; the dashboard uses separate mode endpoints."""
    if not isinstance(task, str) or not task.strip():
        raise ExperimentValidationError("'task' must be a non-empty string.")

    _validate_experiment_urls(urls, controlled_url)
    urls = [url.strip() for url in urls]
    settings = settings or GenerationSettings()

    now = datetime.now(timezone.utc)
    experiment_id = f"experiment-{now.strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}"

    pages = _extract_pages(
        urls,
        controlled_url=controlled_url,
        extraction_timeout_ms=extraction_timeout_ms,
        extractor=extractor,
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
        controlled_instruction_note=assess_controlled_instruction_relevance(task),
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
    baseline.snapshot_id = snapshot.snapshot_id
    _attach_validation(baseline)
    baseline_path = save_report(baseline, runs_dir)
    report_files["baseline"] = baseline_path.name

    protected = protected_runner(
        task.strip(),
        pages,
        model=model,
        settings=settings,
        api_key=api_key,
    )
    protected.snapshot_id = snapshot.snapshot_id
    _attach_validation(protected)
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
