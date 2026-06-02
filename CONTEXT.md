# KAIROX Gestión — Contexto de Sesión
**Última actualización:** 2026-06-01 (sesión tarde)
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
| Capa de servicios con paginación | `src/services/*.ts` (9 servicios) |
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

### ✅ FASE 4 — Módulos contables (COMPLETA)

| Tarea | Estado | Archivos clave |
|---|---|---|
| Plan de Cuentas / Contabilidad | ✅ Completo | `src/components/sections/PlanCuentasSection.jsx`, `src/services/planCuentasService.ts`, `migrations/004_plan_cuentas.sql` |
| Libro Mayor por cuenta | ✅ Completo | `PlanCuentasSection.jsx` (tab 4), `planCuentasService.ts` (`getLibroMayor`) |
| Asientos automáticos (Ventas) | ✅ Completo | `NuevaVentaModal.jsx`, `planCuentasService.ts` (`asientosAutoService`) |
| Asientos automáticos (Compras) | ✅ Completo | `ComprasSection.jsx`, `planCuentasService.ts` (`asientosAutoService`) |
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
| Error `removeChild` en Radix UI Dialog | `ProductosSection.jsx` | `ProductForm` movido fuera del componente |
| Soft delete de productos | `ProductosSection.jsx` | Botón tacho → `activo=false`, lista filtra `activo≠false` |
| **Timezone desfasado en movimientos** | `dateUtils.js`, `ProductosSection.jsx`, `CajaSection.jsx`, `MovimientosUala.jsx` | `getNowAR()` ahora resta 3h del epoch UTC sin depender del browser TZ; display usa UTC parts directamente |
| **"Gastos del Mes" incluía apertura de caja** | `dashboardService.ts` | `.neq('categoria','Apertura')` en query `gastosMes` y `getFlujoCajaMensual` |
| **Indicadores de turno mostraban $0** | `CajaSection.jsx` | Tarjetas INGRESOS/EGRESOS/SALDO LÍQUIDO DEL TURNO agregadas al JSX |
| **Fecha/hora de movimientos usaba `created_at`** | `CajaSection.jsx` | Display unificado con `formatDateTimeAR(m.fecha)` |
| **Movimiento fantasma Ualá ($2.317.362)** | `movimientos_caja` en Supabase | Eliminado manualmente. Causado por bug en `UalaSync.gs` que acumuló montos del período en lugar del monto individual. El registro legítimo ($5.000, mismo concepto) quedó intacto. |
| **Reset de contraseña abría el sistema directo** | `SupabaseAuthContext.jsx`, `App.jsx`, `ResetPasswordPage.jsx` | Fix definitivo: leer hash URL sincrónicamente antes de `getSession()` + `isRecoveryFlow` ref para bloquear `SIGNED_IN` durante recovery. |
| **Rate limit de emails (2/hora)** | Supabase Auth | Configurado SMTP propio con Resend.com. API key activa. |

---

## Archivos clave modificados (últimas sesiones)

```
src/
├── lib/
│   └── dateUtils.js              ← Reescrito: getNowAR correcto + formatDateAR/formatDateTimeAR
├── services/
│   └── planCuentasService.ts     ← +getLibroMayor +asientosAutoService
├── components/
│   ├── ResetPasswordPage.jsx     ← NUEVO: pantalla de reset/invite con confirmación x2
│   ├── PasswordRecoveryModal.jsx ← Modal "Olvidé mi contraseña" desde login
│   ├── sections/
│   │   ├── CajaSection.jsx       ← +3 tarjetas indicadoras de turno, fix fechas
│   │   ├── ProductosSection.jsx  ← ProductForm movido fuera, soft delete, fix fechas
│   │   ├── MovimientosUala.jsx   ← formatFecha TZ-safe
│   │   ├── PlanCuentasSection.jsx← +TabLibroMayor
│   │   ├── ComprasSection.jsx    ← +asiento automático
│   │   └── UsuariosSection.jsx   ← flujo invitación por email, columna último acceso
│   └── ventas/
│       └── NuevaVentaModal.jsx   ← +asiento automático al registrar venta
├── contexts/
│   └── SupabaseAuthContext.jsx   ← +needsPasswordReset, +isRecoveryFlow ref, +last_login_at
└── App.jsx                       ← detección recovery flow, toast link vencido
```

---

## Plan de Cuentas — Detalle completo del módulo

### Funcionalidades existentes
- **Tab Árbol de Cuentas:** vista jerárquica expandible, búsqueda en tiempo real, editar nombre/estado, agregar nuevas cuentas
- **Tab Asientos Contables:** libro diario paginado, crear asiento (validación de cuadre), confirmar/anular, ver detalle con líneas
- **Tab Balance de Comprobación:** totales debe/haber por cuenta para asientos confirmados, filtrable por fecha

### Funcionalidades nuevas (Fase 4 completa)
- **Tab Libro Mayor:** seleccionar cuenta → ver todos sus movimientos confirmados con saldo acumulado progresivo (D/H), filtros por fecha
- **Asientos automáticos:** al confirmar una venta → asiento `Caja/Clientes DEBE | Ventas HABER` (auto-confirmado); al registrar una compra → asiento `Inventario DEBE | Caja/Proveedores HABER` (auto-confirmado). Silencioso si la empresa no tiene plan de cuentas configurado.

### Schema SQL (migration 004)
- `plan_cuentas` — árbol de cuentas con RLS por empresa
- `asientos_contables` — libro diario con estados (borrador/confirmado/anulado), campos `origen` y `origen_id`
- `asientos_items` — líneas de cada asiento
- `seed_plan_cuentas(empresa_id)` — inicializa plan estándar para PyME argentina (39 cuentas en 5 grupos)
- `next_numero_asiento(empresa_id)` — numeración correlativa AS-000001
- Trigger que recalcula `saldo_actual` en `plan_cuentas` al confirmar/anular asientos

---

## Módulos existentes y su estado

| Módulo | Sección | Estado |
|---|---|---|
| Dashboard | `DashboardSection.jsx` | ✅ 8 KPIs + 2 gráficos |
| Ventas (POS) | `VentasSection.jsx` + `NuevaVentaModal.jsx` | ✅ Funcional + asiento auto |
| Inventario | `ProductosSection.jsx` | ✅ Funcional + soft delete |
| Compras | `ComprasSection.jsx` | ✅ Funcional + asiento auto |
| Cotizaciones | `CotizacionesSection.jsx` | ✅ Funcional |
| Órdenes de Compra | `OrdenesCompraSection.jsx` | ✅ Funcional |
| Caja | `CajaSection.jsx` | ✅ Funcional + indicadores de turno corregidos |
| Clientes | `ClientesSection.jsx` | ✅ Funcional |
| Cuenta Corriente | `CuentaCorrienteSection.jsx` | ✅ Funcional |
| **Contabilidad** | `PlanCuentasSection.jsx` | ✅ **Fase 4 completa** |
| Reportes | `ReportesSection.jsx` | ✅ Funcional |
| Usuarios | `UsuariosSection.jsx` | ✅ Invitación por email + último acceso + activar/desactivar |
| Configuración | `ConfiguracionSection.jsx` | ✅ Funcional |
| Movimientos Ualá | `MovimientosUala.jsx` | ✅ Funcional + fix timezone |

---

## Timezone — Diseño de la solución

**Esquema:** "Argentina-local-as-UTC" — los timestamps se almacenan con la hora local argentina representada como UTC.  
Ejemplo: Argentina 23:00 del 30/05 se guarda como `2026-05-30T23:00:00Z`.

**Regla de display:** SIEMPRE leer los campos `getUTC*()` del objeto Date, nunca `toLocaleDateString()` sin timezone.

**Helpers en `dateUtils.js`:**
- `getNowAR()` → `new Date(Date.now() - 3*3600000)` (TZ-safe, no depende del browser)
- `formatDateAR(iso)` → `dd/mm/yyyy` usando UTC parts
- `formatDateTimeAR(iso)` → `dd/mm/yyyy HH:MM` usando UTC parts
- `getTodayAR()` → `YYYY-MM-DD` para hoy en Argentina

---

## Integración externa (fuera del repo)

| Sistema | Descripción |
|---|---|
| `UalaSync.gs` (Google Apps Script) | Lee correos de Uala en Gmail, parsea montos, inserta en `movimientos_caja`. Trigger cada 10 min. Proyecto Supabase: `wuznppxeonmhfcvnqfbf` |

---

## Datos de conexión / configuración

- **Supabase URL/Key:** en `.env` (variables `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`)
- **Supabase Project ID:** `wuznppxeonmhfcvnqfbf` (org: NALUX — distinta a la org del MCP)
- **Supabase Site URL:** `http://localhost:3001` (dev) — actualizar a dominio en producción
- **SMTP:** Resend.com — `smtp.resend.com:465` / user: `resend` / sender: `onboarding@resend.dev`
- **Edge Functions deployadas:** `create-user`, `delete-user`, `invite-user`
- **Timezone:** Argentina (UTC-3) — helpers en `src/lib/dateUtils.js`
- **Multi-tenancy:** RLS via `get_my_empresa_id()` + columna `empresa_id` en todas las tablas
- **Logo:** almacenado como Base64 en tabla `configuracion` (clave `company_logo` / `logo_base64`)
- **Roles:** `admin` (acceso total) | `staff` (permisos granulares en `profiles.permissions` JSONB)
- **profiles.last_login_at:** columna agregada, se actualiza en cada login exitoso

---

## Pendientes inmediatos

| Prioridad | Tarea | Detalle |
|---|---|---|
| 🔴 Alta | **Indicadores de Caja siguen rompiéndose** | Los indicadores INGRESOS / EGRESOS / SALDO del turno fallan intermitentemente. Causa raíz aún no identificada. |
| 🟡 Media | **Borrar 4 comprobantes de prueba** | Query lista. IDs: `3ef2fa9b`, `8ffcc081`, `e2f320c2`, `74173b27`. Primero borrar `comprobante_items` y luego `comprobantes`. |
| 🟡 Media | **Bug en UalaSync.gs** | Agregar control de duplicados por monto + fecha + concepto para evitar imports incorrectos. |
| 🟢 Hecho | **Auth & Usuarios** | Reset contraseña ✅, invitación por email ✅, SMTP Resend ✅, último acceso ✅ |

---

## Próximos pasos sugeridos

| Prioridad | Tarea |
|---|---|
| Media | Asientos automáticos para **Órdenes de Compra** confirmadas |
| Baja | Facturación electrónica AFIP |
| Baja | Multi-almacén |
| Baja | Lotes y vencimientos |
| Diferida | Fase 5: Email, WhatsApp, API REST, backups |
