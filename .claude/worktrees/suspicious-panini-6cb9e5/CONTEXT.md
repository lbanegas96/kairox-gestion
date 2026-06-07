# KAIROX Gestión — Contexto de Sesión
**Última actualización:** 2026-06-07 — Sesión verificación migraciones + fix MCP Supabase
**Branch:** `master` → `origin/master` (GitHub: lbanegas96/kairox-gestion)
**Commits esta sesión:** `2c0397c` → `82fb7f1` (6 commits, sin código nuevo — sesión de infraestructura)

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
| Dashboard Ejecutivo | `DashboardSection.jsx` | ✅ 8 KPIs + 2 gráficos (accesible desde Portal Finanzas) |
| Portal Ventas | `portals/VentasPortal.jsx` | ✅ 6 KPIs + módulos |
| Portal Compras | `portals/ComprasPortal.jsx` | ✅ 5 KPIs + módulos |
| Portal Finanzas | `portals/FinanzasPortal.jsx` | ✅ 5 KPIs + posición neta CxC-CxP |
| Portal Inventario | `portals/InventarioPortal.jsx` | ✅ 5 KPIs + barra salud stock |
| Ventas (POS) | `VentasSection.jsx` + `NuevaVentaModal.jsx` | ✅ Multi-pago + check límite crédito |
| Notas de Crédito | `NotaCreditoModal.jsx` + `notaCreditoService.ts` | ✅ Devolución parcial/total + reversión stock/CC/caja |
| Historial Ventas | `HistorialVentas.jsx` | ✅ Filtros avanzados + estado_pago CC + paginación 50/pág |
| Comprobantes | `ComprobantePrintModal.jsx` | ✅ Toggle Comprobante / Remito sin precios |
| Inventario | `ProductosSection.jsx` | ✅ Soft delete + import CSV + **Análisis ABC** |
| Compras | `ComprasSection.jsx` | ✅ Funcional + asiento auto + paginación 50/pág |
| Cotizaciones | `CotizacionesSection.jsx` | ✅ Funcional + convertir a venta |
| Pedidos (OC Clientes) | `PedidosSection.jsx` | ✅ Workflow borrador→confirmado→en_preparacion→facturado |
| Órdenes de Compra | `OrdenesCompraSection.jsx` | ✅ Workflow aprobación + 3-way match + realtime |
| Caja | `CajaSection.jsx` + `CajaCierre.jsx` | ✅ Arqueo por denominaciones + tab Arqueos |
| Clientes | `ClientesSection.jsx` | ✅ Form completo + condicion_pago + limite_credito + import CSV |
| Cuenta Corriente | `CuentaCorrienteSection.jsx` | ✅ Tab Antigüedad de Deuda (FIFO 30/60/90/+90 días) |
| Detalle Cta. Cte. | `ClientDetailModal.jsx` | ✅ Open Item Management SAP-style |
| Contabilidad | `PlanCuentasSection.jsx` | ✅ 7 tabs: Plan/Asientos/Balance/LM/P&L/BalanceGeneral/Períodos |
| Proveedores | `ProveedoresSection.jsx` + `proveedoresService.ts` | ✅ Ficha completa + Cta. Cte. + Historial OC + Pago inline |
| Bancos | `CuentasBancariasSection.jsx` | ✅ Import CSV + conciliación auto/manual |
| Reportes | `ReportesSection.jsx` | ✅ 5 reportes + paginación 100/pág + **comparativa período anterior** |
| Usuarios | `UsuariosSection.jsx` | ✅ Invitación + último acceso + activar/desactivar + preset Solo Caja |
| Configuración | `ConfiguracionSection.jsx` | ✅ Logo + toggle aprobación OC + datos de ejemplo |

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

### SQL adicional ejecutado directamente

```sql
-- Fix fn_audit_trigger: to_jsonb()
-- Trigger saldo cliente automático: fn_update_cliente_saldo
-- Open Item: estado_pago en comprobantes + comprobante_id + metodo_cobro en movimientos
-- Fix v_saldo_proveedores: WITH (security_invoker = true)
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

## Estado del Análisis SAP S/4HANA — 2026-06-07

### ✅ Implementado esta sesión

| Feature | Referente SAP | Commit |
|---|---|---|
| Portales por área (Fiori Launchpad) | Fiori Shell | `d2d50fb` |
| Sidebar agrupado por área | Fiori Navigation | `d2d50fb` |
| Posición neta CxC − CxP | FI Liquidity | `d2d50fb` |
| Módulo Proveedores completo | AP Master Data | `2c0397c` |
| Notas de Crédito / Devoluciones | SD Returns | `82fb7f1` |
| Análisis ABC de inventario | MM-IM ABC | `82fb7f1` |
| Comparativa período anterior | CO Comparative | `82fb7f1` |

### ⏳ PENDIENTES — por orden de prioridad

#### 🟡 Media prioridad (siguiente sesión)

| # | Feature | Referente SAP | Esfuerzo | Notas |
|---|---|---|---|---|
| **1** | **Lista de precios por cliente** | SD Condition Types | Medio | Precio de lista / VIP / mayorista. Requiere migración BD (tabla `listas_precio`) + UI en NuevaVentaModal. Diferenciador clave vs Xubio/Colppy. |
| **2** | **Notificaciones / Inbox accionable** | SAP My Inbox | Bajo | El Header ya tiene el stub (ícono campana). Mostrar: OC pendientes de aprobación, CC vencida, stock bajo, caja sin cerrar. Sin push — polling cada 5 min con TanStack Query. |
| **3** | **Document Flow visual** | SD Document Flow | Medio | Cadena de documentos: Cotización → Pedido → Venta → NC → Cobro CC. Panel lateral en cada modal de detalle con links. |
| **4** | **Recepción parcial de OC** | MM Partial GR | Medio | Hoy es todo o nada. Recibir 50 de 100 unidades pedidas, dejar OC en estado "recibida_parcial". |

#### 🟢 Baja prioridad (post-ARCA)

| # | Feature | Referente SAP | Esfuerzo |
|---|---|---|---|
| 5 | Solicitud de Compra (previa a OC) | MM Purchase Req. | Alto |
| 6 | Presupuesto vs Real mensual | CO Budget | Alto |
| 7 | Gestión de cheques | TM Checks | Alto |
| 8 | Cierre formal de períodos contables | FI Period Close | Medio |
| 9 | Retenciones IIBB/Ganancias | FI Withholding | Medio |

#### 🔴 Bloqueante para producción

| # | Feature | Por qué | Qué se necesita |
|---|---|---|---|
| **ARCA/AFIP** | Sin esto no se puede facturar legalmente | CUIT empresa, certificado digital (.crt + .key generado en WSAA de AFIP), nro. punto de venta registrado en AFIP, entorno homologación primero. |
| **Libro IVA** | Requerido para ARCA + lo piden contadores | Se implementa junto con ARCA — Débito/Crédito Fiscal por período. |

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

### 🔵 Fase 5 — COMPLETADA ✅ (sesión 2026-06-07)
- Módulo Proveedores · Portales Fiori · Launchpad · Notas de crédito · Análisis ABC · Comparativa

### ⚪ Fase 6 — PRÓXIMA SESIÓN (detalles completos en sección "⚠️ PRÓXIMA SESIÓN")
1. **Lista de precios por cliente** — migración `021_listas_precio.sql` + UI NuevaVentaModal
2. **Notificaciones / Inbox accionable** — campana en Header + polling TanStack Query
3. **Document Flow visual** — panel lateral con cadena de documentos relacionados
4. **Recepción parcial de OC** — estado `recibida_parcial` + `cantidad_recibida` en items

### ⚫ Fase 7 — FINAL
- Deploy Vercel · ARCA/AFIP + Libro IVA · Membresías/Stripe o MercadoPago · Modelo de licencias

---

## ⚠️ PRÓXIMA SESIÓN — Leer primero

### 1. Verificar MCP Supabase (5 min)
El conector Supabase de claude.ai estaba conectado a una cuenta incorrecta (no NALUX). Se reconectó vía OAuth a la cuenta NALUX en esta sesión. Al abrir la próxima sesión, verificar que el MCP funciona correctamente ejecutando:
```
list_projects → debe aparecer wuznppxeonmhfcvnqfbf (kairox-gestion)
```
Si NO aparece: ir a claude.ai → Conectores → Supabase → desconectar y reconectar con cuenta NALUX.

### 2. Continuar con Fase 6 (en este orden)

| # | Feature | Esfuerzo | Descripción |
|---|---|---|---|
| **1** | **Lista de precios por cliente** | Medio | Tabla `listas_precio` + `lista_precio_items`. Precio de lista / VIP / mayorista. En NuevaVentaModal: al seleccionar cliente, aplicar automáticamente su lista. Requiere migración `021_listas_precio.sql`. Diferenciador clave vs Xubio/Colppy. |
| **2** | **Notificaciones / Inbox accionable** | Bajo | El Header ya tiene el ícono campana (stub). Mostrar: OC pendientes de aprobación, CC vencida (+30 días), stock bajo mínimo, caja sin cerrar hace más de 24h. Polling cada 5 min con TanStack Query. Sin push. |
| **3** | **Document Flow visual** | Medio | Panel lateral en modales de detalle. Cadena: Cotización → Pedido → Venta → NC → Cobro CC. Links navegables entre documentos relacionados. Inspirado en SAP SD Document Flow. |
| **4** | **Recepción parcial de OC** | Medio | Hoy es todo o nada. Permitir recibir X de Y unidades pedidas. OC queda en estado `recibida_parcial` hasta completar. Requiere migración (columna `cantidad_recibida` en `ordenes_compra_items`). |

---

## Historial de sesiones

### Sesión 2026-06-07 (continuación) — Infraestructura / Fix MCP

**Verificación de migraciones:**
- Confirmado que migraciones 018, 019 y 020 están aplicadas en Supabase (`wuznppxeonmhfcvnqfbf`) ✅
- Schema completo y al día hasta Fase 5

**Fix conector Supabase MCP:**
- Problema: el MCP de Supabase en claude.ai estaba autenticado con una cuenta distinta a NALUX (mostraba proyectos de org `kqtqkrbsorgtocnvnfxp`, no el proyecto `wuznppxeonmhfcvnqfbf`)
- Solución aplicada: reconexión vía OAuth en claude.ai → Conectores → Supabase
- Pendiente: verificar en próxima sesión que `list_projects` retorna el proyecto correcto
- El código y la app no se vieron afectados (el frontend se conecta directamente vía URL/anon key del .env)

### Sesión 2026-06-07 — Fase 5 completa

**Módulo Proveedores (commit `2c0397c`):**
- `ProveedoresSection.jsx` — lista con KPIs, CRUD, modal detalle con tabs CC + OC
- `proveedoresService.ts` — CRUD + saldo via v_saldo_proveedores + pago inline
- Sidebar + Dashboard + permisos + CommandPalette actualizados

**Portales por área Fiori-style (commits `d2d50fb`, `add747b`):**
- `LaunchpadSection.jsx` — home con 4 area tiles + KPIs en vivo + accesos rápidos
- `portalService.ts` — 5 funciones async, 7 queries en paralelo para launchpad
- `portals/VentasPortal.jsx` — 6 KPIs + módulos (reemplaza Dashboard genérico)
- `portals/ComprasPortal.jsx` — 5 KPIs + alerta OC pendientes
- `portals/FinanzasPortal.jsx` — posición neta CxC−CxP + estado caja
- `portals/InventarioPortal.jsx` — barra visual salud stock (verde/ámbar/rojo)
- `Sidebar.jsx` reescrito — 5 grupos con headers coloreados navegables
- `Dashboard.jsx` — 8 nuevos cases de portal + `panel_ejecutivo`

**NC/ABC/Comparativa (commit `82fb7f1`):**
- `migrations/020_notas_credito.sql` — tipo, estado_pago, comprobante_origen_id, motivo_nc ✅ APLICADA
- `notaCreditoService.ts` — reversión completa stock + CC + caja
- `NotaCreditoModal.jsx` — devolución parcial/total, aviso método pago
- `SaleDetailModal.jsx` — botón "Nota de Crédito" en footer
- `abcService.ts` — A(80%)/B(95%)/C(resto) por revenue, cruza comprobante_items PT
- `ProductosSection.jsx` — tab "Análisis ABC" con cards + tabla ranking
- `ReportesSection.jsx` — toggle comparativa + card delta % con flecha ↑↓

### Sesión 2026-06-06 (continuación 3) — Auditoría y fixes (commit `600c6da`)
- 10 bugs corregidos en 11 archivos (locale, Radix dialogs, permisos, UX)
- StaffPermissionsModal: 10 → 15 módulos
- CotizacionesSection + PedidosSection: AlertDialog de confirmación antes de eliminar

### Sesión 2026-06-06 (continuación 2) — Fase 4 completa (commit `bcd8d63`)
- DashboardSection: Top 5 vendidos + último mov banco + OnboardingBanner
- ConfiguracionSection: sección "Datos de Ejemplo" (8 productos + 3 clientes)

### Sesión 2026-06-06 (continuación) — Fase 3: Pedidos (commit `fcdad78`)
- PedidosSection: workflow estados + "Convertir a Venta"
- migration 019_pedidos.sql, pedidosService.ts

### Sesión 2026-06-06 — Fases 2 y 3 (commit `a0d8c99`)
- Multi-pago, aging CC, remito sin precios, arqueo caja
- Import CSV, límite crédito, condición pago, solo-caja

### Sesión 2026-06-05 — Deuda técnica + análisis
- Migrations 013-016, soft delete productos, paginación, Edge functions, SMTP

### Sesión 2026-06-04 — Setup + Open Item Management
- Open Item CC SAP-style, trigger saldo cliente, bugfixes

---

## 3 grandes proyectos al final

| # | Proyecto | Por qué al final |
|---|---|---|
| 1 | **Deploy en Vercel** | Requiere dominio propio + variables de entorno de producción |
| 2 | **Membresías / Stripe o MercadoPago** | Requiere ARCA primero + modelo de precios validado |
| 3 | **Modelo de licencias (Starter/Pro/Business)** | Requiere primeros clientes |
