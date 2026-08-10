import { auth, db } from "./firebase-config.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
  doc, getDoc, setDoc, addDoc, collection, onSnapshot, query, orderBy, limit 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let spendingChartInstance = null;

document.addEventListener("DOMContentLoaded", () => {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      await initializeUserDocIfNeeded(user);
      bindUserData(user);
      listenToTransactionsAndUpdateDashboard(user.uid);
      listenToGoals(user.uid);
      listenToBudgets(user.uid);
    } else {
      window.location.href = "auth.html";
    }
  });

  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) logoutBtn.addEventListener("click", () => signOut(auth));

  setupGoalForm();
  setupBudgetForm();
});

async function initializeUserDocIfNeeded(user) {
  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);

  if (!snap.exists()) {
    await setDoc(userRef, {
      name: user.displayName || user.email.split("@")[0] || "User",
      email: user.email,
      createdAt: new Date()
    });
  }
}

// Sidebar Profile Binding
async function bindSidebarUser(user) {
  const nameEl = document.getElementById("userNameDisplay");
  const avatarEl = document.getElementById("userAvatarDisplay");
  let fullName = user.displayName || user.email.split("@")[0];
  if (nameEl) nameEl.textContent = fullName;
  if (avatarEl) avatarEl.textContent = fullName.charAt(0).toUpperCase();
}


// // User Profile Binding
// function bindUserData(user) {
//   const name = user.displayName || user.email.split("@")[0] || "User";
//   document.getElementById("welcomeName").textContent = name;
//   document.getElementById("userNameDisplay").textContent = name;
//   document.getElementById("userEmailDisplay").textContent = user.email || "";

//   const initials = name
//     .split(" ")
//     .map((n) => n[0])
//     .join("")
//     .toUpperCase()
//     .substring(0, 2) || "U";

//   const avatarElements = document.querySelectorAll(".sidebar-user .bg-warning, .user-avatar-sm");
//   avatarElements.forEach((el) => {
//     el.textContent = initials;
//   });
// }

// Transaction များမှ Total Balance, Income, Expense များကို Auto Calculate လုပ်ခြင်း
function listenToTransactionsAndUpdateDashboard(userId) {
  const txRef = collection(db, "users", userId, "transactions");
  const q = query(txRef, orderBy("createdAt", "desc"));

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
        recentTxContainer.innerHTML = `<div class="text-center py-4 text-muted small border rounded">No transactions yet.</div>`;
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
        categoryTotals[tx.category] = (categoryTotals[tx.category] || 0) + amount;
      }

      // Recent Transactions Top 5
      if (index < 5 && recentTxContainer) {
        recentHtml += `
          <div class="d-flex align-items-center justify-content-between p-2 border rounded">
            <div>
              <div class="fw-semibold small">${escapeHtml(tx.description || tx.category)}</div>
              <div class="text-muted style-small" style="font-size: 0.75rem;">${tx.category}</div>
            </div>
            <span class="fw-bold small ${isIncome ? 'text-success' : 'text-danger'}">
              ${isIncome ? '+' : '-'}${amount.toLocaleString()} MMK
            </span>
          </div>`;
      }
    });

    const totalBalance = totalIncome - totalSpent;

    // Dashboard UI သို့ Update ပြုလုပ်ခြင်း
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
    legendContainer.innerHTML = `<div class="text-muted small">No expense breakdown available.</div>`;
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
      <div class="d-flex align-items-center justify-content-between mb-2">
        <span class="text-truncate"><span class="d-inline-block rounded-circle me-1" style="width:8px; height:8px; background:${colors[index % colors.length]}"></span>${escapeHtml(cat)}</span>
        <span class="fw-bold ms-2">${pct}%</span>
      </div>`;
  });
  legendContainer.innerHTML = legendHtml;
}

function listenToGoals(userId) {
  const container = document.getElementById("goalsContainer");
  if (!container) return;
  const goalsRef = collection(db, "users", userId, "goals");

  onSnapshot(goalsRef, (snapshot) => {
    if (snapshot.empty) {
      container.innerHTML = `
        <div class="text-center py-4 text-muted small border rounded">
          <p class="mb-1">No savings goals added yet.</p>
        </div>`;
      return;
    }

    let html = "";
    snapshot.forEach((docSnap) => {
      const item = docSnap.data();
      const pct = item.target > 0 ? Math.min(100, Math.round((item.current / item.target) * 100)) : 0;
      html += `
        <div class="d-flex align-items-center gap-3 p-2 border rounded">
          <div class="rounded-circle border border-dark text-dark d-flex align-items-center justify-content-center fw-bold" style="width: 44px; height: 44px; font-size: 0.8rem; flex-shrink: 0;">
            ${pct}%
          </div>
          <div class="flex-grow-1">
            <div class="fw-semibold small">${escapeHtml(item.name)}</div>
            <div class="text-muted small">${(item.current || 0).toLocaleString()} / ${(item.target || 0).toLocaleString()} MMK</div>
          </div>
        </div>`;
    });
    container.innerHTML = html;
  });
}

function listenToBudgets(userId) {
  const container = document.getElementById("budgetsContainer");
  if (!container) return;
  const budgetsRef = collection(db, "users", userId, "budgets");

  onSnapshot(budgetsRef, (snapshot) => {
    if (snapshot.empty) {
      container.innerHTML = `
        <div class="text-center py-4 text-muted small border rounded">
          <p class="mb-1">No budget limits set.</p>
        </div>`;
      return;
    }

    let html = "";
    snapshot.forEach((docSnap) => {
      const item = docSnap.data();
      const pct = item.limit > 0 ? Math.min(100, Math.round(((item.spent || 0) / item.limit) * 100)) : 0;
      html += `
        <div class="p-2 border rounded">
          <div class="d-flex justify-content-between small mb-1">
            <span class="fw-semibold">${escapeHtml(item.category)}</span>
            <span>${(item.spent || 0).toLocaleString()} / ${(item.limit || 0).toLocaleString()} MMK</span>
          </div>
          <div class="progress" style="height: 6px;">
            <div class="progress-bar bg-dark" style="width: ${pct}%"></div>
          </div>
        </div>`;
    });
    container.innerHTML = html;
  });
}

function setupGoalForm() {
  const form = document.getElementById("addGoalForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const user = auth.currentUser;
    if (!user) return;

    const name = document.getElementById("goalName").value.trim();
    const target = parseFloat(document.getElementById("targetAmount").value) || 0;
    const current = parseFloat(document.getElementById("currentAmount").value) || 0;

    await addDoc(collection(db, "users", user.uid, "goals"), {
      name, target, current, createdAt: new Date()
    });

    closeModal("addGoalModal");
    form.reset();
  });
}

function setupBudgetForm() {
  const form = document.getElementById("adjustBudgetForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const user = auth.currentUser;
    if (!user) return;

    const category = document.getElementById("budgetCategory").value;
    const limit = parseFloat(document.getElementById("limitAmount").value) || 0;

    await addDoc(collection(db, "users", user.uid, "budgets"), {
      category, limit, spent: 0, updatedAt: new Date()
    });

    closeModal("adjustBudgetModal");
    form.reset();
  });
}

function closeModal(modalId) {
  const modalEl = document.getElementById(modalId);
  const instance = bootstrap.Modal.getInstance(modalEl);
  if (instance) instance.hide();
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

