"use strict";

/**
 * Vercel Functions entry point for the Smore Assistant gateway.
 *
 * The frontend lives on the SAME Vercel deployment, so it POSTs to the
 * same-origin path `/api/assistant`, which Vercel maps to this file. (In
 * production the frontend already falls back to same-origin `/api/assistant`
 * when PROD_GATEWAY_URL is empty — see src/js/sombo-assistant.js.)
 *
 * Vercel Functions are ephemeral and stateless, so the pending-action
 * (confirmation-token) store is backed by Firestore to survive the two-request
 * confirm/execute flow.
 *
 * Expected env vars (set in the Vercel dashboard, NEVER committed):
 *   GOOGLE_APPLICATION_CREDENTIALS_JSON  full service-account JSON string
 *   FIREBASE_PROJECT_ID                  (defaults to smore-6464b)
 *   GEMINI_API_KEY
 *   GEMINI_MODEL                         (optional, defaults to gemini-2.5-flash)
 *   GEMINI_MAX_OUTPUT_TOKENS             (optional)
 *   ALLOWED_ORIGINS                      exact Vercel origin, e.g. https://my-app.vercel.app
 *   NODE_ENV                             production
 */

const { createApp } = require("../assistant-gateway/src/app");
const { createFirebaseGateway } = require("../assistant-gateway/src/firebase");
const { FirestorePendingActionStore } = require("../assistant-gateway/src/actions");

// The gateway's CORS allow-list must contain the exact origin the page is served
// from. On the default `*.vercel.app` domain Vercel exposes VERCEL_URL, so we
// default to it when ALLOWED_ORIGINS was not configured. If you use a custom
// domain, set ALLOWED_ORIGINS explicitly to that origin in the dashboard.
if (!process.env.ALLOWED_ORIGINS && process.env.VERCEL_URL) {
  process.env.ALLOWED_ORIGINS = `https://${process.env.VERCEL_URL}`;
}

// Module-level singletons are reused across warm invocations, so the Firebase
// Admin app, the config, and the Express app are built once per lambda instance.
const firebaseGateway = createFirebaseGateway();
const pendingActions = new FirestorePendingActionStore(firebaseGateway);
const { app } = createApp({ firebase: firebaseGateway, pendingActions });

// An Express app is a plain Node (req, res) handler, which is exactly the shape
// a Vercel Node Function expects.
module.exports = (req, res) => app(req, res);
