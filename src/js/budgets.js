import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { collection, onSnapshot, query, addDoc, deleteDoc, doc, Timestamp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";
import { initSomboAssistant, destroySomboAssistant } from "./sombo-assistant.js";
import { initStore, cleanupStore } from "./store.js";
import { enhanceAccountMenu } from "./account-menu.js";
import { isPreviousMonth, isSameMonth, transactionDate } from "./finance-utils.js";

let currentBudgets = [];
let currentTransactions = [];

// Notification helpers: track per-category notification state in localStorage to avoid repeated alerts
const notifKeyFor = (category, level) => `budget_notified_${String(category || '').replace(/\s+/g, '_')}_${level}`;
function isNotified(category, level) {
  try { return localStorage.getItem(notifKeyFor(category, level)) === '1'; } catch { return false; }
}
function markNotified(category, level) {
  try { localStorage.setItem(notifKeyFor(category, level), '1'); } catch {}
}
function clearNotified(category, level) {
  try { localStorage.removeItem(notifKeyFor(category, level)); } catch {}
}

async function ensureNotificationPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  try {
    const perm = await Notification.requestPermission();
    return perm === 'granted';
  } catch (e) {
    return false;
  }
}

function showDesktopNotification(title, body, tag) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body, tag });
  } catch (e) {
    // ignore
  }
}

function showBudgetWarningNotification(category, pct) {
  if (isNotified(category, 80)) return;
  showDesktopNotification('Budget warning', `${category} budget is at ${pct}% used`, `budget-${category}-80`);
  markNotified(category, 80);
}

function showBudgetExceededPrompt(category) {
  if (isNotified(category, 100)) return;
  showDesktopNotification('Budget full', `${category} budget has been fully used.`, `budget-${category}-100`);
  // Also show an in-page confirmation so the user can navigate immediately
  setTimeout(() => {
    try {
      if (confirm(`${category} budget is fully used. Create another budget now?`)) {
        // Navigate to budget page
        window.location.href = './budget.html';
      }
    } catch (e) {
      // fall back silently
    }
  }, 500);
  markNotified(category, 100);
}

// Try to request notification permission early but non-blocking
ensureNotificationPermission().catch(() => {});

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
  listenToBudgetsAndTxns(user.uid);

  // 4. Setup Form Handler
  setupCreateBudgetForm(user.uid);

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
    if (tx.type === "expense" && isSameMonth(transactionDate(tx))) {
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
  const exhaustedCategories = [];

  currentBudgets.forEach((bud) => {
    const limit = parseFloat(bud.limit) || 0;
    const spent = categorySpentMap[bud.category] || 0;
    const previousSpent = currentTransactions
      .filter((tx) => tx.type === "expense" && tx.category === bud.category && isPreviousMonth(transactionDate(tx)))
      .reduce((total, tx) => total + (parseFloat(tx.amount) || 0), 0);
    const rollover = bud.rollover === true ? Math.max(0, limit - previousSpent) : 0;
    const effectiveLimit = limit + rollover;
    const pct = effectiveLimit > 0 ? Math.round((spent / effectiveLimit) * 100) : 0;
    const remaining = Math.max(0, effectiveLimit - spent);

    totalAllocated += effectiveLimit;
    totalSpentSoFar += spent;

    if (pct >= 80) {
      if (!highestUsageWarning || pct > highestUsageWarning.pct) {
        highestUsageWarning = { category: bud.category, pct };
      }
    }

    // Track exhausted categories for notifications
    if (pct >= 100) exhaustedCategories.push(bud.category);

    // Clear previously set notification flags when usage drops below thresholds
    if (pct < 80) clearNotified(bud.category, 80);
    if (pct < 100) clearNotified(bud.category, 100);

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
              Spent <strong class="text-dark">${spent.toLocaleString()} MMK</strong> of ${effectiveLimit.toLocaleString()} MMK
              ${rollover > 0 ? `<span class="d-block text-success">Includes ${rollover.toLocaleString()} MMK rollover</span>` : ""}
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

  // Show warning banner as before
  if (highestUsageWarning) {
    warningBanner?.classList.remove("d-none");
    if (warningText) {
      warningText.textContent = `${highestUsageWarning.category} budget is at ${highestUsageWarning.pct}% — consider reducing spending`;
    }

    // Desktop/in-app notification for the highest usage warning (80% threshold)
    if (highestUsageWarning.pct >= 80) {
      showBudgetWarningNotification(highestUsageWarning.category, highestUsageWarning.pct);
    }
  } else {
    warningBanner?.classList.add("d-none");
  }

  // For any fully exhausted categories, notify and prompt once
  exhaustedCategories.forEach((cat) => {
    showBudgetExceededPrompt(cat);
  });

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
    const rollover = document.getElementById("budRollover")?.checked === true;

    if (!category || limit <= 0) {
      if (saveBtn) saveBtn.disabled = false;
      return;
    }

    try {
      await addDoc(collection(db, "users", userId, "budgets"), {
        category,
        limit,
        rollover,
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
