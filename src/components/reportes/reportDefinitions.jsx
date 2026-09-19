import { BarChart3, ShoppingCart, Users, CreditCard, Banknote, Smartphone, Truck, Scale, TrendingUp, Boxes, History, Landmark, Award, CalendarClock, PackageSearch, ShoppingBag } from 'lucide-react';
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
    supportsPeriodComparison: true,
    ayuda: {
      queEs: 'Detalle de todas las ventas facturadas en el período elegido, con la opción de comparar contra el período anterior.',
      queMuestra: ['Fecha, cliente, N° de comprobante y forma de pago de cada venta', 'Ítems vendidos y total por comprobante', 'Totales: Total Ventas, Cantidad, Ticket Promedio, Venta Mayor'],
      filtros: ['Rango de fechas', 'Centro de costo (si está activado)', 'Agrupar por día, método de pago, cliente o lista de precios', 'Comparar contra el período anterior'],
    },
  },
  {
    id: 'rentabilidad_productos',
    title: 'Rentabilidad por Producto',
    description: 'Margen bruto real de cada producto vendido: venta, costo y ganancia.',
    icon: <TrendingUp className="w-8 h-8 text-kx-green" />,
    borderClass: 'border-t-kx-green',
    requiresDate: true,
    supportsCentroCosto: true,
    ayuda: {
      queEs: 'Margen bruto de cada producto vendido en el período: cuánto entró por venta, cuánto costó la mercadería vendida (COGS) y qué ganancia real dejó — no solo facturación. Es el ranking de "qué me conviene vender", ordenado de mayor a menor margen.',
      queMuestra: ['Producto, cantidad vendida', 'Venta total y Costo total (costo de mercadería vendida al momento de cada venta)', 'Margen $ y Margen % por producto'],
      filtros: ['Rango de fechas', 'Centro de costo (si está activado)', 'Ojo: una venta muy vieja que no tenía costo cargado en su momento aparece con 100% de margen — no es un error, es que a esa venta le falta el dato de costo'],
    },
  },
  {
    id: 'rentabilidad_clientes',
    title: 'Rentabilidad por Cliente',
    description: 'Margen bruto real que deja cada cliente, no solo cuánto factura.',
    icon: <TrendingUp className="w-8 h-8 text-kx-violet" />,
    borderClass: 'border-t-kx-violet',
    requiresDate: true,
    supportsCentroCosto: true,
    ayuda: {
      queEs: 'Margen bruto que deja cada cliente en el período: mismo cálculo que Rentabilidad por Producto, pero agrupado por cliente — el cliente que más factura no siempre es el que más plata deja.',
      queMuestra: ['Cliente, cantidad de ítems vendidos', 'Venta total y Costo total (costo de mercadería vendida)', 'Margen $ y Margen % por cliente'],
      filtros: ['Rango de fechas', 'Centro de costo (si está activado)', 'Ojo: un cliente con ventas muy viejas sin costo cargado en su momento aparece con 100% de margen — no es un error, es que a esas ventas les falta el dato de costo'],
    },
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
    supportsPeriodComparison: true,
    ayuda: {
      queEs: 'Registro de las facturas de compra a proveedores registradas en el período elegido.',
      queMuestra: ['Fecha, proveedor, N° de factura y forma de pago', 'Categoría del producto comprado (si la factura mezcla categorías, figura como "Varias")', 'Totales: Total Compras, Cantidad, Promedio'],
      filtros: ['Rango de fechas', 'Centro de costo (si está activado)', 'Agrupar por día, método de pago, proveedor o categoría', 'Comparar contra el período anterior'],
    },
  },
  {
    id: 'clientes',
    title: 'Cartera de Clientes',
    description: 'Estado de cuentas y saldos de clientes.',
    icon: <Users className="w-8 h-8 text-kx-green" />,
    borderClass: 'border-t-kx-green',
    requiresDate: false,
    supportsFiltroDeuda: true,
    ayuda: {
      queEs: 'Estado de cuenta de cada cliente con antigüedad de saldo (aging), reconciliado contra los movimientos reales de Cuenta Corriente — no es un saldo estimado.',
      queMuestra: ['Cliente y saldo actual', 'Antigüedad de la deuda en 4 tramos: 0-30, 31-60, 61-90 y más de 90 días', 'Totales: Total Clientes, Con deuda, Total a Cobrar, Total a Favor'],
      filtros: ['Mostrar solo clientes con deuda'],
    },
  },
  {
    id: 'proveedores',
    title: 'Cartera de Proveedores',
    description: 'Estado de cuentas y antigüedad de deuda con proveedores.',
    icon: <Truck className="w-8 h-8 text-kx-red" />,
    borderClass: 'border-t-kx-red',
    requiresDate: false,
    supportsFiltroDeuda: true,
    ayuda: {
      queEs: 'Estado de cuenta de cada proveedor con antigüedad de deuda (aging), reconciliado contra los movimientos reales de Cuenta Corriente de Proveedores — no es un saldo estimado. Mismo criterio que Cartera de Clientes, del otro lado del mostrador.',
      queMuestra: ['Proveedor y saldo actual (lo que le debés)', 'Antigüedad de la deuda en 4 tramos: 0-30, 31-60, 61-90 y más de 90 días', 'Totales: Total Proveedores, Con deuda, Total a Pagar, Total a Favor'],
      filtros: ['Mostrar solo proveedores con deuda'],
    },
  },
  {
    id: 'cuenta_corriente',
    title: 'Movimientos Cta. Corriente',
    description: 'Extracto de cuenta por cliente, con saldo acumulado.',
    icon: <CreditCard className="w-8 h-8 text-kx-amber" />,
    borderClass: 'border-t-kx-amber',
    requiresDate: true,
    requiresCliente: true,
    ayuda: {
      queEs: 'Extracto de cuenta de un cliente puntual, mostrando cómo se fue formando su saldo movimiento por movimiento.',
      queMuestra: ['Fecha y comprobante de cada movimiento', 'Tipo de movimiento (DEBE / HABER) y monto', 'Saldo acumulado después de cada movimiento', 'Totales: Saldo Anterior, Total DEBE, Total HABER, Saldo Final'],
      filtros: ['Cliente (obligatorio)', 'Rango de fechas'],
    },
  },
  {
    id: 'financiero',
    title: 'Reporte Financiero',
    description: 'Libro de caja: ingresos, egresos y saldo acumulado.',
    icon: <Banknote className="w-8 h-8 text-kx-green" />,
    borderClass: 'border-t-kx-green',
    requiresDate: true,
    supportsGroupBy: true,
    supportsPeriodComparison: true,
    ayuda: {
      queEs: 'Libro de caja: todos los movimientos de ingreso y egreso registrados en el período elegido.',
      queMuestra: ['Fecha, tipo (ingreso/egreso), categoría y concepto de cada movimiento', 'Monto y saldo acumulado', 'Totales: Saldo Inicial, Ingresos, Egresos, Saldo Final'],
      filtros: ['Rango de fechas', 'Agrupar por día, categoría o método de pago', 'Comparar contra el período anterior'],
    },
  },
  {
    id: 'arqueos_caja',
    title: 'Arqueos de Caja',
    description: 'Historial de diferencias al cerrar caja, por cajero y por período.',
    icon: <Scale className="w-8 h-8 text-kx-amber" />,
    borderClass: 'border-t-kx-amber',
    requiresDate: true,
    supportsGroupBy: true,
    ayuda: {
      queEs: 'Historial de las diferencias encontradas al cerrar cada sesión de caja (monto contado vs. monto que el sistema esperaba), para detectar faltantes recurrentes por cajero o por caja.',
      queMuestra: ['Fecha de cierre, caja y quién cerró la sesión', 'Monto esperado, monto real contado y la diferencia', 'Totales: Total Faltante y Total Sobrante (nunca se compensan entre sí)'],
      filtros: ['Rango de fechas', 'Agrupar por día, por cajero o por caja'],
    },
  },
  {
    id: 'valorizacion_inventario',
    title: 'Valorización de Inventario',
    description: 'Cuánta plata tenés parada en stock ahora mismo, por categoría.',
    icon: <Boxes className="w-8 h-8 text-kx-blue" />,
    borderClass: 'border-t-kx-blue',
    requiresDate: false,
    supportsGroupBy: true,
    ayuda: {
      queEs: 'Foto del valor del stock a HOY (no de un período): cada producto activo, su stock actual y su costo, multiplicados — para saber cuánta plata está inmovilizada en mercadería y en qué categorías.',
      queMuestra: ['Producto, categoría y stock actual', 'Costo unitario y Valor total (stock × costo)', 'Total: cantidad de productos, unidades en stock, valor total y productos sin costo cargado'],
      filtros: ['Agrupar por categoría (opcional)'],
    },
  },
  {
    id: 'kardex_inventario',
    title: 'Kardex de Inventario',
    description: 'Ficha de movimientos de un producto puntual, con stock acumulado.',
    icon: <History className="w-8 h-8 text-kx-amber" />,
    borderClass: 'border-t-kx-amber',
    requiresDate: true,
    requiresProducto: true,
    ayuda: {
      queEs: 'Ficha (kardex) de un producto puntual: cada entrada y salida de stock en el período, con el stock resultante después de cada movimiento — para reconstruir "por qué el stock está en el número que está".',
      queMuestra: ['Fecha, tipo de movimiento (entrada/salida/ajuste) y motivo', 'Cantidad de cada movimiento', 'Stock resultante después de cada movimiento', 'Valor aproximado del movimiento, al costo ACTUAL del producto (el sistema no guarda el costo histórico de cada movimiento — no es una valuación contable exacta, es una referencia de magnitud)'],
      filtros: ['Producto (obligatorio)', 'Rango de fechas', 'Ojo: el "Stock Resultante" reconstruye el stock SOLO a partir de los movimientos registrados — en algunos productos puede no coincidir con el stock actual real si hubo algún cambio de stock que no quedó registrado como movimiento'],
    },
  },
  {
    id: 'mp_movimientos',
    title: 'MercadoPago por Tipo',
    description: 'Ingresos y egresos de MP por tipo de cobro, con estado de conciliación.',
    icon: <Smartphone className="w-8 h-8 text-kx-blue" />,
    borderClass: 'border-t-kx-blue',
    requiresDate: true,
    badge: 'MP',
    supportsGroupBy: true,
    supportsPeriodComparison: true,
    ayuda: {
      queEs: 'Cobros y pagos recibidos a través de MercadoPago, separados por tipo (QR, transferencia, tarjeta) y su estado de conciliación con el resumen real de MP.',
      queMuestra: ['Fecha y tipo de cobro (QR / Transferencia / Tarjeta Crédito / Tarjeta Débito)', 'Monto y estado de conciliación', 'Totales: Ingresos, Egresos, Neto, Sin Conciliar'],
      filtros: ['Rango de fechas', 'Agrupar por día o por estado de conciliación', 'Comparar contra el período anterior'],
    },
  },
  {
    id: 'liquidacion_tarjetas',
    title: 'Liquidación de Tarjetas',
    description: 'Cobros con tarjeta que todavía no se acreditaron en el banco.',
    icon: <Landmark className="w-8 h-8 text-kx-blue" />,
    borderClass: 'border-t-kx-blue',
    requiresDate: false,
    ayuda: {
      queEs: 'Ventas cobradas con tarjeta que el banco todavía no acreditó — el dinero está "en camino" pero no disponible. Cuando se acredita, deja de aparecer acá.',
      queMuestra: ['Fecha de la venta, concepto y método de cobro', 'Monto bruto, comisión estimada y monto neto a acreditar', 'Fecha de acreditación estimada'],
      filtros: ['No aplica rango de fechas — siempre muestra todo lo pendiente de acreditar hoy'],
    },
  },
  {
    id: 'pasivo_fidelizacion',
    title: 'Pasivo de Fidelización',
    description: 'Cuánto tenés comprometido en descuentos futuros por puntos.',
    icon: <Award className="w-8 h-8 text-kx-violet" />,
    borderClass: 'border-t-kx-violet',
    requiresDate: false,
    ayuda: {
      queEs: 'Puntos de fidelización que los clientes tienen acumulados y todavía no canjearon, valorizados al tipo de cambio puntos→pesos configurado — es plata que en algún momento se va a convertir en descuento.',
      queMuestra: ['Cliente y saldo de puntos actual', 'Valor en pesos de esos puntos (saldo × valor por punto configurado)', 'Total: clientes con puntos, puntos totales, pasivo total en pesos'],
      filtros: ['No aplica rango de fechas — es el saldo comprometido a hoy, no un movimiento del período'],
    },
  },
  {
    id: 'flujo_cheques',
    title: 'Flujo de Cheques Proyectado',
    description: 'Cuánto cobrás y cuánto pagás en cheques, por fecha de vencimiento.',
    icon: <CalendarClock className="w-8 h-8 text-kx-green" />,
    borderClass: 'border-t-kx-green',
    requiresDate: true,
    ayuda: {
      queEs: 'Cheques de terceros en cartera (todavía no depositados/cobrados) y cheques propios entregados (todavía no debitados), combinados por fecha de vencimiento — para anticipar cuánto entra y cuánto sale de la cuenta.',
      queMuestra: ['Fecha de vencimiento, tipo (a cobrar / a pagar) y de quién', 'Banco y número de cheque', 'Totales: a cobrar, a pagar y el neto proyectado'],
      filtros: ['Rango de fechas de vencimiento (por defecto, los próximos 30 días)'],
    },
  },
  {
    id: 'oc_abiertas',
    title: 'Órdenes de Compra Abiertas',
    description: 'Qué le pediste a los proveedores que todavía no llegó o no se facturó.',
    icon: <PackageSearch className="w-8 h-8 text-kx-amber" />,
    borderClass: 'border-t-kx-amber',
    requiresDate: false,
    ayuda: {
      queEs: 'Consolidado de todas las Órdenes de Compra no canceladas con algo pendiente: mercadería que todavía no llegó, o mercadería que llegó pero todavía no se facturó — línea por línea, no OC por OC.',
      queMuestra: ['N° de OC, proveedor, fecha y producto', 'Cantidad pedida, recibida y facturada', 'Pendiente de recibir y pendiente de facturar', 'Días transcurridos desde que se hizo la OC'],
      filtros: ['No aplica rango de fechas — siempre muestra todo lo que sigue abierto hoy'],
    },
  },
  {
    id: 'detalle_compras_producto',
    title: 'Detalle de Compras por Producto',
    description: 'Qué compraste, cuánto, y a qué costo promedio en el tiempo.',
    icon: <ShoppingBag className="w-8 h-8 text-kx-red" />,
    borderClass: 'border-t-kx-red',
    requiresDate: true,
    supportsCentroCosto: true,
    ayuda: {
      queEs: 'Detalle de compras a nivel de línea de producto (no solo el total de la factura) — para ver qué productos concentran el gasto de compras y a qué costo promedio se vinieron comprando en el período.',
      queMuestra: ['Producto, SKU y categoría', 'Cantidad total comprada y costo total', 'Costo promedio (costo total ÷ cantidad)'],
      filtros: ['Rango de fechas', 'Centro de costo (si está activado)'],
    },
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
  if (reportId === 'rentabilidad_productos' || reportId === 'rentabilidad_clientes') {
    const totalVenta = data.reduce((s, r) => s + (r.venta || 0), 0);
    const totalCosto = data.reduce((s, r) => s + (r.costo || 0), 0);
    const margen = totalVenta - totalCosto;
    return [
      { label: 'Venta Total',  value: fc(totalVenta) },
      { label: 'Costo Total',  value: fc(totalCosto) },
      { label: 'Margen Bruto', value: fc(margen) },
      { label: 'Margen %',     value: totalVenta > 0 ? `${((margen / totalVenta) * 100).toFixed(1)}%` : '—' },
    ];
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
  if (reportId === 'proveedores') {
    // Mismo criterio que Clientes: nunca netear lo que le debemos a un
    // proveedor con un saldo a favor que tengamos con otro.
    const totalAPagar = data.filter(r => (r.saldo || 0) > 0).reduce((s, r) => s + r.saldo, 0);
    const totalAFavorProv = data.filter(r => (r.saldo || 0) < 0).reduce((s, r) => s + Math.abs(r.saldo), 0);
    const conDeudaProv = data.filter(r => r.saldo > 0).length;
    return [
      { label: 'Total Proveedores', value: data.length },
      { label: 'Con deuda',         value: conDeudaProv },
      { label: 'Total a Pagar',     value: fc(totalAPagar) },
      { label: 'Total a Favor',     value: fc(totalAFavorProv) },
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
  if (reportId === 'arqueos_caja') {
    // Nunca compensar faltante contra sobrante — un cajero con $5.000 de
    // faltante un día y $5.000 de sobrante otro día no "cerró en cero", tuvo
    // DOS problemas de arqueo distintos.
    const totalFaltante = data.filter(r => (r.diferencia || 0) < 0).reduce((s, r) => s + Math.abs(r.diferencia), 0);
    const totalSobrante = data.filter(r => (r.diferencia || 0) > 0).reduce((s, r) => s + r.diferencia, 0);
    const conDiferencia = data.filter(r => Math.abs(r.diferencia || 0) > 0.01).length;
    return [
      { label: 'Arqueos',        value: data.length },
      { label: 'Con diferencia', value: conDiferencia },
      { label: 'Total Faltante', value: fc(totalFaltante) },
      { label: 'Total Sobrante', value: fc(totalSobrante) },
    ];
  }
  if (reportId === 'valorizacion_inventario') {
    const unidades = data.reduce((s, r) => s + (r.stock || 0), 0);
    const valorTotal = data.reduce((s, r) => s + (r.valor || 0), 0);
    const sinCosto = data.filter(r => !r.costo).length;
    return [
      { label: 'Productos',          value: data.length },
      { label: 'Unidades en Stock',  value: unidades.toLocaleString('es-AR') },
      { label: 'Valor Total',        value: fc(valorTotal) },
      { label: 'Sin Costo Cargado',  value: sinCosto },
    ];
  }
  if (reportId === 'kardex_inventario') {
    // Mismo criterio que Financiero (Saldo Inicial/Ingresos/Egresos/Saldo
    // Final): la fila sintética "Stock anterior" no es un movimiento real.
    const entradas = data.filter(r => !r.esStockAnterior && r.signo > 0).reduce((s, r) => s + r.cantidad, 0);
    const salidas  = data.filter(r => !r.esStockAnterior && r.signo < 0).reduce((s, r) => s + r.cantidad, 0);
    const stockAnterior = data[0]?.esStockAnterior ? data[0].stock : 0;
    const stockFinal = data.length ? data[data.length - 1].stock : 0;
    return [
      { label: 'Stock Anterior', value: stockAnterior.toLocaleString('es-AR') },
      { label: 'Entradas',       value: `+${entradas.toLocaleString('es-AR')}` },
      { label: 'Salidas',        value: `-${salidas.toLocaleString('es-AR')}` },
      { label: 'Stock Actual',   value: stockFinal.toLocaleString('es-AR') },
    ];
  }
  if (reportId === 'mp_movimientos') {
    // movimientos_bancarios con origen='mercadopago' incluye tanto cobros
    // (tipo='ingreso') como reintegros/contracargos (tipo='egreso') — sumarlos
    // todos como si fueran cobros sobrestima el ingreso real de MP (bug real:
    // con datos de Nalux, "Total MP" daba ~$1,2M cuando el neto real es mucho
    // menor por los egresos QR). Igual criterio que Financiero/Cta.Corriente:
    // nunca netear ingreso/egreso en una sola suma ciega.
    const ingresos = data.reduce((s, r) => s + (r.ingreso || 0), 0);
    const egresos  = data.reduce((s, r) => s + (r.egreso  || 0), 0);
    const sinConciliar = data
      .filter(r => !r.conciliado)
      .reduce((s, r) => s + (r.ingreso || 0) - (r.egreso || 0), 0);
    const metrics = [
      { label: 'Ingresos',       value: fc(ingresos) },
      { label: 'Egresos',        value: fc(egresos) },
      { label: 'Neto',           value: fc(ingresos - egresos) },
      { label: 'Sin Conciliar',  value: fc(sinConciliar) },
    ];
    if (previousPeriod) {
      metrics[0].delta = deltaLabel(ingresos, previousPeriod.ingresos);
      metrics[1].delta = deltaLabel(egresos, previousPeriod.egresos);
    }
    return metrics;
  }
  if (reportId === 'liquidacion_tarjetas') {
    const totalBruto = data.reduce((s, r) => s + (r.monto || 0), 0);
    const totalComision = data.reduce((s, r) => s + (r.comision || 0), 0);
    const totalNeto = data.reduce((s, r) => s + (r.neto || 0), 0);
    return [
      { label: 'Movimientos',      value: data.length },
      { label: 'Monto Bruto',      value: fc(totalBruto) },
      { label: 'Comisión',         value: fc(totalComision) },
      { label: 'Neto a Acreditar', value: fc(totalNeto) },
    ];
  }
  if (reportId === 'pasivo_fidelizacion') {
    const totalPuntos = data.reduce((s, r) => s + (r.saldoPuntos || 0), 0);
    const totalValor = data.reduce((s, r) => s + (r.valorPesos || 0), 0);
    return [
      { label: 'Clientes con Puntos', value: data.length },
      { label: 'Puntos Totales',      value: totalPuntos.toLocaleString('es-AR') },
      { label: 'Pasivo Total',        value: fc(totalValor) },
      { label: 'Valor por Punto',     value: data.length ? fc(data[0].valorPorPunto) : '—' },
    ];
  }
  if (reportId === 'flujo_cheques') {
    // Nunca netear a cobrar contra a pagar en una sola caja — son dos
    // compromisos económicos distintos, mismo criterio que el resto de los
    // reportes (Clientes/Proveedores, Arqueos).
    const totalCobrar = data.filter(r => r.direccion === 'cobrar').reduce((s, r) => s + r.monto, 0);
    const totalPagar  = data.filter(r => r.direccion === 'pagar').reduce((s, r) => s + r.monto, 0);
    return [
      { label: 'Cheques',       value: data.length },
      { label: 'A Cobrar',      value: fc(totalCobrar) },
      { label: 'A Pagar',       value: fc(totalPagar) },
      { label: 'Neto Proyectado', value: fc(totalCobrar - totalPagar) },
    ];
  }
  if (reportId === 'oc_abiertas') {
    const totalPendienteRecibir = data.reduce((s, r) => s + (r.valorPendienteRecibir || 0), 0);
    const totalPendienteFacturar = data.reduce((s, r) => s + (r.valorPendienteFacturar || 0), 0);
    const ocsUnicas = new Set(data.map(r => r.ocId)).size;
    return [
      { label: 'OC Abiertas',            value: ocsUnicas },
      { label: 'Líneas Pendientes',      value: data.length },
      { label: 'Valor Pend. Recibir',    value: fc(totalPendienteRecibir) },
      { label: 'Valor Pend. Facturar',   value: fc(totalPendienteFacturar) },
    ];
  }
  if (reportId === 'detalle_compras_producto') {
    const totalCantidad = data.reduce((s, r) => s + (r.cantidad || 0), 0);
    const totalCosto = data.reduce((s, r) => s + (r.costo || 0), 0);
    return [
      { label: 'Productos',       value: data.length },
      { label: 'Unidades Compradas', value: totalCantidad.toLocaleString('es-AR') },
      { label: 'Costo Total',     value: fc(totalCosto) },
      { label: 'Costo Promedio',  value: totalCantidad > 0 ? fc(totalCosto / totalCantidad) : '—' },
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

  if (reportId === 'rentabilidad_productos' || reportId === 'rentabilidad_clientes') {
    const esPorProducto = reportId === 'rentabilidad_productos';
    const totalCantidad = data.reduce((s, r) => s + (r.cantidad || 0), 0);
    const totalVenta = data.reduce((s, r) => s + (r.venta || 0), 0);
    const totalCosto = data.reduce((s, r) => s + (r.costo || 0), 0);
    const totalMargen = totalVenta - totalCosto;
    return {
      columns: [
        { header: esPorProducto ? 'Producto' : 'Cliente', key: 'nombre', align: 'left' },
        ...(esPorProducto ? [{ header: 'SKU', key: 'sku', align: 'left', render: (r) => r.sku || '-' }] : []),
        { header: 'Cantidad', key: 'cantidad', align: 'right', render: (r) => r.cantidad.toLocaleString('es-AR'), pdfRender: (r) => r.cantidad.toLocaleString('es-AR') },
        { header: 'Venta', key: 'venta', align: 'right', render: (r) => formatCurrency(r.venta), pdfRender: (r) => formatCurrency(r.venta) },
        { header: 'Costo', key: 'costo', align: 'right', render: (r) => formatCurrency(r.costo), pdfRender: (r) => formatCurrency(r.costo) },
        {
          header: 'Margen $', key: 'margen', align: 'right',
          render: (r) => <span className={r.margen >= 0 ? 'text-green-600 dark:text-green-400 font-bold' : 'text-red-600 dark:text-red-400 font-bold'}>{formatCurrency(r.margen)}</span>,
          pdfRender: (r) => formatCurrency(r.margen),
        },
        { header: 'Margen %', key: 'margenPct', align: 'right', render: (r) => `${r.margenPct.toFixed(1)}%`, pdfRender: (r) => `${r.margenPct.toFixed(1)}%` },
      ],
      totals: [
        { content: 'TOTALES', colSpan: esPorProducto ? 2 : 1, align: 'right' },
        { content: totalCantidad.toLocaleString('es-AR'), align: 'right' },
        { content: formatCurrency(totalVenta), align: 'right', value: totalVenta },
        { content: formatCurrency(totalCosto), align: 'right', value: totalCosto },
        { content: formatCurrency(totalMargen), align: 'right', value: totalMargen },
        { content: totalVenta > 0 ? `${((totalMargen / totalVenta) * 100).toFixed(1)}%` : '—', align: 'right' },
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

  if (reportId === 'proveedores') {
    // Ver nota en buildSummaryMetrics: nunca netear deudores y acreedores.
    const totalAPagar = data.filter(r => (r.saldo || 0) > 0).reduce((s, r) => s + r.saldo, 0);
    const totalAFavorProv = data.filter(r => (r.saldo || 0) < 0).reduce((s, r) => s + Math.abs(r.saldo), 0);
    return {
      columns: [
        { header: 'Proveedor', key: 'nombre', align: 'left' },
        { header: 'Email', key: 'email', align: 'left', render: (r) => r.email || '-' },
        { header: 'Teléfono', key: 'telefono', align: 'left', render: (r) => r.telefono || '-' },
        {
          header: 'Saldo Actual', key: 'saldo', align: 'right',
          render: (r) => <span className={r.saldo > 0 ? 'text-red-600 font-bold' : 'text-green-600 dark:text-green-400'}>{formatCurrency(r.saldo)}</span>,
          pdfRender: (r) => formatCurrency(r.saldo),
        },
        // Antigüedad de saldos — mismo criterio de días que Cartera de Clientes.
        { header: '0-30',  key: 'aging_0_30',   align: 'right', render: (r) => r.aging_0_30   ? formatCurrency(r.aging_0_30)   : '-', pdfRender: (r) => r.aging_0_30   ? formatCurrency(r.aging_0_30)   : '-' },
        { header: '31-60', key: 'aging_31_60',  align: 'right', render: (r) => r.aging_31_60  ? formatCurrency(r.aging_31_60)  : '-', pdfRender: (r) => r.aging_31_60  ? formatCurrency(r.aging_31_60)  : '-' },
        { header: '61-90', key: 'aging_61_90',  align: 'right', render: (r) => r.aging_61_90  ? formatCurrency(r.aging_61_90)  : '-', pdfRender: (r) => r.aging_61_90  ? formatCurrency(r.aging_61_90)  : '-' },
        { header: '+90',   key: 'aging_90_mas', align: 'right', render: (r) => r.aging_90_mas ? <span className="text-red-600 font-bold">{formatCurrency(r.aging_90_mas)}</span> : '-', pdfRender: (r) => r.aging_90_mas ? formatCurrency(r.aging_90_mas) : '-' },
      ],
      totals: [
        { content: `TOTAL A PAGAR: ${formatCurrency(totalAPagar)} | TOTAL A FAVOR: ${formatCurrency(totalAFavorProv)}`, colSpan: 4, align: 'right' },
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

  if (reportId === 'arqueos_caja') {
    const totalFaltante = data.filter(r => (r.diferencia || 0) < 0).reduce((s, r) => s + Math.abs(r.diferencia), 0);
    const totalSobrante = data.filter(r => (r.diferencia || 0) > 0).reduce((s, r) => s + r.diferencia, 0);
    return {
      columns: [
        { header: 'Fecha', key: 'fecha', align: 'left', render: (r) => formatDateAR(r.fecha), pdfRender: (r) => formatDateAR(r.fecha) },
        { header: 'Caja', key: 'caja', align: 'left', render: (r) => r.caja || '-' },
        { header: 'Cerrado por', key: 'cajero', align: 'left', render: (r) => r.cajero || '-' },
        { header: 'Esperado', key: 'esperado', align: 'right', render: (r) => formatCurrency(r.esperado), pdfRender: (r) => formatCurrency(r.esperado) },
        { header: 'Real', key: 'real', align: 'right', render: (r) => formatCurrency(r.real), pdfRender: (r) => formatCurrency(r.real) },
        {
          header: 'Diferencia', key: 'diferencia', align: 'right',
          render: (r) => {
            if (Math.abs(r.diferencia) < 0.01) return <span className="text-kx-text-3">—</span>;
            return <span className={r.diferencia < 0 ? 'text-red-600 dark:text-red-400 font-bold' : 'text-green-600 dark:text-green-400 font-bold'}>{formatCurrency(r.diferencia)}</span>;
          },
          pdfRender: (r) => formatCurrency(r.diferencia),
        },
      ],
      totals: [
        { content: `TOTAL FALTANTE: ${formatCurrency(totalFaltante)} | TOTAL SOBRANTE: ${formatCurrency(totalSobrante)}`, colSpan: 5, align: 'right' },
        { content: formatCurrency(data.reduce((s, r) => s + (r.diferencia || 0), 0)), align: 'right', value: data.reduce((s, r) => s + (r.diferencia || 0), 0) },
      ]
    };
  }

  if (reportId === 'valorizacion_inventario') {
    const totalStock = data.reduce((s, r) => s + (r.stock || 0), 0);
    const totalValor = data.reduce((s, r) => s + (r.valor || 0), 0);
    return {
      columns: [
        { header: 'Producto', key: 'nombre', align: 'left' },
        { header: 'SKU', key: 'sku', align: 'left', render: (r) => r.sku || '-' },
        { header: 'Categoría', key: 'categoria', align: 'left' },
        { header: 'Stock', key: 'stock', align: 'right', render: (r) => r.stock.toLocaleString('es-AR'), pdfRender: (r) => r.stock.toLocaleString('es-AR') },
        { header: 'Costo Unitario', key: 'costo', align: 'right', render: (r) => r.costo ? formatCurrency(r.costo) : <span className="text-amber-600 dark:text-amber-400">Sin costo</span>, pdfRender: (r) => r.costo ? formatCurrency(r.costo) : 'Sin costo' },
        { header: 'Valor Total', key: 'valor', align: 'right', render: (r) => formatCurrency(r.valor), pdfRender: (r) => formatCurrency(r.valor) },
      ],
      totals: [
        { content: 'TOTALES', colSpan: 3, align: 'right' },
        { content: totalStock.toLocaleString('es-AR'), align: 'right' },
        { content: '', align: 'right' },
        { content: formatCurrency(totalValor), align: 'right', value: totalValor },
      ]
    };
  }

  if (reportId === 'kardex_inventario') {
    const TIPO_LABEL = { entrada: 'Entrada', ingreso: 'Entrada', salida: 'Salida', ajuste: 'Ajuste (recuento)' };
    const entradas = data.filter(r => !r.esStockAnterior && r.signo > 0).reduce((s, r) => s + r.cantidad, 0);
    const salidas  = data.filter(r => !r.esStockAnterior && r.signo < 0).reduce((s, r) => s + r.cantidad, 0);
    return {
      columns: [
        { header: 'Fecha', key: 'fecha', align: 'left', render: (r) => formatDateAR(r.fecha), pdfRender: (r) => formatDateAR(r.fecha) },
        {
          header: 'Tipo', key: 'tipo', align: 'left',
          render: (r) => r.esStockAnterior ? <span className="italic text-kx-text-2">—</span> : (TIPO_LABEL[r.tipo] || r.tipo),
          pdfRender: (r) => r.esStockAnterior ? '—' : (TIPO_LABEL[r.tipo] || r.tipo),
        },
        { header: 'Motivo', key: 'motivo', align: 'left', render: (r) => r.motivo || '-' },
        {
          header: 'Cantidad', key: 'cantidad', align: 'right',
          render: (r) => {
            if (r.esStockAnterior) return '-';
            const signoTxt = r.signo > 0 ? '+' : r.signo < 0 ? '-' : '=';
            return <span className={r.signo > 0 ? 'text-green-600 dark:text-green-400' : r.signo < 0 ? 'text-red-600 dark:text-red-400' : ''}>{signoTxt}{r.cantidad.toLocaleString('es-AR')}</span>;
          },
          pdfRender: (r) => r.esStockAnterior ? '-' : `${r.signo > 0 ? '+' : r.signo < 0 ? '-' : '='}${r.cantidad.toLocaleString('es-AR')}`,
        },
        {
          header: 'Stock Resultante', key: 'stock', align: 'right',
          render: (r) => <span className={r.esStockAnterior ? 'italic text-kx-text-2' : 'font-bold'}>{r.stock.toLocaleString('es-AR')}</span>,
          pdfRender: (r) => r.stock.toLocaleString('es-AR'),
        },
        { header: 'Valor (costo actual)', key: 'valor', align: 'right', render: (r) => r.esStockAnterior ? '-' : formatCurrency(r.valor), pdfRender: (r) => r.esStockAnterior ? '-' : formatCurrency(r.valor) },
      ],
      totals: [
        { content: `ENTRADAS: +${entradas.toLocaleString('es-AR')} | SALIDAS: -${salidas.toLocaleString('es-AR')}`, colSpan: 4, align: 'right' },
        { content: data.length ? data[data.length - 1].stock.toLocaleString('es-AR') : '0', align: 'right' },
        { content: '', align: 'right' },
      ]
    };
  }

  if (reportId === 'mp_movimientos') {
    // Ingreso/Egreso en columnas separadas (ver nota en buildSummaryMetrics —
    // nunca sumar tipo='ingreso' y tipo='egreso' como si fueran lo mismo).
    // Sin columna de saldo acumulado a propósito: esto es un recorte por
    // origen='mercadopago' de movimientos_bancarios, no la cuenta completa —
    // un "saldo" acá no representaría el saldo real de ninguna cuenta.
    const totalIngresos = data.reduce((s, r) => s + (r.ingreso || 0), 0);
    const totalEgresos  = data.reduce((s, r) => s + (r.egreso  || 0), 0);

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
          header: 'Ingreso', key: 'ingreso', align: 'right',
          render: (r) => r.ingreso ? formatCurrency(r.ingreso) : '-',
          pdfRender: (r) => r.ingreso ? formatCurrency(r.ingreso) : '-',
        },
        {
          header: 'Egreso', key: 'egreso', align: 'right',
          render: (r) => r.egreso ? formatCurrency(r.egreso) : '-',
          pdfRender: (r) => r.egreso ? formatCurrency(r.egreso) : '-',
        },
        {
          header: 'Conciliado', key: 'conciliado', align: 'center',
          render: (r) => (
            <span className={`px-2 py-0.5 rounded text-xs font-semibold ${r.conciliado ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'}`}>
              {r.conciliado ? 'Sí' : 'No'}
            </span>
          ),
          pdfRender: (r) => (r.conciliado ? 'Sí' : 'No'),
        },
      ],
      totals: [
        { content: 'TOTALES', colSpan: 3, align: 'right' },
        { content: formatCurrency(totalIngresos), align: 'right', value: totalIngresos },
        { content: formatCurrency(totalEgresos),  align: 'right', value: totalEgresos },
        { content: '', align: 'right' },
      ]
    };
  }

  if (reportId === 'liquidacion_tarjetas') {
    const totalBruto = data.reduce((s, r) => s + (r.monto || 0), 0);
    const totalComision = data.reduce((s, r) => s + (r.comision || 0), 0);
    const totalNeto = data.reduce((s, r) => s + (r.neto || 0), 0);
    return {
      columns: [
        { header: 'Fecha', key: 'fecha', align: 'left', render: (r) => formatDateAR(r.fecha), pdfRender: (r) => formatDateAR(r.fecha) },
        { header: 'Concepto', key: 'concepto', align: 'left' },
        { header: 'Método', key: 'metodo', align: 'center', render: (r) => r.metodo || '-' },
        { header: 'Monto Bruto', key: 'monto', align: 'right', render: (r) => formatCurrency(r.monto), pdfRender: (r) => formatCurrency(r.monto) },
        { header: 'Comisión', key: 'comision', align: 'right', render: (r) => r.comision ? formatCurrency(r.comision) : '-', pdfRender: (r) => r.comision ? formatCurrency(r.comision) : '-' },
        { header: 'Neto', key: 'neto', align: 'right', render: (r) => <span className="font-bold">{formatCurrency(r.neto)}</span>, pdfRender: (r) => formatCurrency(r.neto) },
        { header: 'Acreditación Est.', key: 'fechaAcreditacion', align: 'left', render: (r) => r.fechaAcreditacion ? formatDateAR(r.fechaAcreditacion) : '-', pdfRender: (r) => r.fechaAcreditacion ? formatDateAR(r.fechaAcreditacion) : '-' },
      ],
      totals: [
        { content: 'TOTALES', colSpan: 3, align: 'right' },
        { content: formatCurrency(totalBruto), align: 'right', value: totalBruto },
        { content: formatCurrency(totalComision), align: 'right', value: totalComision },
        { content: formatCurrency(totalNeto), align: 'right', value: totalNeto },
        { content: '', align: 'right' },
      ]
    };
  }

  if (reportId === 'pasivo_fidelizacion') {
    const totalPuntos = data.reduce((s, r) => s + (r.saldoPuntos || 0), 0);
    const totalValor = data.reduce((s, r) => s + (r.valorPesos || 0), 0);
    return {
      columns: [
        { header: 'Cliente', key: 'nombre', align: 'left' },
        { header: 'Saldo de Puntos', key: 'saldoPuntos', align: 'right', render: (r) => r.saldoPuntos.toLocaleString('es-AR'), pdfRender: (r) => r.saldoPuntos.toLocaleString('es-AR') },
        { header: 'Valor en Pesos', key: 'valorPesos', align: 'right', render: (r) => formatCurrency(r.valorPesos), pdfRender: (r) => formatCurrency(r.valorPesos) },
      ],
      totals: [
        { content: 'TOTALES', colSpan: 1, align: 'right' },
        { content: totalPuntos.toLocaleString('es-AR'), align: 'right' },
        { content: formatCurrency(totalValor), align: 'right', value: totalValor },
      ]
    };
  }

  if (reportId === 'flujo_cheques') {
    const totalCobrar = data.filter(r => r.direccion === 'cobrar').reduce((s, r) => s + r.monto, 0);
    const totalPagar  = data.filter(r => r.direccion === 'pagar').reduce((s, r) => s + r.monto, 0);
    return {
      columns: [
        { header: 'Vencimiento', key: 'fecha', align: 'left', render: (r) => formatDateAR(r.fecha), pdfRender: (r) => formatDateAR(r.fecha) },
        {
          header: 'Dirección', key: 'direccion', align: 'center',
          render: (r) => <span className={`px-2 py-0.5 rounded text-xs font-semibold ${r.direccion === 'cobrar' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>{r.direccion === 'cobrar' ? 'A Cobrar' : 'A Pagar'}</span>,
          pdfRender: (r) => r.direccion === 'cobrar' ? 'A Cobrar' : 'A Pagar',
        },
        { header: 'De / Para', key: 'contraparte', align: 'left', render: (r) => r.contraparte || '-' },
        { header: 'Banco', key: 'banco', align: 'left', render: (r) => r.banco || '-' },
        { header: 'Número', key: 'numero', align: 'left', render: (r) => r.numero || '-' },
        {
          header: 'Monto', key: 'monto', align: 'right',
          render: (r) => <span className={r.direccion === 'cobrar' ? 'text-green-600 dark:text-green-400 font-bold' : 'text-red-600 dark:text-red-400 font-bold'}>{formatCurrency(r.monto)}</span>,
          pdfRender: (r) => formatCurrency(r.monto),
        },
      ],
      totals: [
        { content: `A COBRAR: ${formatCurrency(totalCobrar)} | A PAGAR: ${formatCurrency(totalPagar)} | NETO: ${formatCurrency(totalCobrar - totalPagar)}`, colSpan: 6, align: 'right' },
      ]
    };
  }

  if (reportId === 'oc_abiertas') {
    const totalPendRecibir = data.reduce((s, r) => s + (r.valorPendienteRecibir || 0), 0);
    const totalPendFacturar = data.reduce((s, r) => s + (r.valorPendienteFacturar || 0), 0);
    return {
      columns: [
        { header: 'N° OC', key: 'numero', align: 'left' },
        { header: 'Proveedor', key: 'proveedor', align: 'left' },
        { header: 'Fecha', key: 'fecha', align: 'left', render: (r) => formatDateAR(r.fecha), pdfRender: (r) => formatDateAR(r.fecha) },
        { header: 'Producto', key: 'producto', align: 'left' },
        { header: 'Pedido', key: 'pedida', align: 'right', render: (r) => r.pedida.toLocaleString('es-AR'), pdfRender: (r) => r.pedida.toLocaleString('es-AR') },
        { header: 'Recibido', key: 'recibida', align: 'right', render: (r) => r.recibida.toLocaleString('es-AR'), pdfRender: (r) => r.recibida.toLocaleString('es-AR') },
        {
          header: 'Pend. Recibir', key: 'pendienteRecibir', align: 'right',
          render: (r) => r.pendienteRecibir > 0 ? <span className="text-amber-600 dark:text-amber-400 font-bold">{r.pendienteRecibir.toLocaleString('es-AR')}</span> : '-',
          pdfRender: (r) => r.pendienteRecibir > 0 ? r.pendienteRecibir.toLocaleString('es-AR') : '-',
        },
        {
          header: 'Pend. Facturar', key: 'pendienteFacturar', align: 'right',
          render: (r) => r.pendienteFacturar > 0 ? <span className="text-blue-600 dark:text-blue-400 font-bold">{r.pendienteFacturar.toLocaleString('es-AR')}</span> : '-',
          pdfRender: (r) => r.pendienteFacturar > 0 ? r.pendienteFacturar.toLocaleString('es-AR') : '-',
        },
        { header: 'Días', key: 'dias', align: 'right', render: (r) => r.dias, pdfRender: (r) => String(r.dias) },
      ],
      totals: [
        { content: `VALOR PEND. RECIBIR: ${formatCurrency(totalPendRecibir)} | VALOR PEND. FACTURAR: ${formatCurrency(totalPendFacturar)}`, colSpan: 9, align: 'right' },
      ]
    };
  }

  if (reportId === 'detalle_compras_producto') {
    const totalCantidad = data.reduce((s, r) => s + (r.cantidad || 0), 0);
    const totalCosto = data.reduce((s, r) => s + (r.costo || 0), 0);
    return {
      columns: [
        { header: 'Producto', key: 'nombre', align: 'left' },
        { header: 'SKU', key: 'sku', align: 'left', render: (r) => r.sku || '-' },
        { header: 'Categoría', key: 'categoria', align: 'left' },
        { header: 'Cantidad', key: 'cantidad', align: 'right', render: (r) => r.cantidad.toLocaleString('es-AR'), pdfRender: (r) => r.cantidad.toLocaleString('es-AR') },
        { header: 'Costo Total', key: 'costo', align: 'right', render: (r) => formatCurrency(r.costo), pdfRender: (r) => formatCurrency(r.costo) },
        { header: 'Costo Promedio', key: 'costoPromedio', align: 'right', render: (r) => formatCurrency(r.costoPromedio), pdfRender: (r) => formatCurrency(r.costoPromedio) },
      ],
      totals: [
        { content: 'TOTALES', colSpan: 3, align: 'right' },
        { content: totalCantidad.toLocaleString('es-AR'), align: 'right' },
        { content: formatCurrency(totalCosto), align: 'right', value: totalCosto },
        { content: totalCantidad > 0 ? formatCurrency(totalCosto / totalCantidad) : '-', align: 'right' },
      ]
    };
  }

  return { columns: [], totals: [] };
};

const GROUP_BY_OPTIONS_POR_REPORTE = {
  ventas: [
    { value: 'none',         label: 'Sin agrupar' },
    { value: 'dia',          label: 'Por día' },
    { value: 'metodo_pago',  label: 'Por método de pago' },
    { value: 'cliente',      label: 'Por cliente' },
    { value: 'lista_precio', label: 'Por lista de precios' },
  ],
  compras: [
    { value: 'none',        label: 'Sin agrupar' },
    { value: 'dia',         label: 'Por día' },
    { value: 'metodo_pago', label: 'Por método de pago' },
    { value: 'proveedor',   label: 'Por proveedor' },
    { value: 'categoria',   label: 'Por categoría de producto' },
  ],
  financiero: [
    { value: 'none',        label: 'Sin agrupar' },
    { value: 'dia',         label: 'Por día' },
    { value: 'categoria',   label: 'Por categoría' },
    { value: 'metodo_pago', label: 'Por método de pago' },
  ],
  mp_movimientos: [
    { value: 'none',       label: 'Sin agrupar' },
    { value: 'dia',        label: 'Por día' },
    { value: 'subtipo',    label: 'Por tipo de cobro' },
    { value: 'conciliado', label: 'Por estado de conciliación' },
  ],
  arqueos_caja: [
    { value: 'none',   label: 'Sin agrupar' },
    { value: 'dia',    label: 'Por día' },
    { value: 'cajero', label: 'Por cajero' },
    { value: 'caja',   label: 'Por caja' },
  ],
  valorizacion_inventario: [
    { value: 'none',      label: 'Sin agrupar' },
    { value: 'categoria', label: 'Por categoría' },
  ],
};

export function getGroupByOptions(reportId) {
  return GROUP_BY_OPTIONS_POR_REPORTE[reportId] || [{ value: 'none', label: 'Sin agrupar' }];
}

const GROUP_KEY_FN_POR_REPORTE = {
  ventas: {
    dia:          (r) => formatDateAR(r.fecha),
    metodo_pago:  (r) => r.metodo_pago || 'Sin método',
    cliente:      (r) => r.cliente || 'Sin cliente',
    lista_precio: (r) => r.lista_precio || 'Precio estándar',
  },
  compras: {
    dia:         (r) => formatDateAR(r.fecha),
    metodo_pago: (r) => r.forma_pago || 'Sin método',
    proveedor:   (r) => r.proveedor || 'Sin proveedor',
    categoria:   (r) => r.categoria || 'Sin categoría',
  },
  financiero: {
    dia:         (r) => formatDateAR(r.fecha),
    categoria:   (r) => r.categoria || 'Sin categoría',
    metodo_pago: (r) => r.metodo_pago || 'Sin método',
  },
  mp_movimientos: {
    dia:        (r) => formatDateAR(r.fecha),
    subtipo:    (r) => SUBTIPO_LABEL[r.subtipo] || 'Otro',
    conciliado: (r) => r.conciliado ? 'Conciliado' : 'Sin conciliar',
  },
  arqueos_caja: {
    dia:    (r) => formatDateAR(r.fecha),
    cajero: (r) => r.cajero || 'Sin datos',
    caja:   (r) => r.caja || 'Sin datos',
  },
  valorizacion_inventario: {
    categoria: (r) => r.categoria || 'Sin categoría',
  },
};

// Subtotal por grupo — ventas/compras suman `total`; financiero (Libro de
// Caja) y mp_movimientos no tienen un solo campo "total" por fila (Ingreso y
// Egreso son columnas separadas), el subtotal ahí es el neto ingreso-egreso
// del grupo.
const GROUP_SUBTOTAL_FN_POR_REPORTE = {
  financiero:               (r) => (r.ingreso || 0) - (r.egreso || 0),
  mp_movimientos:           (r) => (r.ingreso || 0) - (r.egreso || 0),
  arqueos_caja:             (r) => r.diferencia || 0,
  valorizacion_inventario:  (r) => r.valor || 0,
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
 * Filtro "solo con deuda" de Cartera de Clientes/Proveedores — oculta filas
 * con saldo 0 o a favor (negativo). En la práctica quien cobra/paga no
 * quiere ver los 7 clientes, quiere ver los 3 que le deben.
 */
export function applyFiltroDeuda(reportId, data, soloConDeuda) {
  if ((reportId !== 'clientes' && reportId !== 'proveedores') || !soloConDeuda) return data;
  return data.filter(r => (r.saldo || 0) > 0);
}
