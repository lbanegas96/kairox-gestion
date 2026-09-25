-- pgTAP test: una factura de proveedor no se puede cargar dos veces (mig. 411)
--
-- Auditoría 24/09/2026, hallazgo CON-6. Este test confirma que el índice único `uq_compras_factura_proveedor`:
--   - rechaza la misma factura (mismo proveedor y mismo número) dentro del Libro IVA, sin distinguir mayúsculas ni espacios,
--   - rechaza también cambiarle el número a una compra por uno que ya existe (el camino de «editar compra»),
--   - deja pasar lo que no es un duplicado: otro proveedor, otra letra, otra empresa, compras «No libro», números
--     vacíos o «S/N», y volver a cargar una factura cuya copia anterior fue anulada.
--
-- SEGURIDAD: crea y destruye sus propios tenants/proveedores/compras sintéticos dentro de una transacción
-- que termina en ROLLBACK. Nunca toca empresas ni datos reales.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(12);

-- ───────────────────────────────────────────────────────────────────────────
-- Fixtures: dos empresas, cada una con sus proveedores.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO public.empresas (id, nombre) VALUES
  ('00000000-fa01-0000-0000-000000000001', '__PGTAP_TEST__ Empresa A facturas'),
  ('00000000-fa01-0000-0000-000000000002', '__PGTAP_TEST__ Empresa B facturas');

INSERT INTO public.proveedores (id, empresa_id, nombre) VALUES
  ('00000000-fa01-0000-0000-0000000000b1', '00000000-fa01-0000-0000-000000000001', '__PGTAP_TEST__ Proveedor 1'),
  ('00000000-fa01-0000-0000-0000000000b2', '00000000-fa01-0000-0000-000000000001', '__PGTAP_TEST__ Proveedor 2'),
  ('00000000-fa01-0000-0000-0000000000b3', '00000000-fa01-0000-0000-000000000002', '__PGTAP_TEST__ Proveedor B');

-- La factura original.
INSERT INTO public.compras (id, empresa_id, proveedor_id, numero_factura, en_libro_iva) VALUES
  ('00000000-fa01-0000-0000-0000000000c1', '00000000-fa01-0000-0000-000000000001', '00000000-fa01-0000-0000-0000000000b1', 'A-0001-00000001', true);

-- ───────────────────────────────────────────────────────────────────────────
-- Casos 1-3: el duplicado se rechaza.
-- ───────────────────────────────────────────────────────────────────────────

SELECT throws_like(
  $$INSERT INTO public.compras (empresa_id, proveedor_id, numero_factura, en_libro_iva) VALUES ('00000000-fa01-0000-0000-000000000001', '00000000-fa01-0000-0000-0000000000b1', 'A-0001-00000001', true)$$,
  '%uq_compras_factura_proveedor%',
  'Caso 1: la misma factura del mismo proveedor no se puede cargar dos veces'
);

SELECT throws_like(
  $$INSERT INTO public.compras (empresa_id, proveedor_id, numero_factura, en_libro_iva) VALUES ('00000000-fa01-0000-0000-000000000001', '00000000-fa01-0000-0000-0000000000b1', '  a-0001-00000001 ', true)$$,
  '%uq_compras_factura_proveedor%',
  'Caso 2: tampoco si cambian las mayusculas o sobran espacios'
);

INSERT INTO public.compras (id, empresa_id, proveedor_id, numero_factura, en_libro_iva) VALUES
  ('00000000-fa01-0000-0000-0000000000c2', '00000000-fa01-0000-0000-000000000001', '00000000-fa01-0000-0000-0000000000b1', 'A-0001-00000002', true);

SELECT throws_like(
  $$UPDATE public.compras SET numero_factura = 'A-0001-00000001' WHERE id = '00000000-fa01-0000-0000-0000000000c2'$$,
  '%uq_compras_factura_proveedor%',
  'Caso 3: cambiarle el numero a una compra por uno que ya existe (editar compra) tambien se rechaza'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Casos 4-9: lo que NO es un duplicado.
-- ───────────────────────────────────────────────────────────────────────────

SELECT lives_ok(
  $$INSERT INTO public.compras (empresa_id, proveedor_id, numero_factura, en_libro_iva) VALUES ('00000000-fa01-0000-0000-000000000001', '00000000-fa01-0000-0000-0000000000b2', 'A-0001-00000001', true)$$,
  'Caso 4: otro proveedor puede tener una factura con el mismo numero'
);

SELECT lives_ok(
  $$INSERT INTO public.compras (empresa_id, proveedor_id, numero_factura, en_libro_iva) VALUES ('00000000-fa01-0000-0000-000000000001', '00000000-fa01-0000-0000-0000000000b1', 'B-0001-00000001', true)$$,
  'Caso 5: la misma numeracion con otra letra (factura B) es otra factura'
);

SELECT lives_ok(
  $$INSERT INTO public.compras (empresa_id, proveedor_id, numero_factura, en_libro_iva) VALUES ('00000000-fa01-0000-0000-000000000002', '00000000-fa01-0000-0000-0000000000b3', 'A-0001-00000001', true)$$,
  'Caso 6: otra empresa puede tener el mismo numero'
);

SELECT lives_ok(
  $$INSERT INTO public.compras (empresa_id, proveedor_id, numero_factura, en_libro_iva) VALUES ('00000000-fa01-0000-0000-000000000001', '00000000-fa01-0000-0000-0000000000b1', 'ticket 12', false), ('00000000-fa01-0000-0000-000000000001', '00000000-fa01-0000-0000-0000000000b1', 'ticket 12', false)$$,
  'Caso 7: las compras «No libro» (tickets, referencias libres) pueden repetir la referencia'
);

SELECT lives_ok(
  $$INSERT INTO public.compras (empresa_id, proveedor_id, numero_factura, en_libro_iva) VALUES ('00000000-fa01-0000-0000-000000000001', '00000000-fa01-0000-0000-0000000000b1', 'S/N', true), ('00000000-fa01-0000-0000-000000000001', '00000000-fa01-0000-0000-0000000000b1', 's/n', true), ('00000000-fa01-0000-0000-000000000001', '00000000-fa01-0000-0000-0000000000b1', NULL, true), ('00000000-fa01-0000-0000-000000000001', '00000000-fa01-0000-0000-0000000000b1', '  ', true)$$,
  'Caso 8: sin numero real (S/N, vacio o nulo) no hay nada que comparar'
);

UPDATE public.compras SET estado_pago = 'anulada' WHERE id = '00000000-fa01-0000-0000-0000000000c1';

SELECT lives_ok(
  $$INSERT INTO public.compras (empresa_id, proveedor_id, numero_factura, en_libro_iva) VALUES ('00000000-fa01-0000-0000-000000000001', '00000000-fa01-0000-0000-0000000000b1', 'A-0001-00000001', true)$$,
  'Caso 9: si la copia anterior esta anulada, la factura se puede volver a cargar'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Casos 10-12: la copia nueva vuelve a estar protegida, y el índice tiene la forma esperada.
-- ───────────────────────────────────────────────────────────────────────────

SELECT throws_like(
  $$INSERT INTO public.compras (empresa_id, proveedor_id, numero_factura, en_libro_iva) VALUES ('00000000-fa01-0000-0000-000000000001', '00000000-fa01-0000-0000-0000000000b1', 'A-0001-00000001', true)$$,
  '%uq_compras_factura_proveedor%',
  'Caso 10: la copia nueva (no anulada) vuelve a bloquear un tercer intento'
);

SELECT is(
  (SELECT count(*)::int FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'uq_compras_factura_proveedor' AND indexdef LIKE 'CREATE UNIQUE INDEX%'),
  1,
  'Caso 11: existe el indice unico parcial uq_compras_factura_proveedor'
);

SELECT is(
  (SELECT indexdef LIKE '%en_libro_iva%' AND indexdef LIKE '%anulada%' FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'uq_compras_factura_proveedor'),
  true,
  'Caso 12: y solo alcanza a las compras del Libro que no estan anuladas'
);

SELECT * FROM finish();

ROLLBACK;
