# KAIROX Gestión — Contexto de Sesión
**Última actualización:** 2026-06-09 — Fix bugs críticos (Dashboard KPIs, Listas Precio 400, Notificaciones, OC búsqueda) + Ficha de Alcance DOCX ✅
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
| Launchpad (Home) | `LaunchpadSection.jsx` | ✅ Tiles por área + KPIs + accesos rápidos |
| **Listas de Precios** | `ListasPrecioSection.jsx` + `listaPreciosService.ts` | ✅ CRUD listas + items por producto + asignación a cliente |
| Dashboard Ejecutivo | `DashboardSection.jsx` | ✅ 8 KPIs + 2 gráficos (accesible desde Portal Finanzas) |
| Portal Ventas | `portals/VentasPortal.jsx` | ✅ 6 KPIs + módulos |
| Portal Compras | `portals/ComprasPortal.jsx` | ✅ 5 KPIs + módulos |
| Portal Finanzas | `portals/FinanzasPortal.jsx` | ✅ 5 KPIs + posición neta CxC-CxP |
| Portal Inventario | `portals/InventarioPortal.jsx` | ✅ 5 KPIs + barra salud stock |
| Ventas (POS) | `VentasSection.jsx` + `NuevaVentaModal.jsx` | ✅ Multi-pago + check límite crédito + Moneda Paralela |
| Notas de Crédito | `NotaCreditoModal.jsx` + `notaCreditoService.ts` | ✅ Devolución parcial/total + reversión stock/CC/caja |
| Historial Ventas | `HistorialVentas.jsx` | ✅ Filtros avanzados + estado_pago CC + paginación 50/pág |
| Comprobantes | `ComprobantePrintModal.jsx` | ✅ Toggle Comprobante / Remito sin precios |
| Inventario | `ProductosSection.jsx` | ✅ Soft delete + import CSV + Análisis ABC |
| Compras | `ComprasSection.jsx` | ✅ Funcional + asiento auto + paginación 50/pág |
| Cotizaciones | `CotizacionesSection.jsx` | ✅ Funcional + convertir a venta + TC obligatorio |
| Pedidos (OC Clientes) | `PedidosSection.jsx` | ✅ Workflow borrador→confirmado→en_preparacion→facturado |
| Órdenes de Compra | `OrdenesCompraSection.jsx` | ✅ Workflow aprobación + 3-way match + realtime |
| Caja | `CajaSection.jsx` + `CajaCierre.jsx` | ✅ Arqueo por denominaciones + tab Arqueos |
| Clientes | `ClientesSection.jsx` | ✅ Form completo + condicion_pago + limite_credito + import CSV |
| Cuenta Corriente | `CuentaCorrienteSection.jsx` | ✅ Tab Antigüedad de Deuda (FIFO 30/60/90/+90 días) |
| Detalle Cta. Cte. | `ClientDetailModal.jsx` | ✅ Open Item Management SAP-style |
| Contabilidad | `PlanCuentasSection.jsx` | ✅ 7 tabs: Plan/Asientos/Balance/LM/P&L/BalanceGeneral/Períodos |
| Proveedores | `ProveedoresSection.jsx` + `proveedoresService.ts` | ✅ Ficha completa + Cta. Cte. + Historial OC + Pago inline |
| Bancos | `CuentasBancariasSection.jsx` | ✅ Import CSV + conciliación auto/manual |
| Reportes | `ReportesSection.jsx` | ✅ 5 reportes + Reporte de Paridad ARS/USD + paginación 100/pág |
| **Tipo de Cambio** | `TipoCambioModal.jsx` + `tipoCambioService.js` | ✅ **NUEVO** TC diario centralizado + upsert por empresa/moneda/fecha |
| **Reporte de Paridad** | `reportes/ReporteParidad.jsx` | ✅ **NUEVO** Comparativa ARS/USD por comprobante + CSV export |
| Usuarios | `UsuariosSection.jsx` | ✅ Invitación + último acceso + activar/desactivar + preset Solo Caja |
| Configuración | `ConfiguracionSection.jsx` | ✅ Logo + toggle OC + datos de ejemplo + **Moneda Paralela SAP-style** |

---

## Migraciones aplicadas en Supabase

| Archivo | Contenido | Estado |
|---|---|---|
| `schema.sql` | Schema base completo + RLS + triggers | ✅ |
| `migrations/001_audit_log.sql` | Tabla audit_log + fn_audit_trigger | ✅ |
| `migrations/002_cotizaciones.sql` | Cotizaciones + cotizacion_items | ✅ |
| `migrations/003_ordenes_compra.sql` | Órdenes de compra + items | ✅ |
| `migrations/004_plan_cuentas.sql` | Plan cuentas + asientos + seed | ✅ |
| `migrations/005_configuracion_rls_fix.sql` | Fix RLS tabla configuracion | ✅ |
| `migrations/009_cajas.sql` | Tabla cajas + FK caja_sesiones | ✅ |
| `migrations/010_drop_ventas_legacy.sql` | Backup + DROP ventas legacy | ✅ |
| `migrations/011_cuentas_bancarias.sql` | Cuentas bancarias + movimientos | ✅ |
| `migrations/012_facturas_proveedor.sql` | 3-way match OC | ✅ |
| `migrations/013_multi_moneda.sql` | Tabla tipos_cambio + columnas tipo_cambio_tasa | ✅ |
| `migrations/014_proveedores.sql` | Ficha completa proveedores + cuenta_corriente_proveedores | ✅ |
| `migrations/015_conciliacion_bancaria.sql` | extractos_bancarios + extracto_lineas + trigger sync | ✅ |
| `migrations/016_security_hardening.sql` | is_admin() + RLS config + rate_limit + audit triggers | ✅ |
| `migrations/017_multi_pago.sql` | Tabla comprobante_pagos + RLS + índices | ✅ |
| `migrations/018_condicion_pago.sql` | condicion_pago + dias_credito en clientes | ✅ |
| `migrations/019_pedidos.sql` | pedidos + pedido_items + RLS + audit trigger | ✅ |
| `migrations/020_notas_credito.sql` | tipo + estado_pago + comprobante_origen_id + motivo_nc en comprobantes | ✅ |
| `migrations/021_listas_precio.sql` | listas_precio + lista_precio_items + lista_precio_id en clientes + cotizacion_id/pedido_id en comprobantes | ✅ |
| **`create_tipos_cambio`** (SQL directo) | Tabla `tipos_cambio` — UNIQUE(empresa_id, moneda, fecha) + RLS via get_my_empresa_id() + índice | ✅ |
| **`add_moneda_paralela`** (SQL directo) | Columnas `usa_tc_paralelo`/`moneda_paralela` en empresas + `monto_paralelo`/`tc_paralelo` en comprobantes, movimientos_caja, cuenta_corriente_movimientos, compras | ✅ |

### SQL adicional ejecutado directamente

```sql
-- Fix fn_audit_trigger: to_jsonb()
-- Trigger saldo cliente automático: fn_update_cliente_saldo
-- Open Item: estado_pago en comprobantes + comprobante_id + metodo_cobro en movimientos
-- Fix v_saldo_proveedores: WITH (security_invoker = true)
-- create_tipos_cambio: tipos_cambio table + UNIQUE constraint + RLS + index
-- add_moneda_paralela: 5 tables altered (empresas + 4 transaction tables)
```

---

## Infraestructura

- **Supabase URL:** `https://wuznppxeonmhfcvnqfbf.supabase.co`
- **Supabase Project ID:** `wuznppxeonmhfcvnqfbf` (org: NALUX)
- **SMTP:** Resend.com — `smtp.resend.com:465` · user: `resend` · sender: KAIROX Gestión ✅
- **Edge Functions deployadas:** `create-user` · `delete-user` · `invite-user` ✅
- **Timezone:** Argentina (UTC-3) — helpers en `src/lib/dateUtils.js`
- **Multi-tenancy:** RLS via `get_my_empresa_id()` + `empresa_id` en todas las tablas
- **Logo:** Base64 en tabla `configuracion` (clave `logo_base64`)
- **Roles:** `admin` (acceso total) | `staff` (permisos granulares en `profiles.permissions` JSONB) | `solo_caja` (solo Ventas + Caja)
- **GitHub:** `https://github.com/lbanegas96/kairox-gestion` (branch: master)

---

## Convenciones (REGLAS DE ORO)

- **Multi-tenant:** TODAS las queries deben filtrar `.eq('empresa_id', user.empresa_id)`. Nunca `user_id` para filtrar (solo para INSERTs como autor).
- **INSERTs:** siempre incluir `empresa_id: user.empresa_id` + `user_id: user.id`.
- **Timezone:** usar siempre `getNowAR()` / `formatDateAR()` / `formatDateTimeAR()` de `dateUtils.js`. Nunca `toLocaleString()`.
- **Clientes activos:** todas las queries de selección incluyen `.neq('activo', false)`.
- **TanStack Query v5:** `onSuccess` en `useQuery` no existe. Usar `useEffect`.
- **RLS en tablas nuevas:** `ENABLE ROW LEVEL SECURITY` + policy `get_my_empresa_id()` + audit trigger + `DROP POLICY IF EXISTS` antes de `CREATE POLICY`.
- **Radix UI Dialogs:** nunca `if (!open) return null` — dejar que Radix maneje show/hide con prop `open`.
- **Caja:** solo cobros en Efectivo requieren caja abierta. Transferencia/Tarjeta/Cheque no.
- **Open Items:** al cobrar CC, siempre referenciar `comprobante_id` en el movimiento HABER.
- **Migrations:** siempre idempotentes — `IF NOT EXISTS`, `DROP POLICY/TRIGGER IF EXISTS`, `CREATE OR REPLACE`.
- **Vistas:** siempre `WITH (security_invoker = true)` para respetar RLS del usuario.
- **Multi-pago:** al confirmar venta, insertar en `comprobante_pagos` + `movimientos_caja` por cada pago no-CC + `cuenta_corriente_movimientos` para suma CC.
- **Límite de crédito:** verificar `saldo_actual + montoCC > limite_credito` antes de confirmar venta CC (cuando limite > 0).
- **Schema mixto PT/ES:** `comprobante_items` usa columnas portuguesas (`produto_id`, `quantidade`). El código existente funciona; NO cambiar sin migración de BD.
- **Notas de crédito:** al crear NC, insertar en `comprobante_items` con columnas PT. Revertir stock vía `movimientos_inventario` + RPC `increment_stock`.
- **Portales:** las secciones `portal_ventas`, `portal_compras`, `portal_finanzas`, `portal_inventario` son entry points — no van en ALL_SECTIONS de permisos.
- **Lista de precios:** `listaPreciosService.getPrecioMapForCliente(clienteId)` retorna `{producto_id: precio}`. En `NuevaVentaModal`, llamar en `handleSelectClient()`. Items con precio de lista tienen `_precioLista: true` para el badge.
- **Document Flow:** `documentFlowService.getFlowForComprobante(id)` retorna nodos origen/actual/NC/cobros. Usar `DocumentFlowPanel` pasando `comprobanteId` + `onNavigate`.
- **Notificaciones:** `useNotifications()` retorna `{items, count, stockBajo, deudaVencida, ocPendientes, cajaSinCerrar, hasNotifications}`. Bug histórico `user_id→empresa_id` ya corregido.
- **TC del día (fecha local):** usar `new Date().toLocaleDateString('en-CA')` para formato `YYYY-MM-DD` en hora local (NO `toISOString()` que da UTC y puede desfasar en UTC-3).
- **TC upsert:** tabla `tipos_cambio` con UNIQUE(empresa_id, moneda, fecha). Siempre `upsert` con `onConflict: 'empresa_id,moneda,fecha'` — nunca insert directo.
- **PGRST116:** el código de error Supabase "no rows returned" (`.single()` sin match) es ESPERADO cuando no hay TC del día — NO es un error real. Verificar `error.code !== 'PGRST116'` antes de `throw`.
- **Moneda Paralela:** cuando `empresa.usa_tc_paralelo = true`, todas las transacciones deben guardar `monto_paralelo` + `tc_paralelo`. Usar `useTCParalelo()` hook. Si `tcMissing = true` → bloquear operación y abrir `TipoCambioModal`.
- **TC sync en NuevaVentaModal:** cuando `moneda === monedaParalela`, el `tipoCambioTasa` del MonedaSelector se sincroniza automáticamente con `tcParalelo.setTC()` vía useEffect.
- **Supabase client lazy:** `customSupabaseClient.js` exporta un getter lazy para evitar TDZ (Temporal Dead Zone) en el bundle de producción. Nunca instanciar Supabase en el top-level de un módulo con `BroadcastChannel`.
- **PostgREST embedded select:** la sintaxis `.select('*, tabla_relacionada(cols)')` SOLO funciona si existe una FK explícita (`REFERENCES`) en PostgreSQL. Sin FK → 400 Bad Request. Si la FK no existe (o no se puede agregar), usar consulta en dos pasos: query principal → `.in('id', ids)` en tabla relacionada → merge manual en JS.
- **Dashboard KPIs:** `dashboardService.ts` filtra SIEMPRE con `.eq('empresa_id', empresaId)`. Nunca `user_id` para queries de lectura.

---

## Arquitectura de navegación (Fiori-style)

```
dashboard (Launchpad)
├── portal_ventas     → POS · Cotizaciones · Pedidos · Clientes · CC
├── portal_compras    → Compras · OC · Proveedores
├── portal_finanzas   → Caja · Bancos · Contabilidad · Panel Ejecutivo
├── portal_inventario → Inventario (con tab Análisis ABC)
└── Admin (sin portal)→ Reportes · Usuarios · Configuración
```

- **Sidebar:** agrupado por área con headers de color. Headers navegan al portal del área.
- **Servicio:** `src/services/portalService.ts` — 5 funciones async con Promise.all
- **Panel Ejecutivo:** `DashboardSection.jsx` — accesible desde Portal Finanzas (`panel_ejecutivo`)

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
- **Caja, Cuenta Corriente, Compras:** columnas ready en DB (implementación pendiente UI)

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
5. ⏳ **ARCA/AFIP** + Libro IVA
6. ⏳ **Membresías** / MercadoPago · Modelo de licencias Starter/Pro/Business

#### Pendientes Fase 7
- Configurar Supabase Auth URLs (Site URL + Redirect URLs → `https://kairox-gestion.vercel.app/**`)
- Extender TC obligatorio a módulos Caja + Cuenta Corriente + Compras (columnas DB ya listas)
- Investigar error 400 en consola (query Supabase con timestamp malformado — no bloquea funcionalidad; DISTINTO al bug de lista_precio_items que ya fue corregido)
- **Commit y deploy a producción** — fixes de esta sesión validados en local; pendiente push + deploy Vercel

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

### 🟢 Baja prioridad (post-ARCA)

| # | Feature | Referente SAP |
|---|---|---|
| 5 | Solicitud de Compra | MM Purchase Req. |
| 6 | Presupuesto vs Real mensual | CO Budget |
| 7 | Gestión de cheques | TM Checks |
| 8 | Cierre formal de períodos contables | FI Period Close |
| 9 | Retenciones IIBB/Ganancias | FI Withholding |

---

## Historial de sesiones

<<<<<<< HEAD
### Sesión 2026-06-08 (PM) — Testing roadmap + bugs UX/conversión moneda
**Branch:** `fix/sidebar-light-mode-and-bugs` (pendiente PR a master)

**Bugs corregidos durante testing manual:**
- **Sidebar:** soporte modo claro — todos los colores hardcoded ahora con variantes `dark:` ([Sidebar.jsx](src/components/Sidebar.jsx))
- **Dashboard KPIs = $0:** servicios filtraban por `.eq('user_id', empresaId)` en vez de `.eq('empresa_id', empresaId)`. Fixeado en 6 servicios (14 ocurrencias): `dashboardService.ts`, `cajaService.ts`, `clientesService.ts`, `comprasService.ts`, `productosService.ts`, `OrdenesCompraSection.jsx`
- **Producto SKU obligatorio:** auto-generación `SKU-{timestamp}` si campo vacío + mensaje claro en error de duplicado ([ProductosSection.jsx](src/components/sections/ProductosSection.jsx))
- **NuevaVentaModal carrito invisible:** agregado `min-h-0` en flex containers + `min-h-[200px]` en panel del carrito para que no colapse a 0 en flexbox

**TC del día — fix schema + parser robusto:**
- Tabla `tipos_cambio` real en DB NO tiene columnas `user_id` ni `updated_at` (a diferencia de lo que asumía el código). Removidas del upsert en [tipoCambioService.js](src/services/tipoCambioService.js)
- Input decimal rechazaba "." en navegador con locale español. Cambiado de `type="number"` a `type="text" inputMode="decimal"` en `TipoCambioModal.jsx` y `MonedaSelector.jsx`
- **Nuevo helper [`parseNumberLocale()`](src/lib/currencyUtils.js)**: detecta automáticamente formato es-AR (`1.668,21`) o en-US (`1,668.21`) — el último separador es decimal, el resto miles

**Conversión moneda en venta (decisión de diseño):**
- **Lógica adoptada:** productos siempre en ARS, ventas se guardan SIEMPRE en ARS, solo display se convierte a moneda elegida para mostrar al cliente
- `NuevaVentaModal.jsx`: nuevo helper `totalEnMonedaSeleccionada()` que divide por la tasa solo para mostrar. Banner "Equivale a $X ARS (TC $Y)" debajo del total
- `ComprobantePrintModal.jsx`: ticket muestra bloque con moneda cobrada + TC + equivalente cuando moneda ≠ ARS
- `HistorialVentas.jsx`: badge USD/EUR + equivalente debajo del total ARS
- Fix línea 283 NuevaVentaModal: `calculateTotal()` siempre devuelve ARS, sin multiplicar por tasa (era doble conversión)

**UX Cotizaciones ([CotizacionesSection.jsx](src/components/sections/CotizacionesSection.jsx)):**
- **Nombre del Cliente:** ahora autocomplete con clientes existentes + permite tipear nombre libre (mensaje aclaratorio)
- **Buscar producto:** dropdown se abre al hacer focus (no requiere tipear 2+ caracteres). Carga 200 productos al montar, filtra en memoria (sin hits Supabase por tecla)
- **Cantidad:** step de `0.001` → `1` (flechitas suben/bajan de 1 en 1)
- **Unidad:** `<input list="unidades-medida">` con datalist de 17 opciones comunes (un, kg, g, l, ml, m, cm, m², m³, caja, paquete, docena, par, hora, día, servicio) + texto libre

**UX Pedidos:** [PedidosSection.jsx](src/components/sections/PedidosSection.jsx) — fix mismo step de cantidad

**Pendientes identificados (no fixeados aún):**
- Configuración: faltan toggles "Módulos Activos" y "Aprobación OC" (posiblemente perdidos en refactor)
- Contabilidad muestra 4 tabs en vez de 7 (verificar tras inicializar Plan de Cuentas)
- Pedidos: dropdown de cliente y producto debería ser igual al de Cotizaciones (mismo patrón)
- Multi-pago en USD: validación interna sigue siendo en ARS, requiere refactor mayor
=======
### Sesión 2026-06-09 — Fix bugs críticos (Dashboard KPIs · Lista Precio 400 · Notificaciones) + Ficha de Alcance DOCX

- **Bugs críticos corregidos:**
  - `dashboardService.ts` — todas las queries de `getKPIs`, `getVentasPorDia` y `getFlujoCajaMensual` usaban `.eq('user_id', empresaId)` en lugar de `.eq('empresa_id', empresaId)` → KPIs del Dashboard mostraban 0 para todas las empresas. Fix: reemplazado en las 3 funciones.
  - `listaPreciosService.ts` — `getItems()` usaba PostgREST embedded select `.select('*, productos(nombre, codigo_sku, precio_venta)')` pero `lista_precio_items.producto_id` no tiene FK a `productos` en la migración 021 → 400 Bad Request al abrir una lista. Fix: reescrito como consulta en dos pasos (query items → `.in('id', productoIds)` en productos → merge manual).
  - `Dashboard.jsx` — `<Header>` se renderizaba sin la prop `onNavigate`, por lo que `onNavigate?.(item.seccion)` en Header.jsx siempre era `undefined?.()` → las notificaciones no navegaban al módulo de origen. Fix: agregado `onNavigate={setActiveSection}` al componente `<Header>`.
- **Nueva regla de convención:** PostgREST embedded select requiere FK explícita en PostgreSQL. Sin FK → usar consulta en dos pasos.
- **Bug adicional corregido (misma sesión):**
  - `OrdenesCompraSection.jsx` — `searchProducto()` usaba `.eq('user_id', empresaId)` → búsqueda de productos al crear una nueva OC devolvía vacío. Fix: `.eq('empresa_id', empresaId)`.
- **Documentación generada:**
  - `docs/generate_ficha_alcance.js` — script Node.js (~600 líneas) usando `docx` npm. Genera documento Word profesional con 9 secciones, brand colors KAIROX, Arial 11pt, márgenes 1", números de página, header/footer confidencial, tabla comparativa de competidores (columnas en blanco para completar manualmente). 7 grupos de módulos, 29 módulos documentados, 22 filas en tabla comparativa.
  - `docs/KAIROX_Gestion_Ficha_Alcance.docx` — documento generado (~28 KB, ~20-25 páginas). Secciones: Portada · Resumen Ejecutivo · Ficha Técnica · Módulos del Sistema · Roadmap · Tabla Comparativa · Diferenciadores Clave · Modelo Comercial · Estado del Desarrollo.
  - `docs/node_modules/` + `docs/package.json` — instalación local de `docx` (global npm no resuelve en este entorno).
>>>>>>> 8fa6a8b (Fix 4 bugs críticos multi-tenant + Ficha de Alcance DOCX)

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

---

## 3 grandes proyectos al final

| # | Proyecto | Por qué al final |
|---|---|---|
| 1 | **Deploy en Vercel** | ✅ Completado — https://kairox-gestion.vercel.app |
| 2 | **Membresías / Stripe o MercadoPago** | Requiere ARCA primero + modelo de precios validado |
| 3 | **Modelo de licencias (Starter/Pro/Business)** | Requiere primeros clientes |
