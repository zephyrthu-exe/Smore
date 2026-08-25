import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { collection, onSnapshot, query, orderBy, addDoc, deleteDoc, doc, Timestamp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";
import { initSomboAssistant, destroySomboAssistant } from "./sombo-assistant.js";
import { initStore, cleanupStore } from "./store.js";
import { enhanceAccountMenu } from "./account-menu.js";

let allTransactions = [];
let transactionHashListenerBound = false;

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
  listenToTransactions(user.uid);

  // 4. Setup Form and Filter Handlers
  setupAddTransactionForm(user.uid);
  setupSearchAndFilters();
  openTransactionModalFromHash();
  if (!transactionHashListenerBound) {
    window.addEventListener("hashchange", openTransactionModalFromHash);
    transactionHashListenerBound = true;
  }

  // 5. Initialize Sombo Assistant Widget
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

function listenToTransactions(userId) {
  const q = query(collection(db, "users", userId, "transactions"), orderBy("createdAt", "desc"));

  onSnapshot(q, (snapshot) => {
    allTransactions = [];
    let totalSpent = 0;
    let totalReceived = 0;

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      allTransactions.push({ id: docSnap.id, ...data });

      const amt = parseFloat(data.amount) || 0;
      if (data.type === "expense") {
        totalSpent += amt;
      } else {
        totalReceived += amt;
      }
    });

    // Update Top Stats
    document.getElementById("statTotalCount").textContent = allTransactions.length;
    document.getElementById("statTotalSpent").textContent = `${totalSpent.toLocaleString()} MMK`;
    document.getElementById("statTotalReceived").textContent = `${totalReceived.toLocaleString()} MMK`;

    // Render Table
    renderFilteredTable(userId);
  });
}

function renderFilteredTable(userId) {
  const searchInput = document.getElementById("searchTxInput");
  const categoryFilter = document.getElementById("categoryFilter");
  const dateFilter = document.getElementById("dateFilter");
  const customStart = document.getElementById("customDateStart");
  const customEnd = document.getElementById("customDateEnd");
  const tableBody = document.getElementById("txTableBody");
  const emptyState = document.getElementById("emptyStateCol");

  if (!tableBody) return;

  const searchQuery = (searchInput?.value || "").toLowerCase().trim();
  const categoryVal = categoryFilter?.value || "All";
  const dateVal = dateFilter?.value || "all";

  // compute date range based on dateVal
  const now = new Date();
  let rangeStart = null;
  let rangeEnd = null;

  if (dateVal === "today") {
    rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    rangeEnd = new Date(rangeStart);
    rangeEnd.setDate(rangeEnd.getDate() + 1);
  } else if (dateVal === "last7") {
    rangeEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    rangeStart = new Date(rangeEnd);
    rangeStart.setDate(rangeStart.getDate() - 7);
  } else if (dateVal === "last30") {
    rangeEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    rangeStart = new Date(rangeEnd);
    rangeStart.setDate(rangeStart.getDate() - 30);
  } else if (dateVal === "thisMonth") {
    rangeStart = new Date(now.getFullYear(), now.getMonth(), 1);
    rangeEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  } else if (dateVal === "custom") {
    if (customStart?.value) {
      rangeStart = new Date(customStart.value);
    }
    if (customEnd?.value) {
      // include the end day fully
      rangeEnd = new Date(customEnd.value);
      rangeEnd.setDate(rangeEnd.getDate() + 1);
    }
  }

  const filtered = allTransactions.filter((tx) => {
    const desc = (tx.description || "").toLowerCase();
    const cat = (tx.category || "").toLowerCase();
    const matchesSearch = !searchQuery || desc.includes(searchQuery) || cat.includes(searchQuery);
    const matchesCategory = categoryVal === "All" || tx.category === categoryVal || (categoryVal === "Income" && tx.type === "income");

    // compute txDate (prefer tx.date then createdAt)
    let txDate = null;
    if (tx.date && typeof tx.date.toDate === 'function') txDate = tx.date.toDate();
    else if (tx.createdAt && typeof tx.createdAt.toDate === 'function') txDate = tx.createdAt.toDate();
    else if (tx.date) txDate = new Date(tx.date);

    let matchesDate = true;
    if (rangeStart && txDate) {
      matchesDate = txDate >= rangeStart && (rangeEnd ? txDate < rangeEnd : true);
    } else if (rangeStart && !txDate) {
      // if tx has no date info, exclude when a range is selected
      matchesDate = false;
    }

    return matchesSearch && matchesCategory && matchesDate;
  });

  if (filtered.length === 0) {
    tableBody.innerHTML = "";
    emptyState?.classList.remove("d-none");
    return;
  }

  emptyState?.classList.add("d-none");

  let html = "";
  filtered.forEach((tx) => {
    const amt = parseFloat(tx.amount) || 0;
    const isIncome = tx.type === "income";
    let dateStr = "Recent";

    if (tx.date && typeof tx.date.toDate === "function") {
      dateStr = tx.date.toDate().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    } else if (tx.createdAt && typeof tx.createdAt.toDate === "function") {
      dateStr = tx.createdAt.toDate().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    }

    html += `
      <tr>
        <td>${escapeHtml(dateStr)}</td>
        <td class="fw-semibold">${escapeHtml(tx.description || tx.category || "Transaction")}</td>
        <td><span class="badge bg-light text-dark border">${escapeHtml(tx.category || "General")}</span></td>
        <td class="text-end fw-bold ${isIncome ? 'text-success' : 'text-danger'}">
          ${isIncome ? '+' : '-'}${amt.toLocaleString()} MMK
        </td>
        <td class="text-center">
          <button class="btn btn-sm btn-outline-danger border-0 py-0" onclick="deleteTxRecord('${tx.id}')">
            <i class="bi bi-trash"></i>
          </button>
        </td>
      </tr>`;
  });

  tableBody.innerHTML = html;
}

window.deleteTxRecord = async (txId) => {
  const user = auth.currentUser;
  if (!user) return;
  if (confirm("Are you sure you want to delete this transaction?")) {
    try {
      await deleteDoc(doc(db, "users", user.uid, "transactions", txId));
    } catch (err) {
      alert("Failed to delete transaction: " + err.message);
    }
  }
};

function setupAddTransactionForm(userId) {
  const form = document.getElementById("addTxForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const saveBtn = document.getElementById("saveTxBtn");
    if (saveBtn) saveBtn.disabled = true;

    const type = document.getElementById("txType").value;
    const description = document.getElementById("txDescription").value.trim();
    const category = document.getElementById("txCategory").value;
    const amount = parseFloat(document.getElementById("txAmount").value) || 0;

    if (!description || amount <= 0) {
      if (saveBtn) saveBtn.disabled = false;
      return;
    }

    try {
      await addDoc(collection(db, "users", userId, "transactions"), {
        type,
        description,
        category,
        amount,
        date: Timestamp.now(),
        createdAt: Timestamp.now()
      });

      form.reset();
      const modalEl = document.getElementById("addTxModal");
      if (modalEl) {
        const modal = window.bootstrap?.Modal?.getInstance(modalEl);
        if (modal) modal.hide();
      }
    } catch (err) {
      alert("Error adding transaction: " + err.message);
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  });
}

function setupSearchAndFilters() {
  const searchInput = document.getElementById("searchTxInput");
  const categoryFilter = document.getElementById("categoryFilter");
  const dateFilter = document.getElementById("dateFilter");
  const customDateInputs = document.getElementById("customDateInputs");
  const applyCustomBtn = document.getElementById("applyCustomDateBtn");

  const update = () => {
    const user = auth.currentUser;
    if (user) renderFilteredTable(user.uid);
  };

  searchInput?.addEventListener("input", update);
  categoryFilter?.addEventListener("change", update);
  dateFilter?.addEventListener("change", (e) => {
    if (dateFilter.value === 'custom') {
      customDateInputs?.classList.remove('d-none');
    } else {
      customDateInputs?.classList.add('d-none');
      update();
    }
  });

  applyCustomBtn?.addEventListener('click', () => {
    update();
  });
}

function openTransactionModalFromHash() {
  if (window.location.hash !== "#addTxModal") return;
  const modal = document.getElementById("addTxModal");
  if (modal && window.bootstrap?.Modal) {
    window.bootstrap.Modal.getOrCreateInstance(modal).show();
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
