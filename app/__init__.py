import os

from dotenv import load_dotenv
from flask import Flask

from app.config import Config


def create_app(config_object=Config):
    load_dotenv()

    app = Flask(__name__, instance_relative_config=True)
    app.config.from_object(config_object)

    os.makedirs(app.instance_path, exist_ok=True)
    os.makedirs(os.path.join(app.instance_path, "runs"), exist_ok=True)

    from app.routes import main

    app.register_blueprint(main)

    return app
