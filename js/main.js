import { buildGameFromEra, restoreSlot, persist, getPlayerCartel } from "./state.js";
import { endTurn, resolveSuccession, resolveRegentChoice, getSuccessionCandidates, checkRelease, attemptEscape } from "./turnEngine.js";
import { showModal, closeModal } from "./ui/modal.js";
import { portraitImg, escapeHtml } from "./ui/components.js";
import { deleteSaveSlot } from "./utils/storage.js";

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
    if (result.gameOver) {
      this.showGameOverModal();
      return;
    }
    this.render();
  },

  showSuccessionModal(info) {
    const deceased = this.game.characters[info.deceasedId];
    const candidates = getSuccessionCandidates(this.game, info.cartelId, info.deceasedId);
    const reasonText = info.reason === "arrest-life"
      ? `${deceased.name} ha sido condenado/a a cadena perpetua.`
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

  showGameOverModal() {
    showModal(`
      <h2>Fin de la época</h2>
      <p>Esta etapa histórica ha llegado a su fin. Tu legado permanece registrado en el log del cártel.</p>
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
