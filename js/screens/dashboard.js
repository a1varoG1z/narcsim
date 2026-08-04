import { getPlayerCartel, getPlayerCharacter, currentYear } from "../state.js";
import { fmtMoney, fmtNum } from "../utils/text.js";
import { escapeHtml } from "../ui/components.js";
import * as overview from "./tabs/overview.js";
import * as orgChart from "./tabs/orgChart.js";
import * as mapView from "./tabs/mapView.js";
import * as statsView from "./tabs/statsView.js";
import * as familyView from "./tabs/familyView.js";
import * as warsView from "./tabs/warsView.js";
import * as decisionsView from "./tabs/decisionsView.js";
import * as mediaView from "./tabs/mediaView.js";
import * as economyView from "./tabs/economyView.js";
import * as editorView from "./tabs/editorView.js";
import * as fallenView from "./tabs/fallenView.js";
import * as prisonersView from "./tabs/prisonersView.js";

const TABS = [
  { id: "overview", label: "Resumen", mod: overview },
  { id: "decisions", label: "Decisiones", mod: decisionsView },
  { id: "economy", label: "Economía", mod: economyView },
  { id: "org", label: "Organigrama", mod: orgChart },
  { id: "map", label: "Mapa", mod: mapView },
  { id: "wars", label: "Diplomacia", mod: warsView },
  { id: "media", label: "Medios", mod: mediaView },
  { id: "family", label: "Familia", mod: familyView },
  { id: "stats", label: "Estadísticas", mod: statsView },
  { id: "fallen", label: "Caídos", mod: fallenView },
  { id: "prisoners", label: "Presos", mod: prisonersView },
  { id: "editor", label: "Editor", mod: editorView },
];

export function render(container, app) {
  const game = app.game;
  if (!game) {
    app.navigate("menu");
    return;
  }
  const activeTab = app.state.activeTab || "overview";
  const cartel = getPlayerCartel(game);
  const character = getPlayerCharacter(game);

  container.innerHTML = `
    <div class="topbar">
      <div>
        <div class="brand">🌵 ${escapeHtml(game.eraName)}</div>
        <div class="meta">${currentYear(game)} · Turno ${game.turn}</div>
      </div>
      <div class="meta">
        ${fmtMoney(cartel.resources.money)} · Ejército ${fmtNum(cartel.resources.armySize)}<br>
        ${escapeHtml(character.name)}${character.imprisoned ? " (preso)" : ""}
      </div>
    </div>
    <nav class="tabs" id="tabbar" aria-label="Secciones del cártel">
      ${TABS.map((t) => `<button data-tab="${t.id}" class="${t.id === activeTab ? "active" : ""}" ${t.id === activeTab ? 'aria-current="page"' : ""}>${t.label}</button>`).join("")}
    </nav>
    <div class="container" id="tab-content"></div>
  `;

  container.querySelectorAll("#tabbar button").forEach((btn) => {
    btn.addEventListener("click", () => {
      app.setState({ activeTab: btn.dataset.tab });
    });
  });

  const activeMod = TABS.find((t) => t.id === activeTab)?.mod || overview;
  activeMod.render(container.querySelector("#tab-content"), app);
}
