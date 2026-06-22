-- pgTAP test: public.crear_recepcion
--
-- TEST DE REGRESIÓN del bug de sesión 32: 2 caminos UI redundantes para
-- recepcionar una OC causaban doble incremento de stock_actual (87% de las
-- recepciones reales pasaban por el camino NO auditado). Fix en migration 053:
-- cuando el ítem de la recepción está vinculado a un ordenes_compra_items
-- (orden_compra_item_id IS NOT NULL — el caso real, siempre, vía
-- GenerarRecepcionModal), crear_recepcion NO actualiza stock_actual
-- directamente; delega 100% en el trigger trg_oc_stock/fn_oc_update_stock que
-- dispara el UPDATE de cantidad_recibida más abajo. El Caso 1 de este archivo
-- es la prueba directa de esa garantía: recibir 10 debe dejar el stock en
-- EXACTAMENTE 10, no 20.
--
-- Confirmado antes de escribir este test (grep fresco en src/): el ÚNICO
-- caller de crear_recepcion es GenerarRecepcionModal.jsx → OrdenesCompraSection
-- solo renderiza ese modal, no llama la RPC directo. CompraRapidaSection.jsx
-- llama una función DISTINTA (`crear_recepcion_implicita`, coincidencia de
-- nombre por substring) que ni siquiera toca stock_actual — solo crea el
-- registro de recepción para trazabilidad de "Compra Rápida". Un solo camino
-- vivo, confirmado: no hay hallazgo crítico de caminos duplicados que reportar.
--
-- SEGURIDAD: este archivo crea y destruye sus propios tenants/productos/OCs
-- de prueba dentro de una transacción que termina en ROLLBACK. Nunca toca
-- empresas ni productos reales.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(16);

-- ───────────────────────────────────────────────────────────────────────────
-- Fixtures: Tenant J (todos los casos salvo el guard de tenant) + Tenant K
-- (para el guard de tenant). Cada producto/OC está vinculado vía
-- orden_compra_item_id, igual que lo hace GenerarRecepcionModal.jsx en
-- producción — NO el camino "sin item de OC" de crear_recepcion (ese es para
-- otros orígenes, no para recepción contra OC real).
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO public.empresas (id, nombre, metodo_valoracion_stock) VALUES
  ('00000000-dead-0000-0000-000000000001', '__PGTAP_TEST__ Tenant J', 'promedio_ponderado'),
  ('00000000-b00b-0000-0000-000000000002', '__PGTAP_TEST__ Tenant K', 'ultimo_costo');

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at, email_confirmed_at)
VALUES
  ('00000000-dead-0000-0000-00000000000d', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-test-j@kairox.test', now(), now(), now()),
  ('00000000-b00b-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-test-k@kairox.test', now(), now(), now());

INSERT INTO public.profiles (id, empresa_id, email) VALUES
  ('00000000-dead-0000-0000-00000000000d', '00000000-dead-0000-0000-000000000001', 'pgtap-test-j@kairox.test'),
  ('00000000-b00b-0000-0000-00000000000b', '00000000-b00b-0000-0000-000000000002', 'pgtap-test-k@kairox.test');

INSERT INTO public.proveedores (id, empresa_id, nombre) VALUES
  ('00000000-dead-0000-0000-0000000000f1', '00000000-dead-0000-0000-000000000001', '__PGTAP_TEST__ Proveedor J'),
  ('00000000-b00b-0000-0000-0000000000f2', '00000000-b00b-0000-0000-000000000002', '__PGTAP_TEST__ Proveedor K');

INSERT INTO public.productos (id, empresa_id, nombre, stock_actual, costo_compra) VALUES
  ('00000000-dead-0000-0000-0000000000a1', '00000000-dead-0000-0000-000000000001', '__PGTAP_TEST__ Prod J1 (caso 1, simple)', 0, 0),
  ('00000000-dead-0000-0000-0000000000a2', '00000000-dead-0000-0000-000000000001', '__PGTAP_TEST__ Prod J2 (caso 2/3, parcial)', 0, 0),
  ('00000000-dead-0000-0000-0000000000a4', '00000000-dead-0000-0000-000000000001', '__PGTAP_TEST__ Prod J4 (caso 4, exceso)', 0, 0),
  ('00000000-dead-0000-0000-0000000000a7', '00000000-dead-0000-0000-000000000001', '__PGTAP_TEST__ Prod J7 (caso 7, PPP)', 20, 100),
  ('00000000-b00b-0000-0000-0000000000a6', '00000000-b00b-0000-0000-000000000002', '__PGTAP_TEST__ Prod K6 (otro tenant)', 0, 0);

INSERT INTO public.ordenes_compra (id, empresa_id, user_id, numero, proveedor_id, estado) VALUES
  ('00000000-dead-0000-0000-0000000000c1', '00000000-dead-0000-0000-000000000001', '00000000-dead-0000-0000-00000000000d', 'OC-TEST-1', '00000000-dead-0000-0000-0000000000f1', 'enviada'),
  ('00000000-dead-0000-0000-0000000000c2', '00000000-dead-0000-0000-000000000001', '00000000-dead-0000-0000-00000000000d', 'OC-TEST-2', '00000000-dead-0000-0000-0000000000f1', 'enviada'),
  ('00000000-dead-0000-0000-0000000000c4', '00000000-dead-0000-0000-000000000001', '00000000-dead-0000-0000-00000000000d', 'OC-TEST-4', '00000000-dead-0000-0000-0000000000f1', 'enviada'),
  ('00000000-dead-0000-0000-0000000000c7', '00000000-dead-0000-0000-000000000001', '00000000-dead-0000-0000-00000000000d', 'OC-TEST-7', '00000000-dead-0000-0000-0000000000f1', 'enviada'),
  ('00000000-b00b-0000-0000-0000000000c6', '00000000-b00b-0000-0000-000000000002', '00000000-b00b-0000-0000-00000000000b', 'OC-TEST-K', '00000000-b00b-0000-0000-0000000000f2', 'enviada');

INSERT INTO public.ordenes_compra_items (id, orden_id, empresa_id, producto_id, descripcion, cantidad_pedida, costo_unitario, subtotal) VALUES
  ('00000000-dead-0000-0000-0000000000d1', '00000000-dead-0000-0000-0000000000c1', '00000000-dead-0000-0000-000000000001', '00000000-dead-0000-0000-0000000000a1', 'Prod J1', 10, 0, 0),
  ('00000000-dead-0000-0000-0000000000d2', '00000000-dead-0000-0000-0000000000c2', '00000000-dead-0000-0000-000000000001', '00000000-dead-0000-0000-0000000000a2', 'Prod J2', 10, 0, 0),
  ('00000000-dead-0000-0000-0000000000d4', '00000000-dead-0000-0000-0000000000c4', '00000000-dead-0000-0000-000000000001', '00000000-dead-0000-0000-0000000000a4', 'Prod J4', 5, 0, 0),
  ('00000000-dead-0000-0000-0000000000d7', '00000000-dead-0000-0000-0000000000c7', '00000000-dead-0000-0000-000000000001', '00000000-dead-0000-0000-0000000000a7', 'Prod J7', 10, 200, 2000),
  ('00000000-b00b-0000-0000-0000000000d6', '00000000-b00b-0000-0000-0000000000c6', '00000000-b00b-0000-0000-000000000002', '00000000-b00b-0000-0000-0000000000a6', 'Prod K6', 5, 0, 0);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-dead-0000-0000-00000000000d","role":"authenticated"}', true);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 1 (REGRESIÓN DIRECTA del bug de sesión 32): OC con 1 ítem de cantidad
-- 10, recibir 10 → stock_actual debe subir EXACTAMENTE 10, no 20.
-- ───────────────────────────────────────────────────────────────────────────

SELECT public.crear_recepcion(
  '00000000-dead-0000-0000-000000000001'::uuid,
  '00000000-dead-0000-0000-00000000000d'::uuid,
  '00000000-dead-0000-0000-0000000000c1'::uuid,
  '[{"orden_compra_item_id":"00000000-dead-0000-0000-0000000000d1","producto_id":"00000000-dead-0000-0000-0000000000a1","cantidad":10}]'::jsonb
);

SELECT is(
  (SELECT stock_actual FROM public.productos WHERE id = '00000000-dead-0000-0000-0000000000a1'),
  10,
  'Caso 1 (REGRESION sesion 32): recibir 10 de una OC de 10 deja stock_actual=10, NO 20'
);

SELECT is(
  (SELECT cantidad_recibida::int FROM public.ordenes_compra_items WHERE id = '00000000-dead-0000-0000-0000000000d1'),
  10,
  'Caso 1: ordenes_compra_items.cantidad_recibida=10 tras recibir 10'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 2: recepción parcial. OC con ítem de cantidad 10, recibir 6 → stock
-- sube 6, cantidad_recibida=6. Se confirma el estado REAL de la OC (no se
-- asume 'recibida_parcial' sin confirmar primero).
-- ───────────────────────────────────────────────────────────────────────────

SELECT public.crear_recepcion(
  '00000000-dead-0000-0000-000000000001'::uuid,
  '00000000-dead-0000-0000-00000000000d'::uuid,
  '00000000-dead-0000-0000-0000000000c2'::uuid,
  '[{"orden_compra_item_id":"00000000-dead-0000-0000-0000000000d2","producto_id":"00000000-dead-0000-0000-0000000000a2","cantidad":6}]'::jsonb
);

SELECT is(
  (SELECT stock_actual FROM public.productos WHERE id = '00000000-dead-0000-0000-0000000000a2'),
  6,
  'Caso 2: recepcion parcial de 6 (de 10 pedidos) deja stock_actual=6'
);

SELECT is(
  (SELECT cantidad_recibida::int FROM public.ordenes_compra_items WHERE id = '00000000-dead-0000-0000-0000000000d2'),
  6,
  'Caso 2: cantidad_recibida=6 tras la recepcion parcial'
);

SELECT is(
  (SELECT estado FROM public.ordenes_compra WHERE id = '00000000-dead-0000-0000-0000000000c2'),
  'enviada',
  'Caso 2 (HALLAZGO, no bug del test): el estado de la OC NO se actualiza automaticamente a recibida_parcial — sigue en enviada'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 3: segunda recepción sobre la misma OC, completando lo parcial (4
-- restantes) → stock sube 4 MAS (total acumulado 10, no mas), cantidad_recibida
-- =10. Se confirma de nuevo el estado real (no se asume 'recibida').
-- ───────────────────────────────────────────────────────────────────────────

SELECT public.crear_recepcion(
  '00000000-dead-0000-0000-000000000001'::uuid,
  '00000000-dead-0000-0000-00000000000d'::uuid,
  '00000000-dead-0000-0000-0000000000c2'::uuid,
  '[{"orden_compra_item_id":"00000000-dead-0000-0000-0000000000d2","producto_id":"00000000-dead-0000-0000-0000000000a2","cantidad":4}]'::jsonb
);

SELECT is(
  (SELECT stock_actual FROM public.productos WHERE id = '00000000-dead-0000-0000-0000000000a2'),
  10,
  'Caso 3: completar la recepcion parcial (4 mas) deja stock_actual=10 acumulado, no mas'
);

SELECT is(
  (SELECT cantidad_recibida::int FROM public.ordenes_compra_items WHERE id = '00000000-dead-0000-0000-0000000000d2'),
  10,
  'Caso 3: cantidad_recibida=10 (6+4) tras completar la recepcion'
);

SELECT is(
  (SELECT estado FROM public.ordenes_compra WHERE id = '00000000-dead-0000-0000-0000000000c2'),
  'enviada',
  'Caso 3 (HALLAZGO, no bug del test): el estado de la OC sigue sin actualizarse a recibida ni con el 100% recibido'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 4: intentar recibir MAS de lo pendiente. Comportamiento REAL confirmado
-- por lectura de codigo antes de escribir este test: crear_recepcion NO valida
-- cantidad contra cantidad_pedida — el limite es 100% client-side (atributo
-- `max` del Input en GenerarRecepcionModal.jsx). Se documenta el
-- comportamiento real (acepta y sobre-recibe), NO se asume que deberia fallar.
-- ───────────────────────────────────────────────────────────────────────────

SELECT public.crear_recepcion(
  '00000000-dead-0000-0000-000000000001'::uuid,
  '00000000-dead-0000-0000-00000000000d'::uuid,
  '00000000-dead-0000-0000-0000000000c4'::uuid,
  '[{"orden_compra_item_id":"00000000-dead-0000-0000-0000000000d4","producto_id":"00000000-dead-0000-0000-0000000000a4","cantidad":8}]'::jsonb
);

SELECT is(
  (SELECT cantidad_recibida::int FROM public.ordenes_compra_items WHERE id = '00000000-dead-0000-0000-0000000000d4'),
  8,
  'Caso 4 (HALLAZGO, no bug del test): recibir 8 de una OC de 5 pedidos NO falla, cantidad_recibida queda en 8 (excede lo pedido)'
);

SELECT is(
  (SELECT stock_actual FROM public.productos WHERE id = '00000000-dead-0000-0000-0000000000a4'),
  8,
  'Caso 4: el stock tambien sube los 8 completos, sin tope contra lo pedido'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 5: trazabilidad SIN duplicar. La recepcion exitosa del Caso 1 debe
-- generar exactamente 1 fila en cada tabla involucrada — esto es justo lo que
-- fallaba antes del fix de sesion 32 (camino duplicado = filas duplicadas).
-- ───────────────────────────────────────────────────────────────────────────

SELECT is(
  (SELECT count(*)::int FROM public.recepciones WHERE orden_compra_id = '00000000-dead-0000-0000-0000000000c1'),
  1,
  'Caso 5a: exactamente 1 fila en recepciones para la OC del Caso 1 (no duplicada)'
);

SELECT is(
  (SELECT count(*)::int FROM public.recepcion_items WHERE orden_compra_item_id = '00000000-dead-0000-0000-0000000000d1'),
  1,
  'Caso 5b: exactamente 1 fila en recepcion_items (no duplicada)'
);

SELECT is(
  (SELECT count(*)::int FROM public.movimientos_inventario
   WHERE producto_id = '00000000-dead-0000-0000-0000000000a1' AND tipo = 'ingreso' AND cantidad = 10),
  1,
  'Caso 5c: exactamente 1 movimiento de inventario tipo ingreso cantidad 10 (no duplicado)'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 6: guard de tenant. Tenant J no puede recibir contra una OC de Tenant K.
-- ───────────────────────────────────────────────────────────────────────────

SELECT throws_like(
  $$ SELECT public.crear_recepcion(
       '00000000-dead-0000-0000-000000000001'::uuid,
       '00000000-dead-0000-0000-00000000000d'::uuid,
       '00000000-b00b-0000-0000-0000000000c6'::uuid,
       '[{"orden_compra_item_id":"00000000-b00b-0000-0000-0000000000d6","producto_id":"00000000-b00b-0000-0000-0000000000a6","cantidad":1}]'::jsonb
     ) $$,
  'Orden de compra no encontrada%',
  'Caso 6: crear_recepcion bloquea recepcion cross-tenant'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 7: costo PPP recalculado UNA sola vez por recepcion (no duplicado).
-- Producto J7: stock previo=20, costo previo=100. OC ítem: cantidad=10,
-- costo_unitario=200. PPP esperado = (20*100 + 10*200) / (20+10) = 133.33.
-- ───────────────────────────────────────────────────────────────────────────

SELECT public.crear_recepcion(
  '00000000-dead-0000-0000-000000000001'::uuid,
  '00000000-dead-0000-0000-00000000000d'::uuid,
  '00000000-dead-0000-0000-0000000000c7'::uuid,
  '[{"orden_compra_item_id":"00000000-dead-0000-0000-0000000000d7","producto_id":"00000000-dead-0000-0000-0000000000a7","cantidad":10}]'::jsonb
);

SELECT is(
  (SELECT stock_actual FROM public.productos WHERE id = '00000000-dead-0000-0000-0000000000a7'),
  30,
  'Caso 7a: stock_actual sube de 20 a 30 (20+10), una sola vez'
);

SELECT is(
  (SELECT round(costo_compra, 2) FROM public.productos WHERE id = '00000000-dead-0000-0000-0000000000a7'),
  round(4000.0 / 30, 2),
  'Caso 7b: costo PPP recalculado correctamente una sola vez: (20*100+10*200)/30 = 133.33'
);

SELECT * FROM finish();

ROLLBACK;
