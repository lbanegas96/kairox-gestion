-- Agrega los indices de cobertura para las 2 FKs que el advisor de performance
-- reportaba como "unindexed_foreign_keys" en determinacion_cuentas_mayor.
CREATE INDEX IF NOT EXISTS idx_determinacion_cuentas_mayor_cuenta_bancaria_id ON public.determinacion_cuentas_mayor (cuenta_bancaria_id);
CREATE INDEX IF NOT EXISTS idx_determinacion_cuentas_mayor_cuenta_contable_id ON public.determinacion_cuentas_mayor (cuenta_contable_id);
