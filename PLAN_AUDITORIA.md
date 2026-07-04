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

## Registro de hallazgos (log corrido)

| Fecha | Área | Severidad | Hallazgo | Fix |
|-------|------|-----------|----------|-----|
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
| 2026-07-03 | Usuarios/Permisos (fase 2 SELECT) | 🟠 | Mig.132 dejó SELECT tenant-only; Staff con {dashboard,ventas} pudo LEER Historial de Compras completo ($8.372.098 en 12 compras) desde Compra Rápida/Proveedores | Mig.134 gatea SELECT con `has_module_permission` en 17 tablas exclusivas: 5 compras + 3 ventas + 3 bancos + 2 cheques + 4 configuracion. Excluidas intencionalmente: `facturas_proveedor` y `asientos_contables` (insumo de reportes cross-módulo). Verificado con ROLLBACK: staff bloqueado ve 0 filas; staff con permiso ve todo; admin siempre ve todo. **Pendiente aparte:** UI degradada en 15+ componentes cross-módulo (dropdowns vacíos) — resolver con RPCs SECURITY DEFINER scoped id+nombre |
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

**Fuera de alcance, documentado para el contador:** cheques *propios* (entregados a proveedores) no
se contabilizan — requeriría una cuenta "Documentos a Pagar" que todavía no existe en el plan de
cuentas; se agrega si el contador lo pide.

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

## Cómo retomar (para cualquier sesión futura)
1. Si aparece una nueva área o un módulo nuevo que auditar, agregarlo a la cola con la misma
   metodología de 6 dimensiones.
2. Para los 2 pendientes de decisión de negocio: agendar con el contador, no adivinar el fix.
3. Para la Fase 2 técnica: mismo patrón que mig.132 (has_module_permission + policies SELECT/CUD).
4. Auditar contra las dimensiones foco con la técnica base (BEGIN...ROLLBACK).
5. Registrar hallazgos en el **log**, aplicar fixes, documentar en CONTEXT.md y commitear.
