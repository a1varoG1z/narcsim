import { getPlayerCartel } from "../../state.js";
import { escapeHtml } from "../../ui/components.js";
import { fmtMoney, fmtNum } from "../../utils/text.js";
import { showCartelProfile } from "./cartelProfile.js";

const METRICS = [
  { key: "money", label: "Dinero", color: "#c9a13b" },
  { key: "armySize", label: "Ejército", color: "#b3261e" },
  { key: "heat", label: "Nivel de búsqueda", color: "#e05252" },
  { key: "publicImage", label: "Imagen pública", color: "#4c8b4c" },
  { key: "territories", label: "Territorios", color: "#5a8fc9" },
];

export function render(container, app) {
  const game = app.game;
  const playerCartel = getPlayerCartel(game);
  const history = (game.history && game.history[playerCartel.id]) || [];

  container.innerHTML = `
    <div class="card">
      <h2>Evolución de ${escapeHtml(playerCartel.name)}</h2>
      ${history.length < 2 ? '<p class="text-dim small">Avanza algunos turnos para ver la evolución histórica.</p>' : METRICS.map((m) => `
        <h3>${m.label}</h3>
        <canvas class="mt-1" id="chart-${m.key}" width="600" height="100" style="width:100%;height:100px"></canvas>
      `).join("")}
    </div>
    <div class="card">
      <h2>Comparativa entre cárteles</h2>
      <table style="width:100%;border-collapse:collapse" class="small">
        <tr class="text-dim"><th style="text-align:left">Cártel</th><th>Territorios</th><th>Ejército</th><th>Dinero</th></tr>
        ${Object.values(game.cartels).filter((c) => !c.destroyed).sort((a, b) => b.territories.length - a.territories.length).map((c) => `
          <tr data-view-cartel="${c.id}" style="cursor:pointer">
            <td>${escapeHtml(c.name)}${c.id === playerCartel.id ? " 👑" : ""}</td>
            <td class="center">${c.territories.length}</td>
            <td class="center">${fmtNum(c.resources.armySize)}</td>
            <td class="center">${fmtMoney(c.resources.money)}</td>
          </tr>
        `).join("")}
      </table>
    </div>
  `;

  if (history.length >= 2) {
    for (const m of METRICS) drawSparkline(container.querySelector(`#chart-${m.key}`), history.map((h) => h[m.key]), m.color);
  }

  container.querySelectorAll("[data-view-cartel]").forEach((el) => {
    el.addEventListener("click", () => showCartelProfile(app, el.dataset.viewCartel));
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
