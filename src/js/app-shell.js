// app-shell.js
// Shared startup code for every signed-in page (dashboard, transactions,
// budgets, goals, analytics). It replaces the copy-pasted helpers that used
// to sit at the top of each page script.
//
// Page scripts only need to call:
//   startAuthenticatedPage((user) => { ...page-specific setup... });

import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { auth } from "./firebase-config.js";
import { enhanceAccountMenu } from "./account-menu.js";
import { initSomboAssistant, destroySomboAssistant } from "./sombo-assistant.js";

// ─── Small helpers ─────────────────────────────────────────────────────────

// Escape text before inserting it into innerHTML so user input can never be
// interpreted as HTML (prevents XSS / broken layouts).
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[m]));
}

// Hide a Bootstrap modal by its element id (e.g. "addTxModal").
export function closeModal(modalId) {
  const modalEl = document.getElementById(modalId);
  if (!modalEl) return;
  const modal = window.bootstrap?.Modal?.getInstance(modalEl);
  if (modal) modal.hide();
}

// Fill the sidebar and account menu with the signed-in user's name, email and
// avatar. account-menu.js later refreshes these whenever the profile changes.
export function bindUserData(user) {
  const name = user.displayName || user.email?.split("@")[0] || "User";
  const email = user.email || "";
  const firstLetter = name.charAt(0).toUpperCase();

  ["welcomeName", "userNameDisplay", "dropdownName"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = name;
  });

  const emailEl = document.getElementById("userEmailDisplay");
  if (emailEl) emailEl.textContent = email;

  const savedPhoto = localStorage.getItem(`smore-profile-photo-${user.uid}`);
  ["sidebarAvatar", "dropdownAvatar", "userAvatarDisplay"].forEach((id) => {
    const avatar = document.getElementById(id);
    if (!avatar) return;
    avatar.textContent = savedPhoto ? "" : firstLetter;
    avatar.style.backgroundImage = savedPhoto ? `url("${savedPhoto}")` : "";
    avatar.style.backgroundSize = "cover";
    avatar.style.backgroundPosition = "center";
  });
}

// Wire up the logout buttons. `cleanup` runs right before signing out; it is
// used to remove the Sombo assistant widget from the page.
export function setupLogout(cleanup = () => {}) {
  const logoutAction = async (btn) => {
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Signing out...";
    }
    try {
      cleanup();
      await signOut(auth);
      window.location.href = "./index.html";
    } catch (err) {
      console.error("Logout error:", err);
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Log Out";
      }
    }
  };

  document.getElementById("logoutBtn")?.addEventListener("click", function () {
    logoutAction(this);
  });
  document.getElementById("sidebarLogoutBtn")?.addEventListener("click", function () {
    logoutAction(this);
  });
}

// ─── Page bootstrap ────────────────────────────────────────────────────────

// Run the shared per-user setup, then the page-specific setup callback.
export function initAuthenticatedPage(user, pageSetup) {
  bindUserData(user);
  enhanceAccountMenu(user);
  setupLogout(destroySomboAssistant);
  pageSetup?.(user);
  initSomboAssistant(user);
}

// Page entry point: redirect to the login page when nobody is signed in,
// otherwise boot the page with initAuthenticatedPage.
export function startAuthenticatedPage(pageSetup) {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      destroySomboAssistant();
      window.location.replace("./index.html");
      return;
    }
    initAuthenticatedPage(user, pageSetup);
  });
}
