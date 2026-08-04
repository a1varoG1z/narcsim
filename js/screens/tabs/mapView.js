import { getPlayerCartel } from "../../state.js";
import { escapeHtml } from "../../ui/components.js";
import { showModal, closeModal } from "../../ui/modal.js";
import {
  applyAction, isAttackable, getMarketProfiles, getRegionalMarketShare,
  estimateConquestDifficulty, estimateOccupyChance, getActionsRemaining, ACTION_COSTS, MONEY_SCALE,
  canProposeAbsorption, PROPOSE_ABSORPTION_COST,
} from "../../turnEngine.js";
import { fmtMoney } from "../../utils/text.js";
import { showCartelProfile } from "./cartelProfile.js";
import { getGeoShapes, preloadGeoShapes } from "../../geoShapes.js";

// Persists across re-renders within the page session (module-level, not per-game state) so
// conquering a territory or switching tabs and back doesn't reset wherever the player had
// panned/zoomed to — it's a viewing convenience, not something worth persisting to a save file.
let currentViewBox = null; // [vx, vy, vw, vh], mutated in place by pan/zoom
let defaultViewBox = null;
// Recomputed whenever the loaded game changes (new era, loaded save, etc.) — otherwise the view
// left over from a previous game would stick around after switching without a full page reload.
let lastGameKey = null;
// Also a view preference, not game state: the map is the centerpiece of the game (per explicit
// user feedback — it felt like a small tab panel, not the CK3-style focal point it should be),
// so a fullscreen mode lets it take over the whole viewport instead of sharing space with the
// legend and trade-route diagram below it.
let isFullscreen = false;
let escapeFullscreenHandler = null;

export function render(container, app) {
  const game = app.game;
  const playerCartel = getPlayerCartel(game);
  const geo = getGeoShapes();
  if (!geo) preloadGeoShapes().then(() => app.render());

  const gameKey = `${game.eraId}:${game.playerCartelId}`;
  if (geo && (!currentViewBox || gameKey !== lastGameKey)) {
    lastGameKey = gameKey;
    // Zoom to fit the player's own starting territories (with generous padding for nearby
    // rivals/neighbors), not a fixed "all of Latin America" rectangle — an era where the player
    // starts holding a handful of small Colombian departments needs a much tighter default than
    // one where they start holding whole Mexican states, or the small departments render as an
    // illegible cluster of a few pixels each (real feedback from a user screenshot). Falls back
    // to the stored regional (Latin America) view if the player is landless for some reason.
    // geo.viewBox (the full world) is always still reachable by zooming out.
    defaultViewBox = computeDefaultViewBox(game, playerCartel, geo);
    currentViewBox = defaultViewBox.slice();
  }

  container.innerHTML = `
    <div class="card">
      <h2>Mapa de territorios</h2>
      <div class="map${isFullscreen ? " fullscreen" : ""}" id="map">
        ${geo ? renderGeoMap(game, playerCartel, geo) : `<p class="text-dim small center" style="padding:2rem">Cargando el mapa…</p>`}
        ${geo ? `
          <div class="map-controls">
            <button type="button" id="map-zoom-in" aria-label="Acercar">+</button>
            <button type="button" id="map-zoom-out" aria-label="Alejar">−</button>
            <button type="button" id="map-zoom-reset" aria-label="Restablecer vista">⟲</button>
            <button type="button" id="map-fullscreen-btn" aria-label="${isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}">${isFullscreen ? "✕" : "⛶"}</button>
          </div>
        ` : ""}
      </div>
      <p class="text-dim small mt-1">Arrastra para mover el mapa, usa la rueda del ratón o pellizca con dos dedos para hacer zoom. El botón ⛶ lo pone a pantalla completa.</p>
      <div class="grid auto mt-1">
        ${Object.values(game.cartels).filter((c) => !c.destroyed).map((c) => `
          <div class="small" data-view-cartel="${c.id}" style="cursor:pointer"><span style="display:inline-block;width:10px;height:10px;background:${c.color};border-radius:2px;margin-right:4px"></span>${escapeHtml(c.name)}</div>
        `).join("")}
      </div>
    </div>
    ${renderTradeRoutes(game, playerCartel)}
  `;

  if (geo) setupMapInteraction(container, app, geo);

  document.getElementById("map-fullscreen-btn")?.addEventListener("click", () => {
    isFullscreen = !isFullscreen;
    app.render();
  });

  // `render()` re-runs on every game state change while this tab is open (not just once), so the
  // previous render's Escape listener — still attached to `document`, which never gets torn down
  // like `container` does — must be removed first or they'd pile up one per render.
  document.removeEventListener("keydown", escapeFullscreenHandler);
  if (isFullscreen) {
    escapeFullscreenHandler = (e) => {
      if (e.key === "Escape") {
        isFullscreen = false;
        app.render();
      }
    };
    document.addEventListener("keydown", escapeFullscreenHandler);
  }

  container.querySelectorAll("[data-view-cartel]").forEach((el) => {
    el.addEventListener("click", () => showCartelProfile(app, el.dataset.viewCartel));
  });
}

/** Bounding box of the player's own territories, padded out so nearby rivals/neighbors are
 * visible too — not just the player's own tiles pressed against the edge of the screen. */
function computeDefaultViewBox(game, playerCartel, geo) {
  const ownShapes = playerCartel.territories
    .map((id) => game.territories[id])
    .filter((t) => t && geo.shapes[t.geo])
    .map((t) => geo.shapes[t.geo]);
  if (!ownShapes.length) return geo.regionalViewBox || geo.viewBox;

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const shape of ownShapes) {
    if (shape.point) {
      x0 = Math.min(x0, shape.cx); y0 = Math.min(y0, shape.cy);
      x1 = Math.max(x1, shape.cx); y1 = Math.max(y1, shape.cy);
    } else {
      x0 = Math.min(x0, shape.bbox[0]); y0 = Math.min(y0, shape.bbox[1]);
      x1 = Math.max(x1, shape.bbox[2]); y1 = Math.max(y1, shape.bbox[3]);
    }
  }
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const PAD_FACTOR = 4.5; // wide enough to see neighboring rivals/free territory, not just your own tiles
  const MIN_SIZE = 70; // a floor so a single small starting territory doesn't zoom in absurdly tight
  const boxW = Math.max((x1 - x0) * PAD_FACTOR, MIN_SIZE);
  const boxH = Math.max((y1 - y0) * PAD_FACTOR, MIN_SIZE);
  return [cx - boxW / 2, cy - boxH / 2, boxW, boxH];
}

/** Pan (drag or one-finger touch) and zoom (wheel, +/-/reset buttons, or two-finger pinch) over
 * the map's SVG viewBox — a click that didn't move (beyond a small threshold) still opens the
 * territory modal as before; a drag or pinch never does. */
function setupMapInteraction(container, app, geo) {
  const mapEl = container.querySelector("#map");
  const svgEl = mapEl.querySelector("svg");
  if (!svgEl) return;

  const MIN_WIDTH = defaultViewBox[2] / 12; // most zoomed in
  const MAX_WIDTH = geo.viewBox[2]; // most zoomed out: the whole world, never further

  function applyViewBox() {
    svgEl.setAttribute("viewBox", currentViewBox.join(" "));
  }
  applyViewBox();

  function zoomBy(factor, centerClientX, centerClientY) {
    const rect = svgEl.getBoundingClientRect();
    const [vx, vy, vw, vh] = currentViewBox;
    const cx = centerClientX == null ? vx + vw / 2 : vx + ((centerClientX - rect.left) / rect.width) * vw;
    const cy = centerClientY == null ? vy + vh / 2 : vy + ((centerClientY - rect.top) / rect.height) * vh;
    let newW = vw / factor;
    newW = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, newW));
    const appliedFactor = vw / newW;
    const newH = vh / appliedFactor;
    currentViewBox = [cx - (cx - vx) / appliedFactor, cy - (cy - vy) / appliedFactor, newW, newH];
    applyViewBox();
  }

  document.getElementById("map-zoom-in")?.addEventListener("click", () => zoomBy(1.5));
  document.getElementById("map-zoom-out")?.addEventListener("click", () => zoomBy(1 / 1.5));
  document.getElementById("map-zoom-reset")?.addEventListener("click", () => {
    currentViewBox = defaultViewBox.slice();
    applyViewBox();
  });

  svgEl.addEventListener("wheel", (e) => {
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY);
  }, { passive: false });

  const pointers = new Map(); // pointerId -> {x, y}
  let dragged = false;
  let lastMid = null;
  let lastDist = null;
  // `setPointerCapture` below keeps the drag tracking events flowing to svgEl even if the
  // pointer leaves it mid-gesture — but it also *retargets* the eventual pointerup/click to
  // svgEl itself, so a child <path>/<circle> never actually receives its own click. Recording
  // the real target here, before capture takes effect, is what makes tap-to-open-territory work.
  let downTarget = null;

  svgEl.addEventListener("pointerdown", (e) => {
    downTarget = e.target.closest("[data-territory]");
    try { svgEl.setPointerCapture(e.pointerId); } catch { /* not a capturable pointer (e.g. some synthetic events) — pan/zoom still works via bubbling */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragged = false;
    lastMid = null;
    lastDist = null;
  });

  svgEl.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.values()];
    const rect = svgEl.getBoundingClientRect();
    const scaleX = currentViewBox[2] / rect.width;
    const scaleY = currentViewBox[3] / rect.height;

    if (pts.length === 1) {
      const [p] = pts;
      if (lastMid) {
        const dx = (p.x - lastMid.x) * scaleX;
        const dy = (p.y - lastMid.y) * scaleY;
        if (Math.abs(p.x - lastMid.x) > 3 || Math.abs(p.y - lastMid.y) > 3) dragged = true;
        currentViewBox[0] -= dx;
        currentViewBox[1] -= dy;
        applyViewBox();
      }
      lastMid = p;
    } else if (pts.length >= 2) {
      const [p1, p2] = pts;
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      if (lastMid && lastDist) {
        const dx = (mid.x - lastMid.x) * scaleX;
        const dy = (mid.y - lastMid.y) * scaleY;
        currentViewBox[0] -= dx;
        currentViewBox[1] -= dy;
        if (dist !== lastDist) zoomBy(dist / lastDist, mid.x, mid.y);
        else applyViewBox();
        dragged = true;
      }
      lastMid = mid;
      lastDist = dist;
    }
  });

  function endPointer(e) {
    const wasSingleTap = pointers.size === 1 && !dragged && downTarget;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) lastDist = null;
    if (pointers.size === 0) lastMid = null;
    if (wasSingleTap) {
      const territoryId = downTarget.dataset.territory;
      downTarget = null;
      showTerritoryModal(app, territoryId);
    }
  }
  svgEl.addEventListener("pointerup", endPointer);
  svgEl.addEventListener("pointercancel", () => {
    pointers.clear();
    lastDist = null;
    lastMid = null;
    downTarget = null;
  });
}

/** Real administrative-boundary shapes (see js/geoShapes.js) instead of schematic rectangles —
 * every territory maps to a real country/state/department polygon, or (for the handful of
 * historically meaningful but administratively informal areas, like a specific border plaza or a
 * multi-department drug corridor with no official boundary) a small marker circle at its real
 * approximate location instead of a fabricated silhouette. */
function renderGeoMap(game, playerCartel, geo) {
  const [vx, vy, vw, vh] = geo.regionalViewBox || geo.viewBox;
  const territories = Object.values(game.territories).filter((t) => geo.shapes[t.geo]);
  // Labels only fit inside reasonably large shapes — small states/departments would just get
  // clutter. Names are always available via hover tooltip and the click-through detail modal.
  const LABEL_MIN_AREA = 55;
  return `
    <svg viewBox="${vx} ${vy} ${vw} ${vh}" role="img" aria-label="Mapa de territorios">
      ${territories.map((t) => {
        const shape = geo.shapes[t.geo];
        const controller = t.controllerId ? game.cartels[t.controllerId] : null;
        const color = controller ? controller.color : "#2a2420";
        const atWar = controller && playerCartel.relations[controller.id]?.status === "war";
        const cls = `territory-shape${atWar ? " contested" : ""}`;
        if (shape.point) {
          return `<circle class="${cls}" data-territory="${t.id}" cx="${shape.cx}" cy="${shape.cy}" r="3.2" fill="${color}" stroke="#000" stroke-width="0.4"><title>${escapeHtml(t.name)}</title></circle>`;
        }
        return `<path class="${cls}" data-territory="${t.id}" d="${shape.d}" fill="${color}" stroke="#000" stroke-width="0.3"><title>${escapeHtml(t.name)}</title></path>`;
      }).join("")}
      ${territories.map((t) => {
        const shape = geo.shapes[t.geo];
        if (shape.point) return "";
        const [bx0, by0, bx1, by1] = shape.bbox;
        if ((bx1 - bx0) * (by1 - by0) < LABEL_MIN_AREA) return "";
        return `<text x="${shape.cx}" y="${shape.cy}" text-anchor="middle" font-size="3.2" fill="#fff" style="pointer-events:none;text-shadow:0 0 2px #000" >${escapeHtml(t.name)}</text>`;
      }).join("")}
    </svg>
  `;
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

/** CK3-style territory panel: who holds it, how hard it'd be to take, and — when it's yours —
 * the concrete business actions available on it, all from one click instead of hunting through
 * the Decisiones tab for a territory-scoped version of the same actions. */
function showTerritoryModal(app, territoryId) {
  const game = app.game;
  const t = game.territories[territoryId];
  const controller = t.controllerId ? game.cartels[t.controllerId] : null;
  const playerCartel = getPlayerCartel(game);
  const isMine = t.controllerId === playerCartel.id;
  const attackable = !isMine && controller && isAttackable(game, playerCartel.id, t.id);
  const occupiable = !controller && isAttackable(game, playerCartel.id, t.id);
  const occupyCost = t.value * 15 * MONEY_SCALE;
  const neighborNames = (t.adj || []).map((id) => game.territories[id]?.name).filter(Boolean).join(", ");
  const difficulty = attackable ? estimateConquestDifficulty(game, playerCartel, t) : null;
  const occupyChance = occupiable ? estimateOccupyChance(game, playerCartel, t) : null;
  const actionsLeft = getActionsRemaining(game);
  const relStatus = controller ? (playerCartel.relations[controller.id]?.status || "neutral") : null;

  showModal(`
    <h2>${escapeHtml(t.name)}</h2>
    <p class="small text-dim">
      Controlado por: ${controller ? `<a href="#" id="view-controller">${escapeHtml(controller.name)}</a>` : "Nadie (territorio libre)"}
    </p>
    <p class="small">Valor económico: ${t.value} <span class="text-dim">(genera ${fmtMoney(t.value * 10 * MONEY_SCALE)}/turno en manos de su dueño, antes de bonus de exportación)</span></p>
    ${neighborNames ? `<p class="small text-dim">Linda con: ${escapeHtml(neighborNames)}</p>` : ""}

    ${controller && !isMine ? `
      <div class="card tight mt-1">
        <h3>Conquista</h3>
        ${attackable ? `
          <p class="small">Dificultad estimada: <strong>${difficulty.label}</strong> <span class="text-dim">(fuerza relativa ${(difficulty.ratio * 100).toFixed(0)}%)</span></p>
          <button class="danger block" id="attack-btn">Atacar y disputar este territorio</button>
        ` : `<p class="small text-dim">No tienes ningún territorio colindante: no puedes atacarlo directamente todavía.</p>`}
      </div>
      <div class="card tight mt-1">
        <h3>Diplomacia con ${escapeHtml(controller.name)}</h3>
        ${relStatus === "neutral" ? `<button class="block" id="map-alliance-btn">Proponer alianza</button>` : ""}
        ${relStatus === "war" ? `<button class="block" id="map-peace-btn">Proponer paz (sin condiciones)</button>` : ""}
        <button class="block" id="map-absorb-btn" ${playerCartel.resources.money < PROPOSE_ABSORPTION_COST || !canProposeAbsorption(playerCartel, controller) ? "disabled" : ""}>
          Proponer subordinación (${fmtMoney(PROPOSE_ABSORPTION_COST)})
        </button>
        <p class="small text-dim">Gestión completa de guerra, paz (con cesión de territorio o indemnización) y más negociaciones en la pestaña Diplomacia.</p>
      </div>
    ` : ""}

    ${!controller ? `
      <div class="card tight mt-1">
        <h3>Ocupación</h3>
        ${occupiable ? `
          <p class="small">Probabilidad de éxito estimada: <strong>${(occupyChance * 100).toFixed(0)}%</strong></p>
          <button class="primary block" id="occupy-btn">Ocupar territorio libre (${fmtMoney(occupyCost)})</button>
        ` : `<p class="small text-dim">Territorio libre, pero no linda con ninguno de tus dominios todavía.</p>`}
      </div>
    ` : ""}

    ${isMine ? `
      <div class="card tight mt-1">
        <h3>Opciones de negocio aquí</h3>
        <p class="small text-dim">Te quedan ${actionsLeft} acción(es) este turno.</p>
        <button class="block" id="invest-production-btn" ${actionsLeft <= 0 || playerCartel.resources.money < ACTION_COSTS.invest_production ? "disabled" : ""}>
          Invertir en producción aquí (${fmtMoney(ACTION_COSTS.invest_production)})
        </button>
        <button class="block" id="develop-btn" ${actionsLeft <= 0 || t.value >= 40 || playerCartel.resources.money < t.value * 20 * MONEY_SCALE ? "disabled" : ""}>
          Desarrollar territorio ${t.value >= 40 ? "(máximo)" : `(${fmtMoney(t.value * 20 * MONEY_SCALE)})`}
        </button>
        <button class="block" id="extort-btn" ${actionsLeft <= 0 ? "disabled" : ""}>
          Extorsionar aquí
        </button>
      </div>
    ` : ""}

    <button class="ghost block mt-1" id="close-btn">Cerrar</button>
  `);

  document.getElementById("close-btn").addEventListener("click", closeModal);
  document.getElementById("view-controller")?.addEventListener("click", (e) => {
    e.preventDefault();
    closeModal();
    showCartelProfile(app, controller.id);
  });
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
  document.getElementById("invest-production-btn")?.addEventListener("click", () => {
    const result = applyAction(game, playerCartel.id, "invest_production", { territoryId });
    app.setGame(game);
    closeModal();
    if (!result.ok) alert(result.message);
    app.render();
  });
  document.getElementById("develop-btn")?.addEventListener("click", () => {
    const result = applyAction(game, playerCartel.id, "develop_territory", { territoryId });
    app.setGame(game);
    closeModal();
    if (!result.ok) alert(result.message);
    app.render();
  });
  document.getElementById("extort-btn")?.addEventListener("click", () => {
    const result = applyAction(game, playerCartel.id, "extort_territory", { territoryId });
    app.setGame(game);
    closeModal();
    if (!result.ok) alert(result.message);
    app.render();
  });
  document.getElementById("map-alliance-btn")?.addEventListener("click", () => {
    const result = applyAction(game, playerCartel.id, "propose_alliance", { targetCartelId: controller.id, approach: "business" });
    app.setGame(game);
    closeModal();
    if (!result.ok) alert(result.message);
    else alert(result.accepted ? `${controller.name} acepta la alianza.` : `${controller.name} rechaza tu propuesta de alianza.`);
    app.render();
  });
  document.getElementById("map-absorb-btn")?.addEventListener("click", () => {
    if (!confirm(`¿Proponer a ${controller.name} que se convierta en una facción subordinada de tu cártel por ${fmtMoney(PROPOSE_ABSORPTION_COST)}? Solo aceptarán si están claramente por debajo de ti en fuerza.`)) return;
    const result = applyAction(game, playerCartel.id, "propose_absorption", { targetCartelId: controller.id });
    app.setGame(game);
    closeModal();
    if (!result.ok) alert(result.message);
    else alert(result.accepted ? `${controller.name} acepta convertirse en una facción subordinada de tu cártel.` : `${controller.name} rechaza la propuesta de subordinación.`);
    app.render();
  });
  document.getElementById("map-peace-btn")?.addEventListener("click", () => {
    const result = applyAction(game, playerCartel.id, "propose_peace", { targetCartelId: controller.id });
    app.setGame(game);
    closeModal();
    alert(result.accepted ? `${controller.name} acepta la paz.` : `${controller.name} rechaza tu propuesta de paz.`);
    app.render();
  });
}
