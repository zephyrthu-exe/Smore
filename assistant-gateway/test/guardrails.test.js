"use strict";

const {
  validateQuestion,
  scopeCheck,
  buildSystemPrompt,
  buildFinanceFacts,
  SUPPORTED_TOPICS,
  ACTION_RESPONSE_SCHEMA,
} = require("../src/guardrails");

describe("validateQuestion", () => {
  it("rejects null/undefined/empty/whitespace", () => {
    expect(validateQuestion(null).ok).toBe(false);
    expect(validateQuestion(undefined).ok).toBe(false);
    expect(validateQuestion("").ok).toBe(false);
    expect(validateQuestion("   ").ok).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(validateQuestion(42).ok).toBe(false);
    expect(validateQuestion({}).ok).toBe(false);
  });

  it("rejects over-length input", () => {
    expect(validateQuestion("x".repeat(401)).ok).toBe(false);
  });

  it("accepts a reasonable question and trims it", () => {
    const r = validateQuestion("  How much did I spend?  ");
    expect(r.ok).toBe(true);
    expect(r.question).toBe("How much did I spend?");
  });
});

describe("scopeCheck", () => {
  it("allows supported topics", () => {
    for (const t of SUPPORTED_TOPICS) {
      expect(scopeCheck(`Tell me about my ${t}`).ok).toBe(true);
    }
  });

  it("blocks out-of-scope finance topics", () => {
    expect(scopeCheck("Should I invest in bitcoin?").ok).toBe(false);
    expect(scopeCheck("Help me with my tax returns").ok).toBe(false);
    expect(scopeCheck("Is my credit card good?").ok).toBe(false);
  });
});

describe("buildSystemPrompt guardrails", () => {
  const sample = {
    currency: "MMK",
    transactions: [{ id: "t1", type: "expense", amount: 10000, category: "food" }],
    budgets: [],
    goals: [],
  };

  it("forbids authoritative calculations and invented data", () => {
    const p = buildSystemPrompt(sample);
    expect(p).toMatch(/NEVER perform authoritative financial calculations/i);
    expect(p).toMatch(/never invent|NEVER invent|never fabricate/i);
  });

  it("forbids professional financial advice", () => {
    const p = buildSystemPrompt(sample);
    expect(p).toMatch(/not a licensed financial advisor/i);
  });

  it("states when information is insufficient", () => {
    const p = buildSystemPrompt(sample);
    expect(p).toMatch(/insufficient/i);
  });

  it("embeds the supplied data in the prompt", () => {
    const p = buildSystemPrompt(sample);
    expect(p).toContain("10000");
    expect(p).toContain("MMK");
  });
});

describe("buildFinanceFacts (authoritative computations in the gateway)", () => {
  const sample = {
    currency: "MMK",
    transactions: [
      { id: "t1", type: "expense", amount: 15000, category: "food", date: "2026-08-01T00:00:00.000Z" },
      { id: "t2", type: "income", amount: 500000, category: "allowance", date: "2026-08-01T00:00:00.000Z" },
    ],
    budgets: [{ id: "b1", category: "food", limit: 200000, period: "monthly", rollover: false }],
    goals: [{ id: "g1", title: "Laptop", targetAmount: 1000000, savedAmount: 300000, deadline: "2026-12-31T00:00:00.000Z" }],
  };

  it("computes deterministic totals, budget status and goal progress", () => {
    const f = buildFinanceFacts(sample, new Date("2026-08-15T00:00:00.000Z"));
    expect(f.currency).toBe("MMK");
    expect(f.summary.income).toBe(500000);
    expect(f.summary.expense).toBe(15000);
    expect(f.summary.net).toBe(485000);
    expect(f.summary.expenseByCategory[0]).toMatchObject({ category: "food", total: 15000, count: 1 });
    expect(f.budgetStatus[0]).toMatchObject({ spent: 15000, remaining: 185000, withinLimit: true });
    expect(f.goalStatus[0].pctSaved).toBe(30);
    expect(f.summary.thisMonth.label).toBe("2026-08");
  });

  it("flags an over-spent budget", () => {
    const over = buildFinanceFacts(
      { ...sample, transactions: [{ id: "t1", type: "expense", amount: 250000, category: "food", date: "2026-08-01T00:00:00.000Z" }] },
      new Date("2026-08-15T00:00:00.000Z")
    );
    expect(over.budgetStatus[0].withinLimit).toBe(false);
    expect(over.budgetStatus[0].overBy).toBe(50000);
  });
});

describe("ACTION_RESPONSE_SCHEMA (Gemini structured-output contract)", () => {
  function collectInvalid(node, path, found) {
    if (!node || typeof node !== "object") return found;
    if (Array.isArray(node)) {
      node.forEach((child, i) => collectInvalid(child, `${path}[${i}]`, found));
      return found;
    }
    if (node.type && typeof node.type !== "string") found.push(`${path}.type is not a string`);
    if ("additionalProperties" in node) found.push(`${path}.additionalProperties is present`);
    if (node.properties) {
      for (const [k, v] of Object.entries(node.properties)) collectInvalid(v, `${path}.properties.${k}`, found);
    }
    if (node.items) collectInvalid(node.items, `${path}.items`, found);
    if (node.anyOf) node.anyOf.forEach((child, i) => collectInvalid(child, `${path}.anyOf[${i}]`, found));
    if (node.allOf) node.allOf.forEach((child, i) => collectInvalid(child, `${path}.allOf[${i}]`, found));
    return found;
  }

  it("uses only Gemini-accepted constructs (no array type, no additionalProperties)", () => {
    const schema = ACTION_RESPONSE_SCHEMA;
    expect(schema.type).toBe("object");
    expect(schema.properties.action.type).toBe("object");
    const invalid = [];
    collectInvalid(schema, "$", invalid);
    expect(invalid).toEqual([]);
  });

  it("models payload as an anyOf union so per-action fields get populated", () => {
    const payload = ACTION_RESPONSE_SCHEMA.properties.action.properties.payload;
    expect(Array.isArray(payload.anyOf)).toBe(true);
    expect(payload.anyOf.length).toBeGreaterThanOrEqual(9);
  });

  it("requires txType and amount for create_transaction (the reported bug)", () => {
    const createTxn = ACTION_RESPONSE_SCHEMA.properties.action.properties.payload.anyOf[0];
    expect(createTxn.properties.txType.enum).toEqual(["expense", "income"]);
    expect(createTxn.required).toEqual(expect.arrayContaining(["txType", "amount"]));
  });

  it("requires an id for update/delete branches so Gemini emits a real reference", () => {
    const branches = ACTION_RESPONSE_SCHEMA.properties.action.properties.payload.anyOf;
    for (const branch of branches) {
      if (branch.properties && branch.properties.id) expect(branch.required).toContain("id");
    }
  });
});
