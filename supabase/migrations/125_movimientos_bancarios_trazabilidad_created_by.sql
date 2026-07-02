-- migration 125 — movimientos_bancarios: trazabilidad de quién registró el movimiento
--
-- El auditor contable marca como red flag las tablas de movimientos sin created_by
-- (falta de audit trail). movimientos_bancarios no guardaba QUIÉN registró cada
-- movimiento manual. Luciano además pidió mostrar esta info en la UI de Bancos.
--
-- Se agregan 2 columnas:
--   created_by         → auth uid del usuario que registró el movimiento manual/CSV.
--                        NULL para movimientos de integraciones (mp-webhook, mp-sync,
--                        uala) que corren como service_role, sin sesión de usuario.
--   created_by_nombre  → snapshot INMUTABLE del nombre del usuario al momento de
--                        registrar (patrón de audit trail: el nombre no cambia aunque
--                        el usuario se renombre o se elimine después). NULL para
--                        integraciones — la UI deriva el ejecutor del origen.
--
-- Se guarda el nombre denormalizado (no un JOIN a profiles) a propósito: profiles
-- tiene RLS admin-only para SELECT, así que un cajero/vendedor no podría resolver el
-- nombre vía JOIN. El snapshot evita ese acoplamiento y es lo correcto para auditoría.
--
-- ROLLBACK:
--   ALTER TABLE public.movimientos_bancarios
--     DROP COLUMN IF EXISTS created_by,
--     DROP COLUMN IF EXISTS created_by_nombre;

ALTER TABLE public.movimientos_bancarios
  ADD COLUMN IF NOT EXISTS created_by        uuid,
  ADD COLUMN IF NOT EXISTS created_by_nombre text;

COMMENT ON COLUMN public.movimientos_bancarios.created_by IS
  'Auth uid del usuario que registró el movimiento manual/CSV. NULL para integraciones (service_role).';
COMMENT ON COLUMN public.movimientos_bancarios.created_by_nombre IS
  'Snapshot inmutable del nombre del usuario que registró el movimiento (audit trail). NULL para integraciones.';
