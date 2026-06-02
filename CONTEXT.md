# KAIROX Gestión — Contexto de Sesión
**Última actualización:** 2026-06-02 (sesión UX + timezone fixes globales)
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
| **prop `dismiss` en DOM** | `toaster.jsx` | Destructurar `dismiss` del spread para no pasarlo al DOM. |
| **`COTIZACIONES_KEYS.cotizacion` is not a function** | `CotizacionesSection.jsx` | Renombrado a `.detail()` para coincidir con el servicio. |
| **Label `for` sin match en ProductForm** | `ProductosSection.jsx` | Agregado `id="proveedor"` al `SelectTrigger`. |
| **Tablas faltantes en DB** | Supabase SQL | Aplicadas migraciones 002 (cotizaciones), 003 (ordenes_compra), 004 (plan_cuentas). |
| **`cuenta_corriente_movimientos.created_at` does not exist** | Supabase SQL | `ALTER TABLE ... ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`. |
| **Warning Radix UI: Missing Description en Dialog** | `ClientesSection.jsx` | Agregado `<DialogDescription>` en modal "Nuevo Cliente". |
| **403 RLS en tabla configuracion al guardar logo** | `ConfigContext.jsx` | `updateConfig` ahora llama a `get_my_empresa_id()` RPC e incluye `empresa_id` en INSERT. Migration 005 agrega `UNIQUE(empresa_id,clave)` y políticas RLS correctas. |
| **Nuevo usuario sin empresa_id quedaba en dashboard vacío** | `App.jsx`, `OnboardingPage.jsx`, `SupabaseAuthContext.jsx` | Flujo SaaS: detectar `!user.empresa_id` → mostrar OnboardingPage → RPC `create_tenant()` crea empresa + perfil + config inicial. |
| **Warnings Radix UI en 8+ componentes** | `CotizacionesSection`, `PlanCuentasSection`, `ReportesSection`, `command.jsx`, `CajaSection`, `OrdenesCompraSection`, `ClientesSection` | Búsqueda exhaustiva: todos los `DialogContent` sin `DialogDescription` corregidos. `ReportesSection` y `CommandDialog` usan `sr-only`. |
| **`seed_plan_cuentas` RLS 403 Forbidden** | Supabase función + `PlanCuentasSection.jsx` | Función redefinida con `SECURITY DEFINER`. Fix en componente: `empresaId = user?.empresa_id` (antes usaba `tenant_id` = auth UUID incorrecto). Filas mal insertadas limpiadas manualmente. |
| **Plan de Cuentas no mostraba cuentas tras inicializar** | `PlanCuentasSection.jsx` | `empresaId = user?.tenant_id \|\| user?.empresa_id` → `user?.empresa_id`. `tenant_id` es el auth UUID, no el empresa UUID. |
| **RLS `profiles` bloqueaba vista de equipo** | Supabase SQL | Política `profiles_select` reemplazada: `id = auth.uid() OR empresa_id = get_my_empresa_id()` para que admin vea todo el equipo. |
| **Creación de usuarios fallaba (CORS + función inexistente)** | `UsuariosSection.jsx` + Supabase | Flujo cambiado de `invite-user` a `create-user`. Nueva Edge Function `create-user` deployada con CORS + `auth.admin.createUser()` + insert en `profiles`. Campo contraseña con show/hide en el form. |
| **Error 42P10 al guardar configuración (logo/nombre)** | `ConfigContext.jsx` | `upsert onConflict:'clave'` reemplazado por `maybeSingle() → update/insert`. No requiere UNIQUE constraint en la tabla. |

### Sesión 2026-06-02 (UX + timezone global)

| Bug | Archivo | Fix aplicado |
|---|---|---|
| **Movimientos de Caja registraban siempre 12:00** | `CajaSection.jsx` L337 | `fecha: getDateFromInputAR(formData.fecha)` (fijaba 12:00 UTC) → `fecha: getNowAR().toISOString()` para capturar hora real |
| **Ticket de venta mostraba hora -3h del valor real** | `ComprobantePrintModal.jsx` | `new Date(...).toLocaleString()` → `formatDateTimeAR()`. El timestamp ya está con offset AR aplicado, `toLocaleString` lo restaba de nuevo |
| **Fechas/horas mal mostradas en toda la app** | 11 archivos | Reemplazado masivo de `new Date(x).toLocaleDateString/toLocaleTimeString/toLocaleString` por `formatDateAR`/`formatDateTimeAR` en: `HistorialVentas`, `SaleDetailModal`, `CompraDetailModal`, `ComprasSection`, `ClientDetailModal`, `ReportesSection` (4 reportes), `UsuariosSection` (último login), `CommandPalette`, `CajaSection` (Act:), `pdfUtils` ("Generado:") |
| **Filtro de fecha en Historial/Compras descartaba registros válidos** | `HistorialVentas.jsx`, `ComprasSection.jsx` | `new Date(sale.fecha) < new Date(dateFrom)` comparaba contra medianoche UTC mientras las ventas están con offset AR → reemplazado por comparación de strings `YYYY-MM-DD` (slice 0,10) directamente. Sin timezone drift |
| **OrdenesCompra: error 42703 `proveedores.user_id does not exist`** | `OrdenesCompraSection.jsx` L135,151 | `.eq('user_id', empresaId)` → `.eq('empresa_id', empresaId)` en búsqueda de proveedores y productos |
| **Cotizaciones: búsqueda de productos no devolvía nada** | `CotizacionesSection.jsx` L99 | Mismo bug `user_id` → `empresa_id` en query de productos |
| **Categorías vacías en Nuevo Producto** | Supabase | INSERT de 13 categorías default para empresa NALUX (Electrónica, Belleza, Ropa, Hogar, Alimentos, Herramientas, Salud, Tecnología, Deportes, Juguetes, Limpieza, Papelería, Otros) |
| **Dropdown de productos en Nueva Venta tapaba el carrito** | `NuevaVentaModal.jsx` | `setShowProductDropdown(false)` se anulaba por `onFocus={()=>setShow(true)}` al recuperar foco tras agregar item. Reestructurado: panel inline `max-h-64` siempre visible (catálogo arriba + carrito abajo, ambos scrolleables). Sin más dropdown flotante |
| **Buscador de proveedor en OrdenesCompra exigía escribir** | `OrdenesCompraSection.jsx` | `searchProveedor` ahora trae top 10 ordenados alfabéticamente si query vacía. `onFocus` dispara `searchProveedor('')` para mostrar lista de inmediato. `onBlur` cierra con timeout 200ms |
| **Campo Unidad sin sugerencias** | `CotizacionesSection.jsx`, `OrdenesCompraSection.jsx` | Agregado `<datalist id="unidades-medida">` con 16 opciones (un, kg, g, lt, ml, mt, cm, m², m³, caja, pack, docena, par, hs, día, servicio). Input con `list="unidades-medida"` — usuario puede elegir o escribir libremente |
| **Ícono de calendario invisible en modo oscuro** | `index.css` | CSS global: `.dark input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(1) brightness(1.5) }` para todos los inputs date/time/datetime-local/month/week. No afecta modo claro |

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
│   ├── OnboardingPage.jsx        ← NUEVO: pantalla SaaS para crear empresa en primer login
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
│   ├── SupabaseAuthContext.jsx   ← +needsPasswordReset, +isRecoveryFlow ref, +last_login_at, +refreshUser
│   └── ConfigContext.jsx         ← updateConfig incluye empresa_id vía get_my_empresa_id()
└── App.jsx                       ← +OnboardingPage cuando !user.empresa_id
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
| 🟢 Hecho | **SaaS multi-tenant** | Flujo completo: registro → onboarding → empresa aislada ✅ |
| 🟢 Hecho | **Fix logo / configuracion RLS** | 403 resuelto con empresa_id en upsert ✅ |
| 🟢 Hecho | **Indicadores de Caja** | Resuelto ✅ |
| 🟢 Hecho | **Auth & Usuarios** | Reset contraseña ✅, creación directa ✅, SMTP Resend ✅, último acceso ✅ |
| 🟢 Hecho | **Errores de consola** | Todos los warnings Radix UI, claves TanStack Query, etc. ✅ |
| 🟢 Hecho | **Contabilidad** | Plan de Cuentas + Libro Mayor + asientos automáticos ✅ |
| 🟡 Media | **SMTP para nuevos tenants** | `onboarding@resend.dev` solo envía a emails verificados. Para producción: verificar dominio propio en Resend y actualizar sender. Confirmación de email desactivada en dev. |

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

**Archivos clave del flujo SaaS:**
- `src/components/OnboardingPage.jsx` — pantalla de creación de empresa
- `src/contexts/SupabaseAuthContext.jsx` — `refreshUser()` para recargar perfil post-onboarding
- `src/App.jsx` — gate: `!user.empresa_id` → `<OnboardingPage />`
- `migrations/006_saas_create_tenant.sql` — RPC `create_tenant()` SECURITY DEFINER

---

## Próximos pasos sugeridos

| Prioridad | Tarea |
|---|---|
| Alta | Verificar dominio en Resend para habilitar confirmación de email en producción |
| Media | Asientos automáticos para **Órdenes de Compra** confirmadas |
| Baja | Facturación electrónica AFIP |
| Baja | Multi-almacén |
| Baja | Lotes y vencimientos |
| Diferida | Fase 5: Email, WhatsApp, API REST, backups |

---

## Convenciones aprendidas (para futuras sesiones)

- **Tablas multi-tenant:** `proveedores`, `productos`, `categorias`, `configuracion`, etc. usan **`empresa_id`**, no `user_id`. Tablas más viejas (`comprobantes`, `movimientos_caja`, `movimientos_inventario`, `cuenta_corriente_movimientos`) usan `user_id = tenant_id`. Verificar con `list_tables`/`information_schema` antes de escribir queries.
- **Timezone:** todo timestamp guardado en DB se persiste con offset AR ya aplicado (esquema "AR-local-as-UTC"). Para mostrar usar **siempre** `formatDateAR` / `formatDateTimeAR` de `dateUtils.js`. **Nunca** `new Date(x).toLocale*()` — resta los 3h dos veces.
- **Filtros por rango de fecha:** comparar strings `YYYY-MM-DD` (slice 0,10), no instanciar `new Date()` sobre inputs de tipo date — evita drift de timezone.
- **Inputs date en dark mode:** el CSS global ya invierte el ícono — no hace falta agregar nada por componente.
- **Datalist para sugerencias libres:** patrón usado para "Unidad" (input + `<datalist id="unidades-medida">`) — reutilizable para otros campos que toleren texto libre.
