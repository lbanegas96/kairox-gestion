-- ════════════════════════════════════════════════════════════════════════════
-- migration 273 — numeración local indexada por (punto de venta, CbteTipo)
-- ════════════════════════════════════════════════════════════════════════════
--
-- ⚠️ REQUIERE desplegar `arca-worker` con el código nuevo. Ver "Orden de
-- despliegue" al final. Aplicar esta migración sola es INOCUO (crea una tabla
-- que nadie lee todavía y no toca las columnas viejas), pero no arregla nada
-- hasta que el worker se despliegue.
--
-- ── El problema (tarea #36, investigada el 2026-07-29) ──────────────────────
-- `puntos_venta.ultimo_numero_a/b/c` indexa el contador por LETRA (A/B/C),
-- pero la serie correlativa de AFIP está indexada por (PtoVta, CbteTipo), y
-- CbteTipo distingue Factura / NC / ND. Una sola columna por letra no puede
-- seguir 2 o 3 series independientes.
--
-- Hasta el 2026-07-28 esto no se notaba porque NC y ND se declaraban ante ARCA
-- como Factura (bug de `voucherTypeAfip`, commit c57cb77), así que compartían
-- una única serie. Ahora que cada clase declara su propio CbteTipo, cada una
-- tiene su serie en AFIP y las tres escriben en la misma columna.
--
-- Consecuencia concreta, con los números reales de Nalux (PV1, letra C):
--   1. La primera NC-C emite bien y escribe `ultimo_numero_c = 1`, pisando el
--      contador de las facturas (que iba por 34/35).
--   2. La siguiente Factura C: `lastNumber`(AFIP)=35 vs `expected`=1 → el guard
--      de "estado ambiguo" de arca-worker da verdadero y manda una factura
--      PERFECTAMENTE VÁLIDA a `error_definitivo`, trabada hasta que un humano
--      la destrabe desde el Monitor.
-- O sea: falso positivo que bloquea facturas buenas, no una simple pérdida de
-- precisión. Todavía no pasó porque en Nalux cada letra tiene una sola clase
-- (C = solo ventas, B = solo NC).
--
-- ── La solución ─────────────────────────────────────────────────────────────
-- Indexar el contador por lo mismo que lo indexa AFIP.

-- ── 1. Tabla ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.puntos_venta_numeracion (
  empresa_id      uuid        NOT NULL REFERENCES public.empresas(id)      ON DELETE CASCADE,
  punto_venta_id  uuid        NOT NULL REFERENCES public.puntos_venta(id)  ON DELETE CASCADE,
  -- Código de comprobante de WSFE: venta A/B/C = 1/6/11, NC = 3/8/13, ND = 2/7/12.
  -- Misma tabla de mapeo que `voucherTypeAfip` (_shared/afip.ts) y que la mig.271.
  cbte_tipo       integer     NOT NULL,
  -- Último correlativo que ESTE sistema vio confirmado por AFIP para esa serie.
  -- No es la fuente de la numeración (el número real siempre sale de
  -- `feCompUltimoAutorizado`) — es el "hasta acá sabíamos" contra el que se
  -- compara para detectar que ARCA ya emitió un comprobante que creíamos fallido.
  ultimo_numero   integer     NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (punto_venta_id, cbte_tipo)
);

-- Índice para las policies de RLS por tenant (mismo criterio que la mig.098).
CREATE INDEX IF NOT EXISTS idx_puntos_venta_numeracion_empresa
  ON public.puntos_venta_numeracion (empresa_id);

COMMENT ON TABLE public.puntos_venta_numeracion IS
  'Último correlativo AFIP conocido por (punto de venta, CbteTipo). Reemplaza a puntos_venta.ultimo_numero_a/b/c, que indexaba por letra y no podía seguir las series separadas de Factura/NC/ND. Lo escribe SOLO arca-worker (service_role).';

-- ── 2. RLS ───────────────────────────────────────────────────────────────────
-- Lectura acotada al tenant (misma policy que `puntos_venta`).
-- ESCRITURA: ninguna policy → NADIE puede escribirla desde la app, ni siquiera
-- un admin. Solo `service_role` (que bypassea RLS), o sea solo arca-worker.
-- Es a propósito y es MÁS estricto que las columnas viejas: la mig.150 tuvo que
-- cerrar justamente que un staff no-admin pudiera hacer
-- `UPDATE puntos_venta SET ultimo_numero_b = 0` — resetear ese contador a mano
-- es un riesgo fiscal y no hay ningún caso de uso legítimo desde la UI.
ALTER TABLE public.puntos_venta_numeracion ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS puntos_venta_numeracion_select ON public.puntos_venta_numeracion;
CREATE POLICY puntos_venta_numeracion_select
  ON public.puntos_venta_numeracion
  FOR SELECT
  USING (empresa_id = get_my_empresa_id());

REVOKE ALL   ON public.puntos_venta_numeracion FROM PUBLIC, anon;
GRANT  SELECT ON public.puntos_venta_numeracion TO authenticated;

-- ── 3. Seed ──────────────────────────────────────────────────────────────────
-- SOLO se siembran las VENTAS, y es a propósito.
--
-- El código AFIP de una venta (1/6/11) nunca estuvo afectado por el bug de
-- CbteTipo: `voucherTypeAfip` devolvía el código de Factura, que para una venta
-- ES el correcto. Así que el máximo correlativo de las ventas por (PV, letra) sí
-- corresponde a la serie que se dice.
--
-- Las NC/ND históricas NO se siembran porque su código declarado depende de
-- CUÁNDO se emitieron: antes del fix consumieron la serie de FACTURA (una NC-B
-- se declaró como 6, no como 8), después consumen la propia. Sembrarlas por
-- letra+clase las pondría en una serie que en realidad nunca tocaron. En vez de
-- inventar el dato, se dejan sin fila y el worker las auto-siembra la primera
-- vez que emite en esa serie (ver punto 4).
--
-- Verificado antes de escribir esto: en producción esta consulta devuelve una
-- sola fila — Nalux PV1, cbte_tipo 11, ultimo_numero 34, de 31 comprobantes.
-- Nótese que `puntos_venta.ultimo_numero_c` dice 35: la columna vieja ya venía
-- desfasada +1 contra el máximo real. La tabla nueva arranca más precisa.
INSERT INTO public.puntos_venta_numeracion (empresa_id, punto_venta_id, cbte_tipo, ultimo_numero)
SELECT c.empresa_id,
       c.punto_venta_id,
       CASE c.tipo_comprobante_afip WHEN 'A' THEN 1 WHEN 'C' THEN 11 ELSE 6 END,
       max((split_part(c.numero_afip, '-', 2))::int)
  FROM public.comprobantes c
 WHERE c.tipo            = 'venta'
   AND c.cae_estado      = 'emitido'
   AND c.numero_afip     IS NOT NULL
   AND c.punto_venta_id  IS NOT NULL
 GROUP BY c.empresa_id, c.punto_venta_id,
          CASE c.tipo_comprobante_afip WHEN 'A' THEN 1 WHEN 'C' THEN 11 ELSE 6 END
ON CONFLICT (punto_venta_id, cbte_tipo) DO NOTHING;

-- ── 4. Contrato con arca-worker ──────────────────────────────────────────────
-- SIN fila para (PV, cbte_tipo) = "no tenemos expectativa previa" → el worker
-- SALTEA el chequeo de ambigüedad y emite, y después inserta la fila con el
-- correlativo que devolvió AFIP. Es deliberado: inicializar en 0 haría que
-- `lastNumber >= 0 + 1` diera verdadero para cualquier serie que ya tenga
-- números en AFIP, o sea que marcaría TODO como ambiguo.
--
-- Costo real: la primera emisión de cada serie nueva va sin ese guard. Es una
-- exposición chica y acotada, contra el estado actual donde el guard directamente
-- produce falsos positivos que bloquean facturas válidas.

-- ── 5. Columnas viejas: quedan, marcadas como muertas ────────────────────────
-- NO se borran en esta migración a propósito: si hubiera que revertir el deploy
-- del worker, el código viejo las necesita. Una vez confirmado que la tabla
-- nueva funciona en producción, se pueden dropear en una migración aparte.
-- Se comentan para que nadie las vuelva a usar creyendo que están vigentes.
COMMENT ON COLUMN public.puntos_venta.ultimo_numero_a IS
  'DEPRECADA (mig.273) — reemplazada por puntos_venta_numeracion. Indexaba por letra y no podía seguir las series separadas de Factura/NC/ND. Ya nadie la lee ni la escribe. Pendiente de DROP.';
COMMENT ON COLUMN public.puntos_venta.ultimo_numero_b IS
  'DEPRECADA (mig.273) — ver ultimo_numero_a.';
COMMENT ON COLUMN public.puntos_venta.ultimo_numero_c IS
  'DEPRECADA (mig.273) — ver ultimo_numero_a.';

-- ── Orden de despliegue ──────────────────────────────────────────────────────
-- 1. Aplicar esta migración (inocua sola: crea la tabla, nadie la lee).
-- 2. Desplegar `arca-worker` con el código nuevo (incluir las 5 dependencias
--    de _shared/ en el payload, ver la nota de método del deploy v17).
-- El orden inverso también funciona pero deja al worker escribiendo contra una
-- tabla inexistente entre ambos pasos, así que conviene este.
--
-- ── Verificación post-despliegue ─────────────────────────────────────────────
--   SELECT pv.numero AS pv, n.cbte_tipo, n.ultimo_numero, n.updated_at
--     FROM public.puntos_venta_numeracion n
--     JOIN public.puntos_venta pv ON pv.id = n.punto_venta_id
--    ORDER BY pv, n.cbte_tipo;
-- Tras emitir una venta y una NC de la misma letra, deben quedar DOS filas con
-- cbte_tipo distinto, cada una con su propio correlativo — que es exactamente
-- lo que las columnas viejas no podían representar.
--
-- ROLLBACK:
--   DROP TABLE public.puntos_venta_numeracion;
--   -- y redesplegar arca-worker con la versión anterior (las columnas viejas
--   -- siguen intactas y con sus valores, no se tocaron).
