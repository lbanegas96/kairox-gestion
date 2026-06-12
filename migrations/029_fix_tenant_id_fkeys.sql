-- migrations/029_fix_tenant_id_fkeys.sql
-- Fix: tenant_id en comprobantes, movimientos_inventario y caja_sesiones
-- apuntaba a profiles(id) pero el código inserta empresa_id.
-- Corregir datos existentes y redirigir FK a empresas.

-- Paso 1: Drop constraints viejos
ALTER TABLE public.comprobantes DROP CONSTRAINT IF EXISTS comprobantes_tenant_id_fkey;
ALTER TABLE public.movimientos_inventario DROP CONSTRAINT IF EXISTS movimientos_inventario_tenant_id_fkey;
ALTER TABLE public.caja_sesiones DROP CONSTRAINT IF EXISTS caja_sesiones_tenant_id_fkey;

-- Paso 2: Corregir datos — tenant_id apuntaba a profile, debe ser empresa_id
UPDATE public.comprobantes SET tenant_id = empresa_id WHERE tenant_id IS NOT NULL AND tenant_id != empresa_id;
UPDATE public.movimientos_inventario SET tenant_id = empresa_id WHERE tenant_id IS NOT NULL AND tenant_id != empresa_id;
UPDATE public.caja_sesiones SET tenant_id = empresa_id WHERE tenant_id IS NOT NULL AND tenant_id != empresa_id;

-- Paso 3: Recrear constraints apuntando a empresas
ALTER TABLE public.comprobantes ADD CONSTRAINT comprobantes_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.empresas(id) ON DELETE SET NULL;

ALTER TABLE public.movimientos_inventario ADD CONSTRAINT movimientos_inventario_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.empresas(id) ON DELETE SET NULL;

ALTER TABLE public.caja_sesiones ADD CONSTRAINT caja_sesiones_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.empresas(id) ON DELETE CASCADE;
