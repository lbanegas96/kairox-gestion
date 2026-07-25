# Investigación — RG 3685 / Libro IVA Digital (CITI Ventas-Compras)

**Estado:** solo investigación, nada construido. Preparado para cuando se decida encarar la "fase 2" del Libro IVA (ver conversación 2026-07-25 con Luciano — "a un monotributista esto quizás no le importe, pero como creador del sistema sí lo quiero para el público al que apunto").

---

## 1. Qué es realmente

Lo que hoy `ReporteLibroIVA.jsx` genera (un PDF/Excel prolijo con los comprobantes del período) **no es** lo que AFIP exige formalmente para el Libro IVA Digital. AFIP reemplazó el viejo régimen CITI (RG 3685) por un sistema online, pero el **formato de importación de datos hacia ese sistema sigue siendo el diseño de registro de la RG 3685**: un archivo de **texto plano de ancho fijo** (no CSV, no Excel, no JSON), con reglas de posición de carácter exactas por campo.

## 2. Lo que confirmé con razonable certeza (vía búsqueda web)

- Es un formato de **ancho fijo** (fixed-width), no delimitado.
- Existen **al menos 2 tipos de registro** por archivo/operación:
  1. Un registro por **cada comprobante emitido** (cabecera: tipo, punto de venta, número, fecha, CUIT/documento del receptor, importes totales).
  2. Un registro por **cada alícuota de IVA presente en ese comprobante** (código de alícuota + neto gravado a esa tasa + IVA de esa tasa) — esto es exactamente el "resumen por alícuota" que ya construimos en el reporte de pantalla, pero como registro formal por comprobante, no como agregado del período.
- Código de alícuota confirmado: **3 = 0%, 4 = 10.5%, 5 = 21%, 6 = 27%** (no coincide 1 a 1 con los valores que usa nuestra tabla `comprobante_items.alicuota_iva` como texto — habrá que mapear).
- Campos de cabecera confirmados por nombre (no por posición exacta todavía): Tipo de Comprobante, Punto de Venta, N° de Comprobante, Fecha de la Operación, CUIT del receptor, Monto en Moneda Original, Importe Neto Gravado (por alícuota, en el registro de detalle).

## 3. Lo que NO pude confirmar todavía — y por qué

El documento oficial con la tabla exacta (campo por campo: nombre, posición inicial, longitud, tipo de dato) es un PDF de AFIP:

**https://www.afip.gob.ar/libro-iva-digital/documentos/libro-iva-digital-diseno-de-registro-SUJETOS-EXENTOS.pdf**

Lo descargué, pero el entorno de esta sesión no tiene una herramienta de renderizado de PDF (`poppler-utils`/`pdftoppm`) instalada, y el texto del documento está embebido como glifos codificados (fuente subseteada con mapeo CID→Unicode) dentro de streams comprimidos — no es texto plano extraíble con un script simple, hace falta un parser de PDF más completo (ej. `pdfplumber` en Python, que tampoco está disponible en este entorno — no hay Python instalado).

**Alternativa real encontrada, posiblemente más práctica que replicar el TXT exacto:** al menos un proveedor de software de gestión (EGA Futura) directamente **no genera** el archivo de ancho fijo — exportan un Excel desde su reporte de IVA Ventas y el usuario/contador lo carga **manualmente en el portal web de AFIP** (Libro IVA Digital tiene una interfaz de carga, no exclusivamente archivos). Esto sugiere que el "Excel prolijo" que ya tenemos hoy podría alcanzar para el 90% de los usuarios (los que cargan a mano en el portal), y que el archivo de ancho fijo exacto solo es necesario para integraciones 100% automatizadas — un lujo, no un mínimo viable.

## 4. Recomendación para cuando se retome esto

Antes de invertir en programar el archivo de ancho fijo exacto:

1. **Confirmar con un contador real** (no solo con la documentación) si el Excel que ya generamos alcanza para cargar a mano en el portal de AFIP, o si específicamente hace falta el archivo de importación masiva.
2. Si hace falta el archivo real: conseguir el PDF de diseño de registro y abrirlo con una herramienta que sí renderice PDFs (en una sesión con `poppler-utils` o Python+`pdfplumber` disponibles) para sacar la tabla exacta de posiciones — no vale la pena adivinar posiciones de un formato que AFIP rechaza si un solo carácter queda mal alineado.
3. Mapear `comprobante_items.alicuota_iva` (hoy: `'21'`, `'10.5'`, `'0'`, `'exento'`, `'no_gravado'`) contra los códigos AFIP (3/4/5/6) — no son el mismo vocabulario.

## 5. Links de referencia

- PDF oficial (diseño de registro Ventas — sujetos exentos): https://www.afip.gob.ar/libro-iva-digital/documentos/libro-iva-digital-diseno-de-registro-SUJETOS-EXENTOS.pdf
- Manual del desarrollador — importación de datos: https://www.afip.gob.ar/sir/ayuda/documentos/Disenio-de-registro.pdf
