-- Divide las policies FOR ALL redundantes (cud/admin_write) en INSERT/UPDATE/DELETE
-- separados, dejando la policy SELECT dedicada como unica que aplica para lecturas.
-- Elimina el warning "multiple_permissive_policies" sin cambiar ninguna condicion de
-- autorizacion (misma qual/with_check exacta que ya tenia la policy FOR ALL).
-- Aplicado en lotes chicos (con lock_timeout corto) para evitar deadlocks contra
-- trafico real en produccion.
SET lock_timeout = '3s';
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT p.tablename, p.policyname, p.qual, p.with_check
    FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.cmd = 'ALL'
      AND p.permissive = 'PERMISSIVE'
      AND p.tablename = ANY(ARRAY['alicuotas_impuestos','asientos_contables','asientos_items','caea_comprobantes','caea_registros','caja_sesiones','cajas','categorias'])
      AND EXISTS (
        SELECT 1 FROM pg_policies s
        WHERE s.schemaname = p.schemaname
          AND s.tablename = p.tablename
          AND s.cmd = 'SELECT'
          AND s.policyname <> p.policyname
      )
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, pol.tablename);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (%s)', pol.policyname || '_insert', pol.tablename, pol.with_check);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE USING (%s) WITH CHECK (%s)', pol.policyname || '_update', pol.tablename, pol.qual, pol.with_check);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE USING (%s)', pol.policyname || '_delete', pol.tablename, pol.qual);
  END LOOP;
END $$;
