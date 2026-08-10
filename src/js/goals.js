import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { collection, addDoc, getDocs, query, where, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { deleteDoc, doc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

document.addEventListener("DOMContentLoaded", () => {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      bindSidebarUser(user);
      loadUserGoals(user);    
      setupAddGoalForm(user); 
    } else {
      window.location.href = "auth.html";
    }
  });
});

// Sidebar Profile Binding
async function bindSidebarUser(user) {
  const nameEl = document.getElementById("userNameDisplay");
  const avatarEl = document.getElementById("userAvatarDisplay");
  let fullName = user.displayName || user.email.split("@")[0];
  if (nameEl) nameEl.textContent = fullName;
  if (avatarEl) avatarEl.textContent = fullName.charAt(0).toUpperCase();
}

// 📌 1. Firestore မှ Goals များကို ဆွဲထုတ်၍ UI တွင် ပြသရန်
async function loadUserGoals(user) {
  const goalsGrid = document.getElementById("goalsGridContainer");
  if (!goalsGrid) return;

  try {
    const q = query(collection(db, "goals"), where("userId", "==", user.uid));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      goalsGrid.innerHTML = `
        <div class="col-12 text-center py-5">
          <p class="text-muted">No savings goals found. Click "Add New Goal" to start!</p>
        </div>
      `;
      return;
    }

    let htmlContent = "";
    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const title = data.title || "Untitled Goal";
      const target = data.targetAmount || 0;
      const current = data.currentAmount || 0;
      
      // Calculate Progress Percentage
      let percent = target > 0 ? (current / target) * 100 : 0;
      if (percent > 100) percent = 100;
      const isAchieved = current >= target;

      htmlContent += `
        <div class="col-12 col-md-6 col-lg-4">
          <div class="card border-0 shadow-sm p-3 h-100 d-flex flex-column justify-content-between">
            <div>
              <div class="d-flex justify-content-between align-items-center mb-3">
                <h2 class="h6 fw-bold mb-0">${title}</h2>
                <span class="badge ${isAchieved ? 'bg-success' : 'badge-mono-dark'} px-2 py-1">
                  ${isAchieved ? 'Achieved' : 'Ongoing'}
                </span>
              </div>

              <!-- Progress Bar -->
              <div class="mb-3">
                <div class="progress-mono mb-2">
                  <div class="progress-bar-mono" style="width: ${percent.toFixed(1)}%;"></div>
                </div>
                <div class="d-flex justify-content-between small text-muted">
                  <span>Progress: <strong class="text-dark">${percent.toFixed(1)}%</strong></span>
                  <strong class="text-dark">${current.toLocaleString()} MMK</strong>
                </div>
              </div>

              <hr class="my-3 text-secondary opacity-25">

              <div class="d-flex justify-content-between small text-muted mb-3">
                <div>
                  <div style="font-size: 0.75rem;">Target Amount</div>
                  <div class="fw-bold text-dark">${target.toLocaleString()} MMK</div>
                </div>
              </div>
            </div>

            <div class="d-flex justify-content-between gap-2 pt-2 border-top">
              <button class="btn btn-sm btn-outline-danger border-0 delete-goal-btn" data-id="${docSnap.id}">Delete</button>
              <button class="btn btn-sm btn-outline-dark">Manage</button>
            </div>
          </div>
        </div>
      `;
    });

    goalsGrid.innerHTML = htmlContent;

  } catch (err) {
    console.error("Error loading goals:", err);
  }
}

// 📌 2. Save Goal Form Handler (Firestore ထဲသို့ သိမ်းမည်)
function setupAddGoalForm(user) {
  const form = document.getElementById("addGoalForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    const titleInput = document.getElementById("goalTitle");
    const amountInput = document.getElementById("goalAmount");
    const initialInput = document.getElementById("goalInitial");
    const saveBtn = document.getElementById("saveGoalBtn");

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving...";
    }

    try {
      const goalData = {
        userId: user.uid,
        title: titleInput.value.trim(),
        targetAmount: parseFloat(amountInput.value),
        currentAmount: initialInput ? parseFloat(initialInput.value) || 0 : 0,
        createdAt: serverTimestamp()
      };

      await addDoc(collection(db, "goals"), goalData);

      const modalEl = document.getElementById("addGoalModal");
      const modalInstance = bootstrap.Modal.getInstance(modalEl);
      if (modalInstance) modalInstance.hide();

      form.reset();
      
      window.location.reload();

    } catch (err) {
      console.error("Error saving goal:", err);
      alert("Failed to save goal: " + err.message);
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save Goal";
      }
    }
  });
}

// 📌 3. Delete Goal Handler
document.addEventListener("click", async (e) => {
  if (e.target && e.target.classList.contains("delete-goal-btn")) {
    const goalId = e.target.getAttribute("data-id");
    if (confirm("Are you sure you want to delete this savings goal?")) {
      try {
        await deleteDoc(doc(db, "goals", goalId));
        window.location.reload();
      } catch (err) {
        console.error("Error deleting goal:", err);
        alert("Failed to delete goal.");
      }
    }
  }
});