-- migration 236 — toggle de plan "usa_ecommerce" a nivel empresa.
--
-- Feature-gating por plan (idea de negocio de Luciano): la integración de
-- ecommerce (Tiendanube: card de conexión + publicar productos + estado) es una
-- funcionalidad de un plan más completo. Con este flag en OFF, toda la UI
-- relacionada se oculta; en ON, se muestra. Mismo patrón exacto que
-- `usa_impuestos_avanzados` (mig.172) y `usa_centros_costo` (mig.179): una
-- columna boolean en empresas, togueada desde Configuración, leída por los
-- componentes que muestran/ocultan la UY correspondiente.
--
-- Default false: una empresa nueva NO ve ecommerce hasta que se le activa el plan.
--
-- ROLLBACK:
--   ALTER TABLE public.empresas DROP COLUMN IF EXISTS usa_ecommerce;

ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS usa_ecommerce boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.empresas.usa_ecommerce IS
  'Toggle de plan: habilita la integración con canales de ecommerce (Tiendanube). OFF oculta toda la UI relacionada.';
