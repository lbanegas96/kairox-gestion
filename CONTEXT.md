# KAIROX Gestión — Contexto de Sesión
**Última actualización:** 2026-06-11 (noche) — Testeo funcional completo de toda la app + fixes críticos: FK tenant_id (comprobantes, caja_sesiones, movimientos_inventario) → empresas; auth context tenant_id = empresa_id; hora Argentina en 17 archivos; columnas faltantes en compras (moneda, tipo_cambio_tasa); query comprobantes.created_at → fecha en ChequesSection; NuevaVentaModal carga rápida de productos (race condition); DialogDescription en modales de Contabilidad; logo Kairox real en sidebar (más discreto)
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
| Contabilidad | `PlanCuentasSection.jsx` | ✅ 5 tabs: Plan/Asientos/Balance/LibroMayor/**Períodos** — ⏳ P&L y Balance General en roadmap |
| Proveedores | `ProveedoresSection.jsx` + `proveedoresService.ts` | ✅ Ficha completa + Cta. Cte. + Historial OC + Pago inline |
| Bancos | `CuentasBancariasSection.jsx` | ✅ Import CSV + conciliación auto/manual |
| **Cheques** | `ChequesSection.jsx` | ✅ **NUEVO** Cartera de terceros + propios + KPIs + historial de estados + notif vencimientos 7 días |
| **Onboarding Wizard** | `OnboardingWizard.jsx` + `ChecklistOnboarding.jsx` | ✅ **NUEVO** Wizard modal de bienvenida + checklist configuración inicial (se abre si `onboarding_completado = false`) |
| Reportes | `ReportesSection.jsx` | ✅ 5 reportes + Reporte de Paridad ARS/USD + paginación 100/pág |
| **Tipo de Cambio** | `TipoCambioModal.jsx` + `tipoCambioService.js` | ✅ **NUEVO** TC diario centralizado + upsert por empresa/moneda/fecha |
| **Reporte de Paridad** | `reportes/ReporteParidad.jsx` | ✅ **NUEVO** Comparativa ARS/USD por comprobante + CSV export |
| Usuarios | `UsuariosSection.jsx` | ✅ Invitación + último acceso + activar/desactivar + preset Solo Caja |
| Configuración | `ConfiguracionSection.jsx` | ✅ Logo + toggle OC + datos de ejemplo + **Moneda Paralela SAP-style** + **Wizard AFIP/ARCA** |

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
| **`migrations/025_afip_infraestructura.sql`** | AFIP Fase 1: columnas fiscales en `empresas` + `clientes.condicion_iva` + tabla `puntos_venta` (RLS) + columnas CAE en `comprobantes` + wrappers Vault `vault_secret_upsert`/`vault_secret_read` (SECURITY DEFINER, solo service_role) | ✅ Aplicada via MCP |
| **`migrations/026_onboarding.sql`** | Columna `onboarding_completado` en `empresas` + lógica de wizard de bienvenida | ✅ Aplicada |
| **`migrations/027_cierre_periodos.sql`** | Tabla `periodos_contables` (admin create/close) + RPC `fecha_en_periodo_cerrado(empresa_id, fecha DATE) RETURNS BOOLEAN` SECURITY DEFINER STABLE | ✅ Aplicada via MCP |
| **`migrations/028_cheques.sql`** | Tablas `cheques` + `cheques_historial` + RLS por `get_my_empresa_id()` + 3 índices (tipo, estado, vencimiento parcial) | ✅ Aplicada via MCP |
| **`migrations/029_fix_tenant_id_fkeys.sql`** | Fix FK: `comprobantes.tenant_id`, `caja_sesiones.tenant_id`, `movimientos_inventario.tenant_id` apuntaban a `profiles(id)` — ahora apuntan a `empresas(id)`. DROP constraints → UPDATE data → ADD constraints | ✅ Aplicada via MCP |
| **`030_compras_add_moneda`** (MCP) | `ALTER TABLE compras ADD COLUMN moneda text NOT NULL DEFAULT 'ARS'` + NOTIFY pgrst | ✅ Aplicada via MCP |
| **`031_compras_add_tipo_cambio_tasa`** (MCP) | `ALTER TABLE compras ADD COLUMN tipo_cambio_tasa numeric NOT NULL DEFAULT 1` + NOTIFY pgrst | ✅ Aplicada via MCP |

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
- **Edge Functions deployadas:** `create-user` · `delete-user` · `invite-user` · `generar-csr` · `emitir-cae` ✅
- **Supabase Vault:** extensión `supabase_vault` 0.3.1 activa. Secretos AFIP por empresa: `afip_key_<empresa_id>` (clave privada, generada en `generar-csr` acción `generate`) y `afip_cert_<empresa_id>` (certificado .crt, subido vía `generar-csr` acción `store_cert`). Acceso solo vía RPC `vault_secret_upsert`/`vault_secret_read` (service_role).
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
5. ✅ **ARCA/AFIP** + Libro IVA — **Fases 1-5 COMPLETAS**: infra DB (migration 025) + Edge Functions `generar-csr`/`emitir-cae` + Wizard de activación UI (ConfiguracionSection) + integración CAE en flujo post-venta (Fase 3) + PDF con QR fiscal RG 4291/2018 (Fase 4) + Libro IVA Ventas digital (Fase 5).
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
| 7 | **Gestión de cheques** | TM Checks | ✅ Sesión 10-jun-2026 |
| 8 | **Cierre formal de períodos contables** | FI Period Close | ✅ Sesión 10-jun-2026 |

### 🟢 Baja prioridad (post-ARCA)

| # | Feature | Referente SAP |
|---|---|---|
| 5 | Solicitud de Compra | MM Purchase Req. |
| 6 | Presupuesto vs Real mensual | CO Budget |
| 9 | Retenciones IIBB/Ganancias | FI Withholding |

---

## Historial de sesiones

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
- ⏳ Reintento masivo CAEs pendientes — `afipService.reintentarCAEsPendientes()` implementado pero sin UI.

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
- ⏳ **Implementar P&L / Balance General / Períodos** en Contabilidad (feature, no bug).
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
- `generarCSR(cuit, razonSocial)`, `emitirCAE(comprobante_id)`, `reintentarCAEsPendientes(empresa_id)` (procesa pendiente|error, rate-limit 500ms).

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
