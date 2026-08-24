"use strict";

/**
 * Test helpers: build a gateway app with stub Firebase/Gemini and a config that
 * simulates a placeholder-complete Gemini key, so the /api/assistant path runs
 * through to the (stubbed) model.
 */

const { createApp } = require("../src/app");
const { loadConfig } = require("../src/config");

/**
 * Make a config with a tuned rate limit for tests.
 */
function testConfig(overrides = {}) {
  const base = loadConfig();
  return {
    ...base,
    port: 0,
    // A fake but non-placeholder key so the app routes through to the (stubbed)
    // Gemini client in tests. Never a real key.
    geminiApiKey: "test-gemini-key-not-real",
    geminiModel: "gemini-2.5-flash",
    rateLimitWindowMs: 60 * 1000, // 1 min window
    rateLimitMaxPerIp: 5, // small so rate-limit tests are fast
    ...overrides,
  };
}

/**
 * Build a ready-for-testing app with:
 *  - a stub firebase that verifies tokens from a registry,
 *  - a stub gemini whose behaviour is configurable.
 */
function buildTestApp({ firebaseImpl, geminiImpl, config } = {}) {
  const cfg = config || testConfig();

  const localData = JSON.parse(JSON.stringify(DATA_BY_UID));
  let idCounter = 100;

  const defaultFirebase = {
    async verifyIdToken(token) {
      if (!token) {
        const err = new Error("A valid Bearer ID token is required.");
        err.kind = "auth";
        err.status = 401;
        throw err;
      }
      // Simulated token → uid map: "token-userA" => "user-A", etc.
      const uid = TOKEN_TO_UID[token];
      if (!uid) {
        const err = new Error("Token invalid.");
        err.kind = "auth";
        err.status = 401;
        throw err;
      }
      return { uid };
    },
    async readUserFinance(uid) {
      return localData[uid] || { currency: "MMK", transactions: [], budgets: [], goals: [] };
    },
    async createTransaction(uid, payload) {
      const user = ensureUser(localData, uid);
      const id = `tx${idCounter++}`;
      user.transactions.push({
        id,
        type: payload.txType,
        amount: payload.amount,
        category: payload.category,
        description: payload.description,
        date: "2026-08-01T00:00:00.000Z",
      });
      return id;
    },
    async deleteTransaction(uid, id) {
      const user = ensureUser(localData, uid);
      user.transactions = user.transactions.filter((t) => t.id !== id);
    },
    async createBudget(uid, payload) {
      const user = ensureUser(localData, uid);
      const id = `bdg${idCounter++}`;
      user.budgets.push({ id, category: payload.category, limit: payload.limit, period: "monthly" });
      return id;
    },
    async deleteBudget(uid, id) {
      const user = ensureUser(localData, uid);
      user.budgets = user.budgets.filter((b) => b.id !== id);
    },
    async createGoal(uid, payload) {
      const user = ensureUser(localData, uid);
      const id = `goal${idCounter++}`;
      user.goals.push({
        id,
        title: payload.title,
        targetAmount: payload.targetAmount,
        savedAmount: payload.savedAmount,
        deadline: payload.deadline || null,
      });
      return id;
    },
    async deleteGoal(uid, id) {
      const user = ensureUser(localData, uid);
      user.goals = user.goals.filter((g) => g.id !== id);
    },
    async updateGoalSavedAmount(uid, goalId, savedAmount) {
      const user = ensureUser(localData, uid);
      const goal = user.goals.find((g) => g.id === goalId);
      if (!goal) return;
      goal.savedAmount = savedAmount;
    },
  };

  const defaultGemini = {
    async generate() {
      return { text: "Stub answer." };
    },
  };

  return createApp({
    config: cfg,
    firebase: firebaseImpl || defaultFirebase,
    gemini: geminiImpl || defaultGemini,
  });
}

function ensureUser(localData, uid) {
  if (!localData[uid]) {
    localData[uid] = { currency: "MMK", transactions: [], budgets: [], goals: [] };
  }
  return localData[uid];
}

// Shared simulated identities.
const TOKEN_TO_UID = {
  "token-userA": "user-A",
  "token-userB": "user-B",
};

const DATA_BY_UID = {
  "user-A": {
    currency: "MMK",
    transactions: [
      { id: "t1", type: "expense", amount: 15000, category: "food", description: "lunch", date: "2026-08-01T00:00:00.000Z" },
      { id: "t2", type: "income", amount: 500000, category: "allowance", description: "monthly", date: "2026-08-01T00:00:00.000Z" },
    ],
    budgets: [{ id: "b1", category: "food", limit: 200000, period: "monthly" }],
    goals: [{ id: "g1", title: "Laptop", targetAmount: 1000000, savedAmount: 300000, deadline: "2026-12-31T00:00:00.000Z" }],
  },
  "user-B": {
    currency: "MMK",
    transactions: [
      { id: "x1", type: "expense", amount: 999, category: "secret-category", description: "user B private", date: "2026-08-02T00:00:00.000Z" },
    ],
    budgets: [],
    goals: [],
  },
};

module.exports = { buildTestApp, testConfig, TOKEN_TO_UID, DATA_BY_UID };
