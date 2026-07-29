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
