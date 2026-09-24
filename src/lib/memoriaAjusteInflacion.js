// Papeles de trabajo del Ajuste por Inflación (Backlog de Reportería, 24/09):
//  - Memoria de cálculo del ajuste CONTABLE (RT 6) de un período.
//  - Export del ajuste IMPOSITIVO (Ganancias, arts. 95/96 LIG).
// Puras (sin red ni React) para poder probarlas con datos armados a mano; las
// columnas devueltas sirven igual para la pantalla, el PDF y el Excel.
import { formatCurrency } from '@/lib/currencyUtils';

const num = (v) => Number(v) || 0;
const nf = (v, dec) => num(v).toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });

/** 'YYYY-MM-DD…' → 'MM/YYYY' ('—' si no hay fecha). */
export function mesLabel(fecha) {
  const [y, m] = String(fecha || '').slice(0, 7).split('-');
  return y && m ? `${m}/${y}` : '—';
}

/**
 * Mes del índice con que se toma el saldo de apertura de un período: el mes
 * anterior a su inicio ('2026-07-01' → '06/2026'), igual que el cálculo en la base.
 */
export function mesAperturaLabel(fechaInicio) {
  const [y, m] = String(fechaInicio || '').slice(0, 7).split('-').map(Number);
  if (!y || !m) return '—';
  const mesAnterior = m === 1 ? 12 : m - 1;
  const anio = m === 1 ? y - 1 : y;
  return `${String(mesAnterior).padStart(2, '0')}/${anio}`;
}

export const ORIGEN_LABEL = {
  apertura: 'Saldo de apertura',
  movimiento: 'Movimientos del mes',
};

/** Diferencia máxima tolerada entre la suma del detalle y las líneas oficiales (redondeos de centavos). */
export const TOLERANCIA_CONTROL = 0.05;

/** Orden "natural" de códigos de cuenta: 5.2 antes que 5.10. */
export function compararCodigos(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? -1) - (pb[i] ?? -1);
    if (d !== 0) return d;
  }
  return 0;
}

// ── Memoria de cálculo del Ajuste por Inflación (contable) ──────────────────

export const MEMORIA_COLUMNS = [
  { header: 'Origen', key: 'origenLabel', align: 'left' },
  { header: 'Mes (índice)', key: 'mesLabel', align: 'left' },
  { header: 'Saldo', key: 'saldo', align: 'right', render: (r) => formatCurrency(r.saldo), pdfRender: (r) => formatCurrency(r.saldo) },
  { header: 'Índice', key: 'indice', align: 'right', render: (r) => nf(r.indice, 2), pdfRender: (r) => nf(r.indice, 2) },
  { header: 'Coeficiente', key: 'coeficiente', align: 'right', render: (r) => nf(r.coeficiente, 6), pdfRender: (r) => nf(r.coeficiente, 6) },
  { header: 'Saldo reexpresado', key: 'saldoReexpresado', align: 'right', render: (r) => formatCurrency(r.saldoReexpresado), pdfRender: (r) => formatCurrency(r.saldoReexpresado) },
  { header: 'Ajuste', key: 'ajuste', align: 'right', render: (r) => formatCurrency(r.ajuste), pdfRender: (r) => formatCurrency(r.ajuste) },
];

/**
 * Arma la memoria a partir del JSON de `memoria_calculo_ajuste_por_inflacion`
 * (mig.401): detalle cuenta por cuenta y mes por mes + líneas y RECPAM oficiales
 * + el control de que el detalle cierra contra las líneas.
 */
export function armarMemoriaAjuste(memoria) {
  const detalle = memoria?.detalle || [];

  const porCuenta = new Map();
  detalle.forEach(d => {
    if (!porCuenta.has(d.codigo)) {
      porCuenta.set(d.codigo, { codigo: d.codigo, nombre: d.nombre, tipo: d.tipo, filas: [], ajuste: 0 });
    }
    const c = porCuenta.get(d.codigo);
    const fila = {
      codigo: d.codigo, nombre: d.nombre, tipo: d.tipo,
      origen: d.origen, origenLabel: ORIGEN_LABEL[d.origen] || d.origen,
      mes: d.mes, mesLabel: mesLabel(d.mes),
      saldo: num(d.saldo), indice: num(d.indice), coeficiente: num(d.coeficiente),
      saldoReexpresado: num(d.saldo_reexpresado), ajuste: num(d.ajuste),
    };
    c.filas.push(fila);
    c.ajuste += fila.ajuste;
  });
  const cuentas = [...porCuenta.values()].sort((a, b) => compararCodigos(a.codigo, b.codigo));
  // Dentro de una cuenta: primero la apertura, después los meses en orden.
  cuentas.forEach(c => c.filas.sort((a, b) =>
    (a.origen === b.origen ? 0 : a.origen === 'apertura' ? -1 : 1) || String(a.mes).localeCompare(String(b.mes))));

  const filasPlanas = [];
  cuentas.forEach(c => {
    filasPlanas.push({ __rowType: 'group', label: `${c.codigo} — ${c.nombre} (${c.tipo})` });
    filasPlanas.push(...c.filas);
    filasPlanas.push({ __rowType: 'subtotal', label: `Ajuste de ${c.codigo}`, value: c.ajuste, valueText: formatCurrency(c.ajuste) });
  });

  // Índices realmente usados (uno por mes), del más viejo al más nuevo.
  const indices = [...new Map(detalle.map(d => [d.mes, { mes: d.mes, mesLabel: mesLabel(d.mes), indice: num(d.indice), coeficiente: num(d.coeficiente) }])).values()]
    .sort((a, b) => String(a.mes).localeCompare(String(b.mes)));

  const totalAjuste = detalle.reduce((s, d) => s + num(d.ajuste), 0);
  const control = memoria?.control || {};
  const diferencia = num(control.diferencia);

  return {
    periodo: memoria?.periodo || null,
    indiceCierre: memoria?.indice_cierre
      ? { mes: memoria.indice_cierre.mes, mesLabel: mesLabel(memoria.indice_cierre.mes), indice: num(memoria.indice_cierre.indice) }
      : null,
    cuentas,
    filasPlanas,
    indices,
    totalAjuste,
    recpam: { ganancia: num(memoria?.recpam_ganancia), perdida: num(memoria?.recpam_perdida), neto: num(memoria?.recpam_neto) },
    lineas: memoria?.lineas || [],
    asiento: memoria?.asiento || null,
    control: { sumaDetalle: num(control.suma_detalle), sumaLineas: num(control.suma_lineas), diferencia, ok: Math.abs(diferencia) <= TOLERANCIA_CONTROL },
    sinAjuste: detalle.every(d => num(d.ajuste) === 0),
  };
}

/** Pie de la tabla: una sola cifra con sentido (la suma de ajustes); sumar saldos de cuentas distintas no lo tiene. */
export function totalesMemoria(m) {
  return [
    { content: 'TOTAL DE AJUSTES (suma del detalle)', colSpan: MEMORIA_COLUMNS.length - 1, align: 'right' },
    { content: formatCurrency(m.totalAjuste), align: 'right', value: m.totalAjuste },
  ];
}

/** Cajas de arriba (pantalla y PDF). */
export function indicadoresMemoria(m) {
  return [
    { label: 'Ajuste total', value: formatCurrency(m.totalAjuste) },
    { label: 'RECPAM ganancia', value: formatCurrency(m.recpam.ganancia) },
    { label: 'RECPAM pérdida', value: formatCurrency(m.recpam.perdida) },
    { label: 'RECPAM neto', value: formatCurrency(m.recpam.neto) },
  ];
}

// ── Export del Ajuste por Inflación IMPOSITIVO (Ganancias) ──────────────────

export const IMPOSITIVO_COLUMNS = [
  { header: 'Concepto', key: 'concepto', align: 'left' },
  { header: 'Importe', key: 'importe', align: 'right', render: (r) => (r.texto != null ? r.texto : formatCurrency(r.importe)), pdfRender: (r) => (r.texto != null ? r.texto : formatCurrency(r.importe)) },
  { header: 'Cómo se calcula', key: 'formula', align: 'left' },
];

const SALVEDADES = [
  'Estimación de apoyo para armar la Declaración Jurada de Ganancias — no reemplaza el cálculo del asesor impositivo.',
  'Solo excluye Bienes de Uso e Intangibles del activo computable (el resto de la lista del art. 95 LIG no tiene cuenta propia en el plan de cuentas).',
  'No descuenta pasivos no computables (aportes irrevocables sin interés).',
  'No genera ningún asiento contable.',
];

/**
 * Filas del papel de trabajo del ajuste impositivo, a partir del resultado de
 * `calcular_ajuste_impositivo_ganancias`. Devuelve null si el cálculo no fue ok.
 */
export function armarAjusteImpositivoExport(resultado, { fechaInicio, fechaCierre } = {}) {
  if (!resultado?.ok) return null;
  const total = num(resultado.ajuste_total);
  const deducible = total >= 0;
  const data = [
    { concepto: 'Activo computable al inicio', importe: num(resultado.activo_computable_inicio), formula: 'Saldo de las cuentas de activo al inicio del ejercicio, sin Bienes de Uso ni Intangibles' },
    { concepto: 'Pasivo computable al inicio', importe: num(resultado.pasivo_computable_inicio), formula: 'Saldo de las cuentas de pasivo al inicio del ejercicio' },
    { concepto: 'Patrimonio Neto computable al inicio', importe: num(resultado.pn_computable_inicio), formula: 'Activo computable − Pasivo computable' },
    { concepto: 'Coeficiente anual', texto: nf(resultado.coeficiente_anual, 4), formula: 'IPC del mes de cierre ÷ IPC del mes de cierre anterior' },
    { concepto: 'Ajuste estático', importe: num(resultado.ajuste_estatico), formula: '−(PN computable al inicio) × (coeficiente anual − 1)' },
    { concepto: 'Ajuste dinámico', importe: num(resultado.ajuste_dinamico), formula: 'Aportes/retiros de Capital Social y compra/venta de Bienes de Uso e Intangibles, reexpresados al cierre' },
    { concepto: deducible ? 'AJUSTE POR INFLACIÓN IMPOSITIVO TOTAL — deducible (reduce Ganancias)' : 'AJUSTE POR INFLACIÓN IMPOSITIVO TOTAL — gravado (aumenta Ganancias)', importe: Math.abs(total), formula: 'Ajuste estático + Ajuste dinámico' },
  ];
  const mesesSinIndice = resultado.meses_sin_indice || [];
  if (mesesSinIndice.length > 0) {
    data.push({ concepto: 'ATENCIÓN — meses sin índice cargado', texto: '—', formula: `${mesesSinIndice.join(', ')}: esos movimientos quedan sin reexpresar (ajuste dinámico parcial)` });
  }
  SALVEDADES.forEach((s, i) => data.push({ concepto: i === 0 ? 'Salvedades' : '', texto: '', formula: s }));

  return {
    title: 'Ajuste por Inflación Impositivo (Ganancias)',
    startDate: fechaInicio,
    endDate: fechaCierre,
    columns: IMPOSITIVO_COLUMNS,
    data,
    totals: null,
    summaryMetrics: [
      { label: 'Ajuste estático', value: formatCurrency(num(resultado.ajuste_estatico)) },
      { label: 'Ajuste dinámico', value: formatCurrency(num(resultado.ajuste_dinamico)) },
      { label: deducible ? 'Total (deducible)' : 'Total (gravado)', value: formatCurrency(Math.abs(total)) },
    ],
  };
}
