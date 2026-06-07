# KAIROX Gestión — Contexto de Sesión
**Última actualización:** 2026-06-06 — Fases 2 y 3 completadas
**Branch activo:** `master`
**Entregables de auditoría:** `AUDITORIA.md` · `SUPABASE_ANALISIS.md` · `STATUS_REPORT.md` · `SUPABASE_SETUP.md`

---

## ¿Qué es este proyecto?

**KAIROX Gestión** es un ERP/POS SaaS para PyMEs comerciales argentinas (ferreterías, distribuidoras, mayoristas, almacenes). Posicionamiento: **conceptos ERP enterprise a precio y simplicidad PyME**.

- **Mercado objetivo:** ~520K PyMEs registradas en Argentina. Segmento inicial: micro (1–3 empleados). Monetización real: Pro (comercios con stock, compras y CC).
- **Competidores:** Xubio (50K+ clientes), Colppy (foco contable, sin POS), Tango (enterprise desde $528K/mes).
- **Stack:** React 18 + Vite + TailwindCSS + Shadcn/UI · Supabase (PostgreSQL + Auth + RLS + Edge Functions) · Context API · TanStack Query v5 · JS (JSX) + TS coexistiendo

---

## Módulos disponibles

| Módulo | Archivo principal | Estado |
|---|---|---|
| Dashboard | `DashboardSection.jsx` | ✅ 8 KPIs + 2 gráficos + alerta aging CC + Top 5 vendidos + último banco + OnboardingBanner |
| Ventas (POS) | `VentasSection.jsx` + `NuevaVentaModal.jsx` | ✅ Multi-pago + check límite crédito + condición pago |
| Historial Ventas | `HistorialVentas.jsx` | ✅ Filtros avanzados + estado_pago CC + paginación 50/pág |
| Comprobantes | `ComprobantePrintModal.jsx` | ✅ Toggle Comprobante / Remito sin precios |
| Inventario | `ProductosSection.jsx` | ✅ Soft delete + import CSV |
| Compras | `ComprasSection.jsx` | ✅ Funcional + asiento auto + paginación 50/pág |
| Cotizaciones | `CotizacionesSection.jsx` | ✅ Funcional + convertir a venta |
| Pedidos (OC Clientes) | `PedidosSection.jsx` | ✅ Workflow borrador→confirmado→en_preparacion→facturado + Convertir a Venta |
| Órdenes de Compra (proveedores) | `OrdenesCompraSection.jsx` | ✅ Workflow aprobación + 3-way match + realtime |
| Caja | `CajaSection.jsx` + `CajaCierre.jsx` | ✅ Arqueo por denominaciones + tab Arqueos + Sobrante/Faltante |
| Clientes | `ClientesSection.jsx` | ✅ Form completo + condicion_pago + limite_credito + import CSV |
| Cuenta Corriente | `CuentaCorrienteSection.jsx` | ✅ Tab Antigüedad de Deuda (FIFO 30/60/90/+90 días) |
| Detalle Cta. Cte. | `ClientDetailModal.jsx` | ✅ Open Item Management SAP-style |
| Contabilidad | `PlanCuentasSection.jsx` | ✅ 7 tabs: Plan/Asientos/Balance/LM/P&L/BalanceGeneral/Períodos |
| Proveedores | `ProveedoresSection.jsx` | ✅ Ficha completa + Cta. Cte. + Historial OC |
| Bancos | `CuentasBancariasSection.jsx` | ✅ Import CSV + conciliación auto/manual |
| Reportes | `ReportesSection.jsx` | ✅ Funcional + paginación 100/pág |
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
| `migrations/017_multi_pago.sql` | Tabla comprobante_pagos + RLS + índices | ✅ aplicada |
| `migrations/018_condicion_pago.sql` | condicion_pago + dias_credito en clientes | ✅ aplicada |
| `migrations/019_pedidos.sql` | pedidos + pedido_items + RLS + audit trigger | ✅ aplicada |

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

---

## Análisis diferencial de mercado (Junio 2026)

> Basado en estudio de mercado Argentina PyME. Competidores: Xubio, Colppy, Tango.

| Feature | Competidores | Estado KAIROX |
|---|---|---|
| **ARCA/AFIP facturación electrónica** | Xubio ✓, Colppy ✓ | 🔴 **No implementado — CRÍTICO** |
| POS táctil nativo | Colppy ✗, Xubio ✗ | ✅ Funcional |
| Caja con apertura/cierre + arqueo | Colppy ✗, Xubio ✗ | ✅ Completo (arqueo por denominaciones) |
| Open Item CC | Ambos básico | ✅ SAP-style completo |
| Aging report (antigüedad deuda) | Ambos ✗ | ✅ FIFO 30/60/90/+90 días |
| Alertas vencimiento CC | Ambos ✗ | ✅ Banner en Dashboard |
| Límite de crédito por cliente | Ambos ✗ | ✅ Con bloqueo en venta |
| Multi-pago en una venta | Ambos ✗ | ✅ Efectivo + Transferencia + Tarjeta + CC |
| Remito sin precios | Ambos ✗ | ✅ Toggle en comprobante imprimible |
| Condiciones de venta flexibles | Ambos fijos | ✅ condicion_pago + dias_credito por cliente |
| Import CSV productos/clientes | Regular | ✅ Drag-drop, mapeo visual, preview |
| Permisos granulares + Solo Caja | Ambos limitado | ✅ Admin/Staff/SoloCaja + JSONB |
| Audit log por usuario | Ambos básico | ✅ Completo (migration 016) |
| OC de clientes (pedidos) | Colppy parcial | ⏳ Pendiente (hay cotizaciones, son distintas) |
| Dashboard ejecutivo completo | Colppy mejorado 2025 | ⚠️ Parcial (falta top productos clickeables) |
| Onboarding self-service <30min | Regular | ⚠️ Parcial (falta wizard) |
| Multi-moneda | Variable | ✅ Completo |
| Conciliación bancaria | Variable | ✅ Completo |

---

## Roadmap — estado actualizado

### 🔴 Fase 1 — Piso mínimo para vender (bloqueante)
1. **Integración ARCA/AFIP** — Emisión comprobantes A/B/C, WS WSFE, CAE automático, QR en impresión, puntos de venta registrados por empresa

### 🟠 Fase 2 — COMPLETADA ✅
2. ~~Multi-pago en una venta~~ ✅
3. ~~Remito de transporte sin precios~~ ✅
4. ~~Aging report CC~~ ✅
5. ~~Alertas vencimiento CC~~ ✅
6. ~~Discrepancia en cierre de caja~~ ✅

### 🟡 Fase 3 — COMPLETADA ✅
7. ~~Import CSV productos/clientes~~ ✅
8. ~~OC de clientes (Pedidos)~~ ✅ — Borrador → Confirmado → En preparación → Facturado
9. ~~Condiciones de venta flexibles~~ ✅
10. ~~Límite de crédito por cliente~~ ✅
11. ~~Usuario "solo caja"~~ ✅

### 🟢 Fase 4 — COMPLETADA ✅
12. ~~Dashboard ejecutivo completo~~ ✅ — Top 5 vendidos, último mov banco, OnboardingBanner
13. ~~Onboarding wizard~~ ✅ — Banner con checklist 3 pasos + dismiss persistente
14. ~~Datos de ejemplo precargados~~ ✅ — 8 productos + 3 clientes desde Configuración

---

## 3 grandes proyectos reservados para el final

| # | Proyecto | Por qué al final |
|---|---|---|
| 1 | **Deploy en Vercel** | Requiere dominio propio + variables de entorno de producción |
| 2 | **Membership / Stripe o MercadoPago** | Requiere modelo de precios + ARCA primero |
| 3 | **Modelo de licencias (Starter/Pro/Business)** | Requiere validación con primeros clientes |

---

## Próxima sesión — por dónde seguir

1. **Fase 1 ARCA/AFIP** — único bloqueante restante para poder vender
2. **Deploy Vercel** — requiere dominio + env vars producción
3. **Membership / Stripe o MercadoPago** — requiere ARCA primero

---

## Historial de sesiones

### Sesión 2026-06-06 (continuación 2) — Fase 4 completa

- ✅ `dashboardService.ts` — `dashboardExtrasService`: `getTopProductosVendidos`, `getUltimoMovBancario`, `checkOnboardingStatus`
- ✅ `DashboardSection.jsx` — nueva fila Top 5 Vendidos + Último mov banco + OnboardingBanner integrado
- ✅ `OnboardingBanner.jsx` — checklist 3 pasos (empresa/productos/ventas) + dismiss en localStorage + ARCA como pendiente
- ✅ `ConfiguracionSection.jsx` — sección "Datos de Ejemplo" con carga de 8 productos + 3 clientes
- ✅ `demoDataService.ts` — inserta datos de ferretería con idempotencia (no sobreescribe si ya hay datos)

### Sesión 2026-06-06 (continuación) — Fase 3 completa: Pedidos

- ✅ `migrations/019_pedidos.sql` — tablas `pedidos` + `pedido_items`, RLS, audit trigger, función `next_pedido_number` — **⏳ PENDIENTE aplicar**
- ✅ `pedidosService.ts` — CRUD + `markAsFacturado`
- ✅ `PedidosSection.jsx` — workflow estados + "Convertir a Venta" via NuevaVentaModal preloaded
- ✅ `NuevaVentaModal` — props `initialPedido` + `onPedidoConverted` para precargar carrito desde pedido
- ✅ `Sidebar` — ítem "Pedidos" entre Cotizaciones y Compras
- ✅ `useUserPermissions` — `pedidos` agregado a ALL_SECTIONS

### Sesión 2026-06-06 — Fases 2 y 3

**Fase 2 completada:**
- ✅ `migrations/017_multi_pago.sql` — tabla `comprobante_pagos` (RLS, índices) — **aplicada en Supabase**
- ✅ `NuevaVentaModal` — multi-pago: botones rápidos + entrada manual + saldo pendiente + cambio
- ✅ `ComprobantePrintModal` — desglose de pagos + toggle Remito sin precios (firma, sin precios/total)
- ✅ `SaleDetailModal` — carga breakdown de `comprobante_pagos`
- ✅ `dashboardAgingService` — algoritmo FIFO para aging 30/60/90/+90 días
- ✅ `DashboardSection` — banner ámbar de deuda vencida clickeable → CuentaCorriente
- ✅ `CuentaCorrienteSection` — tab "Antigüedad de Deuda" con tabla por cliente y totales
- ✅ `CajaCierre` — arqueo por denominaciones ($1000→$10) + labels Sobrante/Faltante/Exacto
- ✅ `CajaSection` — tab "Arqueos" con historial de sesiones (diferencia coloreada)

**Fase 3 completada (excepto Pedidos):**
- ✅ `migrations/018_condicion_pago.sql` — `condicion_pago` + `dias_credito` en clientes — **aplicada en Supabase**
- ✅ `ClientesSection` — reescritura completa: form add/edit con todos los campos + botón Import CSV
- ✅ `NuevaVentaModal` — check límite crédito + display condición/crédito usado al seleccionar cliente CC
- ✅ `useUserPermissions` — `isSoloCaja()` + `getAccessibleSections()` con manejo de `solo_caja: true`
- ✅ `StaffPermissionsModal` — presets: 🏪 Solo Caja / ✓ Todos / ✗ Ninguno
- ✅ `Sidebar` — filtra items por `userPermissions` (staff y solo_caja ven solo sus secciones)
- ✅ `ImportCSVModal` — componente reutilizable: drag-drop, auto-mapeo, preview, validación, batch insert ×50. Configurado para productos y clientes.
- ✅ `ProductosSection` — botón "Importar CSV" integrado

### Sesión 2026-06-05 — Deuda técnica + Análisis de mercado
- ✅ Migrations 013-016 ejecutadas en Supabase
- ✅ Soft delete SAP-style en productos (toggle inactivos + reactivar)
- ✅ Paginación en HistorialVentas, ComprasSection, ReportesSection
- ✅ Edge functions deployadas con hardening
- ✅ SMTP Resend.com verificado y funcionando
- ✅ Fix alerta security_definer en v_saldo_proveedores
- ✅ Análisis diferencial de mercado incorporado al roadmap

### Sesión 2026-06-04 — Setup + Bugfixes + Open Item Management
- ✅ Open Item Management SAP-style en ClientDetailModal
- ✅ Trigger fn_update_cliente_saldo + recalculo saldos
- ✅ Múltiples bugfixes (fn_audit_trigger, Chrome Translate, HistorialVentas, RLS 403)
