-- Migration 017: Multi-pago en comprobantes
-- Tabla comprobante_pagos para múltiples métodos de pago por venta

CREATE TABLE IF NOT EXISTS comprobante_pagos (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  comprobante_id uuid          NOT NULL REFERENCES comprobantes(id) ON DELETE CASCADE,
  empresa_id     uuid          NOT NULL,
  metodo         text          NOT NULL CHECK (metodo IN ('Efectivo','Transferencia','Tarjeta','Cuenta Corriente','Cheque')),
  monto          numeric(12,2) NOT NULL CHECK (monto > 0),
  created_at     timestamptz   DEFAULT now()
);

ALTER TABLE comprobante_pagos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "comprobante_pagos_empresa" ON comprobante_pagos;
CREATE POLICY "comprobante_pagos_empresa" ON comprobante_pagos
  USING (empresa_id = get_my_empresa_id());

CREATE INDEX IF NOT EXISTS idx_comprobante_pagos_comprobante ON comprobante_pagos(comprobante_id);
CREATE INDEX IF NOT EXISTS idx_comprobante_pagos_empresa     ON comprobante_pagos(empresa_id);
