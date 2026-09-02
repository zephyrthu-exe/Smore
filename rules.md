# Smore — Rules for AI Code Edits

These rules keep the codebase clean, beginner-friendly, and free of the
repetition that used to make it hard to maintain. Follow them for every
change you make to this project.

## Project layout

```
src/
  index.html          login / sign-up page (uses js/auth.js)
  dashboard.html      main dashboard (uses js/dashboard.js)
  transaction.html    transactions page (uses js/transactions.js)
  budget.html         budgets page (uses js/budgets.js)
  goals.html          savings goals page (uses js/goals.js)
  analytics.html      analytics page (uses js/analytics.js)
  css/
    styles.css        ALL shared styles (page-specific inline <style> blocks
                      were removed — do not add them back)
    sombo.css         styles for the Sombo assistant widget only
  js/
    firebase-config.js   Firebase auth + Firestore instances
    auth.js              login / sign-up logic (index.html only)
    app-shell.js         SHARED startup helpers for every signed-in page
    account-menu.js      profile menu + modals (edit profile, password, ...)
    sombo-assistant.js   the in-app "Sombo" assistant widget
    finance-utils.js     money/date helper functions
    dashboard.js / transactions.js / budgets.js / goals.js / analytics.js
```

## The app-shell pattern (important!)

Every signed-in page used to copy-paste the same startup code: an
`onAuthStateChanged` handler, `bindUserData`, `setupLogout`, `escapeHtml`
and `closeModal`. That duplication is gone. Today all of that lives in
**`src/js/app-shell.js`**.

A page script must start like this:

```js
startAuthenticatedPage((user) => {
  // wire up this page's own features here
  listenToWidgets(user.uid);
  setupSomeForm(user.uid);
});
```

`startAuthenticatedPage` already handles:

- redirecting to `index.html` when nobody is signed in,
- binding the user's name / email / avatar,
- setting up the account menu,
- wiring the logout buttons,
- starting the Sombo assistant.

## Hard rules

1. **Never copy-paste shared helpers.** Do not redefine `escapeHtml`,
   `closeModal`, `bindUserData`, `setupLogout`, `initSomboAssistant`,
   `destroySomboAssistant`, or an `onAuthStateChanged` block inside a page
   script. Import them from `app-shell.js` instead.

2. **One page entry point.** Each page script has exactly one
   `startAuthenticatedPage(...)` call. Do not add a second auth listener.

3. **Always escape user data.** Any value that came from a user, Firestore,
   or localStorage must be passed through `escapeHtml(...)` before it is
   placed in `innerHTML` (prevents XSS). It is fine to use `textContent`
   without escaping.

4. **Use `closeModal` from app-shell.js** (`closeModal("addTxModal")`)
   instead of writing `window.bootstrap?.Modal?.getInstance(...)` inline.

5. **`store.js` is gone.** It was unreferenced and deleted. Never import
   `./store.js`, `initStore`, or `cleanupStore`. If a page needs to clean up
   the Sombo widget before logout, that already happens in `app-shell.js`.

6. **Keep CSS in `styles.css`.** Do not add inline `<style>` blocks to the
   HTML pages. Page-specific selectors that only one page uses may still go
   into `styles.css` (with a comment saying which page they belong to).
   `sombo.css` is reserved for the assistant widget.

7. **Preserve behavior.** Refactors should not change how the app behaves or
   what the UI looks like. If a change is a behavior fix, call it out
   explicitly in your summary.

8. **Dead code gets deleted.** If a function is never called (search the
   whole `src` folder to confirm), remove it rather than keeping it "just in
   case". Example already done: `setupRecurringScheduleForm` in the
   dashboard was unused and removed.

## Keeping it beginner-friendly

- Use plain names: `function listenToTransactions(userId)` not `lt`.
- Keep functions small and focused; one job per function.
- Comment the *why*, not the *what*. A short comment above each function
  explaining what it does is appreciated.
- Prefer `const`, then `let`; avoid `var`.
- Match the existing style: double quotes for strings in page scripts,
  single quotes for short identifiers/labels where the current file does so.

## Validating your changes

Always run this after editing any JS file (PowerShell):

```powershell
cd src/js
foreach ($f in app-shell.js goals.js budgets.js analytics.js transactions.js dashboard.js) {
  Get-Content $f -Raw | node --input-type=module --check
}
```

If you change HTML, re-open the page in a browser and check the console.
Recommended manual smoke test: log in, then visit each page
(dashboard, transactions, budgets, goals, analytics) and verify the data
loads, the account menu opens, and logout works.
