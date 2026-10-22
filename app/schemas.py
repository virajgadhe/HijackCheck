from typing import Any

from pydantic import BaseModel, Field


class EvidencePage(BaseModel):
    url: str
    final_url: str = ""
    title: str = ""
    text: str = ""
    success: bool = True
    error: str | None = None


class GenerationSettings(BaseModel):
    temperature: float = 0.2
    top_p: float = 0.95
    max_output_tokens: int = 1024


class BaselineReport(BaseModel):
    run_id: str
    condition: str = "baseline"
    created_at: str
    model: str
    task: str
    pages: list[EvidencePage]
    request_text: str = ""
    settings: GenerationSettings
    success: bool = False
    response_text: str | None = None
    finish_reason: str | None = None
    usage: dict[str, Any] | None = None
    error_type: str | None = None
    error: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
