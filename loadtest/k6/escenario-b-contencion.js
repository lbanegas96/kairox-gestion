// Fase 3 — Escenario B: contención DENTRO de una misma empresa. A diferencia
// del Escenario A (muchas empresas distintas, que no degrada nada), acá todos
// los VUs venden para la MISMA empresa — mide el costo real del lock FOR UPDATE
// de series_numeracion (siempre) y, en modo MISMO_PRODUCTO, también el de
// productos.stock_actual sobre la misma fila.
//
// Corre EXCLUSIVAMENTE contra el stack local. Requiere scripts/loadtest/seed.mjs
// ya corrido (usa la primera empresa de fixtures.json, o EMPRESA_INDEX).
//
// Uso:
//   k6 run loadtest/k6/escenario-b-contencion.js                       (productos distintos, hasta 50 VUs)
//   MODO=mismo_producto k6 run loadtest/k6/escenario-b-contencion.js   (todos venden el mismo producto)
//   MAX_VUS=100 EMPRESA_INDEX=2 k6 run loadtest/k6/escenario-b-contencion.js

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

const EMPRESA_INDEX = Number(__ENV.EMPRESA_INDEX || 0);
const FIXTURE = fixtures[EMPRESA_INDEX];
const MODO = __ENV.MODO || 'productos_distintos'; // o 'mismo_producto'

export const errorRate = new Rate('errores_crear_venta');
export const ventaDuration = new Trend('duracion_crear_venta', true);

function buildStages() {
  if (__ENV.SMOKE) return [{ duration: '1s', target: 1 }];
  const maxVUs = Number(__ENV.MAX_VUS || 50);
  const niveles = [5, 10, 20, 30, 50, 100].filter(n => n <= maxVUs);
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
    escenario_b: __ENV.SMOKE
      ? { executor: 'per-vu-iterations', vus: 1, iterations: 5, maxDuration: '30s' }
      : { executor: 'ramping-vus', startVUs: 0, stages: buildStages(), gracefulRampDown: '10s' },
  },
  thresholds: {
    errores_crear_venta: ['rate<0.01'],
  },
};

export default function () {
  const productoId = MODO === 'mismo_producto'
    ? FIXTURE.producto_ids[0]
    : FIXTURE.producto_ids[Math.floor(Math.random() * FIXTURE.producto_ids.length)];
  const monto = 1000 + Math.floor(Math.random() * 9000);

  const payload = JSON.stringify({
    p_empresa_id: FIXTURE.empresa_id,
    p_user_id: FIXTURE.user_id,
    p_numero_venta: `LOADTEST-B-${__VU}-${__ITER}-${Date.now()}`,
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
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${FIXTURE.jwt}` },
  });

  const ok = check(res, { 'status 200/201': (r) => r.status === 200 || r.status === 201 });
  errorRate.add(!ok);
  ventaDuration.add(res.timings.duration);

  if (!ok && __ENV.SMOKE) console.error(`SMOKE FAIL: status=${res.status} body=${res.body}`);

  sleep(1);
}
