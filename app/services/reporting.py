import json
import os
from pathlib import Path

from pydantic import BaseModel

from app.schemas import EvidencePage

REPORT_KIND_LABELS = {
    "snapshot": "Evidence snapshot",
    "baseline": "Security OFF report",
    "protected": "Security ON report",
    "comparison": "Comparison",
    "experiment": "Experiment",
}


def extraction_limitations(pages: list[EvidencePage]) -> list[str]:
    """Describe only limitations that were actually observed during capture."""
    limitations: list[str] = []
    for page in pages:
        label = page.title or page.final_url or page.url
        if not page.success:
            status = f"HTTP {page.http_status}" if page.http_status else "capture failed"
            detail = page.error or "No usable content was captured."
            attempts = f" ({page.attempts} attempts)" if page.attempts > 1 else ""
            limitations.append(f"{label}: {status}{attempts}. {detail}")
            continue
        if page.partial:
            limitations.append(
                f"{label}: partial capture. "
                f"{page.warning or 'Completeness of the rendered page was not verified.'}"
            )
        elif page.warning:
            limitations.append(f"{label}: {page.warning}")
        if page.retry_reason:
            limitations.append(f"{label}: capture recovered after a retry. {page.retry_reason}")
        if not (page.text or "").strip():
            limitations.append(f"{label}: no usable text was available in the saved evidence.")

    if any(not page.success for page in pages):
        limitations.append(
            "Model conditions were not run because one or more required sources failed extraction."
        )
    return list(dict.fromkeys(limitations))


def _report_kind(filename: str, data: dict) -> str:
    prefix = filename.split("-", 1)[0]
    if prefix == "evidence":
        return "snapshot"
    if prefix in REPORT_KIND_LABELS:
        return prefix
    condition = data.get("condition")
    if condition in REPORT_KIND_LABELS:
        return condition
    return "report"


def _report_status(kind: str, data: dict) -> str:
    if kind == "snapshot":
        return "complete" if data.get("extraction_success") else "incomplete"
    if kind in {"baseline", "protected"}:
        return "complete" if data.get("success") else "incomplete"
    if kind == "comparison":
        return str(data.get("outcome") or "complete")
    if kind == "experiment":
        return str(data.get("status") or "complete")
    return "saved"


def list_saved_reports(runs_dir: str | os.PathLike[str]) -> list[dict]:
    """List saved report files without trusting their contents as executable data."""
    directory = Path(runs_dir)
    if not directory.is_dir():
        return []

    reports = []
    for path in directory.glob("*.json"):
        if not path.is_file() or path.suffix != ".json":
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not isinstance(data, dict):
            continue

        kind = _report_kind(path.name, data)
        report_id = (
            data.get("run_id")
            or data.get("comparison_id")
            or data.get("experiment_id")
            or data.get("snapshot_id")
            or path.stem
        )
        reports.append(
            {
                "filename": path.name,
                "id": str(report_id),
                "kind": kind,
                "label": REPORT_KIND_LABELS.get(kind, kind.replace("_", " ").title()),
                "condition": data.get("condition"),
                "created_at": data.get("created_at"),
                "status": _report_status(kind, data),
                "snapshot_id": data.get("snapshot_id"),
                "model": data.get("model"),
                "extraction_success": data.get("extraction_success"),
            }
        )

    return sorted(
        reports,
        key=lambda item: (str(item.get("created_at") or ""), item["filename"]),
        reverse=True,
    )


def save_report(report: BaseModel, runs_dir: str | os.PathLike[str]) -> Path:
    """Write a JSON experiment report atomically and return its path."""
    directory = Path(runs_dir)
    directory.mkdir(parents=True, exist_ok=True)

    report_id = next(
        (
            getattr(report, attribute, None)
            for attribute in ("run_id", "comparison_id", "experiment_id", "snapshot_id")
            if getattr(report, attribute, None)
        ),
        None,
    )
    if not report_id:
        raise ValueError(
            "Report must define run_id, comparison_id, experiment_id, or snapshot_id."
        )
    path = directory / f"{report_id}.json"
    temporary_path = path.with_suffix(".json.tmp")
    temporary_path.write_text(report.model_dump_json(indent=2), encoding="utf-8")
    temporary_path.replace(path)
    return path
