/** Branching dialogue trees for interactive events. Each tree is plain JSON-safe data (no
 * functions) so it can be stored on the game object, exported/imported with the save, and
 * edited by hand from the internal editor. A tree has a `start` node id and a `nodes` map;
 * each node has `text` (with `{partner}` interpolated to the other character's name) and a
 * list of `options`, each pointing to the next node id. A terminal option carries `resolve`
 * instead of `next`, marking where the game engine should take over ("attempt" rolls the
 * outcome; "rejected" ends the scene with no attempt made). `warmth` accumulates across the
 * whole conversation and nudges the odds — the conversation branches based on what the player
 * actually picks, it is never just a random skip to the end. */

export function defaultConceptionDialogue() {
  return {
    start: "greeting",
    nodes: {
      greeting: {
        text: "{partner} sonríe cuando le propones intentar formar una familia juntos esta noche.",
        options: [
          { label: "Coquetear y bromear con ella/él", next: "playful", warmth: 2 },
          { label: "Hablarle con sinceridad de lo que sientes", next: "sincere", warmth: 2 },
          { label: "Ir directo al grano", next: "blunt", warmth: -1 },
        ],
      },
      playful: {
        text: "{partner} se ríe y te sigue el juego, relajando el ambiente entre los dos.",
        options: [
          { label: "Seguir la broma toda la noche", next: "warmup", warmth: 2 },
          { label: "Bajar la voz y ponerte más cercano/a", next: "warmup", warmth: 3 },
        ],
      },
      sincere: {
        text: "{partner} se conmueve con tus palabras y se acerca despacio.",
        options: [
          { label: "Abrazarla/o en silencio", next: "warmup", warmth: 3 },
          { label: "Proponer un brindis por el futuro", next: "warmup", warmth: 2 },
        ],
      },
      blunt: {
        text: "{partner} frunce el ceño; no esperaba tanta prisa por tu parte.",
        options: [
          { label: "Disculparte y suavizar el tono", next: "warmup", warmth: 0 },
          { label: "Insistir de todos modos", next: "reject", warmth: -3 },
        ],
      },
      warmup: {
        text: "La tensión crece entre los dos; {partner} te toma de la mano y te lleva hacia la habitación.",
        options: [
          { label: "Dejarte llevar", next: "moment", warmth: 1 },
          { label: "Susurrarle algo al oído antes", next: "moment", warmth: 2 },
        ],
      },
      moment: {
        text: "La puerta se cierra y las luces se apagan. El resto de la noche queda solo entre vosotros dos...",
        options: [
          { label: "Continuar", resolve: "attempt", warmth: 0 },
        ],
      },
      reject: {
        text: "{partner} se aparta, incómoda/o, y la velada termina ahí.",
        options: [
          { label: "Aceptar y retirarte", resolve: "rejected", warmth: 0 },
        ],
      },
    },
  };
}

export function defaultPoachDialogue() {
  return {
    start: "greeting",
    nodes: {
      greeting: {
        text: "Te reúnes en privado con {partner} para tantear un cambio de bando.",
        options: [
          { label: "Ofrecerle dinero de sobra y un puesto mejor", next: "money", warmth: 1 },
          { label: "Sugerir que su lealtad actual no está bien pagada", next: "grievance", warmth: 2 },
          { label: "Advertirle sin rodeos que su cártel va a perder", next: "threat", warmth: -1 },
        ],
      },
      money: {
        text: "{partner} escucha con interés la oferta económica, pero no se compromete todavía.",
        options: [
          { label: "Subir la oferta sobre la marcha", next: "close", warmth: 2 },
          { label: "Dejar la cifra tal cual y esperar su respuesta", next: "close", warmth: 1 },
        ],
      },
      grievance: {
        text: "{partner} baja la voz: reconoce que lleva tiempo sintiéndose infravalorado/a.",
        options: [
          { label: "Prometerle un cargo real en tu organización", next: "close", warmth: 3 },
          { label: "Escuchar sus quejas sin prometer nada aún", next: "close", warmth: 1 },
        ],
      },
      threat: {
        text: "{partner} se pone a la defensiva; no le gusta que le hablen así.",
        options: [
          { label: "Suavizar el tono y ofrecer garantías", next: "close", warmth: 0 },
          { label: "Mantener la presión", next: "walk_away_early", warmth: -3 },
        ],
      },
      close: {
        text: "{partner} se queda pensativo/a un momento antes de responder.",
        options: [
          { label: "Continuar", resolve: "attempt", warmth: 0 },
        ],
      },
      walk_away_early: {
        text: "{partner} da la conversación por terminada y se aleja, molesto/a.",
        options: [
          { label: "Aceptar y retirarte", resolve: "walk_away", warmth: 0 },
        ],
      },
    },
  };
}

export function defaultInformantDialogue() {
  return {
    start: "greeting",
    nodes: {
      greeting: {
        text: "Te acercas a {partner} en privado para proponerle un trato: información a cambio de protección y dinero, sin que nadie más lo sepa.",
        options: [
          { label: "Ofrecer un pago fijo y discreto", next: "money", warmth: 1 },
          { label: "Apelar a un rencor o resentimiento que ya tiene", next: "grievance", warmth: 2 },
          { label: "Presionar con lo que ya sabes de él/ella", next: "pressure", warmth: -1 },
        ],
      },
      money: {
        text: "{partner} escucha con cautela; el dinero le interesa, pero teme que lo descubran.",
        options: [
          { label: "Prometerle máxima discreción y un canal seguro", next: "close", warmth: 2 },
          { label: "Insistir en que el riesgo merece la pena", next: "close", warmth: 1 },
        ],
      },
      grievance: {
        text: "{partner} baja la voz: reconoce que hay cosas de su propio cártel que no le sientan bien.",
        options: [
          { label: "Escuchar y dejar que se desahogue", next: "close", warmth: 3 },
          { label: "Ir directo a cerrar el trato", next: "close", warmth: 1 },
        ],
      },
      pressure: {
        text: "{partner} se pone tenso/a; no le gusta sentirse acorralado/a.",
        options: [
          { label: "Suavizar el tono antes de que se cierre", next: "close", warmth: 0 },
          { label: "Mantener la presión de todos modos", next: "walk_away_early", warmth: -3 },
        ],
      },
      close: {
        text: "{partner} se queda callado/a un momento, sopesando el riesgo real de aceptar.",
        options: [
          { label: "Continuar", resolve: "attempt", warmth: 0 },
        ],
      },
      walk_away_early: {
        text: "{partner} corta la conversación en seco, nervioso/a por lo que podría pasar si alguien se entera.",
        options: [
          { label: "Aceptar y retirarte", resolve: "walk_away", warmth: 0 },
        ],
      },
    },
  };
}

export function cloneDialogueTree(tree) {
  return JSON.parse(JSON.stringify(tree));
}

export function isValidDialogueTree(tree) {
  return !!(tree && typeof tree.start === "string" && tree.nodes && tree.nodes[tree.start]);
}
