export function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function chance(probability) {
  return Math.random() < probability;
}

export function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}

export function weightedPick(entries) {
  // entries: [{ item, weight }]
  const total = entries.reduce((s, e) => s + Math.max(0, e.weight), 0);
  if (total <= 0) return entries.length ? pick(entries.map(e => e.item)) : undefined;
  let roll = Math.random() * total;
  for (const e of entries) {
    roll -= Math.max(0, e.weight);
    if (roll <= 0) return e.item;
  }
  return entries[entries.length - 1].item;
}

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

export function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
