import { supabase } from '@/lib/customSupabaseClient';

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
  created_at?: string;
  updated_at?: string;
  saldo_deuda?: number;
}

export interface MovimientoProveedor {
  id: string;
  empresa_id: string;
  proveedor_id: string;
  tipo: 'compra' | 'pago' | 'nota_credito' | 'nota_debito' | 'ajuste';
  monto: number;
  descripcion?: string;
  referencia_id?: string;
  referencia_tipo?: string;
  fecha: string;
  created_at?: string;
}

export async function getProveedores(empresaId: string): Promise<Proveedor[]> {
  // Traer ficha completa + calcular saldo en paralelo
  const [provRes, saldoRes] = await Promise.all([
    supabase
      .from('proveedores')
      .select('*')
      .eq('empresa_id', empresaId)
      .eq('activo', true)
      .order('nombre'),
    supabase
      .from('v_saldo_proveedores')
      .select('proveedor_id, saldo_deuda')
      .eq('empresa_id', empresaId),
  ]);

  if (provRes.error) throw provRes.error;

  const saldoMap = new Map(
    (saldoRes.data || []).map(s => [s.proveedor_id, s.saldo_deuda])
  );

  return (provRes.data || []).map(p => ({
    ...p,
    saldo_deuda: saldoMap.get(p.id) ?? 0,
  }));
}

export async function getProveedorById(id: string): Promise<Proveedor | null> {
  const { data, error } = await supabase
    .from('proveedores')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

export async function createProveedor(payload: Omit<Proveedor, 'id' | 'created_at' | 'updated_at' | 'saldo_deuda'>): Promise<Proveedor> {
  const { data, error } = await supabase
    .from('proveedores')
    .insert([payload])
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateProveedor(id: string, payload: Partial<Proveedor>): Promise<void> {
  const { error } = await supabase
    .from('proveedores')
    .update(payload)
    .eq('id', id);
  if (error) throw error;
}

export async function softDeleteProveedor(id: string): Promise<void> {
  const { error } = await supabase
    .from('proveedores')
    .update({ activo: false })
    .eq('id', id);
  if (error) throw error;
}

export async function getMovimientosProveedor(proveedorId: string): Promise<MovimientoProveedor[]> {
  const { data, error } = await supabase
    .from('cuenta_corriente_proveedores')
    .select('*')
    .eq('proveedor_id', proveedorId)
    .order('fecha', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function registrarPagoProveedor(
  empresaId: string,
  proveedorId: string,
  monto: number,
  descripcion: string,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from('cuenta_corriente_proveedores')
    .insert([{
      empresa_id: empresaId,
      proveedor_id: proveedorId,
      tipo: 'pago',
      monto,
      descripcion: descripcion || 'Pago a proveedor',
      user_id: userId,
    }]);
  if (error) throw error;
}

export async function getOrdenesCompraProveedor(proveedorId: string) {
  const { data, error } = await supabase
    .from('ordenes_compra')
    .select('id, numero_oc, fecha, estado, total, observaciones')
    .eq('proveedor_id', proveedorId)
    .order('fecha', { ascending: false });
  if (error) throw error;
  return data || [];
}
