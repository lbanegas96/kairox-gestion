# BORRADOR — Política de Privacidad de KAIROX Gestión

> **NO PUBLICAR SIN REVISIÓN DE UN ABOGADO.** Es un borrador técnico armado a partir de lo que el sistema hace de verdad
> (auditoría 24/09/2026, hallazgo OPE-4). Lo que está entre `[corchetes]` es un dato que falta completar o una decisión que
> debe tomar Luciano o el abogado. No es asesoramiento legal.

---

## Notas para quien revise este borrador (abogado / Luciano)

1. **Roles (Ley 25.326, art. 25).** El sistema es un ERP para empresas. Cada empresa cliente carga datos de *sus* clientes y proveedores:
   para esos datos, la **empresa es la responsable** y Kairox actúa como **prestador de servicios de tratamiento por cuenta de terceros**.
   Para los datos de las cuentas de usuario (email, nombre, registros de acceso) y de la propia empresa contratante, Kairox es responsable.
   La política está escrita con esa separación. Confirmar que es la estructura correcta.
2. **Transferencia internacional (art. 12).** La base de datos está en Supabase, región **São Paulo (Brasil)**; el sitio está en **Vercel** (infraestructura
   global, principalmente EE. UU.). Evaluar si hace falta usar las cláusulas contractuales modelo de la AAIP o el consentimiento del titular, y completar la sección 7.
3. **Registro de bases de datos (art. 21).** Consultar si corresponde inscribir la base ante la AAIP (Registro Nacional de Bases de Datos Personales).
4. **Plazos de conservación** de la sección 9: confirmar con el contador (documentación contable y fiscal) y con el abogado.
5. **Copias de seguridad (sección 8):** hoy el plan de Supabase es Free y **no tiene copias restaurables**. No publicar la frase sobre copias hasta que
   exista el plan Pro o el volcado propio (ver `docs/operacion/PLAN_DE_RECUPERACION.md`).
6. Si el sistema llega a usar **Sentry** u otra herramienta de análisis o correo transaccional, agregarla en las secciones 6 y 7.
7. Si hubiera usuarios en la **Unión Europea**, revisar el RGPD (el proyecto lo prevé en `CLAUDE.md`).

---

# Política de Privacidad

**Última actualización:** [fecha de publicación]

## 1. Quiénes somos

**[Razón social de Kairox IA]**, CUIT [número], con domicilio en [domicilio legal], correo de contacto [correo de privacidad]
(en adelante, "**Kairox**"), desarrolla y opera **KAIROX Gestión**, un sistema de gestión comercial y contable para empresas.

## 2. A quién se aplica y quién es responsable de qué

- **Datos de las personas que usan el sistema y de la empresa que lo contrata** (nombre, correo, rol, datos fiscales de la empresa,
  registros de acceso): **Kairox es el responsable** de su tratamiento.
- **Datos que cada empresa carga sobre sus propios clientes, proveedores y operaciones** (nombre, documento o CUIT, teléfono, correo, domicilio, ventas,
  compras, cuentas corrientes): **la empresa es la responsable** de esos datos. Kairox los trata **solo por cuenta de la empresa y siguiendo sus
  instrucciones**, para prestarle el servicio, sin usarlos para ningún otro fin (art. 25, Ley 25.326).
  Si usted es cliente o proveedor de una empresa que usa KAIROX Gestión y quiere ejercer sus derechos sobre sus datos, debe dirigirse **a esa empresa**;
  si nos escribe a nosotros, le derivaremos el pedido.

## 3. Qué datos tratamos

| Categoría | Datos | Quién los carga |
|---|---|---|
| Cuenta de usuario | Correo electrónico, nombre, rol y permisos dentro de la empresa, contraseña (guardada de forma cifrada por el servicio de autenticación; nunca en texto plano) | El usuario o el administrador de su empresa |
| Empresa contratante | Razón social, CUIT, domicilio, teléfono, condición frente al IVA, puntos de venta, certificado digital para facturar ante ARCA | La empresa |
| Clientes y proveedores de la empresa | Nombre o razón social, documento / CUIT, teléfono, correo, domicilio, persona de contacto, saldos y operaciones | La empresa |
| Operaciones | Ventas, compras, cobros, pagos, stock, asientos contables, comprobantes fiscales, cuentas bancarias de la empresa (CBU / alias) | La empresa |
| Registros técnicos y de auditoría | Fecha y usuario de cada cambio en datos financieros, **dirección IP** de la conexión, errores técnicos | Se generan automáticamente |

**No pedimos ni almacenamos** datos de tarjetas de crédito o débito (los cobros con Mercado Pago se procesan en Mercado Pago; solo guardamos el número y el estado
del pago). **El sistema no está pensado para tratar datos sensibles** (origen racial, opiniones políticas, salud, vida sexual, etc.): pedimos no cargarlos.

## 4. Para qué los usamos

- Prestar el servicio: gestión de ventas, compras, stock, caja, bancos, contabilidad e impuestos.
- Emitir comprobantes electrónicos ante **ARCA** (ex AFIP) por cuenta de la empresa.
- Seguridad y auditoría: registrar quién cambió qué, prevenir accesos indebidos.
- Soporte, mantenimiento y mejora del servicio.
- Cumplir obligaciones legales (fiscales, contables).

No vendemos datos personales. No los usamos para publicidad de terceros. **[Confirmar si se hará algún envío de novedades o marketing: requiere consentimiento y baja simple.]**

## 5. Base del tratamiento

Ejecución del contrato de servicio con la empresa, cumplimiento de obligaciones legales (fiscales y contables) y, cuando corresponda, el consentimiento del titular.

## 6. Con quién compartimos datos (encargados y destinatarios)

| Quién | Para qué | Datos |
|---|---|---|
| **Supabase** | Base de datos, autenticación de usuarios, funciones del servidor | Todos los del sistema |
| **Vercel** | Alojamiento del sitio web | Datos técnicos de la conexión (IP, navegador) |
| **ARCA** | Emisión de comprobantes electrónicos | Los del comprobante (emisor, receptor, importes) |
| **Mercado Pago, Tiendanube, MercadoLibre** | **Solo si la empresa activa la integración** | Cobros, pedidos y productos que la empresa decide sincronizar |
| **dolarapi.com** | Consulta pública de la cotización del dólar | Ninguno personal |
| **[Servicio de correo]** | Correos del sistema (invitaciones, recuperación de contraseña) | Correo del destinatario |
| **[Otros: herramienta de errores, si se agrega]** | Detectar fallas del sistema | Datos técnicos, sin datos de clientes |

No cedemos datos a otros terceros salvo obligación legal o requerimiento de autoridad competente.

## 7. Transferencias internacionales

Los datos se alojan en servidores de Supabase ubicados en **São Paulo, Brasil**, y el sitio se sirve mediante Vercel, que utiliza infraestructura ubicada
principalmente en Estados Unidos. **[Completar con la salvaguarda adoptada: cláusulas contractuales modelo aprobadas por la AAIP / consentimiento / otra.]**

## 8. Cómo protegemos los datos

- Cada empresa ve **solo sus propios datos**: el aislamiento está impuesto en la propia base de datos (seguridad por filas), no solo en la pantalla.
- Conexiones cifradas (HTTPS). Los certificados digitales para ARCA y las credenciales de integraciones se guardan cifrados (Vault) y no son visibles desde el navegador.
- Permisos por rol y por módulo; registro de auditoría de los cambios en datos financieros.
- Los asientos contables solo pueden escribirse a través de funciones del servidor que validan la partida doble y el período.
- Revisiones de seguridad periódicas del sistema.
- **[Copias de seguridad: completar cuando exista el plan Pro de Supabase o el volcado propio — ver notas.]**

Ningún sistema es invulnerable. Si detectáramos un incidente que afecte datos personales, lo comunicaremos a los afectados y a la autoridad cuando corresponda.

## 9. Cuánto tiempo conservamos los datos

- Mientras la cuenta esté activa.
- Al terminar el servicio, la empresa puede exportar sus datos durante **[30] días**; después se eliminan o anonimizan, **salvo** lo que la ley obligue a conservar
  (documentación contable y fiscal: **[10 años — confirmar]**).
- Registros técnicos y de auditoría: **[plazo a definir]**.

## 10. Sus derechos

Usted puede solicitar el **acceso** a sus datos, su **rectificación, actualización o supresión** (Ley 25.326, arts. 14 a 16). El acceso se responde dentro de
**10 días corridos** y es gratuito a intervalos no inferiores a seis meses; la rectificación o supresión, dentro de **5 días hábiles**. Para ejercerlos escriba a
**[correo de privacidad]** indicando su nombre, un medio de contacto y qué solicita, y acompañando copia de su documento. La supresión no procede sobre datos que
la ley nos obligue a conservar (por ejemplo, comprobantes fiscales).

> **[Leyenda oficial — el abogado debe confirmar el texto vigente]:** El titular de los datos personales tiene la facultad de ejercer el derecho de acceso a los mismos en
> forma gratuita a intervalos no inferiores a seis meses, salvo que se acredite un interés legítimo al efecto conforme lo establecido en el artículo 14, inciso 3 de la Ley
> N° 25.326. La AGENCIA DE ACCESO A LA INFORMACIÓN PÚBLICA, en su carácter de Órgano de Control de la Ley N° 25.326, tiene la atribución de atender las denuncias y reclamos que
> interpongan quienes resulten afectados en sus derechos por incumplimiento de las normas vigentes en materia de protección de datos personales.

## 11. Cookies y almacenamiento del navegador

KAIROX Gestión **no usa cookies de seguimiento ni de publicidad**. Guarda en su navegador, de forma local, lo necesario para mantener la sesión iniciada y para que el punto de
venta pueda seguir cobrando sin conexión y sincronizar después. **[Actualizar si se agrega una herramienta de análisis.]**

## 12. Menores de edad

El servicio es de uso comercial y está dirigido a personas mayores de edad.

## 13. Cambios en esta política

Podemos actualizarla; publicaremos la nueva versión con su fecha y, si el cambio es importante, se lo informaremos por correo.

## 14. Contacto

**[Razón social]** — **[correo de privacidad]** — **[domicilio]**
