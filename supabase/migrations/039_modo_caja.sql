-- Prompt 10: Modo Caja — columna para activar POS pantalla completa por usuario
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS modo_caja BOOLEAN NOT NULL DEFAULT false;

-- Índice parcial: solo perfiles con modo_caja = true (mayoría false, índice liviano)
CREATE INDEX IF NOT EXISTS idx_profiles_modo_caja
  ON public.profiles(empresa_id, modo_caja)
  WHERE modo_caja = true;

NOTIFY pgrst, 'reload schema';
