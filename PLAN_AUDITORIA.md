# Plan de Auditoría — KAIROX Gestión
**Documento vivo.** Se actualiza en cada sesión de auditoría. Objetivo: recorrer TODO el sistema
por partes, dejando registrado qué se auditó, qué está en curso y qué falta — para que no se
escape nada.

**Última actualización:** 2026-07-04 (sesión 46 cont. 8 — Audit log auditada; área #15 — PLAN COMPLETO: 15/15 áreas auditadas)
**Leyenda de estado:** ✅ auditado · 🔄 en curso · ⬜ pendiente · ⏸️ bloqueado

---

## Metodología — 6 dimensiones por área

Cada área se audita contra estas 6 dimensiones (no todas aplican a toda área):

| # | Dimensión | Qué se busca |
|---|-----------|--------------|
| **T** | Seguridad multi-tenant | RLS por `empresa_id` en toda tabla; guard `empresa_id`/`is_admin` en RPCs SECURITY DEFINER; nunca confiar en el cliente |
| **D** | Integridad transaccional / partida doble | Asiento cuadra (debe=haber); sin doble contabilización; escritura atómica; sin registros huérfanos |
| **C** | Concurrencia | `FOR UPDATE`/locks donde hay lectura-modificación; sin race conditions en numeración/saldos |
| **E** | Errores silenciosos | Toda escritura crítica reporta al usuario (toast), no `console.warn` mudo |
| **F** | Precisión financiera | Redondeo a 2 decimales; signos correctos (ingreso/egreso, debe/haber) |
| **A** | Trazabilidad | `created_by`/`user_id`, `audit_log`; contables se anulan, no se borran físicamente |

**Técnica base:** leer definición fresca del código/RPC → probar con `BEGIN...ROLLBACK` simulando
usuario autenticado real (`SET LOCAL request.jwt.claims` + `SET LOCAL ROLE authenticated`) → registrar
hallazgo → fix con migración + verificación → documentar acá y en CONTEXT.md.

---

## Estado por área

### ✅ Ya auditadas (con hallazgos cerrados)

| Área | Dimensiones | Hallazgos / Estado | Sesión |
|------|-------------|--------------------|--------|
| **Bancos — Contabilización** | T·D·C·A | Motor de asientos (determinación SAP); RLS admin; guard borrar-contabilizado (mig.128); FOR UPDATE (mig.129) | S43-44 |
| **Mercado Pago / Integraciones** | T·F·A | Ingreso/egreso por collector_id; RLS admin-only `integraciones_bancarias` (mig.124); mp_user_id | S43 |
| **Ualá** | T·D | Fuga cross-tenant `movimientos_uala` cerrada; trigger Ualá→Bancos | S~ |
| **Inventario / Stock (writers)** | T·C·D | Guards de negativo + `FOR UPDATE` en decrement/increment/ajustar/aplicar_compra; tests pgTAP | S38-39 |
| **Ventas (`crear_venta`)** | T·D·F·E | Test pgTAP + efectos colaterales; redondeo defensivo (mig.123); puente Caja→Bancos (mig.122) | S41-42 |
| **Entregas (`crear_entrega`)** | T·D | Test pgTAP (stock se mueve una vez) | S~ |
| **Recepciones (`crear_recepcion`)** | T·D·C | Test pgTAP; fix doble incremento de stock (S32) | S32,S~ |
| **Compras (`aplicar_compra_producto`)** | T·D·C·F | Test pgTAP; FOR UPDATE en costo PPP | S~ |
| **Devoluciones (`crear_devolucion`)** | T·D·C | Tests; guard negativo + race serie DEV (mig.086) | S39 |
| **Numeración / Series** | C | `obtener_proximo_numero` atómico; test 4 casos | S30 |
| **Errores silenciosos (barrido)** | E | ~25 escrituras críticas — 100% con toast; limpio | S41 |
| **Config admin-only** | T | `configuracion`, `integraciones_bancarias`, `determinacion_cuentas_mayor` escritura solo admin | S~,S43 |
| **Cuenta Corriente Clientes (CxC)** | T·D·C·F·A | Cobro atómico RPC `registrar_cobro_cliente` (mig.130); trigger de saldo con signos OK; RLS tenant OK. **Pendiente: no genera asiento (gap sistémico)** | S44 |
| **Cuenta Corriente Proveedores (CxP)** | T·D·C·F | Pago atómico RPC `registrar_pago_proveedor` (mig.131): ahora SÍ descuenta de Caja/Bancos (antes no); + selector de método en UI; RLS tenant OK. **Pendiente: no genera asiento (gap sistémico)** | S44 |
| **Caja / POS** | T·D·C·A | **SÓLIDO.** Índice único `uq_caja_sesion_abierta` garantiza 1 sesión abierta/caja (concurrencia OK); arqueo correcto (solo Efectivo afecta el cajón); RLS tenant OK; open/close atómicos. Solo se limpió dead code `insertMovimiento` (bug latente user_id). Sin 🔴 | S44 |
| **Cheques** | T·D·A | **Tracker aislado, sin 🔴.** RLS `get_my_empresa_id()` OK; `cheques_historial` + `user_id` en cada transición. El módulo NO mueve dinero (sin triggers/RPCs/asientos) → no puede corromper saldos. 🟢 menor: historial es 2ª llamada frontend (no atómica). **Pendiente: gap sistémico** — cobrar/depositar un cheque no genera movimiento en Bancos; falta cuenta "Valores en Cartera"; "Cheque" no mapeado en `metodo_pago_cuenta_bancaria`; rechazo no restaura deuda. Requiere contador | S44 |
| **Usuarios / Permisos granulares** | **T (crítico)** | 🟠 **CONFIRMADO Y CORREGIDO.** Probado con BEGIN...ROLLBACK: staff con `permissions.compras=false` pudo INSERTAR en `proveedores` vía API directa — los permisos eran solo UI (`useUserPermissions` ocultaba menús, RLS no los consultaba). Aislamiento multi-tenant y no-escalación a admin (`profiles_self_update` exige `role=get_my_role()`) estaban intactos. **Fix (mig.132):** función `has_module_permission(modulo)` + policies SELECT(tenant)/CUD(tenant+permiso) en 28 tablas (compras, clientes, ventas parcial, caja, productos, bancos-NUEVO, cheques-NUEVO, plan de cuentas/asientos/IVA bajo 'configuracion'). Se agregaron 2 permisos nuevos al modelo (`bancos`, `cheques`) que no tenían key propia. Todo el motor de dinero (crear_venta, cobros, pagos, stock) es SECURITY DEFINER y sigue funcionando sin cambios. Validado con 4 casos reales (bloqueo sin permiso / permiso concede / admin siempre pasa). **Pendiente Fase 2** (documentado, no crítico): pedidos, entregas, comprobantes, recepciones, CC proveedores aún sin gate de escritura directa | S44 |

| **Notas de Débito** | T·D·C·F | 🔴 **CONFIRMADO Y CORREGIDO.** `crear_nota_debito` solo generaba el movimiento de CC atómicamente para `tipo='emitida'` (cliente). Para `tipo='recibida'` (proveedor nos cobra un adicional), `NuevaNDProveedorModal.jsx` hacía un INSERT SUELTO posterior en `cuenta_corriente_proveedores` — mismo patrón de bug que CxC/CxP: si ese 2º insert fallaba, la ND quedaba registrada pero la deuda al proveedor nunca subía. **Fix (mig.133):** el RPC ahora inserta el movimiento en la misma transacción para ambos tipos; frontend simplificado (sin 2º insert). Validado: ND de $500 → saldo proveedor sube exactamente $500 en la misma transacción. Signo correcto en ambos casos (DEBE cliente / nota_debito proveedor) | S44 |

| **Impuestos / IVA / Retenciones** | F·D | 🟡 **CONFIRMADO Y CORREGIDO.** Alícuotas de IVA son configurables por producto (21/10.5/0/exento/no_gravado en `TabIVA.jsx`) y `crear_venta` calcula `iva_discriminado`/`neto_gravado` reales por ítem desde mig.033 — el `?? 21` en los modales es solo un default de UX, no un hardcode que ignore config. Pero **`ReporteLibroIVA.jsx`** (Libro IVA Ventas, insumo para la DDJJ) ignoraba esas columnas y recalculaba `total − total/1.21` asumiendo 21% para TODO comprobante → IVA mal en ventas con productos a tasa reducida/exenta. `ReporteLibroIVACompras.jsx` (hermano) ya lo hacía bien. **Fix:** usar `iva_discriminado`/`neto_gravado` reales con fallback documentado solo para comprobantes viejos. Retenciones/Alícuotas: módulo de registro manual, sin impacto en CxC/CxP; 🟢 menor: numeración de certificado por `count()` no atómico (bajo riesgo) | S44 |

| **Comprobantes — lifecycle** | **T (crítico)·D·A** | 🔴 **CONFIRMADO Y CORREGIDO.** La policy RLS de `comprobantes` (`comprobantes_all`) era `FOR ALL` con solo `empresa_id = get_my_empresa_id()` — sin distinguir DELETE del resto. Probado con BEGIN...ROLLBACK: un staff no-admin borró una factura de $50.000 con un DELETE directo vía API, sin pasar por ninguna pantalla (0 call-sites de `.delete()` sobre `comprobantes` en todo el frontend — nadie lo usa, nadie lo necesita). Viola el principio contable básico "los documentos se anulan con una Nota de Crédito, nunca se borran" (ya aplicado para `asientos_contables` y movimientos bancarios contabilizados). **Fix (mig.141):** policy dividida en SELECT/INSERT/UPDATE, sin policy de DELETE — queda denegado por RLS default. Validado: DELETE bloqueado (0 filas), SELECT/UPDATE normales intactos. Lifecycle real de "anulación": Copiar a NC (`NuevaNCModal.jsx`) reduce la deuda del cliente sin tocar stock (por diseño, explícito en la UI); "Devolver mercadería" (`crear_devolucion`, ya auditado) es el camino correcto cuando SÍ hay que revertir stock. 🔴 Además, mismo patrón de escrituras sueltas ya visto 3 veces esta auditoría (CxC/CxP/ND): `NuevaNCModal.jsx` hacía 3 inserts sueltos (comprobante, comprobante_items, CC HABER) y el 3ro ni siquiera capturaba el error — si fallaba, la NC quedaba creada pero la deuda del cliente nunca bajaba. **Fix:** nueva RPC atómica `crear_nota_credito` (mig.140, mismo patrón que `crear_nota_debito` mig.133); frontend simplificado a una sola llamada. Validado con NC de $500+IVA: total y movimiento CC exactos en una sola transacción | S46 |

| **Audit log — cobertura** | A | 🟡 **CONFIRMADO Y CORREGIDO.** 14 tablas ya tenían `trg_audit_*` (función genérica `fn_audit_trigger()`, reusa `to_jsonb` old/new): clientes, comprobantes, compras, cotizaciones, cuenta_corriente_movimientos/proveedores, movimientos_caja, ordenes_compra, pedidos, productos, profiles, tipos_cambio, caja_sesiones, configuracion. Probado con BEGIN...ROLLBACK: cerrar un período contable (`periodos_contables`, justo la tabla cuyo RLS de escritura se arregló en mig.136 por ser explotable por cualquier staff) no dejaba **ningún rastro** en `audit_log` — mismo vacío en `notas_debito` (documento de deuda), `movimientos_bancarios` y `asientos_contables` (el libro mayor mismo). **Fix (mig.143):** se agregó el mismo trigger genérico (ya probado en 14 tablas) a estas 4. Validado: cerrar un período ahora genera 2 registros (INSERT+UPDATE) en `audit_log`, la operación normal sigue funcionando igual | S46 |

| **Reportes / Dashboard** | T | ✅ **SÓLIDO, sin hallazgos.** `dashboardService.ts` y los reportes (`ReporteLibroIVA`, `ReporteLibroIVACompras`, `ReporteParidad`) hacen SELECT plano con `.eq('empresa_id', empresaId)` — ninguno usa RPC/SECURITY DEFINER que pudiera bypasear RLS. Confirmado el caso límite con BEGIN...ROLLBACK: un staff de Empresa A que consulta explícitamente `WHERE empresa_id = <Empresa B>` en `comprobantes`, `movimientos_caja` y `clientes` obtiene 0 filas — la RLS bloquea independientemente de lo que el cliente pida, no solo por el filtro de la query. Sin cambios necesarios | S46 |

| **Comprobantes-lifecycle (extensión)** | **T (crítico)** | 🔴 El mismo patrón de la fuga de DELETE (policy `FOR ALL`, sin gate de permiso) se encontró también en `cuenta_corriente_movimientos` (CxC), `cuenta_corriente_proveedores` (CxP) y `notas_debito`. Probado: un staff sin ningún permiso especial borró un movimiento de CxC de $10.000, uno de CxP de $10.000 y una ND de $5.000, cada uno con una sola llamada DELETE. **Fix (mig.142):** mismo patrón que mig.141 — SELECT/INSERT/UPDATE separados, sin policy de DELETE en las 3 tablas. Validado: DELETE bloqueado en las 3, UPDATE normal intacto | S46 |

| **Cotizaciones / Pedidos** | **D** | 🟡 **CONFIRMADO Y CORREGIDO.** Cotizaciones/Pedidos no mueven stock ni dinero directamente (el stock se mueve en `crear_entrega`, ya auditado) — el hallazgo real está en `crear_entrega`: solo validaba stock disponible, NUNCA que la entrega respetara `pedido_items.cantidad` (lo pedido). Probado con BEGIN...ROLLBACK: se generaron 2 entregas de 5 unidades sobre un pedido_item de cantidad=5, dejando `cantidad_entregada=10` (el doble de lo pedido) sin ningún error — rompe el invariante Document Flow (`cantidad_entregada <= cantidad_pedida`) del que dependen Pedidos/Entregas/Facturación. **Fix (mig.139):** guard `FOR UPDATE` que bloquea si `cantidad_entregada + cantidad > cantidad_pedida`. Validado: entregas parciales exactas (3+2=5) siguen funcionando, la 3ª entrega que excede se bloquea. Test pgTAP `crear_entrega.test.sql` ampliado a 7 casos (Caso 5). 🟢 menor (no fixeado): `cotizacionesService.create`/`PedidosSection.handleSave` insertan header + items en 2 llamadas separadas sin RPC atómica — a diferencia de CxC/CxP/ND, acá NO hay dinero real movido (sin stock ni caja), solo riesgo de un registro "vacío" huérfano, severidad baja. Se corrigieron 2 errores silenciosos en `PedidosSection.jsx` (`handleSaleSuccessForPedido`/`handleCancelar` no verificaban el error del UPDATE de estado) | S46 |

| **Ofertas / Descuentos** | T·F | 🟡 **CONFIRMADO Y CORREGIDO.** Tenant guard OK (`p_empresa_id` vs `get_my_empresa_id()`); `chk_porcentaje_maximo` en DB evita descuento >100% (no puede dar precio negativo); tipo `monto_fijo` usa `LEAST(valor,precio)` como guard adicional. Pero el WHERE de scope evaluaba `producto_id IS NULL OR producto_id=X OR categoria coincide` — si una oferta tenía AMBOS `producto_id` Y `categoria_nombre` cargados (la UI de `OfertasSection.jsx` permite llenar los dos sin restricción), terminaba aplicándose a CUALQUIER producto de esa categoría, no solo al elegido. Probado: oferta "solo para Producto A" + categoria "Bebidas" descontó 50% en un Producto B no relacionado, misma categoría. **Fix (mig.138):** `producto_id`, cuando está seteado, es excluyente (más específico gana) — `categoria_nombre` solo se evalúa si la oferta NO tiene `producto_id`. Validado: producto ajeno ya no toma el descuento; producto correcto sigue tomando el suyo. Agregado hint en la UI aclarando la precedencia. `acumulable` confirmado NO vestigial — controla si un descuento manual del POS se puede sumar sobre la oferta automática (no aplica a "stackear" 2 ofertas entre sí, que nunca fue la semántica) | S46 |

| **Conciliación bancaria** | **T (crítico)·F** | 🔴 **CONFIRMADO Y CORREGIDO.** `matchManual()`/`autoMatch()` (conciliacionService.ts) hacían `UPDATE extracto_lineas SET movimiento_id=X` sin verificar que X perteneciera a la MISMA empresa que la línea — solo había FK (garantiza que el movimiento exista, no que sea del mismo tenant). Probado con BEGIN...ROLLBACK: un admin de Empresa A matcheó su línea con un `movimiento_bancario` de Empresa B, y el trigger `fn_sync_conciliado` (SECURITY DEFINER, correcto para su propósito) propagó `conciliado=true` CROSS-TENANT al movimiento de B — corrompiendo el estado de conciliación de otra empresa. **Fix (mig.137):** trigger `fn_guard_match_tenant` (BEFORE UPDATE) que valida `empresa_id` coincidente antes de permitir el match; revocado `EXECUTE` de anon/authenticated (mismo endurecimiento que el resto de funciones trigger, mig.063). Validado: cross-tenant bloqueado, match legítimo sigue funcionando. 🟡 También: `parsearCSV()` no soportaba el formato numérico argentino (miles con punto, decimal con coma) — `"1.234,56"` se parseaba como `1.234` (error de 3 órdenes de magnitud) al no remover los puntos de miles antes de reemplazar la coma. **Fix:** helper `parseMontoCSV()` que remueve puntos de miles cuando hay coma decimal presente. 🟢 menor (no fixeado): `autoMatch` no tiene lock a nivel DB entre ejecuciones concurrentes (bajo riesgo — acción manual/ocasional de admin); el split de CSV por coma no soporta campos con comas dentro de comillas (edge case de exportaciones bancarias, no confirmado en uso real) | S46 |

| **Períodos contables / Cierre** | **T (crítico)·D·E** | 🔴 **CONFIRMADO Y CORREGIDO.** Probado con BEGIN...ROLLBACK: un staff no-admin pudo INSERTAR un período nuevo y CERRAR períodos existentes vía API directa (2 filas afectadas) — la UI de `PlanCuentasSection.jsx` gatea los botones Crear/Cerrar/Reabrir con `isAdmin`, pero la policy RLS de `periodos_contables` (mig.027) solo verificaba `empresa_id`, no rol. Mismo patrón que el hallazgo de Usuarios/Permisos (mig.132). **Fix (mig.136):** INSERT/UPDATE ahora exigen `is_admin()` además de `empresa_id`; SELECT sigue tenant-only (staff puede ver el estado, no modificarlo). Validado: staff bloqueado (0 filas), admin sigue operando normal. Dimensión D — ¿el cierre se respeta en TODOS los puntos de asiento?: `asientosAutoService` (crearAsientoVenta/crearAsientoCompra/crearAsientoMovimientoCaja) SÍ consulta `fecha_en_periodo_cerrado` antes de generar el asiento — pero era "no bloqueante": si el período estaba cerrado, el asiento no se creaba y el error solo iba a `console.warn` (dimensión E, invisible para el usuario), mientras la venta/compra/movimiento operacional se registraba igual sin aviso. **Fix:** los 5 call-sites (`NuevaVentaModal`, `NuevaFacturaModal`, `useConfirmarVenta`, `CompraRapidaSection`, `CajaSection`) ahora muestran un toast destructivo cuando el asiento no se genera por período cerrado, en vez de tragarlo en consola — sigue siendo no-bloqueante (decisión de diseño existente, documentada en el propio código como intencional), pero ya no es silencioso. CxC/CxP/ND no generan asiento todavía (gap sistémico ya documentado) → no aplica el guard ahí | S46 |

| **Multi-moneda / Tipos de cambio** | F·D | 🟡 **CONFIRMADO Y CORREGIDO.** `monto_paralelo`/`tc_paralelo` se persisten atómicamente vía RPC en `crear_venta` (todas sus versiones) y en `registrar_cobro_cliente` (mig.130, con `ROUND(...,2)` server-side) — no hay riesgo de desync ahí. `useTCParalelo.calcParalelo` ya redondea a 2 decimales en JS antes de persistir (columnas `numeric(14,4)` desde mig.076, cierra el hallazgo teórico de esa migración). Pero se encontró el mismo patrón de "escritura de plata sin verificar error" ya visto en CxC/CxP/ND: **`NuevaFacturaProveedorModal.jsx`** y **`CompraRapidaSection.jsx`** insertaban el egreso en `movimientos_caja` (compra pagada en Efectivo) sin capturar/propagar el error — si el insert fallaba, la compra quedaba "pagada" pero Caja nunca reflejaba el egreso (tesorería inflada), mismo síntoma que el bug de CxP cerrado en mig.131 pero en el camino de compra directa/rápida. **Fix:** agregado `if (cajaErr) throw cajaErr` en ambos, igual patrón que ya usaba `CajaSection.jsx`. 🟢 menor (no fixeado): `tipoCambioService.js` calcula "hoy" con `Date` local del browser en vez de `getTodayAR()` — inconsistencia latente de baja probabilidad si el reloj/zona horaria del cliente difiere de Argentina. 🟢 menor (no fixeado, requiere confirmación del usuario para borrar): `tipoCambioService.ts` (getTasaVigente/getHistorial/upsertTasa/deleteTasa) es código muerto — cero imports reales, todo el código vivo usa `tipoCambioService.js` | S46 |

### 🔄 En curso
_(ninguna — **las 15 áreas de la cola original están auditadas**. Ver "Gap sistémico" y "Fase 2" abajo para los pendientes de decisión de negocio que quedan documentados, no son bugs)_

### ⬜ Pendientes — cola priorizada por riesgo (dinero y seguridad primero) — TODAS CERRADAS

| # | Área | Módulo / Tablas | Dimensiones foco | Por qué importa |
|---|------|-----------------|-------------------|-----------------|
| ~~1~~ | ~~Cuenta Corriente Clientes (CxC)~~ | — | — | ✅ AUDITADA S44 (ver tabla de arriba). Queda Hallazgo B (asiento) en gap sistémico |
| ~~2~~ | ~~Cuenta Corriente Proveedores (CxP)~~ | — | — | ✅ AUDITADA S44. Hallazgo 🔴: el pago no descontaba de Caja/Bancos → RPC atómico (mig.131). Queda asiento (gap sistémico) |
| ~~3~~ | ~~Caja / POS~~ | — | — | ✅ AUDITADA S44. Sólido (índice único de sesión, arqueo correcto). Solo limpieza de dead code |
| ~~4~~ | ~~Cheques~~ | — | — | ✅ AUDITADA S44. Tracker aislado, sin 🔴. Gap sistémico (valores en cartera) al log |
| ~~5~~ | ~~Usuarios / Permisos granulares~~ | — | — | ✅ AUDITADA Y CORREGIDA S44. 🟠 confirmado (permisos solo-UI) + fix RLS (mig.132) en 28 tablas + 2 permisos nuevos |
| ~~6~~ | ~~Notas de Débito~~ | — | — | ✅ AUDITADA Y CORREGIDA S44. 🔴 ND recibida no atómica → fix RPC (mig.133) |
| ~~7~~ | ~~Impuestos / IVA / Retenciones~~ | — | — | ✅ AUDITADA Y CORREGIDA S44. 🟡 Libro IVA asumía 21% fijo → usa iva_discriminado real |
| ~~8~~ | ~~Multi-moneda / Tipos de cambio~~ | — | — | ✅ AUDITADA Y CORREGIDA S46. 🟡 egreso de Caja en compra-Efectivo sin verificar error (mismo patrón CxP) → fix en 2 archivos |
| ~~9~~ | ~~Períodos contables / Cierre~~ | — | — | ✅ AUDITADA Y CORREGIDA S46. 🔴 cerrar/reabrir período solo-UI (sin RLS admin) → fix mig.136; 🟡 aviso silencioso de asiento no generado → toast en 5 archivos |
| ~~10~~ | ~~Conciliación bancaria~~ | — | — | ✅ AUDITADA Y CORREGIDA S46. 🔴 match cross-tenant sin guard → trigger mig.137; 🟡 parser CSV no soportaba formato numérico AR |
| ~~11~~ | ~~Ofertas / Descuentos~~ | — | — | ✅ AUDITADA Y CORREGIDA S46. 🟡 producto_id + categoria_nombre evaluados con OR → oferta de un producto se filtraba a toda la categoría → fix mig.138 (más específico gana) |
| ~~12~~ | ~~Cotizaciones / Pedidos~~ | — | — | ✅ AUDITADA Y CORREGIDA S46. 🟡 `crear_entrega` permitía sobre-entrega (más de lo pedido) → guard mig.139 + test pgTAP ampliado; 2 errores silenciosos corregidos en PedidosSection |
| ~~13~~ | ~~Comprobantes — lifecycle~~ | — | — | ✅ AUDITADA Y CORREGIDA S46. 🔴 CRÍTICO: cualquier staff podía BORRAR una factura ya emitida vía API (policy FOR ALL) → fix mig.141 (sin policy de DELETE); 🔴 NC con escrituras sueltas sin capturar error → RPC atómica crear_nota_credito (mig.140); 🔴 mismo DELETE sin restricción en CxC/CxP/ND → fix mig.142 |
| ~~14~~ | ~~Reportes / Dashboard~~ | — | — | ✅ AUDITADA S46. Sólido — RLS bloquea cross-tenant incluso con query adversaria explícita. Sin hallazgos |
| ~~15~~ | ~~Audit log — cobertura~~ | — | — | ✅ AUDITADA Y CORREGIDA S46. 🟡 4 tablas críticas (periodos_contables, notas_debito, movimientos_bancarios, asientos_contables) sin trigger de auditoría → agregado mig.143 |
| 10 | **Conciliación bancaria** | conciliacionService · `extractos_bancarios`, `extracto_lineas` | T·D | Lógica de auto-match; ¿puede conciliar cross-tenant? montos |
| 11 | **Ofertas / Descuentos** | OfertasSection · `ofertas` · `calcular_ofertas_carrito` | T·F | Cálculo de descuentos; guard tenant (ya se agregó, falta correctness) |
| 12 | **Cotizaciones / Pedidos** | Cotizaciones/Pedidos · `cotizaciones`, `pedidos` | T·D | Document flow; contadores por línea; sin doble stock |
| 13 | **Comprobantes — lifecycle** | `comprobantes` (NC emitida, anulación) | D·A | Anulación de facturas; NC; ¿revierte asiento/stock? |
| 14 | **Reportes / Dashboard** | ReportesSection, DashboardSection | T | Agregaciones scoped por empresa; sin fuga entre tenants |
| 15 | **Audit log — cobertura** | `audit_log` | A | ¿Se puebla consistentemente en las operaciones sensibles? |

### ⏸️ Bloqueadas (no auditables hasta acción de Luciano)
| Área | Bloqueo |
|------|---------|
| **AFIP / CAE a producción** | Pipeline construido (arca-worker); requiere cert real + PdV real. `afip_tickets` RLS deny-all = correcto/intencional |

---

## ✅ Fase 5 — Auditoría de la superficie nueva (Centro de Costo, CxC/CxP imputación, Multimoneda, IIBB) — EN CURSO (2026-07-09)

Entre el cierre de la Fase 1-4 (2026-07-04/07) y hoy se agregaron 8 migraciones (168-175) con
lógica financiera real (Open Item clearing, diferencia de cambio, IIBB) que nunca pasaron por
esta metodología. Se retoma la auditoría por esa superficie, priorizada dinero/seguridad primero.

**1. CxC/CxP — Imputación por factura (Open Item clearing, `registrar_cobro_cliente` /
`registrar_pago_proveedor`) — ✅ AUDITADA Y CORREGIDA.**
- **T:** ambas exigen `get_my_empresa_id()` + `has_module_permission('ventas'|'compras')` — intacto.
- **C:** `FOR UPDATE` sobre la factura/compra target de cada imputación serializa correctamente 2
  imputaciones concurrentes sobre el mismo comprobante (la 2ª espera el commit de la 1ª y relee
  `v_ya_imputado` actualizado) — sin condición de carrera.
- **F:** matemática de diferencia de cambio simétrica y con signo correcto: en cobro, TC actual >
  TC origen es GANANCIA (cobrás más ARS-equivalente de lo que cancela la deuda); en pago, es
  PÉRDIDA (pagás más). Verificado que `total_debe`/`total_haber` del asiento siempre igualan la
  suma real de sus líneas en ambas ramas (ganancia/pérdida).
- **E: 🟡 CONFIRMADO Y CORREGIDO.** Ambas RPC generan el asiento de forma no bloqueante (mismo
  patrón que `asientosAutoService`) y devuelven `asiento_generado: false` si falla (período
  cerrado o cuenta faltante) — pero **ningún frontend leía ese campo**: `CuentaCorrienteSection.jsx`
  y `proveedoresService.registrarPago` descartaban `data` y solo miraban `error`. A diferencia del
  fix de períodos contables (mig.136, sesión 46) que sí cubrió Ventas/Compras/Caja vía
  `asientosAutoService`, este camino (CxC/CxP con asiento embebido en la propia RPC) nunca se
  conectó a ningún aviso — el cobro/pago se registraba bien pero el usuario no se enteraba si el
  libro mayor había quedado desincronizado. **Fix:** `registrarPago()` ahora devuelve `data`;
  `CuentaCorrienteSection.jsx` y `ProveedoresSection.jsx` muestran un toast destructivo cuando
  `asiento_generado === false`.
- Sin otros hallazgos — atomicidad, guard de sobre-imputación (`v_monto_imp > v_saldo_pendiente`,
  `v_suma_imputada > v_monto`) y aislamiento tenant correctos en ambas.

**2. IIBB auto-liquidación (`generar_liquidacion_iibb` / `confirmar_liquidacion_iibb`) —
✅ AUDITADA Y CORREGIDA.**
- **T:** ambas exigen `get_my_empresa_id()` + `has_module_permission('configuracion')` — correcto,
  mismo módulo que gatea la pantalla Impuestos.
- **C:** `confirmar_liquidacion_iibb` usa `FOR UPDATE` sobre la fila de liquidación + chequea
  `estado != 'confirmada'` — evita doble confirmación concurrente. Pero **`generar_liquidacion_iibb`
  no tenía NINGÚN guard contra 2 liquidaciones para el mismo período (o solapado)** — un doble clic
  o reintento podía crear 2 filas `'borrador'`, y si ambas se confirmaban, el IIBB devengado quedaba
  contabilizado 2 veces en Plan de Cuentas. 🔴 **Fix (mig.176):** `EXISTS` contra `iibb_liquidaciones`
  antes de generar, bloqueando cualquier período que se solape con uno ya existente (borrador o
  confirmada). Validado con `BEGIN...ROLLBACK`: período parcialmente solapado (15→20 dentro de
  01→31 ya existente) correctamente rechazado.
- **F: 🟡 CONFIRMADO Y CORREGIDO.** La base imponible sumaba `neto_gravado` de TODAS las ventas del
  período (`tipo='venta'`) pero **ignoraba las Notas de Crédito emitidas en ese mismo período** —
  sobrestimando la base (y el impuesto) cada vez que hubo una NC. Confirmado que las NC se guardan
  con montos positivos (mismo signo que las ventas), por lo que el filtro `tipo='venta'` las excluía
  por completo en vez de netearlas. **Fix (mig.176):** la base ahora resta el `neto_gravado` de las
  NC del mismo período (criterio real de Ingresos Brutos — la NC reduce la base en el período en que
  se emite, no retroactivamente en el período de la venta original).
- **E: 🟡 CONFIRMADO Y CORREGIDO.** `confirmar_liquidacion_iibb` devuelve `asiento_generado: false`
  si el asiento no se generó (mismo patrón no-bloqueante que CxC/CxP), pero `TabIIBB.jsx` mostraba
  el toast **"Se generó el asiento contable" incondicionalmente**, sin leer ese campo — un mensaje
  de éxito falso. **Fix:** toast condicional según `data.asiento_generado`, mismo patrón que el
  hallazgo #1 de esta fase.
- Sin otros hallazgos — coeficientes de Convenio Multilateral validados (deben sumar 100), alícuota
  faltante bloquea la liquidación con mensaje claro, redondeo a 2 decimales correcto.

**3. Multimoneda / diferencia de cambio (cálculo) — ✅ AUDITADA, sin hallazgos nuevos.**
La matemática de FX ya se auditó a fondo como parte del área #1 (vive en las mismas RPCs
`registrar_cobro_cliente`/`registrar_pago_proveedor`). Revisado además:
- `get_tasa_cambio()`: tenant-check correcto (`get_my_empresa_id()` OR `service_role`), busca la
  tasa vigente más reciente `<= fecha` con fallback a `NULL` si no hay ninguna (los callers ya usan
  `COALESCE(..., tc_origen)` — sin riesgo de división por cero ni de romper el flujo).
- `crear_venta` persiste `monto_moneda_original` con `ROUND(...,2)` server-side; el cálculo
  client-side (`totalARS / tipoCambioTasa` en `NuevaVentaModal.jsx`) es correcto.
- ✅ **Corregido (mig.184, 2026-07-09):** `registrar_pago_proveedor` llamaba
  `get_tasa_cambio(..., now()::date)` y usaba `now()`/`now()::date` para su propia fecha de
  movimiento — la fecha del **servidor** (UTC), no la Argentina que sí recibía su hermana
  `registrar_cobro_cliente` (`p_fecha`). Fix: se agregó `p_fecha` (nullable, fallback a `now()`
  para no romper callers viejos) y se usa consistentemente en `cuenta_corriente_proveedores.fecha`,
  `movimientos_caja.fecha`, `asientos_contables.fecha`, el chequeo de período cerrado y la búsqueda
  de tipo de cambio — mismo patrón que `registrar_cobro_cliente`. `proveedoresService.registrarPago`
  ahora pasa `getNowAR().toISOString()`. Validado con `BEGIN...ROLLBACK` contra la función real de
  producción: una fecha de "23:30 ART" se propaga correctamente a las 3 tablas sin desviarse al día
  siguiente.

**4. Centro de Costo — ✅ AUDITADA Y CORREGIDA.**
- Ya se había encontrado y corregido 1 regresión (`crear_venta` sin `has_module_permission`,
  ver arriba). Barrido del resto de la superficie (`compras`, `asientos_contables`,
  `centros_costo`, `TabEstadoResultados.jsx`):
- **T: 🔴 CONFIRMADO Y CORREGIDO.** `centros_costo` (tabla nueva de mig.168) se creó **después**
  del barrido sistemático de mig.149/153 que gateó todas las tablas maestras de
  `ConfiguracionSection` con `has_module_permission('configuracion')` — quedó con el mismo patrón
  débil de origen (`FOR ALL`, solo `empresa_id`, sin permiso de módulo). Probado con
  `BEGIN...ROLLBACK`: staff sin permiso `configuracion` insertó un centro de costo falso vía API
  directa. **Fix (mig.177):** mismo patrón exacto que mig.149 — SELECT tenant-only, INSERT/UPDATE/
  DELETE exigen `has_module_permission('configuracion')`. Validado: staff sin permiso bloqueado.
- `compras`/`asientos_contables`: la escritura de `centro_costo_id` va directo al INSERT (no vía
  RPC) — ya protegidas por sus policies existentes (`has_module_permission('compras')` /
  `('configuracion')` respectivamente, confirmadas intactas). Sin hallazgo.
- `TabEstadoResultados.jsx`: filtro de solo lectura sobre `asientos_contables`, cubierto por su
  policy SELECT tenant-only existente. Sin hallazgo.

**5. Toggle "Impuestos Avanzados" — ✅ AUDITADA Y CORREGIDA.**
- El write de `empresas.usa_impuestos_avanzados` ya estaba protegido — va por la misma policy
  `empresas_update` (mig.152, exige `is_admin()`), sin hallazgo ahí.
- **E/D: 🟡 CONFIRMADO Y CORREGIDO.** El diseño original elegido por el usuario fue "Ocultar del
  menú + no ejecutar acciones", pero solo se implementó la primera mitad (`ImpuestosSection.jsx`
  oculta las tabs si el toggle está OFF) — ninguna de las 3 RPCs de impuestos avanzados
  (`generar_liquidacion_iibb`, `confirmar_liquidacion_iibb`, `registrar_retencion_practicada`)
  chequeaba el toggle: un admin (o cualquiera con permiso `configuracion`) podía seguir generando
  liquidaciones IIBB o registrando retenciones por API directa con el toggle en OFF. Riesgo real
  bajo (requiere permiso admin/configuración, es la propia empresa auto-restringiéndose), pero
  completa el diseño elegido. **Fix (mig.178):** las 3 RPCs ahora exigen
  `empresas.usa_impuestos_avanzados = true`, mismo mensaje de error apuntando a dónde activarlo.
  Validado con `BEGIN...ROLLBACK`: toggle forzado a `false` → `generar_liquidacion_iibb` bloqueada
  con el mensaje esperado.

Con esto se cierran las 5 áreas priorizadas de la Fase 5 (superficie nueva post mig.155:
Centro de Costo, CxC/CxP imputación, Multimoneda, IIBB, toggle Impuestos Avanzados).

## ✅ Cierre de pendientes de la Fase 5 — sesión 2026-07-09 (cont.)

**1. Bug "Reintentar CAE" — CERRADO (mig.180).** Ver detalle en CONTEXT.md. Causa raíz: UPDATE
por `comprobante_id` (sin chequear `error`) chocaba contra `uq_fpa_comprobante_activo` cuando
había >1 fila histórica para el mismo comprobante — mismo defecto encontrado también en
`reencolar_caes_pendientes`. Fix: nueva RPC `reintentar_cae_comprobante` + corrección del mismo
patrón en `reencolar_caes_pendientes`, ambas apuntando siempre a la fila más reciente por `id`.

**2. CxC/CxP sin asiento — causa raíz real encontrada y cerrada (mig.181).** Investigando el
alcance de "`asiento_generado=false`" se confirmó en producción (Nalux) que 25/28 cobros y 2/6
pagos reales no tienen asiento — la gran mayoría anteriores a que la función generara asientos
(2026-07-06), pero **5 cobros reales posteriores a esa fecha tampoco lo tienen**, sin imputación
de por medio. Causa raíz: `next_numero_asiento()` leía `MAX(numero)+1` **sin lock**, y
`asientos_contables` tiene `UNIQUE(empresa_id, numero)` real — dos asientos concurrentes para la
misma empresa (ej. una venta y un cobro simultáneos) podían calcular el mismo número; el segundo
en commitear choca contra el índice único, y en `registrar_cobro_cliente`/`registrar_pago_proveedor`
ese error queda atrapado por el `EXCEPTION WHEN OTHERS` y se pierde en silencio (mismo patrón de
"asiento no bloqueante" ya documentado, pero esta vez el fallo era evitable). **Fix:**
`pg_advisory_xact_lock` por empresa en `next_numero_asiento` serializa la concurrencia real.
Además, se agregó la capacidad de **regenerar manualmente** el asiento de un cobro/pago viejo que
quedó sin él: se persiste `dif_cambio_total` (antes se perdía si el asiento fallaba) y `asiento_id`
(NULL mientras no haya asiento) en la fila del cobro/pago; nuevas RPCs `regenerar_asiento_cxc`/
`regenerar_asiento_cxp` (bloqueadas si ya existe asiento o si el período sigue cerrado) crean el
asiento usando la diferencia de cambio ya calculada en el momento original, sin recalcularla con
la cotización de hoy (patrón SAP: documento y asiento como objetos separados). Botón "Regenerar"
en el toast de `CuentaCorrienteSection.jsx`/`ProveedoresSection.jsx`. Validado con
`BEGIN...ROLLBACK` contra un cobro real: asiento creado balanceado, segundo intento correctamente
rechazado ("ya tiene un asiento"), cero filas duplicadas.

**Pendiente de decisión de negocio (no técnica):** los ~27 cobros/pagos históricos de antes del
2026-07-06 no tienen "Regenerar" expuesto en ninguna lista todavía (solo aparece en el toast al
momento del cobro/pago) — si se quiere sanear el histórico completo, falta agregar el botón a la
vista de movimientos de `ClientDetailModal.jsx`/detalle de proveedor. No se hizo en esta sesión
por alcance (afecta un archivo no tocado hoy); las RPCs ya soportan ese caso de uso.

## ✅ "Regenerar" expuesto en el histórico + guard crítico + saneamiento real (mig.183, 2026-07-09)

Antes de exponer el botón en `ClientDetailModal.jsx`/`ProveedoresSection.jsx` se encontró, con
datos reales de producción, que `regenerar_asiento_cxc`/`regenerar_asiento_cxp` **no validaban que
la fila fuera un cobro/pago real** — solo filtraban por `tipo='HABER'`/`'pago'`. Eso significa que
también habrían "regenerado" un asiento de "cobro en efectivo" para filas que NO son plata real:

- **Cheques (mig.182):** `crear_cheque_tercero` inserta HABER con `cheque_id` — su asiento real ya
  existe (DEBE 1.1.6 Cheques en Cartera / HABER 1.1.2) vía el trigger de cheques. "Regenerar"
  habría fabricado un segundo asiento con DEBE Caja, como si hubiese entrado efectivo real.
- **Notas de Crédito / devoluciones:** `crear_nota_credito`/`crear_devolucion` insertan HABER con
  `comprobante_id` apuntando a la NC (nunca a la factura original) y NUNCA setean `metodo_cobro` —
  confirmado con 8 filas reales en producción (todas "NC ..."). Es una reducción de deuda sin plata
  real; "Regenerar" también habría fabricado un DEBE Caja falso.
- Se descartó "excluir por `comprobante_id`" como regla simple porque existe un estilo VIEJO de
  cobro (pre-mig.130, sin tabla de imputación) que SÍ es plata real y liga `comprobante_id` a la
  factura que cancela — pero además siempre seteó `metodo_cobro` (ej. "Cobro Efectivo - Fact. ...").
  1 fila real así en producción.

**Regla validada** contra los 20 candidatos CxC + 6 CxP reales de Nalux (0 falsos positivos):
`CxC regenerable := cheque_id IS NULL AND NOT (comprobante_id IS NOT NULL AND metodo_cobro IS NULL)`;
`CxP regenerable := cheque_id IS NULL` (ND recibida ya usa `tipo='nota_debito'`, distinto de `'pago'`).

**Fix (mig.183):** ambas RPCs ahora rechazan explícitamente cheques y NC/devolución con un mensaje
claro. Validado con `BEGIN...ROLLBACK` (6 casos: cobro genuino simple, NC real, cobro viejo-estilo
con factura linkeada, cheque de tercero simulado, pago genuino, cheque propio simulado — los 6
correctos). Aplicado a producción.

**Frontend:** `ClientDetailModal.jsx` y la tab Cuenta Corriente de `ProveedoresSection.jsx` ahora
muestran un badge "Sin asiento — Regenerar" bajo la descripción de cada fila elegible (mismo
criterio que el guard del RPC, para no mostrar un botón que el RPC va a rechazar). Verificado en
preview contra datos reales: aparece en los 3 "Pago de deuda" de Katy, NO aparece en sus 2 filas de
NC.

**Saneamiento real ejecutado (a pedido explícito del usuario):** se regeneraron los 26 asientos
históricos reales de Nalux (20 CxC + 6 CxP) que quedaron sin asiento desde antes de esta sesión —
todos exitosos, todos balanceados (`total_debe = total_haber`), 0 rechazos. El backlog documentado
en la sección anterior queda en **0 pendientes**.

## Registro de hallazgos (log corrido)

| Fecha | Área | Severidad | Hallazgo | Fix |
|-------|------|-----------|----------|-----|
| 2026-07-09 | Impuestos Avanzados | 🟡 | El toggle solo ocultaba las tabs en el frontend — el diseño elegido ("no ejecutar acciones") nunca se implementó a nivel RPC en `generar_liquidacion_iibb`/`confirmar_liquidacion_iibb`/`registrar_retencion_practicada` | Las 3 RPCs ahora exigen `usa_impuestos_avanzados=true` (mig.178) |
| 2026-07-09 | Centro de Costo | 🔴 | `centros_costo` con policy `FOR ALL` débil (solo `empresa_id`, sin permiso de módulo) — se creó después del barrido sistemático que protegió el resto de tablas maestras de Configuración | Mismo patrón que mig.149: SELECT tenant-only, CUD exige `has_module_permission('configuracion')` (mig.177) |
| 2026-07-09 | Multimoneda | 🟢 | `registrar_pago_proveedor` usa `now()::date` (fecha del servidor UTC) para `get_tasa_cambio` en vez de la fecha Argentina del pago — ventana angosta (pagos después de 21:00 ART con tasa de "mañana" ya cargada) | No fixeado — documentado, mismo criterio que hallazgos 🟢 previos de esta auditoría |
| 2026-07-09 | IIBB | 🔴 | `generar_liquidacion_iibb` sin guard contra 2 liquidaciones para el mismo período (o solapado) — doble confirmación duplicaría el IIBB contabilizado | `EXISTS` contra períodos solapados antes de generar (mig.176) |
| 2026-07-09 | IIBB | 🟡 | Base imponible ignoraba las Notas de Crédito del período (solo sumaba `tipo='venta'`), sobrestimando el impuesto | Base neteada: ventas − NC del mismo período (mig.176) |
| 2026-07-09 | IIBB | 🟡 | `TabIIBB.jsx` mostraba "Se generó el asiento contable" sin chequear `asiento_generado` — mensaje de éxito falso si el asiento no se generó | Toast condicional según el campo real de la respuesta |
| 2026-07-09 | CxC/CxP imputación | 🟡 | `registrar_cobro_cliente`/`registrar_pago_proveedor` devuelven `asiento_generado: false` cuando el asiento no se genera (período cerrado/cuenta faltante), pero ningún frontend leía ese campo — el cobro/pago se registraba sin avisar que el libro mayor no reflejó el movimiento | `registrarPago()` devuelve `data`; toast destructivo en `CuentaCorrienteSection.jsx` y `ProveedoresSection.jsx` cuando `asiento_generado === false` |
| 2026-07-09 | Permisos granulares (regresión) | 🔴 | `crear_venta` perdió el gate `has_module_permission('ventas')` que la mig.155 le había agregado — alguna migración posterior que la recreó (170 monto_moneda_original o 174 centro_costo_id) partió de una copia vieja del body (pre-155) en vez de la definición vigente. De las 16 RPCs gateadas por mig.155, era la ÚNICA que lo había perdido (confirmado con query a `pg_proc` sobre las 16 + barrido extendido a IIBB/cheques/retenciones — sin otras regresiones). Probado con BEGIN...ROLLBACK: staff con `ventas=false` forzado en la misma transacción → `crear_venta` lanzó `No autorizado: sin permiso de módulo ventas` como se esperaba | Gate restaurado (mig.175), mismo patrón textual que las otras 15 funciones. **Lección de proceso:** toda migración que haga `DROP+CREATE` sobre una función ya gateada debe partir de `pg_get_functiondef` de la definición VIGENTE en producción, no de una versión archivada en `supabase/migrations/`, para no perder fixes de seguridad aplicados después de esa versión |
| 2026-07-04 | Audit log | 🟡 | 4 tablas críticas (`periodos_contables`, `notas_debito`, `movimientos_bancarios`, `asientos_contables`) sin trigger de auditoría — cerrar un período no dejaba ningún rastro | Agregado `trg_audit_*` (función genérica existente) a las 4 (mig.143) |
| 2026-07-04 | Comprobantes | 🔴 | Mismo patrón de DELETE sin restricción en `cuenta_corriente_movimientos`, `cuenta_corriente_proveedores` y `notas_debito` — staff sin permiso borró movimientos reales de CxC/CxP/ND | Policies divididas SELECT/INSERT/UPDATE, sin DELETE, en las 3 tablas (mig.142) |
| 2026-07-03 | Comprobantes | 🔴 | Policy RLS de `comprobantes` era FOR ALL sin distinguir DELETE — cualquier staff pudo borrar una factura de $50.000 vía API directa, sin ningún call-site legítimo en el frontend | Policy dividida SELECT/INSERT/UPDATE, sin policy de DELETE (mig.141) |
| 2026-07-03 | Comprobantes | 🔴 | `NuevaNCModal.jsx`: 3 escrituras sueltas (comprobante, items, CC HABER), la 3ra sin capturar error — si fallaba, la NC se creaba pero la deuda del cliente no bajaba | RPC atómica `crear_nota_credito` (mig.140), mismo patrón que crear_nota_debito |
| 2026-07-03 | Cotizaciones/Pedidos | 🟡 | `crear_entrega` no validaba sobre-entrega — se pudo entregar el doble de lo pedido (10 sobre un pedido de 5) sin ningún error, rompiendo el invariante cantidad_entregada<=cantidad_pedida | Guard FOR UPDATE en mig.139; test pgTAP ampliado (Caso 5) |
| 2026-07-03 | Ofertas/Descuentos | 🟡 | `calcular_ofertas_carrito` evaluaba `producto_id`/`categoria_nombre` con OR — una oferta para un producto específico se filtraba a toda su categoría si el admin completaba ambos campos | `producto_id`, cuando está seteado, es excluyente (mig.138); UI aclara la precedencia |
| 2026-07-03 | Conciliación bancaria | 🔴 | `matchManual`/`autoMatch` matcheaban `extracto_lineas.movimiento_id` sin verificar tenant — solo FK. Probado: admin de Empresa A concilió cross-tenant un movimiento de Empresa B | Trigger `fn_guard_match_tenant` BEFORE UPDATE valida empresa_id coincidente (mig.137) |
| 2026-07-03 | Conciliación bancaria | 🟡 | `parsearCSV` no soportaba formato numérico AR (miles con punto) — "1.234,56" se leía como 1.234 | Helper `parseMontoCSV` remueve puntos de miles antes de reemplazar la coma decimal |
| 2026-07-03 | Períodos contables | 🔴 | Cerrar/reabrir/crear período contable era solo-UI (`isAdmin` en `PlanCuentasSection.jsx`); RLS de `periodos_contables` solo verificaba `empresa_id`. Probado: staff no-admin cerró 2 períodos reales vía API directa | INSERT/UPDATE ahora exigen `is_admin()` (mig.136). SELECT sigue tenant-only |
| 2026-07-03 | Períodos contables | 🟡 | `asientosAutoService` sí frena el asiento si el período está cerrado, pero el error solo iba a `console.warn` — invisible para el usuario, y la venta/compra/movimiento se registraba igual sin aviso | Toast destructivo en los 5 call-sites cuando el asiento no se genera por período cerrado (sigue no-bloqueante por diseño) |
| 2026-07-03 | Multi-moneda | 🟡 | `NuevaFacturaProveedorModal.jsx` y `CompraRapidaSection.jsx`: egreso de `movimientos_caja` en compra pagada en Efectivo se insertaba sin capturar el error — si fallaba, la compra quedaba "pagada" sin reflejo en Caja (mismo patrón que el bug de CxP cerrado en mig.131) | Agregado `if (cajaErr) throw cajaErr` en ambos archivos, igual patrón que `CajaSection.jsx` |
| 2026-07-02 | Impuestos/IVA | 🟡 | `ReporteLibroIVA.jsx` (Libro IVA Ventas, insumo DDJJ) asumía 21% fijo para todo comprobante en vez de usar `iva_discriminado`/`neto_gravado` reales ya calculados por `crear_venta` | Usa columnas reales con fallback solo para comprobantes viejos (igual patrón que ya tenía el Libro IVA Compras) |
| 2026-07-02 | Notas de Débito | 🔴 | ND recibida (proveedor) no atómica: RPC + insert suelto en CC proveedores; si el 2º fallaba, la deuda no subía | Movido dentro del RPC en una sola transacción (mig.133) |
| 2026-07-02 | Usuarios/Permisos | 🟠 | Permisos granulares por módulo eran solo-UI; staff sin permiso `compras` insertó en `proveedores` vía API (probado con ROLLBACK) | RLS real: `has_module_permission()` + policies SELECT/CUD en 28 tablas (mig.132); permisos nuevos `bancos`/`cheques` |
| 2026-07-03 | Usuarios/Permisos (fase 2 SELECT) | 🟠 | Mig.132 dejó SELECT tenant-only; Staff con {dashboard,ventas} pudo LEER Historial de Compras completo ($8.372.098 en 12 compras) desde Compra Rápida/Proveedores | Mig.134 gatea SELECT con `has_module_permission` en 17 tablas exclusivas: 5 compras + 3 ventas + 3 bancos + 2 cheques + 4 configuracion. Excluidas intencionalmente: `facturas_proveedor` y `asientos_contables` (insumo de reportes cross-módulo). Verificado con ROLLBACK: staff bloqueado ve 0 filas; staff con permiso ve todo; admin siempre ve todo. **Pendiente aparte (✅ CERRADO — ver mig.135 y mig.185 más abajo):** UI degradada en componentes cross-módulo (dropdowns vacíos) — resuelto con RPCs SECURITY DEFINER scoped id+nombre |
| 2026-07-02 | Cheques | 🟡 | Registro de cheques desacoplado del motor de dinero: cobrar/depositar no impacta Bancos; falta cuenta "Valores en Cartera"; "Cheque" sin mapear en `metodo_pago_cuenta_bancaria`; rechazo no restaura deuda | **Gap sistémico** — requiere contador (misma familia sub-libros) |
| 2026-07-02 | Cheques | 🟢 | `cheques_historial` se inserta en 2ª llamada frontend (no atómica con el update de estado) | Nota — no 🔴, audit-trail; se puede mover a trigger a futuro |
| 2026-07-02 | Caja/POS | 🟢 | `cajaService.insertMovimiento` dead code con bug latente (user_id=empresaId) | Eliminado |
| 2026-07-02 | CxP Proveedores | 🔴 | Pagar a un proveedor NO descontaba de Caja/Bancos (tesorería inflada); ni capturaba método | RPC atómico `registrar_pago_proveedor` (mig.131) + selector de método |
| 2026-07-02 | CxC Clientes | 🔴 | Cobro no atómico (2 inserts sueltos): si el 2º falla, deuda baja sin registrar plata; reintento la baja 2 veces | RPC atómico `registrar_cobro_cliente` (mig.130) + frontend |
| 2026-07-02 | CxC / sub-libros | 🟡 | El cobro no genera asiento contable (mayor diverge del sub-libro) | **Gap sistémico** — ver nota abajo, requiere contador |
| 2026-07-02 | Bancos/Contab. | 🔴 | Borrar movimiento contabilizado → asiento huérfano | Trigger BEFORE DELETE (mig.128) + UI |
| 2026-07-02 | Bancos/Contab. | 🟡 | `contabilizar` sin FOR UPDATE → posible doble asiento | FOR UPDATE (mig.129) |
| 2026-07-01 | MP | 🔴 | Egresos MP registrados como ingreso | collector_id vs mp_user_id |
| 2026-07-01 | Integraciones | 🔴 | `integraciones_bancarias` sin gate admin (tokens legibles por cualquier user) | RLS admin-only (mig.124) |

---

## ✅ Gap sistémico — Contabilización de sub-libros (CERRADO 2026-07-04, esquema propuesto por Claude)

Los sub-libros (Caja, Bancos, Cuenta Corriente) mueven dinero pero antes **solo Ventas y Compras
generaban asiento automático** (asientosAutoService). Cobros, pagos y cheques no asentaban → el mayor
contable podía divergir de los sub-libros. Se empezó a cerrar con la **Determinación de Cuentas +
contabilización de Bancos** (S43); ahora se cierra Caja/CC (cobros/pagos) y Cheques de terceros.

⚠️ **El esquema de cuentas fue definido por Claude (no por el contador)** — reutiliza los mismos
códigos de cuenta que ya usaba `asientosAutoService` para Ventas/Compras, con el mismo patrón "no
bloqueante" (si falta la cuenta o el período está cerrado, la operación de plata se completa igual,
sin asiento). **Debe ser validado por el contador de Nadia/Luciano antes de confiar en los reportes
contables que dependan de esto** (Balance General, Estado de Resultados).

**Cobro a cliente (mig.144):** DEBE `1.1.1 Caja y Bancos` / HABER `1.1.2 Cuentas a Cobrar`.
**Pago a proveedor (mig.144):** DEBE `2.1.1 Cuentas a Pagar` / HABER `1.1.1 Caja y Bancos`.
Ambos embebidos dentro de `registrar_cobro_cliente`/`registrar_pago_proveedor` (misma transacción
atómica). Validado con BEGIN...ROLLBACK: cobro de $1000 y pago de $700 generan asientos balanceados
con las cuentas correctas.

**Cheques de terceros (mig.145):** la cuenta `1.1.6 Cheques de Terceros en Cartera` ya estaba
seedeada en el plan de cuentas pero sin uso — ahora:
- Recibido (INSERT, estado `en_cartera`): DEBE `1.1.6` / HABER `1.1.2 Cuentas a Cobrar` (si tiene
  cliente) o `4.3 Otros Ingresos` (si no).
- Cobrado (transición a `cobrado`): DEBE `1.1.1 Caja y Bancos` / HABER `1.1.6`.
- Rechazado (transición a `rechazado`): reversa simétrica al recibido — restaura la deuda del cliente.
Validado con BEGIN...ROLLBACK: cheque recibido + cobrado y cheque recibido + rechazado, ambos con las
cuentas correctas y asientos balanceados.

**✅ RESUELTO (2026-07-08, sesión 52, migration 166):** cheques *propios* (entregados a proveedores)
ahora sí se contabilizan. Se agregó la cuenta `2.1.6 Documentos a Pagar` (pasivo) y un trigger nuevo
(`fn_asiento_cheque_propio`): Entregado → DEBE `2.1.1 Cuentas a Pagar` / HABER `2.1.6`; Cobrado →
DEBE `2.1.6` / HABER `1.1.1 Caja y Bancos`; Rechazado desde 'entregado' → reversa (la deuda con el
proveedor vuelve a estar viva); rechazado desde 'pendiente' (nunca entregado) → sin asiento. De paso
se corrigieron 2 hallazgos de mercado en cheques de terceros: (1) bug real — un cheque endosado a un
proveedor y luego marcado "cobrado" generaba antes un DEBE Caja y Bancos como si hubiese entrado
efectivo real; ahora el asiento se dispara en el momento del endoso, contra `2.1.1` del proveedor; (2)
los cheques rechazados ahora van a una cuenta dedicada `1.1.7 Deudores por Cheques Rechazados` en vez
de revertir directo a Cuentas a Cobrar (práctica de mercado — Tango, Colppy — para separar cobranza
sana de cobranza dudosa). También se agregó un flag `es_electronico` (sin integración COELSA) porque
el e-cheq es hoy mayoritario en Argentina. Validado con pgTAP-equivalente (`BEGIN...ROLLBACK`, tenant
aislado, 10 casos) antes de aplicar a producción — ver `PLAN_PRUEBAS_NADIA_2026-07-08.md` para la
verificación manual pendiente (no se pudo cerrar un test end-to-end desde el botón de la UI por un
problema del navegador automatizado, no del código — se le pide a Nadia que lo haga).

## ✅ Fase 2 técnica de permisos granulares — CERRADA (2026-07-04)

Extendido `has_module_permission()` (mig.132) a las 5 tablas que quedaban con gate solo de tenant:
`pedidos`/`pedido_items` (módulo `ventas`), `entregas`/`entrega_items` (módulo `ventas`),
`comprobantes`/`comprobante_items` (módulo `ventas`), `recepciones`/`recepcion_items` (módulo
`compras`), `cuenta_corriente_proveedores` (módulo `compras`) — mismo mapeo de módulo que ya usaban
`cotizaciones`/`ofertas` y `ordenes_compra`/`proveedores` respectivamente, así que ningún staff pierde
acceso que ya tenía (mig.146). `comprobantes` y `cuenta_corriente_proveedores` ya tenían policies
separadas sin DELETE (mig.141/142) — se les agregó el gate de permiso a INSERT/UPDATE sin reintroducir
DELETE. SELECT se mantiene tenant-only en las 5 (sin gate de permiso) para no repetir la rotura de
dropdowns cross-módulo que causó mig.134→mig.135.

Validado con BEGIN...ROLLBACK: staff con permiso `ventas` inserta pedido (OK); staff sin permiso
`compras` bloqueado en `cuenta_corriente_proveedores` (RLS deniega el INSERT); la RPC
`registrar_pago_proveedor` (SECURITY DEFINER) sigue funcionando igual para ese mismo staff, sin
cambios — bypasea RLS por table ownership, como todo el motor de dinero del sistema.

Con esto se cierran los 3 pendientes documentados al terminar la Fase 1: el gap sistémico de
contabilización y esta Fase 2 técnica. No queda ningún ítem abierto en este plan salvo lo que
explícitamente requiere al contador (validar el esquema de cuentas propuesto) o al usuario (decidir
si se agrega la cuenta de Documentos a Pagar para cheques propios).

## ✅ Cierre de la Fase 1 — las 15 áreas de la cola original auditadas (2026-07-04)

Las 15 áreas de la cola priorizada quedaron auditadas, con hallazgo y fix documentado donde
correspondía. Resumen de severidad: 8 🔴 críticos corregidos, 6 🟡 corregidos, 1 🟠 corregido, y 2
áreas sólidas sin hallazgos (Caja/POS, Reportes/Dashboard). Los dos temas que **no** se cerraron son,
a propósito, decisiones de negocio que requieren al contador (no bugs de código):

1. **Gap sistémico de sub-libros sin asiento** (Caja/CxC/CxP no generan asiento automático — ver
   sección de arriba).
2. **Cheques → cuenta "Valores en Cartera"** (ver sección de arriba).

Y una Fase 2 técnica de bajo riesgo, documentada pero no crítica: extender
`has_module_permission()` a `pedidos`, `entregas`, `comprobantes`, `recepciones`, `cuenta_corriente_proveedores`
para escritura directa (hoy solo gateadas por tenant, no por permiso de módulo).

## ✅ Limpieza de hallazgos 🟢 menores — CERRADA (2026-07-04)

Los 4 hallazgos de bajo riesgo que quedaron documentados sin corregir a lo largo de la Fase 1:

1. **`tipoCambioService.ts`** (código muerto, cero imports reales) — **borrado**.
2. **`tipoCambioService.js`** usaba `Date` local del browser en vez de zona horaria Argentina —
   ahora usa `getTodayAR()` (mismo patrón que el resto del sistema).
3. **`cheques_historial`** se insertaba en una 2da llamada separada del frontend, no atómica con el
   cheque — ahora 3 RPCs (`crear_cheque_tercero`, `crear_cheque_propio`, `cambiar_estado_cheque`,
   mig.147) hacen cheque + historial en una sola transacción. Replican el gate
   `has_module_permission('cheques')` para no perder la protección de mig.132 (las RPCs SECURITY
   DEFINER bypasean RLS por table ownership). Validado con BEGIN...ROLLBACK: staff sin permiso
   bloqueado, admin crea cheque + historial atómico, cambia estado + 2do historial atómico.
4. **Numeración de certificado de Retención** (`generarNumeroCertificado`) usaba `count()` en el
   cliente sin lock — ahora `registrar_retencion_practicada` (mig.148) usa un advisory lock
   transaccional (empresa+año) para serializar cálculo + insert. No se usó `series_numeracion`
   porque el formato "RET-{año}-####" reinicia por año, distinto al resto de documentos (continuos).
   Validado: 2 llamadas consecutivas devuelven números correlativos correctos.

Build verificado, advisors sin hallazgos nuevos.

## ✅ Fase 3 — Áreas fuera de la cola original (2026-07-04)

Después de cerrar las 15 áreas de la cola priorizada (dinero/seguridad primero), se hizo un
barrido de lo que quedó afuera: módulos/tablas que existen en el código pero nunca entraron
en la auditoría porque no eran de los de mayor riesgo obvio. Se encontraron y corrigieron
**3 hallazgos 🔴**, todos el mismo patrón recurrente de esta auditoría (policy `FOR ALL` con
solo `empresa_id`, sin gate de admin ni de permiso de módulo — algunas tablas quedaron afuera
del barrido de mig.132/134/146 por descuido, no por diseño):

| Tabla | Hallazgo probado con ROLLBACK | Fix |
|-------|-------------------------------|-----|
| `condiciones_pago`, `unidades_medida` | Staff sin permiso insertó una condición de pago falsa (360 días, 99% dto) y borró las 11 unidades de medida reales de su empresa | mig.149 — SELECT tenant-only, CUD con `has_module_permission('configuracion')` |
| `puntos_venta` | Staff no-admin ejecutó `UPDATE ... SET ultimo_numero_b = X` sin error — riesgo fiscal real (numeración AFIP duplicada) | mig.150 — CUD exige `is_admin()` (mismo nivel que `periodos_contables`) |
| `tipos_comprobante_afip`, `caea_comprobantes`, `caea_registros`, `facturas_pendientes_arca` | Mismo patrón débil en 4 tablas del módulo AFIP/ARCA; 3 sin call-site de escritura real en frontend (solo Edge Functions `service_role`), 1 sí (`facturas_pendientes_arca`, botón "Reintentar CAE" en Historial de Ventas) | mig.151 — las 3 primeras a `is_admin()` (defensa en profundidad); `facturas_pendientes_arca` a `has_module_permission('ventas')` (mismo permiso que ya gatea esa pantalla) |

Áreas revisadas en esta ronda **sin hallazgo** (ya estaban bien protegidas):
`determinacion_cuentas_mayor` (mig.126, admin-only desde el origen), `metodo_pago_cuenta_bancaria`
(ya cubierta por mig.132 con `has_module_permission('bancos')`), `listas_precio`/`lista_precio_items`
(ya cubiertas por mig.132 con `has_module_permission('clientes')`), `rate_limit_attempts`
(deny-all a nivel RLS, acceso solo vía función `SECURITY DEFINER` — diseño correcto). Las tablas
`ventas_backup`/`detalle_ventas_backup` ya habían sido eliminadas (mig.068).

Build verificado, advisors sin regresiones nuevas para ninguna de las 7 tablas tocadas.

**Continuación misma sesión — 2 hallazgos 🔴 más (mig.152):** siguiendo el mismo criterio de
"repasar `ConfiguracionSection` tabla por tabla", aparecieron 2 más, ambos con datos reales
(probados y revertidos con ROLLBACK, sin tocar producción):

| Tabla | Hallazgo | Fix |
|-------|----------|-----|
| `empresas` | La policy `empresas_update` (mig.006/016) no exigía admin — un staff no-admin modificó `nombre`, `cuit`, `afip_cuit` y `usa_factura_electronica` de la empresa real sin ningún error. Es la tabla raíz del tenant: identidad legal/fiscal completa | `empresas_update` ahora exige `is_admin()`. Confirmado que el único escritor no-admin (`OnboardingWizard.jsx`) siempre corre con el creador del tenant, que mig.006 fuerza a `role='admin'` — no rompe el alta de empresas nuevas |
| `series_numeracion` | Mismo patrón débil (`FOR ALL`, solo `empresa_id`) — un staff alteró `proximo_numero` de una serie real sin error | CUD ahora exige `is_admin()`; `obtener_proximo_numero()` (usada por el flujo normal de venta) es `SECURITY DEFINER`, sigue funcionando igual |

Se revisó también el advisor preexistente sobre `seed_series_numeracion` (callable directo por
`authenticated`) — no es una regresión de esta ronda: ya fue evaluado y mitigado en mig.057
(sesión 32), con guard de tenant + `ON CONFLICT DO NOTHING` como mitigación aceptada explícitamente
(riesgo residual documentado y considerado bajo). No requiere acción nueva.

Build verificado de nuevo, advisors sin regresiones para `empresas`/`series_numeracion`.

**Pendiente para una futura ronda** (menor prioridad, no se llegó a auditar en esta sesión):
repasar el resto de tablas que cuelgan de `ConfiguracionSection` con el mismo criterio
tabla-por-tabla (¿tiene RLS?, ¿el gate coincide con el nivel real de riesgo?) — quedan
`cuentas_bancarias`/`integraciones_bancarias` ya confirmadas sólidas en esta ronda, pero no se
revisó exhaustivamente cada tabla restante del schema (ej. `afip_tickets` ya es deny-all
intencional, confirmado en sesiones previas).

## ✅ Barrido sistemático completo — TODAS las tablas de `public` (mig.153, 2026-07-04)

A pedido explícito del usuario ("quiero dejar absolutamente todo auditado, no pasemos a otro
tema"), se abandonó el enfoque de ir tabla-por-tabla adivinando y se hizo un query directo a
`pg_policies` cruzando TODAS las tablas de `public` contra el patrón de gate esperado. Aparecieron
**6 tablas más** con el mismo patrón débil (`FOR ALL`/CUD sin `has_module_permission` ni
`is_admin`), confirmadas con `BEGIN...ROLLBACK` contra datos reales antes del fix: un staff sin
ningún permiso especial pudo `UPDATE` sobre `cajas`, `categorias`, `cuenta_corriente_movimientos`
(monto → $999.999), `notas_debito` (monto → $999.999), y `DELETE` sobre `devoluciones` y
`movimientos_inventario` (el libro de auditoría de stock).

| Tabla | Módulo asignado | Motivo |
|-------|------------------|--------|
| `cajas` | `caja` | Igual que `caja_sesiones`/`movimientos_caja` (mig.132). Sin call-site de escritura en frontend (solo trigger de alta de empresa, SECURITY DEFINER) — gate puramente defensivo |
| `categorias` | `productos` | Igual que la tabla `productos`; escrita desde `ProductosSection.jsx` |
| `comprobante_pagos` | `ventas` | CERO call-sites de escritura detectados (tabla sin uso real) — gateada por defensa en profundidad |
| `movimientos_inventario` | `productos` | Es un libro de auditoría de stock — se le sacó la policy de DELETE (mismo principio "se anula, no se borra" de mig.141/142) |
| `devoluciones` / `devolucion_items` | `ventas` OR `compras` | Uso dual confirmado (`tipo='cliente'` es ventas, `tipo='proveedor'` es compras, ver `crear_devolucion`). Se sacó DELETE (sin call-site legítimo) |
| `cuenta_corriente_movimientos` (CxC clientes) | `ventas` | Quedó afuera de mig.146 por descuido — su hermana `cuenta_corriente_proveedores` ya tenía `compras` desde esa migración |
| `notas_debito` | `ventas` OR `compras` | Mismo uso dual que devoluciones (`tipo='emitida'`/`'recibida'`). DELETE ya estaba ausente desde mig.142 |

Validado con `BEGIN...ROLLBACK`: las 8 combinaciones bloqueadas para staff sin el permiso
correspondiente (incluyendo un caso donde se puso `permissions.ventas=false` y
`permissions.compras=false` explícitamente dentro de la transacción para forzar el caso negativo,
ya que los 2 únicos staff no-admin reales de la base tienen `ventas=true`); admin siempre pasa.
Confirmado que todas las RPCs SECURITY DEFINER involucradas (`crear_venta`, `crear_devolucion`,
`crear_nota_debito`, `registrar_cobro_cliente`, `decrement_stock`/`increment_stock`) siguen
funcionando sin cambios — bypasean RLS por table ownership, igual que el resto del motor de dinero.

Build verificado, advisors sin regresiones nuevas para ninguna de las 8 tablas tocadas.

**Con esto, el barrido de `pg_policies` sobre TODAS las tablas de `public` no muestra ningún otro
patrón "`FOR ALL`/CUD sin `is_admin`/`has_module_permission`" pendiente** — quedan únicamente
tablas ya confirmadas sólidas (deny-all intencional como `afip_tickets`/`rate_limit_attempts`, o
ya gateadas correctamente desde mig.132/134/146). No queda ninguna tabla de negocio con esta clase
de hallazgo sin cerrar.

## ✅ Fase 4 — Permiso de módulo faltante en RPCs "punto de entrada" (mig.154, mig.155)

Al arreglar `insertar_movimiento_bancario_externo` (mig.154 — bancos) se descubrió una categoría
de hallazgo más grande: **todo el motor de dinero del sistema** (`crear_venta`, `crear_devolucion`,
`crear_entrega`, `crear_recepcion`, `registrar_cobro_cliente`, `registrar_pago_proveedor`,
`decrement_stock`/`increment_stock`, `ajustar_stock_manual`, `crear_nota_credito`,
`crear_nota_debito`, etc.) valida que `empresa_id` coincida con el tenant del caller, pero
**ninguna valida `has_module_permission()`** — al ser `SECURITY DEFINER` y estar otorgadas a
`authenticated`, cualquier empleado (sin importar sus permisos asignados) podía llamarlas
directamente vía `supabase.rpc(...)`, sin pasar por ninguna pantalla, y bypasear por completo el
sistema de permisos granulares construido en las mig.132/134/146/153.

**Metodología:** antes de tocar nada se hizo un mapeo con `pg_proc` + grep de call-sites reales en
`src/` para separar RPCs "punto de entrada" (llamadas solo desde una pantalla — seguro gatearlas
con el permiso de esa pantalla) de RPCs "pieza interna" (`obtener_proximo_numero`,
`fecha_en_periodo_cerrado` — llamadas por RPCs de distintos módulos, NO se tocan porque gatearlas
rompería flujos cruzados: un vendedor sin permiso `productos` fallaría al vender si `crear_venta`
llamara internamente algo gateado a `productos`). Se confirmó con una query a `pg_proc` que ninguna
de las 16 funciones tocadas es llamada por otra `SECURITY DEFINER` — son 100% puntos de entrada.

**mig.155** agregó el gate correspondiente a 16 RPCs:
- `ventas`: `crear_venta`, `crear_entrega`, `crear_nota_credito`, `registrar_cobro_cliente`,
  `reencolar_caes_pendientes`, `usar_caea_en_venta`*, `siguiente_numero_documento`*
- `compras`: `crear_recepcion`, `crear_recepcion_implicita`, `registrar_pago_proveedor`,
  `aplicar_compra_producto`, `decrement_stock`, `increment_stock`
- `productos`: `ajustar_stock_manual`
- `ventas` OR `compras` (dual): `crear_devolucion`, `crear_nota_debito`
- (* sin call-site real en el frontend hoy — gateadas por defensa en profundidad)

Ya estaban bien (no se tocaron): `contabilizar_movimiento_bancario` y
`revertir_contabilizacion_movimiento` ya exigían `is_admin()` desde su creación.

Antes de aplicar en producción se validó cada patrón con `BEGIN...ROLLBACK`: `crear_venta` probado
end-to-end (creó comprobante + entrega + movimiento de caja + descontó stock correctamente con el
permiso; bloqueado sin él), `ajustar_stock_manual` (patrón sin `p_empresa_id` explícito), y las 9
funciones restantes en un solo test comprehensivo — las 16 quedaron confirmadas: bloqueadas sin el
permiso, funcionando normal con el permiso correcto. Build verificado, advisors sin regresiones
(el único hallazgo que aparece es el lint informativo preexistente "callable by authenticated",
igual al de todas las RPCs de dinero desde el inicio de esta auditoría — es el diseño esperado).

**mig.154** cerró el hallazgo original: `insertar_movimiento_bancario_externo` (ambas sobrecargas)
ahora exige `has_module_permission('bancos')` para el camino no-`service_role`, preservando la
excepción para los webhooks de MercadoPago.

## ✅ Fase 6 — Checkbox "No relevante para AFIP" en POS/NC (commit 3d781de, Nadia) — AUDITADA (2026-07-09)

Nadia extendió el patrón ya existente en `NuevaFacturaModal.jsx` (checkbox que fija
`relevante_fiscal=false` para excluir un comprobante de CAE) a `NuevaVentaModal.jsx`/`PanelPago.jsx`
(POS) y `NuevaNCModal.jsx`. A diferencia del original (que setea `relevante_fiscal` en el mismo
INSERT vía `crear_venta`), estos 2 flujos lo hacen con un `UPDATE` de seguimiento después de la RPC,
porque `crear_venta`/`crear_nota_credito` no aceptan ese parámetro.

- **T:** sin cambios de gate — el `UPDATE` cae bajo `comprobantes_update` (`empresa_id = tenant AND
  has_module_permission('ventas')`), confirmado en producción. Sin hallazgo.
- **C (orden/carrera):** confirmado en producción que `trg_queue_factura_arca` dispara SOLO en
  `AFTER UPDATE OF cae_estado` (no en INSERT) y que `comprobantes.cae_estado` default es
  `'no_aplica'` — con `noRelevanteFiscal=true` el código nunca llega a actualizar `cae_estado`, así
  que el trigger jamás se dispara para ese comprobante. Sin condición de carrera.
- **F/E — defensa en profundidad confirmada:** tanto `fn_queue_factura_arca` como
  `reencolar_caes_pendientes` (ambas leídas frescas de producción) chequean explícitamente
  `relevante_fiscal = false → no encolar` — aunque el `UPDATE` de seguimiento fallara en el
  frontend, ningún proceso (ni el trigger ni el reencolado masivo) podría emitir CAE para ese
  comprobante, porque además `cae_estado` nunca se movió de `'no_aplica'`.
- 🟢 **Hallazgo menor, no fixeado (documentado, mismo criterio de tolerancia que otros 🟢 de esta
  auditoría):** si el `UPDATE` de seguimiento a `relevante_fiscal` falla (red, etc.), el error solo
  va a `console.warn` — el comprobante queda con `relevante_fiscal=true` en la base aunque el
  usuario haya tildado "no relevante" (inconsistencia de dato para reportes, sin impacto funcional
  real por la defensa en profundidad de arriba). Mismo patrón ya presente en el propio archivo para
  el `UPDATE` de encolado AFIP (`console.warn('[AFIP queue]', ...)`) — consistente con el código
  existente, no es una regresión introducida.

Sin hallazgos críticos ni importantes. Feature correcta y segura tal como está.

## ✅ Cheques — circuito completo A+B+C (mig.182, 2026-07-09) — CERRADO

A pedido explícito del usuario ("las 3 cosas"), se cerró el gap sistémico de Cheques documentado
desde la Fase 1 original (S44: "gap sistémico — cobrar/depositar un cheque no genera movimiento en
Bancos... rechazo no restaura deuda"). Investigando el alcance real se encontró que Cheques ya
generaba asientos de Mayor (mig.145/166, sesiones previas) para recibido/endosado/cobrado/rechazado
con la cuenta puente 1.1.6 "Cheques de Terceros en Cartera" — pero nunca tocaba
`cuenta_corriente_movimientos`/`cuenta_corriente_proveedores` (la subcuenta por cliente/proveedor
que usan las pantallas de Cuenta Corriente) ni `movimientos_bancarios` — un cliente podía pagar con
cheque y seguir figurando con la factura completa impaga en Cuenta Corriente, aunque el Mayor
estuviera bien.

**(A) Recibir un cheque de un cliente** (`crear_cheque_tercero`) ahora inserta una fila HABER en
`cuenta_corriente_movimientos` (cancela el saldo del cliente) y, si viene con `comprobante_id`,
una fila en `cuenta_corriente_imputaciones` (cancela la factura puntual, con la misma validación
de sobre-imputación que `registrar_cobro_cliente`). Simétrico para cheques propios: `entregado`
(`cambiar_estado_cheque`) inserta 'pago' en `cuenta_corriente_proveedores` + imputación contra
`compra_id` si vino con una.

**(B) Rechazo** reabre la deuda: fila DEBE (tercero) / 'nota_debito' (propio) de reversión, que
queda en el historial para siempre. La imputación puntual se **borra** (no se puede insertar una
fila negativa — `cuenta_corriente_imputaciones`/`_proveedores_imputaciones` exigen `monto > 0` vía
CHECK constraint, confirmado en vivo) — se borra solo el vínculo "a qué factura se aplicó", nunca
el movimiento financiero en sí.

**(C) Cobrar/depositar** genera el movimiento en `movimientos_bancarios` (antes esa tabla no
tenía siquiera `origen='cheque'` como valor permitido — se extendió el CHECK), linkeado al MISMO
`asiento_id` que ya crea el trigger de GL para no duplicar el asiento — por eso esta parte vive en
los triggers `fn_asiento_cheque_tercero`/`fn_asiento_cheque_propio` (tienen `v_asiento_id` en scope
en el momento exacto), mientras que A/B viven en las RPCs. Cheques de tercero no traían
`cuenta_bancaria_id` (solo los propios, desde su creación) — se agregó un selector en
`ModalCambioEstado.jsx` que solo aparece al mover un cheque de tercero a 'cobrado'.

**Fuera de alcance** (documentado, no pedido): 'endosado' no cancela la compra puntual del
proveedor endosado (la UI no captura qué compra se paga en el momento del endoso) — 'descontado'
tampoco tiene modelo contable propio (no lo tenía antes tampoco).

Validado con `BEGIN...ROLLBACK` contra datos reales de Nalux (cliente Tuku + factura real, proveedor
Alibaba + compra real, cuenta bancaria BBVA real): 6 casos — cobro con imputación y su rechazo
(neto 0, imputación borrada), pago propio con imputación y su rechazo (neto 0), cobro de tercero con
depósito en Bancos (ingreso, mismo asiento), pago propio cobrado por el banco (egreso, mismo
asiento) — los 6 pasaron. Build de producción sin errores, verificado en preview sin regresiones.

## ✅ Dropdowns cross-módulo — cierre definitivo (mig.185, 2026-07-09)

Pendiente documentado desde la Fase 2 SELECT (mig.134, sesión 46): gatear el SELECT de 17 tablas
exclusivas con `has_module_permission` podía romper dropdowns/paneles en pantallas de OTRO módulo
que legítimamente necesitan leer esos datos. Mig.135 (misma sesión 46) ya había cerrado 2 casos
(`proveedores`, `plan_cuentas`) con RPCs `listar_*_min`. Quedaba sin auditar el resto.

Se revisaron las 15 tablas restantes con `grep` de cada `.from('<tabla>')` en todo `src/` +
verificación manual de qué permiso gatea la pantalla que hace cada llamada. Resultado: **solo 2
lectores cross-módulo reales**, el resto (`compras`/`detalle_compras`/`ordenes_compra_items`,
`cotizacion_items`, `ofertas`, `extractos_bancarios`/`extracto_lineas`,
`metodo_pago_cuenta_bancaria`, `cheques`/`cheques_historial`, `asientos_items`,
`alicuotas_impuestos`, `retenciones`) se leen solo desde pantallas de su propio módulo, o ya estaban
correctamente gateadas client-side con `hasPermission()` antes de la query (`useNotifications.js`).

Los 2 reales, ambos en features **globales** (visibles a cualquier rol, sin pantalla "dueña" que
ya exija el permiso):
- **`CommandPalette.jsx`** (⌘K) — buscaba directo en `cotizaciones` (gateada a `has_module_permission('ventas')`,
  mig.134); un staff sin ese permiso no veía resultados de cotizaciones en la búsqueda global.
- **`dashboardService.ts`** (Dashboard, visible a todos) — `getKPIs()` contaba `ordenes_compra`
  activas para el KPI "OC Pendientes" (gateada a `compras`); `getCotizacionesStats()` leía
  `cotizaciones` completas para el widget del mes. Ambos quedaban en 0/vacío silenciosamente para
  un staff sin el permiso correspondiente — un número de negocio incorrecto, no solo un dropdown
  vacío.

**Fix (mig.185):** 2 RPCs `SECURITY DEFINER` nuevas, mismo criterio que mig.135 (tenant-scoped, sin
gate de módulo):
- `contar_ordenes_compra_activas()` — devuelve solo un conteo, cero superficie expuesta.
- `listar_cotizaciones_min()` — expone id/numero/cliente/total/estado; mismo nivel de sensibilidad
  que `comprobantes` (facturas de venta), que YA es de lectura tenant-only sin gate de módulo por
  diseño explícito del propio mig.134 ("insumo de reportes cross-módulo") — no se introduce
  superficie nueva.

Validado con `BEGIN...ROLLBACK`: conteos reales de Nalux coinciden con el query directo sin RLS (3
OC activas, 18 cotizaciones); un admin de otra empresa ve solo lo suyo (aislamiento tenant intacto).
Aplicado a producción y verificado en preview: el Dashboard real de Nalux muestra "OC Pendientes: 3"
(coincide exacto), ambas RPCs responden 200 en Network. `dashboardService.ts` y
`CommandPalette.jsx` actualizados para usar las RPCs en vez de la tabla directa.

## ✅ Roadmap SAP — Conversión general entre unidades de medida (mig.188, 2026-07-10, sesión 59)

Segundo ítem del roadmap SAP ("grupo de unidades de medida" / dimensión ISO), a pedido del usuario
que detectó — con razón — que `unidades_medida` era una lista plana sin relación entre filas y que
el factor de mig.186 era otra cosa (empaque por producto, no conversión física fija). Ahora conviven
los 2 conceptos sin pisarse (detalle completo en CONTEXT.md, sesión 59):

- **mig.188 (aditiva):** `unidades_medida.magnitud` (masa/volumen/longitud/cantidad, o NULL) +
  `factor_base` (cuántas unidades base representa; base lleva 1). CHECK de coherencia (van juntas o
  ambas NULL). `seed_maestros_default` actualizado (conserva guard mig.057) + TN/MG/MM/KM al estándar
  + backfill por código de las 11 unidades preexistentes. Validada en dry-run BEGIN...ROLLBACK contra
  datos reales antes de aplicar; aplicada a prod con confirmación explícita del usuario.
- **Frontend:** helpers en `unidadesMedida.js`; Configuración → Inventario muestra magnitud +
  conversión por unidad, modal con preview en vivo; `ProductForm.jsx` autocompleta
  `factor_conversion_compra` (mig.186) cuando stock y compra comparten magnitud.
- **Verificado en preview real (Nalux):** 15 unidades con conversiones correctas; autocompletado
  Batidora DOC→12 (mismo magnitud) y KG→sin autocompletar (distinta magnitud). Sin errores. Build OK.

## ✅ Roadmap SAP — Factor de conversión de unidad de compra (mig.186, 2026-07-09)

Primer ítem del roadmap SAP (sap-reference: "unidad de medida de compra vs. inventario, con factor
de conversión") con evidencia real de necesidad: Nalux ya tenía cargadas en el maestro de unidades
(mig.043) "Caja", "Docena", "Paquete" — sin ningún factor que las conectara al stock, no servían
para nada funcional. Se descartaron los otros 3 ítems del roadmap (FIFO, almacenes múltiples,
series por sucursal) por ser cambios mucho más invasivos sin evidencia de necesidad real hoy.

**Alcance (confirmado con el usuario):** solo unidad de compra opcional + factor de conversión.
La venta sigue siendo en la unidad base — no se agregó una 3ª "unidad de venta" separada.

**Alcance real vs. lo propuesto inicialmente:** al investigar se confirmó que
`NuevaFacturaProveedorModal.jsx` ("Factura de Proveedor") es puramente financiero — el propio
banner de la UI dice "no modifica el inventario, usá OC → Recepción" — no llama a
`aplicar_compra_producto` ni mueve stock. La conversión de unidades solo tiene sentido donde el
stock realmente se mueve: **Compra Rápida** (implementado) y, como paso natural siguiente,
**OC → Recepción** (`fn_oc_update_stock`, mismo esquema reutilizable, no implementado en esta
pasada — el usuario aprobó el alcance mencionando "compra/OC" pero se acotó a Compra Rápida por
tiempo; queda documentado como próximo paso, no como bug).

**Cierre (sesión 58, 2026-07-10):** conversor extendido a `GenerarMovimientoModal.jsx` (rama
`recepcion`), validado en preview con una OC de prueba temporal (creada y borrada en la misma
sesión) — ver detalle en CONTEXT.md.

**Implementación:**
- `productos.unidad_compra_id` (FK a `unidades_medida`, nullable) + `factor_conversion_compra`
  (numeric, default 1, `CHECK > 0`) — mig.186, aditiva pura.
- `ProductForm.jsx`: selector "Unidad de Compra (opcional)" + input "Factor de conversión"
  (solo visible si se eligió una unidad de compra).
- `CompraRapidaSection.jsx`/`TabNuevaCompra.jsx`: cada línea del carrito, si el producto tiene
  unidad de compra configurada, muestra un mini-conversor "o en Caja (x12): [cant] × [$/u] [↧]"
  que precarga `cantidad`/`costo_unitario` (los mismos campos de siempre, en unidad de stock) —
  cero cambios en `aplicar_compra_producto` ni en el submit; el conversor es solo una calculadora
  que llena los campos existentes.

Validado en preview con datos reales de Nalux: producto "Batidora Eléctrica" configurado con
Unidad de Compra = Caja, factor = 12 → cargar "2 Cajas × $600" convirtió correctamente a
Cantidad=24, Costo Unit.=$50, Subtotal=$1.200,00 (matemática exacta). No se registró la compra
real (se descartó el formulario) para no crear un movimiento de stock/plata sin pedido explícito.

## 🔍 Auditoría de cierre pre-lanzamiento — sesión 59 cont. (2026-07-11, madrugada)

**Alcance pedido por el usuario:** "auditá todo lo que nos queda, del sistema — a saber también
empieza una auditoría de la visual, indicadores y reportería". Instrucción explícita: **solo
auditar, no corregir nada** — el usuario se fue a dormir y pidió el informe para retomar mañana
"punto por punto". Todo lo de abajo es SOLO diagnóstico, nada de esto se aplicó a producción.

### 🔴 CRÍTICO — Seguridad backend

**1. `reintentar_cae_comprobante` — bypass de tenant real, confirmado por análisis de código
(NO ejecutado en vivo por seguridad — ver nota).**
La función usa `IF v_empresa_id IS NULL OR v_empresa_id <> get_my_empresa_id() THEN RAISE EXCEPTION`.
`get_my_empresa_id()` devuelve NULL para un caller sin sesión (anónimo). Cuando `v_empresa_id` es
un UUID real (el comprobante existe, de CUALQUIER empresa) y `get_my_empresa_id()` es NULL, la
comparación `<>` da NULL (no TRUE/FALSE) — y `IF NULL THEN` en PL/pgSQL se trata como **FALSE**
(comportamiento documentado de Postgres, no una suposición). El guard NO dispara la excepción y la
función sigue de largo: reencola el comprobante para reintento de CAE y resetea
`cae_estado`/`error_afip` — **de cualquier empresa, sin ninguna autenticación**.
Agravante: la función está `GRANT`eada a `anon` (confirmado con `information_schema.routine_privileges`),
o sea que cualquiera con la anon key pública (la que ya viaja en el bundle del cliente, es normal
que sea pública) puede invocar `/rest/v1/rpc/reintentar_cae_comprobante` sin loguearse.
**Por qué no lo probé en vivo:** el sistema de seguridad de la sesión bloqueó correctamente el
intento — esta función dispara un reencolado real que el `arca-worker` (cron cada 5 min) puede
recoger y llamar a AFIP de verdad, un efecto de lado real que un `ROLLBACK` de SQL no revierte.
Quedó confirmado por lectura de código (semántica de Postgres bien documentada), no por ejecución.
**Mismo patrón exacto en `reencolar_caes_pendientes`** (mismo `<>` en vez de `IS DISTINCT FROM`),
pero esta NO está otorgada a `anon` (solo `authenticated`) — su exposición real es mucho menor
(requeriría un usuario logueado con perfil huérfano/`empresa_id` NULL, un caso de borde raro).
**Fix (para mañana, no aplicado):** cambiar ambos `<>` por `IS DISTINCT FROM` — mismo patrón que
ya usan `crear_venta`, `registrar_pago_proveedor`, `cambiar_estado_cheque` y el resto (confirmado
que esos SÍ están bien). Es el mismo 1-línea-por-función que ya se usó en todo el resto del sistema.

**2. Patrón sistémico — 13 RPCs `SECURITY DEFINER` ejecutables por `anon` (sin loguearse) por un
error de un paso, no por diseño.**
Confirmado con `information_schema.routine_privileges`: `crear_venta`, `registrar_pago_proveedor`,
`cambiar_estado_cheque`, `regenerar_asiento_cxc/cxp`, `listar_cotizaciones_min`,
`listar_plan_cuentas_min`, `listar_proveedores_min`, `contar_ordenes_compra_activas`,
`reintentar_cae_comprobante`, `email_exists_in_system`, `get_my_empresa_id`,
`has_module_permission` siguen siendo ejecutables por `anon` **a pesar de** que sus migraciones
(mig.135/184/185, etc.) escriben explícitamente `REVOKE ALL ... FROM PUBLIC`.
**Causa raíz encontrada:** Supabase otorga `GRANT EXECUTE` a `anon`/`authenticated` de forma
DIRECTA (no vía el pseudo-rol `PUBLIC`) en el momento de crear cualquier función nueva en
`public` (default privileges de la instancia). `REVOKE ALL ... FROM PUBLIC` no toca ese grant
directo a `anon` — hay que revocarlo explícitamente: `REVOKE EXECUTE ... FROM PUBLIC, anon;`.
Todas las migraciones de este proyecto (incluida mig.185, escrita por mí esta sesión) tienen este
mismo defecto de un paso.
**Severidad real HOY, verificada en vivo (`BEGIN...ROLLBACK`, rol `anon`, sin ningún JWT):**
- `crear_venta`, `registrar_pago_proveedor`, `cambiar_estado_cheque`: **bloqueadas correctamente**
  (usan `IS DISTINCT FROM`, NULL-safe — anon no tiene forma de pasar el guard).
- `listar_cotizaciones_min`, `listar_plan_cuentas_min`, `listar_proveedores_min`,
  `contar_ordenes_compra_activas`: devuelven **0 filas / 0** para anon (dependen de
  `get_my_empresa_id()`, que es NULL → no matchea nada). Sin fuga de datos.
- `email_exists_in_system`: SÍ es explotable como estaba (consulta `auth.users` directo) — pero
  es candidato a ser **intencional** (patrón común: validar en el signup si un email ya existe).
  Falta confirmar en qué pantalla se llama y si de verdad se necesita antes de loguearse.
- `reintentar_cae_comprobante`: el ÚNICO de los 13 con el bug real (ver hallazgo #1 arriba).
**Conclusión:** hoy el riesgo práctico es bajo (todo lo demás bloquea solo), pero es un patrón
frágil — cualquier función nueva que use `<>` en vez de `IS DISTINCT FROM` (como pasó con CAE)
queda inmediatamente explotable sin loguearse. **Fix sugerido para mañana:** agregar
`REVOKE EXECUTE ... FROM PUBLIC, anon;` explícito a las 13, y agregar el checklist "¿usé
`IS DISTINCT FROM` y no `<>`, `=` o `!=` contra `get_my_empresa_id()`?" al checklist pre-commit.

### 🟡 Hallazgos menores de seguridad (bajo impacto, para limpiar cuando haya tiempo)
- `seed_plan_cuentas` y `trg_fn_bloquear_delete_mov_contabilizado`: sin `SET search_path`
  (hardening estándar que el resto de las funciones sí tiene desde hace varias sesiones).
- Extensión `pg_net` instalada en el schema `public` (debería ir en un schema propio) — warning
  estándar de Supabase, bajo riesgo real, requiere migrar la extensión con cuidado (puede romper
  los crons que la usan si no se hace bien).
- Auth de Supabase: falta activar "Leaked Password Protection" (checkbox en el dashboard de
  Supabase, no es código) — chequea contraseñas contra HaveIBeenPwned al registrarse.
- RLS: cobertura sólida en TODA la base — ninguna tabla sin política aparte de `afip_tickets`
  (deny-all intencional, ya confirmado en sesiones anteriores).

### 🔴 Indicadores del Dashboard — 2 hallazgos confirmados con datos reales de Nalux

**1. "Margen Bruto" no es margen bruto real — confirmado en vivo: 92,1% mostrado ahora mismo.**
`dashboardService.getKPIs`: `margenBruto = (ventasMes − gastosMes) / ventasMes × 100`, donde
`gastosMes` es TODO egreso de `movimientos_caja` del mes (cualquier categoría), no el costo de
mercadería vendida (COGS). Como el sistema **todavía no postea COGS a ningún asiento** (gap ya
documentado en el informe del contador, sesión 57), este número está estructuralmente inflado —
un 92% de margen bruto es una fantasía para cualquier comercio con costo de mercadería real. Mismo
síntoma que ya había señalado el documento del contador como evidencia corroborante; ahora
confirmado con el número exacto en pantalla. **No es un bug de cálculo — es una etiqueta engañosa**
("Margen Bruto" debería decir algo como "Margen de Caja del Mes" hasta que exista COGS real, o
recién ahí sí llamarse margen bruto).

**2. "Ventas del mes" mezcla categorías — inconsistente con "Ventas Hoy"/"Ventas Ayer" en el mismo
card.** `ventasHoy`/`ventasAyer` filtran `movimientos_caja` por `categoria = 'Venta'`. `ventasMes`
NO tiene ese filtro — suma TODO `tipo='ingreso'` del mes (cobros de CC, transferencias reconciliadas,
cualquier ingreso de caja), no solo ventas. El número "Ventas del mes" que ve el usuario está
sobreestimado respecto de lo que en realidad mide "ventas". Fix: agregar el mismo
`.eq('categoria', 'Venta')` que ya usan sus vecinos en la misma función.

### 🟡 Otros hallazgos de indicadores (menor severidad)
- **Top Clientes agrupa por `cliente_nombre` (texto), no por `cliente_id`.** Si dos clientes
  distintos comparten nombre, o un cliente cambia de nombre, el ranking se rompe silenciosamente
  (mezcla o separa mal). Debería agrupar por `cliente_id` y resolver el nombre para mostrar.
- **DSO / aging de cobranzas usa la fecha del movimiento DEBE más viejo de cada cliente**, sin
  considerar que ese movimiento puede haber sido cancelado parcial o totalmente vía Open Item
  clearing (`cuenta_corriente_imputaciones`, ya implementado). Un cliente con su factura más vieja
  ya cobrada pero una más nueva pendiente puede aparecer con una antigüedad de deuda incorrecta
  (mostrando el vencimiento de la factura vieja ya saldada, no de la que realmente debe). Requiere
  cruzar contra imputaciones para calcular antigüedad real por comprobante, no por cliente.
- DSO general (`deuda total / facturación del mes × 30`) es una aproximación estándar pero cruda
  (mezcla un stock acumulado histórico contra un flujo mensual) — aceptable como proxy, marcar
  como tal si se quiere mayor precisión a futuro.

### 🔴 Reportería — 1 hallazgo mayor, confirmado con datos reales de Nalux

**"Reporte de Ventas" y "Reporte de Paridad" cuentan Notas de Crédito como si fueran ventas.**
Ambos (`ReportesSection.jsx` para "ventas" genérico, y `ReporteParidad.jsx`) hacen
`.from('comprobantes').select(...).eq('empresa_id',...)` **sin filtrar `tipo`**. La tabla
`comprobantes` reales de Nalux tiene 128 filas `tipo='venta'` ($7.836.070,80) y 15 filas
`tipo='nota_credito'` ($1.132.094,52, guardado en positivo). Sin el filtro, ambos reportes suman
las NC como ventas adicionales — **sobreestimando el total de ventas ~14% con los datos reales
actuales**. El patrón correcto YA EXISTE en el sistema: `ReporteLibroIVA.jsx` (corregido en sesión
46) sí filtra `tipo = 'venta'` correctamente — solo faltó aplicar el mismo filtro acá. Fix: agregar
`.eq('tipo', 'venta')` a ambas queries.
**Catálogo de reportes** (`reportDefinitions.jsx`): 6 reportes cubiertos (Ventas, Compras, Cartera
Clientes, Cta. Corriente, Financiero, MercadoPago). Huecos razonables para el roadmap: no hay
Libro IVA Compras/Ventas en este listado genérico (viven aparte, `ReporteLibroIVA(Compras).jsx`,
ya auditados antes), no hay reporte de Cheques, no hay reporte de Stock/Inventario valorizado.

### 🟢 Auditoría visual — sin hallazgos de peso (verificación limitada)
No pude tomar screenshots en esta sesión (timeout persistente de la herramienta de captura, sin
relación con la app — `get_page_text`/JS funcionan bien, sin errores de consola). Verificación por
código en su lugar:
- Dark mode: barrido de `bg-white`/`text-black` hardcodeados sin variante `dark:` — sin hallazgos
  reales (los 2 casos de `bg-white/N` son overlays semitransparentes intencionales; los `text-black`
  encontrados son sobre fondo fijo `#00D4FF`, contraste correcto en cualquier tema).
- RLS/theming consistente con el sistema de tokens `kx-*` en todo lo revisado.
- Responsive: el carrito de ambos POS (`nueva-venta/PanelCarrito.jsx`, `caja/PanelCarrito.jsx`) no
  tiene breakpoints `sm:/md:/lg:` — parece deliberado (flujo de POS pensado para desktop), pero
  vale la pena confirmarlo si se espera uso desde tablet/mobile en el local.
**Pendiente real:** repetir esta parte con capturas reales (probar la herramienta de nuevo mañana,
o pedir capturas manuales) antes de dar la parte visual por cerrada — lo de arriba es un chequeo
parcial por código, no una revisión visual completa.

### ✅ Actualización — fixes preparados y probados (misma madrugada, post-informe)
El usuario pidió seguir sin parar y corregir todo lo que estuviera al alcance, probando lo
necesario. Estado real al momento de dormir:

- **mig.191** (fix `<>`→`IS DISTINCT FROM` en `reintentar_cae_comprobante` +
  `reencolar_caes_pendientes`) y **mig.192** (`REVOKE EXECUTE ... FROM anon` explícito en 12 RPCs,
  `email_exists_in_system` queda afuera a propósito — confirmado su uso legítimo pre-login en
  `validationUtils.js`): **escritas y validadas con `BEGIN...ROLLBACK` contra producción**
  (anon bloqueado, admin real sigue funcionando igual, cross-tenant sigue bloqueado) pero **NO
  aplicadas** — el sistema de permisos de la sesión bloqueó el apply autónomo a prod (requiere
  confirmación explícita por cada migración, ese límite se mantuvo pese al "no te detengas").
  Quedan en `supabase/migrations/191_...sql` y `192_...sql`, listas para aplicar con tu OK.
- **Los 2 reportes** (`ReportesSection.jsx` "Ventas", `ReporteParidad.jsx`): agregado
  `.eq('tipo','venta')`. Verificado en preview real: "Reporte de Ventas" ahora totaliza
  $7.836.070,80 / 128 registros — exacto a la suma pura de ventas por SQL, ya no incluye las NC.
- **`dashboardService.ts`**: `ventasMes` ahora filtra `categoria='Venta'` (antes: $744.390,8 →
  ahora: $663.058,8, ya no cuenta cobros de CC ni otros ingresos de caja como venta).
  `getTopClientes` ahora agrupa por `cliente_id` (no por nombre) y también filtra `tipo='venta'` —
  mismo hallazgo de NC aplicaba acá (Luciano bajó de $159.120/2 a $72.000/1, tenía una NC
  contándose de más). `getAlertasCC`/antigüedad de cobranzas ahora cruza contra
  `cuenta_corriente_imputaciones` para tomar la fecha de la factura más vieja **todavía abierta**
  (no cancelada por Open Item clearing), en vez de la fecha del DEBE más viejo sin más.
- **"Margen Bruto" del Dashboard**: relabeleado a "Margen de caja (mes)" + subtítulo honesto
  ("Ingresos vs. egresos de caja del mes"), sin el badge falso "Saludable" (el umbral 30% aplicaba
  a margen bruto contable real, no a esto). No se tocó el cálculo — sigue siendo el mismo número,
  solo ya no miente sobre qué es. La decisión de fondo (¿implementar COGS real?) sigue pendiente
  con el contador, como estaba documentado.
- Verificado en preview: Dashboard recargado, números y labels correctos, sin errores de consola.
  `npx vite build` exit 0 después de cada tanda de cambios.
- **NO se hizo commit/push/deploy** de estos cambios de frontend — quedaron como cambios locales
  sin commitear (`git status` los muestra), a la espera de que los revises antes de subirlos,
  mismo criterio que las 2 migraciones.

- **mig.193** (hardening menor): agregado `SET search_path TO 'public'` a `seed_plan_cuentas` y
  `trg_fn_bloquear_delete_mov_contabilizado` — las 2 únicas funciones sin esa protección (ambas son
  `SECURITY INVOKER`, no `DEFINER`, así que el riesgo real siempre fue bajo). Copia fiel de
  `pg_get_functiondef` + solo el `SET search_path` agregado, cero cambio de lógica. Validado en
  `BEGIN...ROLLBACK` (el CREATE OR REPLACE no rompe el trigger existente, comportamiento estándar
  de Postgres). **NO aplicada** — mismo motivo que 191/192.
- `pg_net` en schema `public` y "Leaked Password Protection" de Supabase Auth: **no se tocaron a
  propósito** — mover una extensión con crons dependientes requiere más cuidado del que da una
  madrugada sin poder confirmar con el usuario, y el toggle de Auth es un ajuste del dashboard de
  Supabase, no hay código que tocar.

### ✅ CERRADO — aplicado y verificado (2026-07-11, mañana, sesión 60)
El usuario revisó el diff completo y confirmó explícitamente aplicar las 3 migraciones a producción.
Estado final:
1. ✅ **mig.191 aplicada** a prod (`{success:true}`). Verificado post-apply: ambos guards
   (`reintentar_cae_comprobante`, `reencolar_caes_pendientes`) ahora usan `IS DISTINCT FROM
   get_my_empresa_id`, ya no queda ningún `<> get_my_empresa_id`.
2. ⚠️→✅ **mig.192 aplicada pero INEFECTIVA; corregida por mig.194.** La 192 revocó `FROM anon`,
   pero el acceso de anon a 7 de esas RPCs venía de `PUBLIC=EXECUTE` (heredado), no de un grant
   directo a anon. Revocar `FROM anon` fue un no-op. La verificación inicial (`grantee='anon'` en
   `routine_privileges` → vacío) dio un **falso verde** porque el grant real está bajo
   `grantee='PUBLIC'`. Detectado con el advisor `anon_security_definer_function_executable` (seguía
   listando 7 funciones) + `has_function_privilege('anon', oid, 'EXECUTE')=true` post-192.
   **mig.194 aplicada** (`{success:true}`): `REVOKE EXECUTE ... FROM PUBLIC` en las 7
   (crear_venta, cambiar_estado_cheque, regenerar_asiento_cxc/cxp, registrar_pago_proveedor,
   reintentar_cae_comprobante, has_module_permission). Verificado con `has_function_privilege`:
   las 7 quedaron `anon=false / authenticated=true`; `email_exists_in_system` sigue `anon=true`
   (signup pre-login intacto). NOTA: no hubo exploit activo — los guards internos de las 7 ya
   bloqueaban a anon a nivel lógico (mig.191 + `IS DISTINCT FROM`/`IS NULL`); esto es defensa en
   profundidad hecha bien.
3. ✅ **mig.193 aplicada** a prod (`{success:true}`). `search_path` agregado a las 2 funciones.
4. ✅ **Frontend commiteado + pusheado + deployado**: los 2 reportes (`.eq('tipo','venta')`),
   `dashboardService.ts` (ventasMes/getTopClientes/getAlertasCC) y `HeroRow.jsx` (relabel margen).
   `npx vite build` exit 0.
5. ✅ **mig.195 aplicada** a prod (`{success:true}`): `REVOKE ALL ON afip_tickets FROM anon,
   authenticated` (defensa en profundidad sobre la caché de tokens WSAA de AFIP). Verificado con
   `has_table_privilege`: anon/authenticated → `false`; service_role/postgres → `true` (edge
   functions intactas). El RLS deny-all de mig.099 sigue activo — esto es la 2da barrera.

### ✅ Los 3 pendientes de advisor — resueltos/decididos (sesión 60)
1. 🟢 **`pg_net` en schema public → NO se mueve (riesgo aceptado, decisión del usuario).** Las
   funciones (`http_post`, etc.) YA están en el schema `net`, no en `public` — verificado con
   `pg_proc`/`pg_namespace`. Lo único en `public` es el marcador de registro de la extensión, sin
   impacto en `search_path` ni exposición de funciones. Mover con `ALTER EXTENSION pg_net SET SCHEMA`
   es riesgoso (pg_net hardcodea el schema `net`) y hay 2 crons críticos que llaman `net.http_post`:
   jobid 1 `arca-worker` (*/5min, emisión CAE) y jobid 3 `mp-sync` (*/2min, MercadoPago). Beneficio
   de seguridad real = nulo; riesgo = alto. El advisor `extension_in_public` queda como
   false-positive justificado.
2. 🟡 **"Leaked Password Protection" → acción del usuario (dashboard, no código).** Toggle en
   Supabase → Authentication → activar "Leaked password protection" (chequeo HaveIBeenPwned) + subir
   "Minimum password length" a 8+. No lo puede hacer Claude (setting de seguridad de cuenta).
3. ✅ **`afip_tickets` RLS sin policy → NO era bug (deny-all intencional, mig.099) + endurecido
   (mig.195).** El advisor INFO era false-positive respecto de la intención documentada.

## 🔍 Revisión punto por punto pre-lanzamiento (sesión 60)
Recorrido módulo por módulo en el navegador (Nalux real) para pulir antes de lanzar.

### Dashboard — hallazgos y fixes
1. ✅ **Bug: "Facturas del mes" / ticket promedio / DSO contaban Notas de Crédito.** La query de
   `comprobantes` en `getKPIs` no filtraba `tipo='venta'` (mismo bug que ya se había corregido en los
   reportes, pero se había pasado por alto acá). Con datos reales de Nalux: mostraba 27 comprobantes
   / $807k, cuando las ventas reales del mes son 22 / $709.070,80 (5 NC de $98k se contaban como
   facturado). Fix: `.eq('tipo','venta')`. Verificado en vivo: 27→22, $807k→$709k, ticket $30k→$32k,
   DSO 13→15 días. La NC no es una factura de venta.
2. ✅ **Bug de etiqueta: "Ventas del mes" mostraba variación diaria ("vs ayer").** El card de total
   mensual usaba `variacionVentas` (hoy vs ayer) — un mes comparado contra ayer no cierra. Fix: nueva
   `variacionMes` (month-to-date vs mismo período del mes anterior), label "vs mes anterior". El card
   "Ventas del día" mantiene la variación diaria (correcta). Verificado en vivo.
3. 🟢 **Aclaración (no bug): "Ventas del mes" (base caja/cobrado) vs "Facturas del mes"
   (facturado/devengado).** Tras el fix #1 la brecha bajó a las ventas a CC del mes aún no
   cobradas. Es la diferencia legítima caja-vs-devengado, no un error.
4. ✅ **Card "Margen de caja" reemplazado por "Contado (mes)"** = ventas al contado / total facturado
   del mes. El viejo "margen bruto" era engañoso sin COGS. El nuevo mide cuánto se cobra en el acto
   vs cuánto queda en CC. Verificado en vivo.

### Reportes — hallazgos y fixes
1. ✅ **Bug fiscal (AFIP): el Libro IVA Ventas SUMABA las Notas de Crédito en vez de restarlas.**
   `ivaDeComprobante`/`netoDeComprobante` no aplicaban signo según `tipo`, y la query ni traía la
   columna `tipo` (solo `tipo_comprobante_afip`, la letra A/B/C). Como las NC se guardan con montos
   positivos, el IVA débito y el neto gravado quedaban sobreestimados (por 2× el IVA de cada NC).
   Confirmado con datos reales de Nalux (NC emitidas en el mes). Fix: helper `signoComprobante`
   (NC = −1), aplicado a IVA/neto/bruto en totales, filas y CSV; se trae `tipo` en el SELECT; las NC
   se muestran en negativo y con badge rojo "NC-x" en vez de "F-x". Baseline SQL del mes: IVA débito
   neteado correcto vs el viejo (diferencia = 2× IVA de las NC). Build exit 0. Verificación en vivo
   del render limitada por la flakeidad del browser de la sesión (nav/captura), pero lógica + build +
   baseline SQL confirman el neteo.
2. ✅ **ReporteParidad y Reporte de Ventas**: ya tenían el `.eq('tipo','venta')` de la sesión 59.
3. ✅ **ReporteLibroIVACompras**: usa tabla `compras` (separada), sin NC de venta — sin cambios.

### Cheques → Bancos: gap YA RESUELTO (no era pendiente real)
El circuito completo (cobrar/depositar cheque → movimiento en Bancos, con el mismo asiento; rechazo
de cheque de tercero → reabre la deuda del cliente; rechazo de cheque propio → reabre la deuda al
proveedor; endoso; cuentas puente 1.1.6/1.1.7/2.1.6) **ya está implementado** vía triggers
`fn_asiento_cheque_tercero` / `fn_asiento_cheque_propio` + la RPC `cambiar_estado_cheque`. Confirmado
leyendo las definiciones vivas. No es un pendiente de sesiones anteriores — ya se resolvió en algún
punto no capturado en el resumen previo. 🟢 Nota menor no bloqueante: los triggers atrapan todo error
interno (`EXCEPTION WHEN OTHERS THEN NULL`) sin dejar ninguna señal visible al usuario si, por ejemplo,
faltara una cuenta del plan (ej. `1.1.6`) — mismo patrón "asiento no bloqueante" ya documentado en
otras partes del sistema. Bajo riesgo (solo se manifiesta con un plan de cuentas incompleto).

### 🔴 CRÍTICO — hallazgo real y CONFIRMADO (validado, NO aplicado): estado_pago nunca se sincroniza
al cobrar/pagar una factura a cuenta corriente
**El bug:** `registrar_cobro_cliente` y `registrar_pago_proveedor` insertan en
`cuenta_corriente_imputaciones` / `cuenta_corriente_proveedores_imputaciones` (el registro real de
qué se pagó) pero **nunca** actualizan `comprobantes.estado_pago` / `compras.estado_pago`. Confirmado
por inspección: ninguna de las 2 funciones menciona `estado_pago`; solo `crear_venta`,
`crear_nota_credito`, `crear_devolucion` la tocan (al crear el documento, nunca al cobrarlo/pagarlo).
Ningún trigger en `cuenta_corriente_imputaciones` la sincroniza tampoco.

**Impacto real:** una factura de venta a cuenta corriente (`estado_pago='pendiente'`) que se cobra
100% vía Open Item clearing se queda con `estado_pago='pendiente'` **para siempre**, aunque el saldo
real (por imputaciones) sea $0. `ClientDetailModal.jsx` usa exactamente ese campo para el badge
"Vencido" (`estado_pago==='pendiente' AND fecha_vencimiento < hoy`) — una factura ya cobrada por
completo seguiría mostrando "Vencido" indefinidamente. Hay 21 archivos del frontend que leen
`estado_pago` (SaleDetailModal, HistorialVentas, CuentaCorrienteSection, reportes, etc.) con el mismo
riesgo. Bug simétrico confirmado también en `compras.estado_pago` / `registrar_pago_proveedor`.

**Fix (mig.196, escrita y VALIDADA, no aplicada):** dentro del loop de imputaciones de cada función,
justo después del INSERT de la imputación (mismo `FOR UPDATE` ya tomado, sin queries extra), un
`UPDATE` que recalcula `estado_pago` = `'pagada'` si `v_ya_imputado + v_monto_imp >= total`,
`'parcial'` si cubre algo, `'pendiente'` si nada. Los 3 valores están permitidos por los CHECK
constraints existentes en ambas tablas (confirmado). Copia fiel del resto de cada función.

**Validado con `BEGIN...ROLLBACK`** (impersonando a Nadia vía `request.jwt.claim.sub`, con datos de
prueba `TEST QA mig196` creados y revertidos dentro de la misma transacción — nada quedó persistido):
- Cobro total sobre factura CC → `estado_pago` pasó a `'pagada'` ✓
- Cobro parcial sobre otra factura CC → `estado_pago` pasó a `'parcial'` ✓
- Pago total sobre una compra CC (lado proveedor) → `estado_pago` pasó a `'pagada'` ✓

**✅ APLICADA a producción** (sesión 60 cont., con confirmación explícita del usuario). Verificado
post-apply: ambas funciones vivas contienen el `UPDATE ... estado_pago` nuevo. Se revisó además si
había datos históricos ya corrompidos por el bug (facturas con saldo imputado ≥ total pero
`estado_pago` todavía `pendiente`/`parcial`) en **todos los tenants**, no solo Nalux — cero casos en
`comprobantes` y cero en `compras`. No hizo falta backfill; el fix es puramente hacia adelante.
Archivo: `supabase/migrations/196_sync_estado_pago_en_imputaciones.sql`.

### ✅ CONFIRMADO Y RESUELTO: crear_nota_credito no imputaba contra la factura de origen
La nota quedó resuelta esta misma sesión: se investigó y **sí era un bug real**, confirmado con datos
de producción (no solo teórico). `crear_nota_credito` inserta un HABER en
`cuenta_corriente_movimientos` (reduce el saldo agregado del cliente) pero nunca insertaba en
`cuenta_corriente_imputaciones` contra `comprobante_origen_id`. Confirmado con varias facturas reales
con NC en contra: todas mostraban `saldo_pendiente = total original`, como si la NC nunca hubiera
pasado. Caso más grave: una factura a cuenta corriente (`estado_pago='pendiente'`) con una NC **mayor
que la factura** ya emitida en su contra — el sistema seguía pidiendo cobrar el total completo a un
cliente que en realidad no debía nada (montos exactos omitidos de este doc por ser un repo público).

**Fix (mig.197, aplicada a producción con confirmación explícita):** si la NC tiene
`comprobante_origen_id` y `cliente_id`, se imputa contra esa factura, topado al saldo pendiente real
(`LEAST(total_nc, GREATEST(saldo_pendiente, 0))` — nunca más de lo que la factura debe, nunca
negativo). Si la NC excede el saldo, el excedente no se imputa a esa factura puntual (ya está
reflejado en el saldo agregado vía el HABER existente). Se reutiliza el mismo movimiento HABER de la
NC como `cobro_movimiento_id`. `estado_pago` se sincroniza con el mismo patrón de mig.196. Validado
con `BEGIN...ROLLBACK`: NC menor al saldo → imputa el monto exacto, factura 'parcial'; NC MAYOR al
saldo (el caso real) → imputa exactamente el saldo pendiente (topado), factura 'pagada', sin violar
el CHECK `monto > 0`; NC sin `comprobante_origen_id` → no rompe nada.

**Backfill de las facturas reales ya afectadas:** ejecutado con confirmación explícita.
- **5 facturas** corregidas: se insertó la imputación retroactiva (usando el HABER que la NC ya había
  generado, sin crear movimientos nuevos) y se recalculó `estado_pago`. La factura del caso más grave
  pasó de `'pendiente'` (falso) a **`'pagada'`** (correcto) — el caso real que motivó todo el hallazgo.
  Dos quedaron en `'parcial'` (NC menor al total, saldo real pendiente) y dos en `'pagada'`.
- **3 facturas NO tocadas**: ventas sin `cliente_id` (walk-in/Consumidor Final) — correctamente
  excluidas, no existe tracking de Open Item sin cliente.
- **2 facturas NO tocadas — hallazgo inicial CORREGIDO tras investigar más**: 2 NC antiguas (numeración
  `NC-2026-000X`) tienen `cliente_id` seteado pero no tenían ningún movimiento en
  `cuenta_corriente_movimientos`. Se sospechó inicialmente que eran datos de prueba de sesiones
  anteriores. **Investigado y descartado**: ambas vinieron de `crear_devolucion` con
  `reembolso_efectivo=true` — cuando el reembolso es en efectivo, la función correctamente NO toca el
  ledger de cuenta corriente del cliente (el dinero ya volvió por caja, no por crédito a cuenta). No
  es un bug ni datos de prueba — es el comportamiento correcto. No requieren ninguna corrección.

### ✅ Mismo hallazgo, gap simétrico en crear_devolucion (mig.198)
`crear_devolucion` tiene su **propia copia inline** de la lógica de creación de NC (no llama a
`crear_nota_credito`) para el caso `p_compensacion='nota_credito'` — así que el fix de mig.197 no la
cubría. Mismo gap exacto: cuando el reembolso NO es en efectivo, inserta el HABER pero nunca imputaba
contra `p_comprobante_id`. **Fix (mig.198, aplicada a producción):** mismo patrón — imputación topada
al saldo pendiente + sincronización de `estado_pago`. Validado con `BEGIN...ROLLBACK`. Impacto real:
de 5 devoluciones históricas con NC, 4 son reembolso en efectivo (correctamente sin tocar) y la única
con reembolso NO efectivo ya había quedado cubierta por el backfill de mig.197 — **no hizo falta
backfill adicional**, el fix es puramente hacia adelante para futuras devoluciones.

### Ventas/POS — revisión rápida de la venta por pack (código nuevo de hoy)
Reviso `precioPackFinal`/`packPrecioFinal`/`updatePacks` (NuevaVentaModal + unidadesMedida.js) por ser
código recién escrito. Sin bugs: el CHECK constraint `productos_descuento_pack_pct_check` (0-100) y
`productos_precio_venta_pack_check` (>=0) ya protegen contra precio de pack negativo aunque el input
del formulario no valide el rango (mejora cosmética menor, no funcional, no se tocó). La matemática de
"N packs = N × precio del pack" en `updatePacks` es consistente (no duplica el descuento automático).

### 🔴 CONFIRMADO Y CORREGIDO: devolución a proveedor con NC nunca acreditaba su cuenta corriente
(hallazgo revisión punto por punto de **Compras**, sesión 60 cont. 2, 2026-07-11)

`crear_devolucion`, dentro de `p_compensacion = 'nota_credito'`, ejecutaba SIEMPRE la rama pensada
para clientes sin importar `p_tipo`: creaba un comprobante tipo='nota_credito' en la tabla de VENTAS
(cliente_id NULL → 'Consumidor Final', consumiendo la numeración de NC de ventas reales) y, si no
era reembolso en efectivo, insertaba el HABER en `cuenta_corriente_movimientos` (ledger de
**clientes**) con cliente_id NULL. Nunca tocaba `cuenta_corriente_proveedores` — la deuda real al
proveedor jamás bajaba, pese a que la UI le dice al usuario "La ND ajustará el saldo de Cuenta
Corriente del proveedor (recomendado)".

Confirmado con datos reales de Nalux: **5 devoluciones a proveedor con NC**, las 5 generaron el
comprobante-NC huérfano (sin impacto AFIP/Libro IVA — las 5 tienen `cae_estado='no_aplica'`,
confirmado). De esas 5, las **3 con reembolso en efectivo=false** (el camino recomendado) nunca
acreditaron `cuenta_corriente_proveedores` — 2 proveedores tenían un saldo a pagar sobreestimado en
$160.068 combinados.

**Fix (mig.199, aplicada a producción con confirmación explícita):** la rama de creación de
comprobante/CC-cliente queda gateada a `p_tipo='cliente'` (sin cambios ahí, ya corregido en mig.198).
Para proveedor, se acredita `cuenta_corriente_proveedores` directo (mismo patrón ya usado y validado
en `NuevaNCProveedorModal.jsx` — sin comprobante de venta, sin imputación contra una compra puntual,
porque la mayoría de compras reales se pagan fuera de CC al momento de la compra). Validado con
`BEGIN...ROLLBACK` (5 casos: proveedor+NC+CC, proveedor+NC+efectivo, cliente+NC+CC de regresión — los
5 se comportan como se espera). **Backfill aplicado**: se acreditó retroactivamente a
`cuenta_corriente_proveedores` el monto de las 3 devoluciones reales afectadas. Los 5 comprobantes-NC
huérfanos ya existentes se dejan como están (decisión del usuario) — no tienen impacto fiscal y
borrarlos es más riesgoso que el beneficio de "limpiarlos".

### 🔴 CONFIRMADO Y CORREGIDO: "Nueva Factura de Proveedor" no actualizaba stock ni costo
(hallazgo revisión punto por punto de **Compras**, sesión 60 cont. 2, 2026-07-11)

`NuevaFacturaProveedorModal.jsx` (botón "Nueva Factura de Proveedor" en Facturas de Proveedores) es
la ÚNICA vía en todo el frontend para crear una `compra` con ítems reales que **nunca** llamaba a
`aplicar_compra_producto` — a diferencia de `CompraRapidaSection.jsx`, que sí lo hace. Registraba la
deuda (CxP), el comprobante y el asiento correctamente, pero `productos.stock_actual` y
`productos.costo_compra` quedaban intactos. Confirmado que no hay ningún trigger de DB que lo
compense (`trg_audit_compras`/`trg_validar_tenant_centro_costo` son los únicos triggers en `compras`,
ninguno toca stock). El parámetro `compraOrigen` del modal (pensado quizás para "generar factura
desde recepción") nunca se usa en la práctica — el único call-site (`FacturasCompraSection.jsx`) lo
abre siempre standalone.

Confirmado con datos reales de Nalux: 1 factura identificable con certeza (forma_pago='CC Proveedor',
marca exclusiva de este modal) nunca sumó el stock de un producto real. No es posible distinguir con
certeza compras vía Efectivo/Transferencia hechas por este modal vs. por Compra Rápida (comparten las
mismas etiquetas), así que podría haber más casos no identificables sin revisión manual. Montos y
cantidades exactos omitidos de este doc por ser un repo público — quedan en el historial de la
conversación.

**Fix:** se agregó el mismo loop de `aplicar_compra_producto` por ítem (mismo patrón que
`CompraRapidaSection`, con acumulación de errores y bloqueo del toast de éxito si alguno falla).
**Backfill del caso real confirmado:** se sumó al stock la cantidad faltante de ese producto
(`ultimo_costo` ya estaba correcto, no requirió tocar el costo).

### 📋 Resumen para retomar (orden de prioridad sugerido)
1. ✅ **mig.196 aplicada** (sync estado_pago al imputar cobro/pago) — cerrado, ver arriba.
1b. ✅ **mig.197 aplicada** (crear_nota_credito imputa contra la factura de origen) + backfill de 5
   facturas reales — cerrado, ver arriba.
1c. ✅ **mig.198 aplicada** (mismo fix en la copia inline de crear_devolucion) — cerrado, sin backfill
   necesario. Las 2 NC que parecían huérfanas se confirmaron como reembolsos en efectivo legítimos.
1d. ✅ **mig.199 aplicada** (devolución a proveedor con NC acredita cuenta_corriente_proveedores en
   vez de crear un comprobante de venta fantasma) + backfill de 3 casos reales — cerrado, ver arriba.
2. ✅ **Historial de git**: decisión tomada (2026-07-11) — se deja como está. Son totales agregados
   mensuales, no datos personales ni secretos; reescribir el historial (force-push) es más riesgoso
   que el beneficio.
3. 🟡 Activar "Leaked Password Protection" en Supabase Auth — sigue pendiente. Requiere plan pago de
   Supabase (decisión del usuario 2026-07-11: posponer por ahora).
4. 🔄 Seguir el recorrido punto por punto: Compras (en curso — ver hallazgo mig.199 arriba), Ventas/POS
   completo, Inventario, Bancos/Caja, CC, Impuestos, Configuración.
5. 🟢 Repetir la auditoría visual con capturas reales (bloqueada por el tool de screenshot toda la
   sesión — algo a investigar aparte, posiblemente no relacionado con la app).

## Cómo retomar (para cualquier sesión futura)
1. Si aparece una nueva área o un módulo nuevo que auditar, agregarlo a la cola con la misma
   metodología de 6 dimensiones.
2. Para los 2 pendientes de decisión de negocio: agendar con el contador, no adivinar el fix.
3. Para la Fase 2 técnica: mismo patrón que mig.132 (has_module_permission + policies SELECT/CUD).
4. Auditar contra las dimensiones foco con la técnica base (BEGIN...ROLLBACK).
5. Registrar hallazgos en el **log**, aplicar fixes, documentar en CONTEXT.md y commitear.
