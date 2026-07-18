// Fase 2 del plan de sometimiento a estres — Escenario A: muchas EMPRESAS
// concurrentes, cada una haciendo ventas de mostrador (crear_venta real via
// PostgREST). Este es el pedido original de Luciano: "aguanta muchos clientes?"
// interpretado como muchos tenants en simultaneo, buscando el techo real.
//
// Corre EXCLUSIVAMENTE contra el stack local (127.0.0.1) — nunca contra el
// proyecto hosted. Requiere haber corrido antes scripts/loadtest/seed.mjs.
//
// Uso:
//   k6 run loadtest/k6/escenario-a-multitenant.js
//   MAX_VUS=100 k6 run loadtest/k6/escenario-a-multitenant.js   (ramp-up mas alto)
//   SMOKE=1 k6 run loadtest/k6/escenario-a-multitenant.js       (1 VU, 5 iteraciones, para validar el script)

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

export const errorRate = new Rate('errores_crear_venta');
export const ventaDuration = new Trend('duracion_crear_venta', true);

// Ramp-up escalonado: sube el techo objetivo y se queda ahi un rato antes de
// subir mas, para poder ver si el sistema *degrada* en vez de solo picos.
function buildStages() {
  if (__ENV.SMOKE) return [{ duration: '1s', target: 1 }];
  const maxVUs = Number(__ENV.MAX_VUS || Math.min(fixtures.length, 50));
  const niveles = [5, 20, 50, 100, 250, 500].filter(n => n <= maxVUs);
  if (niveles[niveles.length - 1] !== maxVUs) niveles.push(maxVUs);
  const stages = [];
  for (const nivel of niveles) {
    stages.push({ duration: '20s', target: nivel }); // ramp
    stages.push({ duration: '40s', target: nivel }); // sostenido
  }
  stages.push({ duration: '15s', target: 0 }); // ramp-down
  return stages;
}

export const options = {
  scenarios: {
    escenario_a: __ENV.SMOKE
      ? { executor: 'per-vu-iterations', vus: 1, iterations: 5, maxDuration: '30s' }
      : { executor: 'ramping-vus', startVUs: 0, stages: buildStages(), gracefulRampDown: '10s' },
  },
  thresholds: {
    errores_crear_venta: ['rate<0.01'],
    duracion_crear_venta: ['p(95)<3000'],
  },
};

export default function () {
  // Cada VU = una empresa distinta (o cicla si hay mas VUs que empresas sembradas).
  const fixture = fixtures[__VU % fixtures.length];
  const productoId = fixture.producto_ids[Math.floor(Math.random() * fixture.producto_ids.length)];
  const monto = 1000 + Math.floor(Math.random() * 9000);

  const payload = JSON.stringify({
    p_empresa_id: fixture.empresa_id,
    p_user_id: fixture.user_id,
    p_numero_venta: `LOADTEST-A-${__VU}-${__ITER}-${Date.now()}`,
    p_fecha: new Date().toISOString(),
    p_cliente_id: null,
    p_cliente_nombre: 'Consumidor Final',
    p_total: monto,
    p_forma_pago: 'Efectivo',
    p_estado_pago: 'pagada',
    p_moneda: 'ARS',
    p_tipo_cambio_tasa: 1,
    p_monto_paralelo: null,
    p_tc_paralelo: null,
    p_items: [{ producto_id: productoId, cantidad: 1, subtotal: monto, precio_unitario: monto, alicuota_iva: '21' }],
    p_pagos: [{ metodo: 'Efectivo', monto }],
    p_es_cc: false,
    p_caja_sesion_id: null,
    p_pedido_id: null,
  });

  const res = http.post(`${API_URL}/rest/v1/rpc/crear_venta`, payload, {
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON_KEY,
      Authorization: `Bearer ${fixture.jwt}`,
    },
  });

  const ok = check(res, { 'status 200/201': (r) => r.status === 200 || r.status === 201 });
  errorRate.add(!ok);
  ventaDuration.add(res.timings.duration);

  if (!ok && __ENV.SMOKE) {
    console.error(`SMOKE FAIL: status=${res.status} body=${res.body}`);
  }

  sleep(1); // ~1 venta/seg por VU — ritmo de un cajero real, no un flood artificial
}
