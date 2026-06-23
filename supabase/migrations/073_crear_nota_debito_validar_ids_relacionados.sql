-- ════════════════════════════════════════════════════════════════════════════
-- migration 073 — Hallazgo de PLAN_AUDITORIA_2.md sección 1
-- crear_nota_debito: validar que IDs relacionados pertenezcan a la misma empresa
-- ════════════════════════════════════════════════════════════════════════════
--
-- Problema (confirmado con BEGIN...ROLLBACK en sesión 53):
--   crear_nota_debito tenía guard de tenant `p_empresa_id = get_my_empresa_id()`
--   pero NO verificaba que los IDs relacionados (p_cliente_id, p_proveedor_id,
--   p_comprobante_id, p_compra_id) pertenezcan a la misma empresa.
--
-- Vector verificado: Tenant T (atacante) llama la RPC con su propio
-- p_empresa_id=T (pasa el guard) pero pasa p_cliente_id y p_comprobante_id
-- de Tenant U. La fila se insertaba en notas_debito con empresa_id=T pero
-- cliente_id/comprobante_id apuntando a recursos de U. Lo mismo en el
-- INSERT a cuenta_corriente_movimientos.
--
-- Severidad: cross-tenant integrity corruption. Requiere atacante activo
-- (no es leak pasivo), pero rompe la promesa del guard SECURITY DEFINER.
--
-- Fix: validar cada FK no-nula contra la empresa antes de insertar.

CREATE OR REPLACE FUNCTION public.crear_nota_debito(
  p_empresa_id     UUID,
  p_user_id        UUID,
  p_tipo           TEXT,
  p_concepto       TEXT,
  p_monto          NUMERIC,
  p_comprobante_id UUID DEFAULT NULL,
  p_compra_id      UUID DEFAULT NULL,
  p_cliente_id     UUID DEFAULT NULL,
  p_proveedor_id   UUID DEFAULT NULL,
  p_moneda         TEXT DEFAULT 'ARS'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nd_id     UUID;
  v_numero_nd TEXT;
  v_cc_id     UUID;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  -- ─── Fix 073: validar IDs relacionados cross-tenant ────────────────────
  IF p_cliente_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.clientes WHERE id = p_cliente_id AND empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'cliente_id no pertenece a la empresa';
  END IF;

  IF p_proveedor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.proveedores WHERE id = p_proveedor_id AND empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'proveedor_id no pertenece a la empresa';
  END IF;

  IF p_comprobante_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.comprobantes WHERE id = p_comprobante_id AND empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'comprobante_id no pertenece a la empresa';
  END IF;

  IF p_compra_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.compras WHERE id = p_compra_id AND empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'compra_id no pertenece a la empresa';
  END IF;
  -- ────────────────────────────────────────────────────────────────────────

  v_numero_nd := public.obtener_proximo_numero(p_empresa_id, 'nota_debito');

  INSERT INTO public.notas_debito (
    empresa_id, user_id, numero_nd, tipo,
    comprobante_id, compra_id, cliente_id, proveedor_id,
    concepto, monto, moneda
  ) VALUES (
    p_empresa_id, p_user_id, v_numero_nd, p_tipo,
    p_comprobante_id, p_compra_id, p_cliente_id, p_proveedor_id,
    p_concepto, p_monto, p_moneda
  ) RETURNING id INTO v_nd_id;

  IF p_tipo = 'emitida' AND p_cliente_id IS NOT NULL THEN
    INSERT INTO public.cuenta_corriente_movimientos (
      empresa_id, cliente_id, tipo, monto, descripcion, comprobante_id
    ) VALUES (
      p_empresa_id, p_cliente_id, 'DEBE', p_monto,
      'ND ' || v_numero_nd || ' - ' || p_concepto,
      p_comprobante_id
    ) RETURNING id INTO v_cc_id;

    UPDATE public.notas_debito SET cc_movimiento_id = v_cc_id WHERE id = v_nd_id;
  END IF;

  RETURN jsonb_build_object('nota_debito_id', v_nd_id, 'numero_nd', v_numero_nd);
END;
$$;

-- ROLLBACK (comentado): volver a la versión sin validación de IDs relacionados
-- CREATE OR REPLACE FUNCTION public.crear_nota_debito(...) AS $$
--   -- (versión previa sin los 4 bloques IF NOT EXISTS)
-- $$;
