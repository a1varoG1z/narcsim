import { loadEraIndex, loadEra } from "../dataLoader.js";

export async function render(container, app) {
  container.innerHTML = `<div class="container"><h1>Elige una época</h1><p class="text-dim">Cargando épocas…</p></div>`;
  let eras;
  try {
    eras = await loadEraIndex();
  } catch (err) {
    container.innerHTML = `<div class="container"><p class="text-danger">Error cargando datos: ${err.message}</p></div>`;
    return;
  }

  container.innerHTML = `
    <div class="container">
      <h1>Elige una época</h1>
      <p class="text-dim">Según la época que elijas se construirá el mapa de cárteles y personajes de esa etapa histórica.</p>
      ${eras.map((e) => `
        <div class="card era-card" data-file="${e.file}">
          <h2>${e.name}</h2>
          <div class="badge">${e.period}</div>
          <p>${e.blurb}</p>
        </div>
      `).join("")}
      <button class="ghost block" id="back-btn">← Volver</button>
    </div>
  `;

  container.querySelectorAll(".era-card").forEach((card) => {
    card.addEventListener("click", async () => {
      card.innerHTML = "<p>Cargando…</p>";
      try {
        const eraData = await loadEra(card.dataset.file);
        app.navigate("characterSelect", { eraData });
      } catch (err) {
        alert("No se pudo cargar la época: " + err.message);
      }
    });
  });
  container.querySelector("#back-btn").addEventListener("click", () => app.navigate("menu"));
}
