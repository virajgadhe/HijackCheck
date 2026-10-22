import os

from dotenv import load_dotenv
from flask import Flask


def create_app(config_object=None):
    load_dotenv()

    if config_object is None:
        from app.config import Config

        config_object = Config

    app = Flask(__name__, instance_relative_config=True)
    app.config.from_object(config_object)

    os.makedirs(app.instance_path, exist_ok=True)
    runs_dir = app.config.get("RUNS_DIR") or os.path.join(app.instance_path, "runs")
    os.makedirs(runs_dir, exist_ok=True)
    app.config["RUNS_DIR"] = runs_dir

    from app.routes import main

    app.register_blueprint(main)

    return app
