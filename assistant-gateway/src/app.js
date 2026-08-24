"use strict";

/**
 * Application factory for the Smore Assistant gateway.
 *
 * `createApp` returns a configured Express app. Every external dependency
 * (Firebase Admin, Gemini transport) is injectable so the test suite can verify
 * the security guarantees without real credentials or network access.
 */

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");

const { loadConfig, isGeminiKeyPlaceholder } = require("./config");
const { buildSystemPrompt, validateQuestion, scopeCheck } = require("./guardrails");
const { createFirebaseGateway } = require("./firebase");
const { createGeminiClient } = require("./gemini");
const { PendingActionStore, parseActionRequest, executeAction, describeAction } = require("./actions");

/**
 * @param {object} deps  Overrides for tests / non-default wiring.
 * @param {object} [deps.firebase]  e.g. a stub with { verifyIdToken, readUserFinance }.
 * @param {object} [deps.gemini]    e.g. a stub with { generate }.
 * @param {object} [deps.config]    pre-built config (defaults to loadConfig()).
 */
function createApp({ firebase, gemini, config: cfg } = {}) {
  const config = cfg || loadConfig();
  const pendingActions = new PendingActionStore();

  // Ensure at least the real (or injected) implementations are present. If the
  // caller supplied stubs, they win — otherwise build the real ones lazily.
  const fb = firebase || createFirebaseGateway();
  const gem = gemini || createGeminiClient({ apiKey: config.geminiApiKey, model: config.geminiModel, maxOutputTokens: config.geminiMaxOutputTokens });

  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());

  // ---- CORS: allow-list only ----------------------------------------------
  app.use(
    cors({
      origin(origin, cb) {
        // No-origin requests (curl, server-to-server / health checks) are fine.
        if (!origin) return cb(null, true);
        if (config.allowedOrigins.includes(origin)) return cb(null, true);
        return cb(new Error(`Origin "${origin}" is not allowed by the gateway.`));
      },
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  );

  app.use(express.json({ limit: "16kb" }));

  // ---- Rate limit: per-IP, hit before any auth or Gemini work --------------
  const limiter = rateLimit({
    windowMs: config.rateLimitWindowMs,
    limit: config.rateLimitMaxPerIp,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
      error: {
        code: "rate_limited",
        message: "Too many requests. Please slow down and try again shortly.",
      },
    },
  });
  app.use("/api/assistant", limiter);

  // -------------------------------------------------------------------------
  // Health check (no auth required) — lets an operator confirm the gateway is
  // up and safely reports whether Gemini is configured WITHOUT leaking the key.
  // -------------------------------------------------------------------------
  app.get("/health", (_req, res) => {
    const geminiConfigured = !isGeminiKeyPlaceholder(config.geminiApiKey);
    res.status(200).json({
      status: "ok",
      service: "smore-assistant-gateway",
      time: new Date().toISOString(),
      geminiConfigured,
    });
  });

  // -------------------------------------------------------------------------
  // Assistant endpoint
  // -------------------------------------------------------------------------
  app.post("/api/assistant", async (req, res) => {
    try {
      // 1) Authenticate the Firebase ID token.
      const authHeader = req.headers.authorization || "";
      const idToken = parseBearer(authHeader);
      const decoded = await fb.verifyIdToken(idToken);

      // 2) Validate the question input.
      const qv = validateQuestion(req.body && req.body.question);
      if (!qv.ok) {
        return res.status(qv.status).json({ error: { code: qv.code, message: qv.message } });
      }

      // 2.5) Parse direct data-management actions from plain chat text.
      const parsedAction = parseActionRequest(qv.question);
      if (parsedAction.kind === "confirm") {
        const action = pendingActions.consume(decoded.uid, parsedAction.token);
        if (!action) {
          return res.status(400).json({
            error: {
              code: "invalid_confirmation",
              message: "That confirmation code is invalid or expired. Ask again and confirm with the latest code.",
            },
          });
        }
        const result = await executeAction(action, decoded.uid, fb);
        return res.status(200).json({
          answer: `${result.message} I can also summarize your updated spending, budgets, and goals if you want.`,
          user: { uid: decoded.uid },
        });
      }

      if (parsedAction.kind === "action") {
        const token = pendingActions.create(decoded.uid, parsedAction.action);
        return res.status(200).json({
          answer: [
            `I can do that now: ${describeAction(parsedAction.action)}`,
            `To prevent accidental edits, reply exactly: confirm ${token}`,
            "You can ask me anything else instead and this draft action will expire automatically.",
          ].join(" "),
          user: { uid: decoded.uid },
        });
      }

      const scope = scopeCheck(qv.question);
      if (!scope.ok) {
        return res.status(scope.status).json({ error: { code: scope.code, message: scope.message } });
      }

      // 3) Read the caller's OWN data from Firestore (tenant isolated by uid).
      const finance = await fb.readUserFinance(decoded.uid);

      // 4) If Gemini is not configured, degrade safely instead of crashing.
      if (isGeminiKeyPlaceholder(config.geminiApiKey)) {
        return res.status(200).json({
          answer:
            "Smore Assistant is available but Gemini is not configured on this server yet. The owner should set the GEMINI_API_KEY environment variable. I can tell you about your spending, transactions, budgets, and savings once it is enabled.",
          user: { uid: decoded.uid },
        });
      }

      // 5) Send to Gemini with the guardrail system prompt.
      const systemPrompt = buildSystemPrompt(finance);
      const { text } = await gem.generate(systemPrompt, qv.question);

      // 6) Respond (never echo raw user data beyond the answer; include uid only).
      res.status(200).json({ answer: text, user: { uid: decoded.uid } });
    } catch (err) {
      handleError(err, res);
    }
  });

  // 404 for anything unknown.
  app.use((_req, res) => {
    res.status(404).json({ error: { code: "not_found", message: "Route not found." } });
  });

  // ---- Centralised error handling ------------------------------------------
  // Catches body-parser errors (malformed JSON), CORS callback errors, and any
  // exception thrown by the route logic that wasn't already answered.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    return handleError(err, res);
  });

  return { app, config };
}

function parseBearer(header) {
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1] : null;
}

function handleError(err, res) {
  // Normalise errors thrown by our modules that carry kind/status.
  const kind = err && err.kind;
  const status = err && err.status;

  if (kind === "auth") {
    return res.status(status || 401).json({
      error: { code: "unauthorized", message: err.message || "Authentication failed." },
    });
  }

  if (kind === "gemini") {
    return res.status(status || 502).json({
      error: {
        code: "assistant_unavailable",
        message:
          "The assistant is temporarily unavailable. Please check your connection and try again.",
      },
    });
  }

  if (kind === "action") {
    return res.status(status || 400).json({
      error: {
        code: err.code || "invalid_action",
        message: err.message || "The requested action could not be completed.",
      },
    });
  }

  // CORS errors thrown by the origin callback.
  if (err.message && /Origin .* is not allowed/.test(err.message)) {
    return res.status(403).json({ error: { code: "forbidden_origin", message: err.message } });
  }

  // Malformed JSON body etc.
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: { code: "bad_json", message: "Request body is not valid JSON." } });
  }

  console.error("[gateway] Unhandled error:", err);
  return res.status(500).json({
    error: { code: "internal", message: "Something went wrong on the server. Please try again." },
  });
}

module.exports = { createApp };
