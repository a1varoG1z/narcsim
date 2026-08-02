import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGameFromEra } from "../js/state.js";
import { applyAction, getWarsForCartel, resolveScriptedChoice, endTurn, getActionsRemaining, ACTIONS_PER_TURN, ACTION_COSTS, getIncomeBreakdown, MONEY_SCALE, getDrugProfile, DRUG_PROFILES, resolveRaidTip, getSuccessionCandidates, resolveSuccession, resolveCoups, checkLandlessCollapse, attemptEscape } from "../js/turnEngine.js";
import { rollScriptedEvents } from "../js/scriptedEvents.js";
import { rollLoyaltyEvents, getMemberBond, driftMemberBonds, rollSiblingRivalry, rollPoliceOperations, rollMortality, policeOperationChance } from "../js/events.js";

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

test("extort_territory's approach changes the trade-off: 'brutal' pays more but costs far more heat/image than 'lenient', which can even improve image", () => {
  const originalRandom = Math.random;
  try {
    Math.random = () => 0.5; // pins the payout's own randomness identically across all three calls

    const lenientGame = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    const lenientCartel = lenientGame.cartels.sinaloa;
    const lenientTerritoryId = lenientCartel.territories[0];
    const lenientHeatBefore = lenientCartel.resources.heat;
    const lenientImageBefore = lenientCartel.resources.publicImage;
    const lenientResult = applyAction(lenientGame, "sinaloa", "extort_territory", { territoryId: lenientTerritoryId, approach: "lenient" });

    const discreetGame = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    const discreetCartel = discreetGame.cartels.sinaloa;
    const discreetTerritoryId = discreetCartel.territories[0];
    const discreetResult = applyAction(discreetGame, "sinaloa", "extort_territory", { territoryId: discreetTerritoryId });

    const brutalGame = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    const brutalCartel = brutalGame.cartels.sinaloa;
    const brutalTerritoryId = brutalCartel.territories[0];
    const brutalResult = applyAction(brutalGame, "sinaloa", "extort_territory", { territoryId: brutalTerritoryId, approach: "brutal" });

    assert.ok(brutalResult.payout > discreetResult.payout, "brutal should pay out more than the default discreet approach");
    assert.ok(discreetResult.payout > lenientResult.payout, "discreet should pay out more than lenient");
    assert.ok(brutalCartel.resources.heat > discreetCartel.resources.heat, "brutal should generate more heat than discreet");
    assert.ok(discreetCartel.resources.heat > lenientCartel.resources.heat, "discreet should generate more heat than lenient");
    assert.ok(lenientCartel.resources.heat - lenientHeatBefore <= 2, "lenient's heat bump should be minimal");
    assert.ok(lenientCartel.resources.publicImage > lenientImageBefore, "lenient extortion can actually improve public image");
  } finally {
    Math.random = originalRandom;
  }
});

test("corrupt_gov and corrupt_police default to 'standard' behavior when no approach is passed, matching what AI cartels get", () => {
  for (const type of ["corrupt_gov", "corrupt_police"]) {
    const field = type === "corrupt_gov" ? "corruptGov" : "corruptPolice";
    const withoutApproach = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    const withStandard = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    const originalRandom = Math.random;
    try {
      Math.random = () => 0.5;
      const r1 = applyAction(withoutApproach, "sinaloa", type);
      const r2 = applyAction(withStandard, "sinaloa", type, { approach: "standard" });
      assert.equal(r1.approach, "standard");
      assert.equal(withoutApproach.cartels.sinaloa.resources[field], withStandard.cartels.sinaloa.resources[field]);
      assert.equal(withoutApproach.cartels.sinaloa.resources.heat, withStandard.cartels.sinaloa.resources.heat);
      assert.equal(r2.approach, "standard");
    } finally {
      Math.random = originalRandom;
    }
  }
});

test("corrupt_gov and corrupt_police's approach changes the trade-off: 'quiet' trades a smaller gain for a bigger heat drop, 'aggressive' risks backfiring", () => {
  for (const type of ["corrupt_gov", "corrupt_police"]) {
    const field = type === "corrupt_gov" ? "corruptGov" : "corruptPolice";
    const originalRandom = Math.random;
    try {
      Math.random = () => 0.5; // pins the gain/heat rolls identically across approaches; still < 0.8, so 'aggressive' succeeds here
      const quietGame = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
      const quietBefore = { ...quietGame.cartels.sinaloa.resources };
      applyAction(quietGame, "sinaloa", type, { approach: "quiet" });

      const standardGame = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
      const standardBefore = { ...standardGame.cartels.sinaloa.resources };
      applyAction(standardGame, "sinaloa", type, { approach: "standard" });

      const aggressiveGame = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
      const aggressiveBefore = { ...aggressiveGame.cartels.sinaloa.resources };
      const aggressiveResult = applyAction(aggressiveGame, "sinaloa", type, { approach: "aggressive" });

      const quietGain = quietGame.cartels.sinaloa.resources[field] - quietBefore[field];
      const standardGain = standardGame.cartels.sinaloa.resources[field] - standardBefore[field];
      const aggressiveGain = aggressiveGame.cartels.sinaloa.resources[field] - aggressiveBefore[field];
      assert.ok(aggressiveGain > standardGain, `${type}: aggressive should gain more than standard`);
      assert.ok(standardGain > quietGain, `${type}: standard should gain more than quiet`);
      assert.ok(quietGame.cartels.sinaloa.resources.heat < standardGame.cartels.sinaloa.resources.heat, `${type}: quiet should cost less heat than standard`);
      assert.ok(aggressiveGame.cartels.sinaloa.resources.heat > standardGame.cartels.sinaloa.resources.heat, `${type}: aggressive should raise heat instead of lowering it`);
      assert.equal(aggressiveResult.backfired, false);
    } finally {
      Math.random = originalRandom;
    }
  }
});

test("corrupt_gov and corrupt_police's 'aggressive' approach can backfire, dropping the corruption stat and spiking heat hard", () => {
  for (const type of ["corrupt_gov", "corrupt_police"]) {
    const field = type === "corrupt_gov" ? "corruptGov" : "corruptPolice";
    const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    game.cartels.sinaloa.resources[field] = 50;
    const before = { ...game.cartels.sinaloa.resources };
    const originalRandom = Math.random;
    try {
      Math.random = () => 0.99; // guarantees the 20% backfire chance triggers
      const result = applyAction(game, "sinaloa", type, { approach: "aggressive" });
      assert.equal(result.ok, true);
      assert.equal(result.backfired, true);
      assert.ok(game.cartels.sinaloa.resources[field] < before[field], `${type}: a backfired attempt should reduce the corruption stat, not raise it`);
      assert.ok(game.cartels.sinaloa.resources.heat - before.heat >= 15, `${type}: a backfire should spike heat hard`);
    } finally {
      Math.random = originalRandom;
    }
  }
});

test("a skilled corruptionGovChief/corruptionPoliceChief genuinely gains more ground (and a weak one less) than an average chief in the same seat", () => {
  for (const { type, field, role } of [
    { type: "corrupt_gov", field: "corruptGov", role: "corruptionGovChief" },
    { type: "corrupt_police", field: "corruptPolice", role: "corruptionPoliceChief" },
  ]) {
    const skilledGame = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    const skilledChief = skilledGame.characters[skilledGame.cartels.sinaloa.roles[role]];
    skilledChief.stats.charisma = 100;
    skilledChief.stats.intrigue = 100;

    const weakGame = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    const weakChief = weakGame.characters[weakGame.cartels.sinaloa.roles[role]];
    weakChief.stats.charisma = 1;
    weakChief.stats.intrigue = 1;

    const originalRandom = Math.random;
    try {
      Math.random = () => 0.5; // pins the base randInt roll identically in both games
      const skilledBefore = skilledGame.cartels.sinaloa.resources[field];
      applyAction(skilledGame, "sinaloa", type, { approach: "standard" });
      const skilledGain = skilledGame.cartels.sinaloa.resources[field] - skilledBefore;

      const weakBefore = weakGame.cartels.sinaloa.resources[field];
      applyAction(weakGame, "sinaloa", type, { approach: "standard" });
      const weakGain = weakGame.cartels.sinaloa.resources[field] - weakBefore;

      assert.ok(skilledGain > weakGain, `${type}: a charismatic, cunning chief (skill 100) should out-perform a weak one (skill 1) at the identical base roll`);
    } finally {
      Math.random = originalRandom;
    }
  }
});

test("a highly skilled corruption chief makes the 'aggressive' approach meaningfully safer than a weak one", () => {
  for (const { type, role } of [
    { type: "corrupt_gov", role: "corruptionGovChief" },
    { type: "corrupt_police", role: "corruptionPoliceChief" },
  ]) {
    const skilledGame = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    const skilledChief = skilledGame.characters[skilledGame.cartels.sinaloa.roles[role]];
    skilledChief.stats.charisma = 100;
    skilledChief.stats.intrigue = 100;
    // skill 100 -> chance = clamp(0.8 + 50/250, 0.5, 0.95) = 0.95

    const weakGame = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    const weakChief = weakGame.characters[weakGame.cartels.sinaloa.roles[role]];
    weakChief.stats.charisma = 1;
    weakChief.stats.intrigue = 1;
    // skill ~1 -> chance = clamp(0.8 - 49/250, 0.5, 0.95) = 0.604

    const originalRandom = Math.random;
    try {
      Math.random = () => 0.7; // between the weak chief's ~0.6 chance (fails) and the skilled chief's 0.95 (succeeds)
      const weakResult = applyAction(weakGame, "sinaloa", type, { approach: "aggressive" });
      assert.equal(weakResult.backfired, true, `${type}: a weak chief's aggressive push should backfire at this roll`);

      const skilledResult = applyAction(skilledGame, "sinaloa", type, { approach: "aggressive" });
      assert.equal(skilledResult.backfired, false, `${type}: the same roll should succeed for a highly skilled chief`);
    } finally {
      Math.random = originalRandom;
    }
  }
});

test("a charismatic prChief genuinely raises publicImage gains for press_release, corridos_campaign, and social_work over a weak one", () => {
  for (const type of ["press_release", "corridos_campaign", "social_work"]) {
    const skilledGame = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    skilledGame.characters[skilledGame.cartels.sinaloa.roles.prChief].stats.charisma = 100;

    const weakGame = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    weakGame.characters[weakGame.cartels.sinaloa.roles.prChief].stats.charisma = 1;

    const originalRandom = Math.random;
    try {
      Math.random = () => 0.5; // pins the base randInt roll identically in both games
      const skilledBefore = skilledGame.cartels.sinaloa.resources.publicImage;
      applyAction(skilledGame, "sinaloa", type);
      const skilledGain = skilledGame.cartels.sinaloa.resources.publicImage - skilledBefore;

      const weakBefore = weakGame.cartels.sinaloa.resources.publicImage;
      applyAction(weakGame, "sinaloa", type);
      const weakGain = weakGame.cartels.sinaloa.resources.publicImage - weakBefore;

      assert.ok(skilledGain > weakGain, `${type}: a charismatic prChief (100) should out-perform a weak one (1) at the identical base roll`);
    } finally {
      Math.random = originalRandom;
    }
  }
});

test("a skilled prChief sheds more heat from damage_control than a weak one", () => {
  const skilledGame = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  skilledGame.characters[skilledGame.cartels.sinaloa.roles.prChief].stats.charisma = 100;
  skilledGame.cartels.sinaloa.resources.heat = 80;

  const weakGame = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  weakGame.characters[weakGame.cartels.sinaloa.roles.prChief].stats.charisma = 1;
  weakGame.cartels.sinaloa.resources.heat = 80;

  const originalRandom = Math.random;
  try {
    Math.random = () => 0.5;
    applyAction(skilledGame, "sinaloa", "damage_control");
    applyAction(weakGame, "sinaloa", "damage_control");
    assert.ok(skilledGame.cartels.sinaloa.resources.heat < weakGame.cartels.sinaloa.resources.heat, "a skilled prChief's damage control should shed more heat than a weak one at the identical base roll");
  } finally {
    Math.random = originalRandom;
  }
});

test("international_interview lets a charismatic prChief matter even though the leader always exists (whoever is more charismatic fronts the interview)", () => {
  const strongLeaderGame = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  strongLeaderGame.characters[strongLeaderGame.cartels.sinaloa.roles.leader].stats.charisma = 20;
  strongLeaderGame.characters[strongLeaderGame.cartels.sinaloa.roles.prChief].stats.charisma = 100;
  // charisma = max(20, 100) = 100 -> successChance = clamp(100/130, 0.2, 0.75) = 0.75

  const weakBothGame = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  weakBothGame.characters[weakBothGame.cartels.sinaloa.roles.leader].stats.charisma = 20;
  weakBothGame.characters[weakBothGame.cartels.sinaloa.roles.prChief].stats.charisma = 20;
  // charisma = max(20, 20) = 20 -> successChance = clamp(20/130, 0.2, 0.75) = 0.2

  const originalRandom = Math.random;
  try {
    Math.random = () => 0.3; // above the weak-both 0.2 chance (fails), below the strong-prChief 0.75 chance (succeeds)
    const withStrongPrChief = applyAction(strongLeaderGame, "sinaloa", "international_interview");
    assert.equal(withStrongPrChief.success, true, "a highly charismatic prChief should be able to front the interview even with a weak leader");

    const withWeakBoth = applyAction(weakBothGame, "sinaloa", "international_interview");
    assert.equal(withWeakBoth.success, false, "with both leader and prChief weak, the same roll should fail");
  } finally {
    Math.random = originalRandom;
  }
});

test("a skilled productionChief genuinely raises invest_production's payout and lowers its seizure risk versus a weak one", () => {
  const originalRandom = Math.random;
  try {
    Math.random = () => 0.99; // clears the seizure roll in both games regardless of the bonus, isolating payout
    const skilledGame = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    skilledGame.cartels.sinaloa.resources.money = ACTION_COSTS.invest_production * 10;
    skilledGame.cartels.sinaloa.resources.heat = 0;
    skilledGame.characters[skilledGame.cartels.sinaloa.roles.productionChief].stats.business = 100;
    skilledGame.characters[skilledGame.cartels.sinaloa.roles.productionChief].stats.stealth = 100;

    const weakGame = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    weakGame.cartels.sinaloa.resources.money = ACTION_COSTS.invest_production * 10;
    weakGame.cartels.sinaloa.resources.heat = 0;
    weakGame.characters[weakGame.cartels.sinaloa.roles.productionChief].stats.business = 1;
    weakGame.characters[weakGame.cartels.sinaloa.roles.productionChief].stats.stealth = 1;

    const skilledResult = applyAction(skilledGame, "sinaloa", "invest_production");
    const weakResult = applyAction(weakGame, "sinaloa", "invest_production");
    const skilledPayout = Number(skilledResult.message.replace("+", ""));
    const weakPayout = Number(weakResult.message.replace("+", ""));
    assert.ok(skilledPayout > weakPayout, "a skilled productionChief (business/stealth 100) should out-earn a weak one (1) at the identical base roll");

    // Now isolate the seizure-risk side: heat=90 puts the base chance well inside [0.02, 0.5], so
    // the ±6-point role bonus (as a ±0.06 probability shift) can straddle a fixed roll.
    const seizeSkilledGame = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    seizeSkilledGame.cartels.sinaloa.resources.money = ACTION_COSTS.invest_production * 10;
    seizeSkilledGame.cartels.sinaloa.resources.heat = 90;
    seizeSkilledGame.characters[seizeSkilledGame.cartels.sinaloa.roles.productionChief].stats.business = 100;
    seizeSkilledGame.characters[seizeSkilledGame.cartels.sinaloa.roles.productionChief].stats.stealth = 100;

    const seizeWeakGame = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    seizeWeakGame.cartels.sinaloa.resources.money = ACTION_COSTS.invest_production * 10;
    seizeWeakGame.cartels.sinaloa.resources.heat = 90;
    seizeWeakGame.characters[seizeWeakGame.cartels.sinaloa.roles.productionChief].stats.business = 1;
    seizeWeakGame.characters[seizeWeakGame.cartels.sinaloa.roles.productionChief].stats.stealth = 1;

    Math.random = () => 0.27; // between the skilled chief's ~0.21 seize chance and the weak chief's ~0.33
    const seizeSkilledResult = applyAction(seizeSkilledGame, "sinaloa", "invest_production");
    assert.notEqual(seizeSkilledResult.message, "Decomiso.", "a skilled productionChief should avoid a seizure at this roll");
    const seizeWeakResult = applyAction(seizeWeakGame, "sinaloa", "invest_production");
    assert.equal(seizeWeakResult.message, "Decomiso.", "a weak productionChief should still get seized at the identical roll");
  } finally {
    Math.random = originalRandom;
  }
});

test("a skilled traffickingChief genuinely raises traffic_shipment's payout and lowers its interdiction risk versus a weak one", () => {
  const originalRandom = Math.random;
  try {
    Math.random = () => 0.99; // clears the interdiction roll in both games, isolating payout
    const skilledGame = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    skilledGame.cartels.sinaloa.resources.money = ACTION_COSTS.traffic_shipment * 10;
    skilledGame.cartels.sinaloa.resources.heat = 0;
    skilledGame.characters[skilledGame.cartels.sinaloa.roles.traffickingChief].stats.intrigue = 100;
    skilledGame.characters[skilledGame.cartels.sinaloa.roles.traffickingChief].stats.stealth = 100;

    const weakGame = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    weakGame.cartels.sinaloa.resources.money = ACTION_COSTS.traffic_shipment * 10;
    weakGame.cartels.sinaloa.resources.heat = 0;
    weakGame.characters[weakGame.cartels.sinaloa.roles.traffickingChief].stats.intrigue = 1;
    weakGame.characters[weakGame.cartels.sinaloa.roles.traffickingChief].stats.stealth = 1;

    const skilledResult = applyAction(skilledGame, "sinaloa", "traffic_shipment");
    const weakResult = applyAction(weakGame, "sinaloa", "traffic_shipment");
    assert.ok(skilledGame.cartels.sinaloa.resources.money > weakGame.cartels.sinaloa.resources.money, "a skilled traffickingChief (intrigue/stealth 100) should net more money than a weak one (1) at the identical base roll");
    assert.notEqual(skilledResult.message, "Interceptado.");
    assert.notEqual(weakResult.message, "Interceptado.");

    // Isolate the interdiction-risk side: heat=110 puts the base chance at the [0.05, 0.5] ceiling
    // before the seizure multiplier, so the ±0.06 role-bonus shift can straddle a fixed roll.
    const interdictSkilledGame = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    interdictSkilledGame.cartels.sinaloa.resources.money = ACTION_COSTS.traffic_shipment * 10;
    interdictSkilledGame.cartels.sinaloa.resources.heat = 110;
    interdictSkilledGame.characters[interdictSkilledGame.cartels.sinaloa.roles.traffickingChief].stats.intrigue = 100;
    interdictSkilledGame.characters[interdictSkilledGame.cartels.sinaloa.roles.traffickingChief].stats.stealth = 100;

    const interdictWeakGame = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    interdictWeakGame.cartels.sinaloa.resources.money = ACTION_COSTS.traffic_shipment * 10;
    interdictWeakGame.cartels.sinaloa.resources.heat = 110;
    interdictWeakGame.characters[interdictWeakGame.cartels.sinaloa.roles.traffickingChief].stats.intrigue = 1;
    interdictWeakGame.characters[interdictWeakGame.cartels.sinaloa.roles.traffickingChief].stats.stealth = 1;

    Math.random = () => 0.45; // between the skilled chief's ~0.39 interdiction chance and the weak chief's ~0.51
    const interdictSkilledResult = applyAction(interdictSkilledGame, "sinaloa", "traffic_shipment");
    assert.notEqual(interdictSkilledResult.message, "Interceptado.", "a skilled traffickingChief should avoid interdiction at this roll");
    const interdictWeakResult = applyAction(interdictWeakGame, "sinaloa", "traffic_shipment");
    assert.equal(interdictWeakResult.message, "Interceptado.", "a weak traffickingChief should still get interdicted at the identical roll");
  } finally {
    Math.random = originalRandom;
  }
});

test("intercept_shipment is genuinely harder against a target with a skilled traffickingChief than a weak one", () => {
  const originalRandom = Math.random;
  try {
    const raidSkilledDefense = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    raidSkilledDefense.cartels.sinaloa.resources.money = ACTION_COSTS.intercept_shipment * 10;
    const raider1 = raidSkilledDefense.characters[raidSkilledDefense.cartels.sinaloa.roles.sicariosChief];
    raider1.stats.violence = 50;
    raider1.stats.stealth = 50;
    raidSkilledDefense.cartels.cjng.resources.corruptPolice = 0;
    raidSkilledDefense.characters[raidSkilledDefense.cartels.cjng.roles.traffickingChief].stats.intrigue = 100;
    raidSkilledDefense.characters[raidSkilledDefense.cartels.cjng.roles.traffickingChief].stats.stealth = 100;

    const raidWeakDefense = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    raidWeakDefense.cartels.sinaloa.resources.money = ACTION_COSTS.intercept_shipment * 10;
    const raider2 = raidWeakDefense.characters[raidWeakDefense.cartels.sinaloa.roles.sicariosChief];
    raider2.stats.violence = 50;
    raider2.stats.stealth = 50;
    raidWeakDefense.cartels.cjng.resources.corruptPolice = 0;
    raidWeakDefense.characters[raidWeakDefense.cartels.cjng.roles.traffickingChief].stats.intrigue = 1;
    raidWeakDefense.characters[raidWeakDefense.cartels.cjng.roles.traffickingChief].stats.stealth = 1;

    Math.random = () => 0.5; // between the skilled-defense ~0.459 success chance and the weak-defense ~0.531
    const vsSkilled = applyAction(raidSkilledDefense, "sinaloa", "intercept_shipment", { targetCartelId: "cjng" });
    assert.equal(vsSkilled.success, false, "a skilled traffickingChief on the target's side should thwart the ambush at this roll");
    const vsWeak = applyAction(raidWeakDefense, "sinaloa", "intercept_shipment", { targetCartelId: "cjng" });
    assert.equal(vsWeak.success, true, "the identical roll should succeed against a weak traffickingChief's shipment");
  } finally {
    Math.random = originalRandom;
  }
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
  assert.equal(game.characters[targetLeaderId].deathCause, "un atentado");
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
    assert.equal(successGame.characters[successTargetId].deathCause, "un atentado disfrazado de accidente");
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

test("assassinate_rival can target a member of your own cartel (e.g. a discovered traitor), but never your own leader or the character you control", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  const cartel = game.cartels.sinaloa;
  cartel.resources.money = 100_000_000;

  const leaderResult = applyAction(game, "sinaloa", "assassinate_rival", { targetCharacterId: cartel.roles.leader });
  assert.equal(leaderResult.ok, false, "ordering a hit on your own cartel's leader should be refused");

  const selfResult = applyAction(game, "sinaloa", "assassinate_rival", { targetCharacterId: game.playerCharacterId });
  assert.equal(selfResult.ok, false, "ordering a hit on whoever you currently control should be refused");

  const underbossId = cartel.roles.underboss;
  const originalRandom = Math.random;
  try {
    Math.random = () => 0; // guarantee both the attempt and (if it were the player) the survival roll succeed
    const result = applyAction(game, "sinaloa", "assassinate_rival", { targetCharacterId: underbossId });
    assert.equal(result.ok, true, "hitting a non-leader member of your own cartel should be a valid order");
    assert.equal(result.success, true);
  } finally {
    Math.random = originalRandom;
  }
  assert.equal(game.characters[underbossId].alive, false);
  assert.equal(game.characters[underbossId].deathCause, "una purga interna");
  assert.notEqual(cartel.roles.underboss, underbossId, "the role should have been vacated (and refilled by fillVacantRoles) rather than still pointing at the dead character");
  // No rival cartel was involved, so there's nothing to go to war over.
  assert.equal(Object.values(cartel.relations).some((rel) => rel.status === "war"), false);
});

test("a successful or failed internal purge damages bondWithPlayer for the rest of the leadership circle, not the target", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  const cartel = game.cartels.sinaloa;
  cartel.resources.money = 100_000_000;
  const underbossId = cartel.roles.underboss;
  const sicariosChiefId = cartel.roles.sicariosChief;
  game.characters[sicariosChiefId].bondWithPlayer = 50;

  const originalRandom = Math.random;
  try {
    Math.random = () => 0.99; // guarantee the hit fails
    const result = applyAction(game, "sinaloa", "assassinate_rival", { targetCharacterId: underbossId });
    assert.equal(result.ok, true);
    assert.equal(result.success, false);
  } finally {
    Math.random = originalRandom;
  }
  assert.equal(game.characters[underbossId].alive, true, "a failed attempt should leave the target alive");
  assert.ok(game.characters[sicariosChiefId].bondWithPlayer < 50, "a bystander in the leadership circle should trust you less after a failed internal purge");
});

test("assassinate_rival killing someone outside your cartel can leave a living, role-holding relative with a vendetta against the attacker, but not a relative without a role", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  const cartel = game.cartels.sinaloa;
  cartel.resources.money = 100_000_000;
  // rosalinda_gonzalez (financeChief, not the leader, so her death doesn't trigger a succession that
  // could hand a role to el_menchito) is married to el_mencho (the leader) and mother to el_menchito
  // (who holds no role at all).
  const targetId = "rosalinda_gonzalez";
  const husband = game.characters.el_mencho;
  const son = game.characters.el_menchito;
  assert.equal(son.role, null, "sanity check: the son should start with no cartel role");

  const originalRandom = Math.random;
  try {
    Math.random = () => 0; // guarantees both the hit and the (50%) grief roll succeed
    const result = applyAction(game, "sinaloa", "assassinate_rival", { targetCharacterId: targetId });
    assert.equal(result.success, true);
  } finally {
    Math.random = originalRandom;
  }
  assert.equal(game.characters[targetId].alive, false);
  assert.deepEqual(husband.vendetta, { targetCartelId: "sinaloa", sinceTurn: game.turn }, "a role-holding widower should swear revenge against the cartel that killed his wife");
  assert.equal(son.vendetta, null, "a relative with no cartel role shouldn't pick up a vendetta — they have no mechanical way to act on it");
});

test("assassinate_rival never assigns a vendetta for an internal purge (there's no rival cartel to blame)", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  const cartel = game.cartels.sinaloa;
  cartel.resources.money = 100_000_000;
  const underbossId = cartel.roles.underboss;

  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    applyAction(game, "sinaloa", "assassinate_rival", { targetCharacterId: underbossId });
  } finally {
    Math.random = originalRandom;
  }
  assert.equal(game.characters[underbossId].alive, false);
  assert.ok(Object.values(game.characters).every((c) => !c.vendetta), "no character should have picked up a vendetta from a purely internal purge");
});

test("an active vendetta gives a real success bonus against the exact cartel it targets, and resolves (clears) once the avenger's hit actually succeeds", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  const cartel = game.cartels.sinaloa;
  cartel.resources.money = 100_000_000;
  const hitman = game.characters[cartel.roles.sicariosChief];
  hitman.stats.stealth = 50;
  hitman.stats.violence = 50;
  const targetCartel = game.cartels.cjng;
  const targetId = targetCartel.roles.underboss;
  const target = game.characters[targetId];
  target.stats.stealth = 50;
  targetCartel.resources.corruptPolice = 0;
  // attackSkill = (50+50)/2 = 50; defenseSkill = 50 + 0/4 = 50; base successChance = clamp(0.35 + 0/150) = 0.35

  const originalRandom = Math.random;
  try {
    Math.random = () => 0.4; // above the unboosted 0.35 base chance
    const withoutVendetta = applyAction(game, "sinaloa", "assassinate_rival", { targetCharacterId: targetId });
    assert.equal(withoutVendetta.success, false, "0.4 should fail against the unboosted 0.35 base chance");

    cartel.resources.money = 100_000_000;
    hitman.vendetta = { targetCartelId: "cjng", sinceTurn: game.turn };
    Math.random = () => 0.4; // still above 0.35, but under the vendetta-boosted 0.35+0.12=0.47
    const withVendetta = applyAction(game, "sinaloa", "assassinate_rival", { targetCharacterId: targetId });
    assert.equal(withVendetta.success, true, "an active vendetta against this exact cartel should push the same roll over the line");
    assert.equal(hitman.vendetta, null, "a successful revenge hit should resolve and clear the vendetta");
  } finally {
    Math.random = originalRandom;
  }
});

test("a vendetta against one cartel gives no bonus when the hit targets a different cartel, and fades on its own if never acted on", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  const cartel = game.cartels.sinaloa;
  cartel.resources.money = 100_000_000;
  const hitman = game.characters[cartel.roles.sicariosChief];
  hitman.stats.stealth = 50;
  hitman.stats.violence = 50;
  hitman.vendetta = { targetCartelId: "golfo", sinceTurn: game.turn }; // grudge against a different cartel entirely
  const targetCartel = game.cartels.cjng;
  const targetId = targetCartel.roles.underboss;
  game.characters[targetId].stats.stealth = 50;
  targetCartel.resources.corruptPolice = 0;

  const originalRandom = Math.random;
  try {
    Math.random = () => 0.4; // above the unboosted 0.35 base chance for CJNG, and unaffected by the unrelated Gulf vendetta
    const result = applyAction(game, "sinaloa", "assassinate_rival", { targetCharacterId: targetId });
    assert.equal(result.success, false, "a vendetta against the Gulf cartel shouldn't help a hit against CJNG");
  } finally {
    Math.random = originalRandom;
  }
  assert.deepEqual(hitman.vendetta, { targetCartelId: "golfo", sinceTurn: 0 }, "an unrelated, unused vendetta should still be sitting there");

  hitman.vendetta.sinceTurn = game.turn - 16; // backdate past the expiry window instead of simulating 16 real turns
  endTurn(game);
  assert.equal(hitman.vendetta, null, "a vendetta that's never acted on should fade after enough time passes");
});

test("poach_member refuses insufficient funds, an invalid target, and a rival cartel's own leader", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  const cartel = game.cartels.sinaloa;
  const cjng = game.cartels.cjng;

  cartel.resources.money = 0;
  const poorResult = applyAction(game, "sinaloa", "poach_member", { targetCharacterId: cjng.roles.underboss });
  assert.equal(poorResult.ok, false);

  cartel.resources.money = 100_000_000;
  const leaderResult = applyAction(game, "sinaloa", "poach_member", { targetCharacterId: cjng.roles.leader });
  assert.equal(leaderResult.ok, false, "a rival cartel's own leader should never be poachable");

  const sameCartelResult = applyAction(game, "sinaloa", "poach_member", { targetCharacterId: cartel.roles.underboss });
  assert.equal(sameCartelResult.ok, false, "you can't poach your own cartel's members");

  const missingResult = applyAction(game, "sinaloa", "poach_member", { targetCharacterId: "does-not-exist" });
  assert.equal(missingResult.ok, false);
});

test("poach_member moves a successfully recruited rival member into your own cartel and spikes tension; a failure leaves them in place", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  const cartel = game.cartels.sinaloa;
  const cjng = game.cartels.cjng;
  cartel.resources.money = 100_000_000;
  const underbossId = cjng.roles.underboss;
  const originalTension = cartel.relations.cjng?.tension ?? 30;

  const originalRandom = Math.random;
  try {
    Math.random = () => 0; // guarantee success
    const result = applyAction(game, "sinaloa", "poach_member", { targetCharacterId: underbossId });
    assert.equal(result.ok, true);
    assert.equal(result.success, true);
  } finally {
    Math.random = originalRandom;
  }
  const poached = game.characters[underbossId];
  assert.equal(poached.cartelId, "sinaloa", "the poached member should now belong to the recruiting cartel");
  assert.ok(cartel.characters.includes(underbossId), "the poached member should be added to the new cartel's roster");
  assert.ok(!cjng.characters.includes(underbossId), "the poached member should be removed from their old cartel's roster");
  assert.notEqual(cjng.roles.underboss, underbossId, "their old role should have been vacated (and refilled)");
  assert.ok(cartel.relations.cjng.tension > originalTension, "poaching a rival's member should spike tension between the two cartels");
  assert.equal(cjng.relations.sinaloa.tension, cartel.relations.cjng.tension, "tension should be mirrored symmetrically on both sides");
});

test("poach_member's success chance improves when the two cartels are already at war, reflecting easier wartime defections", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  const cartel = game.cartels.sinaloa;
  const cjng = game.cartels.cjng;
  cartel.resources.money = 100_000_000 * 3;
  const target = game.characters[cjng.roles.underboss];
  target.stats.loyaltyInspiring = 90;
  target.bondWithPlayer = 90;
  // Pin the recruiter's persuasion low so the math is fully deterministic regardless of era data:
  // loyalty = 90 + (90-50)/2 = 110; neutral chance = clamp(0.3 + (10-110)/150, .1, .6) = 0.1 (floor);
  // at-war chance = clamp(0.1 + 0.12, .1, .7) = 0.22.
  const recruiter = game.characters[cartel.roles.diplomatChief];
  recruiter.stats.charisma = 10;
  recruiter.stats.intrigue = 10;

  cjng.relations.sinaloa = { status: "neutral", tension: 30 };
  cartel.relations.cjng = { status: "neutral", tension: 30 };
  const originalRandom = Math.random;
  let neutralResult;
  try {
    Math.random = () => 0.15; // above the neutral floor (0.1) but below the at-war boosted chance (0.22)
    neutralResult = applyAction(game, "sinaloa", "poach_member", { targetCharacterId: target.id });
  } finally {
    Math.random = originalRandom;
  }
  assert.equal(neutralResult.success, false, "such a loyal target should resist recruitment while at peace");

  cartel.resources.money = 100_000_000;
  cjng.relations.sinaloa = { status: "war", tension: 95 };
  cartel.relations.cjng = { status: "war", tension: 95 };
  try {
    Math.random = () => 0.15;
    const warResult = applyAction(game, "sinaloa", "poach_member", { targetCharacterId: target.id });
    assert.equal(warResult.success, true, "the same roll should succeed once being at war makes defection easier");
  } finally {
    Math.random = originalRandom;
  }
});

test("poach_member's persuasionBoost (from how the actual conversation went) genuinely moves the success chance, but is a no-op when absent (e.g. an AI-initiated poach)", () => {
  // Each case gets its own fresh game: a successful poach permanently moves the target to the
  // attacker's cartel, so reusing the same target across cases would invalidate later calls.
  const setupCase = () => {
    const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    const cartel = game.cartels.sinaloa;
    const cjng = game.cartels.cjng;
    cartel.resources.money = 100_000_000;
    const target = game.characters[cjng.roles.underboss];
    target.stats.loyaltyInspiring = 90;
    target.bondWithPlayer = 90;
    const recruiter = game.characters[cartel.roles.diplomatChief];
    recruiter.stats.charisma = 10;
    recruiter.stats.intrigue = 10;
    cjng.relations.sinaloa = { status: "neutral", tension: 30 };
    cartel.relations.cjng = { status: "neutral", tension: 30 };
    return { game, target };
  };
  // Baseline (no boost) chance is the same 0.1 floor as the war-comparison test above.

  const originalRandom = Math.random;
  try {
    Math.random = () => 0.15; // above the unboosted 0.1 floor
    const { game: gameNoBoost, target: targetNoBoost } = setupCase();
    const withoutBoost = applyAction(gameNoBoost, "sinaloa", "poach_member", { targetCharacterId: targetNoBoost.id });
    assert.equal(withoutBoost.success, false, "no persuasionBoost (e.g. an AI poach, or the old instant-click flow) should behave exactly as before");

    // persuasionBoost of 5 (a strong conversation) adds 5*0.02 = 0.10, pushing 0.1 -> 0.2, over the 0.15 roll.
    const { game: gameBoost, target: targetBoost } = setupCase();
    const withBoost = applyAction(gameBoost, "sinaloa", "poach_member", { targetCharacterId: targetBoost.id, persuasionBoost: 5 });
    assert.equal(withBoost.success, true, "a strong conversation should push the same roll over the line");

    // A hostile conversation (negative boost) should make an already-marginal roll worse, not better:
    // chance drops from 0.1 to 0.04, clamped to the 0.05 floor.
    Math.random = () => 0.08; // under the unboosted 0.1 floor
    const { game: gameNegBoost, target: targetNegBoost } = setupCase();
    const withNegativeBoost = applyAction(gameNegBoost, "sinaloa", "poach_member", { targetCharacterId: targetNegBoost.id, persuasionBoost: -3 });
    assert.equal(withNegativeBoost.success, false, "a poorly-handled conversation should make the roll fail, same as unboosted");
  } finally {
    Math.random = originalRandom;
  }
});

test("assassinate_rival killing the player's own character defers to the succession pipeline instead of silently calling autoSuccession", () => {
  // The player leads sinaloa; a rival AI cartel (cjng) successfully assassinates them.
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  const player = game.cartels.sinaloa;
  const playerCharacterId = game.playerCharacterId;
  game.cartels.cjng.resources.money = 100_000_000;

  const originalRandom = Math.random;
  let result;
  // 1: chance(successChance) -> true, the hit connects. 2: chance(0.55) survival roll for the
  // player -> false (0.99 >= 0.55), so this test exercises the "doesn't survive" branch.
  const sequence = [0, 0.99];
  let i = 0;
  try {
    Math.random = () => sequence[Math.min(i++, sequence.length - 1)];
    result = applyAction(game, "cjng", "assassinate_rival", { targetCharacterId: playerCharacterId });
  } finally {
    Math.random = originalRandom;
  }

  assert.equal(result.ok, true);
  assert.equal(result.success, true);
  assert.equal(game.characters[playerCharacterId].alive, false);
  assert.deepEqual(game._pendingPlayerDeath, { characterId: playerCharacterId, cartelId: "sinaloa", reason: "atentado" });
  // Crucially, leadership must NOT already have been silently reassigned via autoSuccession —
  // that's left for resolveSuccession once the player actually picks a successor.
  assert.equal(player.roles.leader, playerCharacterId, "leadership shouldn't change until the player picks an heir");
  assert.equal(game.playerCharacterId, playerCharacterId, "playerCharacterId shouldn't change until resolveSuccession runs");
});

test("endTurn surfaces a pendingSuccession (reason 'atentado') when an AI's assassinate_rival kills the player mid-turn, and resolveSuccession then hands over control correctly", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  const playerCharacterId = game.playerCharacterId;
  const player = game.cartels.sinaloa;
  // Simulate exactly what runAiCartels would have done: an AI cartel's assassinate_rival
  // succeeded against the player earlier in this same endTurn call.
  game._pendingPlayerDeath = { characterId: playerCharacterId, cartelId: "sinaloa", reason: "atentado" };
  game.characters[playerCharacterId].alive = false;
  game.characters[playerCharacterId].deathYear = game.year;

  const result = endTurn(game);
  assert.ok(result.pendingSuccession, "the deferred player death should surface as a pendingSuccession");
  assert.equal(result.pendingSuccession.deceasedId, playerCharacterId);
  assert.equal(result.pendingSuccession.reason, "atentado");
  assert.equal("_pendingPlayerDeath" in game, false, "the transient scratch field should never leak into persisted game state");

  const candidates = getSuccessionCandidates(game, result.pendingSuccession.cartelId, playerCharacterId);
  assert.ok(candidates.length > 0, "expected at least one succession candidate in this roster");
  resolveSuccession(game, candidates[0].id);
  assert.equal(game.playerCharacterId, candidates[0].id, "control should now be handed over to the chosen heir");
  assert.equal(player.roles.leader, candidates[0].id);
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

test("sabotage_rival defaults to 'standard' behavior when no approach is passed, matching what AI cartels get", () => {
  const originalRandom = Math.random;
  try {
    Math.random = () => 0.5;
    const withoutApproach = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    const withStandard = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    const r1 = applyAction(withoutApproach, "sinaloa", "sabotage_rival", { targetCartelId: "cjng" });
    const r2 = applyAction(withStandard, "sinaloa", "sabotage_rival", { targetCartelId: "cjng", approach: "standard" });
    assert.equal(r1.approach, "standard");
    assert.equal(r2.approach, "standard");
    assert.equal(withoutApproach.cartels.cjng.resources.money, withStandard.cartels.cjng.resources.money);
    assert.equal(withoutApproach.cartels.sinaloa.resources.heat, withStandard.cartels.sinaloa.resources.heat);
  } finally {
    Math.random = originalRandom;
  }
});

test("sabotage_rival's approach is a genuine trade-off: 'covert' does less damage for much less heat, 'explosive' does more damage for much more heat", () => {
  const originalRandom = Math.random;
  try {
    Math.random = () => 0.01; // low enough that even 'explosive's reduced success chance still succeeds; pins every roll to its range floor
    const covertGame = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    const covertResult = applyAction(covertGame, "sinaloa", "sabotage_rival", { targetCartelId: "cjng", approach: "covert" });

    const standardGame = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    const standardResult = applyAction(standardGame, "sinaloa", "sabotage_rival", { targetCartelId: "cjng", approach: "standard" });

    const explosiveGame = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    const explosiveResult = applyAction(explosiveGame, "sinaloa", "sabotage_rival", { targetCartelId: "cjng", approach: "explosive" });

    assert.equal(covertResult.success, true);
    assert.equal(standardResult.success, true);
    assert.equal(explosiveResult.success, true);
    assert.ok(covertResult.damage < standardResult.damage, "covert should damage less than standard");
    assert.ok(standardResult.damage < explosiveResult.damage, "explosive should damage more than standard");
    assert.ok(covertGame.cartels.cjng.resources.heat < standardGame.cartels.cjng.resources.heat, "covert should raise the target's heat less than standard");
    assert.ok(standardGame.cartels.cjng.resources.heat < explosiveGame.cartels.cjng.resources.heat, "explosive should raise the target's heat more than standard");
    assert.ok(covertGame.cartels.sinaloa.relations.cjng.tension < standardGame.cartels.sinaloa.relations.cjng.tension, "covert should raise tension less than standard");
    assert.ok(standardGame.cartels.sinaloa.relations.cjng.tension < explosiveGame.cartels.sinaloa.relations.cjng.tension, "explosive should raise tension more than standard");
  } finally {
    Math.random = originalRandom;
  }
});

test("sabotage_rival's 'explosive' approach costs its own army men when it fails, unlike 'covert' or 'standard'", () => {
  const originalRandom = Math.random;
  try {
    Math.random = () => 0.99; // guarantees failure regardless of approach
    const covertGame = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    const covertArmyBefore = covertGame.cartels.sinaloa.resources.armySize;
    const covertResult = applyAction(covertGame, "sinaloa", "sabotage_rival", { targetCartelId: "cjng", approach: "covert" });

    const standardGame = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    const standardArmyBefore = standardGame.cartels.sinaloa.resources.armySize;
    const standardResult = applyAction(standardGame, "sinaloa", "sabotage_rival", { targetCartelId: "cjng", approach: "standard" });

    const explosiveGame = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    const explosiveArmyBefore = explosiveGame.cartels.sinaloa.resources.armySize;
    const explosiveResult = applyAction(explosiveGame, "sinaloa", "sabotage_rival", { targetCartelId: "cjng", approach: "explosive" });

    assert.equal(covertResult.success, false);
    assert.equal(standardResult.success, false);
    assert.equal(explosiveResult.success, false);
    assert.equal(covertGame.cartels.sinaloa.resources.armySize, covertArmyBefore, "a failed covert sabotage shouldn't cost army men");
    assert.equal(standardGame.cartels.sinaloa.resources.armySize, standardArmyBefore, "a failed standard sabotage shouldn't cost army men");
    assert.ok(explosiveGame.cartels.sinaloa.resources.armySize < explosiveArmyBefore, "a failed explosive sabotage should cost army men in the resulting firefight");
  } finally {
    Math.random = originalRandom;
  }
});

test("intercept_shipment refuses insufficient funds and an invalid or same-cartel target", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  const cartel = game.cartels.sinaloa;

  cartel.resources.money = 0;
  const poorResult = applyAction(game, "sinaloa", "intercept_shipment", { targetCartelId: "cjng" });
  assert.equal(poorResult.ok, false);

  cartel.resources.money = 100_000_000;
  const sameCartelResult = applyAction(game, "sinaloa", "intercept_shipment", { targetCartelId: "sinaloa" });
  assert.equal(sameCartelResult.ok, false);

  const missingResult = applyAction(game, "sinaloa", "intercept_shipment", { targetCartelId: "does-not-exist" });
  assert.equal(missingResult.ok, false);
});

test("intercept_shipment moves money from the target to the attacker (keeping half of what's seized) and draws heat on both sides when it succeeds", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  const cartel = game.cartels.sinaloa;
  const cjng = game.cartels.cjng;
  cartel.resources.money = 100_000_000;
  cartel.resources.heat = 20;
  cjng.resources.money = 50_000_000;
  cjng.resources.heat = 20;
  const cjngMoneyBefore = cjng.resources.money;

  const originalRandom = Math.random;
  let result;
  try {
    Math.random = () => 0; // guarantee success regardless of era/stat variance
    result = applyAction(game, "sinaloa", "intercept_shipment", { targetCartelId: "cjng" });
  } finally {
    Math.random = originalRandom;
  }
  assert.equal(result.ok, true);
  assert.equal(result.success, true);
  assert.ok(result.seized > 0);
  assert.equal(result.gained, Math.round(result.seized * 0.5), "the attacker should only pocket half of what was seized from the target");
  assert.equal(cjng.resources.money, cjngMoneyBefore - result.seized, "the target should lose exactly the seized amount");
  assert.ok(cartel.resources.heat > 20, "the attacker should draw heat from the ambush");
  assert.ok(cjng.resources.heat > 20, "the target should draw heat too since their route got hit");
});

test("intercept_shipment costs the attacker army and heat on failure, without touching the target's money at all", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  const cartel = game.cartels.sinaloa;
  const cjng = game.cartels.cjng;
  cartel.resources.money = 100_000_000;
  cartel.resources.armySize = 1000;
  const cjngMoneyBefore = cjng.resources.money;

  const originalRandom = Math.random;
  let result;
  try {
    Math.random = () => 0.99; // above the 0.8 success-chance ceiling regardless of era/stat variance: guaranteed failure
    result = applyAction(game, "sinaloa", "intercept_shipment", { targetCartelId: "cjng" });
  } finally {
    Math.random = originalRandom;
  }
  assert.equal(result.ok, true);
  assert.equal(result.success, false);
  assert.equal(cjng.resources.money, cjngMoneyBefore, "a failed ambush shouldn't touch the target's money at all");
  assert.ok(cartel.resources.armySize < 1000, "a failed ambush should cost the attacker some men");
});

test("recruit_informant succeeds or fails, refuses invalid targets/insufficient funds/the target's own leader, and the resulting informant decays over its turn duration", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  const cartel = game.cartels.sinaloa;
  const cjngUnderbossId = game.cartels.cjng.roles.underboss;
  cartel.resources.money = 0;
  const poorResult = applyAction(game, "sinaloa", "recruit_informant", { targetCharacterId: cjngUnderbossId });
  assert.equal(poorResult.ok, false);

  cartel.resources.money = 100_000_000;
  const sameCartelResult = applyAction(game, "sinaloa", "recruit_informant", { targetCharacterId: cartel.roles.underboss });
  assert.equal(sameCartelResult.ok, false);

  const leaderResult = applyAction(game, "sinaloa", "recruit_informant", { targetCharacterId: game.cartels.cjng.roles.leader });
  assert.equal(leaderResult.ok, false, "a rival cartel's own leader shouldn't inform on themselves");

  const missingResult = applyAction(game, "sinaloa", "recruit_informant", { targetCharacterId: "does-not-exist" });
  assert.equal(missingResult.ok, false);

  const originalRandom = Math.random;
  let result;
  try {
    Math.random = () => 0; // guarantees the recruitment attempt succeeds
    result = applyAction(game, "sinaloa", "recruit_informant", { targetCharacterId: cjngUnderbossId });
  } finally {
    Math.random = originalRandom;
  }
  assert.equal(result.ok, true);
  assert.equal(result.success, true);
  assert.ok(cartel.informants && cartel.informants.cjng, "a successful recruitment should register an informant");
  assert.equal(cartel.informants.cjng.characterId, cjngUnderbossId, "the informant record should remember exactly who agreed to talk");
  const turns = cartel.informants.cjng.turnsRemaining;
  assert.ok(turns >= 4 && turns <= 8, "the informant's duration should be within the documented 4-8 turn range");

  for (let i = 0; i < turns; i++) endTurn(game);
  assert.equal(cartel.informants.cjng, undefined, "the informant should have expired after its duration in turns");
});

test("recruit_informant's persuasionBoost (from how the actual conversation went) genuinely moves the success chance, but is a no-op when absent (e.g. an AI-initiated recruitment)", () => {
  const setupCase = () => {
    const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    const cartel = game.cartels.sinaloa;
    const cjng = game.cartels.cjng;
    cartel.resources.money = 100_000_000;
    cjng.resources.corruptPolice = 0;
    const recruiter = game.characters[cartel.roles.intelChief] || game.characters[cartel.roles.sicariosChief];
    recruiter.stats.intrigue = 50;
    recruiter.stats.stealth = 50;
    const target = game.characters[cjng.roles.underboss];
    target.stats.loyaltyInspiring = 50;
    return { game, target };
    // skill = 50; personalResistance = (50-50)/4 = 0; defense = 0/2+25+0 = 25;
    // base successChance = clamp(0.35 + (50-25)/150, .15, .7) = 0.5167.
  };

  const originalRandom = Math.random;
  try {
    Math.random = () => 0.55; // above the unboosted ~0.517 chance
    const { game: gameNoBoost, target: targetNoBoost } = setupCase();
    const withoutBoost = applyAction(gameNoBoost, "sinaloa", "recruit_informant", { targetCharacterId: targetNoBoost.id });
    assert.equal(withoutBoost.success, false, "no persuasionBoost (e.g. an AI recruitment, or the old instant-click flow) should behave exactly as before");

    // persuasionBoost of 5 adds 5*0.02 = 0.10, pushing ~0.517 -> ~0.617, over the 0.55 roll.
    const { game: gameBoost, target: targetBoost } = setupCase();
    const withBoost = applyAction(gameBoost, "sinaloa", "recruit_informant", { targetCharacterId: targetBoost.id, persuasionBoost: 5 });
    assert.equal(withBoost.success, true, "a strong conversation should push the same roll over the line");
  } finally {
    Math.random = originalRandom;
  }
});

test("recruit_informant is genuinely easier against a target with weak personal loyalty than a staunchly loyal one, same recruiter skill", () => {
  const setupCase = (loyaltyInspiring) => {
    const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    const cartel = game.cartels.sinaloa;
    const cjng = game.cartels.cjng;
    cartel.resources.money = 100_000_000;
    cjng.resources.corruptPolice = 0;
    const recruiter = game.characters[cartel.roles.intelChief] || game.characters[cartel.roles.sicariosChief];
    recruiter.stats.intrigue = 50;
    recruiter.stats.stealth = 50;
    const target = game.characters[cjng.roles.underboss];
    target.stats.loyaltyInspiring = loyaltyInspiring;
    return { game, target };
  };
  // loyalty 100 -> personalResistance +12 -> defense 37 -> chance = clamp(0.35 + 13/150) = 0.4367
  // loyalty 0   -> personalResistance -12 -> defense 13 -> chance = clamp(0.35 + 37/150) = 0.5967

  const originalRandom = Math.random;
  try {
    Math.random = () => 0.5; // between the two chances above
    const { game: loyalGame, target: loyalTarget } = setupCase(100);
    const vsLoyal = applyAction(loyalGame, "sinaloa", "recruit_informant", { targetCharacterId: loyalTarget.id });
    assert.equal(vsLoyal.success, false, "a staunchly loyal target should resist at this roll");

    const { game: weakGame, target: weakTarget } = setupCase(0);
    const vsWeak = applyAction(weakGame, "sinaloa", "recruit_informant", { targetCharacterId: weakTarget.id });
    assert.equal(vsWeak.success, true, "the identical roll should succeed against a target with weak personal loyalty");
  } finally {
    Math.random = originalRandom;
  }
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

test("raid_territory defaults to 'standard' behavior when no approach is passed, matching what AI cartels get", () => {
  const originalRandom = Math.random;
  try {
    Math.random = () => 0.5;
    const withoutApproach = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    const withStandard = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    withoutApproach.cartels.sinaloa.resources.money = 100_000_000;
    withStandard.cartels.sinaloa.resources.money = 100_000_000;
    const r1 = applyAction(withoutApproach, "sinaloa", "raid_territory", { territoryId: "jalisco" });
    const r2 = applyAction(withStandard, "sinaloa", "raid_territory", { territoryId: "jalisco", approach: "standard" });
    assert.equal(r1.approach, "standard");
    assert.equal(r2.approach, "standard");
    assert.equal(r1.casualties, r2.casualties);
    assert.equal(withoutApproach.cartels.cjng.resources.heat, withStandard.cartels.cjng.resources.heat);
    assert.equal(withoutApproach.cartels.sinaloa.resources.heat, withStandard.cartels.sinaloa.resources.heat);
  } finally {
    Math.random = originalRandom;
  }
});

test("raid_territory's approach is a genuine trade-off: 'surgical' causes less damage and heat, 'all_out' causes much more but costs your own army men too", () => {
  const originalRandom = Math.random;
  try {
    Math.random = () => 0.01; // pins every roll to its range floor, for a clean relative comparison
    const surgicalGame = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    surgicalGame.cartels.sinaloa.resources.money = 100_000_000;
    const surgicalArmyBefore = surgicalGame.cartels.sinaloa.resources.armySize;
    const surgicalResult = applyAction(surgicalGame, "sinaloa", "raid_territory", { territoryId: "jalisco", approach: "surgical" });

    const standardGame = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    standardGame.cartels.sinaloa.resources.money = 100_000_000;
    const standardArmyBefore = standardGame.cartels.sinaloa.resources.armySize;
    const standardResult = applyAction(standardGame, "sinaloa", "raid_territory", { territoryId: "jalisco", approach: "standard" });

    const allOutGame = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    allOutGame.cartels.sinaloa.resources.money = 100_000_000;
    const allOutArmyBefore = allOutGame.cartels.sinaloa.resources.armySize;
    const allOutResult = applyAction(allOutGame, "sinaloa", "raid_territory", { territoryId: "jalisco", approach: "all_out" });

    assert.ok(surgicalResult.casualties < standardResult.casualties, "surgical should cause fewer casualties than standard");
    assert.ok(standardResult.casualties < allOutResult.casualties, "all_out should cause more casualties than standard");
    assert.ok(surgicalGame.cartels.cjng.resources.heat < standardGame.cartels.cjng.resources.heat, "surgical should raise the defender's heat less than standard");
    assert.ok(standardGame.cartels.cjng.resources.heat < allOutGame.cartels.cjng.resources.heat, "all_out should raise the defender's heat more than standard");
    assert.equal(surgicalGame.cartels.sinaloa.resources.armySize, surgicalArmyBefore, "surgical shouldn't cost the attacker any army men");
    assert.equal(standardGame.cartels.sinaloa.resources.armySize, standardArmyBefore, "standard shouldn't cost the attacker any army men");
    assert.ok(allOutGame.cartels.sinaloa.resources.armySize < allOutArmyBefore, "all_out should cost the attacker army men in the resulting firefight");
  } finally {
    Math.random = originalRandom;
  }
});

test("intimidate_territory only works on an adjacent enemy-owned territory, and unlike raid_territory never causes casualties", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  const cartel = game.cartels.sinaloa;
  cartel.resources.money = 100_000_000;

  const notAdjacent = applyAction(game, "sinaloa", "intimidate_territory", { territoryId: "tamaulipas" }); // owned by golfo, not adjacent to sinaloa
  assert.equal(notAdjacent.ok, false);

  const ownTerritory = applyAction(game, "sinaloa", "intimidate_territory", { territoryId: cartel.territories[0] });
  assert.equal(ownTerritory.ok, false);

  const adjacentEnemyTerritory = "jalisco"; // owned by cjng, adjacent to sinaloa's chihuahua in this era
  const defender = game.cartels[game.territories[adjacentEnemyTerritory].controllerId];
  const armyBefore = defender.resources.armySize;

  const result = applyAction(game, "sinaloa", "intimidate_territory", { territoryId: adjacentEnemyTerritory });
  assert.equal(result.ok, true);
  assert.equal(defender.resources.armySize, armyBefore, "intimidation should never cause casualties, unlike a raid");
  assert.equal(game.territories[adjacentEnemyTerritory].controllerId, defender.id, "intimidation should never transfer ownership");
});

test("intimidate_territory's success damages the defender's public image and the territory's value with no bloodshed; failure costs more heat instead", () => {
  const originalRandom = Math.random;
  try {
    const successGame = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    successGame.cartels.sinaloa.resources.money = 100_000_000;
    const target = "jalisco"; // owned by cjng
    const defender = successGame.cartels[successGame.territories[target].controllerId];
    const imageBefore = defender.resources.publicImage;
    const valueBefore = successGame.territories[target].value;
    const heatBefore = successGame.cartels.sinaloa.resources.heat;
    Math.random = () => 0; // guarantees chance() succeeds
    const successResult = applyAction(successGame, "sinaloa", "intimidate_territory", { territoryId: target });
    assert.equal(successResult.ok, true);
    assert.equal(successResult.success, true);
    assert.ok(defender.resources.publicImage < imageBefore, "a successful intimidation should damage the defender's public image");
    assert.ok(successGame.territories[target].value < valueBefore);
    assert.ok(successGame.cartels.sinaloa.resources.heat > heatBefore, "even a success is loud enough to raise the attacker's own heat");

    const failGame = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    failGame.cartels.sinaloa.resources.money = 100_000_000;
    const failDefender = failGame.cartels[failGame.territories[target].controllerId];
    const failImageBefore = failDefender.resources.publicImage;
    const failHeatBefore = failGame.cartels.sinaloa.resources.heat;
    Math.random = () => 0.99; // guarantees chance() fails
    const failResult = applyAction(failGame, "sinaloa", "intimidate_territory", { territoryId: target });
    assert.equal(failResult.ok, true);
    assert.equal(failResult.success, false);
    assert.equal(failDefender.resources.publicImage, failImageBefore, "a failed attempt shouldn't damage the defender at all");
    const failHeatGain = failGame.cartels.sinaloa.resources.heat - failHeatBefore;
    const successHeatGain = successGame.cartels.sinaloa.resources.heat - heatBefore;
    assert.ok(failHeatGain > successHeatGain, "getting exposed while failing should cost more heat than a clean success");
  } finally {
    Math.random = originalRandom;
  }
});

test("intimidate_territory records an 'intimidated' reactive event when the player's cartel is the target", () => {
  const originalRandom = Math.random;
  try {
    const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    game.cartels.cjng.resources.money = ACTION_COSTS.intimidate_territory * 10;
    game._reactiveEvents = [];
    Math.random = () => 0;
    const target = "sinaloa_t"; // owned by sinaloa, adjacent to cjng's jalisco in this era
    const result = applyAction(game, "cjng", "intimidate_territory", { territoryId: target });
    assert.equal(result.ok, true);
    assert.equal(result.success, true);
    assert.equal(game._reactiveEvents.length, 1);
    assert.deepEqual(game._reactiveEvents[0], {
      type: "intimidated",
      byCartelId: "cjng",
      byCartelName: game.cartels.cjng.name,
      territoryName: game.territories[target].name,
      success: true,
    });
  } finally {
    Math.random = originalRandom;
  }
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

test("invest_security grants a capped, cumulative reduction to assassination risk, and refuses without enough money", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  const cartel = game.cartels.cjng;

  cartel.resources.money = 0;
  const poorResult = applyAction(game, "cjng", "invest_security");
  assert.equal(poorResult.ok, false);

  cartel.resources.money = 100_000_000;
  for (let i = 0; i < 20; i++) {
    applyAction(game, "cjng", "invest_security");
  }
  assert.equal(cartel.resources.securityBonus, 0.3, "10 purchases of +3% each should hit the 30% cap");
});

test("invest_security's bonus only protects the cartel's actual leader from assassination, not other role-holders", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  const cartel = game.cartels.sinaloa;
  const attacker = game.cartels.cjng;
  attacker.resources.money = 100_000_000;
  cartel.resources.securityBonus = 0.3;
  cartel.resources.corruptPolice = 0;
  const hitman = game.characters[attacker.roles.sicariosChief];
  hitman.stats.stealth = 100;
  hitman.stats.violence = 100;
  const leaderId = cartel.roles.leader;
  const underbossId = cartel.roles.underboss;
  // Pin both targets' stealth to the same value so the only real difference between the two
  // attempts below is the leader's security bonus, not incidental differences in era-data stats.
  game.characters[leaderId].stats.stealth = 50;
  game.characters[underbossId].stats.stealth = 50;
  // attackSkill = 100, defenseSkill = 50 (stealth) + 0 (corruptPolice/4) => base chance = clamp(0.35 + 50/150, .1, .75) = 0.683.
  // Against the leader specifically, the 0.3 security bonus knocks that down to 0.383.

  const originalRandom = Math.random;
  try {
    Math.random = () => 0.5; // under 0.683 (succeeds vs. an unprotected target), over 0.383 (fails vs. the secured leader)
    const leaderResult = applyAction(game, "cjng", "assassinate_rival", { targetCharacterId: leaderId });
    assert.equal(leaderResult.success, false, "the leader's security detail should be enough to foil this particular roll");

    attacker.resources.money = 100_000_000; // reset spend for the second attempt
    const underbossResult = applyAction(game, "cjng", "assassinate_rival", { targetCharacterId: underbossId });
    assert.equal(underbossResult.success, true, "the same roll should still succeed against a target the security detail doesn't cover");
  } finally {
    Math.random = originalRandom;
  }
});

test("invest_hideout grants a capped, cumulative bonus, and refuses without enough money", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  const cartel = game.cartels.cjng;

  cartel.resources.money = 0;
  const poorResult = applyAction(game, "cjng", "invest_hideout");
  assert.equal(poorResult.ok, false);

  cartel.resources.money = 100_000_000;
  for (let i = 0; i < 20; i++) {
    applyAction(game, "cjng", "invest_hideout");
  }
  assert.equal(cartel.resources.hideoutBonus, 0.3, "10 purchases of +3% each should hit the 30% cap");
});

test("invest_hideout's bonus only helps the player personally resist a police raid, not the cartel at large", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  const cartel = game.cartels.sinaloa;
  cartel.resources.heat = 60;
  cartel.resources.corruptPolice = 0;
  cartel.resources.corruptGov = 0;
  // Restrict arrest candidates to just the player-controlled leader, so pickArrestTarget can't
  // land on some other NPC and make the test's outcome depend on who got picked.
  cartel.roles = { leader: game.playerCharacterId };

  // opChance = clamp((60-0)/500, 0, .5) = 0.12; tipOffChance = clamp((0-12)/140, .1, .65) = 0.1 (floor);
  // resistChance without a hideout = clamp((0-18)/150, .05, .7) = 0.05 (floor); with a 0.3 hideout
  // bonus, resistChance becomes clamp(0.05+0.3, .05, .9) = 0.35. A stub of 0.11 threads all of it:
  // triggers the operation (< 0.12), skips the advance-warning tip-off (>= 0.1), fails to resist
  // without a hideout (>= 0.05) but succeeds in resisting with one (< 0.35).
  // With a single fixed Math.random() stub applied across every cartel in the era, other cartels'
  // own (unrelated) international-reputation-driven raid risk can also cross the threshold and
  // produce their own arrests — that's real, intended behavior, just not what this test is about.
  // Filter down to sinaloa's own arrest so the assertion stays about the player's cartel only.
  const sinaloaArrests = (arrests) => arrests.filter((a) => a.cartelId === "sinaloa");

  const originalRandom = Math.random;
  try {
    Math.random = () => 0.11;
    const { arrests: withoutHideout } = rollPoliceOperations(game, () => {}, game.year);
    assert.equal(sinaloaArrests(withoutHideout).length, 1, "without a hideout, this exact roll should still result in an arrest");
  } finally {
    Math.random = originalRandom;
  }

  game.characters[game.playerCharacterId].imprisoned = null;
  cartel.resources.heat = 60; // the first (arrest) call reduced this; reset so the math stays identical
  cartel.resources.hideoutBonus = 0.3;
  try {
    Math.random = () => 0.11;
    const { arrests: withHideout } = rollPoliceOperations(game, () => {}, game.year);
    assert.equal(sinaloaArrests(withHideout).length, 0, "the exact same roll should let the player's hideout help them dodge the raid entirely");
  } finally {
    Math.random = originalRandom;
  }
});

test("invest_hideout's bonus also improves the player's prison escape odds", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  const cartel = game.cartels.sinaloa;
  const player = game.characters[game.playerCharacterId];
  player.stats.stealth = 10;
  player.stats.intrigue = 10;
  cartel.resources.corruptPolice = 0;
  player.imprisoned = { sinceTurn: game.turn, releaseTurn: game.turn + 20, lifeSentence: false };
  // successChance = clamp((10*.4 + 10*.35 + 0)/100 - .1, .05, .75) = clamp(-0.025, .05, .75) = 0.05 (floor).
  // With a 0.3 hideout bonus: clamp(0.05 + 0.3, .05, .9) = 0.35.
  const originalRandom = Math.random;
  try {
    Math.random = () => 0.2; // above the unaided floor (0.05) but below the hideout-boosted chance (0.35)
    const withoutHideout = attemptEscape(game);
    assert.equal(withoutHideout.success, false, "such poor stats should fail to escape without a hideout");
  } finally {
    Math.random = originalRandom;
  }

  cartel.resources.hideoutBonus = 0.3;
  try {
    Math.random = () => 0.2;
    const withHideout = attemptEscape(game);
    assert.equal(withHideout.success, true, "the same roll should succeed once the hideout's escape routes help");
  } finally {
    Math.random = originalRandom;
  }
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

test("Pablo Escobar's 1993 death kills him and hands Medellín a new leader when he's not the player", () => {
  const era = loadEra("medellin-cali-1980-1995.json");
  const npcGame = buildGameFromEra(era, { mode: "existing", cartelId: "cali", characterId: "gilberto_rodriguez" });
  npcGame.firedScriptedEvents = ["guerra-extradicion-1989"]; // already resolved by the time we jump to 1993

  const result = rollScriptedEvents(npcGame, () => {}, 1993);
  assert.equal(result.deaths.length, 1);
  assert.equal(result.deaths[0].characterId, "pablo_escobar");
  assert.equal(result.deaths[0].wasLeader, true);
  assert.equal(npcGame.characters.pablo_escobar.alive, false);
  assert.equal(
    npcGame.characters.pablo_escobar.deathCause,
    "un tiroteo en un tejado de Medellín, acorralado por el Bloque de Búsqueda tras año y medio de persecución desde su fuga de La Catedral"
  );
  assert.equal(npcGame.firedScriptedEvents.includes("muerte-escobar-1993"), true);
});

test("Pablo Escobar's 1993 death gives the player a 55% chance to survive when controlling him directly", () => {
  const era = loadEra("medellin-cali-1980-1995.json");
  const originalRandom = Math.random;
  try {
    const survives = buildGameFromEra(era, { mode: "existing", cartelId: "medellin", characterId: "pablo_escobar" });
    survives.firedScriptedEvents = ["guerra-extradicion-1989"];
    Math.random = () => 0.99; // >= 0.55, so the survival roll succeeds
    const survivedResult = rollScriptedEvents(survives, () => {}, 1993);
    assert.equal(survivedResult.deaths.length, 0, "Escobar should survive when the roll favors the player");
    assert.equal(survives.characters.pablo_escobar.alive, true);

    const dies = buildGameFromEra(era, { mode: "existing", cartelId: "medellin", characterId: "pablo_escobar" });
    dies.firedScriptedEvents = ["guerra-extradicion-1989"];
    Math.random = () => 0; // < 0.55, so the historical death goes through
    const diedResult = rollScriptedEvents(dies, () => {}, 1993);
    assert.equal(diedResult.deaths.length, 1);
    assert.equal(dies.characters.pablo_escobar.alive, false);
  } finally {
    Math.random = originalRandom;
  }
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

test("the 2002 fall of the Arellano Félix brothers kills Ramón and imprisons Benjamín for life when neither is the player, handing Tijuana a new leader", () => {
  const era = loadEra("mexico-rutas-1990-2006.json");
  const npcGame = buildGameFromEra(era, { mode: "existing", cartelId: "sinaloa", characterId: "chapo_guzman" });
  // Jumping straight to 2002 (rather than simulating turn-by-turn) means this era's earlier,
  // unrelated scripted events (1997, 2001) would also be "due" and fire alongside this one —
  // mark them as already resolved, exactly as real turn-by-turn play would have by this point.
  npcGame.firedScriptedEvents = ["arresto-chapo-1993", "muerte-amado-1997", "fuga-chapo-2001"];

  const result = rollScriptedEvents(npcGame, () => {}, 2002);
  assert.equal(result.deaths.length, 1);
  assert.equal(result.deaths[0].characterId, "ramon_arellano");
  assert.equal(result.arrests.length, 1);
  assert.equal(result.arrests[0].characterId, "benjamin_arellano");
  assert.equal(result.arrests[0].lifeSentence, true);
  assert.equal(result.arrests[0].wasLeader, true, "Benjamín was Tijuana's leader at the time");

  assert.equal(npcGame.characters.ramon_arellano.alive, false);
  assert.equal(npcGame.characters.ramon_arellano.deathCause, "un tiroteo con la policía en Mazatlán, tras ser reconocido en un control de tráfico");
  assert.equal(npcGame.characters.benjamin_arellano.imprisoned.lifeSentence, true);
  assert.equal(npcGame.firedScriptedEvents.includes("caida-arellano-felix-2002"), true);
});

test("the 2002 fall of the Arellano Félix brothers gives the player a 55% chance to defy fate when controlling either Ramón or Benjamín directly", () => {
  const era = loadEra("mexico-rutas-1990-2006.json");
  const originalRandom = Math.random;
  try {
    const ramonSurvives = buildGameFromEra(era, { mode: "existing", cartelId: "tijuana", characterId: "ramon_arellano" });
    ramonSurvives.firedScriptedEvents = ["arresto-chapo-1993", "muerte-amado-1997", "fuga-chapo-2001"];
    Math.random = () => 0.99; // >= 0.55, so the survival chance() call fails and he lives
    const survivedResult = rollScriptedEvents(ramonSurvives, () => {}, 2002);
    assert.equal(survivedResult.deaths.length, 0, "Ramón should survive when the roll favors the player");
    assert.equal(ramonSurvives.characters.ramon_arellano.alive, true);
    // Benjamín's arrest still happens independently in the same event beat.
    assert.equal(survivedResult.arrests.length, 1);
    assert.equal(survivedResult.arrests[0].characterId, "benjamin_arellano");

    const ramonDies = buildGameFromEra(era, { mode: "existing", cartelId: "tijuana", characterId: "ramon_arellano" });
    ramonDies.firedScriptedEvents = ["arresto-chapo-1993", "muerte-amado-1997", "fuga-chapo-2001"];
    Math.random = () => 0; // < 0.55, so the roll succeeds and the historical death goes through
    const diedResult = rollScriptedEvents(ramonDies, () => {}, 2002);
    assert.equal(diedResult.deaths.length, 1);
    assert.equal(ramonDies.characters.ramon_arellano.alive, false);

    const benjaminEvades = buildGameFromEra(era, { mode: "existing", cartelId: "tijuana", characterId: "benjamin_arellano" });
    benjaminEvades.firedScriptedEvents = ["arresto-chapo-1993", "muerte-amado-1997", "fuga-chapo-2001"];
    Math.random = () => 0.99;
    const evadedResult = rollScriptedEvents(benjaminEvades, () => {}, 2002);
    assert.equal(evadedResult.arrests.length, 0, "Benjamín should evade capture when the roll favors the player");
    assert.equal(benjaminEvades.characters.benjamin_arellano.imprisoned, null);
    // Ramón's death still happens independently.
    assert.equal(evadedResult.deaths.length, 1);

    const benjaminCaptured = buildGameFromEra(era, { mode: "existing", cartelId: "tijuana", characterId: "benjamin_arellano" });
    benjaminCaptured.firedScriptedEvents = ["arresto-chapo-1993", "muerte-amado-1997", "fuga-chapo-2001"];
    Math.random = () => 0;
    const capturedResult = rollScriptedEvents(benjaminCaptured, () => {}, 2002);
    assert.equal(capturedResult.arrests.length, 1);
    assert.equal(benjaminCaptured.characters.benjamin_arellano.imprisoned.lifeSentence, true);
  } finally {
    Math.random = originalRandom;
  }
});

test("a scripted arrest correctly flows through endTurn's own arrests-processing loop and surfaces a pendingSuccession when it lands on the player", () => {
  const era = loadEra("mexico-rutas-1990-2006.json");
  const game = buildGameFromEra(era, { mode: "existing", cartelId: "tijuana", characterId: "benjamin_arellano" });
  game.turn = 24; // land squarely on 2002 given this era's start year/turn length
  const originalRandom = Math.random;
  try {
    Math.random = () => 0; // guarantees the historical arrest goes through
    const result = endTurn(game);
    assert.ok(result.pendingSuccession, "a life-sentence arrest of the player's own character should surface a succession choice");
    assert.equal(result.pendingSuccession.deceasedId, "benjamin_arellano");
    assert.equal(result.pendingSuccession.reason, "arrest-life");
  } finally {
    Math.random = originalRandom;
  }
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

test("El Chapo's 1993 arrest imprisons him with a non-life sentence and hands Sinaloa an acting leader when he's not the player", () => {
  const era = loadEra("mexico-rutas-1990-2006.json");
  const npcGame = buildGameFromEra(era, { mode: "existing", cartelId: "tijuana", characterId: "benjamin_arellano" });
  npcGame.firedScriptedEvents = ["posadas-ocampo-1993"]; // same year, order doesn't matter but keep it resolved

  const result = rollScriptedEvents(npcGame, () => {}, 1993);
  assert.equal(result.arrests.length, 1);
  assert.equal(result.arrests[0].characterId, "chapo_guzman");
  assert.equal(result.arrests[0].lifeSentence, false, "must not be a life sentence, or fuga-chapo-2001 could never free him later");
  assert.equal(result.arrests[0].wasLeader, true);
  assert.equal(npcGame.characters.chapo_guzman.imprisoned.lifeSentence, false);
  assert.equal(npcGame.firedScriptedEvents.includes("arresto-chapo-1993"), true);
});

test("El Chapo's 1993 arrest gives the player a 55% chance to evade capture when controlling him directly", () => {
  const era = loadEra("mexico-rutas-1990-2006.json");
  const originalRandom = Math.random;
  try {
    const evades = buildGameFromEra(era, { mode: "existing", cartelId: "sinaloa", characterId: "chapo_guzman" });
    evades.firedScriptedEvents = ["posadas-ocampo-1993"];
    Math.random = () => 0.99; // >= 0.55, so the evasion roll succeeds
    const evadedResult = rollScriptedEvents(evades, () => {}, 1993);
    assert.equal(evadedResult.arrests.length, 0, "El Chapo should evade capture when the roll favors the player");
    assert.equal(evades.characters.chapo_guzman.imprisoned, null);

    const captured = buildGameFromEra(era, { mode: "existing", cartelId: "sinaloa", characterId: "chapo_guzman" });
    captured.firedScriptedEvents = ["posadas-ocampo-1993"];
    Math.random = () => 0; // < 0.55, so the historical arrest goes through
    const capturedResult = rollScriptedEvents(captured, () => {}, 1993);
    assert.equal(capturedResult.arrests.length, 1);
    assert.equal(captured.characters.chapo_guzman.imprisoned.lifeSentence, false);
  } finally {
    Math.random = originalRandom;
  }
});

test("the arrest→escape arc completes end-to-end through real endTurn calls: 1993's arresto-chapo sets up exactly what 2001's fuga-chapo needs to free him", () => {
  const era = loadEra("mexico-rutas-1990-2006.json");
  // Player controls an unrelated cartel (Golfo) so this exercises Chapo's NPC/wasLeader path,
  // and pre-seed posadas-ocampo-1993 (interactive, targets Tijuana) as already resolved so it
  // doesn't produce a pendingChoice that's irrelevant to what this test is checking.
  const game = buildGameFromEra(era, { mode: "existing", cartelId: "golfo", characterId: "osiel_cardenas" });
  game.firedScriptedEvents = ["posadas-ocampo-1993"];
  const originalRandom = Math.random;
  try {
    // Neither imprisonScriptedCharacter's arrest nor fuga-chapo-2001's escape ever consult
    // chance() at all when the target isn't the player (see both functions) — the arrest and
    // escape are unconditional for an NPC. So instead of forcing every chance() roll to succeed
    // (which would also mass-kill/arrest the rest of the cast via mortality/police-ops that
    // same turn), pin Math.random near 1 so everything ELSE this turn fails/skips, keeping
    // mayo_zambada and the rest of the cast untouched while still letting the two scripted
    // beats under test fire deterministically.
    game.turn = 6; // year 1993 for this era
    Math.random = () => 0.999;
    endTurn(game);
    assert.equal(game.characters.chapo_guzman.imprisoned.lifeSentence, false);
    assert.equal(game.cartels.sinaloa.roles.leader, "mayo_zambada", "Sinaloa's underboss should act as leader while Chapo is locked up");
    assert.equal(game.cartels.sinaloa.imprisonedLeaderId, "chapo_guzman");

    game.turn = 22; // year 2001 for this era
    endTurn(game);
    assert.equal(game.characters.chapo_guzman.imprisoned, null, "the 2001 escape should free him");
    assert.equal(game.cartels.sinaloa.roles.leader, "chapo_guzman", "leadership should be restored to him on escape");
    assert.equal(game.cartels.sinaloa.imprisonedLeaderId, null);
  } finally {
    Math.random = originalRandom;
  }
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

test("Ovidio Guzmán's 2023 capture pauses for a player choice when the player controls Sinaloa, and imprisons him for life by default when NPC-controlled", () => {
  const era = loadEra("cjng-sinaloa-2015-actualidad.json");

  const playerGame = buildGameFromEra(era, { mode: "existing", cartelId: "sinaloa", characterId: "ivan_archivaldo" });
  const playerResult = rollScriptedEvents(playerGame, () => {}, 2023);
  assert.ok(playerResult.pendingChoice, "expected a pending choice when the player controls Sinaloa");
  assert.equal(playerResult.pendingChoice.eventId, "arresto-ovidio-2023");
  assert.equal(playerGame.firedScriptedEvents.includes("arresto-ovidio-2023"), false, "should stay unfired until resolved");

  resolveScriptedChoice(playerGame, "arresto-ovidio-2023", "negotiate");
  assert.equal(playerGame.firedScriptedEvents.includes("arresto-ovidio-2023"), true);

  const npcGame = buildGameFromEra(era, { mode: "existing", cartelId: "cjng", characterId: "el_mencho" });
  npcGame.firedScriptedEvents = ["viernes-negro-2015"]; // same era, targets CJNG (the player here), already resolved by 2023
  const npcHeatBefore = npcGame.cartels.sinaloa.resources.heat;
  const npcResult = rollScriptedEvents(npcGame, () => {}, 2023);
  assert.equal(npcResult.pendingChoice, null, "should auto-resolve when the player isn't Sinaloa");
  assert.ok(npcGame.cartels.sinaloa.resources.heat > npcHeatBefore, "the historical default (Culiacanazo 2.0) always raises heat a lot");
  assert.equal(npcGame.characters.chapito_3.imprisoned.lifeSentence, true, "unlike 2019, the real 2023 outcome is that Ovidio stays captured");
  assert.equal(npcGame.firedScriptedEvents.includes("arresto-ovidio-2023"), true);
});

test("Ovidio Guzmán event's 'negotiate' and 'abandon' choices both leave him captured, with 'abandon' costing public image instead of heat", () => {
  const era = loadEra("cjng-sinaloa-2015-actualidad.json");

  const negotiateGame = buildGameFromEra(era, { mode: "existing", cartelId: "sinaloa", characterId: "ivan_archivaldo" });
  const negotiateHeatBefore = negotiateGame.cartels.sinaloa.resources.heat;
  rollScriptedEvents(negotiateGame, () => {}, 2023);
  resolveScriptedChoice(negotiateGame, "arresto-ovidio-2023", "negotiate");
  assert.equal(negotiateGame.characters.chapito_3.imprisoned.lifeSentence, true);
  const negotiateHeatDelta = negotiateGame.cartels.sinaloa.resources.heat - negotiateHeatBefore;

  const abandonGame = buildGameFromEra(era, { mode: "existing", cartelId: "sinaloa", characterId: "ivan_archivaldo" });
  const abandonHeatBefore = abandonGame.cartels.sinaloa.resources.heat;
  const abandonImageBefore = abandonGame.cartels.sinaloa.resources.publicImage;
  rollScriptedEvents(abandonGame, () => {}, 2023);
  resolveScriptedChoice(abandonGame, "arresto-ovidio-2023", "abandon");
  assert.equal(abandonGame.characters.chapito_3.imprisoned.lifeSentence, true);
  const abandonHeatDelta = abandonGame.cartels.sinaloa.resources.heat - abandonHeatBefore;

  assert.ok(abandonHeatDelta < negotiateHeatDelta, "abandoning him should cost far less heat than negotiating");
  assert.ok(abandonGame.cartels.sinaloa.resources.publicImage < abandonImageBefore, "abandoning family should hurt public image");
});

test("Ovidio Guzmán event's 'siege' choice can either free him (low roll, mirroring 2019) or leave him captured with worse fallout (high roll, the real 2023 outcome)", () => {
  const era = loadEra("cjng-sinaloa-2015-actualidad.json");
  const originalRandom = Math.random;
  try {
    Math.random = () => 0.1; // under the 0.3 success threshold
    const luckyGame = buildGameFromEra(era, { mode: "existing", cartelId: "sinaloa", characterId: "ivan_archivaldo" });
    const luckyImageBefore = luckyGame.cartels.sinaloa.resources.publicImage;
    rollScriptedEvents(luckyGame, () => {}, 2023);
    resolveScriptedChoice(luckyGame, "arresto-ovidio-2023", "siege");
    assert.equal(luckyGame.characters.chapito_3.imprisoned, null, "a successful siege should free him, unlike the real 2023 outcome");
    assert.ok(luckyGame.cartels.sinaloa.resources.publicImage > luckyImageBefore, "successfully forcing a release should improve public image");

    Math.random = () => 0.9; // over the 0.3 success threshold
    const unluckyGame = buildGameFromEra(era, { mode: "existing", cartelId: "sinaloa", characterId: "ivan_archivaldo" });
    const unluckyImageBefore = unluckyGame.cartels.sinaloa.resources.publicImage;
    rollScriptedEvents(unluckyGame, () => {}, 2023);
    resolveScriptedChoice(unluckyGame, "arresto-ovidio-2023", "siege");
    assert.equal(unluckyGame.characters.chapito_3.imprisoned.lifeSentence, true, "a failed siege should still leave him captured");
    assert.ok(unluckyGame.cartels.sinaloa.resources.publicImage < unluckyImageBefore, "a failed siege should hurt public image instead");
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

test("Z-40's 2013 capture imprisons him for life when he's not the player", () => {
  const era = loadEra("fragmentacion-2006-2015.json");
  const npcGame = buildGameFromEra(era, { mode: "existing", cartelId: "sinaloa", characterId: "chapo_guzman_06" });
  npcGame.firedScriptedEvents = ["arresto-mochomo-2008", "muerte-arturo-beltran-2009", "muerte-nazario-2010", "muerte-lazcano-2012"];

  const result = rollScriptedEvents(npcGame, () => {}, 2013);
  assert.equal(result.arrests.length, 1);
  assert.equal(result.arrests[0].characterId, "z40_trevino");
  assert.equal(result.arrests[0].lifeSentence, true);
  assert.equal(npcGame.characters.z40_trevino.imprisoned.lifeSentence, true);
  assert.equal(npcGame.firedScriptedEvents.includes("arresto-z40-2013"), true);
});

test("Z-42's 2015 capture imprisons him for life when he's not the player, completing the Zetas leadership collapse", () => {
  const era = loadEra("fragmentacion-2006-2015.json");
  const npcGame = buildGameFromEra(era, { mode: "existing", cartelId: "sinaloa", characterId: "chapo_guzman_06" });
  npcGame.firedScriptedEvents = ["arresto-mochomo-2008", "muerte-arturo-beltran-2009", "muerte-nazario-2010", "muerte-lazcano-2012", "arresto-z40-2013"];

  const result = rollScriptedEvents(npcGame, () => {}, 2015);
  assert.equal(result.arrests.length, 1);
  assert.equal(result.arrests[0].characterId, "z42_trevino");
  assert.equal(result.arrests[0].lifeSentence, true);
  assert.equal(npcGame.characters.z42_trevino.imprisoned.lifeSentence, true);
  assert.equal(npcGame.firedScriptedEvents.includes("arresto-z42-2015"), true);
});

test("Z-40 and Z-42's captures give the player a 55% chance to evade when controlling either directly", () => {
  const era = loadEra("fragmentacion-2006-2015.json");
  const originalRandom = Math.random;
  try {
    const z40Evades = buildGameFromEra(era, { mode: "existing", cartelId: "zetas", characterId: "z40_trevino" });
    z40Evades.firedScriptedEvents = ["arresto-mochomo-2008", "muerte-arturo-beltran-2009", "muerte-nazario-2010", "muerte-lazcano-2012"];
    Math.random = () => 0.99; // >= 0.55, so the evasion roll succeeds
    const z40EvadedResult = rollScriptedEvents(z40Evades, () => {}, 2013);
    assert.equal(z40EvadedResult.arrests.length, 0, "Z-40 should evade capture when the roll favors the player");
    assert.equal(z40Evades.characters.z40_trevino.imprisoned, null);

    const z40Captured = buildGameFromEra(era, { mode: "existing", cartelId: "zetas", characterId: "z40_trevino" });
    z40Captured.firedScriptedEvents = ["arresto-mochomo-2008", "muerte-arturo-beltran-2009", "muerte-nazario-2010", "muerte-lazcano-2012"];
    Math.random = () => 0; // < 0.55, so the historical arrest goes through
    const z40CapturedResult = rollScriptedEvents(z40Captured, () => {}, 2013);
    assert.equal(z40CapturedResult.arrests.length, 1);
    assert.equal(z40Captured.characters.z40_trevino.imprisoned.lifeSentence, true);

    const z42Evades = buildGameFromEra(era, { mode: "existing", cartelId: "zetas", characterId: "z42_trevino" });
    z42Evades.firedScriptedEvents = ["arresto-mochomo-2008", "muerte-arturo-beltran-2009", "muerte-nazario-2010", "muerte-lazcano-2012", "arresto-z40-2013"];
    Math.random = () => 0.99;
    const z42EvadedResult = rollScriptedEvents(z42Evades, () => {}, 2015);
    assert.equal(z42EvadedResult.arrests.length, 0, "Z-42 should evade capture when the roll favors the player");
    assert.equal(z42Evades.characters.z42_trevino.imprisoned, null);
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

test("Félix Gallardo's 1989 arrest imprisons him for life and hands Guadalajara a new leader when he's not the player", () => {
  const era = loadEra("guadalajara-1975-1989.json");
  const npcGame = buildGameFromEra(era, { mode: "existing", cartelId: "golfo", characterId: "garcia_abrego" });
  npcGame.firedScriptedEvents = ["camarena-1985"]; // already resolved by the time we jump to 1989

  const result = rollScriptedEvents(npcGame, () => {}, 1989);
  assert.equal(result.deaths.length, 0);
  assert.equal(result.arrests.length, 1);
  assert.equal(result.arrests[0].characterId, "felix_gallardo");
  assert.equal(result.arrests[0].lifeSentence, true);
  assert.equal(result.arrests[0].wasLeader, true);
  assert.equal(npcGame.characters.felix_gallardo.imprisoned.lifeSentence, true);
  assert.equal(npcGame.firedScriptedEvents.includes("arresto-felix-gallardo-1989"), true);
});

test("Félix Gallardo's 1989 arrest gives the player a 55% chance to evade capture when controlling him directly", () => {
  const era = loadEra("guadalajara-1975-1989.json");
  const originalRandom = Math.random;
  try {
    const evades = buildGameFromEra(era, { mode: "existing", cartelId: "guadalajara", characterId: "felix_gallardo" });
    evades.firedScriptedEvents = ["camarena-1985"];
    Math.random = () => 0.99; // >= 0.55, so the evasion roll succeeds
    const evadedResult = rollScriptedEvents(evades, () => {}, 1989);
    assert.equal(evadedResult.arrests.length, 0, "Félix Gallardo should evade capture when the roll favors the player");
    assert.equal(evades.characters.felix_gallardo.imprisoned, null);

    const captured = buildGameFromEra(era, { mode: "existing", cartelId: "guadalajara", characterId: "felix_gallardo" });
    captured.firedScriptedEvents = ["camarena-1985"];
    Math.random = () => 0; // < 0.55, so the historical arrest goes through
    const capturedResult = rollScriptedEvents(captured, () => {}, 1989);
    assert.equal(capturedResult.arrests.length, 1);
    assert.equal(captured.characters.felix_gallardo.imprisoned.lifeSentence, true);
  } finally {
    Math.random = originalRandom;
  }
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

test("policeOperationChance rises with international reputation on top of heat, modestly and capped", () => {
  const base = { resources: { heat: 50, corruptPolice: 0, corruptGov: 0, internationalReputation: 5 } };
  const famous = { resources: { heat: 50, corruptPolice: 0, corruptGov: 0, internationalReputation: 100 } };
  const baseChance = policeOperationChance(base);
  const famousChance = policeOperationChance(famous);
  assert.ok(famousChance > baseChance, "a world-famous cartel should face a higher raid risk than an obscure one at the same heat");
  assert.ok(famousChance - baseChance < 0.15, "the international-fame bump should stay modest relative to heat's own effect");
  assert.ok(famousChance <= 0.5, "the overall chance should still respect the existing cap");
});

test("policeOperationChance defaults internationalReputation to the same 15 baseline used elsewhere when it's missing from resources", () => {
  const withDefault = { resources: { heat: 50, corruptPolice: 0, corruptGov: 0 } };
  const explicit15 = { resources: { heat: 50, corruptPolice: 0, corruptGov: 0, internationalReputation: 15 } };
  assert.equal(policeOperationChance(withDefault), policeOperationChance(explicit15));
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

function makeMortalityGame({ includeNpc = false } = {}) {
  return {
    playerCharacterId: "player1",
    cartels: {
      mine: {
        id: "mine",
        destroyed: false,
        characters: includeNpc ? ["player1", "npc1"] : ["player1"],
        roles: { leader: "player1" },
      },
    },
    characters: {
      // birthYear picked so age (year - birthYear) is 80: old enough that the death cause is
      // "causas naturales" and skips the pick() call, keeping the random-call sequence short.
      player1: { id: "player1", cartelId: "mine", alive: true, imprisoned: null, birthYear: 1940, role: "leader", name: "El Jefe" },
      ...(includeNpc
        ? { npc1: { id: "npc1", cartelId: "mine", alive: true, imprisoned: null, birthYear: 1940, role: null, name: "El Otro" } }
        : {}),
    },
  };
}

test("rollMortality gives the player's own character a heavy chance to survive a roll that would otherwise kill them", () => {
  const originalRandom = Math.random;
  try {
    const survivesGame = makeMortalityGame();
    const sequence = [0, 0]; // 1: chance(deathChance) -> true. 2: chance(0.55) survival roll -> true (survives)
    let i = 0;
    Math.random = () => sequence[Math.min(i++, sequence.length - 1)];
    const survivedResults = rollMortality(survivesGame, () => {}, 2020);
    assert.equal(survivedResults.length, 0, "a successful survival roll should mean no death is recorded");
    assert.equal(survivesGame.characters.player1.alive, true);

    const diesGame = makeMortalityGame();
    const sequence2 = [0, 0.99]; // 1: chance(deathChance) -> true. 2: chance(0.55) -> false (doesn't survive)
    let j = 0;
    Math.random = () => sequence2[Math.min(j++, sequence2.length - 1)];
    const diedResults = rollMortality(diesGame, () => {}, 2020);
    assert.equal(diedResults.length, 1, "a failed survival roll should let the death go through as usual");
    assert.equal(diedResults[0].characterId, "player1");
    assert.equal(diesGame.characters.player1.alive, false);
    assert.equal(diesGame.characters.player1.deathCause, "causas naturales", "deathCause should be set to the same cause string used in the log message (age 80 always resolves to this one deterministically)");
  } finally {
    Math.random = originalRandom;
  }
});

test("rollMortality never rolls a survival check for NPCs, only the player's own character", () => {
  const game = makeMortalityGame({ includeNpc: true });
  const originalRandom = Math.random;
  try {
    Math.random = () => 0; // guarantees any chance() call succeeds; an NPC death needs only one call
    const results = rollMortality(game, () => {}, 2020);
    assert.ok(results.some((d) => d.characterId === "npc1"), "the NPC should die outright, with no extra survival roll consumed");
    assert.equal(game.characters.npc1.alive, false);
  } finally {
    Math.random = originalRandom;
  }
});

test("a coup that would kill the player's own leadership instead gives them a heavy chance to survive it", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  const playerId = game.playerCharacterId;
  const plotterId = game.cartels.sinaloa.roles.underboss;
  const coup = { cartelId: "sinaloa", plotterId, leaderId: playerId, allyId: null };
  const originalRandom = Math.random;

  try {
    const sequence = [0, 0]; // 1: chance(0.4) coup-escalation roll -> true. 2: chance(0.55) survival roll -> true (survives)
    let i = 0;
    Math.random = () => sequence[Math.min(i++, sequence.length - 1)];
    const survivedDeaths = resolveCoups(game, [coup], 2020);
    assert.equal(survivedDeaths.length, 0, "surviving the escalation should record no death");
    assert.equal(game.characters[playerId].alive, true);

    const sequence2 = [0, 0.99]; // 1: chance(0.4) -> true. 2: chance(0.55) survival roll -> false (doesn't survive)
    let j = 0;
    Math.random = () => sequence2[Math.min(j++, sequence2.length - 1)];
    const diedDeaths = resolveCoups(game, [coup], 2020);
    assert.equal(diedDeaths.length, 1, "a failed survival roll should let the coup kill them as usual");
    assert.equal(diedDeaths[0].characterId, playerId);
    assert.equal(game.characters[playerId].alive, false);
    assert.equal(game.characters[playerId].deathCause, `un golpe interno liderado por ${game.characters[plotterId].name}`);
  } finally {
    Math.random = originalRandom;
  }
});

test("resolveCoups never rolls a survival check for an NPC leader, only for the player's own character", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  const npcCartel = game.cartels.cjng;
  const npcLeaderId = npcCartel.roles.leader;
  const coup = { cartelId: "cjng", plotterId: npcCartel.roles.underboss, leaderId: npcLeaderId, allyId: null };
  const originalRandom = Math.random;
  try {
    Math.random = () => 0; // guarantees any chance() call succeeds; an NPC's coup death needs only one call
    const deaths = resolveCoups(game, [coup], 2020);
    assert.equal(deaths.length, 1, "the NPC leader should die outright, with no extra survival roll consumed");
    assert.equal(deaths[0].characterId, npcLeaderId);
    assert.equal(game.characters[npcLeaderId].alive, false);
  } finally {
    Math.random = originalRandom;
  }
});

test("checkLandlessCollapse dissolves a cartel after 4 turns straight with zero territories, but not before", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa"); // player is sinaloa; use golfo as the AI test subject
  const golfo = game.cartels.golfo;
  golfo.territories = [];

  for (let i = 0; i < 3; i++) {
    checkLandlessCollapse(game);
    assert.equal(golfo.destroyed, false, `should not collapse before the grace period elapses (turn ${i + 1})`);
    assert.equal(golfo.turnsWithoutTerritory, i + 1);
  }
  checkLandlessCollapse(game); // 4th consecutive landless turn
  assert.equal(golfo.destroyed, true, "should collapse once the grace period is exhausted");
});

test("checkLandlessCollapse resets the counter the moment a cartel regains a territory", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  const golfo = game.cartels.golfo;
  const territoryId = golfo.territories[0];
  golfo.territories = [];

  checkLandlessCollapse(game);
  checkLandlessCollapse(game);
  assert.equal(golfo.turnsWithoutTerritory, 2);

  golfo.territories = [territoryId]; // recovers a territory
  checkLandlessCollapse(game);
  assert.equal(golfo.turnsWithoutTerritory, 0, "regaining territory should reset the grace-period counter");
  assert.equal(golfo.destroyed, false);
});

test("checkLandlessCollapse ends the game with reason 'no-territory' when it's the player's own cartel that dissolves", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  const cartel = game.cartels.sinaloa;
  cartel.territories = [];

  for (let i = 0; i < 4; i++) checkLandlessCollapse(game);

  assert.equal(cartel.destroyed, true);
  assert.equal(game.gameOver, true);
  assert.equal(game.gameOverReason, "no-territory");
});

test("checkLandlessCollapse never sets gameOver when it's an AI cartel (not the player's) that dissolves", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  const golfo = game.cartels.golfo;
  golfo.territories = [];

  for (let i = 0; i < 4; i++) checkLandlessCollapse(game);

  assert.equal(golfo.destroyed, true);
  assert.equal(game.gameOver, false, "the player's own game shouldn't end because a rival AI cartel collapsed");
});
