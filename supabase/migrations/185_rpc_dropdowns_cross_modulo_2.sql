-- migrations/185_rpc_dropdowns_cross_modulo_2.sql
--
-- Continuación de mig.135 (mismo hallazgo, pendiente documentado): mig.134 gateó el SELECT de
-- `ordenes_compra` (módulo compras) y `cotizaciones` (módulo ventas) con has_module_permission.
-- Se auditó CADA una de las 15 tablas restantes gateadas por mig.134 buscando componentes que las
-- lean desde FUERA de su módulo dueño (grep de .from('<tabla>') + verificación manual de qué
-- permiso gatea la pantalla que hace cada llamada). De 15 tablas, solo estas 2 tienen lectores
-- cross-módulo reales; el resto (compras/detalle_compras/ordenes_compra_items, cotizacion_items,
-- ofertas, extractos_bancarios/extracto_lineas, metodo_pago_cuenta_bancaria, cheques/
-- cheques_historial, asientos_items, alicuotas_impuestos, retenciones) solo se leen desde
-- pantallas de su propio módulo, o ya estaban correctamente gateadas client-side con
-- hasPermission() antes de la query (useNotifications.js) — no rotas.
--
-- Los 2 lectores cross-módulo reales, ambos GLOBALES (visibles a cualquier usuario sin importar
-- su rol, no hay pantalla "dueña" que ya exija el permiso):
--   • CommandPalette.jsx (⌘K, buscador global) — busca en `cotizaciones`. Un staff sin permiso
--     'ventas' no ve resultados de cotizaciones en la búsqueda (RLS devuelve 0 filas, sin error).
--   • dashboardService.ts (Dashboard, visible a TODOS) — getKPIs() cuenta `ordenes_compra`
--     activas para el KPI "OC Pendientes"; getCotizacionesStats() lee `cotizaciones` completas
--     para el widget de cotizaciones del mes. Ambos KPIs quedan silenciosamente en 0/vacíos para
--     un staff sin el permiso de módulo correspondiente — un número de negocio incorrecto, no solo
--     un dropdown vacío.
--
-- Criterio (mismo que mig.135): RPCs SECURITY DEFINER, tenant-scoped, SIN gate de permiso de
-- módulo. `contar_ordenes_compra_activas` no expone nada más que un conteo (cero superficie).
-- `listar_cotizaciones_min` expone id/numero/cliente/total/estado — mismo nivel de sensibilidad
-- que `comprobantes` (facturas de venta), que YA es de lectura tenant-only sin gate de módulo por
-- diseño explícito (mig.134: "insumo de reportes cross-módulo") — no se introduce una superficie
-- nueva, se le da a las cotizaciones el mismo tratamiento que ya tienen las facturas.

CREATE OR REPLACE FUNCTION public.contar_ordenes_compra_activas()
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT count(*)::int
  FROM public.ordenes_compra oc
  WHERE oc.empresa_id = get_my_empresa_id()
    AND oc.estado NOT IN ('recibida', 'cancelada');
$$;

REVOKE ALL ON FUNCTION public.contar_ordenes_compra_activas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contar_ordenes_compra_activas() TO authenticated;


CREATE OR REPLACE FUNCTION public.listar_cotizaciones_min()
RETURNS TABLE (
  id uuid,
  numero text,
  cliente_id uuid,
  cliente_nombre text,
  total numeric,
  estado text,
  created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT c.id, c.numero, c.cliente_id, c.cliente_nombre, c.total, c.estado, c.created_at
  FROM public.cotizaciones c
  WHERE c.empresa_id = get_my_empresa_id()
  ORDER BY c.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.listar_cotizaciones_min() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_cotizaciones_min() TO authenticated;
