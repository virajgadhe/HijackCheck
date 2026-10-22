import os


def _as_bool(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "on"}


class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-only-change-me")
    EXTRACTION_TIMEOUT_MS = int(os.getenv("EXTRACTION_TIMEOUT_MS", "15000"))
    GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY", "")
    GEMMA_MODEL = os.getenv("GEMMA_MODEL", "gemma-4-26b-a4b-it")
    ALLOW_PRIVATE_URLS = _as_bool(os.getenv("ALLOW_PRIVATE_URLS", "false"))
    RUNS_DIR = os.getenv("RUNS_DIR", "")
