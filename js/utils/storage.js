const LEGACY_SAVE_KEY = "narcosim.save.v1";
const SETTINGS_KEY = "narcosim.settings.v1";
const SLOTS_INDEX_KEY = "narcosim.slots.index.v1";
const SLOT_PREFIX = "narcosim.slot.";

function readIndex() {
  try {
    return JSON.parse(localStorage.getItem(SLOTS_INDEX_KEY)) || [];
  } catch {
    return [];
  }
}

function writeIndex(idx) {
  localStorage.setItem(SLOTS_INDEX_KEY, JSON.stringify(idx));
}

function migrateLegacySave() {
  if (readIndex().length || !localStorage.getItem(LEGACY_SAVE_KEY)) return;
  try {
    const game = JSON.parse(localStorage.getItem(LEGACY_SAVE_KEY));
    game.saveSlotId = `slot_migrated_${Date.now().toString(36)}`;
    localStorage.setItem(SLOT_PREFIX + game.saveSlotId, JSON.stringify(game));
    writeIndex([{ id: game.saveSlotId, name: `${game.eraName} — partida anterior`, eraName: game.eraName, turn: game.turn, year: game.year, updatedAt: Date.now() }]);
  } catch (err) {
    console.error("No se pudo migrar la partida anterior", err);
  }
  localStorage.removeItem(LEGACY_SAVE_KEY);
}

/** Returns save-slot metadata (not the full game state), newest first. */
export function listSaveSlots() {
  migrateLegacySave();
  return readIndex().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function saveGameToSlot(game, name) {
  try {
    if (!game.saveSlotId) {
      game.saveSlotId = `slot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    }
    if (name) game.saveName = name;
    localStorage.setItem(SLOT_PREFIX + game.saveSlotId, JSON.stringify(game));
    const idx = readIndex();
    const meta = {
      id: game.saveSlotId,
      name: game.saveName || game.eraName,
      eraName: game.eraName,
      turn: game.turn,
      year: game.year,
      updatedAt: Date.now(),
    };
    const i = idx.findIndex((s) => s.id === game.saveSlotId);
    if (i >= 0) idx[i] = meta;
    else idx.push(meta);
    writeIndex(idx);
    return true;
  } catch (err) {
    console.error("No se pudo guardar la partida", err);
    return false;
  }
}

export function loadGameSlot(slotId) {
  const raw = localStorage.getItem(SLOT_PREFIX + slotId);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error("Guardado corrupto", err);
    return null;
  }
}

export function deleteSaveSlot(slotId) {
  localStorage.removeItem(SLOT_PREFIX + slotId);
  writeIndex(readIndex().filter((s) => s.id !== slotId));
}

export function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {
    return {};
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function exportGameToFile(state) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const dateStr = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  a.href = url;
  a.download = `narcosim-partida-${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function importGameFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(reader.result));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

export function readImageAsDataURL(file, maxDim = 256) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
