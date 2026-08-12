# Plan Maestro de Pruebas — cierre de punta a punta (11/08)

Barrido completo de todo lo que quedó pendiente de probar, disperso en varios documentos
(`PLAN_PRUEBAS_SABADO_2026-08-08.md`, `PLAN_PRUEBAS_NADIA_2026-08-11.md`, notas sueltas en
`CONTEXT.md`). Este documento junta **todo lo que sigue genuinamente abierto** en un solo
circuito, organizado por quién lo tiene que correr y qué necesita para hacerlo. Todo lo que no
está acá (Fidelización, Multi-caja, Modo Offline, COGS/Inventario, Cierre de Ejercicio,
Liquidación de tarjetas, CAEA, criterio fiscal unificado, etc.) **ya está cerrado y confirmado —
no hace falta retestear nada de eso.**

**URL de producción:** `https://kairox-gestion-chi.vercel.app`.

> Marcá cada caso: ✅ pasó · ⚠️ falló (anotá qué pasó, con captura si podés) · ⬜ no probado

---

## Cómo está organizado

| Bloque | Quién | Qué necesita |
|---|---|---|
| A — Mapa de Relaciones (fix de hoy) | Nadia | Solo la app |
| B — Rebrand visual | Luciano | Solo sus ojos, cualquier navegador |
| C — Cámara + QR con hardware real | Luciano | Su celular (Android e iPhone si hay) |
| D — Motor ARCA (repaso) | Nadia o Luciano | Solo la app — informativo, ya cerrado |
| E — Acciones administrativas | Luciano | Panel de Supabase / Vercel |
| F — Decisión de negocio | Luciano | Ninguna — ya se está gestionando aparte |

Empezá por A y B (son las más rápidas y no necesitan nada especial). C necesita el celular a mano,
así que puede quedar para cuando lo tengas. D es solo para confirmar que todo quedó como se
esperaba, no debería requerir ninguna acción. E son 2 clicks. F ya está en curso, solo se lista acá
como recordatorio de que sigue con el reloj corriendo.

---

## Bloque A — Mapa de Relaciones: verificar el fix de hoy (Nadia)

**Qué se arregló:** abrir el Mapa de Relaciones desde una Cotización ya convertida en venta nunca
marcaba el badge violeta "actual" — se veía la cadena completa, pero sin indicar desde dónde la
abriste. Causa real: la relación cotización↔venta vive en `cotizaciones.comprobante_id`, y el
código nunca la usaba para armar un nodo en la cadena. Corregido y deployado hoy.

**Cómo probar:**
1. **Cotizaciones** → buscá **COT-00018** (la más reciente convertida, `20260702-002`) → ícono de
   red (Mapa de relaciones) en la fila.
2. ✅ Esperado: se abre el mapa y ahora aparece un nodo **Cotización** al principio de la cadena
   (antes de Pedido/Entrega/Factura, según corresponda), con el ícono y color propios de
   Cotización.
3. ✅ Esperado (lo que estaba roto): ese nodo de Cotización tiene el badge violeta **"actual"** —
   es el que abriste, así que tiene que marcarse.
4. Repetí con 2-3 cotizaciones convertidas más si tenés a mano (cualquiera con el ícono de red
   habilitado) — el fix debería ser consistente en todas, no depende de cuál cotización elijas.
5. De paso, confirmá que **no se rompió nada de lo que ya andaba bien**: abrí el mapa desde un
   Pedido facturado y desde una Factura directamente — en ambos casos el nodo correspondiente
   debe seguir marcando "actual" como siempre.

**Si algo no sale así:** sacá captura (con el número de cotización) y contame.

**✅ Resultado (12/08, Claude, en local con sesión de Nadia):** los 5 pasos pasaron.
- Nodo Cotización aparece al principio de la cadena en las 4 cotizaciones convertidas probadas
  (COT-00018, -00017, -00014, -00001), con el badge "actual" marcando correctamente en las 4
  (verificado a nivel de clase CSS, no solo texto — `ring-2` presente sólo en el nodo Cotización).
- Sin regresión: abrir el mapa desde una Factura directamente (20260811-001) y desde un Pedido
  facturado (PED-20260707-003) siguen marcando "actual" en el nodo correspondiente, igual que
  siempre. El "flash" transitorio de "No se pudo cargar" que había aparecido una vez el 10/08
  volvió a aparecer en el primer intento de esta prueba (COT-00018) y se resolvió solo al
  reintentar — igual que la vez anterior, parece timing del entorno, no el fix. Sin errores nuevos
  en consola (solo el warning preexistente y no relacionado de `TopClientes.jsx`).

---

## Bloque B — Rebrand visual (Luciano, con tus propios ojos)

Heredado de `PLAN_PRUEBAS_SABADO_2026-08-08.md`, nunca confirmado. Se cambiaron 88 usos de los
colores viejos hardcodeados (`#00D4FF`/`#A855F7`) por los tokens actuales del sistema (`kx-*`) en
32 componentes — build/lint/tests están verdes, pero hay 3 puntos que solo un ojo humano puede
confirmar (el entorno de pruebas no pudo sacar capturas reales).

**Cómo probar:**
1. Entrá a `kairox-gestion-chi.vercel.app` **sin sesión iniciada** (o en una pestaña incógnito).
2. Mirá el login en **modo oscuro y en modo claro** (toggle del sistema operativo o el que tenga
   la app).
   - ✅ Esperado: el logo real de KAIROX (marca celeste con ícono de circuito) en una placa
     oscura, el resto de la tarjeta en violeta/tokens del sistema — nada de fondo cian/violeta
     plano de antes.
3. Probá también **"Registrarse ahora"** y **"Olvidé mi contraseña"** — mismo chequeo visual.
4. Iniciá sesión y andá a **Plan de Cuentas / Cheques** — mirá los botones sólidos ("Nuevo
   Asiento", "Nueva Cuenta", "Registrar Cheque", etc.).
   - ✅ Esperado: texto **blanco** sobre fondo violeta (antes era negro sobre violeta, se cambió
     por contraste — debería seguir viéndose bien, no roto).
5. Dentro de **Plan de Cuentas**, recorré los tabs internos (Plan de Cuentas / Asientos / Balance
   / Estado de Resultados / Balance General / Libro Mayor / Períodos) en modo claro y oscuro — era
   la sección que más se apartaba del patrón del resto de la app.

**Si algo se ve mal:** sacá captura y contame — se corrige al toque.

---

## Bloque C — Hardware real: cámara y QR MercadoPago (Luciano, celular)

Las dos únicas cosas del sistema que **no se pueden verificar sin un dispositivo físico real** —
todo lo demás ya se probó por código, sandbox o navegador de escritorio.

### C.1 — Escaneo de código de barras por cámara (nunca probado con hardware real)

1. Entrá al POS **desde tu celular** — probá con **Android**, y si tenés un iPhone a mano
   también (son los dos casos que importa diferenciar: iOS no tiene la API nativa de cámara que
   sí tiene Android, por eso se usó una librería que funciona igual en los dos, pero nunca se
   probó de verdad en iPhone).
2. En el buscador de productos, tocá el ícono de cámara.
3. Aceptá el permiso de cámara cuando el navegador lo pida.
4. ✅ Esperado: se abre un modal con el video de la cámara **trasera** (no la selfie) y un
   recuadro guía.
5. Apuntá a un código de barras real de un producto ya cargado.
6. ✅ Esperado: en cuanto lee bien el código, el modal se cierra solo, el producto se agrega al
   carrito y aparece un toast verde de confirmación.
7. Probá con un código que **no** exista en el catálogo (tachar uno con marcador, o usar uno de
   prueba no cargado).
8. ✅ Esperado: toast rojo "Código no encontrado", modal se cierra, nada se agrega.
9. Probá **denegar** el permiso de cámara cuando el navegador pregunte.
10. ✅ Esperado: mensaje claro dentro del modal, sin que la pantalla se rompa.

**El dato más importante de todo el plan:** si en iPhone la cámara no abre o el modal queda
cargando para siempre — es justo lo único que el entorno de pruebas no pudo simular.

**⚠️ Resultado (12/08, Luciano):** anduvo desde el celular, pero **demora mucho en levantar la
cámara**. Además, **desde la cámara de una PC no funcionó**. Causa técnica ya diagnosticada leyendo
el código (no arreglada todavía — queda para la próxima sesión): `EscanerCamaraModal.jsx` pide la
cámara con una restricción **estricta** `facingMode: 'environment'` (cámara trasera obligatoria).
Una notebook/PC normalmente solo tiene una cámara frontal, sin "trasera" — al no poder cumplir esa
restricción exacta, el navegador puede tardar en negociar antes de fallar, o directamente rechazar
el acceso. **Fix propuesto (no aplicado):** cambiar a `{ ideal: 'environment' }` en vez de la forma
estricta, así el navegador cae de forma prolija a la única cámara disponible (frontal) en vez de
demorar/fallar — sin afectar el comportamiento ya correcto en celular (que sí tiene cámara trasera
y la sigue prefiriendo).

### C.2 — QR MercadoPago con un cobro real (regresión del fix de CORS)

1. Desde el celular o la compu, entrá a la URL de producción normal (no hace falta buscar una URL
   de deploy específica).
2. Hacé una venta de prueba chica y cobrá con **"QR MercadoPago"**.
3. ✅ Esperado: el QR se genera sin error en pantalla ni en consola (si podés abrir F12 → Console,
   no debería aparecer nada en rojo con "CORS" o "Failed to fetch").
4. Escaneá el QR con la app de MercadoPago y pagá el monto chico.
5. ✅ Esperado: la venta se confirma sola en el POS entre 60 y 70 segundos después de pagado (el
   poller automático, no hace falta refrescar la pantalla).

**✅ Resultado (12/08, Luciano): listo y OK.**

---

## Bloque D — Motor de Facturación ARCA: repaso final (informativo, ya cerrado)

Esto **ya se probó y quedó verificado** el 10-11/08 (`PLAN_ROBUSTEZ_FACTURACION_ARCA.md` +
`PLAN_PRUEBAS_NADIA_2026-08-11.md`, Bloques 1 y 2 ✅). Se incluye acá solo para que quede un
cierre explícito, no requiere que repitas nada.

- Los 3 comprobantes del incidente original (**20260806-001, -008, -011**) terminaron sus 5
  reintentos automáticos sin que ARCA destrabara el número, y quedaron en **"Revisión manual"**
  con motivo **"Reintentos agotados"** — comportamiento esperado y seguro del fix, no una falla.
  Si en algún momento entrás al portal de ARCA y confirmás a mano que alguno sí tiene CAE, ahí sí
  aplicaría el **Bloque 3** de `PLAN_PRUEBAS_NADIA_2026-08-11.md` ("Marcar resuelta" con CAE
  real) — hasta entonces, quedan en ⬜ sin necesidad de acción.
- El mensaje que veías contradictorio ("no hace falta que hagas nada todavía" al lado de
  "reintentos agotados") ya está corregido — si abrís cualquiera de los 3 en el Monitor, el
  mensaje ahora debería leerse consistente con el estado real.

**Único chequeo opcional:** si querés, abrí el Monitor y confirmá que el mensaje de esos 3 ya no
suena contradictorio. No es obligatorio, es solo para que lo veas con tus propios ojos.

---

## Bloque E — Acciones administrativas pendientes (Luciano, 2 clicks)

No son pruebas de la app — son configuraciones que solo se hacen desde un panel externo, y llevan
tiempo abiertas sin que nadie las toque:

1. **Supabase → Authentication → Policies → "Leaked password protection".** Activarlo — gratis,
   un toggle, mejora la seguridad de las contraseñas de todos los usuarios.
2. **3 filas huérfanas en la cola de ARCA** (`facturas_pendientes_arca`, sin comprobante
   asociado — restos de pruebas del 06/08 ya borradas). Son invisibles en el Monitor y no afectan
   nada, pero quedaron sin borrar porque el `DELETE` de limpieza requiere tu confirmación
   explícita (acción destructiva en producción). Decime si las borro o las dejamos — literalmente
   no importa cuál elijas, es solo prolijidad.

---

## Bloque F — Decisión de negocio (recordatorio, ya en curso aparte)

**Plan free de Supabase — vence el 17/08.** Ya se está gestionando en paralelo a este plan de
pruebas (ver la sección al principio de `CONTEXT.md` y `PLAN_MIGRACION_SUPABASE.md`) — se lista
acá solo para que no se pierda de vista mientras se corre el resto de este documento. No requiere
ninguna prueba, requiere una decisión tuya entre pagar o migrar.

---

## Qué contarme al terminar

Para cada bloque (A, B, C): ✅/⚠️ por cada paso, con captura si algo no coincide. D es solo
confirmación visual opcional. E son 2 decisiones simples. F ya lo sabés.

Con A, B y C cerrados, **no queda ningún hilo de prueba abierto en todo el proyecto** — todo lo
que sigue pendiente después de esto seria: la decisión de Supabase (negocio, no prueba) y
cualquier hallazgo nuevo que salga de este mismo barrido.
