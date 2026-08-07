import { getPlayerCartel } from "../../state.js";
import { escapeHtml, portraitImg, roleLabel } from "../../ui/components.js";
import { fmtMoney, fmtNum } from "../../utils/text.js";
import { showCartelProfile } from "./cartelProfile.js";
import { showCharacterProfile } from "./characterProfile.js";
import { getWorldMarketShare, getWarsForCartel } from "../../turnEngine.js";
import { ROLE_ORDER, STAT_ORDER, STATS } from "../../model.js";

const METRICS = [
  { key: "money", label: "Dinero", color: "#c9a13b" },
  { key: "armySize", label: "Ejército", color: "#b3261e" },
  { key: "heat", label: "Nivel de búsqueda", color: "#e05252" },
  { key: "publicImage", label: "Imagen pública", color: "#4c8b4c" },
  { key: "territories", label: "Territorios", color: "#5a8fc9" },
  { key: "worldMarketShare", label: "Cuota de mercado mundial", color: "#9b6fd1" },
];

function ordinal(n) {
  return `${n}º`;
}

export function render(container, app) {
  const game = app.game;
  const playerCartel = getPlayerCartel(game);
  const history = (game.history && game.history[playerCartel.id]) || [];
  const living = Object.values(game.cartels).filter((c) => !c.destroyed);

  const rankOf = (accessor) => {
    const sorted = [...living].sort((a, b) => accessor(b) - accessor(a));
    return sorted.findIndex((c) => c.id === playerCartel.id) + 1;
  };
  const rankTerritories = rankOf((c) => c.territories.length);
  const rankArmy = rankOf((c) => c.resources.armySize);
  const rankMoney = rankOf((c) => c.resources.money);
  const worldShare = getWorldMarketShare(game, playerCartel);
  const rankShare = rankOf((c) => getWorldMarketShare(game, c));

  const wars = getWarsForCartel(game, playerCartel.id);
  const warsOngoing = wars.filter((w) => !w.endYear).length;
  const casualtiesInflicted = wars.reduce((s, w) => s + (w.cartelA === playerCartel.id ? w.casualtiesB : w.casualtiesA), 0);
  const casualtiesSuffered = wars.reduce((s, w) => s + (w.cartelA === playerCartel.id ? w.casualtiesA : w.casualtiesB), 0);
  const territoriesWonInWar = wars.reduce((s, w) => s + w.territoryChanges.filter((tc) => tc.to === playerCartel.id).length, 0);

  const rosterIds = ROLE_ORDER.map((role) => playerCartel.roles[role]).filter((id, i, arr) => id && arr.indexOf(id) === i);
  const roster = rosterIds.map((id) => game.characters[id]).filter((c) => c && c.alive);
  const vacantCount = ROLE_ORDER.filter((role) => !playerCartel.roles[role]).length;
  const associates = Object.values(game.characters).filter((c) => c.cartelId === playerCartel.id && c.alive && !rosterIds.includes(c.id));
  const fallen = Object.values(game.characters).filter((c) => c.cartelId === playerCartel.id && !c.alive);
  const avgStat = (statKey) => roster.length ? Math.round(roster.reduce((s, c) => s + (c.stats?.[statKey] || 0), 0) / roster.length) : 0;

  container.innerHTML = `
    <div class="card">
      <h2>Resumen de ${escapeHtml(playerCartel.name)}</h2>
      <table style="width:100%;border-collapse:collapse" class="small">
        <tr><td>Posición por territorios</td><td class="center"><strong>${ordinal(rankTerritories)}</strong> de ${living.length}</td></tr>
        <tr><td>Posición por ejército</td><td class="center"><strong>${ordinal(rankArmy)}</strong> de ${living.length}</td></tr>
        <tr><td>Posición por dinero</td><td class="center"><strong>${ordinal(rankMoney)}</strong> de ${living.length}</td></tr>
        <tr><td>Posición por cuota de mercado mundial</td><td class="center"><strong>${ordinal(rankShare)}</strong> de ${living.length} (${worldShare.toFixed(1)}%)</td></tr>
      </table>
    </div>

    <div class="card">
      <h2>Evolución histórica</h2>
      ${history.length < 2 ? '<p class="text-dim small">Avanza algunos turnos para ver la evolución histórica.</p>' : METRICS.map((m) => `
        <h3>${m.label}</h3>
        <canvas class="mt-1" id="chart-${m.key}" width="600" height="100" style="width:100%;height:100px"></canvas>
      `).join("")}
    </div>

    <div class="card">
      <h2>Historial bélico (resumen)</h2>
      <table style="width:100%;border-collapse:collapse" class="small">
        <tr><td>Guerras libradas en total</td><td class="center">${wars.length}</td></tr>
        <tr><td>Guerras en curso ahora mismo</td><td class="center">${warsOngoing}</td></tr>
        <tr><td>Bajas infligidas al enemigo</td><td class="center text-success">${fmtNum(casualtiesInflicted)}</td></tr>
        <tr><td>Bajas propias sufridas</td><td class="center text-danger">${fmtNum(casualtiesSuffered)}</td></tr>
        <tr><td>Territorios ganados por la fuerza</td><td class="center">${territoriesWonInWar}</td></tr>
      </table>
      <p class="text-dim small mt-1">Detalle guerra por guerra en la pestaña Guerras.</p>
    </div>

    <div class="card">
      <h2>Cúpula y plantilla</h2>
      <table style="width:100%;border-collapse:collapse" class="small">
        <tr><td>Cargos de cúpula ocupados</td><td class="center">${roster.length} de ${ROLE_ORDER.length}${vacantCount ? ` (${vacantCount} vacantes)` : ""}</td></tr>
        <tr><td>Familia y allegados sin cargo</td><td class="center">${associates.length}</td></tr>
        <tr><td>Caídos del cártel (histórico)</td><td class="center">${fallen.length}</td></tr>
      </table>
      ${roster.length ? `
      <h3 class="mt-1">Nivel medio de la cúpula</h3>
      <table style="width:100%;border-collapse:collapse" class="small">
        ${STAT_ORDER.map((key) => `<tr><td>${STATS[key]}</td><td class="center">${avgStat(key)}</td></tr>`).join("")}
      </table>
      <h3 class="mt-1">Miembros de la cúpula</h3>
      ${roster.map((c) => `
        <div class="person-row" style="cursor:pointer" data-view-char="${c.id}">
          <div style="display:flex;gap:.6rem;flex:1;min-width:0;align-items:center">
            ${portraitImg(c)}
            <div class="info">
              <div class="name">${escapeHtml(c.name)}</div>
              <div class="role">${roleLabel(c.role, playerCartel)}</div>
            </div>
          </div>
        </div>
      `).join("")}
      ` : ""}
    </div>

    <div class="card">
      <h2>Comparativa entre cárteles</h2>
      <table style="width:100%;border-collapse:collapse" class="small">
        <tr class="text-dim"><th style="text-align:left">Cártel</th><th>Territorios</th><th>Ejército</th><th>Dinero</th><th>Búsqueda</th><th>Imagen</th><th>Mercado</th></tr>
        ${living.sort((a, b) => b.territories.length - a.territories.length).map((c) => `
          <tr data-view-cartel="${c.id}" style="cursor:pointer">
            <td>${escapeHtml(c.name)}${c.id === playerCartel.id ? " 👑" : ""}</td>
            <td class="center">${c.territories.length}</td>
            <td class="center">${fmtNum(c.resources.armySize)}</td>
            <td class="center">${fmtMoney(c.resources.money)}</td>
            <td class="center">${c.resources.heat}</td>
            <td class="center">${c.resources.publicImage}</td>
            <td class="center">${getWorldMarketShare(game, c).toFixed(1)}%</td>
          </tr>
        `).join("")}
      </table>
    </div>
  `;

  if (history.length >= 2) {
    for (const m of METRICS) drawSparkline(container.querySelector(`#chart-${m.key}`), history.map((h) => h[m.key] ?? 0), m.color);
  }

  container.querySelectorAll("[data-view-cartel]").forEach((el) => {
    el.addEventListener("click", () => showCartelProfile(app, el.dataset.viewCartel));
  });
  container.querySelectorAll("[data-view-char]").forEach((el) => {
    el.addEventListener("click", () => showCharacterProfile(app, el.dataset.viewChar));
  });
}

function drawSparkline(canvas, values, color) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = (i / (values.length - 1)) * (w - 4) + 2;
    const y = h - 4 - ((v - min) / range) * (h - 8);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}
