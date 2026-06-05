# KAIROX Gestión — Contexto de Sesión
**Última actualización:** 2026-06-05 — Deuda técnica cerrada + Análisis diferencial de mercado
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
| Dashboard | `DashboardSection.jsx` | ✅ 8 KPIs + 2 gráficos + KPIs cotizaciones |
| Ventas (POS) | `VentasSection.jsx` + `NuevaVentaModal.jsx` | ✅ Funcional + asiento auto + multi-moneda |
| Historial Ventas | `HistorialVentas.jsx` | ✅ Filtros avanzados + estado_pago CC + paginación 50/pág |
| Inventario | `ProductosSection.jsx` | ✅ Soft delete SAP-style (inactivar + reactivar) |
| Compras | `ComprasSection.jsx` | ✅ Funcional + asiento auto + paginación 50/pág |
| Cotizaciones | `CotizacionesSection.jsx` | ✅ Funcional + convertir a venta |
| Órdenes de Compra (proveedores) | `OrdenesCompraSection.jsx` | ✅ Workflow aprobación + 3-way match + realtime |
| Caja | `CajaSection.jsx` + `CajaContext.jsx` | ✅ Por-terminal + indicadores turno |
| Clientes | `ClientesSection.jsx` | ✅ Soft delete + validación |
| Cuenta Corriente | `CuentaCorrienteSection.jsx` | ✅ Solo activos |
| Detalle Cta. Cte. | `ClientDetailModal.jsx` | ✅ **Open Item Management SAP-style** |
| Contabilidad | `PlanCuentasSection.jsx` | ✅ 7 tabs: Plan/Asientos/Balance/LM/P&L/BalanceGeneral/Períodos |
| Proveedores | `ProveedoresSection.jsx` | ✅ Ficha completa + Cta. Cte. + Historial OC |
| Bancos | `CuentasBancariasSection.jsx` | ✅ Import CSV + conciliación auto/manual |
| Reportes | `ReportesSection.jsx` | ✅ Funcional + paginación 100/pág |
| Usuarios | `UsuariosSection.jsx` | ✅ Invitación + último acceso + activar/desactivar |
| Configuración | `ConfiguracionSection.jsx` | ✅ Logo + toggle aprobación OC |

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

### 🟠 Fase 2 — Gaps rápidos (días de trabajo, alto impacto)
2. **Multi-pago en una venta** — Efectivo + Transferencia + Tarjeta en un mismo comprobante
3. **Remito de transporte sin precios** — Toggle en config del comprobante imprimible
4. **Aging report CC** — Antigüedad de deuda por cliente (30/60/90/+90 días)
5. **Alertas vencimiento CC** — Facturas próximas a vencer y vencidas en dashboard
6. **Discrepancia en cierre de caja** — Efectivo declarado vs. real con registro de diferencia

### 🟡 Fase 3 — Diferenciales vs. Colppy
7. **Import CSV productos/clientes** — Mapeo visual de columnas, validación, preview
8. **OC de clientes (Pedidos)** — Borrador → Confirmado → En preparación → Facturado. Distinto a cotizaciones.
9. **Condiciones de venta flexibles** — Texto libre + días, guardables por cliente, reflejo en vencimiento
10. **Límite de crédito por cliente** — Con bloqueo configurable al superar el límite
11. **Usuario "solo caja"** — POS sin acceso a reportes ni configuración

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
