"use strict";

/**
 * Guardrails for the Smore Assistant.
 *
 * All the rules from the project brief live here so they are enforced in one
 * place and vet-earnable:
 *   - Gemini never performs authoritative financial calculations.
 *   - The assistant must not invent data that is not present.
 *   - No professional financial advice.
 *   - No private user data is revealed to anyone.
 *   - The assistant states clearly when information is insufficient.
 *
 * Two layers:
 *   a) INPUT guardrails: validate the client's question (shape, length, scope).
 *   b) OUTPUT/system-prompt guardrails: instruct the model and constrain its
 *      role so responses honour the rules above.
 */

// Allowed question topics. Used to fail-fast on obviously out-of-scope input
// and to keep the model focused on the four supported areas.
const SUPPORTED_TOPICS = ["spending", "transactions", "budgets", "goals"];

const MAX_QUESTION_LENGTH = 400;

/**
 * Validate a raw question string from the client.
 * Returns { ok: true } OR { ok: false, status, code, message }.
 */
function validateQuestion(raw) {
  if (raw == null) {
    return fail(400, "invalid_question", "A question is required.");
  }
  if (typeof raw !== "string") {
    return fail(400, "invalid_question", "The question must be text.");
  }
  const q = raw.trim();
  if (q.length === 0) {
    return fail(400, "invalid_question", "The question cannot be empty.");
  }
  if (q.length > MAX_QUESTION_LENGTH) {
    return fail(
      400,
      "invalid_question",
      `Question is too long. Please keep it under ${MAX_QUESTION_LENGTH} characters.`
    );
  }
  return { ok: true, question: q };
}

/**
 * Light topic check. If a question clearly mentions an unsupported subject,
 * reject it early (cheap) before spending a Gemini call. Non-obvious questions
 * are allowed through; the system prompt keeps the model on-topic.
 */
const OUT_OF_SCOPE_MARKERS = [
  /invest(?:ment|ing)?\b/i,
  /crypto/,
  /bitcoin/,
  /stock market/,
  /loan application/,
  /credit (?:score|card)\b/i,
  /tax (?:advice|filing|return)/i,
  /mortgage/i,
];

function scopeCheck(question) {
  for (const marker of OUT_OF_SCOPE_MARKERS) {
    if (marker.test(question)) {
      return {
        ok: false,
        status: 422,
        code: "out_of_scope",
        message:
          "Smore Assistant can only help with spending, transactions, budgets, and savings goals. It cannot give investment, tax, or lending advice.",
      };
    }
  }
  return { ok: true };
}

function fail(status, code, message) {
  return { ok: false, status, code, message };
}

/**
 * Build the full system instruction string the model should follow.
 * `financeSummary` is the (already validated) snapshot of the user's data.
 */
function buildSystemPrompt(financeSummary) {
  return [
    "You are Smore Assistant, the in-app helper for Smore (Save More), a personal finance tracker for students.",
    "",
    "You will be given a snapshot of the user's own financial data (transactions, budgets, savings goals), all amounts in MMK.",
    "",
    "HARD RULES (never violate these):",
    "1. You only describe and interpret the provided data. You NEVER perform authoritative financial calculations. If a number must be computed exactly (totals, averages, remaining budget), point out that Smore's dashboard computes it deterministically and present your own estimate clearly labelled as approximate (\"about X\" or \"roughly X\").",
    "2. NEVER invent, guess, or fabricate transactions, amounts, categories, budgets, or goals that are not present in the provided snapshot. If some detail is missing, say so.",
    "3. You are NOT a licensed financial advisor. Never give investment, tax, legal, lending, or professional financial advice. You may give educational, general money-management tips (e.g. about budgeting habits), but clearly educational and non-personal.",
    "4. Never reveal private data beyond what is necessary to answer. The snapshot is the user's own data, so you may reference it, but keep the answer concise and directly relevant to the question.",
    "5. If the data is insufficient to answer confidently, state clearly that information is insufficient and say exactly what additional data would help.",
    "6. Always be polite, clear, and concise. You may answer in plain English (or Burmese if asked).",
    "",
    "SUPPORTED TOPICS ONLY: spending, transactions, budgets, savings goals. If asked about anything else, politely decline and restate what you can help with.",
    "",
    "USER'S DATA SNAPSHOT (currency: MMK):",
    JSON.stringify(financeSummary),
  ].join("\n");
}

module.exports = {
  SUPPORTED_TOPICS,
  MAX_QUESTION_LENGTH,
  validateQuestion,
  scopeCheck,
  buildSystemPrompt,
};
