"use strict";

const request = require("supertest");
const { buildTestApp, testConfig } = require("./helpers");

describe("Rate limiting", () => {
  it("returns 429 after the per-IP limit is exceeded", async () => {
    // Build with a very low limit so the test is quick.
    const config = testConfig({ rateLimitWindowMs: 60000, rateLimitMaxPerIp: 3 });
    const { app } = buildTestApp({ config });

    const AUTH = "Bearer token-userA";

    // First 3 allowed, then 429.
    const statuses = [];
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post("/api/assistant")
        .set("Authorization", AUTH)
        .send({ question: `question ${i}` });
      statuses.push(res.status);
    }

    expect(statuses.slice(0, 2)).toEqual([200, 200]);
    // The 4th (index 3) and on are rate limited.
    expect(statuses.slice(3)).toEqual([429, 429]);
    expect(statuses).not.toContain(500);
  });

  it("rate-limit response uses a safe code and message", async () => {
    const config = testConfig({ rateLimitWindowMs: 60000, rateLimitMaxPerIp: 1 });
    const { app } = buildTestApp({ config });
    const AUTH = "Bearer token-userA";

    await request(app).post("/api/assistant").set("Authorization", AUTH).send({ question: "one" });
    const flagged = await request(app)
      .post("/api/assistant")
      .set("Authorization", AUTH)
      .send({ question: "two" });

    expect(flagged.status).toBe(429);
    expect(flagged.body.error.code).toBe("rate_limited");
  });
});
