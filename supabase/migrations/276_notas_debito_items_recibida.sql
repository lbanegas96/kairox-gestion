-- migration 276 — ND recibida (Proveedor): ítems + IVA discriminado
--
-- CONTEXTO: espejo de la mejora ya hecha en ND emitida a Cliente (mig.268/269,
-- hoy). Análisis pedido por Luciano ("¿no deberíamos aplicar las mejoras de
-- Ventas en Compras?") — SAP B1 trata Compras como espejo de Ventas en
-- sentido inverso. Hallazgo real que motiva esto, no solo simetría estética:
-- ReporteLibroIVACompras.jsx solo lee `compras` — nunca ve una ND recibida,
-- así que el crédito fiscal de IVA reportado nunca se ajusta por estos
-- documentos. Para que el reporte pueda sumarlos algún día, primero
-- necesitan tener neto/IVA — hoy `notas_debito` es monto plano sin desglose.
--
-- Alcance: SOLO la rama 'recibida' (proveedor). La rama 'emitida' (cliente)
-- de esta misma tabla ya quedó en desuso desde hoy — NuevaNDModal.jsx usa
-- crear_nota_debito_cliente sobre `comprobantes`, no esta tabla. No se toca
-- ni se migra el histórico 'emitida'.
--
-- No se lleva a `comprobantes` como se hizo con la ND de cliente — sería
-- arquitectónicamente incorrecto: `comprobantes` es la tabla de documentos
-- que NOSOTROS declaramos ante AFIP (cae_estado, tipo_comprobante_afip). Una
-- ND recibida de un proveedor es una NOTA QUE EL PROVEEDOR nos emite — su
-- responsabilidad fiscal, no la nuestra (mismo criterio ya documentado en
-- sap-reference y confirmado por NuevaNCProveedorModal.jsx, que tampoco toca
-- AFIP). Se queda en `notas_debito`, que ya es su hogar estructural
-- correcto — solo gana ítems, igual que comprobante_items ganó descripcion
-- para ítems de servicio libre (mig.256).

ALTER TABLE public.notas_debito
  ADD COLUMN IF NOT EXISTS neto_gravado     numeric(12,2),
  ADD COLUMN IF NOT EXISTS iva_discriminado numeric(12,2);

CREATE TABLE IF NOT EXISTS public.notas_debito_items (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  nota_debito_id  uuid          NOT NULL REFERENCES public.notas_debito(id) ON DELETE CASCADE,
  empresa_id      uuid          NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  producto_id     uuid          REFERENCES public.productos(id) ON DELETE SET NULL,
  descripcion     text,
  cantidad        numeric(12,3) NOT NULL,
  precio_unitario numeric(12,2) NOT NULL,
  alicuota_iva    text          NOT NULL DEFAULT '21',
  subtotal        numeric(12,2) NOT NULL,
  created_at      timestamptz   NOT NULL DEFAULT now()
);

ALTER TABLE public.notas_debito_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notas_debito_items_all" ON public.notas_debito_items;
CREATE POLICY "notas_debito_items_all" ON public.notas_debito_items
  USING       (empresa_id = get_my_empresa_id())
  WITH CHECK  (empresa_id = get_my_empresa_id());

CREATE INDEX IF NOT EXISTS idx_notas_debito_items_nd ON public.notas_debito_items(nota_debito_id);

-- ── RPC dedicada crear_nota_debito_proveedor ─────────────────────────────────
-- Nueva función (no se toca crear_nota_debito, mig.014/073/133 — la rama
-- 'emitida' que sigue usando podría tener otros callers/reportes históricos
-- que no vale la pena arriesgar). Mismo criterio precio-final-IVA-incluido
-- (FACTOR_IVA) que toda la app, mismo patrón atómico (INSERT de CC en la
-- misma transacción) que ya trajo mig.133 a la rama 'recibida'.
CREATE OR REPLACE FUNCTION public.crear_nota_debito_proveedor(
  p_empresa_id   uuid,
  p_user_id      uuid,
  p_proveedor_id uuid,
  p_concepto     text,
  p_items        jsonb,
  p_compra_id    uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_nd_id UUID; v_numero_nd TEXT; v_cc_id UUID;
  v_item JSONB; v_subtotal_neto NUMERIC := 0; v_total_iva NUMERIC := 0; v_total NUMERIC;
  v_cantidad NUMERIC; v_precio NUMERIC; v_alicuota NUMERIC; v_bruto_item NUMERIC;
  v_neto_item NUMERIC; v_factor NUMERIC;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('compras') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo compras';
  END IF;
  IF p_proveedor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.proveedores WHERE id = p_proveedor_id AND empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'proveedor_id no pertenece a la empresa';
  END IF;
  IF p_compra_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.compras WHERE id = p_compra_id AND empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'compra_id no pertenece a la empresa';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La ND debe tener al menos un ítem';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_cantidad := (v_item->>'cantidad')::NUMERIC;
    v_precio   := (v_item->>'precio_unitario')::NUMERIC;
    v_alicuota := COALESCE((v_item->>'alicuota_iva')::NUMERIC, 21);
    v_bruto_item := v_cantidad * v_precio;
    v_factor := CASE v_alicuota WHEN 21 THEN 1.21 WHEN 10.5 THEN 1.105 ELSE 1 END;
    v_neto_item := v_bruto_item / v_factor;
    v_subtotal_neto := v_subtotal_neto + v_neto_item;
    v_total_iva      := v_total_iva + (v_bruto_item - v_neto_item);
  END LOOP;
  v_total := v_subtotal_neto + v_total_iva;
  IF v_total <= 0 THEN RAISE EXCEPTION 'El total de la ND debe ser mayor a cero'; END IF;

  v_numero_nd := public.obtener_proximo_numero(p_empresa_id, 'nota_debito');

  INSERT INTO public.notas_debito (
    empresa_id, user_id, numero_nd, tipo, compra_id, proveedor_id,
    concepto, monto, moneda, neto_gravado, iva_discriminado
  ) VALUES (
    p_empresa_id, p_user_id, v_numero_nd, 'recibida', p_compra_id, p_proveedor_id,
    p_concepto, v_total, 'ARS', v_subtotal_neto, v_total_iva
  ) RETURNING id INTO v_nd_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_cantidad := (v_item->>'cantidad')::NUMERIC;
    v_precio   := (v_item->>'precio_unitario')::NUMERIC;
    INSERT INTO public.notas_debito_items (
      nota_debito_id, empresa_id, producto_id, descripcion, cantidad, precio_unitario, subtotal, alicuota_iva
    ) VALUES (
      v_nd_id, p_empresa_id, NULLIF(v_item->>'producto_id', '')::UUID, NULLIF(v_item->>'descripcion', ''),
      v_cantidad, v_precio, v_cantidad * v_precio, COALESCE(v_item->>'alicuota_iva', '21')
    );
  END LOOP;

  INSERT INTO public.cuenta_corriente_proveedores (
    empresa_id, user_id, proveedor_id, tipo, monto, descripcion,
    referencia_id, referencia_tipo, fecha
  ) VALUES (
    p_empresa_id, p_user_id, p_proveedor_id, 'nota_debito', v_total,
    'ND ' || v_numero_nd || ' recibida — ' || p_concepto,
    v_nd_id, 'nd_proveedor', now()
  ) RETURNING id INTO v_cc_id;

  UPDATE public.notas_debito SET cc_movimiento_id = v_cc_id WHERE id = v_nd_id;

  RETURN jsonb_build_object('nota_debito_id', v_nd_id, 'numero_nd', v_numero_nd, 'total', v_total);
END;
$function$;

REVOKE ALL ON FUNCTION public.crear_nota_debito_proveedor(uuid, uuid, uuid, text, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_nota_debito_proveedor(uuid, uuid, uuid, text, jsonb, uuid) TO authenticated;

-- ROLLBACK (comentado):
-- DROP FUNCTION IF EXISTS public.crear_nota_debito_proveedor(uuid, uuid, uuid, text, jsonb, uuid);
-- DROP TABLE IF EXISTS public.notas_debito_items;
-- ALTER TABLE public.notas_debito DROP COLUMN IF EXISTS neto_gravado;
-- ALTER TABLE public.notas_debito DROP COLUMN IF EXISTS iva_discriminado;
