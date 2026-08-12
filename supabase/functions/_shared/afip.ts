/**
 * Helpers AFIP/ARCA — usados por arca-worker y probar-conexion-afip.
 *
 * Implementación MANUAL de los web services (WSAA + WSFE), SIN el SDK
 * @nicoo01x/arca-sdk (que armaba mal el TRA → "XML contra el SCHEMA").
 * Verificado contra homologación en sesión 63.
 *
 * Las funciones que llaman a AFIP reciben `admin` (SupabaseClient service_role)
 * y `empresaId` para cachear el Ticket de Acceso en afip_tickets.
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getValidTA } from './wsaa.ts';
import { feCompUltimoAutorizado, feCompConsultar, feCAESolicitar, type WsfeAuth, type CompConsultaResult } from './wsfe.ts';

/**
 * Mapea tipo interno KAIROX (A/B/C) + clase de documento (comprobantes.tipo)
 * al código de comprobante AFIP de WSFE.
 *
 * HALLAZGO (sesión 2026-07-29): esta función solo miraba la letra y siempre
 * devolvía el código de Factura (1/6/11) — arca-worker no le pasaba la clase
 * de documento porque ni siquiera seleccionaba `comprobantes.tipo`. Resultado
 * en producción: toda Nota de Crédito emitida con CAE salió declarada ante
 * ARCA como Factura (código 6/B en vez de 8/B) — 4 NC reales afectadas,
 * confirmadas por consulta directa (NC-20260706-003, NC-20260707-001,
 * NC-20260707-002, NC-20260728-002). Esos 4 documentos ya autorizados no se
 * pueden corregir por acá — es un tema para el contador de la empresa. Este
 * fix solo evita que se repita hacia adelante.
 */
export function voucherTypeAfip(
  tipoLetra: string,
  claseDocumento: 'venta' | 'nota_credito' | 'nota_debito' = 'venta',
): number {
  const CODIGOS: Record<'venta' | 'nota_credito' | 'nota_debito', Record<'A' | 'B' | 'C', number>> = {
    venta:        { A: 1, B: 6,  C: 11 },
    nota_credito: { A: 3, B: 8,  C: 13 },
    nota_debito:  { A: 2, B: 7,  C: 12 },
  };
  const fila = CODIGOS[claseDocumento] ?? CODIGOS.venta;
  return fila[tipoLetra as 'A' | 'B' | 'C'] ?? fila.B;
}

/** Mapea alícuota IVA KAIROX al porcentaje numérico para WSFE. */
export function alicuotaPct(alicuota: string | null): number {
  if (alicuota === '10.5') return 10.5;
  if (alicuota === '0' || alicuota === 'exento' || alicuota === 'no_gravado') return 0;
  return 21;
}

/** Mapea un porcentaje de IVA al Id de alícuota de AFIP. */
function ivaIdFromPct(pct: number): number {
  if (pct === 0) return 3;      // 0%
  if (pct === 10.5) return 4;   // 10.5%
  if (pct === 27) return 6;     // 27%
  return 5;                     // 21% (default)
}

/** Determina tipo de documento AFIP a partir del documento del receptor. */
export function docTipoAfip(documento: string | null): { tipo: number; nro: string } {
  const d = (documento ?? '').replace(/\D/g, '');
  if (d.length === 11) return { tipo: 80, nro: d };   // 80 = CUIT
  if (d.length >= 7 && d.length <= 8) return { tipo: 96, nro: d }; // 96 = DNI
  return { tipo: 99, nro: '0' };                      // 99 = Consumidor Final
}

/**
 * Mapea la condición IVA del receptor (KAIROX: RI/Monotributo/Exento/CF/No Categorizado)
 * al `CondicionIVAReceptorId` de AFIP — obligatorio desde RG 5616 (error 10246 si falta).
 * Sin este campo, ARCA rechaza el comprobante completo (visto en producción: 20 facturas
 * atascadas en `error_datos` hasta que se agregó este campo).
 */
export function condicionIvaReceptorId(condicionIva: string | null, docTipo: number): number {
  if (docTipo === 99) return 5; // Consumidor Final (sin documento) — siempre CF para AFIP
  switch (condicionIva) {
    case 'RI': return 1;              // Responsable Inscripto
    case 'Exento': return 4;          // Sujeto Exento
    case 'Monotributo': return 6;     // Responsable Monotributo
    case 'No Categorizado': return 7; // Sujeto No Categorizado
    case 'CF': return 5;              // Consumidor Final
    default: return 5;                // fallback seguro: Consumidor Final
  }
}

export interface ArcaEmitParams {
  empresaId: string;
  cuit: string;
  certPem: string;
  keyPem: string;
  environment: 'production' | 'sandbox';
  pvNumero: number;
  voucherType: number;
  issueDate: string;       // YYYYMMDD
  customerDocType: number;
  customerDocNro: string;
  customerCondicionIva: string | null;
  items: Array<{ description: string; quantity: number; unitPrice: number; ivaAliquot: number }>;
  neto: number;
  iva: number;
  total: number;
  // Solo NC/ND: comprobante que le dio origen. AFIP lo exige con [10197] si falta.
  cbteAsoc?: { tipo: number; ptoVta: number; nro: number } | null;
}

export interface ArcaEmitResult {
  cae: string;
  caeExpirationDate: string | null;  // ISO YYYY-MM-DD
  numeroCorrelativo: number;
}

/** Convierte YYYYMMDD → YYYY-MM-DD (o null si vacío). */
export function fchToIso(yyyymmdd: string): string | null {
  if (!yyyymmdd || yyyymmdd.length !== 8) return null;
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

/**
 * Último número de comprobante autorizado en ARCA para un PdV y tipo.
 * Usa TA cacheado (afip_tickets). 0 si no hay ninguno.
 */
export async function getLastVoucherNumber(
  admin: SupabaseClient,
  empresaId: string,
  cuit: string,
  certPem: string,
  keyPem: string,
  environment: 'production' | 'sandbox',
  pvNumero: number,
  voucherType: number,
): Promise<number> {
  const ta = await getValidTA(admin, empresaId, environment, certPem, keyPem);
  const auth: WsfeAuth = { token: ta.token, sign: ta.sign, cuit };
  return await feCompUltimoAutorizado(environment, auth, pvNumero, voucherType);
}

/**
 * Detalle real (incl. CAE) de un comprobante puntual — para reconciliar un
 * estado ambiguo antes de rendirse a revisión manual. Ver el docblock de
 * `feCompConsultar` en wsfe.ts para el porqué.
 */
export async function consultarComprobante(
  admin: SupabaseClient,
  empresaId: string,
  cuit: string,
  certPem: string,
  keyPem: string,
  environment: 'production' | 'sandbox',
  pvNumero: number,
  voucherType: number,
  cbteNro: number,
): Promise<CompConsultaResult | null> {
  const ta = await getValidTA(admin, empresaId, environment, certPem, keyPem);
  const auth: WsfeAuth = { token: ta.token, sign: ta.sign, cuit };
  return await feCompConsultar(environment, auth, pvNumero, voucherType, cbteNro);
}

/**
 * Emite el CAE de un comprobante contra ARCA.
 * 1. Obtiene TA (cacheado), 2. consulta último número, 3. emite el siguiente.
 * Lanza Error si AFIP rechaza (el caller clasifica con classifyArcaError).
 */
export async function callArcaEmit(
  admin: SupabaseClient,
  params: ArcaEmitParams,
): Promise<ArcaEmitResult> {
  const ta = await getValidTA(admin, params.empresaId, params.environment, params.certPem, params.keyPem);
  const auth: WsfeAuth = { token: ta.token, sign: ta.sign, cuit: params.cuit };

  // Próximo número real (nunca el contador local)
  const ultimo = await feCompUltimoAutorizado(params.environment, auth, params.pvNumero, params.voucherType);
  const cbteNro = ultimo + 1;

  // Letra C (Factura 11, ND 12, NC 13) no discrimina IVA: ImpNeto = ImpTotal, ImpIVA = 0, sin nodo Iva.
  const esClaseC = [11, 12, 13].includes(params.voucherType);
  const impNeto = esClaseC ? params.total : params.neto;
  const impIVA  = esClaseC ? 0 : params.iva;
  const ivaId   = esClaseC ? null : ivaIdFromPct(params.iva > 0 && params.neto > 0
    ? Math.round((params.iva / params.neto) * 1000) / 10
    : 21);

  // NOTA (10/08, homologación): se probó y se descartó un fallback que ante
  // [10016] reintentaba inmediatamente con ultimo+2 ("¿el número de al lado
  // quedó quemado?") — confirmado en vivo que NO resuelve: ultimo+2 también
  // fue rechazado por ARCA para los mismos 3 comprobantes de prueba. No es
  // un único número bloqueado, es algo más profundo del lado de ARCA (o una
  // ventana de tiempo mucho más larga de la esperada) — no vale la pena
  // saltar números a ciegas sin evidencia de que ayude. classifyArcaError sí
  // clasifica [10016] como 'ambiguous' (reintenta con backoff en vez de
  // quedar en error_datos esperando reencolado manual) — ver ese comentario.
  const result = await feCAESolicitar(params.environment, auth, {
    ptoVta:   params.pvNumero,
    cbteTipo: params.voucherType,
    concepto: 1,
    docTipo:  params.customerDocType,
    docNro:   params.customerDocNro,
    cbteNro,
    cbteFch:  params.issueDate,
    impTotal: params.total,
    impNeto,
    impIVA,
    ivaId,
    condicionIVAReceptorId: condicionIvaReceptorId(params.customerCondicionIva, params.customerDocType),
    cbteAsoc: params.cbteAsoc,
  });

  return {
    cae:               result.cae,
    caeExpirationDate: fchToIso(result.caeVto),
    numeroCorrelativo: result.cbteNro,
  };
}

/**
 * Clasifica el error de ARCA para decidir si reintentar.
 * 'transient' → red/timeout/ARCA caído → reintentar con backoff.
 * 'data'      → ARCA rechazó por dato inválido → no reintentar.
 * 'ambiguous' → timeout sin respuesta → verificar antes de reintentar.
 */
export function classifyArcaError(errorMessage: string): 'transient' | 'data' | 'ambiguous' {
  const msg = errorMessage.toLowerCase();

  // [10016] "El numero o fecha del comprobante no se corresponde con el
  // proximo a autorizar" — confirmado en vivo (10/08, homologación) que NO
  // es un dato inválido irrecuperable: 3 comprobantes lo repitieron de forma
  // consistente incluso con el pre-check de ambigüedad ya resuelto (lastNumber
  // == esperado localmente), o sea que en el momento exacto de FECAESolicitar
  // el estado interno de ARCA todavía no coincidía con lo que acababa de
  // reportar FECompUltimoAutorizado segundos antes — un desincronismo
  // transitorio del lado de ARCA, no un error de nuestros datos. Se saca de
  // la familia 1001x (que sí son datos inválidos genuinos) para que
  // reintente solo con backoff en vez de quedar en error_datos esperando
  // reencolado manual cada vez.
  if (/\b10016\b/.test(msg)) {
    return 'ambiguous';
  }

  // Rechazo explícito de WSFE por datos del comprobante
  if (
    msg.includes('rechazó el comprobante') ||
    msg.includes('rechazo el comprobante') ||
    msg.includes('dato inv') ||
    msg.includes('cuit inv') ||
    msg.includes('punto de venta') ||
    msg.includes('comprobante inv') ||
    msg.includes('no autorizado') ||
    msg.includes('certificado') ||
    msg.includes('error_datos') ||
    /\b1000[0-9]\b/.test(msg) ||
    /\b1001[0-9]\b/.test(msg)
  ) {
    return 'data';
  }
  if (msg.includes('timeout') || msg.includes('timed out')) {
    return 'ambiguous';
  }
  return 'transient';
}

/** Backoff exponencial por número de intento (0-based): [1,5,15,30,60] min. */
export function backoffMinutes(intentos: number): number {
  const SCHEDULE = [1, 5, 15, 30, 60];
  return SCHEDULE[intentos] ?? 60;
}

// ── Traducción de errores AFIP a lenguaje humano (Fase 3 del plan de robustez) ──
// Solo códigos con evidencia directa de haber ocurrido en producción de KAIROX
// (documentados en los comentarios de este mismo archivo y de arca-worker) —
// deliberadamente NO se completa con códigos "probablemente correctos" sin
// verificar: un mensaje mal traducido en un sistema fiscal es peor que uno
// crudo. Ante cualquier código/fragmento no reconocido, mensajeHumano()
// devuelve el mensaje original sin pérdida de información.
const CODIGOS_AFIP_HUMANO: Record<string, string> = {
  '10016': 'El número de comprobante quedó momentáneamente desincronizado con ARCA. El sistema lo reintenta e intenta resolverlo solo — no hace falta que hagas nada todavía.',
  '10197': 'A esta Nota de Crédito/Débito le falta el vínculo con la factura que le dio origen, o esa factura todavía no tiene CAE. Revisala antes de reintentar.',
  '10246': 'Al cliente le falta la condición frente al IVA (Responsable Inscripto, Monotributo, Exento, etc.). Completala en su ficha y reintentá.',
  '15008': 'Todavía no hay un CAEA habilitado para este período. Solicitalo desde Configuración → Facturación antes de usar la contingencia offline.',
  '15004': 'Ya existe un CAEA solicitado para este período — no hace falta pedir otro.',
};

// Variantes de CODIGOS_AFIP_HUMANO para cuando el sistema YA se rindió (agotó los 5
// reintentos automáticos) — sólo hace falta redefinir los códigos cuyo texto normal habla en
// presente de un reintento que todavía está en curso (ej. 10016 dice "no hace falta que hagas
// nada todavía"), porque ese texto queda contradictorio al lado de "reintentos agotados" en el
// mismo panel del Monitor (hallado por Nadia probando en vivo, 11/08). Los códigos que ya son
// accionables de por sí (10197, 10246, etc.) no necesitan variante — se usan tal cual.
const CODIGOS_AFIP_HUMANO_AGOTADO: Record<string, string> = {
  '10016': 'El número de comprobante siguió desincronizado con ARCA después de 5 reintentos automáticos. Puede resolverse solo con el tiempo (reintentá manualmente más tarde desde acá), o puede requerir confirmar el estado real a mano en el portal de ARCA.',
};

// Fragmentos de texto (no ligados a un código puntual) que ya clasifica
// classifyArcaError() como 'data' — mismo criterio, traducidos.
const FRAGMENTOS_AFIP_HUMANO: Array<[RegExp, string]> = [
  [/certificado/i, 'Hay un problema con el certificado digital de AFIP de la empresa. Avisá a soporte antes de seguir facturando.'],
  [/cuit inv/i, 'El CUIT del cliente no es válido para AFIP. Revisá el documento cargado en su ficha.'],
  [/punto de venta/i, 'El punto de venta no está habilitado en AFIP para este tipo de comprobante. Revisalo en el portal de ARCA.'],
  [/comprobante inv/i, 'ARCA rechazó el comprobante por un dato inválido. Revisá el detalle técnico para más precisión.'],
  [/no autorizado/i, 'ARCA no autorizó este comprobante. Revisá el detalle técnico para saber por qué.'],
];

/**
 * Traduce un mensaje de error crudo de ARCA (o nuestro) a una frase que
 * un usuario no técnico pueda entender y accionar. Nunca lanza, nunca
 * pierde información: si no reconoce el código/fragmento, devuelve el
 * mensaje original tal cual.
 */
export function mensajeHumano(raw: string, opts?: { agotado?: boolean }): string {
  const codigo = raw.match(/\[(\d+)\]/)?.[1];
  if (codigo && opts?.agotado && CODIGOS_AFIP_HUMANO_AGOTADO[codigo]) {
    return CODIGOS_AFIP_HUMANO_AGOTADO[codigo];
  }
  if (codigo && CODIGOS_AFIP_HUMANO[codigo]) return CODIGOS_AFIP_HUMANO[codigo];
  for (const [patron, msg] of FRAGMENTOS_AFIP_HUMANO) {
    if (patron.test(raw)) return msg;
  }
  return raw;
}
