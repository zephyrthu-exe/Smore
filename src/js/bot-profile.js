/**
 * bot-profile.js — Firestore CRUD for users/{uid}/assistantProfile/profile
 *
 * Exposes three functions:
 *   loadBotProfile()   → Promise<profile | null>
 *   saveBotProfile(data) → Promise<void>
 *   resetBotProfile()  → Promise<void>
 *
 * Security: always uses auth.currentUser.uid — never a client-supplied UID.
 * No API keys, tokens, or credentials are stored here.
 */

import {
  doc,
  getDoc,
  setDoc,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";

/** Default bot profile values (Sombo defaults). */
export const DEFAULT_BOT_PROFILE = {
  name: "Sombo",
  style: "classic",
  accentColor: "#ff6b35",
};

const VALID_STYLES = ["classic", "friendly", "minimal", "energetic", "calm"];

/** Profile document path: users/{uid}/assistantProfile/profile */
function profileDocRef(uid) {
  return doc(db, "users", uid, "assistantProfile", "profile");
}

/**
 * Returns the authenticated user's UID. Never accepts a client-supplied UID.
 * @returns {string}
 */
function requireAuthUid() {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Not authenticated");
  return uid;
}

/**
 * Loads the assistant profile for the signed-in user.
 * @returns {Promise<object|null>} - Profile data or null if not set yet.
 */
export async function loadBotProfile() {
  const uid = auth.currentUser?.uid;
  if (!uid) return null;
  try {
    const snap = await getDoc(profileDocRef(uid));
    if (snap.exists()) {
      const data = snap.data();
      return {
        name: data.name,
        style: data.style,
        accentColor: data.accentColor,
      };
    }
    return null;
  } catch (err) {
    console.warn("[BotProfile] Could not load profile:", err.code || err.message, err.message);
    return null;
  }
}

/**
 * Saves (creates or updates) the assistant profile for the signed-in user.
 * Document shape matches validAssistantProfile() in firestore.rules exactly.
 * @param {object} data - { name, style, accentColor }
 */
export async function saveBotProfile(data) {
  const uid = requireAuthUid();

  const name = String(data.name || DEFAULT_BOT_PROFILE.name).slice(0, 40).trim() || DEFAULT_BOT_PROFILE.name;
  const style = VALID_STYLES.includes(data.style) ? data.style : DEFAULT_BOT_PROFILE.style;
  const accentColor = sanitizeHexColor(data.accentColor) || DEFAULT_BOT_PROFILE.accentColor;

  const ref = profileDocRef(uid);
  const existingSnap = await getDoc(ref);
  const now = Timestamp.now();

  const profileData = {
    name,
    style,
    accentColor,
    createdAt: existingSnap.exists() && existingSnap.data().createdAt
      ? existingSnap.data().createdAt
      : now,
    updatedAt: now,
  };

  await setDoc(ref, profileData);
}

/**
 * Resets the assistant profile to Sombo defaults.
 */
export async function resetBotProfile() {
  await saveBotProfile(DEFAULT_BOT_PROFILE);
}

/**
 * Ensures the value is a valid short hex color string (#rgb or #rrggbb).
 * Returns null if invalid.
 * @param {string} val
 * @returns {string|null}
 */
function sanitizeHexColor(val) {
  if (typeof val !== "string") return null;
  const trimmed = val.trim();
  // Allow #rgb or #rrggbb only
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed)) {
    return trimmed;
  }
  return null;
}
