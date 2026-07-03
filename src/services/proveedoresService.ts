import { supabase } from '@/lib/customSupabaseClient';
import { getNowAR } from '@/lib/dateUtils';

export const PROV_KEYS = {
  all:     (empresaId: string) => ['proveedores', empresaId] as const,
  list:    (empresaId: string, f?: object) => ['proveedores', empresaId, 'list', f] as const,
  detail:  (id: string) => ['proveedor', id] as const,
  cuentaCorriente: (id: string) => ['proveedor', id, 'cuentaCorriente'] as const,
  historial:       (id: string) => ['proveedor', id, 'historial'] as const,
};

export interface Proveedor {
  id: string;
  empresa_id: string;
  nombre: string;
  razon_social?: string;
  cuit?: string;
  condicion_iva: string;
  telefono?: string;
  email?: string;
  direccion?: string;
  localidad?: string;
  provincia?: string;
  condicion_pago: string;
  plazo_pago_dias: number;
  activo: boolean;
  notas?: string;
  created_at: string;
  updated_at: string;
}

export interface MovimientoCCP {
  id: string;
  proveedor_id: string;
  tipo: 'compra' | 'pago' | 'nota_credito' | 'nota_debito' | 'ajuste';
  monto: number;
  descripcion?: string;
  fecha: string;
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export async function getAll(empresaId: string, { search = '', activo, page = 1, pageSize = 50 }: { search?: string; activo?: boolean; page?: number; pageSize?: number } = {}) {
  let q = supabase
    .from('proveedores')
    .select('*', { count: 'exact' })
    .eq('empresa_id', empresaId)
    .order('nombre');

  if (search) q = q.ilike('nombre', `%${search}%`);
  if (activo !== undefined) q = q.eq('activo', activo);

  const from = (page - 1) * pageSize;
  q = q.range(from, from + pageSize - 1);

  const { data, error, count } = await q;
  if (error) throw new Error(error.message);
  return { data: (data ?? []) as Proveedor[], count: count ?? 0, pages: Math.ceil((count ?? 0) / pageSize) };
}

export async function getById(id: string): Promise<Proveedor> {
  const { data, error } = await supabase.from('proveedores').select('*').eq('id', id).single();
  if (error) throw new Error(error.message);
  return data as Proveedor;
}

export async function create(empresaId: string, payload: Omit<Proveedor, 'id' | 'empresa_id' | 'created_at' | 'updated_at'>): Promise<Proveedor> {
  const { data, error } = await supabase
    .from('proveedores')
    .insert([{ ...payload, empresa_id: empresaId }])
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Proveedor;
}

export async function update(id: string, payload: Partial<Proveedor>): Promise<Proveedor> {
  const { data, error } = await supabase
    .from('proveedores')
    .update({ ...payload, updated_at: getNowAR().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Proveedor;
}

export async function toggleActivo(id: string, activo: boolean): Promise<void> {
  const { error } = await supabase.from('proveedores').update({ activo }).eq('id', id);
  if (error) throw new Error(error.message);
}

// ─── Stats ───────────────────────────────────────────────────────────────────

export async function getStats(empresaId: string) {
  const [{ count: total }, { count: activos }, deudaRes] = await Promise.all([
    supabase.from('proveedores').select('*', { count: 'exact', head: true }).eq('empresa_id', empresaId),
    supabase.from('proveedores').select('*', { count: 'exact', head: true }).eq('empresa_id', empresaId).eq('activo', true),
    supabase.from('cuenta_corriente_proveedores').select('tipo, monto').eq('empresa_id', empresaId),
  ]);

  let deudaTotal = 0;
  for (const m of (deudaRes.data ?? [])) {
    if (m.tipo === 'compra' || m.tipo === 'nota_debito')  deudaTotal += Number(m.monto);
    if (m.tipo === 'pago'   || m.tipo === 'nota_credito') deudaTotal -= Number(m.monto);
  }

  return { total: total ?? 0, activos: activos ?? 0, deudaTotal };
}

// ─── Cuenta Corriente ─────────────────────────────────────────────────────────

export async function getCuentaCorriente(proveedorId: string, empresaId: string) {
  const { data, error } = await supabase
    .from('cuenta_corriente_proveedores')
    .select('*')
    .eq('proveedor_id', proveedorId)
    .eq('empresa_id', empresaId)
    .order('fecha', { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return data as MovimientoCCP[];
}

export async function registrarPago(
  empresaId: string,
  proveedorId: string,
  proveedorNombre: string,
  monto: number,
  metodo: string,
  descripcion: string,
  userId: string,
  cajaSesionId: string | null = null,
) {
  // Pago ATÓMICO: cuenta corriente proveedor ('pago') + caja (egreso) en un solo RPC (migration 131).
  // Antes solo reducía la deuda sin registrar la salida de plata de Caja/Bancos → tesorería inflada.
  const { error } = await supabase.rpc('registrar_pago_proveedor', {
    p_empresa_id:       empresaId,
    p_user_id:          userId,
    p_proveedor_id:     proveedorId,
    p_proveedor_nombre: proveedorNombre,
    p_monto:            monto,
    p_metodo:           metodo,
    p_descripcion:      descripcion,
    p_caja_sesion_id:   cajaSesionId,
  });
  if (error) throw new Error(error.message);
}

export async function getSaldoProveedor(proveedorId: string, empresaId: string): Promise<number> {
  const { data } = await supabase
    .from('cuenta_corriente_proveedores')
    .select('tipo, monto')
    .eq('proveedor_id', proveedorId)
    .eq('empresa_id', empresaId);

  return (data ?? []).reduce((acc: number, m: { tipo: string; monto: number }) => {
    if (m.tipo === 'compra' || m.tipo === 'nota_debito')  return acc + Number(m.monto);
    if (m.tipo === 'pago'   || m.tipo === 'nota_credito') return acc - Number(m.monto);
    return acc;
  }, 0);
}

// ─── Historial de compras y OC ────────────────────────────────────────────────

export async function getHistorialOC(proveedorId: string, empresaId: string) {
  const { data, error } = await supabase
    .from('ordenes_compra')
    .select('id, numero, fecha, estado, total, moneda')
    .eq('proveedor_id', proveedorId)
    .eq('empresa_id', empresaId)
    .order('fecha', { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getHistorialCompras(proveedorId: string, empresaId: string) {
  const { data, error } = await supabase
    .from('compras')
    .select('id, numero, fecha, total, proveedor_nombre')
    .eq('proveedor_id', proveedorId)
    .eq('empresa_id', empresaId)
    .order('fecha', { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export const proveedoresService = { getAll, getById, create, update, toggleActivo, getStats, getCuentaCorriente, registrarPago, getSaldoProveedor, getHistorialOC, getHistorialCompras };
