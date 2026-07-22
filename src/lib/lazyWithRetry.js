import { lazy } from 'react';

/**
 * `lazy()` resiliente a chunks viejos post-deploy.
 *
 * PROBLEMA: cuando se despliega una versión nueva, el `index.html` que el
 * navegador tiene cacheado sigue apuntando a hashes de chunk viejos
 * (ej. `ChequesSection-8e5b8318.js`). Ese archivo ya no existe en el server,
 * así que Vercel devuelve el HTML del SPA con `Content-Type: text/html` y el
 * import dinámico revienta con "Failed to load module script / Failed to fetch
 * dynamically imported module". Sin manejo, tumba toda la app (pantalla en
 * blanco) al entrar a esa sección — que es justo lo que pasaba al tocar una
 * notificación que navega a Cheques.
 *
 * SOLUCIÓN: si el import falla por un chunk que ya no existe (no por un error
 * real dentro del módulo), recargamos la página UNA vez para traer el
 * `index.html` nuevo con los hashes correctos. El flag en sessionStorage evita
 * un loop de recargas si el error fuese genuino.
 */
const CHUNK_ERROR_RE =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Failed to load module script|dynamically imported module/i;

export function lazyWithRetry(importFn, chunkName = 'chunk') {
  const sessionKey = `kx_chunk_reload_${chunkName}`;
  return lazy(async () => {
    try {
      const mod = await importFn();
      window.sessionStorage.removeItem(sessionKey);
      return mod;
    } catch (err) {
      const esChunkViejo = CHUNK_ERROR_RE.test(err?.message ?? '');
      const yaRecargamos = window.sessionStorage.getItem(sessionKey);
      if (esChunkViejo && !yaRecargamos) {
        window.sessionStorage.setItem(sessionKey, '1');
        window.location.reload();
        // La página se está recargando: devolvemos una promesa que nunca
        // resuelve para que Suspense no muestre nada mientras tanto.
        return new Promise(() => {});
      }
      throw err;
    }
  });
}
