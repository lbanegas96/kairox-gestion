-- Sesión 50: cierra 2 de los 3 quick wins de performance del PLAN_SEMANA.md
-- sección 3 (advisors de get_advisors, no críticos pero rápidos de resolver).
-- El 3ro (tablas backup) queda pendiente de confirmación de Luciano.

-- ───────────────────────────────────────────────────────────────────────────
-- 5 policies RLS re-evaluaban auth.uid()/auth.role() por cada fila en vez de
-- una sola vez por query. Mismo fix en las 5: envolver en (select auth.<fn>())
-- — NO cambia la lógica de ninguna policy, solo permite que el planner cachee
-- el resultado (InitPlan) en vez de re-evaluar la función por fila.
-- ───────────────────────────────────────────────────────────────────────────

ALTER POLICY "profiles_select" ON public.profiles
  USING (id = (select auth.uid()));

ALTER POLICY "profiles_insert" ON public.profiles
  WITH CHECK (id = (select auth.uid()));

ALTER POLICY "profiles_admin_delete" ON public.profiles
  USING (is_admin() AND (empresa_id = get_my_empresa_id()) AND (id <> (select auth.uid())));

ALTER POLICY "profiles_self_update" ON public.profiles
  USING (id = (select auth.uid()))
  WITH CHECK (
    (id = (select auth.uid()))
    AND (role = (SELECT profiles_1.role FROM public.profiles profiles_1 WHERE profiles_1.id = (select auth.uid())))
  );

ALTER POLICY "usuarios autenticados pueden leer" ON public.movimientos_uala
  USING ((select auth.role()) = 'authenticated'::text);

-- ───────────────────────────────────────────────────────────────────────────
-- 2 pares de índices idénticos (mismo DDL, nombres distintos). Se mantiene en
-- cada par el que sigue la convención de nombre completo de tabla, se dropea
-- el abreviado.
-- ───────────────────────────────────────────────────────────────────────────

DROP INDEX IF EXISTS public.idx_prov_empresa;
DROP INDEX IF EXISTS public.idx_tc_empresa_moneda_fecha;

-- Rollback (comentado):
-- ALTER POLICY "profiles_select" ON public.profiles USING (id = auth.uid());
-- ALTER POLICY "profiles_insert" ON public.profiles WITH CHECK (id = auth.uid());
-- ALTER POLICY "profiles_admin_delete" ON public.profiles USING (is_admin() AND (empresa_id = get_my_empresa_id()) AND (id <> auth.uid()));
-- ALTER POLICY "profiles_self_update" ON public.profiles USING (id = auth.uid()) WITH CHECK ((id = auth.uid()) AND (role = (SELECT profiles_1.role FROM public.profiles profiles_1 WHERE profiles_1.id = auth.uid())));
-- ALTER POLICY "usuarios autenticados pueden leer" ON public.movimientos_uala USING (auth.role() = 'authenticated'::text);
-- CREATE INDEX idx_prov_empresa ON public.proveedores USING btree (empresa_id);
-- CREATE INDEX idx_tc_empresa_moneda_fecha ON public.tipos_cambio USING btree (empresa_id, moneda, fecha DESC);
