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
    supportsCentroCosto: true
  },
  {
    id: 'compras',
    title: 'Historial de Compras',
    description: 'Registro detallado de compras a proveedores.',
    icon: <ShoppingCart className="w-8 h-8 text-kx-blue" />,
    borderClass: 'border-t-kx-blue',
    requiresDate: true,
    supportsCentroCosto: true
  },
  {
    id: 'clientes',
    title: 'Cartera de Clientes',
    description: 'Estado de cuentas y saldos de clientes.',
    icon: <Users className="w-8 h-8 text-kx-green" />,
    borderClass: 'border-t-kx-green',
    requiresDate: false
  },
  {
    id: 'cuenta_corriente',
    title: 'Movimientos Cta. Corriente',
    description: 'Flujo de pagos y deudas global.',
    icon: <CreditCard className="w-8 h-8 text-kx-amber" />,
    borderClass: 'border-t-kx-amber',
    requiresDate: true
  },
  {
    id: 'financiero',
    title: 'Reporte Financiero',
    description: 'Balance de ingresos y egresos de caja.',
    icon: <Banknote className="w-8 h-8 text-kx-green" />,
    borderClass: 'border-t-kx-green',
    requiresDate: true
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

export const buildSummaryMetrics = (reportId, data) => {
  // maximumFractionDigits fijo en 2: sin esto, toLocaleString puede mostrar
  // hasta 3 decimales (spec de Intl.NumberFormat) — se vio en el PDF real como
  // "$32.230,491" en vez de "$32.230,49", inconsistente con formatCurrency()
  // que sí usa la tabla de abajo (esa sí tiene el tope).
  const fc = (n) => `$${Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (reportId === 'ventas') {
    const total = data.reduce((s, r) => s + (r.total || 0), 0);
    const max   = data.length ? Math.max(...data.map(r => r.total || 0)) : 0;
    return [
      { label: 'Total Ventas',    value: fc(total) },
      { label: 'Cantidad',        value: data.length },
      { label: 'Ticket Promedio', value: data.length ? fc(total / data.length) : '—' },
      { label: 'Venta Mayor',     value: fc(max) },
    ];
  }
  if (reportId === 'compras') {
    const total = data.reduce((s, r) => s + (r.total || 0), 0);
    return [
      { label: 'Total Compras', value: fc(total) },
      { label: 'Cantidad',      value: data.length },
      { label: 'Promedio',      value: data.length ? fc(total / data.length) : '—' },
    ];
  }
  if (reportId === 'clientes') {
    const deuda = data.reduce((s, r) => s + (r.saldo || 0), 0);
    const conDeuda = data.filter(r => r.saldo > 0).length;
    return [
      { label: 'Total Clientes', value: data.length },
      { label: 'Con deuda',      value: conDeuda },
      { label: 'Total Deuda',    value: fc(deuda) },
    ];
  }
  if (reportId === 'financiero') {
    const ing = data.filter(r => r.tipo === 'ingreso').reduce((s, r) => s + r.monto, 0);
    const egr = data.filter(r => r.tipo === 'egreso').reduce((s, r) => s + r.monto, 0);
    return [
      { label: 'Ingresos',  value: fc(ing) },
      { label: 'Egresos',   value: fc(egr) },
      { label: 'Balance',   value: fc(ing - egr) },
      { label: 'Registros', value: data.length },
    ];
  }
  if (reportId === 'cuenta_corriente') {
    const debe  = data.filter(r => r.tipo === 'DEBE').reduce((s, r) => s + r.monto, 0);
    const haber = data.filter(r => r.tipo === 'HABER').reduce((s, r) => s + r.monto, 0);
    return [
      { label: 'Total DEBE',  value: fc(debe) },
      { label: 'Total HABER', value: fc(haber) },
      { label: 'Balance',     value: fc(debe - haber) },
      { label: 'Movimientos', value: data.length },
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
        { content: formatCurrency(totalAmount), align: 'right' }
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
        { header: 'Total', key: 'total', align: 'right', render: (r) => formatCurrency(r.total), pdfRender: (r) => formatCurrency(r.total) }
      ],
      totals: [
        { content: 'TOTAL COMPRAS', colSpan: 3, align: 'right' },
        { content: formatCurrency(totalAmount), align: 'right' }
      ]
    };
  }

  if (reportId === 'clientes') {
    const totalBalance = data.reduce((acc, curr) => acc + (curr.saldo || 0), 0);
    return {
      columns: [
        { header: 'Nombre', key: 'nombre', align: 'left' },
        { header: 'Email', key: 'email', align: 'left', render: (r) => r.email || '-' },
        { header: 'Teléfono', key: 'telefono', align: 'left', render: (r) => r.telefono || '-' },
        { header: 'Saldo Actual', key: 'saldo', align: 'right', render: (r) => <span className={r.saldo > 0 ? 'text-red-600 font-bold' : 'text-green-600 dark:text-green-400'}>{formatCurrency(r.saldo)}</span>, pdfRender: (r) => formatCurrency(r.saldo) }
      ],
      totals: [
        { content: 'TOTAL CARTERA', colSpan: 3, align: 'right' },
        { content: formatCurrency(totalBalance), align: 'right' }
      ]
    };
  }

  if (reportId === 'cuenta_corriente') {
    const totalDebe = data.filter(d => d.tipo === 'DEBE').reduce((acc, c) => acc + c.monto, 0);
    const totalHaber = data.filter(d => d.tipo === 'HABER').reduce((acc, c) => acc + c.monto, 0);
    const balance = totalDebe - totalHaber;

    return {
      columns: [
        { header: 'Fecha', key: 'fecha', align: 'left', render: (r) => formatDateAR(r.fecha), pdfRender: (r) => formatDateAR(r.fecha) },
        { header: 'Cliente', key: 'cliente', align: 'left' },
        { header: 'Tipo', key: 'tipo', align: 'center', render: (r) => <span className={`px-2 py-1 rounded text-xs font-bold ${r.tipo === 'DEBE' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'}`}>{r.tipo}</span> },
        { header: 'Descripción', key: 'descripcion', align: 'left' },
        { header: 'Monto', key: 'monto', align: 'right', render: (r) => formatCurrency(r.monto), pdfRender: (r) => formatCurrency(r.monto) }
      ],
      totals: [
        { content: `DEBE: ${formatCurrency(totalDebe)} | HABER: ${formatCurrency(totalHaber)} | NETO: ${formatCurrency(balance)}`, colSpan: 5, align: 'right' }
      ]
    };
  }

  if (reportId === 'financiero') {
    const ingresos = data.filter(d => d.tipo === 'ingreso').reduce((acc, curr) => acc + curr.monto, 0);
    const egresos = data.filter(d => d.tipo === 'egreso').reduce((acc, curr) => acc + curr.monto, 0);
    return {
      columns: [
        { header: 'Fecha', key: 'fecha', align: 'left', render: (r) => formatDateAR(r.fecha), pdfRender: (r) => formatDateAR(r.fecha) },
        { header: 'Tipo', key: 'tipo', align: 'center', render: (r) => r.tipo.toUpperCase() },
        { header: 'Categoría', key: 'categoria', align: 'left' },
        { header: 'Concepto', key: 'concepto', align: 'left' },
        { header: 'Monto', key: 'monto', align: 'right', render: (r) => formatCurrency(r.monto), pdfRender: (r) => formatCurrency(r.monto) }
      ],
      totals: [
        { content: `INGRESOS: ${formatCurrency(ingresos)} | EGRESOS: ${formatCurrency(egresos)} | BALANCE: ${formatCurrency(ingresos - egresos)}`, colSpan: 5, align: 'right' }
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
