import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  doc,
  query,
  orderBy,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";

// DOM references
const goalList       = document.getElementById("goal-list");
const goalLoading    = document.getElementById("goal-loading");
const goalEmpty      = document.getElementById("goal-empty");
const goalStatus     = document.getElementById("goal-status");

const addGoalBtn     = document.getElementById("add-goal-btn");
const refreshBtn     = document.getElementById("goal-refresh-btn");

const goalModal      = document.getElementById("goalModal");
const goalForm       = document.getElementById("goal-form");
const goalEditId     = document.getElementById("goal-edit-id");
const goalModalTitle = document.getElementById("goalModalLabel");
const goalSubmitBtn  = document.getElementById("goal-submit-btn");

const fldTitle       = document.getElementById("goal-title");
const fldTarget      = document.getElementById("goal-target");
const fldSaved       = document.getElementById("goal-saved");
const fldDeadline    = document.getElementById("goal-deadline");

const deleteGoalModal   = document.getElementById("deleteGoalModal");
const deleteConfirmBtn  = document.getElementById("delete-goal-confirm-btn");

let bsModal       = null;
let bsDeleteModal = null;
let pendingDeleteId = null;

const MAX_AMOUNT = 9999999999;
const MAX_TITLE  = 120;

function formatMMK(n) {
  return Number(n).toLocaleString("en-US") + " MMK";
}

function formatDate(ts) {
  let d = (ts && typeof ts.toDate === "function") ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function showStatus(type, message, autoDismiss = 0) {
  goalStatus.textContent = message;
  goalStatus.className = `status-alert is-visible is-${type}`;
  goalStatus.setAttribute("role", type === "error" ? "alert" : "status");
  if (autoDismiss > 0) setTimeout(clearStatus, autoDismiss);
}

function clearStatus() {
  goalStatus.textContent = "";
  goalStatus.className = "status-alert";
  goalStatus.removeAttribute("role");
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
  goalForm.querySelectorAll(".is-invalid").forEach(el => el.classList.remove("is-invalid"));
  goalForm.querySelectorAll(".invalid-feedback").forEach(el => el.textContent = "");
}

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function validateForm() {
  clearFieldErrors();
  let valid = true;

  const title = fldTitle.value.trim();
  if (!title) {
    setFieldError(fldTitle, "Title is required.");
    valid = false;
  } else if (title.length > MAX_TITLE) {
    setFieldError(fldTitle, `Title must be ${MAX_TITLE} characters or fewer.`);
    valid = false;
  }

  const rawTarget = fldTarget.value.trim();
  const targetAmount = parseInt(rawTarget, 10);
  if (!rawTarget || isNaN(targetAmount) || targetAmount < 0 || targetAmount > MAX_AMOUNT || String(targetAmount) !== rawTarget) {
    setFieldError(fldTarget, `Enter a whole number between 0 and ${MAX_AMOUNT.toLocaleString("en-US")}.`);
    valid = false;
  }

  const rawSaved = fldSaved.value.trim();
  const savedAmount = parseInt(rawSaved, 10);
  if (!rawSaved || isNaN(savedAmount) || savedAmount < 0 || savedAmount > targetAmount || String(savedAmount) !== rawSaved) {
    setFieldError(fldSaved, "Saved amount must be a whole number between 0 and the target amount.");
    valid = false;
  }

  const dateVal = fldDeadline.value;
  if (!dateVal) {
    setFieldError(fldDeadline, "Deadline is required.");
    valid = false;
  }

  if (!valid) return { valid: false };

  const [y, m, d] = dateVal.split("-").map(Number);
  const dateObj = new Date(Date.UTC(y, m - 1, d));
  const deadline = Timestamp.fromDate(dateObj);

  return { valid: true, data: { title, targetAmount, savedAmount, deadline } };
}

function buildCard(id, data) {
  const card = document.createElement("article");
  card.className = "txn-card";
  card.dataset.id = id;

  const pct = data.targetAmount > 0 ? (data.savedAmount / data.targetAmount) * 100 : 0;
  const progressPct = Math.min(pct, 100);
  
  card.innerHTML = `
    <div class="txn-card-body">
      <div class="txn-card-left" style="width: 100%;">
        <div class="d-flex justify-content-between w-100 align-items-center mb-2">
          <div>
            <span class="txn-category">${escapeHtml(data.title)}</span>
          </div>
          <div class="text-end">
            <span class="txn-amount" style="font-size: 0.9rem;">${formatMMK(data.savedAmount)} / ${formatMMK(data.targetAmount)}</span>
          </div>
        </div>
        <div class="progress w-100" style="height: 8px;">
          <div class="progress-bar bg-success" role="progressbar" style="width: ${progressPct}%" aria-valuenow="${data.savedAmount}" aria-valuemin="0" aria-valuemax="${data.targetAmount}"></div>
        </div>
        <div class="d-flex justify-content-between w-100 mt-2">
          <small class="text-success fw-bold">${pct.toFixed(1)}%</small>
          <small class="text-muted">Deadline: ${formatDate(data.deadline)}</small>
        </div>
      </div>
    </div>
    <div class="txn-card-actions">
      <button class="btn btn-sm btn-outline-secondary goal-edit-btn" data-id="${id}">Edit</button>
      <button class="btn btn-sm btn-outline-danger goal-delete-btn" data-id="${id}">Delete</button>
    </div>
  `;

  card.querySelector(".goal-edit-btn").addEventListener("click", () => openEditModal(id, data));
  card.querySelector(".goal-delete-btn").addEventListener("click", () => {
    pendingDeleteId = id;
    bsDeleteModal.show();
  });

  return card;
}

export async function loadGoals() {
  const uid = auth.currentUser && auth.currentUser.uid;
  if (!uid) return;

  goalLoading.classList.remove("hidden");
  goalList.classList.add("hidden");
  goalEmpty.classList.add("hidden");
  clearStatus();

  try {
    const goalSnap = await getDocs(query(collection(db, "users", uid, "goals"), orderBy("deadline", "asc")));
    
    goalList.innerHTML = "";

    if (goalSnap.empty) {
      goalLoading.classList.add("hidden");
      goalEmpty.classList.remove("hidden");
      return;
    }

    goalSnap.forEach((docSnap) => {
      goalList.appendChild(buildCard(docSnap.id, docSnap.data()));
    });

    goalLoading.classList.add("hidden");
    goalList.classList.remove("hidden");
  } catch (err) {
    console.error("loadGoals error:", err);
    goalLoading.classList.add("hidden");
    goalEmpty.classList.remove("hidden");
    showStatus("error", "Could not load goals. Please refresh.");
  }
}

function openAddModal() {
  goalForm.reset();
  clearFieldErrors();
  goalEditId.value = "";
  goalModalTitle.textContent = "Add Goal";
  goalSubmitBtn.textContent = "Add Goal";

  const today = new Date();
  const yyyy  = today.getFullYear();
  const mm    = String(today.getMonth() + 1).padStart(2, "0");
  const dd    = String(today.getDate()).padStart(2, "0");
  fldDeadline.value = `${yyyy}-${mm}-${dd}`;

  bsModal.show();
}

function openEditModal(id, data) {
  goalForm.reset();
  clearFieldErrors();
  goalEditId.value = id;
  goalModalTitle.textContent = "Edit Goal";
  goalSubmitBtn.textContent = "Save Changes";
  
  fldTitle.value = data.title || "";
  fldTarget.value = String(data.targetAmount || 0);
  fldSaved.value = String(data.savedAmount || 0);

  if (data.deadline && typeof data.deadline.toDate === "function") {
    const d    = data.deadline.toDate();
    const yyyy = d.getUTCFullYear();
    const mm   = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd2  = String(d.getUTCDate()).padStart(2, "0");
    fldDeadline.value = `${yyyy}-${mm}-${dd2}`;
  }
  
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

  setButtonLoading(goalSubmitBtn, true, goalEditId.value ? "Save Changes" : "Add Goal");

  try {
    const colRef = collection(db, "users", uid, "goals");
    const editId = goalEditId.value;

    if (editId) {
      await updateDoc(doc(db, "users", uid, "goals", editId), data);
      showStatus("success", "Goal updated.", 3000);
    } else {
      await addDoc(colRef, {
        ...data,
        createdAt: Timestamp.now(),
      });
      showStatus("success", "Goal added.", 3000);
    }

    bsModal.hide();
    await loadGoals();
  } catch (err) {
    console.error(err);
    showStatus("error", "Could not save goal.");
  } finally {
    setButtonLoading(goalSubmitBtn, false, goalEditId.value ? "Save Changes" : "Add Goal");
  }
}

async function handleDeleteConfirm() {
  if (!pendingDeleteId) return;
  const uid = auth.currentUser && auth.currentUser.uid;
  if (!uid) return;

  deleteConfirmBtn.disabled = true;
  deleteConfirmBtn.textContent = "Deleting...";

  try {
    await deleteDoc(doc(db, "users", uid, "goals", pendingDeleteId));
    bsDeleteModal.hide();
    showStatus("success", "Goal deleted.", 3000);
    await loadGoals();
  } catch (err) {
    console.error(err);
    bsDeleteModal.hide();
    showStatus("error", "Could not delete goal.");
  } finally {
    pendingDeleteId = null;
    deleteConfirmBtn.disabled = false;
    deleteConfirmBtn.textContent = "Delete";
  }
}

export function initGoals(uid) {
  if (!uid) return;
  bsModal = new bootstrap.Modal(goalModal);
  bsDeleteModal = new bootstrap.Modal(deleteGoalModal);

  addGoalBtn.addEventListener("click", openAddModal);
  refreshBtn.addEventListener("click", () => loadGoals());
  goalForm.addEventListener("submit", handleFormSubmit);
  deleteConfirmBtn.addEventListener("click", handleDeleteConfirm);
  deleteGoalModal.addEventListener("hidden.bs.modal", () => pendingDeleteId = null);

  loadGoals();
}
