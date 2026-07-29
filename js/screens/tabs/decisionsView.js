import { getPlayerCartel } from "../../state.js";
import { applyAction, getActionsRemaining, ACTIONS_PER_TURN, ACTION_COSTS, MONEY_SCALE } from "../../turnEngine.js";
import { showModal, closeModal } from "../../ui/modal.js";
import { escapeHtml } from "../../ui/components.js";
import { fmtMoney } from "../../utils/text.js";

const ACTIONS = [
  { type: "invest_production", label: "Invertir en producción", desc: "Financia laboratorios y cultivos. Riesgo de decomiso." },
  { type: "traffic_shipment", label: "Enviar cargamento", desc: "Mueve mercancía por tus rutas. Mayor riesgo y recompensa." },
  { type: "extort_territory", label: "Extorsionar un territorio", desc: "Cobro forzoso a comerciantes locales: dinero inmediato sin coste, a cambio de imagen pública y algo de heat." },
  { type: "corrupt_gov", label: "Sobornar al gobierno", desc: "Aumenta tu corrupción política y reduce el heat." },
  { type: "corrupt_police", label: "Sobornar a la policía", desc: "Aumenta tu corrupción policial y reduce el heat." },
  { type: "recruit_army", label: "Reclutar sicarios", desc: "Aumenta tu ejército." },
  { type: "lay_low", label: "Bajar el perfil", desc: "Reduce fuertemente el heat de inmediato." },
];

const LAUNDER_AMOUNTS = [500 * MONEY_SCALE, 2000 * MONEY_SCALE, 10000 * MONEY_SCALE];

const INVESTMENTS = [
  { type: "invest_property", label: "Comprar propiedades", desc: "Ingreso pasivo permanente cada turno, a cambio del capital inicial." },
  { type: "invest_art", label: "Invertir en arte y coleccionables", desc: "Una vía clásica de lavado: el valor se revaloriza solo mientras lo conserves. Véndelo cuando quieras." },
  { type: "invest_business", label: "Montar un negocio de fachada", desc: "Ingreso pasivo permanente y reduce el heat de inmediato: una tapadera legítima." },
  { type: "invest_weapons", label: "Armar y equipar a tu gente", desc: "Bonificación de combate permanente y acumulable (hasta un máximo), a cambio de heat." },
];

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
        const noTerritories = a.type === "extort_territory" && !cartel.territories.length;
        return `
        <button class="block" data-action="${a.type}" ${cartel.resources.money < cost || exhausted || noTerritories ? "disabled" : ""}>
          <strong>${a.label}</strong> ${cost ? `— ${fmtMoney(cost)}` : ""}
          <div class="small text-dim">${a.desc}</div>
        </button>
      `;
      }).join("")}
    </div>
    <div class="card">
      <h3>Desarrollo de territorio</h3>
      <p class="text-dim small">Invierte en infraestructura y rutas para un territorio tuyo, subiendo su valor económico de forma permanente (hasta un máximo). Es una inversión de crecimiento, no gasta acciones del turno.</p>
      <button class="block" id="develop-btn" ${!cartel.territories.length ? "disabled" : ""}>Desarrollar un territorio</button>
    </div>
    <div class="card">
      <h3>Inversiones</h3>
      <p class="text-dim small">Formas de diversificar el capital del cártel más allá del narcotráfico directo.</p>
      ${cartel.resources.propertyIncome ? `<p class="small text-success">Ingreso pasivo por propiedades: +${fmtMoney(cartel.resources.propertyIncome)}/turno</p>` : ""}
      ${cartel.resources.businessIncome ? `<p class="small text-success">Ingreso pasivo por negocios: +${fmtMoney(cartel.resources.businessIncome)}/turno</p>` : ""}
      ${cartel.resources.weaponsBonus ? `<p class="small text-success">Bonificación de combate: +${Math.round(cartel.resources.weaponsBonus * 100)}%</p>` : ""}
      ${INVESTMENTS.map((a) => {
        const cost = ACTION_COSTS[a.type] || 0;
        return `
        <button class="block" data-action="${a.type}" ${cartel.resources.money < cost || exhausted ? "disabled" : ""}>
          <strong>${a.label}</strong> — ${fmtMoney(cost)}
          <div class="small text-dim">${a.desc}</div>
        </button>
      `;
      }).join("")}
      ${cartel.resources.artValue ? `
        <button class="block" id="sell-art-btn" ${exhausted ? "disabled" : ""}>Vender la colección de arte (${fmtMoney(cartel.resources.artValue)})</button>
      ` : ""}
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
      if (btn.dataset.action === "extort_territory") {
        showExtortModal(app, game, cartel);
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

  container.querySelector("#develop-btn")?.addEventListener("click", () => {
    showDevelopModal(app, game, cartel);
  });

  container.querySelector("#sell-art-btn")?.addEventListener("click", () => {
    const result = applyAction(game, cartel.id, "sell_art");
    app.setGame(game);
    if (!result.ok) alert(result.message);
    else if (result.seized) alert(`Decomiso parcial: recibes ${fmtMoney(result.received)} tras perder ${fmtMoney(result.seized)}.`);
    else alert(`Vendes tu colección por ${fmtMoney(result.received)}.`);
    app.render();
  });
}

function showExtortModal(app, game, cartel) {
  const territories = cartel.territories.map((id) => game.territories[id]).filter(Boolean);
  showModal(`
    <h2>Extorsionar un territorio</h2>
    <p class="small text-dim">Elige qué territorio presionar. El pago es inmediato pero daña tu imagen pública y sube el heat.</p>
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
      const result = applyAction(game, cartel.id, "extort_territory", { territoryId: btn.dataset.territory });
      app.setGame(game);
      closeModal();
      if (!result.ok) alert(result.message);
      app.render();
    });
  });
}

function showDevelopModal(app, game, cartel) {
  const territories = cartel.territories.map((id) => game.territories[id]).filter(Boolean);
  showModal(`
    <h2>Desarrollar un territorio</h2>
    <p class="small text-dim">El coste crece con el valor actual del territorio; el máximo desarrollable es 40.</p>
    ${territories.map((t) => {
      const cost = t.value * 20 * MONEY_SCALE;
      const maxed = t.value >= 40;
      return `<button class="block" data-territory="${t.id}" ${maxed || cartel.resources.money < cost ? "disabled" : ""}>
        ${escapeHtml(t.name)}
        <div class="small text-dim">Valor económico: ${t.value}${maxed ? " (máximo)" : ` · Coste: ${fmtMoney(cost)}`}</div>
      </button>`;
    }).join("")}
    <button class="ghost block" id="close-btn">Cancelar</button>
  `);
  document.getElementById("close-btn").addEventListener("click", closeModal);
  document.querySelectorAll("[data-territory]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const result = applyAction(game, cartel.id, "develop_territory", { territoryId: btn.dataset.territory });
      app.setGame(game);
      closeModal();
      if (!result.ok) alert(result.message);
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
