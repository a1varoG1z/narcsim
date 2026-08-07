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
  c.deathCause = causeText;
  addLog(`${c.name} muere en ${causeText}.`, "death");
  const cartel = game.cartels[c.cartelId];
  const wasLeader = !!cartel && cartel.roles.leader === c.id;
  return [{ characterId: c.id, cartelId: c.cartelId, wasLeader, role: c.role }];
}

/** Same principle as killScriptedCharacter, for a scripted arrest instead of a death: an NPC's
 * historical capture plays out as scripted, but the player gets the same 55% chance to defy the
 * historical record and evade it. Returns an entry in the `arrests` shape that endTurn's own
 * arrests loop already knows how to process (see rollPoliceOperations), so the arrest correctly
 * triggers a succession/regent choice if it lands on the player's own character. Defaults to a
 * life sentence; pass { lifeSentence: false } for a capture meant to be reversible later (e.g. by
 * a subsequent scripted escape event, as with fuga-chapo-2001) — a life sentence would otherwise
 * be a dead end no scripted event or gameplay system can undo. */
function imprisonScriptedCharacter(game, characterId, addLog, causeText, { lifeSentence = true } = {}) {
  const c = game.characters[characterId];
  if (!c || !c.alive || c.imprisoned) return [];
  if (characterId === game.playerCharacterId && !chance(0.55)) {
    addLog(`Desafías al destino: evitas la captura que en la vida real terminó con ${c.name} preso (${causeText}).`, "good");
    return [];
  }
  c.imprisoned = { sinceTurn: game.turn, releaseTurn: null, lifeSentence };
  addLog(`${c.name} es detenido/a en ${causeText}. ${lifeSentence ? "Enfrenta cadena perpetua." : "Su condena queda abierta."}`, "death");
  const cartel = game.cartels[c.cartelId];
  const wasLeader = !!cartel && cartel.roles.leader === c.id;
  return [{ characterId: c.id, cartelId: c.cartelId, wasLeader, lifeSentence }];
}

function openWarEntry(game, aId, bId) {
  if (!game.warHistory) game.warHistory = [];
  const key = [aId, bId].sort().join("|");
  let war = game.warHistory.find((w) => w.key === key && w.endYear === null);
  if (!war) {
    war = {
      key,
      cartelA: aId,
      cartelB: bId,
      startYear: game.year,
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

function closeWarEntry(game, aId, bId) {
  if (!game.warHistory) return;
  const key = [aId, bId].sort().join("|");
  const war = game.warHistory.find((w) => w.key === key && w.endYear === null);
  if (war) war.endYear = game.year;
}

export const SCRIPTED_EVENTS = {
  "ley-seca-1925-1933": [
    {
      id: "masacre-san-valentin-1929",
      year: 1929,
      interactive: true,
      cartelId: "chicago_outfit",
      title: "La Masacre de San Valentín",
      description:
        'Tus hombres, disfrazados de policías, tienen a siete miembros del North Side Gang de Bugs Moran alineados contra la pared de un garaje. Es la oportunidad de acabar de un solo golpe con la banda rival. ¿Cómo actúas?',
      options: [
        { id: "full_massacre", label: "Ametrallarlos a todos, sin dejar testigos" },
        { id: "spare_some", label: "Limitar el golpe a los cabecillas presentes" },
        { id: "call_off", label: "Abortar la operación en el último momento" },
      ],
      applyDefault(game, addLog) {
        const c = game.cartels.chicago_outfit;
        if (!c || c.destroyed) return;
        c.resources.heat = Math.min(100, c.resources.heat + randInt(35, 50));
        c.resources.publicImage = Math.max(0, c.resources.publicImage - randInt(15, 25));
        addLog(
          'Siete hombres del North Side Gang mueren ametrallados contra la pared de un garaje. La "Masacre de San Valentín" conmociona al país entero y pone a la organización bajo el foco de la prensa nacional.',
          "death"
        );
      },
      applyChoice(game, addLog, optionId) {
        const c = game.cartels.chicago_outfit;
        if (!c || c.destroyed) return;
        if (optionId === "full_massacre") {
          c.resources.heat = Math.min(100, c.resources.heat + randInt(40, 55));
          c.resources.publicImage = Math.max(0, c.resources.publicImage - randInt(20, 30));
          addLog(
            'Ordenas que no quede nadie con vida en el garaje. Siete hombres del North Side Gang mueren ametrallados. El golpe es devastador para Moran, pero la "Masacre de San Valentín" pone a la organización en la portada de todo el país.',
            "death"
          );
        } else if (optionId === "spare_some") {
          c.resources.heat = Math.min(100, c.resources.heat + randInt(25, 35));
          c.resources.publicImage = Math.max(0, c.resources.publicImage - randInt(10, 15));
          addLog("Limitas el golpe a los cabecillas presentes. El North Side Gang queda tocado, pero el escándalo público es algo menor que el de la masacre completa.", "event");
        } else {
          c.resources.heat = Math.min(100, c.resources.heat + randInt(5, 10));
          addLog("Abortas la operación en el último momento. Moran vive para seguir siendo un problema, pero evitas el escándalo que en la vida real marcó para siempre la reputación de la organización.", "event");
        }
      },
    },
    {
      id: "condena-capone-1931",
      year: 1931,
      run(game, addLog) {
        const arrests = imprisonScriptedCharacter(
          game,
          "al_capone",
          addLog,
          "un juicio federal por 22 cargos de evasión de impuestos, un delito que ni la Prohibición ni la propia policía de Chicago pudieron nunca imputarle"
        );
        return { deaths: [], arrests };
      },
    },
  ],
  "la-comision-1931-1958": [
    {
      id: "condena-luciano-1936",
      year: 1936,
      run(game, addLog) {
        const arrests = imprisonScriptedCharacter(
          game,
          "lucky_luciano",
          addLog,
          "un juicio real impulsado por el fiscal Thomas Dewey por cargos de proxenetismo, condenado a entre 30 y 50 años de prisión"
        );
        return { deaths: [], arrests };
      },
    },
    {
      id: "tiroteo-costello-1957",
      year: 1957,
      run(game, addLog) {
        const c = game.cartels.familia_luciano;
        if (!c || c.destroyed) return [];
        c.resources.heat = Math.min(100, c.resources.heat + randInt(15, 25));
        c.resources.corruptGov = Math.max(0, c.resources.corruptGov - randInt(10, 15));
        addLog(
          "Vito Genovese ordena un atentado contra Frank Costello a manos de Vincent Gigante -- la bala solo le roza el cráneo, pero el mensaje es claro. La organización queda visiblemente dividida por dentro justo cuando más necesita presentar un frente unido.",
          "event"
        );
        return [];
      },
    },
    {
      id: "reunion-apalachin-1957",
      year: 1957,
      interactive: true,
      cartelId: "familia_luciano",
      title: "La redada de Apalachin",
      description:
        'Docenas de jefes de familias de todo el país se han reunido en la granja de Joseph Barbara, en Apalachin (norte del estado de Nueva York), para una cumbre nacional que debía sellar el nuevo reparto de poder tras el atentado contra Costello. La policía estatal ha rodeado la zona sin previo aviso. ¿Cómo reaccionas?',
      options: [
        { id: "flee", label: "Huir a través de los bosques, a pie" },
        { id: "bluff", label: "Quedarse y presentarse como una reunión de negocios cualquiera" },
        { id: "confront", label: "Enfrentar a los agentes abiertamente" },
      ],
      applyDefault(game, addLog) {
        const c = game.cartels.familia_luciano;
        if (!c || c.destroyed) return;
        c.resources.heat = Math.min(100, c.resources.heat + randInt(30, 45));
        c.resources.publicImage = Math.max(0, c.resources.publicImage - randInt(15, 25));
        addLog(
          "La redada de Apalachin obliga a decenas de jefes mafiosos a huir a pie por el bosque, algunos todavía con traje y zapatos de vestir. La existencia de una red mafiosa nacional coordinada queda expuesta ante la opinión pública por primera vez.",
          "event"
        );
      },
      applyChoice(game, addLog, optionId) {
        const c = game.cartels.familia_luciano;
        if (!c || c.destroyed) return;
        if (optionId === "flee") {
          c.resources.heat = Math.min(100, c.resources.heat + randInt(20, 30));
          c.resources.publicImage = Math.max(0, c.resources.publicImage - randInt(10, 15));
          addLog("Escapas a pie por el bosque, como decenas de jefes más. Evitas el arresto inmediato, pero la imagen de mafiosos de traje huyendo entre los árboles recorre todo el país.", "event");
        } else if (optionId === "bluff") {
          c.resources.heat = Math.min(100, c.resources.heat + randInt(35, 50));
          c.resources.corruptPolice = Math.max(0, c.resources.corruptPolice - randInt(10, 20));
          addLog("Te quedas e intentas presentar la reunión como algo inocente. Nadie te cree: la policía retiene e identifica a todos los presentes, exponiendo la red al completo ante la prensa.", "event");
        } else {
          c.resources.heat = Math.min(100, c.resources.heat + randInt(45, 60));
          c.resources.armySize = Math.max(0, c.resources.armySize - randInt(5, 15));
          c.resources.publicImage = Math.max(0, c.resources.publicImage - randInt(20, 30));
          addLog("Ordenas plantar cara a los agentes. El enfrentamiento abierto con la policía estatal es un desastre de imagen y atrae una atención federal sin precedentes sobre la organización.", "death");
        }
      },
    },
  ],
  "yakuza-japon-1960-1993": [
    {
      id: "atentado-taoka-1978",
      year: 1978,
      run(game, addLog) {
        const c = game.cartels.yamaguchi_gumi;
        if (!c || c.destroyed) return [];
        c.resources.heat = Math.min(100, c.resources.heat + randInt(10, 20));
        c.resources.armySize = Math.max(0, c.resources.armySize - randInt(5, 15));
        addLog(
          "Un miembro del Matsuda-gumi dispara contra Kazuo Taoka durante una exhibición de limbo en un club nocturno de Kioto. La bala le roza el cuello, pero sobrevive. La organización responde con una purga interna de posibles cómplices.",
          "event"
        );
        return [];
      },
    },
    {
      id: "muerte-taoka-1981",
      year: 1981,
      run(game, addLog) {
        const deaths = killScriptedCharacter(game, "kazuo_taoka", addLog, "un infarto en Amagasaki");
        return { deaths, arrests: [] };
      },
    },
    {
      id: "asesinato-takenaka-1985",
      year: 1985,
      run(game, addLog) {
        const c = game.cartels.yamaguchi_gumi;
        const deaths = killScriptedCharacter(game, "masahisa_takenaka", addLog, "un tiroteo en Osaka a manos de la facción disidente Ichiwa-kai");
        if (c && !c.destroyed) {
          c.resources.heat = Math.min(100, c.resources.heat + randInt(20, 30));
          c.resources.armySize = Math.max(0, c.resources.armySize - randInt(20, 40));
          addLog(
            "El asesinato desata la Guerra Yama-Ichi contra la Ichiwa-kai: años de tiroteos en las calles de todo el país que desangran a la organización por dentro.",
            "event"
          );
        }
        return { deaths, arrests: [] };
      },
    },
    {
      id: "ley-antibandas-1992",
      year: 1992,
      run(game, addLog) {
        const c = game.cartels.yamaguchi_gumi;
        if (!c || c.destroyed) return [];
        c.resources.heat = Math.min(100, c.resources.heat + randInt(15, 25));
        c.resources.corruptGov = Math.max(0, c.resources.corruptGov - randInt(10, 20));
        c.resources.corruptPolice = Math.max(0, c.resources.corruptPolice - randInt(10, 20));
        addLog(
          "Entra en vigor la Ley contra las Bandas (Boryokudan Boutai Ho): la extorsión abierta y el cobro de protección se vuelven mucho más arriesgados, y decenas de sindicatos yakuza más pequeños en todo el país empiezan a disolverse bajo la nueva presión legal.",
          "event"
        );
        return [];
      },
    },
  ],
  "triadas-hongkong-1950-1998": [
    {
      id: "muerte-kot-1953",
      year: 1953,
      run(game, addLog) {
        const deaths = killScriptedCharacter(game, "kot_siu_wong", addLog, "circunstancias no ampliamente documentadas en 1953");
        const c = game.cartels.triada_14k;
        if (c && !c.destroyed) {
          c.resources.heat = Math.min(100, c.resources.heat + randInt(10, 20));
          addLog(
            "Sin un mando único claro, los lugartenientes de la 14K se disputan el control de las rutas y negocios más lucrativos de la organización -- el arranque real de la estructura descentralizada de facciones autónomas que define a la 14K hasta hoy.",
            "event"
          );
        }
        return { deaths, arrests: [] };
      },
    },
    {
      id: "fundacion-icac-1974",
      year: 1974,
      run(game, addLog) {
        const c = game.cartels.triada_14k;
        if (!c || c.destroyed) return [];
        c.resources.corruptPolice = Math.max(0, c.resources.corruptPolice - randInt(15, 25));
        c.resources.heat = Math.min(100, c.resources.heat + randInt(10, 20));
        addLog(
          "El gobierno colonial crea la Comisión Independiente contra la Corrupción (ICAC), con poderes reales sin precedentes para investigar a la policía y a los funcionarios. La red de protección construida durante décadas empieza a resquebrajarse.",
          "event"
        );
        return [];
      },
    },
    {
      id: "arresto-ng-sikho-1974",
      year: 1974,
      run(game, addLog) {
        const arrests = imprisonScriptedCharacter(
          game,
          "ng_sik_ho",
          addLog,
          "una operación real contra el contrabando de 20 toneladas de opio y morfina desde Tailandia, condenado en 1975 a 30 años de prisión -- la pena más larga impuesta hasta entonces por un tribunal de Hong Kong"
        );
        return { deaths: [], arrests };
      },
    },
    {
      id: "traspaso-hongkong-1997",
      year: 1997,
      run(game, addLog) {
        const c = game.cartels.triada_14k;
        if (!c || c.destroyed) return [];
        c.resources.heat = Math.min(100, c.resources.heat + randInt(10, 20));
        c.resources.corruptGov = Math.max(0, c.resources.corruptGov - randInt(10, 20));
        addLog(
          "El 1 de julio de 1997, el Reino Unido traspasa realmente la soberanía de Hong Kong a China tras más de 150 años de dominio colonial británico. La transición de autoridades y de marco legal obliga a renegociar buena parte de la red de contactos y protección construida bajo el régimen anterior.",
          "event"
        );
        return [];
      },
    },
  ],
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
    {
      id: "arresto-felix-gallardo-1989",
      year: 1989,
      run(game, addLog) {
        // The real end of the unified Guadalajara Cartel: Félix Gallardo's arrest, and — per the
        // well-documented account — the division of the country's smuggling corridors among his
        // lieutenants shortly before/after it, the direct origin of the Tijuana, Sinaloa, and
        // Juárez cartels of the following decades.
        const arrests = imprisonScriptedCharacter(
          game,
          "felix_gallardo",
          addLog,
          "una redada en Guadalajara, poco después de repartir las plazas del país entre sus lugartenientes en una reunión en Acapulco — el origen directo de los cárteles de Tijuana, Sinaloa y Juárez de las décadas siguientes"
        );
        return { deaths: [], arrests };
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
      id: "muerte-escobar-1993",
      year: 1993,
      run(game, addLog) {
        return killScriptedCharacter(
          game,
          "pablo_escobar",
          addLog,
          "un tiroteo en un tejado de Medellín, acorralado por el Bloque de Búsqueda tras año y medio de persecución desde su fuga de La Catedral"
        );
      },
    },
    {
      id: "proceso-8000-1995",
      year: 1995,
      interactive: true,
      cartelId: "cali",
      title: 'El "Proceso 8.000"',
      description:
        "La Fiscalía colombiana lanza el Proceso 8.000, una investigación sin precedentes que acorrala a los líderes del Cártel de Cali por la financiación ilegal de campañas políticas. ¿Cómo responde el cártel?",
      options: [
        { id: "surrender", label: "Negociar una entrega con condena pactada" },
        { id: "resist", label: "Resistir sobornando a jueces y fiscales" },
        { id: "escalate", label: "Escalar la violencia contra el Estado" },
      ],
      applyDefault(game, addLog) {
        const c = game.cartels.cali;
        if (!c || c.destroyed) return;
        c.resources.heat = Math.min(100, c.resources.heat + 35);
        addLog('La Fiscalía colombiana lanza el "Proceso 8.000" y acorrala a los líderes del Cártel de Cali.', "event");
      },
      applyChoice(game, addLog, optionId) {
        const c = game.cartels.cali;
        if (!c || c.destroyed) return;
        if (optionId === "surrender") {
          c.resources.heat = Math.min(100, c.resources.heat + 10);
          c.resources.corruptGov = Math.max(0, c.resources.corruptGov - 5);
          const role = ["underboss", "financeChief", "corruptionGovChief"].find((r) => {
            const holder = game.characters[c.roles[r]];
            return holder && holder.alive && !holder.imprisoned;
          });
          const negotiator = role ? game.characters[c.roles[role]] : null;
          if (negotiator) {
            negotiator.imprisoned = { sinceTurn: game.turn, releaseTurn: game.turn + randInt(8, 16), lifeSentence: false };
            addLog(`${negotiator.name} se entrega y negocia una condena pactada a cambio de reducir la presión sobre el cártel.`, "event");
          } else {
            addLog("El cártel negocia una entrega parcial que calma momentáneamente la presión estatal.", "event");
          }
        } else if (optionId === "resist") {
          c.resources.heat = Math.min(100, c.resources.heat + 30);
          c.resources.corruptGov = Math.max(0, c.resources.corruptGov - 20);
          c.resources.corruptPolice = Math.max(0, c.resources.corruptPolice - 10);
          addLog("El cártel resiste sobornando jueces y fiscales, quemando buena parte de su red de corrupción.", "event");
        } else {
          c.resources.heat = Math.min(100, c.resources.heat + 50);
          c.resources.armySize += randInt(10, 20);
          c.resources.publicImage = Math.max(0, c.resources.publicImage - 15);
          addLog("El cártel escala la violencia contra el Estado, repitiendo la estrategia que hundió a Medellín años atrás.", "death");
        }
      },
    },
  ],
  "cabezas-de-serpiente-1984-2001": [
    {
      id: "hundimiento-golden-venture-1993",
      year: 1993,
      interactive: true,
      cartelId: "cabezas_de_serpiente",
      title: "El hundimiento del Golden Venture",
      description:
        'El Golden Venture, un carguero destartalado con casi 300 migrantes a bordo, ha encallado de madrugada frente a Queens -- sin nadie al mando desde que Ah Kay huyó a China. Varios pasajeros ya se han ahogado intentando llegar a nado a la orilla, y las cámaras de televisión están en la playa antes que la policía. ¿Cómo respondes?',
      options: [
        { id: "flee", label: "Cortar cualquier rastro con el barco y desaparecer una temporada" },
        { id: "bribe", label: "Sobornar a fondo para frenar la investigación antes de que llegue a ti" },
        { id: "double_down", label: "Seguir operando igual, confiando en que no puedan probar nada" },
      ],
      applyDefault(game, addLog) {
        const c = game.cartels.cabezas_de_serpiente;
        if (!c || c.destroyed) return;
        c.resources.heat = Math.min(100, c.resources.heat + randInt(30, 45));
        c.resources.publicImage = Math.max(0, c.resources.publicImage - randInt(20, 30));
        addLog(
          "El hundimiento real del Golden Venture frente a Queens, con al menos diez migrantes ahogados o muertos de hipotermia, pone al mundo entero a mirar el negocio de los \"cabezas de serpiente\" por primera vez.",
          "event"
        );
      },
      applyChoice(game, addLog, optionId) {
        const c = game.cartels.cabezas_de_serpiente;
        if (!c || c.destroyed) return;
        if (optionId === "flee") {
          c.resources.heat = Math.min(100, c.resources.heat + randInt(15, 25));
          c.resources.armySize = Math.max(0, c.resources.armySize - randInt(10, 20));
          addLog("Cortas todo contacto con la operación del barco y te mantienes fuera de la vista una temporada. La red pierde fuelle, pero evitas quedar directamente señalado.", "event");
        } else if (optionId === "bribe") {
          c.resources.corruptGov = Math.max(0, c.resources.corruptGov - randInt(15, 25));
          c.resources.heat = Math.min(100, c.resources.heat + randInt(25, 35));
          c.resources.money = Math.max(0, c.resources.money - Math.round(c.resources.money * 0.08));
          addLog("Vuelcas una fortuna en abogados y contactos para frenar la investigación. Ralentizas el proceso, pero el gasto es enorme y la atención federal no desaparece.", "event");
        } else {
          c.resources.heat = Math.min(100, c.resources.heat + randInt(40, 55));
          c.resources.publicImage = Math.max(0, c.resources.publicImage - randInt(25, 35));
          addLog("Sigues operando como si nada. La prensa y el FBI ya tienen nombres y caras -- la decisión te deja mucho más expuesto de lo que crees.", "death");
        }
      },
    },
    {
      id: "arresto-ah-kay-1993",
      year: 1993,
      run(game, addLog) {
        const arrests = imprisonScriptedCharacter(
          game,
          "ah_kay",
          addLog,
          "una detención real en Hong Kong tras su huida -- se declaró culpable de asesinato y crimen organizado y cooperó después con el FBI"
        );
        return { deaths: [], arrests };
      },
    },
    {
      id: "arresto-sister-ping-2000",
      year: 2000,
      run(game, addLog) {
        const arrests = imprisonScriptedCharacter(
          game,
          "sister_ping",
          addLog,
          "una detención real en el aeropuerto de Chek Lap Kok, Hong Kong, en junio de 2000, tras años de investigación federal -- extraditada después a EE. UU."
        );
        return { deaths: [], arrests };
      },
    },
  ],
  "mafia-rusa-1991-2000": [
    {
      id: "fiesta-averin-1995",
      year: 1995,
      run(game, addLog) {
        const c = game.cartels.hermandad_solntsevo;
        if (!c || c.destroyed) return [];
        c.resources.heat = Math.min(100, c.resources.heat + randInt(10, 18));
        addLog(
          "Una fiesta real de cumpleaños de Viktor Averin en Praga es asaltada por la policía checa -- el episodio corre por la prensa internacional y pone a la organización, hasta entonces discreta fuera de la antigua URSS, bajo el radar de varias policías europeas a la vez.",
          "event"
        );
        return [];
      },
    },
    {
      id: "arresto-mikhailov-1996",
      year: 1996,
      run(game, addLog) {
        // lifeSentence: false is essential here — a companion release event
        // (excarcelacion-mikhailov-1998) undoes it, matching what really happened: Swiss
        // prosecutors never secured a conviction, only two years of pretrial detention.
        const arrests = imprisonScriptedCharacter(
          game,
          "sergei_mikhailov",
          addLog,
          "un arresto real en Ginebra en octubre de 1996 por pertenencia a organización criminal",
          { lifeSentence: false }
        );
        return { deaths: [], arrests };
      },
    },
    {
      id: "excarcelacion-mikhailov-1998",
      year: 1998,
      run(game, addLog) {
        const c = game.characters.sergei_mikhailov;
        if (!c || !c.alive || !c.imprisoned || c.imprisoned.lifeSentence) return [];
        c.imprisoned = null;
        const cartel = game.cartels[c.cartelId];
        if (cartel) {
          cartel.resources.corruptGov = Math.max(0, cartel.resources.corruptGov - randInt(5, 15));
          if (cartel.imprisonedLeaderId === c.id) {
            cartel.roles.leader = c.id;
            c.role = "leader";
            cartel.imprisonedLeaderId = null;
          }
        }
        addLog(
          `${c.name} queda en libertad en diciembre de 1998 -- el gobierno ruso nunca aportó pruebas clave y un testigo previsto para el juicio apareció asesinado en Holanda. Los fiscales suizos no logran una condena.`,
          "good"
        );
        return [];
      },
    },
  ],
  "narcotrafico-gallego-1975-1995": [
    {
      id: "operacion-necora-1990",
      year: 1990,
      interactive: true,
      cartelId: "clan_galego",
      title: "Operación Nécora",
      description:
        "La Guardia Civil desata la Operación Nécora: cerca de 350 agentes de la Brigada Central de Estupefacientes, instruida por el juez Baltasar Garzón, golpean de golpe a las redes de contrabando y narcotráfico de las Rías Baixas. Unas 54 personas son detenidas y, por primera vez, toda España descubre el alcance del narcotráfico gallego. ¿Cómo respondes?",
      options: [
        { id: "negotiate", label: "Buscar abogados y pactar una estrategia legal conjunta" },
        { id: "deny", label: "Negarlo todo y proteger la red de corrupción a toda costa" },
        { id: "flee", label: "Pasar a la clandestinidad y reorganizar el negocio desde la sombra" },
      ],
      applyDefault(game, addLog) {
        const c = game.cartels.clan_galego;
        if (!c || c.destroyed) return;
        c.resources.heat = Math.min(100, c.resources.heat + 40);
        c.resources.corruptPolice = Math.max(0, c.resources.corruptPolice - 20);
        addLog(
          "La Operación Nécora golpea de golpe a las redes de contrabando y narcotráfico de las Rías Baixas: unas 54 personas detenidas y el narcotráfico gallego, en primera plana nacional.",
          "event"
        );
      },
      applyChoice(game, addLog, optionId) {
        const c = game.cartels.clan_galego;
        if (!c || c.destroyed) return;
        if (optionId === "negotiate") {
          c.resources.heat = Math.min(100, c.resources.heat + 20);
          c.resources.corruptGov = Math.max(0, c.resources.corruptGov - 5);
          const oubina = game.characters.laureano_oubina;
          if (oubina && oubina.alive && !oubina.imprisoned) {
            oubina.imprisoned = { sinceTurn: game.turn, releaseTurn: game.turn + randInt(10, 18), lifeSentence: false };
            addLog(`${oubina.name} negocia con sus abogados y es condenado a una pena con fecha de salida. La organización sobrevive, tocada pero en pie.`, "event");
          } else {
            addLog("Los abogados de la organización logran una estrategia conjunta que limita el daño inmediato.", "event");
          }
        } else if (optionId === "deny") {
          c.resources.heat = Math.min(100, c.resources.heat + 30);
          c.resources.corruptGov = Math.max(0, c.resources.corruptGov - 20);
          c.resources.corruptPolice = Math.max(0, c.resources.corruptPolice - 15);
          const oubina = game.characters.laureano_oubina;
          if (oubina && oubina.alive && !oubina.imprisoned) {
            oubina.imprisoned = { sinceTurn: game.turn, releaseTurn: null, lifeSentence: false };
            addLog(`${oubina.name} lo niega todo ante el juez Garzón, pero acaba igualmente condenado. La red de corrupción queda muy dañada tratando de contener el escándalo.`, "event");
          } else {
            addLog("La organización lo niega todo ante el juez Garzón, quemando buena parte de su red de corrupción para contener el escándalo.", "event");
          }
        } else {
          c.resources.heat = Math.min(100, c.resources.heat + 50);
          c.resources.publicImage = Math.max(0, c.resources.publicImage - 15);
          c.resources.armySize += randInt(10, 20);
          addLog("La organización pasa a la clandestinidad y refuerza su aparato de seguridad. La cacería en su contra será implacable, pero por ahora nadie cae preso.", "death");
        }
      },
    },
    {
      id: "asesinato-baulo-1994",
      year: 1994,
      run(game, addLog) {
        const c = game.cartels.clan_galego;
        if (!c || c.destroyed) return [];
        c.resources.heat = Math.min(100, c.resources.heat + 15);
        c.resources.corruptPolice = Math.max(0, c.resources.corruptPolice - 10);
        addLog(
          "Manuel Baúlo, confidente real del juez Garzón contra el clan Charlín, muere tiroteado en su casa de Cambados por tres sicarios colombianos -- un ajuste de cuentas que nunca se resuelve del todo en los tribunales, pero que pone otra vez el foco de la prensa y la policía sobre el narcotráfico gallego.",
          "event"
        );
        return [];
      },
    },
  ],
  "mexico-rutas-1990-2006": [
    {
      id: "posadas-ocampo-1993",
      year: 1993,
      interactive: true,
      cartelId: "tijuana",
      title: "El asesinato del Cardenal Posadas Ocampo",
      description:
        'Un comando de tus sicarios mata por error al Cardenal Juan Jesús Posadas Ocampo en un tiroteo en el aeropuerto de Guadalajara, confundido con un rival. El escándalo desata una crisis nacional y una cacería sin precedentes contra tu cártel. ¿Cómo respondes?',
      options: [
        { id: "scapegoat", label: "Entregar a los sicarios responsables" },
        { id: "deny", label: "Negarlo todo y presionar con la corrupción" },
        { id: "shelter", label: "Esconder a los responsables y reforzar la seguridad" },
      ],
      applyDefault(game, addLog) {
        const c = game.cartels.tijuana;
        if (!c || c.destroyed) return;
        c.resources.heat = Math.min(100, c.resources.heat + 35);
        c.resources.publicImage = Math.max(0, c.resources.publicImage - 15);
        addLog(
          "El asesinato por error del Cardenal Juan Jesús Posadas Ocampo en el aeropuerto de Guadalajara desata una crisis nacional y una ofensiva sin precedentes contra el Cártel de Tijuana.",
          "event"
        );
      },
      applyChoice(game, addLog, optionId) {
        const c = game.cartels.tijuana;
        if (!c || c.destroyed) return;
        if (optionId === "scapegoat") {
          c.resources.heat = Math.min(100, c.resources.heat + 15);
          c.resources.publicImage = Math.max(0, c.resources.publicImage - 5);
          const holder = game.characters[c.roles.sicariosChief];
          if (holder && holder.alive && !holder.imprisoned) {
            holder.imprisoned = { sinceTurn: game.turn, releaseTurn: null, lifeSentence: true };
            addLog(`${holder.name} carga con la culpa del atentado y es entregado a las autoridades. La presión internacional se calma un poco.`, "event");
          } else {
            addLog("El cártel entrega a sicarios de bajo rango como responsables. La presión internacional se calma un poco.", "event");
          }
        } else if (optionId === "deny") {
          c.resources.heat = Math.min(100, c.resources.heat + 25);
          c.resources.corruptGov = Math.max(0, c.resources.corruptGov - 15);
          c.resources.corruptPolice = Math.max(0, c.resources.corruptPolice - 10);
          c.resources.publicImage = Math.max(0, c.resources.publicImage - 10);
          addLog("El cártel lo niega todo y quema buena parte de su red de corrupción tratando de contener el escándalo.", "event");
        } else {
          c.resources.heat = Math.min(100, c.resources.heat + 40);
          c.resources.armySize += randInt(10, 20);
          c.resources.publicImage = Math.max(0, c.resources.publicImage - 25);
          addLog("El cártel esconde a los responsables y refuerza su seguridad, a costa de una imagen pública devastada.", "death");
        }
      },
    },
    {
      id: "arresto-chapo-1993",
      year: 1993,
      run(game, addLog) {
        // Sets up the arrest half of the real arrest-then-escape arc that fuga-chapo-2001
        // completes: without this, that later event only ever fires if the emergent police-
        // operations system happened to catch him first, which usually never happens.
        // lifeSentence: false is essential here — fuga-chapo-2001 bails out entirely on a life
        // sentence, since no scripted escape should be able to undo one.
        return {
          deaths: [],
          arrests: imprisonScriptedCharacter(
            game,
            "chapo_guzman",
            addLog,
            "una captura en Guatemala, semanas después del caos por el asesinato del Cardenal Posadas Ocampo, tras ser extraditado a México",
            { lifeSentence: false }
          ),
        };
      },
    },
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
    {
      id: "caida-arellano-felix-2002",
      year: 2002,
      run(game, addLog) {
        // The real 2002 collapse of the Tijuana leadership, weeks apart: Ramón dies in a shootout
        // with local police (an unglamorous death — he ran a red light and was recognized), then
        // Benjamín is captured shortly after. Modeled as one beat since both land the same year.
        const deaths = killScriptedCharacter(game, "ramon_arellano", addLog, "un tiroteo con la policía en Mazatlán, tras ser reconocido en un control de tráfico");
        const arrests = imprisonScriptedCharacter(game, "benjamin_arellano", addLog, "una redada del Ejército en Puebla, semanas después de la muerte de su hermano Ramón");
        return { deaths, arrests };
      },
    },
  ],
  "clan-del-golfo-2006-2022": [
    {
      id: "captura-don-mario-2009",
      year: 2009,
      run(game, addLog) {
        const arrests = imprisonScriptedCharacter(
          game,
          "don_mario",
          addLog,
          "una operación real de 315 agentes que lo localizó escondido en la selva el 15 de abril de 2009 -- extraditado después a EE. UU., donde admitió haber traficado más de 80 toneladas de cocaína"
        );
        return { deaths: [], arrests };
      },
    },
    {
      id: "muerte-giovanni-2012",
      year: 2012,
      run(game, addLog) {
        const deaths = killScriptedCharacter(
          game,
          "giovanni",
          addLog,
          "una redada real de las fuerzas de seguridad contra su rancho en Chocó, en la madrugada del 1 de enero de 2012"
        );
        const c = game.cartels.clan_del_golfo;
        if (c && !c.destroyed) {
          c.resources.heat = Math.min(100, c.resources.heat + randInt(15, 25));
          addLog(
            "La organización declara un \"paro armado\" en represalia por la muerte de Giovanni, ofreciendo recompensas por cada policía asesinado en Antioquia -- una demostración real de fuerza que atrae aún más atención de las autoridades.",
            "event"
          );
        }
        return { deaths, arrests: [] };
      },
    },
    {
      id: "captura-otoniel-2021",
      year: 2021,
      run(game, addLog) {
        const arrests = imprisonScriptedCharacter(
          game,
          "otoniel",
          addLog,
          "una operación real con más de 500 miembros de fuerzas especiales y 22 helicópteros el 23 de octubre de 2021 -- el propio presidente colombiano comparó su caída con la de Pablo Escobar"
        );
        return { deaths: [], arrests };
      },
    },
  ],
  "fragmentacion-2006-2015": [
    {
      id: "arresto-mochomo-2008",
      year: 2008,
      interactive: true,
      cartelId: "beltran_leyva",
      title: 'La detención de "El Mochomo"',
      description:
        'En plena guerra contra el Cártel de Sinaloa, la Marina captura en Culiacán a tu hermano Alfredo Beltrán Leyva "El Mochomo". Estás convencido de que fue "El Chapo" Guzmán quien lo delató para golpearte desde dentro. ¿Cómo respondes?',
      options: [
        { id: "war", label: "Redoblar la ofensiva contra Sinaloa" },
        { id: "zetas", label: "Sellar una alianza con Los Zetas para reforzarte" },
        { id: "reconcile", label: "Intentar una tregua secreta con Sinaloa pese a todo" },
      ],
      applyDefault(game, addLog) {
        const c = game.cartels.beltran_leyva;
        const zetas = game.cartels.zetas;
        if (!c || c.destroyed) return;
        if (zetas && !zetas.destroyed) {
          c.relations[zetas.id] = { status: "alliance", tension: 5 };
          zetas.relations[c.id] = { status: "alliance", tension: 5 };
          c.resources.armySize += randInt(20, 45);
        }
        c.resources.heat = Math.min(100, c.resources.heat + 20);
        addLog(
          'La detención de Alfredo Beltrán Leyva "El Mochomo" convence a Arturo Beltrán Leyva de que "El Chapo" lo delató. La Organización Beltrán Leyva sella una alianza con Los Zetas para resistir la guerra contra el Cártel de Sinaloa.',
          "event"
        );
      },
      applyChoice(game, addLog, optionId) {
        const c = game.cartels.beltran_leyva;
        const sinaloa = game.cartels.sinaloa;
        const zetas = game.cartels.zetas;
        if (!c || c.destroyed) return;
        if (optionId === "war") {
          if (sinaloa && !sinaloa.destroyed) {
            c.relations[sinaloa.id] = { status: "war", tension: 95 };
            sinaloa.relations[c.id] = { status: "war", tension: 95 };
            openWarEntry(game, c.id, sinaloa.id);
          }
          c.resources.heat = Math.min(100, c.resources.heat + 30);
          c.resources.armySize = Math.max(10, Math.round(c.resources.armySize * 0.9));
          addLog('Redoblas la ofensiva contra "El Chapo": la guerra con el Cártel de Sinaloa se vuelve aún más sangrienta.', "event");
        } else if (optionId === "zetas") {
          if (sinaloa && !sinaloa.destroyed) {
            c.relations[sinaloa.id] = { status: "war", tension: 95 };
            sinaloa.relations[c.id] = { status: "war", tension: 95 };
            openWarEntry(game, c.id, sinaloa.id);
          }
          if (zetas && !zetas.destroyed) {
            c.relations[zetas.id] = { status: "alliance", tension: 5 };
            zetas.relations[c.id] = { status: "alliance", tension: 5 };
            c.resources.armySize += randInt(20, 45);
          }
          c.resources.heat = Math.min(100, c.resources.heat + 20);
          addLog("Sellas una alianza con Los Zetas: refuerzos y protección a cambio de sumarte a su propia guerra contra Sinaloa.", "event");
        } else {
          const success = chance(0.25);
          if (success && sinaloa && !sinaloa.destroyed) {
            c.relations[sinaloa.id] = { status: "neutral", tension: 65 };
            sinaloa.relations[c.id] = { status: "neutral", tension: 65 };
            closeWarEntry(game, c.id, sinaloa.id);
            addLog(
              "Contra todo pronóstico, logras una tregua secreta: la guerra con el Cártel de Sinaloa se apaga, aunque la desconfianza sigue ahí.",
              "event"
            );
          } else {
            if (sinaloa && !sinaloa.destroyed) {
              c.relations[sinaloa.id] = { status: "war", tension: 95 };
              sinaloa.relations[c.id] = { status: "war", tension: 95 };
              openWarEntry(game, c.id, sinaloa.id);
            }
            c.resources.publicImage = Math.max(0, c.resources.publicImage - 10);
            c.resources.heat = Math.min(100, c.resources.heat + 30);
            addLog("Tu intento de tregua fracasa: Sinaloa interpreta el acercamiento como debilidad y la guerra sigue igual de sangrienta.", "event");
          }
        }
      },
    },
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
    {
      id: "arresto-z40-2013",
      year: 2013,
      run(game, addLog) {
        // pickHeir already prioritizes the underboss, so z40_trevino should already be Zetas'
        // leader by now via autoSuccession after Lazcano's 2012 death — this is his own real fall.
        const arrests = imprisonScriptedCharacter(
          game,
          "z40_trevino",
          addLog,
          "una captura de la Marina de madrugada cerca de Nuevo Laredo, en una camioneta cargada de dinero y armas"
        );
        return { deaths: [], arrests };
      },
    },
    {
      id: "arresto-z42-2015",
      year: 2015,
      run(game, addLog) {
        // Completes the full Zetas leadership collapse across this era: Lazcano (2012) → Z-40
        // (2013) → Z-42, his brother and successor, right at the era's own endYear.
        const arrests = imprisonScriptedCharacter(
          game,
          "z42_trevino",
          addLog,
          "una captura sin un solo disparo en San Pedro Garza García, Nuevo León"
        );
        return { deaths: [], arrests };
      },
    },
  ],
  "cjng-sinaloa-2015-actualidad": [
    {
      id: "viernes-negro-2015",
      year: 2015,
      interactive: true,
      cartelId: "cjng",
      title: "Viernes Negro: el Ejército cerca a El Mencho",
      description:
        'El Ejército mexicano lanza un operativo para capturar a Nemesio "El Mencho" Oseguera en Jalisco. Tus sicarios tienen la oportunidad de intervenir antes de que el cerco se cierre sobre él. ¿Cómo actúas?',
      options: [
        { id: "shoot_down", label: "Derribar su helicóptero y bloquear las carreteras de la región" },
        { id: "evacuate", label: "Evacuar a El Mencho en silencio y evitar el enfrentamiento" },
        { id: "bribe", label: "Sobornar a mandos del operativo para que lo desvíen" },
      ],
      applyDefault(game, addLog) {
        const c = game.cartels.cjng;
        if (!c || c.destroyed) return;
        c.resources.heat = Math.min(100, c.resources.heat + randInt(35, 50));
        c.resources.armySize = Math.max(0, c.resources.armySize - randInt(10, 25));
        c.resources.corruptGov = Math.max(0, c.resources.corruptGov - randInt(10, 20));
        addLog(
          'Tus sicarios derriban un helicóptero militar con un lanzacohetes y bloquean carreteras en todo Jalisco con vehículos incendiados. El "Viernes Negro" deja claro el poder de fuego del CJNG, a un costo altísimo en atención internacional.',
          "event"
        );
      },
      applyChoice(game, addLog, optionId) {
        const c = game.cartels.cjng;
        if (!c || c.destroyed) return;
        if (optionId === "shoot_down") {
          c.resources.heat = Math.min(100, c.resources.heat + randInt(35, 50));
          c.resources.armySize = Math.max(0, c.resources.armySize - randInt(10, 25));
          c.resources.corruptGov = Math.max(0, c.resources.corruptGov - randInt(10, 20));
          addLog(
            'Ordenas derribar el helicóptero militar y bloquear las carreteras de Jalisco. El golpe cimenta tu fama de poder de fuego imparable, pero desata una ofensiva estatal sin precedentes contra el cártel.',
            "death"
          );
        } else if (optionId === "evacuate") {
          c.resources.heat = Math.min(100, c.resources.heat + randInt(10, 20));
          c.resources.publicImage = Math.min(100, c.resources.publicImage + randInt(3, 8));
          addLog(
            "Evacuas a El Mencho en silencio antes de que el cerco se cierre, evitando el enfrentamiento directo. La operación pasa casi desapercibida.",
            "event"
          );
        } else {
          const success = chance(0.4);
          c.resources.corruptGov = Math.max(0, c.resources.corruptGov - randInt(15, 25));
          if (success) {
            addLog(
              "El soborno funciona: mandos corruptos desvían el operativo antes de que llegue hasta El Mencho, sin disparar un solo tiro.",
              "event"
            );
          } else {
            c.resources.heat = Math.min(100, c.resources.heat + randInt(35, 50));
            c.resources.armySize = Math.max(0, c.resources.armySize - randInt(10, 25));
            c.resources.publicImage = Math.max(0, c.resources.publicImage - randInt(10, 20));
            addLog(
              "El soborno fracasa y se filtra a la prensa: el operativo sigue su curso, tus sicarios derriban un helicóptero militar y bloquean carreteras en Jalisco, y encima queda al descubierto el intento de comprar a los mandos.",
              "death"
            );
          }
        }
      },
    },
    {
      id: "arresto-ovidio-2023",
      year: 2023,
      interactive: true,
      cartelId: "sinaloa",
      title: "La captura de Ovidio Guzmán",
      description:
        'El Ejército captura a tu hermano Ovidio Guzmán López en Culiacán. La ciudad puede estallar en un caos total como en 2019, cuando la presión forzó su liberación. ¿Cómo respondes?',
      options: [
        { id: "siege", label: "Desatar el caos total en Culiacán para forzar su liberación" },
        { id: "negotiate", label: "Negociar en silencio con las autoridades" },
        { id: "abandon", label: "Dejarlo a su suerte para evitar más atención" },
      ],
      applyDefault(game, addLog) {
        const c = game.cartels.sinaloa;
        const ovidio = game.characters.chapito_3;
        if (!c || c.destroyed) return;
        c.resources.heat = Math.min(100, c.resources.heat + randInt(45, 60));
        c.resources.armySize = Math.max(0, Math.round(c.resources.armySize * (1 - randInt(10, 20) / 100)));
        if (ovidio && ovidio.alive && !ovidio.imprisoned) {
          ovidio.imprisoned = { sinceTurn: game.turn, releaseTurn: null, lifeSentence: true };
        }
        addLog(
          "La captura de Ovidio Guzmán desata un caos total en Culiacán — convoyes militares emboscados, el aeropuerto cerrado, la ciudad paralizada —, pero a diferencia de 2019, esta vez el gobierno no cede: Ovidio queda preso y acabará extraditado.",
          "death"
        );
      },
      applyChoice(game, addLog, optionId) {
        const c = game.cartels.sinaloa;
        const ovidio = game.characters.chapito_3;
        if (!c || c.destroyed) return;
        const imprisonOvidio = () => {
          if (ovidio && ovidio.alive && !ovidio.imprisoned) {
            ovidio.imprisoned = { sinceTurn: game.turn, releaseTurn: null, lifeSentence: true };
          }
        };
        if (optionId === "siege") {
          c.resources.heat = Math.min(100, c.resources.heat + randInt(50, 65));
          c.resources.armySize = Math.max(0, Math.round(c.resources.armySize * (1 - randInt(15, 25) / 100)));
          if (chance(0.3)) {
            if (ovidio) ovidio.imprisoned = null;
            c.resources.publicImage = Math.min(100, c.resources.publicImage + randInt(10, 20));
            addLog(
              "El caos desatado en Culiacán funciona: ante el riesgo de una masacre civil, el gobierno cede y libera a Ovidio, igual que en 2019. Tu poder de fuego queda demostrado ante el mundo.",
              "good"
            );
          } else {
            imprisonOvidio();
            c.resources.publicImage = Math.max(0, c.resources.publicImage - randInt(10, 20));
            addLog(
              "El caos desatado en Culiacán no basta esta vez: el gobierno resiste la presión y Ovidio queda preso, mientras la ciudad paga el precio de una ofensiva que no logró su objetivo.",
              "death"
            );
          }
        } else if (optionId === "negotiate") {
          c.resources.heat = Math.min(100, c.resources.heat + randInt(20, 30));
          c.resources.corruptGov = Math.max(0, c.resources.corruptGov - randInt(10, 15));
          imprisonOvidio();
          addLog("Intentas negociar en silencio con las autoridades, pero no consigues evitar que Ovidio quede preso.", "event");
        } else {
          c.resources.heat = Math.min(100, c.resources.heat + randInt(10, 15));
          c.resources.publicImage = Math.max(0, c.resources.publicImage - randInt(15, 25));
          imprisonOvidio();
          addLog("Decides no arriesgar nada por Ovidio. Queda preso sin que muevas un dedo por él, y dentro de la familia eso no pasa desapercibido.", "event");
        }
      },
    },
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
    {
      id: "muerte-mick-hawi-2018",
      year: 2018,
      run(game, addLog) {
        return killScriptedCharacter(
          game,
          "mick_hawi",
          addLog,
          "un tiroteo frente a un gimnasio de Sídney, un ajuste de cuentas que la policía australiana nunca resolvió del todo"
        );
      },
    },
  ],
};

/** Returns { deaths, arrests, pendingChoice }. Interactive events pause for a player decision
 * instead of auto-resolving when the player controls the affected cartel; they stay unfired until
 * resolved via resolveScriptedChoice, so they're offered again next turn if a modal collision
 * defers them. When an NPC/AI cartel is affected instead, the event just plays out as it did
 * historically. A non-interactive event's run() can return either a plain array (treated as
 * deaths, the original/default shape) or a { deaths, arrests } object for events that also need
 * to feed an arrest into endTurn's own arrests-processing loop (see imprisonScriptedCharacter). */
export function rollScriptedEvents(game, addLog, year) {
  if (!game.firedScriptedEvents) game.firedScriptedEvents = [];
  const events = SCRIPTED_EVENTS[game.eraId] || [];
  const deaths = [];
  const arrests = [];
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
    const evResult = ev.run(game, addLog) || [];
    if (Array.isArray(evResult)) {
      deaths.push(...evResult);
    } else {
      deaths.push(...(evResult.deaths || []));
      arrests.push(...(evResult.arrests || []));
    }
    game.firedScriptedEvents.push(ev.id);
  }
  return { deaths, arrests, pendingChoice };
}

export function resolveScriptedChoice(game, addLog, eventId, optionId) {
  const events = SCRIPTED_EVENTS[game.eraId] || [];
  const ev = events.find((e) => e.id === eventId);
  if (!ev) return;
  ev.applyChoice(game, addLog, optionId);
  game.firedScriptedEvents.push(ev.id);
}
