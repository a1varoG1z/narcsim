import { buildGameFromEra, restoreSlot, persist, getPlayerCartel } from "./state.js";
import { endTurn, resolveSuccession, resolveRegentChoice, getSuccessionCandidates, checkRelease, attemptEscape, resolveMarriageEvent, resolveScriptedChoice, resolveRaidTip, applyAction, ACTION_COSTS, MONEY_SCALE, isAttackable } from "./turnEngine.js";
import { showModal, closeModal } from "./ui/modal.js";
import { portraitImg, escapeHtml } from "./ui/components.js";
import { deleteSaveSlot } from "./utils/storage.js";
import { fmtMoney } from "./utils/text.js";

import * as mainMenu from "./screens/mainMenu.js";
import * as eraSelect from "./screens/eraSelect.js";
import * as characterSelect from "./screens/characterSelect.js";
import * as characterCreate from "./screens/characterCreate.js";
import * as dashboard from "./screens/dashboard.js";

const SCREENS = {
  menu: mainMenu,
  eraSelect,
  characterSelect,
  characterCreate,
  dashboard,
};

const appEl = document.getElementById("app");

const app = {
  game: null,
  screen: null,
  screenData: {},
  state: { activeTab: "overview" },

  navigate(screen, data = {}) {
    this.screen = screen;
    this.screenData = data;
    this.render();
  },

  setState(patch) {
    Object.assign(this.state, patch);
    this.render();
  },

  setGame(game) {
    this.game = game;
    persist(game);
  },

  loadSlot(slotId) {
    const game = restoreSlot(slotId);
    if (!game) {
      alert("No se pudo cargar esa partida.");
      return;
    }
    this.game = game;
    this.state.activeTab = "overview";
    this.navigate("dashboard");
  },

  startExistingGame(eraData, cartelId, characterId) {
    const game = buildGameFromEra(eraData, { mode: "existing", cartelId, characterId });
    this.setGame(game);
    this.state.activeTab = "overview";
    this.navigate("dashboard");
  },

  startNewCartelGame(eraData, options) {
    const game = buildGameFromEra(eraData, { mode: "new", ...options });
    this.setGame(game);
    this.state.activeTab = "overview";
    this.navigate("dashboard");
  },

  doEscape() {
    if (!this.game) return;
    const result = attemptEscape(this.game);
    if (!result.ok) {
      alert(result.message);
      return;
    }
    persist(this.game);
    this.render();
  },

  doEndTurn() {
    if (!this.game) return;
    checkRelease(this.game);
    if (this.game.playerControlMode === "waiting") {
      // Player is imprisoned without a regent: only time passes, no player actions.
    }
    const result = endTurn(this.game);
    persist(this.game);

    if (result.pendingRegentChoice) {
      this.showRegentModal(result.pendingRegentChoice);
      return;
    }
    if (result.pendingSuccession) {
      this.showSuccessionModal(result.pendingSuccession);
      return;
    }
    if (result.pendingMarriageEvent) {
      this.showMarriageModal(result.pendingMarriageEvent);
      return;
    }
    if (result.pendingRaidTip) {
      this.showRaidTipModal();
      return;
    }
    if (result.pendingScriptedChoice) {
      this.showScriptedChoiceModal(result.pendingScriptedChoice);
      return;
    }
    if (result.significantEvents && result.significantEvents.length) {
      this.showTurnSummaryModal(result.significantEvents, result.reactiveEvents, result.gameOver);
      return;
    }
    if (result.gameOver) {
      this.showGameOverModal();
      return;
    }
    this.render();
  },

  showTurnSummaryModal(events, reactiveEvents, gameOver) {
    const icon = (type) => (type === "death" ? "💀" : type === "good" ? "✅" : "⚠️");
    const territoryLosses = (reactiveEvents || []).filter((e) => e.type === "territoryLost");
    const sabotages = (reactiveEvents || []).filter((e) => e.type === "sabotaged");
    const poachings = (reactiveEvents || []).filter((e) => e.type === "poached");
    const interceptions = (reactiveEvents || []).filter((e) => e.type === "shipmentIntercepted");
    const hits = (reactiveEvents || []).filter((e) => e.type === "assassinationAttempted");
    const intimidations = (reactiveEvents || []).filter((e) => e.type === "intimidated");
    const warDeclarations = (reactiveEvents || []).filter((e) => e.type === "warDeclared");
    showModal(`
      <h2>Resumen del turno</h2>
      <p>Esto ha pasado mientras avanzabas el tiempo:</p>
      <div class="log" style="margin-bottom:1rem">
        ${events.map((e) => `<div class="entry ${e.type}">${icon(e.type)} ${escapeHtml(e.text)}</div>`).join("")}
      </div>
      ${territoryLosses.length || sabotages.length || interceptions.length || hits.length || intimidations.length || warDeclarations.length ? `<h3>¿Reaccionas ahora?</h3>` : ""}
      ${poachings.map((e) => `
        <div class="card tight mt-1">
          <p class="small">${e.success ? `${escapeHtml(e.byCartelName)} se ha llevado a <strong>${escapeHtml(e.characterName)}</strong> a sus filas.` : `${escapeHtml(e.byCartelName)} ha intentado reclutar a ${escapeHtml(e.characterName)} (el intento fracasó).`}</p>
        </div>
      `).join("")}
      ${territoryLosses.map((e, i) => `
        <div class="card tight mt-1" data-reactive-row="territory-${i}">
          <p class="small">${escapeHtml(e.toCartelName)} te ha arrebatado <strong>${escapeHtml(e.territoryName)}</strong>.</p>
          <button class="danger block" data-retake="territory-${i}" data-territory="${e.territoryId}">Intentar reconquistarlo ahora</button>
        </div>
      `).join("")}
      ${sabotages.map((e, i) => `
        <div class="card tight mt-1" data-reactive-row="sabotage-${i}">
          <p class="small">${escapeHtml(e.byCartelName)} ${e.success ? `te ha saboteado, con pérdidas por ${fmtMoney(e.damage)}` : "ha intentado sabotearte (el intento fracasó)"}.</p>
          <button class="danger block" data-retaliate-sabotage="sabotage-${i}" data-target="${e.byCartelId}">Represalia: sabotear de vuelta (${fmtMoney(ACTION_COSTS.sabotage_rival)})</button>
        </div>
      `).join("")}
      ${interceptions.map((e, i) => `
        <div class="card tight mt-1" data-reactive-row="intercept-${i}">
          <p class="small">${escapeHtml(e.byCartelName)} te ha interceptado un cargamento en tránsito, con pérdidas por ${fmtMoney(e.amount)}.</p>
          <button class="danger block" data-retaliate-intercept="intercept-${i}" data-target="${e.byCartelId}">Represalia: interceptarles un cargamento (${fmtMoney(ACTION_COSTS.intercept_shipment)})</button>
        </div>
      `).join("")}
      ${hits.map((e, i) => `
        <div class="card tight mt-1" data-reactive-row="hit-${i}">
          <p class="small">${escapeHtml(e.byCartelName)} ${
            e.success && !e.survived ? `ha asesinado a <strong>${escapeHtml(e.characterName)}</strong> en un atentado.`
            : e.success && e.survived ? `ha intentado asesinar a <strong>${escapeHtml(e.characterName)}</strong>, que sobrevive por poco.`
            : `ha intentado asesinar a ${escapeHtml(e.characterName)} (el intento fracasó).`
          }</p>
          <button class="danger block" data-retaliate-hit="hit-${i}" data-target="${e.byCartelId}">Represalia: ordenar un atentado contra su líder (${fmtMoney(ACTION_COSTS.assassinate_rival)})</button>
        </div>
      `).join("")}
      ${intimidations.map((e, i) => `
        <div class="card tight mt-1" data-reactive-row="intimidate-${i}">
          <p class="small">${escapeHtml(e.byCartelName)} ${e.success ? `te ha intimidado en <strong>${escapeHtml(e.territoryName)}</strong>, dañando tu reputación local` : `ha intentado intimidarte en ${escapeHtml(e.territoryName)} (el intento fracasó)`}.</p>
          <button class="danger block" data-retaliate-intimidate="intimidate-${i}" data-target="${e.byCartelId}">Represalia: intimidarles de vuelta (${fmtMoney(ACTION_COSTS.intimidate_territory)})</button>
        </div>
      `).join("")}
      ${warDeclarations.map((e, i) => `
        <div class="card tight mt-1" data-reactive-row="wardecl-${i}">
          <p class="small"><strong>${escapeHtml(e.byCartelName)} te ha declarado la guerra.</strong></p>
          ${e.reachableTerritoryId
            ? `<button class="danger block" data-retaliate-war="wardecl-${i}" data-territory="${e.reachableTerritoryId}">Represalia: atacar ${escapeHtml(e.reachableTerritoryName)} ahora</button>`
            : `<p class="small text-dim">Aún no tienes ningún territorio suyo colindante con el tuyo al que responder de inmediato.</p>`}
        </div>
      `).join("")}
      <button class="primary block mt-1" id="turn-summary-ok">Continuar</button>
    `, { dismissible: false });
    document.querySelectorAll("[data-retake]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const cartel = getPlayerCartel(this.game);
        const result = applyAction(this.game, cartel.id, "attack_territory", { territoryId: btn.dataset.territory });
        persist(this.game);
        const row = btn.closest("[data-reactive-row]");
        const msg = document.createElement("p");
        msg.className = "small";
        msg.textContent = !result.ok
          ? result.message
          : result.attackerWins
            ? "¡Reconquistado!"
            : "El intento fracasa.";
        row.appendChild(msg);
        btn.disabled = true;
      });
    });
    document.querySelectorAll("[data-retaliate-sabotage]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const cartel = getPlayerCartel(this.game);
        const result = applyAction(this.game, cartel.id, "sabotage_rival", { targetCartelId: btn.dataset.target });
        persist(this.game);
        const row = btn.closest("[data-reactive-row]");
        const msg = document.createElement("p");
        msg.className = "small";
        msg.textContent = !result.ok
          ? result.message
          : result.success
            ? `Sabotaje con éxito: ${fmtMoney(result.damage)} en pérdidas para ellos.`
            : "Tu represalia fracasa y expone tu implicación.";
        row.appendChild(msg);
        btn.disabled = true;
      });
    });
    document.querySelectorAll("[data-retaliate-intercept]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const cartel = getPlayerCartel(this.game);
        const result = applyAction(this.game, cartel.id, "intercept_shipment", { targetCartelId: btn.dataset.target });
        persist(this.game);
        const row = btn.closest("[data-reactive-row]");
        const msg = document.createElement("p");
        msg.className = "small";
        msg.textContent = !result.ok
          ? result.message
          : result.success
            ? `Interceptas su cargamento: ${fmtMoney(result.seized)} en pérdidas para ellos, ${fmtMoney(result.gained)} para ti.`
            : "Tu represalia termina en un tiroteo y fracasa.";
        row.appendChild(msg);
        btn.disabled = true;
      });
    });
    document.querySelectorAll("[data-retaliate-hit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const cartel = getPlayerCartel(this.game);
        const targetCartel = this.game.cartels[btn.dataset.target];
        const leaderId = targetCartel?.roles.leader;
        const leader = leaderId ? this.game.characters[leaderId] : null;
        const row = btn.closest("[data-reactive-row]");
        const msg = document.createElement("p");
        msg.className = "small";
        if (!leader || !leader.alive) {
          msg.textContent = "No hay un líder disponible al que atacar.";
        } else {
          const result = applyAction(this.game, cartel.id, "assassinate_rival", { targetCharacterId: leader.id });
          persist(this.game);
          msg.textContent = !result.ok
            ? result.message
            : result.success
              ? `El atentado contra ${leader.name} tiene éxito.`
              : "Tu represalia fracasa y expone tu autoría.";
        }
        row.appendChild(msg);
        btn.disabled = true;
      });
    });
    document.querySelectorAll("[data-retaliate-intimidate]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const cartel = getPlayerCartel(this.game);
        const targetCartel = this.game.cartels[btn.dataset.target];
        const reachable = targetCartel ? targetCartel.territories.find((tId) => isAttackable(this.game, cartel.id, tId)) : null;
        const row = btn.closest("[data-reactive-row]");
        const msg = document.createElement("p");
        msg.className = "small";
        if (!reachable) {
          msg.textContent = "No tienes ningún territorio suyo colindante con el tuyo al que intimidar.";
        } else {
          const result = applyAction(this.game, cartel.id, "intimidate_territory", { territoryId: reachable });
          persist(this.game);
          msg.textContent = !result.ok
            ? result.message
            : result.success
              ? "La intimidación funciona: dañas su reputación local sin derramar sangre."
              : "Tu represalia fracasa y expone la amenaza.";
        }
        row.appendChild(msg);
        btn.disabled = true;
      });
    });
    document.querySelectorAll("[data-retaliate-war]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const cartel = getPlayerCartel(this.game);
        const result = applyAction(this.game, cartel.id, "attack_territory", { territoryId: btn.dataset.territory });
        persist(this.game);
        const row = btn.closest("[data-reactive-row]");
        const msg = document.createElement("p");
        msg.className = "small";
        msg.textContent = !result.ok
          ? result.message
          : result.attackerWins
            ? "¡Territorio conquistado! Les devuelves el golpe de inmediato."
            : "El contraataque fracasa.";
        row.appendChild(msg);
        btn.disabled = true;
      });
    });
    document.getElementById("turn-summary-ok").addEventListener("click", () => {
      closeModal();
      if (gameOver) {
        this.showGameOverModal();
      } else {
        this.render();
      }
    });
  },

  showSuccessionModal(info) {
    const deceased = this.game.characters[info.deceasedId];
    const candidates = getSuccessionCandidates(this.game, info.cartelId, info.deceasedId);
    const reasonText = info.reason === "arrest-life"
      ? `${deceased.name} ha sido condenado/a a cadena perpetua.`
      : info.reason === "atentado"
      ? `${deceased.name} ha muerto en un atentado.`
      : `${deceased.name} ha muerto.`;
    if (!candidates.length) {
      showModal(`
        <h2>Fin de una era</h2>
        <p>${reasonText} No queda nadie para heredar el cártel. La organización se desintegra.</p>
        <button class="primary block" id="modal-ok">Volver al menú</button>
      `, { dismissible: false });
      document.getElementById("modal-ok").addEventListener("click", () => {
        closeModal();
        if (this.game.saveSlotId) deleteSaveSlot(this.game.saveSlotId);
        this.game = null;
        this.navigate("menu");
      });
      return;
    }
    showModal(`
      <h2>Sucesión</h2>
      <p>${reasonText} Elige quién tomará las riendas del cártel.</p>
      ${candidates.map((c) => `
        <button class="block" data-heir="${c.id}">
          <div class="person-row" style="border:none;padding:0">
            ${portraitImg(c)}
            <div class="info"><div class="name">${escapeHtml(c.name)}</div><div class="role">${c.role ? escapeHtml(c.role) : "Familiar / allegado"}</div></div>
          </div>
        </button>
      `).join("")}
    `, { dismissible: false });
    document.querySelectorAll("[data-heir]").forEach((btn) => {
      btn.addEventListener("click", () => {
        resolveSuccession(this.game, btn.dataset.heir);
        persist(this.game);
        closeModal();
        this.render();
      });
    });
  },

  showRegentModal(info) {
    const character = this.game.characters[info.characterId];
    showModal(`
      <h2>Arrestado/a</h2>
      <p>${escapeHtml(character.name)} ha sido detenido/a y podría salir libre más adelante. ¿Quieres que un heredero gobierne el cártel de forma simulada mientras tanto?</p>
      <div class="btn-row">
        <button class="primary block" id="regent-yes">Sí, que gobierne un heredero</button>
        <button class="block" id="regent-no">No, esperar en prisión</button>
      </div>
    `, { dismissible: false });
    document.getElementById("regent-yes").addEventListener("click", () => {
      resolveRegentChoice(this.game, true);
      persist(this.game);
      closeModal();
      this.render();
    });
    document.getElementById("regent-no").addEventListener("click", () => {
      resolveRegentChoice(this.game, false);
      persist(this.game);
      closeModal();
      this.render();
    });
  },

  showMarriageModal(info) {
    const spouse = this.game.characters[info.spouseId];
    showModal(`
      <h2>Crisis matrimonial</h2>
      <p>Descubres que ${escapeHtml(spouse.name)} te ha sido infiel. ¿Qué haces?</p>
      <div class="btn-row">
        <button class="primary block" id="marriage-forgive">Perdonar y seguir adelante</button>
        <button class="block" id="marriage-ignore">Ignorarlo por ahora</button>
        <button class="danger block" id="marriage-divorce">Pedir el divorcio</button>
      </div>
    `, { dismissible: false });
    const resolve = (action) => {
      resolveMarriageEvent(this.game, action);
      persist(this.game);
      closeModal();
      this.render();
    };
    document.getElementById("marriage-forgive").addEventListener("click", () => resolve("forgive"));
    document.getElementById("marriage-ignore").addEventListener("click", () => resolve("ignore"));
    document.getElementById("marriage-divorce").addEventListener("click", () => resolve("divorce"));
  },

  showRaidTipModal() {
    showModal(`
      <h2>🚨 Aviso: hay un operativo en marcha contra ti</h2>
      <p>Un contacto te avisa a tiempo: la policía se prepara para caer sobre ti este mismo turno. ¿Qué haces?</p>
      <button class="danger block" id="raid-hide">Esconderte de inmediato</button>
      <div class="small text-dim">Evitas la redada por completo, aunque desaparecer un tiempo llama algo la atención (sube el heat).</div>
      <button class="danger block mt-1" id="raid-bribe">Sobornar a los agentes en el último momento (hasta ${fmtMoney(150 * MONEY_SCALE)})</button>
      <div class="small text-dim">Cuanto más puedas pagar y mejor sea tu red de corrupción policial, más probable que funcione. Si falla, la redada sigue su curso.</div>
      <button class="ghost block mt-1" id="raid-risk">Seguir como si nada y arriesgarte</button>
    `, { dismissible: false });
    const resolve = (action) => {
      const outcome = resolveRaidTip(this.game, action);
      persist(this.game);
      closeModal();
      if (outcome.pendingRegentChoice) {
        this.showRegentModal(outcome.pendingRegentChoice);
        return;
      }
      if (outcome.pendingSuccession) {
        this.showSuccessionModal(outcome.pendingSuccession);
        return;
      }
      this.render();
    };
    document.getElementById("raid-hide").addEventListener("click", () => resolve("hide"));
    document.getElementById("raid-bribe").addEventListener("click", () => resolve("bribe"));
    document.getElementById("raid-risk").addEventListener("click", () => resolve("risk"));
  },

  showScriptedChoiceModal(info) {
    showModal(`
      <h2>${escapeHtml(info.title)}</h2>
      <p>${escapeHtml(info.description)}</p>
      ${info.options.map((o) => `<button class="block" data-option="${o.id}">${escapeHtml(o.label)}</button>`).join("")}
    `, { dismissible: false });
    document.querySelectorAll("[data-option]").forEach((btn) => {
      btn.addEventListener("click", () => {
        resolveScriptedChoice(this.game, info.eventId, btn.dataset.option);
        persist(this.game);
        closeModal();
        this.render();
      });
    });
  },

  showGameOverModal() {
    const isLandless = this.game.gameOverReason === "no-territory";
    const heading = isLandless ? "El cártel se disuelve" : "Fin de la época";
    const body = isLandless
      ? "Llevas demasiado tiempo sin ningún territorio propio: sin base ni ingresos, el cártel termina disolviéndose. Tu legado permanece registrado en el log."
      : "Esta etapa histórica ha llegado a su fin. Tu legado permanece registrado en el log del cártel.";
    showModal(`
      <h2>${heading}</h2>
      <p>${body}</p>
      <button class="primary block" id="modal-ok">Volver al menú</button>
    `, { dismissible: false });
    document.getElementById("modal-ok").addEventListener("click", () => {
      closeModal();
      this.navigate("menu");
    });
  },

  render() {
    const mod = SCREENS[this.screen];
    mod.render(appEl, this, this.screenData);
  },
};

window.__narcosimApp = app;

app.navigate("menu");
