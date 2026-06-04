import { supabase } from '@/lib/customSupabaseClient';

export interface CuentaBancaria {
  id: string;
  empresa_id: string;
  nombre: string;
  banco: string;
  cbu_alias?: string | null;
  moneda: string;
  plan_cuenta_id?: string | null;
  activo: boolean;
  created_at: string;
  plan_cuentas?: { id: string; nombre: string; codigo: string } | null;
}

export interface MovimientoBancario {
  id: string;
  empresa_id: string;
  cuenta_bancaria_id: string;
  fecha: string;
  descripcion: string;
  monto: number;
  tipo: 'ingreso' | 'egreso';
  origen: 'manual' | 'csv' | 'email' | 'webhook';
  conciliado: boolean;
  asiento_id?: string | null;
  created_at: string;
  cuentas_bancarias?: { nombre: string; banco: string } | null;
}

export interface MovimientoFilters {
  cuentaId?: string;
  desde?: string;
  hasta?: string;
  tipo?: string;
}

export type MovimientoInput = Omit<MovimientoBancario,
  'id' | 'created_at' | 'cuentas_bancarias' | 'conciliado' | 'asiento_id'
>;

export const CB_KEYS = {
  cuentas: (empresaId: string) => ['cuentas_bancarias', empresaId] as const,
  movimientos: (empresaId: string, filters?: MovimientoFilters) =>
    ['movimientos_bancarios', empresaId, filters] as const,
};

export const cuentasService = {
  async getAll(empresaId: string): Promise<CuentaBancaria[]> {
    const { data, error } = await supabase
      .from('cuentas_bancarias')
      .select('*, plan_cuentas(id, nombre, codigo)')
      .eq('empresa_id', empresaId)
      .eq('activo', true)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  },

  async create(
    cuenta: Omit<CuentaBancaria, 'id' | 'created_at' | 'plan_cuentas'>
  ): Promise<CuentaBancaria> {
    const { data, error } = await supabase
      .from('cuentas_bancarias')
      .insert([cuenta])
      .select('*, plan_cuentas(id, nombre, codigo)')
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  async update(id: string, updates: Partial<CuentaBancaria>): Promise<void> {
    const { plan_cuentas, id: _id, created_at, ...rest } = updates as any;
    const { error } = await supabase
      .from('cuentas_bancarias')
      .update(rest)
      .eq('id', id);
    if (error) throw new Error(error.message);
  },

  async deactivate(id: string): Promise<void> {
    const { error } = await supabase
      .from('cuentas_bancarias')
      .update({ activo: false })
      .eq('id', id);
    if (error) throw new Error(error.message);
  },
};

export const movimientosService = {
  async getAll(
    empresaId: string,
    filters: MovimientoFilters = {}
  ): Promise<MovimientoBancario[]> {
    let query = supabase
      .from('movimientos_bancarios')
      .select('*, cuentas_bancarias(nombre, banco)')
      .eq('empresa_id', empresaId)
      .order('fecha', { ascending: false });

    if (filters.cuentaId) query = query.eq('cuenta_bancaria_id', filters.cuentaId);
    if (filters.desde) query = query.gte('fecha', `${filters.desde}T00:00:00`);
    if (filters.hasta) query = query.lte('fecha', `${filters.hasta}T23:59:59`);
    if (filters.tipo && filters.tipo !== 'todos') query = query.eq('tipo', filters.tipo);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data ?? [];
  },

  async create(mov: MovimientoInput): Promise<MovimientoBancario> {
    const { data, error } = await supabase
      .from('movimientos_bancarios')
      .insert([{ ...mov, conciliado: false, origen: mov.origen ?? 'manual' }])
      .select('*, cuentas_bancarias(nombre, banco)')
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  async bulkCreate(movs: MovimientoInput[]): Promise<number> {
    const { error } = await supabase
      .from('movimientos_bancarios')
      .insert(movs.map(m => ({ ...m, conciliado: false, origen: m.origen ?? 'csv' })));
    if (error) throw new Error(error.message);
    return movs.length;
  },

  async delete(id: string, empresaId: string): Promise<void> {
    const { error } = await supabase
      .from('movimientos_bancarios')
      .delete()
      .eq('id', id)
      .eq('empresa_id', empresaId);
    if (error) throw new Error(error.message);
  },

  computeSaldos(
    cuentas: CuentaBancaria[],
    movimientos: MovimientoBancario[]
  ): Map<string, number> {
    const map = new Map<string, number>(cuentas.map(c => [c.id, 0]));
    for (const m of movimientos) {
      const prev = map.get(m.cuenta_bancaria_id) ?? 0;
      map.set(
        m.cuenta_bancaria_id,
        prev + (m.tipo === 'ingreso' ? Number(m.monto) : -Number(m.monto))
      );
    }
    return map;
  },
};
