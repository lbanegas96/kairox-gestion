# BORRADOR — Términos y Condiciones de uso de KAIROX Gestión

> **NO PUBLICAR SIN REVISIÓN DE UN ABOGADO.** Borrador técnico (auditoría 24/09/2026, hallazgo OPE-4) para un servicio de software entre empresas
> (B2B). Lo que está entre `[corchetes]` falta completar o decidir. No es asesoramiento legal.

---

## Notas para quien revise este borrador

1. **Tipo de contrato:** se asume suscripción de software como servicio para **empresas** (no consumidores finales). Si algún cliente fuera un consumidor, cambia el régimen aplicable
   (Ley 24.240) y varias cláusulas de limitación de responsabilidad no valdrían.
2. **Precio, moneda, facturación y forma de pago** (sección 10): todavía no hay política comercial definida. Completar.
3. **Disponibilidad (sección 6):** no se promete un porcentaje. Si se ofrece un acuerdo de nivel de servicio (SLA), definirlo aparte y verificar que el plan de infraestructura lo permita.
4. **Copias de seguridad (sección 7):** hoy no existen copias restaurables (plan Free de Supabase). No publicar hasta resolverlo (`docs/operacion/PLAN_DE_RECUPERACION.md`).
5. **Encargo de tratamiento (sección 9):** contiene la cláusula exigida por el art. 25 de la Ley 25.326. Revisar junto con la Política de Privacidad.
6. **Jurisdicción y ley aplicable (sección 14):** completar el domicilio de la sociedad y los tribunales.

---

# Términos y Condiciones

**Última actualización:** [fecha]

Estos términos regulan el uso de **KAIROX Gestión** (el "**Servicio**"), provisto por **[Razón social de Kairox IA]**, CUIT [número], domicilio [domicilio] ("**Kairox**"), a la empresa
que lo contrata (el "**Cliente**") y a las personas que ella habilita como usuarios.

## 1. El Servicio

Kairox Gestión es un sistema en línea de gestión comercial y contable: ventas y punto de venta, compras, stock, caja y bancos, cuentas corrientes, contabilidad, reportes, impuestos e
integración con la facturación electrónica de ARCA y con plataformas de terceros. Kairox puede mejorar, cambiar o retirar funciones avisando con anticipación razonable cuando el cambio sea relevante.

## 2. Cuenta, usuarios y accesos

- El Cliente designa a uno o más **administradores**, que crean usuarios y les asignan permisos por módulo. El Cliente es responsable de las acciones hechas con sus usuarios.
- Cada usuario debe usar una contraseña propia y segura y no compartirla. Si sospecha un acceso indebido, debe avisar de inmediato a **[correo de soporte]**.
- El Cliente da de baja a los usuarios que dejan de trabajar con él. Desactivar un usuario corta sus permisos de escritura; **[cuando se aplique la mig. 407: y su acceso a los datos]**.

## 3. Uso aceptable

Queda prohibido: usar el Servicio para actividades ilícitas; intentar acceder a datos de otras empresas; sobrecargar, probar vulnerabilidades o interferir con el Servicio sin autorización escrita;
copiar o revender el Servicio; cargar datos sensibles (art. 2, Ley 25.326) que no sean necesarios. Kairox puede suspender el acceso ante un uso que ponga en riesgo el Servicio o a otros clientes.

## 4. Responsabilidades del Cliente

- **Los datos que carga son suyos y de su responsabilidad**: su exactitud, su licitud y contar con la base legal para tratar los datos de sus clientes y proveedores.
- **Configuración fiscal y contable:** condición frente al IVA, puntos de venta, alícuotas, plan de cuentas, tipo de cambio y criterios contables las define y valida el Cliente con su contador.
  Kairox **no presta asesoramiento impositivo, contable ni legal**; los reportes son una ayuda de gestión, no reemplazan la revisión profesional ni las presentaciones ante ARCA u otros organismos.
- **Certificados y claves de ARCA y credenciales de plataformas de terceros:** las obtiene el Cliente y responde por su vigencia y por mantenerlas actualizadas.

## 5. Facturación electrónica y servicios de terceros

El Servicio se conecta a **ARCA** (ex AFIP), **Mercado Pago, Tiendanube, MercadoLibre** y a otros servicios que el Cliente decide activar. Esos servicios tienen sus propias condiciones y pueden fallar o cambiar
sin control de Kairox. Kairox no garantiza su disponibilidad ni responde por sus decisiones (por ejemplo, el rechazo de un comprobante por parte de ARCA). Cuando ARCA no responde, el Servicio deja
el comprobante en cola y reintenta; existe además un circuito de contingencia (CAEA) que el Cliente debe tener configurado si lo necesita.

## 6. Disponibilidad y soporte

Kairox realiza esfuerzos razonables para mantener el Servicio disponible, pero **no garantiza que funcione sin interrupciones ni errores**. Puede haber ventanas de mantenimiento, avisadas cuando sea posible.
El soporte se presta por **[canal y horario]**. **[Si se ofrece un SLA, definirlo acá o en un anexo.]**

## 7. Copias de seguridad

**[Completar cuando exista el plan de copias: frecuencia, retención, y qué se restaura y en qué plazo. No publicar hasta entonces. Recomendación al Cliente: exportar periódicamente sus datos críticos.]**

## 8. Propiedad

- El **software, su diseño y su documentación** son de Kairox. El Cliente recibe un derecho de uso no exclusivo e intransferible mientras dure el contrato.
- Los **datos del Cliente** siguen siendo del Cliente. Kairox los usa solo para prestar el Servicio (sección 9).

## 9. Datos personales — encargo de tratamiento

Para los datos personales que el Cliente carga sobre sus propios clientes, proveedores, empleados y otras personas, **el Cliente es el responsable del tratamiento y Kairox es su encargado**
(art. 25, Ley 25.326). Kairox se compromete a:

1. Tratar los datos **solo por cuenta del Cliente y según sus instrucciones**, para prestar el Servicio, y **no aplicarlos ni utilizarlos con un fin distinto**.
2. **No comunicarlos a otras personas**, ni siquiera para su conservación, salvo a los subencargados necesarios para prestar el Servicio (alojamiento, base de datos, autenticación y servicios que el Cliente active),
   que figuran en la Política de Privacidad, con obligaciones equivalentes.
3. Aplicar las **medidas de seguridad técnicas y organizativas** descriptas en la Política de Privacidad para evitar pérdida, acceso o tratamiento no autorizado.
4. Guardar **confidencialidad** y exigirla a su personal.
5. **Asistir al Cliente** para atender los pedidos de acceso, rectificación y supresión de los titulares (ver `PROCEDIMIENTO_DERECHOS_DE_LOS_TITULARES.md`).
6. Avisar al Cliente **sin demora indebida** si toma conocimiento de un incidente de seguridad que afecte sus datos.
7. Al terminar el contrato, **devolver o destruir** los datos según se indica en la sección 11, salvo lo que la ley obligue a conservar.

El Cliente declara que cuenta con base legal para cargar esos datos y que informó a los titulares lo que exige la ley.
**[Transferencia internacional: los datos se alojan en Brasil y se sirven desde infraestructura de Estados Unidos; completar la salvaguarda adoptada.]**

## 10. Precio y pago

**[Completar: plan, precio, moneda, periodicidad, ajustes, medios de pago, facturación, mora y suspensión.]**

## 11. Vigencia y baja

El contrato es por **[plazo]** y se renueva **[condición]**. Cualquiera de las partes puede darlo por terminado con **[30] días** de aviso por escrito. Al terminar:
el Cliente puede **exportar sus datos durante [30] días**; pasado ese plazo, Kairox los elimina o anonimiza, **salvo** los que deba conservar por ley. Kairox puede suspender o terminar el contrato
de inmediato ante incumplimientos graves (uso indebido, falta de pago reiterada).

## 12. Limitación de responsabilidad

En la medida máxima que permita la ley, **Kairox no responde por daños indirectos, lucro cesante ni pérdida de oportunidades**, ni por decisiones tomadas sobre la base de los reportes. La responsabilidad total de
Kairox frente al Cliente por cualquier causa se limita a **[el monto pagado por el Cliente en los últimos 12 meses]**. Esta limitación no aplica a lo que la ley no permita limitar (dolo o culpa grave).

## 13. Modificaciones

Kairox puede modificar estos términos. Los cambios importantes se comunican por correo con **[30] días** de anticipación; si el Cliente no los acepta, puede dar de baja el Servicio en ese plazo.

## 14. Ley aplicable y jurisdicción

Estos términos se rigen por las leyes de la República Argentina. Para cualquier controversia, las partes se someten a los **[Tribunales Ordinarios de la ciudad de ____]**, con renuncia a otro fuero.

## 15. Contacto

**[Razón social]** — **[correo de soporte / legales]** — **[domicilio]**
