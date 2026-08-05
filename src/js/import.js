/**
 * import.js — Smore CSV financial-record import
 *
 * Reads a .csv file client-side, validates every row, shows a preview table,
 * then (on user confirmation) writes only the valid rows to Firestore under
 * users/{uid}/transactions.
 *
 * Validation rules mirror the Firestore security rules:
 *   - type      : "income" | "expense"          (required)
 *   - amount    : whole integer, 0–9,999,999,999 (required)
 *   - category  : non-empty, max 50 chars        (required)
 *   - description: max 300 chars                 (may be blank)
 *   - date      : parseable to a valid Date       (required)
 *
 * Duplicate prevention is session-scoped: the Submit button is disabled and
 * the file input is reset after a successful import so the same file cannot
 * be re-submitted without re-selecting it.
 */

import {
  collection,
  addDoc,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";
import { loadAnalytics } from "./analytics.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MAX_AMOUNT = 9_999_999_999;
const MAX_CAT    = 50;
const MAX_DESC   = 300;

/** Column names we accept (lower-cased). */
const REQUIRED_HEADERS = ["type", "amount", "category", "description", "date"];

// ---------------------------------------------------------------------------
// DOM references (elements added to dashboard.html)
// ---------------------------------------------------------------------------
const importFileInput    = document.getElementById("import-file-input");
const importParseBtn     = document.getElementById("import-parse-btn");
const importStatus       = document.getElementById("import-status");
const importPreviewWrap  = document.getElementById("import-preview-wrap");
const importPreviewBody  = document.getElementById("import-preview-body");
const importPreviewCount = document.getElementById("import-preview-count");
const importSubmitBtn    = document.getElementById("import-submit-btn");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Minimal HTML escape.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Show a status message in the import area.
 * @param {"error"|"success"|"info"} type
 * @param {string} message
 * @param {number} [autoDismiss] ms (0 = never)
 */
function showStatus(type, message, autoDismiss = 0) {
  importStatus.textContent = message;
  importStatus.className = `status-alert is-visible is-${type}`;
  importStatus.setAttribute("role", type === "error" ? "alert" : "status");
  if (autoDismiss > 0) setTimeout(clearStatus, autoDismiss);
}

function clearStatus() {
  importStatus.textContent = "";
  importStatus.className = "status-alert";
  importStatus.removeAttribute("role");
}

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

/**
 * Splits a single CSV line respecting double-quoted fields.
 * Handles embedded commas and escaped double-quotes ("").
 * @param {string} line
 * @returns {string[]}
 */
function parseCsvLine(line) {
  const fields = [];
  let cur      = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch   = line[i];
    const next = line[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
  }
  fields.push(cur.trim());
  return fields;
}

// ---------------------------------------------------------------------------
// Row validation
// ---------------------------------------------------------------------------

/**
 * Validates a single row object (keys already mapped to canonical header names).
 * @param {Record<string,string>} row
 * @returns {{ valid: boolean, errors: string[], data?: object }}
 */
function validateRow(row) {
  const errors = [];

  // type
  const type = (row.type || "").trim().toLowerCase();
  if (type !== "income" && type !== "expense") {
    errors.push(`Type must be "income" or "expense" (got "${escapeHtml(row.type || "")}")`);
  }

  // amount
  const rawAmount = (row.amount || "").trim();
  const amount    = parseInt(rawAmount, 10);
  if (
    !rawAmount ||
    isNaN(amount) ||
    amount < 0 ||
    amount > MAX_AMOUNT ||
    String(amount) !== rawAmount
  ) {
    errors.push(`Amount must be a whole number 0–${MAX_AMOUNT.toLocaleString("en-US")} (got "${escapeHtml(rawAmount)}")`);
  }

  // category
  const category = (row.category || "").trim();
  if (!category) {
    errors.push("Category is required.");
  } else if (category.length > MAX_CAT) {
    errors.push(`Category exceeds ${MAX_CAT} characters.`);
  }

  // description (optional, max 300)
  const description = (row.description || "").trim();
  if (description.length > MAX_DESC) {
    errors.push(`Description exceeds ${MAX_DESC} characters.`);
  }

  // date
  const rawDate = (row.date || "").trim();
  if (!rawDate) {
    errors.push("Date is required.");
  } else {
    // Accept YYYY-MM-DD as UTC midnight; fall back to generic Date parse.
    let dateObj;
    const isoMatch = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      dateObj = new Date(Date.UTC(
        Number(isoMatch[1]),
        Number(isoMatch[2]) - 1,
        Number(isoMatch[3])
      ));
    } else {
      dateObj = new Date(rawDate);
    }
    if (isNaN(dateObj.getTime())) {
      errors.push(`Date "${escapeHtml(rawDate)}" is not a valid date.`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Build the clean data object only when all fields pass.
  let dateObj;
  const isoMatch = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    dateObj = new Date(Date.UTC(
      Number(isoMatch[1]),
      Number(isoMatch[2]) - 1,
      Number(isoMatch[3])
    ));
  } else {
    dateObj = new Date(rawDate);
  }

  return {
    valid: true,
    errors: [],
    data: {
      type,
      amount,
      category,
      description,
      date: Timestamp.fromDate(dateObj),
    },
  };
}

// ---------------------------------------------------------------------------
// Preview rendering
// ---------------------------------------------------------------------------

/** Holds the validated row results after parsing. */
let parsedRows = [];

/**
 * Parses the selected CSV file and populates the preview table.
 */
function handleParse() {
  clearStatus();
  importPreviewWrap.classList.add("hidden");
  importSubmitBtn.classList.add("hidden");
  parsedRows = [];

  const file = importFileInput.files && importFileInput.files[0];
  if (!file) {
    showStatus("error", "Please select a CSV file first.");
    return;
  }
  if (!file.name.toLowerCase().endsWith(".csv")) {
    showStatus("error", "Only .csv files are supported.");
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result || "";
    processCSV(text);
  };
  reader.onerror = () => {
    showStatus("error", "Could not read the file. Please try again.");
  };
  reader.readAsText(file, "UTF-8");
}

/**
 * Processes raw CSV text: parses headers, validates rows, renders preview.
 * @param {string} text
 */
function processCSV(text) {
  // Normalise line endings and split.
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  // Drop trailing blank lines.
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }

  if (lines.length === 0) {
    showStatus("error", "The file is empty.");
    return;
  }

  // Parse header row.
  const rawHeaders = parseCsvLine(lines[0]).map((h) => h.toLowerCase());

  // Check required headers exist.
  const missing = REQUIRED_HEADERS.filter((h) => !rawHeaders.includes(h));
  if (missing.length > 0) {
    showStatus(
      "error",
      `Missing required column(s): ${missing.join(", ")}. ` +
        `Expected header: type,amount,category,description,date`
    );
    return;
  }

  if (lines.length < 2) {
    showStatus("error", "The file has a header row but no data rows.");
    return;
  }

  // Map each data row to a keyed object and validate.
  parsedRows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue; // skip blank lines in body

    const values = parseCsvLine(line);
    const rowObj = {};
    rawHeaders.forEach((header, idx) => {
      rowObj[header] = values[idx] !== undefined ? values[idx] : "";
    });

    const result = validateRow(rowObj);
    parsedRows.push({
      rowNum: i,           // 1-indexed (matches spreadsheet row; header = row 1)
      raw: rowObj,
      valid: result.valid,
      errors: result.errors,
      data: result.data,
    });
  }

  renderPreview(parsedRows);
}

/**
 * Renders the preview table.
 * @param {Array} rows
 */
function renderPreview(rows) {
  importPreviewBody.innerHTML = "";

  const validCount   = rows.filter((r) => r.valid).length;
  const invalidCount = rows.length - validCount;

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.className = row.valid ? "import-row-valid" : "import-row-invalid";

    const statusCell = row.valid
      ? `<span class="import-status-badge import-status-badge--valid">✓ Valid</span>`
      : `<span class="import-status-badge import-status-badge--invalid">✗ Invalid</span>`;

    const errCell = row.valid
      ? ""
      : `<ul class="import-error-list mb-0">${row.errors
          .map((e) => `<li>${e}</li>`)
          .join("")}</ul>`;

    const raw = row.raw;
    tr.innerHTML = `
      <td class="import-row-num">${row.rowNum + 1}</td>
      <td>${statusCell}${errCell}</td>
      <td>${escapeHtml(raw.type || "")}</td>
      <td>${escapeHtml(raw.amount || "")}</td>
      <td>${escapeHtml(raw.category || "")}</td>
      <td class="import-col-desc">${escapeHtml(raw.description || "")}</td>
      <td>${escapeHtml(raw.date || "")}</td>
    `;
    importPreviewBody.appendChild(tr);
  });

  // Summary line above the table.
  let summary = `${rows.length} row(s) parsed — ${validCount} valid`;
  if (invalidCount > 0) summary += `, ${invalidCount} invalid (will be skipped)`;
  importPreviewCount.textContent = summary;

  importPreviewWrap.classList.remove("hidden");

  if (validCount > 0) {
    importSubmitBtn.classList.remove("hidden");
    importSubmitBtn.disabled = false;
    importSubmitBtn.textContent = `Import ${validCount} Valid Row${validCount !== 1 ? "s" : ""}`;
  } else {
    importSubmitBtn.classList.add("hidden");
    showStatus("error", "No valid rows to import. Please fix your CSV and try again.");
  }
}

// ---------------------------------------------------------------------------
// Firestore write
// ---------------------------------------------------------------------------

/**
 * Writes all valid rows to Firestore and updates the UI on completion.
 */
async function handleImport() {
  const uid = auth.currentUser && auth.currentUser.uid;
  if (!uid) {
    showStatus("error", "You are not signed in. Please log in again.");
    return;
  }

  const validRows = parsedRows.filter((r) => r.valid);
  if (validRows.length === 0) {
    showStatus("error", "No valid rows to import.");
    return;
  }

  // Disable the submit button immediately to prevent duplicate submissions.
  importSubmitBtn.disabled  = true;
  importSubmitBtn.innerHTML = `
    <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
    <span>Importing...</span>
  `;
  clearStatus();

  try {
    const txnCol = collection(db, "users", uid, "transactions");

    // Write records sequentially to avoid overwhelming Firestore quotas.
    let savedCount = 0;
    for (const row of validRows) {
      await addDoc(txnCol, {
        ...row.data,
        createdAt: Timestamp.now(),
      });
      savedCount++;
    }

    showStatus(
      "success",
      `${savedCount} record${savedCount !== 1 ? "s" : ""} imported successfully.`,
      6000
    );

    // Prevent re-submission: disable button, reset file input, clear preview.
    importSubmitBtn.textContent = "Imported ✓";
    importSubmitBtn.disabled    = true;
    importFileInput.value       = "";
    parsedRows                  = [];

    // Reload analytics and transactions panels to reflect new data.
    await loadAnalytics();

    // Trigger transaction reload if initTransactions exposed a global refresh.
    const refreshTxnBtn = document.getElementById("txn-refresh-btn");
    if (refreshTxnBtn) refreshTxnBtn.click();

  } catch (err) {
    console.error("handleImport error:", err);
    showStatus("error", "Import failed. Please try again.");
    // Re-enable the button so the user can retry.
    importSubmitBtn.disabled    = false;
    importSubmitBtn.textContent = `Import ${validRows.length} Valid Row${validRows.length !== 1 ? "s" : ""}`;
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Initialises the CSV import panel.
 * Must be called once the authenticated user is confirmed.
 * @param {string} uid  Firebase Auth UID
 */
export function initImport(uid) {
  if (!uid) return;

  importParseBtn.addEventListener("click", handleParse);
  importSubmitBtn.addEventListener("click", handleImport);

  // Clicking the file input label resets the "Imported ✓" state so the user
  // can re-import after a successful import.
  importFileInput.addEventListener("change", () => {
    importPreviewWrap.classList.add("hidden");
    importSubmitBtn.classList.add("hidden");
    parsedRows = [];
    clearStatus();
  });
}
