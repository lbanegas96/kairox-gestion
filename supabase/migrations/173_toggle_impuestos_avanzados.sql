-- migration 173 — Toggle "Impuestos Avanzados" por empresa (sesión 55, 2026-07-09).
--
-- Pedido de Luciano: que IIBB / Retenciones-Percepciones / Convenio Multilateral
-- sean activables por empresa desde Configuración. Si el cliente no los necesita,
-- que no se activen (opt-in); si los activa, que aparezcan sus solapas y acciones.
-- IVA queda SIEMPRE disponible (todo negocio lo necesita), no depende de este flag.
--
-- Patrón: idéntico a empresas.usa_tc_paralelo (migration 041) — un booleano por
-- empresa que prende/apaga una feature completa desde ConfiguracionSection.
--
-- DEFAULT false = opt-in para empresas NUEVAS. Backfill a true para empresas ya
-- existentes: hoy la sección Impuestos (IVA + IIBB + Retenciones + Alícuotas)
-- siempre estuvo visible, así que ponerlas en false sorprendería a un tenant en
-- uso (ej. Nalux perdería solapas de golpe). Se preserva el comportamiento actual
-- y queda a criterio de cada empresa apagarlo desde la UI.

ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS usa_impuestos_avanzados BOOLEAN NOT NULL DEFAULT false;

-- Backfill: empresas existentes conservan la funcionalidad que ya venían viendo.
UPDATE public.empresas SET usa_impuestos_avanzados = true WHERE usa_impuestos_avanzados = false;

-- ROLLBACK (comentado):
-- ALTER TABLE public.empresas DROP COLUMN IF EXISTS usa_impuestos_avanzados;
