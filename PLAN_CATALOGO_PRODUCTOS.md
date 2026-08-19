# Plan de desarrollo — Catálogo maestro de productos (búsqueda por código de barra / nombre)

**Estado:** 🟡 PROPUESTO — pendiente de revisión con Luciano. Nada construido todavía.
**Origen:** sesión 2026-08-19 con Nadia — pedido de investigar fuentes de códigos de barra en Argentina para que el alta de producto se resuelva buscando por nombre o escaneando, en vez de tipear todo a mano.

---

## 1. Problema que resuelve

Hoy, cada empresa que arranca con KAIROX tiene que cargar su catálogo producto por producto: nombre, código de barra, categoría, unidad de medida — todo a mano. Para una ferretería o un almacén con 300-500 ítems, esto son horas de carga antes de poder facturar la primera venta. Es fricción de onboarding pura, y es el motivo típico de abandono de una prueba gratuita en cualquier ERP/POS.

La solución ideal sería: el cliente escanea o tipea el nombre, el sistema le trae nombre/marca/categoría ya completos, confirma, listo. El lector de código de barra (físico y por cámara) ya está construido y funcionando — lo que falta es *qué hay del otro lado* cuando se escanea un código que el sistema todavía no conoce.

## 2. Investigación de fuentes — resumen

Se evaluaron 6 fuentes posibles. Ninguna por sí sola resuelve el problema completo — el hallazgo central es que **no existe una fuente única, gratuita y completa** de "todos los productos comercializados en Argentina". Detalle de cada una:

| Fuente | Costo | Cobertura real | Sirve para |
|---|---|---|---|
| **GS1 Argentina** (Verified by GS1) | Membresía desde ~$26.000/mes (monotributista, sube con facturación) | Depende de que cada marca haya cargado su producto voluntariamente — no es automático ni completo | Cualquier rubro, en teoría, si la marca se registró |
| **Open Food Facts** | Gratis, sin autenticación para lectura | +4.000.000 de productos mundiales, 2.068 marcas ya etiquetadas "Argentina" en el sitio | Almacén: alimentos, bebidas, limpieza, perfumería |
| **Open Products Facts** (hermano de OFF para no-alimentos) | Gratis | Solo 44.300 productos **en total, de todo el mundo** — prácticamente vacía | Nada relevante para nosotros hoy |
| **EAN-search.org** | De pago (planes desde consulta individual hasta suscripción) | +1.200 millones de EAN en base, pero cobertura real de productos *argentinos con nombre cargado* es una incógnita | Fallback internacional, no evaluado a fondo |
| **Barcode Lookup / product-search.net** | Desde gratis (100 req/mes) hasta 39 €/mes (50.000 req/mes) | Similar a EAN-search, centrado en mercado EE.UU./Europa | Fallback internacional, no evaluado a fondo |
| **UPCitemdb** | Gratis 100 req/día, planes pagos arriba de eso | +724 millones de códigos, pero centrado en mercado estadounidense | Cobertura Argentina probablemente muy baja |

**Confirmación de que no hay atajo:** en un foro de desarrolladores argentinos, alguien preguntó exactamente esto mismo hace unos años — si existía una tabla con todos los artículos comercializados en el país para no cargarlos a mano. La respuesta de la comunidad, usando ferretería como ejemplo puntual: cada proveedor tiene su propia base con su propia codificación (a diferencia de los productos alimenticios, que sí están más estandarizados), y esas bases las tienen los grandes mayoristas (mencionaron a Toledo y Maxiconsumo) pero no son accesibles públicamente. La única vía "oficial" sugerida fue GS1 directamente.

**Conclusión de la investigación:** para el vertical almacén, Open Food Facts es una base sólida y gratuita. Para ferretería y distribuidora, ninguna fuente externa gratuita sirve — ahí la jugada tiene que ser otra (ver sección 3).

## 3. Decisiones de diseño (para validar con Luciano)

1. **No se paga GS1 por ahora.** Sin clientes reales pagando todavía, no se justifica el compromiso mensual. Se revisita cuando haya datos reales de cuánto "no se encuentra ni en catálogo propio ni en Open Food Facts" (ver sección 6, fase D).

2. **KAIROX construye su propio catálogo compartido entre tenants**, que se autoalimenta con cada producto que cualquier cliente carga. Es la jugada de mediano plazo que sí resuelve el problema de forma sostenible: cuantos más clientes usan el sistema, más rico se pone el catálogo, sin depender pura y exclusivamente de fuentes externas.

3. **Excepción consciente al principio de multi-tenancy.** La tabla nueva (`catalogo_maestro_productos`) **no lleva `empresa_id`** y es de lectura compartida entre todos los tenants — a propósito, no es un descuido. La razón: no contiene ningún dato de negocio del cliente (nada de precio, stock, proveedor ni margen), solo metadata pública de catálogo (código de barra + nombre + marca), equivalente a un diccionario compartido. El aislamiento real de cada empresa sigue intacto en `productos`, que es donde vive el dato de negocio. Ninguna empresa puede ver qué otra empresa cargó tal producto — el dato queda anónimo respecto del tenant de origen.

4. **Estrategia distinta por vertical:**
   - **Almacén:** Open Food Facts como fuente externa (gratis, con cobertura real).
   - **Ferretería / distribuidora / mayorista:** sin fuente externa confiable — se arranca con un seed catalog curado a mano (300-500 ítems típicos del rubro) y se deja crecer con el uso real.

## 4. Arquitectura

```
Cliente escanea o tipea un producto
        │
        ▼
Edge Function "producto-lookup"
        │
        ├──► 1. Busca en catalogo_maestro_productos (propio, gratis, instantáneo)
        │        │
        │        └─ si hay match → devuelve, FIN
        │
        ├──► 2. Si no hay match y es código de barra → GET Open Food Facts
        │        │
        │        └─ si hay match → devuelve (fuente='open_food_facts'), FIN
        │
        └──► 3. Nada encontrado → frontend muestra alta manual,
                 precargada con el código escaneado

Al confirmar el alta (venga de donde venga) → se registra en
catalogo_maestro_productos → el próximo tenant que busque ese
código ya lo encuentra en el paso 1, sin salir de KAIROX.
```

### 4.1 Migración de base de datos

```sql
-- Tabla compartida entre tenants — ver decisión de diseño #3 más arriba.
-- No lleva empresa_id a propósito: es catálogo público de referencia, no dato de negocio.
CREATE TABLE public.catalogo_maestro_productos (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo_barras         TEXT NOT NULL UNIQUE,
  nombre                TEXT NOT NULL,
  marca                 TEXT,
  categoria_sugerida    TEXT,   -- texto libre: las categorías reales son por tenant (categorias.id),
                                 -- esta tabla cross-tenant no puede referenciar una FK tenant-scoped
  unidad_medida_sugerida TEXT NOT NULL DEFAULT 'Unidad',
  imagen_url            TEXT,
  vertical              TEXT,   -- 'almacen' | 'ferreteria' | 'distribuidora' | 'mayorista' | NULL
  fuente                TEXT NOT NULL DEFAULT 'carga_usuario'
                          CHECK (fuente IN ('carga_usuario', 'open_food_facts', 'seed_vertical')),
  veces_confirmado      INTEGER NOT NULL DEFAULT 1,  -- +1 cada vez que otro tenant carga el mismo código
  fecha_creacion        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fecha_actualizacion   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.catalogo_maestro_productos ENABLE ROW LEVEL SECURITY;

-- Lectura abierta a cualquier usuario autenticado (catálogo público de referencia)
CREATE POLICY catalogo_maestro_select ON public.catalogo_maestro_productos
  FOR SELECT TO authenticated USING (true);

-- Sin políticas de INSERT/UPDATE directas — solo se escribe vía RPC (SECURITY DEFINER) más abajo,
-- mismo criterio ya usado en puntos_venta_numeracion (mig. 273).
```

### 4.2 RPCs

```sql
-- Búsqueda: por código exacto o por nombre (fuzzy, requiere pg_trgm — ya se puede estar usando
-- en el proyecto para otros autocompletados, confirmar con Luciano antes de agregar la extensión)
CREATE OR REPLACE FUNCTION buscar_producto_catalogo(
  p_codigo_barras TEXT DEFAULT NULL,
  p_query TEXT DEFAULT NULL
) RETURNS SETOF catalogo_maestro_productos AS $$
  SELECT * FROM catalogo_maestro_productos
  WHERE (p_codigo_barras IS NOT NULL AND codigo_barras = p_codigo_barras)
     OR (p_query IS NOT NULL AND nombre ILIKE '%' || p_query || '%')
  ORDER BY veces_confirmado DESC
  LIMIT 10;
$$ LANGUAGE sql STABLE;

-- Registro / retroalimentación del catálogo compartido
CREATE OR REPLACE FUNCTION registrar_producto_catalogo(
  p_codigo_barras TEXT,
  p_nombre TEXT,
  p_marca TEXT DEFAULT NULL,
  p_categoria TEXT DEFAULT NULL,
  p_vertical TEXT DEFAULT NULL,
  p_fuente TEXT DEFAULT 'carga_usuario'
) RETURNS void AS $$
BEGIN
  IF p_codigo_barras IS NULL OR p_nombre IS NULL THEN
    RETURN; -- no rompe el alta del producto en el tenant si faltan datos para el catálogo
  END IF;

  INSERT INTO catalogo_maestro_productos (codigo_barras, nombre, marca, categoria_sugerida, vertical, fuente)
  VALUES (p_codigo_barras, p_nombre, p_marca, p_categoria, p_vertical, p_fuente)
  ON CONFLICT (codigo_barras) DO UPDATE
    SET veces_confirmado = catalogo_maestro_productos.veces_confirmado + 1,
        fecha_actualizacion = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

```sql
-- Trigger para que la retroalimentación sea automática (no depende de que el frontend
-- se acuerde de llamar al RPC — cubre también altas por CSV import).
CREATE OR REPLACE FUNCTION trg_retroalimentar_catalogo_maestro()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.codigo_barras IS NOT NULL AND NEW.nombre IS NOT NULL THEN
    PERFORM registrar_producto_catalogo(NEW.codigo_barras, NEW.nombre, NULL, NULL, NULL, 'carga_usuario');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_productos_retroalimenta_catalogo
  AFTER INSERT OR UPDATE OF codigo_barras ON public.productos
  FOR EACH ROW EXECUTE FUNCTION trg_retroalimentar_catalogo_maestro();
```

### 4.3 Edge Function `producto-lookup` (Deno, mismo patrón que `tc-diario-sync`)

Pseudocódigo:

```ts
// Recibe { codigo_barras? , query? } — al menos uno de los dos

// 1. Catálogo propio primero — gratis, instantáneo, no depende de nadie externo
const propio = await supabase.rpc('buscar_producto_catalogo', {
  p_codigo_barras: codigo_barras ?? null,
  p_query: query ?? null,
});
if (propio.length > 0) {
  return { encontrado: true, resultados: propio };
}

// 2. Si no hay match y viene un código de barra (no una búsqueda de texto libre) → Open Food Facts
if (codigo_barras) {
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${codigo_barras}.json` +
      `?fields=product_name,brands,image_url,categories`
    );
    const data = await res.json();
    if (data.status === 1) { // 1 = producto encontrado
      return {
        encontrado: true,
        resultados: [{
          codigo_barras,
          nombre: data.product.product_name,
          marca: data.product.brands,
          imagen_url: data.product.image_url,
          fuente: 'open_food_facts',
        }],
      };
    }
  } catch (e) {
    console.error(`[producto-lookup] Open Food Facts falló para ${codigo_barras}:`, e.message);
    // no bloquea — sigue al paso 3 igual que si no hubiera encontrado nada
  }
}

// 3. Nada encontrado en ningún lado → el frontend ofrece alta manual
return { encontrado: false };
```

### 4.4 UI — flujo de alta de producto

En el modal/formulario de "Nuevo Producto" (`ProductosSection.jsx` o el componente que lo reemplace), antes de mostrar el formulario vacío:
- Input único con debounce: "Escaneá el código de barra o escribí el nombre del producto"
- Al tipear o escanear, llama a `producto-lookup` y muestra resultados como sugerencias tocables (nombre + marca + imagen si hay)
- Al elegir una sugerencia: precarga el formulario (nombre, código de barra, marca en descripción) — el cliente solo completa precio, stock inicial y categoría propia
- Si no hay resultados: el formulario queda vacío pero con el código de barra ya cargado (si vino de un escaneo), listo para completar a mano

## 5. Mapeo SAP / valor de negocio

**Equivalente SAP:** MDG (Master Data Governance) aplicado al Material Master. En SAP, el campo EAN/UPC vive en `MARA-EAN11` y se sincroniza contra GDSN (Global Data Synchronization Network) — la misma red que administra GS1 a nivel mundial. Lo que se propone acá es, en chico, un GDSN propio: catálogo maestro con gobierno de datos, donde `veces_confirmado` funciona como señal de confianza cruzada entre "data pools" (tenants).

| Ítem | Complejidad | Valor de negocio |
|---|---|---|
| Tabla `catalogo_maestro_productos` + RLS + RPCs + trigger | S | Alto |
| Edge Function `producto-lookup` + integración Open Food Facts | S/M | Alto |
| UI: buscador con debounce en el alta de producto | M | Alto |
| Seed catalogs curados por vertical (300-500 ítems, trabajo de curación más que de código) | M/L | Alto |

Alto valor en los cuatro casos: es el punto de fricción #1 de cualquier ERP/POS nuevo, y bajarlo de horas a minutos es conversión directa en el onboarding.

## 6. Casos borde a resolver durante la construcción (no ahora)

- **Rate limit de Open Food Facts (15 req/min/IP).** Si varios cajeros de distintos clientes escanean al mismo tiempo, todas las Edge Functions de KAIROX probablemente salen por IPs del mismo rango de Supabase. Mitigación natural: como cada código resuelto se guarda en el catálogo propio, la segunda consulta del mismo código (de cualquier tenant) ya ni golpea a Open Food Facts. Si igual se pega el límite, la Edge Function debe manejar el 429 con gracia (cae a "no encontrado", no rompe el alta).
- **Calidad del dato compartido.** Como el catálogo es cross-tenant, un error de tipeo de una empresa podría aparecer como sugerencia para otra. `veces_confirmado` es la señal a usar: priorizar en el listado de sugerencias los productos con 2+ confirmaciones por encima de los cargados una sola vez. No hay moderación activa en esta primera versión.
- **Privacidad competitiva.** Confirmar explícitamente en la UI/documentación que el catálogo compartido no expone qué empresa cargó cada producto — es anónimo respecto del tenant de origen, solo viaja código + nombre + marca.
- **Open Food Facts caído.** Mismo criterio que `tc-diario-sync` con dolarapi: el try/catch no bloquea el alta, cae directo a carga manual.
- **Códigos que no son EAN-13 argentino.** El lector ya soporta EAN-13/EAN-8/UPC/Code128/Code39/ITF — la Edge Function no debe asumir longitud ni formato fijo, simplemente pasa el string tal cual se escaneó.

## 7. Fases de implementación sugeridas

1. **Fase A** — migración (tabla + RLS + RPCs + trigger), probada con `BEGIN...ROLLBACK` contra Supabase real antes de aplicar.
2. **Fase B** — Edge Function `producto-lookup`, invocada a mano contra un código de barra real conocido (ej. un producto de almacén con EAN argentino) para confirmar que trae datos de Open Food Facts antes de conectarla a la UI.
3. **Fase C** — UI del buscador en el alta de producto.
4. **Fase D** — seed catalog del primer vertical (arrancar por almacén es más rápido de validar porque Open Food Facts ya cubre gran parte; ferretería queda para una segunda pasada de curación manual). Este es también el momento de medir cuánto "no se encuentra en ningún lado" y recién ahí evaluar si GS1 se justifica.

## 8. Testing antes de aplicar a producción

- `BEGIN...ROLLBACK` contra Supabase real para la migración, mismo patrón usado en el resto del proyecto.
- Probar la Edge Function manualmente contra un código de barra real de un producto argentino conocido (no mockeado) antes de conectarla a la UI.
- Verificar en vivo que el trigger de retroalimentación no rompe ni ralentiza el alta normal de producto (debería ser no bloqueante — si falla el insert en `catalogo_maestro_productos`, el alta del producto del tenant tiene que completarse igual).

---

## Fuentes consultadas (19/08/2026)

- GS1 Argentina — https://www.gs1.org.ar/
- GS1 Argentina, API "Verified by GS1" — https://www.gs1.org.ar/Site/EstandaresSoluciones_Bootstrap5/API.html
- GS1 Argentina, costos de membresía — https://www.gs1.org.ar/Site/Sectores_Bootstrap5/CodigoBarra.html
- Open Food Facts, documentación de API — https://openfoodfacts.github.io/openfoodfacts-server/api/
- Open Food Facts, home — https://world.openfoodfacts.org/
- Open Products Facts, home (conteo de productos) — https://world.openproductsfacts.org/
- EAN-search.org — https://www.ean-search.org/es/
- Barcode Lookup / product-search.net — https://es.product-search.net/api.html
- UPCitemdb, documentación de API — https://www.upcitemdb.com/api/
- Foro Comunidad Visual FoxPro en Español (confirmación de que no existe una base única para Argentina) — https://groups.google.com/g/publicesvfoxpro/c/hyPuiAt04hE

*Nota: precios y límites de API pueden cambiar — verificar de nuevo si este plan se retoma varios meses después de esta fecha.*
