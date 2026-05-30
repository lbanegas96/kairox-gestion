# KAIROX Gestión — Guía de conexión a Supabase nuevo

## Por qué esta guía

El proyecto sufría el error **42P17: infinite recursion detected in policy for relation "profiles"**.
La causa: las RLS policies de todas las tablas hacían un sub-`SELECT` a `profiles` para obtener
`empresa_id`, y la policy de `profiles` también hacía un sub-`SELECT` a `profiles` — bucle infinito.

La solución está en `schema.sql`:
- La policy de `profiles` usa `id = auth.uid()` directamente (sin sub-SELECT).
- Las policies del resto de tablas usan la función `get_my_empresa_id()`, que tiene
  `SECURITY DEFINER` y por tanto ignora RLS al consultar `profiles`.

---

## Pasos para crear un proyecto Supabase nuevo

### 1. Crear el proyecto

1. Entra a [supabase.com](https://supabase.com) → New project.
2. Elige región (recomendado: South America / us-east-1 si estás en Argentina).
3. Guarda la contraseña de la base de datos en un lugar seguro.

---

### 2. Ejecutar el schema

1. En el panel de Supabase ve a **SQL Editor**.
2. Abre el archivo `schema.sql` de este repositorio.
3. Pega **todo** el contenido y haz clic en **Run**.
4. Verifica que no haya errores. Las tablas deben aparecer en **Table Editor**.

> **Nota**: el schema usa `CREATE TABLE IF NOT EXISTS` y `DROP POLICY IF EXISTS`,
> por lo que es idempotente — puedes volver a ejecutarlo sin problema.

---

### 3. Configurar las variables de entorno

1. En el panel de Supabase ve a **Settings → API**.
2. Copia:
   - **Project URL** → `VITE_SUPABASE_URL`
   - **anon public** key → `VITE_SUPABASE_ANON_KEY`
3. En la raíz del proyecto:
   ```bash
   cp .env.example .env.local
   ```
4. Edita `.env.local` y pega los valores copiados.

El archivo `.env.local` **nunca** se sube a Git (está en `.gitignore`).

---

### 4. Crear el primer usuario

1. En Supabase ve a **Authentication → Users → Add user**.
2. Rellena email y contraseña (mínimo 6 caracteres).
3. Haz clic en **Create user**.
4. El trigger `on_auth_user_created` creará automáticamente una fila en `profiles`.

---

### 5. Crear la primera empresa y vincular al usuario

En **SQL Editor** ejecuta (cambia los valores):

```sql
-- 1. Crear la empresa
INSERT INTO public.empresas (nombre)
VALUES ('Nombre de Tu Empresa')
RETURNING id;

-- 2. Copiar el UUID que devuelve el paso anterior y usarlo aquí:
UPDATE public.profiles
SET
  empresa_id = '<UUID_DE_LA_EMPRESA>',
  tenant_id  = id,        -- self-reference histórico
  role       = 'admin',
  first_name = 'Tu',
  last_name  = 'Nombre',
  active     = true
WHERE email = 'tu@email.com';
```

---

### 6. Levantar la app

```bash
npm install
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000) e inicia sesión con el usuario creado.

---

## Añadir usuarios adicionales (staff)

1. Crea el usuario en **Authentication → Users**.
2. Vincula al mismo `empresa_id` del admin:

```sql
UPDATE public.profiles
SET
  empresa_id = '<UUID_DE_LA_EMPRESA>',
  tenant_id  = id,
  role       = 'staff',
  active     = true
WHERE email = 'staff@email.com';
```

Los usuarios `staff` quedan aislados a su empresa por RLS automáticamente.

---

## Estructura de multi-tenancy

| Concepto | Columna | Descripción |
|----------|---------|-------------|
| Aislamiento | `empresa_id` | Todas las tablas tienen esta columna. La RLS filtra por ella. |
| Usuario | `auth.uid()` | UUID del usuario autenticado (viene del JWT). |
| Función helper | `get_my_empresa_id()` | Devuelve `empresa_id` del usuario actual sin activar RLS. |
| Rol | `profiles.role` | `admin` o `staff`. El control fino de permisos se hace en el frontend via `profiles.permissions`. |

---

## Troubleshooting

### Error 42P17 (infinite recursion)
- Confirma que ejecutaste el `schema.sql` completo del repo (no una versión anterior).
- En **SQL Editor** ejecuta: `SELECT * FROM pg_policies WHERE tablename = 'profiles';`
  y verifica que sólo existe la policy `profiles_select` que usa `id = auth.uid()`.

### Error "relation profiles does not exist"
- El trigger `handle_new_user` no creó el perfil. Ejecútalo manualmente:
  ```sql
  INSERT INTO public.profiles (id, email, role)
  VALUES ('<UUID_DEL_USUARIO>', 'email@ejemplo.com', 'admin');
  ```

### Variables de entorno no reconocidas
- Vite sólo expone variables que empiezan con `VITE_`.
- Asegúrate de que el archivo se llama `.env.local` (no `.env`).
- Reinicia `npm run dev` después de editar el archivo.
