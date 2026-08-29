// theme.js
// Light/dark theme engine for Smore. It stores the chosen theme in localStorage,
// applies it as a data-theme attribute on <html>, and wires every element that
// carries [data-theme-toggle] to flip between light and dark.

const STORAGE_KEY = "smore-theme";
const DARK = "dark";
const LIGHT = "light";

export function getPreferredTheme() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === LIGHT || saved === DARK) return saved;
  } catch (e) {
    /* storage may be unavailable */
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? DARK : LIGHT;
}

export function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === DARK ? DARK : LIGHT;
}

export function applyTheme(theme) {
  const next = theme === DARK ? DARK : LIGHT;
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch (e) {
    /* ignore */
  }
  syncToggleUI(next);
  return next;
}

export function toggleTheme() {
  return applyTheme(currentTheme() === DARK ? LIGHT : DARK);
}

function syncToggleUI(theme) {
  const isDark = theme === DARK;
  document.querySelectorAll("[data-theme-toggle]").forEach((el) => {
    el.setAttribute("aria-pressed", String(isDark));
    const icon = el.querySelector("[data-theme-icon]");
    const label = el.querySelector("[data-theme-label]");
    if (icon) icon.className = isDark ? "bi bi-sun-fill" : "bi bi-moon-stars";
    if (label) label.textContent = isDark ? "Light mode" : "Dark mode";
  });
}

// Mount the desktop sidebar toggle and the mobile "More" menu toggle on
// signed-in pages. Called once by app-shell.js during page startup.
export function mountThemeToggle() {
  const sidebarNav = document.querySelector(".app-sidebar nav");
  if (sidebarNav && !sidebarNav.parentElement?.querySelector("[data-theme-toggle]")) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sidebar-link sidebar-theme-toggle d-flex align-items-center gap-2 px-3 py-2 rounded";
    btn.setAttribute("data-theme-toggle", "");
    btn.innerHTML = '<i data-theme-icon class="bi bi-moon-stars"></i><span data-theme-label>Dark mode</span>';
    sidebarNav.insertAdjacentElement("afterend", btn);
  }

  const moreMenu = document.getElementById("mobileMoreMenu");
  if (moreMenu && !moreMenu.querySelector("[data-theme-toggle]")) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("data-theme-toggle", "");
    btn.innerHTML = '<i data-theme-icon class="bi bi-circle-half"></i><span data-theme-label>Dark mode</span>';
    moreMenu.prepend(btn);
  }

  syncToggleUI(currentTheme());
}

// Apply the saved (or system) theme as soon as this module loads.
applyTheme(getPreferredTheme());

// One delegated listener covers every toggle, including ones injected later.
document.addEventListener("click", (event) => {
  if (event.target.closest("[data-theme-toggle]")) {
    toggleTheme();
  }
});
