// goals.js
// Savings Goals page: shows every goal as a card with its progress and lets
// the user add or delete goals. Goals are stored in Firestore under the
// current user's "goals" collection.

import { collection, onSnapshot, query, orderBy, addDoc, deleteDoc, doc, Timestamp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";
import { startAuthenticatedPage, escapeHtml, closeModal } from "./app-shell.js";

// All goals for the current user, kept up to date by the Firestore listener.
let currentGoals = [];

// Entry point: protect the page (redirect to login if signed out), then wire
// up the goal features.
startAuthenticatedPage((user) => {
  listenToGoals(user.uid);
  setupAddGoalForm(user.uid);
});

// Keeps currentGoals in sync with Firestore (newest first) and re-renders.
function listenToGoals(userId) {
  const q = query(collection(db, "users", userId, "goals"), orderBy("createdAt", "desc"));

  onSnapshot(q, (snapshot) => {
    currentGoals = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    renderGoalsView();
  });
}

// Draws each goal as a card (or an empty state with a shortcut to add one).
function renderGoalsView() {
  const container = document.getElementById("goalsGridContainer");
  if (!container) return;

  if (currentGoals.length === 0) {
    container.innerHTML = `
      <div class="col-12 text-center py-5 text-muted border rounded bg-white">
        <i class="bi bi-piggy-bank fs-2 mb-2 d-block"></i>
        <h6 class="fw-bold">No savings goals yet</h6>
        <p class="small mb-3">Set targets for major milestones or emergency funds.</p>
        <button class="btn btn-dark btn-sm" data-bs-toggle="modal" data-bs-target="#addGoalModal">
          + Add First Goal
        </button>
      </div>`;
    return;
  }

  let html = "";
  currentGoals.forEach((goal) => {
    const target = parseFloat(goal.targetAmount || goal.target) || 0;
    const saved = parseFloat(goal.savedAmount || goal.current) || 0;
    const pct = target > 0 ? Math.min(100, Math.round((saved / target) * 100)) : 0;
    const isAchieved = pct >= 100;

    let deadlineStr = "No deadline";
    if (goal.deadline && typeof goal.deadline.toDate === "function") {
      deadlineStr = goal.deadline.toDate().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    }

    html += `
      <div class="col-12 col-md-6 col-lg-4">
        <div class="card border-0 shadow-sm p-3 h-100 d-flex flex-column justify-content-between">
          <div>
            <div class="d-flex justify-content-between align-items-center mb-3">
              <h2 class="h6 fw-bold mb-0 text-truncate">${escapeHtml(goal.title || goal.name || "Goal")}</h2>
              <span class="badge ${isAchieved ? 'bg-success text-white' : 'bg-dark text-white'} px-2 py-1">
                ${isAchieved ? 'Achieved' : 'Ongoing'}
              </span>
            </div>

            <div class="mb-3">
              <div class="progress mb-2" style="height: 8px;">
                <div class="progress-bar ${isAchieved ? 'bg-success' : 'bg-dark'}" role="progressbar" style="width: ${pct}%;"></div>
              </div>
              <div class="d-flex justify-content-between small text-muted">
                <span><strong class="text-dark">${pct}%</strong> toasted</span>
                <strong class="text-dark">${saved.toLocaleString()} MMK</strong>
              </div>
            </div>

            <hr class="my-3 text-secondary opacity-25">

            <div class="d-flex justify-content-between small text-muted mb-3">
              <div>
                <div style="font-size: 0.75rem;">Target Amount</div>
                <div class="fw-bold text-dark">${target.toLocaleString()} MMK</div>
              </div>
              <div class="text-end">
                <div style="font-size: 0.75rem;">Target Date</div>
                <div class="fw-bold text-dark">${escapeHtml(deadlineStr)}</div>
              </div>
            </div>
          </div>

          <div class="d-flex justify-content-end gap-2 pt-2 border-top">
            <button class="btn btn-sm btn-outline-danger border-0" onclick="deleteGoalRecord('${goal.id}')">
              <i class="bi bi-trash"></i> Delete
            </button>
          </div>
        </div>
      </div>`;
  });

  container.innerHTML = html;
}

// Delete button handler referenced by the cards above.
window.deleteGoalRecord = async (goalId) => {
  const user = auth.currentUser;
  if (!user) return;
  if (confirm("Are you sure you want to delete this savings goal?")) {
    try {
      await deleteDoc(doc(db, "users", user.uid, "goals", goalId));
    } catch (err) {
      alert("Failed to delete goal: " + err.message);
    }
  }
};

// Wires the "Add Goal" modal form to create a goal in Firestore. The button
// stays disabled while the request is in flight so it cannot be double-tapped.
function setupAddGoalForm(userId) {
  const form = document.getElementById("addGoalForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const saveBtn = document.getElementById("saveGoalBtn");
    if (saveBtn) saveBtn.disabled = true;

    const title = document.getElementById("goalTitle").value.trim();
    const targetAmount = parseFloat(document.getElementById("goalAmount").value) || 0;
    const initialSaved = parseFloat(document.getElementById("goalInitial")?.value) || 0;
    const dateVal = document.getElementById("goalDate").value;

    if (!title || targetAmount <= 0 || !dateVal) {
      if (saveBtn) saveBtn.disabled = false;
      return;
    }

    const [year, month, day] = dateVal.split("-").map(Number);

    try {
      await addDoc(collection(db, "users", userId, "goals"), {
        title,
        targetAmount,
        savedAmount: initialSaved,
        deadline: Timestamp.fromDate(new Date(year, month - 1, day)),
        createdAt: Timestamp.now()
      });

      form.reset();
      closeModal("addGoalModal");
    } catch (err) {
      alert("Error adding goal: " + err.message);
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  });
}
