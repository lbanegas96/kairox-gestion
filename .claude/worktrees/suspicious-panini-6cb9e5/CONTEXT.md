# KAIROX Gestión — Contexto de Sesión
**Última actualización:** 2026-06-04 — Setup inicial + Open Item Management (SAP-style Cuenta Corriente)
**Branch activo:** `master`
**Entregables de auditoría:** `AUDITORIA.md` · `SUPABASE_ANALISIS.md` · `STATUS_REPORT.md` · `SUPABASE_SETUP.md`

---

## ¿Qué es este proyecto?

**KAIROX Gestión** es un ERP/POS SaaS para PyMEs — multi-tenant construido con:
- **Frontend:** React 18 + Vite + TailwindCSS + Shadcn/UI
- **Backend:** Supabase (PostgreSQL + Auth + RLS + Edge Functions)
- **Estado global:** Context API (Auth, Caja, Theme, Config)
- **Data fetching:** TanStack Query v5
- **Lenguaje:** JavaScript (JSX) + TypeScript coexistiendo

---

## Módulos disponibles

| Módulo | Archivo principal | Estado |
|---|---|---|
| Dashboard | `DashboardSection.jsx` | ✅ 8 KPIs + 2 gráficos + KPIs cotizaciones |
| Ventas (POS) | `VentasSection.jsx` + `NuevaVentaModal.jsx` | ✅ Funcional + asiento auto + multi-moneda |
| Historial Ventas | `HistorialVentas.jsx` | ✅ Filtros avanzados + estado_pago CC |
| Inventario | `ProductosSection.jsx` | ✅ Funcional + soft delete |
| Compras | `ComprasSection.jsx` | ✅ Funcional + asiento auto |
| Cotizaciones | `CotizacionesSection.jsx` | ✅ Funcional + convertir a venta |
| Órdenes de Compra | `OrdenesCompraSection.jsx` | ✅ Workflow aprobación + 3-way match + realtime |
| Caja | `CajaSection.jsx` + `CajaContext.jsx` | ✅ Por-terminal + indicadores turno |
| Clientes | `ClientesSection.jsx` | ✅ Soft delete + validación |
| Cuenta Corriente | `CuentaCorrienteSection.jsx` | ✅ Solo activos |
| Detalle Cta. Cte. | `ClientDetailModal.jsx` | ✅ **Open Item Management SAP-style** |
| Contabilidad | `PlanCuentasSection.jsx` | ✅ 7 tabs: Plan/Asientos/Balance/LM/P&L/BalanceGeneral/Períodos |
| Proveedores | `ProveedoresSection.jsx` | ✅ Ficha completa + Cta. Cte. + Historial OC |
| Bancos | `CuentasBancariasSection.jsx` | ✅ Import CSV + conciliación auto/manual |
| Reportes | `ReportesSection.jsx` | ✅ Funcional |
| Usuarios | `UsuariosSection.jsx` | ✅ Invitación + último acceso + activar/desactivar |
| Configuración | `ConfiguracionSection.jsx` | ✅ Logo + toggle aprobación OC |

---

## Migraciones aplicadas en Supabase (orden de ejecución)

| Archivo | Contenido | Estado |
|---|---|---|
| `schema.sql` | Schema base completo + RLS + triggers | ✅ Ejecutado |
| `migrations/001_audit_log.sql` | Tabla audit_log + fn_audit_trigger | ✅ Ejecutado |
| `migrations/002_cotizaciones.sql` | Cotizaciones + cotizacion_items | ✅ Ejecutado |
| `migrations/003_ordenes_compra.sql` | Órdenes de compra + items | ✅ Ejecutado |
| `migrations/004_plan_cuentas.sql` | Plan cuentas + asientos + seed | ✅ Ejecutado |
| `migrations/005_configuracion_rls_fix.sql` | Fix RLS tabla configuracion | ✅ Ejecutado |
| `migrations/009_cajas.sql` | Tabla cajas + FK caja_sesiones | ✅ Ejecutado |
| `migrations/010_drop_ventas_legacy.sql` | Backup + DROP ventas legacy | ✅ Ejecutado |
| `migrations/011_cuentas_bancarias.sql` | Cuentas bancarias + movimientos | ✅ Ejecutado |
| `migrations/012_facturas_proveedor.sql` | 3-way match OC | ✅ Ejecutado |

### SQL adicional ejecutado directamente (no en archivos de migración)

```sql
-- Fix fn_audit_trigger: to_jsonb() en lugar de ::jsonb
CREATE OR REPLACE FUNCTION public.fn_audit_trigger() ...

-- Trigger saldo cliente automático
CREATE OR REPLACE FUNCTION public.fn_update_cliente_saldo() ...
DROP TRIGGER IF EXISTS trg_update_cliente_saldo ON cuenta_corriente_movimientos;
CREATE TRIGGER trg_update_cliente_saldo AFTER INSERT OR UPDATE OR DELETE ...

-- Recalcular saldos existentes
UPDATE clientes SET saldo_actual = COALESCE((SELECT SUM(...) FROM cuenta_corriente_movimientos ...), 0);

-- Open Item Management: estado_pago en comprobantes
ALTER TABLE comprobantes ADD COLUMN IF NOT EXISTS estado_pago TEXT NOT NULL DEFAULT 'pagada'
  CHECK (estado_pago IN ('pagada','pendiente','parcial','cancelada'));
UPDATE comprobantes SET estado_pago = 'pendiente' WHERE forma_pago = 'Cuenta Corriente';

-- Trazabilidad de compensación
ALTER TABLE cuenta_corriente_movimientos ADD COLUMN IF NOT EXISTS comprobante_id UUID REFERENCES comprobantes(id) ON DELETE SET NULL;
ALTER TABLE cuenta_corriente_movimientos ADD COLUMN IF NOT EXISTS metodo_cobro TEXT;
```

---

## Sesión 2026-06-04 — Setup + Bugfixes + Open Item Management

### Bugs corregidos

| Bug | Archivo | Fix |
|---|---|---|
| `fn_audit_trigger` fallaba con error 42846 al crear productos | Supabase SQL | `OLD::jsonb`/`NEW::jsonb` → `to_jsonb(OLD)`/`to_jsonb(NEW)` |
| Chrome Translate rompía React (`removeChild`) | `index.html` | `translate="no"` en `<html>` + `lang="es"` |
| Título de pestaña mostraba "Hostinger Horizons" | `index.html` | Cambiado a "KAIROX Gestión" |
| `HistorialVentas` no mostraba ventas (filtro tenant_id indefinido) | `HistorialVentas.jsx` | Eliminados `.eq('tenant_id', user.tenant_id)` y `.eq('user_id', user.tenant_id)` — RLS maneja el aislamiento |
| Ventas de Cuenta Corriente mostraban estado "Pagada" | `HistorialVentas.jsx` | `estado_pago` derivado de `forma_pago`: CC → 'pendiente', resto → 'pagada' |
| Cobro en ClientDetailModal fallaba con RLS 403 | `ClientDetailModal.jsx` | Faltaba `empresa_id: user.empresa_id` en ambos inserts. Cambiado `user.tenant_id` → `user.id` |
| Cuenta Corriente no reflejaba deuda tras ventas CC | Supabase SQL | Trigger `fn_update_cliente_saldo` + recalculo de saldos existentes |

### Feature: Open Item Management SAP-style (`ClientDetailModal.jsx`)

Rediseño completo del modal de detalle de cliente. Inspirado en SAP S/4HANA Open Item Management (compensación):

**Flujo:**
1. Modal muestra lista de **ítems abiertos** (comprobantes CC con `estado_pago IN ('pendiente','parcial')`)
2. Usuario selecciona uno o varios con checkbox
3. Monto se auto-completa con el total seleccionado (editable)
4. Elige método de cobro: Efectivo / Transferencia / Tarjeta / Cheque / Otro
5. Solo Efectivo requiere caja abierta — los demás métodos no
6. Al confirmar: aplica FIFO sobre los ítems seleccionados
   - `itemAmount >= item.total` → `estado_pago = 'pagada'`
   - `itemAmount < item.total` → `estado_pago = 'parcial'`
   - Inserta HABER en `cuenta_corriente_movimientos` con `comprobante_id` (trazabilidad)
   - Solo si Efectivo: inserta en `movimientos_caja`
7. Trigger `fn_update_cliente_saldo` actualiza `clientes.saldo_actual` automáticamente

**Tabs del modal:**
- **Ítems Abiertos**: lista de facturas pendientes + formulario de cobro
- **Historial**: ledger completo de movimientos DEBE/HABER

---

## Bugs corregidos (sesiones anteriores)

| Bug | Archivo | Fix aplicado |
|---|---|---|
| Staff bloqueado en Caja/Compras | `CajaSection.jsx`, `ComprasSection.jsx` | `user.id → user.tenant_id` |
| Logo upload fallaba | `ConfiguracionSection.jsx` | Base64 en DB |
| Closure stale en ConfigContext | `ConfigContext.jsx` | `setConfig(prev => ...)` |
| Error `removeChild` en Radix UI | `ProductosSection.jsx` | `ProductForm` movido fuera |
| Soft delete de productos | `ProductosSection.jsx` | `activo=false` |
| Timezone desfasado | `dateUtils.js` | `getNowAR()` resta 3h del epoch UTC |
| "Gastos del Mes" incluía apertura | `dashboardService.ts` | `.neq('categoria','Apertura')` |
| Indicadores de turno $0 | `CajaSection.jsx` | Tarjetas INGRESOS/EGRESOS/SALDO LÍQUIDO |
| Reset contraseña abría sistema directo | `SupabaseAuthContext.jsx`, `App.jsx` | `isRecoveryFlow` ref + hash URL |
| Rate limit emails | Supabase Auth | SMTP Resend.com configurado |
| 403 RLS en `configuracion` | `ConfigContext.jsx` | `empresa_id` en INSERT |
| Nuevo usuario sin empresa_id | `App.jsx`, `OnboardingPage.jsx` | Flujo SaaS + RPC `create_tenant()` |
| Recepción OC SET vs ADD | `ordenesCompraService.ts` | Suma delta al acumulado |
| OC no actualizaba en tiempo real | `OrdenesCompraSection.jsx` | Supabase Realtime |
| Inactivar/reactivar clientes | `ClientesSection.jsx` | Soft delete SAP-style |
| Dashboard mostraba $0 | `dashboardService.ts` | `user_id` → `empresa_id` en 7 filtros |
| Búsqueda Cmd+K vacía | `CommandPalette.jsx` | `user_id` → `empresa_id` |
| `removeChild` al cerrar ClientDetailModal | `ClientDetailModal.jsx` | Eliminar `if (!open) return null` |
| `seed_plan_cuentas` RLS 403 | Supabase + `PlanCuentasSection.jsx` | SECURITY DEFINER |
| RLS `profiles` bloqueaba vista equipo | Supabase SQL | Policy con `OR empresa_id = get_my_empresa_id()` |

---

## Convenciones (REGLAS DE ORO)

- **Multi-tenant:** TODAS las queries deben filtrar `.eq('empresa_id', user.empresa_id)`. Nunca `user_id` para filtrar (solo para INSERTs como autor).
- **INSERTs:** siempre incluir `empresa_id: user.empresa_id` + `user_id: user.id`.
- **Timezone:** usar siempre `getNowAR()` / `formatDateAR()` / `formatDateTimeAR()` de `dateUtils.js`. Nunca `toLocaleString()`.
- **Clientes activos:** todas las queries de selección incluyen `.neq('activo', false)`.
- **TanStack Query v5:** `onSuccess` en `useQuery` no existe. Usar `useEffect`.
- **RLS en tablas nuevas:** `ENABLE ROW LEVEL SECURITY` + policy `get_my_empresa_id()` + audit trigger.
- **Radix UI Dialogs:** nunca `if (!open) return null` — dejar que Radix maneje show/hide con prop `open`.
- **Caja:** solo cobros en Efectivo requieren caja abierta. Transferencia/Tarjeta/Cheque no.
- **Open Items:** al cobrar Cuenta Corriente, siempre referenciar `comprobante_id` en el movimiento HABER para trazabilidad.

---

## Datos de conexión

- **Supabase URL:** `https://wuznppxeonmhfcvnqfbf.supabase.co`
- **Supabase Project ID:** `wuznppxeonmhfcvnqfbf` (org: NALUX)
- **SMTP:** Resend.com — `smtp.resend.com:465`
- **Edge Functions:** `create-user`, `delete-user`, `invite-user`
- **Timezone:** Argentina (UTC-3) — helpers en `src/lib/dateUtils.js`
- **Multi-tenancy:** RLS via `get_my_empresa_id()` + `empresa_id` en todas las tablas
- **Logo:** Base64 en tabla `configuracion` (clave `logo_base64`)
- **Roles:** `admin` (acceso total) | `staff` (permisos granulares en `profiles.permissions` JSONB)

---

## Pendientes inmediatos

| Prioridad | Tarea |
|---|---|
| ✅ Listo | Paginación en tablas históricas — HistorialVentas + ComprasSection (50/pág, client-side) |
| ✅ Listo | Soft delete SAP-style en productos — toggle inactivos + reactivar |
| ✅ Listo | Migrations 013-016 ejecutadas en Supabase (2026-06-05) |
| 🟡 Media | Configurar SMTP para password recovery en producción |
| 🟡 Media | Re-deploy edge functions con hardening |
| 🟡 Media | Paginación en ReportesSection |
| ⏸️ Al final | Membership / modelo de licencias / Stripe o MercadoPago |
| ⏸️ Al final | Conexión con ARCA (AFIP) |
| ⏸️ Al final | Deploy en hosting (Vercel) |
