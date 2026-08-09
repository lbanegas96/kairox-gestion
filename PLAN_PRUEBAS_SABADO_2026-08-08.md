# Plan de Pruebas — Sábado 08/08 (Luciano + Claude)

Este es **distinto** del plan de Nadia (`PLAN_PRUEBAS_NADIA_2026-08-08.md`, que cubre canjear
puntos en el ERP y QR MercadoPago sumando puntos). Este plan es lo que nos toca revisar a
nosotros: pulido visual/UX de cara al primer cliente (objetivo de `ROADMAP.md`), más el resultado
del barrido general del 07/08.

**URL de producción:** `https://kairox-gestion-chi.vercel.app`.

---

## 0. Auditoría contable (mig.314) — probar una venta/compra real después de esto

Se blindaron `asientos_contables`/`asientos_items` (ya no se pueden editar directo desde el
navegador, ni siquiera un asiento en borrador puede quedar desbalanceado) y ahora los asientos
automáticos (venta, compra, ajuste de stock, NC/ND, etc.) se crean y confirman en una sola llamada
atómica en vez de dos. Probado a fondo en sandbox contra la base real antes de aplicar (detalle en
`INFORME_AUDITORIA_CONTABLE_2026-08-07.md`), pero **nadie hizo todavía una venta real en
producción después del deploy** — por favor:
1. Hacé una venta cualquiera (Efectivo, cualquier monto chico).
2. Contabilidad → Asientos → confirmá que aparece un asiento nuevo, confirmado, balanceado, con
   fecha de hoy.
3. Si algo no genera asiento (no debería bloquear la venta en ningún caso), el botón "Regenerar
   asiento" del detalle de la venta sigue andando igual que siempre.
4. También agregué la pestaña "Antigüedad de Deuda" en Proveedores (antes solo existía en
   Clientes) — con algún proveedor que tenga compras sin pagar, confirmá que aparece ahí.

## 1. Login rebrandeado — revisar en vivo (recién hecho, sin screenshot para verificar)

Reescribí `AuthPage.jsx`: antes tenía colores viejos hardcodeados (`#00D4FF`/`#A855F7`) y estaba
forzado a modo oscuro siempre, ignorando el sistema de diseño `kx-*` (violeta) que usa el resto de
la app. Ahora usa esos tokens (respeta claro/oscuro) y muestra el **logo real de KAIROX** en vez de
un ícono genérico cuando no hay logo de empresa cacheado (el caso de un dispositivo nuevo — o sea,
el primer cliente).

Verifiqué colores computados por JS (correctos en ambos temas) pero el entorno de pruebas no me
dejó sacar una captura real — **necesito que lo mires vos con tus propios ojos:**
1. Entrá a `kairox-gestion-chi.vercel.app` **sin sesión iniciada** (o en una pestaña incógnito).
2. Mirá el login en modo oscuro y en modo claro (toggle si hay uno visible, o el de tu SO).
3. ✅ Esperado: el logo de KAIROX real (la marca celeste con el ícono de circuito) en una placa
   oscura, el resto de la tarjeta en violeta/tokens del sistema, nada de fondo cian/violeta plano.
4. Probá también "Registrarse ahora" (formulario de alta de empresa) y "Olvidé mi contraseña".
5. Si algo se ve mal, mandame captura — lo corrijo al toque.

## 2. ✅ Resuelto: el mismo estilo viejo estaba en 32 archivos más — ya rebrandeados y deployados

Barriendo el código encontré **88 usos de esos mismos colores hardcodeados (`#00D4FF`/
`#A855F7`) repartidos en 32 componentes** — Ventas, Compras, Cheques, Plan de Cuentas, Caja,
Reportes, Configuración, y el resto del flujo de autenticación (`OnboardingPage.jsx`,
`ResetPasswordPage.jsx`, `PasswordRecoveryModal.jsx`). El login no era un caso aislado — era una
marca vieja que quedó pisada a medias cuando se armó el sistema de diseño `kx-*` actual.

**Decidiste hacerlo todo de una — ya está hecho y en producción.** Reemplazados los 88 usos por
los tokens `kx-*` (kx-violet como acento principal, kx-blue como secundario en gradientes).
Verificado: 0 ocurrencias del color viejo en todo `src/`, lint limpio, build limpio, 153/153 tests,
sin errores de consola en producción. **Dos cosas para que confirmes con tus propios ojos** (no
pude sacar capturas en este entorno):

- **Botones sólidos de un solo acento** (Nuevo Asiento, Nueva Cuenta, Nuevo Período, Registrar
  Cheque, etc., en Plan de Cuentas y Cheques) pasaron de `bg-violeta + texto negro` a
  `bg-violeta + texto blanco` — el negro sobre violeta no llegaba al mínimo de contraste
  accesible en modo claro. Debería verse igual de bien, pero confirmalo.
- **`PlanCuentasSection.jsx`** (los tabs internos: Plan de Cuentas / Asientos / Balance / Estado
  de Resultados / Balance General / Libro Mayor / Períodos) es la que más se apartaba del patrón
  del resto de la app (no tenía distinción clara/oscuro previa) — vale la pena mirarla con más
  atención que el resto.

<details>
<summary>Lista completa de archivos con el estilo viejo (88 ocurrencias)</summary>

- `src/components/OnboardingPage.jsx` (11) · `src/components/ResetPasswordPage.jsx` (9) ·
  `src/components/PasswordRecoveryModal.jsx` (3) — mismo flujo de auth que el login.
- `src/components/sections/PlanCuentasSection.jsx` (8) · `src/components/compras/TabNuevaCompra.jsx` (6)
- `src/components/ventas/nueva-venta/PanelPago.jsx` (4) · `src/components/plan-cuentas/ModalNuevoAsiento.jsx` (4)
- `src/components/caja/TabMovimientos.jsx` (3) · `src/components/configuracion/TabEmpresa.jsx` (3) ·
  `src/components/plan-cuentas/TabPeriodos.jsx` (3) · `src/components/plan-cuentas/TabPlanCuentas.jsx` (3) ·
  `src/components/sections/CajaSection.jsx` (3) · `src/components/sections/ChequesSection.jsx` (3)
- `src/components/cheques/ModalCambioEstado.jsx` (2) · `src/components/compras/ModalEditarCompra.jsx` (2) ·
  `src/components/plan-cuentas/ModalNuevaCuenta.jsx` (2) · `src/components/sections/CompraRapidaSection.jsx` (2) ·
  `src/components/sections/CuentaCorrienteSection.jsx` (2) · `src/components/reportes/ReporteParidad.jsx` (2)
- 1 ocurrencia cada uno: `App.jsx`, `index.css`, `cheques/shared.jsx`, `cheques/TabChequesPropios.jsx`,
  `cheques/TabCarteraTerceros.jsx`, `plan-cuentas/shared.jsx`, `plan-cuentas/TabAsientos.jsx`,
  `ventas/CompraDetailModal.jsx`, `sections/ClientDetailModal.jsx`, `sections/ConfiguracionSection.jsx`,
  `sections/PedidosSection.jsx`, `reportes/GridReportes.jsx`, `ventas/NuevaVentaModal.jsx`

</details>

## 3. Regresión rápida — lo más tocado en las últimas 2 semanas

No hace falta repetir todo `TESTING_ROADMAP.md` (es de junio, generalista) — enfocate en lo que
cambió mucho últimamente y no tiene un plan de prueba dedicado ya corrido:

- **Multi-caja + Modo Offline**: ya lo confirmó Nadia en vivo (07/08) — no hace falta repetir, solo
  si notás algo raro en el día a día avisá.
- **Fidelización por puntos en el POS** (no el ERP, eso es de Nadia): vendé algo con un cliente que
  tenga puntos, canjeá algunos, confirmá que el ticket impreso muestra el descuento.
- **Escaneo de código de barras por cámara**: si tenés el celular a mano, probalo vos también
  (Android o iPhone) — es la única parte de anoche que nadie probó todavía con hardware real.
- **Cobro por QR MercadoPago**: un cobro real chico, confirmar que no aparece error de CORS.

## 4. Pendientes técnicos ya conocidos (sin acción por ahora, solo para que los tengas presentes)

- Dominio propio para email (Resend) — parche con Gmail SMTP funcionando, no urgente.
- CbteAsoc en `informar-caea` (circuito CAEA) — no probable hasta que alguna empresa use CAEA con
  NC/ND real.
- 4 NC históricas mal declaradas ante ARCA — tema para el contador, no se puede corregir por código.
- **Billing de Supabase (Nalux) vence el 17/08/2026** — revisar antes de esa fecha o se restringe
  producción.

## 5. Mapa de Relaciones — circuito completo de pruebas (Fases 1+2+3, 08/08-09/08)

Rediseño en tres partes, las tres ya en producción (`PLAN_MAPA_RELACIONES.md` tiene el detalle
completo del pedido original, el barrido de lo que ya había, y el estudio de mercado sobre el
Relationship Map de SAP B1 que lo inspiró):

- **Fase 1 (visual):** íconos por tipo de documento, badges de estado con color, barra de resumen
  del circuito, cadena principal en scroll horizontal en vez de `flex-wrap`, botón de pantalla
  completa.
- **Fase 2 (preview inline):** clic en cualquier nodo navegable abre un panel al costado, DENTRO
  del mismo modal, con los ítems reales de ese documento — sin cerrar el mapa. Botón "Ver
  documento completo" para el que igual quiere navegar.
- **Fase 3 (puntos de acceso):** el botón "Mapa de relaciones" ya no vive solo en la Factura —
  ahora está también en Cotizaciones, Pedidos, Entregas, Recepciones y Devoluciones (cliente y
  proveedor). El nodo "ACTUAL" marca el documento desde el que realmente abriste el mapa, no
  siempre la factura final.

Las tres fases ya se probaron en vivo contra datos reales durante el desarrollo (venta
20260806-011 para Fases 1/2; un pedido facturado, un pedido en borrador, una recepción y una
cotización sin convertir para la Fase 3), pero falta el circuito completo de punta a punta con
varios casos — este bloque es exactamente eso.

**Cómo probar — lado Ventas:**
1. Ventas → Facturas → elegí cualquier fila → botón "..." → **Mapa de relaciones**.
2. ✅ Esperado: modal con la barra de resumen arriba ("N pasos en la cadena", "Total: $X", y "N
   documentos derivados" si aplica), la cadena de documentos con íconos por tipo (cotización,
   pedido, camión de entrega, factura, etc.), y el nodo actual marcado "ACTUAL" en violeta.
3. Probá con una venta que tenga **cadena larga** (con pedido + entrega + NC o cobro) — la cadena
   principal debería scrollear horizontalmente en vez de desordenarse en varias filas.
4. Hacé clic en un nodo que **no** sea el actual (ej. la Entrega, o el Pedido, o una NC en
   "documentos derivados"). ✅ Esperado: se abre un panel a la derecha con los ítems reales de ese
   documento (producto × cantidad, con subtotal cuando corresponde) — el modal **no se cierra**.
5. Clic en la ✕ del panel de preview. ✅ Esperado: el panel se cierra y la cadena vuelve a ocupar
   todo el ancho.
6. Clic en "Ver documento completo" dentro del preview. ✅ Esperado: navega al documento real y
   cierra el mapa (esto sí es intencional — es la salida "de verdad" para el que quiere editar/ver
   todo el documento).
7. Botón de pantalla completa (ícono de flechas arriba a la derecha, al lado de la ✕ de cerrar).
   ✅ Esperado: el modal ocupa casi toda la pantalla, útil para cadenas con muchos derivados.
8. Probá también con una **venta del POS sin relaciones** (venta suelta, sin pedido/cotización).
   ✅ Esperado: mensaje "Sin documentos relacionados — comprobante independiente", sin la barra de
   resumen ni la sección de derivados.

**Cómo probar — lado Compras:**
1. Compras → Facturas de Compra → cualquier fila → "..." → **Mapa de relaciones**.
2. ✅ Esperado: mismo diseño que en Ventas, con badge "Compras" junto al título, cadena
   Recepción(es) → Factura → Pago(s).
3. Clic en una Recepción o una Devolución de proveedor (si hay alguna con documentos derivados).
   ✅ Esperado: mismo panel de preview, con los ítems de esa recepción/devolución.

**Cómo probar — puntos de acceso nuevos (Fase 3):**
1. **Cotizaciones**: fila cualquiera → ícono de red (junto al ojo "Ver detalle"). Probá una
   cotización ya convertida en venta y una que **no** — en la que no, ✅ esperado: "Cotización
   todavía sin facturar — cuando se convierta en factura vas a poder ver la cadena completa acá."
2. **Pedidos**: abrí el detalle de un pedido (clic en la fila) → botón "Mapa de relaciones" junto
   a "Flujo del documento". Probá un pedido **Facturado** (✅ esperado: cadena completa, con el
   Pedido marcado ACTUAL — no la Factura) y un pedido en **Borrador** (✅ esperado: mensaje "sin
   facturar todavía", sin cadena).
3. **Entregas**: abrí el detalle de una entrega → mismo botón junto a "Flujo del documento".
4. **Recepciones** (Compras): fila cualquiera → ícono de red en la columna Acciones.
5. **Devoluciones** (Ventas y Compras): abrí el detalle de una devolución → mismo botón.
6. En todos los casos: el nodo desde el que abriste el mapa debe aparecer marcado "ACTUAL", no
   necesariamente la factura.

**Si algo no sale así:** sacá captura (con el nombre/número del documento que estabas mirando) y
contame — no hace falta que intentes arreglarlo.

---

## Qué contarme al terminar

Para el punto 1 (login): ✅ se ve bien / ⚠️ algo no coincide (con captura).
Para el punto 2 (alcance del rebrand): tu decisión sobre qué tan lejos llevarlo.
Para el punto 3: cualquier cosa rara que encuentres, con captura si aplica.
Para el punto 5 (Mapa de Relaciones): ✅/⚠️ por cada paso del circuito, con captura si algo no
coincide.
