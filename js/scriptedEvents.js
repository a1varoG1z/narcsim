import { chance, randInt } from "./utils/random.js";

/**
 * One-off scripted beats tied to real historical dates, layered on top of the emergent
 * simulation. Each fires at most once per playthrough, the first turn its era reaches `year`.
 *
 * When the target is an NPC, the historical fate plays out exactly as it did in real life.
 * When the target is the character the player is currently controlling, it becomes a heavy
 * (55%) risk instead of a certainty: the player can defy the historical record through play
 * rather than being railroaded into losing their character on a fixed date.
 */
function killScriptedCharacter(game, characterId, addLog, causeText) {
  const c = game.characters[characterId];
  if (!c || !c.alive || c.imprisoned) return [];
  if (characterId === game.playerCharacterId && !chance(0.55)) {
    addLog(`Desafías al destino: sobrevives al episodio que en la vida real acabó con ${c.name} (${causeText}).`, "good");
    return [];
  }
  c.alive = false;
  c.deathYear = game.year;
  addLog(`${c.name} muere en ${causeText}.`, "death");
  const cartel = game.cartels[c.cartelId];
  const wasLeader = !!cartel && cartel.roles.leader === c.id;
  return [{ characterId: c.id, cartelId: c.cartelId, wasLeader, role: c.role }];
}

export const SCRIPTED_EVENTS = {
  "guadalajara-1975-1989": [
    {
      id: "camarena-1985",
      year: 1985,
      interactive: true,
      cartelId: "guadalajara",
      title: "El secuestro de Camarena",
      description:
        'Tu gente ha secuestrado y asesinado al agente de la DEA Enrique "Kiki" Camarena. Washington exige respuestas y una ofensiva binacional sin precedentes se cierne sobre el cártel. ¿Cómo respondes?',
      options: [
        { id: "cooperate", label: "Entregar un chivo expiatorio a las autoridades" },
        { id: "deny", label: "Negarlo todo y presionar con la corrupción" },
        { id: "defy", label: "Desafiar abiertamente a la DEA" },
      ],
      applyDefault(game, addLog) {
        const c = game.cartels.guadalajara;
        if (!c || c.destroyed) return;
        c.resources.heat = Math.min(100, c.resources.heat + 40);
        c.resources.corruptPolice = Math.max(0, c.resources.corruptPolice - 20);
        addLog(
          'El secuestro y asesinato del agente de la DEA Enrique "Kiki" Camarena desata una ofensiva binacional sin precedentes contra el Cártel de Guadalajara.',
          "event"
        );
      },
      applyChoice(game, addLog, optionId) {
        const c = game.cartels.guadalajara;
        if (!c || c.destroyed) return;
        if (optionId === "cooperate") {
          c.resources.heat = Math.min(100, c.resources.heat + 15);
          c.resources.corruptPolice = Math.max(0, c.resources.corruptPolice - 10);
          const scapegoatRole = ["sicariosChief", "militaryChief", "corruptionPoliceChief"].find((role) => {
            const holder = game.characters[c.roles[role]];
            return holder && holder.alive && !holder.imprisoned;
          });
          const scapegoat = scapegoatRole ? game.characters[c.roles[scapegoatRole]] : null;
          if (scapegoat) {
            scapegoat.imprisoned = { sinceTurn: game.turn, releaseTurn: null, lifeSentence: true };
            addLog(`${scapegoat.name} carga con la culpa y es entregado a las autoridades. La presión internacional se calma un poco.`, "event");
          } else {
            addLog("El cártel entrega pruebas menores a las autoridades. La presión internacional se calma un poco.", "event");
          }
        } else if (optionId === "deny") {
          c.resources.heat = Math.min(100, c.resources.heat + 25);
          c.resources.corruptGov = Math.max(0, c.resources.corruptGov - 15);
          c.resources.corruptPolice = Math.max(0, c.resources.corruptPolice - 10);
          addLog("El cártel lo niega todo y quema buena parte de su red de corrupción tratando de contener el escándalo.", "event");
        } else {
          c.resources.heat = Math.min(100, c.resources.heat + 45);
          c.resources.armySize += randInt(15, 30);
          c.resources.publicImage = Math.max(0, c.resources.publicImage - 10);
          addLog("El cártel desafía abiertamente a la DEA y refuerza su aparato armado. La ofensiva en su contra será implacable.", "death");
        }
      },
    },
  ],
  "medellin-cali-1980-1995": [
    {
      id: "guerra-extradicion-1989",
      year: 1989,
      run(game, addLog) {
        const c = game.cartels.medellin;
        if (!c || c.destroyed) return [];
        c.resources.heat = Math.min(100, c.resources.heat + 30);
        c.resources.corruptGov = Math.max(0, c.resources.corruptGov - 15);
        addLog(
          "Escobar declara la guerra al Estado colombiano contra la extradición: bombas y asesinatos de políticos desatan una represión masiva.",
          "event"
        );
        return [];
      },
    },
    {
      id: "proceso-8000-1995",
      year: 1995,
      run(game, addLog) {
        const c = game.cartels.cali;
        if (!c || c.destroyed) return [];
        c.resources.heat = Math.min(100, c.resources.heat + 35);
        addLog('La Fiscalía colombiana lanza el "Proceso 8.000" y acorrala a los líderes del Cártel de Cali.', "event");
        return [];
      },
    },
  ],
  "mexico-rutas-1990-2006": [
    {
      id: "muerte-amado-1997",
      year: 1997,
      run(game, addLog) {
        return killScriptedCharacter(game, "amado_carrillo", addLog, "complicaciones de una cirugía plástica clandestina para cambiar de rostro");
      },
    },
    {
      id: "fuga-chapo-2001",
      year: 2001,
      run(game, addLog) {
        const c = game.characters.chapo_guzman;
        if (!c || !c.alive || !c.imprisoned || c.imprisoned.lifeSentence) return [];
        const isPlayer = c.id === game.playerCharacterId;
        if (isPlayer && !chance(0.8)) {
          addLog(`${c.name} planea una fuga de máxima seguridad, pero el operativo se frustra a tiempo.`, "event");
          return [];
        }
        c.imprisoned = null;
        const cartel = game.cartels[c.cartelId];
        if (cartel) {
          cartel.resources.heat = Math.min(100, cartel.resources.heat + 25);
          if (cartel.imprisonedLeaderId === c.id) {
            cartel.roles.leader = c.id;
            c.role = "leader";
            cartel.imprisonedLeaderId = null;
          }
        }
        addLog(`${c.name} se fuga de la prisión de máxima seguridad, escondido en un carrito de lavandería. La noticia da la vuelta al mundo.`, "good");
        return [];
      },
    },
  ],
  "fragmentacion-2006-2015": [
    {
      id: "muerte-arturo-beltran-2009",
      year: 2009,
      run(game, addLog) {
        return killScriptedCharacter(game, "arturo_beltran_leyva", addLog, "un operativo de la Marina mexicana en Cuernavaca");
      },
    },
    {
      id: "muerte-nazario-2010",
      year: 2010,
      run(game, addLog) {
        return killScriptedCharacter(game, "nazario_moreno", addLog, "un enfrentamiento reportado con las fuerzas federales (una muerte no confirmada oficialmente hasta 2014)");
      },
    },
    {
      id: "muerte-lazcano-2012",
      year: 2012,
      run(game, addLog) {
        return killScriptedCharacter(game, "lazcano_06", addLog, "un enfrentamiento con la Marina mexicana");
      },
    },
  ],
  "cjng-sinaloa-2015-actualidad": [
    {
      id: "guerra-chapitos-mayiza-2024",
      year: 2024,
      run(game, addLog) {
        const c = game.cartels.sinaloa;
        if (!c || c.destroyed) return [];
        c.resources.heat = Math.min(100, c.resources.heat + 25);
        c.resources.armySize = Math.max(10, Math.round(c.resources.armySize * 0.85));
        addLog(
          'La entrega de "El Mayo" Zambada a las autoridades de EE.UU. desata una guerra interna entre "Los Chapitos" y "La Mayiza" dentro del Cártel de Sinaloa.',
          "event"
        );
        return [];
      },
    },
  ],
};

/** Returns { deaths, pendingChoice }. Interactive events pause for a player decision instead of
 * auto-resolving when the player controls the affected cartel; they stay unfired until resolved
 * via resolveScriptedChoice, so they're offered again next turn if a modal collision defers them.
 * When an NPC/AI cartel is affected instead, the event just plays out as it did historically. */
export function rollScriptedEvents(game, addLog, year) {
  if (!game.firedScriptedEvents) game.firedScriptedEvents = [];
  const events = SCRIPTED_EVENTS[game.eraId] || [];
  const deaths = [];
  let pendingChoice = null;
  for (const ev of events) {
    if (game.firedScriptedEvents.includes(ev.id)) continue;
    if (year < ev.year) continue;
    if (ev.interactive) {
      if (game.playerCartelId === ev.cartelId) {
        pendingChoice = { eventId: ev.id, title: ev.title, description: ev.description, options: ev.options };
      } else {
        ev.applyDefault(game, addLog);
        game.firedScriptedEvents.push(ev.id);
      }
      continue;
    }
    const evDeaths = ev.run(game, addLog) || [];
    deaths.push(...evDeaths);
    game.firedScriptedEvents.push(ev.id);
  }
  return { deaths, pendingChoice };
}

export function resolveScriptedChoice(game, addLog, eventId, optionId) {
  const events = SCRIPTED_EVENTS[game.eraId] || [];
  const ev = events.find((e) => e.id === eventId);
  if (!ev) return;
  ev.applyChoice(game, addLog, optionId);
  game.firedScriptedEvents.push(ev.id);
}
