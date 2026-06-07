import { supabase } from '@/lib/customSupabaseClient';
import { getStartOfDayAR, getEndOfDayAR, getNowAR } from '@/lib/dateUtils';

// ─────────────────────────────────────────────────────────────
// Launchpad: todos los KPIs de los tiles en una sola llamada
// ─────────────────────────────────────────────────────────────
export interface LaunchpadKPIs {
  ventas: { hoy: number; pedidosPendientes: number };
  compras: { ocPendientes: number; deudaProveedores: number };
  finanzas: { saldoBancario: number; cxcTotal: number };
  inventario: { totalProductos: number; bajominimo: number };
}

export async function getLaunchpadKPIs(empresaId: string): Promise<LaunchpadKPIs> {
  const now = getNowAR();
  const todayStart = getStartOfDayAR(now);
  const todayEnd = getEndOfDayAR(now);

  const [ventasHoyRes, pedidosRes, ocRes, saldoProvRes, bancosRes, ccClientesRes, productosRes] = await Promise.all([
    // Ventas hoy (movimientos_caja ingreso venta — usa user_id=empresaId por schema legacy)
    supabase.from('movimientos_caja')
      .select('monto')
      .eq('user_id', empresaId)
      .eq('tipo', 'ingreso')
      .eq('categoria', 'Venta')
      .gte('fecha', todayStart)
      .lte('fecha', todayEnd),

    // Pedidos pendientes (no facturados, no cancelados)
    supabase.from('pedidos')
      .select('id', { count: 'exact', head: true })
      .eq('empresa_id', empresaId)
      .not('estado', 'in', '("facturado","cancelado")'),

    // OC pendientes de resolver
    supabase.from('ordenes_compra')
      .select('id', { count: 'exact', head: true })
      .eq('empresa_id', empresaId)
      .in('estado', ['borrador', 'pendiente', 'enviada']),

    // Deuda total a proveedores
    supabase.from('v_saldo_proveedores')
      .select('saldo_deuda')
      .eq('empresa_id', empresaId),

    // Saldo bancario total
    supabase.from('cuentas_bancarias')
      .select('saldo_actual')
      .eq('empresa_id', empresaId)
      .eq('activo', true),

    // CxC: clientes con saldo positivo (usa user_id por schema legacy)
    supabase.from('clientes')
      .select('saldo_actual')
      .eq('user_id', empresaId)
      .gt('saldo_actual', 0),

    // Inventario: productos activos con info de stock (usa user_id por schema legacy)
    supabase.from('productos')
      .select('stock_actual, stock_minimo')
      .eq('user_id', empresaId)
      .eq('activo', true),
  ]);

  const sumMonto = (res: { data: { monto: number }[] | null }) =>
    (res.data ?? []).reduce((s, r) => s + Number(r.monto), 0);

  const productos = productosRes.data ?? [];

  return {
    ventas: {
      hoy: sumMonto(ventasHoyRes),
      pedidosPendientes: pedidosRes.count ?? 0,
    },
    compras: {
      ocPendientes: ocRes.count ?? 0,
      deudaProveedores: (saldoProvRes.data ?? []).reduce((s, r) => s + Number(r.saldo_deuda ?? 0), 0),
    },
    finanzas: {
      saldoBancario: (bancosRes.data ?? []).reduce((s, r) => s + Number(r.saldo_actual ?? 0), 0),
      cxcTotal: (ccClientesRes.data ?? []).reduce((s, r) => s + Number(r.saldo_actual ?? 0), 0),
    },
    inventario: {
      totalProductos: productos.length,
      bajominimo: productos.filter(p => Number(p.stock_actual ?? 0) <= Number(p.stock_minimo ?? 5)).length,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Portal Ventas — KPIs extendidos
// ─────────────────────────────────────────────────────────────
export interface VentasPortalKPIs {
  ventasHoy: number;
  ventasMes: number;
  ticketPromedio: number;
  cxcPendiente: number;
  cotizacionesActivas: number;
  pedidosPendientes: number;
}

export async function getVentasPortalKPIs(empresaId: string): Promise<VentasPortalKPIs> {
  const now = getNowAR();
  const todayStart = getStartOfDayAR(now);
  const todayEnd = getEndOfDayAR(now);
  const mesStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

  const [ventasHoyRes, ventasMesRes, cotizacionesRes, pedidosRes, ccRes] = await Promise.all([
    supabase.from('movimientos_caja')
      .select('monto')
      .eq('user_id', empresaId)
      .eq('tipo', 'ingreso')
      .eq('categoria', 'Venta')
      .gte('fecha', todayStart)
      .lte('fecha', todayEnd),

    supabase.from('movimientos_caja')
      .select('monto')
      .eq('user_id', empresaId)
      .eq('tipo', 'ingreso')
      .eq('categoria', 'Venta')
      .gte('fecha', mesStart)
      .lte('fecha', todayEnd),

    supabase.from('cotizaciones')
      .select('id', { count: 'exact', head: true })
      .eq('empresa_id', empresaId)
      .not('estado', 'in', '("convertida","cancelada","vencida")'),

    supabase.from('pedidos')
      .select('id', { count: 'exact', head: true })
      .eq('empresa_id', empresaId)
      .not('estado', 'in', '("facturado","cancelado")'),

    supabase.from('clientes')
      .select('saldo_actual')
      .eq('user_id', empresaId)
      .gt('saldo_actual', 0),
  ]);

  const sumMonto = (res: { data: { monto: number }[] | null }) =>
    (res.data ?? []).reduce((s, r) => s + Number(r.monto), 0);

  const ventasHoy = sumMonto(ventasHoyRes);
  const ventasMes = sumMonto(ventasMesRes);
  const comprobantesHoy = (ventasHoyRes.data ?? []).length;

  return {
    ventasHoy,
    ventasMes,
    ticketPromedio: comprobantesHoy > 0 ? ventasHoy / comprobantesHoy : 0,
    cxcPendiente: (ccRes.data ?? []).reduce((s, r) => s + Number(r.saldo_actual ?? 0), 0),
    cotizacionesActivas: cotizacionesRes.count ?? 0,
    pedidosPendientes: pedidosRes.count ?? 0,
  };
}

// ─────────────────────────────────────────────────────────────
// Portal Compras — KPIs extendidos
// ─────────────────────────────────────────────────────────────
export interface ComprasPortalKPIs {
  ocPendientes: number;
  ocPendientesMonto: number;
  deudaProveedores: number;
  comprasMes: number;
  proveedoresActivos: number;
}

export async function getComprasPortalKPIs(empresaId: string): Promise<ComprasPortalKPIs> {
  const now = getNowAR();
  const mesStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const todayEnd = getEndOfDayAR(now);

  const [ocRes, saldoProvRes, comprasMesRes, proveedoresRes] = await Promise.all([
    supabase.from('ordenes_compra')
      .select('id, total')
      .eq('empresa_id', empresaId)
      .in('estado', ['borrador', 'pendiente', 'enviada']),

    supabase.from('v_saldo_proveedores')
      .select('saldo_deuda')
      .eq('empresa_id', empresaId),

    supabase.from('movimientos_caja')
      .select('monto')
      .eq('user_id', empresaId)
      .eq('tipo', 'egreso')
      .eq('categoria', 'Compra')
      .gte('fecha', mesStart)
      .lte('fecha', todayEnd),

    supabase.from('proveedores')
      .select('id', { count: 'exact', head: true })
      .eq('empresa_id', empresaId)
      .eq('activo', true),
  ]);

  const oc = ocRes.data ?? [];

  return {
    ocPendientes: oc.length,
    ocPendientesMonto: oc.reduce((s, r) => s + Number(r.total ?? 0), 0),
    deudaProveedores: (saldoProvRes.data ?? []).reduce((s, r) => s + Number(r.saldo_deuda ?? 0), 0),
    comprasMes: (comprasMesRes.data ?? []).reduce((s, r) => s + Number(r.monto ?? 0), 0),
    proveedoresActivos: proveedoresRes.count ?? 0,
  };
}

// ─────────────────────────────────────────────────────────────
// Portal Finanzas — KPIs extendidos
// ─────────────────────────────────────────────────────────────
export interface FinanzasPortalKPIs {
  saldoBancarioTotal: number;
  cxcTotal: number;
  cxpTotal: number;
  posicionNeta: number;
  cajaAbierta: boolean;
  saldoCajaApertura: number;
  cuentasBancarias: number;
}

export async function getFinanzasPortalKPIs(empresaId: string): Promise<FinanzasPortalKPIs> {
  const [bancosRes, ccClientesRes, saldoProvRes, cajaRes] = await Promise.all([
    supabase.from('cuentas_bancarias')
      .select('saldo_actual')
      .eq('empresa_id', empresaId)
      .eq('activo', true),

    supabase.from('clientes')
      .select('saldo_actual')
      .eq('user_id', empresaId)
      .gt('saldo_actual', 0),

    supabase.from('v_saldo_proveedores')
      .select('saldo_deuda')
      .eq('empresa_id', empresaId),

    supabase.from('caja_sesiones')
      .select('estado, saldo_apertura')
      .eq('empresa_id', empresaId)
      .eq('estado', 'abierta')
      .order('fecha_apertura', { ascending: false })
      .limit(1),
  ]);

  const saldoBancarioTotal = (bancosRes.data ?? []).reduce((s, r) => s + Number(r.saldo_actual ?? 0), 0);
  const cxcTotal = (ccClientesRes.data ?? []).reduce((s, r) => s + Number(r.saldo_actual ?? 0), 0);
  const cxpTotal = (saldoProvRes.data ?? []).reduce((s, r) => s + Number(r.saldo_deuda ?? 0), 0);
  const cajaSession = (cajaRes.data ?? [])[0];

  return {
    saldoBancarioTotal,
    cxcTotal,
    cxpTotal,
    posicionNeta: cxcTotal - cxpTotal,
    cajaAbierta: !!cajaSession,
    saldoCajaApertura: cajaSession ? Number(cajaSession.saldo_apertura ?? 0) : 0,
    cuentasBancarias: bancosRes.data?.length ?? 0,
  };
}

// ─────────────────────────────────────────────────────────────
// Portal Inventario — KPIs extendidos
// ─────────────────────────────────────────────────────────────
export interface InventarioPortalKPIs {
  totalProductos: number;
  bajominimo: number;
  sinStock: number;
  valorStockTotal: number;
  categorias: number;
}

export async function getInventarioPortalKPIs(empresaId: string): Promise<InventarioPortalKPIs> {
  const { data, error } = await supabase
    .from('productos')
    .select('stock_actual, stock_minimo, costo_compra, categoria')
    .eq('user_id', empresaId)
    .eq('activo', true);

  if (error) throw error;

  const productos = data ?? [];
  const categorias = new Set(productos.map(p => p.categoria).filter(Boolean));

  return {
    totalProductos: productos.length,
    bajominimo: productos.filter(p => Number(p.stock_actual ?? 0) <= Number(p.stock_minimo ?? 5) && Number(p.stock_actual ?? 0) > 0).length,
    sinStock: productos.filter(p => Number(p.stock_actual ?? 0) === 0).length,
    valorStockTotal: productos.reduce((s, p) => s + Number(p.stock_actual ?? 0) * Number(p.costo_compra ?? 0), 0),
    categorias: categorias.size,
  };
}

export const PORTAL_KEYS = {
  launchpad: (id: string) => ['portal', 'launchpad', id] as const,
  ventas: (id: string) => ['portal', 'ventas', id] as const,
  compras: (id: string) => ['portal', 'compras', id] as const,
  finanzas: (id: string) => ['portal', 'finanzas', id] as const,
  inventario: (id: string) => ['portal', 'inventario', id] as const,
};
