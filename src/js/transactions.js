/**
 * transactions.js — Smore transaction CRUD
 *
 * All Firestore reads/writes use the authenticated user's own UID, sourced
 * from auth.currentUser.uid. No user-supplied UID is ever interpolated into a
 * document path; the Firestore security rules enforce the same constraint.
 */

import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  doc,
  query,
  orderBy,
  where,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";

// ---------------------------------------------------------------------------
// DOM references (all exist in dashboard.html)
// ---------------------------------------------------------------------------
const txnList       = document.getElementById("txn-list");
const txnLoading    = document.getElementById("txn-loading");
const txnEmpty      = document.getElementById("txn-empty");
const txnStatus     = document.getElementById("txn-status");

const addTxnBtn     = document.getElementById("add-txn-btn");
const refreshBtn    = document.getElementById("txn-refresh-btn");
const filterBtns    = document.querySelectorAll(".txn-filter-btn");

// Modal form elements
const txnModal      = document.getElementById("txnModal");
const txnForm       = document.getElementById("txn-form");
const txnEditId     = document.getElementById("txn-edit-id");
const txnModalTitle = document.getElementById("txnModalLabel");
const txnSubmitBtn  = document.getElementById("txn-submit-btn");

const fldType        = document.getElementById("txn-type");
const fldAmount      = document.getElementById("txn-amount");
const fldCategory    = document.getElementById("txn-category");
const fldDescription = document.getElementById("txn-description");
const fldDate        = document.getElementById("txn-date");

// Delete confirm modal
const deleteTxnModal    = document.getElementById("deleteTxnModal");
const deleteConfirmBtn  = document.getElementById("delete-confirm-btn");

// Summary stat elements (live)
const statBalance  = document.getElementById("stat-balance");
const statSpent    = document.getElementById("stat-spent");
const statIncome   = document.getElementById("stat-income");

// Bootstrap Modal instances (initialised after DOM ready)
let bsModal       = null;
let bsDeleteModal = null;

// Active filter state: "all" | "income" | "expense"
let activeFilter = "all";

// ID queued for deletion
let pendingDeleteId = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Formats a whole-number MMK amount with thousands separators.
 * @param {number} n
 * @returns {string}
 */
function formatMMK(n) {
  return Number(n).toLocaleString("en-US") + " MMK";
}

/**
 * Converts a Firestore Timestamp or ISO string to a short human date.
 * @param {import("firebase/firestore").Timestamp | string} ts
 * @returns {string}
 */
function formatDate(ts) {
  let d;
  if (ts && typeof ts.toDate === "function") {
    d = ts.toDate();
  } else if (typeof ts === "string") {
    d = new Date(ts);
  } else {
    return "Unknown date";
  }
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/**
 * Shows a status message in the transactions area.
 * @param {"error" | "success" | "info"} type
 * @param {string} message
 * @param {number} [autoDismiss] ms before auto-hide; 0 = never
 */
function showStatus(type, message, autoDismiss = 0) {
  txnStatus.textContent = message;
  txnStatus.className = `status-alert is-visible is-${type}`;
  txnStatus.setAttribute("role", type === "error" ? "alert" : "status");
  if (autoDismiss > 0) {
    setTimeout(clearStatus, autoDismiss);
  }
}

function clearStatus() {
  txnStatus.textContent = "";
  txnStatus.className = "status-alert";
  txnStatus.removeAttribute("role");
}

/**
 * Puts a submit button into loading / idle state.
 * @param {HTMLButtonElement} btn
 * @param {boolean} isLoading
 * @param {string} idleLabel
 */
function setButtonLoading(btn, isLoading, idleLabel) {
  btn.disabled = isLoading;
  btn.classList.toggle("btn-loading", isLoading);
  if (isLoading) {
    btn.innerHTML = `
      <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
      <span>Saving...</span>
    `;
  } else {
    btn.textContent = idleLabel;
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const MAX_AMOUNT   = 9_999_999_999;
const MAX_CAT      = 50;
const MAX_DESC     = 300;

/**
 * Marks a form field invalid and shows a message.
 * @param {HTMLElement} el
 * @param {string} msg
 */
function setFieldError(el, msg) {
  el.classList.add("is-invalid");
  const fb = el.nextElementSibling;
  if (fb && fb.classList.contains("invalid-feedback")) {
    fb.textContent = msg;
  }
}

function clearFieldErrors() {
  txnForm.querySelectorAll(".is-invalid").forEach((el) => el.classList.remove("is-invalid"));
  txnForm.querySelectorAll(".invalid-feedback").forEach((el) => { el.textContent = ""; });
}

/**
 * Validates the transaction form.
 * @returns {{ valid: boolean, data?: object }}
 */
function validateForm() {
  clearFieldErrors();
  let valid = true;

  const type = fldType.value;
  if (type !== "income" && type !== "expense") {
    setFieldError(fldType, "Please select income or expense.");
    valid = false;
  }

  const rawAmount = fldAmount.value.trim();
  const amount = parseInt(rawAmount, 10);
  if (!rawAmount || isNaN(amount) || amount < 0 || amount > MAX_AMOUNT || String(amount) !== rawAmount) {
    setFieldError(fldAmount, `Enter a whole number between 0 and ${MAX_AMOUNT.toLocaleString("en-US")}.`);
    valid = false;
  }

  const category = fldCategory.value.trim();
  if (!category) {
    setFieldError(fldCategory, "Category is required.");
    valid = false;
  } else if (category.length > MAX_CAT) {
    setFieldError(fldCategory, `Category must be ${MAX_CAT} characters or fewer.`);
    valid = false;
  }

  const description = fldDescription.value.trim();
  if (description.length > MAX_DESC) {
    setFieldError(fldDescription, `Description must be ${MAX_DESC} characters or fewer.`);
    valid = false;
  }

  const dateVal = fldDate.value; // "YYYY-MM-DD"
  if (!dateVal) {
    setFieldError(fldDate, "Date is required.");
    valid = false;
  }

  if (!valid) return { valid: false };

  // Convert local date string to a Firestore Timestamp (midnight UTC of that date).
  const [y, m, d] = dateVal.split("-").map(Number);
  const dateObj = new Date(Date.UTC(y, m - 1, d));
  const dateTimestamp = Timestamp.fromDate(dateObj);

  return {
    valid: true,
    data: {
      type,
      amount,
      category,
      description,
      date: dateTimestamp,
    },
  };
}

// ---------------------------------------------------------------------------
// Summary stats
// ---------------------------------------------------------------------------

/**
 * Recomputes and renders balance / spent / income tiles from a snapshot array.
 * @param {Array<{type: string, amount: number}>} items
 */
function renderStats(items) {
  let totalIncome  = 0;
  let totalExpense = 0;

  // Only count current month for "spent this month"
  const now    = new Date();
  const curYear  = now.getFullYear();
  const curMonth = now.getMonth();

  let spentThisMonth = 0;

  for (const item of items) {
    const amt = item.amount || 0;
    if (item.type === "income") {
      totalIncome += amt;
    } else if (item.type === "expense") {
      totalExpense += amt;
      // Check if the date falls in the current month
      let d;
      if (item.date && typeof item.date.toDate === "function") {
        d = item.date.toDate();
      } else if (typeof item.date === "string") {
        d = new Date(item.date);
      }
      if (d && d.getFullYear() === curYear && d.getMonth() === curMonth) {
        spentThisMonth += amt;
      }
    }
  }

  const balance = totalIncome - totalExpense;

  statBalance.textContent = formatMMK(balance);
  statSpent.textContent   = formatMMK(spentThisMonth);
  statIncome.textContent  = formatMMK(totalIncome);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Builds an article card element for a transaction document.
 * @param {string} id  Firestore document ID
 * @param {object} data  Document fields
 * @returns {HTMLElement}
 */
function buildCard(id, data) {
  const isIncome = data.type === "income";

  const card = document.createElement("article");
  card.className = `txn-card txn-card--${data.type}`;
  card.dataset.id = id;

  const dateStr = formatDate(data.date);
  const amountStr = formatMMK(data.amount);
  const desc = data.description ? data.description : "";

  card.innerHTML = `
    <div class="txn-card-body">
      <div class="txn-card-left">
        <span class="txn-badge txn-badge--${data.type}">${isIncome ? "Income" : "Expense"}</span>
        <span class="txn-category">${escapeHtml(data.category)}</span>
      </div>
      <div class="txn-card-right">
        <span class="txn-amount txn-amount--${data.type}">${isIncome ? "+" : "−"}${amountStr}</span>
        <span class="txn-date">${dateStr}</span>
      </div>
    </div>
    ${desc ? `<p class="txn-desc">${escapeHtml(desc)}</p>` : ""}
    <div class="txn-card-actions">
      <button
        class="btn btn-sm btn-outline-secondary txn-edit-btn"
        data-id="${id}"
        aria-label="Edit transaction: ${escapeHtml(data.category)}"
      >Edit</button>
      <button
        class="btn btn-sm btn-outline-danger txn-delete-btn"
        data-id="${id}"
        aria-label="Delete transaction: ${escapeHtml(data.category)}"
      >Delete</button>
    </div>
  `;

  // Wire edit button
  card.querySelector(".txn-edit-btn").addEventListener("click", () => {
    openEditModal(id, data);
  });

  // Wire delete button
  card.querySelector(".txn-delete-btn").addEventListener("click", () => {
    pendingDeleteId = id;
    bsDeleteModal.show();
  });

  return card;
}

/**
 * Minimal HTML escape to prevent XSS in card content.
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

// ---------------------------------------------------------------------------
// Load transactions
// ---------------------------------------------------------------------------

/**
 * Fetches and renders the transaction list.
 * @param {"all" | "income" | "expense"} filter
 */
async function loadTransactions(filter) {
  const uid = auth.currentUser && auth.currentUser.uid;
  if (!uid) return;

  // Show spinner, hide list & empty state
  txnLoading.classList.remove("hidden");
  txnList.classList.add("hidden");
  txnEmpty.classList.add("hidden");
  clearStatus();

  try {
    const txnCol = collection(db, "users", uid, "transactions");

    let q;
    if (filter === "income" || filter === "expense") {
      q = query(txnCol, where("type", "==", filter), orderBy("date", "desc"));
    } else {
      q = query(txnCol, orderBy("date", "desc"));
    }

    const snapshot = await getDocs(q);

    // Build stats from the full (unfiltered) set when filter = all; otherwise
    // fetch all anyway so stats always reflect the real totals.
    let allItems = [];
    if (filter === "all") {
      snapshot.forEach((d) => allItems.push(d.data()));
    } else {
      // Fetch unfiltered for stats only (lightweight — same query minus where)
      const allSnap = await getDocs(query(txnCol, orderBy("date", "desc")));
      allSnap.forEach((d) => allItems.push(d.data()));
    }
    renderStats(allItems);

    // Clear existing cards
    txnList.innerHTML = "";

    if (snapshot.empty) {
      txnLoading.classList.add("hidden");
      txnEmpty.classList.remove("hidden");
      return;
    }

    snapshot.forEach((docSnap) => {
      txnList.appendChild(buildCard(docSnap.id, docSnap.data()));
    });

    txnLoading.classList.add("hidden");
    txnList.classList.remove("hidden");

  } catch (err) {
    console.error("loadTransactions error:", err);
    txnLoading.classList.add("hidden");
    txnEmpty.classList.remove("hidden");
    showStatus("error", "Could not load transactions. Please refresh.");
  }
}

// ---------------------------------------------------------------------------
// Modal helpers
// ---------------------------------------------------------------------------

/** Resets the form to a blank "Add" state. */
function openAddModal() {
  txnForm.reset();
  clearFieldErrors();
  txnEditId.value = "";
  txnModalTitle.textContent = "Add Transaction";
  txnSubmitBtn.textContent = "Add Transaction";

  // Default date to today (local)
  const today = new Date();
  const yyyy  = today.getFullYear();
  const mm    = String(today.getMonth() + 1).padStart(2, "0");
  const dd    = String(today.getDate()).padStart(2, "0");
  fldDate.value = `${yyyy}-${mm}-${dd}`;

  bsModal.show();
}

/**
 * Populates the form for editing an existing transaction.
 * @param {string} id  Firestore document ID
 * @param {object} data  Document fields
 */
function openEditModal(id, data) {
  txnForm.reset();
  clearFieldErrors();
  txnEditId.value = id;
  txnModalTitle.textContent = "Edit Transaction";
  txnSubmitBtn.textContent = "Save Changes";

  fldType.value        = data.type || "expense";
  fldAmount.value      = String(data.amount || 0);
  fldCategory.value    = data.category || "";
  fldDescription.value = data.description || "";

  // Restore date field from Firestore Timestamp
  if (data.date && typeof data.date.toDate === "function") {
    const d    = data.date.toDate();
    const yyyy = d.getUTCFullYear();
    const mm   = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd2  = String(d.getUTCDate()).padStart(2, "0");
    fldDate.value = `${yyyy}-${mm}-${dd2}`;
  }

  bsModal.show();
}

// ---------------------------------------------------------------------------
// Form submit — Add or Edit
// ---------------------------------------------------------------------------

async function handleFormSubmit(event) {
  event.preventDefault();

  const { valid, data } = validateForm();
  if (!valid) {
    showStatus("error", "Please fix the highlighted fields.");
    return;
  }

  const uid = auth.currentUser && auth.currentUser.uid;
  if (!uid) {
    showStatus("error", "You are not signed in. Please log in again.");
    return;
  }

  setButtonLoading(txnSubmitBtn, true, txnEditId.value ? "Save Changes" : "Add Transaction");

  try {
    const txnCol = collection(db, "users", uid, "transactions");
    const editId = txnEditId.value;

    if (editId) {
      // Update existing document
      const docRef = doc(db, "users", uid, "transactions", editId);
      await updateDoc(docRef, {
        type:        data.type,
        amount:      data.amount,
        category:    data.category,
        description: data.description,
        date:        data.date,
      });
      showStatus("success", "Transaction updated.", 3000);
    } else {
      // Create new document
      await addDoc(txnCol, {
        type:        data.type,
        amount:      data.amount,
        category:    data.category,
        description: data.description,
        date:        data.date,
        createdAt:   Timestamp.now(),
      });
      showStatus("success", "Transaction added.", 3000);
    }

    bsModal.hide();
    await loadTransactions(activeFilter);

  } catch (err) {
    console.error("handleFormSubmit error:", err);
    showStatus("error", "Could not save transaction. Please try again.");
  } finally {
    setButtonLoading(txnSubmitBtn, false, txnEditId.value ? "Save Changes" : "Add Transaction");
  }
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

async function handleDeleteConfirm() {
  if (!pendingDeleteId) return;

  const uid = auth.currentUser && auth.currentUser.uid;
  if (!uid) {
    showStatus("error", "You are not signed in. Please log in again.");
    bsDeleteModal.hide();
    return;
  }

  deleteConfirmBtn.disabled = true;
  deleteConfirmBtn.textContent = "Deleting...";

  try {
    const docRef = doc(db, "users", uid, "transactions", pendingDeleteId);
    await deleteDoc(docRef);

    bsDeleteModal.hide();
    showStatus("success", "Transaction deleted.", 3000);
    await loadTransactions(activeFilter);

  } catch (err) {
    console.error("handleDeleteConfirm error:", err);
    bsDeleteModal.hide();
    showStatus("error", "Could not delete transaction. Please try again.");
  } finally {
    pendingDeleteId = null;
    deleteConfirmBtn.disabled = false;
    deleteConfirmBtn.textContent = "Delete";
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Initialises the transactions panel.
 * Must be called once the authenticated user is confirmed.
 * @param {string} uid  Firebase Auth UID (from onAuthStateChanged callback)
 */
export function initTransactions(uid) {
  if (!uid) return;

  // Initialise Bootstrap Modal instances
  bsModal       = new bootstrap.Modal(txnModal);
  bsDeleteModal = new bootstrap.Modal(deleteTxnModal);

  // Button events
  addTxnBtn.addEventListener("click", openAddModal);
  refreshBtn.addEventListener("click", () => loadTransactions(activeFilter));

  // Filter tabs
  filterBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      filterBtns.forEach((b) => {
        b.classList.remove("is-active");
        b.setAttribute("aria-selected", "false");
      });
      btn.classList.add("is-active");
      btn.setAttribute("aria-selected", "true");
      activeFilter = btn.dataset.filter;
      loadTransactions(activeFilter);
    });
  });

  // Form submit
  txnForm.addEventListener("submit", handleFormSubmit);

  // Delete confirm
  deleteConfirmBtn.addEventListener("click", handleDeleteConfirm);

  // Reset pending delete when delete modal is closed without confirming
  deleteTxnModal.addEventListener("hidden.bs.modal", () => {
    pendingDeleteId = null;
  });

  // Initial load
  loadTransactions("all");
}
