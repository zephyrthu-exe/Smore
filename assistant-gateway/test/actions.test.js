"use strict";

const {
  sanitizeAction,
  describeAction,
  parseConfirmation,
  PendingActionStore,
  findMissingReference,
} = require("../src/actions");

describe("sanitizeAction", () => {
  it("accepts and normalises a valid create_transaction", () => {
    const r = sanitizeAction({
      type: "create_transaction",
      payload: { txType: "expense", amount: 5000.4, category: "food", description: "lunch" },
    });
    expect(r.ok).toBe(true);
    expect(r.action.payload.amount).toBe(5000); // rounded
    expect(r.action.payload.category).toBe("food");
  });

  it("rejects an unsupported action type", () => {
    const r = sanitizeAction({ type: "drop_table", payload: {} });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Unsupported/);
  });

  it("rejects a budget with no category", () => {
    const r = sanitizeAction({ type: "create_budget", payload: { limit: 1000 } });
    expect(r.ok).toBe(false);
  });

  it("rejects a negative amount", () => {
    const r = sanitizeAction({ type: "create_transaction", payload: { txType: "expense", amount: -5, category: "x", description: "y" } });
    expect(r.ok).toBe(false);
  });

  it("requires an id for update/delete", () => {
    expect(sanitizeAction({ type: "delete_transaction", payload: {} }).ok).toBe(false);
    expect(sanitizeAction({ type: "update_goal", payload: { savedAmount: 5 } }).ok).toBe(false);
  });

  it("requires at least one field for an update", () => {
    expect(sanitizeAction({ type: "update_transaction", payload: { id: "t1" } }).ok).toBe(false);
  });
});

describe("describeAction", () => {
  it("describes a create action clearly", () => {
    const d = describeAction({ type: "create_budget", payload: { category: "food", limit: 100000, rollover: true } });
    expect(d).toContain("food");
    expect(d).toContain("100,000");
    expect(d).toContain("rollover");
  });

  it("describes a delete action by id", () => {
    expect(describeAction({ type: "delete_goal", payload: { id: "g1" } })).toContain("g1");
  });
});

describe("parseConfirmation", () => {
  it("matches an uppercase 6-hex token", () => {
    expect(parseConfirmation("confirm 3f8A2c")).toEqual({ kind: "confirm", token: "3F8A2C" });
  });
  it("returns none for ordinary chat", () => {
    expect(parseConfirmation("please do it").kind).toBe("none");
  });
});

describe("PendingActionStore", () => {
  it("consumes a token once and only for the owning uid", () => {
    const store = new PendingActionStore();
    const token = store.create("user-A", { type: "delete_budget", payload: { id: "b1" } });
    expect(token).toMatch(/^[A-F0-9]{6}$/);

    expect(store.consume("user-B", token)).toBeNull();
    const action = store.consume("user-A", token);
    expect(action.payload.id).toBe("b1");
    // Second consume is a no-op (expired/consumed).
    expect(store.consume("user-A", token)).toBeNull();
  });
});

describe("findMissingReference", () => {
  const finance = {
    transactions: [{ id: "t1" }],
    budgets: [{ id: "b1" }],
    goals: [{ id: "g1" }],
  };

  it("returns null when the referenced id exists in the caller's own data", () => {
    expect(findMissingReference({ type: "delete_goal", payload: { id: "g1" } }, finance)).toBeNull();
    expect(findMissingReference({ type: "update_transaction", payload: { id: "t1" } }, finance)).toBeNull();
  });

  it("reports a missing id so the bot asks instead of writing", () => {
    expect(findMissingReference({ type: "delete_budget", payload: { id: "nope" } }, finance)).toEqual({
      kind: "budget",
      id: "nope",
    });
  });

  it("ignores create actions and missing payload ids", () => {
    expect(findMissingReference({ type: "create_goal", payload: { title: "x" } }, finance)).toBeNull();
    expect(findMissingReference({ type: "update_goal", payload: {} }, finance)).toBeNull();
  });
});
