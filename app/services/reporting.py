import os
from pathlib import Path

from pydantic import BaseModel


def save_report(report: BaseModel, runs_dir: str | os.PathLike[str]) -> Path:
    """Write a JSON experiment report atomically and return its path."""
    directory = Path(runs_dir)
    directory.mkdir(parents=True, exist_ok=True)

    report_id = getattr(report, "run_id", None) or getattr(report, "comparison_id", None)
    if not report_id:
        raise ValueError("Report must define run_id or comparison_id.")
    path = directory / f"{report_id}.json"
    temporary_path = path.with_suffix(".json.tmp")
    temporary_path.write_text(report.model_dump_json(indent=2), encoding="utf-8")
    temporary_path.replace(path)
    return path
