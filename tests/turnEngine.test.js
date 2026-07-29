import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGameFromEra } from "../js/state.js";
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
  rollNewCartelSpawns,
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

test("occupy_territory rejects territories that already have an owner", () => {
  const game = newGame("mexico-rutas-1990-2006.json", "sinaloa");
  const result = applyAction(game, "sinaloa", "occupy_territory", { territoryId: "chihuahua" });
  assert.equal(result.ok, false);
});

test("attemptEscape refuses to break a life sentence and succeeds/fails deterministically otherwise", () => {
  const game = newGame("mexico-rutas-1990-2006.json", "sinaloa", "chapo_guzman");
  const chapo = game.characters.chapo_guzman;

  chapo.imprisoned = { sinceTurn: 0, releaseTurn: null, lifeSentence: true };
  const lifeResult = attemptEscape(game);
  assert.equal(lifeResult.ok, false);
  assert.ok(chapo.imprisoned, "life sentence must not be liftable via escape");

  chapo.imprisoned = { sinceTurn: 0, releaseTurn: 10, lifeSentence: false };
  chapo.stats.stealth = 95;
  chapo.stats.intrigue = 95;
  game.cartels.sinaloa.resources.corruptPolice = 90;
  const result = attemptEscape(game);
  assert.equal(result.ok, true);
  // With max stats the clamp caps success at 0.75, so failure is still possible; either way the
  // sentence object must be updated in a well-defined way (cleared on success, extended on failure).
  if (result.success) {
    assert.equal(chapo.imprisoned, null);
  } else {
    assert.ok(chapo.imprisoned.releaseTurn > 10);
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
  spouse.pregnancy.dueTurn = game.turn; // processPregnancies runs before the turn counter increments, so "due now" means due turn === current turn
  const childrenBefore = spouse.childrenIds.length;

  endTurn(game);

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
