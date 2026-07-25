import { BarChart3, ShoppingCart, Users, CreditCard, Banknote, Smartphone } from 'lucide-react';
import { formatDateAR } from '@/lib/dateUtils';
import { formatCurrency } from '@/lib/currencyUtils';

export const SUBTIPO_LABEL = {
  'transferencia':   'CVU / Transferencia',
  'qr':              'QR / Billetera',
  'tarjeta_credito': 'Tarjeta Crédito',
  'tarjeta_debito':  'Tarjeta Débito',
};

export const SUBTIPO_COLORS = {
  'transferencia':   'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  'qr':              'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  'tarjeta_credito': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  'tarjeta_debito':  'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
};

export const REPORTS = [
  {
    id: 'ventas',
    title: 'Reporte de Ventas',
    description: 'Detalle de ventas por período con totales.',
    icon: <BarChart3 className="w-8 h-8 text-kx-violet" />,
    borderClass: 'border-t-kx-violet',
    requiresDate: true,
    supportsCentroCosto: true,
    supportsGroupBy: true,
    supportsPeriodComparison: true
  },
  {
    id: 'compras',
    title: 'Historial de Compras',
    description: 'Registro detallado de compras a proveedores.',
    icon: <ShoppingCart className="w-8 h-8 text-kx-blue" />,
    borderClass: 'border-t-kx-blue',
    requiresDate: true,
    supportsCentroCosto: true,
    supportsGroupBy: true,
    supportsPeriodComparison: true
  },
  {
    id: 'clientes',
    title: 'Cartera de Clientes',
    description: 'Estado de cuentas y saldos de clientes.',
    icon: <Users className="w-8 h-8 text-kx-green" />,
    borderClass: 'border-t-kx-green',
    requiresDate: false,
    supportsFiltroDeuda: true
  },
  {
    id: 'cuenta_corriente',
    title: 'Movimientos Cta. Corriente',
    description: 'Extracto de cuenta por cliente, con saldo acumulado.',
    icon: <CreditCard className="w-8 h-8 text-kx-amber" />,
    borderClass: 'border-t-kx-amber',
    requiresDate: true,
    requiresCliente: true
  },
  {
    id: 'financiero',
    title: 'Reporte Financiero',
    description: 'Libro de caja: ingresos, egresos y saldo acumulado.',
    icon: <Banknote className="w-8 h-8 text-kx-green" />,
    borderClass: 'border-t-kx-green',
    requiresDate: true,
    supportsGroupBy: true,
    supportsPeriodComparison: true
  },
  {
    id: 'mp_movimientos',
    title: 'MercadoPago por Tipo',
    description: 'Cobros de MP segmentados: CVU/transferencia, QR/billetera, tarjeta crédito y débito.',
    icon: <Smartphone className="w-8 h-8 text-kx-blue" />,
    borderClass: 'border-t-kx-blue',
    requiresDate: true,
    badge: 'MP',
  },
];

// % variación vs. un valor anterior — null si no hay base de comparación
// válida (sin datos del período anterior, o el anterior fue 0).
const deltaLabel = (actual, anterior) => {
  if (!anterior) return null;
  const pct = ((actual - anterior) / anterior) * 100;
  const signo = pct >= 0 ? '+' : '';
  return { text: `${signo}${pct.toFixed(1)}% vs período anterior`, positivo: pct >= 0 };
};

export const buildSummaryMetrics = (reportId, data, previousPeriod = null) => {
  // maximumFractionDigits fijo en 2: sin esto, toLocaleString puede mostrar
  // hasta 3 decimales (spec de Intl.NumberFormat) — se vio en el PDF real como
  // "$32.230,491" en vez de "$32.230,49", inconsistente con formatCurrency()
  // que sí usa la tabla de abajo (esa sí tiene el tope).
  const fc = (n) => `$${Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (reportId === 'ventas') {
    const total = data.reduce((s, r) => s + (r.total || 0), 0);
    const max   = data.length ? Math.max(...data.map(r => r.total || 0)) : 0;
    const metrics = [
      { label: 'Total Ventas',    value: fc(total) },
      { label: 'Cantidad',        value: data.length },
      { label: 'Ticket Promedio', value: data.length ? fc(total / data.length) : '—' },
      { label: 'Venta Mayor',     value: fc(max) },
    ];
    if (previousPeriod) {
      metrics[0].delta = deltaLabel(total, previousPeriod.total);
      metrics[1].delta = deltaLabel(data.length, previousPeriod.count);
    }
    return metrics;
  }
  if (reportId === 'compras') {
    const total = data.reduce((s, r) => s + (r.total || 0), 0);
    const metrics = [
      { label: 'Total Compras', value: fc(total) },
      { label: 'Cantidad',      value: data.length },
      { label: 'Promedio',      value: data.length ? fc(total / data.length) : '—' },
    ];
    if (previousPeriod) {
      metrics[0].delta = deltaLabel(total, previousPeriod.total);
      metrics[1].delta = deltaLabel(data.length, previousPeriod.count);
    }
    return metrics;
  }
  if (reportId === 'clientes') {
    // Nunca netear deudores y acreedores en un mismo total — un cliente que
    // debe y otro con saldo a favor son cosas económicamente distintas,
    // aunque ambos aparezcan en la misma cartera. Sumarlos daba un "Total
    // Deuda" que no coincidía con el widget "Deuda Clientes" del Dashboard
    // (ese sí suma solo positivos) — se veía como si el reporte tuviera un
    // bug.
    const totalACobrar = data.filter(r => (r.saldo || 0) > 0).reduce((s, r) => s + r.saldo, 0);
    const totalAFavor  = data.filter(r => (r.saldo || 0) < 0).reduce((s, r) => s + Math.abs(r.saldo), 0);
    const conDeuda = data.filter(r => r.saldo > 0).length;
    return [
      { label: 'Total Clientes', value: data.length },
      { label: 'Con deuda',      value: conDeuda },
      { label: 'Total a Cobrar', value: fc(totalACobrar) },
      { label: 'Total a Favor',  value: fc(totalAFavor) },
    ];
  }
  if (reportId === 'financiero') {
    // Libro de caja: arranca de un Saldo Inicial (movimientos previos al
    // período, fila sintética) y termina en un Saldo Final acumulado —
    // mismo criterio que el extracto de Cuenta Corriente, aplicado acá a la
    // caja en vez de a un cliente.
    const ing = data.reduce((s, r) => s + (r.ingreso || 0), 0);
    const egr = data.reduce((s, r) => s + (r.egreso || 0), 0);
    const saldoInicial = data[0]?.esSaldoInicial ? data[0].saldo : 0;
    const saldoFinal = data.length ? data[data.length - 1].saldo : 0;
    const metrics = [
      { label: 'Saldo Inicial', value: fc(saldoInicial) },
      { label: 'Ingresos',      value: fc(ing) },
      { label: 'Egresos',       value: fc(egr) },
      { label: 'Saldo Final',   value: fc(saldoFinal) },
    ];
    if (previousPeriod) {
      metrics[1].delta = deltaLabel(ing, previousPeriod.ingresos);
      metrics[2].delta = deltaLabel(egr, previousPeriod.egresos);
    }
    return metrics;
  }
  if (reportId === 'cuenta_corriente') {
    const debe  = data.reduce((s, r) => s + (r.debe || 0), 0);
    const haber = data.reduce((s, r) => s + (r.haber || 0), 0);
    const saldoAnterior = data[0]?.esSaldoAnterior ? data[0].saldo : 0;
    const saldoFinal = data.length ? data[data.length - 1].saldo : 0;
    return [
      { label: 'Saldo Anterior', value: fc(saldoAnterior) },
      { label: 'Total DEBE',     value: fc(debe) },
      { label: 'Total HABER',    value: fc(haber) },
      { label: 'Saldo Final',    value: fc(saldoFinal) },
    ];
  }
  if (reportId === 'mp_movimientos') {
    const total = data.reduce((s, r) => s + (r.monto || 0), 0);
    const transf = data.filter(r => r.subtipo === 'transferencia').reduce((s, r) => s + (r.monto || 0), 0);
    const qr     = data.filter(r => r.subtipo === 'qr').reduce((s, r) => s + (r.monto || 0), 0);
    const tarj   = data.filter(r => ['tarjeta_credito','tarjeta_debito'].includes(r.subtipo)).reduce((s, r) => s + (r.monto || 0), 0);
    return [
      { label: 'Total MP',        value: fc(total) },
      { label: 'Transferencias',  value: fc(transf) },
      { label: 'QR / Billetera',  value: fc(qr) },
      { label: 'Tarjetas',        value: fc(tarj) },
    ];
  }
  return null;
};

export const getTableConfig = (reportId, data) => {
  if (reportId === 'ventas') {
    const totalAmount = data.reduce((acc, curr) => acc + (curr.total || 0), 0);
    return {
      columns: [
        { header: 'Fecha', key: 'fecha', align: 'left', render: (r) => formatDateAR(r.fecha), pdfRender: (r) => formatDateAR(r.fecha) },
        { header: 'Cliente', key: 'cliente', align: 'left' },
        { header: 'Comprobante', key: 'comprobante', align: 'left' },
        { header: 'Pago', key: 'metodo_pago', align: 'center' },
        { header: 'Items', key: 'items', align: 'center' },
        { header: 'Total', key: 'total', align: 'right', render: (r) => formatCurrency(r.total), pdfRender: (r) => formatCurrency(r.total) }
      ],
      totals: [
        { content: 'TOTALES', colSpan: 4, align: 'right' },
        { content: data.length, align: 'center' },
        { content: formatCurrency(totalAmount), align: 'right', value: totalAmount }
      ]
    };
  }

  if (reportId === 'compras') {
    const totalAmount = data.reduce((acc, curr) => acc + (curr.total || 0), 0);
    return {
      columns: [
        { header: 'Fecha', key: 'fecha', align: 'left', render: (r) => formatDateAR(r.fecha), pdfRender: (r) => formatDateAR(r.fecha) },
        { header: 'Proveedor', key: 'proveedor', align: 'left' },
        { header: 'N° Factura', key: 'numero_factura', align: 'left' },
        { header: 'Pago', key: 'forma_pago', align: 'center', render: (r) => r.forma_pago || '-' },
        { header: 'Total', key: 'total', align: 'right', render: (r) => formatCurrency(r.total), pdfRender: (r) => formatCurrency(r.total) }
      ],
      totals: [
        { content: 'TOTAL COMPRAS', colSpan: 4, align: 'right' },
        { content: formatCurrency(totalAmount), align: 'right', value: totalAmount }
      ]
    };
  }

  if (reportId === 'clientes') {
    // Ver nota en buildSummaryMetrics: nunca netear deudores y acreedores.
    const totalACobrar = data.filter(r => (r.saldo || 0) > 0).reduce((s, r) => s + r.saldo, 0);
    const totalAFavor  = data.filter(r => (r.saldo || 0) < 0).reduce((s, r) => s + Math.abs(r.saldo), 0);
    return {
      columns: [
        { header: 'Nombre', key: 'nombre', align: 'left' },
        { header: 'Email', key: 'email', align: 'left', render: (r) => r.email || '-' },
        { header: 'Teléfono', key: 'telefono', align: 'left', render: (r) => r.telefono || '-' },
        {
          header: 'Límite Crédito', key: 'limite_credito', align: 'right',
          render: (r) => r.limite_credito ? formatCurrency(r.limite_credito) : '-',
          pdfRender: (r) => r.limite_credito ? formatCurrency(r.limite_credito) : '-',
        },
        {
          header: 'Saldo Actual', key: 'saldo', align: 'right',
          render: (r) => {
            const pasado = r.limite_credito > 0 && r.saldo > r.limite_credito;
            return <span className={pasado ? 'text-red-700 dark:text-red-400 font-bold' : r.saldo > 0 ? 'text-red-600 font-bold' : 'text-green-600 dark:text-green-400'} title={pasado ? 'Superó el límite de crédito' : undefined}>{formatCurrency(r.saldo)}</span>;
          },
          pdfRender: (r) => formatCurrency(r.saldo),
        },
        // Antigüedad de saldos — Open Item Management real (facturas_saldo_pendiente),
        // mismo criterio de días que ya usa Cuenta Corriente > Antigüedad.
        { header: '0-30',  key: 'aging_0_30',   align: 'right', render: (r) => r.aging_0_30   ? formatCurrency(r.aging_0_30)   : '-', pdfRender: (r) => r.aging_0_30   ? formatCurrency(r.aging_0_30)   : '-' },
        { header: '31-60', key: 'aging_31_60',  align: 'right', render: (r) => r.aging_31_60  ? formatCurrency(r.aging_31_60)  : '-', pdfRender: (r) => r.aging_31_60  ? formatCurrency(r.aging_31_60)  : '-' },
        { header: '61-90', key: 'aging_61_90',  align: 'right', render: (r) => r.aging_61_90  ? formatCurrency(r.aging_61_90)  : '-', pdfRender: (r) => r.aging_61_90  ? formatCurrency(r.aging_61_90)  : '-' },
        { header: '+90',   key: 'aging_90_mas', align: 'right', render: (r) => r.aging_90_mas ? <span className="text-red-600 font-bold">{formatCurrency(r.aging_90_mas)}</span> : '-', pdfRender: (r) => r.aging_90_mas ? formatCurrency(r.aging_90_mas) : '-' },
      ],
      totals: [
        { content: `TOTAL A COBRAR: ${formatCurrency(totalACobrar)} | TOTAL A FAVOR: ${formatCurrency(totalAFavor)}`, colSpan: 5, align: 'right' },
        { content: formatCurrency(data.reduce((s, r) => s + (r.aging_0_30 || 0), 0)),   align: 'right', value: data.reduce((s, r) => s + (r.aging_0_30 || 0), 0) },
        { content: formatCurrency(data.reduce((s, r) => s + (r.aging_31_60 || 0), 0)),  align: 'right', value: data.reduce((s, r) => s + (r.aging_31_60 || 0), 0) },
        { content: formatCurrency(data.reduce((s, r) => s + (r.aging_61_90 || 0), 0)),  align: 'right', value: data.reduce((s, r) => s + (r.aging_61_90 || 0), 0) },
        { content: formatCurrency(data.reduce((s, r) => s + (r.aging_90_mas || 0), 0)), align: 'right', value: data.reduce((s, r) => s + (r.aging_90_mas || 0), 0) },
      ]
    };
  }

  if (reportId === 'cuenta_corriente') {
    // Extracto por cliente estilo resumen bancario: orden cronológico
    // ascendente + saldo acumulado fila a fila, arrancando del saldo previo
    // al período (fila sintética "Saldo Anterior", armada en ReportesSection).
    // Debe/Haber en columnas separadas (no Monto+badge Tipo) — es el formato
    // que un contador/cliente reconoce como "extracto de cuenta corriente".
    const totalDebe = data.reduce((s, r) => s + (r.debe || 0), 0);
    const totalHaber = data.reduce((s, r) => s + (r.haber || 0), 0);
    const saldoFinal = data.length ? data[data.length - 1].saldo : 0;

    return {
      columns: [
        { header: 'Fecha', key: 'fecha', align: 'left', render: (r) => formatDateAR(r.fecha), pdfRender: (r) => formatDateAR(r.fecha) },
        { header: 'Descripción', key: 'descripcion', align: 'left', render: (r) => <span className={r.esSaldoAnterior ? 'italic text-kx-text-2' : ''}>{r.descripcion}</span>, pdfRender: (r) => r.descripcion },
        { header: 'Debe', key: 'debe', align: 'right', render: (r) => r.debe ? formatCurrency(r.debe) : '-', pdfRender: (r) => r.debe ? formatCurrency(r.debe) : '-' },
        { header: 'Haber', key: 'haber', align: 'right', render: (r) => r.haber ? formatCurrency(r.haber) : '-', pdfRender: (r) => r.haber ? formatCurrency(r.haber) : '-' },
        {
          header: 'Saldo', key: 'saldo', align: 'right',
          render: (r) => <span className={r.saldo > 0 ? 'font-bold text-red-600 dark:text-red-400' : r.saldo < 0 ? 'text-green-600 dark:text-green-400' : ''}>{formatCurrency(r.saldo)}</span>,
          pdfRender: (r) => formatCurrency(r.saldo),
        },
      ],
      totals: [
        { content: 'TOTALES', colSpan: 2, align: 'right' },
        { content: formatCurrency(totalDebe),  align: 'right', value: totalDebe },
        { content: formatCurrency(totalHaber), align: 'right', value: totalHaber },
        { content: formatCurrency(saldoFinal), align: 'right', value: saldoFinal },
      ]
    };
  }

  if (reportId === 'financiero') {
    // Formato "Libro de Caja" estándar (fecha, concepto, ingreso, egreso,
    // saldo) en vez de una lista plana Tipo+Monto — orden cronológico
    // ascendente + saldo acumulado, arrancando de la fila sintética "Saldo
    // Inicial" armada en ReportesSection.
    const totalIngresos = data.reduce((s, r) => s + (r.ingreso || 0), 0);
    const totalEgresos  = data.reduce((s, r) => s + (r.egreso  || 0), 0);
    const saldoFinal = data.length ? data[data.length - 1].saldo : 0;

    return {
      columns: [
        { header: 'Fecha', key: 'fecha', align: 'left', render: (r) => formatDateAR(r.fecha), pdfRender: (r) => formatDateAR(r.fecha) },
        { header: 'Categoría', key: 'categoria', align: 'left', render: (r) => r.categoria || '-', pdfRender: (r) => r.categoria || '-' },
        { header: 'Concepto', key: 'concepto', align: 'left', render: (r) => <span className={r.esSaldoInicial ? 'italic text-kx-text-2' : ''}>{r.concepto}</span>, pdfRender: (r) => r.concepto },
        { header: 'Pago', key: 'metodo_pago', align: 'center', render: (r) => r.metodo_pago || '-', pdfRender: (r) => r.metodo_pago || '-' },
        { header: 'Ingreso', key: 'ingreso', align: 'right', render: (r) => r.ingreso ? formatCurrency(r.ingreso) : '-', pdfRender: (r) => r.ingreso ? formatCurrency(r.ingreso) : '-' },
        { header: 'Egreso', key: 'egreso', align: 'right', render: (r) => r.egreso ? formatCurrency(r.egreso) : '-', pdfRender: (r) => r.egreso ? formatCurrency(r.egreso) : '-' },
        {
          header: 'Saldo', key: 'saldo', align: 'right',
          render: (r) => <span className={r.saldo < 0 ? 'font-bold text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}>{formatCurrency(r.saldo)}</span>,
          pdfRender: (r) => formatCurrency(r.saldo),
        },
      ],
      totals: [
        { content: 'TOTALES', colSpan: 4, align: 'right' },
        { content: formatCurrency(totalIngresos), align: 'right', value: totalIngresos },
        { content: formatCurrency(totalEgresos),  align: 'right', value: totalEgresos },
        { content: formatCurrency(saldoFinal),    align: 'right', value: saldoFinal },
      ]
    };
  }

  if (reportId === 'mp_movimientos') {
    const total = data.reduce((acc, m) => acc + (m.monto || 0), 0);

    // Totales por subtipo
    const bySubtipo = {};
    data.forEach(m => {
      const key = m.subtipo || 'otro';
      bySubtipo[key] = (bySubtipo[key] || 0) + (m.monto || 0);
    });

    const resumenPartes = Object.entries(bySubtipo).map(
      ([k, v]) => `${SUBTIPO_LABEL[k] || 'Otro'}: ${formatCurrency(v)}`
    );
    const resumen = [...resumenPartes, `TOTAL: ${formatCurrency(total)}`].join(' | ');

    return {
      columns: [
        {
          header: 'Fecha', key: 'fecha', align: 'left',
          render: (r) => formatDateAR(r.fecha),
          pdfRender: (r) => formatDateAR(r.fecha),
        },
        { header: 'Descripción', key: 'descripcion', align: 'left' },
        {
          header: 'Tipo de cobro', key: 'subtipo', align: 'center',
          render: (r) => (
            <span className={`px-2 py-0.5 rounded text-xs font-semibold ${SUBTIPO_COLORS[r.subtipo] || 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
              {SUBTIPO_LABEL[r.subtipo] || 'Otro'}
            </span>
          ),
          pdfRender: (r) => SUBTIPO_LABEL[r.subtipo] || 'Otro',
        },
        {
          header: 'Monto', key: 'monto', align: 'right',
          render: (r) => formatCurrency(r.monto),
          pdfRender: (r) => formatCurrency(r.monto),
        },
      ],
      totals: [
        { content: resumen, colSpan: 4, align: 'right' }
      ]
    };
  }

  return { columns: [], totals: [] };
};

const GROUP_BY_OPTIONS_POR_REPORTE = {
  ventas: [
    { value: 'none',        label: 'Sin agrupar' },
    { value: 'dia',         label: 'Por día' },
    { value: 'metodo_pago', label: 'Por método de pago' },
    { value: 'cliente',     label: 'Por cliente' },
  ],
  compras: [
    { value: 'none',        label: 'Sin agrupar' },
    { value: 'dia',         label: 'Por día' },
    { value: 'metodo_pago', label: 'Por método de pago' },
    { value: 'proveedor',   label: 'Por proveedor' },
  ],
  financiero: [
    { value: 'none',        label: 'Sin agrupar' },
    { value: 'dia',         label: 'Por día' },
    { value: 'categoria',   label: 'Por categoría' },
    { value: 'metodo_pago', label: 'Por método de pago' },
  ],
};

export function getGroupByOptions(reportId) {
  return GROUP_BY_OPTIONS_POR_REPORTE[reportId] || [{ value: 'none', label: 'Sin agrupar' }];
}

const GROUP_KEY_FN_POR_REPORTE = {
  ventas: {
    dia:         (r) => formatDateAR(r.fecha),
    metodo_pago: (r) => r.metodo_pago || 'Sin método',
    cliente:     (r) => r.cliente || 'Sin cliente',
  },
  compras: {
    dia:         (r) => formatDateAR(r.fecha),
    metodo_pago: (r) => r.forma_pago || 'Sin método',
    proveedor:   (r) => r.proveedor || 'Sin proveedor',
  },
  financiero: {
    dia:         (r) => formatDateAR(r.fecha),
    categoria:   (r) => r.categoria || 'Sin categoría',
    metodo_pago: (r) => r.metodo_pago || 'Sin método',
  },
};

// Subtotal por grupo — ventas/compras suman `total`; financiero (Libro de
// Caja) no tiene un solo campo "total" por fila (Ingreso y Egreso son
// columnas separadas), el subtotal ahí es el neto ingreso-egreso del grupo.
const GROUP_SUBTOTAL_FN_POR_REPORTE = {
  financiero: (r) => (r.ingreso || 0) - (r.egreso || 0),
};

/**
 * Inserta filas de encabezado de grupo + subtotal en los datos (Ventas o
 * Compras, los dos reportes con supportsGroupBy) cuando el usuario elige
 * agrupar. Mantiene el orden de aparición del primer registro de cada grupo
 * (no reordena por alfabético ni por monto) para no romper el orden
 * cronológico que el usuario ya conoce. Las filas sintéticas se marcan con
 * `__rowType` — los 3 renderers (ReportTable, pdfUtils, excelUtils) las
 * detectan y las pintan distinto en vez de tratarlas como una fila de datos.
 */
export function applyGrouping(reportId, data, groupBy) {
  if (!groupBy || groupBy === 'none') return data;
  const keyFn = (GROUP_KEY_FN_POR_REPORTE[reportId] || {})[groupBy];
  if (!keyFn) return data;

  // Filas sintéticas de saldo inicial/anterior (Libro de Caja, extracto de
  // Cta. Corriente) no son un movimiento real agrupable — se muestran
  // siempre primero, fuera de cualquier grupo.
  const fijas = data.filter(r => r.esSaldoInicial || r.esSaldoAnterior);
  const agrupables = data.filter(r => !r.esSaldoInicial && !r.esSaldoAnterior);

  const subtotalFn = GROUP_SUBTOTAL_FN_POR_REPORTE[reportId] || ((r) => r.total || 0);
  const groups = new Map();
  agrupables.forEach(row => {
    const key = keyFn(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });

  const result = [...fijas];
  groups.forEach((rows, key) => {
    const subtotal = rows.reduce((s, r) => s + subtotalFn(r), 0);
    result.push({ __rowType: 'group', label: `${key} (${rows.length})` });
    result.push(...rows);
    result.push({ __rowType: 'subtotal', label: `Subtotal — ${key}`, value: subtotal, valueText: formatCurrency(subtotal) });
  });
  return result;
}

/**
 * Filtro "solo con deuda" de Cartera de Clientes — oculta clientes con saldo
 * 0 o a favor (negativo). En la práctica quien cobra no quiere ver los 7
 * clientes, quiere ver los 3 que le deben.
 */
export function applyFiltroDeuda(reportId, data, soloConDeuda) {
  if (reportId !== 'clientes' || !soloConDeuda) return data;
  return data.filter(r => (r.saldo || 0) > 0);
}
