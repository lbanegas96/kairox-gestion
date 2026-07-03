-- migrations/135_rpc_dropdowns_cross_modulo.sql
--
-- Cierra las roturas cross-módulo introducidas por mig.134 (SELECT gateado por
-- has_module_permission en proveedores y plan_cuentas). Componentes que NO pertenecen
-- al módulo pero legítimamente necesitan poblar dropdowns:
--   • ProductosSection (Inventario) → asociar proveedor a producto
--   • ChequesSection → emitir cheque a proveedor
--   • TabIVA / TabRetenciones → dropdowns de proveedor en configuración impositiva
--   • CuentasBancariasSection → vincular cuenta bancaria a cuenta contable
--
-- Criterio: RPCs SECURITY DEFINER que devuelven SOLO id + nombre (info no sensible)
-- con guard tenant estricto. Sin gate de permiso porque no exponen montos, cuit,
-- condicion IVA, saldos ni datos de contacto. La escritura sigue gateada por
-- has_module_permission (mig.132) — este fix es solo para poder listar identificadores
-- en selects sin romper la UX.

CREATE OR REPLACE FUNCTION public.listar_proveedores_min()
RETURNS TABLE (id uuid, nombre text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p.id, p.nombre
  FROM public.proveedores p
  WHERE p.empresa_id = get_my_empresa_id()
    AND p.activo IS NOT FALSE
  ORDER BY p.nombre;
$$;

REVOKE ALL ON FUNCTION public.listar_proveedores_min() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_proveedores_min() TO authenticated;


CREATE OR REPLACE FUNCTION public.listar_plan_cuentas_min()
RETURNS TABLE (
  id uuid,
  codigo varchar,
  nombre varchar,
  tipo varchar,
  permite_movimientos boolean,
  activa boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT pc.id, pc.codigo, pc.nombre, pc.tipo, pc.permite_movimientos, pc.activa
  FROM public.plan_cuentas pc
  WHERE pc.empresa_id = get_my_empresa_id()
    AND pc.activa IS NOT FALSE
  ORDER BY pc.codigo;
$$;

REVOKE ALL ON FUNCTION public.listar_plan_cuentas_min() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_plan_cuentas_min() TO authenticated;
