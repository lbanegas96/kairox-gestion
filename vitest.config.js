import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Config separada de vite.config.js a propósito: ese archivo trae plugins
// específicos de la plataforma (visual editor, error overlays inyectados en el
// HTML) que no aplican ni hacen falta para correr tests con Vitest. Solo se
// replica acá el alias '@' -> src, que es lo único que los hooks importan.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // customSupabaseClient.js tira si faltan estas 2 env vars (guard real, a
  // propósito). En CI no existe .env.local (nunca se commitea, correcto) y
  // localmente puede no existir tampoco para quien clona el repo. Ningún test
  // hace una llamada de red real a Supabase — los que tocan el cliente lo
  // mockean entero con vi.mock — así que un placeholder acá es seguro y
  // evita depender de secrets configurados en CI. Esto NO afecta el build de
  // producción real: vitest.config.js es un archivo aparte de vite.config.js.
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://localhost:54321'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('test-placeholder-anon-key'),
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
