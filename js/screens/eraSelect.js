import { loadEraIndex, loadEra } from "../dataLoader.js";

// One card per broad "vida criminal" — the type of organization the player wants to live,
// not the specific historical era. Picking one filters the era list below to just that type's
// eras instead of a single flat list mixing narco-trafficking with the Ley Seca, the yakuza, etc.
const LIFE_TYPES = [
  { id: "narcotrafico", icon: "🌿", name: "Narcotráfico", blurb: "Cárteles de droga en América Latina y sus rutas internacionales, de los años 70 hasta hoy." },
  { id: "mafia_italoamericana", icon: "🍷", name: "Mafia ítalo-americana", blurb: "Crimen organizado en Estados Unidos, de la Ley Seca de Al Capone a la Comisión de las Cinco Familias." },
  { id: "yakuza", icon: "⛩️", name: "Yakuza", blurb: "Sindicatos criminales japoneses, de la posguerra a la ley antibandas de 1992." },
  { id: "triadas", icon: "🐉", name: "Tríadas chinas", blurb: "Sociedades secretas chinas y el crimen organizado en la Hong Kong colonial." },
  { id: "mafia_postsovietica", icon: "🐻", name: "Mafia postsoviética", blurb: "Organizaciones criminales rusas surgidas tras la caída de la URSS." },
  { id: "trata_personas", icon: "🚢", name: "Contrabando de personas", blurb: "Redes de tráfico humano y contrabando de migrantes -- un negocio de personas, no de drogas." },
];

export async function render(container, app, data = {}) {
  container.innerHTML = `<div class="container"><h1>Elige una época</h1><p class="text-dim">Cargando épocas…</p></div>`;
  let eras;
  try {
    eras = await loadEraIndex();
  } catch (err) {
    container.innerHTML = `<div class="container"><p class="text-danger">Error cargando datos: ${err.message}</p></div>`;
    return;
  }

  const lifeType = data.lifeType || null;

  if (!lifeType) {
    renderLifeTypePicker(container, app, eras);
    return;
  }

  renderEraList(container, app, eras, lifeType);
}

function renderLifeTypePicker(container, app, eras) {
  const counts = {};
  for (const e of eras) counts[e.lifeType] = (counts[e.lifeType] || 0) + 1;

  container.innerHTML = `
    <div class="container">
      <h1>¿Qué vida criminal quieres vivir?</h1>
      <p class="text-dim">Cada tipo de organización trae su propio conjunto de épocas jugables.</p>
      ${LIFE_TYPES.filter((lt) => counts[lt.id]).map((lt) => `
        <div class="card era-card" data-life-type="${lt.id}">
          <h2>${lt.icon} ${lt.name}</h2>
          <div class="badge">${counts[lt.id]} época${counts[lt.id] === 1 ? "" : "s"}</div>
          <p>${lt.blurb}</p>
        </div>
      `).join("")}
      <button class="ghost block" id="back-btn">← Volver</button>
    </div>
  `;

  container.querySelectorAll("[data-life-type]").forEach((card) => {
    card.addEventListener("click", () => app.navigate("eraSelect", { lifeType: card.dataset.lifeType }));
  });
  container.querySelector("#back-btn").addEventListener("click", () => app.navigate("menu"));
}

function renderEraList(container, app, eras, lifeType) {
  const lifeTypeMeta = LIFE_TYPES.find((lt) => lt.id === lifeType);
  const filtered = eras.filter((e) => e.lifeType === lifeType);

  container.innerHTML = `
    <div class="container">
      <h1>${lifeTypeMeta ? `${lifeTypeMeta.icon} ${lifeTypeMeta.name}` : "Elige una época"}</h1>
      <p class="text-dim">Según la época que elijas se construirá el mapa de cárteles y personajes de esa etapa histórica.</p>
      ${filtered.map((e) => `
        <div class="card era-card" data-file="${e.file}">
          <h2>${e.name}</h2>
          <div class="badge">${e.period}</div>
          <p>${e.blurb}</p>
        </div>
      `).join("")}
      <button class="ghost block" id="back-btn">← Volver a tipos de organización</button>
    </div>
  `;

  container.querySelectorAll(".era-card").forEach((card) => {
    card.addEventListener("click", async () => {
      card.innerHTML = "<p>Cargando…</p>";
      try {
        const eraData = await loadEra(card.dataset.file);
        eraData.lifeType = lifeType;
        app.navigate("characterSelect", { eraData });
      } catch (err) {
        alert("No se pudo cargar la época: " + err.message);
      }
    });
  });
  container.querySelector("#back-btn").addEventListener("click", () => app.navigate("eraSelect"));
}
