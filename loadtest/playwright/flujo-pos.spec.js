// Fase 4 del sometimiento a estres (.claude/plans/fluffy-sauteeing-panda.md).
// Prueba el flujo real de POS por UI (no API directa): login -> Punto de Venta ->
// agregar producto -> Confirmar Venta -> ver "Venta confirmada". Corre contra el
// frontend de loadtest (npx vite --mode loadtest --port 3001, ver .claude/launch.json
// config "kairox-loadtest") apuntando al stack LOCAL de Supabase (.env.loadtest.local).
//
// N_SESSIONS controla cuantos contextos de Chromium concurrentes se abren, cada uno
// con su propia empresa __LOADTEST__ de scripts/loadtest/fixtures.json (mismo patron
// que los escenarios k6 de las Fases 2-3: una empresa distinta por "VU").
//
// Uso:
//   npx playwright test loadtest/playwright/flujo-pos.spec.js                 # smoke, 1 sesion
//   N_SESSIONS=10 npx playwright test loadtest/playwright/flujo-pos.spec.js   # concurrencia real

import { test, expect, chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.LOADTEST_URL || 'http://localhost:3001';
const PASSWORD = 'LoadTest2026!Kairox';
const N_SESSIONS = parseInt(process.env.N_SESSIONS || '1', 10);

// Empresa 1 quedó con ~9999 entregas de la carga k6 directa a RPC (Fases 2-3) y
// dispara un bug real de numeración (ver task investigar overloads de crear_venta:
// duplicate key en entregas.numero_entrega) no relacionado al propósito de esta
// Fase 4. Arrancamos desde la Empresa 2 para no confundir ese bug con resultados
// de concurrencia de UI.
const fixtures = JSON.parse(
  readFileSync(path.join(__dirname, '..', '..', 'scripts', 'loadtest', 'fixtures.json'), 'utf-8')
).slice(1);

async function correrFlujoVenta(browser, empresa, resultados) {
  const t0 = Date.now();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(BASE_URL);

    // Login
    await page.getByPlaceholder('usuario@empresa.com').fill(empresa.email);
    await page.getByPlaceholder('••••••••').fill(PASSWORD);
    await page.getByRole('button', { name: /Iniciar sesión/i }).click();

    await page.waitForSelector('text=Acciones Rápidas', { timeout: 20000 });
    const tDashboard = Date.now();

    // Onboarding wizard (localStorage-per-browser-context, no relacionado a datos reales
    // de la empresa) puede aparecer en un contexto nuevo — saltarlo si aparece.
    const wizardDialog = page.getByRole('dialog').filter({ hasText: 'Asistente de bienvenida' });
    if (await wizardDialog.isVisible({ timeout: 3000 }).catch(() => false)) {
      await page.keyboard.press('Escape');
    }

    // Ir a Punto de Venta (botón "Nueva Venta" del Header → pantalla completa de caja)
    await page.getByRole('button', { name: 'Nueva Venta' }).first().click();
    await page.waitForSelector('input[placeholder="Buscar por nombre o código..."]', { timeout: 15000 });
    const tPOS = Date.now();

    // Agregar el primer producto visible del grid al carrito. Mientras `loading`
    // es true, PanelProductos.jsx renderiza skeletons con las mismas clases
    // ".grid > div" pero sin datos ni onClick — bajo contención de CPU (muchos
    // Chromium concurrentes) el fetch tarda más, así que hay que esperar una
    // card real (con precio, "$") en vez de tomar el primer div a ciegas.
    const primeraCard = page.locator('.grid > div').filter({ hasText: '$' }).first();
    await primeraCard.waitFor({ state: 'visible', timeout: 15000 });
    await primeraCard.click();
    await expect(page.getByText('Seleccioná productos del panel izquierdo')).toHaveCount(0);

    // En mobile (viewport angosto) el carrito vive en un tab aparte del grid de productos.
    const tabCarrito = page.getByRole('button', { name: 'Carrito', exact: true });
    if (await tabCarrito.isVisible().catch(() => false)) {
      await tabCarrito.click();
    }

    // Transferencia — no Efectivo: useConfirmarVenta.js bloquea Efectivo si la caja
    // no está abierta ("Abrí la caja para cobrar en efectivo"), y las empresas
    // __LOADTEST__ nunca abren caja. Transferencia/Tarjeta/CC no requieren caja
    // abierta (regla real de negocio, ver CLAUDE.md — Regla Caja).
    await page.getByRole('button', { name: 'Transferencia', exact: true }).click();

    // Confirmar venta (sin cliente — Consumidor Final por default)
    const tAntesConfirmar = Date.now();
    await page.getByRole('button', { name: /Confirmar Venta/i }).click();
    await page.waitForSelector('text=¡Venta confirmada!', { timeout: 15000 });
    const tVentaOk = Date.now();

    resultados.push({
      empresa: empresa.empresa_nombre,
      ok: true,
      ms_login_a_dashboard: tDashboard - t0,
      ms_dashboard_a_pos: tPOS - tDashboard,
      ms_confirmar_venta: tVentaOk - tAntesConfirmar,
      ms_total: tVentaOk - t0,
    });
  } catch (err) {
    resultados.push({ empresa: empresa.empresa_nombre, ok: false, error: err.message, ms_total: Date.now() - t0 });
  } finally {
    await context.close();
  }
}

test('Fase 4 — flujo POS real por UI con N contextos concurrentes', async () => {
  test.setTimeout(120_000);
  const browser = await chromium.launch();
  const empresas = fixtures.slice(0, N_SESSIONS);
  const resultados = [];

  await Promise.all(empresas.map(empresa => correrFlujoVenta(browser, empresa, resultados)));
  await browser.close();

  const fallidas = resultados.filter(r => !r.ok);
  console.log(`\n=== Fase 4 — ${resultados.length} sesiones, ${fallidas.length} fallidas ===`);
  console.table(resultados);

  expect(fallidas, `Fallaron: ${JSON.stringify(fallidas)}`).toHaveLength(0);
});
