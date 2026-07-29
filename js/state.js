import { makeCharacter, makeCartel } from "./model.js";
import { fillVacantRoles } from "./npcGenerator.js";
import { uid, randInt } from "./utils/random.js";
import { saveGame, loadGame } from "./utils/storage.js";

const WAR_OVERRIDES = {
  "fragmentacion-2006-2015": [["zetas", "golfo"], ["sinaloa", "beltran_leyva"], ["familia_michoacana", "zetas"]],
  "cjng-sinaloa-2015-actualidad": [["cjng", "santa_rosa"]],
  "mexico-rutas-1990-2006": [["sinaloa", "tijuana"]],
};

export function buildGameFromEra(eraData, options) {
  const characters = {};
  for (const c of eraData.characters) {
    characters[c.id] = makeCharacter({ ...c });
  }

  const territories = {};
  for (const t of eraData.territories) {
    territories[t.id] = { ...t };
  }

  const cartels = {};
  for (const c of eraData.cartels) {
    const memberIds = eraData.characters.filter((ch) => ch.cartelId === c.id).map((ch) => ch.id);
    cartels[c.id] = makeCartel({
      ...c,
      territories: eraData.territories.filter((t) => t.controllerId === c.id).map((t) => t.id),
      characters: memberIds,
      roles: { ...c.roles },
      resources: { ...c.resources },
    });
  }

  let playerCartelId, playerCharacterId;

  if (options.mode === "existing") {
    playerCartelId = options.cartelId;
    playerCharacterId = options.characterId;
    cartels[playerCartelId].aiControlled = false;
  } else {
    const territoryId = options.territoryId;
    const newId = uid("cartel");
    const player = makeCharacter({
      id: uid("player"),
      name: options.leaderName,
      sex: options.sex || "M",
      birthYear: eraData.startYear - (options.age || 35),
      cartelId: newId,
      role: "leader",
      stats: options.stats,
      portrait: options.portrait || null,
      historical: false,
    });
    characters[player.id] = player;
    territories[territoryId].controllerId = newId;
    cartels[newId] = makeCartel({
      id: newId,
      name: options.cartelName,
      color: options.color || "#7a4a1f",
      eraId: eraData.id,
      territories: [territoryId],
      resources: { money: 150, armySize: 120, corruptGov: 5, corruptPolice: 5, publicImage: 45, heat: 5 },
      roles: { leader: player.id },
      characters: [player.id],
      aiControlled: false,
      historicalNote: "Cártel de nueva creación fundado por el jugador.",
    });
    playerCartelId = newId;
    playerCharacterId = player.id;
  }

  // Fill vacant org-chart roles with generated NPCs for every cartel.
  for (const cartelId of Object.keys(cartels)) {
    fillVacantRoles(cartels[cartelId], characters, eraData.startYear);
  }

  // Default relations.
  const cartelIds = Object.keys(cartels);
  for (const id of cartelIds) {
    cartels[id].relations = {};
    for (const otherId of cartelIds) {
      if (otherId === id) continue;
      cartels[id].relations[otherId] = { status: "neutral", tension: randInt(10, 40) };
    }
  }
  const overrides = WAR_OVERRIDES[eraData.id] || [];
  for (const [a, b] of overrides) {
    if (cartels[a] && cartels[b]) {
      cartels[a].relations[b] = { status: "war", tension: 80 };
      cartels[b].relations[a] = { status: "war", tension: 80 };
    }
  }

  return {
    version: 1,
    eraId: eraData.id,
    eraName: eraData.name,
    period: eraData.period,
    startYear: eraData.startYear,
    endYear: eraData.endYear,
    turnMonths: eraData.turnMonths || 6,
    description: eraData.description,
    newCartelTerritories: eraData.newCartelTerritories || [],
    turn: 0,
    year: eraData.startYear,
    playerCartelId,
    playerCharacterId,
    playerControlMode: "direct",
    territories,
    cartels,
    characters,
    log: [{ turn: 0, year: eraData.startYear, text: `Comienza la partida en ${eraData.startYear}.`, type: "info" }],
    gameOver: false,
    gameOverReason: null,
  };
}

export function currentYear(game) {
  return Math.floor(game.startYear + (game.turn * game.turnMonths) / 12);
}

export function getPlayerCartel(game) {
  return game.cartels[game.playerCartelId];
}

export function getPlayerCharacter(game) {
  return game.characters[game.playerCharacterId];
}

export function addLog(game, text, type = "info") {
  game.log.push({ turn: game.turn, year: currentYear(game), text, type });
  if (game.log.length > 400) game.log.shift();
}

export function persist(game) {
  saveGame(game);
}

export function restore() {
  return loadGame();
}
