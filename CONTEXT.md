# KAIROX Gestión — Contexto de Sesión
**Última actualización:** 2026-05-30
**Branch activo:** `claude/suspicious-panini-6cb9e5`

---

## ¿Qué es este proyecto?

**KAIROX Gestión** es un ERP para PyMEs — multi-tenant SaaS construido con:
- **Frontend:** React 18 + Vite + TailwindCSS + Shadcn/UI + Framer Motion
- **Backend:** Supabase (PostgreSQL + Auth + RLS)
- **Estado global:** Context API (Auth, Caja, Theme, Config)
- **Data fetching:** TanStack Query v5
- **Lenguaje:** JavaScript (JSX) + TypeScript coexistiendo (migración gradual)

---

## Estado actual del plan de transformación ERP

### ✅ FASE 1 — Fundamentos técnicos (COMPLETA)

| Tarea | Archivos clave |
|---|---|
| TanStack Query instalado y configurado | `src/main.jsx`, `src/lib/queryClient.ts` |
| Capa de servicios con paginación | `src/services/*.ts` (8 servicios) |
| Tabla de auditoría (audit_log) | `migrations/001_audit_log.sql` |
| TypeScript: tsconfig + tipos de dominio | `tsconfig.json`, `src/types/index.ts` |
| Exportación Excel (xlsx) | `src/lib/excelUtils.js` |
| Búsqueda global Cmd+K | `src/components/CommandPalette.jsx` |

### ✅ FASE 2 — Módulos ERP faltantes (COMPLETA)

| Tarea | Estado | Archivos clave |
|---|---|---|
| Cotizaciones (presupuestos) | ✅ Completo | `src/components/sections/CotizacionesSection.jsx`, `src/services/cotizacionesService.ts`, `migrations/002_cotizaciones.sql` |
| Órdenes de Compra | ✅ Completo | `src/components/sections/OrdenesCompraSection.jsx`, `src/services/ordenesCompraService.ts`, `migrations/003_ordenes_compra.sql` |
| Facturación electrónica AFIP | ⏸️ Diferida | — |

### ✅ FASE 3 — UX de primer nivel (COMPLETA)

| Tarea | Estado | Archivos clave |
|---|---|---|
| Búsqueda global Cmd+K | ✅ Completo | `src/components/CommandPalette.jsx` |
| Exportar Excel | ✅ Completo | `src/lib/excelUtils.js` |
| DataTable universal avanzada | ✅ Completo | `src/components/ui/DataTable.jsx` |
| Dashboard mejorado (8 KPIs + 2 gráficos) | ✅ Completo | `src/components/sections/DashboardSection.jsx` |
| Notificaciones inteligentes | ✅ Completo | `src/hooks/useNotifications.js`, Header actualizado |

### 🔄 FASE 4 — Módulos contables (EN CURSO)

| Tarea | Estado | Archivos clave |
|---|---|---|
| Plan de Cuentas / Contabilidad | ✅ Completo | `src/components/sections/PlanCuentasSection.jsx`, `src/services/planCuentasService.ts`, `migrations/004_plan_cuentas.sql` |
| Multi-almacén | ⏸️ Diferido | — |
| Lotes y vencimientos | ⏸️ Diferido | — |

### ⏳ FASE 5 — Integraciones (0%)
Email, WhatsApp, API REST pública, backups — diferida por decisión del usuario.
Nota: El script `UalaSync.gs` (Google Apps Script) ya existe y lee correos de Uala → inserta en `movimientos_caja` automáticamente cada 10 minutos. No forma parte del repo React.

---

## Bugs corregidos en sesiones anteriores

| Bug | Archivo | Fix aplicado |
|---|---|---|
| Staff bloqueado en Caja (user.id → user.tenant_id) | `CajaSection.jsx` | Corregido |
| Staff bloqueado en Compras (user.id → user.tenant_id) | `ComprasSection.jsx` | Corregido |
| Logo: upload a bucket 'public' inexistente | `ConfiguracionSection.jsx` | Reemplazado por Base64 en DB |
| Closure stale en ConfigContext.fetchConfig() | `ConfigContext.jsx` | `setConfig(prev => ...)` |

---

## Arquitectura de archivos nuevos creados

```
src/
├── types/
│   └── index.ts              ← Tipos de dominio: 25+ interfaces (incluye PlanCuenta, AsientoContable, AsientoItem)
├── services/
│   ├── index.ts              ← Barrel export de todos los servicios
│   ├── productosService.ts
│   ├── ventasService.ts
│   ├── clientesService.ts
│   ├── comprasService.ts
│   ├── cajaService.ts
│   ├── dashboardService.ts
│   ├── cotizacionesService.ts
│   ├── ordenesCompraService.ts
│   └── planCuentasService.ts ← Plan de cuentas + asientos + balance de comprobación
├── lib/
│   ├── queryClient.ts
│   └── excelUtils.js
├── hooks/
│   └── useNotifications.js   ← Stock bajo + deuda vencida + OC pendientes
└── components/
    ├── CommandPalette.jsx
    ├── ui/
    │   └── DataTable.jsx     ← Tabla universal (sort, búsqueda, paginación, Excel)
    └── sections/
        ├── CotizacionesSection.jsx
        ├── OrdenesCompraSection.jsx
        └── PlanCuentasSection.jsx  ← Plan de cuentas (árbol) + Asientos + Balance

migrations/
├── 001_audit_log.sql
├── 002_cotizaciones.sql
├── 003_ordenes_compra.sql
└── 004_plan_cuentas.sql      ← plan_cuentas + asientos_contables + asientos_items + seed estándar
```

---

## Módulos existentes y su estado

| Módulo | Sección | Estado |
|---|---|---|
| Dashboard | `DashboardSection.jsx` | ✅ 8 KPIs + 2 gráficos |
| Ventas (POS) | `VentasSection.jsx` | ✅ Funcional |
| Inventario | `ProductosSection.jsx` | ✅ Funcional |
| Compras | `ComprasSection.jsx` | ✅ Funcional |
| Cotizaciones | `CotizacionesSection.jsx` | ✅ Funcional |
| Órdenes de Compra | `OrdenesCompraSection.jsx` | ✅ Funcional |
| Caja | `CajaSection.jsx` | ✅ Funcional |
| Clientes | `ClientesSection.jsx` | ✅ Funcional |
| Cuenta Corriente | `CuentaCorrienteSection.jsx` | ✅ Funcional |
| **Contabilidad** | `PlanCuentasSection.jsx` | ✅ **Nuevo — Fase 4** |
| Reportes | `ReportesSection.jsx` | ✅ Funcional |
| Usuarios | `UsuariosSection.jsx` | ✅ Funcional |
| Configuración | `ConfiguracionSection.jsx` | ✅ Funcional |

---

## Plan de Cuentas — Detalle del módulo nuevo

### Funcionalidades
- **Tab Árbol de Cuentas:** vista jerárquica expandible, búsqueda en tiempo real, editar nombre/estado, agregar nuevas cuentas
- **Tab Asientos Contables:** libro diario paginado, crear asiento (validación de cuadre), confirmar/anular, ver detalle con líneas
- **Tab Balance de Comprobación:** totales debe/haber por cuenta para asientos confirmados, filtrable por fecha

### Schema SQL (migration 004)
- `plan_cuentas` — árbol de cuentas con RLS por empresa
- `asientos_contables` — libro diario con estados (borrador/confirmado/anulado)
- `asientos_items` — líneas de cada asiento
- `seed_plan_cuentas(empresa_id)` — inicializa plan estándar para PyME argentina (39 cuentas en 5 grupos)
- `next_numero_asiento(empresa_id)` — numeración correlativa AS-000001
- Trigger que recalcula `saldo_actual` en `plan_cuentas` al confirmar/anular asientos

### Próximos pasos sugeridos para Fase 4
1. **Asientos automáticos** — generar asiento al confirmar una Venta, Compra u OC (vincula ERP con contabilidad)
2. **Libro Mayor** por cuenta — ver todos los movimientos de una cuenta específica

---

## Integración externa (fuera del repo)

| Sistema | Descripción |
|---|---|
| `UalaSync.gs` (Google Apps Script) | Lee correos de Uala en Gmail, parsea montos, inserta en `movimientos_caja`. Trigger cada 10 min. Proyecto Supabase: `wuznppxeonmhfcvnqfbf` |

---

## Datos de conexión / configuración

- **Supabase URL/Key:** en `.env` (variables `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`)
- **Supabase Project ID:** `wuznppxeonmhfcvnqfbf`
- **Timezone:** Argentina (UTC-3) — helpers en `src/lib/dateUtils.js`
- **Multi-tenancy:** RLS via `get_my_empresa_id()` + columna `empresa_id` en todas las tablas
- **Logo:** almacenado como Base64 en tabla `configuracion` (clave `company_logo` / `logo_base64`)
- **Roles:** `admin` (acceso total) | `staff` (permisos granulares en `profiles.permissions` JSONB)
