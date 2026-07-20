// Fase 3 — Escenario D: cobros/pagos. Cada VU llama registrar_cobro_cliente
// real contra un cliente de su empresa, en loop — mide el costo del otro
// camino de escritura pesado del sistema (además de crear_venta): inserta
// cuenta_corriente_movimientos + movimientos_caja + asiento automático.
//
// 2 modos (mismo patrón que MODO de escenario-b-contencion.js):
//   - clientes_random (default): cada cobro va a un cliente al azar de la
//     empresa, SIN imputar a ninguna factura puntual — mide el costo de la
//     RPC en sí, sin contención sobre una fila particular.
//   - misma_factura (sesión 79, cierra el pendiente del reporte Fase 2/3):
//     todos los VUs de una misma empresa imputan pagos contra la MISMA
//     "factura compartida" que seed.mjs genera por empresa
//     (fixture.factura_compartida_id, saldo grande a propósito). Es el caso
//     real de contención sobre comprobantes.total ("2 VUs pagando la MISMA
//     factura al mismo tiempo") que el modo original no cubría — cada
//     imputación hace un SELECT...FOR UPDATE sobre esa fila, así que con
//     varios VUs mapeados a la misma empresa (VU % fixtures.length) el lock
//     se serializa de verdad, no solo en teoría.
//
// Corre EXCLUSIVAMENTE contra el stack local. Requiere scripts/loadtest/seed.mjs.
//
// Uso:
//   k6 run loadtest/k6/escenario-d-cobros-pagos.js
//   MAX_VUS=100 k6 run loadtest/k6/escenario-d-cobros-pagos.js
//   MODO=misma_factura MAX_VUS=100 k6 run loadtest/k6/escenario-d-cobros-pagos.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const fixtures = JSON.parse(open('../../scripts/loadtest/fixtures.json'));

const API_URL = __ENV.SUPABASE_URL || 'http://127.0.0.1:54321';
const ANON_KEY = __ENV.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

if (API_URL.indexOf('supabase.co') !== -1) {
  throw new Error('ABORTADO: este escenario solo corre contra el stack local (127.0.0.1), nunca contra el proyecto hosted.');
}

export const errorRate = new Rate('errores_registrar_cobro');
export const cobroDuration = new Trend('duracion_registrar_cobro', true);

function buildStages() {
  if (__ENV.SMOKE) return [{ duration: '1s', target: 1 }];
  const maxVUs = Number(__ENV.MAX_VUS || Math.min(fixtures.length, 50));
  const niveles = [5, 20, 50, 100].filter(n => n <= maxVUs);
  if (niveles[niveles.length - 1] !== maxVUs) niveles.push(maxVUs);
  const stages = [];
  for (const nivel of niveles) {
    stages.push({ duration: '15s', target: nivel });
    stages.push({ duration: '30s', target: nivel });
  }
  stages.push({ duration: '10s', target: 0 });
  return stages;
}

export const options = {
  scenarios: {
    escenario_d: __ENV.SMOKE
      ? { executor: 'per-vu-iterations', vus: 1, iterations: 5, maxDuration: '30s' }
      : { executor: 'ramping-vus', startVUs: 0, stages: buildStages(), gracefulRampDown: '10s' },
  },
  thresholds: {
    errores_registrar_cobro: ['rate<0.01'],
  },
};

const MODO = __ENV.MODO || 'clientes_random'; // 'clientes_random' | 'misma_factura'

export default function () {
  const fixture = fixtures[__VU % fixtures.length];
  // Montos chicos a propósito en modo misma_factura: con FACTURA_COMPARTIDA_MONTO
  // ($10M default) y pagos de $10-100, la factura aguanta decenas de miles de
  // imputaciones antes de agotar el saldo — no queremos que el "sobre-imputación"
  // legítimo del final de la factura contamine la tasa de error del test.
  const monto = MODO === 'misma_factura'
    ? 10 + Math.floor(Math.random() * 90)
    : 500 + Math.floor(Math.random() * 4500);

  const payload = JSON.stringify(MODO === 'misma_factura' ? {
    p_empresa_id: fixture.empresa_id,
    p_user_id: fixture.user_id,
    p_cliente_id: fixture.factura_compartida_cliente_id,
    p_cliente_nombre: 'Cliente de prueba (factura compartida)',
    p_monto: monto,
    p_metodo: 'Efectivo',
    p_fecha: new Date().toISOString(),
    p_descripcion: `LOADTEST-D-MISMA-FACTURA-${__VU}-${__ITER}`,
    p_caja_sesion_id: null,
    p_monto_paralelo: null,
    p_tc_paralelo: null,
    p_imputaciones: [{ comprobante_id: fixture.factura_compartida_id, monto }],
    p_forma_pago_id: null,
  } : {
    p_empresa_id: fixture.empresa_id,
    p_user_id: fixture.user_id,
    p_cliente_id: fixture.cliente_ids[Math.floor(Math.random() * fixture.cliente_ids.length)],
    p_cliente_nombre: 'Cliente de prueba',
    p_monto: monto,
    p_metodo: 'Efectivo',
    p_fecha: new Date().toISOString(),
    p_descripcion: `LOADTEST-D-${__VU}-${__ITER}`,
    p_caja_sesion_id: null,
    p_monto_paralelo: null,
    p_tc_paralelo: null,
    p_imputaciones: null,
    p_forma_pago_id: null,
  });

  const res = http.post(`${API_URL}/rest/v1/rpc/registrar_cobro_cliente`, payload, {
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${fixture.jwt}` },
  });

  const ok = check(res, { 'status 200/201': (r) => r.status === 200 || r.status === 201 });
  errorRate.add(!ok);
  cobroDuration.add(res.timings.duration);

  if (!ok && __ENV.SMOKE) console.error(`SMOKE FAIL: status=${res.status} body=${res.body}`);

  sleep(1);
}
