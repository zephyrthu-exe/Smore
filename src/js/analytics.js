/**
 * analytics.js — Smore Analytics panel
 *
 * Fetches transactions, budgets, and goals from the authenticated user's own
 * Firestore subtree and renders deterministic summaries. No Gemini calls are
 * made here; all math is plain JavaScript.
 *
 * All Firestore paths use auth.currentUser.uid. No user-supplied UIDs are
 * ever interpolated — the security rules enforce the same constraint.
 */

import {
  collection,
  getDocs,
  query,
  orderBy,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";

// ---------------------------------------------------------------------------
// DOM references (elements added to dashboard.html)
// ---------------------------------------------------------------------------
const analyticsLoading = document.getElementById("analytics-loading");
const analyticsEmpty   = document.getElementById("analytics-empty");
const analyticsError   = document.getElementById("analytics-error");
const analyticsContent = document.getElementById("analytics-content");

// Summary tiles (reuse the existing Overview tiles + two new ones)
const statTotalExpenses = document.getElementById("stat-total-expenses");

// Category breakdown
const categoryList = document.getElementById("analytics-category-list");

// Budget usage
const budgetUsageList = document.getElementById("analytics-budget-list");

// Goal progress
const goalProgressList = document.getElementById("analytics-goal-list");

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
 * Converts a Firestore Timestamp or date-string to a JS Date.
 * @param {object|string} ts
 * @returns {Date|null}
 */
function toDate(ts) {
  if (ts && typeof ts.toDate === "function") return ts.toDate();
  if (typeof ts === "string") return new Date(ts);
  return null;
}

/**
 * Minimal HTML escape to prevent XSS.
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
// Show / hide helpers
// ---------------------------------------------------------------------------

function showLoading() {
  analyticsLoading.classList.remove("hidden");
  analyticsEmpty.classList.add("hidden");
  analyticsError.classList.add("hidden");
  analyticsContent.classList.add("hidden");
}

function showEmpty() {
  analyticsLoading.classList.add("hidden");
  analyticsEmpty.classList.remove("hidden");
  analyticsError.classList.add("hidden");
  analyticsContent.classList.add("hidden");
}

function showError() {
  analyticsLoading.classList.add("hidden");
  analyticsEmpty.classList.add("hidden");
  analyticsError.classList.remove("hidden");
  analyticsContent.classList.add("hidden");
}

function showContent() {
  analyticsLoading.classList.add("hidden");
  analyticsEmpty.classList.add("hidden");
  analyticsError.classList.add("hidden");
  analyticsContent.classList.remove("hidden");
}

// ---------------------------------------------------------------------------
// Calculation helpers
// ---------------------------------------------------------------------------

/**
 * Groups expense transactions by category and returns a sorted array.
 * @param {Array<{type:string, amount:number, category:string}>} txns
 * @returns {Array<{category:string, total:number}>} descending by total
 */
function calcCategoryBreakdown(txns) {
  const map = {};
  for (const t of txns) {
    if (t.type !== "expense") continue;
    const cat = t.category || "Uncategorised";
    map[cat] = (map[cat] || 0) + (t.amount || 0);
  }
  return Object.entries(map)
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Calculates how much was spent in a budget's period for a given category.
 * @param {Array<{type:string, amount:number, category:string, date:object}>} txns
 * @param {string} category
 * @param {"monthly"|"yearly"} period
 * @returns {number}
 */
function calcBudgetSpent(txns, category, period) {
  const now      = new Date();
  const curYear  = now.getFullYear();
  const curMonth = now.getMonth();
  let spent = 0;

  for (const t of txns) {
    if (t.type !== "expense") continue;
    if (t.category !== category) continue;
    const d = toDate(t.date);
    if (!d) continue;
    if (period === "monthly") {
      if (d.getFullYear() === curYear && d.getMonth() === curMonth) {
        spent += t.amount || 0;
      }
    } else if (period === "yearly") {
      if (d.getFullYear() === curYear) {
        spent += t.amount || 0;
      }
    }
  }
  return spent;
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

/**
 * Renders the category breakdown list.
 * @param {Array<{category:string, total:number}>} breakdown
 * @param {number} totalExpenses
 */
function renderCategoryBreakdown(breakdown, totalExpenses) {
  categoryList.innerHTML = "";

  if (breakdown.length === 0) {
    categoryList.innerHTML =
      `<p class="text-secondary mb-0" style="font-size:0.9rem;">No expense categories to display.</p>`;
    return;
  }

  const maxTotal = breakdown[0].total || 1; // avoid division by zero

  breakdown.forEach(({ category, total }) => {
    const pct = Math.round((total / maxTotal) * 100);
    const sharePct = totalExpenses > 0 ? ((total / totalExpenses) * 100).toFixed(1) : "0.0";

    const row = document.createElement("div");
    row.className = "analytics-category-row";
    row.innerHTML = `
      <div class="analytics-category-header">
        <span class="analytics-category-name">${escapeHtml(category)}</span>
        <span class="analytics-category-amount">${formatMMK(total)}
          <span class="analytics-category-share">(${sharePct}%)</span>
        </span>
      </div>
      <div class="analytics-bar-track">
        <div
          class="analytics-bar-fill"
          style="width:${pct}%"
          role="progressbar"
          aria-valuenow="${total}"
          aria-valuemin="0"
          aria-valuemax="${maxTotal}"
          aria-label="${escapeHtml(category)}: ${formatMMK(total)}"
        ></div>
      </div>
    `;
    categoryList.appendChild(row);
  });
}

/**
 * Renders the budget usage list.
 * @param {Array<object>} budgets  Firestore budget docs (data only)
 * @param {Array<object>} txns     All transaction docs (data only)
 */
function renderBudgetUsage(budgets, txns) {
  budgetUsageList.innerHTML = "";

  if (budgets.length === 0) {
    budgetUsageList.innerHTML =
      `<p class="text-secondary mb-0" style="font-size:0.9rem;">No budgets set up yet.</p>`;
    return;
  }

  budgets.forEach((b) => {
    const spent   = calcBudgetSpent(txns, b.category, b.period);
    const limit   = b.limit || 0;
    const pct     = limit > 0 ? (spent / limit) * 100 : 0;
    const fillPct = Math.min(pct, 100);

    let barClass = "analytics-bar-fill--primary";
    if (pct >= 100) barClass = "analytics-bar-fill--danger";
    else if (pct >= 80) barClass = "analytics-bar-fill--warning";

    const remaining = Math.max(0, limit - spent);
    const overText  = pct > 100 ? `${formatMMK(spent - limit)} over` : `${formatMMK(remaining)} left`;

    const row = document.createElement("div");
    row.className = "analytics-category-row";
    row.innerHTML = `
      <div class="analytics-category-header">
        <span class="analytics-category-name">
          ${escapeHtml(b.category)}
          <span class="analytics-period-badge">${b.period === "yearly" ? "Yearly" : "Monthly"}</span>
        </span>
        <span class="analytics-category-amount">${formatMMK(spent)} / ${formatMMK(limit)}</span>
      </div>
      <div class="analytics-bar-track">
        <div
          class="analytics-bar-fill ${barClass}"
          style="width:${fillPct}%"
          role="progressbar"
          aria-valuenow="${spent}"
          aria-valuemin="0"
          aria-valuemax="${limit}"
          aria-label="${escapeHtml(b.category)} budget: ${pct.toFixed(1)}% used"
        ></div>
      </div>
      <div class="analytics-bar-footer">
        <small class="${pct >= 100 ? "text-danger fw-bold" : pct >= 80 ? "text-warning fw-bold" : "text-muted"}">${pct.toFixed(1)}%</small>
        <small class="text-muted">${overText}</small>
      </div>
    `;
    budgetUsageList.appendChild(row);
  });
}

/**
 * Renders the goal progress list.
 * @param {Array<object>} goals  Firestore goal docs (data only)
 */
function renderGoalProgress(goals) {
  goalProgressList.innerHTML = "";

  if (goals.length === 0) {
    goalProgressList.innerHTML =
      `<p class="text-secondary mb-0" style="font-size:0.9rem;">No savings goals set up yet.</p>`;
    return;
  }

  goals.forEach((g) => {
    const saved  = g.savedAmount  || 0;
    const target = g.targetAmount || 0;
    const pct    = target > 0 ? (saved / target) * 100 : 0;
    const fillPct = Math.min(pct, 100);
    const done   = pct >= 100;

    let deadlineStr = "";
    const dl = toDate(g.deadline);
    if (dl) {
      deadlineStr = dl.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
    }

    const row = document.createElement("div");
    row.className = "analytics-category-row";
    row.innerHTML = `
      <div class="analytics-category-header">
        <span class="analytics-category-name">
          ${escapeHtml(g.title)}
          ${done ? `<span class="analytics-goal-done-badge">✓ Complete</span>` : ""}
        </span>
        <span class="analytics-category-amount">${formatMMK(saved)} / ${formatMMK(target)}</span>
      </div>
      <div class="analytics-bar-track">
        <div
          class="analytics-bar-fill analytics-bar-fill--success"
          style="width:${fillPct}%"
          role="progressbar"
          aria-valuenow="${saved}"
          aria-valuemin="0"
          aria-valuemax="${target}"
          aria-label="${escapeHtml(g.title)}: ${pct.toFixed(1)}% saved"
        ></div>
      </div>
      <div class="analytics-bar-footer">
        <small class="${done ? "text-success fw-bold" : "text-muted"}">${pct.toFixed(1)}%</small>
        ${deadlineStr ? `<small class="text-muted">Deadline: ${deadlineStr}</small>` : ""}
      </div>
    `;
    goalProgressList.appendChild(row);
  });
}

// ---------------------------------------------------------------------------
// Main load function
// ---------------------------------------------------------------------------

/**
 * Fetches all data and renders the analytics panel.
 * Called on page load and wired to the Refresh button.
 */
export async function loadAnalytics() {
  const uid = auth.currentUser && auth.currentUser.uid;
  if (!uid) return;

  showLoading();

  try {
    const txnCol    = collection(db, "users", uid, "transactions");
    const budgetCol = collection(db, "users", uid, "budgets");
    const goalCol   = collection(db, "users", uid, "goals");

    // Fetch all three collections in parallel.
    const [txnSnap, budgetSnap, goalSnap] = await Promise.all([
      getDocs(query(txnCol, orderBy("date", "desc"))),
      getDocs(query(budgetCol, orderBy("createdAt", "desc"))),
      getDocs(query(goalCol, orderBy("deadline", "asc"))),
    ]);

    const txns   = txnSnap.docs.map((d) => d.data());
    const budgets = budgetSnap.docs.map((d) => d.data());
    const goals   = goalSnap.docs.map((d) => d.data());

    // If no data at all, show the empty state.
    if (txns.length === 0 && budgets.length === 0 && goals.length === 0) {
      showEmpty();
      return;
    }

    // ── Aggregate transaction totals ────────────────────────
    let totalIncome  = 0;
    let totalExpense = 0;

    for (const t of txns) {
      if (t.type === "income")  totalIncome  += t.amount || 0;
      if (t.type === "expense") totalExpense += t.amount || 0;
    }

    const balance = totalIncome - totalExpense;

    // Update the existing Overview stat tiles (managed by transactions.js)
    // plus the new "Total expenses" tile added to dashboard.html.
    if (statTotalExpenses) statTotalExpenses.textContent = formatMMK(totalExpense);

    // ── Category breakdown ──────────────────────────────────
    const breakdown = calcCategoryBreakdown(txns);
    renderCategoryBreakdown(breakdown, totalExpense);

    // ── Budget usage ────────────────────────────────────────
    renderBudgetUsage(budgets, txns);

    // ── Goal progress ────────────────────────────────────────
    renderGoalProgress(goals);

    showContent();

  } catch (err) {
    console.error("loadAnalytics error:", err);
    showError();
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Initialises the analytics panel.
 * Must be called once the authenticated user is confirmed.
 * @param {string} uid  Firebase Auth UID
 */
export function initAnalytics(uid) {
  if (!uid) return;

  const refreshBtn = document.getElementById("analytics-refresh-btn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", loadAnalytics);
  }

  loadAnalytics();
}
