import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { collection, onSnapshot, query, orderBy, addDoc, deleteDoc, doc, Timestamp, updateDoc, increment, getDocs } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";
import { initSomboAssistant, destroySomboAssistant } from "./sombo-assistant.js";
import { initStore, cleanupStore } from "./store.js";
import { enhanceAccountMenu } from "./account-menu.js";

let allTransactions = [];
let transactionHashListenerBound = false;
let userGoals = []; // cached goals for populating Savings categories

function isGoalCompleted(goal) {
  const target = Number(goal?.targetAmount ?? goal?.target ?? 0);
  const saved = Number(goal?.savedAmount ?? goal?.current ?? 0);
  return target > 0 && saved >= target;
}

function listenToGoalsForTransactions(userId) {
  const q = query(collection(db, 'users', userId, 'goals'), orderBy('createdAt', 'desc'));
  // realtime listener with error logging
  onSnapshot(q, (snap) => {
    userGoals = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(goal => !isGoalCompleted(goal));
    console.log('[listenToGoalsForTransactions] snapshot received, goals=', userGoals.length);
    populateTxCategoryForCurrentType();
  }, async (err) => {
    console.error('[listenToGoalsForTransactions] onSnapshot error', err);
    // fallback: try a one-time getDocs to populate goals once
    try {
      const s = await getDocs(q);
      userGoals = s.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(goal => !isGoalCompleted(goal));
      console.log('[listenToGoalsForTransactions] getDocs fallback fetched goals=', userGoals.length);
      populateTxCategoryForCurrentType();
    } catch (e) {
      console.error('[listenToGoalsForTransactions] getDocs fallback failed', e);
    }
  });

  // Also perform a one-time getDocs immediately as a fast fallback in case onSnapshot is slow
  (async () => {
    try {
      const s = await getDocs(q);
      if (!userGoals || userGoals.length === 0) {
        userGoals = s.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(goal => !isGoalCompleted(goal));
        console.log('[listenToGoalsForTransactions] immediate getDocs populated goals=', userGoals.length);
        populateTxCategoryForCurrentType();
      }
    } catch (e) {
      console.log('[listenToGoalsForTransactions] immediate getDocs failed', e);
    }
  })();
}

// Ensure any element that opens the Add Transaction modal will call populate as a fallback
(function attachAddModalTriggers() {
  try {
    const triggers = Array.from(document.querySelectorAll('[data-bs-target="#addTxModal"]'));
    triggers.forEach(t => {
      t.addEventListener('click', () => {
        setTimeout(populateTxCategoryForCurrentType, 50);
      });
    });
  } catch (e) {
    console.warn('attachAddModalTriggers error', e);
  }
})();

function populateTxCategoryForCurrentType() {
  const txTypeEl = document.getElementById('txType');
  const txCategoryEl = document.getElementById('txCategory');
  const txDescriptionEl = document.getElementById('txDescription');
  const txDescriptionWrap = document.getElementById('txDescriptionWrap');
  if (!txTypeEl || !txCategoryEl) return;
  const t = txTypeEl.value;

  console.log('[populateTxCategoryForCurrentType] type=', t, 'userGoals=', userGoals && userGoals.length);

  // Clear existing options
  txCategoryEl.innerHTML = '';

  if (t === 'savings') {
    // For savings only show goals
    if (!userGoals || userGoals.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No goals available';
      txCategoryEl.appendChild(opt);
      txCategoryEl.disabled = true;
      txCategoryEl.required = false;
    } else {
      userGoals.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g.id; // value is goal id
        opt.textContent = g.title || g.name || `Goal ${g.id}`;
        txCategoryEl.appendChild(opt);
      });
      txCategoryEl.disabled = false;
      txCategoryEl.required = true;
    }

    // hide description when savings selected and remove required
    if (txDescriptionWrap) {
      // Try both Bootstrap utility class and direct style as fallback
      txDescriptionWrap.classList.add('d-none');
      try { txDescriptionWrap.style.display = 'none'; } catch (e) { /* ignore */ }
    }
    if (txDescriptionEl) { txDescriptionEl.required = false; txDescriptionEl.value = ''; }

    console.log('[populateTxCategoryForCurrentType] savings populated, options=', txCategoryEl.options.length);
  } else {
    // restore default categories (static list)
    const defaultCats = [
      'Food & Dining','Transportation','Education','Entertainment','Shopping','Utilities','Income'
    ];
    defaultCats.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      txCategoryEl.appendChild(opt);
    });
    txCategoryEl.disabled = false;
    txCategoryEl.required = true;
    // show description and make required
    if (txDescriptionWrap) {
      txDescriptionWrap.classList.remove('d-none');
      try { txDescriptionWrap.style.display = ''; } catch (e) { /* ignore */ }
    }
    if (txDescriptionEl) txDescriptionEl.required = true;

    console.log('[populateTxCategoryForCurrentType] non-savings populated, options=', txCategoryEl.options.length);
  }
}

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
  listenToGoalsForTransactions(user.uid);

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
      const normalizedType = (data.type || "").toLowerCase();
      if (normalizedType === "expense" || normalizedType === "savings") {
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
  // support Savings filter by type
  const isSavingsFilter = categoryVal === 'Savings';
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
    const matchesCategory = categoryVal === "All" || tx.category === categoryVal || (categoryVal === "Income" && tx.type === "income") || (isSavingsFilter && tx.type === 'savings');

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
  const txTypeEl = document.getElementById('txType');
  const txCategoryEl = document.getElementById('txCategory');
  if (!form) return;

  // ensure category is populated correctly on type change
  txTypeEl?.addEventListener('change', () => populateTxCategoryForCurrentType());

  // when the Add Transaction modal shows, ensure category/description visibility is correct
  const addTxModalEl = document.getElementById('addTxModal');
  if (addTxModalEl) {
    addTxModalEl.addEventListener('show.bs.modal', () => {
      populateTxCategoryForCurrentType();
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const saveBtn = document.getElementById("saveTxBtn");
    if (saveBtn) saveBtn.disabled = true;

    const type = document.getElementById("txType").value;
    const descriptionEl = document.getElementById("txDescription");
    const description = descriptionEl ? descriptionEl.value.trim() : '';
    const categorySelect = document.getElementById("txCategory");
    const amount = parseFloat(document.getElementById("txAmount").value) || 0;

    if (type === 'savings') {
      // when savings, description is not required and categorySelect.value contains goal id
      const goalId = categorySelect?.value;
      if (!goalId || amount <= 0) {
        if (saveBtn) saveBtn.disabled = false;
        return;
      }

      // find goal title for readable category
      const goal = userGoals.find(g => g.id === goalId) || (await getDocs(collection(db, 'users', userId, 'goals'))).docs
        .map(d => ({ id: d.id, ...d.data() }))
        .find(g => g.id === goalId);
      const goalTitle = goal?.title || goal?.name || 'Goal';

      if (goal && isGoalCompleted(goal)) {
        alert('This goal is already fully funded, so it can no longer receive more savings.');
        if (saveBtn) saveBtn.disabled = false;
        return;
      }

      try {
        // 1) add transaction record with goalId and readable category
        await addDoc(collection(db, "users", userId, "transactions"), {
          type: 'savings',
          description: '',
          category: goalTitle,
          goalId,
          amount,
          date: Timestamp.now(),
          createdAt: Timestamp.now()
        });

        // 2) increment goal saved amount
        const goalRef = doc(db, 'users', userId, 'goals', goalId);
        await updateDoc(goalRef, { savedAmount: increment(amount) });

        form.reset();
        const modalEl = document.getElementById("addTxModal");
        if (modalEl) {
          const modal = window.bootstrap?.Modal?.getInstance(modalEl);
          if (modal) modal.hide();
        }
      } catch (err) {
        alert("Error adding savings transaction: " + err.message);
      } finally {
        if (saveBtn) saveBtn.disabled = false;
      }

      return;
    }

    // Non-savings flow (expense/income)
    const category = document.getElementById("txCategory").value;

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

  // ensure category selection populates correctly after goals are loaded
  document.getElementById('txType')?.addEventListener('change', () => populateTxCategoryForCurrentType());
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

// Safety initialization: ensure the txType change handler and initial population run
(function initTransactionUi() {
  try {
    // Attach change handler if not already attached
    const txType = document.getElementById('txType');
    if (txType) {
      txType.removeEventListener('change', populateTxCategoryForCurrentType);
      txType.addEventListener('change', populateTxCategoryForCurrentType);
    }

    // Populate once DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', populateTxCategoryForCurrentType);
    } else {
      populateTxCategoryForCurrentType();
    }
  } catch (e) {
    // ignore initialization errors
    console.warn('initTransactionUi error', e);
  }
})();
