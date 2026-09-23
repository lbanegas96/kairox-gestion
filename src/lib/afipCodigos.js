// Tablas de códigos AFIP/ARCA — ESPEJO de supabase/functions/_shared/afip.ts
// (voucherTypeAfip/docTipoAfip/alicuotaPct/ivaIdFromPct), duplicado acá porque
// _shared/afip.ts vive en Deno (Edge Functions) y no es importable desde el
// frontend Vite. Si se toca un mapeo, tocar los 2 archivos — no deben divergir,
// son la misma tabla que ARCA exige tanto para WSFE (CAE) como para el Libro
// IVA Digital. Única excepción a propósito: las letras M y E de más abajo
// (solo Compras) y `monedaAfip`/`tipoCambioAfip` (el worker emite siempre PES).

/**
 * Código de comprobante AFIP a partir de la letra interna (A/B/C/M/E) + clase de
 * documento. Mismo criterio que _shared/afip.ts: el hallazgo real de sesión
 * 2026-07-29 (una NC declarada como Factura ante ARCA) fue justamente no
 * pasar `claseDocumento` acá — repetir ese bug en el export de Libro IVA
 * Digital declararía mal el mismo tipo de documento.
 *
 * M (51/52/53 = Factura/ND/NC "M") y E (19/20/21 = Factura/ND/NC de
 * exportación) solo pueden llegar del lado Compras — un proveedor las emite,
 * nosotros no — por eso el worker (`_shared/afip.ts`) no las tiene. Antes caían
 * en el fallback a B y el Libro IVA Compras declaraba una Factura M como B.
 */
export function voucherTypeAfip(tipoLetra, claseDocumento = 'venta') {
  const CODIGOS = {
    venta:        { A: 1, B: 6,  C: 11, M: 51, E: 19 },
    nota_credito: { A: 3, B: 8,  C: 13, M: 53, E: 21 },
    nota_debito:  { A: 2, B: 7,  C: 12, M: 52, E: 20 },
  };
  const fila = CODIGOS[claseDocumento] ?? CODIGOS.venta;
  return fila[tipoLetra] ?? fila.B;
}

// Monedas que maneja KAIROX (`MONEDAS` en currencyUtils.js) → tabla "Monedas" de ARCA.
const MONEDAS_AFIP = { ARS: 'PES', USD: 'DOL', EUR: '060', BRL: '012' };

/**
 * Código de moneda del Libro IVA Digital. Los importes de KAIROX están SIEMPRE
 * en pesos (`total` es la moneda base; `monto_moneda_original` guarda el valor
 * en la moneda extranjera), así que una moneda sin código conocido se declara
 * como PES en vez de inventar uno.
 */
export function monedaAfip(moneda) {
  return MONEDAS_AFIP[moneda] ?? 'PES';
}

/**
 * Tipo de cambio coherente con el código de moneda. ARCA exige TC 1 cuando la
 * moneda es PES — declarar PES con el TC real de un comprobante en USD
 * (p. ej. 1530) es un par inválido que el Portal IVA rechaza.
 */
export function tipoCambioAfip(codigoMoneda, tipoCambio) {
  const tc = Number(tipoCambio);
  return codigoMoneda === 'PES' || !(tc > 0) ? 1 : tc;
}

/** Tipo de documento AFIP (80 CUIT / 96 DNI / 99 Consumidor Final) a partir del documento del receptor/emisor. */
export function docTipoAfip(documento) {
  const d = (documento ?? '').replace(/\D/g, '');
  if (d.length === 11) return { tipo: 80, nro: d };
  if (d.length >= 7 && d.length <= 8) return { tipo: 96, nro: d };
  return { tipo: 99, nro: '0' };
}

/** Alícuota KAIROX (string: '21'/'10.5'/'0'/'exento'/'no_gravado') al % numérico. */
export function alicuotaPct(alicuota) {
  if (alicuota === '10.5') return 10.5;
  if (alicuota === '0' || alicuota === 'exento' || alicuota === 'no_gravado') return 0;
  if (alicuota === '27') return 27;
  return 21;
}

/** % de IVA al Id de alícuota AFIP (tabla "Alícuotas" del diseño de registro). */
export function ivaIdFromPct(pct) {
  if (pct === 0) return 3;      // 0% / exento / no gravado
  if (pct === 10.5) return 4;   // 10.5%
  if (pct === 27) return 6;     // 27%
  return 5;                     // 21% (default)
}
