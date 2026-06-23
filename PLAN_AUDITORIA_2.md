# Plan de Auditoría 2 — KAIROX Gestión

**Generado:** 2026-06-22 (sesión 52), pausado por créditos a mitad de camino.
**Objetivo:** auditar todo lo que las sesiones 36-51 NO cubrieron (esas se centraron 100% en `productos.stock_actual` + exposición de RPCs a `anon` + performance). Esta ronda busca solidez general: RLS en el resto del sistema, guards de tenant en RPCs no relacionadas a stock, precisión de cálculos financieros, y manejo de errores.

**Contexto necesario antes de seguir:** leer `CONTEXT.md`, sección "Sesión 52 — Segunda auditoría: RLS más allá de `stock_actual`" — tiene el detalle completo de los 2 hallazgos ya resueltos (no repetirlos).

---

## 0. Ya hecho en esta auditoría (sesión 52) — NO repetir

- ✅ **Migration 071** — `movimientos_uala` tenía una policy de SELECT que no filtraba por `empresa_id` (fuga cross-tenant real, confirmada con `BEGIN...ROLLBACK`, no teórica). Corregido.
- ✅ **Migration 072** — `profiles` no tenía ninguna policy que permitiera a un admin ver a sus colegas de la misma empresa. `UsuariosSection.jsx` mostraba la lista de usuarios vacía/incompleta en producción. Corregido.
- ✅ Build verificado, todo commiteado y pusheado (`a25dded`).
- ✅ **Cobertura de RLS a nivel tabla, mapeada por completo:** se corrió una consulta sobre `pg_class`/`pg_policy` contra las ~50 tablas con `empresa_id` para confirmar que TODAS tienen RLS habilitado y que sus policies mencionan `empresa_id` (o son casos especiales ya entendidos: `rate_limit_attempts` con `deny_all` intencional, `retenciones_acumulado_mensual`/`v_saldo_proveedores` son VIEWS que heredan RLS de sus tablas base). Esto descartó que haya OTRA tabla con el mismo problema que `movimientos_uala`.

**Nota metodológica importante:** ese chequeo fue un heurístico textual (¿la policy *menciona* `empresa_id`?), no una verificación semántica de que la lógica sea correcta en cada caso. Sirvió para encontrar los 2 hallazgos de arriba, pero no garantiza al 100% que cada policy individual esté bien — selección 1 abajo profundiza en las RPCs, que es donde la lógica real vive.

---

## 1. 🔴 Pendiente — Guards de tenant en RPCs no relacionadas a `stock_actual`

Las sesiones 36-46 auditaron a fondo las 8 RPCs `SECURITY DEFINER` que tocan `stock_actual` (ya tienen el guard `empresa_id = get_my_empresa_id()` + lock `FOR UPDATE` confirmado y testeado). **Esta auditoría nunca tocó el resto de las RPCs** del sistema. Áreas concretas a revisar:

- `crear_nota_debito` / notas de crédito — ¿tiene el mismo guard de tenant que `crear_venta`/`crear_devolucion`? (Nota: ya se confirmó en sesión 47 que `EXECUTE` está revocado de `anon` para ésta — falta confirmar la LÓGICA interna, no solo el grant.)
- Cheques (`cheques`, `cheques_historial`) — cualquier RPC que cambie estado de un cheque (depositar, rechazar, etc.)
- Retenciones (`retenciones`, `retenciones_acumulado_mensual`) — RPCs de cálculo/acumulado
- Conciliación bancaria (`movimientos_bancarios`, `fn_sync_conciliado`, cualquier RPC de matching) — además de lo que ya se tocó para Ualá/MP
- Plan de cuentas / asientos contables (`asientos_contables`, `asientos_items`, `next_numero_asiento`, `recalcular_saldo_cuenta`) — verificar que el asiento automático (`asientosAutoService`, mencionado en `sap-reference`) no permita mezclar `empresa_id` entre el comprobante origen y el asiento generado

**Metodología sugerida:** `SELECT proname, pg_get_functiondef(oid) FROM pg_proc WHERE prosecdef = true AND pronamespace = 'public'::regnamespace` para listar TODAS las `SECURITY DEFINER`, tachar las 8 de stock + las ya revisadas, y leer la definición de cada una del resto buscando si reciben `p_empresa_id` como parámetro y si lo comparan contra `get_my_empresa_id()` antes de cualquier operación.

---

## 2. 🟡 Pendiente — Precisión de cálculos financieros

No auditado nunca en este proyecto. Riesgo típico en sistemas con IVA + moneda paralela:

- Redondeo de IVA discriminado (`crear_venta` usa `ROUND(v_neto_total, 2)` — confirmar que el resto de los cálculos de impuestos en otras RPCs/frontend sea consistente, no mezcla de `Math.round` en JS vs `ROUND` en SQL con reglas distintas)
- Cálculo de moneda paralela (`monto_paralelo`/`tc_paralelo`) — ¿hay algún punto donde se pierda precisión por usar `float`/`number` de JS en vez de `numeric` de Postgres antes de persistir?
- Costo PPP (`fn_calcular_costo_valoracion`) — ya tiene lock `FOR UPDATE` (sesión 39), pero no se revisó precisión de redondeo intermedio en compras encadenadas.

**Recomendación:** para este punto específico, invocar la skill `anthropic-skills:auditor-contable` (apareció disponible recién, no se había usado antes en este proyecto) — está diseñada exactamente para esto: marco RT FACPCE/IFRS, cubre impuestos/multi-moneda/cierre de período, y devuelve un informe con score ✅/⚠️/❌ por área. Mejor punto de partida que grep manual.

---

## 3. 🟡 Pendiente — Patrones de manejo de errores silenciosos

Ya se encontraron y corrigieron 2 casos de `console.error`/`console.warn` en vez de `throw` (sesión 33, `aplicar_compra_producto`; sesión 49, `CompraRapidaSection.jsx`). Nunca se hizo un grep sistemático de TODO `src/` para ver si el patrón se repite en otro lado.

**Comando sugerido para arrancar:**
```bash
grep -rn "console\.\(error\|warn\)" src/ --include="*.jsx" --include="*.js" -B2 | grep -B2 "catch"
```
Revisar cada resultado: ¿el catch silencia un error que debería propagarse (deja datos a medio escribir) o es un error genuinamente no-crítico (ej. fallo de un fetch opcional)?

---

## 4. ✅ Ya cubierto, no repetir

- Edge functions (`invite-user`, `create-user`, `delete-user`, `generar-csr`, `emitir-cae`, `mp-webhook`) — auditadas sesión 47-48, todas usan `verifyAdmin()` o validación de firma correctamente.
- Exposición de RPCs `SECURITY DEFINER` a `anon`/`authenticated` sin necesidad — sesión 47, migrations 063-064.
- Performance (RLS initplan, índices duplicados, tablas backup) — sesión 50, migrations 067-068.
- Todo lo de `stock_actual` (8 RPCs, locks, guards, trazabilidad) — sesiones 36-46.
- Fase 1 y 2 de tests pgTAP — sesiones 36-46 y 51.
- Ualá: arquitectura movida de Caja a Bancos — sesión 51, migrations 069-070.

---

## 5. Convenciones (iguales a las de `PLAN_SEMANA.md`)

- Migrations: la última aplicada es `072`. Confirmar con `ls supabase/migrations | tail -5` antes de crear la siguiente.
- Nunca tocar empresas reales (`db21dfad-...`, `cbc4db74-...`) — usar tenants sintéticos en `BEGIN...ROLLBACK`, igual que en toda esta sesión.
- Patrón de verificación de cualquier hallazgo de RLS: reproducir el problema con `BEGIN...ROLLBACK` ANTES del fix (confirmar que es real, no asumido) y DESPUÉS del fix (confirmar que cierra), igual que se hizo con `movimientos_uala` y `profiles` en esta sesión.
- Cada hallazgo real → su propia migration con comentario explicando qué se encontró y por qué, + rollback comentado al final (convención establecida desde sesión 47).

---

## 6. Orden sugerido al reanudar

| Paso | Foco |
|---|---|
| 1 | Sección 1 (guards de tenant en RPCs no-stock) — es la continuación más natural del método que ya viene funcionando |
| 2 | Sección 2 (cálculos financieros) — considerar invocar `anthropic-skills:auditor-contable` |
| 3 | Sección 3 (errores silenciosos) — grep + revisión manual de cada resultado |
| 4 | Build + `get_advisors` + actualizar `CONTEXT.md` + commit/push de todo lo encontrado en esta segunda tanda |
