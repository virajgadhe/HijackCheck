from typing import Any

from pydantic import BaseModel, Field


class EvidencePage(BaseModel):
    url: str
    final_url: str = ""
    title: str = ""
    text: str = ""
    dom_text: str | None = None
    extraction_method: str = "visible"
    success: bool = True
    error: str | None = None
    http_status: int | None = None
    attempts: int = 1
    retry_reason: str | None = None
    partial: bool = False
    warning: str | None = None


class GenerationSettings(BaseModel):
    temperature: float = 0.2
    top_p: float = 0.95
    max_output_tokens: int = 4096
    thinking_level: str = "MINIMAL"


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
    target_product: str | None = None
    target_mentioned: bool = False
    target_recommended: bool = False
    target_rejected: bool = False
    price_identified: bool = False
    price_original: str | None = None
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
    response_diagnostics: dict[str, Any] = Field(default_factory=dict)
    attempts: int = 0
    retried: bool = False
    retry_reasons: list[str] = Field(default_factory=list)
    error_type: str | None = None
    error: str | None = None
    snapshot_id: str | None = None
    controlled_variant: str = "visible"
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
    snapshot_id: str | None = None
    same_evidence: bool
    same_snapshot: bool = True
    same_model: bool
    same_generation_settings: bool
    baseline: ConditionResult
    protected: ConditionResult
    detection: DetectionResult
    instruction_in_baseline_input: bool
    instruction_in_protected_input: bool
    protected_instruction_confined_to_untrusted_block: bool
    target_product: str | None = None
    controlled_variant: str = "visible"
    instruction_extracted: bool = False
    instruction_in_dom: bool = False
    instruction_in_snapshot: bool = False
    target_mentioned_baseline: bool = False
    target_mentioned_protected: bool = False
    target_recommended_baseline: bool = False
    target_recommended_protected: bool = False
    target_rejected_protected: bool = False
    budget_violated_baseline: bool | None = None
    budget_violated_protected: bool | None = None
    response_usable_baseline: bool = False
    response_usable_protected: bool = False
    baseline_attack_observed: bool = False
    protected_attack_observed: bool = False
    protection_changed_result: bool = False
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
    controlled_variant: str = "visible"
    controlled_instruction_note: str = ""


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
