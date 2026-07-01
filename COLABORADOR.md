# KAIROX Gestión — Guía de Incorporación para Colaboradores

> Leé este archivo antes de empezar. Está pensado para ser leído por Claude al inicio de cada sesión colaborativa.

---

## 1. ¿Qué es este proyecto?

**KAIROX Gestión** es un ERP/POS SaaS para PyMEs argentinas, construido con:
- **Frontend:** React 18 + Vite + TailwindCSS + Shadcn/UI
- **Backend:** Supabase (PostgreSQL + Auth + RLS + Edge Functions)
- **Deploy:** Vercel (auto-deploy desde `master`)
- **Repo:** https://github.com/lbanegas96/kairox-gestion
- **Producción:** https://kairox-gestion.vercel.app

El archivo **`CONTEXT.md`** en la raíz del repo es la memoria viva del proyecto — contiene el estado actual de todos los módulos, migraciones aplicadas, convenciones y roadmap. **Leerlo es el primer paso de cualquier sesión.**

---

## 2. Setup inicial (primera vez)

### Clonar el repositorio
```bash
git clone https://github.com/lbanegas96/kairox-gestion.git
cd kairox-gestion
npm install
```

### Crear el archivo `.env.local`
Crear un archivo `.env.local` en la raíz con las siguientes variables (pedírselas al owner del proyecto):

```env
VITE_SUPABASE_URL=https://wuznppxeonmhfcvnqfbf.supabase.co
VITE_SUPABASE_ANON_KEY=<pedirla al owner>
```

> ⚠️ Nunca commitear `.env.local` — ya está en `.gitignore`.

### Levantar en local
```bash
npm run dev
```
La app corre en `http://localhost:3000`. Se conecta a la misma base de datos de producción (Supabase compartido).

---

## 3. Arquitectura rápida

```
src/
├── components/
│   ├── sections/     ← Módulos principales (Ventas, Caja, Clientes, etc.)
│   ├── ventas/       ← Modales de venta y comprobantes
│   ├── reportes/     ← Reportes especiales (Paridad ARS/USD, etc.)
│   ├── ui/           ← Componentes reutilizables (MonedaSelector, TipoCambioModal, etc.)
│   └── portals/      ← Portales Fiori (Ventas, Compras, Finanzas, Inventario)
├── hooks/            ← useTCParalelo, useNotifications, useUserPermissions
├── services/         ← Lógica de negocio + queries Supabase
├── contexts/         ← Auth, Caja, Config, Theme
└── lib/              ← dateUtils, currencyUtils, validationUtils, customSupabaseClient
```

**Regla crítica:** todas las queries deben filtrar `.eq('empresa_id', user.empresa_id)` — nunca `user_id` para filtrar.

---

## 4. Flujo de trabajo colaborativo

### Siempre trabajar en branches
```bash
git checkout -b feature/nombre-descriptivo
# o
git checkout -b fix/descripcion-del-bug
```

### Nunca pushear directo a master sin revisar
```bash
git add <archivos específicos>
git commit -m "tipo: descripción breve"
git push origin feature/nombre-descriptivo
```

### Merge a master = deploy automático a producción
Cuando el feature/fix está listo y probado:
```bash
git checkout master
git pull origin master
git merge feature/nombre-descriptivo
git push origin master
# Vercel auto-despliega en ~30 segundos
```

### Al terminar cada sesión: actualizar CONTEXT.md
Es obligatorio actualizar `CONTEXT.md` al final de cada sesión con:
- Qué archivos se crearon/modificaron
- Qué migraciones se aplicaron en Supabase
- Nuevas convenciones si las hay
- Estado del roadmap actualizado
- Entrada en el historial de sesiones

---

## 5. Base de datos (Supabase)

- **URL:** `https://wuznppxeonmhfcvnqfbf.supabase.co`
- **Proyecto:** `wuznppxeonmhfcvnqfbf` (org: NALUX)
- **Multi-tenancy:** RLS via `get_my_empresa_id()` — cada tabla tiene `empresa_id`
- **Migraciones:** documentadas en `CONTEXT.md` — todas son idempotentes (`IF NOT EXISTS`, `DROP POLICY IF EXISTS`)
- **Fecha local Argentina:** usar `new Date().toLocaleDateString('en-CA')` para YYYY-MM-DD (NO `toISOString()` que da UTC)

Para aplicar una migración nueva: ejecutar el SQL directamente en **Supabase Dashboard → SQL Editor**.

---

## 6. Convenciones importantes (resumen)

| Regla | Detalle |
|---|---|
| Filtro tenant | `.eq('empresa_id', user.empresa_id)` en TODAS las queries |
| INSERT | Incluir siempre `empresa_id` + `user_id` |
| Fechas | Usar `getNowAR()` / `formatDateAR()` de `dateUtils.js` |
| Supabase client | Importar de `@/lib/customSupabaseClient` (lazy, evita TDZ) |
| Radix Dialogs | Nunca `if (!open) return null` — usar prop `open` |
| Migrations | Siempre idempotentes |
| Vistas SQL | Siempre `WITH (security_invoker = true)` |
| PGRST116 | Error "no rows" de Supabase es ESPERADO — no es un error real |

Ver lista completa en `CONTEXT.md` → sección "Convenciones (REGLAS DE ORO)".

---

## 7. MCP Supabase en Claude (opcional pero recomendado)

Si tu sesión de Claude tiene el conector MCP de Supabase configurado, podés ejecutar SQL y consultar tablas directamente desde Claude. Asegurate de que el conector esté apuntando al proyecto `wuznppxeonmhfcvnqfbf` (org NALUX).

Si no aparece ese proyecto: claude.ai → Conectores → Supabase → reconectar con la cuenta NALUX.

---

## 8. Checklist de inicio de sesión

- [ ] Leer `CONTEXT.md` completo (especialmente módulos, migraciones y roadmap)
- [ ] Hacer `git pull origin master` para tener el código más reciente
- [ ] Verificar que `.env.local` tiene las keys correctas
- [ ] `npm run dev` → confirmar que levanta sin errores
- [ ] Abrir https://kairox-gestion.vercel.app para ver el estado de producción
- [ ] Identificar la tarea a trabajar y crear branch correspondiente

---

## 9. Contacto / Owner

- **GitHub:** lbanegas96
- **Email:** iakairox1@gmail.com
- **Producción:** https://kairox-gestion.vercel.app
