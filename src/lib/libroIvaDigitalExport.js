// Generadores de los archivos TXT del Libro de IVA Digital de ARCA (Anexo I —
// Diseños de Registros, régimen RG 3685/RG 4597), lados VENTAS y COMPRAS.
// Diseño de registro verificado campo por campo contra el instructivo oficial
// (afip.gob.ar/iva/documentos/libro-iva-digital-diseno-registros.pdf) el
// 19/09 — ver el artifact "Libro IVA Digital" para el detalle de cada campo.
//
// Fila 1 = Cabecera del comprobante. Fila(s) N = una por cada alícuota de IVA
// distinta que tenga ese comprobante — el campo "Cantidad de alícuotas" de la
// cabecera tiene que coincidir con cuántas filas propias tiene en el archivo
// de Alícuotas, o el Portal IVA rechaza el comprobante.
import { armarLinea } from './registroAnchoFijo';
import { voucherTypeAfip, docTipoAfip, alicuotaPct, ivaIdFromPct } from './afipCodigos';

const SALTO = '\r\n'; // convención de fin de línea de los regímenes SIAP/AFIP

function claseDocumento(tipo) {
  if (tipo === 'nota_credito') return 'nota_credito';
  if (tipo === 'nota_debito') return 'nota_debito';
  return 'venta';
}

/** "0001-00000053" -> { puntoVenta: "0001", folio: "00000053" }. null si no es parseable. */
function parsearNumeroAfip(numeroAfip) {
  if (!numeroAfip) return null;
  const m = String(numeroAfip).match(/^(\d+)-(\d+)$/);
  if (!m) return null;
  return { puntoVenta: m[1], folio: m[2] };
}

/**
 * Reparte neto_gravado/iva_discriminado del comprobante (siempre guardados en
 * positivo, sin importar si es NC) entre sus alícuotas reales — mismo
 * criterio de reparto proporcional por subtotal que ya usa
 * ReporteLibroIVA.jsx (alicuotaResumen), pero acá por UN comprobante, no
 * agregado de todo el período, y separando 'exento'/'no_gravado' aparte
 * porque esos van al campo "Importe de operaciones exentas" de la cabecera,
 * no a una fila de Alícuotas (no tienen impuesto liquidado que declarar ahí).
 */
function repartirPorAlicuota(comprobante, items) {
  const netoTotal = Number(comprobante.neto_gravado ?? 0);
  const ivaTotal = Number(comprobante.iva_discriminado ?? 0);

  if (!items || items.length === 0) {
    // Comprobante viejo sin detalle de items — todo a 21% (mismo fallback que
    // el resto del reporte).
    return { exento: 0, alicuotas: [{ pct: 21, neto: netoTotal, iva: ivaTotal }] };
  }

  const totalSubtotal = items.reduce((s, it) => s + Number(it.subtotal || 0), 0);
  if (totalSubtotal === 0) {
    return { exento: 0, alicuotas: [{ pct: 21, neto: netoTotal, iva: ivaTotal }] };
  }

  const porClave = {};
  items.forEach(it => {
    const clave = it.alicuota_iva || '21';
    porClave[clave] = (porClave[clave] || 0) + Number(it.subtotal || 0);
  });

  let exento = 0;
  const alicuotas = [];
  Object.entries(porClave).forEach(([clave, subtotalClave]) => {
    const share = subtotalClave / totalSubtotal;
    const neto = netoTotal * share;
    const iva = ivaTotal * share;
    if (clave === 'exento' || clave === 'no_gravado' || clave === '0') {
      exento += neto;
    } else {
      alicuotas.push({ pct: alicuotaPct(clave), neto, iva });
    }
  });
  return { exento, alicuotas };
}

/**
 * Genera LIBRO_IVA_DIGITAL_VENTAS_CBTE.txt — una línea de 266 caracteres por
 * comprobante. Devuelve { contenido, incluidos, excluidos } — excluidos son
 * comprobantes válidos que no se pudieron declarar (sin numero_afip
 * parseable, típicamente cae_estado='no_aplica' sin numeración fiscal real)
 * para que la pantalla avise cuáles quedaron afuera en vez de generar un
 * archivo silenciosamente incompleto.
 */
export function generarVentasCbte(comprobantes, itemsPorComprobante) {
  const lineas = [];
  const excluidos = [];

  comprobantes.forEach(c => {
    const parsed = parsearNumeroAfip(c.numero_afip);
    if (!parsed) { excluidos.push(c); return; }

    const items = itemsPorComprobante[c.id] || [];
    const { exento, alicuotas } = repartirPorAlicuota(c, items);
    const doc = docTipoAfip(c.cliente_documento);

    lineas.push(armarLinea([
      { tipo: 'fecha',   valor: c.fecha },
      { tipo: 'num',     valor: voucherTypeAfip(c.tipo_comprobante_afip, claseDocumento(c.tipo)), longitud: 3 },
      { tipo: 'num',     valor: parsed.puntoVenta, longitud: 5 },
      { tipo: 'num',     valor: parsed.folio, longitud: 20 },
      { tipo: 'num',     valor: parsed.folio, longitud: 20 }, // "hasta" = mismo folio, comprobante único
      { tipo: 'num',     valor: doc.tipo, longitud: 2 },
      { tipo: 'num',     valor: doc.nro, longitud: 20 },
      { tipo: 'alfa',    valor: c.cliente_nombre || 'CONSUMIDOR FINAL', longitud: 30 },
      { tipo: 'importe', valor: c.total, longitud: 15 },
      { tipo: 'importe', valor: 0, longitud: 15 }, // conceptos que no integran el neto gravado
      { tipo: 'importe', valor: 0, longitud: 15 }, // percepción a no categorizados
      { tipo: 'importe', valor: exento, longitud: 15 },
      { tipo: 'importe', valor: 0, longitud: 15 }, // percepciones/pagos a cta. imp. nacionales
      { tipo: 'importe', valor: 0, longitud: 15 }, // percepciones de IIBB
      { tipo: 'importe', valor: 0, longitud: 15 }, // percepciones imp. municipales
      { tipo: 'importe', valor: 0, longitud: 15 }, // impuestos internos
      { tipo: 'alfa',    valor: 'PES', longitud: 3 },
      { tipo: 'tipoCambio', valor: c.tipo_cambio_tasa || 1 },
      { tipo: 'num',     valor: Math.max(alicuotas.length, 1), longitud: 1 },
      { tipo: 'alfa',    valor: '', longitud: 1 }, // código de operación — blanco, doméstica normal
      { tipo: 'importe', valor: 0, longitud: 15 }, // otros tributos
      { tipo: 'fecha',   valor: null }, // fecha de vencimiento de pago — sin dato hoy
    ]));
  });

  return { contenido: lineas.join(SALTO) + (lineas.length ? SALTO : ''), incluidos: lineas.length, excluidos };
}

/** Genera LIBRO_IVA_DIGITAL_VENTAS_ALICUOTAS.txt — una línea de 62 caracteres por (comprobante, alícuota). */
export function generarVentasAlicuotas(comprobantes, itemsPorComprobante) {
  const lineas = [];

  comprobantes.forEach(c => {
    const parsed = parsearNumeroAfip(c.numero_afip);
    if (!parsed) return; // mismo criterio de exclusión que la cabecera

    const items = itemsPorComprobante[c.id] || [];
    const { alicuotas } = repartirPorAlicuota(c, items);
    const tipoCbte = voucherTypeAfip(c.tipo_comprobante_afip, claseDocumento(c.tipo));

    // Si el comprobante es 100% exento (sin ninguna alícuota gravada), no
    // genera fila acá — su "Cantidad de alícuotas" en cabecera ya quedó en 1
    // como mínimo técnico, pero no hay nada gravado que declarar en detalle.
    alicuotas.forEach(({ pct, neto, iva }) => {
      lineas.push(armarLinea([
        { tipo: 'num',     valor: tipoCbte, longitud: 3 },
        { tipo: 'num',     valor: parsed.puntoVenta, longitud: 5 },
        { tipo: 'num',     valor: parsed.folio, longitud: 20 },
        { tipo: 'importe', valor: neto, longitud: 15 },
        { tipo: 'num',     valor: ivaIdFromPct(pct), longitud: 4 },
        { tipo: 'importe', valor: iva, longitud: 15 },
      ]));
    });
  });

  return { contenido: lineas.join(SALTO) + (lineas.length ? SALTO : ''), filas: lineas.length };
}

// ════════════════════════════════════════════════════════════════════════════
// Lado COMPRAS — Fase 2. Requiere los 3 campos de Fase 0
// (tipo_comprobante_letra/punto_venta_proveedor/numero_comprobante_proveedor,
// mig.398) completos en `compras`. Reusa `repartirPorAlicuota` de arriba tal
// cual: `compras` tiene las mismas columnas `neto_gravado`/`iva_discriminado`
// que `comprobantes`, y `detalle_compras` las mismas `subtotal`/`alicuota_iva`
// que `comprobante_items` — no hace falta una versión aparte.
//
// OJO — alcance real de esta fase: solo exporta `compras` (Facturas de
// Compra). Las ND recibidas y NC de proveedor (`notas_debito`,
// `notas_credito_proveedor`) NO tienen los 3 campos de Fase 0 en su propia
// tabla — mismo tipo de gap que Fase 0 resolvió para `compras`, todavía sin
// resolver ahí. Quedan afuera del TXT a propósito, no por descuido.

/** true si la compra tiene los 3 campos de Fase 0 completos — sin esto no hay forma de armar un registro válido. */
function comprobanteCompraValido(c) {
  return !!(c.tipo_comprobante_letra && c.punto_venta_proveedor && c.numero_comprobante_proveedor);
}

/**
 * Genera LIBRO_IVA_DIGITAL_COMPRAS_CBTE.txt — una línea de 325 caracteres por
 * compra. Devuelve { contenido, incluidos, excluidos } — excluidos son
 * compras sin los 3 campos de Fase 0 completos (típicamente cargadas antes
 * del 20/09, cuando pasaron a ser obligatorios para altas nuevas).
 */
export function generarComprasCbte(compras, itemsPorCompra) {
  const lineas = [];
  const excluidos = [];

  compras.forEach(c => {
    if (!comprobanteCompraValido(c)) { excluidos.push(c); return; }

    const items = itemsPorCompra[c.id] || [];
    const { exento, alicuotas } = repartirPorAlicuota(c, items);
    const doc = docTipoAfip(c.proveedor_cuit);

    lineas.push(armarLinea([
      { tipo: 'fecha',   valor: c.fecha },
      { tipo: 'num',     valor: voucherTypeAfip(c.tipo_comprobante_letra), longitud: 3 },
      { tipo: 'num',     valor: c.punto_venta_proveedor, longitud: 5 },
      { tipo: 'num',     valor: c.numero_comprobante_proveedor, longitud: 20 },
      { tipo: 'alfa',    valor: '', longitud: 16 }, // despacho de importación — Nalux no importa bienes
      { tipo: 'num',     valor: doc.tipo, longitud: 2 },
      { tipo: 'num',     valor: doc.nro, longitud: 20 },
      { tipo: 'alfa',    valor: c.proveedor_nombre || 'PROVEEDOR', longitud: 30 },
      { tipo: 'importe', valor: c.total, longitud: 15 },
      { tipo: 'importe', valor: 0, longitud: 15 }, // conceptos que no integran el neto gravado
      { tipo: 'importe', valor: exento, longitud: 15 },
      { tipo: 'importe', valor: 0, longitud: 15 }, // percepciones/pagos a cta. de IVA
      { tipo: 'importe', valor: 0, longitud: 15 }, // percepciones/pagos a cta. otros imp. nacionales
      { tipo: 'importe', valor: 0, longitud: 15 }, // percepciones de IIBB
      { tipo: 'importe', valor: 0, longitud: 15 }, // percepciones imp. municipales
      { tipo: 'importe', valor: 0, longitud: 15 }, // impuestos internos
      { tipo: 'alfa',    valor: 'PES', longitud: 3 },
      { tipo: 'tipoCambio', valor: c.tipo_cambio_tasa || 1 },
      { tipo: 'num',     valor: Math.max(alicuotas.length, 1), longitud: 1 },
      { tipo: 'alfa',    valor: '', longitud: 1 }, // código de operación — blanco, doméstica normal
      { tipo: 'importe', valor: c.iva_discriminado, longitud: 15 }, // crédito fiscal computable — 100% computable
      { tipo: 'importe', valor: 0, longitud: 15 }, // otros tributos
      { tipo: 'num',     valor: 0, longitud: 11 }, // CUIT emisor/corredor — sin intermediario
      { tipo: 'alfa',    valor: '', longitud: 30 }, // denominación del emisor/corredor
      { tipo: 'importe', valor: 0, longitud: 15 }, // IVA comisión
    ]));
  });

  return { contenido: lineas.join(SALTO) + (lineas.length ? SALTO : ''), incluidos: lineas.length, excluidos };
}

/** Genera LIBRO_IVA_DIGITAL_COMPRAS_ALICUOTAS.txt — una línea de 84 caracteres por (compra, alícuota). */
export function generarComprasAlicuotas(compras, itemsPorCompra) {
  const lineas = [];

  compras.forEach(c => {
    if (!comprobanteCompraValido(c)) return; // mismo criterio de exclusión que la cabecera

    const items = itemsPorCompra[c.id] || [];
    const { alicuotas } = repartirPorAlicuota(c, items);
    const tipoCbte = voucherTypeAfip(c.tipo_comprobante_letra);
    const doc = docTipoAfip(c.proveedor_cuit);

    alicuotas.forEach(({ pct, neto, iva }) => {
      lineas.push(armarLinea([
        { tipo: 'num',     valor: tipoCbte, longitud: 3 },
        { tipo: 'num',     valor: c.punto_venta_proveedor, longitud: 5 },
        { tipo: 'num',     valor: c.numero_comprobante_proveedor, longitud: 20 },
        { tipo: 'num',     valor: doc.tipo, longitud: 2 },
        { tipo: 'num',     valor: doc.nro, longitud: 20 },
        { tipo: 'importe', valor: neto, longitud: 15 },
        { tipo: 'num',     valor: ivaIdFromPct(pct), longitud: 4 },
        { tipo: 'importe', valor: iva, longitud: 15 },
      ]));
    });
  });

  return { contenido: lineas.join(SALTO) + (lineas.length ? SALTO : ''), filas: lineas.length };
}
