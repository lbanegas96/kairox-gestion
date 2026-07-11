-- Migration 195 — Hardening defensa en profundidad de afip_tickets (sesión 60).
--
-- afip_tickets cachea el TA de AFIP WSAA (token+sign) — una credencial de sesión
-- que permite emitir facturas en nombre de la empresa. Ya tiene RLS habilitado sin
-- políticas (mig.099) = deny-all para anon/authenticated, que es la postura correcta.
--
-- Pero la tabla arrastra los GRANTs de tabla que Supabase otorga por default a
-- anon/authenticated en el schema public. Hoy RLS los neutraliza, pero eso es UNA
-- sola barrera: si alguna vez se deshabilitara RLS por error, o se agregara una
-- policy permisiva sin pensar, anon/authenticated podrían leer los tokens. Para una
-- tabla de secretos corresponde doble barrera: revocar también los grants de tabla.
--
-- Seguro: las edge functions (afip.ts, wsaa.ts) acceden con service_role, que NO se
-- toca (bypassa RLS y conserva su grant). Ninguna función SQL ni el frontend leen
-- esta tabla (confirmado con grep: solo edge functions + docs). service_role y
-- postgres conservan acceso total.

REVOKE ALL ON TABLE public.afip_tickets FROM anon, authenticated;

-- RLS sigue habilitado (no se toca). Esto es la 2da barrera, no la reemplaza.
