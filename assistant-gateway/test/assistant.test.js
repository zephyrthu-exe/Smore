"use strict";

const request = require("supertest");
const { buildTestApp } = require("./helpers");

const AUTH = "Bearer token-userA";

describe("Question validation", () => {
  it("rejects a missing question (400)", async () => {
    const { app } = buildTestApp();
    const res = await request(app).post("/api/assistant").set("Authorization", AUTH).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_question");
  });

  it("rejects an empty question (400)", async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/assistant")
      .set("Authorization", AUTH)
      .send({ question: "   " });
    expect(res.status).toBe(400);
  });

  it("rejects a non-string question (400)", async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/assistant")
      .set("Authorization", AUTH)
      .send({ question: 12345 });
    expect(res.status).toBe(400);
  });

  it("rejects an over-long question (400)", async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/assistant")
      .set("Authorization", AUTH)
      .send({ question: "q".repeat(500) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_question");
  });

  it("rejects out-of-scope finance advice questions (422)", async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/assistant")
      .set("Authorization", AUTH)
      .send({ question: "Should I invest in bitcoin and take a loan?" });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("out_of_scope");
  });

  it("rejects malformed JSON body (400 bad_json)", async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/assistant")
      .set("Authorization", AUTH)
      .set("Content-Type", "application/json")
      .send("{ not valid json ");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("bad_json");
  });
});

describe("Gemini failures", () => {
  it("returns a safe fallback when Gemini throws (502)", async () => {
    const gemini = {
      async generate() {
        const err = new Error("upstream down");
        err.kind = "gemini";
        err.status = 502;
        throw err;
      },
    };
    const { app } = buildTestApp({ geminiImpl: gemini });
    const res = await request(app)
      .post("/api/assistant")
      .set("Authorization", AUTH)
      .send({ question: "What did I spend?" });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("assistant_unavailable");
  });

  it("never leaks upstream internals in a Gemini 401/upstream-error response", async () => {
    const gemini = {
      async generate() {
        const err = new Error("Gemini upstream error (HTTP 500). secrets inside");
        err.kind = "gemini";
        err.status = 502;
        throw err;
      },
    };
    const { app } = buildTestApp({ geminiImpl: gemini });
    const res = await request(app)
      .post("/api/assistant")
      .set("Authorization", AUTH)
      .send({ question: "What did I spend?" });
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("secrets inside");
    expect(body).not.toContain("AIza");
  });
});

describe("Safe degradation when Gemini is not configured", () => {
  it("returns a helpful 200 fallback instead of crashing", async () => {
    const { loadConfig } = require("../src/config");
    const config = {};
    const base = loadConfig();
    Object.assign(base, {
      port: 0,
      rateLimitWindowMs: 60000,
      rateLimitMaxPerIp: 5,
      geminiApiKey: "PASTE_YOUR_GEMINI_API_KEY_HERE", // placeholder
    });
    const firebase = {
      async verifyIdToken(t) {
        if (t === "tok-a") return { uid: "user-A" };
        const e = new Error("nope");
        e.kind = "auth";
        e.status = 401;
        throw e;
      },
      async readUserFinance() {
        return { currency: "MMK", transactions: [], budgets: [], goals: [] };
      },
    };
    // No gemini stub passed → app still must not crash on placeholder key.
    const { createApp } = require("../src/app");
    const { app } = createApp({
      config: base,
      firebase,
      gemini: { async generate() { throw new Error("should not be called"); } },
    });
    const res = await request(app)
      .post("/api/assistant")
      .set("Authorization", "Bearer tok-a")
      .send({ question: "hello" });
    expect(res.status).toBe(200);
    expect(res.body.answer).toContain("not configured");
  });
});
