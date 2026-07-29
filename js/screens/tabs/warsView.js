import { getPlayerCartel } from "../../state.js";
import { escapeHtml } from "../../ui/components.js";
import { applyAction } from "../../turnEngine.js";

const STATUS_LABEL = { war: "En guerra", alliance: "Aliados", neutral: "Neutral" };
const STATUS_CLASS = { war: "war", alliance: "alliance", neutral: "" };

export function render(container, app) {
  const game = app.game;
  const cartel = getPlayerCartel(game);
  const others = Object.values(game.cartels).filter((c) => c.id !== cartel.id && !c.destroyed);

  container.innerHTML = `
    <div class="card">
      <h2>Relaciones exteriores</h2>
      ${others.map((o) => {
        const rel = cartel.relations[o.id] || { status: "neutral", tension: 0 };
        return `
        <div class="card tight mt-1">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <h3><span style="display:inline-block;width:10px;height:10px;background:${o.color};border-radius:2px;margin-right:6px"></span>${escapeHtml(o.name)}</h3>
            <span class="badge ${STATUS_CLASS[rel.status]}">${STATUS_LABEL[rel.status]}</span>
          </div>
          <p class="small text-dim">Tensión: ${rel.tension}/100 · Ejército: ${o.resources.armySize} · Territorios: ${o.territories.length}</p>
          <div class="btn-row">
            ${rel.status !== "war" ? `<button class="danger" data-war="${o.id}">Declarar guerra</button>` : `<button data-peace="${o.id}">Proponer paz</button>`}
            ${rel.status === "neutral" ? `<button data-alliance="${o.id}">Proponer alianza</button>` : ""}
          </div>
        </div>`;
      }).join("")}
    </div>
  `;

  container.querySelectorAll("[data-war]").forEach((btn) => btn.addEventListener("click", () => {
    applyAction(game, cartel.id, "declare_war", { targetCartelId: btn.dataset.war });
    app.setGame(game);
    app.render();
  }));
  container.querySelectorAll("[data-peace]").forEach((btn) => btn.addEventListener("click", () => {
    const res = applyAction(game, cartel.id, "propose_peace", { targetCartelId: btn.dataset.peace });
    app.setGame(game);
    alert(res.accepted ? "Han aceptado la paz." : "Han rechazado tu propuesta de paz.");
    app.render();
  }));
  container.querySelectorAll("[data-alliance]").forEach((btn) => btn.addEventListener("click", () => {
    const res = applyAction(game, cartel.id, "propose_alliance", { targetCartelId: btn.dataset.alliance });
    app.setGame(game);
    alert(res.accepted ? "Han aceptado la alianza." : "Han rechazado tu propuesta de alianza.");
    app.render();
  }));
}
