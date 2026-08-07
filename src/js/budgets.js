import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";
import { subscribeToStore } from "./store.js";

// DOM references
const budgetList       = document.getElementById("budget-list");
const budgetLoading    = document.getElementById("budget-loading");
const budgetEmpty      = document.getElementById("budget-empty");
const budgetStatus     = document.getElementById("budget-status");

const addBudgetBtn     = document.getElementById("add-budget-btn");

const budgetModal      = document.getElementById("budgetModal");
const budgetForm       = document.getElementById("budget-form");
const budgetEditId     = document.getElementById("budget-edit-id");
const budgetModalTitle = document.getElementById("budgetModalLabel");
const budgetSubmitBtn  = document.getElementById("budget-submit-btn");

const fldCategory      = document.getElementById("budget-category");
const fldLimit         = document.getElementById("budget-limit");
const fldPeriod        = document.getElementById("budget-period");

const deleteBudgetModal   = document.getElementById("deleteBudgetModal");
const deleteConfirmBtn    = document.getElementById("delete-budget-confirm-btn");

let bsModal       = null;
let bsDeleteModal = null;
let pendingDeleteId = null;

let currentBudgets = [];
let currentTxns = [];
let isLoading = true;
let isError = false;

const MAX_AMOUNT = 9999999999;
const MAX_CAT    = 50;

function formatMMK(n) {
  return Number(n).toLocaleString("en-US") + " MMK";
}

function showStatus(type, message, autoDismiss = 0) {
  budgetStatus.textContent = message;
  budgetStatus.className = `status-alert is-visible is-${type}`;
  budgetStatus.setAttribute("role", type === "error" ? "alert" : "status");
  if (autoDismiss > 0) setTimeout(clearStatus, autoDismiss);
}

function clearStatus() {
  budgetStatus.textContent = "";
  budgetStatus.className = "status-alert";
  budgetStatus.removeAttribute("role");
}

function setButtonLoading(btn, isLoading, idleLabel) {
  btn.disabled = isLoading;
  btn.classList.toggle("btn-loading", isLoading);
  if (isLoading) {
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span><span>Saving...</span>`;
  } else {
    btn.textContent = idleLabel;
  }
}

function setFieldError(el, msg) {
  el.classList.add("is-invalid");
  const fb = el.nextElementSibling;
  if (fb && fb.classList.contains("invalid-feedback")) fb.textContent = msg;
}

function clearFieldErrors() {
  budgetForm.querySelectorAll(".is-invalid").forEach(el => el.classList.remove("is-invalid"));
  budgetForm.querySelectorAll(".invalid-feedback").forEach(el => el.textContent = "");
}

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function validateForm() {
  clearFieldErrors();
  let valid = true;

  const category = fldCategory.value.trim();
  if (!category) {
    setFieldError(fldCategory, "Category is required.");
    valid = false;
  } else if (category.length > MAX_CAT) {
    setFieldError(fldCategory, `Category must be ${MAX_CAT} characters or fewer.`);
    valid = false;
  }

  const rawAmount = fldLimit.value.trim();
  const limit = parseInt(rawAmount, 10);
  if (!rawAmount || isNaN(limit) || limit < 0 || limit > MAX_AMOUNT || String(limit) !== rawAmount) {
    setFieldError(fldLimit, `Enter a whole number between 0 and ${MAX_AMOUNT.toLocaleString("en-US")}.`);
    valid = false;
  }

  const period = fldPeriod.value;
  if (period !== "monthly" && period !== "yearly") {
    setFieldError(fldPeriod, "Please select monthly or yearly.");
    valid = false;
  }

  return { valid, data: { category, limit, period } };
}

function buildCard(id, data, spent) {
  const card = document.createElement("article");
  card.className = "txn-card";
  card.dataset.id = id;

  const pct = data.limit > 0 ? (spent / data.limit) * 100 : 0;
  const progressPct = Math.min(pct, 100);
  let progressColor = "bg-primary";
  if (pct >= 100) progressColor = "bg-danger";
  else if (pct >= 80) progressColor = "bg-warning";

  let statusText = `${formatMMK(spent)} of ${formatMMK(data.limit)}`;
  let remainingText = `${formatMMK(Math.max(0, data.limit - spent))} remaining`;
  if (pct > 100) {
    remainingText = `${formatMMK(spent - data.limit)} exceeded`;
  }

  card.innerHTML = `
    <div class="txn-card-body">
      <div class="txn-card-left" style="width: 100%;">
        <div class="d-flex justify-content-between w-100 align-items-center mb-2">
          <div>
            <span class="txn-category">${escapeHtml(data.category)}</span>
            <span class="txn-badge mx-2" style="background:#eef2ff;color:#3157d5;">${data.period === 'yearly' ? 'Yearly' : 'Monthly'}</span>
          </div>
          <div class="text-end">
            <span class="txn-amount" style="font-size: 0.9rem;">${statusText}</span>
          </div>
        </div>
        <div class="progress w-100" style="height: 8px;">
          <div class="progress-bar ${progressColor}" role="progressbar" style="width: ${progressPct}%" aria-valuenow="${spent}" aria-valuemin="0" aria-valuemax="${data.limit}"></div>
        </div>
        <div class="d-flex justify-content-between w-100 mt-2">
          <small class="${pct >= 100 ? 'text-danger fw-bold' : (pct >= 80 ? 'text-warning fw-bold' : 'text-muted')}">${pct.toFixed(1)}%</small>
          <small class="text-muted">${remainingText}</small>
        </div>
      </div>
    </div>
    <div class="txn-card-actions">
      <button class="btn btn-sm btn-outline-secondary budget-edit-btn" data-id="${id}">Edit</button>
      <button class="btn btn-sm btn-outline-danger budget-delete-btn" data-id="${id}">Delete</button>
    </div>
  `;

  card.querySelector(".budget-edit-btn").addEventListener("click", () => openEditModal(id, data));
  card.querySelector(".budget-delete-btn").addEventListener("click", () => {
    pendingDeleteId = id;
    bsDeleteModal.show();
  });

  return card;
}

function renderBudgets() {
  if (isLoading) {
    budgetLoading.classList.remove("hidden");
    budgetList.classList.add("hidden");
    budgetEmpty.classList.add("hidden");
    clearStatus();
    return;
  }

  budgetLoading.classList.add("hidden");

  if (isError) {
    budgetList.classList.add("hidden");
    budgetEmpty.classList.add("hidden");
    showStatus("error", "Could not load budgets. Please check your connection.");
    return;
  }

  budgetList.innerHTML = "";

  if (currentBudgets.length === 0) {
    budgetEmpty.classList.remove("hidden");
    budgetList.classList.add("hidden");
    return;
  }

  const expenses = currentTxns.filter(t => t.type === "expense");
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth();

  currentBudgets.forEach((data) => {
    let spent = 0;
    
    expenses.forEach(exp => {
      if (exp.category === data.category) {
        const d = (exp.date && typeof exp.date.toDate === "function") ? exp.date.toDate() : new Date(exp.date);
        if (data.period === 'monthly') {
          if (d.getFullYear() === curYear && d.getMonth() === curMonth) spent += exp.amount;
        } else if (data.period === 'yearly') {
          if (d.getFullYear() === curYear) spent += exp.amount;
        }
      }
    });

    budgetList.appendChild(buildCard(data.id, data, spent));
  });

  budgetEmpty.classList.add("hidden");
  budgetList.classList.remove("hidden");
}

function openAddModal() {
  budgetForm.reset();
  clearFieldErrors();
  budgetEditId.value = "";
  budgetModalTitle.textContent = "Add Budget";
  budgetSubmitBtn.textContent = "Add Budget";
  bsModal.show();
}

function openEditModal(id, data) {
  budgetForm.reset();
  clearFieldErrors();
  budgetEditId.value = id;
  budgetModalTitle.textContent = "Edit Budget";
  budgetSubmitBtn.textContent = "Save Changes";
  
  fldCategory.value = data.category || "";
  fldLimit.value = String(data.limit || 0);
  fldPeriod.value = data.period || "monthly";
  
  bsModal.show();
}

async function handleFormSubmit(event) {
  event.preventDefault();
  const { valid, data } = validateForm();
  if (!valid) {
    showStatus("error", "Please fix the highlighted fields.");
    return;
  }

  const uid = auth.currentUser && auth.currentUser.uid;
  if (!uid) return;

  setButtonLoading(budgetSubmitBtn, true, budgetEditId.value ? "Save Changes" : "Add Budget");

  try {
    const colRef = collection(db, "users", uid, "budgets");
    const editId = budgetEditId.value;

    if (editId) {
      await updateDoc(doc(db, "users", uid, "budgets", editId), data);
      showStatus("success", "Budget updated.", 3000);
    } else {
      await addDoc(colRef, {
        ...data,
        createdAt: Timestamp.now(),
      });
      showStatus("success", "Budget added.", 3000);
    }

    bsModal.hide();
  } catch (err) {
    console.error(err);
    showStatus("error", "Could not save budget.");
  } finally {
    setButtonLoading(budgetSubmitBtn, false, budgetEditId.value ? "Save Changes" : "Add Budget");
  }
}

async function handleDeleteConfirm() {
  if (!pendingDeleteId) return;
  const uid = auth.currentUser && auth.currentUser.uid;
  if (!uid) return;

  deleteConfirmBtn.disabled = true;
  deleteConfirmBtn.textContent = "Deleting...";

  try {
    await deleteDoc(doc(db, "users", uid, "budgets", pendingDeleteId));
    bsDeleteModal.hide();
    showStatus("success", "Budget deleted.", 3000);
  } catch (err) {
    console.error(err);
    bsDeleteModal.hide();
    showStatus("error", "Could not delete budget.");
  } finally {
    pendingDeleteId = null;
    deleteConfirmBtn.disabled = false;
    deleteConfirmBtn.textContent = "Delete";
  }
}

export function initBudgets(uid) {
  if (!uid) return;
  bsModal = new bootstrap.Modal(budgetModal);
  bsDeleteModal = new bootstrap.Modal(deleteBudgetModal);

  addBudgetBtn.addEventListener("click", openAddModal);
  budgetForm.addEventListener("submit", handleFormSubmit);
  deleteConfirmBtn.addEventListener("click", handleDeleteConfirm);
  deleteBudgetModal.addEventListener("hidden.bs.modal", () => pendingDeleteId = null);

  subscribeToStore((store) => {
    currentBudgets = store.budgets;
    currentTxns = store.transactions;
    isLoading = store.loading.budgets || store.loading.transactions;
    isError = store.error.budgets || store.error.transactions;
    renderBudgets();
  });
}
