# Sometimiento a estrés — KAIROX Gestión

Ver el plan completo en `.claude/plans/fluffy-sauteeing-panda.md`. Resultados reales en
`SEGURIDAD.md` (Fase 1) y `REPORTE.md` (Fase 2 en adelante).

## Regla no negociable

**Todo lo de acá corre EXCLUSIVAMENTE contra el stack local de Supabase — nunca contra el
proyecto hosted (`wuznppxeonmhfcvnqfbf`, datos reales de Nalux).** El script de siembra aborta
solo si `SUPABASE_URL` apunta a `supabase.co`.

## Cómo correr

1. Levantar el stack local (una sola vez, o después de cambios en migrations):
   ```
   npx supabase start        # primera vez
   npx supabase db reset     # para arrancar de cero / tras agregar migrations
   ```

2. Sembrar datos sintéticos:
   ```
   npm run loadtest:seed
   # o con parámetros:
   EMPRESAS=30 CLIENTES_POR_EMPRESA=10 PRODUCTOS_POR_EMPRESA=15 VENTAS_POR_EMPRESA=10 node scripts/loadtest/seed.mjs
   ```
   Genera `scripts/loadtest/fixtures.json` (gitignored — tiene JWTs de empresas sintéticas
   locales, se puede regenerar en cualquier momento).

3. Instalar k6 (binario, no es un paquete npm). En esta máquina se descargó directo del release
   de GitHub a `.tools/` (gitignored) porque `winget install k6` quedó colgado:
   ```
   curl -L -o .tools/k6.zip "https://github.com/grafana/k6/releases/download/v2.1.0/k6-v2.1.0-windows-amd64.zip"
   unzip .tools/k6.zip -d .tools/
   ```

4. Correr un escenario — siempre smoke test primero:
   ```
   SMOKE=1 .tools/k6-v2.1.0-windows-amd64/k6.exe run loadtest/k6/escenario-a-multitenant.js
   MAX_VUS=100 .tools/k6-v2.1.0-windows-amd64/k6.exe run loadtest/k6/escenario-a-multitenant.js
   ```

   Comandos largos (siembra grande, ramp-up alto) — correr con `run_in_background` si el entorno
   corta ejecuciones foreground largas (pasó en sesión 77, ver `REPORTE.md`).

## Estructura

- `scripts/loadtest/seed.mjs` — generador de datos sintéticos (empresas, usuarios con login real,
  clientes, productos, historial de ventas vía RPC real). Escribe `fixtures.json`
  incrementalmente, así una corrida cortada no pierde lo ya sembrado.
- `loadtest/k6/escenario-a-multitenant.js` — muchas empresas concurrentes vendiendo (Fase 2).
- `loadtest/k6/escenario-b-contencion.js` — muchos VUs vendiendo para LA MISMA empresa
  (`MODO=productos_distintos` o `MODO=mismo_producto`) — mide el lock de
  `series_numeracion`/`stock_actual` bajo contención real (Fase 3).
- `loadtest/k6/escenario-c-dashboard.js` — simula el path de lectura del Dashboard (9 queries en
  paralelo + 6 secuenciales de `getFlujoCajaMensual` + 2 más), escalando sesiones concurrentes
  (Fase 3).
- `loadtest/k6/escenario-d-cobros-pagos.js` — `registrar_cobro_cliente` real en loop (Fase 3;
  alcance acotado — ver el propio archivo, no cubre contención sobre la misma factura porque el
  seed no genera facturas con cliente_id real todavía).
- `loadtest/SEGURIDAD.md` — resultado de la auditoría de seguridad multi-tenant (Fase 1).
- `loadtest/REPORTE.md` — resultados reales de cada corrida de carga (Fase 2 en adelante).
