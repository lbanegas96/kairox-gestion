# Plan de Auditoría de Código — Estilo / Performance / Mantenibilidad

**Estado:** 📋 PLANIFICADO, no ejecutado. Documento vivo (mismo formato que `PLAN_AUDITORIA.md`).
**Fecha de creación:** 2026-07-04
**Alcance:** Distinto de `PLAN_AUDITORIA.md` (seguridad/permisos/RLS — CERRADO). Esta auditoría cubre
calidad de código: legibilidad, mantenibilidad, performance de build/runtime, consistencia.

---

## Contexto — hallazgos del research previo (sin cambios aplicados)

Research inicial sobre 202 archivos de código en `src/` (160 .jsx, 23 .js, 19 .ts, 0 .tsx):

| Área | Hallazgo concreto |
|------|--------------------|
| **Archivos gigantes** | 4 superan 1000 líneas: `ConfiguracionSection.jsx` (2937 — el peor caso, casi 3x el siguiente), `PlanCuentasSection.jsx` (1843), `CuentasBancariasSection.jsx` (1288), `CompraRapidaSection.jsx` (1214). Otros 11 superan 650 líneas (`ChequesSection`, `CajaSection`, `PedidosSection`, `ProductosSection`, `OrdenesCompraSection`, `CuentaCorrienteSection`, `OfertasSection`, `NuevaVentaModal`, `CotizacionesSection`, `ReportesSection`, `DashboardSection`) |
| **Linter demasiado laxo** | `eslint.config.mjs` existe (flat config moderno) pero con `no-unused-vars: off`, `react/prop-types: off`, `import/no-cycle: off` — solo `no-undef` y `import/no-self-import` son errores reales hoy |
| **Sin Prettier** | No hay formateo automático configurado — estilo depende 100% del criterio de quien escribe |
| **TS a medio camino** | `tsconfig.json` tiene `strict: true` pero `checkJs: false` — el rigor de TS solo aplica a los 19 archivos `.ts` (capa `services/`, 17 de 18 archivos). Los 183 archivos JS/JSX (toda la capa de componentes/presentación) no tienen ningún chequeo de tipos |
| **Patrones de datos mezclados** | 18 archivos usan `useEffect` para fetch manual, 12 usan `useQuery` (TanStack Query) — con solapamiento en el mismo archivo (`ProductosSection`, `CuentasBancariasSection`, `CotizacionesSection`, `ClientDetailModal`, `PlanCuentasSection` usan ambos patrones a la vez). No hay hooks custom por dominio (`useProductos`, `useClientes`) que centralicen queries — cada sección repite su propia lógica de fetch |
| **Bundle sin code-splitting** | Build genera `index-*.js` de **2.41 MB** (650 KB gzip) y `react-pdf.browser-*.js` de **1.45 MB** (487 KB gzip) — ambos exceden el límite default de Vite (500 KB), con warning explícito. Todo el ERP entra en un solo bundle principal; `react-pdf` (usado solo para PDFs de facturas/tickets) no está en dynamic import |
| **Duplicación de modales** | 24 archivos `*Modal.jsx`. Pares casi idénticos ventas↔compras candidatos a unificar: `NuevaFacturaModal`↔`NuevaFacturaProveedorModal`, `NuevaNCModal`↔`NuevaNCProveedorModal`, `NuevaNotaDebitoModal`↔`NuevaNDProveedorModal`, `NuevaDevolucionModal`↔`NuevaDevolucionProveedorModal`, `GenerarEntregaModal`↔`GenerarRecepcionModal`. Ya existe un buen precedente en `shared/` (`ClienteAltaRapidaModal`/`ProveedorAltaRapidaModal` conviven ahí) |
| **Naming inconsistente** | Coexisten `components/reportes/` y `components/reports/` — mismo dominio, dos carpetas |

---

## Metodología propuesta (misma disciplina que `PLAN_AUDITORIA.md`, adaptada a código)

La auditoría de seguridad probaba exploits reales con `BEGIN...ROLLBACK` antes y después de cada
fix. Acá el equivalente es: **todo archivo que se toca se prueba antes y después del cambio — no
solo se lee y se opina.** No es una auditoría pasiva de "esto se ve mal"; es auditar-y-corregir en
el mismo movimiento, igual que se hizo con las RLS/RPCs.

Para cada archivo/pantalla que entra en una fase:
1. **Smoke test ANTES de tocar nada** — abrir la pantalla real (`preview_start`/browser), ejercitar
   el flujo principal y los casos borde relevantes, y anotar el comportamiento base (qué funciona,
   qué no). Esto es la línea de base contra la que se compara después.
2. **Aplicar el cambio de la fase** (split de archivo, migración a `useQuery`, lazy-load, lo que
   corresponda).
3. **Smoke test DESPUÉS** — repetir exactamente los mismos casos del paso 1. Build limpio
   (`npx vite build`) es condición necesaria pero no suficiente; no reemplaza probar la pantalla.
4. **Dos clases de error a corregir, no solo documentar:**
   - **Errores que aparecen recién al probar** (algo que andaba bien y ahora rompe, o un caso
     borde que el refactor no contempló) → se corrigen ahí mismo antes de dar la fase por cerrada.
   - **Errores que ya estaban ahí y se detectan solo leyendo el código** al tocarlo (sin necesidad
     de reproducirlos con un test) — ej. un `catch` que traga el error, un cálculo con el operador
     mal puesto, una condición invertida — **también se corrigen en el momento**, no se anotan para
     "una próxima sesión". Mismo criterio que en la auditoría de seguridad: si se encuentra un
     hallazgo real mientras se está ahí, se cierra ahí.
5. Solo se da por cerrado un archivo/pantalla cuando el smoke test post-cambio no muestra ninguna
   regresión Y no quedan errores detectados sin corregir.

Única excepción real: si un hallazgo requiere una decisión de negocio que el usuario debe tomar (no
es un bug de código sino una ambigüedad de reglas), ahí sí se documenta y se sigue — igual que los
2 pendientes de decisión de negocio que quedaron en `PLAN_AUDITORIA.md` (esquema contable, cheques
propios). Todo lo demás que sea claramente un bug, se corrige.

---

## Fases propuestas (orden por impacto/riesgo, no por facilidad)

### Fase A — Higiene de herramientas (bajo riesgo, alto apalancamiento) — ✅ EJECUTADA (commit `e45152f`)
Se hace primero porque destapa automáticamente muchos hallazgos de las fases siguientes.
1. Endurecer `eslint.config.mjs` gradualmente: reactivar `no-unused-vars` y `react/prop-types`
   primero como `warn` (no `error`) para no bloquear el build, correr una vez y ver el volumen real
   de hallazgos antes de decidir si se sube a `error`.
2. Evaluar agregar Prettier + hook de pre-commit (o solo `.editorconfig` si el equipo no quiere
   reformateo masivo del historial de diffs).
3. Medir bundle real: correr `npx vite build` con `--mode analyze` o `rollup-plugin-visualizer` para
   confirmar qué módulos inflan `index-*.js` antes de decidir cómo cortarlo.

### Fase B — Bundle / performance de carga (impacto directo en UX del POS) — ✅ EJECUTADA (commit `7fad0c2`)
1. Dynamic `import()` de `react-pdf` (solo se usa para generar PDF de facturas/tickets) — no debería
   estar en el bundle principal.
2. Code-splitting por sección usando `React.lazy()` en el router de `Dashboard.jsx` — cada sección
   (`ProductosSection`, `ConfiguracionSection`, etc.) se carga bajo demanda en vez de todo junto.
3. Revisar si `html2canvas` (201 KB) y `purify.es` (22 KB) están también en el camino crítico o son
   parte de la misma cadena de generación de PDF (probablemente sí — mismo fix que #1 los arrastra).

### Fase C — Archivos gigantes (mantenibilidad, uno por uno, empezando por el peor) — ✅ EJECUTADA (15/15 archivos, ver CONTEXT.md)
Orden sugerido por tamaño: `ConfiguracionSection.jsx` (2937) → `PlanCuentasSection.jsx` (1843) →
`CuentasBancariasSection.jsx` (1288) → `CompraRapidaSection.jsx` (1214) → el resto (>650 líneas).
Para cada uno: separar en sub-componentes por tab/sección visual (muchos de estos archivos ya son
"7 tabs en un solo archivo", como se documentó para `PlanCuentasSection` en sesiones previas) y
extraer lógica de negocio a hooks custom donde tenga sentido. **No tocar la lógica de negocio en sí
sin un smoke test manual de esa pantalla.**

### Fase D — Consistencia de patrones de datos

**Estado (2026-07-07):** ✅ EJECUTADA.

**Estándar decidido:** `useQuery` (TanStack Query) para todo fetch de datos desde Supabase (listas,
detalle, cualquier GET). `useEffect` queda reservado exclusivamente para efectos imperativos que
no son fetch — listeners de DOM (click-outside), suscripciones a Supabase Realtime, timers, foco
de inputs. Motivo: el proyecto ya usa `useQuery` en 12+ archivos con un patrón consistente
(`queryKey` + `enabled` + invalidación vía `queryClient`), da cache/refetch/loading-state gratis, y
evita el bug clásico de fetch manual (condición de carrera si el componente se desmonta antes de
que resuelva la promesa, olvido de invalidar tras una mutación, etc.).

**Re-verificación en frío del hallazgo original (research de sesión previa a Fase C):** de los 5
archivos originalmente flageados con mezcla `useEffect`/`useQuery`, 2 ya habían quedado limpios
como efecto colateral de la modularización de Fase C:
- `CuentasBancariasSection.jsx` — ya 100% `useQuery`, sin `useEffect`. Sin acción.
- `PlanCuentasSection.jsx` — ya 100% `useQuery`, sin `useEffect` (el fetch de períodos vive en
  `TabPeriodos.jsx`, un sub-componente aparte, con su propio `useEffect` legítimo — no es el mismo
  archivo que se auditó originalmente). Sin acción.

Los 3 restantes sí tenían mezcla real y se migraron:
- **`ProductosSection.jsx`** — `fetchInitialData` (productos+categorías+proveedores) y
  `fetchMovements` (historial con filtros) migrados a `useQuery`.
- **`CotizacionesSection.jsx`** — el `useEffect` que cargaba productos/clientes para autocompletar
  migrado a `useQuery`. El otro `useEffect` (listener de click-outside para cerrar dropdowns) se
  dejó intacto — no es fetch, es el uso correcto de `useEffect`.
- **`ClientDetailModal.jsx`** — `fetchDetails` (cliente + movimientos + comprobantes vinculados)
  migrado a `useQuery` keyed por `clientId`, con `enabled: open && !!clientId`; el refresco tras
  registrar un cobro pasó de llamar `fetchDetails()` a mano a `queryClient.invalidateQueries`.

No se extrajeron hooks custom por dominio (`useProductos`, `useClientes`) en esta pasada — no hay
un segundo consumidor real de esas queries hoy que justifique la abstracción (evitar
sobre-ingeniería sin necesidad concreta, ver principio de la skill de simplicidad).

### Fase E — Duplicación de modales ventas↔compras — ✅ EJECUTADA (2026-07-07, sesión 51)

Se evaluaron los 5 pares candidatos con criterio de negocio (no solo métrica de líneas):

**Unificados (3 pares → 3 componentes en `shared/`):**
- `GenerarEntregaModal` + `GenerarRecepcionModal` → [`shared/GenerarMovimientoModal.jsx`](src/components/shared/GenerarMovimientoModal.jsx)
  (`tipo: 'entrega'|'recepcion'`). Sin divergencia de negocio real — eran casi el mismo código.
  Ahora siempre fetch-ea fresco por id (antes `GenerarEntregaModal` confiaba en `pedido_items` ya
  cargados por el padre, que podían quedar desactualizados con entregas parciales concurrentes).
  Probado en vivo: entrega real generada (PED-20260626-001 → ENT-2026-0078) y fetch/cálculo de
  recepción verificado.
- `NuevaNotaDebitoModal` + `NuevaNDProveedorModal` → [`shared/NuevaNotaDebitoModal.jsx`](src/components/shared/NuevaNotaDebitoModal.jsx)
  (`tipo: 'cliente'|'proveedor'`). Ambos eran wrappers delgados sobre la misma RPC `crear_nota_debito`,
  sin AFIP ni asientos de por medio. Probado en vivo: ND-2026-0004 (proveedor, origen bloqueado desde
  Factura de Compra) y ND-2026-0005 (cliente, standalone) registradas con éxito real en Nalux.
- `NuevaDevolucionModal` + `NuevaDevolucionProveedorModal` → [`shared/NuevaDevolucionModal.jsx`](src/components/shared/NuevaDevolucionModal.jsx)
  (`tipo: 'cliente'|'proveedor'`). Ambos comparten la RPC `crear_devolucion`; el lado proveedor
  soporta 2 fuentes de origen (Factura de Compra u OC directamente) vía un campo `origen.fuente`.
  Probado en vivo: DEV-2026-0012 (cliente, con comprobante, generó NC automática) y DEV-2026-0013
  (proveedor, fuente compra, generó NC automática) registradas con éxito real.

**NO unificados (2 pares) — divergencia de negocio real, no vale la pena forzar:**
- `NuevaFacturaModal` ↔ `NuevaFacturaProveedorModal`: ventas tiene integración AFIP/ARCA (cola de
  CAE), asiento contable automático y cálculo de `fecha_vencimiento`; compras tiene moneda paralela
  (TC) y número de factura manual del proveedor. Mezclar ambas lógicas en un solo componente
  aumentaría el riesgo de regresión en flujos críticos (facturación electrónica, contabilidad) sin
  ahorro real de mantenimiento.
- `NuevaNCModal` ↔ `NuevaNCProveedorModal`: mismo motivo — la NC de ventas también encola en AFIP.

**Resultado:** 4 archivos de modal eliminados, 3 componentes compartidos nuevos en `src/components/shared/`,
8 call sites actualizados (`PedidosSection`, `OrdenesCompraSection`, `FacturasCompraSection`,
`DevolucionesSection`, `HistorialVentas`). Build limpio, 0 errores de lint (solo warnings preexistentes),
todos los flujos probados con datos reales en el tenant Nalux.

### Fase F — Limpieza menor — ✅ EJECUTADA (2026-07-07, sesión 51)

- **Duplicación `components/reportes/` vs `components/reports/` resuelta:** `reports/` solo tenía
  2 componentes genéricos (`ReportHeader.jsx`, `ReportTable.jsx`) consumidos únicamente por
  `reportes/ModalReporte.jsx` — no era duplicación real, solo inconsistencia de naming (inglés vs
  español). Se movieron ambos archivos a `reportes/` (carpeta española, consistente con el resto del
  proyecto), se actualizó el único import, y se eliminó la carpeta `reports/` vacía.
- **Barrido de `no-unused-vars` completo:** de 220 warnings a 3 (2186 warnings totales restantes son
  casi todos `react/prop-types`, fuera de alcance de esta fase — ver Fase A).
  - 155 imports de `React` sin uso eliminados (proyecto usa el JSX runtime automático de
    `@vitejs/plugin-react`, no necesita `import React from 'react'` salvo donde se usa `React.algo`
    explícitamente).
  - 63 imports/variables/parámetros sin uso adicionales limpiados (íconos de lucide-react sin usar,
    componentes de `ui/` sin usar, destructuring de hooks con campos no leídos, parámetros de
    función no usados).
  - 3 casos **dejados intencionalmente sin tocar** por ser posibles gaps de producto (no leftovers
    de refactor) — requieren decisión de negocio, no limpieza mecánica:
    - `TabPlanCuentas.jsx`: `handleToggleActiva` está completamente implementado pero no conectado a
      ningún botón — activar/desactivar una cuenta contable podría ser una función real faltando su
      UI, no código muerto.
    - `DataTable.jsx`: `pageSize` es un prop público documentado en el JSDoc del componente
      compartido — quitarlo cambiaría el contrato de la API aunque el body no lo lea hoy.
    - `ComprobantePrintModal.jsx`: `pagoLabel` calcula correctamente el desglose de pagos múltiples,
      pero el template impreso usa `comprobante.forma_pago` directo (línea 231) — el comprobante
      impreso no muestra el desglose cuando hay más de un método de pago. Posible bug real, no dead
      code.
  - Verificado en vivo en Nalux tras el barrido completo: Dashboard, Clientes, Caja, Usuarios,
    Cuentas Bancarias (incl. tab Conciliación) — sin errores de consola, sin regresiones visuales.

---

## Qué NO entra en esta auditoría (ya cerrado o fuera de alcance)
- Seguridad, RLS, permisos, integridad transaccional → **ya auditado y cerrado**, ver `PLAN_AUDITORIA.md`.
- Migración completa JS→TS de toda la capa de componentes — es un proyecto en sí mismo, se puede
  proponer como fase separada a futuro si el usuario lo pide explícitamente, no incluido acá por
  defecto dado el volumen (183 archivos).
- Tests unitarios/E2E — no existen hoy (fuera del pgTAP de la capa DB, ya cubierto en la otra
  auditoría); agregarlos es una decisión de proceso distinta a "auditar el código existente".

## Cómo retomar
Este documento no tiene ningún ítem ejecutado todavía. Al retomar: confirmar con el usuario el
orden de fases (se puede reordenar — por ejemplo, si el dolor real percibido es "la app carga
lento", arrancar directo por Fase B en vez de Fase A). Cada fase debe cerrar con: build verificado
+ smoke test manual de las pantallas tocadas + commit separado por fase (no mezclar Fase B con Fase C
en el mismo commit).
