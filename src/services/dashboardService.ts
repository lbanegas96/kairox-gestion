import { supabase } from '@/lib/customSupabaseClient';
import { getStartOfDayAR, getEndOfDayAR, getNowAR } from '@/lib/dateUtils';
import type { DashboardKPIs, VentasPorDia, FlujoCajaMensual, Producto } from '@/types';

export const dashboardService = {
  async getKPIs(empresaId: string): Promise<DashboardKPIs> {
    const now = getNowAR();
    const todayStart = getStartOfDayAR(now);
    const todayEnd = getEndOfDayAR(now);
    const ayer = new Date(now.getTime() - 86400000);
    const mesStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

    const [ventasHoy, ventasAyer, ventasMes, gastosMes, deudaTotal, stockRaw] = await Promise.all([
      supabase.from('movimientos_caja').select('monto').eq('user_id', empresaId).eq('tipo', 'ingreso').eq('categoria', 'Venta').gte('fecha', todayStart).lte('fecha', todayEnd),
      supabase.from('movimientos_caja').select('monto').eq('user_id', empresaId).eq('tipo', 'ingreso').eq('categoria', 'Venta').gte('fecha', getStartOfDayAR(ayer)).lte('fecha', getEndOfDayAR(ayer)),
      supabase.from('movimientos_caja').select('monto').eq('user_id', empresaId).eq('tipo', 'ingreso').gte('fecha', mesStart).lte('fecha', todayEnd),
      supabase.from('movimientos_caja').select('monto').eq('user_id', empresaId).eq('tipo', 'egreso').gte('fecha', mesStart).lte('fecha', todayEnd),
      supabase.from('clientes').select('saldo_actual').eq('user_id', empresaId).gt('saldo_actual', 0),
      supabase.from('productos').select('id, nombre, stock_actual, stock_minimo, unidad_medida').eq('user_id', empresaId).eq('activo', true),
    ]);

    const sum = (rows: { data: { monto: number }[] | null }) =>
      (rows.data ?? []).reduce((s, r) => s + Number(r.monto), 0);

    const ventasHoyTotal = sum(ventasHoy);
    const ventasAyerTotal = sum(ventasAyer);
    const ventasMesTotal = sum(ventasMes);
    const gastosMesTotal = sum(gastosMes);
    const deudaClientesTotal = (deudaTotal.data ?? []).reduce((s: number, c: { saldo_actual: number }) => s + Number(c.saldo_actual), 0);

    const todosProductos = (stockRaw.data ?? []) as Pick<Producto, 'id' | 'nombre' | 'stock_actual' | 'stock_minimo' | 'unidad_medida'>[];
    const productosStockBajo = todosProductos.filter((p) => (p.stock_actual ?? 0) <= (p.stock_minimo ?? 5));

    const variacionVentas =
      ventasAyerTotal > 0
        ? ((ventasHoyTotal - ventasAyerTotal) / ventasAyerTotal) * 100
        : ventasHoyTotal > 0
        ? 100
        : 0;

    const margenBruto =
      ventasMesTotal > 0 ? ((ventasMesTotal - gastosMesTotal) / ventasMesTotal) * 100 : 0;

    return {
      ventasHoy: ventasHoyTotal,
      ventasAyer: ventasAyerTotal,
      variacionVentas,
      ventasMes: ventasMesTotal,
      gastosMes: gastosMesTotal,
      margenBruto,
      deudaClientes: deudaClientesTotal,
      productosStockBajo,
    };
  },

  async getVentasPorDia(empresaId: string, dias = 7): Promise<VentasPorDia[]> {
    const now = getNowAR();
    const desde = new Date(now.getTime() - dias * 86400000);

    const { data, error } = await supabase
      .from('movimientos_caja')
      .select('fecha, monto')
      .eq('user_id', empresaId)
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
        .select('tipo, monto')
        .eq('user_id', empresaId)
        .gte('fecha', start)
        .lte('fecha', end);

      type Row = { tipo: string; monto: number };
      const ingresos = (data ?? []).filter((m: Row) => m.tipo === 'ingreso').reduce((s: number, m: Row) => s + Number(m.monto), 0);
      const egresos = (data ?? []).filter((m: Row) => m.tipo === 'egreso').reduce((s: number, m: Row) => s + Number(m.monto), 0);
      result.push({ label, ingresos, egresos, balance: ingresos - egresos });
    }

    return result;
  },
};

export const DASHBOARD_KEYS = {
  kpis: (empresaId: string) => ['dashboard', 'kpis', empresaId] as const,
  ventasPorDia: (empresaId: string, dias: number) => ['dashboard', 'ventasPorDia', empresaId, dias] as const,
  flujoCaja: (empresaId: string, meses: number) => ['dashboard', 'flujoCaja', empresaId, meses] as const,
};
