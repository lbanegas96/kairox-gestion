-- Migration 099: Cache de Tickets de Acceso (TA) de AFIP WSAA
-- Sesión 63 — reemplazo del SDK @nicoo01x/arca-sdk por implementación manual WSAA+WSFE.
--
-- El TA de AFIP (token+sign) dura ~12h. AFIP RECHAZA pedir un TA nuevo si ya existe
-- uno válido para el mismo CUIT+servicio ("El CEE ya posee un TA valido...").
-- Por eso cacheamos el TA por (empresa_id, service) y lo reutilizamos hasta que expire.
--
-- Seguridad: RLS habilitado SIN políticas → solo service_role (las edge functions)
-- puede leer/escribir. El TA es una credencial de sesión temporal; nunca se expone
-- al frontend. Multi-tenant: la PK incluye empresa_id, aislamiento total entre empresas.

CREATE TABLE IF NOT EXISTS public.afip_tickets (
  empresa_id      uuid        NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  service         text        NOT NULL,                      -- 'wsfe', 'wsfex', etc.
  token           text        NOT NULL,
  sign            text        NOT NULL,
  expiration_time timestamptz NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, service)
);

ALTER TABLE public.afip_tickets ENABLE ROW LEVEL SECURITY;

-- Sin políticas: ningún rol (anon/authenticated) puede acceder.
-- Solo service_role (que bypassa RLS) — usado por las edge functions.

COMMENT ON TABLE public.afip_tickets IS
  'Cache de Tickets de Acceso (TA) de AFIP WSAA. TTL ~12h. Solo service_role accede (RLS sin políticas). Reemplazo SDK ARCA, sesión 63.';
