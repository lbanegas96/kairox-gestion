-- migration 153 — Auditoría (barrido sistemático completo, a pedido del usuario)
--
-- Se listaron TODAS las tablas de public con pg_policies y se cruzaron contra lo ya
-- gateado. Aparecieron 6 tablas más con el mismo patrón débil ("FOR ALL"/CUD sin
-- has_module_permission ni is_admin"), confirmadas con BEGIN...ROLLBACK contra datos
-- reales antes de este fix: un staff sin ningún permiso especial pudo UPDATE sobre
-- `cajas`, `categorias`, `cuenta_corriente_movimientos` (monto a $999999),
-- `notas_debito` (monto a $999999), y DELETE sobre `devoluciones` y
-- `movimientos_inventario` (el libro de auditoría de stock).
--
-- Módulo elegido por tabla (mismo criterio que el resto de la auditoría — mirror del
-- módulo ya usado por la tabla hermana o el dominio real de uso):
--  - cajas: módulo 'caja' (igual que caja_sesiones/movimientos_caja, mig.132)
--  - categorias: módulo 'productos' (igual que la tabla productos, mig.132)
--  - comprobante_pagos: módulo 'ventas' — CERO call-sites de escritura en frontend/RPCs
--    (tabla sin uso real detectado), se gatea igual por defensa en profundidad
--  - movimientos_inventario: módulo 'productos' — es un libro de auditoría de stock,
--    nunca debería borrarse: se remueve la policy de DELETE (mismo principio ya
--    aplicado a comprobantes/CxC/CxP/ND en mig.141/142 — "se anula, no se borra")
--  - devoluciones / devolucion_items: uso dual confirmado (tipo='cliente' es ventas,
--    tipo='proveedor' es compras, ver crear_devolucion) → gate con
--    (has_module_permission('ventas') OR has_module_permission('compras')). Mismo
--    principio: se remueve DELETE (sin call-site legítimo, documentos no se borran)
--  - cuenta_corriente_movimientos (CxC clientes): quedó afuera de mig.146 por
--    descuido — su hermana cuenta_corriente_proveedores ya tenía permiso 'compras'
--    desde esa migración. Ahora exige 'ventas' en INSERT/UPDATE (DELETE ya estaba
--    ausente desde mig.142)
--  - notas_debito: mismo uso dual que devoluciones (tipo='emitida' cliente/ventas,
--    tipo='recibida' proveedor/compras) → mismo gate OR. DELETE ya ausente (mig.142)
--
-- Todas las RPCs SECURITY DEFINER involucradas (crear_venta, crear_devolucion,
-- crear_nota_debito, registrar_cobro_cliente, decrement_stock/increment_stock, etc.)
-- siguen funcionando sin cambios — bypasean RLS por table ownership, como el resto
-- del motor de dinero de todo el sistema.

-- ── cajas ──────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "cajas_all" ON public.cajas;
CREATE POLICY "cajas_select" ON public.cajas FOR SELECT
  USING (empresa_id = get_my_empresa_id());
CREATE POLICY "cajas_cud" ON public.cajas FOR ALL
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('caja'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('caja'));

-- ── categorias ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "categorias_all" ON public.categorias;
CREATE POLICY "categorias_select" ON public.categorias FOR SELECT
  USING (empresa_id = get_my_empresa_id());
CREATE POLICY "categorias_cud" ON public.categorias FOR ALL
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('productos'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('productos'));

-- ── comprobante_pagos ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "comprobante_pagos_empresa" ON public.comprobante_pagos;
CREATE POLICY "comprobante_pagos_select" ON public.comprobante_pagos FOR SELECT
  USING (empresa_id = get_my_empresa_id());
CREATE POLICY "comprobante_pagos_cud" ON public.comprobante_pagos FOR ALL
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('ventas'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('ventas'));

-- ── movimientos_inventario (libro de auditoría — sin DELETE) ────────────────────
DROP POLICY IF EXISTS "movimientos_inventario_all" ON public.movimientos_inventario;
CREATE POLICY "movimientos_inventario_select" ON public.movimientos_inventario FOR SELECT
  USING (empresa_id = get_my_empresa_id());
CREATE POLICY "movimientos_inventario_insert" ON public.movimientos_inventario FOR INSERT
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('productos'));
CREATE POLICY "movimientos_inventario_update" ON public.movimientos_inventario FOR UPDATE
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('productos'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('productos'));

-- ── devoluciones / devolucion_items (dual ventas|compras — sin DELETE) ──────────
DROP POLICY IF EXISTS "devoluciones_all" ON public.devoluciones;
CREATE POLICY "devoluciones_select" ON public.devoluciones FOR SELECT
  USING (empresa_id = get_my_empresa_id());
CREATE POLICY "devoluciones_insert" ON public.devoluciones FOR INSERT
  WITH CHECK (empresa_id = get_my_empresa_id() AND (has_module_permission('ventas') OR has_module_permission('compras')));
CREATE POLICY "devoluciones_update" ON public.devoluciones FOR UPDATE
  USING (empresa_id = get_my_empresa_id() AND (has_module_permission('ventas') OR has_module_permission('compras')))
  WITH CHECK (empresa_id = get_my_empresa_id() AND (has_module_permission('ventas') OR has_module_permission('compras')));

DROP POLICY IF EXISTS "devolucion_items_all" ON public.devolucion_items;
CREATE POLICY "devolucion_items_select" ON public.devolucion_items FOR SELECT
  USING (empresa_id = get_my_empresa_id());
CREATE POLICY "devolucion_items_insert" ON public.devolucion_items FOR INSERT
  WITH CHECK (empresa_id = get_my_empresa_id() AND (has_module_permission('ventas') OR has_module_permission('compras')));
CREATE POLICY "devolucion_items_update" ON public.devolucion_items FOR UPDATE
  USING (empresa_id = get_my_empresa_id() AND (has_module_permission('ventas') OR has_module_permission('compras')))
  WITH CHECK (empresa_id = get_my_empresa_id() AND (has_module_permission('ventas') OR has_module_permission('compras')));

-- ── cuenta_corriente_movimientos (CxC clientes — faltaba en mig.146) ────────────
DROP POLICY IF EXISTS "cta_cte_insert" ON public.cuenta_corriente_movimientos;
CREATE POLICY "cta_cte_insert" ON public.cuenta_corriente_movimientos FOR INSERT
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('ventas'));

DROP POLICY IF EXISTS "cta_cte_update" ON public.cuenta_corriente_movimientos;
CREATE POLICY "cta_cte_update" ON public.cuenta_corriente_movimientos FOR UPDATE
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('ventas'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('ventas'));

-- ── notas_debito (dual ventas|compras) ──────────────────────────────────────────
DROP POLICY IF EXISTS "notas_debito_insert" ON public.notas_debito;
CREATE POLICY "notas_debito_insert" ON public.notas_debito FOR INSERT
  WITH CHECK (empresa_id = get_my_empresa_id() AND (has_module_permission('ventas') OR has_module_permission('compras')));

DROP POLICY IF EXISTS "notas_debito_update" ON public.notas_debito;
CREATE POLICY "notas_debito_update" ON public.notas_debito FOR UPDATE
  USING (empresa_id = get_my_empresa_id() AND (has_module_permission('ventas') OR has_module_permission('compras')))
  WITH CHECK (empresa_id = get_my_empresa_id() AND (has_module_permission('ventas') OR has_module_permission('compras')));
