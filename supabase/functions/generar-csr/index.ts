import { buildCorsHeaders, verifyAdmin, adminClient } from '../_shared/auth.ts';

// ── ASN.1 / DER helpers (sin dependencias externas) ─────────────────────────
// Genera un CSR PKCS#10 minimal usando solo Web Crypto (nativo en Deno).
// Compatible con los requisitos de ARCA/AFIP: RSA-2048, SHA-256, Subject DN con serialNumber.
//
// IMPORTANTE (drift resuelto sesión 67): esta implementación manual es la que
// corre en producción (v6) y la que generó los certificados reales que emiten
// facturas (verificado: la clave privada de Nalux en Vault se creó 4 min después
// del deploy de esta versión). Una implementación alternativa con @peculiar/x509
// quedó en el repo sin desplegarse nunca — se descartó por esta.

const RSA_ALG: RsaHashedKeyGenParams = {
  name: 'RSASSA-PKCS1-v1_5',
  hash: 'SHA-256',
  publicExponent: new Uint8Array([1, 0, 1]),
  modulusLength: 2048,
};

function concat(...arrays: Uint8Array[]): Uint8Array {
  const len = arrays.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(len);
  let offset = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.length; }
  return out;
}

function derLen(len: number): Uint8Array {
  if (len < 0x80) return new Uint8Array([len]);
  if (len < 0x100) return new Uint8Array([0x81, len]);
  return new Uint8Array([0x82, len >> 8, len & 0xff]);
}

function derTLV(tag: number, value: Uint8Array): Uint8Array {
  return concat(new Uint8Array([tag]), derLen(value.length), value);
}

function derSeq(value: Uint8Array): Uint8Array   { return derTLV(0x30, value); }
function derSet(value: Uint8Array): Uint8Array    { return derTLV(0x31, value); }
function derBitStr(value: Uint8Array): Uint8Array { return derTLV(0x03, concat(new Uint8Array([0x00]), value)); }
function derNull(): Uint8Array                   { return new Uint8Array([0x05, 0x00]); }
function derOID(oid: number[]): Uint8Array {
  const bytes: number[] = [];
  bytes.push(oid[0] * 40 + oid[1]);
  for (let i = 2; i < oid.length; i++) {
    let v = oid[i];
    const parts: number[] = [];
    parts.push(v & 0x7f);
    v >>= 7;
    while (v > 0) { parts.unshift((v & 0x7f) | 0x80); v >>= 7; }
    bytes.push(...parts);
  }
  return derTLV(0x06, new Uint8Array(bytes));
}
function derUTF8(s: string): Uint8Array {
  return derTLV(0x0c, new TextEncoder().encode(s));
}
function derPrintable(s: string): Uint8Array {
  return derTLV(0x13, new TextEncoder().encode(s));
}
function derInt(v: Uint8Array): Uint8Array { return derTLV(0x02, v); }

// OIDs necesarios
const OID_RSA_ENCRYPTION = [1, 2, 840, 113549, 1, 1, 1];
const OID_SHA256_WITH_RSA = [1, 2, 840, 113549, 1, 1, 11];
const OID_COUNTRY = [2, 5, 4, 6];
const OID_ORG    = [2, 5, 4, 10];
const OID_CN     = [2, 5, 4, 3];
const OID_SERIAL = [2, 5, 4, 5];

function rdnAttr(oid: number[], valueTag: Uint8Array): Uint8Array {
  return derSet(derSeq(concat(derOID(oid), valueTag)));
}

function buildSubject(country: string, org: string, cn: string, serialNum: string): Uint8Array {
  return derSeq(concat(
    rdnAttr(OID_COUNTRY, derPrintable(country)),
    rdnAttr(OID_ORG,     derUTF8(org)),
    rdnAttr(OID_CN,      derUTF8(cn)),
    rdnAttr(OID_SERIAL,  derPrintable(serialNum)),
  ));
}

function derToPem(der: Uint8Array, label: string): string {
  const b64 = btoa(String.fromCharCode(...der));
  const lines = b64.match(/.{1,64}/g)?.join('\n') ?? b64;
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----\n`;
}

async function generateCSR(cuit: string, razonSocial: string): Promise<{ csrPem: string; privateKeyPem: string }> {
  // 1. Generar par RSA-2048
  const keyPair = await crypto.subtle.generateKey(RSA_ALG, true, ['sign', 'verify']);

  // 2. Exportar clave publica (SPKI DER)
  const spkiDer = new Uint8Array(await crypto.subtle.exportKey('spki', keyPair.publicKey));

  // 3. Exportar clave privada (PKCS8 DER)
  const pkcs8Der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey));
  const privateKeyPem = derToPem(pkcs8Der, 'PRIVATE KEY');

  // 4. Construir CertificationRequestInfo
  const subject = buildSubject('AR', razonSocial, razonSocial, `CUIT ${cuit}`);

  // SubjectPublicKeyInfo ya viene en SPKI = SEQUENCE { AlgorithmIdentifier, BIT STRING }
  // Lo usamos directamente
  const spkiSeq = spkiDer; // ya es un SEQUENCE DER correcto

  // attributes [0] IMPLICIT = vacio para AFIP
  const attributes = new Uint8Array([0xa0, 0x00]);

  const version = derInt(new Uint8Array([0x00]));
  const certReqInfo = derSeq(concat(version, subject, spkiSeq, attributes));

  // 5. Firmar con la clave privada
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, keyPair.privateKey, certReqInfo)
  );

  // 6. Construir CertificationRequest
  const sigAlg = derSeq(concat(derOID(OID_SHA256_WITH_RSA), derNull()));
  const csr = derSeq(concat(certReqInfo, sigAlg, derBitStr(signature)));

  const csrPem = derToPem(csr, 'CERTIFICATE REQUEST');
  return { csrPem, privateKeyPem };
}

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  try {
    const auth = await verifyAdmin(req);
    if (!auth.ok || !auth.empresaId) {
      return new Response(JSON.stringify({ error: auth.error ?? 'No autorizado' }), {
        status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
    const empresaId = auth.empresaId;

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? 'generate');

    // ── store_cert: guarda el .crt de ARCA en Vault ───────────────────────────
    if (action === 'store_cert') {
      const certContent = String(body.cert_content ?? '').trim();
      if (!certContent || !certContent.includes('CERTIFICATE')) {
        return new Response(JSON.stringify({ error: 'Certificado .crt inválido o vacío' }), {
          status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
        });
      }
      const { error: certVaultError } = await adminClient.rpc('vault_secret_upsert', {
        p_name: `afip_cert_${empresaId}`,
        p_secret: certContent,
        p_description: `Certificado AFIP (.crt) — empresa ${empresaId}`,
      });
      if (certVaultError) throw certVaultError;
      return new Response(
        JSON.stringify({ success: true, message: 'Certificado guardado en Vault.' }),
        { headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }

    // ── generate: genera RSA-2048 + CSR PKCS#10 DER ──────────────────────────
    const cuit = String(body.cuit ?? '').replace(/\D/g, '');
    const razonSocial = String(body.razon_social ?? '').trim() || 'KAIROX';
    if (cuit.length !== 11) {
      return new Response(JSON.stringify({ error: 'CUIT inválido (se esperan 11 dígitos)' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const { csrPem, privateKeyPem } = await generateCSR(cuit, razonSocial);

    const { error: vaultError } = await adminClient.rpc('vault_secret_upsert', {
      p_name: `afip_key_${empresaId}`,
      p_secret: privateKeyPem,
      p_description: `Clave privada AFIP — empresa ${empresaId}`,
    });
    if (vaultError) throw vaultError;

    await adminClient.from('empresas').update({ afip_cuit: cuit }).eq('id', empresaId);

    return new Response(
      JSON.stringify({ success: true, csr: csrPem, message: 'CSR generado. Subilo a ARCA y volvé con el .crt emitido.' }),
      { headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[generar-csr] ERROR:', err);
    return new Response(
      JSON.stringify({ error: (err as Error).message ?? String(err) }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }
});
