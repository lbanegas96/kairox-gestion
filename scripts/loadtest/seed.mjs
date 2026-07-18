// Fase 2 del plan de sometimiento a estres (.claude/plans/fluffy-sauteeing-panda.md)
//
// Genera datos sinteticos a escala contra el stack LOCAL de Supabase (nunca contra
// el proyecto hosted) simulando la operatoria real de KAIROX: N empresas, cada una
// con su usuario admin autenticado de verdad (login real, no un JWT fabricado a mano),
// clientes, productos, y un historial de ventas creado llamando al RPC real
// crear_venta (no INSERTs directos) para que los listados/reportes que el load test
// va a golpear tengan datos coherentes de partida doble.
//
// Uso:
//   node scripts/loadtest/seed.mjs
//   EMPRESAS=20 CLIENTES_POR_EMPRESA=10 PRODUCTOS_POR_EMPRESA=15 VENTAS_POR_EMPRESA=15 node scripts/loadtest/seed.mjs
//
// Requiere el stack local levantado (`npx supabase start`). Las credenciales de
// abajo son las credenciales DEMO fijas que imprime `supabase start` en cualquier
// instalacion local (no son secretas, son iguales para todo el mundo).

import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const API_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

if (API_URL.includes('supabase.co')) {
  console.error('ABORTADO: SUPABASE_URL apunta a un proyecto hosted. Este script SOLO corre contra el stack local (127.0.0.1).');
  process.exit(1);
}

const EMPRESAS = Number(process.env.EMPRESAS || 5);
const CLIENTES_POR_EMPRESA = Number(process.env.CLIENTES_POR_EMPRESA || 20);
const PRODUCTOS_POR_EMPRESA = Number(process.env.PRODUCTOS_POR_EMPRESA || 30);
const VENTAS_POR_EMPRESA = Number(process.env.VENTAS_POR_EMPRESA || 15);
const PASSWORD = 'LoadTest2026!Kairox';

const admin = createClient(API_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

async function seedEmpresa(i) {
  const nombre = `__LOADTEST__ Empresa ${i}`;
  const email = `loadtest-emp${i}@kairox.test`;

  const { data: empresa, error: errEmpresa } = await admin
    .from('empresas')
    .insert({ nombre })
    .select('id')
    .single();
  if (errEmpresa) throw new Error(`empresa ${i}: ${errEmpresa.message}`);
  const empresaId = empresa.id;

  const { data: userData, error: errUser } = await admin.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true,
  });
  if (errUser) throw new Error(`user ${i}: ${errUser.message}`);
  const userId = userData.user.id;

  // El trigger on_auth_user_created ya insertó profiles con empresa_id NULL — completarla.
  const { error: errProfile } = await admin
    .from('profiles')
    .update({ empresa_id: empresaId, role: 'admin' })
    .eq('id', userId);
  if (errProfile) throw new Error(`profile ${i}: ${errProfile.message}`);

  // Login real (no un JWT fabricado a mano) — mismo camino que usa la app.
  const anon = createClient(API_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: session, error: errLogin } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
  if (errLogin) throw new Error(`login ${i}: ${errLogin.message}`);
  const jwt = session.session.access_token;

  const clientesRows = Array.from({ length: CLIENTES_POR_EMPRESA }, (_, j) => ({
    empresa_id: empresaId,
    nombre: `__LOADTEST__ Cliente ${i}-${j}`,
    dias_credito: 0,
  }));
  const { data: clientes, error: errClientes } = await admin.from('clientes').insert(clientesRows).select('id');
  if (errClientes) throw new Error(`clientes ${i}: ${errClientes.message}`);

  const productosRows = Array.from({ length: PRODUCTOS_POR_EMPRESA }, (_, j) => ({
    empresa_id: empresaId,
    nombre: `__LOADTEST__ Producto ${i}-${j}`,
    costo_compra: rand(500, 5000),
    precio_venta: rand(1000, 10000),
    stock_actual: rand(100, 500),
  }));
  const { data: productos, error: errProductos } = await admin.from('productos').insert(productosRows).select('id');
  if (errProductos) throw new Error(`productos ${i}: ${errProductos.message}`);

  // Volumen historico via el RPC real crear_venta (no INSERT directo) — usa el
  // cliente autenticado como esta empresa, misma llamada que hace el POS real.
  const empresaClient = createClient(API_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  for (let v = 0; v < VENTAS_POR_EMPRESA; v++) {
    const producto = productos[rand(0, productos.length - 1)];
    const cantidad = rand(1, 3);
    const precioUnitario = rand(1000, 10000);
    const subtotal = precioUnitario * cantidad;
    const { error: errVenta } = await empresaClient.rpc('crear_venta', {
      p_empresa_id: empresaId,
      p_user_id: userId,
      p_numero_venta: `LOADTEST-SEED-${i}-${v}`,
      p_fecha: new Date(Date.now() - rand(0, 60) * 86400000).toISOString(),
      p_cliente_id: null,
      p_cliente_nombre: 'Consumidor Final',
      p_total: subtotal,
      p_forma_pago: 'Efectivo',
      p_estado_pago: 'pagada',
      p_moneda: 'ARS',
      p_tipo_cambio_tasa: 1,
      p_monto_paralelo: null,
      p_tc_paralelo: null,
      p_items: [{ producto_id: producto.id, cantidad, subtotal, precio_unitario: precioUnitario, alicuota_iva: '21' }],
      p_pagos: [{ metodo: 'Efectivo', monto: subtotal }],
      p_es_cc: false,
      p_caja_sesion_id: null,
      p_pedido_id: null,
    });
    if (errVenta) throw new Error(`venta ${i}-${v}: ${errVenta.message}`);
  }

  return {
    empresa_id: empresaId,
    empresa_nombre: nombre,
    user_id: userId,
    email,
    jwt,
    producto_ids: productos.map(p => p.id),
    cliente_ids: clientes.map(c => c.id),
  };
}

async function main() {
  console.log(`Sembrando ${EMPRESAS} empresas (${CLIENTES_POR_EMPRESA} clientes, ${PRODUCTOS_POR_EMPRESA} productos, ${VENTAS_POR_EMPRESA} ventas históricas c/u) contra ${API_URL}...`);
  const outPath = join(__dirname, 'fixtures.json');
  const fixtures = [];
  const fallos = [];
  for (let i = 1; i <= EMPRESAS; i++) {
    process.stdout.write(`  Empresa ${i}/${EMPRESAS}... `);
    try {
      const fixture = await seedEmpresa(i);
      fixtures.push(fixture);
      console.log('ok');
    } catch (e) {
      console.log(`FALLÓ (${e.message}) — se sigue con la próxima`);
      fallos.push({ i, error: e.message });
    }
    // Se escribe en cada vuelta (no solo al final) para no perder el progreso
    // si el proceso se corta a mitad de camino en una corrida larga.
    writeFileSync(outPath, JSON.stringify(fixtures, null, 2));
  }
  console.log(`Listo. ${fixtures.length}/${EMPRESAS} empresas sembradas → ${outPath}`);
  if (fallos.length > 0) {
    console.log(`${fallos.length} fallaron: ${fallos.map(f => `#${f.i}`).join(', ')}`);
  }
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
