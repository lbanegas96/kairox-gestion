-- 408 — Asientos automáticos y manuales: cuentas de la propia empresa, permiso por tipo e idempotencia
--
-- Auditoría 24/09/2026, hallazgo SEG-14 (nuevo). La mig. 314 cerró la escritura directa sobre
-- `asientos_contables`/`asientos_items`: hoy se escribe solo por RPC. Pero `crear_asiento_automatico`
-- (que crea el asiento ya CONFIRMADO) solo validaba que `p_empresa_id` fuera la del usuario:
--   1) no chequeaba que las cuentas de las líneas (`cuenta_id`) fueran de esa empresa. Con el UUID de una
--      cuenta de otra empresa se podían asentar líneas contra ella: el trigger `trg_asiento_item_saldo`
--      recalculaba el `saldo_actual` de la cuenta AJENA incluyendo esa línea (escritura entre empresas);
--   2) no chequeaba ningún permiso: cualquier usuario con sesión (aunque no tuviera ni un módulo) podía
--      asentar cualquier tipo de asiento confirmado (p. ej. mover plata entre cuentas de Caja y Ventas);
--   3) no era idempotente: un reintento o dos caminos de código para el mismo documento duplicaban el
--      asiento (así nacieron los duplicados de compras que la mig. 397 tuvo que reversar).
-- `crear_asiento_manual` (borrador, exige el módulo `configuracion`) tenía el mismo hueco de cuentas.
--
-- Arreglo (el resto de cada cuerpo queda idéntico; los agregados están entre marcadores mig.408):
--   A) Las cuentas de todas las líneas deben existir y pertenecer a la empresa del asiento (ambas funciones).
--   B) `crear_asiento_automatico`: el usuario necesita el permiso de módulo que corresponde al TIPO de
--      asiento (`modulos_para_origen_asiento`, ver el mapa). Un tipo desconocido se acepta con cualquiera de
--      los módulos operativos: solo se rechaza a quien no tiene ninguno. `service_role` no cambia.
--   C) `crear_asiento_automatico`: para los tipos que se asientan UNA sola vez por documento (venta, compra,
--      NC/ND de cliente y de proveedor, devoluciones, recuentos, revalorizaciones, movimiento de caja), si ya
--      existe un asiento confirmado de ese documento, devuelve ese (con `existente: true`) en vez de crear otro.
--      Serializado con un lock advisory por documento, para que dos llamadas simultáneas no dupliquen.
--      NO aplica a `ajuste_stock` (su origen_id es el producto y se repite legítimamente) ni a cheques ni a
--      las cancelaciones.
--   D) Índice por (empresa, tipo, documento): sirve a la búsqueda de idempotencia de C) y a las que ya hace el
--      frontend (`asientoPorOrigen`) y las funciones `regenerar_asiento_*`; la tabla no tenía ninguno.
-- Ninguna otra función de la base llama a estas dos (solo el frontend), así que no hay efectos internos.
-- (`service_role` no puede ejecutar estas RPC —la ACL es solo postgres + authenticated—; la rama de service_role
-- del cuerpo queda como estaba y no se toca.)

CREATE INDEX IF NOT EXISTS idx_asientos_origen
  ON public.asientos_contables (empresa_id, origen, origen_id)
  WHERE origen_id IS NOT NULL;

-- Mapa tipo de asiento → módulos que pueden registrarlo (según el módulo desde el que se genera).
CREATE OR REPLACE FUNCTION public.modulos_para_origen_asiento(p_origen text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_origen IN ('venta', 'nota_credito', 'nota_debito', 'cancelacion_venta')            THEN ARRAY['ventas']
    WHEN p_origen IN ('cobro_cliente', 'cancelacion_cobro_cliente')                           THEN ARRAY['ventas', 'cuentacorriente', 'caja']
    WHEN p_origen IN ('devolucion_cliente', 'devolucion_proveedor')                           THEN ARRAY['ventas', 'compras']
    WHEN p_origen = 'pago_proveedor'                                                          THEN ARRAY['compras', 'caja', 'bancos', 'cheques']
    WHEN p_origen IN ('compra', 'cancelacion_compra', 'anulacion_compra', 'recepcion_oc')
      OR p_origen LIKE '%\_proveedor' ESCAPE '\'                                              THEN ARRAY['compras']
    WHEN p_origen IN ('ajuste_stock', 'recuento_inventario', 'revalorizacion_inventario')     THEN ARRAY['productos']
    WHEN p_origen = 'movimiento_caja'                                                         THEN ARRAY['caja']
    ELSE ARRAY['ventas', 'compras', 'productos', 'caja', 'bancos', 'cheques', 'cuentacorriente', 'configuracion']
  END
$$;

REVOKE ALL ON FUNCTION public.modulos_para_origen_asiento(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.crear_asiento_automatico(
  p_empresa_id uuid,
  p_user_id uuid,
  p_fecha date,
  p_descripcion text,
  p_origen text,
  p_origen_id uuid,
  p_centro_costo_id uuid,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_asiento_id uuid;
  v_numero text;
  v_total_debe numeric := 0;
  v_total_haber numeric := 0;
  v_cerrado boolean;
  -- >>> mig.408
  v_existente record;
  -- <<< mig.408
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
      RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
    END IF;
    -- >>> mig.408 B) permiso de módulo según el tipo de asiento
    IF NOT EXISTS (
      SELECT 1 FROM unnest(public.modulos_para_origen_asiento(p_origen)) m WHERE has_module_permission(m)
    ) THEN
      RAISE EXCEPTION 'No autorizado: sin permiso para registrar asientos de tipo %', COALESCE(p_origen, '(sin tipo)');
    END IF;
    -- <<< mig.408
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'El asiento debe tener al menos una línea';
  END IF;

  -- >>> mig.408 A) las cuentas deben existir y ser de la empresa del asiento
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) x
    LEFT JOIN public.plan_cuentas pc ON pc.id = (x->>'cuenta_id')::uuid AND pc.empresa_id = p_empresa_id
    WHERE pc.id IS NULL
  ) THEN
    RAISE EXCEPTION 'El asiento usa una cuenta que no existe o no pertenece a esta empresa';
  END IF;
  -- <<< mig.408

  -- >>> mig.408 C) un solo asiento por documento en los tipos que se asientan una vez
  IF p_origen_id IS NOT NULL
     AND p_origen IN ('venta', 'compra', 'nota_credito', 'nota_debito', 'nota_credito_proveedor', 'nota_debito_proveedor',
                      'devolucion_cliente', 'devolucion_proveedor', 'recuento_inventario', 'revalorizacion_inventario',
                      'movimiento_caja') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_empresa_id::text || '|' || p_origen || '|' || p_origen_id::text, 0));
    SELECT a.id, a.numero INTO v_existente
    FROM public.asientos_contables a
    WHERE a.empresa_id = p_empresa_id AND a.origen = p_origen AND a.origen_id = p_origen_id AND a.estado = 'confirmado'
    ORDER BY a.created_at
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('id', v_existente.id, 'numero', v_existente.numero, 'estado', 'confirmado', 'existente', true);
    END IF;
  END IF;
  -- <<< mig.408

  SELECT COALESCE(SUM((x->>'debe')::numeric), 0), COALESCE(SUM((x->>'haber')::numeric), 0)
    INTO v_total_debe, v_total_haber
    FROM jsonb_array_elements(p_items) x;

  IF round(v_total_debe, 2) IS DISTINCT FROM round(v_total_haber, 2) THEN
    RAISE EXCEPTION 'El asiento no está balanceado: debe % vs haber %', v_total_debe, v_total_haber;
  END IF;

  SELECT fecha_en_periodo_cerrado(p_empresa_id, p_fecha) INTO v_cerrado;
  IF COALESCE(v_cerrado, false) THEN
    RAISE EXCEPTION 'Período cerrado: la fecha % pertenece a un período contable cerrado', p_fecha;
  END IF;

  v_numero := next_numero_asiento(p_empresa_id);

  INSERT INTO public.asientos_contables
    (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id, centro_costo_id)
  VALUES
    (p_empresa_id, p_user_id, v_numero, p_fecha, p_descripcion, 'confirmado', v_total_debe, v_total_haber, p_origen, p_origen_id, p_centro_costo_id)
  RETURNING id INTO v_asiento_id;

  INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber)
  SELECT v_asiento_id, p_empresa_id, (x->>'cuenta_id')::uuid, x->>'descripcion',
         COALESCE((x->>'debe')::numeric, 0), COALESCE((x->>'haber')::numeric, 0)
    FROM jsonb_array_elements(p_items) x;

  RETURN jsonb_build_object('id', v_asiento_id, 'numero', v_numero, 'estado', 'confirmado');
END;
$function$;

CREATE OR REPLACE FUNCTION public.crear_asiento_manual(
  p_empresa_id uuid,
  p_user_id uuid,
  p_fecha date,
  p_descripcion text,
  p_centro_costo_id uuid,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_asiento_id uuid;
  v_numero text;
  v_total_debe numeric := 0;
  v_total_haber numeric := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
      RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
    END IF;
    IF NOT has_module_permission('configuracion') THEN
      RAISE EXCEPTION 'No autorizado: sin permiso de módulo configuración';
    END IF;
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'El asiento debe tener al menos una línea';
  END IF;

  -- >>> mig.408 A) las cuentas deben existir y ser de la empresa del asiento
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) x
    LEFT JOIN public.plan_cuentas pc ON pc.id = (x->>'cuenta_id')::uuid AND pc.empresa_id = p_empresa_id
    WHERE pc.id IS NULL
  ) THEN
    RAISE EXCEPTION 'El asiento usa una cuenta que no existe o no pertenece a esta empresa';
  END IF;
  -- <<< mig.408

  SELECT COALESCE(SUM((x->>'debe')::numeric), 0), COALESCE(SUM((x->>'haber')::numeric), 0)
    INTO v_total_debe, v_total_haber
    FROM jsonb_array_elements(p_items) x;

  v_numero := next_numero_asiento(p_empresa_id);

  INSERT INTO public.asientos_contables
    (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, centro_costo_id)
  VALUES
    (p_empresa_id, p_user_id, v_numero, p_fecha, p_descripcion, 'borrador', v_total_debe, v_total_haber, p_centro_costo_id)
  RETURNING id INTO v_asiento_id;

  INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber)
  SELECT v_asiento_id, p_empresa_id, (x->>'cuenta_id')::uuid, x->>'descripcion',
         COALESCE((x->>'debe')::numeric, 0), COALESCE((x->>'haber')::numeric, 0)
    FROM jsonb_array_elements(p_items) x;

  RETURN jsonb_build_object('id', v_asiento_id, 'numero', v_numero, 'estado', 'borrador');
END;
$function$;
