// Helpers de formato para archivos de ancho fijo estilo AFIP/ARCA (Libro IVA
// Digital, y cualquier otro régimen SIAP con el mismo esqueleto). Cada campo
// ocupa una posición y longitud EXACTAS, sin separadores — un campo mal
// rellenado corre todos los que le siguen en esa línea.

/** Numérico con ceros a la izquierda — para campos "Tipo de Dato: 2 Numérico". */
export function numAncho(valor, longitud) {
  const limpio = String(valor ?? '').replace(/\D/g, '') || '0';
  return limpio.slice(-longitud).padStart(longitud, '0');
}

/**
 * Alfabético/alfanumérico con espacios a la derecha (tipo 1/3). Mayúsculas y
 * sin acentos/ñ — el instructivo no aclara el charset del TXT, y ASCII puro
 * es el único que no depende de qué codificación asuma el Portal IVA al leer
 * el archivo.
 */
export function alfaAncho(valor, longitud) {
  const sinAcentos = String(valor ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // separa tilde de la letra y la tira
    .replace(/[^\x20-\x7E]/g, ' ') // cualquier otro no-ASCII (ej. ñ ya separada en n + ~) a espacio
    .toUpperCase();
  return sinAcentos.slice(0, longitud).padEnd(longitud, ' ');
}

/** Fecha AAAAMMDD — acepta 'YYYY-MM-DD' o un Date. */
export function fechaAncho(fecha) {
  if (!fecha) return '00000000';
  const iso = fecha instanceof Date ? fecha.toISOString() : String(fecha);
  const soloFecha = iso.slice(0, 10); // 'YYYY-MM-DD'
  const [y, m, d] = soloFecha.split('-');
  if (!y || !m || !d) return '00000000';
  return `${y}${m}${d}`;
}

/**
 * Importe con 2 decimales fijos, sin punto, ceros a la izquierda, SIEMPRE
 * POSITIVO. ARCA no espera signo en el importe — el sentido (una Nota de
 * Crédito resta débito fiscal) lo da el código de "Tipo de comprobante"
 * (voucherTypeAfip), no un signo negativo acá. Mismo criterio que ya usa
 * `comprobantes`: las NC se guardan con montos positivos en la base.
 */
export function importeAncho(valor, longitud) {
  const centavos = Math.round(Math.abs(Number(valor) || 0) * 100);
  return String(centavos).slice(-longitud).padStart(longitud, '0');
}

/**
 * Tipo de cambio: "4 enteros 6 decimales sin punto decimal" (distinto de un
 * importe normal, que es 2 decimales) — longitud fija 10. Sin cotización
 * paralela (venta en ARS) va en 1,00 = 0001000000.
 */
export function tipoCambioAncho(valor) {
  const num = Number(valor) || 1;
  const centavos = Math.round(num * 1000000);
  return String(centavos).slice(-10).padStart(10, '0');
}

/** Arma una línea de ancho fijo a partir de [{ valor, longitud, tipo }], en orden — tipo: 'num' | 'alfa' | 'fecha' | 'importe' | 'tipoCambio'. */
export function armarLinea(campos) {
  return campos.map(({ valor, longitud, tipo }) => {
    if (tipo === 'num') return numAncho(valor, longitud);
    if (tipo === 'fecha') return fechaAncho(valor);
    if (tipo === 'importe') return importeAncho(valor, longitud);
    if (tipo === 'tipoCambio') return tipoCambioAncho(valor);
    return alfaAncho(valor, longitud); // 'alfa' default
  }).join('');
}

/** Dispara la descarga de un archivo de texto en el navegador. */
export function descargarTxt(contenido, nombreArchivo) {
  const blob = new Blob([contenido], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  a.click();
  URL.revokeObjectURL(url);
}
