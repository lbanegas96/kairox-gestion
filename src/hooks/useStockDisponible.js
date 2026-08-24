import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';

// Stock Comprometido — Fase 1 (mig.349/350): trae, para toda la empresa, sólo los productos
// que HOY tienen algo comprometido (Factura de Reserva sin entregar) — la mayoría de los
// productos no tiene nada comprometido, así que no tiene sentido traer una fila para cada uno
// (mismo criterio de egress que ya se aplicó en mig.333 con productos_stock_bajo). Devuelve un
// Map<producto_id, { stock_comprometido, stock_disponible }>; cualquier producto ausente del mapa
// tiene comprometido=0 (su disponible es directamente su stock_actual).
//
// No usa react-query a propósito — se llama tanto desde componentes que ya usan react-query
// (ProductosSection.jsx) como desde el POS, que maneja sus productos con useState/useEffect
// simple (PanelProductos.jsx) — mismo estilo que useProductosSnapshot.js para no mezclar dos
// paradigmas de datos en el mismo panel.
export function useStockDisponible(empresaId) {
  const [mapaDisponible, setMapaDisponible] = useState(new Map());

  const refrescarDisponible = useCallback(async () => {
    if (!empresaId) return;
    const { data, error } = await supabase
      .from('productos_stock_disponible')
      .select('producto_id, stock_comprometido, stock_disponible')
      .eq('empresa_id', empresaId)
      .gt('stock_comprometido', 0);
    if (!error && data) {
      setMapaDisponible(new Map(data.map(r => [r.producto_id, r])));
    }
  }, [empresaId]);

  useEffect(() => { refrescarDisponible(); }, [refrescarDisponible]);

  return { mapaDisponible, refrescarDisponible };
}
