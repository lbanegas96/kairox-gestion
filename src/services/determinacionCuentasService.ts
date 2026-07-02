import { supabase } from '@/lib/customSupabaseClient';

// Determinación de Cuenta de Mayor (estilo SAP EBS / OBYC).
// Define qué cuenta contable imputa la contrapartida de cada movimiento bancario.

export interface DeterminacionCuenta {
  id: string;
  empresa_id: string;
  origen: string;              // mercadopago | uala | manual | csv | email | webhook | *
  tipo: string;                // ingreso | egreso | *
  subtipo?: string | null;     // qr | transferencia | tarjeta_credito | ... | null (cualquiera)
  cuenta_bancaria_id?: string | null;
  cuenta_contable_id: string;
  descripcion?: string | null;
  prioridad: number;
  activo: boolean;
  created_at?: string;
  plan_cuentas?: { codigo: string; nombre: string } | null;
  cuentas_bancarias?: { nombre: string } | null;
}

export const DET_KEYS = {
  reglas: (empresaId: string) => ['determinacion_cuentas', empresaId] as const,
};

export const determinacionService = {
  async getAll(empresaId: string): Promise<DeterminacionCuenta[]> {
    const { data, error } = await supabase
      .from('determinacion_cuentas_mayor')
      .select('*, plan_cuentas(codigo, nombre), cuentas_bancarias(nombre)')
      .eq('empresa_id', empresaId)
      .order('prioridad', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  },

  async create(regla: Partial<DeterminacionCuenta>): Promise<void> {
    const { plan_cuentas, cuentas_bancarias, id, created_at, ...rest } = regla as any;
    const { error } = await supabase.from('determinacion_cuentas_mayor').insert([rest]);
    if (error) throw new Error(error.message);
  },

  async update(id: string, updates: Partial<DeterminacionCuenta>): Promise<void> {
    const { plan_cuentas, cuentas_bancarias, id: _id, created_at, empresa_id, ...rest } = updates as any;
    const { error } = await supabase.from('determinacion_cuentas_mayor').update(rest).eq('id', id);
    if (error) throw new Error(error.message);
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('determinacion_cuentas_mayor').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },
};
