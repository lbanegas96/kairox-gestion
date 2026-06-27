-- Migration 105: agregar columna codigo_barras a productos + índice parcial.
--
-- Soporte para lectores de código de barras USB/Bluetooth en el POS.
-- El cajero escanea, el scanner manda Enter, el frontend busca match exacto
-- en esta columna y agrega el producto al carrito sin mostrar dropdown.
--
-- Índice parcial: solo indexa filas con código cargado para no inflar el
-- índice con NULLs (la mayoría de productos no van a tener código de barras
-- al menos al inicio).

ALTER TABLE productos ADD COLUMN IF NOT EXISTS codigo_barras varchar(50);

CREATE INDEX IF NOT EXISTS idx_productos_codigo_barras
  ON productos(empresa_id, codigo_barras)
  WHERE codigo_barras IS NOT NULL;
