# KAIROX Gestión — Contexto de Sesión
**Última actualización:** 2026-05-30
**Branch activo:** `claude/suspicious-panini-6cb9e5`

---

## ¿Qué es este proyecto?

**KAIROX Gestión** es un ERP para PyMEs — multi-tenant SaaS construido con:
- **Frontend:** React 18 + Vite + TailwindCSS + Shadcn/UI + Framer Motion
- **Backend:** Supabase (PostgreSQL + Auth + RLS)
- **Estado global:** Context API (Auth, Caja, Theme, Config)
- **Data fetching:** TanStack Query v5 (recién incorporado)
- **Lenguaje:** JavaScript (JSX) + TypeScript coexistiendo (migración gradual)

---

## Estado actual del plan de transformación ERP

### ✅ FASE 1 — Fundamentos técnicos (COMPLETA)

| Tarea | Archivos clave |
|---|---|
| TanStack Query instalado y configurado | `src/main.jsx`, `src/lib/queryClient.ts` |
| Capa de servicios con paginación | `src/services/*.ts` (7 servicios) |
| Tabla de auditoría (audit_log) | `migrations/001_audit_log.sql` |
| TypeScript: tsconfig + tipos de dominio | `tsconfig.json`, `src/types/index.ts` |
| Exportación Excel (xlsx) | `src/lib/excelUtils.js` |
| Búsqueda global Cmd+K | `src/components/CommandPalette.jsx` |

### 🔄 FASE 2 — Módulos ERP faltantes (~25% completa)

| Tarea | Estado | Archivos clave |
|---|---|---|
| Cotizaciones (presupuestos) | ✅ Completo | `src/components/sections/CotizacionesSection.jsx`, `src/services/cotizacionesService.ts`, `migrations/002_cotizaciones.sql` |
| Órdenes de Compra | ⚠️ Solo backend | `migrations/003_ordenes_compra.sql` — **falta la UI** |
| Facturación electrónica AFIP | ❌ Pendiente | — |
| Plan de Cuentas / Contabilidad | ❌ Pendiente | — |
| Multi-almacén | ❌ Pendiente | — |
| Lotes y vencimientos | ❌ Pendiente | — |

### 🔄 FASE 3 — UX de primer nivel (~35% completa)

| Tarea | Estado | Archivos clave |
|---|---|---|
| Búsqueda global Cmd+K | ✅ Completo | `src/components/CommandPalette.jsx` |
| Exportar Excel | ✅ Completo | `src/lib/excelUtils.js` |
| Tabla universal avanzada | ❌ Pendiente | — |
| Dashboard mejorado (más KPIs) | ❌ Pendiente | — |
| Notificaciones inteligentes | ❌ Pendiente | — |

### ⏳ FASE 4 — Integraciones (0%)
Email, WhatsApp, API REST pública, backups — no iniciada.

---

## Bugs corregidos en esta sesión

| Bug | Archivo | Fix aplicado |
|---|---|---|
| Staff bloqueado en Caja (user.id → user.tenant_id) | `CajaSection.jsx` | Corregido |
| Staff bloqueado en Compras (user.id → user.tenant_id) | `ComprasSection.jsx` | Corregido (líneas 289 y 339) |
| Logo: upload a bucket 'public' inexistente | `ConfiguracionSection.jsx` | Reemplazado por Base64 en DB |
| Closure stale en ConfigContext.fetchConfig() | `ConfigContext.jsx` | `setConfig(prev => ...)` |

---

## Arquitectura de archivos nuevos creados

```
src/
├── types/
│   └── index.ts              ← Tipos de dominio: 20+ interfaces (Producto, Cliente, Venta, etc.)
├── services/
│   ├── index.ts              ← Barrel export de todos los servicios
│   ├── productosService.ts
│   ├── ventasService.ts
│   ├── clientesService.ts
│   ├── comprasService.ts
│   ├── cajaService.ts
│   ├── dashboardService.ts
│   └── cotizacionesService.ts
├── lib/
│   ├── queryClient.ts        ← QueryClient con config de cache (2min stale, 10min gc)
│   └── excelUtils.js         ← exportToExcel() + helpers por módulo
└── components/
    ├── CommandPalette.jsx    ← Búsqueda global Cmd+K (productos, clientes, ventas, módulos)
    └── sections/
        └── CotizacionesSection.jsx  ← Módulo completo (lista, nueva, detalle, workflow estados)

migrations/
├── 001_audit_log.sql         ← Tabla audit_log + trigger universal
├── 002_cotizaciones.sql      ← Schema cotizaciones + cotizacion_items + RLS + numeración
└── 003_ordenes_compra.sql    ← Schema ordenes_compra + items + trigger de stock + RLS
```

---

## Módulos existentes (pre-sesión, funcionando)

| Módulo | Sección | Estado |
|---|---|---|
| Dashboard | `DashboardSection.jsx` | ✅ Funcional |
| Ventas (POS) | `VentasSection.jsx` | ✅ Funcional |
| Inventario | `ProductosSection.jsx` | ✅ Funcional |
| Compras | `ComprasSection.jsx` | ✅ Funcional (bug tenant_id corregido) |
| Caja | `CajaSection.jsx` | ✅ Funcional (bug tenant_id corregido) |
| Clientes | `ClientesSection.jsx` | ✅ Funcional |
| Cuenta Corriente | `CuentaCorrienteSection.jsx` | ✅ Funcional |
| Reportes | `ReportesSection.jsx` | ✅ Funcional |
| Usuarios | `UsuariosSection.jsx` | ✅ Funcional |
| Configuración | `ConfiguracionSection.jsx` | ✅ Funcional (bug logo corregido) |
| **Cotizaciones** | `CotizacionesSection.jsx` | ✅ **Nuevo** |

---

## Próximos pasos sugeridos (en orden de prioridad)

### 1. UI de Órdenes de Compra (impacto alto — backend listo)
El schema SQL ya existe (`migrations/003_ordenes_compra.sql`). Crear `OrdenesCompraSection.jsx` con:
- Lista de OC con estados (borrador → enviada → recibida)
- Formulario nueva OC con ítem-a-ítem
- Modal de recepción parcial/total (actualiza `cantidad_recibida` → trigger actualiza stock)
- Agregar a Sidebar y Dashboard

### 2. Dashboard mejorado
Usar `dashboardService.ts` que ya tiene `getKPIs()`, `getVentasPorDia()`, `getFlujoCajaMensual()`.
Agregar a `DashboardSection.jsx`:
- Card de Margen Bruto
- Card de Gastos del mes
- Gráfico de Flujo de Caja (6 meses, BarChart con ingresos vs egresos)
- Tabla de top 5 productos más vendidos

### 3. Tabla universal avanzada
Crear `src/components/ui/DataTable.jsx` con:
- Sort por cualquier columna
- Búsqueda interna
- Paginación visual (prev/next + página actual)
- Botón exportar Excel (usa `excelUtils.js`)
- Selección múltiple + acciones bulk
Reemplazar tablas en: Productos, Clientes, Historial Ventas, Compras, Caja

### 4. Sistema de notificaciones inteligentes
- Leer `productosStockBajo` del DashboardService (ya implementado)
- Leer clientes con `saldo_actual > 0` y `updated_at` > 30 días
- Mostrar en centro de notificaciones (Header ya tiene el bell icon stub)
- Badge con contador en el Header

---

## Datos de conexión / configuración

- **Supabase URL/Key:** en `.env` (variables `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`)
- **Timezone:** Argentina (UTC-3) — todos los helpers en `src/lib/dateUtils.js`
- **Multi-tenancy:** RLS via `get_my_empresa_id()` + columna `empresa_id` en todas las tablas
- **Logo:** almacenado como Base64 en tabla `configuracion` (clave `company_logo` / `logo_base64`)
- **Roles:** `admin` (acceso total) | `staff` (permisos granulares en `profiles.permissions` JSONB)

---

## Commits recientes

```
940cc3f feat: completar Fase 1 — TypeScript + servicios tipados
a1a372e fix: corregir carga de logo en Configuración
e431d73 feat: upgrade KAIROX a ERP de primer nivel — Fase 1
631b0c1 fix: corregir bugs de RLS, stock stale y debug log en módulo de ventas
abed421 feat: initial commit — KAIROX Gestión con fixes de auth y tenant isolation
```
