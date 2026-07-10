import { supabase } from '@/lib/customSupabaseClient';
import { getStartOfDayAR, getEndOfDayAR, getNowAR } from '@/lib/dateUtils';
import type { DashboardKPIs, TopCliente, VentasPorDia, FlujoCajaMensual, Producto } from '@/types';

export const dashboardService = {
  async getKPIs(empresaId: string): Promise<DashboardKPIs> {
    const now = getNowAR();
    const todayStart = getStartOfDayAR(now);
    const todayEnd = getEndOfDayAR(now);
    const ayer = new Date(now.getTime() - 86400000);
    const mesStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

    const [
      ventasHoy, ventasAyer, ventasMes, gastosMes,
      deudaTotal, stockRaw, comprobantesRes, ocRes,
    ] = await Promise.all([
      supabase.from('movimientos_caja').select('monto').eq('empresa_id', empresaId).eq('tipo', 'ingreso').eq('categoria', 'Venta').gte('fecha', todayStart).lte('fecha', todayEnd),
      supabase.from('movimientos_caja').select('monto').eq('empresa_id', empresaId).eq('tipo', 'ingreso').eq('categoria', 'Venta').gte('fecha', getStartOfDayAR(ayer)).lte('fecha', getEndOfDayAR(ayer)),
      supabase.from('movimientos_caja').select('monto').eq('empresa_id', empresaId).eq('tipo', 'ingreso').gte('fecha', mesStart).lte('fecha', todayEnd),
      supabase.from('movimientos_caja').select('monto').eq('empresa_id', empresaId).eq('tipo', 'egreso').neq('categoria', 'Apertura').gte('fecha', mesStart).lte('fecha', todayEnd),
      supabase.from('clientes').select('saldo_actual').eq('empresa_id', empresaId).gt('saldo_actual', 0),
      supabase.from('productos').select('id, nombre, stock_actual, stock_minimo, unidad_medida').eq('empresa_id', empresaId).eq('activo', true),
      // Comprobantes del mes (accrual basis para DSO y ticket promedio)
      supabase.from('comprobantes').select('id, total').eq('empresa_id', empresaId).gte('fecha', mesStart).lte('fecha', todayEnd),
      // Órdenes de compra activas (pendientes de recibir). El Dashboard es visible a
      // cualquier rol, pero `ordenes_compra` está gateada a has_module_permission('compras')
      // (mig.134) — un staff sin ese permiso vería este KPI en 0 silenciosamente. RPC
      // SECURITY DEFINER scoped a un conteo (mig.185), sin exponer datos de la OC.
      supabase.rpc('contar_ordenes_compra_activas'),
    ]);

    const sum = (rows: { data: { monto: number }[] | null }) =>
      (rows.data ?? []).reduce((s, r) => s + Number(r.monto), 0);

    const ventasHoyTotal   = sum(ventasHoy);
    const ventasAyerTotal  = sum(ventasAyer);
    const ventasMesTotal   = sum(ventasMes);
    const gastosMesTotal   = sum(gastosMes);
    const deudaClientesTotal = (deudaTotal.data ?? []).reduce(
      (s: number, c: { saldo_actual: number }) => s + Number(c.saldo_actual), 0
    );

    const todosProductos = (stockRaw.data ?? []) as Pick<Producto, 'id' | 'nombre' | 'stock_actual' | 'stock_minimo' | 'unidad_medida'>[];
    const productosStockBajo = todosProductos.filter((p) => (p.stock_actual ?? 0) <= (p.stock_minimo ?? 5));

    const variacionVentas =
      ventasAyerTotal > 0
        ? ((ventasHoyTotal - ventasAyerTotal) / ventasAyerTotal) * 100
        : ventasHoyTotal > 0 ? 100 : 0;

    const margenBruto =
      ventasMesTotal > 0 ? ((ventasMesTotal - gastosMesTotal) / ventasMesTotal) * 100 : 0;

    // Salud financiera
    const facturasMesCount = comprobantesRes.data?.length ?? 0;
    const facturasMesTotal = (comprobantesRes.data ?? []).reduce(
      (s: number, c: { total: number }) => s + Number(c.total), 0
    );
    const ocPendientes = ocRes.data ?? 0; // scalar (RPC devuelve un conteo, no filas)
    const ticketPromedio = facturasMesCount > 0 ? facturasMesTotal / facturasMesCount : 0;

    // DSO = (deuda cobrar / facturación del mes) × 30  — base accrual
    const dso = facturasMesTotal > 0
      ? Math.round((deudaClientesTotal / facturasMesTotal) * 30)
      : null;

    return {
      ventasHoy: ventasHoyTotal,
      ventasAyer: ventasAyerTotal,
      variacionVentas,
      ventasMes: ventasMesTotal,
      gastosMes: gastosMesTotal,
      margenBruto,
      deudaClientes: deudaClientesTotal,
      productosStockBajo,
      dso,
      facturasMesCount,
      facturasMesTotal,
      ocPendientes,
      ticketPromedio,
    };
  },

  async getVentasPorDia(empresaId: string, dias = 7): Promise<VentasPorDia[]> {
    const now = getNowAR();
    const desde = new Date(now.getTime() - dias * 86400000);

    const { data, error } = await supabase
      .from('movimientos_caja')
      .select('fecha, monto')
      .eq('empresa_id', empresaId)
      .eq('tipo', 'ingreso')
      .eq('categoria', 'Venta')
      .gte('fecha', desde.toISOString())
      .order('fecha');

    if (error) throw new Error(error.message);

    const byDay: Record<string, number> = {};
    for (let i = 0; i < dias; i++) {
      const d = new Date(now.getTime() - (dias - 1 - i) * 86400000);
      byDay[d.toISOString().split('T')[0]] = 0;
    }
    for (const m of data ?? []) {
      const key = (m.fecha as string).split('T')[0];
      if (key in byDay) byDay[key] += Number(m.monto);
    }

    return Object.entries(byDay).map(([fecha, total]) => ({
      fecha: new Date(fecha + 'T12:00:00').toLocaleDateString('es-AR', {
        weekday: 'short',
        day: 'numeric',
      }),
      total,
    }));
  },

  async getFlujoCajaMensual(empresaId: string, meses = 6): Promise<FlujoCajaMensual[]> {
    const now = getNowAR();
    const result: FlujoCajaMensual[] = [];

    for (let i = meses - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const start = d.toISOString();
      const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59)).toISOString();
      const label = d.toLocaleDateString('es-AR', { month: 'short', year: '2-digit' });

      const { data } = await supabase
        .from('movimientos_caja')
        .select('tipo, monto, categoria')
        .eq('empresa_id', empresaId)
        .gte('fecha', start)
        .lte('fecha', end);

      type Row = { tipo: string; monto: number; categoria: string };
      const ingresos = (data ?? []).filter((m: Row) => m.tipo === 'ingreso').reduce((s: number, m: Row) => s + Number(m.monto), 0);
      const egresos = (data ?? []).filter((m: Row) => m.tipo === 'egreso' && m.categoria !== 'Apertura').reduce((s: number, m: Row) => s + Number(m.monto), 0);
      result.push({ label, ingresos, egresos, balance: ingresos - egresos });
    }

    return result;
  },

  async getTopClientes(empresaId: string): Promise<TopCliente[]> {
    const now = getNowAR();
    const mesStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const mesEnd   = getEndOfDayAR(now);

    const { data } = await supabase
      .from('comprobantes')
      .select('cliente_nombre, total')
      .eq('empresa_id', empresaId)
      .not('cliente_nombre', 'is', null)
      .gte('fecha', mesStart)
      .lte('fecha', mesEnd);

    const byCliente: Record<string, { total: number; count: number }> = {};
    for (const c of data ?? []) {
      if (!c.cliente_nombre) continue;
      if (!byCliente[c.cliente_nombre]) byCliente[c.cliente_nombre] = { total: 0, count: 0 };
      byCliente[c.cliente_nombre].total += Number(c.total);
      byCliente[c.cliente_nombre].count += 1;
    }

    return Object.entries(byCliente)
      .map(([nombre, { total, count }]) => ({ nombre, total, count }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  },

  async getAlertasCC(empresaId: string) {
    const now = getNowAR();
    const hace30 = new Date(now.getTime() - 30 * 86400000).toISOString();
    const hace60 = new Date(now.getTime() - 60 * 86400000).toISOString();
    const hace90 = new Date(now.getTime() - 90 * 86400000).toISOString();

    const { data: conDeuda } = await supabase
      .from('clientes')
      .select('id, nombre, saldo_actual')
      .eq('empresa_id', empresaId)
      .gt('saldo_actual', 0)
      .eq('activo', true)
      .order('saldo_actual', { ascending: false });

    if (!conDeuda?.length) {
      return { total: 0, montoTotal: 0, vencidos30: 0, vencidos60: 0, vencidos90: 0, lista: [] };
    }

    const clienteIds = conDeuda.map((c: { id: string }) => c.id);

    const { data: movs } = await supabase
      .from('cuenta_corriente_movimientos')
      .select('cliente_id, fecha')
      .eq('empresa_id', empresaId)
      .eq('tipo', 'DEBE')
      .in('cliente_id', clienteIds)
      .order('fecha', { ascending: true });

    const oldestByClient: Record<string, string> = {};
    for (const m of (movs ?? []) as { cliente_id: string; fecha: string }[]) {
      if (!oldestByClient[m.cliente_id]) oldestByClient[m.cliente_id] = m.fecha;
    }

    const clientesVencidos30 = new Set<string>();
    const clientesVencidos60 = new Set<string>();
    const clientesVencidos90 = new Set<string>();

    for (const [clienteId, fecha] of Object.entries(oldestByClient)) {
      if (fecha <= hace90) { clientesVencidos90.add(clienteId); clientesVencidos60.add(clienteId); clientesVencidos30.add(clienteId); }
      else if (fecha <= hace60) { clientesVencidos60.add(clienteId); clientesVencidos30.add(clienteId); }
      else if (fecha <= hace30) { clientesVencidos30.add(clienteId); }
    }

    const montoVencido30 = (conDeuda as { id: string; saldo_actual: number }[])
      .filter((c) => clientesVencidos30.has(c.id))
      .reduce((s, c) => s + Number(c.saldo_actual), 0);

    const lista = (conDeuda as { id: string; nombre: string; saldo_actual: number }[])
      .filter((c) => clientesVencidos30.has(c.id))
      .map((c) => ({
        id: c.id,
        nombre: c.nombre,
        saldo: Number(c.saldo_actual),
        diasVencido: Math.floor((now.getTime() - new Date(oldestByClient[c.id] || now).getTime()) / 86400000),
        urgente: clientesVencidos60.has(c.id),
      }))
      .slice(0, 5);

    return {
      total: clientesVencidos30.size,
      montoTotal: montoVencido30,
      vencidos30: clientesVencidos30.size,
      vencidos60: clientesVencidos60.size,
      vencidos90: clientesVencidos90.size,
      lista,
    };
  },

  async getCotizacionesStats(empresaId: string) {
    const now = getNowAR();
    const mesStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

    // El Dashboard es visible a cualquier rol, pero `cotizaciones` está gateada a
    // has_module_permission('ventas') (mig.134) — un staff sin ese permiso vería este widget
    // vacío silenciosamente. RPC SECURITY DEFINER (mig.185, mismo nivel de sensibilidad que
    // `comprobantes`, ya de lectura tenant-only sin gate); el filtro por mes se hace acá porque
    // la RPC no soporta encadenar .gte() como una tabla real.
    const { data, error } = await supabase.rpc('listar_cotizaciones_min');

    if (error) throw new Error(error.message);

    type CotRow = { id: string; estado: string; total: number; numero: string; cliente_nombre: string | null; created_at: string };
    const todas = ((data ?? []) as CotRow[]).filter(c => c.created_at >= mesStart);
    const convertidas = todas.filter((c: CotRow) => c.estado === 'convertida');
    const aprobadas   = todas.filter((c: CotRow) => c.estado === 'aprobada');
    const montoTotal  = todas.reduce((s: number, c: CotRow) => s + Number(c.total), 0);
    const montoConvertido = convertidas.reduce((s: number, c: CotRow) => s + Number(c.total), 0);
    const tasaConversion  = todas.length > 0 ? (convertidas.length / todas.length) * 100 : 0;

    return {
      totalMes:       todas.length,
      montoMes:       montoTotal,
      convertidas:    convertidas.length,
      montoConvertido,
      aprobadas:      aprobadas.length,
      tasaConversion,
      pendientes:     aprobadas.slice(0, 5).map((c: CotRow) => ({ id: c.id, numero: c.numero, cliente: c.cliente_nombre, total: c.total })),
    };
  },
};

export const DASHBOARD_KEYS = {
  kpis:         (empresaId: string) => ['dashboard', 'kpis', empresaId] as const,
  ventasPorDia: (empresaId: string, dias: number) => ['dashboard', 'ventasPorDia', empresaId, dias] as const,
  flujoCaja:    (empresaId: string, meses: number) => ['dashboard', 'flujoCaja', empresaId, meses] as const,
  cotizaciones: (empresaId: string) => ['dashboard', 'cotizaciones', empresaId] as const,
  alertasCC:    (empresaId: string) => ['dashboard', 'alertasCC', empresaId] as const,
  topClientes:  (empresaId: string) => ['dashboard', 'topClientes', empresaId] as const,
};
