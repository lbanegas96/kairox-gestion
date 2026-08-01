-- migration 294 — puntos_venta.es_default deja de ser decorativo
--
-- HALLAZGO: `es_default` existe en la tabla, se muestra como columna "Default"
-- en Configuración → Facturación y se puede editar... pero **nada lo lee**.
-- `useAfipConfig` resolvía el PdV con un `.limit(1)` (mig.293 ya lo ordenó por
-- número y lo filtró por envia_arca, pero sigue ignorando es_default).
-- Resultado: hay una columna que el usuario cree que decide algo y no decide
-- nada. Verificado en producción: 0 PdV con es_default=true en las 3 empresas.
--
-- Este es el primer paso del criterio fiscal unificado (decisión de Luciano):
-- **el punto de venta es el ÚNICO selector**; la relevancia fiscal se deriva de
-- `envia_arca`, no se elige por separado. Para eso hace falta que "cuál es el
-- PdV por defecto" sea un dato real y no una casilla suelta.
--
-- Modelo: a lo sumo UN es_default=true por empresa, garantizado por índice
-- único parcial. Marcar uno nuevo desmarca el anterior automáticamente
-- (trigger), que es como se comporta cualquier maestro de este tipo — si no,
-- el usuario tendría que acordarse de desmarcar el viejo primero y el índice
-- le tiraría un error críptico.

-- ── 1. Desmarcar el anterior al marcar uno nuevo ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_punto_venta_unico_default()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.es_default IS TRUE THEN
    -- El guard `es_default = true` evita recursión infinita: el UPDATE de abajo
    -- vuelve a disparar este trigger, pero con NEW.es_default = false.
    UPDATE public.puntos_venta
       SET es_default = false
     WHERE empresa_id = NEW.empresa_id
       AND id <> NEW.id
       AND es_default = true;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_punto_venta_unico_default ON public.puntos_venta;
CREATE TRIGGER trg_punto_venta_unico_default
  BEFORE INSERT OR UPDATE OF es_default ON public.puntos_venta
  FOR EACH ROW EXECUTE FUNCTION public.fn_punto_venta_unico_default();

-- ── 2. Backfill: cada empresa arranca con un default sensato ─────────────────
-- El primer PdV activo que envía a ARCA, por número. Es exactamente el que
-- useAfipConfig venía eligiendo como fallback, así que NO cambia el
-- comportamiento de nadie — sólo lo hace explícito y editable.
UPDATE public.puntos_venta pv
   SET es_default = true
  WHERE pv.id IN (
    SELECT DISTINCT ON (empresa_id) id
      FROM public.puntos_venta
     WHERE activo = true AND envia_arca = true
     ORDER BY empresa_id, numero
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.puntos_venta otro
     WHERE otro.empresa_id = pv.empresa_id AND otro.es_default = true
  );

-- ── 3. Red de seguridad: a lo sumo un default por empresa ────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_puntos_venta_un_default_por_empresa
  ON public.puntos_venta (empresa_id)
  WHERE es_default = true;

-- ROLLBACK (comentado):
-- DROP INDEX IF EXISTS idx_puntos_venta_un_default_por_empresa;
-- DROP TRIGGER IF EXISTS trg_punto_venta_unico_default ON public.puntos_venta;
-- DROP FUNCTION IF EXISTS public.fn_punto_venta_unico_default();
