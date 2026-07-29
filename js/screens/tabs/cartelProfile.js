import { showModal, closeModal } from "../../ui/modal.js";
import { portraitImg, statBar, escapeHtml, roleLabel } from "../../ui/components.js";
import { ROLE_ORDER } from "../../model.js";
import { fmtMoney, fmtNum, heatLabel } from "../../utils/text.js";
import { showCharacterProfile } from "./characterProfile.js";
import { MONEY_SCALE } from "../../turnEngine.js";

export function showCartelProfile(app, cartelId) {
  const game = app.game;
  const cartel = game.cartels[cartelId];
  if (!cartel) return;
  const r = cartel.resources;
  const isPlayer = cartelId === game.playerCartelId;

  showModal(`
    <h2><span style="display:inline-block;width:12px;height:12px;background:${cartel.color};border-radius:2px;margin-right:6px"></span>${escapeHtml(cartel.name)}${isPlayer ? " (tú)" : ""}</h2>
    <p class="small text-dim">${escapeHtml(cartel.historicalNote || "")}</p>
    ${statBar("Dinero", Math.min(100, r.money / (50 * MONEY_SCALE)))}<div class="small text-dim" style="margin-top:-8px">${fmtMoney(r.money)}</div>
    ${statBar("Ejército", Math.min(100, r.armySize / 40))}<div class="small text-dim" style="margin-top:-8px">${fmtNum(r.armySize)} hombres</div>
    ${statBar("Corrupción gob.", r.corruptGov)}
    ${statBar("Corrupción policial", r.corruptPolice)}
    ${statBar("Imagen pública", r.publicImage, "image")}
    ${statBar("Reputación internacional", r.internationalReputation ?? 15)}
    ${statBar("Nivel de búsqueda (heat)", r.heat, "heat")}
    <div class="small">${escapeHtml(heatLabel(r.heat))}</div>
    <p class="small text-dim mt-1">Territorios: ${cartel.territories.map((id) => escapeHtml(game.territories[id]?.name || id)).join(", ") || "ninguno"}</p>
    <h3 class="mt-2">Organigrama</h3>
    ${ROLE_ORDER.map((role) => {
      const holder = game.characters[cartel.roles[role]];
      if (!holder) return `<div class="person-row"><div class="info"><div class="name text-dim">Vacante</div><div class="role">${roleLabel(role)}</div></div></div>`;
      return `<div class="person-row" data-view-char="${holder.id}" style="cursor:pointer">
        ${portraitImg(holder)}
        <div class="info"><div class="name">${escapeHtml(holder.name)}</div><div class="role">${roleLabel(role)}</div></div>
      </div>`;
    }).join("")}
    <button class="ghost block mt-2" id="close-btn">Cerrar</button>
  `);
  document.getElementById("close-btn").addEventListener("click", closeModal);
  document.querySelectorAll("[data-view-char]").forEach((el) => {
    el.addEventListener("click", () => showCharacterProfile(app, el.dataset.viewChar));
  });
}
