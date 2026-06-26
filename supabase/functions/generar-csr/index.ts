// supabase/functions/generar-csr/index.ts
// Genera un par de claves RSA-2048 y un CSR (PKCS#10) para que el usuario lo
// suba a ARCA/AFIP. La clave PRIVADA se guarda en Supabase Vault y NUNCA sale
// al frontend — solo se devuelve el CSR en PEM.
//
// @peculiar/x509 usa Web Crypto (crypto.subtle), compatible con Deno/Edge runtime.
import * as x509 from 'https://esm.sh/@peculiar/x509@1.12.3';
import { buildCorsHeaders, verifyAdmin, adminClient } from '../_shared/auth.ts';

const RSA_ALG: RsaHashedKeyGenParams = {
  name: 'RSASSA-PKCS1-v1_5',
  hash: 'SHA-256',
  publicExponent: new Uint8Array([1, 0, 1]),
  modulusLength: 2048,
};

/** Convierte un ArrayBuffer DER a PEM con el label dado. */
function derToPem(der: ArrayBuffer, label: string): string {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  const lines = b64.match(/.{1,64}/g)?.join('\n') ?? b64;
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----\n`;
}

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  try {
    // ── Autenticación: solo admin de la empresa ──────────────────────────────
    const auth = await verifyAdmin(req);
    if (!auth.ok || !auth.empresaId) {
      return new Response(JSON.stringify({ error: auth.error ?? 'No autorizado' }), {
        status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
    const empresaId = auth.empresaId;

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? 'generate');

    // ── Acción store_cert: guarda el .crt emitido por ARCA en Vault ───────────
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

    // ── Acción generate (default): genera par RSA + CSR ───────────────────────
    const cuit = String(body.cuit ?? '').replace(/\D/g, '');
    const razonSocial = String(body.razon_social ?? '').trim() || 'KAIROX';
    if (cuit.length !== 11) {
      return new Response(JSON.stringify({ error: 'CUIT inválido (se esperan 11 dígitos)' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // ── Generar par de claves RSA-2048 ───────────────────────────────────────
    x509.cryptoProvider.set(crypto as unknown as Crypto);
    const keys = await crypto.subtle.generateKey(RSA_ALG, true, ['sign', 'verify']);

    // ── Construir CSR (PKCS#10) con el Subject DN que exige AFIP ──────────────
    //    C=AR, O=<razón social>, CN=<razón social>, serialNumber=CUIT <cuit>
    const csr = await x509.Pkcs10CertificateRequestGenerator.create({
      name: `C=AR, O=${razonSocial}, CN=${razonSocial}, serialNumber=CUIT ${cuit}`,
      keys,
      signingAlgorithm: RSA_ALG,
    });
    const csrPem = csr.toString('pem');

    // ── Exportar la clave privada (PKCS8 PEM) y guardarla en Vault ────────────
    const pkcs8 = await crypto.subtle.exportKey('pkcs8', keys.privateKey);
    const privateKeyPem = derToPem(pkcs8, 'PRIVATE KEY');

    const { error: vaultError } = await adminClient.rpc('vault_secret_upsert', {
      p_name: `afip_key_${empresaId}`,
      p_secret: privateKeyPem,
      p_description: `Clave privada AFIP — empresa ${empresaId}`,
    });
    if (vaultError) throw vaultError;

    // Persistir el CUIT en la empresa para no volver a pedirlo.
    await adminClient.from('empresas').update({ afip_cuit: cuit }).eq('id', empresaId);

    // ── Devolver SOLO el CSR (la clave privada queda en Vault) ────────────────
    return new Response(
      JSON.stringify({
        success: true,
        csr: csrPem,
        message: 'CSR generado. Subilo a ARCA y volvé con el .crt emitido.',
      }),
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
