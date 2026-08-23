-- Pedido de Luciano (23/08): "En Preparación" tiene sentido para cadenas de
-- suministro grandes, pero estorba a negocios con un proceso más acotado.
-- Config opt-out en vez de tocar nada del histórico — instrucción explícita
-- de Luciano: "ninguna configuración debería interferir con el histórico,
-- solo de aquí para adelante, sino no podría reconfigurar ningún sistema".
--
-- Default TRUE a propósito: apagar esto es una decisión activa de cada
-- empresa, nadie pierde el paso que ya tenía sin pedirlo.
ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS usa_estado_en_preparacion boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.empresas.usa_estado_en_preparacion IS
  'Si es false, "Avanzar" en Pedidos salta confirmado -> facturado directo, sin pasar por en_preparacion. No migra pedidos ya existentes en en_preparacion — esos se resuelven desde la alerta del frontend, no acá.';
