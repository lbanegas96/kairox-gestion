-- migration 358 — crear_cheque_propio ahora imputa contra la compra vinculada
--
-- HALLAZGO (Nadia, Fase 2 prueba integral Ferretería NADIA, 27/08): el modal de
-- Nuevo Cheque Propio permite elegir la "Compra asociada" (p_compra_id ya existe
-- en la firma desde mig.166), pero la función solo guardaba esa referencia en
-- cheques.compra_id — nunca insertaba nada en cuenta_corriente_proveedores ni en
-- cuenta_corriente_proveedores_imputaciones. Resultado: el saldo pendiente de la
-- factura del proveedor no bajaba aunque el cheque ya estuviera emitido y
-- vinculado — asimetría real contra crear_cheque_tercero (mig.211), que sí
-- imputa correctamente del lado cliente cuando se manda p_comprobante_id.
--
-- Fix: mismo patrón exacto que crear_cheque_tercero (comprobante único, no el
-- array p_imputaciones de registrar_pago_proveedor — esta función solo acepta
-- una compra a la vez, igual que su hermana ya hacía del lado cliente):
--   1. Si viene p_proveedor_id, inserta el DEBE... en realidad 'pago' en
--      cuenta_corriente_proveedores (mismo tipo que usa registrar_pago_proveedor).
--   2. Si además viene p_compra_id, valida que pertenezca a ese proveedor, que
--      el monto no supere el saldo pendiente, imputa en
--      cuenta_corriente_proveedores_imputaciones, y actualiza compras.estado_pago
--      (pagada/parcial/pendiente) — copia exacta de la lógica de mig.215.
--
-- Sin cambio de firma (mismos parámetros, mismo orden) — no hace falta DROP
-- FUNCTION, CREATE OR REPLACE alcanza. Retrocompatible: un cheque propio sin
-- proveedor_id (gasto genérico, no vinculado a ningún proveedor puntual) sigue
-- funcionando exactamente igual que antes, sin ningún movimiento de CC.

CREATE OR REPLACE FUNCTION public.crear_cheque_propio(p_empresa_id uuid, p_user_id uuid, p_numero text, p_banco text, p_monto numeric, p_fecha_emision date, p_fecha_vencimiento date, p_cuenta_bancaria_id uuid DEFAULT NULL::uuid, p_proveedor_id uuid DEFAULT NULL::uuid, p_compra_id uuid DEFAULT NULL::uuid, p_observaciones text DEFAULT NULL::text, p_es_electronico boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cheque_id     uuid;
  v_ccp_id        uuid;
  v_total_factura numeric;
  v_ya_imputado   numeric;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('cheques') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo cheques';
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a cero';
  END IF;
  IF p_proveedor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.proveedores WHERE id = p_proveedor_id AND empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'El proveedor no pertenece a la empresa';
  END IF;
  IF p_cuenta_bancaria_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.cuentas_bancarias WHERE id = p_cuenta_bancaria_id AND empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'La cuenta bancaria no pertenece a la empresa';
  END IF;

  INSERT INTO public.cheques (
    empresa_id, user_id, tipo, numero, banco, cuenta_bancaria_id, monto,
    fecha_emision, fecha_vencimiento, proveedor_id, compra_id, observaciones, estado, es_electronico
  ) VALUES (
    p_empresa_id, p_user_id, 'propio', p_numero, p_banco, p_cuenta_bancaria_id, p_monto,
    p_fecha_emision, p_fecha_vencimiento, p_proveedor_id, p_compra_id, p_observaciones, 'pendiente',
    COALESCE(p_es_electronico, false)
  ) RETURNING id INTO v_cheque_id;

  INSERT INTO public.cheques_historial (cheque_id, empresa_id, user_id, estado_anterior, estado_nuevo, observacion)
  VALUES (v_cheque_id, p_empresa_id, p_user_id, NULL, 'pendiente', 'Registro inicial');

  -- mig.358 — imputación contra la compra vinculada (mismo patrón que
  -- crear_cheque_tercero del lado cliente).
  IF p_proveedor_id IS NOT NULL THEN
    INSERT INTO public.cuenta_corriente_proveedores
      (empresa_id, proveedor_id, tipo, monto, descripcion, user_id, fecha)
    VALUES (p_empresa_id, p_proveedor_id, 'pago', p_monto,
            'Cheque propio Nº ' || p_numero || ' (' || p_banco || ')', p_user_id, p_fecha_emision)
    RETURNING id INTO v_ccp_id;

    IF p_compra_id IS NOT NULL THEN
      SELECT total INTO v_total_factura FROM public.compras
       WHERE id = p_compra_id AND empresa_id = p_empresa_id AND proveedor_id = p_proveedor_id
       FOR UPDATE;
      IF v_total_factura IS NULL THEN
        RAISE EXCEPTION 'La compra % no existe o no pertenece a este proveedor', p_compra_id;
      END IF;
      SELECT COALESCE(SUM(monto), 0) INTO v_ya_imputado
        FROM public.cuenta_corriente_proveedores_imputaciones WHERE factura_compra_id = p_compra_id;
      IF p_monto > (v_total_factura - v_ya_imputado) THEN
        RAISE EXCEPTION 'El monto del cheque (%) supera el saldo pendiente de la compra (%)', p_monto, v_total_factura - v_ya_imputado;
      END IF;
      INSERT INTO public.cuenta_corriente_proveedores_imputaciones
        (empresa_id, pago_movimiento_id, factura_compra_id, monto)
      VALUES (p_empresa_id, v_ccp_id, p_compra_id, p_monto);
      UPDATE public.compras
         SET estado_pago = CASE
                              WHEN (v_ya_imputado + p_monto) >= v_total_factura THEN 'pagada'
                              WHEN (v_ya_imputado + p_monto) > 0 THEN 'parcial'
                              ELSE 'pendiente'
                            END
       WHERE id = p_compra_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('id', v_cheque_id);
END;
$function$;

-- ROLLBACK (comentado): CREATE OR REPLACE FUNCTION public.crear_cheque_propio(...)
-- con el body de la migration 211 (sin el bloque IF p_proveedor_id IS NOT NULL de
-- imputación agregado arriba).
