/* ==========================================================================
   Smore — Budget Planner navbar behaviour
   Plain JS, no framework. Depends on Bootstrap 5 bundle for collapse/dropdown.
   ========================================================================== */

(function () {
  "use strict";

  var STORAGE_KEY = "smore:currency";

  document.addEventListener("DOMContentLoaded", function () {
    highlightActiveLink();
    wireCurrencySwitcher();
    wireLogout();
    closeMenuOnNavigate();
    shadowOnScroll();
  });

  /* Mark the nav link matching the current page as active. */
  function highlightActiveLink() {
    var links = document.querySelectorAll(".smore-nav .nav-link[href]");
    var here = window.location.pathname.split("/").pop() || "index.html";

    links.forEach(function (link) {
      var target = link.getAttribute("href").split("/").pop();
      var isActive = target === here || (link.dataset.page && link.dataset.page === here);
      link.classList.toggle("active", !!isActive);
      if (isActive) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }

  /* Currency chip + dropdown, persisted in localStorage. */
  function wireCurrencySwitcher() {
    var label = document.querySelector("[data-currency-label]");
    var options = document.querySelectorAll("[data-currency]");
    if (!label) return;

    var saved = safeGet(STORAGE_KEY) || label.textContent.trim() || "MMK";
    label.textContent = saved;

    options.forEach(function (option) {
      option.addEventListener("click", function (event) {
        event.preventDefault();
        var code = option.dataset.currency;
        label.textContent = code;
        safeSet(STORAGE_KEY, code);
        document.dispatchEvent(
          new CustomEvent("smore:currencychange", { detail: { currency: code } }),
        );
      });
    });
  }

  /* Log out button — clears local session state then redirects. */
  function wireLogout() {
    var buttons = document.querySelectorAll("[data-action='logout']");
    buttons.forEach(function (button) {
      button.addEventListener("click", function (event) {
        event.preventDefault();
        try {
          localStorage.removeItem("smore:session");
          sessionStorage.clear();
        } catch (error) {
          /* storage unavailable — nothing to clear */
        }
        var target = button.dataset.redirect || "index.html";
        window.location.href = target;
      });
    });
  }

  /* On mobile, collapse the menu after tapping a link. */
  function closeMenuOnNavigate() {
    var collapseEl = document.getElementById("smoreNav");
    if (!collapseEl || !window.bootstrap) return;

    collapseEl.querySelectorAll(".nav-link").forEach(function (link) {
      link.addEventListener("click", function () {
        if (window.innerWidth >= 992) return;
        var instance = window.bootstrap.Collapse.getOrCreateInstance(collapseEl, {
          toggle: false,
        });
        instance.hide();
      });
    });
  }

  /* Slightly stronger shadow once the page is scrolled. */
  function shadowOnScroll() {
    var nav = document.querySelector(".smore-nav");
    if (!nav) return;

    var apply = function () {
      var scrolled = window.scrollY > 4;
      nav.style.boxShadow = scrolled
        ? "0 2px 4px rgba(16,24,40,.06), 0 12px 32px rgba(16,24,40,.10)"
        : "";
    };

    apply();
    window.addEventListener("scroll", apply, { passive: true });
  }

  function safeGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function safeSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      /* ignore */
    }
  }
})();


window.initNav = function() {};
export function initNav() {}
