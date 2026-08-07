import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { auth } from "./firebase-config.js";
import { initTransactions } from "./transactions.js";
import { initBudgets } from "./budgets.js";
import { initGoals } from "./goals.js";
import { initAnalytics } from "./analytics.js";
import { initImport } from "./import.js";
import { initSomboAssistant, destroySomboAssistant } from "./sombo-assistant.js";
import { initNav } from "./nav.js";

const loadingScreen = document.getElementById("dash-loading");
const dashContent   = document.getElementById("dash-content");
const userEmailEl   = document.getElementById("user-email");
const userGreeting  = document.getElementById("user-greeting");
const logoutBtn     = document.getElementById("logout-btn");
const statusAlert   = document.getElementById("dash-status");

/**
 * @param {"error" | "success" | "info"} type
 * @param {string} message
 */
function showStatus(type, message) {
  statusAlert.textContent = message;
  statusAlert.className = `status-alert is-visible is-${type}`;
  statusAlert.setAttribute("role", type === "error" ? "alert" : "status");
}

function clearStatus() {
  statusAlert.textContent = "";
  statusAlert.className = "status-alert";
  statusAlert.removeAttribute("role");
}

logoutBtn.addEventListener("click", async () => {
  clearStatus();
  logoutBtn.disabled = true;
  logoutBtn.textContent = "Signing out...";

  try {
    await signOut(auth);
    destroySomboAssistant();
    window.location.href = "./auth.html";
  } catch (error) {
    showStatus("error", "Could not log out. Please try again.");
    logoutBtn.disabled = false;
    logoutBtn.textContent = "Log out";
  }
});

onAuthStateChanged(auth, (user) => {
  if (!user) {
    // No authenticated user — redirect to login immediately.
    window.location.replace("./auth.html");
    return;
  }

  const email = user.email || "Unknown user";
  const name  = user.displayName || email.split("@")[0];

  userEmailEl.textContent  = email;
  userGreeting.textContent = `Hello, ${name}`;

  loadingScreen.classList.add("hidden");
  dashContent.classList.remove("hidden");

  // Initialise each panel with the verified UID.
  initNav(user.uid);
  initTransactions(user.uid);
  initBudgets(user.uid);
  initGoals(user.uid);
  initAnalytics(user.uid);
  initImport(user.uid);
  initSomboAssistant(user);
});
