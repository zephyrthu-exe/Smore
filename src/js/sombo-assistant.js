/**
 * Sombo Companion & Smore Assistant Integration
 *
 * Provides an animated floating robotic companion (Sombo) and a responsive AI
 * financial assistant chat panel connected to the secure VPS Gemini gateway.
 */

import { auth } from "./firebase-config.js";

// Endpoint for the Smore Assistant VPS Gateway
const GATEWAY_URL = window.SMORE_GATEWAY_URL || "http://localhost:8080/api/assistant";

/**
 * Returns inline SVG representation of Sombo.
 * Designed with a friendly silhouette, dark navy body, warm orange and cream accents,
 * large expressive digital eyes, glowing antenna, and glowing "S" chest emblem.
 */
function getSomboSVGMarkup() {
  return `
    <svg class="sombo-svg" viewBox="0 0 96 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Sombo the robot assistant avatar">
      <defs>
        <!-- Body Gradient -->
        <linearGradient id="sombo-body-grad" x1="16" y1="20" x2="80" y2="90" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#334155"/>
          <stop offset="45%" stop-color="#1E293B"/>
          <stop offset="100%" stop-color="#0F172A"/>
        </linearGradient>

        <!-- Head Gradient -->
        <linearGradient id="sombo-head-grad" x1="20" y1="10" x2="76" y2="55" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#475569"/>
          <stop offset="50%" stop-color="#1E293B"/>
          <stop offset="100%" stop-color="#0F172A"/>
        </linearGradient>

        <!-- Cream Accent Gradient -->
        <linearGradient id="sombo-cream-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#FFF8F0"/>
          <stop offset="100%" stop-color="#FEF3C7"/>
        </linearGradient>

        <!-- Orange Accent Gradient -->
        <linearGradient id="sombo-orange-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#FF8C5A"/>
          <stop offset="100%" stop-color="#FF6B35"/>
        </linearGradient>

        <!-- Eye Screen Gradient -->
        <linearGradient id="sombo-screen-grad" x1="24" y1="20" x2="72" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#0B132B"/>
          <stop offset="100%" stop-color="#1C2541"/>
        </linearGradient>

        <!-- Chest Badge Glow Filter -->
        <filter id="sombo-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      <!-- Antenna -->
      <g class="sombo-antenna-group">
        <rect x="46" y="6" width="4" height="12" rx="2" fill="#94A3B8" />
        <circle class="sombo-antenna-tip" cx="48" cy="6" r="5" fill="#FF6B35" filter="url(#sombo-glow)" />
      </g>

      <!-- Body Base Group (for breathing animation) -->
      <g class="sombo-body-group">
        <!-- Left Arm -->
        <g class="sombo-arm-left">
          <rect x="12" y="52" width="10" height="20" rx="5" fill="#334155" />
          <circle cx="17" cy="69" r="4.5" fill="url(#sombo-orange-grad)" />
        </g>

        <!-- Right Arm -->
        <g class="sombo-arm-right">
          <rect x="74" y="52" width="10" height="20" rx="5" fill="#334155" />
          <circle cx="79" cy="69" r="4.5" fill="url(#sombo-orange-grad)" />
        </g>

        <!-- Legs -->
        <rect x="32" y="80" width="10" height="13" rx="4" fill="#1E293B" />
        <rect x="54" y="80" width="10" height="13" rx="4" fill="#1E293B" />
        <ellipse cx="37" cy="92" rx="6.5" ry="3.5" fill="#FF6B35" />
        <ellipse cx="59" cy="92" rx="6.5" ry="3.5" fill="#FF6B35" />

        <!-- Torso / Main Body -->
        <rect x="22" y="46" width="52" height="38" rx="18" fill="url(#sombo-body-grad)" stroke="#475569" stroke-width="1.5" />

        <!-- Cream Belly Accent -->
        <rect x="28" y="50" width="40" height="28" rx="12" fill="url(#sombo-cream-grad)" opacity="0.9" />

        <!-- Chest Glowing Emblem ("S") -->
        <g class="sombo-emblem-group" transform="translate(48, 64)">
          <circle cx="0" cy="0" r="10" fill="#1E293B" />
          <circle class="sombo-emblem-glow" cx="0" cy="0" r="8.5" fill="#FF6B35" opacity="0.9" filter="url(#sombo-glow)" />
          <!-- "S" symbol -->
          <path d="M 2.5 -4.5 C 2.5 -5.8 -0.5 -6.2 -2.5 -5 C -4 -4 -3.5 -1.5 -0.5 -0.5 C 2.5 0.5 3 3 1.5 4.5 C -0.5 6 -3.5 5.5 -3.5 4" 
                fill="none" stroke="#FFF8F0" stroke-width="2.2" stroke-linecap="round" />
        </g>

        <!-- Head Shell -->
        <rect x="18" y="16" width="60" height="34" rx="16" fill="url(#sombo-head-grad)" stroke="#475569" stroke-width="1.5" />

        <!-- Head Ears / Side Accent Rings -->
        <rect x="14" y="27" width="5" height="12" rx="2.5" fill="#FF6B35" />
        <rect x="77" y="27" width="5" height="12" rx="2.5" fill="#FF6B35" />

        <!-- Digital Face Screen -->
        <rect x="24" y="20" width="48" height="25" rx="11" fill="url(#sombo-screen-grad)" stroke="#334155" stroke-width="1" />

        <!-- Expressive Digital Eyes -->
        <g class="sombo-eyes-group">
          <!-- Left Eye -->
          <ellipse class="sombo-eye" cx="37" cy="32.5" rx="5.5" ry="6.5" fill="#38BDF8" filter="url(#sombo-glow)" />
          <circle cx="38.5" cy="30.5" r="2" fill="#FFFFFF" />

          <!-- Right Eye -->
          <ellipse class="sombo-eye" cx="59" cy="32.5" rx="5.5" ry="6.5" fill="#38BDF8" filter="url(#sombo-glow)" />
          <circle cx="60.5" cy="30.5" r="2" fill="#FFFFFF" />
        </g>
      </g>
    </svg>
    <div class="sombo-shadow"></div>
  `;
}

class SomboAssistantWidget {
  constructor() {
    this.containerEl = null;
    this.avatarBtnEl = null;
    this.panelEl = null;
    this.chatBodyEl = null;
    this.inputEl = null;
    this.sendBtnEl = null;
    this.statusDotEl = null;
    this.statusTextEl = null;
    this.isOpen = false;
    this.isThinking = false;
    this.currentUser = null;
    this.messages = [];
  }

  /**
   * Builds and inserts the widget into the DOM.
   */
  mount() {
    if (document.getElementById("sombo-widget-root")) {
      return;
    }

    const root = document.createElement("div");
    root.id = "sombo-widget-root";
    root.className = "sombo-widget-container";

    root.innerHTML = `
      <!-- Sombo Floating Companion Button -->
      <button 
        id="sombo-avatar-btn" 
        class="sombo-avatar-btn" 
        type="button"
        aria-label="Open Smore Assistant Chat with Sombo" 
        aria-expanded="false"
        aria-controls="sombo-chat-panel"
      >
        <span class="sombo-badge">Ask Sombo</span>
        ${getSomboSVGMarkup()}
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
                <rect x="22" y="46" width="52" height="38" rx="18" fill="#1E293B" />
                <rect x="18" y="16" width="60" height="34" rx="16" fill="#1E293B" stroke="#FF6B35" stroke-width="2" />
                <ellipse cx="37" cy="32.5" rx="5" ry="6" fill="#38BDF8" />
                <ellipse cx="59" cy="32.5" rx="5" ry="6" fill="#38BDF8" />
              </svg>
            </div>
            <div>
              <h2 id="sombo-panel-title" class="sombo-header-title">Sombo</h2>
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
          >
            ✕
          </button>
        </header>

        <!-- Message Body -->
        <div id="sombo-chat-body" class="sombo-chat-body" aria-live="polite" aria-relevant="additions">
          <!-- Initial Welcome Card -->
          <div class="sombo-welcome-card">
            <div class="sombo-welcome-icon">
              <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="24" cy="24" r="22" fill="#FFF8F0" stroke="#FF6B35" stroke-width="2" />
                <path d="M16 26C16 26 20 31 24 31C28 31 32 26 32 26" stroke="#FF6B35" stroke-width="2.5" stroke-linecap="round" />
                <circle cx="17" cy="19" r="3" fill="#1E293B" />
                <circle cx="31" cy="19" r="3" fill="#1E293B" />
              </svg>
            </div>
            <h6>Hi! I'm Sombo 👋</h6>
            <p>Your friendly Smore financial companion. Ask me about your spending, budgets, or savings goals!</p>
            
            <div class="sombo-prompts-title">Try asking me:</div>
            <div class="sombo-prompts-list">
              <button type="button" class="sombo-prompt-btn" data-prompt="What is my available balance?">
                💰 What is my available balance?
              </button>
              <button type="button" class="sombo-prompt-btn" data-prompt="How much did I spend this month?">
                📊 How much did I spend this month?
              </button>
              <button type="button" class="sombo-prompt-btn" data-prompt="What are my active budgets?">
                🎯 What are my active budgets?
              </button>
              <button type="button" class="sombo-prompt-btn" data-prompt="How are my savings goals progressing?">
                🌱 How are my savings goals doing?
              </button>
            </div>
          </div>
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
              <svg viewBox="0 0 24 24">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
              </svg>
            </button>
          </form>
          <p class="sombo-disclaimer">Smore Assistant interprets your logged transactions deterministically.</p>
        </footer>
      </div>
    `;

    document.body.appendChild(root);

    // Cache elements
    this.containerEl = root;
    this.avatarBtnEl = document.getElementById("sombo-avatar-btn");
    this.panelEl = document.getElementById("sombo-chat-panel");
    this.chatBodyEl = document.getElementById("sombo-chat-body");
    this.inputEl = document.getElementById("sombo-input-field");
    this.sendBtnEl = document.getElementById("sombo-send-btn");
    this.statusDotEl = document.getElementById("sombo-status-dot");
    this.statusTextEl = document.getElementById("sombo-status-text");

    this.bindEvents();
  }

  /**
   * Attaches event listeners.
   */
  bindEvents() {
    // Open / toggle chat on avatar click
    this.avatarBtnEl.addEventListener("click", () => {
      this.togglePanel();
    });

    // Close button
    document.getElementById("sombo-close-btn").addEventListener("click", () => {
      this.closePanel();
    });

    // Form submission
    document.getElementById("sombo-input-form").addEventListener("submit", (e) => {
      e.preventDefault();
      this.handleUserSubmit();
    });

    // Quick prompt buttons
    this.chatBodyEl.addEventListener("click", (e) => {
      const btn = e.target.closest(".sombo-prompt-btn");
      if (btn && btn.dataset.prompt) {
        this.inputEl.value = btn.dataset.prompt;
        this.handleUserSubmit();
      }
    });

    // Close on Escape key press
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isOpen) {
        this.closePanel();
      }
    });

    // Playful hover waving trigger
    this.avatarBtnEl.addEventListener("mouseenter", () => {
      if (!this.isOpen && !this.isThinking) {
        this.avatarBtnEl.classList.add("is-waving");
      }
    });
    this.avatarBtnEl.addEventListener("mouseleave", () => {
      this.avatarBtnEl.classList.remove("is-waving");
    });
  }

  /**
   * Sets current auth user context.
   */
  setUser(user) {
    this.currentUser = user;
    if (!user && this.isOpen) {
      this.renderUnauthenticatedState();
    }
  }

  /**
   * Opens or closes the panel.
   */
  togglePanel() {
    if (this.isOpen) {
      this.closePanel();
    } else {
      this.openPanel();
    }
  }

  openPanel() {
    this.isOpen = true;
    this.panelEl.classList.add("is-open");
    this.avatarBtnEl.setAttribute("aria-expanded", "true");
    this.avatarBtnEl.classList.add("is-leaning", "is-waving");

    // Remove waving class after gesture finishes
    setTimeout(() => {
      this.avatarBtnEl.classList.remove("is-waving");
    }, 1200);

    // Focus input field
    setTimeout(() => {
      this.inputEl.focus();
    }, 200);

    if (!this.currentUser) {
      this.renderUnauthenticatedState();
    }
  }

  closePanel() {
    this.isOpen = false;
    this.panelEl.classList.remove("is-open");
    this.avatarBtnEl.setAttribute("aria-expanded", "false");
    this.avatarBtnEl.classList.remove("is-leaning");
  }

  /**
   * Handles user question submission.
   */
  async handleUserSubmit() {
    const questionText = this.inputEl.value.trim();
    if (!questionText || this.isThinking) return;

    if (!this.currentUser) {
      this.renderUnauthenticatedState();
      return;
    }

    // 1) Add user message bubble
    this.appendUserMessage(questionText);
    this.inputEl.value = "";

    // 2) Set Sombo state to thinking
    this.setThinkingState(true);

    try {
      // 3) Get Firebase Auth ID token
      const idToken = await this.currentUser.getIdToken();

      // 4) POST to VPS Gateway
      const res = await fetch(GATEWAY_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ question: questionText }),
      });

      const data = await res.json();

      if (res.ok && data.answer) {
        // Success response
        this.appendBotMessage(data.answer);
        this.triggerHappyAnimation();
      } else {
        // Handle API errors cleanly
        const errorCode = data && data.error && data.error.code;
        const errorMsg = data && data.error && data.error.message;

        if (res.status === 403 && errorCode === "out_of_scope") {
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

  /**
   * Updates state to thinking or idle.
   */
  setThinkingState(isThinking) {
    this.isThinking = isThinking;
    this.sendBtnEl.disabled = isThinking;
    this.inputEl.disabled = isThinking;

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

  /**
   * Happy animation trigger on good response.
   */
  triggerHappyAnimation() {
    this.avatarBtnEl.classList.add("is-happy");
    setTimeout(() => {
      this.avatarBtnEl.classList.remove("is-happy");
    }, 1200);
  }

  /**
   * Appends user message bubble.
   */
  appendUserMessage(text) {
    const msgEl = document.createElement("div");
    msgEl.className = "sombo-msg sombo-msg-user";
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    msgEl.innerHTML = `
      <div class="sombo-msg-bubble">${this.escapeHTML(text)}</div>
      <div class="sombo-msg-time">${timeStr}</div>
    `;

    this.chatBodyEl.appendChild(msgEl);
    this.scrollToBottom();
  }

  /**
   * Appends assistant bot response.
   */
  appendBotMessage(text) {
    const msgEl = document.createElement("div");
    msgEl.className = "sombo-msg sombo-msg-bot";
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Format paragraphs & bullet lists simply
    const formattedText = this.formatMarkdown(text);

    msgEl.innerHTML = `
      <div class="sombo-msg-bubble">${formattedText}</div>
      <div class="sombo-msg-time">Sombo • ${timeStr}</div>
    `;

    this.chatBodyEl.appendChild(msgEl);
    this.scrollToBottom();
  }

  /**
   * Displays loading typing indicator.
   */
  showTypingIndicator() {
    this.hideTypingIndicator(); // Ensure no duplicates
    const typingEl = document.createElement("div");
    typingEl.id = "sombo-typing-indicator";
    typingEl.className = "sombo-typing-indicator";
    typingEl.innerHTML = `
      <span class="sombo-typing-dot"></span>
      <span class="sombo-typing-dot"></span>
      <span class="sombo-typing-dot"></span>
    `;
    this.chatBodyEl.appendChild(typingEl);
    this.scrollToBottom();
  }

  hideTypingIndicator() {
    const el = document.getElementById("sombo-typing-indicator");
    if (el) el.remove();
  }

  /**
   * Render state banners.
   */
  renderErrorState(message) {
    const banner = document.createElement("div");
    banner.className = "sombo-state-banner is-error";
    banner.innerHTML = `
      <span aria-hidden="true">⚠️</span>
      <div>
        <strong>Assistant error:</strong> ${this.escapeHTML(message)}
      </div>
    `;
    this.chatBodyEl.appendChild(banner);
    this.scrollToBottom();
  }

  renderBlockedTopicState(message) {
    const banner = document.createElement("div");
    banner.className = "sombo-state-banner is-blocked";
    banner.innerHTML = `
      <span aria-hidden="true">🛡️</span>
      <div>
        <strong>Out of scope question:</strong> ${this.escapeHTML(message)}
      </div>
    `;
    this.chatBodyEl.appendChild(banner);
    this.scrollToBottom();
  }

  renderUnauthenticatedState() {
    const banner = document.createElement("div");
    banner.className = "sombo-state-banner is-unauth";
    banner.innerHTML = `
      <span aria-hidden="true">🔒</span>
      <div>
        <strong>Session expired:</strong> Please sign in to ask Sombo about your financial data.
      </div>
    `;
    this.chatBodyEl.appendChild(banner);
    this.scrollToBottom();
  }

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
    const escaped = this.escapeHTML(str);
    // Convert bold **text** to <strong>text</strong>
    let formatted = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Convert newlines to <br>
    formatted = formatted.replace(/\n/g, '<br>');
    return formatted;
  }
}

// Singleton widget instance
let widgetInstance = null;

/**
 * Initializes Sombo assistant on authenticated pages.
 */
export function initSomboAssistant(user) {
  if (!widgetInstance) {
    widgetInstance = new SomboAssistantWidget();
    widgetInstance.mount();
  }
  widgetInstance.setUser(user);
  return widgetInstance;
}

/**
 * Destroys/removes widget state on logout.
 */
export function destroySomboAssistant() {
  const root = document.getElementById("sombo-widget-root");
  if (root) {
    root.remove();
  }
  widgetInstance = null;
}
