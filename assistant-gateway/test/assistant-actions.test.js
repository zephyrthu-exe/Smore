"use strict";

const request = require("supertest");
const { buildTestApp } = require("./helpers");

const AUTH = "Bearer token-userA";

describe("Assistant action commands", () => {
  it("stages a transaction creation and executes it only after confirmation", async () => {
    const { app } = buildTestApp();

    const stage = await request(app)
      .post("/api/assistant")
      .set("Authorization", AUTH)
      .send({ question: "Add expense 5000 for lunch in category Food" });

    expect(stage.status).toBe(200);
    expect(stage.body.answer).toContain("I can do that now");
    expect(stage.body.answer).toContain("confirm ");

    const tokenMatch = stage.body.answer.match(/confirm\s+([A-F0-9]{6})/i);
    expect(tokenMatch).toBeTruthy();

    const confirm = await request(app)
      .post("/api/assistant")
      .set("Authorization", AUTH)
      .send({ question: `confirm ${tokenMatch[1]}` });

    expect(confirm.status).toBe(200);
    expect(confirm.body.answer).toContain("Done. Created expense transaction");
  });

  it("executes goal update command with confirmation", async () => {
    const { app } = buildTestApp();

    const stage = await request(app)
      .post("/api/assistant")
      .set("Authorization", AUTH)
      .send({ question: "Update goal g1 saved to 450000" });

    const tokenMatch = stage.body.answer.match(/confirm\s+([A-F0-9]{6})/i);
    expect(tokenMatch).toBeTruthy();

    const confirm = await request(app)
      .post("/api/assistant")
      .set("Authorization", AUTH)
      .send({ question: `confirm ${tokenMatch[1]}` });

    expect(confirm.status).toBe(200);
    expect(confirm.body.answer).toContain("Updated goal g1 saved amount to 450000 MMK");
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
    const { app } = buildTestApp();

    const stage = await request(app)
      .post("/api/assistant")
      .set("Authorization", "Bearer token-userA")
      .send({ question: "Create budget Food 120000" });

    const tokenMatch = stage.body.answer.match(/confirm\s+([A-F0-9]{6})/i);
    expect(tokenMatch).toBeTruthy();

    const otherUserConfirm = await request(app)
      .post("/api/assistant")
      .set("Authorization", "Bearer token-userB")
      .send({ question: `confirm ${tokenMatch[1]}` });

    expect(otherUserConfirm.status).toBe(400);
    expect(otherUserConfirm.body.error.code).toBe("invalid_confirmation");
  });
});
