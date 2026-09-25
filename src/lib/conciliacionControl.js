// Reporte «Conciliación de cuentas de control» (auditoría 24/09, CON-5; función de la base: mig.414).
// Puro (sin red ni React) para poder probarlo con datos armados a mano. Lo que devuelve sirve igual para
// la pantalla, el PDF y el Excel.
//
// La función `conciliacion_cuentas_control` trae:
//   cuentas:   { clave, titulo, cuenta_codigo, cuenta_nombre, cuenta_existe, mayor, subdiario, subdiario_desc,
//                diferencia, conciliado }   — el mayor contra el subdiario de cada cuenta de control
//   controles: { clave, titulo, ayuda, casos, monto, estado ('ok' | 'revisar'), detalle: [...] }
//              — chequeos de integridad, con hasta 25 casos de detalle
import { formatCurrency } from '@/lib/currencyUtils';

const num = (v) => Number(v) || 0;

/** Columnas del detalle de cada control: cómo se llama cada dato y cómo se muestra. */
export const DETALLE_COLUMNAS = {
  cc_sin_cliente: [
    { key: 'fecha', label: 'Fecha', tipo: 'fecha' },
    { key: 'movimiento', label: 'Movimiento', tipo: 'texto' },
    { key: 'monto', label: 'Monto', tipo: 'moneda' },
    { key: 'descripcion', label: 'Descripción', tipo: 'texto' },
  ],
  cc_ficha_vs_movimientos: [
    { key: 'cliente', label: 'Cliente', tipo: 'texto' },
    { key: 'saldo_ficha', label: 'Saldo de la ficha', tipo: 'moneda' },
    { key: 'suma_movimientos', label: 'Suma de movimientos', tipo: 'moneda' },
    { key: 'diferencia', label: 'Diferencia', tipo: 'moneda' },
  ],
  productos_sin_costo: [
    { key: 'producto', label: 'Producto', tipo: 'texto' },
    { key: 'stock', label: 'Stock', tipo: 'numero' },
  ],
  cuentas_saldo_desfasado: [
    { key: 'cuenta', label: 'Cuenta', tipo: 'texto' },
    { key: 'saldo_mostrado', label: 'Saldo mostrado', tipo: 'moneda' },
    { key: 'saldo_real', label: 'Suma de sus asientos', tipo: 'moneda' },
  ],
  asientos_desbalanceados: [
    { key: 'asiento', label: 'Asiento', tipo: 'texto' },
    { key: 'fecha', label: 'Fecha', tipo: 'fecha' },
    { key: 'debe', label: 'Debe', tipo: 'moneda' },
    { key: 'haber', label: 'Haber', tipo: 'moneda' },
  ],
  documentos_sin_asiento: [
    { key: 'documento', label: 'Documento', tipo: 'texto' },
    { key: 'numero', label: 'Número', tipo: 'texto' },
    { key: 'fecha', label: 'Fecha', tipo: 'fecha' },
    { key: 'total', label: 'Total', tipo: 'moneda' },
  ],
  asientos_duplicados: [
    { key: 'tipo', label: 'Tipo de asiento', tipo: 'texto' },
    { key: 'asientos', label: 'Asientos', tipo: 'texto' },
    { key: 'importe_de_mas', label: 'Importe de más', tipo: 'moneda' },
  ],
};

/** 'YYYY-MM-DD…' → 'DD/MM/YYYY' ('—' si falta). */
const fechaAR = (f) => {
  const t = String(f || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return '—';
  const [y, m, d] = t.split('-');
  return `${d}/${m}/${y}`;
};

/** Cómo se ve un dato del detalle según su tipo. */
export function formatearCelda(valor, tipo) {
  if (valor === null || valor === undefined || valor === '') return '—';
  if (tipo === 'moneda') return formatCurrency(num(valor));
  if (tipo === 'numero') return num(valor).toLocaleString('es-AR');
  if (tipo === 'fecha') return fechaAR(valor);
  return String(valor);
}

/** Columnas del detalle de un control (las conocidas; para uno nuevo, las claves tal cual). */
export function columnasDetalle(clave, detalle = []) {
  if (DETALLE_COLUMNAS[clave]) return DETALLE_COLUMNAS[clave];
  const keys = detalle[0] ? Object.keys(detalle[0]) : [];
  return keys.map((key) => ({ key, label: key, tipo: 'texto' }));
}

/**
 * Normaliza la respuesta de la base y calcula el resumen de arriba.
 * Devuelve { generadoEn, cuentas, controles, resumen, filasPlanas }.
 */
export function armarConciliacion(data) {
  const cuentas = (data?.cuentas ?? []).map((c) => ({
    clave: c.clave,
    titulo: c.titulo,
    cuentaCodigo: c.cuenta_codigo,
    cuentaNombre: c.cuenta_nombre ?? null,
    cuentaExiste: c.cuenta_existe !== false,
    mayor: num(c.mayor),
    subdiario: num(c.subdiario),
    subdiarioDesc: c.subdiario_desc ?? '',
    diferencia: num(c.diferencia),
    conciliado: c.conciliado === true,
  }));

  const controles = (data?.controles ?? []).map((k) => {
    const detalle = Array.isArray(k.detalle) ? k.detalle : [];
    return {
      clave: k.clave,
      titulo: k.titulo,
      ayuda: k.ayuda ?? '',
      casos: num(k.casos),
      monto: k.monto === null || k.monto === undefined ? null : num(k.monto),
      ok: k.estado === 'ok',
      detalle,
      columnas: columnasDetalle(k.clave, detalle),
    };
  });

  const resumen = {
    cuentasTotal: cuentas.length,
    cuentasConcilian: cuentas.filter((c) => c.conciliado).length,
    cuentasConDiferencia: cuentas.filter((c) => !c.conciliado).length,
    controlesTotal: controles.length,
    controlesARevisar: controles.filter((k) => !k.ok).length,
  };
  resumen.todoOk = resumen.cuentasConDiferencia === 0 && resumen.controlesARevisar === 0;

  return { generadoEn: data?.generado_en ?? null, cuentas, controles, resumen, filasPlanas: armarFilasPlanas(cuentas, controles) };
}

// ── PDF y Excel ─────────────────────────────────────────────────────────────

export const CONCILIACION_COLUMNS = [
  { header: 'Concepto', key: 'concepto', align: 'left' },
  { header: 'Saldo del mayor', key: 'mayor', align: 'right', render: (r) => (r.mayor == null ? '' : formatCurrency(r.mayor)), pdfRender: (r) => (r.mayor == null ? '' : formatCurrency(r.mayor)) },
  { header: 'Saldo del subdiario', key: 'subdiario', align: 'right', render: (r) => (r.subdiario == null ? '' : formatCurrency(r.subdiario)), pdfRender: (r) => (r.subdiario == null ? '' : formatCurrency(r.subdiario)) },
  { header: 'Diferencia / Importe', key: 'importe', align: 'right', render: (r) => (r.importe == null ? '' : formatCurrency(r.importe)), pdfRender: (r) => (r.importe == null ? '' : formatCurrency(r.importe)) },
  { header: 'Estado', key: 'estado', align: 'left' },
];

/** Una sola tabla con dos secciones (cuentas de control y controles de integridad), para el PDF y el Excel. */
function armarFilasPlanas(cuentas, controles) {
  const filas = [];
  filas.push({ __rowType: 'group', label: 'Cuentas de control: mayor contra subdiario' });
  cuentas.forEach((c) => {
    filas.push({
      concepto: `${c.titulo} (${c.cuentaCodigo})`,
      mayor: c.mayor,
      subdiario: c.subdiario,
      importe: c.diferencia,
      estado: c.conciliado ? 'Concilia' : 'Con diferencia',
    });
  });
  filas.push({ __rowType: 'group', label: 'Controles de integridad' });
  controles.forEach((k) => {
    filas.push({
      concepto: k.ok ? k.titulo : `${k.titulo} — ${k.casos} ${k.casos === 1 ? 'caso' : 'casos'}`,
      mayor: null,
      subdiario: null,
      importe: k.monto,
      estado: k.ok ? 'Sin casos' : 'A revisar',
    });
  });
  return filas;
}

/** Cajas de arriba (pantalla y PDF). */
export function indicadoresConciliacion(c) {
  return [
    { label: 'Cuentas que concilian', value: `${c.resumen.cuentasConcilian} de ${c.resumen.cuentasTotal}` },
    { label: 'Cuentas con diferencia', value: String(c.resumen.cuentasConDiferencia) },
    { label: 'Controles a revisar', value: `${c.resumen.controlesARevisar} de ${c.resumen.controlesTotal}` },
  ];
}
