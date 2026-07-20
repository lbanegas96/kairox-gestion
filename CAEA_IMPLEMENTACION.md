# CAEA — Implementación KAIROX Gestión

## ¿Qué es CAEA?

El **Código de Autorización Electrónica Anticipado (CAEA)** permite emitir facturas electrónicas sin conexión a internet, ni siquiera a AFIP/ARCA. El comercio solicita el código ANTES de que empiece la quincena, lo guarda localmente, y lo usa para imprimir en los comprobantes. Al cierre de la quincena, informa a AFIP qué emitió (o declara que no usó nada).

**Diferencia clave con CAE:**
- **CAE**: cada comprobante requiere conexión a AFIP en el momento de emitir (online)
- **CAEA**: el código se obtiene una vez por quincena, luego se puede facturar sin internet

---

## Quincenas y fechas de solicitud

| Quincena | Período | Habilitada para solicitar |
|---|---|---|
| 1ra del mes | Días 1 al 15 | A partir del día 27 del mes anterior |
| 2da del mes | Días 16 al último | A partir del día 12 del mismo mes |

**Ejemplo — Julio 2026:**
- El 12/06 se habilita pedir el CAEA para la 2da quincena de junio (16-30/06)
- El 27/06 se habilita pedir el CAEA para la 1ra quincena de julio (1-15/07)

---

## Arquitectura implementada

```
┌─────────────────────────────────────────────────────────────────┐
│                     KAIROX Gestión                              │
│                                                                 │
│  ConfiguracionSection                                           │
│  └── "Solicitar CAEA" → POST /solicitar-caea                   │
│                                                                 │
│  Monitor de Facturación AFIP (comprobante en error/error_definitivo)         │
│  └── "Usar CAEA" → RPC usar_caea_para_comprobante                          │
│                                                                 │
│  ConfiguracionSection                                           │
│  └── "Informar quincena" → POST /informar-caea                 │
└─────────────────────────────────────────────────────────────────┘
         │                      │                    │
         ▼                      ▼                    ▼
   AFIP FECAEASolicitar   DB only (offline)   AFIP FECAEAInformarComprobante
                                              AFIP FECAEASinMovimiento
```

**Entrypoint real (no `usar_caea_en_venta` directo):** el humano usa
`usar_caea_para_comprobante(p_comprobante_id)` desde el Monitor de Facturación
AFIP — resuelve internamente el CAEA vigente, el tipo/doc del cliente y el
próximo número, y recién ahí llama a `usar_caea_en_venta` con los 11
parámetros. Desde la sesión 79 (migration 225), `usar_caea_para_comprobante`
también puede correr como `service_role` sin usuario logueado — la usa el
`arca-worker` (edge function, cron) para autorizar con CAEA automáticamente
cuando ARCA está caído y se agotaron los reintentos de CAE, en vez de dejar
el comprobante trabado en `error_definitivo` (ver `arca-worker/index.ts`,
función `intentarCaeaContingencia`). **Repo-only, sin desplegar todavía** —
falta el trámite de un PdV tipo CAEA en AFIP (ver `CONTEXT.md`).

---

## Tablas de base de datos

### `caea_registros`
Un registro por quincena solicitada. RLS por `empresa_id`.

| Columna | Tipo | Descripción |
|---|---|---|
| `caea` | varchar(14) | El código CAEA de 14 dígitos |
| `periodo` | varchar(6) | YYYYMM |
| `orden` | smallint | 1=primera quincena, 2=segunda |
| `fecha_desde/hasta` | date | Vigencia del CAEA |
| `fecha_tope_inf` | date | Último día para informar |
| `tipo_cbte` | integer | 1=A, 6=B, 11=C |
| `punto_venta` | integer | PdV AFIP |
| `estado` | varchar | `activo` → `informado` o `vencido` |
| `comprobantes_emitidos` | integer | Contador de comprobantes con este CAEA |

### `caea_comprobantes`
Cola de comprobantes offline pendientes de informar a AFIP.

### `comprobantes` (columnas agregadas)
- `modo_autorizacion`: `'CAE'` (default) | `'CAEA'` (emitido offline)
- `caea_registro_id`: FK al registro CAEA usado

### `empresas` (columnas agregadas)
- `afip_usa_caea`: boolean — habilita el modo CAEA para la empresa
- `afip_caea_auto_solicitar`: boolean — (reservado) para auto-solicitud futura

---

## Edge Functions

### `POST /solicitar-caea`
```json
// Request
{ "empresa_id": "uuid" }

// Response OK
{
  "caea": "12345678901234",
  "periodo": "202407",
  "orden": 1,
  "fecha_desde": "2026-07-01",
  "fecha_hasta": "2026-07-15",
  "fecha_tope_inf": "2026-07-20",
  "registro_id": "uuid"
}

// Errores conocidos
{ "error": "El CAEA para esta quincena aún no está habilitado..." }  // muy temprano
{ "error": "CAEA no habilitado para esta empresa" }                  // afip_usa_caea=false
```

### `POST /verificar-caea-vigente`
```json
// Request
{ "empresa_id": "uuid" }

// Response con CAEA
{
  "tiene_caea": true,
  "caea": "12345678901234",
  "fecha_hasta": "2026-07-15",
  "registro_id": "uuid",
  "tipo_cbte": 11,
  "punto_venta": 1,
  "todos": [...]
}

// Response sin CAEA
{ "tiene_caea": false }
```

### `POST /informar-caea`
```json
// Request
{ "empresa_id": "uuid", "caea_registro_id": "uuid" }

// Response
{
  "informados": 5,
  "sin_movimiento": false,
  "errores": []
}
```

### RPC `usar_caea_para_comprobante` (entrypoint real)
Único parámetro: el comprobante debe estar en `cae_estado IN ('error', 'error_definitivo')`.
Resuelve solo el CAEA vigente para el tipo de comprobante, el doc_tipo/doc_nro
del cliente y el próximo número correlativo, y llama a `usar_caea_en_venta`
(interna, no se invoca directo desde afuera salvo por tests).

```sql
SELECT usar_caea_para_comprobante(p_comprobante_id := 'uuid');
-- Response: { "caea": "...", "nro_cbte": 42, "fecha_hasta": "2026-07-15" }
```

Llamable por (a) un usuario humano autenticado con permiso de módulo `ventas`
sobre un comprobante de su propia empresa (desde `MonitorFacturacionAFIP.jsx`),
o (b) `service_role` sin usuario (el `arca-worker`, migration 225) — en ese
caso el chequeo de tenant/permiso se saltea porque no hay JWT de usuario que
verificar, no porque se haya debilitado para nadie más.

---

## Cómo probarlo en homologación AFIP

### Prerrequisitos
1. Empresa con `afip_usa_caea = true`
2. Certificado AFIP en el vault (`afip_cert_{empresa_id}` y `afip_key_{empresa_id}`)
3. El PdV en homologación debe estar habilitado para CAEA (configurar en AFIP test)
4. `afip_ambiente` = `'sandbox'` en la empresa

### Habilitar un PdV para CAEA en homologación
En el portal de pruebas de AFIP (`https://wswhomo.afip.gov.ar`):
1. Ingresar con CUIT del contribuyente de prueba
2. ABM Puntos de Venta → Agregar PdV con tipo **CAEA**
3. Anotar el número de PdV asignado

> **Importante:** Un PdV puede ser CAE o CAEA, no ambos. En prod crear un PdV
> específico para CAEA (ej: PdV 2 para CAEA, PdV 1 para CAE online).

### Paso a paso completo

#### 1. Habilitar CAEA en la empresa
```sql
UPDATE empresas SET afip_usa_caea = true WHERE id = '<empresa_id>';
```

#### 2. Solicitar CAEA
Solo disponible a partir del día 12 (2da quincena) o día 27 (1ra quincena siguiente).
Para probar fuera de fecha, AFIP devuelve error 15008.

```bash
curl -X POST https://wuznppxeonmhfcvnqfbf.supabase.co/functions/v1/solicitar-caea \
  -H "Authorization: Bearer <JWT_ADMIN>" \
  -H "Content-Type: application/json" \
  -d '{"empresa_id": "<uuid>"}'
```

Respuesta esperada: `caea` de 14 dígitos + fechas de vigencia.

#### 3. Verificar vigencia (simular POS offline)
```bash
curl -X POST https://wuznppxeonmhfcvnqfbf.supabase.co/functions/v1/verificar-caea-vigente \
  -H "Authorization: Bearer <JWT_ADMIN>" \
  -H "Content-Type: application/json" \
  -d '{"empresa_id": "<uuid>"}'
```

#### 4. Autorizar con CAEA un comprobante trabado
El comprobante debe existir ya (creado por `crear_venta`, normalmente con
`cae_estado IN ('error', 'error_definitivo')` tras un fallo real o simulado de
ARCA). Vía el entrypoint real:

```sql
-- Deja el comprobante en modo_autorizacion='CAEA', cae_estado='no_aplica'
SELECT usar_caea_para_comprobante(p_comprobante_id := '<comprobante_id>');
```

Manualmente esto es el botón "Usar CAEA" en `MonitorFacturacionAFIP.jsx`. De
forma automática (repo-only, sin desplegar — ver arriba) lo hace el
`arca-worker` como `service_role` cuando se agotan los reintentos de CAE.

#### 5. Informar la quincena
```bash
curl -X POST https://wuznppxeonmhfcvnqfbf.supabase.co/functions/v1/informar-caea \
  -H "Authorization: Bearer <JWT_ADMIN>" \
  -H "Content-Type: application/json" \
  -d '{"empresa_id": "<uuid>", "caea_registro_id": "<uuid>"}'
```

Si hay comprobantes pendientes → llama `FECAEAInformarComprobante`.
Si no hay ninguno → llama `FECAEASinMovimiento` (obligatorio por AFIP).

#### 6. Verificar en DB que quedó informado
```sql
SELECT estado, comprobantes_emitidos FROM caea_registros WHERE id = '<registro_id>';
-- estado = 'informado'

SELECT estado_informado FROM caea_comprobantes WHERE caea_registro_id = '<registro_id>';
-- estado_informado = 'informado'
```

---

## Errores AFIP relevantes

| Código | Descripción | Acción |
|---|---|---|
| 15004 | CAEA ya solicitado para este período | La función lo maneja: consulta el existente via `FECAEAConsultar` |
| 15006 | CAEA ya informado | Verificar `caea_registros.estado = 'informado'` |
| 15008 | No existe CAEA para el período (aún no habilitado) | Esperar a la fecha de habilitación |
| 15009 | CAEA vencido | No se puede usar ni informar; registrar como `vencido` |
| 15010 | PdV no habilitado para CAEA | Configurar el PdV en AFIP como tipo CAEA |

---

## Flujo de estados

```
solicitar-caea
      │
      ▼
caea_registros.estado = 'activo'
      │
      ├── Día <= fecha_hasta: usar_caea_en_venta (N veces)
      │         └── caea_comprobantes += 1 fila (estado_informado='pendiente')
      │
      └── Día >= fecha_hasta: informar-caea
                ├── Con comprobantes → FECAEAInformarComprobante → estado='informado'
                └── Sin comprobantes → FECAEASinMovimiento      → estado='informado'
```

---

## Estado real de cada pieza (actualizado sesión 79)

- ✅ UI en `ConfiguracionSection` → tab Facturación: `CardCAEA.jsx` — "Solicitar" e "Informar" ya implementados.
- ✅ Uso manual desde `MonitorFacturacionAFIP.jsx` — botón "Usar CAEA" sobre un comprobante trabado (llama `usar_caea_para_comprobante`).
- ✅ Job pg_cron para marcar CAEAs como `vencido` al pasar `fecha_hasta` — migration `207_caea_cron_vencimiento.sql`.
- 🟡 Contingencia automática en el `arca-worker` (sin intervención humana) — código listo (migration 225 + `intentarCaeaContingencia`), **repo-only, sin desplegar**: falta el trámite de PdV tipo CAEA en AFIP + probar en homologación. Ver `CONTEXT.md`.
- ❌ Pendiente real: alerta proactiva cuando la quincena está por vencer y hay comprobantes sin informar (no existe todavía, ni UI ni job).

---

## Seguridad

- Las Edge Functions (`solicitar-caea`, `verificar-caea-vigente`, `informar-caea`) requieren `verifyAdmin` (JWT de usuario con role=admin)
- Las tablas tienen RLS con `get_my_empresa_id()` — aislamiento multi-tenant garantizado
- `usar_caea_en_venta` / `usar_caea_para_comprobante` son SECURITY DEFINER con guard de tenant explícito (`empresa_id = get_my_empresa_id()` + `has_module_permission('ventas')`)
- Desde migration 225, ambas aceptan además `service_role` sin usuario (el `arca-worker`) — el guard de tenant/permiso se salta SOLO cuando `auth.role() = 'service_role'`, nunca para un usuario humano; `service_role` solo la tiene el backend, nunca el frontend
- Los certificados AFIP se leen del vault (`vault_secret_read`) — nunca en columnas plain
- `REVOKE ALL ... FROM PUBLIC, anon` — solo `authenticated` (+ `service_role`, que ya bypasea RLS/grants por diseño)
