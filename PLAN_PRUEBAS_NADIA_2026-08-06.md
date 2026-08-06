# Plan de Pruebas para Nadia — 2026-08-06

Este plan cubre las **últimas 2 verificaciones del Modo Offline del POS** que quedaron pendientes
después de la Fase 3 — son justo las que no se pueden simular con mocks ni desde una compu de
desarrollo, necesitan un dispositivo real y conexión real cortándose de verdad. Todo lo demás del
feature (las 4 fases, y la carrera de stock con 2 ventas simultáneas) ya se probó y quedó
documentado en `CONTEXT.md`.

**URL de producción a usar:** `https://kairox-gestion-chi.vercel.app` (ya tiene el último fix
del "ping activo" de conectividad, deployado y verificado hoy). **No uses localhost ni el preview
de desarrollo** — esta prueba necesita que el dispositivo se desconecte de la red de verdad, y eso
sólo tiene sentido contra la URL real.

**Dispositivo:** usá el que tengas más a mano que pueda perder conexión de verdad — un celular con
datos móviles (apagás los datos = corte real), o una notebook que puedas desconectar del WiFi. Si
es una notebook, **desactivá el suspendido/bloqueo automático de pantalla** antes de arrancar (Bloque
1 necesita que el dispositivo se quede despierto 70 minutos sin que el sistema operativo pause todo).

**Sobre los datos de prueba:** para estas pruebas vas a tener que cobrar ventas de verdad (no hay
forma de probar la cola offline sin vender algo). Usá el producto y cliente que uses siempre para
pruebas, cantidades chicas (1 unidad alcanza), y anotá los números de venta que te vayan apareciendo
en el ticket "PROVISORIO". Al final me pasás esos números y yo reviso/revierto lo que haga falta
contra la base — no hace falta que vos borres nada a mano.

---

## Bloque 1 — Sesión vieja (1+ hora offline) reconectando sin pedir login de nuevo

**Por qué importa:** la sesión del POS vence cada 1 hora (es como funciona la seguridad de
Supabase). Mientras hay conexión, la app la renueva sola en segundo plano sin que lo notes. La duda
es qué pasa si el corte de luz/internet dura **más de una hora**: cuando vuelve la conexión, ¿la app
renueva la sesión sola y sincroniza la cola pendiente? ¿O te tira a la pantalla de login y la venta
que cobraste offline queda huérfana hasta que vuelvas a entrar?

**Cómo probar:**
1. Entrá al POS en `kairox-gestion-chi.vercel.app` con tu usuario de siempre, como cualquier día.
2. Anotá la hora exacta en que empezás.
3. **Cortá la conexión real** del dispositivo (modo avión, o apagar el WiFi/datos desde el sistema
   operativo — no uses ninguna opción "offline" del navegador, tiene que ser un corte real).
4. Esperá unos 15-20 segundos y confirmá que arriba del todo apareció el aviso **"Sin conexión"**.
5. Cobrá **una venta de prueba en Efectivo o Transferencia** (cualquiera de las dos funciona sin
   conexión). Debería salir el ticket marcado **"PROVISORIO — pendiente de sincronizar"**, y en la
   topbar debería aparecer un óvalo amarillo tipo **"1 sin sincronizar"**. Anotá el número
   provisorio que te muestra el ticket.
6. Dejá el dispositivo desconectado **entre 65 y 70 minutos** (más de la hora que dura la sesión, a
   propósito). Podés hacer otra cosa mientras tanto — sólo no toques la pestaña del POS ni dejes que
   la pantalla se apague/bloquee.
7. Pasados los 65-70 minutos, **reconectá** la red (sacá el modo avión / prendé el WiFi).
8. Mirá qué pasa en los siguientes 30-60 segundos, sin tocar nada:
   - ¿El aviso "Sin conexión" desaparece solo?
   - ¿El óvalo "1 sin sincronizar" desaparece solo (se sincronizó) o queda ahí?
   - ¿En algún momento la app te pide volver a poner usuario/contraseña?
   - ¿Aparece algún cartel de error?

**Resultado esperado:** todo se resuelve solo, sin pedirte que vuelvas a loguearte — el "Sin
conexión" desaparece, el óvalo amarillo desaparece, y la venta queda sincronizada con su número
real (podés abrir el detalle de la venta desde Ventas para confirmar que ya no dice "PROVISORIO").

**Si algo no sale así** (te pide login, la venta queda trabada, aparece un error): no intentes
arreglarlo ni reintentar por tu cuenta — sacá captura de lo que ves (especialmente si hay algún
mensaje de error en rojo) y contámelo con la hora exacta en que reconectaste. Es el resultado más
valioso de esta prueba, sea cual sea.

---

## Bloque 2 — Red real degradada (no simulada)

**Por qué importa:** `navigator.onLine` (lo que usa cualquier navegador para saber si "hay
conexión") tiene un punto ciego conocido: si estás conectado a un WiFi que a su vez no tiene salida
a internet (el router se colgó, se cortó el servicio, etc.), el navegador va a decir "conectado"
aunque no haya internet de verdad. Ayer se agregó un chequeo activo (un ping liviano cada 20
segundos) para tapar ese agujero — este bloque prueba que funciona en una situación real, no
simulada con las herramientas de desarrollador.

### Escenario A — WiFi "conectado" sin internet real

1. Conectate a una red WiFi que sepas que no tiene salida real a internet — por ejemplo, un router
   sin servicio, o el WiFi de tu casa con el módem apagado (el dispositivo va a seguir mostrando el
   ícono de WiFi "conectado" del sistema operativo, aunque no ande).
2. Abrí `kairox-gestion-chi.vercel.app` en el POS (o quedate en la pestaña si ya estaba abierta).
3. Esperá unos 20-25 segundos sin tocar nada.
4. **Resultado esperado:** el aviso "Sin conexión" debería aparecer solo, aunque el sistema
   operativo diga que el WiFi está conectado.
5. Cobrá una venta de prueba en Efectivo. **Resultado esperado:** se encola offline casi al
   instante (ticket "PROVISORIO", óvalo "sin sincronizar") — **no** debería quedarse "pensando" ni
   tardar varios segundos como si estuviera esperando que la venta online falle por timeout.

### Escenario B — Conexión que entra y sale varias veces seguidas

1. Con al menos 1 venta pendiente de sincronizar (podés reusar la del Escenario A, o cobrar otra),
   provocá que la conexión se corte y vuelva varias veces seguidas y rápido — por ejemplo, activar
   y desactivar el modo avión cada 5-10 segundos, unas 5 o 6 veces seguidas.
2. Después del último "vuelve la conexión", esperá medio minuto sin tocar nada.
3. **Resultado esperado:** el óvalo de "sin sincronizar" termina en 0 (todo sincronizado), no queda
   trabado en el mismo número para siempre, y sobre todo — **no aparece la misma venta dos veces**
   en el listado de Ventas (revisalo vos, o pasame el número provisorio y lo reviso yo contra la
   base).

**Si algo no sale así:** mismo criterio que el Bloque 1 — no intentes resolverlo, sacá captura y
contame qué viste, con la hora aproximada.

---

## Qué contarme al terminar

Para cada bloque: ✅ salió como se esperaba, o ⚠️ algo no coincidió (contame qué, con captura si
podés, y la hora aproximada en que pasó — así puedo cruzarlo contra la base de datos).

Pasame también los **números de venta "PROVISORIO"** que te fueron apareciendo en los tickets de
todas las pruebas — los reviso y, si hace falta, los reviert directamente en la base (no hace falta
que borres nada de tu lado).

## Cómo seguimos

Con estos dos bloques, las **3 verificaciones que le faltaban al Modo Offline del POS quedan
cerradas** (la carrera de stock con 2 ventas simultáneas ya se probó ayer contra producción). Si
todo sale ✅, el feature completo (4 fases + las 3 verificaciones más exigentes) queda 100%
confirmado de punta a punta, no sólo "probado con tests".

Lo único que sigue sin resolver, y no depende de ninguna prueba técnica:
1. **Plan de Supabase de Nalux** sigue en `free`, vence el **17/08/2026** — si no se paga antes,
   se cae la producción de todos los clientes. Es billing, va por cuenta de Luciano.
2. **"Leaked Password Protection"** en Supabase Auth — un clic gratis que nadie activó todavía.
3. **`webhook_secret` de MercadoPago** sin rotar desde el 27/06 — no bloquea nada hoy (el QR
   funciona igual vía el poller), pero sigue pendiente.
