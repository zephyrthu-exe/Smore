"use strict";

/**
 * Lightweight Vercel function so you can verify the gateway is deployed without
 * going through the browser: open https://<your-app>.vercel.app/health
 */
const { loadConfig, isGeminiKeyPlaceholder } = require("../assistant-gateway/src/config");

module.exports = (_req, res) => {
  const config = loadConfig();
  res.status(200).json({
    status: "ok",
    service: "smore-assistant-gateway",
    time: new Date().toISOString(),
    geminiConfigured: !isGeminiKeyPlaceholder(config.geminiApiKey),
  });
};
