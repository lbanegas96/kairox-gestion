-- ════════════════════════════════════════════════════════════════════════════
-- migration 166 — Cierre de gap sistémico: Cheques propios → contabilización
-- + 2 correcciones de mercado en cheques de terceros (Frente 2, sesión 52)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Contexto: PLAN_AUDITORIA.md dejaba documentado como pendiente de decisión de
-- negocio "cheques propios (entregados a proveedores) no se contabilizan —
-- requeriría una cuenta 'Documentos a Pagar' que todavía no existe". Se decidió
-- (2026-07-07) avanzar sin esperar a un contador matriculado, usando la skill
-- interna `auditor-contable` + referencia de estructura SAP + research de
-- mercado argentino (Tango, Colppy, e-cheq/COELSA) como validación.
--
-- ESQUEMA PROPUESTO — mismo patrón "no bloqueante" que mig.144/145 (si falta
-- una cuenta o el período está cerrado, el cambio de estado del cheque se
-- completa igual, sin asiento):
--
-- CHEQUES PROPIOS (tipo='propio'):
--   Entregado (pendiente→entregado): DEBE 2.1.1 Cuentas a Pagar (si tiene
--     proveedor_id) / HABER 2.1.6 Documentos a Pagar.
--   Cobrado/debitado (entregado→cobrado): DEBE 2.1.6 / HABER 1.1.1 Caja y Bancos.
--   Rechazado desde 'entregado' (cheque propio rebotado): reversa del entregado
--     — DEBE 2.1.6 / HABER 2.1.1 (la deuda con el proveedor vuelve a estar viva).
--   Rechazado desde 'pendiente' (anulado antes de entregar): sin asiento — nunca
--     hubo evento económico.
--
-- CHEQUES DE TERCEROS (tipo='tercero') — 2 correcciones sobre mig.145:
--   1. Endoso a proveedor (bug real, no solo gap): mig.145 no distinguía el
--      camino al llegar a 'cobrado' — un cheque endosado a un proveedor y luego
--      marcado 'cobrado' generaba DEBE Caja y Bancos como si hubiese entrado
--      efectivo real, cuando en realidad se canceló una deuda con ese proveedor.
--      Fix: el asiento se dispara en el momento del ENDOSO (no se espera a un
--      'cobrado' posterior, que ahora es no-op si el cheque ya está endosado):
--        DEBE 2.1.1 Cuentas a Pagar (proveedor_id del endoso) / HABER 1.1.6.
--   2. Cheque rechazado: en vez de revertir directo a 1.1.2/4.3 (perdiendo
--      trazabilidad), ahora va a la cuenta dedicada 1.1.7 "Deudores por Cheques
--      Rechazados" — práctica estándar de mercado (Tango, Colppy) para poder
--      darle seguimiento de cobranza/legal por separado de la cuenta corriente
--      normal. Si el rechazo ocurre después de un endoso, reinstala la deuda
--      del proveedor (HABER 2.1.1) en vez de la del cliente.
--
-- Fuera de alcance a propósito (documentado, no urgente — ver CONTEXT.md):
--   'descontado' (adelanto bancario de un cheque de tercero antes del
--   vencimiento) sigue sin asiento propio; su costo financiero (interés
--   descontado) no está modelado. Múltiples "carteras" de cheques por cuenta
--   de tesorería (Tango lo tiene) tampoco — sobre-ingeniería para el tamaño de
--   PyME que ataca KAIROX hoy.

-- ── 1. Cuentas nuevas en el plan de cuentas ────────────────────────────────

-- 1a. Backfill en las empresas existentes (no duplicar si ya corrió)
INSERT INTO public.plan_cuentas (empresa_id, codigo, nombre, tipo, nivel, permite_movimientos)
SELECT e.id, '2.1.6', 'Documentos a Pagar', 'pasivo', 3, true
FROM public.empresas e
WHERE NOT EXISTS (
  SELECT 1 FROM public.plan_cuentas p WHERE p.empresa_id = e.id AND p.codigo = '2.1.6'
);

INSERT INTO public.plan_cuentas (empresa_id, codigo, nombre, tipo, nivel, permite_movimientos)
SELECT e.id, '1.1.7', 'Deudores por Cheques Rechazados', 'activo', 3, true
FROM public.empresas e
WHERE NOT EXISTS (
  SELECT 1 FROM public.plan_cuentas p WHERE p.empresa_id = e.id AND p.codigo = '1.1.7'
);

-- 1b. Agregar al seed para empresas nuevas (mismo patrón: activo/pasivo corriente)
CREATE OR REPLACE FUNCTION public.seed_plan_cuentas(p_empresa_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No tenés permiso para inicializar el plan de otra empresa';
  END IF;

  IF EXISTS (SELECT 1 FROM plan_cuentas WHERE empresa_id = p_empresa_id LIMIT 1) THEN
    RETURN;
  END IF;

  INSERT INTO plan_cuentas (empresa_id, codigo, nombre, tipo, nivel, permite_movimientos) VALUES
    (p_empresa_id,'1','ACTIVO','activo',1,false),
    (p_empresa_id,'1.1','Activo Corriente','activo',2,false),
    (p_empresa_id,'1.1.1','Caja y Bancos','activo',3,true),
    (p_empresa_id,'1.1.2','Cuentas a Cobrar','activo',3,true),
    (p_empresa_id,'1.1.3','Mercaderías / Inventario','activo',3,true),
    (p_empresa_id,'1.1.4','IVA Crédito Fiscal','activo',3,true),
    (p_empresa_id,'1.1.5','Otros Activos Corrientes','activo',3,true),
    (p_empresa_id,'1.1.6','Cheques de Terceros en Cartera','activo',3,true),
    (p_empresa_id,'1.1.7','Deudores por Cheques Rechazados','activo',3,true),
    (p_empresa_id,'1.2','Activo No Corriente','activo',2,false),
    (p_empresa_id,'1.2.1','Bienes de Uso (neto)','activo',3,true),
    (p_empresa_id,'1.2.2','Intangibles','activo',3,true),
    (p_empresa_id,'2','PASIVO','pasivo',1,false),
    (p_empresa_id,'2.1','Pasivo Corriente','pasivo',2,false),
    (p_empresa_id,'2.1.1','Cuentas a Pagar','pasivo',3,true),
    (p_empresa_id,'2.1.2','Sueldos y Cargas Sociales','pasivo',3,true),
    (p_empresa_id,'2.1.3','IVA Débito Fiscal','pasivo',3,true),
    (p_empresa_id,'2.1.4','Impuestos a Pagar','pasivo',3,true),
    (p_empresa_id,'2.1.5','Otros Pasivos Corrientes','pasivo',3,true),
    (p_empresa_id,'2.1.6','Documentos a Pagar','pasivo',3,true),
    (p_empresa_id,'2.2','Pasivo No Corriente','pasivo',2,false),
    (p_empresa_id,'2.2.1','Deudas Financieras LP','pasivo',3,true),
    (p_empresa_id,'3','PATRIMONIO NETO','patrimonio',1,false),
    (p_empresa_id,'3.1','Capital Social','patrimonio',2,true),
    (p_empresa_id,'3.2','Resultados Acumulados','patrimonio',2,true),
    (p_empresa_id,'3.3','Resultado del Ejercicio','patrimonio',2,true),
    (p_empresa_id,'4','INGRESOS','ingreso',1,false),
    (p_empresa_id,'4.1','Ventas de Productos','ingreso',2,true),
    (p_empresa_id,'4.2','Ventas de Servicios','ingreso',2,true),
    (p_empresa_id,'4.3','Otros Ingresos','ingreso',2,true),
    (p_empresa_id,'5','EGRESOS / GASTOS','egreso',1,false),
    (p_empresa_id,'5.1','Costo de Mercaderías','egreso',2,true),
    (p_empresa_id,'5.2','Gastos de Personal','egreso',2,true),
    (p_empresa_id,'5.3','Gastos Comerciales','egreso',2,true),
    (p_empresa_id,'5.4','Gastos de Administración','egreso',2,true),
    (p_empresa_id,'5.5','Gastos Financieros','egreso',2,true),
    (p_empresa_id,'5.6','Impuestos y Tasas','egreso',2,true),
    (p_empresa_id,'5.7','Amortizaciones','egreso',2,true),
    (p_empresa_id,'5.8','Otros Gastos','egreso',2,true);
END;
$function$;

-- ── 2. Columna es_electronico (e-cheq) — solo flag informativo, sin integración COELSA ──

ALTER TABLE public.cheques ADD COLUMN IF NOT EXISTS es_electronico boolean NOT NULL DEFAULT false;

-- ── 3. RPCs: aceptar es_electronico + proveedor de endoso ──────────────────
--
-- IMPORTANTE: CREATE OR REPLACE FUNCTION no reemplaza si cambia la firma
-- (agregamos parámetros nuevos) — crea una sobrecarga ambigua junto a la
-- versión vieja. Hay que dropear las firmas anteriores primero (detectado
-- probando esta migración con BEGIN...ROLLBACK antes de aplicarla).

DROP FUNCTION IF EXISTS public.crear_cheque_tercero(uuid,uuid,text,text,numeric,date,date,uuid,uuid,text);
DROP FUNCTION IF EXISTS public.crear_cheque_propio(uuid,uuid,text,text,numeric,date,date,uuid,uuid,uuid,text);
DROP FUNCTION IF EXISTS public.cambiar_estado_cheque(uuid,uuid,text,text);

CREATE OR REPLACE FUNCTION public.crear_cheque_tercero(
  p_empresa_id uuid, p_user_id uuid, p_numero text, p_banco text, p_monto numeric,
  p_fecha_emision date, p_fecha_vencimiento date,
  p_cliente_id uuid DEFAULT NULL, p_comprobante_id uuid DEFAULT NULL,
  p_observaciones text DEFAULT NULL, p_es_electronico boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cheque_id uuid;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('cheques') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo cheques';
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a cero';
  END IF;

  INSERT INTO public.cheques (
    empresa_id, user_id, tipo, numero, banco, monto, fecha_emision, fecha_vencimiento,
    cliente_id, comprobante_id, observaciones, estado, es_electronico
  ) VALUES (
    p_empresa_id, p_user_id, 'tercero', p_numero, p_banco, p_monto, p_fecha_emision, p_fecha_vencimiento,
    p_cliente_id, p_comprobante_id, p_observaciones, 'en_cartera', COALESCE(p_es_electronico, false)
  ) RETURNING id INTO v_cheque_id;

  INSERT INTO public.cheques_historial (cheque_id, empresa_id, user_id, estado_anterior, estado_nuevo, observacion)
  VALUES (v_cheque_id, p_empresa_id, p_user_id, NULL, 'en_cartera', 'Registro inicial');

  RETURN jsonb_build_object('id', v_cheque_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.crear_cheque_propio(
  p_empresa_id uuid, p_user_id uuid, p_numero text, p_banco text, p_monto numeric,
  p_fecha_emision date, p_fecha_vencimiento date,
  p_cuenta_bancaria_id uuid DEFAULT NULL, p_proveedor_id uuid DEFAULT NULL,
  p_compra_id uuid DEFAULT NULL, p_observaciones text DEFAULT NULL, p_es_electronico boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cheque_id uuid;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('cheques') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo cheques';
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a cero';
  END IF;

  INSERT INTO public.cheques (
    empresa_id, user_id, tipo, numero, banco, cuenta_bancaria_id, monto,
    fecha_emision, fecha_vencimiento, proveedor_id, compra_id, observaciones, estado, es_electronico
  ) VALUES (
    p_empresa_id, p_user_id, 'propio', p_numero, p_banco, p_cuenta_bancaria_id, p_monto,
    p_fecha_emision, p_fecha_vencimiento, p_proveedor_id, p_compra_id, p_observaciones, 'pendiente',
    COALESCE(p_es_electronico, false)
  ) RETURNING id INTO v_cheque_id;

  INSERT INTO public.cheques_historial (cheque_id, empresa_id, user_id, estado_anterior, estado_nuevo, observacion)
  VALUES (v_cheque_id, p_empresa_id, p_user_id, NULL, 'pendiente', 'Registro inicial');

  RETURN jsonb_build_object('id', v_cheque_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.cambiar_estado_cheque(
  p_cheque_id uuid, p_user_id uuid, p_estado_nuevo text, p_observacion text DEFAULT NULL,
  p_proveedor_endoso_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id uuid;
  v_estado_anterior text;
BEGIN
  SELECT empresa_id, estado INTO v_empresa_id, v_estado_anterior
  FROM public.cheques WHERE id = p_cheque_id FOR UPDATE;

  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Cheque no encontrado';
  END IF;
  IF v_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: el cheque no pertenece a tu empresa';
  END IF;
  IF NOT has_module_permission('cheques') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo cheques';
  END IF;

  -- proveedor_endoso_id solo se usa para setear/actualizar proveedor_id cuando
  -- un cheque de tercero se endosa; para cualquier otra transición no pisa
  -- el valor existente (COALESCE con el actual).
  UPDATE public.cheques
  SET estado = p_estado_nuevo,
      proveedor_id = COALESCE(p_proveedor_endoso_id, proveedor_id),
      updated_at = now()
  WHERE id = p_cheque_id;

  INSERT INTO public.cheques_historial (cheque_id, empresa_id, user_id, estado_anterior, estado_nuevo, observacion)
  VALUES (p_cheque_id, v_empresa_id, p_user_id, v_estado_anterior, p_estado_nuevo, p_observacion);

  RETURN jsonb_build_object('ok', true, 'estado_anterior', v_estado_anterior, 'estado_nuevo', p_estado_nuevo);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.crear_cheque_tercero(uuid,uuid,text,text,numeric,date,date,uuid,uuid,text,boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.crear_cheque_propio(uuid,uuid,text,text,numeric,date,date,uuid,uuid,uuid,text,boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cambiar_estado_cheque(uuid,uuid,text,text,uuid) FROM PUBLIC, anon;

-- ── 4. Trigger de cheques de terceros — reescrito con endoso + cta. rechazados ──

CREATE OR REPLACE FUNCTION public.fn_asiento_cheque_tercero()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cta_cartera   uuid;
  v_cta_contra    uuid;
  v_cta_rechazado uuid;
  v_asiento_id    uuid;
  v_fecha         date;
  v_cerrado       boolean;
  v_desc          text;
BEGIN
  IF NEW.tipo <> 'tercero' THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT id INTO v_cta_cartera FROM public.plan_cuentas
    WHERE empresa_id = NEW.empresa_id AND codigo = '1.1.6' AND activa LIMIT 1;
    IF v_cta_cartera IS NULL THEN RETURN NEW; END IF;

    IF TG_OP = 'INSERT' THEN
      v_fecha := COALESCE(NEW.fecha_emision, CURRENT_DATE);
      SELECT fecha_en_periodo_cerrado(NEW.empresa_id, v_fecha) INTO v_cerrado;
      IF COALESCE(v_cerrado, false) THEN RETURN NEW; END IF;

      IF NEW.cliente_id IS NOT NULL THEN
        SELECT id INTO v_cta_contra FROM public.plan_cuentas
        WHERE empresa_id = NEW.empresa_id AND codigo = '1.1.2' AND activa LIMIT 1;
      ELSE
        SELECT id INTO v_cta_contra FROM public.plan_cuentas
        WHERE empresa_id = NEW.empresa_id AND codigo = '4.3' AND activa LIMIT 1;
      END IF;
      IF v_cta_contra IS NULL THEN RETURN NEW; END IF;

      v_desc := 'Cheque de tercero recibido — ' || NEW.numero || ' (' || NEW.banco || ')';
      INSERT INTO public.asientos_contables
        (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
      VALUES (NEW.empresa_id, NEW.user_id, next_numero_asiento(NEW.empresa_id), v_fecha, v_desc,
              'confirmado', NEW.monto, NEW.monto, 'cheque_tercero', NEW.id)
      RETURNING id INTO v_asiento_id;

      INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
        (v_asiento_id, NEW.empresa_id, v_cta_cartera, v_desc, NEW.monto, 0),
        (v_asiento_id, NEW.empresa_id, v_cta_contra,  v_desc, 0, NEW.monto);

    ELSIF TG_OP = 'UPDATE' AND NEW.estado IS DISTINCT FROM OLD.estado THEN
      v_fecha := CURRENT_DATE;
      SELECT fecha_en_periodo_cerrado(NEW.empresa_id, v_fecha) INTO v_cerrado;
      IF COALESCE(v_cerrado, false) THEN RETURN NEW; END IF;

      IF NEW.estado = 'endosado' AND OLD.estado <> 'endosado' THEN
        -- Endoso a un proveedor: el cheque sale de la cartera y cancela una
        -- deuda propia — el asiento definitivo se dispara acá, no al "cobrarse".
        IF NEW.proveedor_id IS NULL THEN RETURN NEW; END IF;
        SELECT id INTO v_cta_contra FROM public.plan_cuentas
        WHERE empresa_id = NEW.empresa_id AND codigo = '2.1.1' AND activa LIMIT 1;
        IF v_cta_contra IS NULL THEN RETURN NEW; END IF;

        v_desc := 'Cheque de tercero endosado a proveedor — ' || NEW.numero || ' (' || NEW.banco || ')';
        INSERT INTO public.asientos_contables
          (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
        VALUES (NEW.empresa_id, NEW.user_id, next_numero_asiento(NEW.empresa_id), v_fecha, v_desc,
                'confirmado', NEW.monto, NEW.monto, 'cheque_tercero', NEW.id)
        RETURNING id INTO v_asiento_id;

        INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
          (v_asiento_id, NEW.empresa_id, v_cta_contra,  v_desc, NEW.monto, 0),
          (v_asiento_id, NEW.empresa_id, v_cta_cartera, v_desc, 0, NEW.monto);

      ELSIF NEW.estado = 'cobrado' AND OLD.estado <> 'cobrado' THEN
        -- Si ya estaba endosado, el asiento definitivo ya se hizo en el endoso.
        IF OLD.estado = 'endosado' THEN RETURN NEW; END IF;

        SELECT id INTO v_cta_contra FROM public.plan_cuentas
        WHERE empresa_id = NEW.empresa_id AND codigo = '1.1.1' AND activa LIMIT 1;
        IF v_cta_contra IS NULL THEN RETURN NEW; END IF;

        v_desc := 'Cheque de tercero cobrado — ' || NEW.numero || ' (' || NEW.banco || ')';
        INSERT INTO public.asientos_contables
          (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
        VALUES (NEW.empresa_id, NEW.user_id, next_numero_asiento(NEW.empresa_id), v_fecha, v_desc,
                'confirmado', NEW.monto, NEW.monto, 'cheque_tercero', NEW.id)
        RETURNING id INTO v_asiento_id;

        INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
          (v_asiento_id, NEW.empresa_id, v_cta_contra,  v_desc, NEW.monto, 0),
          (v_asiento_id, NEW.empresa_id, v_cta_cartera, v_desc, 0, NEW.monto);

      ELSIF NEW.estado = 'rechazado' AND OLD.estado <> 'rechazado' THEN
        SELECT id INTO v_cta_rechazado FROM public.plan_cuentas
        WHERE empresa_id = NEW.empresa_id AND codigo = '1.1.7' AND activa LIMIT 1;
        IF v_cta_rechazado IS NULL THEN RETURN NEW; END IF;

        IF OLD.estado = 'endosado' THEN
          -- Reversa del endoso: la deuda con el proveedor vuelve a estar viva,
          -- y queda un crédito a cobrar (de riesgo) contra quien nos lo dio.
          SELECT id INTO v_cta_contra FROM public.plan_cuentas
          WHERE empresa_id = NEW.empresa_id AND codigo = '2.1.1' AND activa LIMIT 1;
          IF v_cta_contra IS NULL THEN RETURN NEW; END IF;

          v_desc := 'Cheque de tercero rechazado (endosado a proveedor) — ' || NEW.numero || ' (' || NEW.banco || ')';
          INSERT INTO public.asientos_contables
            (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
          VALUES (NEW.empresa_id, NEW.user_id, next_numero_asiento(NEW.empresa_id), v_fecha, v_desc,
                  'confirmado', NEW.monto, NEW.monto, 'cheque_tercero', NEW.id)
          RETURNING id INTO v_asiento_id;

          INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
            (v_asiento_id, NEW.empresa_id, v_cta_rechazado, v_desc, NEW.monto, 0),
            (v_asiento_id, NEW.empresa_id, v_cta_contra,    v_desc, 0, NEW.monto);
        ELSE
          -- Camino normal (en_cartera/depositado/descontado → rechazado): sale
          -- de la cartera y pasa a la cuenta dedicada de riesgo, no a Cuentas a
          -- Cobrar normal (para no mezclar cobranza sana con cobranza dudosa).
          v_desc := 'Cheque de tercero rechazado — ' || NEW.numero || ' (' || NEW.banco || ')';
          INSERT INTO public.asientos_contables
            (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
          VALUES (NEW.empresa_id, NEW.user_id, next_numero_asiento(NEW.empresa_id), v_fecha, v_desc,
                  'confirmado', NEW.monto, NEW.monto, 'cheque_tercero', NEW.id)
          RETURNING id INTO v_asiento_id;

          INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
            (v_asiento_id, NEW.empresa_id, v_cta_rechazado, v_desc, NEW.monto, 0),
            (v_asiento_id, NEW.empresa_id, v_cta_cartera,   v_desc, 0, NEW.monto);
        END IF;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- no bloqueante: el cheque se registra/actualiza igual sin asiento
  END;

  RETURN NEW;
END;
$$;

-- ── 5. Trigger nuevo — cheques propios ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_asiento_cheque_propio()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cta_documentos uuid;
  v_cta_cxp        uuid;
  v_cta_caja       uuid;
  v_asiento_id     uuid;
  v_fecha          date;
  v_cerrado        boolean;
  v_desc           text;
BEGIN
  IF NEW.tipo <> 'propio' THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT id INTO v_cta_documentos FROM public.plan_cuentas
    WHERE empresa_id = NEW.empresa_id AND codigo = '2.1.6' AND activa LIMIT 1;
    IF v_cta_documentos IS NULL THEN RETURN NEW; END IF;

    IF TG_OP = 'UPDATE' AND NEW.estado IS DISTINCT FROM OLD.estado THEN
      v_fecha := CURRENT_DATE;
      SELECT fecha_en_periodo_cerrado(NEW.empresa_id, v_fecha) INTO v_cerrado;
      IF COALESCE(v_cerrado, false) THEN RETURN NEW; END IF;

      IF NEW.estado = 'entregado' AND OLD.estado <> 'entregado' THEN
        IF NEW.proveedor_id IS NULL THEN RETURN NEW; END IF;
        SELECT id INTO v_cta_cxp FROM public.plan_cuentas
        WHERE empresa_id = NEW.empresa_id AND codigo = '2.1.1' AND activa LIMIT 1;
        IF v_cta_cxp IS NULL THEN RETURN NEW; END IF;

        v_desc := 'Cheque propio entregado — ' || NEW.numero || ' (' || NEW.banco || ')';
        INSERT INTO public.asientos_contables
          (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
        VALUES (NEW.empresa_id, NEW.user_id, next_numero_asiento(NEW.empresa_id), v_fecha, v_desc,
                'confirmado', NEW.monto, NEW.monto, 'cheque_propio', NEW.id)
        RETURNING id INTO v_asiento_id;

        INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
          (v_asiento_id, NEW.empresa_id, v_cta_cxp,        v_desc, NEW.monto, 0),
          (v_asiento_id, NEW.empresa_id, v_cta_documentos, v_desc, 0, NEW.monto);

      ELSIF NEW.estado = 'cobrado' AND OLD.estado <> 'cobrado' THEN
        SELECT id INTO v_cta_caja FROM public.plan_cuentas
        WHERE empresa_id = NEW.empresa_id AND codigo = '1.1.1' AND activa LIMIT 1;
        IF v_cta_caja IS NULL THEN RETURN NEW; END IF;

        v_desc := 'Cheque propio cobrado/debitado — ' || NEW.numero || ' (' || NEW.banco || ')';
        INSERT INTO public.asientos_contables
          (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
        VALUES (NEW.empresa_id, NEW.user_id, next_numero_asiento(NEW.empresa_id), v_fecha, v_desc,
                'confirmado', NEW.monto, NEW.monto, 'cheque_propio', NEW.id)
        RETURNING id INTO v_asiento_id;

        INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
          (v_asiento_id, NEW.empresa_id, v_cta_documentos, v_desc, NEW.monto, 0),
          (v_asiento_id, NEW.empresa_id, v_cta_caja,       v_desc, 0, NEW.monto);

      ELSIF NEW.estado = 'rechazado' AND OLD.estado = 'entregado' THEN
        -- Rechazado desde 'pendiente' (nunca entregado) no genera nada acá
        -- porque nunca hubo evento económico. Rechazado desde 'entregado' sí:
        -- reversa — la deuda con el proveedor vuelve a estar viva.
        SELECT id INTO v_cta_cxp FROM public.plan_cuentas
        WHERE empresa_id = NEW.empresa_id AND codigo = '2.1.1' AND activa LIMIT 1;
        IF v_cta_cxp IS NULL THEN RETURN NEW; END IF;

        v_desc := 'Cheque propio rechazado — ' || NEW.numero || ' (' || NEW.banco || ')';
        INSERT INTO public.asientos_contables
          (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
        VALUES (NEW.empresa_id, NEW.user_id, next_numero_asiento(NEW.empresa_id), v_fecha, v_desc,
                'confirmado', NEW.monto, NEW.monto, 'cheque_propio', NEW.id)
        RETURNING id INTO v_asiento_id;

        INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
          (v_asiento_id, NEW.empresa_id, v_cta_documentos, v_desc, NEW.monto, 0),
          (v_asiento_id, NEW.empresa_id, v_cta_cxp,        v_desc, 0, NEW.monto);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- no bloqueante
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_asiento_cheque_propio_update ON public.cheques;
CREATE TRIGGER trg_asiento_cheque_propio_update
  AFTER UPDATE OF estado ON public.cheques
  FOR EACH ROW EXECUTE FUNCTION public.fn_asiento_cheque_propio();

REVOKE EXECUTE ON FUNCTION public.fn_asiento_cheque_propio() FROM PUBLIC, anon, authenticated;
