# Monitoreo y avisos — KAIROX Gestión

Auditoría 24/09/2026, hallazgo **OPE-3** (sin monitoreo ni alertas). Este documento explica qué se vigila, cómo se lee,
cómo se activan los avisos y qué hacer cuando llega uno.

> **Estado:** el chequeo está escrito y probado (migración 417) pero **no está aplicado en producción** hasta que Luciano
> lo apruebe (ver `PENDIENTES_LUCIANO_AUDITORIA.md`). Todo lo de abajo describe cómo funciona una vez aplicado.

---

## 1. Qué se vigila

Una tarea programada llama a `ejecutar_chequeo_salud()` **a los 7 minutos de cada hora**. Corre 10 chequeos, guarda el
resultado 30 días y, si hace falta, manda un aviso. Cada chequeo queda en `ok`, `atencion` o `critico`.

| Chequeo | Qué mira | Atención | Crítico |
|---|---|---|---|
| `cron_jobs` — Tareas programadas | Que cada tarea haya corrido a tiempo y no haya fallado | Una tarea diaria sin correr hace más de 26 h, o alguna corrida fallida en 24 h | Una tarea frecuente (cada minuto / cada N minutos) sin correr hace más de 15 min |
| `workers_respuestas` — Respuestas de los procesos automáticos | Qué contestaron ARCA, Mercado Pago, Tiendanube y MercadoLibre a las llamadas de las últimas 2 h (`net._http_response`) | 10 % o más de errores (mínimo 20 llamadas) | 50 % o más |
| `cola_arca` — Facturación electrónica | Comprobantes esperando CAE que nadie procesa; errores nuevos | 1 o más atascados hace más de 30 min, o 1 error nuevo en 24 h | 1 o más atascados hace más de 4 h |
| `colas_integraciones` — Tiendanube / MercadoLibre | Pedidos de stock y catálogo atascados; errores nuevos | Igual que ARCA | Igual que ARCA |
| `qr_mercadopago` — Cobros con QR | QR pendientes que ya vencieron y nadie dio de baja | 1 o más vencidos hace más de 15 min | — |
| `tipo_de_cambio` — Dólar automático | Fecha de la última cotización automática | Más de 3 días | Más de 6 días |
| `base_de_datos` — Espacio | Tamaño contra el tope del plan (500 MB en Free) y filas del historial de cron | 60 % del tope, o más de 60.000 filas de historial (la purga diaria no corre) | 85 % del tope |
| `documentos_sin_asiento` | Ventas, notas y compras de los últimos 7 días (con más de 15 min) sin asiento contable | 1 a 4 documentos | 5 o más |
| `asientos_descuadrados` | Asientos confirmados de 3 días con el debe distinto del haber | — | 1 o más (no debería pasar nunca) |
| `registros_nuevos` | Usuarios o empresas creados en 24 h (el registro público está abierto) | 20 usuarios o 10 empresas | — |

Los umbrales están escritos en `supabase/migrations/417_chequeo_salud_sistema.sql`; para cambiar uno se hace una migración
nueva (con `CREATE OR REPLACE FUNCTION`).

**Qué NO cubre** (ver sección 6): errores del navegador, errores internos de las Edge Functions, las copias de seguridad.

---

## 2. Cómo verlo

Es un dato de plataforma: lo ven Kairox (SQL Editor de Supabase o una sesión de Claude Code), **no** los usuarios de una
empresa. Última corrida:

```sql
SELECT ejecutado_en, estado, jsonb_pretty(resultado)
FROM public.salud_sistema_chequeos
ORDER BY ejecutado_en DESC
LIMIT 1;
```

Historial de estados (para ver si algo va y viene):

```sql
SELECT ejecutado_en, estado, aviso_abierto
FROM public.salud_sistema_chequeos
ORDER BY ejecutado_en DESC
LIMIT 48;
```

Correrlo ahora mismo, sin esperar a la hora (no manda avisos ni guarda nada):

```sql
SELECT jsonb_pretty(public.chequeo_salud_sistema());
```

---

## 3. Activar los avisos

Mientras no exista el secreto `alerta_webhook_url` en el Vault, el chequeo corre y guarda resultados pero **no avisa a nadie**.
Para activarlo hace falta una dirección de webhook que acepte un JSON con el campo `content` (Discord) o `text` (Slack).

### Discord (lo más simple)
1. En un servidor de Discord propio (puede ser uno privado de dos personas): canal de texto → ⚙️ *Editar canal* → *Integraciones* →
   *Webhooks* → *Nuevo webhook* → *Copiar URL del webhook*.
2. En el SQL Editor de Supabase (una sola vez):

```sql
SELECT vault.create_secret(
  'PEGAR_ACÁ_LA_URL_DEL_WEBHOOK',
  'alerta_webhook_url',
  'Webhook de avisos del chequeo de salud'
);
```

3. Probar que llega, sin esperar a un problema real:

```sql
SELECT public.ejecutar_chequeo_salud(
  '{"estado":"atencion","chequeos":[{"codigo":"prueba","titulo":"Prueba de aviso","estado":"atencion","detalle":"Si lo ves, los avisos funcionan."}]}'::jsonb
);
-- Es "atención": el primero no avisa (espera a que se repita). Correrlo una segunda vez y llega el mensaje.
-- Después limpiar el rastro de la prueba:
DELETE FROM public.salud_sistema_chequeos WHERE resultado -> 'chequeos' -> 0 ->> 'codigo' = 'prueba';
```

### Slack
Igual, con un *Incoming Webhook* de Slack. El mensaje viaja en `text`.

### Cambiar o apagar
- Cambiar la dirección: `SELECT vault.update_secret((SELECT id FROM vault.secrets WHERE name = 'alerta_webhook_url'), 'NUEVA_URL');`
- Apagar los avisos (el chequeo sigue corriendo): `DELETE FROM vault.secrets WHERE name = 'alerta_webhook_url';`
- Apagar todo: `SELECT cron.unschedule('chequeo-salud-sistema-cada-hora');`

**Ojo:** la URL del webhook es un secreto (quien la tiene puede escribir en el canal). No se pega en el repo, ni en un chat, ni
en un ticket.

---

## 4. Cuándo avisa (para que no llene el canal de ruido)

- **Crítico:** avisa en la primera corrida en que aparece.
- **Atención:** espera a aparecer en **dos corridas seguidas** (descarta los tropiezos de una sola hora).
- Una vez que avisó, **no repite** hasta que **empeore** (atención → crítico) o pasen **12 horas** sin resolverse (recordatorio).
- Cuando todo vuelve a `ok` después de un aviso, manda **un solo mensaje** de "normalizado".
- El mensaje lleva solo títulos y cantidades. Nunca nombres de clientes, proveedores ni usuarios.

---

## 5. Qué hacer cuando llega un aviso

| Aviso | Qué suele ser | Primer paso |
|---|---|---|
| **Tareas programadas atrasadas** | El cron de Supabase se detuvo o una tarea quedó trabada | `SELECT jobname, max(start_time) FROM cron.job j JOIN cron.job_run_details d USING (jobid) GROUP BY 1;` Si ninguna corre: revisar el estado del proyecto en el panel de Supabase (pausado, base en solo lectura por espacio). |
| **Respuestas de los procesos** con muchos 401/403 | Los workers están rechazando al cron (secreto compartido de la mig. 415 mal puesto, o rotado sin actualizar) | Confirmar que existe el secreto `cron_secret` en el Vault y que los 8 workers están desplegados con la versión que lo verifica. |
| **Respuestas** con 5xx o "sin respuesta" | Un servicio externo caído (ARCA, Mercado Pago, Tiendanube, MercadoLibre) o una Edge Function que falla | Panel de Supabase → Edge Functions → *Logs* de la función. Un 1–2 % de "sin respuesta" suelto es normal. |
| **Cola de ARCA** atascada | El `arca-worker` no procesa (ARCA caído, certificado vencido, punto de venta mal) | Mirar `facturas_pendientes_arca` (estado, `error_mensaje`) y los logs de `arca-worker`. |
| **Cola de ARCA** con error nuevo | Un comprobante falló por datos (ej. una ND sin comprobante de origen autorizado) | Verlo en el panel de cola de ARCA de la app; corregir el dato y reencolar, o darlo de baja. |
| **Integraciones atascadas** | Token vencido de Tiendanube / MercadoLibre, o el canal caído | Reconectar la integración desde Configuración → Integraciones. |
| **QR vencidos sin baja** | El `mp-qr-poller` no está corriendo | Logs de `mp-qr-poller`; confirmar que la tarea `mp-qr-poller-every-1-min` corre. |
| **Cotización del dólar** vieja | Cayó `dolarapi.com` o la función `tc-diario-sync` | Logs de `tc-diario-sync`; mientras tanto se puede cargar el tipo de cambio a mano. |
| **Espacio de la base** | Crecimiento normal o algo que no se purga (historial de cron, `audit_log`) | Ver qué tabla crece: `SELECT relname, pg_size_pretty(pg_total_relation_size(oid)) FROM pg_class WHERE relkind='r' ORDER BY pg_total_relation_size(oid) DESC LIMIT 10;` Decidir purga o plan Pro. |
| **Documentos sin asiento** | Una venta/compra quedó sin asiento contable (el paso "no bloqueante" falló) | Reporte *Conciliación de cuentas de control* → "Documentos sin asiento"; regenerar el asiento desde el documento. Ver hallazgo CON-7. |
| **Asientos descuadrados** | No debería pasar (hay un trigger que lo impide). Si pasa, es grave | Avisar a Claude Code / Nadia de inmediato; no operar esa empresa hasta revisarlo. |
| **Registros nuevos** con pico | Alguien está creando cuentas basura (registro público abierto) | Decidir el cierre del registro público (hallazgo SEG-5) y limpiar las cuentas sin uso. |

---

## 6. Lo que este chequeo NO ve (y cómo cubrirlo)

| Falta | Cómo cubrirlo |
|---|---|
| **Errores del navegador** (una pantalla que se rompe al usuario) | Sentry (u otro): hay que crear la cuenta y pasar el DSN. Ver `PENDIENTES_LUCIANO_AUDITORIA.md`. Mientras tanto solo existe el `SectionErrorBoundary`, que muestra un cartel al usuario pero no avisa a nadie. |
| **Errores internos de las Edge Functions** que igual devuelven 200 | Panel de Supabase → Edge Functions → Logs. El chequeo solo ve el código HTTP que devolvió la función. |
| **Copias de seguridad** | No se puede medir desde la base. Con plan Pro: Supabase → Database → Backups. Ver `PLAN_DE_RECUPERACION.md`. |
| **Caída del sitio en Vercel** | El chequeo corre en la base, no en la web. Un servicio de "uptime" gratuito (UptimeRobot, Better Stack) que consulte la URL de producción cada 5 minutos lo cubre. |
| **Vencimiento del certificado de ARCA** | Anotar en el calendario la fecha de vencimiento del certificado de cada empresa (figura en el propio certificado; suele ser de 2 años) con un aviso 30 días antes. |
