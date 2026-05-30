import { supabase } from '@/lib/customSupabaseClient';
import { getStartOfDayAR, getEndOfDayAR, getNowAR } from '@/lib/dateUtils';

export const dashboardService = {
  async getKPIs(empresaId) {
    const now = getNowAR();
    const todayStart = getStartOfDayAR(now);
    const todayEnd = getEndOfDayAR(now);

    const ayer = new Date(now.getTime() - 86400000);
    const ayerStart = getStartOfDayAR(ayer);
    const ayerEnd = getEndOfDayAR(ayer);

    const mesStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

    const [ventasHoy, ventasAyer, ventasMes, gastosMes, deudaTotal, stockBajo] = await Promise.all([
      supabase.from('movimientos_caja').select('monto').eq('user_id', empresaId).eq('tipo', 'ingreso').eq('categoria', 'Venta').gte('fecha', todayStart).lte('fecha', todayEnd),
      supabase.from('movimientos_caja').select('monto').eq('user_id', empresaId).eq('tipo', 'ingreso').eq('categoria', 'Venta').gte('fecha', ayerStart).lte('fecha', ayerEnd),
      supabase.from('movimientos_caja').select('monto').eq('user_id', empresaId).eq('tipo', 'ingreso').gte('fecha', mesStart).lte('fecha', todayEnd),
      supabase.from('movimientos_caja').select('monto').eq('user_id', empresaId).eq('tipo', 'egreso').gte('fecha', mesStart).lte('fecha', todayEnd),
      supabase.from('clientes').select('saldo_actual').eq('user_id', empresaId).gt('saldo_actual', 0),
      supabase.from('productos').select('id, nombre, stock_actual, stock_minimo').eq('user_id', empresaId).eq('activo', true),
    ]);

    const sum = (rows) => (rows.data ?? []).reduce((s, r) => s + Number(r.monto), 0);
    const ventasHoyTotal = sum(ventasHoy);
    const ventasAyerTotal = sum(ventasAyer);
    const ventasMesTotal = sum(ventasMes);
    const gastosMesTotal = sum(gastosMes);
    const deudaClientesTotal = (deudaTotal.data ?? []).reduce((s, c) => s + Number(c.saldo_actual), 0);
    const productosStockBajo = (stockBajo.data ?? []).filter(p => (p.stock_actual ?? 0) <= (p.stock_minimo ?? 5));

    const variacionVentas = ventasAyerTotal > 0
      ? ((ventasHoyTotal - ventasAyerTotal) / ventasAyerTotal) * 100
      : ventasHoyTotal > 0 ? 100 : 0;

    const margenBruto = ventasMesTotal > 0
      ? ((ventasMesTotal - gastosMesTotal) / ventasMesTotal) * 100
      : 0;

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

  async getVentasPorDia(empresaId, dias = 7) {
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

    if (error) throw error;

    const byDay = {};
    for (let i = 0; i < dias; i++) {
      const d = new Date(now.getTime() - (dias - 1 - i) * 86400000);
      const key = d.toISOString().split('T')[0];
      byDay[key] = 0;
    }
    for (const m of data ?? []) {
      const key = m.fecha.split('T')[0];
      if (key in byDay) byDay[key] += Number(m.monto);
    }

    return Object.entries(byDay).map(([fecha, total]) => ({
      fecha: new Date(fecha + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric' }),
      total,
    }));
  },

  async getFlujoCajaMensual(empresaId, meses = 6) {
    const now = getNowAR();
    const result = [];

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

      const ingresos = (data ?? []).filter(m => m.tipo === 'ingreso').reduce((s, m) => s + Number(m.monto), 0);
      const egresos = (data ?? []).filter(m => m.tipo === 'egreso').reduce((s, m) => s + Number(m.monto), 0);
      result.push({ label, ingresos, egresos, balance: ingresos - egresos });
    }

    return result;
  },
};

export const DASHBOARD_KEYS = {
  kpis: (empresaId) => ['dashboard', 'kpis', empresaId],
  ventasPorDia: (empresaId, dias) => ['dashboard', 'ventasPorDia', empresaId, dias],
  flujoCaja: (empresaId, meses) => ['dashboard', 'flujoCaja', empresaId, meses],
};
