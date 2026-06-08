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
 * Parsea un número en cualquier formato local (es-AR o en-US).
 * El ÚLTIMO separador (. o ,) se trata como decimal; el resto como miles.
 *   "1668.21"   → 1668.21
 *   "1668,21"   → 1668.21
 *   "1.668,21"  → 1668.21  (formato español)
 *   "1,668.21"  → 1668.21  (formato inglés)
 *   "1668"      → 1668
 */
export function parseNumberLocale(input) {
  if (input === null || input === undefined || input === '') return NaN;
  const s = String(input).trim().replace(/\s/g, '');
  if (!s) return NaN;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  const decSep = lastDot > lastComma ? '.' : (lastComma > -1 ? ',' : null);
  if (!decSep) return parseFloat(s.replace(/[.,]/g, ''));
  const intPart = s.slice(0, decSep === '.' ? lastDot : lastComma).replace(/[.,]/g, '');
  const decPart = s.slice((decSep === '.' ? lastDot : lastComma) + 1);
  return parseFloat(`${intPart || '0'}.${decPart}`);
}

/** True si la moneda no es ARS */
export function isMonedaExtranjera(moneda) {
  return moneda !== 'ARS';
}
