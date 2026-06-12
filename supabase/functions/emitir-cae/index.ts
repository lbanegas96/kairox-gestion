// supabase/functions/emitir-cae/index.ts
// Emite el CAE (Código de Autorización Electrónico) de un comprobante vía ARCA/AFIP (WSFE).
// Fase 1: homologación (sandbox). IVA hardcodeado al 21% — se calculará por item en Fase 2.
//
// Flujo: lee cert + clave privada desde Vault → llama a ARCA via @nicoo01x/arca-sdk →
//        guarda CAE en comprobantes → incrementa el correlativo del punto de venta.
//
// NOTA: @nicoo01x/arca-sdk depende de paquetes Node-only (soap) que NO cargan en el
// runtime Edge (Deno) a nivel de módulo top-level → boot error. Por eso se importa de
// forma DINÁMICA (await import) recién en el momento de emitir, aislando esa
// incompatibilidad a la ruta de código que realmente la necesita. El resto de la
// función (auth, Vault, lecturas/escrituras DB) bootea y funciona normalmente.
import { buildCorsHeaders, verifyAdmin, adminClient } from '../_shared/auth.ts';

/** Mapea el tipo de comprobante KAIROX (A/B/C) al código AFIP de WSFE. */
function voucherTypeAfip(tipo: string): number {
  if (tipo === 'A') return 1;   // Factura A
  if (tipo === 'C') return 11;  // Factura C
  return 6;                     // Factura B (default)
}

/** Mapea la alícuota IVA KAIROX (string) al porcentaje numérico para WSFE. */
function alicuotaPct(alicuota: string | null): number {
  if (alicuota === '10.5') return 10.5;
  if (alicuota === '0' || alicuota === 'exento' || alicuota === 'no_gravado') return 0;
  return 21; // default / '21'
}

/** Determina tipo de documento AFIP a partir del documento del receptor. */
function docTipoAfip(documento: string | null): { tipo: number; nro: string } {
  const d = (documento ?? '').replace(/\D/g, '');
  if (d.length === 11) return { tipo: 80, nro: d };  // 80 = CUIT
  if (d.length >= 7 && d.length <= 8) return { tipo: 96, nro: d }; // 96 = DNI
  return { tipo: 99, nro: '0' };                     // 99 = Consumidor Final
}

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  let comprobanteId: string | undefined;

  try {
    const body = await req.json().catch(() => ({}));
    comprobanteId = body.comprobante_id;
    if (!comprobanteId) throw new Error('comprobante_id requerido');

    // ── Autenticación: solo admin de la empresa ──────────────────────────────
    const auth = await verifyAdmin(req);
    if (!auth.ok || !auth.empresaId) {
      return new Response(JSON.stringify({ error: auth.error ?? 'No autorizado' }), {
        status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // ── 1. Comprobante (scoping por empresa del caller) ──────────────────────
    const { data: comp, error: compError } = await adminClient
      .from('comprobantes')
      .select('id, numero_venta, fecha, total, neto_gravado, iva_discriminado, cliente_id, cliente_nombre, tipo_comprobante_afip, punto_venta_id, empresa_id')
      .eq('id', comprobanteId)
      .eq('empresa_id', auth.empresaId)
      .single();
    if (compError || !comp) throw new Error('Comprobante no encontrado');

    // ── 1b. Items del comprobante (con alícuota IVA por línea) ────────────────
    const { data: compItems } = await adminClient
      .from('comprobante_items')
      .select('cantidad, precio_unitario, subtotal, alicuota_iva')
      .eq('comprobante_id', comprobanteId)
      .eq('empresa_id', auth.empresaId);

    // ── 2. Empresa (datos fiscales) ──────────────────────────────────────────
    const { data: empresa, error: empError } = await adminClient
      .from('empresas')
      .select('afip_cuit, condicion_iva, usa_factura_electronica')
      .eq('id', comp.empresa_id)
      .single();
    if (empError || !empresa) throw new Error('Empresa no encontrada');
    if (!empresa.usa_factura_electronica) throw new Error('La empresa no tiene factura electrónica activada');
    if (!empresa.afip_cuit) throw new Error('La empresa no tiene CUIT AFIP configurado');

    // ── 3. Cliente (receptor) — consulta separada, sin embedded select ───────
    let cliDocumento: string | null = null;
    if (comp.cliente_id) {
      const { data: cli } = await adminClient
        .from('clientes')
        .select('documento, condicion_iva')
        .eq('id', comp.cliente_id)
        .single();
      cliDocumento = cli?.documento ?? null;
    }

    // ── 4. Punto de venta + correlativo ──────────────────────────────────────
    if (!comp.punto_venta_id) throw new Error('Comprobante sin punto de venta asignado');
    const { data: pv, error: pvError } = await adminClient
      .from('puntos_venta')
      .select('numero, ultimo_numero_a, ultimo_numero_b, ultimo_numero_c')
      .eq('id', comp.punto_venta_id)
      .single();
    if (pvError || !pv) throw new Error('Punto de venta no encontrado');

    const tipoComp = comp.tipo_comprobante_afip ?? 'B';
    const ultimoNum = tipoComp === 'A' ? pv.ultimo_numero_a
      : tipoComp === 'C' ? pv.ultimo_numero_c
      : pv.ultimo_numero_b;
    const nuevoNumero = (ultimoNum ?? 0) + 1;

    // ── 5. Certificado + clave privada desde Vault ───────────────────────────
    const { data: certPem } = await adminClient.rpc('vault_secret_read', { p_name: `afip_cert_${comp.empresa_id}` });
    const { data: keyPem }  = await adminClient.rpc('vault_secret_read', { p_name: `afip_key_${comp.empresa_id}` });
    if (!certPem || !keyPem) {
      throw new Error('Certificados AFIP no configurados. Generá el CSR y subí el .crt de ARCA.');
    }

    // ── 6. Llamar a ARCA (WSFE) ──────────────────────────────────────────────
    // Import dinámico: aísla la (in)compatibilidad del SDK Node-only al runtime.
    const { ArcaClient } = await import('npm:@nicoo01x/arca-sdk@3');
    const isProduction = Deno.env.get('AFIP_ENVIRONMENT') === 'production';
    const client = new ArcaClient({
      cuit: empresa.afip_cuit,
      cert: certPem,
      privateKey: keyPem,
      environment: isProduction ? 'production' : 'sandbox',
    });

    const { tipo: docTipo, nro: docNro } = docTipoAfip(cliDocumento);
    const totalNum = Number(comp.total);
    const round2 = (n: number) => Math.round(n * 100) / 100;

    // Construir items con su alícuota IVA real. Si no hay items (caso borde),
    // fallback a un único ítem al 21% sobre el total (comportamiento previo).
    let wsfeItems;
    let neto: number;
    let iva: number;

    if (compItems && compItems.length > 0) {
      let netoAcum = 0;
      let ivaAcum  = 0;
      wsfeItems = compItems.map((it) => {
        const pct      = alicuotaPct(it.alicuota_iva);
        const subtotal = Number(it.subtotal);
        const factor   = pct / 100;
        const itemNeto = factor > 0 ? subtotal / (1 + factor) : subtotal;
        const itemIva  = subtotal - itemNeto;
        netoAcum += itemNeto;
        ivaAcum  += itemIva;
        return {
          description: `Venta #${comp.numero_venta}`,
          quantity: Number(it.cantidad),
          unitPrice: Number(it.precio_unitario),
          ivaAliquot: pct,
        };
      });
      // Preferir los totales discriminados ya persistidos por la RPC; si no, los acumulados.
      neto = comp.neto_gravado != null ? Number(comp.neto_gravado) : round2(netoAcum);
      iva  = comp.iva_discriminado != null ? Number(comp.iva_discriminado) : round2(ivaAcum);
    } else {
      neto = comp.neto_gravado != null ? Number(comp.neto_gravado) : round2(totalNum / 1.21);
      iva  = comp.iva_discriminado != null ? Number(comp.iva_discriminado) : round2(totalNum - neto);
      wsfeItems = [{
        description: `Venta #${comp.numero_venta}`,
        quantity: 1,
        unitPrice: totalNum,
        ivaAliquot: 21,
      }];
    }

    const invoiceResult = await client.invoice?.createInvoice({
      pointOfSale: pv.numero,
      voucherType: voucherTypeAfip(tipoComp),
      concept: 1,                       // 1 = Productos
      customerDocumentType: docTipo,
      customerDocumentNumber: docNro,
      issueDate: new Date(comp.fecha).toISOString().slice(0, 10).replace(/-/g, ''),
      currency: 'PES',
      currencyRate: 1,
      items: wsfeItems,
      totals: { netAmount: neto, ivaAmount: iva, totalAmount: totalNum },
    });

    if (!invoiceResult?.cae) throw new Error('AFIP no retornó CAE');

    // ── 7. Persistir CAE + correlativo ───────────────────────────────────────
    const numeroAfip = `${String(pv.numero).padStart(4, '0')}-${String(nuevoNumero).padStart(8, '0')}`;
    await adminClient.from('comprobantes').update({
      cae:             invoiceResult.cae,
      cae_vencimiento: invoiceResult.caeExpirationDate ?? null,
      cae_estado:      'emitido',
      numero_afip:     numeroAfip,
      error_afip:      null,
    }).eq('id', comprobanteId);

    const campoUltimo = tipoComp === 'A' ? 'ultimo_numero_a'
      : tipoComp === 'C' ? 'ultimo_numero_c' : 'ultimo_numero_b';
    await adminClient.from('puntos_venta')
      .update({ [campoUltimo]: nuevoNumero })
      .eq('id', comp.punto_venta_id);

    return new Response(
      JSON.stringify({
        success: true,
        cae: invoiceResult.cae,
        numero_afip: numeroAfip,
        vencimiento: invoiceResult.caeExpirationDate ?? null,
      }),
      { headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    // Registrar el error en el comprobante para retry posterior.
    if (comprobanteId) {
      await adminClient.from('comprobantes').update({
        cae_estado: 'error',
        error_afip: (err as Error).message,
      }).eq('id', comprobanteId);
    }
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }
});
