# INFORME DE AUDITORÍA CONTABLE
Sistema: KAIROX Gestión
Fecha: 2026-08-07
Versión analizada: `master` @ `ccacb9b` (313 migraciones)
Marco: RT FACPCE (primario) | IFRS (referencia)

**✅ Actualización 2026-08-07 (mismo día): los 3 fixes priorizados ya están en producción**
(mig.314 + `master` @ `2be210d`). Detalle de qué se hizo y cómo se verificó en cada
recomendación, más abajo. El crítico se probó en sandbox (`BEGIN...ROLLBACK` contra la
base real de Nalux) antes de aplicarse — 7/7 casos correctos, sin dejar rastro.

---

## RESUMEN EJECUTIVO

Score global al momento de auditar: **6/10 en verde ✅ | 3 en amarillo ⚠️ | 1 en rojo ❌**.
**Actualizado a 7/10 verde | 2 amarillo | 0 rojo** tras los fixes del mismo día (ver arriba) —
solo quedan pendientes las 2 mejoras 🟢 (no bloqueantes, ver Recomendaciones).

El sistema está contablemente maduro en la mayoría de las áreas — partida doble bien modelada,
AFIP/ARCA completo (incluyendo `CondicionIVAReceptorId` y `CbtesAsoc`), impuestos parametrizables,
cierre de ejercicio estilo SAP, conciliación bancaria y multi-moneda con TC histórico + doble
cotización oficial/paralela. El hallazgo en rojo es real y concreto: **la protección de partida
doble no vive en el servidor** — ni valida cuadre antes de insertar, ni impide editar/borrar un
asiento ya confirmado. El resto de los hallazgos son gaps de reporting/features (aging solo para
Clientes, centros de costo a nivel documento) que no comprometen la integridad de los datos ya
cargados.

---

## DETALLE POR ÁREA

### 1. Asientos Contables [❌]
**Estado:** Estructura de partida doble correcta (líneas `debe`/`haber` separadas, no un campo
`monto` único), numeración correlativa con lock de concurrencia, y patrón de reversa (nunca se
edita un asiento, se anula + se crea la reversa) bien implementado donde el código pasa por las
RPCs de servicio. El problema es que **eso no está garantizado a nivel de base de datos.**

**Evidencia en el código:**
- `supabase/migrations/000_schema_base.sql:609-634` — estructura `asientos_contables` +
  `asientos_items` correcta.
- `supabase/migrations/181_regenerar_asiento_cxc_cxp.sql:30-43` — numeración con
  `pg_advisory_xact_lock` + `UNIQUE(empresa_id, numero)`.
- `src/services/planCuentasService.ts:134-135` (`createAsiento`) — **suma `debe`/`haber` pero
  nunca compara ambos totales antes de insertar.** Ningún trigger o `CHECK` constraint en las 313
  migraciones lo hace tampoco (grep negativo de `CHECK.*total_debe`, `RAISE EXCEPTION.*cuadr`).
- `supabase/migrations/132_enforcement_permisos_granulares.sql:190-198` — las policies RLS
  `asientos_contables_cud`/`asientos_items_cud` son `FOR ALL` (INSERT+UPDATE+**DELETE**) para
  cualquier usuario con el permiso granular `configuracion` (asignable a staff no-admin, ver
  `StaffPermissionsModal.jsx:28`), **sin ninguna condición sobre `estado`.** Confirmado que sigue
  vigente: mig.134 (la única migración posterior que toca estas tablas) solo amplía el `SELECT`,
  no toca el `CUD`.

**Riesgo contable:** cualquier usuario con el módulo "Configuración" habilitado puede, desde el
propio navegador (sin pasar por ninguna RPC), editar las líneas de un asiento ya confirmado y ya
declarado a AFIP, borrarlo directamente, o insertar un asiento desbalanceado. El único rastro
queda en `audit_log` — es forense (después del hecho), no preventivo. Es exactamente lo que en SAP
resuelve el motor de posteo (JDT1/OJDT inmutables una vez `Posted`, validación `DebitTotal =
CreditTotal` server-side antes del commit).

**Norma de referencia:** RT 17 §4.1 (partida doble); RT 9 (integridad de registros contables).

---

### 2. Plan de Cuentas [✅]
**Estado:** Jerarquía padre/hijo, clasificación por tipo, campo imputable, personalizable por
empresa.
**Evidencia:** `supabase/migrations/004_plan_cuentas.sql:7-20` — `cuenta_padre_id`, `nivel`, `tipo`
(CHECK activo/pasivo/patrimonio/ingreso/egreso), `permite_movimientos`, `empresa_id`.
**Riesgo contable:** ninguno.
**Norma de referencia:** RT 9 §3.

---

### 3. Facturación Electrónica AFIP/ARCA [✅]
**Estado:** Completo — WSFE real, CAE/vencimiento, `CondicionIVAReceptorId` (RG 5616), `CbtesAsoc`
para NC/ND.
**Evidencia:** `supabase/functions/_shared/wsfe.ts:371` (CondicionIVAReceptorId);
`supabase/functions/arca-worker/index.ts:156-178,299` (CbteAsoc, con guard si falta el
`numero_afip` del comprobante origen); `supabase/migrations/025_afip_infraestructura.sql:13,21-22`
(condición IVA de empresa/cliente).
**Riesgo contable:** ninguno nuevo. CAEA como contingencia funcional pero con el gap ya conocido
de `CbteAsoc` no replicado en `informar-caea` (sin poder probarse en vivo, nadie usa CAEA todavía).
**Norma de referencia:** RG AFIP 4291, RG 5616.

---

### 4. Impuestos (IVA/IIBB/Retenciones) [✅]
**Estado:** Alícuotas parametrizables con snapshot histórico por ítem, IVA discriminado en
asientos, IIBB con Convenio Multilateral, retenciones con carga manual (correcto — no
automatizable sin el certificado del agente de retención).
**Evidencia:** `supabase/migrations/032_impuestos_infraestructura.sql:14-56`;
`src/services/planCuentasService.ts:353-374`; `supabase/migrations/172_iibb_auto_liquidacion.sql`;
`supabase/migrations/034_retenciones.sql:8-27`.
**Riesgo contable:** ninguno.
**Norma de referencia:** Ley 23.349; RG 3685.

---

### 5. Cierre de Período [⚠️]
**Estado:** Tabla de períodos con bloqueo, cierre de ejercicio estilo SAP (traspaso a Resultados
Acumulados) confirmado vigente, balancete de sumas y saldos disponible. El bloqueo de período
cerrado en el flujo principal de ventas es **best-effort desde el cliente**, no una garantía de
servidor.
**Evidencia:** `supabase/migrations/027_cierre_periodos.sql:1-53`;
`supabase/migrations/283_cierre_ejercicio_contable.sql` + `284_traslado_resultado_acumulados.sql`
(guards anti-duplicado confirmados, líneas 60-65); `src/services/planCuentasService.ts:320-334` —
el chequeo de período cerrado corre dentro de un `try/catch` que **explícitamente no bloquea la
venta si la RPC falla** (comentario en el propio código: "Non-critical period check").
**Riesgo contable:** si la llamada de chequeo falla por red/timeout, el asiento se postea igual en
un período cerrado sin que nadie se entere. Se agrava por el hallazgo #1 (si además se puede
escribir directo a la tabla, este guard es aún menos una garantía real).
**Norma de referencia:** RT 9 §5.

---

### 6. Conciliación Bancaria y Caja [✅]
**Estado:** Cuentas bancarias, extractos con matching, arqueo de caja (ya auditado y cerrado en
sesión previa, no re-auditado acá).
**Evidencia:** `supabase/migrations/015_conciliacion_bancaria.sql`;
`supabase/migrations/011_cuentas_bancarias.sql`.
**Riesgo contable:** ninguno nuevo.
**Norma de referencia:** RT 17 §4.6.

---

### 7. Centros de Costo [⚠️]
**Estado:** Existe en Comprobantes, Compras y Asientos (a nivel de header), pero es siempre
opcional (nunca obligatorio, ni con el toggle activo) y vive a nivel de documento, no de línea —
no se puede partir un gasto entre varios centros de costo en el mismo comprobante.
**Evidencia:** `supabase/migrations/168_centros_costo.sql:27-38` (nullable, `ON DELETE SET NULL`);
`supabase/migrations/179_toggle_centros_costo.sql:60-65` (solo valida si viene un valor, no
obliga).
**Riesgo contable:** bajo — es una dimensión más pobre que el `OcrCode` de SAP B1 (que vive a nivel
de línea), relevante solo si el negocio necesita reportar resultado por centro de costo con
precisión (ej. gasto compartido entre sucursales).
**Norma de referencia:** RT 18 §2.6.

---

### 8. Inventario y COGS [✅]
**Estado:** COGS real (no estimado) capturado por línea al momento de la venta, NC revierte COGS,
ajuste manual genera asiento. FIFO sigue bloqueado a propósito (CHECK constraint explícito).
**Evidencia:** `supabase/migrations/287_costo_mercaderia_vendida.sql:130,139,163,27-28`
(`costo_unitario` snapshot por línea); `supabase/migrations/049_metodo_valoracion_stock.sql:24-36`
(CHECK que excluye `'fifo'` a propósito, confirmado vigente).
**Riesgo contable:** ninguno de integridad. Gap de reporting menor: no hay una vista/RPC que
reconstruya el valor de inventario a una fecha de corte pasada (solo el costo *actual*) — relevante
si se necesita valuar inventario para un balance a una fecha de cierre.
**Norma de referencia:** RT 17 §4.2; IAS 2.

---

### 9. Cuentas por Cobrar y Pagar (aging) [⚠️]
**Estado:** Open Item real con imputación pago→factura específica en ambos lados (Clientes y
Proveedores). **El aging report (antigüedad de deuda) solo existe para Clientes — no hay
equivalente para Proveedores.**
**Evidencia:** `src/components/sections/CuentaCorrienteSection.jsx:82-202` — tab "Antigüedad"
completo (`TabAntiguedad.jsx`, bandas 0-30/31-60/61-90/+90, reconciliado contra `saldo_actual` para
no sobreestimar deuda con pagos a cuenta sin imputar). `src/components/sections/
ProveedoresSection.jsx` — 0 resultados para "aging"/"antigüedad"; único componente de aging en todo
el repo es `TabAntiguedad.jsx`, usado solo en Clientes.
**Riesgo contable:** medio — sin aging de CxP no hay forma de priorizar pagos por vencimiento ni
detectar deuda vencida a proveedores desde el sistema; hay que armarlo a mano fuera de KAIROX.
**Norma de referencia:** RT 17 §4.5.

---

### 10. Multi-moneda [✅]
**Estado:** Cotizaciones históricas por fecha, TC congelado al momento de la transacción (no
recalculado al leer), doble cotización oficial/paralela (contexto argentino real), asiento
automático de diferencia de cambio.
**Evidencia:** `supabase/migrations/013_multi_moneda.sql:8-16` (`get_tasa_cambio` busca vigente ≤
fecha); `supabase/migrations/041_retroactive_moneda_paralela.sql:8-35`;
`supabase/migrations/170_multimoneda_diferencia_cambio.sql`.
**Riesgo contable:** ninguno nuevo. ND/NC automática por diferencia de cambio sigue diferida a
propósito (backlog ya conocido).
**Norma de referencia:** RT 18 §3.2; IAS 21.

---

## RECOMENDACIONES PRIORIZADAS

### 🔴 Crítico — ✅ RESUELTO (mig.314, 2026-08-07)
1. **Blindar `asientos_contables`/`asientos_items` contra edición post-confirmación y validar
   partida doble en el servidor.** Implementado distinto a como se planteó acá originalmente (más
   simple y más alineado con el patrón ya establecido en el proyecto): en vez de un trigger, se
   revocó el `GRANT` de INSERT/UPDATE/DELETE directo sobre ambas tablas para `authenticated`/`anon`
   (mismo patrón "escritura exclusiva vía RPC" que `cuenta_corriente_imputaciones`, mig.169) — sin
   ese permiso, ni siquiera se llega a evaluar RLS. 4 RPCs `SECURITY DEFINER` nuevas
   (`crear_asiento_manual`, `crear_asiento_automatico`, `confirmar_asiento`, `anular_asiento`)
   validan `sum(debe) = sum(haber)` y período cerrado server-side antes de escribir. Los 7 sitios
   de `asientosAutoService.*` (venta, compra, ajuste de stock, NC/ND cliente y proveedor, reversa)
   ahora crean y confirman el asiento en una sola llamada atómica (antes eran 2 llamadas separadas
   con una ventana real de asiento huérfano). Probado en sandbox contra Nalux antes de aplicar:
   automático balanceado → confirmado ✓, automático desbalanceado → rechazado ✓, manual → borrador
   → confirmar → confirmado ✓, anular → anulado ✓, INSERT/UPDATE directo como `authenticated` →
   rechazado por falta de privilegios ✓ (7/7, sin residuo).

### 🟡 Importante
1. **Aging report para Cuentas por Pagar (Proveedores) — ✅ RESUELTO.** Nueva pestaña "Antigüedad
   de Deuda" en `ProveedoresSection.jsx`, espejando `TabAntiguedad.jsx` de Clientes (ahora
   generalizado con props `entityLabel`/`onVerDetalle` para servir a ambos). Reutiliza la vista
   `compras_saldo_pendiente` ya existente, mismo criterio de reconciliación contra
   `proveedores.saldo_actual` que ya usaba Clientes.
2. **Bloqueo de período cerrado server-side en el flujo principal de ventas — ✅ RESUELTO** como
   efecto directo del fix crítico: `crear_asiento_automatico` valida `fecha_en_periodo_cerrado` de
   forma bloqueante para las 7 rutas automáticas, ya no depende de que el chequeo best-effort del
   cliente tenga éxito.

### 🟢 Mejoras
1. **Reporte de valorización de inventario a una fecha de corte** — el dato ya existe
   (`costo_unitario` por movimiento), falta la vista/RPC que lo consolide históricamente.
2. **Centros de costo a nivel de línea, no solo de documento**, si en algún momento se necesita
   partir un gasto entre varias dimensiones en el mismo comprobante.

---

## PRÓXIMA AUDITORÍA
Re-ejecutar después de resolver el hallazgo crítico (#1), para confirmar que el trigger/RPC nueva
no rompió ningún flujo existente (Ventas, Compras, Cheques, Ajuste de Stock, Cierre de Ejercicio —
todos generan asientos hoy). Las áreas 5, 7 y 9 (amarillas) no necesitan re-auditoría completa, solo
confirmar que las recomendaciones "Importante" se implementaron cuando se prioricen.
