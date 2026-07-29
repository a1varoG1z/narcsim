/** Deterministic procedural face generator for non-historical characters (generated NPCs and
 * player-created leaders) who haven't had a real photo uploaded. Never used for historical
 * figures — fabricating a face for a real person would misrepresent them, so those keep the
 * neutral silhouette unless the user uploads an actual photo. The same character always gets
 * the same face, since the seed is derived from their id. */

function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SKIN_TONES = ["#e8b98f", "#d9a066", "#c68863", "#a86b45", "#8d5524", "#6b4423"];
const HAIR_COLORS = ["#1a1a1a", "#2c1c10", "#4a2c17", "#6b4423", "#8a8a8a", "#c9c9c9"];
const EYE_COLORS = ["#3b2a1a", "#2c1810", "#4a3524", "#1a1a1a"];
const BG_COLORS = ["#2d241f", "#232a2d", "#2a2320", "#20282a", "#282020"];

export function generateProceduralPortrait(character) {
  const rand = mulberry32(hashSeed(`${character.id}|${character.name || ""}`));
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  const skin = pick(SKIN_TONES);
  const hairColor = pick(HAIR_COLORS);
  const eyeColor = pick(EYE_COLORS);
  const bg = pick(BG_COLORS);
  const isFemale = character.sex === "F";
  const isBald = !isFemale && rand() < 0.15;
  const hasFacialHair = !isFemale && rand() < 0.45;
  const longHair = isFemale || rand() > 0.5;

  let hairShape = "";
  if (!isBald) {
    hairShape = longHair
      ? `<ellipse cx="50" cy="32" rx="24" ry="26" fill="${hairColor}"/>`
      : `<path d="M28 30 Q50 8 72 30 L72 24 Q50 12 28 24 Z" fill="${hairColor}"/>`;
  }

  const facialHair = hasFacialHair
    ? `<path d="M36 46 Q50 62 64 46 L62 54 Q50 64 38 54 Z" fill="${hairColor}" opacity="0.85"/>`
    : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<rect width="100" height="100" fill="${bg}"/>` +
    `<ellipse cx="50" cy="88" rx="30" ry="24" fill="${skin}"/>` +
    `<circle cx="50" cy="40" r="20" fill="${skin}"/>` +
    hairShape +
    `<circle cx="42" cy="38" r="2.4" fill="${eyeColor}"/>` +
    `<circle cx="58" cy="38" r="2.4" fill="${eyeColor}"/>` +
    `<path d="M46 50 Q50 53 54 50" stroke="${eyeColor}" stroke-width="1.5" fill="none" stroke-linecap="round"/>` +
    facialHair +
    `</svg>`;

  return "data:image/svg+xml," + encodeURIComponent(svg);
}
