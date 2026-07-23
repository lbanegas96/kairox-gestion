import { supabase } from '@/lib/customSupabaseClient';

/**
 * Dispara el worker de publicación de catálogo (tiendanube-catalogo-publicar)
 * apenas se encola algo, en vez de esperar al cron (cada 1 min, mig.235/238).
 *
 * Fire-and-forget: no bloquea al usuario ni falla la operación que lo llamó
 * (guardar un producto, subir una imagen) si la invocación falla — el cron
 * sigue siendo la red de seguridad que procesa la cola igual. El worker tiene
 * su propio CAS por ítem (`estado='pendiente'` al tomarlo) para no duplicar
 * publicaciones si el disparo inmediato y el cron coinciden.
 */
export function dispararPublicacionCatalogo() {
  supabase.functions.invoke('tiendanube-catalogo-publicar', { body: {} }).catch((e) => {
    console.warn('[integracionesService] No se pudo disparar el worker de catálogo, el cron lo va a tomar igual:', e.message);
  });
}
