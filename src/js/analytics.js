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

    // Render Charts
    renderTrendChart(totalIncome, totalExpenses);
    renderCategoryChart(categoryMap, totalExpenses);
  });
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
          backgroundColor: ["#16a34a", "#dc2626"],
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
        datasets: [{ data: [1], backgroundColor: ["#e4e4e7"] }]
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

  const colors = ["#18181b", "#52525b", "#71717a", "#a1a1aa", "#d4d4d8", "#e4e4e7"];

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
