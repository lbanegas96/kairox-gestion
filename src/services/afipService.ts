import { supabase } from '@/lib/customSupabaseClient';

export interface CAEResult {
  success: boolean;
  cae?: string;
  numero_afip?: string;
  vencimiento?: string;
  error?: string;
}

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

/** Emite el CAE de un comprobante llamando a la Edge Function `emitir-cae`. */
export async function emitirCAE(comprobante_id: string): Promise<CAEResult> {
  try {
    const { data, error } = await supabase.functions.invoke('emitir-cae', {
      body: { comprobante_id },
    });
    if (error) throw error;
    return data as CAEResult;
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Reintenta la emisión de CAE para comprobantes en estado 'pendiente' o 'error'.
 * Procesa hasta 10 por corrida con un rate-limit suave entre llamadas.
 */
export async function reintentarCAEsPendientes(empresa_id: string): Promise<void> {
  const { data: pendientes } = await supabase
    .from('comprobantes')
    .select('id')
    .eq('empresa_id', empresa_id)
    .in('cae_estado', ['pendiente', 'error'])
    .limit(10);

  if (!pendientes?.length) return;

  for (const comp of pendientes) {
    await emitirCAE(comp.id);
    await new Promise((r) => setTimeout(r, 500)); // rate limiting suave
  }
}
