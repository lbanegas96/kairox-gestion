-- ════════════════════════════════════════════════════════════════════════════
-- migration 076 — Hallazgos de PLAN_AUDITORIA_2.md sección 2
-- Endurecimiento de precisión: PPP + moneda paralela
-- ════════════════════════════════════════════════════════════════════════════
--
-- HALLAZGO 1 — Drift de PPP por persistencia a 2 decimales
-- (confirmado empíricamente en sesión 53)
--
-- fn_calcular_costo_valoracion devuelve numeric sin bounds (preserva ~20
-- dígitos), pero productos.costo_compra estaba declarado numeric(12,2).
-- En el modo 'promedio_ponderado', cada compra encadenada partía de un costo
-- truncado a 2 decimales, drifteando el cálculo. Ejemplo: PPP exacto
-- 1.00004950... → persistido 1.00 → siguiente PPP parte de 1.00 en vez de
-- 1.0001, drift acumulado de ~0.0001 por compra.
--
-- Severidad: muy baja para datos reales actuales (centésimas de drift en
-- cientos de compras), pero patrón incorrecto. La ventana para arreglarlo
-- es ahora: costo_compra solo se persiste como dato — no participa de
-- queries de comparación ni de FKs.
--
-- Fix: ampliar a numeric(14,4). 4 decimales de precisión retiene el PPP
-- entre compras encadenadas. La UI sigue mostrando 2 decimales vía
-- formatCurrency (no hay impacto visual).
--
-- ────────────────────────────────────────────────────────────────────────
--
-- HALLAZGO 2 — Moneda paralela sin precisión definida
-- (riesgo teórico, confirmado por inspección de schema)
--
-- Las 4 columnas monto_paralelo (comprobantes, movimientos_caja,
-- cuenta_corriente_movimientos, compras) estaban declaradas numeric sin
-- precision/scale. Postgres preserva exactamente lo que recibe del cliente,
-- incluyendo error binario de IEEE 754 (calcParalelo en JS hace `inARS / tcUsed`
-- puro double, introduciendo ε de ~1e-13 por operación).
--
-- Verificación: 0 filas con monto_paralelo en producción al momento del fix
-- (la feature está implementada pero ningún cliente la usa todavía).
-- Esta es la ventana óptima para endurecer sin afectar data histórica.
--
-- Severidad: solo teórica al momento (sin data). Pero el patrón actual
-- garantiza errores acumulados cuando empiece a usarse. Fix: numeric(14,4)
-- + ajuste en useTCParalelo.js (commit aparte) para limitar a 2dp en JS.

-- ─── Hallazgo 1 ────────────────────────────────────────────────────────────
ALTER TABLE public.productos
  ALTER COLUMN costo_compra TYPE numeric(14,4);

-- ─── Hallazgo 2 ────────────────────────────────────────────────────────────
ALTER TABLE public.comprobantes
  ALTER COLUMN monto_paralelo TYPE numeric(14,4);

ALTER TABLE public.movimientos_caja
  ALTER COLUMN monto_paralelo TYPE numeric(14,4);

ALTER TABLE public.cuenta_corriente_movimientos
  ALTER COLUMN monto_paralelo TYPE numeric(14,4);

ALTER TABLE public.compras
  ALTER COLUMN monto_paralelo TYPE numeric(14,4);

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (comentado): volver a las precisiones previas.
-- Solo seguro de correr si no se cargaron datos con más de 2 decimales después
-- de aplicar 076 — si los hay, esta operación trunca silenciosamente.
--
-- ALTER TABLE public.productos                     ALTER COLUMN costo_compra    TYPE numeric(12,2);
-- ALTER TABLE public.comprobantes                  ALTER COLUMN monto_paralelo  TYPE numeric;
-- ALTER TABLE public.movimientos_caja              ALTER COLUMN monto_paralelo  TYPE numeric;
-- ALTER TABLE public.cuenta_corriente_movimientos  ALTER COLUMN monto_paralelo  TYPE numeric;
-- ALTER TABLE public.compras                       ALTER COLUMN monto_paralelo  TYPE numeric;
