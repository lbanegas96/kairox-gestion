-- Ver 159_rls_split_cud_batch1.sql para el detalle del patron. Mismo fix, siguiente lote de tablas.
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
      AND p.tablename = ANY(ARRAY['cotizaciones','cuentas_bancarias','detalle_compras','entrega_items','entregas','extracto_lineas','extractos_bancarios','facturas_pendientes_arca'])
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
