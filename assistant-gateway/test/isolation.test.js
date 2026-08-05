"use strict";

const request = require("supertest");
const { buildTestApp, DATA_BY_UID } = require("./helpers");

/**
 * Cross-user isolation: the gateway must pass ONLY the authenticated caller's
 * own Firestore data to Gemini. We capture the exact system prompt built for
 * each request and assert it contains only that user's records.
 */
describe("Cross-user data isolation", () => {
  it("feeds Gemini only the authenticated user's own data", async () => {
    const captured = [];
    const gemini = {
      async generate(systemPrompt) {
        captured.push(systemPrompt);
        return { text: "ok" };
      },
    };
    const { app } = buildTestApp({ geminiImpl: gemini });

    // user-A asks.
    await request(app)
      .post("/api/assistant")
      .set("Authorization", "Bearer token-userA")
      .send({ question: "What did I spend?" });

    expect(captured).toHaveLength(1);
    // user A's secrets present, user B's secrets ABSENT.
    const promptA = captured[0];
    expect(promptA).toContain("lunch");
    expect(promptA).toContain("allowance");
    expect(promptA).toContain("Laptop");
    expect(promptA).not.toContain("secret-category");
    expect(promptA).not.toContain("user B private");
  });

  it("does not leak user B's data when user B asks", async () => {
    const captured = [];
    const gemini = {
      async generate(systemPrompt) {
        captured.push(systemPrompt);
        return { text: "ok" };
      },
    };
    const { app } = buildTestApp({ geminiImpl: gemini });

    await request(app)
      .post("/api/assistant")
      .set("Authorization", "Bearer token-userB")
      .send({ question: "What did I spend?" });

    expect(captured).toHaveLength(1);
    const promptB = captured[0];
    expect(promptB).toContain("secret-category");
    expect(promptB).toContain("user B private");
    // user A's records must never appear.
    expect(promptB).not.toContain("lunch");
    expect(promptB).not.toContain("Laptop");
  });

  it("uses the verified uid from the token, never a client-supplied uid", async () => {
    // Defender: even if the client tries to pass uid A while holding token B,
    // the gateway must use the uid from the (verified) token, i.e. B.
    const readUids = [];
    const firebase = {
      async verifyIdToken(token) {
        const map = { "token-userA": "user-A", "token-userB": "user-B" };
        if (!map[token]) {
          const err = new Error("invalid");
          err.kind = "auth";
          err.status = 401;
          throw err;
        }
        return { uid: map[token] };
      },
      async readUserFinance(uid) {
        readUids.push(uid);
        return DATA_BY_UID[uid] || {};
      },
    };
    const { app } = buildTestApp({ firebaseImpl: firebase });

    // user B holds token B but claims to ask for user-A in the body.
    await request(app)
      .post("/api/assistant")
      .set("Authorization", "Bearer token-userB")
      .send({ question: "What did I spend?", claimedUid: "user-A" });

    expect(readUids).toEqual(["user-B"]);
  });
});
