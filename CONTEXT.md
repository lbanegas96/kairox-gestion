# KAIROX Gestión — Contexto de Sesión
**Última actualización:** 2026-06-07 — Fase 2 completa + Fase 3 completa
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
| Dashboard | `DashboardSection.jsx` | ✅ 8 KPIs + 2 gráficos + KPIs cotizaciones + **alertas CC vencidas** |
| Ventas (POS) | `VentasSection.jsx` + `NuevaVentaModal.jsx` | ✅ **Multi-pago** + asiento auto + multi-moneda + chequeo límite CC |
| Historial Ventas | `HistorialVentas.jsx` | ✅ Filtros avanzados + estado_pago CC + paginación 50/pág |
| Inventario | `ProductosSection.jsx` | ✅ Soft delete SAP-style + **Import CSV** |
| Compras | `ComprasSection.jsx` | ✅ Funcional + asiento auto + paginación 50/pág |
| Cotizaciones | `CotizacionesSection.jsx` | ✅ Funcional + convertir a venta |
| **Pedidos** | `PedidosSection.jsx` | ✅ **NUEVO** Workflow Borrador→Confirmado→En Prep.→Facturado |
| Órdenes de Compra (proveedores) | `OrdenesCompraSection.jsx` | ✅ Workflow aprobación + 3-way match + realtime |
| Caja | `CajaSection.jsx` + `CajaContext.jsx` | ✅ Por-terminal + indicadores turno + **fix arqueo** |
| Clientes | `ClientesSection.jsx` | ✅ **Límite crédito + Condiciones pago + Import CSV** |
| Cuenta Corriente | `CuentaCorrienteSection.jsx` | ✅ Solo activos + **Aging report 30/60/90/+90 días** |
| Detalle Cta. Cte. | `ClientDetailModal.jsx` | ✅ **Open Item Management SAP-style** |
| Contabilidad | `PlanCuentasSection.jsx` | ✅ 7 tabs: Plan/Asientos/Balance/LM/P&L/BalanceGeneral/Períodos |
| Proveedores | `ProveedoresSection.jsx` | ✅ Ficha completa + Cta. Cte. + Historial OC |
| Bancos | `CuentasBancariasSection.jsx` | ✅ Import CSV + conciliación auto/manual |
| Reportes | `ReportesSection.jsx` | ✅ Funcional + paginación 100/pág |
| Usuarios | `UsuariosSection.jsx` | ✅ Invitación + último acceso + **presets Solo Caja / Vendedor** |
| Configuración | `ConfiguracionSection.jsx` | ✅ Logo + toggle aprobación OC |
| **Comprobante Print** | `ComprobantePrintModal.jsx` | ✅ **Multi-pago display + botón Remito sin precios** |
| **Import CSV** | `CSVImportModal.jsx` | ✅ **NUEVO** Reutilizable para productos y clientes |

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
| `migrations/017_pedidos_condiciones.sql` | Tablas pedidos + pedido_items + columnas CC en clientes | ⚠️ **PENDIENTE aplicar en Supabase** |

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
- **Roles:** `admin` (acceso total) | `staff` (permisos granulares en `profiles.permissions` JSONB)

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

---

## Análisis diferencial de mercado (Junio 2025)

> Basado en estudio de mercado Argentina PyME. Competidores: Xubio, Colppy, Tango.

### Estado actual vs. lo que necesita el mercado

| Feature | Competidores | Estado KAIROX |
|---|---|---|
| **ARCA/AFIP facturación electrónica** | Xubio ✓, Colppy ✓ | 🔴 **No implementado — CRÍTICO** |
| POS táctil nativo | Colppy ✗, Xubio ✗ | ✅ Funcional |
| Caja con apertura/cierre | Colppy ✗, Xubio ✗ | ✅ Funcional (falta discrepancia arqueo) |
| Open Item CC | Ambos básico | ✅ SAP-style completo |
| Aging report (antigüedad deuda) | Ambos ✗ | ❌ Pendiente |
| Alertas vencimiento CC | Ambos ✗ | ❌ Pendiente |
| Límite de crédito por cliente | Ambos ✗ | ❌ Pendiente |
| Multi-pago en una venta | Ambos ✗ | ❌ Pendiente |
| Permisos granulares | Ambos limitado | ✅ Admin/Staff + JSONB permissions |
| Audit log por usuario | Ambos básico | ✅ Completo (migration 016) |
| Import CSV productos/clientes | Regular | ❌ Pendiente |
| OC de clientes (pedidos) | Colppy parcial | ❌ Pendiente (hay cotizaciones, son distintas) |
| Remito de transporte sin precios | Ambos ✗ | ❌ Pendiente |
| Condiciones de venta flexibles | Ambos fijos | ❌ Pendiente |
| Dashboard ejecutivo completo | Colppy mejorado 2025 | ⚠️ Parcial (falta top productos, CC vencidas, stock mínimo) |
| Onboarding self-service <30min | Regular | ⚠️ Parcial (falta wizard + import) |
| Multi-moneda | Variable | ✅ Completo |
| Conciliación bancaria | Variable | ✅ Completo |

---

## Roadmap próxima sesión — ordenado por impacto

### 🔴 Fase 1 — Piso mínimo para vender (sin esto no hay producto)
1. **Integración ARCA/AFIP** — Emisión comprobantes A/B/C, WS WSFE, CAE automático, QR en impresión, puntos de venta registrados por empresa

### 🟠 Fase 2 — Gaps rápidos (días de trabajo, alto impacto) ✅ COMPLETADA
2. ✅ **Multi-pago en una venta** — Efectivo + Transferencia + Tarjeta en un mismo comprobante (`NuevaVentaModal.jsx`)
3. ✅ **Remito de transporte sin precios** — Botón "Remito" en print modal oculta precios (`ComprobantePrintModal.jsx`)
4. ✅ **Aging report CC** — Tab "Antigüedad" con bandas 0-30/31-60/61-90/+90 días (`CuentaCorrienteSection.jsx`)
5. ✅ **Alertas vencimiento CC** — Banner en dashboard con clientes +30 días vencidos (`DashboardSection.jsx` + `dashboardService.ts`)
6. ✅ **Discrepancia en cierre de caja** — Fix bug `user_id` + UI mejorada arqueo (`CajaCierre.jsx`)

### 🟡 Fase 3 — Diferenciales vs. Colppy ✅ COMPLETADA
7.  ✅ **Import CSV productos/clientes** — `CSVImportModal.jsx`: 4 pasos (upload→mapeo→preview→resultado), auto-mapping, batch de 50
8.  ✅ **Pedidos de clientes** — `PedidosSection.jsx`: workflow Borrador→Confirmado→En Prep.→Facturado, modal edición, KPIs estado
9.  ✅ **Condiciones de venta flexibles** — `condiciones_pago` + `dias_credito` en clientes, visible en NuevaVentaModal al seleccionar CC
10. ✅ **Límite de crédito por cliente** — `limite_credito` + `bloquear_en_limite`, chequeo en NuevaVentaModal con bloqueo configurable
11. ✅ **Usuario "solo caja"** — Presets en `StaffPermissionsModal`: Solo Caja / Vendedor / Acceso completo

⚠️ **Requiere aplicar en Supabase:** `migrations/017_pedidos_condiciones.sql`
- Agrega columnas `condiciones_pago`, `dias_credito`, `bloquear_en_limite` a clientes
- Crea tablas `pedidos` y `pedido_items` con RLS + audit trigger

### 🟢 Fase 4 — Retención y experiencia
12. **Dashboard ejecutivo completo** — Top 5 productos, facturas CC vencidas, stock en mínimo, último mov. banco (todos clickeables)
13. **Onboarding wizard completo** — Empresa → ARCA → Productos → Primera venta, con checklist de progreso
14. **Datos de ejemplo precargados** — Para explorar el sistema antes de configurarlo

---

## 3 grandes proyectos reservados para el final

> Estos se encaran después de completar las Fases 1-4. Son proyectos de negocio, no de features.

| # | Proyecto | Por qué al final |
|---|---|---|
| 1 | **Deploy en Vercel** | Requiere dominio propio + variables de entorno de producción configuradas |
| 2 | **Membership / Stripe o MercadoPago** | Requiere modelo de precios definido + ARCA funcionando primero |
| 3 | **Modelo de licencias (Starter/Pro/Business)** | Requiere validación con primeros clientes reales |

---

## Historial de sesiones

### Sesión 2026-06-07 — Fase 2 + Fase 3 completas
- ✅ Fase 2: multi-pago, remito sin precios, fix arqueo caja, alertas CC, aging report
- ✅ Fase 3: Import CSV (productos + clientes), Pedidos workflow, Límite crédito+bloqueo, Condiciones pago, Presets usuario solo-caja
- ⚠️ Pendiente aplicar: `migrations/017_pedidos_condiciones.sql` en Supabase
- Archivos nuevos: `CSVImportModal.jsx`, `PedidosSection.jsx`, `migrations/017_pedidos_condiciones.sql`
- Módulos actualizados: Dashboard.jsx, Sidebar.jsx, ClientesSection.jsx, ProductosSection.jsx, NuevaVentaModal.jsx, StaffPermissionsModal.jsx, useUserPermissions.js

### Sesión 2026-06-07 — Fase 2 completa
- ✅ Multi-pago en venta: Set de métodos activos + montos por método, 1 movimiento_caja por método
- ✅ Remito sin precios: botón "Remito" en ComprobantePrintModal oculta columnas precio/subtotal vía CSS print
- ✅ Aging report CC: tab "Antigüedad" en CuentaCorrienteSection, bandas 0-30/31-60/61-90/+90 días
- ✅ Alertas CC en dashboard: banner contextual con clientes +30 días vencidos y total vencido
- ✅ Fix bug CajaCierre: filtro `.eq('empresa_id')` en lugar de `.eq('user_id', user.tenant_id)` (causaba arqueo vacío)
- ✅ UI discrepancia caja mejorada: etiquetas "Sobrante/Faltante/Cuadra" + mensaje explicativo

### Sesión 2026-06-05 — Deuda técnica + Análisis de mercado
- ✅ Migrations 013-016 ejecutadas en Supabase
- ✅ Soft delete SAP-style en productos (toggle inactivos + reactivar)
- ✅ Paginación en HistorialVentas, ComprasSection, ReportesSection
- ✅ Edge functions deployadas con hardening (npx supabase functions deploy)
- ✅ SMTP Resend.com verificado y funcionando
- ✅ Fix alerta security_definer en v_saldo_proveedores (security_invoker = true)
- ✅ Análisis diferencial de mercado incorporado al roadmap

### Sesión 2026-06-04 — Setup + Bugfixes + Open Item Management
- ✅ Open Item Management SAP-style en ClientDetailModal
- ✅ Trigger fn_update_cliente_saldo + recalculo saldos
- ✅ Múltiples bugfixes (fn_audit_trigger, Chrome Translate, HistorialVentas, RLS 403)
