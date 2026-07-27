-- Datos fiscales legalmente requeridos en el membrete de comprobantes (RG 1415 AFIP):
-- número de inscripción en Ingresos Brutos y fecha de inicio de actividades.
-- No existían como columna en ningún lado (jurisdiccion_iibb solo guarda la
-- jurisdicción, no el número de inscripción).
ALTER TABLE public.empresas ADD COLUMN IF NOT EXISTS numero_ingresos_brutos TEXT;
ALTER TABLE public.empresas ADD COLUMN IF NOT EXISTS fecha_inicio_actividades DATE;
