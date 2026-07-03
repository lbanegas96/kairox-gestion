-- migration 131 — Pago a proveedor atómico + salida de tesorería (auditoría S44, área #2 CxP)
--
-- PROBLEMA: registrarPago (proveedoresService) SOLO insertaba en cuenta_corriente_proveedores
-- (tipo='pago', reduce la deuda). NUNCA registraba la salida de plata en Caja/Bancos. Resultado:
-- pagás a un proveedor, la deuda baja, pero el sistema sigue creyendo que tenés esa plata →
-- Caja/Bancos sobrevaluada. Ocurre en TODOS los pagos (no es una ventana de falla rara).
-- Además el pago ni siquiera capturaba el método (efectivo vs transferencia).
--
-- SOLUCIÓN (simétrica al cobro de clientes, mig.130): RPC atómico que hace en una transacción:
--   1) CxP: movimiento 'pago' (reduce deuda del proveedor)
--   2) Caja: egreso. El trigger puente Caja→Bancos (mig.122) enruta a Bancos los métodos
--      distintos de Efectivo/Cuenta Corriente (si hay cuenta bancaria mapeada).
--
-- NOTA: sigue sin generar asiento contable (gap sistémico de sub-libros — ver PLAN_AUDITORIA.md).
--
-- ROLLBACK: DROP FUNCTION public.registrar_pago_proveedor(...);

CREATE OR REPLACE FUNCTION public.registrar_pago_proveedor(
  p_empresa_id       uuid,
  p_user_id          uuid,
  p_proveedor_id     uuid,
  p_proveedor_nombre text,
  p_monto            numeric,
  p_metodo           text,
  p_descripcion      text  DEFAULT NULL,
  p_caja_sesion_id   uuid  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_monto   numeric;
  v_ccp_id  uuid;
  v_caja_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;

  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto del pago debe ser mayor a cero';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.proveedores WHERE id = p_proveedor_id AND empresa_id = p_empresa_id) THEN
    RAISE EXCEPTION 'El proveedor no pertenece a la empresa';
  END IF;

  v_monto := ROUND(p_monto, 2);

  -- 1) Cuenta corriente proveedor: 'pago' reduce la deuda
  INSERT INTO public.cuenta_corriente_proveedores
    (empresa_id, proveedor_id, tipo, monto, descripcion, user_id, fecha)
  VALUES
    (p_empresa_id, p_proveedor_id, 'pago', v_monto,
     COALESCE(NULLIF(p_descripcion, ''), 'Pago a proveedor'), p_user_id, now())
  RETURNING id INTO v_ccp_id;

  -- 2) Caja: egreso. Trigger puente Caja→Bancos dispara acá para no-efectivo.
  INSERT INTO public.movimientos_caja
    (user_id, empresa_id, caja_sesion_id, fecha, tipo, categoria, concepto, monto, metodo_pago, is_automatic)
  VALUES
    (p_user_id, p_empresa_id, p_caja_sesion_id, now(), 'egreso', 'Pago Proveedor',
     'Pago a ' || COALESCE(NULLIF(p_proveedor_nombre, ''), 'proveedor') || ' - ' || p_metodo,
     v_monto, p_metodo, true)
  RETURNING id INTO v_caja_id;

  RETURN jsonb_build_object('ok', true, 'ccp_id', v_ccp_id, 'caja_id', v_caja_id);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.registrar_pago_proveedor(uuid,uuid,uuid,text,numeric,text,text,uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.registrar_pago_proveedor(uuid,uuid,uuid,text,numeric,text,text,uuid) TO authenticated;
