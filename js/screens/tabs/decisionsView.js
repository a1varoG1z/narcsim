import { getPlayerCartel } from "../../state.js";
import { applyAction, getActionsRemaining, ACTIONS_PER_TURN, ACTION_COSTS, MONEY_SCALE } from "../../turnEngine.js";
import { showModal, closeModal } from "../../ui/modal.js";
import { escapeHtml } from "../../ui/components.js";
import { fmtMoney } from "../../utils/text.js";

const ACTIONS = [
  { type: "invest_production", label: "Invertir en producción", desc: "Financia laboratorios y cultivos. Riesgo de decomiso." },
  { type: "traffic_shipment", label: "Enviar cargamento", desc: "Mueve mercancía por tus rutas. Mayor riesgo y recompensa." },
  { type: "corrupt_gov", label: "Sobornar al gobierno", desc: "Aumenta tu corrupción política y reduce el heat." },
  { type: "corrupt_police", label: "Sobornar a la policía", desc: "Aumenta tu corrupción policial y reduce el heat." },
  { type: "recruit_army", label: "Reclutar sicarios", desc: "Aumenta tu ejército." },
  { type: "lay_low", label: "Bajar el perfil", desc: "Reduce fuertemente el heat de inmediato." },
];

const LAUNDER_AMOUNTS = [500 * MONEY_SCALE, 2000 * MONEY_SCALE, 10000 * MONEY_SCALE];

export function render(container, app) {
  const game = app.game;
  const cartel = getPlayerCartel(game);
  const remaining = getActionsRemaining(game);
  const exhausted = remaining <= 0;

  container.innerHTML = `
    <div class="card">
      <h2>Decisiones de este turno</h2>
      <p class="text-dim small">Tienes <strong>${remaining}/${ACTIONS_PER_TURN}</strong> acciones disponibles antes de avanzar el turno. Las decisiones diplomáticas y militares no gastan acciones.</p>
      ${ACTIONS.map((a) => {
        const cost = ACTION_COSTS[a.type] || 0;
        return `
        <button class="block" data-action="${a.type}" ${cartel.resources.money < cost || exhausted ? "disabled" : ""}>
          <strong>${a.label}</strong> ${cost ? `— ${fmtMoney(cost)}` : ""}
          <div class="small text-dim">${a.desc}</div>
        </button>
      `;
      }).join("")}
    </div>
    <div class="card">
      <h3>Lavado de dinero</h3>
      <p class="text-dim small">Convierte dinero caliente en dinero limpio a través de negocios legales. Se cobra una comisión (menor cuanto mejor sea tu jefe económico) y reduce el heat.</p>
      <div class="btn-row">
        ${LAUNDER_AMOUNTS.map((amount) => `
          <button data-launder="${amount}" ${cartel.resources.money < amount || exhausted ? "disabled" : ""}>Lavar ${fmtMoney(amount)}</button>
        `).join("")}
      </div>
      <p class="small text-dim mt-1">Total lavado hasta ahora: ${fmtMoney(cartel.resources.launderedMoney || 0)}</p>
    </div>
  `;

  container.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.action === "traffic_shipment") {
        showTrafficModal(app, game, cartel);
        return;
      }
      if (btn.dataset.action === "invest_production") {
        showProductionModal(app, game, cartel);
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

function showProductionModal(app, game, cartel) {
  const territories = cartel.territories.map((id) => game.territories[id]).filter(Boolean);
  showModal(`
    <h2>Invertir en producción</h2>
    <p class="small text-dim">Los territorios de mayor valor económico rinden más por la misma inversión de ${fmtMoney(ACTION_COSTS.invest_production)}.</p>
    ${territories.map((t) => `
      <button class="block" data-territory="${t.id}">
        ${escapeHtml(t.name)}
        <div class="small text-dim">Valor económico: ${t.value}</div>
      </button>
    `).join("")}
    <button class="ghost block" id="close-btn">Cancelar</button>
  `);
  document.getElementById("close-btn").addEventListener("click", closeModal);
  document.querySelectorAll("[data-territory]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const result = applyAction(game, cartel.id, "invest_production", { territoryId: btn.dataset.territory });
      app.setGame(game);
      closeModal();
      if (!result.ok) alert(result.message);
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
