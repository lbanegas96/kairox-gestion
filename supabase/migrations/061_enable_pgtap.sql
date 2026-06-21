-- Sesión 40: habilita pgTAP para poder escribir tests de base de datos.
-- Primer test real: supabase/tests/obtener_proximo_numero.test.sql — cubre el
-- riesgo de mayor severidad de toda la auditoría de estabilización (sesión 30):
-- concurrencia en la numeración de comprobantes.

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

-- Rollback (comentado): DROP EXTENSION IF EXISTS pgtap;
