# Deploying the Smore Assistant Gateway on the Harmy VPS

This guide walks through running the gateway as a background service on the
Harmy VPS with **systemd**, so it restarts automatically and stays up after you
log out.

Only backend files are involved. The frontend and `firestore.rules` are **not**
modified.

---

## Prerequisites

- Node.js **18+** and npm on the VPS.
- The repo on the VPS (e.g. cloned to `/opt/smore`).
- A Firebase **service-account** JSON file for the `smore-6464b` project.
  Download it from **Firebase console → Project settings → Service accounts →
  Generate new private key**. Keep this file **outside the repo**.
- A **Gemini API key** from [Google AI Studio](https://aistudio.google.com).
- A real, reachable domain / HTTPS hostname for the frontend so it can send an
  `ALLOWED_ORIGINS` value that matches the active context (for the school demo,
  a local dev origin is fine too).

---

## 1. Install dependencies

```bash
cd /opt/smore/assistant-gateway
npm install --omit=dev      # production dependencies only
```

---

## 2. Place the service account file outside the repo

```bash
mkdir -p /etc/smore
# Upload your downloaded JSON here, e.g.:
#   scp smore-6464b-firebase-adminsdk-XXXXX.json root@YOUR_VPS:/etc/smore/
chmod 600 /etc/smore/smore-service-account.json   # protect it
chown root:root /etc/smore/smore-service-account.json
```

> Never put this file inside the repo — it is git-ignored anyway, but keeping it
> outside the repo is the safest practice.

---

## 3. Create the production `.env`

```bash
cd /opt/smore/assistant-gateway
cp .env.example .env
chmod 600 .env
nano .env        # fill in the real values (see below)
```

Fill in:

```ini
PORT=8080
ALLOWED_ORIGINS=https://your-hosting-domain.firebaseapp.com
GOOGLE_APPLICATION_CREDENTIALS=/etc/smore/smore-service-account.json
FIREBASE_PROJECT_ID=smore-6464b
GEMINI_API_KEY=PASTE_YOUR_REAL_GEMINI_KEY_HERE
GEMINI_MODEL=gemini-1.5-flash
GEMINI_MAX_OUTPUT_TOKENS=800
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_PER_IP=30
```

Then verify it boots and the health endpoint responds:

```bash
npm start
curl http://localhost:8080/health
# expect: {"status":"ok",...,"geminiConfigured":true}
```

Stop it with `Ctrl+C` before continuing to the systemd step.

---

## 4. Run it as a systemd service

Create `/etc/systemd/system/smore-gateway.service`:

```ini
[Unit]
Description=Smore Assistant Gateway (Gemini API)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/smore/assistant-gateway
EnvironmentFile=/opt/smore/assistant-gateway/.env
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
RestartSec=3
# Hardening
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

> Find your node path with `which node` and update `ExecStart` if it differs.

Enable and start:

```bash
systemctl daemon-reload
systemctl enable smore-gateway
systemctl start smore-gateway
systemctl status smore-gateway
```

Check the logs:

```bash
journalctl -u smore-gateway -f
```

---

## 5. Verify

```bash
curl http://localhost:8080/health                # 200 {"status":"ok",...}
curl -X POST http://localhost:8080/api/assistant \
  -H "Authorization: Bearer INVALID" \
  -H "Content-Type: application/json" \
  -d '{"question":"hi"}'                          # 401 unauthorized
```

A real browser call with a valid Firebase ID token from the `smore-6464b`
project should return a `200` with an `answer` from Gemini.

---

## 6. Firewall / proxy (optional)

If the gateway is fronted by nginx/Caddy, proxy `/api/assistant` and `/health`
to `127.0.0.1:8080` and terminate TLS there. Keep `ALLOWED_ORIGINS` set to the
public origin so the browser's CORS check passes.

---

## Updating

```bash
cd /opt/smore
git pull
cd assistant-gateway
npm install --omit=dev
systemctl restart smore-gateway
```

---

## Troubleshooting

- **`401 unauthorized` on every call** → frontend is not sending the ID token,
  or the App Check/token audience doesn't match this project. Confirm you are
  calling from an origin in `ALLOWED_ORIGINS` and sending
  `Authorization: Bearer <fresh idToken>`.
- **`geminiConfigured:false`** → `GEMINI_API_KEY` is missing or still a
  placeholder in `.env`.
- **CORS errors in the browser** → the page origin isn't in `ALLOWED_ORIGINS`.
- **Gemini `502`** → check the key/quota and `journalctl -u smore-gateway`.
