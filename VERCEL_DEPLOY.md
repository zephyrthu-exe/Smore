# Deploy the Smore Assistant gateway on Vercel (serverless)

This runs the assistant backend **inside the same Vercel project** as the frontend,
so the frontend calls the **same-origin** `/api/assistant` — no VPS, no TLS/cert,
no separate domain, and **no need to set `PROD_GATEWAY_URL`**.

## How it works

- The static site still comes from `src/` (unchanged).
- New Vercel serverless functions handle the backend:
  - `api/assistant.js` → `POST https://<your-app>.vercel.app/api/assistant`
  - `api/health.js`     → `GET  https://<your-app>.vercel.app/health`
- `vercel.json` tells Vercel to:
  - serve static files from `src/`,
  - install the gateway's own deps (`npm install --prefix assistant-gateway --omit=dev`),
  - build the two functions on Node 20.
- Vercel Functions are **stateless/ephemeral**, so the confirmation-token store is
  now **Firestore-backed** (`FirestorePendingActionStore`) to survive the
  "stage a change" → "confirm ABC123" two-request flow. The in-memory store is
  still the default for the VPS / local dev.

## 1) Add the credentials to the Vercel dashboard

Project → Settings → **Environment Variables**. Add:

| Name | Value |
| --- | --- |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | The **entire contents** of your Firebase service-account JSON (paste the JSON text, do not use a path) |
| `FIREBASE_PROJECT_ID` | `smore-6464b` |
| `GEMINI_API_KEY` | your real Gemini API key |
| `GEMINI_MODEL` | `gemini-2.5-flash` (optional) |
| `GEMINI_MAX_OUTPUT_TOKENS` | `800` (optional) |
| `ALLOWED_ORIGINS` | `https://<your-app>.vercel.app` (optional — auto-derived from `VERCEL_URL` if omitted; **required** if you use a custom domain) |
| `NODE_ENV` | `production` |

> **Where to get the service-account JSON:** Firebase Console → Project settings →
> Service accounts → *Generate new private key* → copy the JSON → paste it into the
> `GOOGLE_APPLICATION_CREDENTIALS_JSON` env var. It must be for the **same project**
> (`smore-6464b`) the frontend uses, and the service account needs Firestore access.
>
> **Custom domain?** Set `ALLOWED_ORIGINS` to your exact origin (e.g.
> `https://smore.mydomain.com`, no trailing slash). The auto-default only guesses the
> `*.vercel.app` origin.

Env vars are read at function start-up, so re-deploy after changing them.

## 2) Make sure the Vercel project uses the repo root

The project's **Root Directory** must be the repo root — the folder containing
`api/`, `src/`, `vercel.json`, and `.gitignore`. If you previously set Root
Directory to `src` (for the old static-only deploy), change it back to the repo
root so `/api` is discovered. The static files are still served from `src/`
(via `outputDirectory` in `vercel.json`).

## 3) Deploy

From the repo root (or push to the connected Git repo):

```bash
vercel --prod
```

## 4) Verify

- Open `https://<your-app>.vercel.app/health` in a browser or:
  ```bash
  curl https://<your-app>.vercel.app/health
  ```
  You should see `{"status":"ok","service":"smore-assistant-gateway",...,"geminiConfigured":true}`.
- Open your site and ask the bot a question. Ask it to add an expense, then reply
  `confirm ABC123` — the confirm flow should now complete (it persists the token
  in Firestore).

## Notes / limitations

- **Cold starts:** `firebase-admin` is large, so the first request per lambda can
  be slower, and the first call after a redeploy pays a warm-up cost.
- **Rate limiting is best-effort** on serverless (per-instance memory). It still
  exists but isn't as strict as the single-process VPS gateway.
- If Vercel rejects the `maxDuration` value for your plan, lower it in
  `vercel.json` (e.g. `"maxDuration": 10`) and redeploy.
- The VPS path (`assistant-gateway/VPS_DEPLOY.md`) is unchanged and still works;
  it just uses the in-memory store instead.
