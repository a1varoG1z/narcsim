import { chance, randInt, clamp, pick } from "./utils/random.js";
import { addLog, currentYear, getPlayerCartel, getPlayerCharacter } from "./state.js";
import { rollMortality, rollFamilyEvents, rollLoyaltyEvents, rollPoliceOperations } from "./events.js";
import { rollScriptedEvents, resolveScriptedChoice as applyScriptedChoice } from "./scriptedEvents.js";
import { fillVacantRoles, generateNpc, randomName } from "./npcGenerator.js";
import { ROLE_ORDER, STAT_ORDER, STATS, clampStat } from "./model.js";
import { fmtMoney } from "./utils/text.js";

function warKey(a, b) {
  return [a, b].sort().join("|");
}

function openWar(game, aId, bId) {
  if (!game.warHistory) game.warHistory = [];
  const key = warKey(aId, bId);
  let war = game.warHistory.find((w) => w.key === key && w.endYear === null);
  if (!war) {
    war = {
      key,
      cartelA: aId,
      cartelB: bId,
      startYear: currentYear(game),
      endYear: null,
      casualtiesA: 0,
      casualtiesB: 0,
      territoryChanges: [],
      treatyNote: null,
    };
    game.warHistory.push(war);
  }
  return war;
}

function closeWar(game, aId, bId, treatyNote) {
  if (!game.warHistory) return;
  const key = warKey(aId, bId);
  const war = game.warHistory.find((w) => w.key === key && w.endYear === null);
  if (war) {
    war.endYear = currentYear(game);
    if (treatyNote) war.treatyNote = treatyNote;
  }
}

export function getWarsForCartel(game, cartelId) {
  return (game.warHistory || []).filter((w) => w.cartelA === cartelId || w.cartelB === cartelId);
}

/** All money in the game is denominated in real dollars. Costs/income below are defined in
 * "base units" and multiplied by MONEY_SCALE so every figure — starting capital, action costs,
 * territory income, payroll — lands in a historically plausible range (a founding-era plaza
 * boss with a few hundred thousand dollars, a cartel at its peak with tens of millions) instead
 * of reading as a few hundred literal dollars. */
export const MONEY_SCALE = 10000;

export const ACTION_COSTS = {
  invest_production: 150 * MONEY_SCALE,
  traffic_shipment: 250 * MONEY_SCALE,
  corrupt_gov: 120 * MONEY_SCALE,
  corrupt_police: 120 * MONEY_SCALE,
  recruit_army: 100 * MONEY_SCALE,
  lay_low: 0,
  press_release: 80 * MONEY_SCALE,
  corridos_campaign: 150 * MONEY_SCALE,
  social_work: 300 * MONEY_SCALE,
  international_interview: 200 * MONEY_SCALE,
  damage_control: 250 * MONEY_SCALE,
  launder_money: 0,
  extort_territory: 0,
  assassinate_rival: 200 * MONEY_SCALE,
};

/** Actions that count against the per-turn action budget — the day-to-day running of the
 * cartel. War/diplomacy moves (attack, occupy, declare war, propose peace/alliance) and
 * territorial development are deliberately left unbudgeted: they already carry their own
 * strategic weight and consequences. */
export const BUDGETED_ACTIONS = new Set(Object.keys(ACTION_COSTS));
export const ACTIONS_PER_TURN = 5;

export function getActionsRemaining(game) {
  return Math.max(0, ACTIONS_PER_TURN - (game.actionsUsedThisTurn || 0));
}

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
  const isPlayerBudgeted = cartelId === game.playerCartelId && BUDGETED_ACTIONS.has(type);

  if (isPlayerBudgeted && getActionsRemaining(game) <= 0) {
    return { ok: false, message: "No te quedan acciones este turno. Avanza el turno para continuar." };
  }

  const result = (function runAction() {
  switch (type) {
    case "invest_production": {
      const cost = ACTION_COSTS.invest_production;
      if (r.money < cost) return { ok: false, message: "No hay dinero suficiente." };
      const owned = cartel.territories.map((id) => game.territories[id]).filter(Boolean);
      if (!owned.length) return { ok: false, message: "No tienes territorios donde producir." };
      let territory = payload.territoryId ? game.territories[payload.territoryId] : null;
      if (!territory || territory.controllerId !== cartelId) {
        territory = owned.reduce((best, t) => (t.value > best.value ? t : best), owned[0]);
      }
      r.money -= cost;
      const seizeChance = clamp(r.heat / 300, 0.03, 0.35);
      if (chance(seizeChance)) {
        r.heat = Math.min(100, r.heat + randInt(3, 8));
        log(`Un cargamento de ${cartel.name} es decomisado durante la producción en ${territory.name}.`, "event");
        return { ok: true, message: "Decomiso.", territoryId: territory.id };
      }
      const payout = Math.round((90 + territory.value * 12) * MONEY_SCALE * (1.1 + Math.random() * 0.5));
      r.money += payout;
      r.heat = Math.min(100, r.heat + 2);
      log(`${cartel.name} invierte en producción en ${territory.name} y obtiene ${fmtMoney(payout)} en ganancias.`, "good");
      return { ok: true, message: `+${payout}`, territoryId: territory.id };
    }
    case "traffic_shipment": {
      const cost = ACTION_COSTS.traffic_shipment;
      if (r.money < cost) return { ok: false, message: "No hay dinero suficiente." };
      const partner = payload.partnerCartelId ? game.cartels[payload.partnerCartelId] : null;
      const partnerStatus = partner ? cartel.relations[partner.id]?.status : null;
      if (partner && partnerStatus === "war") {
        return { ok: false, message: `No puedes venderle a ${partner.name}: estáis en guerra.` };
      }
      r.money -= cost;
      const interdictChance = clamp(r.heat / 220, 0.05, 0.5);
      if (chance(interdictChance)) {
        r.heat = Math.min(100, r.heat + randInt(6, 14));
        log(`Un envío de ${cartel.name} es interceptado en la ruta.`, "event");
        return { ok: true, message: "Interceptado." };
      }
      const partnerMultiplier = partnerStatus === "alliance" ? 1.25 : partnerStatus === "neutral" ? 1 : 0.85;
      const payout = Math.round(cost * (1.6 + Math.random() * 1.2) * partnerMultiplier);
      r.money += payout;
      r.heat = Math.min(100, r.heat + 5);
      if (partner) {
        partner.resources.money = Math.round(partner.resources.money + payout * 0.15);
        const tensionDelta = partnerStatus === "alliance" ? -5 : -2;
        cartel.relations[partner.id].tension = clamp(cartel.relations[partner.id].tension + tensionDelta, 0, 100);
        partner.relations[cartel.id].tension = cartel.relations[partner.id].tension;
        log(`${cartel.name} completa un envío por valor de ${fmtMoney(payout)} en sociedad con ${partner.name}.`, "good");
      } else {
        log(`${cartel.name} completa un envío exitoso por valor de ${fmtMoney(payout)} en el mercado abierto.`, "good");
      }
      return { ok: true, message: `+${payout}` };
    }
    case "corrupt_gov": {
      const cost = ACTION_COSTS.corrupt_gov;
      if (r.money < cost) return { ok: false, message: "No hay dinero suficiente." };
      r.money -= cost;
      r.corruptGov = Math.min(100, r.corruptGov + randInt(4, 9));
      r.heat = Math.max(0, r.heat - randInt(2, 5));
      log(`${cartel.name} soborna a funcionarios del gobierno.`, "good");
      return { ok: true };
    }
    case "corrupt_police": {
      const cost = ACTION_COSTS.corrupt_police;
      if (r.money < cost) return { ok: false, message: "No hay dinero suficiente." };
      r.money -= cost;
      r.corruptPolice = Math.min(100, r.corruptPolice + randInt(4, 9));
      r.heat = Math.max(0, r.heat - randInt(2, 5));
      log(`${cartel.name} soborna a mandos policiales.`, "good");
      return { ok: true };
    }
    case "recruit_army": {
      const cost = ACTION_COSTS.recruit_army;
      if (r.money < cost) return { ok: false, message: "No hay dinero suficiente." };
      r.money -= cost;
      const gained = randInt(15, 35);
      r.armySize += gained;
      r.heat = Math.min(100, r.heat + 1);
      log(`${cartel.name} recluta ${gained} sicarios más.`, "good");
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
      openWar(game, cartelId, target.id);
      log(`${cartel.name} declara la guerra a ${target.name}.`, "event");
      return { ok: true };
    }
    case "propose_peace": {
      const target = game.cartels[payload.targetCartelId];
      if (!target) return { ok: false };
      const strength = r.armySize;
      const targetStrength = target.resources.armySize;
      let acceptChance = clamp(0.3 + (targetStrength - strength) / (targetStrength + strength + 1), 0.1, 0.9);

      const cedeTerritory = payload.cedeTerritoryId ? game.territories[payload.cedeTerritoryId] : null;
      const validCession = cedeTerritory && cedeTerritory.controllerId === cartelId;
      if (validCession) acceptChance = clamp(acceptChance + 0.3, 0.1, 0.97);
      const demandIndemnity = !!payload.demandIndemnity;
      if (demandIndemnity) acceptChance = clamp(acceptChance - 0.2, 0.05, 0.97);

      if (chance(acceptChance)) {
        cartel.relations[target.id] = { status: "neutral", tension: 30 };
        target.relations[cartel.id] = { status: "neutral", tension: 30 };
        let treatyNote = "";
        if (validCession) {
          cedeTerritory.controllerId = target.id;
          cartel.territories = cartel.territories.filter((id) => id !== cedeTerritory.id);
          target.territories.push(cedeTerritory.id);
          treatyNote += ` ${cartel.name} cede ${cedeTerritory.name} como parte del acuerdo.`;
        }
        let indemnity = 0;
        if (demandIndemnity) {
          indemnity = Math.round(target.resources.money * 0.2);
          target.resources.money = Math.max(0, target.resources.money - indemnity);
          r.money += indemnity;
          treatyNote += ` ${target.name} paga una indemnización de ${fmtMoney(indemnity)}.`;
        }
        closeWar(game, cartelId, target.id, treatyNote.trim() || null);
        log(`${target.name} acepta la paz con ${cartel.name}.${treatyNote}`, "good");
        return { ok: true, accepted: true, cededTerritory: cedeTerritory?.name, indemnity };
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
        closeWar(game, cartelId, target.id);
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
      openWar(game, cartelId, defenderId);
      const result = resolveBattle(game, cartel, defender, territory);
      return { ok: true, ...result };
    }
    case "occupy_territory": {
      const territory = game.territories[payload.territoryId];
      if (!territory || territory.controllerId) return { ok: false, message: "Ese territorio ya tiene dueño." };
      if (!isAttackable(game, cartelId, territory.id)) {
        return { ok: false, message: "No linda con ninguno de tus dominios: no puedes expandirte ahí todavía." };
      }
      const cost = territory.value * 15 * MONEY_SCALE;
      if (r.money < cost) return { ok: false, message: `Hace falta ${fmtMoney(cost)} para esta expedición.` };
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
    case "develop_territory": {
      const territory = game.territories[payload.territoryId];
      if (!territory || territory.controllerId !== cartelId) return { ok: false, message: "Ese territorio no es tuyo." };
      if (territory.value >= 40) return { ok: false, message: "Este territorio ya está en su máximo desarrollo." };
      const cost = territory.value * 20 * MONEY_SCALE;
      if (r.money < cost) return { ok: false, message: `Hace falta ${fmtMoney(cost)} para desarrollar ${territory.name}.` };
      r.money -= cost;
      const failChance = clamp(r.heat / 350, 0.03, 0.25);
      if (chance(failChance)) {
        r.heat = Math.min(100, r.heat + randInt(2, 5));
        log(`La inversión de infraestructura de ${cartel.name} en ${territory.name} se pierde entre trabas y decomisos.`, "event");
        return { ok: true, success: false };
      }
      const gain = randInt(1, 3);
      territory.value = Math.min(40, territory.value + gain);
      log(`${cartel.name} desarrolla rutas e infraestructura en ${territory.name}, elevando su valor económico permanentemente.`, "good");
      return { ok: true, success: true, newValue: territory.value };
    }
    case "press_release": {
      const cost = ACTION_COSTS.press_release;
      if (r.money < cost) return { ok: false, message: "No hay dinero suficiente." };
      r.money -= cost;
      r.publicImage = Math.min(100, r.publicImage + randInt(5, 10));
      r.heat = Math.max(0, r.heat - randInt(2, 4));
      log(`${cartel.name} emite un comunicado de prensa para suavizar su imagen.`, "good");
      return { ok: true };
    }
    case "corridos_campaign": {
      const cost = ACTION_COSTS.corridos_campaign;
      if (r.money < cost) return { ok: false, message: "No hay dinero suficiente." };
      r.money -= cost;
      r.publicImage = Math.min(100, r.publicImage + randInt(8, 14));
      r.internationalReputation = Math.min(100, (r.internationalReputation ?? 15) + randInt(3, 6));
      r.heat = Math.min(100, r.heat + randInt(3, 6));
      log(`${cartel.name} patrocina corridos y narcocultura: crece su leyenda, pero también su exposición.`, "event");
      return { ok: true };
    }
    case "social_work": {
      const cost = ACTION_COSTS.social_work;
      if (r.money < cost) return { ok: false, message: "No hay dinero suficiente." };
      r.money -= cost;
      r.publicImage = Math.min(100, r.publicImage + randInt(15, 25));
      r.heat = Math.max(0, r.heat - randInt(8, 12));
      log(`${cartel.name} financia obra social (escuelas, iglesias, caminos) y gana el favor de la comunidad.`, "good");
      return { ok: true };
    }
    case "international_interview": {
      const cost = ACTION_COSTS.international_interview;
      if (r.money < cost) return { ok: false, message: "No hay dinero suficiente." };
      r.money -= cost;
      const spokesperson = game.characters[cartel.roles.leader] || game.characters[cartel.roles.prChief];
      const charisma = spokesperson ? spokesperson.stats.charisma : 50;
      const successChance = clamp(charisma / 130, 0.2, 0.75);
      if (chance(successChance)) {
        r.internationalReputation = Math.min(100, (r.internationalReputation ?? 15) + randInt(15, 25));
        r.publicImage = Math.min(100, r.publicImage + randInt(8, 12));
        log(`Una entrevista internacional retrata a ${cartel.name} bajo una luz favorable. Su fama se vuelve global.`, "good");
        return { ok: true, success: true };
      }
      r.heat = Math.min(100, r.heat + randInt(15, 20));
      r.publicImage = Math.max(0, r.publicImage - randInt(3, 8));
      log(`La entrevista internacional se vuelve en contra de ${cartel.name}, exponiendo sus operaciones.`, "event");
      return { ok: true, success: false };
    }
    case "damage_control": {
      const cost = ACTION_COSTS.damage_control;
      if (r.money < cost) return { ok: false, message: "No hay dinero suficiente." };
      r.money -= cost;
      r.heat = Math.max(0, r.heat - randInt(15, 20));
      log(`${cartel.name} invierte en control de daños para acallar un episodio reciente.`, "good");
      return { ok: true };
    }
    case "launder_money": {
      const amount = Math.min(payload.amount || 0, r.money);
      if (amount <= 0) return { ok: false, message: "No hay nada que lavar." };
      const financeChief = game.characters[cartel.roles.financeChief];
      const feeRate = clamp(0.25 - (financeChief ? financeChief.stats.business / 500 : 0), 0.08, 0.25);
      const fee = Math.round(amount * feeRate);
      r.money -= fee;
      r.launderedMoney = (r.launderedMoney || 0) + amount;
      r.heat = Math.max(0, r.heat - clamp(Math.round(amount / (50 * MONEY_SCALE)), 2, 20));
      log(`${cartel.name} lava ${fmtMoney(amount)} a través de negocios legales (comisión: ${fmtMoney(fee)}).`, "good");
      return { ok: true, fee };
    }
    case "extort_territory": {
      const territory = game.territories[payload.territoryId];
      if (!territory || territory.controllerId !== cartelId) return { ok: false, message: "Ese territorio no es tuyo." };
      const payout = Math.round(territory.value * 4 * MONEY_SCALE * (0.8 + Math.random() * 0.6));
      r.money += payout;
      r.heat = Math.min(100, r.heat + randInt(3, 7));
      r.publicImage = Math.max(0, r.publicImage - randInt(3, 8));
      const backlashChance = clamp(r.heat / 300, 0.05, 0.3);
      if (chance(backlashChance)) {
        territory.value = Math.max(1, territory.value - 1);
        log(`${cartel.name} extorsiona a comerciantes de ${territory.name} por ${fmtMoney(payout)}, pero el negocio local se resiente.`, "event");
        return { ok: true, success: true, payout, backlash: true };
      }
      log(`${cartel.name} extorsiona a comerciantes de ${territory.name} por ${fmtMoney(payout)}.`, "event");
      return { ok: true, success: true, payout };
    }
    case "assassinate_rival": {
      const cost = ACTION_COSTS.assassinate_rival;
      if (r.money < cost) return { ok: false, message: "No hay dinero suficiente." };
      const target = game.characters[payload.targetCharacterId];
      const targetCartel = target ? game.cartels[target.cartelId] : null;
      if (!target || !target.alive || !targetCartel || targetCartel.id === cartelId) {
        return { ok: false, message: "Objetivo no válido." };
      }
      r.money -= cost;
      const hitman = game.characters[cartel.roles.sicariosChief];
      const attackSkill = hitman ? (hitman.stats.stealth + hitman.stats.violence) / 2 : 40;
      const defenseSkill = target.stats.stealth + targetCartel.resources.corruptPolice / 4;
      const successChance = clamp(0.35 + (attackSkill - defenseSkill) / 150, 0.1, 0.75);
      if (chance(successChance)) {
        target.alive = false;
        target.deathYear = currentYear(game);
        const wasLeader = targetCartel.roles.leader === target.id;
        if (wasLeader) {
          autoSuccession(game, targetCartel.id, target.id, "atentado");
        } else if (target.role) {
          vacateRole(game, targetCartel.id, target.id);
          fillVacantRoles(targetCartel, game.characters, currentYear(game));
        }
        targetCartel.resources.heat = Math.min(100, targetCartel.resources.heat + randInt(10, 20));
        r.heat = Math.min(100, r.heat + randInt(20, 35));
        cartel.relations[targetCartel.id] = { status: "war", tension: 95 };
        targetCartel.relations[cartelId] = { status: "war", tension: 95 };
        openWar(game, cartelId, targetCartel.id);
        log(`${target.name} muere en un atentado ordenado por ${cartel.name}.`, "death");
        return { ok: true, success: true };
      }
      r.heat = Math.min(100, r.heat + randInt(25, 40));
      targetCartel.relations[cartelId] = { status: "war", tension: 90 };
      cartel.relations[targetCartel.id] = { status: "war", tension: 90 };
      openWar(game, cartelId, targetCartel.id);
      log(`El atentado de ${cartel.name} contra ${target.name} fracasa y expone su autoría.`, "event");
      return { ok: true, success: false };
    }
    default:
      return { ok: false, message: "Acción desconocida." };
  }
  })();

  if (isPlayerBudgeted && result?.ok) {
    game.actionsUsedThisTurn = (game.actionsUsedThisTurn || 0) + 1;
  }
  return result;
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
  const war = openWar(game, attacker.id, defender.id);
  const atkPower = attacker.resources.armySize * commanderMultiplier(game, attacker) * (0.85 + Math.random() * 0.3);
  const defPower = defender.resources.armySize * commanderMultiplier(game, defender) * (1.0 + Math.random() * 0.3);
  const attackerWins = atkPower > defPower;
  const casualtiesAtk = Math.round(attacker.resources.armySize * randInt(3, 15) / 100);
  const casualtiesDef = Math.round(defender.resources.armySize * randInt(3, 15) / 100);
  attacker.resources.armySize = Math.max(0, attacker.resources.armySize - casualtiesAtk);
  defender.resources.armySize = Math.max(0, defender.resources.armySize - casualtiesDef);
  attacker.resources.heat = Math.min(100, attacker.resources.heat + randInt(5, 12));
  defender.resources.heat = Math.min(100, defender.resources.heat + randInt(3, 8));

  if (war.cartelA === attacker.id) {
    war.casualtiesA += casualtiesAtk;
    war.casualtiesB += casualtiesDef;
  } else {
    war.casualtiesB += casualtiesAtk;
    war.casualtiesA += casualtiesDef;
  }

  if (attackerWins) {
    territory.controllerId = attacker.id;
    attacker.territories.push(territory.id);
    defender.territories = defender.territories.filter((t) => t !== territory.id);
    war.territoryChanges.push({ year: currentYear(game), territoryName: territory.name, to: attacker.id });
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
    if (r.money >= ACTION_COSTS.invest_production) options.push({ item: "invest_production", weight: 3 });
    if (r.money >= ACTION_COSTS.traffic_shipment) options.push({ item: "traffic_shipment", weight: 3 });
    if (r.money >= ACTION_COSTS.corrupt_police) options.push({ item: "corrupt_police", weight: r.heat > 40 ? 4 : 1.5 });
    if (r.money >= ACTION_COSTS.corrupt_gov) options.push({ item: "corrupt_gov", weight: 1.5 });
    if (r.money >= ACTION_COSTS.recruit_army) options.push({ item: "recruit_army", weight: 2 });
    if (r.money >= ACTION_COSTS.press_release) options.push({ item: "press_release", weight: r.publicImage < 40 ? 3 : 1 });
    if (r.money >= ACTION_COSTS.social_work) options.push({ item: "social_work", weight: r.publicImage < 30 ? 2 : 0.5 });
    if (r.money >= ACTION_COSTS.damage_control && r.heat > 60) options.push({ item: "damage_control", weight: 3 });
    options.push({ item: "lay_low", weight: r.heat > 70 ? 5 : 0.5 });

    const atWar = Object.values(cartel.relations).some((rel) => rel.status === "war");
    if (atWar && cartel.territories.length && r.armySize > 50) {
      options.push({ item: "attack_territory", weight: 2 });
    }
    const neutralReachable = Object.values(game.territories).filter((t) => !t.controllerId && isAttackable(game, cartel.id, t.id));
    if (neutralReachable.length && r.money >= 200 * MONEY_SCALE) {
      options.push({ item: "occupy_territory", weight: 2.5 });
    }
    if (cartel.territories.length) options.push({ item: "extort_territory", weight: 1.5 });
    const developable = cartel.territories.map((id) => game.territories[id]).filter((t) => t && t.value < 40 && r.money >= t.value * 20 * MONEY_SCALE);
    if (developable.length) options.push({ item: "develop_territory", weight: 2 });
    const rivalCartels = Object.values(game.cartels).filter((c) => c.id !== cartel.id && !c.destroyed);
    if (rivalCartels.length && r.money >= ACTION_COSTS.assassinate_rival) {
      options.push({ item: "assassinate_rival", weight: atWar ? 1.5 : 0.4 });
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
    if (choice === "extort_territory") {
      if (cartel.territories.length) {
        applyAction(game, cartel.id, "extort_territory", { territoryId: pick(cartel.territories) });
        continue;
      }
      choice = "lay_low";
    }
    if (choice === "develop_territory") {
      if (developable.length) {
        applyAction(game, cartel.id, "develop_territory", { territoryId: pick(developable).id });
        continue;
      }
      choice = "invest_production";
      if (!canAfford(cartel, choice)) continue;
    }
    if (choice === "assassinate_rival") {
      const target = rivalCartels.length ? pick(rivalCartels) : null;
      const targetChar = target ? game.characters[target.roles.leader] : null;
      if (targetChar && targetChar.alive) {
        applyAction(game, cartel.id, "assassinate_rival", { targetCharacterId: targetChar.id });
        continue;
      }
      choice = "corrupt_police";
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
    if (cartel.resources.money > 500 * MONEY_SCALE) delta += 1;
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

/** Shared with the UI (Economía tab) so the displayed breakdown always matches what incomeTick
 * actually applies at the end of the turn. */
export function getIncomeBreakdown(game, cartel) {
  const perTerritory = cartel.territories.map((tId) => {
    const t = game.territories[tId];
    return { territoryId: tId, name: t?.name || tId, value: t?.value || 0, income: (t?.value || 0) * 10 * MONEY_SCALE };
  });
  const baseIncome = perTerritory.reduce((s, t) => s + t.income, 0);
  // International fame opens pricier overseas markets: a modest, capped bonus on top of local sales.
  const exportBonusRate = clamp((cartel.resources.internationalReputation ?? 15) / 400, 0, 0.25);
  const exportBonus = Math.round(baseIncome * exportBonusRate);
  const territoryIncome = baseIncome + exportBonus;
  const upkeep = Math.round(cartel.resources.armySize * 0.45 * MONEY_SCALE);
  return { perTerritory, baseIncome, exportBonusRate, exportBonus, territoryIncome, upkeep, net: territoryIncome - upkeep };
}

function incomeTick(game) {
  for (const cartel of Object.values(game.cartels)) {
    if (cartel.destroyed) continue;
    const { territoryIncome, upkeep, net } = getIncomeBreakdown(game, cartel);
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
  processPregnancies(game);
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
  const scriptedResult = rollScriptedEvents(game, (t, ty) => addLog(game, t, ty), year);
  deaths.push(...scriptedResult.deaths);
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

  // A designated heir succeeds automatically, without a modal, as long as they're still eligible.
  if (pendingSuccession && game.designatedHeirId) {
    const candidates = getSuccessionCandidates(game, pendingSuccession.cartelId, pendingSuccession.deceasedId);
    const designated = candidates.find((c) => c.id === game.designatedHeirId);
    if (designated) {
      resolveSuccession(game, designated.id);
      pendingSuccession = null;
    }
  }

  releaseExpiredPrisoners(game);
  restorePlayerLeadership(game);

  const pendingMarriageEvent = !pendingSuccession && !pendingRegentChoice ? rollMarriageCrisis(game) : null;
  const pendingScriptedChoice = !pendingSuccession && !pendingRegentChoice ? scriptedResult.pendingChoice : null;

  game.turn += 1;
  game.year = currentYear(game);
  game.actionsUsedThisTurn = 0;
  if (game.year >= game.endYear && !pendingSuccession) {
    game.gameOver = true;
    game.gameOverReason = "era-end";
  }
  recordHistory(game);

  return {
    newLogs: game.log.slice(startIndex),
    pendingSuccession,
    pendingRegentChoice,
    pendingMarriageEvent,
    pendingScriptedChoice,
    gameOver: game.gameOver,
  };
}

/** Chance of an infidelity/relationship crisis for the player's own marriage, scaled inversely
 * with marriageBond. Queued as a modal choice rather than auto-resolved, unlike NPC drift. */
function rollMarriageCrisis(game) {
  const player = game.characters[game.playerCharacterId];
  if (!player || !player.alive || player.imprisoned || !player.spouseId) return null;
  const spouse = game.characters[player.spouseId];
  if (!spouse || !spouse.alive) return null;
  if (player.marriageBond === undefined) player.marriageBond = 70;
  const crisisChance = clamp(0.03 + (60 - player.marriageBond) / 500, 0.01, 0.12);
  if (!chance(crisisChance)) {
    player.marriageBond = clamp(player.marriageBond + randInt(-1, 2), 0, 100);
    return null;
  }
  return { spouseId: spouse.id };
}

/** Family and role-holders the player could plausibly designate as their heir ahead of time
 * (not age-gated at designation time — they may still be a minor and grow into eligibility). */
export function getDesignatableHeirs(game) {
  const player = getPlayerCharacter(game);
  const cartel = getPlayerCartel(game);
  if (!player || !cartel) return [];
  const ids = new Set();
  for (const id of player.childrenIds || []) ids.add(id);
  if (player.spouseId) ids.add(player.spouseId);
  for (const role of ROLE_ORDER) {
    if (cartel.roles[role] && cartel.roles[role] !== player.id) ids.add(cartel.roles[role]);
  }
  return [...ids].map((id) => game.characters[id]).filter((c) => c && c.alive && !c.imprisoned);
}

export function designateHeir(game, characterId) {
  const character = game.characters[characterId];
  if (!character) return { ok: false, message: "Personaje no encontrado." };
  game.designatedHeirId = characterId;
  addLog(game, `Designas a ${character.name} como tu heredero.`, "event");
  return { ok: true };
}

export function clearDesignatedHeir(game) {
  game.designatedHeirId = null;
}

/** Spending time grooming your heir strengthens the bond that keeps them loyal later and
 * sharpens one of their stats at random, the way an apprenticeship would. Once per turn. */
export function mentorHeir(game) {
  const heir = game.characters[game.designatedHeirId];
  if (!heir) return { ok: false, message: "No tienes un heredero designado." };
  if (!heir.alive) return { ok: false, message: "Tu heredero ya no vive." };
  if (heir._mentorTurn === game.turn) {
    return { ok: false, message: `Ya has instruido a ${heir.name} este turno.` };
  }
  heir._mentorTurn = game.turn;
  if (heir.bondWithPlayer === undefined) heir.bondWithPlayer = 50;
  heir.bondWithPlayer = clamp(heir.bondWithPlayer + randInt(5, 10), 0, 100);
  const statKey = pick(STAT_ORDER);
  heir.stats[statKey] = clampStat((heir.stats[statKey] || 0) + randInt(2, 5));
  addLog(game, `Instruyes personalmente a ${heir.name}, mejorando su ${STATS[statKey].toLowerCase()} y vuestro vínculo.`, "good");
  return { ok: true, stat: statKey };
}

/** Arranges a diplomatic marriage between an unmarried family member (child, sibling, or
 * widowed spouse-in-waiting) and a new NPC tied to another cartel — a classic alliance-by-blood
 * move that eases tension between the two organizations without requiring a war to end first. */
export function arrangeMarriage(game, familyMemberId, targetCartelId) {
  const member = game.characters[familyMemberId];
  const cartel = getPlayerCartel(game);
  const targetCartel = game.cartels[targetCartelId];
  if (!member || !member.alive || member.spouseId) {
    return { ok: false, message: "Ese familiar no está disponible para un matrimonio arreglado." };
  }
  if (!targetCartel || targetCartel.destroyed || targetCartelId === game.playerCartelId) {
    return { ok: false, message: "Ese cártel no es un destino válido para la alianza." };
  }
  const spouseSex = member.sex === "M" ? "F" : "M";
  const spouse = generateNpc({ cartelId: targetCartelId, role: null, currentYear: currentYear(game), minAge: 18, maxAge: 50 });
  spouse.sex = spouseSex;
  spouse.name = randomName(spouseSex);
  spouse.spouseId = member.id;
  member.spouseId = spouse.id;
  game.characters[spouse.id] = spouse;
  targetCartel.characters.push(spouse.id);

  const rel = cartel.relations[targetCartelId];
  const revRel = targetCartel.relations[cartel.id];
  if (rel && revRel) {
    rel.tension = clamp(rel.tension - randInt(15, 30), 0, 100);
    revRel.tension = rel.tension;
    if (rel.status !== "war" && rel.tension < 20) {
      rel.status = "alliance";
      revRel.status = "alliance";
    }
  }
  addLog(game, `${member.name} contrae un matrimonio arreglado con un miembro de ${targetCartel.name}, estrechando lazos entre ambas familias.`, "good");
  return { ok: true, spouseId: spouse.id };
}

function turnsForMonths(game, months) {
  return Math.max(1, Math.round(months / (game.turnMonths || 6)));
}

/** Registers a pregnancy that will only resolve into a birth ~9 in-game months later, via
 * processPregnancies at endTurn — deliberately not an instant outcome. */
export function beginPregnancy(game, motherId, fatherId) {
  const mother = game.characters[motherId];
  if (!mother) return { ok: false, message: "Personaje no encontrado." };
  mother.pregnancy = { fatherId, startTurn: game.turn, dueTurn: game.turn + turnsForMonths(game, 9) };
  return { ok: true };
}

/** Resolves the outcome of a full conception conversation (see js/dialogues.js): the odds are
 * driven by the accumulated "warmth" of the choices the player actually made during the scene,
 * plus their charisma, not a flat coin flip. The conceiving partner doesn't have to be the
 * player's spouse — any willing character works, mirroring how the dialogue can be started
 * with a new acquaintance as well as a marriage. */
export function resolveConceptionAttempt(game, partnerId, warmth = 0) {
  const player = getPlayerCharacter(game);
  const partner = game.characters[partnerId];
  if (!player || !partner) return { ok: false, message: "Personaje no encontrado." };
  const mother = player.sex === "F" ? player : partner;
  const father = player.sex === "F" ? partner : player;
  if (mother.sex !== "F" || father.sex !== "M") return { ok: false, message: "Hace falta una pareja de sexos distintos para este intento." };
  if (mother.pregnancy) return { ok: false, message: `${mother.name} ya está esperando un hijo/a.` };
  if (!mother.alive || !father.alive) return { ok: false, message: "Alguno de los dos ya no vive." };
  const successChance = clamp(0.2 + warmth * 0.04 + player.stats.charisma / 300, 0.05, 0.75);
  if (!chance(successChance)) {
    addLog(game, `${player.name} pasa la noche con ${partner.name}, pero esta vez no hay suerte.`, "info");
    return { ok: true, pregnant: false };
  }
  beginPregnancy(game, mother.id, father.id);
  addLog(game, `${mother.name} podría estar esperando un hijo/a de ${father.name}. Lo sabréis con certeza en los próximos meses.`, "good");
  return { ok: true, pregnant: true, motherId: mother.id };
}

/** Turns a pregnancy started via beginPregnancy into an actual birth once its due turn arrives —
 * the ~9-month wait is the whole point, so this never resolves in the same turn it started. */
function processPregnancies(game) {
  const year = currentYear(game);
  for (const mother of Object.values(game.characters)) {
    if (!mother.pregnancy || !mother.alive) continue;
    if (game.turn < mother.pregnancy.dueTurn) continue;
    const father = game.characters[mother.pregnancy.fatherId];
    const cartelId = mother.cartelId || father?.cartelId;
    const cartel = game.cartels[cartelId];
    const child = generateNpc({ cartelId, role: null, currentYear: year, minAge: 0, maxAge: 0 });
    child.birthYear = year;
    child.name = randomName(child.sex).split(" ").slice(0, 2).join(" ");
    child.parents = [mother.id, father?.id].filter(Boolean);
    game.characters[child.id] = child;
    if (cartel && !cartel.characters.includes(child.id)) cartel.characters.push(child.id);
    mother.childrenIds = [...(mother.childrenIds || []), child.id];
    if (father) father.childrenIds = [...(father.childrenIds || []), child.id];
    mother.pregnancy = null;
    addLog(game, `${mother.name} da a luz a ${child.name}${father ? ` (con ${father.name})` : ""}.`, "good");
  }
}

export function resolveScriptedChoice(game, eventId, optionId) {
  applyScriptedChoice(game, (t, ty) => addLog(game, t, ty), eventId, optionId);
}

export function resolveMarriageEvent(game, action) {
  const player = game.characters[game.playerCharacterId];
  const spouse = player ? game.characters[player.spouseId] : null;
  if (!player || !spouse) return;
  if (action === "forgive") {
    player.marriageBond = clamp((player.marriageBond ?? 70) + 5, 0, 100);
    addLog(game, `Decides perdonar y seguir adelante con ${spouse.name}.`, "event");
  } else if (action === "ignore") {
    player.marriageBond = clamp((player.marriageBond ?? 70) - 15, 0, 100);
    addLog(game, `Decides ignorar el problema con ${spouse.name}, pero la herida sigue ahí.`, "event");
  } else if (action === "divorce") {
    spouse.spouseId = null;
    player.spouseId = null;
    player.marriageBond = undefined;
    addLog(game, `Te divorcias de ${spouse.name}.`, "event");
  }
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
  game.designatedHeirId = null;
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
