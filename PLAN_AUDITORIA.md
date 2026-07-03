# Plan de Auditoría — KAIROX Gestión
**Documento vivo.** Se actualiza en cada sesión de auditoría. Objetivo: recorrer TODO el sistema
por partes, dejando registrado qué se auditó, qué está en curso y qué falta — para que no se
escape nada.

**Última actualización:** 2026-07-02 (sesión 44 — CxC y CxP auditadas)
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

### 🔄 En curso
_(ninguna ahora — próxima: #3 de la cola = Caja / POS)_

### ⬜ Pendientes — cola priorizada por riesgo (dinero y seguridad primero)

| # | Área | Módulo / Tablas | Dimensiones foco | Por qué importa |
|---|------|-----------------|-------------------|-----------------|
| ~~1~~ | ~~Cuenta Corriente Clientes (CxC)~~ | — | — | ✅ AUDITADA S44 (ver tabla de arriba). Queda Hallazgo B (asiento) en gap sistémico |
| ~~2~~ | ~~Cuenta Corriente Proveedores (CxP)~~ | — | — | ✅ AUDITADA S44. Hallazgo 🔴: el pago no descontaba de Caja/Bancos → RPC atómico (mig.131). Queda asiento (gap sistémico) |
| 3 | **Caja / POS** ← próxima | CajaSection · `caja_sesiones`, `movimientos_caja`, `cajas` | T·D·C·A | Apertura/cierre/arqueo; diferencias; ¿quién cierra? |
| 4 | **Cheques** | ChequesSection · `cheques`, `cheques_historial` | T·D·A | Instrumentos de pago; estados (cartera/depositado/rechazado); ¿lifecycle correcto? |
| 5 | **Usuarios / Permisos granulares** | UsuariosSection · `profiles.permissions` (jsonb) | **T (crítico)** | ¿Los permisos se validan SOLO en la UI o también server-side (RLS/RPC)? Si es solo UI = vuln |
| 6 | **Notas de Débito** | `notas_debito` · `crear_nota_debito` | T·D·F | Impacto en CC; ¿genera asiento? signo correcto |
| 7 | **Impuestos / IVA / Retenciones** | `alicuotas_impuestos`, `retenciones` | F·D | Cálculo fiscal; alícuotas parametrizables (no hardcode) |
| 8 | **Multi-moneda / Tipos de cambio** | `tipos_cambio` · moneda paralela | F·D | Valuación; TC guardado por transacción; conversión correcta |
| 9 | **Períodos contables / Cierre** | `periodos_contables` · `fecha_en_periodo_cerrado` | D·T | ¿El cierre se respeta en TODOS los puntos de asiento? |
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
| 2026-07-02 | CxP Proveedores | 🔴 | Pagar a un proveedor NO descontaba de Caja/Bancos (tesorería inflada); ni capturaba método | RPC atómico `registrar_pago_proveedor` (mig.131) + selector de método |
| 2026-07-02 | CxC Clientes | 🔴 | Cobro no atómico (2 inserts sueltos): si el 2º falla, deuda baja sin registrar plata; reintento la baja 2 veces | RPC atómico `registrar_cobro_cliente` (mig.130) + frontend |
| 2026-07-02 | CxC / sub-libros | 🟡 | El cobro no genera asiento contable (mayor diverge del sub-libro) | **Gap sistémico** — ver nota abajo, requiere contador |
| 2026-07-02 | Bancos/Contab. | 🔴 | Borrar movimiento contabilizado → asiento huérfano | Trigger BEFORE DELETE (mig.128) + UI |
| 2026-07-02 | Bancos/Contab. | 🟡 | `contabilizar` sin FOR UPDATE → posible doble asiento | FOR UPDATE (mig.129) |
| 2026-07-01 | MP | 🔴 | Egresos MP registrados como ingreso | collector_id vs mp_user_id |
| 2026-07-01 | Integraciones | 🔴 | `integraciones_bancarias` sin gate admin (tokens legibles por cualquier user) | RLS admin-only (mig.124) |

---

## 🟡 Gap sistémico abierto — Contabilización de sub-libros
Los sub-libros (Caja, Bancos, Cuenta Corriente) mueven dinero pero **solo Ventas y Compras generan
asiento automático** (asientosAutoService). Cobros, pagos, movimientos de caja/bancos NO asientan →
el mayor contable puede divergir de los sub-libros. Ya se empezó a cerrar con la **Determinación de
Cuentas + contabilización de Bancos** (S43). Falta extenderlo a Caja y CC (cobros/pagos). **Requiere
decisión del contador** (qué cuentas imputar) — no se inventa. Aplica a: CxC (Hallazgo B), CxP, Caja.

## Cómo retomar (para cualquier sesión futura)
1. Abrir este archivo → mirar la **cola priorizada**.
2. Tomar el ítem #1 pendiente (o el que Luciano indique), marcarlo 🔄 "en curso".
3. Auditarlo contra sus dimensiones foco con la técnica base (ROLLBACK).
4. Registrar hallazgos en el **log**, aplicar fixes, mover el área a ✅.
5. Actualizar CONTEXT.md y commitear.
