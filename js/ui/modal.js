const root = document.getElementById("modal-root");

export function closeModal() {
  root.innerHTML = "";
}

export function showModal(innerHTML, { dismissible = true } = {}) {
  root.innerHTML = `<div class="modal-backdrop"><div class="modal">${innerHTML}</div></div>`;
  if (dismissible) {
    root.querySelector(".modal-backdrop").addEventListener("click", (e) => {
      if (e.target.classList.contains("modal-backdrop")) closeModal();
    });
  }
  return root.querySelector(".modal");
}
