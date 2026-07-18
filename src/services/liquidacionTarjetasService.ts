import { supabase } from '@/lib/customSupabaseClient';

export interface MovimientoPendienteLiquidacion {
  id: string;
  fecha: string;
  concepto: string;
  metodo_pago: string;
  monto: number;
  monto_comision: number;
  monto_neto: number;
  fecha_acreditacion_estimada: string | null;
  forma_pago_id: string | null;
}

export const LIQUIDACION_KEYS = {
  pendientes: (empresaId: string) => ['liquidacion-tarjetas', 'pendientes', empresaId] as const,
};

export const liquidacionTarjetasService = {
  async getPendientes(empresaId: string): Promise<MovimientoPendienteLiquidacion[]> {
    const { data, error } = await supabase
      .from('movimientos_caja')
      .select('id, fecha, concepto, metodo_pago, monto, monto_comision, monto_neto, fecha_acreditacion_estimada, forma_pago_id')
      .eq('empresa_id', empresaId)
      .eq('estado_liquidacion', 'pendiente')
      .order('fecha_acreditacion_estimada', { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  },

  async acreditar(movimientoCajaId: string): Promise<{ ok: boolean; asiento_id: string; monto_neto: number; monto_comision: number }> {
    const { data, error } = await supabase.rpc('acreditar_movimiento_caja', {
      p_movimiento_caja_id: movimientoCajaId,
    });
    if (error) throw new Error(error.message);
    return data;
  },
};
