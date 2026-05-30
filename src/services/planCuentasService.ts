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
};

// ─── Query keys ───────────────────────────────────────────────────────────────

export const PLAN_CUENTAS_KEYS = {
  cuentas: (empresaId: string) => ['plan_cuentas', empresaId] as const,
  asientos: (empresaId: string, filters?: object) => ['asientos', empresaId, filters] as const,
  balance: (empresaId: string, desde?: string, hasta?: string) =>
    ['balance_comprobacion', empresaId, desde, hasta] as const,
};
