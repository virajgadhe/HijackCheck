import os
from pathlib import Path

from app.schemas import BaselineReport


def save_report(report: BaselineReport, runs_dir: str | os.PathLike[str]) -> Path:
    """Write a JSON experiment report atomically and return its path."""
    directory = Path(runs_dir)
    directory.mkdir(parents=True, exist_ok=True)

    path = directory / f"{report.run_id}.json"
    temporary_path = path.with_suffix(".json.tmp")
    temporary_path.write_text(report.model_dump_json(indent=2), encoding="utf-8")
    temporary_path.replace(path)
    return path
