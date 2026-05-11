# Diagnosis Report: Argentina Timezone & Tenant Isolation

## 1. Date Utilities (`src/lib/dateUtils.js`)
- **Status:** ✅ **Implemented & Correct**
- **Verification:** The function `getNowAR()` exists and correctly applies a -3 hour offset (UTC-3) to the current UTC time.
- **Functions Present:**
  - `getNowAR()`
  - `getTodayAR()`
  - `getStartOfDayAR(date)`
  - `getEndOfDayAR(date)`
  - `getDateFromInputAR(dateString)`
- **Observation:** This implementation effectively forces "Local Argentina Time" into the database ISO strings.

## 2. Auth Context (`src/contexts/SupabaseAuthContext.jsx`)
- **Status:** ✅ **Implemented & Correct**
- **Logic Verification:**
  - The `handleSession` function correctly identifies the `effectiveTenantId`.
  - Logic: `const effectiveTenantId = profileData?.tenant_id || currentSession.user.id;`
  - If user is **Admin**: `profile.tenant_id` is null (usually), so it falls back to `currentSession.user.id`. Correct.
  - If user is **Staff**: `profile.tenant_id` should be set, so it uses that. Correct.
  - The `user` object in context is updated with `tenant_id`, making it available throughout the app.

## 3. User Creation (`src/components/sections/UsuariosSection.jsx`)
- **Status:** ❌ **CRITICAL FAILURE**
- **The Bug:**
  - The code generates a fake ID: `const newId = window.crypto.randomUUID();`
  - It inserts directly into the `profiles` table: `supabase.from('profiles').insert([...])`
  - **Missing Step:** It **NEVER** calls `supabase.auth.signUp()`.
- **Consequence:** The user appears in the "Usuarios" list in the UI, but **does not exist in the Supabase Auth system**. They cannot log in. There is no password hash stored in Supabase Auth, only a text hash in the profile (which Auth doesn't use).
- **Tenant Assignment:** The `tenant_id` assignment in the profile insert (`tenant_id: user.tenant_id`) is actually **correct** code-wise, but useless since the user is invalid.

## 4. INSERT Operations (Tenant ID Check)
- **VentasSection:** ✅ Uses `user.tenant_id`.
- **ProductosSection:** ✅ Uses `user.tenant_id`.
- **CajaSection:** ❌ **BROKEN**. Uses `user_id: user.id`.
  - *Impact:* Staff members trying to insert cash movements will likely fail RLS policies (which expect `user_id` to match the Tenant/Admin ID) or create orphaned records invisible to the Admin.
- **ClientesSection:** ❌ **BROKEN**. Uses `user_id: user.id`.
- **ComprasSection:** ❌ **BROKEN**. Uses `user_id: user.id`.
- **CuentaCorrienteSection:** (Not fully visible in last snippet, but likely follows the broken pattern).

## 5. SELECT Queries (Tenant ID Filter)
- **Dashboard / Ventas / Productos:** ✅ Correctly filter by `user.tenant_id`.
- **CajaSection:** ❌ Filters by `.eq('user_id', user.id)`. Staff will not see the shop's movements, only their own (if successful).
- **Clientes / Compras:** ⚠️ Rely heavily on RLS. If RLS is set to `user_id = get_current_tenant_id()`, the query might technically work for reading, but the lack of explicit filter in the query is inconsistent with other sections.

## 6. Database / RLS Diagnosis
- **Constraint Violation Risk:**
  - The RLS policy `Tenant Isolation Policy ... USING (user_id = get_current_tenant_id())` is strict.
  - When Staff (ID: B) tries to insert a Client with `user_id: B`, the Policy checks: Does `B` == `get_current_tenant_id()` (which returns Admin ID: A)?
  - Result: `B != A`. **INSERT DENIED**.
- **Conclusion:** Staff users currently cannot create Clients, Purchases, or Cash Movements due to RLS blocking the incorrect `user_id`.

## 7. Summary
- **What's Working:** Date helpers, Auth Context logic, Dashboard metrics, Product creation (Admin), Sales recording (Admin).
- **What's Broken:** 
  1. Creating new staff users (Major).
  2. Staff permissions/visibility in Caja, Clientes, and Compras (RLS Block).
- **Next Steps Required:**
  1. Refactor `UsuariosSection` to use a backend function or proper Auth API to create users.
  2. Update `Caja`, `Clientes`, `Compras` to use `user.tenant_id` for inserts and filters.