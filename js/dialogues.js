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

export function cloneDialogueTree(tree) {
  return JSON.parse(JSON.stringify(tree));
}

export function isValidDialogueTree(tree) {
  return !!(tree && typeof tree.start === "string" && tree.nodes && tree.nodes[tree.start]);
}
