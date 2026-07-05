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

### Fase A — Higiene de herramientas (bajo riesgo, alto apalancamiento)
Se hace primero porque destapa automáticamente muchos hallazgos de las fases siguientes.
1. Endurecer `eslint.config.mjs` gradualmente: reactivar `no-unused-vars` y `react/prop-types`
   primero como `warn` (no `error`) para no bloquear el build, correr una vez y ver el volumen real
   de hallazgos antes de decidir si se sube a `error`.
2. Evaluar agregar Prettier + hook de pre-commit (o solo `.editorconfig` si el equipo no quiere
   reformateo masivo del historial de diffs).
3. Medir bundle real: correr `npx vite build` con `--mode analyze` o `rollup-plugin-visualizer` para
   confirmar qué módulos inflan `index-*.js` antes de decidir cómo cortarlo.

### Fase B — Bundle / performance de carga (impacto directo en UX del POS)
1. Dynamic `import()` de `react-pdf` (solo se usa para generar PDF de facturas/tickets) — no debería
   estar en el bundle principal.
2. Code-splitting por sección usando `React.lazy()` en el router de `Dashboard.jsx` — cada sección
   (`ProductosSection`, `ConfiguracionSection`, etc.) se carga bajo demanda en vez de todo junto.
3. Revisar si `html2canvas` (201 KB) y `purify.es` (22 KB) están también en el camino crítico o son
   parte de la misma cadena de generación de PDF (probablemente sí — mismo fix que #1 los arrastra).

### Fase C — Archivos gigantes (mantenibilidad, uno por uno, empezando por el peor)
Orden sugerido por tamaño: `ConfiguracionSection.jsx` (2937) → `PlanCuentasSection.jsx` (1843) →
`CuentasBancariasSection.jsx` (1288) → `CompraRapidaSection.jsx` (1214) → el resto (>650 líneas).
Para cada uno: separar en sub-componentes por tab/sección visual (muchos de estos archivos ya son
"7 tabs en un solo archivo", como se documentó para `PlanCuentasSection` en sesiones previas) y
extraer lógica de negocio a hooks custom donde tenga sentido. **No tocar la lógica de negocio en sí
sin un smoke test manual de esa pantalla.**

### Fase D — Consistencia de patrones de datos
1. Decidir el estándar: ¿todo migra a TanStack Query, o se documenta cuándo `useEffect` es
   aceptable (ej. suscripciones a realtime de Supabase)?
2. Para los 5 archivos con mezcla confirmada (`ProductosSection`, `CuentasBancariasSection`,
   `CotizacionesSection`, `ClientDetailModal`, `PlanCuentasSection`), migrar el fetch manual a
   `useQuery` uno por uno.
3. Evaluar extraer hooks custom por dominio (`useProductos`, `useClientes`, etc.) para no repetir la
   misma query en cada componente que necesite esos datos.

### Fase E — Duplicación de modales ventas↔compras
Para cada par identificado, evaluar si conviene una única implementación parametrizada
(`tipo: 'cliente' | 'proveedor'`) o si las diferencias de negocio justifican mantenerlos separados
— **esto requiere criterio, no solo métrica de líneas duplicadas**, dado que ventas y compras tienen
reglas de negocio distintas (ej. IVA, alícuotas, forma de pago) que podrían no valer la pena
unificar si la lógica diverge mucho.

### Fase F — Limpieza menor
- Resolver la duplicación `components/reportes/` vs `components/reports/` (decidir cuál queda,
  mover el contenido, actualizar imports).
- Barrido de `no-unused-vars` una vez activado el lint (Fase A) — probablemente destape imports
  muertos, variables sin usar, código comentado viejo.

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
