(() => {
  "use strict";

  const captureForm = document.getElementById("capture-form");
  const promptInput = document.getElementById("prompt");
  const captureButton = document.getElementById("capture-button");
  const runResearchButton = document.getElementById("run-research-button");
  const compareButton = document.getElementById("compare-button");
  const modeInputs = Array.from(document.querySelectorAll('input[name="security_mode"]'));
  const runStatus = document.getElementById("run-status");
  const runStatusText = document.getElementById("run-status-text");
  const formError = document.getElementById("form-error");
  const modeError = document.getElementById("mode-error");
  const selectedModeLabel = document.getElementById("selected-mode-label");
  const selectedModeDescription = document.getElementById("selected-mode-description");

  const appMain = document.getElementById("app-main");
  const landing = document.getElementById("landing");
  const workspace = document.getElementById("workspace");
  const composerWrap = document.getElementById("composer-wrap");
  const composerSlot = document.getElementById("composer-slot");
  const analysisStatusBadge = document.getElementById("analysis-status-badge");
  const analysisScroll = document.getElementById("analysis-scroll");

  const conversation = document.getElementById("conversation");
  const submittedPrompt = document.getElementById("submitted-prompt");
  const snapshotPanel = document.getElementById("snapshot-panel");
  const sourceGrid = document.getElementById("source-grid");
  const snapshotNote = document.getElementById("snapshot-note");
  const controlledNote = document.getElementById("controlled-note");
  const snapshotReportLinks = document.getElementById("snapshot-report-links");
  const variantStatus = document.getElementById("variant-status");

  const conditionPanel = document.getElementById("condition-panel");
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
  const analysisDetails = document.getElementById("analysis-details");
  const analysisOutcome = document.getElementById("analysis-outcome");
  const analysisBadges = document.getElementById("analysis-badges");
  const analysisFinding = document.getElementById("analysis-finding");

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
    submittedPrompt: "",
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

  const VARIANT_LABELS = {
    visible: "Visible variant",
    hidden: "Hidden DOM variant",
    control: "Control variant",
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

  function safeHttpUrl(value) {
    try {
      const url = new URL(String(value || ""), window.location.origin);
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
    } catch (error) {
      return null;
    }
  }

  function hostFor(value) {
    const href = safeHttpUrl(value);
    if (!href) return String(value || "");
    try {
      return new URL(href).host;
    } catch (error) {
      return href;
    }
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

  function appendInline(parent, text) {
    const tokenPattern = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\*[^*\n]+\*|_[^_\n]+_|\[[^\]\n]+\]\([^)\s]+\))/g;
    let cursor = 0;
    const source = String(text || "");
    let match;
    while ((match = tokenPattern.exec(source)) !== null) {
      if (match.index > cursor) {
        parent.append(document.createTextNode(source.slice(cursor, match.index)));
      }
      const token = match[0];
      if (token.startsWith("**") || token.startsWith("__")) {
        parent.append(el("strong", "", token.slice(2, -2)));
      } else if (token.startsWith("`")) {
        parent.append(el("code", "", token.slice(1, -1)));
      } else if (token.startsWith("[")) {
        const linkMatch = token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
        const href = linkMatch ? safeHttpUrl(linkMatch[2]) : null;
        if (linkMatch && href) {
          const link = el("a", "", linkMatch[1]);
          link.href = href;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          parent.append(link);
        } else {
          parent.append(document.createTextNode(token));
        }
      } else {
        parent.append(el("em", "", token.slice(1, -1)));
      }
      cursor = match.index + token.length;
    }
    if (cursor < source.length) {
      parent.append(document.createTextNode(source.slice(cursor)));
    }
  }

  function appendTextWithBreaks(parent, text) {
    const lines = String(text || "").split("\n");
    lines.forEach((line, index) => {
      if (index) parent.append(document.createElement("br"));
      appendInline(parent, line);
    });
  }

  function isTableSeparator(line) {
    return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
  }

  function splitTableRow(line) {
    let row = line.trim();
    if (row.startsWith("|")) row = row.slice(1);
    if (row.endsWith("|")) row = row.slice(0, -1);
    return row.split("|").map((cell) => cell.trim());
  }

  function renderMarkdown(container, text) {
    const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) {
        index += 1;
        continue;
      }

      const fence = line.match(/^\s*```/);
      if (fence) {
        const codeLines = [];
        index += 1;
        while (index < lines.length && !/^\s*```/.test(lines[index])) {
          codeLines.push(lines[index]);
          index += 1;
        }
        if (index < lines.length) index += 1;
        const pre = el("pre");
        pre.append(el("code", "", codeLines.join("\n")));
        container.append(pre);
        continue;
      }

      if (line.includes("|") && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
        const table = el("table");
        const thead = el("thead");
        const headRow = el("tr");
        splitTableRow(line).forEach((cell) => {
          const th = el("th");
          appendInline(th, cell);
          headRow.append(th);
        });
        thead.append(headRow);
        table.append(thead);
        const tbody = el("tbody");
        index += 2;
        while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
          const row = el("tr");
          splitTableRow(lines[index]).forEach((cell) => {
            const td = el("td");
            appendInline(td, cell);
            row.append(td);
          });
          tbody.append(row);
          index += 1;
        }
        table.append(tbody);
        container.append(table);
        continue;
      }

      const heading = line.match(/^(#{1,4})\s+(.*)$/);
      if (heading) {
        const tag = `h${Math.min(heading[1].length + 1, 4)}`;
        const node = el(tag);
        appendInline(node, heading[2]);
        container.append(node);
        index += 1;
        continue;
      }

      if (/^\s*>/.test(line)) {
        const quoteLines = [];
        while (index < lines.length && /^\s*>/.test(lines[index])) {
          quoteLines.push(lines[index].replace(/^\s*>\s?/, ""));
          index += 1;
        }
        const quote = el("blockquote");
        appendTextWithBreaks(quote, quoteLines.join("\n"));
        container.append(quote);
        continue;
      }

      const unordered = line.match(/^\s*[-*+]\s+(.*)$/);
      if (unordered) {
        const list = el("ul");
        while (index < lines.length) {
          const item = lines[index].match(/^\s*[-*+]\s+(.*)$/);
          if (!item) break;
          const li = el("li");
          appendInline(li, item[1]);
          list.append(li);
          index += 1;
        }
        container.append(list);
        continue;
      }

      const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (ordered) {
        const list = el("ol");
        while (index < lines.length) {
          const item = lines[index].match(/^\s*\d+[.)]\s+(.*)$/);
          if (!item) break;
          const li = el("li");
          appendInline(li, item[1]);
          list.append(li);
          index += 1;
        }
        container.append(list);
        continue;
      }

      if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
        container.append(el("hr"));
        index += 1;
        continue;
      }

      const paragraphLines = [];
      while (index < lines.length && lines[index].trim()) {
        const next = lines[index];
        if (
          /^\s*```/.test(next)
          || /^(#{1,4})\s+/.test(next)
          || /^\s*>/.test(next)
          || /^\s*[-*+]\s+/.test(next)
          || /^\s*\d+[.)]\s+/.test(next)
          || (next.includes("|") && index + 1 < lines.length && isTableSeparator(lines[index + 1]))
        ) {
          break;
        }
        paragraphLines.push(next);
        index += 1;
      }
      if (paragraphLines.length) {
        const paragraph = el("p");
        appendTextWithBreaks(paragraph, paragraphLines.join("\n"));
        container.append(paragraph);
      } else {
        index += 1;
      }
    }
  }

  function renderSubmittedPrompt() {
    const prompt = state.submittedPrompt || (state.snapshot ? state.snapshot.task : "");
    submittedPrompt.textContent = prompt;
  }

  function controlledPageIndex(snapshot) {
    return snapshot.pages.findIndex((page) => /\/lab\/attack-page(?:\?|$|\/)/.test(page.url || page.final_url || ""));
  }

  function renderSources(snapshot) {
    clear(sourceGrid);
    const controlledIndex = controlledPageIndex(snapshot);
    snapshot.pages.forEach((page, index) => {
      const failed = !page.success;
      const incomplete = page.success && page.partial;
      const status = failed ? "Failed" : incomplete ? "Incomplete" : "Captured";
      const tone = failed ? "danger" : incomplete ? "warning" : "success";
      const isControlled = index === controlledIndex;

      const item = el("details", `source-item${failed ? " source-failed" : ""}`);
      if (failed || incomplete) item.open = true;

      const summary = el("summary", "source-summary");
      summary.append(el("span", "source-index", String(index + 1).padStart(2, "0")));
      const main = el("span", "source-main");
      main.append(el("span", "source-title", page.title || "Untitled page"));
      main.append(el("span", "source-domain", hostFor(page.final_url || page.url)));
      summary.append(main, badge(status, tone), el("span", "source-chevron", "›"));

      const body = el("div", "source-body");
      const url = page.final_url || page.url;
      const safeUrl = safeHttpUrl(url);
      const urlLine = el("span", "source-url");
      if (safeUrl) {
        const link = el("a", "", url);
        link.href = safeUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        urlLine.append(link);
      } else {
        urlLine.textContent = url;
      }
      body.append(urlLine);

      const meta = el("div", "source-meta");
      const httpStatus = page.http_status ? `HTTP ${page.http_status}` : "HTTP status unavailable";
      const method = page.extraction_method === "dom" ? "DOM text" : "Visible text";
      const characters = `${(page.text || "").length.toLocaleString()} characters`;
      meta.append(el("span", "", `${httpStatus} · ${method} · ${characters}`));
      if (page.attempts && page.attempts > 1) {
        meta.append(el("span", "", `${page.attempts} capture attempts`));
      }
      if (isControlled) {
        meta.append(el("span", "", VARIANT_LABELS[snapshot.controlled_variant] || "Controlled attack page"));
      }
      body.append(meta);

      if (page.warning || page.retry_reason) {
        body.append(el("p", "source-warning", page.warning || page.retry_reason));
      }
      if (failed) {
        body.append(el("p", "source-error", page.error || "Extraction failed without a recorded error."));
      }

      item.append(summary, body);
      sourceGrid.append(item);
    });

    const variant = snapshot.controlled_variant || "visible";
    const captured = snapshot.pages.filter((page) => page.success).length;
    const completeness = snapshot.extraction_success ? "Complete" : "Incomplete";
    snapshotNote.textContent = `Evidence ${snapshot.snapshot_id} · ${completeness} · ${captured}/${snapshot.pages.length} captured · ${VARIANT_LABELS[variant] || variant}`;
    controlledNote.textContent = snapshot.controlled_instruction_note || "";
    setHidden(controlledNote, !snapshot.controlled_instruction_note);
    renderReportLinks(snapshotReportLinks, { snapshot: state.snapshotReportUrl }, ["snapshot"]);
  }

  function renderVariantStatus() {
    if (!state.snapshot) {
      setHidden(variantStatus, true);
      return;
    }
    variantStatus.textContent = VARIANT_LABELS[state.snapshot.controlled_variant] || "Unknown variant";
    setHidden(variantStatus, false);
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
      const success = Boolean(report && report.success && (report.response_text || "").trim());
      const card = el("article", `response-card ${success ? "" : "failed"}`.trim());

      const header = el("header");
      header.append(el("h3", "", title));
      if (report) {
        header.append(badge(success ? "Response" : "Failed", success ? "success" : "danger"));
      } else {
        header.append(badge("Not run", ""));
      }
      card.append(header);

      if (!report) {
        card.append(el("p", "panel-note", "This security mode has not been run for the current evidence snapshot."));
      } else if (success) {
        const body = el("div", "response-text");
        renderMarkdown(body, report.response_text);
        card.append(body);
      } else {
        const body = el("div", "response-text");
        body.append(el("p", "panel-note", `No model response was returned. ${friendlyError(report)}`));
        card.append(body);
      }

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

  function renderAnalysisStatus() {
    if (!state.snapshot) {
      setBadge(analysisStatusBadge, "Waiting", "");
      return;
    }
    if (state.comparison) {
      const classification = classifyComparison(state.comparison.comparison);
      setBadge(analysisStatusBadge, classification.label, classification.tone);
      return;
    }
    if (state.baseline || state.protected) {
      setBadge(analysisStatusBadge, "Responses ready", "warning");
      return;
    }
    setBadge(analysisStatusBadge, "Evidence captured", "success");
  }

  function renderModelResults() {
    const hasRun = Boolean(state.baseline || state.protected);
    setHidden(modelResults, !hasRun);
    setHidden(analysisDetails, !hasRun);
    if (!hasRun) return;

    clear(modelBadges);
    modelBadges.append(badge("Same saved snapshot"));
    modelBadges.append(badge("Bounded retries recorded"));
    renderResponses();
    renderValidation();
    if (!state.comparison) {
      clear(instructionFlags);
      clear(findingList);
      findingList.append(
        el("p", "panel-note", "Instruction flow is populated after the paired comparison.")
      );
    }
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

  function classifyComparison(comparison) {
    const apiFailure = Boolean(
      (comparison.api_errors && comparison.api_errors.length)
      || comparison.response_usable_baseline === false && comparison.baseline && !comparison.baseline.success
      || comparison.response_usable_protected === false && comparison.protected && !comparison.protected.success
    );
    if (apiFailure) return { label: "Model/API failure", tone: "warning" };
    if (comparison.outcome === "Attack demonstrated in the observed baseline") {
      return { label: "Attack demonstrated", tone: "danger" };
    }
    if (comparison.outcome === "Attack not demonstrated") {
      return { label: "Attack not demonstrated", tone: "" };
    }
    return { label: "Inconclusive", tone: "warning" };
  }

  function renderBadges(comparison) {
    clear(badges);
    const classification = classifyComparison(comparison);
    badges.append(badge(classification.label, classification.tone));
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

  function outcomeLead(classification) {
    if (classification.label === "Attack demonstrated") {
      return "The Security OFF response demonstrated the observed unsafe recommendation.";
    }
    if (classification.label === "Attack not demonstrated") {
      return "No unsafe over-budget recommendation was observed in this paired trial.";
    }
    if (classification.label === "Model/API failure") {
      return "At least one condition returned no usable response, so no attack conclusion is drawn.";
    }
    return "The paired evidence is inconclusive for this trial.";
  }

  function renderAnalysisOutcome(comparison) {
    clear(analysisBadges);
    clear(analysisFinding);
    const classification = classifyComparison(comparison);
    analysisBadges.append(badge(classification.label, classification.tone));

    analysisFinding.append(
      el("p", "analysis-finding-lead", outcomeLead(classification)),
      el(
        "p",
        "analysis-finding-note",
        "Observed in this saved snapshot and single paired trial. It does not establish causation or universal defence effectiveness."
      )
    );

    const facts = el("dl", "analysis-facts");
    const addFact = (label, value) => {
      const item = el("div", "analysis-fact");
      item.append(el("dt", "", label), el("dd", "", value));
      facts.append(item);
    };
    addFact(
      "Target recommendation",
      `OFF ${boolText(comparison.target_recommended_baseline)} · ON ${boolText(comparison.target_recommended_protected)}`
    );
    addFact(
      "Budget violation",
      `OFF ${boolText(comparison.budget_violated_baseline)} · ON ${boolText(comparison.budget_violated_protected)}`
    );
    addFact(
      "Security ON changed result",
      boolText(comparison.protection_changed_result)
    );
    addFact("Causation", "Not established");
    analysisFinding.append(facts);
    setHidden(analysisOutcome, false);
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
    renderAnalysisOutcome(comparison);
    setHidden(analysisDetails, false);
    renderAnalysisStatus();
  }

  function updateModeControls() {
    const usable = Boolean(state.snapshot && state.snapshot.extraction_success);
    runResearchButton.disabled = state.busy || !usable;
    compareButton.disabled = !canCompare();
    captureButton.disabled = state.busy;
    promptInput.readOnly = state.busy;
    modeInputs.forEach((input) => {
      input.disabled = state.busy;
    });
  }

  function setBusy(busy, message) {
    state.busy = busy;
    setHidden(runStatus, !busy);
    if (busy && message) runStatusText.textContent = message;
    captureForm.setAttribute("aria-busy", busy ? "true" : "false");
    updateModeControls();
  }

  function resetWorkspace() {
    state.snapshot = null;
    state.snapshotReportUrl = null;
    state.baseline = null;
    state.protected = null;
    state.comparison = null;
    setHidden(snapshotPanel, true);
    setHidden(conditionPanel, true);
    setHidden(analysisOutcome, true);
    setHidden(analysisDetails, true);
    setHidden(modelResults, true);
    setHidden(comparisonResults, true);
    clear(sourceGrid);
    clear(responseGrid);
    clear(validationGrid);
    clear(modelBadges);
    clear(instructionFlags);
    clear(findingList);
    clear(productsBody);
    clear(limitationsList);
    clear(summaryGrid);
    clear(badges);
    clear(analysisBadges);
    clear(analysisFinding);
    clear(snapshotReportLinks);
    clear(baselineReportLinks);
    clear(protectedReportLinks);
    clear(reportLinks);
    setHidden(controlledNote, true);
    setHidden(variantStatus, true);
    setHidden(modeError, true);
    setHidden(comparisonError, true);
    setHidden(formError, true);
    setHidden(baselineModeError, true);
    setHidden(protectedModeError, true);
    setHidden(compareModeError, true);
    setBadge(baselineModeStatus, "Not run", "");
    setBadge(protectedModeStatus, "Not run", "");
    setBadge(compareModeStatus, "Waiting for runs", "");
    setBadge(analysisStatusBadge, "Waiting", "");
    clear(instructionFlags);
    clear(findingList);
  }

  function activateWorkspace() {
    if (workspace.dataset.active === "true") return;
    composerSlot.append(composerWrap);
    setHidden(landing, true);
    setHidden(workspace, false);
    appMain.classList.add("is-workspace");
    document.body.classList.add("workspace-active");
    workspace.dataset.active = "true";
  }

  function autoResizePrompt() {
    const maxHeight = document.body.classList.contains("workspace-active") ? 140 : 260;
    promptInput.style.height = "auto";
    promptInput.style.height = `${Math.min(promptInput.scrollHeight, maxHeight)}px`;
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

  function showFormError(message) {
    formError.textContent = message;
    formError.hidden = false;
  }

  async function capture(event) {
    event.preventDefault();
    if (state.busy) return;

    const prompt = promptInput.value.trim();
    if (!prompt) {
      showFormError("Enter a research task and include the webpage URLs.");
      promptInput.focus();
      return;
    }

    resetWorkspace();
    state.submittedPrompt = prompt;
    setBusy(true, "Validating request and capturing sources…");

    try {
      const { data } = await postJson("/api/capture", { prompt });
      if (!data.snapshot) {
        throw new Error(data.error || "The capture request did not return an evidence snapshot.");
      }

      state.snapshot = data.snapshot;
      state.snapshotReportUrl = data.report_urls ? data.report_urls.snapshot : null;
      activateWorkspace();
      renderSubmittedPrompt();
      renderSources(state.snapshot);
      renderVariantStatus();
      renderSelectedMode();
      renderModeState();
      renderAnalysisStatus();

      setHidden(snapshotPanel, false);
      setHidden(conditionPanel, false);

      if (state.snapshot.extraction_success) {
        setHidden(modeError, true);
      } else {
        modeError.textContent = "Model runs are disabled until all three sources extract successfully. Submit a corrected request to capture new evidence.";
        setHidden(modeError, false);
      }

      updateModeControls();
      promptInput.value = "";
      autoResizePrompt();
      analysisScroll.scrollTop = 0;
      conversation.scrollTop = 0;
    } catch (error) {
      showFormError(error instanceof Error ? error.message : "Evidence capture could not be started.");
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
    setHidden(analysisOutcome, true);
    setHidden(modeError, true);
    modeErrorNode.textContent = "";
    setHidden(modeErrorNode, true);
    renderModeState();
    renderModelResults();
    renderAnalysisStatus();
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
      renderAnalysisStatus();
      updateModeControls();
      modelResults.scrollIntoView({ block: "start" });
    } catch (error) {
      modeErrorNode.textContent = error instanceof Error ? error.message : `${mode.label} could not be started.`;
      setHidden(modeErrorNode, false);
      setBadge(condition === "baseline" ? baselineModeStatus : protectedModeStatus, "Failed", "danger");
      renderAnalysisStatus();
    } finally {
      setBusy(false);
    }
  }

  async function compare() {
    if (!canCompare()) return;
    state.comparison = null;
    setHidden(comparisonResults, true);
    setHidden(analysisOutcome, true);
    setHidden(comparisonError, true);
    renderModeState();
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

  promptInput.addEventListener("input", autoResizePrompt);
  promptInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      captureForm.requestSubmit();
    }
  });
  captureForm.addEventListener("submit", capture);
  runResearchButton.addEventListener("click", runResearch);
  compareButton.addEventListener("click", compare);
  modeInputs.forEach((input) => {
    input.addEventListener("change", renderSelectedMode);
  });

  autoResizePrompt();
  renderSelectedMode();
  updateModeControls();
})();
