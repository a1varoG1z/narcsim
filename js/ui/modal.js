const root = document.getElementById("modal-root");
let keydownHandler = null;

export function closeModal() {
  root.innerHTML = "";
  if (keydownHandler) {
    document.removeEventListener("keydown", keydownHandler);
    keydownHandler = null;
  }
}

export function showModal(innerHTML, { dismissible = true } = {}) {
  root.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true">${innerHTML}</div></div>`;
  const modalEl = root.querySelector(".modal");

  if (dismissible) {
    root.querySelector(".modal-backdrop").addEventListener("click", (e) => {
      if (e.target.classList.contains("modal-backdrop")) closeModal();
    });
    keydownHandler = (e) => {
      if (e.key === "Escape") closeModal();
    };
    document.addEventListener("keydown", keydownHandler);
  }

  const firstFocusable = modalEl.querySelector("button, [href], input, select, textarea");
  firstFocusable?.focus();

  return modalEl;
}
