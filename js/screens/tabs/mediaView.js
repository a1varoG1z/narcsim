import { getPlayerCartel } from "../../state.js";
import { statBar } from "../../ui/components.js";
import { applyAction } from "../../turnEngine.js";

const ACTIONS = [
  { type: "press_release", label: "Comunicado de prensa", cost: 80, desc: "Suaviza tu imagen ante la opinión pública local. Bajo riesgo, efecto modesto." },
  { type: "corridos_campaign", label: "Patrocinar corridos y narcocultura", cost: 150, desc: "Construye leyenda popular y reputación internacional, pero llama la atención: sube el heat." },
  { type: "social_work", label: "Obra social (escuelas, iglesias, caminos)", cost: 300, desc: "La estrategia clásica del 'Robin Hood': gran mejora de imagen y baja notable de heat." },
  { type: "international_interview", label: "Entrevista o documental internacional", cost: 200, desc: "Alto riesgo, alta recompensa: depende del carisma de tu líder o jefe de imagen. Si sale mal, expone al cártel." },
  { type: "damage_control", label: "Control de daños", cost: 250, desc: "Acalla un episodio violento reciente con una fuerte reducción de heat." },
];

export function render(container, app) {
  const game = app.game;
  const cartel = getPlayerCartel(game);
  const r = cartel.resources;

  container.innerHTML = `
    <div class="card">
      <h2>Medios e imagen pública</h2>
      ${statBar("Imagen pública", r.publicImage, "image")}
      ${statBar("Reputación internacional", r.internationalReputation ?? 15)}
      ${statBar("Nivel de búsqueda (heat)", r.heat, "heat")}
      <p class="text-dim small mt-1">La imagen pública mueve a la opinión local; la reputación internacional refleja tu fama fuera del país. Ambas influyen indirectamente en cómo te trata el mundo, pero la exposición tiene un precio.</p>
    </div>
    <div class="card">
      <h3>Acciones de imagen</h3>
      ${ACTIONS.map((a) => `
        <button class="block" data-action="${a.type}" ${r.money < a.cost ? "disabled" : ""}>
          <strong>${a.label}</strong> — $${a.cost}
          <div class="small text-dim">${a.desc}</div>
        </button>
      `).join("")}
    </div>
  `;

  container.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      applyAction(game, cartel.id, btn.dataset.action);
      app.setGame(game);
      app.render();
    });
  });
}
