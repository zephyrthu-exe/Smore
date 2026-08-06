import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  updateProfile,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { auth } from "./firebase-config.js";

const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");
const loginTab = document.getElementById("login-tab");
const registerTab = document.getElementById("register-tab");
const statusAlert = document.getElementById("auth-status");
const authPanel = document.getElementById("auth-panel");
const authLoading = document.getElementById("auth-loading");
const googleSigninBtn = document.getElementById("google-signin-btn");

const loginEmail = document.getElementById("login-email");
const loginPassword = document.getElementById("login-password");
const registerName = document.getElementById("register-name");
const registerEmail = document.getElementById("register-email");
const registerPassword = document.getElementById("register-password");
const registerConfirm = document.getElementById("register-confirm");

const loginSubmit = document.getElementById("login-submit");
const registerSubmit = document.getElementById("register-submit");

/**
 * Maps Firebase Auth error codes to friendly messages.
 * @param {unknown} error
 * @returns {string}
 */
function getFriendlyAuthError(error) {
  const code = error && typeof error === "object" && "code" in error ? error.code : "";

  const messages = {
    "auth/email-already-in-use": "An account with this email already exists. Try logging in.",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/invalid-credential": "Incorrect email or password. Please try again.",
    "auth/wrong-password": "Incorrect email or password. Please try again.",
    "auth/user-not-found": "No account found with that email. Please register first.",
    "auth/user-disabled": "This account has been disabled. Contact support if you need help.",
    "auth/weak-password": "Password is too weak. Use at least 6 characters.",
    "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
    "auth/network-request-failed": "Network error. Check your connection and try again.",
    "auth/operation-not-allowed": "Google sign-in is not enabled for this project. Enable it in the Firebase Console.",
    "auth/missing-password": "Please enter your password.",
    "auth/popup-closed-by-user": "Sign-in was cancelled. Please try again.",
    "auth/cancelled-popup-request": "Sign-in was cancelled. Please try again.",
    "auth/popup-blocked": "Popup was blocked by your browser. Please allow popups for this site and try again.",
    "auth/account-exists-with-different-credential": "An account already exists with this email using a different sign-in method. Try logging in with email/password instead.",
    "auth/unauthorized-domain": "This site is not authorised to use Google sign-in. Add this domain to the Firebase Console under Authentication → Settings → Authorised domains.",
    "auth/internal-error": "An internal error occurred. Please try again.",
    "auth/user-cancelled": "Sign-in was cancelled. Please try again.",
  };

  if (typeof code === "string" && messages[code]) {
    return messages[code];
  }

  // Return the raw code so it is visible in the UI if not mapped.
  const rawCode = typeof code === "string" && code ? ` (${code})` : "";
  return `Something went wrong. Please try again.${rawCode}`;
}

/**
 * Shows a status message above the forms.
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

/**
 * Clears Bootstrap-style field validation.
 * @param {HTMLFormElement} form
 */
function clearFieldErrors(form) {
  form.querySelectorAll(".is-invalid").forEach((el) => el.classList.remove("is-invalid"));
  form.querySelectorAll("[data-error-for]").forEach((el) => {
    el.textContent = "";
  });
}

/**
 * Marks a field invalid and sets its message.
 * @param {HTMLInputElement} input
 * @param {string} message
 */
function setFieldError(input, message) {
  input.classList.add("is-invalid");
  const feedback = document.querySelector(`[data-error-for="${input.id}"]`);
  if (feedback) {
    feedback.textContent = message;
  }
}

/**
 * @param {HTMLButtonElement} button
 * @param {boolean} isLoading
 * @param {string} idleLabel
 */
function setButtonLoading(button, isLoading, idleLabel) {
  button.disabled = isLoading;
  button.classList.toggle("btn-loading", isLoading);

  if (isLoading) {
    button.innerHTML = `
      <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
      <span>Please wait...</span>
    `;
  } else {
    button.textContent = idleLabel;
  }
}

/**
 * Switches between login and register views.
 * @param {"login" | "register"} mode
 */
function switchMode(mode) {
  const isLogin = mode === "login";

  loginTab.classList.toggle("is-active", isLogin);
  registerTab.classList.toggle("is-active", !isLogin);
  loginTab.setAttribute("aria-selected", String(isLogin));
  registerTab.setAttribute("aria-selected", String(!isLogin));

  loginForm.classList.toggle("hidden", !isLogin);
  registerForm.classList.toggle("hidden", isLogin);

  clearStatus();
  clearFieldErrors(loginForm);
  clearFieldErrors(registerForm);

  const title = document.getElementById("auth-title");
  const subtitle = document.getElementById("auth-subtitle");

  if (isLogin) {
    title.textContent = "Welcome back";
    subtitle.textContent = "Log in to track spending and savings in MMK.";
    loginEmail.focus();
  } else {
    title.textContent = "Create your account";
    subtitle.textContent = "Register to start organizing your student finances.";
    registerName.focus();
  }
}

/**
 * @param {string} email
 * @returns {boolean}
 */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Validates the login form. Returns false if invalid.
 * @returns {boolean}
 */
function validateLogin() {
  clearFieldErrors(loginForm);
  let valid = true;

  const email = loginEmail.value.trim();
  const password = loginPassword.value;

  if (!email) {
    setFieldError(loginEmail, "Email is required.");
    valid = false;
  } else if (!isValidEmail(email)) {
    setFieldError(loginEmail, "Enter a valid email address.");
    valid = false;
  }

  if (!password) {
    setFieldError(loginPassword, "Password is required.");
    valid = false;
  }

  return valid;
}

/**
 * Validates the register form. Returns false if invalid.
 * @returns {boolean}
 */
function validateRegister() {
  clearFieldErrors(registerForm);
  let valid = true;

  const name = registerName.value.trim();
  const email = registerEmail.value.trim();
  const password = registerPassword.value;
  const confirm = registerConfirm.value;

  if (!name) {
    setFieldError(registerName, "Name is required.");
    valid = false;
  }

  if (!email) {
    setFieldError(registerEmail, "Email is required.");
    valid = false;
  } else if (!isValidEmail(email)) {
    setFieldError(registerEmail, "Enter a valid email address.");
    valid = false;
  }

  if (!password) {
    setFieldError(registerPassword, "Password is required.");
    valid = false;
  } else if (password.length < 6) {
    setFieldError(registerPassword, "Use at least 6 characters.");
    valid = false;
  }

  if (!confirm) {
    setFieldError(registerConfirm, "Please confirm your password.");
    valid = false;
  } else if (password !== confirm) {
    setFieldError(registerConfirm, "Passwords do not match.");
    valid = false;
  }

  return valid;
}

loginTab.addEventListener("click", () => switchMode("login"));
registerTab.addEventListener("click", () => switchMode("register"));

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearStatus();

  if (!validateLogin()) {
    showStatus("error", "Please fix the highlighted fields.");
    return;
  }

  setButtonLoading(loginSubmit, true, "Log in");

  try {
    await signInWithEmailAndPassword(
      auth,
      loginEmail.value.trim(),
      loginPassword.value
    );
    showStatus("success", "Logged in successfully. Redirecting...");
    window.location.href = "./dashboard.html";
  } catch (error) {
    showStatus("error", getFriendlyAuthError(error));
    setButtonLoading(loginSubmit, false, "Log in");
  }
});

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearStatus();

  if (!validateRegister()) {
    showStatus("error", "Please fix the highlighted fields.");
    return;
  }

  setButtonLoading(registerSubmit, true, "Create account");

  try {
    const credential = await createUserWithEmailAndPassword(
      auth,
      registerEmail.value.trim(),
      registerPassword.value
    );

    const displayName = registerName.value.trim();
    if (displayName) {
      await updateProfile(credential.user, { displayName });
    }

    showStatus("success", "Account created. Redirecting to your dashboard...");
    window.location.href = "./dashboard.html";
  } catch (error) {
    showStatus("error", getFriendlyAuthError(error));
    setButtonLoading(registerSubmit, false, "Create account");
  }
});

googleSigninBtn.addEventListener("click", async () => {
  clearStatus();
  
  // Basic loading state for the Google button
  const originalContent = googleSigninBtn.innerHTML;
  googleSigninBtn.disabled = true;
  googleSigninBtn.innerHTML = `
    <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
    <span>Please wait...</span>
  `;

  const provider = new GoogleAuthProvider();

  try {
    await signInWithPopup(auth, provider);
    showStatus("success", "Logged in with Google. Redirecting...");
    window.location.href = "./dashboard.html";
  } catch (error) {
    // Always log the raw error so the real code is visible in the browser console.
    console.error("[Google sign-in error]", error?.code, error);

    // If popup is blocked fall back to redirect.
    if (error && error.code === "auth/popup-blocked") {
      showStatus("info", "Popup was blocked — opening a redirect sign-in page instead…");
      try {
        await signInWithRedirect(auth, provider);
      } catch (redirectError) {
        console.error("[Google redirect error]", redirectError?.code, redirectError);
        showStatus("error", getFriendlyAuthError(redirectError));
        googleSigninBtn.disabled = false;
        googleSigninBtn.innerHTML = originalContent;
      }
    } else {
      showStatus("error", getFriendlyAuthError(error));
      googleSigninBtn.disabled = false;
      googleSigninBtn.innerHTML = originalContent;
    }
  }
});

onAuthStateChanged(auth, (user) => {
  if (user) {
    window.location.replace("./dashboard.html");
    return;
  }

  authLoading.classList.add("hidden");
  authPanel.classList.remove("hidden");
});

const params = new URLSearchParams(window.location.search);
if (params.get("mode") === "register") {
  switchMode("register");
} else {
  switchMode("login");
}
