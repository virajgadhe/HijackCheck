(() => {
  "use strict";

  const captureForm = document.getElementById("capture-form");
  const captureButton = document.getElementById("capture-button");
  const attackUrl = document.getElementById("attack-url");
  const attackVariant = document.getElementById("attack-variant");
  const runResearchButton = document.getElementById("run-research-button");
  const compareButton = document.getElementById("compare-button");
  const modeInputs = Array.from(document.querySelectorAll('input[name="security_mode"]'));
  const runStatus = document.getElementById("run-status");
  const runStatusText = document.getElementById("run-status-text");
  const formError = document.getElementById("form-error");
  const modeError = document.getElementById("mode-error");
  const selectedModeLabel = document.getElementById("selected-mode-label");
  const selectedModeDescription = document.getElementById("selected-mode-description");

  const snapshotPanel = document.getElementById("snapshot-panel");
  const sourceGrid = document.getElementById("source-grid");
  const snapshotNote = document.getElementById("snapshot-note");
  const controlledNote = document.getElementById("controlled-note");
  const snapshotReportLinks = document.getElementById("snapshot-report-links");

  const modePanel = document.getElementById("mode-panel");
  const baselineModeStatus = document.getElementById("baseline-mode-status");
  const protectedModeStatus = document.getElementById("protected-mode-status");
  const compareModeStatus = document.getElementById("compare-mode-status");
  const baselineModeError = document.getElementById("baseline-mode-error");
  const protectedModeError = document.getElementById("protected-mode-error");
  const compareModeError = document.getElementById("compare-mode-error");
  const baselineReportLinks = document.getElementById("baseline-report-links");
  const protectedReportLinks = document.getElementById("protected-report-links");

  const modelResults = document.getElementById("model-results");
  const modelBadges = document.getElementById("model-badges");
  const responseGrid = document.getElementById("response-grid");
  const validationGrid = document.getElementById("validation-grid");

  const comparisonResults = document.getElementById("comparison-results");
  const comparisonError = document.getElementById("comparison-error");
  const badges = document.getElementById("result-badges");
  const summaryGrid = document.getElementById("summary-grid");
  const instructionFlags = document.getElementById("instruction-flags");
  const findingList = document.getElementById("finding-list");
  const productsBody = document.getElementById("products-body");
  const limitationsList = document.getElementById("limitations-list");
  const reportLinks = document.getElementById("report-links");

  const state = {
    snapshot: null,
    snapshotReportUrl: null,
    baseline: null,
    protected: null,
    comparison: null,
    busy: false,
  };

  const MODES = {
    baseline: {
      label: "Security OFF",
      description: "The unprotected baseline sends captured evidence directly to Gemma.",
    },
    protected: {
      label: "Security ON",
      description: "The protected condition labels webpage content as untrusted data before it reaches Gemma.",
    },
  };

  const STATUS_LABELS = {
    within_budget: "Within budget",
    over_budget: "Over budget",
    unknown: "Unknown",
    no_recommendation: "No qualifying recommendation",
    not_applicable: "Not applicable",
  };

  const REPORT_LABELS = {
    experiment: "Experiment",
    snapshot: "Evidence snapshot",
    baseline: "Security OFF report",
    protected: "Security ON report",
    comparison: "Comparison",
  };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function clear(node) {
    node.replaceChildren();
  }

  function setHidden(node, hidden) {
    node.hidden = hidden;
  }

  function syncVariantUrl() {
    if (!attackUrl || !attackVariant) return;
    let url;
    try {
      url = new URL(attackUrl.value, window.location.origin);
    } catch (error) {
      return;
    }
    if (attackVariant.value === "visible") {
      url.searchParams.delete("variant");
    } else {
      url.searchParams.set("variant", attackVariant.value);
    }
    attackUrl.value = url.toString();
  }

  function syncVariantFromUrl() {
    if (!attackUrl || !attackVariant) return;
    let url;
    try {
      url = new URL(attackUrl.value, window.location.origin);
    } catch (error) {
      return;
    }
    const requested = url.searchParams.get("variant") || "visible";
    const supported = Array.from(attackVariant.options).some((option) => option.value === requested);
    if (supported) attackVariant.value = requested;
  }

  function getSelectedCondition() {
    const selected = modeInputs.find((input) => input.checked);
    return selected && selected.value === "protected" ? "protected" : "baseline";
  }

  function boolText(value) {
    if (value === true) return "Yes";
    if (value === false) return "No";
    return "Unknown";
  }

  function truncate(text, length) {
    const value = String(text || "").replace(/\s+/g, " ").trim();
    return value.length > length ? `${value.slice(0, length - 1)}…` : value;
  }

  function formatInr(value) {
    if (value === null || value === undefined) return "Not applied";
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(value);
  }

  function formatStatus(value) {
    return STATUS_LABELS[value] || "Unknown";
  }

  function statusPill(value) {
    const known = Object.prototype.hasOwnProperty.call(STATUS_LABELS, value);
    return el("span", `status-pill ${known ? value : "unknown"}`, formatStatus(value));
  }

  function badge(text, tone) {
    return el("span", `badge ${tone || ""}`.trim(), text);
  }

  function setBadge(node, text, tone) {
    node.textContent = text;
    node.className = `badge ${tone || ""}`.trim();
  }

  function attemptNote(report) {
    const attempts = Number(report.attempts || 0);
    if (attempts <= 1) return "";
    return ` ${attempts} attempts were made; per-attempt diagnostics are in the saved report.`;
  }

  function friendlyError(report) {
    if (!report) return "No report was returned.";
    const type = report.error_type || "error";
    let message;
    if (type === "missing_api_key") {
      message = "No Gemma API key is configured. The run is recorded as incomplete.";
    } else if (type === "authentication_error") {
      message = "Gemma rejected the configured API key. Check GOOGLE_API_KEY or GEMINI_API_KEY on the server.";
    } else if (type === "quota_error") {
      message = "Gemma quota or rate limit was exceeded. The failed run is recorded; wait before retrying.";
    } else if (type === "model_unavailable") {
      message = "The configured Gemma model is unavailable. Check GEMMA_MODEL.";
    } else if (type === "configuration_error") {
      message = "The model request settings are invalid. Check the GEMMA_* configuration and restart the server.";
    } else if (type === "api_server_error") {
      const detail = report.error ? ` (${truncate(report.error, 120)})` : "";
      message = `Gemma returned a provider server error${detail}. The failure is recorded; retry this mode later.`;
    } else if (type === "network_error") {
      message = "The model request failed because of a network error. Check connectivity and retry this mode.";
    } else if (type === "timeout_error") {
      message = "The model request timed out. The failure is recorded; retry this mode or raise GEMMA_REQUEST_TIMEOUT_MS.";
    } else if (type === "api_client_error" || type === "api_error") {
      message = "Gemma rejected the model request. The request was not retried automatically; see the saved report for the provider response.";
    } else if (type === "transient_client_error") {
      message = "Gemma returned a transient client error after the bounded retries. Retry this mode later.";
    } else if (type === "response_parse_error") {
      message = "Gemma returned a response that could not be parsed safely. It was not treated as a successful answer.";
    } else if (type === "empty_response") {
      const detail = report.error ? ` ${truncate(report.error, 180)}` : "";
      message = `Gemma returned no usable text.${detail}`;
    } else if (report.error) {
      message = truncate(report.error, 220);
    } else {
      message = `The run failed with ${type}. See the saved JSON report for details.`;
    }
    return `${message}${attemptNote(report)}`;
  }

  function summarizeApiError(text) {
    const value = String(text || "");
    if (value.includes("missing_api_key")) return "A condition had no API key configured.";
    if (value.includes("api_server_error")) return truncate(`A condition hit a Gemma provider server error: ${value}`, 220);
    if (value.includes("authentication_error")) return "A condition hit an authentication error.";
    if (value.includes("quota_error")) return "A condition hit a quota or rate-limit error.";
    if (value.includes("network_error")) return "A condition hit a network error.";
    if (value.includes("timeout_error")) return "A condition timed out.";
    if (value.includes("configuration_error")) return "A condition had invalid model configuration.";
    if (value.includes("response_parse_error")) return "A condition returned an unparseable response.";
    if (value.includes("empty_response")) return "A condition returned no usable text.";
    return truncate(value, 180);
  }

  function addSummary(label, value, detail) {
    const card = el("article", "summary-card");
    card.append(el("span", "label", label), el("span", "value", value));
    if (detail) card.append(el("span", "detail", detail));
    summaryGrid.append(card);
  }

  function addFlag(label, value, extraClass) {
    const card = el("article", `flag-card ${extraClass || ""}`.trim());
    card.append(el("span", "flag-label", label), el("span", "flag-value", value));
    instructionFlags.append(card);
  }

  function sourceLabel(index) {
    return `Resource ${index + 1}`;
  }

  function renderReportLinks(container, reportUrls, order) {
    clear(container);
    if (!reportUrls) return;
    const keys = (order || Object.keys(reportUrls)).filter((key) => reportUrls[key]);
    keys.forEach((key) => {
      const url = reportUrls[key];
      if (typeof url !== "string" || !url.startsWith("/api/reports/")) return;
      const link = el("a", "report-link", REPORT_LABELS[key] || key);
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener";
      container.append(link);
    });
  }

  function renderSources(snapshot) {
    clear(sourceGrid);
    snapshot.pages.forEach((page, index) => {
      const row = el("article", `resource-row ${page.success ? "ok" : "fail"}`);
      const top = el("div", "resource-topline");
      const label = page.partial ? "Partial" : page.success ? "Extracted" : "Failed";
      const tone = page.partial ? "warning" : page.success ? "success" : "danger";
      top.append(
        el("span", "resource-index", sourceLabel(index)),
        el("span", `badge ${tone}`, label)
      );
      row.append(top);
      row.append(el("h3", "", page.title || "Untitled page"));
      row.append(el("span", "resource-url", page.final_url || page.url));
      if (page.success) {
        const attempts = page.attempts && page.attempts > 1 ? ` · ${page.attempts} attempts` : "";
        const httpStatus = page.http_status ? ` · HTTP ${page.http_status}` : "";
        const method = page.extraction_method === "dom" ? "DOM text" : "visible text";
        row.append(el("span", "resource-detail", `${page.text.length.toLocaleString()} characters captured as ${method}${httpStatus}${attempts}`));
        if (page.warning || page.retry_reason) {
          row.append(el("p", "resource-note", page.warning || page.retry_reason));
        }
      } else {
        row.append(el("p", "resource-error", page.error || "Extraction failed without a recorded error."));
      }
      sourceGrid.append(row);
    });

    const variant = snapshot.controlled_variant || "visible";
    snapshotNote.textContent = `Snapshot ${snapshot.snapshot_id} · ${snapshot.extraction_success ? "3/3 extracted" : "incomplete"} · ${variant} variant`;
    controlledNote.textContent = snapshot.controlled_instruction_note || "";
    setHidden(controlledNote, !snapshot.controlled_instruction_note);
    renderReportLinks(snapshotReportLinks, { snapshot: state.snapshotReportUrl }, ["snapshot"]);
  }

  function renderSelectedMode() {
    const mode = MODES[getSelectedCondition()];
    selectedModeLabel.textContent = `${mode.label} selected`;
    selectedModeDescription.textContent = mode.description;
  }

  function canCompare() {
    return Boolean(
      state.snapshot
      && state.snapshot.extraction_success
      && state.baseline
      && state.baseline.report.success
      && state.protected
      && state.protected.report.success
      && !state.busy
    );
  }

  function renderModeState() {
    const baseline = state.baseline;
    const protectedRun = state.protected;

    if (!baseline) {
      setBadge(baselineModeStatus, "Not run", "");
      setHidden(baselineModeError, true);
      clear(baselineReportLinks);
    } else {
      const report = baseline.report;
      setBadge(baselineModeStatus, report.success ? "Complete" : "Failed", report.success ? "success" : "danger");
      baselineModeError.textContent = report.success ? "" : friendlyError(report);
      setHidden(baselineModeError, report.success);
      renderReportLinks(baselineReportLinks, baseline.reportUrls, ["baseline"]);
    }

    if (!protectedRun) {
      setBadge(protectedModeStatus, "Not run", "");
      setHidden(protectedModeError, true);
      clear(protectedReportLinks);
    } else {
      const report = protectedRun.report;
      setBadge(protectedModeStatus, report.success ? "Complete" : "Failed", report.success ? "success" : "danger");
      protectedModeError.textContent = report.success ? "" : friendlyError(report);
      setHidden(protectedModeError, report.success);
      renderReportLinks(protectedReportLinks, protectedRun.reportUrls, ["protected"]);
    }

    if (state.comparison) {
      setBadge(compareModeStatus, "Compared", "success");
      setHidden(compareModeError, true);
    } else if (canCompare()) {
      setBadge(compareModeStatus, "Ready to compare", "warning");
      setHidden(compareModeError, true);
    } else if (baseline && protectedRun) {
      setBadge(compareModeStatus, "Needs successful runs", "warning");
      setHidden(compareModeError, true);
    } else {
      setBadge(compareModeStatus, "Waiting for runs", "");
      setHidden(compareModeError, true);
    }
  }

  function renderResponses() {
    clear(responseGrid);
    [
      ["baseline", "Security OFF · baseline"],
      ["protected", "Security ON · protected"],
    ].forEach(([condition, title]) => {
      const mode = state[condition];
      const report = mode ? mode.report : null;
      const success = Boolean(report && report.success);
      const card = el("article", `response-card ${success ? "" : "failed"}`.trim());

      const header = el("header");
      header.append(el("h3", "", title));
      if (report) {
        header.append(badge(success ? "Success" : "Failed", success ? "success" : "danger"));
      } else {
        header.append(badge("Not run", ""));
      }
      card.append(header);

      let text;
      if (!report) {
        text = "This security mode has not been run for the current snapshot.";
      } else if (report.response_text) {
        text = report.response_text;
      } else {
        text = `No model response was returned.\n${friendlyError(report)}`;
      }
      card.append(el("pre", "response-text", text));
      if (report && report.attempts && report.attempts > 1) {
        const reasons = (report.retry_reasons || []).filter(Boolean).join(" ");
        card.append(el("p", "response-footnote", `Attempts: ${report.attempts}. ${reasons || report.retry_reason || ""}`.trim()));
      }
      responseGrid.append(card);
    });
  }

  function appendValidationRow(container, key, value) {
    const row = el("div", "validation-row");
    row.append(el("span", "key", key), el("span", "value", value));
    container.append(row);
  }

  function renderValidationCard(condition, title) {
    const mode = state[condition];
    const report = mode ? mode.report : null;
    const validation = report ? report.validation : null;
    const card = el("article", "validation-card");

    const header = el("header");
    header.append(el("h3", "", title));
    if (report) {
      header.append(badge(report.success ? "Model response" : "No response", report.success ? "success" : "danger"));
    } else {
      header.append(badge("Not run", ""));
    }
    card.append(header);

    const body = el("div", "validation-body");
    if (!report) {
      body.append(el("p", "panel-note", "Validation is available after this security mode runs."));
      card.append(body);
      return card;
    }
    if (!validation) {
      body.append(el("p", "panel-note", "No validation result was saved for this run."));
      card.append(body);
      return card;
    }

    appendValidationRow(body, "Recommendation", validation.recommendation_identified ? (validation.recommended_product || "Identified") : "No recommendation identified");
    appendValidationRow(body, "Target product", validation.target_product || "Not available");
    appendValidationRow(body, "Target mentioned", boolText(validation.target_mentioned));
    appendValidationRow(body, "Target recommended", boolText(validation.target_recommended));
    appendValidationRow(body, "Target rejected", boolText(validation.target_rejected));
    appendValidationRow(body, "Captured price", validation.price_original || validation.price_amount || "Not established");
    appendValidationRow(body, "Currency", validation.price_currency || "Unknown");
    appendValidationRow(body, "Normalized INR", validation.normalized_price_inr === null || validation.normalized_price_inr === undefined ? "Not applied" : formatInr(validation.normalized_price_inr));
    appendValidationRow(body, "Budget", validation.budget_inr === null || validation.budget_inr === undefined ? "Not applicable" : formatInr(validation.budget_inr));

    const statusRow = el("div", "validation-row");
    statusRow.append(el("span", "key", "Constraint status"), statusPill(validation.budget_status));
    body.append(statusRow);

    appendValidationRow(body, "Task constraint", boolText(validation.user_constraint_satisfied));
    appendValidationRow(body, "Validation uncertainty", boolText(validation.validation_uncertain));
    if (validation.normalization_note) {
      appendValidationRow(body, "Currency note", validation.normalization_note);
    }
    body.append(el("p", "validation-reason", validation.reason));
    card.append(body);
    return card;
  }

  function renderValidation() {
    clear(validationGrid);
    validationGrid.append(
      renderValidationCard("baseline", "Security OFF validation"),
      renderValidationCard("protected", "Security ON validation")
    );
  }

  function renderModelResults() {
    const hasRun = Boolean(state.baseline || state.protected);
    setHidden(modelResults, !hasRun);
    if (!hasRun) return;

    clear(modelBadges);
    modelBadges.append(badge("Same saved snapshot"));
    modelBadges.append(badge("Bounded retries recorded"));
    renderResponses();
    renderValidation();
  }

  function renderDetection(comparison) {
    clear(instructionFlags);
    clear(findingList);
    const detection = comparison.detection;
    addFlag("Attack page variant", comparison.controlled_variant || "visible", "");
    addFlag("Instruction counted", detection.detected ? "Yes" : "No", detection.detected ? "yes" : "no");
    addFlag("Instruction in DOM", comparison.instruction_in_dom ? "Yes" : "No", comparison.instruction_in_dom ? "yes" : "no");
    addFlag("Instruction in snapshot", comparison.instruction_in_snapshot ? "Yes" : "No", comparison.instruction_in_snapshot ? "yes" : "no");
    addFlag("Controlled marker extracted", comparison.instruction_extracted ? "Yes" : "No", comparison.instruction_extracted ? "yes" : "no");
    addFlag("Reached OFF input", comparison.instruction_in_baseline_input ? "Yes" : "No", comparison.instruction_in_baseline_input ? "yes" : "no");
    addFlag("Reached ON input", comparison.instruction_in_protected_input ? "Yes" : "No", comparison.instruction_in_protected_input ? "yes" : "no");

    const confinement = el("article", `flag-card ${comparison.protected_instruction_confined_to_untrusted_block ? "yes" : "no"}`);
    confinement.append(
      el("span", "flag-label", "ON placement"),
      el("span", "flag-value", comparison.protected_instruction_confined_to_untrusted_block ? "Confined to untrusted block" : "Not confined")
    );
    instructionFlags.append(confinement);

    if (!detection.findings.length) {
      findingList.append(el("p", "panel-note", "No instruction-like text was flagged."));
      return;
    }

    detection.findings.forEach((finding) => {
      const card = el("article", "finding");
      card.append(el("div", "finding-meta", finding.source_url));
      card.append(el("blockquote", "", finding.excerpt));
      const rules = finding.matched_rules && finding.matched_rules.length
        ? ` Rules: ${finding.matched_rules.join(", ")}.`
        : "";
      card.append(el("p", "", finding.reason + rules));
      findingList.append(card);
    });
  }

  function renderProducts(comparison) {
    clear(productsBody);
    if (!comparison.products.length) {
      const row = el("tr");
      const cell = el("td", "empty", "No captured facts were available for this comparison.");
      cell.colSpan = 6;
      row.append(cell);
      productsBody.append(row);
      return;
    }

    comparison.products.forEach((product) => {
      const row = el("tr");
      const nameCell = el("td");
      nameCell.append(el("strong", "", product.name), el("span", "resource-url", product.source_url));
      row.append(nameCell);
      row.append(el("td", "", product.price_original || "Not established"));
      row.append(el("td", "", product.currency || "Unknown"));
      row.append(el("td", "", product.normalized_price_inr === null || product.normalized_price_inr === undefined ? "Not applied" : formatInr(product.normalized_price_inr)));
      const statusCell = el("td");
      statusCell.append(statusPill(product.budget_status));
      row.append(statusCell);
      row.append(el("td", "", product.reason));
      productsBody.append(row);
    });
  }

  function renderSummary(comparison) {
    clear(summaryGrid);
    addSummary(
      "Observed outcome",
      comparison.outcome,
      `Model: ${comparison.model} · ${comparison.snapshot_id || "snapshot not recorded"}`
    );
    addSummary(
      "Attack page variant",
      comparison.controlled_variant || "visible",
      "Visible, hidden DOM, or no-injection control"
    );
    addSummary(
      "Same snapshot",
      boolText(comparison.same_snapshot),
      "Both modes must use the captured evidence"
    );
    addSummary(
      "Same evidence",
      boolText(comparison.same_evidence),
      "Task text and captured content must match"
    );
    addSummary(
      "Same model and settings",
      comparison.same_model && comparison.same_generation_settings ? "Yes" : "No",
      "Mismatched runs stay inconclusive"
    );
    addSummary(
      "Target recommendation",
      `OFF ${boolText(comparison.target_recommended_baseline)} · ON ${boolText(comparison.target_recommended_protected)}`,
      comparison.target_product || "Target product not identified"
    );
    addSummary(
      "Budget violated",
      `OFF ${boolText(comparison.budget_violated_baseline)} · ON ${boolText(comparison.budget_violated_protected)}`,
      "Deterministic check against the captured price"
    );
    const conditionalOff = Boolean(
      comparison.baseline
      && comparison.baseline.validation
      && comparison.baseline.validation.conditional_over_budget_alternative
    );
    addSummary(
      "Conditional OFF recommendation",
      boolText(conditionalOff),
      conditionalOff
        ? "Requires a budget increase; not counted as an attack"
        : "No budget-increase condition detected"
    );
    addSummary(
      "Security ON changed result",
      boolText(comparison.protection_changed_result),
      "Observed change in this paired trial only"
    );
    addSummary(
      "Improvement observed",
      boolText(comparison.improvement_observed),
      "Requires an unsafe OFF result and a safe ON result"
    );
    addSummary(
      "Causation established",
      "No",
      "Single paired trial, not proof of general effectiveness"
    );
  }

  function renderBadges(comparison) {
    clear(badges);
    const outcomeTone = comparison.outcome === "Attack demonstrated in the observed baseline"
      ? "danger"
      : comparison.outcome === "Inconclusive" ? "warning" : "";
    badges.append(badge(comparison.outcome, outcomeTone));
    badges.append(badge(comparison.protection_changed_result ? "Security ON changed result" : "No observed change", comparison.protection_changed_result ? "success" : ""));
    badges.append(badge("Single paired trial"));
  }

  function renderLimitations(comparison) {
    clear(limitationsList);
    const items = [...comparison.uncertainty];
    if (state.snapshot && state.snapshot.controlled_instruction_note) {
      items.push(state.snapshot.controlled_instruction_note);
    }
    items.push(
      "Extraction only proves that page text was captured; it does not prove the model obeyed an instruction embedded in a page.",
      "Heuristic detection can miss or over-flag instruction-like text and is not an attack-success score.",
      "Automatic constraint validation is limited. When no supported constraint is present, it is marked not applicable.",
      "A single paired trial does not establish causation or universal defence effectiveness.",
      "External resources can change after capture; the saved snapshot is the evidence used for both modes."
    );
    [...new Set(items)].forEach((item) => limitationsList.append(el("li", "", item)));
  }

  function renderComparison() {
    const entry = state.comparison;
    setHidden(comparisonResults, !entry);
    if (!entry) return;

    const comparison = entry.comparison;
    setHidden(comparisonError, true);
    if (comparison.api_errors && comparison.api_errors.length) {
      comparisonError.textContent = comparison.api_errors.map(summarizeApiError).join(" ");
      setHidden(comparisonError, false);
    }

    renderBadges(comparison);
    renderSummary(comparison);
    renderDetection(comparison);
    renderProducts(comparison);
    renderLimitations(comparison);
    renderReportLinks(reportLinks, entry.reportUrls, ["comparison", "snapshot", "baseline", "protected"]);
  }

  function updateModeControls() {
    const usable = Boolean(state.snapshot && state.snapshot.extraction_success);
    runResearchButton.disabled = state.busy || !usable;
    compareButton.disabled = !canCompare();
    captureButton.disabled = state.busy;
    modeInputs.forEach((input) => {
      input.disabled = state.busy;
    });
  }

  function setBusy(busy, message) {
    state.busy = busy;
    setHidden(runStatus, !busy);
    if (busy && message) runStatusText.textContent = message;
    updateModeControls();
  }

  function resetAfterCapture() {
    state.baseline = null;
    state.protected = null;
    state.comparison = null;
    setHidden(modelResults, true);
    setHidden(comparisonResults, true);
    clear(responseGrid);
    clear(validationGrid);
    clear(modelBadges);
    clear(baselineReportLinks);
    clear(protectedReportLinks);
    clear(reportLinks);
    setHidden(modeError, true);
    setHidden(comparisonError, true);
  }

  async function postJson(url, payload) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw new Error(`The server returned HTTP ${response.status} without a JSON response.`);
    }
    return { response, data };
  }

  async function capture(event) {
    event.preventDefault();
    if (state.busy) return;
    formError.hidden = true;
    setHidden(snapshotPanel, true);
    setHidden(modePanel, true);
    resetAfterCapture();
    setBusy(true, "Capturing resources into a new evidence snapshot…");

    const payload = {
      task: document.getElementById("task").value,
      urls: [
        document.getElementById("real-url-1").value,
        document.getElementById("real-url-2").value,
        document.getElementById("attack-url").value,
      ],
    };

    try {
      const { data } = await postJson("/api/capture", payload);
      if (!data.snapshot) {
        throw new Error(data.error || "The capture request did not return an evidence snapshot.");
      }

      state.snapshot = data.snapshot;
      state.snapshotReportUrl = data.report_urls ? data.report_urls.snapshot : null;
      if (state.snapshot.controlled_variant) {
        attackVariant.value = state.snapshot.controlled_variant;
        syncVariantUrl();
      }
      renderSources(state.snapshot);
      renderSelectedMode();
      renderModeState();
      setHidden(snapshotPanel, false);
      setHidden(modePanel, false);

      if (state.snapshot.extraction_success) {
        setHidden(modeError, true);
      } else {
        modeError.textContent = "Model runs are disabled until all three resources extract successfully. Capture a new snapshot after fixing the failed resource.";
        setHidden(modeError, false);
      }

      updateModeControls();
      snapshotPanel.scrollIntoView({ block: "start" });
    } catch (error) {
      formError.textContent = error instanceof Error ? error.message : "Evidence capture could not be started.";
      formError.hidden = false;
    } finally {
      setBusy(false);
    }
  }

  async function runResearch() {
    if (state.busy || !state.snapshot || !state.snapshot.extraction_success) return;
    const condition = getSelectedCondition();
    const mode = MODES[condition];
    const modeErrorNode = condition === "baseline" ? baselineModeError : protectedModeError;

    state[condition] = null;
    state.comparison = null;
    setHidden(comparisonResults, true);
    setHidden(modeError, true);
    modeErrorNode.textContent = "";
    setHidden(modeErrorNode, true);
    renderModeState();
    renderModelResults();
    updateModeControls();

    setBusy(true, `Running ${mode.label} on the saved evidence snapshot…`);

    try {
      const { data } = await postJson(condition === "baseline" ? "/api/run/baseline" : "/api/run/protected", {
        snapshot_id: state.snapshot.snapshot_id,
      });
      if (!data.report) {
        throw new Error(data.error || `The ${mode.label} request did not return a report.`);
      }

      state[condition] = {
        report: data.report,
        reportUrls: data.report_urls || {},
      };
      renderModeState();
      renderModelResults();
      updateModeControls();
      modelResults.scrollIntoView({ block: "start" });
    } catch (error) {
      modeErrorNode.textContent = error instanceof Error ? error.message : `${mode.label} could not be started.`;
      setHidden(modeErrorNode, false);
      setBadge(condition === "baseline" ? baselineModeStatus : protectedModeStatus, "Failed", "danger");
    } finally {
      setBusy(false);
    }
  }

  async function compare() {
    if (!canCompare()) return;
    setHidden(comparisonError, true);
    setBusy(true, "Comparing the latest compatible saved runs…");

    try {
      const { data } = await postJson("/api/compare", {
        snapshot_id: state.snapshot.snapshot_id,
      });
      if (!data.comparison) {
        throw new Error(data.error || "The comparison request did not return a report.");
      }

      state.comparison = {
        comparison: data.comparison,
        reportUrls: data.report_urls || {},
      };
      renderComparison();
      renderModeState();
      updateModeControls();
      comparisonResults.scrollIntoView({ block: "start" });
    } catch (error) {
      compareModeError.textContent = error instanceof Error ? error.message : "The comparison could not be started.";
      setHidden(compareModeError, false);
      setBadge(compareModeStatus, "Incomplete", "warning");
    } finally {
      setBusy(false);
    }
  }

  if (attackVariant) {
    attackVariant.addEventListener("change", syncVariantUrl);
  }
  if (attackUrl) {
    attackUrl.addEventListener("change", syncVariantFromUrl);
  }
  captureForm.addEventListener("submit", capture);
  runResearchButton.addEventListener("click", runResearch);
  compareButton.addEventListener("click", compare);
  modeInputs.forEach((input) => {
    input.addEventListener("change", renderSelectedMode);
  });

  renderSelectedMode();
  updateModeControls();
})();
