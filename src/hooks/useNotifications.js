import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';

const STALE_TIME = 1000 * 60 * 5; // 5 min

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
        .eq('user_id', empresaId)
        .eq('activo', true);
      if (error) return [];
      return (data ?? []).filter(p => (p.stock_actual ?? 0) <= (p.stock_minimo ?? 5));
    },
    enabled: !!empresaId,
    staleTime: STALE_TIME,
  });

  // ── Deuda vencida (+30 días sin movimiento) ────────────────────────────────
  const { data: deudaVencida = [] } = useQuery({
    queryKey: ['notif', 'deuda_vencida', empresaId],
    queryFn: async () => {
      const hace30dias = new Date(Date.now() - 30 * 86400000).toISOString();
      const { data: clientes, error } = await supabase
        .from('clientes')
        .select('id, nombre, saldo_actual')
        .eq('user_id', empresaId)
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
    staleTime: STALE_TIME,
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
    staleTime: STALE_TIME,
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
  ];

  return {
    items,
    count: items.length,
    stockBajo,
    deudaVencida,
    ocPendientes,
    hasNotifications: items.length > 0,
  };
}
