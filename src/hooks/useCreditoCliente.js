import { supabase } from '@/lib/customSupabaseClient';

/**
 * Hook para verificar el límite de crédito de un cliente al confirmar una venta a
 * Cuenta Corriente. Extraído 1:1 de la lógica que vivía inline en NuevaVentaModal.
 *
 * A propósito NO usa useQuery/cache: la verificación original es una lectura
 * imperativa de `clientes` justo antes de confirmar (no un valor reactivo
 * mostrado en pantalla), para evitar trabajar con saldo_actual desactualizado si
 * cambió desde que se seleccionó el cliente. Cachear esto cambiaría el
 * comportamiento real (podría dejar pasar una venta con datos viejos), así que
 * se mantiene como función imperativa bajo demanda.
 */
export function useCreditoCliente() {
  /**
   * Verifica si `montoNuevo` sumado al saldo actual del cliente excede su
   * límite de crédito. Devuelve:
   *   { aplica: false }                                    — sin límite configurado (limite_credito <= 0)
   *   { aplica: true, excede: false }                       — dentro del límite
   *   { aplica: true, excede: true, bloquea, limite, saldoActual } — excede; bloquea según `bloquear_en_limite` del cliente
   */
  const verificarLimite = async (clienteId, montoNuevo) => {
    const { data: clienteActual } = await supabase
      .from('clientes')
      .select('saldo_actual, limite_credito, bloquear_en_limite')
      .eq('id', clienteId)
      .single();

    const limite = Number(clienteActual?.limite_credito || 0);
    if (limite <= 0) return { aplica: false };

    const saldoActual = Number(clienteActual?.saldo_actual || 0);
    const nuevoSaldo = saldoActual + montoNuevo;
    const excede = nuevoSaldo > limite;

    if (!excede) return { aplica: true, excede: false };

    return {
      aplica: true,
      excede: true,
      bloquea: !!clienteActual?.bloquear_en_limite,
      limite,
      saldoActual,
    };
  };

  return { verificarLimite };
}
