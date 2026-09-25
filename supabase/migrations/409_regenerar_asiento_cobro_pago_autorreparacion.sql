-- 409 — «Regenerar asiento» de un cobro / un pago: reconectar el que ya existe en vez de duplicarlo
--
-- Auditoría 24/09/2026, hallazgo CON-2. `regenerar_asiento_venta` y `regenerar_asiento_compra` ya tienen la
-- autorreparación de la mig. 303 (si el asiento del documento existe pero el vínculo `asiento_id` nunca se guardó,
-- lo reconectan en vez de crear otro). `regenerar_asiento_cxc` (cobros) y `regenerar_asiento_cxp` (pagos a
-- proveedores) NO la tenían: solo miraban `asiento_id`. Un cobro o pago cuyo asiento existía pero sin vínculo
-- (los asientos históricos anteriores a la columna, o una llamada que se cortó antes de guardar el vínculo) aparecía
-- como «sin asiento» y, al pulsar «Regenerar», se duplicaba: son los 7 pares de la auditoría (AS-131/182, 141/183,
-- 159/185 en cobros por $66.332; AS-132/188, 142/189, 160/190, 164/191 en pagos por $48.415).
--
-- Arreglo, con el mismo criterio que la mig. 303:
--   - Antes de crear nada, si ya hay un asiento confirmado de ese cobro/pago (origen `cobro_cliente` /
--     `pago_proveedor`, origen_id = el movimiento), se guarda el vínculo y se devuelve ese asiento
--     (`reconectado: true`). El chequeo se serializa con un lock advisory por movimiento, para que dos clics
--     simultáneos no creen dos asientos.
--   - Un cobro CANCELADO ya no se puede regenerar: `cancelar_cobro_cliente` lo deja en estado 'cancelado' y su
--     ingreso está revertido; darle un asiento de «cobro recibido» sumaría plata que nunca entró a Caja.
--     (Hoy hay 1 cobro cancelado sin asiento, y el botón «Regenerar» le aparecía.)
--
-- Método: se lee la definición vigente con `pg_get_functiondef` y se inserta el bloque justo antes de la línea
-- que chequea el período cerrado (queda entre marcadores `mig.409`); todo lo demás de cada función queda igual
-- (mismos argumentos, SECURITY DEFINER, search_path y permisos). Idempotente: si el bloque ya está, no se toca.
-- No cambia nada en los asientos ya duplicados: reversarlos es una decisión aparte (ver PENDIENTES_LUCIANO_AUDITORIA.md).

DO $mig$
DECLARE
  r        record;
  v_def    text;
  v_bloque text;
  v_ancla  constant text := 'SELECT fecha_en_periodo_cerrado(v_empresa_id, v_fecha_dia) INTO v_cerrado;';
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('public.regenerar_asiento_cxc(uuid, uuid)'::regprocedure, 'regenerar_asiento_cxc', 'cobro_cliente',  'cuenta_corriente_movimientos',
       $g$IF EXISTS (SELECT 1 FROM public.cuenta_corriente_movimientos WHERE id = p_movimiento_id AND estado = 'cancelado') THEN
    RAISE EXCEPTION 'Este cobro está cancelado — no corresponde generar su asiento';
  END IF;
  $g$),
      ('public.regenerar_asiento_cxp(uuid, uuid)'::regprocedure, 'regenerar_asiento_cxp', 'pago_proveedor', 'cuenta_corriente_proveedores',
       '')
    ) AS t(fn, nombre, origen, tabla, guardia)
  LOOP
    v_def := pg_get_functiondef(r.fn);

    IF position('mig.409' IN v_def) > 0 THEN
      CONTINUE;  -- ya está aplicada
    END IF;

    IF (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla) <> 1 THEN
      RAISE EXCEPTION 'mig.409: la línea ancla no está (o está repetida) en %', r.nombre;
    END IF;

    v_bloque := replace(replace(replace(replace(
      $blk$-- >>> mig.409 autorreparación (mismo criterio que mig.303 en venta y compra)
  @GUARDIA@PERFORM pg_advisory_xact_lock(hashtextextended('@FUNC@|' || p_movimiento_id::text, 0));
  SELECT id INTO v_asiento_id
    FROM public.asientos_contables
   WHERE empresa_id = v_empresa_id AND origen = '@ORIGEN@' AND origen_id = p_movimiento_id AND estado = 'confirmado'
   ORDER BY created_at
   LIMIT 1;
  IF v_asiento_id IS NOT NULL THEN
    UPDATE public.@TABLA@ SET asiento_id = v_asiento_id WHERE id = p_movimiento_id;
    RETURN jsonb_build_object('ok', true, 'asiento_id', v_asiento_id, 'reconectado', true);
  END IF;
  -- <<< mig.409
  $blk$,
      '@GUARDIA@', r.guardia), '@FUNC@', r.nombre), '@ORIGEN@', r.origen), '@TABLA@', r.tabla);

    EXECUTE replace(v_def, v_ancla, v_bloque || v_ancla);
  END LOOP;
END
$mig$;
