-- Fix bug silencioso de "Reintentar CAE": el UPDATE por comprobante_id desde
-- HistorialVentas.jsx/SaleDetailModal.jsx chocaba contra uq_fpa_comprobante_activo
-- cuando el comprobante tenía más de 1 fila en facturas_pendientes_arca (ej. una vieja
-- 'error_definitivo' + una más nueva de un reencolado masivo anterior), y supabase-js
-- no lanza excepción en un .update() sin chequear `error`, así que el frontend mostraba
-- "CAE reencolado" en falso mientras la cola nunca se movía.
--
-- Mismo defecto de raíz confirmado en reencolar_caes_pendientes (mig.087/151): su UPDATE
-- interno filtra `estado IN ('pendiente','reintentando','error_datos','error_definitivo')`
-- — si 2 filas históricas coinciden con ese filtro (ej. 2 'error_definitivo'), el UPDATE
-- las movería a ambas a 'pendiente' en el mismo statement, violando el mismo índice único.
--
-- Fix: en ambos casos, tocar SIEMPRE la fila más reciente por comprobante_id (por id, no
-- por un WHERE que pueda matchear más de una fila), nunca un blanket update.

-- 1) Nueva RPC para el botón de reintento puntual (reemplaza el UPDATE directo del frontend)
CREATE OR REPLACE FUNCTION public.reintentar_cae_comprobante(p_comprobante_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id      uuid;
  v_punto_venta_id  uuid;
  v_tipo             text;
  v_fila_id          uuid;
BEGIN
  SELECT empresa_id, punto_venta_id, COALESCE(tipo_comprobante_afip, 'B')
    INTO v_empresa_id, v_punto_venta_id, v_tipo
    FROM public.comprobantes
   WHERE id = p_comprobante_id;

  IF v_empresa_id IS NULL OR v_empresa_id <> get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: comprobante no encontrado o de otra empresa';
  END IF;
  IF NOT has_module_permission('ventas') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
  END IF;
  IF v_punto_venta_id IS NULL THEN
    RAISE EXCEPTION 'El comprobante no tiene punto de venta AFIP asignado';
  END IF;

  -- Fila más reciente de la cola para este comprobante (si existe alguna)
  SELECT id INTO v_fila_id
    FROM public.facturas_pendientes_arca
   WHERE comprobante_id = p_comprobante_id
   ORDER BY created_at DESC
   LIMIT 1
   FOR UPDATE;

  IF v_fila_id IS NOT NULL THEN
    UPDATE public.facturas_pendientes_arca
       SET estado          = 'pendiente',
           intentos        = 0,
           proximo_intento = now(),
           error_mensaje   = NULL,
           updated_at      = now()
     WHERE id = v_fila_id;
  ELSE
    INSERT INTO public.facturas_pendientes_arca (
      empresa_id, comprobante_id, punto_venta_id,
      tipo_comprobante, codigo_afip, payload_arca,
      estado, proximo_intento
    ) VALUES (
      v_empresa_id, p_comprobante_id, v_punto_venta_id,
      v_tipo,
      CASE v_tipo WHEN 'A' THEN 1::smallint WHEN 'C' THEN 11::smallint ELSE 6::smallint END,
      '{}'::jsonb, 'pendiente', now()
    );
  END IF;

  UPDATE public.comprobantes
     SET cae_estado = 'pendiente', error_afip = NULL
   WHERE id = p_comprobante_id;

  RETURN true;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.reintentar_cae_comprobante(uuid) TO authenticated;

-- 2) Mismo fix aplicado a reencolar_caes_pendientes (batch) — target por fila específica
CREATE OR REPLACE FUNCTION public.reencolar_caes_pendientes(p_empresa_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
  r RECORD;
  v_fila_id uuid;
BEGIN
  IF p_empresa_id IS NULL OR p_empresa_id <> get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el tenant del caller';
  END IF;
  IF NOT has_module_permission('ventas') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
  END IF;

  FOR r IN
    SELECT c.id, c.punto_venta_id, COALESCE(c.tipo_comprobante_afip, 'B') AS tipo
    FROM public.comprobantes c
    WHERE c.empresa_id = p_empresa_id
      AND c.cae_estado IN ('pendiente', 'error')
      AND c.relevante_fiscal = true
    ORDER BY c.fecha ASC
    LIMIT 50
  LOOP
    SELECT id INTO v_fila_id
      FROM public.facturas_pendientes_arca
     WHERE comprobante_id = r.id
     ORDER BY created_at DESC
     LIMIT 1
     FOR UPDATE;

    IF v_fila_id IS NOT NULL THEN
      UPDATE public.facturas_pendientes_arca
         SET estado          = 'pendiente',
             intentos        = 0,
             proximo_intento = now(),
             error_mensaje   = NULL,
             updated_at      = now()
       WHERE id = v_fila_id;
    ELSE
      INSERT INTO public.facturas_pendientes_arca (
        empresa_id, comprobante_id, punto_venta_id,
        tipo_comprobante, codigo_afip, payload_arca,
        estado, proximo_intento
      ) VALUES (
        p_empresa_id, r.id, r.punto_venta_id,
        r.tipo,
        CASE r.tipo WHEN 'A' THEN 1::smallint WHEN 'C' THEN 11::smallint ELSE 6::smallint END,
        '{}'::jsonb, 'pendiente', now()
      );
    END IF;

    UPDATE public.comprobantes
       SET cae_estado = 'pendiente', error_afip = NULL
     WHERE id = r.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;
