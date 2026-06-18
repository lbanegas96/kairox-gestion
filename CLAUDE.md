# CLAUDE.md — Instrucciones del proyecto KAIROX Gestión

Este archivo se carga automáticamente en cada sesión de Claude Code sobre este repo.
Contiene la política de seguridad obligatoria (skill `seguridad-dev`) y debe respetarse en TODO código generado, revisado o commiteado.

---

# Seguridad en Desarrollo Web — Kairox IA

**Cuándo aplicar:** SIEMPRE ante cualquier tarea de código nuevo, revisión de código existente, integración con APIs de pago (MercadoPago, Stripe), manejo de datos de usuarios o empresas, configuración de Supabase/RLS, autenticación, variables de entorno, commits a GitHub, deploy a producción, formularios con datos sensibles, endpoints de API, consultas a base de datos, o cualquier función que maneje información financiera o personal. También al preguntar sobre seguridad, privacidad, GDPR, Ley 25.326, datos bancarios, tokens, claves o secretos.

Kairox IA es **responsable legal y técnico** de la seguridad de cada sistema que desarrolla.
Stack principal: **Next.js · React · Supabase · Node.js · FastAPI · Python · MercadoPago · Claude API**
Marco legal aplicable: **Ley 25.326 (Argentina) · GDPR (si hay usuarios europeos)**

---

## ⚠️ Regla de oro

> **Nunca confiar en el cliente. Nunca exponer el servidor. Nunca hardcodear secretos.**

Ante cualquier duda sobre si algo es seguro: **la respuesta es NO hasta que se demuestre que sí.**

---

## 🚨 Datos que JAMÁS deben aparecer en el código

### Financieros / bancarios
```
❌ Números de cuenta bancaria
❌ CBU / CVU / alias bancario
❌ Números de tarjeta de crédito/débito
❌ CVV / CVC
❌ Claves de homebanking
❌ Tokens de acceso a cuentas bancarias
❌ Access tokens de MercadoPago en el frontend
❌ Credenciales de pasarelas de pago hardcodeadas
```

### Personales / identidad
```
❌ DNI / CUIL / CUIT en logs o respuestas de API
❌ Contraseñas en texto plano
❌ Emails en logs públicos
❌ Direcciones físicas en código fuente
❌ Datos de salud o biométricos
```

### Técnicos / infraestructura
```
❌ API keys hardcodeadas (Supabase, Claude, MercadoPago, etc.)
❌ JWT secret en el código
❌ Connection strings de base de datos
❌ Credenciales SSH o certificados
❌ Variables de entorno commiteadas al repo
```

---

## 📁 Variables de entorno — reglas estrictas

### Estructura obligatoria del proyecto
```
.env.local          ← valores reales, NUNCA commitear
.env.example        ← plantilla SIN valores, SÍ commitear
.gitignore          ← debe incluir todos los .env
```

### .gitignore mínimo obligatorio
```gitignore
# Entorno
.env
.env.local
.env.development
.env.production
.env.staging
.env*.local
*.env

# Claves y certificados
*.pem
*.key
*.p12
*.cert
secrets/
credentials/

# Logs que pueden contener datos
*.log
logs/
```

### Naming convention para variables
```bash
# ✅ Correcto — prefijos claros
NEXT_PUBLIC_SUPABASE_URL=       # solo esto puede ser público
SUPABASE_SERVICE_ROLE_KEY=      # NUNCA exponer al frontend
MERCADOPAGO_ACCESS_TOKEN=       # solo backend
MERCADOPAGO_PUBLIC_KEY=         # puede ir al frontend
CLAUDE_API_KEY=                 # solo backend
JWT_SECRET=                     # solo backend
DATABASE_URL=                   # solo backend
```

### Regla crítica Next.js
```
NEXT_PUBLIC_* → va al bundle del cliente → visible para TODOS
Sin prefijo   → solo servidor → seguro para secretos
```
**Nunca poner tokens de pago, service keys o JWT secret con prefijo NEXT_PUBLIC_**

---

## 🏢 Seguridad Multi-tenant (Kairox Gestión)

### RLS en Supabase — obligatorio en TODAS las tablas
```sql
-- Toda tabla con datos de empresa DEBE tener esta política
ALTER TABLE nombre_tabla ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON nombre_tabla
  USING (empresa_id = (auth.jwt() ->> 'empresa_id')::uuid);

-- Nunca hacer queries sin filtro de empresa_id
-- ❌ SELECT * FROM ventas
-- ✅ SELECT * FROM ventas WHERE empresa_id = $empresa_id
```

### Verificación de tenant en cada endpoint
```typescript
// ✅ Patrón obligatorio en cada API route
export async function GET(req: Request) {
  const { empresa_id } = await getAuthContext(req) // siempre verificar
  if (!empresa_id) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Siempre pasar empresa_id al service, nunca confiar en el body
  const data = await ventasService.getAll(empresa_id)
  return Response.json(data)
}
```

### Lo que NUNCA debe pasar entre tenants
```
❌ Un usuario de Empresa A ve datos de Empresa B
❌ empresa_id viene del body del request (puede manipularse)
❌ Queries sin WHERE empresa_id
❌ Logs que mezclan datos de distintas empresas
```

---

## 💳 Seguridad con MercadoPago

### Flujo seguro obligatorio
```
Frontend → solicita preferencia al BACKEND → Backend crea preferencia con SDK →
Backend devuelve solo el preference_id → Frontend usa MP Checkout con ese ID
```

### Lo que NUNCA hacer
```typescript
// ❌ NUNCA — access token en el frontend
const mp = new MercadoPago('APP_USR-xxxxx-token-real') // expuesto a todos

// ❌ NUNCA — crear preferencias desde el cliente
fetch('https://api.mercadopago.com/checkout/preferences', {
  headers: { Authorization: `Bearer ${process.env.NEXT_PUBLIC_MP_TOKEN}` }
})
```

### Lo que SÍ hacer
```typescript
// ✅ Solo en el servidor (API route de Next.js o FastAPI)
import { MercadoPagoConfig, Preference } from 'mercadopago'

const client = new MercadoPagoConfig({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN // sin NEXT_PUBLIC_
})

// Validar siempre el webhook con la firma
export async function POST(req: Request) {
  const xSignature = req.headers.get('x-signature')
  const isValid = validateMPWebhook(xSignature, process.env.MP_WEBHOOK_SECRET)
  if (!isValid) return Response.json({ error: 'Invalid signature' }, { status: 401 })
}
```

---

## 🔐 Autenticación y sesiones

### JWT — reglas
```typescript
// ✅ Verificar siempre en el servidor
const { data: { user }, error } = await supabase.auth.getUser(token)
if (error || !user) return unauthorized()

// ❌ Nunca confiar en el payload del JWT sin verificar
const payload = JSON.parse(atob(token.split('.')[1])) // INSEGURO
```

### Contraseñas
```
✅ Usar siempre el sistema de auth de Supabase (bcrypt interno)
❌ Nunca hashear manualmente con MD5 o SHA1
❌ Nunca guardar contraseñas en texto plano
❌ Nunca loguear contraseñas ni tokens
```

### Headers de seguridad — Next.js (next.config.js)
```javascript
const securityHeaders = [
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Content-Security-Policy',
    value: "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline';"
  }
]
```

---

## 🛡️ Validación de inputs — obligatorio

### Regla: nunca confiar en datos del usuario
```typescript
// ✅ Siempre validar con Zod antes de usar
import { z } from 'zod'

const TransaccionSchema = z.object({
  monto: z.number().positive().max(999999), // límite razonable
  empresa_id: z.string().uuid(),            // formato estricto
  descripcion: z.string().max(255).trim()   // limitar longitud
})

// En el endpoint
const result = TransaccionSchema.safeParse(body)
if (!result.success) return Response.json({ error: 'Datos inválidos' }, { status: 400 })
```

### SQL Injection — siempre usar parámetros
```typescript
// ❌ NUNCA concatenar strings en queries
const query = `SELECT * FROM usuarios WHERE email = '${email}'`

// ✅ Supabase usa parámetros automáticamente
const { data } = await supabase
  .from('usuarios')
  .select()
  .eq('email', email) // seguro
```

---

## 🔍 Checklist pre-commit obligatorio

Antes de hacer **cualquier commit**, verificar:

```
□ ¿Hay algún .env en los archivos a commitear? → PARAR
□ ¿Hay API keys, tokens o contraseñas hardcodeadas? → PARAR
□ ¿Hay números de cuenta, CBU o datos bancarios? → PARAR
□ ¿Hay DNI, CUIL o datos personales reales en el código? → PARAR
□ ¿Los logs pueden exponer datos sensibles? → REVISAR
□ ¿Está el .gitignore actualizado? → VERIFICAR
□ ¿Los endpoints nuevos validan empresa_id? → VERIFICAR
□ ¿Las tablas nuevas de Supabase tienen RLS activo? → VERIFICAR
```

### Comando para detectar secretos antes del push
```bash
# Escanear archivos actuales
grep -rE "(password|secret|token|key|api_key|access_token)\s*=\s*['\"][^'\"]{8,}" src/

# Escanear historial completo de git
npx trufflesecurity/trufflehog git file://. --since-commit HEAD
```

---

## 📋 Checklist pre-deploy a producción

```
□ Variables de entorno configuradas en Vercel (no en el repo)
□ RLS activo en TODAS las tablas de Supabase con datos de empresas
□ Endpoints de API protegidos con autenticación
□ Webhooks de MercadoPago validando firma
□ Headers de seguridad configurados en next.config.js
□ Sin console.log con datos sensibles en producción
□ Rate limiting en endpoints públicos o de login
□ HTTPS forzado (Vercel lo hace automáticamente)
□ Backup de base de datos configurado en Supabase
```

---

## ⚖️ Ley 25.326 — Protección de Datos Personales (Argentina)

Kairox IA como desarrolladora es **responsable solidario** del tratamiento de datos.

### Obligaciones mínimas
```
✅ Informar al usuario qué datos se recopilan y para qué
✅ No usar datos para fines distintos al declarado
✅ Permitir al usuario solicitar eliminación de sus datos
✅ No compartir datos con terceros sin consentimiento
✅ Guardar datos solo el tiempo necesario
✅ Proteger datos con medidas técnicas razonables (lo que hace esta skill)
```

### En el código
```typescript
// Nunca guardar más datos de los necesarios
// ❌ Guardar toda la respuesta de MercadoPago (puede incluir datos de tarjeta)
await db.pagos.insert({ raw_response: JSON.stringify(mpResponse) })

// ✅ Solo guardar lo necesario
await db.pagos.insert({
  payment_id: mpResponse.id,
  status: mpResponse.status,
  monto: mpResponse.transaction_amount
  // sin datos de tarjeta, sin datos personales innecesarios
})
```

---

## 🚨 Qué hacer si se filtra una clave

1. **Revocarla inmediatamente** desde el panel (Supabase, MercadoPago, Claude, etc.)
2. **Generar una nueva** y actualizarla en Vercel
3. **Limpiar el historial de git** con BFG Repo Cleaner:
   ```bash
   # Instalar BFG
   brew install bfg
   # Limpiar el archivo comprometido del historial
   bfg --delete-files .env
   git reflog expire --expire=now --all && git gc --prune=now --aggressive
   git push --force
   ```
4. **Auditar logs** para ver si alguien accedió con esa clave
5. **Notificar a los usuarios afectados** si correspondiera (Ley 25.326)

---

## 📌 Resumen de responsabilidades Kairox IA

| Área | Responsable | Herramienta |
|------|-------------|-------------|
| Aislamiento de datos por empresa | Nadia/Luciano | Supabase RLS |
| Secretos fuera del repo | Ambos | .gitignore + Vercel env vars |
| Pagos seguros | Nadia | MercadoPago backend-only |
| Validación de inputs | Nadia | Zod |
| Cumplimiento Ley 25.326 | Kairox IA | Políticas de privacidad + código |
| Detección de secretos en commits | Claude Code | pre-commit checks |
