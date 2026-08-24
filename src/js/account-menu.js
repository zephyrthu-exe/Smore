import { updateProfile, updateEmail, updatePassword, EmailAuthProvider, reauthenticateWithCredential } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { auth } from "./firebase-config.js";

const dialogMarkup = `
<div class="modal fade" id="editProfileModal" tabindex="-1" aria-labelledby="accountEditProfileTitle"><div class="modal-dialog modal-dialog-centered"><div class="modal-content border-0 shadow"><div class="modal-header"><h2 class="modal-title fs-5" id="accountEditProfileTitle">Edit profile</h2><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div><form id="editProfileForm"><div class="modal-body"><div class="mb-3"><label class="form-label" for="profileNameInput">Username</label><input class="form-control" id="profileNameInput" maxlength="80" required></div><div class="mb-3"><label class="form-label" for="profileEmailInput">Email</label><input type="email" class="form-control" id="profileEmailInput" required></div><div><label class="form-label" for="profilePhotoInput">Profile photo</label><input type="file" class="form-control" id="profilePhotoInput" accept="image/*"><div class="form-text">Use a small image (max. 350 KB).</div></div></div><div class="modal-footer"><button type="button" class="btn btn-light" data-bs-dismiss="modal">Cancel</button><button type="submit" class="btn btn-dark">Save profile</button></div></form></div></div></div>
<div class="modal fade" id="changePasswordModal" tabindex="-1" aria-labelledby="accountChangePasswordTitle"><div class="modal-dialog modal-dialog-centered"><div class="modal-content border-0 shadow"><div class="modal-header"><h2 class="modal-title fs-5" id="accountChangePasswordTitle">Change password</h2><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div><form id="changePasswordForm"><div class="modal-body"><div class="mb-3"><label class="form-label" for="currentPasswordInput">Current password</label><input type="password" class="form-control" id="currentPasswordInput" required></div><div class="mb-3"><label class="form-label" for="newPasswordInput">New password</label><input type="password" class="form-control" id="newPasswordInput" minlength="6" required></div><div><label class="form-label" for="confirmPasswordInput">Confirm new password</label><input type="password" class="form-control" id="confirmPasswordInput" minlength="6" required></div></div><div class="modal-footer"><button type="button" class="btn btn-light" data-bs-dismiss="modal">Cancel</button><button type="submit" class="btn btn-dark">Change password</button></div></form></div></div></div>
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
  document.getElementById("changePasswordForm").addEventListener("submit", async (event) => {
    event.preventDefault(); const current = auth.currentUser; const oldPassword = document.getElementById("currentPasswordInput").value; const nextPassword = document.getElementById("newPasswordInput").value; if (nextPassword !== document.getElementById("confirmPasswordInput").value) return window.alert("The new passwords do not match.");
    try { await reauthenticateWithCredential(current, EmailAuthProvider.credential(current.email, oldPassword)); await updatePassword(current, nextPassword); event.target.reset(); close("changePasswordModal"); window.alert("Your password has been changed."); } catch (_) { window.alert("Your current password is incorrect or the password could not be changed."); }
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
