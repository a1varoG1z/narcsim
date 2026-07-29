import { getPlayerCartel, getPlayerCharacter, currentYear } from "../../state.js";
import { portraitImg, escapeHtml, roleLabel, statBar } from "../../ui/components.js";
import { showCharacterProfile } from "./characterProfile.js";
import { generateNpc, randomName } from "../../npcGenerator.js";
import { chance, clamp } from "../../utils/random.js";
import { strengthenBond } from "../../turnEngine.js";
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
