"use strict";

/**
 * Lightweight Vercel function so you can verify the gateway is deployed without
 * going through the browser: open https://<your-app>.vercel.app/health
 */
function isGeminiKeyPlaceholder(apiKey) {
  const value = String(apiKey || "").trim();
  return !value || /pa(i?)ste/i.test(value) || /^SKIP/i.test(value) || ["your-api-key", "test", "dummy"].includes(value);
}

// Keep health completely dependency-free: it must still work when the nested
// gateway package cannot be loaded by the platform.
module.exports = (_req, res) => {
  const creds = (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim();
  res.status(200).json({
    status: "ok",
    service: "smore-assistant-gateway",
    time: new Date().toISOString(),
    geminiConfigured: !isGeminiKeyPlaceholder(process.env.GEMINI_API_KEY),
    firebaseAdminConfigured: creds.length > 0,
  });
};
