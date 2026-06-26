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
import { feCompUltimoAutorizado, feCAESolicitar, type WsfeAuth } from './wsfe.ts';

/** Mapea tipo interno KAIROX (A/B/C) al código AFIP de WSFE. */
export function voucherTypeAfip(tipo: string): number {
  if (tipo === 'A') return 1;   // Factura A
  if (tipo === 'C') return 11;  // Factura C
  return 6;                     // Factura B (default)
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
  items: Array<{ description: string; quantity: number; unitPrice: number; ivaAliquot: number }>;
  neto: number;
  iva: number;
  total: number;
}

export interface ArcaEmitResult {
  cae: string;
  caeExpirationDate: string | null;  // ISO YYYY-MM-DD
  numeroCorrelativo: number;
}

/** Convierte YYYYMMDD → YYYY-MM-DD (o null si vacío). */
function fchToIso(yyyymmdd: string): string | null {
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

  // Factura C (11) no discrimina IVA: ImpNeto = ImpTotal, ImpIVA = 0, sin nodo Iva.
  const esFacturaC = params.voucherType === 11;
  const impNeto = esFacturaC ? params.total : params.neto;
  const impIVA  = esFacturaC ? 0 : params.iva;
  const ivaId   = esFacturaC ? null : ivaIdFromPct(params.iva > 0 && params.neto > 0
    ? Math.round((params.iva / params.neto) * 1000) / 10
    : 21);

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
