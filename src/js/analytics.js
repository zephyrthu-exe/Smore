// analytics.js
// Analytics page: summarizes income and expenses with summary cards, a trend
// bar chart, and a category doughnut chart, all filterable by category and
// date range.

import { collection, onSnapshot, query, orderBy } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";
import { startAuthenticatedPage } from "./app-shell.js";

let trendChartInstance = null;
let categoryChartInstance = null;

let allTransactionsAnalytics = [];

// Entry point: protect the page (redirect to login if signed out), then start
// listening for the current user's transactions.
startAuthenticatedPage((user) => {
  listenToAnalyticsData(user.uid);
});

// Keeps allTransactionsAnalytics in sync with Firestore and re-renders the
// whole page (respecting the currently selected filters).
function listenToAnalyticsData(userId) {
  const q = query(collection(db, "users", userId, "transactions"), orderBy("createdAt", "desc"));

  onSnapshot(q, (snapshot) => {
    allTransactionsAnalytics = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    updateAnalyticsView();
  });
}

// Reads the current filter values from the filter controls.
function getAnalyticsFilters() {
  const category = document.getElementById('analyticsCategoryFilter')?.value || 'All';
  const dateVal = document.getElementById('analyticsDateFilter')?.value || 'all';
  const customStart = document.getElementById('analyticsCustomDateStart')?.value;
  const customEnd = document.getElementById('analyticsCustomDateEnd')?.value;
  return { category, dateVal, customStart, customEnd };
}

// Returns true when the transaction falls inside the selected date range.
function applyAnalyticsDateFilterToTx(tx, dateVal, customStart, customEnd) {
  const now = new Date();
  let rangeStart = null;
  let rangeEnd = null;

  if (dateVal === 'today') {
    rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    rangeEnd = new Date(rangeStart);
    rangeEnd.setDate(rangeEnd.getDate() + 1);
  } else if (dateVal === 'last7') {
    rangeEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    rangeStart = new Date(rangeEnd);
    rangeStart.setDate(rangeStart.getDate() - 7);
  } else if (dateVal === 'last30') {
    rangeEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    rangeStart = new Date(rangeEnd);
    rangeStart.setDate(rangeStart.getDate() - 30);
  } else if (dateVal === 'thisMonth') {
    rangeStart = new Date(now.getFullYear(), now.getMonth(), 1);
    rangeEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  } else if (dateVal === 'custom') {
    if (customStart) rangeStart = new Date(customStart);
    if (customEnd) { rangeEnd = new Date(customEnd); rangeEnd.setDate(rangeEnd.getDate() + 1); }
  }

  if (!rangeStart) return true; // no date filtering

  let txDate = null;
  if (tx.date && typeof tx.date.toDate === 'function') txDate = tx.date.toDate();
  else if (tx.createdAt && typeof tx.createdAt.toDate === 'function') txDate = tx.createdAt.toDate();
  else if (tx.date) txDate = new Date(tx.date);

  if (!txDate) return false; // cannot evaluate -> exclude
  return txDate >= rangeStart && (rangeEnd ? txDate < rangeEnd : true);
}

// Recomputes every summary, text block and chart from the filtered data.
function updateAnalyticsView() {
  const { category, dateVal, customStart, customEnd } = getAnalyticsFilters();

  // apply filters
  let totalIncome = 0;
  let totalExpenses = 0;
  const categoryMap = {};

  const filtered = allTransactionsAnalytics.filter((tx) => {
    if (category !== 'All') {
      if (category === 'Income') {
        if (tx.type !== 'income') return false;
      } else if (tx.category !== category) return false;
    }
    if (!applyAnalyticsDateFilterToTx(tx, dateVal, customStart, customEnd)) return false;
    return true;
  });

  filtered.forEach((tx) => {
    const amt = parseFloat(tx.amount) || 0;
    if (tx.type === 'income') totalIncome += amt;
    else {
      totalExpenses += amt;
      const cat = tx.category || 'General';
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
}

// Wires the UI listeners for the analytics filters.
function setupAnalyticsFilters() {
  const catSel = document.getElementById('analyticsCategoryFilter');
  const dateSel = document.getElementById('analyticsDateFilter');
  const customWrap = document.getElementById('analyticsCustomDateInputs');
  const applyBtn = document.getElementById('analyticsApplyCustomDateBtn');

  const update = () => updateAnalyticsView();
  catSel?.addEventListener('change', update);
  dateSel?.addEventListener('change', () => {
    if (dateSel.value === 'custom') customWrap?.classList.remove('d-none');
    else { customWrap?.classList.add('d-none'); update(); }
  });
  applyBtn?.addEventListener('click', update);
}

// Initialize the filter listeners (the controls live in the static HTML).
setupAnalyticsFilters();

// One-line summary for the category text block.
function categoriesSummary(categoryMap, totalExpenses) {
  const categories = Object.entries(categoryMap);
  if (!categories.length || totalExpenses === 0) return "No expenses recorded yet.";
  const [topCategory, topValue] = categories.sort((a, b) => b[1] - a[1])[0];
  return `${topCategory} is the largest recorded category at ${topValue.toLocaleString()} MMK.`;
}

// A short, machine-readable recap used for the hidden summary attribute.
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

