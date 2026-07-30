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
const HAIR_COLORS = ["#1a1a1a", "#2c1c10", "#4a2c17", "#6b4423", "#8a8a8a", "#c9c9c9", "#3a2a1a"];
const EYE_COLORS = ["#3b2a1a", "#2c1810", "#4a3524", "#1a1a1a", "#5a4a2a"];
const BG_COLORS = ["#2d241f", "#232a2d", "#2a2320", "#20282a", "#282020", "#252b26", "#2b2530"];

/** Softens a hex color toward white/black by `amount` (-1..1: negative darkens, positive lightens). */
function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const mix = (c) => Math.max(0, Math.min(255, Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount))));
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

function hairShapeSvg(style, hairColor, faceRx) {
  switch (style) {
    case "bald":
      return "";
    case "buzz":
      return `<path d="M${50 - faceRx - 1} 32 Q50 10 ${50 + faceRx + 1} 32 L${50 + faceRx - 2} 26 Q50 14 ${50 - faceRx + 2} 26 Z" fill="${hairColor}"/>`;
    case "sidePart":
      return `<path d="M26 32 Q34 8 58 12 Q74 14 74 30 L70 22 Q50 6 32 16 Q26 22 26 32 Z" fill="${hairColor}"/>`;
    case "swept":
      return `<path d="M27 30 Q40 6 50 8 Q60 6 73 30 L70 20 Q50 4 30 20 Z" fill="${hairColor}"/>`;
    case "curly":
      return (
        `<circle cx="30" cy="24" r="8" fill="${hairColor}"/>` +
        `<circle cx="42" cy="16" r="9" fill="${hairColor}"/>` +
        `<circle cx="58" cy="16" r="9" fill="${hairColor}"/>` +
        `<circle cx="70" cy="24" r="8" fill="${hairColor}"/>` +
        `<circle cx="50" cy="12" r="9" fill="${hairColor}"/>`
      );
    case "ponytail":
      return (
        `<ellipse cx="50" cy="30" rx="23" ry="22" fill="${hairColor}"/>` +
        `<path d="M70 34 Q84 40 80 60 Q78 48 68 42 Z" fill="${hairColor}"/>`
      );
    case "long":
    default:
      return `<ellipse cx="50" cy="32" rx="24" ry="26" fill="${hairColor}"/>`;
  }
}

function facialHairSvg(style, hairColor) {
  switch (style) {
    case "mustache":
      return `<path d="M40 49 Q50 53 60 49 Q56 52 50 52 Q44 52 40 49 Z" fill="${hairColor}" opacity="0.9"/>`;
    case "goatee":
      return (
        `<path d="M40 49 Q50 53 60 49 Q56 52 50 52 Q44 52 40 49 Z" fill="${hairColor}" opacity="0.9"/>` +
        `<path d="M45 54 Q50 62 55 54 Q53 58 50 59 Q47 58 45 54 Z" fill="${hairColor}" opacity="0.9"/>`
      );
    case "stubble":
      return `<ellipse cx="50" cy="52" rx="16" ry="10" fill="${hairColor}" opacity="0.18"/>`;
    case "beard":
      return `<path d="M34 44 Q34 62 50 64 Q66 62 66 44 Q66 56 50 58 Q34 56 34 44 Z" fill="${hairColor}" opacity="0.92"/>`;
    case "none":
    default:
      return "";
  }
}

function eyebrowSvg(style, color) {
  const thickness = style === "thick" ? 2.4 : 1.4;
  const tilt = style === "raised" ? -2 : 0;
  return (
    `<path d="M37 ${32 + tilt} Q42 ${29 + tilt} 47 ${32 + tilt}" stroke="${color}" stroke-width="${thickness}" fill="none" stroke-linecap="round"/>` +
    `<path d="M53 ${32 + tilt} Q58 ${29 + tilt} 63 ${32 + tilt}" stroke="${color}" stroke-width="${thickness}" fill="none" stroke-linecap="round"/>`
  );
}

function mouthSvg(style, color) {
  switch (style) {
    case "smile":
      return `<path d="M44 50 Q50 56 56 50" stroke="${color}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`;
    case "frown":
      return `<path d="M44 53 Q50 49 56 53" stroke="${color}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`;
    case "neutral":
    default:
      return `<path d="M46 51 Q50 53 54 51" stroke="${color}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`;
  }
}

export function generateProceduralPortrait(character) {
  const rand = mulberry32(hashSeed(`${character.id}|${character.name || ""}`));
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  const skin = pick(SKIN_TONES);
  const hairColor = pick(HAIR_COLORS);
  const eyeColor = pick(EYE_COLORS);
  const bg = pick(BG_COLORS);
  const isFemale = character.sex === "F";

  const hairStyle = isFemale
    ? pick(["long", "ponytail", "curly", "swept", "sidePart"])
    : pick(["buzz", "sidePart", "swept", "curly", "bald", "long"]);
  const facialHairStyle = isFemale ? "none" : pick(["none", "none", "stubble", "mustache", "goatee", "beard"]);
  const eyebrowStyle = pick(["thin", "thick", "raised"]);
  const mouthStyle = pick(["neutral", "smile", "frown"]);
  const eyeSize = 1.8 + rand() * 1.2;
  const faceRx = 19 + rand() * 3;
  const eyeSpread = 7 + rand() * 2;

  const skinShadow = shade(skin, -0.18);
  const skinHighlight = shade(skin, 0.12);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<rect width="100" height="100" fill="${bg}"/>` +
    // shoulders/body
    `<ellipse cx="50" cy="90" rx="30" ry="22" fill="${skinShadow}"/>` +
    // neck shadow for a touch of depth
    `<ellipse cx="50" cy="66" rx="10" ry="8" fill="${skinShadow}"/>` +
    // face
    `<circle cx="50" cy="40" r="${faceRx}" fill="${skin}"/>` +
    `<ellipse cx="44" cy="32" rx="10" ry="7" fill="${skinHighlight}" opacity="0.35"/>` +
    hairShapeSvg(hairStyle, hairColor, faceRx) +
    eyebrowSvg(eyebrowStyle, hairColor) +
    `<circle cx="${50 - eyeSpread}" cy="38" r="${eyeSize}" fill="${eyeColor}"/>` +
    `<circle cx="${50 + eyeSpread}" cy="38" r="${eyeSize}" fill="${eyeColor}"/>` +
    `<circle cx="${50 - eyeSpread + 0.6}" cy="37.3" r="${eyeSize * 0.3}" fill="#fff" opacity="0.7"/>` +
    `<circle cx="${50 + eyeSpread + 0.6}" cy="37.3" r="${eyeSize * 0.3}" fill="#fff" opacity="0.7"/>` +
    mouthSvg(mouthStyle, shade(skinShadow, -0.2)) +
    facialHairSvg(facialHairStyle, hairColor) +
    `</svg>`;

  return "data:image/svg+xml," + encodeURIComponent(svg);
}
