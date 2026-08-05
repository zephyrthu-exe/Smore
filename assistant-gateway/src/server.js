"use strict";

/**
 * Smore Assistant Gateway — entry point.
 *
 * Starts an Express server on the Harmy VPS. Reads configuration from the
 * environment (see .env.example). No Firebase Cloud Functions, no Secret
 * Manager — secrets are ordinary VPS environment variables.
 *
 * Run:  node src/server.js   (or npm start, npm run dev)
 */

const { createApp } = require("./app");
const { loadConfig } = require("./config");

const config = loadConfig();
const { app } = createApp({ config });

app.listen(config.port, () => {
  console.log(`[gateway] Smore Assistant Gateway listening on port ${config.port} (${config.env})`);
  console.log(`[gateway] Gemini configured: ${config.geminiApiKey ? "yes" : "no"}`);
});
