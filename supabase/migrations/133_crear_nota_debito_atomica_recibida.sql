-- migrations/133_crear_nota_debito_atomica_recibida.sql
--
-- Auditoría S44 (área #6 Notas de Débito): crear_nota_debito solo generaba el
-- movimiento de Cuenta Corriente atómicamente para tipo='emitida' (cliente).
-- Para tipo='recibida' (proveedor nos cobra un adicional), el frontend
-- (NuevaNDProveedorModal.jsx) hacía un INSERT SUELTO posterior en
-- cuenta_corriente_proveedores — mismo patrón de bug ya encontrado y corregido
-- en CxC/CxP: si ese segundo insert falla, la ND queda registrada pero la
-- deuda al proveedor nunca sube (tesorería/CC divergen del comprobante).
--
-- Fix: mover el INSERT de cuenta_corriente_proveedores adentro del RPC
-- (misma transacción), igual que ya se hace para 'emitida'.

CREATE OR REPLACE FUNCTION public.crear_nota_debito(
  p_empresa_id uuid,
  p_user_id uuid,
  p_tipo text,
  p_concepto text,
  p_monto numeric,
  p_comprobante_id uuid DEFAULT NULL::uuid,
  p_compra_id uuid DEFAULT NULL::uuid,
  p_cliente_id uuid DEFAULT NULL::uuid,
  p_proveedor_id uuid DEFAULT NULL::uuid,
  p_moneda text DEFAULT 'ARS'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_nd_id     UUID;
  v_numero_nd TEXT;
  v_cc_id     UUID;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto de la nota de débito debe ser mayor a cero';
  END IF;

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

  ELSIF p_tipo = 'recibida' AND p_proveedor_id IS NOT NULL THEN
    INSERT INTO public.cuenta_corriente_proveedores (
      empresa_id, user_id, proveedor_id, tipo, monto, descripcion,
      referencia_id, referencia_tipo, fecha
    ) VALUES (
      p_empresa_id, p_user_id, p_proveedor_id, 'nota_debito', p_monto,
      'ND ' || v_numero_nd || ' recibida - ' || p_concepto,
      v_nd_id, 'nd_proveedor', now()
    ) RETURNING id INTO v_cc_id;

    UPDATE public.notas_debito SET cc_movimiento_id = v_cc_id WHERE id = v_nd_id;
  END IF;

  RETURN jsonb_build_object('nota_debito_id', v_nd_id, 'numero_nd', v_numero_nd);
END;
$function$;
