-- migration 111 — tabla metodo_pago_cuenta_bancaria (puente Caja ↔ Bancos)
-- Mapea cada método de pago del POS a una cuenta bancaria.
-- Cuando crear_venta v3 procesa un pago con un método mapeado, inserta
-- automáticamente un movimiento_bancario (origen='caja') en esa cuenta.
-- Efectivo y Cuenta Corriente NUNCA mapean: el primero queda en Caja física,
-- el segundo se registra en el módulo CC como Open Item.
-- ROLLBACK: DROP TABLE public.metodo_pago_cuenta_bancaria;

CREATE TABLE IF NOT EXISTS public.metodo_pago_cuenta_bancaria (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  metodo_pago        VARCHAR(100) NOT NULL,
  cuenta_bancaria_id UUID NOT NULL REFERENCES public.cuentas_bancarias(id) ON DELETE CASCADE,
  activo             BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(empresa_id, metodo_pago)
);

ALTER TABLE public.metodo_pago_cuenta_bancaria ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation"
  ON public.metodo_pago_cuenta_bancaria
  FOR ALL
  USING (empresa_id = get_my_empresa_id());

REVOKE ALL ON public.metodo_pago_cuenta_bancaria FROM public, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.metodo_pago_cuenta_bancaria TO authenticated;
