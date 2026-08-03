import { getPlayerCartel } from "../../state.js";
import { escapeHtml } from "../../ui/components.js";
import { showModal, closeModal } from "../../ui/modal.js";
import { applyAction, isAttackable, getMarketProfiles, getRegionalMarketShare } from "../../turnEngine.js";
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
    ${renderTradeRoutes(game, playerCartel)}
  `;

  container.querySelectorAll("[data-territory]").forEach((el) => {
    el.addEventListener("click", () => showTerritoryModal(app, el.dataset.territory));
  });
  container.querySelectorAll("[data-view-cartel]").forEach((el) => {
    el.addEventListener("click", () => showCartelProfile(app, el.dataset.viewCartel));
  });
}

/** A schematic routes diagram (not the geographic territory map, which already has its own
 * coordinate system) showing your cartel's real destination markets as concrete lines instead of
 * an abstract percentage — active routes (ones you've actually shipped through) are drawn solid
 * and colored in your cartel's color, unused ones are a faint dashed line, so "having a market"
 * and "actually working that route" read differently at a glance. */
function renderTradeRoutes(game, playerCartel) {
  const markets = getMarketProfiles(game);
  if (markets.length <= 1) return "";

  const cx = 100;
  const cy = 100;
  const radius = 78;
  const nodes = markets.map((m, i) => {
    const angle = (Math.PI * 2 * i) / markets.length - Math.PI / 2;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    const active = !!playerCartel.resources.distributionVolumeByMarket?.[m.id];
    const share = getRegionalMarketShare(game, playerCartel, m.id);
    return { ...m, x, y, active, share };
  });

  return `
    <div class="card">
      <h3>Rutas comerciales internacionales</h3>
      <p class="text-dim small">Cada envío ("Enviar cargamento", pestaña Decisiones) elige un destino real. Las líneas sólidas son rutas que ya has trabajado de verdad; las discontinuas, mercados todavía sin explotar.</p>
      <svg viewBox="0 0 200 200" style="width:100%;max-width:360px;display:block;margin:0 auto" role="img" aria-label="Diagrama de rutas comerciales internacionales">
        ${nodes.map((n) => `
          <line x1="${cx}" y1="${cy}" x2="${n.x}" y2="${n.y}"
            stroke="${n.active ? playerCartel.color : "#666"}"
            stroke-width="${n.active ? 2.5 : 1.5}"
            stroke-dasharray="${n.active ? "" : "4,4"}"
            opacity="${n.active ? 0.9 : 0.4}" />
        `).join("")}
        <circle cx="${cx}" cy="${cy}" r="14" fill="${playerCartel.color}" />
        <text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="8" fill="#fff">Tú</text>
        ${nodes.map((n) => `
          <circle cx="${n.x}" cy="${n.y}" r="11" fill="${n.active ? playerCartel.color : "#2a2420"}" opacity="${n.active ? 1 : 0.6}" />
          <text x="${n.x}" y="${n.y - 16}" text-anchor="middle" font-size="7" fill="currentColor">${escapeHtml(n.name.split(" (")[0])}</text>
          ${n.active ? `<text x="${n.x}" y="${n.y + 4}" text-anchor="middle" font-size="7" fill="#fff">${n.share.toFixed(0)}%</text>` : ""}
        `).join("")}
      </svg>
    </div>
  `;
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
      <p>${result.success ? `Tu cártel ha extendido su influencia sobre ${escapeHtml(t.name)}.` : `El intento de ocupar ${escapeHtml(t.name)} no ha salido bien ante la resistencia local.`}</p>
      ${!result.success && result.casualties ? `<p class="small text-dim">Bajas propias: ${result.casualties}</p>` : ""}
      <button class="primary block" id="ok-btn">Aceptar</button>
    `);
    document.getElementById("ok-btn").addEventListener("click", () => {
      closeModal();
      app.render();
    });
  });
}
