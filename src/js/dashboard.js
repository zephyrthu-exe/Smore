// dashboard.js
// Dashboard page: welcome summary with current balance, monthly income and
// expense, a spending doughnut chart, recent transactions, budgets, savings
// goals and a planning summary for recurring schedules. It also powers the
// in-app notification centre (persisted in localStorage).

import { collection, onSnapshot, query, orderBy, addDoc, deleteDoc, doc, Timestamp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";
import { startAuthenticatedPage, escapeHtml, closeModal } from "./app-shell.js";
import { calculateSafeToSpend, formatMMK, getUpcomingSchedules, isSameMonth, transactionDate } from "./finance-utils.js";

let spendingChartInstance = null;
let dashboardTransactions = [];
let dashboardBudgets = [];
let dashboardSchedules = [];

// ─── In-app notification store (persisted in localStorage) ────────────────

const NOTIF_STORAGE_KEY = 'smore_notifications_v1';
const NOTIF_DELETED_KEY = 'smore_notifications_deleted_v1';

function loadNotifications() {
  try {
    const raw = localStorage.getItem(NOTIF_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

function saveNotifications(notifs) {
  try { localStorage.setItem(NOTIF_STORAGE_KEY, JSON.stringify(notifs)); } catch (e) {}
}

function loadDeletedNotifications() {
  try {
    const raw = localStorage.getItem(NOTIF_DELETED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

function saveDeletedNotifications(ids) {
  try { localStorage.setItem(NOTIF_DELETED_KEY, JSON.stringify(ids)); } catch (e) {}
}

function addDeletedNotification(id) {
  if (!id) return;
  const ids = loadDeletedNotifications();
  if (!ids.includes(id)) {
    ids.push(id);
    saveDeletedNotifications(ids);
  }
}

function addNotification(notif) {
  // don't add notifications user has deleted explicitly
  const deleted = loadDeletedNotifications();
  if (notif && notif.id && deleted.includes(notif.id)) return;

  const notifs = loadNotifications();
  // avoid duplicate by id
  if (notifs.find(n => n.id === notif.id)) return;
  notifs.unshift({ ...notif, read: false, ts: Date.now() });
  saveNotifications(notifs);
  renderNotifications();
}

function markAllNotificationsRead() {
  const notifs = loadNotifications().map(n => ({ ...n, read: true }));
  saveNotifications(notifs);
  renderNotifications();
}

function renderNotifications() {
  const listEl = document.getElementById('notificationList');
  const badgeEl = document.getElementById('notificationBadge');
  if (!listEl || !badgeEl) return;
  const notifs = loadNotifications();
  const unreadCount = notifs.filter(n => !n.read).length;
  if (unreadCount > 0) {
    badgeEl.textContent = unreadCount;
    badgeEl.classList.remove('d-none');
  } else {
    badgeEl.classList.add('d-none');
  }

  if (notifs.length === 0) {
    listEl.innerHTML = '<div class="text-muted small text-center py-3">No notifications</div>';
    return;
  }

  listEl.innerHTML = notifs.map(n => `
    <div class="list-group-item d-flex gap-2 align-items-start ${n.read ? '' : 'fw-semibold list-group-item-warning'}">
      <div class="flex-grow-1 min-w-0 text-start notif-clickable" role="button" tabindex="0" data-id="${n.id}">
        <div class="small mb-1">${escapeHtml(n.title)}</div>
        <div class="small text-muted text-truncate">${escapeHtml(n.message)}</div>
        <div class="small text-muted mt-1">${new Date(n.ts).toLocaleString()}</div>
      </div>
      <div class="ms-2 d-flex align-items-start">
        <button type="button" class="btn btn-sm btn-outline-danger p-1 delete-notif-btn" data-id="${n.id}" title="Delete notification">
          <i class="bi bi-trash" style="font-size:0.9rem"></i>
        </button>
      </div>
    </div>
  `).join('');

  // attach click handlers for notification clickable areas
  listEl.querySelectorAll('.notif-clickable').forEach(el => {
    el.addEventListener('click', (e) => {
      const id = el.getAttribute('data-id');
      const notifs = loadNotifications();
      const n = notifs.find(x => x.id === id);
      if (!n) return;
      // mark read
      markNotificationRead(id);
      // navigate if link present
      if (n.link) window.location.href = n.link;
    });
    // keyboard accessibility: enter key
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        el.click();
      }
    });
  });

  // attach delete handlers for trash buttons (stop propagation so parent click doesn't also fire)
  listEl.querySelectorAll('.delete-notif-btn').forEach(db => {
    db.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = db.getAttribute('data-id');
      if (!id) return;
      if (confirm('Delete this notification?')) {
        deleteNotification(id);
      }
    });
  });
}

// delete single notification
function deleteNotification(id) {
  if (!id) return;
  // record that user deleted this notification so it won't be re-created
  addDeletedNotification(id);
  const notifs = loadNotifications().filter(n => n.id !== id);
  saveNotifications(notifs);
  renderNotifications();
}

// initialize notification UI
window.addEventListener('DOMContentLoaded', () => {
  renderNotifications();
  document.getElementById('markAllReadBtn')?.addEventListener('click', (e) => { e.preventDefault(); markAllNotificationsRead(); });
});

// ─── Page bootstrap ────────────────────────────────────────────────────────

// Entry point: protect the page (redirect to login if signed out), then wire
// up all the dashboard widgets.
startAuthenticatedPage((user) => {
  listenToTransactions(user.uid);
  listenToBudgets(user.uid);
  listenToRecurringSchedules(user.uid);
  listenToGoals(user.uid);
  setupBudgetForm(user.uid);
  setupGoalForm(user.uid);
});

function listenToTransactions(userId) {
  const txRef = collection(db, "users", userId, "transactions");
  const q = query(txRef, orderBy("date", "desc"));

  onSnapshot(q, (snapshot) => {
    dashboardTransactions = snapshot.docs.map((docSnap) => docSnap.data());
    renderDashboardBudgets();
    let totalIncome = 0;
    let totalSpent = 0;
    let lifetimeIncome = 0;
    let lifetimeSpent = 0;
    const categoryTotals = {};

    const recentTxContainer = document.getElementById("recentTransactionsContainer");
    let recentHtml = "";

    if (snapshot.empty) {
      document.getElementById("totalBalanceText").textContent = "0 MMK";
      document.getElementById("monthlyIncomeText").textContent = "0 MMK";
      document.getElementById("monthlyExpenseText").textContent = "0 MMK";

      if (recentTxContainer) {
        recentTxContainer.innerHTML = `<div class="text-center py-3 text-muted small border rounded">No transactions yet.</div>`;
      }
      renderChart({}, 0);
      return;
    }

    snapshot.docs.forEach((docSnap, index) => {
      const tx = docSnap.data();
      const amount = parseFloat(tx.amount) || 0;
      const isIncome = tx.type === "income";
      if (isIncome) lifetimeIncome += amount;
      else lifetimeSpent += amount;

      if (isSameMonth(transactionDate(tx))) {
        if (isIncome) {
          totalIncome += amount;
        } else {
          totalSpent += amount;
          const cat = tx.category || "Uncategorised";
          categoryTotals[cat] = (categoryTotals[cat] || 0) + amount;
        }
      }

      if (index < 5 && recentTxContainer) {
        recentHtml += `
          <div class="d-flex align-items-center justify-content-between p-2 border rounded">
            <div>
              <div class="fw-semibold small">${escapeHtml(tx.description || tx.category || "Transaction")}</div>
              <div class="text-muted" style="font-size: 0.75rem;">${escapeHtml(tx.category || "General")}</div>
            </div>
            <span class="fw-bold small ${isIncome ? 'text-success' : 'text-danger'}">
              ${isIncome ? '+' : '-'}${amount.toLocaleString()} MMK
            </span>
          </div>`;
      }
    });

    const totalBalance = lifetimeIncome - lifetimeSpent;

    document.getElementById("totalBalanceText").textContent = `${totalBalance.toLocaleString()} MMK`;
    document.getElementById("monthlyIncomeText").textContent = `${totalIncome.toLocaleString()} MMK`;
    document.getElementById("monthlyExpenseText").textContent = `${totalSpent.toLocaleString()} MMK`;

    if (recentTxContainer) {
      recentTxContainer.innerHTML = recentHtml;
    }

    renderChart(categoryTotals, totalSpent);
  });
}

function renderChart(categoryTotals, totalExpense) {
  const ctx = document.getElementById("spendingChart")?.getContext("2d");
  const legendContainer = document.getElementById("chartLegend");
  if (!ctx) return;

  const categories = Object.keys(categoryTotals);
  const values = Object.values(categoryTotals);

  if (spendingChartInstance) spendingChartInstance.destroy();

  if (categories.length === 0 || totalExpense === 0) {
    spendingChartInstance = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: ["No Expenses"],
        datasets: [{ data: [1], backgroundColor: ["#efe4d1"] }]
      },
      options: { cutout: "75%", plugins: { legend: { display: false } } }
    });
    if (legendContainer) legendContainer.innerHTML = `<div class="text-muted small text-center">No expense breakdown available.</div>`;
    return;
  }

  const colors = ["#c98a3e", "#8a5a2b", "#e2a15c", "#5c4634", "#d9b98a", "#3b2418"];

  spendingChartInstance = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: categories,
      datasets: [{ data: values, backgroundColor: colors }]
    },
    options: { cutout: "75%", plugins: { legend: { display: false } } }
  });

  let legendHtml = "";
  categories.forEach((cat, index) => {
    const pct = Math.round((categoryTotals[cat] / totalExpense) * 100);
    legendHtml += `
      <div class="d-flex align-items-center justify-content-between mb-1">
        <span class="text-truncate"><span class="d-inline-block rounded-circle me-1" style="width:8px; height:8px; background:${colors[index % colors.length]}"></span>${escapeHtml(cat)}</span>
        <span class="fw-bold ms-2">${pct}%</span>
      </div>`;
  });
  if (legendContainer) legendContainer.innerHTML = legendHtml;
}

function listenToBudgets(userId) {
  const budgetsRef = collection(db, "users", userId, "budgets");

  onSnapshot(budgetsRef, (snapshot) => {
    dashboardBudgets = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    renderDashboardBudgets();
  });
}

function listenToRecurringSchedules(userId) {
  const schedulesRef = collection(db, "users", userId, "recurringSchedules");

  onSnapshot(query(schedulesRef, orderBy("startDate", "asc")), (snapshot) => {
    dashboardSchedules = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    renderPlanningSummary();
  }, (error) => {
    console.error("Recurring schedules snapshot error:", error);
    renderPlanningSummary();
  });
}

function renderPlanningSummary() {
  const balanceText = document.getElementById("totalBalanceText")?.textContent || "0";
  const balance = Number(balanceText.replace(/[^0-9-]/g, "")) || 0;
  const projection = calculateSafeToSpend(balance, dashboardSchedules);
  const safeToSpendText = document.getElementById("safeToSpendText");
  const commitmentTotal = document.getElementById("upcomingCommitmentTotal");
  const hint = document.getElementById("safeToSpendHint");
  const container = document.getElementById("upcomingSchedulesContainer");

  if (safeToSpendText) {
    safeToSpendText.textContent = formatMMK(projection.safeToSpend);
    safeToSpendText.classList.toggle("text-danger", projection.safeToSpend < 0);
  }
  if (commitmentTotal) commitmentTotal.textContent = formatMMK(projection.upcomingExpenses);
  if (hint) hint.textContent = projection.safeToSpend < 0 ? "Scheduled expenses exceed your current balance" : "After scheduled expenses";
  if (!container) return;

  const upcoming = getUpcomingSchedules(dashboardSchedules);
  if (upcoming.length === 0) {
    container.innerHTML = `<div class="text-muted small">No recurring items due in the next 30 days.</div>`;
    return;
  }

  container.innerHTML = upcoming.slice(0, 5).map((schedule) => `
    <div class="d-flex align-items-center justify-content-between gap-2 border rounded-3 px-2 py-2">
      <div class="min-w-0">
        <div class="fw-semibold small text-truncate">${escapeHtml(schedule.description)}</div>
        <div class="text-muted" style="font-size: 0.75rem;">${escapeHtml(schedule.occurrence.toLocaleDateString("en-US", { month: "short", day: "numeric" }))} · ${escapeHtml(schedule.frequency)}</div>
      </div>
      <span class="fw-bold small ${schedule.type === "income" ? "text-success" : "text-danger"}">${schedule.type === "income" ? "+" : "-"}${formatMMK(schedule.amount)}</span>
      <button class="btn btn-sm btn-outline-danger border-0" type="button" aria-label="Delete ${escapeHtml(schedule.description)}" onclick="deleteRecurringSchedule('${schedule.id}')"><i class="bi bi-trash" aria-hidden="true"></i></button>
    </div>`).join("");
}

window.deleteRecurringSchedule = async (scheduleId) => {
  const user = auth.currentUser;
  if (!user || !scheduleId || !confirm("Delete this recurring item?")) return;
  try {
    await deleteDoc(doc(db, "users", user.uid, "recurringSchedules", scheduleId));
  } catch (error) {
    alert("Failed to delete recurring item: " + error.message);
  }
};

function renderDashboardBudgets() {
  const container = document.getElementById("budgetsContainer");
  if (!container) return;

  if (dashboardBudgets.length === 0) {
    container.innerHTML = `
      <div class="text-center py-3 text-muted small border rounded">
        <p class="mb-0">No budget limits set.</p>
      </div>`;
    return;
  }

  const categorySpentMap = {};
  dashboardTransactions.forEach((transaction) => {
    if (transaction.type !== "expense" || !isSameMonth(transactionDate(transaction))) return;
    const category = transaction.category || "General";
    categorySpentMap[category] = (categorySpentMap[category] || 0) + (parseFloat(transaction.amount) || 0);
  });

  let html = "";
  dashboardBudgets.forEach((item) => {
    const limit = parseFloat(item.limit) || 0;
    const spent = categorySpentMap[item.category] || 0;
    const pct = limit > 0 ? Math.min(100, Math.round((spent / limit) * 100)) : 0;

    // create notifications when thresholds are reached (80% and 100%)
    try {
      const notifId80 = `budget-${item.category}-80`;
      const notifId100 = `budget-${item.category}-100`;
      if (pct >= 80 && pct < 100) {
        addNotification({ id: notifId80, type: 'budget-warning', title: 'Budget nearing limit', message: `${item.category} is ${pct}% of its budget.`, link: 'budget.html' });
      }
      if (pct >= 100) {
        addNotification({ id: notifId100, type: 'budget-exceeded', title: 'Budget reached', message: `${item.category} budget has been fully used.`, link: 'budget.html' });
      }
    } catch (e) { /* ignore notification errors */ }

    html += `
      <div class="p-2 border rounded">
        <div class="d-flex justify-content-between small mb-1">
          <span class="fw-semibold">${escapeHtml(item.category)}</span>
          <span>${spent.toLocaleString()} / ${limit.toLocaleString()} MMK</span>
        </div>
        <div class="progress" style="height: 6px;">
          <div class="progress-bar ${pct >= 100 ? 'bg-danger' : (pct >= 80 ? 'bg-warning' : 'bg-dark')}" style="width: ${pct}%"></div>
        </div>
      </div>`;
  });
  container.innerHTML = html;

  // re-render notification UI in case new notifications added
  renderNotifications();
}

function listenToGoals(userId) {
  const container = document.getElementById("goalsContainer");
  if (!container) return;
  const goalsRef = collection(db, "users", userId, "goals");

  onSnapshot(goalsRef, (snapshot) => {
    if (snapshot.empty) {
      container.innerHTML = `
        <div class="text-center py-3 text-muted small border rounded">
          <p class="mb-0">No savings goals added yet.</p>
        </div>`;
      return;
    }

    let html = "";
    snapshot.forEach((docSnap) => {
      const item = docSnap.data();
      const id = docSnap.id;
      const target = parseFloat(item.targetAmount || item.target) || 0;
      const saved = parseFloat(item.savedAmount || item.current) || 0;
      const pct = target > 0 ? Math.min(100, Math.round((saved / target) * 100)) : 0;

      // Create notifications for goal progress (80% and 100%)
      try {
        const g80 = `goal-${id}-80`;
        const g100 = `goal-${id}-100`;
        if (pct >= 75 && pct < 100) {
          addNotification({ id: g80, type: 'goal-warning', title: 'Goal nearing target', message: `${item.title || item.name || 'Goal'} is ${pct}% complete.`, link: 'goals.html' });
        }
        if (pct >= 100) {
          addNotification({ id: g100, type: 'goal-achieved', title: 'Goal achieved', message: `${item.title || item.name || 'Goal'} has been reached.`, link: 'goals.html' });
        }
      } catch (e) { /* ignore */ }

      html += `
        <div class="d-flex align-items-center gap-3 p-2 border rounded">
          <div class="rounded-circle border border-dark text-dark d-flex align-items-center justify-content-center fw-bold" style="width: 40px; height: 40px; font-size: 0.75rem; flex-shrink: 0;">
            ${pct}%
          </div>
          <div class="flex-grow-1 min-w-0">
            <div class="fw-semibold small text-truncate">${escapeHtml(item.title || item.name || "Goal")}</div>
            <div class="text-muted small">${saved.toLocaleString()} / ${target.toLocaleString()} MMK</div>
          </div>
        </div>`;
    });
    container.innerHTML = html;

    // refresh notifications UI
    renderNotifications();
  });
}

function setupBudgetForm(userId) {
  const form = document.getElementById("adjustBudgetForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const category = document.getElementById("budgetCategory").value;
    const limit = parseFloat(document.getElementById("limitAmount").value) || 0;

    if (!category || limit <= 0) return;

    try {
      await addDoc(collection(db, "users", userId, "budgets"), {
        category,
        limit,
        period: "monthly",
        createdAt: Timestamp.now()
      });
      closeModal("adjustBudgetModal");
      form.reset();
    } catch (err) {
      console.error("Error setting budget limit:", err);
    }
  });
}

function setupGoalForm(userId) {
  const form = document.getElementById("addGoalForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = document.getElementById("goalName").value.trim();
    const targetAmount = parseFloat(document.getElementById("targetAmount").value) || 0;
    const savedAmount = parseFloat(document.getElementById("currentAmount").value) || 0;

    if (!title || targetAmount <= 0) return;

    try {
      await addDoc(collection(db, "users", userId, "goals"), {
        title,
        targetAmount,
        savedAmount,
        deadline: Timestamp.now(),
        createdAt: Timestamp.now()
      });
      closeModal("addGoalModal");
      form.reset();
    } catch (err) {
      console.error("Error adding savings goal:", err);
    }
  });
}

