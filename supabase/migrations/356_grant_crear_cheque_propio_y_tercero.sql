-- Bug encontrado probando Fase 2 del plan de prueba integral (Ferreteria NADIA, 27/08):
-- crear_cheque_propio() y crear_cheque_tercero() son SECURITY DEFINER con sus propias
-- validaciones internas (empresa_id = get_my_empresa_id() + has_module_permission('cheques')),
-- pero nunca tuvieron GRANT EXECUTE para el rol authenticated. Resultado: CUALQUIER intento de
-- registrar un cheque (propio o de tercero) fallaba en silencio con
-- "permission denied for function crear_cheque_propio/tercero" -- el modal mostraba el toast de
-- error (que se renderiza fuera de <main>, facil de no ver) pero el submit nunca completaba.
-- Mismo patron que mig.355 (seed_plan_cuentas): la funcion ya valida todo lo necesario
-- internamente, así que el GRANT es seguro.
--
-- Verificado con BEGIN...ROLLBACK simulando el rol authenticated antes de aplicar:
-- "permission denied for function crear_cheque_propio" -> tras el GRANT, la misma llamada
-- devuelve el id del cheque creado correctamente.

GRANT EXECUTE ON FUNCTION public.crear_cheque_propio(uuid, uuid, text, text, numeric, date, date, uuid, uuid, uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crear_cheque_tercero(uuid, uuid, text, text, numeric, date, date, uuid, uuid, text, boolean) TO authenticated;
