-- Migration 214 — Maestro real de Formas de Pago
--
-- HALLAZGO (análisis de tesorería, sesión 74): registrar_cobro_cliente / registrar_pago_proveedor
-- reciben el medio de pago como un string libre (`p_metodo`), elegido en un <select> hardcodeado
-- y repetido —con listas ligeramente distintas— en ModalCobro.jsx, ProveedoresSection.jsx y
-- PanelPago.jsx/PanelCarrito.jsx. No hay un objeto real detrás de "Tarjeta": no sabe a qué cuenta
-- bancaria acredita, en cuántos días ni con qué comisión. `metodo_pago_cuenta_bancaria` solo
-- mapea el string a una cuenta contable, sin ID estable — dos pantallas pueden escribir el medio
-- de pago con un texto ligeramente distinto y el mapeo deja de aplicar en silencio.
--
-- Este es el mismo patrón SAP B1/S4HANA de "Formas de Pago" como maestro configurable (separado
-- de Condiciones de Pago, que ya tenemos): instrumento fijo + medio de pago concreto por empresa
-- + cuenta bancaria destino, con lugar para días de acreditación y comisión (usados recién en la
-- fase siguiente — acá solo se crean las columnas).
--
-- Alcance de ESTA migration: crear el maestro, poblarlo con lo que ya está en uso real (verificado
-- contra movimientos_caja/metodo_pago_cuenta_bancaria de las 3 empresas existentes), y dejar el
-- auto-seed andando para empresas nuevas. Los RPCs y el trigger puente Caja→Bancos se migran en la
-- 215 (paso siguiente) — esta migration es aditiva, no rompe nada de lo que ya funciona.

CREATE TABLE public.formas_pago (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  nombre              TEXT NOT NULL,
  tipo_instrumento    TEXT NOT NULL CHECK (tipo_instrumento IN (
                         'efectivo', 'transferencia', 'tarjeta_debito', 'tarjeta_credito',
                         'cheque', 'billetera', 'otro'
                       )),
  cuenta_bancaria_id  UUID REFERENCES public.cuentas_bancarias(id) ON DELETE SET NULL,
  dias_acreditacion   INTEGER NOT NULL DEFAULT 0 CHECK (dias_acreditacion >= 0),
  comision_porcentaje NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (comision_porcentaje >= 0),
  activo              BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(empresa_id, nombre)
);

ALTER TABLE public.formas_pago ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "formas_pago_all" ON public.formas_pago;
CREATE POLICY "formas_pago_all" ON public.formas_pago
  USING (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

-- ── Extender seed_maestros_default (misma función, se agrega el bloque de formas_pago al
-- final; se preserva 1:1 el cuerpo real vigente en producción — unidades_medida con
-- magnitud/factor_base de la 188, condiciones_pago sin cambios — para no regresar esa extensión) ──
CREATE OR REPLACE FUNCTION public.seed_maestros_default(p_empresa_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id()
     AND (SELECT empresa_id FROM public.profiles WHERE id = auth.uid()) IS NOT NULL THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;

  INSERT INTO public.unidades_medida (empresa_id, codigo, descripcion, magnitud, factor_base) VALUES
    (p_empresa_id,'UN','Unidad','cantidad',1),(p_empresa_id,'PAR','Par','cantidad',2),(p_empresa_id,'DOC','Docena','cantidad',12),
    (p_empresa_id,'MG','Miligramo','masa',0.001),(p_empresa_id,'GR','Gramo','masa',1),(p_empresa_id,'KG','Kilogramo','masa',1000),(p_empresa_id,'TN','Tonelada','masa',1000000),
    (p_empresa_id,'ML','Mililitro','volumen',1),(p_empresa_id,'LT','Litro','volumen',1000),
    (p_empresa_id,'MM','Milímetro','longitud',0.1),(p_empresa_id,'CM','Centímetro','longitud',1),(p_empresa_id,'MT','Metro','longitud',100),(p_empresa_id,'KM','Kilómetro','longitud',100000),
    (p_empresa_id,'CJ','Caja',NULL,NULL),(p_empresa_id,'PQ','Paquete',NULL,NULL)
  ON CONFLICT (empresa_id, codigo) DO NOTHING;

  INSERT INTO public.condiciones_pago (empresa_id, nombre, dias_credito, descuento_pct) VALUES
    (p_empresa_id,'Contado',0,0),(p_empresa_id,'15 días',15,0),(p_empresa_id,'30 días',30,0),(p_empresa_id,'60 días',60,0),(p_empresa_id,'90 días',90,0)
  ON CONFLICT (empresa_id, nombre) DO NOTHING;

  -- mig.214 — solo las 4 formas de pago con uso real verificado en producción (Efectivo,
  -- Transferencia, Tarjeta Débito, Tarjeta Crédito). Sin cuenta bancaria asignada por
  -- defecto: cada empresa la vincula desde ConfiguracionSection. "Cheque" no se siembra acá
  -- a propósito — tiene su propio circuito de negocio (tabla cheques), no es un medio de
  -- pago genérico de mostrador.
  INSERT INTO public.formas_pago (empresa_id, nombre, tipo_instrumento) VALUES
    (p_empresa_id,'Efectivo','efectivo'),
    (p_empresa_id,'Transferencia','transferencia'),
    (p_empresa_id,'Tarjeta Débito','tarjeta_debito'),
    (p_empresa_id,'Tarjeta Crédito','tarjeta_credito')
  ON CONFLICT (empresa_id, nombre) DO NOTHING;
END;
$function$;

-- ── Backfill para las 3 empresas existentes, preservando el mapeo a cuenta bancaria que
-- ya estaba cargado en metodo_pago_cuenta_bancaria (verificado: solo Nalux tenía Transferencia
-- y Tarjeta mapeadas, ambas a la misma cuenta) ──
DO $$
DECLARE
  v_empresa RECORD;
  v_cuenta_transferencia UUID;
  v_cuenta_tarjeta UUID;
BEGIN
  FOR v_empresa IN SELECT id FROM public.empresas LOOP
    PERFORM public.seed_maestros_default(v_empresa.id);

    SELECT cuenta_bancaria_id INTO v_cuenta_transferencia
      FROM public.metodo_pago_cuenta_bancaria
     WHERE empresa_id = v_empresa.id AND metodo_pago = 'Transferencia' AND activo = true;
    SELECT cuenta_bancaria_id INTO v_cuenta_tarjeta
      FROM public.metodo_pago_cuenta_bancaria
     WHERE empresa_id = v_empresa.id AND metodo_pago = 'Tarjeta' AND activo = true;

    IF v_cuenta_transferencia IS NOT NULL THEN
      UPDATE public.formas_pago SET cuenta_bancaria_id = v_cuenta_transferencia
       WHERE empresa_id = v_empresa.id AND nombre = 'Transferencia';
    END IF;
    IF v_cuenta_tarjeta IS NOT NULL THEN
      UPDATE public.formas_pago SET cuenta_bancaria_id = v_cuenta_tarjeta
       WHERE empresa_id = v_empresa.id AND nombre IN ('Tarjeta Débito', 'Tarjeta Crédito');
    END IF;
  END LOOP;
END $$;

-- ROLLBACK (comentado): revertir seed_maestros_default a la versión previa (sin el bloque
-- formas_pago), DROP TABLE public.formas_pago CASCADE.
