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

## Estructura

- `scripts/loadtest/seed.mjs` — generador de datos sintéticos (empresas, usuarios con login real,
  clientes, productos, historial de ventas vía RPC real).
- `loadtest/k6/escenario-a-multitenant.js` — muchas empresas concurrentes vendiendo (Fase 2).
- `loadtest/SEGURIDAD.md` — resultado de la auditoría de seguridad multi-tenant (Fase 1).
- `loadtest/REPORTE.md` — resultados reales de cada corrida de carga (Fase 2 en adelante).
