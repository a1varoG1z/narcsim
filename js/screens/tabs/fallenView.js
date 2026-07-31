import { portraitImg, escapeHtml, roleLabel } from "../../ui/components.js";
import { ROLE_ORDER } from "../../model.js";
import { showCharacterProfile } from "./characterProfile.js";

const SORTS = {
  importance: { label: "Importancia del cargo", cmp: (a, b) => importanceRank(a) - importanceRank(b) },
  cartel: { label: "Cártel", cmp: (a, b, game) => (game.cartels[a.cartelId]?.name || "").localeCompare(game.cartels[b.cartelId]?.name || "") },
  recent: { label: "Año de fallecimiento (más reciente)", cmp: (a, b) => (b.deathYear || 0) - (a.deathYear || 0) },
  oldest: { label: "Año de fallecimiento (más antiguo)", cmp: (a, b) => (a.deathYear || 0) - (b.deathYear || 0) },
};

function importanceRank(c) {
  if (!c.role) return ROLE_ORDER.length;
  const i = ROLE_ORDER.indexOf(c.role);
  return i === -1 ? ROLE_ORDER.length : i;
}

export function render(container, app) {
  const game = app.game;
  const deceased = Object.values(game.characters).filter((c) => !c.alive);
  const sortKey = app.state.fallenSort && SORTS[app.state.fallenSort] ? app.state.fallenSort : "importance";
  const sorted = [...deceased].sort((a, b) => SORTS[sortKey].cmp(a, b, game));

  container.innerHTML = `
    <div class="card">
      <h2>Caídos</h2>
      <p class="text-dim small">Todos los personajes que han muerto en esta partida, de cualquier cártel.</p>
      <label>Ordenar por</label>
      <select id="fallen-sort">
        ${Object.entries(SORTS).map(([key, s]) => `<option value="${key}" ${key === sortKey ? "selected" : ""}>${s.label}</option>`).join("")}
      </select>
    </div>
    <div class="card">
      ${sorted.length ? sorted.map((c) => {
        const cartel = game.cartels[c.cartelId];
        const age = c.deathYear && c.birthYear ? c.deathYear - c.birthYear : null;
        return `<div class="person-row" style="cursor:pointer" data-view="${c.id}">
          <div style="display:flex;gap:.6rem;flex:1;min-width:0">
            ${portraitImg(c)}
            <div class="info">
              <div class="name">${escapeHtml(c.name)}${c.historical ? " · histórico" : ""}</div>
              <div class="role">${c.role ? roleLabel(c.role) : "Sin cargo"}${cartel ? ` · ${escapeHtml(cartel.name)}` : ""}</div>
              <div class="small text-dim">Falleció en ${c.deathYear ?? "?"}${age !== null ? ` (${age} años)` : ""}</div>
              ${c.deathCause ? `<div class="small text-dim">Causa: ${escapeHtml(c.deathCause)}</div>` : ""}
            </div>
          </div>
        </div>`;
      }).join("") : `<p class="text-dim small">Nadie ha caído todavía en esta partida.</p>`}
    </div>
  `;

  container.querySelector("#fallen-sort").addEventListener("change", (e) => {
    app.setState({ fallenSort: e.target.value });
  });

  container.querySelectorAll("[data-view]").forEach((el) => {
    el.addEventListener("click", () => showCharacterProfile(app, el.dataset.view));
  });
}
