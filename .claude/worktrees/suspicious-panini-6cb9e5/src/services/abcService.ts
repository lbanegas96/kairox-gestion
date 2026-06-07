import { supabase } from '@/lib/customSupabaseClient';

export type ClaseABC = 'A' | 'B' | 'C';

export interface ProductoABC {
  produto_id: string;
  nombre: string;
  categoria: string | null;
  stock_actual: number;
  costo_compra: number;
  unidades_vendidas: number;
  revenue: number;
  pct_revenue: number;
  pct_acumulado: number;
  clase: ClaseABC;
}

export interface ABCResumen {
  productos: ProductoABC[];
  totales: {
    A: { cantidad: number; revenue: number; pct: number };
    B: { cantidad: number; revenue: number; pct: number };
    C: { cantidad: number; revenue: number; pct: number };
  };
  revenueTotal: number;
}

/**
 * Análisis ABC de inventario
 * A = primeros productos que acumulan el 80% del revenue
 * B = siguientes hasta el 95%
 * C = el resto (5% o menos)
 *
 * Usa comprobante_items (columnas portuguesas) + produtos (tabla maestra)
 */
export async function getAnalisisABC(empresaId: string): Promise<ABCResumen> {
  // 1. Traer todos los items vendidos agrupados por produto_id
  const { data: itemsRaw, error: itemsError } = await supabase
    .from('comprobante_items')
    .select('produto_id, quantidade, subtotal')
    .eq('empresa_id', empresaId);

  if (itemsError) throw itemsError;

  // 2. Traer catálogo de produtos activos
  const { data: catalogoRaw, error: catError } = await supabase
    .from('produtos')
    .select('id, nome, stock_atual, costo_compra, categoria')
    .eq('user_id', empresaId)
    .eq('activo', true);

  if (catError) throw catError;

  // 3. Agregar ventas por produto_id
  const ventasMap = new Map<string, { unidades: number; revenue: number }>();
  for (const item of itemsRaw ?? []) {
    const pid = item.produto_id as string;
    if (!pid) continue;
    const existing = ventasMap.get(pid) ?? { unidades: 0, revenue: 0 };
    ventasMap.set(pid, {
      unidades: existing.unidades + Number(item.quantidade ?? 0),
      revenue: existing.revenue + Number(item.subtotal ?? 0),
    });
  }

  // 4. Construir lista incluyendo productos sin ventas (clase C)
  const catalogo = catalogoRaw ?? [];
  const revenueTotal = Array.from(ventasMap.values()).reduce((s, v) => s + v.revenue, 0);

  const lista = catalogo.map(p => ({
    produto_id: p.id as string,
    nombre: (p.nome as string) || 'Sin nombre',
    categoria: p.categoria as string | null,
    stock_actual: Number(p.stock_atual ?? 0),
    costo_compra: Number(p.costo_compra ?? 0),
    unidades_vendidas: ventasMap.get(p.id)?.unidades ?? 0,
    revenue: ventasMap.get(p.id)?.revenue ?? 0,
  }));

  // 5. Ordenar por revenue descendente
  lista.sort((a, b) => b.revenue - a.revenue);

  // 6. Calcular % acumulado y asignar clase
  let acumulado = 0;
  const productos: ProductoABC[] = lista.map(p => {
    const pct = revenueTotal > 0 ? (p.revenue / revenueTotal) * 100 : 0;
    acumulado += pct;

    let clase: ClaseABC;
    if (acumulado <= 80 || (p.revenue > 0 && pct >= 1)) {
      clase = acumulado <= 80 ? 'A' : acumulado <= 95 ? 'B' : 'C';
    } else {
      clase = 'C';
    }

    return {
      ...p,
      pct_revenue: pct,
      pct_acumulado: Math.min(acumulado, 100),
      clase,
    };
  });

  // Recalcular correctamente (el acumulado progresivo puede desviar)
  let acc = 0;
  const productosCorregidos: ProductoABC[] = productos.map(p => {
    acc += p.pct_revenue;
    const clase: ClaseABC = acc <= 80 ? 'A' : acc <= 95 ? 'B' : 'C';
    return { ...p, pct_acumulado: Math.min(acc, 100), clase };
  });

  // 7. Totales por clase
  const totales = {
    A: { cantidad: 0, revenue: 0, pct: 0 },
    B: { cantidad: 0, revenue: 0, pct: 0 },
    C: { cantidad: 0, revenue: 0, pct: 0 },
  };
  for (const p of productosCorregidos) {
    totales[p.clase].cantidad++;
    totales[p.clase].revenue += p.revenue;
  }
  if (revenueTotal > 0) {
    totales.A.pct = (totales.A.revenue / revenueTotal) * 100;
    totales.B.pct = (totales.B.revenue / revenueTotal) * 100;
    totales.C.pct = (totales.C.revenue / revenueTotal) * 100;
  }

  return { productos: productosCorregidos, totales, revenueTotal };
}

export const ABC_KEYS = {
  analisis: (empresaId: string) => ['abc', 'analisis', empresaId] as const,
};
