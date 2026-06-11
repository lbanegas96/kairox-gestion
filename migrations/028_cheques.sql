-- migrations/028_cheques.sql

CREATE TABLE IF NOT EXISTS public.cheques (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          UUID        NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  user_id             UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  tipo                TEXT        NOT NULL CHECK (tipo IN ('propio', 'tercero')),
  numero              TEXT        NOT NULL,
  banco               TEXT        NOT NULL,
  cuenta_bancaria_id  UUID        REFERENCES public.cuentas_bancarias(id) ON DELETE SET NULL,
  monto               NUMERIC(12,2) NOT NULL,
  fecha_emision       DATE        NOT NULL,
  fecha_vencimiento   DATE        NOT NULL,
  moneda              TEXT        NOT NULL DEFAULT 'ARS',
  cliente_id          UUID        REFERENCES public.clientes(id) ON DELETE SET NULL,
  proveedor_id        UUID        REFERENCES public.proveedores(id) ON DELETE SET NULL,
  concepto            TEXT,
  estado              TEXT        NOT NULL DEFAULT 'pendiente'
                      CHECK (estado IN (
                        'pendiente', 'entregado',
                        'en_cartera', 'depositado', 'endosado', 'descontado',
                        'cobrado', 'rechazado'
                      )),
  observaciones       TEXT,
  comprobante_id      UUID        REFERENCES public.comprobantes(id) ON DELETE SET NULL,
  compra_id           UUID        REFERENCES public.compras(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.cheques ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cheques_all" ON public.cheques;
CREATE POLICY "cheques_all" ON public.cheques
  USING  (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

CREATE INDEX IF NOT EXISTS idx_cheques_empresa_tipo
  ON public.cheques(empresa_id, tipo);

CREATE INDEX IF NOT EXISTS idx_cheques_empresa_estado
  ON public.cheques(empresa_id, estado);

CREATE INDEX IF NOT EXISTS idx_cheques_vencimiento
  ON public.cheques(empresa_id, fecha_vencimiento)
  WHERE estado NOT IN ('cobrado', 'rechazado');

-- Historial de cambios de estado

CREATE TABLE IF NOT EXISTS public.cheques_historial (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  cheque_id        UUID        NOT NULL REFERENCES public.cheques(id) ON DELETE CASCADE,
  empresa_id       UUID        NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  user_id          UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  estado_anterior  TEXT,
  estado_nuevo     TEXT        NOT NULL,
  observacion      TEXT,
  fecha            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.cheques_historial ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cheques_historial_all" ON public.cheques_historial;
CREATE POLICY "cheques_historial_all" ON public.cheques_historial
  USING  (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());
