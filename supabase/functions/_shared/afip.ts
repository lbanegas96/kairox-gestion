/**
 * Shared AFIP/ARCA helpers — usados por emitir-cae y arca-worker.
 * Contiene solo lógica pura (sin I/O, sin Supabase client).
 * El SDK de ARCA (@nicoo01x/arca-sdk) se importa dinámicamente en cada
 * función que lo necesite (es Node-only, no carga en Deno a nivel top-level).
 */

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

/** Determina tipo de documento AFIP a partir del documento del receptor. */
export function docTipoAfip(documento: string | null): { tipo: number; nro: string } {
  const d = (documento ?? '').replace(/\D/g, '');
  if (d.length === 11) return { tipo: 80, nro: d };   // 80 = CUIT
  if (d.length >= 7 && d.length <= 8) return { tipo: 96, nro: d }; // 96 = DNI
  return { tipo: 99, nro: '0' };                      // 99 = Consumidor Final
}

export interface ArcaEmitParams {
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
  caeExpirationDate: string | null;
  /** Número correlativo real que ARCA asignó (getLastVoucherNumber). */
  numeroCorrelativo: number;
}

/**
 * Consulta el último número de comprobante emitido en ARCA para un PdV y tipo.
 * Se usa ANTES de emitir en retry para verificar si ARCA ya procesó la solicitud
 * (caso de timeout sin respuesta — evita emitir duplicado).
 */
export async function getLastVoucherNumber(
  cuit: string,
  certPem: string,
  keyPem: string,
  environment: 'production' | 'sandbox',
  pvNumero: number,
  voucherType: number,
): Promise<number> {
  const { ArcaClient } = await import('npm:@nicoo01x/arca-sdk@3');
  const client = new ArcaClient({ cuit, cert: certPem, privateKey: keyPem, environment });
  const last = await client.invoice?.getLastVoucher(pvNumero, voucherType);
  return last?.number ?? 0;
}

/**
 * Llama a ARCA para emitir el comprobante.
 * Importa el SDK dinámicamente para aislar la incompatibilidad Node-only.
 * Lanza Error en cualquier caso de fallo (ARCA caído, datos inválidos, etc.).
 * El caller es responsable de clasificar el error según el mensaje.
 */
export async function callArcaEmit(params: ArcaEmitParams): Promise<ArcaEmitResult> {
  const { ArcaClient } = await import('npm:@nicoo01x/arca-sdk@3');
  const client = new ArcaClient({
    cuit:        params.cuit,
    cert:        params.certPem,
    privateKey:  params.keyPem,
    environment: params.environment,
  });

  const result = await client.invoice?.createInvoice({
    pointOfSale:            params.pvNumero,
    voucherType:            params.voucherType,
    concept:                1,
    customerDocumentType:   params.customerDocType,
    customerDocumentNumber: params.customerDocNro,
    issueDate:              params.issueDate,
    currency:               'PES',
    currencyRate:           1,
    items:                  params.items,
    totals: {
      netAmount:   params.neto,
      ivaAmount:   params.iva,
      totalAmount: params.total,
    },
  });

  if (!result?.cae) throw new Error('ARCA no retornó CAE');

  // Obtener el número correlativo real que ARCA usó
  const numeroCorrelativo = await getLastVoucherNumber(
    params.cuit, params.certPem, params.keyPem, params.environment,
    params.pvNumero, params.voucherType,
  );

  return {
    cae:               result.cae,
    caeExpirationDate: result.caeExpirationDate ?? null,
    numeroCorrelativo,
  };
}

/**
 * Clasifica el error de ARCA para decidir si reintentar o no.
 * 'transient' → ARCA caído/timeout → reintentar con backoff.
 * 'data'      → ARCA rechazó por dato inválido → no reintentar, usuario debe corregir.
 * 'ambiguous' → timeout sin respuesta → consultar getLastVoucherNumber antes de reintentar.
 */
export function classifyArcaError(errorMessage: string): 'transient' | 'data' | 'ambiguous' {
  const msg = errorMessage.toLowerCase();
  // Errores de datos que ARCA devuelve explícitamente (códigos de error WSFE)
  if (
    msg.includes('dato inv') ||
    msg.includes('cuit inválido') ||
    msg.includes('punto de venta inexistente') ||
    msg.includes('comprobante inválido') ||
    msg.includes('no autorizado') ||
    msg.includes('certificado') ||
    msg.includes('error_datos') ||
    msg.includes('10000') || // código error WSFE negocio
    msg.includes('10001') ||
    msg.includes('10002') ||
    msg.includes('10003') ||
    msg.includes('10004')
  ) {
    return 'data';
  }
  // Timeout sin respuesta clara → estado ambiguo
  if (msg.includes('timeout') || msg.includes('timed out')) {
    return 'ambiguous';
  }
  // Resto: ARCA caído, 503, network error → reintentar
  return 'transient';
}

/** Calcula el proximo_intento con backoff exponencial por número de intento (0-based). */
export function backoffMinutes(intentos: number): number {
  const SCHEDULE = [1, 5, 15, 30, 60];
  return SCHEDULE[intentos] ?? 60;
}
