(() => {
  "use strict";

  const form = document.getElementById("experiment-form");
  const runButton = document.getElementById("run-button");
  const runStatus = document.getElementById("run-status");
  const runStatusText = document.getElementById("run-status-text");
  const formError = document.getElementById("form-error");
  const results = document.getElementById("results");
  const experimentError = document.getElementById("experiment-error");
  const badges = document.getElementById("result-badges");
  const summaryGrid = document.getElementById("summary-grid");
  const sourceGrid = document.getElementById("source-grid");
  const snapshotNote = document.getElementById("snapshot-note");
  const instructionFlags = document.getElementById("instruction-flags");
  const findingList = document.getElementById("finding-list");
  const responseGrid = document.getElementById("response-grid");
  const validationGrid = document.getElementById("validation-grid");
  const productsBody = document.getElementById("products-body");
  const limitationsList = document.getElementById("limitations-list");
  const reportLinks = document.getElementById("report-links");

  const STATUS_LABELS = {
    within_budget: "Within budget",
    over_budget: "Over budget",
    unknown: "Unknown",
    no_recommendation: "No qualifying recommendation",
  };

  const REPORT_LABELS = {
    experiment: "Experiment",
    snapshot: "Evidence snapshot",
    baseline: "Baseline",
    protected: "Protected",
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
    return index === 2 ? "Controlled malicious source" : `Real product source ${index + 1}`;
  }

  function renderSources(experiment) {
    clear(sourceGrid);
    experiment.pages.forEach((page, index) => {
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
    snapshotNote.textContent = `Snapshot ${experiment.snapshot_id} · ${experiment.extraction_success ? "all sources extracted" : "incomplete extraction"}`;
  }

  function renderDetection(experiment) {
    clear(instructionFlags);
    clear(findingList);
    const comparison = experiment.comparison;

    if (!comparison) {
      addFlag("Malicious instruction found", "Not evaluated", "no");
      addFlag("Instruction reached baseline input", "Not evaluated", "no");
      addFlag("Instruction reached protected input", "Not evaluated", "no");
      findingList.append(
        el("p", "panel-note", "Model conditions were not run because extraction was incomplete.")
      );
      return;
    }

    const detection = comparison.detection;
    addFlag(
      "Malicious instruction found",
      detection.detected ? "Yes" : "No",
      detection.detected ? "yes" : "no"
    );
    addFlag(
      "Instruction reached baseline input",
      comparison.instruction_in_baseline_input ? "Yes" : "No",
      comparison.instruction_in_baseline_input ? "yes" : "no"
    );
    addFlag(
      "Instruction reached protected input",
      comparison.instruction_in_protected_input ? "Yes" : "No",
      comparison.instruction_in_protected_input ? "yes" : "no"
    );

    const confinement = el("article", `flag-card ${comparison.protected_instruction_confined_to_untrusted_block ? "yes" : "no"}`);
    confinement.append(
      el("span", "flag-label", "Protected placement"),
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
      const detail = finding.reason;
      const rules = finding.matched_rules && finding.matched_rules.length
        ? ` Rules: ${finding.matched_rules.join(", ")}.`
        : "";
      card.append(el("p", "", detail + rules));
      findingList.append(card);
    });
  }

  function conditionValidation(experiment, conditionName) {
    const comparison = experiment.comparison;
    if (comparison && comparison[conditionName]) {
      return comparison[conditionName].validation;
    }
    const report = experiment[conditionName];
    return report ? report.validation : null;
  }

  function renderResponseCard(experiment, conditionName, title) {
    const comparison = experiment.comparison;
    const report = experiment[conditionName];
    const condition = comparison ? comparison[conditionName] : null;
    const success = condition ? condition.success : Boolean(report && report.success);
    const card = el("article", `response-card ${success ? "" : "failed"}`.trim());

    const header = el("header");
    header.append(el("h3", "", title), el("span", `badge ${success ? "success" : "danger"}`, success ? "Success" : "Failed"));
    card.append(header);

    let text = "";
    if (report && report.response_text) {
      text = report.response_text;
    } else if (report) {
      const type = report.error_type || "error";
      text = `No model response was returned.\n${type}: ${report.error || "Unknown error"}`;
    } else {
      text = "This condition was not run.";
    }
    card.append(el("pre", "response-text", text));
    return card;
  }

  function renderResponses(experiment) {
    clear(responseGrid);
    responseGrid.append(
      renderResponseCard(experiment, "baseline", "Unprotected baseline"),
      renderResponseCard(experiment, "protected", "Protected condition")
    );
  }

  function appendValidationRow(container, key, value) {
    const row = el("div", "validation-row");
    row.append(el("span", "key", key), el("span", "value", value));
    container.append(row);
  }

  function renderValidationCard(experiment, conditionName, title) {
    const validation = conditionValidation(experiment, conditionName);
    const report = experiment[conditionName];
    const card = el("article", "validation-card");

    const header = el("header");
    header.append(el("h3", "", title));
    if (report) {
      header.append(el("span", `badge ${report.success ? "success" : "danger"}`, report.success ? "Model response" : "No response"));
    }
    card.append(header);

    const body = el("div", "validation-body");
    if (!validation) {
      body.append(el("p", "panel-note", "Validation was not available because this condition did not run."));
      card.append(body);
      return card;
    }

    appendValidationRow(body, "Recommendation", validation.recommendation_identified ? (validation.recommended_product || "Identified") : "No recommendation identified");
    appendValidationRow(body, "Captured price", validation.price_original || (validation.price_amount ? validation.price_amount : "Not established"));
    appendValidationRow(body, "Currency", validation.price_currency || "Unknown");
    appendValidationRow(body, "Normalized INR", validation.normalized_price_inr === null || validation.normalized_price_inr === undefined ? "Not applied" : formatInr(validation.normalized_price_inr));
    appendValidationRow(body, "Budget", validation.budget_inr === null || validation.budget_inr === undefined ? "Unknown" : formatInr(validation.budget_inr));

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

  function renderValidation(experiment) {
    clear(validationGrid);
    validationGrid.append(
      renderValidationCard(experiment, "baseline", "Baseline validation"),
      renderValidationCard(experiment, "protected", "Protected validation")
    );
  }

  function renderProducts(experiment) {
    clear(productsBody);
    const products = experiment.comparison ? experiment.comparison.products : [];
    if (!products.length) {
      const row = el("tr");
      const cell = el("td", "empty", "No product facts were available because the paired comparison was not created.");
      cell.colSpan = 6;
      row.append(cell);
      productsBody.append(row);
      return;
    }

    products.forEach((product) => {
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

  function renderSummary(experiment, httpStatus) {
    clear(summaryGrid);
    const comparison = experiment.comparison;
    addSummary(
      "Experiment",
      experiment.status === "complete" ? "Complete" : "Incomplete",
      `HTTP ${httpStatus} · ${experiment.pages.filter((page) => page.success).length}/3 sources extracted`
    );
    addSummary(
      "Observed outcome",
      comparison ? comparison.outcome : "Conditions not run",
      comparison ? `Model: ${comparison.model}` : "No paired comparison was produced"
    );
    addSummary(
      "Improvement observed",
      comparison ? boolText(comparison.improvement_observed) : "Not evaluated",
      comparison ? "Observed difference in this trial only" : "Extraction must succeed first"
    );
    addSummary(
      "Causation established",
      "No",
      "Single paired trial, not proof of general effectiveness"
    );
  }

  function renderBadges(experiment) {
    clear(badges);
    badges.append(badge(experiment.status === "complete" ? "Experiment complete" : "Incomplete", experiment.status === "complete" ? "success" : "warning"));
    if (experiment.comparison) {
      badges.append(badge(experiment.comparison.outcome, "warning"));
      badges.append(badge(experiment.comparison.improvement_observed ? "Improvement observed" : "No improvement observed", experiment.comparison.improvement_observed ? "success" : ""));
    }
    badges.append(badge("Single paired trial"));
  }

  function renderLimitations(experiment) {
    clear(limitationsList);
    const items = [];
    if (experiment.comparison) {
      experiment.comparison.uncertainty.forEach((item) => items.push(item));
    }
    items.push(
      "Extraction only proves that page text was captured; it does not prove the model obeyed an injected instruction.",
      "Heuristic detection can miss or over-flag instruction-like text and is not an attack-success score.",
      "Prices are compared only when the captured currency is INR. Foreign-currency prices remain unknown without an explicit verified conversion.",
      "A single paired trial does not establish causation or universal defence effectiveness.",
      "External webpages can change after capture; the saved snapshot is the evidence used for both conditions."
    );

    const unique = [...new Set(items)];
    unique.forEach((item) => limitationsList.append(el("li", "", item)));
  }

  function renderReports(reportUrls) {
    clear(reportLinks);
    if (!reportUrls || !Object.keys(reportUrls).length) {
      reportLinks.append(el("span", "panel-note", "No report files were returned."));
      return;
    }
    const order = ["experiment", "snapshot", "baseline", "protected", "comparison"];
    const keys = order.filter((key) => reportUrls[key]).concat(
      Object.keys(reportUrls).filter((key) => !order.includes(key))
    );
    keys.forEach((key) => {
      const url = reportUrls[key];
      if (typeof url !== "string" || !url.startsWith("/api/reports/")) return;
      const link = el("a", "report-link", REPORT_LABELS[key] || key);
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener";
      reportLinks.append(link);
    });
  }

  function renderExperiment(payload, httpStatus) {
    const experiment = payload.experiment;
    setHidden(results, false);
    setHidden(experimentError, true);

    const messages = [];
    if (experiment.error) messages.push(experiment.error);
    if (experiment.comparison && experiment.comparison.api_errors.length) {
      messages.push(...experiment.comparison.api_errors);
    }
    if (messages.length) {
      experimentError.textContent = messages.join(" ");
      setHidden(experimentError, false);
    }

    renderBadges(experiment);
    renderSummary(experiment, httpStatus);
    renderSources(experiment);
    renderDetection(experiment);
    renderResponses(experiment);
    renderValidation(experiment);
    renderProducts(experiment);
    renderLimitations(experiment);
    renderReports(payload.report_urls);
  }

  async function runExperiment(event) {
    event.preventDefault();
    formError.hidden = true;
    setHidden(results, true);
    setHidden(runStatus, false);
    runButton.disabled = true;
    runStatusText.textContent = "Extracting three sources, then running baseline and protected Gemma conditions…";

    const payload = {
      task: document.getElementById("task").value,
      urls: [
        document.getElementById("real-url-1").value,
        document.getElementById("real-url-2").value,
        document.getElementById("attack-url").value,
      ],
    };

    try {
      const response = await fetch("/api/experiment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      let data;
      try {
        data = await response.json();
      } catch (error) {
        throw new Error(`The server returned HTTP ${response.status} without a JSON report.`);
      }

      if (!response.ok && !data.experiment) {
        throw new Error(data.error || `Experiment request failed with HTTP ${response.status}.`);
      }

      renderExperiment(data, response.status);
      setHidden(runStatus, true);
      results.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      setHidden(runStatus, true);
      formError.textContent = error instanceof Error ? error.message : "The experiment could not be started.";
      formError.hidden = false;
    } finally {
      runButton.disabled = false;
    }
  }

  form.addEventListener("submit", runExperiment);
})();
