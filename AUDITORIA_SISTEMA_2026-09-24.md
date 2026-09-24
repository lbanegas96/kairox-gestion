# AUDITORÍA GENERAL DE KAIROX — 24/09/2026

**Alcance:** contabilidad, seguridad, errores y fallos, vacíos funcionales, madurez y robustez.
**Método:** solo lectura, no se modificó nada. Se revisó: el catálogo de la base (políticas, permisos, funciones, triggers, tareas programadas), consultas de integridad sobre los datos reales de Nalux, el código de las 30 funciones de servidor, el repositorio completo (secretos, dependencias), la suite de pruebas y los registros de Supabase de las últimas 24 h.
**Versión analizada:** `master` @ `5865e15` · proyecto Supabase `isvkelrdxwvkfmrfqxxk` (Postgres 17, **plan Free**) · 7 empresas, 2 usuarios (ambos admin).
**Convenciones:** esfuerzo Bajo = menos de medio día · Medio = 1 a 2 días · Alto = más de 3 días. "Necesita OK" = toca producción (migración, borrar una función, cambiar de plan) y no se aplica sin confirmación explícita.

---

## 1. Veredicto

La base del sistema es sólida: **los asientos cuadran al 100 %, el aislamiento entre empresas está bien resuelto y no hay secretos en el repositorio ni en su historial.** No encontré nada que se esté explotando hoy y los registros de las últimas 24 h no tienen errores de aplicación.

Aun así, **no lo llamaría "listo para operar con clientes reales"** todavía. Hay 4 cosas concretas, baratas de cerrar, que conviene resolver antes de cargar usuarios y datos reales:

1. **No hay copias de seguridad** (plan Free) y la base tiene un **reloj corriendo**: el historial de tareas programadas ocupa 201 MB de 254 MB y crece 5–6 MB por día; al llegar a 500 MB (≈ principios de noviembre) la base pasa a solo lectura y el POS deja de registrar ventas.
2. **Un usuario común puede darse permisos de administrador a sí mismo** (hoy no se puede aprovechar porque los 2 usuarios son admin; se activa al crear el primer empleado).
3. **Sigue publicada una función de ARCA sin autenticación** que era de un solo uso (borrarla).
4. **Los libros de Nalux tienen historial de prueba con inconsistencias** (17 notas de crédito sin asiento, 8 asientos duplicados, cuentas de control que no concilian). Para operar en real conviene arrancar con libros limpios.

| Área | Estado | En una línea |
|---|---|---|
| Aislamiento entre empresas | 🟢 | 91 de 91 tablas con RLS, 279 políticas, sin fugas entre empresas |
| Permisos dentro de una empresa | 🔴 (latente) | Un usuario puede editar sus propios permisos (SEG-1); hoy no aplica porque los 2 usuarios son admin |
| Funciones de servidor (Edge) | 🟡 | 1 abierta que hay que borrar; 8 workers sin clave |
| Motor contable | 🟢 | 355 asientos, 0 desbalanceados, 912 líneas sin anomalías |
| Datos contables de Nalux | 🟡 | Historial de prueba con inconsistencias y sin reporte de conciliación |
| Impuestos y ARCA | 🟡 | Todo en homologación; Libro IVA sin validar contra el Portal |
| Código, pruebas y proceso | 🟡 | CI en rojo hace 3 semanas, no frena el deploy, sin staging |
| Operación y respaldo | 🔴 | Sin backups, reloj de 500 MB, sin monitoreo |

---

## 2. Hallazgos

### 2.1 Seguridad

**SEG-1 · ALTO (latente) · Un usuario puede modificar su propio perfil sin límite de columnas.**
La política de UPDATE de `profiles` deja a cada usuario actualizar su propia fila, y el único freno es un trigger que protege la columna `role`. Quedan libres `permissions`, `active`, `empresa_id`, `tenant_id` y `modo_caja`. Consecuencias posibles: (a) un empleado se otorga permisos de cualquier módulo (incluido `configuracion`); (b) un empleado desactivado por el admin se reactiva solo; (c) cambiarse de empresa apuntando a otra (necesita conocer el UUID; los UUID de empresa aparecen en las URLs públicas de imágenes de productos y logos).
*Evidencia:* `profiles_update` (USING `id = auth.uid()`; WITH CHECK solo exige `role` sin cambios), `has_column_privilege('authenticated', …, 'UPDATE')` verdadero en todas las columnas, `trg_protect_profile_role` (solo `UPDATE OF role`). El frontend solo actualiza su propia fila para `last_login_at`.
*Hoy:* 2 perfiles, ambos admin → no hay quien lo aproveche. **Se vuelve real al crear el primer usuario "staff".**
*Arreglo:* trigger BEFORE UPDATE en `profiles` que, si quien llama no es admin de la misma empresa ni `service_role`, solo permita cambiar `last_login_at`, nombre y apellido. Esfuerzo Bajo. **Necesita OK (migración).** Idealmente con un test pgTAP.

**SEG-2 · ALTO (fácil de cerrar) · Función `arca-corregir-nc-historica` publicada y sin autenticación.**
Era una herramienta de un solo uso (21/08) que el propio código pide borrar. Sigue desplegada con `verify_jwt=false`, usa `service_role`, lee el certificado y la clave privada de ARCA desde el Vault y puede emitir una NC ante ARCA para cualquier `comprobante_id` que le pasen. Exige un UUID válido de una NC con CAE, así que hoy la explotación es difícil y apunta a homologación; pero toma el ambiente de `AFIP_ENVIRONMENT`, o sea que **el día que se pase ARCA a producción emitiría notas de crédito reales ante ARCA** a quien la llame. No está en el repositorio (el chequeo de drift la marcaría).
*Arreglo:* borrarla desde el panel de Supabase o con `supabase functions delete arca-corregir-nc-historica`. También conviene borrar `create-user` (no se usa; el frontend invita con `invite-user`, y `create-user` chocaría con el trigger `handle_new_user`) y `emitir-cae` (stub 410). Esfuerzo Bajo. **Necesita OK.**

**SEG-3 · MEDIO · Los workers del cron se pueden invocar desde internet sin clave.**
`arca-worker`, `mp-qr-poller`, `mp-sync-worker`, `mercadolibre-stock-worker`, `mercadolibre-catalogo-publicar`, `tiendanube-stock-worker` y `tiendanube-catalogo-publicar` tienen `verify_jwt=false` y ninguna verificación propia; `tc-diario-sync` sí exige un JWT, pero el cron le manda la clave anónima, que es pública y sirve para llamarla desde cualquier lado. No permiten inyectar datos (solo procesan colas), pero cualquiera puede llamarlos en bucle y forzar llamadas a ARCA, Mercado Pago, Tiendanube o MercadoLibre (bloqueos por exceso de pedidos, consumo del cupo de invocaciones).
*Arreglo:* un secreto compartido (`CRON_SECRET`) en un header que cada worker valida y que los 8 jobs del cron envían. Esfuerzo Medio. **Necesita OK** (redeploy de funciones y cambio de los cron jobs).

**SEG-4 · MEDIO · `ajustar_precios_masivo_catalogo`: abierta al público y sin permiso por módulo.**
Es la única función SECURITY DEFINER ejecutable por `anon` (tiene `EXECUTE` para PUBLIC). Sin sesión no hace nada porque `get_my_empresa_id()` devuelve NULL, pero rompe la regla del proyecto (REVOKE FROM PUBLIC) y no chequea `has_module_permission`: cualquier usuario de la empresa puede cambiar todos los precios llamándola por API.
*Arreglo:* `REVOKE EXECUTE … FROM PUBLIC, anon` + chequeo del permiso del módulo. Esfuerzo Bajo. **Necesita OK (migración).**

**SEG-5 · MEDIO · Registro público abierto.**
El sistema ofrece `signUp` y `create_tenant` a cualquier visitante, sin CAPTCHA. 5 de las 7 empresas no tienen ningún usuario. En plan Free, cuentas basura consumen el cupo (base de 500 MB, correos). *No pude leer la configuración real de Auth desde acá:* hay que verificar en el panel si la confirmación de correo está activa (en el `config.toml` local está apagada).
*Arreglo:* confirmación de correo + CAPTCHA (Turnstile/hCaptcha), o cerrar el registro y operar por invitación hasta el lanzamiento comercial. Esfuerzo Bajo–Medio.

**SEG-6 · MEDIO · Cabeceras de seguridad incompletas.**
`vercel.json` solo envía `X-Content-Type-Options`, `X-Frame-Options` y `X-XSS-Protection` (este último está obsoleto). Faltan `Content-Security-Policy`, `Referrer-Policy` y `Permissions-Policy`, que el `CLAUDE.md` del proyecto exige. La CSP hay que introducirla primero en modo "report-only" para no romper nada (Supabase, Google Fonts, MercadoPago).

**SEG-7 · MEDIO · Dependencias con vulnerabilidades conocidas (13; 1 crítica, 4 altas, 7 moderadas, 1 baja; solo dependencias de producción).**
En el navegador el riesgo práctico es bajo (la "crítica" de `jspdf` afecta al build de Node y a entradas hostiles), pero conviene ordenarlo: `jspdf` 2.5.2 → 3.x, `xlsx` 0.18.5 (prototype pollution y ReDoS, sin parche en npm: migrar a `exceljs`, que ya es dependencia), `react-router-dom` (open redirect), `dompurify`, `nanoid`, `brace-expansion`. Esfuerzo Medio (`jspdf` cambia de versión mayor).

**SEG-8 · BAJO · La lectura está abierta a todo el equipo.**
Los permisos por módulo solo limitan escribir en varias tablas. Cualquier usuario de la empresa puede *leer* `asientos_contables`, `movimientos_bancarios`, `cuentas_bancarias` (CBU/alias), `caja_sesiones`, `productos` (con el costo de compra) y `audit_log`. Contrasta con `compras`, `cheques`, `plan_cuentas` y `extractos_bancarios`, que sí exigen permiso de módulo. Alinear cuando haya empleados.

**SEG-9 · BAJO · El admin de cada empresa puede activarse módulos "premium" por su cuenta.**
`empresas_update` deja a cualquier admin modificar `usa_ajuste_inflacion`, `usa_impuestos_avanzados`, `usa_ecommerce`, `afip_ambiente`, etc. Si esos módulos se van a vender, el interruptor debe vivir del lado servidor. También `empresas.afip_ticket_acceso` (token de WSAA) es legible por cualquier usuario de la empresa; verificar si se sigue usando.

**SEG-10 · BAJO · Detalles.** `audit_log` deja insertar filas a los usuarios (solo a su nombre): se puede ensuciar/inflar. Las firmas HMAC de webhooks se comparan con `===` (no en tiempo constante). El `config.toml` local dice contraseña mínima de 6 y `create-user` exige 12; la protección contra contraseñas filtradas requiere plan Pro. `invite-user` arma el `redirectTo` con el header `Origin` del pedido (mitigado por la lista de URLs permitidas de Auth y porque solo lo llama un admin). `mp-webhook` sigue rechazando con 401 las notificaciones reales de MP (conocido; el poller cubre).

**SEG-11 · INFO · Los avisos del panel de Supabase están viejos.** El análisis de seguridad cacheado es del **01/09** (`observed_at`): muestra una vista `SECURITY DEFINER` y 4 funciones abiertas a `anon` que ya se corrigieron (queda solo la de SEG-4). No usar el advisor como estado actual sin mirar la fecha de observación.

### 2.2 Contabilidad

**CON-1 · ALTO para arrancar en serio · 17 notas de crédito históricas sin asiento contable ($ 1.133.194,52).**
13 pagadas ($ 973.114,52) y 4 pendientes ($ 160.080,00), fechadas entre el 13/06 y el 30/07, incluidas 5 con CAE de homologación. Desde el 18/08 todas las NC tienen asiento. Efecto: el mayor de Nalux sobrestima Ventas, Cuentas a Cobrar/Caja e IVA Débito Fiscal.
*Arreglo:* (a) arrancar la operación real en una empresa nueva y limpia, dejando Nalux como entorno de pruebas (recomendado), o (b) reconstruir esos asientos (no existe un `regenerar_asiento_nc`).

**CON-2 · MEDIO · 7 asientos duplicados por "Regenerar asiento".**
`regenerar_asiento_cxc` y `regenerar_asiento_cxp` solo verifican `asiento_id` (el vínculo). Si el asiento original existía pero no estaba vinculado al movimiento, crean uno segundo. Pasó con 3 cobros ($ 66.332: AS-000131/182, 141/183, 159/185) y 4 pagos ($ 48.415: AS-000132/188, 142/189, 160/190, 164/191), todos del 06–08/07. Los dos asientos de cada par están confirmados. Efecto: Caja y Cuentas a Cobrar/Pagar mal por ese importe.
*Arreglo:* que las funciones busquen antes un asiento confirmado con `origen = 'cobro_cliente'/'pago_proveedor'` y `origen_id = p_movimiento_id`; reversar los 7 duplicados. **Necesita OK.**

**CON-3 · MEDIO · 1 doble asiento de compra sin reversar ($ 550.000,66).**
La mig. 397 reversó 3 de las 4 duplicaciones de "factura por OC" (AS-000321, 323, 325). Quedó **AS-000318 / AS-000319** (Amazon, factura 889998899888, OC-22124): ambos confirmados, por $ 550.000,66. Sobrestima Mercaderías ($ 454.546), IVA Crédito Fiscal ($ 95.454,66) y Cuentas a Pagar. **Necesita OK** para el asiento de reversa.

**CON-4 · MEDIO · `confirmar_asiento` no actualiza el saldo de las cuentas.**
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

**CON-6 · MEDIO · Las facturas de proveedor se pueden duplicar.**
`compras` solo tiene PK: no hay control de (empresa, proveedor, tipo/letra, punto de venta, número). Un doble tipeo duplica el crédito fiscal y el pago. Hoy hay 1 caso (4 filas con el mismo proveedor y número). *Arreglo:* índice único parcial `WHERE estado_pago <> 'anulada'` (previa limpieza del caso existente) y aviso claro en pantalla.

**CON-7 · MEDIO · Circuitos que se arman en el navegador en vez de una sola operación atómica.**
La Factura de Proveedor hace desde el navegador: insertar `compras`, `detalle_compras`, llamar a `aplicar_compra_producto` por ítem, insertar cuenta corriente, insertar movimiento de caja y, al final, el asiento **"no bloqueante"** (si falla, solo `console.warn`). Compra Rápida es igual. Si se corta la conexión a mitad, queda un documento a medio hacer, y el código ya lo reconoce ("la factura quedó registrada pero NO se pudo actualizar el stock"). El daño medido hoy es chico (4 compras sin asiento, todas de jun–jul; 0 cobros o pagos huérfanos) porque los cobros, pagos y ventas ya pasan por RPC. Es el patrón más frágil que queda. *Arreglo:* una RPC atómica por circuito, como ya existe para `crear_venta` y `registrar_factura_compra_oc`. Esfuerzo Medio–Alto.

**CON-8 · BAJO · Calidad de datos.**
`estado_pago` no tiene CHECK y aparecen valores distintos ("pagado" y "pagada"; las vistas comparan contra `'pagada'`). En `movimientos_inventario` existen `entrada` e `ingreso` (dos nombres para lo mismo) y los `ajuste` no guardan signo: el kardex no se puede reconstruir sin ambigüedad (origen de la deriva de stock conocida, 20 de 75 productos). Se aceptan compras con fecha futura (hay una del 25/09, ya "pagada") y pagos con fecha anterior a la factura que cancelan. La caja puede quedar en negativo sin advertencia. `comprobantes.tipo_comprobante_afip` solo acepta A/B/C/E (no M).

**CON-9 · BAJO / producto · No hay circuito de saldos iniciales.**
Un cliente que migra con caja, deudores, proveedores y stock previos no tiene un asistente de asiento de apertura; el alta de stock inicial no genera asiento contra capital. Nalux es el ejemplo: inventario físico valorizado en $ 16,8 M contra $ 14,3 M en el mayor.

**CON-10 · INFO · Nunca se cerró un período.** Nalux tiene solo Junio y Julio creados, ambos abiertos, y no hay períodos para agosto/septiembre. El control de período cerrado está bien implementado pero nunca se ejerció con datos reales.

### 2.3 Impuestos y ARCA

**ARC-1 · MEDIO · Cola de ARCA con 26 comprobantes en error.** ARCA está en homologación a propósito. En `facturas_pendientes_arca` hay 62 emitidas, **21 `error_definitivo`** (16 por el campo `CondicionIVAReceptorId` de julio, 3 por numeración desincronizada, 2 en "estado ambiguo") y **5 `error_datos`**. En `comprobantes` hay 3 ventas sin CAE por error definitivo ($ 149.000, 06/08) y 1 ND con error ($ 5.000, 11/09). Antes de pasar a producción: resolverlas o darlas de baja y arrancar la cola limpia.

**ARC-2 · MEDIO · Libro IVA Digital nunca validado contra el Portal IVA** (sin acceso por ahora) y con vacíos conocidos: percepciones y retenciones de IVA/IIBB en compras (el TXT declara 0), IVA 27 % en compras (CHECK), liquidación y saldo técnico de IVA sin asiento, retenciones sufridas mezcladas en Posición Fiscal, alícuota de IIBB sin cargar, `aplicar_compra_producto` recibe el costo con IVA incluido en compras "Libro" (posible costo inflado), y la edición del N° de factura no actualiza los 3 campos estructurados.

### 2.4 Código, pruebas y proceso

**COD-1 · MEDIO · CI en rojo hace 3 semanas y sin freno al deploy.** Las pruebas de `FormNuevaCotizacion` (3) fallan en `master` desde el 03/09 (la sesión aparte que las está arreglando todavía no llegó a `master`). Vercel publica con cada `git push` sin esperar a la CI. Además Vitest está recogiendo copias en `.claude/worktrees/*` y un spec de Playwright, lo que suma 6 fallos fantasma en la corrida local (889 pasan, 9 fallan; 3 son reales). *No pude ver el estado en GitHub (no hay `gh` instalado).* *Arreglo:* arreglar los 3, excluir `.claude/**` y `loadtest/**` de Vitest, y proteger `master` (PR + checks obligatorios) para que la CI frene el deploy.

**COD-2 · MEDIO · Un solo entorno.** Local, vistas previas y producción comparten la misma base. En los registros de esta misma noche se ve un usuario operando desde `http://localhost:3000` contra la base real. Toda prueba toca datos reales. *Arreglo:* un segundo proyecto Supabase Free como staging (permitido: hasta 2 proyectos gratuitos) y variables de entorno por entorno en Vercel.

**COD-3 · BAJO · Higiene.** 3 migraciones aplicadas en producción sin archivo equivalente en el repo (`revoke_execute_anon_defensa_profundidad_fix`, `ajuste_inflacion_fase2_reportes_fix`, `fix_grant_registrar_factura_compra_oc_9params`) y 1 archivo sin aplicar con ese nombre (`349_stock_disponible_vista.sql`; la vista existe en producción); números repetidos (318, 325, 328); `config.toml` con comentario del proyecto viejo; `URL.txt` y `schema.sql` viejos versionados. Recrear la base desde el repo puede no dar lo mismo que producción (ya pasó con `crear_venta` en julio).

**COD-4 · INFO · Rendimiento.** 54 claves foráneas sin índice, 63 índices sin uso y 1 política RLS sin `(select auth.uid())` (`audit_log_insert_propio`). Irrelevante con los volúmenes actuales; agendar antes de tener volumen real.

### 2.5 Operación y respaldo

**OPE-1 · ALTO · Sin copias de seguridad.** La organización está en el plan **Free** de Supabase, que no incluye backups automáticos restaurables ni recuperación a un punto en el tiempo (verificar en Dashboard → Database → Backups). La base guarda la contabilidad. *Arreglo:* plan Pro (≈ US$ 25/mes), que además habilita la protección contra contraseñas filtradas, o como mínimo un `pg_dump` diario programado a otro almacenamiento. **Decisión de Luciano.**

**OPE-2 · ALTO (con reloj) · La base se va a llenar.** `cron.job_run_details` tiene 219.286 filas y **201 MB de los 254 MB** de la base (79 %); crece ≈ 5–6 MB por día (10 tareas, 4 de ellas cada 1–2 minutos y 3 cada 5). Con el tope de 500 MB del plan Free, la base llega al límite hacia **principios de noviembre** y pasa a solo lectura. *Arreglo:* una tarea diaria que borre lo anterior a 3 días (`DELETE FROM cron.job_run_details WHERE end_time < now() - interval '3 days'`) más una purga inicial y `VACUUM`. Esfuerzo Bajo (10 minutos). **Necesita OK.** El `audit_log` (24 MB, 7.174 filas) también necesita política de retención más adelante.

**OPE-3 · MEDIO · Sin monitoreo ni alertas.** No hay telemetría de errores del navegador (sin Sentry o similar; solo `SectionErrorBoundary`). Las tareas de cron figuran "succeeded" aunque la función responda error (`net.http_post` solo encola): así estuvo caída la sincronización de MercadoPago del 14 al 29/07 sin síntoma visible. *Arreglo:* un chequeo diario que lea `net._http_response` y la cola de ARCA y avise por correo, y Sentry en el frontend.

**OPE-4 · BAJO · Legales y continuidad.** No encontré política de privacidad ni términos en la app (Ley 25.326), ni un procedimiento documentado de baja de datos, ni un plan de recuperación con RPO/RTO definidos.

**OPE-5 · INFO.** 20 timeouts de DNS de 5 s en `pg_net` hoy entre las 17:30 y las 20:40 UTC; sin impacto porque los workers son idempotentes. El cron de `arca-worker` se llama "every-5-min" pero corre cada minuto.

---

## 3. Lo que está muy bien (con evidencia)

- **Motor contable:** 355 asientos confirmados, 0 desbalanceados, cabeceras que coinciden con sus líneas, 0 importes negativos o en ambos lados, 0 cuentas de otra empresa, 0 no imputables o inactivas. De las 19 cuentas con movimiento en Nalux, solo 1 tiene el saldo mostrado desfasado (CON-4).
- **Aislamiento entre empresas:** 91 tablas, todas con RLS y 279 políticas; todas las políticas de lectura y escritura filtran por empresa o por usuario (salvo 2 excepciones intencionales: una inserción solo para el servicio interno y un bloqueo total); 119 funciones `SECURITY DEFINER`, todas con `search_path` fijo, 99 abiertas a usuarios autenticados y solo 1 a anónimos (SEG-4); de las 99, 93 usan la empresa del usuario en su lógica y las otras 6 son ayudantes de permisos o delegan en una función que sí valida (revisado por patrón; no leí las 99 línea por línea); las 6 vistas usan `security_invoker`. Hay una prueba activa de aislamiento entre empresas (pgTAP, 18/07, por lectura, escritura e impersonación de otra empresa).
- **Asientos protegidos:** `authenticated` no tiene INSERT/UPDATE/DELETE sobre `asientos_contables`/`asientos_items` (mig. 314); se escribe solo por RPC, que valida partida doble y período cerrado en el servidor.
- **Secretos:** 959 archivos versionados y el historial escaneados sin claves reales (las únicas son las claves públicas de demostración de Supabase local); `.env` ignorado; certificados de ARCA y tokens de MercadoPago/Tiendanube en el Vault.
- **Funciones de usuarios y webhooks:** `delete-user`, `invite-user`, `generar-csr`, `probar-conexion-afip` verifican JWT, rol admin y misma empresa; los webhooks de MercadoPago y Tiendanube validan firma HMAC.
- **Integridad:** numeración con bloqueo (`FOR UPDATE`) y reconciliación contra el máximo real; idempotencia del POS por `client_uuid`; sin CAE ni números de AFIP repetidos; auditoría de cambios en las tablas financieras; cierre de ejercicio y traslado de resultados.
- **Pruebas:** 898 pruebas automáticas (889 pasan; las que fallan están identificadas), 18 archivos de pruebas de base de datos y escenarios de carga con k6.
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

**Tanda 1 — antes de cargar usuarios o datos reales (≈ 1 día).**
1. Purga del historial de cron + tarea diaria (OPE-2). *mig. 402*
2. Blindar `profiles` con trigger + test pgTAP (SEG-1). *mig. 403*
3. Borrar `arca-corregir-nc-historica`, `create-user` y `emitir-cae` (SEG-2). *manual*
4. Cerrar `ajustar_precios_masivo_catalogo` (SEG-4). *mig. 404*
5. Decidir el plan Pro o el dump diario (OPE-1). *decisión*
6. Decidir el registro público (SEG-5) y verificar Auth en el panel.
7. `confirmar_asiento` recalcula saldos + recalcular todo (CON-4). *mig. 405*

**Tanda 2 — integridad contable (≈ 2–3 días).**
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

**Decisiones que necesito de Luciano:** (1) ¿plan Pro de Supabase ahora?; (2) ¿operación real en empresa limpia o regularizar Nalux?; (3) ¿cerramos el registro público hasta el lanzamiento?; (4) ¿aplico la Tanda 1?

*Todo lo que toca producción (migraciones, borrar funciones, cambiar el plan) queda a la espera de confirmación explícita.*
