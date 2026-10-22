import os
from pathlib import Path

from pydantic import BaseModel


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
