# KAIROX Gestión — Contexto de Sesión
**Última actualización:** 2026-07-01 (sesión 39 Nadia — seguridad + formato ARS + responsive)

## Sesión 39 — Nadia (2026-07-01) — Seguridad + formato ARS + responsive

### Migrations aplicadas
- **121** — agrega 'caja' a movimientos_bancarios_origen_check

### Archivos modificados
- CajaSection.jsx — formato números es-AR (FIX-FORMATO-ARS)
- ConfiguracionSection.jsx — select MP sin access_token + URL webhook oculta Eye/EyeOff (SECURITY-WEBHOOK-URL)
- ConfigMercadoPagoModal.jsx — token no viaja al frontend, placeholder dinámico, upsert condicional (SECURITY-SENSITIVE-DATA)
- CuentasBancariasSection.jsx — CBU oculto con toggle Eye/EyeOff (SECURITY-SENSITIVE-DATA)
- useConfirmarVenta.js — p_pedido_id null (FIX-CREAR-VENTA-V3)
- HistorialVentas.jsx — whitespace-nowrap (RESPONSIVE-TABLE)
- ClientesSection.jsx — whitespace-nowrap (RESPONSIVE-TABLE)

### Validado en browser
- Montos en Caja muestran $1.000,00 (antes $1,000.00)
- Token MP no aparece en DevTools Network
- CBU oculto por defecto, ojito lo revela
- URL webhook oculta en Configuración
- Ventas con Transferencia impactan automáticamente en Bancos
- Tablas Historial y Clientes con scroll horizontal en mobile

### Bug reportado para Luciano
- Puente Caja→Bancos funciona para ventas (ingresos) pero NO para egresos manuales con Transferencia — el INSERT directo a movimientos_caja no tiene RPC ni trigger que cree el movimiento bancario correspondiente. Requiere fix en backend.

### Pendiente
- Webhook MP: Luciano registra URL en panel MP Developers
- Retiros MP: Released Money report API
- AFIP producción: cert real + PdV real (trámite Luciano)
- Fidelización por puntos (Fase 2)
- Billing MercadoPago Suscripciones

## Sesión 38 — Luciano (2026-06-30) — Guards de tenant en RPCs restantes (frente pendiente de PLAN_SEMANA.md §8)

### Metodología
Listadas las 27 funciones `SECURITY DEFINER` del schema público (excluyendo triggers). Las de
venta/compra/stock ya estaban auditadas (sesiones 36-46). De las 13 restantes con `p_empresa_id`
como parámetro, se leyó el body completo de cada una buscando el guard
`p_empresa_id = get_my_empresa_id()` antes de cualquier lectura/escritura.

### 🔴 Hallazgo real — `calcular_ofertas_carrito` sin ningún guard (migration 120, aplicada ✅)
Cero validación de tenant. Cualquier usuario autenticado podía pasar el `empresa_id` de otra
empresa y la función devolvía sus ofertas activas (nombre, tipo/valor de descuento, medio de
pago, vigencia) — fuga de información comercial cross-tenant. **Verificado antes y después**:
la misma llamada que en sesión 35 devolvía el descuento real del Termo Stanley, ahora lanza
`No autorizado: empresa_id no coincide con el usuario autenticado`. Firma de la función sin
cambios — el frontend no requiere ningún ajuste.

### Casos revisados y descartados (guard correcto o no aplica, sin cambios)
- `crear_nota_debito`, `usar_caea_en_venta`, `reencolar_caes_pendientes`,
  `insertar_movimiento_bancario_externo` (2 overloads), `fecha_en_periodo_cerrado`,
  `seed_plan_cuentas`, `siguiente_numero_documento`: guard correcto tal cual está.
- **`seed_maestros_default` / `seed_series_numeracion`**: el guard tiene una excepción
  cuando `profile.empresa_id` del caller es `NULL` — **verificado que es intencional y
  necesario**: se disparan desde `trg_empresa_seed_maestros`/`trg_empresa_seed_series_numeracion`
  (`AFTER INSERT ON empresas`), que corren **dentro** de `create_tenant`, en el instante en que
  el perfil del usuario todavía no tiene `empresa_id` asignado (el INSERT a `profiles` es el
  paso siguiente). Sacar la excepción rompería el alta de **toda empresa nueva**. Riesgo residual
  mínimo: solo permite insertar filas default no sensibles (`Unidad`, `Contado`, etc.) con
  `ON CONFLICT DO NOTHING`, nunca pisa datos reales. **No se toca.**
- `check_rate_limit` / `record_attempt`: no manejan datos de tenant expuestos (rate limiting
  por `identifier`, no filtran por empresa en la lectura). Sin impacto explotable.
- `create_tenant`: auto-scoped a `auth.uid()`, no puede targetear otra empresa por diseño.
- `siguiente_numero_documento`: guard correcto, pero confirmado sin callers en el frontend
  (candidato a código muerto — fuera de alcance de esta auditoría de seguridad).

### Pendiente real para próximas sesiones

**Objetivo de Luciano:** cerrar la "parte central" (core transaccional/fiscal/seguridad) para
pasar a ajustes de diseño. Plan de acción ordenado por prioridad:

**Frente 1 — Bloqueante de negocio real (requiere acción externa de Luciano primero)**
- AFIP a producción: conseguir cert real (no homologación) + PdV real de AFIP →
  una vez que Luciano tenga esos 2 insumos, la sesión siguiente solo necesita cargarlos
  y setear `AFIP_ENVIRONMENT=production` (trabajo técnico corto, ya está todo el circuito
  WSAA→WSFE probado en homologación desde sesión 64)
- Confirmar valor actual de `AFIP_ENVIRONMENT` en Dashboard → Edge Functions → Secrets
  (pendiente desde sesión 30, nunca verificado)

**Frente 2 — Auditoría técnica acotada (100% ejecutable sola, sin depender de Luciano)**
- Precisión de cálculos financieros: redondeo de IVA discriminado, consistencia entre
  `ROUND()` de SQL vs `Math.round` de JS, moneda paralela (`monto_paralelo`/`tc_paralelo`)
- Patrones de manejo de errores silenciosos fuera de `stock_actual` (grep de
  `console.error`/`console.warn` dentro de `catch` que deberían propagar el error)

**Frente 3 — Decisiones rápidas de Luciano (5 minutos cada una, no bloquean nada más)**
- ¿Plan Pro de Supabase? (leaked password protection)
- ¿Qué hacer con `xlsx` sin fix de seguridad? (tolerar / migrar a `exceljs`)
- ¿Aplicar `npm audit fix --force`? (bump mayor de `vite` 4→8 y `jspdf` — requiere testing manual post-upgrade)
- Registrar la URL de webhook MP en el panel de MercadoPago Developers (2 minutos, la URL ya está en Configuración → Integraciones)

**Frente 4 — Bugs menores con decisión de negocio pendiente**
- Dropdown "Nota de Débito" en devolución a proveedor sigue mandando `nota_credito` al backend
- "Convertir Ticket → Factura" desde el historial — no implementado, ¿un ticket no-fiscal puede pasar a fiscal después?

**Roadmap — explícitamente pospuesto, no es parte del "core"**
- Programa de fidelización por puntos
- Multi-sucursal
- Retiros/egresos de MP (Released Money API)
- 78 índices "sin uso" — monitorear con tráfico real antes de decidir, no tocar todavía

## Sesión 37 — Luciano (2026-06-30) — Cierre de cabo suelto + residuos + afip_tickets

### Cabo suelto cerrado
- `ConfiguracionSection.jsx`: agregado guard `if (user?.role !== 'admin') return <mensaje...>` antes del
  render principal (mismo patrón que `OfertasSection`/`UsuariosSection`). Consistente con migration 119
  (escritura de `configuracion` es admin-only a nivel RLS desde la sesión anterior) — ahora un staff
  ni siquiera ve el formulario que le rechazaría el guardado.

### ⚠️ Corrección importante sobre "Leaked Password Protection"
Encontrado en `PLAN_SEMANA.md` (no lo sabía al reportar en la sesión anterior): **no es un simple
toggle**. Luciano ya lo intentó activar — Supabase pide **plan Pro** para esta función (el proyecto
`NALUX` está en plan **Gratis**). Queda como decisión de negocio (¿vale la pena el upgrade?), no como
tarea técnica pendiente. Riesgo aceptado documentado: sin esto, no hay una capa extra contra
contraseñas reusadas/filtradas, pero no es explotable directamente.

### Limpieza de documentación (root)
- **Eliminados** (obsoletos, contenido superado por `CONTEXT.md` o por trabajo ya completado):
  `DIAGNOSIS.md` (describía una arquitectura `tenant_id` abandonada, contradice el modelo actual
  `empresa_id` — activamente confuso si se lee ahora), `STATUS_REPORT.md` (snapshot feb-2026 superado),
  `AUDITORIA.md` (snapshot jun-03 superado), `SUPABASE_ANALISIS.md` (análisis del bug de recursión RLS
  ya resuelto, superado por `SUPABASE_SETUP.md`), `PLAN_AUDITORIA_2.md` (plan cuyos ítems están
  duplicados/subsumidos en la sección 8 de `PLAN_SEMANA.md`, que se mantiene por tener ítems reales aún
  abiertos).
- **Mantenidos:** `PLAN_SEMANA.md` (tiene pendientes reales no confirmados como resueltos: guards de
  tenant en RPCs de cheques/retenciones/asientos contables, precisión de cálculos financieros — fuera del
  alcance de esta auditoría), `COLABORADOR.md` y `CAEA_IMPLEMENTACION.md` (docs vigentes de features
  reales), `SUPABASE_SETUP.md` (guía de disaster-recovery aún válida), `TESTING_ROADMAP.md` (checklist QA
  reusable).
- **Fix menor:** puerto de dev incorrecto en `COLABORADOR.md` (5173→3000) y `TESTING_ROADMAP.md`
  (3001→3000) — el real es 3000 (`package.json`).

### Corrección sobre `mp-verify-token`
Reportado antes como posible edge function muerta — **falso**: `ConfigMercadoPagoModal.jsx` la invoca
2 veces (verificación de token MP). No se toca.

### `arca-diag` — ✅ eliminada
Confirmado residuo (sin código local, cero referencias en frontend). Borrada a mano por Luciano desde
el Dashboard de Supabase (sin tool de MCP para esto). Verificado con `list_edge_functions`: ya no
aparece en la lista.

### npm audit
`npm audit fix` (sin `--force`, solo cambios sin breaking changes): **26 → 6 vulnerabilidades**. Build
verificado post-fix (exit 0). Las 6 restantes (`vite`, `esbuild`, `jspdf`, `jspdf-autotable`, `dompurify`,
`xlsx`) requieren bump mayor (`vite` 4→8 es un salto grande) o no tienen fix (`xlsx` — sin fix disponible
en absoluto). **No aplicado `--force`** — requiere decisión explícita, no es seguro a ciegas.

### Auditoría de `console.log`/`console.error` — limpia
Grep dirigido a variables sensibles (password, token, secret, cvv, cbu, tarjeta, api_key, jwt,
credential) en `src/` y `supabase/functions/`: **0 coincidencias**. También se verificó que no se
loguea la respuesta completa de MercadoPago (`pago`/`payment`/`response`) en `mp-sync`/`mp-webhook`.
Sin acción necesaria.

### `afip_tickets` — confirmado correcto, no es una falla
Guarda `token`/`sign` (Ticket de Acceso WSAA de AFIP, credencial de sesión ~12h). El advisor
`rls_enabled_no_policy` (nivel INFO, el más bajo) lo marcaba, pero es **diseño deliberado y ya
documentado desde migration 099 (sesión 63)**: RLS habilitado sin políticas = deny-all para
anon/authenticated, solo `service_role` accede (bypassa RLS). Confirmado en código: `_shared/wsaa.ts`
usa el cliente `admin` (service_role), nunca un cliente scoped a usuario. **No requiere ningún cambio.**

### Pendiente real para próximas sesiones
- Decisión de negocio: upgrade a plan Pro de Supabase para leaked password protection
- `npm audit fix --force` — evaluar caso por caso (especialmente reemplazar `xlsx`, que no tiene fix)
- Ítems de `PLAN_SEMANA.md` sección 8 (guards de RPCs no-stock, precisión financiera) — no auditados aún

## Sesión 36 — Luciano (2026-06-30) — Auditoría general del sistema + hardening

### 🔴 CRÍTICO resuelto — fuga cross-tenant de claves AFIP
- **Migration 113** — `vault_secret_read(text)` tenía EXECUTE para `authenticated` (migration 091)
  y hacía `SELECT decrypted_secret ... WHERE name = p_name` SIN filtro de empresa. Cualquier
  usuario logueado podía leer la clave privada AFIP (`afip_key_<otra_empresa>`) o el certificado
  de CUALQUIER empresa vía `/rest/v1/rpc/vault_secret_read` → suplantación fiscal.
- **Fix:** nueva función `afip_cert_status()` (SECURITY DEFINER) que devuelve SOLO un booleano
  scoped a `get_my_empresa_id()`, sin exponer el secreto. REVOKE de `vault_secret_read` a
  authenticated/public/anon → vuelve a ser service_role-only (invariante restaurado).
- **Frontend:** [ConfiguracionSection.jsx:255](src/components/sections/ConfiguracionSection.jsx)
  ahora llama `afip_cert_status` en vez de leer el secreto. Verificado: ACL = solo postgres/service_role.

### 🟠 Hardening — funciones-trigger no invocables como RPC
- **Migration 114** — REVOKE EXECUTE de 15 funciones que devuelven `trigger`
  (`fn_update_cliente_saldo`, `handle_new_user`, `fn_oc_update_stock`, `sync_uala_to_bancos`,
  `fn_queue_factura_arca`, etc.) a PUBLIC/anon/authenticated. Una función-trigger nunca debe ser
  RPC-callable. SEGURO: la ejecución de un trigger no chequea EXECUTE. Verificado: 0 trigger-fns expuestas.

### 🟢 Performance — saldo bancario agregado en SQL
- **Migration 115** — RPC `saldos_bancarios()` calcula `Σ(ingreso) − Σ(egreso)` por cuenta en la
  base (antes: traía TODOS los movimientos al cliente y sumaba en JS). SECURITY DEFINER scoped a empresa.
- `cuentasBancariasService.getSaldos()` nuevo método; `CuentasBancariasSection` usa la RPC.
  `computeSaldos` queda como helper (sin uso directo).

### 🧹 Limpieza
- Borrada carpeta `./migrations` vacía (residuo del split histórico; la real es `supabase/migrations`).

### 🟢 Performance (tanda 1 — toda aplicada ✅)
- **Migration 116** — 18 índices btree en foreign keys que no tenían índice de cobertura
  (cotizaciones.cliente_id, pedidos.cliente_id, productos.categoria_id, comprobante_items.oferta_id,
  etc.) → joins y DELETE/cascade más rápidos.
- **Migration 117** — drop del constraint UNIQUE duplicado `uq_comprobantes_empresa_numero`
  (idéntico al original `comprobantes_empresa_id_numero_venta_key`, que se mantiene). Unicidad intacta.
- **Migration 118** — consolidadas políticas RLS redundantes en cuenta_corriente_movimientos /
  proveedores / tipos_cambio (2 policies con USING idéntico → 1). Sin cambio de permisos efectivos.
- **Migration 119** — `configuracion`: reescritas 9 policies solapadas → 4 limpias.
  **Cambio de comportamiento (decidido por Luciano):** lectura abierta a la empresa, pero
  **escritura (insert/update/delete) ahora SOLO admin** (`is_admin()`). Antes cualquier usuario de
  la empresa podía editar config. ⚠️ Follow-up sugerido: gatear ConfiguracionSection en la UI a
  admins (hoy un no-admin que abra Configuración y guarde recibirá error RLS).
- **NO tocado:** `profiles` (policies admin/self distintas a propósito).
- **NO tocado (deliberado):** 78 unused_index — en DB joven "sin uso" suele ser "no ejercitado aún";
  dropearlos a ciegas es riesgoso. Monitorear con tráfico real antes de borrar.

### Auditoría completa — pendientes detectados (NO resueltos aún, para priorizar)
- **Seguridad:** `afip_tickets` con RLS sin policy (1 fila); `auth_leaked_password_protection`
  desactivado (toggle de panel); `pg_net` en schema public.
- **Performance advisors (192):** 95 multiple_permissive_policies, 78 unused_index,
  18 unindexed_foreign_keys, 1 duplicate_index.
- **Residuos:** edge functions muertas (`arca-diag`, `emitir-cae` stub 410, `mp-verify-token`);
  ~12 .md en root posiblemente obsoletos; 91 console.log en 35 archivos; 26 vulnerabilidades npm.
- **Deuda:** AFIP a producción (cert real + `AFIP_ENVIRONMENT=production`); bundle 3,26 MB sin
  code-splitting; sin tests automatizados de RLS multi-tenant; retiros/egresos MP; webhook MP.

---

## Sesión 35 — Luciano (2026-06-30) — Puente Caja↔Bancos + Fixes varios

### Migrations aplicadas
- **110** — REVOKE anon en `calcular_ofertas_carrito` (SECURITY DEFINER sin REVOKE en migration 108)
- **111** — tabla `metodo_pago_cuenta_bancaria`: mapea métodos de pago del POS a cuentas bancarias
- **112** — `crear_venta` v3: puente Caja↔Bancos — inserta `movimiento_bancario` automático cuando hay mapeo activo en migration 111. Efectivo y CC nunca crean movimiento bancario.

### Archivos modificados
- `supabase/functions/mp-sync/index.ts` — `METHOD_LABEL` map: `account_money` → "Billetera MercadoPago", `cvu` → "Transferencia CVU", etc. Deployada como v4 (ACTIVE).
- `src/components/sections/ConfiguracionSection.jsx` — nueva sección "Puente Caja → Bancos" en tab Integraciones: dropdown Transferencia/Tarjeta → cuenta bancaria, upsert/delete con toggle.
- `src/components/sections/ProductosSection.jsx` — responsive fix tabla movimientos inventario: wrapper `overflow-x-auto` + `whitespace-nowrap` en th.

### Validado
- `calcular_ofertas_carrito` RPC: Termo Stanley $65.000 → desc $6.500 (10%) → $58.500 ✅
- Build producción: exit 0 ✅
- mp-sync v4 deployada y activa en Supabase ✅
- Vercel deploy: READY ✅

### Cómo usar el Puente Caja↔Bancos
1. Ir a Configuración → Integraciones → sección "Puente Caja → Bancos"
2. Para cada método (Transferencia, Tarjeta) seleccionar la cuenta bancaria destino
3. Click "Guardar mapeo"
4. Desde ese momento, cada venta confirmada con ese método creará un `movimiento_bancario` automático con `origen='caja'`

### Pendiente para próximas sesiones
- **AFIP camino a producción**: cert real + PdV real + `AFIP_ENVIRONMENT=production` en Supabase Secrets
- **Probar venta real desde UI** con el puente bancario activo (configurar mapeo y hacer venta de prueba)
- **Webhook MP**: registrar URL en panel MP Developers (decisión de Luciano)
- **Retiros/egresos MP**: Released Money report API — arquitectura pendiente
- **Programa de fidelización por puntos** — Complejidad M
- **Multi-sucursal** — Complejidad L, requiere coordinación de schema

---

## Sesión 34 — Nadia (2026-06-30) — Responsive mobile + Fixes Bancos/MP

### Migrations aplicadas
- **109** — cron mp-sync cada 2 minutos (antes 30 min, migration 107)

### Archivos modificados
- `src/components/caja/ModoCajaLayout.jsx` — POS mobile: state tabMobile,
  tab bar md:hidden con badge contador, wrapper flex-col md:flex-row,
  wrappers condicionales para PanelProductos y PanelCarrito, botón 
  flotante "Ver carrito" con total y contador
- `src/components/caja/PanelCarrito.jsx` — w-full md:w-[360px] lg:w-[420px]
- `src/components/sections/DashboardSection.jsx` — hero row: 
  grid-cols-1 sm:grid-cols-[1.4fr_1fr_1fr]
- `src/services/cuentasBancariasService.ts` — nuevo key 
  CB_KEYS.movimientosSaldo para query sin filtros
- `src/components/sections/CuentasBancariasSection.jsx` — query 
  movimientosParaSaldo separada (FIX-SALDO-REAL), botón Actualizar 
  con handler handleSyncMP (FIX-MP-SYNC)
- `supabase/functions/mp-sync/index.ts` — CORS headers + OPTIONS 
  temprano (FIX-CORS-MP-SYNC), redeployada como v2

### Validado en browser
- POS mobile: tabs Productos/Carrito funcionando en iPhone SE 375px,
  botón flotante aparece al agregar producto, desktop sin cambios
- Dashboard mobile: hero row apila en 1 columna en mobile
- Bancos: saldo total se mantiene fijo al aplicar filtro Tipo=Ingresos
- Botón Actualizar: toast verde, sin error CORS, sync manual funcional
- Transferencia real de prueba a MP captada correctamente como ingreso

### Pendiente para próximas sesiones
- Webhook MP: registrar URL en panel MP Developers — decisión de Luciano
- Retiros/egresos de MP: Released Money report API — arquitectura pendiente
- Puente Caja ↔ Cuentas Bancarias: cuando Caja registra Transferencia/
  Tarjeta, debería impactar la cuenta bancaria correspondiente, no Caja
- Responsive tablas: Historial/Clientes/Inventario con scroll visible
- Auditoría seguridad: datos bancarios/financieros (CBU, tokens MP)

## Sesión 33 — Nadia (2026-06-29) — Motor de Ofertas completo

### Migrations aplicadas
- **108** — tabla `ofertas` + RLS + índices parciales + 5 columnas nuevas 
  en `comprobante_items` + 2 columnas en `comprobantes` + RPC 
  `calcular_ofertas_carrito` + `crear_venta` v2 backward compatible
  (106 y 107 ya estaban ocupadas por Luciano con mp-sync)

### Archivos nuevos
- `src/components/sections/OfertasSection.jsx` — panel admin completo:
  guard de rol admin, stats row, tabla con badges/chips/toggle, 
  modal crear/editar con 14 campos (nombre, tipo descuento, valor, 
  producto, categoría, medio de pago, días semana, monto mínimo, 
  cantidad mínima, vigencia, prioridad, acumulable)

### Archivos modificados
- `src/components/Sidebar.jsx` — entrada "Ofertas" con ícono Percent en grupo VENTAS
- `src/components/Dashboard.jsx` — import + case 'ofertas' en renderSection
- `src/components/caja/ModoCajaLayout.jsx` — states ofertasCarrito + 
  descuentosManuales + medioPagoSeleccionado, función calcularOfertas 
  con debounce 300ms, useEffect recalcula al cambiar carrito o medio de pago,
  snapshot ofertasCarrito en handleVentaExitosa, reset en venta exitosa,
  prop ofertasCarrito en TicketPrint
- `src/components/caja/PanelCarrito.jsx` — state metodo subido a 
  ModoCajaLayout como prop, helper getPrecioConDescuento(), precios 
  con descuento + precio original tachado + badge oferta, input descuento 
  manual por item (visible si oferta es acumulable o no hay oferta), 
  total/totalSinDescuento con línea de ahorro, handleConfirmar pasa 
  ofertasCarrito y descuentosManuales
- `src/hooks/useConfirmarVenta.js` — recibe ofertasCarrito y descuentosManuales,
  itemsPayload incluye precio_original/descuento_pct/descuento_monto/
  oferta_id/descuento_manual_pct, total calculado con precios finales
- `src/components/caja/TicketPrint.jsx` — prop ofertasCarrito, getPunit() 
  usa precio_final de oferta, línea indentada con nombre oferta y monto 
  en 80mm, fila extra en A4, sección Subtotal/Descuentos/TOTAL cuando 
  hay descuento

### Validado en browser
- Oferta "Descuento transferencia 10%" creada y activa
- POS: precio tachado + precio final verde + badge oferta + ahorro visible
- Descuento aplicado automáticamente al seleccionar medio de pago Transferencia
- Venta confirmada con total correcto ($67.500 sobre $75.000)
- Ticket 80mm y A4: nombre oferta + monto descontado + Subtotal/Descuentos/TOTAL
- Mi Turno: montos registrados correctamente

### Pendiente para próximas sesiones
- Vista mobile optimizada — complejidad S (diagnóstico pendiente)
- Programa de fidelización por puntos — complejidad M
- Multi-sucursal — complejidad L, coordinar con Luciano
- Fase 3: Asistente IA, Tiendanube/ML, API pública REST

## Sesión 32 — Nadia (2026-06-27) — Scanner + Impresión ticket

### Migration aplicada
- **105** — `codigo_barras varchar(50)` en tabla `productos` + índice parcial
  `(empresa_id, codigo_barras) WHERE codigo_barras IS NOT NULL`

### Archivos modificados
- `src/components/caja/PanelProductos.jsx` — 3 bloques // SCANNER:
  refocus global (excepto modales Radix y inputs editables),
  Enter handler con query exacta por `codigo_barras`, toast 1.5s
- `src/components/sections/ProductosSection.jsx` — campo "Código de barras
  (EAN/UPC)" en form alta/edición, `codigo_barras` en initialState +
  payloads create/update
- `src/components/caja/TicketPrint.jsx` — **NUEVO** — componente headless
  oculto via `position:absolute left:-10000px`, layout 80mm (monospace)
  y A4 (sans-serif), muestra datos empresa (nombre, CUIT, dirección, tel),
  detalle de items, totales, forma de pago, nota CAE pendiente si
  `usa_factura_electronica=true`
- `src/components/caja/ModoCajaLayout.jsx` — fetch empresa extendido a
  `nombre, afip_cuit, direccion, telefono, usa_factura_electronica`,
  state `ventaExitosa` + `formatoTicket`, `handlePrint(fmt)` con CSS
  inyectado dinámicamente (visibility:hidden, no display:none por bug
  de cascada en #root), Dialog de éxito post-venta con resumen +
  botones "Ticket 80mm" / "Imprimir A4" / "Nueva venta",
  mount permanente de `<TicketPrint>`
- `src/components/caja/PanelCarrito.jsx` — `onVentaExitosa` ahora recibe
  `{ comprobante: result, items: itemsSnapshot }` — snapshot tomado
  ANTES de `onModificarCarrito([])`

### Validado en browser (localhost:3000)
- Scanner: tipear código de barras + Enter agrega producto al carrito
  sin mostrar dropdown, campo se vacía y refocusea
- Producto repetido: incrementa cantidad (× 2), no duplica línea
- Refocus global: clic en carrito → foco vuelve al buscador en 300ms
- Modal éxito: aparece tras confirmar venta con comprobante, total,
  cliente y forma de pago
- Ticket 80mm: preview de impresión correcto con items, totales,
  datos empresa y nota CAE pendiente
- Ticket A4: preview correcto

### Nota técnica
CSS de impresión usa `visibility:hidden` en `body` + `visibility:visible`
en `#kx-ticket-print` en vez de `display:none` — evita bug donde el
padre `#root` con `display:none` cascadea y oculta el ticket anidado.

### Pendiente para próximas sesiones (Fase 2)
- Motor de ofertas configurable (descuentos por producto/categoría/
  medio de cobro/día/monto mínimo con vigencia) — Complejidad M
- Billing MercadoPago Suscripciones (Starter/Pro/Business) — Complejidad M-L
- Programa de fidelización puntos — Complejidad M
- Multi-sucursal — Complejidad L — requiere coordinar schema con Luciano

## Sesión 65 (Luciano) — Fix duplicate key + permission denied + simulación circuito cotización

### Bugs resueltos

- **`duplicate key value violates unique constraint "comprobantes_empresa_id_numero_venta_key"`** (CRÍTICO):
  - **Causa raíz**: `series_numeracion.proximo_numero` para Nalux/venta estaba desincronizado. El POS viejo (`useConfirmarVenta`) usaba `MAX+1` en el frontend SIN incrementar la serie, mientras `NuevaVentaModal` sí llamaba a `obtener_proximo_numero`. Cuando esta sesión unificó el POS a la RPC atómica, el contador ya estaba detrás del máximo real en `comprobantes` → colisión.
  - **Fix inmediato** (sesión 64): `UPDATE series_numeracion SET proximo_numero=6 WHERE...` — devolvió `nuevo_proximo=6`.
  - **Fix durable** ([migration 100](supabase/migrations/100_obtener_proximo_numero_self_heal_venta.sql), **aplicada ✅**): `obtener_proximo_numero` para tipo 'venta' ahora verifica `MAX(numero_venta)` del período actual en `comprobantes` y usa `GREATEST(contador, max+1)` — sólo sube, nunca baja. Imposible colisionar aunque el contador quede atrás por cualquier motivo (import, fix manual, etc.). One-shot UPDATE resincronizó todas las series 'venta' ya desfasadas.
  - **Verificación**: con contador forzado a 2, la RPC devolvió `20260626-006` correctamente (no `20260626-002`). ✅

- **`permission denied for function get_my_empresa_id`** (spam en logs):
  - **Causa raíz**: [migration 063](supabase/migrations/063_revocar_anon_y_search_path.sql) revocó EXECUTE de PUBLIC/anon sobre `get_my_empresa_id`. Pero ~30 políticas RLS en tablas como `comprobantes`, `productos`, `clientes`, `caja`, etc. usan `empresa_id = get_my_empresa_id()` y aplican a PUBLIC (todos los roles, incluido anon). Cuando una query llega en contexto anon (realtime, sesión sin JWT), la policy intenta ejecutar la función → "permission denied" → la query ERRORA en vez de devolver 0 filas.
  - **Por qué es seguro re-grantar**: `get_my_empresa_id` hace `SELECT empresa_id FROM profiles WHERE id = auth.uid()`. Para anon, `auth.uid()` = NULL → devuelve NULL → `empresa_id = NULL` es false → 0 filas. Correcto. Anon NUNCA puede obtener el empresa_id de otro.
  - **Fix** ([migration 101](supabase/migrations/101_grant_get_my_empresa_id_anon.sql), **aplicada ✅**): `GRANT EXECUTE ON FUNCTION public.get_my_empresa_id() TO anon; GRANT ... TO authenticated;`

### Simulación circuito cotización → venta ✅

Flujo verificado en ROLLBACK como usuario Nalux autenticado:

```
COT-00013 (Celulares x1 $30.000, aprobada)
    ↓ obtener_proximo_numero('venta')   → 20260626-006  ✅
    ↓ crear_venta RPC (Celulares x1)   → comprobante_id creado  ✅
    ↓ stock_actual 45 → 44              ✅
    ↓ entrega implícita (origen='implicita', estado='entregado')  ✅
    ↓ movimiento_caja (Transferencia $30.000)  ✅
    ↓ UPDATE cotizaciones SET estado='convertida', comprobante_id=...  ✅
    ↓ ROLLBACK — todo revertido: serie=6, stock=45, cot.estado='aprobada'  ✅
```

No hay errores de duplicate key ni de permissions. El circuito completo funciona.

### Series de numeración Nalux (estado actual)

| tipo_documento | proximo_numero | periodo_actual |
|---|---|---|
| cotizacion | 18 | — |
| venta | 6 | 20260626 |
| pedido | 2 | 20260626 |
| entrega | 50 | 2026 |
| recepcion | 9 | 2026 |
| devolucion | 12 | 2026 |
| nota_debito | 4 | 2026 |

### Pendientes de esta sesión (para próximas)
- **🟡 Probar en la UI real**: hacer una venta desde cotización en producción y verificar que no aparezca el duplicate key (debería estar resuelto con migration 100).
- **🟡 Integración MercadoPago** — planeado para esta sesión, pospuesto por los bugs de facturación.
- **🟡 Confirmar `AFIP_ENVIRONMENT`** en Dashboard → Edge Functions → Secrets.
- **🟡 Borrar `arca-diag`** del Dashboard (no se puede vía MCP).

## Sesión 64 (Luciano) — Cierre POS→CAE, fix fiscal Exento→C, redeploy worker, deprecación emitir-cae

### Lo que se cerró (todo sin depender de pruebas manuales)

- **Hook `useAfipConfig`** ([src/hooks/useAfipConfig.js](src/hooks/useAfipConfig.js)): centraliza la query de config AFIP (empresa + PdV activo) y `determinarTipoComprobante`, compartido entre el POS (`useConfirmarVenta`) y `NuevaVentaModal` (queryKey `['afip-config', empresa_id]` → react-query dedupe). **Fix fiscal:** un **Exento emite Factura C** (no B). Antes `determinarTipoComprobante` sólo contemplaba Monotributo→C y RI→A/B, y el Exento caía al default 'B' — incorrecto (sólo el RI emite A/B). Nalux es Exento → ahora emite C correctamente.
- **Gap POS→CAE cerrado** ([src/hooks/useConfirmarVenta.js](src/hooks/useConfirmarVenta.js)): tras `crear_venta`, si `afipActivo`, hace el UPDATE a `cae_estado='pendiente'` + `tipo_comprobante_afip` + `punto_venta_id` que dispara `fn_queue_factura_arca` → encola en `facturas_pendientes_arca`. Antes toda venta POS quedaba como Ticket aunque AFIP estuviera activo.
- **Numeración POS atómica**: `generateVentaNumber` ahora llama `obtener_proximo_numero('venta')` (RPC con lock) en vez de `MAX(numero_venta)+1` en el frontend — mismo patrón seguro que `NuevaVentaModal`.
- **`NuevaVentaModal` refactorizado** para consumir `useAfipConfig` (DRY): se eliminó la query inline + el `determinarTipoComprobante` local (que tenía el bug del Exento). Quitado el import `useQuery` (quedó `useQueryClient`).
- **`arca-worker` redeployado (v3)** con la implementación manual WSAA+WSFE (`_shared/afip.ts`+`wsaa.ts`+`wsfe.ts`+`auth.ts`). El v2 deployado todavía usaba `npm:@nicoo01x/arca-sdk` (roto en Edge) con las firmas viejas. **Smoke test OK**: invocación manual con cola vacía → `{"procesados":0,"mensaje":"Cola vacía"}` HTTP 200 (el bundle nuevo arranca sin errores de import).
- **`emitir-cae` deprecada** (v5, stub 410): emisión SÍNCRONA de CAE, era **código muerto** (la única que la llamaba, `afipService.emitirCAE`, no la usaba ningún componente) y dependía del SDK roto + arrastraba el `auth.ts` viejo (sin el fix de `verifyAdmin`). Eliminado `emitirCAE` + `CAEResult` de [afipService.ts](src/services/afipService.ts). El path vivo es el worker (`reintentarCAEsPendientes` → `reencolar_caes_pendientes` RPC).
- **UI Reintentar CAE en el historial** ([src/components/ventas/HistorialVentas.jsx](src/components/ventas/HistorialVentas.jsx)): nuevo ítem en el menú de tres puntitos, visible sólo si `cae_estado IN ('error','error_definitivo')`. Re-encola (no emite desde el front) replicando el patrón de `ConfiguracionSection.handleReintentarFactura`, **orden cola-primero** para que el trigger haga ON CONFLICT DO NOTHING en vez de duplicar fila.

### Decisión fiscal resuelta

Quedaba pendiente (sesión 63) la inconsistencia "Nalux es Exento pero el wizard dice Factura B". **Resuelto:** un Exento emite **Factura C** (no discrimina IVA). El `tipo_comprobante_default='B'` del PdV de Nalux quedó vestigial — el path real ahora estampa 'C' vía `determinarTipoComprobante`. (No se tocó dato de la empresa; si se quiere, actualizar el default del PdV a 'C' por prolijidad.)

### Test E2E ✅ (hecho en vivo esta sesión)

- **✅ Emisión real de CAE end-to-end** validada: se creó un comprobante de prueba en Nalux (Factura C), el trigger `trg_queue_factura_arca` (AFTER UPDATE OF cae_estado) lo encoló, se invocó el worker (`POST /functions/v1/arca-worker`) y emitió contra ARCA homologación. Resultado: **CAE `86260498891462`, vto 2026-07-06, número AFIP `0001-00000001`**, `cae_estado='emitido'`, contador `puntos_venta.ultimo_numero_c` sincronizado a 1. El comprobante de prueba se borró tras validar (el correlativo en ARCA homologación arranca en 2 la próxima — consistente). `feCAESolicitar` queda validado: el circuito completo WSAA→FECompUltimoAutorizado→FECAESolicitar funciona.
- **Falta probar desde la UI real** (no bloqueante, lo verá Luciano): hacer una venta real desde el POS / NuevaVenta en la app deployada y ver el badge verde "Factura C ####" en el historial.

### Pendiente PARA PRÓXIMAS SESIONES (no bloqueante)
- **🟡 Convertir Ticket en Factura** desde el historial: NO implementado (decisión de negocio: un ticket no-fiscal pasando a factura fiscal post-hoc). El POS ya encola al vender, así que sólo aplica a tickets viejos.
- **🟡 `AFIP_ENVIRONMENT`** confirmar valor en Dashboard → Edge Functions → Secrets (pendiente desde sesión 30).
- **🟡 Camino a producción**: cert real (no homologación) + PdV real + `AFIP_ENVIRONMENT=production`.
- **🟡 Borrar `arca-diag` y (opcional) `emitir-cae`** del Dashboard — no se pueden eliminar vía MCP, sólo neutralizar.

## Sesión 31 (Nadia) — POS página completa, fixes UX historial, fix cliente POS, fix invite-user

### Fixes aplicados

- **POS página completa cerrado:** Luciano dejó el patrón base en sesión 63 (`App.jsx` con `showPOS` + `ModoCajaLayout` reutilizado con prop `onBack`). Limpieza de código muerto sesión 30 en `VentasSection.jsx` (remover `autoOpenSaleNonce` + botón "Nueva Venta POS" del header + import NuevaVentaModal).
- **4 entry points unificados al POS** (sidebar, header CTA "Nueva Venta", DashboardSection QuickAction, CommandPalette). En `Dashboard.jsx` el intercept `'pos' → onEnterPOS()` se generalizó a `navigateTo` (antes solo `handleSidebarSelect` lo manejaba); los otros 3 entry points ahora también pasan por `navigateTo`.
- **CommandPalette separado en 2 ítems:** "Punto de Venta" (id `pos`, abre POS página completa, keywords pos/caja/cobrar/vender) y "Ventas (Historial)" (id `ventas`, lleva a tab Historial, keywords factura/historial/comprobante).
- **Fix `created_at` → `fecha` en `comprobantes`** (7 cambios): `CommandPalette.jsx:73,93` (select y consumer del render) y `ventasService.ts` (`getAll` order + filtros, `getMetricsToday` select + filtros). La columna `comprobantes.created_at` no existe en el schema, solo `fecha`. `ventasService` está sin consumidores (dead code) pero igual fixeado por higiene.
- **Fix cliente perdido en POS:** al elegir cliente del dropdown del POS, la venta se registraba como "Consumidor Final" porque `PanelCarrito.jsx` solo actualizaba `clienteId` (string) en el `onChange` del `ClienteSelector` pero no `selectedClient` (el objeto que viaja a `useConfirmarVenta`). Fix: `onChange` ahora hace `clientes.find(c => c.id === id)` y actualiza ambos estados.
- **Formato argentino en totales** (7 cambios): `toFixed(2)` → `toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})` en `HistorialVentas.jsx` (col Total + total moneda extranjera), `SaleDetailModal.jsx` (precio unitario, subtotal, total final), `NuevaVentaModal.jsx` (subtotal item, "Restante a asignar"). Antes mostraba `$30000.00`, ahora `$30.000,00`.
- **Badge "Factura" en historial: azul → verde** para coherencia visual con el caso "CAE emitido". Final: Ticket = gris / Factura (con o sin CAE) = verde / pendiente = ámbar / error = rojo.
- **Fix `invite-user` edge function:** mismatch camelCase vs snake_case — frontend mandaba `firstName`/`lastName`, edge function leía `first_name`/`last_name`. Fix en `UsuariosSection.jsx:176-177`. Bloqueaba toda invitación de usuario.
- **Toast `NuevaDevolucionProveedorModal`:** decía "Nota de Débito" cuando se generaba NC. Cambiado a "Nota de Crédito" (rama `compensacion === 'nota_credito'`).
- **Import duplicado en `DashboardSection.jsx`:** `useQuery` y `useQueryClient` venían en dos imports separados de `@tanstack/react-query`. Consolidados en uno solo.

### Auditoría AFIP Nalux (tenant cbc4)

Verificado estado post-commit `bc1cf9e` de Luciano:
- `usa_factura_electronica=true` ✅
- `afip_cuit=20393249006` ✅
- Vault: `afip_cert_cbc4db74...` (1653 chars) + `afip_key_cbc4db74...` (2346 chars), cargados 2026-06-26 ✅
- PdV #1 "Punto de Venta Principal" activo ✅
- `AFIP_ENVIRONMENT`: no verificable via MCP (Supabase no expone Edge Function Secrets por API). Evidencia indirecta (Luciano testeó "ARCA homologación funcionando") sugiere sandbox — confirmar manualmente.

### Falso positivo de auditoría — corregido en este resumen

Durante el barrido pre-commit reporté que `caja_sesiones.cerrado_por` nunca se seteaba. **Es incorrecto** — el `UPDATE` de cierre en [CajaContext.jsx:150](src/contexts/CajaContext.jsx:150) sí lo incluye correctamente (`cerrado_por: user.id`). Lo busqué en `CajaSection.jsx` y no estaba ahí, pero el cierre vive en el Context. No es un pendiente.

### Pendientes críticos para próxima sesión con Luciano

- **🔴 POS no encola CAE (deuda silenciosa):** `useConfirmarVenta.js` no replica el bloque AFIP de `NuevaVentaModal.jsx:538-548`. Toda venta hecha por POS queda como Ticket aunque la empresa tenga `usa_factura_electronica=true` y cert cargado. Análisis completo en comentario al tope del archivo. Hace falta: hook `useAfipConfig` reusable, enriquecer `selectedClient` con `condicion_iva`, agregar el UPDATE a `cae_estado='pendiente'` post-venta, decidir si POS pregunta o emite automático.
- **🔴 `generateVentaNumber` en useConfirmarVenta.js:** usa `MAX(numero_venta)+1` sin lock — mismo patrón inseguro que migration 083 erradicó del resto. Debería venir de `obtener_proximo_numero('venta')` dentro de `crear_venta`. Fix natural junto con el de AFIP.
- **🟡 No hay UI para reintentar CAE desde el historial:** las opciones "Reintentar CAE" / "Convertir Ticket en Factura" sólo están en Configuración → Facturación. Conviene agregar al menú de tres puntitos del historial (HistorialVentas dropdown).
- **🟡 `AFIP_ENVIRONMENT` confirmar valor** en Supabase Dashboard → Edge Functions → Secrets (pendiente desde sesión 30).
- **🟡 Aria-hidden warning** en modal devoluciones (pendiente desde sesión 30, originalmente reportado por Luciano).
- **🟡 Dropdown "Nota de Débito"** en `NuevaDevolucionProveedorModal` sigue mandando `nota_credito` al backend — incoherencia label/payload, decisión contable pendiente (¿devolución a proveedor debe emitir NC o ND?).

### Pendientes secundarios

- **NC en `crear_devolucion`:** migration 096 ya migró a `obtener_proximo_numero('nota_credito')`. Verificar formato emitido (hoy conviven `NC-YYYY-NNNN` legacy + `NC-YYYYMMDD-NNN` nuevos) y que no haya regresiones.
- **Turno por cajero:** modelo de datos listo (`caja_sesiones.user_id, abierto_por, cerrado_por`) pero `CajaContext.fetchCurrentSession` no filtra por `user_id` — todos los cajeros comparten el mismo turno abierto. Análisis completo en sesión, sin implementación. Fix mínimo: agregar `.eq('user_id', user.id)` al fetch + permitir múltiples sesiones abiertas en la misma caja.

---

## Sesión 63 (Luciano) — Integración ARCA real: reemplazo del SDK por WSAA+WSFE manual

### Configuración de homologación AFIP (Nalux, CUIT 20-39324900-6)

Flujo completo guiado y ejecutado contra ARCA **homologación** (testing, CAE sin valor fiscal):
1. Secret `AFIP_ENVIRONMENT=sandbox` en Supabase → Edge Functions → Secrets.
2. Wizard de la app: datos fiscales (CUIT personal = CUIT de persona física, Exento → Factura B), generar CSR.
3. Portal WSASS homologación: crear DN (`Naluxhomo`, sin guiones — solo alfanumérico) + pegar CSR → descargar cert x509. **El cert se entrega como texto en el campo "Resultado", NO como descarga.**
4. WSASS → "Crear autorización a servicio" → servicio **`wsfe`** (Facturación Electrónica). Sin esto el cert existe pero no puede facturar.
5. Subir el `.crt` en el wizard (acción `store_cert` → Vault `afip_cert_{empresa_id}`), PdV = 1 (homologación acepta el 1 sin alta formal).

### Bugs corregidos en el camino

- **`_shared/auth.ts` — 500 en vez de 401 con token expirado.** `verifyAdmin` hacía `const { data: { user } } = await getUser()`; con refresh token inválido `data` viene `null` → TypeError → caía en catch como 500. Fix: `const user = data?.user`. Afecta a TODAS las edge functions que usan `verifyAdmin`.
- **`generar-csr/index.ts` — reescrito sin `@peculiar/x509`.** Esa librería no cargaba bien en Edge. Reemplazada por construcción manual del CSR PKCS#10 con ASN.1/DER puro + Web Crypto (RSA-2048, SHA-256). Validado con OpenSSL: `self-signature verify OK`, Subject `C=AR, O=Nalux, CN=Nalux, serialNumber=CUIT ...`.

### HALLAZGO MAYOR: el SDK `@nicoo01x/arca-sdk` no sirve en Edge Runtime

Síntomas en cascada al probar conexión (cada fix destapó el siguiente):
1. `npm:@nicoo01x/arca-sdk@3` → **"path not found"** (`dist/index.mjs`). El resolver `npm:` de Supabase no encuentra el entry point. **esm.sh sí lo resuelve** (`https://esm.sh/@nicoo01x/arca-sdk@3.1.0`).
2. `import(variable)` → **"Module not found"**. El bundler eszip solo empaqueta `import()` con **string literal estático**, no variables.
3. Constructor: faltaba `serviceScopes: ['wsfe']` (requerido) y el campo correcto es `key`, no `privateKey`. El método es `getLastVoucherNumber({pointOfSale, voucherType})`, no `getLastVoucher(a,b)`.
4. Tras todo eso → **"Authentication failed"** genérico. Diagnóstico manual del WSAA reveló la causa raíz: **el SDK arma mal el TRA** (pone `<service>` dentro de `<header>`; debe ir como hijo directo de `loginTicketRequest`). AFIP responde *"No se ha podido interpretar el XML contra el SCHEMA"*.

**Conclusión: el SDK es inutilizable.** Se reemplaza por implementación manual.

### Solución: WSAA + WSFE manual (sin SDK)

Validado contra homologación (`wsaahomo`/`wswhomo`): **login OK + último comprobante (PV1, FC C) = 0, sin errores.**

- **`_shared/wsaa.ts`** — login WSAA: construye TRA (service fuera del header), firma CMS/PKCS#7 con `node-forge` (carga bien vía esm.sh), postea a LoginCms, parsea token+sign+expiration. **Cache de TA** en tabla `afip_tickets` (TTL ~12h; AFIP rechaza pedir TA nuevo si hay uno válido).
- **`_shared/wsfe.ts`** — `feCompUltimoAutorizado` (último número) + `feCAESolicitar` (emitir CAE). Maneja Factura C (sin discriminar IVA: ImpNeto=Total, sin nodo `<Iva>`) vs A/B (con nodo Iva).
- **`_shared/afip.ts`** — reescrito: `getLastVoucherNumber` y `callArcaEmit` usan WSAA+WSFE. **Nuevas firmas:** ahora reciben `(admin, empresaId, ...)` para el cache de TA.
- **Migration 099** `afip_tickets` — cache del TA. RLS habilitado SIN políticas → solo `service_role` (edge functions). PK `(empresa_id, service)`.
- **`probar-conexion-afip`** (deployado v5) y **`arca-worker`** (código actualizado a nuevas firmas) ajustados.
- **`arca-diag`** — función de diagnóstico temporal, **neutralizada** (v9, `verify_jwt:true`, devuelve 410, no lee Vault). Borrar desde el Dashboard cuando se pueda.

### Pendiente próxima sesión (mañana)

- **Redeploy `arca-worker`** con la implementación nueva (hoy el deployado v2 aún usa el SDK; seguro porque la cola está vacía + sandbox, pero el código en git ya está actualizado).
- **Probar emisión real de CAE** end-to-end: crear factura de prueba → cola `facturas_pendientes_arca` → worker emite → CAE escrito en `comprobantes`. Validar `feCAESolicitar` contra homologación (es el camino que aún NO se probó de verdad).
- **`emitir-cae`** (función legacy) — revisar si sigue usando el SDK; alinear o deprecar.
- **Incoherencia fiscal a decidir:** Nalux es Exento pero el wizard dice "emite Facturas B". Un Exento normalmente emite **Factura C**. Definir antes de producción.
- **Paso a producción:** cert real (Administración de Certificados Digitales, NO homologación) + PdV real dado de alta + `AFIP_ENVIRONMENT=production`.

## Sesión 30 (Nadia) — Testing post-sesión 60: race auth, vault grant, numeración devoluciones, UX ventas

### Bugs resueltos con migration

**Migration 091 — `vault_secret_read` sin GRANT EXECUTE a `authenticated`**
Síntoma: 403 `permission denied for function vault_secret_read` al abrir Configuración → Facturación (`reloadAFIP` en `ConfiguracionSection.jsx` intenta chequear si el certificado AFIP está cargado). Causa raíz: la función ya era `SECURITY DEFINER` con `search_path=public,vault`, pero `proacl` solo tenía `{postgres=X, service_role=X}`. Probable colateral de migrations 063/064 (REVOKE masivo de `anon`). Fix: `REVOKE ALL ... FROM PUBLIC, anon` + `GRANT EXECUTE ... TO authenticated`. Idempotente. `get_my_empresa_id` (alarma falsa relacionada) ya tenía `authenticated=X`, no se tocó.

**Migration 092 — Whitelist `siguiente_numero_documento` incompleto para NC**
Síntoma al registrar devolución a proveedor con compensación NC: `Combinación (tabla, columna, prefijo) no permitida: (comprobantes, numero_venta, NC)`. Causa raíz: migration 086 introdujo un 3er callsite de `siguiente_numero_documento` para numerar la NC de compensación dentro de `crear_devolucion`, pero el whitelist creado en migration 075 solo contemplaba `(entregas, numero_entrega, ENT)` y `(devoluciones, numero_devolucion, DEV)`. Fix: agregar `(comprobantes, numero_venta, NC)` al whitelist. Hotfix mínimo — preserva el formato legacy `NC-YYYY-NNNN` que ya está en producción. **Deuda técnica:** el callsite sigue usando `COUNT(*)` sin lock; el fix definitivo es migrar a `obtener_proximo_numero(p_empresa_id, 'nota_credito')`, requiere decisión de producto sobre el formato (YYYY/4 vs YYYYMMDD/3 — hoy conviven ambos: 7 NCs legacy + 2 nuevas).

**Migration 093 — Backfill `series_numeracion.proximo_numero` para tipos YYYY**
Síntoma: tras emitir DEV-2026-0010 el 22-jun (función legacy), el 25-jun salieron DEV-2026-0001 y DEV-2026-0002 duplicadas. Causa raíz: migration 086 cambió `crear_devolucion` para usar `obtener_proximo_numero('devolucion')` (atómico via `FOR UPDATE` sobre `series_numeracion`) sin incluir el backfill de las filas `series_numeracion` existentes — `proximo_numero=1, periodo_actual=null` desde el seed inicial. La primera llamada del 25-jun: `v_periodo='2026' IS DISTINCT FROM null` → reinicia a 1 → emite duplicado. Fix: UPDATE idempotente para `devolucion`, `entrega`, `recepcion`, `nota_debito` (los 4 tipos YYYY) alineando `proximo_numero = max(real)+1` y `periodo_actual = año actual`. Verificación post-fix: cbc4 quedó en `devolucion=11` (antes 3), el resto ya estaba alineado. **Mismo patrón de bug latente para NC** si en el futuro se migra a `obtener_proximo_numero` sin backfill — quedó documentado.

**Limpieza manual previa al backfill:** las 2 DEVs duplicadas del 25-jun + las 2 NCs asociadas + 12 movimientos de inventario + 3 movimientos de caja + 1 movimiento CC se borraron transaccionalmente. Stock revertido sumando lo restado. Datos de prueba, no se revirtieron contadores `cantidad_devuelta` en líneas origen.

### Bugs frontend

- **`ConfigContext.jsx`** — race condition al cargar Dashboard en modo incógnito: 401 al fetchear `configuracion` antes de que la sesión de Supabase termine de hidratar. `fetchConfig` corría en `useEffect([])` sin esperar a `getSession()`. Fix: `supabase.auth.getSession().then()` antes del fetch + `onAuthStateChange` para re-fetch en login y reset en logout. Resuelve los 3 errores reportados de consola: 401 `configuracion?clave=...`, "Error fetching config", y el 401 secundario derivado.

- **`ConfiguracionSection.jsx`** — 3 `useEffect` (`reloadAFIP`, `reloadTipos`, `reloadFacturasError`) corrían al montar, disparando llamadas RPC a vault/AFIP aunque el usuario no estuviera en la tab Facturación. Gateados con `if (activeTab === 'facturacion')` + dependencia `activeTab`. Además: `try/catch` alrededor de `vault_secret_read` no atrapaba el 403 (supabase-js no lanza excepción para PostgrestError, devuelve `{data, error}`). Reescrito para chequear `certErr` y degradar a `certStatus=false` silenciosamente.

- **`NuevaDevolucionProveedorModal.jsx`** — toast de confirmación decía "Nota de Débito" pero el documento generado era una NC (`crear_devolucion` solo tiene rama para `p_compensacion = 'nota_credito'`). Cambiado a "Nota de Crédito". **Heads-up no resuelto:** el label/dropdown de compensación del modal probablemente sigue diciendo "Nota de Débito" enviando `nota_credito` al backend — pendiente decisión contable (devolución a proveedor: ¿emitís NC o ND?).

- **`Dashboard.jsx` + `VentasSection.jsx`** — UX "dos pantallas iguales": el ítem "Ventas" del sidebar y el ítem "Pedidos" abrían ambos la tab Pedidos. Cambio: `case 'ventas' → initialTab="historial"` en Dashboard + default del prop `initialTab` en VentasSection. Coherente con el mapping interno (`handleDocFlowNavigate` ya trataba `'ventas'` como sinónimo de `'historial'`) y con el label "Facturas" de la tab Historial.

- **`Dashboard.jsx` + `VentasSection.jsx`** — UX "Nueva Venta (POS)" requería 2 clics (navegar + abrir modal). Implementado nonce `posOpenNonce` en Dashboard, incrementado por `handleSidebarSelect` cuando `section === 'ventas'`. Pasado como `autoOpenSaleNonce` a VentasSection, que con `useEffect([autoOpenSaleNonce])` abre el modal automáticamente. Uso de nonce (no boolean) para que cada clic reabra el modal si se cerró. Scope: solo sidebar — DashboardSection quick action y CommandPalette siguen igual (mejora futura).

### Auditoría de integridad de numeración

Antes del fix 093, barrido completo: encontrados 3 duplicados (2 en devoluciones del 25-jun + 1 en entregas del 23-jun, `ENT-2026-0042`). El de entregas es histórico (race condition real, ya alineada `series.entrega.proximo_numero=45`); los 2 de devoluciones se limpiaron. **No hay UNIQUE constraints** en `(empresa_id, numero_*)` en ninguna tabla — pendiente Capa C: agregar constraints para que la DB nunca permita duplicados a futuro, sin importar bugs de RPC. Requiere limpiar duplicado de entregas antes (no resuelto hoy).

### Verificación AFIP/ARCA (sin cambios)

Análisis de las edge functions: las 3 (`arca-worker`, `emitir-cae`, `probar-conexion-afip`) leen `Deno.env.get('AFIP_ENVIRONMENT')` y caen a `'sandbox'` si no es exactamente `'production'`. Verificado: 0 empresas con `usa_factura_electronica=true`, `facturas_pendientes_arca` vacía, sin logs recientes de edge functions. Triple candado contra emisión accidental. **Pendiente Luciano:** verificar en Supabase Dashboard → Edge Functions → Secrets si existe `AFIP_ENVIRONMENT` y su valor (no expuesto via MCP por diseño de seguridad).

### Pendientes próxima sesión

- **POS como página completa** (no modal) — demo aprobada en sesión.
- **Verificar secret `AFIP_ENVIRONMENT`** en Supabase Dashboard (Luciano).
- **Aria-hidden warning** en modal de devoluciones (Luciano).
- **Capa C de numeración:** UNIQUE constraints en `(empresa_id, numero_*)` tras limpiar el duplicado histórico `ENT-2026-0042`.
- **NC en `crear_devolucion`:** migrar a `obtener_proximo_numero('nota_credito')` después de decidir formato (YYYY/4 vs YYYYMMDD/3).
- **Revisar dropdown "Nota de Débito"** en `NuevaDevolucionProveedorModal.jsx` — label vs payload incoherentes.

---

## Sesión 29 (Nadia) — Testing post-Luciano + 3 fixes server-side críticos

### Bugs resueltos con migration

**Migration 083 — Race condition ENT duplicada (crítico, observado en prod)**
ENT-2026-0042 fue asignado a 2 entregas distintas (Pedido + POS) por la empresa `cbc4db74...`. Causa raíz: los 2 caminos NO compartían el mismo source de numeración — `crear_entrega` (Pedido) usaba `obtener_proximo_numero('entrega')` (atómico via `FOR UPDATE` sobre `series_numeracion`), mientras que `crear_venta` (POS, rama entrega implícita) usaba `siguiente_numero_documento(... 'entregas' ...)` que hace `SELECT COUNT(*)` sin lock. Fix: 1 línea en `crear_venta` para usar `obtener_proximo_numero('entrega')` igual que su par. El tipo `'entrega'` ya estaba registrado en `series_numeracion` desde migration 051. Verificado post-fix: `proximo_numero` vs `MAX(numero)` en sync para las 3 empresas. **Pendiente futuro:** `crear_devolucion` todavía usa `siguiente_numero_documento` — race latente para devoluciones simultáneas.

**Migration 084 — Recursión infinita 42P17 en policy `profiles_self_update`**
Error en consola del browser: `"infinite recursion detected in policy for relation profiles"`. Causa raíz: el `WITH CHECK` de la policy hacía `(role = (SELECT role FROM profiles WHERE id = auth.uid()))` — subquery directo a la misma tabla, fuerza re-evaluación de las policies SELECT, Postgres detecta el loop y aborta. Fix: nueva función `get_my_role()` SECURITY DEFINER (mismo patrón que `get_my_empresa_id()`), policy recreada usando esa función. `REVOKE EXECUTE FROM anon` para consistencia con migration 063.

**Migration 085 — Trigger BEFORE UPDATE para proteger `profiles.role`**
Hallazgo adicional descubierto al verificar 084: la protección "no cambiar tu propio rol" del `WITH CHECK` **nunca funcionó** ni con la versión nueva ni con la vieja — Postgres evalúa el `WITH CHECK` después del UPDATE, entonces cualquier comparación contra `role` actual ve el valor nuevo y siempre se cumple. La recursión histórica lo enmascaraba (los UPDATEs explotaban antes de evaluar la lógica). Bug preexistente: un staff podía hacer `UPDATE profiles SET role='admin'` sobre sí mismo. Fix: trigger BEFORE UPDATE OF role con `OLD.role` vs `NEW.role` (los triggers operan sobre los valores del row, no consultan la tabla bajo policies → cero recursión). Permite el cambio solo si: `auth.uid() IS NULL` (migrations/seeds) OR `auth.role() = 'service_role'` OR `is_admin()`. Los 3 escenarios verificados con `BEGIN...ROLLBACK`: staff escalando → bloqueado, admin promoviendo a colega → pasa, staff editando first_name → pasa (trigger no se dispara, usa `BEFORE UPDATE OF role`).

### Fixes UI

- **`CotizacionesSection.jsx`** — cuando el usuario seleccionaba un cliente del dropdown, el form solo guardaba `cliente_nombre` (texto), nunca el `cliente_id`. Resultado: el 100% de las cotizaciones nuevas iban a DB con `cliente_id = null`, y al convertir a venta el POS no podía pre-cargar el cliente. Fix: agregado `cliente_id: ''` al form state + reset + onChange clear + dropdown onClick setea ambos campos + payload del mutate pasa `{ id: form.cliente_id || null, nombre: form.cliente_nombre }`. El service ya estaba correcto (`cliente_id: cliente?.id ?? null`). `||` con `null` para no enviar string vacío a columna uuid.

- **`NuevaVentaModal.jsx`** — pre-carga de cliente desde cotización reforzada con 3 niveles de fallback: 1) match por `cotizacion.cliente_id` en la lista local, 2) fallback a DB si el cliente está inactivo (`.maybeSingle()`), 3) fallback por `cliente_nombre` (case-insensitive, trim) — cubre cotizaciones legacy que se crearon sin id antes del fix de CotizacionesSection. Las cotizaciones nuevas pasan por el path 1 (rápido + sin ambigüedad); las viejas por el path 3 (es frágil si hay clientes con mismo nombre, pero sigue funcionando).

- **`CajaSection.jsx`** — header de caja abierta mostraba solo `"11:04 hs"`. Cambiado a `"24/06/2026 · 11:04 hs"` usando `formatDateTimeAR()` que ya estaba importado. Cero imports nuevos.

- **`CajaSection.jsx`** — modal "Cerrar Caja" (línea 926) carecía de `DialogTitle` y `DialogDescription` (warning de accesibilidad de Radix). Agregados con clase `sr-only` (mismo patrón que sesión 53 aplicó a `OnboardingWizard`): el screen reader anuncia "Arqueo y Cierre de Caja" al abrir, pero visualmente se mantiene el heading interno de `CajaCierre` sin duplicar. No introduje `@radix-ui/react-visually-hidden` como dependencia — `sr-only` de Tailwind ya cumple.

### Mejora — Asientos contables desde Caja

`handleSubmit` de `CajaSection.jsx` insertaba en `movimientos_caja` pero no generaba asiento contable (los movimientos de venta y compra sí lo hacían vía `asientosAutoService`). Implementado:

- Nueva función **`asientosAutoService.crearAsientoMovimientoCaja(empresaId, userId, params)`** en `planCuentasService.ts`. Mismo patrón estructural que `crearAsientoVenta`/`crearAsientoCompra` (check de período cerrado fire & forget, find por código, silencioso si no hay plan de cuentas seedeado).
- **Mapeo categoría → cuenta:**
  - Egreso `Sueldos` → `5.2` Gastos de Personal · HABER `1.1.1` Caja y Bancos
  - Egreso `Servicios`/`Alquiler`/`Mantenimiento` → `5.4` Gastos de Administración · HABER `1.1.1`
  - Egreso `Impuestos` → `5.6` Impuestos y Tasas · HABER `1.1.1`
  - Egreso `Otro Egreso` → `5.8` Otros Gastos · HABER `1.1.1`
  - Ingreso `Cobro`/`Inversión`/`Otro Ingreso` → DEBE `1.1.1` · HABER `4.3` Otros Ingresos
- `origen='movimiento_caja'` + `origen_id` para trazabilidad.
- `handleSubmit` captura el `id` del INSERT y llama la función fire & forget post-insert (mismo patrón que `NuevaVentaModal.jsx:518`). Si falla, el movimiento queda guardado y solo se logea console.warn.
- **No requirió migration** — las cuentas ya están seedeadas en `plan_cuentas` por el trigger al crear empresa.

### Testing manual realizado — todos los módulos verificados funcionando

| Módulo | Estado |
|---|---|
| Dashboard nuevo (KPIs, aging, top clientes, PDF) | ✅ |
| Configuración AFIP (Credenciales, PdV, Tipos de Comprobante) | ✅ |
| Reportes (Ventas, Financiero, MercadoPago, Libro IVA) | ✅ |
| Caja (apertura, movimientos manuales, asientos auto, cierre) | ✅ |
| Compras y Proveedores | ✅ |
| Inventario (nuevo producto Jamón Cocido SKU `JAMON-001`, unidad GR) | ✅ |

### Errores externos descartados

`"A listener indicated an asynchronous response by returning true, but the message channel closed"` en consola — verificado: cero referencias a `chrome.runtime`/`browser.runtime`/`onMessage`/`sendMessage` en todo `src/`, `index.html` y `public/`. Es 100% ruido de extensiones del browser (Claude, Grammarly, password managers, etc.). El patrón "incremento al navegar" es la firma típica. Confirmación rápida: abrir en ventana Incógnito sin extensiones desaparece.

### Pendientes para próximas sesiones

⚠️ **Venta al peso/volumen** (feature grande, requiere sesión dedicada): que el carrito del POS acepte decimales (0.5 kg, 200 gr, etc.) cuando el producto tiene unidad `GR`/`KG`/`LT`/`ML`/`MT`. Investigado: schema heterogéneo — `cotizacion_items`, `pedido_items`, `entrega_items`, `recepcion_items`, `devolucion_items` ya son `numeric(10/12, 3)`, pero `comprobante_items.cantidad`, `detalle_compras.cantidad`, `movimientos_inventario.cantidad`, `productos.stock_actual`, `productos.stock_minimo` siguen siendo `integer`. Para soportar el feature: **Migration 086** ALTER las 5 columnas a `numeric(12,3)` + recrear las 7 RPCs del mapa de escritores de stock (`crear_venta`, `crear_entrega`, `crear_devolucion`, `decrement_stock`, `increment_stock`, `ajustar_stock_manual`, `aplicar_compra_producto` — todas declaran `v_cantidad INTEGER`) + tocar frontend (`NuevaVentaModal`, `CompraRapidaSection`, `ProductosSection` modal movimiento de stock, ticket PDF) + ajustar los 9 tests pgTAP (algunos `is(stock_actual, 7)` asumen integer). Hacerlo "frontend only" es engañoso: el cast `(v_item->>'cantidad')::INTEGER` revienta con `0.5`. **Recomendación: NO hacer hasta confirmar con el cliente que realmente necesita venta al peso, no productos con SKUs múltiples ("100gr azúcar" como SKU separado).**

⚠️ **Aging de Cuenta Corriente por fecha de vencimiento**: el aging hoy se calcula por antigüedad del DEBE (fecha de venta). Ahora que existe `comprobantes.fecha_vencimiento` (sesión 25), tendría más sentido calcular por vencimiento. Heredado de sesión 26, sin tocar — decisión de producto (impacta KPIs históricos).

✅ **Race condition en `crear_devolucion`** — **RESUELTO en migration 086 (sesión 58)**. `'devolucion'` agregado a `series_numeracion` con backfill de proximo_numero. `crear_devolucion` recreada usando `obtener_proximo_numero('devolucion')` (FOR UPDATE).

⚠️ **Errores 401/500 en producción**: investigar si persisten después de migrations 084-085 (la recursión 42P17 probablemente causaba 500s al hacer UPDATE de profiles).

### Archivos modificados / creados

**Nuevas migrations (3):**
- `supabase/migrations/083_crear_venta_unificar_numeracion_entrega_atomica.sql`
- `supabase/migrations/084_fix_profiles_self_update_recursion.sql`
- `supabase/migrations/085_protect_profile_role_trigger.sql`

**Frontend:**
- `src/components/sections/CotizacionesSection.jsx`
- `src/components/ventas/NuevaVentaModal.jsx`
- `src/components/sections/CajaSection.jsx`
- `src/services/planCuentasService.ts` (extendido con `crearAsientoMovimientoCaja`)

---

## Sesión 60 — Emisión CAE async completa: fn_queue_factura_arca en 'pendiente' (Luciano)

### Patrón implementado (SAP S/4HANA async document posting)

El arca-worker es la **única** fuente de verdad para llamar a ARCA. Ningún flujo del frontend
llama directamente a la Edge Function `emitir-cae` — esa función queda como herramienta manual de
emergencia.

### Migration 089 (`089_trigger_queue_on_pendiente.sql`) — aplicada a producción

**Problema resuelto:** el trigger `fn_queue_factura_arca` (migration 087) solo se activaba cuando
`cae_estado` cambiaba a `'error'`. La primera emisión (al crear la factura) nunca llegaba a la
cola — el frontend tenía que llamar `emitirCAE` directamente desde el navegador, arriesgando doble
emisión si el worker ya estaba reintentando.

**Cambios:**
1. Condición ampliada: `IN ('pendiente', 'error')` en vez de `= 'error'`.
2. `proximo_intento = now()` para `'pendiente'` (primera emisión, inmediato).
   `proximo_intento = now() + 1 minute` para `'error'` (backoff mínimo tras fallo).
3. Guard explícito: `IF NEW.punto_venta_id IS NULL THEN RETURN NEW; END IF;` — sin PdV no hay emisión.
4. **Fix bug migration 087:** `ON CONFLICT ON CONSTRAINT uq_fpa_comprobante_activo` era incorrecto
   (`uq_fpa_comprobante_activo` es un partial UNIQUE INDEX, no una constraint nombrada).
   Corregido a `ON CONFLICT (comprobante_id) WHERE comprobante_id IS NOT NULL AND estado NOT IN ('emitida','error_definitivo') DO NOTHING`.

Verificado en producción via `pg_get_functiondef`: función activa con las nuevas condiciones.

### Frontend — eliminado `emitirCAE` directo desde los 3 modales

| Archivo | Cambio |
|---|---|
| `NuevaVentaModal.jsx` | Eliminado bloque `emitirCAE` (44 líneas). Solo queda el UPDATE a `cae_estado='pendiente'`. |
| `NuevaFacturaModal.jsx` | Eliminado bloque `emitirCAE`. Solo queda el UPDATE a `cae_estado='pendiente'`. |
| `NuevaNCModal.jsx` | Eliminado bloque `emitirCAE`. Solo queda el UPDATE a `cae_estado='pendiente'`. |

`emitirCAE` sigue exportada en `afipService.ts` como herramienta de emergencia (no la usamos).

### Flujo completo al cierre de sesión 60

```
Factura / NC creada (NuevaVentaModal / NuevaFacturaModal / NuevaNCModal)
    ↓ UPDATE comprobantes SET cae_estado='pendiente', punto_venta_id, tipo_comprobante_afip
    ↓ Trigger fn_queue_factura_arca (AFTER UPDATE) → INSERT facturas_pendientes_arca
         proximo_intento = now() (inmediato)
    ↓ arca-worker (cron */5 min) → procesa cola
         ↓ getLastVoucherNumber() — nunca usar contador local ✅
         ↓ callArcaEmit() → CAE emitido
              ↓ Éxito → cae_estado='emitido', CAE guardado ✅
              ↓ Error datos → estado='error_datos', NO reintentar ✅
              ↓ Error transient → backoff [1,5,15,30,60]min, hasta 5 intentos ✅
              ↓ Max intentos → estado='error_definitivo' ✅
              ↓ Estado ambiguo → getLastVoucherNumber() → error_definitivo "verificar manualmente" ✅
    ↓ UI gestión (ConfiguracionSection tab Facturación) → usuario puede reintentar ✅
    ↓ Notificación crítica si hay error_datos/error_definitivo ✅
```

El path "error" sigue funcionando igual que antes: si el worker actualiza `cae_estado='error'`,
el mismo trigger dispara y re-encola con `proximo_intento = now() + 1 minute`.

### Archivos modificados / creados

- `supabase/migrations/089_trigger_queue_on_pendiente.sql` (nueva)
- `src/components/ventas/NuevaVentaModal.jsx` (eliminado bloque emitirCAE)
- `src/components/ventas/NuevaFacturaModal.jsx` (eliminado bloque emitirCAE)
- `src/components/ventas/NuevaNCModal.jsx` (eliminado bloque emitirCAE)

Build ✅ — 3170 módulos, sin errores. Pusheado a `master` (commit `f0d8c29`). Deploy Vercel ✅.

### Quick wins — Pie de Documento + Stock Mínimo Global (migration 090)

**Migration 090 (`090_pie_documento_stock_minimo_global.sql`) — aplicada a producción:**
```sql
ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS pie_documento TEXT,
  ADD COLUMN IF NOT EXISTS stock_minimo_global INTEGER DEFAULT 5;
```

**ConfiguracionSection.jsx:**
- Tab Facturación → card "Pie de Documento": textarea (max 300 chars) + guardar → UPDATE `empresas.pie_documento`.
- Tab Inventario → card "Stock Mínimo Global": input numérico + guardar → UPDATE `empresas.stock_minimo_global`.
- Ambas cards removidas el badge "Próximamente" y el `opacity-60`.
- useEffect de carga unificado: `supabase.from('empresas').select('pie_documento, stock_minimo_global')`.

**PDFs — FacturaPDF / TicketPDF / ComprobantePDF:**
- Todos leen `empresa?.pie_documento` (o `empresaData?.pie_documento` en ComprobantePDF).
- Si tiene valor: se muestra primero, separado del texto del sistema con `\n`.
- Si está vacío: se comporta exactamente como antes.

**useNotifications.js:**
- Nuevo `useQuery` para `empresas.stock_minimo_global` (staleTime 5 min, no refetch on focus).
- La query de `stock_bajo` incluye `stockMinimoGlobal` en el `queryKey` → se re-evalúa si el usuario cambia el umbral.
- Filtro: `p.stock_minimo ?? stockMinimoGlobal` (producto propio tiene prioridad; global es fallback).

**Archivos modificados:**
- `supabase/migrations/090_pie_documento_stock_minimo_global.sql` (nueva)
- `src/components/sections/ConfiguracionSection.jsx`
- `src/components/ventas/pdf/FacturaPDF.jsx`
- `src/components/ventas/pdf/TicketPDF.jsx`
- `src/components/ventas/pdf/ComprobantePDF.jsx`
- `src/hooks/useNotifications.js`

Build ✅. Pusheado a `master` (commit `ffb606a`). Deploy Vercel ✅.

---

## Sesión 59 — Polish AFIP/ARCA + reintento masivo vía worker (Luciano)

### Migration 088 (`088_reencolar_caes_pendientes.sql`) — aplicada a producción

RPC `reencolar_caes_pendientes(p_empresa_id uuid) RETURNS integer` — SECURITY DEFINER.
- Guard multi-tenant: `p_empresa_id <> get_my_empresa_id()` → RAISE EXCEPTION.
- Por cada comprobante con `cae_estado IN ('pendiente','error')` (hasta 50):
  - Reset de fila activa/recuperable en `facturas_pendientes_arca` a `estado='pendiente'`.
  - Si no existe fila → INSERT nueva (ON CONFLICT con predicado del partial index, DO NOTHING si hay una fila 'procesando').
  - Reset `comprobantes.cae_estado='pendiente'`.
- REVOKE FROM PUBLIC, anon. GRANT TO authenticated.
- Verificado: SECURITY DEFINER=true, authenticated:EXECUTE, sin acceso anon.

### `afipService.ts` — `reintentarCAEsPendientes` reescrita

Antes: llamaba `emitirCAE` en loop desde el browser (riesgo doble emisión).
Ahora: llama `supabase.rpc('reencolar_caes_pendientes', { p_empresa_id })` y devuelve el conteo.
El arca-worker procesa los comprobantes re-encolados.

### Edge Function `probar-conexion-afip` — desplegada

Valida el pipeline completo (Vault → cert → ARCA) llamando `getLastVoucherNumber()` y devuelve
`{ ok, lastNumber, pvNumero, cuit }`. Botón "Probar conexión" en ConfiguracionSection.

### UI — polish notificaciones y navegación

- `Header.jsx`: tipo `facturas_error_cae` en `NOTIF_CONFIG` + branch `tab-facturacion` en onClick.
- `Dashboard.jsx`: `onNavigate` pasa a ser `navigateTo` (acepta `section + params`), `ConfiguracionSection` recibe `initialTab`.
- `HistorialVentas.jsx`: icono `AlertCircle` para `cae_estado='error_definitivo'`.
- `FacturaPDF.jsx`: bloque "DOCUMENTO SIN VALIDEZ FISCAL" cuando no hay CAE.
- `ConfiguracionSection.jsx`: "Probar conexión" llama la Edge Function real (antes era toast "próximamente").

### Archivos modificados / creados (sesión 59)

- `supabase/migrations/088_reencolar_caes_pendientes.sql`
- `supabase/functions/probar-conexion-afip/index.ts` (nueva Edge Function)
- `src/components/Header.jsx`
- `src/components/Dashboard.jsx`
- `src/components/ventas/HistorialVentas.jsx`
- `src/components/ventas/pdf/FacturaPDF.jsx`
- `src/components/sections/ConfiguracionSection.jsx`
- `src/services/afipService.ts`

---

## Sesión 58 — Cierre ciclo async AFIP/ARCA: worker + UI + notificaciones (Luciano)

### Migrations aplicadas

**Migration 086** (`086_fix_crear_devolucion_numeracion_atomica.sql`):
- Agrega `'devolucion'` al CHECK constraint de `series_numeracion.tipo_documento`.
- `seed_series_numeracion()` actualizada para incluir la serie DEV (prefijo `DEV-`, formato `YYYY`, 4 dígitos).
- Backfill de `series_numeracion` para empresas existentes con `proximo_numero = MAX(correlativo) + 1`.
- `crear_devolucion` recreada: única línea cambiada, de `siguiente_numero_documento('devoluciones', 'numero_devolucion', 'DEV')` (COUNT sin lock) a `obtener_proximo_numero(p_empresa_id, 'devolucion')` (FOR UPDATE atómico).

**Migration 087** (`087_trigger_queue_factura_arca.sql`):
- Amplía CHECK de `comprobantes.cae_estado` para incluir `'error_definitivo'` (el worker lo pone al agotar los 5 intentos).
- Índice UNIQUE parcial `uq_fpa_comprobante_activo` en `facturas_pendientes_arca(comprobante_id)` WHERE estado NOT IN ('emitida','error_definitivo') — evita encolar el mismo comprobante dos veces.
- Función `fn_queue_factura_arca()` SECURITY DEFINER: trigger AFTER UPDATE OF cae_estado ON comprobantes — cuando `cae_estado` cambia a `'error'` por primera vez, inserta en `facturas_pendientes_arca` con `proximo_intento = now() + 1 minute`. ON CONFLICT DO NOTHING (idempotente).
- Backfill de comprobantes existentes con `cae_estado='error'`.

### Fix crítico vault key (completado en sesión 57, documentado aquí para claridad)

`ConfiguracionSection.jsx` guardaba vault secrets como `arca_cert_{empresa_id}` / `arca_key_{empresa_id}`, pero `emitir-cae/index.ts` los leía como `afip_cert_{empresa_id}` / `afip_key_{empresa_id}`. Corrección: 3 ocurrencias en ConfiguracionSection actualizadas a las keys correctas.

### Edge Function `arca-worker`

**`supabase/functions/arca-worker/index.ts`** — worker cron `*/5 * * * *` (definido en `supabase/config.toml`):
- Auth: `adminClient` (service_role) — no requiere usuario autenticado.
- Lee hasta 10 registros de `facturas_pendientes_arca WHERE estado IN ('pendiente','reintentando') AND proximo_intento <= now()`.
- CAS lock: `UPDATE estado='procesando' WHERE id=fpa.id AND estado=fpa.estado` — previene doble procesamiento si dos instancias del worker corren al mismo tiempo.

**4 casos críticos implementados:**

| Caso | Detección | Acción |
|---|---|---|
| ARCA caído / 503 / network | `classifyArcaError` → `'transient'` | `estado='reintentando'`, backoff exponencial [1,5,15,30,60]min, máx 5 intentos |
| Error de datos | `classifyArcaError` → `'data'` | `estado='error_datos'` directo, NO reintentar |
| Estado ambiguo / timeout | `getLastVoucherNumber()` ANTES de emitir | Si ARCA ya emitió → `error_definitivo` "verificar manualmente" |
| Numeración | SIEMPRE `getLastVoucherNumber()` | Nunca usar contador local |

**`supabase/functions/_shared/afip.ts`** — helpers compartidos (sin Supabase client, lógica pura):
- `voucherTypeAfip()`, `alicuotaPct()`, `docTipoAfip()`
- `getLastVoucherNumber()` — consulta WSFE via arca-sdk
- `callArcaEmit()` — llama WSFE y obtiene número correlativo real post-emisión
- `classifyArcaError()` — clasifica el error de ARCA en `'data' | 'transient' | 'ambiguous'`
- `backoffMinutes()` — schedule [1,5,15,30,60]

Deploy: desplegado via MCP → status `ACTIVE`, version 1 (2026-06-24).

### UI — Sección "Facturas con Error CAE" (ConfiguracionSection tab Facturación)

Nueva sección condicional a `afipConfig.usa_factura_electronica`. Se inserta entre "Tipos de Comprobante" y "Series de Numeración".

- Lee `facturas_pendientes_arca WHERE estado IN ('pendiente','reintentando','error_datos','error_definitivo','procesando')` JOIN `comprobantes`.
- Tabla: Comprobante | Fecha | Cliente | Total | Estado (badge color) | Intentos | Acciones.
- **Acción "Reintentar"** (disponible si estado ≠ 'error_datos'): reset `intentos=0, estado='pendiente', proximo_intento=now()` + `comprobantes.cae_estado='pendiente'`.
- **Acción "Ver error"**: Dialog con el mensaje de error de ARCA en `<pre>` (monospace).
- **Acción "Resuelta"**: marca `estado='emitida'` + `comprobantes.cae_estado='emitido'` (para correcciones manuales vía portal ARCA).
- Botón Refresh (RefreshCw). Estado vacío: checkmark verde "Sin facturas con error".

### `useNotifications` — alerta "facturas error CAE definitivo"

Nueva query `facturasErrorDefinitivo` en `useNotifications.js`:
- Lee `facturas_pendientes_arca WHERE estado IN ('error_datos', 'error_definitivo')`.
- Item de tipo `'facturas_error_cae'`, nivel `'critico'`.
- Navega a `seccion: 'configuracion'`, `action: 'tab-facturacion'`.
- Se diferencia de `caesPendientes` (que cubre los in-progress en `comprobantes`): esta alerta solo dispara cuando el worker no puede recuperar las facturas solo y se requiere intervención humana.

### Estado del ciclo AFIP/ARCA al cierre de sesión 58

```
Factura creada
    ↓ emitir-cae (Edge Function, user-triggered desde NuevaFacturaModal)
    ↓ ARCA responde → CAE guardado en comprobantes ✅ (happy path)
    ↓ ARCA falla → comprobantes.cae_estado='error'
         ↓ trigger fn_queue_factura_arca → INSERT facturas_pendientes_arca ✅ (migration 087)
         ↓ arca-worker (cron */5 min) → procesa cola
              ↓ Éxito → estado='emitida', CAE guardado ✅
              ↓ Error datos → estado='error_datos', NO reintentar ✅
              ↓ Error transient → backoff [1,5,15,30,60]min, hasta 5 intentos ✅
              ↓ Max intentos → estado='error_definitivo' ✅
              ↓ Estado ambiguo → getLastVoucherNumber() → error_definitivo "verificar manualmente" ✅
         ↓ UI gestión (ConfiguracionSection tab Facturación) → usuario puede reintentar/marcar resuelta ✅
         ↓ Notificación critica en useNotifications si hay error_datos/error_definitivo ✅
```

### Archivos modificados / creados

**Nuevas migrations:**
- `supabase/migrations/086_fix_crear_devolucion_numeracion_atomica.sql`
- `supabase/migrations/087_trigger_queue_factura_arca.sql`

**Nuevas Edge Functions:**
- `supabase/functions/arca-worker/index.ts` (cron */5 min, verify_jwt=false)
- `supabase/functions/_shared/afip.ts` (helpers compartidos)
- `supabase/config.toml` (schedule arca-worker)

**Frontend:**
- `src/components/sections/ConfiguracionSection.jsx` — vault key fix (arca→afip) + sección "Facturas con Error CAE" + modal detalle error
- `src/hooks/useNotifications.js` — nueva query + item `facturas_error_cae`

### Pendientes para próximas sesiones

⚠️ **Errores 401/500 en producción**: verificar en browser si persisten post-migrations 084-087 (la recursión 42P17 probablemente causaba los 500s).
⚠️ **Confirmar scheduler activo**: verificar en Supabase Dashboard → Edge Functions → arca-worker que el cron aparece como scheduled. El config.toml define el schedule pero puede requerir activación manual en el dashboard si el proyecto está en free tier.
⚠️ **Venta al peso/volumen** (feature grande, requiere sesión dedicada) — ver detalle en sesión 29 Nadia.

---

## Sesión 57 — Integración Base AFIP/ARCA (Luciano)

### Auditoría previa — hallazgos clave
- `puntos_venta` ya existía en DB con columnas `tipo_comprobante_default`, `ultimo_numero_a/b/c` (usadas por wizard existente). Se mantienen por retrocompatibilidad.
- `vault_secret_upsert(p_name, p_secret, p_description)` y `vault_secret_read(p_name)` → RPCs activos en el schema público.
- Trigger `fn_set_updated_at` disponible para `updated_at`.
- `tipos_comprobante_afip` y `facturas_pendientes_arca` NO existían → creadas en esta sesión.

### Migrations aplicadas
- **080** (`080_puntos_venta_afip_columns.sql`): columnas nuevas en `puntos_venta`: `tipo` (web/manual), `es_default`, `cai_remito`, `cai_remito_vencimiento`, `proximo_numero_remito`, `updated_at` + trigger updated_at.
- **081** (`081_tipos_comprobante_afip.sql`): tabla `tipos_comprobante_afip` con 9 tipos por PdV (FA/FB/FC/NCA/NCB/NCC/NDA/NDB/NDC + códigos AFIP). RLS tenant isolation. Trigger `trg_seed_tipos_comprobante_afip` (AFTER INSERT ON puntos_venta → siembra automáticamente los 9 tipos). Verificado con BEGIN...ROLLBACK.
- **082** (`082_facturas_pendientes_arca.sql`): cola async `facturas_pendientes_arca` (estados: pendiente/procesando/emitida/error_datos/reintentando/error_definitivo). INDEX en (empresa_id, estado, proximo_intento) para worker de ARCA.

### UI — Tab Facturación (secciones nuevas sobre "Series de Numeración")
Condicional a `afipConfig.usa_factura_electronica`. Se mantuvo INTACTO el wizard existente y la sección "Series de Numeración".

**Sección 1 — Credenciales AFIP/ARCA:**
- Cards readonly: CUIT (de `empresas.afip_cuit`), Condición IVA, estado del certificado (badge verde/amber via `vault_secret_read`).
- Botón "Configurar certificado" → modal con 2 Textareas (cert PEM + key PEM) → guarda via `vault_secret_upsert` con keys `arca_cert_{empresa_id}` + `arca_key_{empresa_id}`.
- Botón "Probar conexión" → placeholder toast.

**Sección 2 — Puntos de Venta:**
- Tabla de TODOS los PdV (activos + inactivos). Columnas: Nº, Nombre, Tipo, CAI Remito, Vencimiento CAI, Default, Activo.
- Botón "+ Nuevo PdV" → modal con campos numero/nombre/tipo/cai_remito/cai_remito_vencimiento/proximo_numero_remito/es_default/activo. Upsert via onConflict `empresa_id,numero`.
- Alert si CAI vence en < 30 días.

**Sección 3 — Tipos de Comprobante por PdV:**
- Select de PdV → tabla de 9 tipos con columnas: Tipo, Código AFIP, Próximo Nº (editable, referencial), Acción (guardar).
- `proximo_numero` es REFERENCIAL — ARCA es fuente de verdad antes de emitir.

### Estado de tablas AFIP
- `puntos_venta`: RLS activa, policy `puntos_venta_all` ALL con `empresa_id = get_my_empresa_id()`.
- `tipos_comprobante_afip`: RLS activa, policy tenant.
- `facturas_pendientes_arca`: RLS activa, policy tenant. Tabla vacía — se llenará cuando se implemente el módulo de emisión de CAE.

### Próximos pasos AFIP (pendiente)
- ✅ Edge Function `emitir-cae` — creada en sesión 57, con vault keys `afip_cert_{empresa_id}` / `afip_key_{empresa_id}`.
- Conectar emisión de CAE desde `NuevaFacturaModal.jsx` cuando el PdV tiene AFIP configurado. (pendiente — requiere que el cliente tenga cert AFIP configurado)
- ✅ Worker de reintentos `arca-worker` — implementado en sesión 58 (migrations 086-087 + Edge Function + UI).

## Sesión 56 — Reportería de primer nivel + Dashboard KPIs financieros (Luciano)

### Segmentación MercadoPago por tipo de cobro

**Contexto del cliente:** el estudio contable necesita separar los ingresos de MP por canal: CVU/transferencia, QR/billetera digital, tarjeta de crédito y tarjeta de débito.

**Flujo real de MP explicado y validado:** el webhook recibe `payment_id` → llama a `/v1/payments/{id}` en la API de MP → el objeto devuelve `payment_type_id` (`bank_transfer`, `account_money`, `credit_card`, `debit_card`).

**Implementación completa:**
- **Migration 078** (`movimientos_bancarios_add_subtipo.sql`): columna `subtipo TEXT NULL` en `movimientos_bancarios`.
- **Migration 079** (`insertar_movimiento_bancario_externo_add_subtipo.sql`): RPC `insertar_movimiento_bancario_externo` recibe `p_subtipo TEXT DEFAULT NULL` — retrocompatible con Ualá y otros callers que no pasan subtipo.
- **Edge Function `mp-webhook` v2**: mapeo `SUBTIPO_MAP { bank_transfer→'transferencia', account_money→'qr', credit_card→'tarjeta_credito', debit_card→'tarjeta_debito' }` + pasa `p_subtipo` a la RPC.
- **`ReportesSection.jsx`**: nuevo card "MercadoPago por Tipo" con badge `MP`, query a `movimientos_bancarios WHERE origen='mercadopago'`, tabla con chips de color por subtipo + resumen de totales por tipo.

### Dashboard — KPIs de Salud Financiera (nueva fila)

**Fuente de datos:** `comprobantes` del mes (accrual basis) + `ordenes_compra` activas (no recibidas ni canceladas).

**4 nuevos KPIs:**
| KPI | Fórmula | Semáforo |
|---|---|---|
| **DSO** (días en cobrar) | `(deuda_clientes / facturado_mes) × 30` | Verde ≤30, Amber 30-60, Rojo >60 |
| **Facturas del mes** | `COUNT(comprobantes WHERE mes_actual)` | — |
| **Ticket promedio** | `facturasMesTotal / facturasMesCount` | — |
| **OC pendientes** | `COUNT(ordenes_compra WHERE estado NOT IN ('recibida','cancelada'))` | Amber si >0 |

**Archivos modificados:**
- `src/types/index.ts`: `DashboardKPIs` extendido con `dso`, `facturasMesCount`, `facturasMesTotal`, `ocPendientes`, `ticketPromedio`. Nueva interface `TopCliente { nombre, total, count }`.
- `src/services/dashboardService.ts`: `getKPIs()` agrega 2 queries paralelas (comprobantes + ordenes_compra), computa los 5 campos nuevos. Nuevo método `getTopClientes()` (agrupa comprobantes del mes por `cliente_nombre`, top 5 por total). `DASHBOARD_KEYS.topClientes` agregado.

### Dashboard — Panel Cobranzas con aging

**Reemplaza el panel "Cotizaciones Aprobadas"** en el grid inferior derecho (las cotizaciones se mantienen en la fila de KPIs de abajo).

**Aging buckets** calculados desde `alertasCC`:
- 30-60 días: `vencidos30 - vencidos60`
- 60-90 días: `vencidos60 - vencidos90`
- +90 días: `vencidos90`

**Lista de top deudores** con `diasVencido` + badge urgente (>60 días) + total vencido al pie.

### Dashboard — Panel "Top Clientes del Mes"

**5 tarjetas en grid** (1 col en mobile, 5 en XL) con:
- Rank numerado (#1 dorado, #2 plata, #3 bronce)
- Nombre del cliente
- Total facturado en el mes
- Barra de progreso proporcional al líder
- Cantidad de comprobantes

### PDF de primer nivel — pdfUtils.js

**Reescritura completa de `generatePDF`:**
- **Banda de header azul corporativo** (`rgb(37,99,235)`) con nombre empresa (blanco, negrita) + título del reporte + período + fecha generado (alineado a la derecha).
- **Bloque de métricas KPI** (opcional, hasta 4 cajas en fila): fondo `slate-100`, borde `slate-200`, label arriba en gris, valor abajo en negrita.
- **Tabla con `theme: 'grid'`** (líneas en todas las celdas, más limpio que `striped`), colores `slate` para separadores.
- **Footer profesional**: línea divisoria + "KAIROX Gestión — Sistema Integral" (izquierda) + "Página X de Y" (derecha).

**Nuevo parámetro `summaryMetrics`** (`{label, value}[]`) — computado en `ReportesSection.buildSummaryMetrics()` según el tipo de reporte:
| Reporte | Métricas en el PDF |
|---|---|
| Ventas | Total, Cantidad, Ticket Promedio, Mayor Venta |
| Compras | Total, Cantidad, Promedio |
| Clientes | Total Clientes, Con deuda, Total Deuda |
| Financiero | Ingresos, Egresos, Balance, Registros |
| Cuenta Corriente | Total DEBE, Total HABER, Balance, Movimientos |
| MP por Tipo | Total MP, Transferencias, QR/Billetera, Tarjetas |

**`companyName`** tomado de `config.nombre_empresa` (contexto empresa) — el PDF muestra el nombre real del cliente en lugar de "KAIROX Gestión" hardcodeado.

### Fix de tipos TypeScript

Errores `TS7006 (any implícito)` corregidos en:
- `dashboardService.ts` → cast `CotRow` explícito en `getCotizacionesStats`
- `conciliacionService.ts` → tipo inline en callback filter de candidatos
- `proveedoresService.ts` → tipo inline en reduce de saldo proveedores

**Resultado:** `tsc --noEmit` → 0 errores. Build → ✅ 3170 módulos.

### Commits de la sesión
| Hash | Descripción |
|---|---|
| `723f9c0` | feat: segmentar cobros MP por tipo (transferencia/QR/tarjeta) + reporte |
| `56ca28a` | feat: dashboard KPIs de salud financiera + top clientes + panel cobranzas + PDF corporativo |
| `9ed6671` | fix: types implícitos any en dashboardService, conciliacionService, proveedoresService |

## Sesión 54 — Cierre definitivo de la segunda auditoría (Luciano)

### Migration 077 — `fn_oc_recalcular_estado`: revocar EXECUTE de anon

**Hallazgo (detectado en `get_advisors` al retomar la sesión):** `fn_oc_recalcular_estado()` era callable por el rol `anon` vía `/rest/v1/rpc/fn_oc_recalcular_estado`. Es una función SECURITY DEFINER que hace DML sobre `ordenes_compra` (`UPDATE estado`). Aunque llamarla sin trigger context hace que `NEW` sea `NULL` y la función retorne temprano sin hacer nada, el grant en sí es incorrecto.

**Fix:** `REVOKE EXECUTE ON FUNCTION public.fn_oc_recalcular_estado() FROM PUBLIC, anon` (migration 077). Mismo patrón que migrations 063 y 070. Verificación post-fix: `anon=false`, `authenticated=true`, `service_role=true`. Trigger `trg_oc_recalcular_estado` sigue habilitado (`tgenabled=O`).

### Estado final de advisors de seguridad (2026-06-23)

| Función | Rol | Estado | Justificación |
|---|---|---|---|
| `email_exists_in_system` | anon | ✅ Aceptado | Intencional: invite-user edge function necesita verificar si el email ya existe antes de invitar |
| Todas las RPCs operativas | authenticated | ✅ Aceptado | Diseño: son el contrato público del sistema, con guards de tenant internos |
| Funciones trigger (`fn_audit_trigger`, `fn_oc_update_stock`, `fn_sync_conciliado`, `fn_update_cliente_saldo`, `handle_new_user`, `sync_uala_to_bancos`, `trg_fn_seed_maestros_empresa`, `trg_fn_seed_series_numeracion`) | authenticated | ✅ Aceptado | Sin contexto de trigger, `NEW`/`OLD` son NULL y fallan solas — documentado en sesión 51 |
| Leaked Password Protection | — | ⏳ Pendiente de negocio | Requiere plan Pro de Supabase — no es bloqueante técnico |

### Cierre completo de la segunda auditoría

**Todas las áreas cubiertas (sesiones 52, 53, 54):**
- ✅ Cobertura de RLS en ~50 tablas multi-tenant — 2 hallazgos críticos cerrados (migrations 071, 072)
- ✅ Guards de tenant en 36 RPCs SECURITY DEFINER — 3 hallazgos cerrados (migrations 073, 074, 075)
- ✅ Precisión financiera (IVA, PPP, moneda paralela) — 0 bugs, 2 endurecimientos (migration 076)
- ✅ Errores silenciosos — 33 archivos, 0 hallazgos accionables
- ✅ Exposición de funciones a anon — 1 hallazgo cerrado (migration 077)

**Migration final: 077. Repo: limpio y sincronizado con origin/master.**

## Sesión 53 — Reanudación y cierre de `PLAN_AUDITORIA_2.md` (Nadia)

### Sección 1 — Guards de tenant en RPCs no relacionadas a `stock_actual`

Listadas las 36 funciones `SECURITY DEFINER` del schema `public`. Triage: 8 RPCs de stock + auxiliares ya auditadas (sesiones 36-48), triggers no necesitan guard (los dispara el motor), seeds/sistema corren en contexto controlado. Pendientes reales: `crear_nota_debito`, `insertar_movimiento_bancario_externo`, `fecha_en_periodo_cerrado`, `siguiente_numero_documento`.

**Hallazgo metodológico:** las áreas que el plan mencionaba — cheques, retenciones, plan de cuentas/asientos — **no tienen RPCs `SECURITY DEFINER`**. Toda esa lógica vive en cliente con INSERT/UPDATE directos. La seguridad de esas áreas depende 100% de las policies RLS de las tablas (cobertura ya mapeada en sesión 52). No hay deuda de auditoría adicional ahí.

**`insertar_movimiento_bancario_externo` — referencia perfecta, sin hallazgo:** tenant guard + excepción a `service_role` + validación de `cuenta_bancaria_id` contra empresa. Es el patrón a copiar.

#### Migration 073 — `crear_nota_debito`: validar IDs relacionados cross-tenant

**Vector confirmado con `BEGIN...ROLLBACK`:** Tenant T (atacante) llama la RPC con su propio `p_empresa_id=T` (pasa el guard de tenant) pero pasa `p_cliente_id` y `p_comprobante_id` de Tenant U. La fila se insertaba en `notas_debito` con `empresa_id=T` pero `cliente_id`/`comprobante_id` apuntando a recursos de U. Lo mismo en el INSERT a `cuenta_corriente_movimientos`. Resultado verificado: `{"empresa_id":"T","cliente_id":"U","comprobante_id":"U","descripcion":"ND ND-2026-0001 - ATAQUE CROSS-TENANT"}`. Severidad: cross-tenant integrity corruption (no leak pasivo, requiere atacante activo).

**Fix:** 4 validaciones `IF NOT EXISTS (SELECT 1 FROM ... WHERE id = $1 AND empresa_id = $2)` para `p_cliente_id`, `p_proveedor_id`, `p_comprobante_id`, `p_compra_id` antes de cualquier INSERT. Verificación post-fix: el ataque ahora falla con `cliente_id no pertenece a la empresa`.

#### Migration 074 — `fecha_en_periodo_cerrado`: agregar guard de tenant

**Vector confirmado:** Tenant V autenticado consulta el calendario contable de Tenant W (`p_empresa_id` de W) y la función devolvía `true`/`false` según el período de W. Severidad: muy baja (read-only bool, info de calendario), pero rompe consistencia con el patrón del resto del sistema.

**Fix:** convertir de `SQL STABLE` a `PLPGSQL STABLE` para poder usar `RAISE EXCEPTION` + guard de tenant idéntico al de `insertar_movimiento_bancario_externo`. Verificación post-fix: el ataque ahora falla con `No autorizado: empresa_id no coincide con el usuario autenticado`.

#### Migration 075 — `siguiente_numero_documento`: guard de tenant + whitelist

**Vector confirmado:** Tenant X consulta `siguiente_numero_documento('Tenant_Y', 'entregas', 'numero_entrega', 'ENT')` y obtiene `ENT-2026-0005`, revelando que Y tiene exactamente 4 entregas. Info disclosure de conteo. Adicional: `EXECUTE format('SELECT COUNT(*) FROM public.%I WHERE empresa_id = $1 AND %I LIKE $2', p_tabla, p_columna)` con `%I` (quote_ident) mitiga SQL injection clásico, pero permite apuntar a **cualquier tabla** del schema con columna `empresa_id` — info disclosure indirecto.

**Fix:** guard de tenant + whitelist explícita de las 2 únicas combinaciones reales (confirmado con grep en `pg_proc`):
- `crear_venta`: `('entregas', 'numero_entrega', 'ENT')`
- `crear_devolucion`: `('devoluciones', 'numero_devolucion', 'DEV')`

Verificación post-fix: ataque con `empresa_id` ajeno → `No autorizado`; combinación arbitraria con `empresa_id` propio (ej. `'comprobantes', 'numero_venta', 'X'`) → `Combinación (tabla, columna, prefijo) no permitida`; camino feliz con `('entregas', 'numero_entrega', 'ENT')` y empresa propia → devuelve `ENT-2026-0001` correctamente.

### Sección 2 — Precisión de cálculos financieros

**0 bugs reales encontrados.** La aritmética de IVA en `crear_venta` es matemáticamente correcta — `ROUND(SUM, 2)` aplicado solo al final del LOOP, una vez por columna. Verificado empíricamente: con 3 items de subtotal 33.33 al 21%, `Σ neto + Σ iva = 99.99 = total`. Con casos mixtos (21% + 10.5%), también cierra. Toda la math en SQL `numeric` exacto, nunca pasa por JS `Math.round`. `crear_nota_debito` no hace aritmética, solo persiste `p_monto` tal cual. Todos los campos monetarios `(monto, total, subtotal, precio_*, costo_compra, iva_*, neto_gravado)` son `numeric(12,2)` consistentes.

**2 oportunidades de endurecimiento preventivo aplicadas** (migration 076), aprovechando que cero data real las usa:

1. **Drift de PPP por persistencia a 2 decimales:** `fn_calcular_costo_valoracion` devuelve `numeric` sin bounds (preserva ~20 dígitos), pero `productos.costo_compra` era `numeric(12,2)`. En modo `promedio_ponderado`, cada compra encadenada partía de un costo truncado. Verificado: PPP exacto `1.00004950...` → persistido `1.00` → siguiente PPP parte de `1.00` en vez de `1.0001`, drift acumulado de ~0.0001 por compra. Fix: `costo_compra → numeric(14,4)`. La UI sigue mostrando 2dp vía `formatCurrency`.

2. **Moneda paralela sin precisión definida:** 4 columnas `monto_paralelo` (`comprobantes`, `movimientos_caja`, `cuenta_corriente_movimientos`, `compras`) eran `numeric` sin precision/scale. `calcParalelo` en JS hacía `inARS / tcUsed` puro IEEE 754, introduciendo ε de ~1e-13 por operación. Cero filas con `monto_paralelo` en producción al momento del fix → ventana óptima. Fix: las 4 columnas a `numeric(14,4)` + `Math.round((inARS / tcUsed) * 100) / 100` en `useTCParalelo.calcParalelo` para limitar a 2dp en source.

### Sección 3 — Patrones de manejo de errores silenciosos

Auditoría de 33 archivos en `src/` con `console.error`/`console.warn`. **Cero hallazgos accionables.** Cero catches vacíos en todo el código. Clasificación final:

- **Fetch/read silenciado (OK):** `CajaContext`, `ConfigContext`, `useTCParalelo`, `ReporteParidad`, `HistorialVentas`, `ProductosSection` (×4 fetches), `ConfiguracionSection` (×6 cargas de config). Si el fetch falla, la pantalla queda en estado anterior — no hay write a medio camino.
- **Write con toast destructive + return natural (OK):** `NuevaVentaModal:576-578`, `NuevaFacturaModal:293-295`, `NuevaNCModal:233-235`, `CompraDetailModal:60-66/86-88`, `SaleDetailModal:69-75/99-101`, `ComprobantePrintModal:97-99`. El catch notifica al usuario y el flujo se corta naturalmente.
- **Telemetría no crítica (OK):** `AlertasStockBanner:41` (insert a `audit_log` silenciado).
- **Fixes recientes ya verificados:** `CompraRapidaSection.handleSaveEdit` (sesiones 49+53), `NuevaDevolucionProveedorModal` (sesión 49), `ProductosSection.handleSubmitMovimiento` (sesión 49).

**Decisiones de diseño explícitamente documentadas (NO son bugs):**
1. `CompraRapidaSection.jsx:359-368` — recepción implícita "no bloqueante — solo documental". Si falla, solo se pierde la trazabilidad documental para MapaRelaciones.
2. `NuevaVentaModal.jsx:518` — asiento contable fire & forget fuera de la transacción.
3. `NuevaVentaModal.jsx:520-548` — emisión CAE AFIP fire & forget.

**🟡 Observación de UX (NO bug, requiere decisión de producto):** los puntos 2 y 3 son técnicamente correctos pero generan desincronización silenciosa entre ventas y libro contable/CAE. Una empresa con AFIP activo podría no enterarse de que un CAE falló sin revisar el `HistorialVentas`. Recomendación futura: agregar badge/alerta en `HistorialVentas` para comprobantes con `cae_estado='pendiente'` o sin asiento asociado. Afecta UI/UX, no integridad de datos críticos — conversar con Luciano sobre cuán visible debería ser ese estado.

### Estado total de PLAN_AUDITORIA_2.md (cerrado)

| Sección | Resultado | Migrations |
|---|---|---|
| 0. Ya hecho (sesión 52) | ✅ Heredado | 071, 072 |
| 1. Guards de tenant en RPCs no-stock | ✅ 3 hallazgos confirmados y cerrados | **073, 074, 075** |
| 2. Precisión cálculos financieros | ✅ 0 bugs, 2 endurecimientos preventivos | **076** + `useTCParalelo.js` |
| 3. Errores silenciosos | ✅ 0 hallazgos accionables, 1 observación de UX | — |

**Build verificado:** `npm run build` exit 0 después de cada migration y del cambio JS. `dist/` 3.84 MB en 11 archivos. **Ningún view ni función dependiente de `costo_compra` o `monto_paralelo` afectada** (verificado con `pg_views`).

**Archivos nuevos:** `supabase/migrations/073_crear_nota_debito_validar_ids_relacionados.sql`, `074_fecha_en_periodo_cerrado_guard_tenant.sql`, `075_siguiente_numero_documento_guard_y_whitelist.sql`, `076_precision_costo_y_moneda_paralela.sql`. **Modificado:** `src/hooks/useTCParalelo.js`.

## Sesión 52 — Segunda auditoría: RLS más allá de `stock_actual`

A pedido explícito de Luciano: auditoría de arriba a abajo de TODO lo que las sesiones 36-51 no cubrieron (esas se centraron en `stock_actual`, exposición de RPCs a `anon`, y performance). Invocadas las skills `sap-reference` (marco funcional ERP) y `saas-architect` (esta última resultó mayormente sobre estrategia de negocio AaaS/agentes IA, no aplicable a un ERP tradicional — lo único usable fue su checklist de arquitectura multi-tenant, que ya se sigue en KAIROX).

**Metodología:** en vez de confiar en memoria o asumir que "todo debería estar bien", se consultó `pg_class`/`pg_policy` directamente para mapear la cobertura REAL de RLS en las ~50 tablas con `empresa_id`, en vez de revisar tabla por tabla a ojo.

### Hallazgo 1 (CRÍTICO, resuelto) — fuga cross-tenant real en `movimientos_uala`

Query de cobertura (`pg_policy` + `pg_get_expr` sobre `polqual`/`polwithcheck`) mostró que `movimientos_uala` tenía una policy de SELECT que NO mencionaba `empresa_id` en absoluto: `"usuarios autenticados pueden leer"` con `USING ((select auth.role()) = 'authenticated')`. Confirmado que `MovimientosUala.jsx` tampoco filtra por `empresa_id` en el cliente (`grep` confirmó: la query es `supabase.from('movimientos_uala').select(...).order('fecha', ...)`, sin ningún `.eq('empresa_id', ...)`) — dependía 100% de RLS para el aislamiento, y RLS no lo hacía.

**Verificado con `BEGIN...ROLLBACK` (no hipotético):** Tenant X insertando "Secreto de Tenant X" y Tenant Y insertando "Secreto de Tenant Y" — impersonando al usuario de Tenant X, la query devolvía **ambas filas**, incluida la de Tenant Y. Esto es una fuga real de datos financieros entre empresas, no un lint teórico — y hay datos reales en la tabla (empresa `db21dfad-...`, 15 filas).

**Fix (migration 071):** `DROP` de la policy vieja, `CREATE POLICY "usuarios autenticados pueden leer su empresa" ... USING (empresa_id = (select get_my_empresa_id()))`, mismo patrón que el resto del sistema. Re-verificado con el mismo escenario: Tenant X ahora ve únicamente su propia fila.

### Hallazgo 2 (resuelto) — `profiles` bloqueaba a los admins de ver a sus colegas (caso inverso: under-permisivo, no fuga)

Mismo barrido de `pg_policy` sobre `profiles` mostró 6 policies, ninguna combinación de las cuales permite a un usuario ver perfiles de OTROS usuarios — la única policy de SELECT (`profiles_select`) es `USING (id = auth.uid())`. Las policies `profiles_admin_update/insert/delete` sí permiten operar sobre colegas de la misma empresa (`is_admin() AND empresa_id = get_my_empresa_id()`), pero no había ninguna equivalente para SELECT.

**Verificado con `BEGIN...ROLLBACK`:** un admin consultando `profiles WHERE empresa_id = su_empresa` recibía exactamente **1 fila** (la propia), nunca la de su colega — confirmado antes Y después del fix (antes: 1 fila; después: 2 filas). `UsuariosSection.jsx` (la pantalla de "Usuarios y Roles", gateada a `isAdmin` vía `useUserPermissions`) depende de esta query para listar el equipo — hoy en producción esa lista muestra solo al usuario logueado, nunca a sus compañeros, para CUALQUIER empresa del sistema.

**Investigación de alcance (agente Explore, solo lectura):** grep exhaustivo de todo `src/` confirmó que `UsuariosSection.jsx` es el ÚNICO lugar que necesita ver perfiles de otros usuarios — ningún otro componente/hook/servicio (`cotizacionesService`, `pedidos`, `audit_log`, `dashboardService`, `useNotifications`, `CajaSection`) intenta resolver nombre/email de otro usuario vía `profiles`. Esto acotó el fix al mínimo necesario.

**Fix (migration 072):** nueva policy `profiles_admin_select` (`is_admin() AND empresa_id = get_my_empresa_id()`), mismo patrón que las otras 3 policies de admin sobre `profiles`. No se amplió a todos los usuarios autenticados — solo admins, que es el único caso de uso real.

`npm run build` exit 0 después de ambos fixes. Archivos nuevos: `supabase/migrations/071_fix_rls_movimientos_uala_select_sin_tenant.sql`, `072_fix_profiles_admin_select_colegas.sql`. Ningún archivo de frontend tocado (ambos fixes son 100% a nivel de policy RLS).

**Pendiente en esta auditoría (sin empezar todavía):** guards de tenant en RPCs no relacionadas a stock (notas de crédito/débito, cheques, retenciones, conciliación bancaria, plan de cuentas/asientos); precisión de cálculos financieros (redondeo de IVA/totales/TC paralelo); patrones de manejo de errores fuera de `stock_actual` (más casos de `console.error` silencioso como los ya encontrados).

## Sesión 51 (continuación 4) — 1.2: "Leaked Password Protection" bloqueado por plan, no por configuración

Guié a Luciano paso a paso por el Dashboard de Supabase (2 intentos fallidos antes de dar con el lugar correcto: no es "Políticas" —eso es RLS— ni "Contraseñas" —eso es WebAuthn/passkeys—). El toggle real está en **Authentication → Iniciar sesión / Proveedores → Email → "Prevent use of leaked passwords"** (la letra chica ya avisaba "Solo disponible en el plan Pro y superiores", pero el switch se deja activar visualmente en la UI). Luciano lo activó y al intentar guardar, Supabase mostró un cartel pidiendo upgradear de plan — confirmado: **no se puede activar en el plan Gratis actual**.

**Resultado:** esto NO es un pendiente de configuración de 2 minutos como se documentó originalmente — es una decisión de negocio (pagar el plan Pro de Supabase o no) bloqueada por un límite comercial de la plataforma, no por falta de tiempo o de acceso. `PLAN_SEMANA.md` sección 1.2 actualizada para reflejar esto con precisión. Riesgo real si queda sin activar: los usuarios pueden registrarse o cambiar su contraseña a una que ya esté en bases de datos de contraseñas filtradas (HaveIBeenPwned) — no es explotable directamente por un atacante externo, solo reduce una capa de defensa contra el reuso de credenciales ya comprometidas en otros sitios.

Con esto, de todo lo crítico/funcional/performance auditado en estas ~15 sesiones, **el único punto sin cerrar es éste, y está fuera del control técnico del proyecto** (depende de upgradear el plan de Supabase). Sin cambios de código ni migrations en esta continuación.

## Sesión 51 (continuación 3) — Día 3: regression pass con `get_advisors`

Tras cerrar Ualá→Bancos, correspondía el "regression pass completo" de la sección 7 del plan. Los 11 archivos de `supabase/tests/` ya habían sido re-verificados de punta a punta dentro de esta misma sesión (9 de Fase 1 al corregir el bug de `profiles_pkey`, más los 2 de Fase 2) — no hacía falta repetirlo, nada tocado después los afecta. Se corrió `get_advisors` (security + performance) como verificación adicional, que las corridas de pgTAP no cubren:

**Hallazgo (security, propio, no del diseño de Ualá en sí):** `sync_uala_to_bancos()` apareció ejecutable por `anon` y `authenticated` vía REST. Causa: se creó con `DROP FUNCTION` + `CREATE` (no un `CREATE OR REPLACE` puro sobre la misma función), así que nació con los grants default de Postgres en vez de heredar el `REVOKE EXECUTE FROM PUBIC, anon` que la vieja `sync_uala_to_caja()` tenía desde la migration 063. **Migration 070:** mismo revoke, mismo patrón — deja `authenticated` igual que el resto de las funciones trigger ya aceptadas (`fn_oc_update_stock`, `handle_new_user`, etc., que migration 063 tampoco le revocó a `authenticated` porque no hace falta: llamarlas directo via RPC falla solo, `NEW`/`OLD` no están definidos fuera de un trigger real). Re-verificado con `has_function_privilege`: `anon=false`, `authenticated=true` (igual que sus pares), `service_role=true`. Re-corrido el flujo completo con `BEGIN...ROLLBACK` tras el revoke — el trigger sigue disparando normal (no necesita el grant, lo dispara el motor).

**Performance:** sin hallazgos nuevos. Los únicos 2 lints sobre `movimientos_bancarios` (FK `asiento_id` sin índice, índice `idx_mb_fecha` sin uso todavía) son genéricos de cualquier tabla con poco tráfico real aún — mismo backlog ya documentado en sección 3 del plan (90 multiple_permissive_policies / 75 FKs sin índice / 40 índices sin uso), no accionable ahora.

`npm run build` exit 0. Archivo: `supabase/migrations/070_revocar_anon_sync_uala_to_bancos.sql` (nuevo). Con esto, el regression pass del Día 3 queda cerrado — solo falta **1.2** (toggle "Leaked Password Protection" en el Dashboard de Supabase, requiere acceso humano) y la decisión de deploy.

## Sesión 51 (continuación 2) — Ualá de Caja a Bancos: arquitectura correcta, no solo un test

**Contexto:** al cerrar el test de `sync_uala_to_caja` (continuación anterior), Luciano hizo una pregunta de fondo: ¿por qué una transferencia de Ualá impacta en Caja en vez de en una cuenta bancaria? Pidió explícitamente respaldarse en la skill `sap-reference` y en cómo lo resuelven sistemas de primer mundo, con la intención de que el resultado se aplique como patrón general a todo el sistema.

**Investigación (antes de tocar nada):** la skill `sap-reference` confirma el principio (Bancos y Caja son módulos separados — arqueo de efectivo físico vs. conciliación bancaria). Pero lo más importante: **KAIROX ya tenía la arquitectura correcta construida y en uso real** — `cuentas_bancarias` (con `plan_cuenta_id`, ligada al plan de cuentas) + `movimientos_bancarios` (libro con flag `conciliado`) + `integraciones_bancarias` (mapea empresa+proveedor→cuenta) + la RPC `insertar_movimiento_bancario_externo` (punto de entrada seguro para integraciones externas, con guard multi-tenant que exceptúa `service_role`). Mercado Pago ya usa exactamente este camino (`mp-webhook` → la RPC → `movimientos_bancarios`). Ualá simplemente nunca se conectó a él — quedó con un atajo directo a `movimientos_caja` (el trigger `sync_uala_to_caja`, documentado pero no corregido en la continuación anterior). Confirmado además que `'uala'` ya estaba habilitado en `integraciones_bancarias_proveedor_check` desde sesión 39, con una nota explícita: "se agrega en su propia migration cuando esa integración exista" — ese momento era ahora.

**Decisiones confirmadas con Luciano (AskUserQuestion) antes de implementar:** (1) reemplazo completo del camino viejo, no mantenerlo en paralelo; (2) construir un modal de configuración en la UI (no setear la cuenta a mano por SQL) para que cualquier empresa pueda activar Ualá sola.

**Migration 069:**
1. `movimientos_bancarios_origen_check` ampliado con `'uala'`.
2. `DROP` del trigger/función viejos (`trigger_uala_to_caja` / `sync_uala_to_caja`).
3. Función nueva `sync_uala_to_bancos()`: resuelve `cuenta_bancaria_id` vía `integraciones_bancarias WHERE empresa_id=NEW.empresa_id AND proveedor='uala' AND activo=true`; si la encuentra, llama `insertar_movimiento_bancario_externo(p_tipo:='egreso', p_origen:='uala', p_descripcion:='Ualá → '||COALESCE(destinatario,'Desconocido'))`. Si no la encuentra, no hace nada — **a propósito**: un trigger `AFTER INSERT` que lance una excepción haría rollback de la fila que el Apps Script ya insertó en `movimientos_uala`, perdiendo el dato de origen. El nuevo trigger ya **no usa `user_id` ni `caja_sesiones`** — la transferencia ya no depende de si hay un cajero con turno abierto.
4. `movimientos_uala` (la tabla de aterrizaje del Apps Script que sincroniza desde Gmail) **no se tocó** — sigue recibiendo las filas exactamente igual, cambia solo qué pasa después.

**Verificado con `BEGIN...ROLLBACK`** (con `set_config` simulando `service_role`, el único rol con permiso de `INSERT` en `movimientos_uala` desde la migration 065 — confirmado por `information_schema.role_table_grants` que es el único camino posible para el Apps Script real): la RPC funciona correctamente vía el trigger nuevo.

**UI:** `src/components/bancos/ConfigUalaModal.jsx` (nuevo) — espejo simplificado de `ConfigMercadoPagoModal.jsx`, sin token ni verificación (Ualá no tiene API, es 100% Gmail-parsing por Apps Script): solo un `Select` de `cuentas_bancarias` de la empresa, `upsert` en `integraciones_bancarias` (`onConflict: 'empresa_id,proveedor'`). Card nueva en `ConfiguracionSection.jsx` → tab Integraciones, con estado real (`integracionUala`/`showConfigUala`/`reloadIntegracionUala`, mismo patrón que `integracionMP`). **Importante:** ya existía una card placeholder "Ualá" para una función DISTINTA (cobro con QR en caja, `estado="proximamente"`) — se renombró a "Ualá QR" para no confundirla con la nueva card real "Ualá (conciliación)".

**Test:** `supabase/tests/sync_uala_to_bancos.test.sql` reemplaza a `sync_uala_to_caja.test.sql` (renombrado). 6/6 verde: con integración configurada genera 1 `movimiento_bancario` egreso imputado a la cuenta correcta (Caso 1a/1b); destinatario NULL cae al fallback (Caso 2); confirma que ya NO toca `movimientos_caja` en absoluto (Caso 3); sin integración configurada no genera nada y no lanza error (Caso 4, documentado); tampoco cae al camino viejo como fallback (Caso 5). Fixtures mucho más simples que la versión vieja — ya no hace falta `auth.users`/`profiles`/`caja_sesiones`, solo `empresas`/`cuentas_bancarias`/`integraciones_bancarias`.

**Dato real sin tocar:** la empresa real `db21dfad-...` tiene 15 filas históricas en `movimientos_uala` (30/05 al 03/06, sin actividad desde entonces) — esas no se reprocesan retroactivamente; sus `movimientos_caja` históricos (si los generó el trigger viejo en su momento) quedan como están, ya forman parte de arqueos pasados. El cambio rige solo para transferencias nuevas, y solo una vez que esa empresa configure su integración Ualá desde la card nueva.

**Patrón establecido para todo el sistema (pedido explícito de Luciano):** cualquier integración bancaria/fintech futura (otra billetera, otro banco, lo que sea) debe conectarse a `integraciones_bancarias` + `insertar_movimiento_bancario_externo` → `movimientos_bancarios`. Nunca un atajo directo a `movimientos_caja`. Documentado en `PLAN_SEMANA.md` sección 4.

`npm run build` exit 0. Archivos: `supabase/migrations/069_uala_de_caja_a_bancos.sql` (nuevo), `src/components/bancos/ConfigUalaModal.jsx` (nuevo), `src/components/sections/ConfiguracionSection.jsx` (modificado), `supabase/tests/sync_uala_to_bancos.test.sql` (reemplaza a `sync_uala_to_caja.test.sql`).

## Sesión 51 (continuación) — Fase 2 de tests: conciliación Uala (`sync_uala_to_caja`)

**`supabase/tests/sync_uala_to_caja.test.sql` (nuevo, 5/5 verde).** Releído fresco vía `pg_get_functiondef`/`pg_get_triggerdef`: el trigger `trigger_uala_to_caja` (`AFTER INSERT ON movimientos_uala`, función `sync_uala_to_caja`) busca la `caja_sesion` ABIERTA del usuario (`cierre_fecha IS NULL`, la más reciente) y le inserta un `movimientos_caja` tipo `'egreso'`/`'Otro Egreso'`/`concepto='Ualá → ' || destinatario`. `movimientos_uala` no tiene columna `tipo` — toda fila es una salida de dinero, por diseño, así que el tipo fijo `'egreso'` es correcto, no un bug. Confirmado en `CajaContext.jsx` que `closeSession` siempre setea `estado='cerrada'` y `cierre_fecha` juntos en el mismo `UPDATE` — no hay riesgo de que esos 2 campos queden desincronizados por algún otro camino, así que el filtro del trigger por `cierre_fecha IS NULL` es seguro.

Casos cubiertos: 1a/1b (caja abierta → 1 movimiento, ligado a la `caja_sesion_id` correcta), 2 (destinatario NULL → fallback `"Ualá → Desconocido"`), 3 y 4 (**hallazgo documentado, no corregido — es diseño actual, no un bug**: si el usuario no tiene ninguna `caja_sesion` abierta en ese momento — sin ninguna, o con la única existente ya cerrada — el trigger no inserta nada y tampoco lanza error; la transferencia de Ualá queda sin reflejarse en `movimientos_caja`, silenciosamente). No se tocó el comportamiento porque cambiarlo (¿debería crear un movimiento con `caja_sesion_id=NULL`? ¿debería lanzar una alerta?) es una decisión de producto, no algo a decidir unilateralmente al escribir un test — queda anotado en `PLAN_SEMANA.md` para que Luciano lo vea.

**`emitir-cae` y Caja quedan fuera de alcance de pgTAP, no por falta de tiempo sino porque no aplica la herramienta:** `emitir-cae` es una edge function (Deno) que llama servicios SOAP/REST reales de AFIP, no una función SQL — testearla automatizada requeriría mockear AFIP o pegarle a su entorno de homologación, otro tipo de test distinto a pgTAP. Caja (apertura/cierre, arqueo) no tiene ninguna RPC `SECURITY DEFINER` — confirmado por grep en `pg_proc` que solo existen `create_caja_principal` (trigger de seed) y `sync_uala_to_caja`, ninguna de "abrir/cerrar caja" — toda esa lógica vive en `CajaContext.jsx`/`CajaApertura.jsx`/`CajaCierre.jsx` haciendo `INSERT`/`UPDATE` directo desde el cliente. Eso es candidato a prueba manual en navegador, no a test pgTAP.

Con esto, **la Fase 2 del `PLAN_SEMANA.md` queda con 2 de 4 frentes originales resueltos** (efectos colaterales de `crear_venta`, conciliación Uala) y los otros 2 reclasificados como "no aplica pgTAP" en vez de "pendiente". `npm run build` exit 0. Ningún archivo de código frontend ni migration nueva — todo en `supabase/tests/` + docs.

## Sesión 51 — Fase 2 de tests: efectos colaterales de `crear_venta` + fix de regresión en los 9 tests de Fase 1

**Fase 2, primer frente: `supabase/tests/crear_venta_efectos_colaterales.test.sql` (nuevo, 10/10 verde).** `crear_venta.test.sql` (Fase 1) cubre `stock_actual` + guards de tenant/stock a propósito y deja todo lo demás fuera de alcance. Este archivo cubre lo que quedaba afuera, releyendo `crear_venta` fresco (`pg_get_functiondef`) para mapear cada rama:
- **`movimientos_caja`:** el loop de `p_pagos` inserta un `ingreso`/`Venta` por cada pago cuyo `metodo` sea distinto de `'Cuenta Corriente'`. Caso 1: pago Efectivo → 1 movimiento. Caso 2: pago "Cuenta Corriente" → 0 movimientos (es deuda, no caja).
- **`cuenta_corriente_movimientos`:** solo se inserta si `p_es_cc=true` Y `p_cliente_id IS NOT NULL` — es opt-in, no automático aunque haya cliente. Caso 3: `es_cc=true` → 1 movimiento DEBE por `p_total`, ligado al `comprobante_id`. Caso 4: `es_cc=false` con cliente → 0 movimientos.
- **Entrega:** si `p_pedido_id` viene NULL (o no hay una entrega manual `'entregado'` para ese pedido), `crear_venta` crea su propia entrega `origen='implicita'`, `estado='entregado'`, con su `entrega_item` y marca `comprobante_items.cantidad_entregada`. Si SÍ hay una entrega manual previa para ese pedido (caso típico: se generó la entrega desde `GenerarEntregaModal` antes de facturar), `crear_venta` la reconcilia — le setea `comprobante_id` — en vez de crear una segunda entrega duplicada. Caso 5 (a/b/c): camino implícito. Caso 6 (a/b/c): reconciliación con entrega manual preexistente — verificado que sigue habiendo exactamente 1 entrega para ese pedido (no se duplicó) y que quedó vinculada al comprobante correcto.

**Hallazgo de regresión real en los 9 tests de Fase 1 (no relacionado con el test nuevo, descubierto al escribirlo).** Al armar el fixture estándar para Tenant R (`INSERT INTO auth.users` seguido de `INSERT INTO public.profiles`, el patrón usado en los 9 archivos de Fase 1), salió `ERROR: duplicate key value violates unique constraint "profiles_pkey"`. Causa: el trigger `on_auth_user_created` (función `handle_new_user`, confirmado con `pg_get_functiondef` que existe desde antes de sesión 36, sin relación con cambios de esta semana) ya inserta automáticamente la fila en `profiles` (con `empresa_id` NULL) al insertar en `auth.users` — el `INSERT` explícito subsiguiente choca con esa fila por PK. Se confirmó el síntoma corriendo el fragmento de fixture de `crear_venta.test.sql` tal cual estaba: falla igual. Esto significa que, **hoy, los 9 archivos de `supabase/tests/` estaban rotos si se los volvía a correr literal** — no es un problema introducido en esta sesión, es preexistente, recién detectado.

**Fix aplicado a los 9 archivos** (`ajustar_stock_manual`, `aplicar_compra_producto`, `crear_devolucion`, `crear_entrega`, `crear_recepcion`, `crear_venta`, `decrement_stock`, `increment_stock`, `obtener_proximo_numero`): reemplazado el `INSERT INTO public.profiles (id, empresa_id, email) VALUES (...)` por `UPDATE public.profiles SET empresa_id = ... WHERE id = ...` para cada usuario de fixture — la fila ya existe (creada por el trigger), solo hace falta completarle el `empresa_id`. **Cada uno de los 9 se volvió a correr de punta a punta tras el fix** (no se asumió que el cambio mecánico bastaba): los 9 quedaron en el mismo conteo de casos en verde que tenían documentado (11, 9, 8, 5, 17, 5, 6, 8 y 10 respectivamente — el 10 de `obtener_proximo_numero` incluye el `skip()` de concurrencia real). De paso se encontró y corrigió un segundo bug, preexistente y no relacionado, en `obtener_proximo_numero.test.sql`: usaba la columna `confirmed_at` en el `INSERT INTO auth.users`, que hoy es una columna generada (`ERROR: cannot insert a non-DEFAULT value into column "confirmed_at"`) — corregida a `email_confirmed_at`, igual que los otros 8 archivos.

Con esto, **toda la Fase 1 de tests sigue siendo válida y vuelve a estar verificada de verdad** (no solo "documentada como verde" de sesiones anteriores), y arranca la Fase 2 con 1 de 4 frentes cerrado. `PLAN_SEMANA.md` sección 4 actualizada. Ningún archivo de código frontend ni migration nueva — todo el trabajo fue en `supabase/tests/`.

## Sesión 50 (continuación 3) — `DROP` de `ventas_backup`/`detalle_ventas_backup`

Tercer y último quick win de la sección 3. Luciano no sabía qué eran estas 2 tablas — se le mostró el contenido completo (solo `SELECT`, sin tocar nada) antes de decidir: 5 filas en `ventas_backup` (columnas `cliente`/`metodo_pago`/`subtotal`/`descuento`/`total` — el esquema viejo de ventas, anterior al modelo actual `comprobantes`/`comprobante_items`) y 9 en `detalle_ventas_backup`, todas con fecha 2026-06-02/03 (los primeros días del sistema). Confirmado que ya existen 8 `comprobantes` reales de la misma empresa en ese mismo rango de fechas — son datos de la transición de esquema, ya reemplazados. Confirmado también vía `pg_constraint` que ninguna otra tabla tiene FK hacia estas 2.

**Migration 068** — `DROP TABLE` de ambas. El contenido completo (14 filas en total) quedó embebido como `INSERT` comentado en el rollback de la migration — no se generó un backup aparte en Supabase porque con esto alcanza para recuperarlo si algún día hiciera falta, sin depender de una herramienta externa.

Con esto, **la sección 3 del `PLAN_SEMANA.md` (performance) queda 100% resuelta** — los 3 quick wins (RLS initplan, índices duplicados, tablas backup) cerrados en la misma sesión. De todo lo crítico/funcional/performance del plan original, solo falta **1.2** (activar "Leaked Password Protection" — toggle de 2 minutos en el Dashboard de Supabase, no se puede hacer por SQL).

`npm run build` exit 0. Archivo: `supabase/migrations/068_drop_tablas_backup_ventas.sql` (nuevo). Ningún archivo de código frontend tocado.

---

## Sesión 50 (continuación 2) — Sección 3 del plan: performance (2 de 3 quick wins)

**Migration 067.** Reescritas 5 policies RLS (`profiles_select`, `profiles_insert`, `profiles_admin_delete`, `profiles_self_update`, `movimientos_uala."usuarios autenticados pueden leer"`) envolviendo `auth.uid()`/`auth.role()` en `(select ...)` — exactamente la misma lógica, solo permite que el planner cachee el resultado (`InitPlan`) en vez de re-evaluar la función por fila. Dropeados los 2 índices duplicados (`idx_prov_empresa`, `idx_tc_empresa_moneda_fecha`).

**Verificado con `BEGIN...ROLLBACK`:** un usuario sigue viendo solo su propio profile (RLS intacto) tras el cambio de las 5 policies. **Verificado con `get_advisors`:** 218 → 208 lints de performance — los lints `auth_rls_initplan` (5) y `duplicate_index` (2) desaparecieron del reporte. `npm run build` exit 0.

**Pendiente de la sección 3 (no se tocó, requiere decisión de Luciano sobre datos):** `ventas_backup`/`detalle_ventas_backup` — 2 tablas backup con RLS sin policy y sin PK, 5 y 9 filas respectivamente. Parecen un backup puntual viejo, no una tabla operativa activa, pero no se asumió nada — queda para confirmar antes de `DROP`.

Archivo: `supabase/migrations/067_performance_rls_initplan_y_indices_duplicados.sql` (nuevo). Ningún archivo de código frontend tocado.

---

## Sesión 50 (continuación) — 2.1 y 2.2: estado de OC automático + guard de sobre-recepción

Decisiones confirmadas por Luciano: trigger automático para 2.1, bloquear para 2.2. **Migration 066**:

**2.1** — `fn_oc_recalcular_estado()` + trigger `trg_oc_recalcular_estado` (`AFTER UPDATE OF cantidad_recibida ON ordenes_compra_items`, separado de `trg_oc_stock` — responsabilidad distinta). Recalcula el estado del `ordenes_compra` padre comparando `SUM(cantidad_recibida)` vs `SUM(cantidad_pedida)` de todos sus items. No toca OCs en `borrador`/`pendiente_aprobacion`/`cancelada`.

**2.2** — `crear_recepcion` ahora hace `SELECT cantidad_pedida, cantidad_recibida ... FOR UPDATE` + `RAISE EXCEPTION` si `cantidad_recibida + cantidad > cantidad_pedida`, antes de cualquier `INSERT` del loop. `CREATE OR REPLACE FUNCTION` preserva los `GRANT`/`REVOKE` existentes — confirmado que `anon` sigue sin poder ejecutarla después del cambio (`has_function_privilege` → `false`).

**Verificado con `BEGIN...ROLLBACK`** (7 asserts ad-hoc + reescritura completa de `crear_recepcion.test.sql`, ahora 17/17 — los Casos 2, 3 y 4 documentaban estos 2 gaps como hallazgos pendientes, ahora confirman el comportamiento nuevo): OC enviada → recibir 6/10 → `recibida_parcial` → recibir 4 más → `recibida`; intentar recibir 8 de una OC de 5 → bloquea con `'La cantidad a recibir (8) superaria lo pedido...'`, sin modificar `cantidad_recibida` ni `stock_actual`. `npm run build` exit 0.

Con esto, la sección 2 del `PLAN_SEMANA.md` (gaps funcionales de sesión 44) queda 100% resuelta — solo quedan las secciones 3 (performance) y 4 (Fase 2 de tests).

Archivos: `supabase/migrations/066_estado_oc_automatico_y_guard_sobrerecepcion.sql` (nuevo), `supabase/tests/crear_recepcion.test.sql` (actualizado), `PLAN_SEMANA.md`. Ningún archivo de código frontend tocado.

---

## Sesión 50 — Revisión del trabajo de Nadia + cierre de los 3 urgentes de la sección 0 del plan

Pull de los 2 commits de Nadia (`e9120e5`, `19d9932`). Revisión del diff completo (no solo el mensaje de commit) encontró 3 cosas que la sección 0 nueva de `PLAN_SEMANA.md` documenta y que se cerraron en esta misma sesión:

**0.1 — Dato real de cliente restaurado.** El stock de "Maquina de afeitar para hombres" (`8b5f3bd4-...`, empresa `cbc4db74-...`) había quedado en 0 por una secuencia de pruebas de Nadia: un "ajuste por inventario físico" de prueba (tipo `ajuste` de `ajustar_stock_manual` es **valor absoluto**, no delta) lo pisó a 1 sin importar el valor real, y una devolución de prueba inmediatamente después lo dejó en 0. No se pudo reconstruir el valor correcto desde `movimientos_inventario` (las compras de ese producto se aplicaron vía `aplicar_compra_producto`, que por diseño no deja movimiento — sesión 36). Luciano confirmó el stock físico real (10 unidades); restaurado con la misma RPC: `ajustar_stock_manual(..., 'ajuste', 10, 'Corrección post-testing manual sesión 49 (stock real confirmado por Luciano)')`.

**0.2 — Aclarado, no era un bug.** El botón "Devolver a proveedor" que Nadia no encontró en `OrdenesCompraSection.jsx` vive en `FacturasCompraSection.jsx` (dentro del menú de acciones ⋮ de cada factura, oculto si `estado_pago = 'anulada'`) — son módulos distintos. Sin cambios de código.

**0.3 — Patrón de fallo silencioso revertido.** El fix de Nadia para los parámetros de `decrement_stock` (bug #3 de su sesión) había cambiado, en el branch de "ítem eliminado al editar una compra", `throw` por `console.warn` — el `DELETE` de `detalle_compras` seguía de largo aunque el stock no se revirtiera. Mismo patrón que se cerró a propósito en sesión 33 para `aplicar_compra_producto` (fail-fast, no fallo silencioso), reintroducido acá en otro punto de `CompraRapidaSection.jsx`. Revertido a `throw` en los 2 puntos (ítem eliminado + ajuste de cantidad), y restaurado el `p_motivo` descriptivo con el número de factura en las 2 llamadas que lo habían perdido (`increment_stock` en el branch de aumentar cantidad ni siquiera capturaba el error antes). `npm run build` verificado, exit 0.

`PLAN_SEMANA.md` actualizado: sección 0 completa, sección 2.3 corregida (`decrement_stock` ya no es dead code, Nadia le agregó 2 callers reales), sección 5 marcada como hecha por Nadia, sección 7 (orden de la semana) comprimida a 4 días reflejando lo ya resuelto.

Archivo de código tocado: `src/components/sections/CompraRapidaSection.jsx`. Ningún archivo de test ni migration nueva esta sesión — el fix de datos (0.1) fue una llamada RPC directa sobre el producto real, no una migration.

---

## Sesión 49 (Nadia) — Testing manual browser sobre PLAN_SEMANA.md

### Bugs corregidos

1. **ProductosSection** — Modal "Registrar Movimiento": mensaje de error al superar stock mostraba UUID crudo. Corregido para mostrar nombre del producto y stock disponible (catch de `handleSubmitMovimiento` detecta "stock insuficiente" / "cantidad inválida" y arma description amigable usando `selectedProductForMov.nombre` y `.stock_actual`).

2. **CompraRapidaSection** — Edición de compras: faltaba `empresa_id` en INSERT a `detalle_compras`, lo que impedía que ítems nuevos se persistieran en DB. Agregado `empresa_id: user.empresa_id` al payload + captura de `insertError` con `console.error` + `throw`.

3. **CompraRapidaSection** — Edición de compras: `decrement_stock` se llamaba con parámetros incorrectos (`row_id`/`quantity` en lugar de `p_producto_id`/`p_cantidad`/`p_motivo`). Corregido en las dos ocurrencias (eliminación de ítem + reducción de cantidad), con motivos descriptivos.

4. **CompraRapidaSection** — Edición de compras: al reducir cantidad de un ítem existente se usaba `increment_stock` con valor negativo (anti-patrón confirmado en sesión 48). Reemplazado por condicional explícito: `diff > 0` → `increment_stock`, `diff < 0` → `decrement_stock(Math.abs(diff))`. Mismo patrón para el branch de "Deleted Items".

5. **NuevaDevolucionProveedorModal** — Devolución a proveedor con stock insuficiente mostraba UUID en el toast de error. Catch reescrito con `console.error` + detección de "stock insuficiente" + mensaje legible ("Verificá que los productos a devolver tengan stock disponible en el inventario").

### Verificado sin bugs

- ✅ Recepción parcial de OC en 2 pasos: stock no se duplica (consistente con el test pgTAP de sesión 44 que blinda contra el bug histórico de doble incremento).
- ✅ `npm run build`: exit code 0, sin errores de compilación, `dist/` 3.84 MB en 11 archivos.

### Pendiente para Luciano

- ⚠️ Restaurar stock de "Máquina de afeitar para hombres" (quedó en 0 por una prueba de testing manual — dato de cliente, no sintético).
- ⚠️ Revisar por qué el ícono de "Devolver" en OCs no aparece en la UI — puede haberse removido en algún commit reciente.
- Gap conocido (sección 2.1 del PLAN_SEMANA.md, sin cambios): estado de OC no cambia automáticamente al completar recepción (sigue en "Enviada").

### Archivos modificados
- `src/components/sections/ProductosSection.jsx`
- `src/components/sections/CompraRapidaSection.jsx`
- `src/components/compras/NuevaDevolucionProveedorModal.jsx`

Commit: `e9120e5` en `origin/master`.

---

## Sesión 48 — Cierre del crítico de seguridad (mismo día que la auditoría)

El usuario decidió no esperar a la semana y atacar el hallazgo 🔴 crítico de la sesión 47 de inmediato. Resultado:

**Migration 063** — `REVOKE EXECUTE ... FROM PUBLIC, anon` en 28 funciones (las de la lista original del plan) + `ALTER FUNCTION ... SET search_path TO 'public'` en las 9 que no lo tenían (incluida `fn_calcular_costo_valoracion`).

**Migration 064 (auto-corrección):** al re-correr `get_advisors` después de 063 para confirmar la reducción, aparecieron **3 funciones que se habían escapado de la primera extracción** — `crear_devolucion`, `crear_nota_debito`, `crear_venta` — seguían ejecutables por `anon`. La lista original se armó con un grep sobre un resumen parcial, no sobre el advisor completo; quedó incompleta. Corregido: revocadas también. Confirmado con `has_function_privilege('anon', oid, 'EXECUTE')` sobre las 32 que la única que queda con acceso `anon` es `email_exists_in_system` (la excepción a propósito, pre-signup).

**Migration 065 (hallazgo más grave de lo documentado):** al revisar el `TO` real de la policy `movimientos_uala."service role puede insertar"` (que el plan solo pedía "confirmar"), se encontró que **no** estaba scoped a `service_role` — estaba en `PUBLIC` a pesar del nombre — y la tabla tenía además `GRANT INSERT` a nivel tabla para `anon` y `authenticated`. Significaba que cualquiera, **incluso sin login**, podía insertar filas arbitrarias en una tabla de conciliación bancaria. Confirmado por grep que el frontend (`MovimientosUala.jsx`) solo hace `SELECT`. Revocado `INSERT` de `anon`/`authenticated` a nivel tabla y recreada la policy explícitamente `TO service_role`. Verificado con `pg_policy` que `roles = {service_role}` después del fix.

**Regresión real, no asumida:** corrida de `ajustar_stock_manual.test.sql` completo (11/11 verde) y de `crear_recepcion`/`crear_venta` (versión reducida, 2 asserts cada uno) después de aplicar los `REVOKE` — confirma que `authenticated` sigue funcionando exactamente igual, y que el trigger `fn_oc_update_stock` sigue disparando bien a pesar de tener `EXECUTE` revocado (los triggers no necesitan el grant, los ejecuta el motor de Postgres directamente). También se confirmó empíricamente que `anon` ahora recibe `permission denied for function ...` real (capa de permisos) en vez de fallar por lógica interna (`get_my_empresa_id()` devolviendo `NULL`).

**Pendiente de la sección 1 del plan: solo queda 1.2** (activar "Leaked Password Protection" en el Dashboard de Supabase — Authentication → Policies — no se puede hacer por SQL/migration).

`PLAN_SEMANA.md` actualizado marcando 1.1, 1.3 y 1.4 como resueltas con el detalle real de lo aplicado (incluido el hallazgo más grave que lo documentado en 1.3).

Archivos: `supabase/migrations/063_revocar_anon_y_search_path.sql`, `064_revocar_anon_funciones_faltantes.sql`, `065_fix_rls_movimientos_uala.sql` (los 3 nuevos). Ningún archivo de código frontend tocado — todo el fix fue a nivel de permisos/policies en Postgres.

---

## Sesión 47 — Auditoría de arquitectura + Advisors + plan de la semana

Cierre de la Fase 1 de stock_actual (sesión 46) y pedido explícito de revisar el sistema "de arriba a abajo" antes de una semana de estabilización. Se corrió `get_advisors` (security + performance) sobre el proyecto, se aplicó el checklist de deuda técnica del skill `saas-architect`, y se armó **[PLAN_SEMANA.md](PLAN_SEMANA.md)** — documento de acción para el colaborador, con todo priorizado (crítico/importante/performance/testing/manual).

**Hallazgos nuevos de seguridad (no resueltos en esta sesión, quedan en el plan):**
1. **27 funciones `SECURITY DEFINER` ejecutables por el rol `anon`** (sin autenticar) vía REST — incluye RPCs financieras/de stock que claramente no deberían ser invocables sin sesión (`ajustar_stock_manual`, `aplicar_compra_producto`, `crear_entrega`, `crear_recepcion`, `decrement_stock`, `increment_stock`, `insertar_movimiento_bancario_externo`, etc.). Protegidas hoy "por casualidad" porque internamente chequean `get_my_empresa_id()`, no por diseño de permisos. Lista completa y plan de `REVOKE` en `PLAN_SEMANA.md` sección 1.1.
2. "Leaked Password Protection" desactivado en Supabase Auth (config, no código).
3. Policy RLS de `movimientos_uala` (INSERT) con `WITH CHECK` siempre `true` — confirmar que está scoped a `service_role`.
4. 9 funciones sin `SET search_path`, incluida `fn_calcular_costo_valoracion` (el cálculo central de PPP).
5. `ventas_backup`/`detalle_ventas_backup`: tablas backup con RLS habilitado sin policy y sin PK — confirmar si siguen siendo necesarias.

**Hallazgos de performance (no bloqueantes, backlog):** 5 policies RLS re-evalúan `auth.uid()` por fila en vez de una vez por query (`profiles` x4, `movimientos_uala` x1) — fix rápido envolviendo en `(select auth.uid())`; 2 índices duplicados (`proveedores`, `tipos_cambio`); 90 warnings de políticas RLS permisivas múltiples y 75 FKs sin índice — backlog real, no urgente.

**Edge functions auditadas (`invite-user`, `create-user`, `delete-user`, `generar-csr`, `emitir-cae`):** confirmado que las 5 usan `verifyAdmin()` (helper compartido en `_shared/auth.ts`) para validar JWT + rol admin manualmente, a pesar de tener `verify_jwt:false` a nivel plataforma — patrón correcto e intencional, NO es un hallazgo. `mp-webhook` ya estaba auditado (sesión 33, valida firma de MercadoPago).

**Confirmado sin billing/suscripciones implementado** (no hay tabla `suscripciones`/`planes` en el schema) — anti-patrón "Billing no implementado" del checklist del arquitecto. Es una decisión de negocio de Kairox IA, no parte del alcance de "sistema funcional esta semana", se deja anotado para discutir aparte.

No se tocó código ni se aplicó ningún `REVOKE`/fix en esta sesión — es auditoría pura, todo queda priorizado en `PLAN_SEMANA.md` para que el colaborador lo ejecute.

---

## Sesión 46 — Frente 6: guards multi-tenant en `crear_venta` / `crear_entrega` / `crear_devolucion` — cierre de Fase 1

Completa la Fase 1 de tests automatizados. Mismo patrón de las sesiones 40-45 en los 3 archivos: pgTAP, `BEGIN...ROLLBACK`, tenants sintéticos, 0 datos reales tocados (verificado con `count(*)` = 0 en los 3 casos).

**`supabase/tests/crear_venta.test.sql` — 5/5 en verde:**
```
ok 1 - Caso 1: crear_venta(3) sobre stock=10 deja stock_actual=7
ok 2 - Caso 2a: crear_venta bloquea si no hay stock suficiente
ok 3 - Caso 2b: stock_actual de N2 no cambio tras el intento bloqueado
ok 4 - Caso 3: crear_venta bloquea si p_empresa_id no coincide con el usuario autenticado
ok 5 - Caso 4: crear_venta genera exactamente 1 movimiento de inventario tipo salida cantidad 3
```
Alcance acotado a propósito a lo que documentó el Mapa de sesión 36 (lock + guard de stock + guard de tenant + trazabilidad) — no se testearon los efectos colaterales de caja/cuenta corriente/entrega implícita (se pasa `p_pagos` vacío y `p_es_cc=false` para no necesitar esos fixtures, fuera de la auditoría de `stock_actual`).

**`supabase/tests/crear_entrega.test.sql` — 5/5 en verde:**
```
ok 1 - Caso 1: crear_entrega(3) sobre stock=10 deja stock_actual=7
ok 2 - Caso 2a: crear_entrega bloquea si no hay stock suficiente
ok 3 - Caso 2b: stock_actual de P2 no cambio tras el intento bloqueado
ok 4 - Caso 3: crear_entrega bloquea si p_empresa_id no coincide con el usuario autenticado
ok 5 - Caso 4: crear_entrega genera exactamente 1 movimiento de inventario tipo salida cantidad 3
```
Mismo patrón que `crear_venta` (SELECT...FOR UPDATE + guard + UPDATE relativo). Único caller real confirmado por grep: `GenerarEntregaModal.jsx`.

**`supabase/tests/crear_devolucion.test.sql` — 8/8 en verde:**
```
ok 1 - Caso 1: devolucion de cliente con reingreso deja stock_actual=13 (10+3)
ok 2 - Caso 2: devolucion a proveedor normal deja stock_actual=6 (10-4)
ok 3 - Caso 3a (REGRESION sesion 39): crear_devolucion bloquea devolucion a proveedor negativa
ok 4 - Caso 3b: stock_actual de R3 no cambio tras el intento bloqueado
ok 5 - Caso 4: crear_devolucion bloquea cross-tenant
ok 6 - Caso 5: con reingresa_stock=false, stock_actual NO cambia
ok 7 - Caso 6a: devolucion de cliente genera exactamente 1 movimiento tipo ingreso cantidad 3
ok 8 - Caso 6b: devolucion a proveedor genera exactamente 1 movimiento tipo salida cantidad 4
```
El Caso 3 es la versión automatizada de lo que se arregló a mano en la sesión 39 (migration 060): la rama "devolución a proveedor" ya no puede dejar `stock_actual` negativo — confirmado que el fix sigue intacto. Caso 5 confirma que `reingresa_stock=false` omite la rama de stock por completo (sin tocar nada). Se usó `p_compensacion='pendiente'` (default) en todos los casos para no necesitar fixtures de nota de crédito/caja — fuera de alcance.

**Cierre de Fase 1:** con estos 3 archivos, las 8 funciones SQL del Mapa de escritores de `stock_actual` (sesión 36) tienen test pgTAP propio: `obtener_proximo_numero`, `decrement_stock`, `increment_stock`, `ajustar_stock_manual`, `crear_recepcion` (test de regresión del bug de sesión 32), `aplicar_compra_producto`, `crear_venta`, `crear_entrega`, `crear_devolucion` — 9 archivos en total (incluyendo el de numeración, que motivó toda la Fase 1). Todos corridos de verdad contra el proyecto remoto, todos en verde salvo los hallazgos ya documentados y resueltos en sesiones anteriores (trazabilidad de `decrement_stock`/`increment_stock`, sesión 42) o documentados como pendientes de decisión (estado de OC no se actualiza, sin guard de sobre-recepción — sesión 44).

Archivos: `supabase/tests/crear_venta.test.sql`, `supabase/tests/crear_entrega.test.sql`, `supabase/tests/crear_devolucion.test.sql` (los 3 nuevos). Ningún archivo de código tocado.

---

## Sesión 45 — Test pgTAP: `aplicar_compra_producto` (frente 5 de Fase 1)

Mismo patrón de las sesiones 40-44: pgTAP, `BEGIN...ROLLBACK`, tenants sintéticos (Tenant L/M) creados y destruidos dentro de la transacción.

**`supabase/tests/aplicar_compra_producto.test.sql` — 9/9 en verde:**
```
ok 1 - Caso 1a: aplicar_compra_producto(5) sobre stock=10 deja stock_actual=15
ok 2 - Caso 1b: con metodo ultimo_costo, costo_compra pasa a 80
ok 3 - Caso 2a: aplicar_compra_producto(10) sobre stock=20 deja stock_actual=30
ok 4 - Caso 2b: costo PPP = (20*100+10*200)/30 = 133.33
ok 5 - Caso 3: aplicar_compra_producto bloquea cross-tenant
ok 6 - Caso 4a: segunda compra encadenada deja stock_actual=35 (30+5)
ok 7 - Caso 4b: el segundo costo PPP parte del costo YA actualizado por la primera llamada
ok 8 - Caso 5a: el RETURN de aplicar_compra_producto es 999 (ultimo_costo)
ok 9 - Caso 5b: el costo_compra guardado coincide con el valor devuelto por RETURN
```

Cubre: cálculo de costo con `ultimo_costo` (passthrough, sin promediar) y `promedio_ponderado` (PPP correcto), guard de tenant, y el Caso 4 versiona específicamente lo que se verificó a mano en la sesión 39 — el `FOR UPDATE` agregado en migration 060 no rompe la secuencia normal de llamadas encadenadas (el segundo cálculo de PPP parte del costo ya actualizado por la primera, no de un valor obsoleto). Caso 5 confirma que el valor `RETURN` de la función coincide exactamente con lo que queda persistido en `costo_compra`.

Sin hallazgos nuevos. Error propio corregido antes del resultado final: el primer intento comparó `costo_compra` (columna `numeric`) contra un literal entero sin cast (`is(costo_compra, 80, ...)`) — pgTAP's `is()` exige tipos coincidentes, Postgres no la resuelve sola con polimorfismo; corregido a `80::numeric`.

Archivo: `supabase/tests/aplicar_compra_producto.test.sql` (nuevo). Ningún archivo de código tocado.

---

## Sesión 44 — Test pgTAP de regresión: `crear_recepcion` (el bug de mayor severidad de la auditoría)

Este test existe específicamente para blindar contra una regresión del bug de la sesión 32: 2 caminos UI redundantes para recepcionar una OC causaban doble incremento de `stock_actual` (87% de las recepciones reales pasaban por el camino no auditado). El fix (migration 053) hizo que `crear_recepcion` NO actualice `stock_actual` directamente cuando el ítem está vinculado a un `ordenes_compra_items` (el caso real siempre, vía `GenerarRecepcionModal.jsx`) — delega 100% en el trigger `trg_oc_stock`/`fn_oc_update_stock`.

**Confirmado antes de escribir el test (grep fresco, no se asumió nada):**
- `GenerarRecepcionModal.jsx` es el **único** caller real de `crear_recepcion`. `OrdenesCompraSection.jsx` solo renderiza ese modal, no llama la RPC directo.
- `CompraRapidaSection.jsx` llama una función **distinta**, `crear_recepcion_implicita` (coincidencia de nombre por substring en el grep, no es el mismo camino) — releída su definición completa: NO toca `stock_actual` en absoluto, solo crea el registro de `recepciones`/`recepcion_items` para trazabilidad de "Compra Rápida" (el stock de ese flujo ya se ajusta por separado vía `aplicar_compra_producto`).
- **Conclusión: un solo camino vivo confirmado. No hay hallazgo crítico de caminos duplicados que reportar** — el fix de sesión 32 se mantiene.

**`supabase/tests/crear_recepcion.test.sql` — 16/16 en verde, primera corrida limpia (sin errores propios del test esta vez):**
```
ok 1 - Caso 1 (REGRESION sesion 32): recibir 10 de una OC de 10 deja stock_actual=10, NO 20
ok 2 - Caso 1: ordenes_compra_items.cantidad_recibida=10 tras recibir 10
ok 3 - Caso 2: recepcion parcial de 6 (de 10 pedidos) deja stock_actual=6
ok 4 - Caso 2: cantidad_recibida=6 tras la recepcion parcial
ok 5 - Caso 2 (HALLAZGO): estado de la OC NO se actualiza automaticamente
ok 6 - Caso 3: completar la recepcion parcial (4 mas) deja stock_actual=10 acumulado, no mas
ok 7 - Caso 3: cantidad_recibida=10 (6+4) tras completar la recepcion
ok 8 - Caso 3 (HALLAZGO): estado sigue sin actualizarse con el 100% recibido
ok 9 - Caso 4 (HALLAZGO): recibir 8 de una OC de 5 NO falla, cantidad_recibida=8
ok 10 - Caso 4: el stock tambien sube los 8 completos, sin tope
ok 11 - Caso 5a: exactamente 1 fila en recepciones para la OC del Caso 1
ok 12 - Caso 5b: exactamente 1 fila en recepcion_items
ok 13 - Caso 5c: exactamente 1 movimiento de inventario tipo ingreso cantidad 10
ok 14 - Caso 6: crear_recepcion bloquea recepcion cross-tenant
ok 15 - Caso 7a: stock_actual sube de 20 a 30, una sola vez
ok 16 - Caso 7b: costo PPP recalculado correctamente una sola vez
```

**El Caso 1 es la prueba directa del bug histórico: ninguna señal de duplicación en ningún caso.** Sin esto, el test no valdría nada — y dio el resultado esperado: stock exactamente 10 (no 20), exactamente 1 fila en `recepciones`/`recepcion_items`/`movimientos_inventario` por evento (Caso 5), y el costo PPP recalculado una sola vez incluso en el camino vinculado a OC (Caso 7, cruza con `fn_oc_update_stock`).

**2 hallazgos nuevos, NO relacionados con duplicación de stock (confirmados por lectura de código antes de asumir, no por sorpresa en el test):**
1. **`ordenes_compra.estado` nunca se actualiza automáticamente** a `'recibida_parcial'` ni `'recibida'` tras una recepción — ni `crear_recepcion` ni ningún trigger lo hacen (confirmado: solo existen `trg_audit_ordenes_compra` y `trg_oc_updated_at` sobre esa tabla, ninguno toca `estado`). La UI (`OrdenesCompraSection.jsx`) tiene toda la lógica de visualización para esos 2 estados (badges, filtros, colores) pero nada los dispara — la OC queda visualmente en `'enviada'` para siempre, sin importar cuánto se reciba. Impacto: el usuario no tiene forma de ver en la lista de OCs cuáles están parcial/completamente recibidas.
2. **`crear_recepcion` no valida que la cantidad recibida no supere lo pedido** — el único límite es client-side (atributo `max` del `Input` en `GenerarRecepcionModal.jsx`). Llamar la RPC directo (o un bug futuro en el cálculo del frontend) puede dejar `cantidad_recibida` y `stock_actual` por encima de `cantidad_pedida` sin ningún error.

Ninguno de los 2 se arregló en esta sesión — son hallazgos para priorizar, no bugs de duplicación (que es lo único que ameritaba parar la tarea según la consigna).

Archivo: `supabase/tests/crear_recepcion.test.sql` (nuevo). Ningún archivo de código tocado.

---

## Sesión 43 — Test pgTAP: `ajustar_stock_manual` (Fase 1 continuada)

Mismo patrón de las sesiones 40-42: pgTAP, `BEGIN...ROLLBACK`, tenants sintéticos (Tenant H/I) creados y destruidos dentro de la transacción. Cero datos reales tocados (verificado con `count(*)` = 0 después de correr).

**`supabase/tests/ajustar_stock_manual.test.sql` — 11/11 en verde:**
```
ok 1 - Caso 1: ajustar_stock_manual entrada(5) sobre stock=10 deja stock_actual=15
ok 2 - Caso 2: ajustar_stock_manual salida(3) sobre stock=10 deja stock_actual=7
ok 3 - Caso 3a: ajustar_stock_manual bloquea salida que dejaria stock negativo
ok 4 - Caso 3b: stock_actual de H3 no cambio tras el intento bloqueado (sigue en 2)
ok 5 - Caso 4: ajustar_stock_manual ajuste(2) sobre stock=10 deja stock_actual=2 (valor absoluto, no delta)
ok 6 - Caso 5a: ajustar_stock_manual bloquea cantidad negativa
ok 7 - Caso 5b: stock_actual de H4 no cambio tras el intento bloqueado (sigue en 2)
ok 8 - Caso 6: ajustar_stock_manual bloquea cross-tenant
ok 9 - Caso 7a: ajustar_stock_manual genera un movimiento de inventario tipo entrada cantidad 5
ok 10 - Caso 7b: el motivo pasado como parametro queda guardado en el movimiento
ok 11 - Caso 8: ajustar_stock_manual bloquea tipo invalido con mensaje claro
```

Sin hallazgos nuevos — `ajustar_stock_manual` ya nació completa en la sesión 38 (lock, guard de negativo, guard de tenant, motivo, trazabilidad), a diferencia de `decrement_stock`/`increment_stock` que necesitaron el fix de la sesión 42. Único detalle no obvio confirmado: el guard de `p_cantidad < 0` corre **antes** de tocar el producto (no depende del `tipo`), así que el mensaje para `ajuste` con cantidad negativa es `'Cantidad inválida: %'`, no `'Stock insuficiente...'` — el Caso 5 quedó escrito contra ese mensaje real.

Nota lateral (no es un hallazgo, es un error propio al escribir los fixtures): los primeros IDs de producto usaban el sufijo `p1`...`p5`, pero `'p'` no es un dígito hexadecimal válido para UUID — Postgres rechazó el INSERT (`invalid input syntax for type uuid`). Corregido a `aa01`...`aa05` antes de la corrida que dio el resultado de arriba.

Archivo: `supabase/tests/ajustar_stock_manual.test.sql` (nuevo). Ningún archivo de código tocado.

---

## Sesión 42 — Fix: trazabilidad faltante en `decrement_stock` / `increment_stock`

Cierra el hallazgo de la sesión 41. **Migration 062** agrega un parámetro `p_motivo text DEFAULT NULL` a ambas funciones + un `INSERT INTO movimientos_inventario` dentro de la misma transacción que el `UPDATE` de `stock_actual`:
- `decrement_stock` → siempre `tipo='salida'` (solo decrementa).
- `increment_stock` → el tipo se decide por el **signo real** de `quantity`, no fijo en `'entrada'`: `quantity >= 0` → `'entrada'`, `quantity < 0` → `'salida'` (la cantidad se guarda en valor absoluto). Decisión deliberada distinta a la sugerencia original de "siempre `'entrada'`": revertir una compra (cantidad negativa) físicamente RETIRA stock, y el historial debe reflejar lo que pasó de verdad, no el nombre de la función que lo causó.
- Si no se pasa `p_motivo`, cae a un texto genérico identificable (`'Ajuste de stock (decrement_stock)'` / `'(increment_stock)'`).

**Callers confirmados antes de tocar la firma** (grep fresco, frontend + `pg_proc.prosrc`): `decrement_stock` sin ningún caller (dead code, agregar el parámetro es 100% compatible); `increment_stock` con exactamente 2 callers, ambos en `CompraRapidaSection.jsx` (`handleSaveEdit`) — ambos actualizados para pasar un motivo real (`Reversión por eliminación de ítem en edición de compra <numero_factura>` / `Ajuste de cantidad por edición de compra <numero_factura>`) en vez de depender del fallback genérico.

**Detalle no obvio:** `CREATE OR REPLACE FUNCTION` con un parámetro nuevo no reemplaza la función vieja — crea un *overload* adicional, porque la firma (cantidad de argumentos) cambió. Quedaron 2 versiones de cada función y las llamadas con 2 argumentos se volvieron ambiguas (`function is not unique`). Hubo que `DROP FUNCTION` explícito de las firmas viejas (`decrement_stock(uuid, integer)` / `increment_stock(uuid, numeric)`) antes de que las nuevas quedaran como única versión.

**Verificado con `BEGIN...ROLLBACK`** sobre un tenant sintético: `decrement_stock(3, 'motivo')` → movimiento `salida/3/motivo` correcto; `increment_stock(5, 'motivo')` → `entrada/5/motivo`; `increment_stock(-4, 'motivo')` → `salida/4/motivo` (confirma la lógica por signo); `decrement_stock` sin motivo → cae al fallback genérico. Stock final tras la secuencia de prueba (10−3+5−4−1=7) coincidió exactamente.

**Tests actualizados y corridos de verdad — ambos en verde:**
```
supabase/tests/decrement_stock.test.sql — 6/6
ok 1 - Caso 1: decrement_stock(3) sobre stock=10 deja stock_actual=7
ok 2 - Caso 2a: decrement_stock bloquea si el resultado seria negativo
ok 3 - Caso 2b: stock_actual de D2 no cambio tras el intento bloqueado (sigue en 2)
ok 4 - Caso 3: decrement_stock bloquea cross-tenant
ok 5 - Caso 4a: decrement_stock genera un movimiento de inventario tipo salida cantidad 3
ok 6 - Caso 4b: el motivo pasado como parametro queda guardado en el movimiento

supabase/tests/increment_stock.test.sql — 8/8
ok 1 - Caso 1: increment_stock(5) sobre stock=10 deja stock_actual=15
ok 2 - Caso 2: increment_stock(-3) sobre stock=10 deja stock_actual=7
ok 3 - Caso 2b: increment_stock bloquea cantidad negativa excesiva
ok 4 - Caso 2b: stock_actual de F2 no cambio (sigue en 7)
ok 5 - Caso 3: increment_stock bloquea cross-tenant
ok 6 - Caso 4a: increment_stock(+5) genera un movimiento tipo entrada cantidad 5
ok 7 - Caso 4b: el motivo pasado como parametro queda guardado en el movimiento
ok 8 - Caso 4c: increment_stock(-3) genera un movimiento tipo salida cantidad 3
```

Build de producción sin errores. Archivos: `supabase/migrations/062_trazabilidad_decrement_increment_stock.sql` (nuevo), `src/components/sections/CompraRapidaSection.jsx` (2 call-sites de `increment_stock` con motivo real), `supabase/tests/decrement_stock.test.sql` y `supabase/tests/increment_stock.test.sql` (actualizados).

---

## Sesión 41 — Tests pgTAP: `decrement_stock` e `increment_stock` (Fase 1 continuada)

Mismo patrón validado en la sesión 40 (`obtener_proximo_numero.test.sql`): pgTAP, `BEGIN...ROLLBACK`, tenants sintéticos creados y destruidos dentro de la transacción (Tenant D/E para `decrement_stock`, Tenant F/G para `increment_stock`). Ningún dato real tocado — verificado con `count(*)` de `empresas` con nombre `__PGTAP_TEST__%` = 0 después de correr ambos.

**`supabase/tests/decrement_stock.test.sql` — 4/5 en verde:**
```
ok 1 - Caso 1: decrement_stock(3) sobre stock=10 deja stock_actual=7
ok 2 - Caso 2a: decrement_stock bloquea si el resultado seria negativo
ok 3 - Caso 2b: stock_actual de D2 no cambio tras el intento bloqueado (sigue en 2)
ok 4 - Caso 3: decrement_stock bloquea cross-tenant
not ok 5 - Caso 4: decrement_stock genera un movimiento de inventario tipo salida cantidad 3
        have: 0
        want: 1
```

**`supabase/tests/increment_stock.test.sql` — 5/6 en verde:**
```
ok 1 - Caso 1: increment_stock(5) sobre stock=10 deja stock_actual=15
ok 2 - Caso 2: increment_stock(-3) sobre stock=10 deja stock_actual=7 (revertir funciona)
ok 3 - Caso 2b: increment_stock bloquea cantidad negativa excesiva
ok 4 - Caso 2b: stock_actual de F2 no cambio (sigue en 7)
ok 5 - Caso 3: increment_stock bloquea cross-tenant
not ok 6 - Caso 4: increment_stock genera un movimiento de inventario tipo entrada cantidad 5
        have: 0
        want: 1
```

**Hallazgo real (NO arreglado en esta sesión — reportado para que Luciano priorice):** ni `decrement_stock` ni `increment_stock` insertan en `movimientos_inventario`. Esto es consistente con lo que ya leía el código (releído fresco antes de escribir los tests: ninguna de las 2 funciones tiene un `INSERT INTO movimientos_inventario`), a diferencia de `crear_venta`, `crear_entrega`, `crear_devolucion` y `ajustar_stock_manual`, que sí lo hacen dentro de la misma transacción. Impacto: si algo usa estas 2 RPC (hoy `increment_stock` sí tiene caller real en `CompraRapidaSection.jsx`), el movimiento de stock no queda trazado en el historial de `movimientos_inventario` — solo se ve el `stock_actual` final, sin el registro intermedio. No es un bug de concurrencia ni de seguridad (el guard de negativo y el aislamiento de tenant funcionan correctamente en ambas, confirmado por los otros 4-5 casos en verde), es una laguna de trazabilidad/auditoría.

> ✅ **RESUELTO en sesión 42** (migration 062) — ver sección arriba.

Todo lo demás verificado en verde: guard de stock negativo (con el resultado sin modificar tras el bloqueo, confirmando que el `RAISE` revierte el `UPDATE` parcial), guard de aislamiento multi-tenant (mensaje exacto `'Producto no encontrado o sin permiso: %'` en ambas), y la semántica de `increment_stock` con cantidad negativa (revertir funciona si el resultado no queda negativo, se bloquea si sí).

Archivos: `supabase/tests/decrement_stock.test.sql` (nuevo), `supabase/tests/increment_stock.test.sql` (nuevo). Ningún archivo de código tocado — esta sesión fue 100% tests + el hallazgo quedó documentado, no resuelto.

---

## Sesión 40 — Infraestructura de tests pgTAP + primer test real: `obtener_proximo_numero`

Primer test de base de datos del proyecto. Se eligió `obtener_proximo_numero` porque es el riesgo de mayor severidad de toda la auditoría de estabilización (sesión 30: la numeración de comprobantes usaba `COUNT(*)` sin lock, causaba números repetidos bajo concurrencia; el fix con `series_numeracion` + `SELECT...FOR UPDATE` nunca tuvo un test automatizado).

**Setup:**
- Extensión `pgtap` (1.3.3) habilitada — migration `061_enable_pgtap.sql`.
- `supabase/tests/obtener_proximo_numero.test.sql` — test canónico, formato pgTAP estándar (`plan()`/`is()`/`skip()`/`finish()`), pensado para correr con `supabase test db` cuando haya Docker disponible.
- `supabase/tests/README.md` — cómo correr los tests, y la regla de oro: **nunca contra una empresa real** (se nombra explícitamente `db21dfad-...` y `cbc4db74-...` como prohibidas). Cada test crea y destruye sus propios tenants sintéticos.

**Limitación real de este entorno (documentada, no oculta):** no hay Docker ni `psql` instalados acá, así que `supabase test db` no se pudo ejecutar literalmente. Como pgTAP es solo SQL, el mismo archivo se corrió pegando su contenido vía el MCP de Supabase contra el proyecto remoto, siempre dentro de `BEGIN...ROLLBACK` (los tenants sintéticos —`__PGTAP_TEST__ Tenant A/B`— nunca se persistieron; verificado con un `SELECT count(*)` después de cada corrida, siempre 0).

**Resultado real de los Casos 1, 3 y 4 (corridos de verdad, vía pgTAP, dentro de `ROLLBACK`):**
```
1..10
ok 1 - Caso 1a: primer numero de venta para Tenant A es 001
ok 2 - Caso 1b: segundo numero es 002 (consecutivo, no repite ni salta)
ok 3 # SKIP Concurrencia real requiere 2+ conexiones simultaneas - verificado por separado
ok 4 - Caso 3a: Tenant A primer pedido es 001
ok 5 - Caso 3b: Tenant B primer pedido TAMBIEN es 001
ok 6 - Caso 3c: Tenant A segundo pedido es 002
ok 7 - Caso 3d: Tenant B segundo pedido es 002
ok 8 - Caso 4a: cambio de periodo reinicia el numero a 001
ok 9 - Caso 4b: periodo_actual se actualiza al periodo nuevo
ok 10 - Caso 4c: proximo_numero avanza a 2 tras consumir el 1 del periodo nuevo
```
**9/9 en verde** (el test #3 es un `skip()` intencional, no una falla). Nota honesta: la primera corrida tuvo 4 "not ok" — error propio del test (me faltó el prefijo `'PED-'` en el string esperado del Caso 3), no un bug de la función; corregido y vuelto a correr con el resultado de arriba.

**Caso 2 — concurrencia real, verificada por separado (pgTAP no puede, corre en una sola conexión):** se pidió autorización explícita (acción bloqueada por el clasificador de modo automático por ser una escritura persistente fuera de `ROLLBACK`) antes de crear un tenant sintético persistente (`__PGTAP_CONCURRENCY_TEST__ Tenant C`). Se dispararon **5 llamadas reales en paralelo** (5 tool calls concurrentes, 5 conexiones separadas) a `obtener_proximo_numero` para el mismo tenant + `tipo_documento='venta'`, arrancando desde `proximo_numero=1`. Resultado real:

| Llamada | Resultado |
|---|---|
| 1 | `20260621-001` |
| 2 | `20260621-002` |
| 3 | `20260621-003` |
| 4 | `20260621-004` |
| 5 | `20260621-005` |

5 números únicos, consecutivos, sin huecos ni repetidos. `proximo_numero` quedó en 6 tras las 5 llamadas (1+5). Esto confirma que el `SELECT...FOR UPDATE` serializa correctamente las llamadas concurrentes — exactamente lo que se esperaba dado que es el mismo patrón de lock ya verificado en sesiones anteriores (`crear_venta`, `ajustar_stock_manual`, etc.). El tenant `Tenant C` se borró inmediatamente después (4 `DELETE` + verificación de 0 filas restantes).

**Archivos:** `supabase/migrations/061_enable_pgtap.sql` (nuevo), `supabase/tests/obtener_proximo_numero.test.sql` (nuevo), `supabase/tests/README.md` (nuevo).

---

## Sesión 39 — Cierre de los 4 riesgos latentes de `stock_actual` (migration 060)

Cierra los 4 riesgos que quedaron documentados como "no urgentes pero sin cerrar" en el Mapa de escritores de `stock_actual` (sesión 36). Con esto queda completa la auditoría de estabilización de sesión 32.

**Riesgo 1 — `crear_devolucion` (rama proveedor) podía dejar `stock_actual` negativo.** Confirmado: no existe un caso de negocio legítimo para permitir negativo ahí (a diferencia de una venta, no hay "devolución anticipada" razonable — solo se devuelve a un proveedor lo que físicamente se tiene). Se aplicó el mismo criterio que `crear_venta`/`crear_entrega`: `SELECT stock_actual ... FOR UPDATE` + `RAISE EXCEPTION` si el resultado sería negativo, antes de decrementar. La rama `cliente` (ingreso) no se tocó — un incremento relativo nunca genera negativo, no necesita lock.

**Riesgo 2 — `increment_stock` no validaba negativo.** ⚠️ La propuesta original (bloquear si `quantity` es negativo) se descartó tras confirmar con grep que **hay 2 callers reales en `CompraRapidaSection.jsx` que pasan `quantity` negativo a propósito** (revertir stock al borrar un ítem de una compra editada, o al reducir la cantidad de un ítem existente — `handleSaveEdit`). Bloquear por signo habría roto ambos flujos. Fix aplicado: validar el **resultado** (`stock_actual + quantity >= 0`), no el signo del parámetro — mismo criterio que `decrement_stock`/`ajustar_stock_manual`. Se agregó además `SELECT...FOR UPDATE` (antes hacía `UPDATE` relativo directo sin necesidad de leer primero).

**Riesgos 3 y 4 — cálculo de costo PPP sin lock en `fn_oc_update_stock` y `aplicar_compra_producto`.** Confirmado que el riesgo era real, no defendido por ningún lock implícito: `fn_oc_update_stock` es un trigger sobre `ordenes_compra_items` — el `UPDATE` que lo dispara bloquea esa fila, **no** la fila de `productos` que el cálculo de PPP necesita leer. Se agregó `FOR UPDATE` explícito al `SELECT stock_actual, costo_compra FROM productos` en ambas funciones. Esto serializa lecturas concurrentes del mismo producto (igual patrón que resolvería el problema de numeración sin lock de la sesión 30, pero aplicado al costo en vez de a un número de comprobante).

**Verificado con `BEGIN...ROLLBACK`** sobre datos reales:
- Devolución a proveedor con stock=0 → bloqueada (`Stock insuficiente para devolver al proveedor...`); con stock=5 devolviendo 3 → permitida, queda en 2.
- `increment_stock(-10)` sobre stock=2 → bloqueado (`Stock insuficiente...`); `increment_stock(-2)` sobre stock=2 (revertir todo) → permitido, queda en 0.
- Disparo real del trigger `fn_oc_update_stock` (forzando `metodo_valoracion_stock='promedio_ponderado'` solo dentro de la transacción de prueba) sobre un producto con stock=52/costo=1568: incrementar `cantidad_recibida` en 10 a costo_unitario=2000 → stock=62, costo PPP=1637.68 (cálculo correcto: `(52×1568+10×2000)/62`).
- Encadenado con `aplicar_compra_producto` sobre el mismo producto (+5 a costo=1700) → stock=67, costo PPP=1642.33 (cálculo correcto, confirma que el `FOR UPDATE` agregado no rompe la secuencia normal de llamadas).
- Tras cada `ROLLBACK`, todos los valores volvieron exactamente a su estado original.

**Nota de alcance:** la concurrencia real (dos transacciones simultáneas peleando por el lock) no se puede simular con este tooling porque cada llamada a `execute_sql` corre en su propia conexión secuencial — no hay forma de mantener una transacción abierta mientras se ejecuta otra en paralelo desde acá. Lo verificado es que el `FOR UPDATE` no rompe el cálculo normal (secuencial) y que la sintaxis/lógica es correcta; la garantía de serialización bajo concurrencia real es una propiedad estándar de Postgres (`SELECT...FOR UPDATE` bloquea a cualquier otra transacción que intente lo mismo sobre la misma fila hasta que la primera termine) y no requiere prueba empírica adicional.

Archivo: `supabase/migrations/060_cierre_riesgos_latentes_stock_actual.sql` (nuevo). Ningún archivo frontend tocado — los 4 riesgos eran 100% de la capa SQL. Build de producción sin errores (sin cambios de frontend, por lo tanto sin impacto esperado en el bundle).

---

## Sesión 38 — Unificar caminos de ajuste manual de stock en `ajustar_stock_manual`

Aplica la misma solución que la sesión 32 (unificación de caminos de recepción de OC) al riesgo latente #4 documentado en la sesión 36: existían 2 implementaciones redundantes para el mismo "ajuste manual de stock" — `productosService.adjustStock()` (sin caller, semántica de `ajuste` como delta) y el inline `handleSubmitMovimiento` de `ProductosSection.jsx` (el que la UI usaba de verdad: leía `stock_actual` del estado de React ya cargado, sin lock, sin validar negativo, semántica de `ajuste` como valor absoluto).

**Fix — migration 059** (`ajustar_stock_manual(p_producto_id, p_tipo, p_cantidad, p_motivo)`):
- `SELECT stock_actual ... FOR UPDATE` (lock real antes de decidir, no solo `UPDATE` relativo) + valida `empresa_id = get_my_empresa_id()`.
- `entrada` → delta `+cantidad`; `salida` → delta `-cantidad`; `ajuste` → valor absoluto (inventario físico) — se preservó la semántica que ya usaba la UI, no la de `adjustStock()`.
- Guard `v_nuevo_stock < 0 → RAISE EXCEPTION` para `salida` y `ajuste`, antes del `UPDATE`.
- Valida `p_tipo` contra la lista permitida y `p_cantidad >= 0`.
- Inserta en `movimientos_inventario` dentro de la misma función (misma transacción que el `UPDATE` de stock).

**Frontend:** `productosService.adjustStock()` ahora es un wrapper delgado de `supabase.rpc('ajustar_stock_manual', ...)` (se volvió el único punto de entrada, ya no dead code) y `ProductosSection.jsx → handleSubmitMovimiento` llama a `productosService.adjustStock()` en vez de hacer el `UPDATE`+`INSERT` inline. Ya no hay 2 implementaciones.

**Verificado con `BEGIN...ROLLBACK`** sobre un producto real con `stock_actual = 0`: `salida` de 5 → bloqueada (`Stock insuficiente`); `entrada` de 5 → stock pasa a 5; `ajuste` a 2 → stock pasa a 2 (confirma semántica absoluta); `cantidad` negativa → bloqueada; `tipo` inválido → bloqueado. Tras el `ROLLBACK`, `stock_actual` volvió a 0 (sin persistir nada). Build de producción sin errores.

Archivos tocados: `supabase/migrations/059_rpc_ajustar_stock_manual.sql` (nuevo), `src/services/productosService.ts`, `src/components/sections/ProductosSection.jsx`.

No se tocó `decrement_stock`, `increment_stock`, `aplicar_compra_producto` ni `fn_oc_update_stock` — fuera de alcance de esta tarea.

---

## Sesión 37 — Fix parseo es-AR en `ModoCajaLayout.jsx` (monto apertura/cierre de caja)

Cierra el pendiente reportado aparte en la sesión 35 (`task_14b11792`): `ModoCajaLayout.jsx` (modal de apertura/cierre de caja del modo cajero, `role='solo_caja'`/`modo_caja=true`) tenía su PROPIO parseo manual roto, distinto al de `CajaSection.jsx`/`CajaApertura.jsx`:

```js
const monto = parseFloat(montoApertura.replace(',', '.')) || 0;
```

`.replace(',', '.')` solo reemplaza la PRIMERA coma — con separador de miles real es-AR ("1.500,50") el resultado quedaba "1.500.50", y `parseFloat` se detenía en el segundo punto → devolvía `1.5`. Un cajero que abría con $1.500,50 registraba $1,50, sin ningún error visible. Mismo bug en el cierre (`montoCierre`).

**Fix:** alineado al patrón ya usado en `CajaApertura.jsx` (referencia exacta). Input cambiado de `type="number"` a `type="text" inputMode="decimal"` (sin parsear en cada keystroke, se guarda el string crudo) y `parseFloat(x.replace(',','.'))` reemplazado por `parseNumberLocale(x)` (import de `@/lib/currencyUtils`) en `handleAbrirCaja`/`handleCerrarCaja`. No se tocó `openSession`/`closeSession` en `CajaContext.jsx` (ya corregidas en la sesión 35 — el problema era exclusivamente el valor ya roto que `ModoCajaLayout.jsx` les pasaba antes de llegar ahí).

Archivo tocado: `src/components/caja/ModoCajaLayout.jsx`.

---

## Sesión 36 — Mapa de escritores de `stock_actual`

Tarea puramente de documentación (NO se tocó código) pedida porque esta columna ya causó 2 bugs reales (doble incremento en recepción de OC — sesión 31 — y fallo silencioso en `aplicar_compra_producto` — sesión 33). Releído con grep fresco sobre `pg_proc.prosrc` (SQL) y sobre `src/` (frontend) — la lista terminó siendo **10 escritores reales, no los 5 conocidos**: se sumaron `crear_venta`, `crear_devolucion`, `decrement_stock`, y dos escritores 100% frontend (`productosService.adjustStock` y el inline de `ProductosSection.jsx`) que no estaban en el radar de ninguna auditoría anterior.

### Tabla de escritores

| Función / trigger | Tipo | Dispara desde | Atómico¹ | Valida stock negativo | Notas |
|---|---|---|---|---|---|
| `crear_venta` | RPC (SQL) | `NuevaVentaModal.jsx` → venta POS | ✅ `SELECT...FOR UPDATE` + `UPDATE stock_actual = stock_actual - x` | ✅ `RAISE` si `stock < cantidad`, antes de decrementar | El más seguro del sistema — lock + validación + update relativo, todo en una transacción. |
| `crear_entrega` | RPC (SQL) | `GenerarEntregaModal.jsx` → Pedido→Entrega manual | ✅ `SELECT...FOR UPDATE` + `UPDATE` relativo | ✅ `RAISE` si insuficiente | Mismo patrón que `crear_venta`. |
| `crear_recepcion` | RPC (SQL) | `GenerarRecepcionModal.jsx` → recibir contra OC | ⚠️ `UPDATE` relativo sin lock previo, solo cuando NO hay `orden_compra_item_id` vinculado | N/A (incremento) | Cuando SÍ hay item de OC vinculado, no escribe directo — delega en el `UPDATE cantidad_recibida` que dispara `trg_oc_stock` (ver fila siguiente). Fix sesión 31 (migration 053) eliminó el doble incremento que tenía antes. |
| `fn_oc_update_stock` (trigger `trg_oc_stock`) | Trigger `AFTER UPDATE OF cantidad_recibida ON ordenes_compra_items` | `crear_recepcion` (cuando hay item de OC) o cualquier otro UPDATE futuro a esa columna | ✅ **(sesión 39, migration 060)** `SELECT stock_actual, costo_compra ... FOR UPDATE` antes de calcular PPP + `UPDATE` relativo | N/A (incremento) | El trigger sobre `ordenes_compra_items` NO bloqueaba la fila de `productos` que necesita el cálculo de PPP — se agregó `FOR UPDATE` explícito. `delta` puede ser negativo si algo bajara `cantidad_recibida` (ningún flujo de UI lo hace hoy, pero el trigger no lo impide — no es el riesgo que se cerró esta sesión). |
| `crear_devolucion` | RPC (SQL) | `NuevaDevolucionModal.jsx` (cliente) / `NuevaDevolucionProveedorModal.jsx` (proveedor) | ✅ **(sesión 39, migration 060)** `SELECT...FOR UPDATE` en la rama proveedor antes de decrementar | ✅ `RAISE` si la rama proveedor dejaría stock negativo | Solo corre si `p_reingresa_stock = true`. Rama `cliente` (ingreso) sin lock — no lo necesita, un incremento relativo no puede generar negativo. |
| `decrement_stock` | RPC pública (SQL) | **Ningún caller en `src/`** | ✅ `UPDATE` relativo + valida negativo DESPUÉS (si negativo, `RAISE` revierte toda la función) | ✅ | Dead code hoy — existía para un uso que ya no está cableado (el comentario de su migration menciona "Notas de Crédito", que hoy usa `crear_devolucion`). |
| `increment_stock` | RPC pública (SQL) | `CompraRapidaSection.jsx` → edición de una compra ya registrada (`handleSaveEdit`) | ✅ **(sesión 39, migration 060)** `SELECT...FOR UPDATE` + `UPDATE` relativo (sigue aceptando `quantity` negativo — uso legítimo de revertir) | ✅ `RAISE` si `stock_actual + quantity < 0` (valida el resultado, no el signo del parámetro — hay 2 callers reales que pasan negativo a propósito) | Ya no es asimétrico frente a `decrement_stock`. |
| `aplicar_compra_producto` | RPC pública (SQL) | `CompraRapidaSection.jsx` → "Nueva Compra" y edición de compra (ítems nuevos) | ✅ **(sesión 39, migration 060)** `SELECT stock_actual, costo_compra ... FOR UPDATE` antes de calcular PPP + `UPDATE` relativo | N/A (incremento) | Ya tuvo 1 bug confirmado (fallo silencioso por `console.error` en vez de `throw` — sesión 33, ya arreglado). El riesgo de cálculo PPP sin lock quedó cerrado esta sesión. |
| `ajustar_stock_manual` (RPC, ex `productosService.adjustStock()` + inline `ProductosSection.jsx`) | RPC (SQL) | `productosService.adjustStock()` ← `ProductosSection.jsx → handleSubmitMovimiento` (Modal "Movimiento de Stock") | ✅ `SELECT...FOR UPDATE` + decisión y `UPDATE` en la misma transacción | ✅ `RAISE` si `salida`/`ajuste` dejarían stock negativo, antes de escribir | **Unificado en sesión 38** (migration 059) — reemplaza las 2 implementaciones redundantes que documentó esta sesión (ver histórico abajo). Único punto de entrada ahora; ya no hay caminos duplicados para este flujo. |

¹ "Atómico" acá significa: el incremento/decremento de `stock_actual` en sí usa la forma relativa `SET stock_actual = stock_actual ± x` (que Postgres garantiza libre de *lost updates* por el lock de fila implícito de cualquier `UPDATE`) **y/o** la decisión de permitir la operación se toma bajo `SELECT...FOR UPDATE`. ⚠️ marca los casos donde el stock en sí está a salvo de *lost update* pero una validación o un cálculo dependiente (costo PPP, "hay suficiente stock") se basa en una lectura sin lock — riesgo de usar datos obsoletos bajo concurrencia, no de perder el incremento de stock en sí. ❌ marca lectura-cálculo-escritura completo sin ninguna protección.

**Excluidos de la tabla a propósito** (no son escritores en el sentido de "compiten por una fila existente" — son `INSERT` de productos nuevos, sin contención posible): `ProductosSection.jsx` "Nuevo Producto", `OnboardingWizard.jsx` (alta de producto demo), `CSVImportModal.jsx` (import masivo). Tampoco se incluyó `NuevaVentaModal.jsx` línea ~432 (`SELECT stock_actual` antes de confirmar la venta) — es solo una validación de UX previa a llamar `crear_venta`, no escribe nada; el RPC es la autoridad real.

### Riesgos latentes (no son bugs confirmados — patrones frágiles para tener en el radar)

1. ~~**`crear_devolucion` puede dejar `stock_actual` negativo** en la rama "devolución a proveedor"~~ — ✅ **RESUELTO en sesión 39**: `SELECT...FOR UPDATE` + `RAISE` si dejaría negativo (migration 060).
2. ~~**`increment_stock` no valida negativo**~~ — ✅ **RESUELTO en sesión 39**: valida el resultado (`stock_actual + quantity >= 0`), no el signo del parámetro — preserva los 2 usos legítimos de `quantity` negativo en `CompraRapidaSection.jsx` (migration 060).
3. ~~**Cálculo de costo PPP sin lock** en `fn_oc_update_stock` y en `aplicar_compra_producto`~~ — ✅ **RESUELTO en sesión 39**: `SELECT...FOR UPDATE` explícito antes de leer `stock_actual`/`costo_compra` para el cálculo de PPP en ambas funciones (migration 060).
4. ~~**Dos implementaciones redundantes de "ajuste manual de stock"**~~ — ✅ **RESUELTO en sesión 38**: unificadas en la RPC `ajustar_stock_manual` (migration 059), ver fila correspondiente en la tabla arriba.
5. **`decrement_stock` es dead code** — si algún día se le agrega un caller nuevo sin revisar, hereda automáticamente el patrón seguro (lock implícito + validación post-hoc), pero conviene confirmarlo en el momento en que se le agregue un uso real. Sigue siendo el único riesgo latente abierto — es de muy bajo riesgo (no tiene caller) y no forma parte de los 4 que pidió cerrar esta sesión.

**Con esto, la auditoría de estabilización de sesión 32 queda 100% cerrada** — los 8 hallazgos originales (3 CRÍTICOS, sesión 33; 3 MEDIO/BAJO, sesión 34; el patrón es-AR, sesión 35; y estos 4 riesgos de `stock_actual`, sesiones 38-39) están todos resueltos o documentados como dead code de bajo riesgo.

---

## Sesión 35 — Patrón es-AR en campos monetarios pendientes (ítem 4 de la auditoría, sesión 32)

Aplicado el patrón ya usado en `CotizacionesSection`/`CompraRapidaSection` (`type="text" inputMode="decimal"` + estado string crudo sin parsear en cada keystroke + `parseNumberLocale()` al usar el valor) a los 6 archivos reportados. Releído cada uno puntualmente antes de tocarlo — 2 de los 6 resultaron tener más alcance del que decía el informe (un campo no listado individualmente, o falsos positivos).

**1. `CajaSection.jsx` — Saldo Inicial:** real, corregido. El input pasó a `type="text" inputMode="decimal"`. La validación al abrir caja pasó de `parseFloat` a `parseNumberLocale`. El parseo real (`monto_inicial`) vive en `CajaContext.jsx` → `openSession()`, compartida por 3 componentes (`CajaSection.jsx`, `ModoCajaLayout.jsx`, `CajaApertura.jsx`) — se corrigió ahí (`parseFloat` → `parseNumberLocale`), beneficiando a los 3 callers sin duplicar lógica. `CajaApertura.jsx` ya pasaba un número limpio (parseado con `parseNumberLocale` propio); `ModoCajaLayout.jsx` tiene su PROPIO parseo roto (`parseFloat(monto.replace(',','.'))`, se rompe con separador de miles real) — fuera de alcance de esta tarea, reportado aparte (`task_14b11792`).

**2. `NuevaFacturaModal.jsx` — precio_unit:** real, corregido. Además del input, `calcNeto()` y el INSERT a `comprobante_items` usaban `Number(item.precio_unit)` en vez de `parseNumberLocale()` — con el input ya en formato es-AR, `Number("1.500,50")` da `NaN`. Corregidos los 2 puntos de uso, no solo el input.

**3. `NuevaNCModal.jsx` — precio_unit:** real, corregido. Mismo problema que NuevaFacturaModal en `calcNeto()`/INSERT, **más uno adicional**: `updateItem()` hacía `Number(value)` en CADA keystroke para `precio_unit` (anti-patrón explícito que la tarea pedía evitar) — separado en su propia rama para guardar el string crudo sin parsear.

**4. `NuevaFacturaProveedorModal.jsx` — costo_unitario:** real, corregido. Internamente el campo se llama `precio_unit` (mapea a la columna `costo_unitario` recién en el INSERT) — mismo patrón y mismos 2 puntos de uso (`calcNeto`, INSERT a `detalle_compras`) corregidos.

**5. `OrdenesCompraSection.jsx` — costo_unitario:** real, corregido (input, `total` del formulario, validación de ítem válido, payload de `createMutation`). **Se encontró un segundo campo monetario no listado individualmente**, tal como anticipaba la consigna: "Monto Total Facturado" del modal "Registrar Factura del Proveedor" (`facturaForm.monto_total`) — también `type="number"` con `parseFloat`. Corregido igual (input + `parseNumberLocale` en el submit), y sus 2 `.toFixed(2)` de visualización (`diff`, prefill de `monto_total`) pasados a `toLocaleString('es-AR', {minimumFractionDigits: 2})`. La lectura de `costo_unitario` en el cálculo de 3-way match (línea 636) NO se tocó: viene de `detalle.ordenes_compra_items`, dato ya numérico desde la DB, no un string tipeado por el usuario.

**6. `ProductosSection.jsx` — precio_venta y costo_compra:** **falso positivo, no se tocó nada.** Ambos campos ya estaban implementados correctamente (`type="text" inputMode="decimal"` + `parseNumberLocale()` en el submit + `toLocaleString('es-AR')` en la grilla) — el hallazgo de la auditoría ya no aplicaba. `stock_actual`/`stock_minimo` (cantidades enteras) y el campo "Cantidad" del modal de movimiento de stock están correctamente en `type="number"`, no son monetarios — no se tocaron.

Build de producción sin errores. Ningún cambio tocó lógica de negocio, cálculos de backend ni RPCs — solo formato de entrada/visualización en frontend.

Archivos tocados: `CajaSection.jsx`, `CajaContext.jsx`, `NuevaFacturaModal.jsx`, `NuevaNCModal.jsx`, `NuevaFacturaProveedorModal.jsx`, `OrdenesCompraSection.jsx`. `ProductosSection.jsx` sin cambios (falso positivo).

---

## Sesión 34 — Cierre de hallazgos MEDIO/BAJO de la auditoría (sesión 32)

### Tarea 1 — Triggers duplicados en `pedidos` (migration 056)
Confirmado vía `pg_trigger` (no por nombre de migration): existían 2 pares idénticos — `audit_pedidos`/`trg_audit_pedidos` (ambos → `fn_audit_trigger`) y `set_pedidos_updated_at`/`trg_pedidos_updated_at` (ambos → `fn_set_updated_at`). Se dropearon `audit_pedidos` y `set_pedidos_updated_at` (de `017_pedidos_condiciones.sql`, anteriores a la convención `trg_*`) y se conservaron los `trg_*` — confirmado que son la convención sin excepción del resto del sistema (`trg_audit_ordenes_compra`, `trg_oc_updated_at`, etc., migrations 001/016) y que los nombres sin prefijo no tenían ninguna referencia especial fuera de la migration que los creó.

**Verificación con datos reales (transacción con ROLLBACK):** INSERT + UPDATE de un pedido de prueba → `audit_log` recibió **exactamente 1 fila por operación** (antes del fix hubieran sido 2). Transacción revertida, sin datos huérfanos.

### Tarea 2 — Guard de tenant en funciones de seed (migration 057)
`seed_maestros_default`/`seed_series_numeracion` son SECURITY DEFINER, granteadas a `authenticated`, sin guard. **Contexto de ejecución confirmado antes de elegir el guard (no asumido):** ninguna tiene caller directo en `src/` — su único invocador real son los triggers `AFTER INSERT ON empresas`, disparados dentro de `create_tenant()` por el usuario que se está dando de alta. En ese momento `auth.uid()` existe (usuario autenticado real, nunca service_role — `create_tenant()` exige `auth.uid() IS NOT NULL`), pero `get_my_empresa_id()` devuelve NULL: `handle_new_user()` crea el profile con `empresa_id` NULL en el signup, y el `INSERT INTO empresas` (que dispara el trigger) ocurre ANTES de que `create_tenant()` vincule el profile a la empresa nueva. Confirmado además que ese INSERT solo ocurre cuando `profiles.empresa_id` ya es NULL (`create_tenant()` retorna temprano si el usuario ya tiene empresa).

**Por eso el guard NO es el service_role-aware de la migration 054** (el caller nunca es service_role, esa excepción sería irrelevante) — se eligió uno más simple, adaptado al contexto real: permitir si `p_empresa_id = get_my_empresa_id()` **O** si el usuario autenticado todavía no tiene ninguna empresa asignada (`profiles.empresa_id IS NULL`, el caso de alta de tenant nuevo). Riesgo residual aceptado y documentado: un usuario sin empresa aún podría llamar con el UUID de una empresa ajena ya seedeada, pero ambas funciones usan `ON CONFLICT DO NOTHING` — resultado: no-op, sin lectura ni sobrescritura ni borrado.

**Validado con 3 escenarios reales (transaccional, ROLLBACK):** (A) usuario sin empresa asignada → pasa ✓ (onboarding no se rompe); (B) usuario Empresa A → su propia empresa → pasa ✓; (C) usuario Empresa A → empresa B ajena → `RAISE 'No autorizado'` ✓ (hueco cerrado).

### Tarea 3 — Dead code cleanup (migration 058)
Re-verificado con grep fresco en `src/` + chequeo de callers internos en SQL (`pg_proc.prosrc`) + triggers — sin reusar el hallazgo de la auditoría sin re-chequear. Dropeadas 5 funciones sin ningún caller: `next_cotizacion_number`, `next_oc_number`, `next_pedido_number` (reemplazadas por `obtener_proximo_numero`, migration 051 — `siguiente_numero_documento` NO se tocó, la siguen usando `crear_devolucion`/`crear_venta`), `crear_factura_desde_entrega` (nunca cableada a ningún componente), `get_tasa_cambio` (sin caller).

Dropeada la columna `clientes.condicion_pago` (singular, huérfana) — **doble-check importante:** el nombre es ambiguo, `proveedores.condicion_pago` es una columna DISTINTA en una tabla DISTINTA y está activa (`ProveedoresSection.jsx`, NO se tocó); `clientes.condicion_pago_id` (FK) y `clientes.condiciones_pago` (plural, texto libre) también están activas en `ClientesSection.jsx` y NO se tocaron. Solo la singular sin sufijo, sin ninguna referencia, fue eliminada.

**Rollback script:** las 3 migrations (056/057/058) incluyen al final, comentado, el `CREATE TRIGGER`/`CREATE OR REPLACE FUNCTION`/`ALTER TABLE ADD COLUMN` exacto para revertir cada cambio si hiciera falta.

Build de producción sin errores (ningún cambio tocó `src/`, solo SQL).

Archivos: `supabase/migrations/056_drop_triggers_duplicados_pedidos.sql`, `057_guard_seed_functions.sql`, `058_dead_code_cleanup.sql` (nuevos).

---

## Sesión 33 — Fix CRÍTICOS de estabilización

### Fix 1 — `aplicar_compra_producto` tragaba el error (fallo silencioso de stock)

[CompraRapidaSection.jsx](src/components/sections/CompraRapidaSection.jsx) → `handleRegisterPurchase`, loop de "Nueva Compra": el RPC que actualiza stock+costo se llamaba con `if (aplicarError) console.error(...)` — logueaba pero seguía, mostrando "Compra registrada ✓" aunque el stock no se hubiera movido (mismo patrón #1 de la auditoría: `.rpc()` resuelve `{data,error}`, no rechaza).

**Decisión "rollback vs frenar-y-avisar" (el prompt pedía evaluar antes de elegir): se eligió frenar-y-avisar, NO rollback manual.** Razones:
- No hay transacción DB real en este flujo — son llamadas REST independientes (`INSERT compras` → `INSERT detalle_compras` → RPC `crear_recepcion_implicita` → loop `aplicar_compra_producto` → `INSERT movimientos_caja`). Un rollback manual desde el front es él mismo no-atómico: cada DELETE/reverse compensatorio puede fallar y dejar un estado peor.
- Revertir el stock ya aplicado bajo Promedio Ponderado es matemáticamente lossy (mismo motivo por el que en sesión 31 se bloqueó editar cantidad/costo de compras pasadas en modo PPP).
- El fallo realista es transitorio (los productos del carrito son de la propia empresa, recién seleccionados — "producto no encontrado/sin permiso" casi no puede pasar), así que reintentar simplemente funciona.
- El fix atómico correcto sería mover toda la compra a una sola RPC `crear_compra` server-side (transacción única) — refactor L, fuera del alcance de esta tarea de fixes críticos. Un rollback manual a medias sería trabajo descartable.

**Implementación:** se intentan TODOS los ítems del carrito acumulando los que fallan (minimiza la brecha si uno falla a mitad), y si `stockErrors.length > 0` se hace `throw` con un mensaje claro ("La compra quedó registrada pero NO se pudo actualizar el stock de: X, Y. Revisá manualmente.") ANTES del `INSERT` de caja y del toast de éxito. El `catch` existente lo muestra como toast destructivo. Ya no hay éxito silencioso con stock sin mover.

### Fix 2 — Guard multi-tenant en `insertar_movimiento_bancario_externo` (migration 054)

RPC SECURITY DEFINER granteada a anon+authenticated que insertaba en `movimientos_bancarios` validando que la cuenta perteneciera al `p_empresa_id` **pasado por el caller**, pero sin comparar contra `get_my_empresa_id()` → un usuario autenticado de Empresa A con el UUID de una cuenta de Empresa B podía inyectar movimientos en la conciliación de B.

**Decisión sobre el grant `anon` (el prompt pedía confirmar antes de tocar): NO se tocó el grant.** Se confirmó que el único caller legítimo es `supabase/functions/mp-webhook/index.ts`, que usa la **SERVICE_ROLE_KEY** (no anon, no JWT de usuario) y pasa el `empresa_id` por query param del webhook de MP. El grant a `anon` no tiene ningún caller real — queda flageado para una limpieza de grants más amplia, sin removerlo a ciegas. El guard nuevo ya neutraliza el riesgo de anon de todos modos.

**El guard tuvo que ser service_role-aware**, no el `IF p_empresa_id IS DISTINCT FROM get_my_empresa_id()` ingenuo: bajo service_role `get_my_empresa_id()` devuelve NULL, así que el guard ingenuo habría roto TODOS los cobros de MercadoPago en producción. Solución:
```sql
IF auth.role() IS DISTINCT FROM 'service_role'
   AND p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
  RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
END IF;
```
`auth.role()` lee el claim del JWT (independiente del cambio de rol de SECURITY DEFINER). El webhook ya valida la empresa y deriva la cuenta de su propia fila de `integraciones_bancarias`, así que el camino service_role es seguro sin el chequeo.

**Validado con 3 escenarios reales (transaccional/no-persistente):** (1) usuario Empresa A → su propia cuenta: pasa el guard ✓; (2) usuario Empresa A → cuenta de Empresa B: `RAISE 'No autorizado'` ✓ (hueco cerrado); (3) service_role → cualquier empresa: pasa el guard y llega al INSERT ✓ (webhook preservado). Build de producción sin errores.

### Fix 3 — CHECK `origen` rechazaba 'mercadopago' (cobros MP fallaban con 500) — migration 055

Hallazgo colateral del test 2/3 del Fix 2: el CHECK `movimientos_bancarios_origen_check` (definido en migration 011) solo admite `('manual','csv','email','webhook')`, pero el `mp-webhook` llama a la RPC `insertar_movimiento_bancario_externo` con `p_origen='mercadopago'`. Ese valor no está en el CHECK → el INSERT interno de la RPC falla con **error 23514 (check_violation)**, la RPC propaga la excepción y el webhook responde **500**. Efecto: **TODOS los cobros aprobados de MercadoPago venían fallando silenciosamente** al registrarse como movimiento bancario; MP reintenta el webhook y siempre recibe 500. La sincronización automática de cobros MP — feature estrella de la integración — estaba rota. (Era `task_02f2207b`.)

**Decisión "ampliar CHECK vs degradar webhook" (el prompt pedía evaluar ambas):** se eligió **Opción A — ampliar el CHECK** para incluir `'mercadopago'`, NO la Opción B (cambiar el webhook a `p_origen='webhook'`, ya permitido). Razones: `'webhook'` es genérico y pierde la pasarela que originó el movimiento; el sistema ya distingue MercadoPago en otros lados (la descripción arranca con `"MP #..."`), así que registrar el origen real a nivel de columna es mejor para reportes/trazabilidad. La migration hace `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` con la lista ampliada.

**`'uala'` NO se incluyó** (confirmado con el usuario): no hay caller de Ualá hoy, se agrega en su propia migration cuando esa integración exista. Set mínimo necesario. Se verificó que el único caller de la RPC con origen fuera del set es el `mp-webhook` (`'mercadopago'`); no hay otras pasarelas rompiendo el constraint.

La migration 055 **no toca** la RPC ni el guard multi-tenant de la 054 — solo el constraint de la tabla. Se actualizó también el tipo TS `MovimientoBancario.origen` en `cuentasBancariasService.ts` para incluir `'mercadopago'`. El webhook (`p_origen: 'mercadopago'`) quedó sin cambios.

**Aplicada y verificada en la base real** (proyecto Supabase `wuznppxeonmhfcvnqfbf`): la 055 corrió sin errores vía SQL editor. Verificación con INSERT directo a `movimientos_bancarios` (`origen='mercadopago'`, dentro de `BEGIN`/`ROLLBACK`, no persistido) pasó el CHECK sin el error 23514. Se probó también la RPC completa vía MCP — bloqueó con `'No autorizado'`, comportamiento esperado porque esa conexión no corre como `service_role` (confirma que el guard de la 054 sigue activo); el webhook real sí corre con `SERVICE_ROLE_KEY` y llegará al INSERT sin problema.

Archivos: `supabase/migrations/054_guard_insertar_movimiento_bancario_externo.sql` (nuevo), `supabase/migrations/055_ampliar_check_origen_movimientos_bancarios.sql` (nuevo, aplicada), `CompraRapidaSection.jsx`, `src/services/cuentasBancariasService.ts`.

---

## Sesión 32 — Auditoría de recepción de OC + unificación de caminos

## Sesión 32 — Auditoría de recepción de OC + unificación de caminos

El usuario reportó "BUG CRÍTICO — corrupción de datos activa: cada recepción de OC duplica el incremento de stock" y pidió auditar TODO antes de tocar nada (triggers reales vía `pg_trigger`, no por nombre de migration; confirmar qué llama realmente el botón "Recibir"; mapear el flujo completo).

**Resultado de la auditoría — el bug mecánico original ya estaba resuelto** (migration 053, sesión 31): se releyó la definición viva de `crear_recepcion()` y el `IF v_oc_item_id IS NULL THEN` que gatea el UPDATE directo está intacto. Se listaron TODOS los triggers reales sobre `ordenes_compra_items`/`recepciones`/`recepcion_items`/`productos` vía `pg_trigger` — solo existe `trg_oc_stock` (uno solo, sin duplicados fantasma). Cruce contra datos reales (8 ítems de OC con `cantidad_recibida > 0`) no mostró evidencia de doble conteo activo hoy.

**Hallazgo nuevo, no contemplado en la sesión 31:** existían **2 caminos UI completamente independientes** para recibir contra la misma OC, ambos habilitados en los mismos estados (`enviada`/`recibida_parcial`) dentro de `OrdenesCompraSection.jsx`:
- **Camino A** (ícono 📦 en la fila de la lista) → `GenerarRecepcionModal` → RPC `crear_recepcion` → escribe `recepciones`+`recepcion_items`+`cantidad_recibida` (incremental). Auditado, con registro en `movimientos_inventario`.
- **Camino B** ("Ver detalle" → "Registrar Recepción") → `ordenesCompraService.recibirItems()` → solo `UPDATE ordenes_compra_items SET cantidad_recibida = <valor>` (**absoluto**, no incremental) → sin fila en `recepciones`, sin `movimientos_inventario`.

Cruce con datos reales: **7 de 8 ítems de OC ya recibidos pasaron por el Camino B** (el viejo) — es el camino que de hecho usa la operación real, no el nuevo y auditado. El campo del Camino B se pre-llenaba con `item.cantidad_recibida` (lo YA recibido) bajo la etiqueta engañosa "A recibir", guardando ese valor como el nuevo total absoluto — un usuario que lo interpretara como "cuánto llegó ahora" en vez de "total acumulado" podía inflar (duplicar) o deflactar (restar) `stock_actual` sin ningún error visible, y sin dejar rastro en `movimientos_inventario`.

**Decisión (consultada con el usuario vía pregunta directa, no asumida):** unificar a un solo camino. Se eliminó por completo el Camino B:
- `OrdenesCompraSection.jsx`: removidos el estado `recepcionId`/`recepciones`, la query `detalleRecepcion`, el `useEffect` que la sincronizaba, `recibirMutation`, y el Dialog "MODAL: Recepción de mercadería" entero. El botón "Registrar Recepción" dentro del modal de detalle ahora abre `GenerarRecepcionModal` (`setGenRecepId`) en vez del modal viejo — un solo flujo, accesible desde los 2 puntos de entrada (ícono de fila y detalle).
- `ordenesCompraService.ts`: eliminado `recibirItems()` (sin otros callers, confirmado por grep) y el import sin uso de `OrdenCompraItem`.
- No se tocó `crear_recepcion`, `fn_oc_update_stock`, ni `crear_recepcion_implicita`.

Build de producción sin errores. No quedan referencias colgantes a los identificadores eliminados (verificado por grep).

---

## Sesión 31 — Fix doble incremento de stock en Recepción de OC

**Encontrado sin buscarlo**, durante la inspección de la sesión 30 (numeración) — fuera de ese alcance, no tocado hasta ahora.

`crear_recepcion()` (RPC del camino largo de Compras, recibir contra una OC desde `OrdenesCompraSection.jsx` → `GenerarRecepcionModal.jsx`), para cada item con `orden_compra_item_id` vinculado, hacía DOS escrituras que terminaban incrementando lo mismo:
1. `UPDATE productos SET stock_actual = stock_actual + v_cantidad` — directo, dentro del loop de items.
2. `UPDATE ordenes_compra_items SET cantidad_recibida = cantidad_recibida + v_cantidad` — dispara `trg_oc_stock` → `fn_oc_update_stock()` (migration 003, redefinida en 049 para Valoración de Stock), que TAMBIÉN hace `UPDATE productos SET stock_actual = stock_actual + delta` con `delta` = el mismo `v_cantidad`.

Resultado: `productos.stock_actual` quedaba incrementado el DOBLE de lo realmente recibido, en cada recepción contra una OC con item vinculado. Además, desde la 049 el trigger también recalcula `costo_compra` bajo Promedio Ponderado usando `stock_actual` como "stock previo" — pero para cuando corre el trigger ese stock ya fue inflado por el UPDATE directo del paso 1 (misma función, misma transacción), así que el bug no solo duplicaba cantidad: también corrompía el cálculo de PPP. `movimientos_inventario` nunca se vio afectado — se inserta una sola vez con el `v_cantidad` correcto, fue la pista que permitió aislar cuál de las dos escrituras sobre `productos` era la espuria.

**No afecta** a `crear_recepcion_implicita()` (compras directas sin OC, vía `CompraRapidaSection`) — esa función no toca `ordenes_compra_items` en ningún punto.

**Fix** (migration 053): el `UPDATE productos` directo dentro de `crear_recepcion()` ahora se ejecuta solo si `v_oc_item_id IS NULL` (item de recepción sin vínculo a OC — el único caso en que el trigger nunca se dispara y el UPDATE directo sigue siendo necesario). Cuando hay item de OC vinculado, `trg_oc_stock`/`fn_oc_update_stock()` queda como única fuente de verdad para `stock_actual` y `costo_compra` — no se tocó el trigger ni `fn_calcular_costo_valoracion()`. Resto de `crear_recepcion()` (numeración vía `obtener_proximo_numero`, `movimientos_inventario`, `recepcion_items`) idéntico a la versión vigente desde migration 052.

**Aplicado a la base real** (proyecto `wuznppxeonmhfcvnqfbf`) — el usuario pegó la migration en el SQL Editor de Supabase. Verificado después vía `pg_get_functiondef('crear_recepcion')`: la función viva ya tiene el `IF v_oc_item_id IS NULL THEN` gating el UPDATE directo, idéntico al archivo del repo. Pendiente (no bloqueante): confirmar con una recepción real contra OC que `stock_actual` incrementa exactamente una vez (comparar antes/después vs `recepcion_items.cantidad`).

Archivo: `supabase/migrations/053_fix_doble_incremento_stock_recepcion_oc.sql` (nuevo).

---

## Sesión 30 — Series de Numeración

**Problema real encontrado en la inspección previa:** ninguno de los 9 puntos de numeración existentes era genuinamente atómico. 4 (Venta/Factura/NC/Pedido) generaban el número en el FRONTEND vía `SELECT MAX(...) + 1` (race condition entre dos pestañas/usuarios simultáneos). Los otros 5 (Entrega/Recepción×2/ND/Cotización/OC) usaban funciones SQL que parecían seguras por estar server-side, pero `siguiente_numero_documento()` (Entrega/Recepción/ND) hacía `COUNT(*) WHERE columna LIKE patrón` SIN lock — no solo repetible en concurrencia, sino que si se borraba una fila el conteo bajaba y el siguiente número generado podía COLISIONAR con uno ya emitido. `next_cotizacion_number()`/`next_oc_number()` usaban `MAX(REGEXP...)+1` también sin lock.

**Tabla `series_numeracion`** (migration 051): `empresa_id`, `tipo_documento` (9 valores, CHECK), `prefijo`, `formato_fecha` (`'YYYYMMDD'|'YYYY'|'ninguno'`), `digitos`, `proximo_numero`, y **`periodo_actual`** (columna agregada más allá de lo pedido literalmente — necesaria para que Venta/Factura/NC/Pedido sigan reiniciando su secuencia cada DÍA y Entrega/Recepción/ND cada AÑO, exactamente como ya hacían; sin trackear a qué período corresponde `proximo_numero`, un contador puramente incremental habría cambiado el formato visible al cliente de un día para el otro). RLS por `get_my_empresa_id()`, `UNIQUE(empresa_id, tipo_documento)`.

**`seed_series_numeracion(empresa_id)`** — mismo patrón que `seed_maestros_default` (trigger `AFTER INSERT ON empresas`, + seed retroactivo para las 3 empresas existentes). Valores DEFAULT por tipo, reproduciendo el formato actual exacto de cada uno:

| tipo_documento | prefijo | formato_fecha | dígitos | formato resultante |
|---|---|---|---|---|
| venta | `''` | YYYYMMDD | 3 | `20260620-001` |
| factura | `FAC-` | YYYYMMDD | 3 | `FAC-20260620-001` |
| nota_credito | `NC-` | YYYYMMDD | 3 | `NC-20260620-001` |
| pedido | `PED-` | YYYYMMDD | 3 | `PED-20260620-001` |
| nota_debito | `ND-` | YYYY | 4 | `ND-2026-0001` |
| entrega | `ENT-` | YYYY | 4 | `ENT-2026-0001` |
| recepcion | `REC-` | YYYY | 4 | `REC-2026-0001` |
| orden_compra | `OC-` | ninguno | 5 | `OC-00001` |
| cotizacion | `COT-` | ninguno | 5 | `COT-00001` |

**Backfill retroactivo** (parte de migration 051, una sola vez, NO repetible) — calculó, por empresa y por tipo, el `proximo_numero`/`periodo_actual` exacto para continuar sin pisar ni repetir nada ya emitido (parseando el último número real de cada tabla con regex). Validado contra empresa real `cbc4db74-...`: cotización 16→17, entrega 41→42, OC 9→10, ND 3→4, recepción 4→5; venta/factura/NC/pedido en 1 porque ninguno se emitió hoy (20260620) todavía.

**RPC `obtener_proximo_numero(p_empresa_id, p_tipo_documento)`** — única fuente de numeración de ahora en más. `SELECT ... FOR UPDATE` (bloquea la fila hasta el commit — el lock real que `siguiente_numero_documento()` nunca tuvo), reinicia a 1 si cambió el período (día/año según `formato_fecha`, timezone fijo UTC-3 igual que `getNowAR()`/`getTodayAR()` del frontend), arma el string final y hace el `UPDATE proximo_numero+1` en la misma transacción.

**Call-sites migrados (9 de 9 en alcance):**
- Frontend (reemplazó `SELECT MAX`/`generateXNumber()` por 1 llamada RPC): `NuevaVentaModal.jsx` (`generateVentaNumber`), `NuevaFacturaModal.jsx` (`generateNumero`), `NuevaNCModal.jsx` (`generateNCNumber`), `PedidosSection.jsx` (`generateNumero`), `cotizacionesService.ts` (antes llamaba `next_cotizacion_number`), `ordenesCompraService.ts` (antes llamaba `next_oc_number`).
- SQL (migration 052, reemplazó la línea de `siguiente_numero_documento(...)` dentro de cada RPC, sin tocar el resto de su lógica de negocio — stock, items, CC): `crear_entrega()`, `crear_recepcion()`, `crear_recepcion_implicita()`, `crear_nota_debito()`.

**Fuera de alcance a propósito:** `crear_devolucion()` (tipo `'devolucion'` no estaba en la lista pedida) sigue usando `siguiente_numero_documento()` sin cambios — esa función NO se borró ni se modificó, sigue viva solo para Devoluciones. `crear_factura_desde_entrega()` recibe el número como parámetro pero no tiene ningún caller real en `src/` (RPC sin uso, dead code preexistente, no tocado). `next_cotizacion_number`/`next_oc_number` quedan en la base sin caller (no se borraron, por si algo más las referenciara — riesgo cero de dejarlas).

**Nota para Q3 2026** (dejada como comentario en el código, no implementada): cuando lleguen las series específicas por tipo de comprobante AFIP (A/B/C/E), el punto de extensión natural es agregar una clave compuesta (tipo_documento + letra AFIP) a `series_numeracion` en vez de una serie única por tipo.

**UI** (`ConfiguracionSection.jsx`, tab Facturación y Documentos): reemplazó el placeholder "Tipos de Comprobante — Próximamente" por una tabla editable de 9 filas (prefijo + próximo número editables, preview en tiempo real calculado en JS con la misma fórmula que el RPC, advertencia de "puede generar números repetidos o saltos", guardado por fila).

**Validado con datos reales, sin tocar la empresa de producción `cbc4db74-...`** (se usó la empresa de test `db21dfad-...`, sin historial previo, en transacciones separadas — no una sola transacción con lock, para probar atomicidad real entre transacciones distintas): 2 llamadas consecutivas a `venta` → `20260620-001` luego `20260620-002` (sin repetir); `cotizacion` → `COT-00001` (`proximo_numero` 1→2); `entrega` → `ENT-2026-0001` (`proximo_numero` 1→2). Build de producción sin errores.

Archivos: `supabase/migrations/051_series_numeracion.sql`, `supabase/migrations/052_series_numeracion_callsites.sql` (nuevos), `ConfiguracionSection.jsx`, `NuevaVentaModal.jsx`, `NuevaFacturaModal.jsx`, `NuevaNCModal.jsx`, `PedidosSection.jsx`, `cotizacionesService.ts`, `ordenesCompraService.ts`.

### Fix aparte (mismo día): doble incremento de stock en `crear_recepcion`

Encontrado al leer `crear_recepcion()` durante la migración de numeración (no relacionado, reportado como tarea separada y resuelto en background — `migration 053`). `crear_recepcion()` hacía, para cada ítem vinculado a un `ordenes_compra_items`: (1) `UPDATE productos SET stock_actual = stock_actual + cantidad` directo, y (2) `UPDATE ordenes_compra_items SET cantidad_recibida = cantidad_recibida + cantidad` — pero ese UPDATE dispara el trigger `trg_oc_stock` → `fn_oc_update_stock()` (migration 003, redefinida en 049), que TAMBIÉN suma `cantidad` a `stock_actual`. Resultado: el stock quedaba el DOBLE de lo recibido en cada recepción contra una OC. Peor todavía: desde la migration 049, `fn_oc_update_stock()` también recalcula `costo_compra` bajo Promedio Ponderado usando `stock_actual` como "stock previo" — pero para cuando el trigger corre, ese stock ya estaba inflado por el UPDATE directo de la misma función, así que el bug también corrompía el cálculo de PPP (usaba un "stock previo" que no era el previo real).

**No afecta** a `crear_recepcion_implicita()` (compras directas sin OC vía `CompraRapidaSection`) — esa función nunca toca `ordenes_compra_items`.

**Fix:** el UPDATE directo de `productos.stock_actual` en `crear_recepcion()` ahora corre SOLO cuando `v_oc_item_id IS NULL` (recepción sin ítem de OC vinculado, caso en que el trigger nunca se dispara). Cuando sí hay vínculo, `trg_oc_stock` queda como única fuente de verdad para stock y costo — sin tocar `fn_oc_update_stock()` ni `fn_calcular_costo_valoracion()`. Verificado aplicado en producción.

---

`empresas.metodo_valoracion_stock` (migration 049, TEXT NOT NULL DEFAULT `'ultimo_costo'`, `CHECK IN ('ultimo_costo','promedio_ponderado')`). 'fifo' queda fuera del CHECK a propósito — roadmap Fase B, sin lógica de capas/lotes implementada todavía.

**Inspección previa (corrigió 2 supuestos del prompt original):**
- `NuevaFacturaProveedorModal.jsx` y `OrdenesCompraSection.jsx` (creación de OC) **NO escriben** `productos.costo_compra` — solo lo leen para prefill/display. Los únicos 2 puntos reales de escritura son: (1) `CompraRapidaSection.jsx` → "Nueva Compra" (frontend) y (2) `fn_oc_update_stock()` → trigger de recepción de OC (DB-side, ya existía desde migration 003).
- `supabase.rpc('increment_stock', ...)` que usa el modal de **edición** de una compra ya registrada (`CompraRapidaSection.jsx` → `handleSaveEdit`) llama a una función que **no existe en la base** (solo existe `decrement_stock`) — bug preexistente, no de esta sesión. **Fix aplicado más adelante en esta misma sesión — ver bloque "Fix increment_stock" más abajo.**

**Centralización (SQL, no JS)** — dado que uno de los 2 write points reales es un trigger DB y el otro es frontend, la fórmula vive en una única función SQL pura `fn_calcular_costo_valoracion(p_metodo, p_stock_previo, p_costo_previo, p_cantidad, p_costo_nuevo)`, reutilizada por:
1. `fn_oc_update_stock()` (trigger, modificado — antes pisaba `costo_compra = NEW.costo_unitario` directo).
2. `aplicar_compra_producto(p_producto_id, p_cantidad, p_costo_nuevo)` — RPC nueva (`SECURITY DEFINER`, valida tenant vía `get_my_empresa_id()`, mismo patrón que `decrement_stock`). `CompraRapidaSection.jsx` (flujo "Nueva Compra", antes hacía fetch+update manual de `stock_actual`/`costo_compra` desde el frontend) ahora llama esta RPC — además de centralizar el cálculo, lo hace atómico.

Fórmula PPP: `nuevo_costo = (stock_previo × costo_previo + cantidad × costo_nuevo) / (stock_previo + cantidad)`, usando el stock **previo** a la operación (se lee antes del UPDATE, en ambos puntos).

**UI** (`ConfiguracionSection.jsx`, tab Inventario): reemplazó la tarjeta placeholder "Próximamente" por un selector de 3 opciones (Último Costo / Promedio Ponderado / FIFO grisado con badge "Próximamente"), mismo patrón de carga/guardado directo sobre columna de `empresas` que ya usaba Moneda Paralela (`tcConfig`/`handleSaveTC`) en el tab Finanzas.

**Validado con datos reales** (producto "Mouse Vertical", empresa `cbc4db74-...`, dentro de una transacción con ROLLBACK — producción intacta): stock previo 98 u. a $5.000,00, compra de 10 u. a $6.000,00 → cuenta a mano `(98×5000+10×6000)/108 = $5.092,5925...` → sistema devolvió `$5.092,59` (redondeo a 2 decimales de `numeric(12,2)`). Coincide exactamente. Modo `ultimo_costo` verificado sin cambios de comportamiento (devuelve `costo_nuevo` tal cual).

Archivos: `supabase/migrations/049_metodo_valoracion_stock.sql` (nuevo), `ConfiguracionSection.jsx` (selector + load/save), `CompraRapidaSection.jsx` (reemplaza fetch+update manual por RPC `aplicar_compra_producto`). No se tocó `unidades_medida` ni ningún otro maestro, ni ningún flujo de venta/P&L/márgenes.

---

### Fix `increment_stock` (continuación sesión 29, mismo día) — síntoma confirmado: fallo **silencioso**

El cliente Supabase JS no tira excepción por default cuando un RPC falla (`.rpc()` resuelve `{ data, error }`, no rechaza la promesa salvo `.throwOnError()`). Los 3 call-sites de `increment_stock` en `handleSaveEdit` hacían `await supabase.rpc(...)` sin chequear `error` — entonces cuando el RPC no existía, la llamada "fallaba" sin que el código se enterara, seguía con los demás `INSERT`/`UPDATE`/`DELETE` de `detalle_compras` con normalidad, y terminaba mostrando **"Cambios guardados" (éxito)** al usuario. Resultado: cualquier edición de compra que cambiara la cantidad de un ítem dejaba `productos.stock_actual` desincronizado de lo que la UI mostraba, sin ningún error visible.

La lógica de diff (`diff = nueva_cantidad - cantidad_original`) ya estaba bien calculada — el bug era exclusivamente el RPC inexistente + la falta de chequeo de error, no la matemática del diff.

**Fix:**
- `supabase/migrations/050_rpc_increment_stock.sql` — crea `increment_stock(row_id, quantity)` simétrica a `decrement_stock` (mismo patrón `SECURITY DEFINER` + `WHERE empresa_id = get_my_empresa_id()`), sin tocar `decrement_stock` (sigue intacta, la usan las ventas).
- Los 3 call-sites ahora chequean `{ error }` y hacen `throw` si falla — pasa a explotar visiblemente con mensaje real en vez de tragarse el error.
- **Bajo `promedio_ponderado`:** revertir un promedio ya mezclado con compras/ventas posteriores no tiene una definición matemática no ambigua (no hay un log de capas de costo, `costo_compra` es un escalar mutable). Se bloquea editar cantidad/costo de un ítem **ya registrado** (toast explicando + sugiere ajuste de stock manual desde Productos). Altas (ítems nuevos agregados durante la edición) y bajas (ítems eliminados) sí se permiten en cualquier modo — no tocan costo retroactivo de una línea preexistente. Los ítems nuevos durante una edición ahora pasan por `aplicar_compra_producto()` (mismo camino que "Nueva Compra"), en vez de la sobreescritura incondicional de último costo que tenían antes.
- Verificado: `increment_stock`, `aplicar_compra_producto` y `decrement_stock` coexisten en la base, las 3 funciones existen y son independientes.

---

`PlanCuentasSection.jsx` pasa de 5 a **7 tabs**. Las 2 vistas nuevas reutilizan `asientosService.getBalanceComprobacion(empresaId, desde, hasta)` sin tocarla ni tocar los tabs Balance (Sumas y Saldos)/Libro Mayor — solo filtran las filas devueltas por `tipo` en el cliente:
1. **Estado de Resultados** (tab "resultados") — filtro Desde/Hasta (igual que Libro Mayor), agrupa cuentas `tipo='ingreso'` y `tipo='egreso'`, calcula Resultado del Período = Ingresos − Egresos, badge Ganancia/Pérdida, export CSV con BOM UTF-8.
2. **Balance General** (tab "balance_general") — una sola "Fecha de corte" (snapshot, no rango), agrupa `tipo IN ('activo','pasivo','patrimonio')`. La cuenta seedeada "Resultado del Ejercicio" (código 3.3) se excluye del listado genérico de Patrimonio y se reemplaza por una línea calculada = Ingresos−Egresos acumulados a la fecha de corte (+ cualquier saldo manual que ya tuviera esa cuenta). Badge verde/rojo "Balanceado" si `|Activo − (Pasivo + Patrimonio)| < 0.01`.

**Por qué cierra matemáticamente sin asiento de cierre de ejercicio:** por partida doble, `Σdebe = Σhaber` global en cualquier corte de fecha (ya que cada asiento confirmado está balanceado). Agrupando por naturaleza: `Activo + Egresos(deudoras) = Pasivo + Patrimonio_raw + Ingresos(acreedoras)` → `Activo = Pasivo + Patrimonio_raw + (Ingresos − Egresos)`. Esto vale sin importar si la cuenta "Resultado del Ejercicio" tiene movimientos o no. Validado con datos reales (empresa `cbc4db74-...`, 93 asientos confirmados): Activo $5.754.500,00 = Pasivo $30.000,00 + Patrimonio $5.724.500,00 (= Resultado del Ejercicio calculado) → **diferencia $0,00, balanceado**.

Archivos tocados: `PlanCuentasSection.jsx` (2 componentes de tab nuevos `TabEstadoResultados`/`TabBalanceGeneral` + 2 entradas en `TabsList`/`TabsContent` + helper `csvDownload`), `planCuentasService.ts` (2 query keys nuevas `estadoResultados`/`balanceGeneral`, additive, sin tocar funciones existentes).

---

**Sesión 27** — Moneda Paralela UI en módulo Compras (cierre del pendiente desde Prompt 13).

Replicado el patrón ya usado en Caja/Cuenta Corriente (`useTCParalelo()`, banner naranja/verde de paridad, columna con fallback `calcParalelo()`, guard `monto_paralelo !== null` en cada INSERT) en los 2 puntos de entrada reales que insertan en `compras` (confirmados vía grep — `ComprasSection.jsx`/`ComprasSection` shell no inserta directo, y `OrdenesCompraSection.jsx` no toca `compras` en absoluto, solo `ordenes_compra`, que no tiene las columnas paralelas):
1. **`CompraRapidaSection.jsx`** (componente interno `ComprasSection`, tab "Nueva Compra"/"Historial") — el cálculo e INSERT con guard ya estaban hechos de una sesión previa; se agregó lo que faltaba: banner de paridad bajo el `MonedaSelector`, equivalente bajo "Total de Compra", columna "[moneda paralela]" en la tabla de Historial con fallback `calcParalelo()`, y el `TipoCambioModal` para cargar el TC faltante.
2. **`NuevaFacturaProveedorModal.jsx`** (Compras → Facturas → Nueva Factura de Proveedor) — no tenía NADA de moneda paralela (es un flujo 100% ARS, sin `MonedaSelector`). Agregado completo: `useTCParalelo()`, cálculo del equivalente, guard en el INSERT a `compras` y en el INSERT a `movimientos_caja` (solo si Efectivo + caja abierta), banner de paridad, equivalente bajo "TOTAL A PAGAR", `TipoCambioModal`.
3. **`FacturasCompraSection.jsx`** (listado de Facturas de Proveedor) — agregada columna "[moneda paralela]" con el mismo fallback, ya que lista TODAS las compras (de ambos orígenes), no solo las de su propio modal.

**No tocado a propósito:** `OrdenesCompraSection.jsx` (no inserta en `compras`/`movimientos_caja`, las columnas paralelas no existen en `ordenes_compra` — confirmado contra migration 041) y la lógica de `MonedaSelector`/TC obligatorio operacional (es independiente del sistema de moneda paralela).

**Sesión 26** — Cierre Impuestos + Testing Fecha de Vencimiento CC.

### Parte 1 — Cierre testing módulo Impuestos (continuación sesión 24)

Tab Retenciones y Percepciones — probado (Sufridas + Practicadas), 2 fixes:
1. **ConfiguracionSection.jsx** — agregados campos CUIT y Condición frente al IVA en tab Empresa (Identidad y Datos de Contacto). Leen/escriben sobre `empresas.afip_cuit` y `empresas.condicion_iva` (misma fuente que el wizard de AFIP — sin duplicar datos). Antes, el certificado de retención practicada mostraba "CUIT: —" porque no había forma de cargarlo fuera del wizard.
2. Fix de constraint: el `<select>` de condición_iva usaba valores de texto completo ("Responsable Inscripto") que no matcheaban el constraint `empresas_condicion_iva_check`. Ajustado a los códigos correctos (RI, Monotributo, Exento, CF) — mismos que usa el wizard de AFIP.

Warning de accesibilidad (DialogTitle/Description) — investigado y resuelto. Causa real: OnboardingWizard.jsx usaba `<h2>` plano en vez de DialogTitle/DialogDescription, y se monta oculto detrás del Dashboard cuando `onboarding_completado=false`. Fix: agregado DialogTitle/DialogDescription con clase `sr-only` (accesible, invisible visualmente).

Tab Alícuotas — probado, 1 fix:
3. **TabAlicuotas.jsx** — Validación de rango de vigencia: bloquea guardar si "Vigencia hasta" es anterior a "Vigencia desde" (mensaje inline + botón deshabilitado). Badge de 3 estados en la tabla: Activa (verde, vigente), Vencida (ámbar, vigencia_hasta < hoy), Inactiva (rojo, toggle manual). El campo `activo` en DB no se toca automáticamente — el estado "Vencida" es cálculo visual.

### Parte 2 — Testing Sesión 25 de Luciano (Fecha de Vencimiento en CC)

🔴 **Bug crítico — Regresión:** volvió el error `column "descripcion" of relation "comprobante_items" does not exist` al crear cualquier venta. Causa: Migration 047 (cálculo fecha_vencimiento) se escribió sobre una base de código anterior al fix de sesión 19, y el `CREATE OR REPLACE` de la función `crear_venta` reintrodujo el INSERT roto con la columna `descripcion` inexistente. **Fix: Migration 048** — preserva toda la lógica de cálculo de fecha_vencimiento (dias_credito) de la 047, remueve la columna `descripcion` rota del INSERT a comprobante_items. ⚠️ Nota para Luciano: confirmar que siempre arranca desde `git pull` actualizado antes de escribir migraciones sobre RPCs compartidas — es la segunda vez que pasa este mismo tipo de regresión.

🔴 **Bug crítico — Período contable:** "Ejercicio 2026 - Enero" tenía fechas 18/6→4/7/2026 (mal nombrado, eran fechas de junio/julio) y estaba CERRADO, dejando un agujero sin cobertura entre el 18/06 y 30/06 — bloqueaba la generación de asientos contables de cualquier venta en ese rango. **Fix:**
- Renombrado a "Ejercicio 2026 - Junio", rango ajustado a 1/6→30/6/2026, reabierto (estado=abierto, fecha_cierre_real=null). Ahora hay cobertura continua: Junio (1-30/6) + Julio (1-31/7), sin solape.
- Mejora de producto agregada en PlanCuentasSection.jsx: botón "Reabrir" en la columna Acciones para períodos cerrados (antes no existía ninguna acción posible ahí, forzando edición manual en Supabase). Modal de confirmación antes de reabrir.
- Validación de solape de fechas agregada al crear un período nuevo (handleCrearPeriodo) — evita que se repita este tipo de error a futuro.

✅ **Feature Fecha de Vencimiento en CC — Verificado funcionando:**
- RPC `crear_venta` (flujo POS/Modo Caja): cálculo correcto confirmado con venta a Carlos Perez (30 días crédito) → vencimiento 19/07/2026 ✅
- NuevaFacturaModal (flujo client-side): cálculo correcto confirmado con factura a Jhon V. (7 días crédito) → vencimiento 26/06/2026 ✅. Ambos cálculos coinciden — no hay desincronización entre RPC y client-side.
- Columna "Vence" en ClientDetailModal: funciona correctamente
- Badge "Vencido": verificado con fecha de prueba (revertida después)
- Casos borde verificados sin errores: pagos HABER sin comprobante_id → "—", comprobantes históricos sin fecha_vencimiento (anteriores a Migration 046) → "—", ningún caso rompe ni marca falsos "Vencido"

### Punto de producto — NO resuelto, requiere sesión de planificación

⚠️ **Aging de Cuenta Corriente vs. Fecha de Vencimiento:** la vista "Antigüedad de Deuda" en CuentaCorrienteSection sigue calculando por antigüedad del DEBE (fecha de la venta), no por fecha_vencimiento. Esto genera lectura incoherente ahora que existe el concepto de vencimiento: una deuda de hoy con vencimiento en 7 días aparece en el mismo balde "0-30 días" que una con vencimiento en 90 días. Decisión de producto pendiente: dejar el aging como está (antigüedad contable pura) y agregar info de vencimiento en otro lado, vs. cambiar el criterio de cálculo del aging — impacta reportes y KPIs existentes, evaluar con cuidado.

### Pendientes sin cambios (heredados de sesiones anteriores)

- Libro IVA Ventas solo muestra comprobantes con CAE — revisar alcance cuando se implemente AFIP
- 38 warnings de accesibilidad genérica (inputs sin id/name, labels no asociados) repartidos por el sistema — deuda técnica transversal, requiere sesión dedicada

### Archivos modificados en sesión 26

- `ConfiguracionSection.jsx` — campos CUIT/Condición IVA en tab Empresa
- `OnboardingWizard.jsx` — DialogTitle/Description accesibles
- `TabAlicuotas.jsx` — validación de vigencia + badge 3 estados
- Migration 048 (Supabase) — fix RPC crear_venta (columna descripcion)
- Período contable (SQL directo) — renombrado y reabierto Ejercicio 2026 Junio
- `PlanCuentasSection.jsx` — botón Reabrir + validación de solape de fechas

**Sesión 25 (Luciano)** — Cálculo automático de Fecha de Vencimiento en Cuenta Corriente (Clientes).
1. **Migration 046** (`fecha_vencimiento_comprobantes.sql`) — nueva columna `comprobantes.fecha_vencimiento DATE`, nullable. **No confundir con `cae_vencimiento`** (vencimiento del CAE de AFIP — concepto totalmente distinto). Comprobantes históricos (anteriores a esta sesión) quedan en `NULL` — no se intenta backfill retroactivo.
2. **Migration 047** (`crear_venta_fecha_vencimiento.sql`) — RPC `crear_venta` (vigente desde migration 044) ahora calcula `fecha_vencimiento = p_fecha + clientes.dias_credito` (SELECT nuevo de `clientes`, la RPC no traía esa fila previamente) y la guarda en el INSERT de `comprobantes` que ya existía. Cambio puramente aditivo — cero líneas de la lógica existente tocadas. Cubre automáticamente POS (`NuevaVentaModal.jsx`) y Modo Caja (`useConfirmarVenta.js`) sin tocar esos archivos, porque ambos ya llaman a `crear_venta` con `p_cliente_id`/`p_fecha`.
3. **`NuevaFacturaModal.jsx`** (flujo client-side, no pasa por la RPC) — mismo cálculo: agregado `dias_credito` al select de `clientes`, nuevo helper `addDaysAR()` en `dateUtils.js`, `fecha_vencimiento` seteado en el INSERT directo a `comprobantes`.
4. **Decisión de diseño (ventas sin CC):** el cálculo se hace **siempre**, sin importar la forma de pago — no es exclusivo de Cuenta Corriente. Con `dias_credito = 0` o `null` (caso típico de ventas en Efectivo/Transferencia/Tarjeta a Consumidor Final) el resultado es "vence el mismo día", así que el dato queda consistente y sin ramas de código separadas. Elegido por simplicidad: un único cálculo, un solo camino de código, sin if/else por método de pago.
5. **`ClientDetailModal.jsx`** — columna "Vence" en el Historial de Movimientos: join nuevo (`comprobantes.fecha_vencimiento, estado_pago` por `comprobante_id`) solo para las filas DEBE que tienen comprobante asociado (los pagos rápidos HABER no tienen `comprobante_id`, muestran "—"). Badge rojo "Vencido" solo si `estado_pago = 'pendiente'` y `fecha_vencimiento < hoy` (un comprobante ya pagado no se marca vencido aunque la fecha haya pasado). `—` para comprobantes históricos sin el dato.
6. **Confirmado sin cambios:** `CuentaCorrienteSection.fetchAgingData()` sigue calculando antigüedad exactamente igual que antes ("días desde el movimiento DEBE más antiguo") — esta sesión agrega un dato nuevo (vencimiento según condición de pago), no reemplaza el aging existente. Si en el futuro se quiere que el aging se calcule por vencimiento en vez de por antigüedad de creación, es una decisión de producto distinta, no implementada acá.

Archivos modificados en sesión 25: `supabase/migrations/046_fecha_vencimiento_comprobantes.sql`, `supabase/migrations/047_crear_venta_fecha_vencimiento.sql`, `src/lib/dateUtils.js` (+`addDaysAR`), `src/components/ventas/NuevaFacturaModal.jsx`, `src/components/sections/ClientDetailModal.jsx`.

**Sesión 24 (Nadia)** — Testing Impuestos + 3 fixes navegación Libro IVA.
1. **ReportesSection.jsx** — Libro IVA Ventas ya no requiere AFIP activo para verse. Removidas todas las condiciones sobre `afipActivo` en la tarjeta: className, onClick, descripción y botón. Texto fijo: "Comprobantes emitidos con neto gravado e IVA discriminado por período." Botón siempre habilitado: "Ver Libro IVA Ventas". Badge AFIP se mantiene condicional (correcto).
2. **ReportesSection.jsx + Dashboard.jsx** — Apertura directa con `initialView`: ReportesSection acepta prop `initialView = null` + useEffect que llama `setShowLibroIVA(true)` cuando `initialView === 'libro_iva'`. Dashboard.jsx: nuevo `sectionParams` + `navigateTo(section, params)`. TabIVA.jsx: botón "Ver Libro IVA Ventas" llama `onNavigate('reportes', { initialView: 'libro_iva' })`. Flujo completo: Impuestos → Ver Libro IVA Ventas → Reportes abre el libro directamente sin pasar por el Centro de Reportes.
3. **ReportesSection.jsx + Dashboard.jsx** — Fix botón "← Volver" del Libro IVA: nuevo estado `libroIVAOrigen` ('impuestos' | 'reportes' | null). Si viene desde Impuestos → Volver navega a Impuestos. Si viene desde Reportes → Volver queda en Reportes (comportamiento previo). `handleLibroIVABack`: cierra el libro, lee el origen, llama `onNavigate('impuestos')` si corresponde. ReportesSection ahora recibe `onNavigate={navigateTo}` desde Dashboard.

Pendientes para Luciano (sin cambios sesión 24):
- ⚠️ Período contable "Ejercicio 2026 - Enero" mal nombrado y cerrado — cubre desde 18/6/2026, asientos no se generan. Renombrar a "Junio 2026" y reabrir.
- ⚠️ Libro IVA solo muestra comprobantes con CAE — cuando se implemente AFIP revisar si debe incluir también ventas sin CAE.

Archivos modificados en sesión 24: `ReportesSection.jsx` (3 fixes navegación Libro IVA), `Dashboard.jsx` (sectionParams + navigateTo con params), `src/components/impuestos/TabIVA.jsx` (onNavigate con initialView).

**Sesión 23** — Reparada la contradicción real de la regla de Caja: auditados los 9 puntos de enforcement del sistema, encontrados 2 con comportamiento inconsistente (`CompraRapidaSection.jsx` bloqueaba TODO método de pago; `NuevaFacturaModal.jsx` no bloqueaba ninguno), ambos corregidos a "solo Efectivo bloquea" — la regla dominante y deliberada desde commit `6d645ed` (Prompt 7). CONTEXT.md y memoria persistente actualizados sin contradicciones. Además: unificadas las 2 carpetas de migrations en `supabase/migrations/` (33 archivos movidos con `git mv`, sin colisiones); verificado que la CORS whitelist dinámica SÍ está deployada en producción (no era deuda); descubierto que `mp-webhook` nunca se deployó pese a figurar como deployada.
**Sesión 22** — Deuda técnica: extraídos `useMultipago` y `useCreditoCliente` de `NuevaVentaModal.jsx` (864→804 líneas). Refactor puro, cero cambios de comportamiento — lógica de multi-pago y verificación de límite de crédito movida a hooks, mismos mensajes/orden/validaciones exactos. `PanelCarrito.jsx`/`NuevaFacturaModal.jsx` tienen modelos de pago distintos (no Set+methodAmounts) — no se forzó la reutilización ahí. `NuevaVentaModal` sigue en descomposición parcial: `useAfipIntegration` queda pendiente para sesión futura.
**Sesión 21** — Impuestos Fase B (padrón ARBA): investigación completa, **bloqueada por diseño antes de escribir código** (decisión del usuario). Hallazgo clave: el webservice oficial de ARBA (`dfe.arba.gov.ar`) requiere credencial CIT que ARBA solo emite a empresas designadas "Agente de Recaudación" — estatus que el público objetivo de KAIROX (micro PyMEs) casi nunca tiene. Sin código nuevo de Impuestos esta sesión; ver Historial para el detalle completo de la investigación y las 3 opciones evaluadas. **Además:** se cerró en paralelo el pendiente de `CompraRapidaSection.jsx` (carrito) flageado al final de sesión 20 — formato es-AR aplicado: inputs de costo unitario a `type=text inputMode=decimal`, `parseFloat`→`parseNumberLocale` (8 puntos), `.toFixed(2)`→`toLocaleString('es-AR')` en los 4 displays de total (autocomplete, total carrito, total fila, total edición).
**Sesión 20** — Formato es-AR: cierre de los 5 módulos pendientes (`ClientDetailModal`, `ListasPrecioSection`, `PlanCuentasSection`, `ProveedoresSection`, `OnboardingWizard`). 4 de 5 tenían deuda real (inputs `type="number"` y/o `parseFloat`/`.toFixed(2)` en vez de `parseNumberLocale`/`toLocaleString('es-AR')`); `OnboardingWizard` ya estaba 100% correcto. Hallazgo: `CompraRapidaSection.jsx` (carrito de Compra Rápida) **NO** estaba resuelto pese a asumirse cerrado por Document Flow — queda flageado como tarea separada.
**Sesión 19:** Unidades de Medida Parte 2: FK `productos.unidad_medida_id` (migration 045, 11/11 productos auto-mapeados), Select conectado en `ProductosSection`, 2 dropdowns hardcodeados duplicados migrados (`OrdenesCompraSection`, `CotizacionesSection`).
**Sesión 18 (Nadia) — Testeo end-to-end + 11 bug fixes UI/UX y un fix de modelo de datos. **UI/UX:** badge "Inactiva" + opacity-40 en filas de Unidades de Medida y Condiciones de Pago (ConfiguracionSection); `Dialog` Add/Edit de ClientesSection con `onOpenChange` que hace `blur()` del activeElement al cerrar (evita que el foco salte al buscador); columna "Condiciones" de la tabla Clientes prioriza nombre del maestro `condicion_pago_id` con fallback a texto libre / días; placeholder informativo "Sin condiciones activas — configurar en Finanzas" cuando no hay condiciones activas; eliminado el campo huérfano `condiciones_pago` (Textarea de texto libre) del form de Clientes — quedó solo el select del maestro; chip "Venta" de cotizaciones convertidas ahora es `<button>` que llama `onNavigateToSale(comprobante_id)` → VentasSection cambia al tab Historial con `navigateSaleId`; subtotal y total del modal de detalle de Pedido calculan sobre `cantidad_entregada × precio_unitario` y se muestra además "Total pedido" como referencia; chips de DocumentFlow del modal Pedido son clickeables y navegan a Entregas/Historial con id (EntregasSection acepta prop `navigateEntregaId` que expande y hace scroll a la fila). **Datos / RPC:** polyfill global `Buffer` en `src/main.jsx` para que `@react-pdf/renderer` no rompa en browser (instalado paquete `buffer`); preselección de cliente desde cotización ahora vive fuera del check de items y con fallback DB (cubre clientes inactivos); MapaRelaciones (`fetchMapaVenta`) ahora query `entregas` con `OR(comprobante_id, pedido_id)` cuando existe pedido, dedupea y prioriza explícitamente la entrega `origen='manual'` vinculada al pedido sobre la `implicita`; fallback de pedido derivado de `entrega.pedido_id` si el comprobante no lo trae. **Migración 044 (`crear_venta_reutilizar_entrega_manual`)** aplicada via MCP: RPC `crear_venta` recibe nuevo `p_pedido_id UUID DEFAULT NULL` (backward-compatible); si existe `entregas` con `(pedido_id, origen='manual', estado='entregado')`, la vincula al comprobante (UPDATE `comprobante_id`) y sincroniza `comprobante_items.cantidad_entregada`, evitando crear la segunda implícita; si no, comportamiento previo (crear implícita, ahora también guardando `pedido_id`). NuevaVentaModal pasa `p_pedido_id: pedido?.id ?? null`. Resultado: facturar desde un Pedido con entrega manual ya **no** duplica entregas, y el Mapa de Relaciones muestra correctamente `Pedido → Entrega manual → Factura`.
**Sesión 17:** Maestros reales: Unidades de Medida (Tab 4) + Condiciones de Pago (Tab 2) en ConfiguracionSection, con seed automático por trigger para empresas nuevas y Select conectado en ClientesSection.
**Sesiones previas:** sesión 16 (Nadia) — testeo end-to-end de Document Flow, Facturación, Modo Caja, Mercado Pago y Reportes. Fixes integrales: PDF de venta con timeout + skip de logo gigante + downscale 400×400 en upload de logo; HistorialVentas trae NDs de la tabla `notas_debito` y merge con `comprobantes`; columna FACTURA muestra "Factura B" (no electrónica) + Ticket genérico; tipo_comprobante_afip guardado SIEMPRE; fix global Radix UI (CSS body + MutationObserver en App) — congelamiento de página resuelto; setTimeout(0) en DropdownMenuItem del Historial; getDateFromInputAR usa getNowAR() si la fecha es hoy; Dashboard refetch agresivo (onMount/onFocus/30s); formatos es-AR en reportes (formatCurrency). 11 bugs de Luciano detectados/corregidos por análisis estático.
**Branch:** `master` → `origin/master` (GitHub: lbanegas96/kairox-gestion)
**Producción:** https://kairox-gestion.vercel.app

---

## ¿Qué es este proyecto?

**KAIROX Gestión** es un ERP/POS SaaS para PyMEs comerciales argentinas (ferreterías, distribuidoras, mayoristas, almacenes).

- **Mercado objetivo:** ~520K PyMEs registradas en Argentina. Segmento inicial: micro (1–3 empleados).
- **Competidores:** Xubio (50K+ clientes), Colppy (foco contable, sin POS), Tango (enterprise desde $528K/mes).
- **Stack:** React 18 + Vite + TailwindCSS + Shadcn/UI · Supabase (PostgreSQL + Auth + RLS + Edge Functions) · Context API · TanStack Query v5 · JS (JSX) + TS coexistiendo

---

## Módulos disponibles

| Módulo | Archivo principal | Estado |
|---|---|---|
| **Listas de Precios** | `ListasPrecioSection.jsx` + `listaPreciosService.ts` | ✅ CRUD listas + items por producto + asignación a cliente · **Sesión 20:** formato es-AR aplicado (input precio `type=text inputMode=decimal` + `parseNumberLocale`) |
| **Dashboard (Home)** | `DashboardSection.jsx` | ✅ **Pantalla de inicio única del sistema.** `activeSection` arranca en `'dashboard'` → `Dashboard.jsx` renderiza `<DashboardSection onNavigate={setActiveSection} />`. 8 KPIs + 2 gráficos + accesos rápidos. |
| **Ventas (shell)** | `VentasSection.jsx` | ✅ **Prompt 4/6** Tab shell: Cotizaciones · Pedidos · Entregas · Facturas · Devoluciones (real) + botón POS flotante + `initialTab` prop para nav externa |
| **Ventas (POS)** | `NuevaVentaModal.jsx` | ✅ Multi-pago + check límite crédito + Moneda Paralela + **`pedido` prop** para pre-carga desde Pedido. **Sesión 22:** descompuesto parcialmente — multi-pago y verificación de crédito ahora viven en `useMultipago`/`useCreditoCliente` (864→804 líneas). Pendiente para sesión futura: `useAfipIntegration` (emisión CAE sigue inline). |
| **`useMultipago`** | `hooks/useMultipago.js` | ✅ **Sesión 22** Extraído de `NuevaVentaModal`. Modela el Set de métodos activos + montos por método (no un array de pagos como sugería el prompt original — se respetó la forma real del código). Expone `toggleMethod` (con exclusividad de Cuenta Corriente), `construirPagosFinales()` (valida formato es-AR y que la suma cierre, devuelve `{pagos, error}`), `reset()`. |
| **`useCreditoCliente`** | `hooks/useCreditoCliente.js` | ✅ **Sesión 22** Extraído de `NuevaVentaModal`. A propósito NO usa `useQuery`/cache — `verificarLimite(clienteId, monto)` es una lectura imperativa fresca de `clientes` en cada llamada (cachear cambiaría el comportamiento real: podría dejar pasar una venta con `saldo_actual` desactualizado). Respeta `bloquear_en_limite` (bloquea vs. solo advierte), tal como el código original — el prompt no contemplaba ese campo. |
| Notas de Crédito | `NotaCreditoModal.jsx` + `notaCreditoService.ts` | ✅ Devolución parcial/total + reversión stock/CC/caja |
| Historial Ventas | `HistorialVentas.jsx` | ✅ Filtros avanzados + estado_pago CC + paginación 50/pág + **DropdownMenu por fila** (Ver detalle / Mapa relaciones / Copiar a NC / Copiar a ND / Devolver) |
| **Nueva Factura** | `ventas/NuevaFacturaModal.jsx` | ✅ **Prompt 9** Factura standalone sin descuento stock. FAC-YYYYMMDD-NNN. Multi-pago, CC→DEBE, Efectivo→movimientos_caja, AFIP+asientos fire&forget. Acepta `comprobanteOrigen` para pre-carga. |
| **Nueva NC** | `ventas/NuevaNCModal.jsx` | ✅ **Prompt 9** NC aislada NC-YYYYMMDD-NNN, tipo='nota_credito', origenLocked mode (cliente no editable), HABER en CC. |
| **Mapa de Relaciones** | `shared/MapaRelaciones.jsx` | ✅ **Prompt 9** Árbol SAP B1-style: cadena ascendente (pedido→entrega→factura) + derivados (NCs, NDs, cobros CC, devoluciones). Colores kx-* por tipo. |
| Comprobantes | `ComprobantePrintModal.jsx` | ✅ **Prompt 9** PDF Profesional: `getEmpresaParaPDF` hook, lazy TicketPDF/FacturaPDF según CAE estado. Toggle Comprobante / Remito sin precios. |
| Inventario | `ProductosSection.jsx` | ✅ Soft delete + import CSV + Análisis ABC. **Sesión 19:** Select "Unidad de Medida" conectado al maestro `unidades_medida` (FK `unidad_medida_id`), default automático a "Unidad" en alta, aviso de valor histórico no mapeado en edición. |
| **Compras (shell)** | `ComprasSection.jsx` | ✅ **Prompt 5/6** Tab shell: Órdenes de Compra · Recepciones · Facturas · Devoluciones + botón Compra Rápida + `initialTab` prop |
| **Compra Rápida** | `CompraRapidaSection.jsx` | ✅ **Prompt 5/6** Formulario POS compras + asiento auto + call no-bloqueante `crear_recepcion_implicita` RPC · **Sesión 21:** ✅ formato es-AR aplicado (flageado en sesión 20, cerrado en sesión 21) — `parseFloat`→`parseNumberLocale`, inputs costo a `type=text inputMode=decimal`, `.toFixed(2)`→`toLocaleString('es-AR')` |
| **Recepciones** | `compras/RecepcionesSection.jsx` | ✅ **Prompt 5/6** Lista recepciones (tabla `recepciones`) con expand inline ítems + filtro origen |
| **Facturas de Compra** | `compras/FacturasCompraSection.jsx` | ✅ **Prompt 5/6** Historial compras con expand inline detalle ítems |
| **Devoluciones Proveedor** | `compras/DevolucionesProveedorSection.jsx` | ✅ **Prompt 5/6** Sub-tabs: Devoluciones a Proveedor (tipo='proveedor') + Notas de Débito Recibidas |
| **GenerarRecepcionModal** | `compras/GenerarRecepcionModal.jsx` | ✅ **Prompt 5/6** Espejo de GenerarEntregaModal — llama RPC `crear_recepcion`, carga OC con items internamente |
| **ProveedorSelector** | `shared/ProveedorSelector.jsx` | ✅ **Prompt 5/6** Espejo de ClienteSelector — Select + DrillDown (CC proveedor + últimas OC) + Alta Rápida |
| Cotizaciones | `CotizacionesSection.jsx` | ✅ Funcional + convertir a venta + TC obligatorio |
| **Pedidos (OC Clientes)** | `PedidosSection.jsx` | ✅ Workflow borrador→facturado + **badges progreso entrega** + **botón Generar Entrega** (llama `crear_entrega` RPC) + **botón Facturar** (abre NuevaVentaModal pre-cargado → actualiza estado a 'facturado') |
| **Entregas** | `ventas/EntregasSection.jsx` | ✅ **NUEVO Prompt 3/6** Lista entregas con expand inline de ítems + filtro origen (POS/Manual) |
| **Generar Entrega** | `ventas/GenerarEntregaModal.jsx` | ✅ **NUEVO** Modal: tabla pendientes por item + inputs cantidad → RPC `crear_entrega` |
| **ClienteSelector** | `shared/ClienteSelector.jsx` | ✅ **NUEVO** Select + DrillDown (popover saldo CC + últimas compras) + Alta Rápida inline |
| **DocumentFlow** | `shared/DocumentFlow.jsx` | ✅ **COMPLETO Prompt 6/6** Chips: Cotización/Pedido/Entrega/Factura/Devolución/Nota Crédito/Nota Débito/OC/Recepción/Fact. Compra |
| **DocumentFlowPanel** | `ui/DocumentFlowPanel.jsx` | ✅ **COMPLETO Prompt 6/6** Cadena card SAP: origen→actual→NC→cobros CC→devoluciones. Usa `documentFlowService`. Renderizado en SaleDetailModal |
| Órdenes de Compra | `OrdenesCompraSection.jsx` | ✅ Workflow aprobación + 3-way match + realtime |
| Caja | `CajaSection.jsx` + `CajaCierre.jsx` | ✅ Arqueo por denominaciones + tab Arqueos |
| Clientes | `ClientesSection.jsx` | ✅ Form completo + limite_credito + import CSV. **Sesión 17:** select "Condición de Pago" conectado al maestro `condiciones_pago` (FK `condicion_pago_id`), sincroniza `dias_credito` automáticamente al elegir. |
| Cuenta Corriente | `CuentaCorrienteSection.jsx` | ✅ Tab Antigüedad de Deuda (FIFO 30/60/90/+90 días) |
| Detalle Cta. Cte. | `ClientDetailModal.jsx` | ✅ Open Item Management SAP-style. **Sesión 20:** input de pago rápido a formato es-AR (`type=number`→`text+inputMode=decimal`, `parseFloat`→`parseNumberLocale`), historial de movimientos `.toFixed(2)`→`toLocaleString('es-AR')` |
| Contabilidad | `PlanCuentasSection.jsx` | ✅ **Sesión 28:** 7 tabs: Plan/Asientos/Balance/**Estado de Resultados**/**Balance General**/LibroMayor/Períodos. **Sesión 20:** inputs Debe/Haber del asiento manual a formato es-AR; display ya estaba correcto (helper `fmt()` con `Intl.NumberFormat('es-AR')`) |
| **Impuestos** | `ImpuestosSection.jsx` + `impuestos/Tab*.jsx` | ✅ **NUEVO** 3 tabs: IVA (alícuota por producto + posición IVA mensual + Libros IVA) · Retenciones (sufridas/practicadas + certificado PDF) · Alícuotas (CRUD IIBB/Ganancias) |
| Proveedores | `ProveedoresSection.jsx` + `proveedoresService.ts` | ✅ Ficha completa + Cta. Cte. + Historial OC + Pago inline. **Sesión 20:** input de pago a formato es-AR. `condicion_pago`/`plazo_pago_dias` son campos propios del proveedor (texto+entero), NO usan el maestro `condiciones_pago` de Clientes — no se tocó esa lógica, solo el monto |
| Bancos | `CuentasBancariasSection.jsx` | ✅ Import CSV + conciliación auto/manual |
| **Cheques** | `ChequesSection.jsx` | ✅ **NUEVO** Cartera de terceros + propios + KPIs + historial de estados + notif vencimientos 7 días |
| **Onboarding Wizard** | `OnboardingWizard.jsx` + `ChecklistOnboarding.jsx` | ✅ **NUEVO** Wizard modal de bienvenida + checklist configuración inicial (se abre si `onboarding_completado = false`). **Sesión 20:** auditado — ya estaba 100% correcto (`precio_venta` con `inputMode=decimal`+`parseNumberLocale`, `stock_actual` entero con `parseInt`), no requirió cambios |
| Reportes | `ReportesSection.jsx` | ✅ 5 reportes + Reporte de Paridad ARS/USD + paginación 100/pág |
| **Tipo de Cambio** | `TipoCambioModal.jsx` + `tipoCambioService.js` | ✅ **NUEVO** TC diario centralizado + upsert por empresa/moneda/fecha |
| **Reporte de Paridad** | `reportes/ReporteParidad.jsx` | ✅ **NUEVO** Comparativa ARS/USD por comprobante + CSV export |
| **Modo Caja** | `caja/ModoCajaLayout.jsx` | ✅ **Prompt 10** Layout POS pantalla completa sin sidebar. Topbar minimal (logo, empresa, estado caja, turno). Activado si `user.role==='solo_caja'` OR `user.modo_caja===true`. |
| **PanelProductos** | `caja/PanelProductos.jsx` | ✅ **Prompt 10** Grid buscador con `autoFocus`, stock badges (ok=verde / bajo=ámbar / sin_stock=rojo deshabilitado). |
| **AlertasStockBanner** | `caja/AlertasStockBanner.jsx` | ✅ **Prompt 10** Banner colapsable ámbar para stock bajo. Botón "Avisar" → inserta en `audit_log` tipo `aviso_cajero_stock` (no existe tabla notificaciones). |
| **PanelCarrito** | `caja/PanelCarrito.jsx` | ✅ **Prompt 10** Carrito + 4 métodos pago + confirmar venta vía `useConfirmarVenta` hook. |
| **HistorialTurnoModal** | `caja/HistorialTurnoModal.jsx` | ✅ **Prompt 10** KPIs turno + tabla ventas filtrada por cajero y apertura_fecha. |
| **useConfirmarVenta** | `hooks/useConfirmarVenta.js` | ✅ **Prompt 10** Hook que encapsula `crear_venta` RPC (ARS only) + asientos contables fire&forget. |
| Usuarios | `UsuariosSection.jsx` | ✅ Invitación + último acceso + activar/desactivar + preset Solo Caja + **toggle Modo Caja** por usuario staff |
| **NuevaFacturaProveedorModal** | `compras/NuevaFacturaProveedorModal.jsx` | ✅ **Prompt 11** Factura proveedor standalone. ProveedorSelector + ítems (PROD→`detalle_compras`, SERV→`observaciones`). Pago: Efectivo/Transferencia/CC Proveedor. CC→`cuenta_corriente_proveedores` HABER. Sin AFIP. |
| **NuevaNCProveedorModal** | `compras/NuevaNCProveedorModal.jsx` | ✅ **Prompt 11** NC financiera de proveedor (sin stock). INSERT en `cuenta_corriente_proveedores` DEBE (reduce deuda). Opción reembolso efectivo. NuevaDevolucionProveedorModal cubre el caso físico. |
| **NuevaNDProveedorModal** | `compras/NuevaNDProveedorModal.jsx` | ✅ **Prompt 11** ND recibida de proveedor (nos cobra más). Llama RPC `crear_nota_debito(tipo='recibida')` + INSERT manual `cuenta_corriente_proveedores` HABER (el RPC no inserta CC para 'recibida'). |
| **FacturasCompraSection** | `compras/FacturasCompraSection.jsx` | ✅ **Prompt 11** + DropdownMenu por fila (Ver detalle / NC / ND / Devolver / Mapa) + botón "Nueva Factura de Proveedor" + todos los modales integrados. |
| **MapaRelaciones** | `shared/MapaRelaciones.jsx` | ✅ **Prompt 11** Extendido con prop `compraId`. Modo compra: Recepción→FacturaCompra→PagosCC + derivados (Dev.Prov / NC financiera / ND recibida). Modo venta intacto. |
| **Configuración** | `ConfiguracionSection.jsx` | ✅ **Prompt 14** 8 tabs SAP Administración-style. **Prompt 15:** Tab 5 Integraciones — card Mercado Pago con estado real, webhook URL con botón copiar, último sync; abre `ConfigMercadoPagoModal`. **Sesión 17:** Tab 4 (Inventario) — CRUD real de Unidades de Medida (tabla `unidades_medida`, sin hard delete, solo `activo=false`). Tab 2 (Finanzas) — CRUD real de Condiciones de Pago (tabla `condiciones_pago`: nombre, días, descuento %). "Método de Valoración de Stock" y "Stock Mínimo Global" siguen como placeholder (fuera de scope). |
| `IntegracionCard` | `shared/IntegracionCard.jsx` | ✅ **Prompt 14** Card reutilizable para integraciones: nombre, descripción, logo emoji, estado (activo/inactivo/proximamente/error), botón "Configurar" opcional con `onConfigure` callback. |
| **Mercado Pago Webhook** | `supabase/functions/mp-webhook/index.ts` | ✅ **Prompt 15** Edge Function `--no-verify-jwt`. Valida firma HMAC-SHA256 (x-signature), consulta `GET /v1/payments/{id}`, solo procesa `status=approved`, deduplicación por `descripcion LIKE 'MP #ID%'`, llama RPC `insertar_movimiento_bancario_externo`, actualiza `ultimo_sync`. Deploy: `supabase functions deploy mp-webhook --no-verify-jwt`. URL: `{SUPABASE_URL}/functions/v1/mp-webhook?empresa_id=EMPRESA_UUID` |
| **ConfigMercadoPagoModal** | `bancos/ConfigMercadoPagoModal.jsx` | ✅ **Prompt 15** Modal configuración MP: Access Token (valida formato APP_USR- + GET /users/me), select cuenta bancaria destino, webhook secret opcional. Pasos de instrucciones inline. URL webhook con botón copiar. Upsert en `integraciones_bancarias` con `onConflict: 'empresa_id,proveedor'`. |

---

## Migraciones aplicadas en Supabase

| Archivo | Contenido | Estado |
|---|---|---|
| `schema.sql` | Schema base completo + RLS + triggers | ✅ |
| `supabase/migrations/001_audit_log.sql` | Tabla audit_log + fn_audit_trigger | ✅ |
| `supabase/migrations/002_cotizaciones.sql` | Cotizaciones + cotizacion_items | ✅ |
| `supabase/migrations/003_ordenes_compra.sql` | Órdenes de compra + items | ✅ |
| `supabase/migrations/004_plan_cuentas.sql` | Plan cuentas + asientos + seed | ✅ |
| `supabase/migrations/005_configuracion_rls_fix.sql` | Fix RLS tabla configuracion | ✅ |
| `supabase/migrations/009_cajas.sql` | Tabla cajas + FK caja_sesiones | ✅ |
| `supabase/migrations/010_drop_ventas_legacy.sql` | Backup + DROP ventas legacy | ✅ |
| `supabase/migrations/011_cuentas_bancarias.sql` | Cuentas bancarias + movimientos | ✅ |
| `supabase/migrations/012_facturas_proveedor.sql` | 3-way match OC | ✅ |
| `supabase/migrations/013_multi_moneda.sql` | Tabla tipos_cambio + columnas tipo_cambio_tasa | ✅ |
| `supabase/migrations/014_proveedores.sql` | Ficha completa proveedores + cuenta_corriente_proveedores | ✅ |
| `supabase/migrations/015_conciliacion_bancaria.sql` | extractos_bancarios + extracto_lineas + trigger sync | ✅ |
| `supabase/migrations/016_security_hardening.sql` | is_admin() + RLS config + rate_limit + audit triggers | ✅ |
| `supabase/migrations/017_multi_pago.sql` | Tabla comprobante_pagos + RLS + índices | ✅ |
| `supabase/migrations/018_condicion_pago.sql` | condicion_pago + dias_credito en clientes | ✅ |
| `supabase/migrations/019_pedidos.sql` | pedidos + pedido_items + RLS + audit trigger | ✅ |
| `supabase/migrations/020_notas_credito.sql` | tipo + estado_pago + comprobante_origen_id + motivo_nc en comprobantes | ✅ |
| `supabase/migrations/021_listas_precio.sql` | listas_precio + lista_precio_items + lista_precio_id en clientes + cotizacion_id/pedido_id en comprobantes | ✅ |
| **`create_tipos_cambio`** (SQL directo) | Tabla `tipos_cambio` — UNIQUE(empresa_id, moneda, fecha) + RLS via get_my_empresa_id() + índice | ✅ |
| **`add_moneda_paralela`** (SQL directo) | Columnas `usa_tc_paralelo`/`moneda_paralela` en empresas + `monto_paralelo`/`tc_paralelo` en comprobantes, movimientos_caja, cuenta_corriente_movimientos, compras | ✅ |
| **`supabase/migrations/022_rpc_decrement_stock.sql`** | RPC `decrement_stock(p_producto_id, p_cantidad)` — UPDATE atómico con check stock ≥ 0, SECURITY DEFINER | ✅ Aplicada via MCP |
| **`supabase/migrations/023_indices_faltantes.sql`** | 4 índices: `idx_comprobantes_estado_pago`, `idx_comprobantes_fecha`, `idx_cta_cte_empresa_cliente_tipo`, `idx_mov_inv_fecha` | ✅ Aplicada via MCP |
| **`supabase/migrations/024_rpc_crear_venta.sql`** | RPC `crear_venta` — venta transaccional atómica (comprobante + items + stock FOR UPDATE + mov_inventario + mov_caja + CC) con rollback automático, SECURITY DEFINER | ✅ Aplicada via MCP |
| **`supabase/migrations/025_afip_infraestructura.sql`** | AFIP Fase 1: columnas fiscales en `empresas` + `clientes.condicion_iva` + tabla `puntos_venta` (RLS) + columnas CAE en `comprobantes` + wrappers Vault `vault_secret_upsert`/`vault_secret_read` (SECURITY DEFINER, solo service_role) | ✅ Aplicada via MCP |
| **`supabase/migrations/026_onboarding.sql`** | Columna `onboarding_completado` en `empresas` + lógica de wizard de bienvenida | ✅ Aplicada |
| **`supabase/migrations/027_cierre_periodos.sql`** | Tabla `periodos_contables` (admin create/close) + RPC `fecha_en_periodo_cerrado(empresa_id, fecha DATE) RETURNS BOOLEAN` SECURITY DEFINER STABLE | ✅ Aplicada via MCP |
| **`supabase/migrations/028_cheques.sql`** | Tablas `cheques` + `cheques_historial` + RLS por `get_my_empresa_id()` + 3 índices (tipo, estado, vencimiento parcial) | ✅ Aplicada via MCP |
| **`supabase/migrations/029_fix_tenant_id_fkeys.sql`** | Fix FK: `comprobantes.tenant_id`, `caja_sesiones.tenant_id`, `movimientos_inventario.tenant_id` apuntaban a `profiles(id)` — ahora apuntan a `empresas(id)`. DROP constraints → UPDATE data → ADD constraints | ✅ Aplicada via MCP |
| **`030_compras_add_moneda`** (MCP) | `ALTER TABLE compras ADD COLUMN moneda text NOT NULL DEFAULT 'ARS'` + NOTIFY pgrst | ✅ Aplicada via MCP |
| **`031_compras_add_tipo_cambio_tasa`** (MCP) | `ALTER TABLE compras ADD COLUMN tipo_cambio_tasa numeric NOT NULL DEFAULT 1` + NOTIFY pgrst | ✅ Aplicada via MCP |
| **`supabase/migrations/032_impuestos_infraestructura.sql`** | IVA real: `alicuota_iva` en `productos`/`comprobante_items`/`detalle_compras` (CHECK 21/10.5/0/exento/no_gravado) + `neto_gravado`/`iva_discriminado` en `comprobantes` y `compras` + tabla `alicuotas_impuestos` (RLS, índice) | ✅ Aplicada via MCP |
| **`supabase/migrations/033_crear_venta_iva.sql`** | RPC `crear_venta` recalcula `neto_gravado`/`iva_discriminado` por ítem según su `alicuota_iva` (snapshot), fallback 21%. Copia íntegra de la lógica de 024 + cálculo IVA | ✅ Aplicada via MCP |
| **`supabase/migrations/034_retenciones.sql`** | Tabla `retenciones` (sufrida/practicada, IIBB/Ganancias/SUSS/IVA/Otro, trazabilidad a comprobante/compra) + RLS + índice + vista `retenciones_acumulado_mensual` (security_invoker) | ✅ Aplicada via MCP |
| **`supabase/migrations/035_document_flow_modelo_datos.sql`** | Document Flow Prompt 1/6 — contadores en items existentes (`cantidad_entregada`, `cantidad_devuelta`, `cantidad_facturada`, `cantidad_recibida`); tablas `entregas`+`entrega_items`, `recepciones`+`recepcion_items`, `devoluciones`+`devolucion_items`, `notas_debito`; función `siguiente_numero_documento(empresa_id, tabla, columna, prefijo)` SECURITY DEFINER | ✅ Aplicada via MCP |
| **`supabase/migrations/036_document_flow_rpcs.sql`** | Document Flow Prompt 2/6 — `crear_venta` actualizada (+ entrega implícita `ENT-YYYY-NNNN` al final de cada POS); `crear_entrega` (camino largo desde Pedido, descuenta stock); `crear_recepcion` (camino largo desde OC, suma stock); `crear_recepcion_implicita` (compras directas, solo documental, NO toca stock); `crear_factura_desde_entrega` (factura desde entrega existente, sin stock) | ✅ Aplicada via MCP |
| **`037_movimientos_inventario_add_user_id`** (MCP) | `ALTER TABLE movimientos_inventario ADD COLUMN user_id uuid REFERENCES profiles(id)` + NOTIFY pgrst — necesario para el RPC `crear_devolucion` de Luciano | ✅ Aplicada via MCP |
| **`038_movimientos_inventario_tipo_check_extend`** (MCP) | Drop + recrear `movimientos_inventario_tipo_check` aceptando `['entrada','salida','ajuste','ingreso','egreso']` — sinónimos para compatibilidad con RPCs nuevos y viejos | ✅ Aplicada via MCP |
| **`supabase/migrations/037_devoluciones_nd_rpcs.sql`** | Prompt 4/6 — `ALTER cuenta_corriente_movimientos`: `cliente_id` nullable + `proveedor_id` FK. RPC `crear_devolucion(empresa_id, user_id, tipo, items, ...)` → devoluciones + devolucion_items + NC opcional en comprobantes + CC movimiento + stock (ingreso si reingresa_stock) + caja (egreso si reembolso_efectivo). RPC `crear_nota_debito(empresa_id, user_id, tipo, concepto, monto, ...)` → notas_debito + CC movimiento DEBE. Correlativo DEV-YYYY-NNNN / NC-YYYY-NNNN / ND-YYYY-NNNN vía `siguiente_numero_documento`. SECURITY DEFINER + GRANT authenticated | ✅ Aplicada via MCP |
| **`supabase/migrations/039_modo_caja.sql`** | Prompt 10 — `ADD COLUMN IF NOT EXISTS modo_caja BOOLEAN NOT NULL DEFAULT false` en `profiles` + índice parcial `idx_profiles_modo_caja(empresa_id, modo_caja) WHERE modo_caja = true` | ✅ Aplicada via MCP |

### Migrations retroactivas (documentación de SQL directo)

| Archivo | Contenido | Estado |
|---|---|---|
| **`supabase/migrations/040_retroactive_tipos_cambio.sql`** | Tabla `tipos_cambio` (`id` gen_random_uuid, `moneda` DEFAULT 'USD', UNIQUE empresa+moneda+fecha) + 2 índices + 2 policies RLS (`tc_all`, `tipos_cambio_empresa_all`) + `trg_audit_tipos_cambio` | ✅ Solo documental |
| **`supabase/migrations/041_retroactive_moneda_paralela.sql`** | `empresas`: `usa_tc_paralelo`/`moneda_paralela`. `comprobantes`: `estado_pago`/`monto_paralelo`/`tc_paralelo`/`comprobante_origen_id`. `movimientos_caja` + `compras`: `monto_paralelo`/`tc_paralelo`. `cuenta_corriente_movimientos`: `comprobante_id`/`metodo_cobro`/`monto_paralelo`/`tc_paralelo` | ✅ Solo documental |
| **`supabase/migrations/042_retroactive_audit_y_triggers.sql`** | `fn_audit_trigger` (migrada de `row_to_json` → `to_jsonb`) + `fn_update_cliente_saldo` + trigger `trg_update_cliente_saldo` en `cuenta_corriente_movimientos` + vista `v_saldo_proveedores` | ✅ Solo documental |
| **`supabase/migrations/043_maestros_unidades_condiciones_pago.sql`** | Tablas `unidades_medida` + `condiciones_pago` (RLS por empresa) + FK `clientes.condicion_pago_id` + función `seed_maestros_default(empresa_id)` (mismo patrón que `seed_plan_cuentas`) + trigger nuevo `trg_empresa_seed_maestros` en `empresas` (AFTER INSERT, independiente de `trg_empresa_caja_principal`) + seed retroactivo a las 3 empresas existentes | ✅ Aplicada via MCP |
| **`supabase/migrations/044_crear_venta_reutilizar_entrega_manual.sql`** | RPC `crear_venta` recibe `p_pedido_id UUID DEFAULT NULL`. Si hay entrega `origen='manual', estado='entregado'` para ese pedido, la vincula al nuevo comprobante en vez de crear una implícita duplicada; sincroniza `comprobante_items.cantidad_entregada`. Si no, crea implícita (ahora también con `pedido_id`). Elimina la duplicación POS+Pedido visible en EntregasSection y MapaRelaciones. | ✅ Aplicada via MCP |
| **`supabase/migrations/045_unidades_medida_productos.sql`** | FK `productos.unidad_medida_id` → `unidades_medida.id` (ON DELETE SET NULL) + mapeo automático por `LOWER(TRIM(unidad_medida)) = LOWER(codigo\|descripcion)`. Resultado real: 11/11 productos auto-mapeados, 0 sin mapear. | ✅ Aplicada via MCP |
| **`supabase/migrations/046_fecha_vencimiento_comprobantes.sql`** | `comprobantes.fecha_vencimiento DATE` nullable. No confundir con `cae_vencimiento` (AFIP). Históricos quedan en `NULL`, sin backfill retroactivo. | ✅ Aplicada via MCP |
| **`supabase/migrations/047_crear_venta_fecha_vencimiento.sql`** | RPC `crear_venta`: nuevo `SELECT dias_credito FROM clientes` + `v_fecha_vencimiento := p_fecha::date + COALESCE(dias_credito, 0)` + `SET fecha_vencimiento` en el INSERT de `comprobantes` ya existente. Aditivo, cubre POS y Modo Caja sin tocarlos. | ✅ Aplicada via MCP |

---

## Infraestructura

- **Supabase URL:** `https://wuznppxeonmhfcvnqfbf.supabase.co`
- **Supabase Project ID:** `wuznppxeonmhfcvnqfbf` (org: NALUX)
- **SMTP:** Resend.com — `smtp.resend.com:465` · user: `resend` · sender: KAIROX Gestión ✅
- **Edge Functions deployadas (verificado via MCP, Sesión 23):** `create-user` (v3) · `delete-user` (v2) · `invite-user` (v3) · `generar-csr` (v2) · `emitir-cae` (v2) — todas `ACTIVE`. **⚠️ `mp-webhook` NO está deployada** (existe el código en `supabase/functions/mp-webhook/` desde Prompt 15, pero nunca se corrió `supabase functions deploy mp-webhook --no-verify-jwt` — confirmado que no aparece en `list_edge_functions`). La integración Mercado Pago no es funcional en producción hasta que se deploye.
- **CORS whitelist dinámica:** ✅ implementada y **deployada en producción** (`supabase/functions/_shared/auth.ts` → `buildCorsHeaders(req)`, consumida por las 5 funciones de arriba; verificado Sesión 23 que el código deployado en `create-user` es idéntico byte a byte al del repo). No es una Edge Function separada — es código compartido importado por las demás. `mp-webhook` no la usa porque es un webhook server-to-server (MP→KAIROX), no una llamada desde el browser; CORS no aplica ahí.
- **Supabase Vault:** extensión `supabase_vault` 0.3.1 activa. Secretos AFIP por empresa: `afip_key_<empresa_id>` (clave privada, generada en `generar-csr` acción `generate`) y `afip_cert_<empresa_id>` (certificado .crt, subido vía `generar-csr` acción `store_cert`). Acceso solo vía RPC `vault_secret_upsert`/`vault_secret_read` (service_role).
- **Timezone:** Argentina (UTC-3) — helpers en `src/lib/dateUtils.js`
- **Multi-tenancy:** RLS via `get_my_empresa_id()` + `empresa_id` en todas las tablas
- **Logo:** Base64 en tabla `configuracion` (clave `logo_base64`)
- **Roles:** `admin` (acceso total) | `staff` (permisos granulares en `profiles.permissions` JSONB) | `solo_caja` (solo Ventas + Caja)
- **GitHub:** `https://github.com/lbanegas96/kairox-gestion` (branch: master)

---

## Convenciones (REGLAS DE ORO)

- **REGLA DE ORO — KAIROX:** Toda configuración vive en `ConfiguracionSection`. Los módulos operativos (Ventas, Compras, Bancos, Caja, Inventario) solo muestran y procesan datos. **Nunca contienen opciones de configuración del sistema.** Si hay algo configurable → va a un tab de `ConfiguracionSection`.
- **Multi-tenant:** TODAS las queries deben filtrar `.eq('empresa_id', user.empresa_id)`. Nunca `user_id` para filtrar (solo para INSERTs como autor).
- **INSERTs:** siempre incluir `empresa_id: user.empresa_id` + `user_id: user.id`.
- **Timezone:** usar siempre `getNowAR()` / `formatDateAR()` / `formatDateTimeAR()` de `dateUtils.js`. Nunca `toLocaleString()`.
- **Clientes activos:** todas las queries de selección incluyen `.neq('activo', false)`.
- **TanStack Query v5:** `onSuccess` en `useQuery` no existe. Usar `useEffect`.
- **RLS en tablas nuevas:** `ENABLE ROW LEVEL SECURITY` + policy `get_my_empresa_id()` + audit trigger + `DROP POLICY IF EXISTS` antes de `CREATE POLICY`.
- **Radix UI Dialogs:** nunca `if (!open) return null` — dejar que Radix maneje show/hide con prop `open`.
- **Caja:** solo cobros/movimientos en Efectivo requieren caja abierta. Transferencia/Tarjeta/Cheque/CC no. **Regla única y definitiva — auditada y unificada en Sesión 23** en los 9 puntos de enforcement del sistema (antes había 2 excepciones reales: `CompraRapidaSection.jsx` bloqueaba todo, `NuevaFacturaModal.jsx` no bloqueaba nada — ambas corregidas). Ver Historial sesión 23 para el detalle completo, incluyendo por qué el CONTEXT.md tuvo dos secciones contradictorias por un tiempo.
- **Open Items:** al cobrar CC, siempre referenciar `comprobante_id` en el movimiento HABER.
- **Migrations:** siempre idempotentes — `IF NOT EXISTS`, `DROP POLICY/TRIGGER IF EXISTS`, `CREATE OR REPLACE`.
- **Vistas:** siempre `WITH (security_invoker = true)` para respetar RLS del usuario.
- **Multi-pago:** al confirmar venta, insertar en `comprobante_pagos` + `movimientos_caja` por cada pago no-CC + `cuenta_corriente_movimientos` para suma CC.
- **Límite de crédito:** verificar `saldo_actual + montoCC > limite_credito` antes de confirmar venta CC (cuando limite > 0).
- **`comprobante_items` columnas:** usa `producto_id` (español) y `cantidad` — ⚠️ CONTEXT.md anterior decía `produto_id`/`quantidade` (portugués) pero estaba INCORRECTO. Verificado con `information_schema.columns` en Prompt 2/6 — la columna real es `producto_id`. Usar siempre el nombre español.
- **Notas de crédito:** al crear NC, insertar en `comprobante_items` con `producto_id`. Revertir stock vía `movimientos_inventario` + RPC `increment_stock`.
- **Portales:** las secciones `portal_ventas`, `portal_compras`, `portal_finanzas`, `portal_inventario` son entry points — no van en ALL_SECTIONS de permisos.
- **Lista de precios:** `listaPreciosService.getPrecioMapForCliente(clienteId)` retorna `{producto_id: precio}`. En `NuevaVentaModal`, llamar en `handleSelectClient()`. Items con precio de lista tienen `_precioLista: true` para el badge.
- **Document Flow:** `documentFlowService.getFlowForComprobante(id)` retorna nodos origen/actual/NC/cobros. Usar `DocumentFlowPanel` pasando `comprobanteId` + `onNavigate`.
- **Notificaciones:** `useNotifications()` retorna `{items, count, stockBajo, deudaVencida, ocPendientes, cajaSinCerrar, hasNotifications}`. Bug histórico `user_id→empresa_id` ya corregido.
- **TC del día (fecha local):** usar `getTodayAR()` de `dateUtils.js` para formato `YYYY-MM-DD` en hora Argentina (NO `toISOString().slice(0,10)` que da UTC y puede desfasar en UTC-3).
- **AR-local-as-UTC:** el sistema almacena timestamps como "AR-local-as-UTC" — medianoche AR = `T00:00:00Z`, NO `T03:00:00Z`. Para filtros TIMESTAMPTZ usar `getNowAR().getTime()`, nunca `Date.now()`. Para construir ISO de inicio/fin de día usar `` `${date}T00:00:00.000Z` ``, nunca `new Date(\`${date}T00:00:00\`).toISOString()` (agrega tz del browser).
- **DATE vs TIMESTAMPTZ:** columnas `fecha` en `tipos_cambio`, `asientos_contables`, `extracto_lineas`, `extractos_bancarios`, `facturas_proveedor`, `pedidos.fecha_entrega` son DATE → reciben YYYY-MM-DD. El resto (`movimientos_caja.fecha`, `comprobantes.fecha`, `caja_sesiones.apertura_fecha`, etc.) son TIMESTAMPTZ → reciben ISO completo alineado con AR-local-as-UTC.
- **TC upsert:** tabla `tipos_cambio` con UNIQUE(empresa_id, moneda, fecha). Siempre `upsert` con `onConflict: 'empresa_id,moneda,fecha'` — nunca insert directo.
- **PGRST116:** el código de error Supabase "no rows returned" (`.single()` sin match) es ESPERADO cuando no hay TC del día — NO es un error real. Verificar `error.code !== 'PGRST116'` antes de `throw`.
- **Moneda Paralela:** cuando `empresa.usa_tc_paralelo = true`, todas las transacciones deben guardar `monto_paralelo` + `tc_paralelo`. Usar `useTCParalelo()` hook. Si `tcMissing = true` → bloquear operación y abrir `TipoCambioModal`.
- **TC sync en NuevaVentaModal:** cuando `moneda === monedaParalela`, el `tipoCambioTasa` del MonedaSelector se sincroniza automáticamente con `tcParalelo.setTC()` vía useEffect.
- **Supabase client lazy:** `customSupabaseClient.js` exporta un getter lazy para evitar TDZ (Temporal Dead Zone) en el bundle de producción. Nunca instanciar Supabase en el top-level de un módulo con `BroadcastChannel`.
- **PostgREST embedded select:** la sintaxis `.select('*, tabla_relacionada(cols)')` SOLO funciona si existe una FK explícita (`REFERENCES`) en PostgreSQL. Sin FK → 400 Bad Request. Si la FK no existe (o no se puede agregar), usar consulta en dos pasos: query principal → `.in('id', ids)` en tabla relacionada → merge manual en JS.
- **Dashboard KPIs:** `dashboardService.ts` filtra SIEMPRE con `.eq('empresa_id', empresaId)`. Nunca `user_id` para queries de lectura.
- **VentasSection navigation (Prompt 3/6):** todos los ítems del sidebar VENTAS (`ventas`, `cotizaciones`, `pedidos`, `entregas`, `historial_ventas`) renderizan `<VentasSection initialTab="...">` via Dashboard. El componente usa `key={activeSection}` heredado del shell → re-monta en cada navegación, respetando `initialTab`.
- **Document Flow RPCs — tipos de cantidad:** `pedido_items.cantidad` es NUMERIC; `movimientos_inventario.cantidad` es INTEGER. En `crear_entrega` la variable `v_cantidad` es NUMERIC; castear a INTEGER al actualizar stock: `stock_actual - v_cantidad::INTEGER`.
- **Document Flow — entrega implícita:** toda venta POS (`crear_venta` RPC) genera automáticamente una fila en `entregas` con `origen='implicita'` + sus `entrega_items`. Esto permite que EntregasSection muestre el historial completo (POS + manuales).
- **NuevaVentaModal prop `pedido`:** acepta `pedido` (con `pedido_items[]`, `cliente_id`). Si se provee, pre-carga carrito idéntico al flujo `cotizacion`. Usar desde PedidosSection al "Facturar" → en `onSaleSuccess`, actualizar `pedidos.estado = 'facturado'` y refrescar.
- **Sidebar colapsable:** estado en `localStorage('kx-sidebar-collapsed')` como `{VENTAS: true, COMPRAS: false, ...}`. `true` = colapsado. Default: todos expandidos. Toggle hace click en el label del grupo.
- **⚠️ `clientes` tiene DOS columnas de texto parecidas — no confundir:** `condiciones_pago` (plural, TEXT, Textarea de notas libres tipo "Pago a 30 días, 5% desc.", **en uso activo** en `ClientesSection.jsx`) y `condicion_pago` (singular, TEXT, **columna huérfana sin ninguna referencia en código**, verificado con grep sobre todo `src/`). Sesión 17 agregó además `condicion_pago_id` (UUID, FK a la nueva tabla `condiciones_pago` maestro) — un tercer campo, distinto de los dos anteriores. El Select de "Condición de Pago" en `ClientesSection.jsx` solo escribe `condicion_pago_id` + sincroniza `dias_credito`; no toca ni `condiciones_pago` (notas libres del usuario) ni el huérfano `condicion_pago`.
- **Seed de maestros NO es uniforme entre módulos:** `seed_plan_cuentas` (plan de cuentas) es **manual** — botón "Inicializar" en `PlanCuentasSection` → `planCuentasService.seedCuentas()`. No hay ningún trigger que lo dispare al crear una empresa. En cambio, `seed_maestros_default` (unidades de medida + condiciones de pago, sesión 17) **sí es automático** vía trigger `trg_empresa_seed_maestros` (AFTER INSERT en `empresas`, independiente de `trg_empresa_caja_principal`). Si se agrega un maestro nuevo, decidir explícitamente si su seed debe ser manual o automático — no asumir que sigue el patrón de plan de cuentas por defecto.
- **Carpeta única de migrations: `supabase/migrations/`.** Unificada en Sesión 23 — los 33 archivos que vivían en `migrations/` (top-level) se movieron ahí con `git mv` (preserva historial de git, sin renumerar ninguno). No había colisión de números entre ambas carpetas (`migrations/` tenía 001-036+044, `supabase/migrations/` tenía 039-043+045) así que la unificación fue directa. `migrations/` ya no existe. Antes de crear una migration nueva, el próximo número es simplemente el más alto en `supabase/migrations/`.
- **Dropdowns de unidad de medida — antes de sesión 19 había 3 copias hardcodeadas distintas, no una sola fuente:** `ProductosSection.jsx`, `OrdenesCompraSection.jsx` y `CotizacionesSection.jsx` tenían cada uno su propia lista de 11 `<option>` escritos a mano (idénticos entre sí pero NO importados de `src/lib/unidadesMedida.js` — ese archivo nunca tuvo ningún import real en todo el código, verificado con grep). Las 3 fueron migradas en sesión 19 para leer de la tabla `unidades_medida`. `src/lib/unidadesMedida.js` se mantiene en el repo sin uso activo (solo referencia histórica) — no eliminar, pero no agregarle nuevos consumidores.

---

## Arquitectura de navegación (v3 — Sidebar flat con 7 grupos)

El rediseño v3 (2026-06-12) reemplazó el Launchpad Fiori + Portales por una navegación directa en sidebar:

```
Sidebar 7 grupos:
├── GENERAL       → dashboard, reportes
├── VENTAS        → ventas (POS), cotizaciones, pedidos, entregas, historial_ventas, clientes, cuentacorriente, listas_precio
├── COMPRAS       → compra_rapida, ordenes_compra, recepciones_compra, facturas_compra, devoluciones_proveedor, proveedores
├── INVENTARIO    → productos
├── FINANZAS      → caja (con status dot abierta/cerrada), bancos, cheques
├── CONTABILIDAD  → plan_cuentas, impuestos
└── ADMINISTRACIÓN→ configuracion  ← usuarios removido del sidebar (ahora en Tab 7 de Configuración)
```

- **Sidebar:** `src/components/Sidebar.jsx` — array `NAV_GROUPS` con grupos + íconos, `fixed md:relative`, `bg-kx-surface/80 backdrop-blur-md`. **Prompt 3/6:** grupos colapsables + persistencia en `localStorage('kx-sidebar-collapsed')`. **Prompt 5/6:** grupo COMPRAS reorganizado: `compra_rapida` (ShoppingCart) · `ordenes_compra` (ShoppingBag) · `recepciones_compra` (Package) · `facturas_compra` (Receipt) · `devoluciones_proveedor` (RotateCcw) · `proveedores` (Truck). Todos los ítems COMPRAS → `<ComprasSection initialTab="...">` via Dashboard.
- **Header:** `src/components/Header.jsx` — h-14, breadcrumb `empresa · sección`, búsqueda (⌘K), toggle tema, Bell notificaciones, CTA "Nueva Venta", Avatar dropdown.
- **Shell:** `src/components/Dashboard.jsx` — flex layout, `AuroraBackground` fixed z-10, no más `ml-{x}`.
- **Launchpad/Portales — NUNCA llegaron a producción:** el feature "Launchpad Fiori + 4 Portales" (`LaunchpadSection.jsx`, `portals/*.jsx`, `portalService.ts`, commit `d2d50fb`) se desarrolló íntegramente dentro de un worktree aislado de un agente (`.claude/worktrees/...`) y nunca se mergeó a la ruta real `src/`. Auditado en sesión 16 (Prompt auditoría Launchpad): cero referencias a `LaunchpadSection`, `portals/`, `portalService` o `portal_ventas/compras/finanzas/inventario` en todo `src/`. **`DashboardSection.jsx` es y fue siempre la única pantalla de inicio real** — no hay ambigüedad ni migración pendiente entre Launchpad y Dashboard.

---

## Sistema TC del día centralizado (SAP-style)

### Arquitectura
- **Tabla:** `tipos_cambio` — columnas: `empresa_id`, `moneda`, `fecha` (YYYY-MM-DD), `tasa`, `user_id`, `updated_at`
- **Constraint:** `UNIQUE(empresa_id, moneda, fecha)` — un solo TC por empresa/moneda/día
- **Servicio:** `src/services/tipoCambioService.js`
  - `getTodayTC(empresaId, moneda)` — busca TC de HOY (hora local Argentina)
  - `upsertTC(empresaId, userId, moneda, tasa)` — crea o actualiza el TC del día
- **Modal:** `src/components/ui/TipoCambioModal.jsx` — se abre automáticamente si falta TC. Props: `open`, `onOpenChange`, `moneda`, `onConfirm(tasa)`.
- **MonedaSelector:** al cambiar moneda, auto-fetcha TC desde DB. Badge verde ✅ si encontrado, badge ámbar ⚠️ + "Cargar ahora" si falta. Prop `onTCMissingChange(bool)` para que el padre bloquee submit.

### Flujo obligatorio
1. Usuario selecciona moneda extranjera → MonedaSelector busca TC en DB
2. Si TC existe → auto-rellena campo tasa (editable)
3. Si TC falta → badge ámbar + botón "Cargar ahora" → abre TipoCambioModal → guarda + continúa
4. Si usuario intenta confirmar sin TC → toast de error + submit bloqueado

---

## Sistema Moneda Paralela (SAP Parallel Currency)

### Configuración
- **Toggle en Configuración:** `empresa.usa_tc_paralelo` (bool) + `empresa.moneda_paralela` ('USD' | 'EUR' | 'BRL')
- **Card en ConfiguracionSection:** Switch on/off + Select moneda + 3 info chips cuando activo

### Hook `useTCParalelo()` — `src/hooks/useTCParalelo.js`
```js
const { enabled, monedaParalela, tcHoy, tcMissing, loading, calcParalelo, setTC } = useTCParalelo();
// tcMissing = enabled && settingsReady && !loading && tcHoy === null
// calcParalelo(monto, monedaOp, tasaOp) → monto en moneda paralela | null
```

### Cobertura de módulos
Cuando `enabled = true`, los siguientes módulos guardan `monto_paralelo` + `tc_paralelo`:
- **Ventas (NuevaVentaModal):** banner naranja si TC ARS→USD falta; badge verde si cargado
- **Cotizaciones:** bloqueo TC si moneda extranjera
- **Caja (`CajaSection`):** ✅ KPIs Ingresos/Egresos/Saldo muestran equivalente; tabla separada columna moneda paralela con fallback calcParalelo(); INSERT guarda monto_paralelo+tc_paralelo
- **Cuenta Corriente (`CuentaCorrienteSection`):** ✅ KPI Total Deuda, tabla clientes, dialog cobro (deuda + monto siendo cobrado); aging bandas con equivalente; INSERT CC y movimientos_caja guardan monto_paralelo+tc_paralelo
- **Compras (`CompraRapidaSection`, `NuevaFacturaProveedorModal`, `FacturasCompraSection`):** ✅ Sesión 27 — banner de paridad en los 2 formularios de carga, columna con fallback calcParalelo() en los 2 listados, INSERT a `compras` y `movimientos_caja` guardan monto_paralelo+tc_paralelo. `OrdenesCompraSection` queda afuera a propósito (no inserta en esas tablas).

### Reporte de Paridad — `src/components/reportes/ReporteParidad.jsx`
- Filtro por rango de fechas
- 4 KPIs: Total ARS · Total USD equiv. · TC promedio ponderado · Cobertura %
- Tabla: Nro | Fecha | Cliente | Forma Pago | Estado | Total ARS | TC | Equiv. USD
- Cálculo retroactivo para comprobantes sin `monto_paralelo` (usa histórico de `tipos_cambio`)
- Export CSV con BOM para Excel (`﻿`)
- Accesible desde ReportesSection (card deshabilitada si `usa_tc_paralelo = false`)

---

## Roadmap completo — estado actualizado

### 🔴 Fase 1 — Bloqueante para facturar legalmente
- **ARCA/AFIP:** WS WSFE, CAE automático, QR en impresión, puntos de venta por empresa, Libro IVA

### 🟠 Fase 2 — COMPLETADA ✅
- Multi-pago · Remito sin precios · Aging CC · Alertas CC · Discrepancia caja

### 🟡 Fase 3 — COMPLETADA ✅
- Import CSV · Pedidos de clientes · Condiciones de venta · Límite de crédito · Solo Caja

### 🟢 Fase 4 — COMPLETADA ✅
- Dashboard ejecutivo · Onboarding banner · Datos de ejemplo precargados

### 🔵 Fase 5 — COMPLETADA ✅
- Módulo Proveedores · Portales Fiori · Launchpad · Notas de crédito · Análisis ABC · Comparativa

### ⚪ Fase 6 — COMPLETADA ✅

1. ✅ **Lista de precios por cliente** — `listaPreciosService.ts` + `ListasPrecioSection.jsx` + aplicación automática en `NuevaVentaModal`
2. ✅ **Notificaciones / Inbox accionable** — fix bug `empresa_id` + caja sin cerrar (24h) en `useNotifications.js`
3. ✅ **Document Flow visual** — `documentFlowService.ts` + `DocumentFlowPanel.jsx` integrado en `SaleDetailModal`
4. ✅ **Recepción parcial OC** — ya estaba implementado; fix TanStack Query v5 `onSuccess→useEffect` en `OrdenesCompraSection`

### ⚫ Fase 7 — EN CURSO

1. ✅ **Deploy Vercel** — https://kairox-gestion.vercel.app · `vercel.json` + `vite.config.prod.js` · env vars configuradas
2. ✅ **Estabilización producción** — fix TDZ crash (framer-motion + BroadcastChannel), Google Translate DOM, stale-session 403
3. ✅ **TC del día centralizado** — tabla `tipos_cambio` + `TipoCambioModal` + `MonedaSelector` reescrito + bloqueo operaciones
4. ✅ **Moneda Paralela SAP-style** — toggle config + hook `useTCParalelo` + `monto_paralelo`/`tc_paralelo` en 4 tablas + Reporte Paridad
5. ✅ **ARCA/AFIP** + Libro IVA — **Fases 1-5 COMPLETAS**: infra DB (migration 025) + Edge Functions `generar-csr`/`emitir-cae` + Wizard de activación UI (ConfiguracionSection) + integración CAE en flujo post-venta (Fase 3) + PDF con QR fiscal RG 4291/2018 (Fase 4) + Libro IVA Ventas digital (Fase 5).
6. ✅ **Moneda Paralela UI — Caja y Cuenta Corriente** (Prompt 13) — KPIs equivalente, columna separada en tabla Caja con fallback `calcParalelo`, dialog cobro CC con equivalente en tiempo real, aging bandas CC con equivalente.
7. ✅ **ConfiguracionSection SAP Administración-style** (Prompt 14) — 8 tabs centralizados + IntegracionCard + usuarios embebido en Tab 7 + REGLA DE ORO documentada.
8. ✅ **Integración Mercado Pago** (Prompt 15) — Edge Function `mp-webhook` + `ConfigMercadoPagoModal` + Tab 5 Integraciones con estado real + webhook URL dinámica.
9. ✅ **Maestros: Unidades de Medida + Condiciones de Pago** (Sesión 17) — CRUD real Tab 4/Tab 2 + seed automático por trigger + Select conectado en Clientes.
10. ✅ **Unidades de Medida Parte 2** (Sesión 19) — FK `productos.unidad_medida_id` + Select conectado + 3 dropdowns hardcodeados migrados al maestro.
11. 🔴 **Impuestos Fase B (padrón ARBA)** — BLOQUEADA por decisión de producto (Sesión 21). Investigación completa (endpoint, protocolo, auth confirmados), pero el webservice oficial solo es usable por empresas designadas "Agente de Recaudación" por ARBA — estatus que el público objetivo de KAIROX (micro PyMEs) casi nunca tiene. Sin código escrito a la espera de definir si vale la pena para la base de clientes real. Detalle completo en Historial de sesiones.
12. ✅ **Deuda técnica — descomposición de NuevaVentaModal, Parte 2** (Sesión 22) — `useMultipago` + `useCreditoCliente` extraídos (864→804 líneas), refactor puro sin cambios de comportamiento. Pendiente: `useAfipIntegration` (emisión CAE sigue inline) para una sesión futura.
13. ⏳ **Membresías** / Modelo de licencias Starter/Pro/Business
14. ✅ **Moneda Paralela UI — Compras** (Sesión 27) — banner de paridad + columna con fallback `calcParalelo` en `CompraRapidaSection`, `NuevaFacturaProveedorModal` (no tenía moneda paralela en absoluto) y `FacturasCompraSection`; INSERT a `compras`/`movimientos_caja` con guard condicional. `OrdenesCompraSection` fuera de alcance (no inserta en esas tablas).
15. ✅ **Contabilidad: Estado de Resultados + Balance General** (Sesión 28) — `PlanCuentasSection.jsx` pasa de 5 a 7 tabs. Ambas vistas reutilizan `asientosService.getBalanceComprobacion()` tal cual (sin tocar Balance/Libro Mayor), filtrando por `plan_cuentas.tipo` en el cliente. La cuenta seedeada "Resultado del Ejercicio" (código 3.3, tipo patrimonio) se excluye del listado de Patrimonio y se reemplaza por el resultado P&L calculado dinámicamente (Ingresos − Egresos acumulados a la fecha de corte) — cierra por partida doble sin necesitar asiento de cierre de ejercicio. Validado con datos reales (empresa `cbc4db74-...`, 93 asientos confirmados): Activo $5.754.500 = Pasivo $30.000 + Patrimonio $5.724.500, diferencia $0,00. Export CSV con BOM UTF-8 en ambas vistas.
16. ✅ **Método de Valoración de Stock — Último Costo / Promedio Ponderado** (Sesión 29) — `empresas.metodo_valoracion_stock` (migration 049) + selector real en Configuración → Inventario (reemplaza el placeholder). Cálculo centralizado en `fn_calcular_costo_valoracion()` (SQL), reutilizado por el trigger `fn_oc_update_stock()` (recepción de OC) y por la RPC nueva `aplicar_compra_producto()` (usada por `CompraRapidaSection` → "Nueva Compra", reemplaza el fetch+update manual del frontend). FIFO documentado en el CHECK como roadmap, no implementado.
17. ✅ **Fix bug preexistente: RPC `increment_stock` inexistente en edición de compras** (Sesión 29, encontrado mientras se inspeccionaba el punto 16) — `CompraRapidaSection.handleSaveEdit` llamaba a un RPC que nunca existió en la base (solo `decrement_stock`). Como el cliente Supabase no tira excepción por default en errores de RPC y el código no chequeaba `{ error }`, el fallo era **silencioso**: el stock no se ajustaba pero el usuario veía "Cambios guardados" igual. Fix: migration 050 crea `increment_stock()` simétrica a `decrement_stock` (sin tocarla), + se agregó chequeo de `error` en los 3 call-sites (ahora explota visiblemente si algo falla, en vez de tragárselo). De paso: si `metodo_valoracion_stock = 'promedio_ponderado'`, ahora se bloquea editar cantidad/costo de un ítem **ya registrado** en una compra pasada (revertir un promedio ya mezclado con operaciones posteriores no tiene solución no ambigua) — se sugiere ajuste de stock manual. Altas y bajas de ítems durante la edición sí se permiten en PPP (no tocan costo retroactivo); los ítems nuevos agregados durante la edición ahora pasan por `aplicar_compra_producto()` igual que una compra nueva.

#### ⏸️ Standby — evaluado pero no implementado
- 🔴 **Almacenes Múltiples** — evaluado en sesión 2026-06-19 (sesión 29), esfuerzo **L**. Requiere repensar `productos.stock_actual` como una relación producto×almacén (no un escalar en `productos`), con impacto en TODOS los puntos de escritura de stock: ventas, compras, OC, NC, devoluciones, ajustes manuales. No implementado: el target actual (micro/pequeña PyME) opera mayormente con 1 local. Standby hasta que haya demanda real de un cliente con necesidad concreta de multi-local, para diseñar con ese caso de uso como guía en vez de a ciegas.

#### Pendientes Fase 7
- Configurar Supabase Auth URLs (Site URL + Redirect URLs → `https://kairox-gestion.vercel.app/**`)
- ✅ ~~Extender TC paralelo a Caja + Cuenta Corriente~~ — **RESUELTO** Prompt 13
- ✅ ~~Moneda Paralela UI en módulo Compras~~ — **RESUELTO** Sesión 27
- ✅ ~~Investigar error 400 en consola~~ — **RESUELTO** sesión PM·3
- ✅ ~~Deploy a producción~~ — **RESUELTO** 2026-06-13 sesión 2: auto-deploy de Vercel estaba roto desde commit `69d9f38` (5 commits sin deployar). Deploy manual disparado via MCP Vercel — URL: https://kairox-gestion.vercel.app
- **Tests manuales pendientes (Document Flow):**
  - POS: hacer venta → verificar fila en `entregas` con `origen='implicita'` aparece en EntregasSection
  - Pedido → Generar Entrega → verificar stock decrementado + fila en `entregas`
  - Pedido `en_preparacion` → Facturar → NuevaVentaModal pre-cargado → venta → pedido pasa a `facturado`
  - EntregasSection: expandir row → ver items con nombre de producto
  - Modal detalle Pedido: abrir pedido facturado → DocumentFlow muestra chip Pedido + chip Entrega + chip Factura

---

## ⚠️ Estado del conector MCP Supabase

En la última sesión el conector de Supabase en claude.ai estaba autenticado con una cuenta incorrecta (mostraba proyectos de org `kqtqkrbsorgtocnvnfxp` en lugar de `wuznppxeonmhfcvnqfbf`). Se reconectó vía OAuth a la cuenta NALUX.

**Al iniciar sesión, verificar:**
- El MCP Supabase debe listar el proyecto `wuznppxeonmhfcvnqfbf` (kairox-gestion, org NALUX)
- Si NO aparece: claude.ai → Conectores → Supabase → desconectar y reconectar con cuenta NALUX
- El frontend no se vio afectado (se conecta directamente vía URL/anon key del .env)

---

## Pendientes de la tabla SAP S/4HANA

### ✅ Completados

| # | Feature | Referente SAP | Estado |
|---|---|---|---|
| 1 | Lista de precios por cliente | SD Condition Types | ✅ Fase 6 |
| 2 | Notificaciones / Inbox accionable | SAP My Inbox | ✅ Fase 6 |
| 3 | Document Flow visual | SD Document Flow | ✅ Fase 6 |
| 4 | Recepción parcial de OC | MM Partial GR | ✅ Fase 6 |
| 10 | TC del día centralizado | FI Exchange Rate Entry | ✅ Fase 7 |
| 11 | Moneda paralela (Parallel Currency) | FI Company Code Global Parameters | ✅ Fase 7 |
| 7 | **Gestión de cheques** | TM Checks | ✅ Sesión 10-jun-2026 |
| 8 | **Cierre formal de períodos contables** | FI Period Close | ✅ Sesión 10-jun-2026 |
| 9 | **Retenciones IIBB/Ganancias** | FI Withholding | ✅ Sesión 12-jun-2026 |
| 12 | **IVA real por alícuota + Libro IVA Compras** | FI Tax (RTC) | ✅ Sesión 12-jun-2026 |
| 13 | **Document Flow transaccional** (entregas/recepciones/devoluciones/ND) — modelo datos + RPCs + UI Ventas + Devoluciones | SD Delivery + MM GR | ✅ Sesiones 13-jun-2026 (Prompts 1/6, 2/6, 3/6, 4/6) |
| 14 | **Moneda Paralela UI — Caja y Cuenta Corriente** (Prompt 13) — KPIs equivalente + columna tabla + dialog cobro + aging bandas | FI Parallel Currency Reporting | ✅ Sesión 15-jun-2026 |
| 15 | **ConfiguracionSection SAP Administración-style** (Prompt 14) — 8 tabs centralizados, REGLA DE ORO, IntegracionCard, usuarios en Tab 7 | SAP B1 Administration Module | ✅ Sesión 15-jun-2026 |
| 16 | **Integración Mercado Pago** (Prompt 15) — Edge Function `mp-webhook` (HMAC-SHA256, dedup, solo `approved`), `ConfigMercadoPagoModal` (token verify, webhook URL, cuenta destino), Tab 5 Integraciones con estado real | SAP B1 Payment Engine / Integration Framework | ✅ Sesión 15-jun-2026 |
| 17 | **Maestros: Unidades de Medida + Condiciones de Pago** (Sesión 17) — tablas reales multi-tenant, CRUD en Tab 4/Tab 2, seed automático por trigger en empresas nuevas, Select conectado en ficha de Cliente | MM Units of Measure + FI Terms of Payment | ✅ Sesión 16-jun-2026 |
| 18 | **Unidades de Medida Parte 2** (Sesión 19) — FK `productos.unidad_medida_id` con mapeo automático 11/11, Select conectado en ficha de Producto, 3 dropdowns hardcodeados duplicados migrados a la tabla maestra | MM Material Master — Base Unit of Measure | ✅ Sesión 17-jun-2026 |

### 🟢 Baja prioridad (post-ARCA)

| # | Feature | Referente SAP |
|---|---|---|
| 5 | Solicitud de Compra | MM Purchase Req. |
| 6 | Presupuesto vs Real mensual | CO Budget |

---

## Historial de sesiones

### Sesión 2026-06-17 (sesión 23) — Reparar contradicción regla de Caja + cerrar hallazgos pendientes

**Objetivo:** el propio CONTEXT.md tenía dos secciones contradictorias sobre la regla de Caja ("solo Efectivo bloquea" en REGLAS DE ORO vs. "Caja cerrada = NADA" en notas de sesión 16). Auditar el código real antes de tocar nada, porque toca control financiero.

#### Parte 1 — Auditoría de los 9 puntos de enforcement de Caja (sin tocar código)

| # | Archivo | Flujo | Comportamiento real encontrado |
|---|---|---|---|
| 1 | `NuevaVentaModal.jsx` | Venta POS | Solo Efectivo bloquea |
| 2 | `useConfirmarVenta.js` | Venta Modo Caja (`PanelCarrito`) | Solo Efectivo bloquea |
| 3 | `CajaSection.jsx` | Movimiento manual de caja | Solo Efectivo bloquea |
| 4 | `NuevaFacturaProveedorModal.jsx` | Factura de compra a proveedor | Solo Efectivo bloquea |
| 5 | `NuevaNCProveedorModal.jsx` | NC a proveedor (reembolso) | Solo Efectivo bloquea (`reembolsoEfectivo`) |
| 6 | `CuentaCorrienteSection.jsx` | Cobro CC a cliente | Solo Efectivo bloquea |
| 7 | `ClientDetailModal.jsx` | Cobro rápido | Bloquea siempre, pero el flujo solo admite Efectivo (hardcoded) — no es una excepción real |
| 8 | `CompraRapidaSection.jsx` | Compra rápida | ⚠️ **Bloqueaba TODO** sin importar método (Transferencia/Tarjeta/CC incluidos) |
| 9 | `NuevaFacturaModal.jsx` | Factura de venta standalone | ⚠️ **No bloqueaba nada** — ni Efectivo. Solo omitía en silencio el movimiento de caja si estaba cerrada |
| — | RPC `crear_venta` (servidor) | — | No valida caja del lado servidor; confía 100% en el frontend |

**Causa raíz encontrada (git history):** la regla "bloquea todo" se introdujo el 2026-06-12 (commits `ade5e7f`/`22c8d66`). Al día siguiente, el commit **`6d645ed`** ("Prompt 7", 2026-06-13) la **revirtió deliberadamente**: *"fix: NuevaVentaModal — solo bloquea si pagosFinales incluye Efectivo" / "fix: CajaSection — solo movimientos de Efectivo requieren caja abierta"*. Esa reversión nunca se propagó a `CompraRapidaSection.jsx` (quedó con la regla vieja) ni se aplicó nunca a `NuevaFacturaModal.jsx` (nunca tuvo ningún bloqueo). Sesión 16 (2026-06-16, 3 días después) volvió a encontrar el comportamiento "solo Efectivo" durante testeo, lo trató como un bug nuevo, y escribió en CONTEXT.md un "fix" para bloquear todo — **pero ese fix nunca se implementó en código** (el commit real de sesión 16, `470d506`, solo tocó un comentario en `NuevaVentaModal.jsx`). Resultado: documentación describiendo un fix fantasma, contradiciendo la regla real vigente.

**Conclusión:** Caso B confirmado — inconsistencia real de comportamiento, no solo de documentación. Se presentó la tabla completa a Luciano antes de tocar código.

**Decisión del usuario:** "Solo Efectivo bloquea" (la regla dominante en 6/8 archivos, y la decisión deliberada y más reciente).

#### Parte 3 — Aplicación uniforme

- **`CompraRapidaSection.jsx`**: el check incondicional `if (!isSessionOpen)` pasó a `if (!isSessionOpen && esEfectivo)` con `esEfectivo = purchaseForm.forma_pago === 'Efectivo'`. Banner de header corregido (de rojo "no se pueden registrar compras" a ámbar "Efectivo no disponible, podés comprar con Transferencia/Tarjeta/CC"). Botón "Registrar Compra" ya no se deshabilita preventivamente por caja cerrada — sigue el mismo patrón que `NuevaVentaModal.jsx` (deja hacer click, el toast bloquea si corresponde).
- **`NuevaFacturaModal.jsx`**: agregado el check faltante `if (formaPago === 'Efectivo' && !isSessionOpen)` antes de `setLoading(true)`, con el mismo mensaje que `NuevaFacturaProveedorModal.jsx`.
- **`CONTEXT.md`**: REGLAS DE ORO actualizada con la regla única confirmada. Las 3 menciones históricas de "Caja cerrada = NADA" (sesión 16 bug #7, su "Convención nueva", y la sección "2026-06-12 tarde" que la introdujo originalmente) se dejaron **intactas como registro histórico** pero con una anotación clara de que fueron revertidas/nunca implementadas — no se reescribió la historia, se la corrigió con contexto.
- **Memoria persistente** (`project_caja_regla_efectivo.md`) actualizada con la historia completa y los 9 archivos que deben seguir el patrón.

**Build de producción verificado** (`vite build --config vite.config.prod.js`) tras los 2 fixes.

#### Parte 2a — Unificar carpetas de migrations

Listado completo de ambas carpetas confirmó **cero colisiones de número** (`migrations/` tenía 001-036+044, `supabase/migrations/` tenía 039-043+045). Se movieron los 33 archivos de `migrations/` a `supabase/migrations/` con `git mv` (preserva historial de git como rename, no como delete+create). `migrations/` ya no existe. Se verificó primero que ningún código del repo referenciara la ruta `migrations/` antes de mover nada. Tabla de migraciones en CONTEXT.md actualizada (35 referencias de ruta corregidas).

#### Parte 2b — Estado real de la CORS whitelist dinámica

**Hallazgo: ya estaba resuelta, no era deuda.** `supabase/functions/_shared/auth.ts` tiene `buildCorsHeaders(req)` con whitelist de orígenes (producción + localhost:3000/3001/5173), consumida por las 5 funciones de usuarios/AFIP (`create-user`, `delete-user`, `invite-user`, `generar-csr`, `emitir-cae`). Verificado vía MCP (`get_edge_function`) que el código **deployado en producción** de `create-user` es **idéntico byte a byte** al del repo — no hay nada pendiente de deployar. El prompt asumía que podía faltar porque no aparece como una "Edge Function" separada en la lista — en realidad es código compartido importado por las demás, nunca fue pensada como función independiente.

**Hallazgo no buscado, descubierto en el camino:** `mp-webhook` (Mercado Pago, creada en Prompt 15) **nunca se deployó** — no aparece en `list_edge_functions`, pese a que CONTEXT.md la listaba como deployada. La integración Mercado Pago no es funcional en producción hasta correr `supabase functions deploy mp-webhook --no-verify-jwt`.

---

### Sesión 2026-06-17 (sesión 22) — Deuda técnica: extraer useMultipago y useCreditoCliente de NuevaVentaModal

**Objetivo:** continuar la descomposición de `NuevaVentaModal.jsx` (el componente más crítico del sistema) iniciada con `useConfirmarVenta` (Prompt Modo Caja), extrayendo dos hooks más: `useMultipago` y `useCreditoCliente`. Refactor puro — cero cambios de comportamiento, regla de oro del prompt.

**Lectura previa obligatoria (Parte 1):** se leyó `NuevaVentaModal.jsx` completo (864 líneas) antes de tocar nada, mapeando exactamente cómo vivían ambas lógicas.

**Divergencias encontradas vs. el ejemplo de hook que proponía el prompt — se respetó el código real, no el ejemplo:**
1. **Multi-pago NO es un array de `{metodo, monto}` con `agregarPago`/`quitarPago`** como sugería el prompt — es un `Set<string>` de métodos activos + un objeto `methodAmounts` por método, con lógica de exclusividad de Cuenta Corriente (seleccionarla limpia todo lo demás; seleccionar cualquier otro método mientras CC está activa reemplaza CC) y la regla "no se puede deseleccionar el último método". `useMultipago(total)` replica este modelo 1:1.
2. **El control de crédito NO es un hook reactivo con `useQuery`/cache** como sugería el prompt — es una verificación imperativa fresca (`supabase.from('clientes').select(...).single()`) ejecutada una sola vez, justo antes de confirmar la venta, para no trabajar con `saldo_actual` desactualizado. Cachearlo con `useQuery` habría sido un cambio de comportamiento real (podría dejar pasar una venta con datos viejos si el saldo cambió en otra caja mientras el modal estaba abierto). `useCreditoCliente()` expone solo `verificarLimite(clienteId, monto)` como función async bajo demanda, sin estado interno ni fetch automático.
3. **El campo `bloquear_en_limite` no estaba contemplado en el ejemplo del prompt** — el código real distingue entre "bloquear la venta" (si `bloquear_en_limite=true`) y "solo advertir, dejar pasar" (si es `false`). Se preservó exactamente esa distinción en el hook.

**Archivos creados:**
- `src/hooks/useMultipago.js` (117 líneas) — `selectedMethods`, `methodAmounts`, `setMethodAmounts`, `isCC`, `isMultiPago`, `totalPagado`, `restante`, `toggleMethod`, `reset`, `construirPagosFinales()` (valida formato es-AR + que la suma cierre con tolerancia de centavos, devuelve `{pagos, error}` con los mismos títulos/descripciones de toast que el código original).
- `src/hooks/useCreditoCliente.js` (48 líneas) — `verificarLimite(clienteId, montoNuevo)` → `{aplica, excede, bloquea, limite, saldoActual}`. El componente sigue armando los mensajes de toast (mismo texto exacto), el hook solo decide.

**`NuevaVentaModal.jsx`: 864 → 804 líneas** (-60, -7%; el archivo es mayormente JSX, por eso la reducción no es enorme pero la lógica movida es la más sensible del componente). Diff final: 35 inserciones / 95 eliminaciones, sin tocar una sola línea de JSX — los nombres de variable desestructuradas del hook (`selectedMethods`, `methodAmounts`, `isCC`, `isMultiPago`, `restante`, `toggleMethod`) son idénticos a los que ya usaba el render, así que cero referencias rotas. Se eliminó el import `parseNumberLocale` (ahora solo se usa dentro del hook) y la variable `totalPagado` desestructurada que había quedado sin consumidores en el componente.

**Verificación de equivalencia (Parte 1→4, sin tests automatizados — no hay framework de testing configurado en el repo):** se releyó línea por línea el diff final contra los 5 casos del checklist (pago único, multi-pago simultáneo, CC que excede con bloqueo, CC dentro del límite, cliente sin límite configurado) confirmando mensajes/orden/tolerancias idénticos al original. Build de producción exacto al de Vercel (`vite build --config vite.config.prod.js`) exitoso.

**Parte 5 (reutilización en otros componentes) — evaluada y descartada con justificación, no forzada:** `PanelCarrito.jsx` (Modo Caja) usa un selector de **un solo** método (`const [metodo, setMetodo] = useState('Efectivo')`), no el modelo Set+methodAmounts — patrón distinto, no equivalente. `NuevaFacturaModal.jsx` tiene su propio modelo de forma de pago (sin Set, sin la misma exclusividad de CC) y no aparece ninguna verificación de `bloquear_en_limite` ahí. Ninguno de los dos es "100% equivalente" como exigía el prompt para forzar la unificación — se dejaron intactos.

**Pendiente para sesión futura (no es un fracaso, está fuera de scope):** `useAfipIntegration` — la emisión de CAE (líneas ~530-570 de `handleConfirmSale`, el bloque fire-and-forget que llama a `afipService.emitirCAE`) sigue inline en `NuevaVentaModal.jsx`. No se tocó en esta sesión.

**No se tocó la RPC `crear_venta` ni ningún otro endpoint de Supabase** — refactor 100% del lado del cliente, tal como exigía el prompt.

---

### Sesión 2026-06-17 (sesión 21) — Impuestos Fase B: investigación del padrón ARBA — BLOQUEADA antes de programar

**Objetivo original del prompt:** agregar consulta automática al padrón de ARBA por CUIT (Edge Function + tabla de cache + botón "Verificar en ARBA" en Cliente/Proveedor) para detectar automáticamente si un contribuyente está sujeto a retención/percepción de IIBB, evitando que el usuario lo busque a mano en la web de ARBA.

**El prompt pedía explícitamente verificar el endpoint real antes de escribir código** ("si no se puede confirmar... documentar la incertidumbre y dejar un mock claramente marcado, en lugar de inventar una URL"). Se investigó a fondo antes de tocar código — resultado: **sí existe documentación real, y revela un bloqueo de negocio, no solo técnico.**

**Hallazgos de la investigación (con fuentes):**
1. **El webservice oficial SÍ está documentado:** `https://dfe.arba.gov.ar/DomicilioElectronico/SeguridadCliente/dfeServicioConsulta.do` (producción) / `https://dfe.test.arba.gov.ar/...` (test/homologación). Protocolo XML custom con hash MD5 (no REST/JSON simple, no SOAP estándar) — similar en complejidad al esquema legacy de AFIP. Parámetros: `cuit_contribuyente`, `fecha_desde`, `fecha_hasta` (YYYYMMDD). Respuesta incluye `AlicuotaPercepcion`, `AlicuotaRetencion`, `GrupoPercepcion`, `GrupoRetencion`. Fuente: [wiki técnica de sistemasagiles](https://www.sistemasagiles.com.ar/trac/wiki/IngresosBrutosArba).
2. **🔴 Bloqueo real:** la autenticación es usuario=CUIT + contraseña="CIT" (Clave de Identificación Tributaria), y **ARBA solo emite la CIT a empresas que ya designó como "Agente de Recaudación"** — un estatus que ARBA asigna unilateralmente (no autogestionable) según facturación/rubro, típicamente a empresas medianas/grandes. El mercado objetivo de KAIROX (PyMEs micro, 1-3 empleados, ver sección "¿Qué es este proyecto?") **casi nunca tiene este estatus** — el webservice oficial sería inútil para la inmensa mayoría de clientes reales del producto. Fuentes: [Agentes de Recaudación — ARBA](https://web.arba.gov.ar/agentes), [Régimen de Recaudación por Sujeto](https://web.arba.gov.ar/regimen-de-recaudacion-por-sujeto).
3. **Existe una alternativa pública sin credenciales** — [Padrón de Retenciones, consulta pública](https://consultas.arba.gov.ar/ConsultasGenerales/consultaPadronReten.do): formulario HTML donde cualquiera ingresa un CUIT sin login. Pero es un form para uso humano (la propia página advierte "el procesamiento puede demorar varios minutos", sugiriendo generación asíncrona de reporte, no una respuesta JSON/XML inmediata), sin contrato de API documentado. Integrarlo significaría scrapear una página gubernamental — fácil de romper si ARBA cambia el HTML, y zona gris de ToS para un SaaS pago. Se descartó como base de una integración productiva.

**Decisión:** se presentaron 3 opciones al usuario (MVP real acotado solo para empresas ya-Agente-de-Recaudación / solo documentar y pausar / integración completa tipo AFIP con Vault). **El usuario eligió "solo documentar, no programar todavía."** No se creó la migration `padron_arba_cache`, no se creó la Edge Function `consultar-padron-arba`, y no se tocó `ClienteDetailModal.jsx` ni `ProveedoresSection.jsx`. El modelo de datos de Fase A (`alicuotas_impuestos.fuente` ya contempla los valores `manual | padron_arba | padron_agip`) y el placeholder de UI ("Importación de archivos ARBA — próximamente" en `TabRetenciones.jsx:176`) quedan exactamente como estaban.

**Para retomar en el futuro:** si se decide construir el MVP, el endpoint/protocolo/auth ya están confirmados arriba — no hace falta re-investigar. La decisión pendiente es de producto, no técnica: ¿vale la pena construir una integración que solo sirve a la fracción de clientes que sean Agentes de Recaudación designados por ARBA? Si la respuesta es sí, el patrón a seguir es el mismo que AFIP (credencial por empresa vía Supabase Vault, ver `generar-csr`/`emitir-cae`), adaptado al protocolo XML/MD5 de ARBA en vez de WSAA/WSFE.

**El flujo manual de retenciones de Fase A sigue intacto y funcionando** — esta sesión no lo tocó ni lo bloquea.

---

### Sesión 2026-06-17 (sesión 20) — Formato es-AR: cierre de deuda pendiente en 5 módulos

**Objetivo:** aplicar el patrón de formato numérico argentino (`parseNumberLocale()`, inputs `type="text" inputMode="decimal"`, display `toLocaleString('es-AR')`) ya usado en `ProductosSection`/`CotizacionesSection`/`PedidosSection` a los 5 módulos que habían quedado pendientes. Fix puro de UX/formato — sin tocar lógica de negocio, queries ni RLS.

**Resultado por módulo:**
1. **`ClientDetailModal.jsx`** — tenía deuda real: input de "Pago Rápido" en `type="number"` (debía ser texto) y validación del botón con `parseFloat` en vez de `parseNumberLocale`; historial de movimientos mostraba montos con `.toFixed(2)` (sin separador de miles, punto en vez de coma). Las 3 cosas corregidas. El guardado real (`handleRegisterPayment`) ya usaba `parseNumberLocale` correctamente — solo el input/botón/display estaban mal.
2. **`ListasPrecioSection.jsx`** — input de precio especial por producto en `type="number"`, parseo con `parseFloat`. Corregido a `type="text" inputMode="decimal"` + `parseNumberLocale`. No tiene campos de % de ajuste/descuento (la lista solo usa precio fijo) — esa parte del prompt no aplicaba.
3. **`PlanCuentasSection.jsx`** (7 vistas) — el display en las 7 vistas **ya estaba 100% correcto**: usa un helper único `fmt()` (`Intl.NumberFormat('es-AR', {style:'currency', currency:'ARS', minimumFractionDigits:2})`) consistentemente en las ~22 ocurrencias de monto del archivo, sin un solo `.toFixed()` suelto. Lo único pendiente eran los inputs Debe/Haber del modal "Nuevo Asiento Contable" (`type="number"` → `text+inputMode=decimal`) y su parseo (`parseFloat` → `parseNumberLocale`) en el cálculo de totales y en el payload de guardado.
4. **`ProveedoresSection.jsx`** — input de "Registrar Pago" a proveedor en `type="number"`, parseo con `parseFloat`. Corregido. **Confirmado que NO duplica el maestro `condiciones_pago`** de Clientes: tiene su propio campo simple `condicion_pago` (select texto: contado/15/30/60/90 días, hardcodeado) + `plazo_pago_dias` (entero) — sistema independiente, no se tocó esa lógica según indicaba el prompt. El resto de montos visibles (deuda total, saldo, movimientos CC, total de OC) ya usaban `toLocaleString('es-AR')` correctamente.
5. **`OnboardingWizard.jsx`** — auditado completo (8 inputs en total en el wizard): el único campo numérico real (`precio_venta` del producto demo) **ya estaba 100% correcto** (`type="text" inputMode="decimal"` + `parseNumberLocale` en el submit). `stock_actual` es entero (`type="number"` + `parseInt`), correcto según regla 5. No requirió ningún cambio — se deja constancia de que ya estaba bien, como pide el checklist.

**Hallazgo importante — el ítem "bonus" del prompt resultó ser falso:** se pidió confirmar si `CompraRapidaSection.jsx` (carrito de Compra Rápida) ya había quedado resuelto indirectamente por los prompts de Document Flow de Compras. Verificado con grep: **no es así** — el archivo todavía tiene inputs `type="number"` para costo unitario, múltiples `parseFloat()` (en vez de `parseNumberLocale`), y varios `.toFixed(2)` para mostrar totales (carrito, total de compra, total de edición, costo actual en autocomplete). Se flageó como tarea separada (`task_6249ad17`) en vez de fabricar una confirmación incorrecta — queda pendiente para una sesión dedicada.

**Cierre del pendiente (mismo día, sesión de seguimiento):** `CompraRapidaSection.jsx` corregido siguiendo el mismo patrón. Cambios: input de costo unitario del carrito (`type="number"` → `text+inputMode=decimal`, placeholder "0,00") y el del segundo input equivalente en el modal de edición; `updateCartItem`/`updateEditItem` ya no parsean con `parseFloat` en el `onChange` (guardan el string crudo, igual que `CotizacionesSection`); `calculateTotal`/`calculateEditTotal`, `isPurchaseValid`, `handleRegisterPurchase`, el update de stock y `handleSaveEdit` ahora usan `parseNumberLocale()` sobre el costo; todos los `.toFixed(2)` (subtotal de fila, total de compra, total de edición, costo actual en el autocomplete) pasaron a `.toLocaleString('es-AR', { minimumFractionDigits: 2 })`. La cantidad sigue siendo `type="number"` entero (sin cambios, según regla). Build de producción verificado OK.

**Verificación:** build de producción exacto al de Vercel (`vite build --config vite.config.prod.js`) exitoso tras los 4 archivos modificados. Sintaxis JSX validada con Babel en cada uno.

---

### Sesión 2026-06-17 (sesión 19) — Unidades de Medida Parte 2: conectar el maestro a Productos

**Objetivo:** cerrar el gap dejado por la sesión 17 — `productos.unidad_medida` seguía siendo texto libre sin conexión al maestro `unidades_medida`.

**Migration `045_unidades_medida_productos.sql`** (aplicada via MCP, archivo en `supabase/migrations/`):
- FK aditiva `productos.unidad_medida_id` → `unidades_medida.id` (`ON DELETE SET NULL`), columna de texto `unidad_medida` sin tocar.
- Mapeo automático por `LOWER(TRIM(unidad_medida)) = LOWER(codigo) OR LOWER(TRIM(unidad_medida)) = LOWER(descripcion)`. **Resultado real verificado:** 11/11 productos se auto-mapearon (todos tenían `unidad_medida='Unidad'`, único valor existente en la DB real — confirmado con `SELECT DISTINCT` antes de migrar), 0 quedaron sin mapear.

**Hallazgo que cambió el plan original:** el prompt asumía que `OrdenesCompraSection.jsx` importaba el dropdown desde `src/lib/unidadesMedida.js`. Verificado con grep (`from '@/lib/unidadesMedida'`): **cero archivos** importan ese módulo en todo el código — nunca tuvo consumidores reales. En cambio, había **tres** copias hardcodeadas independientes de la misma lista de 11 `<option>` (una por archivo, no compartidas): `ProductosSection.jsx`, `OrdenesCompraSection.jsx` y `CotizacionesSection.jsx`. Las tres se migraron a leer de la tabla `unidades_medida`. `CompraRapidaSection.jsx` también usa `unidad_medida` pero solo para *mostrar* el valor heredado del producto seleccionado — no tiene dropdown propio, no requirió cambios.

**Archivos modificados:**
- `src/components/sections/ProductosSection.jsx` — `ProductForm` ahora recibe prop `unidadesMedida`; Select por `unidad_medida_id` (antes por texto), con `useEffect` que en alta (no edición) auto-selecciona la unidad "Unidad" apenas carga el maestro (preserva el default histórico). En edición, si `unidad_medida_id` es null pero hay texto histórico sin mapear, muestra aviso: *"Valor actual: '...' — no coincide con el maestro, seleccioná una unidad."* `handleCreateProduct`/`handleUpdateProduct` envían `unidad_medida_id` en el payload.
- `src/components/sections/OrdenesCompraSection.jsx` — nuevo `useQuery(['unidades_medida', empresaId])`, el `<select>` de ítems ahora itera `unidadesMedida` en vez de 11 `<option>` fijos. Sigue guardando el campo de texto `unidad_medida` en el item de la OC (sin FK propia — fuera de scope).
- `src/components/sections/CotizacionesSection.jsx` — mismo patrón que OrdenesCompraSection.

**Fuera de scope (documentado, no implementado):** factor de conversión entre unidades (ej. comprar "Caja de 12" y vender "Unidad") — afecta cálculo de stock/costos, requiere sesión dedicada.

**Verificación:** build de producción exacto al de Vercel (`vite build --config vite.config.prod.js`) exitoso tras `npm install` (el `package.json` de sesión 18 agregó la dependencia `buffer` pero el entorno local no tenía `npm install` corrido — no es un bug de código, Vercel siempre instala antes de buildear). Sintaxis JSX validada con Babel en los 3 archivos. Advisors de seguridad sin warnings nuevos.

---

### Sesión 2026-06-16 (sesión 17) — Maestros reales: Unidades de Medida + Condiciones de Pago

**Objetivo:** reemplazar los placeholders "Próximamente" de Tab 4 (Inventario) y Tab 2 (Finanzas) de `ConfiguracionSection` por maestros reales multi-tenant, siguiendo la REGLA DE ORO.

**Migration `043_maestros_unidades_condiciones_pago.sql`** (aplicada via MCP, archivo guardado en `supabase/migrations/`):
- Tablas `unidades_medida` (`codigo`, `descripcion`, `activo`) y `condiciones_pago` (`nombre`, `dias_credito`, `descuento_pct`, `activo`), ambas con RLS por `empresa_id = get_my_empresa_id()` y UNIQUE compuesto.
- FK aditiva `clientes.condicion_pago_id` → `condiciones_pago.id`.
- Función `seed_maestros_default(empresa_id)` — 11 unidades + 5 condiciones de pago default, `ON CONFLICT DO NOTHING`.
- Seed retroactivo ejecutado para las 3 empresas existentes (11 unidades cada una, verificado).

**Hallazgos de schema que cambiaron el plan original:**
1. El prompt asumía que `seed_plan_cuentas` se dispara automáticamente al crear una empresa nueva. Verificado en código: es **100% manual** (botón en `PlanCuentasSection`). El único trigger real `AFTER INSERT` en `empresas` es `trg_empresa_caja_principal` (crea "Caja Principal"). Para que los maestros nuevos sí sean automáticos, se agregó un **trigger independiente** `trg_empresa_seed_maestros` en lugar de modificar `create_caja_principal()` — evita arriesgar una función que ya funciona en producción.
2. El prompt asumía que `clientes.condicion_pago` (singular) era el campo de texto libre en uso. Verificado en DB: existen **dos** columnas de texto distintas — `condiciones_pago` (plural, Textarea de notas libres, activamente usada en `ClientesSection.jsx`) y `condicion_pago` (singular, **columna huérfana sin ninguna referencia en código**). Se documentó la distinción en Convenciones; el Select nuevo no escribe en ninguna de las dos, solo en la nueva FK `condicion_pago_id` + sincroniza `dias_credito` (columna real ya en uso).

**Archivos modificados:**
- `src/components/sections/ConfiguracionSection.jsx` — Tab 4: CRUD real de Unidades de Medida (tabla + modal alta/edición + toggle `activo`, sin hard delete). Tab 2: CRUD real de Condiciones de Pago (tabla + modal + toggle `activo`). Ambos modales viven fuera de `<Tabs>` (mismo patrón que el wizard AFIP y `ConfigMercadoPagoModal`) para no desmontarse al cambiar de tab.
- `src/components/sections/ClientesSection.jsx` — nuevo Select "Condición de Pago" en el form (estilo `<select>` nativo, igual al de Lista de Precios ya existente) que lee de `condiciones_pago` vía `useQuery`, escribe `condicion_pago_id` y autocompleta `dias_credito` al elegir. Campo `dias_credito` sigue editable manualmente después (override posible).

**Parte 5 (cálculo automático de vencimiento) — NO implementada, documentada como TODO:** requeriría tocar `crear_venta` u otra RPC crítica para calcular `fecha_vencimiento` a partir de `condicion_pago.dias_credito`. Se prioriza no arriesgar una RPC en producción; queda pendiente para una sesión dedicada.

**Verificación:** build de producción (`npx vite build`) exitoso sin errores, sintaxis JSX validada con Babel en ambos archivos modificados, advisors de seguridad de Supabase sin warnings nuevos para las tablas/funciones creadas.

---

### Sesión 2026-06-16 — Auditoría Launchpad Fiori vs nueva estructura de módulos

**Objetivo:** auditar si `LaunchpadSection.jsx` y los 4 Portales de área (Ventas/Compras/Finanzas/Inventario) tenían navegación rota tras la reestructuración del Document Flow (sesiones 13-15).

**Hallazgo principal:** la premisa de la auditoría era inválida — **el feature nunca llegó a producción.** `LaunchpadSection.jsx`, `portals/*.jsx` y `portalService.ts` (commit `d2d50fb`, "feat: portales por área + Launchpad") se crearon enteramente dentro de un worktree aislado de un agente (`.claude/worktrees/suspicious-panini-6cb9e5/`) que se commiteó por error al repo raíz, pero **nunca se mergeó a la ruta real `src/`**. Verificado con `git ls-tree -r HEAD -- src/` y `grep -ri "LaunchpadSection\|portals/\|portalService"` sobre todo `src/`: 0 resultados. No hay ni un solo `case 'portal_*'` en `Dashboard.jsx`.

**Conclusión:** no había tiles que corregir porque el archivo no existe en código vivo. `DashboardSection.jsx` (`case 'dashboard'` en `Dashboard.jsx`, default de `activeSection`) es y fue siempre la única pantalla de inicio. No hay ni hubo ambigüedad Launchpad vs Dashboard en producción.

**Acciones:**
- Corregida tabla de módulos en CONTEXT.md (eliminadas 6 entradas falsas: Launchpad + 4 Portales con estado `✅` ficticio).
- Corregida sección "Arquitectura de navegación" — eliminada afirmación falsa de que los portales "se mantienen en código pero ya no son accesibles desde el sidebar".
- Limpieza: eliminados del repo los 183 archivos huérfanos bajo `.claude/worktrees/suspicious-panini-6cb9e5/` (snapshot congelado de principios de junio, incluye ese mismo Launchpad/Portales nunca mergeado + CONTEXT.md/migraciones viejas). Ver commit de cleanup.

**Convención nueva:** si una sesión de agente trabaja en un worktree aislado (`isolation: "worktree"`), verificar antes de cerrar la sesión que el worktree NO haya quedado trackeado por error en el repo principal (`.claude/worktrees/` no estaba en `.gitignore`).

---

### Sesión 2026-06-16 (sesión 16 — Nadia) — Testeo end-to-end del trabajo de Luciano + fixes integrales

**Objetivo:** después de pullear 15 commits de Luciano (Aurora redesign, Document Flow Prompts 1-15, Modo Caja, Facturación, Mercado Pago), recorrer toda la app sección por sección, arreglar bugs encontrados y dejar el sistema listo para producción.

**Bugs detectados y corregidos en runtime (mientras la user testeaba):**

1. **PDF de venta se quedaba "Generando..." infinito** — `@react-pdf/renderer` se cuelga con imágenes >500KB.
   - Fix runtime: en [empresaUtils.js](src/lib/empresaUtils.js) skip de logo si pesa >500KB + timeout 30s en [ComprobantePrintModal.jsx](src/components/ventas/ComprobantePrintModal.jsx).
   - Fix raíz: downscale automático a 400×400 + compresión PNG/JPEG en upload de logo desde [ConfiguracionSection.jsx](src/components/sections/ConfiguracionSection.jsx). Logo previo de 1.4 MB → ahora <100KB tras resubirlo.

2. **Columna "FACTURA" del Historial mostraba "—"** — `NuevaFacturaModal` solo guardaba `tipo_comprobante_afip` si AFIP estaba activo.
   - Fix: guardar SIEMPRE A/B/C (o null para Ticket) en el INSERT inicial.
   - `HistorialVentas` ahora muestra badge "Factura B" (no electrónica), "Factura B + CAE" (electrónica) o "Ticket".

3. **Modales colgaban toda la página al cerrar** (mouse no respondía, había que recargar). Bug raíz de Radix UI con DropdownMenu + Dialog.
   - Fix global #1: CSS en [index.css](src/index.css) que fuerza `pointer-events: auto !important` en body/html si quedan stuck.
   - Fix global #2: `MutationObserver` en [App.jsx](src/App.jsx) que detecta `aria-hidden=true` colgado en `<div #root>` y lo limpia automáticamente.
   - Fix puntual: cambiar `onClick` → `onSelect + e.preventDefault() + setTimeout(0)` en todos los `DropdownMenuItem` de [HistorialVentas.jsx](src/components/ventas/HistorialVentas.jsx) para que el dropdown cierre limpio ANTES de abrir el dialog.

4. **Notas de Débito no aparecían en el Historial de Ventas** — se guardan en tabla separada `notas_debito`, no en `comprobantes`.
   - Fix: `HistorialVentas.fetchData` ahora hace fetch paralelo de ambas tablas, normaliza ND al formato de comprobante (`tipo='nota_debito'`) y merge ordenado por fecha.

5. **Cliente VIP "0 productos" después de cargar precios** — `ListasPrecioSection` solo invalidaba `ITEMS_KEY`, no la lista padre.
   - Fix: invalidar AMBAS keys (`ITEMS_KEY` + `LISTAS_KEY`) en `handleSaveItemPrecio` y `deleteItem.onSuccess`. Contador `_itemCount` ahora se actualiza en vivo.

6. **Retención Practicada no guardaba** — `recalcMonto` devolvía formato US (`"4800.00"`) que parseNumberLocale es-AR rechaza.
   - Fix: `recalcMonto` aplica `.replace('.', ',')` → devuelve `"4800,00"`.

7. **Caja cerrada permitía hacer ventas** — la validación solo bloqueaba efectivo.
   - Fix propuesto en su momento: bloquear TODA venta y TODO movimiento con caja cerrada, sin importar el método de pago.
   - **⚠️ CORRECCIÓN (Sesión 23):** este fix nunca se implementó en código — el commit de esta sesión (`470d506`) solo tocó un comentario en `NuevaVentaModal.jsx`, no la lógica de bloqueo. Lo que esta entrada describía como bug en realidad era la decisión deliberada del commit `6d645ed` (Prompt 7, 2026-06-13, 3 días antes) que había revertido conscientemente "bloquea todo" → "solo Efectivo". La auditoría de Sesión 23 confirmó "solo Efectivo" como la regla vigente y la dejó uniforme en todo el sistema. Esta entrada queda como registro histórico de la confusión, no como guía vigente.

8. **Crear cliente desde Modo Caja fallaba** con `clientes.cuit does not exist`.
   - Fix: en [ClienteAltaRapidaModal.jsx](src/components/shared/ClienteAltaRapidaModal.jsx) mapear `cuit` → columna `documento`.

9. **CHECK constraint clientes.condicion_iva** falla con `'consumidor_final'`.
   - Fix: usar códigos cortos `'CF'/'RI'/'Monotributo'/'Exento'` que coinciden con el CHECK de la DB.

10. **HistorialTurnoModal en Modo Caja vacío** — query a `comprobantes.user_id` que no existe.
    - Fix: filtrar por turno (fecha apertura/cierre) en lugar de user_id.

11. **PanelCarrito sin clientes** — nunca hacía fetch, array vacío hasta crear uno via Alta Rápida.
    - Fix: agregar `useEffect` que carga clientes de la empresa al montar.

12. **NuevaFacturaProveedorModal autocompletado vacío** — query `precio_costo` (columna no existe).
    - Fix: usar `costo_compra` (la columna real).

13. **Devolución a Consumidor Final bloqueada** — `NuevaDevolucionModal` exigía cliente.
    - Fix: si hay `comprobante` de origen, permitir `cliente_id=null` (Consumidor Final).

14. **`movimientos_inventario.user_id` no existía** + CHECK `tipo` muy restrictivo.
    - Migration 037 + 038: `ADD COLUMN user_id` + ampliar CHECK a `['entrada','salida','ajuste','ingreso','egreso']`.

15. **`movimientos_inventario_tipo_check` violado por RPC `crear_devolucion`** — usaba `'ingreso'`.
    - Resuelto por migration 038.

16. **Compras `moneda` + `tipo_cambio_tasa` faltantes** → INSERT explotaba.
    - Migrations 030 + 031: `ALTER TABLE ADD COLUMN`.

17. **ChequesSection `comprobantes.created_at` no existe**.
    - Fix: `.order('fecha', ...)` en lugar de `created_at`.

18. **NuevaVentaModal productos vacíos al abrir** — race condition: `init()` ejecutaba `setProducts([])` después del search.
    - Fix: eliminar el `setProducts([])` redundante en `init()`.

19. **PlanCuentas dialogs sin DialogDescription** — warnings de accesibilidad Radix.
    - Fix: agregar `DialogDescription` a Nueva Cuenta + Nuevo Asiento.

20. **Logo Kairox reemplazado por "K" placeholder** en rediseño Aurora.
    - Fix: restaurar `<img src="/kairox-logo.png" />` en [Sidebar.jsx](src/components/Sidebar.jsx).

21. **Hora "12:00" en compras nuevas** — `getDateFromInputAR` siempre forzaba 12:00 UTC.
    - Fix: si la fecha del input es HOY → usa `getNowAR()` con hora actual. Si es otro día → mantiene 12:00 (default neutro).

22. **Dashboard no se actualizaba en tiempo real** — staleTime 60s sin invalidación.
    - Fix: `refetchOnMount: 'always'`, `refetchOnWindowFocus: true`, `refetchInterval: 30s`, `staleTime: 0`.

23. **Reportes con formato US `$150000.00`** — el user pidió formato es-AR.
    - Fix: reemplazo de `toFixed(2)` por `formatCurrency()` en [ReportesSection.jsx](src/components/sections/ReportesSection.jsx) (8 ocurrencias).

24. **NUEVO FEATURE: Devolución a Proveedor con UI completa**.
    - Creado [NuevaDevolucionProveedorModal.jsx](src/components/compras/NuevaDevolucionProveedorModal.jsx) (espejo del de cliente) + botón Undo2 en [FacturasCompraSection.jsx](src/components/compras/FacturasCompraSection.jsx).

**Bugs detectados por análisis estático (antes de que el user los disparara):**

25. **NuevaNCProveedorModal**: `tipo: 'DEBE'` viola CHECK `cuenta_corriente_proveedores_tipo_check` → cambiado a `'nota_credito'`.
26. **NuevaNDProveedorModal**: `tipo: 'HABER'` viola mismo CHECK → cambiado a `'nota_debito'`.
27. **AlertasStockBanner**: columnas `action`/`table_name`/`record_id`/`new_values` no existen en `audit_log` → mapeo correcto a `operacion`/`tabla`/`registro_id`/`new_data`.
28. **MapaRelaciones**: pide `pedidos.fecha_pedido` (no existe, es `fecha`) → corregido en select + render.
29. **ClienteDrillDown**: tabla `cuenta_corriente_clientes` no existe + filtro `tipo IN ('factura','ticket')` cuando los tipos válidos son `'venta'/'nota_credito'` → reescrito para usar `clientes.saldo_actual`.
30. **ProveedorDrillDown**: pide `saldo`/`limite_credito` en `cuenta_corriente_proveedores` (columnas inexistentes) → reescrito para calcular saldo sumando movimientos.
31. **ProveedorAltaRapidaModal**: `condicion_iva: 'responsable_inscripto'` viola CHECK → mapeo a códigos cortos (RI/Monotributo/Exento/CF/No Categorizado).

**Limpieza adicional:**
- **Cero referencias a "SAP" en el código fuente.** Limpiados 7 archivos: MapaRelaciones, ConfiguracionSection, ReporteParidad, DocumentFlowPanel, MonedaSelector, NuevaVentaModal, useTCParalelo.
- **parseNumberLocale estricto es-AR** consolidado: rechaza puntos como decimal, exige coma. Aplicado en Caja, NuevaVenta multi-pago, ProductosSection, CotizacionesSection, PedidosSection, OrdenesCompraSection, CompraRapidaSection, ClientDetailModal, ListasPrecioSection, PlanCuentasSection, ProveedoresSection. (Lista cerrada en sesión 20 — ver historial de sesiones.)
- **Display de moneda en ticket/PDF/cotización**: cuando la operación es en USD/EUR/BRL, todo el documento se muestra en esa moneda con TC + equivalente ARS como referencia chiquita.

**Migraciones aplicadas:**
- **037** — `movimientos_inventario.user_id` (FK profiles).
- **038** — CHECK `movimientos_inventario.tipo` ampliado.

**Convenciones nuevas:**
- **`movimientos_inventario.tipo`** acepta sinónimos `entrada↔ingreso` y `salida↔egreso`.
- **Cálculos numéricos**: si el resultado va a un input controlado por `parseNumberLocale`, devolverlo en formato es-AR (coma decimal). NO usar `.toFixed(2)` directo — usar `.toFixed(2).replace('.', ',')`.
- **TanStack Query**: cuando una mutación afecta a más de una key (items + conteo padre), invalidar AMBAS en `onSuccess`.
- **Radix Dialog + DropdownMenu**: usar `onSelect={(e) => { e.preventDefault(); setTimeout(fn, 0); }}` para evitar race conditions de focus management.
- **Devoluciones a Consumidor Final**: válidas. El sistema debe permitir `cliente_id=null` cuando hay comprobante de origen.
- **Display de moneda**: internamente ARS; la vista convierte a la moneda registrada usando `tipo_cambio_tasa`.
- ~~**Caja cerrada = NADA**. No hacer excepciones por método de pago.~~ **SUPERADO (Sesión 23):** esta convención nunca se implementó realmente (ver corrección en bug #7 arriba) y contradecía la regla vigente. La regla única y definitiva es "solo Efectivo requiere caja abierta" — ver Convenciones (REGLAS DE ORO) al inicio del archivo.
- **Nada de menciones a SAP**: en código, comentarios ni UI. Es deuda de marca.

**Estado actual del repo**: production-ready. Build verde. Sin bugs conocidos en flujos críticos (Ventas POS, Factura formal, NC, ND, Devoluciones, Compra Rápida, Modo Caja, Configuración 8 tabs, Reportes).

**Pendientes para próxima sesión:**
- Probar Pedido → Entrega → Factura end-to-end con la nav cruzada del Document Flow.
- Continuar parseNumberLocale en las secciones pendientes.
- Redeploy de Edge Function `emitir-cae` con alícuotas reales (homologación AFIP).
- Probar Mercado Pago con credenciales reales en sandbox.

---

### Sesión 2026-06-15 (sesión 15 — Luciano) — Prompt 15: Integración Mercado Pago — webhook automático de pagos

**Branch:** `master` (pendiente commit)

**Objetivo:** registrar automáticamente en KAIROX los cobros aprobados de Mercado Pago sin intervención manual, vía webhook Edge Function. Integración completa: backend (validación de firma, deduplicación, inserción vía RPC existente) + frontend (modal de configuración + estado real en Tab 5 de Configuración).

**Archivos creados:**
- `supabase/functions/mp-webhook/index.ts` — Edge Function Deno `--no-verify-jwt`. Flujo: valida firma HMAC-SHA256 del header `x-signature` (solo si `webhook_secret` configurado), ignora eventos que no sean `payment` con `status=approved`, consulta `GET /v1/payments/{id}` con el `access_token` de la empresa, deduplicación por `LIKE 'MP #ID%'` en `movimientos_bancarios`, llama RPC `insertar_movimiento_bancario_externo`, actualiza `ultimo_sync`. URL: `{SUPABASE_URL}/functions/v1/mp-webhook?empresa_id=EMPRESA_UUID`. Deploy: `supabase functions deploy mp-webhook --no-verify-jwt`.
- `src/components/bancos/ConfigMercadoPagoModal.jsx` — Modal de configuración MP con: pasos de instrucciones inline, webhook URL con botón copiar, campo Access Token (type=password) con verificación inline contra `GET /users/me` MP API, Select cuenta bancaria destino (carga `cuentas_bancarias` activas de la empresa), campo Webhook Secret opcional. `handleGuardar` valida formato `APP_USR-`, re-verifica si no fue verificado en sesión, hace upsert en `integraciones_bancarias` con `onConflict: 'empresa_id,proveedor'`.

**Archivos modificados:**
- `src/components/sections/ConfiguracionSection.jsx` — Tab 5 (Integraciones) actualizado: card MP rich inline (logo azul MP, estado real conectado/sin configurar, webhook URL con copy button, último sync con `formatDateAR`, botón Conectar/Editar). State nuevo: `integracionMP`, `showConfigMP`, `supabaseUrl`. useEffect que carga integración de `integraciones_bancarias`. `reloadIntegracionMP()` callback. `<ConfigMercadoPagoModal>` renderizado al final del componente. Imports añadidos: `Copy`, `ConfigMercadoPagoModal`, `formatDateAR`.

**Constraints críticos aplicados:**
- `--no-verify-jwt` en el deploy — MP no envía JWT de Supabase
- Deduplicación: MP puede enviar el mismo evento más de una vez
- Solo pagos `approved`: `pending`/`in_process`/`rejected` se ignoran silenciosamente
- `access_token` empieza con `APP_USR-` — se valida formato antes de guardar
- `access_token` en texto plano por ahora (protegido por RLS). Futuro: Supabase Vault

**Checklist de testing manual:**
- Configurar con Access Token de sandbox de MP Developers
- Simular pago aprobado desde el panel de MP Developers
- Verificar que aparece en `movimientos_bancarios` con `origen='mercadopago'`
- Verificar que se muestra en BancosSection como movimiento normal
- Enviar mismo `payment_id` dos veces → solo un insert (deduplicación OK)

---

### Sesión 2026-06-15 (sesión 14 — Luciano) — Prompt 14: Reestructuración ConfiguracionSection SAP Administración-style
**Branch:** `master` (commit `8cf1765`)

**Objetivo:** centralizar toda la configuración del sistema en un único módulo con 8 tabs al estilo SAP B1 Administration, aplicando la REGLA DE ORO: *"Toda configuración vive en ConfiguracionSection. Los módulos operativos solo muestran y procesan datos."*

**Archivos creados:**
- `src/components/shared/IntegracionCard.jsx` — componente reutilizable para tarjetas de integración. Props: `nombre`, `descripcion`, `logo` (emoji), `estado` (`activo | inactivo | proximamente | error`), `onConfigure` (callback opcional). Se opaca al 60% cuando es "próximamente".

**Archivos modificados:**
- `src/components/sections/ConfiguracionSection.jsx` — **reescrito completo** con 8 tabs usando shadcn/ui `Tabs`:
  - **Tab 1 — Empresa:** nombre + logo (lógica intacta) + nuevos campos email, dirección, localidad, CP, provincia, rubro (todos en tabla `configuracion` via `updateConfig`). Muestra CUIT/condicion_iva como read-only desde `empresas` (se gestionan en Tab 3).
  - **Tab 2 — Finanzas y Moneda:** sección Moneda Paralela movida aquí (lógica idéntica) + placeholder "Condiciones de Pago".
  - **Tab 3 — Facturación y Documentos:** Wizard AFIP/ARCA movido aquí (lógica idéntica, toggle + stepper 3 pasos) + placeholders Tipos de Comprobante y Pie de Documento.
  - **Tab 4 — Inventario:** placeholders FIFO/LIFO/PPP, Unidades de Medida, Stock Mínimo Global. **Sesión 29:** el placeholder de valoración se reemplazó por el selector real Último Costo / Promedio Ponderado (FIFO sigue como placeholder "Próximamente") — ver entrada de Sesión 29 al principio del documento.
  - **Tab 5 — Integraciones:** grid de `IntegracionCard` para MP, Ualá, AFIP (estado real), WhatsApp Business, Google Sheets.
  - **Tab 6 — Alertas:** 4 toggles con umbrales numéricos (stock bajo, vencimiento CC, apertura caja, cheques) → `upsert` en tabla `configuracion` con `onConflict: 'empresa_id,clave'`.
  - **Tab 7 — Usuarios y Roles:** embed directo de `<UsuariosSection />` sin reescribir nada.
  - **Tab 8 — Sistema:** info versión (1.4.0), empresa_id, email usuario, estado DB + placeholder datos demo.
  - Acepta prop `initialTab` (string) para deep-link programático a cualquier tab.
- `src/components/Sidebar.jsx` — eliminado `{ id: 'usuarios', label: 'Usuarios', icon: Users }` de ADMINISTRACIÓN. Ahora solo tiene `configuracion`. Import `Users` removido.
- `src/components/Dashboard.jsx` — `case 'usuarios'` redirige a `<ConfiguracionSection initialTab="usuarios" />` en lugar de `<UsuariosSection />` (sin romper bookmarks/links existentes).
- `CONTEXT.md` — REGLA DE ORO documentada en Convenciones, tabla módulos actualizada, arquitectura de navegación actualizada (usuarios fuera del sidebar).

**Convenciones nuevas:**
- **REGLA DE ORO:** cualquier setting del sistema va en `ConfiguracionSection`. Los módulos operativos NO tienen settings internos.
- **`initialTab` prop:** cuando se necesita navegar a un tab específico de Configuración desde código externo (ej: redirect `usuarios → configuracion`), pasar `initialTab="<tab_id>"`. Tab IDs: `empresa | finanzas | facturacion | inventario | integraciones | alertas | usuarios | sistema`.
- **IntegracionCard:** para agregar una nueva integración, importar de `@/components/shared/IntegracionCard` y pasarle el `estado` correcto. Cuando esté live: cambiar `estado="proximamente"` a `estado="activo"` + agregar `onConfigure` callback si aplica.

---

### Sesión 2026-06-13 (sesión 6 — Nadia) — Testeo Document Flow + Fixes integrales + Devolución a Proveedor UI

**Objetivo:** después de pullear las 17 contribuciones de Luciano (Aurora redesign, Document Flow Prompts 1-6, Compra Rápida), recorrer secciones y arreglar bugs encontrados.

**Bugs detectados y fixes aplicados:**

1. **NuevaDevolucionModal exigía cliente incluso para Consumidor Final** ([NuevaDevolucionModal.jsx:88-96](src/components/ventas/NuevaDevolucionModal.jsx:88))
   - Síntoma: una venta a "Consumidor Final" (comprobante.cliente_id = null) no podía devolverse porque la validación bloqueaba.
   - Fix: si hay `comprobante` de origen, el cliente_id se obtiene de ahí (puede ser null y el RPC lo acepta). Solo exigir cliente en modo standalone.

2. **`movimientos_inventario.user_id` no existía** — pero el RPC `crear_devolucion` (migration 036 de Luciano) lo intenta insertar.
   - Fix: **migration 037** `ALTER TABLE movimientos_inventario ADD COLUMN user_id uuid REFERENCES profiles(id)` + NOTIFY pgrst.

3. **CHECK constraint `movimientos_inventario_tipo_check` solo aceptaba 'entrada'/'salida'/'ajuste'** — el RPC de Luciano usa `'ingreso'`/`'egreso'`.
   - Fix: **migration 038** DROP + RECREATE constraint con `['entrada','salida','ajuste','ingreso','egreso']`.

4. **ListasPrecioSection: contador `_itemCount` no se actualizaba en vivo**
   - Síntoma: al cargar precios especiales por producto y cerrar el modal, la tabla de listas seguía mostrando "0 productos".
   - Causa: al guardar/borrar item, solo invalidaba `ITEMS_KEY(listaId)` pero no `LISTAS_KEY(empresaId)` que es la query que carga el conteo.
   - Fix: invalidar AMBAS keys en `handleSaveItemPrecio` y `deleteItem.onSuccess`.

5. **TabRetenciones: no se podía guardar "Retención Practicada"** ([TabRetenciones.jsx:410-415](src/components/impuestos/TabRetenciones.jsx:410))
   - Síntoma: toast "Datos incompletos" aunque todos los campos estaban llenos.
   - Causa: `recalcMonto` devolvía formato US (`"4800.00"`) usando `.toFixed(2)` → `parseNumberLocale` estricto es-AR rechaza el punto como decimal → guardado interpreta el monto como NaN/0.
   - Fix: `recalcMonto` ahora aplica `.replace('.', ',')` para devolver formato es-AR (`"4800,00"`) compatible con el parser estricto.

**Feature nuevo: Devolución a Proveedor con UI completa**

Luciano había implementado el RPC `crear_devolucion(p_tipo='proveedor')` y la sección de listado `DevolucionesProveedorSection`, pero **no creó el modal ni el botón disparador**. Faltaba la mitad del feature.

- **CREADO** [src/components/compras/NuevaDevolucionProveedorModal.jsx](src/components/compras/NuevaDevolucionProveedorModal.jsx) — espejo del modal de cliente:
  - Carga `detalle_compras` de la factura (no `comprobante_items`).
  - Filtra ítems con saldo pendiente (`cantidad - cantidad_devuelta > 0`).
  - Checkbox "Descontar del stock" (default `true` para devolución a proveedor — la mercadería sale).
  - Compensación: Nota de Débito a proveedor / Reemplazo / Sin compensación.
  - Envía `p_tipo='proveedor'`, `p_compra_id`, `p_proveedor_id` al RPC `crear_devolucion`.
- **MODIFICADO** [FacturasCompraSection.jsx](src/components/compras/FacturasCompraSection.jsx): nueva columna "Acciones" + ícono `Undo2` (mismo que `HistorialVentas` para consistencia visual) en cada fila → abre el modal con la compra precargada.
- Al guardar, la devolución aparece automáticamente en **Compras → Devoluciones → Devoluciones a Proveedor**.

**Restaurado logo Kairox en Sidebar:** Luciano había reemplazado el logo real (`/kairox-logo.png`) por un placeholder con la letra "K" gradient en el rediseño Aurora. Sustituido por el `<img>` original manteniendo el estilo del nuevo Sidebar.

**Testeo manual realizado (todas OK):**

Dashboard, Sidebar con grupos colapsables (persiste en localStorage), Pedidos con KPIs, Devoluciones de cliente (con fixes), Listas de Precios (con fix de contador), Plan de Cuentas (Nueva Cuenta + Nuevo Asiento + Períodos), Impuestos > Alícuotas + Retenciones Practicadas (con fix), Cheques > Registrar cheque recibido, Compras > Facturas con nuevo botón Devolver, Inventario > Nuevo Producto, Proveedores > Nuevo Proveedor con ficha completa.

**Convenciones nuevas / refuerzos:**
- **Cálculos numéricos en el frontend:** cualquier valor calculado que vaya a un input controlado por `parseNumberLocale` debe devolverse en formato es-AR (coma decimal). NO usar `String(n.toFixed(2))` directamente — usar `.toFixed(2).replace('.', ',')`.
- **`movimientos_inventario.tipo`:** acepta sinónimos `entrada↔ingreso` y `salida↔egreso`. Los RPCs nuevos pueden usar cualquiera.
- **Devoluciones a Consumidor Final:** son válidas. El sistema debe permitir `cliente_id = null` cuando hay comprobante de origen.
- **TanStack Query invalidación:** cuando una mutación afecta a más de una key (ej: items + conteo en lista padre), invalidar **TODAS** las queries afectadas en `onSuccess`. No asumir que actualizar items refresca el padre.
- **UI espejada (Ventas ↔ Compras):** si Ventas tiene un patrón (ícono Undo2 para devolver en historial), Compras debe replicarlo en su sección equivalente (Facturas). Coherencia visual.

**Pendiente próxima sesión:**
- Probar el flujo end-to-end Document Flow completo (Pedido → Entrega → Venta → Devolución → NC) para asegurar la nav cruzada.
- Continuar parseNumberLocale en: ComprasSection cart, PlanCuentasSection monto asiento, ProveedoresSection pago, OnboardingWizard.
- Redeploy de `emitir-cae` con alícuotas reales por línea (homologación AFIP).

---

### Sesión 2026-06-13 (sesión 3) — Document Flow Prompt 4/6: Devoluciones + Notas de Débito UI
**Branch:** `master` (commit `10080de`)

**Objetivo:** construir la UI completa de Devoluciones de Clientes y Notas de Débito que consume las RPCs de migration 037.

**Archivos creados:**
- `src/components/ventas/NuevaDevolucionModal.jsx` — modal de devolución con dos modos: (a) pre-cargado desde comprobante (props `comprobante.id/numero_venta/cliente_id`) → fetcha `comprobante_items` filtrando `cantidad_entregada > cantidad_devuelta`, muestra tabla con inputs cantidad bounded por `maxDevolver`; (b) standalone con `ClienteSelector`. Opciones: `reingresa_stock` (checkbox, default false), `compensacion` (RadioGroup: nota_credito/reemplazo/pendiente), `reembolso_efectivo` (checkbox, solo visible si NC). Llama RPC `crear_devolucion`. Toast con número DEV + NC si aplica.
- `src/components/ventas/NuevaNotaDebitoModal.jsx` — modal ND: ClienteSelector, select de facturas del cliente (opcional), `concepto` (Textarea), `monto` (Input con parser AR 1.500,00). Llama RPC `crear_nota_debito tipo='emitida'`.
- `src/components/ventas/DevolucionesSection.jsx` — 2 sub-tabs: "Devoluciones de Clientes" (query `devoluciones WHERE tipo='cliente'` con expand inline de `devolucion_items`, badge CompensacionBadge, indicador stock, número NC) + "Notas de Débito" (query `notas_debito WHERE tipo='emitida'`). Botones "Nueva Devolución" (naranja) y "Nueva Nota de Débito" (ámbar).

**Archivos modificados:**
- `src/components/sections/VentasSection.jsx` — import `DevolucionesSection`; reemplaza placeholder `<div>Disponible en Prompt 4/6</div>` por `<DevolucionesSection />`.
- `src/components/ventas/HistorialVentas.jsx` — import `NuevaDevolucionModal` + `Undo2`; 2 estados nuevos (`devolucionComp`, `isDevolucionOpen`); columna "Ver" → "Acciones" (w-36); fila: botón `Eye` (detalle) + botón `Undo2` (solo si `sale.tipo === 'venta'`, stopPropagation). Click Undo2 setea `devolucionComp={id, numero_venta, cliente_id, cliente_nombre}` y abre modal.

**Fix crítico de build:** los nuevos modales importaban `toast` de `'sonner'` (no instalado). Corregido a `useToast` de `'@/components/ui/use-toast'` (patrón shadcn usado por todo el proyecto).

**PostgREST FK disambiguation:** DevolucionesSection usa `factura_origen:comprobantes!comprobante_id(numero_venta)` + `nota_credito:comprobantes!nota_credito_id(numero_venta)` para resolver las dos FKs que apuntan a la misma tabla `comprobantes`.

**Build verificado:** `vite build --mode development` → ✅ 3136 módulos, sin errores.

**Deploy:** `npx vercel deploy --prod --yes` → READY. https://kairox-gestion.vercel.app

---

### Sesión 2026-06-13 (sesión 2) — Fix 3.1: DocumentFlow + badge verbose en modal detalle Pedido
**Branch:** `master` (commit `0b0ce67`)

**Objetivo:** enriquecer el modal de detalle del Pedido (Dialog inline en `PedidosSection.jsx`) con visualización del Document Flow y badge de progreso de entrega más descriptivo.

**Problema:** al abrir un pedido, el modal mostraba estado, cliente, fecha, y tabla de items. Faltaba: badge verbose de progreso de entrega, chip chain `<DocumentFlow />` con cadena Pedido → Entrega(s) → Factura, colores en columna de entregado.

**Patrón IIFE del modal:** el modal usa `{detailPedido && (() => {...})()}` — no es un sub-componente, por lo que los hooks deben vivir en el scope del componente padre (`PedidosSection`) y ser leídos por closures dentro del IIFE. Se aplicó en dos partes (contexto anterior + esta sesión):

**Parte 1 (sesión anterior, ya aplicada):**
- Import de `DocumentFlow` de `@/components/shared/DocumentFlow`
- 3 estados nuevos: `entregasDetalle`, `loadingEntregas`, `entregasRefreshKey`
- `useEffect` que fetcha `entregas + comprobantes(numero_venta)` filtrado por `pedido_id` cuando el modal abre, con `entregasRefreshKey` como dependencia de refresh
- `handleEntregaSuccess` actualizado para hacer `setEntregasRefreshKey(k => k+1)` además del `fetchAll()`

**Parte 2 (esta sesión — Edit 5/5):**
- **Badge verbose de entrega:** tres variantes según `totalEnt` vs `totalPed`:
  - `totalEnt >= totalPed && totalPed > 0` → badge verde "✓ Completo (X/Y u.)"
  - `totalEnt > 0 && totalEnt < totalPed` → badge ámbar "Parcial X/Y u."
  - Sin entrega → badge gris "Sin entregar"
- **DocumentFlow chip chain:** construida desde `detailPedido` + `entregasDetalle`. Chips: `pedido` (active), un chip `entrega` por cada fila en `entregasDetalle`, más un chip `factura` si alguna entrega tiene `comprobante_id`. Sin `onNavigate` (informational-only — chips render como `cursor-default opacity-60`).
- **Tabla de items:** columnas renombradas a "Pedido" / "Entregado". La columna "Entregado" muestra en verde si completo, ámbar si parcial, gris si 0.
- **Modal scrolleable:** `max-h-[90vh] overflow-y-auto` para pedidos con muchos ítems.

**Build verificado:** `vite build --mode development` → ✅ 3130 módulos, sin errores.

**Pedidos históricos sin entregas:** `entregasDetalle` queda `[]` → DocumentFlow muestra solo el chip del Pedido (sin crash ni errores).

**Vercel deploy roto detectado:** al revisar Vercel, el último deploy automático correspondía a commit `69d9f38` (light mode v2). Los 5 commits siguientes (Document Flow Prompts 1/2/3 + CONTEXT.md fixes + Fix 3.1) NUNCA se deployaron. Se disparó deploy manual via MCP Vercel.

---

### Sesión 2026-06-13 — Document Flow Prompt 3/6: UI Ventas
**Branch:** `master`

**Objetivo:** construir toda la capa UI del Document Flow de Ventas. Reglas: no romper NuevaVentaModal ni CotizacionesSection; PedidosSection se adapta, no se reescribe desde cero; Sidebar colapsable se aplica a TODOS los grupos.

**Archivos creados:**
- `src/components/sections/VentasSection.jsx` — **reescrito** como tab shell (`initialTab` prop, tabs: cotizaciones / pedidos / entregas / historial / devoluciones). Botón "Nueva Venta (POS)" fuera de los tabs. Cada sidebar item navega con `initialTab` diferente.
- `src/components/ventas/EntregasSection.jsx` — listado de `entregas` con expand inline de `entrega_items`. Filtro origen (Todos/Manual/POS). Embedded selects PostgREST: `clientes(nombre)`, `pedidos(numero)`, `comprobantes(numero_venta)`, `entrega_items(*, productos(nombre))`.
- `src/components/ventas/GenerarEntregaModal.jsx` — tabla de items pendientes (pedido vs entregado), input cantidad por fila (default=pendiente), llama RPC `crear_entrega(p_empresa_id, p_user_id, p_pedido_id, p_items)`.
- `src/components/shared/DocumentFlow.jsx` — chip chain visual con ArrowRight entre chips. Props: `chips[]` + `onNavigate(tipo, id)`.
- `src/components/shared/ClienteSelector.jsx` — select de clientes + DrillDown (ojo) + Alta Rápida (UserPlus).
- `src/components/shared/ClienteDrillDown.jsx` — popover inline: saldo CC + últimas 3 compras. Fetcha `cuenta_corriente_clientes` + `comprobantes`.
- `src/components/shared/ClienteAltaRapidaModal.jsx` — alta rápida: nombre (req) + cuit + teléfono + condicion_iva. On save → `onCreated(cliente)` auto-selecciona.

**Archivos modificados:**
- `src/components/sections/PedidosSection.jsx` — importa `GenerarEntregaModal` + `NuevaVentaModal`. Nuevo: `ProgressoBadge` (verde si completo, ámbar si parcial). Botón **Truck** si `['confirmado','en_preparacion']` y hay pendiente → abre `GenerarEntregaModal`. Botón **Receipt** si `en_preparacion → facturado` → abre `NuevaVentaModal(pedido=...)` → `onSaleSuccess` actualiza pedido a 'facturado'. Tabla: columna "Progreso" añadida (colspan 7→8). Modal detalle: añade col Ent. + botones Generar Entrega y Facturar.
- `src/components/ventas/NuevaVentaModal.jsx` — añade `pedido = null` prop. En init useEffect, si `pedido?.pedido_items`, pre-carga cart (idéntico a cotizacion). Pre-selecciona `pedido.cliente_id`.
- `src/components/Dashboard.jsx` — elimina imports `CotizacionesSection`, `PedidosSection`. Routing: `cotizaciones`/`pedidos`/`ventas` → `<VentasSection initialTab="...">`. Nuevos casos: `entregas` → `initialTab="entregas"`, `historial_ventas` → `initialTab="historial"`.
- `src/components/Sidebar.jsx` — imports añadidos: `Box, ScrollText, RotateCcw, ChevronDown, ChevronRight`. VENTAS group: +`entregas` (Box) +`historial_ventas` (ScrollText). Todos los grupos: colapsables con `useState` (default: todos expandidos), persistencia en `localStorage('kx-sidebar-collapsed')`.

**Build verificado:** `vite build --mode development` → ✅ 3129 módulos sin errores.

**Tests manuales pendientes:**
- POS: venta → verificar fila en `entregas` con `origen='implicita'`
- Pedido: crear → avanzar a `en_preparacion` → Generar Entrega → verificar stock decrementado + fila en `entregas`
- Pedido: `en_preparacion` → Facturar → NuevaVentaModal pre-cargado con items + pedido → venta → pedido pasa a `facturado`
- EntregasSection: expandir row → ver items con nombre de producto

---

### Sesión 2026-06-13 — Document Flow Prompt 2/6: RPCs de negocio
**Branch:** `master`

**Objetivo:** dar vida al modelo de datos del Prompt 1/6 con RPCs transaccionales. Regla de oro: leer `crear_venta` completa desde la DB antes de modificarla.

**Hallazgos de schema verificados:**
- `movimientos_inventario.tipo` = `'salida'` / `'ingreso'` (no 'egreso'), tiene `tenant_id` (= empresa_id)
- `comprobante_items.producto_id` (no `produto_id` — CONTEXT.md anterior era inexacto)
- `crear_compra` RPC → NO existe; compras son INSERTs directos desde frontend
- `pedidos.cliente_id` ✅ · `ordenes_compra.proveedor_id` ✅ · `compras.proveedor_id` ✅

**`crear_venta` (modificada):**
- Copia exacta de la función v033 + 2 variables nuevas en DECLARE (`v_entrega_id`, `v_numero_entrega`)
- Bloque nuevo entre UPDATE neto_gravado y loop de pagos: genera `ENT-YYYY-NNNN` en `entregas` con `origen='implicita'` + `entrega_items` por item + actualiza `comprobante_items.cantidad_entregada`
- Stock NO vuelve a tocarse en el nuevo bloque (ya fue decrementado en el loop de items)

**Funciones nuevas (aditivas):**
- `crear_entrega(empresa_id, user_id, pedido_id, items)` — camino largo: lock+check stock, `UPDATE productos` (decremento), `movimientos_inventario tipo='salida'`, `entrega_items`, `pedido_items.cantidad_entregada +=`
- `crear_recepcion(empresa_id, user_id, orden_compra_id, items)` — espejo: `UPDATE productos` (incremento), `movimientos_inventario tipo='ingreso'`, `recepcion_items`, `ordenes_compra_items.cantidad_recibida +=`
- `crear_recepcion_implicita(empresa_id, user_id, compra_id)` — solo documental: lee `detalle_compras`, crea `recepciones`+`recepcion_items`, actualiza `detalle_compras.cantidad_recibida`; NO toca stock (ya actualizado por frontend al guardar la compra)
- `crear_factura_desde_entrega(...)` — idéntica firma a `crear_venta` pero sin stock/movimientos; sets `comprobante_items.cantidad_entregada = cantidad`; vincula `entregas.comprobante_id`; actualiza `pedido_items.cantidad_facturada` si viene `pedido_item_id`

**Smoke test:** funciones compilaron correctamente (5/5 en pg_proc). Test funcional desde browser pendiente (hacer venta → verificar fila en `entregas` con `origen='implicita'`).

---

### Sesión 2026-06-13 — Document Flow Prompt 1/6: Modelo de datos
**Branch:** `master`

**Objetivo:** crear exclusivamente el modelo de datos del Document Flow SAP-style (ningún archivo React tocado, ninguna RPC existente modificada).

**Parte 1 — Contadores en items existentes:**
- `comprobante_items`: +`cantidad_entregada`, +`cantidad_devuelta`
- `pedido_items`: +`cantidad_entregada`, +`cantidad_facturada`
- `detalle_compras`: +`cantidad_recibida`, +`cantidad_devuelta`
- `ordenes_compra_items`: `cantidad_recibida` ya existía (3-way match migration 012) → solo +`cantidad_facturada`, +`cantidad_devuelta`

**Parte 2 — Tabla `entregas` + `entrega_items`:**
- Flujo Ventas: Pedido → Entrega → Factura. `origen IN ('implicita','manual')`, `estado IN ('pendiente','entregado','parcial','anulado')`. FK a `pedidos`, `comprobantes`, `clientes`.
- `entrega_items`: FK a `pedido_items` (trazabilidad línea a línea).

**Parte 3 — Tabla `recepciones` + `recepcion_items`:**
- Flujo Compras: OC → Recepción → Factura Compra. FK a `ordenes_compra`, `compras`, `proveedores`.
- `recepcion_items.orden_compra_item_id` → `ordenes_compra_items(id)` (nombre real con "es").

**Parte 4 — Tabla `devoluciones` + `devolucion_items`:**
- Tipo `('cliente','proveedor')`. Compensación `('nota_credito','reemplazo','pendiente')`.
- `nota_credito_id REFERENCES public.comprobantes(id)` — en KAIROX las NCs son filas de `comprobantes` con `tipo='nota_credito'`, no tabla separada.
- Referencias de reemplazo: `entrega_reemplazo_id`, `recepcion_reemplazo_id`.

**Parte 5 — Tabla `notas_debito`:**
- Tipo `('emitida','recibida')`. `cc_movimiento_id` FK suave (sin constraint) — se completa al procesar.

**Parte 6 — Función `siguiente_numero_documento(empresa_id, tabla, columna, prefijo)`:**
- Genera correlativo tipo `ENT-2026-0001`. COUNT por empresa+año+prefijo. SECURITY DEFINER, solo `authenticated`.

**Ajuste clave detectado en schema real:** `ordenes_compra_items` (plural) vs spec que decía `orden_compra_items` (singular). Verificado con `information_schema` antes de escribir la migration.

---

### Sesión 2026-06-12 (noche) — Light mode v2: Stripe-style contrast + acentos saturados + sombras reales
**Branch:** `master` (commit `69d9f38`)

**Objetivo:** light mode se veía plano (todo blanco sobre blanco). Mejorarlo con el principio Stripe: fondo gris clarito vs cards blancas, acentos de color más saturados sobre fondo claro, sombras con elevación real.

**Cambio 1 — Diferenciación fondo/card:**
- `src/index.css` `:root`: `--kx-bg: 246 246 248` (gris #f6f6f8, antes 250 250 250), `--kx-surface-2: 250 250 251`, `--kx-border: rgba(0,0,0,0.08)` (antes 0.06).
- Las cards (`--kx-surface: 255 255 255` blanco puro) ahora "flotan" sobre el fondo gris sin necesitar bordes gruesos.

**Cambio 2 — Acentos saturados en light:**
- `:root`: acentos reemplazados por variantes -600 de Tailwind (más saturadas sobre fondo claro): `--kx-violet: 124 58 237` (violet-600), `--kx-green: 5 150 105` (emerald-600), `--kx-blue: 37 99 235` (blue-600), `--kx-amber: 217 119 6` (amber-600), `--kx-red: 220 38 38` (red-600).
- `.dark`: acentos originales restaurados **explícitamente** (antes solo en `:root` y `.dark` los heredaba — al cambiar `:root` se rompería dark): `--kx-violet: 157 123 255`, `--kx-green: 61 220 151`, etc.
- **Convención crítica:** si los acentos `--kx-*` solo están en `:root`, `.dark` los hereda. Al cambiar `:root` para light, **siempre agregar los valores dark explícitamente en `.dark`**.

**Cambio 3 — Sombras con elevación real:**
- Hero/KPI/cotizaciones KPI rows (wrappers de grid): `shadow-sm dark:shadow-none`.
- Paneles standalone (Stock, Cotizaciones, gráficos, Acciones Rápidas): `shadow-sm dark:shadow-none` en reposo + `hover:shadow-lg dark:hover:shadow-[0_4px_20px_rgba(0,0,0,0.4)]` en hover (antes solo `hover:shadow-md`).
- Header: `shadow-sm dark:shadow-none` — separa el topbar del contenido.

**Cambio 4 — Sidebar/Header automático:**
- Sidebar/Header usan `bg-kx-surface/80 backdrop-blur-md`. Con `--kx-bg` gris-claro, se ven claramente más blancos que el fondo → separación visual automática sin cambios adicionales.

**Convenciones nuevas:**
- En light mode, los colores de acento sobre fondos claros necesitan -600 (más saturados) vs dark que usa -400/-300 (más luminosos sobre fondo oscuro).
- `shadow-sm dark:shadow-none` es el patrón estándar para elevar cards en light sin afectar dark.

---

### Sesión 2026-06-12 (tarde) — Visual polish v3: acentos de color + hover elevation + aurora light mode
**Branch:** `master` (commit `283527d`)

**Objetivo:** tres refinamientos visuales sobre el rediseño v3 aprobado.

**Cambio 1 — Bordes de acento `border-t-2` por categoría:**
Aplicado en `DashboardSection.jsx` a cada card según su semántica:
- Violet (`--kx-violet`): Ventas del mes, Ventas del día, Cotizaciones/mes, Aprobadas pendientes
- Green (`--kx-green`): Caja, Balance neto, Tasa de conversión
- Blue (`--kx-blue`): Margen bruto
- Red (`--kx-red`): Gastos del mes
- Amber (`--kx-amber`): Deuda clientes, Monto convertido

**Cambio 2 — Hover elevation:**
- Cards dentro de grids `overflow-hidden` (hero, KPI, cotizaciones KPI rows): solo `hover:bg-kx-surface-2 transition-colors duration-200` — el translate se recortaría con overflow:hidden.
- Paneles standalone (Stock, Cotizaciones, gráficos, Acciones Rápidas): `transition-all duration-200 ease-out hover:shadow-md dark:hover:shadow-[0_4px_20px_rgba(0,0,0,0.4)] hover:-translate-y-0.5 hover:border-kx-border-hover`.

**Cambio 3 — Aurora más visible en light mode:**
`src/components/ui/AuroraBackground.jsx`:
- Blobs 1 y 2: `opacity-[0.22] dark:opacity-[0.35]` (antes 0.18), `blur-[60px] dark:blur-[80px]` (antes solo 80px).
- Blob 3 (verde): `opacity-[0.12] dark:opacity-[0.15]` (antes 0.10).

**Convención nueva:** `overflow-hidden` en un contenedor padre recorta `transform: translateY()` de sus hijos — no usar hover elevation translate dentro de grids con overflow:hidden. Alternativa: solo color change (`hover:bg-kx-surface-2`).

---

### Sesión 2026-06-12 (tarde) — Rediseño v3 completo: Aurora theme + Shell + Dashboard
**Branch:** `master` (commit `27562b5`)

**Objetivo:** rediseño visual completo del ERP — sistema de design tokens, background animado, sidebar/header/shell nuevos, DashboardSection reconstruido.

#### 1. Sistema de tokens CSS `--kx-*` (`src/index.css` + `tailwind.config.js`)
Variables en formato `R G B` para soportar modificadores de opacidad Tailwind (`bg-kx-surface/40`):
- `--kx-bg`, `--kx-surface`, `--kx-surface-2` — fondos y superficies
- `--kx-border`, `--kx-border-hover` — bordes en formato `rgba()`
- `--kx-text`, `--kx-text-2`, `--kx-text-3` — jerarquía tipográfica
- `--kx-violet`, `--kx-green`, `--kx-blue`, `--kx-amber`, `--kx-red` — acentos semánticos
- `tailwind.config.js`: todos como `'kx-*': 'rgb(var(--kx-*) / <alpha-value>)'` en `colors.extend`, keyframes `kx-float1/2/3` para aurora, animaciones 22s/26s/30s.

#### 2. Aurora Background (`src/components/ui/AuroraBackground.jsx`) — NUEVO
3 blobs `position:fixed z-index:-10` con `radial-gradient + blur + keyframe` flotando independientemente. Componente puro, sin lógica, sin props.

#### 3. Sidebar reescrito (`src/components/Sidebar.jsx`)
Array `NAV_GROUPS` con 7 grupos (GENERAL/VENTAS/COMPRAS/INVENTARIO/FINANZAS/CONTABILIDAD/ADMINISTRACIÓN). Layout: `fixed md:relative inset-y-0 left-0` — overlay en mobile, flex item en desktop. Elimina completamente los `ml-{x}` del contenido. Footer con avatar gradiente + nombre + rol + LogOut.

#### 4. Header reescrito (`src/components/Header.jsx`)
`h-14 bg-kx-surface/80 backdrop-blur-md`. Breadcrumb izquierda (`empresa · sección`). Derecha: búsqueda ⌘K, toggle tema (Sun/Moon), Bell con dropdown de notificaciones completo, CTA "Nueva Venta", Avatar dropdown con configuración/logout.

#### 5. Dashboard shell (`src/components/Dashboard.jsx`)
`flex h-full relative z-10`. `AuroraBackground` fuera del flex container (fixed). `isSidebarOpen` inicia en `false`. Sin `ml-{x}`.

#### 6. DashboardSection reconstruida (`src/components/sections/DashboardSection.jsx`)
- **Hero row:** `grid-cols-[1.4fr_1fr_1fr] gap-px bg-kx-border rounded-2xl overflow-hidden` — Ventas mes / Caja / Margen bruto. Técnica `gap-px bg-kx-border` = divisores 1px sin bordes reales.
- **KPI row:** `grid-cols-2 md:grid-cols-4` — Ventas día / Gastos mes / Balance neto / Deuda clientes.
- **Bottom grid:** `grid-cols-1 lg:grid-cols-[1.3fr_1fr]` — panel Stock alerts + panel Cotizaciones.
- **KPIs Cotizaciones:** grid 4 cards preservado (Cotizaciones/mes · Tasa conversión · Aprobadas · Monto convertido).
- **Gráficos:** Ventas 7d (BarChart) + Flujo Caja 6m (LineChart) — ambos en panels `bg-kx-surface`.
- **Acciones Rápidas:** 6 `QuickActionButton` con gradientes.

**Error detectado y corregido:** `tailwind.config.js` no permite dos keys `colors` en `extend` — el segundo sobreescribe al primero (shadcn perdido). Fix: merge de ambos en un único objeto `colors`.

**Convenciones nuevas:**
- CSS variables kx-* como canales RGB (`250 250 250` no `#fafafa`) para que Tailwind pueda aplicar opacidad arbitraria (`/40`, `/80`, etc.).
- `fixed md:relative` en sidebar elimina la necesidad de margin en el contenido — el sidebar en desktop es un flex item normal.
- Técnica `gap-px bg-kx-border overflow-hidden rounded-2xl` en grids crea divisores 1px de color sin borders reales en cada celda.

---

### Sesión 2026-06-12 (tarde) — Reglas UX globales: caja cerrada bloquea todo + parseNumberLocale es-AR estricto + ticket en moneda elegida

**Objetivo:** después de testear el módulo Impuestos de Luciano (todo OK), aplicar reglas de UX consistentes en toda la app para que no haya inconsistencias entre secciones.

#### 1. Caja cerrada bloquea TODO

- **Antes:** la regla histórica era "solo Efectivo requiere caja abierta". Esto generaba confusión porque dejaba registrar ventas Transferencia/Tarjeta/Cheque con caja cerrada.
- **Ahora (en esta sesión):** cualquier venta o movimiento requiere caja abierta, sin importar el método. Caja abierta = todo permitido.
- Archivos: [src/components/ventas/NuevaVentaModal.jsx](src/components/ventas/NuevaVentaModal.jsx) y [src/components/sections/CajaSection.jsx](src/components/sections/CajaSection.jsx) — validación temprana con toast "⛔ Caja cerrada".
- **⚠️ REVERTIDO (commit `6d645ed`, Prompt 7, 2026-06-13, un día después):** "fix: NuevaVentaModal — solo bloquea si pagosFinales incluye Efectivo" / "fix: CajaSection — solo movimientos de Efectivo requieren caja abierta". Fue una decisión deliberada y consciente, no un descuido. **La regla vigente desde Prompt 7 (y confirmada/unificada en Sesión 23) es "solo Efectivo bloquea"** — ver Convenciones (REGLAS DE ORO).

#### 2. `parseNumberLocale` estricto formato es-AR

Reescritura completa en [src/lib/currencyUtils.js](src/lib/currencyUtils.js):
- **Punto** = separador de miles → grupos de EXACTAMENTE 3 dígitos
- **Coma** = único separador decimal
- El primer grupo puede tener 1–3 dígitos; los demás SIEMPRE 3
- Rechaza con `NaN`: `120000.50`, `500.00`, `1.4`, `1,234.56`, múltiples comas, caracteres no numéricos
- Acepta: `500.000`, `120.000,50`, `1.668,21`, `0,0036`

Bug previo: el RPC inserta lo que recibe; si el input HTML `type="number"` interpreta `300.000` como `300` (browser locale), el campo `monto` del form ya contiene `300` antes de `parseNumberLocale`. Solución: cambiar inputs a `type="text" inputMode="decimal"` y parsear en submit.

#### 3. Inputs de plata migrados (`type=text inputMode=decimal` + `parseNumberLocale`)

Archivos completados esta sesión:
- ✅ [CajaApertura.jsx](src/components/caja/CajaApertura.jsx) — monto inicial
- ✅ [CajaCierre.jsx](src/components/caja/CajaCierre.jsx) — saldo real arqueo
- ✅ [CajaSection.jsx](src/components/sections/CajaSection.jsx) — nuevo movimiento (monto)
- ✅ [NuevaVentaModal.jsx](src/components/ventas/NuevaVentaModal.jsx) — montos multi-pago
- ✅ [ProductosSection.jsx](src/components/sections/ProductosSection.jsx) — `costo_compra` y `precio_venta` (alta + edit)
- ✅ [CotizacionesSection.jsx](src/components/sections/CotizacionesSection.jsx) — `precio_unitario` por ítem
- ✅ [PedidosSection.jsx](src/components/sections/PedidosSection.jsx) — `precio_unitario` por ítem

**Pendientes próxima sesión** (requieren refactor del estado del carrito porque guardan valores parseados en cada keystroke):
- ⏳ ComprasSection — `costo_unitario` cart + edit
- ⏳ ClientDetailModal — cobros CC en efectivo
- ⏳ ListasPrecioSection — precio por ítem
- ⏳ PlanCuentasSection — monto asiento manual
- ⏳ ProveedoresSection — pago a proveedor
- ⏳ ConfiguracionSection — eventuales montos
- ⏳ OnboardingWizard — montos iniciales

#### 4. Ticket y PDF de venta DISPLAY en moneda elegida

[ComprobantePrintModal.jsx](src/components/ventas/ComprobantePrintModal.jsx) y [pdf/ComprobantePDF.jsx](src/components/ventas/pdf/ComprobantePDF.jsx):

- Si `comprobante.moneda === 'ARS'`: todos los precios, subtotales, pagos y total en pesos como antes.
- Si moneda extranjera (USD/EUR/BRL) con `tipo_cambio_tasa > 0`: **TODO en la moneda elegida**, convertido desde ARS dividiendo por el TC. Headers de columna incluyen la moneda (`P. Unit. (USD)`). Al final del ticket aparece el TC y el equivalente ARS como referencia chiquita.
- Misma lógica aplicada en el modal de detalle de cotización ([CotizacionesSection.jsx:567](src/components/sections/CotizacionesSection.jsx:567)).

**Convención:** internamente todo se guarda en ARS (con TC) — solo la VISTA cambia según la moneda elegida.

#### 5. Cantidades como enteros estrictos

Inputs de cantidad ahora con `type="number" min="1" step="1"` + `onChange={e => updateItem(...e.target.value.replace(/[^\d]/g, ''))}` — imposible tipear punto, coma o decimales:
- ✅ [OrdenesCompraSection.jsx](src/components/sections/OrdenesCompraSection.jsx) — `cantidad_pedida`
- ✅ [CotizacionesSection.jsx](src/components/sections/CotizacionesSection.jsx) — cantidad por ítem
- ✅ [PedidosSection.jsx](src/components/sections/PedidosSection.jsx) — cantidad por ítem
- ✅ [ProductosSection.jsx](src/components/sections/ProductosSection.jsx) — stock_actual, stock_minimo, movimientos
- ⏳ ComprasSection y NuevaVentaModal cart (también pendientes)

#### 6. Dropdown unificado de unidades de medida

Nuevo helper [src/lib/unidadesMedida.js](src/lib/unidadesMedida.js): export `UNIDADES_COMUNES` (11 opciones: Unidad, Kilogramos, Gramos, Litros, Mililitros, Metros, Centímetros, Caja, Pack, Docena, Bolsa) + `getShortUnit(unit)` para mostrar `kg`/`gr`/`lt`/etc.

Aplicado como `<select>` inline (no via componente porque mantiene Radix simple):
- ✅ [OrdenesCompraSection.jsx](src/components/sections/OrdenesCompraSection.jsx) — unidad por ítem
- ✅ [CotizacionesSection.jsx](src/components/sections/CotizacionesSection.jsx) — unidad por ítem
- ✅ [ProductosSection.jsx](src/components/sections/ProductosSection.jsx) — unidad del producto (antes no existía en el form, default `'Unidad'`)

#### 7. Eliminado form duplicado "Nuevo Proveedor" de Inventario

[ProductosSection.jsx](src/components/sections/ProductosSection.jsx) tenía un Dialog "Registrar Proveedor" con campos básicos (nombre, contacto, teléfono, email, dirección), que se duplicaba con el Dialog completo de ProveedoresSection (CUIT, razón social, condición IVA, localidad, provincia, condición/plazo pago). Quitado el Dialog, botón, handler y state. **El alta de proveedores se hace solo desde la sección Proveedores.**

#### Bug observado en producción (solo cacheo del browser)

El user vio una caja abierta con `monto_inicial=$300` después de mis fixes. La DB lo confirmó. La causa: el browser tenía cacheada la versión vieja del JS (cuando el input era `type="number"` y `parseFloat("300.000")` daba 300). Solución: **hard reload (`Ctrl+Shift+R`)** después de cambios en código. Vite manda HMR pero el browser no siempre lo aplica si tiene service worker o cache agresiva.

**Convenciones nuevas:**
- **Inputs de plata:** SIEMPRE `type="text" inputMode="decimal" placeholder="0,00"` + parsear con `parseNumberLocale()` en submit. Nunca `type="number"` para campos monetarios.
- **Inputs de cantidad:** `type="number" min="1" step="1"` + `onChange={e.target.value.replace(/[^\d]/g, '')}`. Sin decimales.
- **Display de moneda:** internamente ARS; la vista (ticket, PDF, cotización detalle) convierte a la moneda registrada del comprobante usando `tipo_cambio_tasa`.
- ~~**Caja cerrada = nada se puede hacer.** No hacer excepciones por método de pago.~~ **REVERTIDO al día siguiente** (commit `6d645ed`, ver corrección arriba en esta misma sesión) — regla vigente: solo Efectivo bloquea.
- **Helpers compartidos** para unidades de medida (`src/lib/unidadesMedida.js`) — si una sección necesita un dropdown de unidades, importar de ahí.

---

### Sesión 2026-06-12 — Submódulo Impuestos (FI Tax): IVA real + Alícuotas + Retenciones
**Branch:** `master` (commit directo)

**Objetivo:** dos fases de un mismo submódulo `Impuestos` accesible desde el Sidebar (grupo Contabilidad), con 3 tabs: IVA, Retenciones y Percepciones, Alícuotas.

**Nota de numeración:** los specs pedían migraciones `029`/`030`/`031`, pero esos números ya estaban aplicados (fix_tenant_id_fkeys, compras_add_moneda, compras_add_tipo_cambio_tasa). Renumeradas a **032/033/034**. Se usó `gen_random_uuid()` (no `uuid_generate_v4()`).

#### Fase A.1 — IVA real + Alícuotas (migrations 032 + 033)
- **Migration 032:** `alicuota_iva` TEXT en `productos` (NOT NULL DEFAULT '21' + CHECK), `comprobante_items` y `detalle_compras` (snapshot al momento de la operación). `neto_gravado`/`iva_discriminado` NUMERIC en `comprobantes` y `compras`. Tabla `alicuotas_impuestos` (impuesto IIBB/Ganancias/SUSS/Otro, jurisdicción, alícuota, vigencia, fuente manual/padron_arba/padron_agip) con RLS por `get_my_empresa_id()`.
- **Migration 033:** `crear_venta` recalcula `neto_gravado`/`iva_discriminado` por ítem según `alicuota_iva` (subtotal incluye IVA → `neto = subtotal/(1+factor)`; factores 0.21/0.105/0). Copia íntegra de la lógica de 024 (RPC crítica) + cálculo. Fallback `'21'` para ítems sin alícuota.
- **`ImpuestosSection.jsx`** (shell 3 tabs) + **`impuestos/TabIVA.jsx`** (Select de alícuota inline por producto + buscador + "Aplicar 21% a todos" con AlertDialog; posición IVA mensual: débito fiscal = IVA ventas, crédito = IVA compras, posición = a pagar/a favor; links a Libro IVA Ventas (navega a Reportes) y Libro IVA Compras (inline)) + **`impuestos/TabAlicuotas.jsx`** (CRUD + seed opt-in Córdoba; exporta `PROVINCIAS_AR`).
- **`reportes/ReporteLibroIVACompras.jsx`:** espejo del Libro IVA Ventas sobre `compras` + `proveedores` (consulta en 2 pasos sin embedded select), KPIs (bruto/neto/crédito fiscal), CSV con BOM.
- **POS (`NuevaVentaModal.jsx`):** query de productos incluye `alicuota_iva`; `itemsPayload` envía `alicuota_iva: item.alicuota_iva ?? '21'` (el carrito hace `{...product}`, arrastra la alícuota).
- **`ComprobantePDF.jsx`:** desglosa Neto Gravado + IVA reales (`comprobante.neto_gravado`/`iva_discriminado`), fallback `total/1.21`.
- **`emitir-cae/index.ts`:** lee `comprobante_items` y arma items WSFE con alícuota real por línea (`alicuotaPct` + `wsfeItems`); usa `neto_gravado`/`iva_discriminado` persistidos. ⚠️ **Código actualizado, pendiente de redeploy** (toca homologación AFIP).
- **Sidebar + Dashboard:** ítem `impuestos` (icono `Receipt`) + case routing con `onNavigate`.
- **Configuración:** verificado que solo tiene `condicion_iva` de AFIP (dato fiscal) — nada que mover.

#### Fase A.2 — Retenciones y Percepciones (migration 034)
- **Migration 034:** tabla `retenciones` (tipo sufrida/practicada, impuesto, jurisdicción, monto, alícuota_aplicada, contraparte_nombre/cuit, trazabilidad a `comprobante_id`/`compra_id`, numero_certificado) + RLS + índice + vista `retenciones_acumulado_mensual` (security_invoker, agrupado por mes/impuesto/jurisdicción).
- **`impuestos/TabRetenciones.jsx`:** 2 sub-tabs. **Sufridas** = registro manual (KPIs crédito fiscal IIBB/Ganancias/total, modal completo, importación ARBA marcada "próximamente"). **Practicadas** = select proveedor + compra reactiva, pre-carga de alícuota desde `alicuotas_impuestos` (vigente), cálculo `base × alícuota` editable, correlativo `RET-AÑO-NNNN`, descarga de certificado PDF.
- **`impuestos/pdf/CertificadoRetencionPDF.jsx`:** `@react-pdf/renderer`, import dinámico (code-split confirmado en build). Agente de retención + sujeto retenido + detalle + monto destacado.
- **`useNotifications.js`:** recordatorio "Retenciones practicadas este mes: $X" (nivel info, seccion `impuestos`).

**Verificación:** build de producción verde (3126 módulos, `CertificadoRetencionPDF` en chunk lazy propio). Columnas/tablas/RPC confirmadas en DB vía MCP.

**Convenciones nuevas:**
- **IVA snapshot:** la alícuota se captura en `comprobante_items.alicuota_iva` al vender — si después cambia la del producto, el histórico no se altera. Cálculo: subtotal incluye IVA → `neto = subtotal/(1+factor)`.
- **Fallback 21% en todos lados:** comprobantes/productos/compras sin alícuota → 21% (nunca rompe lo existente). Usar `COALESCE`/`?? '21'`.
- **Migraciones renumeradas:** ante colisión, verificar `list_migrations` en Supabase antes de numerar. Próxima libre: **035**.

### Sesión 2026-06-11 (noche) — Testeo funcional completo + fixes integrales

**Objetivo:** testeo manual de toda la app sección por sección, corregir todos los errores encontrados sobre la marcha, y dejar el sistema operativo end-to-end.

**Bugs detectados y fixes aplicados:**

1. **FK violations sistémicas — `tenant_id` apuntaba a `profiles(id)` pero el código inserta `empresa_id`**
   - Síntomas: error al **crear venta** (`comprobantes_tenant_id_fkey`), error al **abrir caja** (`caja_sesiones_tenant_id_fkey`).
   - Causa raíz doble:
     - **DB:** 3 FK apuntaban a `profiles(id)` cuando el código siempre inserta el `empresa_id`.
     - **App:** `SupabaseAuthContext.jsx` seteaba `tenant_id = currentSession.user.id` (profile UUID), no el empresa_id.
   - Fix DB: migration 029 — DROP constraints (comprobantes, caja_sesiones, movimientos_inventario) → UPDATE filas existentes para mappear profile→empresa → ADD constraints apuntando a `empresas(id)`.
   - Fix App: [src/contexts/SupabaseAuthContext.jsx:85](src/contexts/SupabaseAuthContext.jsx:85) — `const tenantId = empresaId` (no `user.id`).

2. **Hora con 3h de desfase (UTC vs Argentina UTC-3) en toda la app**
   - Causa: componentes usaban `toLocaleString()`/`toLocaleDateString()` sin pasar `timeZone`. Como las fechas se guardan AR-local-as-UTC, mostraban UTC literal.
   - Fix: helpers nuevos en [src/lib/dateUtils.js](src/lib/dateUtils.js):
     ```js
     formatTimeAR(isoStr)         // "HH:MM" via getUTCHours/getUTCMinutes
     formatDateLocaleAR(isoStr, options)  // locale-safe via UTC parts
     ```
   - Reemplazo `toLocaleString()` → `formatDateAR/formatTimeAR/formatDateTimeAR` en 17 archivos:
     - `src/components/ventas/ComprobantePrintModal.jsx`, `SaleDetailModal.jsx`, `HistorialVentas.jsx`, `CompraDetailModal.jsx`, `pdf/ComprobantePDF.jsx`
     - `src/components/sections/ComprasSection.jsx`, `ClientDetailModal.jsx`, `ReportesSection.jsx`, `ProveedoresSection.jsx`, `CotizacionesSection.jsx`, `CuentasBancariasSection.jsx`
     - `src/components/sections/UsuariosSection.jsx` (este usa real UTC de Supabase auth, así que se le pasó `timeZone: 'America/Argentina/Buenos_Aires'` explícito)
     - `src/components/CommandPalette.jsx`, `src/components/reportes/ReporteParidad.jsx`
     - `src/services/proveedoresService.ts`, `listaPreciosService.ts` (`new Date().toISOString()` → `getNowAR().toISOString()`)

3. **Compras sin columnas `moneda` / `tipo_cambio_tasa`** — el código las inserta pero la tabla no las tenía.
   - Fix: migrations 030 (moneda text DEFAULT 'ARS') + 031 (tipo_cambio_tasa numeric DEFAULT 1) + NOTIFY pgrst.

4. **ChequesSection: `column comprobantes.created_at does not exist`**
   - Causa: query en [ChequesSection.jsx:165](src/components/sections/ChequesSection.jsx:165) ordenaba por `created_at`, columna que no existe en `comprobantes`.
   - Fix: cambiar `.order('created_at', ...)` → `.order('fecha', ...)`.

5. **NuevaVentaModal: productos no cargan al abrir el modal (hay que cerrarlo y reabrirlo)**
   - Causa: race condition entre dos useEffects. El effect de búsqueda fira con `productSearch=''` y carga 30 productos; en paralelo, `init()` espera el fetch de clientes y después ejecuta `setProducts([])` — vaciando los productos recién cargados. `resetForm()` setea `productSearch=''` sin cambio → no re-dispara.
   - Fix: remover `setProducts([])` de `init()` en [NuevaVentaModal.jsx:88](src/components/ventas/NuevaVentaModal.jsx:88).

6. **Radix Dialog warnings de accesibilidad** en Plan de Cuentas
   - Fix: agregar `<DialogDescription>` a los modales "Nueva Cuenta" (línea 162) y "Nuevo Asiento Contable" (línea 296) en [PlanCuentasSection.jsx](src/components/sections/PlanCuentasSection.jsx).

7. **Logo de la app vs logo de empresa se confunden**
   - Cambio UX: reemplazo del logo box gradiente + texto "KAIROX" grande blanco por imagen real de Kairox + texto "Kairox" pequeño gris semibold con opacidad 85% (100% on hover) en [Sidebar.jsx:58-66](src/components/Sidebar.jsx:58).
   - Imagen guardada en `public/kairox-logo.png`.

**Testeo manual realizado (todas las secciones OK):**

Dashboard, Inventario (productos + Historial Movimientos), Ventas (Nueva + Historial), Cotizaciones, Pedidos, Listas de Precios, Compras (Historial + Nueva), Órdenes de Compra, Caja (Movimientos + Nuevo Movimiento + Reporte Histórico), Bancos (Cuentas + Movimientos + Conciliación), Cheques (Cartera Terceros + Propios), Clientes (lista + modal detalle), Cta. Corriente (Clientes + Antigüedad de Deuda), Contabilidad (Plan + Asientos + Balance + Libro Mayor + Períodos), Reportes (Centro + Reporte de Ventas con PDF), Usuarios, Configuración (Datos Generales + Moneda Paralela + AFIP).

**Convenciones nuevas / refuerzos:**
- **`tenant_id` en tablas multi-tenant SIEMPRE = `empresa_id`** — la FK apunta a `empresas(id)`. NO usar `user.id` (profile UUID) como tenant_id. Si aparece una tabla nueva con `tenant_id`, verificar que la FK apunte a `empresas(id)`.
- **Display de fechas/horas:** siempre `formatDateAR`/`formatTimeAR`/`formatDateTimeAR` de `dateUtils.js`. Nunca `toLocaleString()` o `toLocaleDateString()` sin timezone explícito.
- **Race conditions en modales con doble useEffect:** cuando un modal tiene un effect de "init" y otro de "search", no setear arrays vacíos en el init si el search ya los carga. El init solo debe cargar lo suyo (clientes, configs, etc.).
- **Modales de Radix:** todos los `DialogContent` deben tener `DialogTitle` Y `DialogDescription` (warning de accesibilidad si falta description).

---

### Sesión 2026-06-10 — TM Checks: Gestión de Cheques
**Branch:** `master` (commit `5669091`)

**Objetivo:** módulo completo de gestión de cheques de terceros y propios (SAP TM Checks). Solo registro en esta fase — no genera movimientos contables automáticos.

**Implementado:**

1. **Migration 028** ([migrations/028_cheques.sql](migrations/028_cheques.sql)):
   - Tabla `cheques`: tipo (propio/tercero), numero, banco, cuenta_bancaria_id, monto, fecha_emision, fecha_vencimiento, moneda (default ARS), cliente_id, proveedor_id, concepto, estado (8 valores CHECK), observaciones, comprobante_id, compra_id. RLS por `get_my_empresa_id()`.
   - Tabla `cheques_historial`: cheque_id, empresa_id, user_id, estado_anterior, estado_nuevo, observacion, fecha. RLS ídem.
   - 3 índices: `idx_cheques_empresa_tipo`, `idx_cheques_empresa_estado`, `idx_cheques_vencimiento` (parcial WHERE NOT cobrado/rechazado).

2. **`src/components/sections/ChequesSection.jsx`** — CREADO (~400 líneas):
   - KPI cards: En cartera (terceros activos), Propios pendientes, Vencen esta semana, Total cartera ARS.
   - Dos tabs: **Cartera de Terceros** (estados: `en_cartera → depositado/endosado/descontado/rechazado → cobrado/rechazado`) y **Cheques Propios** (estados: `pendiente → entregado/rechazado → cobrado/rechazado`).
   - Modales "Registrar cheque de tercero" y "Registrar cheque propio" con carga reactiva de comprobantes/compras via `useEffect` al seleccionar cliente/proveedor.
   - Modal de cambio de estado: mapa `TRANSICIONES` por estado actual, registra en `cheques_historial` vía `registrarHistorial()`.
   - `renderFechaVto()`: ícono Clock ámbar (vence ≤7d) o rojo (vencido).
   - Cheques rechazados: visibles con `bg-red-500/5`, nunca ocultos.

3. **`src/hooks/useNotifications.js`** — nuevo query `chequesProximos` (7 días, usando `getTodayAR()` + `addDays()`). Ítem al principio del array `items` con `nivel: 'advertencia'`, `seccion: 'cheques'`.

4. **`src/components/Sidebar.jsx`** — import `FileCheck` + entrada `{ id: 'cheques', label: 'Cheques', icon: FileCheck }` después de bancos.

5. **`src/components/Dashboard.jsx`** — import `ChequesSection` + `case 'cheques': return <ChequesSection />;`.

**Convenciones nuevas:**
- `addDays(dateStr, days)`: `new Date(new Date(dateStr + 'T00:00:00Z').getTime() + days * 86400000).toISOString().split('T')[0]` — aritmética de fechas timezone-safe sin desfase DST.
- Cheques rechazados: siempre visibles con tinte rojo — nunca filtrar estados finales de la lista.
- Módulo solo de registro en Fase 1 — no genera asientos contables.

---

### Sesión 2026-06-10 — FI Period Close: Cierre formal de períodos contables
**Branch:** `master` (commit `81c2566`)

**Objetivo:** cierre formal de períodos contables (SAP FI Period Close) — admin crea y cierra períodos; asientos en fecha de período cerrado quedan bloqueados.

**Implementado:**

1. **Migration 027** ([migrations/027_cierre_periodos.sql](migrations/027_cierre_periodos.sql)):
   - DO block defensivo al inicio: si la tabla existía sin columna `estado` (intento fallido previo), la elimina antes de recrear.
   - Tabla `periodos_contables`: empresa_id, nombre, fecha_inicio DATE, fecha_cierre DATE, estado CHECK('abierto'/'cerrado'), cerrado_por UUID→profiles, fecha_cierre_real TIMESTAMPTZ, observaciones. CHECK constraint `fecha_cierre >= fecha_inicio`.
   - RLS: 3 policies en DO blocks idempotentes (SELECT/INSERT/UPDATE) por `get_my_empresa_id()`.
   - Índice `idx_periodos_empresa_estado`.
   - RPC `fecha_en_periodo_cerrado(p_empresa_id UUID, p_fecha DATE) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public`.

2. **`src/components/sections/PlanCuentasSection.jsx`** — nueva 5ª tab **Períodos** con componente `TabPeriodos`:
   - Admin-only: botón "Nuevo período" + botón "Cerrar" por fila abierta.
   - Al cerrar: cuenta asientos en rango (`asientos_contables` con `.gte/.lte` por fecha) para informar al admin, luego UPDATE `estado='cerrado'`, `cerrado_por`, `fecha_cierre_real`.
   - Tabla: nombre, fecha inicio, fecha cierre, estado badge (verde abierto / gris cerrado), fecha de cierre real.
   - Dos dialogs: crear período nuevo + confirmar cierre.
   - Imports agregados: `Lock` (lucide-react), `supabase` de `customSupabaseClient`, `useEffect`.

3. **`src/services/planCuentasService.ts`** — check de período en `crearAsientoVenta` y `crearAsientoCompra`:
   ```typescript
   try {
     const { data: cerrado, error: rpcErr } = await supabase.rpc('fecha_en_periodo_cerrado', {
       p_empresa_id: empresaId, p_fecha: params.fecha,
     });
     if (rpcErr) { console.warn('[asientosAutoService] período check failed:', rpcErr.message); }
     else if (cerrado) { throw new Error(`Período cerrado: la fecha ${params.fecha} pertenece a un período contable cerrado.`); }
   } catch (e: any) {
     if (e.message?.startsWith('Período cerrado:')) throw e;
     console.warn('[asientosAutoService] período check error:', e);
   }
   ```

**Convenciones nuevas:**
- `fecha_en_periodo_cerrado` recibe DATE (YYYY-MM-DD), no TIMESTAMPTZ.
- Check en `asientosAutoService` es **no-crítico**: errores de RPC nunca bloquean una venta; solo la respuesta deliberada `true` bloquea.
- Cierre no-destructivo: cerrar un período NO modifica ni borra asientos existentes, solo bloquea nuevos.
- Admin-only: siempre verificar `user.role === 'admin'` antes de crear o cerrar períodos.

---

### Sesión 2026-06-10 — Onboarding Wizard + Checklist de configuración inicial
**Branch:** `master` (commit `288653b`)

**Objetivo:** guiar a nuevas empresas a través de la configuración inicial del sistema con un wizard modal + checklist de pasos.

**Implementado:**

1. **Migration 026** ([migrations/026_onboarding.sql](migrations/026_onboarding.sql)):
   - Columna `onboarding_completado BOOLEAN DEFAULT false` en tabla `empresas`.

2. **`src/components/OnboardingWizard.jsx`** — CREADO:
   - Dialog modal que se abre automáticamente si `empresa.onboarding_completado = false`.
   - Props: `open`, `onComplete`.
   - Al completar: UPDATE `empresas SET onboarding_completado = true` + llama `onComplete()`.

3. **`src/components/ChecklistOnboarding.jsx`** — CREADO:
   - Checklist de pasos de configuración inicial (datos empresa, primer producto, primer cliente, etc.).
   - Integrado dentro del wizard o como panel standalone.

4. **`src/components/Dashboard.jsx`** — MODIFICADO:
   - `useEffect` que consulta `empresas.onboarding_completado` al montar.
   - Si `false` → `setShowOnboarding(true)`.
   - Renderiza `<OnboardingWizard open={showOnboarding} onComplete={() => setShowOnboarding(false)} />`.

---

### Sesión 2026-06-10 — AFIP/ARCA Fase 5: Libro IVA Ventas digital
**Branch:** `master` (commit `93ac3c6`)

**Objetivo:** generar el Libro IVA Ventas digital requerido por ARCA para empresas con factura electrónica activa.

**Implementado:**
- Nuevo reporte/sección "Libro IVA Ventas" accessible desde Reportes o Contabilidad.
- Filtro por período (fecha desde/hasta).
- Columnas: Fecha | Tipo comprobante | Número AFIP | Cliente | CUIT | Condición IVA | Neto gravado | IVA 21% | Total | CAE.
- Export CSV compatible con el formato requerido por ARCA.
- Solo muestra comprobantes con `usa_factura_electronica = true` y `cae_estado = 'emitido'`.

---

### Sesión 2026-06-10 — AFIP/ARCA Fase 4: PDF con QR fiscal (RG 4291/2018)
**Branch:** `master` (commit `e125dd0`)

**Objetivo:** incluir el QR fiscal obligatorio (RG AFIP 4291/2018) en el PDF del comprobante impreso.

**Implementado:**
- `ComprobantePrintModal.jsx` / componente PDF de `@react-pdf/renderer`: bloque QR en el pie de página del comprobante cuando `comprobante.cae` está presente.
- QR encodes la URL del verificador AFIP: `https://www.afip.gob.ar/fe/qr/?p=<base64_del_json>` donde el JSON incluye cuit, tipo, punto_venta, numero_afip, nro_doc_receptor, importe, moneda, ctz, fecha, cae, vto.
- Fix de compatibilidad `@react-pdf/renderer` v4: propiedades shorthand (`padding: '5 8'`, `borderRadius: '3 3 0 0'`) NO funcionan — reemplazadas por `paddingVertical`/`paddingHorizontal` y `borderTopLeftRadius`/`borderTopRightRadius` individualmente.

**Convención nueva:**
- `@react-pdf/renderer` v4: nunca usar shorthands CSS multi-valor. Usar siempre propiedades individuales.

---

### Sesión 2026-06-10 — AFIP/ARCA Fase 3: Integración CAE en flujo post-venta
**Branch:** `master` (commit `6a8cca8`)

**Objetivo:** llamar automáticamente a `emitir-cae` después de confirmar una venta cuando `empresa.usa_factura_electronica = true`.

**Implementado:**
- `NuevaVentaModal.jsx` (o `ventasService.ts`): tras el RPC `crear_venta` exitoso, si `empresa.usa_factura_electronica`, llama `afipService.emitirCAE(comprobante_id)` de forma fire-and-forget (no bloquea el flujo de venta).
- Si falla: `cae_estado` queda en `'error'` en DB → aparece en notificación "facturas sin CAE" de `useNotifications`.
- Si éxito: guarda `cae`, `cae_vencimiento`, `cae_estado = 'emitido'`, `numero_afip`, en `comprobantes`.
- IVA por ítem: `comprobante_items` usado para calcular base imponible y monto IVA por alícuota (21% por defecto en Fase 3).
- Verificación con certificado real en homologación ARCA completada.

**Pendientes Fases 3-5:**
- ⚠️ IVA diferencial (10.5%, 27%) — hardcodeado 21% en Fase 3.
- ⚠️ Comprobantes tipo A (responsables inscriptos) — requiere datos CUIT receptor válidos.
- ✅ Reintento masivo CAEs pendientes — **sesión 59**: `afipService.reintentarCAEsPendientes()` reescrito para llamar la RPC `reencolar_caes_pendientes` (migration 088) en vez de emitir desde el frontend. Re-encola en `facturas_pendientes_arca` y deja que el `arca-worker` emita (única fuente de verdad). Accionable desde la notificación `caes_pendientes` en el Header. Elimina el riesgo de doble emisión que tenía el loop de `emitir-cae` frontend.

---

### Sesión 2026-06-10 (noche) — Cierre de pendientes detectados en testing
**Branch:** `master` (commit directo)

**Objetivo:** resolver los pendientes que el equipo detectó en la sesión de testing "noche" del 09-jun y quedaron sin corregir.

**Fixes aplicados:**

1. **Invalidación de notifs en CC y Caja** (pendiente ⚠️ de sesión 09-jun):
   - [CuentaCorrienteSection.jsx](src/components/sections/CuentaCorrienteSection.jsx) — `useQueryClient` + `invalidateNotifs()` tras cobro exitoso en `handleRegisterPayment` (la notif `deuda_vencida` consulta `cuenta_corriente_movimientos`).
   - [ClientDetailModal.jsx](src/components/sections/ClientDetailModal.jsx) — ídem tras su cobro rápido.
   - [CajaCierre.jsx](src/components/caja/CajaCierre.jsx) — invalidación tras `closeSession` exitoso (la notif `caja_sin_cerrar` consulta `cierre_fecha`).
   - Con esto el patrón `invalidateNotifs` queda completo en los 4 módulos que afectan notifs: Productos, OC, CC y Caja.

2. **ClientDetailModal — bugs de la misma clase ya corregidos en su hermano** (`2d8863f` solo cubrió CuentaCorrienteSection):
   - `parseFloat(paymentAmount)` → `parseNumberLocale()` (formato es-AR).
   - El cobro rápido ahora guarda `monto_paralelo` + `tc_paralelo` en ambos INSERTs vía `useTCParalelo()` (antes este camino perdía la cobertura del Reporte de Paridad).
   - Nota: el bloqueo por caja cerrada en este modal es CORRECTO (su cobro rápido es hardcodeado Efectivo).

3. **Docs Contabilidad corregidas** (pendiente ⚠️): la tabla de módulos decía "7 tabs" pero `PlanCuentasSection.jsx` tiene 4 (cuentas, asientos, balance, libro_mayor). Actualizado a la realidad; P&L, Balance General y Períodos quedan como roadmap.

**Pendientes que siguen abiertos:**
- ⚠️ **BRL TC corrupto (tasa 3.6 del 08-jun)** — el DELETE en producción requiere autorización del usuario. SQL listo: `DELETE FROM tipos_cambio WHERE moneda = 'BRL' AND tasa = 3.6;` — al borrarlo, el sistema vuelve a pedir el TC con el modal (flujo correcto).
- ⚠️ **Tests automatizados** — sigue sin haber ninguno; proyecto aparte.
- ✅ ~~Implementar P&L / Balance General / Períodos~~ en Contabilidad — **RESUELTO** Sesión 28 (P&L + Balance General); Períodos ya estaba implementado desde antes.
- ⏳ Continuar TESTING_2026-06-10.md desde el punto 1.

### Sesión 2026-06-10 (tarde — Nadia) — Fix crítico crear_venta + UX POS
**Branch:** `master` (commit directo)

**Contexto:** arrancamos el plan de testing TESTING_2026-06-10.md y al llegar al primer test (crear venta) el RPC `crear_venta` rompía con error PostgreSQL `42703: column "user_id" of relation "comprobantes" does not exist`.

**Bugs corregidos:**

1. **RPC `crear_venta` referenciaba columna inexistente** ([migrations/024_rpc_crear_venta.sql](migrations/024_rpc_crear_venta.sql)):
   - El INSERT a `comprobantes` incluía `user_id` que NO existe en esa tabla (verificado contra schema real: columnas son `id, empresa_id, tenant_id, cliente_id, numero_venta, ...` SIN `user_id`).
   - Fix: removido `user_id` y el `p_user_id` correspondiente del INSERT a comprobantes. Se sigue usando para `movimientos_caja` y `cuenta_corriente_movimientos` (que sí lo tienen).
   - Migration aplicada en DB: `fix_crear_venta_sin_user_id_en_comprobantes`.

2. **POS — dropdown productos pedía mínimo 2 caracteres** ([NuevaVentaModal.jsx](src/components/ventas/NuevaVentaModal.jsx)):
   - El query server-side solo se disparaba con `productSearch.length >= 2` → al hacer focus el dropdown estaba vacío con mensaje "Escribí al menos 2 caracteres".
   - Fix: con query vacío trae los primeros 30 productos del servidor (debounce 0ms cuando vacío, 300ms cuando hay texto).
   - Placeholder cambiado a "Buscar producto o elegí de la lista...".

**Cambios en DB:**
- 1 migration aplicada: `fix_crear_venta_sin_user_id_en_comprobantes` (CREATE OR REPLACE FUNCTION).

**Pendiente para próxima sesión:**
- Continuar con TESTING_2026-06-10.md desde el punto 1 (TC obligatorio en Compras) ahora que `crear_venta` anda.
- Verificar también que la búsqueda server-side en el dropdown del POS no tenga regresiones.

### Sesión 2026-06-10 — AFIP/ARCA Fase 2: Wizard de activación UI
**Branch:** `feat/afip-fase2` → merge a `master`

**Objetivo:** UI de activación de Factura Electrónica en `ConfiguracionSection.jsx` (wizard 3 pasos). Scope Fase 2 = solo UI de activación; NO se integra en el flujo de venta (eso es Fase 3).

#### 1. `generar-csr` v2 — acción `store_cert` agregada (redeploy, ACTIVE)
- La función ahora rutea por `body.action`: `generate` (default, par RSA + CSR como en Fase 1) y `store_cert` (guarda el `.crt` subido por el usuario en Vault como `afip_cert_<empresa_id>`).
- `store_cert` valida que el contenido incluya `CERTIFICATE` antes de guardar. `empresa_id` se deriva del perfil verificado (verifyAdmin), no del body.

#### 2. `ConfiguracionSection.jsx` — sección AFIP + wizard
- **Card AFIP** después de Moneda Paralela: Switch + chips de estado (CUIT/condición IVA/punto de venta cuando está completa; aviso ámbar + botón "Completar configuración" cuando falta).
- **Wizard Dialog 3 pasos** con stepper visual: (1) datos fiscales CUIT + condición IVA, (2) certificado — generar CSR → descargar → instrucciones ARCA → subir `.crt`, (3) punto de venta + tipo de comprobante default.
- **Handlers:** `handleGenerarCSR` (invoke generar-csr), `handleDescargarCSR` (blob download), `handleCertUpload` (FileReader→text), `handleGuardarConfigAFIP` (store_cert + update empresas + upsert puntos_venta), `handleToggleAFIP` (abre wizard si falta config, alterna flag si ya está).
- **Adaptado a las convenciones reales del archivo:** usa estado local + `useEffect` + queries directas a Supabase (patrón de la card Moneda Paralela), NO TanStack Query/`queryClient` como sugería el spec. CUIT se guarda sin guiones (`afip_cuit`) pero se muestra formateado con `formatCuit()`. Wizard resetea a paso 1 al reabrir.

**Pendientes (siguen para Fase 3):** integrar `emitirCAE()` en el flujo post-venta, verificación con `.crt` real en homologación, IVA por item, Libro IVA, impresión de CAE/QR en comprobante.

### Sesión 2026-06-10 — AFIP/ARCA Fase 1: infraestructura + Edge Functions homologación
**Branch:** `feat/afip-fase1` → merge a `master`

**Objetivo:** infraestructura base para Factura Electrónica vía WSFE de ARCA (ex-AFIP). Scope Fase 1 = solo infra + homologación (sandbox). NO se toca el flujo de venta productivo (eso es Fase 3).

#### 1. Migration 025 — infraestructura (aplicada via MCP)
- `empresas`: `usa_factura_electronica`, `condicion_iva` (RI|Monotributo|Exento|CF), `afip_cuit`, `afip_ticket_acceso`, `afip_ticket_expira`.
- `clientes`: `condicion_iva` (el doc del receptor usa el campo existente `documento` — NO existe `cuit` en clientes).
- Tabla nueva `puntos_venta` (RLS por `get_my_empresa_id()`): `numero` AFIP, correlativos `ultimo_numero_a/b/c`, `tipo_comprobante_default`.
- `comprobantes`: `cae`, `cae_vencimiento` (DATE), `cae_estado` (no_aplica|pendiente|emitido|error), `tipo_comprobante_afip` (A|B|C|E), `numero_afip`, `punto_venta_id`, `error_afip`.
- **Vault wrappers** (`vault_secret_upsert`/`vault_secret_read`): SECURITY DEFINER sobre `vault.create_secret`/`vault.decrypted_secrets`. Las RPCs `vault_secret_*` del spec original NO existían en Supabase → se crearon. `REVOKE` a public/anon/authenticated, `GRANT EXECUTE` solo a `service_role`. Round-trip encrypt/decrypt verificado.

#### 2. Edge Function `generar-csr` (v1, ACTIVE) — `supabase/functions/generar-csr/index.ts`
- Genera par RSA-2048 (Web Crypto) + CSR PKCS#10 con `@peculiar/x509` (compatible con Deno/Edge, vía esm.sh).
- Subject DN AFIP: `C=AR, O=<razón>, CN=<razón>, serialNumber=CUIT <cuit>`.
- Guarda la clave privada en Vault (`afip_key_<empresa_id>`) — NUNCA sale al frontend. Devuelve solo el `.csr` para subir a ARCA.
- Auth: `verifyAdmin(req)` + `empresa_id` derivado del perfil verificado (no se confía en el body). Boot verificado (401 sin token).

#### 3. Edge Function `emitir-cae` (v2, ACTIVE) — `supabase/functions/emitir-cae/index.ts`
- Recibe `comprobante_id` → lee cert+clave de Vault → llama a ARCA (WSFE) vía `@nicoo01x/arca-sdk` → guarda CAE + incrementa correlativo del punto de venta.
- **Hallazgo de runtime:** importar el SDK a nivel top-level causa **BOOT_ERROR** (depende de `soap`, paquete Node-only que no carga en Deno Edge). **Fix:** import DINÁMICO (`await import('npm:@nicoo01x/arca-sdk@3')`) justo antes de emitir → la función bootea, autentica, lee Vault y solo carga el SDK en la ruta de emisión real. v1 falló boot, v2 bootea OK (401 verificado).
- Adaptaciones vs. spec: consultas separadas (sin embedded selects que requieren FK), `clientes.documento` en vez de `cuit`, fix del doble `await req.json()` (se captura `comprobante_id` en scope externo).
- IVA hardcodeado 21% (Fase 1). Ambiente default `sandbox` (env `AFIP_ENVIRONMENT` opcional; en producción setear `=production`).

#### 4. Frontend `src/services/afipService.ts`
- `generarCSR(cuit, razonSocial)`, `emitirCAE(comprobante_id)`, `reintentarCAEsPendientes(empresa_id)` (sesión 59: ahora llama la RPC `reencolar_caes_pendientes` y re-encola para el worker — ya NO emite en loop desde el frontend).

**Convenciones nuevas:**
- **SDKs npm Node-only en Edge Functions:** si un paquete depende de `soap`/módulos Node que no cargan en Deno, importarlo DINÁMICAMENTE (`await import()`) dentro del handler, nunca top-level — así la función bootea y el fallo se aísla a su ruta de uso.
- **Secretos (certificados, claves):** SIEMPRE en Supabase Vault vía `vault_secret_upsert`/`vault_secret_read` (service_role). Nunca en columnas de tablas normales.
- **AFIP doc receptor:** usar `clientes.documento`. 11 dígitos → CUIT (80), 7-8 → DNI (96), vacío → Consumidor Final (99).

**Pendientes Fase 1 / próximas fases:**
- ⏳ Flujo de carga del `.crt` emitido por ARCA → guardar en Vault como `afip_cert_<empresa_id>` (UI + endpoint, no implementado aún).
- ⏳ UI de configuración AFIP (toggle factura electrónica, CUIT, condición IVA, alta de punto de venta) en ConfiguracionSection.
- ⚠️ Shape exacto de `createInvoice` del SDK sin verificar contra ejecución real (requiere cert válido). Validar en homologación cuando haya `.crt`.
- ⚠️ Compatibilidad runtime del SDK en Deno sin verificar (boot OK; la llamada real a ARCA puede fallar por `soap`). Plan B si falla: implementar WSAA+WSFE con SOAP/XML manual o usar afipsdk.com.
- ⏳ (Opcional) setear secret `AFIP_ENVIRONMENT=sandbox` en Dashboard — el código ya defaultea a sandbox sin él.

### Sesión 2026-06-09 (PM·4) — RPC transaccional `crear_venta` + moneda paralela en CuentaCorrienteSection
**Branch:** `master`

#### 1. RPC transaccional `crear_venta` (migration 024)
**Problema:** `handleConfirmSale()` en `NuevaVentaModal.jsx` ejecutaba 6 operaciones secuenciales sin transacción (comprobante → items → stock → mov_inventario → caja → CC). Si fallaba cualquiera de las 2-6, el sistema quedaba inconsistente (ej: comprobante sin stock descontado).

**Solución:** RPC `crear_venta` que encapsula todo en una transacción atómica con rollback automático. Recibe items/pagos como `JSONB`, descuenta stock con `SELECT ... FOR UPDATE` (lock anti-race-condition), valida `p_empresa_id = get_my_empresa_id()` al inicio. `SECURITY DEFINER` + `SET search_path = public`.

**Verificaciones de schema reales (DB) que difirieron del spec original:**
- `comprobante_items` usa columnas en **ESPAÑOL** (`producto_id`, `cantidad`), NO portugués (`produto_id`/`quantidade`). El schema fue migrado en algún momento.
- `movimientos_inventario` **NO tiene `user_id`** — sí `tenant_id` (legacy nullable). La RPC omite user_id y setea `tenant_id = p_empresa_id`.
- CHECK constraints validados: `movimientos_inventario.tipo` ∈ (entrada|salida|ajuste), `movimientos_caja.tipo` ∈ (ingreso|egreso), `cuenta_corriente_movimientos.tipo` ∈ (DEBE|HABER), `comprobantes.tipo` ∈ (venta|nota_credito), `comprobantes.estado_pago` ∈ (pagada|pendiente|parcial|cancelada).

**Frontend (`NuevaVentaModal.jsx`):** las 6 operaciones secuenciales reemplazadas por una sola llamada `supabase.rpc('crear_venta', {...})`. Se mantienen intactas: validaciones previas (carrito, TC, sesión viva, límite crédito, pre-check stock), `generateVentaNumber()`, asiento contable fire-and-forget (FUERA de la transacción), modal de impresión, callbacks `onSaleSuccess`/`onConvertSuccess`. Se agregó `useCaja()` para enlazar `caja_sesion_id` en los movimientos de caja (antes quedaba null). Los pagos paralelos van como `''` en el payload para que `NULLIF(...,'')` del SQL resuelva a NULL.

**Convención nueva:** ventas siempre vía RPC `crear_venta` — nunca INSERTs secuenciales desde el frontend. Pasar `monto_paralelo`/`tc_paralelo` como string vacío `''` (no null) en arrays JSONB cuando aplique NULLIF en el SQL.

#### 2. Moneda paralela + bugs en CuentaCorrienteSection (commit `2d8863f`)
- Bug `parseFloat` → `parseNumberLocale()` en cobro CC. Input monto `type=number`→`type=text inputMode=decimal`.
- Botón cobro en tabla ya no bloquea por caja cerrada (solo Efectivo lo requiere, verificado en handler).
- Moneda paralela: equivalente `≈ X USD/EUR` en KPI Total Deuda, columna Saldo de la tabla y dialog de cobro rápido. Todo condicionado a `tcParalelo.enabled && tcParalelo.tcHoy`.

---

### Sesión 2026-06-09 (PM·3) — Aging Open Item por comprobante + Deploy Edge Functions CORS + Fix timezone/timestamp
**Branch:** `master` (commits: `5b19a59`, `16f96c6`)

#### 1. Aging refactor — Open Item Management por comprobante individual (commit `5b19a59`)
**Archivo:** `src/components/sections/CuentaCorrienteSection.jsx`

**Problema:** el `fetchAgingData()` anterior tomaba el movimiento DEBE más antiguo por cliente (incluso si ya había sido cancelado), lo que causaba falsos positivos: clientes con deuda vieja pagada y deuda nueva reciente aparecían en banda +90 días incorrectamente.

**Solución (SAP FI Open Item Management):** cada fila de la tabla = un `comprobante` con `estado_pago = 'pendiente'`, `tipo = 'venta'`, y `cliente_id IS NOT NULL`. La antigüedad se calcula desde `comprobante.fecha` hasta `getNowAR()`. Cada comprobante tiene su propia banda y color.

**Cambios:**
- `fetchAgingData()` completamente reescrito: query directa a `comprobantes` con filtros `estado_pago='pendiente'`, `tipo='venta'`, `.not('cliente_id', 'is', null)`.
- `agingBandas` useMemo: suma `comp.total` (no `c.saldo_actual`), cuenta comprobantes no clientes.
- Cards UI: "comprobante(s)" en lugar de "cliente(s)".
- Tabla: 7 columnas — Comprobante | Cliente | Monto | Fecha | Antigüedad | Banda | Acciones.
- Tbody: key=`comp.comprobante_id`, muestra `formatDateAR(comp.fecha)`, `comp.cliente_nombre`, `comp.total`.
- Botón ojo: `setSelectedClient({ id: comp.cliente_id, nombre: comp.cliente_nombre })`.
- `colSpan` actualizado 5→7 en skeleton y empty state.

#### 2. Deploy Edge Functions CORS (sin commit de código — ya estaba correcto)
**Funciones desplegadas vía MCP Supabase (`wuznppxeonmhfcvnqfbf`):**
- `create-user` → versión 3, status ACTIVE
- `invite-user` → versión 3, status ACTIVE
- `delete-user` → versión 2, status ACTIVE

**Código ya correcto en `supabase/functions/_shared/auth.ts`:**
- `ALLOWED_ORIGINS`: Set con producción + localhost:3000/3001/5173 + 127.0.0.1:3000/3001/5173.
- `buildCorsHeaders(req)`: refleja el `Origin` del request si está en la whitelist; incluye `Vary: Origin`.
- `errorResponse()` y `okResponse()` aceptan `req` y usan `buildCorsHeaders(req)`.
- `verify_jwt: false` en el deploy (las funciones implementan auth propia con `verifyAdmin()`).

#### 3. Fix timezone / timestamp malformado (commit `16f96c6`)
**Problema raíz:** el sistema usa "AR-local-as-UTC" — `getNowAR()` resta 3h del UTC real para que `getUTC*()` devuelva hora Argentina. Las fechas deben manejarse con ese shift, nunca con `Date.now()` real ni `new Date(T00:00:00)` (browser-tz-dependent).

**Archivos corregidos:**

- **`src/hooks/useNotifications.js`:**
  - `hace30dias`: `new Date(Date.now() - 30*86400000)` → `new Date(getNowAR().getTime() - 30*86400000)` (TIMESTAMPTZ filter, alineado con AR-as-UTC)
  - `hace24h`: mismo patrón para filtro `caja_sesiones.apertura_fecha`
  - `import { getNowAR } from '@/lib/dateUtils'` agregado

- **`src/components/reportes/ReporteParidad.jsx`:**
  - Estado inicial: `new Date().toISOString().split('T')[0]` → `getTodayAR()` (evita fecha UTC en lugar de AR)
  - `firstOfMonth`: `new Date(year, month, 1).toISOString()` → `todayStr.slice(0, 7) + '-01'`
  - ISO para filtro `comprobantes.fecha` (TIMESTAMPTZ): `new Date(\`${date}T00:00:00\`).toISOString()` (browser-tz-dependent) → `` `${date}T00:00:00.000Z` `` (AR-local-as-UTC correcto)
  - `import { getTodayAR } from '@/lib/dateUtils'` agregado

- **`src/services/tipoCambioService.ts`:**
  - Import corregido: `@/lib/supabase` (no existía) → `@/lib/customSupabaseClient`
  - `new Date().toISOString().slice(0,10)` → `getTodayAR()` en `getTasaVigente()`
  - Nota: archivo efectivamente dead code (Vite resuelve `.js` antes que `.ts`), pero se corrige para evitar build issues futuros.

**Convenciones nuevas confirmadas:**
- **AR-local-as-UTC:** nunca `Date.now()` para filtros TIMESTAMPTZ; siempre `getNowAR().getTime()`.
- **ISO para TIMESTAMPTZ:** nunca `` new Date(`${date}T00:00:00`).toISOString() `` (agrega tz browser); siempre `` `${date}T00:00:00.000Z` ``.
- **ISO para DATE columns:** siempre YYYY-MM-DD string puro, nunca ISO completo.
- **Fecha AR hoy:** `getTodayAR()` de `dateUtils.js`, nunca `new Date().toISOString().slice(0,10)`.

---

### Sesión 2026-06-09 (noche) — Testing manual completo + 20 bugs corregidos + 2 cambios DB
**Branch:** `master` (commits directos)
**Trabajo en pareja:** Nadia (testing manual módulo por módulo) + Claude (fixes inline)

**Filosofía de la sesión:** recorrido completo de TODOS los módulos del sidebar para encontrar y arreglar bugs en vivo. Se priorizó que CADA cosa que el usuario encontrara funcionara bien antes de pasar al siguiente módulo.

**Bugs corregidos (en orden de aparición):**

1. **Iconos calendario invisibles en modo oscuro** ([index.css](src/index.css)) — agregado bloque CSS con `color-scheme: dark !important` + `filter: invert(1) brightness(2)` en `::-webkit-calendar-picker-indicator` para inputs `date`/`time`/`datetime-local`/`month`/`week`. Aplica globalmente.

2. **Conversión moneda en venta — lógica completa** ([NuevaVentaModal.jsx](src/components/ventas/NuevaVentaModal.jsx), [ComprobantePrintModal.jsx](src/components/ventas/ComprobantePrintModal.jsx), [HistorialVentas.jsx](src/components/ventas/HistorialVentas.jsx)):
   - **Decisión de diseño**: productos SIEMPRE en ARS, ventas guardadas SIEMPRE en ARS, solo display convertido a moneda elegida.
   - Helper `totalEnMonedaSeleccionada()` divide por la tasa solo para mostrar al cliente.
   - Banner en modal: "Equivale a $X ARS (TC $Y)".
   - Ticket impreso: bloque con moneda cobrada + TC + equivalente cuando moneda ≠ ARS.
   - Historial: badge USD/EUR + equivalente debajo del total ARS.
   - Fix línea 283 NuevaVentaModal: `calculateTotal()` siempre devuelve ARS, sin multiplicar por tasa (era doble conversión).

3. **Carrito invisible en NuevaVentaModal** — agregado `min-h-0` en flex containers + `min-h-[200px]` en panel del carrito para que no colapse a 0 en flexbox.

4. **TC schema rota** ([tipoCambioService.js](src/services/tipoCambioService.js)) — la tabla `tipos_cambio` real NO tiene columnas `user_id` ni `updated_at`. Removidas del upsert (antes daba error 400).

5. **TC parser numérico — formato es-AR ESTRICTO** ([currencyUtils.js](src/lib/currencyUtils.js)):
   - Regla argentina: **`.` = miles, `,` = decimal**.
   - `parseNumberLocale()` simplificado: `s.replace(/\./g, '').replace(',', '.')`.
   - `"1.446"` → 1446, `"1.446,50"` → 1446.50, `"1668,21"` → 1668.21, `"0,0036"` → 0.0036.
   - Antes interpretaba `"1.446"` como decimal `1.446` (bug que corrompió datos).

6. **Datos TC corruptos en DB — corregidos vía SQL**:
   - `tipos_cambio`: USD 1.446 → 1446, EUR 1.668 → 1668, BRL 0.0036 → 3.6 (multiplicados por 1000).
   - `comprobantes` con `tipo_cambio_tasa` mal guardado (3 ventas: 20260608-002, -005, -009) también corregidas.

7. **TC inputs con placeholders es-AR** — TipoCambioModal, MonedaSelector, CuentasBancariasSection: placeholders ahora muestran `1.446,50` ó `500.000` (formato argentino) + nota explicativa: "punto = miles, coma = decimal".

8. **Cotizaciones UX** ([CotizacionesSection.jsx](src/components/sections/CotizacionesSection.jsx)):
   - Autocomplete cliente: dropdown con existentes + permite tipear nombre libre.
   - Buscador productos: dropdown se abre al focus (carga 200 productos en memoria, filtra local).
   - Cantidad step `0.001` → `1` (flechitas de 1 en 1).
   - Unidad con `<datalist id="unidades-medida">` (un, kg, g, l, ml, m, cm, m², m³, caja, paquete, docena, par, hora, día, servicio) + texto libre.

9. **Pedidos** ([PedidosSection.jsx](src/components/sections/PedidosSection.jsx)) — cantidad step `0.001` → `1`.

10. **Compras dropdown productos** ([ComprasSection.jsx](src/components/sections/ComprasSection.jsx)) — antes solo mostraba al tipear, ahora se abre al focus con los primeros 30 productos.

11. **Plan de Cuentas RPC `seed_plan_cuentas`** — recreado con `SECURITY DEFINER` + validación interna `p_empresa_id IS DISTINCT FROM get_my_empresa_id()` para mantener aislamiento multi-tenant. Migration aplicada.

12. **PlanCuentasSection `tenant_id` legacy** ([PlanCuentasSection.jsx:984](src/components/sections/PlanCuentasSection.jsx#L984)) — cambio `user?.tenant_id || user?.empresa_id` → solo `user?.empresa_id`. El field legacy `tenant_id` podía tener UUID viejo distinto de empresa_id, causando que la nueva validación del RPC rechazara la inicialización.

13. **SelectItem value="" → sentinel "\_\_none\_\_"** — Radix UI no permite SelectItem con string vacío (crash de toda la página). Arreglado en PlanCuentasSection (Cuenta padre) y CuentasBancariasSection (mapeo CSV). Patrón: usar sentinel y convertir a null/"" al guardar.

14. **Dropdown Cuenta padre con popper position** — Radix Select default era "item-aligned" → clippeaba items arriba/abajo. Cambiado a `position="popper"` + `sideOffset={4}` + ancho del trigger. Ahora abre siempre debajo del input.

15. **Auto-scroll molesto en dropdowns de plan** — `max-h-48` → `max-h-[400px]` para que entren ~14 items sin necesidad de hover scroll.

16. **Notificaciones cache stale** ([useNotifications.js](src/hooks/useNotifications.js)):
   - `staleTime: 5min` → `30s` + `refetchOnWindowFocus: true` + `refetchInterval: 60s`.
   - Invalidación manual en [ProductosSection.jsx](src/components/sections/ProductosSection.jsx) (después de crear/editar/ajustar stock/desactivar) y [OrdenesCompraSection.jsx](src/components/sections/OrdenesCompraSection.jsx) (cambio estado, cancelar, recibir).
   - Ya no quedan alertas "fantasma" después de resolver.

17. **Cobro CC fallaba con RLS 42501** ([ClientDetailModal.jsx](src/components/sections/ClientDetailModal.jsx)) — INSERT a `cuenta_corriente_movimientos` y `movimientos_caja` no mandaba `empresa_id`. La policy `cta_cte_empresa` lo rechazaba. Agregado `empresa_id: user.empresa_id` en ambos.

18. **Movimientos bancarios — validación silenciosa** ([CuentasBancariasSection.jsx](src/components/sections/CuentasBancariasSection.jsx)):
   - Antes: si faltaba cuenta, monto o monto=0 → `return` sin avisar nada. Usuario pensaba "no hace nada".
   - Ahora: toasts rojos específicos por cada caso.
   - Monto `type="number"` → `type="text" inputMode="decimal"` + `parseNumberLocale()`.
   - Cache invalidation fix: `qc.invalidateQueries({ queryKey: CB_KEYS.movimientos(empresaId) })` no matcheaba con queries que tenían filtros aplicados (array `[..., empresaId, filters]`). Cambiado a prefijo `['movimientos_bancarios', empresaId]`.

19. **Editar proveedor — warning inputs uncontrolled** ([ProveedoresSection.jsx](src/components/sections/ProveedoresSection.jsx)) — al editar proveedor con campos NULL en DB, los inputs recibían `value={null}`. Agregado sanitizador `Object.entries(prov).map(([k, v]) => [k, v ?? ''])` antes del `setForm`.

20. **Crear cliente perdía focus en cada tecla** ([ClientesSection.jsx](src/components/sections/ClientesSection.jsx)) — `ClientForm` estaba definido como componente DENTRO del padre. En cada `setState` del padre se creaba nueva referencia → React lo trataba como componente nuevo → desmontaba y remontaba TODO el form → focus perdido. Solución: renombrar a `renderClientForm` y usarlo como función `{renderClientForm({...})}` (no como `<ClientForm />`). Patrón a evitar a futuro.

21. **Checkboxes módulos Usuarios — doble disparo** ([UsuariosSection.jsx](src/components/sections/UsuariosSection.jsx)) — el `<div>` padre tenía `onClick={handlePermissionChange}` y el `<Checkbox>` también tenía `onCheckedChange={handlePermissionChange}`. Al clickear sobre el checkbox: primero disparaba Checkbox, después propagaba al div → toggle X2 → se cancelaba. Inconsistente (en label funcionaba, en checkbox no). Solución: `pointer-events-none` en el Checkbox + `tabIndex={-1}` (solo refleja estado visual, el div maneja el click).

22. **Logo de empresa no aparecía en Header** ([Header.jsx](src/components/Header.jsx)) — `logoUrl` se calculaba pero alguien removió el `<img>` con comentario "Replaced logo image with company name text". Re-agregado como cuadradito 40×40 con bordes redondeados al lado del nombre de empresa. Aparece solo si hay logo subido en Configuración.

23. **Edge Functions CORS hardcoded en localhost:3001** ([_shared/auth.ts](supabase/functions/_shared/auth.ts), [invite-user/index.ts](supabase/functions/invite-user/index.ts), [create-user/index.ts](supabase/functions/create-user/index.ts), [delete-user/index.ts](supabase/functions/delete-user/index.ts)):
   - Bug: cuando dev server corre en :3000, la edge function rechazaba con CORS por hardcodear `localhost:3001`.
   - Fix: `buildCorsHeaders(req)` con whitelist de orígenes (producción + localhost:3000/3001/5173). Refleja el origin del request si está permitido.
   - `errorResponse` y `okResponse` ahora aceptan `req` opcional para usar el CORS dinámico.
   - **⚠️ Pendiente deploy** — el código local está listo pero NO se aplicó a Supabase Functions. Las invitaciones siguen fallando en localhost hasta el deploy.

24. **Bug ReporteParidad — cálculos absurdos** ([ReporteParidad.jsx](src/components/reportes/ReporteParidad.jsx)) — `computeParalelo` asumía que `monto` venía en la moneda de la operación. Como ahora SIEMPRE viene en ARS (decisión de diseño punto 2), simplificado a `Number(monto) / Number(tcParaleloFecha)`. KPIs cuadran.

25. **PGRST116 ruido en consola** — `tipoCambioService.getTodayTC()` y `useTCParalelo` cambiados de `.single()` a `.maybeSingle()` para evitar el log 406 cuando no hay TC del día (caso esperado).

**Cambios en DB (migrations / UPDATEs):**
1. `fix_seed_plan_cuentas_security_definer` — RPC con SECURITY DEFINER + validación interna.
2. `UPDATE tipos_cambio SET tasa = tasa * 1000` — corrección datos corruptos USD/EUR/BRL.
3. `UPDATE comprobantes SET tipo_cambio_tasa = tipo_cambio_tasa * 1000` — 3 ventas con TC mal guardado.

**Convenciones nuevas para el equipo:**

- **Formato numérico es-AR ESTRICTO**: `.` = miles, `,` = decimal, sin separadores = entero. Cualquier input numérico debe usar `parseNumberLocale()` de `currencyUtils.js`. NO usar `parseFloat()` directo sobre input del usuario.
- **Componentes inline dentro de otros componentes**: si necesitás un sub-componente que comparte state del padre, usalo como FUNCIÓN (`{renderForm()}`) no como componente JSX (`<Form />`). Sino React remonta en cada render y pierde focus.
- **Radix SelectItem**: NUNCA `value=""`. Usar sentinel string como `"__none__"` y convertir a null/"" al guardar.
- **Cache invalidation queryKey**: si la queryKey tiene filters (`['table', empresaId, filters]`), invalidar con prefijo `['table', empresaId]`, NO con `KEYS.list(empresaId)` que arma `[..., empresaId, undefined]` y no matchea.
- **Notificaciones**: cualquier mutation que cambie stock, estado OC, deuda CC o caja debe invalidar `['notif']`. Helper `invalidateNotifs()` o `invalidateOCAndNotifs()` en cada sección.
- **INSERTs en tablas con RLS multi-tenant**: SIEMPRE incluir `empresa_id: user.empresa_id`. Las policies validan eso, sino dan 42501.
- **`.single()` vs `.maybeSingle()`**: usar `.maybeSingle()` cuando es esperado que no haya filas (configs opcionales, lookups con fallback). Sino el navegador loguea 406 PGRST116 aunque el código JS lo maneje bien.

**Pendientes identificados (no resueltos hoy):**

- ✅ **Deploy Edge Functions** (create-user v3, invite-user v3, delete-user v2) — desplegadas vía MCP en sesión PM·3. CORS dinámico con whitelist `buildCorsHeaders(req)` activo. `Vary: Origin` incluido.
- ✅ **Tabs Contabilidad faltantes** — **RESUELTO**: Períodos se agregó en sesión posterior; P&L y Balance General implementados en Sesión 28. `PlanCuentasSection.jsx` tiene ahora los 7 tabs reales: Plan, Asientos, Balance, Estado de Resultados, Balance General, Libro Mayor, Períodos.
- ⚠️ **Invalidación notifs en CC y Caja**: pendiente aplicar el mismo patrón de `invalidateNotifs()` en `CuentaCorrienteSection` (cobrar deuda) y `CajaSection` (cerrar caja). Sino esas notifs quedan stale 30s tras resolver.
- ⚠️ **BRL TC = 3.6**: el valor es bajo (real argentino actualmente ~$240-300 ARS). Usuario debería recargarlo manualmente con valor real.
- ⚠️ **Tests automatizados**: nada. Toda la verificación es manual por el usuario. Riesgo alto de regresiones.

### Sesión 2026-06-09 (PM·2) — Bugs #4–#7: aging, toast stock, fechas OC, TC bloquea OC

**Archivos modificados:**
- `src/components/sections/CuentaCorrienteSection.jsx` — Bug #4: `fetchAgingData()` ahora calcula antigüedad desde `comprobantes.estado_pago = 'pendiente'` (Open Items reales) en vez del DEBE más antiguo históricamente. Elimina falsos positivos en banda +90 días para clientes con deuda vieja pagada y deuda nueva reciente.
- `src/components/ventas/NuevaVentaModal.jsx` — Bug #5: `updateQuantity()` muestra toast destructivo "Solo hay X unidades disponibles de Y" cuando la cantidad del carrito supera el stock. Antes fallaba silenciosamente.
- `src/components/sections/OrdenesCompraSection.jsx` — Bug #6: 4 ocurrencias de `new Date().toLocaleDateString('es-AR')` reemplazadas por `formatDateAR()` de `dateUtils.js` (usa UTC, evita desfase UTC-3). Import agregado. — Bug #7: `MonedaSelector` recibe `onTCMissingChange={setTcMissingOC}`; botón "Crear Orden de Compra" deshabilitado con mensaje ⚠ cuando `moneda !== 'ARS'` y falta TC del día. `resetForm()` también resetea `tcMissingOC`.

**Convenciones reforzadas:**
- Aging de CC: siempre desde comprobantes con `estado_pago = 'pendiente'`, nunca desde movimientos DEBE crudos.
- Fechas en UI: siempre `formatDateAR()` / `formatDateTimeAR()`. Nunca `new Date().toLocaleDateString()`.
- MonedaSelector en formularios críticos (Ventas, OC): siempre incluir `onTCMissingChange` + bloquear submit si `tcMissing`.

### Sesión 2026-06-09 (PM) — 6 tareas: race condition stock, moneda paralela CC, POS server-side search, índices, user.id

**Archivos modificados:**
- `src/components/sections/CuentaCorrienteSection.jsx` — Tarea 1: `user_id: user.id` en INSERTs; Tarea 2: caja solo requerida para Efectivo (no bloquea Transferencia/Tarjeta/Cheque); Tarea 5: `monto_paralelo` + `tc_paralelo` via `useTCParalelo()` en cobros CC
- `src/components/ventas/NuevaVentaModal.jsx` — Tarea 3: stock decrement ahora usa RPC atómica `decrement_stock` (evita race conditions con ventas simultáneas); Tarea 6: init() ya no carga todos los productos — búsqueda server-side debounced 300ms, min 2 chars, `.or('nombre.ilike,codigo_sku.ilike')`, limit 30; cotizacion pre-fill fetch por IDs específicos
- `src/components/sections/ClientDetailModal.jsx` — `user_id: user.id` en ambos INSERTs (cuenta_corriente_movimientos + movimientos_caja)
- `src/components/sections/ClientesSection.jsx` — `user_id: user.id` en INSERT clientes
- `src/components/ui/CSVImportModal.jsx` — `user_id: user.id` en buildRow (clientes import CSV)
- `src/components/sections/ComprasSection.jsx` — `user_id: user.id` en INSERTs + `.eq('empresa_id')` en queries
- `migrations/022_rpc_decrement_stock.sql` — RPC `decrement_stock(p_producto_id, p_cantidad)` con SECURITY DEFINER, UPDATE atómico, check stock ≥ 0
- `migrations/023_indices_faltantes.sql` — 4 índices: `idx_comprobantes_estado_pago`, `idx_comprobantes_fecha`, `idx_cta_cte_empresa_cliente_tipo`, `idx_mov_inv_fecha`

**Convenciones confirmadas/reforzadas:**
- `user.tenant_id === user.empresa_id` (SupabaseAuthContext.jsx:84) — NUNCA usar como `user_id` en INSERTs. Siempre `user.id` para auditoría.
- Búsqueda POS server-side: state `products` vacío al montar; se pobla solo con debounced search de 2+ chars. Compatible con pre-fill de cotizaciones (fetch por `.in('id', ids)`).

**Pendiente (aplicar en Supabase SQL Editor):**
- Migration 022: `decrement_stock` RPC — aún NO aplicada a DB
- Migration 023: índices — aún NO aplicados a DB

### Sesión 2026-06-09 (AM) — Fix bugs críticos (Dashboard KPIs · Lista Precio 400 · Notificaciones) + Ficha de Alcance DOCX

- **Bugs críticos corregidos:**
  - `dashboardService.ts` — todas las queries de `getKPIs`, `getVentasPorDia` y `getFlujoCajaMensual` usaban `.eq('user_id', empresaId)` en lugar de `.eq('empresa_id', empresaId)` → KPIs del Dashboard mostraban 0 para todas las empresas. Fix: reemplazado en las 3 funciones.
  - `listaPreciosService.ts` — `getItems()` usaba PostgREST embedded select `.select('*, productos(nombre, codigo_sku, precio_venta)')` pero `lista_precio_items.producto_id` no tiene FK a `productos` en la migración 021 → 400 Bad Request al abrir una lista. Fix: reescrito como consulta en dos pasos (query items → `.in('id', productoIds)` en productos → merge manual).
  - `Dashboard.jsx` — `<Header>` se renderizaba sin la prop `onNavigate`, por lo que `onNavigate?.(item.seccion)` en Header.jsx siempre era `undefined?.()` → las notificaciones no navegaban al módulo de origen. Fix: agregado `onNavigate={setActiveSection}` al componente `<Header>`.
  - `OrdenesCompraSection.jsx` — `searchProducto()` usaba `.eq('user_id', empresaId)` → búsqueda de productos al crear una nueva OC devolvía vacío. Fix: `.eq('empresa_id', empresaId)`.
- **Documentación generada:**
  - `docs/generate_ficha_alcance.js` + `docs/KAIROX_Gestion_Ficha_Alcance.docx` — script Node.js + DOCX Word profesional con 9 secciones, 29 módulos documentados, tabla comparativa de competidores.

### Sesión 2026-06-08 (PM) — Testing roadmap + bugs UX/conversión moneda

- **Bugs corregidos durante testing manual:**
  - `dashboardService.ts`, `cajaService.ts`, `clientesService.ts`, `comprasService.ts`, `productosService.ts`, `OrdenesCompraSection.jsx` — 14 ocurrencias de `.eq('user_id', empresaId)` → `.eq('empresa_id', empresaId)`
  - `Sidebar.jsx` — soporte modo claro con variantes `dark:`
  - `ProductosSection.jsx` — SKU obligatorio: auto-genera `SKU-{timestamp}` si vacío + mensaje de duplicado claro
  - `NuevaVentaModal.jsx` — carrito invisible en flexbox: `min-h-0` + `min-h-[200px]` en panel carrito
- **TC del día — fix schema + parser robusto:**
  - `tipoCambioService.js` — removidas columnas `user_id` y `updated_at` del upsert (no existen en DB real)
  - `TipoCambioModal.jsx` + `MonedaSelector.jsx` — input cambiado de `type="number"` a `type="text" inputMode="decimal"` (fix locale español rechazando ".")
  - `currencyUtils.js` — nuevo helper `parseNumberLocale()`: detecta formato es-AR vs en-US automáticamente
- **Conversión moneda en venta (decisión de diseño adoptada):**
  - Productos siempre en ARS. Ventas se guardan SIEMPRE en ARS. Solo display se convierte.
  - `NuevaVentaModal.jsx` — `totalEnMonedaSeleccionada()` divide por tasa solo para mostrar. Banner "Equivale a $X ARS (TC $Y)"
  - `ComprobantePrintModal.jsx` — ticket muestra bloque moneda cobrada + TC + equivalente ARS cuando moneda ≠ ARS
  - `HistorialVentas.jsx` — badge USD/EUR + equivalente debajo del total ARS
  - Fix línea 283: `calculateTotal()` siempre devuelve ARS (era doble conversión)
- **UX Cotizaciones** (`CotizacionesSection.jsx`) — cliente: autocomplete + nombre libre; producto: dropdown en focus, carga 200 en memoria; cantidad: step 1; unidad: datalist 17 opciones
- **UX Pedidos** (`PedidosSection.jsx`) — fix step cantidad

### Sesión 2026-06-08 (PM) — Testing roadmap + bugs UX + conversión moneda

- **Bugs corregidos durante testing manual:**
  - `dashboardService.ts`, `cajaService.ts`, `clientesService.ts`, `comprasService.ts`, `productosService.ts`, `OrdenesCompraSection.jsx` — 14 ocurrencias de `.eq('user_id', empresaId)` → `.eq('empresa_id', empresaId)`
  - `Sidebar.jsx` — soporte modo claro con variantes `dark:`
  - `ProductosSection.jsx` — SKU obligatorio: auto-genera `SKU-{timestamp}` si vacío + mensaje de duplicado claro
  - `NuevaVentaModal.jsx` — carrito invisible en flexbox: `min-h-0` + `min-h-[200px]` en panel carrito
- **TC del día — fix schema + parser robusto:**
  - `tipoCambioService.js` — removidas columnas `user_id` y `updated_at` del upsert (no existen en DB real)
  - `TipoCambioModal.jsx` + `MonedaSelector.jsx` — input cambiado de `type="number"` a `type="text" inputMode="decimal"` (fix locale español rechazando ".")
  - `currencyUtils.js` — nuevo helper `parseNumberLocale()`: detecta formato es-AR vs en-US automáticamente
- **Conversión moneda en venta (decisión de diseño adoptada):**
  - Productos siempre en ARS. Ventas se guardan SIEMPRE en ARS. Solo display se convierte.
  - `NuevaVentaModal.jsx` — `totalEnMonedaSeleccionada()` divide por tasa solo para mostrar. Banner "Equivale a $X ARS (TC $Y)"
  - `ComprobantePrintModal.jsx` — ticket muestra bloque moneda cobrada + TC + equivalente ARS cuando moneda ≠ ARS
  - `HistorialVentas.jsx` — badge USD/EUR + equivalente debajo del total ARS
  - Fix línea 283: `calculateTotal()` siempre devuelve ARS (era doble conversión)
- **UX Cotizaciones** (`CotizacionesSection.jsx`) — cliente: autocomplete + nombre libre; producto: dropdown en focus, carga 200 en memoria; cantidad: step 1; unidad: datalist 17 opciones
- **UX Pedidos** (`PedidosSection.jsx`) — fix step cantidad

### Sesión 2026-06-08 — TC del día + Moneda Paralela + Bugs críticos producción
- **Bugs críticos corregidos:**
  - `acf8363` — Supabase client lazy (evita TDZ por BroadcastChannel en bundle)
  - `76b0ab1` — Remove framer-motion (TDZ crash en producción)
  - `6454d70` — Fix TDZ `calculateTotal before initialization`
  - `1945a51` — Fix `removeChild` DOM error en NuevaVentaModal product dropdown
  - `77997a1` — Defer `focus()` call after React DOM commit
  - `806f428` — Fix Google Translate DOM corruption (removeChild/insertBefore)
  - `a57cf76` — Harden sale flow contra stale-session 403 + silent failures
  - `85231c1` — Fix CC sale status (Pendiente no Pagada) + MonedaSelector input + cotizaciones product search
- **TC del día centralizado** (`1260307`):
  - Tabla `tipos_cambio` + migration `create_tipos_cambio`
  - `tipoCambioService.js` — `getTodayTC()` + `upsertTC()` (fecha local Argentina)
  - `TipoCambioModal.jsx` — dialog auto-open, autoFocus, Enter key
  - `MonedaSelector.jsx` — reescrito: auto-fetch TC, badge OK/Missing, prop `onTCMissingChange`
  - `CotizacionesSection.jsx` — integra TC obligatorio
- **Moneda Paralela SAP-style** (`576a0d8`):
  - Migration `add_moneda_paralela` — 5 tablas alteradas
  - `useTCParalelo.js` — hook empresa settings + TC diario + `calcParalelo()` + `tcMissing`
  - `ConfiguracionSection.jsx` — card "Moneda Paralela" con toggle + Select moneda + info chips
  - `NuevaVentaModal.jsx` — banner TC paralelo, bloqueo ARS si tcMissing, guarda `monto_paralelo`/`tc_paralelo`
  - `ReporteParidad.jsx` — reporte completo ARS/USD con cálculo retroactivo + CSV export
  - `ReportesSection.jsx` — tarjeta Reporte Paridad, disabled si `!tcParaleloEnabled`

### Sesión 2026-06-07 — Deploy Vercel (Fase 7 inicio)
- `vercel.json` + `vite.config.prod.js` — config producción sin plugins Horizons
- Fix `manualChunks` TDZ (circular deps con framer-motion) → sin chunk splitting manual
- Deploy exitoso en https://kairox-gestion.vercel.app (Vercel CLI `vercel --prod`)
- Env vars configuradas: `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`
- GitHub conectado a Vercel (pendiente reconectar al repo correcto `lbanegas96/kairox-gestion`)

### Sesión 2026-06-07 — Fase 6 completa (commit `a846bac`)
- migration 021: listas_precio + lista_precio_items + cols cotizacion_id/pedido_id en comprobantes
- `ListasPrecioSection.jsx` + `listaPreciosService.ts`: CRUD listas, precios por producto, asignación a cliente
- `NuevaVentaModal.jsx`: precios de lista aplicados automáticamente, badge "LISTA" en carrito
- `ClientesSection.jsx`: selector de lista en form de cliente
- `useNotifications.js`: fix `user_id→empresa_id` + caja sin cerrar +24h
- `DocumentFlowPanel.jsx` + `documentFlowService.ts`: panel SAP Document Flow en SaleDetailModal
- `OrdenesCompraSection.jsx`: fix TanStack Query v5 (`onSuccess→useEffect`) en recepción OC
- MCP Supabase configurado en `~/.claude/settings.json` — operativo ✅

### Sesión 2026-06-07 (continuación) — Infraestructura / Fix MCP
- Confirmado migraciones 018, 019, 020 aplicadas en Supabase ✅
- Fix conector MCP Supabase: reconectado a cuenta NALUX vía OAuth

### Sesión 2026-06-25 (continuación) — Barrido técnico autónomo: security + performance

**Commits:** `37ba5a0`

- **Migration 097 — REVOKE anon en 4 funciones internas** (`37ba5a0`):
  - `fn_calcular_costo_valoracion`, `next_numero_asiento`, `recalcular_saldo_cuenta` — escaparon de migration 063 (no eran RPCs visibles para PostgREST pero tenían `has_function_privilege('anon')=true`)
  - `fn_seed_tipos_comprobante_afip` — seed de tipos AFIP, nunca debería ser pública
  - `crear_devolucion` — migration 096 (CREATE OR REPLACE) perdió el `SET search_path TO 'public'`; restaurado con `ALTER FUNCTION`
  - Verificado: único anon=true restante es `email_exists_in_system` (intencional — pre-signup)
- **Migration 098 — Performance: 75 FK indexes + 38 unused index drops** (`37ba5a0`):
  - 75 `CREATE INDEX IF NOT EXISTS` sobre columnas FK que no tenían índice de cobertura (todas las tablas principales del sistema)
  - 38 `DROP INDEX IF EXISTS` sobre índices sin uso confirmados por Supabase Performance Advisors
  - Net: +37 índices (nuevos FK - eliminados sin uso) → menos overhead de escritura, mejor lookup en JOINs

### Sesión 2026-06-25 — Capa C numeración + Guards RPCs + POS página completa

**Commits:** `5d259c0` · `62dacdd` · `b2c9c68` · `85bad7e` · `618720f`

- **Label NC/ND + botón Devolver en OCs** (`5d259c0`):
  - `NuevaDevolucionProveedorModal.jsx`: prop `oc = null` (dual-path), label corregido a "Nota de Crédito del proveedor", `handleConfirm` usa `compra?.id || null`, post-RPC actualiza `cantidad_devuelta` en `ordenes_compra_items`
  - `OrdenesCompraSection.jsx`: botón RotateCcw naranja en filas `recibida`/`recibida_parcial`, botón "Devolver" en footer de detalle, modal `NuevaDevolucionProveedorModal` con prop `oc`
- **Migration 094 — UNIQUE (empresa_id, numero) en 8 tablas** (`62dacdd`):
  - Borró phantom entrega `1659043e` (sin movimiento de stock, duplicado por race condition en COUNT*)
  - Constraints en: `entregas.numero_entrega`, `devoluciones.numero_devolucion`, `comprobantes.numero_venta`, `pedidos.numero`, `cotizaciones.numero`, `ordenes_compra.numero`, `recepciones.numero_recepcion`, `notas_debito.numero_nd`
- **Migration 095 — REVOKE anon overload Ualá** (`b2c9c68`):
  - `insertar_movimiento_bancario_externo` 8-arg (con `p_subtipo`, agregado en migration Ualá) tenía anon=true ❌ → corregido; original 7-arg ya estaba protegido
- **Migration 096 — NC en crear_devolucion usa obtener_proximo_numero** (`85bad7e`):
  - Antes: `siguiente_numero_documento` (COUNT* sin lock → podía generar NC- duplicados)
  - Ahora: `obtener_proximo_numero(p_empresa_id, 'nota_credito')` → FOR UPDATE en `series_numeracion`
- **POS como página completa para admin** (`618720f`):
  - `ModoCajaLayout.jsx`: prop `onBack = null`; si onBack → "← Volver al panel", si null → "Salir" (solo_caja)
  - `App.jsx`: state `showPOS`; 3 ramas: `solo_caja/modo_caja` → ModoCajaLayout(onLogout), `showPOS` → ModoCajaLayout(onBack), default → Dashboard(onEnterPOS)
  - `Dashboard.jsx`: `handleSidebarSelect` intercepta section='pos' → llama `onEnterPOS()`, removido `posOpenNonce`
  - `Sidebar.jsx`: primer item VENTAS: `{ id: 'pos', label: 'Punto de Venta', icon: Monitor }`

### Sesión 2026-06-07 — Fase 5 completa
- `ProveedoresSection.jsx` + `proveedoresService.ts` — ficha completa, CC, OC, pago inline
- `LaunchpadSection.jsx` + `portalService.ts` — home Fiori-style con 4 portales por área
- `portals/VentasPortal.jsx` · `ComprasPortal.jsx` · `FinanzasPortal.jsx` · `InventarioPortal.jsx`
- `Sidebar.jsx` reescrito — 5 grupos con headers coloreados navegables a portales
- `migrations/020_notas_credito.sql` — NC columns en comprobantes ✅ aplicada
- `notaCreditoService.ts` + `NotaCreditoModal.jsx` — devolución parcial/total
- `abcService.ts` — clasificación A/B/C por revenue
- `ReportesSection.jsx` — comparativa período anterior con delta %

### Sesión 2026-06-06 — Fases 3 y 4 completas
- PedidosSection workflow, convertir a venta, confirmación AlertDialog
- DashboardSection: Top 5 vendidos + último mov banco + OnboardingBanner
- ConfiguracionSection: datos de ejemplo (8 productos + 3 clientes)
- 10 bugs corregidos (locale, Radix dialogs, permisos, UX)

### Sesión 2026-06-06 — Fase 2 completa
- Multi-pago en venta, aging CC, remito sin precios, fix arqueo caja
- Import CSV productos/clientes, límite crédito, condición pago, solo-caja

### Sesión 2026-06-05 — Deuda técnica
- Migrations 013-016, soft delete productos, paginación, Edge functions, SMTP

### Sesión 2026-06-04 — Setup + Open Item Management
- Open Item CC SAP-style, trigger saldo cliente, bugfixes

### Sesión 2026-06-26 — CAEA backend completo (sesión 65 continuación)

**Commits:** `cd69c22` · `aa2c206`

**Migration 103** — Tablas + RPC CAEA:
- `caea_registros`: un CAEA por empresa+quincena+tipo+PdV; RLS `get_my_empresa_id()`; índice sobre `(empresa_id, estado, fecha_hasta)`
- `caea_comprobantes`: cola de comprobantes offline pendientes de informar; RLS; FK a `comprobantes`
- `comprobantes.modo_autorizacion` varchar(10) DEFAULT `'CAE'`; `comprobantes.caea_registro_id` FK
- `empresas.afip_usa_caea` + `afip_caea_auto_solicitar` boolean
- RPC `usar_caea_en_venta` — SECURITY DEFINER, guard multi-tenant explícito, REVOKE anon/public

**Migration 104 — Bug fix crítico detectado en revisión**:
- `usar_caea_en_venta` ponía `cae_estado='pendiente_caea'` → CHECK violation en producción
- Fix: `cae_estado='no_aplica'` (los comprobantes CAEA no necesitan CAE individual)
- `modo_autorizacion='CAEA'` + `caea_registro_id` los identifican; `caea_comprobantes.estado_informado` rastrea el ciclo AFIP
- Agregado `CHECK (modo_autorizacion IN ('CAE','CAEA'))` que faltaba en migration 103

**`_shared/wsfe.ts`** — 4 métodos CAEA nuevos:
`feCAEASolicitar` · `feCAEAConsultar` · `feCAEAInformarComprobante` · `feCAEASinMovimiento`

**3 Edge Functions deployadas ACTIVE (verify_jwt=true)**:
- `solicitar-caea`: quincena auto-calculada por fecha ARS, maneja 15004 (ya solicitado) y 15008 (no habilitado aún), upsert idempotente
- `informar-caea`: batch de 250 comprobantes, fallback `SinMovimiento` si sin movimiento, reintentable si falla parcialmente
- `verificar-caea-vigente`: solo-DB, sin AFIP, responde <100ms — para POS offline

**`CAEA_IMPLEMENTACION.md`**: guía completa de test en homologación AFIP, errores conocidos, flujo de estados, pendientes frontend.

**Flujo de estados**:
`solicitar-caea` → `caea_registros.estado='activo'` → `usar_caea_en_venta` (N veces) → `informar-caea` → `FECAEAInformarComprobante | FECAEASinMovimiento` → `estado='informado'`

**CAEA — Decisión de alcance final**: AFIP requiere habilitación especial para CAEA (grandes superficies, zonas sin conectividad, alto volumen). Las PyMEs típicas de KAIROX **no califican**. El backend (migration 103+104 + 3 Edge Functions) queda como infraestructura durmiente para clientes grandes futuros. **Frontend CAEA descartado del roadmap cercano.** El roadmap gira a mejorar UX de CAE online.

### Sesión 2026-06-27 — MercadoPago: CORS fix + HMAC fix + mp-sync (sesión 66)

**Commits:** `2d0bec9` · `14f37c5`

**Contexto:** Pagos reales de MP (link de cobro, QR, transferencias CVU) no impactaban en el módulo Bancos de KAIROX.

**Edge Functions deployadas/actualizadas:**

- **`mp-verify-token`** (nuevo — fix CORS): `ConfigMercadoPagoModal.jsx` llamaba `api.mercadopago.com/users/me` directo desde el browser → CORS blocked. Fix: proxy server-side en Edge Function; el modal ahora usa `supabase.functions.invoke('mp-verify-token', ...)`.
- **`mp-webhook`** (fix HMAC): La firma usaba `request-id:;` (vacío) pero MP incluye el header `x-request-id` en el mensaje firmado: `id:{id};request-id:{requestId};ts:{ts};`. Fix: leer `req.headers.get('x-request-id')` y pasarlo a `validarFirmaMP`. Deploy con `--no-verify-jwt`.
- **`mp-sync`** (nuevo — safety net): Polling periódico de `GET /v1/payments/search?status=approved&begin_date={ultimo_sync}` para todas las integraciones activas. Inserta via RPC `insertar_movimiento_bancario_externo`, deduplica por `descripcion LIKE 'MP #%'`, actualiza `ultimo_sync`.

**Migration 106:** `integraciones_bancarias.ultimo_sync TIMESTAMPTZ` — tracking del último sync.

**Migration 107 + pg_cron:** Job `mp-sync-every-30-min` (`*/30 * * * *`), activo, `jobid=2`.

**SUBTIPO_MAP** (compartido en mp-webhook y mp-sync):
```
bank_transfer → transferencia | account_money → qr | credit_card → tarjeta_credito | debit_card → tarjeta_debito
```

**Estado DB al cierre:**
- `integraciones_bancarias`: row activo empresa `cbc4db74`, token `APP_USR-2115...`, `cuenta_bancaria_id=aca3fd2f`, `ultimo_sync=null`
- `movimientos_bancarios`: 12 entradas `origen='manual'`, 0 `origen='mercadopago'` (mp-sync aún no corrió)
- Crons activos: `arca-worker` (*/5, jobid=1) + `mp-sync` (*/30, jobid=2)

**Resultado confirmado al cierre de sesión (mp-sync corrió y capturó todo):**

| Payment ID | Subtipo | Monto | Email pagador | Fecha MP |
|---|---|---|---|---|
| `166125731472` | qr | $5.000 | nadiatecera13@gmail.com | 27/06 22:23 |
| `165295269275` | qr | $5.000 | nadiatecera13@gmail.com | 27/06 22:17 |
| `165293907565` | qr | $10.000 | Pagador desconocido | 27/06 22:11 |
| `165294062397` | transferencia | $10.000 | lucianoismael15@hotmail.com | 27/06 22:10 |

Movimientos visibles en KAIROX Bancos con badge "Mercadopago" ✅. Cuenta "Mercado Pago personal" con saldo $115.200.

**Diagnóstico — webhooks:** Los webhooks de MP no llegaron para estos pagos (no hay hits de mp-webhook en logs excepto la simulación). mp-sync actúa como safety net completo; los webhooks serían solo una optimización de latencia.

**Pendiente sesión 67:**
- Ajustes de detalle en la descripción de movimientos MP (ej: mostrar nombre en lugar de email, formatear account_money como "Billetera MP")
- Investigar por qué los webhooks de MP no llegaron (bajo impacto dado que mp-sync funciona)
- Opcional: botón "Sincronizar ahora" en `ConfigMercadoPagoModal` para sync manual on-demand

---

## 3 grandes proyectos al final

| # | Proyecto | Por qué al final |
|---|---|---|
| 1 | **Deploy en Vercel** | ✅ Completado — https://kairox-gestion.vercel.app |
| 2 | **Membresías / Stripe o MercadoPago** | Requiere ARCA primero + modelo de precios validado |
| 3 | **Modelo de licencias (Starter/Pro/Business)** | Requiere primeros clientes |
