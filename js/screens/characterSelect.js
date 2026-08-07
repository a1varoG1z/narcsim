import { portraitImg, roleLabel, escapeHtml, readableColor } from "../ui/components.js";
import { ROLE_ORDER } from "../model.js";

export function render(container, app, { eraData }) {
  container.innerHTML = `
    <div class="container">
      <h1>${escapeHtml(eraData.name)}</h1>
      <div class="badge">${escapeHtml(eraData.period)}</div>
      <p>${escapeHtml(eraData.description)}</p>
      <h2>Juega como un narco existente</h2>
      <p class="text-dim small">Elige un cártel y qué personaje de su organigrama quieres encarnar.</p>
      ${eraData.cartels.map((cartel) => renderCartelChoice(eraData, cartel)).join("")}
      <h2 class="mt-2">O funda tu propio cártel</h2>
      <p class="text-dim small">Territorios disponibles: ${eraData.newCartelTerritories.map((id) => escapeHtml(eraData.territories.find((t) => t.id === id)?.name || id)).join(", ") || "ninguno en esta época"}</p>
      <button class="primary block" id="found-btn" ${eraData.newCartelTerritories.length ? "" : "disabled"}>Crear un narco nuevo</button>
      <button class="ghost block" id="back-btn">← Volver a épocas</button>
    </div>
  `;

  container.querySelectorAll("[data-play-char]").forEach((btn) => {
    btn.addEventListener("click", () => {
      app.startExistingGame(eraData, btn.dataset.playCartel, btn.dataset.playChar);
    });
  });
  container.querySelector("#found-btn")?.addEventListener("click", () => app.navigate("characterCreate", { eraData }));
  container.querySelector("#back-btn").addEventListener("click", () => app.navigate("eraSelect"));
}

function renderCartelChoice(eraData, cartel) {
  const chars = eraData.characters.filter((c) => c.cartelId === cartel.id);
  const roleHolders = ROLE_ORDER
    .map((role) => ({ role, char: chars.find((c) => c.role === role) }))
    .filter((r) => r.char);
  return `
    <div class="card">
      <h3 style="color:${readableColor(cartel.color)}">${escapeHtml(cartel.name)}</h3>
      <p class="small text-dim">${escapeHtml(cartel.historicalNote || "")}</p>
      <div class="grid auto">
        ${roleHolders.map(({ role, char }) => `
          <button data-play-cartel="${cartel.id}" data-play-char="${char.id}" class="tight">
            <div class="person-row" style="border:none;padding:0">
              ${portraitImg(char)}
              <div class="info">
                <div class="name">${escapeHtml(char.name)}</div>
                <div class="role">${escapeHtml(roleLabel(role, cartel))}</div>
              </div>
            </div>
          </button>
        `).join("")}
      </div>
    </div>
  `;
}
