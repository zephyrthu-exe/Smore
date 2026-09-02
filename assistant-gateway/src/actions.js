"use strict";

/**
 * Data-changing actions for the Smore Assistant.
 *
 * The model (Gemini) only decides WHAT the user wants; it never writes to
 * Firestore. This module is the deterministic safety layer that:
 *   1. validates/sanitizes a proposed action (shape, amounts, enums, lengths),
 *   2. stages it behind a short-lived, per-user confirmation token, and
 *   3. executes it against the caller's OWN data (tenant isolated by uid).
 *
 * Nothing here ever accepts a uid from the client; `executeAction` is always
 * called with the verified token UID.
 */

const { randomBytes } = require("crypto");

const ACTION_TTL_MS = 5 * 60 * 1000;

const ACTION_TYPES = new Set([
  "create_transaction",
  "update_transaction",
  "delete_transaction",
  "create_budget",
  "update_budget",
  "delete_budget",
  "create_goal",
  "update_goal",
  "delete_goal",
]);

// ── Small, safe field helpers ────────────────────────────────────────────────

function roundMoney(value, fallback = NaN) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(n);
}

function clampString(value, max, fallback = "") {
  if (typeof value !== "string") return fallback;
  const s = value.trim();
  return s ? s.slice(0, max) : fallback;
}

function requireId(payload) {
  const id = clampString(payload && payload.id, 40);
  if (!id) return { ok: false, reason: "The target item id is required." };
  return { ok: true, value: id };
}

function clampDate(value) {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function validateCreateTransaction(p) {
  const rawType = typeof (p && p.txType) === "string" ? p.txType.trim().toLowerCase() : "";
  const txType = rawType === "income" ? "income" : rawType === "expense" ? "expense" : null;
  if (!txType) return { ok: false, reason: "txType must be 'expense' or 'income'." };
  const amount = roundMoney(p && p.amount, NaN);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: "Transaction amount must be a positive number." };
  const category = clampString(p && p.category, 40, "General");
  const description = clampString(p && p.description, 120, `${txType} entry`) || `${txType} entry`;
  return { ok: true, payload: { txType, amount, category, description } };
}

function validateUpdateTransaction(p) {
  const id = requireId(p);
  if (!id.ok) return id;
  const payload = { id: id.value };
  if (p && p.amount != null) {
    const amount = roundMoney(p.amount, NaN);
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: "Transaction amount must be a positive number." };
    payload.amount = amount;
  }
  if (p && p.txType != null) {
    const t = String(p.txType).trim().toLowerCase();
    if (t === "expense" || t === "income") payload.txType = t;
  }
  const category = clampString(p && p.category, 40);
  if (category) payload.category = category;
  const description = clampString(p && p.description, 120);
  if (description) payload.description = description;

  const hasField = ["amount", "txType", "category", "description"].some((k) => payload[k] !== undefined);
  if (!hasField) return { ok: false, reason: "Supply at least one field to change (amount, txType, category, or description)." };
  return { ok: true, payload };
}

function validateDeleteTransaction(p) {
  const id = requireId(p);
  if (!id.ok) return id;
  return { ok: true, payload: { id: id.value } };
}

function validateCreateBudget(p) {
  const category = clampString(p && p.category, 40);
  if (!category) return { ok: false, reason: "A budget category is required." };
  const limit = roundMoney(p && p.limit, NaN);
  if (!Number.isFinite(limit) || limit <= 0) return { ok: false, reason: "Budget limit must be a positive number." };
  return { ok: true, payload: { category, limit, rollover: !!(p && p.rollover) } };
}

function validateUpdateBudget(p) {
  const id = requireId(p);
  if (!id.ok) return id;
  const payload = { id: id.value };
  const category = clampString(p && p.category, 40);
  if (category) payload.category = category;
  if (p && p.limit != null) {
    const limit = roundMoney(p.limit, NaN);
    if (!Number.isFinite(limit) || limit <= 0) return { ok: false, reason: "Budget limit must be a positive number." };
    payload.limit = limit;
  }
  if (typeof (p && p.rollover) === "boolean") payload.rollover = p.rollover;
  const hasField = ["category", "limit", "rollover"].some((k) => payload[k] !== undefined);
  if (!hasField) return { ok: false, reason: "Supply at least one field to change (category, limit, or rollover)." };
  return { ok: true, payload };
}

function validateDeleteBudget(p) {
  const id = requireId(p);
  if (!id.ok) return id;
  return { ok: true, payload: { id: id.value } };
}

function validateCreateGoal(p) {
  const title = clampString(p && p.title, 60);
  if (!title) return { ok: false, reason: "A goal title is required." };
  const targetAmount = roundMoney(p && p.targetAmount, NaN);
  if (!Number.isFinite(targetAmount) || targetAmount <= 0) return { ok: false, reason: "Goal target amount must be a positive number." };
  const savedAmount = roundMoney(p && p.savedAmount, 0);
  if (!Number.isFinite(savedAmount) || savedAmount < 0) return { ok: false, reason: "Saved amount must be zero or greater." };
  const payload = { title, targetAmount, savedAmount };
  const deadline = clampDate(p && p.deadline);
  if (deadline) payload.deadline = deadline;
  return { ok: true, payload };
}

function validateUpdateGoal(p) {
  const id = requireId(p);
  if (!id.ok) return id;
  const payload = { id: id.value };
  const title = clampString(p && p.title, 60);
  if (title) payload.title = title;
  if (p && p.targetAmount != null) {
    const targetAmount = roundMoney(p.targetAmount, NaN);
    if (!Number.isFinite(targetAmount) || targetAmount <= 0) return { ok: false, reason: "Goal target amount must be a positive number." };
    payload.targetAmount = targetAmount;
  }
  if (p && p.savedAmount != null) {
    const savedAmount = roundMoney(p.savedAmount, NaN);
    if (!Number.isFinite(savedAmount) || savedAmount < 0) return { ok: false, reason: "Saved amount must be zero or greater." };
    payload.savedAmount = savedAmount;
  }
  const deadline = clampDate(p && p.deadline);
  if (deadline) payload.deadline = deadline;
  const hasField = ["title", "targetAmount", "savedAmount", "deadline"].some((k) => payload[k] !== undefined);
  if (!hasField) return { ok: false, reason: "Supply at least one field to change (title, targetAmount, savedAmount, or deadline)." };
  return { ok: true, payload };
}

function validateDeleteGoal(p) {
  const id = requireId(p);
  if (!id.ok) return id;
  return { ok: true, payload: { id: id.value } };
}

const VALIDATORS = {
  create_transaction: validateCreateTransaction,
  update_transaction: validateUpdateTransaction,
  delete_transaction: validateDeleteTransaction,
  create_budget: validateCreateBudget,
  update_budget: validateUpdateBudget,
  delete_budget: validateDeleteBudget,
  create_goal: validateCreateGoal,
  update_goal: validateUpdateGoal,
  delete_goal: validateDeleteGoal,
};

/**
 * Per-user store of actions waiting for confirmation. Tokens are short,
 * expire after ACTION_TTL_MS, and are scoped to the uid that created them so a
 * different user can never confirm another user's staged action.
 */
class PendingActionStore {
  constructor() {
    this.byUid = new Map();
  }

  create(uid, action) {
    this._cleanup(uid);
    const token = randomBytes(3).toString("hex").toUpperCase();
    this.byUid.set(uid, { token, action, expiresAt: Date.now() + ACTION_TTL_MS });
    return token;
  }

  consume(uid, token) {
    this._cleanup(uid);
    const entry = this.byUid.get(uid);
    if (!entry) return null;
    if (entry.token.toUpperCase() !== String(token || "").toUpperCase()) return null;
    this.byUid.delete(uid);
    return entry.action;
  }

  _cleanup(uid) {
    const entry = this.byUid.get(uid);
    if (!entry) return;
    if (entry.expiresAt <= Date.now()) this.byUid.delete(uid);
  }
}

/**
 * Firestore-backed pending-action store for serverless hosts (e.g. Vercel),
 * where a single Node process is NOT long-lived and an in-memory map would be
 * lost between the "stage a change" request and the later "confirm" request.
 *
 * Mirrors the in-memory contract (per-uid token, one-shot consume, TTL) but
 * persists each pending action as a Firestore document. It only ever writes
 * under the verified `users/{uid}/assistantActions` path. The Admin SDK runs
 * with full privileges and bypasses Firestore rules, so this is permitted
 * regardless of the client-facing rules.
 */
class FirestorePendingActionStore {
  constructor(firebaseGateway) {
    this.fb = firebaseGateway;
  }

  _collection(uid) {
    return this.fb
      .store()
      .collection("users")
      .doc(String(uid))
      .collection("assistantActions");
  }

  async create(uid, action) {
    const token = randomBytes(3).toString("hex").toUpperCase();
    await this._collection(uid).doc(token).set({
      action,
      expiresAt: this.fb.timestampFromDate(new Date(Date.now() + ACTION_TTL_MS)),
    });
    return token;
  }

  async consume(uid, token) {
    const normalized = String(token || "").trim().toUpperCase();
    if (!normalized) return null;
    const ref = this._collection(uid).doc(normalized);
    const snap = await ref.get().catch(() => null);
    if (!snap || !snap.exists) return null;
    const data = snap.data();
    const expiresAt = data && data.expiresAt;
    const expired =
      expiresAt &&
      typeof expiresAt.toDate === "function" &&
      expiresAt.toDate().getTime() <= Date.now();
    if (expired) {
      await ref.delete().catch(() => {});
      return null;
    }
    await ref.delete().catch(() => {});
    return data.action;
  }
}

/**
 * Validate and normalise a proposed action (whatever shape the model emitted)
 * into a strict, safe shape. Returns { ok, action } or { ok:false, reason }.
 */
function sanitizeAction(action) {
  if (!action || typeof action !== "object") return { ok: false, reason: "No action was provided." };
  const type = action.type;
  if (!ACTION_TYPES.has(type)) return { ok: false, reason: `Unsupported action type: ${String(type)}.` };
  const rawPayload = action.payload && typeof action.payload === "object" ? action.payload : {};
  const result = VALIDATORS[type](rawPayload);
  if (!result.ok) return result;
  return { ok: true, action: { type, payload: result.payload } };
}

/**
 * For update/delete actions, verify the referenced id exists in the caller's OWN
 * current data. Returns null when the reference is fine, or { kind, id } when
 * the model referred to an item that isn't there (so we can ask the user which
 * one they meant instead of writing to a missing doc / guessing).
 */
function findMissingReference(action, finance) {
  const type = action && action.type;
  const id = action && action.payload && action.payload.id;
  if (!type || !id) return null;
  const key = String(id);
  const data = finance || {};

  if (type === "update_transaction" || type === "delete_transaction") {
    return Array.isArray(data.transactions) && data.transactions.some((x) => String(x.id) === key)
      ? null
      : { kind: "transaction", id: key };
  }
  if (type === "update_budget" || type === "delete_budget") {
    return Array.isArray(data.budgets) && data.budgets.some((x) => String(x.id) === key)
      ? null
      : { kind: "budget", id: key };
  }
  if (type === "update_goal" || type === "delete_goal") {
    return Array.isArray(data.goals) && data.goals.some((x) => String(x.id) === key)
      ? null
      : { kind: "goal", id: key };
  }
  return null;
}

/**
 * Detect an explicit confirmation message, e.g. "confirm 3F8A2C".
 * Confirmation is deliberately exact and not interpreted by the LLM, so a model
 * can never silently confirm a destructive action for the user.
 */
function parseConfirmation(question) {
  const m = /^confirm\s+([A-F0-9]{6})$/i.exec(String(question || "").trim());
  return m ? { kind: "confirm", token: m[1].toUpperCase() } : { kind: "none" };
}

/**
 * A short, human-readable description of an action, shown to the user before
 * they confirm. This is what the user reviews, so it should be unambiguous.
 */
function describeAction(action) {
  if (!action || !action.type) return "That change";
  const p = action.payload || {};
  const money = (v) => `${Number(v).toLocaleString("en-US")} MMK`;

  switch (action.type) {
    case "create_transaction":
      return `Add a ${p.txType} of ${money(p.amount)} in ${p.category}${p.description && p.description !== `${p.txType} entry` ? ` (${p.description})` : ""}`;
    case "update_transaction":
      return `Update transaction ${p.id}${_changedTo(p)}`;
    case "delete_transaction":
      return `Delete transaction ${p.id}`;
    case "create_budget":
      return `Set a ${p.category} budget of ${money(p.limit)}${p.rollover === true ? " (with rollover)" : ""}`;
    case "update_budget":
      return `Update budget ${p.id}${_changedTo(p)}`;
    case "delete_budget":
      return `Delete budget ${p.id}`;
    case "create_goal":
      return `Create goal "${p.title}" targeting ${money(p.targetAmount)}${p.deadline ? ` by ${p.deadline}` : ""}`;
    case "update_goal":
      return `Update goal ${p.id}${_changedTo(p)}`;
    case "delete_goal":
      return `Delete goal ${p.id}`;
    default:
      return "That change";
  }
}

function _changedTo(p) {
  const parts = [];
  for (const key of ["amount", "targetAmount", "savedAmount", "limit", "category", "title", "txType", "description", "rollover", "deadline"]) {
    if (p[key] !== undefined) parts.push(`${key} → ${p[key]}`);
  }
  return parts.length ? ` (${parts.join(", ")})` : "";
}

/**
 * Execute a validated action against the caller's OWN data.
 * `uid` is always the verified token UID, never a client-supplied value.
 */
async function executeAction(action, uid, firebaseGateway) {
  const p = action.payload || {};
  switch (action.type) {
    case "create_transaction": {
      const id = await firebaseGateway.createTransaction(uid, p);
      return { message: `Done. Logged a ${Number(p.amount).toLocaleString("en-US")} MMK ${p.txType} in ${p.category} (ID ${id}).` };
    }
    case "update_transaction": {
      const id = await firebaseGateway.updateTransaction(uid, p.id, p);
      return { message: `Done. Updated transaction ${p.id}${_done(p)}` };
    }
    case "delete_transaction": {
      await firebaseGateway.deleteTransaction(uid, p.id);
      return { message: `Done. Deleted transaction ${p.id}.` };
    }
    case "create_budget": {
      const id = await firebaseGateway.createBudget(uid, p);
      return { message: `Done. Set a ${Number(p.limit).toLocaleString("en-US")} MMK ${p.category} budget${p.rollover ? " with rollover" : ""} (ID ${id}).` };
    }
    case "update_budget": {
      await firebaseGateway.updateBudget(uid, p.id, p);
      return { message: `Done. Updated budget ${p.id}${_done(p)}` };
    }
    case "delete_budget": {
      await firebaseGateway.deleteBudget(uid, p.id);
      return { message: `Done. Deleted budget ${p.id}.` };
    }
    case "create_goal": {
      const id = await firebaseGateway.createGoal(uid, p);
      return { message: `Done. Created goal "${p.title}" with target ${Number(p.targetAmount).toLocaleString("en-US")} MMK (ID ${id}).` };
    }
    case "update_goal": {
      await firebaseGateway.updateGoal(uid, p.id, p);
      return { message: `Done. Updated goal ${p.id}${_done(p)}` };
    }
    case "delete_goal": {
      await firebaseGateway.deleteGoal(uid, p.id);
      return { message: `Done. Deleted goal ${p.id}.` };
    }
    default:
      throw Object.assign(new Error("Unsupported action."), {
        kind: "action",
        status: 400,
        code: "unsupported_action",
      });
  }
}

function _done(p) {
  const keys = ["amount", "targetAmount", "savedAmount", "limit", "category", "title", "txType", "description", "rollover", "deadline"];
  const parts = [];
  for (const k of keys) {
    if (p[k] !== undefined) parts.push(`${k} → ${p[k]}`);
  }
  return parts.length ? ` (${parts.join(", ")})` : "";
}

module.exports = {
  PendingActionStore,
  FirestorePendingActionStore,
  ACTION_TYPES,
  sanitizeAction,
  parseConfirmation,
  describeAction,
  executeAction,
  findMissingReference,
};





