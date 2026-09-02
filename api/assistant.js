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

let app;
let startupError;

function getApp() {
  if (app || startupError) return app;
  try {
    // Keep all gateway imports inside the handler initialization. This lets
    // Vercel load the function and return a useful diagnostic if a nested
    // dependency or runtime configuration is unavailable.
    const { createApp } = require("../assistant-gateway/src/app");
    const { createFirebaseGateway } = require("../assistant-gateway/src/firebase");
    const { FirestorePendingActionStore } = require("../assistant-gateway/src/actions");

    if (!process.env.ALLOWED_ORIGINS && process.env.VERCEL_URL) {
      process.env.ALLOWED_ORIGINS = `https://${process.env.VERCEL_URL}`;
    }

    const firebaseGateway = createFirebaseGateway();
    const pendingActions = new FirestorePendingActionStore(firebaseGateway);
    ({ app } = createApp({ firebase: firebaseGateway, pendingActions }));
    return app;
  } catch (error) {
    startupError = error;
    return null;
  }
}

module.exports = (req, res) => {
  const gateway = getApp();
  if (!gateway) {
    console.error("[gateway] startup failed:", startupError?.message || "unknown error");
    return res.status(503).json({
      error: {
        code: "gateway_startup_failed",
        message: "The assistant gateway is not configured correctly on the server.",
      },
    });
  }
  return gateway(req, res);
};
