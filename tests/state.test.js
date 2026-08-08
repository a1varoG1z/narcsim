import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGameFromEra, currentYear, getPlayerCartel, getPlayerCharacter } from "../js/state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ERA_DIR = path.join(__dirname, "..", "data", "eras");

function loadEra(file) {
  return JSON.parse(fs.readFileSync(path.join(ERA_DIR, file), "utf8"));
}

test("buildGameFromEra (existing character) wires up player, cartel and roster correctly", () => {
  const era = loadEra("guadalajara-1975-1989.json");
  const game = buildGameFromEra(era, { mode: "existing", cartelId: "guadalajara", characterId: "felix_gallardo" });

  assert.equal(game.playerCartelId, "guadalajara");
  assert.equal(game.playerCharacterId, "felix_gallardo");
  assert.equal(getPlayerCartel(game).aiControlled, false);
  assert.equal(getPlayerCharacter(game).name.includes("Félix Gallardo"), true);
  assert.equal(currentYear(game), era.startYear);

  // Every ROLE_ORDER slot should be filled (either from the era data or a generated NPC).
  const cartel = game.cartels.guadalajara;
  for (const roleId of Object.keys(cartel.roles)) {
    assert.ok(cartel.roles[roleId], `role ${roleId} should not be vacant after buildGameFromEra`);
  }

  // Non-player cartels should default to AI control.
  assert.equal(game.cartels.golfo.aiControlled, true);
});

test("buildGameFromEra (new cartel) plants the player in the chosen territory with a starter roster", () => {
  const era = loadEra("guadalajara-1975-1989.json");
  const game = buildGameFromEra(era, {
    mode: "new",
    leaderName: "Test Narco",
    sex: "M",
    age: 30,
    cartelName: "Test Cartel",
    color: "#123456",
    territoryId: "michoacan",
    portrait: null,
    stats: { violence: 50, business: 50, charisma: 50, intrigue: 50, loyaltyInspiring: 50, stealth: 50 },
  });

  const cartel = getPlayerCartel(game);
  assert.equal(cartel.name, "Test Cartel");
  assert.equal(game.territories.michoacan.controllerId, cartel.id);
  assert.ok(cartel.territories.includes("michoacan"));
  const player = getPlayerCharacter(game);
  assert.equal(player.name, "Test Narco");
  assert.equal(cartel.roles.leader, player.id);
  // Vacant roles should have been auto-filled with generated NPCs.
  assert.ok(Object.keys(cartel.roles).length > 1);
});

test("relations are initialized symmetrically for every cartel pair", () => {
  const era = loadEra("mexico-rutas-1990-2006.json");
  const game = buildGameFromEra(era, { mode: "existing", cartelId: "sinaloa", characterId: "chapo_guzman" });
  const ids = Object.keys(game.cartels);
  for (const a of ids) {
    for (const b of ids) {
      if (a === b) continue;
      assert.ok(game.cartels[a].relations[b], `missing relation ${a} -> ${b}`);
      assert.equal(game.cartels[a].relations[b].status, game.cartels[b].relations[a].status);
    }
  }
  // The scripted war override (Sinaloa vs Tijuana) should be present from turn zero.
  assert.equal(game.cartels.sinaloa.relations.tijuana.status, "war");
});

test("the 2024 Chapitos-vs-Mayiza era loads with all eras/index.json entries resolvable and starts at war", () => {
  const index = JSON.parse(fs.readFileSync(path.join(ERA_DIR, "index.json"), "utf8"));
  for (const entry of index) {
    assert.doesNotThrow(() => loadEra(entry.file), `era file ${entry.file} listed in index.json should parse`);
  }

  const era = loadEra("chapitos-mayiza-2024-actualidad.json");
  const game = buildGameFromEra(era, { mode: "existing", cartelId: "chapitos", characterId: "ivan_archivaldo_24" });
  assert.equal(game.cartels.chapitos.relations.mayiza.status, "war");
  assert.equal(game.cartels.mayiza.relations.chapitos.status, "war");
  // El Chapo and El Mayo are both real, imprisoned patriarchs in this era — genealogy should link
  // their sons as the actual faction leaders.
  assert.ok(game.characters.chapo_patriarca_24.childrenIds.includes("ivan_archivaldo_24"));
  assert.ok(game.characters.mayo_patriarca_24.childrenIds.includes("mayito_flaco_24"));
  assert.equal(game.characters.chapo_patriarca_24.imprisoned.lifeSentence, true);
});
