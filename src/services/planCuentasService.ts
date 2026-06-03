import { supabase } from '@/lib/customSupabaseClient';
import type {
  PlanCuenta,
  AsientoContable,
  AsientoItem,
  PaginatedResult,
} from '@/types';

// ─── Plan de Cuentas ──────────────────────────────────────────────────────────

export const planCuentasService = {
  async getCuentas(empresaId: string): Promise<PlanCuenta[]> {
    const { data, error } = await supabase
      .from('plan_cuentas')
      .select('*')
      .eq('empresa_id', empresaId)
      .order('codigo', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as PlanCuenta[];
  },

  async seedCuentas(empresaId: string): Promise<void> {
    const { error } = await supabase.rpc('seed_plan_cuentas', {
      p_empresa_id: empresaId,
    });
    if (error) throw new Error(error.message);
  },

  async createCuenta(
    empresaId: string,
    payload: Omit<PlanCuenta, 'id' | 'empresa_id' | 'saldo_actual' | 'created_at' | 'hijos'>
  ): Promise<PlanCuenta> {
    const { data, error } = await supabase
      .from('plan_cuentas')
      .insert([{ ...payload, empresa_id: empresaId }])
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as PlanCuenta;
  },

  async updateCuenta(
    id: string,
    payload: Partial<Pick<PlanCuenta, 'nombre' | 'activa' | 'permite_movimientos'>>
  ): Promise<PlanCuenta> {
    const { data, error } = await supabase
      .from('plan_cuentas')
      .update(payload)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as PlanCuenta;
  },

  /** Construye árbol jerárquico desde lista plana */
  buildTree(cuentas: PlanCuenta[]): PlanCuenta[] {
    const map: Record<string, PlanCuenta> = {};
    const roots: PlanCuenta[] = [];

    cuentas.forEach((c) => {
      map[c.id] = { ...c, hijos: [] };
    });

    cuentas.forEach((c) => {
      if (c.cuenta_padre_id && map[c.cuenta_padre_id]) {
        map[c.cuenta_padre_id].hijos!.push(map[c.id]);
      } else if (!c.cuenta_padre_id) {
        roots.push(map[c.id]);
      }
    });

    return roots;
  },
};

// ─── Asientos Contables ───────────────────────────────────────────────────────

export const asientosService = {
  async getAsientos(
    empresaId: string,
    { page = 1, pageSize = 30, estado, fechaDesde, fechaHasta }: {
      page?: number;
      pageSize?: number;
      estado?: string;
      fechaDesde?: string;
      fechaHasta?: string;
    } = {}
  ): Promise<PaginatedResult<AsientoContable>> {
    const from = (page - 1) * pageSize;
    let q = supabase
      .from('asientos_contables')
      .select('*, asientos_items(*, plan_cuentas(codigo, nombre, tipo))', { count: 'exact' })
      .eq('empresa_id', empresaId)
      .order('fecha', { ascending: false })
      .order('numero', { ascending: false })
      .range(from, from + pageSize - 1);

    if (estado) q = q.eq('estado', estado);
    if (fechaDesde) q = q.gte('fecha', fechaDesde);
    if (fechaHasta) q = q.lte('fecha', fechaHasta);

    const { data, error, count } = await q;
    if (error) throw new Error(error.message);
    return {
      data: (data ?? []) as AsientoContable[],
      count: count ?? 0,
      pages: Math.ceil((count ?? 0) / pageSize),
    };
  },

  async getAsiento(id: string): Promise<AsientoContable> {
    const { data, error } = await supabase
      .from('asientos_contables')
      .select('*, asientos_items(*, plan_cuentas(codigo, nombre, tipo))')
      .eq('id', id)
      .single();
    if (error) throw new Error(error.message);
    return data as AsientoContable;
  },

  async createAsiento(
    empresaId: string,
    userId: string,
    payload: {
      fecha: string;
      descripcion?: string;
      origen?: string;
      origen_id?: string;
    },
    items: Omit<AsientoItem, 'id' | 'asiento_id' | 'empresa_id' | 'created_at'>[]
  ): Promise<AsientoContable> {
    // Verificar cierre de período antes de insertar
    const cerrado = await periodosService.isPeriodoCerrado(empresaId, payload.fecha);
    if (cerrado) {
      const [anio, mes] = payload.fecha.slice(0, 7).split('-').map(Number);
      throw new Error(`El período ${mes}/${anio} está cerrado. No se pueden registrar asientos en este período.`);
    }

    const totalDebe  = items.reduce((s, i) => s + Number(i.debe),  0);
    const totalHaber = items.reduce((s, i) => s + Number(i.haber), 0);

    // Obtener próximo número
    const { data: numData, error: numError } = await supabase
      .rpc('next_numero_asiento', { p_empresa_id: empresaId });
    if (numError) throw new Error(numError.message);

    const { data: asiento, error: aError } = await supabase
      .from('asientos_contables')
      .insert([{
        empresa_id: empresaId,
        user_id: userId,
        numero: numData as string,
        total_debe: totalDebe,
        total_haber: totalHaber,
        ...payload,
      }])
      .select()
      .single();
    if (aError) throw new Error(aError.message);

    const lineas = items.map((i) => ({
      ...i,
      asiento_id: (asiento as AsientoContable).id,
      empresa_id: empresaId,
    }));

    const { error: iError } = await supabase.from('asientos_items').insert(lineas);
    if (iError) throw new Error(iError.message);

    return asiento as AsientoContable;
  },

  async confirmarAsiento(id: string): Promise<void> {
    const { error } = await supabase
      .from('asientos_contables')
      .update({ estado: 'confirmado' })
      .eq('id', id);
    if (error) throw new Error(error.message);
  },

  async anularAsiento(id: string): Promise<void> {
    const { error } = await supabase
      .from('asientos_contables')
      .update({ estado: 'anulado' })
      .eq('id', id);
    if (error) throw new Error(error.message);
  },

  /** Balance de comprobación: suma debe/haber por cuenta */
  async getBalanceComprobacion(empresaId: string, fechaDesde?: string, fechaHasta?: string) {
    let q = supabase
      .from('asientos_items')
      .select('cuenta_id, debe, haber, plan_cuentas(codigo, nombre, tipo), asientos_contables!inner(estado, fecha, empresa_id)')
      .eq('empresa_id', empresaId)
      .eq('asientos_contables.estado', 'confirmado')
      .eq('asientos_contables.empresa_id', empresaId);

    if (fechaDesde) q = q.gte('asientos_contables.fecha', fechaDesde);
    if (fechaHasta) q = q.lte('asientos_contables.fecha', fechaHasta);

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    // Agrupar por cuenta
    const map: Record<string, {
      cuenta_id: string;
      codigo: string;
      nombre: string;
      tipo: string;
      total_debe: number;
      total_haber: number;
    }> = {};

    (data ?? []).forEach((row: any) => {
      const id = row.cuenta_id;
      if (!map[id]) {
        map[id] = {
          cuenta_id: id,
          codigo: row.plan_cuentas?.codigo ?? '',
          nombre: row.plan_cuentas?.nombre ?? '',
          tipo: row.plan_cuentas?.tipo ?? '',
          total_debe: 0,
          total_haber: 0,
        };
      }
      map[id].total_debe  += Number(row.debe);
      map[id].total_haber += Number(row.haber);
    });

    return Object.values(map).sort((a, b) => a.codigo.localeCompare(b.codigo));
  },

  /** Movimientos de grupo: todos los asientos_items de un conjunto de cuentas (grupo y sus hijos) */
  async getMovimientosPorGrupo(
    empresaId: string,
    cuentaIds: string[],
    fechaDesde?: string,
    fechaHasta?: string
  ): Promise<any[]> {
    if (cuentaIds.length === 0) return [];

    let q = supabase
      .from('asientos_items')
      .select('*, plan_cuentas(codigo, nombre, tipo), asientos_contables!inner(numero, fecha, descripcion, origen, estado, empresa_id)')
      .in('cuenta_id', cuentaIds)
      .eq('asientos_contables.empresa_id', empresaId)
      .eq('asientos_contables.estado', 'confirmado')
      .order('asientos_contables(fecha)', { ascending: true });

    if (fechaDesde) q = (q as any).gte('asientos_contables.fecha', fechaDesde);
    if (fechaHasta) q = (q as any).lte('asientos_contables.fecha', fechaHasta);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data ?? [];
  },

  /** Estado de Resultados (P&L): ingresos y egresos del período */
  async getEstadoResultados(empresaId: string, fechaDesde?: string, fechaHasta?: string) {
    const rows = await this.getBalanceComprobacion(empresaId, fechaDesde, fechaHasta);
    const ingresos = rows.filter(r => r.tipo === 'ingreso').map(r => ({ ...r, saldo: r.total_haber - r.total_debe }));
    const egresos  = rows.filter(r => r.tipo === 'egreso' ).map(r => ({ ...r, saldo: r.total_debe  - r.total_haber }));
    const totalIngresos = ingresos.reduce((s, r) => s + r.saldo, 0);
    const totalEgresos  = egresos.reduce((s,  r) => s + r.saldo, 0);
    return { ingresos, egresos, totalIngresos, totalEgresos, resultado: totalIngresos - totalEgresos };
  },

  /** Balance General: activo = pasivo + patrimonio */
  async getBalanceGeneral(empresaId: string, fechaDesde?: string, fechaHasta?: string) {
    const rows = await this.getBalanceComprobacion(empresaId, fechaDesde, fechaHasta);
    const activos    = rows.filter(r => r.tipo === 'activo'    ).map(r => ({ ...r, saldo: r.total_debe  - r.total_haber }));
    const pasivos    = rows.filter(r => r.tipo === 'pasivo'    ).map(r => ({ ...r, saldo: r.total_haber - r.total_debe  }));
    const patrimonio = rows.filter(r => r.tipo === 'patrimonio').map(r => ({ ...r, saldo: r.total_haber - r.total_debe  }));
    const totalActivos    = activos.reduce((s, r)    => s + r.saldo, 0);
    const totalPasivos    = pasivos.reduce((s, r)    => s + r.saldo, 0);
    const totalPatrimonio = patrimonio.reduce((s, r) => s + r.saldo, 0);
    return { activos, pasivos, patrimonio, totalActivos, totalPasivos, totalPatrimonio };
  },

  /** Libro Mayor: todos los movimientos confirmados de una cuenta con saldo acumulado */
  async getLibroMayor(
    empresaId: string,
    cuentaId: string,
    fechaDesde?: string,
    fechaHasta?: string
  ): Promise<any[]> {
    let q = supabase
      .from('asientos_items')
      .select('*, asientos_contables!inner(numero, fecha, descripcion, origen, estado, empresa_id)')
      .eq('cuenta_id', cuentaId)
      .eq('asientos_contables.empresa_id', empresaId)
      .eq('asientos_contables.estado', 'confirmado')
      .order('asientos_contables(fecha)', { ascending: true });

    if (fechaDesde) q = (q as any).gte('asientos_contables.fecha', fechaDesde);
    if (fechaHasta) q = (q as any).lte('asientos_contables.fecha', fechaHasta);

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    let saldo = 0;
    return (data ?? []).map((row: any) => {
      saldo += Number(row.debe) - Number(row.haber);
      return { ...row, saldo_acumulado: saldo };
    });
  },
};

// ─── Períodos contables ───────────────────────────────────────────────────────

interface PeriodoContable {
  empresa_id: string;
  anio: number;
  mes: number;
  cerrado: boolean;
  fecha_cierre: string | null;
  cerrado_por: string | null;
}

export const periodosService = {
  async getPeriodosAnio(empresaId: string, anio: number): Promise<PeriodoContable[]> {
    const { data, error } = await supabase
      .from('periodos_contables')
      .select('*')
      .eq('empresa_id', empresaId)
      .eq('anio', anio);
    if (error) throw new Error(error.message);
    return (data ?? []) as PeriodoContable[];
  },

  async togglePeriodo(
    empresaId: string, anio: number, mes: number,
    cerrado: boolean, userId: string
  ): Promise<void> {
    const { error } = await supabase
      .from('periodos_contables')
      .upsert({
        empresa_id: empresaId, anio, mes, cerrado,
        fecha_cierre: cerrado ? new Date().toISOString() : null,
        cerrado_por:  cerrado ? userId : null,
      }, { onConflict: 'empresa_id,anio,mes' });
    if (error) throw new Error(error.message);
  },

  async isPeriodoCerrado(empresaId: string, fecha: string): Promise<boolean> {
    const parts = fecha.slice(0, 7).split('-');
    const anio = Number(parts[0]);
    const mes  = Number(parts[1]);
    const { data, error } = await supabase
      .from('periodos_contables')
      .select('cerrado')
      .eq('empresa_id', empresaId)
      .eq('anio', anio)
      .eq('mes', mes)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as any)?.cerrado ?? false;
  },
};

// ─── Query keys ───────────────────────────────────────────────────────────────

export const PLAN_CUENTAS_KEYS = {
  cuentas: (empresaId: string) => ['plan_cuentas', empresaId] as const,
  asientos: (empresaId: string, filters?: object) => ['asientos', empresaId, filters] as const,
  balance: (empresaId: string, desde?: string, hasta?: string) =>
    ['balance_comprobacion', empresaId, desde, hasta] as const,
  libroMayor: (empresaId: string, cuentaId: string, desde?: string, hasta?: string) =>
    ['libro_mayor', empresaId, cuentaId, desde, hasta] as const,
  movimientosGrupo: (empresaId: string, ids: string[], desde?: string, hasta?: string) =>
    ['movimientos_grupo', empresaId, [...ids].sort().join(','), desde, hasta] as const,
  periodos: (empresaId: string, anio: number) =>
    ['periodos_contables', empresaId, anio] as const,
  estadoResultados: (empresaId: string, desde?: string, hasta?: string) =>
    ['estado_resultados', empresaId, desde, hasta] as const,
  balanceGeneral: (empresaId: string, desde?: string, hasta?: string) =>
    ['balance_general', empresaId, desde, hasta] as const,
};

// ─── Asientos automáticos ────────────────────────────────────────────────────
// Helper interno: busca cuenta por código, retorna null si no existe

async function findCuentaByCodigo(empresaId: string, codigo: string): Promise<string | null> {
  const { data } = await supabase
    .from('plan_cuentas')
    .select('id')
    .eq('empresa_id', empresaId)
    .eq('codigo', codigo)
    .maybeSingle();
  return (data as any)?.id ?? null;
}

export const asientosAutoService = {
  /**
   * Crea y confirma el asiento de una venta al contado.
   *   DEBE  1.1.1 Caja y Bancos  (o 1.1.2 Cuentas a Cobrar si es crédito)
   *   HABER 4.1   Ventas de Productos
   * Si la empresa no tiene plan de cuentas, sale silenciosamente.
   */
  async crearAsientoVenta(
    empresaId: string,
    userId: string,
    params: {
      ventaId: string;
      total: number;
      fecha: string;       // YYYY-MM-DD
      descripcion: string;
      esCredito?: boolean;
    }
  ): Promise<void> {
    const codigoCobro = params.esCredito ? '1.1.2' : '1.1.1';
    const [cuentaCobro, cuentaVentas] = await Promise.all([
      findCuentaByCodigo(empresaId, codigoCobro),
      findCuentaByCodigo(empresaId, '4.1'),
    ]);
    if (!cuentaCobro || !cuentaVentas) return; // empresa sin plan de cuentas

    const asiento = await asientosService.createAsiento(
      empresaId, userId,
      { fecha: params.fecha, descripcion: params.descripcion, origen: 'venta', origen_id: params.ventaId },
      [
        { cuenta_id: cuentaCobro,  debe: params.total, haber: 0,            descripcion: 'Cobro por venta' },
        { cuenta_id: cuentaVentas, debe: 0,            haber: params.total, descripcion: 'Ingreso por venta' },
      ]
    );
    await asientosService.confirmarAsiento(asiento.id);
  },

  /**
   * Crea y confirma el asiento de una compra.
   *   DEBE  1.1.3 Mercaderías / Inventario
   *   HABER 1.1.1 Caja y Bancos  (o 2.1.1 Cuentas a Pagar si es crédito)
   */
  async crearAsientoCompra(
    empresaId: string,
    userId: string,
    params: {
      compraId: string;
      total: number;
      fecha: string;       // YYYY-MM-DD
      descripcion: string;
      esCredito?: boolean;
    }
  ): Promise<void> {
    const codigoPago = params.esCredito ? '2.1.1' : '1.1.1';
    const [cuentaInventario, cuentaPago] = await Promise.all([
      findCuentaByCodigo(empresaId, '1.1.3'),
      findCuentaByCodigo(empresaId, codigoPago),
    ]);
    if (!cuentaInventario || !cuentaPago) return;

    const asiento = await asientosService.createAsiento(
      empresaId, userId,
      { fecha: params.fecha, descripcion: params.descripcion, origen: 'compra', origen_id: params.compraId },
      [
        { cuenta_id: cuentaInventario, debe: params.total, haber: 0,            descripcion: 'Compra de mercadería' },
        { cuenta_id: cuentaPago,       debe: 0,            haber: params.total, descripcion: 'Pago por compra' },
      ]
    );
    await asientosService.confirmarAsiento(asiento.id);
  },
};
