// Real administrative-boundary shapes (Mexican states, Colombian departments, whole countries,
// etc.) used to render the territory map geographically instead of schematically. Sourced from
// public boundary datasets (Natural Earth / geoBoundaries derivatives, CC-BY-attributed) and
// pre-processed offline into simple SVG path data — see data/geo/shapes.json. Loaded lazily and
// cached module-wide since it's shared across every era/game, not per-save state.
const URL_PATH = new URL("../data/geo/shapes.json", import.meta.url);

let cache = null;
let loadingPromise = null;

export function getGeoShapes() {
  return cache;
}

export function preloadGeoShapes() {
  if (cache) return Promise.resolve(cache);
  if (loadingPromise) return loadingPromise;
  loadingPromise = fetch(URL_PATH)
    .then((res) => {
      if (!res.ok) throw new Error("No se pudieron cargar las formas geográficas del mapa");
      return res.json();
    })
    .then((data) => {
      cache = data;
      return data;
    });
  return loadingPromise;
}
