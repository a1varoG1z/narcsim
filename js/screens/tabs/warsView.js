import { getPlayerCartel } from "../../state.js";
import { escapeHtml, portraitImg, roleLabel } from "../../ui/components.js";
import { applyAction, getWarsForCartel, ACTION_COSTS, getActionsRemaining, isAttackable, MONEY_SCALE, canProposeAbsorption, PROPOSE_ABSORPTION_COST } from "../../turnEngine.js";
import { showModal, closeModal } from "../../ui/modal.js";
import { showCartelProfile } from "./cartelProfile.js";
import { fmtMoney } from "../../utils/text.js";
import { ROLE_ORDER } from "../../model.js";
import { defaultPoachDialogue, defaultInformantDialogue } from "../../dialogues.js";
import { loadSettings, saveSettings } from "../../utils/storage.js";

const STATUS_LABEL = { war: "En guerra", alliance: "Aliados", neutral: "Neutral" };
const STATUS_CLASS = { war: "war", alliance: "alliance", neutral: "" };
const NEUTRAL_QUICK_PERSUASION = 2;

export function render(container, app) {
  const game = app.game;
  const cartel = getPlayerCartel(game);
  const others = Object.values(game.cartels).filter((c) => c.id !== cartel.id && !c.destroyed);
  const noActionsLeft = getActionsRemaining(game) <= 0;
  const internalTargets = ROLE_ORDER
    .filter((role) => role !== "leader")
    .map((role) => cartel.roles[role])
    .filter((id, i, arr) => id && id !== game.playerCharacterId && arr.indexOf(id) === i)
    .map((id) => game.characters[id])
    .filter((c) => c && c.alive);

  container.innerHTML = `
    <div class="card">
      <h2>Relaciones exteriores</h2>
      <p class="text-dim small">Declarar guerra, atacar, ocupar, proponer paz/alianza/subordinación y concentrar fuerzas en un frente no gastan acciones. Ordenar un atentado, sabotear, hacer una redada, intimidar, reclutar informantes, reclutar a un miembro rival e interceptar un cargamento sí (te quedan ${getActionsRemaining(game)}).</p>
      ${others.map((o) => {
        const rel = cartel.relations[o.id] || { status: "neutral", tension: 0 };
        return `
        <div class="card tight mt-1">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <h3 data-view-cartel="${o.id}" style="cursor:pointer"><span style="display:inline-block;width:10px;height:10px;background:${o.color};border-radius:2px;margin-right:6px"></span>${escapeHtml(o.name)}</h3>
            <span class="badge ${STATUS_CLASS[rel.status]}">${STATUS_LABEL[rel.status]}</span>
          </div>
          <p class="small text-dim">Tensión: ${rel.tension}/100 · Ejército: ${o.resources.armySize} · Territorios: ${o.territories.length}</p>
          ${hasActiveInformant(cartel, o.id) ? `<p class="small text-dim">🕵️ ${cartel.informants[o.id].characterId && game.characters[cartel.informants[o.id].characterId] ? `${escapeHtml(game.characters[cartel.informants[o.id].characterId].name)} te informa desde dentro` : "Tienes un informante infiltrado aquí"} (${cartel.informants[o.id].turnsRemaining} turnos más): mejores probabilidades en atentados y sabotajes.</p>` : ""}
          ${rel.status === "war" && cartel.warFocus?.targetCartelId === o.id ? `<p class="small text-success">🎯 Fuerzas concentradas en este frente (${cartel.warFocus.turnsRemaining} turnos más): más poder de combate aquí, menos en tus otros frentes abiertos.</p>` : ""}
          <div class="btn-row">
            ${rel.status !== "war" ? `<button class="danger" data-war="${o.id}">Declarar guerra</button>` : `<button data-peace="${o.id}">Proponer paz</button>`}
            ${rel.status === "neutral" ? `<button data-alliance="${o.id}">Proponer alianza</button>` : ""}
            ${rel.status === "war" ? (cartel.warFocus?.targetCartelId === o.id
              ? `<button data-clear-focus="${o.id}">Quitar foco</button>`
              : `<button data-focus="${o.id}">Concentrar fuerzas aquí</button>`) : ""}
            <button data-absorb="${o.id}" ${cartel.resources.money < PROPOSE_ABSORPTION_COST || !canProposeAbsorption(cartel, o) ? "disabled" : ""}>Proponer subordinación</button>
            <button class="danger" data-assassinate="${o.id}" ${cartel.resources.money < ACTION_COSTS.assassinate_rival || noActionsLeft ? "disabled" : ""}>Ordenar un atentado</button>
            <button class="danger" data-sabotage="${o.id}" ${cartel.resources.money < ACTION_COSTS.sabotage_rival || noActionsLeft ? "disabled" : ""}>Sabotear</button>
            <button class="danger" data-intercept="${o.id}" ${cartel.resources.money < ACTION_COSTS.intercept_shipment || noActionsLeft ? "disabled" : ""}>Interceptar un cargamento</button>
            <button class="danger" data-raid="${o.id}" ${cartel.resources.money < ACTION_COSTS.raid_territory || noActionsLeft ? "disabled" : ""}>Redada</button>
            <button class="danger" data-intimidate="${o.id}" ${cartel.resources.money < ACTION_COSTS.intimidate_territory || noActionsLeft ? "disabled" : ""}>Intimidar</button>
            <button data-informant="${o.id}" ${cartel.resources.money < ACTION_COSTS.recruit_informant || noActionsLeft || hasActiveInformant(cartel, o.id) ? "disabled" : ""}>Reclutar informante</button>
            <button data-poach="${o.id}" ${cartel.resources.money < ACTION_COSTS.poach_member || noActionsLeft ? "disabled" : ""}>Reclutar a un miembro</button>
          </div>
        </div>`;
      }).join("")}
    </div>
    <div class="card">
      <h2>Purga interna</h2>
      <p class="text-dim small">Ordena un atentado contra alguien de tu propio cártel (por ejemplo, un traidor ya descubierto). No hay guerra que declarar, pero un golpe contra los tuyos siembra desconfianza en el resto de tu cúpula, tanto si sale bien como si fracasa.</p>
      ${internalTargets.length ? internalTargets.map((m) => `
        <div class="person-row">
          <div style="display:flex;gap:.6rem;flex:1;min-width:0;align-items:center">
            ${portraitImg(m)}
            <div class="info"><div class="name">${escapeHtml(m.name)}</div><div class="role">${m.role ? roleLabel(m.role) : "Sin cargo"}</div></div>
          </div>
          <button class="danger" data-purge="${m.id}" ${cartel.resources.money < ACTION_COSTS.assassinate_rival || noActionsLeft ? "disabled" : ""}>Ordenar un atentado</button>
        </div>
      `).join("") : `<p class="small text-dim">No hay nadie más en tu cúpula ahora mismo.</p>`}
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
  container.querySelectorAll("[data-absorb]").forEach((btn) => btn.addEventListener("click", () => {
    showAbsorptionModal(app, game, cartel, btn.dataset.absorb);
  }));
  container.querySelectorAll("[data-focus]").forEach((btn) => btn.addEventListener("click", () => {
    applyAction(game, cartel.id, "set_war_focus", { targetCartelId: btn.dataset.focus });
    app.setGame(game);
    app.render();
  }));
  container.querySelectorAll("[data-clear-focus]").forEach((btn) => btn.addEventListener("click", () => {
    applyAction(game, cartel.id, "set_war_focus", { targetCartelId: null });
    app.setGame(game);
    app.render();
  }));
  container.querySelectorAll("[data-view-cartel]").forEach((el) => el.addEventListener("click", () => {
    showCartelProfile(app, el.dataset.viewCartel);
  }));
  container.querySelectorAll("[data-assassinate]").forEach((btn) => btn.addEventListener("click", () => {
    showAssassinateModal(app, game, cartel, btn.dataset.assassinate);
  }));
  container.querySelectorAll("[data-purge]").forEach((btn) => btn.addEventListener("click", () => {
    showAssassinateMethodModal(app, game, cartel, cartel.id, game.characters[btn.dataset.purge]);
  }));
  container.querySelectorAll("[data-sabotage]").forEach((btn) => btn.addEventListener("click", () => {
    showSabotageApproachModal(app, game, cartel, btn.dataset.sabotage);
  }));
  container.querySelectorAll("[data-intercept]").forEach((btn) => btn.addEventListener("click", () => {
    if (!confirm(`¿Interceptar un cargamento de ${game.cartels[btn.dataset.intercept].name} por ${fmtMoney(ACTION_COSTS.intercept_shipment)}?`)) return;
    const result = applyAction(game, cartel.id, "intercept_shipment", { targetCartelId: btn.dataset.intercept });
    app.setGame(game);
    if (!result.ok) alert(result.message);
    else alert(result.success ? `Interceptado con éxito: les causas ${fmtMoney(result.seized)} en pérdidas y te llevas ${fmtMoney(result.gained)}.` : "El intento termina en un tiroteo y fracasa.");
    app.render();
  }));
  container.querySelectorAll("[data-raid]").forEach((btn) => btn.addEventListener("click", () => {
    showRaidModal(app, game, cartel, btn.dataset.raid);
  }));
  container.querySelectorAll("[data-intimidate]").forEach((btn) => btn.addEventListener("click", () => {
    showIntimidateModal(app, game, cartel, btn.dataset.intimidate);
  }));
  container.querySelectorAll("[data-informant]").forEach((btn) => btn.addEventListener("click", () => {
    showInformantModal(app, game, cartel, btn.dataset.informant);
  }));
  container.querySelectorAll("[data-poach]").forEach((btn) => btn.addEventListener("click", () => {
    showPoachModal(app, game, cartel, btn.dataset.poach);
  }));
}

function showPoachModal(app, game, cartel, targetCartelId) {
  const target = game.cartels[targetCartelId];
  const candidates = ROLE_ORDER
    .filter((role) => role !== "leader")
    .map((role) => target.roles[role])
    .filter((id, i, arr) => id && arr.indexOf(id) === i)
    .map((id) => game.characters[id])
    .filter((c) => c && c.alive);
  const quickMode = !!loadSettings().quickDialogueMode;

  showModal(`
    <h2>Reclutar a un miembro de ${escapeHtml(target.name)}</h2>
    <p class="small text-dim">Coste: ${fmtMoney(ACTION_COSTS.poach_member)}. Ofreces un cambio de bando a alguien de su cúpula (nunca a su líder): cuanto más leal sea a su jefe, más difícil será convencerlo, y cómo lleves la conversación también cuenta. Si ya estáis en guerra, es más fácil que acepte desertar.</p>
    ${candidates.length ? candidates.map((c) => `
      <button class="block" data-target="${c.id}">
        <div class="person-row" style="border:none;padding:0">
          ${portraitImg(c)}
          <div class="info"><div class="name">${escapeHtml(c.name)}</div><div class="role">${c.role ? roleLabel(c.role) : "Sin cargo"}</div></div>
        </div>
      </button>
    `).join("") : `<p class="small text-dim">No hay objetivos disponibles en este cártel.</p>`}
    <label style="display:flex;align-items:center;gap:.5rem;margin-top:.8rem">
      <input type="checkbox" id="quick-mode-toggle" ${quickMode ? "checked" : ""}>
      Modo rápido (resolver al instante, sin conversación)
    </label>
    <button class="ghost block mt-1" id="close-btn">Cancelar</button>
  `);
  document.getElementById("quick-mode-toggle").addEventListener("change", (e) => {
    saveSettings({ ...loadSettings(), quickDialogueMode: e.target.checked });
  });
  document.getElementById("close-btn").addEventListener("click", closeModal);
  document.querySelectorAll("[data-target]").forEach((btn) => {
    btn.addEventListener("click", () => {
      closeModal();
      startPoachDialogue(app, game, cartel, btn.dataset.target);
    });
  });
}

function startPoachDialogue(app, game, cartel, targetCharacterId) {
  if (loadSettings().quickDialogueMode) {
    finishPoachDialogue(app, game, cartel, targetCharacterId, "attempt", NEUTRAL_QUICK_PERSUASION);
    return;
  }
  if (!game.dialogueTrees) game.dialogueTrees = {};
  if (!game.dialogueTrees.poach) game.dialogueTrees.poach = defaultPoachDialogue();
  const tree = game.dialogueTrees.poach;
  if (!tree.nodes[tree.start]) {
    alert("No hay un diálogo configurado para este momento. Revísalo en el Editor.");
    return;
  }
  runPoachDialogueNode(app, game, cartel, tree, targetCharacterId, tree.start, 0);
}

function runPoachDialogueNode(app, game, cartel, tree, targetCharacterId, nodeId, persuasion) {
  const target = game.characters[targetCharacterId];
  const node = tree.nodes[nodeId];
  if (!node) return;
  const text = node.text.replace(/\{partner\}/g, escapeHtml(target?.name || ""));

  showModal(`
    <h2>${escapeHtml(target?.name || "")}</h2>
    <p>${text}</p>
    ${node.options.map((opt, i) => `<button class="block" data-option="${i}">${escapeHtml(opt.label)}</button>`).join("")}
  `);

  document.querySelectorAll("[data-option]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const option = node.options[Number(btn.dataset.option)];
      const nextPersuasion = persuasion + (option.warmth || 0);
      if (option.resolve) {
        closeModal();
        finishPoachDialogue(app, game, cartel, targetCharacterId, option.resolve, nextPersuasion);
      } else if (option.next) {
        runPoachDialogueNode(app, game, cartel, tree, targetCharacterId, option.next, nextPersuasion);
      } else {
        closeModal();
      }
    });
  });
}

function finishPoachDialogue(app, game, cartel, targetCharacterId, resolution, persuasion) {
  if (resolution === "walk_away") {
    showModal(`
      <h2>No hay trato</h2>
      <p>La conversación no llega a ningún lado. Podrás intentarlo de nuevo más adelante.</p>
      <button class="primary block" id="ok-btn">Aceptar</button>
    `);
  } else {
    const result = applyAction(game, cartel.id, "poach_member", { targetCharacterId, persuasionBoost: persuasion });
    if (!result.ok) {
      showModal(`<h2>No ha sido posible</h2><p>${escapeHtml(result.message || "")}</p><button class="primary block" id="ok-btn">Aceptar</button>`);
    } else {
      showModal(`
        <h2>${result.success ? "Se une a tu cártel" : "El intento fracasa"}</h2>
        <p>${result.success ? "Acepta el cambio de bando." : "No consigues convencerlo/a, y la maniobra queda expuesta."}</p>
        <button class="primary block" id="ok-btn">Aceptar</button>
      `);
    }
  }
  document.getElementById("ok-btn").addEventListener("click", () => {
    closeModal();
    app.setGame(game);
    app.render();
  });
}

function showInformantModal(app, game, cartel, targetCartelId) {
  const target = game.cartels[targetCartelId];
  const candidates = ROLE_ORDER
    .filter((role) => role !== "leader")
    .map((role) => target.roles[role])
    .filter((id, i, arr) => id && arr.indexOf(id) === i)
    .map((id) => game.characters[id])
    .filter((c) => c && c.alive);
  const quickMode = !!loadSettings().quickDialogueMode;

  showModal(`
    <h2>Reclutar un informante dentro de ${escapeHtml(target.name)}</h2>
    <p class="small text-dim">Coste: ${fmtMoney(ACTION_COSTS.recruit_informant)}. A diferencia de "Reclutar a un miembro", no cambia de bando: sigue donde está, pero te pasa información — cuanto más leal sea a su jefe, más difícil será convencerlo, y cómo lleves la conversación también cuenta.</p>
    ${candidates.length ? candidates.map((c) => `
      <button class="block" data-target="${c.id}">
        <div class="person-row" style="border:none;padding:0">
          ${portraitImg(c)}
          <div class="info"><div class="name">${escapeHtml(c.name)}</div><div class="role">${c.role ? roleLabel(c.role) : "Sin cargo"}</div></div>
        </div>
      </button>
    `).join("") : `<p class="small text-dim">No hay objetivos disponibles en este cártel.</p>`}
    <label style="display:flex;align-items:center;gap:.5rem;margin-top:.8rem">
      <input type="checkbox" id="quick-mode-toggle" ${quickMode ? "checked" : ""}>
      Modo rápido (resolver al instante, sin conversación)
    </label>
    <button class="ghost block mt-1" id="close-btn">Cancelar</button>
  `);
  document.getElementById("quick-mode-toggle").addEventListener("change", (e) => {
    saveSettings({ ...loadSettings(), quickDialogueMode: e.target.checked });
  });
  document.getElementById("close-btn").addEventListener("click", closeModal);
  document.querySelectorAll("[data-target]").forEach((btn) => {
    btn.addEventListener("click", () => {
      closeModal();
      startInformantDialogue(app, game, cartel, btn.dataset.target);
    });
  });
}

function startInformantDialogue(app, game, cartel, targetCharacterId) {
  if (loadSettings().quickDialogueMode) {
    finishInformantDialogue(app, game, cartel, targetCharacterId, "attempt", NEUTRAL_QUICK_PERSUASION);
    return;
  }
  if (!game.dialogueTrees) game.dialogueTrees = {};
  if (!game.dialogueTrees.informant) game.dialogueTrees.informant = defaultInformantDialogue();
  const tree = game.dialogueTrees.informant;
  if (!tree.nodes[tree.start]) {
    alert("No hay un diálogo configurado para este momento. Revísalo en el Editor.");
    return;
  }
  runInformantDialogueNode(app, game, cartel, tree, targetCharacterId, tree.start, 0);
}

function runInformantDialogueNode(app, game, cartel, tree, targetCharacterId, nodeId, persuasion) {
  const target = game.characters[targetCharacterId];
  const node = tree.nodes[nodeId];
  if (!node) return;
  const text = node.text.replace(/\{partner\}/g, escapeHtml(target?.name || ""));

  showModal(`
    <h2>${escapeHtml(target?.name || "")}</h2>
    <p>${text}</p>
    ${node.options.map((opt, i) => `<button class="block" data-option="${i}">${escapeHtml(opt.label)}</button>`).join("")}
  `);

  document.querySelectorAll("[data-option]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const option = node.options[Number(btn.dataset.option)];
      const nextPersuasion = persuasion + (option.warmth || 0);
      if (option.resolve) {
        closeModal();
        finishInformantDialogue(app, game, cartel, targetCharacterId, option.resolve, nextPersuasion);
      } else if (option.next) {
        runInformantDialogueNode(app, game, cartel, tree, targetCharacterId, option.next, nextPersuasion);
      } else {
        closeModal();
      }
    });
  });
}

function finishInformantDialogue(app, game, cartel, targetCharacterId, resolution, persuasion) {
  if (resolution === "walk_away") {
    showModal(`
      <h2>No hay trato</h2>
      <p>La conversación no llega a ningún lado. Podrás intentarlo de nuevo más adelante.</p>
      <button class="primary block" id="ok-btn">Aceptar</button>
    `);
  } else {
    const result = applyAction(game, cartel.id, "recruit_informant", { targetCharacterId, persuasionBoost: persuasion });
    if (!result.ok) {
      showModal(`<h2>No ha sido posible</h2><p>${escapeHtml(result.message || "")}</p><button class="primary block" id="ok-btn">Aceptar</button>`);
    } else {
      showModal(`
        <h2>${result.success ? "Acepta informar" : "El intento fracasa"}</h2>
        <p>${result.success ? "A partir de ahora te pasa información desde dentro." : "No consigues convencerlo/a, y la maniobra despierta sospechas."}</p>
        <button class="primary block" id="ok-btn">Aceptar</button>
      `);
    }
  }
  document.getElementById("ok-btn").addEventListener("click", () => {
    closeModal();
    app.setGame(game);
    app.render();
  });
}

function showIntimidateModal(app, game, cartel, targetCartelId) {
  const target = game.cartels[targetCartelId];
  const reachable = target.territories.filter((tId) => isAttackable(game, cartel.id, tId)).map((tId) => game.territories[tId]);

  showModal(`
    <h2>Intimidar a ${escapeHtml(target.name)}</h2>
    <p class="small text-dim">Coste: ${fmtMoney(ACTION_COSTS.intimidate_territory)}. Un despliegue de amenazas en un territorio suyo colindante con el tuyo, sin enfrentamiento armado: si sale bien, daña su reputación local y el valor del territorio, sin bajas para nadie. Si fracasa, la amenaza queda expuesta y te cuesta más heat.</p>
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
      const result = applyAction(game, cartel.id, "intimidate_territory", { territoryId: btn.dataset.territory });
      app.setGame(game);
      closeModal();
      if (!result.ok) alert(result.message);
      else alert(result.success ? "La intimidación funciona: dañas su reputación local sin derramar sangre." : "El intento fracasa y expone la amenaza.");
      app.render();
    });
  });
}

function hasActiveInformant(cartel, targetCartelId) {
  return !!(cartel.informants && cartel.informants[targetCartelId] && cartel.informants[targetCartelId].turnsRemaining > 0);
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
      showRaidApproachModal(app, game, cartel, game.territories[btn.dataset.territory]);
    });
  });
}

function showRaidApproachModal(app, game, cartel, territory) {
  const apply = (approach) => {
    const result = applyAction(game, cartel.id, "raid_territory", { territoryId: territory.id, approach });
    app.setGame(game);
    closeModal();
    if (!result.ok) alert(result.message);
    else alert(`La redada deja ${result.casualties} bajas y daña la zona.`);
    app.render();
  };

  showModal(`
    <h2>¿Cómo llevas la redada contra ${escapeHtml(territory.name)}?</h2>
    <p class="small text-dim">El método cambia cuánto daño causas y cuánto heat y riesgo asumes tú mismo.</p>
    <button class="block" data-approach="surgical">
      Golpe quirúrgico
      <div class="small text-dim">Menos bajas causadas y menos daño al territorio, pero también mucho menos heat para los dos bandos.</div>
    </button>
    <button class="danger block" data-approach="standard">
      Redada estándar
      <div class="small text-dim">El equilibrio de siempre entre bajas causadas, daño al territorio y heat.</div>
    </button>
    <button class="danger block" data-approach="all_out">
      Asalto total
      <div class="small text-dim">Muchas más bajas causadas y mucho más daño al territorio, pero dispara el heat de ambos bandos y el enfrentamiento te cuesta también bajas propias.</div>
    </button>
    <button class="ghost block mt-1" id="close-btn">Cancelar</button>
  `);
  document.getElementById("close-btn").addEventListener("click", closeModal);
  document.querySelectorAll("[data-approach]").forEach((btn) => {
    btn.addEventListener("click", () => apply(btn.dataset.approach));
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
  const isInternal = targetCartelId === cartel.id;
  const target = isInternal ? cartel : game.cartels[targetCartelId];

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
      <div class="small text-dim">La opción estándar, buena probabilidad de éxito. ${isInternal ? "Tanto si falla como si tiene éxito, el resto de tu cúpula sabrá que fuiste tú y confiará menos en ti." : "Tanto si falla como si tiene éxito quedará claro quién lo ordenó: entráis en guerra."}</div>
    </button>
    <button class="danger block" data-method="accident">
      Disfrazarlo de accidente
      <div class="small text-dim">Más difícil de ejecutar con éxito, pero si sale bien nadie sospecha de ti por ahora y el heat apenas sube${isInternal ? "" : " — no entráis en guerra"}. Si se descubre el montaje, la reacción es aún peor.</div>
    </button>
    <button class="danger block" data-method="public">
      Un ataque público y brutal, para sembrar el terror
      <div class="small text-dim">Algo más fácil de ejecutar${isInternal ? `, pero daña tu propia imagen pública y siembra el pánico entre tus propios mandos` : ` y además daña la imagen pública de ${escapeHtml(target.name)}`}, y el heat que generas es mucho mayor.</div>
    </button>
    <button class="ghost block mt-1" id="close-btn">Cancelar</button>
  `);
  document.getElementById("close-btn").addEventListener("click", closeModal);
  document.querySelectorAll("[data-method]").forEach((btn) => {
    btn.addEventListener("click", () => order(btn.dataset.method));
  });
}

function showSabotageApproachModal(app, game, cartel, targetCartelId) {
  const target = game.cartels[targetCartelId];

  const apply = (approach) => {
    const result = applyAction(game, cartel.id, "sabotage_rival", { targetCartelId, approach });
    app.setGame(game);
    closeModal();
    if (!result.ok) alert(result.message);
    else alert(result.success ? `Sabotaje con éxito: le causas ${fmtMoney(result.damage)} en pérdidas.` : "El sabotaje fracasa y expone tu implicación.");
    app.render();
  };

  showModal(`
    <h2>¿Cómo saboteas a ${escapeHtml(target.name)}?</h2>
    <p class="small text-dim">Coste: ${fmtMoney(ACTION_COSTS.sabotage_rival)}. El método cambia cuánto daño causas, cuánto heat te cuesta y qué tan a la vista queda tu implicación.</p>
    <button class="block" data-approach="covert">
      Sabotaje encubierto (cuentas y logística)
      <div class="small text-dim">Menos daño económico, pero mucho más difícil de rastrear hasta ti: apenas sube el heat, en éxito o en fracaso.</div>
    </button>
    <button class="danger block" data-approach="standard">
      Sabotaje estándar
      <div class="small text-dim">El equilibrio de siempre entre daño causado y heat generado.</div>
    </button>
    <button class="danger block" data-approach="explosive">
      Explosivos contra su infraestructura
      <div class="small text-dim">Mucho más daño si sale bien, pero es más difícil de ejecutar con éxito, dispara el heat mucho más, y si fracasa el enfrentamiento te cuesta también bajas en tu propio ejército.</div>
    </button>
    <button class="ghost block mt-1" id="close-btn">Cancelar</button>
  `);
  document.getElementById("close-btn").addEventListener("click", closeModal);
  document.querySelectorAll("[data-approach]").forEach((btn) => {
    btn.addEventListener("click", () => apply(btn.dataset.approach));
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

function showAbsorptionModal(app, game, cartel, targetCartelId) {
  const target = game.cartels[targetCartelId];
  const relStatus = cartel.relations[targetCartelId]?.status || "neutral";

  const send = () => {
    const res = applyAction(game, cartel.id, "propose_absorption", { targetCartelId });
    app.setGame(game);
    closeModal();
    if (!res.ok) {
      alert(res.message);
    } else if (res.accepted) {
      alert(`${target.name} acepta convertirse en una facción subordinada de ${cartel.name}: sus territorios, su gente y lo que quedaba en su caja pasan a tu cártel.`);
    } else {
      alert(`${target.name} rechaza la propuesta de subordinación.`);
    }
    app.render();
  };

  showModal(`
    <h2>Proponer subordinación a ${escapeHtml(target.name)}</h2>
    <p class="small text-dim">Coste: ${fmtMoney(PROPOSE_ABSORPTION_COST)}. No es una alianza entre iguales: le ofreces integrarse como facción subordinada de tu cártel — todos sus territorios pasan a ser tuyos, la mayor parte de su dinero y de su ejército se suman a los tuyos, y su gente se incorpora a tu cúpula como asociados (sin cargo directivo, ya que los tuyos siguen ocupando los puestos). Solo aceptan si están claramente por debajo de ti en fuerza (territorios, ejército y dinero combinados)${relStatus === "war" ? "; estar en guerra contigo y perdiendo hace mucho más probable que acepten, como forma de sobrevivir" : ""}.</p>
    <div class="btn-row mt-2">
      <button class="primary block" id="send-absorption">Enviar propuesta</button>
      <button class="ghost block" id="close-btn">Cancelar</button>
    </div>
  `);
  document.getElementById("close-btn").addEventListener("click", closeModal);
  document.getElementById("send-absorption").addEventListener("click", send);
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
