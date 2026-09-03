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

// Firebase Admin v14 exposes app, Auth, and Firestore APIs from separate
// modules. Lazy loading keeps injected test doubles independent of the SDK.
function loadFirebaseApp() {
  return require("firebase-admin/app");
}

function loadFirebaseAuth() {
  return require("firebase-admin/auth");
}

function loadFirebaseFirestore() {
  return require("firebase-admin/firestore");
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
    admin = loadFirebaseApp().initializeApp(_adminInitOptions(), CONFIG_SENTINEL.description);
    return admin;
  }

  function auth() {
    return loadFirebaseAuth().getAuth(ensureAdmin());
  }

  function store() {
    return loadFirebaseFirestore().getFirestore(ensureAdmin());
  }

  function timestampNow() {
    return loadFirebaseFirestore().Timestamp.now();
  }

  function timestampFromDate(date) {
    return loadFirebaseFirestore().Timestamp.fromDate(date);
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
      const codeStr = cause && cause.code ? cause.code : "unknown_auth_error";
      const msgStr = cause && cause.message ? cause.message : "unknown error";
      console.warn(
        "[gateway] Firebase ID token verification failed:",
        codeStr,
        msgStr
      );
      const err = new Error(`Authentication failed: [${codeStr}] ${msgStr}`);
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

  function _cleanText(value, fallback = "") {
    if (typeof value !== "string") return fallback;
    return value.trim();
  }

  function _assertPositiveAmount(value, fieldName) {
    const amount = _normalizeAmount(value, NaN);
    if (!Number.isFinite(amount) || amount <= 0) {
      const err = new Error(`${fieldName} must be a positive number.`);
      err.kind = "action";
      err.status = 400;
      err.code = "invalid_action_payload";
      throw err;
    }
    return amount;
  }

  async function createTransaction(uid, payload) {
    const txType = payload && payload.txType === "income" ? "income" : "expense";
    const amount = _assertPositiveAmount(payload && payload.amount, "Transaction amount");
    const category = _cleanText(payload && payload.category, "General").slice(0, 40) || "General";
    const description = _cleanText(payload && payload.description, `${txType} entry`).slice(0, 120) || `${txType} entry`;

    const ref = await store()
      .collection("users")
      .doc(uid)
      .collection("transactions")
      .add({
        type: txType,
        amount,
        category,
        description,
        date: timestampNow(),
        createdAt: timestampNow(),
      });
    return ref.id;
  }

  async function deleteTransaction(uid, txId) {
    const id = _cleanText(txId);
    if (!id) {
      const err = new Error("Transaction ID is required.");
      err.kind = "action";
      err.status = 400;
      err.code = "invalid_action_payload";
      throw err;
    }
    await store().collection("users").doc(uid).collection("transactions").doc(id).delete();
  }

  async function createBudget(uid, payload) {
    const category = _cleanText(payload && payload.category).slice(0, 40);
    const limit = _assertPositiveAmount(payload && payload.limit, "Budget limit");
    const rollover = !!(payload && payload.rollover);

    if (!category) {
      const err = new Error("Budget category is required.");
      err.kind = "action";
      err.status = 400;
      err.code = "invalid_action_payload";
      throw err;
    }

    const ref = await store()
      .collection("users")
      .doc(uid)
      .collection("budgets")
      .add({
        category,
        limit,
        rollover,
        period: "monthly",
        createdAt: timestampNow(),
      });
    return ref.id;
  }

  async function deleteBudget(uid, budgetId) {
    const id = _cleanText(budgetId);
    if (!id) {
      const err = new Error("Budget ID is required.");
      err.kind = "action";
      err.status = 400;
      err.code = "invalid_action_payload";
      throw err;
    }
    await store().collection("users").doc(uid).collection("budgets").doc(id).delete();
  }

  async function createGoal(uid, payload) {
    const title = _cleanText(payload && payload.title).slice(0, 60);
    const targetAmount = _assertPositiveAmount(payload && payload.targetAmount, "Goal target amount");
    const savedAmount = _normalizeAmount(payload && payload.savedAmount, 0);
    if (!title) {
      const err = new Error("Goal title is required.");
      err.kind = "action";
      err.status = 400;
      err.code = "invalid_action_payload";
      throw err;
    }
    if (!Number.isFinite(savedAmount) || savedAmount < 0) {
      const err = new Error("Saved amount must be zero or greater.");
      err.kind = "action";
      err.status = 400;
      err.code = "invalid_action_payload";
      throw err;
    }

    let deadline = null;
    if (payload && payload.deadline) {
      const parsed = new Date(payload.deadline);
      if (!Number.isNaN(parsed.getTime())) {
        deadline = timestampFromDate(parsed);
      }
    }

    const ref = await store()
      .collection("users")
      .doc(uid)
      .collection("goals")
      .add({
        title,
        targetAmount,
        savedAmount,
        deadline,
        createdAt: timestampNow(),
      });
    return ref.id;
  }

  async function deleteGoal(uid, goalId) {
    const id = _cleanText(goalId);
    if (!id) {
      const err = new Error("Goal ID is required.");
      err.kind = "action";
      err.status = 400;
      err.code = "invalid_action_payload";
      throw err;
    }
    await store().collection("users").doc(uid).collection("goals").doc(id).delete();
  }

  async function updateGoalSavedAmount(uid, goalId, savedAmountRaw) {
    const id = _cleanText(goalId);
    const savedAmount = _normalizeAmount(savedAmountRaw, NaN);
    if (!id || !Number.isFinite(savedAmount) || savedAmount < 0) {
      const err = new Error("Goal ID and a non-negative saved amount are required.");
      err.kind = "action";
      err.status = 400;
      err.code = "invalid_action_payload";
      throw err;
    }

    await store()
      .collection("users")
      .doc(uid)
      .collection("goals")
      .doc(id)
      .update({ savedAmount });
  }

  // Build a partial Firestore update from a whitelist of allowed fields. Any
  // unexpected keys are silently dropped, and amounts are rounded to ints.
  function pickUpdatable(payload, allowed) {
    const update = {};
    for (const key of allowed) {
      if (payload && payload[key] !== undefined) {
        if (key === "amount" || key === "limit" || key === "targetAmount" || key === "savedAmount") {
          update[key] = _normalizeAmount(payload[key], _HALT());
        } else {
          update[key] = payload[key];
        }
      }
    }
    return update;
  }

  // Sentinel so a malformed numeric field fails loudly (NaN propagates).
  function _HALT() {
    return NaN;
  }

  function _cleanUpdate(err, update) {
    for (const k of Object.keys(update)) {
      if (Number.isNaN(update[k])) {
        throw Object.assign(new Error("Amount fields must be numbers."), {
          kind: "action",
          status: 400,
          code: "invalid_action_payload",
        });
      }
    }
    return update;
  }

  async function updateTransaction(uid, txId, payload) {
    const id = _cleanText(txId);
    if (!id) {
      const err = new Error("Transaction ID is required.");
      err.kind = "action";
      err.status = 400;
      err.code = "invalid_action_payload";
      throw err;
    }
    const update = _cleanUpdate(null, pickUpdatable(payload, ["txType", "amount", "category", "description"]));
    if (Object.keys(update).length === 0) {
      const err = new Error("Nothing to update on that transaction.");
      err.kind = "action";
      err.status = 400;
      err.code = "invalid_action_payload";
      throw err;
    }
    await store().collection("users").doc(uid).collection("transactions").doc(id).update(update);
  }

  async function updateBudget(uid, budgetId, payload) {
    const id = _cleanText(budgetId);
    if (!id) {
      const err = new Error("Budget ID is required.");
      err.kind = "action";
      err.status = 400;
      err.code = "invalid_action_payload";
      throw err;
    }
    const update = _cleanUpdate(null, pickUpdatable(payload, ["category", "limit", "rollover"]));
    if (Object.keys(update).length === 0) {
      const err = new Error("Nothing to update on that budget.");
      err.kind = "action";
      err.status = 400;
      err.code = "invalid_action_payload";
      throw err;
    }
    await store().collection("users").doc(uid).collection("budgets").doc(id).update(update);
  }

  async function updateGoal(uid, goalId, payload) {
    const id = _cleanText(goalId);
    if (!id) {
      const err = new Error("Goal ID is required.");
      err.kind = "action";
      err.status = 400;
      err.code = "invalid_action_payload";
      throw err;
    }
    const update = _cleanUpdate(null, pickUpdatable(payload, ["title", "targetAmount", "savedAmount"]));
    if (payload && payload.deadline) {
      const parsed = new Date(payload.deadline);
      if (!Number.isNaN(parsed.getTime())) update.deadline = timestampFromDate(parsed);
    }
    if (Object.keys(update).length === 0) {
      const err = new Error("Nothing to update on that goal.");
      err.kind = "action";
      err.status = 400;
      err.code = "invalid_action_payload";
      throw err;
    }
    await store().collection("users").doc(uid).collection("goals").doc(id).update(update);
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
      rollover: !!data.rollover,
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
    createTransaction,
    deleteTransaction,
    updateTransaction,
    createBudget,
    deleteBudget,
    updateBudget,
    createGoal,
    deleteGoal,
    updateGoal,
    updateGoalSavedAmount,
    // Lower-level Firestore access so a serverless-compatible durable store
    // (e.g. FirestorePendingActionStore) can persist state across invocations.
    store,
    timestampNow,
    timestampFromDate,
  };
}

/**
 * Safely parses a service account JSON string from environment variables.
 * Automatically unescapes literal \n sequences in private_key.
 */
function _parseServiceAccountJson(jsonString) {
  if (!jsonString || typeof jsonString !== "string") return null;
  let raw = jsonString.trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    raw = raw.slice(1, -1);
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.private_key === "string") {
      parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
    }
    return parsed;
  } catch (error) {
    console.error("[gateway] Failed to parse service account JSON from environment variable:", error.message);
    return null;
  }
}

/**
 * Admin initialisation options. Tries the explicit service-account file from
 * GOOGLE_APPLICATION_CREDENTIALS first (the VPS path), then falls back to
 * application-default credentials.
 */
function _adminInitOptions() {
  const { loadConfig } = require("./config");
  const cfg = loadConfig();
  const { cert, applicationDefault } = loadFirebaseApp();

  if (cfg.googleApplicationCredentialsJson) {
    const sa = _parseServiceAccountJson(cfg.googleApplicationCredentialsJson);
    if (sa) {
      return {
        credential: cert(sa),
        projectId: sa.project_id || cfg.firebaseProjectId,
      };
    }
  }

  if (cfg.googleApplicationCredentials) {
    const rawCredential = cfg.googleApplicationCredentials.trim();
    if (rawCredential.startsWith("{")) {
      const sa = _parseServiceAccountJson(rawCredential);
      if (sa) {
        return {
          credential: cert(sa),
          projectId: sa.project_id || cfg.firebaseProjectId,
        };
      }
    }

    // VPS: a file path to the service-account JSON lives outside the repo.
    return {
      credential: cert(rawCredential),
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
