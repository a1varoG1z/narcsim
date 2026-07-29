import { getPlayerCartel } from "../../state.js";
import { applyAction } from "../../turnEngine.js";
import { showModal, closeModal } from "../../ui/modal.js";
import { escapeHtml } from "../../ui/components.js";

const ACTIONS = [
  { type: "invest_production", label: "Invertir en producción", cost: 150, desc: "Financia laboratorios y cultivos. Riesgo de decomiso." },
  { type: "traffic_shipment", label: "Enviar cargamento", cost: 250, desc: "Mueve mercancía por tus rutas. Mayor riesgo y recompensa." },
  { type: "corrupt_gov", label: "Sobornar al gobierno", cost: 120, desc: "Aumenta tu corrupción política y reduce el heat." },
  { type: "corrupt_police", label: "Sobornar a la policía", cost: 120, desc: "Aumenta tu corrupción policial y reduce el heat." },
  { type: "recruit_army", label: "Reclutar sicarios", cost: 100, desc: "Aumenta tu ejército." },
  { type: "lay_low", label: "Bajar el perfil", cost: 0, desc: "Reduce fuertemente el heat de inmediato." },
];

const LAUNDER_AMOUNTS = [500, 2000, 10000];

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
    </div>
    <div class="card">
      <h3>Lavado de dinero</h3>
      <p class="text-dim small">Convierte dinero caliente en dinero limpio a través de negocios legales. Se cobra una comisión (menor cuanto mejor sea tu jefe económico) y reduce el heat.</p>
      <div class="btn-row">
        ${LAUNDER_AMOUNTS.map((amount) => `
          <button data-launder="${amount}" ${cartel.resources.money < amount ? "disabled" : ""}>Lavar $${amount}</button>
        `).join("")}
      </div>
      <p class="small text-dim mt-1">Total lavado hasta ahora: $${Math.round(cartel.resources.launderedMoney || 0)}</p>
    </div>
  `;

  container.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.action === "traffic_shipment") {
        showTrafficModal(app, game, cartel);
        return;
      }
      applyAction(game, cartel.id, btn.dataset.action);
      app.setGame(game);
      app.render();
    });
  });

  container.querySelectorAll("[data-launder]").forEach((btn) => {
    btn.addEventListener("click", () => {
      applyAction(game, cartel.id, "launder_money", { amount: Number(btn.dataset.launder) });
      app.setGame(game);
      app.render();
    });
  });
}

function showTrafficModal(app, game, cartel) {
  const partners = Object.values(game.cartels).filter((c) => c.id !== cartel.id && !c.destroyed);
  showModal(`
    <h2>Enviar cargamento</h2>
    <p class="small text-dim">Vender a un socio conocido cambia el resultado: los aliados pagan mejor, los rivales en guerra ni se plantean; el mercado abierto es la opción neutra de siempre.</p>
    <button class="block primary" data-partner="">Mercado abierto (sin socio)</button>
    ${partners.map((p) => {
      const status = cartel.relations[p.id]?.status || "neutral";
      const label = status === "alliance" ? "Aliado — mejor precio" : status === "war" ? "En guerra — no disponible" : "Neutral";
      return `<button class="block" data-partner="${p.id}" ${status === "war" ? "disabled" : ""}>
        ${escapeHtml(p.name)}
        <div class="small text-dim">${label}</div>
      </button>`;
    }).join("")}
    <button class="ghost block" id="close-btn">Cancelar</button>
  `);
  document.getElementById("close-btn").addEventListener("click", closeModal);
  document.querySelectorAll("[data-partner]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const partnerCartelId = btn.dataset.partner || undefined;
      const result = applyAction(game, cartel.id, "traffic_shipment", { partnerCartelId });
      app.setGame(game);
      closeModal();
      if (!result.ok) alert(result.message);
      app.render();
    });
  });
}
