(() => {
  "use strict";

  const captureForm = document.getElementById("capture-form");
  const captureButton = document.getElementById("capture-button");
  const baselineButton = document.getElementById("run-baseline-button");
  const protectedButton = document.getElementById("run-protected-button");
  const compareButton = document.getElementById("compare-button");
  const runStatus = document.getElementById("run-status");
  const runStatusText = document.getElementById("run-status-text");
  const formError = document.getElementById("form-error");
  const modeError = document.getElementById("mode-error");

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

  function friendlyError(report) {
    if (!report) return "No report was returned.";
    const type = report.error_type || "error";
    if (type === "missing_api_key") {
      return "No Gemma API key is configured. The run is recorded as incomplete.";
    }
    if (type === "authentication_error") {
      return "Gemma rejected the configured API key. Check the server credentials.";
    }
    if (type === "quota_error") {
      return "Gemma quota was exceeded. The failed run is recorded; retry later.";
    }
    if (type === "model_unavailable") {
      return "The configured Gemma model is unavailable. Check the model setting.";
    }
    if (type === "api_server_error") {
      return "Gemma returned HTTP 500 (provider internal error). The failure is recorded; retry this mode later.";
    }
    if (type === "network_error") {
      return "The model request failed because of a network error. The failure is recorded.";
    }
    if (type === "empty_response") {
      return "Gemma returned no text. The empty response is recorded.";
    }
    if (report.error) return truncate(report.error, 220);
    return `The run failed with ${type}. See the saved JSON report for details.`;
  }

  function summarizeApiError(text) {
    const value = String(text || "");
    if (value.includes("missing_api_key")) return "A condition had no API key configured.";
    if (value.includes("api_server_error")) return "A condition hit a Gemma HTTP 500 provider error.";
    if (value.includes("authentication_error")) return "A condition hit an authentication error.";
    if (value.includes("quota_error")) return "A condition hit a quota error.";
    if (value.includes("network_error")) return "A condition hit a network error.";
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
    return index === 2 ? "Controlled test source" : `Research source ${index + 1}`;
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
      const card = el("article", `source-card ${page.success ? "ok" : "fail"}`);
      const top = el("div", "source-topline");
      top.append(
        el("span", "source-index", sourceLabel(index)),
        el("span", `badge ${page.success ? "success" : "danger"}`, page.success ? "Extracted" : "Failed")
      );
      card.append(top);
      card.append(el("h3", "", page.title || "Untitled page"));
      card.append(el("span", "source-url", page.final_url || page.url));
      if (page.success) {
        card.append(el("span", "source-detail", `${page.text.length.toLocaleString()} characters captured`));
      } else {
        card.append(el("p", "source-error", page.error || "Extraction failed without a recorded error."));
      }
      sourceGrid.append(card);
    });

    snapshotNote.textContent = `Snapshot ${snapshot.snapshot_id} · ${snapshot.extraction_success ? "all sources extracted" : "incomplete extraction"}`;
    controlledNote.textContent = snapshot.controlled_instruction_note || "";
    setHidden(controlledNote, !snapshot.controlled_instruction_note);
    renderReportLinks(snapshotReportLinks, { snapshot: state.snapshotReportUrl }, ["snapshot"]);
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
    } else if (baseline && protectedRun) {
      setBadge(compareModeStatus, "Ready to compare", "warning");
      setHidden(compareModeError, true);
    } else {
      setBadge(compareModeStatus, "Waiting for runs", "");
      setHidden(compareModeError, true);
    }
  }

  function renderResponses() {
    clear(responseGrid);
    [
      ["baseline", "Security OFF · unprotected baseline"],
      ["protected", "Security ON · protected condition"],
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
    appendValidationRow(body, "Captured price", validation.price_original || validation.price_amount || "Not established");
    appendValidationRow(body, "Currency", validation.price_currency || "Unknown");
    appendValidationRow(body, "Normalized INR", validation.normalized_price_inr === null || validation.normalized_price_inr === undefined ? "Not applied" : formatInr(validation.normalized_price_inr));
    appendValidationRow(body, "Budget", validation.budget_inr === null || validation.budget_inr === undefined ? "Not applicable" : formatInr(validation.budget_inr));

    const statusRow = el("div", "validation-row");
    statusRow.append(el("span", "key", "Budget status"), statusPill(validation.budget_status));
    body.append(statusRow);

    appendValidationRow(body, "User constraint", boolText(validation.user_constraint_satisfied));
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
    modelBadges.append(badge("Single attempt per mode"));
    renderResponses();
    renderValidation();
  }

  function renderDetection(comparison) {
    clear(instructionFlags);
    clear(findingList);
    const detection = comparison.detection;
    addFlag("Malicious instruction found", detection.detected ? "Yes" : "No", detection.detected ? "yes" : "no");
    addFlag("Instruction reached OFF input", comparison.instruction_in_baseline_input ? "Yes" : "No", comparison.instruction_in_baseline_input ? "yes" : "no");
    addFlag("Instruction reached ON input", comparison.instruction_in_protected_input ? "Yes" : "No", comparison.instruction_in_protected_input ? "yes" : "no");

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
      nameCell.append(el("strong", "", product.name), el("span", "source-url", product.source_url));
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
      "Same snapshot",
      boolText(comparison.same_snapshot),
      "Both conditions must use the captured evidence"
    );
    addSummary(
      "Same evidence",
      boolText(comparison.same_evidence),
      "Task text and captured page content must match"
    );
    addSummary(
      "Same model and settings",
      comparison.same_model && comparison.same_generation_settings ? "Yes" : "No",
      "Mismatched runs stay inconclusive"
    );
    addSummary(
      "Improvement observed",
      boolText(comparison.improvement_observed),
      "Observed difference in this trial only"
    );
    addSummary(
      "Causation established",
      "No",
      "Single paired trial, not proof of general effectiveness"
    );
  }

  function renderBadges(comparison) {
    clear(badges);
    badges.append(badge(comparison.outcome, comparison.outcome === "Attack not demonstrated" ? "success" : "warning"));
    badges.append(badge(comparison.improvement_observed ? "Improvement observed" : "No improvement observed", comparison.improvement_observed ? "success" : ""));
    badges.append(badge("Single paired trial"));
  }

  function renderLimitations(comparison) {
    clear(limitationsList);
    const items = [...comparison.uncertainty];
    if (state.snapshot && state.snapshot.controlled_instruction_note) {
      items.push(state.snapshot.controlled_instruction_note);
    }
    items.push(
      "Extraction only proves that page text was captured; it does not prove the model obeyed an injected instruction.",
      "Heuristic detection can miss or over-flag instruction-like text and is not an attack-success score.",
      "Budget validation applies only when the original task contains an identifiable INR budget and the captured evidence contains supported prices.",
      "A single paired trial does not establish causation or universal defence effectiveness.",
      "External webpages can change after capture; the saved snapshot is the evidence used for both conditions."
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
    baselineButton.disabled = state.busy || !usable;
    protectedButton.disabled = state.busy || !usable;
    compareButton.disabled = state.busy || !(state.baseline && state.protected);
    captureButton.disabled = state.busy;
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
    formError.hidden = true;
    setHidden(snapshotPanel, true);
    setHidden(modePanel, true);
    resetAfterCapture();
    setBusy(true, "Capturing three sources into a new evidence snapshot…");

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
      renderSources(state.snapshot);
      renderModeState();
      setHidden(snapshotPanel, false);
      setHidden(modePanel, false);

      if (state.snapshot.extraction_success) {
        setHidden(modeError, true);
      } else {
        modeError.textContent = "Model runs are disabled until all three required sources extract successfully. Capture a new snapshot after fixing the failed source.";
        setHidden(modeError, false);
      }

      updateModeControls();
      snapshotPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      formError.textContent = error instanceof Error ? error.message : "Evidence capture could not be started.";
      formError.hidden = false;
    } finally {
      setBusy(false);
    }
  }

  async function runMode(condition) {
    if (!state.snapshot || !state.snapshot.extraction_success) return;
    const isBaseline = condition === "baseline";
    const conditionLabel = isBaseline ? "Security OFF" : "Security ON";
    const button = isBaseline ? baselineButton : protectedButton;
    const modeErrorNode = isBaseline ? baselineModeError : protectedModeError;

    state[condition] = null;
    state.comparison = null;
    setHidden(comparisonResults, true);
    setHidden(modeError, true);
    setHidden(modeErrorNode, true);
    renderModeState();
    renderModelResults();
    updateModeControls();

    button.disabled = true;
    setBusy(true, `Running ${conditionLabel} on the saved evidence snapshot…`);

    try {
      const { data } = await postJson(isBaseline ? "/api/run/baseline" : "/api/run/protected", {
        snapshot_id: state.snapshot.snapshot_id,
      });
      if (!data.report) {
        throw new Error(data.error || `The ${conditionLabel} request did not return a report.`);
      }

      state[condition] = {
        report: data.report,
        reportUrls: data.report_urls || {},
      };
      renderModeState();
      renderModelResults();
      updateModeControls();
      modelResults.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      modeError.textContent = error instanceof Error ? error.message : `${conditionLabel} could not be started.`;
      setHidden(modeError, false);
    } finally {
      setBusy(false);
    }
  }

  async function compare() {
    if (!state.snapshot || !(state.baseline && state.protected)) return;
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
      comparisonResults.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      compareModeError.textContent = error instanceof Error ? error.message : "The comparison could not be started.";
      setHidden(compareModeError, false);
      setBadge(compareModeStatus, "Incomplete", "warning");
    } finally {
      setBusy(false);
    }
  }

  captureForm.addEventListener("submit", capture);
  baselineButton.addEventListener("click", () => runMode("baseline"));
  protectedButton.addEventListener("click", () => runMode("protected"));
  compareButton.addEventListener("click", compare);

  updateModeControls();
})();
