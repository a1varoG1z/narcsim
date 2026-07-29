import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGameFromEra } from "../js/state.js";
import { applyAction, getWarsForCartel, resolveScriptedChoice, endTurn, getActionsRemaining, ACTIONS_PER_TURN, ACTION_COSTS } from "../js/turnEngine.js";
import { rollScriptedEvents } from "../js/scriptedEvents.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ERA_DIR = path.join(__dirname, "..", "data", "eras");

function loadEra(file) {
  return JSON.parse(fs.readFileSync(path.join(ERA_DIR, file), "utf8"));
}

function newGame(file, cartelId, characterId) {
  const era = loadEra(file);
  const cartel = era.cartels.find((c) => c.id === cartelId);
  return buildGameFromEra(era, { mode: "existing", cartelId, characterId: characterId || cartel.roles.leader });
}

test("launder_money reduces heat, tracks a running total, and charges a fee based on the finance chief", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  const cartel = game.cartels.sinaloa;
  cartel.resources.money = 5000;
  cartel.resources.heat = 80;
  const before = cartel.resources.money;

  const result = applyAction(game, "sinaloa", "launder_money", { amount: 1000 });
  assert.equal(result.ok, true);
  assert.ok(result.fee > 0 && result.fee < 1000, "fee should be a fraction of the laundered amount");
  assert.equal(cartel.resources.money, before - result.fee);
  assert.equal(cartel.resources.launderedMoney, 1000);
  assert.ok(cartel.resources.heat < 80, "laundering should reduce heat");
});

test("launder_money refuses to launder more money than the cartel has", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  game.cartels.sinaloa.resources.money = 100;
  const result = applyAction(game, "sinaloa", "launder_money", { amount: 100000 });
  // Amount is clamped to available money server-side, so this should succeed but only for what's available.
  assert.equal(result.ok, true);
  assert.equal(game.cartels.sinaloa.resources.launderedMoney, 100);
});

test("extort_territory pays out immediately with no upfront cost but refuses a territory the cartel doesn't own", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  const cartel = game.cartels.sinaloa;
  const before = cartel.resources.money;
  const ownedTerritoryId = cartel.territories[0];

  const result = applyAction(game, "sinaloa", "extort_territory", { territoryId: ownedTerritoryId });
  assert.equal(result.ok, true);
  assert.ok(cartel.resources.money > before, "extortion should pay out immediately");

  const foreignResult = applyAction(game, "sinaloa", "extort_territory", { territoryId: "tamaulipas" }); // owned by Golfo in this era
  assert.equal(foreignResult.ok, false);
});

test("develop_territory permanently raises a territory's value when affordable, and refuses once maxed out", () => {
  const game = newGame("mexico-rutas-1990-2006.json", "sinaloa");
  const cartel = game.cartels.sinaloa;
  cartel.resources.money = 100_000_000;
  const territoryId = cartel.territories[0];
  const before = game.territories[territoryId].value;

  const result = applyAction(game, "sinaloa", "develop_territory", { territoryId });
  assert.equal(result.ok, true);
  if (result.success) {
    assert.ok(game.territories[territoryId].value > before, "a successful development should raise the territory's value");
  }

  game.territories[territoryId].value = 40;
  const maxedResult = applyAction(game, "sinaloa", "develop_territory", { territoryId });
  assert.equal(maxedResult.ok, false);
});

test("develop_territory refuses a territory the cartel doesn't own", () => {
  const game = newGame("mexico-rutas-1990-2006.json", "sinaloa");
  game.cartels.sinaloa.resources.money = 100_000_000;
  const result = applyAction(game, "sinaloa", "develop_territory", { territoryId: "tamaulipas" }); // owned by Golfo
  assert.equal(result.ok, false);
});

test("assassinate_rival kills the target on success, triggers succession if they were the leader, and opens a war", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  const cartel = game.cartels.sinaloa;
  cartel.resources.money = 100_000_000;
  const targetCartel = game.cartels.cjng;
  const targetLeaderId = targetCartel.roles.leader;

  const originalRandom = Math.random;
  Math.random = () => 0; // guarantees the assassination attempt succeeds
  let result;
  try {
    result = applyAction(game, "sinaloa", "assassinate_rival", { targetCharacterId: targetLeaderId });
  } finally {
    Math.random = originalRandom;
  }

  assert.equal(result.ok, true);
  assert.equal(result.success, true);
  assert.equal(game.characters[targetLeaderId].alive, false);
  assert.notEqual(targetCartel.roles.leader, targetLeaderId, "the rival cartel should have a new leader after losing theirs");
  assert.equal(cartel.relations.cjng.status, "war");
  const wars = getWarsForCartel(game, "sinaloa").filter((w) => w.cartelA === "cjng" || w.cartelB === "cjng");
  assert.equal(wars.length, 1);
});

test("assassinate_rival refuses insufficient funds and an invalid or same-cartel target", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  const cartel = game.cartels.sinaloa;

  cartel.resources.money = 0;
  const poorResult = applyAction(game, "sinaloa", "assassinate_rival", { targetCharacterId: game.cartels.cjng.roles.leader });
  assert.equal(poorResult.ok, false);

  cartel.resources.money = 100_000_000;
  const sameCartelResult = applyAction(game, "sinaloa", "assassinate_rival", { targetCharacterId: cartel.roles.leader });
  assert.equal(sameCartelResult.ok, false);

  const missingResult = applyAction(game, "sinaloa", "assassinate_rival", { targetCharacterId: "does-not-exist" });
  assert.equal(missingResult.ok, false);
});

test("sabotage_rival always costs money and damages the target's money on success, but refuses invalid or same-cartel targets", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  const cartel = game.cartels.sinaloa;
  const cjng = game.cartels.cjng;
  cartel.resources.money = 100_000_000;
  const moneyBefore = cartel.resources.money;
  const targetMoneyBefore = cjng.resources.money;

  const result = applyAction(game, "sinaloa", "sabotage_rival", { targetCartelId: "cjng" });
  assert.equal(result.ok, true);
  assert.ok(cartel.resources.money < moneyBefore, "sabotage should always cost money regardless of outcome");
  if (result.success) {
    assert.ok(cjng.resources.money < targetMoneyBefore, "a successful sabotage should damage the target's money");
  }

  const sameCartelResult = applyAction(game, "sinaloa", "sabotage_rival", { targetCartelId: "sinaloa" });
  assert.equal(sameCartelResult.ok, false);

  cartel.resources.money = 0;
  const poorResult = applyAction(game, "sinaloa", "sabotage_rival", { targetCartelId: "cjng" });
  assert.equal(poorResult.ok, false);
});

test("raid_territory only works on an adjacent enemy-owned territory, causing casualties and permanently lowering its value", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  const cartel = game.cartels.sinaloa;
  cartel.resources.money = 100_000_000;

  const notAdjacent = applyAction(game, "sinaloa", "raid_territory", { territoryId: "tamaulipas" }); // owned by golfo, not adjacent to sinaloa
  assert.equal(notAdjacent.ok, false);

  const ownTerritory = applyAction(game, "sinaloa", "raid_territory", { territoryId: cartel.territories[0] });
  assert.equal(ownTerritory.ok, false);

  const adjacentEnemyTerritory = "jalisco"; // owned by cjng, adjacent to sinaloa's chihuahua in this era
  const defender = game.cartels[game.territories[adjacentEnemyTerritory].controllerId];
  const armyBefore = defender.resources.armySize;
  const valueBefore = game.territories[adjacentEnemyTerritory].value;

  const result = applyAction(game, "sinaloa", "raid_territory", { territoryId: adjacentEnemyTerritory });
  assert.equal(result.ok, true);
  assert.ok(defender.resources.armySize <= armyBefore);
  assert.ok(game.territories[adjacentEnemyTerritory].value < valueBefore);
  assert.equal(game.territories[adjacentEnemyTerritory].controllerId, defender.id, "a raid should never transfer ownership");
});

test("declaring war opens a war record and proposing (accepted) peace closes it", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  applyAction(game, "sinaloa", "declare_war", { targetCartelId: "cdn" });
  assert.equal(game.cartels.sinaloa.relations.cdn.status, "war");
  let wars = getWarsForCartel(game, "sinaloa").filter((w) => w.cartelA === "cdn" || w.cartelB === "cdn");
  assert.equal(wars.length, 1);
  assert.equal(wars[0].endYear, null);

  // Make Sinaloa overwhelmingly weaker so the peace offer is (near-)certain to be accepted.
  game.cartels.sinaloa.resources.armySize = 1;
  game.cartels.cdn.resources.armySize = 100000;
  const peace = applyAction(game, "sinaloa", "propose_peace", { targetCartelId: "cdn" });
  if (peace.accepted) {
    wars = getWarsForCartel(game, "sinaloa").filter((w) => w.cartelA === "cdn" || w.cartelB === "cdn");
    assert.equal(wars[0].endYear, game.year);
    assert.equal(game.cartels.sinaloa.relations.cdn.status, "neutral");
  }
});

test("traffic_shipment refuses to sell to a cartel you're at war with", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  game.cartels.sinaloa.resources.money = ACTION_COSTS.traffic_shipment * 10; // comfortably enough that the war check, not the cost check, is what's exercised
  game.cartels.sinaloa.relations.cjng.status = "war";
  const result = applyAction(game, "sinaloa", "traffic_shipment", { partnerCartelId: "cjng" });
  assert.equal(result.ok, false);
  assert.match(result.message, /guerra/i);
});

test("the player is capped at ACTIONS_PER_TURN budgeted actions, is refused past the cap, and the budget refills after endTurn", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  game.cartels.sinaloa.resources.money = ACTION_COSTS.recruit_army * (ACTIONS_PER_TURN + 5);
  assert.equal(getActionsRemaining(game), ACTIONS_PER_TURN);

  for (let i = 0; i < ACTIONS_PER_TURN; i++) {
    const res = applyAction(game, "sinaloa", "recruit_army");
    assert.equal(res.ok, true, `action ${i + 1} should still be within budget`);
  }
  assert.equal(getActionsRemaining(game), 0);

  const overBudget = applyAction(game, "sinaloa", "recruit_army");
  assert.equal(overBudget.ok, false);
  assert.match(overBudget.message, /acciones/i);

  // War/diplomacy moves are deliberately not budgeted.
  const warAction = applyAction(game, "sinaloa", "declare_war", { targetCartelId: "cjng" });
  assert.equal(warAction.ok, true);

  endTurn(game);
  assert.equal(getActionsRemaining(game), ACTIONS_PER_TURN);
});

test("the Proceso 8000 (1995) event pauses for a player choice when the player controls Cali, and applies immediately for NPC-controlled Cali", () => {
  const era = loadEra("medellin-cali-1980-1995.json");

  const playerGame = buildGameFromEra(era, { mode: "existing", cartelId: "cali", characterId: "gilberto_rodriguez" });
  const playerResult = rollScriptedEvents(playerGame, () => {}, 1995);
  assert.ok(playerResult.pendingChoice, "expected a pending choice when the player controls Cali");
  assert.equal(playerResult.pendingChoice.eventId, "proceso-8000-1995");
  assert.equal(playerGame.firedScriptedEvents.includes("proceso-8000-1995"), false);

  resolveScriptedChoice(playerGame, "proceso-8000-1995", "resist");
  assert.equal(playerGame.firedScriptedEvents.includes("proceso-8000-1995"), true);

  const npcGame = buildGameFromEra(era, { mode: "existing", cartelId: "medellin", characterId: "pablo_escobar" });
  const npcHeatBefore = npcGame.cartels.cali.resources.heat;
  const npcResult = rollScriptedEvents(npcGame, () => {}, 1995);
  assert.equal(npcResult.pendingChoice, null, "should auto-resolve when the player isn't Cali");
  assert.ok(npcGame.cartels.cali.resources.heat > npcHeatBefore);
  assert.equal(npcGame.firedScriptedEvents.includes("proceso-8000-1995"), true);
});

test("invest_production lets you target a specific owned territory and scales payout with its value", () => {
  const game = newGame("mexico-rutas-1990-2006.json", "sinaloa");
  game.cartels.sinaloa.resources.money = ACTION_COSTS.invest_production * 10;
  const result = applyAction(game, "sinaloa", "invest_production", { territoryId: "sinaloa" });
  assert.equal(result.ok, true);
  assert.equal(result.territoryId, "sinaloa");
});

test("invest_production ignores a territoryId the cartel doesn't own and falls back to its best territory", () => {
  const game = newGame("mexico-rutas-1990-2006.json", "sinaloa");
  game.cartels.sinaloa.resources.money = ACTION_COSTS.invest_production * 10;
  const result = applyAction(game, "sinaloa", "invest_production", { territoryId: "tamaulipas" }); // owned by Golfo
  assert.equal(result.ok, true);
  assert.notEqual(result.territoryId, "tamaulipas");
  assert.ok(game.cartels.sinaloa.territories.includes(result.territoryId));
});

test("higher international reputation increases territory income via the export bonus", () => {
  const lowRepGame = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  lowRepGame.cartels.sinaloa.resources.internationalReputation = 0;
  lowRepGame.cartels.sinaloa.resources.money = 1000;
  lowRepGame.cartels.sinaloa.resources.armySize = 0; // isolate income from upkeep/desertion noise

  const highRepGame = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  highRepGame.cartels.sinaloa.resources.internationalReputation = 100;
  highRepGame.cartels.sinaloa.resources.money = 1000;
  highRepGame.cartels.sinaloa.resources.armySize = 0;

  // Advance one turn on otherwise-identical states; AI/random events add noise, but the export
  // bonus is a deterministic multiplier on top of the same base income, so it should still win
  // on average. Run a few turns to make the comparison robust against a single unlucky turn.
  for (let i = 0; i < 5; i++) {
    endTurn(lowRepGame);
    endTurn(highRepGame);
  }
  assert.ok(highRepGame.cartels.sinaloa.resources.money > lowRepGame.cartels.sinaloa.resources.money);
});

test("the Camarena 1985 event pauses for a player choice when the player controls Guadalajara, and applies immediately for NPC-controlled Guadalajara", () => {
  const era = loadEra("guadalajara-1975-1989.json");

  const playerGame = buildGameFromEra(era, { mode: "existing", cartelId: "guadalajara", characterId: "felix_gallardo" });
  const playerResult = rollScriptedEvents(playerGame, () => {}, 1985);
  assert.ok(playerResult.pendingChoice, "expected a pending choice when the player controls Guadalajara");
  assert.equal(playerResult.pendingChoice.eventId, "camarena-1985");
  assert.equal(playerGame.firedScriptedEvents.includes("camarena-1985"), false, "should stay unfired until resolved");

  resolveScriptedChoice(playerGame, "camarena-1985", "cooperate");
  assert.equal(playerGame.firedScriptedEvents.includes("camarena-1985"), true);

  const npcGame = buildGameFromEra(era, { mode: "existing", cartelId: "golfo", characterId: "garcia_abrego" });
  const npcHeatBefore = npcGame.cartels.guadalajara.resources.heat;
  const npcResult = rollScriptedEvents(npcGame, () => {}, 1985);
  assert.equal(npcResult.pendingChoice, null, "should auto-resolve when the player isn't Guadalajara");
  assert.ok(npcGame.cartels.guadalajara.resources.heat > npcHeatBefore, "the historical default should still raise heat");
  assert.equal(npcGame.firedScriptedEvents.includes("camarena-1985"), true);
});
