/**
 * password-rules.js
 * Centralized strong password policy, validation regex, UI feedback, and generator.
 */

// Must contain at least 8 characters, 1 lowercase, 1 uppercase, 1 digit, and 1 special/symbol
export const STRONG_PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

export const PASSWORD_CRITERIA = [
  { key: "length", label: "At least 8 characters", test: (p) => p.length >= 8 },
  { key: "upper", label: "Uppercase letter (A-Z)", test: (p) => /[A-Z]/.test(p) },
  { key: "lower", label: "Lowercase letter (a-z)", test: (p) => /[a-z]/.test(p) },
  { key: "number", label: "Number (0-9)", test: (p) => /\d/.test(p) },
  { key: "special", label: "Special character or symbol (!@#$...)", test: (p) => /[^A-Za-z0-9]/.test(p) },
];

/**
 * Validates a password against all strength requirements.
 * @param {string} password
 * @returns {{ isValid: boolean, results: Record<string, boolean> }}
 */
export function checkPasswordStrength(password = "") {
  const pwd = String(password || "");
  const results = {};
  for (const criterion of PASSWORD_CRITERIA) {
    results[criterion.key] = criterion.test(pwd);
  }
  const isValid = Object.values(results).every(Boolean);
  return { isValid, results };
}

/**
 * Generates a cryptographically strong random password guaranteed to pass all criteria.
 * @param {number} length Default is 14 characters
 * @returns {string}
 */
export function generateStrongPassword(length = 14) {
  const uppers = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lowers = "abcdefghijkmnopqrstuvwxyz";
  const numbers = "23456789";
  const specials = "!@#$%^&*()_+-=";
  const allChars = uppers + lowers + numbers + specials;

  const cryptoObj = (typeof window !== "undefined" ? (window.crypto || window.msCrypto) : null) || (typeof crypto !== "undefined" ? crypto : null);
  const getRandomChar = (charset) => {
    if (cryptoObj && cryptoObj.getRandomValues) {
      const arr = new Uint32Array(1);
      cryptoObj.getRandomValues(arr);
      return charset[arr[0] % charset.length];
    }
    return charset[Math.floor(Math.random() * charset.length)];
  };

  // Guarantee at least one of each required class
  const chars = [
    getRandomChar(uppers),
    getRandomChar(lowers),
    getRandomChar(numbers),
    getRandomChar(specials),
  ];

  for (let i = chars.length; i < length; i++) {
    chars.push(getRandomChar(allChars));
  }

  // Fisher-Yates shuffle
  for (let i = chars.length - 1; i > 0; i--) {
    let j;
    if (cryptoObj && cryptoObj.getRandomValues) {
      const arr = new Uint32Array(1);
      cryptoObj.getRandomValues(arr);
      j = arr[0] % (i + 1);
    } else {
      j = Math.floor(Math.random() * (i + 1));
    }
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join("");
}

/**
 * Returns HTML markup for the password requirements checklist.
 * @param {string} containerId
 * @returns {string}
 */
export function getPasswordChecklistMarkup(containerId = "passwordChecklist") {
  return `
    <div class="password-checklist mt-2" id="${containerId}" aria-live="polite">
      <div class="password-checklist-title">Password must contain:</div>
      <ul class="password-checklist-items list-unstyled m-0">
        <li class="password-req-item" data-req="length">
          <i class="bi bi-circle"></i> <span>At least 8 characters</span>
        </li>
        <li class="password-req-item" data-req="upper">
          <i class="bi bi-circle"></i> <span>Uppercase letter (A-Z)</span>
        </li>
        <li class="password-req-item" data-req="lower">
          <i class="bi bi-circle"></i> <span>Lowercase letter (a-z)</span>
        </li>
        <li class="password-req-item" data-req="number">
          <i class="bi bi-circle"></i> <span>At least 1 number (0-9)</span>
        </li>
        <li class="password-req-item" data-req="special">
          <i class="bi bi-circle"></i> <span>Special character / symbol (!@#$...)</span>
        </li>
      </ul>
    </div>
  `;
}

/**
 * Updates the checklist DOM elements based on the password value.
 * @param {HTMLElement|string} container Element or selector
 * @param {string} password
 */
export function updatePasswordChecklist(container, password = "") {
  const root = typeof container === "string" ? document.querySelector(container) : container;
  if (!root) return;

  const { results } = checkPasswordStrength(password);
  const items = root.querySelectorAll(".password-req-item[data-req]");

  items.forEach((item) => {
    const key = item.getAttribute("data-req");
    const isMet = Boolean(results[key]);
    item.classList.toggle("is-met", isMet);
    const icon = item.querySelector("i");
    if (icon) {
      icon.className = isMet ? "bi bi-check-circle-fill text-success" : "bi bi-circle";
    }
  });
}

/**
 * Binds input events, suggestion generation, and show/hide toggling.
 * @param {object} config
 * @param {HTMLInputElement} config.input Password input
 * @param {HTMLInputElement} [config.confirmInput] Optional confirm password input
 * @param {HTMLElement} config.checklist Container element for checklist
 * @param {HTMLButtonElement} [config.suggestBtn] Button to trigger suggestion
 * @param {HTMLButtonElement} [config.toggleBtn] Optional show/hide toggle button
 * @param {HTMLElement} [config.toastEl] Optional element to show "Suggested password filled"
 */
export function bindPasswordRulesUI({ input, confirmInput, checklist, suggestBtn, toggleBtn, toastEl }) {
  if (!input) return;

  const update = () => {
    if (checklist) {
      updatePasswordChecklist(checklist, input.value);
    }
  };

  input.addEventListener("input", update);
  input.addEventListener("change", update);

  if (suggestBtn) {
    suggestBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const generated = generateStrongPassword(14);
      input.value = generated;
      if (confirmInput) {
        confirmInput.value = generated;
      }
      // Trigger input event to update checklist and any validity states
      input.dispatchEvent(new Event("input", { bubbles: true }));
      if (confirmInput) {
        confirmInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
      
      // Reveal password type to text so user can see what was generated
      input.type = "text";
      if (confirmInput) confirmInput.type = "text";
      if (toggleBtn) {
        const icon = toggleBtn.querySelector("i");
        if (icon) {
          icon.className = "bi bi-eye-slash";
        }
      }

      if (toastEl) {
        toastEl.textContent = "Strong password suggested & filled!";
        toastEl.classList.remove("d-none");
        window.setTimeout(() => {
          toastEl.classList.add("d-none");
        }, 3000);
      }
    });
  }

  if (toggleBtn) {
    toggleBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const isPassword = input.type === "password";
      input.type = isPassword ? "text" : "password";
      if (confirmInput) {
        confirmInput.type = isPassword ? "text" : "password";
      }
      const icon = toggleBtn.querySelector("i");
      if (icon) {
        icon.className = isPassword ? "bi bi-eye-slash" : "bi bi-eye";
      }
    });
  }

  // Initial update
  update();
}
