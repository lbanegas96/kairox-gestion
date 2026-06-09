export const MONEDAS = [
  { value: 'ARS', label: 'ARS — Peso argentino', symbol: '$' },
  { value: 'USD', label: 'USD — Dólar estadounidense', symbol: 'US$' },
  { value: 'EUR', label: 'EUR — Euro', symbol: '€' },
  { value: 'BRL', label: 'BRL — Real brasileño', symbol: 'R$' },
];

export const MONEDA_SYMBOLS = Object.fromEntries(MONEDAS.map(m => [m.value, m.symbol]));

/** Formatea un monto con el símbolo de la moneda */
export function formatCurrency(amount, moneda = 'ARS') {
  const num = Number(amount ?? 0);
  const symbol = MONEDA_SYMBOLS[moneda] ?? moneda;
  return `${symbol} ${num.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Convierte un monto de moneda extranjera a ARS usando la tasa dada */
export function convertToARS(amount, moneda, tasa) {
  if (moneda === 'ARS') return Number(amount ?? 0);
  return Number(amount ?? 0) * Number(tasa ?? 1);
}

/** Devuelve el monto en ARS (para reportes / KPIs del dashboard) */
export function montoEnARS(amount, moneda, tasa) {
  return convertToARS(amount, moneda, tasa);
}

/**
 * Parsea un número en formato es-AR estricto:
 *   - PUNTO  (.) = separador de miles
 *   - COMA   (,) = separador decimal
 *   - sin separadores → entero
 *
 * Ejemplos:
 *   "1446"        → 1446
 *   "1.446"       → 1446       (punto = miles)
 *   "1.446.567"   → 1446567    (miles repetido)
 *   "1668,21"     → 1668.21    (coma = decimal)
 *   "1.668,21"    → 1668.21    (formato es-AR completo)
 *   "0,0036"      → 0.0036
 *
 * Nota: si alguien tipea formato en-US como "1,446.50" se va a interpretar
 * incorrectamente (1.446 con 50 decimales raros). Las reglas argentinas son
 * estrictas por diseño — los inputs muestran el placeholder con formato es-AR.
 */
export function parseNumberLocale(input) {
  if (input === null || input === undefined || input === '') return NaN;
  const s = String(input).trim().replace(/\s/g, '');
  if (!s) return NaN;
  // 1) Sacar TODOS los puntos (son separadores de miles)
  // 2) Cambiar la coma por punto (decimal en JS)
  const cleaned = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

/** True si la moneda no es ARS */
export function isMonedaExtranjera(moneda) {
  return moneda !== 'ARS';
}
