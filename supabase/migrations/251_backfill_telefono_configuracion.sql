-- Backfill puntual: empresas.telefono es una columna huérfana de una versión
-- anterior de Configuración → Empresa (ver migration 250 / fix de
-- getEmpresaParaPDF). El teléfono ahora se edita y se lee desde
-- `configuracion` (clave='telefono'), igual que dirección/rubro/email. Copiamos
-- el valor legado a `configuracion` solo donde no exista ya esa clave, para no
-- perder el dato de empresas que lo cargaron por el flujo viejo (ej. Nalux).
INSERT INTO public.configuracion (empresa_id, clave, valor)
SELECT id, 'telefono', telefono
FROM public.empresas
WHERE telefono IS NOT NULL AND telefono <> ''
ON CONFLICT (empresa_id, clave) DO NOTHING;
