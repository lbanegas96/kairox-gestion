-- Migration 191 — Fix guard NULL-unsafe en reintentar_cae_comprobante y
-- reencolar_caes_pendientes (hallazgo CRÍTICO, auditoría sesión 59, 2026-07-11).
--
-- Ambas usaban `v_empresa_id <> get_my_empresa_id()` en vez de `IS DISTINCT FROM`.
-- Para un caller anónimo (sin JWT), get_my_empresa_id() devuelve NULL. La
-- comparación `<>` contra NULL da NULL (no TRUE/FALSE), y `IF NULL THEN` en
-- PL/pgSQL se trata como FALSE (comportamiento documentado de Postgres) — el
-- guard no dispara la excepción y la función sigue de largo.
--
-- reintentar_cae_comprobante está GRANTeada a `anon` (confirmado con
-- information_schema.routine_privileges) — cualquiera con la anon key pública
-- podía reencolar el CAE de un comprobante de CUALQUIER empresa sin loguearse.
-- reencolar_caes_pendientes NO está otorgada a anon (solo authenticated) — su
-- exposición real es mucho menor, pero mismo bug de fondo.
--
-- Fix: `IS DISTINCT FROM` (NULL-safe) — mismo patrón que ya usan correctamente
-- crear_venta, registrar_pago_proveedor, cambiar_estado_cheque, etc. Copia fiel
-- de la función viva (pg_get_functiondef) + el único operador corregido.

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

  IF v_empresa_id IS NULL OR v_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: comprobante no encontrado o de otra empresa';
  END IF;
  IF NOT has_module_permission('ventas') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
  END IF;
  IF v_punto_venta_id IS NULL THEN
    RAISE EXCEPTION 'El comprobante no tiene punto de venta AFIP asignado';
  END IF;

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
  IF p_empresa_id IS NULL OR p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
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

-- ROLLBACK (comentado): restaurar los `<>` originales desde este mismo archivo
-- (git log) si hiciera falta revertir — no debería, es un fix puro de guard.
