// theme.js
// Light/dark theme engine for Smore. It stores the chosen theme in localStorage,
// applies it as a data-theme attribute on <html>, and wires every element that
// carries [data-theme-toggle] to flip between light and dark.

const STORAGE_KEY = "smore-theme";
const DARK = "dark";
const LIGHT = "light";

function normalizeHexColor(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed)) {
    return trimmed;
  }
  return null;
}

function hexToRgb(hex) {
  const value = normalizeHexColor(hex);
  if (!value) return null;
  const normalized = value.length === 4
    ? value.split("").map((ch, idx) => ch + ch).join("")
    : value;
  const num = Number.parseInt(normalized.slice(1), 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map((channel) => Math.max(0, Math.min(255, channel)).toString(16).padStart(2, "0")).join("")}`;
}

function adjustColor(hex, amount) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const mix = (channel) => Math.max(0, Math.min(255, Math.round(channel + (255 - channel) * amount)));
  return rgbToHex({
    r: mix(rgb.r),
    g: mix(rgb.g),
    b: mix(rgb.b),
  });
}

function darkenColor(hex, amount = 0.18) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return rgbToHex({
    r: Math.round(rgb.r * (1 - amount)),
    g: Math.round(rgb.g * (1 - amount)),
    b: Math.round(rgb.b * (1 - amount)),
  });
}

export function syncBotAccentTheme(profileOverride = null) {
  try {
    const profile = profileOverride || JSON.parse(sessionStorage.getItem("smore_bot_profile_cache") || "null");
    if (!profile) {
      document.documentElement.style.removeProperty("--smore-primary");
      document.documentElement.style.removeProperty("--smore-primary-dark");
      document.documentElement.style.removeProperty("--smore-primary-soft");
      document.documentElement.style.removeProperty("--smore-glow");
      return;
    }
    const color = normalizeHexColor(profile?.accentColor || "#ff6b35");
    if (!color) return;

    const darkened = darkenColor(color, 0.18);
    const soft = adjustColor(color, 0.82);
    document.documentElement.style.setProperty("--smore-primary", color);
    document.documentElement.style.setProperty("--smore-primary-dark", darkened);
    document.documentElement.style.setProperty("--smore-primary-soft", soft);
    document.documentElement.style.setProperty("--smore-glow", `${color}55`);
  } catch (_) {
    // Ignore malformed profile cache.
  }
}

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
  syncBotAccentTheme();
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

// Expose the helper so the bot customization widget can keep app colors in sync.
if (typeof window !== "undefined") {
  window.syncBotAccentTheme = syncBotAccentTheme;
}

// Apply the saved (or system) theme as soon as this module loads.
applyTheme(getPreferredTheme());

// One delegated listener covers every toggle, including ones injected later.
document.addEventListener("click", (event) => {
  if (event.target.closest("[data-theme-toggle]")) {
    toggleTheme();
  }
});
