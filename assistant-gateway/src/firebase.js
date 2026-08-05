"use strict";

/**
 * Firebase Admin wrapper.
 *
 * Responsibilities:
 *  1. Verify the Firebase Authentication ID token presented by the browser
 *     and recover the caller's Firebase UID.
 *  2. Read the caller's OWN Firestore data only (tenants are isolated purely by
 *     the `users/{uid}/...` path, mirroring the same guarantee in firestore.rules).
 *
 * The Admin SDK runs with full server privileges, so the gateway must be
 * extremely careful to never mint an arbitrary path from user input. We only
 * ever build paths from the *verified* `uid`, never from anything the client
 * sends directly.
 *
 * No Firebase Cloud Functions are used. This is a plain Node process on the
 * Harmy VPS, authenticating with a service account from
 * GOOGLE_APPLICATION_CREDENTIALS (Spark plan compatible).
 */

const CONFIG_SENTINEL = Symbol("smore.gateway.firebase.app");

// firebase-admin depends on jose, which ships ESM-only. We lazy-load the
// package so that tests which inject a stub never pay the cost of loading the
// real SDK (and never trip Jest's node_modules transform rules).
function loadFirebaseAdmin() {
  return require("firebase-admin");
}

/**
 * Lazily initialise Firebase Admin. Factory-injectable so tests can pass a
 * mocked app. Returns an object with `verifyIdToken`, `readUserFinance`,
 * `readUserTransactions`, `readUserBudgets`, `readUserGoals`.
 */
function createFirebaseGateway({ app = null } = {}) {
  let admin = app;

  function ensureAdmin() {
    if (admin) return admin;
    admin = loadFirebaseAdmin().initializeApp(_adminInitOptions(), CONFIG_SENTINEL.description);
    return admin;
  }

  function auth() {
    const fb = loadFirebaseAdmin();
    return fb.getAuth(ensureAdmin());
  }

  function store() {
    const fb = loadFirebaseAdmin();
    return fb.getFirestore(ensureAdmin());
  }

  /**
   * Verify an idToken string and return its decoded claims, or throw an
   * authenticated-friendly error. `uid` in the verified claims is the only
   * identity source we trust for tenant isolation.
   */
  async function verifyIdToken(idToken) {
    if (!idToken || typeof idToken !== "string" || idToken.trim().length === 0) {
      const err = new Error("A valid Bearer ID token is required.");
      err.kind = "auth";
      err.status = 401;
      throw err;
    }
    try {
      const decoded = await auth().verifyIdToken(idToken);
      if (!decoded || !decoded.uid) {
        const err = new Error("Token verified but contained no user identifier.");
        err.kind = "auth";
        err.status = 401;
        throw err;
      }
      return decoded;
    } catch (cause) {
      // Safe diagnostic: Firebase error metadata contains no token material.
      // This identifies expiry/audience/format failures without exposing the
      // credential or the submitted ID token in VPS logs.
      console.warn(
        "[gateway] Firebase ID token verification failed:",
        cause && cause.code ? cause.code : "unknown",
        cause && cause.message ? cause.message : "unknown error"
      );
      // firebase-admin throws {code: "auth/id-token-expired"} etc. Surface a
      // stable, model-shaped error and never leak internals to the client.
      const err = new Error("Authentication failed. Please refresh your session and try again.");
      err.kind = "auth";
      err.status = 401;
      err.cause = cause;
      throw err;
    }
  }

  /**
   * Safety helper: extract only the scalar fields we intend to send to Gemini,
   * converting Firestore Timestamps to ISO strings and rounding amounts to
   * integers. Anything unexpected is dropped — never passed through verbatim.
   */
  function _normalizeAmount(value, fallback = 0) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.round(n);
  }

  function _toIso(value) {
    if (!value) return null;
    // Firestore Timestamp has toDate(); Dates and ISO strings pass through.
    if (typeof value.toDate === "function") return value.toDate().toISOString();
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "string") return value;
    return null;
  }

  /**
   * Read a single subcollection for a user, mapping docs to a compact,
   * string/number-only summary safe for the LLM. `uid` must already be a
   * verified token UID.
   */
  async function readCollection(uid, collectionName, mapper) {
    const ref = store()
      .collection("users")
      .doc(uid)
      .collection(collectionName);
    const snapshot = await ref.get();
    const docs = [];
    snapshot.forEach((doc) => {
      docs.push(mapper(doc.id, doc.data()));
    });
    return docs;
  }

  // Per-subcollection mappers: pick explicit fields only.
  function mapTransaction(id, data) {
    return {
      id,
      type: data.type || "unknown",
      amount: _normalizeAmount(data.amount),
      category: typeof data.category === "string" ? data.category : "",
      description: typeof data.description === "string" ? data.description : "",
      date: _toIso(data.date),
    };
  }

  function mapBudget(id, data) {
    return {
      id,
      category: typeof data.category === "string" ? data.category : "",
      limit: _normalizeAmount(data.limit),
      period: data.period || "unknown",
    };
  }

  function mapGoal(id, data) {
    return {
      id,
      title: typeof data.title === "string" ? data.title : "",
      targetAmount: _normalizeAmount(data.targetAmount),
      savedAmount: _normalizeAmount(data.savedAmount),
      deadline: _toIso(data.deadline),
    };
  }

  /**
   * Full read of the caller's finance data for the assistant to reason over.
   * Returns a validated, copy-of-record summary (never "live" Firestore
   * objects, so this is safe to hand to an external LLM).
   */
  async function readUserFinance(uid) {
    const [transactions, budgets, goals] = await Promise.all([
      readCollection(uid, "transactions", mapTransaction),
      readCollection(uid, "budgets", mapBudget),
      readCollection(uid, "goals", mapGoal),
    ]);
    return {
      currency: "MMK",
      transactions,
      budgets,
      goals,
    };
  }

  return {
    ensureAdmin,
    verifyIdToken,
    readUserFinance,
    readCollection,
  };
}

/**
 * Admin initialisation options. Tries the explicit service-account file from
 * GOOGLE_APPLICATION_CREDENTIALS first (the VPS path), then falls back to
 * application-default credentials.
 */
function _adminInitOptions() {
  const { loadConfig } = require("./config");
  const cfg = loadConfig();
  const { cert, applicationDefault } = loadFirebaseAdmin();

  if (cfg.googleApplicationCredentials) {
    return {
      credential: cert(cfg.googleApplicationCredentials),
      projectId: cfg.firebaseProjectId,
    };
  }
  // Application-default (e.g. `gcloud auth application-default login`, or a
  // GOOGLE_APPLICATION_CREDENTIALS file pointing at a local emulator later).
  return {
    credential: applicationDefault(),
    projectId: cfg.firebaseProjectId,
  };
}

module.exports = { createFirebaseGateway };
