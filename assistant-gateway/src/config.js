"use strict";

/**
 * Configuration loader.
 *
 * Reads all runtime settings from environment variables (via dotenv when a
 * local `.env` file exists). Centralizing this in one module makes the rest of
 * the gateway testable: tests can override `process.env` before loading config.
 *
 * SECURITY NOTE (read carefully):
 *  - `GEMINI_API_KEY` is read from the environment ONLY. It is never printed,
 *    never committed, and never sent anywhere except to the Gemini API.
 *  - The service-account file is loaded from `GOOGLE_APPLICATION_CREDENTIALS`
 *    on the VPS. The file itself must live OUTSIDE the repo.
 */

const dotenv = require("dotenv");

// Load `.env` if present (local development). On the real VPS you export the
// variables in the systemd/forever/shell environment instead. dotenv silently
// skips when there is no `.env` file.
dotenv.config();

const DEFAULT_ALLOWED_ORIGINS = "http://localhost:5500";

function parseAllowedOrigins(raw) {
  const value = (raw || DEFAULT_ALLOWED_ORIGINS).trim();
  if (!value) {
    return [DEFAULT_ALLOWED_ORIGINS];
  }
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Parses the hostname out of an Origin header value (or "" if invalid). */
function parseOriginHostname(origin) {
  try {
    // Node's URL returns IPv6 hosts bracketed (e.g. "[::1]"); strip them so the
    // loopback check compares against the raw bare address.
    return new URL(origin).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return "";
  }
}

/**
 * True when an Origin header points at a local loopback address
 * (localhost / 127.0.0.1 / ::1) regardless of port. Used to let local dev
 * static servers (Live Server, Vite, etc.) talk to the gateway from any port
 * without hand-editing ALLOWED_ORIGINS, while still rejecting every real
 * remote origin not in the allow-list. Browsers set `Origin` yourself — this
 * only ever reflects the page's real address, so a remote attacker can't spoof a
 * loopback Origin to bypass the allow-list.
 */
function isLoopbackHost(origin) {
  const host = parseOriginHostname(origin);
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

/**
 * Returns the runtime configuration object. Reads from process.env each call
 * so tests that mutate env between cases get the fresh value.
 */
function loadConfig() {
  const env = process.env;

  const config = {
    env: env.NODE_ENV || "development",
    port: parseInt(env.PORT || "8080", 10),

    // CORS
    allowedOrigins: parseAllowedOrigins(env.ALLOWED_ORIGINS),

    // Firebase Admin
    googleApplicationCredentials: env.GOOGLE_APPLICATION_CREDENTIALS || null,
    firebaseProjectId: env.FIREBASE_PROJECT_ID || "smore-6464b",

    // Gemini
    geminiApiKey: env.GEMINI_API_KEY || "",
    geminiModel: env.GEMINI_MODEL || "gemini-2.5-flash",
    geminiMaxOutputTokens: parseInt(env.GEMINI_MAX_OUTPUT_TOKENS || "800", 10),

    // Rate limiting
    rateLimitWindowMs: parseInt(env.RATE_LIMIT_WINDOW_MS || String(15 * 60 * 1000), 10),
    rateLimitMaxPerIp: parseInt(env.RATE_LIMIT_MAX_PER_IP || "30", 10),
  };

  return config;
}

/**
 * True when a Gemini API key has NOT been configured (missing or still a
 * placeholder). The gateway still boots so health checks and auth tests work,
 * but `/api/assistant` degrades to a safe "configured later" fallback instead
 * of crashing.
 */
function isGeminiKeyPlaceholder(apiKey) {
  if (!apiKey) return true;
  const trimmed = apiKey.trim();
  return (
    trimmed.length === 0 ||
    /pa(i?)ste/i.test(trimmed) ||          // "PASTE_YOUR_GEMINI_API_KEY_HERE"
    /^SKIP/i.test(trimmed) ||              // "SKIP" common in tests
    trimmed === "your-api-key" ||
    trimmed === "test" ||
    trimmed === "dummy"
  );
}

module.exports = { loadConfig, isGeminiKeyPlaceholder, parseAllowedOrigins, isLoopbackHost };
