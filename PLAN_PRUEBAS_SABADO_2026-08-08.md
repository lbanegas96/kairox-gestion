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

## Qué contarme al terminar

Para el punto 1 (login): ✅ se ve bien / ⚠️ algo no coincide (con captura).
Para el punto 2 (alcance del rebrand): tu decisión sobre qué tan lejos llevarlo.
Para el punto 3: cualquier cosa rara que encuentres, con captura si aplica.
