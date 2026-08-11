/**
 * sombo-assistant.js â€” Per-User Customizable Smore Assistant Bot
 *
 * Features:
 *  - Floating draggable bot widget (mouse + touch via Pointer Events API)
 *  - Per-user bot profiles stored in users/{uid}/assistantProfile/profile
 *  - One-time onboarding modal for new users
 *  - Sidebar "Customize my bot" panel
 *  - CSS theming via --sombo-accent and data-bot-style attribute
 *  - Rich interaction animations (hover, drag, chat open, happy, error)
 *  - All existing VPS Gemini gateway functions preserved
 *  - Reduced-motion respected via CSS
 */

import { auth } from "./firebase-config.js";
import {
  loadBotProfile,
  saveBotProfile,
  resetBotProfile,
  DEFAULT_BOT_PROFILE,
} from "./bot-profile.js";

// â”€â”€â”€ Gateway URL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const GATEWAY_URL =
  window.SMORE_GATEWAY_URL || "http://172.237.84.171:8080/api/assistant";

// â”€â”€â”€ Style preset metadata â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const STYLE_PRESETS = [
  { id: "classic",   label: "Classic Sombo" },
  { id: "friendly",  label: "Friendly" },
  { id: "minimal",   label: "Minimal" },
  { id: "energetic", label: "Energetic" },
  { id: "calm",      label: "Calm" },
];

// â”€â”€â”€ SVG markup (unchanged from original, accent-color-reactive via CSS var) â”€â”€
function getSomboSVGMarkup(size = "full") {
  const w = size === "small" ? 56 : 86;
  const h = size === "small" ? 62 : 94;
  return `
    <svg class="sombo-svg" viewBox="0 0 96 100" fill="none"
         width="${w}" height="${h}"
         xmlns="http://www.w3.org/2000/svg"
         aria-hidden="true">
      <defs>
        <linearGradient id="sbg${size}" x1="16" y1="20" x2="80" y2="90" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stop-color="#334155"/>
          <stop offset="45%"  stop-color="#1E293B"/>
          <stop offset="100%" stop-color="#0F172A"/>
        </linearGradient>
        <linearGradient id="shg${size}" x1="20" y1="10" x2="76" y2="55" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stop-color="#475569"/>
          <stop offset="50%"  stop-color="#1E293B"/>
          <stop offset="100%" stop-color="#0F172A"/>
        </linearGradient>
        <filter id="sglow${size}" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.5" result="blur"/>
          <feComposite in="SourceGraphic" in2="blur" operator="over"/>
        </filter>
      </defs>
      <g class="sombo-antenna-group">
        <rect x="46" y="6" width="4" height="12" rx="2" fill="#94A3B8"/>
        <circle class="sombo-antenna-tip" cx="48" cy="6" r="5"
                fill="var(--sombo-accent)" filter="url(#sglow${size})"/>
      </g>
      <g class="sombo-body-group">
        <g class="sombo-arm-left">
          <rect x="12" y="52" width="10" height="20" rx="5" fill="#334155"/>
          <circle cx="17" cy="69" r="4.5" fill="var(--sombo-accent)"/>
        </g>
        <g class="sombo-arm-right">
          <rect x="74" y="52" width="10" height="20" rx="5" fill="#334155"/>
          <circle cx="79" cy="69" r="4.5" fill="var(--sombo-accent)"/>
        </g>
        <rect x="32" y="80" width="10" height="13" rx="4" fill="#1E293B"/>
        <rect x="54" y="80" width="10" height="13" rx="4" fill="#1E293B"/>
        <ellipse cx="37" cy="92" rx="6.5" ry="3.5" fill="var(--sombo-accent)"/>
        <ellipse cx="59" cy="92" rx="6.5" ry="3.5" fill="var(--sombo-accent)"/>
        <rect x="22" y="46" width="52" height="38" rx="18"
              fill="url(#sbg${size})" stroke="#475569" stroke-width="1.5"/>
        <rect x="28" y="50" width="40" height="28" rx="12"
              fill="#FFF8F0" opacity="0.9"/>
        <g class="sombo-emblem-group" transform="translate(48, 64)">
          <circle cx="0" cy="0" r="10" fill="#1E293B"/>
          <circle class="sombo-emblem-glow" cx="0" cy="0" r="8.5"
                  fill="var(--sombo-accent)" opacity="0.9" filter="url(#sglow${size})"/>
          <path d="M 2.5 -4.5 C 2.5 -5.8 -0.5 -6.2 -2.5 -5 C -4 -4 -3.5 -1.5 -0.5 -0.5
                   C 2.5 0.5 3 3 1.5 4.5 C -0.5 6 -3.5 5.5 -3.5 4"
                fill="none" stroke="#FFF8F0" stroke-width="2.2" stroke-linecap="round"/>
        </g>
        <rect x="18" y="16" width="60" height="34" rx="16"
              fill="url(#shg${size})" stroke="#475569" stroke-width="1.5"/>
        <rect x="14" y="27" width="5" height="12" rx="2.5" fill="var(--sombo-accent)"/>
        <rect x="77" y="27" width="5" height="12" rx="2.5" fill="var(--sombo-accent)"/>
        <rect x="24" y="20" width="48" height="25" rx="11"
              fill="#0B132B" stroke="#334155" stroke-width="1"/>
        <g class="sombo-eyes-group">
          <ellipse class="sombo-eye" cx="37" cy="32.5" rx="5.5" ry="6.5"
                   fill="#38BDF8" filter="url(#sglow${size})"/>
          <circle cx="38.5" cy="30.5" r="2" fill="#FFFFFF"/>
          <ellipse class="sombo-eye" cx="59" cy="32.5" rx="5.5" ry="6.5"
                   fill="#38BDF8" filter="url(#sglow${size})"/>
          <circle cx="60.5" cy="30.5" r="2" fill="#FFFFFF"/>
        </g>
      </g>
    </svg>
    <div class="sombo-shadow"></div>
  `;
}

// â”€â”€â”€ Main Widget Class â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class SomboAssistantWidget {
  constructor() {
    // DOM refs
    this.containerEl   = null;
    this.avatarBtnEl   = null;
    this.panelEl       = null;
    this.chatBodyEl    = null;
    this.inputEl       = null;
    this.sendBtnEl     = null;
    this.statusDotEl   = null;
    this.statusTextEl  = null;
    this.badgeEl       = null;
    this.panelTitleEl  = null;

    // State
    this.isOpen      = false;
    this.isThinking  = false;
    this.currentUser = null;
    this.profile     = { ...DEFAULT_BOT_PROFILE };

    // Drag state
    this._dragStartX    = 0;
    this._dragStartY    = 0;
    this._originLeft    = 0;
    this._originBottom  = 0;
    this._isDragging    = false;
    this._totalTravel   = 0;
    this._lastPosLeft   = null;
    this._lastPosBottom = null;
  }

  // â”€â”€ Mount â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  mount() {
    if (document.getElementById("sombo-widget-root")) return;

    const root = document.createElement("div");
    root.id = "sombo-widget-root";
    root.className = "sombo-widget-container";

    root.innerHTML = `
      <!-- Sombo Floating Companion Button -->
      <button
        id="sombo-avatar-btn"
        class="sombo-avatar-btn"
        type="button"
        aria-label="Open Smore Assistant Chat with ${this.escapeHTML(this.profile.name)}"
        aria-expanded="false"
        aria-controls="sombo-chat-panel"
      >
        <span class="sombo-badge" id="sombo-badge">${this.escapeHTML(this.profile.name)}</span>
        ${getSomboSVGMarkup("full")}
      </button>

      <!-- Sombo Chat Panel Window -->
      <div
        id="sombo-chat-panel"
        class="sombo-chat-panel"
        role="dialog"
        aria-labelledby="sombo-panel-title"
        aria-modal="false"
      >
        <!-- Header -->
        <header class="sombo-chat-header">
          <div class="sombo-header-info">
            <div class="sombo-header-avatar" aria-hidden="true">
              <svg viewBox="0 0 96 100" fill="none">
                <rect x="22" y="46" width="52" height="38" rx="18" fill="#1E293B"/>
                <rect x="18" y="16" width="60" height="34" rx="16" fill="#1E293B" stroke="var(--sombo-accent)" stroke-width="2"/>
                <ellipse cx="37" cy="32.5" rx="5" ry="6" fill="#38BDF8"/>
                <ellipse cx="59" cy="32.5" rx="5" ry="6" fill="#38BDF8"/>
              </svg>
            </div>
            <div>
              <h2 id="sombo-panel-title" class="sombo-header-title">${this.escapeHTML(this.profile.name)}</h2>
              <div class="sombo-header-status">
                <span id="sombo-status-dot" class="sombo-status-dot"></span>
                <span id="sombo-status-text">Smore Assistant</span>
              </div>
            </div>
          </div>
          <button
            id="sombo-close-btn"
            class="sombo-close-btn"
            type="button"
            aria-label="Close assistant panel"
          >âœ•</button>
        </header>

        <!-- Message Body -->
        <div id="sombo-chat-body" class="sombo-chat-body" aria-live="polite" aria-relevant="additions">
          <!-- Welcome Card injected by applyProfile() -->
        </div>

        <!-- Footer / Input Form -->
        <footer class="sombo-chat-footer">
          <form id="sombo-input-form" class="sombo-input-form" novalidate>
            <input
              id="sombo-input-field"
              class="sombo-input-field"
              type="text"
              placeholder="Ask about your finances in MMK..."
              maxlength="500"
              autocomplete="off"
              aria-label="Type your financial question"
            />
            <button
              id="sombo-send-btn"
              class="sombo-send-btn"
              type="submit"
              aria-label="Send question"
            >
              <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
            </button>
          </form>
          <p class="sombo-disclaimer">Smore Assistant interprets your logged transactions deterministically.</p>
        </footer>
      </div>
    `;

    document.body.appendChild(root);

    // Cache elements
    this.containerEl  = root;
    this.avatarBtnEl  = document.getElementById("sombo-avatar-btn");
    this.panelEl      = document.getElementById("sombo-chat-panel");
    this.chatBodyEl   = document.getElementById("sombo-chat-body");
    this.inputEl      = document.getElementById("sombo-input-field");
    this.sendBtnEl    = document.getElementById("sombo-send-btn");
    this.statusDotEl  = document.getElementById("sombo-status-dot");
    this.statusTextEl = document.getElementById("sombo-status-text");
    this.badgeEl      = document.getElementById("sombo-badge");
    this.panelTitleEl = document.getElementById("sombo-panel-title");

    this._buildWelcomeCard();
    this._bindEvents();
    this._bindDrag();
    this._bindSidebarCustomizeLink();
  }

  // â”€â”€ Welcome card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  _buildWelcomeCard() {
    const name = this.escapeHTML(this.profile.name);
    this.chatBodyEl.innerHTML = `
      <div class="sombo-welcome-card">
        <div class="sombo-welcome-icon">
          <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="24" cy="24" r="22" fill="#FFF8F0" stroke="var(--sombo-accent)" stroke-width="2"/>
            <path d="M16 26C16 26 20 31 24 31C28 31 32 26 32 26"
                  stroke="var(--sombo-accent)" stroke-width="2.5" stroke-linecap="round"/>
            <circle cx="17" cy="19" r="3" fill="#1E293B"/>
            <circle cx="31" cy="19" r="3" fill="#1E293B"/>
          </svg>
        </div>
        <h6>Hi! I'm ${name} ðŸ‘‹</h6>
        <p>Your friendly Smore financial companion. Ask me about your spending, budgets, or savings goals!</p>
        <div class="sombo-prompts-title">Try asking me:</div>
        <div class="sombo-prompts-list">
          <button type="button" class="sombo-prompt-btn" data-prompt="What is my available balance?">ðŸ’° What is my available balance?</button>
          <button type="button" class="sombo-prompt-btn" data-prompt="How much did I spend this month?">ðŸ“Š How much did I spend this month?</button>
          <button type="button" class="sombo-prompt-btn" data-prompt="What are my active budgets?">ðŸŽ¯ What are my active budgets?</button>
          <button type="button" class="sombo-prompt-btn" data-prompt="How are my savings goals progressing?">ðŸŒ± How are my savings goals doing?</button>
        </div>
      </div>
    `;
  }

  // â”€â”€ Apply profile to DOM â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  applyProfile(profile) {
    this.profile = { ...DEFAULT_BOT_PROFILE, ...profile };

    const root = this.containerEl;
    if (!root) return;

    // CSS accent variable
    root.style.setProperty("--sombo-accent", this.profile.accentColor);

    // Derived glow / light
    root.style.setProperty("--sombo-accent-glow", this.profile.accentColor + "66");
    root.style.setProperty("--sombo-accent-light", this.profile.accentColor + "20");

    // Style preset
    root.setAttribute("data-bot-style", this.profile.style);

    // Bot name in all text targets
    const name = this.escapeHTML(this.profile.name);
    if (this.badgeEl)      this.badgeEl.textContent      = this.profile.name;
    if (this.panelTitleEl) this.panelTitleEl.textContent  = this.profile.name;
    if (this.avatarBtnEl)  this.avatarBtnEl.setAttribute("aria-label", `Open Smore Assistant Chat with ${this.profile.name}`);

    // Rebuild welcome card so name updates
    this._buildWelcomeCard();
  }

  // â”€â”€ Events â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  _bindEvents() {
    // Close button
    document.getElementById("sombo-close-btn").addEventListener("click", () => this.closePanel());

    // Form submission
    document.getElementById("sombo-input-form").addEventListener("submit", (e) => {
      e.preventDefault();
      this.handleUserSubmit();
    });

    // Quick prompt buttons (delegated)
    this.chatBodyEl.addEventListener("click", (e) => {
      const btn = e.target.closest(".sombo-prompt-btn");
      if (btn && btn.dataset.prompt) {
        this.inputEl.value = btn.dataset.prompt;
        this.handleUserSubmit();
      }
    });

    // Escape key
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isOpen) this.closePanel();
    });

    // Hover wave
    this.avatarBtnEl.addEventListener("mouseenter", () => {
      if (!this.isOpen && !this.isThinking && !this._isDragging) {
        this.avatarBtnEl.classList.add("is-waving");
      }
    });
    this.avatarBtnEl.addEventListener("mouseleave", () => {
      this.avatarBtnEl.classList.remove("is-waving");
    });
  }

  // â”€â”€ Drag logic (Pointer Events â€” works for both mouse and touch) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  _bindDrag() {
    const btn = this.avatarBtnEl;
    const container = this.containerEl;

    const onPointerDown = (e) => {
      // Only primary pointer (left mouse or first touch)
      if (e.button !== undefined && e.button !== 0) return;

      btn.setPointerCapture(e.pointerId);
      this._isDragging    = false;
      this._totalTravel   = 0;

      const rect = container.getBoundingClientRect();
      this._dragStartX   = e.clientX;
      this._dragStartY   = e.clientY;
      this._originLeft   = rect.left;
      this._originBottom = window.innerHeight - rect.bottom;

      btn.classList.remove("is-drag-released");
      btn.addEventListener("pointermove", onPointerMove);
      btn.addEventListener("pointerup",   onPointerUp);
      btn.addEventListener("pointercancel", onPointerUp);
    };

    const onPointerMove = (e) => {
      const dx = e.clientX - this._dragStartX;
      const dy = e.clientY - this._dragStartY;
      this._totalTravel += Math.abs(dx) + Math.abs(dy);

      if (!this._isDragging && this._totalTravel > 6) {
        this._isDragging = true;
        btn.classList.add("is-dragging");
        // Stop idle animations during drag
        this.avatarBtnEl.classList.remove("is-waving");
      }

      if (!this._isDragging) return;

      // Compute new position (bottom/left based)
      const newLeft   = this._originLeft   + dx;
      const newBottom = this._originBottom  - dy;

      // Clamp to viewport
      const clamped = this._clampToViewport(newLeft, newBottom);
      container.style.left   = clamped.left   + "px";
      container.style.bottom = clamped.bottom + "px";
      container.style.right  = "auto";

      this._lastPosLeft   = clamped.left;
      this._lastPosBottom = clamped.bottom;
    };

    const onPointerUp = () => {
      btn.removeEventListener("pointermove", onPointerMove);
      btn.removeEventListener("pointerup",   onPointerUp);
      btn.removeEventListener("pointercancel", onPointerUp);

      if (this._isDragging) {
        btn.classList.remove("is-dragging");
        btn.classList.add("is-drag-released");
        setTimeout(() => btn.classList.remove("is-drag-released"), 500);

        // Save position to localStorage keyed by uid
        if (this.currentUser && this._lastPosLeft !== null) {
          this._savePosition(this.currentUser.uid, this._lastPosLeft, this._lastPosBottom);
        }
      } else {
        // Short tap â€” toggle panel
        this.togglePanel();
      }

      this._isDragging = false;
    };

    btn.addEventListener("pointerdown", onPointerDown);
  }

  _clampToViewport(left, bottom) {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const w = this.containerEl.offsetWidth  || 120;
    const h = this.containerEl.offsetHeight || 140;
    return {
      left:   Math.min(Math.max(0, left),   W - w),
      bottom: Math.min(Math.max(0, bottom), H - h),
    };
  }

  _savePosition(uid, left, bottom) {
    try {
      localStorage.setItem(`smore_bot_pos_${uid}`, JSON.stringify({ left, bottom }));
    } catch (_) { /* storage full / private mode â€” silently ignore */ }
  }

  _restorePosition(uid) {
    try {
      const raw = localStorage.getItem(`smore_bot_pos_${uid}`);
      if (!raw) return;
      const { left, bottom } = JSON.parse(raw);
      const clamped = this._clampToViewport(Number(left), Number(bottom));
      this.containerEl.style.left   = clamped.left   + "px";
      this.containerEl.style.bottom = clamped.bottom + "px";
      this.containerEl.style.right  = "auto";
    } catch (_) { /* corrupted data â€” silently ignore */ }
  }

  // â”€â”€ Sidebar "Customize my bot" link â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  _bindSidebarCustomizeLink() {
    // Runs after mount so DOM is ready.
    // Bind any existing #customizeBotNavBtn on the page.
    const link = document.getElementById("customizeBotNavBtn");
    if (link) {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        this.openCustomizeModal();
      });
    }
  }

  // â”€â”€ Onboarding modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  showOnboardingModal() {
    // Remove any stale overlay
    document.getElementById("sombo-onboard-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.id = "sombo-onboard-overlay";
    overlay.className = "sombo-onboard-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "sombo-onboard-title");

    overlay.innerHTML = `
      <div class="sombo-onboard-modal">
        <div class="sombo-onboard-header">
          <div class="sombo-onboard-avatar">${getSomboSVGMarkup("small")}</div>
          <h5 id="sombo-onboard-title">Meet Your Personal Finance Bot!</h5>
          <p>Smore lets you create a customised assistant. Give it a name, pick a style, and choose an accent color â€” or just use the default Sombo.</p>
        </div>

        <div class="sombo-onboard-form-group">
          <label class="sombo-onboard-label" for="onboard-bot-name">Bot name</label>
          <input class="sombo-onboard-input" type="text" id="onboard-bot-name"
                 maxlength="40" placeholder="Sombo" value="${this.escapeHTML(DEFAULT_BOT_PROFILE.name)}"/>
        </div>

        <div class="sombo-onboard-form-group">
          <label class="sombo-onboard-label">Appearance style</label>
          <div class="sombo-style-presets" id="onboard-style-presets">
            ${STYLE_PRESETS.map(p => `
              <button type="button" class="sombo-style-btn${p.id === DEFAULT_BOT_PROFILE.style ? " is-active" : ""}"
                      data-style="${p.id}">${p.label}</button>
            `).join("")}
          </div>
        </div>

        <div class="sombo-onboard-form-group">
          <label class="sombo-onboard-label" for="onboard-accent-color">Accent color</label>
          <div class="sombo-color-row">
            <input type="color" class="sombo-color-input" id="onboard-accent-color"
                   value="${DEFAULT_BOT_PROFILE.accentColor}"/>
            <span class="sombo-color-preview" id="onboard-color-preview">${DEFAULT_BOT_PROFILE.accentColor}</span>
          </div>
        </div>

        <div class="sombo-onboard-actions">
          <button type="button" class="sombo-btn-primary" id="onboard-create-btn">ðŸŽ¨ Create My Bot</button>
          <button type="button" class="sombo-btn-secondary" id="onboard-default-btn">Use Default Sombo</button>
          <button type="button" class="sombo-btn-ghost" id="onboard-later-btn">Remind me later</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Selected state tracking
    let selectedStyle = DEFAULT_BOT_PROFILE.style;

    // Style preset selection
    overlay.querySelectorAll(".sombo-style-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        overlay.querySelectorAll(".sombo-style-btn").forEach(b => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        selectedStyle = btn.dataset.style;
      });
    });

    // Color preview
    const colorInput = overlay.querySelector("#onboard-accent-color");
    const colorPreview = overlay.querySelector("#onboard-color-preview");
    colorInput.addEventListener("input", () => {
      colorPreview.textContent = colorInput.value;
    });

    // Create bot
    overlay.querySelector("#onboard-create-btn").addEventListener("click", async () => {
      const name  = overlay.querySelector("#onboard-bot-name").value.trim() || DEFAULT_BOT_PROFILE.name;
      const color = colorInput.value || DEFAULT_BOT_PROFILE.accentColor;
      await this._saveAndApplyProfile({ name, style: selectedStyle, accentColor: color });
      this._markOnboarded();
      overlay.remove();
    });

    // Use default
    overlay.querySelector("#onboard-default-btn").addEventListener("click", async () => {
      await this._saveAndApplyProfile(DEFAULT_BOT_PROFILE);
      this._markOnboarded();
      overlay.remove();
    });

    // Remind later â€” just dismiss without saving
    overlay.querySelector("#onboard-later-btn").addEventListener("click", () => {
      overlay.remove();
    });

    // Focus first input
    setTimeout(() => overlay.querySelector("#onboard-bot-name")?.focus(), 100);
  }

  _markOnboarded() {
    if (this.currentUser) {
      try {
        localStorage.setItem(`smore_bot_onboarded_${this.currentUser.uid}`, "1");
      } catch (_) {}
    }
  }

  _hasOnboarded() {
    if (!this.currentUser) return true; // don't show for unauthenticated
    try {
      return !!localStorage.getItem(`smore_bot_onboarded_${this.currentUser.uid}`);
    } catch (_) { return true; }
  }

  // â”€â”€ Customize modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  openCustomizeModal() {
    document.getElementById("sombo-customize-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.id = "sombo-customize-overlay";
    overlay.className = "sombo-customize-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "sombo-customize-title");

    const currentName  = this.profile.name;
    const currentStyle = this.profile.style;
    const currentColor = this.profile.accentColor;

    overlay.innerHTML = `
      <div class="sombo-customize-modal">
        <div class="sombo-customize-header">
          <h5 id="sombo-customize-title">Customize My Bot</h5>
          <button type="button" class="sombo-customize-close" id="customize-close-btn"
                  aria-label="Close customize panel">âœ•</button>
        </div>

        <!-- Live preview -->
        <div class="sombo-bot-preview" id="customize-preview">
          <div class="sombo-preview-svg">${getSomboSVGMarkup("small")}</div>
          <div class="sombo-preview-info">
            <div class="sombo-preview-name" id="preview-name">${this.escapeHTML(currentName)}</div>
            <div class="sombo-preview-style" id="preview-style-label">${STYLE_PRESETS.find(p => p.id === currentStyle)?.label || "Classic Sombo"}</div>
          </div>
          <div class="sombo-preview-dot" id="preview-dot" style="background:${currentColor}"></div>
        </div>

        <div class="sombo-onboard-form-group">
          <label class="sombo-onboard-label" for="customize-bot-name">Bot name</label>
          <input class="sombo-onboard-input" type="text" id="customize-bot-name"
                 maxlength="40" placeholder="Sombo" value="${this.escapeHTML(currentName)}"/>
        </div>

        <div class="sombo-onboard-form-group">
          <label class="sombo-onboard-label">Appearance style</label>
          <div class="sombo-style-presets" id="customize-style-presets">
            ${STYLE_PRESETS.map(p => `
              <button type="button" class="sombo-style-btn${p.id === currentStyle ? " is-active" : ""}"
                      data-style="${p.id}">${p.label}</button>
            `).join("")}
          </div>
        </div>

        <div class="sombo-onboard-form-group">
          <label class="sombo-onboard-label" for="customize-accent-color">Accent color</label>
          <div class="sombo-color-row">
            <input type="color" class="sombo-color-input" id="customize-accent-color"
                   value="${currentColor}"/>
            <span class="sombo-color-preview" id="customize-color-preview">${currentColor}</span>
          </div>
        </div>

        <div class="sombo-customize-actions">
          <button type="button" class="sombo-btn-primary" id="customize-save-btn">Save Changes</button>
          <button type="button" class="sombo-btn-secondary" id="customize-reset-btn">Reset to Sombo</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    let selectedStyle = currentStyle;

    // Live name preview
    const nameInput    = overlay.querySelector("#customize-bot-name");
    const previewName  = overlay.querySelector("#preview-name");
    nameInput.addEventListener("input", () => {
      previewName.textContent = nameInput.value || "Sombo";
    });

    // Style selection + preview label
    const previewStyleLabel = overlay.querySelector("#preview-style-label");
    overlay.querySelectorAll(".sombo-style-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        overlay.querySelectorAll(".sombo-style-btn").forEach(b => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        selectedStyle = btn.dataset.style;
        previewStyleLabel.textContent = STYLE_PRESETS.find(p => p.id === selectedStyle)?.label || selectedStyle;
      });
    });

    // Color preview
    const colorInput   = overlay.querySelector("#customize-accent-color");
    const colorPreview = overlay.querySelector("#customize-color-preview");
    const previewDot   = overlay.querySelector("#preview-dot");
    colorInput.addEventListener("input", () => {
      colorPreview.textContent = colorInput.value;
      previewDot.style.background = colorInput.value;
    });

    // Close
    overlay.querySelector("#customize-close-btn").addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

    // Save
    overlay.querySelector("#customize-save-btn").addEventListener("click", async () => {
      const name  = nameInput.value.trim() || DEFAULT_BOT_PROFILE.name;
      const color = colorInput.value || DEFAULT_BOT_PROFILE.accentColor;
      await this._saveAndApplyProfile({ name, style: selectedStyle, accentColor: color });
      overlay.remove();
    });

    // Reset
    overlay.querySelector("#customize-reset-btn").addEventListener("click", async () => {
      if (!this.currentUser) return;
      await resetBotProfile(this.currentUser.uid);
      this.applyProfile(DEFAULT_BOT_PROFILE);
      overlay.remove();
    });

    setTimeout(() => nameInput?.focus(), 100);
  }

  async _saveAndApplyProfile(data) {
    if (!this.currentUser) return;
    try {
      await saveBotProfile(this.currentUser.uid, data);
      this.applyProfile(data);
    } catch (err) {
      console.warn("[SomboWidget] Could not save profile:", err.message);
      // Apply locally even if Firestore write failed
      this.applyProfile(data);
    }
  }

  // â”€â”€ Panel open/close â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  togglePanel() {
    if (this.isOpen) this.closePanel();
    else this.openPanel();
  }

  openPanel() {
    this.isOpen = true;
    this.panelEl.classList.add("is-open");
    this.avatarBtnEl.setAttribute("aria-expanded", "true");
    this.avatarBtnEl.classList.add("is-leaning", "is-waving");
    setTimeout(() => this.avatarBtnEl.classList.remove("is-waving"), 1200);
    setTimeout(() => this.inputEl?.focus(), 200);
    if (!this.currentUser) this.renderUnauthenticatedState();
  }

  closePanel() {
    this.isOpen = false;
    this.panelEl.classList.remove("is-open");
    this.avatarBtnEl.setAttribute("aria-expanded", "false");
    this.avatarBtnEl.classList.remove("is-leaning");
  }

  // â”€â”€ Auth state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  setUser(user) {
    this.currentUser = user;
    if (user) {
      this.chatBodyEl?.querySelectorAll(".sombo-state-banner.is-unauth").forEach(b => b.remove());
      this._restorePosition(user.uid);
    } else if (this.isOpen) {
      this.renderUnauthenticatedState();
    }
  }

  // â”€â”€ Submit question â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async handleUserSubmit() {
    const questionText = this.inputEl.value.trim();
    if (!questionText || this.isThinking) return;

    if (!this.currentUser) {
      this.renderUnauthenticatedState();
      return;
    }

    this.appendUserMessage(questionText);
    this.inputEl.value = "";
    this.setThinkingState(true);

    try {
      const token = await this.currentUser.getIdToken(true);
      const res = await fetch(GATEWAY_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ question: questionText }),
      });

      const data = await res.json();

      if (res.ok && data.answer) {
        this.appendBotMessage(data.answer);
        this.triggerHappyAnimation();
      } else {
        const errorCode = data?.error?.code;
        const errorMsg  = data?.error?.message;
        if (res.status === 422 && errorCode === "out_of_scope") {
          this.renderBlockedTopicState(errorMsg || "I can only help with your personal finance data on Smore.");
        } else if (res.status === 401) {
          this.renderUnauthenticatedState();
        } else {
          this.renderErrorState(errorMsg || "Could not fetch advice from Smore Assistant. Please try again.");
        }
      }
    } catch (err) {
      console.error("[Sombo] Gateway fetch error:", err);
      this.renderErrorState("Unable to reach the Smore Assistant gateway. Make sure the server is online.");
    } finally {
      this.setThinkingState(false);
    }
  }

  // â”€â”€ Thinking state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  setThinkingState(isThinking) {
    this.isThinking = isThinking;
    this.sendBtnEl.disabled = isThinking;
    this.inputEl.disabled   = isThinking;

    if (isThinking) {
      this.avatarBtnEl.classList.add("is-thinking");
      this.statusDotEl.classList.add("is-thinking");
      this.statusTextEl.textContent = "Thinking...";
      this.showTypingIndicator();
    } else {
      this.avatarBtnEl.classList.remove("is-thinking");
      this.statusDotEl.classList.remove("is-thinking");
      this.statusTextEl.textContent = "Smore Assistant";
      this.hideTypingIndicator();
    }
  }

  triggerHappyAnimation() {
    this.avatarBtnEl.classList.add("is-happy");
    setTimeout(() => this.avatarBtnEl.classList.remove("is-happy"), 1200);
  }

  // â”€â”€ Messages â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  appendUserMessage(text) {
    const msgEl = document.createElement("div");
    msgEl.className = "sombo-msg sombo-msg-user";
    const timeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    msgEl.innerHTML = `
      <div class="sombo-msg-bubble">${this.escapeHTML(text)}</div>
      <div class="sombo-msg-time">${timeStr}</div>
    `;
    this.chatBodyEl.appendChild(msgEl);
    this.scrollToBottom();
  }

  appendBotMessage(text) {
    const msgEl = document.createElement("div");
    msgEl.className = "sombo-msg sombo-msg-bot";
    const timeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    msgEl.innerHTML = `
      <div class="sombo-msg-bubble">${this.formatMarkdown(text)}</div>
      <div class="sombo-msg-time">${this.escapeHTML(this.profile.name)} â€¢ ${timeStr}</div>
    `;
    this.chatBodyEl.appendChild(msgEl);
    this.scrollToBottom();
  }

  showTypingIndicator() {
    this.hideTypingIndicator();
    const el = document.createElement("div");
    el.id = "sombo-typing-indicator";
    el.className = "sombo-typing-indicator";
    el.innerHTML = `
      <span class="sombo-typing-dot"></span>
      <span class="sombo-typing-dot"></span>
      <span class="sombo-typing-dot"></span>
    `;
    this.chatBodyEl.appendChild(el);
    this.scrollToBottom();
  }

  hideTypingIndicator() {
    document.getElementById("sombo-typing-indicator")?.remove();
  }

  // â”€â”€ State banners â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  renderErrorState(message) {
    const b = document.createElement("div");
    b.className = "sombo-state-banner is-error";
    b.innerHTML = `<span aria-hidden="true">âš ï¸</span><div><strong>Assistant error:</strong> ${this.escapeHTML(message)}</div>`;
    this.chatBodyEl.appendChild(b);
    this.scrollToBottom();
  }

  renderBlockedTopicState(message) {
    const b = document.createElement("div");
    b.className = "sombo-state-banner is-blocked";
    b.innerHTML = `<span aria-hidden="true">ðŸ›¡ï¸</span><div><strong>Out of scope question:</strong> ${this.escapeHTML(message)}</div>`;
    this.chatBodyEl.appendChild(b);
    this.scrollToBottom();
  }

  renderUnauthenticatedState() {
    const b = document.createElement("div");
    b.className = "sombo-state-banner is-unauth";
    b.innerHTML = `<span aria-hidden="true">ðŸ”’</span><div><strong>Session expired:</strong> Please sign in to ask ${this.escapeHTML(this.profile.name)} about your financial data.</div>`;
    this.chatBodyEl.appendChild(b);
    this.scrollToBottom();
  }

  // â”€â”€ Utilities â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  scrollToBottom() {
    this.chatBodyEl.scrollTop = this.chatBodyEl.scrollHeight;
  }

  escapeHTML(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  formatMarkdown(str) {
    return this.escapeHTML(str)
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\n/g, "<br>");
  }
}

// â”€â”€â”€ Singleton â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let widgetInstance = null;

/**
 * Initializes Sombo assistant on authenticated pages.
 * Loads the user's bot profile from Firestore, shows onboarding if needed.
 */
export async function initSomboAssistant(user) {
  if (!widgetInstance) {
    widgetInstance = new SomboAssistantWidget();
    widgetInstance.mount();
  }
  widgetInstance.setUser(user);

  if (user) {
    // Load profile from Firestore
    const profile = await loadBotProfile(user.uid);

    if (profile) {
      widgetInstance.applyProfile(profile);
    } else {
      // Apply defaults visually
      widgetInstance.applyProfile(DEFAULT_BOT_PROFILE);
      // Show onboarding if not already dismissed
      if (!widgetInstance._hasOnboarded()) {
        // Small delay so the page is settled
        setTimeout(() => widgetInstance.showOnboardingModal(), 800);
      }
    }
  }

  return widgetInstance;
}

/**
 * Destroys/removes widget state on logout.
 */
export function destroySomboAssistant() {
  const root = document.getElementById("sombo-widget-root");
  if (root) root.remove();
  document.getElementById("sombo-onboard-overlay")?.remove();
  document.getElementById("sombo-customize-overlay")?.remove();
  widgetInstance = null;
}
