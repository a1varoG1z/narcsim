import { getPlayerCartel } from "../../state.js";
import { escapeHtml, portraitImg, roleLabel } from "../../ui/components.js";
import { applyAction, getWarsForCartel, ACTION_COSTS, getActionsRemaining, isAttackable, MONEY_SCALE } from "../../turnEngine.js";
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
      <p class="text-dim small">Declarar guerra, atacar, ocupar y proponer paz/alianza no gastan acciones. Ordenar un atentado, sabotear y hacer una redada sí (te quedan ${getActionsRemaining(game)}).</p>
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
            <button class="danger" data-sabotage="${o.id}" ${cartel.resources.money < ACTION_COSTS.sabotage_rival || noActionsLeft ? "disabled" : ""}>Sabotear</button>
            <button class="danger" data-raid="${o.id}" ${cartel.resources.money < ACTION_COSTS.raid_territory || noActionsLeft ? "disabled" : ""}>Redada</button>
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
    showDeclareWarModal(app, game, cartel, btn.dataset.war);
  }));
  container.querySelectorAll("[data-peace]").forEach((btn) => btn.addEventListener("click", () => {
    showPeaceModal(app, game, cartel, btn.dataset.peace);
  }));
  container.querySelectorAll("[data-alliance]").forEach((btn) => btn.addEventListener("click", () => {
    showAllianceModal(app, game, cartel, btn.dataset.alliance);
  }));
  container.querySelectorAll("[data-view-cartel]").forEach((el) => el.addEventListener("click", () => {
    showCartelProfile(app, el.dataset.viewCartel);
  }));
  container.querySelectorAll("[data-assassinate]").forEach((btn) => btn.addEventListener("click", () => {
    showAssassinateModal(app, game, cartel, btn.dataset.assassinate);
  }));
  container.querySelectorAll("[data-sabotage]").forEach((btn) => btn.addEventListener("click", () => {
    if (!confirm(`¿Sabotear a ${game.cartels[btn.dataset.sabotage].name} por ${fmtMoney(ACTION_COSTS.sabotage_rival)}?`)) return;
    const result = applyAction(game, cartel.id, "sabotage_rival", { targetCartelId: btn.dataset.sabotage });
    app.setGame(game);
    if (!result.ok) alert(result.message);
    else alert(result.success ? `Sabotaje con éxito: le causas ${fmtMoney(result.damage)} en pérdidas.` : "El sabotaje fracasa y expone tu implicación.");
    app.render();
  }));
  container.querySelectorAll("[data-raid]").forEach((btn) => btn.addEventListener("click", () => {
    showRaidModal(app, game, cartel, btn.dataset.raid);
  }));
}

function showRaidModal(app, game, cartel, targetCartelId) {
  const target = game.cartels[targetCartelId];
  const reachable = target.territories.filter((tId) => isAttackable(game, cartel.id, tId)).map((tId) => game.territories[tId]);

  showModal(`
    <h2>Redada contra ${escapeHtml(target.name)}</h2>
    <p class="small text-dim">Coste: ${fmtMoney(ACTION_COSTS.raid_territory)}. Golpea instalaciones en un territorio suyo colindante con el tuyo: causa bajas y reduce su valor económico, sin intentar conquistarlo.</p>
    ${reachable.length ? reachable.map((t) => `
      <button class="block" data-territory="${t.id}">
        ${escapeHtml(t.name)}
        <div class="small text-dim">Valor económico: ${t.value}</div>
      </button>
    `).join("") : `<p class="small text-dim">No tienes ningún territorio colindante con los suyos.</p>`}
    <button class="ghost block" id="close-btn">Cancelar</button>
  `);
  document.getElementById("close-btn").addEventListener("click", closeModal);
  document.querySelectorAll("[data-territory]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const result = applyAction(game, cartel.id, "raid_territory", { territoryId: btn.dataset.territory });
      app.setGame(game);
      closeModal();
      if (!result.ok) alert(result.message);
      else alert(`La redada deja ${result.casualties} bajas y daña la zona.`);
      app.render();
    });
  });
}

function showAssassinateModal(app, game, cartel, targetCartelId) {
  const target = game.cartels[targetCartelId];
  const candidates = [target.roles.leader, ...ROLE_ORDER.map((r) => target.roles[r])]
    .filter((id, i, arr) => id && arr.indexOf(id) === i)
    .map((id) => game.characters[id])
    .filter((c) => c && c.alive);

  showModal(`
    <h2>Ordenar un atentado contra ${escapeHtml(target.name)}</h2>
    <p class="small text-dim">Coste: ${fmtMoney(ACTION_COSTS.assassinate_rival)}. El éxito depende de tu jefe de sicarios frente al sigilo del objetivo.</p>
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
      const targetChar = game.characters[btn.dataset.target];
      showAssassinateMethodModal(app, game, cartel, targetCartelId, targetChar);
    });
  });
}

function showAssassinateMethodModal(app, game, cartel, targetCartelId, targetChar) {
  const target = game.cartels[targetCartelId];

  const order = (method) => {
    const result = applyAction(game, cartel.id, "assassinate_rival", { targetCharacterId: targetChar.id, method });
    app.setGame(game);
    closeModal();
    if (!result.ok) {
      alert(result.message);
    } else {
      alert(result.success ? "El atentado tiene éxito." : "El atentado fracasa y expone tu implicación.");
    }
    app.render();
  };

  showModal(`
    <h2>¿Cómo ordenas el golpe contra ${escapeHtml(targetChar.name)}?</h2>
    <p class="small text-dim">La forma de hacerlo cambia tus probabilidades y las consecuencias si sale a la luz.</p>
    <button class="danger block" data-method="sicario">
      Golpe directo de tus sicarios
      <div class="small text-dim">La opción estándar, buena probabilidad de éxito. Tanto si falla como si tiene éxito quedará claro quién lo ordenó: entráis en guerra.</div>
    </button>
    <button class="danger block" data-method="accident">
      Disfrazarlo de accidente
      <div class="small text-dim">Más difícil de ejecutar con éxito, pero si sale bien nadie sospecha de ti por ahora y el heat apenas sube — no entráis en guerra. Si se descubre el montaje, la reacción es aún peor.</div>
    </button>
    <button class="danger block" data-method="public">
      Un ataque público y brutal, para sembrar el terror
      <div class="small text-dim">Algo más fácil de ejecutar y además daña la imagen pública de ${escapeHtml(target.name)}, pero el heat que generas es mucho mayor.</div>
    </button>
    <button class="ghost block mt-1" id="close-btn">Cancelar</button>
  `);
  document.getElementById("close-btn").addEventListener("click", closeModal);
  document.querySelectorAll("[data-method]").forEach((btn) => {
    btn.addEventListener("click", () => order(btn.dataset.method));
  });
}

function showDeclareWarModal(app, game, cartel, targetCartelId) {
  const target = game.cartels[targetCartelId];
  const tension = (cartel.relations[targetCartelId] || { tension: 0 }).tension;
  const justified = tension > 60;

  const declare = (pretext) => {
    applyAction(game, cartel.id, "declare_war", { targetCartelId, pretext });
    app.setGame(game);
    closeModal();
    app.render();
  };

  showModal(`
    <h2>Declarar la guerra a ${escapeHtml(target.name)}</h2>
    <p class="small text-dim">¿Cómo la declaras? Afecta a tu imagen pública, al heat que generas y, si golpeas por sorpresa, a tu primer ataque de este mismo turno.</p>
    <button class="danger block" data-pretext="none">
      Guerra abierta, sin excusas
      <div class="small text-dim">Sin efecto en tu imagen. Sube algo el heat.</div>
    </button>
    <button class="danger block" data-pretext="accusation">
      Denunciar públicamente una afrenta
      <div class="small text-dim">${justified ? "La tensión acumulada hace creíble la acusación: mejora tu imagen." : "Con tan poca tensión previa, nadie se lo cree: te pasa factura en imagen y heat."}</div>
    </button>
    <button class="danger block" data-pretext="surprise">
      Golpear por sorpresa, sin previo aviso
      <div class="small text-dim">No dices nada en público, pero el heat sube más. Si atacas uno de sus territorios este mismo turno, el factor sorpresa te da ventaja en esa batalla.</div>
    </button>
    <button class="ghost block mt-1" id="close-btn">Cancelar</button>
  `);
  document.getElementById("close-btn").addEventListener("click", closeModal);
  document.querySelectorAll("[data-pretext]").forEach((btn) => {
    btn.addEventListener("click", () => declare(btn.dataset.pretext));
  });
}

const GIFT_AMOUNTS = [200 * MONEY_SCALE, 800 * MONEY_SCALE, 2000 * MONEY_SCALE];

function showAllianceModal(app, game, cartel, targetCartelId) {
  const target = game.cartels[targetCartelId];
  const hasCommonEnemy = Object.entries(cartel.relations).some(
    ([id, rel]) => rel.status === "war" && target.relations[id]?.status === "war"
  );

  const send = (approach, giftAmount) => {
    const res = applyAction(game, cartel.id, "propose_alliance", { targetCartelId, approach, giftAmount });
    app.setGame(game);
    closeModal();
    if (!res.ok) {
      alert(res.message);
    } else {
      alert(res.accepted ? `${target.name} acepta la alianza.` : `${target.name} rechaza tu propuesta de alianza.`);
    }
    app.render();
  };

  showModal(`
    <h2>Proponer alianza a ${escapeHtml(target.name)}</h2>
    <p class="small text-dim">¿Cómo planteas la propuesta a su liderazgo? El enfoque influye en si la aceptan.</p>
    <button class="block" data-approach="business">
      Apelar al interés mutuo
      <div class="small text-dim">Más persuasivo cuanto mejor sea tu imagen pública (actual: ${cartel.resources.publicImage}).</div>
    </button>
    <button class="block" data-approach="commonEnemy">
      Apelar a un enemigo común
      <div class="small text-dim">${hasCommonEnemy ? "Tenéis un enemigo común de verdad: argumento muy convincente." : "No compartís ningún enemigo ahora mismo: sonará forzado."}</div>
    </button>
    <button class="block" id="gift-toggle">
      Ofrecer un gesto de buena fe (dinero por adelantado)
      <div class="small text-dim">Cuanto mayor el gesto, más confianza genera.</div>
    </button>
    <div id="gift-amounts" class="btn-row hidden mt-1">
      ${GIFT_AMOUNTS.map((amount) => `<button data-gift="${amount}" ${cartel.resources.money < amount ? "disabled" : ""}>${fmtMoney(amount)}</button>`).join("")}
    </div>
    <button class="ghost block mt-1" id="close-btn">Cancelar</button>
  `);
  document.getElementById("close-btn").addEventListener("click", closeModal);
  document.querySelector("[data-approach='business']").addEventListener("click", () => send("business"));
  document.querySelector("[data-approach='commonEnemy']").addEventListener("click", () => send("commonEnemy"));
  document.getElementById("gift-toggle").addEventListener("click", () => {
    document.getElementById("gift-amounts").classList.remove("hidden");
  });
  document.querySelectorAll("[data-gift]").forEach((btn) => {
    btn.addEventListener("click", () => send("gift", Number(btn.dataset.gift)));
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
