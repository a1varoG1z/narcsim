import { getPlayerCartel } from "../../state.js";
import { escapeHtml } from "../../ui/components.js";
import { showModal, closeModal } from "../../ui/modal.js";
import { applyAction, isAttackable } from "../../turnEngine.js";
import { showCartelProfile } from "./cartelProfile.js";

export function render(container, app) {
  const game = app.game;
  const playerCartel = getPlayerCartel(game);

  container.innerHTML = `
    <div class="card">
      <h2>Mapa de territorios</h2>
      <div class="map" id="map">
        ${Object.values(game.territories).map((t) => {
          const controller = t.controllerId ? game.cartels[t.controllerId] : null;
          const color = controller ? controller.color : "#2a2420";
          const atWar = controller && playerCartel.relations[controller.id]?.status === "war";
          return `<div class="territory ${atWar ? "contested" : ""}" data-territory="${t.id}"
            style="left:${t.x}%;top:${t.y}%;width:${t.w}%;height:${t.h}%;background:${color}">
            ${escapeHtml(t.name)}
          </div>`;
        }).join("")}
      </div>
      <div class="grid auto mt-1">
        ${Object.values(game.cartels).filter((c) => !c.destroyed).map((c) => `
          <div class="small" data-view-cartel="${c.id}" style="cursor:pointer"><span style="display:inline-block;width:10px;height:10px;background:${c.color};border-radius:2px;margin-right:4px"></span>${escapeHtml(c.name)}</div>
        `).join("")}
      </div>
    </div>
  `;

  container.querySelectorAll("[data-territory]").forEach((el) => {
    el.addEventListener("click", () => showTerritoryModal(app, el.dataset.territory));
  });
  container.querySelectorAll("[data-view-cartel]").forEach((el) => {
    el.addEventListener("click", () => showCartelProfile(app, el.dataset.viewCartel));
  });
}

function showTerritoryModal(app, territoryId) {
  const game = app.game;
  const t = game.territories[territoryId];
  const controller = t.controllerId ? game.cartels[t.controllerId] : null;
  const playerCartel = getPlayerCartel(game);
  const isMine = t.controllerId === playerCartel.id;
  const attackable = !isMine && controller && isAttackable(game, playerCartel.id, t.id);
  const occupiable = !controller && isAttackable(game, playerCartel.id, t.id);
  const occupyCost = t.value * 15;
  const neighborNames = (t.adj || []).map((id) => game.territories[id]?.name).filter(Boolean).join(", ");

  showModal(`
    <h2>${escapeHtml(t.name)}</h2>
    <p class="small text-dim">Controlado por: ${controller ? escapeHtml(controller.name) : "Nadie (territorio libre)"}</p>
    <p class="small">Valor económico: ${t.value}</p>
    ${neighborNames ? `<p class="small text-dim">Linda con: ${escapeHtml(neighborNames)}</p>` : ""}
    ${attackable ? `<button class="danger block" id="attack-btn">Atacar y disputar este territorio</button>` : ""}
    ${!isMine && controller && !attackable ? `<p class="small text-dim">No tienes ningún territorio colindante: no puedes atacarlo directamente todavía.</p>` : ""}
    ${occupiable ? `<button class="primary block" id="occupy-btn">Ocupar territorio libre ($${occupyCost})</button>` : ""}
    ${!controller && !occupiable ? `<p class="small text-dim">Territorio libre, pero no linda con ninguno de tus dominios todavía.</p>` : ""}
    <button class="ghost block" id="close-btn">Cerrar</button>
  `);

  document.getElementById("close-btn").addEventListener("click", closeModal);
  document.getElementById("attack-btn")?.addEventListener("click", () => {
    const result = applyAction(game, playerCartel.id, "attack_territory", { territoryId });
    app.setGame(game);
    closeModal();
    showModal(`
      <h2>${result.attackerWins ? "¡Victoria!" : "Derrota"}</h2>
      <p>${result.attackerWins ? `Tu cártel ha conquistado ${escapeHtml(t.name)}.` : `El ataque a ${escapeHtml(t.name)} ha fracasado.`}</p>
      <p class="small text-dim">Bajas propias: ${result.casualtiesAtk} · Bajas enemigas: ${result.casualtiesDef}</p>
      <button class="primary block" id="ok-btn">Aceptar</button>
    `);
    document.getElementById("ok-btn").addEventListener("click", () => {
      closeModal();
      app.render();
    });
  });
  document.getElementById("occupy-btn")?.addEventListener("click", () => {
    const result = applyAction(game, playerCartel.id, "occupy_territory", { territoryId });
    app.setGame(game);
    closeModal();
    if (!result.ok) {
      alert(result.message);
      app.render();
      return;
    }
    showModal(`
      <h2>${result.success ? "¡Territorio ocupado!" : "Expedición fallida"}</h2>
      <p>${result.success ? `Tu cártel ha extendido su influencia sobre ${escapeHtml(t.name)}.` : `El intento de ocupar ${escapeHtml(t.name)} no ha salido bien esta vez.`}</p>
      <button class="primary block" id="ok-btn">Aceptar</button>
    `);
    document.getElementById("ok-btn").addEventListener("click", () => {
      closeModal();
      app.render();
    });
  });
}
