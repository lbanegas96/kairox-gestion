-- ════════════════════════════════════════════════════════════════════════════
-- migration 157 — Asiento de apertura: cheques de terceros anteriores a mig.145
-- ════════════════════════════════════════════════════════════════════════════
--
-- Contexto (CONTEXT.md sesión 46 cont.9 / sesión 49): la migration 145 agregó
-- contabilización automática de cheques de terceros (Debe 1.1.6 al recibirlos,
-- Haber 1.1.6 al cobrarlos/rechazarlos). Los cheques creados ANTES de esa
-- migration nunca tuvieron el asiento de "recepción" (Debe 1.1.6). Dos de ellos
-- quedaron con efecto residual real en la cuenta 1.1.6 "Cheques de Terceros en
-- Cartera" de la empresa Nalux (cbc4db74-ec31-4324-bd36-207b7a7bd99a):
--
--   - Cheque 00001234 ($150.000, rechazado el 2026-07-06): el asiento de rechazo
--     (AS-000135, ya con mig.145 activa) sí se generó — Debe 1.1.2 / Haber 1.1.6 —
--     pero como el Debe 1.1.6 de la recepción nunca existió, esto dejó 1.1.6 en
--     saldo Haber (activo con saldo negativo, contablemente inválido).
--   - Cheque 00005678 ($80.000, "depositado", aún sin resolver): sigue siendo un
--     activo real en cartera hoy, pero nunca tuvo su Debe 1.1.6 de recepción.
--
-- Los otros cheques pre-mig.145 (00001, 000002, 00003, 00004, 00005432)
-- completaron todo su ciclo de vida (alta y baja) ANTES de que el trigger
-- existiera, sin dejar ningún rastro en 1.1.6 — no requieren ajuste porque su
-- efecto neto en el saldo actual ya es cero.
--
-- Tratamiento contable (decisión del contador, sesión 2026-07-06): esto NO es
-- un hecho económico del ejercicio (no hay una venta o cobro nuevo hoy), es la
-- corrección de un gap de implementación de sistema descubierto con el período
-- de julio todavía abierto. Se registra contra "3.2 Resultados Acumulados"
-- (patrimonio) en vez de contra 1.1.2/4.3 —usar esas cuentas otra vez hubiera
-- duplicado la reducción de deuda de clientes ya registrada por otra vía en el
-- sub-libro de Cuenta Corriente (movimientos manuales de "Pago de deuda"), que
-- no tiene relación 1 a 1 verificable con estos cheques puntuales.
--
-- Efecto: 1.1.6 pasa de -150.000 a +80.000 (exactamente el valor del único
-- cheque de tercero que sigue genuinamente en cartera hoy).

DO $$
DECLARE
  v_empresa_id      uuid := 'cbc4db74-ec31-4324-bd36-207b7a7bd99a';
  v_user_id         uuid := 'c55324d2-b6bb-4ea1-b1ed-a3c801b8df45';
  v_cta_cartera     uuid;
  v_cta_resultados  uuid;
  v_asiento_id      uuid;
  v_desc            text := 'Ajuste de apertura — Cheques de terceros anteriores al alta del asiento automático (mig. 145)';
BEGIN
  -- Esta migration es un ajuste de datos one-shot sobre la empresa Nalux (UUID fijo
  -- arriba). En una base recién creada desde cero (el CI, que replaya todas las
  -- migrations sobre un Postgres vacío) esa empresa no existe y no hay ningún cheque
  -- que corregir → salir sin hacer nada. El chequeo de las cuentas de abajo se
  -- mantiene tal cual para el caso real: si la empresa SÍ existe pero le faltan las
  -- cuentas 1.1.6/3.2, eso sigue siendo un error y aborta como siempre.
  IF NOT EXISTS (SELECT 1 FROM public.empresas WHERE id = v_empresa_id) THEN
    RAISE NOTICE 'mig157: la empresa % no existe (base nueva) — no hay cheques que ajustar, se omite', v_empresa_id;
    RETURN;
  END IF;

  SELECT id INTO v_cta_cartera    FROM public.plan_cuentas WHERE empresa_id = v_empresa_id AND codigo = '1.1.6' AND activa;
  SELECT id INTO v_cta_resultados FROM public.plan_cuentas WHERE empresa_id = v_empresa_id AND codigo = '3.2'   AND activa;

  IF v_cta_cartera IS NULL OR v_cta_resultados IS NULL THEN
    RAISE EXCEPTION 'No se encontraron las cuentas 1.1.6 / 3.2 para la empresa %', v_empresa_id;
  END IF;

  INSERT INTO public.asientos_contables
    (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
  VALUES (v_empresa_id, v_user_id, next_numero_asiento(v_empresa_id), CURRENT_DATE, v_desc,
          'confirmado', 230000, 230000, 'ajuste_apertura', NULL)
  RETURNING id INTO v_asiento_id;

  INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
    (v_asiento_id, v_empresa_id, v_cta_cartera,    'Cheque 00001234 (rechazado) — recomposición de saldo faltante, recepción nunca contabilizada (pre-mig.145)', 150000, 0),
    (v_asiento_id, v_empresa_id, v_cta_cartera,    'Cheque 00005678 (depositado, aún en cartera) — recepción nunca contabilizada (pre-mig.145)', 80000, 0),
    (v_asiento_id, v_empresa_id, v_cta_resultados, v_desc, 0, 230000);
END $$;
