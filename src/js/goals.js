import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { collection, onSnapshot, query, orderBy, addDoc, deleteDoc, doc, Timestamp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";
import { initSomboAssistant, destroySomboAssistant } from "./sombo-assistant.js";
import { initStore, cleanupStore } from "./store.js";
import { enhanceAccountMenu } from "./account-menu.js";

let currentGoals = [];

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
  listenToGoals(user.uid);

  // 4. Setup Form Handler
  setupAddGoalForm(user.uid);

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

function listenToGoals(userId) {
  const q = query(collection(db, "users", userId, "goals"), orderBy("createdAt", "desc"));

  onSnapshot(q, (snapshot) => {
    currentGoals = [];
    snapshot.forEach((docSnap) => {
      currentGoals.push({ id: docSnap.id, ...docSnap.data() });
    });

    renderGoalsView();
  });
}

function renderGoalsView() {
  const container = document.getElementById("goalsGridContainer");
  if (!container) return;

  if (currentGoals.length === 0) {
    container.innerHTML = `
      <div class="col-12 text-center py-5 text-muted border rounded bg-white">
        <i class="bi bi-piggy-bank fs-2 mb-2 d-block"></i>
        <h6 class="fw-bold">No savings goals yet</h6>
        <p class="small mb-3">Set targets for major milestones or emergency funds.</p>
        <button class="btn btn-dark btn-sm" data-bs-toggle="modal" data-bs-target="#addGoalModal">
          + Add First Goal
        </button>
      </div>`;
    return;
  }

  let html = "";
  currentGoals.forEach((goal) => {
    const target = parseFloat(goal.targetAmount || goal.target) || 0;
    const saved = parseFloat(goal.savedAmount || goal.current) || 0;
    const pct = target > 0 ? Math.min(100, Math.round((saved / target) * 100)) : 0;
    const isAchieved = pct >= 100;

    let deadlineStr = "No deadline";
    if (goal.deadline && typeof goal.deadline.toDate === "function") {
      deadlineStr = goal.deadline.toDate().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    }

    html += `
      <div class="col-12 col-md-6 col-lg-4">
        <div class="card border-0 shadow-sm p-3 h-100 d-flex flex-column justify-content-between">
          <div>
            <div class="d-flex justify-content-between align-items-center mb-3">
              <h2 class="h6 fw-bold mb-0 text-truncate">${escapeHtml(goal.title || goal.name || "Goal")}</h2>
              <span class="badge ${isAchieved ? 'bg-success text-white' : 'bg-dark text-white'} px-2 py-1">
                ${isAchieved ? 'Achieved' : 'Ongoing'}
              </span>
            </div>

            <div class="mb-3">
              <div class="progress mb-2" style="height: 8px;">
                <div class="progress-bar ${isAchieved ? 'bg-success' : 'bg-dark'}" role="progressbar" style="width: ${pct}%;"></div>
              </div>
              <div class="d-flex justify-content-between small text-muted">
                <span>Progress: <strong class="text-dark">${pct}%</strong></span>
                <strong class="text-dark">${saved.toLocaleString()} MMK</strong>
              </div>
            </div>

            <hr class="my-3 text-secondary opacity-25">

            <div class="d-flex justify-content-between small text-muted mb-3">
              <div>
                <div style="font-size: 0.75rem;">Target Amount</div>
                <div class="fw-bold text-dark">${target.toLocaleString()} MMK</div>
              </div>
              <div class="text-end">
                <div style="font-size: 0.75rem;">Target Date</div>
                <div class="fw-bold text-dark">${escapeHtml(deadlineStr)}</div>
              </div>
            </div>
          </div>

          <div class="d-flex justify-content-end gap-2 pt-2 border-top">
            <button class="btn btn-sm btn-outline-danger border-0" onclick="deleteGoalRecord('${goal.id}')">
              <i class="bi bi-trash"></i> Delete
            </button>
          </div>
        </div>
      </div>`;
  });

  container.innerHTML = html;
}

window.deleteGoalRecord = async (goalId) => {
  const user = auth.currentUser;
  if (!user) return;
  if (confirm("Are you sure you want to delete this savings goal?")) {
    try {
      await deleteDoc(doc(db, "users", user.uid, "goals", goalId));
    } catch (err) {
      alert("Failed to delete goal: " + err.message);
    }
  }
};

function setupAddGoalForm(userId) {
  const form = document.getElementById("addGoalForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const saveBtn = document.getElementById("saveGoalBtn");
    if (saveBtn) saveBtn.disabled = true;

    const title = document.getElementById("goalTitle").value.trim();
    const targetAmount = parseFloat(document.getElementById("goalAmount").value) || 0;
    const initialSaved = parseFloat(document.getElementById("goalInitial")?.value) || 0;
    const dateVal = document.getElementById("goalDate").value;

    if (!title || targetAmount <= 0 || !dateVal) {
      if (saveBtn) saveBtn.disabled = false;
      return;
    }

    const [y, m, d] = dateVal.split("-").map(Number);
    const deadlineObj = new Date(y, m - 1, d);

    try {
      await addDoc(collection(db, "users", userId, "goals"), {
        title,
        targetAmount,
        savedAmount: initialSaved,
        deadline: Timestamp.fromDate(deadlineObj),
        createdAt: Timestamp.now()
      });

      form.reset();
      const modalEl = document.getElementById("addGoalModal");
      if (modalEl) {
        const modal = window.bootstrap?.Modal?.getInstance(modalEl);
        if (modal) modal.hide();
      }
    } catch (err) {
      alert("Error adding goal: " + err.message);
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
