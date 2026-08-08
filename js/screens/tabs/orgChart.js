import { getPlayerCartel } from "../../state.js";
import { ROLE_ORDER } from "../../model.js";
import { portraitImg, escapeHtml, roleLabel } from "../../ui/components.js";
import { showCharacterProfile } from "./characterProfile.js";

export function render(container, app) {
  const game = app.game;
  const cartel = getPlayerCartel(game);
  const members = cartel.characters.map((id) => game.characters[id]).filter((c) => c && c.alive);

  container.innerHTML = `
    <div class="card">
      <h2>Organigrama — ${escapeHtml(cartel.name)}</h2>
      ${ROLE_ORDER.map((role) => {
        const holder = game.characters[cartel.roles[role]];
        return `
        <div class="person-row" data-role="${role}">
          ${holder ? `<div style="cursor:pointer;display:flex;gap:.6rem;flex:1;align-items:center" data-view="${holder.id}">
            ${portraitImg(holder)}
            <div class="info"><div class="name">${escapeHtml(holder.name)}</div><div class="role">${roleLabel(role, cartel)}</div></div>
          </div>` : `<div class="info"><div class="name text-dim">Vacante</div><div class="role">${roleLabel(role, cartel)}</div></div>`}
          <select data-assign="${role}">
            <option value="">Reasignar…</option>
            ${members.filter((m) => m.id !== holder?.id).map((m) => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join("")}
          </select>
        </div>`;
      }).join("")}
    </div>
    <div class="card">
      <h3>Todo el personal (${members.length})</h3>
      ${members.map((m) => `<div class="person-row" data-view="${m.id}" style="cursor:pointer">
        ${portraitImg(m)}
        <div class="info"><div class="name">${escapeHtml(m.name)}</div><div class="role">${m.role ? roleLabel(m.role, cartel) : "Sin cargo"}</div></div>
      </div>`).join("")}
    </div>
  `;

  container.querySelectorAll("[data-view]").forEach((el) => {
    el.addEventListener("click", () => showCharacterProfile(app, el.dataset.view));
  });

  container.querySelectorAll("[data-assign]").forEach((select) => {
    select.addEventListener("change", () => {
      const role = select.dataset.assign;
      const charId = select.value;
      if (!charId) return;
      const prevHolderId = cartel.roles[role];
      if (prevHolderId && game.characters[prevHolderId]) game.characters[prevHolderId].role = null;
      cartel.roles[role] = charId;
      game.characters[charId].role = role;
      app.setGame(game);
      app.render();
    });
  });
}
