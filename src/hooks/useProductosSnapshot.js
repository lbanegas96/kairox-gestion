import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { guardarSnapshot, leerSnapshot } from '@/lib/offlineDb';

// Modo Offline del POS — Fase 2. Mientras hay conexión, mantiene en Dexie una
// copia completa de los productos ACTIVOS de la empresa (mismas columnas que
// ya lee PanelProductos). Cuando se corta la red, PanelProductos usa
// `buscarOffline`/`buscarPorCodigoBarras` en vez de golpear a Supabase.
//
// A propósito es sólo lectura: no descuenta stock ni permite cobrar desde acá.
// El stock que se ve offline puede estar desactualizado (foto del último
// refresco online) — se avisa en la UI, no se oculta el riesgo.
const SELECT_PRODUCTOS =
  'id, empresa_id, nombre, codigo_sku, codigo_barras, precio_venta, stock_actual, stock_minimo, alicuota_iva, unidad_venta_id, factor_conversion_venta, precio_venta_pack, descuento_pack_pct, unidad_venta:unidades_medida!unidad_venta_id(codigo, descripcion)';

export function useProductosSnapshot(empresaId, isOnline) {
  const [snapshotListo, setSnapshotListo] = useState(false);
  const refrescando = useRef(false);

  const refrescar = useCallback(async () => {
    if (!empresaId || !isOnline || refrescando.current) return;
    refrescando.current = true;
    try {
      const { data, error } = await supabase
        .from('productos')
        .select(SELECT_PRODUCTOS)
        .eq('empresa_id', empresaId)
        .eq('activo', true);
      if (!error && data) {
        await guardarSnapshot('productos', empresaId, data);
        setSnapshotListo(true);
      }
    } finally {
      refrescando.current = false;
    }
  }, [empresaId, isOnline]);

  // Refresca al montar y cada vez que se recupera la conexión (isOnline pasa
  // de false a true) — así el snapshot no queda desactualizado por días.
  useEffect(() => { refrescar(); }, [refrescar]);

  const buscarOffline = useCallback(async (query) => {
    const todos = await leerSnapshot('productos', empresaId);
    if (!query?.trim()) return todos;
    const q = query.trim().toLowerCase();
    return todos.filter(p =>
      p.nombre?.toLowerCase().includes(q) || p.codigo_sku?.toLowerCase().includes(q)
    );
  }, [empresaId]);

  const buscarPorCodigoBarras = useCallback(async (codigo) => {
    if (!codigo) return null;
    const todos = await leerSnapshot('productos', empresaId);
    return todos.find(p => p.codigo_barras === codigo) ?? null;
  }, [empresaId]);

  return { snapshotListo, buscarOffline, buscarPorCodigoBarras };
}
