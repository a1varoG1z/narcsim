import { getPlayerCartel, getPlayerCharacter, currentYear } from "../../state.js";
import { portraitImg, statBar, escapeHtml } from "../../ui/components.js";
import { STATS, STAT_ORDER, age } from "../../model.js";
import { fmtMoney, fmtNum, heatLabel } from "../../utils/text.js";
import { policeOperationChance } from "../../events.js";
import { getActionsRemaining, ACTIONS_PER_TURN, MONEY_SCALE } from "../../turnEngine.js";

export function render(container, app) {
  const game = app.game;
  const cartel = getPlayerCartel(game);
  const character = getPlayerCharacter(game);
  const r = cartel.resources;
  const year = currentYear(game);
  const controlNote = game.playerControlMode === "regent"
    ? `<p class="text-danger small">${escapeHtml(game.characters[game.regentCharacterId]?.name || "")} gobierna en tu ausencia mientras cumples condena.</p>`
    : game.playerControlMode === "waiting"
    ? `<p class="text-danger small">Estás en prisión. El cártel avanza sin liderazgo directo.</p>`
    : "";
  const canEscape = !!character.imprisoned;
  const isLifeSentence = character.imprisoned?.lifeSentence;

  container.innerHTML = `
    <div class="card">
      <div style="display:flex;gap:1rem;align-items:center">
        ${portraitImg(character, "lg")}
        <div>
          <h2>${escapeHtml(character.name)}</h2>
          <div class="text-dim small">${age(character, year)} años · ${escapeHtml(cartel.name)}</div>
        </div>
      </div>
      ${controlNote}
      ${canEscape ? `
        <button class="danger block" id="escape-btn">Intentar fuga de prisión</button>
        ${isLifeSentence ? `<p class="small text-dim">Cumples cadena perpetua: una fuga de máxima seguridad es muchísimo más difícil (aunque no imposible, como demuestra la historia real), y un intento fallido trae vigilancia redoblada.</p>` : ""}
      ` : ""}
      ${STAT_ORDER.map((k) => statBar(STATS[k], character.stats[k])).join("")}
    </div>

    <div class="card">
      <h3>Estado del cártel</h3>
      ${statBar("Dinero", Math.min(100, r.money / (50 * MONEY_SCALE)), "")}<div class="small text-dim" style="margin-top:-8px">${fmtMoney(r.money)}</div>
      ${statBar("Ejército", Math.min(100, r.armySize / 40), "")}<div class="small text-dim" style="margin-top:-8px">${fmtNum(r.armySize)} hombres</div>
      ${statBar("Corrupción gob.", r.corruptGov)}
      ${statBar("Corrupción policial", r.corruptPolice)}
      ${statBar("Imagen pública", r.publicImage, "image")}
      ${statBar("Nivel de búsqueda (heat)", r.heat, "heat")}
      <div class="small mt-1"><strong>${escapeHtml(heatLabel(r.heat))}</strong> · riesgo de operativo este turno: ${Math.round(policeOperationChance(cartel) * 100)}%</div>
      <div class="small text-dim mt-1">Territorios: ${cartel.territories.map((id) => escapeHtml(game.territories[id]?.name || id)).join(", ") || "ninguno"}</div>
    </div>

    <div class="card">
      <h3>Registro de sucesos</h3>
      <div class="log">
        ${[...game.log].slice(-40).reverse().map((e) => `<div class="entry ${e.type}">${e.year} · ${escapeHtml(e.text)}</div>`).join("")}
      </div>
    </div>

    <p class="text-dim small center">Acciones restantes este turno: ${getActionsRemaining(game)}/${ACTIONS_PER_TURN}</p>
    <button class="primary block" id="end-turn-btn">Avanzar turno (${game.turnMonths} meses) →</button>
  `;

  container.querySelector("#end-turn-btn").addEventListener("click", () => app.doEndTurn());
  container.querySelector("#escape-btn")?.addEventListener("click", () => app.doEscape());
}
