"use strict";

/**
 * Guardrails for the Smore Assistant.
 *
 * All the rules from the project brief live here so they are enforced in one
 * place and vet-earnable, in two layers:
 *   a) INPUT guardrails: validate the client's question (shape, length, scope).
 *   b) OUTPUT guardrails: instruct the model, constrain its role, and define
 *      the structured JSON envelope it must return.
 *
 * The gateway now computes every authoritative financial figure itself
 * (`buildFinanceFacts`). The model is a natural-language layer only: it maps
 * the user's words to a typed action (when the user asks to ADD/CHANGE/DELETE
 * something) and turns the server-supplied numbers into a friendly `reply`.
 * This keeps Gemini from doing arithmetic or inventing data, and lets users
 * phrase the same request as many different ways.
 */

// Allowed question topics. Used to fail-fast on obviously out-of-scope input.
const SUPPORTED_TOPICS = ["spending", "transactions", "budgets", "goals"];

const MAX_QUESTION_LENGTH = 400;

/** Round any number to a non-negative integer. */
function _roundMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

/** Default zero-filled summary so every consumer reads the same shape. */
function _emptySummary() {
  return {
    transactionCount: 0,
    income: 0,
    expense: 0,
    net: 0,
    expenseByCategory: [],
    thisMonth: { label: null, income: 0, expense: 0, net: 0 },
  };
}

function _monthOf(iso) {
  if (!iso) return null;
  const m = String(iso).match(/^\d{4}-\d{2}/);
  return m ? m[0] : null;
}

function _nowMonthPrefix(now) {
  const d = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(d.getTime())) return null;
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${m}`;
}

function _spentInCategory(byCategory, category) {
  const e = byCategory.get(String(category || "").toLowerCase());
  return e ? e.total : 0;
}

/**
 * Build a deterministic, authoritative summary of the caller's own data.
 * This is the ONLY place totals/remaining/progress are computed. The model is
 * handed these numbers and never asked to do its own financial arithmetic.
 *
 * @param {object} finance  Mapped user data ({currency, transactions, budgets, goals}).
 * @param {Date|string} [now]  Reference date for "this month" bucketing.
 * @returns {object} A validated facts object safe to embed in a prompt.
 */
function buildFinanceFacts(finance, now = new Date()) {
  const cur = (finance && finance.currency) || "MMK";
  const transactions = Array.isArray(finance && finance.transactions) ? finance.transactions : [];
  const budgets = Array.isArray(finance && finance.budgets) ? finance.budgets : [];
  const goals = Array.isArray(finance && finance.goals) ? finance.goals : [];

  const summary = _emptySummary();
  summary.transactionCount = transactions.length;
  const byCategory = new Map();
  const month = _nowMonthPrefix(now);

  for (const t of transactions) {
    const type = t && t.type;
    const amount = _roundMoney(t && t.amount);
    const category = (t && t.category && String(t.category).trim()) || "General";

    if (type === "income") {
      summary.income += amount;
      if (month && _monthOf(t && t.date) === month) summary.thisMonth.income += amount;
    } else if (type === "expense") {
      summary.expense += amount;
      if (month && _monthOf(t && t.date) === month) summary.thisMonth.expense += amount;
      const key = category.toLowerCase();
      const entry = byCategory.get(key) || { category, total: 0, count: 0 };
      entry.category = category;
      entry.total += amount;
      entry.count += 1;
      byCategory.set(key, entry);
    }
  }

  summary.net = summary.income - summary.expense;
  summary.thisMonth.net = summary.thisMonth.income - summary.thisMonth.expense;
  summary.thisMonth.label = month;

  summary.expenseByCategory = [...byCategory.values()]
    .map((e) => ({
      category: e.category,
      total: e.total,
      count: e.count,
      pctOfExpense: summary.expense > 0 ? Math.round((e.total / summary.expense) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total);

  const budgetStatus = budgets.map((b) => {
    const limit = _roundMoney(b && b.limit);
    const spent = _spentInCategory(byCategory, b && b.category);
    const remaining = limit - spent;
    return {
      id: b && b.id,
      category: (b && b.category) || "General",
      limit,
      spent,
      remaining,
      overBy: remaining < 0 ? Math.abs(remaining) : 0,
      pctUsed: limit > 0 ? Math.min(100, Math.round((spent / limit) * 100)) : 0,
      period: (b && b.period) || "monthly",
      rollover: !!(b && b.rollover),
      withinLimit: remaining >= 0,
    };
  });

  const goalStatus = goals.map((g) => {
    const target = _roundMoney(g && g.targetAmount);
    const saved = _roundMoney(g && g.savedAmount);
    return {
      id: g && g.id,
      title: (g && g.title) || "Untitled goal",
      targetAmount: target,
      savedAmount: saved,
      remaining: Math.max(0, target - saved),
      pctSaved: target > 0 ? Math.min(100, Math.round((saved / target) * 100)) : 0,
      deadline: (g && g.deadline) || null,
    };
  });

  return {
    currency: cur,
    generatedAt: new Date().toISOString(),
    transactions,
    budgets: budgets.map((b) => ({
      id: b.id,
      category: b.category,
      limit: b.limit,
      period: b.period,
      rollover: !!b.rollover,
    })),
    goals,
    summary,
    budgetStatus,
    goalStatus,
  };
}

// Per-action-type payload schemas. `anyOf` lets Gemini model the RIGHT required
// fields for whichever action it picks (e.g. txType+amount for a create, id for a
// delete) instead of returning an empty {} for a propertyless object. Every branch
// is a plain Gemini-valid schema: `type` is a string (never an array) and there is
// no `additionalProperties`, so the gateway never sends a schema Gemini rejects.
const _createTxnPayload = {
  type: "object",
  description: "Add a new expense or income transaction.",
  properties: {
    txType: { type: "string", enum: ["expense", "income"] },
    amount: { type: "number", description: "Positive amount in MMK." },
    category: { type: "string" },
    description: { type: "string" },
  },
  required: ["txType", "amount"],
};
const _updateTxnPayload = {
  type: "object",
  description: "Change an existing transaction; supply at least one changing field.",
  properties: {
    id: { type: "string" },
    amount: { type: "number" },
    txType: { type: "string", enum: ["expense", "income"] },
    category: { type: "string" },
    description: { type: "string" },
  },
  required: ["id"],
};
const _idOnlyPayload = {
  type: "object",
  description: "The id of an existing item.",
  properties: { id: { type: "string" } },
  required: ["id"],
};
const _createBudgetPayload = {
  type: "object",
  description: "Set a new category budget.",
  properties: {
    category: { type: "string" },
    limit: { type: "number", description: "Positive limit in MMK." },
    rollover: { type: "boolean" },
  },
  required: ["category", "limit"],
};
const _updateBudgetPayload = {
  type: "object",
  description: "Change an existing budget; supply at least one changing field.",
  properties: {
    id: { type: "string" },
    category: { type: "string" },
    limit: { type: "number" },
    rollover: { type: "boolean" },
  },
  required: ["id"],
};
const _createGoalPayload = {
  type: "object",
  description: "Create a new savings goal.",
  properties: {
    title: { type: "string" },
    targetAmount: { type: "number", description: "Positive target in MMK." },
    savedAmount: { type: "number" },
    deadline: { type: "string" },
  },
  required: ["title", "targetAmount"],
};
const _updateGoalPayload = {
  type: "object",
  description: "Change an existing savings goal; supply at least one changing field.",
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    targetAmount: { type: "number" },
    savedAmount: { type: "number" },
    deadline: { type: "string" },
  },
  required: ["id"],
};

/**
 * JSON output contract for the model. The gateway validates the emitted action
 * against this shape and only executes after the user confirms.
 */
const ACTION_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string", description: "A short, friendly reply to the user." },
    action: {
      type: "object",
      nullable: true,
      description:
        "Present only when the user asks to ADD/CHANGE/DELETE something in their own data. null for questions/summaries.",
      properties: {
        type: {
          type: "string",
          enum: [
            "create_transaction",
            "update_transaction",
            "delete_transaction",
            "create_budget",
            "update_budget",
            "delete_budget",
            "create_goal",
            "update_goal",
            "delete_goal",
          ],
        },
        payload: {
          description:
            "Action-specific fields. Which keys are present depends on `type`; each branch below matches one action type.",
          anyOf: [
            _createTxnPayload, // create_transaction
            _updateTxnPayload, // update_transaction
            _idOnlyPayload, // delete_transaction
            _createBudgetPayload, // create_budget
            _updateBudgetPayload, // update_budget
            _idOnlyPayload, // delete_budget
            _createGoalPayload, // create_goal
            _updateGoalPayload, // update_goal
            _idOnlyPayload, // delete_goal
          ],
        },
      },
      required: ["type", "payload"],
    },
  },
  required: ["reply", "action"],
};

/**
 * Safely parse the model's JSON envelope. If the model emits non-JSON (rare),
 * fall back to treating the whole text as the reply with no action so nothing
 * is ever auto-executed.
 *
 * @param {string} text  Raw model output.
 * @returns {{reply: string, action: (object|null)}}
 */
function parseAssistantResponse(text) {
  const fallback = { reply: String(text || ""), action: null };
  if (!text || typeof text !== "string") return fallback;

  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return fallback;
  }
  if (!parsed || typeof parsed !== "object") return fallback;

  const reply = typeof parsed.reply === "string" ? parsed.reply : String(text);
  const action = parsed.action && typeof parsed.action === "object" ? parsed.action : null;
  return { reply, action };
}

/**
 * Validate a raw question string from the client.
 * Returns { ok: true } OR { ok: false, status, code, message }.
 */
function validateQuestion(raw) {
  if (raw == null) {
    return fail(400, "invalid_question", "A question is required.");
  }
  if (typeof raw !== "string") {
    return fail(400, "invalid_question", "The question must be text.");
  }
  const q = raw.trim();
  if (q.length === 0) {
    return fail(400, "invalid_question", "The question cannot be empty.");
  }
  if (q.length > MAX_QUESTION_LENGTH) {
    return fail(
      400,
      "invalid_question",
      `Question is too long. Please keep it under ${MAX_QUESTION_LENGTH} characters.`
    );
  }
  return { ok: true, question: q };
}

/**
 * Light topic check. If a question clearly mentions an unsupported subject,
 * reject it early (cheap) before spending a Gemini call. Non-obvious questions
 * are allowed through; the system prompt keeps the model on-topic.
 */
const OUT_OF_SCOPE_MARKERS = [
  /invest(?:ment|ing)?\b/i,
  /crypto/,
  /bitcoin/,
  /stock market/,
  /loan application/,
  /credit (?:score|card)\b/i,
  /tax (?:advice|filing|return)/i,
  /mortgage/i,
];

function scopeCheck(question) {
  for (const marker of OUT_OF_SCOPE_MARKERS) {
    if (marker.test(question)) {
      return {
        ok: false,
        status: 422,
        code: "out_of_scope",
        message:
          "Smore Assistant can only help with spending, transactions, budgets, and savings goals. It cannot give investment, tax, or lending advice.",
      };
    }
  }
  return { ok: true };
}

function fail(status, code, message) {
  return { ok: false, status, code, message };
}

/**
 * Build the full system instruction string the model should follow.
 * `finance` is the (already validated) caller's data summary.
 */
function buildSystemPrompt(finance) {
  const facts = buildFinanceFacts(finance);
  return [
    "You are Smore Assistant, the in-app helper for Smore (Save More), a personal finance tracker for students.",
    "",
    "You will be given the user's own financial data (transactions, budgets, savings goals), plus the authoritative figures the gateway computed from it. All amounts are in MMK.",
    "",
    "HARD RULES (never violate these):",
    "1. You MUST rely on the authoritative figures provided in the DATA section. You never perform authoritative financial calculations yourself; present the server's numbers as-is. You may round or restate them for readability, but NEVER change a value or invent a new one.",
    "2. NEVER invent, guess, or fabricate transactions, amounts, categories, budgets, goals, or ids that are not present in the DATA section. If some detail is missing, say so.",
    "3. You are NOT a licensed financial advisor. Never give investment, tax, legal, lending, or professional financial advice. You may give educational, general money-management tips (e.g. about budgeting habits), but clearly educational and non-personal.",
    "4. Never reveal private data beyond what is necessary to answer. The data is the user's own, so you may reference it, but keep the answer concise and directly relevant.",
    "5. If the data is insufficient to answer confidently, state clearly that information is insufficient and say exactly what additional data would help.",
    "6. Only support spending, transactions, budgets, and savings goals. If asked about anything else, politely decline and restate what you can help with.",
    "7. Be polite, clear, and concise. Answer in plain English (or Burmese if asked).",
    "",
    "OUTPUT FORMAT (MANDATORY): return a single JSON object with exactly two fields:",
    '  { "reply": "<your short friendly answer>", "action": null | { "type": "<action type>", "payload": { ... } } }',
    "",
    "  - Set `action` to null when the user asks a question or for a summary.",
    "  - Set `action` ONLY when the user asks to ADD, CHANGE, or DELETE something in their OWN data. Derive every id from the DATA section; never guess an id you cannot see. If you are not fully sure which item the user means, set action to null and explain what you found.",
    "",
    "ACTION TYPES (only these, with these payload shapes):",
    '  create_transaction: payload { txType: "expense"|"income", amount: number>0, category: string, description: string }',
    "  update_transaction: payload { id, amount?, txType?, category?, description? } (at least one field)",
    "  delete_transaction: payload { id }",
    "  create_budget: payload { category: string, limit: number>0, rollover?: boolean }",
    "  update_budget: payload { id, category?, limit?, rollover? } (at least one field)",
    "  delete_budget: payload { id }",
    "  create_goal: payload { title: string, targetAmount: number>0, savedAmount?: number>=0, deadline?: YYYY-MM-DD }",
    "  update_goal: payload { id, title?, targetAmount?, savedAmount?, deadline? } (at least one field)",
    "  delete_goal: payload { id }",
    "",
    "DATA SECTION (authoritative figures the gateway computed; currency MMK):",
    JSON.stringify(facts),
  ].join("\n");
}

module.exports = {
  SUPPORTED_TOPICS,
  MAX_QUESTION_LENGTH,
  validateQuestion,
  scopeCheck,
  buildSystemPrompt,
  buildFinanceFacts,
  parseAssistantResponse,
  ACTION_RESPONSE_SCHEMA,
};


