# Plan — Mapa de Relaciones estilo SAP B1 (rediseño)

**Pedido de Luciano (08/08):** replicar la idea del Mapa de Relaciones del cliente web de SAP
Business One (capturas de referencia adjuntas) — mismo concepto, con el estilo visual de KAIROX,
totalmente funcional. Antes de construir: barrido de lo que ya existe + estudio de mercado
(qué le gusta a los usuarios de SAP, qué les molesta) para no repetir los mismos problemas.

---

## 1. Barrido — qué ya tenemos

**`src/components/shared/MapaRelaciones.jsx`** (579 líneas) — el componente YA EXISTE y es
bastante más completo de lo que parece a simple vista. Es un modal (`Dialog`) que arma la cadena
de documentos con dos modos:

- **Ventas** (`comprobanteId`): Cotización→Pedido→Entrega(s)→Factura, más una rama de
  "documentos derivados" (NC, ND, cobros CC, devoluciones) colgando de la factura.
- **Compras** (`compraId`): Recepción(es)→Factura de Compra→Pago, más derivados (devolución,
  NC/ND de proveedor).

**Cobertura de datos:** ya resuelve casos no triviales — dedupe de entregas (implícita del POS vs.
manual), fallback de pedido si el comprobante no lo trae directo, reconciliación cuando hay
múltiples entregas para el mismo pedido. Es decir: el **backend/fetch ya está a la altura** de lo
que pide SAP.

**Puntos de acceso — solo 2, y escondidos:**
- `HistorialVentas.jsx` — ítem dentro de un menú "..." (junto a "Ver detalle", reintentar CAE, etc.)
- `FacturasCompraSection.jsx` — mismo patrón.
- **No existe en ningún otro lugar de la cadena**: no se puede abrir el mapa desde una Cotización,
  un Pedido, una Entrega, una Recepción, una NC/ND o una Devolución — solo desde el documento
  "final" de cada circuito (Factura de venta / Factura de compra).

**Lo visual — acá está el problema real que señaló Luciano:**
- Tarjetas en `flex-wrap` con flechas sueltas (`ArrowRight`/`ArrowDown`) entre medio — con pocos
  nodos se ve prolijo, pero con una cadena larga (cotización + pedido + 2 entregas + NC + ND +
  cobro) el wrap se vuelve desordenado y las líneas de conexión no acompañan al layout.
- Sin zoom, sin fullscreen, sin pan — el modal tiene un `max-w-4xl` fijo.
- Sin resumen de estado a nivel de todo el circuito (ej. "3 de 4 pasos completos, $X pendiente") —
  hay que leer nodo por nodo.
- Click en un nodo → navega y **cierra el modal** (no hay preview inline) — para ver el detalle de
  cada paso hay que abrir y cerrar el mapa una y otra vez.
- El acceso (menú "...") no avisa si hay algo interesante para ver — un comprobante sin relaciones
  y uno con 6 documentos derivados se ven exactamente igual en la lista.

**Conclusión del barrido:** no hace falta reconstruir el motor de datos — hace falta rediseñar la
capa visual, extender la cobertura de puntos de acceso, y sumar 2-3 mejoras de interacción que ni
SAP tiene resueltas del todo (ver mercado, abajo).

---

## 2. Estudio de mercado — Mapa de Relaciones de SAP B1

**Qué hace bien (para replicar):**
- **Cabecera con pasos categorizados**: fila de íconos circulares por etapa del proceso (Sales
  Order → Delivery → Billing → Incoming Payment en las capturas), con un mini-gráfico circular de
  distribución de estados por columna — de un vistazo se ve cuántos documentos de cada tipo hay y
  en qué estado.
- **Zoom + pantalla completa** — el diagrama se adapta al tamaño del contenedor, y muestra más o
  menos detalle según el nivel de zoom.
- **Doble clic en un nodo salta directo al documento origen** sin perder el contexto del mapa.
- Cada tarjeta muestra estado, fecha y monto — igual que ya hace KAIROX.

**Qué le molesta a los usuarios de SAP (research en foros/blogs de la comunidad SAP):**
- **Solo da una vista de alto nivel** — cuando un Pedido se cumple con varias Entregas y varias
  Facturas parciales, el mapa se pone confuso para saber *qué línea específica del pedido* quedó
  en cuál entrega. Hay que abrir documento por documento igual.
- La complejidad crece rápido a medida que el circuito de negocio tiene más pasos — no hay forma
  de "colapsar" ramas que no interesan en ese momento.
- Es una herramienta valorada (aparece como punto a favor en reseñas), pero varios usuarios la
  describen como algo que "hay que aprender a leer" — la curva de entrada no es trivial.

**Oportunidad real para KAIROX (mejorar, no solo copiar):** un preview inline al hacer clic (sin
cerrar el mapa) resuelve exactamente la queja más repetida — ver qué hay "adentro" de cada
documento sin abandonar el contexto del circuito completo. Esto SAP no lo tiene resuelto.

Fuentes: [Relationship Map in SAP Business One Web Client](https://www.sap-business-one-tips.com/en/relationship-map-in-sap-business-one-web-client/) · [SAP Business One 8.81 - Relationship Map](https://www.leveragetech.com.au/blog/sap-business-one-relationship-map/) · [Relationship Mapping in SAP Business One (PDF)](https://49731.fs1.hubspotusercontent-na1.net/hubfs/49731/VistaVu%202023-2025/Tutorials/PDFs/relationship-mapping.pdf) · [SAP Community — Recreate the Relationship Map with LineNum and Base Line](https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-members/sap-business-one-recreate-the-relationship-map-with-linenum-and-base-line/ba-p/13409979) · [Relationship Map Reveals Useful Data — SAP Community](https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-sap/relationship-map-reveals-useful-data/ba-p/13465954) · [SAP Business One Reviews — Capterra](https://www.capterra.com/p/214667/SAP-Business-One/reviews/) · [Relationship Map — SAP Business One 10.0 Help](https://help.sap.com/docs/SAP_BUSINESS_ONE/68a2e87fb29941b5bf959a184d9c6727/54691c56e833692de10000000a4450e5.html)

---

## 3. Plan de construcción (propuesto, por fases)

### Fase 1 — Rediseño visual del mapa existente (el pedido central de Luciano)
- Reemplazar el layout `flex-wrap` + flechas sueltas por una fila horizontal real con conectores
  dibujados (línea continua entre nodos del camino principal, línea punteada hacia los derivados —
  ya existe esa distinción, falta que se vea bien). Decisión técnica a tomar: ¿CSS/SVG a mano
  (cero dependencias nuevas, control total, más trabajo) o sumar **React Flow** (`@xyflow/react`,
  ~40kb, la librería estándar de la industria para justo este tipo de diagrama, da zoom/pan/
  fullscreen gratis)? Recomendación: React Flow — el ahorro de tiempo y la calidad visual
  (curvas, animación de conexión, minimapa) superan el costo de bundle para un componente que se
  va a usar en 6+ pantallas.
- Cabecera con resumen de estado del circuito completo (estilo los círculos de SAP): "N pasos · $X
  total · $Y pendiente de cobro/pago", con badges de color consistentes con el resto de KAIROX
  (`kx-green`/`kx-amber`/`kx-red`).
- Modal más grande + botón de pantalla completa (no hace falta zoom real de cámara si el layout ya
  es horizontal y compacto, pero si un circuito tiene muchos derivados, sí conviene).

### Fase 2 — Preview inline al hacer clic (la mejora sobre SAP)
- Click en un nodo abre un panel lateral/expandible DENTRO del mismo modal con el detalle de ese
  documento (ítems, totales, estado) — sin cerrar el mapa. "Ver documento completo" como acción
  secundaria para el que sí quiere navegar.

### Fase 3 — Extender los puntos de acceso a toda la cadena
- Agregar el botón/ítem "Mapa de relaciones" en: `CotizacionesSection`, `PedidosSection`,
  `EntregasSection` (si existe como sección propia), `RecepcionesSection`, y los modales de
  NC/ND/Devolución — hoy solo se puede abrir desde el final del circuito (Factura), igual que en
  SAP, pero KAIROX puede ser mejor acá dejándolo disponible desde cualquier eslabón.
- El componente ya resuelve todo por `comprobanteId`/`compraId` — para abrirlo desde un Pedido o
  Entrega hace falta resolver primero el comprobante/compra asociado (si existe) antes de llamar
  al fetch actual, o agregar modos de entrada nuevos (`pedidoId`, `entregaId`, etc.) que resuelvan
  hacia el nodo raíz y reusen la misma lógica.
- Badge de conteo en la lista (ej. "3 docs vinculados") para que se note antes de abrir el mapa
  si hay algo para ver — resuelve el problema de descubribilidad sin cambiar dónde vive el botón.

### Fase 4 — Pulido y casos límite
- Colapsar ramas de derivados con muchos documentos (si un cliente tiene 10 NC sobre la misma
  factura, no debería ser una fila infinita).
- Exportar/imprimir el mapa (menor prioridad, evaluar si hay pedido real).

---

## Alcance de esta noche (antes de las pruebas con Nadia)

Dado que la prueba de hoy es funcional (no visual), **no tocar el Mapa de Relaciones todavía** —
este plan queda listo para arrancar la Fase 1 en la próxima sesión de desarrollo, después de la
ronda de pruebas de esta noche.
