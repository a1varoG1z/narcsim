import { chance, randInt, pick, clamp } from "./utils/random.js";
import { generateNpc, randomName } from "./npcGenerator.js";
import { uid } from "./utils/random.js";
import { ROLE_ORDER } from "./model.js";

function livingMembers(game, cartelId) {
  return Object.values(game.characters).filter((c) => c.cartelId === cartelId && c.alive && !c.imprisoned);
}

function deathChanceForAge(age) {
  if (age < 45) return 0.003;
  if (age < 55) return 0.008;
  if (age < 65) return 0.02;
  if (age < 75) return 0.045;
  if (age < 85) return 0.09;
  return 0.16;
}

/** Natural deaths, illness and accidents. Returns list of {characterId, cartelId, wasLeader} for succession handling. */
export function rollMortality(game, addLog, year) {
  const results = [];
  for (const cartel of Object.values(game.cartels)) {
    if (cartel.destroyed) continue;
    for (const charId of [...cartel.characters]) {
      const c = game.characters[charId];
      if (!c || !c.alive) continue;
      const age = year - c.birthYear;
      let deathChance = deathChanceForAge(age);
      if (c.role === "traffickingChief" || c.role === "leader") deathChance += 0.002; // accidentes (avionetas, atentados)
      if (chance(deathChance)) {
        c.alive = false;
        c.deathYear = year;
        const cause = age > 70 ? "causas naturales" : pick(["un accidente", "una enfermedad repentina", "un atentado"]);
        addLog(`${c.name} ha muerto por ${cause}.`, "death");
        const wasLeader = cartel.roles.leader === c.id;
        results.push({ characterId: c.id, cartelId: cartel.id, wasLeader, role: c.role });
      }
    }
  }
  return results;
}

/** Marriages and births to keep genealogies growing. */
export function rollFamilyEvents(game, addLog, year) {
  for (const cartel of Object.values(game.cartels)) {
    if (cartel.destroyed) continue;
    const members = livingMembers(game, cartel.id);
    for (const c of members) {
      const age = year - c.birthYear;
      if (!c.spouseId && age >= 18 && age <= 60 && chance(0.01)) {
        const spouseSex = c.sex === "M" ? "F" : "M";
        const spouse = generateNpc({ cartelId: cartel.id, role: null, currentYear: year, minAge: 18, maxAge: 45 });
        spouse.sex = spouseSex;
        spouse.name = randomName(spouseSex);
        spouse.spouseId = c.id;
        game.characters[spouse.id] = spouse;
        cartel.characters.push(spouse.id);
        c.spouseId = spouse.id;
        addLog(`${c.name} ha contraído matrimonio con ${spouse.name}.`, "good");
      } else if (c.spouseId && age >= 18 && age <= 48 && c.sex === "F" && chance(0.05)) {
        const spouse = game.characters[c.spouseId];
        if (spouse && spouse.alive) {
          const child = generateNpc({ cartelId: cartel.id, role: null, currentYear: year, minAge: 0, maxAge: 0 });
          child.birthYear = year;
          child.name = randomName(child.sex).split(" ").slice(0, 2).join(" ");
          child.parents = [c.id, spouse.id];
          game.characters[child.id] = child;
          cartel.characters.push(child.id);
          c.childrenIds.push(child.id);
          spouse.childrenIds.push(child.id);
          addLog(`Nace ${child.name}, hijo/a de ${c.name}.`, "good");
        }
      }
    }
  }
}

/** Internal loyalty crises: minor sabotage or, rarely, a coup attempt against the leader. */
export function rollLoyaltyEvents(game, addLog) {
  const coups = [];
  for (const cartel of Object.values(game.cartels)) {
    if (cartel.destroyed) continue;
    const leader = game.characters[cartel.roles.leader];
    if (!leader || !leader.alive) continue;
    for (const role of ROLE_ORDER) {
      if (role === "leader") continue;
      const holder = game.characters[cartel.roles[role]];
      if (!holder || !holder.alive) continue;
      const disloyalty = clamp((holder.stats.intrigue - leader.stats.loyaltyInspiring) / 100, 0, 1);
      // A strong personal bond with the (player-controlled) leader tempers disloyalty; a poor one inflames it.
      const bond = holder.bondWithPlayer ?? 50;
      const bondFactor = clamp(1 - (bond - 50) / 60, 0.4, 1.6);
      if (chance(disloyalty * 0.015 * bondFactor)) {
        if (chance(0.15)) {
          coups.push({ cartelId: cartel.id, plotterId: holder.id, leaderId: leader.id });
        } else {
          cartel.resources.money = Math.max(0, cartel.resources.money - randInt(20, 80));
          addLog(`${holder.name} ha desviado fondos del cártel por deslealtad.`, "event");
        }
      }
    }
  }
  return coups;
}

/** Police / military operations against a cartel, scaled by heat and reduced by corruption. */
/** Shared with the UI (Overview tab) so the displayed risk always matches what actually gets rolled. */
export function policeOperationChance(cartel) {
  const heat = cartel.resources.heat;
  const shield = cartel.resources.corruptPolice * 0.5 + cartel.resources.corruptGov * 0.3;
  return clamp((heat - shield * 0.4) / 500, 0, 0.5);
}

export function rollPoliceOperations(game, addLog, year) {
  const arrests = [];
  for (const cartel of Object.values(game.cartels)) {
    if (cartel.destroyed) continue;
    const heat = cartel.resources.heat;
    const opChance = policeOperationChance(cartel);
    if (chance(opChance)) {
      const target = pickArrestTarget(game, cartel);
      if (!target) continue;
      cartel.resources.armySize = Math.max(0, Math.round(cartel.resources.armySize * (1 - randInt(2, 12) / 100)));
      const resistChance = clamp((cartel.resources.corruptPolice - heat * 0.3) / 150, 0.05, 0.7);
      if (chance(resistChance)) {
        addLog(`Un operativo contra ${target.name} fracasa gracias a la corrupción policial.`, "event");
        continue;
      }
      const lifeSentenceChance = clamp((target.stats.violence + heat) / 260, 0.1, 0.85);
      const lifeSentence = chance(lifeSentenceChance);
      const releaseTurn = lifeSentence ? null : game.turn + randInt(6, 30);
      target.imprisoned = { sinceTurn: game.turn, releaseTurn, lifeSentence };
      addLog(`${target.name} ha sido arrestado/a. ${lifeSentence ? "Enfrenta cadena perpetua." : "Podría salir en libertad en el futuro."}`, "death");
      arrests.push({ characterId: target.id, cartelId: cartel.id, wasLeader: cartel.roles.leader === target.id, lifeSentence });
      cartel.resources.heat = Math.max(0, cartel.resources.heat - randInt(10, 25));
    }
  }
  return arrests;
}

function pickArrestTarget(game, cartel) {
  const candidates = livingMembers(game, cartel.id).filter((c) => Object.values(cartel.roles).includes(c.id));
  if (!candidates.length) return null;
  return pick(candidates);
}
