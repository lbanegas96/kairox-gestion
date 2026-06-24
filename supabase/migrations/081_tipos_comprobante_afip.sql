-- 081_tipos_comprobante_afip.sql
-- Tabla de tipos de comprobante AFIP/ARCA por punto de venta.
-- Tipos soportados: FA(1), FB(6), FC(11), NCA(3), NCB(8), NCC(13), NDA(2), NDB(7), NDC(12).
-- proximo_numero es REFERENCIAL — siempre consultar ARCA antes de emitir.
-- Un trigger AFTER INSERT en puntos_venta siembra automáticamente los 9 tipos.

CREATE TABLE IF NOT EXISTS public.tipos_comprobante_afip (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       UUID        NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  punto_venta_id   UUID        NOT NULL REFERENCES public.puntos_venta(id) ON DELETE CASCADE,
  tipo_interno     TEXT        NOT NULL
    CHECK (tipo_interno IN ('FA','FB','FC','NCA','NCB','NCC','NDA','NDB','NDC')),
  codigo_afip      SMALLINT,
  habilitado       BOOLEAN     NOT NULL DEFAULT true,
  proximo_numero   INTEGER     NOT NULL DEFAULT 1,
  ultimo_sync_arca TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, punto_venta_id, tipo_interno)
);

ALTER TABLE public.tipos_comprobante_afip ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tipos_comprobante_afip_tenant" ON public.tipos_comprobante_afip
  USING (empresa_id = get_my_empresa_id());

DROP TRIGGER IF EXISTS trg_tipos_comprobante_afip_updated_at ON public.tipos_comprobante_afip;
CREATE TRIGGER trg_tipos_comprobante_afip_updated_at
  BEFORE UPDATE ON public.tipos_comprobante_afip
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- Función para sembrar los 9 tipos cuando se inserta un punto de venta nuevo.
-- ON CONFLICT DO NOTHING es idempotente: el wizard existente puede volver a upsertear
-- el PdV sin duplicar filas.
CREATE OR REPLACE FUNCTION public.fn_seed_tipos_comprobante_afip()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO public.tipos_comprobante_afip
    (empresa_id, punto_venta_id, tipo_interno, codigo_afip, habilitado)
  VALUES
    (NEW.empresa_id, NEW.id, 'FA',  1,  true),
    (NEW.empresa_id, NEW.id, 'FB',  6,  true),
    (NEW.empresa_id, NEW.id, 'FC',  11, true),
    (NEW.empresa_id, NEW.id, 'NCA', 3,  true),
    (NEW.empresa_id, NEW.id, 'NCB', 8,  true),
    (NEW.empresa_id, NEW.id, 'NCC', 13, true),
    (NEW.empresa_id, NEW.id, 'NDA', 2,  true),
    (NEW.empresa_id, NEW.id, 'NDB', 7,  true),
    (NEW.empresa_id, NEW.id, 'NDC', 12, true)
  ON CONFLICT (empresa_id, punto_venta_id, tipo_interno) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_tipos_comprobante_afip ON public.puntos_venta;
CREATE TRIGGER trg_seed_tipos_comprobante_afip
  AFTER INSERT ON public.puntos_venta
  FOR EACH ROW EXECUTE FUNCTION public.fn_seed_tipos_comprobante_afip();

REVOKE ALL ON public.tipos_comprobante_afip FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tipos_comprobante_afip TO authenticated;
