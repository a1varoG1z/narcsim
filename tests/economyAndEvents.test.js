import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGameFromEra } from "../js/state.js";
import { applyAction, getWarsForCartel, resolveScriptedChoice, endTurn, getActionsRemaining, ACTIONS_PER_TURN, ACTION_COSTS, getIncomeBreakdown, MONEY_SCALE, getDrugProfile, DRUG_PROFILES, resolveRaidTip } from "../js/turnEngine.js";
import { rollScriptedEvents } from "../js/scriptedEvents.js";
import { rollLoyaltyEvents, getMemberBond, driftMemberBonds, rollSiblingRivalry, rollPoliceOperations } from "../js/events.js";

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

test("assassinate_rival's 'accident' method avoids a war on success but still exposes and triggers one on failure", () => {
  const originalRandom = Math.random;
  try {
    const successGame = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    successGame.cartels.sinaloa.resources.money = 100_000_000;
    const successTargetId = successGame.cartels.cjng.roles.leader;
    Math.random = () => 0; // guarantees success regardless of the (lower) accident success chance
    const successResult = applyAction(successGame, "sinaloa", "assassinate_rival", { targetCharacterId: successTargetId, method: "accident" });
    assert.equal(successResult.ok, true);
    assert.equal(successResult.success, true);
    assert.equal(successGame.characters[successTargetId].alive, false);
    assert.equal(successGame.cartels.sinaloa.relations.cjng?.status ?? "neutral", "neutral", "a successful staged accident shouldn't be attributed to you, so no war");
    assert.equal(getWarsForCartel(successGame, "sinaloa").filter((w) => w.cartelA === "cjng" || w.cartelB === "cjng").length, 0);

    const failGame = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    failGame.cartels.sinaloa.resources.money = 100_000_000;
    const failTargetId = failGame.cartels.cjng.roles.leader;
    Math.random = () => 0.99; // guarantees failure
    const failResult = applyAction(failGame, "sinaloa", "assassinate_rival", { targetCharacterId: failTargetId, method: "accident" });
    assert.equal(failResult.ok, true);
    assert.equal(failResult.success, false);
    assert.equal(failGame.characters[failTargetId].alive, true);
    assert.equal(failGame.cartels.sinaloa.relations.cjng.status, "war", "a botched cover-up should still expose you and start a war");
  } finally {
    Math.random = originalRandom;
  }
});

test("assassinate_rival's 'public' method damages the target cartel's public image on top of opening a war", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  const cartel = game.cartels.sinaloa;
  cartel.resources.money = 100_000_000;
  const targetCartel = game.cartels.cjng;
  const targetLeaderId = targetCartel.roles.leader;
  const imageBefore = targetCartel.resources.publicImage;

  const originalRandom = Math.random;
  Math.random = () => 0;
  let result;
  try {
    result = applyAction(game, "sinaloa", "assassinate_rival", { targetCharacterId: targetLeaderId, method: "public" });
  } finally {
    Math.random = originalRandom;
  }

  assert.equal(result.ok, true);
  assert.equal(result.success, true);
  assert.equal(game.characters[targetLeaderId].alive, false);
  assert.equal(cartel.relations.cjng.status, "war");
  assert.ok(targetCartel.resources.publicImage < imageBefore, "a public, brutal hit should damage the target's public image");
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

test("recruit_informant succeeds or fails, refuses invalid targets/insufficient funds, and the resulting informant decays over its turn duration", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  const cartel = game.cartels.sinaloa;
  cartel.resources.money = 0;
  const poorResult = applyAction(game, "sinaloa", "recruit_informant", { targetCartelId: "cjng" });
  assert.equal(poorResult.ok, false);

  cartel.resources.money = 100_000_000;
  const sameCartelResult = applyAction(game, "sinaloa", "recruit_informant", { targetCartelId: "sinaloa" });
  assert.equal(sameCartelResult.ok, false);

  const missingResult = applyAction(game, "sinaloa", "recruit_informant", { targetCartelId: "does-not-exist" });
  assert.equal(missingResult.ok, false);

  const originalRandom = Math.random;
  let result;
  try {
    Math.random = () => 0; // guarantees the recruitment attempt succeeds
    result = applyAction(game, "sinaloa", "recruit_informant", { targetCartelId: "cjng" });
  } finally {
    Math.random = originalRandom;
  }
  assert.equal(result.ok, true);
  assert.equal(result.success, true);
  assert.ok(cartel.informants && cartel.informants.cjng, "a successful recruitment should register an informant");
  const turns = cartel.informants.cjng.turnsRemaining;
  assert.ok(turns >= 4 && turns <= 8, "the informant's duration should be within the documented 4-8 turn range");

  for (let i = 0; i < turns; i++) endTurn(game);
  assert.equal(cartel.informants.cjng, undefined, "the informant should have expired after its duration in turns");
});

test("an active informant grants a real success-chance bonus for sabotage_rival against that specific cartel", () => {
  const originalRandom = Math.random;
  try {
    const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    const cartel = game.cartels.sinaloa;
    const target = game.cartels.cjng;
    cartel.resources.money = 100_000_000;
    target.resources.corruptPolice = 0; // pins the base defense at a known low value (defense = 0/2 + 20 = 20)
    const saboteur = game.characters[cartel.roles.intelChief] || game.characters[cartel.roles.sicariosChief];
    saboteur.stats.stealth = 100;
    saboteur.stats.intrigue = 100; // skill = 100, so (skill - defense)/150 = 0.53, saturating the base 0.75 ceiling

    Math.random = () => 0.8; // between the unboosted 0.75 ceiling and the informant-boosted 0.87
    const withoutInformant = applyAction(game, "sinaloa", "sabotage_rival", { targetCartelId: "cjng" });
    assert.equal(withoutInformant.success, false, "0.8 should fail against the unboosted 0.75 ceiling");

    cartel.informants = { cjng: { turnsRemaining: 3 } };
    cartel.resources.money = 100_000_000;
    const withInformant = applyAction(game, "sinaloa", "sabotage_rival", { targetCartelId: "cjng" });
    assert.equal(withInformant.success, true, "the informant bonus should push the same 0.8 roll under the boosted chance");
  } finally {
    Math.random = originalRandom;
  }
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

test("invest_property and invest_business grant permanent passive income that shows up in getIncomeBreakdown", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  const cartel = game.cartels.sinaloa;
  cartel.resources.money = 100_000_000;

  const before = getIncomeBreakdown(game, cartel);
  assert.equal(before.passiveIncome, 0);

  const propResult = applyAction(game, "sinaloa", "invest_property");
  assert.equal(propResult.ok, true);
  assert.ok(cartel.resources.propertyIncome > 0);

  const bizResult = applyAction(game, "sinaloa", "invest_business");
  assert.equal(bizResult.ok, true);
  assert.ok(cartel.resources.businessIncome > 0);

  const after = getIncomeBreakdown(game, cartel);
  assert.equal(after.passiveIncome, cartel.resources.propertyIncome + cartel.resources.businessIncome);
  assert.ok(after.net > before.net, "passive income should raise the net turn balance");
});

test("invest_art creates a holding that appreciates over time via endTurn, and sell_art liquidates it", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  const cartel = game.cartels.sinaloa;
  cartel.resources.money = 100_000_000;

  const noArt = applyAction(game, "sinaloa", "sell_art");
  assert.equal(noArt.ok, false, "cannot sell art you don't have");

  const investResult = applyAction(game, "sinaloa", "invest_art");
  assert.equal(investResult.ok, true);
  const initialValue = cartel.resources.artValue;
  assert.ok(initialValue > 0);

  endTurn(game);
  assert.ok(cartel.resources.artValue >= initialValue, "art should appreciate (or at worst hold) over a turn");

  const moneyBeforeSale = cartel.resources.money;
  const heldValue = cartel.resources.artValue;
  const sellResult = applyAction(game, "sinaloa", "sell_art");
  assert.equal(sellResult.ok, true);
  assert.equal(cartel.resources.artValue, 0);
  assert.ok(cartel.resources.money > moneyBeforeSale, "selling art should always add some cash back");
  assert.ok(sellResult.received <= heldValue, "a seizure would mean less than full value received");
});

test("invest_weapons grants a capped, cumulative combat bonus", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  // Apply to a non-player cartel (cjng) to bypass the per-turn action budget entirely, isolating
  // just the cap-enforcement logic rather than needing to cycle turns to refill the budget.
  const cartel = game.cartels.cjng;
  cartel.resources.money = 100_000_000;

  for (let i = 0; i < 20; i++) {
    applyAction(game, "cjng", "invest_weapons");
  }
  assert.equal(cartel.resources.weaponsBonus, 0.3, "20 purchases of +2% each should hit the 30% cap");
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

test("declare_war's 'accusation' pretext helps your image when tension justifies it, and hurts it when it's a bluff", () => {
  const justifiedGame = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  justifiedGame.cartels.sinaloa.relations.cdn.tension = 80;
  const imageBefore1 = justifiedGame.cartels.sinaloa.resources.publicImage;
  applyAction(justifiedGame, "sinaloa", "declare_war", { targetCartelId: "cdn", pretext: "accusation" });
  assert.ok(justifiedGame.cartels.sinaloa.resources.publicImage > imageBefore1, "a justified accusation (high prior tension) should improve public image");

  const bluffGame = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  bluffGame.cartels.sinaloa.relations.cdn.tension = 10;
  const imageBefore2 = bluffGame.cartels.sinaloa.resources.publicImage;
  applyAction(bluffGame, "sinaloa", "declare_war", { targetCartelId: "cdn", pretext: "accusation" });
  assert.ok(bluffGame.cartels.sinaloa.resources.publicImage < imageBefore2, "an unjustified accusation (low prior tension) should hurt public image");
});

test("propose_alliance's 'gift' approach spends the money on the attempt regardless of outcome, and refuses if unaffordable", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  const cartel = game.cartels.sinaloa;
  const giftAmount = 200 * MONEY_SCALE;
  cartel.resources.money = giftAmount;

  const tooLittle = applyAction(game, "sinaloa", "propose_alliance", { targetCartelId: "cdn", approach: "gift", giftAmount: giftAmount * 2 });
  assert.equal(tooLittle.ok, false, "should refuse when the cartel can't afford the gift");
  assert.equal(cartel.resources.money, giftAmount, "money should be untouched when the gift is refused for being unaffordable");

  const originalRandom = Math.random;
  try {
    Math.random = () => 0.99; // guarantees chance() fails regardless of the bonus, so we land in the rejection branch
    const rejected = applyAction(game, "sinaloa", "propose_alliance", { targetCartelId: "cdn", approach: "gift", giftAmount });
    assert.equal(rejected.accepted, false);
    assert.equal(cartel.resources.money, 0, "the gift is spent on the attempt even when the alliance is rejected");
  } finally {
    Math.random = originalRandom;
  }
});

test("propose_alliance's 'commonEnemy' approach gives a real chance bonus when true, and a penalty when it's a bluff", () => {
  // Same tension in both cases (0.35 - 40/200 = 0.15 base); a shared war enemy should push the
  // roll from "would fail" to "would succeed" for the exact same underlying random draw.
  const originalRandom = Math.random;
  try {
    Math.random = () => 0.25; // between 0.10 (bluff) and 0.40 (true) acceptance chances computed below

    const withEnemy = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    withEnemy.cartels.sinaloa.relations.golfo.tension = 40;
    withEnemy.cartels.sinaloa.relations.cdn.status = "war";
    withEnemy.cartels.golfo.relations.cdn = { status: "war", tension: 90 };
    withEnemy.cartels.sinaloa.relations.golfo.status = "neutral";
    const accepted = applyAction(withEnemy, "sinaloa", "propose_alliance", { targetCartelId: "golfo", approach: "commonEnemy" });
    assert.equal(accepted.accepted, true, "a genuine shared enemy should be enough to flip this roll to acceptance");

    const withoutEnemy = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    withoutEnemy.cartels.sinaloa.relations.golfo.tension = 40;
    const rejected = applyAction(withoutEnemy, "sinaloa", "propose_alliance", { targetCartelId: "golfo", approach: "commonEnemy" });
    assert.equal(rejected.accepted, false, "claiming a common enemy that doesn't exist should be a penalty, not a bonus");
  } finally {
    Math.random = originalRandom;
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

test("the Posadas Ocampo (1993) event pauses for a player choice when the player controls Tijuana, and applies immediately for NPC-controlled Tijuana", () => {
  const era = loadEra("mexico-rutas-1990-2006.json");

  const playerGame = buildGameFromEra(era, { mode: "existing", cartelId: "tijuana", characterId: "benjamin_arellano" });
  const playerResult = rollScriptedEvents(playerGame, () => {}, 1993);
  assert.ok(playerResult.pendingChoice, "expected a pending choice when the player controls Tijuana");
  assert.equal(playerResult.pendingChoice.eventId, "posadas-ocampo-1993");
  assert.equal(playerGame.firedScriptedEvents.includes("posadas-ocampo-1993"), false, "should stay unfired until resolved");

  resolveScriptedChoice(playerGame, "posadas-ocampo-1993", "deny");
  assert.equal(playerGame.firedScriptedEvents.includes("posadas-ocampo-1993"), true);

  const npcGame = buildGameFromEra(era, { mode: "existing", cartelId: "sinaloa", characterId: "chapo_guzman" });
  const npcHeatBefore = npcGame.cartels.tijuana.resources.heat;
  const npcResult = rollScriptedEvents(npcGame, () => {}, 1993);
  assert.equal(npcResult.pendingChoice, null, "should auto-resolve when the player isn't Tijuana");
  assert.ok(npcGame.cartels.tijuana.resources.heat > npcHeatBefore);
  assert.equal(npcGame.firedScriptedEvents.includes("posadas-ocampo-1993"), true);
});

test("the Viernes Negro (2015) event pauses for a player choice when the player controls CJNG, and applies immediately for NPC-controlled CJNG", () => {
  const era = loadEra("cjng-sinaloa-2015-actualidad.json");

  const playerGame = buildGameFromEra(era, { mode: "existing", cartelId: "cjng", characterId: "el_mencho" });
  const playerResult = rollScriptedEvents(playerGame, () => {}, 2015);
  assert.ok(playerResult.pendingChoice, "expected a pending choice when the player controls CJNG");
  assert.equal(playerResult.pendingChoice.eventId, "viernes-negro-2015");
  assert.equal(playerGame.firedScriptedEvents.includes("viernes-negro-2015"), false, "should stay unfired until resolved");

  resolveScriptedChoice(playerGame, "viernes-negro-2015", "evacuate");
  assert.equal(playerGame.firedScriptedEvents.includes("viernes-negro-2015"), true);

  const npcGame = buildGameFromEra(era, { mode: "existing", cartelId: "sinaloa", characterId: "ivan_archivaldo" });
  const npcHeatBefore = npcGame.cartels.cjng.resources.heat;
  const npcResult = rollScriptedEvents(npcGame, () => {}, 2015);
  assert.equal(npcResult.pendingChoice, null, "should auto-resolve when the player isn't CJNG");
  assert.ok(npcGame.cartels.cjng.resources.heat > npcHeatBefore, "the historical default outcome (shooting down the helicopter) always raises heat a lot");
  assert.equal(npcGame.firedScriptedEvents.includes("viernes-negro-2015"), true);
});

test("the Viernes Negro event's 'evacuate' choice generates far less heat than 'shoot_down', and slightly improves public image", () => {
  const era = loadEra("cjng-sinaloa-2015-actualidad.json");

  const shootGame = buildGameFromEra(era, { mode: "existing", cartelId: "cjng", characterId: "el_mencho" });
  const shootHeatBefore = shootGame.cartels.cjng.resources.heat;
  rollScriptedEvents(shootGame, () => {}, 2015);
  resolveScriptedChoice(shootGame, "viernes-negro-2015", "shoot_down");
  const shootHeatDelta = shootGame.cartels.cjng.resources.heat - shootHeatBefore;

  const evacGame = buildGameFromEra(era, { mode: "existing", cartelId: "cjng", characterId: "el_mencho" });
  const evacHeatBefore = evacGame.cartels.cjng.resources.heat;
  const evacImageBefore = evacGame.cartels.cjng.resources.publicImage;
  rollScriptedEvents(evacGame, () => {}, 2015);
  resolveScriptedChoice(evacGame, "viernes-negro-2015", "evacuate");
  const evacHeatDelta = evacGame.cartels.cjng.resources.heat - evacHeatBefore;

  assert.ok(evacHeatDelta < shootHeatDelta, "evacuating quietly should generate much less heat than shooting down the helicopter");
  assert.ok(evacGame.cartels.cjng.resources.publicImage > evacImageBefore, "avoiding the massacre should slightly improve public image");
});

test("the Viernes Negro event's 'bribe' choice can either quietly redirect the operation (low roll) or fail into the same fallout as 'shoot_down' plus a public-image hit (high roll)", () => {
  const era = loadEra("cjng-sinaloa-2015-actualidad.json");
  const originalRandom = Math.random;
  try {
    Math.random = () => 0.1; // under the 0.4 success threshold
    const luckyGame = buildGameFromEra(era, { mode: "existing", cartelId: "cjng", characterId: "el_mencho" });
    const luckyHeatBefore = luckyGame.cartels.cjng.resources.heat;
    rollScriptedEvents(luckyGame, () => {}, 2015);
    resolveScriptedChoice(luckyGame, "viernes-negro-2015", "bribe");
    assert.equal(luckyGame.cartels.cjng.resources.heat, luckyHeatBefore, "a successful bribe should redirect the operation without any heat spike");

    Math.random = () => 0.9; // over the 0.4 success threshold
    const unluckyGame = buildGameFromEra(era, { mode: "existing", cartelId: "cjng", characterId: "el_mencho" });
    const unluckyImageBefore = unluckyGame.cartels.cjng.resources.publicImage;
    rollScriptedEvents(unluckyGame, () => {}, 2015);
    resolveScriptedChoice(unluckyGame, "viernes-negro-2015", "bribe");
    assert.ok(unluckyGame.cartels.cjng.resources.heat > 0, "a failed bribe should still let the operation (and the heat spike) go through");
    assert.ok(unluckyGame.cartels.cjng.resources.publicImage < unluckyImageBefore, "a failed, exposed bribe attempt should additionally hurt public image");
  } finally {
    Math.random = originalRandom;
  }
});

test("the El Mochomo arrest (2008) event pauses for a player choice when the player controls Beltrán Leyva, and applies immediately for NPC-controlled Beltrán Leyva", () => {
  const era = loadEra("fragmentacion-2006-2015.json");

  const playerGame = buildGameFromEra(era, { mode: "existing", cartelId: "beltran_leyva", characterId: "arturo_beltran_leyva" });
  playerGame.year = 2008;
  assert.equal(playerGame.cartels.beltran_leyva.relations.sinaloa.status, "war", "this era already starts Beltrán Leyva and Sinaloa at war");
  const playerResult = rollScriptedEvents(playerGame, () => {}, 2008);
  assert.ok(playerResult.pendingChoice, "expected a pending choice when the player controls Beltrán Leyva");
  assert.equal(playerResult.pendingChoice.eventId, "arresto-mochomo-2008");
  assert.equal(playerGame.firedScriptedEvents.includes("arresto-mochomo-2008"), false, "should stay unfired until resolved");

  resolveScriptedChoice(playerGame, "arresto-mochomo-2008", "war");
  assert.equal(playerGame.firedScriptedEvents.includes("arresto-mochomo-2008"), true);
  assert.equal(playerGame.cartels.beltran_leyva.relations.sinaloa.status, "war");
  assert.equal(playerGame.cartels.sinaloa.relations.beltran_leyva.status, "war");
  assert.ok(playerGame.warHistory.some((w) => w.key === ["beltran_leyva", "sinaloa"].sort().join("|") && w.endYear === null), "should still be tracked as an open war");

  const npcGame = buildGameFromEra(era, { mode: "existing", cartelId: "sinaloa", characterId: "chapo_guzman_06" });
  npcGame.year = 2008;
  const npcHeatBefore = npcGame.cartels.beltran_leyva.resources.heat;
  const npcResult = rollScriptedEvents(npcGame, () => {}, 2008);
  assert.equal(npcResult.pendingChoice, null, "should auto-resolve when the player isn't Beltrán Leyva");
  assert.ok(npcGame.cartels.beltran_leyva.resources.heat > npcHeatBefore);
  assert.equal(npcGame.cartels.beltran_leyva.relations.zetas.status, "alliance", "the historical default outcome is a Zetas alliance");
  assert.equal(npcGame.firedScriptedEvents.includes("arresto-mochomo-2008"), true);
});

test("the El Mochomo event's 'zetas' choice grants Beltrán Leyva a Zetas alliance and an army boost on top of the ongoing Sinaloa war", () => {
  const era = loadEra("fragmentacion-2006-2015.json");
  const game = buildGameFromEra(era, { mode: "existing", cartelId: "beltran_leyva", characterId: "arturo_beltran_leyva" });
  game.year = 2008;
  const armyBefore = game.cartels.beltran_leyva.resources.armySize;
  rollScriptedEvents(game, () => {}, 2008);
  resolveScriptedChoice(game, "arresto-mochomo-2008", "zetas");
  assert.equal(game.cartels.beltran_leyva.relations.sinaloa.status, "war");
  assert.equal(game.cartels.beltran_leyva.relations.zetas.status, "alliance");
  assert.equal(game.cartels.zetas.relations.beltran_leyva.status, "alliance");
  assert.ok(game.cartels.beltran_leyva.resources.armySize > armyBefore, "the Zetas alliance should reinforce the army");
});

test("the El Mochomo event's 'reconcile' choice can either end the ongoing war (low roll) or fail and keep it going (high roll)", () => {
  const era = loadEra("fragmentacion-2006-2015.json");
  const originalRandom = Math.random;
  try {
    Math.random = () => 0.01; // well under the 0.25 success threshold
    const luckyGame = buildGameFromEra(era, { mode: "existing", cartelId: "beltran_leyva", characterId: "arturo_beltran_leyva" });
    luckyGame.year = 2008;
    rollScriptedEvents(luckyGame, () => {}, 2008);
    resolveScriptedChoice(luckyGame, "arresto-mochomo-2008", "reconcile");
    assert.equal(luckyGame.cartels.beltran_leyva.relations.sinaloa.status, "neutral", "a successful truce should end the open war");
    const closedWar = luckyGame.warHistory.find((w) => w.key === ["beltran_leyva", "sinaloa"].sort().join("|"));
    assert.equal(closedWar.endYear, 2008, "the pre-existing war entry should be formally closed");

    Math.random = () => 0.99; // well over the 0.25 success threshold
    const unluckyGame = buildGameFromEra(era, { mode: "existing", cartelId: "beltran_leyva", characterId: "arturo_beltran_leyva" });
    unluckyGame.year = 2008;
    rollScriptedEvents(unluckyGame, () => {}, 2008);
    resolveScriptedChoice(unluckyGame, "arresto-mochomo-2008", "reconcile");
    assert.equal(unluckyGame.cartels.beltran_leyva.relations.sinaloa.status, "war", "a failed truce should leave the war going");
  } finally {
    Math.random = originalRandom;
  }
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
  // Test the income mechanism directly via the pure, deterministic getIncomeBreakdown rather
  // than through a full endTurn — a real endTurn also runs every other AI cartel (including
  // sabotage/raids that can target this cartel directly), which is unrelated noise for what's
  // actually being verified here: that reputation scales the export bonus.
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  const cartel = game.cartels.sinaloa;

  cartel.resources.internationalReputation = 0;
  const low = getIncomeBreakdown(game, cartel);

  cartel.resources.internationalReputation = 100;
  const high = getIncomeBreakdown(game, cartel);

  assert.equal(low.exportBonus, 0);
  assert.ok(high.exportBonus > low.exportBonus);
  assert.ok(high.territoryIncome > low.territoryIncome);
  assert.ok(high.net > low.net);
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

function minimalCoupGame({ sicariosBondWithPlayer = 0, allyBond = 50 } = {}) {
  const game = {
    turn: 0,
    memberBonds: {},
    characters: {
      leader: { id: "leader", alive: true, imprisoned: null, stats: { loyaltyInspiring: 0 } },
      underboss: { id: "underboss", alive: true, imprisoned: null, stats: { intrigue: 0 }, bondWithPlayer: 50 },
      sicarios: { id: "sicarios", alive: true, imprisoned: null, stats: { intrigue: 100 }, bondWithPlayer: sicariosBondWithPlayer },
      military: { id: "military", alive: true, imprisoned: null, stats: { intrigue: 0 }, bondWithPlayer: 50 },
    },
    cartels: {
      test: {
        id: "test",
        destroyed: false,
        resources: { money: 100000, heat: 10 },
        roles: { leader: "leader", underboss: "underboss", sicariosChief: "sicarios", militaryChief: "military" },
      },
    },
  };
  game.memberBonds[["sicarios", "military"].sort().join("|")] = allyBond;
  return game;
}

test("a plotter with a close ally among their peers is much more likely to escalate to a real coup than a lone plotter", () => {
  const originalRandom = Math.random;
  try {
    // call1 = underboss's outer roll (p=0, always false regardless of value)
    // call2 = sicarios' outer roll (p ~= 0.024 with these stats, needs a small value to pass)
    // call3 = sicarios' ally-vs-embezzle roll (0.3 if allied, 0.15 otherwise) - 0.2 sits between them
    // call4 = military's outer roll (p=0, always false regardless of value)
    const sequence = [0.5, 0.001, 0.2, 0.5];
    let i = 0;
    Math.random = () => sequence[Math.min(i++, sequence.length - 1)];

    const alliedGame = minimalCoupGame({ allyBond: 80 });
    const alliedCoups = rollLoyaltyEvents(alliedGame, () => {});
    assert.equal(alliedCoups.length, 1, "the same roll should escalate to a coup once a close ally is available");
    assert.equal(alliedCoups[0].plotterId, "sicarios");
    assert.equal(alliedCoups[0].allyId, "military");

    i = 0;
    const loneGame = minimalCoupGame({ allyBond: 40 });
    const loneCoups = rollLoyaltyEvents(loneGame, () => {});
    assert.equal(loneCoups.length, 0, "the exact same roll should fall back to mere embezzlement without a close ally");
    assert.ok(loneGame.cartels.test.resources.money < 100000, "the failed-to-escalate plotter should still skim some money");
  } finally {
    Math.random = originalRandom;
  }
});

test("getMemberBond defaults to 50 for an unset pair and 100 for a character with itself, and driftMemberBonds actually changes stored bonds", () => {
  const game = minimalCoupGame();
  assert.equal(getMemberBond(game, "leader", "leader"), 100);
  assert.equal(getMemberBond(game, "underboss", "leader"), 50, "no explicit bond set for this pair yet");
  assert.equal(getMemberBond(game, "sicarios", "military"), 50, "seeded value from minimalCoupGame's default allyBond");

  const originalRandom = Math.random;
  try {
    Math.random = () => 0; // pins randInt(-2,2) at its minimum, -2, for every pair
    driftMemberBonds(game);
  } finally {
    Math.random = originalRandom;
  }
  // Every living, unimprisoned pair in the leadership circle (leader/underboss/sicarios/military)
  // should have drifted down by 2 (heat=10 here, below the 60 threshold for the extra penalty).
  assert.equal(getMemberBond(game, "leader", "underboss"), 48);
  assert.equal(getMemberBond(game, "sicarios", "military"), 48);
});

function siblingRivalryGame({ bond = 20, ageA = 30, ageB = 28 } = {}) {
  const year = 2000;
  const game = {
    memberBonds: {},
    characters: {
      leader: { id: "leader", alive: true, imprisoned: null, childrenIds: ["siblingA", "siblingB"], stats: {} },
      siblingA: { id: "siblingA", alive: true, imprisoned: null, birthYear: year - ageA, name: "Hijo A", role: null, stats: { charisma: 50, loyaltyInspiring: 50 } },
      siblingB: { id: "siblingB", alive: true, imprisoned: null, birthYear: year - ageB, name: "Hijo B", role: null, stats: { charisma: 50, loyaltyInspiring: 50 } },
    },
    cartels: {
      test: { id: "test", destroyed: false, roles: { leader: "leader" } },
    },
  };
  game.memberBonds[["siblingA", "siblingB"].sort().join("|")] = bond;
  return { game, year };
}

test("rollSiblingRivalry never fires when siblings get along (bond >= 35), regardless of the roll", () => {
  const originalRandom = Math.random;
  try {
    Math.random = () => 0; // would pass every chance() check if bond allowed it
    const { game, year } = siblingRivalryGame({ bond: 60 });
    const deaths = rollSiblingRivalry(game, () => {}, year);
    assert.equal(deaths.length, 0);
    assert.equal(game.characters.siblingA.stats.charisma, 50, "no reputational hit should occur without genuine rivalry");
  } finally {
    Math.random = originalRandom;
  }
});

test("rollSiblingRivalry never fires between minors, even with a poor bond", () => {
  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    const { game, year } = siblingRivalryGame({ bond: 10, ageA: 15, ageB: 16 });
    const deaths = rollSiblingRivalry(game, () => {}, year);
    assert.equal(deaths.length, 0);
  } finally {
    Math.random = originalRandom;
  }
});

test("rollSiblingRivalry with a real rivalry (bond < 35) escalates to reputational sabotage or, more rarely, violence", () => {
  const originalRandom = Math.random;
  try {
    // call1 = the 0.02 chance the rivalry boils over at all this turn (needs a small value to pass)
    // call2 = the 0.5 coin flip for who schemes against whom (irrelevant to the outcome, any value works)
    // call3 = randInt(5,15) inside setMemberBond, consumed regardless of branch (value irrelevant)
    // call4 = the 0.85 chance it's "just" reputational sabotage rather than violence
    let sequence = [0.001, 0.9, 0.5, 0.5];
    let i = 0;
    Math.random = () => sequence[Math.min(i++, sequence.length - 1)];
    const { game, year } = siblingRivalryGame({ bond: 20 });
    const deaths = rollSiblingRivalry(game, () => {}, year);
    assert.equal(deaths.length, 0, "the sabotage branch shouldn't kill anyone");
    const targetStillAlive = game.characters.siblingA.alive && game.characters.siblingB.alive;
    assert.ok(targetStillAlive);
    const oneStatDropped = game.characters.siblingA.stats.charisma < 50 || game.characters.siblingB.stats.charisma < 50;
    assert.ok(oneStatDropped, "the target of the intrigue should take a reputational hit");

    i = 0;
    sequence = [0.001, 0.9, 0.5, 0.99]; // same setup, but now the rare violent-escalation branch
    const { game: violentGame, year: violentYear } = siblingRivalryGame({ bond: 20 });
    const violentDeaths = rollSiblingRivalry(violentGame, () => {}, violentYear);
    assert.equal(violentDeaths.length, 1, "the violent branch should register exactly one death");
    const deceased = violentGame.characters[violentDeaths[0].characterId];
    assert.equal(deceased.alive, false);
    assert.equal(violentDeaths[0].wasLeader, false, "a sibling is never the leader in this scenario");
  } finally {
    Math.random = originalRandom;
  }
});

test("getDrugProfile returns the era-specific profile, or a neutral default for an unknown era", () => {
  const chapitosGame = newGame("chapitos-mayiza-2024-actualidad.json", "chapitos");
  assert.equal(getDrugProfile(chapitosGame).name, DRUG_PROFILES["chapitos-mayiza-2024-actualidad"].name);

  const fallback = getDrugProfile({ eraId: "not-a-real-era" });
  assert.equal(fallback.payoutMult, 1);
  assert.equal(fallback.heatMult, 1);
  assert.equal(fallback.seizureMult, 1);
});

test("invest_production's payout scales with the era's drug profile, everything else held equal", () => {
  const originalRandom = Math.random;
  try {
    // 0.99 clears the seizure-chance roll in both games (its floor is ~0.03-0.04 even at heat=0,
    // so a literal 0 stub would trigger a seizure every time instead) and feeds the same value
    // into the payout's own random factor, isolating the drug profile as the only real difference.
    Math.random = () => 0.99;

    const lowMarginGame = newGame("guadalajara-1975-1989.json", "guadalajara"); // marijuana/heroin, payoutMult 0.85
    const lowCartel = lowMarginGame.cartels.guadalajara;
    lowCartel.resources.money = ACTION_COSTS.invest_production * 10;
    lowCartel.resources.heat = 0;
    const lowTerritoryId = lowCartel.territories[0];
    lowMarginGame.territories[lowTerritoryId].value = 20;

    const highMarginGame = newGame("chapitos-mayiza-2024-actualidad.json", "chapitos"); // fentanyl, payoutMult 1.5
    const highCartel = highMarginGame.cartels.chapitos;
    highCartel.resources.money = ACTION_COSTS.invest_production * 10;
    highCartel.resources.heat = 0;
    const highTerritoryId = highCartel.territories[0];
    highMarginGame.territories[highTerritoryId].value = 20;

    const lowResult = applyAction(lowMarginGame, "guadalajara", "invest_production", { territoryId: lowTerritoryId });
    const highResult = applyAction(highMarginGame, "chapitos", "invest_production", { territoryId: highTerritoryId });

    assert.equal(lowResult.ok, true);
    assert.equal(highResult.ok, true);
    const lowPayout = Number(lowResult.message.replace("+", ""));
    const highPayout = Number(highResult.message.replace("+", ""));
    assert.ok(highPayout > lowPayout, "the higher-margin era's drug profile should yield a bigger payout for the identical territory value and roll");
  } finally {
    Math.random = originalRandom;
  }
});

/** A minimal synthetic game with a single cartel/character, just enough for rollPoliceOperations
 * to run deterministically without needing to account for other cartels' independent rolls. */
function makeMiniGame({ heat, corruptPolice, violence }) {
  return {
    turn: 5,
    playerCharacterId: "player1",
    cartels: {
      mine: {
        id: "mine",
        destroyed: false,
        roles: { leader: "player1" },
        resources: { heat, corruptPolice, corruptGov: 0, armySize: 500 },
      },
    },
    characters: {
      player1: { id: "player1", cartelId: "mine", alive: true, imprisoned: null, stats: { violence }, name: "El Jefe" },
    },
  };
}

test("rollPoliceOperations defers to a pendingRaidTip instead of an immediate arrest when the player is tipped off in advance", () => {
  const game = makeMiniGame({ heat: 80, corruptPolice: 50, violence: 50 });
  const originalRandom = Math.random;
  let result;
  try {
    Math.random = () => 0; // guarantees both the op firing and the tip-off succeeding
    result = rollPoliceOperations(game, () => {}, 2020);
  } finally {
    Math.random = originalRandom;
  }
  assert.equal(result.pendingRaidTip, true);
  assert.equal(result.arrests.length, 0, "the arrest should be deferred, not committed, when tipped off");
  assert.equal(game.characters.player1.imprisoned, null, "the player shouldn't actually be imprisoned yet");
});

test("rollPoliceOperations falls through to an immediate, undeferred arrest when the tip-off roll fails", () => {
  const game = makeMiniGame({ heat: 50, corruptPolice: 0, violence: 10 });
  const originalRandom = Math.random;
  const sequence = [
    0, // 1: chance(opChance) -> true, the operation fires
    0, // 2: pick() inside pickArrestTarget -> irrelevant, only one candidate
    0.99, // 3: chance(tipOffChance) -> false, the tip-off attempt fails
    0, // 4: randInt(2,12) for the armySize hit -> value irrelevant
    0.99, // 5: chance(resistChance) -> false, corruption doesn't save them
    0.99, // 6: chance(lifeSentenceChance) -> false, not a life sentence
    0, // 7: randInt(6,30) for releaseTurn -> only consumed since lifeSentence is false
  ];
  let i = 0;
  let result;
  try {
    Math.random = () => sequence[Math.min(i++, sequence.length - 1)];
    result = rollPoliceOperations(game, () => {}, 2020);
  } finally {
    Math.random = originalRandom;
  }
  assert.equal(result.pendingRaidTip, null, "a failed tip-off roll should not defer anything");
  assert.equal(result.arrests.length, 1);
  assert.equal(result.arrests[0].characterId, "player1");
  assert.equal(result.arrests[0].wasLeader, true);
  assert.equal(result.arrests[0].lifeSentence, false);
  assert.equal(game.characters.player1.imprisoned.lifeSentence, false);
});

test("resolveRaidTip's 'hide' choice always avoids the arrest, at the cost of a small heat increase", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  const cartel = game.cartels.sinaloa;
  const heatBefore = cartel.resources.heat;
  const outcome = resolveRaidTip(game, "hide");
  assert.equal(outcome.pendingRegentChoice, null);
  assert.equal(outcome.pendingSuccession, null);
  assert.equal(game.characters[game.playerCharacterId].imprisoned, null);
  assert.ok(cartel.resources.heat > heatBefore, "hiding should still bump heat somewhat");
});

test("resolveRaidTip's 'bribe' choice spends money on the attempt and avoids arrest on success, but falls through to a normal arrest on failure", () => {
  const originalRandom = Math.random;
  try {
    const successGame = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    successGame.cartels.sinaloa.resources.money = 100_000_000;
    const moneyBefore = successGame.cartels.sinaloa.resources.money;
    Math.random = () => 0; // guarantees the bribe succeeds
    const successOutcome = resolveRaidTip(successGame, "bribe");
    assert.equal(successOutcome.pendingRegentChoice, null);
    assert.equal(successOutcome.pendingSuccession, null);
    assert.ok(successGame.cartels.sinaloa.resources.money < moneyBefore, "the bribe attempt should cost money even though it succeeded");
    assert.equal(successGame.characters[successGame.playerCharacterId].imprisoned, null);

    const failGame = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    failGame.cartels.sinaloa.resources.money = 100_000_000;
    failGame.cartels.sinaloa.resources.corruptPolice = 0;
    failGame.cartels.sinaloa.resources.heat = 90;
    Math.random = () => 0.99; // guarantees the bribe fails, and then the follow-up arrest resolution also fails to resist
    const failOutcome = resolveRaidTip(failGame, "bribe");
    assert.ok(failOutcome.pendingRegentChoice || failOutcome.pendingSuccession, "a failed bribe should fall through to a real arrest attempt");
    assert.ok(failGame.characters[failGame.playerCharacterId].imprisoned, "the player should end up imprisoned after the bribe fails and the raid proceeds");
  } finally {
    Math.random = originalRandom;
  }
});

test("resolveRaidTip's 'risk' choice goes through the same resolution as a normal, unwarned raid, including the life-sentence branch", () => {
  const originalRandom = Math.random;
  try {
    const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    const cartel = game.cartels.sinaloa;
    cartel.resources.corruptPolice = 0;
    cartel.resources.heat = 90;
    const player = game.characters[game.playerCharacterId];
    player.stats.violence = 90;
    // 0.3 is above the floored 0.05 resistChance (fails to resist) but below the ~0.69 lifeSentenceChance (life sentence).
    Math.random = () => 0.3;
    const outcome = resolveRaidTip(game, "risk");
    assert.ok(player.imprisoned, "risking it should be able to result in a real arrest");
    assert.equal(player.imprisoned.lifeSentence, true);
    assert.ok(outcome.pendingSuccession, "a life-sentence arrest of the player should surface a pendingSuccession, just like an unwarned arrest would");
    assert.equal(outcome.pendingRegentChoice, null);
  } finally {
    Math.random = originalRandom;
  }
});
