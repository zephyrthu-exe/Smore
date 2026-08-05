"use strict";

const {
  validateQuestion,
  scopeCheck,
  buildSystemPrompt,
  SUPPORTED_TOPICS,
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
