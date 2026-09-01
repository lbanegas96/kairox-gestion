# Plan — Ajuste por Inflación en KAIROX Gestión

**Estado (01/09): Fase 1 EN PRODUCCIÓN** (`supabase/migrations/378_ajuste_inflacion_fase1.sql` + fix de seguridad `379_fix_grants_ajuste_inflacion.sql`), probada contra datos reales de Nalux y aplicada con Luciano confirmando. Sin contador matriculado disponible: las decisiones donde la norma deja margen se tomaron con evidencia pública, documentadas en el artifact ["Circuito de Ajuste por Inflación"](https://claude.ai/code/artifact/be8ba7a2-255c-4848-af5b-e8921c59535c) para corregir por comentario si alguien las revisa. Falta cargar el primer índice IPC (Configuración → Finanzas) antes de poder generar un ajuste real. **Fase 2** (reporte en moneda homogénea) es el próximo paso.

---

## 1. Por qué esto es real y no una feature de nicho

- **RT 6 (FACPCE) es obligatoria desde julio de 2018** para todos los estados contables de ejercicios cerrados a partir de esa fecha, y sigue vigente en 2026 — FACPCE publica el índice todos los meses (basado en el IPC Nacional del INDEC). No es opcional para ninguna sociedad que tenga que presentar balance. [[FACPCE — índice ajuste por inflación](https://web.cpcecba.org.ar/facpce-publico-el-indice-para-el-ajuste-por-inflacion-de-febrero-2026/)]
- **Existe además un ajuste por inflación IMPOSITIVO**, separado del contable, regulado por la Ley 27.468 y los arts. 95/96 de la Ley de Impuesto a las Ganancias — se activa cuando la inflación acumulada de 36 meses supera el 100% (hoy ampliamente superado) y afecta directamente cuánto Impuesto a las Ganancias paga la empresa. Usa el mismo índice IPC pero un circuito de cálculo distinto (activos/pasivos vs. inflación impositiva estática/dinámica). [[Consejo Salta — Ajuste impositivo Ley 27.468](https://www.consejosalta.org.ar/wp-content/uploads/AJUSTE-POR-INFLACION-IMPOSITIVO-Y-CONTABLE_-IMPLEMENTACION-POR-LA-LEY-27468.pdf)]
- Conclusión: **toda PyME argentina que factura como sociedad tiene esta obligación hoy**, contable y/o impositiva. No depende de que la inflación "esté alta" — ya está objetivamente por encima del umbral desde hace años.

## 2. Qué hay hoy en KAIROX (relevamiento del código real)

Grepeé el repo entero buscando `RECPAM`, `ajuste por inflación`, `reexpresión` — **cero resultados**. No existe absolutamente nada de esto hoy. Pero KAIROX ya tiene construida la infraestructura contigua sobre la que esto se apoya:

| Ya existe | Dónde | Por qué importa para este feature |
|---|---|---|
| `plan_cuentas` con `tipo` (activo/pasivo/patrimonio/ingreso/egreso) | `PlanCuentasSection` | Falta el eje que realmente pide el ajuste: **monetaria vs. no monetaria** — hoy no existe ese campo |
| `periodos_contables` + `cerrar_ejercicio_contable()` (mig.283) | Contabilidad → Cierre | Ya arma el asiento de cierre barriendo ingreso/egreso del período — es el punto de enganche natural para inyectar el ajuste ANTES del cierre |
| `asientosAutoService` — motor de asientos automáticos partida doble | `planCuentasService.ts` | Mismo patrón para generar el asiento de ajuste (no hay que inventar un motor nuevo) |
| Revalorización de Inventario (mig.334-337, cerrada 20/08) | Inventario → Revalorización | Ya resuelve la reexpresión de UN rubro no monetario (mercadería) contra `5.10`/`4.5` — es el precedente directo, falta generalizarlo a TODO el plan de cuentas |
| Moneda paralela + `tipos_cambio` | Config → Finanzas | Modelo de "coeficiente que varía por fecha" ya existe para USD — el índice IPC es conceptualmente lo mismo aplicado a ARS |
| Cierre de ejercicio SAP-style (traslado a 3.2 Acumulados) | mig.283/284 | El resultado por RECPAM tiene que terminar viajando por el mismo camino |

**Conclusión clave:** no hace falta un motor nuevo. Falta un maestro (clasificación monetaria/no monetaria + fecha de origen), una fuente de índice, y un proceso que recorra el plan de cuentas usando el mismo motor de asientos que ya existe.

## 3. Cómo lo resuelve el mercado hoy — y dónde está el hueco real

Miré 4 frentes: el ERP de referencia (SAP), los 3 sistemas contables más usados en Argentina, y qué dicen contadores/blogs técnicos sobre la experiencia real.

**SAP Business One — el propio ERP de referencia NO lo trae nativo.** La localización Argentina de SAP B1 no incluye ajuste por inflación de fábrica; existen add-ons de terceros pagos aparte (ej. "Ajuste por Inflación VK" de VisualK) que dicen explícitamente que "la versión estándar de SAP Business One tiene alcance limitado para este requerimiento". SAP S/4HANA sí tiene programas dedicados (J1AI, J_1AINFG, J1AZ) pero son localización avanzada, no algo que una PyME chica active con un clic. [[VisualK — AddOn Ajuste por Inflación](https://visualkgroup.com/conoce-mas-de-nuestro-addon-de-ajuste-por-inflacion-vk%EF%BF%BC/)] [[Foro consultoría SAP](https://foros.consultoria-sap.com/t/ajuste-por-inflacion-en-argentina/31528)]

**Tango, Xubio, Colppy — sí lo tienen, y bien.** Xubio, por ejemplo, ya modela exactamente el concepto correcto: partidas monetarias vs. no monetarias como clasificación de cuenta, un asiento automático "en un clic", y hasta un modo por "circuitos contables" (corre el ejercicio dos veces, uno histórico y uno ajustado). Tango lo integra con revalúo de bienes de uso y resultado por tenencia. [[Xubio — partidas que ajustan](https://ayuda.xubio.com/es-ar/que-partidas-ajustan-por-inflacion/)] [[Xubio — cómo generar el ajuste](https://ayuda.xubio.com/es-ar/como-genero-ajuste-por-inflacion-ejercicio-contable/)]

**El hueco real no es "que falte la funcionalidad" — es a QUIÉN se la dan.** Los tres sistemas que la resuelven bien (Tango, Xubio, Colppy) están diseñados y vendidos para el **estudio contable**, no para el dueño de la PyME. El circuito real hoy, para el 90%+ de las PyMEs argentinas, es:

1. La PyME vende/compra/factura en SU sistema de gestión (o en Excel, o en un ERP como KAIROX).
2. Una vez al año (o al mes, si el contador es prolijo), le **exporta/reenvía los datos al estudio contable**.
3. El estudio los carga en Xubio/Tango/Colppy — sistemas que el dueño de la PyME ni conoce ni ve — y ahí recién se calcula el ajuste.
4. El dueño de la PyME **nunca ve un Balance o Estado de Resultados en moneda homogénea durante el año** — solo al cierre, meses después, cuando ya tomó decisiones de precio/margen con números que estaban distorsionados por inflación sin saberlo.

Ese punto 4 es la oportunidad real. **KAIROX ya es el sistema donde vive el plan de cuentas y los asientos automáticos del día a día del dueño** — no una herramienta de estudio contable aparte. Si el ajuste por inflación vive ahí mismo, el dueño puede ver su Balance/EERR en moneda homogénea **en cualquier momento del año**, no solo al cierre — algo que ni SAP B1 ni Xubio (pensados para uso del contador, no del operador diario) resuelven hoy para el segmento PyME chica/mediana.

## 4. Diseño funcional propuesto (SAP-style: maestro → configuración → operación → reporte)

Siguiendo la Regla 1 de `sap-reference` (parametrización en Configuración, operación en su módulo):

### 4.1 Maestro — clasificación de cuentas
Nuevo campo en `plan_cuentas`: `naturaleza_monetaria` (`'monetaria' | 'no_monetaria'`), configurable por cuenta desde `PlanCuentasSection` (no un módulo nuevo — es un atributo más del maestro que ya existe). Reglas por defecto sugeridas al crear una cuenta nueva (ajustables): Caja/Bancos/CxC/CxP → monetaria; Bienes de Uso/Inventario/Patrimonio/Ingreso/Egreso → no monetaria — mismo criterio que ya usa Xubio.

Para partidas no monetarias hace falta además la **fecha de origen** del saldo (cuándo se incorporó al patrimonio) para saber qué coeficiente aplicarle — en cuentas de movimiento constante (Inventario, Ventas, Egresos) esto se resuelve por período, no por saldo puntual; en cuentas más estáticas (Bienes de Uso, Capital) sí importa la fecha real de alta.

### 4.2 Configuración — índice de inflación
Tabla `indices_inflacion` (empresa_id, período, coeficiente) en `ConfiguracionSection → Finanzas`, junto a Tipos de Cambio (mismo patrón, es literalmente el mismo concepto: un coeficiente que varía por fecha). Carga manual mes a mes (el dato lo publica FACPCE, no hay API oficial) con la opción de importar un CSV — igual criterio que otros maestros de KAIROX. Mismo punto: acá también vive la cuenta de RECPAM (`4.4`/`5.9` ya existen para diferencias de inventario — evaluar si RECPAM necesita cuenta propia o reusa esas).

### 4.3 Operación — proceso de ajuste
Un nuevo RPC (`generar_ajuste_por_inflacion`) que se dispara desde el cierre de período (antes de `cerrar_ejercicio_contable`, mismo punto de enganche que hoy usa Revalorización de Inventario):
1. Recorre `plan_cuentas` con `naturaleza_monetaria = 'no_monetaria'`, calcula la reexpresión con el coeficiente del período.
2. Calcula el RECPAM de las partidas monetarias (por diferencia, no cuenta por cuenta — es el resultado de la exposición neta).
3. Genera UN asiento de ajuste con partida doble, mismo criterio que `asientosAutoService` — no un motor nuevo.
4. Deja el asiento visible en el Libro Mayor como cualquier otro, con `origen = 'ajuste_inflacion'` (mismo patrón de trazabilidad que ya usa cada RPC de KAIROX).

### 4.4 Reporte — el diferencial real frente a la competencia
`ReportesSection` gana un toggle "Ver en moneda homogénea" sobre Balance y Estado de Resultados — no un reporte nuevo y separado, sino el MISMO reporte que ya existe, con y sin el ajuste aplicado. Esto es lo que hoy nadie le da al dueño de la PyME sin pasar por el estudio contable.

## 5. Fases sugeridas (para no construir todo de una)

1. **Fase 0 — validar con Luciano y con un caso real:** confirmar con un contador real (o con Nadia, si tiene el contexto) qué tan estricta necesita ser la Fase 1 — si alcanza con un ajuste anual simplificado o si hace falta el detalle mensual desde el día 1.
2. **Fase 1 — maestro + asiento único anual:** clasificación monetaria/no monetaria en plan de cuentas + carga manual del índice + un asiento de ajuste al cierre de ejercicio (reusa `periodos_contables`). Esto ya cubre la obligación de RT 6 para el ejercicio.
3. **Fase 2 — reporte en moneda homogénea:** el toggle en Balance/EERR — acá es donde KAIROX se diferencia de verdad.
4. **Fase 3 — ajuste impositivo (Ganancias):** circuito separado, solo si se confirma demanda real — es una obligación distinta con reglas propias (art. 95/96 LIG), no se puede resolver "gratis" reusando la Fase 1.
5. **Fase 4 (opcional, evaluar demanda):** ajuste mensual/por período en vez de solo al cierre — para empresas que quieran ver su margen real mes a mes, no solo al cierre de ejercicio.

## 6. Riesgo principal a validar antes de construir

Esto es contablemente sensible — un ajuste mal calculado puede generar un Balance incorrecto que el contador del cliente tiene que defender ante AFIP/terceros. Antes de escribir una línea de código: **validar el circuito exacto de cálculo (Fase 1) con un contador matriculado real**, no solo con lo que dicen los blogs. La skill `auditor-contable` puede auditar la implementación una vez construida, pero el diseño del circuito de cálculo necesita revisión humana experta antes de tocar producción — mismo criterio que ya se aplicó con Cheques/CxC-CxP en esta sesión.

---

*Documento de investigación — no incluye código ni migraciones. Fuentes citadas inline. Actualizar cuando haya decisión de negocio sobre qué fase construir primero.*
