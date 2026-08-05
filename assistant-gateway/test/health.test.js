"use strict";

const request = require("supertest");
const { buildTestApp } = require("./helpers");

describe("Health check", () => {
  it("returns 200 with status ok without any auth", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.service).toContain("smore-assistant-gateway");
    expect(typeof res.body.geminiConfigured).toBe("boolean");
    // Never leak whether a key exists beyond the boolean.
    expect(res.body).not.toHaveProperty("geminiApiKey");
  });

  it("does not leak the configured Gemini key value", async () => {
    const { app } = buildTestApp();
    const text = await request(app).get("/health").then((r) => JSON.stringify(r.body));
    expect(text).not.toMatch(/AIza|sk-/);
  });
});
