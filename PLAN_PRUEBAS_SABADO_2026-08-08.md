# Plan de Pruebas — Sábado 08/08 (Luciano + Claude)

Este es **distinto** del plan de Nadia (`PLAN_PRUEBAS_NADIA_2026-08-08.md`, que cubre canjear
puntos en el ERP y QR MercadoPago sumando puntos). Este plan es lo que nos toca revisar a
nosotros: pulido visual/UX de cara al primer cliente (objetivo de `ROADMAP.md`), más el resultado
del barrido general del 07/08.

**URL de producción:** `https://kairox-gestion-chi.vercel.app`.

---

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

## 2. Hallazgo grande: el mismo estilo viejo está en 32 archivos más, no solo el login

Barriendo el código encontré **88 usos de esos mismos colores hardcodeados (`#00D4FF`/
`#A855F7`) repartidos en 32 componentes** — Ventas, Compras, Cheques, Plan de Cuentas, Caja,
Reportes, Configuración, y el resto del flujo de autenticación (`OnboardingPage.jsx`,
`ResetPasswordPage.jsx`, `PasswordRecoveryModal.jsx`). Es decir, el login no era un caso aislado —
es una marca vieja que quedó pisada a medias cuando se armó el sistema de diseño `kx-*` actual.

**No lo toqué todavía** (es una superficie grande, y no tengo forma de sacar capturas para
verificar cada pantalla en este entorno) — te dejo la lista completa más abajo para que decidas
el alcance: ¿todo de una, por lote (empezando por el resto del flujo de auth, que es chico), o lo
vas marcando vos a medida que navegás (como venís haciendo)?

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
