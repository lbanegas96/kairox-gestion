-- Migration 248: Toggle por empresa para ocultar el módulo Cotizaciones
-- (Configuración → Facturación). Default true — ninguna empresa existente
-- cambia de comportamiento sin que alguien apague el switch a propósito.

ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS cotizaciones_activo BOOLEAN NOT NULL DEFAULT true;
