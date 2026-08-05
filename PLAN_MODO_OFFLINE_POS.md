# Modo Offline del POS — Plan de implementación por fases

**Estado:** Fase 0 ✅ hecha y probada en producción (mig.309/310, 2026-08-05). Fase 1 sigue.

## Contexto

El "Modo Caja" (POS) de KAIROX es hoy 100% dependiente de internet: cada venta llama en vivo a la RPC `crear_venta`. Luciano pidió que el POS pueda seguir vendiendo si se corta internet en el local, y sincronizar después — pidió explícitamente algo "instalable, que el navegador lo levante en local".

Investigación de mercado (Square, Toast, Shopify POS): ningún POS real ofrece paridad completa offline. Todos limitan el alcance (cobro con tarjeta capado o deshabilitado, stock reconciliado al reconectar) y manejan conflictos explícitamente, nunca en silencio. KAIROX sigue el mismo criterio.

**Decisión de stack — PWA, no Electron/Tauri.** Investigado y comparado: Tauri/Electron dan mejor acceso nativo, pero requieren un pipeline de empaquetado/distribución nuevo (instalador por cliente) — inviable para un SaaS multi-tenant chico. Una PWA (`vite-plugin-pwa`) se instala con un clic desde Chrome/Edge (coincide con lo que pidió Luciano), se actualiza sola, y no requiere ninguna infraestructura de distribución nueva. Limitación conocida: la Background Sync API no la soportan Safari/Firefox — se evita depender de ella, usando `navigator.onLine` + reintentos propios en la app (más portable).

**Corrección importante de un supuesto inicial:** CAEA (habilitado el 2026-08-05, ver `CAEA_IMPLEMENTACION.md`) **no resuelve este problema**. CAEA es para cuando ARCA está caído pero el servidor de KAIROX (que corre en Supabase, con internet) no puede llegar a la API de AFIP — es 100% del lado del backend. El problema real acá es que el **dispositivo del cajero** no tiene ninguna conectividad, ni siquiera a Supabase. Son problemas relacionados pero distintos; CAEA queda como un fallback complementario menor al reconectar, no como la pieza principal.

## Hallazgos clave del código actual (verificados, no supuestos)

- **Cero infraestructura offline hoy**: sin service worker, sin manifest, sin `vite-plugin-pwa`, sin IndexedDB/Dexie, sin `navigator.onLine`, sin cola en localStorage. 100% greenfield. `package.json`: React 18.2, Vite 4.4.5, `@tanstack/react-query` ya instalado (no usado en el POS).
- **`TicketPrint.jsx` ya es offline-safe**: `window.print()` puro desde props en memoria, sin red. No requiere cambios de fondo, solo un estado "PROVISORIO" cuando la venta viene de la cola.
- **El total de la venta se calcula 100% en JS puro** en `useConfirmarVenta.js` (sin red) — seguro para imprimir un ticket real antes de que la venta llegue al servidor, siempre que el snapshot local de precios/ofertas esté razonablemente fresco.
- **La numeración fiscal (`obtener_proximo_numero`, mig.296) es 100% autoritativa del servidor** — `SELECT...FOR UPDATE` sobre `series_numeracion`. No hay forma de reservar números offline sin arriesgar huecos o desorden cronológico (riesgo AFIP). La numeración real solo puede pasar al sincronizar.
- **`crear_venta` (mig.287, ahora 309)** decrementa stock con `FOR UPDATE` + `RAISE EXCEPTION` si no alcanza (transacción atómica completa, todo o nada). Confía en `p_total`/`subtotal` del cliente sin re-cotizar contra `productos.precio_venta`.
- **AFIP ya es 100% async e independiente de la conectividad del POS**: `crear_venta` nunca llama a AFIP; el trigger `fn_queue_factura_arca` solo encola en `facturas_pendientes_arca`, y el `arca-worker` (cron) es quien llama a AFIP después, en su propio ciclo. Repetir este flujo al sincronizar una venta offline no requiere ningún cambio.
- **Apertura/cierre de caja (`CajaContext.jsx`) hace `INSERT`/`UPDATE` directo contra `caja_sesiones`** — `openSession` ahora debería usar la RPC `abrir_caja_sesion` (mig.310) en vez del INSERT directo (todavía no migrado en el frontend, es tarea de la Fase 3). `useConfirmarVenta` bloquea el cobro en **Efectivo** si la caja no está abierta — pero **Transferencia no requiere caja abierta** (confirmado en el toast de aviso del propio código). Si el local arranca el día ya sin internet, Transferencia ya funciona sin resolver la apertura de caja offline; Efectivo sí depende de la Fase 0 (ya resuelta a nivel backend).
- **`useArqueoCaja.js` calcula el "esperado" leyendo `movimientos_caja` del servidor** — las ventas encoladas offline no tienen fila ahí hasta sincronizar, así que un arqueo hecho con la cola pendiente muestra un faltante falso.
- **El motor de ofertas automáticas (`calcular_ofertas_carrito`) es 100% dependiente de red** y no está en el alcance de este feature — offline debe avisar explícitamente "Ofertas no disponibles sin conexión", nunca vender sin descuento en silencio.
- **La búsqueda por código de barras es una query separada** de la búsqueda por nombre/SKU en `PanelProductos.jsx` — si no se redirige también al snapshot local, se rompe en silencio mientras el resto del buscador sigue funcionando (confunde al cajero, parece que escaneó mal).
- **Patrón de idempotencia ya existente para reusar (no copiar literal)**: `insertar_movimiento_bancario_externo` (mig.245) — columna `external_ref` + índice único parcial + `ON CONFLICT DO NOTHING`. `crear_venta` es más compleja (mueve stock, genera múltiples filas en la misma transacción) — el chequeo de duplicado va **al principio** de la función con `pg_advisory_xact_lock` + `SELECT`, no un `ON CONFLICT` al final (si dos llamadas casi simultáneas pasan el chequeo, cada una seguiría decrementando stock antes de detectar el conflicto).
- **Lección de Postgres ya aprendida en este proyecto, aplica de nuevo acá:** `CREATE OR REPLACE FUNCTION` agregando un parámetro nuevo (aunque tenga `DEFAULT`) **no reemplaza la función — crea un overload nuevo**. Cualquier cambio a `crear_venta` debe ser `DROP FUNCTION` (firma exacta actual) + `CREATE FUNCTION` (firma nueva) en la misma migración — así se hizo en mig.309.
- **Dexie.js, no `idb` crudo**: UI reactiva gratis con `dexie-react-hooks` (`useLiveQuery`), versionado de schema explícito (mismo nivel de disciplina que ya existe en `supabase/migrations`), búsquedas por nombre/SKU mapean directo a `.where().startsWithIgnoreCase()`. El delta de bundle (~24kb) es irrelevante en una app que ya carga `@react-pdf/renderer`/`xlsx`/`recharts`.
- El proyecto corre sobre Hostinger Horizons (`app-preview.com`/`.io`) — la PWA hay que validarla también contra ese dominio real, no solo en local.

## Diseño — alcance explícitamente limitado (Fase 3, igual criterio que Square/Toast)

**Regla real para decidir qué medios de pago admitir offline:** no es "efectivo sí, el resto no" — es si el medio necesita que EL POS hable con un tercero (banco, tarjeta, MercadoPago) en el momento para confirmar el cobro, o si es un registro de confianza del cajero.

- **Efectivo** → plata en mano, sin dependencia externa. ✅ offline.
- **Transferencia** → verificado en el código (`useConfirmarVenta.js`): hoy **no requiere caja abierta** y se registra a mano — el cajero confía en lo que el cliente le muestra en su propio teléfono (con los datos móviles del cliente, no la conexión del local). Misma lógica que Efectivo. ✅ offline. Bonus: como no necesita caja abierta, ni siquiera depende de la apertura de caja offline para funcionar.
- **Tarjeta** → necesita autorización en vivo del banco/posnet. ❌ offline, deshabilitada con tooltip.
- **QR MercadoPago** → necesita crear la orden y esperar la confirmación de MP en tiempo real. ❌ offline, deshabilitada con tooltip.
- **Cuenta Corriente** → necesita validar el saldo/límite actualizado del cliente. ❌ offline, deshabilitada con tooltip.
- Snapshot local (Dexie) de productos, clientes, formas de pago, centros de costo y datos de empresa (logo/CUIT/dirección para el ticket) — refrescado periódicamente mientras hay conexión.
- Decremento de stock local optimista solo para que el mismo dispositivo no se sobre-venda a sí mismo entre varias ventas encoladas — es indicativo, la validación real es la del servidor al sincronizar.
- Cada venta offline genera un `client_uuid` (idempotencia) + un número de ticket local provisorio (no el `numero_venta` fiscal real). El ticket se imprime ya, marcado "PROVISORIO — pendiente de sincronizar".
- Al reconectar: la cola sincroniza **en orden cronológico de creación** (importa para la numeración fiscal correlativa). Éxito → guarda el `numero_venta` real. Conflicto de stock → nunca reintentar solo; mostrarlo al cajero para resolución manual. Este conflicto es el **caso esperado**, no un edge case: si se corta el ISP del local, todas las cajas físicas quedan offline a la vez, cada una con su propio snapshot.

## Fases

### ✅ Fase 0 — Backend: idempotencia — HECHA (mig.309/310, 2026-08-05)

**mig.309 (`crear_venta_idempotencia_offline`)**
- `comprobantes` gana columna `client_uuid uuid` + índice único parcial `(empresa_id, client_uuid) WHERE client_uuid IS NOT NULL`.
- `crear_venta`: `DROP FUNCTION` (firma exacta de mig.287) + `CREATE FUNCTION` con `p_client_uuid uuid DEFAULT NULL` agregado. Si viene y ya existe una fila con ese `(empresa_id, client_uuid)`, `pg_advisory_xact_lock` + `SELECT` y `RETURN` inmediato con los mismos campos que antes + `duplicate: true`, **sin tocar stock de nuevo**. Sin `client_uuid` (NULL), comportamiento idéntico al de siempre — cero regresión para el ERP/otros callers.
- `REVOKE ALL FROM PUBLIC` + `GRANT authenticated` explícito (una función nueva le da EXECUTE a PUBLIC por defecto si no se revoca).

**mig.310 (`apertura_caja_offline`)**
- `caja_sesiones` gana columna `client_uuid uuid` + índice único parcial.
- Nueva RPC `abrir_caja_sesion(p_empresa_id, p_caja_id, p_user_id, p_monto_inicial, p_apertura_fecha, p_client_uuid)`: `client_uuid` repetido → `duplicate: true`; choque contra `uq_caja_sesion_abierta` (ganó otra apertura, online u offline) → `conflict: true` + los datos de la sesión que quedó abierta, en vez de dejar pasar el error crudo de Postgres al frontend.

**Probado en vivo contra producción (Nalux), vía fetch con JWT real:**
- `crear_venta` con `client_uuid` dos veces → 1ra `duplicate:false` (crea la venta), 2da `duplicate:true` (mismo `comprobante_id`) — verificado en la base: 1 sola fila en `comprobantes`/`movimientos_caja`/`movimientos_inventario`, stock descontado una sola vez.
- `abrir_caja_sesion`: apertura normal → reintento con mismo `client_uuid` (`duplicate:true`, mismo `sesion_id`) → apertura con `client_uuid` distinto mientras la primera sigue abierta (simula 2 dispositivos) → `conflict:true` con los datos de la sesión que ganó, sin error crudo.
- Todo revertido después: 0 comprobantes con `client_uuid` remanentes, stock y numeración devueltos a como estaban.

### Fase 1 — PWA instalable + detección de conectividad (cero riesgo de datos) — SIGUE

- Nuevo: `src/hooks/useOnlineStatus.js` (`navigator.onLine` + listeners + ping activo liviano, porque `navigator.onLine` da falsos positivos con wifi conectado sin salida real a internet).
- Nuevo: `src/components/shared/ConnectivityBanner.jsx`.
- Modificar: `vite.config.js` (agregar `vite-plugin-pwa`), `package.json`, `index.html` (meta theme-color, apple-touch-icon), `src/main.jsx` (registrar SW vía `virtual:pwa-register`; decidir `autoUpdate` vs `prompt` con cuidado de no actualizar el SW a mitad de una venta).
- Nuevo: íconos en `public/` (192/512/maskable) desde `public/kairox-logo.png`.

**Verificación:** Lighthouse PWA installability en verde; instalar la PWA real desde Chrome; `DevTools → Application → Service Workers` activo; probar contra el dominio real de Hostinger Horizons, no solo local.

### Fase 2 — Snapshot local read-only (Dexie)

- Nuevo: `src/lib/offlineDb.js` (Dexie, stores: `productos`, `clientes`, `formasPago`, `centrosCosto`, `empresaMeta`).
- Nuevo: `src/hooks/useProductosSnapshot.js`.
- Modificar: `PanelProductos.jsx` (usar el snapshot + redirigir también la búsqueda por código de barras al snapshot), `ModoCajaLayout.jsx` (logo/empresa/formasPago vía snapshot), `PanelCarrito.jsx` (clientes/centros de costo vía snapshot).

**Verificación:** poblar Dexie online, ir offline y recargar (simula abrir la PWA ya sin conexión desde el arranque, no solo perder conexión a mitad de sesión) — buscar por nombre/SKU/código de barras debe seguir andando con el último snapshot.

### Fase 3 — Cola de ventas offline + motor de sincronización

- Nuevo: `src/hooks/useVentaOfflineQueue.js`, `src/hooks/useSyncEngine.js`, `src/components/caja/SyncStatusPanel.jsx`, `src/components/caja/SyncConflictModal.jsx`.
- Extender `offlineDb.js` con stores `ventasPendientes` y `cajaSesionesPendientes`.
- Modificar: `useConfirmarVenta.js` (branch offline para Efectivo/Transferencia: encolar en vez de llamar `obtener_proximo_numero`/`crear_venta`, con `p_client_uuid`), `PanelCarrito.jsx` (deshabilitar Tarjeta/CC/QR offline con tooltip, dejar Efectivo/Transferencia activos, sin romper `Alt+1..4`), `CajaContext.jsx` (usar `abrir_caja_sesion` — mig.310 — online, encolar offline; bloquear `closeSession` si hay cola pendiente), `useArqueoCaja.js` (sumar efectivo+transferencia pendientes de sync como línea aparte, no mezclada con el esperado), `TicketPrint.jsx` (estado "PROVISORIO"), `ModoCajaLayout.jsx` (montar `SyncStatusPanel`, banner "Ofertas no disponibles sin conexión").

**Verificación (la más exigente):**
1. Carrera de stock con 2 pestañas offline vendiendo el mismo último ítem → una sincroniza, la otra cae en conflicto manejado (no error crudo de Postgres).
2. Reconexión intermitente (offline/online alternado a mitad de sync) → sin duplicados, el motor no se traba.
3. Cierre de caja con cola no vacía → bloqueado/advertido.
4. Apertura de caja offline desde el arranque del turno → sesión y ventas correctamente enlazadas al sincronizar.
5. JWT viejo: offline 1+ hora, reconectar, primer RPC de sync sin pedir re-login.
6. Simular "sin internet" en capas: `DevTools Network→Offline` para el caso simple; desconectar el adaptador de red real del equipo de pruebas para descartar falsos negativos de `navigator.onLine`; throttling con latencia alta + pérdida de paquetes para reconexión intermitente.
7. `npx eslint` y `npx vite build` en 0 errores en cada fase, como siempre.

## Archivos críticos

- `src/hooks/useConfirmarVenta.js`
- `src/contexts/CajaContext.jsx`
- `src/components/caja/PanelCarrito.jsx`
- `src/components/caja/PanelProductos.jsx`
- `src/components/caja/ModoCajaLayout.jsx`
- `src/hooks/useArqueoCaja.js`
- `supabase/migrations/309_crear_venta_idempotencia_offline.sql` (firma actual de `crear_venta`, ya con `p_client_uuid`)
- `supabase/migrations/310_apertura_caja_offline.sql` (`abrir_caja_sesion`)
- `supabase/migrations/245_idempotencia_movimientos_bancarios_externo.sql` (patrón de idempotencia original, ya adaptado en mig.309/310)

## Nota sobre el orden de aprobación

Este plan cubre las 4 fases completas para que quede el mapa entero, pero **la idea es construir de a una fase**, verificando cada una antes de pasar a la siguiente — mismo criterio que el resto del proyecto (migraciones chicas, probadas en sandbox antes de aplicar). No arrancar la Fase 2 hasta cerrar y confirmar la Fase 1, y así sucesivamente.
