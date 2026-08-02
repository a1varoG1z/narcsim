import { escapeHtml, portraitImg } from "../../ui/components.js";
import { STATS, STAT_ORDER, ROLE_ORDER, ROLES } from "../../model.js";
import { exportGameToFile, exportJSONFile, importGameFromFile, deleteSaveSlot, readImageAsDataURL } from "../../utils/storage.js";
import { defaultConceptionDialogue, defaultPoachDialogue, defaultInformantDialogue, isValidDialogueTree } from "../../dialogues.js";
import { getGithubToken, setGithubToken, saveGameToGist, loadGameFromGist } from "../../utils/github.js";

const STATUS_LABEL = { war: "En guerra", alliance: "Aliados", neutral: "Neutral" };

// Each dialogue tree has its own vocabulary for how a scene actually ends (conception resolves to
// "attempt"/"rejected", poach to "attempt"/"walk_away"), so the visual editor needs to know each
// tree's own labels/values rather than assuming conception's are universal.
const DIALOGUE_TREE_META = {
  conception: {
    label: "Formar una familia",
    defaultTree: defaultConceptionDialogue,
    resolveOptions: [
      { value: "attempt", label: "Fin de la escena: intentarlo" },
      { value: "rejected", label: "Fin de la escena: rechazo, sin intentarlo" },
    ],
  },
  poach: {
    label: "Reclutar a un miembro",
    defaultTree: defaultPoachDialogue,
    resolveOptions: [
      { value: "attempt", label: "Fin de la escena: intentar el reclutamiento" },
      { value: "walk_away", label: "Fin de la escena: se aleja, sin trato" },
    ],
  },
  informant: {
    label: "Reclutar informante",
    defaultTree: defaultInformantDialogue,
    resolveOptions: [
      { value: "attempt", label: "Fin de la escena: intentar reclutarlo/a como informante" },
      { value: "walk_away", label: "Fin de la escena: se cierra, sin trato" },
    ],
  },
};

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
      <h3>Diálogos</h3>
      <label>Conversación</label>
      <select id="ed-dialogue-tree">
        ${Object.entries(DIALOGUE_TREE_META).map(([key, meta]) => `<option value="${key}" ${key === (game._editorLastDialogueTree || "conception") ? "selected" : ""}>${escapeHtml(meta.label)}</option>`).join("")}
      </select>
      <p class="text-dim small" id="dialogue-tree-desc"></p>
      <label>Nodo</label>
      <select id="ed-dialogue-node"></select>
      <div id="dialogue-node-editor" class="mt-1"></div>
      <button class="block mt-1" id="add-dialogue-node">+ Añadir nuevo nodo</button>
      <details class="mt-2">
        <summary class="small text-dim">Modo avanzado (JSON, para pegar un árbol completo)</summary>
        <textarea id="ed-dialogue-json" rows="14" style="width:100%;font-family:monospace;font-size:.8rem">${escapeHtml(JSON.stringify(game.dialogueTrees || { conception: defaultConceptionDialogue() }, null, 2))}</textarea>
        <button class="primary block mt-1" id="save-dialogue">Guardar JSON</button>
      </details>
      <button class="block ghost mt-1" id="reset-dialogue"></button>
      <h4 class="mt-2">Reutilizar este diálogo en otra partida</h4>
      <p class="text-dim small">Guárdalo aparte del resto de la partida para no tener que reescribirlo cada vez.</p>
      <div class="btn-row">
        <button class="block" id="export-dialogue-btn">Exportar diálogo (.json)</button>
        <button class="block" id="import-dialogue-btn">Importar diálogo (.json)</button>
      </div>
      <input type="file" id="import-dialogue-file" accept="application/json" class="hidden">
    </div>
    <div class="card">
      <h3>Partida</h3>
      <button class="block" id="export-btn">Exportar partida (.json)</button>
      <button class="block danger" id="reset-btn">Borrar partida y volver al menú</button>
      <h4 class="mt-2">Sincronizar con GitHub (Gist secreto)</h4>
      <p class="text-dim small">
        Pega tu propio token de GitHub (permiso <code>gist</code> únicamente) para subir o bajar esta partida como un Gist de tu cuenta.
        El token se guarda solo en este navegador (localStorage): nunca se envía a ningún sitio salvo directamente a la API de GitHub, y no queda en el código ni en la partida exportada.
        Aviso: un Gist "secreto" es solo no-listado, no privado de verdad — cualquiera con el enlace o el ID puede leerlo.
      </p>
      <label>Token de GitHub (scope "gist")</label>
      <input type="password" id="gh-token" placeholder="ghp_..." autocomplete="off" value="${escapeHtml(getGithubToken())}">
      <label class="mt-1">ID del Gist (vacío = crear uno nuevo al subir)</label>
      <input type="text" id="gh-gist-id" placeholder="Ej: 1a2b3c4d5e6f7890abcdef" value="${escapeHtml(game.githubGistId || "")}">
      <div class="btn-row mt-1">
        <button class="block" id="gh-save-btn">Subir partida a GitHub</button>
        <button class="block" id="gh-load-btn">Cargar partida desde GitHub</button>
      </div>
      <p id="gh-status" class="small text-dim" role="status"></p>
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
      <label>O usar una foto por URL</label>
      <div style="display:flex;gap:.4rem">
        <input type="text" id="cf-portrait-url" placeholder="https://..." style="flex:1">
        <button class="tight" id="cf-portrait-url-btn">Usar URL</button>
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

    container.querySelector("#cf-portrait-url-btn").addEventListener("click", () => {
      const url = container.querySelector("#cf-portrait-url").value.trim();
      if (!url) return;
      c.portrait = url;
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

  const dialogueTreeSelect = container.querySelector("#ed-dialogue-tree");
  const dialogueNodeSelect = container.querySelector("#ed-dialogue-node");
  const dialogueTreeDesc = container.querySelector("#dialogue-tree-desc");
  const resetDialogueBtn = container.querySelector("#reset-dialogue");
  const OPTION_SLOTS = 6;

  function selectedTreeKey() {
    return DIALOGUE_TREE_META[dialogueTreeSelect.value] ? dialogueTreeSelect.value : "conception";
  }

  function getSelectedTree() {
    const key = selectedTreeKey();
    // A full re-render (triggered by app.render() after any save/add/delete) rebuilds the <select>
    // from scratch, so the chosen tree has to be persisted onto the game object itself — same
    // pattern already used for the node dropdown via game._editorLastDialogueNode — or it would
    // silently snap back to the first tree and the next edit would land on the wrong one.
    game._editorLastDialogueTree = key;
    if (!game.dialogueTrees) game.dialogueTrees = {};
    if (!game.dialogueTrees[key]) game.dialogueTrees[key] = DIALOGUE_TREE_META[key].defaultTree();
    return game.dialogueTrees[key];
  }

  function nodePreview(id, node, isStart) {
    if (node.name && node.name.trim()) return `${isStart ? "▶ " : ""}${node.name.trim()}`;
    const text = (node.text || "").replace(/\s+/g, " ").trim();
    const snippet = text.length > 44 ? text.slice(0, 44) + "…" : text || "(sin nombre ni texto)";
    return `${isStart ? "▶ " : ""}${snippet}`;
  }

  function renderDialogueEditor() {
    const meta = DIALOGUE_TREE_META[selectedTreeKey()];
    dialogueTreeDesc.textContent = `Edita paso a paso la conversación de "${meta.label}": elige un nodo, escribe su texto y a qué lleva cada opción. Usa {partner} donde quieras que aparezca el nombre de la otra persona.`;
    resetDialogueBtn.textContent = `Restaurar "${meta.label}" por defecto`;
    const tree = getSelectedTree();
    const nodeIds = Object.keys(tree.nodes);
    dialogueNodeSelect.innerHTML = nodeIds.map((id) => `<option value="${id}">${escapeHtml(nodePreview(id, tree.nodes[id], id === tree.start))}</option>`).join("");
    const preferredId = game._editorLastDialogueNode;
    game._editorLastDialogueNode = null;
    if (preferredId && nodeIds.includes(preferredId)) dialogueNodeSelect.value = preferredId;
    else if (!nodeIds.includes(dialogueNodeSelect.value) && nodeIds.length) dialogueNodeSelect.value = tree.start;
    renderDialogueNodeEditor();
  }

  function renderDialogueNodeEditor() {
    const meta = DIALOGUE_TREE_META[selectedTreeKey()];
    const tree = getSelectedTree();
    const nodeId = dialogueNodeSelect.value;
    const node = tree.nodes[nodeId];
    const target = container.querySelector("#dialogue-node-editor");
    if (!node) {
      target.innerHTML = `<p class="small text-dim">No hay ningún nodo. Añade uno nuevo.</p>`;
      return;
    }
    const otherNodeIds = Object.keys(tree.nodes);
    const destOptions = (selected) => `
      <option value="" ${!selected ? "selected" : ""}>— (vacío) —</option>
      ${meta.resolveOptions.map((r) => `<option value="__resolve__:${r.value}" ${selected === r.value ? "selected" : ""}>${escapeHtml(r.label)}</option>`).join("")}
      ${otherNodeIds.map((id) => `<option value="${id}" ${selected === id ? "selected" : ""}>Ir a: ${escapeHtml(nodePreview(id, tree.nodes[id], id === tree.start))}</option>`).join("")}
    `;
    const slots = Math.max(OPTION_SLOTS, node.options.length + 2);

    target.innerHTML = `
      ${nodeId === tree.start ? `<p class="small text-success">Este es el nodo inicial de la conversación.</p>` : ""}
      <label>Nombre del nodo (opcional, solo para ti — te ayuda a encontrarlo en la lista)</label>
      <input type="text" id="dn-name" placeholder="p. ej. Saludo inicial" value="${escapeHtml(node.name || "")}">
      <label>Texto de este momento de la conversación</label>
      <textarea id="dn-text" rows="3">${escapeHtml(node.text || "")}</textarea>
      <h4 class="mt-1">Opciones que puede elegir el jugador</h4>
      ${Array.from({ length: slots }, (_, i) => {
        const opt = node.options[i];
        return `<div class="person-row" style="border:none;padding:.3rem 0;gap:.4rem">
          <input type="text" placeholder="Texto de la opción ${i + 1}" data-opt-label="${i}" value="${escapeHtml(opt?.label || "")}" style="flex:2">
          <input type="number" title="Calor (afecta a las probabilidades)" data-opt-warmth="${i}" value="${opt?.warmth ?? 0}" style="width:4rem" placeholder="Calor">
          <select data-opt-dest="${i}" style="flex:2">${destOptions(opt?.resolve || opt?.next || "")}</select>
        </div>`;
      }).join("")}
      <button class="primary block mt-1" id="save-dialogue-node">Guardar este nodo</button>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap" class="mt-1">
        ${nodeId !== tree.start ? `<button class="ghost" id="set-start-node">Marcar como nodo inicial</button>` : ""}
        <button class="danger ghost" id="delete-dialogue-node">Eliminar este nodo</button>
      </div>
    `;

    target.querySelector("#save-dialogue-node").addEventListener("click", () => {
      node.name = target.querySelector("#dn-name").value.trim();
      node.text = target.querySelector("#dn-text").value;
      const options = [];
      for (let i = 0; i < slots; i++) {
        const label = target.querySelector(`[data-opt-label="${i}"]`).value.trim();
        if (!label) continue;
        const dest = target.querySelector(`[data-opt-dest="${i}"]`).value;
        if (!dest) continue;
        const warmth = Number(target.querySelector(`[data-opt-warmth="${i}"]`).value) || 0;
        const option = { label, warmth };
        if (dest.startsWith("__resolve__:")) option.resolve = dest.slice("__resolve__:".length);
        else option.next = dest;
        options.push(option);
      }
      node.options = options;
      app.setGame(game);
      app.render();
    });

    target.querySelector("#set-start-node")?.addEventListener("click", () => {
      tree.start = nodeId;
      app.setGame(game);
      app.render();
    });

    target.querySelector("#delete-dialogue-node").addEventListener("click", () => {
      if (Object.keys(tree.nodes).length <= 1) {
        alert("No puedes eliminar el único nodo que queda.");
        return;
      }
      if (nodeId === tree.start) {
        alert("No puedes eliminar el nodo inicial. Marca otro como inicial primero.");
        return;
      }
      if (!confirm("¿Eliminar este nodo? Las opciones de otros nodos que apunten aquí dejarán de funcionar.")) return;
      delete tree.nodes[nodeId];
      app.setGame(game);
      app.render();
    });
  }

  dialogueTreeSelect.addEventListener("change", renderDialogueEditor);
  dialogueNodeSelect.addEventListener("change", renderDialogueNodeEditor);
  container.querySelector("#add-dialogue-node").addEventListener("click", () => {
    const tree = getSelectedTree();
    let n = Object.keys(tree.nodes).length + 1;
    while (tree.nodes[`nodo_${n}`]) n++;
    const newId = `nodo_${n}`;
    tree.nodes[newId] = { text: "", options: [] };
    game._editorLastDialogueNode = newId;
    app.setGame(game);
    app.render();
  });

  cartelSelect.addEventListener("change", renderCartelEditor);
  charSelect.addEventListener("change", renderCharacterEditor);
  territorySelect.addEventListener("change", renderTerritoryEditor);
  renderCartelEditor();
  renderTerritoryEditor();
  renderDialogueEditor();

  container.querySelector("#save-dialogue").addEventListener("click", () => {
    let parsed;
    try {
      parsed = JSON.parse(container.querySelector("#ed-dialogue-json").value);
    } catch (e) {
      alert("El JSON no es válido: " + e.message);
      return;
    }
    for (const key of Object.keys(parsed)) {
      if (DIALOGUE_TREE_META[key] && !isValidDialogueTree(parsed[key])) {
        alert(`El árbol '${key}' necesita un nodo 'start' válido dentro de 'nodes'.`);
        return;
      }
    }
    game.dialogueTrees = parsed;
    app.setGame(game);
    app.render();
  });

  resetDialogueBtn.addEventListener("click", () => {
    const key = selectedTreeKey();
    const meta = DIALOGUE_TREE_META[key];
    if (!confirm(`¿Restaurar el diálogo de "${meta.label}" a su versión por defecto?`)) return;
    game.dialogueTrees = { ...game.dialogueTrees, [key]: meta.defaultTree() };
    app.setGame(game);
    app.render();
  });

  container.querySelector("#export-dialogue-btn").addEventListener("click", () => {
    const key = selectedTreeKey();
    exportJSONFile({ [key]: getSelectedTree() }, `narcosim-dialogo-${key}`);
  });

  const importDialogueFile = container.querySelector("#import-dialogue-file");
  container.querySelector("#import-dialogue-btn").addEventListener("click", () => importDialogueFile.click());
  importDialogueFile.addEventListener("change", async () => {
    const file = importDialogueFile.files[0];
    if (!file) return;
    let parsed;
    try {
      parsed = await importGameFromFile(file);
    } catch (e) {
      alert("El archivo no contiene JSON válido: " + e.message);
      return;
    }
    const key = selectedTreeKey();
    const importedTree = parsed[key] || parsed;
    if (!isValidDialogueTree(importedTree)) {
      alert(`El archivo necesita un nodo 'start' válido dentro de '${key}.nodes' (o directamente en la raíz).`);
      return;
    }
    game.dialogueTrees = { ...game.dialogueTrees, [key]: importedTree };
    importDialogueFile.value = "";
    app.setGame(game);
    app.render();
  });

  container.querySelector("#export-btn").addEventListener("click", () => exportGameToFile(game));
  container.querySelector("#reset-btn").addEventListener("click", () => {
    if (!confirm("¿Seguro que quieres borrar la partida actual?")) return;
    if (game.saveSlotId) deleteSaveSlot(game.saveSlotId);
    app.game = null;
    app.navigate("menu");
  });

  const ghTokenInput = container.querySelector("#gh-token");
  const ghGistIdInput = container.querySelector("#gh-gist-id");
  const ghStatus = container.querySelector("#gh-status");
  ghTokenInput.addEventListener("change", () => setGithubToken(ghTokenInput.value.trim()));

  container.querySelector("#gh-save-btn").addEventListener("click", async () => {
    const token = ghTokenInput.value.trim();
    if (!token) {
      ghStatus.textContent = "Pega tu token de GitHub primero.";
      return;
    }
    setGithubToken(token);
    ghStatus.textContent = "Subiendo…";
    try {
      const gistId = await saveGameToGist(token, ghGistIdInput.value.trim() || null, game);
      game.githubGistId = gistId;
      ghGistIdInput.value = gistId;
      app.setGame(game);
      ghStatus.textContent = `Partida subida. ID del Gist: ${gistId}`;
    } catch (err) {
      ghStatus.textContent = `Error al subir: ${err.message}`;
    }
  });

  container.querySelector("#gh-load-btn").addEventListener("click", async () => {
    const token = ghTokenInput.value.trim();
    const gistId = ghGistIdInput.value.trim();
    if (!token || !gistId) {
      ghStatus.textContent = "Necesitas el token y el ID del Gist.";
      return;
    }
    if (!confirm("Esto sobrescribirá la partida actual con la versión guardada en GitHub. ¿Continuar?")) return;
    setGithubToken(token);
    ghStatus.textContent = "Descargando…";
    try {
      const data = await loadGameFromGist(token, gistId);
      data.saveSlotId = game.saveSlotId;
      app.setGame(data);
      app.navigate("dashboard");
    } catch (err) {
      ghStatus.textContent = `Error al cargar: ${err.message}`;
    }
  });
}
