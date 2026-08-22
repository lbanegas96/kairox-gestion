/**
 * arca-corregir-nc-historica — HERRAMIENTA DE UN SOLO USO, NO PERMANENTE.
 *
 * Emite ante ARCA (homologación) una NC correctiva (CbteTipo 8) que referencia
 * (CbteAsoc) al CAE de la "Factura" fantasma que quedó mal declarada por el
 * bug de voucherTypeAfip (ver _shared/afip.ts línea 19-27) — SOLO para estas
 * 4 NC históricas conocidas:
 *   NC-20260706-003, NC-20260707-001, NC-20260707-002, NC-20260728-002
 *
 * A propósito NO escribe nada en la base — ni comprobantes, ni
 * cuenta_corriente_movimientos, ni asientos. Esos efectos ya están bien
 * reflejados desde el comprobante original (que en KAIROX SIEMPRE fue
 * tipo='nota_credito' — el bug era solo en lo que se le mandaba a ARCA). Este
 * endpoint solo llama a ARCA y devuelve el resultado (CAE nuevo) para
 * registrarlo a mano — es deliberadamente "declarativo, sin efecto interno".
 *
 * Por eso NO reusa arca-worker (que sí calcula CbteAsoc.tipo a partir del
 * campo interno `origen.tipo`, lo cual daría 8 en vez de 6 acá — exactamente
 * el bug que estamos corrigiendo, ver hallazgo de la sesión 21/08).
 *
 * BORRAR esta función (y este archivo del repo) apenas se usa para las 4 NC
 * — no es parte del sistema, es una herramienta de limpieza puntual.
 */
import { adminClient } from '../_shared/auth.ts';
import { callArcaEmit, docTipoAfip } from '../_shared/afip.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200 });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const { comprobante_id } = await req.json();
    if (!comprobante_id) {
      return new Response(JSON.stringify({ error: 'Falta comprobante_id' }), { status: 400 });
    }

    const { data: comp, error: compErr } = await adminClient
      .from('comprobantes')
      .select('id, numero_venta, tipo, empresa_id, cliente_id, total, neto_gravado, iva_discriminado, tipo_comprobante_afip, punto_venta_id, numero_afip, cae')
      .eq('id', comprobante_id)
      .single();
    if (compErr || !comp) {
      return new Response(JSON.stringify({ error: 'Comprobante no encontrado' }), { status: 404 });
    }

    // Guard: solo comprobantes que YA tienen numero_afip/cae (ya autorizados
    // por ARCA con el bug) — nunca uno sin emitir.
    if (!comp.numero_afip || !comp.cae) {
      return new Response(JSON.stringify({ error: 'Este comprobante no tiene numero_afip/cae -- no es uno de los casos históricos' }), { status: 400 });
    }
    if (comp.tipo !== 'nota_credito') {
      return new Response(JSON.stringify({ error: 'Solo aplica a comprobantes tipo nota_credito' }), { status: 400 });
    }

    const [ptoVtaStr, nroStr] = comp.numero_afip.split('-');
    const ptoVtaNum = parseInt(ptoVtaStr, 10);
    const nroNum = parseInt(nroStr, 10);

    const { data: empresa } = await adminClient
      .from('empresas')
      .select('afip_cuit')
      .eq('id', comp.empresa_id)
      .single();
    if (!empresa?.afip_cuit) {
      return new Response(JSON.stringify({ error: 'CUIT AFIP no configurado' }), { status: 400 });
    }

    let docTipo = 99, docNro = '0', condicionIva: string | null = null;
    if (comp.cliente_id) {
      const { data: cli } = await adminClient
        .from('clientes')
        .select('documento, condicion_iva')
        .eq('id', comp.cliente_id)
        .single();
      const dt = docTipoAfip(cli?.documento ?? null);
      docTipo = dt.tipo;
      docNro = dt.nro;
      condicionIva = cli?.condicion_iva ?? null;
    }

    const { data: certPem } = await adminClient.rpc('vault_secret_read', { p_name: `afip_cert_${comp.empresa_id}` });
    const { data: keyPem } = await adminClient.rpc('vault_secret_read', { p_name: `afip_key_${comp.empresa_id}` });
    if (!certPem || !keyPem) {
      return new Response(JSON.stringify({ error: 'Certificados AFIP no configurados' }), { status: 400 });
    }

    const environment: 'production' | 'sandbox' = Deno.env.get('AFIP_ENVIRONMENT') === 'production' ? 'production' : 'sandbox';

    // voucherType 8 = Nota de Crédito B -- hardcodeado a propósito, los 4
    // casos conocidos son tipo_comprobante_afip='B'.
    const result = await callArcaEmit(adminClient, {
      empresaId: comp.empresa_id,
      cuit: empresa.afip_cuit,
      certPem,
      keyPem,
      environment,
      pvNumero: ptoVtaNum,
      voucherType: 8,
      issueDate: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
      customerDocType: docTipo,
      customerDocNro: docNro,
      customerCondicionIva: condicionIva,
      items: [],
      neto: Number(comp.neto_gravado),
      iva: Number(comp.iva_discriminado),
      total: Number(comp.total),
      // Acá está la corrección real: CbteAsoc.tipo=6 (Factura), NO 8 -- porque
      // lo que ARCA tiene registrado para este comprobante es una Factura B,
      // pese a que en KAIROX siempre fue tipo='nota_credito'.
      cbteAsoc: { tipo: 6, ptoVta: ptoVtaNum, nro: nroNum },
    });

    return new Response(JSON.stringify({
      origen: { numero_venta: comp.numero_venta, numero_afip_declarado_mal: comp.numero_afip, cae_original: comp.cae },
      correccion: result,
      nota: 'NADA se escribió en la base -- registrar este resultado a mano.',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
});
