/**
 * WSFE — Web Service de Factura Electrónica v1 de AFIP/ARCA.
 * Implementación manual (sin SDK): arma el SOAP, lo envía y parsea la respuesta.
 * Usa el TA (token+sign) obtenido de wsaa.ts.
 *
 * Métodos implementados:
 *   - feCompUltimoAutorizado: último número emitido para un PdV+tipo (FECompUltimoAutorizado)
 *   - feCAESolicitar:         emite el CAE de un comprobante (FECAESolicitar)
 */

const WSFE_URLS: Record<string, string> = {
  production: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
  sandbox:    'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
};

export interface WsfeAuth {
  token: string;
  sign: string;
  cuit: string;
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Extrae el contenido del primer tag <name>...</name> (sin namespace). */
function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? m[1] : null;
}

/** Junta todos los <Msg> dentro de un bloque (Errors u Observaciones). */
function collectMsgs(block: string | null): string {
  if (!block) return '';
  const msgs = [...block.matchAll(/<Msg>([\s\S]*?)<\/Msg>/g)].map((m) => unescapeXml(m[1].trim()));
  const codes = [...block.matchAll(/<Code>([\s\S]*?)<\/Code>/g)].map((m) => m[1].trim());
  return msgs.map((m, i) => (codes[i] ? `[${codes[i]}] ${m}` : m)).join(' | ');
}

const authBlock = (auth: WsfeAuth) =>
  `<ar:Auth><ar:Token>${auth.token}</ar:Token><ar:Sign>${auth.sign}</ar:Sign><ar:Cuit>${auth.cuit}</ar:Cuit></ar:Auth>`;

async function postSoap(environment: 'production' | 'sandbox', action: string, body: string): Promise<string> {
  const soap =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">` +
    `<soapenv:Header/><soapenv:Body>${body}</soapenv:Body></soapenv:Envelope>`;

  const resp = await fetch(WSFE_URLS[environment], {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': `http://ar.gov.afip.dif.FEV1/${action}`,
    },
    body: soap,
  });
  const text = await resp.text();

  const fault = text.match(/<faultstring>([\s\S]*?)<\/faultstring>/)?.[1];
  if (fault) throw new Error(`WSFE ${action}: ${unescapeXml(fault)}`);
  return text;
}

/** Último número de comprobante autorizado para un PdV y tipo. 0 si no hay ninguno. */
export async function feCompUltimoAutorizado(
  environment: 'production' | 'sandbox',
  auth: WsfeAuth,
  ptoVta: number,
  cbteTipo: number,
): Promise<number> {
  const body =
    `<ar:FECompUltimoAutorizado>${authBlock(auth)}` +
    `<ar:PtoVta>${ptoVta}</ar:PtoVta><ar:CbteTipo>${cbteTipo}</ar:CbteTipo>` +
    `</ar:FECompUltimoAutorizado>`;

  const text = await postSoap(environment, 'FECompUltimoAutorizado', body);

  const errors = collectMsgs(text.match(/<Errors>([\s\S]*?)<\/Errors>/)?.[1] ?? null);
  if (errors) throw new Error(`WSFE FECompUltimoAutorizado: ${errors}`);

  const nro = tag(text, 'CbteNro');
  return nro ? parseInt(nro, 10) : 0;
}

export interface CaeRequest {
  ptoVta: number;
  cbteTipo: number;
  concepto: number;     // 1 = productos
  docTipo: number;      // 80=CUIT, 96=DNI, 99=Consumidor Final
  docNro: string;
  cbteNro: number;      // número a emitir (CbteDesde = CbteHasta)
  cbteFch: string;      // YYYYMMDD
  impTotal: number;
  impNeto: number;
  impIVA: number;
  ivaId: number | null; // 5=21%, 4=10.5%, 3=0%; null = Factura C (sin discriminar IVA)
  condicionIVAReceptorId: number; // obligatorio desde RG 5616 (1=RI, 4=Exento, 5=CF, 6=Monotributo, 7=No Categorizado)
}

export interface CaeResponse {
  cae: string;
  caeVto: string;       // YYYYMMDD
  cbteNro: number;
}

// ── CAEA — Métodos de Código de Autorización Electrónica Anticipado ─────────

export interface CaeaResponse {
  caea: string;           // 14 dígitos
  periodo: string;        // YYYYMM
  orden: 1 | 2;
  fechaDesde: string;     // YYYY-MM-DD
  fechaHasta: string;     // YYYY-MM-DD
  fechaTopeInf: string;   // YYYY-MM-DD — último día para informar
  fechaProceso: string;   // YYYY-MM-DD
}

/**
 * FECAEASolicitar — solicita un CAEA para una quincena.
 * Error AFIP 15008 = "No existe CAEA para el período" (aún no habilitado).
 * Error AFIP 15004 = CAEA ya solicitado para ese periodo/orden.
 */
export async function feCAEASolicitar(
  environment: 'production' | 'sandbox',
  auth: WsfeAuth,
  ptoVta: number,
  cbteTipo: number,
): Promise<CaeaResponse> {
  const body =
    `<ar:FECAEASolicitar>${authBlock(auth)}` +
    `<ar:PtoVta>${ptoVta}</ar:PtoVta>` +
    `<ar:CbteTipo>${cbteTipo}</ar:CbteTipo>` +
    `</ar:FECAEASolicitar>`;

  const text = await postSoap(environment, 'FECAEASolicitar', body);

  const errors = collectMsgs(text.match(/<Errors>([\s\S]*?)<\/Errors>/)?.[1] ?? null);
  if (errors) throw new Error(`WSFE FECAEASolicitar: ${errors}`);

  const caea     = tag(text, 'CAEA');
  const periodo  = tag(text, 'Periodo');
  const orden    = tag(text, 'Orden');
  const fchDesde = tag(text, 'FchVigDesde');
  const fchHasta = tag(text, 'FchVigHasta');
  const fchTope  = tag(text, 'FchTopeInf');
  const fchProc  = tag(text, 'FchProceso');

  if (!caea) throw new Error('WSFE FECAEASolicitar: respuesta sin CAEA');

  return {
    caea,
    periodo:       periodo ?? '',
    orden:         (parseInt(orden ?? '1', 10) as 1 | 2),
    fechaDesde:    fchToIso(fchDesde ?? '') ?? '',
    fechaHasta:    fchToIso(fchHasta ?? '') ?? '',
    fechaTopeInf:  fchToIso(fchTope  ?? '') ?? '',
    fechaProceso:  fchToIso(fchProc  ?? '') ?? '',
  };
}

/**
 * FECAEAConsultar — consulta si existe CAEA para un periodo/orden.
 * Devuelve null si no hay CAEA para ese período.
 */
export async function feCAEAConsultar(
  environment: 'production' | 'sandbox',
  auth: WsfeAuth,
  periodo: string,
  orden: 1 | 2,
): Promise<CaeaResponse | null> {
  const body =
    `<ar:FECAEAConsultar>${authBlock(auth)}` +
    `<ar:Periodo>${periodo}</ar:Periodo>` +
    `<ar:Orden>${orden}</ar:Orden>` +
    `</ar:FECAEAConsultar>`;

  const text = await postSoap(environment, 'FECAEAConsultar', body);

  // Error 15008 = no existe CAEA → devolver null en vez de lanzar
  const errBlock = text.match(/<Errors>([\s\S]*?)<\/Errors>/)?.[1] ?? null;
  if (errBlock) {
    const code15008 = errBlock.includes('15008');
    if (code15008) return null;
    const errors = collectMsgs(errBlock);
    throw new Error(`WSFE FECAEAConsultar: ${errors}`);
  }

  const caea = tag(text, 'CAEA');
  if (!caea) return null;

  return {
    caea,
    periodo:      tag(text, 'Periodo') ?? periodo,
    orden:        (parseInt(tag(text, 'Orden') ?? String(orden), 10) as 1 | 2),
    fechaDesde:   fchToIso(tag(text, 'FchVigDesde') ?? '') ?? '',
    fechaHasta:   fchToIso(tag(text, 'FchVigHasta') ?? '') ?? '',
    fechaTopeInf: fchToIso(tag(text, 'FchTopeInf')  ?? '') ?? '',
    fechaProceso: fchToIso(tag(text, 'FchProceso')  ?? '') ?? '',
  };
}

export interface CaeaComprobanteItem {
  docTipo: number;
  docNro: string;
  cbteDesde: number;
  cbteHasta: number;
  cbteFch: string;    // YYYYMMDD
  impTotal: number;
  impNeto: number;
  impIVA: number;
  ivaId: number | null;
}

/**
 * FECAEAInformarComprobante — informa a AFIP comprobantes emitidos offline.
 * Envía hasta 250 detalles en un único request (batch).
 * Lanza Error si AFIP rechaza el batch completo.
 */
export async function feCAEAInformarComprobante(
  environment: 'production' | 'sandbox',
  auth: WsfeAuth,
  caea: string,
  ptoVta: number,
  cbteTipo: number,
  items: CaeaComprobanteItem[],
): Promise<void> {
  const f2 = (n: number) => n.toFixed(2);

  const detalles = items.map((it, i) => {
    const ivaNode = it.ivaId != null
      ? `<ar:Iva><ar:AlicIva><ar:Id>${it.ivaId}</ar:Id>` +
        `<ar:BaseImp>${f2(it.impNeto)}</ar:BaseImp>` +
        `<ar:Importe>${f2(it.impIVA)}</ar:Importe>` +
        `</ar:AlicIva></ar:Iva>`
      : '';

    return (
      `<ar:FECAEADetRequest>` +
      `<ar:Concepto>1</ar:Concepto>` +
      `<ar:DocTipo>${it.docTipo}</ar:DocTipo>` +
      `<ar:DocNro>${it.docNro}</ar:DocNro>` +
      `<ar:CbteDesde>${it.cbteDesde}</ar:CbteDesde>` +
      `<ar:CbteHasta>${it.cbteHasta}</ar:CbteHasta>` +
      `<ar:CbteFch>${it.cbteFch}</ar:CbteFch>` +
      `<ar:ImpTotal>${f2(it.impTotal)}</ar:ImpTotal>` +
      `<ar:ImpTotConc>0.00</ar:ImpTotConc>` +
      `<ar:ImpNeto>${f2(it.impNeto)}</ar:ImpNeto>` +
      `<ar:ImpOpEx>0.00</ar:ImpOpEx>` +
      `<ar:ImpIVA>${f2(it.impIVA)}</ar:ImpIVA>` +
      `<ar:ImpTrib>0.00</ar:ImpTrib>` +
      `<ar:MonId>PES</ar:MonId>` +
      `<ar:MonCotiz>1.00</ar:MonCotiz>` +
      ivaNode +
      `</ar:FECAEADetRequest>`
    );
  }).join('');

  const body =
    `<ar:FECAEAInformarComprobante>${authBlock(auth)}` +
    `<ar:FeCAEARegInfReq>` +
    `<ar:Id>1</ar:Id>` +
    `<ar:CAEA>${caea}</ar:CAEA>` +
    `<ar:PtoVta>${ptoVta}</ar:PtoVta>` +
    `<ar:CbteTipo>${cbteTipo}</ar:CbteTipo>` +
    `<ar:FeCAEADetRequest>${detalles}</ar:FeCAEADetRequest>` +
    `</ar:FeCAEARegInfReq>` +
    `</ar:FECAEAInformarComprobante>`;

  const text = await postSoap(environment, 'FECAEAInformarComprobante', body);

  const errors = collectMsgs(text.match(/<Errors>([\s\S]*?)<\/Errors>/)?.[1] ?? null);
  if (errors) throw new Error(`WSFE FECAEAInformarComprobante: ${errors}`);

  const resultado = tag(text, 'Resultado');
  if (resultado && resultado !== 'A') {
    const obs = collectMsgs(text.match(/<Observaciones>([\s\S]*?)<\/Observaciones>/)?.[1] ?? null);
    throw new Error(`WSFE FECAEAInformarComprobante rechazado (${resultado}): ${obs}`);
  }
}

/**
 * FECAEASinMovimiento — informa a AFIP que una quincena no tuvo movimiento.
 * Obligatorio si se solicitó un CAEA y no se emitió ningún comprobante con él.
 */
export async function feCAEASinMovimiento(
  environment: 'production' | 'sandbox',
  auth: WsfeAuth,
  caea: string,
  ptoVta: number,
  cbteTipo: number,
): Promise<void> {
  const body =
    `<ar:FECAEASinMovimiento>${authBlock(auth)}` +
    `<ar:Movi>` +
    `<ar:CAEA>${caea}</ar:CAEA>` +
    `<ar:PtoVta>${ptoVta}</ar:PtoVta>` +
    `<ar:CbteTipo>${cbteTipo}</ar:CbteTipo>` +
    `</ar:Movi>` +
    `</ar:FECAEASinMovimiento>`;

  const text = await postSoap(environment, 'FECAEASinMovimiento', body);

  const errors = collectMsgs(text.match(/<Errors>([\s\S]*?)<\/Errors>/)?.[1] ?? null);
  if (errors) throw new Error(`WSFE FECAEASinMovimiento: ${errors}`);
}

/** Convierte YYYYMMDD → YYYY-MM-DD (local, reutilizada por CAEA). */
function fchToIso(yyyymmdd: string): string | null {
  if (!yyyymmdd || yyyymmdd.length !== 8) return null;
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

// ── CAE (existente) ──────────────────────────────────────────────────────────

/** Emite el CAE de un comprobante. Lanza Error si AFIP lo rechaza (con el detalle). */
export async function feCAESolicitar(
  environment: 'production' | 'sandbox',
  auth: WsfeAuth,
  req: CaeRequest,
): Promise<CaeResponse> {
  const f2 = (n: number) => n.toFixed(2);

  // Nodo IVA solo para comprobantes que discriminan (A/B). Factura C → sin nodo.
  const ivaNode =
    req.ivaId != null
      ? `<ar:Iva><ar:AlicIva><ar:Id>${req.ivaId}</ar:Id>` +
        `<ar:BaseImp>${f2(req.impNeto)}</ar:BaseImp><ar:Importe>${f2(req.impIVA)}</ar:Importe>` +
        `</ar:AlicIva></ar:Iva>`
      : '';

  const body =
    `<ar:FECAESolicitar>${authBlock(auth)}` +
    `<ar:FeCAEReq>` +
    `<ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>${req.ptoVta}</ar:PtoVta><ar:CbteTipo>${req.cbteTipo}</ar:CbteTipo></ar:FeCabReq>` +
    `<ar:FeDetReq><ar:FECAEDetRequest>` +
    `<ar:Concepto>${req.concepto}</ar:Concepto>` +
    `<ar:DocTipo>${req.docTipo}</ar:DocTipo>` +
    `<ar:DocNro>${req.docNro}</ar:DocNro>` +
    `<ar:CbteDesde>${req.cbteNro}</ar:CbteDesde>` +
    `<ar:CbteHasta>${req.cbteNro}</ar:CbteHasta>` +
    `<ar:CbteFch>${req.cbteFch}</ar:CbteFch>` +
    `<ar:ImpTotal>${f2(req.impTotal)}</ar:ImpTotal>` +
    `<ar:ImpTotConc>0.00</ar:ImpTotConc>` +
    `<ar:ImpNeto>${f2(req.impNeto)}</ar:ImpNeto>` +
    `<ar:ImpOpEx>0.00</ar:ImpOpEx>` +
    `<ar:ImpIVA>${f2(req.impIVA)}</ar:ImpIVA>` +
    `<ar:ImpTrib>0.00</ar:ImpTrib>` +
    `<ar:MonId>PES</ar:MonId>` +
    `<ar:MonCotiz>1</ar:MonCotiz>` +
    `<ar:CondicionIVAReceptorId>${req.condicionIVAReceptorId}</ar:CondicionIVAReceptorId>` +
    ivaNode +
    `</ar:FECAEDetRequest></ar:FeDetReq>` +
    `</ar:FeCAEReq></ar:FECAESolicitar>`;

  const text = await postSoap(environment, 'FECAESolicitar', body);

  // Errores de nivel request
  const errors = collectMsgs(text.match(/<Errors>([\s\S]*?)<\/Errors>/)?.[1] ?? null);
  if (errors) throw new Error(`WSFE FECAESolicitar: ${errors}`);

  const resultado = tag(text, 'Resultado'); // A=aprobado, R=rechazado, P=parcial
  const cae = tag(text, 'CAE');
  const caeVto = tag(text, 'CAEFchVto');

  if (resultado !== 'A' || !cae) {
    const obs = collectMsgs(text.match(/<Observaciones>([\s\S]*?)<\/Observaciones>/)?.[1] ?? null);
    throw new Error(`WSFE rechazó el comprobante (Resultado=${resultado ?? '?'}): ${obs || 'sin detalle'}`);
  }

  return { cae, caeVto: caeVto ?? '', cbteNro: req.cbteNro };
}
