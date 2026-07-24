-- migration 245 — idempotencia real (constraint único) para movimientos
-- bancarios insertados por webhooks externos (MercadoPago, y a futuro Ualá)
--
-- CONTEXTO: cruzando un video sobre integrar MP+ARCA con un desarrollador de
-- integraciones (no relacionado a KAIROX) contra el código real, se encontró
-- que mp-webhook/index.ts dedupe contra reenvíos del mismo evento con un
-- `SELECT ... WHERE descripcion LIKE 'MP #<id>%'` — chequeo en código, texto
-- libre, sin índice único real. MP puede reenviar la misma notificación más
-- de una vez (reintentos de red); si dos requests casi simultáneos pasan
-- ambos el SELECT antes de que el primer INSERT se confirme (condición de
-- carrera), se genera un movimiento bancario duplicado. El video mostraba el
-- mismo problema conceptual aplicado a facturas (doble factura por webhook
-- duplicado) — en KAIROX no aplica a facturas porque la emisión de CAE es
-- una cola separada (facturas_pendientes_arca) sin relación directa con el
-- webhook de MP, pero el gap de fondo (falta de constraint único) sí es real
-- acá.
--
-- FIX: columna dedicada `external_ref` (separada de `descripcion`, que sigue
-- siendo texto libre para mostrar al usuario) + índice único por
-- (empresa_id, origen, external_ref). Ya no depende de un SELECT-then-INSERT
-- en código — el propio INSERT con ON CONFLICT DO NOTHING es atómico.

ALTER TABLE public.movimientos_bancarios
  ADD COLUMN IF NOT EXISTS external_ref TEXT;

COMMENT ON COLUMN public.movimientos_bancarios.external_ref IS
  'ID de la transacción en el sistema de origen (ej. payment_id de MercadoPago). Separado de descripcion (texto libre) para poder garantizar idempotencia con un constraint único real en vez de un LIKE sobre texto.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_movimientos_bancarios_external_ref
  ON public.movimientos_bancarios (empresa_id, origen, external_ref)
  WHERE external_ref IS NOT NULL;

-- Reemplaza la sobrecarga de 8 parámetros (con p_subtipo) — es la única que
-- usa mp-webhook (migration 079). La sobrecarga de 7 parámetros (sin
-- subtipo, otros callers) queda intacta, sin tocar.
DROP FUNCTION IF EXISTS public.insertar_movimiento_bancario_externo(
  uuid, uuid, timestamp with time zone, text, numeric, text, text, text
);

CREATE FUNCTION public.insertar_movimiento_bancario_externo(
  p_empresa_id         uuid,
  p_cuenta_bancaria_id uuid,
  p_fecha              timestamp with time zone,
  p_descripcion        text,
  p_monto              numeric,
  p_tipo               text,
  p_origen             text,
  p_subtipo            text DEFAULT NULL::text,
  p_external_ref       text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
      RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
    END IF;
    IF NOT has_module_permission('bancos') THEN
      RAISE EXCEPTION 'No autorizado: sin permiso de módulo bancos';
    END IF;
  END IF;

  IF p_tipo NOT IN ('ingreso', 'egreso') THEN
    RAISE EXCEPTION 'tipo inválido: debe ser ingreso o egreso';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.empresas WHERE id = p_empresa_id) THEN
    RAISE EXCEPTION 'empresa_id no encontrado';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cuentas_bancarias
    WHERE id = p_cuenta_bancaria_id AND empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'cuenta_bancaria_id no pertenece a la empresa';
  END IF;

  INSERT INTO public.movimientos_bancarios (
    empresa_id, cuenta_bancaria_id, fecha,
    descripcion, monto, tipo, origen, conciliado, subtipo, external_ref
  ) VALUES (
    p_empresa_id, p_cuenta_bancaria_id, p_fecha,
    p_descripcion, p_monto, p_tipo, p_origen, false, p_subtipo, p_external_ref
  )
  ON CONFLICT (empresa_id, origen, external_ref) WHERE external_ref IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL AND p_external_ref IS NOT NULL THEN
    -- Conflicto real: ya existía un movimiento con este mismo external_ref.
    -- Devolvemos el existente en vez de error — mismo criterio idempotente
    -- que ya usaba mp-webhook, ahora garantizado por el índice único en vez
    -- de un SELECT previo no atómico.
    SELECT id INTO v_id FROM public.movimientos_bancarios
    WHERE empresa_id = p_empresa_id AND origen = p_origen AND external_ref = p_external_ref;
    RETURN jsonb_build_object('id', v_id, 'ok', true, 'duplicate', true);
  END IF;

  RETURN jsonb_build_object('id', v_id, 'ok', true);
END;
$function$;

-- ROLLBACK (comentado):
-- DROP FUNCTION IF EXISTS public.insertar_movimiento_bancario_externo(uuid, uuid, timestamp with time zone, text, numeric, text, text, text, text);
-- (recrear la versión de 8 parámetros de migration 154 si hace falta revertir)
-- DROP INDEX IF EXISTS public.idx_movimientos_bancarios_external_ref;
-- ALTER TABLE public.movimientos_bancarios DROP COLUMN IF EXISTS external_ref;
