import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROLE_ORDER } from "../js/model.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ERA_DIR = path.join(__dirname, "..", "data", "eras");

const ERA_FILES = fs.readdirSync(ERA_DIR).filter((f) => f.endsWith(".json") && f !== "index.json");

function loadEra(file) {
  return JSON.parse(fs.readFileSync(path.join(ERA_DIR, file), "utf8"));
}

// Structural/referential integrity checks across every era file, catching the kind of copy-paste
// or hand-edit mistakes (dangling ids, asymmetric adjacency, duplicate keys) that are easy to
// introduce when editing these JSON files by hand and easy to miss just by reading them.
for (const file of ERA_FILES) {
  test(`${file}: territory ids are unique and every controllerId/adj entry points to something real`, () => {
    const era = loadEra(file);
    const territoryIds = new Set();
    for (const t of era.territories) {
      assert.ok(!territoryIds.has(t.id), `duplicate territory id "${t.id}"`);
      territoryIds.add(t.id);
    }
    const cartelIds = new Set(era.cartels.map((c) => c.id));
    for (const t of era.territories) {
      if (t.controllerId) {
        assert.ok(cartelIds.has(t.controllerId), `territory "${t.id}" has controllerId "${t.controllerId}" which isn't a cartel in this era`);
      }
      for (const neighborId of t.adj || []) {
        assert.ok(territoryIds.has(neighborId), `territory "${t.id}" lists adjacent territory "${neighborId}" which doesn't exist`);
      }
    }
  });

  test(`${file}: territory adjacency is symmetric (if A borders B, B borders A)`, () => {
    const era = loadEra(file);
    const byId = Object.fromEntries(era.territories.map((t) => [t.id, t]));
    for (const t of era.territories) {
      for (const neighborId of t.adj || []) {
        const neighbor = byId[neighborId];
        if (!neighbor) continue; // already flagged by the previous test
        assert.ok((neighbor.adj || []).includes(t.id), `"${t.id}" lists "${neighborId}" as adjacent, but "${neighborId}" doesn't list "${t.id}" back`);
      }
    }
  });

  test(`${file}: cartel ids are unique and every role points to a character who actually belongs to that cartel`, () => {
    const era = loadEra(file);
    const cartelIdList = era.cartels.map((c) => c.id);
    assert.equal(new Set(cartelIdList).size, cartelIdList.length, "duplicate cartel id found");

    const charById = Object.fromEntries(era.characters.map((c) => [c.id, c]));
    for (const cartel of era.cartels) {
      assert.ok(cartel.roles.leader, `cartel "${cartel.id}" has no leader assigned`);
      for (const [roleKey, charId] of Object.entries(cartel.roles)) {
        assert.ok(ROLE_ORDER.includes(roleKey), `cartel "${cartel.id}" has an unknown role key "${roleKey}"`);
        const holder = charById[charId];
        assert.ok(holder, `cartel "${cartel.id}"'s ${roleKey} points to character id "${charId}" which doesn't exist`);
        assert.equal(holder.cartelId, cartel.id, `${holder.id} holds a role in "${cartel.id}" but character.cartelId is "${holder.cartelId}"`);
      }
    }
  });

  test(`${file}: character ids are unique and every family reference (spouse/parents/children) points to a real character`, () => {
    const era = loadEra(file);
    const charIds = new Set(era.characters.map((c) => c.id));
    assert.equal(charIds.size, era.characters.length, "duplicate character id found");

    for (const c of era.characters) {
      if (c.spouseId) assert.ok(charIds.has(c.spouseId), `${c.id}'s spouseId "${c.spouseId}" doesn't exist`);
      for (const parentId of c.parents || []) {
        assert.ok(charIds.has(parentId), `${c.id}'s parent "${parentId}" doesn't exist`);
      }
      for (const childId of c.childrenIds || []) {
        assert.ok(charIds.has(childId), `${c.id}'s child "${childId}" doesn't exist`);
      }
    }
  });

  test(`${file}: resources are non-negative and newCartelTerritories only lists territories that actually start neutral`, () => {
    const era = loadEra(file);
    for (const cartel of era.cartels) {
      for (const [key, value] of Object.entries(cartel.resources)) {
        if (typeof value === "number") {
          assert.ok(value >= 0, `cartel "${cartel.id}"'s resources.${key} is negative (${value})`);
        }
      }
    }
    const byId = Object.fromEntries(era.territories.map((t) => [t.id, t]));
    for (const tId of era.newCartelTerritories || []) {
      const t = byId[tId];
      assert.ok(t, `newCartelTerritories references "${tId}" which isn't a territory in this era`);
      assert.equal(t.controllerId, null, `newCartelTerritories lists "${tId}" as a random-spawn slot, but it's already controlled by "${t.controllerId}" at the start of the era`);
    }
  });
}
