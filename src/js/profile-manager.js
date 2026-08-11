import { EmailAuthProvider, reauthenticateWithCredential, signOut, updateEmail, updatePassword, updateProfile } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { doc, getDoc, setDoc, Timestamp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";

let currentProfile = {};

export async function initProfileManager(user) {
  const reference = doc(db, "users", user.uid);
  const snapshot = await getDoc(reference);
  currentProfile = snapshot.exists() ? snapshot.data() : {};
  renderProfile(user);
  ensureModal();
  bindMenu();
}

function renderProfile(user) {
  const name = user.displayName || currentProfile.displayName || user.email.split("@")[0];
  const photo = user.photoURL || currentProfile.photoDataUrl || "";
  const avatar = photo ? `<img src="${photo}" alt="" class="rounded-circle" style="width:100%;height:100%;object-fit:cover">` : escapeHtml(name.charAt(0).toUpperCase());
  document.querySelectorAll(".profile-card").forEach((card) => {
    card.innerHTML = `<div class="text-center mb-3"><div class="avatar mx-auto mb-2" style="width:62px;height:62px;font-size:1.25rem">${avatar}</div><div class="fw-semibold">${escapeHtml(name)}</div><div class="text-secondary small text-truncate">${escapeHtml(user.email || "")}</div></div><div class="list-group list-group-flush border-top border-bottom mb-3"><button class="list-group-item list-group-item-action" data-profile-action="edit"><i class="bi bi-person me-2"></i>Edit profile</button><button class="list-group-item list-group-item-action" data-profile-action="password"><i class="bi bi-key me-2"></i>Change password</button><button class="list-group-item list-group-item-action" data-profile-action="location"><i class="bi bi-geo-alt me-2"></i>Change location</button><button class="list-group-item list-group-item-action" data-profile-action="info"><i class="bi bi-info-circle me-2"></i>App information</button></div><button class="btn btn-danger w-100" id="sidebarLogoutBtn"><i class="bi bi-box-arrow-right"></i> Log out</button>`;
  });
  document.querySelectorAll(".profile-chip").forEach((chip) => { const nameEl = chip.querySelector(".fw-semibold"); if (nameEl) nameEl.textContent = name; const avatarEl = chip.querySelector(".avatar"); if (avatarEl) avatarEl.innerHTML = avatar; });
  document.querySelectorAll("#sidebarLogoutBtn").forEach((button) => button.addEventListener("click", async () => { button.disabled = true; await signOut(auth); window.location.replace("./index.html"); }));
}

function ensureModal() {
  if (document.getElementById("profileManagerModal")) return;
  document.body.insertAdjacentHTML("beforeend", `<div class="modal fade" id="profileManagerModal" tabindex="-1"><div class="modal-dialog modal-dialog-centered"><div class="modal-content"><div class="modal-header"><h5 class="modal-title" id="profileManagerTitle">Profile</h5><button class="btn-close" data-bs-dismiss="modal"></button></div><form id="profileManagerForm"><div class="modal-body" id="profileManagerBody"></div><div class="modal-footer" id="profileManagerFooter"></div></form></div></div></div>`);
}

function bindMenu() {
  document.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-profile-action]")?.dataset.profileAction;
    if (!action) return;
    event.preventDefault(); openAction(action);
  });
}

function openAction(action) {
  const user = auth.currentUser; if (!user) return;
  const title = document.getElementById("profileManagerTitle"); const body = document.getElementById("profileManagerBody"); const footer = document.getElementById("profileManagerFooter"); const form = document.getElementById("profileManagerForm");
  form.replaceWith(form.cloneNode(false)); const freshForm = document.getElementById("profileManagerForm"); freshForm.append(body, footer);
  if (action === "edit") { title.textContent = "Edit profile"; body.innerHTML = `<label class="form-label">Username</label><input class="form-control mb-3" id="profileName" value="${escapeAttribute(user.displayName || user.email.split("@")[0])}" required><label class="form-label">Email</label><input type="email" class="form-control mb-3" id="profileEmail" value="${escapeAttribute(user.email || "")}" required><label class="form-label">Profile photo</label><input type="file" class="form-control" id="profilePhoto" accept="image/*"><div class="form-text">Use a small image (max. 350 KB).</div>`; footer.innerHTML = `<button type="button" class="btn btn-light" data-bs-dismiss="modal">Cancel</button><button class="btn btn-dark">Save profile</button>`; freshForm.addEventListener("submit", saveProfile); }
  if (action === "password") { title.textContent = "Change password"; body.innerHTML = passwordFields(); footer.innerHTML = `<button type="button" class="btn btn-light" data-bs-dismiss="modal">Cancel</button><button class="btn btn-dark">Change password</button>`; freshForm.addEventListener("submit", savePassword); }
  if (action === "location") { title.textContent = "Change location"; body.innerHTML = `<label class="form-label">Your location</label><input class="form-control" id="profileLocation" value="${escapeAttribute(currentProfile.location || "")}" placeholder="e.g. Yangon, Myanmar" maxlength="120">`; footer.innerHTML = `<button type="button" class="btn btn-light" data-bs-dismiss="modal">Cancel</button><button class="btn btn-dark">Save location</button>`; freshForm.addEventListener("submit", saveLocation); }
  if (action === "info") { title.textContent = "About Smore"; body.innerHTML = `<p class="mb-2"><strong>Smore</strong> is your personal finance tracker.</p><p class="text-muted small mb-0">Version 1.0 · Your financial data is stored privately in your account.</p>`; footer.innerHTML = `<button type="button" class="btn btn-dark" data-bs-dismiss="modal">Close</button>`; }
  new bootstrap.Modal(document.getElementById("profileManagerModal")).show();
}

function passwordFields() { return `<label class="form-label">Current password</label><input type="password" class="form-control mb-3" id="currentPassword" required><label class="form-label">New password</label><input type="password" class="form-control mb-3" id="newPassword" minlength="6" required><label class="form-label">Confirm new password</label><input type="password" class="form-control" id="confirmPassword" minlength="6" required>`; }
async function reauthenticate(password) { const user = auth.currentUser; await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password)); }
async function saveProfile(event) { event.preventDefault(); const user = auth.currentUser; const name = document.getElementById("profileName").value.trim(); const email = document.getElementById("profileEmail").value.trim(); if (!name || !email) return; const photoFile = document.getElementById("profilePhoto").files[0]; try { let photoDataUrl = currentProfile.photoDataUrl || ""; if (photoFile) { if (photoFile.size > 350000) throw new Error("Please choose an image smaller than 350 KB."); photoDataUrl = await readFile(photoFile); } if (email !== user.email) { const password = prompt("For security, enter your current password to change your email."); if (!password) return; await reauthenticate(password); await updateEmail(user, email); } await updateProfile(user, { displayName: name, photoURL: photoDataUrl || null }); await saveUserDoc({ email, displayName: name, photoDataUrl }); currentProfile = { ...currentProfile, email, displayName: name, photoDataUrl }; renderProfile(auth.currentUser); closeModal(); } catch (error) { alert(readableError(error)); } }
async function savePassword(event) { event.preventDefault(); const current = document.getElementById("currentPassword").value; const next = document.getElementById("newPassword").value; if (next !== document.getElementById("confirmPassword").value) return alert("New passwords do not match."); try { await reauthenticate(current); await updatePassword(auth.currentUser, next); closeModal(); alert("Password changed successfully."); } catch (error) { alert(readableError(error)); } }
async function saveLocation(event) { event.preventDefault(); try { const location = document.getElementById("profileLocation").value.trim(); await saveUserDoc({ location }); currentProfile.location = location; closeModal(); } catch (error) { alert(readableError(error)); } }
async function saveUserDoc(changes) { const user = auth.currentUser; await setDoc(doc(db, "users", user.uid), { email: user.email, displayName: user.displayName || user.email.split("@")[0], currency: currentProfile.currency || "MMK", createdAt: currentProfile.createdAt || Timestamp.now(), ...changes }, { merge: true }); }
function readFile(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); }); }
function closeModal() { bootstrap.Modal.getInstance(document.getElementById("profileManagerModal"))?.hide(); }
function readableError(error) { if (error.code === "auth/requires-recent-login") return "Please sign out and sign in again, then retry."; if (error.code === "auth/wrong-password" || error.code === "auth/invalid-credential") return "Your current password is incorrect."; return error.message || "Could not save your changes."; }
function escapeHtml(value) { return String(value || "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c])); }
function escapeAttribute(value) { return escapeHtml(value); }
