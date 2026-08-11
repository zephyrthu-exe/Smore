import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { collection, onSnapshot, query, orderBy, addDoc, Timestamp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";
import { initSomboAssistant, destroySomboAssistant } from "./sombo-assistant.js";
import { initStore, cleanupStore } from "./store.js";

let spendingChartInstance = null;

onAuthStateChanged(auth, (user) => {
  if (!user) {
    cleanupStore();
    destroySomboAssistant();
    window.location.replace("./auth.html");
    return;
  }

  // 1. User Profile Binding
  bindUserData(user);

  // 2. Setup Logout
  setupLogout();

  // 3. Initialize Store & Subscriptions
  initStore(user.uid);
  listenToTransactions(user.uid);
  listenToBudgets(user.uid);
  listenToGoals(user.uid);

  // 4. Setup Modal Forms
  setupBudgetForm(user.uid);
  setupGoalForm(user.uid);

  // 5. Initialize Sombo Assistant Widget
  initSomboAssistant(user);
});

function bindUserData(user) {
  const name = user.displayName || user.email.split("@")[0] || "User";
  const email = user.email || "";
  const firstLetter = name.charAt(0).toUpperCase();

  const welcomeName = document.getElementById("welcomeName");
  const nameDisplay = document.getElementById("userNameDisplay");
  const emailDisplay = document.getElementById("userEmailDisplay");
  const sidebarAvatar = document.getElementById("sidebarAvatar");
  const dropdownAvatar = document.getElementById("dropdownAvatar");
  const avatarDisplay = document.getElementById("userAvatarDisplay");

  if (welcomeName) welcomeName.textContent = name;
  if (nameDisplay) nameDisplay.textContent = name;
  if (emailDisplay) emailDisplay.textContent = email;
  if (sidebarAvatar) sidebarAvatar.textContent = firstLetter;
  if (dropdownAvatar) dropdownAvatar.textContent = firstLetter;
  if (avatarDisplay) avatarDisplay.textContent = firstLetter;
}

function setupLogout() {
  const logoutAction = async (btn) => {
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Signing out...";
    }
    try {
      cleanupStore();
      destroySomboAssistant();
      await signOut(auth);
      window.location.href = "./auth.html";
    } catch (err) {
      console.error("Logout error:", err);
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Log out";
      }
    }
  };

  document.getElementById("logoutBtn")?.addEventListener("click", function() { logoutAction(this); });
  document.getElementById("sidebarLogoutBtn")?.addEventListener("click", function() { logoutAction(this); });
}

function listenToTransactions(userId) {
  const txRef = collection(db, "users", userId, "transactions");
  const q = query(txRef, orderBy("date", "desc"));

  onSnapshot(q, (snapshot) => {
    let totalIncome = 0;
    let totalSpent = 0;
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

      if (isIncome) {
        totalIncome += amount;
      } else {
        totalSpent += amount;
        const cat = tx.category || "Uncategorised";
        categoryTotals[cat] = (categoryTotals[cat] || 0) + amount;
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

    const totalBalance = totalIncome - totalSpent;

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
        datasets: [{ data: [1], backgroundColor: ["#e4e4e7"] }]
      },
      options: { cutout: "75%", plugins: { legend: { display: false } } }
    });
    if (legendContainer) legendContainer.innerHTML = `<div class="text-muted small text-center">No expense breakdown available.</div>`;
    return;
  }

  const colors = ["#18181b", "#52525b", "#71717a", "#a1a1aa", "#d4d4d8"];

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
  const container = document.getElementById("budgetsContainer");
  if (!container) return;
  const budgetsRef = collection(db, "users", userId, "budgets");

  onSnapshot(budgetsRef, (snapshot) => {
    if (snapshot.empty) {
      container.innerHTML = `
        <div class="text-center py-3 text-muted small border rounded">
          <p class="mb-0">No budget limits set.</p>
        </div>`;
      return;
    }

    let html = "";
    snapshot.forEach((docSnap) => {
      const item = docSnap.data();
      const limit = parseFloat(item.limit) || 0;
      const spent = parseFloat(item.spent) || 0;
      const pct = limit > 0 ? Math.min(100, Math.round((spent / limit) * 100)) : 0;
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
  });
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
      const target = parseFloat(item.targetAmount || item.target) || 0;
      const saved = parseFloat(item.savedAmount || item.current) || 0;
      const pct = target > 0 ? Math.min(100, Math.round((saved / target) * 100)) : 0;
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

function closeModal(modalId) {
  const modalEl = document.getElementById(modalId);
  if (!modalEl) return;
  const instance = window.bootstrap?.Modal?.getInstance(modalEl);
  if (instance) instance.hide();
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
