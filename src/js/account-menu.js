import { updateProfile, updateEmail, updatePassword, EmailAuthProvider, reauthenticateWithCredential } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { auth } from "./firebase-config.js";
import { STRONG_PASSWORD_REGEX, checkPasswordStrength, bindPasswordRulesUI, updatePasswordChecklist } from "./password-rules.js";

const dialogMarkup = `
<div class="modal fade" id="editProfileModal" tabindex="-1" aria-labelledby="accountEditProfileTitle"><div class="modal-dialog modal-dialog-centered"><div class="modal-content border-0 shadow"><div class="modal-header"><h2 class="modal-title fs-5" id="accountEditProfileTitle">Edit profile</h2><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div><form id="editProfileForm"><div class="modal-body"><div class="mb-3"><label class="form-label" for="profileNameInput">Username</label><input class="form-control" id="profileNameInput" maxlength="80" required></div><div class="mb-3"><label class="form-label" for="profileEmailInput">Email</label><input type="email" class="form-control" id="profileEmailInput" required></div><div><label class="form-label" for="profilePhotoInput">Profile photo</label><input type="file" class="form-control" id="profilePhotoInput" accept="image/*"><div class="form-text">Use a small image (max. 350 KB).</div></div></div><div class="modal-footer"><button type="button" class="btn btn-light" data-bs-dismiss="modal">Cancel</button><button type="submit" class="btn btn-dark">Save profile</button></div></form></div></div></div>
<div class="modal fade" id="changePasswordModal" tabindex="-1" aria-labelledby="accountChangePasswordTitle"><div class="modal-dialog modal-dialog-centered"><div class="modal-content border-0 shadow"><div class="modal-header"><h2 class="modal-title fs-5" id="accountChangePasswordTitle">Change password</h2><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div><form id="changePasswordForm"><div class="modal-body"><div id="changePasswordStatus" class="alert alert-danger d-none py-2 px-3 small mb-3" role="alert"></div><div class="mb-3"><label class="form-label" for="currentPasswordInput">Current password</label><div class="password-input-group"><input type="password" class="form-control" id="currentPasswordInput" autocomplete="current-password" required><button type="button" class="password-toggle-btn" id="toggleCurrentPassword" aria-label="Toggle current password visibility"><i class="bi bi-eye"></i></button></div></div><div class="mb-3"><div class="password-field-header"><label class="form-label mb-0" for="newPasswordInput">New password</label><button type="button" class="password-suggest-btn" id="suggestChangePassword" title="Generate and fill a strong password"><i class="bi bi-shield-lock-fill"></i> Suggest strong password</button></div><div class="password-input-group"><input type="password" class="form-control" id="newPasswordInput" minlength="8" autocomplete="new-password" required><button type="button" class="password-toggle-btn" id="toggleNewPassword" aria-label="Toggle new password visibility"><i class="bi bi-eye"></i></button></div><div id="changePasswordSuggestToast" class="password-suggest-pill d-none"><i class="bi bi-check-circle-fill"></i> Strong password generated &amp; filled!</div><div class="password-checklist mt-2" id="changePasswordChecklist" aria-live="polite"><div class="password-checklist-title">Password must contain:</div><ul class="password-checklist-items list-unstyled m-0"><li class="password-req-item" data-req="length"><i class="bi bi-circle"></i> <span>At least 8 characters</span></li><li class="password-req-item" data-req="upper"><i class="bi bi-circle"></i> <span>Uppercase letter (A-Z)</span></li><li class="password-req-item" data-req="lower"><i class="bi bi-circle"></i> <span>Lowercase letter (a-z)</span></li><li class="password-req-item" data-req="number"><i class="bi bi-circle"></i> <span>At least 1 number (0-9)</span></li><li class="password-req-item" data-req="special"><i class="bi bi-circle"></i> <span>Special character / symbol (!@#$...)</span></li></ul></div></div><div class="mb-2"><label class="form-label" for="confirmPasswordInput">Confirm new password</label><div class="password-input-group"><input type="password" class="form-control" id="confirmPasswordInput" minlength="8" autocomplete="new-password" required><button type="button" class="password-toggle-btn" id="toggleConfirmPassword" aria-label="Toggle confirm password visibility"><i class="bi bi-eye"></i></button></div></div></div><div class="modal-footer"><button type="button" class="btn btn-light" data-bs-dismiss="modal">Cancel</button><button type="submit" id="changePasswordSubmitBtn" class="btn btn-dark">Change password</button></div></form></div></div></div>
<div class="modal fade" id="changeLocationModal" tabindex="-1" aria-labelledby="accountChangeLocationTitle"><div class="modal-dialog modal-dialog-centered"><div class="modal-content border-0 shadow"><div class="modal-header"><h2 class="modal-title fs-5" id="accountChangeLocationTitle">Change location</h2><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div><form id="changeLocationForm"><div class="modal-body"><label class="form-label" for="locationInput">Your location</label><input class="form-control" id="locationInput" maxlength="100" placeholder="e.g. Yangon, Myanmar" required></div><div class="modal-footer"><button type="button" class="btn btn-light" data-bs-dismiss="modal">Cancel</button><button type="submit" class="btn btn-dark">Save location</button></div></form></div></div></div>
<div class="modal fade" id="appInformationModal" tabindex="-1" aria-labelledby="accountInformationTitle"><div class="modal-dialog modal-dialog-centered"><div class="modal-content border-0 shadow"><div class="modal-header"><h2 class="modal-title fs-5" id="accountInformationTitle">About Smore</h2><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div><div class="modal-body"><p><strong>Smore</strong> is your personal finance tracker.</p><p class="mb-0 text-muted">Version 1.0 · Your financial data is stored privately in your account.</p></div><div class="modal-footer"><button type="button" class="btn btn-dark" data-bs-dismiss="modal">Close</button></div></div></div></div>`;

function getDisplayName(user) {
  const savedName = localStorage.getItem(`smore-profile-name-${user.uid}`)?.trim();
  if (savedName) return savedName;

  const profileName = user.displayName?.trim();
  if (profileName && profileName.toLowerCase() !== "user") return profileName;

  return user.email?.split("@")[0] || "User";
}

function refreshDisplay(user) {
  const name = getDisplayName(user);
  const photo = localStorage.getItem(`smore-profile-photo-${user.uid}`);
  ["userNameDisplay", "dropdownName", "welcomeName"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = name;
  });
  const email = document.getElementById("userEmailDisplay");
  if (email) email.textContent = user.email || "";
  ["sidebarAvatar", "dropdownAvatar", "userAvatarDisplay"].forEach((id) => {
    const avatar = document.getElementById(id);
    if (!avatar) return;
    avatar.textContent = photo ? "" : name.charAt(0).toUpperCase();
    avatar.style.backgroundImage = photo ? `url("${photo}")` : "";
    avatar.style.backgroundSize = "cover";
    avatar.style.backgroundPosition = "center";
  });
}

function close(id) { bootstrap.Modal.getInstance(document.getElementById(id))?.hide(); }
function readPhoto(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); }); }

export function enhanceAccountMenu(user) {
  refreshDisplay(user);
  bindMoreNavigation();
  if (document.getElementById("accountMenuEnhanced")) return;

  const card = document.querySelector(".profile-card");
  if (!card) return;
  card.id = "accountMenuEnhanced";
  if (!document.getElementById("editProfileModal")) document.body.insertAdjacentHTML("beforeend", dialogMarkup);
  if (!document.getElementById("dropdownName")) {
    const header = card.querySelector(".text-center");
    header?.insertAdjacentHTML("beforeend", '<div class="fw-semibold" id="dropdownName">User</div>');
  }
  const actions = `<div class="border-top px-3 py-2"><button class="btn btn-link text-dark text-decoration-none w-100 text-start py-2" data-bs-toggle="modal" data-bs-target="#editProfileModal"><i class="bi bi-person me-2"></i>Edit profile</button><button class="btn btn-link text-dark text-decoration-none w-100 text-start py-2" data-bs-toggle="modal" data-bs-target="#changePasswordModal"><i class="bi bi-key me-2"></i>Change password</button><button class="btn btn-link text-dark text-decoration-none w-100 text-start py-2" data-bs-toggle="modal" data-bs-target="#changeLocationModal"><i class="bi bi-geo-alt me-2"></i>Change location</button><button class="btn btn-link text-dark text-decoration-none w-100 text-start py-2" data-bs-toggle="modal" data-bs-target="#appInformationModal"><i class="bi bi-info-circle me-2"></i>App information</button></div>`;
  if (!card.querySelector('[data-bs-target="#editProfileModal"]')) card.querySelector(".border-top")?.insertAdjacentHTML("beforebegin", actions);

  const wrap = document.getElementById("profileWrap");
  const trigger = wrap?.querySelector(".profile-chip");
  const closeMenu = () => {
    wrap?.classList.remove("is-open");
    trigger?.setAttribute("aria-expanded", "false");
  };
  trigger?.addEventListener("click", () => {
    const isOpen = wrap.classList.toggle("is-open");
    trigger.setAttribute("aria-expanded", String(isOpen));
  });
  trigger?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });
  document.getElementById("accountSettingsBtn")?.addEventListener("click", (event) => {
    event.stopPropagation();
    const moreMenu = document.getElementById("mobileMoreMenu");
    const moreButton = document.getElementById("mobileMoreBtn");
    if (moreMenu) moreMenu.hidden = true;
    moreButton?.setAttribute("aria-expanded", "false");
    const isOpen = wrap.classList.toggle("is-open");
    trigger?.setAttribute("aria-expanded", String(isOpen));
  });
  document.addEventListener("click", (event) => {
    if (wrap && !wrap.contains(event.target)) closeMenu();
  });

  document.getElementById("editProfileModal").addEventListener("show.bs.modal", () => {
    document.getElementById("profileNameInput").value = getDisplayName(auth.currentUser);
    document.getElementById("profileEmailInput").value = auth.currentUser?.email || "";
  });
  document.getElementById("changeLocationModal").addEventListener("show.bs.modal", () => { document.getElementById("locationInput").value = localStorage.getItem(`smore-location-${user.uid}`) || ""; });
  document.getElementById("editProfileForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const current = auth.currentUser;
    const file = document.getElementById("profilePhotoInput").files[0];
    if (!current) return;
    if (file?.size > 350 * 1024) return window.alert("Please choose an image smaller than 350 KB.");
    const name = document.getElementById("profileNameInput").value.trim();
    const email = document.getElementById("profileEmailInput").value.trim();
    if (!name || !email) return window.alert("Please enter your username and email.");

    try {
      await updateProfile(current, { displayName: name });
      localStorage.setItem(`smore-profile-name-${current.uid}`, name);
      if (email !== current.email) await updateEmail(current, email);
      if (file) localStorage.setItem(`smore-profile-photo-${current.uid}`, await readPhoto(file));
      refreshDisplay(current);
      close("editProfileModal");
    } catch (error) {
      refreshDisplay(current);
      window.alert(error.code === "auth/requires-recent-login" ? "For security, log out and log in again before changing your email." : "Your profile could not be saved.");
    }
  });
  // Setup Change Password rules UI & toggles
  const currentPwdInput = document.getElementById("currentPasswordInput");
  const newPwdInput = document.getElementById("newPasswordInput");
  const confirmPwdInput = document.getElementById("confirmPasswordInput");
  const changeChecklist = document.getElementById("changePasswordChecklist");
  const suggestChangeBtn = document.getElementById("suggestChangePassword");
  const toggleCurrentBtn = document.getElementById("toggleCurrentPassword");
  const toggleNewBtn = document.getElementById("toggleNewPassword");
  const toggleConfirmBtn = document.getElementById("toggleConfirmPassword");
  const changeToast = document.getElementById("changePasswordSuggestToast");
  const changeStatus = document.getElementById("changePasswordStatus");

  if (newPwdInput) {
    bindPasswordRulesUI({
      input: newPwdInput,
      confirmInput: confirmPwdInput,
      checklist: changeChecklist,
      suggestBtn: suggestChangeBtn,
      toggleBtn: toggleNewBtn,
      toastEl: changeToast,
    });
  }

  if (toggleCurrentBtn && currentPwdInput) {
    toggleCurrentBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const isPwd = currentPwdInput.type === "password";
      currentPwdInput.type = isPwd ? "text" : "password";
      const icon = toggleCurrentBtn.querySelector("i");
      if (icon) icon.className = isPwd ? "bi bi-eye-slash" : "bi bi-eye";
    });
  }

  if (toggleConfirmBtn && confirmPwdInput) {
    toggleConfirmBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const isPwd = confirmPwdInput.type === "password";
      confirmPwdInput.type = isPwd ? "text" : "password";
      const icon = toggleConfirmBtn.querySelector("i");
      if (icon) icon.className = isPwd ? "bi bi-eye-slash" : "bi bi-eye";
    });
  }

  const showChangeError = (msg) => {
    if (changeStatus) {
      changeStatus.textContent = msg;
      changeStatus.className = "alert alert-danger py-2 px-3 small mb-3";
      changeStatus.classList.remove("d-none");
    } else {
      window.alert(msg);
    }
  };

  const clearChangeStatus = () => {
    if (changeStatus) {
      changeStatus.textContent = "";
      changeStatus.classList.add("d-none");
    }
  };

  document.getElementById("changePasswordModal")?.addEventListener("show.bs.modal", () => {
    clearChangeStatus();
    document.getElementById("changePasswordForm")?.reset();
    if (changeChecklist) updatePasswordChecklist(changeChecklist, "");
    if (currentPwdInput) currentPwdInput.type = "password";
    if (newPwdInput) newPwdInput.type = "password";
    if (confirmPwdInput) confirmPwdInput.type = "password";
    const curIcon = toggleCurrentBtn?.querySelector("i");
    if (curIcon) curIcon.className = "bi bi-eye";
    const newIcon = toggleNewBtn?.querySelector("i");
    if (newIcon) newIcon.className = "bi bi-eye";
    const confIcon = toggleConfirmBtn?.querySelector("i");
    if (confIcon) confIcon.className = "bi bi-eye";
  });

  document.getElementById("changePasswordForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearChangeStatus();

    const current = auth.currentUser;
    if (!current) return;

    const oldPassword = currentPwdInput.value;
    const nextPassword = newPwdInput.value;
    const confirmPassword = confirmPwdInput.value;

    if (!STRONG_PASSWORD_REGEX.test(nextPassword)) {
      const { results } = checkPasswordStrength(nextPassword);
      const missing = [];
      if (!results.length) missing.push("at least 8 characters");
      if (!results.upper) missing.push("an uppercase letter");
      if (!results.lower) missing.push("a lowercase letter");
      if (!results.number) missing.push("a number");
      if (!results.special) missing.push("a special character / symbol (!@#$...)");
      return showChangeError(`New password requires ${missing.join(", ")}.`);
    }

    if (nextPassword === oldPassword) {
      return showChangeError("New password must be different from your current password.");
    }

    if (nextPassword !== confirmPassword) {
      return showChangeError("The new passwords do not match.");
    }

    const submitBtn = document.getElementById("changePasswordSubmitBtn");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Changing password...";
    }

    try {
      await reauthenticateWithCredential(current, EmailAuthProvider.credential(current.email, oldPassword));
      await updatePassword(current, nextPassword);
      event.target.reset();
      close("changePasswordModal");
      window.alert("Your password has been changed successfully.");
    } catch (err) {
      showChangeError(
        err?.code === "auth/wrong-password" || err?.code === "auth/invalid-credential"
          ? "Your current password is incorrect."
          : "Your current password is incorrect or the password could not be changed."
      );
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Change password";
      }
    }
  });
  document.getElementById("changeLocationForm").addEventListener("submit", (event) => { event.preventDefault(); localStorage.setItem(`smore-location-${user.uid}`, document.getElementById("locationInput").value.trim()); close("changeLocationModal"); });
  refreshDisplay(user);
}

function bindMoreNavigation() {
  const moreButton = document.getElementById("mobileMoreBtn");
  const moreMenu = document.getElementById("mobileMoreMenu");
  if (!moreButton || !moreMenu || moreButton.dataset.bound === "true") return;

  moreButton.dataset.bound = "true";
  moreButton.addEventListener("click", () => {
    const isOpening = moreMenu.hidden;
    moreMenu.hidden = !isOpening;
    moreButton.setAttribute("aria-expanded", String(isOpening));
  });
  document.addEventListener("click", (event) => {
    if (!moreMenu.contains(event.target) && event.target !== moreButton) {
      moreMenu.hidden = true;
      moreButton.setAttribute("aria-expanded", "false");
    }
  });
}
