# Entorno de pruebas (staging) — KAIROX Gestión

Auditoría 24/09/2026, hallazgo **COD-2** (un solo entorno). Hoy el sistema en la computadora de cada uno, las vistas previas de
Vercel y producción comparten **la misma base de datos**: cualquier prueba toca datos reales (los registros de la auditoría
mostraron a alguien operando desde `http://localhost:3000` contra la base de producción).

Este documento es la receta para tener un segundo entorno **gratuito**, separado, donde se prueba todo antes de producción.

---

## 1. Qué se arma

| | Producción | Staging (nuevo) |
|---|---|---|
| Base de datos | Proyecto Supabase `Kairox-gestión(nuevo)` (`isvkelrdxwvkfmrfqxxk`) | Segundo proyecto Supabase, plan Free, **misma región (sa-east-1)** |
| Sitio | Vercel → rama `master` (`kairox-gestion-chi.vercel.app`) | Vercel → vistas previas de las demás ramas y ejecución local |
| Datos | Reales | **Solo inventados.** Nunca se copian datos reales (Ley 25.326) |
| Integraciones | ARCA, Mercado Pago, Tiendanube, MercadoLibre reales | Modo prueba de cada una (ARCA homologación, credenciales de prueba de Mercado Pago) o apagadas |
| Costo | Plan actual | **US$ 0** (el plan Free admite hasta 2 proyectos activos) |

Un proyecto Free se **pausa solo tras una semana sin uso**: se reactiva con un clic desde el panel cuando haga falta.

---

## 2. Lo que tiene que hacer una persona (5 minutos, no se puede delegar)

1. Supabase → *New project* → nombre `Kairox-gestion-staging`, región **South America (São Paulo)**, contraseña larga generada
   por el gestor de contraseñas (guardarla ahí).
2. Anotar del panel (Settings → API): la **URL** del proyecto y la clave **anon**. La clave *service_role* solo se necesita para
   cargar secretos de funciones: no se pega en ningún chat ni en el repositorio.
3. Pasarle a Claude Code el ref del proyecto (el código de 20 letras de la URL); con eso puede hacer el resto.

---

## 3. Armado técnico (lo hace Claude Code o Nadia)

1. **Migraciones:** `supabase link --project-ref <staging>` y `supabase db push` (o `apply_migration` una por una).
   La recreación desde cero de la base **tuvo un bloqueo hasta el 25/09/2026** (la migración 297 insertaba una fila para la empresa
   Nalux, que en una base vacía no existe; ya está corregido en el repositorio). Es la misma recreación que hace la CI de pgTAP: si algo más
   falla, falla igual en los dos lados y hay que corregirlo en el repo.
2. **Tareas de cron — paso obligatorio.** Las migraciones dejan las tareas de cron apuntando **a las funciones de producción** (la dirección
   y la clave anónima están escritas a mano, ver mig. 329). Si se dejan así, el staging le pega todo el día a producción. Hay que
   reprogramarlas con la dirección del staging (mismo bloque que la mig. 329 cambiando el ref) o, mientras no se necesiten, apagarlas:
   `SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname <> 'purgar-historial-cron-diario';`
3. **Edge Functions:** desplegarlas con el `verify_jwt` de cada una (tabla en `PLAN_DE_RECUPERACION.md`, sección 5). El CLI, sin
   `--no-verify-jwt`, deja a los webhooks y workers rechazando todo con 401.
4. **Secretos de las funciones** (Supabase → Edge Functions → Secrets): `SITE_URL` (la del staging), `AFIP_ENVIRONMENT=sandbox`,
   y solo si se prueban esas integraciones: `TIENDANUBE_*` y `MELI_*` con una aplicación de prueba.
5. **Auth** (Authentication → URL Configuration): *Site URL* y *Redirect URLs* con la URL de las vistas previas de Vercel del proyecto
   y `http://localhost:3000`.
6. **Datos de prueba:** una empresa inventada con su usuario administrador, plan de cuentas y algunos productos/clientes
   inventados (hay un generador para pruebas de carga en `scripts/loadtest/seed.mjs`; revisar a qué proyecto apunta antes de correrlo).
7. **Pruebas de base:** correr `supabase/tests/*.test.sql` contra el staging (mismas que corre la CI).

---

## 4. Variables de entorno en Vercel — una por entorno

Vercel → Project → Settings → Environment Variables. Cada variable se crea **una vez por entorno**, con el valor que corresponde:

| Variable | Production | Preview | Development (local) |
|---|---|---|---|
| `VITE_SUPABASE_URL` | URL de **producción** | URL del **staging** | URL del **staging** (en `.env.local`) |
| `VITE_SUPABASE_ANON_KEY` | clave anon de producción | clave anon del staging | clave anon del staging |
| `VITE_UALA_SUPABASE_URL` / `VITE_UALA_SUPABASE_ANON_KEY` | las de hoy | las del staging (o vacías si no se usa) | ídem |

Reglas:
- **Production** solo la usa la rama `master`. Con esto, una rama de prueba o un `npm run dev` **no pueden** tocar la base real.
- El archivo `.env.local` (nunca versionado) de cada computadora apunta al **staging**. La receta está en `.env.example`.
- Después de cambiar variables hay que volver a desplegar (las de Vite se incorporan al construir el sitio).

---

## 5. Flujo de trabajo con dos entornos

1. Cambio de código o de base → rama nueva → *Pull Request* hacia `master`.
2. La CI (pruebas de Vitest + pgTAP + build) corre sola; Vercel arma la **vista previa** contra el staging.
3. Se prueba en la vista previa. Las migraciones se aplican **primero al staging**, y recién con eso probado, a producción.
4. Se hace *merge*: Vercel despliega producción. La migración de producción la aplica una persona con el OK explícito, y **antes** del *merge*
   si el código nuevo la necesita.
5. Recomendado: **proteger la rama `master`** (GitHub → Settings → Branches → Branch protection rule): exigir *Pull Request* y que pasen las
   comprobaciones. Sin esto, cualquier `git push` a `master` despliega a producción sin esperar a la CI (hallazgo COD-1).

---

## 6. Lo que NO se hace en staging

- No se cargan **datos reales** de clientes, proveedores ni usuarios (la Ley 25.326 exige usarlos solo para el fin declarado).
- No se conectan las **credenciales de producción** de ARCA, Mercado Pago, Tiendanube ni MercadoLibre.
- No se comparte la clave `service_role` del staging por chat ni por correo.
