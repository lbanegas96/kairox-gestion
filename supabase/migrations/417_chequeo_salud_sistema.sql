-- 417 — Chequeo de salud del sistema, con aviso (auditoría 24/09, OPE-3)
--
-- PROBLEMA: no había ninguna forma de enterarse de que algo dejó de funcionar. Las tareas de cron figuran "succeeded"
-- aunque el proceso que llaman responda error (`net.http_post` solo encola el pedido): la sincronización de Mercado
-- Pago estuvo caída del 14 al 29/07 sin ningún síntoma visible.
--
-- QUÉ AGREGA (todo del lado de la base, sin depender de ningún servicio externo):
--   1) `chequeo_salud_sistema()` — mira 10 cosas y devuelve un JSON con el estado de cada una (ok / atencion / critico):
--        · tareas programadas (¿corrieron a tiempo? ¿fallaron?)        · respuestas de los procesos automáticos (net._http_response)
--        · cola de ARCA (atascada / errores nuevos)                    · colas de Tiendanube y MercadoLibre
--        · cobros con QR de Mercado Pago sin vencer a tiempo           · cotización automática del dólar
--        · espacio de la base de datos (contra el tope del plan)       · documentos de los últimos 7 días sin asiento contable
--        · asientos descuadrados (últimos 3 días)                      · cantidad de empresas y usuarios nuevos en 24 h
--      Es de solo lectura. Mira TODAS las empresas juntas (es un chequeo de plataforma, no de una empresa) y por eso solo
--      lo puede ejecutar el servicio; ningún usuario de una empresa lo ve ni lo puede llamar.
--   2) `salud_sistema_chequeos` — historial de los resultados (30 días). Sin políticas de lectura a propósito: es un dato
--      de plataforma y ningún usuario de una empresa debe verlo.
--   3) `ejecutar_chequeo_salud()` — corre el chequeo, guarda el resultado y AVISA si hace falta. La tarea de cron
--      `chequeo-salud-sistema-cada-hora` lo llama a los 7 minutos de cada hora.
--   4) El aviso sale por un webhook (Discord / Slack, o cualquier servicio que acepte un JSON con `content` o `text`).
--      La dirección se guarda en el Vault con el nombre `alerta_webhook_url`. MIENTRAS NO EXISTA ESE SECRETO no se envía
--      nada (el chequeo igual corre y queda guardado): activar los avisos es crear ese secreto, sin tocar código.
--      El mensaje lleva solo títulos y cantidades, nunca datos de clientes, proveedores ni usuarios.
--
-- CUÁNDO AVISA (para no llenar el canal de ruido):
--   · `critico`: avisa en la primera corrida en que aparece.
--   · `atencion`: espera a que aparezca en dos corridas seguidas (descarta los tropiezos de una sola hora).
--   · Si ya avisó, no repite hasta que EMPEORE (atencion → critico) o pasen 12 horas (recordatorio).
--   · Cuando todo vuelve a `ok` después de un aviso, manda un solo mensaje de "normalizado".
--
-- Idempotente: se puede correr más de una vez. Para desactivarlo: `SELECT cron.unschedule('chequeo-salud-sistema-cada-hora');`
--
-- Probado en sandbox contra producción (BEGIN..ROLLBACK) con datos inventados: cada chequeo cambia de estado cuando se
-- planta su caso, el aviso se encola una sola vez, se repite tras 12 h, empeorar avisa, normalizarse avisa, y los usuarios
-- no pueden ejecutar nada ni leer el historial. Ver supabase/tests/salud_sistema.test.sql.

-- ───────────────────────────────────────────────────────────────────────────
-- 1) Historial de chequeos
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.salud_sistema_chequeos (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ejecutado_en    timestamptz NOT NULL DEFAULT now(),
  estado          text NOT NULL CHECK (estado IN ('ok', 'atencion', 'critico')),
  resultado       jsonb NOT NULL,
  -- Estado del aviso: se arrastra de una corrida a la siguiente mientras el aviso siga abierto.
  aviso_abierto   boolean NOT NULL DEFAULT false,
  estado_avisado  text CHECK (estado_avisado IN ('atencion', 'critico')),
  ultimo_aviso_en timestamptz
);

CREATE INDEX IF NOT EXISTS idx_salud_sistema_chequeos_ejecutado ON public.salud_sistema_chequeos (ejecutado_en DESC);

COMMENT ON TABLE public.salud_sistema_chequeos IS
  'Historial del chequeo de salud de la plataforma (mig. 417). Dato de plataforma, no de una empresa: RLS activo y SIN políticas a propósito, solo lo lee el servicio.';

ALTER TABLE public.salud_sistema_chequeos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.salud_sistema_chequeos FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.salud_sistema_chequeos TO service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 2) Ayudantes internos (nadie los ejecuta directamente)
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.salud_item(
  p_codigo text, p_titulo text, p_estado text, p_detalle text, p_datos jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object('codigo', p_codigo, 'titulo', p_titulo, 'estado', p_estado,
                            'detalle', p_detalle, 'datos', COALESCE(p_datos, '{}'::jsonb))
$function$;

-- Envía el mensaje al webhook guardado en el Vault. Devuelve true solo si lo dejó encolado; false si no hay webhook
-- configurado o si algo falló (un aviso que no sale nunca debe romper el chequeo).
CREATE OR REPLACE FUNCTION public.salud_enviar_aviso(p_mensaje text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_url text;
BEGIN
  SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets
   WHERE name = 'alerta_webhook_url'
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_url IS NULL OR btrim(v_url) = '' THEN
    RETURN false;
  END IF;

  PERFORM net.http_post(
    url := btrim(v_url),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object('content', left(p_mensaje, 1900), 'text', left(p_mensaje, 1900)),
    timeout_milliseconds := 5000
  );
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'salud_enviar_aviso: no se pudo encolar el aviso (%)', SQLERRM;
  RETURN false;
END
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- 3) El chequeo
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.chequeo_salud_sistema(p_limite_base_mb numeric DEFAULT 500)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ahora   timestamptz := now();
  v_hoy_ar  date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_items   jsonb := '[]'::jsonb;
  v_estado  text;
  v_detalle text;
  v_lista   text;
  v_a       integer;
  v_b       integer;
  v_c       integer;
  v_d       integer;
  v_total   integer;
  v_mb      numeric;
  v_pct     numeric;
  v_ult     date;
BEGIN
  -- 1) Tareas programadas: las que corren cada minuto/cada N minutos no pueden llevar más de 15 minutos sin correr; las
  --    diarias, no más de 26 horas. Una tarea diaria sin ninguna corrida registrada no se marca (puede ser recién creada).
  IF to_regclass('cron.job') IS NOT NULL AND to_regclass('cron.job_run_details') IS NOT NULL THEN
    SELECT count(*) FILTER (WHERE tarde AND frecuente),
           count(*) FILTER (WHERE tarde AND NOT frecuente),
           COALESCE(string_agg(jobname, ', ' ORDER BY jobname) FILTER (WHERE tarde), '')
      INTO v_a, v_b, v_lista
      FROM (
        SELECT jobname, frecuente,
               CASE WHEN frecuente THEN COALESCE(ultimo_inicio < v_ahora - interval '15 minutes', true)
                    ELSE COALESCE(ultimo_inicio < v_ahora - interval '26 hours', false) END AS tarde
          FROM (
            SELECT j.jobname,
                   (j.schedule ~ '^(\*|\*/[0-9]+) \* \* \* \*$') AS frecuente,
                   (SELECT max(d.start_time) FROM cron.job_run_details d WHERE d.jobid = j.jobid) AS ultimo_inicio
              FROM cron.job j
             WHERE j.active
          ) x
      ) y;

    SELECT count(*) INTO v_c
      FROM cron.job_run_details d
     WHERE d.status = 'failed' AND d.start_time > v_ahora - interval '24 hours';

    v_estado := CASE WHEN v_a > 0 THEN 'critico' WHEN v_b > 0 OR v_c > 0 THEN 'atencion' ELSE 'ok' END;
    v_detalle := CASE
      WHEN v_a + v_b > 0 THEN format('%s tarea(s) programada(s) atrasada(s): %s.', v_a + v_b, v_lista)
      WHEN v_c > 0 THEN format('%s corrida(s) fallida(s) de tareas programadas en las últimas 24 h.', v_c)
      ELSE 'Las tareas programadas están corriendo a tiempo.' END;
    v_items := v_items || jsonb_build_array(public.salud_item('cron_jobs', 'Tareas programadas', v_estado, v_detalle,
      jsonb_build_object('atrasadas_frecuentes', v_a, 'atrasadas_diarias', v_b, 'fallidas_24h', v_c)));
  END IF;

  -- 2) Respuestas de los procesos automáticos (pg_net guarda ~6 horas). Cuenta como error todo lo que no sea 2xx/3xx:
  --    4xx/5xx y también los pedidos sin respuesta (timeout / DNS). Un 1-2 % de timeouts sueltos es normal.
  IF to_regclass('net._http_response') IS NOT NULL THEN
    SELECT count(*),
           count(*) FILTER (WHERE status_code IS NULL OR status_code >= 400),
           count(*) FILTER (WHERE status_code IN (401, 403)),
           count(*) FILTER (WHERE status_code >= 500),
           count(*) FILTER (WHERE status_code IS NULL)
      INTO v_total, v_a, v_b, v_c, v_d
      FROM net._http_response
     WHERE created > v_ahora - interval '2 hours';
    v_pct := CASE WHEN v_total = 0 THEN 0 ELSE v_a::numeric / v_total END;
    v_estado := CASE WHEN v_total >= 20 AND v_pct >= 0.5 THEN 'critico'
                     WHEN v_total >= 20 AND v_pct >= 0.1 THEN 'atencion'
                     ELSE 'ok' END;
    v_detalle := CASE WHEN v_total = 0 THEN 'Sin llamadas registradas en las últimas 2 h.'
      ELSE format('En las últimas 2 h: %s llamadas, %s con error (%s %%). Rechazos 401/403: %s, errores 5xx: %s, sin respuesta: %s.',
                  v_total, v_a, round(v_pct * 100), v_b, v_c, v_d) END;
    v_items := v_items || jsonb_build_array(public.salud_item('workers_respuestas', 'Respuestas de los procesos automáticos', v_estado, v_detalle,
      jsonb_build_object('llamadas', v_total, 'con_error', v_a, 'rechazos_401_403', v_b, 'errores_5xx', v_c, 'sin_respuesta', v_d)));
  END IF;

  -- 3) Cola de facturación electrónica (ARCA): comprobantes esperando CAE que nadie procesa, y errores nuevos.
  SELECT count(*) FILTER (WHERE estado IN ('pendiente', 'procesando', 'reintentando')
                           AND proximo_intento < v_ahora - interval '30 minutes' AND updated_at < v_ahora - interval '30 minutes'),
         count(*) FILTER (WHERE estado IN ('pendiente', 'procesando', 'reintentando')
                           AND proximo_intento < v_ahora - interval '4 hours' AND updated_at < v_ahora - interval '4 hours'),
         count(*) FILTER (WHERE estado IN ('error_definitivo', 'error_datos') AND updated_at > v_ahora - interval '24 hours')
    INTO v_a, v_b, v_c
    FROM public.facturas_pendientes_arca;
  v_estado := CASE WHEN v_b > 0 THEN 'critico' WHEN v_a > 0 OR v_c > 0 THEN 'atencion' ELSE 'ok' END;
  v_detalle := CASE
    WHEN v_a > 0 AND v_c > 0 THEN format('%s comprobante(s) esperando CAE hace más de 30 min (%s hace más de 4 h) y %s con error nuevo en 24 h.', v_a, v_b, v_c)
    WHEN v_a > 0 THEN format('%s comprobante(s) esperando CAE hace más de 30 min (%s hace más de 4 h).', v_a, v_b)
    WHEN v_c > 0 THEN format('%s comprobante(s) con error nuevo en las últimas 24 h.', v_c)
    ELSE 'La cola de ARCA está al día.' END;
  v_items := v_items || jsonb_build_array(public.salud_item('cola_arca', 'Cola de facturación electrónica (ARCA)', v_estado, v_detalle,
    jsonb_build_object('atascados_30min', v_a, 'atascados_4h', v_b, 'errores_24h', v_c)));

  -- 4) Sincronización con Tiendanube / MercadoLibre (stock y publicación de catálogo).
  SELECT count(*) FILTER (WHERE estado IN ('pendiente', 'procesando')
                           AND proximo_intento < v_ahora - interval '30 minutes' AND updated_at < v_ahora - interval '30 minutes'),
         count(*) FILTER (WHERE estado IN ('pendiente', 'procesando')
                           AND proximo_intento < v_ahora - interval '4 hours' AND updated_at < v_ahora - interval '4 hours'),
         count(*) FILTER (WHERE estado = 'error_definitivo' AND updated_at > v_ahora - interval '24 hours')
    INTO v_a, v_b, v_c
    FROM (
      SELECT estado, proximo_intento, updated_at FROM public.integraciones_stock_pendiente
      UNION ALL
      SELECT estado, proximo_intento, updated_at FROM public.integraciones_producto_pendiente
    ) q;
  v_estado := CASE WHEN v_b > 0 THEN 'critico' WHEN v_a > 0 OR v_c > 0 THEN 'atencion' ELSE 'ok' END;
  v_detalle := CASE
    WHEN v_a > 0 AND v_c > 0 THEN format('%s pedido(s) de sincronización atascado(s) hace más de 30 min (%s hace más de 4 h) y %s con error nuevo en 24 h.', v_a, v_b, v_c)
    WHEN v_a > 0 THEN format('%s pedido(s) de sincronización atascado(s) hace más de 30 min (%s hace más de 4 h).', v_a, v_b)
    WHEN v_c > 0 THEN format('%s pedido(s) de sincronización con error nuevo en las últimas 24 h.', v_c)
    ELSE 'Las colas de Tiendanube y MercadoLibre están al día.' END;
  v_items := v_items || jsonb_build_array(public.salud_item('colas_integraciones', 'Sincronización con Tiendanube / MercadoLibre', v_estado, v_detalle,
    jsonb_build_object('atascados_30min', v_a, 'atascados_4h', v_b, 'errores_24h', v_c)));

  -- 5) Cobros con QR de Mercado Pago: un QR pendiente que ya venció hace más de 15 minutos tendría que haberlo dado de
  --    baja el poller (`expirar_qrs_vencidos`); si no lo hizo, el poller no está corriendo.
  SELECT count(*) INTO v_a
    FROM public.qr_pagos_mp
   WHERE estado = 'pendiente' AND expiracion < v_ahora - interval '15 minutes';
  v_estado := CASE WHEN v_a > 0 THEN 'atencion' ELSE 'ok' END;
  v_detalle := CASE WHEN v_a > 0 THEN format('%s QR pendiente(s) vencido(s) hace más de 15 min sin darse de baja.', v_a)
                    ELSE 'Los cobros con QR se vencen a tiempo.' END;
  v_items := v_items || jsonb_build_array(public.salud_item('qr_mercadopago', 'Cobros con QR de Mercado Pago', v_estado, v_detalle,
    jsonb_build_object('vencidos_sin_baja', v_a)));

  -- 6) Cotización automática del dólar: la tarea de las 8 (hora Argentina) tiene que estar dejando cotizaciones. Se tolera
  --    un fin de semana largo (más de 3 días → atención, más de 6 → crítico). Sin cotizaciones automáticas no aplica.
  SELECT max(fecha) INTO v_ult FROM public.tipos_cambio WHERE origen = 'automatico';
  IF v_ult IS NULL THEN
    v_estado := 'ok';
    v_detalle := 'No hay cotización automática configurada (no aplica).';
  ELSE
    v_estado := CASE WHEN v_hoy_ar - v_ult > 6 THEN 'critico' WHEN v_hoy_ar - v_ult > 3 THEN 'atencion' ELSE 'ok' END;
    v_detalle := format('Última cotización automática: %s (hace %s día(s)).', to_char(v_ult, 'DD/MM/YYYY'), v_hoy_ar - v_ult);
  END IF;
  v_items := v_items || jsonb_build_array(public.salud_item('tipo_de_cambio', 'Cotización automática del dólar', v_estado, v_detalle,
    jsonb_build_object('ultima_fecha', v_ult, 'dias', CASE WHEN v_ult IS NULL THEN NULL ELSE v_hoy_ar - v_ult END)));

  -- 7) Espacio de la base de datos contra el tope del plan (500 MB en el plan Free). Además, el historial de las tareas
  --    programadas: si supera las 60.000 filas la purga diaria no está corriendo.
  v_mb := round(pg_database_size(current_database()) / 1048576.0, 1);
  v_pct := CASE WHEN p_limite_base_mb > 0 THEN v_mb / p_limite_base_mb ELSE 0 END;
  v_a := 0;
  IF to_regclass('cron.job_run_details') IS NOT NULL THEN
    SELECT count(*) INTO v_a FROM cron.job_run_details;
  END IF;
  v_estado := CASE WHEN v_pct >= 0.85 THEN 'critico' WHEN v_pct >= 0.6 OR v_a > 60000 THEN 'atencion' ELSE 'ok' END;
  v_detalle := format('La base ocupa %s MB de %s MB (%s %%).', v_mb, round(p_limite_base_mb), round(v_pct * 100))
               || CASE WHEN v_a > 60000 THEN format(' El historial de tareas programadas tiene %s filas: la purga diaria no está corriendo.', v_a) ELSE '' END;
  v_items := v_items || jsonb_build_array(public.salud_item('base_de_datos', 'Espacio de la base de datos', v_estado, v_detalle,
    jsonb_build_object('mb', v_mb, 'limite_mb', p_limite_base_mb, 'filas_historial_cron', v_a)));

  -- 8) Documentos de los últimos 7 días (y de más de 15 minutos, para no confundir uno que se está creando) sin asiento
  --    contable. Es la señal de que el asiento "no bloqueante" de una compra o una venta falló en silencio. Mismo criterio
  --    que el reporte de conciliación de cuentas de control (mig. 414).
  SELECT count(*) INTO v_a
    FROM (
      SELECT 1
        FROM public.comprobantes c
       WHERE c.tipo IN ('venta', 'nota_credito', 'nota_debito') AND c.estado_pago <> 'cancelada' AND c.asiento_id IS NULL
         AND c.fecha BETWEEN v_ahora - interval '7 days' AND v_ahora - interval '15 minutes'
         AND NOT EXISTS (SELECT 1 FROM public.asientos_contables a
                          WHERE a.empresa_id = c.empresa_id AND a.origen_id = c.id
                            AND a.origen IN ('venta', 'nota_credito', 'nota_debito') AND a.estado = 'confirmado')
      UNION ALL
      SELECT 1
        FROM public.compras co
       WHERE co.estado_pago <> 'anulada' AND co.asiento_id IS NULL
         AND co.created_at BETWEEN v_ahora - interval '7 days' AND v_ahora - interval '15 minutes'
         AND NOT EXISTS (SELECT 1 FROM public.asientos_contables a
                          WHERE a.empresa_id = co.empresa_id AND a.origen_id = co.id
                            AND a.origen = 'compra' AND a.estado = 'confirmado')
    ) d;
  v_estado := CASE WHEN v_a >= 5 THEN 'critico' WHEN v_a > 0 THEN 'atencion' ELSE 'ok' END;
  v_detalle := CASE WHEN v_a > 0 THEN format('%s documento(s) de los últimos 7 días sin asiento contable (revisar en Conciliación de cuentas de control).', v_a)
                    ELSE 'Todos los documentos recientes tienen su asiento.' END;
  v_items := v_items || jsonb_build_array(public.salud_item('documentos_sin_asiento', 'Documentos sin asiento contable', v_estado, v_detalle,
    jsonb_build_object('documentos', v_a)));

  -- 9) Asientos confirmados de los últimos 3 días cuyas líneas no cuadran. Un trigger lo impide (mig. 314), así que no
  --    debería pasar nunca: si aparece uno, es grave.
  SELECT count(*) INTO v_a
    FROM (
      SELECT a.id
        FROM public.asientos_contables a
        JOIN public.asientos_items i ON i.asiento_id = a.id
       WHERE a.estado = 'confirmado' AND a.created_at > v_ahora - interval '3 days'
       GROUP BY a.id
      HAVING abs(sum(i.debe) - sum(i.haber)) > 0.005
    ) x;
  v_estado := CASE WHEN v_a > 0 THEN 'critico' ELSE 'ok' END;
  v_detalle := CASE WHEN v_a > 0 THEN format('%s asiento(s) confirmado(s) con el debe distinto del haber.', v_a)
                    ELSE 'Los asientos recientes cuadran.' END;
  v_items := v_items || jsonb_build_array(public.salud_item('asientos_descuadrados', 'Asientos descuadrados', v_estado, v_detalle,
    jsonb_build_object('asientos', v_a)));

  -- 10) Registros nuevos en 24 h: el registro público está abierto (SEG-5) y un pico de cuentas es la señal de alguien
  --     creando cuentas basura.
  SELECT count(*) INTO v_a FROM auth.users WHERE created_at > v_ahora - interval '24 hours';
  SELECT count(*) INTO v_b FROM public.empresas WHERE created_at > v_ahora - interval '24 hours';
  v_estado := CASE WHEN v_a >= 20 OR v_b >= 10 THEN 'atencion' ELSE 'ok' END;
  v_detalle := format('%s usuario(s) y %s empresa(s) nuevos en las últimas 24 h.', v_a, v_b)
               || CASE WHEN v_estado = 'atencion' THEN ' Es un pico inusual: revisar si son cuentas reales.' ELSE '' END;
  v_items := v_items || jsonb_build_array(public.salud_item('registros_nuevos', 'Registros nuevos (empresas y usuarios)', v_estado, v_detalle,
    jsonb_build_object('usuarios_24h', v_a, 'empresas_24h', v_b)));

  SELECT CASE WHEN bool_or(e ->> 'estado' = 'critico') THEN 'critico'
              WHEN bool_or(e ->> 'estado' = 'atencion') THEN 'atencion'
              ELSE 'ok' END
    INTO v_estado
    FROM jsonb_array_elements(v_items) e;

  RETURN jsonb_build_object(
    'estado', v_estado,
    'generado_en', v_ahora,
    'resumen', jsonb_build_object(
      'ok',       (SELECT count(*) FROM jsonb_array_elements(v_items) e WHERE e ->> 'estado' = 'ok'),
      'atencion', (SELECT count(*) FROM jsonb_array_elements(v_items) e WHERE e ->> 'estado' = 'atencion'),
      'critico',  (SELECT count(*) FROM jsonb_array_elements(v_items) e WHERE e ->> 'estado' = 'critico')),
    'chequeos', v_items);
END
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- 4) Correr el chequeo, guardarlo y avisar
-- ───────────────────────────────────────────────────────────────────────────

-- `p_resultado` existe solo para las pruebas: permite inyectar un resultado armado y probar la lógica de los avisos sin
-- depender del estado real del sistema. Sin argumentos (lo que hace el cron) corre el chequeo de verdad.
CREATE OR REPLACE FUNCTION public.ejecutar_chequeo_salud(p_resultado jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_res            jsonb := COALESCE(p_resultado, public.chequeo_salud_sistema());
  v_estado         text := v_res ->> 'estado';
  v_prev           record;
  v_abierto        boolean;
  v_estado_avisado text;
  v_ultimo_aviso   timestamptz;
  v_avisar         boolean;
  v_enviado        boolean := false;
  v_msg            text;
  v_lista          text;
BEGIN
  SELECT s.estado, s.aviso_abierto, s.estado_avisado, s.ultimo_aviso_en
    INTO v_prev
    FROM public.salud_sistema_chequeos s
   ORDER BY s.ejecutado_en DESC, s.id DESC
   LIMIT 1;

  -- Por defecto el estado del aviso se arrastra tal cual estaba.
  v_abierto := COALESCE(v_prev.aviso_abierto, false);
  v_estado_avisado := v_prev.estado_avisado;
  v_ultimo_aviso := v_prev.ultimo_aviso_en;

  IF v_estado = 'ok' THEN
    IF v_abierto THEN
      v_enviado := public.salud_enviar_aviso('✅ KAIROX — estado del sistema: todo normalizado. Lo que estaba avisado volvió a la normalidad.');
      IF v_enviado THEN
        v_abierto := false;
        v_estado_avisado := NULL;
        v_ultimo_aviso := NULL;
      END IF;
    END IF;
  ELSE
    -- El "atención" espera a estar en dos corridas seguidas; el "crítico" avisa enseguida. Una vez avisado, solo se
    -- repite si empeora o si pasaron 12 horas.
    v_avisar := (v_estado = 'critico' OR COALESCE(v_prev.estado, 'ok') <> 'ok')
                AND (NOT v_abierto
                     OR (CASE v_estado WHEN 'critico' THEN 2 ELSE 1 END) > (CASE v_estado_avisado WHEN 'critico' THEN 2 WHEN 'atencion' THEN 1 ELSE 0 END)
                     OR v_ultimo_aviso IS NULL
                     OR v_ultimo_aviso < now() - interval '12 hours');
    IF v_avisar THEN
      SELECT string_agg('• ' || (e ->> 'titulo') || ': ' || (e ->> 'detalle'), E'\n'
                        ORDER BY (e ->> 'estado') = 'critico' DESC, e ->> 'codigo')
        INTO v_lista
        FROM jsonb_array_elements(v_res -> 'chequeos') e
       WHERE e ->> 'estado' <> 'ok';
      v_msg := CASE WHEN v_estado = 'critico' THEN '🔴 KAIROX — estado del sistema: CRÍTICO' ELSE '🟠 KAIROX — estado del sistema: ATENCIÓN' END
               || E'\n' || COALESCE(v_lista, '');
      v_enviado := public.salud_enviar_aviso(v_msg);
      IF v_enviado THEN
        v_abierto := true;
        v_estado_avisado := v_estado;
        v_ultimo_aviso := now();
      END IF;
    END IF;
  END IF;

  INSERT INTO public.salud_sistema_chequeos (estado, resultado, aviso_abierto, estado_avisado, ultimo_aviso_en)
  VALUES (v_estado, v_res, v_abierto, v_estado_avisado, v_ultimo_aviso);

  DELETE FROM public.salud_sistema_chequeos WHERE ejecutado_en < now() - interval '30 days';

  RETURN v_res || jsonb_build_object('aviso_enviado', v_enviado);
END
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- 5) Permisos: solo el servicio (y el cron, que corre como el dueño de la base)
-- ───────────────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.salud_item(text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.salud_enviar_aviso(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chequeo_salud_sistema(numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ejecutar_chequeo_salud(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chequeo_salud_sistema(numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.ejecutar_chequeo_salud(jsonb) TO service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 6) La tarea programada: a los 7 minutos de cada hora
-- ───────────────────────────────────────────────────────────────────────────

SELECT cron.schedule(
  'chequeo-salud-sistema-cada-hora',
  '7 * * * *',
  $cron$SELECT public.ejecutar_chequeo_salud();$cron$
);
