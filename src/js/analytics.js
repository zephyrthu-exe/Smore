import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { collection, onSnapshot, query, orderBy } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";
import { initSomboAssistant, destroySomboAssistant } from "./sombo-assistant.js";
import { initStore, cleanupStore } from "./store.js";
import { enhanceAccountMenu } from "./account-menu.js";

let trendChartInstance = null;
let categoryChartInstance = null;

onAuthStateChanged(auth, (user) => {
  if (!user) {
    cleanupStore();
    destroySomboAssistant();
    window.location.replace("./index.html");
    return;
  }

  // 1. Bind User Info
  bindUserData(user);

  // 2. Setup Logout
  enhanceAccountMenu(user);
  setupLogout();

  // 3. Initialize Realtime Listeners
  initStore(user.uid);
  listenToAnalyticsData(user.uid);

  // 4. Initialize Sombo Assistant Widget
  initSomboAssistant(user);
});

function bindUserData(user) {
  const name = user.displayName || user.email?.split("@")[0] || "User";
  const email = user.email || "";
  const firstLetter = name.charAt(0).toUpperCase();

  const nameDisplay = document.getElementById("userNameDisplay");
  const emailDisplay = document.getElementById("userEmailDisplay");
  const sidebarAvatar = document.getElementById("sidebarAvatar");
  const dropdownAvatar = document.getElementById("dropdownAvatar");
  const avatarDisplay = document.getElementById("userAvatarDisplay");

  if (nameDisplay) nameDisplay.textContent = name;
  if (emailDisplay) emailDisplay.textContent = email;
  if (sidebarAvatar) sidebarAvatar.textContent = firstLetter;
  if (dropdownAvatar) dropdownAvatar.textContent = firstLetter;
  if (avatarDisplay) avatarDisplay.textContent = firstLetter;
}

function setupLogout() {
  document.getElementById("sidebarLogoutBtn")?.addEventListener("click", async function() {
    this.disabled = true;
    this.textContent = "Signing out...";
    try {
      cleanupStore();
      destroySomboAssistant();
      await signOut(auth);
      window.location.href = "./index.html";
    } catch (err) {
      console.error("Logout error:", err);
      this.disabled = false;
      this.textContent = "Log Out";
    }
  });
}

function listenToAnalyticsData(userId) {
  const q = query(collection(db, "users", userId, "transactions"), orderBy("createdAt", "desc"));

  onSnapshot(q, (snapshot) => {
    let totalIncome = 0;
    let totalExpenses = 0;
    const categoryMap = {};

    snapshot.forEach((docSnap) => {
      const tx = docSnap.data();
      const amt = parseFloat(tx.amount) || 0;
      if (tx.type === "income") {
        totalIncome += amt;
      } else {
        totalExpenses += amt;
        const cat = tx.category || "General";
        categoryMap[cat] = (categoryMap[cat] || 0) + amt;
      }
    });

    const netSavings = totalIncome - totalExpenses;
    const savingsRate = totalIncome > 0 ? Math.max(0, Math.round((netSavings / totalIncome) * 100)) : 0;

    // Update Summary Cards
    const incomeEl = document.getElementById("analyticsIncomeText");
    const expenseEl = document.getElementById("analyticsExpenseText");
    const netSavingsEl = document.getElementById("analyticsNetSavingsText");
    const rateEl = document.getElementById("analyticsSavingsRateText");

    if (incomeEl) incomeEl.textContent = `${totalIncome.toLocaleString()} MMK`;
    if (expenseEl) expenseEl.textContent = `${totalExpenses.toLocaleString()} MMK`;
    if (netSavingsEl) netSavingsEl.textContent = `${netSavings.toLocaleString()} MMK`;
    if (rateEl) rateEl.innerHTML = `<i class="bi bi-wallet2"></i> ${savingsRate}% savings rate`;

    const insightEl = document.getElementById("analyticsInsightText");
    const trendSummaryEl = document.getElementById("analyticsTrendSummary");
    const categorySummaryEl = document.getElementById("analyticsCategorySummary");
    const trendDataEl = document.getElementById("trendChartData");
    const categoryDataEl = document.getElementById("categoryChartData");
    if (insightEl) {
      insightEl.textContent = totalIncome > 0
        ? `${savingsRate}% of recorded income remains after expenses.`
        : "Add an income and a few expenses to see your money story take shape.";
    }
    if (trendSummaryEl) trendSummaryEl.textContent = `Recorded income is ${totalIncome.toLocaleString()} MMK and recorded expenses are ${totalExpenses.toLocaleString()} MMK.`;
    if (categorySummaryEl) {
      categorySummaryEl.textContent = categoriesSummary(categoryMap, totalExpenses);
    }
    if (trendDataEl) trendDataEl.textContent = `Income: ${totalIncome.toLocaleString()} MMK. Expenses: ${totalExpenses.toLocaleString()} MMK. Net savings: ${netSavings.toLocaleString()} MMK.`;
    if (categoryDataEl) categoryDataEl.textContent = categoryDataSummary(categoryMap, totalExpenses);

    // Render Charts
    renderTrendChart(totalIncome, totalExpenses);
    renderCategoryChart(categoryMap, totalExpenses);
  });
}

function categoriesSummary(categoryMap, totalExpenses) {
  const categories = Object.entries(categoryMap);
  if (!categories.length || totalExpenses === 0) return "No expenses recorded yet.";
  const [topCategory, topValue] = categories.sort((a, b) => b[1] - a[1])[0];
  return `${topCategory} is the largest recorded category at ${topValue.toLocaleString()} MMK.`;
}

function categoryDataSummary(categoryMap, totalExpenses) {
  const categories = Object.entries(categoryMap);
  if (!categories.length || totalExpenses === 0) return "No expense categories to display.";
  return categories.map(([category, value]) => `${category}: ${value.toLocaleString()} MMK`).join(". ");
}

function renderTrendChart(income, expenses) {
  const ctx = document.getElementById("trendChart")?.getContext("2d");
  if (!ctx) return;

  if (trendChartInstance) trendChartInstance.destroy();

  trendChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["Total Income", "Total Expenses"],
      datasets: [
        {
          label: "MMK",
          data: [income, expenses],
          backgroundColor: ["#3b8f72", "#d9654f"],
          borderRadius: 6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: "rgba(25, 59, 58, 0.1)" },
          ticks: {
            callback: (val) => `${val.toLocaleString()} MMK`
          }
        }
      }
    }
  });
}

function renderCategoryChart(categoryMap, totalExpenses) {
  const ctx = document.getElementById("categoryChart")?.getContext("2d");
  if (!ctx) return;

  if (categoryChartInstance) categoryChartInstance.destroy();

  const categories = Object.keys(categoryMap);
  const values = Object.values(categoryMap);

  if (categories.length === 0 || totalExpenses === 0) {
    categoryChartInstance = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: ["No Expenses"],
        datasets: [{ data: [1], backgroundColor: ["#d7e4de"] }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "70%",
        plugins: { legend: { position: "bottom" } }
      }
    });
    return;
  }

  const colors = ["#d9654f", "#3b8f72", "#d79a3d", "#5f8fa3", "#8d78a8", "#78958b"];

  categoryChartInstance = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: categories,
      datasets: [{ data: values, backgroundColor: colors }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "70%",
      plugins: {
        legend: { position: "bottom" }
      }
    }
  });
}
