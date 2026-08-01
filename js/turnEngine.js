import { chance, randInt, clamp, pick, uid } from "./utils/random.js";
import { addLog, currentYear, getPlayerCartel, getPlayerCharacter } from "./state.js";
import { rollMortality, rollFamilyEvents, rollLoyaltyEvents, rollPoliceOperations, driftMemberBonds, rollSiblingRivalry } from "./events.js";
import { rollScriptedEvents, resolveScriptedChoice as applyScriptedChoice } from "./scriptedEvents.js";
import { fillVacantRoles, generateNpc, randomName } from "./npcGenerator.js";
import { ROLE_ORDER, STAT_ORDER, STATS, clampStat, makeCartel, makeCharacter } from "./model.js";
import { fmtMoney } from "./utils/text.js";

function warKey(a, b) {
  return [a, b].sort().join("|");
}

/** Whether cartelId currently has a live informant inside targetCartelId, planted via
 * recruit_informant. Informants give better-planned (vs. blind) sabotage/assassination odds. */
function hasActiveInformant(cartel, targetCartelId) {
  return !!(cartel.informants && cartel.informants[targetCartelId] && cartel.informants[targetCartelId].turnsRemaining > 0);
}

const INFORMANT_SUCCESS_BONUS = 0.12;

/** corruptionGovChief/corruptionPoliceChief scale how much ground corrupt_gov/corrupt_police
 * actually gains (or, on a backfired aggressive attempt, loses) and how safe the aggressive
 * approach is. Both are modest and centered on an average (skill 50) chief — a randomly generated
 * placeholder holder changes almost nothing, so this only really matters once you've actually
 * invested in who holds the role. */
function corruptionChiefSkill(chief) {
  return chief ? (chief.stats.charisma + chief.stats.intrigue) / 2 : 40;
}
function corruptionChiefBonus(chief) {
  return clamp(Math.round((corruptionChiefSkill(chief) - 50) / 8), -6, 6);
}
function corruptionAggressiveChance(chief) {
  return clamp(0.8 + (corruptionChiefSkill(chief) - 50) / 250, 0.5, 0.95);
}

const VENDETTA_BONUS = 0.12;
const VENDETTA_EXPIRY_TURNS = 16;
const VENDETTA_CHANCE = 0.5;

/** Living spouse, parents, children, and same-parent siblings of a character — the pool a
 * vendetta (see assassinate_rival) can fall on when someone in the family is murdered. */
function getCloseRelatives(game, character) {
  const ids = new Set();
  if (character.spouseId) ids.add(character.spouseId);
  for (const id of character.parents || []) ids.add(id);
  for (const id of character.childrenIds || []) ids.add(id);
  for (const parentId of character.parents || []) {
    const parent = game.characters[parentId];
    for (const siblingId of (parent && parent.childrenIds) || []) {
      if (siblingId !== character.id) ids.add(siblingId);
    }
  }
  ids.delete(character.id);
  return [...ids].map((id) => game.characters[id]).filter((c) => c && c.alive);
}

const WAR_FOCUS_DURATION = 4;
const WAR_FOCUS_BONUS = 1.25;
const WAR_FOCUS_PENALTY = 0.85;

/** Combat power multiplier from set_war_focus: boosts a cartel's power against the one enemy it's
 * currently concentrating forces on, at the cost of fighting weaker against every other enemy it's
 * simultaneously at war with. Absent any active focus (the default for every AI cartel and any
 * player who never touches the feature), this is always 1 — no balance change unless opted into. */
function warFocusMultiplier(cartel, opponentId) {
  const focus = cartel.warFocus;
  if (!focus || focus.turnsRemaining <= 0) return 1;
  return focus.targetCartelId === opponentId ? WAR_FOCUS_BONUS : WAR_FOCUS_PENALTY;
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

// Which drug each era's economy really turned on, and a rough mechanical shorthand for how that
// changed the risk/reward profile: bulkier plant-based drugs (marijuana/heroin) were harder to
// conceal but drew less international heat than the cocaine boom; modern synthetics (meth/fentanyl)
// are far more profitable per shipment and easier to hide, but draw the most intense scrutiny of all.
export const DRUG_PROFILES = {
  "guadalajara-1975-1989": { name: "Marihuana y heroína", payoutMult: 0.85, heatMult: 0.9, seizureMult: 1.15 },
  "medellin-cali-1980-1995": { name: "Cocaína", payoutMult: 1.3, heatMult: 1.2, seizureMult: 1 },
  "mexico-rutas-1990-2006": { name: "Cocaína en tránsito hacia EE. UU.", payoutMult: 1.1, heatMult: 1, seizureMult: 1 },
  "fragmentacion-2006-2015": { name: "Cocaína, bajo una guerra abierta contra el narco", payoutMult: 1.15, heatMult: 1.3, seizureMult: 1.2 },
  "cjng-sinaloa-2015-actualidad": { name: "Metanfetamina y fentanilo", payoutMult: 1.4, heatMult: 1.4, seizureMult: 0.9 },
  "chapitos-mayiza-2024-actualidad": { name: "Fentanilo", payoutMult: 1.5, heatMult: 1.5, seizureMult: 0.85 },
};
const DEFAULT_DRUG_PROFILE = { name: "Narcóticos diversos", payoutMult: 1, heatMult: 1, seizureMult: 1 };

export function getDrugProfile(game) {
  return DRUG_PROFILES[game.eraId] || DEFAULT_DRUG_PROFILE;
}

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
  sabotage_rival: 100 * MONEY_SCALE,
  intercept_shipment: 150 * MONEY_SCALE,
  recruit_informant: 150 * MONEY_SCALE,
  poach_member: 350 * MONEY_SCALE,
  raid_territory: 150 * MONEY_SCALE,
  intimidate_territory: 70 * MONEY_SCALE,
  invest_property: 400 * MONEY_SCALE,
  invest_art: 300 * MONEY_SCALE,
  invest_business: 500 * MONEY_SCALE,
  invest_weapons: 350 * MONEY_SCALE,
  invest_security: 400 * MONEY_SCALE,
  invest_hideout: 350 * MONEY_SCALE,
  sell_art: 0,
};

/** Actions that count against the per-turn action budget — the day-to-day running of the
 * cartel. War/diplomacy moves (attack, occupy, declare war, propose peace/alliance) and
 * territorial development are deliberately left unbudgeted: they already carry their own
 * strategic weight and consequences. */
export const BUDGETED_ACTIONS = new Set(Object.keys(ACTION_COSTS));
export const ACTIONS_PER_TURN = 10;

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
      const drug = getDrugProfile(game);
      const seizeChance = clamp(clamp(r.heat / 300, 0.03, 0.35) * drug.seizureMult, 0.02, 0.5);
      if (chance(seizeChance)) {
        r.heat = Math.min(100, r.heat + Math.round(randInt(3, 8) * drug.heatMult));
        log(`Un cargamento de ${cartel.name} es decomisado durante la producción en ${territory.name}.`, "event");
        return { ok: true, message: "Decomiso.", territoryId: territory.id };
      }
      const payout = Math.round((90 + territory.value * 12) * MONEY_SCALE * (1.1 + Math.random() * 0.5) * drug.payoutMult);
      r.money += payout;
      r.heat = Math.min(100, r.heat + Math.round(2 * drug.heatMult));
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
      const drug = getDrugProfile(game);
      const interdictChance = clamp(clamp(r.heat / 220, 0.05, 0.5) * drug.seizureMult, 0.03, 0.65);
      if (chance(interdictChance)) {
        r.heat = Math.min(100, r.heat + Math.round(randInt(6, 14) * drug.heatMult));
        log(`Un envío de ${cartel.name} es interceptado en la ruta.`, "event");
        return { ok: true, message: "Interceptado." };
      }
      const partnerMultiplier = partnerStatus === "alliance" ? 1.25 : partnerStatus === "neutral" ? 1 : 0.85;
      const payout = Math.round(cost * (1.6 + Math.random() * 1.2) * partnerMultiplier * drug.payoutMult);
      r.money += payout;
      r.heat = Math.min(100, r.heat + Math.round(5 * drug.heatMult));
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
      const approach = payload.approach || "standard";
      const govChief = game.characters[cartel.roles.corruptionGovChief];
      const govBonus = corruptionChiefBonus(govChief);
      if (approach === "quiet") {
        r.corruptGov = clamp(r.corruptGov + randInt(3, 6) + govBonus, 0, 100);
        r.heat = Math.max(0, r.heat - randInt(5, 10));
        log(`${cartel.name} construye discretamente una red de contactos políticos, sin llamar la atención.`, "good");
        return { ok: true, approach };
      }
      if (approach === "aggressive") {
        if (chance(corruptionAggressiveChance(govChief))) {
          r.corruptGov = clamp(r.corruptGov + randInt(8, 15) + govBonus, 0, 100);
          r.heat = Math.min(100, r.heat + randInt(3, 8));
          log(`${cartel.name} presiona con dinero y amenazas veladas a funcionarios reacios, ampliando su red de corrupción de golpe.`, "good");
          return { ok: true, approach, backfired: false };
        }
        r.corruptGov = clamp(r.corruptGov - randInt(5, 10) + govBonus, 0, 100);
        r.heat = Math.min(100, r.heat + randInt(15, 25));
        log(`La presión de ${cartel.name} se filtra: un funcionario denuncia el intento y la red de corrupción se resiente.`, "event");
        return { ok: true, approach, backfired: true };
      }
      r.corruptGov = clamp(r.corruptGov + randInt(4, 9) + govBonus, 0, 100);
      r.heat = Math.max(0, r.heat - randInt(2, 5));
      log(`${cartel.name} soborna a funcionarios del gobierno.`, "good");
      return { ok: true, approach };
    }
    case "corrupt_police": {
      const cost = ACTION_COSTS.corrupt_police;
      if (r.money < cost) return { ok: false, message: "No hay dinero suficiente." };
      r.money -= cost;
      const approach = payload.approach || "standard";
      const policeChief = game.characters[cartel.roles.corruptionPoliceChief];
      const policeBonus = corruptionChiefBonus(policeChief);
      if (approach === "quiet") {
        r.corruptPolice = clamp(r.corruptPolice + randInt(3, 6) + policeBonus, 0, 100);
        r.heat = Math.max(0, r.heat - randInt(5, 10));
        log(`${cartel.name} construye discretamente una red de contactos policiales, sin llamar la atención.`, "good");
        return { ok: true, approach };
      }
      if (approach === "aggressive") {
        if (chance(corruptionAggressiveChance(policeChief))) {
          r.corruptPolice = clamp(r.corruptPolice + randInt(8, 15) + policeBonus, 0, 100);
          r.heat = Math.min(100, r.heat + randInt(3, 8));
          log(`${cartel.name} presiona con dinero y amenazas veladas a mandos policiales reacios, ampliando su red de corrupción de golpe.`, "good");
          return { ok: true, approach, backfired: false };
        }
        r.corruptPolice = clamp(r.corruptPolice - randInt(5, 10) + policeBonus, 0, 100);
        r.heat = Math.min(100, r.heat + randInt(15, 25));
        log(`La presión de ${cartel.name} se filtra: un mando policial denuncia el intento y la red de corrupción se resiente.`, "event");
        return { ok: true, approach, backfired: true };
      }
      r.corruptPolice = clamp(r.corruptPolice + randInt(4, 9) + policeBonus, 0, 100);
      r.heat = Math.max(0, r.heat - randInt(2, 5));
      log(`${cartel.name} soborna a mandos policiales.`, "good");
      return { ok: true, approach };
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
      const tension = (cartel.relations[target.id] || { tension: 0 }).tension;
      cartel.relations[target.id] = { status: "war", tension: 90 };
      target.relations[cartel.id] = { status: "war", tension: 90 };
      openWar(game, cartelId, target.id);
      const pretext = payload.pretext;
      if (pretext === "accusation") {
        const justified = tension > 60;
        if (justified) {
          r.publicImage = Math.min(100, r.publicImage + randInt(3, 8));
          r.heat = Math.min(100, r.heat + randInt(1, 6));
          log(`${cartel.name} declara la guerra a ${target.name}, denunciando públicamente una afrenta que la opinión pública da por cierta.`, "event");
        } else {
          r.publicImage = Math.max(0, r.publicImage - randInt(5, 12));
          r.heat = Math.min(100, r.heat + randInt(6, 14));
          log(`${cartel.name} declara la guerra a ${target.name} alegando una afrenta que a nadie le suena creíble.`, "event");
        }
      } else if (pretext === "surprise") {
        r.heat = Math.min(100, r.heat + randInt(7, 16));
        cartel.surpriseStrikeBonus = { targetId: target.id, turn: game.turn };
        log(`${cartel.name} declara la guerra a ${target.name} sin previo aviso, golpeando por sorpresa.`, "event");
      } else {
        r.heat = Math.min(100, r.heat + randInt(3, 8));
        log(`${cartel.name} declara la guerra a ${target.name}.`, "event");
      }
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
    case "set_war_focus": {
      // Concentrating forces on one front is a real recurring tactical decision, not just
      // "declare war and forget it": while active, this cartel fights harder against the chosen
      // enemy (WAR_FOCUS_BONUS) but noticeably weaker against every other enemy it's also at war
      // with (WAR_FOCUS_PENALTY) — a genuine trade-off, not a free buff. Doesn't touch the
      // per-turn action budget, matching declare_war/propose_peace/propose_alliance.
      if (!payload.targetCartelId) {
        cartel.warFocus = null;
        log(`${cartel.name} deja de concentrar sus fuerzas en un frente concreto.`, "event");
        return { ok: true, cleared: true };
      }
      const target = game.cartels[payload.targetCartelId];
      if (!target || cartel.relations[target.id]?.status !== "war") {
        return { ok: false, message: "Solo puedes concentrar fuerzas contra un cártel con el que estés en guerra." };
      }
      cartel.warFocus = { targetCartelId: target.id, turnsRemaining: WAR_FOCUS_DURATION };
      log(`${cartel.name} concentra sus fuerzas en el frente contra ${target.name}, debilitando su posición en cualquier otro frente abierto.`, "event");
      return { ok: true, targetCartelId: target.id };
    }
    case "propose_alliance": {
      const target = game.cartels[payload.targetCartelId];
      if (!target) return { ok: false };
      let bonus = 0;
      const approach = payload.approach;
      if (approach === "business") {
        bonus = clamp(r.publicImage / 400, 0, 0.15);
      } else if (approach === "commonEnemy") {
        const hasCommonEnemy = Object.entries(cartel.relations).some(
          ([id, rel]) => rel.status === "war" && target.relations[id]?.status === "war"
        );
        bonus = hasCommonEnemy ? 0.25 : -0.05;
      } else if (approach === "gift") {
        const giftAmount = payload.giftAmount || 0;
        if (giftAmount > 0) {
          if (r.money < giftAmount) return { ok: false, message: "No tienes suficiente dinero para ese gesto." };
          r.money -= giftAmount;
          bonus = clamp(giftAmount / (5000 * MONEY_SCALE), 0, 0.25);
        }
      }
      const acceptChance = clamp(0.35 - cartel.relations[target.id].tension / 200 + bonus, 0.05, 0.9);
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
      // Expanding gets harder the more territory you already hold (overreach), and a bigger army
      // relative to the target's value makes putting down local resistance more reliable —
      // occupying a neutral territory isn't just a flat coin flip regardless of your strength.
      const overreachPenalty = clamp((cartel.territories.length - 3) * 0.03, 0, 0.3);
      const armyFactor = clamp(r.armySize / (territory.value * 60), 0.5, 1.15);
      const successChance = clamp(0.75 * armyFactor - overreachPenalty, 0.2, 0.9);
      if (chance(successChance)) {
        territory.controllerId = cartelId;
        cartel.territories.push(territory.id);
        r.heat = Math.min(100, r.heat + 5);
        log(`${cartel.name} ocupa el territorio libre de ${territory.name}.`, "good");
        return { ok: true, success: true };
      }
      const casualties = Math.round(r.armySize * randInt(2, 8) / 100);
      r.armySize = Math.max(0, r.armySize - casualties);
      r.heat = Math.min(100, r.heat + 3);
      log(`La expedición de ${cartel.name} para ocupar ${territory.name} fracasa ante la resistencia local, dejando ${casualties} bajas.`, "event");
      return { ok: true, success: false, casualties };
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
      const approach = payload.approach || "discreet";
      const basePayout = territory.value * 4 * MONEY_SCALE * (0.8 + Math.random() * 0.6);
      let payout, backlashChance;
      if (approach === "lenient") {
        payout = Math.round(basePayout * 0.6);
        r.heat = Math.min(100, r.heat + randInt(0, 2));
        r.publicImage = Math.min(100, r.publicImage + randInt(1, 3));
        backlashChance = clamp(r.heat / 500, 0.02, 0.12);
      } else if (approach === "brutal") {
        payout = Math.round(basePayout * 1.4);
        r.heat = Math.min(100, r.heat + randInt(8, 15));
        r.publicImage = Math.max(0, r.publicImage - randInt(12, 20));
        backlashChance = clamp(r.heat / 200, 0.15, 0.5);
      } else {
        payout = Math.round(basePayout);
        r.heat = Math.min(100, r.heat + randInt(3, 7));
        r.publicImage = Math.max(0, r.publicImage - randInt(3, 8));
        backlashChance = clamp(r.heat / 300, 0.05, 0.3);
      }
      r.money += payout;
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
      if (!target || !target.alive || !targetCartel) {
        return { ok: false, message: "Objetivo no válido." };
      }
      // Internal hits (ordering a killing within your own cartel — e.g. a traitor already
      // discovered) are allowed, but never against your own cartel's leader or whoever you're
      // currently controlling: this action models an order given BY the leadership, not a self-coup.
      const isInternal = targetCartel.id === cartelId;
      if (isInternal && (targetCartel.roles.leader === target.id || target.id === game.playerCharacterId)) {
        return { ok: false, message: "No puedes ordenar un atentado contra ti mismo." };
      }
      const method = payload.method || "sicario";
      r.money -= cost;
      const hitman = game.characters[cartel.roles.sicariosChief];
      const attackSkill = hitman ? (hitman.stats.stealth + hitman.stats.violence) / 2 : 40;
      const defenseSkill = target.stats.stealth + targetCartel.resources.corruptPolice / 4;
      let successChance = clamp(0.35 + (attackSkill - defenseSkill) / 150, 0.1, 0.75);
      if (method === "accident") successChance = clamp(successChance - 0.15, 0.05, 0.6);
      else if (method === "public") successChance = clamp(successChance + 0.05, 0.1, 0.85);
      if (!isInternal && hasActiveInformant(cartel, targetCartel.id)) successChance = clamp(successChance + INFORMANT_SUCCESS_BONUS, 0.05, 0.9);
      // A grieving relative personally running the hit squad puts more into it than a routine job.
      const avenging = !isInternal && hitman && hitman.vendetta && hitman.vendetta.targetCartelId === targetCartel.id;
      if (avenging) successChance = clamp(successChance + VENDETTA_BONUS, 0.05, 0.9);
      // A leader's own private security detail (invest_security) only protects them specifically —
      // it doesn't help the rest of the cartel's roster.
      if (targetCartel.roles.leader === target.id && targetCartel.resources.securityBonus) {
        successChance = clamp(successChance - targetCartel.resources.securityBonus, 0.05, 0.9);
      }

      const goToWar = () => {
        cartel.relations[targetCartel.id] = { status: "war", tension: 95 };
        targetCartel.relations[cartelId] = { status: "war", tension: 95 };
        openWar(game, cartelId, targetCartel.id);
      };
      // An internal purge has no rival to declare war on, but it does poison trust across the
      // rest of the leadership circle: everyone else quietly registers that their boss is willing
      // to have one of their own killed.
      const chillInternalTrust = (delta) => {
        for (const role of ROLE_ORDER) {
          if (role === "leader") continue;
          const holder = game.characters[cartel.roles[role]];
          if (holder && holder.alive && holder.id !== target.id) {
            holder.bondWithPlayer = clamp((holder.bondWithPlayer ?? 50) + delta, 0, 100);
          }
        }
      };

      if (chance(successChance)) {
        // Same principle as the scripted historical events: when the target is the character the
        // player is currently controlling, a hit that "connects" becomes a heavy (55%) chance to
        // survive it anyway instead of a certain death — everything else about the attempt (heat,
        // going to war...) still plays out exactly as if it had killed them.
        const isPlayerTarget = target.id === game.playerCharacterId;
        const survives = isPlayerTarget && chance(0.55);
        if (!survives) {
          target.alive = false;
          target.deathYear = currentYear(game);
          target.deathCause = isInternal
            ? (method === "accident" ? "un accidente orquestado por su propio cártel (purga interna)" : method === "public" ? "una ejecución pública por traición (purga interna)" : "una purga interna")
            : (method === "accident" ? "un atentado disfrazado de accidente" : method === "public" ? "un atentado público" : "un atentado");
          if (isPlayerTarget) {
            // Defer to the same succession pipeline as any other player death (endTurn's own
            // deaths loop) instead of silently reassigning leadership via autoSuccession — the
            // player needs to be the one who picks their heir, not have it happen to them unseen.
            game._pendingPlayerDeath = { characterId: target.id, cartelId: targetCartel.id, reason: "atentado" };
          } else {
            const wasLeader = targetCartel.roles.leader === target.id;
            if (wasLeader) {
              autoSuccession(game, targetCartel.id, target.id, "atentado");
            } else if (target.role) {
              vacateRole(game, targetCartel.id, target.id);
              fillVacantRoles(targetCartel, game.characters, currentYear(game));
            }
          }
          if (!isInternal) {
            // A grieving relative with real standing in the org (a role, not just a bystander) can
            // come out of this swearing revenge on the cartel responsible — not every death, and
            // not every relative, but often enough that it's a real recurring thread.
            const grievers = getCloseRelatives(game, target).filter(
              (rel) => rel.cartelId === targetCartel.id && rel.role && !rel.vendetta && chance(VENDETTA_CHANCE)
            );
            for (const rel of grievers) {
              rel.vendetta = { targetCartelId: cartelId, sinceTurn: game.turn };
              log(`${rel.name} jura venganza contra ${cartel.name} por la muerte de ${target.name}.`, "event");
            }
          }
          if (avenging) {
            hitman.vendetta = null;
            log(`${hitman.name} cumple su venganza: ${target.name} paga por la muerte de su familiar a manos de ${targetCartel.name}.`, "good");
          }
        }
        const verb = survives ? "sobrevive por poco a" : "muere en";
        const logType = survives ? "good" : "death";
        if (isInternal) {
          if (method === "accident") {
            r.heat = Math.min(100, r.heat + randInt(3, 8));
            chillInternalTrust(-randInt(3, 8));
            log(`${target.name} ${verb} un aparente accidente orquestado en secreto por su propio cártel tras ser señalado como traidor.`, logType);
          } else if (method === "public") {
            r.heat = Math.min(100, r.heat + randInt(10, 18));
            r.publicImage = Math.max(0, r.publicImage - randInt(5, 12));
            chillInternalTrust(-randInt(10, 18));
            log(`${cartel.name} ejecuta públicamente a ${target.name} por traición, sembrando el terror dentro de sus propias filas.`, logType);
          } else {
            r.heat = Math.min(100, r.heat + randInt(6, 14));
            chillInternalTrust(-randInt(6, 12));
            log(`${target.name} ${verb} una purga interna ordenada por ${cartel.name} tras ser señalado como traidor.`, logType);
          }
        } else if (method === "accident") {
          targetCartel.resources.heat = Math.min(100, targetCartel.resources.heat + randInt(3, 8));
          r.heat = Math.min(100, r.heat + randInt(5, 12));
          log(`${target.name} ${verb} un aparente accidente orquestado en secreto por ${cartel.name}. Nadie sospecha... por ahora.`, logType);
        } else if (method === "public") {
          targetCartel.resources.heat = Math.min(100, targetCartel.resources.heat + randInt(15, 25));
          targetCartel.resources.publicImage = Math.max(0, targetCartel.resources.publicImage - randInt(10, 20));
          r.heat = Math.min(100, r.heat + randInt(25, 40));
          goToWar();
          log(`${target.name} ${verb} un ataque público y brutal ordenado por ${cartel.name}, pensado para sembrar el terror.`, logType);
        } else {
          targetCartel.resources.heat = Math.min(100, targetCartel.resources.heat + randInt(10, 20));
          r.heat = Math.min(100, r.heat + randInt(20, 35));
          goToWar();
          log(`${target.name} ${verb} un atentado ordenado por ${cartel.name}.`, logType);
        }
        if (!isInternal && game._reactiveEvents && targetCartel.id === game.playerCartelId) {
          game._reactiveEvents.push({ type: "assassinationAttempted", byCartelId: cartel.id, byCartelName: cartel.name, characterName: target.name, success: true, survived: survives });
        }
        return { ok: true, success: true, survived: survives };
      }
      if (isInternal) {
        r.heat = Math.min(100, r.heat + randInt(8, 16));
        chillInternalTrust(-randInt(10, 20));
        log(`El intento de purga interna de ${cartel.name} contra ${target.name} fracasa y siembra el miedo entre sus propios mandos.`, "event");
      } else if (method === "accident") {
        r.heat = Math.min(100, r.heat + randInt(20, 32));
        goToWar();
        log(`El intento de disfrazar un atentado contra ${target.name} como accidente fracasa y delata a ${cartel.name}.`, "event");
      } else {
        r.heat = Math.min(100, r.heat + randInt(25, 40));
        goToWar();
        log(`El atentado de ${cartel.name} contra ${target.name} fracasa y expone su autoría.`, "event");
      }
      if (!isInternal && game._reactiveEvents && targetCartel.id === game.playerCartelId) {
        game._reactiveEvents.push({ type: "assassinationAttempted", byCartelId: cartel.id, byCartelName: cartel.name, characterName: target.name, success: false });
      }
      return { ok: true, success: false };
    }
    case "sabotage_rival": {
      const cost = ACTION_COSTS.sabotage_rival;
      if (r.money < cost) return { ok: false, message: "No hay dinero suficiente." };
      const target = game.cartels[payload.targetCartelId];
      if (!target || target.id === cartelId || target.destroyed) return { ok: false, message: "Objetivo no válido." };
      r.money -= cost;
      const saboteur = game.characters[cartel.roles.intelChief] || game.characters[cartel.roles.sicariosChief];
      const skill = saboteur ? (saboteur.stats.stealth + saboteur.stats.intrigue) / 2 : 40;
      const defense = target.resources.corruptPolice / 2 + 20;
      let successChance = clamp(0.4 + (skill - defense) / 150, 0.15, 0.75);
      if (hasActiveInformant(cartel, target.id)) successChance = clamp(successChance + INFORMANT_SUCCESS_BONUS, 0.1, 0.9);
      const bumpTension = (delta) => {
        const status = cartel.relations[target.id]?.status || "neutral";
        const tension = clamp((cartel.relations[target.id]?.tension || 30) + delta, 0, 100);
        cartel.relations[target.id] = { status, tension };
        target.relations[cartelId] = { status, tension };
      };
      if (chance(successChance)) {
        const damage = Math.round(target.resources.money * (0.05 + Math.random() * 0.1));
        target.resources.money = Math.max(0, target.resources.money - damage);
        target.resources.heat = Math.min(100, target.resources.heat + randInt(5, 10));
        bumpTension(randInt(10, 20));
        log(`${cartel.name} sabotea operaciones de ${target.name}, causándole pérdidas por ${fmtMoney(damage)}.`, "event");
        if (game._reactiveEvents && target.id === game.playerCartelId) {
          game._reactiveEvents.push({ type: "sabotaged", byCartelId: cartel.id, byCartelName: cartel.name, damage, success: true });
        }
        return { ok: true, success: true, damage };
      }
      r.heat = Math.min(100, r.heat + randInt(10, 18));
      bumpTension(randInt(15, 25));
      log(`El sabotaje de ${cartel.name} contra ${target.name} fracasa y expone su autoría.`, "event");
      if (game._reactiveEvents && target.id === game.playerCartelId) {
        game._reactiveEvents.push({ type: "sabotaged", byCartelId: cartel.id, byCartelName: cartel.name, damage: 0, success: false });
      }
      return { ok: true, success: false };
    }
    case "intercept_shipment": {
      // Distinct from sabotage_rival: this is a violent ambush on a specific shipment in transit,
      // not covert financial sabotage. Money moves from the target straight into your own pocket
      // (you seize product, not just destroy value), it's sensitive to the era's own drug profile
      // (bulkier, easier-to-track shipments per DRUG_PROFILES.seizureMult are easier to intercept),
      // and a failed ambush costs you men, not just heat.
      const cost = ACTION_COSTS.intercept_shipment;
      if (r.money < cost) return { ok: false, message: "No hay dinero suficiente." };
      const target = game.cartels[payload.targetCartelId];
      if (!target || target.id === cartelId || target.destroyed) return { ok: false, message: "Objetivo no válido." };
      r.money -= cost;
      const raider = game.characters[cartel.roles.sicariosChief] || game.characters[cartel.roles.intelChief];
      const skill = raider ? (raider.stats.violence + raider.stats.stealth) / 2 : 40;
      const defense = target.resources.corruptPolice / 2 + 20;
      const drug = getDrugProfile(game);
      let successChance = clamp(clamp(0.35 + (skill - defense) / 150, 0.15, 0.7) * drug.seizureMult, 0.1, 0.8);
      if (hasActiveInformant(cartel, target.id)) successChance = clamp(successChance + INFORMANT_SUCCESS_BONUS, 0.1, 0.9);
      const bumpTension = (delta) => {
        const status = cartel.relations[target.id]?.status || "neutral";
        const tension = clamp((cartel.relations[target.id]?.tension || 30) + delta, 0, 100);
        cartel.relations[target.id] = { status, tension };
        target.relations[cartelId] = { status, tension };
      };
      if (chance(successChance)) {
        const seized = Math.round(cost * (1.4 + Math.random()) * drug.payoutMult);
        const gained = Math.round(seized * 0.5);
        target.resources.money = Math.max(0, target.resources.money - seized);
        r.money += gained;
        target.resources.heat = Math.min(100, target.resources.heat + randInt(8, 15));
        r.heat = Math.min(100, r.heat + randInt(8, 15));
        bumpTension(randInt(15, 25));
        log(`${cartel.name} intercepta en tránsito un cargamento de ${target.name} valorado en ${fmtMoney(seized)}.`, "event");
        if (game._reactiveEvents && target.id === game.playerCartelId) {
          game._reactiveEvents.push({ type: "shipmentIntercepted", byCartelId: cartel.id, byCartelName: cartel.name, amount: seized });
        }
        return { ok: true, success: true, seized, gained };
      }
      r.heat = Math.min(100, r.heat + randInt(12, 20));
      cartel.resources.armySize = Math.max(0, cartel.resources.armySize - randInt(2, 8));
      bumpTension(randInt(10, 20));
      log(`El intento de ${cartel.name} de interceptar un cargamento de ${target.name} termina en un tiroteo y fracasa.`, "event");
      return { ok: true, success: false };
    }
    case "recruit_informant": {
      const cost = ACTION_COSTS.recruit_informant;
      if (r.money < cost) return { ok: false, message: "No hay dinero suficiente." };
      const target = game.cartels[payload.targetCartelId];
      if (!target || target.id === cartelId || target.destroyed) return { ok: false, message: "Objetivo no válido." };
      r.money -= cost;
      const recruiter = game.characters[cartel.roles.intelChief] || game.characters[cartel.roles.sicariosChief];
      const skill = recruiter ? (recruiter.stats.intrigue + recruiter.stats.stealth) / 2 : 40;
      const defense = target.resources.corruptPolice / 2 + 25;
      const successChance = clamp(0.35 + (skill - defense) / 150, 0.15, 0.7);
      if (chance(successChance)) {
        if (!cartel.informants) cartel.informants = {};
        cartel.informants[target.id] = { turnsRemaining: randInt(4, 8) };
        log(`${cartel.name} recluta un informante dentro de ${target.name}: tus próximos golpes contra ellos irán mejor informados.`, "event");
        return { ok: true, success: true };
      }
      r.heat = Math.min(100, r.heat + randInt(5, 12));
      const status = cartel.relations[target.id]?.status || "neutral";
      const tension = clamp((cartel.relations[target.id]?.tension || 30) + randInt(8, 16), 0, 100);
      cartel.relations[target.id] = { status, tension };
      target.relations[cartelId] = { status, tension };
      log(`El intento de infiltrar a ${target.name} fracasa y despierta sus sospechas.`, "event");
      return { ok: true, success: false };
    }
    case "poach_member": {
      const cost = ACTION_COSTS.poach_member;
      if (r.money < cost) return { ok: false, message: "No hay dinero suficiente." };
      const target = game.characters[payload.targetCharacterId];
      const targetCartel = target ? game.cartels[target.cartelId] : null;
      if (!target || !target.alive || target.imprisoned || !targetCartel || targetCartel.id === cartelId || targetCartel.destroyed) {
        return { ok: false, message: "Objetivo no válido." };
      }
      if (targetCartel.roles.leader === target.id) {
        return { ok: false, message: "El líder de un cártel no se deja reclutar así." };
      }
      r.money -= cost;
      const recruiter = game.characters[cartel.roles.diplomatChief] || game.characters[cartel.roles.intelChief];
      const persuasion = recruiter ? (recruiter.stats.charisma + recruiter.stats.intrigue) / 2 : 40;
      const loyalty = target.stats.loyaltyInspiring + ((target.bondWithPlayer ?? 50) - 50) / 2;
      const atWarWithThem = (targetCartel.relations[cartelId]?.status || "neutral") === "war";
      let successChance = clamp(0.3 + (persuasion - loyalty) / 150, 0.1, 0.6);
      // A cartel already at war and bleeding is a much easier place to poach a defector from.
      if (atWarWithThem) successChance = clamp(successChance + 0.12, 0.1, 0.7);
      const bumpTension = (delta) => {
        const status = cartel.relations[targetCartel.id]?.status || "neutral";
        const tension = clamp((cartel.relations[targetCartel.id]?.tension || 30) + delta, 0, 100);
        cartel.relations[targetCartel.id] = { status, tension };
        targetCartel.relations[cartelId] = { status, tension };
      };
      if (chance(successChance)) {
        vacateRole(game, targetCartel.id, target.id);
        fillVacantRoles(targetCartel, game.characters, currentYear(game));
        targetCartel.characters = targetCartel.characters.filter((id) => id !== target.id);
        target.cartelId = cartelId;
        target.role = null;
        target.bondWithPlayer = 50;
        cartel.characters.push(target.id);
        bumpTension(randInt(20, 35));
        log(`${target.name} deja ${targetCartel.name} y se une a ${cartel.name}.`, "good");
        if (game._reactiveEvents && targetCartel.id === game.playerCartelId) {
          game._reactiveEvents.push({ type: "poached", byCartelId: cartel.id, byCartelName: cartel.name, characterName: target.name, success: true });
        }
        return { ok: true, success: true };
      }
      r.heat = Math.min(100, r.heat + randInt(5, 12));
      bumpTension(randInt(10, 20));
      log(`El intento de ${cartel.name} de reclutar a ${target.name} fracasa y expone la maniobra.`, "event");
      if (game._reactiveEvents && targetCartel.id === game.playerCartelId) {
        game._reactiveEvents.push({ type: "poached", byCartelId: cartel.id, byCartelName: cartel.name, characterName: target.name, success: false });
      }
      return { ok: true, success: false };
    }
    case "raid_territory": {
      const cost = ACTION_COSTS.raid_territory;
      const territory = game.territories[payload.territoryId];
      if (!territory || !territory.controllerId || territory.controllerId === cartelId) {
        return { ok: false, message: "Objetivo no válido." };
      }
      if (!isAttackable(game, cartelId, territory.id)) {
        return { ok: false, message: "Ese territorio no linda con ninguno de tus dominios." };
      }
      if (r.money < cost) return { ok: false, message: "No hay dinero suficiente." };
      const defender = game.cartels[territory.controllerId];
      r.money -= cost;
      const casualties = Math.round(defender.resources.armySize * randInt(2, 8) / 100);
      defender.resources.armySize = Math.max(0, defender.resources.armySize - casualties);
      territory.value = Math.max(1, territory.value - randInt(1, 3));
      defender.resources.heat = Math.min(100, defender.resources.heat + randInt(4, 9));
      r.heat = Math.min(100, r.heat + randInt(3, 7));
      const status = cartel.relations[defender.id]?.status || "neutral";
      const tension = clamp((cartel.relations[defender.id]?.tension || 30) + randInt(8, 18), 0, 100);
      cartel.relations[defender.id] = { status, tension };
      defender.relations[cartelId] = { status, tension };
      log(`${cartel.name} realiza una redada contra instalaciones de ${defender.name} en ${territory.name}, dejando ${casualties} bajas y dañando la zona.`, "event");
      return { ok: true, casualties, newValue: territory.value };
    }
    case "intimidate_territory": {
      // Deliberately distinct from raid_territory: a loud, public show of force with no armed
      // clash and no casualties on either side — think burned trucks, threatening messages, a
      // convoy parading through the plaza — that scares local business away and damages the
      // rival's standing there, instead of physically destroying anything.
      const cost = ACTION_COSTS.intimidate_territory;
      const territory = game.territories[payload.territoryId];
      if (!territory || !territory.controllerId || territory.controllerId === cartelId) {
        return { ok: false, message: "Objetivo no válido." };
      }
      if (!isAttackable(game, cartelId, territory.id)) {
        return { ok: false, message: "Ese territorio no linda con ninguno de tus dominios." };
      }
      if (r.money < cost) return { ok: false, message: "No hay dinero suficiente." };
      const defender = game.cartels[territory.controllerId];
      r.money -= cost;
      const enforcer = game.characters[cartel.roles.sicariosChief];
      const threatSkill = (enforcer ? enforcer.stats.violence : 40) + (r.armySize - defender.resources.armySize) / 40;
      const successChance = clamp(0.5 + (threatSkill - 50) / 250 - defender.resources.corruptPolice / 300, 0.2, 0.85);
      const status = cartel.relations[defender.id]?.status || "neutral";
      if (chance(successChance)) {
        defender.resources.publicImage = Math.max(0, defender.resources.publicImage - randInt(8, 15));
        territory.value = Math.max(1, territory.value - randInt(1, 2));
        defender.resources.heat = Math.min(100, defender.resources.heat + randInt(2, 5));
        r.heat = Math.min(100, r.heat + randInt(6, 12));
        const tension = clamp((cartel.relations[defender.id]?.tension || 30) + randInt(6, 14), 0, 100);
        cartel.relations[defender.id] = { status, tension };
        defender.relations[cartelId] = { status, tension };
        log(`${cartel.name} intimida abiertamente a ${defender.name} en ${territory.name}, dañando su reputación local sin derramar sangre.`, "event");
        if (game._reactiveEvents && defender.id === game.playerCartelId) {
          game._reactiveEvents.push({ type: "intimidated", byCartelId: cartel.id, byCartelName: cartel.name, territoryName: territory.name, success: true });
        }
        return { ok: true, success: true, newValue: territory.value };
      }
      r.heat = Math.min(100, r.heat + randInt(12, 20));
      const tension = clamp((cartel.relations[defender.id]?.tension || 30) + randInt(10, 20), 0, 100);
      cartel.relations[defender.id] = { status, tension };
      defender.relations[cartelId] = { status, tension };
      log(`El intento de ${cartel.name} de intimidar a ${defender.name} en ${territory.name} fracasa y expone la amenaza.`, "event");
      if (game._reactiveEvents && defender.id === game.playerCartelId) {
        game._reactiveEvents.push({ type: "intimidated", byCartelId: cartel.id, byCartelName: cartel.name, territoryName: territory.name, success: false });
      }
      return { ok: true, success: false };
    }
    case "invest_property": {
      const cost = ACTION_COSTS.invest_property;
      if (r.money < cost) return { ok: false, message: "No hay dinero suficiente." };
      r.money -= cost;
      const gained = Math.round((30 + randInt(0, 20)) * MONEY_SCALE);
      r.propertyIncome = (r.propertyIncome || 0) + gained;
      r.heat = Math.min(100, r.heat + randInt(1, 3));
      log(`${cartel.name} adquiere propiedades que generan ${fmtMoney(gained)} adicionales cada turno.`, "good");
      return { ok: true, propertyIncome: r.propertyIncome };
    }
    case "invest_art": {
      const cost = ACTION_COSTS.invest_art;
      if (r.money < cost) return { ok: false, message: "No hay dinero suficiente." };
      r.money -= cost;
      const gained = Math.round(cost * (0.9 + Math.random() * 0.3));
      r.artValue = (r.artValue || 0) + gained;
      r.heat = Math.min(100, r.heat + 1);
      log(`${cartel.name} invierte en arte y coleccionables por valor de ${fmtMoney(gained)}, una vía clásica de lavado.`, "good");
      return { ok: true, artValue: r.artValue };
    }
    case "sell_art": {
      const held = r.artValue || 0;
      if (held <= 0) return { ok: false, message: "No tienes arte que vender." };
      const seizeChance = clamp(r.heat / 300, 0.03, 0.3);
      if (chance(seizeChance)) {
        const seized = Math.round(held * (0.2 + Math.random() * 0.3));
        r.artValue = 0;
        r.money += held - seized;
        r.heat = Math.min(100, r.heat + randInt(5, 10));
        log(`Al vender su colección, ${cartel.name} sufre un decomiso parcial de ${fmtMoney(seized)}.`, "event");
        return { ok: true, seized, received: held - seized };
      }
      r.artValue = 0;
      r.money += held;
      r.heat = Math.max(0, r.heat - randInt(2, 5));
      log(`${cartel.name} vende su colección de arte por ${fmtMoney(held)} sin llamar la atención.`, "good");
      return { ok: true, received: held };
    }
    case "invest_business": {
      const cost = ACTION_COSTS.invest_business;
      if (r.money < cost) return { ok: false, message: "No hay dinero suficiente." };
      r.money -= cost;
      const gained = Math.round((35 + randInt(0, 15)) * MONEY_SCALE);
      r.businessIncome = (r.businessIncome || 0) + gained;
      r.heat = Math.max(0, r.heat - randInt(3, 6));
      log(`${cartel.name} monta un negocio legal de fachada: ${fmtMoney(gained)} más por turno y menos sospechas.`, "good");
      return { ok: true, businessIncome: r.businessIncome };
    }
    case "invest_weapons": {
      const cost = ACTION_COSTS.invest_weapons;
      if (r.money < cost) return { ok: false, message: "No hay dinero suficiente." };
      r.money -= cost;
      r.weaponsBonus = clamp((r.weaponsBonus || 0) + 0.02, 0, 0.3);
      r.heat = Math.min(100, r.heat + randInt(2, 5));
      log(`${cartel.name} arma y equipa mejor a su gente (bonificación de combate: +${Math.round(r.weaponsBonus * 100)}%).`, "good");
      return { ok: true, weaponsBonus: r.weaponsBonus };
    }
    case "invest_security": {
      const cost = ACTION_COSTS.invest_security;
      if (r.money < cost) return { ok: false, message: "No hay dinero suficiente." };
      r.money -= cost;
      r.securityBonus = clamp((r.securityBonus || 0) + 0.03, 0, 0.3);
      log(`${cartel.name} refuerza la seguridad privada de su líder (reduce en ${Math.round(r.securityBonus * 100)}% la probabilidad de que un atentado contra él/ella tenga éxito).`, "good");
      return { ok: true, securityBonus: r.securityBonus };
    }
    case "invest_hideout": {
      const cost = ACTION_COSTS.invest_hideout;
      if (r.money < cost) return { ok: false, message: "No hay dinero suficiente." };
      r.money -= cost;
      r.hideoutBonus = clamp((r.hideoutBonus || 0) + 0.03, 0, 0.3);
      log(`${cartel.name} habilita un refugio con vías de escape (mejora en ${Math.round(r.hideoutBonus * 100)}% tus probabilidades de esquivar una redada o de fugarte con éxito).`, "good");
      return { ok: true, hideoutBonus: r.hideoutBonus };
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
  const base = weight ? clamp(0.7 + (total / weight / 100) * 0.6, 0.7, 1.3) : 1;
  // Better-armed troops (invest_weapons) fight more effectively, on top of command quality.
  return base * (1 + (cartel.resources.weaponsBonus || 0));
}

function resolveBattle(game, attacker, defender, territory) {
  const log = (t, ty) => addLog(game, t, ty);
  const war = openWar(game, attacker.id, defender.id);
  const bonus = attacker.surpriseStrikeBonus;
  const hasSurpriseBonus = bonus && bonus.targetId === defender.id && bonus.turn === game.turn;
  if (hasSurpriseBonus) attacker.surpriseStrikeBonus = null; // one-time use, consumed on the first attack against that target this turn
  // A well-developed territory (high value) is harder to take than a rundown one, regardless of
  // the overall balance of forces — local infrastructure/entrenchment adds real defense.
  const fortBonus = 1 + territory.value / 150;
  const atkPower = attacker.resources.armySize * commanderMultiplier(game, attacker) * (0.85 + Math.random() * 0.3) * (hasSurpriseBonus ? 1.25 : 1) * warFocusMultiplier(attacker, defender.id);
  const defPower = defender.resources.armySize * commanderMultiplier(game, defender) * (1.0 + Math.random() * 0.3) * fortBonus * warFocusMultiplier(defender, attacker.id);
  const attackerWins = atkPower > defPower;
  const casualtiesAtk = Math.round(attacker.resources.armySize * randInt(3, 15) / 100 * (1 + territory.value / 300));
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

  const surpriseNote = hasSurpriseBonus ? " El factor sorpresa de su reciente declaración de guerra les da ventaja." : "";
  if (attackerWins) {
    territory.controllerId = attacker.id;
    attacker.territories.push(territory.id);
    defender.territories = defender.territories.filter((t) => t !== territory.id);
    war.territoryChanges.push({ year: currentYear(game), territoryName: territory.name, to: attacker.id });
    log(`${attacker.name} conquista ${territory.name} tras derrotar a ${defender.name}.${surpriseNote}`, "event");
    if (game._reactiveEvents && defender.id === game.playerCartelId) {
      game._reactiveEvents.push({ type: "territoryLost", territoryId: territory.id, territoryName: territory.name, toCartelId: attacker.id, toCartelName: attacker.name });
    }
  } else {
    log(`${attacker.name} fracasa en su intento de tomar ${territory.name}.${surpriseNote}`, "event");
  }

  // Small chance a commander dies in the fighting.
  for (const [side, roleKeys] of [[attacker, ["militaryChief", "sicariosChief"]], [defender, ["militaryChief", "sicariosChief"]]]) {
    for (const roleKey of roleKeys) {
      const holder = game.characters[side.roles[roleKey]];
      if (holder && holder.alive && chance(0.04)) {
        holder.alive = false;
        holder.deathYear = currentYear(game);
        holder.deathCause = `un enfrentamiento armado por ${territory.name}`;
        log(`${holder.name} muere en el enfrentamiento por ${territory.name}.`, "death");
      }
    }
  }

  return { attackerWins, casualtiesAtk, casualtiesDef };
}

/** Neither side at war can currently reach the other: rather than let two AI cartels stay locked
 * in an unresolvable war forever, growing war-weariness gives them a chance to negotiate an end
 * to it, scaled by how many years the stalemate has dragged on. Left alone for wars involving the
 * player — ending those still requires an explicit propose_peace from them. */
function attemptWarWeariness(game, cartel, other) {
  if (cartel.id === game.playerCartelId || other.id === game.playerCartelId) return;
  const war = (game.warHistory || []).find((w) => w.key === warKey(cartel.id, other.id) && w.endYear === null);
  if (!war) return;
  const yearsAtWar = currentYear(game) - war.startYear;
  if (yearsAtWar < 2) return; // give a stalemate a couple of years before exhaustion can end it
  const wearinessChance = clamp(0.05 + yearsAtWar * 0.03, 0.05, 0.4);
  if (!chance(wearinessChance)) return;
  cartel.relations[other.id] = { status: "neutral", tension: 40 };
  other.relations[cartel.id] = { status: "neutral", tension: 40 };
  closeWar(game, cartel.id, other.id, "Ambos bandos negocian la paz, exhaustos tras años de conflicto sin un vencedor claro.");
  addLog(game, `${cartel.name} y ${other.name} negocian la paz, exhaustos tras años de guerra sin un vencedor claro.`, "event");
}

export function autoResolveWars(game) {
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
      if (!reachable.length) {
        attemptWarWeariness(game, cartel, other);
        continue; // no shared border yet: the war stays cold this turn
      }
      resolveBattle(game, atk, def, game.territories[pick(reachable)]);
    }
  }
}

const CARTEL_COLORS = ["#8a5a2b", "#3a7a5a", "#7a3a5a", "#4a5a8a", "#8a7a2b", "#5a3a8a", "#2b8a7a", "#8a2b4a"];

/** Long-neutral territories can spawn a brand-new, small AI-controlled cartel — someone always
 * moves into a power vacuum. Modest odds per unclaimed territory per turn, so it thins out over
 * a long game rather than flooding the map immediately. */
export function rollNewCartelSpawns(game, year) {
  const cartelIds = Object.keys(game.cartels);
  for (const territory of Object.values(game.territories)) {
    if (territory.controllerId) continue;
    if (!chance(0.04)) continue;

    const newId = uid("cartel");
    const leader = generateNpc({ cartelId: newId, role: "leader", currentYear: year, minAge: 28, maxAge: 55 });
    game.characters[leader.id] = leader;
    territory.controllerId = newId;

    const cartel = makeCartel({
      id: newId,
      name: `Cártel de ${territory.name}`,
      color: pick(CARTEL_COLORS),
      eraId: game.eraId,
      territories: [territory.id],
      resources: {
        money: territory.value * 30 * MONEY_SCALE,
        armySize: randInt(40, 90),
        corruptGov: randInt(5, 15),
        corruptPolice: randInt(5, 15),
        publicImage: randInt(20, 40),
        heat: randInt(5, 15),
        internationalReputation: 5,
        launderedMoney: 0,
      },
      roles: { leader: leader.id },
      characters: [leader.id],
      aiControlled: true,
      historicalNote: "Organización ficticia surgida durante la partida para ocupar un vacío de poder territorial.",
    });
    game.cartels[newId] = cartel;
    fillVacantRoles(cartel, game.characters, year);

    cartel.relations = {};
    for (const otherId of cartelIds) {
      const other = game.cartels[otherId];
      if (other.destroyed) continue;
      const tension = randInt(15, 45);
      cartel.relations[otherId] = { status: "neutral", tension };
      other.relations[newId] = { status: "neutral", tension };
    }
    cartelIds.push(newId);

    addLog(game, `${cartel.name} surge en ${territory.name}, aprovechando el vacío de poder tras la caída de sus antiguos dueños.`, "event");
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
    if (rivalCartels.length && r.money >= ACTION_COSTS.sabotage_rival) {
      options.push({ item: "sabotage_rival", weight: 1 });
    }
    if (rivalCartels.length && r.money >= ACTION_COSTS.intercept_shipment) {
      options.push({ item: "intercept_shipment", weight: atWar ? 1.5 : 0.7 });
    }
    const informantTargets = rivalCartels.filter((c) => !hasActiveInformant(cartel, c.id));
    if (informantTargets.length && r.money >= ACTION_COSTS.recruit_informant) {
      options.push({ item: "recruit_informant", weight: atWar ? 1.2 : 0.6 });
    }
    const poachTargets = rivalCartels.flatMap((rc) =>
      ROLE_ORDER.filter((role) => role !== "leader")
        .map((role) => rc.roles[role])
        .filter((id, i, arr) => id && arr.indexOf(id) === i)
        .map((id) => game.characters[id])
        .filter((holder) => holder && holder.alive)
    );
    if (poachTargets.length && r.money >= ACTION_COSTS.poach_member) {
      options.push({ item: "poach_member", weight: 0.5 });
    }
    const raidable = rivalCartels.flatMap((c) => c.territories.filter((tId) => isAttackable(game, cartel.id, tId)));
    if (raidable.length && r.money >= ACTION_COSTS.raid_territory) {
      options.push({ item: "raid_territory", weight: atWar ? 2 : 0.8 });
    }
    if (raidable.length && r.money >= ACTION_COSTS.intimidate_territory) {
      options.push({ item: "intimidate_territory", weight: atWar ? 1 : 1.2 });
    }
    if (r.money >= ACTION_COSTS.invest_property) options.push({ item: "invest_property", weight: 1.5 });
    if (r.money >= ACTION_COSTS.invest_art) options.push({ item: "invest_art", weight: 1 });
    if (r.artValue > 0) options.push({ item: "sell_art", weight: r.money < ACTION_COSTS.recruit_army ? 3 : 0.5 });
    if (r.money >= ACTION_COSTS.invest_business) options.push({ item: "invest_business", weight: 1.5 });
    if (r.money >= ACTION_COSTS.invest_weapons && (r.weaponsBonus || 0) < 0.3) options.push({ item: "invest_weapons", weight: atWar ? 2 : 0.8 });
    if (r.money >= ACTION_COSTS.invest_security && (r.securityBonus || 0) < 0.3) options.push({ item: "invest_security", weight: atWar ? 1.2 : 0.6 });
    if (r.money >= ACTION_COSTS.invest_hideout && (r.hideoutBonus || 0) < 0.3) options.push({ item: "invest_hideout", weight: r.heat > 50 ? 1.2 : 0.5 });

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
      const avengerHitman = game.characters[cartel.roles.sicariosChief];
      const vendettaTarget = avengerHitman && avengerHitman.vendetta
        ? rivalCartels.find((c) => c.id === avengerHitman.vendetta.targetCartelId)
        : null;
      const target = vendettaTarget && chance(0.7) ? vendettaTarget : (rivalCartels.length ? pick(rivalCartels) : null);
      const targetChar = target ? game.characters[target.roles.leader] : null;
      if (targetChar && targetChar.alive) {
        applyAction(game, cartel.id, "assassinate_rival", { targetCharacterId: targetChar.id });
        continue;
      }
      choice = "corrupt_police";
      if (!canAfford(cartel, choice)) continue;
    }
    if (choice === "sabotage_rival") {
      const target = rivalCartels.length ? pick(rivalCartels) : null;
      if (target) {
        applyAction(game, cartel.id, "sabotage_rival", { targetCartelId: target.id });
        continue;
      }
      choice = "corrupt_gov";
      if (!canAfford(cartel, choice)) continue;
    }
    if (choice === "intercept_shipment") {
      const target = rivalCartels.length ? pick(rivalCartels) : null;
      if (target) {
        applyAction(game, cartel.id, "intercept_shipment", { targetCartelId: target.id });
        continue;
      }
      choice = "corrupt_police";
      if (!canAfford(cartel, choice)) continue;
    }
    if (choice === "recruit_informant") {
      const target = informantTargets.length ? pick(informantTargets) : null;
      if (target) {
        applyAction(game, cartel.id, "recruit_informant", { targetCartelId: target.id });
        continue;
      }
      choice = "corrupt_police";
      if (!canAfford(cartel, choice)) continue;
    }
    if (choice === "raid_territory") {
      if (raidable.length) {
        applyAction(game, cartel.id, "raid_territory", { territoryId: pick(raidable) });
        continue;
      }
      choice = "recruit_army";
      if (!canAfford(cartel, choice)) continue;
    }
    if (choice === "intimidate_territory") {
      if (raidable.length) {
        applyAction(game, cartel.id, "intimidate_territory", { territoryId: pick(raidable) });
        continue;
      }
      choice = "recruit_army";
      if (!canAfford(cartel, choice)) continue;
    }
    if (choice === "poach_member") {
      const targetChar = poachTargets.length ? pick(poachTargets) : null;
      if (targetChar) {
        applyAction(game, cartel.id, "poach_member", { targetCharacterId: targetChar.id });
        continue;
      }
      choice = "corrupt_gov";
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

/** Informants planted via recruit_informant expire after a few turns. */
function decayInformants(game) {
  for (const cartel of Object.values(game.cartels)) {
    if (!cartel.informants) continue;
    for (const targetId of Object.keys(cartel.informants)) {
      cartel.informants[targetId].turnsRemaining -= 1;
      if (cartel.informants[targetId].turnsRemaining <= 0) delete cartel.informants[targetId];
    }
  }
}

function decayWarFocus(game) {
  for (const cartel of Object.values(game.cartels)) {
    if (!cartel.warFocus) continue;
    cartel.warFocus.turnsRemaining -= 1;
    if (cartel.warFocus.turnsRemaining <= 0) cartel.warFocus = null;
  }
}

/** A vendetta (see assassinate_rival) that's never acted on fades after a few years — grief
 * doesn't stay sharp forever. */
function decayVendettas(game) {
  for (const c of Object.values(game.characters)) {
    if (!c.vendetta || !c.alive) continue;
    if (game.turn - c.vendetta.sinceTurn >= VENDETTA_EXPIRY_TURNS) {
      c.vendetta = null;
    }
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
  const propertyIncome = cartel.resources.propertyIncome || 0;
  const businessIncome = cartel.resources.businessIncome || 0;
  const passiveIncome = propertyIncome + businessIncome;
  const upkeep = Math.round(cartel.resources.armySize * 0.45 * MONEY_SCALE);
  return {
    perTerritory, baseIncome, exportBonusRate, exportBonus, territoryIncome,
    propertyIncome, businessIncome, passiveIncome, upkeep,
    net: territoryIncome + passiveIncome - upkeep,
  };
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
    // Art and collectibles quietly appreciate while held, a classic laundering vehicle.
    if (cartel.resources.artValue) {
      cartel.resources.artValue = Math.round(cartel.resources.artValue * (1 + randInt(1, 3) / 100));
    }
  }
}

const LANDLESS_COLLAPSE_TURNS = 4;

/** A cartel that's held zero territories for several turns running dissolves instead of lingering
 * forever as an inert "zombie" with residual money/army and nothing to actually run — the same
 * pattern already used for a leaderless cartel with no eligible heir. Gives a grace period (a
 * couple of years, depending on the era's turn length) to reconquer or occupy something first. */
export function checkLandlessCollapse(game) {
  for (const cartel of Object.values(game.cartels)) {
    if (cartel.destroyed) continue;
    if (cartel.territories.length === 0) {
      cartel.turnsWithoutTerritory = (cartel.turnsWithoutTerritory || 0) + 1;
      if (cartel.turnsWithoutTerritory >= LANDLESS_COLLAPSE_TURNS) {
        cartel.destroyed = true;
        addLog(game, `${cartel.name} se disuelve tras años sin territorio propio: sus miembros se dispersan o son absorbidos por otros grupos.`, "death");
        if (cartel.id === game.playerCartelId) {
          game.gameOver = true;
          game.gameOverReason = "no-territory";
        }
      }
    } else {
      cartel.turnsWithoutTerritory = 0;
    }
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

/** Resolves each coup from rollLoyaltyEvents into either a leadership death or a foiled attempt.
 * Same principle as the scripted historical events and rollMortality: escalation that would kill
 * the player's own character instead gives them a heavy (55%) chance to survive it. Returns death
 * entries in the same shape as rollMortality/rollScriptedEvents for endTurn's succession handling. */
export function resolveCoups(game, coups, year) {
  const deaths = [];
  for (const coup of coups) {
    const ally = coup.allyId ? game.characters[coup.allyId] : null;
    const withAlly = ally ? ` con la ayuda de su aliado ${ally.name}` : "";
    if (chance(0.4)) {
      const leader = game.characters[coup.leaderId];
      if (leader.id === game.playerCharacterId && chance(0.55)) {
        addLog(game, `Sobrevives por poco al golpe interno liderado por ${game.characters[coup.plotterId].name}${withAlly}.`, "good");
        continue;
      }
      leader.alive = false;
      leader.deathYear = year;
      leader.deathCause = `un golpe interno liderado por ${game.characters[coup.plotterId].name}`;
      addLog(game, `${leader.name} muere en un intento de golpe interno liderado por ${game.characters[coup.plotterId].name}${withAlly}.`, "death");
      deaths.push({ characterId: coup.leaderId, cartelId: coup.cartelId, wasLeader: true });
    } else {
      addLog(game, `Se frustra un intento de traición contra el liderazgo de ${game.cartels[coup.cartelId].name}${withAlly}.`, "event");
    }
  }
  return deaths;
}

export function endTurn(game) {
  if (game.gameOver) return { pendingSuccession: null, pendingRegentChoice: null, gameOver: true };
  const year = currentYear(game);
  const startIndex = game.log.length;
  game._reactiveEvents = [];

  runAiCartels(game);
  autoResolveWars(game);
  rollNewCartelSpawns(game, year);
  const deaths = rollMortality(game, (t, ty) => addLog(game, t, ty), year);
  if (game._pendingPlayerDeath) {
    deaths.push(game._pendingPlayerDeath);
    game._pendingPlayerDeath = null;
  }
  rollFamilyEvents(game, (t, ty) => addLog(game, t, ty), year);
  deaths.push(...rollSiblingRivalry(game, (t, ty) => addLog(game, t, ty), year));
  processPregnancies(game);
  const coups = rollLoyaltyEvents(game, (t, ty) => addLog(game, t, ty));
  deaths.push(...resolveCoups(game, coups, year));
  const scriptedResult = rollScriptedEvents(game, (t, ty) => addLog(game, t, ty), year);
  deaths.push(...scriptedResult.deaths);
  const policeResult = rollPoliceOperations(game, (t, ty) => addLog(game, t, ty), year);
  const arrests = [...policeResult.arrests, ...scriptedResult.arrests];
  incomeTick(game);
  checkLandlessCollapse(game);
  driftBonds(game);
  driftMemberBonds(game);
  decayInformants(game);
  decayWarFocus(game);
  decayVendettas(game);

  let pendingSuccession = null;
  let pendingRegentChoice = null;

  for (const d of deaths) {
    if (d.characterId === game.playerCharacterId) {
      pendingSuccession = { deceasedId: d.characterId, cartelId: d.cartelId, reason: d.reason === "atentado" ? "atentado" : "death" };
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
  const pendingRaidTip = !pendingSuccession && !pendingRegentChoice && !pendingMarriageEvent && policeResult.pendingRaidTip ? {} : null;
  const pendingScriptedChoice = !pendingSuccession && !pendingRegentChoice && !pendingMarriageEvent && !pendingRaidTip ? scriptedResult.pendingChoice : null;
  const significantEvents = collectSignificantPlayerEvents(game, startIndex);
  const reactiveEvents = game._reactiveEvents || [];
  delete game._reactiveEvents; // transient, turn-scoped only — not part of persisted save state
  delete game._pendingPlayerDeath; // same: consumed into `deaths` above, never persisted

  game.turn += 1;
  game.year = currentYear(game);
  game.actionsUsedThisTurn = 0;
  if (game.year >= game.endYear && !pendingSuccession && !game.gameOver) {
    game.gameOver = true;
    game.gameOverReason = "era-end";
  }
  recordHistory(game);

  return {
    newLogs: game.log.slice(startIndex),
    pendingSuccession,
    pendingRegentChoice,
    pendingMarriageEvent,
    pendingRaidTip,
    pendingScriptedChoice,
    significantEvents,
    reactiveEvents,
    gameOver: game.gameOver,
  };
}

/** Turn-resolution events (AI attacks, sabotage, raids, assassination attempts, battles) that
 * name the player's cartel or one of its people. Surfaced as a "what happened" modal so a busy
 * turn doesn't just silently resolve in the background — the player notices rivals moving
 * against them instead of finding out by accident from the stats a few turns later. */
export function collectSignificantPlayerEvents(game, startIndex) {
  const cartel = game.cartels[game.playerCartelId];
  if (!cartel) return [];
  const needles = [cartel.name];
  for (const id of cartel.characters) {
    const c = game.characters[id];
    if (c) needles.push(c.name);
  }
  const seen = new Set();
  const events = [];
  for (const entry of game.log.slice(startIndex)) {
    if (seen.has(entry.text) || !needles.some((n) => n && entry.text.includes(n))) continue;
    seen.add(entry.text);
    events.push(entry);
  }
  return events;
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
export function processPregnancies(game) {
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

/** Resolves a pending police-raid tip-off against the player's own character (see
 * rollPoliceOperations). Returns { pendingRegentChoice, pendingSuccession } — both null unless
 * the raid ends up going through and results in an arrest, mirroring how endTurn's own arrests
 * loop handles a player-character arrest. */
export function resolveRaidTip(game, action) {
  const player = getPlayerCharacter(game);
  const cartel = getPlayerCartel(game);
  if (!player || !cartel) return { pendingRegentChoice: null, pendingSuccession: null };
  const r = cartel.resources;

  if (action === "hide") {
    r.heat = Math.min(100, r.heat + randInt(2, 6));
    addLog(game, `${player.name} se esconde a tiempo gracias al aviso y evita la redada.`, "good");
    return { pendingRegentChoice: null, pendingSuccession: null };
  }

  if (action === "bribe") {
    const fullCost = 150 * MONEY_SCALE;
    const spend = Math.min(r.money, fullCost);
    r.money -= spend;
    const bribeChance = clamp((0.3 + r.corruptPolice / 200) * (spend / fullCost), 0.05, 0.85);
    if (chance(bribeChance)) {
      addLog(game, `${player.name} soborna a tiempo a los agentes y frena el operativo en el último momento.`, "good");
      return { pendingRegentChoice: null, pendingSuccession: null };
    }
    addLog(game, `El soborno de última hora no basta para frenar el operativo contra ${player.name}.`, "event");
  }

  // "risk", or a bribe that failed: the raid goes ahead exactly as an unwarned one would.
  const heat = r.heat;
  r.armySize = Math.max(0, Math.round(r.armySize * (1 - randInt(2, 12) / 100)));
  const resistChance = clamp((r.corruptPolice - heat * 0.3) / 150, 0.05, 0.7);
  if (chance(resistChance)) {
    addLog(game, `El operativo contra ${player.name} fracasa gracias a la corrupción policial.`, "event");
    return { pendingRegentChoice: null, pendingSuccession: null };
  }
  const lifeSentenceChance = clamp((player.stats.violence + heat) / 260, 0.1, 0.85);
  const lifeSentence = chance(lifeSentenceChance);
  const releaseTurn = lifeSentence ? null : game.turn + randInt(6, 30);
  player.imprisoned = { sinceTurn: game.turn, releaseTurn, lifeSentence };
  addLog(game, `${player.name} ha sido arrestado/a. ${lifeSentence ? "Enfrenta cadena perpetua." : "Podría salir en libertad en el futuro."}`, "death");
  r.heat = Math.max(0, r.heat - randInt(10, 25));

  if (lifeSentence) {
    return { pendingRegentChoice: null, pendingSuccession: { deceasedId: player.id, cartelId: cartel.id, reason: "arrest-life" } };
  }
  return { pendingRegentChoice: { characterId: player.id, cartelId: cartel.id, releaseTurn }, pendingSuccession: null };
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

  const lifeSentence = original.imprisoned.lifeSentence;
  // Real max-security escapes (like El Chapo's 2001 and 2015 breakouts) are vanishingly rare but
  // not fictional, so a life sentence is now brutally hard rather than flatly impossible: the
  // chance is capped far lower, and a failed attempt draws a much harsher crackdown.
  let successChance = lifeSentence
    ? clamp((original.stats.stealth * 0.4 + original.stats.intrigue * 0.35 + cartel.resources.corruptPolice * 0.25) / 100 - 0.35, 0.02, 0.15)
    : clamp((original.stats.stealth * 0.4 + original.stats.intrigue * 0.35 + cartel.resources.corruptPolice * 0.25) / 100 - 0.1, 0.05, 0.75);
  // A refuge with real escape routes (invest_hideout) gives a fleeing prisoner somewhere to
  // actually run to, on top of whatever their own stats and the cartel's corruption already give them.
  if (cartel.resources.hideoutBonus) {
    successChance = lifeSentence
      ? clamp(successChance + cartel.resources.hideoutBonus, 0.02, 0.3)
      : clamp(successChance + cartel.resources.hideoutBonus, 0.05, 0.9);
  }

  if (chance(successChance)) {
    original.imprisoned = null;
    restorePlayerLeadership(game);
    cartel.resources.heat = Math.min(100, cartel.resources.heat + randInt(20, 30));
    addLog(
      game,
      lifeSentence
        ? `${original.name} protagoniza una fuga histórica de una prisión de máxima seguridad, algo que casi nunca ocurre en la vida real, y recupera el control de ${cartel.name}. La noticia da la vuelta al mundo.`
        : `${original.name} protagoniza una fuga espectacular y recupera el control de ${cartel.name}. La noticia recorre el país.`,
      "good"
    );
    return { ok: true, success: true };
  }

  if (lifeSentence) {
    cartel.resources.heat = Math.min(100, cartel.resources.heat + randInt(10, 20));
    addLog(game, `El intento de fuga de ${original.name} de una prisión de máxima seguridad fracasa: lo trasladan a una celda de aislamiento y la vigilancia se redobla.`, "event");
    return { ok: true, success: false };
  }

  const extra = randInt(4, 10);
  original.imprisoned.releaseTurn = (original.imprisoned.releaseTurn ?? game.turn) + extra;
  addLog(game, `El intento de fuga de ${original.name} fracasa: la condena se alarga.`, "event");
  return { ok: true, success: false };
}
