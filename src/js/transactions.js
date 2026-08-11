import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { collection, onSnapshot, query, orderBy, addDoc, deleteDoc, doc, Timestamp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";
import { subscribeToStore } from "./store.js";

// ---------------------------------------------------------------------------
// DOM references (all exist in dashboard.html)
// ---------------------------------------------------------------------------
const txnList       = document.getElementById("txn-list");
const txnLoading    = document.getElementById("txn-loading");
const txnEmpty      = document.getElementById("txn-empty");
const txnStatus     = document.getElementById("txn-status");

const addTxnBtn     = document.getElementById("add-txn-btn");
const filterBtns    = document.querySelectorAll(".txn-filter-btn");

// Modal form elements
const txnModal      = document.getElementById("txnModal");
const txnForm       = document.getElementById("txn-form");
const txnEditId     = document.getElementById("txn-edit-id");
const txnModalTitle = document.getElementById("txnModalLabel");
const txnSubmitBtn  = document.getElementById("txn-submit-btn");

const fldType        = document.getElementById("txn-type");
const fldAmount      = document.getElementById("txn-amount");
const fldCategory    = document.getElementById("txn-category");
const fldDescription = document.getElementById("txn-description");
const fldDate        = document.getElementById("txn-date");

// Delete confirm modal
const deleteTxnModal    = document.getElementById("deleteTxnModal");
const deleteConfirmBtn  = document.getElementById("delete-confirm-btn");

// Summary stat elements (live)
const statBalance  = document.getElementById("stat-balance");
const statSpent    = document.getElementById("stat-spent");
const statIncome   = document.getElementById("stat-income");

// Bootstrap Modal instances (initialised after DOM ready)
let bsModal       = null;
let bsDeleteModal = null;

// Active filter state: "all" | "income" | "expense"
let activeFilter = "all";

// Local store state
let currentTxns = [];
let isLoading = true;
let isError = false;

// ID queued for deletion
let pendingDeleteId = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Formats a whole-number MMK amount with thousands separators.
 * @param {number} n
 * @returns {string}
 */
function formatMMK(n) {
  return Number(n).toLocaleString("en-US") + " MMK";
}

// 1. Profile Data bind လုပ်ခြင်း နှင့် Edit Mode Toggle ပြုလုပ်ခြင်း
async function bindSidebarUser(user) {
  const nameEl = document.getElementById("userNameDisplay");
  const emailEl = document.getElementById("userEmailDisplay");
  const avatarEl = document.getElementById("userAvatarDisplay");

  const dropdownNameEl = document.getElementById("dropdownNameDisplay");
  const dropdownEmailEl = document.getElementById("dropdownEmailDisplay");
  const dropdownAvatarEl = document.getElementById("dropdownAvatarDisplay");
  const dropdownUsernameEl = document.getElementById("dropdownUsernameDisplay");

  const inlineEditName = document.getElementById("inlineEditName");
  const inlineEditUsername = document.getElementById("inlineEditUsername");

  let fullName = user.displayName;
  let username = "";

  try {
    const userDocRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userDocRef);
    if (userSnap.exists()) {
      const data = userSnap.data();
      fullName = fullName || data.name || "";
      username = data.username || "";
    }
  } catch (err) {
    console.error("Error fetching user data:", err);
  }

  const finalName = fullName || user.email.split("@")[0] || "User";
  const userEmail = user.email || "";
  const finalUsername = username || userEmail.split("@")[0];
  const firstLetter = finalName.charAt(0).toUpperCase();

  // Sidebar Bottom & Popup View Update
  if (nameEl) nameEl.textContent = finalName;
  if (emailEl) emailEl.textContent = userEmail;
  if (avatarEl) avatarEl.textContent = firstLetter;

  if (dropdownNameEl) dropdownNameEl.textContent = finalName;
  if (dropdownEmailEl) dropdownEmailEl.textContent = userEmail;
  if (dropdownUsernameEl) dropdownUsernameEl.textContent = `@${finalUsername}`;
  if (dropdownAvatarEl) dropdownAvatarEl.textContent = firstLetter;

  if (inlineEditName) inlineEditName.value = finalName;
  if (inlineEditUsername) inlineEditUsername.value = finalUsername;
}

// 2. Toggle between View Mode and Edit Mode inside Popup
document.addEventListener("click", (e) => {
  const viewMode = document.getElementById("profileViewMode");
  const editMode = document.getElementById("profileEditMode");
  const toggleBtn = document.getElementById("toggleEditModeBtn");
  const cancelBtn = document.getElementById("cancelEditBtn");

  if (e.target && e.target.id === "toggleEditModeBtn") {
    viewMode?.classList.add("d-none");
    editMode?.classList.remove("d-none");
    toggleBtn?.classList.add("d-none");
  }

  if (e.target && e.target.id === "cancelEditBtn") {
    editMode?.classList.add("d-none");
    viewMode?.classList.remove("d-none");
    toggleBtn?.classList.remove("d-none");
  }
});

// 3. Inline Form Submit (Save Changes)
document.addEventListener("submit", async (e) => {
  if (e.target && e.target.id === "inlineSettingsForm") {
    e.preventDefault();
    const user = auth.currentUser;
    if (!user) return;

    const newName = document.getElementById("inlineEditName").value.trim();
    const newUsername = document.getElementById("inlineEditUsername").value.trim().replace(/^@/, "");

    try {
      const userDocRef = doc(db, "users", user.uid);

      // Auth Profile & Firestore update
      await updateProfile(user, { displayName: newName });
      await updateDoc(userDocRef, {
        name: newName,
        username: newUsername
      });

      alert("Profile updated successfully!");
      window.location.reload();
    } catch (err) {
      alert("Failed to update: " + err.message);
    }
  }
});

// 4. Sidebar Logout Handler
document.addEventListener("click", async (e) => {
  if (e.target && e.target.id === "sidebarLogoutBtn") {
    try {
      await signOut(auth);
      window.location.href = "auth.html";
    } catch (err) {
      console.error("Logout error:", err);
    }
  }
});

// 2. Realtime Listener for Transactions Table
function listenToTransactions(userId) {
  const q = query(collection(db, "users", userId, "transactions"), orderBy("createdAt", "desc"));

  onSnapshot(q, (snapshot) => {
    allTransactions = [];
    let totalSpent = 0;
    let totalReceived = 0;

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      allTransactions.push({ id: docSnap.id, ...data });

      if (data.type === "expense") {
        totalSpent += data.amount || 0;
      } else {
        totalReceived += data.amount || 0;
      }
    });

    // Stats Calculation
    document.getElementById("statTotalCount").textContent = allTransactions.length;
    document.getElementById("statTotalSpent").textContent = `${totalSpent.toLocaleString()} MMK`;
    document.getElementById("statTotalReceived").textContent = `${totalReceived.toLocaleString()} MMK`;

    // Render Table
    renderTable(allTransactions, userId);
  });
}

function renderFilteredTable(userId) {
  const searchInput = document.getElementById("searchTxInput");
  const categoryFilter = document.getElementById("categoryFilter");
  const tableBody = document.getElementById("txTableBody");
  const emptyState = document.getElementById("emptyStateCol");

  if (!tableBody) return;

  const searchQuery = (searchInput?.value || "").toLowerCase().trim();
  const categoryVal = categoryFilter?.value || "All";

  const filtered = allTransactions.filter((tx) => {
    const desc = (tx.description || "").toLowerCase();
    const cat = (tx.category || "").toLowerCase();
    const matchesSearch = !searchQuery || desc.includes(searchQuery) || cat.includes(searchQuery);
    const matchesCategory = categoryVal === "All" || tx.category === categoryVal || (categoryVal === "Income" && tx.type === "income");
    return matchesSearch && matchesCategory;
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

// 4. Add Transaction + Auto Update User Balance
function setupAddTransactionForm(userId) {
  const form = document.getElementById("addTxForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const saveBtn = document.getElementById("saveTxBtn");
    saveBtn.disabled = true;

    const type = document.getElementById("txType").value;
    const description = document.getElementById("txDescription").value.trim();
    const category = document.getElementById("txCategory").value;
    const amount = parseFloat(document.getElementById("txAmount").value) || 0;

    try {
      // 1. Add Transaction Record
      await addDoc(collection(db, "users", userId, "transactions"), {
        type, description, category, amount, createdAt: new Date()
      });

      // 2. Update Main Balance & Income/Expense Stats in User Doc
      const userRef = doc(db, "users", userId);
      if (type === "income") {
        await updateDoc(userRef, {
          balance: increment(amount),
          totalIncome: increment(amount)
        });
      } else {
        await updateDoc(userRef, {
          balance: increment(-amount),
          totalSpent: increment(amount)
        });
      }

      form.reset();
      const modalEl = document.getElementById("addTxModal");
      const modal = bootstrap.Modal.getInstance(modalEl);
      if (modal) modal.hide();
    } catch (err) {
      alert("Error adding transaction: " + err.message);
    } finally {
      saveBtn.disabled = false;
    }
  });
}

// 5. Delete Transaction Handler
window.deleteTransaction = async (userId, txId, amount, type) => {
  if (confirm("Delete this transaction?")) {
    try {
      await deleteDoc(doc(db, "users", userId, "transactions", txId));
      
      // Revert Main Balance
      const userRef = doc(db, "users", userId);
      if (type === "income") {
        await updateDoc(userRef, { balance: increment(-amount), totalIncome: increment(-amount) });
      } else {
        await updateDoc(userRef, { balance: increment(amount), totalSpent: increment(-amount) });
      }
    } catch (err) {
      alert("Failed to delete transaction: " + err.message);
    }
  }
};

// 6. Search & Category Filters
function setupSearchAndFilters() {
  const searchInput = document.getElementById("searchTxInput");
  const categoryFilter = document.getElementById("categoryFilter");

  const filterAction = () => {
    const query = searchInput.value.toLowerCase();
    const category = categoryFilter.value;

    const filtered = allTransactions.filter((tx) => {
      const matchesSearch = tx.description.toLowerCase().includes(query) || tx.category.toLowerCase().includes(query);
      const matchesCategory = category === "All" || tx.category === category || (category === "Income" && tx.type === "income");
      return matchesSearch && matchesCategory;
    });

    try {
      await addDoc(collection(db, "users", userId, "transactions"), {
        type,
        description,
        category,
        amount,
        date: Timestamp.now(),
        createdAt: Timestamp.now()
      });

  searchInput?.addEventListener("input", filterAction);
  categoryFilter?.addEventListener("change", filterAction);
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}


document.getElementById("sidebarLogoutBtn")?.addEventListener("click", async () => {
  try {
    const docRef = doc(db, "users", uid, "transactions", pendingDeleteId);
    await deleteDoc(docRef);

  const update = () => {
    const user = auth.currentUser;
    if (user) renderFilteredTable(user.uid);
  };

  } catch (err) {
    console.error("Logout error:", err);
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Initialises the transactions panel.
 * Must be called once the authenticated user is confirmed.
 * @param {string} uid  Firebase Auth UID (from onAuthStateChanged callback)
 */
export function initTransactions(uid) {
  if (!uid) return;

  // Initialise Bootstrap Modal instances
  bsModal       = new bootstrap.Modal(txnModal);
  bsDeleteModal = new bootstrap.Modal(deleteTxnModal);

  // Button events
  addTxnBtn.addEventListener("click", openAddModal);

  // Filter tabs
  filterBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      filterBtns.forEach((b) => {
        b.classList.remove("is-active");
        b.setAttribute("aria-selected", "false");
      });
      btn.classList.add("is-active");
      btn.setAttribute("aria-selected", "true");
      activeFilter = btn.dataset.filter;
      renderTransactions();
    });
  });

  // Form submit
  txnForm.addEventListener("submit", handleFormSubmit);


  // Reset pending delete when delete modal is closed without confirming
  deleteTxnModal.addEventListener("hidden.bs.modal", () => {
    pendingDeleteId = null;
  });

  // Subscribe to real-time store updates
  subscribeToStore((store) => {
    currentTxns = store.transactions;
    isLoading = store.loading.transactions;
    isError = store.error.transactions;
    renderTransactions();
  });
}
