# Plan — Robustecer el motor de Facturación Electrónica AFIP/ARCA

## Estado — 10/08

**Fase 1: ✅ construida, aplicada a producción y verificada contra los 7 comprobantes reales.**
Migración 315 (`fn_persistir_cae_emitido` + hardening de permisos) + `arca-worker`
redesplegado (v21) con `feCompConsultar`/`consultarComprobante` y la reconciliación.
Resultado real, reencolando los 7 Facturas C atascadas del 06/08 y corriendo el worker
manualmente:

- **20260810-002** ($30.000) → reconciliado al **N°35 real** (CAE `86300689144388`) — el
  fantasma genuino, resuelto sin consumir número nuevo ni intervención humana.
- **20260806-006, 20260810-005, 20260810-001, 20260810-006** → una vez que el contador se
  puso al día, se emitieron con números reales nuevos (36, 37, 38, 39).
- **20260806-001 ($3.000), 20260806-008 ($25.000) y 20260806-011 ($121.000)** → apareció un
  tercer comprobante atascado con el mismo patrón (`-008`, no estaba en el barrido original).
  Los 3 repiten `[10016] El numero o fecha del comprobante no se corresponde con el proximo a
  autorizar` de forma consistente, incluso reintentando solos con minutos de por medio y con el
  contador local ya al día — no es una carrera entre ítems del mismo lote.
  **Hipótesis probada y descartada:** que un único número específico quedara "quemado" del lado
  de ARCA sin autorizar nunca — se implementó un fallback que ante `[10016]` reintentaba
  inmediatamente con `ultimo+2`, se desplegó (v24) y se probó en vivo contra 06-001: `ultimo+2`
  fue rechazado igual que `ultimo+1`. Descartada y revertida (v25) — no vale la pena saltar
  números a ciegas sin evidencia de que ayude.
  **Fix real aplicado:** `classifyArcaError` reclasificó `[10016]` de `'data'` a `'ambiguous'`
  — antes caía directo a `error_datos` (sin loop, pero requería reencolado manual cada vez);
  ahora reintenta solo con backoff exponencial como cualquier error transitorio. Verificado en
  vivo (v25, ACTIVA en producción): los 3 comprobantes están en `estado='reintentando'`,
  `intentos` subiendo automáticamente (2 y 4 al momento de escribir esto) sin intervención
  humana. Si ARCA no resuelve el desincronismo solo, el sistema agota los 5 reintentos y cae en
  `error_definitivo` con `motivo_definitivo='reintentos_agotados'` — una parada segura y clara,
  no un loop infinito ni un placebo. Dado que el sistema está en fase de prueba (homologación),
  esto queda como estado de reposo aceptable sin urgencia.

**Fase 2: ✅ construida y aplicada a producción.** Migración 316 — `fn_queue_factura_arca`
ahora despierta a `arca-worker` con un `net.http_post` fire-and-forget apenas encola algo
nuevo (mismo patrón ya probado del cron de la mig.102), y `max_intentos` default sincronizado
a 5. No se probó en vivo con una venta real (para no mutar datos reales de más) — el mecanismo
es idéntico al que ya corre cada 5 min en producción desde hace meses.

**Fase 3: ✅ construida, aplicada a producción y verificada.** Migración 317
(`error_mensaje_usuario`/`error_afip_usuario`/`motivo_definitivo` + `marcar_cae_resuelto_manual`
con CAE opcional) + `arca-worker` v22 (`mensajeHumano()` en `_shared/afip.ts`) +
`MonitorFacturacionAFIP.jsx`/`SaleDetailModal.jsx` (mensaje humano con toggle "Ver detalle
técnico"). Probado en vivo reencolando uno de los 2 comprobantes atascados: el mensaje humano
("El número de comprobante quedó momentáneamente desincronizado con ARCA...") se generó y se
mostró correctamente en el Monitor, con el toggle funcionando en ambas direcciones. `npx eslint`
0 errores, `npx vite build` limpio, 153/153 tests.

**Las 3 fases del plan quedan completas y en producción.**


**Pedido de Luciano (10/08):** reforzar el motor de emisión ya existente en 3 ejes concretos —
que reintente solo lo máximo posible, que no demore demasiado en resolver casos transitorios, y
que los mensajes de error sean muy claros y explícitos. Disparado por un caso real: 7 Facturas C
atascadas desde el 06/08 en "estado ambiguo", esperando que alguien entre al portal de ARCA a
mano a verificar el comprobante N°35.

**Metodología:** barrido del motor actual + auditoría de código dedicada
(`sap-motor-contable-auditor`) + consulta al enfoque SAP (`sap-b1-consultor`) + investigación de
mercado (patrones de idempotencia/reconciliación en integraciones fiscales). Los tres hallazgos
convergen en la misma causa raíz.

---

## Lo que ya tenemos (y está bien resuelto — no tocar)

El motor actual (`supabase/functions/arca-worker/index.ts` + `_shared/afip.ts`) ya es más sólido
que la mayoría de las integraciones AFIP artesanales del mercado:

- **Lock de ejecución única** (`arca_worker_run`) — evita que dos corridas de cron pidan el mismo
  número a la vez.
- **Backoff exponencial** `[1,5,15,30,60]` min, máx 5 intentos, con clasificación de errores
  `transient`/`data`/`ambiguous` — separación de responsabilidades correcta.
- **Contingencia CAEA automática** tras agotar reintentos por caída de ARCA.
- **Numeración por (punto de venta, tipo)**, no por letra — ya corrigió el bug histórico de series
  cruzadas.
- **Monitor de Facturación AFIP** con KPIs, reintento manual/masivo, "Usar CAEA", "Marcar
  resuelta" — inspirado correctamente en el eDocument Cockpit de SAP.

El problema no es la arquitectura general. Es una rama específica del flujo — el chequeo de
ambigüedad — que corta camino antes de tiempo.

---

## La causa raíz (confirmada 3 veces, misma conclusión)

**Enfoque SAP:** el eDocument Cockpit nunca abandona un documento en estado ambiguo sin antes
correr un ciclo de reconciliación (`Check Status`) contra el servicio del organismo. Recién si esa
reconciliación falla, pasa a revisión manual — como último recurso, no como primer paso.

**Mercado / comunidad AFIP:** ante un timeout, `FECompUltimoAutorizado` (contar el último número)
no alcanza — hay que encadenarlo con `FECompConsultar` (traer el detalle real, incluido el CAE)
para saber si el comprobante en disputa es nuestro o de otro trámite. Es el patrón estándar de la
industria: **"confirm-before-repeat"** — antes de reintentar (o de rendirse), preguntar "¿esto ya
existe?".

**Código de KAIROX:** `arca-worker/index.ts:213-223` llama a `getLastVoucherNumber`
(=`FECompUltimoAutorizado`) pero **nunca implementa `FECompConsultar`** — no existe en
`_shared/wsfe.ts`. Al detectar que ARCA está adelantado, se rinde directo a `error_definitivo`, sin
backoff, sin reintento, sin verificar si el comprobante en disputa es el nuestro. En el caso real
del 06/08, `lastNumber(35) == expectedNumero+1(35)` — el patrón textbook de "el POST se cortó por
timeout justo después de que ARCA ya autorizó". Con `FECompConsultar`, el sistema podría
auto-resolver la gran mayoría de estos casos sin que nadie toque el portal.

---

## Fase 1 — Reconciliación automática (resuelve el incidente real) 🔴

**Objetivo:** que el caso "ambiguo" se auto-resuelva en el mismo ciclo del worker, sin
intervención humana, en el >90% de los casos.

1. Implementar `feCompConsultar(environment, auth, ptoVta, cbteTipo, cbteNro)` en
   `_shared/wsfe.ts` (mismo patrón que `feCompUltimoAutorizado`).
2. En `arca-worker/index.ts:213-223`, antes de `marcarErrorDefinitivo`: consultar cada número
   entre `expectedNumero+1` y `lastNumber`, comparar `ImpTotal`/`DocNro`/fecha contra el
   comprobante local pendiente.
   - **Matchea** → persistir el CAE encontrado (mismo camino de éxito, líneas 302-333) y cerrar
     como `emitida`. Cero intervención humana.
   - **No matchea** (otro comprobante genuinamente distinto avanzó el contador) → recién ahí
     `error_definitivo`, con mensaje explícito de qué se comparó y por qué no coincidió.
3. Permitir que este camino, si la reconciliación no resuelve, también pueda caer en la
   contingencia CAEA (hoy `arca-worker/index.ts:218-221` hace `continue` y se salta por completo
   el bloque que invoca `intentarCaeaContingencia` — una empresa con CAEA configurado no la recibe
   para este caso específico).
4. Persistencia post-emisión atómica: mover el `Promise.all` de 3 updates independientes
   (`arca-worker/index.ts:305-333`) a una RPC `SECURITY DEFINER` en una única transacción de
   Postgres — hoy, si el proceso se corta entre que ARCA devuelve el CAE y que terminan de
   escribirse las 3 tablas, puede quedar un comprobante "fantasma" (CAE real en ARCA, pero
   `cae_estado='pendiente'` para siempre en KAIROX, invisible al worker porque su fila de cola
   queda trabada en `'procesando'`). Agregar también un timeout de recuperación para filas
   `'procesando'` colgadas (mismo patrón que ya usa el lock del worker).
5. Endurecer permisos: `REVOKE INSERT, UPDATE, DELETE ON facturas_pendientes_arca FROM
   authenticated` (dejar solo `SELECT`) — las 3 RPCs que tocan la tabla son `SECURITY DEFINER` y no
   lo necesitan; hoy la superficie queda más abierta de lo que hace falta.

**Impacto esperado:** el caso que generó este pedido (7 Facturas C atascadas) se hubiera resuelto
solo, sin que Luciano tuviera que entrar al portal de ARCA.

---

## Fase 2 — Velocidad (que no demore) 🟡

**Objetivo:** que el primer intento de emisión ocurra en segundos, no en hasta 5 minutos.

1. Tras encolar una factura (trigger `fn_queue_factura_arca`), invocar el worker
   fire-and-forget (`supabase.functions.invoke('arca-worker', ...)` sin await bloqueante, con
   catch silencioso) desde el mismo hook que confirma la venta. El cron de 5 min queda como red de
   seguridad, no se reemplaza — solo deja de ser el único disparador.
2. Sincronizar `max_intentos`: la tabla tiene `DEFAULT 3` pero el worker usa una constante
   hardcodeada de 5 — la barra de progreso del Monitor hoy le miente al usuario ("2/3" cuando en
   realidad van a intentarse 5). Elegir una fuente de verdad única.

---

## Fase 3 — Claridad de errores 🟡

**Objetivo:** que cualquier persona (no solo quien lee logs) entienda qué pasó y qué hacer.

1. Diccionario `CODIGOS_AFIP_HUMANO` en `_shared/afip.ts` con los ~15-20 códigos más frecuentes ya
   vistos en producción (10016, 10197, 10246, 15008, 15004...). El worker sigue guardando el
   mensaje crudo (`error_mensaje`, para debug) y agrega un campo `error_mensaje_usuario` con la
   traducción. Monitor y `SaleDetailModal` muestran el mensaje traducido, con un toggle "Ver
   detalle técnico" para el crudo — mismo patrón que SAP usa entre el "short message" y el
   "long text" del Application Log.
2. El caso ambiguo no incrementa `intentos` hoy — la UI muestra "0 intentos" sobre una fila que ya
   se rindió activamente, y eso se lee como "nunca lo intentó" cuando en realidad el sistema decidió
   no reintentar por seguridad. Distinguir visualmente "se agotaron los reintentos" de "el sistema
   decidió no reintentar" — son causas raíz distintas, hoy se ven idénticas.
3. Mientras la Fase 1 no exista: el botón "Reintentar" sobre un comprobante ambiguo es un placebo
   (vuelve a caer en el mismo `error_definitivo` sin ni siquiera llamar a ARCA). Una vez esté la
   Fase 1, deja de serlo — este punto lo resuelve la Fase 1, no requiere trabajo propio.
4. "Marcar resuelta" (`marcar_cae_resuelto_manual`) no captura el CAE real — si el usuario verificó
   a mano en el portal que el comprobante sí tiene CAE, el sistema lo deja "emitido" pero sin el
   CAE legal que la normativa exige imprimir. Agregar parámetros opcionales `p_cae`,
   `p_numero_afip`, `p_cae_vencimiento` a la RPC, con inputs correspondientes en el diálogo de
   confirmación del Monitor.

---

## Orden recomendado

**Fase 1 primero, sin dividir** — es la que resuelve el incidente real y tiene el mayor impacto
sobre los 3 objetivos a la vez (menos intervención humana, resolución en el mismo ciclo sin
esperar backoff, mensaje de error que queda obsoleto en el momento en que se autorresuelve). Fases
2 y 3 son independientes entre sí y pueden ir en cualquier orden después, o en paralelo si hay dos
personas disponibles.

## Qué NO se toca

El diseño general del worker (lock, backoff, clasificación de errores, CAEA, numeración por PdV) —
está bien resuelto y no tiene relación con el incidente. Este plan es quirúrgico sobre la rama de
ambigüedad y sus consecuencias en velocidad/claridad, no un rediseño del motor.
