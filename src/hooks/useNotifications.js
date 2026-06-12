import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { getNowAR, getTodayAR } from '@/lib/dateUtils';

// Notificaciones tienen que sentirse "vivas" — refrescamos cada 30s
// y siempre que el usuario vuelve al tab del navegador.
const STALE_TIME = 1000 * 30; // 30 segundos
const REFETCH_OPTS = {
  staleTime: STALE_TIME,
  refetchOnWindowFocus: true,
  refetchInterval: 1000 * 60, // refetch en background cada 60s
};

/**
 * Hook de notificaciones inteligentes.
 * Devuelve alertas agrupadas por tipo:
 *   - stock_bajo:    productos con stock ≤ stock_minimo
 *   - deuda_vencida: clientes con saldo > 0 sin movimiento en +30 días
 *   - oc_pendiente:  órdenes de compra enviadas sin recibir
 */
export function useNotifications() {
  const { user } = useAuth();
  const empresaId = user?.empresa_id;

  // ── Stock bajo ─────────────────────────────────────────────────────────────
  const { data: stockBajo = [] } = useQuery({
    queryKey: ['notif', 'stock_bajo', empresaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('productos')
        .select('id, nombre, stock_actual, stock_minimo, unidad_medida')
        .eq('empresa_id', empresaId)
        .eq('activo', true);
      if (error) return [];
      return (data ?? []).filter(p => (p.stock_actual ?? 0) <= (p.stock_minimo ?? 5));
    },
    enabled: !!empresaId,
    ...REFETCH_OPTS,
  });

  // ── Deuda vencida (+30 días sin movimiento) ────────────────────────────────
  const { data: deudaVencida = [] } = useQuery({
    queryKey: ['notif', 'deuda_vencida', empresaId],
    queryFn: async () => {
      const hace30dias = new Date(getNowAR().getTime() - 30 * 86400000).toISOString();
      const { data: clientes, error } = await supabase
        .from('clientes')
        .select('id, nombre, saldo_actual')
        .eq('empresa_id', empresaId)
        .neq('activo', false)
        .gt('saldo_actual', 0);
      if (error) return [];

      // Filtrar los que no tienen movimiento reciente
      const result = [];
      for (const c of clientes ?? []) {
        const { count } = await supabase
          .from('cuenta_corriente_movimientos')
          .select('id', { count: 'exact', head: true })
          .eq('cliente_id', c.id)
          .gte('created_at', hace30dias);
        if ((count ?? 0) === 0) result.push(c);
      }
      return result;
    },
    enabled: !!empresaId,
    ...REFETCH_OPTS,
  });

  // ── Órdenes de compra pendientes ───────────────────────────────────────────
  const { data: ocPendientes = [] } = useQuery({
    queryKey: ['notif', 'oc_pendientes', empresaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ordenes_compra')
        .select('id, numero, proveedor_nombre, fecha')
        .eq('empresa_id', empresaId)
        .in('estado', ['enviada', 'recibida_parcial'])
        .order('fecha', { ascending: true });
      if (error) return [];
      return data ?? [];
    },
    enabled: !!empresaId,
    ...REFETCH_OPTS,
  });

  // ── Caja sin cerrar hace más de 24h ────────────────────────────────────────
  const { data: cajaSinCerrar = [] } = useQuery({
    queryKey: ['notif', 'caja_sin_cerrar', empresaId],
    queryFn: async () => {
      const hace24h = new Date(getNowAR().getTime() - 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('caja_sesiones')
        .select('id, caja_id, apertura_fecha, cajas(nombre)')
        .eq('empresa_id', empresaId)
        .is('cierre_fecha', null)
        .lt('apertura_fecha', hace24h);
      if (error) return [];
      return data ?? [];
    },
    enabled: !!empresaId,
    ...REFETCH_OPTS,
  });

  // ── Cheques por vencer (próximos 7 días) ──────────────────────────────────
  const { data: chequesProximos = [] } = useQuery({
    queryKey: ['notif', 'cheques_proximos', empresaId],
    queryFn: async () => {
      const hoy   = getTodayAR();
      const in7d  = new Date(new Date(hoy + 'T00:00:00Z').getTime() + 7 * 86400000)
                      .toISOString().split('T')[0];
      const { data, error } = await supabase
        .from('cheques')
        .select('id, numero, monto, fecha_vencimiento, tipo')
        .eq('empresa_id', empresaId)
        .not('estado', 'in', '(cobrado,rechazado)')
        .gte('fecha_vencimiento', hoy)
        .lte('fecha_vencimiento', in7d);
      if (error) return [];
      return data ?? [];
    },
    enabled: !!empresaId,
    ...REFETCH_OPTS,
  });

  // ── Retenciones practicadas del mes (recordatorio de depósito) ─────────────
  const { data: retencionesPracticadas = 0 } = useQuery({
    queryKey: ['notif', 'retenciones_practicadas', empresaId],
    queryFn: async () => {
      const primerDiaMes = getTodayAR().slice(0, 7) + '-01';
      const { data, error } = await supabase
        .from('retenciones')
        .select('monto')
        .eq('empresa_id', empresaId)
        .eq('tipo', 'practicada')
        .gte('fecha', primerDiaMes)
        .lte('fecha', getTodayAR());
      if (error) return 0;
      return (data ?? []).reduce((s, r) => s + Number(r.monto), 0);
    },
    enabled: !!empresaId,
    ...REFETCH_OPTS,
  });

  // ── CAEs pendientes / error ────────────────────────────────────────────────
  const { data: caesPendientes = [] } = useQuery({
    queryKey: ['notif', 'caes_pendientes', empresaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('comprobantes')
        .select('id, numero_venta')
        .eq('empresa_id', empresaId)
        .in('cae_estado', ['pendiente', 'error'])
        .limit(5);
      if (error) return [];
      return data ?? [];
    },
    enabled: !!empresaId,
    ...REFETCH_OPTS,
  });

  // ── Armar lista unificada ──────────────────────────────────────────────────
  const items = [
    ...(chequesProximos.length > 0 ? [{
      id: 'cheques-proximos',
      tipo: 'cheques_proximos',
      titulo: `${chequesProximos.length} cheque${chequesProximos.length > 1 ? 's' : ''} vence${chequesProximos.length > 1 ? 'n' : ''} esta semana`,
      detalle: `Total: $${chequesProximos.reduce((s, c) => s + Number(c.monto), 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`,
      nivel: 'advertencia',
      seccion: 'cheques',
      raw: chequesProximos,
    }] : []),
    ...(caesPendientes.length > 0 ? [{
      id: 'caes-pendientes',
      tipo: 'caes_pendientes',
      titulo: `${caesPendientes.length} factura${caesPendientes.length > 1 ? 's' : ''} sin CAE`,
      detalle: 'AFIP no pudo emitir el CAE. Hacé clic para reintentar.',
      nivel: 'advertencia',
      seccion: 'ventas',
      action: 'reintentar-cae',
      raw: caesPendientes,
    }] : []),
    ...(retencionesPracticadas > 0 ? [{
      id: 'retenciones-practicadas',
      tipo: 'retenciones_practicadas',
      titulo: `Retenciones practicadas este mes: $${retencionesPracticadas.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`,
      detalle: 'Recordá depositarlas según el calendario de vencimientos de tu jurisdicción.',
      nivel: 'info',
      seccion: 'impuestos',
      raw: retencionesPracticadas,
    }] : []),
    ...stockBajo.map(p => ({
      id: `stock-${p.id}`,
      tipo: 'stock_bajo',
      titulo: p.nombre,
      detalle: `Stock: ${p.stock_actual} ${p.unidad_medida ?? ''} (mín. ${p.stock_minimo})`,
      nivel: p.stock_actual === 0 ? 'critico' : 'advertencia',
      seccion: 'productos',
      raw: p,
    })),
    ...deudaVencida.map(c => ({
      id: `deuda-${c.id}`,
      tipo: 'deuda_vencida',
      titulo: c.nombre,
      detalle: `Deuda: $${Number(c.saldo_actual).toLocaleString('es-AR', { minimumFractionDigits: 2 })} — sin movimiento +30 días`,
      nivel: 'advertencia',
      seccion: 'cuentacorriente',
      raw: c,
    })),
    ...ocPendientes.map(oc => ({
      id: `oc-${oc.id}`,
      tipo: 'oc_pendiente',
      titulo: `OC ${oc.numero}`,
      detalle: `${oc.proveedor_nombre ?? 'Proveedor'} — pendiente de recepción`,
      nivel: 'info',
      seccion: 'ordenes_compra',
      raw: oc,
    })),
    ...cajaSinCerrar.map(s => ({
      id: `caja-${s.id}`,
      tipo: 'caja_sin_cerrar',
      titulo: s.cajas?.nombre ?? 'Caja sin cerrar',
      detalle: `Abierta desde ${new Date(s.apertura_fecha).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} — más de 24h sin cierre`,
      nivel: 'advertencia',
      seccion: 'caja',
      raw: s,
    })),
  ];

  return {
    items,
    count: items.length,
    stockBajo,
    deudaVencida,
    ocPendientes,
    cajaSinCerrar,
    caesPendientes,
    chequesProximos,
    retencionesPracticadas,
    hasNotifications: items.length > 0,
  };
}
