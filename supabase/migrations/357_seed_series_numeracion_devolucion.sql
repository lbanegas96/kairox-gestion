-- Bug encontrado probando Fase 2 del plan de prueba integral (Ferreteria NADIA, 27/08):
-- obtener_proximo_numero() ya sabe contar el tipo 'devolucion' (tiene su propio WHEN 'devolucion'
-- en el CASE que calcula v_max_real, leyendo de public.devoluciones), pero
-- seed_series_numeracion() -- la funcion que siembra las series por defecto de una empresa nueva --
-- nunca incluyo 'devolucion' en su lista de INSERT. Resultado: obtener_proximo_numero() no
-- encuentra fila en series_numeracion para (empresa, 'devolucion', pv=null), corre el fallback
-- (llama a seed_series_numeracion, que tampoco la crea) y termina lanzando
-- "Tipo de documento no reconocido: devolucion" -- bloqueando CUALQUIER devolucion, tanto a
-- proveedor como de cliente (mismo tipo de documento compartido por ambos flujos).
--
-- Confirmado en vivo: Ferreteria NADIA (empresa nueva) no podia registrar "Devolver a proveedor".
-- Confirmado por consulta directa que 5 de 7 empresas existentes SI tenian la fila (sembrada a
-- mano en algun momento pasado, incluida Nalux) -- las 2 que faltaban (incluida Ferreteria NADIA)
-- son las que nunca pasaron por ese sembrado manual. Se corrige el seed function para que no
-- vuelva a pasar con la proxima empresa nueva, y se siembra retroactivo para las que ya existen
-- y les falta.

CREATE OR REPLACE FUNCTION public.seed_series_numeracion(p_empresa_id uuid)
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

  INSERT INTO public.series_numeracion (empresa_id, tipo_documento, prefijo, formato_fecha, digitos) VALUES
    (p_empresa_id, 'venta',                  '',     'YYYYMMDD', 3),
    (p_empresa_id, 'factura',                'FAC-', 'YYYYMMDD', 3),
    (p_empresa_id, 'nota_credito',           'NC-',  'YYYYMMDD', 3),
    (p_empresa_id, 'nota_debito_venta',      'ND-',  'YYYYMMDD', 3),
    (p_empresa_id, 'nota_credito_proveedor', 'NC-',  'YYYYMMDD', 3),
    (p_empresa_id, 'pedido',                 'PED-', 'YYYYMMDD', 3),
    (p_empresa_id, 'nota_debito',            'ND-',  'YYYY',     4),
    (p_empresa_id, 'entrega',                'ENT-', 'YYYY',     4),
    (p_empresa_id, 'recepcion',              'REC-', 'YYYY',     4),
    (p_empresa_id, 'devolucion',             'DEV-', 'YYYY',     4),
    (p_empresa_id, 'orden_compra',           'OC-',  'ninguno',  5),
    (p_empresa_id, 'cotizacion',             'COT-', 'ninguno',  5),
    (p_empresa_id, 'recuento_inventario',       'RC-', 'YYYYMMDD', 3),
    (p_empresa_id, 'revalorizacion_inventario', 'RV-', 'YYYYMMDD', 3)
  ON CONFLICT (empresa_id, tipo_documento) WHERE punto_venta_id IS NULL DO NOTHING;
END;
$function$;

-- Siembra retroactiva para empresas existentes que ya pasaron por el seed original
-- (por eso el ON CONFLICT del bloque de arriba no las alcanza) y todavia no tienen la serie.
INSERT INTO public.series_numeracion (empresa_id, tipo_documento, prefijo, formato_fecha, digitos)
SELECT e.id, 'devolucion', 'DEV-', 'YYYY', 4
FROM public.empresas e
WHERE NOT EXISTS (
  SELECT 1 FROM public.series_numeracion sn
  WHERE sn.empresa_id = e.id AND sn.tipo_documento = 'devolucion' AND sn.punto_venta_id IS NULL
);
