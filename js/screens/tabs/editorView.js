import { escapeHtml, portraitImg } from "../../ui/components.js";
import { STATS, STAT_ORDER, ROLE_ORDER, ROLES } from "../../model.js";
import { exportGameToFile, deleteSaveSlot, readImageAsDataURL } from "../../utils/storage.js";

const STATUS_LABEL = { war: "En guerra", alliance: "Aliados", neutral: "Neutral" };

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
      <h3 class="mt-2">Relaciones</h3>
      <div id="relations-editor"></div>
      <label class="mt-2">Personaje</label>
      <select id="ed-character"></select>
      <div id="character-editor" class="mt-1"></div>
    </div>
    <div class="card">
      <h3>Territorios</h3>
      <label>Territorio</label>
      <select id="ed-territory">
        ${Object.values(game.territories).map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("")}
      </select>
      <div id="territory-editor" class="mt-1"></div>
    </div>
    <div class="card">
      <h3>Partida</h3>
      <button class="block" id="export-btn">Exportar partida (.json)</button>
      <button class="block danger" id="reset-btn">Borrar partida y volver al menú</button>
    </div>
  `;

  const cartelSelect = container.querySelector("#ed-cartel");
  const charSelect = container.querySelector("#ed-character");
  const territorySelect = container.querySelector("#ed-territory");

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
      <label>Reputación internacional</label><input id="f-rep" type="number" min="0" max="100" value="${r.internationalReputation ?? 15}">
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
      r.internationalReputation = Number(container.querySelector("#f-rep").value);
      r.heat = Number(container.querySelector("#f-heat").value);
      app.setGame(game);
      app.render();
    });

    charSelect.innerHTML = cartel.characters
      .map((id) => game.characters[id])
      .filter(Boolean)
      .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}${c.alive ? "" : " (✝)"}</option>`).join("");
    renderCharacterEditor();
    renderRelationsEditor(cartel);
  }

  function renderRelationsEditor(cartel) {
    const others = cartelOptions.filter((c) => c.id !== cartel.id);
    container.querySelector("#relations-editor").innerHTML = others.length ? `
      <table style="width:100%;border-collapse:collapse" class="small">
        <tr class="text-dim"><th style="text-align:left">Cártel</th><th>Estado</th><th>Tensión</th><th></th></tr>
        ${others.map((o) => {
          const rel = cartel.relations[o.id] || { status: "neutral", tension: 30 };
          return `<tr>
            <td>${escapeHtml(o.name)}</td>
            <td><select data-rel-status="${o.id}">
              ${Object.keys(STATUS_LABEL).map((s) => `<option value="${s}" ${rel.status === s ? "selected" : ""}>${STATUS_LABEL[s]}</option>`).join("")}
            </select></td>
            <td><input type="number" min="0" max="100" style="width:4rem" data-rel-tension="${o.id}" value="${rel.tension}"></td>
            <td><button class="tight" data-rel-save="${o.id}">Guardar</button></td>
          </tr>`;
        }).join("")}
      </table>
    ` : `<p class="small text-dim">No hay otros cárteles con quien tener relaciones.</p>`;

    container.querySelectorAll("[data-rel-save]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const otherId = btn.dataset.relSave;
        const status = container.querySelector(`[data-rel-status="${otherId}"]`).value;
        const tension = Number(container.querySelector(`[data-rel-tension="${otherId}"]`).value);
        cartel.relations[otherId] = { status, tension };
        const other = game.cartels[otherId];
        if (other) other.relations[cartel.id] = { status, tension };
        app.setGame(game);
        app.render();
      });
    });
  }

  function renderCharacterEditor() {
    const c = game.characters[charSelect.value];
    if (!c) return;
    const allCharacters = Object.values(game.characters).filter((o) => o.id !== c.id);
    const parent1 = c.parents?.[0] || "";
    const parent2 = c.parents?.[1] || "";
    const personSelectOptions = (selectedId) => `<option value="">Ninguno</option>${allCharacters.map((o) => `<option value="${o.id}" ${selectedId === o.id ? "selected" : ""}>${escapeHtml(o.name)}${o.alive ? "" : " (✝)"}</option>`).join("")}`;

    container.querySelector("#character-editor").innerHTML = `
      <div style="display:flex;gap:.6rem;align-items:center">
        ${portraitImg(c)}
        <div>
          <input type="file" accept="image/*" id="cf-portrait">
          <p class="text-dim small">Sube una foto para este personaje.</p>
        </div>
      </div>
      <label>Nombre</label><input id="cf-name" value="${escapeHtml(c.name)}">
      <label>Año de nacimiento</label><input id="cf-birth" type="number" value="${c.birthYear}">
      <label>Vivo</label><select id="cf-alive"><option value="1" ${c.alive ? "selected" : ""}>Sí</option><option value="0" ${!c.alive ? "selected" : ""}>No</option></select>
      <label>Cargo</label>
      <select id="cf-role"><option value="">Sin cargo</option>${ROLE_ORDER.map((r) => `<option value="${r}" ${c.role === r ? "selected" : ""}>${ROLES[r]}</option>`).join("")}</select>
      ${STAT_ORDER.map((k) => `<label>${STATS[k]}</label><input type="number" min="1" max="100" id="cf-stat-${k}" value="${c.stats[k]}">`).join("")}
      <h4 class="mt-1">Familia</h4>
      <label>Pareja</label>
      <select id="cf-spouse">${personSelectOptions(c.spouseId)}</select>
      <label>Padre/madre 1</label>
      <select id="cf-parent1">${personSelectOptions(parent1)}</select>
      <label>Padre/madre 2</label>
      <select id="cf-parent2">${personSelectOptions(parent2)}</select>
      <label>Hijos/as</label>
      <div id="cf-children-list">
        ${(c.childrenIds || []).map((id) => {
          const child = game.characters[id];
          return child ? `<div class="person-row"><span>${escapeHtml(child.name)}</span><button class="tight danger" data-remove-child="${id}">Quitar</button></div>` : "";
        }).join("") || `<p class="small text-dim">Sin hijos/as registrados.</p>`}
      </div>
      <label>Añadir hijo/a existente</label>
      <select id="cf-add-child">${personSelectOptions("")}</select>
      <button class="primary block mt-1" id="save-character">Guardar cambios del personaje</button>
    `;

    container.querySelector("#cf-portrait").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      c.portrait = await readImageAsDataURL(file);
      app.setGame(game);
      app.render();
    });

    container.querySelectorAll("[data-remove-child]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const childId = btn.dataset.removeChild;
        c.childrenIds = (c.childrenIds || []).filter((id) => id !== childId);
        const child = game.characters[childId];
        if (child) child.parents = (child.parents || []).filter((id) => id !== c.id);
        app.setGame(game);
        app.render();
      });
    });

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

      const oldSpouseId = c.spouseId;
      const newSpouseId = container.querySelector("#cf-spouse").value || null;
      if (newSpouseId !== oldSpouseId) {
        if (oldSpouseId && game.characters[oldSpouseId]) game.characters[oldSpouseId].spouseId = null;
        c.spouseId = newSpouseId;
        if (newSpouseId && game.characters[newSpouseId]) game.characters[newSpouseId].spouseId = c.id;
      }

      const newParent1 = container.querySelector("#cf-parent1").value || null;
      const newParent2 = container.querySelector("#cf-parent2").value || null;
      c.parents = [newParent1, newParent2].filter(Boolean);

      const addChildId = container.querySelector("#cf-add-child").value;
      if (addChildId && !(c.childrenIds || []).includes(addChildId)) {
        c.childrenIds = [...(c.childrenIds || []), addChildId];
        const child = game.characters[addChildId];
        if (child) child.parents = [...new Set([...(child.parents || []), c.id])];
      }

      app.setGame(game);
      app.render();
    });
  }

  function renderTerritoryEditor() {
    const t = game.territories[territorySelect.value];
    if (!t) return;
    container.querySelector("#territory-editor").innerHTML = `
      <label>Nombre</label><input id="tf-name" value="${escapeHtml(t.name)}">
      <label>Valor económico</label><input id="tf-value" type="number" min="0" value="${t.value}">
      <label>Controlado por</label>
      <select id="tf-controller">
        <option value="">Sin control (neutral)</option>
        ${cartelOptions.map((c) => `<option value="${c.id}" ${t.controllerId === c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
      </select>
      <button class="primary block mt-1" id="save-territory">Guardar cambios del territorio</button>
    `;
    container.querySelector("#save-territory").addEventListener("click", () => {
      const oldController = t.controllerId;
      t.name = container.querySelector("#tf-name").value;
      t.value = Number(container.querySelector("#tf-value").value);
      const newController = container.querySelector("#tf-controller").value || null;
      t.controllerId = newController;
      if (oldController !== newController) {
        if (oldController && game.cartels[oldController]) {
          game.cartels[oldController].territories = game.cartels[oldController].territories.filter((id) => id !== t.id);
        }
        if (newController && game.cartels[newController] && !game.cartels[newController].territories.includes(t.id)) {
          game.cartels[newController].territories.push(t.id);
        }
      }
      app.setGame(game);
      app.render();
    });
  }

  cartelSelect.addEventListener("change", renderCartelEditor);
  charSelect.addEventListener("change", renderCharacterEditor);
  territorySelect.addEventListener("change", renderTerritoryEditor);
  renderCartelEditor();
  renderTerritoryEditor();

  container.querySelector("#export-btn").addEventListener("click", () => exportGameToFile(game));
  container.querySelector("#reset-btn").addEventListener("click", () => {
    if (!confirm("¿Seguro que quieres borrar la partida actual?")) return;
    if (game.saveSlotId) deleteSaveSlot(game.saveSlotId);
    app.game = null;
    app.navigate("menu");
  });
}
