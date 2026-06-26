import { supabase } from '@/lib/customSupabaseClient';

export interface CSRResult {
  success: boolean;
  csr?: string;
  message?: string;
  error?: string;
}

/**
 * Genera el par de claves RSA + CSR para ARCA/AFIP.
 * La clave privada queda en Supabase Vault; sólo se devuelve el CSR (.csr) para
 * subir a ARCA. Requiere rol admin (validado en la Edge Function).
 */
export async function generarCSR(cuit: string, razonSocial: string): Promise<CSRResult> {
  try {
    const { data, error } = await supabase.functions.invoke('generar-csr', {
      body: { cuit, razon_social: razonSocial },
    });
    if (error) throw error;
    return data as CSRResult;
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Reintento masivo de CAEs pendientes/con error.
 *
 * NO emite desde el frontend: re-encola los comprobantes en
 * `facturas_pendientes_arca` vía la RPC atómica `reencolar_caes_pendientes`
 * y deja que el `arca-worker` (única fuente de verdad para emitir) los procese.
 * Esto evita la doble emisión que se daba al llamar `emitir-cae` en loop mientras
 * el worker ya estaba reintentando la misma factura.
 *
 * Devuelve la cantidad de comprobantes re-encolados.
 */
export async function reintentarCAEsPendientes(empresa_id: string): Promise<number> {
  const { data, error } = await supabase.rpc('reencolar_caes_pendientes', {
    p_empresa_id: empresa_id,
  });
  if (error) throw error;
  return (data as number) ?? 0;
}
