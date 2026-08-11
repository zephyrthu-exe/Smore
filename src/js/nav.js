/* ==========================================================================
   Smore — Dashboard Behaviour
   Handles dynamic interactivity, currency changes, and modal/drawer logic.
   ========================================================================== */

document.addEventListener("DOMContentLoaded", function () {
  initAskSmoreDrawer();
  initBudgetProgressTooltips();
  listenToCurrencyChanges();
});

/**
 * 1. Floating "Ask Smore" Action Button / AI Assistant Modal Trigger
 */
function initAskSmoreDrawer() {
  const fabBtn = document.querySelector(".fab-ask");
  if (!fabBtn) return;

  fabBtn.addEventListener("click", function () {
    // Check if Assistant page redirect or offcanvas drawer
    if (window.innerWidth < 768) {
      window.location.href = "assistant.html";
    } else {
      openAssistantModal();
    }
  });
}

function openAssistantModal() {
  // Simple quick-prompt dialog for AI Assistant
  const userPrompt = prompt("Ask Smore Assistant a financial question (e.g., 'How much did I spend on dining?'):");
  if (userPrompt && userPrompt.trim() !== "") {
    alert(`Smore Assistant: Analyzing your data for "${userPrompt}"...`);
  }
}

/**
 * 2. Add Bootstrap tooltips to budget progress bars for precise visual feedback
 */
function initBudgetProgressTooltips() {
  const progressBars = document.querySelectorAll(".progress-bar");
  progressBars.forEach((bar) => {
    const percentage = bar.style.width;
    bar.setAttribute("data-bs-toggle", "tooltip");
    bar.setAttribute("data-bs-placement", "top");
    bar.setAttribute("title", `Used ${percentage} of monthly budget`);
  });

  // Initialize Bootstrap 5 tooltips if Bootstrap JS bundle is available
  if (window.bootstrap && window.bootstrap.Tooltip) {
    const tooltipTriggerList = [].slice.call(
      document.querySelectorAll('[data-bs-toggle="tooltip"]')
    );
    tooltipTriggerList.map(function (tooltipTriggerEl) {
      return new window.bootstrap.Tooltip(tooltipTriggerEl);
    });
  }
}

/**
 * 3. React to global currency change events (dispatched from navbar/sidebar)
 */
function listenToCurrencyChanges() {
  document.addEventListener("smore:currencychange", function (event) {
    const newCurrency = event.detail ? event.detail.currency : "MMK";
    
    // Update currency labels across the dashboard cards
    const amountElements = document.querySelectorAll(".h3.fw-bold, .text-muted.small");
    amountElements.forEach((el) => {
      if (el.textContent.includes("MMK") || el.textContent.includes("USD") || el.textContent.includes("THB")) {
        el.textContent = el.textContent.replace(/(MMK|USD|THB|EUR)/g, newCurrency);
      }
    });
  });
}