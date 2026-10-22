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
    max_output_tokens: int = 4096


class SuspiciousFinding(BaseModel):
    source_url: str
    excerpt: str
    reason: str
    matched_rules: list[str] = Field(default_factory=list)


class DetectionResult(BaseModel):
    detected: bool = False
    findings: list[SuspiciousFinding] = Field(default_factory=list)
    disclaimer: str = (
        "Heuristic detection only identifies instruction-like text. "
        "It does not determine whether an attack succeeded."
    )


class BudgetValidation(BaseModel):
    recommendation_identified: bool = False
    recommended_product: str | None = None
    price_identified: bool = False
    price_currency: str | None = None
    price_amount: str | None = None
    recommended_price_inr: int | None = None
    normalized_price_inr: int | None = None
    normalization_note: str | None = None
    budget_status: str = "unknown"
    budget_inr: int | None = None
    budget_satisfied: bool | None = None
    user_constraint_satisfied: bool | None = None
    conditional_over_budget_alternative: bool = False
    acknowledged_budget_violation: bool = False
    validation_uncertain: bool = True
    reason: str = "Validation could not be completed."
    price_source_url: str | None = None


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
    detection: DetectionResult | None = None
    validation: BudgetValidation | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ConditionResult(BaseModel):
    run_id: str
    condition: str
    success: bool
    response_text: str | None = None
    validation: BudgetValidation
    error_type: str | None = None
    error: str | None = None


class ProductFact(BaseModel):
    name: str
    source_url: str
    price_identified: bool = False
    price_original: str | None = None
    price_amount: str | None = None
    currency: str | None = None
    normalized_price_inr: int | None = None
    budget_status: str = "unknown"
    reason: str = "Price and currency could not be established from captured evidence."


class ComparisonReport(BaseModel):
    comparison_id: str
    created_at: str
    experiment_type: str = "paired_captured_evidence"
    baseline_run_id: str
    protected_run_id: str
    model: str
    task: str
    settings: GenerationSettings
    evidence_urls: list[str]
    evidence_sha256: str
    same_evidence: bool
    same_model: bool
    same_generation_settings: bool
    baseline: ConditionResult
    protected: ConditionResult
    detection: DetectionResult
    instruction_in_baseline_input: bool
    instruction_in_protected_input: bool
    protected_instruction_confined_to_untrusted_block: bool
    products: list[ProductFact] = Field(default_factory=list)
    outcome: str
    improvement_observed: bool
    causation_established: bool = False
    uncertainty: list[str] = Field(default_factory=list)
    api_errors: list[str] = Field(default_factory=list)


class EvidenceSnapshot(BaseModel):
    snapshot_id: str
    created_at: str
    task: str
    pages: list[EvidencePage]
    evidence_sha256: str
    extraction_success: bool


class ExperimentReport(BaseModel):
    experiment_id: str
    created_at: str
    status: str
    task: str
    model: str
    settings: GenerationSettings
    snapshot_id: str
    evidence_sha256: str
    pages: list[EvidencePage]
    extraction_success: bool
    baseline: BaselineReport | None = None
    protected: BaselineReport | None = None
    comparison: ComparisonReport | None = None
    error: str | None = None
    report_files: dict[str, str] = Field(default_factory=dict)
