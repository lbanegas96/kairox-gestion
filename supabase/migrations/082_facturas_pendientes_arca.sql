-- 082_facturas_pendientes_arca.sql
-- Cola asíncrona para emisión de CAE con retry logic.
-- Estados: pendiente → procesando → emitida (happy path)
--          pendiente → error_datos (datos inválidos, no reintentar)
--          pendiente → reintentando → error_definitivo (max_intentos alcanzado)
-- proximo_intento + estado + empresa_id tienen índice para el worker de ARCA.

CREATE TABLE IF NOT EXISTS public.facturas_pendientes_arca (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       UUID        NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  comprobante_id   UUID        REFERENCES public.comprobantes(id) ON DELETE SET NULL,
  punto_venta_id   UUID        REFERENCES public.puntos_venta(id) ON DELETE RESTRICT,
  tipo_comprobante TEXT        NOT NULL,
  codigo_afip      SMALLINT    NOT NULL,
  payload_arca     JSONB       NOT NULL DEFAULT '{}',
  estado           TEXT        NOT NULL DEFAULT 'pendiente'
                     CHECK (estado IN (
                       'pendiente','procesando','emitida',
                       'error_datos','reintentando','error_definitivo'
                     )),
  intentos         INTEGER     NOT NULL DEFAULT 0,
  max_intentos     INTEGER     NOT NULL DEFAULT 3,
  proximo_intento  TIMESTAMPTZ NOT NULL DEFAULT now(),
  cae              TEXT,
  cae_vencimiento  DATE,
  qr_data          TEXT,
  numero_arca      BIGINT,
  error_code       TEXT,
  error_mensaje    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fpa_estado
  ON public.facturas_pendientes_arca (empresa_id, estado, proximo_intento);

ALTER TABLE public.facturas_pendientes_arca ENABLE ROW LEVEL SECURITY;

CREATE POLICY "facturas_pendientes_arca_tenant" ON public.facturas_pendientes_arca
  USING (empresa_id = get_my_empresa_id());

DROP TRIGGER IF EXISTS trg_facturas_pendientes_arca_updated_at ON public.facturas_pendientes_arca;
CREATE TRIGGER trg_facturas_pendientes_arca_updated_at
  BEFORE UPDATE ON public.facturas_pendientes_arca
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

REVOKE ALL ON public.facturas_pendientes_arca FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.facturas_pendientes_arca TO authenticated;
