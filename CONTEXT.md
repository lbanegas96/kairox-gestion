# KAIROX Gestión — Contexto de Sesión
**Última actualización:** 2026-06-15 (sesión 12 — Luciano) — Prompt 12: Migrations retroactivas 040-042 (tipos_cambio, moneda paralela, audit/triggers).
**Branch:** `master` → `origin/master` (GitHub: lbanegas96/kairox-gestion)
**Producción:** https://kairox-gestion.vercel.app

---

## ¿Qué es este proyecto?

**KAIROX Gestión** es un ERP/POS SaaS para PyMEs comerciales argentinas (ferreterías, distribuidoras, mayoristas, almacenes).

- **Mercado objetivo:** ~520K PyMEs registradas en Argentina. Segmento inicial: micro (1–3 empleados).
- **Competidores:** Xubio (50K+ clientes), Colppy (foco contable, sin POS), Tango (enterprise desde $528K/mes).
- **Stack:** React 18 + Vite + TailwindCSS + Shadcn/UI · Supabase (PostgreSQL + Auth + RLS + Edge Functions) · Context API · TanStack Query v5 · JS (JSX) + TS coexistiendo

---

## Módulos disponibles

| Módulo | Archivo principal | Estado |
|---|---|---|
| Launchpad (Home) | `LaunchpadSection.jsx` | ✅ Tiles por área + KPIs + accesos rápidos |
| **Listas de Precios** | `ListasPrecioSection.jsx` + `listaPreciosService.ts` | ✅ CRUD listas + items por producto + asignación a cliente |
| Dashboard Ejecutivo | `DashboardSection.jsx` | ✅ 8 KPIs + 2 gráficos (accesible desde Portal Finanzas) |
| Portal Ventas | `portals/VentasPortal.jsx` | ✅ 6 KPIs + módulos |
| Portal Compras | `portals/ComprasPortal.jsx` | ✅ 5 KPIs + módulos |
| Portal Finanzas | `portals/FinanzasPortal.jsx` | ✅ 5 KPIs + posición neta CxC-CxP |
| Portal Inventario | `portals/InventarioPortal.jsx` | ✅ 5 KPIs + barra salud stock |
| **Ventas (shell)** | `VentasSection.jsx` | ✅ **Prompt 4/6** Tab shell: Cotizaciones · Pedidos · Entregas · Facturas · Devoluciones (real) + botón POS flotante + `initialTab` prop para nav externa |
| **Ventas (POS)** | `NuevaVentaModal.jsx` | ✅ Multi-pago + check límite crédito + Moneda Paralela + **`pedido` prop** para pre-carga desde Pedido |
| Notas de Crédito | `NotaCreditoModal.jsx` + `notaCreditoService.ts` | ✅ Devolución parcial/total + reversión stock/CC/caja |
| Historial Ventas | `HistorialVentas.jsx` | ✅ Filtros avanzados + estado_pago CC + paginación 50/pág + **DropdownMenu por fila** (Ver detalle / Mapa relaciones / Copiar a NC / Copiar a ND / Devolver) |
| **Nueva Factura** | `ventas/NuevaFacturaModal.jsx` | ✅ **Prompt 9** Factura standalone sin descuento stock. FAC-YYYYMMDD-NNN. Multi-pago, CC→DEBE, Efectivo→movimientos_caja, AFIP+asientos fire&forget. Acepta `comprobanteOrigen` para pre-carga. |
| **Nueva NC** | `ventas/NuevaNCModal.jsx` | ✅ **Prompt 9** NC aislada NC-YYYYMMDD-NNN, tipo='nota_credito', origenLocked mode (cliente no editable), HABER en CC. |
| **Mapa de Relaciones** | `shared/MapaRelaciones.jsx` | ✅ **Prompt 9** Árbol SAP B1-style: cadena ascendente (pedido→entrega→factura) + derivados (NCs, NDs, cobros CC, devoluciones). Colores kx-* por tipo. |
| Comprobantes | `ComprobantePrintModal.jsx` | ✅ **Prompt 9** PDF Profesional: `getEmpresaParaPDF` hook, lazy TicketPDF/FacturaPDF según CAE estado. Toggle Comprobante / Remito sin precios. |
| Inventario | `ProductosSection.jsx` | ✅ Soft delete + import CSV + Análisis ABC |
| **Compras (shell)** | `ComprasSection.jsx` | ✅ **Prompt 5/6** Tab shell: Órdenes de Compra · Recepciones · Facturas · Devoluciones + botón Compra Rápida + `initialTab` prop |
| **Compra Rápida** | `CompraRapidaSection.jsx` | ✅ **Prompt 5/6** Formulario POS compras + asiento auto + call no-bloqueante `crear_recepcion_implicita` RPC |
| **Recepciones** | `compras/RecepcionesSection.jsx` | ✅ **Prompt 5/6** Lista recepciones (tabla `recepciones`) con expand inline ítems + filtro origen |
| **Facturas de Compra** | `compras/FacturasCompraSection.jsx` | ✅ **Prompt 5/6** Historial compras con expand inline detalle ítems |
| **Devoluciones Proveedor** | `compras/DevolucionesProveedorSection.jsx` | ✅ **Prompt 5/6** Sub-tabs: Devoluciones a Proveedor (tipo='proveedor') + Notas de Débito Recibidas |
| **GenerarRecepcionModal** | `compras/GenerarRecepcionModal.jsx` | ✅ **Prompt 5/6** Espejo de GenerarEntregaModal — llama RPC `crear_recepcion`, carga OC con items internamente |
| **ProveedorSelector** | `shared/ProveedorSelector.jsx` | ✅ **Prompt 5/6** Espejo de ClienteSelector — Select + DrillDown (CC proveedor + últimas OC) + Alta Rápida |
| Cotizaciones | `CotizacionesSection.jsx` | ✅ Funcional + convertir a venta + TC obligatorio |
| **Pedidos (OC Clientes)** | `PedidosSection.jsx` | ✅ Workflow borrador→facturado + **badges progreso entrega** + **botón Generar Entrega** (llama `crear_entrega` RPC) + **botón Facturar** (abre NuevaVentaModal pre-cargado → actualiza estado a 'facturado') |
| **Entregas** | `ventas/EntregasSection.jsx` | ✅ **NUEVO Prompt 3/6** Lista entregas con expand inline de ítems + filtro origen (POS/Manual) |
| **Generar Entrega** | `ventas/GenerarEntregaModal.jsx` | ✅ **NUEVO** Modal: tabla pendientes por item + inputs cantidad → RPC `crear_entrega` |
| **ClienteSelector** | `shared/ClienteSelector.jsx` | ✅ **NUEVO** Select + DrillDown (popover saldo CC + últimas compras) + Alta Rápida inline |
| **DocumentFlow** | `shared/DocumentFlow.jsx` | ✅ **COMPLETO Prompt 6/6** Chips: Cotización/Pedido/Entrega/Factura/Devolución/Nota Crédito/Nota Débito/OC/Recepción/Fact. Compra |
| **DocumentFlowPanel** | `ui/DocumentFlowPanel.jsx` | ✅ **COMPLETO Prompt 6/6** Cadena card SAP: origen→actual→NC→cobros CC→devoluciones. Usa `documentFlowService`. Renderizado en SaleDetailModal |
| Órdenes de Compra | `OrdenesCompraSection.jsx` | ✅ Workflow aprobación + 3-way match + realtime |
| Caja | `CajaSection.jsx` + `CajaCierre.jsx` | ✅ Arqueo por denominaciones + tab Arqueos |
| Clientes | `ClientesSection.jsx` | ✅ Form completo + condicion_pago + limite_credito + import CSV |
| Cuenta Corriente | `CuentaCorrienteSection.jsx` | ✅ Tab Antigüedad de Deuda (FIFO 30/60/90/+90 días) |
| Detalle Cta. Cte. | `ClientDetailModal.jsx` | ✅ Open Item Management SAP-style |
| Contabilidad | `PlanCuentasSection.jsx` | ✅ 5 tabs: Plan/Asientos/Balance/LibroMayor/**Períodos** — ⏳ P&L y Balance General en roadmap |
| **Impuestos** | `ImpuestosSection.jsx` + `impuestos/Tab*.jsx` | ✅ **NUEVO** 3 tabs: IVA (alícuota por producto + posición IVA mensual + Libros IVA) · Retenciones (sufridas/practicadas + certificado PDF) · Alícuotas (CRUD IIBB/Ganancias) |
| Proveedores | `ProveedoresSection.jsx` + `proveedoresService.ts` | ✅ Ficha completa + Cta. Cte. + Historial OC + Pago inline |
| Bancos | `CuentasBancariasSection.jsx` | ✅ Import CSV + conciliación auto/manual |
| **Cheques** | `ChequesSection.jsx` | ✅ **NUEVO** Cartera de terceros + propios + KPIs + historial de estados + notif vencimientos 7 días |
| **Onboarding Wizard** | `OnboardingWizard.jsx` + `ChecklistOnboarding.jsx` | ✅ **NUEVO** Wizard modal de bienvenida + checklist configuración inicial (se abre si `onboarding_completado = false`) |
| Reportes | `ReportesSection.jsx` | ✅ 5 reportes + Reporte de Paridad ARS/USD + paginación 100/pág |
| **Tipo de Cambio** | `TipoCambioModal.jsx` + `tipoCambioService.js` | ✅ **NUEVO** TC diario centralizado + upsert por empresa/moneda/fecha |
| **Reporte de Paridad** | `reportes/ReporteParidad.jsx` | ✅ **NUEVO** Comparativa ARS/USD por comprobante + CSV export |
| **Modo Caja** | `caja/ModoCajaLayout.jsx` | ✅ **Prompt 10** Layout POS pantalla completa sin sidebar. Topbar minimal (logo, empresa, estado caja, turno). Activado si `user.role==='solo_caja'` OR `user.modo_caja===true`. |
| **PanelProductos** | `caja/PanelProductos.jsx` | ✅ **Prompt 10** Grid buscador con `autoFocus`, stock badges (ok=verde / bajo=ámbar / sin_stock=rojo deshabilitado). |
| **AlertasStockBanner** | `caja/AlertasStockBanner.jsx` | ✅ **Prompt 10** Banner colapsable ámbar para stock bajo. Botón "Avisar" → inserta en `audit_log` tipo `aviso_cajero_stock` (no existe tabla notificaciones). |
| **PanelCarrito** | `caja/PanelCarrito.jsx` | ✅ **Prompt 10** Carrito + 4 métodos pago + confirmar venta vía `useConfirmarVenta` hook. |
| **HistorialTurnoModal** | `caja/HistorialTurnoModal.jsx` | ✅ **Prompt 10** KPIs turno + tabla ventas filtrada por cajero y apertura_fecha. |
| **useConfirmarVenta** | `hooks/useConfirmarVenta.js` | ✅ **Prompt 10** Hook que encapsula `crear_venta` RPC (ARS only) + asientos contables fire&forget. |
| Usuarios | `UsuariosSection.jsx` | ✅ Invitación + último acceso + activar/desactivar + preset Solo Caja + **toggle Modo Caja** por usuario staff |
| **NuevaFacturaProveedorModal** | `compras/NuevaFacturaProveedorModal.jsx` | ✅ **Prompt 11** Factura proveedor standalone. ProveedorSelector + ítems (PROD→`detalle_compras`, SERV→`observaciones`). Pago: Efectivo/Transferencia/CC Proveedor. CC→`cuenta_corriente_proveedores` HABER. Sin AFIP. |
| **NuevaNCProveedorModal** | `compras/NuevaNCProveedorModal.jsx` | ✅ **Prompt 11** NC financiera de proveedor (sin stock). INSERT en `cuenta_corriente_proveedores` DEBE (reduce deuda). Opción reembolso efectivo. NuevaDevolucionProveedorModal cubre el caso físico. |
| **NuevaNDProveedorModal** | `compras/NuevaNDProveedorModal.jsx` | ✅ **Prompt 11** ND recibida de proveedor (nos cobra más). Llama RPC `crear_nota_debito(tipo='recibida')` + INSERT manual `cuenta_corriente_proveedores` HABER (el RPC no inserta CC para 'recibida'). |
| **FacturasCompraSection** | `compras/FacturasCompraSection.jsx` | ✅ **Prompt 11** + DropdownMenu por fila (Ver detalle / NC / ND / Devolver / Mapa) + botón "Nueva Factura de Proveedor" + todos los modales integrados. |
| **MapaRelaciones** | `shared/MapaRelaciones.jsx` | ✅ **Prompt 11** Extendido con prop `compraId`. Modo compra: Recepción→FacturaCompra→PagosCC + derivados (Dev.Prov / NC financiera / ND recibida). Modo venta intacto. |
| Configuración | `ConfiguracionSection.jsx` | ✅ Logo + toggle OC + datos de ejemplo + **Moneda Paralela SAP-style** + **Wizard AFIP/ARCA** |

---

## Migraciones aplicadas en Supabase

| Archivo | Contenido | Estado |
|---|---|---|
| `schema.sql` | Schema base completo + RLS + triggers | ✅ |
| `migrations/001_audit_log.sql` | Tabla audit_log + fn_audit_trigger | ✅ |
| `migrations/002_cotizaciones.sql` | Cotizaciones + cotizacion_items | ✅ |
| `migrations/003_ordenes_compra.sql` | Órdenes de compra + items | ✅ |
| `migrations/004_plan_cuentas.sql` | Plan cuentas + asientos + seed | ✅ |
| `migrations/005_configuracion_rls_fix.sql` | Fix RLS tabla configuracion | ✅ |
| `migrations/009_cajas.sql` | Tabla cajas + FK caja_sesiones | ✅ |
| `migrations/010_drop_ventas_legacy.sql` | Backup + DROP ventas legacy | ✅ |
| `migrations/011_cuentas_bancarias.sql` | Cuentas bancarias + movimientos | ✅ |
| `migrations/012_facturas_proveedor.sql` | 3-way match OC | ✅ |
| `migrations/013_multi_moneda.sql` | Tabla tipos_cambio + columnas tipo_cambio_tasa | ✅ |
| `migrations/014_proveedores.sql` | Ficha completa proveedores + cuenta_corriente_proveedores | ✅ |
| `migrations/015_conciliacion_bancaria.sql` | extractos_bancarios + extracto_lineas + trigger sync | ✅ |
| `migrations/016_security_hardening.sql` | is_admin() + RLS config + rate_limit + audit triggers | ✅ |
| `migrations/017_multi_pago.sql` | Tabla comprobante_pagos + RLS + índices | ✅ |
| `migrations/018_condicion_pago.sql` | condicion_pago + dias_credito en clientes | ✅ |
| `migrations/019_pedidos.sql` | pedidos + pedido_items + RLS + audit trigger | ✅ |
| `migrations/020_notas_credito.sql` | tipo + estado_pago + comprobante_origen_id + motivo_nc en comprobantes | ✅ |
| `migrations/021_listas_precio.sql` | listas_precio + lista_precio_items + lista_precio_id en clientes + cotizacion_id/pedido_id en comprobantes | ✅ |
| **`create_tipos_cambio`** (SQL directo) | Tabla `tipos_cambio` — UNIQUE(empresa_id, moneda, fecha) + RLS via get_my_empresa_id() + índice | ✅ |
| **`add_moneda_paralela`** (SQL directo) | Columnas `usa_tc_paralelo`/`moneda_paralela` en empresas + `monto_paralelo`/`tc_paralelo` en comprobantes, movimientos_caja, cuenta_corriente_movimientos, compras | ✅ |
| **`migrations/022_rpc_decrement_stock.sql`** | RPC `decrement_stock(p_producto_id, p_cantidad)` — UPDATE atómico con check stock ≥ 0, SECURITY DEFINER | ✅ Aplicada via MCP |
| **`migrations/023_indices_faltantes.sql`** | 4 índices: `idx_comprobantes_estado_pago`, `idx_comprobantes_fecha`, `idx_cta_cte_empresa_cliente_tipo`, `idx_mov_inv_fecha` | ✅ Aplicada via MCP |
| **`migrations/024_rpc_crear_venta.sql`** | RPC `crear_venta` — venta transaccional atómica (comprobante + items + stock FOR UPDATE + mov_inventario + mov_caja + CC) con rollback automático, SECURITY DEFINER | ✅ Aplicada via MCP |
| **`migrations/025_afip_infraestructura.sql`** | AFIP Fase 1: columnas fiscales en `empresas` + `clientes.condicion_iva` + tabla `puntos_venta` (RLS) + columnas CAE en `comprobantes` + wrappers Vault `vault_secret_upsert`/`vault_secret_read` (SECURITY DEFINER, solo service_role) | ✅ Aplicada via MCP |
| **`migrations/026_onboarding.sql`** | Columna `onboarding_completado` en `empresas` + lógica de wizard de bienvenida | ✅ Aplicada |
| **`migrations/027_cierre_periodos.sql`** | Tabla `periodos_contables` (admin create/close) + RPC `fecha_en_periodo_cerrado(empresa_id, fecha DATE) RETURNS BOOLEAN` SECURITY DEFINER STABLE | ✅ Aplicada via MCP |
| **`migrations/028_cheques.sql`** | Tablas `cheques` + `cheques_historial` + RLS por `get_my_empresa_id()` + 3 índices (tipo, estado, vencimiento parcial) | ✅ Aplicada via MCP |
| **`migrations/029_fix_tenant_id_fkeys.sql`** | Fix FK: `comprobantes.tenant_id`, `caja_sesiones.tenant_id`, `movimientos_inventario.tenant_id` apuntaban a `profiles(id)` — ahora apuntan a `empresas(id)`. DROP constraints → UPDATE data → ADD constraints | ✅ Aplicada via MCP |
| **`030_compras_add_moneda`** (MCP) | `ALTER TABLE compras ADD COLUMN moneda text NOT NULL DEFAULT 'ARS'` + NOTIFY pgrst | ✅ Aplicada via MCP |
| **`031_compras_add_tipo_cambio_tasa`** (MCP) | `ALTER TABLE compras ADD COLUMN tipo_cambio_tasa numeric NOT NULL DEFAULT 1` + NOTIFY pgrst | ✅ Aplicada via MCP |
| **`migrations/032_impuestos_infraestructura.sql`** | IVA real: `alicuota_iva` en `productos`/`comprobante_items`/`detalle_compras` (CHECK 21/10.5/0/exento/no_gravado) + `neto_gravado`/`iva_discriminado` en `comprobantes` y `compras` + tabla `alicuotas_impuestos` (RLS, índice) | ✅ Aplicada via MCP |
| **`migrations/033_crear_venta_iva.sql`** | RPC `crear_venta` recalcula `neto_gravado`/`iva_discriminado` por ítem según su `alicuota_iva` (snapshot), fallback 21%. Copia íntegra de la lógica de 024 + cálculo IVA | ✅ Aplicada via MCP |
| **`migrations/034_retenciones.sql`** | Tabla `retenciones` (sufrida/practicada, IIBB/Ganancias/SUSS/IVA/Otro, trazabilidad a comprobante/compra) + RLS + índice + vista `retenciones_acumulado_mensual` (security_invoker) | ✅ Aplicada via MCP |
| **`migrations/035_document_flow_modelo_datos.sql`** | Document Flow Prompt 1/6 — contadores en items existentes (`cantidad_entregada`, `cantidad_devuelta`, `cantidad_facturada`, `cantidad_recibida`); tablas `entregas`+`entrega_items`, `recepciones`+`recepcion_items`, `devoluciones`+`devolucion_items`, `notas_debito`; función `siguiente_numero_documento(empresa_id, tabla, columna, prefijo)` SECURITY DEFINER | ✅ Aplicada via MCP |
| **`migrations/036_document_flow_rpcs.sql`** | Document Flow Prompt 2/6 — `crear_venta` actualizada (+ entrega implícita `ENT-YYYY-NNNN` al final de cada POS); `crear_entrega` (camino largo desde Pedido, descuenta stock); `crear_recepcion` (camino largo desde OC, suma stock); `crear_recepcion_implicita` (compras directas, solo documental, NO toca stock); `crear_factura_desde_entrega` (factura desde entrega existente, sin stock) | ✅ Aplicada via MCP |
| **`037_movimientos_inventario_add_user_id`** (MCP) | `ALTER TABLE movimientos_inventario ADD COLUMN user_id uuid REFERENCES profiles(id)` + NOTIFY pgrst — necesario para el RPC `crear_devolucion` de Luciano | ✅ Aplicada via MCP |
| **`038_movimientos_inventario_tipo_check_extend`** (MCP) | Drop + recrear `movimientos_inventario_tipo_check` aceptando `['entrada','salida','ajuste','ingreso','egreso']` — sinónimos para compatibilidad con RPCs nuevos y viejos | ✅ Aplicada via MCP |
| **`migrations/037_devoluciones_nd_rpcs.sql`** | Prompt 4/6 — `ALTER cuenta_corriente_movimientos`: `cliente_id` nullable + `proveedor_id` FK. RPC `crear_devolucion(empresa_id, user_id, tipo, items, ...)` → devoluciones + devolucion_items + NC opcional en comprobantes + CC movimiento + stock (ingreso si reingresa_stock) + caja (egreso si reembolso_efectivo). RPC `crear_nota_debito(empresa_id, user_id, tipo, concepto, monto, ...)` → notas_debito + CC movimiento DEBE. Correlativo DEV-YYYY-NNNN / NC-YYYY-NNNN / ND-YYYY-NNNN vía `siguiente_numero_documento`. SECURITY DEFINER + GRANT authenticated | ✅ Aplicada via MCP |
| **`migrations/039_modo_caja.sql`** | Prompt 10 — `ADD COLUMN IF NOT EXISTS modo_caja BOOLEAN NOT NULL DEFAULT false` en `profiles` + índice parcial `idx_profiles_modo_caja(empresa_id, modo_caja) WHERE modo_caja = true` | ✅ Aplicada via MCP |

### Migrations retroactivas (documentación de SQL directo)

| Archivo | Contenido | Estado |
|---|---|---|
| **`migrations/040_retroactive_tipos_cambio.sql`** | Tabla `tipos_cambio` (`id` gen_random_uuid, `moneda` DEFAULT 'USD', UNIQUE empresa+moneda+fecha) + 2 índices + 2 policies RLS (`tc_all`, `tipos_cambio_empresa_all`) + `trg_audit_tipos_cambio` | ✅ Solo documental |
| **`migrations/041_retroactive_moneda_paralela.sql`** | `empresas`: `usa_tc_paralelo`/`moneda_paralela`. `comprobantes`: `estado_pago`/`monto_paralelo`/`tc_paralelo`/`comprobante_origen_id`. `movimientos_caja` + `compras`: `monto_paralelo`/`tc_paralelo`. `cuenta_corriente_movimientos`: `comprobante_id`/`metodo_cobro`/`monto_paralelo`/`tc_paralelo` | ✅ Solo documental |
| **`migrations/042_retroactive_audit_y_triggers.sql`** | `fn_audit_trigger` (migrada de `row_to_json` → `to_jsonb`) + `fn_update_cliente_saldo` + trigger `trg_update_cliente_saldo` en `cuenta_corriente_movimientos` + vista `v_saldo_proveedores` | ✅ Solo documental |

---

## Infraestructura

- **Supabase URL:** `https://wuznppxeonmhfcvnqfbf.supabase.co`
- **Supabase Project ID:** `wuznppxeonmhfcvnqfbf` (org: NALUX)
- **SMTP:** Resend.com — `smtp.resend.com:465` · user: `resend` · sender: KAIROX Gestión ✅
- **Edge Functions deployadas:** `create-user` · `delete-user` · `invite-user` · `generar-csr` · `emitir-cae` ✅
- **Supabase Vault:** extensión `supabase_vault` 0.3.1 activa. Secretos AFIP por empresa: `afip_key_<empresa_id>` (clave privada, generada en `generar-csr` acción `generate`) y `afip_cert_<empresa_id>` (certificado .crt, subido vía `generar-csr` acción `store_cert`). Acceso solo vía RPC `vault_secret_upsert`/`vault_secret_read` (service_role).
- **Timezone:** Argentina (UTC-3) — helpers en `src/lib/dateUtils.js`
- **Multi-tenancy:** RLS via `get_my_empresa_id()` + `empresa_id` en todas las tablas
- **Logo:** Base64 en tabla `configuracion` (clave `logo_base64`)
- **Roles:** `admin` (acceso total) | `staff` (permisos granulares en `profiles.permissions` JSONB) | `solo_caja` (solo Ventas + Caja)
- **GitHub:** `https://github.com/lbanegas96/kairox-gestion` (branch: master)

---

## Convenciones (REGLAS DE ORO)

- **Multi-tenant:** TODAS las queries deben filtrar `.eq('empresa_id', user.empresa_id)`. Nunca `user_id` para filtrar (solo para INSERTs como autor).
- **INSERTs:** siempre incluir `empresa_id: user.empresa_id` + `user_id: user.id`.
- **Timezone:** usar siempre `getNowAR()` / `formatDateAR()` / `formatDateTimeAR()` de `dateUtils.js`. Nunca `toLocaleString()`.
- **Clientes activos:** todas las queries de selección incluyen `.neq('activo', false)`.
- **TanStack Query v5:** `onSuccess` en `useQuery` no existe. Usar `useEffect`.
- **RLS en tablas nuevas:** `ENABLE ROW LEVEL SECURITY` + policy `get_my_empresa_id()` + audit trigger + `DROP POLICY IF EXISTS` antes de `CREATE POLICY`.
- **Radix UI Dialogs:** nunca `if (!open) return null` — dejar que Radix maneje show/hide con prop `open`.
- **Caja:** solo cobros en Efectivo requieren caja abierta. Transferencia/Tarjeta/Cheque no.
- **Open Items:** al cobrar CC, siempre referenciar `comprobante_id` en el movimiento HABER.
- **Migrations:** siempre idempotentes — `IF NOT EXISTS`, `DROP POLICY/TRIGGER IF EXISTS`, `CREATE OR REPLACE`.
- **Vistas:** siempre `WITH (security_invoker = true)` para respetar RLS del usuario.
- **Multi-pago:** al confirmar venta, insertar en `comprobante_pagos` + `movimientos_caja` por cada pago no-CC + `cuenta_corriente_movimientos` para suma CC.
- **Límite de crédito:** verificar `saldo_actual + montoCC > limite_credito` antes de confirmar venta CC (cuando limite > 0).
- **`comprobante_items` columnas:** usa `producto_id` (español) y `cantidad` — ⚠️ CONTEXT.md anterior decía `produto_id`/`quantidade` (portugués) pero estaba INCORRECTO. Verificado con `information_schema.columns` en Prompt 2/6 — la columna real es `producto_id`. Usar siempre el nombre español.
- **Notas de crédito:** al crear NC, insertar en `comprobante_items` con `producto_id`. Revertir stock vía `movimientos_inventario` + RPC `increment_stock`.
- **Portales:** las secciones `portal_ventas`, `portal_compras`, `portal_finanzas`, `portal_inventario` son entry points — no van en ALL_SECTIONS de permisos.
- **Lista de precios:** `listaPreciosService.getPrecioMapForCliente(clienteId)` retorna `{producto_id: precio}`. En `NuevaVentaModal`, llamar en `handleSelectClient()`. Items con precio de lista tienen `_precioLista: true` para el badge.
- **Document Flow:** `documentFlowService.getFlowForComprobante(id)` retorna nodos origen/actual/NC/cobros. Usar `DocumentFlowPanel` pasando `comprobanteId` + `onNavigate`.
- **Notificaciones:** `useNotifications()` retorna `{items, count, stockBajo, deudaVencida, ocPendientes, cajaSinCerrar, hasNotifications}`. Bug histórico `user_id→empresa_id` ya corregido.
- **TC del día (fecha local):** usar `getTodayAR()` de `dateUtils.js` para formato `YYYY-MM-DD` en hora Argentina (NO `toISOString().slice(0,10)` que da UTC y puede desfasar en UTC-3).
- **AR-local-as-UTC:** el sistema almacena timestamps como "AR-local-as-UTC" — medianoche AR = `T00:00:00Z`, NO `T03:00:00Z`. Para filtros TIMESTAMPTZ usar `getNowAR().getTime()`, nunca `Date.now()`. Para construir ISO de inicio/fin de día usar `` `${date}T00:00:00.000Z` ``, nunca `new Date(\`${date}T00:00:00\`).toISOString()` (agrega tz del browser).
- **DATE vs TIMESTAMPTZ:** columnas `fecha` en `tipos_cambio`, `asientos_contables`, `extracto_lineas`, `extractos_bancarios`, `facturas_proveedor`, `pedidos.fecha_entrega` son DATE → reciben YYYY-MM-DD. El resto (`movimientos_caja.fecha`, `comprobantes.fecha`, `caja_sesiones.apertura_fecha`, etc.) son TIMESTAMPTZ → reciben ISO completo alineado con AR-local-as-UTC.
- **TC upsert:** tabla `tipos_cambio` con UNIQUE(empresa_id, moneda, fecha). Siempre `upsert` con `onConflict: 'empresa_id,moneda,fecha'` — nunca insert directo.
- **PGRST116:** el código de error Supabase "no rows returned" (`.single()` sin match) es ESPERADO cuando no hay TC del día — NO es un error real. Verificar `error.code !== 'PGRST116'` antes de `throw`.
- **Moneda Paralela:** cuando `empresa.usa_tc_paralelo = true`, todas las transacciones deben guardar `monto_paralelo` + `tc_paralelo`. Usar `useTCParalelo()` hook. Si `tcMissing = true` → bloquear operación y abrir `TipoCambioModal`.
- **TC sync en NuevaVentaModal:** cuando `moneda === monedaParalela`, el `tipoCambioTasa` del MonedaSelector se sincroniza automáticamente con `tcParalelo.setTC()` vía useEffect.
- **Supabase client lazy:** `customSupabaseClient.js` exporta un getter lazy para evitar TDZ (Temporal Dead Zone) en el bundle de producción. Nunca instanciar Supabase en el top-level de un módulo con `BroadcastChannel`.
- **PostgREST embedded select:** la sintaxis `.select('*, tabla_relacionada(cols)')` SOLO funciona si existe una FK explícita (`REFERENCES`) en PostgreSQL. Sin FK → 400 Bad Request. Si la FK no existe (o no se puede agregar), usar consulta en dos pasos: query principal → `.in('id', ids)` en tabla relacionada → merge manual en JS.
- **Dashboard KPIs:** `dashboardService.ts` filtra SIEMPRE con `.eq('empresa_id', empresaId)`. Nunca `user_id` para queries de lectura.
- **VentasSection navigation (Prompt 3/6):** todos los ítems del sidebar VENTAS (`ventas`, `cotizaciones`, `pedidos`, `entregas`, `historial_ventas`) renderizan `<VentasSection initialTab="...">` via Dashboard. El componente usa `key={activeSection}` heredado del shell → re-monta en cada navegación, respetando `initialTab`.
- **Document Flow RPCs — tipos de cantidad:** `pedido_items.cantidad` es NUMERIC; `movimientos_inventario.cantidad` es INTEGER. En `crear_entrega` la variable `v_cantidad` es NUMERIC; castear a INTEGER al actualizar stock: `stock_actual - v_cantidad::INTEGER`.
- **Document Flow — entrega implícita:** toda venta POS (`crear_venta` RPC) genera automáticamente una fila en `entregas` con `origen='implicita'` + sus `entrega_items`. Esto permite que EntregasSection muestre el historial completo (POS + manuales).
- **NuevaVentaModal prop `pedido`:** acepta `pedido` (con `pedido_items[]`, `cliente_id`). Si se provee, pre-carga carrito idéntico al flujo `cotizacion`. Usar desde PedidosSection al "Facturar" → en `onSaleSuccess`, actualizar `pedidos.estado = 'facturado'` y refrescar.
- **Sidebar colapsable:** estado en `localStorage('kx-sidebar-collapsed')` como `{VENTAS: true, COMPRAS: false, ...}`. `true` = colapsado. Default: todos expandidos. Toggle hace click en el label del grupo.

---

## Arquitectura de navegación (v3 — Sidebar flat con 7 grupos)

El rediseño v3 (2026-06-12) reemplazó el Launchpad Fiori + Portales por una navegación directa en sidebar:

```
Sidebar 7 grupos:
├── GENERAL       → dashboard, reportes
├── VENTAS        → ventas (POS), cotizaciones, pedidos, entregas, historial_ventas, clientes, cuentacorriente, listas_precio
├── COMPRAS       → compra_rapida, ordenes_compra, recepciones_compra, facturas_compra, devoluciones_proveedor, proveedores
├── INVENTARIO    → productos
├── FINANZAS      → caja (con status dot abierta/cerrada), bancos, cheques
├── CONTABILIDAD  → plan_cuentas, impuestos
└── ADMINISTRACIÓN→ usuarios, configuracion
```

- **Sidebar:** `src/components/Sidebar.jsx` — array `NAV_GROUPS` con grupos + íconos, `fixed md:relative`, `bg-kx-surface/80 backdrop-blur-md`. **Prompt 3/6:** grupos colapsables + persistencia en `localStorage('kx-sidebar-collapsed')`. **Prompt 5/6:** grupo COMPRAS reorganizado: `compra_rapida` (ShoppingCart) · `ordenes_compra` (ShoppingBag) · `recepciones_compra` (Package) · `facturas_compra` (Receipt) · `devoluciones_proveedor` (RotateCcw) · `proveedores` (Truck). Todos los ítems COMPRAS → `<ComprasSection initialTab="...">` via Dashboard.
- **Header:** `src/components/Header.jsx` — h-14, breadcrumb `empresa · sección`, búsqueda (⌘K), toggle tema, Bell notificaciones, CTA "Nueva Venta", Avatar dropdown.
- **Shell:** `src/components/Dashboard.jsx` — flex layout, `AuroraBackground` fixed z-10, no más `ml-{x}`.
- **Portales legacy:** `portalService.ts` + `portals/*.jsx` se mantienen en código pero ya no son accesibles desde el sidebar. El módulo `DashboardSection.jsx` es ahora el punto de entrada principal.

---

## Sistema TC del día centralizado (SAP-style)

### Arquitectura
- **Tabla:** `tipos_cambio` — columnas: `empresa_id`, `moneda`, `fecha` (YYYY-MM-DD), `tasa`, `user_id`, `updated_at`
- **Constraint:** `UNIQUE(empresa_id, moneda, fecha)` — un solo TC por empresa/moneda/día
- **Servicio:** `src/services/tipoCambioService.js`
  - `getTodayTC(empresaId, moneda)` — busca TC de HOY (hora local Argentina)
  - `upsertTC(empresaId, userId, moneda, tasa)` — crea o actualiza el TC del día
- **Modal:** `src/components/ui/TipoCambioModal.jsx` — se abre automáticamente si falta TC. Props: `open`, `onOpenChange`, `moneda`, `onConfirm(tasa)`.
- **MonedaSelector:** al cambiar moneda, auto-fetcha TC desde DB. Badge verde ✅ si encontrado, badge ámbar ⚠️ + "Cargar ahora" si falta. Prop `onTCMissingChange(bool)` para que el padre bloquee submit.

### Flujo obligatorio
1. Usuario selecciona moneda extranjera → MonedaSelector busca TC en DB
2. Si TC existe → auto-rellena campo tasa (editable)
3. Si TC falta → badge ámbar + botón "Cargar ahora" → abre TipoCambioModal → guarda + continúa
4. Si usuario intenta confirmar sin TC → toast de error + submit bloqueado

---

## Sistema Moneda Paralela (SAP Parallel Currency)

### Configuración
- **Toggle en Configuración:** `empresa.usa_tc_paralelo` (bool) + `empresa.moneda_paralela` ('USD' | 'EUR' | 'BRL')
- **Card en ConfiguracionSection:** Switch on/off + Select moneda + 3 info chips cuando activo

### Hook `useTCParalelo()` — `src/hooks/useTCParalelo.js`
```js
const { enabled, monedaParalela, tcHoy, tcMissing, loading, calcParalelo, setTC } = useTCParalelo();
// tcMissing = enabled && settingsReady && !loading && tcHoy === null
// calcParalelo(monto, monedaOp, tasaOp) → monto en moneda paralela | null
```

### Cobertura de módulos
Cuando `enabled = true`, los siguientes módulos guardan `monto_paralelo` + `tc_paralelo`:
- **Ventas (NuevaVentaModal):** banner naranja si TC ARS→USD falta; badge verde si cargado
- **Cotizaciones:** bloqueo TC si moneda extranjera
- **Caja, Cuenta Corriente, Compras:** columnas ready en DB (implementación pendiente UI)

### Reporte de Paridad — `src/components/reportes/ReporteParidad.jsx`
- Filtro por rango de fechas
- 4 KPIs: Total ARS · Total USD equiv. · TC promedio ponderado · Cobertura %
- Tabla: Nro | Fecha | Cliente | Forma Pago | Estado | Total ARS | TC | Equiv. USD
- Cálculo retroactivo para comprobantes sin `monto_paralelo` (usa histórico de `tipos_cambio`)
- Export CSV con BOM para Excel (`﻿`)
- Accesible desde ReportesSection (card deshabilitada si `usa_tc_paralelo = false`)

---

## Roadmap completo — estado actualizado

### 🔴 Fase 1 — Bloqueante para facturar legalmente
- **ARCA/AFIP:** WS WSFE, CAE automático, QR en impresión, puntos de venta por empresa, Libro IVA

### 🟠 Fase 2 — COMPLETADA ✅
- Multi-pago · Remito sin precios · Aging CC · Alertas CC · Discrepancia caja

### 🟡 Fase 3 — COMPLETADA ✅
- Import CSV · Pedidos de clientes · Condiciones de venta · Límite de crédito · Solo Caja

### 🟢 Fase 4 — COMPLETADA ✅
- Dashboard ejecutivo · Onboarding banner · Datos de ejemplo precargados

### 🔵 Fase 5 — COMPLETADA ✅
- Módulo Proveedores · Portales Fiori · Launchpad · Notas de crédito · Análisis ABC · Comparativa

### ⚪ Fase 6 — COMPLETADA ✅

1. ✅ **Lista de precios por cliente** — `listaPreciosService.ts` + `ListasPrecioSection.jsx` + aplicación automática en `NuevaVentaModal`
2. ✅ **Notificaciones / Inbox accionable** — fix bug `empresa_id` + caja sin cerrar (24h) en `useNotifications.js`
3. ✅ **Document Flow visual** — `documentFlowService.ts` + `DocumentFlowPanel.jsx` integrado en `SaleDetailModal`
4. ✅ **Recepción parcial OC** — ya estaba implementado; fix TanStack Query v5 `onSuccess→useEffect` en `OrdenesCompraSection`

### ⚫ Fase 7 — EN CURSO

1. ✅ **Deploy Vercel** — https://kairox-gestion.vercel.app · `vercel.json` + `vite.config.prod.js` · env vars configuradas
2. ✅ **Estabilización producción** — fix TDZ crash (framer-motion + BroadcastChannel), Google Translate DOM, stale-session 403
3. ✅ **TC del día centralizado** — tabla `tipos_cambio` + `TipoCambioModal` + `MonedaSelector` reescrito + bloqueo operaciones
4. ✅ **Moneda Paralela SAP-style** — toggle config + hook `useTCParalelo` + `monto_paralelo`/`tc_paralelo` en 4 tablas + Reporte Paridad
5. ✅ **ARCA/AFIP** + Libro IVA — **Fases 1-5 COMPLETAS**: infra DB (migration 025) + Edge Functions `generar-csr`/`emitir-cae` + Wizard de activación UI (ConfiguracionSection) + integración CAE en flujo post-venta (Fase 3) + PDF con QR fiscal RG 4291/2018 (Fase 4) + Libro IVA Ventas digital (Fase 5).
6. ⏳ **Membresías** / MercadoPago · Modelo de licencias Starter/Pro/Business

#### Pendientes Fase 7
- Configurar Supabase Auth URLs (Site URL + Redirect URLs → `https://kairox-gestion.vercel.app/**`)
- Extender TC obligatorio a módulos Caja + Cuenta Corriente + Compras (columnas DB ya listas)
- ✅ ~~Investigar error 400 en consola~~ — **RESUELTO** sesión PM·3
- ✅ ~~Deploy a producción~~ — **RESUELTO** 2026-06-13 sesión 2: auto-deploy de Vercel estaba roto desde commit `69d9f38` (5 commits sin deployar). Deploy manual disparado via MCP Vercel — URL: https://kairox-gestion.vercel.app
- **Tests manuales pendientes (Document Flow):**
  - POS: hacer venta → verificar fila en `entregas` con `origen='implicita'` aparece en EntregasSection
  - Pedido → Generar Entrega → verificar stock decrementado + fila en `entregas`
  - Pedido `en_preparacion` → Facturar → NuevaVentaModal pre-cargado → venta → pedido pasa a `facturado`
  - EntregasSection: expandir row → ver items con nombre de producto
  - Modal detalle Pedido: abrir pedido facturado → DocumentFlow muestra chip Pedido + chip Entrega + chip Factura

---

## ⚠️ Estado del conector MCP Supabase

En la última sesión el conector de Supabase en claude.ai estaba autenticado con una cuenta incorrecta (mostraba proyectos de org `kqtqkrbsorgtocnvnfxp` en lugar de `wuznppxeonmhfcvnqfbf`). Se reconectó vía OAuth a la cuenta NALUX.

**Al iniciar sesión, verificar:**
- El MCP Supabase debe listar el proyecto `wuznppxeonmhfcvnqfbf` (kairox-gestion, org NALUX)
- Si NO aparece: claude.ai → Conectores → Supabase → desconectar y reconectar con cuenta NALUX
- El frontend no se vio afectado (se conecta directamente vía URL/anon key del .env)

---

## Pendientes de la tabla SAP S/4HANA

### ✅ Completados

| # | Feature | Referente SAP | Estado |
|---|---|---|---|
| 1 | Lista de precios por cliente | SD Condition Types | ✅ Fase 6 |
| 2 | Notificaciones / Inbox accionable | SAP My Inbox | ✅ Fase 6 |
| 3 | Document Flow visual | SD Document Flow | ✅ Fase 6 |
| 4 | Recepción parcial de OC | MM Partial GR | ✅ Fase 6 |
| 10 | TC del día centralizado | FI Exchange Rate Entry | ✅ Fase 7 |
| 11 | Moneda paralela (Parallel Currency) | FI Company Code Global Parameters | ✅ Fase 7 |
| 7 | **Gestión de cheques** | TM Checks | ✅ Sesión 10-jun-2026 |
| 8 | **Cierre formal de períodos contables** | FI Period Close | ✅ Sesión 10-jun-2026 |
| 9 | **Retenciones IIBB/Ganancias** | FI Withholding | ✅ Sesión 12-jun-2026 |
| 12 | **IVA real por alícuota + Libro IVA Compras** | FI Tax (RTC) | ✅ Sesión 12-jun-2026 |
| 13 | **Document Flow transaccional** (entregas/recepciones/devoluciones/ND) — modelo datos + RPCs + UI Ventas + Devoluciones | SD Delivery + MM GR | ✅ Sesiones 13-jun-2026 (Prompts 1/6, 2/6, 3/6, 4/6) |

### 🟢 Baja prioridad (post-ARCA)

| # | Feature | Referente SAP |
|---|---|---|
| 5 | Solicitud de Compra | MM Purchase Req. |
| 6 | Presupuesto vs Real mensual | CO Budget |

---

## Historial de sesiones

### Sesión 2026-06-13 (sesión 6 — Nadia) — Testeo Document Flow + Fixes integrales + Devolución a Proveedor UI

**Objetivo:** después de pullear las 17 contribuciones de Luciano (Aurora redesign, Document Flow Prompts 1-6, Compra Rápida), recorrer secciones y arreglar bugs encontrados.

**Bugs detectados y fixes aplicados:**

1. **NuevaDevolucionModal exigía cliente incluso para Consumidor Final** ([NuevaDevolucionModal.jsx:88-96](src/components/ventas/NuevaDevolucionModal.jsx:88))
   - Síntoma: una venta a "Consumidor Final" (comprobante.cliente_id = null) no podía devolverse porque la validación bloqueaba.
   - Fix: si hay `comprobante` de origen, el cliente_id se obtiene de ahí (puede ser null y el RPC lo acepta). Solo exigir cliente en modo standalone.

2. **`movimientos_inventario.user_id` no existía** — pero el RPC `crear_devolucion` (migration 036 de Luciano) lo intenta insertar.
   - Fix: **migration 037** `ALTER TABLE movimientos_inventario ADD COLUMN user_id uuid REFERENCES profiles(id)` + NOTIFY pgrst.

3. **CHECK constraint `movimientos_inventario_tipo_check` solo aceptaba 'entrada'/'salida'/'ajuste'** — el RPC de Luciano usa `'ingreso'`/`'egreso'`.
   - Fix: **migration 038** DROP + RECREATE constraint con `['entrada','salida','ajuste','ingreso','egreso']`.

4. **ListasPrecioSection: contador `_itemCount` no se actualizaba en vivo**
   - Síntoma: al cargar precios especiales por producto y cerrar el modal, la tabla de listas seguía mostrando "0 productos".
   - Causa: al guardar/borrar item, solo invalidaba `ITEMS_KEY(listaId)` pero no `LISTAS_KEY(empresaId)` que es la query que carga el conteo.
   - Fix: invalidar AMBAS keys en `handleSaveItemPrecio` y `deleteItem.onSuccess`.

5. **TabRetenciones: no se podía guardar "Retención Practicada"** ([TabRetenciones.jsx:410-415](src/components/impuestos/TabRetenciones.jsx:410))
   - Síntoma: toast "Datos incompletos" aunque todos los campos estaban llenos.
   - Causa: `recalcMonto` devolvía formato US (`"4800.00"`) usando `.toFixed(2)` → `parseNumberLocale` estricto es-AR rechaza el punto como decimal → guardado interpreta el monto como NaN/0.
   - Fix: `recalcMonto` ahora aplica `.replace('.', ',')` para devolver formato es-AR (`"4800,00"`) compatible con el parser estricto.

**Feature nuevo: Devolución a Proveedor con UI completa**

Luciano había implementado el RPC `crear_devolucion(p_tipo='proveedor')` y la sección de listado `DevolucionesProveedorSection`, pero **no creó el modal ni el botón disparador**. Faltaba la mitad del feature.

- **CREADO** [src/components/compras/NuevaDevolucionProveedorModal.jsx](src/components/compras/NuevaDevolucionProveedorModal.jsx) — espejo del modal de cliente:
  - Carga `detalle_compras` de la factura (no `comprobante_items`).
  - Filtra ítems con saldo pendiente (`cantidad - cantidad_devuelta > 0`).
  - Checkbox "Descontar del stock" (default `true` para devolución a proveedor — la mercadería sale).
  - Compensación: Nota de Débito a proveedor / Reemplazo / Sin compensación.
  - Envía `p_tipo='proveedor'`, `p_compra_id`, `p_proveedor_id` al RPC `crear_devolucion`.
- **MODIFICADO** [FacturasCompraSection.jsx](src/components/compras/FacturasCompraSection.jsx): nueva columna "Acciones" + ícono `Undo2` (mismo que `HistorialVentas` para consistencia visual) en cada fila → abre el modal con la compra precargada.
- Al guardar, la devolución aparece automáticamente en **Compras → Devoluciones → Devoluciones a Proveedor**.

**Restaurado logo Kairox en Sidebar:** Luciano había reemplazado el logo real (`/kairox-logo.png`) por un placeholder con la letra "K" gradient en el rediseño Aurora. Sustituido por el `<img>` original manteniendo el estilo del nuevo Sidebar.

**Testeo manual realizado (todas OK):**

Dashboard, Sidebar con grupos colapsables (persiste en localStorage), Pedidos con KPIs, Devoluciones de cliente (con fixes), Listas de Precios (con fix de contador), Plan de Cuentas (Nueva Cuenta + Nuevo Asiento + Períodos), Impuestos > Alícuotas + Retenciones Practicadas (con fix), Cheques > Registrar cheque recibido, Compras > Facturas con nuevo botón Devolver, Inventario > Nuevo Producto, Proveedores > Nuevo Proveedor con ficha completa.

**Convenciones nuevas / refuerzos:**
- **Cálculos numéricos en el frontend:** cualquier valor calculado que vaya a un input controlado por `parseNumberLocale` debe devolverse en formato es-AR (coma decimal). NO usar `String(n.toFixed(2))` directamente — usar `.toFixed(2).replace('.', ',')`.
- **`movimientos_inventario.tipo`:** acepta sinónimos `entrada↔ingreso` y `salida↔egreso`. Los RPCs nuevos pueden usar cualquiera.
- **Devoluciones a Consumidor Final:** son válidas. El sistema debe permitir `cliente_id = null` cuando hay comprobante de origen.
- **TanStack Query invalidación:** cuando una mutación afecta a más de una key (ej: items + conteo en lista padre), invalidar **TODAS** las queries afectadas en `onSuccess`. No asumir que actualizar items refresca el padre.
- **UI espejada (Ventas ↔ Compras):** si Ventas tiene un patrón (ícono Undo2 para devolver en historial), Compras debe replicarlo en su sección equivalente (Facturas). Coherencia visual.

**Pendiente próxima sesión:**
- Probar el flujo end-to-end Document Flow completo (Pedido → Entrega → Venta → Devolución → NC) para asegurar la nav cruzada.
- Continuar parseNumberLocale en: ComprasSection cart, PlanCuentasSection monto asiento, ProveedoresSection pago, OnboardingWizard.
- Redeploy de `emitir-cae` con alícuotas reales por línea (homologación AFIP).

---

### Sesión 2026-06-13 (sesión 3) — Document Flow Prompt 4/6: Devoluciones + Notas de Débito UI
**Branch:** `master` (commit `10080de`)

**Objetivo:** construir la UI completa de Devoluciones de Clientes y Notas de Débito que consume las RPCs de migration 037.

**Archivos creados:**
- `src/components/ventas/NuevaDevolucionModal.jsx` — modal de devolución con dos modos: (a) pre-cargado desde comprobante (props `comprobante.id/numero_venta/cliente_id`) → fetcha `comprobante_items` filtrando `cantidad_entregada > cantidad_devuelta`, muestra tabla con inputs cantidad bounded por `maxDevolver`; (b) standalone con `ClienteSelector`. Opciones: `reingresa_stock` (checkbox, default false), `compensacion` (RadioGroup: nota_credito/reemplazo/pendiente), `reembolso_efectivo` (checkbox, solo visible si NC). Llama RPC `crear_devolucion`. Toast con número DEV + NC si aplica.
- `src/components/ventas/NuevaNotaDebitoModal.jsx` — modal ND: ClienteSelector, select de facturas del cliente (opcional), `concepto` (Textarea), `monto` (Input con parser AR 1.500,00). Llama RPC `crear_nota_debito tipo='emitida'`.
- `src/components/ventas/DevolucionesSection.jsx` — 2 sub-tabs: "Devoluciones de Clientes" (query `devoluciones WHERE tipo='cliente'` con expand inline de `devolucion_items`, badge CompensacionBadge, indicador stock, número NC) + "Notas de Débito" (query `notas_debito WHERE tipo='emitida'`). Botones "Nueva Devolución" (naranja) y "Nueva Nota de Débito" (ámbar).

**Archivos modificados:**
- `src/components/sections/VentasSection.jsx` — import `DevolucionesSection`; reemplaza placeholder `<div>Disponible en Prompt 4/6</div>` por `<DevolucionesSection />`.
- `src/components/ventas/HistorialVentas.jsx` — import `NuevaDevolucionModal` + `Undo2`; 2 estados nuevos (`devolucionComp`, `isDevolucionOpen`); columna "Ver" → "Acciones" (w-36); fila: botón `Eye` (detalle) + botón `Undo2` (solo si `sale.tipo === 'venta'`, stopPropagation). Click Undo2 setea `devolucionComp={id, numero_venta, cliente_id, cliente_nombre}` y abre modal.

**Fix crítico de build:** los nuevos modales importaban `toast` de `'sonner'` (no instalado). Corregido a `useToast` de `'@/components/ui/use-toast'` (patrón shadcn usado por todo el proyecto).

**PostgREST FK disambiguation:** DevolucionesSection usa `factura_origen:comprobantes!comprobante_id(numero_venta)` + `nota_credito:comprobantes!nota_credito_id(numero_venta)` para resolver las dos FKs que apuntan a la misma tabla `comprobantes`.

**Build verificado:** `vite build --mode development` → ✅ 3136 módulos, sin errores.

**Deploy:** `npx vercel deploy --prod --yes` → READY. https://kairox-gestion.vercel.app

---

### Sesión 2026-06-13 (sesión 2) — Fix 3.1: DocumentFlow + badge verbose en modal detalle Pedido
**Branch:** `master` (commit `0b0ce67`)

**Objetivo:** enriquecer el modal de detalle del Pedido (Dialog inline en `PedidosSection.jsx`) con visualización del Document Flow y badge de progreso de entrega más descriptivo.

**Problema:** al abrir un pedido, el modal mostraba estado, cliente, fecha, y tabla de items. Faltaba: badge verbose de progreso de entrega, chip chain `<DocumentFlow />` con cadena Pedido → Entrega(s) → Factura, colores en columna de entregado.

**Patrón IIFE del modal:** el modal usa `{detailPedido && (() => {...})()}` — no es un sub-componente, por lo que los hooks deben vivir en el scope del componente padre (`PedidosSection`) y ser leídos por closures dentro del IIFE. Se aplicó en dos partes (contexto anterior + esta sesión):

**Parte 1 (sesión anterior, ya aplicada):**
- Import de `DocumentFlow` de `@/components/shared/DocumentFlow`
- 3 estados nuevos: `entregasDetalle`, `loadingEntregas`, `entregasRefreshKey`
- `useEffect` que fetcha `entregas + comprobantes(numero_venta)` filtrado por `pedido_id` cuando el modal abre, con `entregasRefreshKey` como dependencia de refresh
- `handleEntregaSuccess` actualizado para hacer `setEntregasRefreshKey(k => k+1)` además del `fetchAll()`

**Parte 2 (esta sesión — Edit 5/5):**
- **Badge verbose de entrega:** tres variantes según `totalEnt` vs `totalPed`:
  - `totalEnt >= totalPed && totalPed > 0` → badge verde "✓ Completo (X/Y u.)"
  - `totalEnt > 0 && totalEnt < totalPed` → badge ámbar "Parcial X/Y u."
  - Sin entrega → badge gris "Sin entregar"
- **DocumentFlow chip chain:** construida desde `detailPedido` + `entregasDetalle`. Chips: `pedido` (active), un chip `entrega` por cada fila en `entregasDetalle`, más un chip `factura` si alguna entrega tiene `comprobante_id`. Sin `onNavigate` (informational-only — chips render como `cursor-default opacity-60`).
- **Tabla de items:** columnas renombradas a "Pedido" / "Entregado". La columna "Entregado" muestra en verde si completo, ámbar si parcial, gris si 0.
- **Modal scrolleable:** `max-h-[90vh] overflow-y-auto` para pedidos con muchos ítems.

**Build verificado:** `vite build --mode development` → ✅ 3130 módulos, sin errores.

**Pedidos históricos sin entregas:** `entregasDetalle` queda `[]` → DocumentFlow muestra solo el chip del Pedido (sin crash ni errores).

**Vercel deploy roto detectado:** al revisar Vercel, el último deploy automático correspondía a commit `69d9f38` (light mode v2). Los 5 commits siguientes (Document Flow Prompts 1/2/3 + CONTEXT.md fixes + Fix 3.1) NUNCA se deployaron. Se disparó deploy manual via MCP Vercel.

---

### Sesión 2026-06-13 — Document Flow Prompt 3/6: UI Ventas
**Branch:** `master`

**Objetivo:** construir toda la capa UI del Document Flow de Ventas. Reglas: no romper NuevaVentaModal ni CotizacionesSection; PedidosSection se adapta, no se reescribe desde cero; Sidebar colapsable se aplica a TODOS los grupos.

**Archivos creados:**
- `src/components/sections/VentasSection.jsx` — **reescrito** como tab shell (`initialTab` prop, tabs: cotizaciones / pedidos / entregas / historial / devoluciones). Botón "Nueva Venta (POS)" fuera de los tabs. Cada sidebar item navega con `initialTab` diferente.
- `src/components/ventas/EntregasSection.jsx` — listado de `entregas` con expand inline de `entrega_items`. Filtro origen (Todos/Manual/POS). Embedded selects PostgREST: `clientes(nombre)`, `pedidos(numero)`, `comprobantes(numero_venta)`, `entrega_items(*, productos(nombre))`.
- `src/components/ventas/GenerarEntregaModal.jsx` — tabla de items pendientes (pedido vs entregado), input cantidad por fila (default=pendiente), llama RPC `crear_entrega(p_empresa_id, p_user_id, p_pedido_id, p_items)`.
- `src/components/shared/DocumentFlow.jsx` — chip chain visual con ArrowRight entre chips. Props: `chips[]` + `onNavigate(tipo, id)`.
- `src/components/shared/ClienteSelector.jsx` — select de clientes + DrillDown (ojo) + Alta Rápida (UserPlus).
- `src/components/shared/ClienteDrillDown.jsx` — popover inline: saldo CC + últimas 3 compras. Fetcha `cuenta_corriente_clientes` + `comprobantes`.
- `src/components/shared/ClienteAltaRapidaModal.jsx` — alta rápida: nombre (req) + cuit + teléfono + condicion_iva. On save → `onCreated(cliente)` auto-selecciona.

**Archivos modificados:**
- `src/components/sections/PedidosSection.jsx` — importa `GenerarEntregaModal` + `NuevaVentaModal`. Nuevo: `ProgressoBadge` (verde si completo, ámbar si parcial). Botón **Truck** si `['confirmado','en_preparacion']` y hay pendiente → abre `GenerarEntregaModal`. Botón **Receipt** si `en_preparacion → facturado` → abre `NuevaVentaModal(pedido=...)` → `onSaleSuccess` actualiza pedido a 'facturado'. Tabla: columna "Progreso" añadida (colspan 7→8). Modal detalle: añade col Ent. + botones Generar Entrega y Facturar.
- `src/components/ventas/NuevaVentaModal.jsx` — añade `pedido = null` prop. En init useEffect, si `pedido?.pedido_items`, pre-carga cart (idéntico a cotizacion). Pre-selecciona `pedido.cliente_id`.
- `src/components/Dashboard.jsx` — elimina imports `CotizacionesSection`, `PedidosSection`. Routing: `cotizaciones`/`pedidos`/`ventas` → `<VentasSection initialTab="...">`. Nuevos casos: `entregas` → `initialTab="entregas"`, `historial_ventas` → `initialTab="historial"`.
- `src/components/Sidebar.jsx` — imports añadidos: `Box, ScrollText, RotateCcw, ChevronDown, ChevronRight`. VENTAS group: +`entregas` (Box) +`historial_ventas` (ScrollText). Todos los grupos: colapsables con `useState` (default: todos expandidos), persistencia en `localStorage('kx-sidebar-collapsed')`.

**Build verificado:** `vite build --mode development` → ✅ 3129 módulos sin errores.

**Tests manuales pendientes:**
- POS: venta → verificar fila en `entregas` con `origen='implicita'`
- Pedido: crear → avanzar a `en_preparacion` → Generar Entrega → verificar stock decrementado + fila en `entregas`
- Pedido: `en_preparacion` → Facturar → NuevaVentaModal pre-cargado con items + pedido → venta → pedido pasa a `facturado`
- EntregasSection: expandir row → ver items con nombre de producto

---

### Sesión 2026-06-13 — Document Flow Prompt 2/6: RPCs de negocio
**Branch:** `master`

**Objetivo:** dar vida al modelo de datos del Prompt 1/6 con RPCs transaccionales. Regla de oro: leer `crear_venta` completa desde la DB antes de modificarla.

**Hallazgos de schema verificados:**
- `movimientos_inventario.tipo` = `'salida'` / `'ingreso'` (no 'egreso'), tiene `tenant_id` (= empresa_id)
- `comprobante_items.producto_id` (no `produto_id` — CONTEXT.md anterior era inexacto)
- `crear_compra` RPC → NO existe; compras son INSERTs directos desde frontend
- `pedidos.cliente_id` ✅ · `ordenes_compra.proveedor_id` ✅ · `compras.proveedor_id` ✅

**`crear_venta` (modificada):**
- Copia exacta de la función v033 + 2 variables nuevas en DECLARE (`v_entrega_id`, `v_numero_entrega`)
- Bloque nuevo entre UPDATE neto_gravado y loop de pagos: genera `ENT-YYYY-NNNN` en `entregas` con `origen='implicita'` + `entrega_items` por item + actualiza `comprobante_items.cantidad_entregada`
- Stock NO vuelve a tocarse en el nuevo bloque (ya fue decrementado en el loop de items)

**Funciones nuevas (aditivas):**
- `crear_entrega(empresa_id, user_id, pedido_id, items)` — camino largo: lock+check stock, `UPDATE productos` (decremento), `movimientos_inventario tipo='salida'`, `entrega_items`, `pedido_items.cantidad_entregada +=`
- `crear_recepcion(empresa_id, user_id, orden_compra_id, items)` — espejo: `UPDATE productos` (incremento), `movimientos_inventario tipo='ingreso'`, `recepcion_items`, `ordenes_compra_items.cantidad_recibida +=`
- `crear_recepcion_implicita(empresa_id, user_id, compra_id)` — solo documental: lee `detalle_compras`, crea `recepciones`+`recepcion_items`, actualiza `detalle_compras.cantidad_recibida`; NO toca stock (ya actualizado por frontend al guardar la compra)
- `crear_factura_desde_entrega(...)` — idéntica firma a `crear_venta` pero sin stock/movimientos; sets `comprobante_items.cantidad_entregada = cantidad`; vincula `entregas.comprobante_id`; actualiza `pedido_items.cantidad_facturada` si viene `pedido_item_id`

**Smoke test:** funciones compilaron correctamente (5/5 en pg_proc). Test funcional desde browser pendiente (hacer venta → verificar fila en `entregas` con `origen='implicita'`).

---

### Sesión 2026-06-13 — Document Flow Prompt 1/6: Modelo de datos
**Branch:** `master`

**Objetivo:** crear exclusivamente el modelo de datos del Document Flow SAP-style (ningún archivo React tocado, ninguna RPC existente modificada).

**Parte 1 — Contadores en items existentes:**
- `comprobante_items`: +`cantidad_entregada`, +`cantidad_devuelta`
- `pedido_items`: +`cantidad_entregada`, +`cantidad_facturada`
- `detalle_compras`: +`cantidad_recibida`, +`cantidad_devuelta`
- `ordenes_compra_items`: `cantidad_recibida` ya existía (3-way match migration 012) → solo +`cantidad_facturada`, +`cantidad_devuelta`

**Parte 2 — Tabla `entregas` + `entrega_items`:**
- Flujo Ventas: Pedido → Entrega → Factura. `origen IN ('implicita','manual')`, `estado IN ('pendiente','entregado','parcial','anulado')`. FK a `pedidos`, `comprobantes`, `clientes`.
- `entrega_items`: FK a `pedido_items` (trazabilidad línea a línea).

**Parte 3 — Tabla `recepciones` + `recepcion_items`:**
- Flujo Compras: OC → Recepción → Factura Compra. FK a `ordenes_compra`, `compras`, `proveedores`.
- `recepcion_items.orden_compra_item_id` → `ordenes_compra_items(id)` (nombre real con "es").

**Parte 4 — Tabla `devoluciones` + `devolucion_items`:**
- Tipo `('cliente','proveedor')`. Compensación `('nota_credito','reemplazo','pendiente')`.
- `nota_credito_id REFERENCES public.comprobantes(id)` — en KAIROX las NCs son filas de `comprobantes` con `tipo='nota_credito'`, no tabla separada.
- Referencias de reemplazo: `entrega_reemplazo_id`, `recepcion_reemplazo_id`.

**Parte 5 — Tabla `notas_debito`:**
- Tipo `('emitida','recibida')`. `cc_movimiento_id` FK suave (sin constraint) — se completa al procesar.

**Parte 6 — Función `siguiente_numero_documento(empresa_id, tabla, columna, prefijo)`:**
- Genera correlativo tipo `ENT-2026-0001`. COUNT por empresa+año+prefijo. SECURITY DEFINER, solo `authenticated`.

**Ajuste clave detectado en schema real:** `ordenes_compra_items` (plural) vs spec que decía `orden_compra_items` (singular). Verificado con `information_schema` antes de escribir la migration.

---

### Sesión 2026-06-12 (noche) — Light mode v2: Stripe-style contrast + acentos saturados + sombras reales
**Branch:** `master` (commit `69d9f38`)

**Objetivo:** light mode se veía plano (todo blanco sobre blanco). Mejorarlo con el principio Stripe: fondo gris clarito vs cards blancas, acentos de color más saturados sobre fondo claro, sombras con elevación real.

**Cambio 1 — Diferenciación fondo/card:**
- `src/index.css` `:root`: `--kx-bg: 246 246 248` (gris #f6f6f8, antes 250 250 250), `--kx-surface-2: 250 250 251`, `--kx-border: rgba(0,0,0,0.08)` (antes 0.06).
- Las cards (`--kx-surface: 255 255 255` blanco puro) ahora "flotan" sobre el fondo gris sin necesitar bordes gruesos.

**Cambio 2 — Acentos saturados en light:**
- `:root`: acentos reemplazados por variantes -600 de Tailwind (más saturadas sobre fondo claro): `--kx-violet: 124 58 237` (violet-600), `--kx-green: 5 150 105` (emerald-600), `--kx-blue: 37 99 235` (blue-600), `--kx-amber: 217 119 6` (amber-600), `--kx-red: 220 38 38` (red-600).
- `.dark`: acentos originales restaurados **explícitamente** (antes solo en `:root` y `.dark` los heredaba — al cambiar `:root` se rompería dark): `--kx-violet: 157 123 255`, `--kx-green: 61 220 151`, etc.
- **Convención crítica:** si los acentos `--kx-*` solo están en `:root`, `.dark` los hereda. Al cambiar `:root` para light, **siempre agregar los valores dark explícitamente en `.dark`**.

**Cambio 3 — Sombras con elevación real:**
- Hero/KPI/cotizaciones KPI rows (wrappers de grid): `shadow-sm dark:shadow-none`.
- Paneles standalone (Stock, Cotizaciones, gráficos, Acciones Rápidas): `shadow-sm dark:shadow-none` en reposo + `hover:shadow-lg dark:hover:shadow-[0_4px_20px_rgba(0,0,0,0.4)]` en hover (antes solo `hover:shadow-md`).
- Header: `shadow-sm dark:shadow-none` — separa el topbar del contenido.

**Cambio 4 — Sidebar/Header automático:**
- Sidebar/Header usan `bg-kx-surface/80 backdrop-blur-md`. Con `--kx-bg` gris-claro, se ven claramente más blancos que el fondo → separación visual automática sin cambios adicionales.

**Convenciones nuevas:**
- En light mode, los colores de acento sobre fondos claros necesitan -600 (más saturados) vs dark que usa -400/-300 (más luminosos sobre fondo oscuro).
- `shadow-sm dark:shadow-none` es el patrón estándar para elevar cards en light sin afectar dark.

---

### Sesión 2026-06-12 (tarde) — Visual polish v3: acentos de color + hover elevation + aurora light mode
**Branch:** `master` (commit `283527d`)

**Objetivo:** tres refinamientos visuales sobre el rediseño v3 aprobado.

**Cambio 1 — Bordes de acento `border-t-2` por categoría:**
Aplicado en `DashboardSection.jsx` a cada card según su semántica:
- Violet (`--kx-violet`): Ventas del mes, Ventas del día, Cotizaciones/mes, Aprobadas pendientes
- Green (`--kx-green`): Caja, Balance neto, Tasa de conversión
- Blue (`--kx-blue`): Margen bruto
- Red (`--kx-red`): Gastos del mes
- Amber (`--kx-amber`): Deuda clientes, Monto convertido

**Cambio 2 — Hover elevation:**
- Cards dentro de grids `overflow-hidden` (hero, KPI, cotizaciones KPI rows): solo `hover:bg-kx-surface-2 transition-colors duration-200` — el translate se recortaría con overflow:hidden.
- Paneles standalone (Stock, Cotizaciones, gráficos, Acciones Rápidas): `transition-all duration-200 ease-out hover:shadow-md dark:hover:shadow-[0_4px_20px_rgba(0,0,0,0.4)] hover:-translate-y-0.5 hover:border-kx-border-hover`.

**Cambio 3 — Aurora más visible en light mode:**
`src/components/ui/AuroraBackground.jsx`:
- Blobs 1 y 2: `opacity-[0.22] dark:opacity-[0.35]` (antes 0.18), `blur-[60px] dark:blur-[80px]` (antes solo 80px).
- Blob 3 (verde): `opacity-[0.12] dark:opacity-[0.15]` (antes 0.10).

**Convención nueva:** `overflow-hidden` en un contenedor padre recorta `transform: translateY()` de sus hijos — no usar hover elevation translate dentro de grids con overflow:hidden. Alternativa: solo color change (`hover:bg-kx-surface-2`).

---

### Sesión 2026-06-12 (tarde) — Rediseño v3 completo: Aurora theme + Shell + Dashboard
**Branch:** `master` (commit `27562b5`)

**Objetivo:** rediseño visual completo del ERP — sistema de design tokens, background animado, sidebar/header/shell nuevos, DashboardSection reconstruido.

#### 1. Sistema de tokens CSS `--kx-*` (`src/index.css` + `tailwind.config.js`)
Variables en formato `R G B` para soportar modificadores de opacidad Tailwind (`bg-kx-surface/40`):
- `--kx-bg`, `--kx-surface`, `--kx-surface-2` — fondos y superficies
- `--kx-border`, `--kx-border-hover` — bordes en formato `rgba()`
- `--kx-text`, `--kx-text-2`, `--kx-text-3` — jerarquía tipográfica
- `--kx-violet`, `--kx-green`, `--kx-blue`, `--kx-amber`, `--kx-red` — acentos semánticos
- `tailwind.config.js`: todos como `'kx-*': 'rgb(var(--kx-*) / <alpha-value>)'` en `colors.extend`, keyframes `kx-float1/2/3` para aurora, animaciones 22s/26s/30s.

#### 2. Aurora Background (`src/components/ui/AuroraBackground.jsx`) — NUEVO
3 blobs `position:fixed z-index:-10` con `radial-gradient + blur + keyframe` flotando independientemente. Componente puro, sin lógica, sin props.

#### 3. Sidebar reescrito (`src/components/Sidebar.jsx`)
Array `NAV_GROUPS` con 7 grupos (GENERAL/VENTAS/COMPRAS/INVENTARIO/FINANZAS/CONTABILIDAD/ADMINISTRACIÓN). Layout: `fixed md:relative inset-y-0 left-0` — overlay en mobile, flex item en desktop. Elimina completamente los `ml-{x}` del contenido. Footer con avatar gradiente + nombre + rol + LogOut.

#### 4. Header reescrito (`src/components/Header.jsx`)
`h-14 bg-kx-surface/80 backdrop-blur-md`. Breadcrumb izquierda (`empresa · sección`). Derecha: búsqueda ⌘K, toggle tema (Sun/Moon), Bell con dropdown de notificaciones completo, CTA "Nueva Venta", Avatar dropdown con configuración/logout.

#### 5. Dashboard shell (`src/components/Dashboard.jsx`)
`flex h-full relative z-10`. `AuroraBackground` fuera del flex container (fixed). `isSidebarOpen` inicia en `false`. Sin `ml-{x}`.

#### 6. DashboardSection reconstruida (`src/components/sections/DashboardSection.jsx`)
- **Hero row:** `grid-cols-[1.4fr_1fr_1fr] gap-px bg-kx-border rounded-2xl overflow-hidden` — Ventas mes / Caja / Margen bruto. Técnica `gap-px bg-kx-border` = divisores 1px sin bordes reales.
- **KPI row:** `grid-cols-2 md:grid-cols-4` — Ventas día / Gastos mes / Balance neto / Deuda clientes.
- **Bottom grid:** `grid-cols-1 lg:grid-cols-[1.3fr_1fr]` — panel Stock alerts + panel Cotizaciones.
- **KPIs Cotizaciones:** grid 4 cards preservado (Cotizaciones/mes · Tasa conversión · Aprobadas · Monto convertido).
- **Gráficos:** Ventas 7d (BarChart) + Flujo Caja 6m (LineChart) — ambos en panels `bg-kx-surface`.
- **Acciones Rápidas:** 6 `QuickActionButton` con gradientes.

**Error detectado y corregido:** `tailwind.config.js` no permite dos keys `colors` en `extend` — el segundo sobreescribe al primero (shadcn perdido). Fix: merge de ambos en un único objeto `colors`.

**Convenciones nuevas:**
- CSS variables kx-* como canales RGB (`250 250 250` no `#fafafa`) para que Tailwind pueda aplicar opacidad arbitraria (`/40`, `/80`, etc.).
- `fixed md:relative` en sidebar elimina la necesidad de margin en el contenido — el sidebar en desktop es un flex item normal.
- Técnica `gap-px bg-kx-border overflow-hidden rounded-2xl` en grids crea divisores 1px de color sin borders reales en cada celda.

---

### Sesión 2026-06-12 (tarde) — Reglas UX globales: caja cerrada bloquea todo + parseNumberLocale es-AR estricto + ticket en moneda elegida

**Objetivo:** después de testear el módulo Impuestos de Luciano (todo OK), aplicar reglas de UX consistentes en toda la app para que no haya inconsistencias entre secciones.

#### 1. Caja cerrada bloquea TODO

- **Antes:** la regla histórica era "solo Efectivo requiere caja abierta". Esto generaba confusión porque dejaba registrar ventas Transferencia/Tarjeta/Cheque con caja cerrada.
- **Ahora:** cualquier venta o movimiento requiere caja abierta, sin importar el método. Caja abierta = todo permitido.
- Archivos: [src/components/ventas/NuevaVentaModal.jsx](src/components/ventas/NuevaVentaModal.jsx) y [src/components/sections/CajaSection.jsx](src/components/sections/CajaSection.jsx) — validación temprana con toast "⛔ Caja cerrada".

#### 2. `parseNumberLocale` estricto formato es-AR

Reescritura completa en [src/lib/currencyUtils.js](src/lib/currencyUtils.js):
- **Punto** = separador de miles → grupos de EXACTAMENTE 3 dígitos
- **Coma** = único separador decimal
- El primer grupo puede tener 1–3 dígitos; los demás SIEMPRE 3
- Rechaza con `NaN`: `120000.50`, `500.00`, `1.4`, `1,234.56`, múltiples comas, caracteres no numéricos
- Acepta: `500.000`, `120.000,50`, `1.668,21`, `0,0036`

Bug previo: el RPC inserta lo que recibe; si el input HTML `type="number"` interpreta `300.000` como `300` (browser locale), el campo `monto` del form ya contiene `300` antes de `parseNumberLocale`. Solución: cambiar inputs a `type="text" inputMode="decimal"` y parsear en submit.

#### 3. Inputs de plata migrados (`type=text inputMode=decimal` + `parseNumberLocale`)

Archivos completados esta sesión:
- ✅ [CajaApertura.jsx](src/components/caja/CajaApertura.jsx) — monto inicial
- ✅ [CajaCierre.jsx](src/components/caja/CajaCierre.jsx) — saldo real arqueo
- ✅ [CajaSection.jsx](src/components/sections/CajaSection.jsx) — nuevo movimiento (monto)
- ✅ [NuevaVentaModal.jsx](src/components/ventas/NuevaVentaModal.jsx) — montos multi-pago
- ✅ [ProductosSection.jsx](src/components/sections/ProductosSection.jsx) — `costo_compra` y `precio_venta` (alta + edit)
- ✅ [CotizacionesSection.jsx](src/components/sections/CotizacionesSection.jsx) — `precio_unitario` por ítem
- ✅ [PedidosSection.jsx](src/components/sections/PedidosSection.jsx) — `precio_unitario` por ítem

**Pendientes próxima sesión** (requieren refactor del estado del carrito porque guardan valores parseados en cada keystroke):
- ⏳ ComprasSection — `costo_unitario` cart + edit
- ⏳ ClientDetailModal — cobros CC en efectivo
- ⏳ ListasPrecioSection — precio por ítem
- ⏳ PlanCuentasSection — monto asiento manual
- ⏳ ProveedoresSection — pago a proveedor
- ⏳ ConfiguracionSection — eventuales montos
- ⏳ OnboardingWizard — montos iniciales

#### 4. Ticket y PDF de venta DISPLAY en moneda elegida

[ComprobantePrintModal.jsx](src/components/ventas/ComprobantePrintModal.jsx) y [pdf/ComprobantePDF.jsx](src/components/ventas/pdf/ComprobantePDF.jsx):

- Si `comprobante.moneda === 'ARS'`: todos los precios, subtotales, pagos y total en pesos como antes.
- Si moneda extranjera (USD/EUR/BRL) con `tipo_cambio_tasa > 0`: **TODO en la moneda elegida**, convertido desde ARS dividiendo por el TC. Headers de columna incluyen la moneda (`P. Unit. (USD)`). Al final del ticket aparece el TC y el equivalente ARS como referencia chiquita.
- Misma lógica aplicada en el modal de detalle de cotización ([CotizacionesSection.jsx:567](src/components/sections/CotizacionesSection.jsx:567)).

**Convención:** internamente todo se guarda en ARS (con TC) — solo la VISTA cambia según la moneda elegida.

#### 5. Cantidades como enteros estrictos

Inputs de cantidad ahora con `type="number" min="1" step="1"` + `onChange={e => updateItem(...e.target.value.replace(/[^\d]/g, ''))}` — imposible tipear punto, coma o decimales:
- ✅ [OrdenesCompraSection.jsx](src/components/sections/OrdenesCompraSection.jsx) — `cantidad_pedida`
- ✅ [CotizacionesSection.jsx](src/components/sections/CotizacionesSection.jsx) — cantidad por ítem
- ✅ [PedidosSection.jsx](src/components/sections/PedidosSection.jsx) — cantidad por ítem
- ✅ [ProductosSection.jsx](src/components/sections/ProductosSection.jsx) — stock_actual, stock_minimo, movimientos
- ⏳ ComprasSection y NuevaVentaModal cart (también pendientes)

#### 6. Dropdown unificado de unidades de medida

Nuevo helper [src/lib/unidadesMedida.js](src/lib/unidadesMedida.js): export `UNIDADES_COMUNES` (11 opciones: Unidad, Kilogramos, Gramos, Litros, Mililitros, Metros, Centímetros, Caja, Pack, Docena, Bolsa) + `getShortUnit(unit)` para mostrar `kg`/`gr`/`lt`/etc.

Aplicado como `<select>` inline (no via componente porque mantiene Radix simple):
- ✅ [OrdenesCompraSection.jsx](src/components/sections/OrdenesCompraSection.jsx) — unidad por ítem
- ✅ [CotizacionesSection.jsx](src/components/sections/CotizacionesSection.jsx) — unidad por ítem
- ✅ [ProductosSection.jsx](src/components/sections/ProductosSection.jsx) — unidad del producto (antes no existía en el form, default `'Unidad'`)

#### 7. Eliminado form duplicado "Nuevo Proveedor" de Inventario

[ProductosSection.jsx](src/components/sections/ProductosSection.jsx) tenía un Dialog "Registrar Proveedor" con campos básicos (nombre, contacto, teléfono, email, dirección), que se duplicaba con el Dialog completo de ProveedoresSection (CUIT, razón social, condición IVA, localidad, provincia, condición/plazo pago). Quitado el Dialog, botón, handler y state. **El alta de proveedores se hace solo desde la sección Proveedores.**

#### Bug observado en producción (solo cacheo del browser)

El user vio una caja abierta con `monto_inicial=$300` después de mis fixes. La DB lo confirmó. La causa: el browser tenía cacheada la versión vieja del JS (cuando el input era `type="number"` y `parseFloat("300.000")` daba 300). Solución: **hard reload (`Ctrl+Shift+R`)** después de cambios en código. Vite manda HMR pero el browser no siempre lo aplica si tiene service worker o cache agresiva.

**Convenciones nuevas:**
- **Inputs de plata:** SIEMPRE `type="text" inputMode="decimal" placeholder="0,00"` + parsear con `parseNumberLocale()` en submit. Nunca `type="number"` para campos monetarios.
- **Inputs de cantidad:** `type="number" min="1" step="1"` + `onChange={e.target.value.replace(/[^\d]/g, '')}`. Sin decimales.
- **Display de moneda:** internamente ARS; la vista (ticket, PDF, cotización detalle) convierte a la moneda registrada del comprobante usando `tipo_cambio_tasa`.
- **Caja cerrada = nada se puede hacer.** No hacer excepciones por método de pago.
- **Helpers compartidos** para unidades de medida (`src/lib/unidadesMedida.js`) — si una sección necesita un dropdown de unidades, importar de ahí.

---

### Sesión 2026-06-12 — Submódulo Impuestos (FI Tax): IVA real + Alícuotas + Retenciones
**Branch:** `master` (commit directo)

**Objetivo:** dos fases de un mismo submódulo `Impuestos` accesible desde el Sidebar (grupo Contabilidad), con 3 tabs: IVA, Retenciones y Percepciones, Alícuotas.

**Nota de numeración:** los specs pedían migraciones `029`/`030`/`031`, pero esos números ya estaban aplicados (fix_tenant_id_fkeys, compras_add_moneda, compras_add_tipo_cambio_tasa). Renumeradas a **032/033/034**. Se usó `gen_random_uuid()` (no `uuid_generate_v4()`).

#### Fase A.1 — IVA real + Alícuotas (migrations 032 + 033)
- **Migration 032:** `alicuota_iva` TEXT en `productos` (NOT NULL DEFAULT '21' + CHECK), `comprobante_items` y `detalle_compras` (snapshot al momento de la operación). `neto_gravado`/`iva_discriminado` NUMERIC en `comprobantes` y `compras`. Tabla `alicuotas_impuestos` (impuesto IIBB/Ganancias/SUSS/Otro, jurisdicción, alícuota, vigencia, fuente manual/padron_arba/padron_agip) con RLS por `get_my_empresa_id()`.
- **Migration 033:** `crear_venta` recalcula `neto_gravado`/`iva_discriminado` por ítem según `alicuota_iva` (subtotal incluye IVA → `neto = subtotal/(1+factor)`; factores 0.21/0.105/0). Copia íntegra de la lógica de 024 (RPC crítica) + cálculo. Fallback `'21'` para ítems sin alícuota.
- **`ImpuestosSection.jsx`** (shell 3 tabs) + **`impuestos/TabIVA.jsx`** (Select de alícuota inline por producto + buscador + "Aplicar 21% a todos" con AlertDialog; posición IVA mensual: débito fiscal = IVA ventas, crédito = IVA compras, posición = a pagar/a favor; links a Libro IVA Ventas (navega a Reportes) y Libro IVA Compras (inline)) + **`impuestos/TabAlicuotas.jsx`** (CRUD + seed opt-in Córdoba; exporta `PROVINCIAS_AR`).
- **`reportes/ReporteLibroIVACompras.jsx`:** espejo del Libro IVA Ventas sobre `compras` + `proveedores` (consulta en 2 pasos sin embedded select), KPIs (bruto/neto/crédito fiscal), CSV con BOM.
- **POS (`NuevaVentaModal.jsx`):** query de productos incluye `alicuota_iva`; `itemsPayload` envía `alicuota_iva: item.alicuota_iva ?? '21'` (el carrito hace `{...product}`, arrastra la alícuota).
- **`ComprobantePDF.jsx`:** desglosa Neto Gravado + IVA reales (`comprobante.neto_gravado`/`iva_discriminado`), fallback `total/1.21`.
- **`emitir-cae/index.ts`:** lee `comprobante_items` y arma items WSFE con alícuota real por línea (`alicuotaPct` + `wsfeItems`); usa `neto_gravado`/`iva_discriminado` persistidos. ⚠️ **Código actualizado, pendiente de redeploy** (toca homologación AFIP).
- **Sidebar + Dashboard:** ítem `impuestos` (icono `Receipt`) + case routing con `onNavigate`.
- **Configuración:** verificado que solo tiene `condicion_iva` de AFIP (dato fiscal) — nada que mover.

#### Fase A.2 — Retenciones y Percepciones (migration 034)
- **Migration 034:** tabla `retenciones` (tipo sufrida/practicada, impuesto, jurisdicción, monto, alícuota_aplicada, contraparte_nombre/cuit, trazabilidad a `comprobante_id`/`compra_id`, numero_certificado) + RLS + índice + vista `retenciones_acumulado_mensual` (security_invoker, agrupado por mes/impuesto/jurisdicción).
- **`impuestos/TabRetenciones.jsx`:** 2 sub-tabs. **Sufridas** = registro manual (KPIs crédito fiscal IIBB/Ganancias/total, modal completo, importación ARBA marcada "próximamente"). **Practicadas** = select proveedor + compra reactiva, pre-carga de alícuota desde `alicuotas_impuestos` (vigente), cálculo `base × alícuota` editable, correlativo `RET-AÑO-NNNN`, descarga de certificado PDF.
- **`impuestos/pdf/CertificadoRetencionPDF.jsx`:** `@react-pdf/renderer`, import dinámico (code-split confirmado en build). Agente de retención + sujeto retenido + detalle + monto destacado.
- **`useNotifications.js`:** recordatorio "Retenciones practicadas este mes: $X" (nivel info, seccion `impuestos`).

**Verificación:** build de producción verde (3126 módulos, `CertificadoRetencionPDF` en chunk lazy propio). Columnas/tablas/RPC confirmadas en DB vía MCP.

**Convenciones nuevas:**
- **IVA snapshot:** la alícuota se captura en `comprobante_items.alicuota_iva` al vender — si después cambia la del producto, el histórico no se altera. Cálculo: subtotal incluye IVA → `neto = subtotal/(1+factor)`.
- **Fallback 21% en todos lados:** comprobantes/productos/compras sin alícuota → 21% (nunca rompe lo existente). Usar `COALESCE`/`?? '21'`.
- **Migraciones renumeradas:** ante colisión, verificar `list_migrations` en Supabase antes de numerar. Próxima libre: **035**.

### Sesión 2026-06-11 (noche) — Testeo funcional completo + fixes integrales

**Objetivo:** testeo manual de toda la app sección por sección, corregir todos los errores encontrados sobre la marcha, y dejar el sistema operativo end-to-end.

**Bugs detectados y fixes aplicados:**

1. **FK violations sistémicas — `tenant_id` apuntaba a `profiles(id)` pero el código inserta `empresa_id`**
   - Síntomas: error al **crear venta** (`comprobantes_tenant_id_fkey`), error al **abrir caja** (`caja_sesiones_tenant_id_fkey`).
   - Causa raíz doble:
     - **DB:** 3 FK apuntaban a `profiles(id)` cuando el código siempre inserta el `empresa_id`.
     - **App:** `SupabaseAuthContext.jsx` seteaba `tenant_id = currentSession.user.id` (profile UUID), no el empresa_id.
   - Fix DB: migration 029 — DROP constraints (comprobantes, caja_sesiones, movimientos_inventario) → UPDATE filas existentes para mappear profile→empresa → ADD constraints apuntando a `empresas(id)`.
   - Fix App: [src/contexts/SupabaseAuthContext.jsx:85](src/contexts/SupabaseAuthContext.jsx:85) — `const tenantId = empresaId` (no `user.id`).

2. **Hora con 3h de desfase (UTC vs Argentina UTC-3) en toda la app**
   - Causa: componentes usaban `toLocaleString()`/`toLocaleDateString()` sin pasar `timeZone`. Como las fechas se guardan AR-local-as-UTC, mostraban UTC literal.
   - Fix: helpers nuevos en [src/lib/dateUtils.js](src/lib/dateUtils.js):
     ```js
     formatTimeAR(isoStr)         // "HH:MM" via getUTCHours/getUTCMinutes
     formatDateLocaleAR(isoStr, options)  // locale-safe via UTC parts
     ```
   - Reemplazo `toLocaleString()` → `formatDateAR/formatTimeAR/formatDateTimeAR` en 17 archivos:
     - `src/components/ventas/ComprobantePrintModal.jsx`, `SaleDetailModal.jsx`, `HistorialVentas.jsx`, `CompraDetailModal.jsx`, `pdf/ComprobantePDF.jsx`
     - `src/components/sections/ComprasSection.jsx`, `ClientDetailModal.jsx`, `ReportesSection.jsx`, `ProveedoresSection.jsx`, `CotizacionesSection.jsx`, `CuentasBancariasSection.jsx`
     - `src/components/sections/UsuariosSection.jsx` (este usa real UTC de Supabase auth, así que se le pasó `timeZone: 'America/Argentina/Buenos_Aires'` explícito)
     - `src/components/CommandPalette.jsx`, `src/components/reportes/ReporteParidad.jsx`
     - `src/services/proveedoresService.ts`, `listaPreciosService.ts` (`new Date().toISOString()` → `getNowAR().toISOString()`)

3. **Compras sin columnas `moneda` / `tipo_cambio_tasa`** — el código las inserta pero la tabla no las tenía.
   - Fix: migrations 030 (moneda text DEFAULT 'ARS') + 031 (tipo_cambio_tasa numeric DEFAULT 1) + NOTIFY pgrst.

4. **ChequesSection: `column comprobantes.created_at does not exist`**
   - Causa: query en [ChequesSection.jsx:165](src/components/sections/ChequesSection.jsx:165) ordenaba por `created_at`, columna que no existe en `comprobantes`.
   - Fix: cambiar `.order('created_at', ...)` → `.order('fecha', ...)`.

5. **NuevaVentaModal: productos no cargan al abrir el modal (hay que cerrarlo y reabrirlo)**
   - Causa: race condition entre dos useEffects. El effect de búsqueda fira con `productSearch=''` y carga 30 productos; en paralelo, `init()` espera el fetch de clientes y después ejecuta `setProducts([])` — vaciando los productos recién cargados. `resetForm()` setea `productSearch=''` sin cambio → no re-dispara.
   - Fix: remover `setProducts([])` de `init()` en [NuevaVentaModal.jsx:88](src/components/ventas/NuevaVentaModal.jsx:88).

6. **Radix Dialog warnings de accesibilidad** en Plan de Cuentas
   - Fix: agregar `<DialogDescription>` a los modales "Nueva Cuenta" (línea 162) y "Nuevo Asiento Contable" (línea 296) en [PlanCuentasSection.jsx](src/components/sections/PlanCuentasSection.jsx).

7. **Logo de la app vs logo de empresa se confunden**
   - Cambio UX: reemplazo del logo box gradiente + texto "KAIROX" grande blanco por imagen real de Kairox + texto "Kairox" pequeño gris semibold con opacidad 85% (100% on hover) en [Sidebar.jsx:58-66](src/components/Sidebar.jsx:58).
   - Imagen guardada en `public/kairox-logo.png`.

**Testeo manual realizado (todas las secciones OK):**

Dashboard, Inventario (productos + Historial Movimientos), Ventas (Nueva + Historial), Cotizaciones, Pedidos, Listas de Precios, Compras (Historial + Nueva), Órdenes de Compra, Caja (Movimientos + Nuevo Movimiento + Reporte Histórico), Bancos (Cuentas + Movimientos + Conciliación), Cheques (Cartera Terceros + Propios), Clientes (lista + modal detalle), Cta. Corriente (Clientes + Antigüedad de Deuda), Contabilidad (Plan + Asientos + Balance + Libro Mayor + Períodos), Reportes (Centro + Reporte de Ventas con PDF), Usuarios, Configuración (Datos Generales + Moneda Paralela + AFIP).

**Convenciones nuevas / refuerzos:**
- **`tenant_id` en tablas multi-tenant SIEMPRE = `empresa_id`** — la FK apunta a `empresas(id)`. NO usar `user.id` (profile UUID) como tenant_id. Si aparece una tabla nueva con `tenant_id`, verificar que la FK apunte a `empresas(id)`.
- **Display de fechas/horas:** siempre `formatDateAR`/`formatTimeAR`/`formatDateTimeAR` de `dateUtils.js`. Nunca `toLocaleString()` o `toLocaleDateString()` sin timezone explícito.
- **Race conditions en modales con doble useEffect:** cuando un modal tiene un effect de "init" y otro de "search", no setear arrays vacíos en el init si el search ya los carga. El init solo debe cargar lo suyo (clientes, configs, etc.).
- **Modales de Radix:** todos los `DialogContent` deben tener `DialogTitle` Y `DialogDescription` (warning de accesibilidad si falta description).

---

### Sesión 2026-06-10 — TM Checks: Gestión de Cheques
**Branch:** `master` (commit `5669091`)

**Objetivo:** módulo completo de gestión de cheques de terceros y propios (SAP TM Checks). Solo registro en esta fase — no genera movimientos contables automáticos.

**Implementado:**

1. **Migration 028** ([migrations/028_cheques.sql](migrations/028_cheques.sql)):
   - Tabla `cheques`: tipo (propio/tercero), numero, banco, cuenta_bancaria_id, monto, fecha_emision, fecha_vencimiento, moneda (default ARS), cliente_id, proveedor_id, concepto, estado (8 valores CHECK), observaciones, comprobante_id, compra_id. RLS por `get_my_empresa_id()`.
   - Tabla `cheques_historial`: cheque_id, empresa_id, user_id, estado_anterior, estado_nuevo, observacion, fecha. RLS ídem.
   - 3 índices: `idx_cheques_empresa_tipo`, `idx_cheques_empresa_estado`, `idx_cheques_vencimiento` (parcial WHERE NOT cobrado/rechazado).

2. **`src/components/sections/ChequesSection.jsx`** — CREADO (~400 líneas):
   - KPI cards: En cartera (terceros activos), Propios pendientes, Vencen esta semana, Total cartera ARS.
   - Dos tabs: **Cartera de Terceros** (estados: `en_cartera → depositado/endosado/descontado/rechazado → cobrado/rechazado`) y **Cheques Propios** (estados: `pendiente → entregado/rechazado → cobrado/rechazado`).
   - Modales "Registrar cheque de tercero" y "Registrar cheque propio" con carga reactiva de comprobantes/compras via `useEffect` al seleccionar cliente/proveedor.
   - Modal de cambio de estado: mapa `TRANSICIONES` por estado actual, registra en `cheques_historial` vía `registrarHistorial()`.
   - `renderFechaVto()`: ícono Clock ámbar (vence ≤7d) o rojo (vencido).
   - Cheques rechazados: visibles con `bg-red-500/5`, nunca ocultos.

3. **`src/hooks/useNotifications.js`** — nuevo query `chequesProximos` (7 días, usando `getTodayAR()` + `addDays()`). Ítem al principio del array `items` con `nivel: 'advertencia'`, `seccion: 'cheques'`.

4. **`src/components/Sidebar.jsx`** — import `FileCheck` + entrada `{ id: 'cheques', label: 'Cheques', icon: FileCheck }` después de bancos.

5. **`src/components/Dashboard.jsx`** — import `ChequesSection` + `case 'cheques': return <ChequesSection />;`.

**Convenciones nuevas:**
- `addDays(dateStr, days)`: `new Date(new Date(dateStr + 'T00:00:00Z').getTime() + days * 86400000).toISOString().split('T')[0]` — aritmética de fechas timezone-safe sin desfase DST.
- Cheques rechazados: siempre visibles con tinte rojo — nunca filtrar estados finales de la lista.
- Módulo solo de registro en Fase 1 — no genera asientos contables.

---

### Sesión 2026-06-10 — FI Period Close: Cierre formal de períodos contables
**Branch:** `master` (commit `81c2566`)

**Objetivo:** cierre formal de períodos contables (SAP FI Period Close) — admin crea y cierra períodos; asientos en fecha de período cerrado quedan bloqueados.

**Implementado:**

1. **Migration 027** ([migrations/027_cierre_periodos.sql](migrations/027_cierre_periodos.sql)):
   - DO block defensivo al inicio: si la tabla existía sin columna `estado` (intento fallido previo), la elimina antes de recrear.
   - Tabla `periodos_contables`: empresa_id, nombre, fecha_inicio DATE, fecha_cierre DATE, estado CHECK('abierto'/'cerrado'), cerrado_por UUID→profiles, fecha_cierre_real TIMESTAMPTZ, observaciones. CHECK constraint `fecha_cierre >= fecha_inicio`.
   - RLS: 3 policies en DO blocks idempotentes (SELECT/INSERT/UPDATE) por `get_my_empresa_id()`.
   - Índice `idx_periodos_empresa_estado`.
   - RPC `fecha_en_periodo_cerrado(p_empresa_id UUID, p_fecha DATE) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public`.

2. **`src/components/sections/PlanCuentasSection.jsx`** — nueva 5ª tab **Períodos** con componente `TabPeriodos`:
   - Admin-only: botón "Nuevo período" + botón "Cerrar" por fila abierta.
   - Al cerrar: cuenta asientos en rango (`asientos_contables` con `.gte/.lte` por fecha) para informar al admin, luego UPDATE `estado='cerrado'`, `cerrado_por`, `fecha_cierre_real`.
   - Tabla: nombre, fecha inicio, fecha cierre, estado badge (verde abierto / gris cerrado), fecha de cierre real.
   - Dos dialogs: crear período nuevo + confirmar cierre.
   - Imports agregados: `Lock` (lucide-react), `supabase` de `customSupabaseClient`, `useEffect`.

3. **`src/services/planCuentasService.ts`** — check de período en `crearAsientoVenta` y `crearAsientoCompra`:
   ```typescript
   try {
     const { data: cerrado, error: rpcErr } = await supabase.rpc('fecha_en_periodo_cerrado', {
       p_empresa_id: empresaId, p_fecha: params.fecha,
     });
     if (rpcErr) { console.warn('[asientosAutoService] período check failed:', rpcErr.message); }
     else if (cerrado) { throw new Error(`Período cerrado: la fecha ${params.fecha} pertenece a un período contable cerrado.`); }
   } catch (e: any) {
     if (e.message?.startsWith('Período cerrado:')) throw e;
     console.warn('[asientosAutoService] período check error:', e);
   }
   ```

**Convenciones nuevas:**
- `fecha_en_periodo_cerrado` recibe DATE (YYYY-MM-DD), no TIMESTAMPTZ.
- Check en `asientosAutoService` es **no-crítico**: errores de RPC nunca bloquean una venta; solo la respuesta deliberada `true` bloquea.
- Cierre no-destructivo: cerrar un período NO modifica ni borra asientos existentes, solo bloquea nuevos.
- Admin-only: siempre verificar `user.role === 'admin'` antes de crear o cerrar períodos.

---

### Sesión 2026-06-10 — Onboarding Wizard + Checklist de configuración inicial
**Branch:** `master` (commit `288653b`)

**Objetivo:** guiar a nuevas empresas a través de la configuración inicial del sistema con un wizard modal + checklist de pasos.

**Implementado:**

1. **Migration 026** ([migrations/026_onboarding.sql](migrations/026_onboarding.sql)):
   - Columna `onboarding_completado BOOLEAN DEFAULT false` en tabla `empresas`.

2. **`src/components/OnboardingWizard.jsx`** — CREADO:
   - Dialog modal que se abre automáticamente si `empresa.onboarding_completado = false`.
   - Props: `open`, `onComplete`.
   - Al completar: UPDATE `empresas SET onboarding_completado = true` + llama `onComplete()`.

3. **`src/components/ChecklistOnboarding.jsx`** — CREADO:
   - Checklist de pasos de configuración inicial (datos empresa, primer producto, primer cliente, etc.).
   - Integrado dentro del wizard o como panel standalone.

4. **`src/components/Dashboard.jsx`** — MODIFICADO:
   - `useEffect` que consulta `empresas.onboarding_completado` al montar.
   - Si `false` → `setShowOnboarding(true)`.
   - Renderiza `<OnboardingWizard open={showOnboarding} onComplete={() => setShowOnboarding(false)} />`.

---

### Sesión 2026-06-10 — AFIP/ARCA Fase 5: Libro IVA Ventas digital
**Branch:** `master` (commit `93ac3c6`)

**Objetivo:** generar el Libro IVA Ventas digital requerido por ARCA para empresas con factura electrónica activa.

**Implementado:**
- Nuevo reporte/sección "Libro IVA Ventas" accessible desde Reportes o Contabilidad.
- Filtro por período (fecha desde/hasta).
- Columnas: Fecha | Tipo comprobante | Número AFIP | Cliente | CUIT | Condición IVA | Neto gravado | IVA 21% | Total | CAE.
- Export CSV compatible con el formato requerido por ARCA.
- Solo muestra comprobantes con `usa_factura_electronica = true` y `cae_estado = 'emitido'`.

---

### Sesión 2026-06-10 — AFIP/ARCA Fase 4: PDF con QR fiscal (RG 4291/2018)
**Branch:** `master` (commit `e125dd0`)

**Objetivo:** incluir el QR fiscal obligatorio (RG AFIP 4291/2018) en el PDF del comprobante impreso.

**Implementado:**
- `ComprobantePrintModal.jsx` / componente PDF de `@react-pdf/renderer`: bloque QR en el pie de página del comprobante cuando `comprobante.cae` está presente.
- QR encodes la URL del verificador AFIP: `https://www.afip.gob.ar/fe/qr/?p=<base64_del_json>` donde el JSON incluye cuit, tipo, punto_venta, numero_afip, nro_doc_receptor, importe, moneda, ctz, fecha, cae, vto.
- Fix de compatibilidad `@react-pdf/renderer` v4: propiedades shorthand (`padding: '5 8'`, `borderRadius: '3 3 0 0'`) NO funcionan — reemplazadas por `paddingVertical`/`paddingHorizontal` y `borderTopLeftRadius`/`borderTopRightRadius` individualmente.

**Convención nueva:**
- `@react-pdf/renderer` v4: nunca usar shorthands CSS multi-valor. Usar siempre propiedades individuales.

---

### Sesión 2026-06-10 — AFIP/ARCA Fase 3: Integración CAE en flujo post-venta
**Branch:** `master` (commit `6a8cca8`)

**Objetivo:** llamar automáticamente a `emitir-cae` después de confirmar una venta cuando `empresa.usa_factura_electronica = true`.

**Implementado:**
- `NuevaVentaModal.jsx` (o `ventasService.ts`): tras el RPC `crear_venta` exitoso, si `empresa.usa_factura_electronica`, llama `afipService.emitirCAE(comprobante_id)` de forma fire-and-forget (no bloquea el flujo de venta).
- Si falla: `cae_estado` queda en `'error'` en DB → aparece en notificación "facturas sin CAE" de `useNotifications`.
- Si éxito: guarda `cae`, `cae_vencimiento`, `cae_estado = 'emitido'`, `numero_afip`, en `comprobantes`.
- IVA por ítem: `comprobante_items` usado para calcular base imponible y monto IVA por alícuota (21% por defecto en Fase 3).
- Verificación con certificado real en homologación ARCA completada.

**Pendientes Fases 3-5:**
- ⚠️ IVA diferencial (10.5%, 27%) — hardcodeado 21% en Fase 3.
- ⚠️ Comprobantes tipo A (responsables inscriptos) — requiere datos CUIT receptor válidos.
- ⏳ Reintento masivo CAEs pendientes — `afipService.reintentarCAEsPendientes()` implementado pero sin UI.

---

### Sesión 2026-06-10 (noche) — Cierre de pendientes detectados en testing
**Branch:** `master` (commit directo)

**Objetivo:** resolver los pendientes que el equipo detectó en la sesión de testing "noche" del 09-jun y quedaron sin corregir.

**Fixes aplicados:**

1. **Invalidación de notifs en CC y Caja** (pendiente ⚠️ de sesión 09-jun):
   - [CuentaCorrienteSection.jsx](src/components/sections/CuentaCorrienteSection.jsx) — `useQueryClient` + `invalidateNotifs()` tras cobro exitoso en `handleRegisterPayment` (la notif `deuda_vencida` consulta `cuenta_corriente_movimientos`).
   - [ClientDetailModal.jsx](src/components/sections/ClientDetailModal.jsx) — ídem tras su cobro rápido.
   - [CajaCierre.jsx](src/components/caja/CajaCierre.jsx) — invalidación tras `closeSession` exitoso (la notif `caja_sin_cerrar` consulta `cierre_fecha`).
   - Con esto el patrón `invalidateNotifs` queda completo en los 4 módulos que afectan notifs: Productos, OC, CC y Caja.

2. **ClientDetailModal — bugs de la misma clase ya corregidos en su hermano** (`2d8863f` solo cubrió CuentaCorrienteSection):
   - `parseFloat(paymentAmount)` → `parseNumberLocale()` (formato es-AR).
   - El cobro rápido ahora guarda `monto_paralelo` + `tc_paralelo` en ambos INSERTs vía `useTCParalelo()` (antes este camino perdía la cobertura del Reporte de Paridad).
   - Nota: el bloqueo por caja cerrada en este modal es CORRECTO (su cobro rápido es hardcodeado Efectivo).

3. **Docs Contabilidad corregidas** (pendiente ⚠️): la tabla de módulos decía "7 tabs" pero `PlanCuentasSection.jsx` tiene 4 (cuentas, asientos, balance, libro_mayor). Actualizado a la realidad; P&L, Balance General y Períodos quedan como roadmap.

**Pendientes que siguen abiertos:**
- ⚠️ **BRL TC corrupto (tasa 3.6 del 08-jun)** — el DELETE en producción requiere autorización del usuario. SQL listo: `DELETE FROM tipos_cambio WHERE moneda = 'BRL' AND tasa = 3.6;` — al borrarlo, el sistema vuelve a pedir el TC con el modal (flujo correcto).
- ⚠️ **Tests automatizados** — sigue sin haber ninguno; proyecto aparte.
- ⏳ **Implementar P&L / Balance General / Períodos** en Contabilidad (feature, no bug).
- ⏳ Continuar TESTING_2026-06-10.md desde el punto 1.

### Sesión 2026-06-10 (tarde — Nadia) — Fix crítico crear_venta + UX POS
**Branch:** `master` (commit directo)

**Contexto:** arrancamos el plan de testing TESTING_2026-06-10.md y al llegar al primer test (crear venta) el RPC `crear_venta` rompía con error PostgreSQL `42703: column "user_id" of relation "comprobantes" does not exist`.

**Bugs corregidos:**

1. **RPC `crear_venta` referenciaba columna inexistente** ([migrations/024_rpc_crear_venta.sql](migrations/024_rpc_crear_venta.sql)):
   - El INSERT a `comprobantes` incluía `user_id` que NO existe en esa tabla (verificado contra schema real: columnas son `id, empresa_id, tenant_id, cliente_id, numero_venta, ...` SIN `user_id`).
   - Fix: removido `user_id` y el `p_user_id` correspondiente del INSERT a comprobantes. Se sigue usando para `movimientos_caja` y `cuenta_corriente_movimientos` (que sí lo tienen).
   - Migration aplicada en DB: `fix_crear_venta_sin_user_id_en_comprobantes`.

2. **POS — dropdown productos pedía mínimo 2 caracteres** ([NuevaVentaModal.jsx](src/components/ventas/NuevaVentaModal.jsx)):
   - El query server-side solo se disparaba con `productSearch.length >= 2` → al hacer focus el dropdown estaba vacío con mensaje "Escribí al menos 2 caracteres".
   - Fix: con query vacío trae los primeros 30 productos del servidor (debounce 0ms cuando vacío, 300ms cuando hay texto).
   - Placeholder cambiado a "Buscar producto o elegí de la lista...".

**Cambios en DB:**
- 1 migration aplicada: `fix_crear_venta_sin_user_id_en_comprobantes` (CREATE OR REPLACE FUNCTION).

**Pendiente para próxima sesión:**
- Continuar con TESTING_2026-06-10.md desde el punto 1 (TC obligatorio en Compras) ahora que `crear_venta` anda.
- Verificar también que la búsqueda server-side en el dropdown del POS no tenga regresiones.

### Sesión 2026-06-10 — AFIP/ARCA Fase 2: Wizard de activación UI
**Branch:** `feat/afip-fase2` → merge a `master`

**Objetivo:** UI de activación de Factura Electrónica en `ConfiguracionSection.jsx` (wizard 3 pasos). Scope Fase 2 = solo UI de activación; NO se integra en el flujo de venta (eso es Fase 3).

#### 1. `generar-csr` v2 — acción `store_cert` agregada (redeploy, ACTIVE)
- La función ahora rutea por `body.action`: `generate` (default, par RSA + CSR como en Fase 1) y `store_cert` (guarda el `.crt` subido por el usuario en Vault como `afip_cert_<empresa_id>`).
- `store_cert` valida que el contenido incluya `CERTIFICATE` antes de guardar. `empresa_id` se deriva del perfil verificado (verifyAdmin), no del body.

#### 2. `ConfiguracionSection.jsx` — sección AFIP + wizard
- **Card AFIP** después de Moneda Paralela: Switch + chips de estado (CUIT/condición IVA/punto de venta cuando está completa; aviso ámbar + botón "Completar configuración" cuando falta).
- **Wizard Dialog 3 pasos** con stepper visual: (1) datos fiscales CUIT + condición IVA, (2) certificado — generar CSR → descargar → instrucciones ARCA → subir `.crt`, (3) punto de venta + tipo de comprobante default.
- **Handlers:** `handleGenerarCSR` (invoke generar-csr), `handleDescargarCSR` (blob download), `handleCertUpload` (FileReader→text), `handleGuardarConfigAFIP` (store_cert + update empresas + upsert puntos_venta), `handleToggleAFIP` (abre wizard si falta config, alterna flag si ya está).
- **Adaptado a las convenciones reales del archivo:** usa estado local + `useEffect` + queries directas a Supabase (patrón de la card Moneda Paralela), NO TanStack Query/`queryClient` como sugería el spec. CUIT se guarda sin guiones (`afip_cuit`) pero se muestra formateado con `formatCuit()`. Wizard resetea a paso 1 al reabrir.

**Pendientes (siguen para Fase 3):** integrar `emitirCAE()` en el flujo post-venta, verificación con `.crt` real en homologación, IVA por item, Libro IVA, impresión de CAE/QR en comprobante.

### Sesión 2026-06-10 — AFIP/ARCA Fase 1: infraestructura + Edge Functions homologación
**Branch:** `feat/afip-fase1` → merge a `master`

**Objetivo:** infraestructura base para Factura Electrónica vía WSFE de ARCA (ex-AFIP). Scope Fase 1 = solo infra + homologación (sandbox). NO se toca el flujo de venta productivo (eso es Fase 3).

#### 1. Migration 025 — infraestructura (aplicada via MCP)
- `empresas`: `usa_factura_electronica`, `condicion_iva` (RI|Monotributo|Exento|CF), `afip_cuit`, `afip_ticket_acceso`, `afip_ticket_expira`.
- `clientes`: `condicion_iva` (el doc del receptor usa el campo existente `documento` — NO existe `cuit` en clientes).
- Tabla nueva `puntos_venta` (RLS por `get_my_empresa_id()`): `numero` AFIP, correlativos `ultimo_numero_a/b/c`, `tipo_comprobante_default`.
- `comprobantes`: `cae`, `cae_vencimiento` (DATE), `cae_estado` (no_aplica|pendiente|emitido|error), `tipo_comprobante_afip` (A|B|C|E), `numero_afip`, `punto_venta_id`, `error_afip`.
- **Vault wrappers** (`vault_secret_upsert`/`vault_secret_read`): SECURITY DEFINER sobre `vault.create_secret`/`vault.decrypted_secrets`. Las RPCs `vault_secret_*` del spec original NO existían en Supabase → se crearon. `REVOKE` a public/anon/authenticated, `GRANT EXECUTE` solo a `service_role`. Round-trip encrypt/decrypt verificado.

#### 2. Edge Function `generar-csr` (v1, ACTIVE) — `supabase/functions/generar-csr/index.ts`
- Genera par RSA-2048 (Web Crypto) + CSR PKCS#10 con `@peculiar/x509` (compatible con Deno/Edge, vía esm.sh).
- Subject DN AFIP: `C=AR, O=<razón>, CN=<razón>, serialNumber=CUIT <cuit>`.
- Guarda la clave privada en Vault (`afip_key_<empresa_id>`) — NUNCA sale al frontend. Devuelve solo el `.csr` para subir a ARCA.
- Auth: `verifyAdmin(req)` + `empresa_id` derivado del perfil verificado (no se confía en el body). Boot verificado (401 sin token).

#### 3. Edge Function `emitir-cae` (v2, ACTIVE) — `supabase/functions/emitir-cae/index.ts`
- Recibe `comprobante_id` → lee cert+clave de Vault → llama a ARCA (WSFE) vía `@nicoo01x/arca-sdk` → guarda CAE + incrementa correlativo del punto de venta.
- **Hallazgo de runtime:** importar el SDK a nivel top-level causa **BOOT_ERROR** (depende de `soap`, paquete Node-only que no carga en Deno Edge). **Fix:** import DINÁMICO (`await import('npm:@nicoo01x/arca-sdk@3')`) justo antes de emitir → la función bootea, autentica, lee Vault y solo carga el SDK en la ruta de emisión real. v1 falló boot, v2 bootea OK (401 verificado).
- Adaptaciones vs. spec: consultas separadas (sin embedded selects que requieren FK), `clientes.documento` en vez de `cuit`, fix del doble `await req.json()` (se captura `comprobante_id` en scope externo).
- IVA hardcodeado 21% (Fase 1). Ambiente default `sandbox` (env `AFIP_ENVIRONMENT` opcional; en producción setear `=production`).

#### 4. Frontend `src/services/afipService.ts`
- `generarCSR(cuit, razonSocial)`, `emitirCAE(comprobante_id)`, `reintentarCAEsPendientes(empresa_id)` (procesa pendiente|error, rate-limit 500ms).

**Convenciones nuevas:**
- **SDKs npm Node-only en Edge Functions:** si un paquete depende de `soap`/módulos Node que no cargan en Deno, importarlo DINÁMICAMENTE (`await import()`) dentro del handler, nunca top-level — así la función bootea y el fallo se aísla a su ruta de uso.
- **Secretos (certificados, claves):** SIEMPRE en Supabase Vault vía `vault_secret_upsert`/`vault_secret_read` (service_role). Nunca en columnas de tablas normales.
- **AFIP doc receptor:** usar `clientes.documento`. 11 dígitos → CUIT (80), 7-8 → DNI (96), vacío → Consumidor Final (99).

**Pendientes Fase 1 / próximas fases:**
- ⏳ Flujo de carga del `.crt` emitido por ARCA → guardar en Vault como `afip_cert_<empresa_id>` (UI + endpoint, no implementado aún).
- ⏳ UI de configuración AFIP (toggle factura electrónica, CUIT, condición IVA, alta de punto de venta) en ConfiguracionSection.
- ⚠️ Shape exacto de `createInvoice` del SDK sin verificar contra ejecución real (requiere cert válido). Validar en homologación cuando haya `.crt`.
- ⚠️ Compatibilidad runtime del SDK en Deno sin verificar (boot OK; la llamada real a ARCA puede fallar por `soap`). Plan B si falla: implementar WSAA+WSFE con SOAP/XML manual o usar afipsdk.com.
- ⏳ (Opcional) setear secret `AFIP_ENVIRONMENT=sandbox` en Dashboard — el código ya defaultea a sandbox sin él.

### Sesión 2026-06-09 (PM·4) — RPC transaccional `crear_venta` + moneda paralela en CuentaCorrienteSection
**Branch:** `master`

#### 1. RPC transaccional `crear_venta` (migration 024)
**Problema:** `handleConfirmSale()` en `NuevaVentaModal.jsx` ejecutaba 6 operaciones secuenciales sin transacción (comprobante → items → stock → mov_inventario → caja → CC). Si fallaba cualquiera de las 2-6, el sistema quedaba inconsistente (ej: comprobante sin stock descontado).

**Solución:** RPC `crear_venta` que encapsula todo en una transacción atómica con rollback automático. Recibe items/pagos como `JSONB`, descuenta stock con `SELECT ... FOR UPDATE` (lock anti-race-condition), valida `p_empresa_id = get_my_empresa_id()` al inicio. `SECURITY DEFINER` + `SET search_path = public`.

**Verificaciones de schema reales (DB) que difirieron del spec original:**
- `comprobante_items` usa columnas en **ESPAÑOL** (`producto_id`, `cantidad`), NO portugués (`produto_id`/`quantidade`). El schema fue migrado en algún momento.
- `movimientos_inventario` **NO tiene `user_id`** — sí `tenant_id` (legacy nullable). La RPC omite user_id y setea `tenant_id = p_empresa_id`.
- CHECK constraints validados: `movimientos_inventario.tipo` ∈ (entrada|salida|ajuste), `movimientos_caja.tipo` ∈ (ingreso|egreso), `cuenta_corriente_movimientos.tipo` ∈ (DEBE|HABER), `comprobantes.tipo` ∈ (venta|nota_credito), `comprobantes.estado_pago` ∈ (pagada|pendiente|parcial|cancelada).

**Frontend (`NuevaVentaModal.jsx`):** las 6 operaciones secuenciales reemplazadas por una sola llamada `supabase.rpc('crear_venta', {...})`. Se mantienen intactas: validaciones previas (carrito, TC, sesión viva, límite crédito, pre-check stock), `generateVentaNumber()`, asiento contable fire-and-forget (FUERA de la transacción), modal de impresión, callbacks `onSaleSuccess`/`onConvertSuccess`. Se agregó `useCaja()` para enlazar `caja_sesion_id` en los movimientos de caja (antes quedaba null). Los pagos paralelos van como `''` en el payload para que `NULLIF(...,'')` del SQL resuelva a NULL.

**Convención nueva:** ventas siempre vía RPC `crear_venta` — nunca INSERTs secuenciales desde el frontend. Pasar `monto_paralelo`/`tc_paralelo` como string vacío `''` (no null) en arrays JSONB cuando aplique NULLIF en el SQL.

#### 2. Moneda paralela + bugs en CuentaCorrienteSection (commit `2d8863f`)
- Bug `parseFloat` → `parseNumberLocale()` en cobro CC. Input monto `type=number`→`type=text inputMode=decimal`.
- Botón cobro en tabla ya no bloquea por caja cerrada (solo Efectivo lo requiere, verificado en handler).
- Moneda paralela: equivalente `≈ X USD/EUR` en KPI Total Deuda, columna Saldo de la tabla y dialog de cobro rápido. Todo condicionado a `tcParalelo.enabled && tcParalelo.tcHoy`.

---

### Sesión 2026-06-09 (PM·3) — Aging Open Item por comprobante + Deploy Edge Functions CORS + Fix timezone/timestamp
**Branch:** `master` (commits: `5b19a59`, `16f96c6`)

#### 1. Aging refactor — Open Item Management por comprobante individual (commit `5b19a59`)
**Archivo:** `src/components/sections/CuentaCorrienteSection.jsx`

**Problema:** el `fetchAgingData()` anterior tomaba el movimiento DEBE más antiguo por cliente (incluso si ya había sido cancelado), lo que causaba falsos positivos: clientes con deuda vieja pagada y deuda nueva reciente aparecían en banda +90 días incorrectamente.

**Solución (SAP FI Open Item Management):** cada fila de la tabla = un `comprobante` con `estado_pago = 'pendiente'`, `tipo = 'venta'`, y `cliente_id IS NOT NULL`. La antigüedad se calcula desde `comprobante.fecha` hasta `getNowAR()`. Cada comprobante tiene su propia banda y color.

**Cambios:**
- `fetchAgingData()` completamente reescrito: query directa a `comprobantes` con filtros `estado_pago='pendiente'`, `tipo='venta'`, `.not('cliente_id', 'is', null)`.
- `agingBandas` useMemo: suma `comp.total` (no `c.saldo_actual`), cuenta comprobantes no clientes.
- Cards UI: "comprobante(s)" en lugar de "cliente(s)".
- Tabla: 7 columnas — Comprobante | Cliente | Monto | Fecha | Antigüedad | Banda | Acciones.
- Tbody: key=`comp.comprobante_id`, muestra `formatDateAR(comp.fecha)`, `comp.cliente_nombre`, `comp.total`.
- Botón ojo: `setSelectedClient({ id: comp.cliente_id, nombre: comp.cliente_nombre })`.
- `colSpan` actualizado 5→7 en skeleton y empty state.

#### 2. Deploy Edge Functions CORS (sin commit de código — ya estaba correcto)
**Funciones desplegadas vía MCP Supabase (`wuznppxeonmhfcvnqfbf`):**
- `create-user` → versión 3, status ACTIVE
- `invite-user` → versión 3, status ACTIVE
- `delete-user` → versión 2, status ACTIVE

**Código ya correcto en `supabase/functions/_shared/auth.ts`:**
- `ALLOWED_ORIGINS`: Set con producción + localhost:3000/3001/5173 + 127.0.0.1:3000/3001/5173.
- `buildCorsHeaders(req)`: refleja el `Origin` del request si está en la whitelist; incluye `Vary: Origin`.
- `errorResponse()` y `okResponse()` aceptan `req` y usan `buildCorsHeaders(req)`.
- `verify_jwt: false` en el deploy (las funciones implementan auth propia con `verifyAdmin()`).

#### 3. Fix timezone / timestamp malformado (commit `16f96c6`)
**Problema raíz:** el sistema usa "AR-local-as-UTC" — `getNowAR()` resta 3h del UTC real para que `getUTC*()` devuelva hora Argentina. Las fechas deben manejarse con ese shift, nunca con `Date.now()` real ni `new Date(T00:00:00)` (browser-tz-dependent).

**Archivos corregidos:**

- **`src/hooks/useNotifications.js`:**
  - `hace30dias`: `new Date(Date.now() - 30*86400000)` → `new Date(getNowAR().getTime() - 30*86400000)` (TIMESTAMPTZ filter, alineado con AR-as-UTC)
  - `hace24h`: mismo patrón para filtro `caja_sesiones.apertura_fecha`
  - `import { getNowAR } from '@/lib/dateUtils'` agregado

- **`src/components/reportes/ReporteParidad.jsx`:**
  - Estado inicial: `new Date().toISOString().split('T')[0]` → `getTodayAR()` (evita fecha UTC en lugar de AR)
  - `firstOfMonth`: `new Date(year, month, 1).toISOString()` → `todayStr.slice(0, 7) + '-01'`
  - ISO para filtro `comprobantes.fecha` (TIMESTAMPTZ): `new Date(\`${date}T00:00:00\`).toISOString()` (browser-tz-dependent) → `` `${date}T00:00:00.000Z` `` (AR-local-as-UTC correcto)
  - `import { getTodayAR } from '@/lib/dateUtils'` agregado

- **`src/services/tipoCambioService.ts`:**
  - Import corregido: `@/lib/supabase` (no existía) → `@/lib/customSupabaseClient`
  - `new Date().toISOString().slice(0,10)` → `getTodayAR()` en `getTasaVigente()`
  - Nota: archivo efectivamente dead code (Vite resuelve `.js` antes que `.ts`), pero se corrige para evitar build issues futuros.

**Convenciones nuevas confirmadas:**
- **AR-local-as-UTC:** nunca `Date.now()` para filtros TIMESTAMPTZ; siempre `getNowAR().getTime()`.
- **ISO para TIMESTAMPTZ:** nunca `` new Date(`${date}T00:00:00`).toISOString() `` (agrega tz browser); siempre `` `${date}T00:00:00.000Z` ``.
- **ISO para DATE columns:** siempre YYYY-MM-DD string puro, nunca ISO completo.
- **Fecha AR hoy:** `getTodayAR()` de `dateUtils.js`, nunca `new Date().toISOString().slice(0,10)`.

---

### Sesión 2026-06-09 (noche) — Testing manual completo + 20 bugs corregidos + 2 cambios DB
**Branch:** `master` (commits directos)
**Trabajo en pareja:** Nadia (testing manual módulo por módulo) + Claude (fixes inline)

**Filosofía de la sesión:** recorrido completo de TODOS los módulos del sidebar para encontrar y arreglar bugs en vivo. Se priorizó que CADA cosa que el usuario encontrara funcionara bien antes de pasar al siguiente módulo.

**Bugs corregidos (en orden de aparición):**

1. **Iconos calendario invisibles en modo oscuro** ([index.css](src/index.css)) — agregado bloque CSS con `color-scheme: dark !important` + `filter: invert(1) brightness(2)` en `::-webkit-calendar-picker-indicator` para inputs `date`/`time`/`datetime-local`/`month`/`week`. Aplica globalmente.

2. **Conversión moneda en venta — lógica completa** ([NuevaVentaModal.jsx](src/components/ventas/NuevaVentaModal.jsx), [ComprobantePrintModal.jsx](src/components/ventas/ComprobantePrintModal.jsx), [HistorialVentas.jsx](src/components/ventas/HistorialVentas.jsx)):
   - **Decisión de diseño**: productos SIEMPRE en ARS, ventas guardadas SIEMPRE en ARS, solo display convertido a moneda elegida.
   - Helper `totalEnMonedaSeleccionada()` divide por la tasa solo para mostrar al cliente.
   - Banner en modal: "Equivale a $X ARS (TC $Y)".
   - Ticket impreso: bloque con moneda cobrada + TC + equivalente cuando moneda ≠ ARS.
   - Historial: badge USD/EUR + equivalente debajo del total ARS.
   - Fix línea 283 NuevaVentaModal: `calculateTotal()` siempre devuelve ARS, sin multiplicar por tasa (era doble conversión).

3. **Carrito invisible en NuevaVentaModal** — agregado `min-h-0` en flex containers + `min-h-[200px]` en panel del carrito para que no colapse a 0 en flexbox.

4. **TC schema rota** ([tipoCambioService.js](src/services/tipoCambioService.js)) — la tabla `tipos_cambio` real NO tiene columnas `user_id` ni `updated_at`. Removidas del upsert (antes daba error 400).

5. **TC parser numérico — formato es-AR ESTRICTO** ([currencyUtils.js](src/lib/currencyUtils.js)):
   - Regla argentina: **`.` = miles, `,` = decimal**.
   - `parseNumberLocale()` simplificado: `s.replace(/\./g, '').replace(',', '.')`.
   - `"1.446"` → 1446, `"1.446,50"` → 1446.50, `"1668,21"` → 1668.21, `"0,0036"` → 0.0036.
   - Antes interpretaba `"1.446"` como decimal `1.446` (bug que corrompió datos).

6. **Datos TC corruptos en DB — corregidos vía SQL**:
   - `tipos_cambio`: USD 1.446 → 1446, EUR 1.668 → 1668, BRL 0.0036 → 3.6 (multiplicados por 1000).
   - `comprobantes` con `tipo_cambio_tasa` mal guardado (3 ventas: 20260608-002, -005, -009) también corregidas.

7. **TC inputs con placeholders es-AR** — TipoCambioModal, MonedaSelector, CuentasBancariasSection: placeholders ahora muestran `1.446,50` ó `500.000` (formato argentino) + nota explicativa: "punto = miles, coma = decimal".

8. **Cotizaciones UX** ([CotizacionesSection.jsx](src/components/sections/CotizacionesSection.jsx)):
   - Autocomplete cliente: dropdown con existentes + permite tipear nombre libre.
   - Buscador productos: dropdown se abre al focus (carga 200 productos en memoria, filtra local).
   - Cantidad step `0.001` → `1` (flechitas de 1 en 1).
   - Unidad con `<datalist id="unidades-medida">` (un, kg, g, l, ml, m, cm, m², m³, caja, paquete, docena, par, hora, día, servicio) + texto libre.

9. **Pedidos** ([PedidosSection.jsx](src/components/sections/PedidosSection.jsx)) — cantidad step `0.001` → `1`.

10. **Compras dropdown productos** ([ComprasSection.jsx](src/components/sections/ComprasSection.jsx)) — antes solo mostraba al tipear, ahora se abre al focus con los primeros 30 productos.

11. **Plan de Cuentas RPC `seed_plan_cuentas`** — recreado con `SECURITY DEFINER` + validación interna `p_empresa_id IS DISTINCT FROM get_my_empresa_id()` para mantener aislamiento multi-tenant. Migration aplicada.

12. **PlanCuentasSection `tenant_id` legacy** ([PlanCuentasSection.jsx:984](src/components/sections/PlanCuentasSection.jsx#L984)) — cambio `user?.tenant_id || user?.empresa_id` → solo `user?.empresa_id`. El field legacy `tenant_id` podía tener UUID viejo distinto de empresa_id, causando que la nueva validación del RPC rechazara la inicialización.

13. **SelectItem value="" → sentinel "\_\_none\_\_"** — Radix UI no permite SelectItem con string vacío (crash de toda la página). Arreglado en PlanCuentasSection (Cuenta padre) y CuentasBancariasSection (mapeo CSV). Patrón: usar sentinel y convertir a null/"" al guardar.

14. **Dropdown Cuenta padre con popper position** — Radix Select default era "item-aligned" → clippeaba items arriba/abajo. Cambiado a `position="popper"` + `sideOffset={4}` + ancho del trigger. Ahora abre siempre debajo del input.

15. **Auto-scroll molesto en dropdowns de plan** — `max-h-48` → `max-h-[400px]` para que entren ~14 items sin necesidad de hover scroll.

16. **Notificaciones cache stale** ([useNotifications.js](src/hooks/useNotifications.js)):
   - `staleTime: 5min` → `30s` + `refetchOnWindowFocus: true` + `refetchInterval: 60s`.
   - Invalidación manual en [ProductosSection.jsx](src/components/sections/ProductosSection.jsx) (después de crear/editar/ajustar stock/desactivar) y [OrdenesCompraSection.jsx](src/components/sections/OrdenesCompraSection.jsx) (cambio estado, cancelar, recibir).
   - Ya no quedan alertas "fantasma" después de resolver.

17. **Cobro CC fallaba con RLS 42501** ([ClientDetailModal.jsx](src/components/sections/ClientDetailModal.jsx)) — INSERT a `cuenta_corriente_movimientos` y `movimientos_caja` no mandaba `empresa_id`. La policy `cta_cte_empresa` lo rechazaba. Agregado `empresa_id: user.empresa_id` en ambos.

18. **Movimientos bancarios — validación silenciosa** ([CuentasBancariasSection.jsx](src/components/sections/CuentasBancariasSection.jsx)):
   - Antes: si faltaba cuenta, monto o monto=0 → `return` sin avisar nada. Usuario pensaba "no hace nada".
   - Ahora: toasts rojos específicos por cada caso.
   - Monto `type="number"` → `type="text" inputMode="decimal"` + `parseNumberLocale()`.
   - Cache invalidation fix: `qc.invalidateQueries({ queryKey: CB_KEYS.movimientos(empresaId) })` no matcheaba con queries que tenían filtros aplicados (array `[..., empresaId, filters]`). Cambiado a prefijo `['movimientos_bancarios', empresaId]`.

19. **Editar proveedor — warning inputs uncontrolled** ([ProveedoresSection.jsx](src/components/sections/ProveedoresSection.jsx)) — al editar proveedor con campos NULL en DB, los inputs recibían `value={null}`. Agregado sanitizador `Object.entries(prov).map(([k, v]) => [k, v ?? ''])` antes del `setForm`.

20. **Crear cliente perdía focus en cada tecla** ([ClientesSection.jsx](src/components/sections/ClientesSection.jsx)) — `ClientForm` estaba definido como componente DENTRO del padre. En cada `setState` del padre se creaba nueva referencia → React lo trataba como componente nuevo → desmontaba y remontaba TODO el form → focus perdido. Solución: renombrar a `renderClientForm` y usarlo como función `{renderClientForm({...})}` (no como `<ClientForm />`). Patrón a evitar a futuro.

21. **Checkboxes módulos Usuarios — doble disparo** ([UsuariosSection.jsx](src/components/sections/UsuariosSection.jsx)) — el `<div>` padre tenía `onClick={handlePermissionChange}` y el `<Checkbox>` también tenía `onCheckedChange={handlePermissionChange}`. Al clickear sobre el checkbox: primero disparaba Checkbox, después propagaba al div → toggle X2 → se cancelaba. Inconsistente (en label funcionaba, en checkbox no). Solución: `pointer-events-none` en el Checkbox + `tabIndex={-1}` (solo refleja estado visual, el div maneja el click).

22. **Logo de empresa no aparecía en Header** ([Header.jsx](src/components/Header.jsx)) — `logoUrl` se calculaba pero alguien removió el `<img>` con comentario "Replaced logo image with company name text". Re-agregado como cuadradito 40×40 con bordes redondeados al lado del nombre de empresa. Aparece solo si hay logo subido en Configuración.

23. **Edge Functions CORS hardcoded en localhost:3001** ([_shared/auth.ts](supabase/functions/_shared/auth.ts), [invite-user/index.ts](supabase/functions/invite-user/index.ts), [create-user/index.ts](supabase/functions/create-user/index.ts), [delete-user/index.ts](supabase/functions/delete-user/index.ts)):
   - Bug: cuando dev server corre en :3000, la edge function rechazaba con CORS por hardcodear `localhost:3001`.
   - Fix: `buildCorsHeaders(req)` con whitelist de orígenes (producción + localhost:3000/3001/5173). Refleja el origin del request si está permitido.
   - `errorResponse` y `okResponse` ahora aceptan `req` opcional para usar el CORS dinámico.
   - **⚠️ Pendiente deploy** — el código local está listo pero NO se aplicó a Supabase Functions. Las invitaciones siguen fallando en localhost hasta el deploy.

24. **Bug ReporteParidad — cálculos absurdos** ([ReporteParidad.jsx](src/components/reportes/ReporteParidad.jsx)) — `computeParalelo` asumía que `monto` venía en la moneda de la operación. Como ahora SIEMPRE viene en ARS (decisión de diseño punto 2), simplificado a `Number(monto) / Number(tcParaleloFecha)`. KPIs cuadran.

25. **PGRST116 ruido en consola** — `tipoCambioService.getTodayTC()` y `useTCParalelo` cambiados de `.single()` a `.maybeSingle()` para evitar el log 406 cuando no hay TC del día (caso esperado).

**Cambios en DB (migrations / UPDATEs):**
1. `fix_seed_plan_cuentas_security_definer` — RPC con SECURITY DEFINER + validación interna.
2. `UPDATE tipos_cambio SET tasa = tasa * 1000` — corrección datos corruptos USD/EUR/BRL.
3. `UPDATE comprobantes SET tipo_cambio_tasa = tipo_cambio_tasa * 1000` — 3 ventas con TC mal guardado.

**Convenciones nuevas para el equipo:**

- **Formato numérico es-AR ESTRICTO**: `.` = miles, `,` = decimal, sin separadores = entero. Cualquier input numérico debe usar `parseNumberLocale()` de `currencyUtils.js`. NO usar `parseFloat()` directo sobre input del usuario.
- **Componentes inline dentro de otros componentes**: si necesitás un sub-componente que comparte state del padre, usalo como FUNCIÓN (`{renderForm()}`) no como componente JSX (`<Form />`). Sino React remonta en cada render y pierde focus.
- **Radix SelectItem**: NUNCA `value=""`. Usar sentinel string como `"__none__"` y convertir a null/"" al guardar.
- **Cache invalidation queryKey**: si la queryKey tiene filters (`['table', empresaId, filters]`), invalidar con prefijo `['table', empresaId]`, NO con `KEYS.list(empresaId)` que arma `[..., empresaId, undefined]` y no matchea.
- **Notificaciones**: cualquier mutation que cambie stock, estado OC, deuda CC o caja debe invalidar `['notif']`. Helper `invalidateNotifs()` o `invalidateOCAndNotifs()` en cada sección.
- **INSERTs en tablas con RLS multi-tenant**: SIEMPRE incluir `empresa_id: user.empresa_id`. Las policies validan eso, sino dan 42501.
- **`.single()` vs `.maybeSingle()`**: usar `.maybeSingle()` cuando es esperado que no haya filas (configs opcionales, lookups con fallback). Sino el navegador loguea 406 PGRST116 aunque el código JS lo maneje bien.

**Pendientes identificados (no resueltos hoy):**

- ✅ **Deploy Edge Functions** (create-user v3, invite-user v3, delete-user v2) — desplegadas vía MCP en sesión PM·3. CORS dinámico con whitelist `buildCorsHeaders(req)` activo. `Vary: Origin` incluido.
- ⚠️ **Tabs Contabilidad faltantes**: CONTEXT decía 7 tabs (Plan, Asientos, Balance, LibroMayor, P&L, BalanceGeneral, Períodos) pero solo hay 4. P&L, Balance General y Períodos NUNCA se implementaron. Actualizar feature list o implementar.
- ⚠️ **Invalidación notifs en CC y Caja**: pendiente aplicar el mismo patrón de `invalidateNotifs()` en `CuentaCorrienteSection` (cobrar deuda) y `CajaSection` (cerrar caja). Sino esas notifs quedan stale 30s tras resolver.
- ⚠️ **BRL TC = 3.6**: el valor es bajo (real argentino actualmente ~$240-300 ARS). Usuario debería recargarlo manualmente con valor real.
- ⚠️ **Tests automatizados**: nada. Toda la verificación es manual por el usuario. Riesgo alto de regresiones.

### Sesión 2026-06-09 (PM·2) — Bugs #4–#7: aging, toast stock, fechas OC, TC bloquea OC

**Archivos modificados:**
- `src/components/sections/CuentaCorrienteSection.jsx` — Bug #4: `fetchAgingData()` ahora calcula antigüedad desde `comprobantes.estado_pago = 'pendiente'` (Open Items reales) en vez del DEBE más antiguo históricamente. Elimina falsos positivos en banda +90 días para clientes con deuda vieja pagada y deuda nueva reciente.
- `src/components/ventas/NuevaVentaModal.jsx` — Bug #5: `updateQuantity()` muestra toast destructivo "Solo hay X unidades disponibles de Y" cuando la cantidad del carrito supera el stock. Antes fallaba silenciosamente.
- `src/components/sections/OrdenesCompraSection.jsx` — Bug #6: 4 ocurrencias de `new Date().toLocaleDateString('es-AR')` reemplazadas por `formatDateAR()` de `dateUtils.js` (usa UTC, evita desfase UTC-3). Import agregado. — Bug #7: `MonedaSelector` recibe `onTCMissingChange={setTcMissingOC}`; botón "Crear Orden de Compra" deshabilitado con mensaje ⚠ cuando `moneda !== 'ARS'` y falta TC del día. `resetForm()` también resetea `tcMissingOC`.

**Convenciones reforzadas:**
- Aging de CC: siempre desde comprobantes con `estado_pago = 'pendiente'`, nunca desde movimientos DEBE crudos.
- Fechas en UI: siempre `formatDateAR()` / `formatDateTimeAR()`. Nunca `new Date().toLocaleDateString()`.
- MonedaSelector en formularios críticos (Ventas, OC): siempre incluir `onTCMissingChange` + bloquear submit si `tcMissing`.

### Sesión 2026-06-09 (PM) — 6 tareas: race condition stock, moneda paralela CC, POS server-side search, índices, user.id

**Archivos modificados:**
- `src/components/sections/CuentaCorrienteSection.jsx` — Tarea 1: `user_id: user.id` en INSERTs; Tarea 2: caja solo requerida para Efectivo (no bloquea Transferencia/Tarjeta/Cheque); Tarea 5: `monto_paralelo` + `tc_paralelo` via `useTCParalelo()` en cobros CC
- `src/components/ventas/NuevaVentaModal.jsx` — Tarea 3: stock decrement ahora usa RPC atómica `decrement_stock` (evita race conditions con ventas simultáneas); Tarea 6: init() ya no carga todos los productos — búsqueda server-side debounced 300ms, min 2 chars, `.or('nombre.ilike,codigo_sku.ilike')`, limit 30; cotizacion pre-fill fetch por IDs específicos
- `src/components/sections/ClientDetailModal.jsx` — `user_id: user.id` en ambos INSERTs (cuenta_corriente_movimientos + movimientos_caja)
- `src/components/sections/ClientesSection.jsx` — `user_id: user.id` en INSERT clientes
- `src/components/ui/CSVImportModal.jsx` — `user_id: user.id` en buildRow (clientes import CSV)
- `src/components/sections/ComprasSection.jsx` — `user_id: user.id` en INSERTs + `.eq('empresa_id')` en queries
- `migrations/022_rpc_decrement_stock.sql` — RPC `decrement_stock(p_producto_id, p_cantidad)` con SECURITY DEFINER, UPDATE atómico, check stock ≥ 0
- `migrations/023_indices_faltantes.sql` — 4 índices: `idx_comprobantes_estado_pago`, `idx_comprobantes_fecha`, `idx_cta_cte_empresa_cliente_tipo`, `idx_mov_inv_fecha`

**Convenciones confirmadas/reforzadas:**
- `user.tenant_id === user.empresa_id` (SupabaseAuthContext.jsx:84) — NUNCA usar como `user_id` en INSERTs. Siempre `user.id` para auditoría.
- Búsqueda POS server-side: state `products` vacío al montar; se pobla solo con debounced search de 2+ chars. Compatible con pre-fill de cotizaciones (fetch por `.in('id', ids)`).

**Pendiente (aplicar en Supabase SQL Editor):**
- Migration 022: `decrement_stock` RPC — aún NO aplicada a DB
- Migration 023: índices — aún NO aplicados a DB

### Sesión 2026-06-09 (AM) — Fix bugs críticos (Dashboard KPIs · Lista Precio 400 · Notificaciones) + Ficha de Alcance DOCX

- **Bugs críticos corregidos:**
  - `dashboardService.ts` — todas las queries de `getKPIs`, `getVentasPorDia` y `getFlujoCajaMensual` usaban `.eq('user_id', empresaId)` en lugar de `.eq('empresa_id', empresaId)` → KPIs del Dashboard mostraban 0 para todas las empresas. Fix: reemplazado en las 3 funciones.
  - `listaPreciosService.ts` — `getItems()` usaba PostgREST embedded select `.select('*, productos(nombre, codigo_sku, precio_venta)')` pero `lista_precio_items.producto_id` no tiene FK a `productos` en la migración 021 → 400 Bad Request al abrir una lista. Fix: reescrito como consulta en dos pasos (query items → `.in('id', productoIds)` en productos → merge manual).
  - `Dashboard.jsx` — `<Header>` se renderizaba sin la prop `onNavigate`, por lo que `onNavigate?.(item.seccion)` en Header.jsx siempre era `undefined?.()` → las notificaciones no navegaban al módulo de origen. Fix: agregado `onNavigate={setActiveSection}` al componente `<Header>`.
  - `OrdenesCompraSection.jsx` — `searchProducto()` usaba `.eq('user_id', empresaId)` → búsqueda de productos al crear una nueva OC devolvía vacío. Fix: `.eq('empresa_id', empresaId)`.
- **Documentación generada:**
  - `docs/generate_ficha_alcance.js` + `docs/KAIROX_Gestion_Ficha_Alcance.docx` — script Node.js + DOCX Word profesional con 9 secciones, 29 módulos documentados, tabla comparativa de competidores.

### Sesión 2026-06-08 (PM) — Testing roadmap + bugs UX/conversión moneda

- **Bugs corregidos durante testing manual:**
  - `dashboardService.ts`, `cajaService.ts`, `clientesService.ts`, `comprasService.ts`, `productosService.ts`, `OrdenesCompraSection.jsx` — 14 ocurrencias de `.eq('user_id', empresaId)` → `.eq('empresa_id', empresaId)`
  - `Sidebar.jsx` — soporte modo claro con variantes `dark:`
  - `ProductosSection.jsx` — SKU obligatorio: auto-genera `SKU-{timestamp}` si vacío + mensaje de duplicado claro
  - `NuevaVentaModal.jsx` — carrito invisible en flexbox: `min-h-0` + `min-h-[200px]` en panel carrito
- **TC del día — fix schema + parser robusto:**
  - `tipoCambioService.js` — removidas columnas `user_id` y `updated_at` del upsert (no existen en DB real)
  - `TipoCambioModal.jsx` + `MonedaSelector.jsx` — input cambiado de `type="number"` a `type="text" inputMode="decimal"` (fix locale español rechazando ".")
  - `currencyUtils.js` — nuevo helper `parseNumberLocale()`: detecta formato es-AR vs en-US automáticamente
- **Conversión moneda en venta (decisión de diseño adoptada):**
  - Productos siempre en ARS. Ventas se guardan SIEMPRE en ARS. Solo display se convierte.
  - `NuevaVentaModal.jsx` — `totalEnMonedaSeleccionada()` divide por tasa solo para mostrar. Banner "Equivale a $X ARS (TC $Y)"
  - `ComprobantePrintModal.jsx` — ticket muestra bloque moneda cobrada + TC + equivalente ARS cuando moneda ≠ ARS
  - `HistorialVentas.jsx` — badge USD/EUR + equivalente debajo del total ARS
  - Fix línea 283: `calculateTotal()` siempre devuelve ARS (era doble conversión)
- **UX Cotizaciones** (`CotizacionesSection.jsx`) — cliente: autocomplete + nombre libre; producto: dropdown en focus, carga 200 en memoria; cantidad: step 1; unidad: datalist 17 opciones
- **UX Pedidos** (`PedidosSection.jsx`) — fix step cantidad

### Sesión 2026-06-08 (PM) — Testing roadmap + bugs UX + conversión moneda

- **Bugs corregidos durante testing manual:**
  - `dashboardService.ts`, `cajaService.ts`, `clientesService.ts`, `comprasService.ts`, `productosService.ts`, `OrdenesCompraSection.jsx` — 14 ocurrencias de `.eq('user_id', empresaId)` → `.eq('empresa_id', empresaId)`
  - `Sidebar.jsx` — soporte modo claro con variantes `dark:`
  - `ProductosSection.jsx` — SKU obligatorio: auto-genera `SKU-{timestamp}` si vacío + mensaje de duplicado claro
  - `NuevaVentaModal.jsx` — carrito invisible en flexbox: `min-h-0` + `min-h-[200px]` en panel carrito
- **TC del día — fix schema + parser robusto:**
  - `tipoCambioService.js` — removidas columnas `user_id` y `updated_at` del upsert (no existen en DB real)
  - `TipoCambioModal.jsx` + `MonedaSelector.jsx` — input cambiado de `type="number"` a `type="text" inputMode="decimal"` (fix locale español rechazando ".")
  - `currencyUtils.js` — nuevo helper `parseNumberLocale()`: detecta formato es-AR vs en-US automáticamente
- **Conversión moneda en venta (decisión de diseño adoptada):**
  - Productos siempre en ARS. Ventas se guardan SIEMPRE en ARS. Solo display se convierte.
  - `NuevaVentaModal.jsx` — `totalEnMonedaSeleccionada()` divide por tasa solo para mostrar. Banner "Equivale a $X ARS (TC $Y)"
  - `ComprobantePrintModal.jsx` — ticket muestra bloque moneda cobrada + TC + equivalente ARS cuando moneda ≠ ARS
  - `HistorialVentas.jsx` — badge USD/EUR + equivalente debajo del total ARS
  - Fix línea 283: `calculateTotal()` siempre devuelve ARS (era doble conversión)
- **UX Cotizaciones** (`CotizacionesSection.jsx`) — cliente: autocomplete + nombre libre; producto: dropdown en focus, carga 200 en memoria; cantidad: step 1; unidad: datalist 17 opciones
- **UX Pedidos** (`PedidosSection.jsx`) — fix step cantidad

### Sesión 2026-06-08 — TC del día + Moneda Paralela + Bugs críticos producción
- **Bugs críticos corregidos:**
  - `acf8363` — Supabase client lazy (evita TDZ por BroadcastChannel en bundle)
  - `76b0ab1` — Remove framer-motion (TDZ crash en producción)
  - `6454d70` — Fix TDZ `calculateTotal before initialization`
  - `1945a51` — Fix `removeChild` DOM error en NuevaVentaModal product dropdown
  - `77997a1` — Defer `focus()` call after React DOM commit
  - `806f428` — Fix Google Translate DOM corruption (removeChild/insertBefore)
  - `a57cf76` — Harden sale flow contra stale-session 403 + silent failures
  - `85231c1` — Fix CC sale status (Pendiente no Pagada) + MonedaSelector input + cotizaciones product search
- **TC del día centralizado** (`1260307`):
  - Tabla `tipos_cambio` + migration `create_tipos_cambio`
  - `tipoCambioService.js` — `getTodayTC()` + `upsertTC()` (fecha local Argentina)
  - `TipoCambioModal.jsx` — dialog auto-open, autoFocus, Enter key
  - `MonedaSelector.jsx` — reescrito: auto-fetch TC, badge OK/Missing, prop `onTCMissingChange`
  - `CotizacionesSection.jsx` — integra TC obligatorio
- **Moneda Paralela SAP-style** (`576a0d8`):
  - Migration `add_moneda_paralela` — 5 tablas alteradas
  - `useTCParalelo.js` — hook empresa settings + TC diario + `calcParalelo()` + `tcMissing`
  - `ConfiguracionSection.jsx` — card "Moneda Paralela" con toggle + Select moneda + info chips
  - `NuevaVentaModal.jsx` — banner TC paralelo, bloqueo ARS si tcMissing, guarda `monto_paralelo`/`tc_paralelo`
  - `ReporteParidad.jsx` — reporte completo ARS/USD con cálculo retroactivo + CSV export
  - `ReportesSection.jsx` — tarjeta Reporte Paridad, disabled si `!tcParaleloEnabled`

### Sesión 2026-06-07 — Deploy Vercel (Fase 7 inicio)
- `vercel.json` + `vite.config.prod.js` — config producción sin plugins Horizons
- Fix `manualChunks` TDZ (circular deps con framer-motion) → sin chunk splitting manual
- Deploy exitoso en https://kairox-gestion.vercel.app (Vercel CLI `vercel --prod`)
- Env vars configuradas: `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`
- GitHub conectado a Vercel (pendiente reconectar al repo correcto `lbanegas96/kairox-gestion`)

### Sesión 2026-06-07 — Fase 6 completa (commit `a846bac`)
- migration 021: listas_precio + lista_precio_items + cols cotizacion_id/pedido_id en comprobantes
- `ListasPrecioSection.jsx` + `listaPreciosService.ts`: CRUD listas, precios por producto, asignación a cliente
- `NuevaVentaModal.jsx`: precios de lista aplicados automáticamente, badge "LISTA" en carrito
- `ClientesSection.jsx`: selector de lista en form de cliente
- `useNotifications.js`: fix `user_id→empresa_id` + caja sin cerrar +24h
- `DocumentFlowPanel.jsx` + `documentFlowService.ts`: panel SAP Document Flow en SaleDetailModal
- `OrdenesCompraSection.jsx`: fix TanStack Query v5 (`onSuccess→useEffect`) en recepción OC
- MCP Supabase configurado en `~/.claude/settings.json` — operativo ✅

### Sesión 2026-06-07 (continuación) — Infraestructura / Fix MCP
- Confirmado migraciones 018, 019, 020 aplicadas en Supabase ✅
- Fix conector MCP Supabase: reconectado a cuenta NALUX vía OAuth

### Sesión 2026-06-07 — Fase 5 completa
- `ProveedoresSection.jsx` + `proveedoresService.ts` — ficha completa, CC, OC, pago inline
- `LaunchpadSection.jsx` + `portalService.ts` — home Fiori-style con 4 portales por área
- `portals/VentasPortal.jsx` · `ComprasPortal.jsx` · `FinanzasPortal.jsx` · `InventarioPortal.jsx`
- `Sidebar.jsx` reescrito — 5 grupos con headers coloreados navegables a portales
- `migrations/020_notas_credito.sql` — NC columns en comprobantes ✅ aplicada
- `notaCreditoService.ts` + `NotaCreditoModal.jsx` — devolución parcial/total
- `abcService.ts` — clasificación A/B/C por revenue
- `ReportesSection.jsx` — comparativa período anterior con delta %

### Sesión 2026-06-06 — Fases 3 y 4 completas
- PedidosSection workflow, convertir a venta, confirmación AlertDialog
- DashboardSection: Top 5 vendidos + último mov banco + OnboardingBanner
- ConfiguracionSection: datos de ejemplo (8 productos + 3 clientes)
- 10 bugs corregidos (locale, Radix dialogs, permisos, UX)

### Sesión 2026-06-06 — Fase 2 completa
- Multi-pago en venta, aging CC, remito sin precios, fix arqueo caja
- Import CSV productos/clientes, límite crédito, condición pago, solo-caja

### Sesión 2026-06-05 — Deuda técnica
- Migrations 013-016, soft delete productos, paginación, Edge functions, SMTP

### Sesión 2026-06-04 — Setup + Open Item Management
- Open Item CC SAP-style, trigger saldo cliente, bugfixes

---

## 3 grandes proyectos al final

| # | Proyecto | Por qué al final |
|---|---|---|
| 1 | **Deploy en Vercel** | ✅ Completado — https://kairox-gestion.vercel.app |
| 2 | **Membresías / Stripe o MercadoPago** | Requiere ARCA primero + modelo de precios validado |
| 3 | **Modelo de licencias (Starter/Pro/Business)** | Requiere primeros clientes |
