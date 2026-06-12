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
 *   - PUNTO  (.) = separador de miles → grupos de EXACTAMENTE 3 dígitos
 *   - COMA   (,) = separador decimal (única, va al final)
 *
 * Reglas:
 *   - Si hay coma: validar que los puntos a la izquierda separen grupos de 3.
 *   - Si NO hay coma: validar que los puntos separen grupos de 3 (sin decimales).
 *   - El primer grupo puede tener 1-3 dígitos; los demás SIEMPRE 3.
 *   - Cualquier otra cosa → NaN (rechazo explícito del formato en-US).
 *
 * Ejemplos válidos:
 *   "1446"        → 1446
 *   "1.446"       → 1446
 *   "1.446.567"   → 1446567
 *   "500.000"     → 500000
 *   "1668,21"     → 1668.21
 *   "1.668,21"    → 1668.21
 *   "120.000,50"  → 120000.50
 *   "0,0036"      → 0.0036
 *
 * Ejemplos rechazados (NaN):
 *   "120000.50"   → NaN  (punto como decimal — usá coma)
 *   "1.4"         → NaN  (grupo de 1 dígito tras punto)
 *   "500.00"      → NaN  (grupo de 2 dígitos tras punto)
 *   "1,234.56"    → NaN  (formato en-US)
 *   "1,5,5"       → NaN  (múltiples comas)
 */
export function parseNumberLocale(input) {
  if (input === null || input === undefined || input === '') return NaN;
  let s = String(input).trim().replace(/\s/g, '');
  if (!s) return NaN;

  // Signo
  let sign = 1;
  if (s.startsWith('-')) { sign = -1; s = s.slice(1); }
  else if (s.startsWith('+')) { s = s.slice(1); }

  // No permitir caracteres distintos de dígitos, punto o coma
  if (!/^[\d.,]+$/.test(s)) return NaN;

  // Máximo una coma
  const comaCount = (s.match(/,/g) || []).length;
  if (comaCount > 1) return NaN;

  let entero = s;
  let decimal = '';
  if (comaCount === 1) {
    const partes = s.split(',');
    entero = partes[0];
    decimal = partes[1];
    if (!/^\d+$/.test(decimal)) return NaN; // decimal solo dígitos
    if (entero === '') entero = '0';
  }

  // Validar parte entera: con o sin puntos como miles (grupos de 3 estrictos)
  if (entero.includes('.')) {
    const grupos = entero.split('.');
    // Primer grupo: 1-3 dígitos; los siguientes: exactamente 3
    if (!/^\d{1,3}$/.test(grupos[0])) return NaN;
    for (let i = 1; i < grupos.length; i++) {
      if (!/^\d{3}$/.test(grupos[i])) return NaN;
    }
  } else {
    if (!/^\d+$/.test(entero)) return NaN;
  }

  const enteroLimpio = entero.replace(/\./g, '');
  const n = parseFloat(decimal ? `${enteroLimpio}.${decimal}` : enteroLimpio);
  return Number.isFinite(n) ? sign * n : NaN;
}

/** True si la moneda no es ARS */
export function isMonedaExtranjera(moneda) {
  return moneda !== 'ARS';
}
