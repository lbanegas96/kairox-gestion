-- Migration 383 -- Ajuste por Inflación, Fase 5 (interruptor comercial).
--
-- Pedido de Luciano: pensar el módulo completo (Fases 1-4: clasificación de
-- cuentas, índices, asiento de ajuste, reportes en moneda homogénea,
-- calculadora impositiva) como feature opt-in/premium para el resto de los
-- tenants de KAIROX, no algo que todos tengan prendido de entrada. Modelo
-- elegido: "mixto" -- el toggle es visible para TODAS las empresas desde
-- Configuración → Finanzas, pero activarlo muestra un aviso de que es una
-- funcionalidad premium (sin cobro automático todavía -- sirve para medir
-- interés real antes de montar un cobro).
--
-- Mismo patrón que empresas.usa_tc_paralelo (mig.041) / usa_impuestos_avanzados
-- (mig.173) / usa_centros_costo (mig.179): un booleano por empresa que
-- prende/apaga una sección completa desde Configuración.
--
-- DEFAULT false para TODAS -- a diferencia de mig.173 (que hizo backfill a
-- true para no sacarle a nadie algo que ya tenía visible), acá el módulo es
-- nuevo y todavía no lo usa nadie más que Nalux -- no tiene sentido
-- "regalarlo" prendido al resto sin que sea una decisión comercial explícita.
-- Backfill a true SOLO para Nalux, que ya lo viene usando activamente desde
-- que se construyó (Fases 1-4, este mismo día) -- apagárselo de golpe le
-- rompería lo que ya está usando.

ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS usa_ajuste_inflacion BOOLEAN NOT NULL DEFAULT false;

UPDATE public.empresas SET usa_ajuste_inflacion = true WHERE id = 'cbc4db74-ec31-4324-bd36-207b7a7bd99a';

-- ROLLBACK: ALTER TABLE public.empresas DROP COLUMN IF EXISTS usa_ajuste_inflacion;
