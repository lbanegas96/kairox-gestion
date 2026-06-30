-- migration 118 — performance: consolidar políticas RLS redundantes
--
-- 3 tablas tienen 2 políticas PERMISSIVE solapadas con USING IDÉNTICO
-- (empresa_id = get_my_empresa_id()). Postgres evalúa TODAS las permissive en cada
-- query → costo extra sin beneficio. Se elimina la redundante de cada par; la que
-- queda preserva EXACTAMENTE el mismo acceso (misma USING, y se conserva la que
-- incluye WITH CHECK donde aplica). Esto elimina 60 de los 95 warnings
-- multiple_permissive_policies.
--
-- Verificado en pg_policies que cada par es semánticamente equivalente:
--   cuenta_corriente_movimientos: cta_cte_all (sin check) ≡ cta_cte_empresa (con check) → keep cta_cte_empresa
--   proveedores:                  proveedores_all (sin check) ≡ prov_empresa (con check) → keep prov_empresa
--   tipos_cambio:                 tc_all ≡ tipos_cambio_empresa_all (idénticas) → keep tc_all
--
-- NO se tocan: profiles (policies admin/self distintas a propósito) ni configuracion
-- (tiene un tema de negocio aparte: policies admin-only anuladas por una FOR ALL amplia).
--
-- ⚠️ PENDIENTE DE APROBACIÓN — cambio sobre políticas RLS en producción.
--
-- ROLLBACK: recrear cada policy dropeada (ver definiciones en pg_policies / migrations previas).

DROP POLICY IF EXISTS cta_cte_all              ON public.cuenta_corriente_movimientos;
DROP POLICY IF EXISTS proveedores_all          ON public.proveedores;
DROP POLICY IF EXISTS tipos_cambio_empresa_all ON public.tipos_cambio;
