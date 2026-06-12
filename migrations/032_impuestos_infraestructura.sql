-- migrations/032_impuestos_infraestructura.sql
-- Submódulo Impuestos (Fase A.1): IVA real por alícuota + tabla de alícuotas provinciales.
--
-- NOTA de numeración: el spec original la llamaba 029, pero 029/030/031 ya estaban
-- aplicadas (fix_tenant_id_fkeys, compras_add_moneda, compras_add_tipo_cambio_tasa).
-- Renumerada a 032 para evitar colisión.
--
-- Compatibilidad retroactiva: todos los DEFAULT '21' + columnas NULLABLE en los
-- totales discriminados → comprobantes/compras ya emitidos siguen funcionando con
-- fallback COALESCE(..., total/1.21) en el frontend.

-- ── 1. Alícuota de IVA por producto ────────────────────────────────────────
-- Valores posibles: '21', '10.5', '0', 'exento', 'no_gravado'
ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS alicuota_iva TEXT NOT NULL DEFAULT '21';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'productos_alicuota_iva_check'
  ) THEN
    ALTER TABLE public.productos
      ADD CONSTRAINT productos_alicuota_iva_check
      CHECK (alicuota_iva IN ('21', '10.5', '0', 'exento', 'no_gravado'));
  END IF;
END $$;

-- ── 2. Alícuota de IVA capturada al momento de la venta/compra (snapshot) ───
-- Si después cambia la alícuota del producto, el histórico no se altera.
ALTER TABLE public.comprobante_items
  ADD COLUMN IF NOT EXISTS alicuota_iva TEXT DEFAULT '21';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'comprobante_items_alicuota_iva_check'
  ) THEN
    ALTER TABLE public.comprobante_items
      ADD CONSTRAINT comprobante_items_alicuota_iva_check
      CHECK (alicuota_iva IN ('21', '10.5', '0', 'exento', 'no_gravado'));
  END IF;
END $$;

ALTER TABLE public.detalle_compras
  ADD COLUMN IF NOT EXISTS alicuota_iva TEXT DEFAULT '21';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'detalle_compras_alicuota_iva_check'
  ) THEN
    ALTER TABLE public.detalle_compras
      ADD CONSTRAINT detalle_compras_alicuota_iva_check
      CHECK (alicuota_iva IN ('21', '10.5', '0', 'exento', 'no_gravado'));
  END IF;
END $$;

-- ── 3. Totales discriminados en comprobantes y compras ─────────────────────
ALTER TABLE public.comprobantes
  ADD COLUMN IF NOT EXISTS neto_gravado     NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS iva_discriminado NUMERIC(12,2);

ALTER TABLE public.compras
  ADD COLUMN IF NOT EXISTS neto_gravado     NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS iva_discriminado NUMERIC(12,2);

-- ── 4. Tabla de alícuotas de impuestos provinciales (IIBB, Ganancias) ──────
CREATE TABLE IF NOT EXISTS public.alicuotas_impuestos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  impuesto       TEXT NOT NULL CHECK (impuesto IN ('IIBB', 'Ganancias', 'SUSS', 'Otro')),
  jurisdiccion   TEXT NOT NULL,            -- 'Córdoba', 'Buenos Aires', 'CABA', 'Nacional', etc.
  alicuota       NUMERIC(6,4) NOT NULL,    -- porcentaje, ej: 3.0000 = 3%
  concepto       TEXT,                     -- ej: "Régimen general", "Contribuyente local"
  fuente         TEXT NOT NULL DEFAULT 'manual'
                 CHECK (fuente IN ('manual', 'padron_arba', 'padron_agip')),
  vigencia_desde DATE NOT NULL DEFAULT CURRENT_DATE,
  vigencia_hasta DATE,                     -- NULL = vigente indefinidamente
  activo         BOOLEAN NOT NULL DEFAULT true,
  observaciones  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.alicuotas_impuestos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "alicuotas_impuestos_all" ON public.alicuotas_impuestos;
CREATE POLICY "alicuotas_impuestos_all" ON public.alicuotas_impuestos
  USING (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

CREATE INDEX IF NOT EXISTS idx_alicuotas_empresa_activo
  ON public.alicuotas_impuestos(empresa_id, activo)
  WHERE activo = true;

-- ── 5. Seed ────────────────────────────────────────────────────────────────
-- El seed de alícuotas sugeridas de Córdoba es OPT-IN desde el frontend
-- (botón explícito del usuario), nunca automático — para evitar duplicados
-- en empresas que ya tengan datos. Documentado, no se inserta acá.
