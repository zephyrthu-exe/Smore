# Smore Assistant Gateway

Secure VPS API gateway for **Smore (Save More)**. It lets the frontend talk to
Google **Gemini** safely **without** Firebase Cloud Functions or the Blaze plan.

```
Smore frontend (browser)
     │  HTTPS + Firebase ID token + question
     ▼
Harmy VPS — this gateway (Express, Node)
     │  1. verifies the Firebase Auth ID token
     │  2. reads ONLY the caller's own Firestore data (tenant isolation)
     │  3. sends a validated, guardrailed summary to Gemini
     ▼
Gemini API  (GEMINI_API_KEY lives only on the VPS)
```

## Why this exists

The project stays on the **Spark** (free) plan, which does not allow Firebase
Secret Manager or (a paid tier) for Cloud Functions out of the box. This gateway
moves the secret keeping and the Gemini call onto the Harmy VPS instead, where
the API key is an ordinary environment variable.

The gateway never modifies the frontend, never changes `firestore.rules`, and
never exposes the Gemini key. It only **reads** the user's own data to answer
questions.

---

## Security model

- **Authentication.** The browser sends its Firebase Authentication **ID token**
  in the `Authorization: Bearer <idToken>` header. The gateway verifies it with
  `firebase-admin` and uses the **verified `uid`** as the sole identity source.
- **Tenant isolation.** All reads use paths of the form `users/{verifiedUid}/…`.
  A user can never reach another user's transactions, budgets, or goals — the
  path is built from the token's UID, never from client input. (Mirrors
  `firestore.rules`.)
- **CORS allow-list.** Only origins listed in `ALLOWED_ORIGINS` may call the
  gateway. Others get `403`.
- **Rate limiting.** Per-IP request caps protect against abuse.
- **Guardrails.** Gemini is instructed to never perform authoritative financial
  calculations, never invent missing data, never give professional financial
  advice, and to state clearly when information is insufficient. The gateway
  also rejects out-of-scope topics before a Gemini call is made.
- **Secrets.** `GEMINI_API_KEY` and the Firebase service-account file live only
  as VPS environment variables / a file outside the repo. Nothing is committed
  (see `.gitignore` and `.env.example`).
- **Safe fallbacks.** If Gemini is not configured, or fails, the gateway returns
  a safe, non-leaking response instead of crashing.

---

## Project layout

```
assistant-gateway/
├── .env.example          # Template (placeholders only — safe to commit)
├── .gitignore            # Blocks .env & service-account files
├── package.json
├── README.md             # This file
├── VPS_DEPLOY.md         # Systemd deployment on the Harmy VPS
├── src/
│   ├── server.js         # Entry point (starts the HTTP server)
│   ├── app.js            # Express app factory (middleware + routes)
│   ├── config.js         # Environment config loader + validation
│   ├── firebase.js       # firebase-admin auth + tenant-isolated reads
│   ├── gemini.js         # Minimal Gemini REST client (native fetch)
│   └── guardrails.js     # Input validation, scope checks, system prompt
└── test/
    ├── helpers.js        # Test app builder with stubs
    ├── health.test.js
    ├── auth.test.js
    ├── isolation.test.js
    ├── assistant.test.js
    ├── ratelimit.test.js
    └── guardrails.test.js
```

---

## Local development setup (no credentials required to test)

You can run the gateway and its test suite locally without any real key or
service account. Tests inject stubs for Firebase and Gemini, so nothing touches
the network.

```bash
cd assistant-gateway
npm install          # installs runtime + dev deps
npm test             # runs the full Jest suite (all offline)
```

### Optionally use a real `.env` (local)

Copy the template and fill in real values only if you want to test against a
real Firebase/Gemini:

```bash
cp .env.example .env
# edit .env  (GEMINI_API_KEY, GOOGLE_APPLICATION_CREDENTIALS, etc.)
npm start            # HTTP server on PORT (default 8080)
```

> ⚠️ `.env` is git-ignored. Never commit it. The `.env.example` file is the only
> committed template and contains placeholders only.

### Try it once running

```bash
curl http://localhost:8080/health
# {"status":"ok","service":"smore-assistant-gateway",...,"geminiConfigured":false}
```

With a real ID token:

```bash
curl -X POST http://localhost:8080/api/assistant \
  -H "Authorization: Bearer <your-firebase-id-token>" \
  -H "Content-Type: application/json" \
  -d '{"question":"How much did I spend on food this month?"}'
```

---

## API reference

### `GET /health`

No auth. Returns service status and whether Gemini is configured (boolean only —
never the key value).

```json
{ "status": "ok", "service": "smore-assistant-gateway", "time": "...", "geminiConfigured": false }
```

### `POST /api/assistant`

Needs `Authorization: Bearer <Firebase ID token>` and a JSON body with the
`question` field.

Request:
```json
{ "question": "What's my budget situation for food?" }
```

Success `200`:
```json
{ "answer": "Your food budget is ... You are about X MMK under/over...", "user": { "uid": "abc" } }
```

Failure response shape (all errors):
```json
{ "error": { "code": "unauthorized | invalid_question | out_of_scope | forbidden_origin | rate_limited | assistant_unavailable | bad_json | internal | not_found", "message": "..." } }
```

| HTTP | When |
|------|------|
| `401` | Missing / invalid Firebase ID token |
| `403` | Origin not in allow-list |
| `400` | Invalid / missing / too-long question, or malformed JSON |
| `422` | Out-of-scope topic (investing, tax, loans, etc.) |
| `429` | Rate limit exceeded |
| `502` | Gemini unavailable |
| `500` | Unexpected server error |

---

## Supported question topics

- **Spending** (overview, by category, by time)
- **Transactions** (history, individual records)
- **Budgets** (remaining vs. limit)
- **Savings goals** (progress, deadlines)

Investment, tax, lending, credit, and general professional finance advice are
rejected/declined on purpose.

---

## Running the tests

```bash
cd assistant-gateway
npm test
```

The suite covers (offline, with stubs):

1. Health endpoint (no auth, no key leakage).
2. Authentication rejection (no token, empty token, bad token, forged token,
   upstream verification failure).
3. Successful authenticated access.
4. **Cross-user isolation** — verifies Gemini only ever receives the caller's
   own data, and that a client-supplied `uid` is ignored in favour of the UID
   from the verified token.
5. Invalid questions + Gemini failures + safe degradation when the key is not
   configured.
6. Rate limiting (`429`).

---

## VPS deployment

Full step-by-step **systemd** deployment on the Harmy VPS is in
**[`VPS_DEPLOY.md`](./VPS_DEPLOY.md)**.

Summary of the required environment variables (see `.env.example` for all of
them):

| Variable | Purpose | Required? |
|----------|---------|-----------|
| `PORT` | HTTP port | no (default `8080`) |
| `ALLOWED_ORIGINS` | Comma-separated CORS allow-list | yes on the VPS |
| `GOOGLE_APPLICATION_CREDENTIALS` | Absolute path to Firebase service-account JSON | yes on the VPS |
| `FIREBASE_PROJECT_ID` | Firebase project id | no (default `smore-6464b`) |
| `GEMINI_API_KEY` | Gemini API key (secret) | yes on the VPS |
| `GEMINI_MODEL` | Gemini model name | no (default `gemini-1.5-flash`) |

---

## Connect the frontend (for reference — no frontend files were changed)

The browser already holds a Firebase ID token after login. It would call:

```js
const res = await fetch(API_BASE + "/api/assistant", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + (await auth.currentUser.getIdToken()),
  },
  body: JSON.stringify({ question }),
});
```

Only backend files were created/modified as part of this task; the frontend was
left untouched.
