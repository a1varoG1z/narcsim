import { getPlayerCartel } from "../../state.js";
import { escapeHtml } from "../../ui/components.js";
import { fmtMoney, fmtNum } from "../../utils/text.js";
import { getIncomeBreakdown, getWorldMarketShare } from "../../turnEngine.js";

export function render(container, app) {
  const game = app.game;
  const cartel = getPlayerCartel(game);
  const r = cartel.resources;
  const b = getIncomeBreakdown(game, cartel);
  const marketShare = getWorldMarketShare(game, cartel);
  const rivalShares = Object.values(game.cartels)
    .filter((c) => c.id !== cartel.id && !c.destroyed && c.resources.distributionVolume)
    .map((c) => ({ name: c.name, share: getWorldMarketShare(game, c) }))
    .sort((a, b2) => b2.share - a.share)
    .slice(0, 3);

  container.innerHTML = `
    <div class="card">
      <h2>Finanzas del cártel</h2>
      <p class="text-dim small">Esto es lo que ocurre automáticamente al avanzar el turno, antes de cualquier decisión que tomes.</p>
      <table style="width:100%;border-collapse:collapse" class="small">
        <tr><td>Ingreso por territorios</td><td class="center">${fmtMoney(b.baseIncome)}</td></tr>
        <tr><td>Bonus de exportación (reputación internacional, +${Math.round(b.exportBonusRate * 100)}%)</td><td class="center text-success">+${fmtMoney(b.exportBonus)}</td></tr>
        <tr style="border-top:1px solid var(--border)"><td><strong>Ingreso total</strong></td><td class="center"><strong>${fmtMoney(b.territoryIncome)}</strong></td></tr>
        ${b.propertyIncome ? `<tr><td>Propiedades</td><td class="center text-success">+${fmtMoney(b.propertyIncome)}</td></tr>` : ""}
        ${b.businessIncome ? `<tr><td>Negocios de fachada</td><td class="center text-success">+${fmtMoney(b.businessIncome)}</td></tr>` : ""}
        <tr><td>Mantenimiento del ejército (${fmtNum(r.armySize)} hombres)</td><td class="center text-danger">-${fmtMoney(b.upkeep)}</td></tr>
        <tr style="border-top:1px solid var(--border)"><td><strong>Balance neto por turno</strong></td><td class="center ${b.net >= 0 ? "text-success" : "text-danger"}"><strong>${b.net >= 0 ? "+" : ""}${fmtMoney(b.net)}</strong></td></tr>
      </table>
      ${b.net < 0 ? `<p class="text-danger small mt-1">Si no tienes efectivo suficiente para cubrir la nómina, parte de tu ejército desertará.</p>` : ""}
    </div>

    <div class="card">
      <h3>Ingreso por territorio</h3>
      <table style="width:100%;border-collapse:collapse" class="small">
        <tr class="text-dim"><th style="text-align:left">Territorio</th><th>Valor</th><th>Ingreso</th></tr>
        ${b.perTerritory.map((t) => `
          <tr><td>${escapeHtml(t.name)}</td><td class="center">${t.value}</td><td class="center">${fmtMoney(t.income)}</td></tr>
        `).join("") || `<tr><td colspan="3" class="text-dim center">Sin territorios</td></tr>`}
      </table>
    </div>

    <div class="card">
      <h3>Comercio internacional</h3>
      <p class="text-dim small">Cuota estimada del mercado mundial de la droga: el volumen acumulado de tus envíos ("Enviar cargamento") frente al de todos los demás cárteles de la partida — un cálculo de suma cero, no una cifra propia que solo puede subir.</p>
      <p class="small">Tu cuota: <strong>${marketShare.toFixed(1)}%</strong></p>
      ${r.tradeRouteBonus ? `<p class="small text-success">Rutas comerciales internacionales propias: +${Math.round(r.tradeRouteBonus * 100)}% de rendimiento en cada envío futuro.</p>` : `<p class="small text-dim">Sin rutas comerciales propias todavía — invierte en ellas desde la pestaña Decisiones.</p>`}
      ${rivalShares.length ? `
        <p class="small text-dim mt-1">Mayores rivales en el mercado:</p>
        <table style="width:100%;border-collapse:collapse" class="small">
          ${rivalShares.map((c) => `<tr><td>${escapeHtml(c.name)}</td><td class="center">${c.share.toFixed(1)}%</td></tr>`).join("")}
        </table>
      ` : ""}
    </div>

    <div class="card">
      <h3>Dinero lavado</h3>
      <p class="small">Total histórico lavado a través de negocios legales: <strong>${fmtMoney(r.launderedMoney || 0)}</strong></p>
      <p class="text-dim small">Gestiona el lavado de dinero y otras decisiones económicas desde la pestaña Decisiones.</p>
    </div>

    ${(r.artValue || r.weaponsBonus) ? `
    <div class="card">
      <h3>Otros activos</h3>
      ${r.artValue ? `<p class="small">Colección de arte y coleccionables (valor actual): <strong>${fmtMoney(r.artValue)}</strong></p>` : ""}
      ${r.weaponsBonus ? `<p class="small">Bonificación de combate por armamento: <strong>+${Math.round(r.weaponsBonus * 100)}%</strong></p>` : ""}
    </div>
    ` : ""}
  `;
}
