# Plan: Multi-Punto de Venta con asignación por letra (POS vs ERP)

**Estado:** planificación únicamente — Luciano pidió explícitamente NO construir esto todavía
("este último tema me parece que es algo grande así que si querés solo planificalo y documentalo
para encarar más tarde"), 23/08. Este documento existe para retomarlo sin perder el análisis.

## Disparador

Ajustando el selector de Punto de Venta en "Nueva Factura" (ver `CONTEXT.md`, ítem del 23/08),
Luciano mostró capturas de SAP Business One (`Puntos de emisión`, `Serie de número de folio`,
`Relacionar serie de número de folio con documento`) y preguntó si KAIROX debería tener un
esquema similar: varios puntos de venta, uno por defecto, pero con la posibilidad de elegir según
la letra (A/B/C), y una config que defina qué PdVs actúan en el POS vs en el ERP.

## Hallazgo clave — por qué NO es un calco 1:1 de SAP

Investigando `series_numeracion` (la tabla que ya existe en KAIROX) para diseñar esto, encontré
que **KAIROX no necesita pre-reservar rangos de folio localmente**, a diferencia de SAP:

- El módulo "Serie de número de folio" de SAP (capturas de Luciano) pre-asigna rangos de
  numeración LOCALES con su propio CAI — es el modelo del régimen viejo de AFIP (impresión
  pre-autorizada, RG 100/1415), donde el software tenía que saber de antemano qué número le
  tocaba a cada letra.
- KAIROX usa el régimen moderno (WSFEV1 / facturación electrónica en línea vía el `arca-worker`):
  el número real de folio (`comprobantes.numero_afip`) **lo devuelve ARCA en la respuesta del
  CAE**, no lo pre-asigna KAIROX. `series_numeracion` (mig.051) solo numera el **correlativo
  interno** (`comprobantes.numero_venta`, ej. `"FAC-20260822-001"`) — un identificador propio,
  irrelevante para AFIP, que ni siquiera tiene columna de letra.
- La única numeración que KAIROX SÍ pre-reserva localmente con CAI propio es la de **remitos**
  (`puntos_venta.cai_remito` / `proximo_numero_remito`, sin letra — los remitos no tienen A/B/C).

**Conclusión:** el gap real no es "nos falta una tabla de series por letra como SAP" — la
numeración fiscal ya está resuelta correctamente por el `arca-worker`. El gap real es de
**configuración y selección**: hoy `puntos_venta` es una lista plana sin noción de "para qué
contexto (POS/ERP) está disponible este PdV" ni "cuál es el PdV preferido para cada letra".

## Estado actual (lo que ya existe, no tocar sin querer romperlo)

- `puntos_venta`: `numero`, `nombre`, `tipo`, `tipo_comprobante_default`, `es_default`,
  `envia_arca`, `cai_remito*`, `activo`, y desde hoy `solo_remito` (mig.346).
- `empresas.pos_punto_venta_id`: UN solo PdV para todo el Modo Caja (mig.293) — si es NULL, usa
  "el mismo que el resto del sistema" (el `es_default`).
- `NuevaFacturaModal.jsx`: selector de PdV que hoy muestra **todos** los PdV activos con
  `solo_remito=false`, sin relación con la letra elegida en "Tipo de documento".
- `obtener_proximo_numero(empresa_id, tipo_documento, punto_venta_id)` (mig.294/295/296):
  numera el correlativo interno, scoped por PdV solo si el PdV no es `es_default` — ya soporta
  múltiples PdV conviviendo, esto no necesita cambios.
- Regla 9 / Regla 1 del `sap-reference`: terminología SAP donde el usuario la reconoce, pero toda
  config vive en `ConfiguracionSection` — los módulos operativos solo operan. Aplica de lleno acá.

## Qué construir (cuando se retome)

### 1. `puntos_venta` — relación con letra, no una tabla nueva de "series"

En vez de clonar el modelo de 3 tablas de SAP (Puntos de emisión / Serie de folio / Relación
serie-documento), alcanza con una tabla chica **`puntos_venta_letras`**:

```sql
CREATE TABLE puntos_venta_letras (
  id UUID PK,
  punto_venta_id UUID NOT NULL REFERENCES puntos_venta(id) ON DELETE CASCADE,
  letra TEXT NOT NULL CHECK (letra IN ('A','B','C')),
  es_default_para_letra BOOLEAN DEFAULT false,
  UNIQUE (punto_venta_id, letra)
);
```

Un PdV puede tener 1, 2 o las 3 letras habilitadas. `es_default_para_letra` resuelve "si el
usuario elige Factura A y no dice nada más, ¿qué PdV le propongo primero" — reemplaza la
resolución actual (que ignora la letra y solo mira `es_default` a secas).

### 2. Config nueva en `ConfiguracionSection` → Facturación

- Extender el modal de alta/edición de PdV (`ConfiguracionSection.jsx` línea ~2150, mismo modal
  donde hoy vive el switch "Solo para remitos") con checkboxes "Factura A / B / C" + radio "por
  defecto para esta letra".
- Extender el bloque "Punto de venta del Modo Caja" (hoy un solo `<select>`) para dejar elegir,
  si se quiere, un PdV *por letra* también para el POS — hoy el POS no pregunta letra al vender
  (usa `tipo_comprobante_default` del PdV elegido), así que esto depende de si el POS pasa a
  soportar elegir letra en el momento de vender (fuera de este alcance, a confirmar con Luciano
  antes de tocarlo).

### 3. `NuevaFacturaModal.jsx` — el selector de PdV reacciona a la letra elegida

Hoy el flujo es: elegís PdV → el PdV trae su `tipo_comprobante_default` pero `tipoDoc` es
independiente. Pasaría a ser: elegís `tipoDoc` (Factura A/B/C) → el selector de PdV se filtra a
los que tienen esa letra habilitada en `puntos_venta_letras`, con el marcado
`es_default_para_letra` preseleccionado.

### 4. Qué NO tocar

- `obtener_proximo_numero` / `series_numeracion`: sin cambios, ya soportan multi-PdV.
- El `arca-worker` y la resolución de CAE: sin cambios, ARCA sigue siendo la única fuente de
  verdad del folio real.
- El circuito de remitos (`emitir_remito`, `cai_remito`): sin letra, no aplica acá.

## Preguntas para retomar con Luciano antes de construir

1. ¿El Modo Caja (POS) necesita elegir letra al vender, o sigue siendo "un PdV = una letra fija"
   como hoy? Si el POS nunca pregunta letra, el punto 2b de arriba (PdV por letra en el POS) no
   hace falta — se simplifica bastante.
2. ¿Cuántos PdV reales va a tener Nalux (o cualquier empresa) en la práctica? Si en general es
   1-2 PdV con como mucho 2 letras cada uno, quizás ni haga falta una tabla nueva — un campo
   `letras_habilitadas text[]` en `puntos_venta` + `letra_default` podría alcanzar sin la tabla
   `puntos_venta_letras`. Evaluar según el caso real antes de sobre-diseñar.
3. ¿Esto es solo para Facturas de Venta, o también aplica al lado de Compras (Facturas de
   Compra, que no emiten CAE propio pero podrían querer un criterio similar de "qué serie/PdV
   usar")? Si es solo Ventas, el alcance es más chico.
