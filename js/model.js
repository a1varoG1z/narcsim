import { uid, randInt } from "./utils/random.js";

export const ROLES = {
  leader: "Líder del cártel",
  underboss: "Segundo al mando",
  sicariosChief: "Jefe de sicarios",
  militaryChief: "Jefe de ejército / paramilitar",
  corruptionGovChief: "Jefe de corrupción política",
  corruptionPoliceChief: "Jefe de corrupción policial/militar",
  traffickingChief: "Jefe de narcotráfico y rutas",
  productionChief: "Jefe de producción",
  financeChief: "Jefe económico / lavado",
  prChief: "Jefe de imagen pública",
  intelChief: "Jefe de inteligencia",
  diplomatChief: "Jefe de relaciones externas",
};

export const ROLE_ORDER = Object.keys(ROLES);

export const STATS = {
  violence: "Violencia",
  business: "Negocios",
  charisma: "Carisma",
  intrigue: "Astucia",
  loyaltyInspiring: "Liderazgo",
  stealth: "Sigilo",
};

export const STAT_ORDER = Object.keys(STATS);

export function randomStats(bias = {}) {
  const stats = {};
  for (const key of STAT_ORDER) {
    stats[key] = clampStat(randInt(30, 70) + (bias[key] || 0));
  }
  return stats;
}

export function clampStat(v) {
  return Math.max(1, Math.min(100, Math.round(v)));
}

export function makeCharacter({
  id, name, sex = "M", birthYear, deathYear = null, deathCause = null, alive = true,
  cartelId = null, role = null, stats = null, traits = [],
  portrait = null, parents = [], spouseId = null, childrenIds = [],
  historical = false, notes = "", imprisoned = null, vendetta = null,
} = {}) {
  return {
    id: id || uid("char"),
    name,
    sex,
    birthYear,
    deathYear,
    deathCause,
    alive,
    cartelId,
    role,
    stats: stats || randomStats(),
    traits,
    portrait,
    parents,
    spouseId,
    childrenIds,
    historical,
    notes,
    imprisoned, // { sinceTurn, releaseTurn, lifeSentence }
    vendetta, // { targetCartelId, sinceTurn } | null — a personal grudge over a slain relative
  };
}

export function makeCartel({
  id, name, color = "#8a2c2c", eraId, territories = [],
  resources = null, roles = {}, characters = [],
  relations = {}, aiControlled = true, historicalNote = "",
  targetTerritoryIds = [], supplyChainRole = null, roleLabels = {},
} = {}) {
  return {
    id: id || uid("cartel"),
    name,
    color,
    eraId,
    territories,
    targetTerritoryIds,
    // Optional real-world supply-chain role — "productor" (grows/refines but relies on others to
    // move it, e.g. Roberto Suárez supplying Colombian traffickers rather than exporting himself),
    // "transportista" (a logistics corridor, e.g. Panama under Noriega), "distribuidor" (moves
    // already-produced product to end markets without producing anything, e.g. Klaas Bruinsma). No
    // role (null) is the historical norm for most cartels in this game: they do the whole chain
    // themselves, same as before this existed.
    supplyChainRole,
    resources: resources || {
      money: 100,
      armySize: 100,
      corruptGov: 5,
      corruptPolice: 5,
      publicImage: 50,
      heat: 10,
    },
    roles,
    // Optional per-role display-label overrides (e.g. a bootlegging outfit calling its
    // traffickingChief "Jefe de rutas de contrabando" instead of the drug-specific default) —
    // see roleLabel() in ui/components.js, which checks this before falling back to ROLES.
    roleLabels,
    characters,
    relations,
    aiControlled,
    historicalNote,
    destroyed: false,
  };
}

export function makeTerritory({ id, name, x, y, w, h, controllerId = null, value = 10, unrest = 0 } = {}) {
  return { id, name, x, y, w, h, controllerId, value, unrest };
}

export function age(character, currentYear) {
  return currentYear - character.birthYear;
}

export function fullName(character) {
  return character ? character.name : "—";
}

export function statAverage(character) {
  const vals = STAT_ORDER.map((k) => character.stats[k]);
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}
