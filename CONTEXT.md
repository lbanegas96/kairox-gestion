# KAIROX Gestión — Contexto de Sesión
**Última actualización:** 2026-07-30 madrugada (Luciano/Claude — Compras cerrado al 100%, auditoría de Ventas sin gaps estructurales, e IVA Débito/Crédito Fiscal discriminado en asientos de ambos módulos)

## ✅ IVA Débito/Crédito Fiscal discriminado en asientos (Ventas + Compras)

Último pedido de la noche: los asientos automáticos de venta/compra mandaban el total entero a una sola cuenta (Ventas o Mercaderías), sin separar el IVA en su propia cuenta — mismo problema en los dos módulos, no era nuevo de hoy.

**Fix (sin migración nueva de tablas — las cuentas `1.1.4 IVA Crédito Fiscal` y `2.1.3 IVA Débito Fiscal` YA estaban en el seed del plan de cuentas desde mig.004, nunca se usaban):**
- `planCuentasService.ts` — `crearAsientoVenta`/`crearAsientoCompra` ahora aceptan `neto`/`iva` opcionales. Si vienen y existe la cuenta de IVA correspondiente, arman un asiento de 3 líneas (Ventas: Debe Cobro total / Haber Ventas neto / Haber IVA Débito Fiscal; Compras: Debe Mercaderías neto / Debe IVA Crédito Fiscal / Haber Pago total). Si no vienen o falta la cuenta, cae al asiento viejo de 2 líneas — nunca bloquea la operación.
- **Migración 280**: `crear_venta` ya calculaba neto/IVA internamente pero nunca los devolvía en el `RETURN` — se agregaron `neto_gravado`/`iva_discriminado` al jsonb de retorno (cero cambios de lógica/side-effects, solo el RETURN).
- Los 6 puntos donde se llama a `crearAsientoVenta`/`crearAsientoCompra` (`NuevaFacturaModal`, `NuevaVentaModal`, `useConfirmarVenta`, `NuevaFacturaProveedorModal`, `CompraRapidaSection`, `OrdenesCompraSection`) ahora pasan `neto`/`iva` desde el valor que ya tenían disponible (local o del resultado de la RPC).
- **Probado en vivo, 3 veces, contra producción**: Factura de Venta manual (10.5% IVA) → asiento Debe Caja $1.000 / Haber Ventas $904,98 / Haber IVA Débito $95,02 ✓. Venta por POS (`crear_venta`) → mismo patrón, $30.000 total → $24.793,39 neto + $5.206,61 IVA ✓. Compra Rápida → Debe Mercaderías $4.132,23 + Debe IVA Crédito $867,77 = Haber Pago $5.000 ✓. Los tres balanceados, los tres limpiados después.

## ✅ Auditoría de Ventas (pedida por Luciano tras cerrar Compras)

Mismo enfoque que en Compras: revisé Cotización→Pedido→Entrega→Factura→NC/ND→Cancelación buscando el mismo tipo de gap (documento huérfano desconectado de CC/asiento/IVA). **Resultado: no hay nada roto.** `NuevaFacturaModal.jsx` ya hacía todo bien (CxC Open Item, Caja para no-CC, IVA real por ítem, asiento, AFIP), "Facturar Pedido" reutiliza el mismo `NuevaVentaModal` maduro (no hay tabla huérfana tipo `facturas_proveedor`), y `cancelar_nota_credito` ya tenía los mismos guards que hoy repliqué en Compras. Verificación de integridad en producción: 0 movimientos de Cuenta Corriente sin comprobante. Encontré 7 facturas sin asiento pero todas de junio/principios de julio — anteriores a que el control existiera, no es un bug activo, no se tocó (no se editan asientos retroactivos sin pedido explícito).

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
- **Autorevisión encontró un segundo gap en mi propio fix**: la RPC quedó atómica (compras+CC) pero el cliente no disparaba `asientosAutoService.crearAsientoCompra` — la Factura de OC creaba deuda real pero sin asiento contable. Corregido en el mismo commit: `OrdenesCompraSection.jsx` ahora llama al asiento (Debe 1.1.3 Mercaderías / Haber 2.1.1 Cuentas a Pagar, `esCredito:true` siempre porque esta Factura SIEMPRE es Open Item) en el `onSuccess` de la mutación, mismo patrón no-bloqueante que Compra Rápida.
- **Probado en vivo end-to-end DOS VECES** contra producción (Nalux, proveedor Mercado Libre, producto Mouse Vertical):
  - OC-00013 (2 u. × $5.000): factura FC-TEST-0001 → verifiqué `compras` (total $12.100, neto $10.000, IVA $2.100) + `detalle_compras` + `cuenta_corriente_proveedores` (tipo='compra', +$12.100, referencia_tipo='compra_oc').
  - OC-00014 (1 u. × $5.000, después de agregar el asiento): factura FC-TEST-0002 → verifiqué además `asientos_contables`+`asientos_items`: Debe $6.050 a "Mercaderías / Inventario" (1.1.3), Haber $6.050 a "Cuentas a Pagar" (2.1.1) — partida doble balanceada, `origen='compra'` y `origen_id` apuntando a la compra correcta.
  - Confirmé también que el botón "Registrar Factura" desaparece solo si la OC ya tiene una (guard de duplicado, reforzado también en la RPC).
  - Ambas pruebas limpiadas por completo (OC, ítems, recepción, compra, detalle, CC, asiento+ítems, stock revertido) y verificadas con conteo en cero.

## ✅ Cierre de los 3 hallazgos de backlog (mismo hilo, Luciano pidió terminarlos antes de Ventas)

1. **`NuevaFacturaProveedorModal.jsx` ahora genera asiento contable** — agregada la llamada a `asientosAutoService.crearAsientoCompra` (mismo patrón no-bloqueante que Compra Rápida y que la Factura de OC), con `esCredito` según la forma de pago elegida (CC Proveedor → Debe Inventario/Haber Cuentas a Pagar; Efectivo/Transferencia → Haber Caja). Banner corregido: decía "no modifica el inventario" pero el código SÍ suma stock (`aplicar_compra_producto`) — texto engañoso, reemplazado por una advertencia real sobre no duplicar stock si la mercadería ya entró por una OC.
   - **Probado en vivo**: factura FC-TEST-0003, ítem servicio (sin producto) $1.000 neto + IVA 10.5% = $1.105, forma de pago CC Proveedor → verifiqué `compras` (neto/IVA correctos), `cuenta_corriente_proveedores` (+$1.105) y el asiento (Debe 1.1.3 Mercaderías $1.105 / Haber 2.1.1 Cuentas a Pagar $1.105). Limpiado.
2. **Compra Rápida ahora discrimina IVA real por ítem** en vez de asumir 21% fijo — usa `productos.alicuota_iva` (ya existía en la tabla, no se usaba acá) con el mismo criterio bruto/factor que ND/NC de Proveedor. `compras.neto_gravado`/`iva_discriminado` y `detalle_compras.alicuota_iva` ahora se completan de verdad (antes quedaban NULL, y `ReporteLibroIVACompras.jsx` caía siempre en su fallback de 21%).
   - **Probado en vivo**: 1×Mouse Vertical a $5.000 (precio final, IVA incluido, alícuota 21% del producto) → `neto_gravado=4132.23`, `iva_discriminado=867.77` (4132.23×1.21=5000 ✓). Asiento y todo lo demás sin cambios (ya funcionaba). Limpiado.
   - **Nota, no se tocó**: el flujo de EDICIÓN de una compra existente (`handleUpdatePurchase`) no recalcula `neto_gravado`/`iva_discriminado` al agregar/quitar ítems — sigue siendo un gap menor, separado de este fix (que era sobre la creación).
3. **`comprasService.ts` (código muerto, nadie lo llama todavía)**: `create()` insertaba `user_id: empresaId` — confundía usuario con empresa. Cambiada la firma para recibir `userId` explícito. Sin impacto real porque no hay callers, pero ya no queda ahí como trampa para quien lo conecte en el futuro.

**Con esto, el módulo Compras queda 100% al día — nada pendiente conocido.** Próximo paso pedido por Luciano: volver a Ventas.

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
