import { STATS, STAT_ORDER } from "../model.js";
import { readImageAsDataURL } from "../utils/storage.js";
import { escapeHtml } from "../ui/components.js";

let portraitDataUrl = null;

export function render(container, app, { eraData }) {
  portraitDataUrl = null;
  const territories = eraData.newCartelTerritories
    .map((id) => eraData.territories.find((t) => t.id === id))
    .filter(Boolean);

  container.innerHTML = `
    <div class="container">
      <h1>Crea tu narco</h1>
      <div class="card">
        <label>Nombre del personaje</label>
        <input id="c-name" placeholder="Ej. Emiliano Vargas 'El Chacal'">

        <label>Sexo</label>
        <select id="c-sex"><option value="M">Hombre</option><option value="F">Mujer</option></select>

        <label>Edad inicial</label>
        <input id="c-age" type="number" min="18" max="70" value="35">

        <label>Foto de perfil (opcional)</label>
        <input id="c-photo" type="file" accept="image/*">
        <div id="photo-preview" class="mt-1"></div>

        <label>Nombre del cártel</label>
        <input id="c-cartel-name" placeholder="Ej. Cártel del Pacífico Sur">

        <label>Color del cártel</label>
        <input id="c-color" type="color" value="#7a4a1f">

        <label>Territorio inicial</label>
        <select id="c-territory">
          ${territories.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("")}
        </select>

        <h3 class="mt-2">Atributos</h3>
        ${STAT_ORDER.map((key) => `
          <label>${STATS[key]}: <span id="val-${key}">50</span></label>
          <input type="range" min="10" max="95" value="50" id="stat-${key}">
        `).join("")}

        <div class="btn-row mt-2">
          <button class="primary block" id="create-btn">Comenzar partida</button>
          <button class="ghost block" id="back-btn">← Volver</button>
        </div>
      </div>
    </div>
  `;

  for (const key of STAT_ORDER) {
    const input = container.querySelector(`#stat-${key}`);
    const label = container.querySelector(`#val-${key}`);
    input.addEventListener("input", () => (label.textContent = input.value));
  }

  container.querySelector("#c-photo").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    portraitDataUrl = await readImageAsDataURL(file);
    container.querySelector("#photo-preview").innerHTML = `<img src="${portraitDataUrl}" class="portrait lg">`;
  });

  container.querySelector("#back-btn").addEventListener("click", () => app.navigate("characterSelect", { eraData }));

  container.querySelector("#create-btn").addEventListener("click", () => {
    const name = container.querySelector("#c-name").value.trim();
    const cartelName = container.querySelector("#c-cartel-name").value.trim();
    if (!name || !cartelName) {
      alert("Escribe un nombre para tu personaje y para tu cártel.");
      return;
    }
    const stats = {};
    for (const key of STAT_ORDER) stats[key] = Number(container.querySelector(`#stat-${key}`).value);
    app.startNewCartelGame(eraData, {
      leaderName: name,
      sex: container.querySelector("#c-sex").value,
      age: Number(container.querySelector("#c-age").value) || 35,
      cartelName,
      color: container.querySelector("#c-color").value,
      territoryId: container.querySelector("#c-territory").value,
      portrait: portraitDataUrl,
      stats,
    });
  });
}
