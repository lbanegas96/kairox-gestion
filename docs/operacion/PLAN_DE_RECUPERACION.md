# Plan de recuperación — KAIROX Gestión

Auditoría 24/09/2026, hallazgos **OPE-1** (sin copias de seguridad) y **OPE-4** (sin plan de recuperación con RPO/RTO).
Este documento es un **borrador para que Luciano y Nadia lo aprueben**: los objetivos de la sección 1 son una propuesta, no
un compromiso vigente. Los pasos de la sección 5 no se ensayaron todavía: la sección 6 explica cómo ensayarlos.

---

## 1. Objetivos propuestos

| Sigla | Qué significa | Propuesta al salir a operación real | Hoy |
|---|---|---|---|
| **RPO** | Cuántos datos como máximo se pueden perder | **24 horas** (copia diaria). Con "recuperación a un punto en el tiempo" (PITR) baja a minutos | **Indefinido**: en el plan Free no hay copias restaurables |
| **RTO** | Cuánto tiempo puede estar caído el sistema | **4 horas** en horario laboral | Sin medir (la reconstrucción desde cero nunca se ensayó) |

Qué guarda cada cosa:

| Qué | Dónde vive | ¿Se recupera si se pierde la base? |
|---|---|---|
| Estructura de la base (tablas, funciones, permisos, tareas de cron) | El repositorio (`supabase/migrations`) | **Sí**, reaplicando las migraciones (con los avisos de la sección 5, paso 2) |
| Código del sistema | GitHub + Vercel | **Sí** |
| **Datos** (contabilidad, ventas, clientes, stock) | Solo la base de Supabase | **No**, salvo que exista una copia de seguridad |
| Certificados de ARCA y tokens de Mercado Pago / Tiendanube / MercadoLibre | **Vault** de Supabase (`afip_cert_*`, `afip_key_*`, `mp_access_token_*`, `tiendanube_access_token_*`, `mercadolibre_*_token_*`) | **No** entre proyectos: el Vault no se lleva con una copia normal. Hay que tener el respaldo aparte (sección 4) |
| Usuarios y contraseñas | `auth.users` de Supabase | Solo si la copia incluye el esquema `auth` |

---

## 2. Estado actual (25/09/2026)

- Proyecto de Supabase `Kairox-gestión(nuevo)` (`isvkelrdxwvkfmrfqxxk`), región **sa-east-1 (São Paulo)**, PostgreSQL 17, plan **Free**.
- El plan Free **no incluye copias de seguridad automáticas restaurables** ni recuperación a un punto en el tiempo (verificar en
  Supabase → Database → Backups). Si la base se pierde o se corrompe, **hoy no hay de dónde recuperar los datos**.
- Tamaño de la base: unos 59 MB de 500 MB (plan Free). Con la purga diaria del historial de cron (mig. 402) el crecimiento es
  lento; el chequeo de salud avisa al pasar el 60 %.
- Operación real: **todavía no** (todo el sistema está en fase de prueba, ARCA en homologación). Por eso el riesgo actual son datos
  de prueba; **deja de ser aceptable el día que se cargue el primer dato real**.

---

## 3. Opciones

| Opción | Costo aprox. (verificar precios vigentes) | RPO | Esfuerzo | Comentario |
|---|---|---|---|---|
| **A. Plan Pro de Supabase** | ≈ US$ 25/mes por proyecto | 24 h (copia diaria, 7 días de retención) | Muy bajo: cambiar el plan | Además habilita la protección contra contraseñas filtradas y sube el tope de base a 8 GB. **Recomendada.** |
| **B. Plan Pro + PITR** | Pro + un adicional mensual | Minutos | Bajo | Recién tiene sentido con volumen real de operaciones por hora. |
| **C. Volcado diario propio** (sin cambiar de plan) | Casi cero (almacenamiento) | 24 h | Medio: un flujo programado + un destino de almacenamiento + probarlo | Sirve de **segunda copia aunque se elija A**: vive fuera de Supabase. Ver `backup-diario.yml.ejemplo` en esta carpeta. |

Recomendación: **A ahora**, y **C además** cuando haya datos reales (una copia que no depende del proveedor).

---

## 4. Inventario de lo que hay que tener a mano para reconstruir

**No se guardan valores en este documento ni en el repositorio.** Solo dónde vive cada cosa y quién la tiene.

| Elemento | Dónde vive hoy | Respaldo necesario |
|---|---|---|
| Variables del sitio (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_UALA_*`) | Vercel → Project → Settings → Environment Variables | Anotar dónde están; se regeneran desde Supabase → Settings → API |
| Secretos de las Edge Functions: `SITE_URL`, `TIENDANUBE_APP_ID`, `TIENDANUBE_CLIENT_SECRET`, `MELI_APP_ID`, `MELI_CLIENT_SECRET`, `AFIP_ENVIRONMENT` (los `SUPABASE_*` los pone la plataforma) | Supabase → Edge Functions → Secrets | **Gestor de contraseñas** del equipo (Luciano + Nadia) |
| Certificados de ARCA de cada empresa (`.crt` y clave privada) | Vault (`afip_cert_<empresa>`, `afip_key_<empresa>`) | El archivo original del certificado y su clave, en el gestor de contraseñas |
| Tokens de Mercado Pago / Tiendanube / MercadoLibre | Vault | Se vuelven a generar reconectando la integración desde Configuración (no hace falta respaldarlos) |
| Secreto compartido del cron (`cron_secret`) | Vault, lo genera la migración 415 | No hace falta: se regenera solo al reaplicar las migraciones |
| Webhook de avisos (`alerta_webhook_url`) | Vault | Volver a crearlo (ver `MONITOREO.md`) |
| Usuario y clave de la cuenta de Supabase / Vercel / GitHub | Cada servicio | Gestor de contraseñas + segundo factor. **Dos personas con acceso de administrador** para que el sistema no dependa de una sola |

---

## 5. Reconstruir el sistema desde cero (proyecto de Supabase nuevo)

Sirve para: base perdida o corrupta que no se puede restaurar desde el panel, cambio de región/cuenta, o armar un staging.

1. **Crear el proyecto** en Supabase (misma región que producción: sa-east-1). Anotar la URL, la clave anónima y la de servicio.
2. **Aplicar las migraciones** en orden (`supabase link --project-ref <nuevo>` y `supabase db push`, o pegar cada archivo en el SQL Editor).
   Tres trampas conocidas:
   - **Las tareas de cron traen la dirección del proyecto viejo escrita a mano** (mig. 102, 107, 109, 233…, 329). Después de reaplicar,
     hay que reprogramarlas con la dirección y la clave anónima del proyecto nuevo (mismo bloque que la mig. 329, cambiando el ref) y
     recién ahí correr la 415, que les agrega el secreto compartido.
   - Una función creada con `CREATE OR REPLACE` y **un parámetro nuevo** no reemplaza a la anterior: crea un overload que nace con permiso
     para todos (ya pasó con `crear_venta` y con `registrar_factura_compra_oc`). La mig. 416 cubre el último caso conocido.
   - Correr los tests de base (`supabase/tests/*.test.sql`) al terminar: si algo quedó distinto de producción, fallan.
3. **Cargar los datos** (solo si se recupera desde un volcado propio; con una copia de Supabase el propio panel restaura todo el proyecto):
   `pg_restore --data-only --disable-triggers` de las tablas de `public`, y de `auth.users` / `auth.identities`. Los triggers se
   desactivan para no duplicar saldos, auditoría ni asientos mientras se cargan filas ya calculadas; al terminar, correr
   `recalcular_saldo_cuenta` de todas las cuentas y contrastar con el reporte *Conciliación de cuentas de control*.
4. **Vault:** volver a crear los secretos que correspondan (sección 4). Los certificados de ARCA se cargan de nuevo desde Configuración → ARCA.
5. **Edge Functions:** desplegar las 28 funciones (las 31 que hay hoy menos las 3 a borrar) **respetando su `verify_jwt`** (tabla de abajo). El `supabase/config.toml` solo declara dos;
   desplegar por CLI sin `--no-verify-jwt` deja a los webhooks y workers rechazando todo con 401.
6. **Secretos de las Edge Functions:** cargar los de la sección 4.
7. **Auth (panel de Supabase → Authentication):** *Site URL* y lista de *Redirect URLs* (la de Vercel), plantillas de correo, SMTP propio si lo hay,
   confirmación de correo, largo mínimo de contraseña. Un proyecto nuevo trae claves nuevas: **todas las sesiones abiertas quedan invalidadas**.
8. **Vercel:** actualizar `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` y volver a desplegar.
9. **Webhooks externos:** Mercado Pago, Tiendanube y MercadoLibre tienen registrada la dirección de las funciones del proyecto viejo
   (lleva el ref dentro): actualizarla en cada panel.
10. **Verificar** (lista de la sección 6).

### Edge Functions y su `verify_jwt` (estado al 25/09/2026)

| `verify_jwt = false` (las llaman procesos internos, el navegador sin sesión o servicios externos) | `verify_jwt = true` |
|---|---|
| `arca-worker`, `mp-sync-worker`, `mp-qr-poller`, `tiendanube-stock-worker`, `tiendanube-catalogo-publicar`, `mercadolibre-stock-worker`, `mercadolibre-catalogo-publicar` (workers: desde la mig. 415 verifican el secreto del cron) | `tc-diario-sync` (el cron le manda la clave anónima; con la mig. 415 además verifica el secreto) |
| `mp-webhook`, `tiendanube-pedidos-webhook`, `mercadolibre-pedidos-webhook`, `tiendanube-compliance-webhook` (webhooks externos: validan firma) | `mp-verify-token`, `mp-save-config`, `mp-sync`, `mp-qr-crear` |
| `integraciones-oauth-callback`, `generar-csr`, `probar-conexion-afip`, `invite-user`, `delete-user` (verifican JWT y rol adentro) | `tiendanube-catalogo`, `mercadolibre-catalogo`, `integraciones-oauth-iniciar` |
| `mercadolibre-categorias` | `informar-caea`, `solicitar-caea`, `verificar-caea-vigente` |
| **A borrar:** `create-user`, `emitir-cae` | **A borrar:** `arca-corregir-nc-historica` |

---

## 6. Ensayo de restauración (obligatorio antes de operar en real, y luego cada 3 meses)

Una copia que nunca se restauró no es una copia. Ensayo mínimo (1–2 horas):

1. Crear un proyecto de Supabase de prueba (el mismo que se usaría como staging, ver `STAGING.md`).
2. Restaurar en él la última copia (o el último volcado) y aplicar lo que falte de la sección 5.
3. Verificar, y anotar cuánto tardó cada paso:
   - [ ] Se puede ingresar con un usuario real.
   - [ ] El Balance General da lo mismo que en producción al día de la copia.
   - [ ] *Conciliación de cuentas de control*: mismas diferencias que en producción.
   - [ ] La cantidad de filas de `clientes`, `productos`, `comprobantes`, `asientos_contables` coincide con la copia.
   - [ ] Una venta de prueba se registra y genera su asiento.
   - [ ] `SELECT jsonb_pretty(public.chequeo_salud_sistema());` no marca nada crítico que no corresponda.
4. Borrar el proyecto de prueba y registrar el resultado (fecha, quién, cuánto tardó, qué falló) al pie de este documento.

**Registro de ensayos:** _(ninguno todavía)_

---

## 7. Incidentes tipo

| Situación | Qué hacer |
|---|---|
| **Se filtró una clave** (Supabase, Mercado Pago, Tiendanube, MercadoLibre, ARCA) | 1) Revocarla en el panel del servicio. 2) Generar una nueva y cargarla donde corresponda (Vercel / secretos de Edge Functions / Vault). 3) Revisar los registros de acceso por si se usó. 4) Si el historial de git la contiene, limpiarlo (ver `CLAUDE.md`). 5) Evaluar si hay que avisar a los titulares de los datos (Ley 25.326) — ver `docs/legal/PROCEDIMIENTO_DERECHOS_DE_LOS_TITULARES.md`. |
| **La base se llenó** (solo lectura) | Ver qué crece (consulta en `MONITOREO.md`), purgar lo purgable (historial de cron, `audit_log` viejo) o pasar a plan Pro. |
| **Un deploy rompió el sitio** | Vercel → Deployments → el último bueno → *Promote to Production* (vuelve atrás en segundos, sin tocar la base). Después arreglar el código. |
| **Una migración salió mal** | Muchas migraciones traen su `ROLLBACK` comentado al pie. Si tocó datos, recuperar desde la copia y **no** seguir operando esa empresa hasta revisar. |
| **Se borraron datos por error** | Con plan Pro: restaurar la copia en un proyecto aparte, sacar las filas que faltan y reinsertarlas en producción (no restaurar encima de producción si solo falta una parte). |
| **ARCA caído** | Las facturas quedan en cola y se reintentan solas. Para operar en contingencia existe el circuito CAEA (Configuración → ARCA). Ver `CAEA_IMPLEMENTACION.md`. |
| **Mercado Pago caído** | Los cobros con QR quedan pendientes; el poller los confirma cuando vuelve. El POS sigue cobrando en efectivo/otros medios. |
| **Modo sin internet en el POS** | El POS tiene modo offline con cola de ventas (ver `PLAN_MODO_OFFLINE_POS.md`); sincroniza al volver la conexión. |

---

## 8. Responsables

| Rol | Persona | Contacto |
|---|---|---|
| Responsable técnico / decisiones | Luciano | _[completar]_ |
| Colaboradora técnica | Nadia | _[completar]_ |
| Contador / asesor impositivo | _[completar]_ | _[completar]_ |
| Soporte de Supabase | Panel de Supabase → Support (con plan Pro tiene tiempos de respuesta garantizados) | — |
