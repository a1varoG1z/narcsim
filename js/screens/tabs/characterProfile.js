import { showModal } from "../../ui/modal.js";
import { portraitImg, statBar, escapeHtml, roleLabel } from "../../ui/components.js";
import { STATS, STAT_ORDER, ROLE_ORDER, age } from "../../model.js";
import { currentYear, getPlayerCartel } from "../../state.js";
import { getMemberBond } from "../../events.js";

export function showCharacterProfile(app, characterId) {
  const game = app.game;
  const c = game.characters[characterId];
  if (!c) return;
  const year = currentYear(game);
  const playerCartel = getPlayerCartel(game);
  const showBond = c.id !== game.playerCharacterId && playerCartel && c.cartelId === playerCartel.id && c.bondWithPlayer !== undefined;
  const cartel = game.cartels[c.cartelId];
  const memberBonds = c.role && cartel && c.alive && !c.imprisoned
    ? ROLE_ORDER
        .map((r) => cartel.roles[r])
        .filter((id, i, arr) => id && id !== c.id && id !== game.playerCharacterId && arr.indexOf(id) === i)
        .map((id) => game.characters[id])
        .filter((other) => other && other.alive && !other.imprisoned)
        .map((other) => ({ other, bond: getMemberBond(game, c.id, other.id) }))
        .sort((a, b) => b.bond - a.bond)
    : [];
  const parents = (c.parents || []).map((id) => game.characters[id]).filter(Boolean);
  const spouse = c.spouseId ? game.characters[c.spouseId] : null;
  const children = (c.childrenIds || []).map((id) => game.characters[id]).filter(Boolean);
  const status = !c.alive
    ? `Falleció en ${c.deathYear}.`
    : c.imprisoned
    ? (c.imprisoned.lifeSentence ? "Cumple cadena perpetua." : `Preso, posible salida en el turno ${c.imprisoned.releaseTurn}.`)
    : "Activo.";

  showModal(`
    <div style="display:flex;gap:1rem;align-items:center">
      ${portraitImg(c, "lg")}
      <div>
        <h2>${escapeHtml(c.name)}</h2>
        <div class="text-dim small">${c.alive ? age(c, year) : age(c, c.deathYear)} años · ${c.role ? roleLabel(c.role) : "Sin cargo"} · ${escapeHtml(cartel?.name || "")}</div>
        <div class="small">${status}</div>
      </div>
    </div>
    <h3 class="mt-2">Atributos</h3>
    ${STAT_ORDER.map((k) => statBar(STATS[k], c.stats[k])).join("")}
    ${showBond ? `<h3 class="mt-2">Vínculo contigo</h3>${statBar("Vínculo", c.bondWithPlayer)}` : ""}
    ${memberBonds.length ? `
      <h3 class="mt-2">Vínculos con otros mandos</h3>
      ${memberBonds.map((mb) => `
        <div class="small" style="display:flex;justify-content:space-between;gap:.5rem">
          <span>${escapeHtml(mb.other.name)}</span>
          <span class="text-dim">${mb.bond}/100</span>
        </div>
      `).join("")}
    ` : ""}
    <h3 class="mt-2">Familia</h3>
    <p class="small">
      ${parents.length ? "Padres: " + parents.map((p) => escapeHtml(p.name)).join(", ") + "<br>" : ""}
      ${spouse ? "Cónyuge: " + escapeHtml(spouse.name) + "<br>" : ""}
      ${children.length ? "Hijos: " + children.map((ch) => escapeHtml(ch.name)).join(", ") : "Sin descendencia registrada."}
    </p>
    ${c.notes ? `<h3 class="mt-2">Notas</h3><p class="small text-dim">${escapeHtml(c.notes)}</p>` : ""}
    <button class="ghost block" id="close-profile">Cerrar</button>
  `);
  document.getElementById("close-profile").addEventListener("click", () => document.getElementById("modal-root").replaceChildren());
}
