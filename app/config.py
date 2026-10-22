import os


class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-only-change-me")
    EXTRACTION_TIMEOUT_MS = int(os.getenv("EXTRACTION_TIMEOUT_MS", "15000"))
    GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")
    GEMMA_MODEL = os.getenv("GEMMA_MODEL", "gemma-4")
