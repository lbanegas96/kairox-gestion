# AUDITORÍA GENERAL DE KAIROX — 24/09/2026

**Alcance:** contabilidad, seguridad, errores y fallos, vacíos funcionales, madurez y robustez.
**Método:** solo lectura, no se modificó nada. Se revisó: el catálogo de la base (políticas, permisos, funciones, triggers, tareas programadas), consultas de integridad sobre los datos reales de Nalux, el código de las 30 funciones de servidor, el repositorio completo (secretos, dependencias), la suite de pruebas y los registros de Supabase de las últimas 24 h.
**Versión analizada:** `master` @ `5865e15` · proyecto Supabase `isvkelrdxwvkfmrfqxxk` (Postgres 17, **plan Free**) · 7 empresas, 2 usuarios (ambos admin).
**Convenciones:** esfuerzo Bajo = menos de medio día · Medio = 1 a 2 días · Alto = más de 3 días. "Necesita OK" = toca producción (migración, borrar una función, cambiar de plan) y no se aplica sin confirmación explícita.

> ## ✅ Actualización 24/09 (noche): la Tanda 1 está APLICADA en producción
> Con el OK explícito de Luciano se aplicaron las migraciones **402, 403, 404 y 405** y se reemplazó la función de ARCA
> de un solo uso. Cada una se probó antes contra la base real dentro de `BEGIN…ROLLBACK` (sin rastro) y se verificó
> después en producción. Resultado: **SEG-1 (crítico, ver corrección de severidad), SEG-2 (neutralizada), SEG-4, CON-4 y
> OPE-2 quedan resueltos**; la base pasó de 254 MB a 53 MB. Quedan marcados abajo con ✅. Al armar los arreglos aparecieron
> **2 hallazgos nuevos** (SEG-12 y SEG-13). Los textos originales de cada hallazgo se conservan como registro.
> **Corrección de severidad de SEG-1:** el informe original lo daba por *latente*. Al reproducirlo (en una transacción
> revertida, con empresas y usuarios inventados) resultó **explotable hoy**: un registro con `{"role":"admin"}` en la
> metadata + un solo UPDATE de `empresa_id` dejaba al atacante como admin de otra empresa, con acceso a sus datos.
> Bastaba conocer el UUID de la empresa, que figura en las URLs públicas de imágenes. No había señales de uso: solo
> existen los 2 usuarios de siempre.

> ## 🛠️ Actualización 25/09: las Tandas 2 y 3 están PREPARADAS y probadas, pero NO aplicadas
> Luciano pidió ir acumulando lo que necesita su OK para ejecutarlo todo junto al final. Se prepararon las **migraciones 406 a 417**,
> el código de las 8 funciones de servidor, los cambios de pantalla, las pruebas y los documentos. Cada migración se probó contra la
> base real dentro de `BEGIN…ROLLBACK` con su prueba de base de datos (212 casos nuevos, sin rastro) y la suite de pantalla queda en
> verde (406 pruebas). **Nada de esto está aplicado en producción, desplegado ni subido a GitHub** (11 commits locales). El orden de
> aplicación y todo lo que necesita a Luciano está en `PENDIENTES_LUCIANO_AUDITORIA.md`.
>
> | Hallazgo | Estado 25/09 | Dónde |
> |---|---|---|
> | SEG-12 permiso de módulo en 15 RPC | 🟡 preparado | mig. 406 |
> | SEG-13 usuario desactivado sin acceso | 🟡 preparado (falta bloquear la cuenta en Auth) | mig. 407 |
> | SEG-14 asientos: cuentas de otra empresa, sin permiso, sin idempotencia (**nuevo**) | 🟡 preparado | mig. 408 |
> | CON-2 «Regenerar asiento» duplicaba | 🟡 preparado; los 8 duplicados esperan la decisión sobre Nalux | mig. 409 + `supabase/datafix/` |
> | CON-3 reversar un asiento | 🟡 preparado (función + botón) | mig. 410 |
> | CON-5 conciliación de cuentas de control | 🟡 preparado (reporte nuevo en Reportes → Contabilidad) | mig. 414 |
> | CON-6 factura de proveedor duplicada | 🟡 preparado; **el «caso existente» era un falso positivo** | mig. 411 |
> | CON-8 estado de pago sin CHECK | 🟡 parcial | mig. 412 |
> | **Nuevo (CON-11):** las compras anuladas figuraban como deuda | 🟡 preparado | mig. 413 |
> | SEG-3 workers sin clave | 🟡 preparado (falta desplegar los 8 workers, después de la migración) | mig. 415 + `_shared/cronAuth.ts` |
> | SEG-6 cabeceras de seguridad | 🟡 preparado (política de contenido en modo solo-reporte) | `vercel.json` |
> | SEG-7 dependencias | 🟡 `xlsx` eliminada; 13 → 7 avisos (quedan jsPDF y react-router, cambios de versión mayor) | `package.json` |
> | OPE-3 monitoreo | 🟡 chequeo de salud con avisos (falta el webhook y Sentry) | mig. 417 + `docs/operacion/MONITOREO.md` |
> | COD-1 CI en rojo | 🟡 arreglado en el repositorio (falta subirlo y ver la CI) | commits locales |
> | COD-3 higiene de migraciones | 🟡 corregido, con correcciones al hallazgo (ver abajo) | mig. 416, 297, 318/325/328 |
> | OPE-4 legales | 🟡 borradores | `docs/legal/` |
> | COD-2 staging | 🟡 receta escrita; falta crear el proyecto | `docs/operacion/STAGING.md` |
>
> **Hallazgos nuevos del 25/09:** **SEG-14** y **CON-11** (arriba), **SEG-15** (el repositorio de GitHub es **público**: ver más abajo),
> **OPE-6** (registro de auditoría inflado) y la causa exacta del rojo de la CI de base de datos (COD-1/COD-3: recrear la base desde cero
> falla en la migración 297, y tres arreglos guardados como `318b`/`325b`/`328b` los ignora el CLI de Supabase).

---

## 1. Veredicto

La base del sistema es sólida: **los asientos cuadran al 100 %, el aislamiento entre empresas está bien resuelto y no hay secretos en el repositorio ni en su historial.** No encontré nada que se esté explotando hoy y los registros de las últimas 24 h no tienen errores de aplicación.

Aun así, **no lo llamaría "listo para operar con clientes reales"** todavía. Hay 4 cosas concretas, baratas de cerrar, que conviene resolver antes de cargar usuarios y datos reales:

1. **No hay copias de seguridad** (plan Free) y la base tenía un **reloj corriendo**: el historial de tareas programadas ocupaba 201 MB de 254 MB y crecía 5–6 MB por día; al llegar a 500 MB (≈ principios de noviembre) la base pasaba a solo lectura y el POS dejaba de registrar ventas. **✅ El reloj está resuelto (mig. 402: la base bajó a 53 MB y se purga sola); los backups siguen pendientes.**
2. **Cualquier persona que se registrara podía quedar como admin de otra empresa** conociendo su UUID (ver la corrección de severidad arriba). **✅ Resuelto (mig. 403).**
3. **Sigue publicada una función de ARCA sin autenticación** que era de un solo uso. **✅ Neutralizada (responde 401 sin credenciales; queda borrarla del panel).**
4. **Los libros de Nalux tienen historial de prueba con inconsistencias** (17 notas de crédito sin asiento, 8 asientos duplicados, cuentas de control que no concilian). Para operar en real conviene arrancar con libros limpios. **Pendiente (Tanda 2).**

| Área | Estado | En una línea |
|---|---|---|
| Aislamiento entre empresas | 🟢 | 91 de 91 tablas con RLS, 279 políticas, sin fugas entre empresas |
| Permisos dentro de una empresa | 🟡 | SEG-1 ✅ resuelto. Quedan 15 RPC sin permiso de módulo (SEG-12) y el usuario desactivado sigue leyendo (SEG-13); arreglos preparados, sin aplicar |
| Funciones de servidor (Edge) | 🟡 | La función abierta de ARCA ✅ neutralizada (falta borrarla); 8 workers sin clave (SEG-3, arreglo preparado) |
| Motor contable | 🟢 | 355 asientos, 0 desbalanceados, 912 líneas sin anomalías |
| Datos contables de Nalux | 🟡 | Historial de prueba con inconsistencias y sin reporte de conciliación |
| Impuestos y ARCA | 🟡 | Todo en homologación; Libro IVA sin validar contra el Portal |
| Código, pruebas y proceso | 🟡 | CI en rojo hace 3 semanas, no frena el deploy, sin staging |
| Operación y respaldo | 🔴 | Sin backups y sin monitoreo. El reloj de 500 MB ✅ resuelto (base en 53 MB) |

---

## 2. Hallazgos

### 2.1 Seguridad

**SEG-1 · CRÍTICO (originalmente informado como ALTO/latente) · ✅ RESUELTO (mig. 403, 24/09) · Cualquier registro podía quedar como admin de otra empresa.**
Dos huecos que combinados lo permitían: (a) `handle_new_user` tomaba el rol de `raw_user_meta_data->>'role'`, un dato que manda el cliente en el `signUp` (un registro con `{"role":"admin"}` nacía como admin, sin empresa); (b) la política de UPDATE de `profiles` deja a cada usuario actualizar su propia fila y el único freno era un trigger que protege solo la columna `role`: quedaban libres `empresa_id`, `tenant_id`, `permissions`, `active` y `modo_caja`. Con eso: (1) **un registro nuevo podía apuntar su ficha a otra empresa y quedar como su admin** (basta conocer el UUID, que aparece en las URLs públicas de imágenes de productos y logos; el de Nalux tiene 12 imágenes + 1 logo en buckets públicos); (2) un empleado se otorgaba permisos de cualquier módulo; (3) un empleado desactivado se reactivaba solo.
*Evidencia:* `profiles_update` (USING `id = auth.uid()`; WITH CHECK solo exige `role` sin cambios), `has_column_privilege('authenticated', …, 'UPDATE')` verdadero en todas las columnas, `trg_protect_profile_role` (solo `UPDATE OF role`). **Reproducido de punta a punta** en una transacción revertida con datos inventados: tras el signUp con metadata admin el perfil quedaba `rol=admin | empresa=NULL`; con un UPDATE de `empresa_id` pasaba a `get_my_empresa_id() = <víctima>` e `is_admin() = true`, y leía los clientes de la víctima (0 antes, 1 después). Sin señales de uso: solo existen los 2 usuarios de siempre.
*Arreglo aplicado (mig. 403):* (1) `handle_new_user` fuerza `role='staff'` (solo `create_tenant`, en el servidor, hace admin al fundador); (2) trigger `trg_proteger_profiles`: si el pedido llega con el rol `authenticated`/`anon` nadie cambia `id`, `empresa_id` ni `tenant_id`, y solo el admin de la misma empresa cambia `role`, `permissions`, `active`, `modo_caja`, `email`; un usuario común solo toca nombre, apellido y `last_login_at`. `service_role`, `create_tenant`, migraciones y seeds no se ven afectados (se detecta por `current_user`, no por `auth.uid()`, porque dentro de una función SECURITY DEFINER el rol efectivo es el del dueño).
*Verificación:* pgTAP `profiles_blindaje.test.sql` (20 casos, todos ok) corrido contra la base real dentro de `BEGIN…ROLLBACK`; y el ataque, repetido en producción tras aplicar, queda bloqueado (`No autorizado: no se puede cambiar la empresa de un usuario desde el navegador`) y Luciano (admin real) sigue actualizando su ficha.

**SEG-2 · ALTO (fácil de cerrar) · ✅ NEUTRALIZADA (24/09; falta borrarla del panel) · Función `arca-corregir-nc-historica` publicada y sin autenticación.**
> *Aplicado:* la función se reemplazó por un stub que responde 410 y se redesplegó con `verify_jwt=true` (versión 2). Antes, un GET sin credenciales respondía `405 Method not allowed` (llegaba al código); ahora el gateway responde `401` a GET y POST sin credenciales. El stub quedó en el repo (`supabase/functions/arca-corregir-nc-historica/index.ts`, mismo contenido que el desplegado). **Pendiente (30 s):** borrarla desde el panel de Supabase (Edge Functions → arca-corregir-nc-historica → Delete), y con ella `create-user` y `emitir-cae`; después borrar el stub del repo.
Era una herramienta de un solo uso (21/08) que el propio código pide borrar. Sigue desplegada con `verify_jwt=false`, usa `service_role`, lee el certificado y la clave privada de ARCA desde el Vault y puede emitir una NC ante ARCA para cualquier `comprobante_id` que le pasen. Exige un UUID válido de una NC con CAE, así que hoy la explotación es difícil y apunta a homologación; pero toma el ambiente de `AFIP_ENVIRONMENT`, o sea que **el día que se pase ARCA a producción emitiría notas de crédito reales ante ARCA** a quien la llame. No está en el repositorio (el chequeo de drift la marcaría).
*Arreglo:* borrarla desde el panel de Supabase o con `supabase functions delete arca-corregir-nc-historica`. También conviene borrar `create-user` (no se usa; el frontend invita con `invite-user`, y `create-user` chocaría con el trigger `handle_new_user`) y `emitir-cae` (stub 410). Esfuerzo Bajo. **Necesita OK.**

**SEG-3 · MEDIO · Los workers del cron se pueden invocar desde internet sin clave.**
`arca-worker`, `mp-qr-poller`, `mp-sync-worker`, `mercadolibre-stock-worker`, `mercadolibre-catalogo-publicar`, `tiendanube-stock-worker` y `tiendanube-catalogo-publicar` tienen `verify_jwt=false` y ninguna verificación propia; `tc-diario-sync` sí exige un JWT, pero el cron le manda la clave anónima, que es pública y sirve para llamarla desde cualquier lado. No permiten inyectar datos (solo procesan colas), pero cualquiera puede llamarlos en bucle y forzar llamadas a ARCA, Mercado Pago, Tiendanube o MercadoLibre (bloqueos por exceso de pedidos, consumo del cupo de invocaciones).
*Arreglo:* un secreto compartido (`CRON_SECRET`) en un header que cada worker valida y que los 8 jobs del cron envían. Esfuerzo Medio. **Necesita OK** (redeploy de funciones y cambio de los cron jobs).

> *Preparado (25/09), sin aplicar:* la mig. 415 crea el secreto `cron_secret` en el Vault (64 caracteres al azar generados dentro de la base: no viaja por ningún chat ni archivo), la función `verificar_cron_secret` (solo `service_role`) y hace que los 8 jobs manden el header `x-cron-secret`; `_shared/cronAuth.ts` y el arranque de cada worker lo verifican. `arca-worker` y los dos `*-catalogo-publicar` aceptan además la sesión de un usuario real (los dispara el navegador; la clave anónima, que es pública, no sirve); `mp-qr-poller` lleva la verificación inline. pgTAP `secreto_compartido_workers.test.sql` (10 casos; probado también ejecutando cada comando de cron modificado). **Orden al ponerlo en producción: primero la migración y después desplegar los 8 workers** (al revés, rechazarían al cron).

**SEG-4 · MEDIO · ✅ RESUELTO (mig. 404, 24/09) · `ajustar_precios_masivo_catalogo`: abierta al público y sin permiso por módulo.**
> *Aplicado:* las dos funciones de ajuste masivo (`ajustar_precios_masivo_catalogo` y su gemela `ajustar_precios_masivo`, de listas de precios) exigen ahora sesión con empresa y el permiso de módulo (`productos` y `clientes` respectivamente, los mismos que exige el RLS de las tablas que tocan); se revocó `EXECUTE` a PUBLIC/anon. Cuerpo idéntico al original salvo los chequeos (verificado por hash del cuerpo normalizado). pgTAP `ajuste_masivo_precios_permiso.test.sql` (13 casos, ok). Ya no queda ninguna función SECURITY DEFINER abierta a `anon`.
Es la única función SECURITY DEFINER ejecutable por `anon` (tiene `EXECUTE` para PUBLIC). Sin sesión no hace nada porque `get_my_empresa_id()` devuelve NULL, pero rompe la regla del proyecto (REVOKE FROM PUBLIC) y no chequea `has_module_permission`: cualquier usuario de la empresa puede cambiar todos los precios llamándola por API.
*Arreglo:* `REVOKE EXECUTE … FROM PUBLIC, anon` + chequeo del permiso del módulo. Esfuerzo Bajo. **Necesita OK (migración).**

**SEG-5 · MEDIO · Registro público abierto.**
El sistema ofrece `signUp` y `create_tenant` a cualquier visitante, sin CAPTCHA. 5 de las 7 empresas no tienen ningún usuario. En plan Free, cuentas basura consumen el cupo (base de 500 MB, correos). *No pude leer la configuración real de Auth desde acá:* hay que verificar en el panel si la confirmación de correo está activa (en el `config.toml` local está apagada).
*Arreglo:* confirmación de correo + CAPTCHA (Turnstile/hCaptcha), o cerrar el registro y operar por invitación hasta el lanzamiento comercial. Esfuerzo Bajo–Medio.

**SEG-6 · MEDIO · Cabeceras de seguridad incompletas.**
`vercel.json` solo envía `X-Content-Type-Options`, `X-Frame-Options` y `X-XSS-Protection` (este último está obsoleto). Faltan `Content-Security-Policy`, `Referrer-Policy` y `Permissions-Policy`, que el `CLAUDE.md` del proyecto exige. La CSP hay que introducirla primero en modo "report-only" para no romper nada (Supabase, Google Fonts, MercadoPago).

> *Preparado (25/09), sin subir:* `vercel.json` suma `Referrer-Policy`, `Permissions-Policy` (deja la cámara para el escáner del POS y cierra micrófono, ubicación, pagos y USB) y `Strict-Transport-Security`, y apaga la `X-XSS-Protection` obsoleta. La política de contenido va como `Content-Security-Policy-Report-Only`: **no bloquea nada todavía**; se pasa a modo bloqueo a propósito después de navegar la app con la consola abierta y confirmar que no reporta violaciones. Prueba `vercelHeaders.test.js`.

**SEG-7 · MEDIO · Dependencias con vulnerabilidades conocidas (13; 1 crítica, 4 altas, 7 moderadas, 1 baja; solo dependencias de producción).**
En el navegador el riesgo práctico es bajo (la "crítica" de `jspdf` afecta al build de Node y a entradas hostiles), pero conviene ordenarlo: `jspdf` 2.5.2 → 3.x, `xlsx` 0.18.5 (prototype pollution y ReDoS, sin parche en npm: migrar a `exceljs`, que ya es dependencia), `react-router-dom` (open redirect), `dompurify`, `nanoid`, `brace-expansion`. Esfuerzo Medio (`jspdf` cambia de versión mayor).

> *Preparado (25/09):* `xlsx` (SheetJS, sin parche) se sacó: `exportToExcel` y `exportReporte` escriben ahora con `exceljs` (ya era dependencia, carga diferida; verificado con el build real de producción: no queda SheetJS en ningún chunk) y son asíncronas (los 8 lugares que las llaman ya hacen `await` y avisan si falla). `npm audit` de producción: **de 13 a 7 avisos** (1 crítico, 1 alto, 5 moderados). Lo que queda: `jspdf` 2.5.2 → 4.x (el crítico; afecta al build de Node, en el navegador el riesgo práctico es bajo), `jspdf-autotable` y `dompurify` (dependen de `jspdf`), `react-router-dom` 6 → 7 (open redirect) y un aviso de `uuid` dentro de `exceljs` que no aplica (se usa `v4` sin buffer). Los tres primeros son cambios de versión mayor que exigen revisar a ojo todos los PDF del sistema: quedan para Luciano/Nadia.

**SEG-8 · BAJO · La lectura está abierta a todo el equipo.**
Los permisos por módulo solo limitan escribir en varias tablas. Cualquier usuario de la empresa puede *leer* `asientos_contables`, `movimientos_bancarios`, `cuentas_bancarias` (CBU/alias), `caja_sesiones`, `productos` (con el costo de compra) y `audit_log`. Contrasta con `compras`, `cheques`, `plan_cuentas` y `extractos_bancarios`, que sí exigen permiso de módulo. Alinear cuando haya empleados.

> *Decisión pendiente (25/09):* con 2 usuarios, ambos admin, no hay riesgo hoy. Pasar la lectura a «por módulo» toca las políticas SELECT de 6 tablas y puede romper pantallas legítimas (por ejemplo, un cajero que necesita ver el costo): conviene hacerlo el día que haya empleados, con una lista escrita de qué rol ve qué. No se toca ahora.

**SEG-9 · BAJO · El admin de cada empresa puede activarse módulos "premium" por su cuenta.**
`empresas_update` deja a cualquier admin modificar `usa_ajuste_inflacion`, `usa_impuestos_avanzados`, `usa_ecommerce`, `afip_ambiente`, etc. Si esos módulos se van a vender, el interruptor debe vivir del lado servidor. También `empresas.afip_ticket_acceso` (token de WSAA) es legible por cualquier usuario de la empresa; verificar si se sigue usando.

> *Decisión pendiente (25/09):* si esos módulos se van a vender, el interruptor debe pasar al servidor (un trigger que solo deje cambiar esos campos a `service_role`); hoy la pantalla de Configuración los cambia directo y el ajuste por inflación se activa así. Primero hay que decidir el modelo comercial (qué módulos, quién los habilita).

**SEG-10 · BAJO · Detalles.** `audit_log` deja insertar filas a los usuarios (solo a su nombre): se puede ensuciar/inflar. Las firmas HMAC de webhooks se comparan con `===` (no en tiempo constante). El `config.toml` local dice contraseña mínima de 6 y `create-user` exige 12; la protección contra contraseñas filtradas requiere plan Pro. `invite-user` arma el `redirectTo` con el header `Origin` del pedido (mitigado por la lista de URLs permitidas de Auth y porque solo lo llama un admin). `mp-webhook` sigue rechazando con 401 las notificaciones reales de MP (conocido; el poller cubre).

**SEG-11 · INFO · Los avisos del panel de Supabase están viejos.** El análisis de seguridad cacheado es del **01/09** (`observed_at`): muestra una vista `SECURITY DEFINER` y 4 funciones abiertas a `anon` que ya se corrigieron (queda solo la de SEG-4). No usar el advisor como estado actual sin mirar la fecha de observación.

**SEG-12 · MEDIO (nuevo, 24/09; corregido a QUINCE RPC el 25/09) · Quince RPC sensibles no chequean el permiso de módulo.**
Al recorrer las funciones SECURITY DEFINER que escriben datos y no llaman a `has_module_permission` ni `is_admin` aparecieron, además de las de precios (ya corregidas): `actualizar_cotizacion`, `actualizar_pedido`, `ajustar_stock_manual`, `aplicar_compra_producto`, `confirmar_recuento_inventario`, `crear_recuento_inventario`, `crear_revalorizacion_inventario`, `programar_precio_futuro` y `recalcular_precios_lista_factor`. Como saltean el RLS, un usuario de la empresa sin el módulo puede ejecutarlas por API (ajustar stock y costos, crear/confirmar recuentos y revalorizaciones que generan asientos, editar cotizaciones y pedidos). Sin empleados hoy no se nota; con empleados es una brecha de permisos. Además `seed_maestros_default`, `seed_series_numeracion` y `obtener_proximo_numero` solo validan la empresa (inocuas, idempotentes).
*Arreglo:* agregar el chequeo del módulo correspondiente (`productos`, `ventas`, `pedidos`, `clientes`, `configuracion` según el caso) con el mismo método de la mig. 404 (cuerpo idéntico + chequeo, verificado por hash), más un test pgTAP por función. Esfuerzo Medio. **Necesita OK (migración).**

> *Corrección y preparado (25/09):* al armar el arreglo la lista creció: no son 9 sino **15** las RPC que escriben y no chequeaban el permiso (a las 9 se suman `anular_recuento_inventario`, `confirmar_revalorizacion_inventario`, `anular_revalorizacion_inventario`, `set_asiento_recuento_inventario`, `set_asiento_revalorizacion_inventario` y `cancelar_precio_programado`). La mig. 406 agrega el chequeo del módulo que corresponde a cada una (el mismo desde el que se usa en pantalla y que ya exige el RLS de las tablas que toca) leyendo la definición vigente con `pg_get_functiondef` e insertando el chequeo: el resto del cuerpo queda idéntico. Ninguna es llamada por otra función de la base. pgTAP `permiso_modulo_rpc_sensibles.test.sql`.

**SEG-13 · MEDIO (nuevo, 24/09) · Desactivar un usuario no le corta la lectura.**
`get_my_empresa_id()` no mira `profiles.active`. Un usuario desactivado conserva su empresa: **confirmado con una prueba** (usuario `active=false` en una empresa inventada): `get_my_empresa_id()` devuelve su empresa y sigue leyendo las tablas de lectura abierta (productos con su costo de compra; por política también asientos, movimientos y cuentas bancarias, ver SEG-8); solo `has_module_permission` e `is_admin` le dan falso. Su sesión además sigue vigente hasta que venza el token: Auth no sabe de `active`. El botón «Desactivar» del panel de Usuarios corta escribir en módulos pero no leer.
*Arreglo:* que `get_my_empresa_id()` y `get_my_role()` devuelvan NULL si el perfil está inactivo (un cambio de una línea con efecto en todo el RLS: probar contra la suite completa de pgTAP), y bloquear la cuenta en Auth al desactivar (hoy solo `delete-user` la elimina). Esfuerzo Bajo–Medio. **Necesita OK (migración).**

> *Preparado (25/09):* mig. 407 — `get_my_empresa_id()` devuelve NULL si el perfil está inactivo (definición idéntica salvo `AND active`); el usuario inactivo sigue leyendo su propia fila de `profiles`, que es lo que usa la app para mostrar «Cuenta inactiva» y cerrar la sesión. pgTAP `usuario_inactivo_sin_acceso.test.sql`. **Falta (Tanda 4):** bloquear también la cuenta en Auth al desactivar (hoy solo `delete-user` la elimina) y correr la suite completa de pgTAP en la CI, porque el cambio toca todo el RLS.

**SEG-14 · MEDIO (nuevo, 25/09) · `crear_asiento_automatico` aceptaba cuentas de otra empresa, no pedía permiso y no era idempotente.**
La mig. 314 cerró la escritura directa sobre `asientos_contables`/`asientos_items`, pero `crear_asiento_automatico` (que crea el asiento ya CONFIRMADO) solo validaba que `p_empresa_id` fuera la del usuario: (1) **no chequeaba que las cuentas de las líneas fueran de esa empresa**: con el UUID de una cuenta ajena se asentaban líneas contra ella y el trigger recalculaba el `saldo_actual` de la cuenta AJENA (escritura entre empresas); (2) **no exigía ningún permiso**: cualquier usuario con sesión podía asentar cualquier tipo de asiento confirmado (mover plata entre Caja y Ventas, por ejemplo); (3) **no era idempotente**: un reintento o dos caminos de código para el mismo documento lo duplicaban (así nacieron los duplicados de compras que reversó la mig. 397 y los de CON-2/CON-3). `crear_asiento_manual` tenía el mismo hueco de cuentas. Explotarlo exige una sesión y el UUID de una cuenta ajena (que no es público), por eso MEDIO.
*Preparado (mig. 408, sin aplicar):* las cuentas se validan contra la empresa del asiento; se exige el permiso de módulo que corresponde al TIPO de asiento (mapa `modulos_para_origen_asiento`); y para los tipos que se asientan una sola vez por documento (venta, compra, NC/ND de cliente y de proveedor, devoluciones, recuentos, revalorizaciones, movimiento de caja) devuelve el asiento existente en vez de crear otro, con un candado por documento; índice `idx_asientos_origen`. pgTAP `asientos_automaticos_seguros.test.sql` (24 casos).

**SEG-15 · MEDIO (nuevo, 25/09) · El repositorio de GitHub es PÚBLICO.**
`lbanegas96/kairox-gestion` responde 200 sin credenciales (creado el 11/05/2026; 0 forks, 0 estrellas, sin licencia). No lo había podido ver antes (no hay `gh` instalado; salió al leer la CI por la API pública). Consecuencias: (1) **el código completo del producto es legible y copiable por cualquiera**; (2) cualquiera que quiera atacar el sistema puede leer cada política RLS, cada función SECURITY DEFINER y cada migración, incluidas las que describen los huecos de esta auditoría; (3) **este mismo informe está publicado** (desde el commit `122b89c`) con hallazgos que siguen abiertos; (4) hay datos del equipo en archivos versionados: correos personales y de prueba (`CONTEXT.md`, `COLABORADOR.md`, `URL.txt`, `AUDITORIA_VISUAL_2026-07-13.md`) y un CUIT que parece de persona humana (en `CAEA_IMPLEMENTACION.md` y `CONTEXT.md`). Lo bueno: **no hay secretos** (claves, tokens, certificados) en el código ni en el historial —viven en el Vault y en variables de entorno— y el secreto compartido de los workers (SEG-3) se genera adentro de la base, así que publicar el código no lo compromete.
*Por qué importa ahora:* mientras la Tanda 2 no esté aplicada, quien lea el informe sabe qué RPC no validan permisos. Con 2 usuarios (ambos admin) y datos de prueba el riesgo real es bajo, pero **cada `git push` de un documento de seguridad publica el estado de las defensas**.
*Arreglo:* (a) hacer el repositorio privado (GitHub → Settings → Danger zone → Change visibility; 30 segundos; Vercel y las Actions siguen funcionando; una vez privado la CI ya no se puede leer sin credenciales, conviene instalar `gh`); o (b) si tiene que seguir público a propósito, sacar del repositorio los informes y planes que describen debilidades, `docs/operacion` y los datos personales, y asumir que lo ya publicado no se puede retirar. **Decisión de Luciano; se recomienda (a) antes del próximo push.**

### 2.2 Contabilidad

**CON-1 · ALTO para arrancar en serio · 17 notas de crédito históricas sin asiento contable ($ 1.133.194,52).**
13 pagadas ($ 973.114,52) y 4 pendientes ($ 160.080,00), fechadas entre el 13/06 y el 30/07, incluidas 5 con CAE de homologación. Desde el 18/08 todas las NC tienen asiento. Efecto: el mayor de Nalux sobrestima Ventas, Cuentas a Cobrar/Caja e IVA Débito Fiscal.
*Arreglo:* (a) arrancar la operación real en una empresa nueva y limpia, dejando Nalux como entorno de pruebas (recomendado), o (b) reconstruir esos asientos (no existe un `regenerar_asiento_nc`).

**CON-2 · MEDIO · 7 asientos duplicados por "Regenerar asiento".**
`regenerar_asiento_cxc` y `regenerar_asiento_cxp` solo verifican `asiento_id` (el vínculo). Si el asiento original existía pero no estaba vinculado al movimiento, crean uno segundo. Pasó con 3 cobros ($ 66.332: AS-000131/182, 141/183, 159/185) y 4 pagos ($ 48.415: AS-000132/188, 142/189, 160/190, 164/191), todos del 06–08/07. Los dos asientos de cada par están confirmados. Efecto: Caja y Cuentas a Cobrar/Pagar mal por ese importe.
*Arreglo:* que las funciones busquen antes un asiento confirmado con `origen = 'cobro_cliente'/'pago_proveedor'` y `origen_id = p_movimiento_id`; reversar los 7 duplicados. **Necesita OK.**

> *Preparado (25/09), sin aplicar:* mig. 409 — `regenerar_asiento_cxc/cxp` buscan primero un asiento confirmado del mismo cobro/pago y lo **reconectan** en vez de crear otro; `regenerar_asiento_cxc` además rechaza cobros cancelados. Los **8** duplicados (los 7 de acá más AS-000318/319 de CON-3) se corrigen con un contra-asiento —no con un borrado— usando `supabase/datafix/2026-09-24_reversar_8_asientos_duplicados.sql`, que verifica cada caso antes de actuar. **Espera la decisión «empresa limpia vs regularizar Nalux» (CON-1).**

**CON-3 · MEDIO · 1 doble asiento de compra sin reversar ($ 550.000,66).**
La mig. 397 reversó 3 de las 4 duplicaciones de "factura por OC" (AS-000321, 323, 325). Quedó **AS-000318 / AS-000319** (Amazon, factura 889998899888, OC-22124): ambos confirmados, por $ 550.000,66. Sobrestima Mercaderías ($ 454.546), IVA Crédito Fiscal ($ 95.454,66) y Cuentas a Pagar. **Necesita OK** para el asiento de reversa.

> *Preparado (25/09), sin aplicar:* mig. 410 — `reversar_asiento(p_asiento_id, p_motivo)` (solo admin, motivo de al menos 5 caracteres, contra-asiento con origen `reversa_asiento`; se niega si el asiento pertenece a un documento) + botón «Reversar» en Plan de Cuentas → Asientos. pgTAP `reversar_asiento.test.sql` (21 casos). AS-000318/319 va en el mismo arreglo de datos que los otros 7.

**CON-4 · MEDIO · ✅ RESUELTO (mig. 405, 24/09) · `confirmar_asiento` no actualiza el saldo de las cuentas.**
> *Aplicado:* trigger `trg_asiento_estado_saldo` (AFTER UPDATE OF estado en `asientos_contables`): cuando un asiento entra o sale de `confirmado` recalcula las cuentas de sus líneas (cubre `confirmar_asiento` y cualquier ruta futura). Recalculo único de todas las cuentas desfasadas: cambió **exactamente una** (Nalux 5.4: $ 130.000 → $ 150.000) y la suma de todos los saldos de Nalux quedó en **0,00**. pgTAP `asiento_estado_saldo.test.sql` (8 casos, ok).
`trg_asiento_item_saldo` recalcula `plan_cuentas.saldo_actual` cuando cambian las *líneas*, y `recalcular_saldo_cuenta` suma solo asientos `confirmado`. Pero confirmar un borrador cambia solo el *estado* del encabezado y nada recalcula. Resultado: un asiento manual confirmado no impacta el saldo que muestra el Plan de Cuentas hasta que otra línea toque esa cuenta. Caso real residual: cuenta 5.4 Gastos de Administración, saldo mostrado $ 130.000 vs $ 150.000 del mayor (AS-000118). La suma de todos los `saldo_actual` da −$ 20.000 en lugar de 0.
*Arreglo:* llamar a `recalcular_saldo_cuenta` desde `confirmar_asiento` (o un trigger sobre el cambio de estado) + recalcular todas las cuentas una vez. Esfuerzo Bajo. **Necesita OK (migración).**

**CON-5 · MEDIO · Las cuentas de control no concilian con los subdiarios y no hay un reporte que lo muestre.**
| Concepto | Mayor | Subdiario | Diferencia |
|---|---|---|---|
| Cuentas a Cobrar (1.1.2) vs saldo de clientes | $ 823.621,00 | $ 314.103,00 (`clientes.saldo_actual`, 7 clientes con saldo) | ≈ $ 509.500 |
| Cuentas a Pagar (2.1.1) | $ 476.274,33 | $ 380.683,33 (`v_saldo_proveedores`) y $ 784.970,33 (`compras_saldo_pendiente`) | tres cifras distintas para lo mismo |
| Mercaderías (1.1.3) vs stock × costo | $ 14.345.475,14 | $ 16.837.070,00; 44 de 75 productos sin costo | ≈ $ 2.491.600 |
| Caja y Bancos (1.1.1) | −$ 5.876.980,39 (negativa) | Caja −$ 5.058.346,73; Bancos +$ 2.817.639,49 | sin apertura de capital |

Parte es dato de prueba (compras por $ 14 M pagadas sin aporte inicial, NC del CON-1, duplicados del CON-2/3, cheques rechazados que debitan Cuentas a Cobrar en el mayor sin reflejarse en la cuenta corriente del cliente). El hallazgo de fondo es que **nada lo detecta**.
*Arreglo:* reporte "Conciliación de cuentas de control" (Clientes, Proveedores, Inventario, Caja/Bancos, IVA: mayor vs subdiario, con diferencia y detalle) y revisarlo en cada cierre. Esfuerzo Medio.

> *Preparado (25/09), sin aplicar:* mig. 414 + reporte nuevo «Conciliación de cuentas de control» (Reportes → Contabilidad): mayor contra subdiario de 6 cuentas y 7 controles de integridad con los casos concretos. Contra los datos reales de Nalux reproduce las cifras de esta auditoría (17 NC sin asiento por $ 1.133.194,52, 4 compras sin asiento por $ 188.935, 8 asientos duplicados) y suma dos hallazgos: 4 movimientos de cuenta corriente sin cliente (−$ 160.080) y una ficha de cliente desactualizada ($ 100). pgTAP `conciliacion_cuentas_control.test.sql` (24 casos) y 12 pruebas de pantalla.

**CON-6 · MEDIO · Las facturas de proveedor se pueden duplicar.**
`compras` solo tiene PK: no hay control de (empresa, proveedor, tipo/letra, punto de venta, número). Un doble tipeo duplica el crédito fiscal y el pago. Hoy hay 1 caso (4 filas con el mismo proveedor y número). *Arreglo:* índice único parcial `WHERE estado_pago <> 'anulada'` (previa limpieza del caso existente) y aviso claro en pantalla.

> *Corrección (25/09):* ese «caso existente» **era un falso positivo**: las 4 filas compartían el valor `S/N` (sin número), que no es un número de factura. No hay duplicados reales hoy. *Preparado:* mig. 411 (índice único parcial: empresa + proveedor + número, solo compras del Libro y no anuladas, que no cuenta el `S/N`) y mensaje claro en pantalla en los 4 caminos que cargan o editan una compra. pgTAP `indice_unico_factura_proveedor.test.sql` (12 casos).

**CON-7 · MEDIO · Circuitos que se arman en el navegador en vez de una sola operación atómica.**
La Factura de Proveedor hace desde el navegador: insertar `compras`, `detalle_compras`, llamar a `aplicar_compra_producto` por ítem, insertar cuenta corriente, insertar movimiento de caja y, al final, el asiento **"no bloqueante"** (si falla, solo `console.warn`). Compra Rápida es igual. Si se corta la conexión a mitad, queda un documento a medio hacer, y el código ya lo reconoce ("la factura quedó registrada pero NO se pudo actualizar el stock"). El daño medido hoy es chico (4 compras sin asiento, todas de jun–jul; 0 cobros o pagos huérfanos) porque los cobros, pagos y ventas ya pasan por RPC. Es el patrón más frágil que queda. *Arreglo:* una RPC atómica por circuito, como ya existe para `crear_venta` y `registrar_factura_compra_oc`. Esfuerzo Medio–Alto.

> *Decisión (25/09): no se construye ahora.* La Factura de Proveedor y la Compra Rápida se arman en el navegador y **acaban de cambiar** (botón Libro / No libro, 24/09) sin que se hayan verificado en pantalla; reescribirlas como RPC atómicas encima de un flujo sin verificar no es algo para hacer sin Luciano delante. Mientras tanto el daño posible queda **visible**: el chequeo de salud (mig. 417) avisa si una venta o compra de los últimos 7 días quedó sin asiento, y el reporte de conciliación lo lista. *Diseño previsto:* una RPC por circuito (`registrar_compra` y `registrar_compra_rapida`) que inserte cabecera, detalle, stock y costo (`aplicar_compra_producto`), cuenta corriente, caja y asiento en **una sola transacción, con el asiento bloqueante** (si falla, se deshace todo), reutilizando la idempotencia de la mig. 408; con pgTAP y un interruptor para volver al flujo actual. Se hace después de verificar esos dos flujos en pantalla.

**CON-8 · BAJO · Calidad de datos.**
`estado_pago` no tiene CHECK y aparecen valores distintos ("pagado" y "pagada"; las vistas comparan contra `'pagada'`). En `movimientos_inventario` existen `entrada` e `ingreso` (dos nombres para lo mismo) y los `ajuste` no guardan signo: el kardex no se puede reconstruir sin ambigüedad (origen de la deriva de stock conocida, 20 de 75 productos). Se aceptan compras con fecha futura (hay una del 25/09, ya "pagada") y pagos con fecha anterior a la factura que cancelan. La caja puede quedar en negativo sin advertencia. `comprobantes.tipo_comprobante_afip` solo acepta A/B/C/E (no M).

> *Preparado (25/09), sin aplicar:* mig. 412 — CHECK de `comprobantes.estado_pago` (pendiente / parcial / pagada / cancelada); las 2 ventas de prueba en «pagado» pasan a «pagada». pgTAP `comprobantes_estado_pago.test.sql` (6 casos). Falta: unificar `entrada`/`ingreso` en `movimientos_inventario` y el signo de los `ajuste` (toca el kardex: conviene hacerlo con el reporte de Kardex a la vista).

**CON-9 · BAJO / producto · No hay circuito de saldos iniciales.**
Un cliente que migra con caja, deudores, proveedores y stock previos no tiene un asistente de asiento de apertura; el alta de stock inicial no genera asiento contra capital. Nalux es el ejemplo: inventario físico valorizado en $ 16,8 M contra $ 14,3 M en el mayor.

**CON-10 · INFO · Nunca se cerró un período.** Nalux tiene solo Junio y Julio creados, ambos abiertos, y no hay períodos para agosto/septiembre. El control de período cerrado está bien implementado pero nunca se ejerció con datos reales.

**CON-11 · MEDIO (nuevo, 25/09) · Las compras anuladas figuraban como deuda pendiente.**
`compras_saldo_pendiente` no excluía `estado_pago = 'anulada'`, así que una compra anulada seguía apareciendo para pagar en Registrar Pago, en la Orden de Pago masiva y en el aging de proveedores. Salió al armar el reporte de conciliación (tres cifras distintas para las cuentas a pagar). *Preparado:* mig. 413 (pgTAP `compras_saldo_pendiente_anuladas.test.sql`, 7 casos).

### 2.3 Impuestos y ARCA

**ARC-1 · MEDIO · Cola de ARCA con 26 comprobantes en error.** ARCA está en homologación a propósito. En `facturas_pendientes_arca` hay 62 emitidas, **21 `error_definitivo`** (16 por el campo `CondicionIVAReceptorId` de julio, 3 por numeración desincronizada, 2 en "estado ambiguo") y **5 `error_datos`**. En `comprobantes` hay 3 ventas sin CAE por error definitivo ($ 149.000, 06/08) y 1 ND con error ($ 5.000, 11/09). Antes de pasar a producción: resolverlas o darlas de baja y arrancar la cola limpia.

**ARC-2 · MEDIO · Libro IVA Digital nunca validado contra el Portal IVA** (sin acceso por ahora) y con vacíos conocidos: percepciones y retenciones de IVA/IIBB en compras (el TXT declara 0), IVA 27 % en compras (CHECK), liquidación y saldo técnico de IVA sin asiento, retenciones sufridas mezcladas en Posición Fiscal, alícuota de IIBB sin cargar, `aplicar_compra_producto` recibe el costo con IVA incluido en compras "Libro" (posible costo inflado), y la edición del N° de factura no actualiza los 3 campos estructurados.

### 2.4 Código, pruebas y proceso

**COD-1 · MEDIO · CI en rojo hace 3 semanas y sin freno al deploy.** Las pruebas de `FormNuevaCotizacion` (3) fallan en `master` desde el 03/09 (la sesión aparte que las está arreglando todavía no llegó a `master`). Vercel publica con cada `git push` sin esperar a la CI. Además Vitest está recogiendo copias en `.claude/worktrees/*` y un spec de Playwright, lo que suma 6 fallos fantasma en la corrida local (889 pasan, 9 fallan; 3 son reales). *No pude ver el estado en GitHub (no hay `gh` instalado).* *Arreglo:* arreglar los 3, excluir `.claude/**` y `loadtest/**` de Vitest, y proteger `master` (PR + checks obligatorios) para que la CI frene el deploy.

> *Actualización (25/09), leída de los registros públicos de GitHub Actions* (se pueden ver sin `gh`): la CI tiene **dos** problemas. (a) *Frontend Tests*: las 3 pruebas de `FormNuevaCotizacion` (`listasPrecio` sin valor por defecto) — **arregladas** — y `.claude/**` y `loadtest/**` quedan fuera de Vitest: ahora son **406 pruebas en 35 archivos, todas en verde** (el «898» de este informe incluía copias fantasma de los worktrees). (b) *pgTAP DB Tests*: **falla desde antes de la auditoría en la migración 297**, que inserta una forma de pago con el `empresa_id` de Nalux escrito a mano y en una base vacía esa empresa no existe — **corregido** con una guarda que no cambia nada en producción. Consecuencia: **ninguna prueba de base de datos corría en la CI**. Además tres arreglos guardados como `318b_`, `325b_` y `328b_` los ignora el CLI de Supabase (solo aplica archivos `<número>_<nombre>.sql`), así que una base recreada quedaba con `anon` ejecutando `actualizar_cotizacion` y con tres sobrecargas de `crear_venta`: se incorporaron a sus archivos. Puede haber más bloqueos después de la 297 que solo se ven al recrear la base de verdad: falta subir y mirar la CI (o abrir Docker Desktop para reproducirlo local). Sigue pendiente proteger `master`.

**COD-2 · MEDIO · Un solo entorno.** Local, vistas previas y producción comparten la misma base. En los registros de esta misma noche se ve un usuario operando desde `http://localhost:3000` contra la base real. Toda prueba toca datos reales. *Arreglo:* un segundo proyecto Supabase Free como staging (permitido: hasta 2 proyectos gratuitos) y variables de entorno por entorno en Vercel.

> *Preparado (25/09):* receta completa en `docs/operacion/STAGING.md` (incluye la trampa de que las tareas de cron creadas por las migraciones apuntan a producción y hay que reapuntarlas). Falta que una persona cree el proyecto en Supabase (5 minutos, gratis).

**COD-3 · BAJO · Higiene.** 3 migraciones aplicadas en producción sin archivo equivalente en el repo (`revoke_execute_anon_defensa_profundidad_fix`, `ajuste_inflacion_fase2_reportes_fix`, `fix_grant_registrar_factura_compra_oc_9params`) y 1 archivo sin aplicar con ese nombre (`349_stock_disponible_vista.sql`; la vista existe en producción); números repetidos (318, 325, 328); `config.toml` con comentario del proyecto viejo; `URL.txt` y `schema.sql` viejos versionados. Recrear la base desde el repo puede no dar lo mismo que producción (ya pasó con `crear_venta` en julio).

> *Corrección (25/09), verificada por contenido y no por nombre:* `revoke_execute_anon_defensa_profundidad_fix` y `ajuste_inflacion_fase2_reportes_fix` **ya están incorporadas** a los archivos 353 y 380 del repositorio (mismo texto, comparado por hash del contenido normalizado), así que no eran una brecha. La única real era `fix_grant_registrar_factura_compra_oc_9params` (el overload de 9 parámetros de `registrar_factura_compra_oc` nacía abierto a `anon` al recrear la base): **mig. 416**, espejo de lo que producción ya tiene. `349_stock_disponible_vista.sql` sí existe y su vista es idéntica a la de producción. Los «números repetidos (318, 325, 328)» eran los archivos `318b/325b/328b` que el CLI ignoraba (ver COD-1): ya están incorporados y no queda ningún archivo que el CLI ignore. Siguen pendientes el comentario del proyecto viejo en `config.toml` y los archivos viejos `URL.txt` y `schema.sql`.

**COD-4 · INFO · Rendimiento.** 54 claves foráneas sin índice, 63 índices sin uso y 1 política RLS sin `(select auth.uid())` (`audit_log_insert_propio`). Irrelevante con los volúmenes actuales; agendar antes de tener volumen real.

### 2.5 Operación y respaldo

**OPE-1 · ALTO · Sin copias de seguridad.** La organización está en el plan **Free** de Supabase, que no incluye backups automáticos restaurables ni recuperación a un punto en el tiempo (verificar en Dashboard → Database → Backups). La base guarda la contabilidad. *Arreglo:* plan Pro (≈ US$ 25/mes), que además habilita la protección contra contraseñas filtradas, o como mínimo un `pg_dump` diario programado a otro almacenamiento. **Decisión de Luciano.**

> *Preparado (25/09):* la comparación y el plan están en `docs/operacion/PLAN_DE_RECUPERACION.md` (RPO/RTO propuestos, reconstrucción desde cero paso a paso, ensayo de restauración) y hay un ejemplo de volcado diario cifrado con `age` en `docs/operacion/backup-diario.yml.ejemplo` (no activo, sin probar; sube a un almacenamiento privado y no a los «artifacts» de GitHub porque el repositorio es público). **La decisión sigue siendo de Luciano.**

**OPE-2 · ALTO (con reloj) · ✅ RESUELTO (mig. 402, 24/09) · La base se va a llenar.**
> *Aplicado:* `TRUNCATE cron.job_run_details` (solo el historial de ejecuciones; las 10 tareas no se tocaron) y tarea diaria `purgar-historial-cron-diario` (06:15 UTC) que conserva 3 días. La base pasó de **254 MB a 53 MB**; el historial de 202 MB a 32 kB; las tareas siguen corriendo y registrando. **Pendiente de observar:** la primera corrida de la purga es hoy 06:15 UTC; conviene mirar mañana que `cron.job_run_details` siga chico. `cron.job_run_details` tiene 219.286 filas y **201 MB de los 254 MB** de la base (79 %); crece ≈ 5–6 MB por día (10 tareas, 4 de ellas cada 1–2 minutos y 3 cada 5). Con el tope de 500 MB del plan Free, la base llega al límite hacia **principios de noviembre** y pasa a solo lectura. *Arreglo:* una tarea diaria que borre lo anterior a 3 días (`DELETE FROM cron.job_run_details WHERE end_time < now() - interval '3 days'`) más una purga inicial y `VACUUM`. Esfuerzo Bajo (10 minutos). **Necesita OK.** El `audit_log` (24 MB, 7.174 filas) también necesita política de retención más adelante.

**OPE-3 · MEDIO · Sin monitoreo ni alertas.** No hay telemetría de errores del navegador (sin Sentry o similar; solo `SectionErrorBoundary`). Las tareas de cron figuran "succeeded" aunque la función responda error (`net.http_post` solo encola): así estuvo caída la sincronización de MercadoPago del 14 al 29/07 sin síntoma visible. *Arreglo:* un chequeo diario que lea `net._http_response` y la cola de ARCA y avise por correo, y Sentry en el frontend.

> *Preparado (25/09), sin aplicar:* mig. 417 — `chequeo_salud_sistema()` con 10 chequeos (tareas programadas, respuestas de los workers, cola de ARCA, colas de Tiendanube y MercadoLibre, QR de Mercado Pago, cotización del dólar, espacio de la base, documentos sin asiento, asientos descuadrados y registros nuevos), historial de 30 días y una tarea a los 7 minutos de cada hora que avisa por un webhook (Discord/Slack) guardado en el Vault; **hasta que exista ese secreto no sale ningún aviso**. Un «atención» avisa recién en la segunda corrida seguida, un «crítico» enseguida, y no repite hasta que empeore o pasen 12 horas. Sobre los datos reales de hoy da 9 en orden y 1 en atención (la ND con error de ARCA, ya conocida). pgTAP `salud_sistema.test.sql` (75 casos). Manual: `docs/operacion/MONITOREO.md`. **Falta:** crear el webhook y Sentry para los errores del navegador (necesita una cuenta y un DSN).

**OPE-4 · BAJO · Legales y continuidad.** No encontré política de privacidad ni términos en la app (Ley 25.326), ni un procedimiento documentado de baja de datos, ni un plan de recuperación con RPO/RTO definidos.

> *Preparado (25/09):* borradores en `docs/legal/` (política de privacidad, términos y condiciones, procedimiento de derechos de los titulares) y `docs/operacion/PLAN_DE_RECUPERACION.md` con los objetivos propuestos. Todo requiere revisión de un abogado y datos que solo tiene Luciano (razón social, CUIT, domicilio, plazos). Un punto a resolver con el abogado: la base está en São Paulo (Brasil) y el sitio en Vercel (EE. UU.): transferencia internacional (art. 12, Ley 25.326).

**OPE-5 · INFO.** 20 timeouts de DNS de 5 s en `pg_net` hoy entre las 17:30 y las 20:40 UTC; sin impacto porque los workers son idempotentes. El cron de `arca-worker` se llama "every-5-min" pero corre cada minuto.

**OPE-6 · BAJO (nuevo, 25/09) · El registro de auditoría se infla con cada inicio de sesión.**
De las 7.878 filas de `audit_log`, 2.921 son de `profiles` y **2.880 son solo el cambio de `last_login_at`**: cada inicio de sesión guarda una copia completa de la ficha (con el correo) dos veces (`old_data` y `new_data`). Es ruido que además multiplica los datos personales guardados (relevante para la Ley 25.326: una supresión tendría que limpiar 2.900 copias). *Arreglo:* que el trigger de `profiles` ignore los UPDATE donde solo cambia `last_login_at`. Esfuerzo Bajo; **decide Luciano qué se audita** (es una política de auditoría, no un bug).

---

## 3. Lo que está muy bien (con evidencia)

- **Motor contable:** 355 asientos confirmados, 0 desbalanceados, cabeceras que coinciden con sus líneas, 0 importes negativos o en ambos lados, 0 cuentas de otra empresa, 0 no imputables o inactivas. De las 19 cuentas con movimiento en Nalux, solo 1 tiene el saldo mostrado desfasado (CON-4).
- **Aislamiento entre empresas:** 91 tablas, todas con RLS y 279 políticas; todas las políticas de lectura y escritura filtran por empresa o por usuario (salvo 2 excepciones intencionales: una inserción solo para el servicio interno y un bloqueo total); 119 funciones `SECURITY DEFINER`, todas con `search_path` fijo, 99 abiertas a usuarios autenticados y solo 1 a anónimos (SEG-4); de las 99, 93 usan la empresa del usuario en su lógica y las otras 6 son ayudantes de permisos o delegan en una función que sí valida (revisado por patrón; no leí las 99 línea por línea); las 6 vistas usan `security_invoker`. Hay una prueba activa de aislamiento entre empresas (pgTAP, 18/07, por lectura, escritura e impersonación de otra empresa).
- **Asientos protegidos:** `authenticated` no tiene INSERT/UPDATE/DELETE sobre `asientos_contables`/`asientos_items` (mig. 314); se escribe solo por RPC, que valida partida doble y período cerrado en el servidor.
- **Secretos:** 959 archivos versionados y el historial escaneados sin claves reales (las únicas son las claves públicas de demostración de Supabase local); `.env` ignorado; certificados de ARCA y tokens de MercadoPago/Tiendanube en el Vault.
- **Funciones de usuarios y webhooks:** `delete-user`, `invite-user`, `generar-csr`, `probar-conexion-afip` verifican JWT, rol admin y misma empresa; los webhooks de MercadoPago y Tiendanube validan firma HMAC.
- **Integridad:** numeración con bloqueo (`FOR UPDATE`) y reconciliación contra el máximo real; idempotencia del POS por `client_uuid`; sin CAE ni números de AFIP repetidos; auditoría de cambios en las tablas financieras; cierre de ejercicio y traslado de resultados.
- **Pruebas:** 898 pruebas automáticas (889 pasan; las que fallan están identificadas), 17 archivos de pruebas de base de datos al auditar (20 con los 3 nuevos de la Tanda 1) y escenarios de carga con k6.
- **Operación diaria:** en las últimas 24 h no hay errores de aplicación en la base ni en las funciones; las 10 tareas programadas corren; 1.456 llamadas a workers respondieron 200.
- **Continuidad:** documentación muy completa (CONTEXT.md, planes, informes previos, memoria de decisiones).

---

## 4. Lo que no pude verificar

- La **configuración real de Supabase Auth** (confirmación de correo, CAPTCHA, largo mínimo de contraseña, SMTP propio): no es accesible desde las herramientas de esta sesión.
- El **estado de la CI en GitHub** (no hay `gh`).
- **Nada visto en pantalla:** el navegador integrado no tiene sesión y no ingreso contraseñas.
- El **valor** de los secretos de Vercel/Supabase (a propósito no los leí).
- **No probé ataques reales.** SEG-1 y SEG-4 salen de leer políticas, permisos y código; no ejecuté escrituras contra producción. Conviene reproducirlos en un staging o con un test pgTAP al corregirlos.
- Rendimiento bajo carga real, accesibilidad, y la conducta de las funciones de ARCA contra ARCA de producción.

---

## 5. Plan sugerido

**Tanda 1 — antes de cargar usuarios o datos reales (≈ 1 día). ✅ APLICADA el 24/09 (noche), salvo las 3 decisiones/tareas marcadas «pendiente».**
1. ✅ Purga del historial de cron + tarea diaria (OPE-2). *mig. 402 aplicada; falta ver mañana la primera corrida de la purga*
2. ✅ Blindar `profiles` con trigger + test pgTAP (SEG-1). *mig. 403 aplicada y verificada*
3. ✅ (a medias) `arca-corregir-nc-historica` neutralizada (SEG-2). ***Pendiente:** borrarla del panel junto con `create-user` y `emitir-cae`, y borrar el stub del repo.*
4. ✅ Cerrar `ajustar_precios_masivo_catalogo` y su gemela de listas (SEG-4). *mig. 404 aplicada*
5. ⏳ Decidir el plan Pro o el dump diario (OPE-1). *pendiente: decisión de Luciano*
6. ⏳ Decidir el registro público (SEG-5) y verificar Auth en el panel. *pendiente: decisión de Luciano*
7. ✅ `confirmar_asiento` recalcula saldos + recalcular todo (CON-4). *mig. 405 aplicada*

**Tanda 2 — permisos e integridad contable (≈ 3–4 días).**
0. **Permisos (nuevo):** chequeo de permiso de módulo en las 9 RPC de SEG-12 y `get_my_empresa_id()` sin usuarios desactivados + bloqueo de la cuenta en Auth (SEG-13). Con un pgTAP por función.
1. Decisión: empresa limpia para operar en real, o regularizar Nalux (CON-1).
2. `regenerar_asiento_*` idempotentes + reversar los 7 duplicados y AS-000318/319 (CON-2, CON-3).
3. Índice único de facturas de proveedor + aviso (CON-6).
4. Reporte "Conciliación de cuentas de control" (CON-5).
5. CHECK de `estado_pago` y unificar tipos de `movimientos_inventario` (CON-8).
6. Un asiento por origen: que `crear_asiento_automatico` rechace o devuelva el existente si ya hay uno confirmado del mismo origen (previene CON-2/CON-3).

**Tanda 3 — robustez y proceso (≈ 1 semana).**
1. Arreglar las 3 pruebas, excluir `.claude/**` de Vitest, proteger `master` (COD-1).
2. Staging (segundo proyecto Supabase) y variables por entorno (COD-2).
3. Secreto compartido para los workers (SEG-3), cabeceras y CSP (SEG-6).
4. Monitoreo: chequeo diario de salud + Sentry (OPE-3).
5. RPC atómicas para Factura de Proveedor y Compra Rápida (CON-7).
6. Actualizar dependencias (SEG-7).
7. Lectura con menor privilegio (SEG-8), módulos premium del lado servidor (SEG-9).
8. Política de privacidad y términos, plan de recuperación (OPE-4).
9. Antes de ARCA producción: resolver la cola (ARC-1), validar el Libro IVA en el Portal (ARC-2).

**Decisiones pendientes de Luciano:** (1) ¿plan Pro de Supabase ahora, o un volcado diario propio?; (2) ¿operación real en empresa limpia o regularizar Nalux?; (3) ¿cerramos el registro público hasta el lanzamiento? (con SEG-1 cerrado ya no permite tomar otra empresa, pero sigue permitiendo crear cuentas y empresas basura); (4) ¿arrancamos la Tanda 2 (permisos e integridad contable)?

*Todo lo que toca producción (migraciones, borrar funciones, cambiar el plan) queda a la espera de confirmación explícita.*

---

## 6. Estado al 25/09 y qué sigue

- **Preparado y probado, sin aplicar:** mig. 406–417, 8 workers, cabeceras, exceljs, reporte de conciliación, botón de reversa, documentos. **11 commits locales, sin subir.**
- **Lo que necesita a Luciano** (aplicar en orden, borrar 3 funciones, decisiones sobre backups, empresa limpia, registro público y **repositorio público**, cuentas nuevas para staging/webhook/Sentry, revisión legal): ver `PENDIENTES_LUCIANO_AUDITORIA.md`, que es la lista de la «Tanda 4».
- **No se hizo, con motivo:** CON-7 (RPC atómicas de compras: se difiere hasta verificar esos flujos en pantalla), SEG-8 y SEG-9 (dependen de decisiones de producto), jsPDF 4 y react-router 7 (exigen revisar los PDF a ojo).
- **No pude verificar:** la CI real después de mis cambios (no hay Docker Desktop abierto para reproducirla local; hay que subir y mirar), los PDF con jsPDF 4, y nada «en pantalla» (el navegador integrado no tiene sesión).
