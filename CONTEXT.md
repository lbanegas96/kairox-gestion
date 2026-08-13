# KAIROX Gestión — Contexto de Sesión

## ✅ Cotizaciones: edición con historial + IVA por línea + descuento global (12/08)

Pedido de Luciano, investigado contra SAP B1 y el mercado (Salesforce/HubSpot/Zoho/QuickBooks
Estimates) antes de construir — las tres fuentes convergieron en la misma regla, aplicada acá:

- **Edición**: nueva RPC `actualizar_cotizacion` (SECURITY DEFINER, transacción atómica
  cabecera+ítems). Editable en Borrador/Enviada/Aprobada/Rechazada; **bloqueada una vez
  Convertida** (ya generó una venta real — el cambio va en ese documento, no reescribiendo el
  original). Botón "Editar" en el detalle reusa el mismo modal/form de "Nueva Cotización".
- **Historial de cambios**: reusa `audit_log`/`fn_audit_trigger()` que YA existía (mig.001) y
  YA estaba enganchada a `cotizaciones` — solo faltaba engancharla a `cotizacion_items`
  (mig.318). Vista legible en el detalle con toggle a JSON crudo, mismo patrón que "Ver detalle
  técnico" del Monitor ARCA.
- **IVA por línea**: `cotizacion_items.alicuota_iva` nueva (mismo patrón que
  `comprobante_items`/`devolucion_items`, mig.262), autocompletada desde `productos.alicuota_iva`
  al elegir un producto. La letra probable (A/B/C) sale de `determinarTipoComprobante()` — la
  misma función que ya deciden las facturas reales — **no un toggle manual en Configuración**
  (se descartó esa idea: podría desincronizarse de lo que la ley determina según la condición de
  IVA del emisor y el receptor). Neto/IVA se muestran solo si da "A", igual que `FacturaPDF.jsx`
  ya hace — aplicado también al PDF de la cotización.
- **Descuento global**: `cotizaciones.descuento` ya existía desde la migración original (002,
  nunca conectado a la UI) — ahora tiene su campo en el formulario, aplicado después de los
  descuentos por línea (mismo orden que SAP).

Verificado: 153/153 tests, `eslint` 0 errores, `vite build` limpio. La RPC se probó contra un
comprobante real (COT-00006) dentro de una transacción con `ROLLBACK` — cálculos exactos y el
guard de "convertida" bloqueando correctamente (probado contra COT-00001), sin persistir nada.
También se encontró y corrigió al pasar: `anon` podía ejecutar la RPC pese al `REVOKE ALL FROM
PUBLIC` (Supabase da grants por defecto a `anon` en funciones nuevas, no cubiertos por ese
revoke genérico — mig.318b).

De paso, mientras se armaba esto: el combo de productos cortaba a 10 resultados incluso con el
buscador vacío (con Nalux en 17 productos activos, 7 nunca aparecían) — subido a 50.

### Fixes posteriores encontrados por Luciano probando en vivo (13/08)

1. **Enter en el combo de productos agregaba fila en vez de seleccionar** — el atajo "Enter
   agrega ítem" le ganaba al Enter de confirmar el producto resaltado en el desplegable. Ahora
   Enter prioriza seleccionar el producto si el desplegable está abierto con resultados.
2. **Tab después de elegir un producto saltaba a Cliente** en vez de seguir en la fila — el
   `<button>` del desplegable se desmontaba al seleccionar y el navegador perdía el foco
   (reseteado a `<body>`), así el siguiente Tab arrancaba desde el principio del formulario.
   Ahora se reenfoca Cantidad explícitamente después de seleccionar (click o Enter).
3. **Los totales no mostraban el descuento por línea** — "Subtotal" ya venía con los descuentos
   de línea aplicados en silencio, así un ítem con % Desc. propio y 0% global no dejaba ningún
   rastro visible en el resumen. Ahora "Subtotal" es precio de lista sin descuentos y
   "Descuento" suma línea + global — mismo criterio que ya usaba `CotizacionPDF.jsx` (que nunca
   tuvo este bug). Aplicado también en `ModalDetalleCotizacion.jsx`.
4. **Historial de cambios con ruido inentendible** — cada guardado de una edición borraba y
   reinsertaba TODOS los ítems (mig.318 original), así el historial mostraba cada ítem como
   "quitado"+"agregado" en cada save, se hubiera tocado o no. Corregido en mig.319: la RPC ahora
   recibe el `id` de cada ítem existente y diffea — `UPDATE` solo si algo cambió de verdad
   (`IS DISTINCT FROM` campo a campo), `INSERT` solo lo nuevo, `DELETE` solo lo sacado. Un ítem
   intacto no genera ninguna fila de auditoría. **Patrón a replicar tal cual en Pedidos/OC** — no
   repetir el delete-all+insert-all original.

Verificado: 156/156 tests, `eslint` 0 errores, `vite build` limpio. La RPC v2 se probó contra
COT-00025 (real, con descuento de línea) dentro de transacciones con `ROLLBACK`: edición con un
solo campo cambiado → 1 fila de auditoría (no 3); ítem nuevo agregado → 1 INSERT; ítem quitado →
1 DELETE; ítems intactos → 0 filas; guard de "convertida" (COT-00001) sigue bloqueando. `anon`
sigue sin poder ejecutar la RPC (`has_function_privilege` en false). Sin persistir nada.

## 🔧 Escaneo por cámara — cuelgue real en producción, cambiado a diagnóstico directo (12/08)

Nadia probó el escaneo en tanda en producción y encontró un problema más serio que el anterior:
**con el permiso de cámara ya concedido de antes, la pantalla queda en negro y nunca conecta** — no
vuelve a pedir permiso, no muestra error, se queda así hasta que salta el timeout de 10s. Se
descartó que fuera otra pestaña/app usando la cámara (confirmado con ella). El error de consola que
mandó ("A listener indicated an asynchronous response...") es de una extensión de Chrome, no
relacionado.

**Causa del cambio (no se pudo confirmar la causa RAÍZ — no hay forma de reproducir un cuelgue de
`getUserMedia` sin la cámara física real):** hasta ahora se usaba `reader.decodeFromConstraints()`,
que le pide la cámara a `getUserMedia` **por dentro**, como caja negra — si algo se cuelga ahí
adentro, no hay manera de saber si el problema es el pedido a la cámara en sí o algo posterior en
la librería ZXing.

**Cambio (12/08):** se separó el pedido de cámara de la decodificación. Ahora se llama
`navigator.mediaDevices.getUserMedia()` directamente, envuelto en un `Promise.race` con un timeout
propio de 10s — si el timeout gana la carrera, se dispara un `AbortError` explícito. Recién con el
stream ya obtenido se lo pasa a `reader.decodeFromStream()` (método público de la misma librería,
que es lo que `decodeFromConstraints` hace internamente de todos modos). Con esto, la próxima vez
que pase, el mensaje de error va a decir con precisión si el problema fue conseguir la cámara del
sistema operativo o algo posterior — antes decía un genérico "tardó demasiado" sin distinguir nada.
Mensaje de error también mejorado: sugiere directamente cerrar otras pestañas/programas que puedan
tener la cámara tomada (Zoom, Teams, otra pestaña de KAIROX, la app Cámara de Windows).

Verificado: `eslint` 0 errores, 153/153 tests, `vite build` limpio. **No se pudo verificar que esto
resuelva el cuelgue real** — el entorno de pruebas no tiene acceso a cámara física. Si vuelve a
pasar, el mensaje de error que va a mostrar ahora es la pista clave para el próximo paso.

## ✅ Escaneo por cámara — escaneo en tanda + beep (12/08, pedido de Nadia)

Nadia probó los fixes de velocidad/apertura y los confirmó andando, y pidió dos mejoras de UX
mientras tanto: que la cámara **no se cierre** al leer un código (hoy había que reabrirla producto
por producto), y un **sonido de confirmación** como los lectores de supermercado.

**`EscanerCamaraModal.jsx` — reescrito para escaneo continuo:**
- El modal ya no se cierra solo al detectar un código. Queda abierto, cada lectura se suma a una
  lista lateral ("Escaneados — N productos") con nombre + código, y sigue escaneando.
- **Anti-repetición:** el mismo código leído dos veces en menos de 2s se ignora — sin esto, un
  producto quieto frente al lente se cargaría decenas de veces por segundo (la cámara decodifica
  varias veces por segundo).
- **Beep sintetizado con Web Audio** (no un archivo de audio — no agrega peso al bundle, no puede
  fallar por 404/caché): tono agudo corto si el código existe en el catálogo, dos tonos graves si
  no. El `AudioContext` se crea al abrir el modal, que es un click del usuario — el gesto que los
  navegadores exigen para permitir audio.
- **Flash de color** sobre el video (verde/rojo, 600ms) como refuerzo visual del mismo resultado,
  para cuando el local tiene ruido y no se escucha el beep.
- `onDetectado` cambió de contrato: antes no devolvía nada (el padre mostraba un toast y cerraba el
  modal), ahora devuelve `{ ok, nombre }` para que el modal arme su propia lista. Actualizado en
  `PanelProductos.jsx` (`handleDetectadoCamara`).
- El callback vive en un `ref` para que un re-render del padre (agregar cada producto dispara
  render de `PanelProductos`) no reinicie la cámara a mitad del escaneo — el efecto que abre la
  cámara depende solo de `open`, no de la identidad de `onDetectado`.

Verificado: `eslint`/tests/`vite build` limpios, modal probado en el navegador (abre, muestra la
lista vacía, el camino de error sigue andando — la cámara real no se puede probar en este entorno).
**Pendiente: que Nadia confirme en producción** que el beep suena y la lista se va llenando bien
escaneando varios productos seguidos.

## ✅ Escaneo por cámara — 3 causas encontradas y arregladas (12/08)

Luciano había diagnosticado el 12/08 que el escáner no abría en PC por pedir la cámara trasera como
restricción estricta, y lo dejó anotado sin arreglar. Nadia lo volvió a probar y aportó el síntoma
que destrabó el caso: **"hay que acercar mucho el producto para que tome el código"**, en PC *y* en
celular. Eso mostró que el `facingMode` era solo una de tres causas, y ni la más importante:

1. **Resolución de video (la causa principal):** nunca se le pedía calidad a la cámara → el
   navegador entregaba ~640x480, resolución a la que un código de barras solo se lee casi pegado al
   lente. Ahora pide `1280x720` ideales.
2. **Sin enfoque continuo:** la cámara quedaba fija en un plano (de ahí el "queda en negro un buen
   rato" en celular). Agregado `focusMode: 'continuous'` en `advanced`, para que el navegador que
   no lo soporte lo ignore en vez de fallar el pedido entero.
3. **Lector probando todos los formatos:** `BrowserMultiFormatReader` prueba QR/DataMatrix/PDF417/
   Aztec en cada cuadro. Cambiado a `BrowserMultiFormatOneDReader` (solo códigos lineales de
   retail: EAN-13/EAN-8/UPC/Code128/Code39/ITF) — bastante menos trabajo por cuadro.

Más el fix de `facingMode: { ideal: 'environment' }` que Luciano ya había propuesto (con fallback a
cualquier cámara **solo** ante errores de restricción, no ante permiso denegado — reintentar ahí no
arregla nada y le dispara al usuario un segundo cartel de permiso), y un **corte de seguridad a los
10s** para que el modal no quede colgado en negro con el spinner girando indefinidamente.

Se agregó además un indicador de **la resolución real** que entregó la cámara, abajo a la derecha
del video: si dice `1280×720` la mejora se aplicó; si dice `640×480`, esa cámara no da más (límite
físico del hardware, no del código). Sirve para diagnosticar de un vistazo sin adivinar.

Verificado: `eslint` 0 errores, 153/153 tests, `vite build` limpio, camino de error probado en el
navegador. Detalle completo en `PLAN_PRUEBAS_MAESTRO_2026-08-11.md`, sección C.1.

**2ª vuelta — Nadia probó en producción y quedó así:**
- **Celular: ✅ resuelto**, ahora lee el código al instante (antes no lo tomaba).
- **PC: 🟡 lee, pero cuesta** — hay que enfocar un rato. Esperable: las webcams de notebook son de
  foco fijo y baja calidad. El indicador de resolución del modal lo confirma de un vistazo (si en
  PC dice `640×480` y en celular `1280×720`, es límite del hardware, no del código). Para el
  mostrador el lector físico (keyboard wedge) sigue siendo el camino recomendado.
- **Apertura lenta con pantalla negra: 🔴 seguía pasando en ambos** — y ya pasaba antes de todos
  estos cambios (lo reportó Luciano en la primera prueba del Bloque C), no lo introdujo ninguno.
  **Causa:** pedirle alta resolución a `getUserMedia` *de entrada* obliga al hardware a arrancar
  directamente en ese modo — era el precio de la mejora de la 1ª vuelta. **Fix (aplicado):**
  arranque en dos etapas — abrir con lo mínimo (`facingMode` y nada más) para que el video aparezca
  cuanto antes, y recién con la cámara andando subir a 1280x720 + enfoque continuo vía
  `track.applyConstraints()`, que ajusta sin reiniciar el dispositivo. Si la cámara no lo soporta,
  falla solo ese ajuste y el escaneo sigue igual. Más feedback honesto mientras carga ("Encendiendo
  la cámara…" y, a los 2,5s, "algunas cámaras tardan unos segundos") en vez de un rectángulo negro
  mudo. **Pendiente: que Nadia confirme en producción si la apertura mejoró.**

## 📌 Pendiente (sin urgencia) — repo de GitHub público, bajo cuenta personal (12/08)

Verificado hoy: el repo (`github.com/lbanegas96/kairox-gestion`) está **público** y vive en la
cuenta **personal** de Luciano, no en una organización. Nadia preguntó si conviene pasarlo a
privado y le preocupaba que eso tumbara el deploy de Vercel — aclarado que no es así, queda
anotado acá para cuando decidan hacerlo:

- **Pasar el repo a privado NO tira abajo el sitio ya deployado** — Vercel sigue sirviendo lo que
  ya está construido, no depende de que el repo siga siendo público en el momento del cambio.
- **Lo único que puede verse afectado:** los **próximos** pushes podrían dejar de auto-deployar si
  la integración GitHub↔Vercel no tiene permiso para leer repos privados (depende de cómo esté
  instalada la GitHub App de Vercel en la cuenta). Se soluciona en 2 minutos desde GitHub →
  Settings → Applications → Vercel (o desde el panel de Vercel), dándole acceso al repo. No hay
  ventana de downtime real si se hace con calma.
- **Por qué conviene hacerlo en algún momento:** con el repo público, cualquiera puede ver toda la
  arquitectura y lógica de negocio (no las claves — esas están bien afuera vía `.gitignore` — pero
  sí toda la estructura de RLS, el diseño del sistema, y este mismo `CONTEXT.md` con bastante
  detalle operativo interno). No es urgente, pero es una mejora de seguridad razonable para un
  sistema multi-tenant con datos financieros reales.
- **Sugerencia aparte, no pedida:** en algún momento también podría convenir mover el repo de la
  cuenta personal de Luciano a una organización de GitHub compartida (Kairox IA), para que el
  acceso no dependa de una sola persona — pero eso es un tema aparte, más grande, para decidir con
  calma y no se toca ahora.

No se tocó nada — el repo sigue público como está. Sin relación con la migración de Supabase (son
sistemas distintos), por eso queda documentado acá aparte y no en `PLAN_MIGRACION_SUPABASE.md`.

## ✅ Bloque A del Plan Maestro — fix del Mapa de Relaciones (Cotizaciones) verificado en vivo (12/08)

Nadia bajó el trabajo de Luciano de esta mañana y me pidió correr el Bloque A de
`PLAN_PRUEBAS_MAESTRO_2026-08-11.md` (el único bloque que nos tocaba a nosotras — el resto es de
Luciano: celular, sus ojos, o su decisión). Probado en local con su sesión, contra el mismo
backend de producción.

**Resultado: ✅ pasó completo.** El nodo Cotización aparece al principio de la cadena y el badge
"actual" marca correctamente — probado en 4 cotizaciones convertidas distintas (COT-00018, -00017,
-00014, -00001), confirmado a nivel de clase CSS (`ring-2`), no solo leyendo el texto. Sin
regresión: abrir el mapa desde una Factura o un Pedido facturado sigue marcando "actual" bien,
como siempre. Sin errores nuevos en consola. Detalle completo en
`PLAN_PRUEBAS_MAESTRO_2026-08-11.md`, Bloque A.

**Con esto, el fix de Luciano de ayer queda confirmado por una segunda persona (código + prueba en
vivo) — no queda ningún hilo de prueba abierto salvo lo que ya era exclusivamente de Luciano**
(Bloque B rebrand, C.1 escaneo de cámara en PC sin arreglar todavía, E acciones administrativas, F
decisión de Supabase — sigue sin resolverse, quedan 5 días al 17/08).

## 🧪 Bloque C del Plan Maestro — C.2 OK, C.1 con hallazgo diagnosticado (12/08)

Luciano corrió el Bloque C (hardware real) de `PLAN_PRUEBAS_MAESTRO_2026-08-11.md` desde su celular:

- **C.2 (QR MercadoPago, cobro real) — ✅ listo y OK.**
- **C.1 (escaneo de código de barras por cámara) — ⚠️ anduvo, con 2 problemas:** demora mucho en
  levantar la cámara, y **desde la cámara de una PC no funciona** (sí desde el celular).

**Causa ya diagnosticada leyendo el código, NO arreglada todavía** (queda para la próxima sesión):
`EscanerCamaraModal.jsx` pide la cámara con `facingMode: 'environment'` como restricción **estricta**
(cámara trasera obligatoria). Una PC/notebook normalmente solo tiene cámara frontal — al no poder
cumplir esa restricción exacta, el navegador tarda en negociar antes de fallar, o rechaza el acceso
directamente. **Fix propuesto:** cambiar a `{ ideal: 'environment' }` en vez de la forma estricta,
para que caiga de forma prolija a la única cámara disponible en vez de demorar/fallar — sin tocar el
comportamiento ya correcto en celular (que sí tiene trasera y la sigue prefiriendo). Detalle completo
en `PLAN_PRUEBAS_MAESTRO_2026-08-11.md`, sección C.1.

Quedan sin probar todavía: Bloque B (rebrand visual) y Bloque E (2 acciones administrativas).

## 🧪 Plan Maestro de Pruebas — barrido completo de todo lo pendiente (11/08)

`PLAN_PRUEBAS_MAESTRO_2026-08-11.md` junta en un solo documento **todo** lo que seguía abierto,
disperso hasta ahora en varios planes sueltos: verificar el fix del Mapa de Relaciones de hoy
(Nadia, Bloque A), confirmar visualmente el rebrand de colores (Luciano, Bloque B), las 2 pruebas
que necesitan hardware real — cámara y QR MercadoPago (Luciano con su celular, Bloque C) —, un
repaso informativo del motor ARCA ya cerrado (Bloque D), y 2 acciones administrativas de un click
(Bloque E). Todo lo demás del proyecto (Fidelización, Multi-caja, Modo Offline, COGS, Cierre de
Ejercicio, etc.) ya está confirmado cerrado — no hace falta retestear nada de eso.

## ✅ 3 items de backlog cerrados mientras se espera la decisión de Supabase (11/08)

Mientras Luciano decide entre pagar Pro o migrar (ver sección de abajo), se avanzó con el backlog
menor que había quedado documentado, sin tocar nada relacionado a la migración:

1. **Filas huérfanas en la cola ARCA — investigadas, no borradas.** 3 filas de
   `facturas_pendientes_arca` con `comprobante_id=NULL` (FK `ON DELETE SET NULL`) eran restos de
   comprobantes de prueba del 06/08 rechazados por ARCA y luego borrados — invisibles en el Monitor
   (la vista arranca `FROM comprobantes`), sin riesgo, pero un `DELETE` de limpieza quedó bloqueado
   por el clasificador de auto mode (acción destructiva en prod). **Pendiente: confirmar con
   Luciano si se borran** — comando ya armado, solo falta luz verde.
2. **Mensaje contradictorio de `mensajeHumano()` — resuelto.** El código 10016 mostraba siempre
   "no hace falta que hagas nada todavía" incluso después de agotar los 5 reintentos automáticos,
   contradictorio al lado del badge "reintentos agotados". Ahora `mensajeHumano(raw, {agotado})`
   distingue ambos casos. `arca-worker` redeployado (v26). Los 3 comprobantes del incidente
   (06-001/-008/-011) tuvieron su mensaje ya guardado corregido a mano (UPDATE dirigido, no
   destructivo) para que Nadia no vea el texto viejo si los revisa mañana.
3. **Bug del Mapa de Relaciones ("actual" no marca desde Cotizaciones) — resuelto.**
   `MapaRelaciones.jsx` nunca armaba un nodo de cotización en la cadena. Al investigar se encontró
   que el intento inicial de fix (basado en `comprobantes.cotizacion_id`) hubiera sido inefectivo:
   esa columna existe en el schema pero está **siempre en NULL** en los datos reales — la relación
   real vive al revés, en `cotizaciones.comprobante_id` (confirmado: 6/20 cotizaciones convertidas
   la tienen poblada). Corregido para buscar por esa columna; ahora la cotización aparece como
   nodo propio en la cadena (Cotización → Pedido → Entrega → Factura) y el badge "actual" marca
   correctamente. Deployado a Vercel.

Verificado: 153/153 tests, `eslint` 0 errores (solo warnings preexistentes de PropTypes), `vite
build` limpio. No se pudo verificar visualmente en el navegador (sin sesión activa ni credenciales
a mano) — verificación fue a nivel de código + consultas SQL directas contra los datos reales.

## 🔴 DECISIÓN PARA LUCIANO — Plan free de Supabase vence el 17/08, elegir camino (11/08)

**Leer esto primero.** La organización NALUX sigue en plan `free` de Supabase (verificado en vivo
hoy contra la API: `get_organization` devuelve `"plan":"free"`) y el proyecto queda **restringido
desde el 17/08/2026** por cuota excedida — quedan **6 días** desde hoy. Si no se resuelve, se cae
la producción de todos los clientes.

Nadia planteó el tema: el producto todavía no factura como para justificar pagar un plan pago, y
hoy no hay presupuesto para eso. Dos caminos, a decidir entre los dos:

1. **Pagar el plan Pro** (~US$25/mes) en la cuenta actual — resuelve esto en minutos, sin ningún
   riesgo de migración, cuando/si hay presupuesto.
2. **Migrar todo a una organización nueva, también en plan free** — compra tiempo sin gastar, pero
   es trabajo técnico real y no es una solución permanente (si el uso sigue creciendo, se puede
   volver a topar con el mismo límite ahí).

**Quedó documentado en detalle, paso a paso, en [`PLAN_MIGRACION_SUPABASE.md`](PLAN_MIGRACION_SUPABASE.md)**
— qué se copia, qué hay que rehacer a mano (importante: el token de MercadoPago y el certificado de
AFIP están en el Vault de Supabase, encriptado por proyecto, **no se pueden copiar** — hay que
volver a cargarlos desde la propia pantalla de Configuración de KAIROX, no es "empezar de cero" la
integración, solo re-pegar el mismo dato), y las 9 fases de ejecución si se elige migrar.

**No se tocó nada todavía** — es sólo el documento, a la espera de que Luciano decida cuál de los
dos caminos tomar. Si elige migrar, Claude puede hacer todo el trabajo técnico (volcado de datos,
redeploy de funciones, verificación); si elige pagar, no hace falta hacer nada de esto.

## ✅ Plan de robustez ARCA — Bloques 1 y 2 verificados en vivo por Claude (11/08)

Nadia bajó el trabajo de Luciano de anoche (plan de robustez de facturación AFIP/ARCA, ver sección
de abajo), inició sesión en `localhost:3000` y me pidió probar los Bloques 1 y 2 de
`PLAN_PRUEBAS_NADIA_2026-08-11.md` en su lugar (mismo backend/Supabase que producción). Resultado
completo y detallado en ese archivo — resumen:

- **Bloque 1 (Monitor de Facturación AFIP) — ✅ pasó.** Estado "Revisión manual" con motivo claro
  ("se agotaron los 5 reintentos..."), toggle "Ver detalle técnico" funcionando en ambos sentidos.
  ⚠️ Encontré una inconsistencia menor: el mensaje humano del "Último error" queda desactualizado
  una vez que el comprobante ya se rindió (sigue diciendo "no hace falta que hagas nada todavía"
  al lado de "se agotaron los reintentos"). No se tocó — queda en el backlog, no rompe nada.
- **Bloque 2 (velocidad) — ✅ pasó, mejor de lo esperado.** Venta de prueba $2 (20260811-001):
  **1,6 segundos** entre encolar y conseguir CAE real (0001-00000040), contra los ~30s esperados.
- **Bloque 3 — ⬜ no aplica todavía** (ninguno de los 3 comprobantes del incidente tiene CAE
  confirmado a mano en el portal de ARCA).

Los 3 comprobantes del incidente original (20260806-001/-008/-011) agotaron sus reintentos
automáticos y quedaron en "Revisión manual" — comportamiento esperado del fix, no una falla (ARCA
nunca destrabó esos 3 números puntuales). Sin urgencia, sistema sigue en homologación.

## ✅ Plan de robustez del motor de Facturación AFIP/ARCA — 3 fases completas (10/08)

Pedido de Luciano tras el incidente de abajo ("Facturas C sin CAE"): reforzar el motor de emisión
existente en 3 ejes — que reintente solo lo máximo posible, que no demore, y que los mensajes de
error sean claros. Metodología: barrido del motor actual + auditoría de código dedicada
(`sap-motor-contable-auditor`) + enfoque SAP (`sap-b1-consultor`) + investigación de mercado —
las 3 fuentes convergieron en la misma causa raíz. Plan completo en
`PLAN_ROBUSTEZ_FACTURACION_ARCA.md`.

**Causa raíz confirmada:** el worker solo consultaba `FECompUltimoAutorizado` (cuenta el último
número) pero nunca `FECompConsultar` (trae el comprobante real, con su CAE) — por eso ante
ambigüedad se rendía directo a revisión manual en vez de verificar primero. Patrón estándar de la
industria ausente: "confirm-before-repeat".

**Fase 1 — Reconciliación automática (mig.315, `arca-worker` v21):**
`feCompConsultar`/`consultarComprobante` nuevos; ante ambigüedad, el worker ahora consulta cada
número en disputa contra ARCA (total + documento) antes de rendirse — si matchea, persiste el CAE
real sin re-emitir; si no, recién ahí intenta CAEA y después revisión manual (antes esa rama nunca
llegaba a intentar CAEA). Persistencia del CAE movida a una RPC atómica
(`fn_persistir_cae_emitido`, una sola transacción — antes 3 updates HTTP sueltos con riesgo real de
"CAE fantasma"). Recuperación de filas `'procesando'` colgadas >10min. Hardening de permisos en
`facturas_pendientes_arca` (solo RPC, ya no `.update()` directo desde `authenticated`).

**Fase 2 — Velocidad (mig.316):** `fn_queue_factura_arca` ahora despierta a `arca-worker` con un
`net.http_post` fire-and-forget apenas encola algo nuevo (mismo patrón ya probado del cron de
mig.102) — el primer intento ocurre en segundos, no hasta 5 min. `max_intentos` default
sincronizado a 5 (antes 3 en la tabla vs. 5 hardcodeado en el worker — la barra del Monitor mentía).

**Fase 3 — Claridad de errores (mig.317, `arca-worker` v22):** diccionario `mensajeHumano()` en
`_shared/afip.ts` traduce los códigos AFIP más frecuentes (10016, 10197, 10246, 15008, 15004) a
lenguaje humano accionable, guardado en paralelo (`error_mensaje_usuario`/`error_afip_usuario`) sin
pisar el mensaje técnico crudo. Nueva columna `motivo_definitivo` distingue "el sistema decidió no
reintentar" (ambigüedad) de "se agotaron los 5 reintentos" — antes se veían idénticos en el
Monitor. `MonitorFacturacionAFIP.jsx` y `SaleDetailModal.jsx` muestran el mensaje humano por
defecto con un toggle "Ver detalle técnico"; el diálogo "Marcar resuelta" ahora puede capturar el
CAE/Nº AFIP/vencimiento real si el usuario lo verificó a mano en el portal (antes dejaba el
comprobante "emitido" sin esos datos, legalmente incompleto).

**Verificado en vivo contra los 7 Facturas C reales atascados desde el 06/08:** 5 resueltos
(20260810-002 reconciliado directo al CAE real N°35 sin consumir número nuevo; 06-006, 10-005,
10-001, 10-006 emitidos con numeración real nueva una vez que el contador se puso al día).

**Los 3 restantes (06-001 $3.000, 06-008 $25.000 — apareció después, no estaba en el lote
original de 7 —, y 06-011 $121.000) repetían `[10016]` de forma consistente incluso con el
contador local ya al día.** Se probó y descartó la hipótesis de "un número específico quemado"
(fallback `ultimo+1`→`ultimo+2` desplegado v24, probado en vivo, `ultimo+2` rechazado igual —
revertido en v25). **Fix real:** `classifyArcaError` reclasificó `[10016]` de `'data'` a
`'ambiguous'` — antes exigía reencolar a mano cada vez; ahora reintenta solo con backoff
exponencial como cualquier error transitorio. Confirmado en producción (v25, ACTIVA): los 3
comprobantes están en `estado='reintentando'` con `intentos` subiendo automáticamente sin
intervención humana. Si ARCA no resuelve el desincronismo solo, caen a `error_definitivo` con
`motivo_definitivo='reintentos_agotados'` tras 5 intentos — parada segura y clara. Detalle
completo en `PLAN_ROBUSTEZ_FACTURACION_ARCA.md`.

Verificado además: `npx eslint` 0 errores (solo warnings preexistentes de PropTypes), `npx vite
build` limpio, 153/153 tests, probado en vivo en el Monitor (toggle técnico funcionando, mensaje
humano visible, sin errores nuevos en consola — el único warning es uno preexistente y no
relacionado de `TopClientes.jsx`).

## ✅ Facturas C sin CAE desde el 06/08 — causa raíz resuelta, 5/7 casos cerrados (ver arriba)

Aparte, ya documentado y con dueño desde antes: 16 comprobantes viejos (03/07 al 08/07) atascados
por RG 5616 (Condición IVA del receptor), marcados en el propio `error_mensaje` como
"no-relevante temporalmente el 2026-07-08 — fix de CondicionIVAReceptorId escrito pero no
deployado". Ese ya estaba en el radar de Luciano, no es un hallazgo nuevo.

## 🐛 Bug real — Mapa de Relaciones: "actual" nunca marca desde Cotizaciones (hallado 10/08)

Circuito completo probado en vivo (Claude, navegación autónoma por pedido de Nadia — "entrá y
revisá, todo lo que puedas probar hacelo"). Resultado: **funciona bien en 6 de los 7 puntos de
entrada**, con un bug real y reproducible en uno.

**Lo que anduvo bien:** barra de resumen (pasos/total/derivados), scroll de la cadena, click en un
nodo no-actual abre el panel de preview inline sin cerrar el modal, botón "Cerrar preview",
"Ver documento completo", toggle de pantalla completa, "Sin documentos relacionados — comprobante
independiente" (venta de POS sin relaciones), "Sin documentos relacionados — factura independiente"
(factura de compra cargada directa, sin recepción), lado Compras (Recepción→Factura), "Recepción
todavía sin facturar" (mensaje correcto), y el punto de entrada desde Pedidos (`ModalDetallePedido`
→ "Mapa de relaciones") marca bien el nodo "actual".

**El bug:** abrir el Mapa de Relaciones desde una Cotización ya convertida en venta **nunca marca
ningún nodo como "actual"** — se ve la cadena completa (Entrega→Factura) pero sin el badge violeta
que indica "estás viendo esto desde acá". Causa raíz (confirmada leyendo el código, no es
timing): en `src/components/shared/MapaRelaciones.jsx`, `resolveAndFetch()` guarda
`activoId = cotizacionId` (línea 291) pero después llama a `fetchMapaVenta()`, que arma la cadena
con nodos `origen/pedido/entregas/comprobante` — **nunca un nodo de tipo cotización**. Como
`isActivo(id)` compara contra nodos que existen en la cadena, un id de cotización nunca va a
matchear ninguno → el bug es 100% determinístico, no depende de qué cotización se abra. Afecta a
las 21 cotizaciones convertidas de Nalux (y a cualquier empresa). Los otros 4 puntos de entrada
(Pedido, Entrega, Recepción, Devolución) sí funcionan porque esas tablas SÍ generan su propio nodo
en la cadena.

Nota aparte, no confirmada como bug: al abrir el mapa desde un Pedido facturado hubo **una vez**
un flash de "No se pudo cargar el mapa de relaciones" que se resolvió solo al reintentar (la
segunda vez cargó perfecto, con "actual" bien marcado). Puede ser sólo lentitud de red del entorno
local — no se pudo reproducir de nuevo — pero si Nadia/Luciano lo llegan a ver en producción,
anotarlo.

No se tocó código — es un hallazgo para que Nadia/Luciano decidan cuándo entra en el backlog. No es
grave (visual/informativo, no rompe nada ni toca datos), pero sí un bug real en 1 de los 5 puntos
de acceso nuevos de la Fase 3 del rediseño (09/08).

---

**Última actualización:** 2026-08-10, noche (Claude — plan de robustez del motor AFIP/ARCA,
3 fases completas y deployadas a producción, ver sección de arriba. Resumen:

1. **Motor de Facturación AFIP/ARCA — reforzado en 3 ejes** (reintento automático, velocidad,
   claridad de errores), a pedido de Luciano tras el incidente de las Facturas C sin CAE de más
   abajo. Investigación (auditoría de código + enfoque SAP + mercado) + `PLAN_ROBUSTEZ_FACTURACION_ARCA.md`
   + mig.315/316/317 + `arca-worker` v21→v22, todo en producción. Verificado en vivo contra los 7
   comprobantes reales atascados: **5 resueltos** (1 reconciliado sin consumir número nuevo, 4 con
   numeración real nueva), **2 siguen en `error_datos`** (mismo `[10016]` en 3 reintentos,
   probable caché de ARCA, no una carrera de nuestro lado) — reintentar más tarde desde el Monitor.
   Apareció además un tercer comprobante suelto en error (20260806-008, $25.000) no investigado
   todavía.
2. **Fidelización por Puntos — 100% cerrada** (mismo hilo, antes de esto), las 3 fases confirmadas
   en vivo por Nadia en POS y ERP. Bug de UX documentado, no resuelto (falta botón directo "Nueva
   Venta" en el ERP).
3. **Bug de impresión del ticket 80mm** — corregido y confirmado por Nadia en producción.
4. **Fase 3 del rediseño del Mapa de Relaciones** — deployada el 09/08, verificada en vivo. 1 bug
   real sin resolver (badge "actual" no marca desde Cotizaciones) — cosmético, en el backlog.

Antes de este cierre, mismo hilo (09/08): Fases 1 y 2 del rediseño del Mapa de Relaciones. Y antes
de eso (07/08): auditoría contable sistemática de las 10 áreas — mig.314.

Pendiente real para la próxima sesión: los 2 (o 3, con el hallazgo suelto) comprobantes que
siguen sin CAE — reintentar desde el Monitor de Facturación AFIP cuando haya pasado más tiempo.

Nada queda a medio hacer ni sin commitear — repo sincronizado con origin/master.)

## 🐛 Ticket 80mm imprimía con columnas pegadas — corregido (10/08)

Nadia reportó: al exportar el ticket a PDF desde Adobe (probablemente "Guardar como PDF" en vez
de mandarlo directo a una impresora térmica real), la tabla de ítems salía con las columnas
literalmente pegadas sin espacio — "CantDescripción" y "$16.000,00$16.000,00" en la misma
palabra, ilegible.

**Causa real:** `TicketPrint.jsx` usaba CSS Grid (`grid-cols-[3ch_1fr_9ch_9ch]`) para la tabla de
ítems del formato 80mm — funciona bien en una impresora térmica real, pero algunos exportadores
de "imprimir a PDF" no calculan correctamente columnas grid con unidades `ch`/`fr` y las colapsan
sin separación. El formato A4 (al lado, en el mismo archivo) ya usaba una `<table>` HTML normal
y no tenía este problema — las tablas HTML son el layout más robusto entre motores de
impresión/PDF distintos.

**Fix:** se cambió el formato 80mm para usar también una `<table>` HTML (misma estructura y
alineación visual que antes: Cant/Descripción/P.Unit/Total), en vez de CSS grid. Sin cambios de
contenido ni de datos — sólo el layout de esa tabla.

**Confirmado por Nadia en vivo (10/08):** volvió a exportar un ticket a PDF (comprobante
20260810-002) y las columnas ya se ven separadas — "Cant Descripción P.Unit Total" y cada fila
con sus valores bien alineados. Cerrado.

Verificado: 9/9 tests de `TicketPrint.test.jsx` en verde (siguen pasando sin cambios), suite
completa 153/153, `eslint`/`vite build` en 0 errores.

## ✅ Mapa de Relaciones — rediseño estilo SAP B1, Fase 3 (puntos de acceso) — 09/08

Completa el rediseño de 3 fases (Fases 1/2 el 08/08, detalle más abajo). Hasta ahora el mapa solo
se podía abrir desde el documento final de cada circuito (Factura de venta / Factura de compra),
igual que en SAP B1 — ahora se puede abrir desde **cualquier eslabón**: Cotizaciones (ícono en la
fila), Pedidos (botón junto a "Flujo del documento" en el detalle), Entregas (ídem), Recepciones
(ícono en la fila, lado Compras), y Devoluciones — cliente y proveedor comparten el mismo
componente de detalle, así que un solo cambio cubrió los dos circuitos.

**Cómo se resuelve sin duplicar lógica:** `MapaRelaciones.jsx` ganó 5 props de entrada nuevas
(`cotizacionId`, `pedidoId`, `entregaId`, `recepcionId`, `devolucionId`). Cada una se resuelve al
comprobante/compra ancla vía los FK directos que ya tenía el schema (`pedidos.comprobante_id`,
`entregas.comprobante_id`, `recepciones.compra_id`, `devoluciones.comprobante_id`/`.compra_id`
según `tipo`) — cero cambios en `fetchMapaVenta`/`fetchMapaCompra`, que ya estaban probados desde
la Fase 1. El nodo "ACTUAL" ahora es el que efectivamente se abrió (nuevo estado `activoId` +
helper `isActivo(id)`), no siempre la factura como antes.

**Caso nuevo manejado con gracia:** si el documento de origen todavía no tiene comprobante/compra
vinculado (ej. un Pedido en borrador, una Cotización sin convertir), se muestra un mensaje
explícito ("todavía sin facturar") en vez de fallar o mostrar un mapa vacío confuso.

**Probado en vivo contra datos reales de producción** (solo lectura, sin mutar nada — sesión con
usuario ya logueado en el navegador de pruebas): pedido facturado (PED-20260707-001) → cadena
completa de 3 pasos con el Pedido marcado ACTUAL y la Factura como nodo clickeable aparte; pedido
en borrador (PED-20260725-003) → "Pedido todavía sin facturar..."; recepción (REC-2026-0012) →
resolvió bien la compra vinculada, badge "Compras" correcto; cotización aprobada sin convertir
(COT-00021) → "Cotización todavía sin facturar...". Cero errores nuevos en consola en los 4 casos.
Lint/build limpios, 153/153 tests.

## ✅ Mapa de Relaciones — rediseño estilo SAP B1, Fases 1 y 2 — 08/08

Pedido de Luciano: replicar la idea del Relationship Map del cliente web de SAP Business One
(capturas de referencia), con estilo KAIROX, totalmente funcional. Antes de construir: barrido de
lo que ya existía (`src/components/shared/MapaRelaciones.jsx` — el motor de datos ya era sólido,
el problema era solo visual) + estudio de mercado sobre el Relationship Map real de SAP B1 (qué
le gusta a los usuarios, qué les molesta). Plan completo con las 4 fases en
`PLAN_MAPA_RELACIONES.md`.

**Fase 1 (rediseño visual):** ícono por tipo de documento (antes solo color de borde), badges de
estado con color unificado, barra de resumen del circuito ("N pasos · Total · N derivados", al
estilo de la cabecera de SAP), cadena principal en scroll horizontal en vez de `flex-wrap` (ya no
se desordena con cadenas largas — el problema visual concreto que señaló Luciano), conector tipo
stepper, botón de pantalla completa. Sin tocar la lógica de datos. Se evaluó sumar React Flow
mencionado en el plan original pero se decidió no meter una dependencia nueva justo antes de las
pruebas de esta noche.

**Fase 2 (preview inline al hacer clic) — la mejora sobre SAP, no solo la copia:** el hallazgo más
repetido en la investigación de mercado fue que el Relationship Map de SAP "solo da alto nivel" —
para ver qué hay adentro de cada documento hay que abrirlo aparte, perdiendo el contexto del
circuito completo. Ahora un clic en cualquier nodo navegable (origen, pedido, entrega, NC,
devolución, recepción) abre un panel al costado DENTRO del mismo modal con los ítems reales del
documento — el header no pide nada nuevo (ya viaja en el nodo), solo los ítems se buscan aparte,
por tabla de detalle según el tipo (`comprobante_items`/`pedido_items`/`entrega_items`/
`recepcion_items`/`devolucion_items`, con `devolucion_prov` como alias de `devolucion` ya que
comparten tabla). Botón "Ver documento completo" para el que igual quiere navegar de una — ese sí
cierra el mapa (comportamiento viejo, ahora es una acción explícita en vez de la única opción).

**Probado en vivo contra una venta real** (20260806-011, Entrega→Factura, sesión activa de Nadia
en el navegador de pruebas — sin mutar nada, solo lectura): clic en el nodo Entrega mostró sus 4
ítems reales (Máquina de afeitar, Batidora Eléctrica, Mate, Celulares) sin cerrar el mapa; clic en
la ✕ del preview devolvió el layout a ancho completo; el botón de pantalla completa funcionó bien.
Verificado además: lint/build limpios, 153/153 tests, sin errores nuevos en consola (el único
warning que aparece es uno preexistente y no relacionado, de `TopClientes.jsx` en el Dashboard —
key duplicada "Consumidor Final", anotado pero no es de esta sesión).

**Queda la Fase 3** (agregar el botón "Mapa de relaciones" también en Cotizaciones, Pedidos,
Recepciones y modales de NC/ND — hoy solo está en el documento final de cada circuito, Ventas y
Compras) para después de las pruebas de esta noche.

**Circuito de pruebas completo sumado a `PLAN_PRUEBAS_SABADO_2026-08-08.md` (sección 5)** — cubre
ambos lados (Ventas/Compras), cadena larga vs. sin relaciones, cada tipo de nodo clickeable, cierre
del preview, pantalla completa, y navegación real desde "Ver documento completo".

## ✅ Auditoría contable sistemática (10 áreas) — 3 hallazgos, los 3 ya resueltos — mig.314

Pedido explícito de Luciano ("vamos con las auditorías faltantes"): correr la skill
`auditor-contable` completa contra el repo real (no memoria de sesiones previas), score por las
10 áreas RT FACPCE/IFRS. Informe completo en `INFORME_AUDITORIA_CONTABLE_2026-08-07.md`. Score:
6/10 verde, 3 amarillo, 1 rojo al momento de auditar.

**🔴 Crítico (el único rojo), resuelto mismo día:** `asientos_contables`/`asientos_items` no
tenían ninguna protección server-side — ni un trigger/constraint validaba `sum(debe)=sum(haber)`
antes de insertar, ni la política RLS (mig.132) distinguía `estado`, así que cualquier staff con
el permiso "Configuración" podía editar o borrar un asiento ya confirmado (y ya declarado a AFIP)
directo desde el navegador, sin pasar por ninguna RPC. Verificado que el gap era real antes de
tocar nada (`has_table_privilege('authenticated', 'asientos_contables', 'INSERT') = true`).

**Fix (mig.314):** 4 RPCs `SECURITY DEFINER` nuevas (`crear_asiento_manual`,
`crear_asiento_automatico`, `confirmar_asiento`, `anular_asiento`) + `REVOKE ALL ... FROM anon,
authenticated` sobre ambas tablas (mismo patrón "escritura exclusiva vía RPC" que
`cuenta_corriente_imputaciones`, mig.169) — de acá en más la única forma de tocar un asiento es
por RPC, y esas RPCs validan partida doble y período cerrado server-side antes de escribir. Los 7
sitios de `asientosAutoService.*` (venta, compra, ajuste de stock, NC/ND cliente y proveedor,
reversa) pasaron de 2 llamadas separadas (crear + confirmar, con ventana real de asiento huérfano
si la segunda fallaba) a una sola llamada atómica.

**Probado en sandbox contra Nalux ANTES de aplicar** (`BEGIN...ROLLBACK`, simulando la sesión de
un admin real vía `SET LOCAL request.jwt.claim.sub`): 7/7 casos correctos — automático balanceado
→ confirmado, automático desbalanceado → rechazado con el mensaje esperado, manual → borrador →
confirmar → confirmado, anular → anulado, INSERT/UPDATE directo como `authenticated` → rechazado
por falta de privilegios. Cero residuo (verificado después: 0 funciones nuevas y 0 filas de test
en la base real antes del `ROLLBACK`; confirmado que el gap seguía abierto justo antes de aplicar
la migración de verdad). Aplicada a producción con confirmación explícita de Luciano.

**🟡 Importante #1, resuelto:** el aging de deuda (antigüedad 0-30/31-60/61-90/+90 días) solo
existía para Clientes (`TabAntiguedad.jsx`). Agregada la misma pestaña para Proveedores en
`ProveedoresSection.jsx` (que no tenía Tabs a nivel de sección todavía — se agregó), reutilizando
la vista `compras_saldo_pendiente` ya existente. `TabAntiguedad.jsx` se generalizó con props
`entityLabel`/`onVerDetalle` en vez de callbacks específicos de Cliente, para servir a los dos.

**🟡 Importante #2, resuelto como efecto directo del fix crítico:** el bloqueo de período cerrado
para el flujo automático de ventas/compras/etc. era best-effort desde el cliente (si la RPC de
chequeo fallaba por red, el asiento se posteaba igual). Ahora `crear_asiento_automatico` lo valida
siempre server-side, de forma bloqueante, para las 7 rutas automáticas.

**🟢 Mejoras (no bloqueantes, no se tocaron):** reporte de valorización de inventario a fecha de
corte histórico, centros de costo a nivel de línea (hoy solo a nivel de documento).

Verificado: lint/build limpios, 153/153 tests, `get_advisors` post-deploy sin hallazgos nuevos
más allá del esperado ("SECURITY DEFINER callable por authenticated", mismo patrón que
`abrir_caja_sesion` y el resto de las RPCs del proyecto — intencional), sin errores de consola en
producción tras el deploy.

**Confirmado con una venta real por Nadia (10/08):** venta 20260810-006 ($25.000, Efectivo)
generó el asiento AS-000215 automáticamente, **confirmado** (no borrador), balanceado — Debe
$35.000 = Haber $35.000 (la venta $25.000 + el costo de mercadería $10.000, partida doble
estándar). De paso se revisaron también los asientos de las ventas de fidelización de hoy
(20260810-002 a 006, incluida una por QR MercadoPago) — todos confirmados y balanceados. **El fix
de mig.314 queda verificado en producción real, no sólo en sandbox.**

## ✅ Las 2 auditorías contables pendientes ya estaban cerradas — confirmado 07/08

Luciano preguntó si quedaban cosas por auditar, aparte de lo ya cubierto en el barrido general.
Revisé el código real (no solo memoria/CONTEXT.md) contra las 2 auditorías que se habían iniciado
en sesiones previas y encontré que **las dos ya estaban resueltas**, sin que quedara registrado en
ningún resumen consolidado hasta ahora:

- **Cheques → Bancos ("Valores en Cartera")**: cobrar/depositar un cheque sí genera movimiento en
  `movimientos_bancarios`, y el rechazo sí restaura la deuda del cliente — resuelto hace más de una
  semana en 10 migraciones (028→211). El único gap real que quedaba (asiento fallido silencioso) ya
  se había cerrado en mig.282 (ver [[project_cheques_asiento_fallido_mig282]]).
- **Devolución → Nota de Crédito**: confirmado en `supabase/migrations/263_crear_devolucion_sin_nc_automatica.sql`
  — la Devolución es una copia fiel de la Factura que anula (mismos ítems/precio/alícuota real de
  IVA) y **ya no dispara la NC automáticamente**; la NC pasó a ser una acción explícita y separada
  (`crear_nota_credito(p_devolucion_id)`, mig.264) desde el detalle de la Devolución — exactamente
  el rediseño que se había pedido, con el agregado de que corrigió de raíz 2 bugs reales que tenía
  la rama vieja: la NC nunca se encolaba a AFIP, y siempre asumía IVA 21% sin importar la alícuota
  real del ítem.

**No queda ninguna auditoría contable abierta.** Lo único pendiente de construir (no de auditar) es
lo que ya figura en `ROADMAP.md`: WhatsApp (comprobantes + links de cobro) es el único ítem real de
"construir" sin empezar — el resto del roadmap está deliberadamente pausado o fuera de alcance.

**Última actualización previa:** 2026-08-07 (Claude — barrido general del sistema a pedido de Luciano,
de cara al objetivo de `ROADMAP.md` de conseguir el primer cliente en agosto. Login rebrandeado
con el sistema de diseño `kx-*` + logo real; encontrado que el mismo estilo viejo sigue en 32
archivos más (88 ocurrencias) — alcance del rebrand queda a decisión de Luciano, ver
`PLAN_PRUEBAS_SABADO_2026-08-08.md`. `ROADMAP.md` actualizado — 2 adapters que decía pendientes
ya están hechos. Sin gaps funcionales nuevos encontrados en el flujo de ventas/facturación; suite
153/153 en verde. Plan de pruebas de mañana sábado para Luciano+Claude en
`PLAN_PRUEBAS_SABADO_2026-08-08.md` — el de Nadia sigue siendo `PLAN_PRUEBAS_NADIA_2026-08-08.md`.)

## 🔍 Barrido general del sistema (07/08) — resultado

Pedido por Luciano: "qué falta, qué queda, tanto para revisar como para terminar", contrastado
contra el roadmap de mercado (`ROADMAP.md`) y lo ya construido.

**A. `ROADMAP.md` estaba desactualizado en 2 puntos** (corregido): decía "falta publicar catálogo
KAIROX→Tiendanube" (ya está hecho desde el 22/07) y marcaba el stock bidireccional de MercadoLibre
como problema abierto (ya resuelto con una decisión de diseño explícita: KAIROX es la única fuente
de verdad del stock, con cola + reintentos, mismo patrón que Tiendanube — la garantía de no
sobreventa la da `crear_venta` con `FOR UPDATE`, verificada en vivo el 06/08).

**B. Gaps reales de código:** ninguno en el flujo de ventas/facturación/asientos (esas rutas están
limpias de TODOs). Lo que sí hay son 3 cosas ya diferidas **a propósito**, con nota explícita en el
código de por qué no están hechas todavía: series AFIP por letra en vez de por tipo de documento
(nota "Q3 2026" en `TabFacturacion.jsx`), valoración de stock FIFO (solo activo
`ultimo_costo`/`promedio_ponderado` por ahora), y el Bearer del cron de `mp-sync` hardcodeado en la
migración (es la `anon key`, pública por diseño — bajo riesgo, pero sigue siendo un TODO abierto).
Ninguno bloquea nada hoy.

**C. Suite de tests:** 153/153 en verde, sin deuda técnica visible.

**D. Pendientes técnicos ya conocidos** (sin cambios, ver la sección con ese nombre más abajo):
dominio propio para email, CbteAsoc en `informar-caea`, 4 NC históricas mal declaradas ante ARCA,
MELI Factura A.

**E. Hallazgo de branding (no estaba en el pedido original, lo encontré revisando el login):** el
login (`AuthPage.jsx`) tenía colores hardcodeados viejos (`#00D4FF`/`#A855F7`, cian/violeta) y
estaba forzado a modo oscuro siempre, ignorando el sistema de diseño `kx-*` (violeta, con soporte
claro/oscuro) que usa el resto de la app — y cuando no hay logo de empresa cacheado (dispositivo
nuevo, el caso del primer cliente) mostraba un ícono genérico en vez de la marca real de KAIROX.
**Corregido:** ahora usa los tokens `kx-*` y muestra `/kairox-logo.png` como fallback. De paso,
`index.html` tenía el favicon default de Vite (`/vite.svg`) en vez del logo — corregido, más
`theme-color`/`apple-touch-icon`/`meta description`. Verificado: lint y build limpios, 153/153
tests, colores computados correctos en ambos temas contra el servidor de dev — no pude sacar
captura real por una limitación del entorno de pruebas, queda para que Luciano lo confirme
mañana.

**✅ El mismo estilo viejo estaba en 32 archivos más (88 ocurrencias)** — Ventas, Compras, Cheques,
Plan de Cuentas, Caja, Reportes, Configuración, y el resto del flujo de auth (`OnboardingPage.jsx`,
`ResetPasswordPage.jsx`, `PasswordRecoveryModal.jsx`). Luciano eligió hacer el rebrand completo de
una — ya está hecho y deployado: 0 ocurrencias del color viejo en `src/`, lint/build limpios,
153/153 tests, sin errores de consola en producción. Dos puntos a confirmar visualmente (no hay
forma de sacar capturas en este entorno): botones sólidos que pasaron de texto negro a blanco
sobre el violeta (por contraste WCAG AA en modo claro), y `PlanCuentasSection.jsx` (era la que más
se apartaba del patrón dual claro/oscuro del resto de la app). Detalle en
`PLAN_PRUEBAS_SABADO_2026-08-08.md`.

## 🧪 Plan de pruebas para Nadia (mañana) — QR MercadoPago + escaneo por cámara

Dos cosas para probar en producción, apuntando siempre a la empresa de test (no tocar clientes
reales — ver regla de no mutar datos en vivo). Reportar cualquier resultado inesperado con
captura de pantalla y hora exacta (ayuda a cruzar contra los logs).

**1) Cobro por QR de MercadoPago — regresión del fix de CORS**
- Abrir el POS **desde la URL de producción normal** (`kairox-gestion-chi.vercel.app` o el
  dominio que uses día a día) — no hace falta buscar una URL de deploy específica, cualquier
  entrada sirve para confirmar que no volvió el error.
- Hacer una venta de prueba y cobrar con "QR MercadoPago".
- ✅ Esperado: el QR se genera sin error en pantalla ni en la consola del navegador (F12 →
  Console, no debería aparecer nada en rojo con "CORS" o "Failed to fetch").
- Escanear el QR con la app de MercadoPago y pagar un monto chico de prueba.
- ✅ Esperado: la venta se confirma sola en el POS entre 60 y 70 segundos después de pagado (no
  hace falta refrescar la pantalla) — esto lo hace el poller automático, no el webhook.
- Si el QR no se genera o tarda más de 2 minutos en confirmar: anotar la hora y avisar.

**2) Escaneo de código de barras con la cámara — feature nueva, primera prueba real**
- Este es el que más necesita probarse con hardware real — hasta ahora sólo se probó en un
  navegador de escritorio sin cámara real disponible.
- Entrar al POS **desde el celular** (Android y, si hay a mano, un iPhone — son los dos casos que
  importa diferenciar).
- En el buscador de productos, tocar el ícono de cámara a la derecha del campo de búsqueda.
- El navegador va a pedir permiso de cámara → aceptar.
- ✅ Esperado: se abre un modal con el video de la cámara trasera (no la frontal/selfie) y un
  recuadro guía en el centro.
- Apuntar a un código de barras real de un producto cargado en el sistema.
- ✅ Esperado: en cuanto el código entra en foco y se lee bien, el modal se cierra solo, el
  producto se agrega al carrito y aparece un toast de confirmación (`✓ Nombre del producto × 1`).
- Probar también con un código que **no** exista en el catálogo (tachar un código con marcador y
  escanearlo, o usar el código de un producto de prueba que no esté cargado).
- ✅ Esperado: toast rojo "Código no encontrado" — el modal se cierra pero no agrega nada al
  carrito.
- Probar decir que no al permiso de cámara (denegarlo cuando el navegador pregunta).
- ✅ Esperado: mensaje claro dentro del modal ("Permiso de cámara denegado...") sin que la
  pantalla se rompa ni tire error.
- Si en iPhone la cámara no abre o el modal queda cargando para siempre: esto es justo lo que no
  se pudo probar en el sandbox — es el dato más importante de todo este plan.

## ✅ Escaneo de código de barras con la cámara — construido

Luciano pidió arrancar esto ("de paso arranca con el 2") tras confirmar que el ancho de papel
térmico está bien. Complemento del lector físico (keyboard wedge) para un mostrador secundario sin
lector o venta ambulante desde un celular — no lo reemplaza para el mostrador principal.

Nuevo componente `EscanerCamaraModal.jsx` + botón de cámara junto al buscador en
`PanelProductos.jsx`. Usa `@zxing/browser` (decodificación en JS puro contra el stream de
`getUserMedia`) en vez de la `BarcodeDetector` nativa del navegador — esa API **no existe en
Safari/iOS** (ningún iPhone/iPad), así que con ZXing el escaneo funciona igual en Android y en
iPhone. La búsqueda por `codigo_barras` se extrajo a una función compartida (`buscarPorCodigo`)
para no duplicar la lógica entre el Enter del lector físico y la detección por cámara.

Verificado: build + lint limpios, suite de tests 153/153 sin romper nada, y probado en vivo en el
navegador — el botón abre el modal, y como el sandbox de testing no puede otorgar permiso de
cámara real, se confirmó el path de manejo de error (mensaje claro de "permiso denegado", sin
crashear, cierre limpio sin errores en consola). El flujo con cámara real (feedback en vivo del
escaneo) queda pendiente de que Luciano lo pruebe con su celular.

## ✅ Bug de CORS en el cobro por QR — corregido y redeployado en las 23 funciones afectadas

Vercel emite una URL nueva y única en cada `vercel deploy` (ej.
`kairox-gestion-4x0kytc7g-k-gestion.vercel.app`), además del alias estable
`kairox-gestion-chi.vercel.app`. El allowlist de CORS de las edge functions era una lista fija
de orígenes exactos — no contemplaba esas URLs de deploy, así que entrar por una de ellas
rompía el preflight de `mp-qr-crear` (bloqueaba cobrar por QR).

Fix: además de la lista fija, aceptar cualquier origen que matchee el patrón real de las URLs de
deploy de este proyecto (`kairox-gestion-<hash>-k-gestion.vercel.app`). Verificado con `curl`
contra producción real (no se puede simular esto desde el navegador — el header `Origin` no se
puede falsear desde JS): el origen exacto de tu captura ahora recibe
`Access-Control-Allow-Origin` correcto; un origen ajeno (`evil.com`) sigue rechazado.

El fix vive en `_shared/auth.ts`, compartido por las 23 edge functions afectadas — a pedido de
Luciano ("redeploya, así no nos topamos con errores") se redeployaron **las 23**, no solo
`mp-qr-crear`: `create-user`, `delete-user`, `generar-csr`, `invite-user`, `mp-save-config`,
`mp-verify-token`, `tiendanube-compliance-webhook`, `verificar-caea-vigente`,
`integraciones-oauth-iniciar`, `mercadolibre-catalogo`, `mercadolibre-catalogo-publicar`,
`mercadolibre-categorias`, `mercadolibre-pedidos-webhook`, `mercadolibre-stock-worker`,
`tiendanube-catalogo`, `tiendanube-catalogo-publicar`, `tiendanube-pedidos-webhook`,
`tiendanube-stock-worker`, `arca-worker`, `probar-conexion-afip`, `solicitar-caea`,
`informar-caea`, `mp-sync`, y `mp-qr-crear` (ya deployado antes, versión 9). El más sensible,
`arca-worker` (worker fiscal por cron), se verificó post-deploy con una invocación manual —
respondió `{"procesados":0,"mensaje":"Cola vacía"}`, sin errores.

## 🖨️📷 Impresora térmica y lector de código de barras — revisados, sin cambios necesarios

Investigué el código actual y comparé contra lo que usa el mercado en 2026 (fuentes abajo):

- **Impresora térmica**: hoy imprime vía `window.print()` con `@page { size: 80mm auto }` — el
  navegador manda la página al driver de la impresora instalada en Windows. Es el enfoque
  correcto: la alternativa "moderna" (WebUSB directo, sin diálogo) sólo funciona en Chrome/Edge y
  **en Windows específicamente falla si la impresora ya tiene un driver instalado** (que es como
  vienen casi todas) — el driver se la "adueña" y WebUSB no puede acceder. Nada para tocar.
- **Papel 80mm vs 58mm**: confirmado por investigación — 80mm es el estándar para comercio con
  factura electrónica (58mm se usa más en datáfonos de tarjeta, texto obligatorio no entra bien).
  KAIROX ya usa 80mm por default. Sin pedido explícito de agregar 58mm, no se toca.
- **Lector de código de barras**: ya usa el estándar del mercado (modo "keyboard wedge" — el
  95%+ de los lectores comerciales vienen así de fábrica, cero configuración del lado de KAIROX).
  Tiene además una defensa activa (auto-refocus del buscador tras cualquier click) contra la
  única limitación documentada de esta tecnología ("si el foco no está en el campo correcto, el
  texto va a parar a otro lado"). Ya era una fortaleza marcada en el análisis de mercado del POS.
- **Escaneo por cámara:** evaluado y luego construido a pedido de Luciano — ver sección
  "✅ Escaneo de código de barras con la cámara" al principio de este documento. Se descartó la
  `BarcodeDetector` nativa del navegador (no existe en Safari/iOS) en favor de `@zxing/browser`.

---

# 👉 EMPEZÁ POR ACÁ (Luciano)

## ✅ Bug que encontraste recién (venta CC con "cliente ya seleccionado") — arreglado

Reproduje exactamente lo de tu captura (POS mobile, Cuenta Corriente, warning "CC requiere
cliente seleccionado" con el cliente visible en el dropdown) y encontré la causa real, más
grave de lo que parecía:

**`ClienteSelector.jsx` disparaba dos actualizaciones de estado al crear un cliente por "Alta
rápida"** — una correcta (selecciona el cliente con el objeto completo) y otra que buscaba ese
mismo cliente recién creado en una lista que todavía no se había actualizado, fallaba, y pisaba
la selección con `null`. El desplegable seguía mostrando bien el nombre (por eso en tu captura
se veía "seleccionado"), pero por dentro la venta no tenía cliente real asociado.

**Con Cuenta Corriente esto se nota** (bloquea con el warning que viste). **Con cualquier otro
medio de pago fallaba en silencio** — verifiqué en vivo con datos sintéticos: antes del fix, una
venta en Efectivo después de crear un cliente por Alta Rápida se confirmaba sin ningún error,
pero quedaba grabada con `cliente_id: null` / "Consumidor Final" en la base, en vez del cliente
real recién creado. Corregido y re-verificado con el mismo repro exacto (Efectivo y Cuenta
Corriente) — ahora el cliente queda bien atribuido en los dos casos, incluidos los puntos de
fidelización. Todo el dato de prueba revertido después.

**De paso, un hallazgo aparte (no relacionado, pero taponaba la consola mientras investigaba):**
el "ping activo" de conectividad (`useOnlineStatus.js`) pegaba a `/rest/v1/`, que **siempre**
devuelve 401 para el rol `anon` de este proyecto (RLS le niega la función `get_my_empresa_id` a
propósito — no era falta de apikey, lo confirmé mandando el apikey completo y seguía dando 401).
`supabase-js` parchea `fetch` globalmente y logueaba cada uno como error de consola cada 20
segundos — exactamente el ruido que se veía en tu captura, tapando la pista real. Cambiado a
`GET /auth/v1/health` (endpoint público de verdad, sólo necesita el apikey) — 200 limpio,
verificado en vivo, la consola ya no se llena solo.

`npx eslint`/`npx vite build` en 0 errores, 153/153 tests en verde, deployado y verificado
contra el bundle real de producción.

**Importante — esto fue una pasada dirigida a lo que reportaste, no un barrido de "todos los
casos posibles"**: encontré estos 2 problemas siguiendo tu reporte, pero no hice pruebas
exhaustivas de cada combinación de descuentos/ofertas/atajos/pago mixto. Si seguís probando y
encontrás algo más, avisame igual que esta vez.

## ✅ mig.313 aplicada — QR MercadoPago ya suma puntos

**`supabase/migrations/313_fidelizacion_puntos_qr.sql` está aplicada a producción**, con tu
confirmación. Cierra el gap de "las ventas por QR MercadoPago no ganan puntos". Ya había quedado
probada de punta a punta en sandbox antes de aplicarla (`BEGIN...ROLLBACK` contra Nalux, con
datos 100% sintéticos, 0 rastro después — detalle completo en `PLAN_FIDELIZACION_PUNTOS.md`), así
que se aplicó tal cual, sin volver a probar. Verificado después de aplicar: la función tiene el
fix, `GRANT` sólo a `service_role` (ni `authenticated` ni `anon` pueden ejecutarla), y 0 alertas
de seguridad nuevas en `get_advisors`.

**Probado parcialmente en vivo por Nadia (10/08):** cobro real por QR de $2 (venta 20260810-005,
Luciano Rosa) — el pago se acreditó bien, pero $2 con el ratio actual (100 pesos = 1 punto) da
`floor(2/100) = 0` puntos, así que no hay forma de confirmar desde este monto si el mecanismo de
sumar puntos realmente corrió (0 puntos y "no corrió" se ven exactamente igual). **Sigue pendiente
un cobro real más grande (~$100+) para confirmarlo de una vez** — Nadia decidió dejarlo así por
ahora, no es urgente retomarlo.

**De paso, Nadia preguntó por la demora de ~60-70s en confirmar el pago — no es nada nuevo:** es
el mismo problema del webhook de MP con 401 ya documentado hace tiempo (ver "🔴 Secreto de firma
de MP" más abajo) — Luciano ya roteó la clave una vez y se revisó el código dos veces, sigue sin
resolverse, próximo paso sería contactar al soporte de MP directamente. El poller de 1 minuto
(`mp-qr-poller`) sigue siendo la red de seguridad mientras tanto, funcionando como se espera.

**Nota de coordinación (sin impacto en vos, sólo para que quede registrado):** mientras
trabajaba en esto, Nadia (en su propia sesión, en paralelo) ya había replicado la Fase 3 al ERP
Y de paso encontró y arregló un bug real que mi propia réplica también tenía sin darme cuenta
(el descuento de puntos se restaba sólo del total, sin repartirlo entre los ítems — eso
desbalanceaba el asiento contable automático y, con factura electrónica activa, la factura a
ARCA hubiera informado el monto bruto en vez del cobrado). Al traer sus cambios descarté mi
versión (tenía el bug) y me quedé con la de ella. **Mi versión con el bug llegó a estar
deployada en producción unos minutos** (hasta que hice `git fetch` y encontré su commit) — sin
uso real conocido de "canjear puntos" en Nueva Venta en esa ventana, y redeployado con la versión
correcta apenas se detectó.

---

**🆕 Fidelización por Puntos — arrancó hoy (07/08), Fase 0 (backend) ya aplicada y probada.**
Investigación de mercado en `INVESTIGACION_FIDELIZACION_PUNTOS.md` (confirma el hueco: ni Tango
ni Fudo lo resuelven nativo) y plan de 4 fases en `PLAN_FIDELIZACION_PUNTOS.md`. Decisiones de
Nadia: canje = descuento directo en pesos, gratis para todas las empresas, sin vencimiento.
mig.312: columnas nuevas en `empresas`/`clientes`, tabla `movimientos_puntos` (ledger auditable),
`crear_venta` gana `p_puntos_canjeados` (patrón DROP+CREATE de siempre). De paso se cerró un gap
de seguridad que se había escapado: `anon` todavía tenía EXECUTE directo sobre `crear_venta`
(mig.309 sólo había revocado de `PUBLIC`). Probado en vivo contra Nalux con datos 100%
sintéticos (simulando una sesión real vía JWT — necesario porque la función valida
`get_my_empresa_id()`): ganar + canjear puntos, saldo insuficiente rechazado limpio,
fidelización desactivada rechazada limpio, y **una venta sin tocar puntos sigue funcionando
idéntico a hoy** (cero regresión). Todo el dato de prueba revertido, Nalux quedó como estaba.
**Fase 1 (Configuración por empresa) también ya está hecha y probada en vivo (07/08).** Card
nueva "Fidelización por Puntos" en Configuración → Finanzas (mismo lugar que Moneda
Paralela/Centros de Costo/Cajas): toggle `usa_fidelizacion` + 2 inputs de ratio
(`puntos_pesos_por_punto`/`puntos_valor_pesos`) + resumen en vivo + botón "Guardar" explícito.
Sin migración nueva (usa las columnas de la Fase 0). `npx eslint`/`npx vite build` en 0 errores.
**Nadia lo probó en Nalux:** activó, cargó 100/1, guardó, recargó — quedó igual, confirmado.

**⚠️ Importante, corregido después de revisar `crear_venta` con más cuidado:** activar el toggle
**no es sólo una pantalla que no hace nada todavía** — la lógica de "ganar puntos" ya vive en
`crear_venta` desde la Fase 0 y corre en toda venta real con cliente asociado, en POS y ERP, sin
depender de ninguna UI nueva. Desde que Nadia guardó la configuración, **los clientes de Nalux ya
empezaron a acumular puntos de verdad** (auditable en `movimientos_puntos`), aunque todavía no
hay pantalla que lo muestre — eso es lo único que falta de la Fase 2. Canjear sí es un gate real
de la Fase 3 (ningún caller de `crear_venta` hoy manda `p_puntos_canjeados`, así que nadie puede
canjear todavía). Avisado esto, **Nadia decidió dejarlo activo** — los puntos siguen sumando en
segundo plano.

**Fase 2 (Ganar puntos, visible) también ya está hecha (07/08).** Un solo componente cubre los
dos circuitos de venta: `ClienteDrillDown.jsx` (el popover "ojo" del selector de cliente,
compartido por POS y ERP) ahora muestra "Saldo de Puntos" junto al de Cuenta Corriente, sólo si
la empresa tiene fidelización activa. Además, cada venta que suma puntos ahora avisa en el
momento: toast "+N puntos" y banner en el ticket del POS (`TicketPrint.jsx`) y en el PDF del ERP
(`TicketPDF.jsx`). Sin cambios de backend — sólo lee `puntos_ganados`, que `crear_venta` ya
devolvía desde la Fase 0. 5 tests nuevos, suite completa 140/140 en verde, `eslint`/`vite build`
en 0 errores.

**Nadia probó Fase 2 en vivo y encontró 3 bugs de UI, ya arreglados (07/08):** el popover del
"ojo" se cortaba contra el borde derecho de la pantalla (`ClienteDrillDown.jsx`, `left-0` →
`right-0`); el botón "Confirmar Venta" quedaba tapado en ventanas de navegador bajas (faltaba
`min-h-0` en el listado de items del carrito del POS — mismo bug ya resuelto en el PanelCarrito
hermano del ERP, se copió el fix); los puntos ganados no se veían lo suficiente (sólo estaban en
el toast efímero) — ahora también hay un badge "¡Ganaste N puntos!" en el modal "¡Venta
confirmada!". Los 3 fixes verificados contra la sesión real de Nadia (popover completo dentro de
pantalla mostrando "270 pts" de Carlos Perez, botón 100% visible en un viewport de 660px de
alto). **Gap real encontrado de paso:** las ventas por QR MercadoPago no ganan puntos — usan un
RPC distinto (`crear_venta_pendiente_qr`) que no pasa por la lógica de puntos de `crear_venta`.
**Cerrado más tarde el mismo día (mig.313) y ya aplicado a producción.**

Sigue la **Fase 3 (Canjear puntos — input en el checkout, descuento aplicado)** recién con el
próximo "dale" — detalle completo en `PLAN_FIDELIZACION_PUNTOS.md`.

**✅ Nadia corrió el plan de pruebas hoy (07/08), en `kairox-gestion-chi.vercel.app` — resultado
de cada bloque:**

- **Bloque 1 (sesión vieja, 1+ hora offline reconectando):** ✅ salió perfecto — encontró en el
  camino el bug de la apertura offline abandonada (ver abajo), se arregló en vivo, y quedó
  re-verificado: las 5 ventas que cobró durante la prueba terminaron en la base, cada una una
  sola vez, con numeración real (`20260806-001` a `005`).
- **Bloque 2, Escenario A (wifi conectado sin internet real):** ⚠️ **salteado** — no tenía forma
  de armar esa red específica hoy. Sigue sin verificarse, no es grave (el mecanismo del "ping
  activo" ya está andando, sólo falta el caso límite exacto).
- **Bloque 2, Escenario B (conexión que entra y sale varias veces seguidas):** ✅ 5-6 cortes de
  wifi seguidos, una sola venta sincronizada al final, sin duplicados (confirmado contra la base:
  `20260806-006`).
- **Bloque 3 (multi-caja con sus propios ojos):** ✅ 2 cajas simultáneas en 2 ventanas del
  navegador, selector apareció bien, tooltip de "no se puede cambiar con turno abierto" anduvo,
  los 2 arqueos de cierre cuadraron perfecto ($0,00 de diferencia en ambos), y pudo desactivar la
  caja de prueba después de cerrar el turno.

**Con esto, Modo Offline del POS y Multi-caja quedan 100% cerrados** (salvo el Escenario A de
arriba, anotado como pendiente real, no fingido como probado).

**🐛 Bug real encontrado y arreglado (07/08): apertura offline abandonada varaba ventas reales.**
Nadia estaba corriendo el Bloque 1 del plan de pruebas (`PLAN_PRUEBAS_NADIA_2026-08-06.md`) y
encontró esto en producción real, con plata real:

- Intentó "abrir caja sin conexión" desde un arranque en frío (la pestaña nunca había cargado la
  lista de cajas con internet todavía) — quedó encolada localmente pero sin uso real.
- Después abrió la caja de nuevo, esta vez bien, ya con internet — sesión real creada
  (`b61ebb84...`).
- El poll periódico de `CajaContext.fetchCurrentSession` (corre cada 30s) — estando offline, sin
  poder reconfirmar la sesión real por red — "resucitó" la apertura vieja abandonada de Dexie y
  **pisó la sesión real en memoria**. Las siguientes 4 ventas que cobró (offline, reales, ~$160.000
  entre las 4) quedaron encoladas contra una sesión que el servidor no reconocía, sin forma de
  sincronizar solas nunca — un callejón sin salida.
- **Nada se perdió ni se duplicó**: esas 4 ventas nunca llegaron al servidor (0 riesgo de stock/
  plata mal contados), sólo quedaron atascadas del lado del cliente. La 5ta venta de la prueba (la
  primera que hizo, antes de que esto pasara) sí había sincronizado bien — confirmado directo
  contra la base (`comprobantes`, numeración real `20260806-001`).

**Arreglo (ver sección detallada más abajo):** nueva función `reconciliarAperturasViejas()` — en
vez de dejar un conflicto de apertura muerto, lo resuelve contra la sesión que efectivamente ganó
(reasigna las ventas dependientes también). Se llama desde 3 lugares: `useSyncEngine` (cuando el
servidor devuelve `conflict:true` al sincronizar), y `CajaContext` (`openSession` online y
`fetchCurrentSession` al confirmar una sesión real) — más un guard nuevo para que el poll
periódico offline nunca vuelva a pisar una sesión real ya confirmada con un dato viejo de Dexie.
21 tests nuevos, 132/132 en verde, 0 errores de lint/build. **Deployado — las 4 ventas de Nadia
deberían terminar de sincronizar solas la próxima vez que la app haga el poll (máximo 30s) con
ella conectada, sin que tenga que hacer nada.**

**✅ Nuevo: Multi-caja simultánea.** El Modo Caja ya soporta 2+ puntos de cobro físicos abiertos
al mismo tiempo (cada cajero elige con cuál trabaja al entrar, se recuerda por dispositivo). Plan
completo y resultado de la verificación en vivo: `PLAN_MULTI_CAJA.md`. Resumen: la base de datos
ya soportaba esto de fábrica (índice único por caja, no por empresa) — el trabajo fue sacar el
cuello de botella del frontend (`resolveActiveCaja` siempre traía la caja más vieja), agregar el
selector, un badge para cambiar de caja (deshabilitado con turno abierto), un CRUD de cajas nuevo
en Configuración → Finanzas, y cerrar un gap de seguridad menor en `abrir_caja_sesion` (mig.311,
no validaba que la caja fuera de la empresa del caller). Probado en vivo: 2 sesiones simultáneas
sin pisarse, conflicto manejado en la tercera, bloqueo de desactivar una caja con turno abierto,
y el hardening de seguridad rechazando una caja de otro tenant — todo revertido después, Nalux
quedó con 1 sola caja como antes. 123/123 tests, 0 errores de lint/build. **07/08: Nadia lo
corrió también con sus propios ojos (Bloque 3) — 2 cajas simultáneas, tooltip, arqueos
perfectos. 100% cerrado.**

**Modo Offline del POS — las 4 fases del plan están hechas y con tests en verde.**
**07/08: las 3 verificaciones que sólo se podían hacer con dispositivos/red reales quedaron
cerradas** (carrera de stock el 06/08, sesión vieja + reconexión intermitente hoy) — salvo un
escenario puntual sin forma de armarlo hoy, ver la lista al final de esta sección.

- ✅ **Fase 0** (backend) — idempotencia en `crear_venta` + `abrir_caja_sesion`, mig.309/310.
- ✅ **Fase 1** (Nadia, 05/08) — PWA instalable + detección de conectividad.
- ✅ **Fase 2** (Nadia, 05/08) — snapshot local (Dexie) de productos/clientes/formas de
  pago/centros de costo/datos de empresa.
- ✅ **Fase 3** (Nadia, 05/08) — cola de ventas offline (Efectivo/Transferencia) + motor de
  sincronización. **Ya se puede cobrar sin conexión de verdad**, no sólo navegar el catálogo.
  Ver sección detallada más abajo.

**✅ Resuelto (06/08): "ping activo" en `useOnlineStatus`.** El plan original pedía sumar un
ping liviano a Supabase además de `navigator.onLine`, porque ese último da falso positivo con
wifi conectado a un router sin salida real a internet. Implementado: `HEAD` a
`{SUPABASE_URL}/rest/v1/` cada 20s (timeout 4s) mientras `navigator.onLine` es `true`;
`isOnline` final = `navOnline && pingOk`. 8/8 tests nuevos en verde. Commit `ce56092`.

**✅ Resuelto (06/08): carrera de stock con 2 ventas concurrentes, contra producción real.**
Ver sección detallada más abajo — una ganó, la otra falló limpio con "Stock insuficiente",
sin negativos ni duplicados. Todo el dato de prueba revertido.

**✅ Ya verificado hoy (07/08) por Nadia, en vivo contra producción** (ver el resumen de los 3
bloques al principio de esta sección): JWT viejo reconectando, conexión entrando y saliendo
varias veces, y multi-caja con sus propios ojos.

**Lo único que sigue sin poder verificarse:**
1. Escenario A del Bloque 2 (wifi "conectado" a un router sin salida real a internet) — Nadia no
   tenía forma de armar esa red hoy. No es grave (el "ping activo" que lo cubre ya está andando y
   probado con mocks, `useOnlineStatus.test.js`), pero quedó sin el check contra un caso real.
   Retomar si en algún momento hay a mano un router que se pueda apagar sin perder el wifi.

Plan de pruebas usado hoy, con el detalle completo de cada bloque: `PLAN_PRUEBAS_NADIA_2026-08-06.md`.

### 📌 Fidelización por puntos — las 4 fases completas (07/08), en POS y ERP

Investigación + plan de 4 fases ya armados (`INVESTIGACION_FIDELIZACION_PUNTOS.md` /
`PLAN_FIDELIZACION_PUNTOS.md`), decisiones de negocio tomadas por Nadia, **Fase 0 (backend)
aplicada y probada en vivo (mig.312)**, **Fase 1 (Configuración: toggle + ratios en Finanzas)
probada en vivo por Nadia** (activó, cargó 100/1, guardó, recargó, quedó igual — activa en Nalux
ahora mismo) y **Fase 2 (Ganar puntos, visible) probada en vivo por Nadia** — el saldo se ve en
el drill-down del cliente (POS y ERP) y cada venta avisa "+N puntos" en el momento (encontró y ya
se arreglaron 3 bugs de UI de paso, ver detalle arriba).

**Fase 3 (Canjear puntos) construida y probada en vivo por Nadia en el POS** —
`PanelCarrito.jsx`: card "Canjear puntos" cerca del total, sólo con conexión + fidelización
activa + cliente con saldo, clampeada en vivo al saldo disponible y a no dejar el total negativo.
Redención **no soportada offline** a propósito (necesita el saldo real del servidor). Ticket/
modal de venta muestran "Descuento por puntos (N)".

**🐛 Otro "Confirmar Venta cortado", encontrado y arreglado en vivo (07/08):** el fix anterior
(`min-h-0`) no alcanzaba con carritos con oferta automática (2 líneas extra: Subtotal/Ahorro).
Causa real: el propio `<div>` raíz de `PanelCarrito.jsx` tenía `flex-shrink-0` — clase pensada
para el ANCHO, pero como ese div vive dentro de un wrapper `flex-col` que ya fija el ancho por
su cuenta, `flex-shrink-0` terminaba aplicando a la ALTURA y anulaba el `min-h-0`. Fix: sacar esa
clase (el ancho ya lo controla el wrapper). Verificado en vivo: con Batidora Eléctrica (dispara
oferta) en un viewport de 638px, el botón pasó de cortarse 24px por debajo a quedar completo.

**🐛 BUG real de fondo, encontrado revisando el mecanismo con más cuidado (no cosmético):** el
asiento contable automático no se enteraba del descuento por puntos — `crear_venta` calcula
`neto_gravado`/`iva_discriminado` sumando los ítems, sin saber nada de `p_total`. El asiento
quedaba desbalanceado por el monto exacto del canje, y una eventual factura AFIP con
fidelización activa reportaría el monto bruto, distinto al cobrado. **Decisión de Nadia:**
repartir el descuento proporcionalmente entre los productos de la venta — mismo criterio fiscal
que ya usan las ofertas automáticas, así el IVA queda sobre lo que el cliente realmente pagó.
Arreglado en `useConfirmarVenta.js` (POS) antes de replicar el mismo patrón en el ERP, para no
duplicar el problema.

**Fase 3 también construida en el ERP (`NuevaVentaModal.jsx`)** — mismo circuito, ya con el fix
del reparto proporcional incluido desde el vínculo. Diferencias: el selector de cliente ahí es
un `<select>` simple en `PanelPago.jsx` (no el componente compartido del POS); `calculateTotal()`
(la única función de total del archivo, usada en ~6 lugares) pasó a devolver el neto del canje,
lo que corrigió automáticamente todos sus usos de una vez; sin modo offline (no aplica el guard).

Suite completa **153/153 en verde**, `eslint`/`vite build` en 0 errores en las dos pantallas.

**Probado en vivo por Nadia en el ERP (10/08).** Encontrado en el camino: `NuevaVentaModal.jsx`
no tiene un botón de entrada directa — sólo se abre facturando un Pedido (avanzado hasta "En
Preparación") o convirtiendo una Cotización; "Nueva Venta" del header y de Acciones Rápidas
llevan al POS, y "Nueva Factura" abre un modal distinto sin canje. Una vez encontrado el camino
correcto (Pedidos → avanzar 2 veces → ícono de recibo "Facturar pedido"), probó el circuito
completo: comprobante 20260810-004, canjeó 200 puntos sobre "Mouse plano" ($5.000 → $4.800), el
PDF mostró "Descuento por puntos (200) -$200,00" y "¡Ganaste 48 puntos!" — todo correcto.

**Con esto, Fidelización por Puntos queda 100% cerrada** — las 4 fases (backend, configuración,
ganar puntos, canjear puntos) confirmadas en vivo por Nadia en los dos circuitos de venta
(POS y ERP). No queda nada pendiente de este feature.

---

## ✅ Modo Offline del POS — Fase 0 (backend, idempotencia) — mig.309/310

Primera fase del plan de modo offline del POS (plan completo en
`PLAN_MODO_OFFLINE_POS.md`). El POS podrá seguir vendiendo en
**Efectivo y Transferencia** sin internet — Tarjeta/QR MP/Cuenta Corriente quedan
bloqueados porque necesitan hablar con un tercero (banco/MP) en el momento.
CAEA (recién resuelto) **no** resuelve este problema — es para cuando ARCA está
caído pero el servidor de KAIROX sigue con internet, un caso distinto.

**mig.309** — `crear_venta` gana `p_client_uuid uuid DEFAULT NULL` (patrón
DROP+CREATE, no `CREATE OR REPLACE`, para no repetir el overload huérfano de
mig.264/308). Con `client_uuid`, un `pg_advisory_xact_lock` serializa reintentos
antes de tocar stock — si ya existe una venta con ese `client_uuid`, devuelve el
resultado existente (`duplicate:true`) sin descontar stock de nuevo. Sin
`client_uuid` (NULL), comportamiento idéntico al de siempre — cero cambio para
el ERP y el POS online.

**mig.310** — nueva RPC `abrir_caja_sesion` (reemplaza el INSERT directo que
hace `CajaContext.openSession`), mismo patrón de idempotencia + maneja el
choque contra `uq_caja_sesion_abierta` (dos aperturas casi simultáneas — una
offline, una online) devolviendo `{conflict:true, ...la sesión que ganó}` en vez
de dejar pasar el error crudo de Postgres.

Ambas funciones nuevas: `REVOKE ALL FROM PUBLIC` + `GRANT authenticated`
explícito — una función nueva por defecto le da EXECUTE a PUBLIC (mismo agujero
que Nadia cerró en mig.304/305 para las funciones viejas; acá se evita desde el
origen).

**Probado en vivo contra producción (Nalux), vía fetch con JWT real desde el
navegador:**
- `crear_venta` con `client_uuid` dos veces → 1ra `duplicate:false` (crea la
  venta), 2da `duplicate:true` (mismo `comprobante_id`, mismo `numero_venta`) —
  verificado en la base: 1 sola fila en `comprobantes`/`movimientos_caja`/
  `movimientos_inventario`, stock descontado una sola vez.
- `abrir_caja_sesion`: apertura normal → reintento con mismo `client_uuid`
  (`duplicate:true`, mismo `sesion_id`) → apertura con `client_uuid` distinto
  mientras la primera sigue abierta (simula 2 dispositivos) → `conflict:true`
  con los datos de la sesión que ganó, sin error crudo.
- Todo revertido después: 0 comprobantes con `client_uuid` remanentes, stock y
  numeración devueltos a como estaban, sesión de prueba borrada.

## ✅ Modo Offline del POS — Fase 1 (PWA instalable + detección de conectividad)

Segunda fase del plan. Sin tocar `crear_venta` ni ninguna cola offline todavía — sólo la base
para que el POS se pueda instalar como app y sepa si hay conexión.

**PWA instalable** — `vite-plugin-pwa@0.21.2` (pineado ahí porque es la última versión que
sigue soportando Vite 4; la serie 1.x ya pide Vite 5+). Configurado en `vite.config.js`:
- `manifest`: nombre/colores de KAIROX, íconos apuntando al logo existente
  (`public/kairox-logo.png`, 1254×1254 — se referencia igual en 192/512/512-maskable; no hay
  íconos redimensionados de verdad todavía, es cosmético, no bloquea la instalación).
- **A propósito, sin ningún `runtimeCaching`**: el `generateSW` default de workbox sólo
  precachea archivos del build (`**/*.{js,css,html,ico,png,svg,woff2}`) — ninguna llamada a
  Supabase pasa por el service worker ni se cachea. Verificado después del build: `dist/sw.js`
  tiene **0 menciones** de `supabase`/`rest/v1`/`auth/v1` (`grep -c` sobre el archivo generado).
  Cachear datos/ventas es la Fase 2+, no ésta.
- `devOptions.enabled` queda en su default (`false`): el SW no se registra corriendo
  `npm run dev`, para no arrastrar assets viejos cacheados mientras se desarrolla.

**Detección de conectividad** — `useOnlineStatus()` (`src/hooks/useOnlineStatus.js`):
`navigator.onLine` + los eventos `online`/`offline` del browser. Límite conocido y aceptado a
propósito: `navigator.onLine` sólo dice si hay una interfaz de red activa, no si hay salida
real a internet ni si Supabase específicamente es alcanzable (wifi conectado a un router sin
internet reporta `true`) — un chequeo real (ping a la API) es de una fase posterior.

**Badge en el POS** — `ModoCajaLayout.jsx` muestra "Sin conexión" en la topbar (mismo estilo
que los badges de Caja/PdV que ya existían) sólo cuando `isOnline === false`; oculto el resto
del tiempo para no sumar ruido. Por ahora es sólo un aviso — no bloquea ni habilita nada
todavía, eso llega con la cola offline real.

**Probado:**
- Build: `PWA v0.21.2, mode generateSW, precache 72 entries (5603.23 KiB)` — genera
  `dist/sw.js`, `dist/workbox-*.js`, `dist/manifest.webmanifest` correctamente, con los íconos
  y colores esperados.
- **No se pudo probar clickeando en el navegador real** (requiere estar logueada, y no se
  ingresan credenciales por política) — se verificó en cambio con un **test automatizado**
  nuevo, `src/hooks/__tests__/useOnlineStatus.test.js` (5 casos: arranca reflejando
  `navigator.onLine`, reacciona a `offline`→`online`, limpia el listener al desmontar). 33/33
  tests del proyecto en verde (28 preexistentes + 5 nuevos).
- `npx eslint`: 0 errores. `npx vite build`: ✓.

## ✅ Modo Offline del POS — Fase 2 (snapshot local read-only, Dexie)

Tercera fase del plan (`PLAN_MODO_OFFLINE_POS.md`). Todavía **no se puede cobrar sin
conexión** — eso es la Fase 3. Esta fase sólo hace que el catálogo/clientes/formas de pago
sigan siendo buscables si se corta la red, en vez de que el POS se quede con paneles vacíos.

**Nuevo `src/lib/offlineDb.js`** — base local (IndexedDB vía Dexie) con 5 tablas:
`productos`, `clientes`, `formasPago`, `centrosCosto`, `empresaMeta`. Todas indexadas por
`empresa_id` — mismo aislamiento multi-tenant que en el backend, replicado acá porque el
snapshot vive en el dispositivo del cajero. `guardarSnapshot(tabla, empresaId, filas)` borra
primero todo lo de esa empresa en esa tabla y recién ahí inserta lo nuevo (reemplazo completo,
no acumula productos dados de baja o renombrados). `empresaMeta` es un registro único por
empresa (logo/nombre/CUIT/dirección para el encabezado del ticket), no una lista.

**Nuevo `src/hooks/useProductosSnapshot.js`** — mientras hay conexión, refresca en Dexie
**todos** los productos activos de la empresa (a diferencia de `PanelProductos`, que sólo trae
los primeros 200 que matchean la búsqueda — el snapshot necesita el catálogo completo porque no
sabe de antemano qué va a buscar el cajero sin red). Expone `buscarOffline(query)` (filtra por
nombre/SKU) y `buscarPorCodigoBarras(codigo)` para el flujo de escaneo.

**Modificados** (mismo patrón en los 3: `if (!isOnline) { leer de Dexie; return }` antes del
fetch a Supabase, y el fetch online guarda su resultado en Dexie al final):
- `PanelProductos.jsx` — búsqueda por nombre/SKU y por código de barras (Enter en el
  buscador) caen al snapshot sin red. Aviso visual bajo el buscador: "Sin conexión — mostrando
  catálogo guardado, puede estar desactualizado" (el stock que se ve puede no reflejar ventas
  hechas en otro dispositivo desde el último refresco — se avisa, no se oculta el riesgo).
- `ModoCajaLayout.jsx` — logo/nombre/datos de empresa (para el ticket) y formas de pago activas.
- `PanelCarrito.jsx` — clientes y centros de costo.

**Por qué el enfoque es "cae a Dexie si `!isOnline`" y no "intentá Supabase y si falla, Dexie"**:
más simple y predecible — evita que el cajero espere un timeout de red colgado antes de ver el
fallback. Contrapartida conocida (mismo gap que ya estaba documentado en la Fase 1): si
`navigator.onLine` da un falso positivo (wifi sin salida real a internet), el POS va a intentar
Supabase igual y el cajero va a esperar el timeout. Ver nota sobre el "ping activo" pendiente en
el bloque "EMPEZÁ POR ACÁ".

**Instalado:** `dexie@^4.4.4`, `dexie-react-hooks@^1.1.7` (no se terminó usando `useLiveQuery`
de esta última en esta fase — el snapshot no necesita reactividad entre pestañas todavía; queda
disponible para cuando la Fase 3 sí la necesite). También `fake-indexeddb` (sólo devDependency
de test: jsdom, el entorno de Vitest, no implementa IndexedDB — sin este shim los tests que
tocan `offlineDb.js` tiran error al abrir la base). Verificado con `npm audit`: **0
vulnerabilidades nuevas** — sigue en 13 (6 moderate, 5 high, 2 critical), todas preexistentes
(jspdf, xlsx, vite, vitest, undici, brace-expansion), ninguna de los 3 paquetes agregados.

**Probado:**
- Tests nuevos: `src/lib/__tests__/offlineDb.test.js` (6 casos — guardar/leer, aislamiento
  entre empresas, que un refresco reemplaza el snapshot viejo en vez de acumularlo, lista vacía,
  `empresaMeta`, `null`/`undefined` no explotan) y
  `src/hooks/__tests__/useProductosSnapshot.test.js` (4 casos — refresca online, un error de
  Supabase no borra lo que ya había, offline no llama a Supabase y busca por nombre/SKU/código
  de barras desde el snapshot, sin `empresa_id` no explota).
- Suite completa: **43/43 tests en verde** (33 preexistentes + 10 nuevos).
- `npx eslint`: 0 errores (sólo warnings preexistentes de `react/prop-types`, ya estaban en
  todo el proyecto — nunca se usa PropTypes acá).
- `npx vite build`: ✓ en 5m 9s, PWA con 72 entries precacheadas, sin regresión en el resto de
  los bundles.
- **No se pudo probar clickeando en el navegador real logueada** (misma limitación que la
  Fase 1 — no se ingresan credenciales por política). Se abrió igual el preview sin login para
  confirmar que la app carga sin errores de consola con las nuevas dependencias (Dexie, etc.)
  antes de la pantalla de login — 0 errores.

## ✅ Modo Offline del POS — Fase 3 (cola de ventas + sincronización) — YA SE PUEDE COBRAR OFFLINE

Última fase del plan (`PLAN_MODO_OFFLINE_POS.md`). A diferencia de las Fases 1/2 (que sólo
avisaban/permitían navegar), ésta es la que de verdad habilita cobrar sin conexión —
**Efectivo y Transferencia únicamente** (por `tipo_instrumento`, mig.214 — Tarjeta/QR
MercadoPago/Cuenta Corriente necesitan hablar con un tercero en el momento y quedan
deshabilitados con tooltip "Necesita conexión a internet").

Es la fase de mayor riesgo real de todo el feature: toca el camino que genera cada venta y
mueve stock/caja. El diseño mantiene el camino **online exactamente igual que antes** (mismas
RPC, mismo orden) y agrega el camino offline como una rama nueva — verificado con tests que
comparan explícitamente que el camino online no cambió de comportamiento.

**Datos locales nuevos (`offlineDb.js` → `version(2)`):**
- `ventasPendientes` — cada venta encolada: `client_uuid` (dedupe real), `numero_provisorio`
  (etiqueta tipo `OFFLINE-123456`, sólo visual — el número fiscal real recién se asigna al
  sincronizar, porque `obtener_proximo_numero` necesita red), `payload` (los mismos `p_*` que
  siempre recibió `crear_venta`, menos `p_numero_venta`), `itemsSnapshot`, `cliente_condicion_iva`
  (para el post-proceso de AFIP), `caja_sesion_id`/`caja_sesion_client_uuid` (según si la sesión
  de caja ya tenía id real o también está encolada), y `estado`: `pendiente` → `sincronizada` |
  `conflicto`.
- `cajaSesionesPendientes` — mismo patrón para una apertura de caja hecha sin conexión.
- Nuevo `medioPagoDisponibleOffline(nombre, formasPago)` — decide por `tipo_instrumento`
  (`efectivo`/`transferencia` = sí, todo lo demás no), **no por el nombre** de la forma de pago
  (que cada empresa puede editar). 'Cuenta Corriente' no tiene fila en `formas_pago` (es una
  modalidad de venta a crédito, no un instrumento) y siempre está bloqueada.

**`useVentaOfflineQueue.js`** — envoltorio reactivo (`dexie-react-hooks`) sobre la cola, usado
por el badge de la topbar y por `useArqueoCaja`.

**`useSyncEngine.js`** — corre apenas hay conexión (al montar si ya arranca online, o en la
transición offline→online), con un lock (`isSyncing`) para no correr dos veces en paralelo:
1. Sincroniza `cajaSesionesPendientes` primero (viejo→nuevo) vía `abrir_caja_sesion` — antes que
   las ventas, porque una venta encolada puede depender de una sesión que todavía no tenía id
   real. Si el servidor devuelve `conflict:true` (otra caja ya abrió), esa apertura queda marcada
   para resolución manual — **no** tiene un "anular" seguro (ver limitación abajo).
2. Sincroniza `ventasPendientes` (viejo→nuevo — importa para la numeración fiscal correlativa),
   resolviendo `caja_sesion_id` real si dependía de una apertura recién sincronizada **o de una
   sincronizada en una corrida anterior** (reconexión intermitente — verificado con test
   específico). Llama `obtener_proximo_numero` recién acá (ya hay red) y después `crear_venta`
   con el `client_uuid`.
   - Éxito → guarda el `numero_venta`/`comprobante_id` reales, corre
     `finalizarVentaPosterior` (asiento contable + encolado a ARCA).
   - **Guard importante**: si el resultado es `duplicate:true` (la venta ya se había
     sincronizado en un intento anterior y sólo faltaba marcarla local), **no** se vuelve a
     llamar `finalizarVentaPosterior` — evita un asiento contable duplicado en un reintento.
   - Error (ej. stock insuficiente re-validado por el servidor) → esa venta puntual queda
     `conflicto` y **la cola sigue con las siguientes**, no se frena entera.

**Refactor en `useConfirmarVenta.js`**: el post-proceso de una venta exitosa (asiento contable +
encolado a ARCA) se sacó a un hook propio, **`useFinalizarVentaPosterior.js`**, para que lo
llamen tanto el camino online (sin cambios) como `useSyncEngine` después de sincronizar una
venta offline — sin duplicar esa lógica en dos lugares. Rama nueva en `confirmar()`: si no hay
conexión y todos los pagos son Efectivo/Transferencia, encola en vez de llamar al servidor,
decrementa el stock del snapshot local (Fase 2) de forma optimista (sólo para que el mismo
dispositivo no se sobre-venda a sí mismo entre varias ventas encoladas — la validación real es
la del servidor al sincronizar), y devuelve un comprobante con `numero_venta` provisorio +
`_offline: true`.

**`CajaContext.jsx`**: `openSession` ahora usa la RPC `abrir_caja_sesion` (mig.310) en el camino
online — antes hacía un INSERT directo (pendiente señalado desde la Fase 0). Sin conexión,
encola la apertura y arma una sesión "local" (`_pendingSync: true`, sin `id` real, con
`client_uuid`) contra la que ya se puede vender. `fetchCurrentSession` recupera esa sesión
pendiente desde Dexie si se recarga la página offline a mitad de turno (si no, se "perdería" la
caja abierta y el cajero terminaría abriendo una segunda por error). `closeSession` se bloquea
con un toast si hay ventas o aperturas sin sincronizar.

**UI**: `PanelCarrito.jsx` deshabilita Tarjeta/QR/CC offline con tooltip (atajo `Alt+1..4`
respeta el mismo guard); `SyncStatusPanel.jsx` (badge "N sin sincronizar" en la topbar, oculto
si no hay nada pendiente) + `SyncConflictModal.jsx` (detalle, botón "Reintentar ahora", "Anular
venta" en conflictos — revierte sólo el stock local, la venta nunca tocó stock real);
`TicketPrint.jsx` muestra "PROVISORIO — pendiente de sincronizar"; el modal de éxito post-venta
también avisa cuando el comprobante es offline; `useArqueoCaja.js` suma una línea informativa
(`pendienteSyncEfectivo`/`Transferencia`) separada del `esperado` (que sigue siendo 100%
verdad-servidor).

**Limitación conocida, no resuelta a propósito (edge case raro):** si la apertura de caja
offline de un dispositivo entra en conflicto con la de otro (ambos abrieron la misma caja
física casi al mismo tiempo), no hay un "anular" seguro para esa apertura ni para las ventas que
dependan de ella — quedan pendientes de resolución manual. El propio plan marca las carreras
multi-dispositivo como algo que necesita probarse con hardware real, no simulable acá.

**Probado (automatizado, Vitest + mocks de Supabase):**
- 24 tests nuevos en `offlineDb.test.js` (cola, `medioPagoDisponibleOffline`, stock local).
- `useVentaOfflineQueue.test.js` (5), `useSyncEngine.test.js` (11 — éxito simple, `duplicate`
  no duplica el asiento, conflicto no frena la cola, orden cronológico, apertura antes que
  ventas, apertura sincronizada en una corrida anterior resuelve una venta nueva, apertura en
  conflicto no vende, lock anti-concurrencia), `useConfirmarVenta.test.js` (9 — camino online
  intacto + rama offline), `useFinalizarVentaPosterior.test.js` (6), `CajaContext.test.jsx` (7),
  `PanelCarrito.test.jsx` (5 — botones deshabilitados offline), `SyncStatusPanel.test.jsx` (5),
  `TicketPrint.test.jsx` (3), `useArqueoCaja.test.jsx` (5).
- Suite completa: **117/117 tests en verde** (43 previos de Fase 1/2 + 74 nuevos).
- `npx eslint`: 0 errores (sólo warnings preexistentes de `react/prop-types`).
- `npx vite build`: ✓ (ver resultado exacto al pie de esta sección).
- Nota técnica: se agregó `esbuild: { jsx: 'automatic' }` a `vitest.config.js` — sin eso,
  cualquier test que renderice un componente `.jsx` directamente (no sólo un hook) fallaba con
  "React is not defined" (ese archivo no usa el plugin de React que sí tiene `vite.config.js`).

**Lo que NO se pudo probar desde este entorno con mocks (honesto, no se va a fingir) — son
justo los puntos que el propio plan marca como los más exigentes de verificar:**
1. ~~**Carrera de stock con 2 dispositivos offline** vendiendo el mismo último ítem~~ — ✅
   **resuelto el 06/08, ver sección "Carrera de stock" más abajo.** No hacía falta 2
   dispositivos reales: se disparó `Promise.all` con 2 llamadas directas a la RPC `crear_venta`
   (mismo camino que usaría el motor de sync de cada dispositivo) contra un producto real puesto
   en `stock_actual=1`, con `client_uuid` distinto en cada una — eso alcanza para probar el lock
   del lado del servidor, que es la garantía real (el resto es orquestación en el cliente, ya
   cubierta por los tests de Nadia).
2. **JWT viejo (1+ hora offline) reconectando** sin pedir re-login — no se puede simular dejar
   una sesión colgada una hora real en este entorno.
3. **Red real degradada** (throttling, desconectar el adaptador físico) — el entorno sólo puede
   emular `navigator.onLine`, no una red real intermitente.

Los 2 que quedan (JWT viejo, red real degradada) necesitan que Nadia/Luciano los prueben en vivo
con el POS instalado en un dispositivo real antes de confiar el 100% en el feature para un día
de mucho movimiento.

## 🐛 Bug real de producción — apertura offline abandonada varaba ventas (07/08)

Encontrado por Nadia corriendo el Bloque 1 de `PLAN_PRUEBAS_NADIA_2026-08-06.md`, con datos
reales de Nalux (no un test, plata de verdad). Reconstruido paso a paso, verificado contra la
base (`caja_sesiones`, `comprobantes`):

1. Con la notebook ya offline desde el arranque de esa pestaña (nunca había cargado `cajas` con
   internet todavía en esa sesión del navegador), intentó **"Abrir caja" sin conexión**. Quedó
   encolada en Dexie (`cajaSesionesPendientes`), pero ella no llegó a usarla — vio un error al
   intentar vender y asumió que no había funcionado.
2. Reconectó, **abrió la caja de nuevo** — esta vez sí, sesión real creada online
   (`b61ebb84-eefe-...`, `apertura_fecha` 2026-08-06 10:46 UTC, `client_uuid: null` — confirmado
   por SQL directo).
3. Desconectó otra vez y cobró **5 ventas offline** a lo largo de ~75 minutos (mezclando Efectivo
   y Transferencia — el badge "N sin sincronizar" fue subiendo bien 1→5, sin pisarse).
4. Reconectó. Sólo **1 de las 5 sincronizó** (la primera, $3.000 — confirmado en `comprobantes`,
   numeración real `20260806-001`). Las otras 4 quedaron "Esperando conexión" para siempre, y el
   panel mostró la apertura del paso 1 como **"Conflicto — Ya había otra caja abierta al
   sincronizar"**.

**Causa raíz:** `CajaContext.fetchCurrentSession` corre cada 30s (`setInterval`) para revisar si
hay una sesión real abierta. Estando offline, esa consulta a `caja_sesiones` no puede llegar al
servidor — pero el código, al no encontrar respuesta, caía a un fallback pensado para otro caso
("recargué la página offline, recuperá lo que había en Dexie") y **restauraba la apertura vieja
abandonada del paso 1 como si fuera la sesión actual**, pisando la sesión real del paso 2 que
seguía en memoria. Las ventas del paso 3, cobradas después de ese pisado, quedaron con la
apertura vieja como referencia — y como esa apertura nunca iba a tener un id real (el servidor
correctamente la rechaza porque ya hay otra sesión abierta para esa caja), no tenían forma de
sincronizar solas nunca. Un callejón sin salida real, no cosmético.

**Impacto real:** ninguno en datos — las 4 ventas nunca llegaron al servidor (0 stock/plata mal
contados, 0 duplicados). Sólo quedaron atascadas del lado del navegador de Nadia hasta que se
arregló el código.

**Arreglo — `reconciliarAperturasViejas(empresaId, cajaId, sesionRealId)` (`offlineDb.js`):** en
vez de dejar un conflicto de apertura como callejón sin salida, lo resuelve contra la sesión que
efectivamente ganó — al cajero le da lo mismo bajo qué número haya quedado la caja realmente
abierta, sólo quiere que su venta entre. Reasigna también cualquier venta que dependiera del
`client_uuid` de la apertura vieja. Se llama desde:
- **`useSyncEngine.sincronizarAperturas`** — cuando el servidor devuelve `conflict:true` al
  sincronizar, en vez de sólo `marcarAperturaConflicto`.
- **`CajaContext.openSession`** (camino online, éxito) — por si había una apertura vieja de la
  misma caja esperando.
- **`CajaContext.fetchCurrentSession`** — apenas confirma una sesión real, reconcilia cualquier
  apertura vieja de esa caja antes de que el poll periódico tenga chance de toparse con ella.

**Guard nuevo en `fetchCurrentSession`:** si ya había una sesión real (no `_pendingSync`)
confirmada en memoria, y la consulta no trae nada nuevo (típico estando offline — la llamada de
red directamente no llega), **ya no cae al fallback de Dexie** — lo deja como estaba. El fallback
de recuperación original (mount en frío offline con una apertura pendiente en Dexie) se probó
aparte con una contraprueba, sigue funcionando igual que antes.

**Probado:** 21 tests nuevos (`offlineDb.test.js` +7, `useSyncEngine.test.js` reescribe el caso
de conflicto, `CajaContext.test.jsx` +3 — incluye la reproducción exacta del bug con mocks, y la
contraprueba de que el mount en frío offline sigue andando). Suite completa: **132/132 en verde**.
`npx eslint`: 0 errores. `npx vite build`: ✓. Deployado.

**Para Nadia — no hace falta que hagas nada:** la próxima vez que la app haga el poll automático
(máximo 30 segundos, ya conectada) debería reconciliar las 4 ventas stranded solas. Si en un par
de minutos el óvalo "sin sincronizar" no bajó a 0, avisá — ahí sí reviso a mano contra la base.

## ✅ Carrera de stock — verificado en vivo contra producción (06/08)

Prueba real, no mock: 2 llamadas concurrentes (`Promise.all`) a la RPC `crear_venta` vía
`fetch` con JWT real de Nalux, cada una con `client_uuid` distinto, compitiendo por la última
unidad de un producto de prueba (`Aramis TESTE Azul marino`, bajado a propósito de
`stock_actual=5849` a `1` para el test).

**Resultado:**
- Venta A → `200 OK`, `duplicate:false`, crea el comprobante y descuenta el stock a `0`.
- Venta B → `400`, `"Stock insuficiente para producto ... (disponible: 0, requerido: 1)"` — el
  `SELECT ... FOR UPDATE` sobre `productos.stock_actual` (mig.309) serializó las dos llamadas:
  la segunda vio el stock ya en `0` y abortó toda su transacción, sin error crudo de Postgres,
  sin stock negativo, sin comprobante duplicado.

**Todo el dato de prueba revertido después:** `stock_actual` de vuelta en `5849`, comprobante +
ítems + movimiento de caja + movimiento de inventario + entrega + ítem de entrega borrados,
`series_numeracion` de `entrega` devuelta de `112` a `111` (la venta usó un `numero_venta` de
prueba fijo, no consumió la serie fiscal real de ventas — sólo la de entregas, por el
`obtener_proximo_numero(..., 'entrega')` interno de `crear_venta`).

Esta es la validación que de verdad importa para el modo offline: confirma que aunque 2 cajas
físicas sincronicen al mismo tiempo por el mismo último ítem, el servidor nunca deja pasar una
sobreventa silenciosa — la segunda cae en conflicto manejado, que es exactamente el
comportamiento que `SyncConflictModal.jsx` está preparado para mostrarle al cajero.

## ✅ Barrido final del backlog del 04-05/08 — 3 ítems cerrados

- **mig.308** aplicada a producción y pusheada — elimina el overload huérfano de 8 args de
  `crear_nota_credito` (ver sección más abajo).
- **Tienda MP huérfana borrada.** Se confirmó con la API de MP (`GET /users/{id}/stores/search`)
  que había exactamente 2 tiendas en la cuenta de Nalux: `85561798` (la que usa el sistema hoy) y
  `85563668` (huérfana del primer intento fallido del 01/08, antes de descubrir que `external_id`
  no podía tener guiones — nunca tuvo una caja/POS asociada). Se borró la huérfana con
  `DELETE /users/{id}/stores/{store_id}` — verificado, queda solo 1 tienda.
- **Criterio fiscal unificado (mig.293-296): revisado, sin nada suelto.** La sección "Alcance NO
  cubierto" de mig.295 quedó explícitamente resuelta en mig.296 (numeración de NC/ND por PdV). No
  hay ningún cabo suelto de ese trabajo.

## ✅ Trámite del PdV CAEA en AFIP — RESUELTO, desbloquea la contingencia automática

ARCA confirmó el alta del PdV **2** para CAEA en la empresa de pruebas "CAEA Test" (CUIT
`20393249006`, homologación). Esto era el único bloqueante documentado en `CAEA_IMPLEMENTACION.md`
para la contingencia automática del `arca-worker` (`intentarCaeaContingencia`, repo-only desde
migration 225). Se corrigió `empresas.afip_pv_numero` de `1` (placeholder viejo) a `2` (el PdV real
que AFIP asignó) para esa empresa. Detalle completo en `CAEA_IMPLEMENTACION.md`.

**Sigue sin poder probarse en vivo hoy:** la ventana de solicitud de CAEA por quincena recién abre
el **12/08** (2da quincena de agosto) — antes de esa fecha AFIP devuelve error 15008. Cuando se abra
la ventana: 1) probar "Solicitar CAEA" manual desde `ConfiguracionSection` con la empresa CAEA Test,
2) si funciona, desplegar la contingencia automática del `arca-worker` (repo-only hoy).

## ✅ mig.308 — corrección: esta nota había quedado desactualizada, SÍ está aplicada

Esta sección decía "NO aplicada a prod todavía, pendiente de confirmación" — quedó así de un
borrador anterior a que Luciano la aplicara. **Verificado hoy directamente contra la base**
(`list_migrations`): `308_drop_overload_huerfano_crear_nota_credito` figura aplicada
(`20260805015310`), consistente con la sección "Barrido final del backlog" más abajo, que sí
decía "aplicada y pusheada". No hace falta ninguna acción — era sólo un cabo suelto de
redacción, no un problema real.

`DROP FUNCTION` del overload de 8 args de `crear_nota_credito` (deuda técnica anotada desde mig.264).
Confirmado en sandbox (`BEGIN...ROLLBACK`) que el drop no rompe nada — sin callers en `src/` ni en
`supabase/functions/` (el único caller, `NuevaNCModal.jsx`, siempre manda `p_referencia_cliente`/
`p_punto_venta_id`, así que Postgres ya resolvía siempre a la versión de 10 args). Hallazgo nuevo: no
era solo deuda cosmética — `authenticated` todavía tenía `EXECUTE` sobre la versión vieja, que no
revierte COGS en devoluciones (mig.288) ni respeta el punto de venta (mig.294-296).

## 🔴 Secreto de firma de MP — Luciano lo actualizó, PERO sigue fallando (dato nuevo)

Luciano entró al panel (`panel.mercadopago.com.ar` → kairox-gestion → Webhooks → Configurar
notificaciones → Modo productivo) y confirmó: evento marcado **"Pagos (legacy)"** ✓, URL configurada
coincide exacto con la que usamos ✓. Copió la "Clave secreta" que muestra esa pantalla y se actualizó
en `integraciones_bancarias.config.webhook_secret` de Nalux.

**Se probó en vivo con un pago real de $2 (venta `20260804-010`):** el webhook (`type=payment&data.id=...`)
**siguió devolviendo 401** — tres reintentos, mismos que antes. El pago se confirmó igual, pero por
`mp-qr-poller` (~70s), no por el webhook. Esto **descarta la hipótesis de "secreto desactualizado"**:
ya se probó con el valor que el panel muestra HOY para el evento "Pagos (legacy)" en modo productivo,
y tampoco coincide. Puede ser que ese evento/legacy use un esquema de firma distinto al que documenta
MP para webhooks v2, o que exista otro secreto en otro lugar del panel no explorado todavía.
**No es urgente resolverlo** — `mp-qr-poller` ya cubre el 100% de los casos con ~60-70s de latencia.
Si se retoma, la próxima pista a seguir sería contactar al soporte de MP directamente, ya que se
descartaron tanto el código (revisado línea por línea dos veces) como el secreto configurado.

---

# 👉 EMPEZÁ POR ACÁ (Luciano)

Nadia cerró la jornada del **04/08**. Todo lo que sigue está **aplicado, probado en vivo (incluido
un pago real) y pusheado** — no hay nada a medias ni ningún trabajo interrumpido.

### ⏰ Lo único con reloj corriendo — y sigue sin moverse

**El plan de Supabase de NALUX sigue en `free`.** Verificado de nuevo hoy 04/08 (no cambió desde
ayer). Los proyectos se restringen el **17/08/2026 — quedan 13 días**. Si se restringe, **se cae la
producción de todos los clientes**. Es billing, va por tu cuenta.

### 🔴 El secreto de firma de MP — tampoco se movió

Sigue bloqueando la confirmación automática del QR (aunque el QR **ya funciona igual**, ver abajo).
`webhook_secret` en la base sin tocar desde el **27/06** — mismo estado que ayer. Detalle completo y
la consulta para comparar el prefijo sin exponer el valor: sección **"PARA LUCIANO"** más abajo.

### 🔒 Un clic, gratis — sigue pendiente

**Supabase → Authentication → Policies → "Leaked password protection".** Lo puede hacer cualquiera
de los dos.

---

### ✅ Lo grande de hoy: QR MercadoPago queda 100% funcional, con y sin tu secreto

Se cerró la Fase 2 completa (modal en el POS, cancelar, expiración automática) **y** se agregó
`mp-qr-poller` — un worker que confirma los pagos consultando la API de MP directamente, sin
depender del webhook. Cuando rotes el secreto, las dos vías van a convivir sin problema (la RPC de
confirmación es idempotente). Mientras tanto, el cajero espera hasta ~60s en vez de nada.

**Se probó con un pago real de $5** (Nadia → tu cuenta de MP) — circuito completo: QR → pago →
confirmación por polling → asiento contable balanceado. Después, revisando el ticket impreso,
apareció un bug propio de hoy (no preexistente): el frontend nunca le mandaba el punto de venta ni
el tipo de comprobante a la función que crea el QR, así que **ninguna venta por QR se iba a encolar
a ARCA**, ni siquiera las del PdV fiscal real. Se corrigió y se verificó con una venta real (PdV 1,
`envia_arca=true`) que el circuito de facturación ahora sí queda bien armado — se canceló antes de
confirmarla para no pedir un CAE real de prueba, y se verificó el encolado a ARCA aparte con datos
100% sintéticos y aislados, borrados en segundos.

### ⚠️ Dos bugs que estaban vivos en producción antes de ayer, ya corregidos

Los menciono porque **no los habíamos detectado antes** y valen como contexto:

1. **No se podía dar de alta ninguna empresa nueva** (mig.301). Roto desde el **01/08** por la
   mig.295, que cambió un índice único plano por dos parciales sin actualizar el `ON CONFLICT` de
   `seed_series_numeracion`. Nadie lo notó porque no hubo altas en esa ventana.
2. **136 asientos contables reales estaban desvinculados de su venta/compra** (mig.303), deuda de la
   mig.281 que nunca corrió backfill. El botón "Regenerar asiento" decía *"no tiene asiento"* sobre
   registros que **sí lo tenían** — un clic habría **duplicado el asiento contable**. 0 duplicados
   verificados. Las RPCs quedaron blindadas para autorepararse en vez de duplicar.

### 📌 Trabajo de desarrollo que queda (nada urgente)

El resto (4 NC históricas → contador, overload huérfano de `crear_nota_credito`, `CbteAsoc` en CAEA,
dominio en Resend, 1-2 tiendas MP huérfanas) está en la tabla de **"Estado de pendientes"** más
abajo, todo sin urgencia y sin nada bloqueado por vos salvo lo de arriba.

**🚫 No construir sin pedido explícito:** MELI Factura A.

### 📊 Resumen acumulado de las últimas dos jornadas (03 y 04/08)

12 commits · 9 migraciones (299-307) aplicadas y probadas en vivo contra producción, incluido un
pago real · QR MercadoPago completo de punta a punta (backend + Fase 2 + poller) · advisors de
seguridad **99 → 85**, sin ningún hallazgo de nivel **ERROR** y sin ninguna función ejecutable por
`anon` · alta de empresas y 136 asientos desvinculados, corregidos · lint y build en 0 errores en
cada entrega · 2 worktrees fantasma eliminados (rescatando antes un fix que había quedado sin
commitear).

---

# ✅ QR MercadoPago Fase 2 — COMPLETA (mig.306/307) — 2026-08-04

El cobro por QR **ya funciona de punta a punta**, incluso con el webhook todavía roto.

### El hallazgo que cambió el diseño

`crear_venta_pendiente_qr` **descuenta stock** al generar el QR, y
`cancelar_venta_pendiente_qr` lo devuelve — pero esta última exige
`get_my_empresa_id()` + permiso de módulo, o sea que **sólo la puede llamar un cajero autenticado,
nunca un cron**. Sin barrido de expiración, cada cliente que se va del mostrador sin escanear
dejaría el stock descontado **para siempre**. No había pasado porque no existía UI que generara QRs
(0 pendientes en producción), pero publicar la Fase 2 sin esto habría abierto una fuga de stock real.

### Cómo se resolvió que el QR funcione sin el secreto de Luciano

`confirmar_pago_qr` (la que marca la venta pagada, genera el asiento y dispara AFIP) sólo la llamaba
`mp-webhook`, que viene rechazando las notificaciones de MP con 401. Se agregó **`mp-qr-poller`**:
consulta la API de MP directamente por cada QR pendiente y confirma los pagados. Es el mismo patrón
que `mp-sync-worker` ya usa con éxito para los movimientos bancarios.

**No reemplaza al webhook** — cuando el secreto se rote, ambos caminos conviven. Es seguro que
compitan porque `confirmar_pago_qr` lockea con `FOR UPDATE` y es **idempotente** (devuelve
`ya_procesado` sin tocar nada). Tener las dos vías es lo correcto igual: los webhooks se pierden.

### Piezas

- **mig.306** — la reversa (stock + entregas + comprobante) se **extrae a
  `_revertir_venta_qr_interno`**, compartida entre cancelar (cajero) y expirar (cron), para que no
  puedan divergir — mismo criterio que se usó con `useArqueoCaja`. Nueva `expirar_qrs_vencidos()`,
  service_role-only, con `FOR UPDATE SKIP LOCKED` (si el cajero está cancelando ese mismo QR, lo
  saltea en vez de bloquear el barrido) y recheck bajo lock para **nunca revertir una venta ya
  cobrada**.
- **`mp-qr-poller`** (edge function nueva, `verify_jwt=false` como los otros workers) — confirma
  pagos y corre el barrido de expiración.
- **mig.307** — cron cada minuto. **Sin clave embebida**: a diferencia de los crons anteriores
  (que hardcodean la anon key — hay un TODO al respecto en mig.109), éste no necesita header porque
  la función va con `verify_jwt=false`. Verificado con `curl` sin headers → `HTTP 200`.
- **Frontend** — `useCobroQR` (crear, pollear cada 3s, cancelar) + `ModalCobroQR` +
  bifurcación en `PanelCarrito.handleConfirmar`. El modal **no se cierra con Escape ni clickeando
  afuera** mientras espera: la venta ya existe con stock descontado, salir sin cancelar la dejaría
  colgada. El QR se bloquea en pago mixto (no se puede conciliar una parte pendiente con otra ya
  cobrada).

### Probado en vivo contra producción

Circuito real completo con `crear_venta_pendiente_qr` (no filas armadas a mano):
venta de 3 unidades → **stock 5850 → 5847** ✓ (confirma que el problema era real) → se fuerza el
vencimiento → `expirar_qrs_vencidos()` devuelve `{expirados: 1, unidades_devueltas: 3}` →
**stock de vuelta en 5850** ✓, comprobante `cancelada` ✓, QR `expirado` ✓, entrega anulada ✓,
movimiento de inventario con su rastro ✓. Todo limpiado después, numeración restaurada — verificado
en cero. Cron corriendo cada minuto, todas las corridas `succeeded`. Lint 0 errores, build ✓.

### ⚠️ Latencia conocida, y desaparece sola

Con el webhook caído, la confirmación la trae el cron **cada minuto** — el cajero puede esperar
hasta ~60s. El modal lo dice explícitamente en vez de quedarse mudo. **En cuanto Luciano rote el
`webhook_secret`, la confirmación vuelve a ser instantánea** y el poller queda sólo como respaldo.

### ✅ Probado con un pago real de $5 (Nadia → Luciano, MercadoPago) — 2026-08-04

Antes de la prueba se le asignó al POS el PdV 2 "Remito" (`envia_arca=false`), temporal, para no
emitir un CAE real e irreversible — mismo mecanismo de la mig.293. Se revirtió después.

**Resultado, verificado en la base:**
- Confirmación en **71 segundos** (19:44:50 → 19:46:01) — consistente con el cron de 60s, ya que el
  webhook sigue rechazando las notificaciones.
- `payment_id` de MP (`171160934391`) coincide exacto con la "Operación" que mostró la app del
  pagador.
- Comprobante `20260804-009`, `estado_pago='pagada'`, `cae_estado='no_aplica'` (no se encoló a ARCA,
  como correspondía con el PdV no fiscal) ✓
- `movimientos_caja`: ingreso $5, `estado_liquidacion='acreditado'` ✓
- Asiento **AS-000203**, balanceado $6,00 = $6,00 (incluye COGS): Debe Caja $5 + Debe Costo
  Mercaderías $1 / Haber Ventas $4,13 + Haber IVA Débito $0,87 + Haber Inventario $1 ✓

**Aclaración sobre la pantalla de MP:** la confirmación de pago en la app del pagador sólo muestra
monto y a quién le pagó ("Luciano Banegas") — no el título/número de venta que sí le mandamos a MP
al crear el QR (`mp-qr-crear` los incluye). Es un límite de esa pantalla de MP, no algo corregible
de nuestro lado. Pendiente de revisar: si el **ticket que imprime el POS** sí muestra bien el número
de venta.

**Limpieza:** asiento+ítems, movimiento de caja, entrega+ítems, movimiento de inventario (stock
devuelto), comprobante+ítems, QR, numeración revertida a 9, producto de prueba "Llavero Auto"
borrado, PdV del POS revertido a `NULL`. Verificado contra la foto de "antes" tomada al inicio —
**coincide número por número** en las 8 métricas comparadas (comprobantes, asientos, movimientos de
caja, QRs, cola ARCA, stock, numeración, PdV).

### 🔴→✅ Al revisar el ticket: el QR NUNCA se estaba encolando a ARCA — bug propio de hoy, corregido

Revisando por qué el ticket mostraba "CAE pendiente" en una venta que nunca iba a tener CAE, apareció
algo más grave: **`useCobroQR.js` nunca resolvía ni mandaba `punto_venta_id`/`tipo_comprobante_afip`**
a `mp-qr-crear` — quedaban siempre en `NULL`. La RPC (`crear_venta_pendiente_qr`) ya estaba preparada
para recibirlos y usarlos bien (numeración por PdV, columna en el comprobante); el gap era 100%
frontend. Consecuencia real: **ninguna venta por QR se iba a encolar a ARCA jamás, ni siquiera las
que pasaran por el PdV fiscal real de Nalux.** Bug introducido en la sesión de hoy (mig.306/307), no
preexistente — no llegó a afectar ninguna venta real: la única que hubo fue la de $5 de la prueba
(que además usó a propósito el PdV no fiscal), ya limpiada.

**Fix:** `useCobroQR` ahora llama `useAfipConfig('pos')` (mismo hook y mismo criterio que ya usa
`useConfirmarVenta` para las ventas normales) y resuelve `punto_venta_id` +
`determinarTipoComprobante(...)` (`null` si el PdV no envía a ARCA) antes de invocar `mp-qr-crear`.
De paso, `TicketPrint.jsx` ahora recibe `venta.cae_estado` y sólo muestra "CAE pendiente" cuando
corresponde — antes lo mostraba siempre que la empresa facturara electrónicamente, sin importar si
*ese* comprobante puntual iba a tener CAE alguna vez.

**Probado en vivo contra producción, con mucho cuidado de no pedir un CAE real por error:**
1. Venta real de $1.200 (Aramis TESTE) por QR desde el POS real → verificado en la base ANTES de
   confirmar nada: `punto_venta_id` = PdV 1 (el fiscal real, `envia_arca=true`), `tipo_comprobante_afip='C'`
   — **la resolución del PdV/tipo ya funciona correctamente**. Como confirmar esta venta real habría
   pedido un CAE real, se **canceló** desde el botón del modal antes de simular nada — verificado:
   stock de vuelta a 5850, 0 en cola ARCA, `cae_estado='no_aplica'`.
2. Para probar que `confirmar_pago_qr` sí encola a ARCA cuando el PdV es fiscal, sin arriesgar un CAE
   real: comprobante + QR **completamente sintéticos y aislados** (sin tocar stock/productos reales),
   confirmados vía la RPC real → `cae_estado` pasó a `'pendiente'` y apareció una fila real en
   `facturas_pendientes_arca` (tipo `C`) ✓ — confirma que el circuito completo funciona. Borrado
   **en segundos**, muy por debajo de la ventana de 5 minutos del cron de `arca-worker` — nunca hubo
   riesgo de que se llamara a la API real de ARCA.
3. Todo lo demás limpiado: el comprobante cancelado del navegador se borró entero (no se dejó como
   registro "cancelada" porque es 100% de prueba), numeración devuelta a 9, movimientos de inventario
   (salida + reversa) borrados. Verificado contra el estado de siempre: **coincide exacto** en las
   6 métricas comparadas.

`npx eslint`: 0 errores (75 warnings preexistentes de `react/prop-types`). `npx vite build`: ✓.

---

## ✅ `anon` ya no puede ejecutar NINGUNA función SECURITY DEFINER — mig.304/305

Cierra el último ítem abierto de la auditoría: los 10 WARN
`anon_security_definer_function_executable`. **Resultado: 10 → 0.**

**Por qué se hizo aunque ninguna era explotable hoy:** es defensa en profundidad. Las 10 ya se
defendían (8 con `get_my_empresa_id()`, que para `anon` devuelve NULL y dispara el guard; 1 es
función de trigger; 1 no toca datos de tenant). Pero mientras exista el permiso, cualquier futura
edición que se lleve puesto un guard por descuido convierte ese error en un agujero **accesible sin
login**. Sacando el permiso, ese escenario deja de ser posible por construcción.

### ⚠️ Gotcha de Postgres — la mig.304 fue un NO-OP silencioso

**La mig.304 hizo `REVOKE ... FROM anon` y no cambió absolutamente nada.** Se detectó porque
después de aplicarla el conteo seguía en 10, idéntico a antes.

El ACL de estas funciones era:
```
{=X/postgres, postgres=X/postgres, authenticated=X/postgres, service_role=X/postgres}
```
Ese primer `=X` (sin rol a la izquierda del `=`) significa **`PUBLIC` tiene EXECUTE**. En Postgres
todos los roles heredan de `PUBLIC`, así que `anon` podía ejecutarlas **por herencia, no por un
GRANT directo**. `REVOKE ... FROM anon` intenta quitar un permiso directo que nunca existió → no
hace nada, **y no tira error**, así que pasa desapercibido salvo que se verifique el resultado.

**El revoke correcto es `FROM PUBLIC`** (mig.305), y es seguro precisamente por cómo está armado
ese ACL: `authenticated` y `service_role` tienen entradas **explícitas** que sobreviven intactas. El
único que pierde acceso es quien lo tenía sólo por herencia: `anon`. Es el mismo patrón que ya usaba
la mig.063 (`REVOKE ... FROM PUBLIC, anon;`) — la 304 copió sólo la mitad de la fórmula.

**Lección:** después de un `REVOKE`/`GRANT`, verificar siempre el resultado con
`has_function_privilege()`. Un revoke que no aplica **no falla, simplemente no hace nada**.

### 🔄 Corrección de lo documentado antes: `email_exists_in_system`

La auditoría la había anotado como *"riesgo aceptado — la necesita el alta de usuarios, sacarla
rompe el registro"*. **Eso era incorrecto.** Verificado con grep sobre todo `src/`: su único caller
es `validationUtils.checkEmailExists`, y a ese lo llama únicamente `UsuariosSection.jsx:150` — la
pantalla de **administración de usuarios**, que es autenticada. `AuthPage.jsx` (el registro/login
público) **no la usa**. O sea que el GRANT a `anon` nunca hizo falta, y encima habilitaba
enumeración de emails registrados sin login. Se revocó: **ese agujero también quedó cerrado**, sin
ningún trade-off.

**Probado en vivo contra producción:**
- `anon` → `permission denied for function email_exists_in_system` ✓ (enumeración cerrada)
- `authenticated` (el caso real de UsuariosSection) → sigue devolviendo `true`/`false` correctamente ✓
- `service_role` sobre `insertar_movimiento_bancario_externo` (la usa `mp-webhook`) → intacto ✓
- **Trigger `fn_punto_venta_unico_default`**: se disparó un UPDATE real sobre `puntos_venta` como
  usuario autenticado y **funcionó sin error**, confirmando que Postgres verifica el EXECUTE de una
  función de trigger al CREAR el trigger, no en cada disparo. Invariante intacto: 2 PdV default,
  los mismos de antes, 0 empresas con más de uno ✓

### 📊 Advisors de seguridad — jornada completa

| Hallazgo | Inicio | Final |
|---|---|---|
| 🔴 ERROR `security_definer_view` | 1 | **0** (mig.299) |
| WARN `anon_security_definer_function_executable` | 10 | **0** (mig.305) |
| WARN `public_bucket_allows_listing` | 2 | **0** (mig.302) |
| WARN `authenticated_security_definer_function_executable` | 82 | **81** (mig.300) |
| WARN `auth_leaked_password_protection` | 1 | 1 — *toggle del dashboard, ver arriba* |
| WARN `extension_in_public` | 1 | 1 — menor, sin impacto de aislamiento |
| INFO `rls_enabled_no_policy` | 2 | 2 — tablas de workers, cerradas de hecho |
| **TOTAL** | **99** | **85** |

Sin hallazgos de nivel ERROR, y sin ninguna función ejecutable por `anon`.

---

## ✅ 136 asientos reales sin vincular a su venta/compra — mig.303

Salió del **barrido de sanidad** de cierre de jornada.

**El hallazgo:** la **mig.281** (2026-07-30 18:54) agregó `comprobantes.asiento_id` /
`compras.asiento_id` y el código que las escribe (`planCuentasService.ts`), pero **nunca corrió un
backfill** para los asientos que ya existían. Verificado con precisión quirúrgica: **100% de los
registros ANTERIORES al 2026-07-30 tenían el vínculo roto** (124 de 125 comprobantes, 12 de 12
compras) y **100% de los posteriores estaban bien**. No era un bug activo — el código actual
funciona correctamente para todo lo nuevo. Era deuda histórica sin backfillear.

**Por qué importaba (riesgo armado, no disparado):** el botón "Regenerar asiento"
(`CompraDetailModal` / `FacturaDetailModal`) sólo mira esa columna para decidir si mostrarse. Para
esos 136 registros viejos el botón aparecía diciendo *"no tiene asiento contable"* cuando en
realidad **sí tenía uno real, correcto y confirmado**. Y las RPCs `regenerar_asiento_venta` /
`regenerar_asiento_compra` sólo comprobaban esa misma columna rota antes de insertar → un clic
habría creado un **SEGUNDO asiento real**, duplicando el impacto contable de esa venta/compra.
Verificado antes de tocar nada: **0 duplicados existían** — nadie lo había clickeado todavía.

**Fix en dos partes:**
1. **Backfill** de los 136 vínculos (`UPDATE ... FROM asientos_contables ... WHERE origen_id = c.id`).
   Seguro porque se verificó que la relación por `origen_id` es 1 a 1, sin ambigüedad.
2. **Blindaje autoreparador** en ambas RPCs: antes de insertar, ahora buscan si **ya existe** un
   asiento real por `origen_id`. Si existe, sólo reconectan el vínculo y devuelven
   `{reconectado: true}` — **nunca duplican**. Así el riesgo no puede repetirse aunque el UPDATE de
   vinculación vuelva a fallar en el futuro (red cortada, tab cerrada a mitad de camino). El guard
   original (`asiento_id IS NOT NULL` → excepción) se mantiene intacto arriba del chequeo nuevo.

**Probado en vivo contra producción:**
- Backfill: **136 → 0 vínculos rotos**, y el total de asientos **se mantuvo en 201** (ni uno creado) ✓
- Guard principal: sobre una compra real ya reconectada → `"Esta compra ya tiene un asiento
  contable generado"`, sin duplicar ✓
- **Rama de autoreparación**: se reprodujo el escenario histórico exacto con datos sintéticos
  (compra + asiento real con el vínculo roto a propósito) → devolvió `{ok:true, reconectado:true}`
  con el **mismo** `asiento_id`, la compra quedó con **1 solo asiento** ✓
- Limpieza: datos de prueba borrados, total de vuelta a **201**, 0 fantasmas ✓

---

## 🧹 Barrido de sanidad 2026-08-03 — resto de los chequeos

Todo lo demás salió limpio. Se verificó: 0 asientos desbalanceados, 0 sesiones de caja abiertas,
0 cheques con error de asiento sin resolver, 0 comprobantes de venta/factura sin ítems, 0
comprobantes con `cae` pero sin `numero_afip`, 0 tarjetas pendientes de liquidación vencidas +5
días, 0 QRs colgados, 0 comprobantes con `cae_estado='error'`, 9/9 cron jobs activos, logs de edge
functions 100% `POST 200`, advisors de performance sin ningún ERROR, **28/28 tests unitarios verdes**,
lint y build en 0 errores.

**Worktrees fantasma eliminados.** Había dos copias del proyecto colgadas de sesiones viejas:
`.claude/worktrees/epic-sutherland-3e03f8` (branch `claude/epic-sutherland-3e03f8`, del 30/07) y
`suspicious-panini-6cb9e5` (17/06, 76K de basura suelta, ni siquiera registrada como worktree en
git). Vitest escaneaba la primera, así que **contaba cada test dos veces** (reportaba "56 tests"
cuando en realidad son 28) y fallaba con un spec de Playwright que no podía resolver
`scripts/loadtest/fixtures.json` porque el worktree había quedado incompleto. Tras limpiar: 28/28
tests reales, 0 failed suites, y la corrida bajó de **223s a 55s**.

**Antes de borrar se rescató un fix real que había quedado sin commitear ahí** — ver la sección de
Compra Rápida más abajo. Se verificó byte a byte (`diff --strip-trailing-cr`) que el contenido ya
estuviera a salvo en master antes de eliminar nada, y la branch se borró con `git branch -d` (no
`-D`) para que el propio git confirmara que estaba mergeada.

---

## ✅ Editar una compra ya no pisa la hora de la fecha

Rescatado del worktree fantasma antes de limpiarlo — era el bug de truncamiento de fecha en Compra
Rápida que estaba anotado como pendiente deferido.

**El bug:** `handleEditClick` hacía `compra.fecha.split('T')[0]` para poblar el input `date`
(correcto — el input necesita `YYYY-MM-DD`), pero después `handleSaveEdit` mandaba **ese mismo
string truncado** al UPDATE. Resultado: cada vez que alguien editaba una compra —aunque no tocara
el campo Fecha— la hora original se perdía.

**El fix** guarda el timestamp completo en `editForm.fechaOriginal` y, al guardar, compara: si el
usuario no tocó la fecha reusa el timestamp original intacto; si la cambió la reconstruye con
`getDateFromInputAR` (el mismo criterio que ya usa "Nueva Compra": hoy → hora actual, otro día →
12:00 neutro), que además evita el corrimiento de día por timezone.

**Basura limpiada:** 8 filas huérfanas en `facturas_pendientes_arca` (`comprobante_id=NULL`,
`error_definitivo`, del 28-31/07). Diagnóstico: el FK es `ON DELETE SET NULL`, así que al borrar los
comprobantes de las pruebas end-to-end de mig.286 y 293-296, las filas de la cola quedaban
desconectadas y el worker las marcaba en error. Basura de auditoría, no bug funcional. Los 16
errores que quedan son las 4 NC históricas × reintentos, ya documentadas como tema del contador.

---

# 📋 PARA LUCIANO — 3 cosas que sólo podés hacer vos

> Escrito por Nadia/Claude el **2026-08-03**, reconfirmado sin cambios el **2026-08-04** (ninguna de
> las tres se movió). Las tres están fuera del alcance del código: dependen de cuentas o paneles a
> los que Nadia no tiene acceso.

### 1. 🔴 Secreto de firma de MercadoPago — bloquea el cobro por QR

El bug del webhook de QR (mig.297/298) **no se puede cerrar sin vos**: la cuenta de MercadoPago está
a tu nombre.

**Qué hacer:** [panel.mercadopago.com.ar](https://www.mercadopago.com.ar/developers/panel) → tu
aplicación → **Webhooks** → copiar el **"Secreto de firma"** actual.

**Lo que ya verificamos (2026-08-03):** se revisó `mp-webhook` línea por línea y la validación HMAC
está implementada exactamente como documenta MP
(`id:{payment_id};request-id:{x-request-id};ts:{ts};`, HMAC-SHA256, hex) — **no hay bug de código**.
Confirma tu diagnóstico. El `webhook_secret` guardado en `integraciones_bancarias.config` para Nalux
tiene 64 chars y **no se toca desde el 2026-06-27**. Todo apunta a que ése no es el que MP usa hoy
para firmar.

Para comparar sin pegar el secreto en ningún lado, corré esto y contrastá el prefijo con lo que
muestra el panel (el valor completo **nunca** va al repo ni al chat):
```sql
SELECT left(config->>'webhook_secret', 6) AS prefijo, length(config->>'webhook_secret') AS largo, updated_at
FROM integraciones_bancarias WHERE proveedor = 'mercadopago';
```

Con ese valor el fix es inmediato: un `UPDATE` de una fila + repetir una prueba de pago real chico.
**Mientras tanto, toda venta por QR queda en `pendiente` para siempre** hasta que alguien la confirme
a mano. El dinero SÍ aparece en Bancos (lo trae `mp-sync-worker` por polling independiente); lo que
no ocurre es marcar la venta como pagada, generar el asiento y disparar AFIP.

### 2. ⏳ Plan de Supabase — los proyectos se restringen el 17/08/2026

Verificado hoy: la organización **NALUX sigue en plan `free`**, y el dashboard avisaba que los
proyectos quedan restringidos desde el **17 de agosto**. Quedan **2 semanas**. Es tema de billing, va
por tu cuenta. Si el proyecto se restringe, se cae la producción de todos los clientes.

### 3. 🔒 Activar "Leaked password protection" (1 clic, gratis)

**Supabase → Authentication → Policies → "Leaked password protection".** No se puede activar por
migración ni por MCP, es un toggle del dashboard. Hace que Supabase rechace contraseñas que
aparecen en filtraciones conocidas (HaveIBeenPwned). Dado que el sistema maneja datos contables de
varias empresas, conviene. Lo puede hacer cualquiera de los dos.

---

# 🗂️ Estado de pendientes al 2026-08-03

**Cerrados hoy** (4 migraciones, todas probadas en vivo contra producción y pusheadas):
- ✅ mig.299 — `facturas_saldo_pendiente` ignoraba el RLS (fuga multi-tenant, era el único ERROR)
- ✅ mig.300 — guard de tenant regresionado + `record_attempt` sobre-expuesta
- ✅ mig.301 — **el alta de empresas nuevas estaba rota desde el 01/08** (nadie lo había notado)
- ✅ mig.302 — buckets públicos permitían listar archivos de todas las empresas

**Cerrados por Luciano el 01/08, verificados hoy:** las 2 sesiones de caja anómalas (la del 28/07 y
la que quedó abierta desde el 29/05). No queda ninguna sesión abierta en el sistema (30/30 cerradas).

**Verificados hoy como YA RESUELTOS** (el CONTEXT.md tenía notas viejas que decían lo contrario):
- El "gap de no relevante fiscal en el POS" → lo resolvió mig.293/294/295, y el badge de solo
  lectura es una decisión de diseño deliberada, no un descuido.
- "No hay forma de regenerar un asiento de venta/compra" → `regenerar_asiento_venta` y
  `regenerar_asiento_compra` existen desde mig.281.

**Abiertos, ordenados por prioridad:**

| Qué | De quién | Nota |
|---|---|---|
| Secreto de firma de MP | **Luciano** | Bloquea el QR por completo |
| Plan free vence 17/08 | **Luciano** | 2 semanas |
| Toggle leaked passwords | Cualquiera | 1 clic |
| ~~QR MercadoPago Fase 2~~ | — | ✅ **HECHO** el 04/08 (mig.306/307): modal, polling, cancelar, cron de expiración y AFIP funcionando de punta a punta — probado con un pago real. |
| ~~Revocar `GRANT` de `anon`~~ | — | ✅ **HECHO** el 03/08 (mig.304/305): `anon` pasó de 10 funciones ejecutables a **0**. |
| Dominio propio en Resend | Nadia | Deferido a propósito. Gmail SMTP ya resuelve el bloqueo total. |
| 4 NC históricas mal declaradas ante ARCA | Contador de Nalux | No es corregible por código |
| CbteAsoc en `informar-caea` | Equipo | Sin urgencia — probar recién a partir del 12/08 (ver PdV CAEA arriba) |
| ~~Tienda MP huérfana en la cuenta de Nalux~~ | — | ✅ **HECHO** el 05/08 — verificado con la API de MP y borrada |
| ~~Overload huérfano de `crear_nota_credito` (8 args)~~ | — | ✅ **HECHO** el 05/08 (mig.308) |
| ~~Trámite del PdV CAEA en AFIP~~ | — | ✅ **HECHO** el 05/08 — ver sección arriba |
| Venta puntual no fiscal en el POS | Equipo | **No es un gap hoy** — sólo haría falta si aparece el caso de uso (muestra gratis, consumo interno) |
| MELI Factura A | — | Deferido. **No construir sin pedido explícito.** |

---

## ✅ Buckets públicos permitían LISTAR archivos de todas las empresas — mig.302

Los 2 WARN `public_bucket_allows_listing` de los advisors.

**Situación:** `logos-empresa` y `productos-imagenes` estaban **bien** del lado de escritura — las
políticas de INSERT/UPDATE/DELETE ya exigían
`(storage.foldername(name))[1] = get_my_empresa_id()::text`, o sea que cada empresa sólo escribe en
la carpeta que lleva su propio `empresa_id`. Eso no se tocó. El problema era sólo el **SELECT**:
las políticas `*_select_publico` daban SELECT al rol `public` (que incluye `anon`) sobre **todo** el
bucket, sin restricción de carpeta.

**La distinción clave:** en un bucket público los objetos se sirven por
`/storage/v1/object/public/<bucket>/<path>` **sin consultar RLS** — esa es la definición de bucket
público. La política de SELECT sobre `storage.objects` no habilita **ver** las imágenes: habilita
**listarlas** (`.list()`), que es otra cosa.

**Qué se filtraba (verificado en vivo simulando el rol `anon`, no asumido):** un anónimo podía
listar los **15 archivos** de ambos buckets y enumerar **3 `empresa_id` distintos**. Como las
carpetas SON los `empresa_id`, eso es enumeración de inquilinos: cuántas empresas hay, sus UUID (la
clave de tenant de todo el sistema), cuántos productos con imagen tiene cada una y los nombres de
archivo.

**Verificado antes de tocar nada:** la app NO usa `.list()` sobre ninguno de los dos buckets — sólo
`getPublicUrl()` (puro string del lado del cliente, ni siquiera pega a la API), `upload()` (INSERT) y
`remove()` (DELETE), en `ProductoImagenes.jsx` y `ConfiguracionSection.jsx`. Los `.list(` del grep
son constructores de `queryKey` de react-query, no del Storage. Las edge functions usan
`service_role`, que no pasa por RLS.

**Fix:** en vez de borrar la política (que dejaría a un usuario sin poder listar ni su propia carpeta
si algún día se agrega una galería), se reemplazó por una acotada: sólo `authenticated` y sólo su
propio `empresa_id` — el mismo criterio que ya usaban INSERT/UPDATE/DELETE ahí.

**Probado en vivo contra producción:**
- `anon` listando → **0 archivos, 0 empresas** ✓ (antes: 15 archivos, 3 empresas)
- usuario de Nalux listando → **13 archivos, 1 sola carpeta** (la suya) ✓
- **Las imágenes públicas siguen sirviéndose** — comprobado con `curl` real y sin ningún header de
  autenticación: logo Nalux `HTTP 200 image/jpeg 16907 bytes`, logo CAEA Test `HTTP 200 image/png
  45780 bytes`, imagen de producto `HTTP 200 image/jpeg 25395 bytes` ✓. Esta era la premisa
  riesgosa del cambio (si un bucket público NO sirviera sin RLS, se habrían roto todas las imágenes
  del sistema), por eso se verificó por HTTP y no por deducción.

### 📊 Advisors de seguridad — antes vs. después de la jornada

| Hallazgo | Antes | Ahora |
|---|---|---|
| 🔴 ERROR `security_definer_view` | 1 | **0** (mig.299) |
| WARN `public_bucket_allows_listing` | 2 | **0** (mig.302) |
| WARN `authenticated_security_definer_function_executable` | 82 | **81** (mig.300) |
| WARN `anon_security_definer_function_executable` | 10 | 10 |
| WARN `auth_leaked_password_protection` | 1 | 1 |
| WARN `extension_in_public` | 1 | 1 |
| INFO `rls_enabled_no_policy` | 2 | 2 |
| **TOTAL** | **99** | **95** |

**El proyecto ya no tiene ningún hallazgo de nivel ERROR.**

**Lo que queda y por qué NO se tocó:**
- **`auth_leaked_password_protection`** — es un toggle del dashboard de Supabase
  (Authentication → Policies → "Leaked password protection"), no hay forma de activarlo por
  migración ni por MCP. **Lo tiene que hacer Nadia o Luciano a mano.** Gratis, un clic: hace que
  Supabase rechace contraseñas que aparecen en filtraciones conocidas (HaveIBeenPwned).
- **`anon_security_definer_function_executable` (10)** — auditadas una por una: 8 se defienden con
  `get_my_empresa_id()` (que para `anon` devuelve NULL, así que el guard dispara), 1 es una función
  de trigger (PostgREST no expone funciones que retornan `trigger`) y 1 es `email_exists_in_system`,
  que **necesita** ser anon-ejecutable porque la usa el alta de usuarios. Revocar los GRANT de
  `anon` sobre las 8 no-esenciales sería higiene de defensa en profundidad — candidato para la
  próxima tanda, no urgente.
- **`rls_enabled_no_policy` (2)** — `afip_tickets` y `arca_worker_run` tienen RLS activo sin
  políticas, o sea **cerradas de hecho**: nadie accede. Es lo correcto para tablas internas de
  workers; el advisor lo marca como INFO, no como problema.
- **`extension_in_public`** — menor, sin impacto de aislamiento.

---

## 🔴 BUG CRÍTICO ya corregido: no se podía dar de alta una empresa nueva — mig.301

Apareció **probando el guard restaurado por la mig.300** — el test lo destapó, la mig.300 no lo
introdujo (copió el mismo `ON CONFLICT` que ya estaba desde antes).

**Causa raíz:** la **mig.295** (numeración por punto de venta) reemplazó el índice único plano
`(empresa_id, tipo_documento)` de `series_numeracion` por dos índices **parciales**
(`idx_series_numeracion_legacy` … `WHERE punto_venta_id IS NULL` e `idx_series_numeracion_por_pdv`
… `WHERE punto_venta_id IS NOT NULL`). Pero `seed_series_numeracion` siguió con
`ON CONFLICT (empresa_id, tipo_documento)` a secas. **Postgres no resuelve un `ON CONFLICT` a un
índice parcial si no se repite su predicado `WHERE`** → `ERROR 42P10`.

**Por qué era crítico** (verificado paso a paso, no asumido):
1. El error es de **planificación**, no de datos — comprobado con un `INSERT … WHERE false` que no
   inserta ninguna fila y **aun así** tira 42P10. O sea: fallaba el 100% de las veces.
2. El trigger `trg_empresa_seed_series_numeracion` (AFTER INSERT ON empresas) está activo.
3. Ni el trigger ni `create_tenant()` tienen manejador de excepciones (el único `EXCEPTION` de
   `create_tenant` es un `RAISE`, no un `WHEN…THEN`), así que la excepción propagaba.

Encadenado: alta de usuario → `create_tenant()` → `INSERT INTO empresas` → trigger → 42P10 →
**rollback del alta entera. Nadie podía registrar una empresa nueva.**

**Por qué nadie lo notó:** la última empresa se creó el **2026-07-24** y la mig.295 se aplicó el
**2026-08-01**. No hubo ningún alta en esa ventana.

**Fix (mig.301):** repetir el predicado del índice parcial —
`ON CONFLICT (empresa_id, tipo_documento) WHERE punto_venta_id IS NULL DO NOTHING`. La función
siempre inserta con `punto_venta_id` NULL (ni siquiera nombra la columna), así que el índice
aplicable es el `legacy`.

**Probado en vivo end-to-end contra producción:** se creó una empresa real de prueba
(`ZZZ-TEST-301-BORRAR`) → el trigger sembró **las 11 series correctamente** ✓ (antes el INSERT
entero hacía rollback) → `seed_maestros_default` también corrió bien (15 unidades de medida,
5 condiciones de pago, 4 formas de pago) ✓ → empresa borrada, `ON DELETE CASCADE` limpió las 35
filas → **verificado en cero**, totales de vuelta a 60 series / 5 empresas ✓. El guard de tenant
sigue rechazando el cruce de empresas después del cambio ✓.

**Lección para no repetirlo:** cuando una migración cambia un índice único plano por uno **parcial**,
hay que revisar TODOS los `ON CONFLICT` que apuntaban a él — no fallan al aplicar la migración, sino
la próxima vez que alguien ejecuta el `INSERT`. Acá pasaron 2 días sin que nadie lo notara sólo
porque no hubo altas nuevas.

---

## ✅ Auditoría de las 82 funciones SECURITY DEFINER — mig.300

Balance general **tranquilizador**: de las 82 ejecutables por `authenticated`, **69 ya estaban bien
defendidas** — 50 con guard explícito (`RAISE` si `p_empresa_id` no coincide con
`get_my_empresa_id()`), 19 que derivan el tenant del JWT sin confiar en parámetros. Otras 7 son
funciones de trigger (PostgREST no expone funciones que retornan `trigger`, no hay superficie de
ataque) y 1 tiene el guard inline en el `WHERE` (`get_tasa_cambio`). **Sólo 2 problemas reales**,
ambos regresiones silenciosas:

**1. `seed_series_numeracion` perdió el guard de tenant de la mig.057.** Rastreado exactamente: la
057 lo puso, la **086 lo respetó**, y la **mig.268 lo borró** al redefinir la función para agregar
`nota_debito_venta` — se copió el cuerpo anterior a la 057. La mig.277 arrastró el mismo error.
Quedó a la vista porque su hermana `seed_maestros_default` (guardada por la misma 057) **sí lo
conserva**. Severidad baja (el `ON CONFLICT DO NOTHING` lo vuelve no-op contra una empresa ya
sembrada — el mismo "riesgo residual aceptado" que la 057 documentaba), pero es un control que
desapareció sin que nadie lo note. Se restauró el guard **exacto** de la 057, no uno más estricto:
el escape `…AND el usuario ya tiene empresa asignada` es imprescindible, porque durante el alta de
un tenant nuevo `get_my_empresa_id()` todavía devuelve NULL y un guard estricto rompería **todo**
alta de empresa.

**2. `record_attempt` era ejecutable por `authenticated`, contra lo que afirma un test propio.**
`supabase/tests/aislamiento_multitenant.test.sql` (Caso 8) asegura que un usuario autenticado NO
puede llamarla; en producción el ACL era `{postgres, authenticated, service_role}` — **el test
estaba fallando**. No lo causó ninguna migración del repo: viene de los *default privileges* de
Supabase al crear la función (mig.016), y la mig.063 revocó de `PUBLIC` y `anon` pero no de
`authenticated`. Verificado antes de revocar que la función está **completamente huérfana** — 0
llamadores en `src/`, en `supabase/functions/` y en `pg_proc` (el comentario del propio test, que
decía "sólo la llaman otras RPCs internamente", tampoco era exacto). Severidad baja hoy porque el
rate limiting no está cableado a nada; si se cableara, un atacante autenticado podría llamar
`record_attempt('login','victima@mail')` N veces y dejar esa cuenta bloqueada. Revocado antes de que
el riesgo exista. `check_rate_limit` se dejó como está: es de sólo lectura y no expone datos de
ningún tenant.

**Riesgo aceptado, documentado, NO cambiado:** `email_exists_in_system` es ejecutable por `anon` sin
validación alguna → permite enumerar si un email está registrado. Pero lo usa
`src/lib/validationUtils.js:11` para el alta de usuarios, que por definición ocurre **antes** del
login; sacarlo rompe el registro. Es el trade-off clásico enumeración/UX. Si algún día molesta, la
mitigación es rate-limitear la llamada, no quitarla.

---

## ✅ Blindspot multi-tenant: `facturas_saldo_pendiente` ignoraba el RLS — mig.299

Encontrado revisando los advisors de Supabase (único hallazgo nivel **ERROR** del proyecto).

**El hallazgo:** de las 5 vistas del esquema `public`, `facturas_saldo_pendiente` era la **única**
sin `security_invoker`. Sin esa opción Postgres ejecuta la vista con los permisos de su dueño
(`postgres`, superusuario) en vez de los de quien consulta — o sea **el RLS de `comprobantes` no se
aplicaba**. Y la vista por dentro tampoco filtra por `empresa_id`. Su gemela `compras_saldo_pendiente`
(mig.169, la misma vista del lado de Compras) ya lo tenía bien, igual que las otras tres: era un
descuido puntual, no una decisión de diseño.

**Impacto:** `anon` y `authenticated` tienen `GRANT SELECT` sobre la vista. Cualquier usuario logueado
de cualquier empresa podía pegarle al endpoint REST sin ningún filtro y leer las facturas impagas de
**todas** las empresas: razón social del cliente, número de comprobante, monto adeudado y vencimiento.
Es exactamente lo que `CLAUDE.md` prohíbe ("un usuario de Empresa A ve datos de Empresa B") y son
datos comerciales + personales alcanzados por la Ley 25.326.

**Alcance real al momento de arreglarlo:** 27 filas, todas de una sola empresa (Nalux) — el agujero
estaba abierto pero **todavía no se había materializado ninguna fuga entre inquilinos**. Se activaba
solo con que una segunda empresa tuviera una factura impaga.

**Fix (mig.299):** `ALTER VIEW public.facturas_saldo_pendiente SET (security_invoker = true);` — una
línea, alineando la vista con las otras cuatro. Seguro porque `comprobantes` (3 políticas) y
`cuenta_corriente_imputaciones` (1 política) ya tenían RLS activo y funcionando.

**Además, en el frontend:** `fetchFacturasAbiertas` (`CuentaCorrienteSection.jsx`) consultaba la vista
filtrando **sólo por `cliente_id`, sin `empresa_id`** — otra cosa que `CLAUDE.md` prohíbe. Se le
agregó el filtro como defensa en profundidad (el RLS ya lo cubre, pero no se deja una query sin
filtro de empresa). El otro call-site (Antigüedad de saldos) ya lo mandaba bien.

**Probado en vivo contra producción**, simulando cada rol con `SET LOCAL role` + `request.jwt.claims`:
- **A · usuario de Nalux** → ve sus 27 filas, $1.852.962 ✓ (no se rompió nada)
- **B · usuario de otra empresa (Creativas)** → ve **0 filas** ✓ (antes veía las 27 de Nalux)
- **C · `anon` sin login** → `permission denied for function get_my_empresa_id` ✓ (bloqueo duro)

`npx eslint` sobre `CuentaCorrienteSection.jsx`: 0 errores (4 warnings preexistentes de prop-types /
exhaustive-deps, patrón ya presente en el archivo).

**Pendientes de seguridad que quedaron anotados, NO tocados** (cada uno es una tanda en sí misma):
82 funciones `SECURITY DEFINER` ejecutables por `authenticated` + 10 por `anon` (WARN — hay que
auditar una por una); 2 buckets públicos (`logos-empresa`, `productos-imagenes`) con política SELECT
amplia que permite **listar** todos los archivos, no sólo acceder por URL; protección de contraseñas
filtradas desactivada en Auth (es un toggle del dashboard); `extension_in_public`; y 2 tablas con RLS
activo pero sin políticas (`afip_tickets`, `arca_worker_run` — cerradas de hecho, sin acceso).

**⚠️ Aparte, con fecha límite:** la organización **NALUX está en plan `free`** y el dashboard avisaba
que los proyectos se restringen desde el **17/08/2026**. Verificado el 2026-08-03: sigue en `free`.
Es tema de Luciano (billing) — faltan 2 semanas.

---

## ⚠️ QR MercadoPago en el POS — Fase 1 (backend) lista, con un bug real pendiente — mig.297/298

Último ítem del roadmap del POS (tanda 2). Se construyó el backend completo del cobro por QR
Dinámico de MercadoPago: la venta se crea en `estado_pago='pendiente'` apenas se genera el QR
(mismo patrón "crear ya en pendiente, confirmar después vía cola" que ya usa AFIP con
`facturas_pendientes_arca`/`arca-worker`), y se confirma cuando llega el webhook de MP.

**Por qué no se pudo reusar `crear_venta`:** inserta en `movimientos_caja` para cualquier método
salvo el string exacto `'Cuenta Corriente'`, y `crearAsientoVenta` (JS) postea el DEBE a Caja y
Bancos salvo `esCredito=true` — ambos reconocerían el QR como cobrado antes de tiempo. Tampoco
había precedente de generar un asiento contable fuera del JS del frontend (`crearAsientoVenta`
depende indirectamente de `auth.uid()`, que no existe en un webhook con `service_role`). Por eso:
3 RPCs nuevas dedicadas, con el asiento de confirmación en SQL puro.

**mig.297 (`supabase/migrations/297_qr_mercadopago_pos.sql`):**
- Tabla `qr_pagos_mp` (empresa_id, comprobante_id, user_id, external_reference único, in_store_order_id, qr_data, monto, estado pendiente/pagado/expirado/cancelado, payment_id, expiracion). Índice único parcial: máximo un QR `pendiente` por comprobante.
- `crear_venta_pendiente_qr` — copia acotada de `crear_venta` (sin loop de pagos, sin CC, sin encolar AFIP todavía), calcula el total 100% server-side (nunca confía en un total mandado por el cliente, porque acá dispara un cobro externo desatendido). `GRANT` a `authenticated`.
- `confirmar_pago_qr` — la pieza sensible. Llamada **solo** por `mp-webhook` con `service_role` (GRANT exclusivo a `service_role`, revocado de `authenticated`). Lockea `qr_pagos_mp` FOR UPDATE, es idempotente (no-op si ya no está `pendiente`), inserta `movimientos_caja`, genera el asiento en SQL puro (DEBE 1.1.1 Caja y Bancos / HABER 4.1 Ventas + 2.1.3 IVA Débito Fiscal / + COGS DEBE 5.1 HABER 1.1.3 si aplica — mismo criterio permisivo que `regenerar_asiento_venta`: cuenta faltante → se omite esa línea, nunca bloquea), marca `comprobantes.estado_pago='pagada'`.
- `cancelar_venta_pendiente_qr` — mismo patrón de reversa de stock que `cancelar_factura`, con lock+recheck de `qr_pagos_mp.estado` para que un cajero no pueda cancelar una venta que el webhook ya confirmó en el ínterin (race real).
- `formas_pago` — fila "QR MercadoPago" (`tipo_instrumento='billetera'`) **sin** `cuenta_bancaria_id` a propósito: si se le asignara una, el trigger `trg_fn_puente_caja_bancos` duplicaría lo que la conciliación MP existente (`mp-sync-worker`) ya inserta en `movimientos_bancarios` por su cuenta.

**mig.298:** el QR original vencía a los 10 minutos y un test real expiró antes de poder escanearlo — se subió a 15 minutos (`crear_venta_pendiente_qr` y `expiration_date` en `mp-qr-crear`).

**Edge function nueva `mp-qr-crear`:** dos clientes Supabase a propósito — `userClient` (JWT del caller) solo para `crear_venta_pendiente_qr` (así `auth.uid()`/RLS resuelven igual que cualquier venta del frontend, la autorización real vive en el RPC) y `adminClient` (`service_role`) para Vault + llamadas a la API de MP. Dado de alta de tienda+caja MP una única vez por empresa (persistido en `integraciones_bancarias.config.mp_store_id`/`mp_external_pos_id`), con 6 gotchas reales de la API de Stores/POS de MP descubiertos en vivo (no documentados claramente): sin campo `country` en `location` (probar 'AR'/'ARG' da `unknown_country`), `latitude`/`longitude` son obligatorios aunque no figuren como tal, `external_id` debe ser alfanumérico sin guiones y corto (máx. ~20 chars). El `store_id` se persiste apenas se crea (antes de intentar el POS) para no generar tiendas duplicadas si falla el segundo paso.

**`mp-webhook` (existente, editado, bloque aditivo sin `return` — sigue cayendo a la conciliación bancaria de siempre):** si `pago.external_reference` matchea una fila `qr_pagos_mp` pendiente, llama `confirmar_pago_qr`. Verificado que NO duplica con `movimientos_bancarios` (que sigue viniendo, sin tocar, de `mp-sync-worker`/`mp-webhook` de siempre).

### 🔴 Bug real encontrado en la prueba en vivo — sin resolver

Se probó con un pago real de $100 vía QR (Nalux). El pago fue aprobado por MP, pero **el webhook
`mp-webhook` rechazó la notificación real 3 veces con 401 (firma HMAC inválida)** — la venta se
quedó en `pendiente` y **no se confirmó sola**. Se tuvo que confirmar manualmente reproduciendo la
lógica del webhook (fetch a `/v1/payments/{id}` + `confirmar_pago_qr`) para dejar la venta
correctamente `pagada`, con el asiento (`AS-000202`, balanceado) y `movimientos_bancarios`
sincronizado por separado por `mp-sync-worker` (sin duplicar).

**Diagnóstico hecho:** se agregó logging temporal (`_webhook_debug_temp`, ya eliminado) que
capturó el próximo reintento real de MP. Los datos estaban bien formados — `payment_id` correcto,
`x-request-id` presente (UUID real de 36 chars, no vacío), `ts`/`v1` con formato válido, ambos
hashes de 64 chars (SHA-256 hex) — pero **el hash calculado nunca coincidió con el `v1` recibido**,
con el algoritmo exacto que documenta MP (`id:{data.id};request-id:{x-request-id};ts:{ts};`).
Esto descarta un bug de parseo/formato en el código y apunta a que **el `webhook_secret` guardado
en `integraciones_bancarias.config` (Vault-free, vive en el config JSON) para Nalux no es el que
MP usa realmente para firmar hoy** — no fue rotado en esta sesión (`updated_at` de la integración:
2026-06-27), así que puede estar desalineado desde antes, o corresponder a otra suscripción de
webhook del panel de MP.

**Impacto real:** como `mp-sync-worker` sincroniza `movimientos_bancarios` por polling
independientemente del webhook, el dinero SIEMPRE termina apareciendo en Bancos — pero
`confirmar_pago_qr` (que marca la venta como pagada, genera el asiento y dispara AFIP) **depende
100% de que el webhook valide la firma correctamente**. Sin eso, una venta QR real se queda
`pendiente` para siempre hasta que alguien la revise a mano. Este bug puede ser preexistente y
afectar también la conciliación de Tarjeta/Transferencia — pero ahí pasa desapercibido porque el
polling compensa; en QR es la única vía.

**Próximo paso (no hecho, requiere el panel de MP):** entrar a panel.mercadopago.com.ar → tu app →
Webhooks → copiar el "Secreto de firma" actual y compararlo/actualizarlo contra
`integraciones_bancarias.config.webhook_secret` de Nalux. Después, repetir la prueba de pago real
para confirmar que el webhook ya no da 401.

**Alcance NO cubierto (Fase 2, deliberadamente fuera de esta sesión):** modal del QR en el POS
(`PanelCarrito.jsx`), polling/Realtime sobre `qr_pagos_mp.estado`, botón cancelar desde la UI,
cron de barrido para expirar QRs abandonados. Gaps menores documentados en el código:
`empresas.direccion` es texto libre (MP Stores necesita campos estructurados, hoy usa
placeholders de Córdoba Capital para lat/long); pueden existir 1-2 tiendas MP huérfanas en la
cuenta real de Nalux de intentos fallidos antes de que se agregara la persistencia inmediata del
`store_id`.

**Probado en vivo (Nalux, pago real de $100):** QR generado y escaneado con la app real de MP ✓,
pago aprobado por MP ✓, venta confirmada manualmente con asiento balanceado y sin duplicar el
lado bancario ✓, webhook automático **falló** (pendiente de fix, ver arriba) ✗.

---

## ✅ Atajos de teclado en el Modo Caja (POS)

Siguiente ítem del roadmap del POS tras el análisis de mercado. Mapeo: **F2** cobra (Confirmar Venta), **F4** vuelve el foco al buscador de productos, **F8** enfoca el selector de cliente, **Alt+1..Alt+4** elige el medio de pago por posición (soporta pago mixto — activa/desactiva igual que un click). Se evitaron deliberadamente F1/F3/F5/F6/F10/F11/F12 por ser atajos reservados del navegador en Windows (ayuda, buscar en página, recargar, foco a la barra de direcciones, fullscreen, devtools) — F2/F4/F8 y Alt+dígito están libres en Chrome/Edge/Firefox.

**Arquitectura:** `src/hooks/useAtajosPOS.js` — un único listener `keydown` en `window`, montado una sola vez en `ModoCajaLayout`. En vez de que cada panel escuche sus propias teclas, `ModoCajaLayout` pasa un `ref` mutable (`posApiRef`) que `PanelProductos` y `PanelCarrito` van completando en sus propios `useEffect` con las funciones que sólo ellos pueden ejecutar (`focusBuscador`, `confirmar`, `focusCliente`, `seleccionarMedioPago`) — mismo patrón de "un solo punto de verdad" que ya usaba `Dashboard.jsx` para su propio `Escape` global. El guard `[role="dialog"][data-state="open"]` (ya existente en el refocus del buscador) se reusa tal cual para no interceptar teclas mientras hay un modal Radix abierto (por ejemplo, no permitir que F2 dispare `confirmar` de nuevo con el modal "Venta confirmada" abierto).

**Hints visuales:** badge "F2" en el botón Confirmar Venta, números 1-4 en la esquina de los primeros 4 botones de medio de pago, tooltips (`title`) "Atajo: F4"/"Atajo: F8" en buscador y selector de cliente.

**Limitación conocida (no es bug):** en viewport mobile (`<768px`), `ModoCajaLayout` usa tabs Productos/Carrito y oculta el panel no activo con `display:none` — F4 no puede enfocar un input oculto. Es una consecuencia esperada del layout responsive existente, no algo introducido por esta feature.

**Probado en vivo:** Alt+2 activó "Tarjeta Crédito" pasando a pago mixto junto con "Efectivo" ✓; F8 movió el foco al `<select>` de cliente ✓; F4 (en viewport desktop 1280×800) devolvió el foco al buscador ✓. Ningún atajo disparó comportamiento del navegador (recarga, buscar en página, etc.). `npx eslint` y `npx vite build`: 0 errores.

---

## ✅ Numeración de NC/ND separada por punto de venta — mig.296

Cierra el pendiente explícito dejado por mig.295 ("Alcance NO cubierto" más abajo). El motor `obtener_proximo_numero` (3-arg) ya soportaba `nota_credito`/`nota_debito_venta` en su CASE de recuento real — sólo el gate `v_es_scoped` los excluía (`p_tipo_documento IN ('venta', 'factura')`). El cambio real fue mínimo: ampliar ese gate a los 4 tipos + hacer que `crear_nota_credito`/`crear_nota_debito_cliente` reciban y usen `p_punto_venta_id`.

**Lección de Postgres (nueva, para no repetir el error):** intenté primero extender las RPCs con `CREATE OR REPLACE FUNCTION` agregando `p_punto_venta_id uuid DEFAULT NULL` al final de la lista de argumentos existente. **No funciona como yo esperaba** — Postgres identifica una función por su lista de tipos de argumentos; agregar un parámetro (aunque tenga DEFAULT) no reemplaza nada, crea un OVERLOAD nuevo y deja el viejo vivo en paralelo (verificado en sandbox: apareció un tercer overload de `crear_nota_credito`). La forma correcta de "extender en el lugar" es `DROP FUNCTION` (firma exacta) + `CREATE FUNCTION` (firma nueva) — mismo conteo total de overloads que antes. Se usó así: el overload huérfano de 8 args de `crear_nota_credito` (mig.264, deuda técnica ya documentada) sigue intacto y sin tocar; la versión de 9 args se reemplazó por una de 10 (agrega `p_punto_venta_id`); `crear_nota_debito_cliente` pasó de 8 a 9 args de la misma forma.

**Garantía de seguridad (misma que mig.295):** el PdV `es_default` sigue usando la fila legacy de siempre — sólo un PdV no-default provisiona una serie nueva.

**Frontend:** `NuevaNCModal`/`NuevaNDModal` ahora pasan `p_punto_venta_id` (ya lo resolvían para mostrar el aviso, sólo faltaba mandarlo al RPC). Como el RPC graba `punto_venta_id` en el `INSERT` de forma atómica, se sacó el `UPDATE comprobantes SET punto_venta_id=...` suelto que hacía el frontend después — una escritura menos, sin ventana entre "comprobante creado" y "PdV grabado".

**Probado en vivo contra producción (Nalux), vía curl con JWT real:**
- NC con PdV 1 (default) → `NC-20260801-001` (serie legacy, sin fila nueva) ✓
- NC con PdV 2 (no-default, interno) → `NC-2-20260801-001` (fila nueva provisionada, prefijo distinto, arranca en 1) ✓
- ND con PdV 2 (no-default) → `ND-2-20260801-001` ✓; ND con PdV 1 (default) → `ND-20260801-001` ✓
- Los 4 comprobantes de prueba quedaron con `punto_venta_id` correcto grabado por el RPC (confirmado por SELECT, sin necesitar el UPDATE separado)
- Todo revertido: 4 comprobantes + ítems + movimientos de CC borrados (0 fantasmas verificado), las 2 filas de serie nuevas (PdV 2) borradas, `proximo_numero` de las 2 filas legacy devuelto a 1
- `npx eslint` y `npx vite build`: 0 errores

---

## ✅ Criterio fiscal unificado: el punto de venta es el ÚNICO selector — mig.294/295

Pregunta de Luciano tras mig.293: "¿cómo unificamos el criterio entre ERP y POS?". Se investigó cómo lo resuelve SAP: **no hay dos selectores** (PdV + relevancia). Hay uno: la Serie/PdV, y de ahí se DERIVA si el documento es fiscal. Se aplicó ese modelo.

**mig.294 — `es_default` funcional:** existía la columna hace tiempo, se mostraba y editaba en Configuración, pero **nada la leía** (verificado: 0 PdV con `es_default=true` en las 3 empresas). Trigger que garantiza un único default por empresa (índice único parcial) + backfill al PdV fiscal que cada empresa ya usaba (cero cambio de comportamiento) + `useAfipConfig` ahora lo usa en la cadena de resolución.

**mig.295 — numeración separada por PdV** (alcance acotado a propósito: sólo `venta`/`factura`, ver más abajo). `series_numeracion` suma `punto_venta_id` nullable; `obtener_proximo_numero` gana un overload de 3 params (el de 2 sigue existiendo, ahora filtra explícitamente `punto_venta_id IS NULL` para no volverse ambiguo). **Garantía de seguridad de la migración**: el PdV `es_default` de la empresa sigue usando la fila legacy de siempre — sólo un PdV NO-default provisiona una fila nueva, con prefijo derivado (`"" → "2-"`, `"NC-" → "NC-2-"`).

**Cambio de UI — se sacó el checkbox "No relevante para AFIP" en 4 lugares** (`NuevaVentaModal`, `NuevaFacturaModal`, `NuevaNCModal`, `NuevaNDModal`), reemplazado por:
- **ERP (Factura/Venta):** selector de PdV real. Si el elegido tiene `envia_arca=false`, aviso "Comprobante interno: no se emite CAE ni se informa a ARCA".
- **NC/ND:** el PdV se **hereda** del comprobante origen (no se elige) — una NC que anula una factura fiscal tiene que ser fiscal. Sin origen (standalone), usa el PdV por defecto.
- **POS:** badge de sólo lectura en el topbar ("PdV 1"), configurable únicamente desde Configuración → Facturación (admin).

**Bugs reales encontrados y corregidos en el camino** (el mismo patrón, 4 veces):
1. `useAfipConfig` — `.limit(1)` sin ORDER BY ni filtro `envia_arca` (ya arreglado en mig.293).
2. `NuevaFacturaModal.jsx` — copia idéntica del mismo bug, no detectada en mig.293 por revisar sólo `useAfipConfig`.
3. `NuevaNCModal.jsx` — ídem, ahora además con herencia del PdV origen.
4. `NuevaNDModal.jsx` — ídem.

**Bug propio introducido y detectado por lint antes de llegar a producción:** al reemplazar el checkbox por el selector en los 4 modales, quedó una llamada huérfana `setNoRelevanteFiscal(false)` en el reset-al-cerrar de los 4 archivos — crasheaba el modal entero (error boundary de `VentasSection`) apenas se abría. `grep` inicial no lo encontró por mayúsculas; `npx eslint` (`no-undef`) lo detectó al toque. Corregido antes de cualquier commit — nunca llegó a producción.

**Alcance NO cubierto en esta migración — RESUELTO en mig.296 (ver sección de arriba):** `crear_nota_credito`/`crear_nota_debito_cliente` generaban el número dentro del RPC SQL, sin recibir el PdV.

**Probado en vivo contra producción (Nalux):**
- `NuevaFacturaModal`: selector de PdV, cambiar a "2 · Remito (interno)" muestra el aviso correcto ✓, sin crashear.
- POS: badge "PdV 1" visible en el topbar ✓.
- Numeración (vía curl con JWT real, ya que `execute_sql` no tiene contexto de `auth.uid()`): PdV default → `20260801-001` (serie legacy, sin crear fila) ✓; PdV no-default → `2-20260801-001` (fila nueva, prefijo distinto, arranca en 1) ✓; llamada de 2 args sin PdV → `20260801-002` (sigue la misma serie legacy) ✓. Todo revertido después: `proximo_numero` vuelto a 1, fila de prueba del PdV no-default eliminada — verificado en cero, 0 comprobantes fantasma.
- `npx eslint` sobre los 5 archivos tocados: 0 errores. Build limpio. 84 tests unitarios verdes.

---


## ✅ Punto de venta propio para el POS + opt-out de ARCA — mig.293

Pregunta de Luciano: *"¿el POS debería tener su propio punto de venta? ¿debería poder elegir si va por ARCA o no, pensando en un local chico que no factura?"*. Respuesta: sí a ambas — y continúa el pendiente que la **mig.244 dejó documentado explícitamente** (creó `puntos_venta.envia_arca` pero nunca lo cableó al circuito de facturación).

**Por qué el POS debe poder tener PdV propio:** AFIP exige un PdV por modalidad de emisión (si el mostrador suma controlador fiscal, va obligatoriamente en otro PdV); numeración independiente del back-office; y conciliación por canal.

**Dos necesidades distintas, no confundirlas:**
| Necesidad | Alcance | Mecanismo |
|---|---|---|
| Local que **no factura** electrónicamente | Permanente | PdV con `envia_arca=false` |
| Venta puntual no fiscal | Por comprobante | `comprobantes.relevante_fiscal=false` (ya existía, sólo el ERP lo expone) |

**DOS BUGS LATENTES QUE ESTO CERRÓ:**
1. `useAfipConfig` elegía el PdV con `.eq('activo',true).limit(1)` — **sin ORDER BY ni filtrar `envia_arca`**. No determinístico: Nalux tiene el PdV 1 (fiscal) y el 2 ("Remito", envia_arca=false), y nada garantizaba cuál se usaba para facturar.
2. `envia_arca=false` **no impedía** que el comprobante fuera a ARCA — el trigger `fn_queue_factura_arca` sólo mira `relevante_fiscal`. Ahora el frontend no marca `cae_estado='pendiente'` si el PdV resuelto no envía a ARCA, así que el trigger nunca se dispara.

**Fix:** `empresas.pos_punto_venta_id` (NULL = el mismo PdV que el resto). `useAfipConfig(contexto)` acepta `'pos' | 'erp'`, resuelve el PdV de forma determinística (PdV del POS si está configurado; si no, primer PdV activo **con envia_arca=true**, ordenado por número) y `afipActivo` ahora exige además que el PdV envíe a ARCA. Selector nuevo en Configuración → Facturación, con aviso explícito cuando el PdV elegido no factura.

**Probado en vivo end-to-end (Nalux)** — venta REAL de mostrador con pago mixto sobre un PdV interno de prueba:
- Selector guardó y avisó "Las ventas de mostrador no se enviarán a ARCA" ✓
- Venta $1.200 = $700 Efectivo + $500 Transferencia → **2 filas en `movimientos_caja`**, una por medio ✓ (esto cierra la verificación pendiente del pago mixto)
- `cae_estado='no_aplica'`, `punto_venta_id=NULL`, **0 filas en `facturas_pendientes_arca`** ✓ — nunca se encoló a ARCA
- Asiento balanceado $2.200=$2.200, con COGS incluido (mig.287): Debe 1.1.1 $1.200 + Debe 5.1 $1.000 / Haber 4.1 $991,74 + Haber 2.1.3 $208,26 + Haber 1.1.3 $1.000 ✓
- **Todo limpiado**: asiento, movimientos, comprobante, entrega, stock restaurado a 5851, sesión de caja, PdV de prueba, TC del día, rastros de auditoría, y el correlativo devuelto a 1 para no dejar salto de numeración — verificado en cero.

**Observación para más adelante (no es bug):** el asiento manda TODO el cobro a `1.1.1 Caja y Bancos`, aunque la venta se haya cobrado parte en efectivo y parte por transferencia. Como la cuenta es literalmente "Caja y Bancos" (combinada), es correcto hoy; si en algún momento se separan Caja y Banco en cuentas distintas, `crearAsientoVenta` va a necesitar partir el débito por medio de pago.

---


## ✅ Pago mixto en el POS — arquitectura compartida con el ERP

Segunda mejora de POS priorizada. **Hallazgo que simplificó el trabajo:** el pago mixto NO había que diseñarlo — ya existía completo en el camino ERP (`NuevaVentaModal` → `useMultipago`), y el backend también: `crear_venta` ya itera `jsonb_array_elements(p_pagos)` creando un `movimientos_caja` por pago. El único que armaba un solo pago era el POS.

**Decisión de arquitectura (pregunta explícita de Luciano — que venta mostrador y venta ERP sean compatibles):**
- **Se comparte la lógica, no la presentación.** `useMultipago` (ya testeado, 14 tests) es la capa común: maneja exclusividad de Cuenta Corriente, validación de que los montos sumen el total, formato argentino y resolución de `forma_pago_id`.
- La presentación queda separada a propósito: el ERP usa `PanelPago` (sidebar con moneda, centro de costo, AFIP, TC paralelo); el POS usa una grilla compacta y táctil. Reusar `PanelPago` en el POS habría arrastrado todo el contexto ERP a una pantalla de mostrador.
- Ambos caminos convergen en el mismo array `pagos` → misma RPC → mismo asiento. Por construcción no pueden divergir.

**Decisión de negocio (Luciano):** las ofertas condicionadas a un medio de pago (existe una activa, "Descuento transferencia") **sólo aplican cuando ese medio cubre el 100% de la venta**. En pago mixto el POS manda `p_medio_pago = null` al motor de ofertas. Sin esto, pagar $1 por transferencia desbloquearía el descuento sobre todo el carrito.

**Probado en vivo (Nalux):** carrito $1.200 → tocar Efectivo + Transferencia activa el modo mixto con input por medio ✓ → $700 muestra "Falta asignar $500,00" ✓ → +$500 muestra "✓ Pago completo" y habilita Confirmar ✓ → tocar Cuenta Corriente colapsa a CC sola, esconde los inputs y exige cliente ✓. Los 14 tests de `useMultipago` siguen verdes.

**Límite honesto de esta verificación:** NO se confirmó una venta mixta real en producción. Nalux tiene `usa_factura_electronica=true` y el POS —a diferencia del ERP— **no tiene el checkbox "No relevante para AFIP"**, así que una venta de prueba encolaría un CAE real e irreversible ante ARCA. Lo verificado es toda la construcción/validación de los pagos; el tramo `crear_venta` con múltiples pagos es código sin cambios que el ERP ya ejercita a diario en producción.

**Gap detectado — ya RESUELTO por mig.293/294/295 (ver secciones de abajo):** el POS no tenía el escape fiscal que sí tiene el ERP. Se cerró, pero no con un checkbox por venta — con `empresas.pos_punto_venta_id` (Configuración → Facturación → "Punto de venta del Modo Caja"): un admin puede asignarle al POS un PdV con `envia_arca=false` y ninguna venta de mostrador se encola a ARCA mientras dure. **Verificado 2026-08-03 (Nadia/Claude):** es una decisión de diseño a propósito, no un descuido — `ModoCajaLayout.jsx` muestra el PdV como badge **de solo lectura** (comentario explícito en el código: "SOLO LECTURA. Se configura únicamente desde Configuración → Facturación (admin)"). El cajero no puede optar por venta si esa venta va o no a ARCA — sólo un admin puede, a nivel de todo el mostrador. Correcto desde compliance: evita que un cajero decida unilateralmente saltear la factura fiscal de una venta puntual. Si en el futuro se necesita marcar UNA venta puntual del POS como no-fiscal (ej. muestra gratis, consumo interno) sin tocar la config global, ese sí sería un gap real — no implementado hoy, a propósito.

---


## ✅ Arqueo real al cerrar caja desde el POS — BUG DE DINERO CORREGIDO

Primera de las mejoras de POS priorizadas tras el análisis de mercado (ver sección siguiente).

**HALLAZGO (bug, no feature):** cerrar caja desde el POS (`ModoCajaLayout.jsx`) llamaba `closeSession(monto, '', 0, 0)` — con `esperado=0` y `diferencia=0` **hardcodeados**, y esos valores se **persisten** en `caja_sesiones`. Es decir: cualquier faltante o sobrante quedaba invisible, grabado como "diferencia $0". El arqueo real (que suma `movimientos_caja` por método) existía sólo en `CajaCierre.jsx`, usado desde el panel administrativo. Dos caminos de cierre, dos comportamientos distintos.

**Ya había afectado datos reales:** la sesión del **2026-07-28** (`87d0f6d2`) tiene `monto_inicial=$150.000` e `ingresos_efectivo=$30.000` → su esperado real era **$180.000**, pero quedó grabado `esperado=0, diferencia=0`. **Corregido por Luciano el 2026-08-01**: `monto_final_esperado` recalculado a `$180.000` desde `movimientos_caja`; `monto_final_real`/`diferencia` quedaron en `NULL` a propósito (el efectivo contado nunca se registró, así que no se asumió un valor) — documentado en `observaciones` de la fila.

**Fix:**
- Nuevo hook `src/hooks/useArqueoCaja.js` — **fuente única** del cálculo de arqueo, extraído de `CajaCierre.jsx`. Ambos caminos de cierre lo consumen, así no pueden volver a divergir.
- `CajaCierre.jsx` refactorizado para usarlo (comportamiento idéntico; el pre-llenado del saldo real ahora está guardado con un `useRef` para que un refetch no pise lo que el usuario tipeó).
- `ModoCajaLayout.jsx`: el modal de cierre ahora muestra el arqueo completo (inicial / ingresos / egresos / **esperado**), la **diferencia en vivo** con color (✓ Cuadra / ↑ Sobrante / ↓ Faltante), y campo de observaciones que se resalta cuando no cuadra. Pasa los valores reales a `closeSession`.
- Dos guardas contra reintroducir el bug: `staleTime: 0` en el hook (cada venta cambia el esperado — un arqueo cacheado grabaría una diferencia falsa), refetch al abrir el modal, y el botón "Cerrar caja" queda deshabilitado mientras el arqueo carga (si no, `esperado` sería 0 otra vez).
- Se agregó validación de monto inválido (antes `|| 0` convertía silenciosamente basura en 0).

**Probado en vivo contra producción (Nalux)** desde el POS real: caja abierta con $12.345 → el modal mostró "Esperado en caja $12.345" ✓ → conté $12.000 → mostró **-345,00 ↓ Faltante** en rojo ✓ → cerré con observación → verificado en DB: `esperado=12345.00, diferencia=-345.00` ✓ (antes ambos habrían sido 0). Sesión de prueba y su rastro de auditoría eliminados — verificado en cero, 29 sesiones cerradas como al inicio.

**Anomalía preexistente detectada — ya RESUELTA:** había una sesión de caja abierta desde el **2026-05-29** (`606de6ee`, empresa "KAIROX Gestión" — tenant interno, no un cliente real) con `monto_inicial=$2.030.036` y sin `cierre_fecha`, un turno que quedó abierto más de dos meses. **Cerrada administrativamente por Luciano el 2026-08-01**: `monto_final_esperado` recalculado a `$1.981.242,05` desde `movimientos_caja` ($2.030.036 inicial + $9.979,61 ingresos efectivo − $58.773,56 egresos efectivo); `monto_final_real`/`diferencia` en `NULL` (nadie contó el efectivo real, `cerrado_por` en `NULL` porque no lo cerró un cajero) — documentado en `observaciones` de la fila. Verificado 2026-08-03 (Nadia/Claude): no quedan sesiones abiertas en todo el sistema (30/30 en estado `cerrada`).

---


## ✅ Vigencia futura de precios — mig.292

Última de las 5 features priorizadas del trabajo de precios (después de mig.290/291). Permite programar un precio para que entre en vigencia en una fecha futura, sin tocar el precio actual hasta entonces — botón "Programar precio futuro" (icono calendario) por producto en `ListasPrecioSection.jsx`.

**Diseño:** 2 columnas nuevas en `lista_precio_items` (`precio_programado`, `fecha_vigencia_programada`) + un cron diario (`pg_cron`, mismo patrón que mig.207 CAEA — sin necesidad de Edge Function) que corre a las 03:05 ART y promueve `precio_programado → precio` cuando `fecha_vigencia_programada <= CURRENT_DATE`. RPCs `programar_precio_futuro` (valida fecha futura, no toca el precio actual) y `cancelar_precio_programado`.

**Probado en vivo contra producción (Nalux):** programé $1.200→$2.000 con vigencia 10/8/2026 sobre el producto de test — el precio mostrado siguió en $1.200, apareció el badge "Cambia a $2.000 el 10/8/2026" ✓. Probé "cancelar" → precio programado se limpió correctamente ✓. Verifiqué la lógica exacta del cron ejecutándola manualmente sobre el item de test con fecha=hoy → promovió correctamente a $2.000 y limpió los campos ✓. Item de test eliminado después — verificado en cero.

**Con esto, las 5 features priorizadas de ajuste de precios quedan completas: ajuste masivo con filtros, preview, redondeo, historial, y vigencia futura.**

---

## ✅ Historial de cambios de precio — mig.291

Fase 2 del trabajo de precios (después de mig.290). Se agregó un botón "Ver historial" por producto en el modal de precios de cada lista, que muestra quién cambió el precio, cuándo, y de cuánto a cuánto — leyendo directamente de `audit_log` (sin tabla nueva).

**Hallazgo durante la construcción, corregido en el momento:** se creyó que `lista_precio_items` no tenía trigger de auditoría (a diferencia de `productos`, cubierta desde mig.001) porque el grep inicial solo buscó el patrón `trg_audit_*`. Al aplicar un trigger nuevo (`trg_audit_lista_precio_items`) y probar en vivo aparecieron eventos duplicados en `audit_log` — investigando se confirmó que mig.021 (creación original de Listas de Precio) YA había creado un trigger equivalente con otro nombre (`audit_lista_precio_items`). Se dropeó el trigger duplicado inmediatamente, se corrigió mig.291 a un no-op documentado, y se limpiaron las filas de auditoría generadas por la prueba fallida. **Ninguna funcionalidad quedó rota en producción** — el error se detectó y corrigió en el mismo ciclo de prueba antes de dar por cerrado.

`listaPreciosService.getHistorialPrecio(listaId, productoId)` — filtra `audit_log` por `tabla='lista_precio_items'` y `producto_id` (usando `.or()` sobre `old_data`/`new_data` para no traer toda la tabla), cruza `user_id` con `profiles` para mostrar nombre.

**Probado en vivo contra producción (Nalux):** verificado en un producto real ("Mate", lista "Precio VIP") mostrando su único evento real ("Precio inicial: $1.500 — Nadia Tecera"), solo lectura, sin mutar nada.

---

## ✅ Ajuste masivo de precios en Listas de Precios — mig.290

Investigación previa (post-auditoría Inventario/COGS): `ListasPrecioSection` solo permitía editar precio producto por producto. En PyME argentina con inflación alta esto es inviable para catálogos reales. Se investigó qué ofrece el mercado (Tango, Dragonfish, Bejerman, Xubio) y se identificaron 5 features candidatas; se construyeron las 3 de mejor ROI en esta tanda: ajuste masivo filtrable, preview antes de aplicar, y redondeo configurable. Quedan pendientes para más adelante: historial de cambios de precio y vigencia futura (ver [[project_investigar_ajuste_masivo_listas_precio]]).

**Fix (mig.290):**
- RPC `ajustar_precios_masivo(lista_precio_id, tipo_ajuste, valor, categoria_id?, busqueda?, redondeo?, aplicar)` — un único cálculo usado tanto para preview (`p_aplicar=false`, no escribe nada) como para aplicar (`p_aplicar=true`, hace upsert real) para que preview y resultado nunca diverjan.
  - Precio base: el ya guardado en la lista si existe, si no `productos.precio_venta` (mismo criterio que la UI existente).
  - Ajuste: `porcentaje` o `monto_fijo`, filtrable por categoría y por texto de búsqueda.
  - Redondeo: `ninguno` / `decena` ($X0) / `centena` ($X00) / `terminar_99` ($X99).
- `listaPreciosService.ajustarPreciosMasivo` (nuevo método) y modal "Ajuste masivo" en `ListasPrecioSection.jsx`: form de tipo/valor/categoría/redondeo → botón "Previsualizar cambios" (tabla actual→nuevo, nada se graba) → botón "Aplicar a N productos" (recién ahí escribe).

**Probado en vivo end-to-end contra producción (Nalux)**, desde la UI real de Listas de Precios → lista "Mayorista" → filtro "TESTE" (producto de test preexistente) → +10% con redondeo $X99 → preview mostró $1.200→$1.399 ✓ → aplicar → toast "Precios actualizados ✓, 1 producto ajustado" → verificado en DB (`lista_precio_items.precio = 1399.00`) ✓. Ítem de test eliminado después — verificado en cero.

---

## ✅ Ajuste manual de stock genera asiento contable — mig.289

Tercer y último gap de la auditoría de Inventario/COGS: `ajustar_stock_manual` (mig.059, botón "Ajustar Stock" en Productos) cambiaba `stock_actual` y registraba en `movimientos_inventario`, pero nunca generaba asiento — mismo patrón de gap que Ventas (mig.287) pero para correcciones manuales (rotura, faltante, inventario físico). A diferencia de COGS, acá había ambigüedad de negocio real (¿una "entrada" es carga inicial o hallazgo?, ¿una "salida" es pérdida real o corrección de error?) — se le preguntó a Luciano y decidió: **siempre generar asiento**, sin distinguir motivo por ahora.

**Fix (mig.289):**
- `ajustar_stock_manual` cambia de `RETURNS void` a `RETURNS jsonb` (requirió `DROP FUNCTION` primero — Postgres no permite cambiar el tipo de retorno con `CREATE OR REPLACE`), devolviendo `{delta, costo_unitario}`.
- `crearAsientoAjusteStock` (nuevo método en `planCuentasService.ts`) — no bloqueante, mismo patrón que Ventas/NC:
  - Faltante (`delta < 0`): Debe `5.8 Otros Gastos` / Haber `1.1.3 Mercaderías-Inventario`.
  - Sobrante (`delta > 0`): Debe `1.1.3` / Haber `4.3 Otros Ingresos`.
- `ProductosSection.jsx` (`handleSubmitMovimiento`) llama al nuevo método tras `productosService.adjustStock`, con `.catch()` no bloqueante (toast solo si es período cerrado).

**Probado en vivo end-to-end contra producción (Nalux)**, desde la UI real de Inventario: "Ajustar Stock" → Salida (Venta/Pérdida) → 1 unidad de "Aramis TESTE Azul marino" (costo $1.000, producto de test preexistente) → stock bajó de 5851 a 5850 ✓ → asiento generado correcto y balanceado: **Debe 5.8 Otros Gastos $1.000 / Haber 1.1.3 Mercaderías-Inventario $1.000** ✓. Todo limpiado por completo después (asiento+ítems, movimiento de inventario, stock restaurado a 5851) — verificado en cero.

**Con esto, la auditoría de Inventario/COGS queda cerrada: los 3 gaps encontrados (COGS en venta, NC no revertía COGS, ajuste manual sin asiento) están resueltos y probados en vivo.**

---


## ✅ La Nota de Crédito revierte el Costo de Mercadería Vendida — mig.288

Continuación directa de mig.287: con el costo ya contabilizándose en cada venta, verificado que `crear_devolucion` restaura el stock físico correctamente al devolver mercadería, pero la NC que compensa esa devolución solo revertía Ventas + IVA contra CxC — nunca tocaba `5.1 Costo de Mercaderías` ni `1.1.3 Inventario`. Asimetría real: stock vuelve, venta se revierte, pero el costo original quedaba cargado para siempre.

**Fix (mig.288):**
- `crear_nota_credito` calcula el costo a revertir uniendo `devolucion_items.comprobante_item_id` con `comprobante_items.costo_unitario` (mig.287) — **solo si la devolución asociada tiene `reingresa_stock=true`** (una NC financiera sin devolución física no debe tocar Inventario). Se guarda en `comprobantes.costo_mercaderia_vendida` (mismo campo que usan las Ventas) y se devuelve en el jsonb.
- `crearAsientoNotaCliente` (JS) agrega 2 líneas si el monto es > 0 y existen las cuentas 1.1.3/5.1: `Debe 1.1.3 Mercaderías/Inventario / Haber 5.1 Costo de Mercaderías`.

**Hallazgo colateral, no relacionado, no corregido:** existe un overload huérfano de `crear_nota_credito` con 8 parámetros (sin `p_referencia_cliente`) que quedó vivo desde mig.264 — mig.265/266 nunca lo dropearon antes de agregar la versión de 9 parámetros. No afecta a la app real (`NuevaNCModal.jsx` siempre manda los 9), solo se manifestó al llamar la RPC directo por curl con exactamente 8 params (PostgREST no puede resolver el overload). Anotado como deuda técnica, no se tocó.

**Probado en vivo end-to-end contra producción (Nalux)**, cadena completa vía RPCs reales (mismo usuario autenticado, mismo `access_token` de sesión) — venta test $1.200 (costo $1.000) → devolución con `reingresa_stock=true` → NC generada desde la devolución:
- `crear_nota_credito` devolvió `costo_mercaderia_vendida: 1000.00` ✓ (calculado correctamente)
- Asiento verificado con la estructura completa (5 líneas, balanceado $2.200=$2.200): Debe Ventas $991,74 + Debe IVA Débito $208,26 / Haber CxC $1.200, **Debe Inventario $1.000 / Haber Costo de Mercaderías $1.000** ✓
- Todo limpiado por completo (asiento, NC, devolución, venta original, movimientos, stock restaurado) — verificado en cero.

**Con esto, el circuito Venta→COGS→Devolución→NC queda completo y simétrico.**

---


## ✅ Costo de Mercadería Vendida (COGS) en el asiento de venta — mig.287

Arrancando la auditoría de Inventario/COGS, se encontró el hallazgo más grande de toda la ronda de auditorías: `crear_venta` decrementa `productos.stock_actual` correctamente al vender, pero el asiento contable de la venta **nunca generó la línea de Costo de Mercadería Vendida**. Verificado en producción antes de tocar nada: Ventas acumuladas $7.633.841, Costo de Mercaderías real $0, y `1.1.3 Mercaderías/Inventario` con $8.285.520 de Debe (compras) y **$0 de Haber histórico** — el activo de Inventario nunca se consumía contablemente aunque el stock físico sí bajara. Consecuencia real: el margen/Resultado del Ejercicio que mostraba el sistema estaba sobreestimado en el 100% del costo de lo vendido.

**Fix (mig.287), snapshot del costo al momento de vender (no el costo actual, que puede cambiar después por compras posteriores):**
- `comprobante_items.costo_unitario` (nueva columna) — `crear_venta` la captura desde `productos.costo_compra` en el mismo `SELECT ... FOR UPDATE` que ya usaba para chequear stock, en el momento exacto de la venta.
- `comprobantes.costo_mercaderia_vendida` (nueva columna) — acumula el total, mismo patrón que `neto_gravado`/`iva_discriminado` (mig.280).
- `crearAsientoVenta` (`planCuentasService.ts`) agrega 2 líneas nuevas si el monto es > 0 y existen las cuentas 5.1/1.1.3: `Debe 5.1 Costo de Mercaderías / Haber 1.1.3 Mercaderías-Inventario`. No bloqueante — si falta alguna cuenta, el resto del asiento se genera igual.
- `regenerar_asiento_venta` (mig.281) también extendido para incluir estas líneas al regenerar.
- **Gap conocido, no corregido acá:** si el producto viene de una entrega manual previa (`p_pedido_id` con entrega ya hecha), el stock ya se movió en ESE evento anterior y su costo no se captura en esta llamada — haría falta capturarlo en el momento de la entrega, no de la factura (caso raro, documentado en el código).

**Probado en vivo end-to-end contra producción (Nalux)**, desde el POS real (no solo el RPC): venta de 1 unidad de "Aramis TESTE Azul marino" (producto de test preexistente, costo $1.000) por $1.200 en efectivo →
- `comprobantes.costo_mercaderia_vendida = $1.000` ✓
- Asiento generado con 5 líneas, balanceado ($2.200 = $2.200): Debe Caja $1.200 / Haber Ventas $991,74 + IVA Débito $208,26 (=$1.200) / **Debe Costo de Mercaderías $1.000 / Haber Mercaderías-Inventario $1.000** ✓
- Todo limpiado por completo después (asiento+ítems, comprobante+ítems, entrega+ítems, movimiento de caja, movimiento de inventario) y stock restaurado a su valor original — verificado.

---


## ✅ Liquidación de tarjetas en POS (crear_venta) — mig.286

Último pendiente que dejó Luciano ("Para Nadia, mañana"): `crear_venta` (POS) quedó fuera del alcance de mig.216, que solo cubrió `registrar_cobro_cliente` (Cuenta Corriente). Una venta de POS pagada con tarjeta acreditaba el bruto directo a `1.1.1 Caja y Bancos` el mismo día, sin pasar por la cuenta puente `1.1.8 Tarjetas a Acreditar` — la plata en realidad tarda 8-10 días hábiles y entra por el neto (Comunicación BCRA A 7153).

**Fix (mig.286), mismo patrón exacto que mig.216, en dos capas:**
- **`crear_venta` (RPC)**: en el loop de pagos (una venta de POS puede tener VARIOS pagos — split efectivo+tarjeta), por cada pago resuelve `dias_acreditacion`/`comision_porcentaje` de su `forma_pago_id` y completa las columnas de liquidación de `movimientos_caja` (`estado_liquidacion`, `monto_comision`, `monto_neto`, `fecha_acreditacion_estimada`) igual que ya hacía `registrar_cobro_cliente`. Devuelve `monto_pendiente_liquidacion` en el jsonb de retorno.
- **`crearAsientoVenta` (`planCuentasService.ts`)**: si recibe `montoPendienteLiquidacion > 0` y existe la cuenta `1.1.8`, parte la línea de "cobro" en dos — la porción inmediata sigue a `1.1.1`/`1.1.2` como siempre, la porción pendiente va a `1.1.8`. Si no hay monto pendiente o no existe `1.1.8`, cae exactamente al comportamiento de siempre (no rompe nada para quien no usa esto).

**Hallazgo de arquitectura durante el testing:** el POS real (pantalla "Punto de Venta" / Modo Caja, `ModoCajaLayout.jsx` → `PanelCarrito.jsx`) usa el hook `useConfirmarVenta.js` para confirmar la venta — **no** la función `handleConfirmSale` de `NuevaVentaModal.jsx`, que tiene su propia llamada a `crear_venta` en paralelo (posiblemente un flujo de "Nueva Venta" desde otro punto de entrada, o código legacy — no se investigó cuál). Se aplicó el fix en **los dos lugares** por consistencia, pero el que de verdad se probó en vivo es `useConfirmarVenta.js`, que es el que efectivamente ejecuta el Punto de Venta.

**Probado en vivo end-to-end contra producción (Nalux)** — se activó temporalmente `dias_acreditacion=10`/`comision_porcentaje=3` en la forma de pago real "Tarjeta Crédito" (estaba en 0, nunca se había configurado en ninguna empresa) para poder ejercitar el circuito, y se revirtió a 0 al terminar:
1. Venta POS $50.000 con "Tarjeta Crédito" → asiento generado: **Debe 1.1.8 Tarjetas a Acreditar $50.000** (antes iba a 1.1.1) / Haber Ventas $41.322,31 + IVA Débito $8.677,69 ✓
2. `movimientos_caja`: `estado_liquidacion='pendiente'`, comisión $1.500 (3%), neto $48.500, fecha estimada 10/08 (hoy+10) ✓
3. Apareció automáticamente en **Bancos → Tarjetas pendientes** (sin ningún cambio de UI necesario — la vista ya filtraba por `estado_liquidacion='pendiente'` de forma genérica): "Bruto pendiente $50.000" / "Neto a acreditar $48.500" ✓
4. Botón "Marcar acreditada" → `acreditar_movimiento_caja` (ya existente, mig.216) generó el asiento de liquidación y el movimiento bancario por el neto — el saldo de "Mercado Pago personal" subió exactamente $48.500 ✓
5. Todo limpiado por completo (asientos, movimiento bancario, movimientos_caja, comprobante, stock revertido) y la forma de pago devuelta a `dias_acreditacion=0` — verificado con conteo en cero.

**Con esto, los 3 pendientes que dejó Luciano quedan cerrados**: repaso cruzado de Cheques/Cierre de Ejercicio/Traslado (ver abajo) y liquidación de tarjetas en POS.

---

## ✅ Repaso cruzado de la sesión de Luciano (Cheques, Cierre de Ejercicio, Traslado)

Pedido explícito de Luciano: como Cheques/Cierre de Ejercicio/Traslado a Acumulados se hicieron sin una segunda revisión cruzada, se revisó código + datos reales antes de seguir con la liquidación de tarjetas POS.

**Cierre de Ejercicio (mig.283) y Traslado a Acumulados (mig.284): sin hallazgos.** Revisados línea por línea (balanceo, guards de permisos/idempotencia, caso borde resultado_neto=0) y el cableado de `TabPeriodos.jsx`. Todo consistente.

**Cheques (mig.282): encontrado y cerrado un blindspot real (mig.285).** mig.282 solo cubre asientos que TIRAN EXCEPCIÓN (cuenta faltante, etc.) — pero los estados `'depositado'` y `'descontado'` (ambos válidos en `TRANSICIONES_TERCERO`, `shared.jsx`) no tenían NINGUNA rama en `fn_asiento_cheque_tercero` ni en `regenerar_asiento_cheque`. No fallaban: directamente no existían — así que no quedaban ni logueados en `cheques_asiento_errores`. Verificado en producción antes de tocar nada: 1 cheque real de $80.000 en `depositado` con 0 asientos y 0 errores; y un caso histórico real de $500.500 que pasó por `descontado` sin generar ningún asiento en su momento.

**Fix (mig.285), decisión por estado (no son iguales):**
- `'depositado'` → sigue sin generar asiento, **a propósito**: el cheque sigue siendo el mismo activo, solo cambió de ubicación física. El circuito ya cierra bien al llegar a `'cobrado'`. Se corrigió solo el mensaje de `regenerar_asiento_cheque` para explicar esto en vez de sonar a bug.
- `'descontado'` → **sí es un hecho económico real** (el banco adelanta la plata antes del vencimiento) que no se contabilizaba. Se agregó la rama: Debe 1.1.1 Caja / Haber 1.1.6 Cartera, con guard para no duplicar el asiento si después pasa a `'cobrado'` (mismo criterio que ya existía para `'endosado'`). También se agregó la rama de rechazo viniendo de `'descontado'` (contrapartida Caja, no Cartera, porque la plata ya había entrado).
- **Limitación conocida y documentada**: se contabiliza por el monto BRUTO — `cheques` no tiene campo para el neto/tasa de descuento, así que el gasto financiero de la quita del banco no se registra (no es una regresión, tampoco se registraba antes). Backlog separado si se necesita.

**Probado en vivo contra producción (Nalux)**, cheque de tercero sintético $1.000:
- `en_cartera → descontado`: generó el asiento nuevo correcto (Debe Caja $1.000 / Haber Cartera $1.000) — antes no generaba nada.
- `descontado → cobrado`: confirmado que **no** generó un segundo asiento (el guard funcionó) — quedó en 2 asientos totales (recepción + descontado), no 3.
- Cheque de prueba, asientos e historial limpiados por completo, verificado con conteo en cero.

**Dato adicional del repaso, no arreglado (fuera de alcance, mismo criterio que las 7 facturas sin asiento que ya había dejado Luciano):** 6 cheques de junio (incluido el de $500.500) sin ningún asiento — anteriores a que los triggers estuvieran completos. No se corrigen retroactivamente sin pedido explícito.

---

## ✅ Nota histórica — pendientes que dejó Luciano, ambos CERRADOS

Cerrando la auditoría de Bancos (sesión 2026-07-31, Luciano), se revisó Conciliación bancaria (OK, sin gaps) y quedaron 2 pendientes para el día siguiente: liquidación de tarjetas en POS, y repasar/probar en vivo Cheques/Cierre de Ejercicio/Traslado.

1. ~~Extender `crear_venta` para la liquidación de tarjetas~~ — **HECHO** (mig.286, ver sección de arriba al tope del archivo). Probado en vivo end-to-end contra producción.
2. ~~Repasar y probar en vivo lo de Cheques/Cierre de Ejercicio/Traslado~~ — **HECHO** (ver sección de abajo): Cierre de Ejercicio y Traslado sin hallazgos; Cheques encontró y cerró un blindspot real (mig.285, 'depositado'/'descontado'), probado en vivo.

Detalle completo de memoria: `project_pendiente_liquidacion_tarjetas_pos.md`, `project_cheques_asiento_fallido_mig282.md`, `project_pendiente_cierre_ejercicio_sap.md`.

---


## ✅ Traslado a Resultados Acumulados — segundo paso del cierre SAP (mig.284)

Completa lo que mig.283 dejó explícitamente fuera de alcance: pasar el saldo de `3.3 Resultado del Ejercicio` a `3.2 Resultados Acumulados` una vez cerrado el ejercicio, dejando 3.3 en cero para el próximo.

**Fix (mig.284):**
- `periodos_contables.resultado_neto` (nueva columna) — `cerrar_ejercicio_contable` ahora guarda el neto calculado ahí, en vez de que el traslado tenga que releer el saldo actual de 3.3 (que podría mezclar el resultado de varios ejercicios cerrados y no trasladados aún). Cada traslado mueve exactamente lo que le corresponde a SU período.
- `periodos_contables.asiento_traslado_id` (nueva columna) — vínculo 1:1, no se puede trasladar dos veces.
- RPC `trasladar_resultado_acumulados(p_periodo_id, p_user_id)` — requiere `asiento_cierre_id` ya generado, admin, no trasladado antes, resultado neto ≠ 0. Un asiento de 2 líneas: lleva 3.3 a cero, acredita o debita 3.2 por el mismo monto.
- Botón "Trasladar a Acumulados" en `TabPeriodos.jsx`, visible solo cuando `asiento_cierre_id` existe, `asiento_traslado_id` no, y `resultado_neto != 0`. Badge "Trasladado" una vez hecho.

**Probado en vivo contra producción (Nalux), con datos sintéticos y aislados** (mismo criterio: rango 2020-01, sin actividad real): asiento test Venta $5.000 → período cerrado por fecha → "Cerrar Ejercicio" (resultado neto $5.000 a 3.3) → "Trasladar a Acumulados" → asiento generado correcto: Debe 3.3 $5.000 (a cero) / Haber 3.2 $5.000. Botón desaparece tras usarlo, badge "Trasladado" queda. Todo limpiado por completo después — verificado `count(*)=0`.

**Con esto, el circuito de Cierre de Ejercicio estilo SAP queda completo: cierre de fechas → asiento de cierre (Ingreso/Egreso → 3.3) → traslado (3.3 → 3.2).**

---


## ✅ Cierre de Ejercicio contable — estilo SAP (mig.283)

Siguiendo la navegación de Bancos/Conciliación/Cheques, Luciano preguntó puntualmente si existía el cierre mensual/anual con pase de Resultados a Patrimonio, apoyándose en el modelo SAP. Respuesta: el cierre de período (`TabPeriodos.jsx`, mig.027) solo bloqueaba fechas — el "Resultado del Ejercicio" del Balance General era (y para períodos sin cierre de ejercicio sigue siendo) un cálculo en pantalla, nunca un asiento real.

**Fix (mig.283):**
- `periodos_contables.asiento_cierre_id` (nueva columna) — vínculo 1:1 al asiento de cierre, si existe.
- RPC `cerrar_ejercicio_contable(p_periodo_id, p_user_id)` — requiere período YA cerrado (fechas bloqueadas) + rol admin + que no tenga ya un asiento de cierre. Por cada cuenta `tipo IN ('ingreso','egreso')` con movimientos confirmados en el rango, inserta la línea que la deja en cero (Debe si tenía saldo acreedor, Haber si tenía saldo deudor), con una única contrapartida contra `3.3 Resultado del Ejercicio` por el neto. Si no hay movimientos de resultado en el rango, no genera nada (evita asientos vacíos).
- Botón "Cerrar Ejercicio" en `TabPeriodos.jsx`, visible solo si `estado='cerrado' && !asiento_cierre_id`. Una vez generado, muestra badge "Ejercicio cerrado" y el botón "Reabrir" queda bloqueado (toast explicando que hay que anular el asiento desde Plan de Cuentas primero) — evita reabrir fechas que ya tienen resultado contabilizado.
- **Fuera de alcance, documentado:** el paso de `3.3 Resultado del Ejercicio` a `3.2 Resultados Acumulados` en el cambio de ejercicio (segundo paso del cierre SAP) no se automatizó — quedaría como asiento manual si se necesita.

**Probado en vivo contra producción (Nalux), con datos 100% sintéticos y aislados** (rango 2020-01, sin actividad real): 2 asientos de prueba (Venta $10.000 / Costo $4.000) → período test cerrado por fecha → botón "Cerrar Ejercicio" → asiento generado correcto: Debe Ventas $10.000 (a cero) + Haber Costo $4.000 (a cero) + Haber 3.3 $6.000 (resultado neto = 10.000−4.000, balanceado 10.000=10.000). Confirmado también que "Reabrir" queda bloqueado tras el cierre de ejercicio. Todo limpiado por completo después (asiento+ítems, los 2 asientos de prueba, el período test) — verificado con `count(*)=0`.

---


## 🟡→✅ Cheques: asiento contable fallido quedaba en silencio total (mig.282)

Después de cerrar Ventas/Compras, arrancamos la siguiente auditoría por Bancos/Cheques, navegando la UI en vivo antes de tocar código. Sorpresa: el módulo de Cheques está mucho más maduro de lo que decía la memoria de sesiones anteriores — 10 migraciones (028→211) ya resolvían los 3 gaps que se creían pendientes (asiento por cada transición de estado, vínculo a `movimientos_bancarios` al cobrar, reversión de deuda al rechazar, idempotencia y hardening multi-tenant ya aplicados en la sesión 72).

**El único gap real encontrado:** `fn_asiento_cheque_tercero`/`fn_asiento_cheque_propio` envuelven TODO el bloque contable en `EXCEPTION WHEN OTHERS THEN NULL` — si falta una cuenta del plan (1.1.6, 1.1.7, 2.1.6, etc.) o cualquier otro error inesperado, el cheque cambia de estado igual pero el asiento nunca se genera y no queda ningún rastro visible (a diferencia del patrón toast+"Regenerar asiento" que ya usan Ventas/Compras, mig.281).

**Fix (mig.282):**
- Tabla `cheques_asiento_errores` (cheque_id, estado, error_mensaje, resuelto) — los triggers ahora loguean ahí en vez de tragarse el error en silencio. Sigue siendo no bloqueante: el cambio de estado del cheque nunca falla por esto.
- RPC `regenerar_asiento_cheque(p_cheque_id, p_user_id)` — reconstruye el asiento del estado ACTUAL del cheque con la misma lógica que los triggers (recibido/endosado/cobrado/rechazado para terceros; entregado/cobrado/rechazado para propios), incluido el movimiento en `movimientos_bancarios` si corresponde. Solo actúa si hay un error pendiente logueado para ese cheque+estado (evita duplicar un asiento que sí se generó bien).
- Botón "Regenerar asiento" (ícono ámbar de alerta) en `AccionesCheque` (`shared.jsx`), visible solo si el cheque tiene un error pendiente en `cheques_asiento_errores` — mismo patrón visual que Ventas/Compras.
- **Gotcha de sesión, no de KAIROX:** después de aplicar la migración vía `apply_migration`, PostgREST tardó en refrescar su caché de schema (`PGRST205 — tabla no encontrada`) hasta correr `NOTIFY pgrst, 'reload schema'` manualmente + agregar el `GRANT SELECT` explícito a `authenticated` sobre la tabla nueva (la política RLS sola no alcanza, PostgREST exige el grant de tabla además). Confirmado resuelto vía curl directo al REST endpoint (pasó de `PGRST205` a `permission denied for function get_my_empresa_id`, que es el error esperado sin sesión autenticada). Si una migración futura crea una tabla nueva, recordar: RLS policy + GRANT + NOTIFY reload — los 3, no alcanza con 1 o 2.
- Verificado en vivo: la pantalla de Cheques renderiza sin regresiones tras el fix, `cheques_asiento_errores` existe con 0 filas (esperado, no hay errores reales hoy).

**Pendiente real, no tocado:** dominio propio en Resend (Nadia) y cuota de facturación de Supabase vencida (Luciano, dashboard). Bancos/Conciliación y Cheques Propios (UI) aún no se navegaron a fondo — próximo paso de esta auditoría si se retoma.

---


## ✅ Ventas — cerrado con la misma rigurosidad que Compras

Retomando lo pedido: "aplicar la revisión de Compras a Ventas y terminar el módulo". Después de los 2 fixes de la auditoría (NC/ND sin asiento, asiento no atómico en Venta/Compra), probé en vivo lo que más directamente los tocaba en Ventas:

- **Factura de Venta → Cancelar Factura** (RPC `cancelar_factura` + `crearAsientoReversaVenta`): creé una factura real ($2.000, IVA 10.5%), verifiqué que `asiento_id` se guardó solo, la cancelé, y confirmé que el asiento de reversa invierte las 3 líneas correctamente — **incluida la nueva línea de IVA Débito Fiscal** (Haber Caja $2.000 → Debe Caja $2.000 revertido; Debe Ventas $1.652,89 → Haber $1.652,89; Debe IVA Débito $347,11 → Haber $347,11). `crearAsientoReversaVenta` es genérico (invierte "lo que haya" en el asiento original), así que no necesitó ningún cambio de código para soportar el asiento de 3 líneas — quedó validado, no solo asumido.
- Dato de la sesión, no de la app: durante esta prueba los clicks sintéticos del navegador de testing no disparaban el `onClick` de `AlertDialogAction` (cerraba el diálogo pero nunca llegaba el request a Supabase) — se resolvió invocando el handler de React directamente. Anotado para la próxima sesión que use este mismo navegador de pruebas, no es un bug de KAIROX.

**Con esto, tanto Compras como Ventas quedan al mismo nivel: auditados con el agente contable, con IVA Débito/Crédito Fiscal discriminado en todos los asientos, NC/ND generando su asiento, y con forma de regenerar/revertir manualmente cuando algo falla.**

**Pendiente real, no tocado (fuera de esta auditoría):** dominio propio verificado en Resend (Nadia) y cuota de facturación de Supabase vencida (Luciano, dashboard).

---

## 🟡→✅ Ventas/Compras: asiento no atómico, sin forma de regenerarlo (mig.281)

Segundo hallazgo de la auditoría contable: a diferencia de Cuenta Corriente (mig.181/183, `cuenta_corriente_movimientos.asiento_id` + botón "Regenerar"), una Venta o Compra que confirmó su documento pero cuyo asiento falló (el asiento se dispara en una llamada aparte, no atómica con `crear_venta`/`registrar_factura_compra_oc` — si el segundo request nunca llega, queda contabilizada en CC pero sin nada en el Mayor) no tenía columna de vínculo ni forma de repararse manualmente.

**Fix (mig.281):**
- `comprobantes.asiento_id`/`compras.asiento_id` (nuevas columnas) — `crearAsientoVenta`/`crearAsientoCompra` (`planCuentasService.ts`) ahora las completan automáticamente después de confirmar el asiento normal.
- RPCs `regenerar_asiento_venta`/`regenerar_asiento_compra` — mismo patrón que `regenerar_asiento_cxc/cxp` (mig.181): guard de tenant/permiso/ya-tiene-asiento/período cerrado, reconstruye el asiento de 3 líneas con `neto_gravado`/`iva_discriminado` ya guardados en el documento.
- Botón "Regenerar asiento" (solo visible si `!asiento_id`) en `SaleDetailModal.jsx` y `CompraDetailModal.jsx`, mismo estilo/patrón que el de `CuentaCorrienteSection.jsx`/`ProveedoresSection.jsx`.

**Probado en vivo contra producción (Nalux), simulando la falla real** (crear la venta/compra normal → confirmar que `asiento_id` quedó solo → borrar el asiento y poner `asiento_id=NULL` a mano, simulando que la segunda llamada nunca llegó → abrir el detalle → click en "Regenerar asiento"):
- Venta POS ($30.000, Mate): asiento regenerado con las 3 líneas correctas (Cobro/Ventas neto/IVA Débito), botón desaparece después. ✓
- Compra Rápida ($5.000, Mouse Vertical): asiento regenerado con las 3 líneas correctas (Mercaderías neto/IVA Crédito/Pago). ✓
- Ambas limpiadas por completo.

**Con esto, los 2 hallazgos de la auditoría contable completa quedan cerrados.** Pendiente real, no tocado (fuera de alcance, no es de esta auditoría): dominio propio en Resend (Nadia) y cuota de facturación de Supabase vencida (Luciano).

---

## 🔴→✅ Crítico: NC/ND (cliente y proveedor) no generaban asiento contable

La auditoría contable completa de esta noche (agente `sap-motor-contable-auditor`) encontró que `crear_nota_credito`, `crear_nota_debito_cliente`, `crear_nota_credito_proveedor` y `crear_nota_debito_proveedor` (mig.265/275/276/277) tocan `comprobantes`/Cuenta Corriente pero **nunca insertan en `asientos_contables`** — ninguno de los 4 modales (`NuevaNCModal`, `NuevaNDModal`, `NuevaNCProveedorModal`, `NuevaNotaDebitoModal`) llamaba a `asientosAutoService`. Consecuencia real: el Estado de Resultados/Balance de Comprobación quedaba desincronizado de la Cuenta Corriente para cualquier empresa que usara NC/ND — sin ningún error visible.

**Fix:** dos métodos nuevos en `planCuentasService.ts` (mismo patrón no-bloqueante que `crearAsientoVenta`/`crearAsientoCompra`, con guard de período cerrado):
- `crearAsientoNotaCliente({tipo, comprobanteId, total, neto, iva, ...})` — NC: Debe Ventas (neto) + Debe IVA Débito Fiscal (iva) / Haber Cuentas a Cobrar (total). ND: inverso exacto. Siempre contra 1.1.2 (nunca Caja — el RPC solo toca `cuenta_corriente_movimientos`).
- `crearAsientoNotaProveedor({tipo, documentoId, total, neto, iva, ...})` — NC: Debe Cuentas a Pagar (total) / Haber Mercaderías (neto) + Haber IVA Crédito Fiscal (iva). ND: inverso exacto. Siempre contra 2.1.1 (el reembolso en efectivo de una NC es un movimiento de Caja aparte, no se tocó ese circuito — fuera de alcance de este fix).
- Los 4 modales ahora llaman al método correspondiente en el `.then` de éxito de su RPC, usando `subtotalNeto`/`totalIva` que ya calculaban localmente para mostrar en pantalla.

**Probado en vivo contra producción (Nalux):**
- NC de cliente sobre FAC-20260728-003 ($1.000 total): `neto_gravado=826.45`, `iva_discriminado=173.55` → asiento Debe Ventas $826,45 + Debe IVA Débito $173,55 / Haber CxC $1.000 ✓.
- NC de proveedor sobre factura de Amazon (ítem $1.210 bruto, 21%): `neto=1.000`, `iva=210` → asiento Debe CxP $1.210 / Haber Mercaderías $1.000 + Haber IVA Crédito $210 ✓.
- Las ramas ND (cliente y proveedor) no se testearon en vivo — mismo método, mismas cuentas, solo invierten debe/haber respecto a lo ya verificado. Riesgo bajo por simetría de código, pero queda anotado por si alguien quiere el test explícito.
- Ambas pruebas limpiadas por completo (asiento+ítems, comprobante/NC, movimientos de CC, imputaciones).

**Hallazgo secundario de la misma auditoría — ya RESUELTO (mig.281):** en Ventas/Compras el asiento se dispara en una llamada separada después de que el documento ya se confirmó (no atómico) y no había forma de regenerar manualmente uno que falló. **Verificado 2026-08-03 (Nadia/Claude):** existen en producción `regenerar_asiento_venta(p_comprobante_id, p_user_id)` y `regenerar_asiento_compra(p_compra_id, p_user_id)`, en paridad con `regenerar_asiento_cxc/cxp` y `regenerar_asiento_cheque`.

---

## ✅ Compras: recalcular neto/IVA al editar una compra existente

Pendiente técnico anotado ayer ("editar una compra existente no recalcula neto_gravado/iva_discriminado"). Confirmado en `CompraRapidaSection.jsx`:
- `handleSaveEdit` actualizaba `compras.total` pero nunca `neto_gravado`/`iva_discriminado` — quedaban en `NULL` para siempre tras la primera edición, aunque el total cambiara.
- Los ítems NUEVOS agregados durante una edición tampoco guardaban `alicuota_iva` en `detalle_compras` — quedaba sin setear.

**Fix:**
- `handleEditClick` ahora trae `alicuota_iva` de cada ítem existente.
- `addProductToEdit` toma `alicuota_iva` del producto (mismo dato que ya usa Compra Rápida al crear).
- El insert de ítems nuevos en `handleSaveEdit` ahora incluye `alicuota_iva`.
- Al guardar, se recalculan `neto_gravado`/`iva_discriminado` sobre el estado final de `editItems` con el mismo criterio bruto/factor que la creación (`FACTOR_IVA`), y se guardan junto al `total` en el mismo `UPDATE`.

**Probado en vivo contra producción** (compra real de Burbujitas, $10.000 → se agregó un ítem de $15.000 al 21%): `neto_gravado=20661.16`, `iva_discriminado=4338.84` — coincide exacto con el cálculo esperado ($25.000/1.21). Prueba revertida por completo por SQL (se removió el ítem, se restauró stock, total, neto/iva y hasta la hora original de `fecha` — ver hallazgo aparte abajo).

**Hallazgo colateral, no arreglado (fuera de alcance):** el modal de edición trunca la hora de `compras.fecha` a medianoche en CUALQUIER edición (`editForm.fecha = compra.fecha.split('T')[0]` descarta la hora, y el `UPDATE` la reescribe así). No es bloqueante — solo se ve en el orden fino de compras del mismo día — pero es un gap de precisión de datos real. Quedó registrado como tarea separada (chip de sesión) para no mezclarlo con este fix.

---

## ✅ NC/ND: AFIP exige CbteAsoc — encontrado y arreglado con prueba real en producción

Retomando el pendiente "Testear NC/ND con CbteTipo correcto en producción" (dejado el 2026-07-29): se creó una NC real contra Nalux desde la UI (Facturas → "..." → "Copiar a NC", $100 sobre la Factura C 0001-00000034) para verificar el fix de la tarea #36.

**Confirmó lo bueno:** el `cbte_tipo` ya se manda como NC (13), no como Factura — se sabe porque AFIP devolvió un error específico de NC/ND, que solo aparece si WSFE ya reconoce el comprobante como Nota de Crédito.

**Encontró un bug nuevo, más grave:** `[10197] Si el comprobante es Debito o Credito, enviar estructura CbteAsoc o PeriodoAsoc`. AFIP exige que toda NC/ND declare el comprobante que le dio origen (tipo, punto de venta y número de la factura asociada) — `arca-worker` no lo enviaba. **Con el código de ayer, ninguna NC/ND real podía obtener CAE** (quedaban todas en `error_datos`, sin reintentar).

**Fix (desplegado como `arca-worker` v19):**
- `_shared/wsfe.ts` — `CaeRequest` acepta `cbteAsoc?: {tipo, ptoVta, nro}`; `feCAESolicitar` arma el nodo `<CbtesAsoc><CbteAsoc>...` en la posición correcta del schema (después de `CondicionIVAReceptorId`, antes de `Iva` — mismo orden que usa `pyafipws`, la librería de referencia probada contra WSFEv1 real).
- `_shared/afip.ts` — `ArcaEmitParams`/`callArcaEmit` pasan `cbteAsoc` a `feCAESolicitar`.
- `arca-worker/index.ts` — para NC/ND, busca el `comprobante_origen_id`, lee su `numero_afip` (formato `PPPP-NNNNNNNN`) y arma `cbteAsoc = { tipo: voucherTypeAfip(origen), ptoVta, nro }`. Si no hay origen o el origen nunca tuvo `numero_afip`, lanza error con mensaje que contiene "Dato inválido" — cae en `classifyArcaError` → `'data'` → no reintenta (nunca va a poder emitirse sin origen válido).
- Se corrigió también la nota de la sección "Arquitectura de deploy": `arca-worker` en realidad **no** depende de `_shared/integraciones.ts` (nada en su cadena de imports lo usa) — dato heredado incorrecto de una sesión anterior.

**Probado en vivo:** la NC de prueba (NC-20260730-001, comprobante `4300c5bb-9f37-4bfc-b979-4f110f5efce7`) obtuvo CAE `86310698722818` tras el fix. `puntos_venta_numeracion` quedó con dos filas independientes — PV1/cbte_tipo=11 (Factura) en 34, PV1/cbte_tipo=13 (NC) en 1 — confirmando que las series no se pisan entre sí. Con esto la tarea #36 queda cerrada y verificada end-to-end, no solo revisada por código.

---

## ✅ IVA Débito/Crédito Fiscal discriminado en asientos (Ventas + Compras)

Último pedido de la noche: los asientos automáticos de venta/compra mandaban el total entero a una sola cuenta (Ventas o Mercaderías), sin separar el IVA en su propia cuenta — mismo problema en los dos módulos, no era nuevo de hoy.

**Fix (sin migración nueva de tablas — las cuentas `1.1.4 IVA Crédito Fiscal` y `2.1.3 IVA Débito Fiscal` YA estaban en el seed del plan de cuentas desde mig.004, nunca se usaban):**
- `planCuentasService.ts` — `crearAsientoVenta`/`crearAsientoCompra` ahora aceptan `neto`/`iva` opcionales. Si vienen y existe la cuenta de IVA correspondiente, arman un asiento de 3 líneas (Ventas: Debe Cobro total / Haber Ventas neto / Haber IVA Débito Fiscal; Compras: Debe Mercaderías neto / Debe IVA Crédito Fiscal / Haber Pago total). Si no vienen o falta la cuenta, cae al asiento viejo de 2 líneas — nunca bloquea la operación.
- **Migración 280**: `crear_venta` ya calculaba neto/IVA internamente pero nunca los devolvía en el `RETURN` — se agregaron `neto_gravado`/`iva_discriminado` al jsonb de retorno (cero cambios de lógica/side-effects, solo el RETURN).
- Los 6 puntos donde se llama a `crearAsientoVenta`/`crearAsientoCompra` (`NuevaFacturaModal`, `NuevaVentaModal`, `useConfirmarVenta`, `NuevaFacturaProveedorModal`, `CompraRapidaSection`, `OrdenesCompraSection`) ahora pasan `neto`/`iva` desde el valor que ya tenían disponible (local o del resultado de la RPC).
- **Probado en vivo, 3 veces, contra producción**: Factura de Venta manual (10.5% IVA) → asiento Debe Caja $1.000 / Haber Ventas $904,98 / Haber IVA Débito $95,02 ✓. Venta por POS (`crear_venta`) → mismo patrón, $30.000 total → $24.793,39 neto + $5.206,61 IVA ✓. Compra Rápida → Debe Mercaderías $4.132,23 + Debe IVA Crédito $867,77 = Haber Pago $5.000 ✓. Los tres balanceados, los tres limpiados después.

## ✅ Auditoría de Ventas (pedida por Luciano tras cerrar Compras)

Mismo enfoque que en Compras: revisé Cotización→Pedido→Entrega→Factura→NC/ND→Cancelación buscando el mismo tipo de gap (documento huérfano desconectado de CC/asiento/IVA). **Resultado: no hay nada roto.** `NuevaFacturaModal.jsx` ya hacía todo bien (CxC Open Item, Caja para no-CC, IVA real por ítem, asiento, AFIP), "Facturar Pedido" reutiliza el mismo `NuevaVentaModal` maduro (no hay tabla huérfana tipo `facturas_proveedor`), y `cancelar_nota_credito` ya tenía los mismos guards que hoy repliqué en Compras. Verificación de integridad en producción: 0 movimientos de Cuenta Corriente sin comprobante. Encontré 7 facturas sin asiento pero todas de junio/principios de julio — anteriores a que el control existiera, no es un bug activo, no se tocó (no se editan asientos retroactivos sin pedido explícito).

---

## ✅ Compras — CERRADO esta noche (todo aplicado, pusheado y probado en vivo)

Todo lo de la sección de abajo ("Trabajo de esta tarde") ya fue:
1. Revisado (self-review: se encontró y arregló un guard de tenant faltante en `caja_sesion_id`, commit `4ed8b7b`).
2. Aplicado a producción — migraciones 275, 276 y 277 aplicadas sin errores.
3. Pusheado a `origin/master` (commits hasta `fad73fc`).
4. `mp-sync` redesplegado (v14), verificado byte a byte.
5. **Probado en vivo, end-to-end, con datos reales creados y eliminados prolijamente:**
   - ND de Cliente: descripción de ítem ahora se guarda (fix mig.275) ✅
   - NC de Proveedor: numeración, neto/IVA, vínculo a Cuenta Corriente ✅
   - ND de Proveedor: ídem, numeración de la serie vieja (`notas_debito`, formato ND-YYYY-NNNN) ✅
   - **Reembolso en efectivo de NC Proveedor** (el camino que más dudas generaba): `reembolso_efectivo=true` + `caja_movimiento_id` poblado + guard de tenant de la caja, todo funcionando ✅
6. **Hallazgo y fix adicional (commit `fad73fc`):** el Mapa de Relaciones **ya existía** para Compras (no hacía falta construirlo) — pero la NC de Proveedor nueva (mig.277) rompía el vínculo: antes de mig.277, `cuenta_corriente_proveedores.referencia_id` apuntaba directo a la compra; ahora apunta al id de la NC (que ya tiene su propio `compra_id`). El Mapa buscaba por el patrón viejo y nunca encontraba la NC nueva. Se cambió el fetch para consultar `notas_credito_proveedor` directo por `compra_id` — verificado en vivo, la NC y la ND ahora aparecen correctamente en el árbol de documentos de su compra origen.
7. **Cancelación con reversa para NC/ND de Proveedor** (commit `eeee63f`, mig.278) — último pendiente, cerrado. Mismo patrón que `cancelar_nota_credito` (mig.267): documento de reversa, nunca se borra el original. Columna `estado` nueva en ambas tablas. Guard real: no se puede cancelar una NC ya cobrada en efectivo (el dinero ya cambió de manos). Botón "Cancelar" + confirmación en `DevolucionesProveedorSection.jsx`. **Probado en vivo end-to-end** (creación + cancelación + verificación del movimiento de reversa), datos de prueba limpiados.

**Migración 274 aplicada** (drop columnas deprecated `puntos_venta.ultimo_numero_a/b/c`) — era el pendiente que Nadia dejó a propósito para "dentro de ~1 semana" tras el deploy de `arca-worker` (mig.273). Se adelantó porque Luciano pidió explícitamente hacerlo ("hace lo que dejo Nadia pendiente"). Verificado antes de aplicar: `puntos_venta_numeracion` ya tenía filas vivas con `updated_at` de hoy (el worker ya escribe ahí en producción) y `grep` en `src/`+`supabase/functions/` no encontró ninguna lectura/escritura de las columnas viejas fuera de comentarios. DROP físico (no anulación lógica) porque son contadores técnicos internos, no un documento contable — el histórico real queda en `comprobantes.numero_afip`. Sin pendientes nuevos en advisors tras el DROP.

- `mp-sync` (el botón manual) ya redesplegado hoy — sin pendientes ahí.

## ✅ Fix contable: OC → Recepción → Factura (mig.279)

Stress-test de esta noche encontró que el flujo **OC → Recepción → Factura** ("3-way match", pantalla Órdenes de Compra) escribía en `facturas_proveedor` (mig.012) — una tabla que NUNCA se conectó al resto de la contabilidad: la deuda no aparecía en Cuenta Corriente Proveedores, `ReporteLibroIVACompras.jsx` no la veía, y "Marcar pagada" solo cambiaba un estado sin mover Caja/Bancos. Verificado antes de tocar nada: `facturas_proveedor` tenía 0 filas en producción — nadie lo usó, no había datos reales en riesgo.

**Fix aplicado (mig.279, acotado a propósito — no se tocó Compra Rápida ni Facturas de Compra manuales, quedan anotados abajo como backlog):**
- `compras.orden_compra_id` (nueva columna, único parcial) para vincular la factura a su OC.
- RPC atómica `registrar_factura_compra_oc`: crea `compras`+`detalle_compras` (ítems con IVA real por alícuota, no un monto suelto) + inserta la deuda en `cuenta_corriente_proveedores` (Open Item, patrón SAP — la Factura crea la deuda, el pago es un evento aparte vía `registrar_pago_proveedor`, que ya existe y ya mueve Caja/asiento). A propósito NO toca stock/costo — el stock físico ya se movió en la Recepción (Regla 8 SAP), volver a tocarlo duplicaría cantidades.
- `ModalRegistrarFactura.jsx` reescrito: ítems prellenados con lo recibido, alícuota IVA editable por ítem (default 21%), muestra Neto/IVA/Total.
- `ModalDetalleOC.jsx`: sacado el botón "Marcar pagada" (ya no aplica — Open Item se paga desde Proveedores → Cuenta Corriente), agregado el aviso correspondiente.
- **Autorevisión encontró un segundo gap en mi propio fix**: la RPC quedó atómica (compras+CC) pero el cliente no disparaba `asientosAutoService.crearAsientoCompra` — la Factura de OC creaba deuda real pero sin asiento contable. Corregido en el mismo commit: `OrdenesCompraSection.jsx` ahora llama al asiento (Debe 1.1.3 Mercaderías / Haber 2.1.1 Cuentas a Pagar, `esCredito:true` siempre porque esta Factura SIEMPRE es Open Item) en el `onSuccess` de la mutación, mismo patrón no-bloqueante que Compra Rápida.
- **Probado en vivo end-to-end DOS VECES** contra producción (Nalux, proveedor Mercado Libre, producto Mouse Vertical):
  - OC-00013 (2 u. × $5.000): factura FC-TEST-0001 → verifiqué `compras` (total $12.100, neto $10.000, IVA $2.100) + `detalle_compras` + `cuenta_corriente_proveedores` (tipo='compra', +$12.100, referencia_tipo='compra_oc').
  - OC-00014 (1 u. × $5.000, después de agregar el asiento): factura FC-TEST-0002 → verifiqué además `asientos_contables`+`asientos_items`: Debe $6.050 a "Mercaderías / Inventario" (1.1.3), Haber $6.050 a "Cuentas a Pagar" (2.1.1) — partida doble balanceada, `origen='compra'` y `origen_id` apuntando a la compra correcta.
  - Confirmé también que el botón "Registrar Factura" desaparece solo si la OC ya tiene una (guard de duplicado, reforzado también en la RPC).
  - Ambas pruebas limpiadas por completo (OC, ítems, recepción, compra, detalle, CC, asiento+ítems, stock revertido) y verificadas con conteo en cero.

## ✅ Cierre de los 3 hallazgos de backlog (mismo hilo, Luciano pidió terminarlos antes de Ventas)

1. **`NuevaFacturaProveedorModal.jsx` ahora genera asiento contable** — agregada la llamada a `asientosAutoService.crearAsientoCompra` (mismo patrón no-bloqueante que Compra Rápida y que la Factura de OC), con `esCredito` según la forma de pago elegida (CC Proveedor → Debe Inventario/Haber Cuentas a Pagar; Efectivo/Transferencia → Haber Caja). Banner corregido: decía "no modifica el inventario" pero el código SÍ suma stock (`aplicar_compra_producto`) — texto engañoso, reemplazado por una advertencia real sobre no duplicar stock si la mercadería ya entró por una OC.
   - **Probado en vivo**: factura FC-TEST-0003, ítem servicio (sin producto) $1.000 neto + IVA 10.5% = $1.105, forma de pago CC Proveedor → verifiqué `compras` (neto/IVA correctos), `cuenta_corriente_proveedores` (+$1.105) y el asiento (Debe 1.1.3 Mercaderías $1.105 / Haber 2.1.1 Cuentas a Pagar $1.105). Limpiado.
2. **Compra Rápida ahora discrimina IVA real por ítem** en vez de asumir 21% fijo — usa `productos.alicuota_iva` (ya existía en la tabla, no se usaba acá) con el mismo criterio bruto/factor que ND/NC de Proveedor. `compras.neto_gravado`/`iva_discriminado` y `detalle_compras.alicuota_iva` ahora se completan de verdad (antes quedaban NULL, y `ReporteLibroIVACompras.jsx` caía siempre en su fallback de 21%).
   - **Probado en vivo**: 1×Mouse Vertical a $5.000 (precio final, IVA incluido, alícuota 21% del producto) → `neto_gravado=4132.23`, `iva_discriminado=867.77` (4132.23×1.21=5000 ✓). Asiento y todo lo demás sin cambios (ya funcionaba). Limpiado.
   - **Nota histórica, ya CERRADA** (ver sección de arriba, tope del archivo): el flujo de EDICIÓN de una compra existente no recalculaba `neto_gravado`/`iva_discriminado` al agregar/quitar ítems — arreglado el 2026-07-30.
3. **`comprasService.ts` (código muerto, nadie lo llama todavía)**: `create()` insertaba `user_id: empresaId` — confundía usuario con empresa. Cambiada la firma para recibir `userId` explícito. Sin impacto real porque no hay callers, pero ya no queda ahí como trampa para quien lo conecte en el futuro.

**Con esto, el módulo Compras queda 100% al día — nada pendiente conocido.** Próximo paso pedido por Luciano: volver a Ventas.

---

## Trabajo de esta tarde (histórico — ya cerrado, ver arriba)

Se hizo un análisis + build completo (commits `b347398`, `45c3101`, `4ed8b7b`)
espejando en Compras las mejoras que Ventas ya tenía.

**Hallazgo que motivó esto (no solo simetría):** `ReporteLibroIVACompras.jsx`
solo leía `compras` — nunca veía una NC/ND de proveedor, así que el crédito
fiscal de IVA reportado nunca se ajustaba por esos documentos.

- **Migración 275** (fix, no build nuevo): `crear_nota_debito_cliente`
  (armada hoy mismo) nunca guardaba `descripcion` del ítem — comparado
  contra `crear_nota_credito` que sí lo hace. Verificado en la base: cero ND
  reales creadas todavía, sin historial afectado.
- **Migración 276**: `notas_debito_items` + `notas_debito.neto_gravado`/
  `iva_discriminado` + RPC nueva `crear_nota_debito_proveedor` (no se tocó
  la `crear_nota_debito` vieja, su rama 'emitida' ya está en desuso).
- **Migración 277**: `notas_credito_proveedor` + items — tabla de documento
  que ANTES NO EXISTÍA (la NC de proveedor era un insert suelto a
  `cuenta_corriente_proveedores`, sin numeración propia). RPC
  `crear_nota_credito_proveedor` con reembolso en efectivo atómico. Incluye
  un self-fix: la primera versión no validaba que `caja_sesion_id`
  perteneciera a la empresa (guard-tenant faltante, encontrado en
  autorevisión antes de que alguien más lo viera).
- `NuevaNotaDebitoModal.jsx` (shared/, proveedor) y `NuevaNCProveedorModal.jsx`
  reescritos con tabla de ítems + IVA, mismo patrón que sus pares de Ventas.
- Nuevo tab "Notas de Crédito Recibidas" en `DevolucionesProveedorSection.jsx`.
- `ReporteLibroIVACompras.jsx` ahora suma ND recibida (+) y resta NC de
  proveedor (-) al crédito fiscal, con columna Tipo.

**Ninguna de las 2 RPC nuevas toca `comprobantes` ni AFIP** — es el
proveedor quien declara estos documentos, no nosotros (mismo criterio que
ya regía para `devoluciones` tipo='proveedor').

El Mapa de Relaciones para Compras SÍ existía ya (no había que
construirlo) — solo necesitó un fix puntual, ver arriba. La cancelación
con reversa (mig.278) también se cerró la misma noche, ver punto 7 arriba.

**⚠️ Impacto operativo a revisar antes/al aplicar mig.277:** hay un usuario
`staff` en Nalux (no admin) sin el permiso granular `compras` otorgado
(`permissions->>'compras'` es NULL). Hoy puede crear NC de Proveedor porque
el flujo viejo (`NuevaNCProveedorModal.jsx`) hacía un INSERT directo sin
ningún chequeo de permiso granular. La RPC nueva `crear_nota_credito_proveedor`
sí exige `has_module_permission('compras')` — mismo gate que ya tiene
`crear_nota_debito` (precedente real, no invención) — así que ese usuario
va a quedar bloqueado para NC de Proveedor hasta que se le otorgue el
permiso `compras` desde Configuración → Usuarios. Es la decisión correcta
de seguridad (consistente con ND), pero Luciano debería saberlo antes de
que alguien reporte "no me deja hacer una NC".

Build y lint verificados limpios (0 errores). Probado en vivo esa misma
noche — ver sección de arriba.

---

## Estado actual de producción

Todo desplegado, aplicado y pusheado al cierre de la sesión del 2026-07-29.

| Servicio | Versión | Estado |
|---|---|---|
| `arca-worker` | v19 | ✅ ACTIVO (CbteAsoc para NC/ND) |
| `mp-sync-worker` | v1 | ✅ ACTIVO |
| `informar-caea` | v8 | ✅ ACTIVO |
| `mp-sync` | v14 | ✅ ACTIVO (redesplegado, verificado byte a byte) |
| Migración 271 | aplicada | ✅ |
| Migración 272 | aplicada | ✅ |
| Migración 273 | aplicada | ✅ |
| Migraciones 275/276/277 | aplicadas | ✅ |

---

## Qué se hizo en esta sesión

### Tarea #34 — Migración 271 (CAEA por CbteTipo)
Aplicada. Corrige `usar_caea_para_comprobante` RPC:
- Antes: mapeaba `v_tipo_cbte` solo por letra → siempre devolvía código de Factura
- Ahora: mapea por `(letra, clase)` → devuelve código correcto para Factura/NC/ND
- Quitó además el filtro `tipo_cbte` incorrecto del lookup de `caea_registros` (un CAEA es por CUIT+quincena, no por tipo)

### Fix colateral — Letra NC/ND hardcodeada a 'B'
`NuevaNCModal.jsx` y `NuevaNDModal.jsx` hardcodeaban `letraAfip = 'B'` para
NC/ND sin comprobante origen. Ahora derivan la letra con `determinarTipoComprobante()`
igual que ventas. Pusheado al repo.

### Fix colateral — `esClaseC` en `arca-worker`
`esFacturaC = voucherType === 11` dejaba afuera NC-C (13) y ND-C (12).
Corregido a `esClaseC = [11, 12, 13].includes(params.voucherType)` en `_shared/afip.ts`.
Incluido en el deploy v18.

### Tarea #35 — informar-caea: agrupamiento por (tipo_cbte, punto_venta)
`informar-caea` agrupaba todos los comprobantes usando `registro.tipo_cbte`
(el tipo del CAEA, siempre Factura), ignorando el tipo real de cada fila.
Ahora agrupa por `c.tipo_cbte` de cada comprobante en `caea_comprobantes`.
Desplegado como v8.

### Tarea #36 — puntos_venta_numeracion indexada por CbteTipo
**Problema:** `puntos_venta.ultimo_numero_a/b/c` indexa el contador por LETRA,
pero AFIP indexa sus series por `(PtoVta, CbteTipo)`. Factura/NC/ND son series
independientes — una sola columna por letra no puede seguirlas a las tres.
Con el fix de `voucherTypeAfip`, NC y ND empezaron a usar su propio CbteTipo,
pero ambas escribían en la misma columna de letra → falso positivo de "estado
ambiguo" que bloqueaba facturas válidas.

**Solución (Opción A):**
- Migración 273: nueva tabla `puntos_venta_numeracion(empresa_id, punto_venta_id, cbte_tipo, ultimo_numero)` con PK `(punto_venta_id, cbte_tipo)`. RLS: SELECT por tenant, sin políticas de escritura (solo `service_role`). Seed de ventas históricas (NC/ND históricas NO se siembran porque su CbteTipo declarado en AFIP era incorrecto).
- `arca-worker` v18: lee `puntos_venta_numeracion` en vez de `puntos_venta.ultimo_numero_[letra]`. Sin fila = primera emisión de esa serie → salta el chequeo de ambigüedad y auto-siembra en éxito. Upsert por `(punto_venta_id, cbte_tipo)` en cada emisión exitosa.
- Columnas viejas `ultimo_numero_a/b/c` quedan en `puntos_venta` marcadas `DEPRECATED` (no se dropean en 273 para permitir rollback fácil).

### Recuperación MP sync (incidente 15 días)
**Causa:** commit `7bccea5` (2026-07-14) agregó `verifyAdmin()` a `mp-sync`.
El cron usa la anon key → 401 en el 100% de corridas desde esa fecha.

**Solución:** separar en dos puntos de entrada (mismo patrón que `arca-worker`):
- `_shared/mpSync.ts` (nuevo): lógica de sync compartida
- `mp-sync`: mantiene `verifyAdmin` + filtro por `empresa_id` — es el botón del frontend
- `mp-sync-worker` (nuevo, `verify_jwt=false`): sin auth, todas las empresas activas — es lo que llama el cron
- Migración 272: re-registra `mp-sync-every-2-min` apuntando a `mp-sync-worker`

**Verificación post-deploy:** 71 movimientos en DB, backlog 14-29/07 recuperado completo (< 100 pagos en el período). Cron corriendo con 200 + `synced:0` (sin pagos nuevos desde el 28/07, es correcto).

---

## Pendientes técnicos

### CbteAsoc en informar-caea (circuito CAEA, sin urgencia)
El fix de CbteAsoc se aplicó al circuito CAE normal (`arca-worker`/`feCAESolicitar`).
El circuito CAEA (`informar-caea`/`feCAEAInformarComprobante`, contingencia por caída
de ARCA) probablemente tenga el mismo requisito de AFIP para NC/ND informadas por
CAEA, pero no se tocó — hoy nadie usa CAEA en producción (ver nota histórica de
la tarea #35), así que no hay forma de probarlo en vivo todavía. Si se activa CAEA
para una empresa que emite NC/ND, revisar si `FECAEAInformarComprobante` también
rechaza con `[10197]` y replicar el mismo `CbtesAsoc` ahí.

### 4 NC históricas mal declaradas ante ARCA
NC-20260706-003, NC-20260707-001, NC-20260707-002, NC-20260728-002 fueron
declaradas ante ARCA como Factura (código 6) en vez de NC (código 8) por el bug
de `voucherTypeAfip` anterior al fix. Ya autorizadas, no se pueden corregir por
código — tema para el contador de Nalux.

### Recupero de contraseña — resuelto con parche (Gmail SMTP), dominio propio pendiente
**Causa raíz encontrada (2026-07-30):** `Authentication → Emails → SMTP Settings` en Supabase tenía Resend configurado con el remitente sandbox `onboarding@resend.dev`. Confirmado en logs de Auth (`get_logs` service=auth): Resend rechazaba con `550 "You can only send testing emails to your own email address (naluxind@gmail.com). To send emails to other recipients, please verify a domain..."` — o sea, ese SMTP solo podía entregar a la propia cuenta de Resend, nunca a un cliente real. Por eso "nunca llegaba" sin ningún error visible en la app.

**Parche aplicado (por Nadia, vía Dashboard, sin tocar código):** se reemplazó el SMTP custom de Resend por **Gmail SMTP** (`smtp.gmail.com:587`, con una cuenta de Gmail dedicada + contraseña de aplicación). Verificado en logs: las solicitudes de recupero después del cambio devuelven `status:200, error:null` — el envío ya funciona.

**Limitación conocida, no arreglada:** el primer email a cada destinatario nuevo puede caer en Spam (Gmail es más estricto con remitentes personales usados para envíos automatizados, al no tener SPF/DKIM/DMARC propios como sí tendría un dominio verificado). Mitigación por ahora: pedirle a cada usuario que la primera vez marque el email como "No es spam" — a partir de ahí llega bien a esa combinación remitente/destinatario.

**Pendiente real, deferido a pedido de Nadia:** comprar un dominio propio (ej. `nalux.com.ar` vía nic.ar) y verificarlo en Resend (`resend.com/domains`) para tener entrega confiable desde el primer email, sin depender de que cada usuario "entrene" su filtro de spam. No es urgente — Gmail SMTP ya resuelve el bloqueo total que había antes.

**Nota aparte, no relacionada:** el dashboard de Supabase mostraba un banner "Organization exceeded its quota in the previous billing cycle — Projects will be restricted from 17 Aug 2026" — revisar `Billing` antes de esa fecha para no perder acceso al proyecto.

### MELI Factura A
Deferido hasta que se trabaje ARCA/AFIP específicamente para eso.
No construir sin pedido explícito.

---

## Arquitectura de deploy de Edge Functions

El deploy vía MCP (`deploy_edge_function`) reemplaza TODOS los archivos de la función.
Si la función importa archivos de `_shared/`, hay que incluirlos explícitamente en el
payload con `name: "../_shared/archivo.ts"`.

Funciones que usan `_shared/`:
- `arca-worker`: necesita `auth.ts`, `afip.ts`, `wsaa.ts`, `wsfe.ts` (NO `integraciones.ts` — nada en su cadena de imports lo usa, pese a lo que decía una versión anterior de esta nota)
- `informar-caea`: necesita `auth.ts`, `wsaa.ts`, `wsfe.ts`
- `mp-sync-worker`: necesita `auth.ts`, `mpSync.ts`
- `mp-sync`: necesita `auth.ts`, `mpSync.ts`

`config.toml` NO se aplica al desplegar vía MCP — hay que pasar `verify_jwt` explícitamente.

Workers sin auth (cron):
- `arca-worker`: `verify_jwt=false`
- `mp-sync-worker`: `verify_jwt=false`

Funciones de usuario (JWT requerido):
- `mp-sync`: `verify_jwt=true` (default) + `verifyAdmin()` interno
- `informar-caea`: `verify_jwt=true` (default) + `verifyAdmin()` interno

---

## CbteTipo AFIP — tabla de referencia

| Clase | Letra A | Letra B | Letra C |
|---|---|---|---|
| Factura (venta) | 1 | 6 | 11 |
| Nota de Débito | 2 | 7 | 12 |
| Nota de Crédito | 3 | 8 | 13 |

`esClaseC = [11, 12, 13].includes(voucherType)` — no discrimina IVA, `ImpNeto = ImpTotal`, `ImpIVA = 0`.

---

## Proyecto remoto Supabase
- **Project ID:** `wuznppxeonmhfcvnqfbf`
- **Empresa piloto:** Nalux (`condicion_iva = 'Exento'`, emite letra C)
