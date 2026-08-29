"use strict";

const request = require("supertest");
const { buildTestApp } = require("./helpers");

const AUTH = "Bearer token-userA";

/**
 * A stub "model" that always emits a fixed { reply, action } envelope. This
 * simulates an LLM that understood the user's (differently-worded) request,
 * letting the test focus on the server's deterministic handling: validation,
 * staging, confirmation, execution, and tenant isolation.
 */
function modelReturning(action) {
  return {
    async generate() {
      return { text: JSON.stringify({ reply: "I can do that.", action }) };
    },
  };
}

describe("Assistant data actions (LLM-driven)", () => {
  it("stages a create-transaction from flexible phrasing and only executes after confirmation", async () => {
    const gemini = modelReturning({
      type: "create_transaction",
      payload: { txType: "expense", amount: 5000, category: "food", description: "lunch" },
    });
    const { app } = buildTestApp({ geminiImpl: gemini });

    // NOTE: the wording is irrelevant to the server; the model emits the action.
    const stage = await request(app)
      .post("/api/assistant")
      .set("Authorization", AUTH)
      .send({ question: "I just spent 5000 on lunch today" });

    expect(stage.status).toBe(200);
    expect(stage.body.answer).toContain("I can do that now");
    expect(stage.body.answer).toContain("confirm ");
    expect(stage.body.confirmation.token).toMatch(/^[A-F0-9]{6}$/);

    const tokenMatch = stage.body.answer.match(/confirm\s+([A-F0-9]{6})/i);
    expect(tokenMatch).toBeTruthy();

    const confirm = await request(app)
      .post("/api/assistant")
      .set("Authorization", AUTH)
      .send({ question: `confirm ${tokenMatch[1]}` });

    expect(confirm.status).toBe(200);
    expect(confirm.body.answer).toContain("Done. Logged a 5,000 MMK expense in food");
  });

  it("executes a goal update after confirmation", async () => {
    const gemini = modelReturning({ type: "update_goal", payload: { id: "g1", savedAmount: 450000 } });
    const { app } = buildTestApp({ geminiImpl: gemini });

    const stage = await request(app)
      .post("/api/assistant")
      .set("Authorization", AUTH)
      .send({ question: "top up my laptop goal by 450000" });

    const tokenMatch = stage.body.answer.match(/confirm\s+([A-F0-9]{6})/i);
    expect(tokenMatch).toBeTruthy();

    const confirm = await request(app)
      .post("/api/assistant")
      .set("Authorization", AUTH)
      .send({ question: `confirm ${tokenMatch[1]}` });

    expect(confirm.status).toBe(200);
    expect(confirm.body.answer).toContain("Updated goal g1");
  });

  it("stages an update-transaction and applies only the changed fields", async () => {
    const gemini = modelReturning({ type: "update_transaction", payload: { id: "t1", amount: 18000, category: "food" } });
    const { app } = buildTestApp({ geminiImpl: gemini });

    const stage = await request(app)
      .post("/api/assistant")
      .set("Authorization", AUTH)
      .send({ question: "the lunch was actually 18k, change it" });

    const tokenMatch = stage.body.answer.match(/confirm\s+([A-F0-9]{6})/i);
    expect(tokenMatch).toBeTruthy();

    const confirm = await request(app)
      .post("/api/assistant")
      .set("Authorization", AUTH)
      .send({ question: `confirm ${tokenMatch[1]}` });

    expect(confirm.status).toBe(200);
    expect(confirm.body.answer).toContain("Updated transaction t1");
  });

  it("rejects invalid or expired confirmation token", async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/assistant")
      .set("Authorization", AUTH)
      .send({ question: "confirm ABC123" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_confirmation");
  });

  it("does not allow one user to confirm another user's staged action", async () => {
    const gemini = modelReturning({ type: "create_budget", payload: { category: "food", limit: 120000, rollover: false } });
    const { app } = buildTestApp({ geminiImpl: gemini });

    const stage = await request(app)
      .post("/api/assistant")
      .set("Authorization", "Bearer token-userA")
      .send({ question: "set my food budget to 120k" });

    const tokenMatch = stage.body.answer.match(/confirm\s+([A-F0-9]{6})/i);
    expect(tokenMatch).toBeTruthy();

    const otherUserConfirm = await request(app)
      .post("/api/assistant")
      .set("Authorization", "Bearer token-userB")
      .send({ question: `confirm ${tokenMatch[1]}` });

    expect(otherUserConfirm.status).toBe(400);
    expect(otherUserConfirm.body.error.code).toBe("invalid_confirmation");
  });

  it("does not execute an action the model could not specify clearly", async () => {
    const gemini = modelReturning({ type: "create_budget", payload: { limit: 1000 } }); // missing category
    const { app } = buildTestApp({ geminiImpl: gemini });

    const res = await request(app)
      .post("/api/assistant")
      .set("Authorization", AUTH)
      .send({ question: "add a budget" });

    expect(res.status).toBe(200);
    expect(res.body.answer).toMatch(/couldn't make out|category/i);
    expect(res.body.confirmation).toBeUndefined();
  });

  it("asks which item the user means before updating a missing reference", async () => {
    const gemini = modelReturning({ type: "update_goal", payload: { id: "nope", savedAmount: 1000 } });
    const { app } = buildTestApp({ geminiImpl: gemini });

    const res = await request(app)
      .post("/api/assistant")
      .set("Authorization", AUTH)
      .send({ question: "bump up my savings by 1000" });

    expect(res.status).toBe(200);
    expect(res.body.answer).toMatch(/couldn't find a goal/i);
    expect(res.body.confirmation).toBeUndefined();
  });

  it("answers a plain question without proposing an action", async () => {
    const gemini = modelReturning(null);
    const { app } = buildTestApp({ geminiImpl: gemini });

    const res = await request(app)
      .post("/api/assistant")
      .set("Authorization", AUTH)
      .send({ question: "what did I spend on food?" });

    expect(res.status).toBe(200);
    expect(res.body.answer).toContain("I can do that.");
    expect(res.body.confirmation).toBeUndefined();
  });

  it("always sends the structured output schema to the model", async () => {
    let passedOptions;
    const gemini = {
      async generate(systemPrompt, userPrompt, options) {
        passedOptions = options;
        return { text: JSON.stringify({ reply: "hi", action: null }) };
      },
    };
    const { app } = buildTestApp({ geminiImpl: gemini });
    await request(app)
      .post("/api/assistant")
      .set("Authorization", AUTH)
      .send({ question: "hello" });
    expect(passedOptions.responseSchema).toBeTruthy();
    expect(passedOptions.responseSchema.type).toBe("object");
  });
});
