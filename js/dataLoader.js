const BASE = new URL("../data/eras/", import.meta.url);

export async function loadEraIndex() {
  const res = await fetch(new URL("index.json", BASE));
  if (!res.ok) throw new Error("No se pudo cargar el índice de épocas");
  return res.json();
}

export async function loadEra(fileName) {
  const res = await fetch(new URL(fileName, BASE));
  if (!res.ok) throw new Error(`No se pudo cargar la época ${fileName}`);
  return res.json();
}
