# KAIROX Gestión — Contexto de Sesión
**Última actualización:** 2026-06-03 (sesión — asientos auto recepción OC + migration 008 ejecutada)
**Branch activo:** `master`

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
| Libro Mayor por cuenta | ✅ Completo | `PlanCuentasSection.jsx` (tab Libro Mayor), `planCuentasService.ts` (`getLibroMayor`) |
| Asientos automáticos (Ventas) | ✅ Completo | `NuevaVentaModal.jsx`, `planCuentasService.ts` (`asientosAutoService`) |
| Asientos automáticos (Compras) | ✅ Completo | `ComprasSection.jsx`, `planCuentasService.ts` (`asientosAutoService`) |
| Estado de Resultados (P&L) | ✅ Completo | `PlanCuentasSection.jsx` (tab P&L), `planCuentasService.ts` (`getEstadoResultados`) |
| Balance General | ✅ Completo | `PlanCuentasSection.jsx` (tab Balance General), `planCuentasService.ts` (`getBalanceGeneral`) |
| Cierre de períodos contables | ✅ Completo | `PlanCuentasSection.jsx` (tab Períodos), `planCuentasService.ts` (`periodosService`), `migrations/008_oc_approval_periodos.sql` |
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
| **Timezone desfasado en movimientos** | `dateUtils.js`, múltiples archivos | `getNowAR()` ahora resta 3h del epoch UTC sin depender del browser TZ; display usa UTC parts directamente |
| **"Gastos del Mes" incluía apertura de caja** | `dashboardService.ts` | `.neq('categoria','Apertura')` en query `gastosMes` y `getFlujoCajaMensual` |
| **Indicadores de turno mostraban $0** | `CajaSection.jsx` | Tarjetas INGRESOS/EGRESOS/SALDO LÍQUIDO DEL TURNO agregadas al JSX |
| **Reset de contraseña abría el sistema directo** | `SupabaseAuthContext.jsx`, `App.jsx`, `ResetPasswordPage.jsx` | Fix definitivo: leer hash URL sincrónicamente antes de `getSession()` + `isRecoveryFlow` ref |
| **Rate limit de emails (2/hora)** | Supabase Auth | Configurado SMTP propio con Resend.com. API key activa. |
| **Tablas faltantes en DB** | Supabase SQL | Aplicadas migraciones 002 (cotizaciones), 003 (ordenes_compra), 004 (plan_cuentas). |
| **403 RLS en tabla configuracion al guardar logo** | `ConfigContext.jsx` | `updateConfig` ahora llama a `get_my_empresa_id()` RPC e incluye `empresa_id` en INSERT. |
| **Nuevo usuario sin empresa_id quedaba en dashboard vacío** | `App.jsx`, `OnboardingPage.jsx`, `SupabaseAuthContext.jsx` | Flujo SaaS: detectar `!user.empresa_id` → mostrar OnboardingPage → RPC `create_tenant()`. |
| **Recepción OC: SET en vez de ADD** | `ordenesCompraService.ts` | Servicio cambiado a ADD (suma delta al acumulado, respeta máximo pedido). |
| **Notificaciones OC no navegaban** | `Header.jsx`, `Dashboard.jsx`, `OrdenesCompraSection.jsx` | DropdownMenu controlled + setTimeout(150ms) nav + navPayload. |
| **aria-hidden Radix UI al navegar desde notificaciones** | `Header.jsx`, `OrdenesCompraSection.jsx` | Fix definitivo: blur antes de navegar + 150ms para desmontar portal. |
| **Warnings Radix UI en 8+ componentes** | Múltiples secciones | Todos los `DialogContent` sin `DialogDescription` corregidos. |
| **`seed_plan_cuentas` RLS 403 Forbidden** | Supabase + `PlanCuentasSection.jsx` | Función `SECURITY DEFINER`. Fix: `empresaId = user?.empresa_id`. |
| **RLS `profiles` bloqueaba vista de equipo** | Supabase SQL | Política `profiles_select` reemplazada con `OR empresa_id = get_my_empresa_id()`. |
| **Creación de usuarios fallaba (CORS + función inexistente)** | `UsuariosSection.jsx` + Supabase | Edge Function `create-user` deployada. |
| **RLS 403 al cobrar en Cuenta Corriente** | `ClientDetailModal.jsx` | `empresa_id: user.empresa_id` en ambos inserts de `cuenta_corriente_movimientos` y `movimientos_caja`. |

### Sesión 2026-06-03 (bugfixes OC + inactivar clientes + SAP items)

| Bug / Feature | Archivo | Cambio |
|---|---|---|
| **Recepción parcial OC no funcionaba** | `OrdenesCompraSection.jsx` | `onSuccess` de TQ v5 no existe → `recepciones` siempre `{}` → nada se enviaba al DB. Fix: `useEffect` que observa `detalleRecepcion` e inicializa el mapa `{ [itemId]: pendiente }`. El DB trigger `trg_oc_stock` calcula el delta correcto. |
| **Stats cards mostraban count de la página visible** | `OrdenesCompraSection.jsx`, `ordenesCompraService.ts` | Nuevo método `getEstadoCounts()` + query key `OC_KEYS.counts`. Cards usan el total real, no el slice paginado. |
| **OC no actualizaba en tiempo real** | `OrdenesCompraSection.jsx` | Suscripción Supabase Realtime en `ordenes_compra` → invalida lista + counts al cambiar cualquier registro. |
| **Filtro de fecha en OC** | `OrdenesCompraSection.jsx`, `ordenesCompraService.ts` | Inputs Desde/Hasta en la lista. Filtran en servidor contra `ordenes_compra.fecha`. |
| **Inactivar/reactivar clientes** | `ClientesSection.jsx`, `ClientDetailModal.jsx` | Filtro tabular Activos/Inactivos/Todos. Badge visual. Botón `UserX`/`UserCheck` por fila. Validación: si el cliente tiene movimientos en `cuenta_corriente_movimientos` → bloquea eliminación física y pide inactivar. Botón Inactivar/Reactivar en footer del modal de detalle. |
| **Clientes inactivos aparecían en Cta. Corriente** | `CuentaCorrienteSection.jsx` | Agregado `.neq('activo', false)` al fetch de clientes. |
| **SAP Item 1: Workflow aprobación OC** | `OrdenesCompraSection.jsx`, `ordenesCompraService.ts`, `ConfiguracionSection.jsx`, `ConfigContext.jsx`, `migrations/008` | Nuevo estado `pendiente_aprobacion`. Config `oc_requiere_aprobacion` en Configuración (toggle solo admin). Staff crea OC → `pendiente_aprobacion`. Admin ve botón 👍 Aprobar → pasa a `borrador`. Tarjeta de stats condicional. |
| **SAP Item 2: Cierre de períodos** | `PlanCuentasSection.jsx`, `planCuentasService.ts`, `migrations/008` | `periodosService` con `getPeriodosAnio`, `togglePeriodo`, `isPeriodoCerrado`. Check en `createAsiento` → lanza error si el período está cerrado. Tab "Períodos": grilla 12 meses con Cerrar/Reabrir (solo admin). |
| **SAP Item 3: P&L + Balance General** | `PlanCuentasSection.jsx`, `planCuentasService.ts` | `asientosService.getEstadoResultados()` y `getBalanceGeneral()` (computan desde `getBalanceComprobacion`). Tab "P&L": KPIs (Ingresos/Egresos/Resultado) + detalle por cuenta. Tab "Balance General": columnas Activo vs Pasivo+PN + verificación ecuación contable. |

### Sesión 2026-06-03 tarde (migration 008 + asientos auto recepción OC)

| Feature | Archivo | Cambio |
|---|---|---|
| **Migration 008 ejecutada** | Supabase SQL Editor | `pendiente_aprobacion` CHECK constraint + tabla `periodos_contables` ya en DB |
| **Asientos auto recepción OC** | `planCuentasService.ts`, `ordenesCompraService.ts`, `OrdenesCompraSection.jsx` | Al confirmar recepción: DEBE 1.1.3 Mercaderías / HABER 2.1.1 Ctas a Pagar. Monto = Σ(deltaQty × costoUnitario). Silencioso si empresa sin plan de cuentas o período cerrado. |

---

## Archivos clave modificados (sesión 2026-06-03)

```
src/
├── contexts/
│   └── ConfigContext.jsx          ← +oc_requiere_aprobacion en fetchConfig y defaults
├── services/
│   ├── planCuentasService.ts      ← +periodosService +getEstadoResultados +getBalanceGeneral
│   │                                 +check período en createAsiento +nuevos PLAN_CUENTAS_KEYS
│   └── ordenesCompraService.ts   ← +getEstadoCounts +dateFrom/dateTo en getAll
│                                     +estadoInicial en create +OC_KEYS.counts
├── components/
│   └── sections/
│       ├── OrdenesCompraSection.jsx  ← fix recepción (useEffect vs onSuccess) +realtime
│       │                               +stats cards reales +fecha filter +pendiente_aprobacion
│       │                               +botón Aprobar (admin) +invalidateOC helper
│       ├── ClientesSection.jsx       ← reescrito: filtro activos/inactivos/todos, badge,
│       │                               inactivar/reactivar, validación antes de eliminar
│       ├── ClientDetailModal.jsx     ← +botón Inactivar/Reactivar en footer +onToggleActivo prop
│       ├── CuentaCorrienteSection.jsx ← +.neq('activo', false) en fetch clientes
│       ├── ConfiguracionSection.jsx  ← +sección "Flujo de Trabajo" con toggle aprobación OC
│       └── PlanCuentasSection.jsx    ← +TabPeriodos +TabEstadoResultados +TabBalanceGeneral
│                                       +7 tabs en total (antes 4)

migrations/
└── 008_oc_approval_periodos.sql  ← ADD pendiente_aprobacion a CHECK + CREATE periodos_contables
                                     ⚠️ PENDIENTE ejecutar en Supabase SQL Editor
```

---

## Plan de Cuentas — Tabs disponibles (7 en total)

| Tab | Funcionalidad |
|---|---|
| **Plan de Cuentas** | Árbol jerárquico expandible, búsqueda, editar, drill-down (FBL3N) |
| **Asientos** | Libro diario paginado, crear/confirmar/anular asientos |
| **Balance** | Balance de comprobación: Debe/Haber/Saldo por cuenta, filtros de fecha |
| **Libro Mayor** | Movimientos por cuenta con saldo acumulado progresivo |
| **P&L** | Estado de Resultados: Ingresos / Egresos / Resultado neto con KPIs |
| **Balance General** | Activo vs Pasivo + Patrimonio con verificación de ecuación contable |
| **Períodos** | Grilla 12 meses × año. Admin puede cerrar/reabrir períodos. Cerrar un período bloquea nuevos asientos |

### Schema SQL relevante (migrations 004 + 008)
- `plan_cuentas` — árbol de cuentas (activo/pasivo/patrimonio/ingreso/egreso)
- `asientos_contables` — libro diario (borrador/confirmado/anulado)
- `asientos_items` — líneas de cada asiento
- `periodos_contables` — (empresa_id, anio, mes, cerrado) — PRIMARY KEY compuesta
- `seed_plan_cuentas(empresa_id)` — inicializa plan estándar PyME argentina (39 cuentas, 5 grupos)
- `trg_asiento_item_saldo` — recalcula `saldo_actual` en `plan_cuentas` al confirmar/anular

---

## Módulos existentes y su estado

| Módulo | Sección | Estado |
|---|---|---|
| Dashboard | `DashboardSection.jsx` | ✅ 8 KPIs + 2 gráficos |
| Ventas (POS) | `VentasSection.jsx` + `NuevaVentaModal.jsx` | ✅ Funcional + asiento auto |
| Inventario | `ProductosSection.jsx` | ✅ Funcional + soft delete |
| Compras | `ComprasSection.jsx` | ✅ Funcional + asiento auto |
| Cotizaciones | `CotizacionesSection.jsx` | ✅ Funcional |
| Órdenes de Compra | `OrdenesCompraSection.jsx` | ✅ Funcional + aprobación + realtime + filtro fecha + asiento auto recepción |
| Caja | `CajaSection.jsx` | ✅ Funcional + indicadores de turno |
| Clientes | `ClientesSection.jsx` | ✅ Funcional + inactivar/reactivar + validación eliminación |
| Cuenta Corriente | `CuentaCorrienteSection.jsx` | ✅ Funcional + solo muestra clientes activos |
| **Contabilidad** | `PlanCuentasSection.jsx` | ✅ **7 tabs: P&L + Balance General + Períodos** |
| Reportes | `ReportesSection.jsx` | ✅ Funcional |
| Usuarios | `UsuariosSection.jsx` | ✅ Invitación por email + último acceso + activar/desactivar |
| Configuración | `ConfiguracionSection.jsx` | ✅ Funcional + toggle aprobación OC |
| Movimientos Ualá | `MovimientosUala.jsx` | ✅ Funcional + fix timezone |

---

## Workflow aprobación de OC (SAP Item 1)

```
Config: oc_requiere_aprobacion = 'true' (toggle en Configuración, solo admin)

Staff crea OC
    ↓ estado = pendiente_aprobacion
    ↓ Aparece en tarjeta "Pend. Aprobación" con badge púrpura

Admin ve la OC en lista
    ↓ Botón 👍 Aprobar → updateEstado('borrador')
    ↓ OC disponible para enviar al proveedor

Admin puede también cancelar directamente desde pendiente_aprobacion

Si oc_requiere_aprobacion = 'false':
    Admin y Staff crean OC directo en estado 'borrador' (comportamiento anterior)
```

**Estados de OC en orden:** `pendiente_aprobacion` → `borrador` → `enviada` → `recibida_parcial` → `recibida` / `cancelada`

---

## Cierre de períodos contables (SAP Item 2)

- **`periodosService.togglePeriodo(empresaId, anio, mes, cerrado, userId)`** — upsert en `periodos_contables`
- **`periodosService.isPeriodoCerrado(empresaId, fecha)`** — check al crear cualquier asiento
- Si el período está cerrado → `createAsiento` lanza: _"El período M/AAAA está cerrado."_
- Los asientos automáticos (ventas/compras) también se bloquean silenciosamente (catch en sus llamadores)
- Solo admin puede cerrar/reabrir períodos desde el tab "Períodos"
- Períodos futuros no se pueden cerrar

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
- **Config keys en `configuracion` table:** `nombre_empresa`, `company_logo`, `logo_base64`, `modulos_activos` (JSON), `oc_requiere_aprobacion` ('true'/'false')

---

## Pendientes inmediatos

| Prioridad | Tarea | Detalle |
|---|---|---|
| 🟢 Hecho | **SaaS multi-tenant** | Flujo completo: registro → onboarding → empresa aislada ✅ |
| 🟢 Hecho | **Auth & Usuarios** | Reset contraseña ✅, creación directa ✅, SMTP Resend ✅, último acceso ✅ |
| 🟢 Hecho | **Contabilidad Fase 4** | Plan de Cuentas + Libro Mayor + asientos auto + drill-down + P&L + Balance General + Períodos ✅ |
| 🟢 Hecho | **Módulos configurables** | Sidebar filtra automáticamente ✅ |
| 🟢 Hecho | **Notificaciones OC** | Navegación + realtime ✅ |
| 🟢 Hecho | **Cobro Cta. Corriente** | Fix RLS 403 ✅ |
| 🟢 Hecho | **Migration 007** | `empresa_id` en `cuenta_corriente_movimientos` + RLS ✅ ejecutada |
| 🟢 Hecho | **Inactivar/reactivar clientes** | Soft delete SAP-style en ClientesSection + ClientDetailModal ✅ |
| 🟢 Hecho | **Fix recepción parcial OC** | `useEffect` reemplaza `onSuccess` (TQ v5) ✅ |
| 🟢 Hecho | **SAP items 1+2+3** | Aprobación OC + Cierre períodos + P&L + Balance General ✅ |
| 🟢 Hecho | **Migration 008** | Ejecutada en Supabase `wuznppxeonmhfcvnqfbf` ✅ — CHECK constraint `pendiente_aprobacion` + tabla `periodos_contables` activas. |
| 🟢 Hecho | **Asientos auto para recepción OC** | DEBE 1.1.3 Mercaderías / HABER 2.1.1 Ctas a Pagar — se genera y confirma automáticamente al registrar recepción ✅ |
| 🟡 Media | **3-way match OC-Recepción-Factura** | Vincular factura del proveedor a la OC y validar montos |
| 🟡 Media | **Cotización → Pedido → Factura** | Vincular `cotizaciones.id` como origen de la venta para trazabilidad |
| 🟡 Media | **Verificar dominio Resend** | `onboarding@resend.dev` solo envía a emails verificados → dominio propio para producción |
| Baja | Facturación electrónica AFIP | — |
| Baja | Multi-almacén | — |
| Baja | Lotes y vencimientos | — |
| Diferida | Fase 5: Email, WhatsApp, API REST, backups | — |

---

## SaaS — Flujo de registro de nuevo tenant

```
Nuevo usuario → Registro (nombre, apellido, empresa, email, pass)
    ↓ supabase.auth.signUp() — sin confirmación de email (dev)
    ↓ SIGNED_IN → fetchProfile → empresa_id = null
    ↓ App.jsx detecta !user.empresa_id → OnboardingPage
    ↓ Usuario completa nombre empresa → create_tenant() RPC
    ↓ INSERT empresas + UPDATE profiles (role=admin) + INSERT configuracion
    ↓ refreshUser() → empresa_id tiene valor
    ↓ Dashboard con tenant completamente aislado ✅

Usuario existente (Nalux/Luciano):
    Login → empresa_id en perfil → Dashboard directo ✅

Staff invitado por admin (create-user edge function):
    Edge function crea perfil con empresa_id del admin → Login → Dashboard directo ✅
```

---

## Convenciones aprendidas (para futuras sesiones)

- **Tablas multi-tenant:** `proveedores`, `productos`, `categorias`, `configuracion`, etc. usan **`empresa_id`**, no `user_id`. Tablas más viejas (`comprobantes`, `movimientos_caja`, `movimientos_inventario`) usan `user_id = tenant_id`. `cuenta_corriente_movimientos` tiene ambos (backfill migration 007). Verificar con `information_schema` antes de escribir queries.
- **Timezone:** todo timestamp guardado en DB se persiste con offset AR ya aplicado (esquema "AR-local-as-UTC"). Para mostrar usar **siempre** `formatDateAR` / `formatDateTimeAR` de `dateUtils.js`. **Nunca** `new Date(x).toLocale*()` — resta los 3h dos veces.
- **Filtros por rango de fecha:** comparar strings `YYYY-MM-DD` (slice 0,10), no instanciar `new Date()` sobre inputs de tipo date — evita drift de timezone.
- **TanStack Query v5:** `onSuccess` en `useQuery` **no existe**. Usar `useEffect` que observe el resultado del query. Solo `useMutation` conserva `onSuccess`.
- **Inputs date en dark mode:** el CSS global ya invierte el ícono — no hace falta agregar nada por componente.
- **Supabase Realtime:** para tablas con RLS que usan `get_my_empresa_id()`, el filtro en el canal debe ser `filter: 'empresa_id=eq.{uuid}'`. Sin filtro, el canal no recibe eventos en tablas con RLS activo.
- **Clientes activos:** todas las queries de selección de clientes (ventas, cta. corriente, etc.) deben incluir `.neq('activo', false)`. Solo `ClientesSection` muestra inactivos cuando el filtro está en "Inactivos" o "Todos".
- **Check de período:** `periodosService.isPeriodoCerrado` hace una DB call en cada `createAsiento`. Para auto-asientos (ventas/compras), si falla, es silencioso. Para asientos manuales, el error se muestra en toast.
