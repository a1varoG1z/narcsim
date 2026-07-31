import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGameFromEra, addLog } from "../js/state.js";
import {
  applyAction,
  isAttackable,
  pickHeir,
  getSuccessionCandidates,
  resolveSuccession,
  attemptEscape,
  getWarsForCartel,
  endTurn,
  getDesignatableHeirs,
  designateHeir,
  clearDesignatedHeir,
  mentorHeir,
  arrangeMarriage,
  beginPregnancy,
  resolveConceptionAttempt,
  processPregnancies,
  rollNewCartelSpawns,
  collectSignificantPlayerEvents,
  autoResolveWars,
  ACTION_COSTS,
} from "../js/turnEngine.js";

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

/** Builds two cartels with normalized commander/leader stats (so commanderMultiplier is
 * identical on both sides) and controllable army sizes, so any difference in a fight's outcome
 * is attributable only to whatever the test is isolating (a bonus, a territory's fortification,
 * an army-size edge, etc) rather than incidental roster differences between real era cartels. */
function setupEqualFight(file, attackerId, defenderId, territoryId, territoryValue, armySizes = {}) {
  const game = newGame(file, attackerId);
  const attacker = game.cartels[attackerId];
  const defender = game.cartels[defenderId];
  attacker.resources.armySize = armySizes.attacker ?? 1000;
  defender.resources.armySize = armySizes.defender ?? 1000;
  attacker.resources.weaponsBonus = 0;
  defender.resources.weaponsBonus = 0;
  if (territoryValue !== undefined) game.territories[territoryId].value = territoryValue;
  for (const c of [attacker, defender]) {
    for (const roleKey of ["leader", "militaryChief", "sicariosChief"]) {
      const holder = game.characters[c.roles[roleKey]];
      if (!holder) continue;
      holder.alive = true;
      holder.imprisoned = null;
      if (roleKey === "leader") holder.stats.loyaltyInspiring = 70;
      else { holder.stats.violence = 70; holder.stats.intrigue = 70; }
    }
  }
  return { game, attacker, defender };
}

test("isAttackable rejects non-adjacent and self-owned territories, accepts adjacent enemy ones", () => {
  const game = newGame("mexico-rutas-1990-2006.json", "sinaloa");
  // Sinaloa owns sonora/chihuahua/sinaloa/durango; tamaulipas (Golfo) is far away, chihuahua is adjacent-owned already.
  assert.equal(isAttackable(game, "sinaloa", "tamaulipas"), false, "far away territory should not be attackable");
  assert.equal(isAttackable(game, "sinaloa", "sinaloa"), false, "cannot attack a territory you already own");
  assert.equal(isAttackable(game, "sinaloa", "chihuahua"), true, "Juárez's Chihuahua borders Sinaloa's territories");
});

test("attack_territory is rejected outright when the target isn't adjacent", () => {
  const game = newGame("mexico-rutas-1990-2006.json", "sinaloa");
  const result = applyAction(game, "sinaloa", "attack_territory", { territoryId: "tamaulipas" });
  assert.equal(result.ok, false);
  assert.match(result.message, /no linda/i);
  // The territory should not have changed hands.
  assert.equal(game.territories.tamaulipas.controllerId, "golfo");
});

test("attack_territory on an adjacent enemy territory resolves and opens/updates a war record", () => {
  const game = newGame("mexico-rutas-1990-2006.json", "sinaloa");
  const before = getWarsForCartel(game, "sinaloa").length;
  const result = applyAction(game, "sinaloa", "attack_territory", { territoryId: "chihuahua" });
  assert.equal(result.ok, true);
  assert.equal(typeof result.attackerWins, "boolean");
  const wars = getWarsForCartel(game, "sinaloa");
  assert.ok(wars.length >= before, "a war record should exist between Sinaloa and Juárez after fighting");
  const war = wars.find((w) => w.cartelA === "juarez" || w.cartelB === "juarez");
  assert.ok(war, "expected an open war record against Juárez");
  assert.equal(war.endYear, null);
  assert.ok(war.casualtiesA + war.casualtiesB > 0, "a battle should produce some casualties");
});

test("declaring war with a surprise pretext grants a one-time attack bonus against that target this turn", () => {
  const originalRandom = Math.random;
  try {
    // Math.random = 0 pins the attacker's roll at its floor (0.85x) and the defender's at its
    // floor (1.0x), so an evenly-matched fight with no bonus is a guaranteed defender win —
    // giving the surprise bonus (1.25x) room to provably flip the exact same fight. Territory
    // value is pinned low (4) so its own fortification bonus doesn't swallow the surprise bonus.
    Math.random = () => 0;

    const plain = setupEqualFight("cjng-sinaloa-2015-actualidad.json", "sinaloa", "cdn", "coahuila", 4);
    const plainResult = applyAction(plain.game, "sinaloa", "attack_territory", { territoryId: "coahuila" });
    assert.equal(plainResult.attackerWins, false, "an evenly-matched fight with no bonus should go to the defender given the stubbed rolls");

    const surprised = setupEqualFight("cjng-sinaloa-2015-actualidad.json", "sinaloa", "cdn", "coahuila", 4);
    applyAction(surprised.game, "sinaloa", "declare_war", { targetCartelId: "cdn", pretext: "surprise" });
    assert.deepEqual(surprised.attacker.surpriseStrikeBonus, { targetId: "cdn", turn: surprised.game.turn });
    const surpriseResult = applyAction(surprised.game, "sinaloa", "attack_territory", { territoryId: "coahuila" });
    assert.equal(surpriseResult.attackerWins, true, "the exact same evenly-matched fight should flip to an attacker win once the surprise bonus applies");
    assert.equal(surprised.attacker.surpriseStrikeBonus, null, "the one-time bonus should be consumed after use");
  } finally {
    Math.random = originalRandom;
  }
});

test("set_war_focus refuses a target you're not at war with, and clears with a null target", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  const cartel = game.cartels.sinaloa;

  const notAtWarResult = applyAction(game, "sinaloa", "set_war_focus", { targetCartelId: "golfo" });
  assert.equal(notAtWarResult.ok, false);
  assert.equal(cartel.warFocus, undefined);

  applyAction(game, "sinaloa", "declare_war", { targetCartelId: "golfo" });
  const result = applyAction(game, "sinaloa", "set_war_focus", { targetCartelId: "golfo" });
  assert.equal(result.ok, true);
  assert.deepEqual(cartel.warFocus, { targetCartelId: "golfo", turnsRemaining: 4 });

  const clearResult = applyAction(game, "sinaloa", "set_war_focus", { targetCartelId: null });
  assert.equal(clearResult.ok, true);
  assert.equal(cartel.warFocus, null);
});

test("set_war_focus gives a genuine combat edge against the chosen front, flipping an otherwise-lost evenly-matched fight", () => {
  const originalRandom = Math.random;
  try {
    // Same evenly-matched baseline as the surprise-pretext test above: Math.random = 0 pins the
    // attacker's roll at its floor and the defender's at its floor, so with no bonus the defender
    // wins. Concentrating forces on this exact front should be enough to flip it, same as the
    // one-time surprise-strike bonus does.
    Math.random = () => 0;

    const plain = setupEqualFight("cjng-sinaloa-2015-actualidad.json", "sinaloa", "cdn", "coahuila", 4);
    const plainResult = applyAction(plain.game, "sinaloa", "attack_territory", { territoryId: "coahuila" });
    assert.equal(plainResult.attackerWins, false, "an evenly-matched fight with no focus should go to the defender given the stubbed rolls");

    const focused = setupEqualFight("cjng-sinaloa-2015-actualidad.json", "sinaloa", "cdn", "coahuila", 4);
    applyAction(focused.game, "sinaloa", "declare_war", { targetCartelId: "cdn" });
    applyAction(focused.game, "sinaloa", "set_war_focus", { targetCartelId: "cdn" });
    const focusedResult = applyAction(focused.game, "sinaloa", "attack_territory", { territoryId: "coahuila" });
    assert.equal(focusedResult.attackerWins, true, "concentrating forces on this exact front should flip the same evenly-matched fight");
  } finally {
    Math.random = originalRandom;
  }
});

test("set_war_focus on a different front weakens you here: an otherwise-winning army-size edge gets undone", () => {
  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    const armySizes = { attacker: 1300, defender: 1000 };

    const plain = setupEqualFight("cjng-sinaloa-2015-actualidad.json", "sinaloa", "cdn", "coahuila", 4, armySizes);
    const plainResult = applyAction(plain.game, "sinaloa", "attack_territory", { territoryId: "coahuila" });
    assert.equal(plainResult.attackerWins, true, "a real army-size edge with no focus penalty should win this fight");

    const distracted = setupEqualFight("cjng-sinaloa-2015-actualidad.json", "sinaloa", "cdn", "coahuila", 4, armySizes);
    applyAction(distracted.game, "sinaloa", "declare_war", { targetCartelId: "golfo" });
    applyAction(distracted.game, "sinaloa", "set_war_focus", { targetCartelId: "golfo" });
    const distractedResult = applyAction(distracted.game, "sinaloa", "attack_territory", { territoryId: "coahuila" });
    assert.equal(distractedResult.attackerWins, false, "concentrating forces on an unrelated front (golfo) should weaken this fight enough to undo the same army-size edge");
  } finally {
    Math.random = originalRandom;
  }
});

test("a well-developed (high-value) territory is genuinely harder to conquer than a rundown one, same armies both times", () => {
  const originalRandom = Math.random;
  try {
    // Math.random = 0 pins the attacker's roll at 0.85x and the defender's at 1.0x times its
    // fortification bonus (1 + value/150). Giving the attacker a real army-size edge (1300 vs
    // 1000) is just enough to overcome a low-value territory's negligible fortification, but not
    // enough once that same territory is highly developed — isolating the value/fortification
    // effect rather than restating the pure army-size comparison another test already covers.
    Math.random = () => 0;
    const armySizes = { attacker: 1300, defender: 1000 };

    const rundown = setupEqualFight("cjng-sinaloa-2015-actualidad.json", "sinaloa", "cdn", "coahuila", 5, armySizes);
    const rundownResult = applyAction(rundown.game, "sinaloa", "attack_territory", { territoryId: "coahuila" });
    assert.equal(rundownResult.attackerWins, true, "a real army-size edge should be enough to take a low-value, poorly-fortified territory");

    const developed = setupEqualFight("cjng-sinaloa-2015-actualidad.json", "sinaloa", "cdn", "coahuila", 40, armySizes);
    const developedResult = applyAction(developed.game, "sinaloa", "attack_territory", { territoryId: "coahuila" });
    assert.equal(developedResult.attackerWins, false, "the exact same army-size edge should no longer be enough once the territory is highly developed/fortified");
  } finally {
    Math.random = originalRandom;
  }
});

test("occupy_territory rejects territories that already have an owner", () => {
  const game = newGame("mexico-rutas-1990-2006.json", "sinaloa");
  const result = applyAction(game, "sinaloa", "occupy_territory", { territoryId: "chihuahua" });
  assert.equal(result.ok, false);
});

test("occupy_territory's success chance scales with army strength relative to the target's value, and failure costs some troops", () => {
  const originalRandom = Math.random;
  try {
    Math.random = () => 0.5; // between the weak army's ~0.375 chance and the strong army's ~0.86 chance

    const weakGame = newGame("mexico-rutas-1990-2006.json", "sinaloa");
    const weakCartel = weakGame.cartels.sinaloa;
    weakCartel.resources.money = 100_000_000;
    weakCartel.resources.armySize = 100;
    const weakResult = applyAction(weakGame, "sinaloa", "occupy_territory", { territoryId: "coahuila" });
    assert.equal(weakResult.ok, true);
    assert.equal(weakResult.success, false, "a weak army relative to the target's value should fail at this roll");
    assert.ok(weakResult.casualties > 0, "a failed occupation should cost some troops to local resistance");
    assert.equal(weakCartel.resources.armySize, 100 - weakResult.casualties);

    const strongGame = newGame("mexico-rutas-1990-2006.json", "sinaloa");
    const strongCartel = strongGame.cartels.sinaloa;
    strongCartel.resources.money = 100_000_000;
    strongCartel.resources.armySize = 5000;
    const strongResult = applyAction(strongGame, "sinaloa", "occupy_territory", { territoryId: "coahuila" });
    assert.equal(strongResult.success, true, "the exact same roll should succeed once the army is strong relative to the target's value");
  } finally {
    Math.random = originalRandom;
  }
});

test("attemptEscape allows breaking a life sentence, but far less reliably than a regular one, and succeeds/fails deterministically otherwise", () => {
  const game = newGame("mexico-rutas-1990-2006.json", "sinaloa", "chapo_guzman");
  const chapo = game.characters.chapo_guzman;
  chapo.stats.stealth = 95;
  chapo.stats.intrigue = 95;
  game.cartels.sinaloa.resources.corruptPolice = 90;

  const originalRandom = Math.random;
  try {
    // Max stats give a regular sentence a real (clamped at 0.75) shot, but a life sentence should
    // stay capped far lower (0.15) for the exact same character/cartel strength — proven with a
    // single fixed roll that succeeds against the regular cap but fails against the life-sentence one.
    Math.random = () => 0.5;

    chapo.imprisoned = { sinceTurn: 0, releaseTurn: 10, lifeSentence: false };
    const regularResult = attemptEscape(game);
    assert.equal(regularResult.ok, true);
    assert.equal(regularResult.success, true, "a well-connected, stealthy character should escape a regular sentence at this roll");
    assert.equal(chapo.imprisoned, null);

    chapo.imprisoned = { sinceTurn: 0, releaseTurn: 10, lifeSentence: true };
    const lifeResult = attemptEscape(game);
    assert.equal(lifeResult.ok, true, "a life sentence should now be attemptable rather than flatly refused");
    assert.equal(lifeResult.success, false, "the exact same roll that broke a regular sentence should fail against a life sentence's much lower cap");
    assert.ok(chapo.imprisoned, "a failed life-sentence attempt should leave the character imprisoned");
  } finally {
    Math.random = originalRandom;
  }
});

test("pickHeir prefers the eldest eligible child over spouse or underboss", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa", "ivan_archivaldo");
  // chapo_guzman_15's childrenIds include ivan_archivaldo (eldest, b.1983) and younger siblings.
  const heirId = pickHeir(game, "sinaloa", "chapo_guzman_15");
  assert.equal(heirId, "ivan_archivaldo");
});

test("getSuccessionCandidates returns a non-empty list for a cartel leader with a roster", () => {
  const game = newGame("guadalajara-1975-1989.json", "guadalajara", "felix_gallardo");
  const candidates = getSuccessionCandidates(game, "guadalajara", "felix_gallardo");
  assert.ok(candidates.length > 0);
});

test("resolveSuccession transfers control, updates roles and vacates the old leader's slot", () => {
  const game = newGame("guadalajara-1975-1989.json", "guadalajara", "felix_gallardo");
  const candidates = getSuccessionCandidates(game, "guadalajara", "felix_gallardo");
  const heir = candidates[0];
  resolveSuccession(game, heir.id);
  assert.equal(game.playerCharacterId, heir.id);
  assert.equal(game.cartels.guadalajara.roles.leader, heir.id);
  assert.equal(game.playerControlMode, "direct");
});

test("getDesignatableHeirs lists the player's children, spouse and role-holders but excludes the dead/imprisoned", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa", "ivan_archivaldo");
  const candidates = getDesignatableHeirs(game);
  assert.ok(candidates.length > 0);
  assert.ok(candidates.every((c) => c.alive && !c.imprisoned));
  const player = game.characters[game.playerCharacterId];
  assert.ok(!candidates.some((c) => c.id === player.id), "the player themself should never be their own heir option");
});

test("designateHeir sets the designation and clearDesignatedHeir removes it; resolveSuccession also clears it", () => {
  const game = newGame("guadalajara-1975-1989.json", "guadalajara", "felix_gallardo");
  const candidates = getDesignatableHeirs(game);
  assert.ok(candidates.length > 0);
  const pick1 = candidates[0];

  const result = designateHeir(game, pick1.id);
  assert.equal(result.ok, true);
  assert.equal(game.designatedHeirId, pick1.id);

  clearDesignatedHeir(game);
  assert.equal(game.designatedHeirId, null);

  designateHeir(game, pick1.id);
  const successionCandidates = getSuccessionCandidates(game, "guadalajara", "felix_gallardo");
  resolveSuccession(game, successionCandidates[0].id);
  assert.equal(game.designatedHeirId, null, "any succession, designated or not, should clear a stale designation");
});

test("mentorHeir requires a living designated heir, only works once per turn, and boosts bond plus a stat", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa", "ivan_archivaldo");
  const noHeir = mentorHeir(game);
  assert.equal(noHeir.ok, false);

  const candidates = getDesignatableHeirs(game);
  const heir = candidates[0];
  designateHeir(game, heir.id);
  heir.bondWithPlayer = 50;
  const before = { ...heir.stats };

  const first = mentorHeir(game);
  assert.equal(first.ok, true);
  assert.ok(heir.bondWithPlayer > 50);
  assert.ok(heir.stats[first.stat] > (before[first.stat] || 0));

  const second = mentorHeir(game);
  assert.equal(second.ok, false, "mentoring should be limited to once per turn");
});

test("arrangeMarriage weds an eligible family member to a new NPC in another cartel and eases tension, but refuses invalid targets", () => {
  const game = newGame("guadalajara-1975-1989.json", "guadalajara", "felix_gallardo");
  const player = game.characters[game.playerCharacterId];
  const child = game.characters[(player.childrenIds || [])[0]];
  assert.ok(child, "expected the player's character to have at least one child in this era's data");

  const before = game.cartels.guadalajara.relations.golfo.tension;
  const result = arrangeMarriage(game, child.id, "golfo");
  assert.equal(result.ok, true);
  assert.equal(child.spouseId, result.spouseId);
  assert.equal(game.characters[result.spouseId].cartelId, "golfo");
  assert.ok(game.cartels.guadalajara.relations.golfo.tension <= before);
  assert.equal(game.cartels.guadalajara.relations.golfo.tension, game.cartels.golfo.relations.guadalajara.tension);

  const ownCartel = arrangeMarriage(game, child.id, "guadalajara");
  assert.equal(ownCartel.ok, false, "cannot arrange a marriage into your own cartel");

  const alreadyMarried = arrangeMarriage(game, child.id, "golfo");
  assert.equal(alreadyMarried.ok, false, "the family member is already married after the first arrangement");
});

test("resolveConceptionAttempt uses accumulated warmth/charisma for the odds, refuses same-sex pairs and repeat attempts on an existing pregnancy", () => {
  const game = newGame("guadalajara-1975-1989.json", "guadalajara", "felix_gallardo");
  const spouse = game.characters.gdl_esposa_gallardo; // felix_gallardo's wife, female
  assert.equal(spouse.sex, "F");

  const sameSexResult = resolveConceptionAttempt(game, "caro_quintero", 0); // both male
  assert.equal(sameSexResult.ok, false);

  const originalRandom = Math.random;
  Math.random = () => 0; // guarantees chance() succeeds for this single deterministic call
  let result;
  try {
    result = resolveConceptionAttempt(game, spouse.id, 10);
  } finally {
    Math.random = originalRandom;
  }
  assert.equal(result.ok, true);
  assert.equal(result.pregnant, true);
  assert.ok(spouse.pregnancy, "the mother should now be marked pregnant");
  assert.equal(spouse.pregnancy.fatherId, "felix_gallardo");
  assert.equal(spouse.pregnancy.dueTurn > game.turn, true);

  const repeatResult = resolveConceptionAttempt(game, spouse.id, 10);
  assert.equal(repeatResult.ok, false, "cannot start a second pregnancy while already pregnant");
});

test("a pregnancy only turns into a birth once its due turn arrives, correctly registering the child's parents and cartel", () => {
  const game = newGame("guadalajara-1975-1989.json", "guadalajara", "felix_gallardo");
  const spouse = game.characters.gdl_esposa_gallardo;
  beginPregnancy(game, spouse.id, "felix_gallardo");
  const childrenBefore = spouse.childrenIds.length;

  // Not due yet: processPregnancies (called directly, not through the much noisier endTurn —
  // which also runs mortality/AI/family-event rolls unrelated to what's being tested here)
  // should leave the pregnancy untouched.
  processPregnancies(game);
  assert.ok(spouse.pregnancy, "should still be pregnant before the due turn");
  assert.equal(spouse.childrenIds.length, childrenBefore);

  spouse.pregnancy.dueTurn = game.turn;
  processPregnancies(game);

  assert.equal(spouse.pregnancy, null, "pregnancy should be cleared once resolved");
  assert.equal(spouse.childrenIds.length, childrenBefore + 1);
  const newChildId = spouse.childrenIds[spouse.childrenIds.length - 1];
  const child = game.characters[newChildId];
  assert.ok(child, "the new child should exist in game.characters");
  assert.ok(child.parents.includes(spouse.id) && child.parents.includes("felix_gallardo"));
  assert.ok(game.cartels.guadalajara.characters.includes(newChildId));
});

test("rollNewCartelSpawns creates a new AI cartel on a neutral territory with full relations to every existing cartel", () => {
  const game = newGame("guadalajara-1975-1989.json", "guadalajara", "felix_gallardo");
  const neutrals = Object.values(game.territories).filter((t) => !t.controllerId);
  assert.ok(neutrals.length, "expected at least one neutral territory in this era");
  const [neutralTerritory, ...otherNeutrals] = neutrals;
  // Claim every other neutral territory so a stubbed Math.random (which also feeds uid()'s
  // suffix) can't cause two same-tick spawns to collide on the same generated cartel id.
  for (const t of otherNeutrals) t.controllerId = "guadalajara";
  const cartelCountBefore = Object.keys(game.cartels).length;

  const originalRandom = Math.random;
  Math.random = () => 0; // guarantees the spawn roll succeeds for every neutral territory
  try {
    rollNewCartelSpawns(game, game.year);
  } finally {
    Math.random = originalRandom;
  }

  assert.equal(neutralTerritory.controllerId !== null, true, "the neutral territory should now be claimed");
  const newCartelId = neutralTerritory.controllerId;
  const newCartel = game.cartels[newCartelId];
  assert.ok(newCartel, "the new cartel should exist in game.cartels");
  assert.equal(newCartel.aiControlled, true);
  assert.equal(newCartel.territories.includes(neutralTerritory.id), true);
  assert.ok(Object.keys(game.cartels).length > cartelCountBefore);

  const leader = game.characters[newCartel.roles.leader];
  assert.ok(leader && leader.alive, "the new cartel should have a living leader");

  for (const [id, cartel] of Object.entries(game.cartels)) {
    if (id === newCartelId) continue;
    if (cartel.destroyed) continue;
    assert.ok(cartel.relations[newCartelId], `${id} should have a relations entry for the new cartel`);
    assert.ok(newCartel.relations[id], `the new cartel should have a relations entry for ${id}`);
  }
});

test("endTurn advances the turn/year counter and never lets money or army go negative", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa", "ivan_archivaldo");
  const startTurn = game.turn;
  for (let i = 0; i < 10 && !game.gameOver; i++) {
    endTurn(game);
  }
  assert.ok(game.turn > startTurn);
  for (const cartel of Object.values(game.cartels)) {
    assert.ok(cartel.resources.money >= 0, `${cartel.id} money went negative`);
    assert.ok(cartel.resources.armySize >= 0, `${cartel.id} army went negative`);
    assert.ok(cartel.resources.heat >= 0 && cartel.resources.heat <= 100, `${cartel.id} heat out of range`);
  }
});

test("collectSignificantPlayerEvents only surfaces log entries that name the player's cartel or one of its people, deduplicated", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa", "ivan_archivaldo");
  const cartel = game.cartels.sinaloa;
  const playerMember = game.characters[cartel.roles.underboss];
  const startIndex = game.log.length;

  addLog(game, `El CJNG ocupa un territorio neutral lejano.`, "event");
  addLog(game, `${cartel.name} sufre una redada del CJNG en una de sus plazas.`, "event");
  addLog(game, `${playerMember.name} muere en un atentado ordenado por el CJNG.`, "death");
  addLog(game, `${cartel.name} sufre una redada del CJNG en una de sus plazas.`, "event"); // exact duplicate text

  const events = collectSignificantPlayerEvents(game, startIndex);
  assert.equal(events.length, 2, "should keep the two distinct player-relevant entries and drop the duplicate and the unrelated one");
  assert.ok(events.some((e) => e.text.includes(cartel.name)));
  assert.ok(events.some((e) => e.text.includes(playerMember.name)));
});

test("resolveBattle records a territoryLost reactive event when the player's cartel is the defender", () => {
  const originalRandom = Math.random;
  try {
    const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    game.cartels.cdn.resources.armySize = 5000;
    game.cartels.sinaloa.resources.armySize = 50;
    // endTurn normally initializes this array; set it manually here to exercise resolveBattle's
    // hook in isolation, the same way collectSignificantPlayerEvents is tested directly above.
    game._reactiveEvents = [];
    Math.random = () => 0;

    const result = applyAction(game, "cdn", "attack_territory", { territoryId: "chihuahua" });
    assert.equal(result.attackerWins, true, "an overwhelming attacker should win this fight");
    assert.equal(game._reactiveEvents.length, 1);
    assert.deepEqual(game._reactiveEvents[0], {
      type: "territoryLost",
      territoryId: "chihuahua",
      territoryName: game.territories.chihuahua.name,
      toCartelId: "cdn",
      toCartelName: game.cartels.cdn.name,
    });
  } finally {
    Math.random = originalRandom;
  }
});

test("sabotage_rival records a 'sabotaged' reactive event when the player is the target, on both success and failure", () => {
  const originalRandom = Math.random;
  try {
    const gameSuccess = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    gameSuccess.cartels.cdn.resources.money = ACTION_COSTS.sabotage_rival * 10;
    gameSuccess._reactiveEvents = [];
    Math.random = () => 0; // guarantees chance() succeeds
    const successResult = applyAction(gameSuccess, "cdn", "sabotage_rival", { targetCartelId: "sinaloa" });
    assert.equal(successResult.success, true);
    assert.equal(gameSuccess._reactiveEvents.length, 1);
    assert.deepEqual(gameSuccess._reactiveEvents[0], {
      type: "sabotaged",
      byCartelId: "cdn",
      byCartelName: gameSuccess.cartels.cdn.name,
      damage: successResult.damage,
      success: true,
    });

    const gameFail = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    gameFail.cartels.cdn.resources.money = ACTION_COSTS.sabotage_rival * 10;
    gameFail._reactiveEvents = [];
    Math.random = () => 0.99; // guarantees chance() fails
    const failResult = applyAction(gameFail, "cdn", "sabotage_rival", { targetCartelId: "sinaloa" });
    assert.equal(failResult.success, false);
    assert.equal(gameFail._reactiveEvents.length, 1);
    assert.deepEqual(gameFail._reactiveEvents[0], {
      type: "sabotaged",
      byCartelId: "cdn",
      byCartelName: gameFail.cartels.cdn.name,
      damage: 0,
      success: false,
    });
  } finally {
    Math.random = originalRandom;
  }
});

test("assassinate_rival records an 'assassinationAttempted' reactive event when the player's cartel is the target, covering success, survival, and failure", () => {
  const originalRandom = Math.random;
  try {
    // Success against a non-player-controlled member of the player's cartel: the hit connects
    // and the target dies (isPlayerTarget is false, so the 55% survival roll never applies).
    const gameKilled = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    gameKilled.cartels.cjng.resources.money = ACTION_COSTS.assassinate_rival * 10;
    gameKilled._reactiveEvents = [];
    const underbossId = gameKilled.cartels.sinaloa.roles.underboss;
    Math.random = () => 0; // guarantees chance() succeeds
    const killedResult = applyAction(gameKilled, "cjng", "assassinate_rival", { targetCharacterId: underbossId });
    assert.equal(killedResult.success, true);
    assert.equal(gameKilled._reactiveEvents.length, 1);
    assert.deepEqual(gameKilled._reactiveEvents[0], {
      type: "assassinationAttempted",
      byCartelId: "cjng",
      byCartelName: gameKilled.cartels.cjng.name,
      characterName: gameKilled.characters[underbossId].name,
      success: true,
      survived: false,
    });

    // Success against the player's own controlled character: the 55% survival roll also passes.
    const gameSurvived = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    gameSurvived.cartels.cjng.resources.money = ACTION_COSTS.assassinate_rival * 10;
    gameSurvived._reactiveEvents = [];
    const playerCharacterId = gameSurvived.playerCharacterId;
    const sequence = [0, 0.01]; // 1: hit connects. 2: chance(0.55) survival roll also succeeds.
    let i = 0;
    Math.random = () => sequence[Math.min(i++, sequence.length - 1)];
    const survivedResult = applyAction(gameSurvived, "cjng", "assassinate_rival", { targetCharacterId: playerCharacterId });
    assert.equal(survivedResult.success, true);
    assert.equal(survivedResult.survived, true);
    assert.equal(gameSurvived._reactiveEvents.length, 1);
    assert.deepEqual(gameSurvived._reactiveEvents[0], {
      type: "assassinationAttempted",
      byCartelId: "cjng",
      byCartelName: gameSurvived.cartels.cjng.name,
      characterName: gameSurvived.characters[playerCharacterId].name,
      success: true,
      survived: true,
    });

    // Failure: no 'survived' key at all, matching sabotage_rival's failure shape.
    const gameFail = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    gameFail.cartels.cjng.resources.money = ACTION_COSTS.assassinate_rival * 10;
    gameFail._reactiveEvents = [];
    const underbossId2 = gameFail.cartels.sinaloa.roles.underboss;
    Math.random = () => 0.99; // guarantees chance() fails
    const failResult = applyAction(gameFail, "cjng", "assassinate_rival", { targetCharacterId: underbossId2 });
    assert.equal(failResult.success, false);
    assert.equal(gameFail._reactiveEvents.length, 1);
    assert.deepEqual(gameFail._reactiveEvents[0], {
      type: "assassinationAttempted",
      byCartelId: "cjng",
      byCartelName: gameFail.cartels.cjng.name,
      characterName: gameFail.characters[underbossId2].name,
      success: false,
    });
  } finally {
    Math.random = originalRandom;
  }
});

test("assassinate_rival does NOT record a reactive event for an internal purge, even though the target cartel is the player's own", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  const cartel = game.cartels.sinaloa;
  cartel.resources.money = ACTION_COSTS.assassinate_rival * 10;
  game._reactiveEvents = [];
  const underbossId = cartel.roles.underboss;
  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    applyAction(game, "sinaloa", "assassinate_rival", { targetCharacterId: underbossId });
  } finally {
    Math.random = originalRandom;
  }
  assert.equal(game._reactiveEvents.length, 0, "an internal purge has no external attacker to react against");
});

test("endTurn returns reactiveEvents (empty by default) and never leaks the transient _reactiveEvents field into game state", () => {
  const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
  const result = endTurn(game);
  assert.ok(Array.isArray(result.reactiveEvents));
  assert.equal("_reactiveEvents" in game, false, "the transient scratch array should be deleted before endTurn returns, so it never gets persisted in a save");
});

test("endTurn's significantEvents, whenever present, always mention the player cartel or one of its people (never unrelated AI noise)", () => {
  // A soft, non-flaky integration check: it never requires a significant event to happen on any
  // given run (that depends on AI randomness), only that whichever ones do surface are genuinely
  // player-relevant. Run across a few different cartel/era combos and enough turns that the
  // filtering logic gets real exercise against a busy log full of unrelated AI-vs-AI activity.
  for (const [file, cartelId, characterId] of [
    ["cjng-sinaloa-2015-actualidad.json", "sinaloa", "ivan_archivaldo"],
    ["fragmentacion-2006-2015.json", "sinaloa", "chapo_guzman_06"],
  ]) {
    const game = newGame(file, cartelId, characterId);
    const cartel = game.cartels[cartelId];
    for (let i = 0; i < 20 && !game.gameOver; i++) {
      const result = endTurn(game);
      assert.ok(Array.isArray(result.significantEvents));
      for (const e of result.significantEvents) {
        const mentionsCartel = e.text.includes(cartel.name);
        const mentionsMember = cartel.characters.some((id) => game.characters[id] && e.text.includes(game.characters[id].name));
        assert.ok(mentionsCartel || mentionsMember, `event "${e.text}" should mention the player cartel or one of its people`);
      }
    }
  }
});

test("war weariness ends a long-stalemated AI-vs-AI war (no shared border) once enough years have passed, but never touches a war involving the player", () => {
  const originalRandom = Math.random;
  try {
    // cjng and santa_rosa start at war (WAR_OVERRIDES); the player is sinaloa, uninvolved.
    const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    const cjng = game.cartels.cjng;
    const santaRosa = game.cartels.santa_rosa;
    cjng.territories = []; // no shared border possible: reachable.length will always be 0
    const war = game.warHistory.find((w) => w.key === ["cjng", "santa_rosa"].sort().join("|") && w.endYear === null);
    assert.ok(war, "expected the era's built-in cjng/santa_rosa war to be tracked in warHistory");
    war.startYear -= 10; // pretend the stalemate has dragged on for a decade

    Math.random = () => 0; // guarantees both the outer 60% flare-up roll and the weariness roll succeed
    autoResolveWars(game);

    assert.equal(cjng.relations.santa_rosa.status, "neutral", "a decade-long, unreachable stalemate should be able to end in negotiated peace");
    assert.equal(santaRosa.relations.cjng.status, "neutral");
    assert.notEqual(war.endYear, null, "the war entry should be formally closed");
  } finally {
    Math.random = originalRandom;
  }
});

test("war weariness never fires for a war that's too fresh, even with a guaranteed-success roll", () => {
  const originalRandom = Math.random;
  try {
    const game = newGame("cjng-sinaloa-2015-actualidad.json", "sinaloa");
    const cjng = game.cartels.cjng;
    const santaRosa = game.cartels.santa_rosa;
    cjng.territories = [];
    // war.startYear is left at the era's default (the war just started): yearsAtWar < 2.

    Math.random = () => 0;
    autoResolveWars(game);

    assert.equal(cjng.relations.santa_rosa.status, "war", "a war that just started shouldn't be endable by weariness yet");
    assert.equal(santaRosa.relations.cjng.status, "war");
  } finally {
    Math.random = originalRandom;
  }
});

test("war weariness never auto-ends a war the player is part of, regardless of how old or unreachable it is", () => {
  const originalRandom = Math.random;
  try {
    // The player controls cjng directly this time, still at war with santa_rosa.
    const game = newGame("cjng-sinaloa-2015-actualidad.json", "cjng");
    const cjng = game.cartels.cjng;
    const santaRosa = game.cartels.santa_rosa;
    cjng.territories = [];
    const war = game.warHistory.find((w) => w.key === ["cjng", "santa_rosa"].sort().join("|") && w.endYear === null);
    war.startYear -= 10;

    Math.random = () => 0;
    autoResolveWars(game);

    assert.equal(cjng.relations.santa_rosa.status, "war", "the player's own war should require an explicit propose_peace, not silent auto-resolution");
    assert.equal(war.endYear, null);
  } finally {
    Math.random = originalRandom;
  }
});
