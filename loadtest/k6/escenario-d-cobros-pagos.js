// Fase 3 — Escenario D: cobros/pagos. Cada VU llama registrar_cobro_cliente
// real contra un cliente de su empresa, en loop — mide el costo del otro
// camino de escritura pesado del sistema (además de crear_venta): inserta
// cuenta_corriente_movimientos + movimientos_caja + asiento automático.
//
// ALCANCE ACOTADO A PROPÓSITO: el seed.mjs actual no genera facturas con
// cliente_id real (todas las ventas históricas son "Consumidor Final"), así
// que este escenario mide el costo de la RPC en sí (sin imputación a una
// factura puntual) — NO cubre el caso específico "2 VUs pagando la MISMA
// factura al mismo tiempo" (lock de comprobantes.total) que pedía el plan
// original. Para cubrir eso hace falta extender seed.mjs con clientes que
// tengan facturas reales — pendiente, documentado en el reporte.
//
// Corre EXCLUSIVAMENTE contra el stack local. Requiere scripts/loadtest/seed.mjs.
//
// Uso:
//   k6 run loadtest/k6/escenario-d-cobros-pagos.js
//   MAX_VUS=100 k6 run loadtest/k6/escenario-d-cobros-pagos.js

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

export default function () {
  const fixture = fixtures[__VU % fixtures.length];
  const clienteId = fixture.cliente_ids[Math.floor(Math.random() * fixture.cliente_ids.length)];
  const monto = 500 + Math.floor(Math.random() * 4500);

  const payload = JSON.stringify({
    p_empresa_id: fixture.empresa_id,
    p_user_id: fixture.user_id,
    p_cliente_id: clienteId,
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
