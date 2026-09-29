import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useUserPermissions } from '@/hooks/useUserPermissions';
import { getNowAR, getTodayAR } from '@/lib/dateUtils';
import {
  useDismissedNotifications,
  dismissNotification,
  pruneDismissed,
} from '@/hooks/useDismissedNotifications';

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
 *   - stock_bajo:    productos con stock ≤ stock_minimo (si "Alerta de stock bajo" está activa)
 *   - deuda_vencida: clientes con saldo > 0 sin movimiento en +N días (N configurable, si el toggle está activo)
 *   - oc_pendiente:  órdenes de compra enviadas sin recibir (sin toggle, siempre activa con permiso de compras)
 *
 * Los 4 tipos configurables desde Configuración → Alertas (stock bajo, vencimiento de
 * CC, caja sin cerrar, cheques por vencer) respetan acá su interruptor de encendido y,
 * donde aplica, su plazo/antelación en días — antes de esta revisión (29/09) esa
 * pantalla guardaba los 7 valores pero ninguno se leía nunca: cambiar cualquier cosa
 * ahí no tenía ningún efecto.
 */
// Defaults idénticos a los que arranca ConfiguracionSection.jsx (Tab Alertas) — si una
// empresa nunca tocó esa pantalla, el comportamiento es el mismo de siempre.
const ALERTA_DEFAULTS = {
  alerta_stock_bajo: true,
  alerta_stock_umbral: 5,
  alerta_vencimiento_cc: true,
  alerta_vencimiento_dias: 30,
  alerta_caja_apertura: true,
  alerta_cheque_vencimiento: true,
  alerta_cheque_dias: 7,
};
const ALERTA_KEYS = Object.keys(ALERTA_DEFAULTS);

export function useNotifications() {
  const { user } = useAuth();
  const { hasPermission } = useUserPermissions();
  const empresaId = user?.empresa_id;

  // ── Configuración de Alertas (Configuración → Alertas) ──────────────────────
  const { data: alertasCfg = ALERTA_DEFAULTS } = useQuery({
    queryKey: ['notif', 'alertas_config', empresaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('configuracion')
        .select('clave, valor')
        .eq('empresa_id', empresaId)
        .in('clave', ALERTA_KEYS);
      if (error || !data?.length) return ALERTA_DEFAULTS;
      const map = Object.fromEntries(data.map((r) => [r.clave, r.valor]));
      const bool = (k) => (map[k] !== undefined ? map[k] === 'true' : ALERTA_DEFAULTS[k]);
      const num  = (k) => Number(map[k] ?? ALERTA_DEFAULTS[k]);
      return {
        alerta_stock_bajo:         bool('alerta_stock_bajo'),
        alerta_stock_umbral:       num('alerta_stock_umbral'),
        alerta_vencimiento_cc:     bool('alerta_vencimiento_cc'),
        alerta_vencimiento_dias:   num('alerta_vencimiento_dias'),
        alerta_caja_apertura:      bool('alerta_caja_apertura'),
        alerta_cheque_vencimiento: bool('alerta_cheque_vencimiento'),
        alerta_cheque_dias:        num('alerta_cheque_dias'),
      };
    },
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });

  // ── Stock mínimo global (config de empresa) ────────────────────────────────
  const { data: stockMinimoGlobal = 5 } = useQuery({
    queryKey: ['notif', 'stock_minimo_global', empresaId],
    queryFn: async () => {
      const { data } = await supabase
        .from('empresas')
        .select('stock_minimo_global')
        .eq('id', empresaId)
        .single();
      return data?.stock_minimo_global ?? 5;
    },
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });

  // ── Stock bajo ─────────────────────────────────────────────────────────────
  const { data: stockBajo = [] } = useQuery({
    queryKey: ['notif', 'stock_bajo', empresaId, stockMinimoGlobal],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('productos')
        .select('id, nombre, stock_actual, stock_minimo, unidad_medida')
        .eq('empresa_id', empresaId)
        .eq('activo', true);
      if (error) return [];
      return (data ?? []).filter(p => (p.stock_actual ?? 0) <= (p.stock_minimo ?? stockMinimoGlobal));
    },
    enabled: !!empresaId,
    ...REFETCH_OPTS,
  });

  // ── Deuda vencida (sin movimiento hace más de N días, configurable) ────────
  const diasVencimientoCC = alertasCfg.alerta_vencimiento_dias;
  const { data: deudaVencida = [] } = useQuery({
    queryKey: ['notif', 'deuda_vencida', empresaId, diasVencimientoCC],
    queryFn: async () => {
      const haceNdias = new Date(getNowAR().getTime() - diasVencimientoCC * 86400000).toISOString();
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
          .gte('created_at', haceNdias);
        if ((count ?? 0) === 0) result.push({ ...c, diasVencimiento: diasVencimientoCC });
      }
      return result;
    },
    enabled: !!empresaId && alertasCfg.alerta_vencimiento_cc,
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
    enabled: !!empresaId && hasPermission('compras'),
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
    enabled: !!empresaId && alertasCfg.alerta_caja_apertura,
    ...REFETCH_OPTS,
  });

  // ── Cheques por vencer (próximos N días, configurable) ─────────────────────
  const diasCheque = alertasCfg.alerta_cheque_dias;
  const { data: chequesProximos = [] } = useQuery({
    queryKey: ['notif', 'cheques_proximos', empresaId, diasCheque],
    queryFn: async () => {
      const hoy   = getTodayAR();
      const inNd  = new Date(new Date(hoy + 'T00:00:00Z').getTime() + diasCheque * 86400000)
                      .toISOString().split('T')[0];
      const { data, error } = await supabase
        .from('cheques')
        .select('id, numero, monto, fecha_vencimiento, tipo')
        .eq('empresa_id', empresaId)
        .not('estado', 'in', '(cobrado,rechazado)')
        .gte('fecha_vencimiento', hoy)
        .lte('fecha_vencimiento', inNd);
      if (error) return [];
      return data ?? [];
    },
    enabled: !!empresaId && hasPermission('cheques') && alertasCfg.alerta_cheque_vencimiento,
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
    enabled: !!empresaId && hasPermission('configuracion'),
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

  // ── Facturas con error definitivo (requieren intervención humana) ─────────
  // Cubre error_datos (dato inválido — no se reintenta) y error_definitivo
  // (agotó los 5 intentos). El worker no puede recuperarlas solo.
  const { data: facturasErrorDefinitivo = [] } = useQuery({
    queryKey: ['notif', 'facturas_error_definitivo', empresaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('facturas_pendientes_arca')
        .select('id, estado, comprobante_id, error_mensaje')
        .eq('empresa_id', empresaId)
        .in('estado', ['error_datos', 'error_definitivo'])
        .limit(10);
      if (error) return [];
      return data ?? [];
    },
    enabled: !!empresaId,
    ...REFETCH_OPTS,
  });

  // ── CAEA por vencer sin informar (contingencia offline AFIP/ARCA) ─────────
  const { data: caeaPorVencer = [] } = useQuery({
    queryKey: ['notif', 'caea_por_vencer', empresaId],
    queryFn: async () => {
      const hoy  = getTodayAR();
      const in3d = new Date(new Date(hoy + 'T00:00:00Z').getTime() + 3 * 86400000).toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from('caea_registros')
        .select('id, caea, fecha_tope_inf, comprobantes_emitidos')
        .eq('empresa_id', empresaId)
        .eq('estado', 'activo')
        .not('fecha_tope_inf', 'is', null)
        .lte('fecha_tope_inf', in3d)
        .gt('comprobantes_emitidos', 0);
      if (error) return [];
      return data ?? [];
    },
    enabled: !!empresaId && hasPermission('configuracion'),
    ...REFETCH_OPTS,
  });

  // ── Armar lista unificada ──────────────────────────────────────────────────
  const allItems = [
    ...(facturasErrorDefinitivo.length > 0 ? [{
      id: 'facturas-error-definitivo',
      tipo: 'facturas_error_cae',
      titulo: `${facturasErrorDefinitivo.length} factura${facturasErrorDefinitivo.length > 1 ? 's' : ''} con error CAE definitivo`,
      detalle: facturasErrorDefinitivo.some(f => f.estado === 'error_datos')
        ? 'Datos inválidos o reintentos agotados — revisión manual requerida.'
        : 'Reintentos agotados — verificar en portal ARCA o corregir datos.',
      nivel: 'critico',
      seccion: 'configuracion',
      action: 'tab-facturacion',
      raw: facturasErrorDefinitivo,
    }] : []),
    ...(caeaPorVencer.length > 0 ? [{
      id: 'caea-por-vencer',
      tipo: 'caea_por_vencer',
      titulo: `${caeaPorVencer.length} CAEA por vencer sin informar`,
      detalle: 'Informá la quincena a ARCA antes de la fecha tope desde Configuración → Facturación.',
      nivel: 'advertencia',
      seccion: 'configuracion',
      action: 'tab-facturacion',
      raw: caeaPorVencer,
    }] : []),
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
    ...(alertasCfg.alerta_stock_bajo ? stockBajo.map(p => ({
      id: `stock-${p.id}`,
      tipo: 'stock_bajo',
      titulo: p.nombre,
      detalle: `Stock: ${p.stock_actual} ${p.unidad_medida ?? ''} (mín. ${p.stock_minimo})`,
      nivel: p.stock_actual === 0 ? 'critico' : 'advertencia',
      seccion: 'productos',
      raw: p,
    })) : []),
    ...deudaVencida.map(c => ({
      id: `deuda-${c.id}`,
      tipo: 'deuda_vencida',
      titulo: c.nombre,
      detalle: `Deuda: $${Number(c.saldo_actual).toLocaleString('es-AR', { minimumFractionDigits: 2 })} — sin movimiento +${c.diasVencimiento} días`,
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

  // ── Descartadas ("vistas") ─────────────────────────────────────────────────
  // El usuario abre una alerta → "vuela" de la lista. Filtramos las descartadas
  // y limpiamos del set las que ya no aplican (condición resuelta), para que
  // puedan volver a notificar si reaparecen.
  const dismissed = useDismissedNotifications();
  const liveIds = allItems.map((i) => i.id).join('|');
  useEffect(() => {
    pruneDismissed(allItems.map((i) => i.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveIds]);

  const items = allItems.filter((i) => !dismissed.has(i.id));

  return {
    items,
    count: items.length,
    dismiss: dismissNotification,
    stockBajo,
    deudaVencida,
    ocPendientes,
    cajaSinCerrar,
    caesPendientes,
    facturasErrorDefinitivo,
    chequesProximos,
    retencionesPracticadas,
    caeaPorVencer,
    hasNotifications: items.length > 0,
  };
}
