import { supabase } from '@/lib/customSupabaseClient';

// Dispara arca-worker apenas se encola una factura, en vez de esperar al
// próximo tick del cron — hallazgo Luciano (29/08, imprimiendo un ticket a
// Consumidor Final): "el envío a ARCA debe ser más rápido" para que el CAE
// real llegue a tiempo en vez de quedar en "pendiente".
//
// Fire-and-forget a propósito: el cron (cada 1 minuto, mig.373) sigue siendo
// la red de seguridad real — reintentos, ventas offline que se sincronizan
// después, o cualquier corrida que este invoke no llegue a disparar (falla
// de red, cold start). arca-worker ya soporta invocación manual además del
// cron (ver el comentario de cabecera de supabase/functions/arca-worker) y
// tiene un lock de corrida única — dispararlo de más nunca genera doble
// envío a ARCA, en el peor caso la corrida extra no encuentra nada pendiente.
export function dispararArcaWorker() {
  supabase.functions.invoke('arca-worker').catch(() => {
    // Silencioso a propósito — el cron es quien de verdad garantiza que la
    // factura se termine enviando, esto es solo para no hacer esperar al
    // cajero/vendedor los 5 (ahora 1) minutos del próximo tick.
  });
}
