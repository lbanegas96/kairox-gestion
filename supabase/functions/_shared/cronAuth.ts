/**
 * Autorización de los workers que dispara el cron (auditoría 24/09, SEG-3).
 *
 * Los workers se despliegan con `verify_jwt = false` porque el cron (pg_net) no tiene sesión de usuario; sin una
 * verificación propia cualquiera que conozca la URL podía llamarlos en bucle y forzar llamadas a ARCA, Mercado
 * Pago, Tiendanube o MercadoLibre. Ahora el cron manda el header `x-cron-secret` con un secreto guardado en Vault
 * (`cron_secret`, mig. 415) y cada worker lo verifica contra la base con `verificar_cron_secret` (solo ejecutable
 * con service_role). El secreto no vive en variables de entorno ni en el repositorio.
 *
 * Tres workers también los dispara el navegador para no esperar al próximo tick del cron (`arca-worker`,
 * `tiendanube-catalogo-publicar`, `mercadolibre-catalogo-publicar`): esos aceptan además el token de una sesión de
 * usuario real (`permitirUsuario`). La clave anónima —pública— NO sirve como sesión: `auth.getUser` la rechaza.
 *
 * Uso:
 *   const denegado = await autorizarWorker(req);              // solo cron
 *   const denegado = await autorizarWorker(req, { permitirUsuario: true });   // cron o sesión de usuario
 *   if (denegado) return denegado;
 */
import { adminClient, errorResponse } from './auth.ts';

/** Devuelve `null` si el pedido está autorizado, o la respuesta 401 que hay que devolver si no. */
export async function autorizarWorker(
  req: Request,
  opciones: { permitirUsuario?: boolean } = {},
): Promise<Response | null> {
  // 1. Secreto compartido con el cron.
  const secreto = req.headers.get('x-cron-secret');
  if (secreto) {
    const { data, error } = await adminClient.rpc('verificar_cron_secret', { p_secret: secreto });
    if (!error && data === true) return null;
  }

  // 2. Sesión de un usuario (solo para los workers que también dispara el navegador).
  if (opciones.permitirUsuario) {
    const autorizacion = req.headers.get('Authorization') ?? '';
    if (autorizacion.startsWith('Bearer ')) {
      const { data, error } = await adminClient.auth.getUser(autorizacion.slice('Bearer '.length));
      if (!error && data?.user) return null;
    }
  }

  return errorResponse('No autorizado', 401, req);
}
