# Diseño — Publicar catálogo KAIROX → Tiendanube (doble sentido de productos)

> **Estado:** DISEÑO, sin construir. Sketch de arquitectura para que Nadia lo
> implemente en su carril de integraciones (ROADMAP.md). Pedido por Luciano el
> 2026-07-22 mientras cerraba el adapter Tiendanube: hoy la integración es de un
> solo sentido (TN → KAIROX: leer catálogo, importar pedidos, empujar stock);
> falta el sentido inverso **crear/actualizar productos en Tiendanube desde
> KAIROX**, para que el comercio arme el catálogo en KAIROX y lo publique.
>
> **Esfuerzo estimado: 2-3 días.** No es un ajuste — es un feature nuevo con su
> propia máquina de estados, manejo de imágenes y resolución de conflictos.

---

## Qué NO cambia (ya existe y se reutiliza tal cual)

- **`_shared/integraciones.ts`** — Vault para tokens, `leerTokenCanal()`. No se toca.
- **Patrón cola + trigger + pg_cron** — el mismo de `integraciones_stock_pendiente`
  + `fn_queue_stock_tiendanube` + `tiendanube-stock-worker` (mig.233) y de
  `facturas_pendientes_arca` + `arca-worker`. Es el patrón a copiar: cola async
  con reintentos/backoff, no bloquea la operación del usuario.
- **`integraciones_producto_mapeo`** — la tabla de mapeo YA vincula
  `producto_id` (KAIROX) ↔ `external_id` (variante TN) / `external_product_id`
  (producto padre TN). Cuando publicamos un producto nuevo, el worker
  **rellena esas columnas con los IDs que devuelve Tiendanube al crearlo** —
  o sea, publicar es lo que *crea* el mapeo, en vez de que el usuario lo elija a mano.

---

## Decisión de negocio a confirmar ANTES de codear (bloqueante)

**¿Quién es la fuente de verdad del catálogo?** El diseño de abajo asume
**KAIROX es la fuente de verdad de los productos que él publica** (dirección
única KAIROX → TN para nombre/precio/descripción/fotos). Esto evita el problema
más difícil de una sincronización bidireccional real (dos lados editan el mismo
campo → ¿cuál gana?). El stock sigue como está (KAIROX → TN, mig.233).

Si el comercio también edita el producto en el panel de Tiendanube, esos cambios
**no vuelven** a KAIROX en esta primera versión (se sobrescriben en el próximo
push). Eso es aceptable y es como arrancan casi todos los conectores; la
sincronización de campos bidireccional con resolución de conflictos es una V2.

---

## Modelo de datos (nueva migración)

Espejo de `integraciones_stock_pendiente`, pero para el catálogo:

```sql
-- cola de publicaciones de producto pendientes (KAIROX → TN)
create table public.integraciones_producto_pendiente (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references empresas(id),
  integracion_id uuid not null references integraciones_canales(id),
  producto_id    uuid not null references productos(id),
  operacion      text not null check (operacion in ('crear','actualizar')),
  estado         text not null default 'pendiente'
                   check (estado in ('pendiente','procesando','ok','error')),
  intentos       int  not null default 0,
  error_mensaje  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
-- índice parcial de idempotencia: un solo pendiente por producto+operación
create unique index uq_producto_pendiente
  on integraciones_producto_pendiente (producto_id, operacion)
  where estado in ('pendiente','procesando');
```

> ⚠️ **Trampa ya conocida (mig.233):** `ON CONFLICT ON CONSTRAINT` NO funciona
> con índice único PARCIAL. Usar `ON CONFLICT (producto_id, operacion)
> WHERE estado in ('pendiente','procesando') DO NOTHING`.

**Flag en el mapeo / producto:** hace falta marcar qué productos se publican en
qué canal. Opción simple: agregar `publicar_en_canal boolean` a
`integraciones_producto_mapeo` — pero el mapeo hoy nace al importar de TN. Para
productos que NACEN en KAIROX y todavía no existen en TN no hay fila de mapeo aún.
**Solución:** el trigger encola cuando el producto tiene una fila de mapeo con un
nuevo flag `publicar boolean default false`; si no existe mapeo pero el usuario
tildó "publicar en Tiendanube" desde la UI, se crea la fila de mapeo con
`external_id=null` (todavía sin publicar) y `publicar=true`. El worker, al crear
el producto en TN, completa `external_id`/`external_product_id`.

---

## Backend — nueva edge function `tiendanube-catalogo-worker`

Modelada 1:1 sobre `tiendanube-stock-worker`. Corre por pg_cron cada 5 min
(o se puede invocar a mano para probar). Por cada fila `pendiente`:

1. Marca `procesando`, `intentos+1`.
2. Lee el producto de KAIROX (nombre, precio, descripción, stock, fotos,
   variantes/unidades).
3. Lee el token del canal (`leerTokenCanal`).
4. **Mapea el producto KAIROX al shape de la API de Tiendanube** (ver abajo).
5. `operacion='crear'` → `POST /products`; `operacion='actualizar'` →
   `PUT /products/{external_product_id}`.
6. Si `crear` fue ok: guarda `external_product_id` + `external_id` (variante)
   en `integraciones_producto_mapeo`.
7. Sube imágenes: `POST /products/{id}/images` (una por foto; ver nota de imágenes).
8. `ok` o `error` (con `error_mensaje`); 5xx de TN → dejar `pendiente` para reintento.

### Mapeo de campos KAIROX → Tiendanube (`POST /products`)

| KAIROX | Tiendanube API | Nota |
|--------|----------------|------|
| `productos.nombre` | `name` (objeto `{es: ...}`) | TN usa nombres por idioma |
| `productos.descripcion` | `description` (`{es: ...}`) | HTML permitido |
| `productos.precio_venta` | `variants[].price` | string |
| `productos.stock_actual` | `variants[].stock` | ya cubierto por mig.233 después |
| `productos.codigo` / SKU | `variants[].sku` | clave para auto-match futuro |
| `productos.codigo_barras` | `variants[].barcode` | |
| unidades/pack (mig.189) | `variants[]` múltiples | 1 variante por unidad de venta |
| fotos (ver abajo) | `POST /products/{id}/images` | endpoint aparte, no inline |

### Imágenes — el punto más espinoso
- KAIROX hoy guarda logo de empresa como base64 en `configuracion`. **Las fotos
  de producto: revisar si existen y en qué formato** (bucket `storage` mig.223, o
  ninguna todavía). Si no hay fotos de producto en KAIROX, la V1 puede publicar
  **sin imágenes** y dejar que el comercio las suba en TN — acota mucho el scope.
- Si hay fotos: Tiendanube acepta `src` (URL pública) o `attachment` (base64).
  Con URL pública del bucket de Supabase es lo más limpio.
- **Recomendación V1: publicar sin imágenes**, y las imágenes como iteración
  aparte. Reduce el build de ~3 días a ~1.5.

---

## Trigger de encolado

`fn_queue_publicar_tiendanube` sobre `productos` (AFTER INSERT OR UPDATE):
- Encola `operacion='crear'` si el producto está marcado para publicar y NO tiene
  `external_product_id` en su mapeo.
- Encola `operacion='actualizar'` si ya tiene `external_product_id` y cambió un
  campo publicable (nombre/precio/descripción). **Ojo:** el stock NO debe disparar
  este trigger (ya lo maneja `fn_queue_stock_tiendanube`) — filtrar por columnas.
- Bypass service_role igual que los otros triggers (no encolar en operaciones
  internas del sistema).

---

## UI — mínimo

- En `MapeoProductosModal.jsx` (o una card nueva en Configuración → Integraciones):
  un tilde **"Publicar en Tiendanube"** por producto, separado del de stock.
- Estado visible: "Publicado ✓" / "Pendiente" / "Error" leyendo
  `integraciones_producto_pendiente.estado` (mismo patrón que el Monitor AFIP).
- Acción "Reintentar" para las filas en error.

---

## Orden de implementación sugerido (para Nadia)

1. **Confirmar con Luciano** la decisión de fuente de verdad (arriba) y si V1 va
   **sin imágenes** (recomendado).
2. Migración: tabla `integraciones_producto_pendiente` + flag `publicar` en mapeo
   + trigger de encolado. Probar con dry-run BEGIN...ROLLBACK.
3. Edge function `tiendanube-catalogo-worker` + pg_cron. Probar `crear` contra la
   tienda demo con UN producto real de KAIROX (verificar que aparece en el panel TN
   y que se completó `external_product_id` en el mapeo).
4. Probar `actualizar` (cambiar el precio en KAIROX → ver que cambia en TN).
5. UI (tilde + estados + reintentar).
6. Recién entonces, imágenes (si se decide incluirlas).

---

## Riesgos / notas

- **Seguridad (seguridad-dev):** el worker corre con service_role; el trigger
  debe filtrar tenant correctamente y no encolar productos de otra empresa. Token
  de TN siempre desde Vault, nunca en tabla. RLS admin-only en la cola nueva.
- **Rate limits de Tiendanube:** la API tiene límite; el worker procesa en lote
  con un cap por corrida (ej. 20 productos) igual que el stock-worker, no todo de golpe.
- **No es sincronización bidireccional real** — es publicación unidireccional
  KAIROX → TN. La V2 (traer ediciones de TN de vuelta + resolución de conflictos)
  es otro proyecto; NO prometerlo como "doble sentido completo".
