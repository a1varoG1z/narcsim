import { getPlayerCartel } from "../../state.js";
import { applyAction } from "../../turnEngine.js";

const ACTIONS = [
  { type: "invest_production", label: "Invertir en producción", cost: 150, desc: "Financia laboratorios y cultivos. Riesgo de decomiso." },
  { type: "traffic_shipment", label: "Enviar cargamento", cost: 250, desc: "Mueve mercancía por tus rutas. Mayor riesgo y recompensa." },
  { type: "corrupt_gov", label: "Sobornar al gobierno", cost: 120, desc: "Aumenta tu corrupción política y reduce el heat." },
  { type: "corrupt_police", label: "Sobornar a la policía", cost: 120, desc: "Aumenta tu corrupción policial y reduce el heat." },
  { type: "recruit_army", label: "Reclutar sicarios", cost: 100, desc: "Aumenta tu ejército." },
  { type: "pr_campaign", label: "Campaña de imagen pública", cost: 150, desc: "Mejora tu imagen y reduce el heat." },
  { type: "lay_low", label: "Bajar el perfil", cost: 0, desc: "Reduce fuertemente el heat de inmediato." },
];

export function render(container, app) {
  const game = app.game;
  const cartel = getPlayerCartel(game);

  container.innerHTML = `
    <div class="card">
      <h2>Decisiones de este turno</h2>
      <p class="text-dim small">Puedes realizar varias acciones antes de avanzar el turno, mientras tengas dinero disponible.</p>
      ${ACTIONS.map((a) => `
        <button class="block" data-action="${a.type}" ${cartel.resources.money < a.cost ? "disabled" : ""}>
          <strong>${a.label}</strong> ${a.cost ? `— $${a.cost}` : ""}
          <div class="small text-dim">${a.desc}</div>
        </button>
      `).join("")}
      <div id="result" class="small mt-1"></div>
    </div>
  `;

  container.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const res = applyAction(game, cartel.id, btn.dataset.action);
      app.setGame(game);
      app.render();
    });
  });
}
