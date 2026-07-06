/**
 * Divide una línea de CSV respetando el delimitador y los campos entre
 * comillas (un delimitador dentro de comillas no separa columnas).
 */
export function splitCSVLine(linea, delim) {
  const cols = [];
  let actual = '';
  let enComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') {
      enComillas = !enComillas;
    } else if (c === delim && !enComillas) {
      cols.push(actual);
      actual = '';
    } else {
      actual += c;
    }
  }
  cols.push(actual);
  return cols.map(c => c.trim().replace(/^"|"$/g, ''));
}

/**
 * Detecta el delimitador de un CSV a partir de su primera línea (header).
 * Los extractos bancarios AR suelen usar ';' precisamente porque ',' es el
 * separador decimal — si el header tiene más ';' que ',', se asume ';'.
 */
export function detectarDelimitadorCSV(headerLine) {
  const puntoYComa = (headerLine.match(/;/g) || []).length;
  const comas = (headerLine.match(/,/g) || []).length;
  return puntoYComa > comas ? ';' : ',';
}

/**
 * Parsea texto CSV completo → { headers, rows }, con delimitador
 * auto-detectado y campos entre comillas respetados.
 */
export function parseCSVText(texto) {
  const lineas = String(texto ?? '').trim().split(/\r?\n/).filter(l => l.trim());
  if (lineas.length === 0) return { headers: [], rows: [] };
  const delim = detectarDelimitadorCSV(lineas[0]);
  const headers = splitCSVLine(lineas[0], delim);
  const rows = lineas.slice(1).map(l => splitCSVLine(l, delim)).filter(r => r.some(c => c));
  return { headers, rows };
}

/**
 * Parsea un monto de CSV bancario tolerando formato AR ("1.234,56" — punto
 * de miles, coma decimal) o US/plano ("1234.56", "1234567").
 *
 * Ambigüedad: un único punto con exactamente 3 dígitos detrás se asume
 * separador de miles sin decimales (ej. "1.234" = 1234), no decimal — los
 * extractos bancarios no usan 3 dígitos de decimales. Con 1 o 2 dígitos
 * detrás del punto se asume decimal US (ej. "1234.56").
 */
export function parseMontoCSV(raw) {
  let limpio = String(raw ?? '').replace(/[^0-9.,-]/g, '');
  if (!limpio) return 0;
  const tieneComa = limpio.includes(',');
  const puntos = (limpio.match(/\./g) || []).length;

  if (tieneComa) {
    // Formato AR: punto = miles, coma = decimal
    limpio = limpio.replace(/\./g, '').replace(',', '.');
  } else if (puntos >= 2) {
    // Múltiples puntos sin coma: son separadores de miles (ej "1.234.567")
    limpio = limpio.replace(/\./g, '');
  } else if (puntos === 1) {
    const digitosDespues = limpio.split('.')[1]?.length ?? 0;
    if (digitosDespues === 3) {
      // "1.234" con exactamente 3 dígitos → separador de miles, no decimal
      limpio = limpio.replace('.', '');
    }
    // 1-2 dígitos detrás del punto → se deja como decimal US ("1234.56")
  }
  return parseFloat(limpio) || 0;
}
