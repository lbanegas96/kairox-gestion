// Fase 3 — Escenario C: dashboard/lectura. Simula el path de lectura más pesado
// del sistema (src/services/dashboardService.ts): getKPIs dispara 9 queries en
// paralelo, getFlujoCajaMensual hace 6 queries SECUENCIALES (no paralelas — un
// hallazgo de la Fase 1), más getVentasPorDia y getTopClientes. Un VU = una
// sesión de usuario con el Dashboard abierto, repitiendo esa carga cada
// POLL_INTERVAL segundos (30s en la app real — acá configurable para no hacer
// el test eterno).
//
// Corre EXCLUSIVAMENTE contra el stack local. Requiere scripts/loadtest/seed.mjs.
//
// Uso:
//   k6 run loadtest/k6/escenario-c-dashboard.js
//   MAX_VUS=100 POLL_INTERVAL=5 k6 run loadtest/k6/escenario-c-dashboard.js

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

const POLL_INTERVAL = Number(__ENV.POLL_INTERVAL || 5); // prod real: 30s

export const errorRate = new Rate('errores_dashboard');
export const dashboardDuration = new Trend('duracion_dashboard_completo', true);

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
    escenario_c: __ENV.SMOKE
      ? { executor: 'per-vu-iterations', vus: 1, iterations: 3, maxDuration: '30s' }
      : { executor: 'ramping-vus', startVUs: 0, stages: buildStages(), gracefulRampDown: '10s' },
  },
  thresholds: {
    errores_dashboard: ['rate<0.01'],
  },
};

function iso(d) { return d.toISOString(); }

export default function () {
  const fixture = fixtures[__VU % fixtures.length];
  const headers = { apikey: ANON_KEY, Authorization: `Bearer ${fixture.jwt}` };
  const empresaId = fixture.empresa_id;
  const t0 = Date.now();
  let allOk = true;

  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);
  const mesStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const hace7d = new Date(now.getTime() - 7 * 86400000);

  // getKPIs: 9 queries en paralelo (http.batch simula Promise.all).
  const kpiRequests = [
    ['GET', `${API_URL}/rest/v1/movimientos_caja?select=monto&empresa_id=eq.${empresaId}&tipo=eq.ingreso&categoria=eq.Venta&fecha=gte.${iso(todayStart)}&fecha=lte.${iso(todayEnd)}`, null, { headers }],
    ['GET', `${API_URL}/rest/v1/movimientos_caja?select=monto&empresa_id=eq.${empresaId}&tipo=eq.ingreso&categoria=eq.Venta&fecha=gte.${iso(mesStart)}&fecha=lte.${iso(todayEnd)}`, null, { headers }],
    ['GET', `${API_URL}/rest/v1/movimientos_caja?select=monto&empresa_id=eq.${empresaId}&tipo=eq.egreso&fecha=gte.${iso(mesStart)}&fecha=lte.${iso(todayEnd)}`, null, { headers }],
    ['GET', `${API_URL}/rest/v1/clientes?select=saldo_actual&empresa_id=eq.${empresaId}&saldo_actual=gt.0`, null, { headers }],
    ['GET', `${API_URL}/rest/v1/productos?select=id,nombre,stock_actual,stock_minimo,unidad_medida&empresa_id=eq.${empresaId}&activo=eq.true`, null, { headers }],
    ['GET', `${API_URL}/rest/v1/comprobantes?select=id,total&empresa_id=eq.${empresaId}&tipo=eq.venta&fecha=gte.${iso(mesStart)}&fecha=lte.${iso(todayEnd)}`, null, { headers }],
  ];
  const kpiResponses = http.batch(kpiRequests);
  allOk = allOk && kpiResponses.every(r => r.status === 200);

  // getVentasPorDia: 1 query.
  const ventasPorDia = http.get(`${API_URL}/rest/v1/movimientos_caja?select=fecha,monto&empresa_id=eq.${empresaId}&tipo=eq.ingreso&categoria=eq.Venta&fecha=gte.${iso(hace7d)}&order=fecha`, { headers });
  allOk = allOk && ventasPorDia.status === 200;

  // getFlujoCajaMensual: 6 queries SECUENCIALES (así está hoy en el código real —
  // es justamente el punto que la Fase 1 marcó como "no paralelizado").
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const start = d;
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59));
    const res = http.get(`${API_URL}/rest/v1/movimientos_caja?select=tipo,monto,categoria&empresa_id=eq.${empresaId}&fecha=gte.${iso(start)}&fecha=lte.${iso(end)}`, { headers });
    allOk = allOk && res.status === 200;
  }

  // getTopClientes: 1 query.
  const topClientes = http.get(`${API_URL}/rest/v1/comprobantes?select=cliente_id,cliente_nombre,total&empresa_id=eq.${empresaId}&tipo=eq.venta&cliente_nombre=not.is.null&fecha=gte.${iso(mesStart)}&fecha=lte.${iso(todayEnd)}`, { headers });
  allOk = allOk && topClientes.status === 200;

  check(null, { 'dashboard completo sin errores': () => allOk });
  errorRate.add(!allOk);
  dashboardDuration.add(Date.now() - t0);

  sleep(POLL_INTERVAL);
}
