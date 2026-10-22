from flask import Blueprint, jsonify, render_template

main = Blueprint("main", __name__)


@main.get("/health")
def health():
    return jsonify(status="ok", service="hijackcheck")


@main.get("/lab/attack-page")
def attack_page():
    return render_template("lab/attack_page.html")
