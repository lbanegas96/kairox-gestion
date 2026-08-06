# Fidelización por Puntos — Investigación inicial

**Estado:** investigación de mercado + hallazgos del código actual. Todavía NO hay plan de fases
ni código — antes hacen falta decisiones de negocio que sólo Nadia/Luciano pueden tomar (ver
sección final). Mismo criterio que Modo Offline y Multi-caja: nunca directo a código en una
feature grande.

## Por qué esto (contexto)

Con Modo Offline y Multi-caja cerrados (07/08), Luciano marcó Fidelización por Puntos como la
próxima pieza grande del roadmap — "hueco real: ni Tango ni Rapiboy lo resuelven bien para PyMEs
locales". Se investigó el mercado para confirmar esa hipótesis antes de construir nada.

## Qué hace la competencia (investigado hoy, con fuentes)

**El hueco es real y más marcado de lo que parecía:**

- **[Tango Gestión](https://grupotesys.com.ar/tango-gestion/faq)** (el ERP/POS dominante en
  Argentina, la referencia de Luciano) — **no tiene fidelización nativa**. Su documentación
  pública sólo cubre cuenta corriente, facturación electrónica e información comercial. Un
  programa de puntos ahí requeriría desarrollo a medida (Flow) sin soporte oficial.
- **[Fudo](https://recursos.fu.do/beneficios-clientes)** (POS gastronómico muy usado en
  Argentina) — tampoco lo tiene incorporado. Lo resuelve integrando una plataforma externa
  (**[Novity](https://novity.com.ar/)**, planes $14.700–$41.900/mes ARS) o su propia "Tienda de
  Puntos" — en ambos casos, una segunda suscripción + integración aparte.
- **[Fidely](https://www.fidely.com/)** — plataforma standalone de fidelización (no un POS),
  USD 49–149/mes, se integra vía API con POS/pagos/contabilidad. Mismo patrón: un producto más
  para sumar y mantener.
- **[Pedisy](https://www.pedisy.com/)** (software gastronómico) — sí lo tiene, pero como
  **upsell de plan superior**: sólo en el tier "Avanzado" ($65.000/mes) para arriba, no en el
  plan básico ($30.000/mes). Confirma que el mercado está dispuesto a pagar más por esto.

**Conclusión:** en ningún caso relevado la fidelización está resuelta nativa y gratis dentro del
mismo sistema de gestión — o no existe (Tango), o es un módulo pago aparte que hay que integrar
(Fudo+Novity, Fidely), o es un upsell de plan (Pedisy). KAIROX ya tiene `clientes` y `ventas`
como dueño de esos datos — construirlo nativo es una ventaja real de "cero fricción de
integración" contra las 3 alternativas.

## Patrones de diseño usados en la industria (investigado, no inventado)

- **Modelo dominante:** puntos por monto gastado (ej. "1 punto cada $100" o "3 puntos por
  dólar"). Es el más simple y el que soportan todos los sistemas relevados.
- **Canje:** dos variantes — descuento directo en el checkout, o catálogo de premios/productos
  específicos (Fidely, Novity usan catálogo; no quedó claro en las fuentes si alguno soporta las
  dos variantes a la vez).
- **Niveles (Bronce/Plata/Oro):** común en las plataformas standalone (Novity), con beneficios
  progresivos — no es el modelo base, es una capa encima.
- **Bono de bienvenida:** común al inscribirse.
- **Multiplicadores por horario/día flojo** (Pedisy: "multiplicadores para llenar los días
  flojos") — interesante porque KAIROX ya tiene ese mismo concepto en el motor de ofertas
  (`dia_semana` en la tabla `ofertas`).
- **Exclusiones:** productos de bajo margen o ciertos medios de pago se suelen poder excluir de
  sumar puntos.
- **Vencimiento de puntos:** ninguna fuente relevada documentó en detalle su política — parece
  ser una decisión de cada negocio, no un estándar de la industria.

## Hallazgos del código actual de KAIROX (verificados, no supuestos)

- **`clientes`** no tiene ninguna columna de puntos hoy — as-is, terreno limpio. Ya tiene
  `saldo_actual` (cuenta corriente) — un `saldo_puntos` seguiría el mismo patrón visual/mental
  que el cajero y Nadia ya conocen, aunque el historial de movimientos probablemente necesite su
  propia tabla (mismo criterio que `movimientos_caja` sobre `caja_sesiones`: nunca guardar sólo
  el saldo final sin el detalle de cómo se llegó ahí — auditable).
- **El motor de ofertas ya existe** (`ofertas` table + RPC `calcular_ofertas_carrito`, usado hoy
  en `PanelCarrito.jsx`/`ModoCajaLayout.jsx` vía el hook `calcularOfertas`) y ya resuelve
  "descuento automático en el checkout según producto/categoría/medio de pago/día de la semana".
  **Pero es automático** (el sistema decide, el cajero no elige nada) — canjear puntos es una
  decisión explícita del cliente en el momento de cobrar, más parecido al patrón de "Cuenta
  Corriente" (el cajero la selecciona a propósito) que al de ofertas. Cuál de los dos patrones
  (o uno nuevo) conviene reusar es una decisión de diseño real, no algo para asumir a ciegas —
  mismo tipo de error que costó la migración 214 (formas de pago hardcodeadas en 3 pantallas
  distintas antes de unificarlas en un maestro real).
- **`empresas`** ya tiene el patrón de "feature opcional por tenant" bien establecido (`usa_tc_paralelo`,
  `usa_centros_costo`, `usa_ecommerce`, etc.) — fidelización debería seguir el mismo patrón
  (`usa_fidelizacion` + su propia tabla de configuración: ratio de puntos, vencimiento,
  exclusiones) en vez de una regla global para todas las empresas.
- **`ClienteSelector`** (usado en `PanelCarrito.jsx` del POS y en `NuevaVentaModal.jsx` del ERP)
  es el lugar natural para mostrar el saldo de puntos del cliente elegido — ya es el punto de
  contacto entre "elegir cliente" y "cobrar".
- **`crear_venta`** necesitaría sumar/restar puntos como parte de la transacción (ganados por la
  compra, descontados si se canjean) — mismo lugar donde hoy ya mueve stock y genera el
  comprobante en una sola transacción atómica.

## Lo que todavía no se puede decidir sin Nadia/Luciano (preguntas de negocio reales, no técnicas)

A diferencia de Modo Offline (ahí las restricciones eran técnicas — qué medio de pago funciona
sin red), acá casi todo es una decisión de **negocio**, no de código. Construir sin esto sería
inventar reglas que después hay que deshacer:

1. **¿Cada empresa que usa KAIROX define su propio ratio de puntos** (ej. Nalux podría usar
   "1 punto cada $500" y otro cliente de KAIROX otro ratio), **o es un valor fijo global?**
2. **¿El canje es descuento directo en pesos, catálogo de premios/productos, o las dos cosas?**
   Cambia mucho el alcance técnico (catálogo de premios es un CRUD entero nuevo).
3. **¿Los puntos vencen?** Si sí, ¿a los cuántos meses, y quién decide eso — cada empresa o un
   valor fijo?
4. **¿Se excluyen medios de pago o categorías de productos de sumar puntos** (ej. Cuenta
   Corriente, o productos de reventa con margen mínimo)?
5. **¿Es una funcionalidad gratis para todas las empresas que usan KAIROX, o un diferencial
   pago/premium** (como lo hace Pedisy con su plan Avanzado)? Esto no es sólo una pregunta de
   producto — puede cambiar directamente cómo se diseña el flag `usa_fidelizacion`.
6. **Confirmar el alcance:** es fidelización de **cada negocio con sus propios clientes**
   (single-merchant), no una coalición entre distintas empresas que usan KAIROX — asumo que sí,
   pero vale confirmarlo antes de diseñar nada.

No hay código ni migraciones todavía — el siguiente paso, una vez resueltas estas preguntas, es
recién ahí armar el plan de fases (mismo formato que `PLAN_MODO_OFFLINE_POS.md`/`PLAN_MULTI_CAJA.md`).
