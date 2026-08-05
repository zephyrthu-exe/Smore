"use strict";

/**
 * Minimal Gemini REST client.
 *
 * Uses native fetch (Node 18+) to call the Google Generative Language API, so
 * no extra SDK is required and the request/response shape is under our control.
 * The API key is injected per-call by the caller (from config) so tests can
 * pass a fake transport. No Cloud Functions, no extra provider.
 */

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Build a callable that posts a single text prompt to a given model and returns
 * the response text.
 *
 * @param {object} opts
 * @param {string} opts.apiKey  Gemini API key (ideally from env).
 * @param {string} [opts.model] Model name, e.g. "gemini-2.5-flash".
 * @param {number} [opts.maxOutputTokens] Generation cap.
 * @param {Function} [opts.transport] Inject for tests (defaults to global fetch).
 * @returns {Promise<{ text: string }>}
 */
function createGeminiClient({ apiKey, model = "gemini-2.5-flash", maxOutputTokens = 800, transport } = {}) {
  const doFetch = transport || ((url, init) => fetch(url, init));

  async function generate(systemPrompt, userPrompt) {
    const url = `${GEMINI_BASE_URL}/models/${encodeURIComponent(model)}:generateContent`;
    const body = {
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: userPrompt }],
        },
      ],
      generationConfig: {
        maxOutputTokens,
        temperature: 0.2, // low temperature → deterministic, factual-leaning output
      },
    };

    const res = await doFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
    });

    if (res.status === 401 || res.status === 403) {
      const err = new Error("Gemini authentication failed. Check GEMINI_API_KEY.");
      err.kind = "gemini";
      err.status = 502;
      err.upstreamStatus = res.status;
      throw err;
    }

    if (!res.ok) {
      const err = new Error(`Gemini upstream error (HTTP ${res.status}).`);
      err.kind = "gemini";
      err.status = 502;
      err.upstreamStatus = res.status;
      throw err;
    }

    const data = await res.json();

    // Response shape: candidates[].content.parts[].text
    const text = pickResponseText(data);
    if (text == null) {
      const err = new Error("Gemini returned no usable text.");
      err.kind = "gemini";
      err.status = 502;
      throw err;
    }
    return { text };
  }

  return { generate };
}

function pickResponseText(data) {
  const candidates = data && data.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const parts = candidates[0] && candidates[0].content && candidates[0].content.parts;
  if (!Array.isArray(parts) || parts.length === 0) return null;
  const text = parts.map((p) => (p && typeof p.text === "string" ? p.text : "")).join("");
  return text.trim().length > 0 ? text : null;
}

module.exports = { createGeminiClient, GEMINI_BASE_URL, pickResponseText };
