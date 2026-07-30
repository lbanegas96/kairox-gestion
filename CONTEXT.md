# KAIROX Gestión — Contexto de Sesión
**Última actualización:** 2026-07-29 noche (Luciano/Claude — módulo Compras CERRADO: espejo NC/ND de Proveedor aplicado, probado en vivo y pusheado)

---

## ✅ Compras — CERRADO esta noche (todo aplicado, pusheado y probado en vivo)

Todo lo de la sección de abajo ("Trabajo de esta tarde") ya fue:
1. Revisado (self-review: se encontró y arregló un guard de tenant faltante en `caja_sesion_id`, commit `4ed8b7b`).
2. Aplicado a producción — migraciones 275, 276 y 277 aplicadas sin errores.
3. Pusheado a `origin/master` (commits hasta `fad73fc`).
4. `mp-sync` redesplegado (v14), verificado byte a byte.
5. **Probado en vivo, end-to-end, con datos reales creados y eliminados prolijamente:**
   - ND de Cliente: descripción de ítem ahora se guarda (fix mig.275) ✅
   - NC de Proveedor: numeración, neto/IVA, vínculo a Cuenta Corriente ✅
   - ND de Proveedor: ídem, numeración de la serie vieja (`notas_debito`, formato ND-YYYY-NNNN) ✅
   - **Reembolso en efectivo de NC Proveedor** (el camino que más dudas generaba): `reembolso_efectivo=true` + `caja_movimiento_id` poblado + guard de tenant de la caja, todo funcionando ✅
6. **Hallazgo y fix adicional (commit `fad73fc`):** el Mapa de Relaciones **ya existía** para Compras (no hacía falta construirlo) — pero la NC de Proveedor nueva (mig.277) rompía el vínculo: antes de mig.277, `cuenta_corriente_proveedores.referencia_id` apuntaba directo a la compra; ahora apunta al id de la NC (que ya tiene su propio `compra_id`). El Mapa buscaba por el patrón viejo y nunca encontraba la NC nueva. Se cambió el fetch para consultar `notas_credito_proveedor` directo por `compra_id` — verificado en vivo, la NC y la ND ahora aparecen correctamente en el árbol de documentos de su compra origen.
7. **Cancelación con reversa para NC/ND de Proveedor** (commit `eeee63f`, mig.278) — último pendiente, cerrado. Mismo patrón que `cancelar_nota_credito` (mig.267): documento de reversa, nunca se borra el original. Columna `estado` nueva en ambas tablas. Guard real: no se puede cancelar una NC ya cobrada en efectivo (el dinero ya cambió de manos). Botón "Cancelar" + confirmación en `DevolucionesProveedorSection.jsx`. **Probado en vivo end-to-end** (creación + cancelación + verificación del movimiento de reversa), datos de prueba limpiados.

**Migración 274 aplicada** (drop columnas deprecated `puntos_venta.ultimo_numero_a/b/c`) — era el pendiente que Nadia dejó a propósito para "dentro de ~1 semana" tras el deploy de `arca-worker` (mig.273). Se adelantó porque Luciano pidió explícitamente hacerlo ("hace lo que dejo Nadia pendiente"). Verificado antes de aplicar: `puntos_venta_numeracion` ya tenía filas vivas con `updated_at` de hoy (el worker ya escribe ahí en producción) y `grep` en `src/`+`supabase/functions/` no encontró ninguna lectura/escritura de las columnas viejas fuera de comentarios. DROP físico (no anulación lógica) porque son contadores técnicos internos, no un documento contable — el histórico real queda en `comprobantes.numero_afip`. Sin pendientes nuevos en advisors tras el DROP.

- `mp-sync` (el botón manual) ya redesplegado hoy — sin pendientes ahí.

## ✅ Fix contable: OC → Recepción → Factura (mig.279)

Stress-test de esta noche encontró que el flujo **OC → Recepción → Factura** ("3-way match", pantalla Órdenes de Compra) escribía en `facturas_proveedor` (mig.012) — una tabla que NUNCA se conectó al resto de la contabilidad: la deuda no aparecía en Cuenta Corriente Proveedores, `ReporteLibroIVACompras.jsx` no la veía, y "Marcar pagada" solo cambiaba un estado sin mover Caja/Bancos. Verificado antes de tocar nada: `facturas_proveedor` tenía 0 filas en producción — nadie lo usó, no había datos reales en riesgo.

**Fix aplicado (mig.279, acotado a propósito — no se tocó Compra Rápida ni Facturas de Compra manuales, quedan anotados abajo como backlog):**
- `compras.orden_compra_id` (nueva columna, único parcial) para vincular la factura a su OC.
- RPC atómica `registrar_factura_compra_oc`: crea `compras`+`detalle_compras` (ítems con IVA real por alícuota, no un monto suelto) + inserta la deuda en `cuenta_corriente_proveedores` (Open Item, patrón SAP — la Factura crea la deuda, el pago es un evento aparte vía `registrar_pago_proveedor`, que ya existe y ya mueve Caja/asiento). A propósito NO toca stock/costo — el stock físico ya se movió en la Recepción (Regla 8 SAP), volver a tocarlo duplicaría cantidades.
- `ModalRegistrarFactura.jsx` reescrito: ítems prellenados con lo recibido, alícuota IVA editable por ítem (default 21%), muestra Neto/IVA/Total.
- `ModalDetalleOC.jsx`: sacado el botón "Marcar pagada" (ya no aplica — Open Item se paga desde Proveedores → Cuenta Corriente), agregado el aviso correspondiente.
- **Probado en vivo end-to-end** (OC-00013 de prueba, Mercado Libre, 2×Mouse Vertical): creé OC → envié → recibí → registré factura FC-TEST-0001 → verifiqué en SQL `compras` (total $12.100, neto $10.000, IVA $2.100) + `detalle_compras` + el movimiento `cuenta_corriente_proveedores` (tipo='compra', +$12.100, referencia_tipo='compra_oc') — todo correcto. Confirmé también que el botón "Registrar Factura" desaparece solo si la OC ya tiene una (guard de duplicado, reforzado también en la RPC). Datos de prueba limpiados y verificados con conteo en cero.

**Hallazgos relacionados, NO tocados hoy (decisión explícita de no engordar el fix), quedan anotados para otra sesión:**
- `NuevaFacturaProveedorModal.jsx` ("Facturas de Compra", entrada manual): no llama a `asientosAutoService.crearAsientoCompra` — una factura registrada ahí no genera asiento contable. Además su banner dice "no modifica inventario" pero el código SÍ llama a `aplicar_compra_producto` — texto engañoso, contradicción a resolver.
- Compra Rápida (`CompraRapidaSection.jsx`): no discrimina IVA por ítem, asume 21% fijo (mismo comentario ya documentado en `ReporteLibroIVACompras.jsx` como "fallback").
- `comprasService.ts` (código muerto, nadie lo llama): línea 57 inserta `user_id: empresaId` — confunde usuario con empresa. Sin impacto real hoy.

**Con esto, el módulo Compras queda 100% al día con las mejoras que tenía Ventas — nada pendiente conocido salvo los 3 puntos de arriba (backlog, no bloqueantes).** Próximo paso pedido por Luciano: volver a Ventas.

---

## Trabajo de esta tarde (histórico — ya cerrado, ver arriba)

Se hizo un análisis + build completo (commits `b347398`, `45c3101`, `4ed8b7b`)
espejando en Compras las mejoras que Ventas ya tenía.

**Hallazgo que motivó esto (no solo simetría):** `ReporteLibroIVACompras.jsx`
solo leía `compras` — nunca veía una NC/ND de proveedor, así que el crédito
fiscal de IVA reportado nunca se ajustaba por esos documentos.

- **Migración 275** (fix, no build nuevo): `crear_nota_debito_cliente`
  (armada hoy mismo) nunca guardaba `descripcion` del ítem — comparado
  contra `crear_nota_credito` que sí lo hace. Verificado en la base: cero ND
  reales creadas todavía, sin historial afectado.
- **Migración 276**: `notas_debito_items` + `notas_debito.neto_gravado`/
  `iva_discriminado` + RPC nueva `crear_nota_debito_proveedor` (no se tocó
  la `crear_nota_debito` vieja, su rama 'emitida' ya está en desuso).
- **Migración 277**: `notas_credito_proveedor` + items — tabla de documento
  que ANTES NO EXISTÍA (la NC de proveedor era un insert suelto a
  `cuenta_corriente_proveedores`, sin numeración propia). RPC
  `crear_nota_credito_proveedor` con reembolso en efectivo atómico. Incluye
  un self-fix: la primera versión no validaba que `caja_sesion_id`
  perteneciera a la empresa (guard-tenant faltante, encontrado en
  autorevisión antes de que alguien más lo viera).
- `NuevaNotaDebitoModal.jsx` (shared/, proveedor) y `NuevaNCProveedorModal.jsx`
  reescritos con tabla de ítems + IVA, mismo patrón que sus pares de Ventas.
- Nuevo tab "Notas de Crédito Recibidas" en `DevolucionesProveedorSection.jsx`.
- `ReporteLibroIVACompras.jsx` ahora suma ND recibida (+) y resta NC de
  proveedor (-) al crédito fiscal, con columna Tipo.

**Ninguna de las 2 RPC nuevas toca `comprobantes` ni AFIP** — es el
proveedor quien declara estos documentos, no nosotros (mismo criterio que
ya regía para `devoluciones` tipo='proveedor').

El Mapa de Relaciones para Compras SÍ existía ya (no había que
construirlo) — solo necesitó un fix puntual, ver arriba. La cancelación
con reversa (mig.278) también se cerró la misma noche, ver punto 7 arriba.

**⚠️ Impacto operativo a revisar antes/al aplicar mig.277:** hay un usuario
`staff` en Nalux (no admin) sin el permiso granular `compras` otorgado
(`permissions->>'compras'` es NULL). Hoy puede crear NC de Proveedor porque
el flujo viejo (`NuevaNCProveedorModal.jsx`) hacía un INSERT directo sin
ningún chequeo de permiso granular. La RPC nueva `crear_nota_credito_proveedor`
sí exige `has_module_permission('compras')` — mismo gate que ya tiene
`crear_nota_debito` (precedente real, no invención) — así que ese usuario
va a quedar bloqueado para NC de Proveedor hasta que se le otorgue el
permiso `compras` desde Configuración → Usuarios. Es la decisión correcta
de seguridad (consistente con ND), pero Luciano debería saberlo antes de
que alguien reporte "no me deja hacer una NC".

Build y lint verificados limpios (0 errores). Probado en vivo esa misma
noche — ver sección de arriba.

---

## Estado actual de producción

Todo desplegado, aplicado y pusheado al cierre de la sesión del 2026-07-29.

| Servicio | Versión | Estado |
|---|---|---|
| `arca-worker` | v18 | ✅ ACTIVO |
| `mp-sync-worker` | v1 | ✅ ACTIVO |
| `informar-caea` | v8 | ✅ ACTIVO |
| `mp-sync` | v14 | ✅ ACTIVO (redesplegado, verificado byte a byte) |
| Migración 271 | aplicada | ✅ |
| Migración 272 | aplicada | ✅ |
| Migración 273 | aplicada | ✅ |
| Migraciones 275/276/277 | aplicadas | ✅ |

---

## Qué se hizo en esta sesión

### Tarea #34 — Migración 271 (CAEA por CbteTipo)
Aplicada. Corrige `usar_caea_para_comprobante` RPC:
- Antes: mapeaba `v_tipo_cbte` solo por letra → siempre devolvía código de Factura
- Ahora: mapea por `(letra, clase)` → devuelve código correcto para Factura/NC/ND
- Quitó además el filtro `tipo_cbte` incorrecto del lookup de `caea_registros` (un CAEA es por CUIT+quincena, no por tipo)

### Fix colateral — Letra NC/ND hardcodeada a 'B'
`NuevaNCModal.jsx` y `NuevaNDModal.jsx` hardcodeaban `letraAfip = 'B'` para
NC/ND sin comprobante origen. Ahora derivan la letra con `determinarTipoComprobante()`
igual que ventas. Pusheado al repo.

### Fix colateral — `esClaseC` en `arca-worker`
`esFacturaC = voucherType === 11` dejaba afuera NC-C (13) y ND-C (12).
Corregido a `esClaseC = [11, 12, 13].includes(params.voucherType)` en `_shared/afip.ts`.
Incluido en el deploy v18.

### Tarea #35 — informar-caea: agrupamiento por (tipo_cbte, punto_venta)
`informar-caea` agrupaba todos los comprobantes usando `registro.tipo_cbte`
(el tipo del CAEA, siempre Factura), ignorando el tipo real de cada fila.
Ahora agrupa por `c.tipo_cbte` de cada comprobante en `caea_comprobantes`.
Desplegado como v8.

### Tarea #36 — puntos_venta_numeracion indexada por CbteTipo
**Problema:** `puntos_venta.ultimo_numero_a/b/c` indexa el contador por LETRA,
pero AFIP indexa sus series por `(PtoVta, CbteTipo)`. Factura/NC/ND son series
independientes — una sola columna por letra no puede seguirlas a las tres.
Con el fix de `voucherTypeAfip`, NC y ND empezaron a usar su propio CbteTipo,
pero ambas escribían en la misma columna de letra → falso positivo de "estado
ambiguo" que bloqueaba facturas válidas.

**Solución (Opción A):**
- Migración 273: nueva tabla `puntos_venta_numeracion(empresa_id, punto_venta_id, cbte_tipo, ultimo_numero)` con PK `(punto_venta_id, cbte_tipo)`. RLS: SELECT por tenant, sin políticas de escritura (solo `service_role`). Seed de ventas históricas (NC/ND históricas NO se siembran porque su CbteTipo declarado en AFIP era incorrecto).
- `arca-worker` v18: lee `puntos_venta_numeracion` en vez de `puntos_venta.ultimo_numero_[letra]`. Sin fila = primera emisión de esa serie → salta el chequeo de ambigüedad y auto-siembra en éxito. Upsert por `(punto_venta_id, cbte_tipo)` en cada emisión exitosa.
- Columnas viejas `ultimo_numero_a/b/c` quedan en `puntos_venta` marcadas `DEPRECATED` (no se dropean en 273 para permitir rollback fácil).

### Recuperación MP sync (incidente 15 días)
**Causa:** commit `7bccea5` (2026-07-14) agregó `verifyAdmin()` a `mp-sync`.
El cron usa la anon key → 401 en el 100% de corridas desde esa fecha.

**Solución:** separar en dos puntos de entrada (mismo patrón que `arca-worker`):
- `_shared/mpSync.ts` (nuevo): lógica de sync compartida
- `mp-sync`: mantiene `verifyAdmin` + filtro por `empresa_id` — es el botón del frontend
- `mp-sync-worker` (nuevo, `verify_jwt=false`): sin auth, todas las empresas activas — es lo que llama el cron
- Migración 272: re-registra `mp-sync-every-2-min` apuntando a `mp-sync-worker`

**Verificación post-deploy:** 71 movimientos en DB, backlog 14-29/07 recuperado completo (< 100 pagos en el período). Cron corriendo con 200 + `synced:0` (sin pagos nuevos desde el 28/07, es correcto).

---

## Pendientes técnicos

### DROP de columnas deprecated (baja urgencia)
Las columnas `puntos_venta.ultimo_numero_a/b/c` están marcadas DEPRECATED pero no dropeadas.
Esperar ~1 semana de corridas normales del `arca-worker` v18 en producción, luego:
```sql
ALTER TABLE public.puntos_venta
  DROP COLUMN ultimo_numero_a,
  DROP COLUMN ultimo_numero_b,
  DROP COLUMN ultimo_numero_c;
```
Crear como migración `274_drop_ultimo_numero_obsoleto.sql`.

### Testear NC/ND con CbteTipo correcto en producción
Crear una NC o ND real desde la UI (Nalux) y verificar:
1. Que `arca-worker` la procese con `cbte_tipo = 8` (NC-B) o `13` (NC-C)
2. Que `puntos_venta_numeracion` tenga una fila nueva para ese tipo con su correlativo propio
3. Que las facturas siguientes no queden bloqueadas por "estado ambiguo"

### Redesplegar `mp-sync`
El archivo en repo cambió (ahora usa `_shared/mpSync.ts`) pero el desplegado
sigue siendo la versión anterior (funcional para el botón del frontend).
No urgente, pero quedó divergido.

### 4 NC históricas mal declaradas ante ARCA
NC-20260706-003, NC-20260707-001, NC-20260707-002, NC-20260728-002 fueron
declaradas ante ARCA como Factura (código 6) en vez de NC (código 8) por el bug
de `voucherTypeAfip` anterior al fix. Ya autorizadas, no se pueden corregir por
código — tema para el contador de Nalux.

### Resend sandbox roto
El recupero de contraseña no funciona en el entorno de desarrollo.
Requiere acceso humano al dashboard de Resend — no delegable a Claude.

### MELI Factura A
Deferido hasta que se trabaje ARCA/AFIP específicamente para eso.
No construir sin pedido explícito.

---

## Arquitectura de deploy de Edge Functions

El deploy vía MCP (`deploy_edge_function`) reemplaza TODOS los archivos de la función.
Si la función importa archivos de `_shared/`, hay que incluirlos explícitamente en el
payload con `name: "../_shared/archivo.ts"`.

Funciones que usan `_shared/`:
- `arca-worker`: necesita `auth.ts`, `afip.ts`, `wsaa.ts`, `wsfe.ts`, `integraciones.ts`
- `informar-caea`: necesita `auth.ts`, `wsaa.ts`, `wsfe.ts`
- `mp-sync-worker`: necesita `auth.ts`, `mpSync.ts`
- `mp-sync`: necesita `auth.ts`, `mpSync.ts`

`config.toml` NO se aplica al desplegar vía MCP — hay que pasar `verify_jwt` explícitamente.

Workers sin auth (cron):
- `arca-worker`: `verify_jwt=false`
- `mp-sync-worker`: `verify_jwt=false`

Funciones de usuario (JWT requerido):
- `mp-sync`: `verify_jwt=true` (default) + `verifyAdmin()` interno
- `informar-caea`: `verify_jwt=true` (default) + `verifyAdmin()` interno

---

## CbteTipo AFIP — tabla de referencia

| Clase | Letra A | Letra B | Letra C |
|---|---|---|---|
| Factura (venta) | 1 | 6 | 11 |
| Nota de Débito | 2 | 7 | 12 |
| Nota de Crédito | 3 | 8 | 13 |

`esClaseC = [11, 12, 13].includes(voucherType)` — no discrimina IVA, `ImpNeto = ImpTotal`, `ImpIVA = 0`.

---

## Proyecto remoto Supabase
- **Project ID:** `wuznppxeonmhfcvnqfbf`
- **Empresa piloto:** Nalux (`condicion_iva = 'Exento'`, emite letra C)
