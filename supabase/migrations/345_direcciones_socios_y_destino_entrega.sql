-- Item 7 del plan de rediseño (22/08) — base de datos para la solapa Logística.
--
-- Hallazgo de Luciano que disparó esto: si copiamos la solapa de Entregas de
-- SAP, la carga de clientes/proveedores tiene que poder alimentarla. Al mapear
-- apareció algo más urgente que la solapa: `clientes` solo tiene `direccion`
-- (texto libre) — sin localidad, provincia ni CP — así que el remito que emite
-- RemitoPDF.jsx sale con una dirección incompleta, inservible para que un
-- transportista entregue. `proveedores` estaba MÁS completo que `clientes`
-- (tenía localidad + provincia), al revés de lo que hace falta.
--
-- Alcance decidido con Luciano: UNA dirección completa por socio de negocio
-- (no multi-dirección estilo SAP todavía). El diseño deja la puerta abierta:
-- las columnas destino_* de `entregas` son texto plano e independientes de
-- DÓNDE salió la dirección, así que el día que exista una tabla `direcciones`
-- se agrega `destino_direccion_id` al lado y estas siguen funcionando igual.

-- ─── 1. Simetría de direcciones en los maestros ──────────────────────────────
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS localidad      text,
  ADD COLUMN IF NOT EXISTS provincia      text,
  ADD COLUMN IF NOT EXISTS codigo_postal  text;

ALTER TABLE public.proveedores
  ADD COLUMN IF NOT EXISTS codigo_postal  text;

-- ─── 2. Snapshot del destino en la Entrega ───────────────────────────────────
-- Regla 7 (trazabilidad): el documento CONGELA la dirección, no apunta al
-- maestro. Si el cliente se muda el año que viene, el remito del año pasado
-- tiene que seguir diciendo dónde se entregó realmente — mismo criterio que ya
-- usa SAP en sus documentos de marketing.
--
-- `transportista` va como texto libre a propósito: es un campo del documento
-- (como `observaciones`), no un maestro creado al vuelo — eso violaría la
-- Regla 2. Si más adelante hace falta un maestro de transportistas, se agrega
-- `transportista_id` al lado y este campo queda como el snapshot del nombre.
ALTER TABLE public.entregas
  ADD COLUMN IF NOT EXISTS destino_direccion      text,
  ADD COLUMN IF NOT EXISTS destino_localidad      text,
  ADD COLUMN IF NOT EXISTS destino_provincia      text,
  ADD COLUMN IF NOT EXISTS destino_codigo_postal  text,
  ADD COLUMN IF NOT EXISTS transportista          text;

-- ─── 3. Trigger de snapshot ──────────────────────────────────────────────────
-- Se hace por trigger y NO modificando crear_entrega / crear_entrega_manual a
-- propósito: son dos RPCs distintas, y agregarles parámetros nuevos vuelve a
-- exponernos al bug de sobrecarga de CREATE OR REPLACE que ya nos mordió dos
-- veces (crear_venta el 14/08, registrar_cobro_cliente el 22/08). El trigger
-- cubre los dos caminos de alta sin tocar ninguna firma.
--
-- COALESCE por campo: si algún día el alta manda una dirección explícita
-- (entrega a un domicilio distinto al del maestro), ese valor gana.
CREATE OR REPLACE FUNCTION public.fn_entrega_snapshot_destino()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.cliente_id IS NOT NULL THEN
    SELECT
      COALESCE(NEW.destino_direccion,     c.direccion),
      COALESCE(NEW.destino_localidad,     c.localidad),
      COALESCE(NEW.destino_provincia,     c.provincia),
      COALESCE(NEW.destino_codigo_postal, c.codigo_postal)
    INTO
      NEW.destino_direccion,
      NEW.destino_localidad,
      NEW.destino_provincia,
      NEW.destino_codigo_postal
    FROM public.clientes c
    WHERE c.id = NEW.cliente_id
      AND c.empresa_id = NEW.empresa_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_entrega_snapshot_destino ON public.entregas;
CREATE TRIGGER trg_entrega_snapshot_destino
  BEFORE INSERT ON public.entregas
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_entrega_snapshot_destino();

-- ─── 4. Nada de backfill, a propósito ────────────────────────────────────────
-- Las entregas ya existentes quedan con destino_* en NULL. Completarlas con la
-- dirección ACTUAL del cliente afirmaría algo que no podemos verificar (que se
-- entregó ahí). El frontend hace fallback al maestro cuando el snapshot es
-- NULL, que es honesto: "no lo congelamos en su momento, esto es lo que sabemos
-- hoy". De acá en adelante toda entrega nueva queda congelada.
