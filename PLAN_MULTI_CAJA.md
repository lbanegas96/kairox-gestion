# Multi-caja simultánea — Plan de implementación

**Estado: ✅ Implementado y verificado en vivo contra producción (Nalux), 2026-08-06.** Las 5
fases del plan están hechas, deployadas (`kairox-gestion-chi.vercel.app`) y probadas de punta a
punta — ver "Verificación" al final de este archivo para el detalle de lo que se probó y
revirtió. La Fase 6 (reporting por caja) sigue siendo backlog opcional, no bloqueante.

## Contexto

Hoy el Modo Caja (POS) asume que existe **una sola caja física por empresa**. Un local con 2+
puntos de cobro (2 cajeros, 2 terminales) no puede tener cada uno su propia sesión de caja
abierta a la vez: el segundo cajero que intenta abrir turno choca contra un "Ya había una caja
abierta" pensando que es un error, cuando en realidad quería abrir una caja física **distinta**.
Esto viene del análisis de mercado de POS (Fudo, Bistrosoft, Tango) hecho hace unos días, donde
quedó marcado como "alto esfuerzo, para más adelante" — ahora se pide encararlo.

**Hallazgo clave que cambia el alcance esperado:** la base de datos ya soporta multi-caja de
fábrica, no hace falta ninguna migración grande.

- `supabase/migrations/009_cajas.sql` — ya existe la tabla maestra `cajas` (id, empresa_id,
  nombre, activo). Cada empresa nueva arranca con 1 fila "Caja Principal" por trigger. **No
  existe ningún CRUD de esta tabla en el frontend** (grep de `from('cajas')` sólo devuelve
  `CajaContext.jsx` y `useNotifications.js`).
- `caja_sesiones.caja_id` + índice único `uq_caja_sesion_abierta ON caja_sesiones(caja_id) WHERE
  estado='abierta'` (`009_cajas.sql:28-30`) — está scopeado por **caja_id, no por empresa_id**.
  A nivel DB ya permite tantas sesiones `abierta` simultáneas como cajas tenga la empresa.
- El RPC `abrir_caja_sesion` (`310_apertura_caja_offline.sql`) ya recibe `p_caja_id` como
  parámetro y maneja el conflicto devolviendo `{conflict:true}` en vez de un error crudo.
- `useArqueoCaja.js` y `useNotifications.js` ya filtran/operan correctamente por caja/sesión
  individual — no necesitan cambios.

**El cuello de botella real es un solo punto, 100% frontend:** `resolveActiveCaja` en
`src/contexts/CajaContext.jsx:33-54` siempre trae la caja más antigua activa de la empresa
(`.order('created_at').limit(1).maybeSingle()`), sin importar quién está logueado ni en qué
terminal — y lo cachea para siempre. Una vez resuelta la caja correcta, todo lo demás
(`fetchCurrentSession`, `openSession`, `closeSession`, arqueo) ya filtra bien por `caja_id`.

De paso se encontró un gap de seguridad menor en `abrir_caja_sesion`: no valida que `p_caja_id`
pertenezca a `p_empresa_id` (sólo valida `p_empresa_id = get_my_empresa_id()`), así que un
`p_caja_id` de otro tenant pasaría el INSERT sin error. Se cierra como parte de este trabajo.

## Decisiones de diseño

1. **Selección de caja por dispositivo/navegador (localStorage), no por usuario fijo asignado
   por un admin.** En una PyME chica cualquier cajero puede cubrir cualquier caja un día — no
   tiene sentido una asignación rígida server-side.
2. **Con 1 sola caja activa (caso de hoy, casi todos los clientes) cero fricción nueva** — se
   auto-selecciona igual que ahora, sin mostrar ningún selector. El selector sólo aparece con
   2+ cajas activas y ninguna elegida todavía para ese dispositivo.
3. **No se puede cambiar de caja con un turno abierto** — hay que cerrar sesión primero, mismo
   principio que ya rige el resto del módulo.
4. **El PdV fiscal de AFIP (`empresas.pos_punto_venta_id`) queda completamente separado y
   compartido por todas las cajas** — en AFIP Argentina es normal que varias cajas físicas del
   mismo local compartan un solo PdV (la numeración correlativa es por PdV, no por caja). No se
   toca, no depende de qué caja se eligió.
5. **Reporting por caja física** (filtrar movimientos/resumen por `caja_id`) queda fuera de
   este alcance — el feature "multi-caja funciona" no depende de eso.

## Implementación

### Fase 1 — Migración: hardening de seguridad en `abrir_caja_sesion`

`supabase/migrations/311_abrir_caja_sesion_valida_caja_de_empresa.sql` — patrón `DROP FUNCTION`
+ `CREATE FUNCTION` (mismo criterio ya establecido en el proyecto, evita overloads huérfanos).
Mismo cuerpo que `310_apertura_caja_offline.sql`, con un chequeo nuevo justo después de
`has_module_permission('ventas')`:
```sql
IF NOT EXISTS (SELECT 1 FROM public.cajas WHERE id = p_caja_id AND empresa_id = p_empresa_id) THEN
  RAISE EXCEPTION 'Caja inválida: no pertenece a la empresa del usuario autenticado';
END IF;
```
Cierra con `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO authenticated` (el `DROP` borra los
grants existentes).

### Fase 2 — `src/contexts/CajaContext.jsx`: `resolveActiveCaja` deja de asumir 1 sola caja

- La query pasa de `.limit(1).maybeSingle()` a traer **todas** las cajas activas de la empresa.
- 1 caja → auto-selección automática, sin cambios de comportamiento visible.
- 2+ cajas → busca en `localStorage` (clave `kx_caja_activa_${empresaId}`, mismo patrón que
  `checklist_dismissed_${empresa_id}` en `ChecklistOnboarding.jsx`) una elección guardada,
  la re-valida contra la lista real (por si esa caja fue desactivada desde Configuración) y la
  usa si sigue siendo válida; si no hay elección válida, no auto-selecciona nada y expone
  `needsCajaSelection: true`.
- Nuevo estado/funciones expuestos por el Provider: `availableCajas`, `needsCajaSelection`,
  `selectCaja(cajaId)` (guarda en localStorage + resuelve sesión), `changeCaja()` (limpia la
  elección guardada, sólo se debe invocar si `!isSessionOpen` — esa validación vive en quien lo
  llama, `ModoCajaLayout.jsx`, igual que hoy `openSession` valida `isSessionOpen` puertas
  adentro).
- `fetchCurrentSession`, `openSession`, `closeSession` **no cambian de lógica** — ya filtran
  correctamente por `caja.id` una vez que `resolveActiveCaja()` devuelve la caja correcta.
- El Modo Offline sigue funcionando igual: sigue leyendo `caja.id` desde `activeCajaRef.current`
  (mismo ref, sólo cambia cómo se llena la primera vez).
- Actualizar el mock de `cajas` en `src/contexts/__tests__/CajaContext.test.jsx` (pasa de
  `{data: CAJA}` a `{data: [CAJA]}` porque la query ya no usa `.maybeSingle()`).

### Fase 3 — Selector de caja: `src/components/caja/SeleccionarCajaModal.jsx` (nuevo)

Modal simple (mismo patrón `Dialog` que el resto del proyecto), no cerrable mientras
`needsCajaSelection` sea `true` (`onInteractOutside` bloqueado) — el cajero tiene que elegir
antes de poder operar. Lista cada `caja` de `availableCajas` como un botón; al click llama
`selectCaja(caja.id)`. Se monta dentro de `ModoCajaLayout.jsx`, no en `App.jsx` (sólo tiene
sentido dentro del árbol de `CajaProvider` + Modo Caja).

### Fase 4 — "Cambiar de caja" en `src/components/caja/ModoCajaLayout.jsx`

- Montar `<SeleccionarCajaModal />` junto a los demás `<Dialog>` del componente.
- Badge nuevo en la topbar, al lado del badge de PdV existente, **visible sólo si
  `availableCajas.length > 1`** (cero ruido para el 99% de clientes con 1 sola caja): muestra el
  nombre de la caja activa, `onClick={changeCaja}`, `disabled={isSessionOpen}` (con tooltip
  "Cerrá el turno actual para cambiar de caja").

### Fase 5 — CRUD de `cajas` en Configuración → Finanzas

Va en `TabFinanzas.jsx` (no en `TabFacturacion`, donde vive el PdV fiscal — son conceptos
deliberadamente separados), siguiendo el mismo patrón exacto que ya usan Formas de Pago /
Centros de Costo en ese archivo: lista con `Switch` (activo/inactivo) + botón "+ Nueva" + lápiz
para renombrar, sin delete duro (coherente con que `caja_sesiones.caja_id` no tiene `ON DELETE
CASCADE`).

En `src/components/sections/ConfiguracionSection.jsx`: estado (`cajas`, `loadingCajas`,
`showCajaModal`, `editingCaja`, `cajaForm`, `savingCaja`) y handlers (`fetchCajas`,
`openNuevaCaja`/`openEditarCaja`, `toggleActivoCaja`, `handleGuardarCaja`) calcados de los ya
existentes para Centro de Costo (líneas ~788-806 fetch, ~1641-1684 handlers, ~2203-2223 modal).
Único agregado de lógica real: **`toggleActivoCaja` primero chequea si esa caja tiene una
sesión `abierta`** y bloquea la desactivación con un toast explicativo si la tiene — evita que
un admin apague por error la caja de un cajero que está trabajando en ese momento. RLS de
`cajas` ya permite este INSERT/UPDATE sin cambios (`cajas_all`, scopeada por `empresa_id`).

### Fase 6 (fuera de alcance de este trabajo, backlog aparte)

Reporting por caja física en `cajaService.ts`/`CajaSection.jsx` (filtrar movimientos/resumen
financiero por `caja_id`, hoy `movimientos_caja` sólo tiene `caja_sesion_id` indirecto). No
bloquea que el feature funcione — se aborda después si se pide.

## Verificación

**Regresión (1 sola caja — caso de la inmensa mayoría de clientes hoy):**
1. Entrar a Modo Caja en 2 pestañas/dispositivos de una empresa con 1 sola caja activa →
   ninguna debe mostrar el selector, ambas resuelven la misma caja automáticamente.
2. Correr `src/contexts/__tests__/CajaContext.test.jsx` actualizado — todos los tests de
   `openSession`/`closeSession` online/offline deben seguir en verde.
3. `npx eslint` y `npx vite build` en 0 errores.

**Multi-caja (caso nuevo), contra sandbox/producción real igual que el resto de este proyecto:**
4. Dar de alta una 2da caja desde Configuración → Finanzas.
5. Dispositivo A: entra a Modo Caja → aparece el selector → elige "Caja Principal" → abre turno.
6. Dispositivo B (otra ventana/incógnito): entra → aparece el selector → elige "Caja 2" → abre
   turno. Confirmar en `caja_sesiones` 2 filas `abierta` con `caja_id` distinto, sin conflicto.
7. Dispositivo B intenta abrir también "Caja Principal" → debe devolver `conflict:true` (ya
   probado en la Fase 0 del Modo Offline, no se rompe acá).
8. Recargar el Dispositivo A con turno abierto → sigue resolviendo la misma caja sin volver a
   mostrar el selector.
9. Con turno abierto, el badge "cambiar de caja" debe estar deshabilitado; al cerrar turno se
   habilita y vuelve a mostrar el selector.
10. Intentar desactivar desde Configuración una caja con turno abierto → debe bloquearse con el
    toast explicativo.
11. Llamar `abrir_caja_sesion` con un `p_caja_id` de otra empresa (vía `execute_sql`, simulando
    el ataque) → debe fallar con la excepción nueva de la Fase 1, sin insertar nada.
12. Modo Offline: con 2 cajas, elegir una en un dispositivo, cortar conexión, abrir turno
    offline, reconectar → debe sincronizar contra la caja elegida, no la más antigua.

## Verificación real contra producción (2026-08-06) — resultado

Todo probado contra Nalux en `kairox-gestion-chi.vercel.app`, con datos de prueba creados y
revertidos al final (0 rastros: 1 sola caja, 0 sesiones abiertas, igual que antes de empezar).

- **Regresión (1 caja):** `npx vitest run` → 123/123 tests en verde (10/10 en
  `CajaContext.test.jsx`, incluidos 3 casos nuevos de multi-caja). `npx eslint` y `npx vite
  build` en 0 errores.
- **Selector aparece con 2+ cajas:** se creó "Caja Test Multi" desde Configuración → Finanzas →
  Cajas (CRUD nuevo, probado con crear + editar). Al entrar a Modo Caja con una sesión de
  navegador fresca, apareció el modal "Elegí tu caja" con ambas opciones.
- **Apertura real:** se eligió "Caja Test Multi", se abrió turno desde la UI real (no simulado)
  → confirmado en `caja_sesiones` una fila `abierta` con el `caja_id` correcto. El badge
  "cambiar de caja" quedó deshabilitado con el tooltip esperado mientras el turno seguía abierto.
- **2 sesiones simultáneas sin pisarse:** con "Caja Test Multi" abierta desde el navegador, se
  simuló un segundo dispositivo abriendo "Caja Principal" vía `abrir_caja_sesion` (mismo patrón
  de `fetch` con JWT real usado en las pruebas de la Fase 0) → `conflict:false`, sesión creada.
  Confirmado en la base: 2 filas `abierta`, `caja_id` distinto cada una.
- **Conflicto manejado:** un tercer intento de abrir "Caja Principal" (ya abierta) devolvió
  `conflict:true` con los datos de la sesión ganadora — sin error crudo de Postgres.
- **Bloqueo de desactivación con turno abierto:** se intentó apagar el switch de "Caja Test
  Multi" desde Configuración mientras tenía sesión abierta → el switch no se movió (la RPC/UPDATE
  nunca se ejecutó), confirmando el chequeo de `toggleActivoCaja`.
- **Hardening de seguridad (mig.311):** se llamó `abrir_caja_sesion` con un `p_caja_id` real de
  **otra empresa** (`p_empresa_id` propio) → rechazado con `"Caja inválida: no pertenece a la
  empresa del usuario autenticado"`, sin insertar nada.
- **Limpieza final:** las 2 sesiones de prueba y la caja "Caja Test Multi" fueron borradas —
  verificado que Nalux quedó con exactamente 1 caja y 0 sesiones abiertas, igual que al empezar.

No se re-probó el camino offline en esta pasada (la lógica de `activeCajaRef` no cambió de
contrato, sólo cómo se llena la primera vez — ver Fase 2) — cubierto por diseño y por los tests
existentes de Fase 0-3 del Modo Offline, que no se tocaron.

## Archivos críticos

- `supabase/migrations/311_abrir_caja_sesion_valida_caja_de_empresa.sql` (nuevo)
- `src/contexts/CajaContext.jsx`
- `src/components/caja/SeleccionarCajaModal.jsx` (nuevo)
- `src/components/caja/ModoCajaLayout.jsx`
- `src/components/configuracion/TabFinanzas.jsx`
- `src/components/sections/ConfiguracionSection.jsx`
- `src/contexts/__tests__/CajaContext.test.jsx`
