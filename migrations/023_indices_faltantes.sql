-- =============================================================================
-- MIGRATION 023 — Índices faltantes para performance
-- Optimiza queries frecuentes: aging CC, dashboard KPIs, notificaciones.
-- =============================================================================

-- comprobantes: filtro por estado_pago (aging CC, notificaciones, dashboard)
CREATE INDEX IF NOT EXISTS idx_comprobantes_estado_pago
  ON public.comprobantes(empresa_id, estado_pago);

-- comprobantes: filtro por fecha (reportes por período, gráfico de ventas 7 días)
CREATE INDEX IF NOT EXISTS idx_comprobantes_fecha
  ON public.comprobantes(empresa_id, fecha DESC);

-- cuenta_corriente_movimientos: queries de aging y Open Item por cliente
CREATE INDEX IF NOT EXISTS idx_cta_cte_empresa_cliente_tipo
  ON public.cuenta_corriente_movimientos(empresa_id, cliente_id, tipo);

-- movimientos_inventario: historial de movimientos por producto y fecha
CREATE INDEX IF NOT EXISTS idx_mov_inv_fecha
  ON public.movimientos_inventario(empresa_id, fecha DESC);
