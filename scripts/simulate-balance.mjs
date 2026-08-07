// Headless balance-testing harness. Runs many simulated playthroughs of every era/cartel
// combination without any UI, driving the player's cartel with a simple "reasonable human"
// policy, to sanity-check that the economy, combat and heat/arrest mechanics stay bounded
// and roughly proportionate to each cartel's real-world scale.
//
// Usage: node scripts/simulate-balance.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildGameFromEra, getPlayerCartel } from "../js/state.js";
import { endTurn, resolveSuccession, resolveRegentChoice, getSuccessionCandidates, applyAction, canAfford, isAttackable, resolveScriptedChoice, ACTIONS_PER_TURN } from "../js/turnEngine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ERA_DIR = path.join(__dirname, "..", "data", "eras") + path.sep;
const eraFiles = [
  "guadalajara-1975-1989.json",
  "medellin-cali-1980-1995.json",
  "mexico-rutas-1990-2006.json",
  "fragmentacion-2006-2015.json",
  "cjng-sinaloa-2015-actualidad.json",
  "chapitos-mayiza-2024-actualidad.json",
  "narcotrafico-gallego-1975-1995.json",
  "ley-seca-1925-1933.json",
  "la-comision-1931-1958.json",
];

function playerTurnPolicy(game) {
  const cartel = getPlayerCartel(game);
  if (!cartel || cartel.destroyed) return;
  const r = cartel.resources;
  let actionsThisTurn = 0;
  const maxActions = ACTIONS_PER_TURN;

  if (r.heat > 60 && actionsThisTurn < maxActions) {
    if (canAfford(cartel, "corrupt_police")) { applyAction(game, cartel.id, "corrupt_police"); actionsThisTurn++; }
    else { applyAction(game, cartel.id, "lay_low"); actionsThisTurn++; }
  }
  if (actionsThisTurn < maxActions && canAfford(cartel, "invest_production")) {
    applyAction(game, cartel.id, "invest_production"); actionsThisTurn++;
  }
  if (actionsThisTurn < maxActions && canAfford(cartel, "traffic_shipment") && r.heat < 70) {
    applyAction(game, cartel.id, "traffic_shipment"); actionsThisTurn++;
  }
  if (actionsThisTurn < maxActions && canAfford(cartel, "recruit_army") && r.armySize < 2000) {
    applyAction(game, cartel.id, "recruit_army"); actionsThisTurn++;
  }
  if (actionsThisTurn < maxActions && canAfford(cartel, "invest_property") && !r.propertyIncome) {
    applyAction(game, cartel.id, "invest_property"); actionsThisTurn++;
  }
  if (actionsThisTurn < maxActions && canAfford(cartel, "invest_business") && !r.businessIncome) {
    applyAction(game, cartel.id, "invest_business"); actionsThisTurn++;
  }
  if (actionsThisTurn < maxActions && r.heat > 50 && r.money > 0) {
    applyAction(game, cartel.id, "launder_money", { amount: Math.round(r.money * 0.2) }); actionsThisTurn++;
  }
  if (actionsThisTurn < maxActions && cartel.territories.length && canAfford(cartel, "extort_territory")) {
    applyAction(game, cartel.id, "extort_territory", { territoryId: cartel.territories[0] }); actionsThisTurn++;
  }
  const warEnemyIds = Object.entries(cartel.relations).filter(([, rel]) => rel.status === "war").map(([id]) => id);
  for (const enemyId of warEnemyIds) {
    const enemy = game.cartels[enemyId];
    if (!enemy || enemy.destroyed) continue;
    const reachable = enemy.territories.filter((tId) => isAttackable(game, cartel.id, tId));
    if (reachable.length && r.armySize > enemy.resources.armySize * 0.8) {
      applyAction(game, cartel.id, "attack_territory", { territoryId: reachable[0] });
      break;
    }
  }
}

function runOneGame(eraData, cartelId, turns) {
  const cartel = eraData.cartels.find((c) => c.id === cartelId);
  const game = buildGameFromEra(eraData, { mode: "existing", cartelId, characterId: cartel.roles.leader });
  let successions = 0;
  let firstArrestOrDeathTurn = null;

  for (let i = 0; i < turns; i++) {
    if (game.gameOver) break;
    playerTurnPolicy(game);
    const result = endTurn(game);
    if (result.pendingSuccession) {
      successions++;
      if (firstArrestOrDeathTurn === null) firstArrestOrDeathTurn = game.turn;
      const candidates = getSuccessionCandidates(game, result.pendingSuccession.cartelId, result.pendingSuccession.deceasedId);
      if (!candidates.length) break;
      resolveSuccession(game, candidates[0].id);
    }
    if (result.pendingRegentChoice) {
      if (firstArrestOrDeathTurn === null) firstArrestOrDeathTurn = game.turn;
      resolveRegentChoice(game, true);
    }
    if (result.pendingScriptedChoice) {
      resolveScriptedChoice(game, result.pendingScriptedChoice.eventId, result.pendingScriptedChoice.options[0].id);
    }
  }

  const finalCartel = game.cartels[game.playerCartelId];
  return {
    successions,
    firstArrestOrDeathTurn,
    finalMoney: finalCartel ? finalCartel.resources.money : 0,
    finalArmy: finalCartel ? finalCartel.resources.armySize : 0,
    finalTerritories: finalCartel ? finalCartel.territories.length : 0,
    finalHeat: finalCartel ? finalCartel.resources.heat : 0,
  };
}

const RUNS_PER_SCENARIO = 20;
const TURNS = 40; // 20 years at 6 months/turn

for (const file of eraFiles) {
  const eraData = JSON.parse(fs.readFileSync(ERA_DIR + file, "utf8"));
  console.log(`\n=== ${eraData.name} ===`);
  for (const cartel of eraData.cartels) {
    const startTerritories = eraData.territories.filter((t) => t.controllerId === cartel.id).length;
    const results = [];
    for (let r = 0; r < RUNS_PER_SCENARIO; r++) results.push(runOneGame(eraData, cartel.id, TURNS));
    const avg = (key) => (results.reduce((s, x) => s + x[key], 0) / results.length).toFixed(0);
    const withEvent = results.filter((x) => x.firstArrestOrDeathTurn !== null);
    const pctWithEvent = Math.round((withEvent.length / results.length) * 100);
    const avgFirstEvent = withEvent.length ? (withEvent.reduce((s, x) => s + x.firstArrestOrDeathTurn, 0) / withEvent.length).toFixed(1) : "-";
    console.log(
      `${cartel.name.padEnd(38)} startTerr=${startTerritories} money=${avg("finalMoney").padStart(7)} army=${avg("finalArmy").padStart(6)} terr=${avg("finalTerritories")} heat=${avg("finalHeat").padStart(3)} arresto/muerte%=${pctWithEvent}% turnoMedio=${avgFirstEvent}`
    );
  }
}
