-- 325b — Fix URGENTE de la migration 325.
--
-- CREATE OR REPLACE FUNCTION en Postgres reemplaza una función existente
-- sólo si la lista de TIPOS de parámetros es idéntica. Al agregarle 3
-- parámetros nuevos a crear_venta en la migration 325, Postgres no la
-- reemplazó: creó una SOBRECARGA nueva (mismo nombre, firma distinta), y
-- quedaron DOS versiones de crear_venta activas al mismo tiempo (22
-- parámetros la vieja, 25 la nueva). Eso rompe cualquier llamada que no
-- alcance a desambiguar sola contra las dos — que es exactamente cómo llama
-- hoy el POS y el ERP (useConfirmarVenta.js, NuevaVentaModal.jsx) — con el
-- error "function ... is not unique". Detectado probando la migration 325
-- contra datos reales (dentro de una transacción con ROLLBACK) antes de
-- tocar el frontend.
--
-- Fix: eliminar explícitamente la sobrecarga vieja de 22 parámetros. Queda
-- una sola función crear_venta (la de 25 parámetros, con los 3 nuevos
-- opcionales via DEFAULT NULL) — vuelve a resolver sin ambigüedad para
-- todos los llamadores existentes.
--
-- Lección para cualquier migration futura que le agregue parámetros a una
-- función existente: verificar después con
-- SELECT pg_get_function_identity_arguments(oid) FROM pg_proc WHERE proname = '...'
-- que quedó una sola versión — CREATE OR REPLACE no alcanza por sí solo.

DROP FUNCTION IF EXISTS public.crear_venta(
  uuid, uuid, text, timestamp with time zone, uuid, text, numeric, text, text,
  text, numeric, numeric, numeric, jsonb, jsonb, boolean, uuid, uuid, numeric,
  uuid, uuid, integer
);
