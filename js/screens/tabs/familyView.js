import { getPlayerCartel, getPlayerCharacter, currentYear } from "../../state.js";
import { portraitImg, escapeHtml, roleLabel, statBar } from "../../ui/components.js";
import { showCharacterProfile } from "./characterProfile.js";
import { generateNpc, randomName } from "../../npcGenerator.js";
import { chance, clamp } from "../../utils/random.js";
import { strengthenBond, getDesignatableHeirs, designateHeir, clearDesignatedHeir, mentorHeir, arrangeMarriage } from "../../turnEngine.js";
import { showModal, closeModal } from "../../ui/modal.js";

export function render(container, app) {
  const game = app.game;
  const cartel = getPlayerCartel(game);
  const player = getPlayerCharacter(game);
  const year = currentYear(game);

  const familyMembers = new Set();
  const addFam = (c) => {
    if (!c) return;
    familyMembers.add(c.id);
  };
  addFam(player);
  (player.parents || []).forEach((id) => addFam(game.characters[id]));
  if (player.spouseId) addFam(game.characters[player.spouseId]);
  (player.childrenIds || []).forEach((id) => addFam(game.characters[id]));
  for (const parentId of player.parents || []) {
    const parent = game.characters[parentId];
    (parent?.childrenIds || []).forEach((id) => addFam(game.characters[id])); // siblings
  }

  const cartelMembers = cartel.characters.map((id) => game.characters[id]).filter((c) => c && c.alive);

  container.innerHTML = `
    <div class="card">
      <h2>Tu familia</h2>
      <div class="grid auto">
        ${[...familyMembers].map((id) => renderFamilyCard(game.characters[id], player.id)).join("")}
      </div>
      ${player.spouseId ? statBar("Relación con tu pareja", player.marriageBond ?? 70) : ""}
      ${!player.spouseId ? `<button class="block mt-1" id="seek-romance">Buscar pareja</button>` : ""}
      ${player.spouseId && cartel.characters.length ? `<button class="block mt-1" id="try-child">Intentar tener un hijo/a</button>` : ""}
      ${player.spouseId ? `<button class="block mt-1 danger" id="divorce-btn">Pedir el divorcio</button>` : ""}
    </div>
    ${renderSuccessionCard(game)}
    ${renderMarriageAllianceCard(game, familyMembers, player, year)}
    <div class="card">
      <h3>Vínculos y lealtades del cártel</h3>
      <p class="text-dim small">La lealtad depende de tu Liderazgo frente a su Astucia, atenuada por el vínculo personal que tengas con cada uno. Pasa tiempo con ellos para fortalecerlo.</p>
      ${cartelMembers.filter((m) => m.role && m.id !== player.id).map((m) => {
        const bond = m.bondWithPlayer ?? 50;
        const risk = Math.max(0, m.stats.intrigue - player.stats.loyaltyInspiring) * (1 - (bond - 50) / 60);
        const label = risk > 40 ? "Alto riesgo de traición" : risk > 15 ? "Lealtad incierta" : "Leal";
        const cls = risk > 40 ? "text-danger" : risk > 15 ? "text-dim" : "text-success";
        return `<div class="person-row">
          <div style="display:flex;gap:.6rem;flex:1;min-width:0;cursor:pointer" data-view="${m.id}">
            ${portraitImg(m)}
            <div class="info">
              <div class="name">${escapeHtml(m.name)}</div>
              <div class="role">${roleLabel(m.role)}</div>
              ${statBar("Vínculo", bond)}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:.3rem">
            <div class="small ${cls}">${label}</div>
            <button data-bond="${m.id}" class="tight">Pasar tiempo</button>
          </div>
        </div>`;
      }).join("")}
    </div>
  `;

  container.querySelectorAll("[data-view]").forEach((el) => {
    el.addEventListener("click", () => showCharacterProfile(app, el.dataset.view));
  });

  container.querySelectorAll("[data-bond]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const result = strengthenBond(game, btn.dataset.bond);
      if (!result.ok && result.message) alert(result.message);
      app.setGame(game);
      app.render();
    });
  });

  container.querySelector("#seek-romance")?.addEventListener("click", () => {
    showCourtshipModal(app, game, cartel, player, year);
  });

  container.querySelector("#choose-heir-btn")?.addEventListener("click", () => {
    showHeirModal(app, game);
  });

  container.querySelector("#clear-heir-btn")?.addEventListener("click", () => {
    clearDesignatedHeir(game);
    app.setGame(game);
    app.render();
  });

  container.querySelector("#mentor-heir-btn")?.addEventListener("click", () => {
    const result = mentorHeir(game);
    if (!result.ok && result.message) alert(result.message);
    app.setGame(game);
    app.render();
  });

  container.querySelectorAll("[data-arrange-marriage]").forEach((btn) => {
    btn.addEventListener("click", () => {
      showArrangeMarriageModal(app, game, cartel, btn.dataset.arrangeMarriage);
    });
  });

  container.querySelector("#divorce-btn")?.addEventListener("click", () => {
    if (!confirm("¿Seguro que quieres pedir el divorcio?")) return;
    const spouse = game.characters[player.spouseId];
    if (spouse) spouse.spouseId = null;
    player.spouseId = null;
    player.marriageBond = undefined;
    app.setGame(game);
    app.render();
  });

  container.querySelector("#try-child")?.addEventListener("click", () => {
    const spouse = game.characters[player.spouseId];
    const mother = player.sex === "F" ? player : spouse;
    const father = player.sex === "F" ? spouse : player;
    if (!mother || !father || !chance(0.6)) {
      alert("No ha sido posible esta vez. Inténtalo de nuevo más adelante.");
      return;
    }
    const child = generateNpc({ cartelId: cartel.id, role: null, currentYear: year, minAge: 0, maxAge: 0 });
    child.birthYear = year;
    child.name = randomName(child.sex).split(" ").slice(0, 2).join(" ");
    child.parents = [mother.id, father.id];
    game.characters[child.id] = child;
    cartel.characters.push(child.id);
    mother.childrenIds.push(child.id);
    father.childrenIds.push(child.id);
    app.setGame(game);
    app.render();
  });
}

function showCourtshipModal(app, game, cartel, player, year) {
  const spouseSex = player.sex === "M" ? "F" : "M";
  const candidates = Array.from({ length: 3 }, () => {
    const npc = generateNpc({ cartelId: cartel.id, role: null, currentYear: year, minAge: 18, maxAge: 45 });
    npc.sex = spouseSex;
    npc.name = randomName(spouseSex);
    return npc;
  });

  showModal(`
    <h2>Cortejar</h2>
    <p class="small text-dim">Tu carisma influye en tus probabilidades. Elige a quién cortejar.</p>
    ${candidates.map((c) => `
      <button class="block" data-court="${c.id}">
        <div class="person-row" style="border:none;padding:0">
          ${portraitImg(c)}
          <div class="info"><div class="name">${escapeHtml(c.name)}</div><div class="role">${c.stats.charisma > 65 ? "Encantador/a" : c.stats.business > 65 ? "Ambicioso/a" : "Discreto/a"}</div></div>
        </div>
      </button>
    `).join("")}
    <button class="ghost block" id="close-btn">Cancelar</button>
  `);

  document.getElementById("close-btn").addEventListener("click", closeModal);
  document.querySelectorAll("[data-court]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const candidate = candidates.find((c) => c.id === btn.dataset.court);
      const successChance = clamp(0.4 + player.stats.charisma / 200, 0.3, 0.85);
      closeModal();
      if (chance(successChance)) {
        candidate.spouseId = player.id;
        game.characters[candidate.id] = candidate;
        cartel.characters.push(candidate.id);
        player.spouseId = candidate.id;
        player.marriageBond = 70;
        app.setGame(game);
      }
      showModal(`
        <h2>${game.characters[player.spouseId]?.id === candidate.id ? "¡Boda!" : "Rechazado"}</h2>
        <p>${game.characters[player.spouseId]?.id === candidate.id
          ? `${escapeHtml(candidate.name)} acepta cortejar contigo y os casáis poco después.`
          : `${escapeHtml(candidate.name)} rechaza tus intenciones. Puedes intentarlo de nuevo más adelante.`}</p>
        <button class="primary block" id="ok-btn">Aceptar</button>
      `);
      document.getElementById("ok-btn").addEventListener("click", () => {
        closeModal();
        app.render();
      });
    });
  });
}

function renderSuccessionCard(game) {
  const heir = game.designatedHeirId ? game.characters[game.designatedHeirId] : null;
  return `
    <div class="card">
      <h3>Sucesión</h3>
      <p class="text-dim small">Si mueres, eres arrestado con cadena perpetua, o pierdes el liderazgo, tu cártel pasa a tu heredero designado (si sigue disponible). Si no designas a nadie, el cártel elegirá al candidato más adecuado por ti.</p>
      ${heir
        ? `<div class="person-row" style="border:none;padding:0;cursor:pointer" data-view="${heir.id}">
            ${portraitImg(heir)}
            <div class="info"><div class="name">${escapeHtml(heir.name)}</div><div class="role">${heir.role ? roleLabel(heir.role) : "Familiar"}</div></div>
          </div>`
        : `<p class="small text-dim">No has designado a ningún heredero todavía.</p>`}
      <div style="display:flex;gap:.5rem;flex-wrap:wrap" class="mt-1">
        <button class="block" id="choose-heir-btn">${heir ? "Cambiar heredero" : "Designar heredero"}</button>
        ${heir ? `<button class="block ghost" id="clear-heir-btn">Quitar designación</button>` : ""}
        ${heir ? `<button class="block ghost" id="mentor-heir-btn">Instruir a tu heredero</button>` : ""}
      </div>
    </div>
  `;
}

function renderMarriageAllianceCard(game, familyMemberIds, player, year) {
  const eligible = [...familyMemberIds]
    .map((id) => game.characters[id])
    .filter((c) => c && c.id !== player.id && c.alive && !c.spouseId && year - c.birthYear >= 16);

  return `
    <div class="card">
      <h3>Matrimonios de alianza</h3>
      <p class="text-dim small">Casa a un familiar soltero con alguien de otro cártel para reducir la tensión entre ambas organizaciones.</p>
      ${eligible.length ? eligible.map((c) => `
        <div class="person-row">
          <div style="display:flex;gap:.6rem;flex:1;min-width:0">
            ${portraitImg(c)}
            <div class="info"><div class="name">${escapeHtml(c.name)}</div><div class="role">${c.role ? roleLabel(c.role) : "Familiar"}</div></div>
          </div>
          <button class="tight" data-arrange-marriage="${c.id}">Arreglar matrimonio</button>
        </div>
      `).join("") : `<p class="small text-dim">No tienes familiares solteros en edad de casarse.</p>`}
    </div>
  `;
}

function showArrangeMarriageModal(app, game, cartel, familyMemberId) {
  const member = game.characters[familyMemberId];
  const targets = Object.values(game.cartels).filter((c) => c.id !== cartel.id && !c.destroyed);
  showModal(`
    <h2>Arreglar matrimonio</h2>
    <p class="small text-dim">Elige con qué cártel quieres sellar la alianza a través de ${escapeHtml(member?.name || "")}.</p>
    ${targets.length ? targets.map((c) => `
      <button class="block" data-target-cartel="${c.id}">${escapeHtml(c.name)}</button>
    `).join("") : `<p class="small text-dim">No hay otros cárteles disponibles.</p>`}
    <button class="ghost block" id="close-btn">Cancelar</button>
  `);
  document.getElementById("close-btn").addEventListener("click", closeModal);
  document.querySelectorAll("[data-target-cartel]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const result = arrangeMarriage(game, familyMemberId, btn.dataset.targetCartel);
      closeModal();
      if (!result.ok && result.message) alert(result.message);
      app.setGame(game);
      app.render();
    });
  });
}

function showHeirModal(app, game) {
  const candidates = getDesignatableHeirs(game);
  showModal(`
    <h2>Designar heredero</h2>
    <p class="small text-dim">Elige quién tomará el control del cártel si te ocurre algo. Solo puedes elegir entre familiares directos y jefes de tu organigrama.</p>
    ${candidates.length ? candidates.map((c) => `
      <button class="block" data-heir-pick="${c.id}">
        <div class="person-row" style="border:none;padding:0">
          ${portraitImg(c)}
          <div class="info"><div class="name">${escapeHtml(c.name)}</div><div class="role">${c.role ? roleLabel(c.role) : "Familiar"}</div></div>
        </div>
      </button>
    `).join("") : `<p class="small text-dim">No hay candidatos disponibles ahora mismo.</p>`}
    <button class="ghost block" id="close-btn">Cancelar</button>
  `);
  document.getElementById("close-btn").addEventListener("click", closeModal);
  document.querySelectorAll("[data-heir-pick]").forEach((btn) => {
    btn.addEventListener("click", () => {
      designateHeir(game, btn.dataset.heirPick);
      closeModal();
      app.setGame(game);
      app.render();
    });
  });
}

function renderFamilyCard(c, playerId) {
  if (!c) return "";
  return `<div class="card tight" data-view="${c.id}" style="cursor:pointer">
    <div style="display:flex;gap:.5rem;align-items:center">
      ${portraitImg(c)}
      <div>
        <div class="name">${escapeHtml(c.name)}${c.id === playerId ? " (tú)" : ""}</div>
        <div class="small text-dim">${c.role ? roleLabel(c.role) : "Sin cargo"}${!c.alive ? " · ✝" : ""}</div>
      </div>
    </div>
  </div>`;
}
