import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Faltan variables de entorno VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY. Copia .env.example como .env.local y rellena los valores.');
}

// ─── Lazy singleton ────────────────────────────────────────────────────────────
// El cliente se crea SOLO cuando se accede por primera vez (desde un componente
// o hook, nunca en tiempo de inicialización de módulo). Esto evita que el
// BroadcastChannel de Supabase se registre durante la inicialización del bundle
// de Rollup/Vite, lo que causaba TDZ ReferenceErrors en producción.
let _instance = null;

function getInstance() {
  if (!_instance) {
    _instance = createClient(supabaseUrl, supabaseAnonKey);
  }
  return _instance;
}

// Proxy transparente — cualquier acceso a `supabase.anything` delega al cliente real.
const _proxy = new Proxy(Object.create(null), {
  get(_, prop) {
    const client = getInstance();
    const value = client[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  },
  has(_, prop) {
    return prop in getInstance();
  },
});

export default _proxy;
export { _proxy as customSupabaseClient, _proxy as supabase };
