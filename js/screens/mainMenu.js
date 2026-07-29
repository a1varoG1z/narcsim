import { hasSave } from "../utils/storage.js";
import { importGameFromFile } from "../utils/storage.js";

export function render(container, app) {
  container.innerHTML = `
    <div class="container center">
      <h1>🌵 Narcosim</h1>
      <p class="text-dim">Un simulador de estrategia por turnos sobre la historia del narcotráfico en América Latina, inspirado en Crusader Kings.</p>
      <div class="card">
        ${hasSave() ? `<button class="primary block" id="continue-btn">Continuar partida</button>` : ""}
        <button class="block" id="new-btn">Nueva partida</button>
        <button class="block ghost" id="import-btn">Importar partida (.json)</button>
        <input type="file" id="import-file" accept="application/json" class="hidden">
      </div>
      <footer class="disclaimer">
        Juego de ficción histórica de un solo jugador. Los datos se guardan únicamente en tu navegador (localStorage) y en los archivos .json que exportes. Muchos personajes secundarios y cifras son inventados con fines de juego; los eventos biográficos reales se citan de forma orientativa.
      </footer>
    </div>
  `;

  container.querySelector("#continue-btn")?.addEventListener("click", () => app.navigate("dashboard"));
  container.querySelector("#new-btn").addEventListener("click", () => app.navigate("eraSelect"));
  const importBtn = container.querySelector("#import-btn");
  const importFile = container.querySelector("#import-file");
  importBtn.addEventListener("click", () => importFile.click());
  importFile.addEventListener("change", async () => {
    const file = importFile.files[0];
    if (!file) return;
    try {
      const data = await importGameFromFile(file);
      app.setGame(data);
      app.navigate("dashboard");
    } catch (err) {
      alert("No se pudo leer el archivo de partida.");
    }
  });
}
