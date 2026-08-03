-- mig.300 — Restaurar dos controles de seguridad que regresionaron en silencio
--
-- Salió de la auditoría de las 82 funciones SECURITY DEFINER ejecutables por
-- `authenticated` (advisors de Supabase, 2026-08-03). Balance general tranquilizador:
-- 50 tienen guard explícito (`RAISE` si p_empresa_id no coincide con
-- get_my_empresa_id()), 19 derivan el tenant del JWT sin confiar en parámetros,
-- 1 tiene el guard inline en el WHERE (get_tasa_cambio), 7 son funciones de
-- trigger (PostgREST no expone funciones que retornan `trigger`, no hay
-- superficie de ataque). Sólo 2 problemas reales — los de esta migración.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 1) seed_series_numeracion — perdió el guard de tenant que le puso la mig.057
-- ─────────────────────────────────────────────────────────────────────────────
-- La mig.057 existe específicamente para ponerle un guard de tenant a las dos
-- funciones de seed. Hoy `seed_maestros_default` lo conserva y
-- `seed_series_numeracion` NO. Rastreado exactamente: la 057 lo puso, la 086 lo
-- respetó, y la **mig.268** lo borró al redefinir la función para agregar
-- `nota_debito_venta` — se copió el cuerpo anterior a la 057. La mig.277 arrastró
-- el mismo error al agregar `nota_credito_proveedor`.
--
-- Severidad BAJA (misma que la 057 evaluó en su momento): el INSERT tiene
-- ON CONFLICT DO NOTHING, así que llamarla contra una empresa ya sembrada es un
-- no-op. Pero contra una empresa NO sembrada sí escribiría en otro inquilino, y
-- de todos modos es un control documentado que desapareció sin que nadie lo note.
--
-- Se restaura el guard EXACTO de la 057 — no uno más estricto. El motivo está
-- documentado en la 057 y sigue vigente: el único invocador real es el trigger
-- AFTER INSERT ON empresas dentro de create_tenant(), y en ese momento
-- get_my_empresa_id() todavía devuelve NULL (handle_new_user crea el profile con
-- empresa_id NULL, y create_tenant inserta en `empresas` ANTES de vincular el
-- profile). Un guard estricto `p_empresa_id = get_my_empresa_id()` rompería TODO
-- alta de empresa nueva. Por eso la condición incluye el escape "…AND el usuario
-- ya tiene empresa asignada".
--
-- Se preservan los 11 tipos de documento actuales tal cual (los 9 originales de
-- la 057 + nota_debito_venta de la 268 + nota_credito_proveedor de la 277).
-- CREATE OR REPLACE conserva los GRANT existentes.

CREATE OR REPLACE FUNCTION public.seed_series_numeracion(p_empresa_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Guard restaurado de la mig.057 (perdido en la 268).
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id()
     AND (SELECT empresa_id FROM public.profiles WHERE id = auth.uid()) IS NOT NULL THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;

  INSERT INTO public.series_numeracion (empresa_id, tipo_documento, prefijo, formato_fecha, digitos) VALUES
    (p_empresa_id, 'venta',                  '',     'YYYYMMDD', 3),
    (p_empresa_id, 'factura',                'FAC-', 'YYYYMMDD', 3),
    (p_empresa_id, 'nota_credito',           'NC-',  'YYYYMMDD', 3),
    (p_empresa_id, 'nota_debito_venta',      'ND-',  'YYYYMMDD', 3),
    (p_empresa_id, 'nota_credito_proveedor', 'NC-',  'YYYYMMDD', 3),
    (p_empresa_id, 'pedido',                 'PED-', 'YYYYMMDD', 3),
    (p_empresa_id, 'nota_debito',            'ND-',  'YYYY',     4),
    (p_empresa_id, 'entrega',                'ENT-', 'YYYY',     4),
    (p_empresa_id, 'recepcion',              'REC-', 'YYYY',     4),
    (p_empresa_id, 'orden_compra',           'OC-',  'ninguno',  5),
    (p_empresa_id, 'cotizacion',             'COT-', 'ninguno',  5)
  ON CONFLICT (empresa_id, tipo_documento) DO NOTHING;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) record_attempt — `authenticated` podía ejecutarla, contra lo que dice el test
-- ─────────────────────────────────────────────────────────────────────────────
-- `supabase/tests/aislamiento_multitenant.test.sql` (Caso 8) afirma que un
-- usuario autenticado común NO puede llamar record_attempt. En producción el ACL
-- era {postgres, authenticated, service_role} — o sea el test estaba FALLANDO.
--
-- De dónde salió: ninguna migración del repo hace ese GRANT. Viene de los default
-- privileges de Supabase al crear la función (mig.016), y la mig.063 revocó de
-- PUBLIC y anon pero no de authenticated.
--
-- Verificado antes de revocar: la función está completamente huérfana — no la
-- llama el frontend (grep en src/), ni las edge functions, ni ninguna otra
-- función de la base (consulta sobre pg_proc). El comentario del propio test que
-- decía "solo la llaman otras RPCs internamente" tampoco era exacto. Revocar es
-- inocuo hoy.
--
-- Severidad BAJA porque el rate limiting no está cableado a nada. Si se cableara,
-- un atacante autenticado podría llamar record_attempt('login','victima@mail')
-- N veces y dejar esa cuenta bloqueada (check_rate_limit sólo cuenta filas).
-- Al revocar, esa superficie desaparece antes de que exista el riesgo.

REVOKE EXECUTE ON FUNCTION public.record_attempt(text, text, uuid) FROM authenticated;

-- Nota: check_rate_limit queda como está — es de sólo lectura (SELECT COUNT) y no
-- expone datos de ningún tenant, así que no hay nada que cerrar ahí.
