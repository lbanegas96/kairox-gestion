# Tests de base de datos (pgTAP) — KAIROX Gestión

## ⚠️ Regla de oro

**Estos tests NUNCA deben correr contra una empresa con datos reales** — ni la empresa
del fundador (`db21dfad-...`, "KAIROX Gestión"), ni `cbc4db74-...`, ni ninguna otra
empresa de un cliente real. Cada archivo de test en esta carpeta crea sus propios
tenants sintéticos (IDs con prefijo `00000000-aaaa-...` / `00000000-bbbb-...`, nombre
con prefijo `__PGTAP_TEST__`) y los destruye al terminar. Si un test necesita datos que
persistan más allá de su propia transacción (ver "Excepción: tests de concurrencia"
abajo), el archivo debe dejar explícito el cleanup y nunca tocar un tenant que no haya
creado él mismo.

## Cómo correr los tests (cuando haya Docker disponible)

Esta carpeta sigue la convención estándar de Supabase CLI para tests de base de datos:

```bash
npx supabase init        # solo la primera vez, si no existe supabase/config.toml
npx supabase start       # levanta Postgres local en Docker con todas las migrations aplicadas
npx supabase test db     # corre todos los *.test.sql de esta carpeta con pg_prove
```

CLI confirmada en este entorno: `npx supabase --version` → `2.107.0`. **Sin embargo,
este entorno de desarrollo NO tiene Docker instalado**, así que `supabase start`/
`supabase test db` no se pudieron ejecutar acá — ver la sección siguiente para cómo se
ejecutaron los tests igual, contra el proyecto remoto.

## Cómo se corrieron realmente (sin Docker, vía Supabase MCP)

Sin Docker no hay Postgres local, y tampoco hay `psql`/`pg_prove` instalados en este
entorno. Cada archivo `*.test.sql` es SQL puro (pgTAP es solo un set de funciones SQL:
`plan()`, `is()`, `ok()`, `skip()`, `finish()`) — no necesita psql para ejecutarse, así
que se corrió pegando el contenido del archivo directamente vía la tool
`execute_sql` del MCP de Supabase, contra el proyecto real (`wuznppxeonmhfcvnqfbf`),
**siempre dentro de `BEGIN ... ROLLBACK`** para que ningún tenant sintético quede
persistido. El bloque `BEGIN/CREATE EXTENSION/fixtures/asserts/finish()/ROLLBACK` es
exactamente el contenido del `.test.sql`, solo que sin depender de psql.

Limitación de esta vía: la tool de `execute_sql` solo devuelve el resultado del
**último** statement de un batch — para ver la salida TAP completa (cada línea
`ok N - descripción`) hubo que envolver cada assert en
`INSERT INTO tap_output SELECT is(...)` con una tabla temporal, y hacer
`SELECT * FROM tap_output;` como statement final antes del `ROLLBACK`. Esto es solo
una necesidad de esta vía de ejecución — el archivo `.test.sql` commiteado en el repo
NO tiene esa tabla temporal, porque corriendo con `pg_prove`/psql cada línea se imprime
sola, sin necesidad de capturarla.

## Excepción: tests de concurrencia real (Caso 2 de `obtener_proximo_numero`)

pgTAP corre dentro de **una sola conexión/transacción** — no hay forma de que un test
de pgTAP dispare una segunda transacción real compitiendo por el mismo lock al mismo
tiempo. Por eso el archivo `.test.sql` marca el caso de concurrencia con `skip()` y
deja la verificación real fuera de pgTAP:

1. Se crea un tenant sintético **persistente** (no en una transacción que se revierte),
   porque cada conexión paralela necesita ver el mismo estado ya commiteado.
2. Se disparan N llamadas reales a la función en paralelo (conexiones separadas).
3. Se confirma que los números devueltos son únicos y consecutivos.
4. Se borra el tenant sintético inmediatamente — `DELETE` explícito de las 4 tablas
   involucradas (`series_numeracion`, `profiles`, `auth.users`, `empresas`), verificado
   con un `SELECT count(*)` posterior que confirme 0 filas restantes.

Esto requiere una escritura persistente fuera de un `BEGIN/ROLLBACK` — **pedir
confirmación explícita antes de hacerlo**, igual que se hizo la primera vez (sesión 40).
No automatizar este paso sin que alguien lo apruebe conscientemente cada vez, porque es
la única excepción a la regla de "todo dentro de ROLLBACK" de esta carpeta.

## Estructura

- `obtener_proximo_numero.test.sql` — numeración de comprobantes (`series_numeracion`).
  Prueba: secuencia simple, aislamiento multi-tenant, reinicio de período. La
  concurrencia real se verifica aparte (ver arriba) y su resultado se documenta en
  `CONTEXT.md`, no en este archivo.
