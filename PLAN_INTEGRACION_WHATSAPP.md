# Plan de Integración con WhatsApp — KAIROX Gestión

**Estado:** planificado, sin construir. Preparado el 29/09 a pedido de Luciano para encararlo más
adelante. No requiere ninguna acción hasta que se decida arrancar.

---

## 0. Punto de partida (verificado en el código, no supuesto)

**Ya existe:**
- Botón "WhatsApp" en `ReportHeader.jsx`, `ModalDetalleEntrega.jsx`, `ModalDetalleCotizacion.jsx`: es
  un deep-link `wa.me` client-side — el usuario adjunta el PDF a mano. Cero API, cero backend.
- `TabIntegraciones.jsx` ya tiene la card "WhatsApp Business" en estado `proximamente`.
- `ROADMAP.md` y `CONTEXT.md` ya lo marcan como el único ítem real de "construir" que queda del
  roadmap — "bajo esfuerzo, alto valor".
- `clientes.telefono` ya existe (`ClientesSection.jsx`) — el dato de contacto está.
- Framework de integraciones por-tenant maduro en `supabase/functions/_shared/integraciones.ts`:
  OAuth por empresa, token en Vault, tabla `integraciones_canales` (empresa_id + canal + config).
  Soporta hoy `tiendanube | shopify | mercadolibre` — sumar `'whatsapp'` es estructuralmente directo.

**Gap más grande, no obvio a simple vista:** todo PDF en KAIROX se genera client-side con jsPDF
(`src/lib/pdfUtils.js`) y nunca se guarda en Storage ni tiene URL pública. Cualquier envío
automático necesita un documento con URL servible o subible como media — hoy no existe.

**Fuera de este plan a propósito** (pedido explícito de Luciano — "dejemos de lado las APIs y
costos"): elegir Cloud API directa de Meta vs. un BSP (360dialog, Twilio, Gupshup...), el trámite de
alta como Tech Provider ante Meta, y los costos por mensaje. Ver memoria de sesión
`project_whatsapp_integracion_panorama.md` para ese análisis completo (modelo centralizado vs.
por-tenant, comparativa de proveedores, novedades de precios 2026).

---

## Fases — de menor a mayor esfuerzo

### Fase 0 — Higiene de datos de contacto
- Normalizar `clientes.telefono` a formato internacional E.164 (`+54 9 11 ...`) — WhatsApp exige ese
  formato exacto, no acepta "011-4555-1234" ni "15-4555-1234".
- Migración de limpieza sobre los teléfonos ya cargados + validación en el form de alta/edición para
  que no se rompa de nuevo.
- Columna nueva `clientes.acepta_whatsapp` (boolean, default `false`) — checkbox en el alta, para
  tener el opt-in resuelto de antemano (Ley 25.326).
- **Tiempo estimado:** 1 sesión.

### Fase 1 — Comprobantes con URL propia (el gap más grande)
- Edge Function que genera el PDF de Factura/Comprobante en el servidor (Deno), reusando el mismo
  layout de `pdfUtils.js` ya aprobado visualmente.
- Bucket privado en Supabase Storage + URLs firmadas de corta duración (los comprobantes llevan
  CUIT y montos, no pueden quedar públicos para siempre).
- Sirve para más que WhatsApp a futuro (mail, portal de cliente), pero acá es prerrequisito duro.
- **Tiempo estimado:** 2-3 sesiones (la parte más laboriosa).

### Fase 2 — Modelo de datos genérico de mensajería saliente
- Sumar `'whatsapp'` al enum `Canal` de `integraciones_canales` (reserva el lugar, sin conectar
  nada real todavía).
- Tabla nueva `mensajes_salientes`: `empresa_id`, `cliente_id`, `tipo`, `destino`, `estado`,
  `proveedor_message_id`, `intentos` — pensada para que no importe si mañana el proveedor es Meta
  directo o un BSP.
- RLS estándar (`empresa_id`).
- **Tiempo estimado:** 1 sesión.

### Fase 3 — Capa de envío desacoplada (adapter) + cola de reintentos
- Función `enviarMensajeWhatsApp(destino, plantilla, variables)` con un adapter "de mentira" (no
  llama a ninguna API real todavía) — mismo patrón que ya usa `integraciones.ts` por canal.
- Worker de reintentos (mismo patrón que los 8 workers de la auditoría de seguridad de 09/2026) para
  mensajes en estado pendiente/fallido.
- El día que se elija proveedor, conectarlo de verdad es reemplazar un solo adapter, no rediseñar.
- **Tiempo estimado:** 2 sesiones.

### Fase 4 — Enganchar los disparadores reales de negocio
- Al confirmar una venta/factura → encola comprobante.
- Vencimiento de CC / cheque por vencer (`useNotifications.js`, ver
  `project_alertas_notificaciones_config_muerta.md`) → encola recordatorio.
- Toggle por empresa para prender/apagar el envío (mismo patrón que `usaEcommerce`, mig.236).
- **Tiempo estimado:** 1-2 sesiones.

### Fase 5 — UI de conexión y seguimiento
- Reemplazar la card "Próximamente" de `TabIntegraciones.jsx` por un flujo real de "Conectar"
  (placeholder hasta elegir proveedor).
- Historial de envíos por cliente (mismo lugar que `ClienteDrillDown`) — qué se mandó, a quién, si
  llegó.
- **Tiempo estimado:** 2 sesiones.

### Fase 6 — Conectar el proveedor real (fuera de este plan)
- Acá entran las decisiones que dejamos de lado a propósito: elegir API/BSP, alta como Tech
  Provider, costos por mensaje. Con las Fases 0-5 hechas, se reduce a escribir un solo adapter
  concreto — no toca el resto del sistema.

---

## Total estimado

**~9-11 sesiones de trabajo antes de necesitar elegir proveedor** (al ritmo de este proyecto —
Claude + Nadia — no es una estimación de equipo tradicional; puede comprimirse encarando varias
fases seguidas).

## Próximo paso sugerido

Empezar por la Fase 0 (higiene de datos) cuando se decida encararlo — es la más chica y desbloquea
todo lo demás. La Fase 1 (PDF server-side) es la que más conviene planificar con detalle antes de
tocar código, por ser la más grande.
