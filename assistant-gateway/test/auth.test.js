"use strict";

const request = require("supertest");
const { buildTestApp } = require("./helpers");

describe("Authentication", () => {
  it("rejects a request with no Authorization header (401)", async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/assistant")
      .send({ question: "How much did I spend on food?" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("unauthorized");
  });

  it("rejects an empty Bearer token (401)", async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/assistant")
      .set("Authorization", "Bearer   ")
      .send({ question: "How much did I spend?" });
    expect(res.status).toBe(401);
  });

  it("rejects a non-Bearer Authorization header (401)", async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/assistant")
      .set("Authorization", "Basic abc123")
      .send({ question: "How much did I spend?" });
    expect(res.status).toBe(401);
  });

  it("rejects a fabricated/unknown ID token (401)", async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/assistant")
      .set("Authorization", "Bearer token-forged-by-attacker")
      .send({ question: "How much did I spend?" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("unauthorized");
  });

  it("rejects a token whose signature verification fails upstream (401)", async () => {
    // Simulate firebase-admin throwing on verifyIdToken.
    const firebase = {
      async verifyIdToken() {
        const err = new Error("boom expired");
        err.kind = "auth";
        err.status = 401;
        throw err;
      },
      async readUserFinance() {
        throw new Error("should not be reached");
      },
    };
    const { app } = buildTestApp({ firebaseImpl: firebase });
    const res = await request(app)
      .post("/api/assistant")
      .set("Authorization", "Bearer some-real-looking-token")
      .send({ question: "anything" });
    expect(res.status).toBe(401);
  });

  it("accepts a valid token and returns an answer (200)", async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/assistant")
      .set("Authorization", "Bearer token-userA")
      .send({ question: "How much did I spend on food?" });
    expect(res.status).toBe(200);
    expect(typeof res.body.answer).toBe("string");
    expect(res.body.user.uid).toBe("user-A");
  });
});
