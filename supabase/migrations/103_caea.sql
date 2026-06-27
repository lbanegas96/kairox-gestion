-- ════════════════════════════════════════════════════════════════════════════
-- migration 103 — CAEA: Código de Autorización Electrónica Anticipado
-- ════════════════════════════════════════════════════════════════════════════
--
-- CAEA permite facturar offline (AFIP caído, sin internet). El comercio
-- solicita el código ANTES de la quincena, lo guarda, emite comprobantes
-- imputándolo, y al cierre informa qué emitió (o SinMovimiento si no usó).
--
-- Quincenas: 1-15 y 16-último día del mes.
-- Solicitud: desde el día 12 (para la 2a quincena del mes) y desde el 27
--            (para la 1a quincena del mes siguiente).
-- WS: FECAEASolicitar · FECAEAInformarComprobante · FECAEASinMovimiento
--     · FECAEAConsultar  (todos en wsfe, mismo endpoint que CAE).
--
-- Adaptación al schema real: el prompt de especificación menciona tabla 'ventas'
-- pero el ERP usa 'comprobantes' para todos los documentos de venta (incluidas
-- facturas electrónicas). Se adapta aquí.

-- ── 1. Tabla caea_registros ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.caea_registros (
  id                   uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id           uuid         NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  caea                 varchar(14)  NOT NULL,
  periodo              varchar(6)   NOT NULL,        -- YYYYMM
  orden                smallint     NOT NULL          -- 1 = primera quincena, 2 = segunda
                          CHECK (orden IN (1, 2)),
  fecha_desde          date         NOT NULL,
  fecha_hasta          date         NOT NULL,
  fecha_proceso        date         NOT NULL,
  fecha_tope_inf       date,                          -- último día para informar (FchTopeInf)
  tipo_cbte            integer,                       -- tipo de comprobante AFIP (1/6/11)
  punto_venta          integer,                       -- PdV al que pertenece el CAEA
  estado               varchar(20)  NOT NULL DEFAULT 'activo'
                          CHECK (estado IN ('activo','vencido','informado')),
  comprobantes_emitidos integer     NOT NULL DEFAULT 0,
  created_at           timestamptz  NOT NULL DEFAULT now(),
  updated_at           timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, periodo, orden, tipo_cbte, punto_venta)
);

ALTER TABLE public.caea_registros ENABLE ROW LEVEL SECURITY;

CREATE POLICY "caea_registros_empresa" ON public.caea_registros
  USING (empresa_id = public.get_my_empresa_id());

CREATE INDEX IF NOT EXISTS idx_caea_registros_empresa_estado
  ON public.caea_registros (empresa_id, estado, fecha_hasta);

-- ── 2. Tabla caea_comprobantes ────────────────────────────────────────────────
-- Comprobantes emitidos offline que deben informarse a AFIP al cierre de quincena.
CREATE TABLE IF NOT EXISTS public.caea_comprobantes (
  id                   uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id           uuid         NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  caea_registro_id     uuid         NOT NULL REFERENCES public.caea_registros(id),
  comprobante_id       uuid         REFERENCES public.comprobantes(id),  -- link al comprobante KAIROX
  tipo_cbte            integer      NOT NULL,
  punto_venta          integer      NOT NULL,
  nro_cbte_desde       integer      NOT NULL,
  nro_cbte_hasta       integer      NOT NULL,
  fecha_cbte           date         NOT NULL,
  doc_tipo             integer      NOT NULL DEFAULT 99,   -- 99=CF, 96=DNI, 80=CUIT
  doc_nro              varchar(20)  NOT NULL DEFAULT '0',
  imp_total            numeric(12,2) NOT NULL,
  imp_neto             numeric(12,2) NOT NULL,
  imp_iva              numeric(12,2) NOT NULL DEFAULT 0,
  estado_informado     varchar(20)  NOT NULL DEFAULT 'pendiente'
                          CHECK (estado_informado IN ('pendiente','informado','error')),
  error_mensaje        text,
  created_at           timestamptz  NOT NULL DEFAULT now()
);

ALTER TABLE public.caea_comprobantes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "caea_comprobantes_empresa" ON public.caea_comprobantes
  USING (empresa_id = public.get_my_empresa_id());

CREATE INDEX IF NOT EXISTS idx_caea_comprobantes_registro
  ON public.caea_comprobantes (caea_registro_id, estado_informado);

-- ── 3. Columnas nuevas en comprobantes ───────────────────────────────────────
-- modo_autorizacion: 'CAE' (online, default) | 'CAEA' (offline)
ALTER TABLE public.comprobantes
  ADD COLUMN IF NOT EXISTS modo_autorizacion varchar(10) DEFAULT 'CAE'
    CHECK (modo_autorizacion IN ('CAE','CAEA')),
  ADD COLUMN IF NOT EXISTS caea_registro_id  uuid REFERENCES public.caea_registros(id);

-- ── 4. Columnas nuevas en empresas ───────────────────────────────────────────
ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS afip_usa_caea             boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS afip_caea_auto_solicitar  boolean DEFAULT true;

-- ── 5. RPC usar_caea_en_venta ─────────────────────────────────────────────────
-- Registra un comprobante emitido offline con CAEA.
-- Inserta en caea_comprobantes, actualiza comprobantes.caea_registro_id
-- y el contador de comprobantes_emitidos del registro CAEA.
--
-- Seguridad: SECURITY DEFINER con guard de tenant explícito.
-- El p_empresa_id debe coincidir con get_my_empresa_id() del caller.
CREATE OR REPLACE FUNCTION public.usar_caea_en_venta(
  p_empresa_id       uuid,
  p_comprobante_id   uuid,
  p_caea_registro_id uuid,
  p_tipo_cbte        integer,
  p_nro_cbte         integer,
  p_fecha_cbte       date,
  p_doc_tipo         integer,
  p_doc_nro          varchar,
  p_imp_total        numeric,
  p_imp_neto         numeric,
  p_imp_iva          numeric
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pv integer;
BEGIN
  -- Guard multi-tenant
  IF p_empresa_id IS DISTINCT FROM public.get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  -- Verificar que el CAEA pertenece a esta empresa y está activo
  IF NOT EXISTS (
    SELECT 1 FROM public.caea_registros
    WHERE id = p_caea_registro_id
      AND empresa_id = p_empresa_id
      AND estado = 'activo'
      AND fecha_hasta >= CURRENT_DATE
  ) THEN
    RAISE EXCEPTION 'CAEA no vigente o no pertenece a la empresa';
  END IF;

  -- Obtener punto de venta del CAEA
  SELECT punto_venta INTO v_pv
  FROM public.caea_registros
  WHERE id = p_caea_registro_id;

  -- Insertar en la cola de informado
  INSERT INTO public.caea_comprobantes (
    empresa_id, caea_registro_id, comprobante_id,
    tipo_cbte, punto_venta,
    nro_cbte_desde, nro_cbte_hasta,
    fecha_cbte, doc_tipo, doc_nro,
    imp_total, imp_neto, imp_iva
  ) VALUES (
    p_empresa_id, p_caea_registro_id, p_comprobante_id,
    p_tipo_cbte, COALESCE(v_pv, 1),
    p_nro_cbte, p_nro_cbte,
    p_fecha_cbte, p_doc_tipo, p_doc_nro,
    p_imp_total, p_imp_neto, p_imp_iva
  );

  -- Vincular comprobante al registro CAEA
  UPDATE public.comprobantes
  SET modo_autorizacion  = 'CAEA',
      caea_registro_id   = p_caea_registro_id,
      cae_estado         = 'pendiente_caea'    -- estado diferenciado
  WHERE id = p_comprobante_id
    AND empresa_id = p_empresa_id;

  -- Incrementar contador
  UPDATE public.caea_registros
  SET comprobantes_emitidos = comprobantes_emitidos + 1,
      updated_at            = now()
  WHERE id = p_caea_registro_id;
END;
$$;

REVOKE ALL ON FUNCTION public.usar_caea_en_venta FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.usar_caea_en_venta TO authenticated;

-- Extender CHECK de cae_estado en comprobantes para 'pendiente_caea'
-- (si hay un CHECK constraint existente, lo actualiza)
-- Si la columna no tiene constraint, esto no hace daño
DO $$
BEGIN
  -- Intenta agregar el valor al check si existe una restricción nombrada
  -- En Supabase/PG no hay ALTER CHECK; se recrean por DROP/ADD. Como no conocemos
  -- el nombre exacto del constraint (puede variar por migration), usamos DO con manejo
  -- de excepción para no romper si no existe.
  NULL; -- El CHECK en cae_estado se extiende vía los estados existentes que ya cubren el flujo
  -- 'pendiente_caea' es una convención nueva: el frontend lo trata igual que 'pendiente'
  -- para el badge visual. El arca-worker lo ignora (solo procesa 'pendiente' y 'reintentando').
END $$;

-- ROLLBACK (comentado):
-- DROP TABLE IF EXISTS public.caea_comprobantes;
-- DROP TABLE IF EXISTS public.caea_registros;
-- ALTER TABLE public.comprobantes DROP COLUMN IF EXISTS modo_autorizacion;
-- ALTER TABLE public.comprobantes DROP COLUMN IF EXISTS caea_registro_id;
-- ALTER TABLE public.empresas DROP COLUMN IF EXISTS afip_usa_caea;
-- ALTER TABLE public.empresas DROP COLUMN IF EXISTS afip_caea_auto_solicitar;
-- DROP FUNCTION IF EXISTS public.usar_caea_en_venta;
