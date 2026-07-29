import { uid, randInt, pick } from "./utils/random.js";
import { makeCharacter, randomStats, ROLE_ORDER } from "./model.js";

const FIRST_M = ["Alberto", "Rogelio", "Ismael", "Heriberto", "Fermín", "Casimiro", "Ubaldo", "Refugio", "Aureliano", "Wenceslao", "Baltazar", "Ezequiel", "Norberto", "Cornelio", "Gumaro", "Efraín", "Silvano", "Marcelino", "Reynaldo", "Filiberto", "Rutilo", "Hermilo", "Feliciano", "Aristeo", "Epifanio", "Homero"];
const FIRST_F = ["Consuelo", "Herminia", "Doris", "Beatriz", "Delia", "Norma", "Ariadna", "Gabriela", "Marisela", "Rosalinda", "Isabel", "Lucía", "Manuela"];
const LAST = ["Reyes", "Castro", "Villalpando", "Cavazos", "Salcido", "Ontiveros", "Solórzano", "Beraza", "Peña", "Ibarra", "Campos", "Torres", "Rivas", "Villagómez", "Elizondo", "Ochoa", "Zapata", "Pardo", "Núñez", "Anaya", "Sandoval", "Mena", "Nava", "Farías", "Cardona"];
const NICKNAMES = ["El Güero", "El Negro", "El Flaco", "El Gordo", "El Chapo", "La Sombra", "El Halcón", "El Tigre", "El Padrino", "El Ingeniero", "El Contador", "La Jefa", "El Vaquero", "El Cazador", null, null, null];

export function randomName(sex) {
  const first = sex === "F" ? pick(FIRST_F) : pick(FIRST_M);
  const last1 = pick(LAST);
  const last2 = pick(LAST);
  const nick = pick(NICKNAMES);
  return nick ? `${first} ${last1} "${nick}"` : `${first} ${last1} ${last2}`;
}

export function generateNpc({ cartelId, role, currentYear, minAge = 25, maxAge = 55, bias = {} }) {
  const sex = Math.random() < 0.82 ? "M" : "F";
  return makeCharacter({
    id: uid("npc"),
    name: randomName(sex),
    sex,
    birthYear: currentYear - randInt(minAge, maxAge),
    cartelId,
    role,
    stats: randomStats(bias),
    historical: false,
    notes: "Personaje generado para completar el organigrama.",
  });
}

export function fillVacantRoles(cartel, characters, currentYear) {
  for (const role of ROLE_ORDER) {
    if (!cartel.roles[role]) {
      const npc = generateNpc({ cartelId: cartel.id, role, currentYear });
      characters[npc.id] = npc;
      cartel.roles[role] = npc.id;
      cartel.characters.push(npc.id);
    }
  }
}
