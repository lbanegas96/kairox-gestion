// supabase/functions/arca-worker/index.ts
// Worker programado (cron */5 * * * *) que procesa la cola facturas_pendientes_arca.
//
// Casos que maneja:
//   1. ARCA caído (timeout/503) → estado='reintentando', backoff exponencial
//      [1,5,15,30,60] min, máx 5 intentos. Al agotarlos, ANTES de rendirse a
//      error_definitivo intenta CAEA como contingencia (ver caso 5).
//   2. Error de datos (ARCA rechaza dato inválido) → estado='error_datos' directo,
//      NO reintentar — el usuario debe corregir manualmente. NUNCA se le aplica
//      CAEA: CAEA no arregla datos inválidos, autorizar datos malos sería peor.
//   3. Estado ambiguo (timeout sin respuesta) → consultar getLastVoucherNumber()
//      ANTES de reintentar — si ARCA ya emitió, sincronizar en vez de reemitir.
//   4. Numeración desincronizada → SIEMPRE getLastVoucherNumber() para obtener
//      el próximo número real, nunca usar el contador local.
//   5. CONTINGENCIA CAEA (mig.225): si tras agotar los 5 reintentos de CAE por
//      ARCA caído la empresa tiene afip_usa_caea=true y un CAEA vigente para el
//      tipo de comprobante, se autoriza con CAEA (RPC usar_caea_para_comprobante)
//      en vez de quedar en error_definitivo esperando que un humano lo destrabe a
//      mano desde el Monitor. Si no hay CAEA disponible, cae al error_definitivo
//      normal — comportamiento idéntico al de hoy para quien no usa CAEA.
//   6. Mensajes claros (mig.317, Fase 3 del plan de robustez): cada vez que se
//      guarda un error_mensaje/error_afip crudo, se guarda en paralelo su
//      traducción humana (mensajeHumano(), _shared/afip.ts) en
//      error_mensaje_usuario/error_afip_usuario — el crudo nunca se pierde,
//      solo se le suma una versión legible. El estado error_definitivo también
//      guarda `motivo_definitivo` ('ambiguo_sin_reintento' vs
//      'reintentos_agotados') para que el Monitor distinga "el sistema decidió
//      no reintentar" de "se acabaron los reintentos" — hoy se veían idénticos.
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
  consultarComprobante,
  classifyArcaError,
  backoffMinutes,
  fchToIso,
  mensajeHumano,
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

  // ── 0. Lock de ejecución única ────────────────────────────────────────────
  // El cron dispara cada 5 min sin esperar a que la corrida anterior termine.
  // Sin este lock, dos invocaciones concurrentes piden `feCompUltimoAutorizado()`
  // por su cuenta y pueden pedir el mismo número a la vez → AFIP acepta una y
  // rechaza la otra con [10016] aunque el número no tuviera ningún problema real
  // (visto en producción al reencolar 9 facturas: se procesaron en ~3s en un
  // orden que no respetaba fecha ASC, señal de 2 corridas en paralelo).
  // Se fuerza el reclamo si el lock anterior quedó tomado hace más de 10 min
  // (una corrida normal no debería tardar tanto) para no quedar en deadlock si
  // una invocación previa crasheó sin liberar.
  const { data: locked } = await adminClient
    .from('arca_worker_run')
    .update({ running: true, started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', true)
    .or(`running.eq.false,started_at.lt.${new Date(Date.now() - 10 * 60 * 1000).toISOString()}`)
    .select();

  if (!locked?.length) {
    return new Response(JSON.stringify({ procesados: 0, mensaje: 'Ya hay una corrida en curso' }), { status: 200 });
  }

  try {
    return await procesarCola(environment);
  } finally {
    await adminClient.from('arca_worker_run').update({ running: false }).eq('id', true);
  }
});

async function procesarCola(environment: 'production' | 'sandbox'): Promise<Response> {
  // ── 1. Leer cola pendiente ─────────────────────────────────────────────────
  // Ordenada por la fecha real del comprobante (no por created_at de la cola):
  // AFIP exige números correlativos por PdV+tipo, así que un lote debe siempre
  // autorizarse en el mismo orden cronológico en que se vendió. Sin este orden,
  // un reencolado masivo puede procesar un comprobante más nuevo antes que uno
  // más viejo del mismo tipo y dejarlo con [10016] "no corresponde al próximo
  // a autorizar" (visto en producción al reencolar 19 facturas, sesión 54).
  // Además de pendiente/reintentando con su hora ya cumplida, recupera filas
  // 'procesando' colgadas hace más de 10 min — señal de que una corrida
  // anterior murió a mitad de camino (Edge Function killeada, corte de red)
  // entre que ARCA respondió y que se terminó de persistir. Sin esto, esa
  // fila queda huérfana para siempre: este SELECT es la única puerta de
  // entrada a la cola y antes no incluía 'procesando'. Mismo criterio de
  // "10 min = tiempo que no debería tardar una corrida normal" que ya usa el
  // lock del worker (arca_worker_run, más arriba).
  const nowIso   = new Date().toISOString();
  const staleIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: pendientes, error: fetchErr } = await adminClient
    .from('facturas_pendientes_arca')
    .select('*, comprobantes(fecha)')
    .or(`and(estado.in.(pendiente,reintentando),proximo_intento.lte.${nowIso}),and(estado.eq.procesando,updated_at.lt.${staleIso})`)
    .order('fecha', { foreignTable: 'comprobantes', ascending: true, nullsFirst: false })
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
        .select('id, numero_venta, tipo, fecha, total, neto_gravado, iva_discriminado, cliente_id, cliente_nombre, tipo_comprobante_afip, punto_venta_id, empresa_id, comprobante_origen_id')
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
        .select('numero')
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
      const voucherType = voucherTypeAfip(tipoComp, comp.tipo);

      // NC/ND: AFIP exige declarar el comprobante que le dio origen (CbteAsoc)
      // — sin esto rechaza con [10197] "Si el comprobante es Debito o Credito,
      // enviar estructura CbteAsoc o PeriodoAsoc" (hallado en producción,
      // 2026-07-30, primer intento real de emitir una NC con CbteTipo correcto).
      // Mensajes con "dato inv" caen en classifyArcaError → 'data' → no
      // reintenta (un comprobante sin origen válido nunca va a poder emitirse).
      let cbteAsoc: { tipo: number; ptoVta: number; nro: number } | undefined;
      if (comp.tipo === 'nota_credito' || comp.tipo === 'nota_debito') {
        if (!comp.comprobante_origen_id) {
          throw new Error('Dato inválido: nota de crédito/débito sin comprobante de origen — AFIP exige CbteAsoc.');
        }
        const { data: origen } = await adminClient
          .from('comprobantes')
          .select('tipo, tipo_comprobante_afip, numero_afip')
          .eq('id', comp.comprobante_origen_id)
          .single();

        if (!origen?.numero_afip) {
          throw new Error('Dato inválido: el comprobante de origen no tiene numero_afip (nunca fue autorizado por AFIP) — no se puede armar CbteAsoc.');
        }

        const [ptoVtaAsocStr, nroAsocStr] = origen.numero_afip.split('-');
        cbteAsoc = {
          tipo:   voucherTypeAfip(origen.tipo_comprobante_afip ?? tipoComp, origen.tipo ?? 'venta'),
          ptoVta: parseInt(ptoVtaAsocStr, 10),
          nro:    parseInt(nroAsocStr, 10),
        };
      }

      // Cliente + doc/total del comprobante — se necesitan tanto para emitir
      // como para la reconciliación de ambigüedad (más abajo), así que se
      // cargan antes de esa rama en vez de después.
      let cliDocumento: string | null = null;
      let cliCondicionIva: string | null = null;
      if (comp.cliente_id) {
        const { data: cli } = await adminClient
          .from('clientes')
          .select('documento, condicion_iva')
          .eq('id', comp.cliente_id)
          .single();
        cliDocumento = cli?.documento ?? null;
        cliCondicionIva = cli?.condicion_iva ?? null;
      }

      const { tipo: docTipo, nro: docNro } = docTipoAfip(cliDocumento);
      const totalNum = Number(comp.total);

      // ── Caso 3 + 4: getLastVoucherNumber SIEMPRE antes de emitir en retry ───
      // Verifica si ARCA ya emitió (estado ambiguo por timeout previo) y
      // obtiene el próximo número real (nunca usar el contador local).
      const lastNumber = await getLastVoucherNumber(
        adminClient, comp.empresa_id, empresa.afip_cuit, certPem, keyPem, environment, pv.numero, voucherType,
      );

      // Checar si ARCA ya emitió el CAE para este comprobante comparando el
      // último correlativo que conocíamos con el último emitido en ARCA.
      //
      // El contador vive en `puntos_venta_numeracion`, indexado por
      // (punto de venta, cbte_tipo) — igual que AFIP indexa sus series
      // (mig.273). Antes salía de `puntos_venta.ultimo_numero_a/b/c`, indexado
      // por LETRA: con eso, una NC y una Factura de la misma letra escribían en
      // el mismo contador aunque en AFIP son series independientes, y la primera
      // NC pisaba el contador de las facturas — mandando la siguiente factura
      // VÁLIDA a error_definitivo por "estado ambiguo". Ver tarea #36.
      const { data: numeracion } = await adminClient
        .from('puntos_venta_numeracion')
        .select('ultimo_numero')
        .eq('punto_venta_id', comp.punto_venta_id)
        .eq('cbte_tipo', voucherType)
        .maybeSingle();

      // Sin fila = no tenemos expectativa previa para esta serie (primera vez
      // que se emite este cbte_tipo en este PdV). Se saltea el chequeo y se
      // emite: inicializar en 0 haría que `lastNumber >= 1` diera verdadero para
      // cualquier serie que ya tenga números en AFIP, marcando TODO como ambiguo.
      if (numeracion) {
        const expectedNumero = numeracion.ultimo_numero ?? 0;
        if (lastNumber >= expectedNumero + 1) {
          // ARCA ya procesó algo más adelante — puede que ya emitió el
          // nuestro. Antes de rendirse a revisión manual (patrón
          // "confirm-before-repeat"): consultar cada número en disputa contra
          // ARCA y compararlo con este comprobante (total + documento). Si
          // matchea, es nuestro — persistir el CAE encontrado sin re-emitir.
          // Gap acotado a 10: un desincronismo mayor a eso ya no es la
          // "ambigüedad de timeout" típica, es un problema más serio que
          // reconciliar a ciegas podría empeorar.
          const GAP_MAX = 10;
          const gap = lastNumber - expectedNumero;
          let matched: Awaited<ReturnType<typeof consultarComprobante>> = null;

          if (gap <= GAP_MAX) {
            for (let n = expectedNumero + 1; n <= lastNumber; n++) {
              const consulta = await consultarComprobante(
                adminClient, comp.empresa_id, empresa.afip_cuit, certPem, keyPem, environment, pv.numero, voucherType, n,
              );
              if (!consulta) continue; // ARCA no tiene ese número — no es este
              const mismoTotal = Math.abs(consulta.impTotal - totalNum) < 0.01;
              const mismoDoc = consulta.docTipo === docTipo && (docTipo === 99 || consulta.docNro === docNro);
              if (mismoTotal && mismoDoc) { matched = consulta; break; }
            }
          }

          if (matched) {
            const numeroAfipMatch = `${String(pv.numero).padStart(4, '0')}-${String(matched.cbteNro).padStart(8, '0')}`;
            const { error: persistErr } = await adminClient.rpc('fn_persistir_cae_emitido', {
              p_fpa_id:             fpa.id,
              p_comprobante_id:     comp.id,
              p_empresa_id:         comp.empresa_id,
              p_punto_venta_id:     comp.punto_venta_id,
              p_cbte_tipo:          voucherType,
              p_cae:                matched.cae,
              p_cae_vencimiento:    fchToIso(matched.caeVto),
              p_numero_afip:        numeroAfipMatch,
              p_numero_correlativo: matched.cbteNro,
            });
            if (persistErr) throw new Error('Reconciliación encontró el CAE pero no pudo persistirlo: ' + persistErr.message);
            resultados.push({ id: fpa.id, resultado: `emitida (reconciliada Nº${matched.cbteNro})` });
            continue;
          }

          // No matchea ningún número del rango (o el gap es demasiado grande
          // para reconciliar automáticamente) — recién ahí revisión manual,
          // intentando CAEA primero si la empresa lo tiene configurado (antes
          // esta rama nunca llegaba a intentar CAEA, quedaba inalcanzable).
          const msg = gap <= GAP_MAX
            ? `Estado ambiguo: se verificaron los comprobantes ${expectedNumero + 1} a ${lastNumber} del tipo ${voucherType} en ARCA y ninguno coincide con este (total $${totalNum.toFixed(2)}, doc ${docTipo}/${docNro}). Verificar manualmente en portal ARCA.`
            : `Estado ambiguo: ARCA reporta último número ${lastNumber} para el tipo ${voucherType}, local esperaba ${expectedNumero + 1} (diferencia de ${gap}, demasiado grande para reconciliar automáticamente). Verificar manualmente en portal ARCA.`;

          const usoCaea = await intentarCaeaContingencia(fpa);
          if (usoCaea) {
            resultados.push({ id: fpa.id, resultado: 'autorizada_caea (ambiguo)' });
          } else {
            await marcarErrorDefinitivo(fpa.id, comp.id, msg, 'ambiguo_sin_reintento');
            resultados.push({ id: fpa.id, resultado: 'error_definitivo (ambiguo)' });
          }
          continue;
        }
      }

      // ── 5. Cargar items del comprobante ─────────────────────────────────────
      const { data: compItems } = await adminClient
        .from('comprobante_items')
        .select('cantidad, precio_unitario, subtotal, alicuota_iva')
        .eq('comprobante_id', fpa.comprobante_id)
        .eq('empresa_id', comp.empresa_id);

      const round2   = (n: number) => Math.round(n * 100) / 100;
      const etiquetaDoc = comp.tipo === 'nota_credito' ? 'Nota de Crédito'
        : comp.tipo === 'nota_debito' ? 'Nota de Débito' : 'Venta';

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
            description: `${etiquetaDoc} #${comp.numero_venta}`,
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
        wsfeItems = [{ description: `${etiquetaDoc} #${comp.numero_venta}`, quantity: 1, unitPrice: totalNum, ivaAliquot: 21 }];
      }

      // ── 6. Emitir contra ARCA ────────────────────────────────────────────────
      // AFIP exige, para Concepto=1 (productos), que CbteFch esté dentro de los 5
      // días del día de proceso. Si la emisión real se demoró más que eso (cola
      // atascada, reintento manual tardío), se usa hoy como fecha de emisión ante
      // AFIP — la fecha real de la venta queda intacta en comprobantes.fecha
      // (visto en producción: 13 facturas del 3-7/jul reencoladas el 12/jul).
      const fechaVenta = new Date(comp.fecha);
      const diffDiasVenta = Math.floor((Date.now() - fechaVenta.getTime()) / 86400000);
      const fechaEmisionAfip = diffDiasVenta > 5 ? new Date() : fechaVenta;

      const arcaResult = await callArcaEmit(adminClient, {
        empresaId: comp.empresa_id,
        cuit: empresa.afip_cuit, certPem, keyPem, environment,
        pvNumero:        pv.numero,
        voucherType,
        issueDate:       fechaEmisionAfip.toISOString().slice(0, 10).replace(/-/g, ''),
        customerDocType: docTipo,
        customerDocNro:  docNro,
        customerCondicionIva: cliCondicionIva,
        items:           wsfeItems,
        neto, iva, total: totalNum,
        cbteAsoc,
      });

      // ── 7. Éxito: persistir CAE en comprobantes + cerrar la cola ────────────
      // Una sola transacción de Postgres (RPC), no 3 llamadas HTTP sueltas: si
      // el proceso se corta a mitad de camino (Edge Function killeada, corte
      // de red), antes podía quedar un comprobante con CAE real en ARCA pero
      // cae_estado='pendiente' para siempre en KAIROX — "CAE fantasma".
      const numeroAfip = `${String(pv.numero).padStart(4, '0')}-${String(arcaResult.numeroCorrelativo).padStart(8, '0')}`;

      const { error: persistErr } = await adminClient.rpc('fn_persistir_cae_emitido', {
        p_fpa_id:             fpa.id,
        p_comprobante_id:     comp.id,
        p_empresa_id:         comp.empresa_id,
        p_punto_venta_id:     comp.punto_venta_id,
        p_cbte_tipo:          voucherType,
        p_cae:                arcaResult.cae,
        p_cae_vencimiento:    arcaResult.caeExpirationDate ?? null,
        p_numero_afip:        numeroAfip,
        p_numero_correlativo: arcaResult.numeroCorrelativo,
      });
      if (persistErr) throw new Error('ARCA emitió el CAE pero no se pudo persistir: ' + persistErr.message);

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
        // Agotados los reintentos de CAE con ARCA caído. Antes de rendirse,
        // intentar CAEA como contingencia (caso 5). Si no aplica, error definitivo.
        const usoCaea = await intentarCaeaContingencia(fpa);
        if (usoCaea) {
          resultados.push({ id: fpa.id, resultado: 'autorizada_caea' });
        } else {
          await marcarErrorDefinitivo(fpa.id, fpa.comprobante_id, errMsg, 'reintentos_agotados');
          resultados.push({ id: fpa.id, resultado: 'error_definitivo' });
        }

      } else {
        // Caso 1 / 3: transient o ambiguo — reintentar con backoff
        const mins = backoffMinutes(intentos);
        const proxIntento = new Date(Date.now() + mins * 60 * 1000).toISOString();
        await adminClient.from('facturas_pendientes_arca').update({
          estado:          'reintentando',
          intentos,
          proximo_intento: proxIntento,
          error_mensaje:   errMsg,
          error_mensaje_usuario: mensajeHumano(errMsg),
          updated_at:      new Date().toISOString(),
        }).eq('id', fpa.id);

        resultados.push({ id: fpa.id, resultado: `reintentando (intento ${intentos}/${MAX_INTENTOS}, próx. en ${mins}m)` });
      }
    }
  }

  console.log('[arca-worker]', JSON.stringify(resultados));
  return new Response(JSON.stringify({ procesados: pendientes.length, resultados }), { status: 200 });
}

async function marcarErrorDatos(fpaId: string, comprobanteId: string, msg: string, intentos: number) {
  const msgUsuario = mensajeHumano(msg);
  await Promise.all([
    adminClient.from('facturas_pendientes_arca').update({
      estado:       'error_datos',
      intentos,
      error_mensaje: msg,
      error_mensaje_usuario: msgUsuario,
      updated_at:   new Date().toISOString(),
    }).eq('id', fpaId),
    adminClient.from('comprobantes').update({
      cae_estado: 'error',
      error_afip:  msg,
      error_afip_usuario: msgUsuario,
    }).eq('id', comprobanteId),
  ]);
}

/**
 * motivo distingue, para el Monitor, dos causas raíz que hoy se ven idénticas
 * (intentos=0, mismo badge "Revisión manual") pero son muy distintas:
 * 'ambiguo_sin_reintento' = el sistema decidió activamente no reintentar
 * (Fase 1, no pudo reconciliar contra ARCA) — nunca gastó un intento real.
 * 'reintentos_agotados' = se acabaron los 5 intentos con backoff exponencial.
 */
async function marcarErrorDefinitivo(
  fpaId: string, comprobanteId: string, msg: string,
  motivo: 'ambiguo_sin_reintento' | 'reintentos_agotados' = 'reintentos_agotados',
) {
  const msgUsuario = mensajeHumano(msg, { agotado: motivo === 'reintentos_agotados' });
  await Promise.all([
    adminClient.from('facturas_pendientes_arca').update({
      estado:       'error_definitivo',
      error_mensaje: msg,
      error_mensaje_usuario: msgUsuario,
      motivo_definitivo: motivo,
      updated_at:   new Date().toISOString(),
    }).eq('id', fpaId),
    adminClient.from('comprobantes').update({
      cae_estado: 'error_definitivo',
      error_afip:  msg,
      error_afip_usuario: msgUsuario,
    }).eq('id', comprobanteId),
  ]);
}

// ── Contingencia CAEA (caso 5) ───────────────────────────────────────────────
// Solo se llama tras agotar los reintentos de CAE por ARCA caído (error
// transitorio, nunca 'data'). Si la empresa habilitó CAEA y hay un CAEA vigente
// para el tipo de comprobante, lo autoriza con CAEA vía la RPC
// usar_caea_para_comprobante (que corre bajo service_role gracias a mig.225) en
// vez de dejarlo en error_definitivo esperando intervención manual. Devuelve true
// si autorizó; false si la empresa no usa CAEA, no hay uno vigente, o cualquier
// otro problema — en cuyo caso el caller cae al error_definitivo normal.
async function intentarCaeaContingencia(fpa: {
  id: string; empresa_id: string; comprobante_id: string;
}): Promise<boolean> {
  const { data: emp } = await adminClient
    .from('empresas')
    .select('afip_usa_caea')
    .eq('id', fpa.empresa_id)
    .single();

  if (!emp?.afip_usa_caea) return false;

  // usar_caea_para_comprobante exige cae_estado IN ('error','error_definitivo').
  // En este punto el comprobante todavía no está marcado — dejarlo en 'error'
  // antes de intentar. Si CAEA falla, el caller lo pisa con error_definitivo.
  await adminClient.from('comprobantes')
    .update({ cae_estado: 'error' })
    .eq('id', fpa.comprobante_id);

  const { data, error } = await adminClient.rpc('usar_caea_para_comprobante', {
    p_comprobante_id: fpa.comprobante_id,
  });

  if (error) {
    console.warn('[arca-worker] CAEA contingencia no disponible:', error.message);
    return false;
  }

  console.log('[arca-worker] Autorizado con CAEA:', JSON.stringify(data));
  return true;
}
