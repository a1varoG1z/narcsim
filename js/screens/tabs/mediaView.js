import { getPlayerCartel } from "../../state.js";
import { statBar, escapeHtml } from "../../ui/components.js";
import { applyAction, getActionsRemaining, ACTIONS_PER_TURN, ACTION_COSTS } from "../../turnEngine.js";
import { heatLabel, fmtMoney } from "../../utils/text.js";

const ACTIONS = [
  { type: "press_release", label: "Comunicado de prensa", desc: "Suaviza tu imagen ante la opinión pública local. Bajo riesgo, efecto modesto." },
  { type: "corridos_campaign", label: "Patrocinar corridos y narcocultura", desc: "Construye leyenda popular y reputación internacional, pero llama la atención: sube el heat." },
  { type: "social_work", label: "Obra social (escuelas, iglesias, caminos)", desc: "La estrategia clásica del 'Robin Hood': gran mejora de imagen y baja notable de heat." },
  { type: "international_interview", label: "Entrevista o documental internacional", desc: "Alto riesgo, alta recompensa: depende del carisma de tu líder o jefe de imagen. Si sale mal, expone al cártel." },
  { type: "damage_control", label: "Control de daños", desc: "Acalla un episodio violento reciente con una fuerte reducción de heat." },
];

export function render(container, app) {
  const game = app.game;
  const cartel = getPlayerCartel(game);
  const r = cartel.resources;
  const remaining = getActionsRemaining(game);

  container.innerHTML = `
    <div class="card">
      <h2>Medios e imagen pública</h2>
      ${statBar("Imagen pública", r.publicImage, "image")}
      ${statBar("Reputación internacional", r.internationalReputation ?? 15)}
      ${statBar("Nivel de búsqueda (heat)", r.heat, "heat")}
      <div class="small"><strong>${escapeHtml(heatLabel(r.heat))}</strong></div>
      <p class="text-dim small mt-1">La imagen pública mueve a la opinión local. La reputación internacional abre mercados de exportación más rentables (hasta un +25% de ingresos por territorio con fama máxima), pero la exposición tiene un precio en heat.</p>
    </div>
    <div class="card">
      <h3>Acciones de imagen</h3>
      <p class="text-dim small">Acciones disponibles este turno: ${remaining}/${ACTIONS_PER_TURN}.</p>
      ${ACTIONS.map((a) => {
        const cost = ACTION_COSTS[a.type] || 0;
        return `
        <button class="block" data-action="${a.type}" ${r.money < cost || remaining <= 0 ? "disabled" : ""}>
          <strong>${a.label}</strong> — ${fmtMoney(cost)}
          <div class="small text-dim">${a.desc}</div>
        </button>
      `;
      }).join("")}
    </div>
  `;

  container.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      applyAction(game, cartel.id, btn.dataset.action);
      app.setGame(game);
      app.render();
    });
  });
}
