# KAIROX Gestión — Contexto de Sesión
**Última actualización:** 2026-06-09 (PM·4) — RPC transaccional `crear_venta` (venta atómica con rollback, migration 024); moneda paralela + fix parseFloat/caja en CuentaCorrienteSection; (PM·3) Aging Open Item por comprobante; deploy Edge Functions CORS; fix timezone/timestamp
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
| **`migrations/022_rpc_decrement_stock.sql`** | RPC `decrement_stock(p_producto_id, p_cantidad)` — UPDATE atómico con check stock ≥ 0, SECURITY DEFINER | ✅ Aplicada via MCP |
| **`migrations/023_indices_faltantes.sql`** | 4 índices: `idx_comprobantes_estado_pago`, `idx_comprobantes_fecha`, `idx_cta_cte_empresa_cliente_tipo`, `idx_mov_inv_fecha` | ✅ Aplicada via MCP |
| **`migrations/024_rpc_crear_venta.sql`** | RPC `crear_venta` — venta transaccional atómica (comprobante + items + stock FOR UPDATE + mov_inventario + mov_caja + CC) con rollback automático, SECURITY DEFINER | ✅ Aplicada via MCP |

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
- ✅ ~~Investigar error 400 en consola~~ — **RESUELTO** sesión PM·3: auditados todos los usos de `toISOString()` contra columnas DATE; fixes en `useNotifications.js` (getNowAR), `ReporteParidad.jsx` (AR-local-as-UTC), `tipoCambioService.ts` (import + getTodayAR)
- **Tests manuales pendientes:**
  - POS: hacer venta y verificar stock decrementa correctamente (RPC 022)
  - CC cobro Transferencia con caja cerrada → debe aprobar
  - CC cobro Efectivo con caja cerrada → debe bloquear
  - Aging: cliente con deuda vieja pagada + deuda nueva → banda correcta
  - Carrito POS: ingresar cantidad mayor al stock → toast de advertencia
  - OC en USD sin TC → botón deshabilitado + mensaje ⚠
- **Deploy a producción** — todos los fixes comiteados y pusheados a master; pendiente deploy Vercel

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
- ⚠️ **Tabs Contabilidad faltantes**: CONTEXT decía 7 tabs (Plan, Asientos, Balance, LibroMayor, P&L, BalanceGeneral, Períodos) pero solo hay 4. P&L, Balance General y Períodos NUNCA se implementaron. Actualizar feature list o implementar.
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
