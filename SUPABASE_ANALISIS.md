# SUPABASE — Análisis del schema y RLS
**Fecha:** 2026-06-03
**Proyecto principal:** `wuznppxeonmhfcvnqfbf` (NALUX — São Paulo, sa-east-1)
**Proyecto secundario (Ualá, inactivo en código):** `cgzaiijspgafruytozzk`
**Migrations aplicadas a mano (sin Supabase CLI):** 001–004 + 006–008. La 005 (`configuracion_rls_fix`) existe en un worktree antiguo pero **no figura en master**.

> ⚠️ **NO se ejecutó ningún cambio en Supabase durante esta auditoría.** Todo lo que sigue es análisis + SQL recomendado para que vos lo ejecutes manualmente.

---

## 1. Schema inferido desde código frontend

### 1.1 Auth / Multi-tenant

#### `empresas`
```sql
id            uuid PK default gen_random_uuid()
nombre        text NOT NULL
created_at    timestamptz default now()
```
**RLS:** asumida `empresa_id = get_my_empresa_id()` para SELECT.

#### `profiles`
```sql
id            uuid PK references auth.users(id) ON DELETE CASCADE
empresa_id    uuid references empresas(id) ON DELETE CASCADE
role          text default 'staff' check (role in ('admin','staff'))
first_name    text
last_name     text
email         text
permissions   jsonb default '{}'  -- granular para staff
active        boolean default true
last_login_at timestamptz
created_at    timestamptz default now()
```
**RLS:** 🔴 **rota** (recursion). Ver §3.

### 1.2 Configuración
#### `configuracion`
```sql
empresa_id    uuid references empresas(id)
clave         text
valor         text
PRIMARY KEY (empresa_id, clave)
```
Claves usadas: `nombre_empresa`, `company_logo`, `logo_base64`, `modulos_activos` (JSON), `oc_requiere_aprobacion` (`'true'`/`'false'`).

### 1.3 Inventario
#### `productos`
```sql
id              uuid PK
empresa_id      uuid
user_id         uuid  -- legacy: id del auth user que lo creó
nombre, codigo_sku, descripcion, unidad_medida
costo_compra    numeric
precio_venta    numeric
stock_actual    numeric
stock_minimo    numeric
categoria_id    uuid → categorias
proveedor_id    uuid → proveedores
activo          boolean default true  -- soft delete
fecha_creacion  timestamptz
```

#### `categorias` / `proveedores`
Tablas planas con `id`, `nombre`, `empresa_id`, `created_at`. Proveedores agrega `contacto, telefono, email, direccion`.

#### `movimientos_inventario`
```sql
id, empresa_id, tenant_id (legacy), producto_id
tipo            text check in ('entrada','salida','ajuste')
cantidad        numeric
motivo          text
fecha           timestamptz
```

### 1.4 Ventas — **duplicación legacy + nueva**

#### `comprobantes` (schema nuevo, usado por VentasService, HistorialVentas, CmdPalette)
```sql
id, empresa_id, tenant_id (legacy)
numero_venta    text  -- formato YYYYMMDD-NNN
fecha           timestamptz
cliente_id      uuid? → clientes
cliente_nombre  text
total           numeric
forma_pago      text
```

#### `comprobante_items`
```sql
id, comprobante_id, empresa_id, producto_id
cantidad, precio_unitario, subtotal
```

#### `ventas` (schema legacy — solo usado por ReportesSection)
```sql
id, user_id, empresa_id
fecha, cliente, cliente_id, metodo_pago, subtotal, descuento, total
```

#### `detalle_ventas`
```sql
id, venta_id, empresa_id, producto_id, cantidad, precio_unitario, subtotal
```

**Recomendación:** ver `AUDITORIA.md` §4.2.A — deprecar `ventas`/`detalle_ventas`.

### 1.5 Compras
#### `compras`
```sql
id, user_id, empresa_id, proveedor_id
fecha, numero_factura, total, forma_pago, estado_pago
```

#### `detalle_compras`
```sql
id, compra_id, empresa_id, producto_id, cantidad, costo_unitario, subtotal
```

### 1.6 Caja
#### `caja_sesiones`
```sql
id, user_id, tenant_id, empresa_id, abierto_por, cerrado_por
estado            text check in ('abierta','cerrada')
monto_inicial, monto_final_real, monto_final_esperado, diferencia
apertura_fecha, cierre_fecha
observaciones
```

#### `movimientos_caja`
```sql
id, user_id, empresa_id, caja_sesion_id?
tipo             text check in ('ingreso','egreso')
categoria        text  -- 'Venta','Cobro','Compra','Apertura', etc.
concepto, monto, fecha, metodo_pago
is_automatic     boolean
```

### 1.7 Clientes / Cuenta Corriente
#### `clientes`
```sql
id, user_id, empresa_id
nombre, documento, telefono, email, direccion
limite_credito, saldo_actual
activo  -- soft delete
created_at
```

#### `cuenta_corriente_movimientos`
```sql
id, user_id (legacy, deprecable), empresa_id, cliente_id
tipo           text check in ('DEBE','HABER')
monto, descripcion, fecha, created_at
```
**RLS aplicada via migration 007:** policy `cta_cte_empresa` por `empresa_id = get_my_empresa_id()` ✅.

### 1.8 Cotizaciones / OC (igual a comprobantes/compras pero con flujo de estados)
- `cotizaciones` / `cotizacion_items` con RPC `next_cotizacion_number`.
- `ordenes_compra` / `ordenes_compra_items` con RPC `next_oc_number`. Estados: `pendiente_aprobacion → borrador → enviada → recibida_parcial → recibida / cancelada` (migration 008).

### 1.9 Contabilidad
- `plan_cuentas` (árbol jerárquico activo/pasivo/patrimonio/ingreso/egreso).
- `asientos_contables` (libro diario con estado `borrador/confirmado/anulado`).
- `asientos_items` (líneas DEBE/HABER).
- `periodos_contables` (PK `(empresa_id, anio, mes)`, flag `cerrado`).

### 1.10 Integraciones
- `movimientos_uala` — alimentada por Google Apps Script externo. **Debe tener `empresa_id`** (el frontend ahora lo filtra). Si no la tiene, agregar columna + backfill.

### 1.11 Auditoría
- `audit_log` (migration 001) — sin uso desde frontend.

---

## 2. RPCs y funciones

| Función | SECURITY | Uso | Notas |
|---|---|---|---|
| `get_my_empresa_id()` | **DEBE SER `SECURITY DEFINER STABLE`** | RLS de todas las tablas multi-tenant | Si NO es definer → causa la recursion |
| `create_tenant(nombre_empresa, first_name, last_name)` | `SECURITY DEFINER` ✅ | Onboarding | OK |
| `seed_plan_cuentas(empresa_id)` | `SECURITY DEFINER` ✅ | Inicialización contable | OK |
| `next_cotizacion_number(empresa_id)` | — (asumida) | Correlativos | Verificar atomicidad |
| `next_oc_number(empresa_id)` | — (asumida) | Correlativos | Verificar atomicidad |
| `next_numero_asiento(empresa_id)` | — (asumida) | Correlativos | Verificar atomicidad |
| `increment_stock(row_id, quantity)` | — | Stock atómico desde ComprasSection | OK si está bien implementada |

---

## 3. 🔴 Fix del RLS infinite recursion en `profiles`

### Diagnóstico
La policy actual de `profiles` (probable) se ve así:

```sql
-- ❌ MALA — provoca recursion
CREATE POLICY profiles_select ON profiles FOR SELECT USING (
  id = auth.uid()
  OR empresa_id IN (SELECT empresa_id FROM profiles WHERE id = auth.uid())
);
```

El sub-`SELECT FROM profiles` re-dispara la policy → loop infinito → error `42P17`.

### Fix recomendado

```sql
-- =============================================================================
-- FIX: RLS recursion en profiles
-- Ejecutar en: SQL Editor del proyecto wuznppxeonmhfcvnqfbf
-- =============================================================================

-- 1. Función helper para resolver mi empresa SIN gatillar RLS recursiva
CREATE OR REPLACE FUNCTION public.get_my_empresa_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER          -- ← bypassea RLS
STABLE                    -- ← cacheable por query
SET search_path = public
AS $$
  SELECT empresa_id
  FROM public.profiles
  WHERE id = auth.uid()
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.get_my_empresa_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_empresa_id() TO authenticated;

-- 2. Dropear policies viejas de profiles
DROP POLICY IF EXISTS "profiles_select"  ON public.profiles;
DROP POLICY IF EXISTS "profiles_update"  ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert"  ON public.profiles;
DROP POLICY IF EXISTS "Enable all for self" ON public.profiles;
DROP POLICY IF EXISTS "Enable read access for tenant" ON public.profiles;

-- 3. Policies nuevas SIN auto-referencia
-- SELECT: el user puede ver su propio perfil O todos los perfiles de su empresa
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT
  USING (
    id = auth.uid()
    OR empresa_id = public.get_my_empresa_id()
  );

-- UPDATE: solo el propio perfil O un admin de la misma empresa
CREATE POLICY profiles_update ON public.profiles
  FOR UPDATE
  USING (
    id = auth.uid()
    OR (
      empresa_id = public.get_my_empresa_id()
      AND EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'admin'
      )
    )
  )
  WITH CHECK (
    id = auth.uid()
    OR empresa_id = public.get_my_empresa_id()
  );

-- INSERT: lo maneja create_tenant + edge function create-user
CREATE POLICY profiles_insert ON public.profiles
  FOR INSERT
  WITH CHECK (id = auth.uid());

-- 4. Garantizar que RLS está activa
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
```

**Por qué funciona:** `get_my_empresa_id()` con `SECURITY DEFINER` se ejecuta con privilegios del owner de la función, **saltando la policy de `profiles`** — por lo tanto el sub-SELECT no re-dispara la policy. Ciclo roto.

### Test post-fix (queries a ejecutar en el SQL Editor logueado como usuario auth)
```sql
-- 1. Resolver mi empresa
SELECT public.get_my_empresa_id();

-- 2. Mi perfil
SELECT * FROM profiles WHERE id = auth.uid();

-- 3. Equipo de mi empresa
SELECT id, first_name, last_name, role, active FROM profiles WHERE empresa_id = public.get_my_empresa_id();
```
Si las 3 queries devuelven datos sin error `42P17`, el fix funcionó.

---

## 4. Otras RLS que conviene revisar

### `movimientos_uala`
El frontend post-auditoría filtra por `empresa_id`. Confirmar que la tabla tenga la columna y una policy análoga:

```sql
ALTER TABLE public.movimientos_uala
  ADD COLUMN IF NOT EXISTS empresa_id uuid REFERENCES public.empresas(id) ON DELETE CASCADE;

DROP POLICY IF EXISTS "uala_all" ON public.movimientos_uala;

CREATE POLICY uala_empresa ON public.movimientos_uala
  FOR ALL
  USING      (empresa_id = public.get_my_empresa_id())
  WITH CHECK (empresa_id = public.get_my_empresa_id());

ALTER TABLE public.movimientos_uala ENABLE ROW LEVEL SECURITY;
```
**Importante:** si el Google Apps Script de Ualá inserta con `service_role`, se salta RLS, pero igual debe popular `empresa_id` (con la del tenant correspondiente).

### `audit_log`
Si seguís sin usarlo, dejarlo con RLS estricta (`FOR ALL USING (false)`) para que ningún cliente lea/escriba accidentalmente. Si planeás triggers de auditoría, definir policy.

### Resto de tablas
Las migraciones aplicadas (003 OC, 004 plan_cuentas, 007 cta_cte, 008 períodos) ya incluyen policies basadas en `get_my_empresa_id()`. **Con el fix de §3 todas pasan a funcionar correctamente** porque la función deja de provocar recursion.

---

## 5. Decisiones pendientes

### 5.1 `caja_sesiones`: ¿por usuario o por empresa?
| Aspecto | Por-usuario (actual) | Por-empresa (alternativa) |
|---|---|---|
| Filtro de `fetchCurrentSession` | `tenant_id = auth.uid()` | `empresa_id = get_my_empresa_id() AND estado='abierta'` |
| Movimientos | Asociados a la sesión del cajero | Compartidos |
| Cierre | Cada cajero cierra el suyo | Cualquier admin cierra la global |
| Recomendación PyME típica | — | ✅ |

**Si elegís migrar a por-empresa:**
```sql
-- 1. UPDATE: cerrar todas las sesiones abiertas viejas, dejar 1 por empresa.
-- 2. Crear índice único:
CREATE UNIQUE INDEX IF NOT EXISTS uq_caja_sesion_abierta_por_empresa
  ON public.caja_sesiones(empresa_id)
  WHERE estado = 'abierta';
-- 3. Cambiar CajaContext.fetchCurrentSession a filtrar por empresa_id.
```

### 5.2 Deprecación de `ventas` / `detalle_ventas`
**Pasos sugeridos** (en orden):
1. Migrar `ReportesSection.handleGenerate('ventas')` a leer de `comprobantes` + `comprobante_items` (mismos campos, distinto nombre).
2. Eliminar el segundo INSERT en `NuevaVentaModal` (líneas 175–198).
3. Backup de `ventas`/`detalle_ventas`.
4. `DROP TABLE` ambas.

### 5.3 Integración Ualá
**Opciones:**
- **A.** Eliminar `ualaSupabaseClient.js` y dejar `MovimientosUala.jsx` apuntando a la tabla `movimientos_uala` del proyecto principal. Más simple. Recomendado si la integración ya funciona.
- **B.** Completar uso del cliente secundario: importar `ualaSupabase` en `MovimientosUala.jsx`. Útil solo si querés aislar la integración por razones de seguridad/billing.

---

## 6. Schema completo en una tabla

| Tabla | Tenant key | RLS | Usada en código | Observación |
|---|---|---|---|---|
| `empresas` | `id` | ✅ | Auth join | OK |
| `profiles` | `id` + `empresa_id` | 🔴 recursion | Auth, Usuarios | **Fix §3 urgente** |
| `configuracion` | `empresa_id` | ✅ (migration 005, pendiente en master) | ConfigContext | Verificar policy en producción |
| `productos` | `empresa_id` | ✅ | 8 lugares | OK post-auditoría |
| `categorias` | `empresa_id` | ✅ | Productos | OK |
| `proveedores` | `empresa_id` | ✅ | Productos, OC, Compras | OK post-auditoría |
| `movimientos_inventario` | `empresa_id` | ✅ | Productos, NuevaVenta, Compras | OK |
| `comprobantes` | `empresa_id` | ✅ | Ventas, HistorialVentas | OK |
| `comprobante_items` | `empresa_id` | ✅ | NuevaVenta, SaleDetail | OK |
| `ventas` | `empresa_id` | ✅ | NuevaVenta + Reportes | 🟡 Duplicado con comprobantes |
| `detalle_ventas` | `empresa_id` | ✅ | NuevaVenta + Reportes | 🟡 Duplicado |
| `compras` | `empresa_id` | ✅ | Compras, Reportes | OK post-auditoría |
| `detalle_compras` | `empresa_id` | ✅ | Compras | OK |
| `caja_sesiones` | `tenant_id` actual / `empresa_id` recomendado | ✅ | CajaContext | 🟡 Ver §5.1 |
| `movimientos_caja` | `empresa_id` | ✅ | Caja, NuevaVenta, Compras, Dashboard, Reportes | OK post-auditoría |
| `clientes` | `empresa_id` | ✅ | Clientes, NuevaVenta, CtaCte | OK |
| `cuenta_corriente_movimientos` | `empresa_id` (migration 007) | ✅ | CtaCte, ClientDetail | OK |
| `cotizaciones` | `empresa_id` | ✅ | Cotizaciones | OK |
| `cotizacion_items` | (FK) | ✅ | Cotizaciones | OK |
| `ordenes_compra` | `empresa_id` | ✅ (migration 008) | OC | OK |
| `ordenes_compra_items` | (FK) | ✅ | OC | OK |
| `plan_cuentas` | `empresa_id` | ✅ (migration 004) | PlanCuentas | OK |
| `asientos_contables` | `empresa_id` | ✅ | PlanCuentas, asientos auto | OK |
| `asientos_items` | `empresa_id` | ✅ | PlanCuentas | OK |
| `periodos_contables` | `empresa_id` (migration 008) | ✅ | PlanCuentas | OK |
| `movimientos_uala` | `empresa_id` (a confirmar) | ⚠️ A verificar | MovimientosUala | Ver §4 |
| `audit_log` | `empresa_id` | ⚠️ A bloquear | (no usado) | Ver §4 |

---

## 7. Checklist post-fix

Después de ejecutar el SQL de §3, verificar que:
- [ ] Login funciona normalmente
- [ ] `last_login_at` se actualiza al loguear
- [ ] `UsuariosSection` lista a todo el equipo de la empresa
- [ ] Crear nuevo usuario via edge function funciona
- [ ] `validationUtils.checkEmailExists` deja de tirar 42P17
- [ ] `CajaSection` muestra el nombre del cajero en el header
- [ ] `StaffPermissionsModal` guarda los permisos

Si todo OK → sistema 100% estable.
