"use strict";

const request = require("supertest");
const { buildTestApp, testConfig } = require("./helpers");
const { isLoopbackHost, parseOriginHostname } = require("../src/config");

describe("CORS origin policy", () => {
  describe("isLoopbackHost", () => {
    it("recognises localhost / 127.0.0.1 on any port", () => {
      expect(isLoopbackHost("http://localhost:5500")).toBe(true);
      expect(isLoopbackHost("http://127.0.0.1:3000")).toBe(true);
      expect(isLoopbackHost("http://[::1]:8080")).toBe(true);
    });

    it("rejects real remote origins", () => {
      expect(isLoopbackHost("https://smore.example.com")).toBe(false);
      expect(isLoopbackHost("http://192.168.1.10:5500")).toBe(false);
      expect(isLoopbackHost("not-a-url")).toBe(false);
    });
  });

  describe("preflight behaviour over the gateway", () => {
    const preflight = (origin) =>
      request(app)
        .options("/api/assistant")
        .set("Origin", origin)
        .set("Access-Control-Request-Method", "POST")
        .set("Access-Control-Request-Headers", "authorization, content-type");

    let app;
    beforeAll(() => {
      ({ app } = buildTestApp());
    });

    it("allows an origin in the explicit allow-list", async () => {
      const res = await preflight("http://localhost:5500");
      expect(res.status).toBeLessThan(400);
      expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5500");
      expect(res.headers["access-control-allow-headers"]).toMatch(/authorization/i);
    });

    it("allows a loopback origin not in the allow-list (any local port, dev)", async () => {
      const res = await preflight("http://127.0.0.1:5500");
      expect(res.status).toBeLessThan(400);
      expect(res.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:5500");
    });

    it("blocks a real remote origin so another site cannot drive the gateway", async () => {
      const res = await preflight("https://evil.example.com");
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });
  });
});

describe("CORS stays strict in production", () => {
  let app;
  beforeAll(() => {
    ({ app } = buildTestApp({ config: testConfig({ env: "production" }) }));
  });

  it("rejects a loopback origin in production", async () => {
    const res = await request(app)
      .options("/api/assistant")
      .set("Origin", "http://127.0.0.1:5500")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "authorization, content-type");
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
