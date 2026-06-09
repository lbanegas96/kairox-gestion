import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';

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
      const hace30dias = new Date(Date.now() - 30 * 86400000).toISOString();
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
      const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
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

  // ── Armar lista unificada ──────────────────────────────────────────────────
  const items = [
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
    hasNotifications: items.length > 0,
  };
}
