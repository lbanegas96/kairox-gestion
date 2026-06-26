/**
 * WSAA — Web Service de Autenticación y Autorización de AFIP/ARCA.
 * Implementación manual (sin SDK): construye el TRA, lo firma con CMS/PKCS#7
 * vía node-forge, lo envía a LoginCms y parsea el Ticket de Acceso (TA).
 *
 * El SDK @nicoo01x/arca-sdk armaba mal el TRA (ponía <service> dentro de <header>),
 * causando "No se ha podido interpretar el XML contra el SCHEMA". Verificado sesión 63.
 *
 * El TA (token+sign) dura ~12h. Se cachea en la tabla afip_tickets por (empresa_id,
 * service) porque AFIP rechaza pedir un TA nuevo si ya hay uno válido.
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const WSAA_URLS: Record<string, string> = {
  production: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
  sandbox:    'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
};

export interface TA {
  token: string;
  sign: string;
}

/** Formatea un Date en horario AR (-03:00) cumpliendo xsd:dateTime de AFIP. */
function fmtAR(date: Date): string {
  const local = new Date(date.getTime() - 3 * 60 * 60 * 1000);
  return local.toISOString().slice(0, 19) + '-03:00';
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Login directo contra WSAA: devuelve {token, sign, expiration}. */
async function loginWSAA(
  environment: 'production' | 'sandbox',
  certPem: string,
  keyPem: string,
  service: string,
): Promise<{ token: string; sign: string; expiration: string }> {
  const forgeMod = await import('https://esm.sh/node-forge@1.3.1');
  // deno-lint-ignore no-explicit-any
  const forge: any = (forgeMod as any).default ?? forgeMod;

  // 1. Construir TRA — <service> es hijo directo de loginTicketRequest (NO del header)
  const now = new Date();
  const tra =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<loginTicketRequest version="1.0">` +
    `<header>` +
    `<uniqueId>${Math.floor(now.getTime() / 1000)}</uniqueId>` +
    `<generationTime>${fmtAR(new Date(now.getTime() - 600000))}</generationTime>` +
    `<expirationTime>${fmtAR(new Date(now.getTime() + 600000))}</expirationTime>` +
    `</header>` +
    `<service>${service}</service>` +
    `</loginTicketRequest>`;

  // 2. Firmar CMS (PKCS#7 SignedData) con cert + clave privada
  const cert = forge.pki.certificateFromPem(certPem);
  const key = forge.pki.privateKeyFromPem(keyPem);
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(tra, 'utf8');
  p7.addCertificate(cert);
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: now },
    ],
  });
  p7.sign();
  const cmsB64 = forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());

  // 3. SOAP LoginCms
  const soap =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">` +
    `<soapenv:Header/><soapenv:Body><wsaa:loginCms><wsaa:in0>${cmsB64}</wsaa:in0></wsaa:loginCms></soapenv:Body></soapenv:Envelope>`;

  const resp = await fetch(WSAA_URLS[environment], {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '' },
    body: soap,
  });
  const text = await resp.text();

  const fault = text.match(/<faultstring>([\s\S]*?)<\/faultstring>/)?.[1];
  if (fault) throw new Error(`WSAA: ${unescapeXml(fault)}`);

  const ticketXml = unescapeXml(text.match(/<loginCmsReturn>([\s\S]*?)<\/loginCmsReturn>/)?.[1] ?? '');
  const token = ticketXml.match(/<token>([\s\S]*?)<\/token>/)?.[1] ?? '';
  const sign = ticketXml.match(/<sign>([\s\S]*?)<\/sign>/)?.[1] ?? '';
  const expiration = ticketXml.match(/<expirationTime>([\s\S]*?)<\/expirationTime>/)?.[1] ?? '';

  if (!token || !sign) throw new Error('WSAA: respuesta sin token/sign');
  return { token, sign, expiration };
}

/**
 * Devuelve un TA válido para (empresa, service), usando cache en afip_tickets.
 * Si el cacheado expira en <5min o no existe, pide uno nuevo a WSAA y lo guarda.
 */
export async function getValidTA(
  admin: SupabaseClient,
  empresaId: string,
  environment: 'production' | 'sandbox',
  certPem: string,
  keyPem: string,
  service = 'wsfe',
): Promise<TA> {
  // 1. Buscar TA cacheado con al menos 5 min de margen
  const margen = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const { data: cached } = await admin
    .from('afip_tickets')
    .select('token, sign, expiration_time')
    .eq('empresa_id', empresaId)
    .eq('service', service)
    .gt('expiration_time', margen)
    .maybeSingle();

  if (cached?.token && cached?.sign) {
    return { token: cached.token, sign: cached.sign };
  }

  // 2. Pedir uno nuevo y cachearlo
  const ta = await loginWSAA(environment, certPem, keyPem, service);
  await admin.from('afip_tickets').upsert(
    {
      empresa_id: empresaId,
      service,
      token: ta.token,
      sign: ta.sign,
      expiration_time: ta.expiration,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'empresa_id,service' },
  );

  return { token: ta.token, sign: ta.sign };
}
