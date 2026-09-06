export function showConfirmationModal({
  title = "Are you sure?",
  message = "This action cannot be undone.",
  confirmLabel = "Delete",
} = {}) {
  return new Promise((resolve) => {
    document.getElementById("smore-confirmation-modal")?.remove();

    const modal = document.createElement("div");
    modal.id = "smore-confirmation-modal";
    modal.className = "notification-delete-modal";
    modal.setAttribute("role", "presentation");
    modal.innerHTML = `
      <div class="notification-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="smore-confirmation-title">
        <div class="notification-delete-heading">
          <span class="notification-delete-icon" aria-hidden="true"><i class="bi bi-trash3"></i></span>
          <h2 id="smore-confirmation-title">${title}</h2>
        </div>
        <p class="notification-delete-copy">${message}</p>
        <div class="notification-delete-actions">
          <button type="button" class="notification-delete-cancel">Cancel</button>
          <button type="button" class="notification-delete-confirm">${confirmLabel}</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    let settled = false;
    const finish = (confirmed) => {
      if (settled) return;
      settled = true;
      modal.classList.add("is-closing");
      modal.addEventListener("animationend", () => {
        modal.remove();
        resolve(confirmed);
      }, { once: true });
    };

    modal.querySelector(".notification-delete-cancel").addEventListener("click", () => finish(false));
    modal.querySelector(".notification-delete-confirm").addEventListener("click", () => finish(true));
    modal.addEventListener("click", (event) => {
      if (event.target === modal) finish(false);
    });
    modal.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    });
    modal.querySelector(".notification-delete-cancel").focus();
  });
}
