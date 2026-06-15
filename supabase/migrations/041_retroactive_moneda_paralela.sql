-- =============================================================================
-- 041_retroactive_moneda_paralela.sql
-- RETROACTIVA — Solo documentación. NO re-aplicar en Supabase (ya ejecutada).
-- Documenta columnas de soporte multi-moneda / tipo de cambio paralelo
-- agregadas a 5 tablas.
-- =============================================================================

-- empresas: flag de TC paralelo y nombre de la moneda alternativa
ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS usa_tc_paralelo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS moneda_paralela text    NOT NULL DEFAULT 'USD';

-- comprobantes: estado de pago (open-item) + campos de moneda paralela + origen NC/ND
ALTER TABLE public.comprobantes
  ADD COLUMN IF NOT EXISTS estado_pago           text    NOT NULL DEFAULT 'pagada',
  ADD COLUMN IF NOT EXISTS monto_paralelo        numeric,
  ADD COLUMN IF NOT EXISTS tc_paralelo           numeric,
  ADD COLUMN IF NOT EXISTS comprobante_origen_id uuid;

-- movimientos_caja: monto equivalente en moneda paralela al momento del movimiento
ALTER TABLE public.movimientos_caja
  ADD COLUMN IF NOT EXISTS monto_paralelo numeric,
  ADD COLUMN IF NOT EXISTS tc_paralelo    numeric;

-- cuenta_corriente_movimientos: trazabilidad de comprobante, método de cobro y moneda paralela
ALTER TABLE public.cuenta_corriente_movimientos
  ADD COLUMN IF NOT EXISTS comprobante_id uuid,
  ADD COLUMN IF NOT EXISTS metodo_cobro   text,
  ADD COLUMN IF NOT EXISTS monto_paralelo numeric,
  ADD COLUMN IF NOT EXISTS tc_paralelo    numeric;

-- compras: monto equivalente en moneda paralela al momento de la factura
ALTER TABLE public.compras
  ADD COLUMN IF NOT EXISTS monto_paralelo numeric,
  ADD COLUMN IF NOT EXISTS tc_paralelo    numeric;
