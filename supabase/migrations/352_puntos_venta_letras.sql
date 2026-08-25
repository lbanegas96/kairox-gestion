-- migration 352 — puntos_venta_letras: qué letra puede emitir cada PdV +
-- cuál es el PdV por defecto para cada letra
--
-- Retoma PLAN_MULTI_PDV_LETRA_POS_ERP.md — respuestas de Luciano (24/08):
-- 1. Sí, debe ser configurable desde Configuración (hoy el POS/ERP usan un
--    único PdV "general" sin relación con la letra elegida).
-- 2. Puede haber cuantos PdV se quiera — se construye la tabla relacional
--    propuesta en el plan, no el atajo de columna array (ese sólo alcanzaba
--    si el caso real era 1-2 PdV con pocas letras cada uno).
-- 3. Solo Ventas — Compras queda fuera de alcance.
--
-- Diseño (igual al plan, sin cambios): un PdV puede tener 1, 2 o las 3
-- letras habilitadas. `es_default_para_letra` resuelve "si elijo Factura A
-- y no toco nada más, ¿qué PdV me proponés" — el índice único parcial
-- garantiza que nunca haya dos PdV marcados default para la misma letra en
-- la misma empresa.

CREATE TABLE public.puntos_venta_letras (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id             uuid NOT NULL REFERENCES public.empresas(id),
  punto_venta_id         uuid NOT NULL REFERENCES public.puntos_venta(id) ON DELETE CASCADE,
  letra                  text NOT NULL CHECK (letra IN ('A', 'B', 'C')),
  es_default_para_letra  boolean NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (punto_venta_id, letra)
);

CREATE INDEX idx_puntos_venta_letras_empresa ON public.puntos_venta_letras (empresa_id);

-- Un solo default por letra por empresa.
CREATE UNIQUE INDEX puntos_venta_letras_default_unico
  ON public.puntos_venta_letras (empresa_id, letra)
  WHERE es_default_para_letra;

ALTER TABLE public.puntos_venta_letras ENABLE ROW LEVEL SECURITY;

CREATE POLICY "puntos_venta_letras_all" ON public.puntos_venta_letras
  FOR ALL USING (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

-- Backfill: todo PdV activo que NO sea solo_remito recibe las 3 letras
-- habilitadas — preserva el comportamiento actual (hoy CUALQUIER PdV activo
-- no-remito aparece para cualquier letra en Nueva Factura, sin relación).
-- El PdV es_default de la empresa queda además marcado default para las 3,
-- así que si nadie toca nada, la resolución sigue siendo exactamente la
-- misma que hoy (mismo PdV pre-seleccionado, sin importar la letra).
INSERT INTO public.puntos_venta_letras (empresa_id, punto_venta_id, letra, es_default_para_letra)
SELECT pv.empresa_id, pv.id, l.letra, pv.es_default
FROM public.puntos_venta pv
CROSS JOIN (VALUES ('A'), ('B'), ('C')) AS l(letra)
WHERE pv.activo AND NOT pv.solo_remito;

-- ROLLBACK (comentado): DROP TABLE IF EXISTS public.puntos_venta_letras;
