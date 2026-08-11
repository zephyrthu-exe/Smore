import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { addDoc, collection, onSnapshot, orderBy, query, Timestamp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";
import { initSomboAssistant, destroySomboAssistant } from "./sombo-assistant.js";
import { cleanupStore, initStore } from "./store.js";
import { initProfileManager } from "./profile-manager.js";

let spendingChartInstance = null;

onAuthStateChanged(auth, (user) => {
  if (!user) {
    cleanupStore();
    destroySomboAssistant();
    window.location.replace("./index.html");
    return;
  }

  bindUserData(user);
  initProfileManager(user).catch((error) => console.error("Could not load profile:", error));
  setupLogout();
  initStore(user.uid);
  listenToTransactions(user.uid);
  listenToBudgets(user.uid);
  listenToGoals(user.uid);
  setupBudgetForm(user.uid);
  setupGoalForm(user.uid);
  initSomboAssistant(user);
});

function bindUserData(user) {
  const name = user.displayName || user.email?.split("@")[0] || "User";
  const initial = name.charAt(0).toUpperCase();
  document.getElementById("welcomeName")?.replaceChildren(name);
  document.getElementById("userNameDisplay")?.replaceChildren(name);
  document.getElementById("userEmailDisplay")?.replaceChildren(user.email || "");
  document.getElementById("sidebarAvatar")?.replaceChildren(initial);
  document.getElementById("dropdownAvatar")?.replaceChildren(initial);
}

function setupLogout() {
  const logout = async (button) => {
    if (button) button.disabled = true;
    try {
      cleanupStore();
      destroySomboAssistant();
      await signOut(auth);
      window.location.replace("./index.html");
    } catch (error) {
      console.error("Logout error:", error);
      if (button) button.disabled = false;
    }
  };
  document.getElementById("logoutBtn")?.addEventListener("click", function () { logout(this); });
  document.getElementById("sidebarLogoutBtn")?.addEventListener("click", function () { logout(this); });
}

function listenToTransactions(userId) {
  const transactions = query(collection(db, "users", userId, "transactions"), orderBy("createdAt", "desc"));
  onSnapshot(transactions, (snapshot) => {
    let income = 0;
    let expenses = 0;
    const categories = {};
    const recent = [];

    snapshot.forEach((doc, index) => {
      const transaction = doc.data();
      const amount = Number(transaction.amount) || 0;
      const isIncome = transaction.type === "income";
      if (isIncome) income += amount;
      else {
        expenses += amount;
        const category = transaction.category || "Uncategorised";
        categories[category] = (categories[category] || 0) + amount;
      }
      if (index < 5) recent.push({ ...transaction, amount, isIncome });
    });

    setText("totalBalanceText", `${(income - expenses).toLocaleString()} MMK`);
    setText("monthlyIncomeText", `${income.toLocaleString()} MMK`);
    setText("monthlyExpenseText", `${expenses.toLocaleString()} MMK`);
    renderRecentTransactions(recent);
    renderChart(categories, expenses);
  }, (error) => console.error("Could not load transactions:", error));
}

function renderRecentTransactions(transactions) {
  const container = document.getElementById("recentTransactionsContainer");
  if (!container) return;
  if (!transactions.length) {
    container.innerHTML = '<div class="text-center py-3 text-muted small border rounded">No transactions yet.</div>';
    return;
  }
  container.innerHTML = transactions.map((transaction) => `
    <div class="d-flex align-items-center justify-content-between p-2 border rounded">
      <div><div class="fw-semibold small">${escapeHtml(transaction.description || transaction.category || "Transaction")}</div><div class="text-muted" style="font-size: .75rem">${escapeHtml(transaction.category || "General")}</div></div>
      <span class="fw-bold small ${transaction.isIncome ? "text-success" : "text-danger"}">${transaction.isIncome ? "+" : "-"}${transaction.amount.toLocaleString()} MMK</span>
    </div>`).join("");
}

function renderChart(categories, totalExpense) {
  const canvas = document.getElementById("spendingChart");
  const legend = document.getElementById("chartLegend");
  if (!canvas || !window.Chart) return;
  if (spendingChartInstance) spendingChartInstance.destroy();
  const labels = Object.keys(categories);
  const values = Object.values(categories);
  const colors = ["#18181b", "#52525b", "#71717a", "#a1a1aa", "#d4d4d8"];
  spendingChartInstance = new Chart(canvas, { type: "doughnut", data: { labels: labels.length ? labels : ["No Expenses"], datasets: [{ data: values.length ? values : [1], backgroundColor: labels.length ? colors : ["#e4e4e7"] }] }, options: { cutout: "75%", plugins: { legend: { display: false } } } });
  if (legend) legend.innerHTML = totalExpense ? labels.map((label, index) => `<div class="d-flex justify-content-between mb-1"><span>${escapeHtml(label)}</span><span class="fw-bold">${Math.round(categories[label] / totalExpense * 100)}%</span></div>`).join("") : '<div class="text-muted small">No expense breakdown available.</div>';
}

function listenToBudgets(userId) { listenToCollection(userId, "budgets", "budgetsContainer", "No budget limits set.", (item) => `<div class="p-2 border rounded"><div class="d-flex justify-content-between small mb-1"><span class="fw-semibold">${escapeHtml(item.category || "Budget")}</span><span>${Number(item.spent || 0).toLocaleString()} / ${Number(item.limit || 0).toLocaleString()} MMK</span></div><div class="progress" style="height:6px"><div class="progress-bar bg-dark" style="width:${Math.min(100, Math.round((Number(item.spent || 0) / Number(item.limit || 1)) * 100))}%"></div></div></div>`); }
function listenToGoals(userId) { listenToCollection(userId, "goals", "goalsContainer", "No savings goals added yet.", (item) => { const target = Number(item.targetAmount || item.target || 0); const saved = Number(item.savedAmount || item.current || 0); return `<div class="d-flex gap-3 p-2 border rounded"><div class="fw-bold">${target ? Math.min(100, Math.round(saved / target * 100)) : 0}%</div><div><div class="fw-semibold small">${escapeHtml(item.title || item.name || "Goal")}</div><div class="text-muted small">${saved.toLocaleString()} / ${target.toLocaleString()} MMK</div></div></div>`; }); }
function listenToCollection(userId, name, containerId, empty, render) { onSnapshot(collection(db, "users", userId, name), (snapshot) => { const container = document.getElementById(containerId); if (container) container.innerHTML = snapshot.empty ? `<div class="text-center py-3 text-muted small border rounded">${empty}</div>` : snapshot.docs.map((doc) => render(doc.data())).join(""); }); }

function setupBudgetForm(userId) { document.getElementById("adjustBudgetForm")?.addEventListener("submit", async (event) => { event.preventDefault(); const category = document.getElementById("budgetCategory").value; const limit = Number(document.getElementById("limitAmount").value); if (!category || limit <= 0) return; await addDoc(collection(db, "users", userId, "budgets"), { category, limit, spent: 0, createdAt: Timestamp.now() }); closeModal("adjustBudgetModal"); event.target.reset(); }); }
function setupGoalForm(userId) { document.getElementById("addGoalForm")?.addEventListener("submit", async (event) => { event.preventDefault(); const title = document.getElementById("goalName").value.trim(); const targetAmount = Number(document.getElementById("targetAmount").value); const savedAmount = Number(document.getElementById("goalInitial").value) || 0; if (!title || targetAmount <= 0) return; await addDoc(collection(db, "users", userId, "goals"), { title, targetAmount, savedAmount, createdAt: Timestamp.now() }); closeModal("addGoalModal"); event.target.reset(); }); }
function closeModal(id) { const element = document.getElementById(id); window.bootstrap?.Modal?.getInstance(element)?.hide(); }
function setText(id, text) { document.getElementById(id)?.replaceChildren(text); }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character])); }
