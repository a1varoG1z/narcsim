export function fmtMoney(n) {
  return "$" + Math.round(n).toLocaleString("es-MX");
}

export function fmtNum(n) {
  return Math.round(n).toLocaleString("es-MX");
}
