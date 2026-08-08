import { showModal } from "../../ui/modal.js";
import { portraitImg, statBar, escapeHtml, roleLabel } from "../../ui/components.js";
import { STATS, STAT_ORDER, ROLE_ORDER, age } from "../../model.js";
import { currentYear, getPlayerCartel } from "../../state.js";
import { getMemberBond } from "../../events.js";
import { getWarsForCartel } from "../../turnEngine.js";

const HISTORY_ICON = { death: "💀", good: "✅", event: "⚠️" };

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
    ? `Falleció en ${c.deathYear}${c.deathCause ? ` por ${escapeHtml(c.deathCause)}` : ""}.`
    : c.imprisoned
    ? (c.imprisoned.lifeSentence ? "Cumple cadena perpetua." : `Preso, posible salida en el turno ${c.imprisoned.releaseTurn}.`)
    : "Activo.";
  const vendettaCartel = c.alive && c.vendetta ? game.cartels[c.vendetta.targetCartelId] : null;

  // "What has this person actually done" — reuses the same named-log-entry matching the turn
  // summary/significant-events views already rely on elsewhere, rather than tracking a whole
  // separate per-character event log. Capped to the most recent 40 mentions for readability;
  // the underlying game.log itself is capped at 400 entries game-wide, so extremely early events
  // in very long playthroughs may have already rolled off by the time you check this.
  const personalHistory = c.name
    ? game.log.filter((entry) => entry.text.includes(c.name)).slice(-40).reverse()
    : [];
  const isCurrentLeader = cartel && !cartel.destroyed && cartel.roles.leader === c.id;
  const cartelWars = isCurrentLeader ? getWarsForCartel(game, cartel.id).sort((a, b) => b.startYear - a.startYear) : [];

  showModal(`
    <div style="display:flex;gap:1rem;align-items:center">
      ${portraitImg(c, "lg")}
      <div>
        <h2>${escapeHtml(c.name)}</h2>
        <div class="text-dim small">${c.alive ? age(c, year) : age(c, c.deathYear)} años · ${c.role ? roleLabel(c.role, cartel) : "Sin cargo"} · ${escapeHtml(cartel?.name || "")}</div>
        <div class="small">${status}</div>
        ${vendettaCartel ? `<div class="small text-danger">🔪 Jura venganza contra ${escapeHtml(vendettaCartel.name)}</div>` : ""}
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
    ${cartelWars.length ? `
      <h3 class="mt-2">Guerras lideradas</h3>
      ${cartelWars.map((w) => {
        const otherId = w.cartelA === cartel.id ? w.cartelB : w.cartelA;
        const other = game.cartels[otherId];
        return `<p class="small text-dim">${w.startYear}${w.endYear ? ` – ${w.endYear}` : " – presente"}: contra ${escapeHtml(other?.name || "un cártel desaparecido")}${w.endYear ? " (terminada)" : " (en curso)"}</p>`;
      }).join("")}
    ` : ""}
    ${personalHistory.length ? `
      <h3 class="mt-2">Historial personal</h3>
      <div class="log" style="margin-bottom:1rem">
        ${personalHistory.map((entry) => `<div class="entry ${entry.type}">${HISTORY_ICON[entry.type] || "⚠️"} <span class="text-dim">${entry.year}</span> — ${escapeHtml(entry.text)}</div>`).join("")}
      </div>
    ` : ""}
    <button class="ghost block" id="close-profile">Cerrar</button>
  `);
  document.getElementById("close-profile").addEventListener("click", () => document.getElementById("modal-root").replaceChildren());
}
