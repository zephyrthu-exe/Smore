// budgets.js
// Budgets page: shows every category limit as a card with its monthly spend,
// plus overall stats and a warning banner when a budget is nearly exhausted.

import { collection, onSnapshot, addDoc, deleteDoc, doc, Timestamp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";
import { startAuthenticatedPage, escapeHtml, closeModal } from "./app-shell.js";
import { isPreviousMonth, isSameMonth, transactionDate } from "./finance-utils.js";

// Live data for the current user, fed by the Firestore listeners below.
let currentBudgets = [];
let currentTransactions = [];

// Entry point: protect the page (redirect to login if signed out), then wire
// up the budget features.
startAuthenticatedPage((user) => {
  listenToBudgetsAndTxns(user.uid);
  setupCreateBudgetForm(user.uid);
});

// Keeps budgets AND transactions in sync. Both snapshots must arrive before
// the view is rendered, because every card combines a budget with the
// monthly spending for that category.
function listenToBudgetsAndTxns(userId) {
  const budgetRef = collection(db, "users", userId, "budgets");
  const txnRef = collection(db, "users", userId, "transactions");

  onSnapshot(budgetRef, (budgetSnap) => {
    currentBudgets = budgetSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));

    onSnapshot(txnRef, (txnSnap) => {
      currentTransactions = txnSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      renderBudgetsView();
    });
  });
}

// Draws each budget card, the top stats, and the warning banner.
function renderBudgetsView() {
  const grid = document.getElementById("budgetsGrid");
  const statTotal = document.getElementById("statTotalBudget");
  const statSpent = document.getElementById("statSpentSoFar");
  const statRemaining = document.getElementById("statRemainingBudget");
  const warningBanner = document.getElementById("budgetWarningBanner");
  const warningText = document.getElementById("warningBannerText");

  if (!grid) return;

  let totalAllocated = 0;
  let totalSpentSoFar = 0;
  let highestUsageWarning = null;

  // Calculate per-category spending from this month's transactions.
  const categorySpentMap = {};
  currentTransactions.forEach((tx) => {
    const normalizedType = (tx.type || "").toLowerCase();
    if ((normalizedType === "expense" || normalizedType === "savings") && isSameMonth(transactionDate(tx))) {
      const cat = tx.category || "General";
      const amt = parseFloat(tx.amount) || 0;
      categorySpentMap[cat] = (categorySpentMap[cat] || 0) + amt;
    }
  });

  if (currentBudgets.length === 0) {
    grid.innerHTML = `
      <div class="col-12 text-center py-5 text-muted border rounded bg-white">
        <i class="bi bi-wallet2 fs-2 mb-2 d-block"></i>
        <h6 class="fw-bold">No budgets set yet</h6>
        <p class="small mb-3">Create category limits to manage your monthly spending.</p>
        <button class="btn btn-dark btn-sm" data-bs-toggle="modal" data-bs-target="#createBudgetModal">
          + Create First Budget
        </button>
      </div>`;
    if (statTotal) statTotal.textContent = "0 MMK";
    if (statSpent) statSpent.textContent = "0 MMK";
    if (statRemaining) statRemaining.textContent = "0 MMK";
    warningBanner?.classList.add("d-none");
    return;
  }

  let html = "";

  currentBudgets.forEach((bud) => {
    const limit = parseFloat(bud.limit) || 0;
    const spent = categorySpentMap[bud.category] || 0;
    const previousSpent = currentTransactions
      .filter((tx) => {
        const normalizedType = (tx.type || "").toLowerCase();
        return (normalizedType === "expense" || normalizedType === "savings") && tx.category === bud.category && isPreviousMonth(transactionDate(tx));
      })
      .reduce((total, tx) => total + (parseFloat(tx.amount) || 0), 0);
    const rollover = bud.rollover === true ? Math.max(0, limit - previousSpent) : 0;
    const effectiveLimit = limit + rollover;
    const pct = effectiveLimit > 0 ? Math.round((spent / effectiveLimit) * 100) : 0;
    const remaining = Math.max(0, effectiveLimit - spent);

    totalAllocated += effectiveLimit;
    totalSpentSoFar += spent;

    if (pct >= 80) {
      if (!highestUsageWarning || pct > highestUsageWarning.pct) {
        highestUsageWarning = { category: bud.category, pct };
      }
    }

    let progressColor = "bg-dark";
    if (pct >= 100) progressColor = "bg-danger";
    else if (pct >= 80) progressColor = "bg-warning";

    html += `
      <div class="col-12 col-md-6 col-lg-4">
        <div class="card border-0 shadow-sm p-3 h-100 d-flex flex-column justify-content-between">
          <div>
            <div class="d-flex justify-content-between align-items-center mb-2">
              <h2 class="h6 fw-bold mb-0">${escapeHtml(bud.category)}</h2>
              <span class="badge ${pct >= 100 ? 'bg-danger' : (pct >= 80 ? 'bg-warning text-dark' : 'bg-light text-dark border')}">${pct}%</span>
            </div>
            <div class="small text-muted mb-2">
              Spent <strong class="text-dark">${spent.toLocaleString()} MMK</strong> of ${effectiveLimit.toLocaleString()} MMK
              ${rollover > 0 ? `<span class="d-block text-success">Includes ${rollover.toLocaleString()} MMK rollover</span>` : ""}
            </div>
            <div class="progress mb-3" style="height: 8px;">
              <div class="progress-bar ${progressColor}" role="progressbar" style="width: ${Math.min(100, pct)}%"></div>
            </div>
            <div class="d-flex justify-content-between small text-muted">
              <span>Remaining:</span>
              <strong class="${spent > limit ? 'text-danger' : 'text-dark'}">${remaining.toLocaleString()} MMK</strong>
            </div>
          </div>
          <div class="pt-3 mt-3 border-top d-flex justify-content-end">
            <button class="btn btn-sm btn-outline-danger border-0" onclick="deleteBudgetRecord('${bud.id}')">
              <i class="bi bi-trash"></i> Delete
            </button>
          </div>
        </div>
      </div>`;
  });

  grid.innerHTML = html;

  if (statTotal) statTotal.textContent = `${totalAllocated.toLocaleString()} MMK`;
  if (statSpent) statSpent.textContent = `${totalSpentSoFar.toLocaleString()} MMK`;
  if (statRemaining) statRemaining.textContent = `${Math.max(0, totalAllocated - totalSpentSoFar).toLocaleString()} MMK`;

  if (highestUsageWarning) {
    warningBanner?.classList.remove("d-none");
    if (warningText) {
      warningText.textContent = `${highestUsageWarning.category} budget is at ${highestUsageWarning.pct}% — consider reducing spending`;
    }
  } else {
    warningBanner?.classList.add("d-none");
  }
}

// Delete button handler referenced by the cards above.
window.deleteBudgetRecord = async (budId) => {
  const user = auth.currentUser;
  if (!user) return;
  if (confirm("Are you sure you want to delete this budget limit?")) {
    try {
      await deleteDoc(doc(db, "users", user.uid, "budgets", budId));
    } catch (err) {
      alert("Failed to delete budget: " + err.message);
    }
  }
};

// Wires the "Create Budget" modal form to add a budget in Firestore.
function setupCreateBudgetForm(userId) {
  const form = document.getElementById("createBudgetForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const saveBtn = document.getElementById("saveBudBtn");
    if (saveBtn) saveBtn.disabled = true;

    const category = document.getElementById("budCategory").value;
    const limit = parseFloat(document.getElementById("budLimit").value) || 0;
    const rollover = document.getElementById("budRollover")?.checked === true;

    if (!category || limit <= 0) {
      if (saveBtn) saveBtn.disabled = false;
      return;
    }

    try {
      await addDoc(collection(db, "users", userId, "budgets"), {
        category,
        limit,
        rollover,
        period: "monthly",
        createdAt: Timestamp.now()
      });

      form.reset();
      closeModal("createBudgetModal");
    } catch (err) {
      alert("Error saving budget: " + err.message);
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  });
}
