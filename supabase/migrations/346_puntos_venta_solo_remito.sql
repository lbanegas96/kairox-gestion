-- Ajuste chico pedido por Luciano (23/08): en "Nueva Factura" aparecía el PdV
-- "Remito (interno)" mezclado con el PdV fiscal real, seleccionable como si
-- fuera válido para facturar. Investigado: `envia_arca=false` NO alcanza
-- como criterio de exclusión — el propio TabFacturacion.jsx ya lo usa a
-- propósito para el PdV interno del Modo Caja (POS que no manda a ARCA pero
-- SÍ factura internamente, ver comentario "interno, no factura" ahí — ese
-- caso es legítimo). La distinción real es otra: un PdV puede existir
-- ÚNICAMENTE para numerar remitos (CAI de remito), sin ser nunca elegible
-- para facturar — eso no tenía forma de expresarse en el schema.

ALTER TABLE public.puntos_venta
  ADD COLUMN IF NOT EXISTS solo_remito boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.puntos_venta.solo_remito IS
  'true = este PdV existe solo para numerar remitos (CAI de remito); no se ofrece en los selectores de Nueva Factura.';

-- Backfill puntual: el único PdV que hoy encaja en esa descripción es el
-- literalmente llamado "Remito" (envia_arca=false, con cai_remito cargado,
-- nunca usado para facturar en la práctica).
UPDATE public.puntos_venta
   SET solo_remito = true
 WHERE lower(trim(nombre)) = 'remito'
   AND envia_arca = false;

-- emitir_remito ya elegía "el primer PdV interno" como fallback cuando no se
-- pasa uno explícito — ahora prioriza los marcados solo_remito (más preciso),
-- y si no hay ninguno marcado, sigue cayendo al criterio viejo (compatibilidad
-- con empresas que todavía no marcaron ningún PdV así).
CREATE OR REPLACE FUNCTION public.emitir_remito(p_empresa_id uuid, p_entrega_id uuid, p_punto_venta_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_entrega     RECORD;
  v_pv          RECORD;
  v_numero      INTEGER;
  v_numero_fmt  TEXT;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el tenant del caller';
  END IF;
  IF NOT has_module_permission('ventas') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
  END IF;

  SELECT * INTO v_entrega
  FROM public.entregas
  WHERE id = p_entrega_id AND empresa_id = p_empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entrega no encontrada';
  END IF;
  IF v_entrega.numero_remito IS NOT NULL THEN
    RAISE EXCEPTION 'Esta entrega ya tiene remito emitido (Nº %)', v_entrega.numero_remito;
  END IF;

  IF p_punto_venta_id IS NOT NULL THEN
    SELECT * INTO v_pv
    FROM public.puntos_venta
    WHERE id = p_punto_venta_id AND empresa_id = p_empresa_id
    FOR UPDATE;
  ELSE
    -- Preferencia: PdV marcado solo_remito primero, después cualquier interno
    -- (envia_arca=false) como antes — mismo criterio simple que
    -- useAfipConfig.js usa para el fiscal, con la prioridad nueva arriba.
    SELECT * INTO v_pv
    FROM public.puntos_venta
    WHERE empresa_id = p_empresa_id AND activo = true AND envia_arca = false
    ORDER BY solo_remito DESC, es_default DESC, numero ASC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay un punto de venta interno (no fiscal) configurado para remitos. Creá uno en Configuración > Facturación con "Envía a ARCA" desactivado.';
  END IF;
  IF v_pv.cai_remito IS NULL OR v_pv.cai_remito = '' THEN
    RAISE EXCEPTION 'El punto de venta "%" no tiene CAI de remito cargado.', v_pv.nombre;
  END IF;
  IF v_pv.cai_remito_vencimiento IS NOT NULL AND v_pv.cai_remito_vencimiento < CURRENT_DATE THEN
    RAISE EXCEPTION 'El CAI de remito del punto de venta "%" venció el %.', v_pv.nombre, v_pv.cai_remito_vencimiento;
  END IF;

  v_numero := v_pv.proximo_numero_remito;
  v_numero_fmt := LPAD(v_pv.numero::TEXT, 4, '0') || '-' || LPAD(v_numero::TEXT, 8, '0');

  UPDATE public.puntos_venta
  SET proximo_numero_remito = v_numero + 1
  WHERE id = v_pv.id;

  UPDATE public.entregas
  SET punto_venta_id                = v_pv.id,
      numero_remito                 = v_numero_fmt,
      cai_remito_usado              = v_pv.cai_remito,
      cai_remito_vencimiento_usado  = v_pv.cai_remito_vencimiento
  WHERE id = p_entrega_id;

  RETURN jsonb_build_object(
    'entrega_id', p_entrega_id,
    'numero_remito', v_numero_fmt,
    'cai', v_pv.cai_remito,
    'cai_vencimiento', v_pv.cai_remito_vencimiento,
    'punto_venta_nombre', v_pv.nombre
  );
END;
$function$;
