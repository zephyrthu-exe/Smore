"use strict";

const { randomBytes } = require("crypto");

const ACTION_TTL_MS = 5 * 60 * 1000;

class PendingActionStore {
  constructor() {
    this.byUid = new Map();
  }

  create(uid, action) {
    this._cleanup(uid);
    const token = randomBytes(3).toString("hex").toUpperCase();
    this.byUid.set(uid, {
      token,
      action,
      expiresAt: Date.now() + ACTION_TTL_MS,
    });
    return token;
  }

  consume(uid, token) {
    this._cleanup(uid);
    const entry = this.byUid.get(uid);
    if (!entry) return null;
    if (entry.token !== token) return null;
    this.byUid.delete(uid);
    return entry.action;
  }

  _cleanup(uid) {
    const entry = this.byUid.get(uid);
    if (!entry) return;
    if (entry.expiresAt <= Date.now()) this.byUid.delete(uid);
  }
}

function parseActionRequest(question) {
  const q = String(question || "").trim();
  if (!q) return { kind: "none" };

  const confirmMatch = /^confirm\s+([A-F0-9]{6})$/i.exec(q);
  if (confirmMatch) {
    return { kind: "confirm", token: confirmMatch[1].toUpperCase() };
  }

  const txCreate = parseCreateTransaction(q);
  if (txCreate) return { kind: "action", action: txCreate };

  const txDelete = parseDeleteById(q, "transaction");
  if (txDelete) return { kind: "action", action: txDelete };

  const budgetCreate = parseCreateBudget(q);
  if (budgetCreate) return { kind: "action", action: budgetCreate };

  const budgetDelete = parseDeleteById(q, "budget");
  if (budgetDelete) return { kind: "action", action: budgetDelete };

  const goalCreate = parseCreateGoal(q);
  if (goalCreate) return { kind: "action", action: goalCreate };

  const goalDelete = parseDeleteById(q, "goal");
  if (goalDelete) return { kind: "action", action: goalDelete };

  const goalUpdate = parseUpdateGoalSaved(q);
  if (goalUpdate) return { kind: "action", action: goalUpdate };

  return { kind: "none" };
}

function parseCreateTransaction(q) {
  const lower = q.toLowerCase();
  if (!/\b(add|create|log|record)\b/.test(lower)) return null;
  if (!/\b(transaction|expense|income)\b/.test(lower)) return null;

  const typeMatch = /\b(expense|income)\b/i.exec(q);
  const amount = extractAmount(q);
  if (!typeMatch || amount == null || amount <= 0) return null;

  const type = typeMatch[1].toLowerCase();
  const category = extractField(q, [/\bcategory\s+([a-zA-Z][\w\s-]{1,40})$/i, /\bin\s+category\s+([a-zA-Z][\w\s-]{1,40})$/i]) || "General";
  const description = extractField(q, [/\bfor\s+(.+?)(?:\s+in\s+category\b|\s+category\b|$)/i]) || `${type} entry`;

  return {
    type: "create_transaction",
    payload: {
      txType: type,
      amount,
      category: category.trim(),
      description: description.trim(),
    },
  };
}

function parseCreateBudget(q) {
  const m = /^\s*(?:add|create|set)\s+budget\s+(?:for\s+)?([a-zA-Z][\w\s-]{1,40})\s+(?:to\s+|at\s+|of\s+)?([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:mmk)?(?:\s+(with|without)\s+rollover)?\s*$/i.exec(q);
  if (!m) return null;
  const category = m[1].trim();
  const limit = parseAmountNumber(m[2]);
  if (!Number.isFinite(limit) || limit <= 0) return null;
  const rollover = (m[3] || "").toLowerCase() === "with";

  return {
    type: "create_budget",
    payload: {
      category,
      limit,
      rollover,
    },
  };
}

function parseCreateGoal(q) {
  const m = /^\s*(?:add|create|set)\s+goal\s+(?:named\s+)?([\w\s-]{2,50})\s+(?:target\s+|of\s+|for\s+)([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:mmk)?(?:\s+saved\s+([0-9][0-9,]*(?:\.[0-9]+)?))?(?:\s+by\s+(\d{4}-\d{2}-\d{2}))?\s*$/i.exec(q);
  if (!m) return null;

  const title = m[1].trim();
  const targetAmount = parseAmountNumber(m[2]);
  const savedAmount = m[3] ? parseAmountNumber(m[3]) : 0;
  const deadline = m[4] || null;

  if (!title || targetAmount <= 0 || savedAmount < 0) return null;

  return {
    type: "create_goal",
    payload: {
      title,
      targetAmount,
      savedAmount,
      deadline,
    },
  };
}

function parseDeleteById(q, entity) {
  const rx = new RegExp(`^\\s*(?:delete|remove)\\s+${entity}\\s+([a-zA-Z0-9_-]{1,80})\\s*$`, "i");
  const m = rx.exec(q);
  if (!m) return null;
  return {
    type: `delete_${entity}`,
    payload: {
      id: m[1],
    },
  };
}

function parseUpdateGoalSaved(q) {
  const m = /^\s*(?:update|set)\s+goal\s+([a-zA-Z0-9_-]{1,80})\s+saved\s+(?:to\s+)?([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:mmk)?\s*$/i.exec(q);
  if (!m) return null;

  const goalId = m[1];
  const savedAmount = parseAmountNumber(m[2]);
  if (savedAmount < 0) return null;

  return {
    type: "update_goal_saved",
    payload: { goalId, savedAmount },
  };
}

function extractAmount(q) {
  const m = /([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:mmk)?\b/i.exec(q);
  if (!m) return null;
  return parseAmountNumber(m[1]);
}

function parseAmountNumber(raw) {
  const n = Number(String(raw).replace(/,/g, ""));
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n);
}

function extractField(q, patterns) {
  for (const p of patterns) {
    const m = p.exec(q);
    if (m && m[1]) return m[1];
  }
  return null;
}

async function executeAction(action, uid, firebaseGateway) {
  switch (action.type) {
    case "create_transaction": {
      const id = await firebaseGateway.createTransaction(uid, action.payload);
      return {
        message: `Done. Created ${action.payload.txType} transaction (${action.payload.amount} MMK) with ID ${id}.`,
      };
    }
    case "delete_transaction": {
      await firebaseGateway.deleteTransaction(uid, action.payload.id);
      return {
        message: `Done. Deleted transaction ${action.payload.id}.`,
      };
    }
    case "create_budget": {
      const id = await firebaseGateway.createBudget(uid, action.payload);
      return {
        message: `Done. Created budget ${action.payload.category} (${action.payload.limit} MMK) with ID ${id}.`,
      };
    }
    case "delete_budget": {
      await firebaseGateway.deleteBudget(uid, action.payload.id);
      return {
        message: `Done. Deleted budget ${action.payload.id}.`,
      };
    }
    case "create_goal": {
      const id = await firebaseGateway.createGoal(uid, action.payload);
      return {
        message: `Done. Created goal "${action.payload.title}" with ID ${id}.`,
      };
    }
    case "delete_goal": {
      await firebaseGateway.deleteGoal(uid, action.payload.id);
      return {
        message: `Done. Deleted goal ${action.payload.id}.`,
      };
    }
    case "update_goal_saved": {
      await firebaseGateway.updateGoalSavedAmount(uid, action.payload.goalId, action.payload.savedAmount);
      return {
        message: `Done. Updated goal ${action.payload.goalId} saved amount to ${action.payload.savedAmount} MMK.`,
      };
    }
    default:
      throw Object.assign(new Error("Unsupported action."), {
        kind: "action",
        status: 400,
        code: "unsupported_action",
      });
  }
}

function describeAction(action) {
  switch (action.type) {
    case "create_transaction":
      return `Create ${action.payload.txType} transaction: ${action.payload.amount} MMK, ${action.payload.category}, ${action.payload.description}.`;
    case "delete_transaction":
      return `Delete transaction ${action.payload.id}.`;
    case "create_budget":
      return `Create budget ${action.payload.category} with limit ${action.payload.limit} MMK (${action.payload.rollover ? "with" : "without"} rollover).`;
    case "delete_budget":
      return `Delete budget ${action.payload.id}.`;
    case "create_goal":
      return `Create goal ${action.payload.title}, target ${action.payload.targetAmount} MMK${action.payload.deadline ? `, deadline ${action.payload.deadline}` : ""}.`;
    case "delete_goal":
      return `Delete goal ${action.payload.id}.`;
    case "update_goal_saved":
      return `Update goal ${action.payload.goalId} saved amount to ${action.payload.savedAmount} MMK.`;
    default:
      return "Unknown action.";
  }
}

module.exports = {
  PendingActionStore,
  parseActionRequest,
  executeAction,
  describeAction,
};
