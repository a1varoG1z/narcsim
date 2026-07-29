import { escapeHtml } from "../../ui/components.js";
import { STATS, STAT_ORDER, ROLE_ORDER, ROLES } from "../../model.js";
import { exportGameToFile, importGameFromFile, clearGame } from "../../utils/storage.js";

export function render(container, app) {
  const game = app.game;
  const cartelOptions = Object.values(game.cartels).filter((c) => !c.destroyed);

  container.innerHTML = `
    <div class="card">
      <h2>Editor interno</h2>
      <p class="text-dim small">Edita cualquier dato de la partida directamente. Útil para corregir, balancear o experimentar.</p>
      <label>Cártel</label>
      <select id="ed-cartel">
        ${cartelOptions.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}
      </select>
      <div id="cartel-editor" class="mt-1"></div>
      <label class="mt-2">Personaje</label>
      <select id="ed-character"></select>
      <div id="character-editor" class="mt-1"></div>
    </div>
    <div class="card">
      <h3>Partida</h3>
      <button class="block" id="export-btn">Exportar partida (.json)</button>
      <button class="block danger" id="reset-btn">Borrar partida y volver al menú</button>
    </div>
  `;

  const cartelSelect = container.querySelector("#ed-cartel");
  const charSelect = container.querySelector("#ed-character");

  function renderCartelEditor() {
    const cartel = game.cartels[cartelSelect.value];
    const r = cartel.resources;
    container.querySelector("#cartel-editor").innerHTML = `
      <label>Nombre</label><input id="f-name" value="${escapeHtml(cartel.name)}">
      <label>Dinero</label><input id="f-money" type="number" value="${r.money}">
      <label>Ejército</label><input id="f-army" type="number" value="${r.armySize}">
      <label>Corrupción gobierno</label><input id="f-cgov" type="number" min="0" max="100" value="${r.corruptGov}">
      <label>Corrupción policial</label><input id="f-cpol" type="number" min="0" max="100" value="${r.corruptPolice}">
      <label>Imagen pública</label><input id="f-image" type="number" min="0" max="100" value="${r.publicImage}">
      <label>Heat (búsqueda)</label><input id="f-heat" type="number" min="0" max="100" value="${r.heat}">
      <button class="primary block mt-1" id="save-cartel">Guardar cambios del cártel</button>
    `;
    container.querySelector("#save-cartel").addEventListener("click", () => {
      cartel.name = container.querySelector("#f-name").value;
      r.money = Number(container.querySelector("#f-money").value);
      r.armySize = Number(container.querySelector("#f-army").value);
      r.corruptGov = Number(container.querySelector("#f-cgov").value);
      r.corruptPolice = Number(container.querySelector("#f-cpol").value);
      r.publicImage = Number(container.querySelector("#f-image").value);
      r.heat = Number(container.querySelector("#f-heat").value);
      app.setGame(game);
      app.render();
    });

    charSelect.innerHTML = cartel.characters
      .map((id) => game.characters[id])
      .filter(Boolean)
      .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}${c.alive ? "" : " (✝)"}</option>`).join("");
    renderCharacterEditor();
  }

  function renderCharacterEditor() {
    const c = game.characters[charSelect.value];
    if (!c) return;
    container.querySelector("#character-editor").innerHTML = `
      <label>Nombre</label><input id="cf-name" value="${escapeHtml(c.name)}">
      <label>Año de nacimiento</label><input id="cf-birth" type="number" value="${c.birthYear}">
      <label>Vivo</label><select id="cf-alive"><option value="1" ${c.alive ? "selected" : ""}>Sí</option><option value="0" ${!c.alive ? "selected" : ""}>No</option></select>
      <label>Cargo</label>
      <select id="cf-role"><option value="">Sin cargo</option>${ROLE_ORDER.map((r) => `<option value="${r}" ${c.role === r ? "selected" : ""}>${ROLES[r]}</option>`).join("")}</select>
      ${STAT_ORDER.map((k) => `<label>${STATS[k]}</label><input type="number" min="1" max="100" id="cf-stat-${k}" value="${c.stats[k]}">`).join("")}
      <button class="primary block mt-1" id="save-character">Guardar cambios del personaje</button>
    `;
    container.querySelector("#save-character").addEventListener("click", () => {
      c.name = container.querySelector("#cf-name").value;
      c.birthYear = Number(container.querySelector("#cf-birth").value);
      c.alive = container.querySelector("#cf-alive").value === "1";
      const newRole = container.querySelector("#cf-role").value || null;
      if (newRole !== c.role) {
        const cartel = game.cartels[c.cartelId];
        if (c.role) cartel.roles[c.role] = cartel.roles[c.role] === c.id ? null : cartel.roles[c.role];
        if (newRole) cartel.roles[newRole] = c.id;
        c.role = newRole;
      }
      for (const k of STAT_ORDER) c.stats[k] = Number(container.querySelector(`#cf-stat-${k}`).value);
      app.setGame(game);
      app.render();
    });
  }

  cartelSelect.addEventListener("change", renderCartelEditor);
  charSelect.addEventListener("change", renderCharacterEditor);
  renderCartelEditor();

  container.querySelector("#export-btn").addEventListener("click", () => exportGameToFile(game));
  container.querySelector("#reset-btn").addEventListener("click", () => {
    if (!confirm("¿Seguro que quieres borrar la partida actual?")) return;
    clearGame();
    app.game = null;
    app.navigate("menu");
  });
}
