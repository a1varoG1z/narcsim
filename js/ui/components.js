import { ROLES } from "../model.js";
import { generateProceduralPortrait } from "../portraitGenerator.js";

const DEFAULT_PORTRAIT = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%232d241f'/%3E%3Ccircle cx='50' cy='38' r='18' fill='%234a382c'/%3E%3Cellipse cx='50' cy='88' rx='30' ry='22' fill='%234a382c'/%3E%3C/svg%3E";

export function portraitImg(character, sizeClass = "") {
  let src = character?.portrait;
  if (!src) {
    // Only fabricate a face for characters the game invented — never for real historical
    // figures, who keep the neutral silhouette unless a real photo is uploaded for them.
    src = character && character.historical === false ? generateProceduralPortrait(character) : DEFAULT_PORTRAIT;
  }
  return `<img class="portrait ${sizeClass}" src="${src}" alt="${character ? escapeHtml(character.name) : ""}">`;
}

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function statBar(label, value, extraClass = "") {
  const pct = Math.max(0, Math.min(100, value));
  return `<div class="statbar ${extraClass}">
    <div class="label">${escapeHtml(label)}</div>
    <div class="bar"><i style="width:${pct}%"></i></div>
    <div class="val">${Math.round(value)}</div>
  </div>`;
}

export function personRow(character, roleLabel) {
  if (!character) {
    return `<div class="person-row"><div class="info"><div class="name text-dim">Vacante</div><div class="role">${escapeHtml(roleLabel || "")}</div></div></div>`;
  }
  const dead = !character.alive ? '<span class="badge dead">✝</span>' : "";
  const jailed = character.imprisoned ? '<span class="badge">Preso</span>' : "";
  return `<div class="person-row" data-char-id="${character.id}">
    ${portraitImg(character)}
    <div class="info">
      <div class="name">${escapeHtml(character.name)} ${dead}${jailed}</div>
      <div class="role">${escapeHtml(roleLabel || "")}</div>
    </div>
  </div>`;
}

export function roleLabel(role) {
  return ROLES[role] || role;
}

/** Lightens colors that would be unreadable as text on this app's dark background. */
export function readableColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return hex || "#c9a13b";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (luminance >= 0.35) return hex;
  const lighten = (c) => Math.min(255, Math.round(c + (255 - c) * 0.55));
  return `rgb(${lighten(r)}, ${lighten(g)}, ${lighten(b)})`;
}
