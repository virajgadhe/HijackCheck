import re
from flask import (
    Blueprint,
    current_app,
    jsonify,
    render_template,
    request,
    send_from_directory,
    url_for,
)

from app.schemas import EvidencePage, GenerationSettings
from app.security.url_policy import URLPolicyError, validate_url
from app.services.experiment import (
    ExperimentValidationError,
    IncompatibleRunsError,
    MissingConditionRunError,
    SnapshotNotFoundError,
    SnapshotNotUsableError,
    capture_evidence,
    compare_saved_snapshot,
    run_experiment,
    run_saved_condition,
)
from app.services.extraction import extract_page
from app.services.fixture import (
    ATTACK_MARKER,
    ATTACK_NOTE,
    DEFAULT_RESOURCE_URLS,
    DEFAULT_TASK,
)
from app.services.gemma import run_baseline
from app.services.reporting import save_report

main = Blueprint("main", __name__)

REPORT_FILENAME = re.compile(r"^[A-Za-z0-9._-]+\.json$")


def _controlled_url() -> str:
    return url_for("main.attack_page", _external=True)


@main.get("/")
def index():
    return render_template(
        "index.html",
        default_task=DEFAULT_TASK,
        resource_url_1=DEFAULT_RESOURCE_URLS[0],
        resource_url_2=DEFAULT_RESOURCE_URLS[1],
        attack_url=_controlled_url(),
        api_key_configured=bool(current_app.config["GOOGLE_API_KEY"]),
    )


@main.get("/health")
def health():
    return jsonify(status="ok", service="hijackcheck")


@main.get("/lab/attack-page")
def attack_page():
    return render_template(
        "lab/attack_page.html",
        attack_marker=ATTACK_MARKER,
        attack_note=ATTACK_NOTE,
    )


def _report_url(filename: str) -> str:
    return url_for("main.report_file", filename=filename)


def _snapshot_id(payload: dict) -> str:
    snapshot_id = payload.get("snapshot_id")
    if not isinstance(snapshot_id, str) or not snapshot_id.strip():
        raise ExperimentValidationError("'snapshot_id' must be a non-empty string.")
    return snapshot_id.strip()


@main.post("/api/capture")
def capture():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify(error="Request body must be a JSON object."), 400

    task = payload.get("task")
    urls = payload.get("urls")
    if not isinstance(urls, list):
        return jsonify(error="'urls' must contain exactly three URLs."), 400

    try:
        outcome = capture_evidence(
            task,
            urls,
            controlled_url=_controlled_url(),
            runs_dir=current_app.config["RUNS_DIR"],
            extraction_timeout_ms=int(current_app.config["EXTRACTION_TIMEOUT_MS"]),
        )
    except ExperimentValidationError as exc:
        return jsonify(error=str(exc)), 400

    return (
        jsonify(
            snapshot=outcome.snapshot.model_dump(mode="json"),
            report_urls={"snapshot": _report_url(outcome.snapshot_path.name)},
        ),
        outcome.status_code,
    )


def _generation_settings() -> GenerationSettings:
    return GenerationSettings(
        max_output_tokens=int(current_app.config["GEMMA_MAX_OUTPUT_TOKENS"]),
        thinking_level=current_app.config["GEMMA_THINKING_LEVEL"],
    )


def _run_mode(condition: str):
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify(error="Request body must be a JSON object."), 400

    try:
        snapshot_id = _snapshot_id(payload)
        outcome = run_saved_condition(
            snapshot_id,
            condition,
            model=current_app.config["GEMMA_MODEL"],
            settings=_generation_settings(),
            api_key=current_app.config["GOOGLE_API_KEY"],
            runs_dir=current_app.config["RUNS_DIR"],
        )
    except ExperimentValidationError as exc:
        return jsonify(error=str(exc)), 400
    except SnapshotNotFoundError as exc:
        return jsonify(error=str(exc)), 404
    except SnapshotNotUsableError as exc:
        return jsonify(error=str(exc)), 409

    return (
        jsonify(
            report=outcome.report.model_dump(mode="json"),
            report_urls={
                condition: _report_url(outcome.report_path.name),
                "snapshot": _report_url(f"{snapshot_id}.json"),
            },
        ),
        outcome.status_code,
    )


@main.post("/api/run/baseline")
def run_baseline_mode():
    return _run_mode("baseline")


@main.post("/api/run/protected")
def run_protected_mode():
    return _run_mode("protected")


@main.post("/api/compare")
def compare():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify(error="Request body must be a JSON object."), 400

    try:
        snapshot_id = _snapshot_id(payload)
        outcome = compare_saved_snapshot(
            snapshot_id,
            runs_dir=current_app.config["RUNS_DIR"],
        )
    except ExperimentValidationError as exc:
        return jsonify(error=str(exc)), 400
    except SnapshotNotFoundError as exc:
        return jsonify(error=str(exc)), 404
    except MissingConditionRunError as exc:
        return jsonify(error=str(exc), missing=exc.condition), 409
    except IncompatibleRunsError as exc:
        return jsonify(error=str(exc)), 409

    return (
        jsonify(
            comparison=outcome.comparison.model_dump(mode="json"),
            report_urls={
                "comparison": _report_url(outcome.comparison_path.name),
                "baseline": _report_url(outcome.baseline_path.name),
                "protected": _report_url(outcome.protected_path.name),
                "snapshot": _report_url(f"{snapshot_id}.json"),
            },
        ),
        outcome.status_code,
    )


@main.post("/api/experiment")
def experiment():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify(error="Request body must be a JSON object."), 400

    task = payload.get("task")
    urls = payload.get("urls")
    if not isinstance(urls, list):
        return jsonify(error="'urls' must contain exactly three URLs."), 400

    try:
        outcome = run_experiment(
            task,
            urls,
            controlled_url=_controlled_url(),
            model=current_app.config["GEMMA_MODEL"],
            settings=_generation_settings(),
            api_key=current_app.config["GOOGLE_API_KEY"],
            runs_dir=current_app.config["RUNS_DIR"],
            extraction_timeout_ms=int(current_app.config["EXTRACTION_TIMEOUT_MS"]),
        )
    except ExperimentValidationError as exc:
        return jsonify(error=str(exc)), 400

    report_urls = {
        key: url_for("main.report_file", filename=filename)
        for key, filename in outcome.report.report_files.items()
    }
    report_urls["experiment"] = url_for(
        "main.report_file", filename=outcome.experiment_path.name
    )

    return (
        jsonify(
            experiment=outcome.report.model_dump(mode="json"),
            report_urls=report_urls,
        ),
        outcome.status_code,
    )


@main.get("/api/reports/<filename>")
def report_file(filename: str):
    if not REPORT_FILENAME.fullmatch(filename):
        return jsonify(error="Report not found."), 404
    return send_from_directory(
        current_app.config["RUNS_DIR"], filename, mimetype="application/json"
    )


@main.post("/api/baseline")
def baseline():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify(error="Request body must be a JSON object."), 400

    task = payload.get("task", DEFAULT_TASK)
    if not isinstance(task, str) or not task.strip():
        return jsonify(error="'task' must be a non-empty string."), 400

    urls = payload.get("urls")
    if not isinstance(urls, list) or len(urls) != 3:
        return jsonify(error="'urls' must contain exactly three URLs."), 400
    if not all(isinstance(url, str) for url in urls):
        return jsonify(error="Every URL must be a string."), 400

    allow_private = bool(current_app.config["ALLOW_PRIVATE_URLS"])
    try:
        for url in urls:
            validate_url(url, allow_private=allow_private)
    except URLPolicyError as exc:
        return jsonify(error=str(exc)), 400

    timeout_ms = int(current_app.config["EXTRACTION_TIMEOUT_MS"])
    pages = []
    for url in urls:
        result = extract_page(url, timeout_ms=timeout_ms, allow_private=allow_private)
        pages.append(
            EvidencePage(
                url=result.original_url,
                final_url=result.final_url,
                title=result.title,
                text=result.body_text,
                success=result.success,
                error=result.error,
                attempts=result.attempts,
                retry_reason=result.retry_reason,
                partial=result.partial,
                warning=result.warning,
            )
        )

    report = run_baseline(
        task,
        pages,
        model=current_app.config["GEMMA_MODEL"],
        settings=_generation_settings(),
        api_key=current_app.config["GOOGLE_API_KEY"],
    )
    report_path = save_report(report, current_app.config["RUNS_DIR"])

    if report.success:
        status_code = 200
    elif report.error_type == "missing_api_key":
        status_code = 503
    else:
        status_code = 502

    return (
        jsonify(
            report=report.model_dump(mode="json"),
            report_path=str(report_path),
        ),
        status_code,
    )
