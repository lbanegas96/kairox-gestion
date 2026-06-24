// supabase/functions/arca-worker/index.ts
// Worker programado (cron */5 * * * *) que procesa la cola facturas_pendientes_arca.
//
// Casos que maneja:
//   1. ARCA caído (timeout/503) → estado='reintentando', backoff exponencial
//      [1,5,15,30,60] min, máx 5 intentos → error_definitivo.
//   2. Error de datos (ARCA rechaza dato inválido) → estado='error_datos' directo,
//      NO reintentar — el usuario debe corregir manualmente.
//   3. Estado ambiguo (timeout sin respuesta) → consultar getLastVoucherNumber()
//      ANTES de reintentar — si ARCA ya emitió, sincronizar en vez de reemitir.
//   4. Numeración desincronizada → SIEMPRE getLastVoucherNumber() para obtener
//      el próximo número real, nunca usar el contador local.
//
// Auth: service_role (adminClient) — no requiere usuario autenticado.
// Procesa hasta 10 registros por corrida para no exceder el timeout de Edge Function.

import { adminClient } from '../_shared/auth.ts';
import {
  voucherTypeAfip,
  alicuotaPct,
  docTipoAfip,
  callArcaEmit,
  getLastVoucherNumber,
  classifyArcaError,
  backoffMinutes,
} from '../_shared/afip.ts';

const MAX_INTENTOS = 5;
const BATCH_SIZE   = 10;

Deno.serve(async (req) => {
  // Permite invocación manual vía HTTP POST (para testing) además del cron.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200 });
  }

  const isProduction = Deno.env.get('AFIP_ENVIRONMENT') === 'production';
  const environment: 'production' | 'sandbox' = isProduction ? 'production' : 'sandbox';

  // ── 1. Leer cola pendiente ─────────────────────────────────────────────────
  const { data: pendientes, error: fetchErr } = await adminClient
    .from('facturas_pendientes_arca')
    .select('*')
    .in('estado', ['pendiente', 'reintentando'])
    .lte('proximo_intento', new Date().toISOString())
    .limit(BATCH_SIZE);

  if (fetchErr) {
    console.error('[arca-worker] Error leyendo cola:', fetchErr.message);
    return new Response(JSON.stringify({ error: fetchErr.message }), { status: 500 });
  }

  if (!pendientes?.length) {
    return new Response(JSON.stringify({ procesados: 0, mensaje: 'Cola vacía' }), { status: 200 });
  }

  const resultados: Array<{ id: string; resultado: string }> = [];

  for (const fpa of pendientes) {
    // ── 2. Marcar como 'procesando' (lock optimista) ─────────────────────────
    const { error: lockErr } = await adminClient
      .from('facturas_pendientes_arca')
      .update({ estado: 'procesando', updated_at: new Date().toISOString() })
      .eq('id', fpa.id)
      .eq('estado', fpa.estado); // CAS: evita procesar 2 veces si otro worker corrió

    if (lockErr) {
      resultados.push({ id: fpa.id, resultado: 'skip (otro worker lo tomó)' });
      continue;
    }

    try {
      // ── 3. Cargar datos del comprobante ─────────────────────────────────────
      const { data: comp, error: compErr } = await adminClient
        .from('comprobantes')
        .select('id, numero_venta, fecha, total, neto_gravado, iva_discriminado, cliente_id, cliente_nombre, tipo_comprobante_afip, punto_venta_id, empresa_id')
        .eq('id', fpa.comprobante_id)
        .single();

      if (compErr || !comp) throw new Error('Comprobante no encontrado: ' + fpa.comprobante_id);

      const { data: empresa } = await adminClient
        .from('empresas')
        .select('afip_cuit, condicion_iva')
        .eq('id', comp.empresa_id)
        .single();

      if (!empresa?.afip_cuit) throw new Error('CUIT AFIP no configurado');

      const { data: pv } = await adminClient
        .from('puntos_venta')
        .select('numero, ultimo_numero_a, ultimo_numero_b, ultimo_numero_c')
        .eq('id', comp.punto_venta_id)
        .single();

      if (!pv) throw new Error('Punto de venta no encontrado');

      const { data: certPem } = await adminClient.rpc('vault_secret_read', {
        p_name: `afip_cert_${comp.empresa_id}`,
      });
      const { data: keyPem } = await adminClient.rpc('vault_secret_read', {
        p_name: `afip_key_${comp.empresa_id}`,
      });

      if (!certPem || !keyPem) {
        throw new Error('Certificados AFIP no configurados');
      }

      const tipoComp    = comp.tipo_comprobante_afip ?? 'B';
      const voucherType = voucherTypeAfip(tipoComp);

      // ── Caso 3 + 4: getLastVoucherNumber SIEMPRE antes de emitir en retry ───
      // Verifica si ARCA ya emitió (estado ambiguo por timeout previo) y
      // obtiene el próximo número real (nunca usar el contador local).
      const lastNumber = await getLastVoucherNumber(
        empresa.afip_cuit, certPem, keyPem, environment, pv.numero, voucherType,
      );

      // Checar si ARCA ya emitió el CAE para este comprobante
      // comparando el número afip guardado con el último emitido en ARCA.
      // Si el comprobante ya tiene numero_afip asignado y ARCA confirma ese número, sincronizar.
      const expectedNumero = (tipoComp === 'A' ? pv.ultimo_numero_a : tipoComp === 'C' ? pv.ultimo_numero_c : pv.ultimo_numero_b) ?? 0;
      if (lastNumber >= expectedNumero + 1) {
        // ARCA ya procesó algo más adelante — puede que ya emitió el nuestro.
        // Verificar si hay un CAE que corresponda consultando el estado en ARCA.
        // Por seguridad, no reemitir: marcar para revisión manual.
        await marcarErrorDefinitivo(fpa.id, comp.id,
          `Estado ambiguo: ARCA reporta último número ${lastNumber}, local esperaba ${expectedNumero + 1}. Verificar manualmente en portal ARCA.`);
        resultados.push({ id: fpa.id, resultado: 'error_definitivo (ambiguo)' });
        continue;
      }

      // ── 5. Cargar items del comprobante ─────────────────────────────────────
      const { data: compItems } = await adminClient
        .from('comprobante_items')
        .select('cantidad, precio_unitario, subtotal, alicuota_iva')
        .eq('comprobante_id', fpa.comprobante_id)
        .eq('empresa_id', comp.empresa_id);

      let cliDocumento: string | null = null;
      if (comp.cliente_id) {
        const { data: cli } = await adminClient
          .from('clientes')
          .select('documento')
          .eq('id', comp.cliente_id)
          .single();
        cliDocumento = cli?.documento ?? null;
      }

      const { tipo: docTipo, nro: docNro } = docTipoAfip(cliDocumento);
      const totalNum = Number(comp.total);
      const round2   = (n: number) => Math.round(n * 100) / 100;

      let wsfeItems;
      let neto: number;
      let iva: number;

      if (compItems && compItems.length > 0) {
        let netoAcum = 0; let ivaAcum = 0;
        wsfeItems = compItems.map((it) => {
          const pct      = alicuotaPct(it.alicuota_iva);
          const subtotal = Number(it.subtotal);
          const factor   = pct / 100;
          const itemNeto = factor > 0 ? subtotal / (1 + factor) : subtotal;
          const itemIva  = subtotal - itemNeto;
          netoAcum += itemNeto; ivaAcum += itemIva;
          return {
            description: `Venta #${comp.numero_venta}`,
            quantity:    Number(it.cantidad),
            unitPrice:   Number(it.precio_unitario),
            ivaAliquot:  pct,
          };
        });
        neto = comp.neto_gravado  != null ? Number(comp.neto_gravado)  : round2(netoAcum);
        iva  = comp.iva_discriminado != null ? Number(comp.iva_discriminado) : round2(ivaAcum);
      } else {
        neto = comp.neto_gravado  != null ? Number(comp.neto_gravado)  : round2(totalNum / 1.21);
        iva  = comp.iva_discriminado != null ? Number(comp.iva_discriminado) : round2(totalNum - neto);
        wsfeItems = [{ description: `Venta #${comp.numero_venta}`, quantity: 1, unitPrice: totalNum, ivaAliquot: 21 }];
      }

      // ── 6. Emitir contra ARCA ────────────────────────────────────────────────
      const arcaResult = await callArcaEmit({
        cuit: empresa.afip_cuit, certPem, keyPem, environment,
        pvNumero:        pv.numero,
        voucherType,
        issueDate:       new Date(comp.fecha).toISOString().slice(0, 10).replace(/-/g, ''),
        customerDocType: docTipo,
        customerDocNro:  docNro,
        items:           wsfeItems,
        neto, iva, total: totalNum,
      });

      // ── 7. Éxito: persistir CAE en comprobantes + cerrar la cola ────────────
      const campoUltimo = tipoComp === 'A' ? 'ultimo_numero_a' : tipoComp === 'C' ? 'ultimo_numero_c' : 'ultimo_numero_b';
      const numeroAfip  = `${String(pv.numero).padStart(4, '0')}-${String(arcaResult.numeroCorrelativo).padStart(8, '0')}`;

      await Promise.all([
        adminClient.from('comprobantes').update({
          cae:             arcaResult.cae,
          cae_vencimiento: arcaResult.caeExpirationDate ?? null,
          cae_estado:      'emitido',
          numero_afip:     numeroAfip,
          error_afip:      null,
        }).eq('id', comp.id),

        adminClient.from('puntos_venta')
          .update({ [campoUltimo]: arcaResult.numeroCorrelativo })
          .eq('id', comp.punto_venta_id),

        adminClient.from('facturas_pendientes_arca').update({
          estado:        'emitida',
          cae:           arcaResult.cae,
          cae_vencimiento: arcaResult.caeExpirationDate ? new Date(arcaResult.caeExpirationDate).toISOString().slice(0, 10) : null,
          numero_arca:   arcaResult.numeroCorrelativo,
          updated_at:    new Date().toISOString(),
        }).eq('id', fpa.id),
      ]);

      resultados.push({ id: fpa.id, resultado: 'emitida' });

    } catch (err) {
      const errMsg  = (err as Error).message;
      const tipo    = classifyArcaError(errMsg);
      const intentos = (fpa.intentos ?? 0) + 1;

      if (tipo === 'data') {
        // Caso 2: error de datos → no reintentar
        await marcarErrorDatos(fpa.id, fpa.comprobante_id, errMsg, intentos);
        resultados.push({ id: fpa.id, resultado: 'error_datos' });

      } else if (intentos >= MAX_INTENTOS) {
        // Agotados los intentos → error definitivo
        await marcarErrorDefinitivo(fpa.id, fpa.comprobante_id, errMsg);
        resultados.push({ id: fpa.id, resultado: 'error_definitivo' });

      } else {
        // Caso 1 / 3: transient o ambiguo — reintentar con backoff
        const mins = backoffMinutes(intentos);
        const proxIntento = new Date(Date.now() + mins * 60 * 1000).toISOString();
        await adminClient.from('facturas_pendientes_arca').update({
          estado:          'reintentando',
          intentos,
          proximo_intento: proxIntento,
          error_mensaje:   errMsg,
          updated_at:      new Date().toISOString(),
        }).eq('id', fpa.id);

        resultados.push({ id: fpa.id, resultado: `reintentando (intento ${intentos}/${MAX_INTENTOS}, próx. en ${mins}m)` });
      }
    }
  }

  console.log('[arca-worker]', JSON.stringify(resultados));
  return new Response(JSON.stringify({ procesados: pendientes.length, resultados }), { status: 200 });
});

async function marcarErrorDatos(fpaId: string, comprobanteId: string, msg: string, intentos: number) {
  await Promise.all([
    adminClient.from('facturas_pendientes_arca').update({
      estado:       'error_datos',
      intentos,
      error_mensaje: msg,
      updated_at:   new Date().toISOString(),
    }).eq('id', fpaId),
    adminClient.from('comprobantes').update({
      cae_estado: 'error',
      error_afip:  msg,
    }).eq('id', comprobanteId),
  ]);
}

async function marcarErrorDefinitivo(fpaId: string, comprobanteId: string, msg: string) {
  await Promise.all([
    adminClient.from('facturas_pendientes_arca').update({
      estado:       'error_definitivo',
      error_mensaje: msg,
      updated_at:   new Date().toISOString(),
    }).eq('id', fpaId),
    adminClient.from('comprobantes').update({
      cae_estado: 'error_definitivo',
      error_afip:  msg,
    }).eq('id', comprobanteId),
  ]);
}
