import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { collection, onSnapshot, orderBy, query } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";
import { initSomboAssistant, destroySomboAssistant } from "./sombo-assistant.js";
import { cleanupStore, initStore } from "./store.js";
import { initProfileManager } from "./profile-manager.js";

let transactions = []; let selectedRange = "month"; let trendChart; let categoryChart;
onAuthStateChanged(auth, (user) => { if (!user) { cleanupStore(); destroySomboAssistant(); window.location.replace("./index.html"); return; } bindUser(user); initProfileManager(user).catch((error) => console.error("Could not load profile:", error)); initStore(user.uid); listen(user.uid); bindRangeButtons(); setupLogout(); initSomboAssistant(user); });

function bindUser(user) { const name = user.displayName || user.email?.split("@")[0] || "User"; const initial = name.charAt(0).toUpperCase(); setText("userNameDisplay", name); setText("userEmailDisplay", user.email || ""); setText("sidebarAvatar", initial); setText("dropdownAvatar", initial); }
function listen(userId) { onSnapshot(query(collection(db, "users", userId, "transactions"), orderBy("createdAt", "desc")), (snapshot) => { transactions = snapshot.docs.map((entry) => entry.data()); render(); }, (error) => console.error("Could not load analytics:", error)); }
function bindRangeButtons() { document.querySelectorAll(".analytics-range-option").forEach((button) => button.addEventListener("click", () => { selectedRange = button.dataset.range; setText("analyticsRangeButton", button.textContent); render(); })); }
function render() {
  const filtered = transactions.filter(inRange); let income = 0; let expenses = 0; const categories = {};
  filtered.forEach((item) => { const amount = Number(item.amount) || 0; if (item.type === "income") income += amount; else { expenses += amount; const category = item.category || "General"; categories[category] = (categories[category] || 0) + amount; } });
  const savings = income - expenses; const rate = income ? Math.max(0, Math.round(savings / income * 100)) : 0;
  setText("analyticsIncomeText", `${income.toLocaleString()} MMK`); setText("analyticsExpenseText", `${expenses.toLocaleString()} MMK`); setText("analyticsNetSavingsText", `${savings.toLocaleString()} MMK`); document.getElementById("analyticsSavingsRateText").innerHTML = `<i class="bi bi-wallet2"></i> ${rate}% savings rate`;
  renderTrend(income, expenses); renderCategories(categories);
}
function inRange(item) { const date = item.createdAt?.toDate?.() || item.date?.toDate?.(); if (!date) return selectedRange === "year"; const now = new Date(); if (selectedRange === "year") return date.getFullYear() === now.getFullYear(); const month = selectedRange === "last-month" ? (now.getMonth() + 11) % 12 : now.getMonth(); const year = selectedRange === "last-month" && now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear(); return date.getFullYear() === year && date.getMonth() === month; }
function renderTrend(income, expenses) { const canvas = document.getElementById("trendChart"); if (!canvas || !window.Chart) return; trendChart?.destroy(); trendChart = new Chart(canvas, { type: "bar", data: { labels: ["Income", "Expenses"], datasets: [{ data: [income, expenses], backgroundColor: ["#16a34a", "#dc2626"], borderRadius: 6 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } } }); }
function renderCategories(categories) { const canvas = document.getElementById("categoryChart"); if (!canvas || !window.Chart) return; categoryChart?.destroy(); const labels = Object.keys(categories); categoryChart = new Chart(canvas, { type: "doughnut", data: { labels: labels.length ? labels : ["No expenses"], datasets: [{ data: labels.length ? Object.values(categories) : [1], backgroundColor: labels.length ? ["#18181b", "#52525b", "#71717a", "#a1a1aa", "#d4d4d8"] : ["#e4e4e7"] }] }, options: { responsive: true, maintainAspectRatio: false, cutout: "70%" } }); }
function setupLogout() { document.getElementById("sidebarLogoutBtn")?.addEventListener("click", async function () { this.disabled = true; cleanupStore(); destroySomboAssistant(); await signOut(auth); window.location.replace("./index.html"); }); }
function setText(id, value) { document.getElementById(id)?.replaceChildren(String(value)); }
