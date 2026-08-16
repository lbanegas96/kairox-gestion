# Plan de Migración a una cuenta nueva de Supabase

**Estado (madrugada 16/08): Fases 0-4a y el corte real de la app ya hechos.** Proyecto nuevo
"Kairox-gestión(nuevo)" (`ref: isvkelrdxwvkfmrfqxxk`). Ver `CONTEXT.md`, sección "Sesión
2026-08-16 (madrugada)" para el detalle completo de qué se hizo y los hallazgos reales
(varios casos de drift entre las migraciones del repo y lo que había en producción, no
capturados en ningún archivo — corregidos a mano y documentados ahí). Pendiente: Fase 4b
(integraciones/secrets, a propósito), Fase 5 (Auth) sin verificar todavía, y Vercel queda
como tarea de Luciano (variables abajo en la Fase 8, ya resueltas, sólo falta que él las
pegue y haga Redeploy).

**Por qué:** la organización NALUX está en plan `free` y Supabase avisó que el proyecto queda
restringido desde el 17/08/2026 por cuota excedida del ciclo anterior. El producto todavía no está
en condiciones de justificar pagar un plan pago, y hoy no hay presupuesto para eso — la salida es
migrar todo a una organización nueva, también en plan free, antes de esa fecha.

**Cosa importante para tener clara de entrada:** esto no arregla la causa de fondo para siempre —
una cuenta free nueva empieza en cero uso, así que compra tiempo, pero si el uso real de la app
sigue creciendo al mismo ritmo, en algún momento futuro se puede volver a topar con el mismo límite
ahí también. Sirve como solución de corto/mediano plazo mientras el producto no factura, no como
solución definitiva.

**Quién hace qué:**
- **Nadia/Luciano:** crear la cuenta y el proyecto nuevo (Claude no puede crear cuentas), tener a
  mano las credenciales de MercadoPago y el certificado AFIP para recargarlos, y estar presentes en
  la ventana de corte final (es la parte donde no puede haber ventas mientras se mueve todo).
- **Claude:** todo el trabajo técnico de volcado de datos, redeploy de funciones, verificación de
  que todo cuadra antes y después del corte.

---

## Lo que se CREA DE CERO en la cuenta nueva (no viaja solo, hay que rehacerlo)

No son datos — son configuración del proyecto en sí, así que ningún volcado de base los trae:

1. **La cuenta y el proyecto nuevo en Supabase** — lo crean Nadia/Luciano. Recomendado: misma
   región `sa-east-1` (São Paulo) que el proyecto actual, para no perder latencia con Argentina.
2. **Las Edge Functions** (`arca-worker`, `emitir-cae`, `mp-webhook`, `mp-qr-poller`, y el resto de
   `supabase/functions/`) — el código ya está en el repo, así que es volver a desplegarlas
   (`supabase functions deploy <nombre>`), no reescribir nada.
3. **Los secrets chicos de las Edge Functions** (`AFIP_ENVIRONMENT`, `SITE_URL`,
   `TIENDANUBE_APP_ID`/`CLIENT_SECRET`, `MELI_APP_ID`/`CLIENT_SECRET` — lista completa verificada
   en el código con `grep Deno.env.get supabase/functions/`) — ninguno es un dato difícil de
   conseguir, se re-tipean en 2 minutos desde donde ya viven (paneles de Tiendanube/MercadoLibre,
   o son simplemente texto fijo).

   **Aparte, un caso especial — no es un secret de Edge Function, es más importante:** el **token
   de MercadoPago** y el **certificado + clave privada de AFIP** de cada empresa se guardan en el
   **Vault** de Supabase (`vault_secret_read`, `mp_access_token_${empresa_id}` en
   `mp-save-config`/`arca-worker`/etc.), que está encriptado con una clave única de cada proyecto.
   **Esto no viaja con ningún volcado de base ni se puede "copiar"** — hay que volver a cargarlos a
   mano desde la propia pantalla de Configuración de KAIROX en el proyecto nuevo, igual que se
   cargaron la primera vez:
   - MercadoPago: se vuelve a copiar el token desde el panel de desarrolladores de MercadoPago (la
     cuenta de MP no se toca, sigue estando ahí).
   - AFIP: se vuelve a subir el certificado/clave si todavía tienen los archivos `.crt`/`.key`
     guardados fuera de Supabase. Si se perdieron, ahí sí hay que generar un certificado nuevo desde
     el portal de ARCA — es el único caso realista de "empezar de cero".
4. **Los cron jobs de `pg_cron`** (el poller de QR de MercadoPago, el reintento de facturación AFIP,
   etc.) — se recrean corriendo de nuevo las migraciones que los crean (vienen incluidas si se
   corren todas las migraciones del repo, ver Fase 1).
5. **Configuración de Auth** — proveedores de login habilitados, URLs de redirect permitidas, y el
   toggle "Leaked password protection" (que además quedó pendiente de activar desde antes, buen
   momento para hacerlo en la cuenta nueva).
6. **Las claves API nuevas** (`anon key`, `service_role key`) — las genera Supabase solo al crear el
   proyecto; hay que copiarlas a las variables de entorno de Vercel (Fase 8).
7. **El webhook de MercadoPago** — hoy apunta a la URL del proyecto viejo
   (`https://<ref-viejo>.supabase.co/functions/v1/mp-webhook`). Hay que reconfigurar esa URL en el
   panel de desarrolladores de MercadoPago para que apunte al proyecto nuevo.

## Lo que se COPIA (para que no se pierda nada)

1. **El schema completo de la base** (tablas, funciones, triggers, políticas RLS) — la forma más
   prolija de traerlo es correr, en orden, **todas** las migraciones que ya existen en
   `supabase/migrations/` contra la base nueva. El repo ya tiene la "receta" completa y probada
   desde cero — es más confiable que un volcado de schema a ciegas.
2. **Los datos reales** (todas las filas: empresas, usuarios, ventas, productos, asientos contables,
   clientes, etc. de las 3 empresas que usan el sistema hoy) — esto sí es un volcado real de datos,
   no las migraciones (las migraciones solo arman la estructura vacía). Se hace con `pg_dump
   --data-only` de la base vieja y se restaura en la base nueva.
3. **Los usuarios de autenticación** (`auth.users`, con la contraseña ya encriptada tal cual está
   guardada) — para que nadie tenga que resetear su contraseña al día siguiente. Viaja junto con el
   dump de datos si se incluye el schema `auth` explícitamente (hay que prestar atención a esto, es
   el paso donde más fácil es olvidarse de algo).
4. **Los archivos de Storage** (`logos-empresa`, `productos-imagenes`) — no viajan con `pg_dump` (son
   archivos, no filas). Se copian aparte, uno por uno, con un script que los baja del bucket viejo y
   los sube al nuevo.

---

## Plan de ejecución, paso a paso

### Fase 0 — Preparación (Nadia/Luciano)
- [x] Crear la organización y el proyecto nuevo en supabase.com (plan free, región `sa-east-1`).
- [ ] Tener a mano el token de acceso de MercadoPago (panel de desarrolladores de MP) y, si los
      guardaron, los archivos `.crt`/`.key` del certificado de AFIP — ver el detalle de por qué
      estos dos no se pueden copiar automáticamente en la sección de arriba.
- [x] Avisar la fecha/hora en la que se puede hacer la ventana de corte — confirmado 16/08
      madrugada, sin clientes reales trabajando.

### Fase 1 — Schema completo ✅
- [x] Correr las 323 migraciones del repo, en orden real (no alfabético — ver `CONTEXT.md` para
      cómo se reconstruyó el orden), contra la base nueva. Tablas, funciones, políticas RLS,
      índices y triggers coinciden EXACTO contra la vieja (4 diferencias reales encontradas y
      corregidas — drift de producción no capturado en ningún archivo, detalle en `CONTEXT.md`).

### Fase 2 — Datos reales ✅
- [x] Sin `pg_dump` (no disponible en el entorno) — extracción/carga por conexión directa a
      Postgres con Node (`pg` + `jsonb_populate_recordset`). 85 tablas (`public` + `auth.users`/
      `auth.identities`).
- [x] Verificado: **las 85 tablas coinciden exacto** entre vieja y nueva (incluye el re-sync
      final antes del corte real).

### Fase 3 — Storage ✅
- [x] 15 archivos (`logos-empresa` + `productos-imagenes`) copiados y verificados byte a byte.

### Fase 4 — Edge Functions + Secrets
- [x] Las 30 funciones desplegadas (CLI de Supabase vía `npx`, sin Docker) con el mismo
      `verify_jwt` exacto que la vieja (`list_edge_functions`, no `config.toml` — mismo patrón
      de drift). 2 funciones de debug en la vieja (`mp-debug-confirm`/`mp-debug-list-stores`) no
      están en el repo, quedaron afuera a propósito.
- [ ] Cargar los secrets chicos (`AFIP_ENVIRONMENT`, `SITE_URL`, y los de Tiendanube/MercadoLibre
      si se usan). **Pendiente a propósito** (Nadia pidió dejar integraciones para el final).
- [ ] Entrar a Configuración de KAIROX (ya apuntando al proyecto nuevo) y volver a cargar el token
      de MercadoPago y el certificado de AFIP de cada empresa. **Pendiente a propósito.**
- [ ] Probar cada función con una llamada de prueba — pendiente hasta que estén los secrets.

### Fase 5 — Auth y seguridad
- [ ] Configurar proveedores de login y URLs de redirect igual que en el proyecto viejo. **Sin
      verificar todavía** — el login con contraseña ya migrada funciona (usuarios copiados), pero
      no se revisó configuración de proveedores/redirects.
- [ ] Activar "Leaked password protection".

### Fase 6/7 — Reapuntar la app / Verificación
Nadia decidió saltear el ambiente de prueba y hacer el corte directo, dado que hoy no hay
clientes reales trabajando (ver Fase 8).

### Fase 8 — Corte real
- [x] Conector de Claude Code reautorizado por Nadia a la cuenta nueva — verificado viendo el
      proyecto y consultando datos reales.
- [x] Re-sync final de datos hecho (ver Fase 2) antes de este paso.
- [ ] **Vercel — queda como tarea de Luciano** (tiene él la cuenta). Actualizar en Settings →
      Environment Variables (las de Ualá son de otro proyecto, no se tocan):
      ```
      VITE_SUPABASE_URL=https://isvkelrdxwvkfmrfqxxk.supabase.co
      VITE_SUPABASE_ANON_KEY=<ver Settings → API del proyecto nuevo>
      ```
      Después de guardar, hace falta un **Redeploy** explícito del último deploy de Production
      (Vercel no recarga env vars solo).
- [ ] Reconfigurar el webhook de MercadoPago a la URL nueva — depende de la Fase 4b.
- [ ] Probar una venta real chica de punta a punta en producción — depende de Vercel + Fase 4b.
- [ ] Avisar a los usuarios que ya está todo funcionando de nuevo.

### Fase 9 — Después del corte
- [ ] Dejar el proyecto viejo **sin borrar** un tiempo (unas semanas) como respaldo de emergencia,
      por si aparece algo que no se copió bien — no cuesta nada mientras no se lo use activamente,
      y da tranquilidad.
- [x] Actualizar `CONTEXT.md` con la nueva URL/ref del proyecto — hecho, sección "Sesión
      2026-08-16 (madrugada)".

---

## Tiempo estimado

Esto no es para apurar en un día. Con las Fases 0 a 7 hechas con calma (probando todo en el
ambiente de prueba antes de tocar producción), la Fase 8 (el corte real) debería ser cuestión de
minutos, no horas — la mayor parte del riesgo se cubre probando antes, no en el momento del corte.
Conviene arrancar con margen antes del 17/08, no dejarlo para el último día.
