# Procedimiento: derechos de los titulares y baja de datos — KAIROX Gestión

Auditoría 24/09/2026, hallazgo **OPE-4**. Es el procedimiento interno (para Kairox y para las empresas clientes) cuando una persona pide **ver, corregir o borrar
sus datos personales**, y qué hacer si hay un **incidente de seguridad**. Los plazos son los de la Ley 25.326. **Borrador: que lo revise un abogado.**

---

## 1. Quién atiende cada pedido

| La persona pide sobre… | Responsable de contestar | Papel de Kairox |
|---|---|---|
| Sus datos como **cliente o proveedor de una empresa** que usa KAIROX Gestión (nombre, documento, teléfono, correo, domicilio, operaciones) | **La empresa** | Encargado: la ayuda a ubicar y modificar los datos. Si el pedido llega a Kairox, se **deriva a la empresa** en 2 días hábiles y se avisa a la persona |
| Su **cuenta de usuario** (correo, nombre, accesos, IP en los registros) o los datos de la **empresa contratante** | **Kairox** | Contesta directamente |

## 2. Plazos (Ley 25.326)

| Derecho | Plazo | Costo |
|---|---|---|
| **Acceso** (art. 14) | **10 días corridos** desde el pedido | Gratuito a intervalos no inferiores a 6 meses |
| **Rectificación, actualización o supresión** (art. 16) | **5 días hábiles** | Gratuito |

Si vence el plazo sin respuesta, la persona puede reclamar ante la **AAIP** (Agencia de Acceso a la Información Pública). Por eso: **registrar la fecha de cada pedido el mismo día**.

## 3. Pasos

1. **Recibir y registrar** el pedido (planilla de la sección 7): fecha, quién, qué pide, por qué canal.
2. **Verificar la identidad** (copia del documento; para un usuario, que escriba desde el correo de su cuenta). No entregar datos a quien no se pueda identificar.
3. **Ubicar los datos** (sección 4).
4. **Resolver** según el derecho:
   - *Acceso:* entregar un resumen claro de qué datos hay, de dónde salieron y para qué se usan (no hace falta exportar tablas enteras).
   - *Rectificación:* corregir el dato en el sistema y dejar constancia.
   - *Supresión:* ver la sección 5 (hay datos que la ley obliga a conservar).
5. **Contestar por escrito** dentro del plazo, aunque la respuesta sea "no corresponde" (explicando por qué).
6. **Cerrar el registro** con la fecha y lo que se hizo.

## 4. Dónde están los datos personales

| Dato | Tabla / lugar | Campos |
|---|---|---|
| Clientes de una empresa | `clientes` | `nombre`, `documento`, `telefono`, `email`, `direccion` |
| Proveedores de una empresa | `proveedores` | `nombre`, `razon_social`, `cuit`, `contacto`, `telefono`, `email`, `direccion` |
| Domicilios de entrega | `entregas`, direcciones de socios de negocio | `destino_direccion` y similares |
| Usuarios de una empresa | `profiles` y `auth.users` | correo, nombre, rol, permisos |
| Registro de cambios | `audit_log` | `ip_address`, `user_id`, **y copias completas de la fila** en `old_data` / `new_data`. Hoy se auditan, entre otras, `clientes` (con correo y teléfono) y `profiles` (con el correo); `proveedores` no |
| Comprobantes fiscales, asientos, cuentas corrientes | `comprobantes`, `comprobante_items`, `asientos_contables`, `cuenta_corriente_*` | el nombre/documento que figura en el comprobante |
| Retenciones | `retenciones` | `contraparte_cuit` |
| Cuentas bancarias de la empresa | `cuentas_bancarias` | `cbu_alias` (dato de la empresa) |
| Programa de fidelización | tablas de puntos por cliente | vinculadas a `clientes` |

Consultas de solo lectura para ubicar a una persona (las ejecuta quien administra la plataforma, no un usuario común):

```sql
-- Como cliente o proveedor (buscar por correo o por documento/CUIT)
SELECT 'cliente' AS tipo, id, empresa_id, nombre FROM public.clientes
 WHERE lower(email) = lower('persona@ejemplo.com') OR documento = '20123456789';
SELECT 'proveedor' AS tipo, id, empresa_id, nombre FROM public.proveedores
 WHERE lower(email) = lower('persona@ejemplo.com') OR cuit = '20123456789';

-- Como usuario del sistema
SELECT id, empresa_id, email FROM public.profiles WHERE lower(email) = lower('persona@ejemplo.com');

-- Cuántos registros de auditoría (con IP) hay sobre una persona / un registro
SELECT count(*) FROM public.audit_log WHERE user_id = '<uuid del usuario>';
SELECT count(*) FROM public.audit_log WHERE registro_id = '<uuid del cliente o proveedor>';
```

## 5. Supresión: qué se puede borrar y qué no

- **Se debe conservar** la documentación contable y fiscal (comprobantes emitidos y recibidos, asientos, libros): la ley obliga a guardarla por
  **[10 años — confirmar con el contador]**. En esos documentos el nombre y el CUIT de la contraparte **no se pueden borrar**.
- **Sí se puede** anonimizar la **ficha** del cliente o proveedor que ya no se usa (`clientes` / `proveedores`): quitar teléfono, correo, domicilio y
  reemplazar el nombre, **sin borrar la fila** (la fila sostiene los comprobantes y saldos). Plantilla (revisar antes de ejecutar, siempre dentro de una transacción):

  ```sql
  BEGIN;
  UPDATE public.clientes
     SET nombre = 'Cliente anonimizado', documento = NULL, telefono = NULL, email = NULL, direccion = NULL
   WHERE id = '<cliente_id>' AND empresa_id = '<empresa_id>';
  -- Verificar el resultado y recién entonces COMMIT (si algo no cierra: ROLLBACK).
  ```

  Antes de anonimizar: revisar restricciones (por ejemplo `documento` único), programas de fidelización y domicilios de entrega asociados.
- **Ojo con `audit_log`:** guarda una **copia completa** de cada fila que cambia en `clientes` y `profiles` (`old_data` / `new_data`). Si solo se anonimiza la ficha, **los datos viejos siguen en el registro de auditoría** (hoy hay unas 320 entradas de `clientes` con correo y teléfono, y unas 2.900 de `profiles`, de las cuales 2.880 son solo el cambio de `last_login_at` al iniciar sesión).
  Una supresión real debe **incluir esas copias** (reemplazar los campos personales dentro del JSON de las entradas de ese registro), y como el registro de auditoría es una evidencia,
  el criterio (anonimizar el contenido conservando quién/cuándo cambió) lo define el abogado. Si estos pedidos se vuelven frecuentes, conviene construir una función del sistema
  (`anonimizar_cliente`) que haga todo en un solo paso, con permiso de administrador y con test.
- **Usuarios:** dar de baja la cuenta (`delete-user`) elimina el acceso; los registros de auditoría conservan el identificador interno del usuario (no el nombre).

## 6. Incidente de seguridad (filtración de claves o de datos)

1. **Contener:** revocar la clave o el acceso comprometido (pasos en `docs/operacion/PLAN_DE_RECUPERACION.md`, sección 7).
2. **Evaluar el alcance:** qué datos, de qué empresas, desde cuándo (registros de Supabase y `audit_log`).
3. **Avisar** a la empresa afectada **sin demora** (Kairox es su encargado). Recomendable también a los titulares y a la AAIP; **el abogado decide** cuándo es obligatorio.
4. **Documentar:** qué pasó, cuándo se detectó, qué se hizo, qué se cambió para que no se repita.

## 7. Registro de pedidos

| Fecha de recepción | Quién (identificado) | Derecho pedido | Empresa | Vence | Resolución | Fecha de respuesta |
|---|---|---|---|---|---|---|
| _(ninguno todavía)_ | | | | | | |
