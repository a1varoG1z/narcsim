import { getPlayerCartel, getPlayerCharacter, currentYear } from "../../state.js";
import { portraitImg, escapeHtml, roleLabel } from "../../ui/components.js";
import { showCharacterProfile } from "./characterProfile.js";
import { generateNpc, randomName } from "../../npcGenerator.js";
import { chance } from "../../utils/random.js";

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
      ${!player.spouseId ? `<button class="block mt-1" id="seek-romance">Buscar pareja</button>` : ""}
      ${player.spouseId && cartel.characters.length ? `<button class="block mt-1" id="try-child">Intentar tener un hijo/a</button>` : ""}
    </div>
    <div class="card">
      <h3>Vínculos y lealtades del cártel</h3>
      <p class="text-dim small">La lealtad de cada miembro depende de tu Liderazgo frente a su Astucia: cuanto más se acerquen o superen tu Liderazgo, mayor riesgo de traición o deserción.</p>
      ${cartelMembers.filter((m) => m.role).map((m) => {
        const risk = Math.max(0, m.stats.intrigue - player.stats.loyaltyInspiring);
        const label = risk > 40 ? "Alto riesgo de traición" : risk > 15 ? "Lealtad incierta" : "Leal";
        const cls = risk > 40 ? "text-danger" : risk > 15 ? "text-dim" : "text-success";
        return `<div class="person-row" data-view="${m.id}" style="cursor:pointer">
          ${portraitImg(m)}
          <div class="info"><div class="name">${escapeHtml(m.name)}</div><div class="role">${roleLabel(m.role)}</div></div>
          <div class="small ${cls}">${label}</div>
        </div>`;
      }).join("")}
    </div>
  `;

  container.querySelectorAll("[data-view]").forEach((el) => {
    el.addEventListener("click", () => showCharacterProfile(app, el.dataset.view));
  });

  container.querySelector("#seek-romance")?.addEventListener("click", () => {
    const spouseSex = player.sex === "M" ? "F" : "M";
    const spouse = generateNpc({ cartelId: cartel.id, role: null, currentYear: year, minAge: 18, maxAge: 45 });
    spouse.sex = spouseSex;
    spouse.name = randomName(spouseSex);
    spouse.spouseId = player.id;
    game.characters[spouse.id] = spouse;
    cartel.characters.push(spouse.id);
    player.spouseId = spouse.id;
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
