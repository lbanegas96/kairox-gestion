-- migration 169 — CxC/CxP: imputación de cobros/pagos a factura específica
-- (Fase 2 del plan de 4 frentes contables, reordenada por prerrequisito de
-- Multimoneda — sesión 54, 2026-07-08).
--
-- HALLAZGO DE AUDITORÍA: registrar_cobro_cliente/registrar_pago_proveedor solo
-- reducen el saldo corrido del cliente/proveedor — nunca supieron a qué
-- factura/compra puntual corresponde el cobro/pago. Esto contradice lo que
-- sap-reference (Regla 5, Open Item Management) da por implementado. Impacto
-- real: no se puede saber qué facturas concretas quedaron pagas vs. abiertas,
-- ni armar un reporte de antigüedad de saldos confiable.
--
-- FIX (patrón SAP — Open Item clearing): 2 tablas nuevas de imputación (una
-- para clientes, otra para proveedores, siguiendo la misma separación que ya
-- existe entre cuenta_corriente_movimientos y cuenta_corriente_proveedores).
-- Un cobro/pago puede repartirse entre varias facturas, y una factura puede
-- cobrarse en varias cuotas — el saldo pendiente de una factura siempre es
-- total - SUM(imputaciones).
--
-- BACKWARD COMPATIBLE: el nuevo parámetro `p_imputaciones` de ambos RPCs es
-- opcional (default NULL). Si no se pasa, el cobro/pago se comporta EXACTO
-- igual que antes de esta migration (reduce el saldo corrido, sin imputar a
-- ninguna factura puntual) — no rompe ningún flujo existente.

-- ─── Paso 1: tablas de imputación ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.cuenta_corriente_imputaciones (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id             UUID        NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  cobro_movimiento_id    UUID        NOT NULL REFERENCES public.cuenta_corriente_movimientos(id) ON DELETE CASCADE,
  factura_comprobante_id UUID        NOT NULL REFERENCES public.comprobantes(id) ON DELETE RESTRICT,
  monto                  NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.cuenta_corriente_imputaciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cc_imputaciones_select" ON public.cuenta_corriente_imputaciones;
CREATE POLICY "cc_imputaciones_select" ON public.cuenta_corriente_imputaciones
  FOR SELECT USING (empresa_id = get_my_empresa_id());
-- Sin policy de INSERT/UPDATE/DELETE directa: solo se escribe desde el RPC
-- SECURITY DEFINER registrar_cobro_cliente (mismo criterio que el resto del
-- motor de dinero — nunca escritura directa del frontend a estas tablas).

CREATE INDEX IF NOT EXISTS idx_cc_imputaciones_factura ON public.cuenta_corriente_imputaciones(factura_comprobante_id);
CREATE INDEX IF NOT EXISTS idx_cc_imputaciones_cobro    ON public.cuenta_corriente_imputaciones(cobro_movimiento_id);

REVOKE ALL ON public.cuenta_corriente_imputaciones FROM anon, authenticated;
GRANT SELECT ON public.cuenta_corriente_imputaciones TO authenticated;

CREATE TABLE IF NOT EXISTS public.cuenta_corriente_proveedores_imputaciones (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        UUID        NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  pago_movimiento_id UUID       NOT NULL REFERENCES public.cuenta_corriente_proveedores(id) ON DELETE CASCADE,
  factura_compra_id UUID        NOT NULL REFERENCES public.compras(id) ON DELETE RESTRICT,
  monto             NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.cuenta_corriente_proveedores_imputaciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ccp_imputaciones_select" ON public.cuenta_corriente_proveedores_imputaciones;
CREATE POLICY "ccp_imputaciones_select" ON public.cuenta_corriente_proveedores_imputaciones
  FOR SELECT USING (empresa_id = get_my_empresa_id());

CREATE INDEX IF NOT EXISTS idx_ccp_imputaciones_factura ON public.cuenta_corriente_proveedores_imputaciones(factura_compra_id);
CREATE INDEX IF NOT EXISTS idx_ccp_imputaciones_pago    ON public.cuenta_corriente_proveedores_imputaciones(pago_movimiento_id);

REVOKE ALL ON public.cuenta_corriente_proveedores_imputaciones FROM anon, authenticated;
GRANT SELECT ON public.cuenta_corriente_proveedores_imputaciones TO authenticated;

-- ─── Paso 2: registrar_cobro_cliente — parámetro p_imputaciones opcional ────
-- IMPORTANTE (lección de migration 166): CREATE OR REPLACE NO reemplaza una
-- función si se le agrega un parámetro nuevo — crea una sobrecarga ambigua
-- junto a la vieja. Hay que DROPear la firma anterior explícitamente primero.
DROP FUNCTION IF EXISTS public.registrar_cobro_cliente(uuid,uuid,uuid,text,numeric,text,timestamptz,text,uuid,numeric,numeric);

CREATE OR REPLACE FUNCTION public.registrar_cobro_cliente(
  p_empresa_id uuid, p_user_id uuid, p_cliente_id uuid, p_cliente_nombre text,
  p_monto numeric, p_metodo text, p_fecha timestamp with time zone,
  p_descripcion text DEFAULT NULL::text, p_caja_sesion_id uuid DEFAULT NULL::uuid,
  p_monto_paralelo numeric DEFAULT NULL::numeric, p_tc_paralelo numeric DEFAULT NULL::numeric,
  p_imputaciones jsonb DEFAULT NULL::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_monto      numeric;
  v_paralelo   numeric;
  v_cc_id      uuid;
  v_caja_id    uuid;
  v_fecha_dia  date;
  v_cerrado    boolean;
  v_cta_caja   uuid;
  v_cta_cxc    uuid;
  v_asiento_id uuid;
  v_asiento_generado boolean := false;
  v_item       jsonb;
  v_factura_id uuid;
  v_monto_imp  numeric;
  v_total_factura     numeric;
  v_ya_imputado        numeric;
  v_saldo_pendiente    numeric;
  v_suma_imputada numeric := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
      RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
    END IF;
    IF NOT has_module_permission('ventas') THEN
      RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
    END IF;
  END IF;

  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto del cobro debe ser mayor a cero';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.clientes WHERE id = p_cliente_id AND empresa_id = p_empresa_id) THEN
    RAISE EXCEPTION 'El cliente no pertenece a la empresa';
  END IF;

  v_monto    := ROUND(p_monto, 2);
  v_paralelo := CASE WHEN p_monto_paralelo IS NOT NULL THEN ROUND(p_monto_paralelo, 2) END;

  INSERT INTO public.cuenta_corriente_movimientos
    (user_id, empresa_id, cliente_id, tipo, monto, descripcion, fecha, metodo_cobro, monto_paralelo, tc_paralelo)
  VALUES
    (p_user_id, p_empresa_id, p_cliente_id, 'HABER', v_monto,
     COALESCE(NULLIF(p_descripcion, ''), 'Pago de deuda'), p_fecha, p_metodo, v_paralelo, p_tc_paralelo)
  RETURNING id INTO v_cc_id;

  INSERT INTO public.movimientos_caja
    (user_id, empresa_id, caja_sesion_id, fecha, tipo, categoria, concepto, monto, metodo_pago, is_automatic, monto_paralelo, tc_paralelo)
  VALUES
    (p_user_id, p_empresa_id, p_caja_sesion_id, p_fecha, 'ingreso', 'Cobro Cliente',
     'Cobro a ' || COALESCE(NULLIF(p_cliente_nombre, ''), 'cliente') || ' - ' || p_metodo,
     v_monto, p_metodo, true, v_paralelo, p_tc_paralelo)
  RETURNING id INTO v_caja_id;

  -- ── Imputación a factura(s) específica(s) — Open Item clearing (opcional) ──
  IF p_imputaciones IS NOT NULL AND jsonb_array_length(p_imputaciones) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_imputaciones)
    LOOP
      v_factura_id := (v_item->>'comprobante_id')::uuid;
      v_monto_imp  := ROUND((v_item->>'monto')::numeric, 2);

      IF v_monto_imp IS NULL OR v_monto_imp <= 0 THEN
        RAISE EXCEPTION 'El monto imputado a la factura % debe ser mayor a cero', v_factura_id;
      END IF;

      -- Lock de la factura para evitar que 2 cobros concurrentes la sobre-imputen.
      SELECT total INTO v_total_factura
      FROM public.comprobantes
      WHERE id = v_factura_id AND empresa_id = p_empresa_id AND cliente_id = p_cliente_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'La factura % no existe o no pertenece a este cliente', v_factura_id;
      END IF;

      SELECT COALESCE(SUM(monto), 0) INTO v_ya_imputado
      FROM public.cuenta_corriente_imputaciones
      WHERE factura_comprobante_id = v_factura_id;

      v_saldo_pendiente := v_total_factura - v_ya_imputado;

      IF v_monto_imp > v_saldo_pendiente THEN
        RAISE EXCEPTION 'El monto imputado (%) supera el saldo pendiente de la factura (%)', v_monto_imp, v_saldo_pendiente;
      END IF;

      INSERT INTO public.cuenta_corriente_imputaciones
        (empresa_id, cobro_movimiento_id, factura_comprobante_id, monto)
      VALUES (p_empresa_id, v_cc_id, v_factura_id, v_monto_imp);

      v_suma_imputada := v_suma_imputada + v_monto_imp;
    END LOOP;

    IF v_suma_imputada > v_monto THEN
      RAISE EXCEPTION 'La suma imputada a facturas (%) no puede superar el monto del cobro (%)', v_suma_imputada, v_monto;
    END IF;
  END IF;

  -- Asiento contable automático — no bloqueante (mismo patrón que
  -- asientosAutoService.ts para Ventas/Compras/Caja manual).
  BEGIN
    v_fecha_dia := p_fecha::date;
    BEGIN
      SELECT fecha_en_periodo_cerrado(p_empresa_id, v_fecha_dia) INTO v_cerrado;
    EXCEPTION WHEN undefined_function THEN v_cerrado := false;
    END;

    IF NOT COALESCE(v_cerrado, false) THEN
      SELECT id INTO v_cta_caja FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '1.1.1' AND activa LIMIT 1;
      SELECT id INTO v_cta_cxc  FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '1.1.2' AND activa LIMIT 1;

      IF v_cta_caja IS NOT NULL AND v_cta_cxc IS NOT NULL THEN
        INSERT INTO public.asientos_contables
          (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
        VALUES (
          p_empresa_id, p_user_id, next_numero_asiento(p_empresa_id), v_fecha_dia,
          'Cobro a ' || COALESCE(NULLIF(p_cliente_nombre, ''), 'cliente'),
          'confirmado', v_monto, v_monto, 'cobro_cliente', v_cc_id
        ) RETURNING id INTO v_asiento_id;

        INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
          (v_asiento_id, p_empresa_id, v_cta_caja, 'Cobro recibido', v_monto, 0),
          (v_asiento_id, p_empresa_id, v_cta_cxc,  'Cancelación parcial/total de deuda', 0, v_monto);

        v_asiento_generado := true;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_asiento_generado := false;
  END;

  RETURN jsonb_build_object('ok', true, 'cc_id', v_cc_id, 'caja_id', v_caja_id, 'asiento_generado', v_asiento_generado);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.registrar_cobro_cliente(uuid,uuid,uuid,text,numeric,text,timestamptz,text,uuid,numeric,numeric,jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.registrar_cobro_cliente(uuid,uuid,uuid,text,numeric,text,timestamptz,text,uuid,numeric,numeric,jsonb) TO authenticated;

-- ─── Paso 3: registrar_pago_proveedor — parámetro p_imputaciones opcional ───
DROP FUNCTION IF EXISTS public.registrar_pago_proveedor(uuid,uuid,uuid,text,numeric,text,text,uuid);

CREATE OR REPLACE FUNCTION public.registrar_pago_proveedor(
  p_empresa_id uuid, p_user_id uuid, p_proveedor_id uuid, p_proveedor_nombre text,
  p_monto numeric, p_metodo text, p_descripcion text DEFAULT NULL::text,
  p_caja_sesion_id uuid DEFAULT NULL::uuid,
  p_imputaciones jsonb DEFAULT NULL::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_monto      numeric;
  v_ccp_id     uuid;
  v_caja_id    uuid;
  v_fecha_dia  date := now()::date;
  v_cerrado    boolean;
  v_cta_caja   uuid;
  v_cta_cxp    uuid;
  v_asiento_id uuid;
  v_asiento_generado boolean := false;
  v_item       jsonb;
  v_factura_id uuid;
  v_monto_imp  numeric;
  v_total_factura   numeric;
  v_ya_imputado     numeric;
  v_saldo_pendiente numeric;
  v_suma_imputada   numeric := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
      RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
    END IF;
    IF NOT has_module_permission('compras') THEN
      RAISE EXCEPTION 'No autorizado: sin permiso de módulo compras';
    END IF;
  END IF;

  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto del pago debe ser mayor a cero';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.proveedores WHERE id = p_proveedor_id AND empresa_id = p_empresa_id) THEN
    RAISE EXCEPTION 'El proveedor no pertenece a la empresa';
  END IF;

  v_monto := ROUND(p_monto, 2);

  INSERT INTO public.cuenta_corriente_proveedores
    (empresa_id, proveedor_id, tipo, monto, descripcion, user_id, fecha)
  VALUES
    (p_empresa_id, p_proveedor_id, 'pago', v_monto,
     COALESCE(NULLIF(p_descripcion, ''), 'Pago a proveedor'), p_user_id, now())
  RETURNING id INTO v_ccp_id;

  INSERT INTO public.movimientos_caja
    (user_id, empresa_id, caja_sesion_id, fecha, tipo, categoria, concepto, monto, metodo_pago, is_automatic)
  VALUES
    (p_user_id, p_empresa_id, p_caja_sesion_id, now(), 'egreso', 'Pago Proveedor',
     'Pago a ' || COALESCE(NULLIF(p_proveedor_nombre, ''), 'proveedor') || ' - ' || p_metodo,
     v_monto, p_metodo, true)
  RETURNING id INTO v_caja_id;

  -- ── Imputación a compra(s) específica(s) — Open Item clearing (opcional) ───
  IF p_imputaciones IS NOT NULL AND jsonb_array_length(p_imputaciones) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_imputaciones)
    LOOP
      v_factura_id := (v_item->>'compra_id')::uuid;
      v_monto_imp  := ROUND((v_item->>'monto')::numeric, 2);

      IF v_monto_imp IS NULL OR v_monto_imp <= 0 THEN
        RAISE EXCEPTION 'El monto imputado a la compra % debe ser mayor a cero', v_factura_id;
      END IF;

      SELECT total INTO v_total_factura
      FROM public.compras
      WHERE id = v_factura_id AND empresa_id = p_empresa_id AND proveedor_id = p_proveedor_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'La compra % no existe o no pertenece a este proveedor', v_factura_id;
      END IF;

      SELECT COALESCE(SUM(monto), 0) INTO v_ya_imputado
      FROM public.cuenta_corriente_proveedores_imputaciones
      WHERE factura_compra_id = v_factura_id;

      v_saldo_pendiente := v_total_factura - v_ya_imputado;

      IF v_monto_imp > v_saldo_pendiente THEN
        RAISE EXCEPTION 'El monto imputado (%) supera el saldo pendiente de la compra (%)', v_monto_imp, v_saldo_pendiente;
      END IF;

      INSERT INTO public.cuenta_corriente_proveedores_imputaciones
        (empresa_id, pago_movimiento_id, factura_compra_id, monto)
      VALUES (p_empresa_id, v_ccp_id, v_factura_id, v_monto_imp);

      v_suma_imputada := v_suma_imputada + v_monto_imp;
    END LOOP;

    IF v_suma_imputada > v_monto THEN
      RAISE EXCEPTION 'La suma imputada a compras (%) no puede superar el monto del pago (%)', v_suma_imputada, v_monto;
    END IF;
  END IF;

  BEGIN
    BEGIN
      SELECT fecha_en_periodo_cerrado(p_empresa_id, v_fecha_dia) INTO v_cerrado;
    EXCEPTION WHEN undefined_function THEN v_cerrado := false;
    END;

    IF NOT COALESCE(v_cerrado, false) THEN
      SELECT id INTO v_cta_caja FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '1.1.1' AND activa LIMIT 1;
      SELECT id INTO v_cta_cxp  FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '2.1.1' AND activa LIMIT 1;

      IF v_cta_caja IS NOT NULL AND v_cta_cxp IS NOT NULL THEN
        INSERT INTO public.asientos_contables
          (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
        VALUES (
          p_empresa_id, p_user_id, next_numero_asiento(p_empresa_id), v_fecha_dia,
          'Pago a ' || COALESCE(NULLIF(p_proveedor_nombre, ''), 'proveedor'),
          'confirmado', v_monto, v_monto, 'pago_proveedor', v_ccp_id
        ) RETURNING id INTO v_asiento_id;

        INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
          (v_asiento_id, p_empresa_id, v_cta_cxp,  'Cancelación parcial/total de deuda', v_monto, 0),
          (v_asiento_id, p_empresa_id, v_cta_caja, 'Pago realizado', 0, v_monto);

        v_asiento_generado := true;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_asiento_generado := false;
  END;

  RETURN jsonb_build_object('ok', true, 'ccp_id', v_ccp_id, 'caja_id', v_caja_id, 'asiento_generado', v_asiento_generado);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.registrar_pago_proveedor(uuid,uuid,uuid,text,numeric,text,text,uuid,jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.registrar_pago_proveedor(uuid,uuid,uuid,text,numeric,text,text,uuid,jsonb) TO authenticated;

-- ─── Paso 4: vista de saldo pendiente por factura (para UI y reportes) ──────

CREATE OR REPLACE VIEW public.facturas_saldo_pendiente
WITH (security_invoker = true) AS
SELECT
  c.id            AS comprobante_id,
  c.empresa_id,
  c.cliente_id,
  c.numero_venta,
  c.fecha,
  c.fecha_vencimiento,
  c.total,
  COALESCE(i.total_imputado, 0)                    AS total_imputado,
  c.total - COALESCE(i.total_imputado, 0)           AS saldo_pendiente,
  c.cliente_nombre
FROM public.comprobantes c
LEFT JOIN (
  SELECT factura_comprobante_id, SUM(monto) AS total_imputado
  FROM public.cuenta_corriente_imputaciones
  GROUP BY factura_comprobante_id
) i ON i.factura_comprobante_id = c.id
WHERE c.tipo = 'venta' AND c.cliente_id IS NOT NULL;

CREATE OR REPLACE VIEW public.compras_saldo_pendiente
WITH (security_invoker = true) AS
SELECT
  co.id           AS compra_id,
  co.empresa_id,
  co.proveedor_id,
  co.total,
  COALESCE(i.total_imputado, 0)                     AS total_imputado,
  co.total - COALESCE(i.total_imputado, 0)          AS saldo_pendiente
FROM public.compras co
LEFT JOIN (
  SELECT factura_compra_id, SUM(monto) AS total_imputado
  FROM public.cuenta_corriente_proveedores_imputaciones
  GROUP BY factura_compra_id
) i ON i.factura_compra_id = co.id;

-- ROLLBACK (comentado):
-- DROP VIEW IF EXISTS public.compras_saldo_pendiente;
-- DROP VIEW IF EXISTS public.facturas_saldo_pendiente;
-- (restaurar registrar_cobro_cliente/registrar_pago_proveedor a su versión de migration 155)
-- DROP TABLE IF EXISTS public.cuenta_corriente_proveedores_imputaciones;
-- DROP TABLE IF EXISTS public.cuenta_corriente_imputaciones;
