import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, Timestamp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";
import { initSomboAssistant, destroySomboAssistant } from "./sombo-assistant.js";
import { cleanupStore, initStore } from "./store.js";
import { initProfileManager } from "./profile-manager.js";

onAuthStateChanged(auth, (user) => {
  if (!user) { cleanupStore(); destroySomboAssistant(); window.location.replace("./index.html"); return; }
  bindUser(user); initProfileManager(user).catch((error) => console.error("Could not load profile:", error)); initStore(user.uid); listenToGoals(user.uid); setupForm(user.uid); setupLogout(); initSomboAssistant(user);
});

function bindUser(user) { const name = user.displayName || user.email?.split("@")[0] || "User"; const initial = name.charAt(0).toUpperCase(); setText("userNameDisplay", name); setText("userEmailDisplay", user.email || ""); setText("sidebarAvatar", initial); setText("dropdownAvatar", initial); }

function listenToGoals(userId) {
  onSnapshot(query(collection(db, "users", userId, "goals"), orderBy("createdAt", "desc")), (snapshot) => {
    const container = document.getElementById("goalsGridContainer");
    if (!container) return;
    if (snapshot.empty) { container.innerHTML = '<div class="col-12 text-center py-5 text-muted border rounded bg-white"><i class="bi bi-piggy-bank fs-2 d-block mb-2"></i><h6 class="fw-bold">No savings goals yet</h6><p class="small">Add a goal to begin tracking your progress.</p></div>'; return; }
    container.innerHTML = snapshot.docs.map((entry) => renderGoal(entry.id, entry.data())).join("");
    container.querySelectorAll("[data-goal-id]").forEach((button) => button.addEventListener("click", () => deleteGoal(button.dataset.goalId)));
  }, (error) => console.error("Could not load goals:", error));
}

function renderGoal(id, goal) {
  const target = Number(goal.targetAmount || goal.target || 0); const saved = Number(goal.savedAmount || goal.current || 0); const progress = target ? Math.min(100, Math.round(saved / target * 100)) : 0;
  const deadline = goal.deadline?.toDate?.().toLocaleDateString() || "No deadline";
  return `<div class="col-12 col-md-6 col-lg-4"><div class="card border-0 shadow-sm p-3 h-100 d-flex flex-column justify-content-between"><div><div class="d-flex justify-content-between mb-3"><h2 class="h6 fw-bold mb-0 text-truncate">${escapeHtml(goal.title || goal.name || "Goal")}</h2><span class="badge ${progress >= 100 ? "bg-success" : "bg-dark"}">${progress >= 100 ? "Achieved" : "Ongoing"}</span></div><div class="progress mb-2" style="height:8px"><div class="progress-bar bg-dark" style="width:${progress}%"></div></div><div class="d-flex justify-content-between small text-muted"><span>${progress}% complete</span><strong>${saved.toLocaleString()} MMK</strong></div><hr><div class="d-flex justify-content-between small text-muted"><span>Target<br><strong class="text-dark">${target.toLocaleString()} MMK</strong></span><span class="text-end">Date<br><strong class="text-dark">${escapeHtml(deadline)}</strong></span></div></div><div class="pt-3 mt-3 border-top text-end"><button class="btn btn-sm btn-outline-danger border-0" data-goal-id="${id}"><i class="bi bi-trash"></i> Delete</button></div></div></div>`;
}

function setupForm(userId) { document.getElementById("addGoalForm")?.addEventListener("submit", async (event) => { event.preventDefault(); const button = document.getElementById("saveGoalBtn"); button.disabled = true; try { const title = document.getElementById("goalTitle").value.trim(); const targetAmount = Number(document.getElementById("goalAmount").value); const date = document.getElementById("goalDate").value; if (!title || targetAmount <= 0 || !date) return; await addDoc(collection(db, "users", userId, "goals"), { title, targetAmount, savedAmount: 0, deadline: Timestamp.fromDate(new Date(`${date}T00:00:00`)), createdAt: Timestamp.now() }); closeModal("addGoalModal"); event.target.reset(); } catch (error) { alert(`Could not save goal: ${error.message}`); } finally { button.disabled = false; } }); }
async function deleteGoal(id) { if (!confirm("Delete this savings goal?")) return; try { await deleteDoc(doc(db, "users", auth.currentUser.uid, "goals", id)); } catch (error) { alert(`Could not delete goal: ${error.message}`); } }
function setupLogout() { document.getElementById("sidebarLogoutBtn")?.addEventListener("click", async function () { this.disabled = true; cleanupStore(); destroySomboAssistant(); await signOut(auth); window.location.replace("./index.html"); }); }
function closeModal(id) { window.bootstrap?.Modal?.getInstance(document.getElementById(id))?.hide(); }
function setText(id, value) { document.getElementById(id)?.replaceChildren(String(value)); }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character])); }
