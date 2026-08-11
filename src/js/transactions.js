import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, Timestamp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";
import { initSomboAssistant, destroySomboAssistant } from "./sombo-assistant.js";
import { cleanupStore, initStore } from "./store.js";
import { initProfileManager } from "./profile-manager.js";

let transactions = [];

onAuthStateChanged(auth, (user) => {
  if (!user) { cleanupStore(); destroySomboAssistant(); window.location.replace("./index.html"); return; }
  bindUser(user); initProfileManager(user).catch((error) => console.error("Could not load profile:", error)); initStore(user.uid); listenToTransactions(user.uid); setupForm(user.uid); setupFilters(); setupLogout(); initSomboAssistant(user);
});

function bindUser(user) {
  const name = user.displayName || user.email?.split("@")[0] || "User";
  const initial = name.charAt(0).toUpperCase();
  setText("userNameDisplay", name); setText("userEmailDisplay", user.email || ""); setText("sidebarAvatar", initial); setText("dropdownAvatar", initial);
}

function listenToTransactions(userId) {
  onSnapshot(query(collection(db, "users", userId, "transactions"), orderBy("createdAt", "desc")), (snapshot) => {
    transactions = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    updateStats(); renderTable();
  }, (error) => console.error("Could not load transactions:", error));
}

function updateStats() {
  const income = transactions.filter((item) => item.type === "income").reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const spent = transactions.filter((item) => item.type !== "income").reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  setText("statTotalCount", transactions.length); setText("statTotalSpent", `${spent.toLocaleString()} MMK`); setText("statTotalReceived", `${income.toLocaleString()} MMK`);
}

function renderTable() {
  const body = document.getElementById("txTableBody");
  const empty = document.getElementById("emptyStateCol");
  if (!body) return;
  const search = document.getElementById("searchTxInput")?.value.toLowerCase().trim() || "";
  const category = document.getElementById("categoryFilter")?.value || "All";
  const filtered = transactions.filter((item) => (category === "All" || item.category === category || (category === "Income" && item.type === "income")) && `${item.description || ""} ${item.category || ""}`.toLowerCase().includes(search));
  empty?.classList.toggle("d-none", filtered.length > 0);
  body.innerHTML = filtered.map((item) => {
    const amount = Number(item.amount) || 0;
    const income = item.type === "income";
    const date = item.createdAt?.toDate?.().toLocaleDateString() || "Recent";
    return `<tr><td>${escapeHtml(date)}</td><td class="fw-semibold">${escapeHtml(item.description || "Transaction")}</td><td><span class="badge bg-light text-dark border">${escapeHtml(item.category || "General")}</span></td><td class="text-end fw-bold ${income ? "text-success" : "text-danger"}">${income ? "+" : "-"}${amount.toLocaleString()} MMK</td><td class="text-center"><button class="btn btn-sm btn-outline-danger border-0" data-delete-id="${item.id}" aria-label="Delete transaction"><i class="bi bi-trash"></i></button></td></tr>`;
  }).join("");
  body.querySelectorAll("[data-delete-id]").forEach((button) => button.addEventListener("click", () => deleteTransaction(button.dataset.deleteId)));
}

function setupFilters() { document.getElementById("searchTxInput")?.addEventListener("input", renderTable); document.getElementById("categoryFilter")?.addEventListener("change", renderTable); }

function setupForm(userId) {
  document.getElementById("addTxForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = document.getElementById("saveTxBtn"); button.disabled = true;
    try {
      const type = document.getElementById("txType").value;
      const description = document.getElementById("txDescription").value.trim();
      const category = document.getElementById("txCategory").value;
      const amount = Number(document.getElementById("txAmount").value);
      if (!description || amount <= 0) return;
      await addDoc(collection(db, "users", userId, "transactions"), { type, description, category, amount, createdAt: Timestamp.now() });
      closeModal("addTxModal"); event.target.reset();
    } catch (error) { alert(`Could not save transaction: ${error.message}`); } finally { button.disabled = false; }
  });
}

async function deleteTransaction(id) {
  if (!confirm("Delete this transaction?")) return;
  try { await deleteDoc(doc(db, "users", auth.currentUser.uid, "transactions", id)); } catch (error) { alert(`Could not delete transaction: ${error.message}`); }
}

function setupLogout() { document.getElementById("sidebarLogoutBtn")?.addEventListener("click", async function () { this.disabled = true; cleanupStore(); destroySomboAssistant(); await signOut(auth); window.location.replace("./index.html"); }); }
function closeModal(id) { window.bootstrap?.Modal?.getInstance(document.getElementById(id))?.hide(); }
function setText(id, value) { document.getElementById(id)?.replaceChildren(String(value)); }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character])); }
