import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { collection, onSnapshot, query, addDoc, deleteDoc, doc, Timestamp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";
import { initSomboAssistant, destroySomboAssistant } from "./sombo-assistant.js";
import { initStore, cleanupStore } from "./store.js";

let currentBudgets = [];
let currentTransactions = [];

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
  setupLogout();

  // 3. Initialize Realtime Listeners
  initStore(user.uid);
  listenToBudgetsAndTxns(user.uid);

  // 4. Setup Form Handler
  setupCreateBudgetForm(user.uid);

  // 5. Initialize Sombo Assistant Widget
  initSomboAssistant(user);
});

function bindUserData(user) {
  const name = user.displayName || user.email.split("@")[0] || "User";
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

function listenToBudgetsAndTxns(userId) {
  const budgetRef = collection(db, "users", userId, "budgets");
  const txnRef = collection(db, "users", userId, "transactions");

  onSnapshot(budgetRef, (budgetSnap) => {
    currentBudgets = [];
    budgetSnap.forEach((docSnap) => {
      currentBudgets.push({ id: docSnap.id, ...docSnap.data() });
    });

    onSnapshot(txnRef, (txnSnap) => {
      currentTransactions = [];
      txnSnap.forEach((docSnap) => {
        currentTransactions.push({ id: docSnap.id, ...docSnap.data() });
      });

      renderBudgetsView();
    });
  });
}

function renderBudgetsView() {
  const grid = document.getElementById("budgetsGrid");
  const statTotal = document.getElementById("statTotalBudget");
  const statSpent = document.getElementById("statSpentSoFar");
  const statRemaining = document.getElementById("statRemainingBudget");
  const warningBanner = document.getElementById("budgetWarningBanner");
  const warningText = document.getElementById("warningBannerText");

  if (!grid) return;

  let totalAllocated = 0;
  let totalSpentSoFar = 0;
  let highestUsageWarning = null;

  // Calculate per-category spending from transactions
  const categorySpentMap = {};
  currentTransactions.forEach((tx) => {
    if (tx.type === "expense") {
      const cat = tx.category || "General";
      const amt = parseFloat(tx.amount) || 0;
      categorySpentMap[cat] = (categorySpentMap[cat] || 0) + amt;
    }
  });

  if (currentBudgets.length === 0) {
    grid.innerHTML = `
      <div class="col-12 text-center py-5 text-muted border rounded bg-white">
        <i class="bi bi-wallet2 fs-2 mb-2 d-block"></i>
        <h6 class="fw-bold">No budgets set yet</h6>
        <p class="small mb-3">Create category limits to manage your monthly spending.</p>
        <button class="btn btn-dark btn-sm" data-bs-toggle="modal" data-bs-target="#createBudgetModal">
          + Create First Budget
        </button>
      </div>`;
    if (statTotal) statTotal.textContent = "0 MMK";
    if (statSpent) statSpent.textContent = "0 MMK";
    if (statRemaining) statRemaining.textContent = "0 MMK";
    warningBanner?.classList.add("d-none");
    return;
  }

  let html = "";

  currentBudgets.forEach((bud) => {
    const limit = parseFloat(bud.limit) || 0;
    const spent = categorySpentMap[bud.category] || 0;
    const pct = limit > 0 ? Math.round((spent / limit) * 100) : 0;
    const remaining = Math.max(0, limit - spent);

    totalAllocated += limit;
    totalSpentSoFar += spent;

    if (pct >= 80) {
      if (!highestUsageWarning || pct > highestUsageWarning.pct) {
        highestUsageWarning = { category: bud.category, pct };
      }
    }

    let progressColor = "bg-dark";
    if (pct >= 100) progressColor = "bg-danger";
    else if (pct >= 80) progressColor = "bg-warning";

    html += `
      <div class="col-12 col-md-6 col-lg-4">
        <div class="card border-0 shadow-sm p-3 h-100 d-flex flex-column justify-content-between">
          <div>
            <div class="d-flex justify-content-between align-items-center mb-2">
              <h2 class="h6 fw-bold mb-0">${escapeHtml(bud.category)}</h2>
              <span class="badge ${pct >= 100 ? 'bg-danger' : (pct >= 80 ? 'bg-warning text-dark' : 'bg-light text-dark border')}">${pct}%</span>
            </div>
            <div class="small text-muted mb-2">
              Spent <strong class="text-dark">${spent.toLocaleString()} MMK</strong> of ${limit.toLocaleString()} MMK
            </div>
            <div class="progress mb-3" style="height: 8px;">
              <div class="progress-bar ${progressColor}" role="progressbar" style="width: ${Math.min(100, pct)}%"></div>
            </div>
            <div class="d-flex justify-content-between small text-muted">
              <span>Remaining:</span>
              <strong class="${spent > limit ? 'text-danger' : 'text-dark'}">${remaining.toLocaleString()} MMK</strong>
            </div>
          </div>
          <div class="pt-3 mt-3 border-top d-flex justify-content-end">
            <button class="btn btn-sm btn-outline-danger border-0" onclick="deleteBudgetRecord('${bud.id}')">
              <i class="bi bi-trash"></i> Delete
            </button>
          </div>
        </div>
      </div>`;
  });

  grid.innerHTML = html;

  if (statTotal) statTotal.textContent = `${totalAllocated.toLocaleString()} MMK`;
  if (statSpent) statSpent.textContent = `${totalSpentSoFar.toLocaleString()} MMK`;
  if (statRemaining) statRemaining.textContent = `${Math.max(0, totalAllocated - totalSpentSoFar).toLocaleString()} MMK`;

  if (highestUsageWarning) {
    warningBanner?.classList.remove("d-none");
    if (warningText) {
      warningText.textContent = `${highestUsageWarning.category} budget is at ${highestUsageWarning.pct}% — consider reducing spending`;
    }
  } else {
    warningBanner?.classList.add("d-none");
  }
}

window.deleteBudgetRecord = async (budId) => {
  const user = auth.currentUser;
  if (!user) return;
  if (confirm("Are you sure you want to delete this budget limit?")) {
    try {
      await deleteDoc(doc(db, "users", user.uid, "budgets", budId));
    } catch (err) {
      alert("Failed to delete budget: " + err.message);
    }
  }
};

function setupCreateBudgetForm(userId) {
  const form = document.getElementById("createBudgetForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const saveBtn = document.getElementById("saveBudBtn");
    if (saveBtn) saveBtn.disabled = true;

    const category = document.getElementById("budCategory").value;
    const limit = parseFloat(document.getElementById("budLimit").value) || 0;

    if (!category || limit <= 0) {
      if (saveBtn) saveBtn.disabled = false;
      return;
    }

    try {
      await addDoc(collection(db, "users", userId, "budgets"), {
        category,
        limit,
        period: "monthly",
        createdAt: Timestamp.now()
      });

      form.reset();
      const modalEl = document.getElementById("createBudgetModal");
      if (modalEl) {
        const modal = window.bootstrap?.Modal?.getInstance(modalEl);
        if (modal) modal.hide();
      }
    } catch (err) {
      alert("Error saving budget: " + err.message);
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
