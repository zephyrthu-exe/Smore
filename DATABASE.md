# Smore — Firestore Data Model & Security

This document describes the Cloud Firestore schema for the **Smore (Save More)** personal finance tracker and the security rules that guard it.

- **Firebase project ID:** `smore-6464b`
- **Database:** Cloud Firestore (native mode)
- **Auth:** Firebase Authentication, email/password sign-in
- **Currency:** all monetary fields are stored as whole **MMK** amounts (integers)

---

## 1. Collection / document structure

Every user's personal data lives in **subcollections underneath their own user profile**. This is intentional: it lets the security rules enforce isolation purely from the document path, and it keeps the data for one person together.

```
users/{uid}
├── transactions/{txnId}
├── budgets/{budgetId}
└── goals/{goalId}
```

There is **no** top-level `transactions`, `budgets`, or `goals` collection — that would make cross-user access both possible and likely. All reads and writes go through a user's own subtree.

### `users/{uid}` — user profile

One document per authenticated user, keyed by the Firebase Auth UID.

| Field | Type | Notes |
|-------|------|-------|
| `email` | string | Owner's email (matches auth), max 254 chars |
| `displayName` | string | Full name, 1–80 chars |
| `currency` | string | Always `"MMK"` for this demo |
| `createdAt` | timestamp | When the profile was created |

Created by the app right after registration. The UID is taken from `auth.currentUser.uid`.

### `users/{uid}/transactions/{txnId}` — money in / money out

| Field | Type | Notes |
|-------|------|-------|
| `type` | string | `"income"` or `"expense"` |
| `amount` | number | Whole MMK, `>= 0`, ceiling `9,999,999,999` |
| `category` | string | Free-text label, max 50 chars (e.g. "food", "rent") |
| `description` | string | Optional note, max 300 chars |
| `date` | timestamp | The transaction date used for analytics |
| `createdAt` | timestamp | When the record was added |

The dashboard's *available balance* and *spent this month* are derived **deterministically** from the sum of these records — Smore owns the math, not the model.

### `users/{uid}/budgets/{budgetId}` — spending limits

| Field | Type | Notes |
|-------|------|-------|
| `category` | string | The category this budget covers, max 50 chars |
| `limit` | number | Whole MMK ceiling, `>= 0` |
| `period` | string | `"monthly"` or `"yearly"` |
| `createdAt` | timestamp | When the budget was set |

The *budget warnings* feature compares the per-category sum of `transactions` within the period against `limit`.

### `users/{uid}/goals/{goalId}` — savings goals

| Field | Type | Notes |
|-------|------|-------|
| `title` | string | Goal name, 1–120 chars |
| `targetAmount` | number | Whole MMK target, `>= 0` |
| `savedAmount` | number | Whole MMK saved so far, `>= 0` |
| `deadline` | timestamp | Target completion date |
| `createdAt` | timestamp | When the goal was created |

Savings *progress* is `savedAmount / targetAmount`.

---

## 2. Security rules

Rules live in **`firestore.rules`** at the repo root and use `rules_version = '2'`.

### Guarantees

1. **Authenticated only.** Every data path requires `request.auth != null`. Anonymous or unauthenticated reads/writes are denied on all collections.
2. **Strict tenant isolation.** All data hangs off `users/{uid}` and every rule checks `request.auth.uid == uid`. A user can only ever read or write **their own** documents — never another user's transactions, budgets, or goals.
3. **No open / test mode.** There is no `allow read, write: if true` anywhere. The service closes every unmatched path by default (unmatched match blocks deny).
4. **Shape validation on write.** `create` and `update` both require the exact required fields and basic types:
   - `users`: `email`, `displayName`, `currency == "MMK"`, `createdAt`
   - `transactions`: `type in ["income","expense"]`, `amount` number, `category`, `description`, `date`, `createdAt`
   - `budgets`: `category`, `limit`, `period in ["monthly","yearly"]`, `createdAt`
   - `goals`: `title`, `targetAmount`, `savedAmount`, `deadline`, `createdAt`
5. **Trusted timestamps.** `date`, `deadline`, and `createdAt` must be Firestore `timestamp` objects. A client cannot smuggle in a forged string or arbitrary object, and the app is expected to write `serverTimestamp()` / real timestamps.
6. **No profile deletion.** `users/{uid}` disallows `delete` — profiles are permanent for the demo.

### Helper functions

- `isOwner(uid)` — `request.auth != null && request.auth.uid == uid`
- `requiredFields(data, names)` — the incoming document contains every required field
- `isNonNegativeAmount(value)` — whole, finite MMK number between `0` and `9,999,999,999`

### Important rule for the app

Because a user **may not forge another user's path**, the frontend must always use paths of the form
`db.collection("users").doc(auth.currentUser.uid).collection("transactions")`.
Never interpolate a user-supplied UID into a path, and never mint documents outside the caller's own subtree — the rules will reject them.

---

## 3. Composite indexes

Indexes are declared in **`firestore.indexes.json`** at the repo root. They support the analytics/dashboard queries (the ones that filter and sort at the same time).

| Collection | Fields | Used by |
|-----------|--------|---------|
| `transactions` | `type ASC`, `date DESC` | Recent transactions filtered by income/expense |
| `transactions` | `category ASC`, `date DESC` | Category breakdown, newest first |
| `transactions` | `date ASC`, `type ASC` | Monthly comparison / date-range by type |
| `budgets` | `period ASC`, `category ASC` | Budget tracking by period |
| `goals` | `deadline ASC`, `createdAt DESC` | Goal progress board ordered by deadline |

Single-field orderings (e.g. plain `createdAt ASC`) use the automatic index and need no declaration.

---

## 4. Deploying the rules & indexes

Requires the **Firebase CLI** (Node-based). From the repo root:

```bash
# 1. Install the CLI once (if you do not have it)
npm install -g firebase-tools

# 2. Log in and select the project
firebase login
firebase use smore-6464b

# 3. Deploy Firestore rules
firebase deploy --only firestore:rules

# 4. Deploy composite indexes (this is the same command)
firebase deploy --only firestore:indexes

# Or deploy both together
firebase deploy --only firestore
```

Rules take effect immediately. Composite indexes take a short time to build once deployed; queries that depend on them return an error until the index is active.

> **Note:** The web app's browser config (API key etc.) lives in `src/js/firebase-config.js`. Do **not** put server-private credentials or the Gemini API key inside this file — those belong in a protected Cloud Function. The config file here only holds the public web client keys, which is normal and safe.
