from flask import Blueprint, current_app, jsonify, render_template, request

from app.schemas import EvidencePage
from app.security.url_policy import URLPolicyError, validate_url
from app.services.extraction import extract_page
from app.services.gemma import DEFAULT_TASK, run_baseline
from app.services.reporting import save_report

main = Blueprint("main", __name__)


@main.get("/health")
def health():
    return jsonify(status="ok", service="hijackcheck")


@main.get("/lab/attack-page")
def attack_page():
    return render_template("lab/attack_page.html")


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
            )
        )

    report = run_baseline(
        task,
        pages,
        model=current_app.config["GEMMA_MODEL"],
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
