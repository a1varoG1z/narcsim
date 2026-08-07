import { portraitImg, escapeHtml, roleLabel } from "../../ui/components.js";
import { ROLE_ORDER } from "../../model.js";
import { showCharacterProfile } from "./characterProfile.js";

const SORTS = {
  importance: { label: "Importancia del cargo", cmp: (a, b) => importanceRank(a) - importanceRank(b) },
  cartel: { label: "Cártel", cmp: (a, b, game) => (game.cartels[a.cartelId]?.name || "").localeCompare(game.cartels[b.cartelId]?.name || "") },
  soonest: { label: "Salida más próxima", cmp: (a, b) => releaseRank(a) - releaseRank(b) },
  since: { label: "Encarcelado hace más tiempo", cmp: (a, b) => (a.imprisoned?.sinceTurn ?? 0) - (b.imprisoned?.sinceTurn ?? 0) },
};

function importanceRank(c) {
  if (!c.role) return ROLE_ORDER.length;
  const i = ROLE_ORDER.indexOf(c.role);
  return i === -1 ? ROLE_ORDER.length : i;
}

function releaseRank(c) {
  if (c.imprisoned?.lifeSentence) return Infinity;
  return c.imprisoned?.releaseTurn ?? Infinity;
}

export function render(container, app) {
  const game = app.game;
  const prisoners = Object.values(game.characters).filter((c) => c.alive && c.imprisoned);
  const sortKey = app.state.prisonersSort && SORTS[app.state.prisonersSort] ? app.state.prisonersSort : "importance";
  const sorted = [...prisoners].sort((a, b) => SORTS[sortKey].cmp(a, b, game));

  container.innerHTML = `
    <div class="card">
      <h2>Presos</h2>
      <p class="text-dim small">Todos los personajes actualmente encarcelados en esta partida, de cualquier cártel.</p>
      <label>Ordenar por</label>
      <select id="prisoners-sort">
        ${Object.entries(SORTS).map(([key, s]) => `<option value="${key}" ${key === sortKey ? "selected" : ""}>${s.label}</option>`).join("")}
      </select>
    </div>
    <div class="card">
      ${sorted.length ? sorted.map((c) => {
        const cartel = game.cartels[c.cartelId];
        const sentence = c.imprisoned.lifeSentence
          ? "Cadena perpetua"
          : c.imprisoned.releaseTurn !== null
          ? `Posible salida en el turno ${c.imprisoned.releaseTurn}`
          : "Duración indefinida";
        return `<div class="person-row" style="cursor:pointer" data-view="${c.id}">
          <div style="display:flex;gap:.6rem;flex:1;min-width:0">
            ${portraitImg(c)}
            <div class="info">
              <div class="name">${escapeHtml(c.name)}${c.historical ? " · histórico" : ""}</div>
              <div class="role">${c.role ? roleLabel(c.role, cartel) : "Sin cargo"}${cartel ? ` · ${escapeHtml(cartel.name)}` : ""}</div>
              <div class="small text-dim">Preso desde el turno ${c.imprisoned.sinceTurn} · ${sentence}</div>
            </div>
          </div>
        </div>`;
      }).join("") : `<p class="text-dim small">Nadie está en prisión ahora mismo en esta partida.</p>`}
    </div>
  `;

  container.querySelector("#prisoners-sort").addEventListener("change", (e) => {
    app.setState({ prisonersSort: e.target.value });
  });

  container.querySelectorAll("[data-view]").forEach((el) => {
    el.addEventListener("click", () => showCharacterProfile(app, el.dataset.view));
  });
}
