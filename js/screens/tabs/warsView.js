import { getPlayerCartel } from "../../state.js";
import { escapeHtml, portraitImg, roleLabel } from "../../ui/components.js";
import { applyAction, getWarsForCartel, ACTION_COSTS, getActionsRemaining } from "../../turnEngine.js";
import { showModal, closeModal } from "../../ui/modal.js";
import { showCartelProfile } from "./cartelProfile.js";
import { fmtMoney } from "../../utils/text.js";
import { ROLE_ORDER } from "../../model.js";

const STATUS_LABEL = { war: "En guerra", alliance: "Aliados", neutral: "Neutral" };
const STATUS_CLASS = { war: "war", alliance: "alliance", neutral: "" };

export function render(container, app) {
  const game = app.game;
  const cartel = getPlayerCartel(game);
  const others = Object.values(game.cartels).filter((c) => c.id !== cartel.id && !c.destroyed);
  const noActionsLeft = getActionsRemaining(game) <= 0;

  container.innerHTML = `
    <div class="card">
      <h2>Relaciones exteriores</h2>
      <p class="text-dim small">Declarar guerra, atacar, ocupar y proponer paz/alianza no gastan acciones. Ordenar un atentado sí (te quedan ${getActionsRemaining(game)}).</p>
      ${others.map((o) => {
        const rel = cartel.relations[o.id] || { status: "neutral", tension: 0 };
        return `
        <div class="card tight mt-1">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <h3 data-view-cartel="${o.id}" style="cursor:pointer"><span style="display:inline-block;width:10px;height:10px;background:${o.color};border-radius:2px;margin-right:6px"></span>${escapeHtml(o.name)}</h3>
            <span class="badge ${STATUS_CLASS[rel.status]}">${STATUS_LABEL[rel.status]}</span>
          </div>
          <p class="small text-dim">Tensión: ${rel.tension}/100 · Ejército: ${o.resources.armySize} · Territorios: ${o.territories.length}</p>
          <div class="btn-row">
            ${rel.status !== "war" ? `<button class="danger" data-war="${o.id}">Declarar guerra</button>` : `<button data-peace="${o.id}">Proponer paz</button>`}
            ${rel.status === "neutral" ? `<button data-alliance="${o.id}">Proponer alianza</button>` : ""}
            <button class="danger" data-assassinate="${o.id}" ${cartel.resources.money < ACTION_COSTS.assassinate_rival || noActionsLeft ? "disabled" : ""}>Ordenar un atentado</button>
          </div>
        </div>`;
      }).join("")}
    </div>
    <div class="card">
      <h2>Historial de guerras</h2>
      ${renderWarHistory(game, cartel)}
    </div>
  `;

  container.querySelectorAll("[data-war]").forEach((btn) => btn.addEventListener("click", () => {
    applyAction(game, cartel.id, "declare_war", { targetCartelId: btn.dataset.war });
    app.setGame(game);
    app.render();
  }));
  container.querySelectorAll("[data-peace]").forEach((btn) => btn.addEventListener("click", () => {
    showPeaceModal(app, game, cartel, btn.dataset.peace);
  }));
  container.querySelectorAll("[data-alliance]").forEach((btn) => btn.addEventListener("click", () => {
    const res = applyAction(game, cartel.id, "propose_alliance", { targetCartelId: btn.dataset.alliance });
    app.setGame(game);
    alert(res.accepted ? "Han aceptado la alianza." : "Han rechazado tu propuesta de alianza.");
    app.render();
  }));
  container.querySelectorAll("[data-view-cartel]").forEach((el) => el.addEventListener("click", () => {
    showCartelProfile(app, el.dataset.viewCartel);
  }));
  container.querySelectorAll("[data-assassinate]").forEach((btn) => btn.addEventListener("click", () => {
    showAssassinateModal(app, game, cartel, btn.dataset.assassinate);
  }));
}

function showAssassinateModal(app, game, cartel, targetCartelId) {
  const target = game.cartels[targetCartelId];
  const candidates = [target.roles.leader, ...ROLE_ORDER.map((r) => target.roles[r])]
    .filter((id, i, arr) => id && arr.indexOf(id) === i)
    .map((id) => game.characters[id])
    .filter((c) => c && c.alive);

  showModal(`
    <h2>Ordenar un atentado contra ${escapeHtml(target.name)}</h2>
    <p class="small text-dim">Coste: ${fmtMoney(ACTION_COSTS.assassinate_rival)}. El éxito depende de tu jefe de sicarios frente al sigilo del objetivo. Si falla, o si tiene éxito, quedará claro quién lo ordenó: entráis en guerra.</p>
    ${candidates.length ? candidates.map((c) => `
      <button class="block" data-target="${c.id}">
        <div class="person-row" style="border:none;padding:0">
          ${portraitImg(c)}
          <div class="info"><div class="name">${escapeHtml(c.name)}</div><div class="role">${c.role ? roleLabel(c.role) : "Sin cargo"}</div></div>
        </div>
      </button>
    `).join("") : `<p class="small text-dim">No hay objetivos disponibles en este cártel.</p>`}
    <button class="ghost block" id="close-btn">Cancelar</button>
  `);
  document.getElementById("close-btn").addEventListener("click", closeModal);
  document.querySelectorAll("[data-target]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const result = applyAction(game, cartel.id, "assassinate_rival", { targetCharacterId: btn.dataset.target });
      app.setGame(game);
      closeModal();
      if (!result.ok) {
        alert(result.message);
      } else {
        alert(result.success ? "El atentado tiene éxito." : "El atentado fracasa y expone tu implicación.");
      }
      app.render();
    });
  });
}

function showPeaceModal(app, game, cartel, targetCartelId) {
  const target = game.cartels[targetCartelId];
  const myTerritories = cartel.territories.map((id) => game.territories[id]).filter(Boolean);
  const muchStronger = cartel.resources.armySize > target.resources.armySize * 1.5;

  showModal(`
    <h2>Proponer paz a ${escapeHtml(target.name)}</h2>
    <p class="small text-dim">Endulzar la oferta cediendo un territorio sube mucho las probabilidades de que la acepten; exigir una indemnización las baja, pero solo tiene sentido si les superas claramente en fuerza.</p>
    <label for="peace-cede">Ceder un territorio (opcional)</label>
    <select id="peace-cede">
      <option value="">Ninguno</option>
      ${myTerritories.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("")}
    </select>
    <label style="display:flex;align-items:center;gap:.5rem;margin-top:.8rem">
      <input type="checkbox" id="peace-indemnity" ${muchStronger ? "" : "disabled"}>
      Exigir indemnización (20% de su dinero)${muchStronger ? "" : " — necesitas superarles claramente en ejército"}
    </label>
    <div class="btn-row mt-2">
      <button class="primary block" id="send-peace">Enviar propuesta</button>
      <button class="ghost block" id="close-btn">Cancelar</button>
    </div>
  `);
  document.getElementById("close-btn").addEventListener("click", closeModal);
  document.getElementById("send-peace").addEventListener("click", () => {
    const cedeTerritoryId = document.getElementById("peace-cede").value || undefined;
    const demandIndemnity = document.getElementById("peace-indemnity").checked;
    const res = applyAction(game, cartel.id, "propose_peace", { targetCartelId, cedeTerritoryId, demandIndemnity });
    app.setGame(game);
    closeModal();
    if (!res.accepted) {
      alert("Han rechazado tu propuesta de paz.");
    } else {
      let msg = "Han aceptado la paz.";
      if (res.cededTerritory) msg += ` Cedes ${res.cededTerritory}.`;
      if (res.indemnity) msg += ` Recibes ${fmtMoney(res.indemnity)} de indemnización.`;
      alert(msg);
    }
    app.render();
  });
}

function renderWarHistory(game, cartel) {
  const wars = getWarsForCartel(game, cartel.id).sort((a, b) => b.startYear - a.startYear);
  if (!wars.length) return `<p class="text-dim small">Tu cártel no ha entrado en guerra todavía.</p>`;
  return wars.map((w) => {
    const otherId = w.cartelA === cartel.id ? w.cartelB : w.cartelA;
    const other = game.cartels[otherId];
    const myCasualties = w.cartelA === cartel.id ? w.casualtiesA : w.casualtiesB;
    const theirCasualties = w.cartelA === cartel.id ? w.casualtiesB : w.casualtiesA;
    const duration = (w.endYear ?? game.year) - w.startYear;
    return `<div class="card tight mt-1">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h3>${escapeHtml(other?.name || "Cártel desaparecido")}</h3>
        <span class="badge ${w.endYear ? "" : "war"}">${w.endYear ? `Terminada (${duration} años)` : "En curso"}</span>
      </div>
      <p class="small text-dim">${w.startYear}${w.endYear ? ` – ${w.endYear}` : " – presente"} · Tus bajas: ${myCasualties} · Sus bajas: ${theirCasualties}</p>
      ${w.territoryChanges.length ? `<p class="small">Territorios en disputa: ${w.territoryChanges.map((tc) => `${escapeHtml(tc.territoryName)} (${tc.year}, para ${escapeHtml(game.cartels[tc.to]?.name || "?")})`).join(", ")}</p>` : ""}
      ${w.treatyNote ? `<p class="small text-dim">Términos del tratado:${escapeHtml(w.treatyNote)}</p>` : ""}
    </div>`;
  }).join("");
}
