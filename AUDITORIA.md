# AUDITORÍA INTEGRAL — KAIROX Gestión
**Fecha:** 2026-06-03
**Branch:** `master` (HEAD previo: `dd60870`)
**Alcance:** end-to-end (1. relevamiento → 2. diagnóstico → 3. arquitectura → 4. schema → 5. correcciones → 6. entregables)

---

## 1. Resumen ejecutivo

KAIROX Gestión es un ERP SaaS multi-tenant con base estructural **sólida**, pero arrastra **deuda técnica** acumulada por la coexistencia de dos schemas legacy/nuevo y reglas multi-tenant aplicadas a medias. La auditoría detectó:

| Categoría | Hallazgos | Corregidos en esta sesión | Pendientes (requieren decisión) |
|---|---|---|---|
| **Multi-tenant: queries sin filtro empresa_id** | 12 queries en 5 archivos | 12 ✅ | 0 |
| **RLS infinite recursion (`profiles`)** | 1 bug crítico | Documentado fix SQL en `SUPABASE_ANALISIS.md` | Ejecutar SQL en Supabase |
| **Código muerto / debug** | 3 hallazgos | 3 ✅ | 0 |
| **Duplicación de schema (legacy)** | `comprobantes` vs `ventas` | — | Decisión arquitectural |
| **Integraciones** | Cliente Ualá separado | — | Decisión arquitectural |

**Estado post-auditoría:** El frontend queda coherente con la regla **"siempre `empresa_id` en queries de servicios y secciones"**. Falta ejecutar el fix SQL para destrabar el RLS recursion en `profiles` (instrucciones en `SUPABASE_ANALISIS.md`).

---

## 2. Relevamiento

### 2.1 Stack confirmado
- **Build:** Vite 4.5.5
- **UI:** React 18 + Tailwind + shadcn/ui (60+ primitivos) + Framer Motion + Recharts
- **Estado global:** Context API — 4 providers anidados: `Auth → Config → Theme → Caja`
- **Data fetching:** TanStack Query v5 (en `services/*.ts`) + queries directas (en algunas `sections/`)
- **Tipos:** TypeScript en `services/` y `types/`, JSX en el resto
- **Cliente DB:** `@supabase/supabase-js` v2 con cliente único (`customSupabaseClient.js`) + uno secundario inactivo (`ualaSupabaseClient.js`)

### 2.2 Estructura de carpetas (post-auditoría)
```
src/
├── main.jsx · App.jsx · index.css
├── contexts/      ← 4 contextos: Supabase Auth · Config · Caja · Theme
├── lib/           ← supabase client · queryClient · dateUtils · excel · pdf · validation · utils
│                    (eliminado: ualaSupabaseClient.js queda pero documentado como inactivo)
├── services/      ← 10 servicios TS (1 barrel + 9 dominio)
├── hooks/         ← useNotifications · useUserPermissions · use-toast · use-mobile
├── types/         ← index.ts (tipos de dominio)
└── components/
    ├── Auth/Reset/Onboarding/Dashboard/Header/Sidebar/CommandPalette
    ├── sections/  ← 16 secciones (Dashboard, Productos, Ventas, Compras, Caja, Clientes,
    │                CtaCte, Cotizaciones, OC, PlanCuentas, Reportes, Usuarios,
    │                Configuración, MovimientosUala, ClientDetailModal, StaffPermissionsModal)
    ├── caja/      ← CajaApertura · CajaCierre
    ├── ventas/    ← NuevaVentaModal · HistorialVentas · SaleDetailModal · CompraDetailModal · ComprobantePrintModal
    ├── reports/   ← ReportHeader · ReportTable
    └── ui/        ← 60+ primitivos shadcn
```

### 2.3 Tablas Supabase referenciadas (26)
Auth: `profiles` · `empresas`
Config: `configuracion`
Inventario: `productos` · `categorias` · `proveedores` · `movimientos_inventario`
Ventas: `comprobantes` · `comprobante_items` · `ventas` · `detalle_ventas`
Compras: `compras` · `detalle_compras` · `ordenes_compra` · `ordenes_compra_items`
Caja: `caja_sesiones` · `movimientos_caja`
Clientes: `clientes` · `cuenta_corriente_movimientos`
Cotizaciones: `cotizaciones` · `cotizacion_items`
Contabilidad: `plan_cuentas` · `asientos_contables` · `asientos_items` · `periodos_contables`
Integraciones: `movimientos_uala`
Auditoría: `audit_log` (migración 001 — sin uso en frontend)

### 2.4 RPCs y Edge Functions
**RPCs:** `get_my_empresa_id` · `create_tenant` · `seed_plan_cuentas` · `next_cotizacion_number` · `next_oc_number` · `next_numero_asiento` · `increment_stock`
**Edge functions:** `create-user` · `delete-user` (deployadas según CONTEXT.md previo)

---

## 3. Diagnóstico de errores

### 3.1 🔴 Bug crítico: RLS infinite recursion en `profiles` (error `42P17`)

**Síntoma:** cualquier query a `profiles` (login, listado de usuarios, validación de email) explota con `42P17 infinite recursion detected in policy for relation "profiles"`.

**Causa:** la policy `SELECT` de `profiles` referencia a `profiles` directamente (sin pasar por una función `SECURITY DEFINER`), creando un ciclo: la policy ejecuta un sub-`SELECT` sobre `profiles` → ese sub-SELECT re-evalúa la policy → recursión.

**Cascada frontend** (7 puntos de ruptura):
1. `SupabaseAuthContext.fetchProfile` (línea 23–27) → bloquea login completo
2. `SupabaseAuthContext.handleSession` (línea 64) → update `last_login_at` falla silencioso
3. `validationUtils.checkEmailExists` (línea 7) → alta de usuario devuelve falso negativo
4. `UsuariosSection.loadUsers` (línea 98–105) → lista de equipo vacía
5. `UsuariosSection.handleToggleStatus` (línea 256–269) → activar/desactivar usuario falla
6. `StaffPermissionsModal.savePermissions` (línea 64) → guardar permisos falla
7. `CajaSection.fetchUserProfile` (línea 137) → nombre del cajero no aparece

**Fix correcto:** SQL en Supabase (ver `SUPABASE_ANALISIS.md` §3). No requiere cambios en frontend.

### 3.2 🟠 Queries multi-tenant con filtro incorrecto (`user_id` en vez de `empresa_id`)

Detectadas **12 queries en 5 archivos** que filtran por `user_id`. El bug es que `user_id` es el UUID del autor del registro (legacy), no el tenant. Cuando staff distinto del admin consulta, ve cero resultados.

| Archivo | Línea original | Tipo | Fix aplicado |
|---|---|---|---|
| `CajaSection.jsx` | 117 | useEffect guard | `tenant_id` → `empresa_id` ✅ |
| `CajaSection.jsx` | 171 | SELECT movimientos_caja | `user_id` → `empresa_id` ✅ |
| `CajaSection.jsx` | 208 | SELECT movimientos_caja (resumen) | `user_id` → `empresa_id` ✅ |
| `CajaSection.jsx` | 226 | SELECT movimientos_caja (ventas día) | `user_id` → `empresa_id` ✅ |
| `CajaSection.jsx` | 314 | INSERT guard | `tenant_id` → `empresa_id` ✅ |
| `CajaSection.jsx` | 331 | INSERT movimientos_caja | `user_id: user.tenant_id` → `user_id: user.id` + `empresa_id` ✅ |
| `CajaSection.jsx` | 388 | DELETE movimientos_caja | `user_id` → `empresa_id` ✅ |
| `ComprasSection.jsx` | 80 | SELECT proveedores | sin filtro → `empresa_id` ✅ |
| `ComprasSection.jsx` | 91 | SELECT productos | `user_id` → `empresa_id` ✅ |
| `ComprasSection.jsx` | 105 | SELECT compras | `user_id` → `empresa_id` ✅ |
| `ReportesSection.jsx` | 100–188 | 5 reportes SELECT | sin filtro → `empresa_id` ✅ (5 fixes) |
| `MovimientosUala.jsx` | 47 | SELECT movimientos_uala | sin filtro → `empresa_id` ✅ |

**Impacto del bug original:** fuga de datos cross-tenant en `ReportesSection` (cualquier user veía TODOS los reportes de TODAS las empresas si la RLS no estaba activa). En `CajaSection` y `ComprasSection`, staff distinto del admin veía cero datos.

### 3.3 🟡 Inconsistencia: `caja_sesiones` filtra por `tenant_id` (no `empresa_id`)

`CajaContext.fetchCurrentSession` (línea 33) filtra `caja_sesiones` por `tenant_id` (que en KAIROX siempre vale `auth.uid()`). Esto significa que **cada usuario tiene su propia sesión de caja** — un admin no ve la sesión abierta por un cajero.

**Es una decisión arquitectural pendiente:**
- Opción A (actual): caja por-usuario → cada vendedor abre su turno individualmente.
- Opción B (típica PyME): caja por-empresa → una sola caja activa, cualquier cajero registra movimientos en ella.

**No se corrigió** porque depende del modelo de negocio que prefieras. Documentado en `SUPABASE_ANALISIS.md` §5.

### 3.4 Console.log de debug en producción

| Archivo | Líneas | Estado |
|---|---|---|
| `ProductosSection.jsx` | 429, 441 (`Creating provider for empresa`, `Provider Payload`) | ✅ Eliminado |
| `ualaSupabaseClient.js` | 17 (warn legítimo de config) | Mantenido |
| `SupabaseAuthContext.jsx` | 30 (warn de fetch profile) | Mantenido |
| `ComprasSection.jsx` | 361 / `NuevaVentaModal.jsx` 237 (warn asiento contable) | Mantenido (informativos) |

`console.error` aparece en 18 archivos — todos son catch blocks legítimos. No se removieron.

### 3.5 Código muerto detectado

| Archivo | Estado actual | Acción |
|---|---|---|
| `src/pages/HomePage.jsx` | Componente vacío (`<div></div>`), no se importa | ✅ **Eliminado** (también el directorio `pages/`) |
| `src/lib/ualaSupabaseClient.js` | Apunta a un proyecto Supabase secundario (`cgzaiijspgafruytozzk` — proyecto Ualá), pero `MovimientosUala.jsx` no lo usa | Mantenido como referencia. Ver §5 |
| `migrations/001_audit_log.sql` | Tabla `audit_log` creada pero nunca se inserta desde frontend | Mantenido — puede ser usada por triggers futuros |

### 3.6 Race conditions / efectos secundarios

- `CajaContext.fetchCurrentSession` ya tiene guard con `isFetching.ref` ✅
- `SupabaseAuthContext.handleSession` deduplica por `lastProcessedToken` ✅
- `NuevaVentaModal` valida stock con un segundo `select` antes de descontar (line 125) ✅
- No detecté race conditions activas.

---

## 4. Análisis arquitectural

### 4.1 ✅ Buenas decisiones

1. **Separación servicios/componentes:** lógica de queries paginadas vive en `services/*.ts` con TypeScript; los modales y secciones consumen vía hooks de TanStack Query.
2. **Multi-tenant correcto a nivel DB:** todas las tablas nuevas tienen `empresa_id`. La función `get_my_empresa_id()` centraliza la resolución del tenant.
3. **Timezone consistente:** todos los lugares importan `dateUtils.js` y el esquema "AR-local-as-UTC" está bien aplicado.
4. **Auth flow robusto:** maneja recovery, onboarding, sign-up multi-paso, refresh de tokens y staff invitados.
5. **RPC para operaciones críticas:** `create_tenant`, `seed_plan_cuentas`, `next_oc_number` están en SQL con `SECURITY DEFINER`.

### 4.2 🟡 Deuda técnica detectada

#### A. Duplicación de schema — `comprobantes` vs `ventas`

`NuevaVentaModal.jsx` **inserta el mismo registro en ambos sistemas**:
- Líneas 139–148: `comprobantes` + `comprobante_items` (schema nuevo)
- Líneas 176–198: `ventas` + `detalle_ventas` (schema legacy, comentario explícito `"for legacy/dashboard compatibility"`)

**Consumidores actuales:**
| Tabla | Consumidores |
|---|---|
| `comprobantes` | `VentasService`, `HistorialVentas`, `SaleDetailModal`, `CommandPalette` |
| `ventas` | `ReportesSection.handleGenerate('ventas')` |

**Recomendación:** migrar `ReportesSection` a consumir `comprobantes` y deprecar `ventas` / `detalle_ventas`. Quitar el doble insert en `NuevaVentaModal`. Esto requiere:
1. Confirmar que `ReportesSection` no se usa para reportería externa.
2. Backup de datos antes de hacer el cambio.

#### B. Caja: ¿por-usuario o por-empresa?

Ver §3.3. Decisión arquitectural pendiente.

#### C. Cliente Ualá apunta a otro proyecto Supabase

`ualaSupabaseClient.js` referencia `cgzaiijspgafruytozzk` (proyecto separado), pero `MovimientosUala.jsx` lee de la tabla `movimientos_uala` del proyecto **principal** (`wuznppxeonmhfcvnqfbf`). Posibilidades:
1. **Plan original era cliente separado**, pero al final se decidió usar el principal. → eliminar `ualaSupabaseClient.js`.
2. **La integración está parcialmente implementada** → completar uso del cliente secundario en `MovimientosUala.jsx`.

#### D. `audit_log` sin uso

Si no se planea triggear auditoría desde DB, deprecar la tabla o documentar en `SUPABASE_ANALISIS.md` que se reservó para futuro.

### 4.3 🟢 Recomendaciones para escalabilidad (no urgentes)

1. **Centralizar queries a `profiles`** en un único service `profilesService.ts` (hoy hay 7 lugares que la tocan directo).
2. **Migrar gradualmente las `sections/` legacy a usar TanStack Query** (`CajaSection`, `ProductosSection`, `ComprasSection`, `ReportesSection` aún usan `useState + useEffect + fetch`). Reduce bugs de race conditions y simplifica invalidaciones.
3. **Extraer formularios de modales de creación** (NuevaVenta, NuevoCliente, NuevoProducto) a componentes reutilizables — hoy hay duplicación entre `ClientesSection` y el form inline de `CuentaCorrienteSection`.

---

## 5. Cambios aplicados — resumen técnico

### Archivos modificados (5)
1. `src/components/sections/CajaSection.jsx` — 7 fixes multi-tenant + cleanup INSERT
2. `src/components/sections/ComprasSection.jsx` — 3 fixes multi-tenant + guard de `empresa_id`
3. `src/components/sections/ReportesSection.jsx` — 5 fixes multi-tenant (los 5 reportes) + guard
4. `src/components/sections/MovimientosUala.jsx` — fix multi-tenant + guard
5. `src/components/sections/ProductosSection.jsx` — eliminados 2 `console.log` de debug

### Archivos eliminados (1)
- `src/pages/HomePage.jsx` (y directorio `src/pages/` quedó vacío y fue removido)

### Entregables generados (3)
- `AUDITORIA.md` (este archivo)
- `SUPABASE_ANALISIS.md` — schema inferido + SQL fixes
- `CONTEXT.md` — actualizado con la sesión

---

## 6. Próximos pasos sugeridos

### 🔴 URGENTE
1. **Ejecutar SQL del fix RLS recursion** en Supabase SQL Editor (ver `SUPABASE_ANALISIS.md` §3).

### 🟡 Decisiones arquitecturales (te las planteo)
1. **¿Caja por-usuario o por-empresa?** → si elegís por-empresa, hay que migrar `CajaContext` y backfill de `caja_sesiones`.
2. **¿Deprecar `ventas`/`detalle_ventas` y consolidar en `comprobantes`?** → reduce duplicación, simplifica reportes.
3. **¿Cliente Ualá separado o integrado?** → decidir qué hacer con `ualaSupabaseClient.js`.

### 🟢 Optimizaciones (no urgentes)
1. Crear `profilesService.ts` y centralizar todas las queries a `profiles`.
2. Migrar `CajaSection`, `ComprasSection`, `ReportesSection` a TanStack Query.
3. Implementar realtime subscriptions también en Productos y Ventas (ya está en OC).

---

**Conclusión:** el sistema está en muy buen estado estructural. Los 12 fixes aplicados eliminan las inconsistencias multi-tenant más visibles. El único bloqueador restante para "100% estable" es el RLS recursion, que requiere ejecutar el SQL del archivo `SUPABASE_ANALISIS.md`.
