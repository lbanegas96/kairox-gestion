-- Migration 093: backfill de series_numeracion.proximo_numero para alinear
-- con el máximo real de cada tabla, para los tipos con formato YYYY.
--
-- Causa: cuando migrations previas (083, 086) cambiaron callsites de
-- siguiente_numero_documento (COUNT*) a obtener_proximo_numero (FOR UPDATE
-- atómico), no incluyeron el backfill de series_numeracion. En tenants con
-- documentos preexistentes generados por la función vieja, la primera llamada
-- a obtener_proximo_numero reinicia el contador a 1 (porque periodo_actual
-- estaba NULL) y duplica números.
--
-- Síntoma confirmado en tenant cbc4: DEV-2026-0001 y DEV-2026-0002 emitidos
-- el 25-jun colisionaron con los del 13-jun. Se limpiaron manualmente antes
-- de aplicar este backfill.
--
-- Este backfill es idempotente: los tipos ya alineados se actualizan al mismo
-- valor; los tenants sin datos en la tabla no se tocan.

BEGIN;

UPDATE series_numeracion sn
SET proximo_numero = COALESCE(maxn.n, 0) + 1,
    periodo_actual = to_char(NOW() - INTERVAL '3 hours', 'YYYY')
FROM (
  SELECT empresa_id,
         MAX(NULLIF(regexp_replace(numero_devolucion, '.*-', ''), '')::INTEGER) AS n
  FROM devoluciones
  WHERE numero_devolucion LIKE 'DEV-' || to_char(NOW() - INTERVAL '3 hours', 'YYYY') || '-%'
  GROUP BY empresa_id
) maxn
WHERE sn.tipo_documento = 'devolucion' AND sn.empresa_id = maxn.empresa_id;

UPDATE series_numeracion sn
SET proximo_numero = COALESCE(maxn.n, 0) + 1,
    periodo_actual = to_char(NOW() - INTERVAL '3 hours', 'YYYY')
FROM (
  SELECT empresa_id,
         MAX(NULLIF(regexp_replace(numero_entrega, '.*-', ''), '')::INTEGER) AS n
  FROM entregas
  WHERE numero_entrega LIKE 'ENT-' || to_char(NOW() - INTERVAL '3 hours', 'YYYY') || '-%'
  GROUP BY empresa_id
) maxn
WHERE sn.tipo_documento = 'entrega' AND sn.empresa_id = maxn.empresa_id;

UPDATE series_numeracion sn
SET proximo_numero = COALESCE(maxn.n, 0) + 1,
    periodo_actual = to_char(NOW() - INTERVAL '3 hours', 'YYYY')
FROM (
  SELECT empresa_id,
         MAX(NULLIF(regexp_replace(numero_recepcion, '.*-', ''), '')::INTEGER) AS n
  FROM recepciones
  WHERE numero_recepcion LIKE 'REC-' || to_char(NOW() - INTERVAL '3 hours', 'YYYY') || '-%'
  GROUP BY empresa_id
) maxn
WHERE sn.tipo_documento = 'recepcion' AND sn.empresa_id = maxn.empresa_id;

UPDATE series_numeracion sn
SET proximo_numero = COALESCE(maxn.n, 0) + 1,
    periodo_actual = to_char(NOW() - INTERVAL '3 hours', 'YYYY')
FROM (
  SELECT empresa_id,
         MAX(NULLIF(regexp_replace(numero_nd, '.*-', ''), '')::INTEGER) AS n
  FROM notas_debito
  WHERE numero_nd LIKE 'ND-' || to_char(NOW() - INTERVAL '3 hours', 'YYYY') || '-%'
  GROUP BY empresa_id
) maxn
WHERE sn.tipo_documento = 'nota_debito' AND sn.empresa_id = maxn.empresa_id;

COMMIT;
