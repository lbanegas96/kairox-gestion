-- migration 116 — performance: índices en FKs sin índice de cobertura
--
-- 18 foreign keys sin índice → joins y DELETE/cascade subóptimos.
-- Se agregan índices btree estándar (IF NOT EXISTS por idempotencia).
-- (El drop del constraint UNIQUE duplicado se separó a migration 117.)
--
-- ROLLBACK: DROP INDEX de cada idx_* de abajo.

-- ── FK indexes ──────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_caea_comprobantes_comprobante_id ON public.caea_comprobantes (comprobante_id);
CREATE INDEX IF NOT EXISTS idx_caea_comprobantes_empresa_id     ON public.caea_comprobantes (empresa_id);
CREATE INDEX IF NOT EXISTS idx_clientes_lista_precio_id          ON public.clientes (lista_precio_id);
CREATE INDEX IF NOT EXISTS idx_comprobante_items_oferta_id       ON public.comprobante_items (oferta_id);
CREATE INDEX IF NOT EXISTS idx_comprobantes_caea_registro_id     ON public.comprobantes (caea_registro_id);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_cliente_id           ON public.cotizaciones (cliente_id);
CREATE INDEX IF NOT EXISTS idx_devoluciones_cliente_id           ON public.devoluciones (cliente_id);
CREATE INDEX IF NOT EXISTS idx_devoluciones_proveedor_id         ON public.devoluciones (proveedor_id);
CREATE INDEX IF NOT EXISTS idx_entregas_cliente_id               ON public.entregas (cliente_id);
CREATE INDEX IF NOT EXISTS idx_extracto_lineas_cuenta_bancaria_id ON public.extracto_lineas (cuenta_bancaria_id);
CREATE INDEX IF NOT EXISTS idx_extracto_lineas_extracto_id       ON public.extracto_lineas (extracto_id);
CREATE INDEX IF NOT EXISTS idx_mpcb_cuenta_bancaria_id           ON public.metodo_pago_cuenta_bancaria (cuenta_bancaria_id);
CREATE INDEX IF NOT EXISTS idx_notas_debito_cliente_id           ON public.notas_debito (cliente_id);
CREATE INDEX IF NOT EXISTS idx_notas_debito_proveedor_id         ON public.notas_debito (proveedor_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_cliente_id                ON public.pedidos (cliente_id);
CREATE INDEX IF NOT EXISTS idx_productos_categoria_id            ON public.productos (categoria_id);
CREATE INDEX IF NOT EXISTS idx_recepciones_compra_id             ON public.recepciones (compra_id);
CREATE INDEX IF NOT EXISTS idx_recepciones_proveedor_id          ON public.recepciones (proveedor_id);
