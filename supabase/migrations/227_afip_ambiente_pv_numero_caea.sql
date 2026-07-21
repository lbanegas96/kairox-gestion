-- migration 227 — columnas faltantes para CAEA (bug encontrado al intentar
-- probar la contingencia en homologación)
--
-- `solicitar-caea/index.ts` e `informar-caea/index.ts` (desplegadas, en uso
-- desde hace varias sesiones) leen `empresas.afip_ambiente` y
-- `empresas.afip_pv_numero` — NINGUNA de las dos columnas existe en la tabla
-- real (verificado contra `information_schema.columns` de producción). El
-- `.select(...)` de PostgREST devuelve un 400 apenas se llame a cualquiera de
-- las dos funciones — nadie lo había notado porque "Solicitar CAEA" nunca se
-- había probado de punta a punta (CAEA es 100% manual hasta ahora, ver
-- CAEA_IMPLEMENTACION.md).
--
-- `afip_ambiente`: igual patrón que `afip_usa_caea` — por EMPRESA, no un env
-- var global de la edge function (KAIROX es multi-tenant: una empresa puede
-- estar probando CAEA en homologación mientras el resto sigue en producción
-- real). NOTA: `arca-worker` sigue leyendo un env var global
-- `AFIP_ENVIRONMENT` para la emisión de CAE normal — se deja así a propósito,
-- es el motor de facturación real en vivo de Nalux y tocarlo no es parte de
-- este fix; esta columna es solo para el circuito de CAEA (solicitar/informar).
--
-- `afip_pv_numero`: el número de Punto de Venta AFIP reservado para CAEA.
-- Deliberadamente NO es una fila de `puntos_venta` (esa tabla modela
-- `tipo IN ('web','manual')` — la numeración correlativa de facturación
-- normal — un eje distinto). AFIP exige que un PdV sea CAE o CAEA, nunca
-- ambos, así que el PdV de CAEA es una entidad aparte de los `puntos_venta`
-- de facturación online: simplemente un número que la empresa declaró en el
-- portal de AFIP para uso exclusivo de contingencia.

ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS afip_ambiente text NOT NULL DEFAULT 'production',
  ADD COLUMN IF NOT EXISTS afip_pv_numero integer;

ALTER TABLE public.empresas
  DROP CONSTRAINT IF EXISTS empresas_afip_ambiente_check;
ALTER TABLE public.empresas
  ADD CONSTRAINT empresas_afip_ambiente_check
  CHECK (afip_ambiente IN ('production', 'sandbox'));
