export function fmtMoney(n) {
  return "$" + Math.round(n).toLocaleString("es-MX");
}

export function fmtNum(n) {
  return Math.round(n).toLocaleString("es-MX");
}

const HEAT_TIERS = [
  { max: 20, label: "Bajo perfil" },
  { max: 40, label: "En el radar" },
  { max: 60, label: "Buscado" },
  { max: 80, label: "Objetivo prioritario" },
  { max: 101, label: "Cacería nacional" },
];

export function heatLabel(heat) {
  return HEAT_TIERS.find((tier) => heat < tier.max)?.label ?? "Cacería nacional";
}
