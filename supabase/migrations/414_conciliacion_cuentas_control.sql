-- 414 — Reporte «Conciliación de cuentas de control» (mayor vs subdiarios + controles de integridad)
--
-- Auditoría 24/09/2026, hallazgo CON-5. Las cuentas de control del mayor (Cuentas a Cobrar, Cuentas a Pagar,
-- Mercaderías, Caja y Bancos, IVA) no concilian con sus subdiarios y NADA lo detectaba: las diferencias salían recién
-- cuando alguien armaba las consultas a mano. Esta función devuelve, para la empresa del usuario, todo lo que hace
-- falta para revisarlo en cada cierre:
--
--   1) `cuentas`: por cada cuenta de control, el saldo del mayor (suma de sus asientos confirmados), el saldo del
--      subdiario, la diferencia y si concilia (diferencia menor a $ 1). Los pasivos se muestran en positivo
--      (lo que se debe). Cada línea trae escrito cómo se calcula el subdiario.
--   2) `controles`: chequeos de integridad, cada uno con cuántos casos hay, el importe y hasta 25 casos de detalle:
--        · movimientos de cuenta corriente sin cliente,
--        · clientes cuyo saldo de ficha no coincide con sus movimientos,
--        · productos con stock y sin costo (valen 0 en el inventario),
--        · cuentas con el saldo mostrado distinto de la suma de sus asientos,
--        · asientos confirmados desbalanceados,
--        · ventas, notas y compras vigentes sin asiento contable,
--        · documentos con más de un asiento vigente del mismo tipo (duplicados no reversados).
--
-- Es de solo lectura (STABLE) y no cambia nada. Exige sesión con empresa y el permiso de módulo `reportes` (los
-- administradores lo tienen). Corrida contra los datos reales de Nalux reproduce las cifras de la auditoría: 17 notas
-- de crédito sin asiento por $ 1.133.194,52, 4 compras sin asiento por $ 188.935 y 8 asientos duplicados.

CREATE OR REPLACE FUNCTION public.conciliacion_cuentas_control()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa   uuid  := get_my_empresa_id();
  v_cuentas   jsonb := '[]'::jsonb;
  v_controles jsonb := '[]'::jsonb;
  v_fila      record;
  v_nombre    text;
  v_mayor     numeric;
  v_casos     int;
  v_monto     numeric;
  v_detalle   jsonb;
BEGIN
  IF v_empresa IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  IF NOT has_module_permission('reportes') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo reportes';
  END IF;

  -- ───────────────────────────────────────────────────────────────────────
  -- Parte 1 — cuentas de control: mayor vs subdiario
  -- ───────────────────────────────────────────────────────────────────────
  FOR v_fila IN
    SELECT * FROM (VALUES
      ('clientes', 'Cuentas a Cobrar — clientes', '1.1.2', 1,
       'Suma de los saldos de la ficha de cada cliente (Cuenta Corriente).',
       (SELECT COALESCE(SUM(saldo_actual), 0) FROM public.clientes WHERE empresa_id = v_empresa)),
      ('proveedores', 'Cuentas a Pagar — proveedores', '2.1.1', -1,
       'Cuenta Corriente de proveedores: compras y notas de débito menos pagos y notas de crédito, de todos los proveedores.',
       (SELECT COALESCE(SUM(CASE WHEN tipo IN ('compra', 'nota_debito') THEN monto
                                 WHEN tipo IN ('pago', 'nota_credito') THEN -monto
                                 ELSE 0 END), 0)
          FROM public.cuenta_corriente_proveedores WHERE empresa_id = v_empresa)),
      ('inventario', 'Mercaderías / Inventario', '1.1.3', 1,
       'Stock actual × costo de compra de cada producto activo e inventariable (igual que el reporte Valorización de Inventario).',
       (SELECT COALESCE(SUM(stock_actual * COALESCE(costo_compra, 0)), 0)
          FROM public.productos WHERE empresa_id = v_empresa AND activo AND es_inventariable)),
      ('caja_bancos', 'Caja y Bancos', '1.1.1', 1,
       'Ingresos menos egresos de todos los movimientos de caja, más ingresos menos egresos de los movimientos de las cuentas bancarias activas.',
       (SELECT COALESCE(SUM(CASE WHEN tipo = 'ingreso' THEN monto ELSE -monto END), 0)
          FROM public.movimientos_caja WHERE empresa_id = v_empresa)
       + (SELECT COALESCE(SUM(CASE WHEN mb.tipo = 'ingreso' THEN mb.monto ELSE -mb.monto END), 0)
            FROM public.movimientos_bancarios mb
            JOIN public.cuentas_bancarias cb ON cb.id = mb.cuenta_bancaria_id
           WHERE mb.empresa_id = v_empresa AND cb.activo)),
      ('iva_debito', 'IVA Débito Fiscal', '2.1.3', -1,
       'IVA discriminado de las ventas y las notas de débito, menos el de las notas de crédito, sin contar los comprobantes cancelados.',
       (SELECT COALESCE(SUM(CASE WHEN tipo = 'nota_credito' THEN -iva_discriminado ELSE iva_discriminado END), 0)
          FROM public.comprobantes
         WHERE empresa_id = v_empresa AND estado_pago <> 'cancelada' AND tipo IN ('venta', 'nota_debito', 'nota_credito'))),
      ('iva_credito', 'IVA Crédito Fiscal', '1.1.4', 1,
       'IVA de las compras del Libro (sin las anuladas) y de las notas de débito de proveedor, menos el de las notas de crédito de proveedor.',
       (SELECT COALESCE(SUM(iva_discriminado), 0) FROM public.compras
         WHERE empresa_id = v_empresa AND en_libro_iva AND estado_pago <> 'anulada')
       + (SELECT COALESCE(SUM(iva_discriminado), 0) FROM public.notas_debito
           WHERE empresa_id = v_empresa AND tipo = 'recibida' AND estado = 'activa')
       - (SELECT COALESCE(SUM(iva_discriminado), 0) FROM public.notas_credito_proveedor
           WHERE empresa_id = v_empresa AND estado = 'activa'))
    ) AS t(clave, titulo, codigo, signo, subdiario_desc, subdiario)
  LOOP
    SELECT pc.nombre,
           COALESCE((SELECT SUM(ai.debe - ai.haber)
                       FROM public.asientos_items ai
                       JOIN public.asientos_contables a ON a.id = ai.asiento_id
                      WHERE ai.cuenta_id = pc.id AND a.estado = 'confirmado'), 0) * v_fila.signo
      INTO v_nombre, v_mayor
      FROM public.plan_cuentas pc
     WHERE pc.empresa_id = v_empresa AND pc.codigo = v_fila.codigo;

    v_cuentas := v_cuentas || jsonb_build_array(jsonb_build_object(
      'clave',          v_fila.clave,
      'titulo',         v_fila.titulo,
      'cuenta_codigo',  v_fila.codigo,
      'cuenta_nombre',  v_nombre,
      'cuenta_existe',  v_nombre IS NOT NULL,
      'mayor',          round(COALESCE(v_mayor, 0), 2),
      'subdiario',      round(v_fila.subdiario, 2),
      'subdiario_desc', v_fila.subdiario_desc,
      'diferencia',     round(COALESCE(v_mayor, 0) - v_fila.subdiario, 2),
      'conciliado',     abs(COALESCE(v_mayor, 0) - v_fila.subdiario) < 1
    ));
  END LOOP;

  -- ───────────────────────────────────────────────────────────────────────
  -- Parte 2 — controles de integridad
  -- ───────────────────────────────────────────────────────────────────────

  -- A) Movimientos de cuenta corriente confirmados que no pertenecen a ningún cliente.
  SELECT count(*), COALESCE(SUM(x.firmado), 0),
         COALESCE(jsonb_agg(jsonb_build_object('fecha', x.fecha, 'movimiento', x.tipo, 'monto', x.monto, 'descripcion', x.descripcion)
                            ORDER BY x.rn) FILTER (WHERE x.rn <= 25), '[]'::jsonb)
    INTO v_casos, v_monto, v_detalle
    FROM (
      SELECT m.fecha::date AS fecha, m.tipo, m.monto, m.descripcion,
             CASE WHEN m.tipo = 'DEBE' THEN m.monto ELSE -m.monto END AS firmado,
             row_number() OVER (ORDER BY m.fecha DESC) AS rn
        FROM public.cuenta_corriente_movimientos m
       WHERE m.empresa_id = v_empresa AND m.estado = 'confirmado' AND m.cliente_id IS NULL
    ) x;
  v_controles := v_controles || jsonb_build_array(jsonb_build_object(
    'clave', 'cc_sin_cliente',
    'titulo', 'Movimientos de cuenta corriente sin cliente',
    'ayuda', 'Cobros, notas o ajustes confirmados que no pertenecen a ningún cliente: su importe no figura en el saldo de ninguna ficha.',
    'casos', v_casos, 'monto', round(v_monto, 2), 'estado', CASE WHEN v_casos = 0 THEN 'ok' ELSE 'revisar' END,
    'detalle', v_detalle));

  -- B) Clientes cuyo saldo de ficha no coincide con la suma de sus movimientos.
  SELECT count(*), COALESCE(SUM(x.dif), 0),
         COALESCE(jsonb_agg(jsonb_build_object('cliente', x.nombre, 'saldo_ficha', x.ficha, 'suma_movimientos', x.movimientos, 'diferencia', x.dif)
                            ORDER BY x.rn) FILTER (WHERE x.rn <= 25), '[]'::jsonb)
    INTO v_casos, v_monto, v_detalle
    FROM (
      SELECT c.nombre, c.saldo_actual AS ficha, COALESCE(m.saldo, 0) AS movimientos,
             c.saldo_actual - COALESCE(m.saldo, 0) AS dif,
             row_number() OVER (ORDER BY abs(c.saldo_actual - COALESCE(m.saldo, 0)) DESC) AS rn
        FROM public.clientes c
        LEFT JOIN (
          SELECT cliente_id, SUM(CASE WHEN tipo = 'DEBE' THEN monto ELSE -monto END) AS saldo
            FROM public.cuenta_corriente_movimientos
           WHERE empresa_id = v_empresa AND estado = 'confirmado' AND cliente_id IS NOT NULL
           GROUP BY cliente_id
        ) m ON m.cliente_id = c.id
       WHERE c.empresa_id = v_empresa
         AND abs(c.saldo_actual - COALESCE(m.saldo, 0)) >= 0.01
    ) x;
  v_controles := v_controles || jsonb_build_array(jsonb_build_object(
    'clave', 'cc_ficha_vs_movimientos',
    'titulo', 'Saldo de la ficha distinto de los movimientos del cliente',
    'ayuda', 'Clientes cuyo saldo de ficha no coincide con la suma de sus movimientos de cuenta corriente (debe menos haber).',
    'casos', v_casos, 'monto', round(v_monto, 2), 'estado', CASE WHEN v_casos = 0 THEN 'ok' ELSE 'revisar' END,
    'detalle', v_detalle));

  -- C) Productos con stock y sin costo cargado (valen 0 en el inventario).
  SELECT count(*), NULL::numeric,
         COALESCE(jsonb_agg(jsonb_build_object('producto', x.nombre, 'stock', x.stock_actual) ORDER BY x.rn) FILTER (WHERE x.rn <= 25), '[]'::jsonb)
    INTO v_casos, v_monto, v_detalle
    FROM (
      SELECT p.nombre, p.stock_actual, row_number() OVER (ORDER BY abs(p.stock_actual) DESC) AS rn
        FROM public.productos p
       WHERE p.empresa_id = v_empresa AND p.activo AND p.es_inventariable
         AND p.stock_actual <> 0 AND COALESCE(p.costo_compra, 0) = 0
    ) x;
  v_controles := v_controles || jsonb_build_array(jsonb_build_object(
    'clave', 'productos_sin_costo',
    'titulo', 'Productos con stock y sin costo',
    'ayuda', 'Productos activos con stock que no tienen costo de compra cargado: en la valorización valen $ 0 y el inventario queda subvaluado.',
    'casos', v_casos, 'monto', v_monto, 'estado', CASE WHEN v_casos = 0 THEN 'ok' ELSE 'revisar' END,
    'detalle', v_detalle));

  -- D) Cuentas cuyo saldo mostrado no coincide con la suma de sus asientos confirmados.
  SELECT count(*), COALESCE(SUM(x.mostrado - x.saldo_real), 0),
         COALESCE(jsonb_agg(jsonb_build_object('cuenta', x.codigo || ' ' || x.nombre, 'saldo_mostrado', x.mostrado, 'saldo_real', x.saldo_real)
                            ORDER BY x.rn) FILTER (WHERE x.rn <= 25), '[]'::jsonb)
    INTO v_casos, v_monto, v_detalle
    FROM (
      SELECT t.codigo, t.nombre, t.mostrado, t.saldo_real,
             row_number() OVER (ORDER BY abs(t.mostrado - t.saldo_real) DESC) AS rn
        FROM (
          SELECT pc.codigo, pc.nombre, pc.saldo_actual AS mostrado,
                 COALESCE((SELECT SUM(ai.debe - ai.haber)
                             FROM public.asientos_items ai
                             JOIN public.asientos_contables a ON a.id = ai.asiento_id
                            WHERE ai.cuenta_id = pc.id AND a.estado = 'confirmado'), 0) AS saldo_real
            FROM public.plan_cuentas pc
           WHERE pc.empresa_id = v_empresa
        ) t
       WHERE abs(t.mostrado - t.saldo_real) >= 0.01
    ) x;
  v_controles := v_controles || jsonb_build_array(jsonb_build_object(
    'clave', 'cuentas_saldo_desfasado',
    'titulo', 'Cuentas con el saldo desactualizado',
    'ayuda', 'Cuentas del Plan de Cuentas cuyo saldo mostrado no coincide con la suma de sus asientos confirmados.',
    'casos', v_casos, 'monto', round(v_monto, 2), 'estado', CASE WHEN v_casos = 0 THEN 'ok' ELSE 'revisar' END,
    'detalle', v_detalle));

  -- E) Asientos confirmados desbalanceados.
  SELECT count(*), COALESCE(SUM(x.dif), 0),
         COALESCE(jsonb_agg(jsonb_build_object('asiento', x.numero, 'fecha', x.fecha, 'debe', x.debe, 'haber', x.haber)
                            ORDER BY x.rn) FILTER (WHERE x.rn <= 25), '[]'::jsonb)
    INTO v_casos, v_monto, v_detalle
    FROM (
      SELECT a.numero, a.fecha, SUM(ai.debe) AS debe, SUM(ai.haber) AS haber, SUM(ai.debe) - SUM(ai.haber) AS dif,
             row_number() OVER (ORDER BY a.fecha DESC, a.numero DESC) AS rn
        FROM public.asientos_contables a
        JOIN public.asientos_items ai ON ai.asiento_id = a.id
       WHERE a.empresa_id = v_empresa AND a.estado = 'confirmado'
       GROUP BY a.id, a.numero, a.fecha
      HAVING abs(SUM(ai.debe) - SUM(ai.haber)) >= 0.01
    ) x;
  v_controles := v_controles || jsonb_build_array(jsonb_build_object(
    'clave', 'asientos_desbalanceados',
    'titulo', 'Asientos desbalanceados',
    'ayuda', 'Asientos confirmados cuyo debe y haber no son iguales (no debería haber ninguno: el sistema los rechaza al crearlos).',
    'casos', v_casos, 'monto', round(v_monto, 2), 'estado', CASE WHEN v_casos = 0 THEN 'ok' ELSE 'revisar' END,
    'detalle', v_detalle));

  -- F) Ventas, notas y compras vigentes sin asiento contable.
  SELECT count(*), COALESCE(SUM(x.total), 0),
         COALESCE(jsonb_agg(jsonb_build_object('documento', x.documento, 'numero', x.numero, 'fecha', x.fecha, 'total', x.total)
                            ORDER BY x.rn) FILTER (WHERE x.rn <= 25), '[]'::jsonb)
    INTO v_casos, v_monto, v_detalle
    FROM (
      SELECT d.*, row_number() OVER (ORDER BY d.fecha DESC, d.numero) AS rn
        FROM (
          SELECT CASE c.tipo WHEN 'venta' THEN 'Venta' WHEN 'nota_credito' THEN 'Nota de crédito' ELSE 'Nota de débito' END AS documento,
                 c.numero_venta AS numero, c.fecha::date AS fecha, c.total
            FROM public.comprobantes c
           WHERE c.empresa_id = v_empresa AND c.tipo IN ('venta', 'nota_credito', 'nota_debito')
             AND c.estado_pago <> 'cancelada' AND c.asiento_id IS NULL
             AND NOT EXISTS (SELECT 1 FROM public.asientos_contables a
                              WHERE a.empresa_id = v_empresa AND a.origen_id = c.id
                                AND a.origen IN ('venta', 'nota_credito', 'nota_debito') AND a.estado = 'confirmado')
          UNION ALL
          SELECT 'Compra', co.numero_factura, co.fecha::date, co.total
            FROM public.compras co
           WHERE co.empresa_id = v_empresa AND co.estado_pago <> 'anulada' AND co.asiento_id IS NULL
             AND NOT EXISTS (SELECT 1 FROM public.asientos_contables a
                              WHERE a.empresa_id = v_empresa AND a.origen_id = co.id
                                AND a.origen = 'compra' AND a.estado = 'confirmado')
        ) d
    ) x;
  v_controles := v_controles || jsonb_build_array(jsonb_build_object(
    'clave', 'documentos_sin_asiento',
    'titulo', 'Documentos sin asiento contable',
    'ayuda', 'Ventas, notas y compras vigentes que no tienen asiento: no figuran en el mayor, que queda por debajo de lo que dicen los subdiarios.',
    'casos', v_casos, 'monto', round(v_monto, 2), 'estado', CASE WHEN v_casos = 0 THEN 'ok' ELSE 'revisar' END,
    'detalle', v_detalle));

  -- G) Documentos con más de un asiento vigente del mismo tipo (duplicados que nadie reversó).
  SELECT count(*), COALESCE(SUM(x.monto_extra), 0),
         COALESCE(jsonb_agg(jsonb_build_object('tipo', x.origen, 'asientos', x.asientos, 'importe_de_mas', x.monto_extra)
                            ORDER BY x.rn) FILTER (WHERE x.rn <= 25), '[]'::jsonb)
    INTO v_casos, v_monto, v_detalle
    FROM (
      SELECT g.origen, g.asientos, g.monto_extra, row_number() OVER (ORDER BY g.primero DESC) AS rn
        FROM (
          SELECT a.origen, a.origen_id,
                 string_agg(a.numero, ', ' ORDER BY a.created_at, a.numero) AS asientos,
                 SUM(a.total_debe) - (array_agg(a.total_debe ORDER BY a.created_at, a.numero))[1] AS monto_extra,
                 min(a.created_at) AS primero
            FROM public.asientos_contables a
           WHERE a.empresa_id = v_empresa AND a.estado = 'confirmado' AND a.origen_id IS NOT NULL
             AND a.origen IN ('venta', 'compra', 'nota_credito', 'nota_debito', 'nota_credito_proveedor', 'nota_debito_proveedor',
                              'cobro_cliente', 'pago_proveedor', 'devolucion_cliente', 'devolucion_proveedor',
                              'recuento_inventario', 'revalorizacion_inventario', 'movimiento_caja')
             AND NOT EXISTS (SELECT 1 FROM public.asientos_contables r
                              WHERE r.empresa_id = v_empresa AND r.origen_id = a.id
                                AND r.origen LIKE 'reversa\_asiento%' ESCAPE '\' AND r.estado = 'confirmado')
           GROUP BY a.origen, a.origen_id
          HAVING count(*) > 1
        ) g
    ) x;
  v_controles := v_controles || jsonb_build_array(jsonb_build_object(
    'clave', 'asientos_duplicados',
    'titulo', 'Documentos con asiento duplicado',
    'ayuda', 'Documentos con más de un asiento vigente del mismo tipo: se contaron dos veces en el mayor. Se corrigen reversando el que sobra (Plan de Cuentas → Reversar asiento).',
    'casos', v_casos, 'monto', round(v_monto, 2), 'estado', CASE WHEN v_casos = 0 THEN 'ok' ELSE 'revisar' END,
    'detalle', v_detalle));

  RETURN jsonb_build_object(
    'generado_en', now(),
    'cuentas',     v_cuentas,
    'controles',   v_controles
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.conciliacion_cuentas_control() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.conciliacion_cuentas_control() TO authenticated;
