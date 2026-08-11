/**
 * bot-profile.js â€” Firestore CRUD for users/{uid}/assistantProfile/profile
 *
 * Exposes three functions:
 *   loadBotProfile(uid)        â†’ Promise<profile | null>
 *   saveBotProfile(uid, data)  â†’ Promise<void>
 *   resetBotProfile(uid)       â†’ Promise<void>
 *
 * Security: uid MUST always be auth.currentUser.uid â€” never a client-supplied value.
 * No API keys, tokens, or credentials are stored here.
 */

import {
  doc,
  getDoc,
  setDoc,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { db } from "./firebase-config.js";

/** Default bot profile values (Sombo defaults). */
export const DEFAULT_BOT_PROFILE = {
  name: "Sombo",
  style: "classic",
  accentColor: "#ff6b35",
};

const VALID_STYLES = ["classic", "friendly", "minimal", "energetic", "calm"];

/**
 * Loads the assistant profile for the given uid.
 * @param {string} uid - Firebase Auth UID (must be auth.currentUser.uid)
 * @returns {Promise<object|null>} - Profile data or null if not set yet.
 */
export async function loadBotProfile(uid) {
  if (!uid) return null;
  try {
    const ref = doc(db, "users", uid, "assistantProfile", "profile");
    const snap = await getDoc(ref);
    if (snap.exists()) {
      return snap.data();
    }
    return null;
  } catch (err) {
    console.warn("[BotProfile] Could not load profile:", err.message);
    return null;
  }
}

/**
 * Saves (creates or updates) the assistant profile for the given uid.
 * Sanitises all fields before writing. Never stores credentials.
 * @param {string} uid - Firebase Auth UID (must be auth.currentUser.uid)
 * @param {object} data - { name, style, accentColor }
 */
export async function saveBotProfile(uid, data) {
  if (!uid) throw new Error("uid is required");

  // Sanitize
  const name = String(data.name || DEFAULT_BOT_PROFILE.name).slice(0, 40).trim() || DEFAULT_BOT_PROFILE.name;
  const style = VALID_STYLES.includes(data.style) ? data.style : DEFAULT_BOT_PROFILE.style;
  const accentColor = sanitizeHexColor(data.accentColor) || DEFAULT_BOT_PROFILE.accentColor;

  const ref = doc(db, "users", uid, "assistantProfile", "profile");
  const existingSnap = await getDoc(ref);

  const profileData = {
    name,
    style,
    accentColor,
    updatedAt: Timestamp.now(),
    createdAt: existingSnap.exists()
      ? existingSnap.data().createdAt
      : Timestamp.now(),
  };

  await setDoc(ref, profileData, { merge: false });
}

/**
 * Resets the assistant profile to Sombo defaults.
 * @param {string} uid - Firebase Auth UID (must be auth.currentUser.uid)
 */
export async function resetBotProfile(uid) {
  await saveBotProfile(uid, DEFAULT_BOT_PROFILE);
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
