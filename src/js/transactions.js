import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
  collection, addDoc, onSnapshot, query, orderBy, deleteDoc, doc, updateDoc, increment 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

let allTransactions = [];

document.addEventListener("DOMContentLoaded", () => {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      bindSidebarUser(user);
      listenToTransactions(user.uid);
      setupAddTransactionForm(user.uid);
      setupSearchAndFilters();
    } else {
      window.location.href = "auth.html";
    }
  });
});

import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { updateProfile, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

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

// 3. Table Rendering Function
function renderTable(data, userId) {
  const tbody = document.getElementById("txTableBody");
  const emptyCol = document.getElementById("emptyStateCol");
  const tableCol = document.getElementById("tableColumn");

  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">No matching records found.</td></tr>`;
    
    if (allTransactions.length === 0) {
      emptyCol.classList.remove("d-none");
      tableCol.className = "col-12 col-lg-8";
    }
    return;
  }

  emptyCol.classList.add("d-none");
  tableCol.className = "col-12";

  let html = "";
  data.forEach((item) => {
    const isIncome = item.type === "income";
    const dateStr = item.createdAt ? new Date(item.createdAt.seconds * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Recent";
    
    // Category Badge Colors
    let badgeClass = "bg-light text-dark";
    if (item.category === "Food & Dining") badgeClass = "bg-info-subtle text-info-emphasis";
    else if (item.category === "Education") badgeClass = "bg-primary-subtle text-primary";
    else if (item.category === "Transportation") badgeClass = "bg-warning-subtle text-warning-emphasis";
    else if (item.category === "Entertainment") badgeClass = "bg-secondary-subtle text-secondary";
    else if (isIncome) badgeClass = "bg-success-subtle text-success";

    html += `
      <tr>
        <td class="text-muted">${dateStr}</td>
        <td class="fw-semibold">${escapeHtml(item.description)}</td>
        <td><span class="badge ${badgeClass} fw-normal px-2 py-1">${escapeHtml(item.category)}</span></td>
        <td class="text-end fw-bold ${isIncome ? 'text-success' : 'text-danger'}">
          ${isIncome ? '+' : '-'}${item.amount.toLocaleString()} MMK
        </td>
        <td class="text-center">
          <button class="btn btn-sm text-danger p-0 border-0 ms-2" onclick="deleteTransaction('${userId}', '${item.id}', ${item.amount}, '${item.type}')">
            <i class="bi bi-trash"></i>
          </button>
        </td>
      </tr>`;
  });

  tbody.innerHTML = html;
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

    renderTable(filtered, auth.currentUser?.uid);
  };

  searchInput?.addEventListener("input", filterAction);
  categoryFilter?.addEventListener("change", filterAction);
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}


document.getElementById("sidebarLogoutBtn")?.addEventListener("click", async () => {
  try {
    await signOut(auth);
    window.location.href = "auth.html";
  } catch (err) {
    console.error("Logout error:", err);
  }
});


