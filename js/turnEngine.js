import { chance, randInt, clamp, pick } from "./utils/random.js";
import { addLog, currentYear, getPlayerCartel } from "./state.js";
import { rollMortality, rollFamilyEvents, rollLoyaltyEvents, rollPoliceOperations } from "./events.js";
import { rollScriptedEvents } from "./scriptedEvents.js";
import { fillVacantRoles } from "./npcGenerator.js";
import { ROLE_ORDER } from "./model.js";

const ACTION_COSTS = {
  invest_production: 150,
  traffic_shipment: 250,
  corrupt_gov: 120,
  corrupt_police: 120,
  recruit_army: 100,
  pr_campaign: 150,
  lay_low: 0,
};

export function canAfford(cartel, type) {
  return cartel.resources.money >= (ACTION_COSTS[type] || 0);
}

export function isAttackable(game, cartelId, territoryId) {
  const cartel = game.cartels[cartelId];
  const territory = game.territories[territoryId];
  if (!territory || territory.controllerId === cartelId) return false;
  if (!territory.adj || !territory.adj.length) return true;
  return territory.adj.some((id) => cartel.territories.includes(id));
}

export function applyAction(game, cartelId, type, payload = {}) {
  const cartel = game.cartels[cartelId];
  const r = cartel.resources;
  const log = (t, ty) => addLog(game, t, ty);

  switch (type) {
    case "invest_production": {
      if (r.money < 150) return { ok: false, message: "No hay dinero suficiente." };
      r.money -= 150;
      const seizeChance = clamp(r.heat / 300, 0.03, 0.35);
      if (chance(seizeChance)) {
        r.heat = Math.min(100, r.heat + randInt(3, 8));
        log(`Un cargamento de ${cartel.name} es decomisado durante la producción.`, "event");
        return { ok: true, message: "Decomiso." };
      }
      const payout = Math.round(150 * (1.3 + Math.random()));
      r.money += payout;
      r.heat = Math.min(100, r.heat + 2);
      log(`${cartel.name} invierte en producción y obtiene ${payout} en ganancias.`, "good");
      return { ok: true, message: `+${payout}` };
    }
    case "traffic_shipment": {
      if (r.money < 250) return { ok: false, message: "No hay dinero suficiente." };
      r.money -= 250;
      const interdictChance = clamp(r.heat / 220, 0.05, 0.5);
      if (chance(interdictChance)) {
        r.heat = Math.min(100, r.heat + randInt(6, 14));
        log(`Un envío de ${cartel.name} es interceptado en la ruta.`, "event");
        return { ok: true, message: "Interceptado." };
      }
      const payout = Math.round(250 * (1.6 + Math.random() * 1.2));
      r.money += payout;
      r.heat = Math.min(100, r.heat + 5);
      log(`${cartel.name} completa un envío exitoso por valor de ${payout}.`, "good");
      return { ok: true, message: `+${payout}` };
    }
    case "corrupt_gov": {
      if (r.money < 120) return { ok: false, message: "No hay dinero suficiente." };
      r.money -= 120;
      r.corruptGov = Math.min(100, r.corruptGov + randInt(4, 9));
      r.heat = Math.max(0, r.heat - randInt(2, 5));
      log(`${cartel.name} soborna a funcionarios del gobierno.`, "good");
      return { ok: true };
    }
    case "corrupt_police": {
      if (r.money < 120) return { ok: false, message: "No hay dinero suficiente." };
      r.money -= 120;
      r.corruptPolice = Math.min(100, r.corruptPolice + randInt(4, 9));
      r.heat = Math.max(0, r.heat - randInt(2, 5));
      log(`${cartel.name} soborna a mandos policiales.`, "good");
      return { ok: true };
    }
    case "recruit_army": {
      if (r.money < 100) return { ok: false, message: "No hay dinero suficiente." };
      r.money -= 100;
      const gained = randInt(15, 35);
      r.armySize += gained;
      r.heat = Math.min(100, r.heat + 1);
      log(`${cartel.name} recluta ${gained} sicarios más.`, "good");
      return { ok: true };
    }
    case "pr_campaign": {
      if (r.money < 150) return { ok: false, message: "No hay dinero suficiente." };
      r.money -= 150;
      r.publicImage = Math.min(100, r.publicImage + randInt(5, 12));
      r.heat = Math.max(0, r.heat - randInt(4, 9));
      log(`${cartel.name} invierte en imagen pública y obras sociales.`, "good");
      return { ok: true };
    }
    case "lay_low": {
      r.heat = Math.max(0, r.heat - randInt(10, 20));
      log(`${cartel.name} reduce su actividad para bajar el perfil.`, "info");
      return { ok: true };
    }
    case "declare_war": {
      const target = game.cartels[payload.targetCartelId];
      if (!target) return { ok: false };
      cartel.relations[target.id] = { status: "war", tension: 90 };
      target.relations[cartel.id] = { status: "war", tension: 90 };
      log(`${cartel.name} declara la guerra a ${target.name}.`, "event");
      return { ok: true };
    }
    case "propose_peace": {
      const target = game.cartels[payload.targetCartelId];
      if (!target) return { ok: false };
      const strength = r.armySize;
      const targetStrength = target.resources.armySize;
      const acceptChance = clamp(0.3 + (targetStrength - strength) / (targetStrength + strength + 1), 0.1, 0.9);
      if (chance(acceptChance)) {
        cartel.relations[target.id] = { status: "neutral", tension: 30 };
        target.relations[cartel.id] = { status: "neutral", tension: 30 };
        log(`${target.name} acepta la paz con ${cartel.name}.`, "good");
        return { ok: true, accepted: true };
      }
      log(`${target.name} rechaza la propuesta de paz de ${cartel.name}.`, "event");
      return { ok: true, accepted: false };
    }
    case "propose_alliance": {
      const target = game.cartels[payload.targetCartelId];
      if (!target) return { ok: false };
      const acceptChance = clamp(0.35 - cartel.relations[target.id].tension / 200, 0.05, 0.7);
      if (chance(acceptChance)) {
        cartel.relations[target.id] = { status: "alliance", tension: 5 };
        target.relations[cartel.id] = { status: "alliance", tension: 5 };
        log(`${target.name} acepta una alianza con ${cartel.name}.`, "good");
        return { ok: true, accepted: true };
      }
      log(`${target.name} rechaza la alianza propuesta por ${cartel.name}.`, "event");
      return { ok: true, accepted: false };
    }
    case "attack_territory": {
      const territory = game.territories[payload.territoryId];
      const defenderId = territory.controllerId;
      const defender = game.cartels[defenderId];
      if (!defender) return { ok: false, message: "Territorio sin dueño." };
      if (!isAttackable(game, cartelId, territory.id)) {
        return { ok: false, message: "Ese territorio no linda con ninguno de tus dominios: no puedes atacarlo directamente." };
      }
      cartel.relations[defenderId] = { status: "war", tension: 95 };
      defender.relations[cartelId] = { status: "war", tension: 95 };
      const result = resolveBattle(game, cartel, defender, territory);
      return { ok: true, ...result };
    }
    case "occupy_territory": {
      const territory = game.territories[payload.territoryId];
      if (!territory || territory.controllerId) return { ok: false, message: "Ese territorio ya tiene dueño." };
      if (!isAttackable(game, cartelId, territory.id)) {
        return { ok: false, message: "No linda con ninguno de tus dominios: no puedes expandirte ahí todavía." };
      }
      const cost = territory.value * 15;
      if (r.money < cost) return { ok: false, message: `Hace falta $${cost} para esta expedición.` };
      r.money -= cost;
      if (chance(0.75)) {
        territory.controllerId = cartelId;
        cartel.territories.push(territory.id);
        r.heat = Math.min(100, r.heat + 5);
        log(`${cartel.name} ocupa el territorio libre de ${territory.name}.`, "good");
        return { ok: true, success: true };
      }
      r.heat = Math.min(100, r.heat + 3);
      log(`La expedición de ${cartel.name} para ocupar ${territory.name} fracasa.`, "event");
      return { ok: true, success: false };
    }
    default:
      return { ok: false, message: "Acción desconocida." };
  }
}

/** Militia numbers alone don't decide a fight: the quality of the commanders and the loyalty the
 * leader inspires shift the odds, within a +/-30% band around a neutral 1.0 multiplier. */
function commanderMultiplier(game, cartel) {
  let total = 0;
  let weight = 0;
  for (const roleKey of ["militaryChief", "sicariosChief"]) {
    const holder = game.characters[cartel.roles[roleKey]];
    if (holder && holder.alive && !holder.imprisoned) {
      total += holder.stats.violence * 0.6 + holder.stats.intrigue * 0.4;
      weight += 1;
    }
  }
  const leader = game.characters[cartel.roles.leader];
  if (leader && leader.alive && !leader.imprisoned) {
    total += leader.stats.loyaltyInspiring;
    weight += 1;
  }
  if (!weight) return 1;
  const avgStat = total / weight; // roughly 0-100, 50 = average
  return clamp(0.7 + (avgStat / 100) * 0.6, 0.7, 1.3);
}

function resolveBattle(game, attacker, defender, territory) {
  const log = (t, ty) => addLog(game, t, ty);
  const atkPower = attacker.resources.armySize * commanderMultiplier(game, attacker) * (0.85 + Math.random() * 0.3);
  const defPower = defender.resources.armySize * commanderMultiplier(game, defender) * (1.0 + Math.random() * 0.3);
  const attackerWins = atkPower > defPower;
  const casualtiesAtk = Math.round(attacker.resources.armySize * randInt(3, 15) / 100);
  const casualtiesDef = Math.round(defender.resources.armySize * randInt(3, 15) / 100);
  attacker.resources.armySize = Math.max(0, attacker.resources.armySize - casualtiesAtk);
  defender.resources.armySize = Math.max(0, defender.resources.armySize - casualtiesDef);
  attacker.resources.heat = Math.min(100, attacker.resources.heat + randInt(5, 12));
  defender.resources.heat = Math.min(100, defender.resources.heat + randInt(3, 8));

  if (attackerWins) {
    territory.controllerId = attacker.id;
    attacker.territories.push(territory.id);
    defender.territories = defender.territories.filter((t) => t !== territory.id);
    log(`${attacker.name} conquista ${territory.name} tras derrotar a ${defender.name}.`, "event");
  } else {
    log(`${attacker.name} fracasa en su intento de tomar ${territory.name}.`, "event");
  }

  // Small chance a commander dies in the fighting.
  for (const [side, roleKeys] of [[attacker, ["militaryChief", "sicariosChief"]], [defender, ["militaryChief", "sicariosChief"]]]) {
    for (const roleKey of roleKeys) {
      const holder = game.characters[side.roles[roleKey]];
      if (holder && holder.alive && chance(0.04)) {
        holder.alive = false;
        holder.deathYear = currentYear(game);
        log(`${holder.name} muere en el enfrentamiento por ${territory.name}.`, "death");
      }
    }
  }

  return { attackerWins, casualtiesAtk, casualtiesDef };
}

function autoResolveWars(game) {
  const seenPairs = new Set();
  for (const cartel of Object.values(game.cartels)) {
    if (cartel.destroyed) continue;
    for (const [otherId, rel] of Object.entries(cartel.relations)) {
      if (rel.status !== "war") continue;
      const pairKey = [cartel.id, otherId].sort().join("|");
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);
      const other = game.cartels[otherId];
      if (!other || other.destroyed) continue;
      if (!chance(0.6)) continue; // not every war flares up every turn
      const attackerFirst = chance(0.5);
      const [atk, def] = attackerFirst ? [cartel, other] : [other, cartel];
      const reachable = def.territories.filter((tId) => isAttackable(game, atk.id, tId));
      if (!reachable.length) continue; // no shared border yet: the war stays cold this turn
      resolveBattle(game, atk, def, game.territories[pick(reachable)]);
    }
  }
}

function runAiCartels(game) {
  for (const cartel of Object.values(game.cartels)) {
    if (!cartel.aiControlled || cartel.destroyed) continue;
    const r = cartel.resources;
    const options = [];
    if (r.money >= 150) options.push({ item: "invest_production", weight: 3 });
    if (r.money >= 250) options.push({ item: "traffic_shipment", weight: 3 });
    if (r.money >= 120) options.push({ item: "corrupt_police", weight: r.heat > 40 ? 4 : 1.5 });
    if (r.money >= 120) options.push({ item: "corrupt_gov", weight: 1.5 });
    if (r.money >= 100) options.push({ item: "recruit_army", weight: 2 });
    if (r.money >= 150) options.push({ item: "pr_campaign", weight: r.publicImage < 40 ? 3 : 1 });
    options.push({ item: "lay_low", weight: r.heat > 70 ? 5 : 0.5 });

    const atWar = Object.values(cartel.relations).some((rel) => rel.status === "war");
    if (atWar && cartel.territories.length && r.armySize > 50) {
      options.push({ item: "attack_territory", weight: 2 });
    }
    const neutralReachable = Object.values(game.territories).filter((t) => !t.controllerId && isAttackable(game, cartel.id, t.id));
    if (neutralReachable.length && r.money >= 200) {
      options.push({ item: "occupy_territory", weight: 2.5 });
    }

    let choice = weightedChoice(options);
    if (choice === "attack_territory") {
      const warEnemyIds = Object.entries(cartel.relations).filter(([, rel]) => rel.status === "war").map(([id]) => id);
      const reachable = warEnemyIds.flatMap((enemyId) => {
        const enemy = game.cartels[enemyId];
        return enemy ? enemy.territories.filter((tId) => isAttackable(game, cartel.id, tId)) : [];
      });
      if (reachable.length) {
        applyAction(game, cartel.id, "attack_territory", { territoryId: pick(reachable) });
        continue;
      }
      choice = "recruit_army"; // no reachable enemy territory this turn: build up forces instead
      if (!canAfford(cartel, choice)) continue;
    }
    if (choice === "occupy_territory") {
      if (neutralReachable.length) {
        applyAction(game, cartel.id, "occupy_territory", { territoryId: pick(neutralReachable).id });
        continue;
      }
      choice = "invest_production";
      if (!canAfford(cartel, choice)) continue;
    }
    if (choice) applyAction(game, cartel.id, choice, {});
  }
}

function weightedChoice(entries) {
  const total = entries.reduce((s, e) => s + e.weight, 0);
  if (total <= 0) return null;
  let roll = Math.random() * total;
  for (const e of entries) {
    roll -= e.weight;
    if (roll <= 0) return e.item;
  }
  return entries[entries.length - 1].item;
}

/** How much the player's crew personally trusts/likes them, drifting with the cartel's fortunes.
 * Feeds into betrayal risk in rollLoyaltyEvents and is visible/nudgeable from the Family tab. */
function driftBonds(game) {
  const cartel = getPlayerCartel(game);
  if (!cartel || cartel.destroyed) return;
  for (const id of cartel.characters) {
    if (id === game.playerCharacterId) continue;
    const c = game.characters[id];
    if (!c || !c.alive) continue;
    if (c.bondWithPlayer === undefined) c.bondWithPlayer = 50;
    let delta = randInt(-1, 1);
    if (cartel.resources.heat > 60) delta -= 1;
    if (cartel.resources.money > 500) delta += 1;
    c.bondWithPlayer = clamp(c.bondWithPlayer + delta, 0, 100);
  }
}

export function strengthenBond(game, characterId) {
  const c = game.characters[characterId];
  if (!c) return { ok: false };
  if (c.bondWithPlayer === undefined) c.bondWithPlayer = 50;
  if (c._bondBoostTurn === game.turn) {
    return { ok: false, message: `Ya has pasado tiempo con ${c.name} este turno.` };
  }
  c._bondBoostTurn = game.turn;
  c.bondWithPlayer = clamp(c.bondWithPlayer + randInt(8, 15), 0, 100);
  addLog(game, `Fortaleces tu relación con ${c.name}.`, "good");
  return { ok: true };
}

function incomeTick(game) {
  for (const cartel of Object.values(game.cartels)) {
    if (cartel.destroyed) continue;
    const territoryIncome = cartel.territories.reduce((s, tId) => s + (game.territories[tId]?.value || 0) * 10, 0);
    const upkeep = Math.round(cartel.resources.armySize * 0.45);
    const net = territoryIncome - upkeep;
    if (cartel.resources.money + net < 0) {
      // Can't make payroll: unpaid sicarios desert instead of the cartel going into debt.
      const shortfall = -(cartel.resources.money + net);
      const desertionFraction = clamp(shortfall / (upkeep || 1), 0, 0.15);
      const deserted = Math.round(cartel.resources.armySize * desertionFraction);
      if (deserted > 0) {
        cartel.resources.armySize = Math.max(10, cartel.resources.armySize - deserted);
        addLog(game, `${cartel.name} no puede pagar a su gente: ${deserted} hombres desertan.`, "event");
      }
      cartel.resources.money = 0;
    } else {
      cartel.resources.money += net;
    }
    cartel.resources.heat = Math.max(0, cartel.resources.heat - 1);
  }
}

export function getSuccessionCandidates(game, cartelId, deceasedId) {
  const cartel = game.cartels[cartelId];
  const deceased = game.characters[deceasedId];
  const year = currentYear(game);
  const alive = (id) => {
    const c = game.characters[id];
    return c && c.alive && !c.imprisoned;
  };
  const ids = new Set();
  for (const id of deceased.childrenIds || []) {
    if (alive(id) && year - game.characters[id].birthYear >= 16) ids.add(id);
  }
  if (deceased.spouseId && alive(deceased.spouseId)) ids.add(deceased.spouseId);
  for (const role of ROLE_ORDER) {
    const holderId = cartel.roles[role];
    if (holderId && holderId !== deceasedId && alive(holderId)) ids.add(holderId);
  }
  if (!ids.size) {
    for (const id of cartel.characters) {
      if (id !== deceasedId && alive(id)) ids.add(id);
    }
  }
  return [...ids].map((id) => game.characters[id]);
}

export function pickHeir(game, cartelId, deceasedId) {
  const cartel = game.cartels[cartelId];
  const deceased = game.characters[deceasedId];
  const year = currentYear(game);
  const alive = (id) => {
    const c = game.characters[id];
    return c && c.alive && !c.imprisoned;
  };
  const children = (deceased.childrenIds || []).filter(alive).filter((id) => year - game.characters[id].birthYear >= 16);
  if (children.length) {
    children.sort((a, b) => game.characters[a].birthYear - game.characters[b].birthYear);
    return children[0];
  }
  if (deceased.spouseId && alive(deceased.spouseId)) return deceased.spouseId;
  const underbossId = cartel.roles.underboss;
  if (underbossId && underbossId !== deceasedId && alive(underbossId)) return underbossId;
  for (const role of ROLE_ORDER) {
    const holderId = cartel.roles[role];
    if (holderId && holderId !== deceasedId && alive(holderId)) return holderId;
  }
  const anyMember = cartel.characters.find((id) => id !== deceasedId && alive(id));
  return anyMember || null;
}

function vacateRole(game, cartelId, characterId) {
  const cartel = game.cartels[cartelId];
  for (const role of ROLE_ORDER) {
    if (cartel.roles[role] === characterId) cartel.roles[role] = null;
  }
}

/** Releases any character (AI-controlled included) whose temporary sentence has run out.
 * The player's own release is handled by checkRelease, called separately before endTurn so
 * it can drive the regent/waiting UI; this covers everyone else, who would otherwise stay
 * "imprisoned" forever once a temporary sentence's release turn had passed. */
function releaseExpiredPrisoners(game) {
  for (const c of Object.values(game.characters)) {
    if (c.id === game.playerCharacterId) continue;
    if (!c.imprisoned || c.imprisoned.lifeSentence) continue;
    if (c.imprisoned.releaseTurn === null || game.turn < c.imprisoned.releaseTurn) continue;
    c.imprisoned = null;
    const cartel = game.cartels[c.cartelId];
    if (cartel && cartel.imprisonedLeaderId === c.id) {
      cartel.roles.leader = c.id;
      c.role = "leader";
      cartel.imprisonedLeaderId = null;
      addLog(game, `${c.name} sale de prisión y retoma el liderazgo de ${cartel.name}.`, "event");
    } else {
      addLog(game, `${c.name} sale de prisión.`, "event");
    }
  }
}

function autoSuccession(game, cartelId, deceasedId, reasonLabel) {
  const cartel = game.cartels[cartelId];
  const heirId = pickHeir(game, cartelId, deceasedId);
  vacateRole(game, cartelId, deceasedId);
  if (!heirId) {
    cartel.destroyed = true;
    addLog(game, `${cartel.name} se desintegra tras la caída de su líder (${reasonLabel}).`, "death");
    return null;
  }
  cartel.roles.leader = heirId;
  const heir = game.characters[heirId];
  heir.role = "leader";
  addLog(game, `${heir.name} asume el liderazgo de ${cartel.name}.`, "event");
  fillVacantRoles(cartel, game.characters, currentYear(game));
  return heirId;
}

export function endTurn(game) {
  if (game.gameOver) return { pendingSuccession: null, pendingRegentChoice: null, gameOver: true };
  const year = currentYear(game);
  const startIndex = game.log.length;

  runAiCartels(game);
  autoResolveWars(game);
  const deaths = rollMortality(game, (t, ty) => addLog(game, t, ty), year);
  rollFamilyEvents(game, (t, ty) => addLog(game, t, ty), year);
  const coups = rollLoyaltyEvents(game, (t, ty) => addLog(game, t, ty));
  for (const coup of coups) {
    if (chance(0.4)) {
      const leader = game.characters[coup.leaderId];
      leader.alive = false;
      leader.deathYear = year;
      addLog(game, `${leader.name} muere en un intento de golpe interno liderado por ${game.characters[coup.plotterId].name}.`, "death");
      deaths.push({ characterId: coup.leaderId, cartelId: coup.cartelId, wasLeader: true });
    } else {
      addLog(game, `Se frustra un intento de traición contra el liderazgo de ${game.cartels[coup.cartelId].name}.`, "event");
    }
  }
  deaths.push(...rollScriptedEvents(game, (t, ty) => addLog(game, t, ty), year));
  const arrests = rollPoliceOperations(game, (t, ty) => addLog(game, t, ty), year);
  incomeTick(game);
  driftBonds(game);

  let pendingSuccession = null;
  let pendingRegentChoice = null;

  for (const d of deaths) {
    if (d.characterId === game.playerCharacterId) {
      pendingSuccession = { deceasedId: d.characterId, cartelId: d.cartelId, reason: "death" };
    } else if (d.wasLeader) {
      autoSuccession(game, d.cartelId, d.characterId, "muerte");
    } else if (d.role) {
      vacateRole(game, d.cartelId, d.characterId);
      fillVacantRoles(game.cartels[d.cartelId], game.characters, year);
    }
    const dCartel = game.cartels[d.cartelId];
    if (dCartel && dCartel.imprisonedLeaderId === d.characterId) dCartel.imprisonedLeaderId = null;
  }

  for (const a of arrests) {
    if (a.characterId === game.playerCharacterId) {
      if (a.lifeSentence) {
        pendingSuccession = { deceasedId: a.characterId, cartelId: a.cartelId, reason: "arrest-life" };
      } else {
        pendingRegentChoice = { characterId: a.characterId, cartelId: a.cartelId, releaseTurn: game.characters[a.characterId].imprisoned.releaseTurn };
      }
    } else if (a.wasLeader) {
      if (a.lifeSentence) {
        autoSuccession(game, a.cartelId, a.characterId, "arresto");
      } else {
        // AI cartels keep going under an underboss until release; simplify: promote underboss as acting leader.
        const cartel = game.cartels[a.cartelId];
        const actingId = cartel.roles.underboss && cartel.roles.underboss !== a.characterId ? cartel.roles.underboss : pickHeir(game, a.cartelId, a.characterId);
        if (actingId) {
          cartel.roles.leader = actingId;
          game.characters[actingId].role = "leader";
          cartel.imprisonedLeaderId = a.characterId;
          addLog(game, `${game.characters[actingId].name} queda al mando de ${cartel.name} de forma interina.`, "info");
        }
      }
    }
  }

  releaseExpiredPrisoners(game);
  restorePlayerLeadership(game);

  game.turn += 1;
  game.year = currentYear(game);
  if (game.year >= game.endYear && !pendingSuccession) {
    game.gameOver = true;
    game.gameOverReason = "era-end";
  }
  recordHistory(game);

  return {
    newLogs: game.log.slice(startIndex),
    pendingSuccession,
    pendingRegentChoice,
    gameOver: game.gameOver,
  };
}

function recordHistory(game) {
  if (!game.history) game.history = {};
  for (const cartel of Object.values(game.cartels)) {
    if (!game.history[cartel.id]) game.history[cartel.id] = [];
    const h = game.history[cartel.id];
    h.push({
      turn: game.turn,
      year: game.year,
      money: cartel.destroyed ? 0 : cartel.resources.money,
      armySize: cartel.destroyed ? 0 : cartel.resources.armySize,
      heat: cartel.destroyed ? 0 : cartel.resources.heat,
      publicImage: cartel.destroyed ? 0 : cartel.resources.publicImage,
      territories: cartel.destroyed ? 0 : cartel.territories.length,
    });
    if (h.length > 200) h.shift();
  }
}

export function resolveSuccession(game, heirId) {
  const cartel = getPlayerCartel(game);
  const oldId = game.playerCharacterId;
  vacateRole(game, cartel.id, oldId);
  cartel.roles.leader = heirId;
  game.characters[heirId].role = "leader";
  game.playerCharacterId = heirId;
  game.playerControlMode = "direct";
  fillVacantRoles(cartel, game.characters, currentYear(game));
  addLog(game, `${game.characters[heirId].name} hereda el control de ${cartel.name}.`, "event");
}

export function resolveRegentChoice(game, useRegent) {
  const cartel = getPlayerCartel(game);
  if (!useRegent) {
    game.playerControlMode = "waiting";
    addLog(game, `El cártel queda a la deriva mientras su líder cumple condena.`, "info");
    return;
  }
  const heirId = pickHeir(game, cartel.id, game.playerCharacterId);
  if (!heirId) {
    game.playerControlMode = "waiting";
    return;
  }
  game.regentCharacterId = heirId;
  game.playerControlMode = "regent";
  cartel.roles.leader = heirId;
  game.characters[heirId].role = "leader";
  addLog(game, `${game.characters[heirId].name} gobierna ${cartel.name} de forma interina.`, "event");
}

/** Restores the original character to the head of the cartel once free, whether via
 * time served, an escape, or a scripted release — the single source of truth for it. */
export function restorePlayerLeadership(game) {
  const cartel = getPlayerCartel(game);
  const original = game.characters[game.playerCharacterId];
  if (!cartel || !original || original.imprisoned || game.playerControlMode === "direct") return;
  if (game.regentCharacterId) {
    const regent = game.characters[game.regentCharacterId];
    if (regent && regent.role === "leader") regent.role = null;
  }
  cartel.roles.leader = original.id;
  original.role = "leader";
  game.playerControlMode = "direct";
  game.regentCharacterId = null;
}

export function checkRelease(game) {
  const original = game.characters[game.playerCharacterId];
  if (!original || !original.imprisoned || original.imprisoned.lifeSentence) return false;
  if (original.imprisoned.releaseTurn !== null && game.turn >= original.imprisoned.releaseTurn) {
    original.imprisoned = null;
    restorePlayerLeadership(game);
    addLog(game, `${original.name} sale de prisión y retoma el control de ${getPlayerCartel(game).name}.`, "event");
    return true;
  }
  return false;
}

/** Lets the player try to break out of a temporary sentence early instead of waiting it out.
 * Not available against a life sentence. Chance scales with the character's own stealth and
 * intrigue plus how much of the police the cartel already has bought off. Success ends the
 * sentence immediately at the cost of a big heat spike (it makes the news); failure adds time. */
export function attemptEscape(game) {
  const original = game.characters[game.playerCharacterId];
  const cartel = getPlayerCartel(game);
  if (!original || !original.imprisoned) return { ok: false, message: "No estás en prisión." };
  if (original.imprisoned.lifeSentence) return { ok: false, message: "Una cadena perpetua no se puede burlar así." };

  const successChance = clamp(
    (original.stats.stealth * 0.4 + original.stats.intrigue * 0.35 + cartel.resources.corruptPolice * 0.25) / 100 - 0.1,
    0.05,
    0.75
  );

  if (chance(successChance)) {
    original.imprisoned = null;
    restorePlayerLeadership(game);
    cartel.resources.heat = Math.min(100, cartel.resources.heat + randInt(20, 30));
    addLog(game, `${original.name} protagoniza una fuga espectacular y recupera el control de ${cartel.name}. La noticia recorre el país.`, "good");
    return { ok: true, success: true };
  }

  const extra = randInt(4, 10);
  original.imprisoned.releaseTurn = (original.imprisoned.releaseTurn ?? game.turn) + extra;
  addLog(game, `El intento de fuga de ${original.name} fracasa: la condena se alarga.`, "event");
  return { ok: true, success: false };
}
