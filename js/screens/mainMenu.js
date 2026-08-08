import { listSaveSlots, deleteSaveSlot, importGameFromFile } from "../utils/storage.js";
import { getGithubToken, setGithubToken, loadGameFromGist } from "../utils/github.js";
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
            <div style="flex:1;min-width:0;text-align:left" data-continue="${s.id}" role="button" tabindex="0" aria-label="Continuar partida: ${escapeHtml(s.name)}">
              <div class="name">${escapeHtml(s.name)}</div>
              <div class="small text-dim">${escapeHtml(s.eraName)} · ${s.year} · turno ${s.turn}</div>
            </div>
            <button class="danger tight" data-delete="${s.id}" aria-label="Eliminar partida: ${escapeHtml(s.name)}" title="Eliminar partida">✕</button>
          </div>
        `).join("")}
      ` : ""}

      <div class="card mt-2">
        <button class="primary block" id="new-btn">Nueva partida</button>
        <button class="block ghost" id="import-btn">Importar partida (.json)</button>
        <input type="file" id="import-file" accept="application/json" class="hidden">
        <details class="mt-1">
          <summary class="small text-dim">Cargar desde GitHub (Gist)</summary>
          <p class="text-dim small">Si ya subiste una partida desde otro dispositivo, pega aquí el mismo token (permiso <code>gist</code>) y el ID del Gist para traerla. El token solo se guarda en este navegador.</p>
          <label>Token de GitHub (scope "gist")</label>
          <input type="password" id="gh-token" placeholder="ghp_..." autocomplete="off" value="${escapeHtml(getGithubToken())}">
          <label class="mt-1">ID del Gist</label>
          <input type="text" id="gh-gist-id" placeholder="Ej: 1a2b3c4d5e6f7890abcdef">
          <button class="block mt-1" id="gh-load-btn">Cargar partida desde GitHub</button>
          <p id="gh-status" class="small text-dim" role="status"></p>
        </details>
      </div>
      <footer class="disclaimer">
        Juego de ficción histórica de un solo jugador. Los datos se guardan únicamente en tu navegador (localStorage) y en los archivos .json que exportes. Muchos personajes secundarios y cifras son inventados con fines de juego; los eventos biográficos reales se citan de forma orientativa.
      </footer>
    </div>
  `;

  container.querySelectorAll("[data-continue]").forEach((el) => {
    el.addEventListener("click", () => app.loadSlot(el.dataset.continue));
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        app.loadSlot(el.dataset.continue);
      }
    });
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

  const ghTokenInput = container.querySelector("#gh-token");
  const ghGistIdInput = container.querySelector("#gh-gist-id");
  const ghStatus = container.querySelector("#gh-status");
  ghTokenInput.addEventListener("change", () => setGithubToken(ghTokenInput.value.trim()));
  container.querySelector("#gh-load-btn").addEventListener("click", async () => {
    const token = ghTokenInput.value.trim();
    const gistId = ghGistIdInput.value.trim();
    if (!token || !gistId) {
      ghStatus.textContent = "Necesitas el token y el ID del Gist.";
      return;
    }
    setGithubToken(token);
    ghStatus.textContent = "Descargando…";
    try {
      const data = await loadGameFromGist(token, gistId);
      data.saveSlotId = null; // loading here always creates a new local slot rather than overwriting one that shares an id
      app.setGame(data);
      app.navigate("dashboard");
    } catch (err) {
      ghStatus.textContent = `Error al cargar: ${err.message}`;
    }
  });
}
