import { listSaveSlots, deleteSaveSlot, importGameFromFile } from "../utils/storage.js";
import { escapeHtml } from "../ui/components.js";

export function render(container, app) {
  const slots = listSaveSlots();

  container.innerHTML = `
    <div class="container center">
      <h1>🌵 Narcosim</h1>
      <p class="text-dim">Un simulador de estrategia por turnos sobre la historia del narcotráfico en América Latina, inspirado en Crusader Kings.</p>

      ${slots.length ? `
        <h2>Tus partidas</h2>
        ${slots.map((s) => `
          <div class="card tight" style="display:flex;align-items:center;gap:.5rem">
            <div style="flex:1;min-width:0;text-align:left" data-continue="${s.id}" role="button">
              <div class="name">${escapeHtml(s.name)}</div>
              <div class="small text-dim">${escapeHtml(s.eraName)} · ${s.year} · turno ${s.turn}</div>
            </div>
            <button class="danger tight" data-delete="${s.id}" title="Eliminar partida">✕</button>
          </div>
        `).join("")}
      ` : ""}

      <div class="card mt-2">
        <button class="primary block" id="new-btn">Nueva partida</button>
        <button class="block ghost" id="import-btn">Importar partida (.json)</button>
        <input type="file" id="import-file" accept="application/json" class="hidden">
      </div>
      <footer class="disclaimer">
        Juego de ficción histórica de un solo jugador. Los datos se guardan únicamente en tu navegador (localStorage) y en los archivos .json que exportes. Muchos personajes secundarios y cifras son inventados con fines de juego; los eventos biográficos reales se citan de forma orientativa.
      </footer>
    </div>
  `;

  container.querySelectorAll("[data-continue]").forEach((el) => {
    el.addEventListener("click", () => app.loadSlot(el.dataset.continue));
  });
  container.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!confirm("¿Eliminar esta partida? No se puede deshacer.")) return;
      deleteSaveSlot(btn.dataset.delete);
      render(container, app);
    });
  });

  container.querySelector("#new-btn").addEventListener("click", () => app.navigate("eraSelect"));
  const importBtn = container.querySelector("#import-btn");
  const importFile = container.querySelector("#import-file");
  importBtn.addEventListener("click", () => importFile.click());
  importFile.addEventListener("change", async () => {
    const file = importFile.files[0];
    if (!file) return;
    try {
      const data = await importGameFromFile(file);
      data.saveSlotId = null; // importing always creates a new slot rather than overwriting one that shares an id
      app.setGame(data);
      app.navigate("dashboard");
    } catch (err) {
      alert("No se pudo leer el archivo de partida.");
    }
  });
}
