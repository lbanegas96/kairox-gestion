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
}

export interface CaeResponse {
  cae: string;
  caeVto: string;       // YYYYMMDD
  cbteNro: number;
}

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
