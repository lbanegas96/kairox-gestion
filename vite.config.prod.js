// vite.config.prod.js — Configuración limpia para build de producción (Vercel)
// Sin plugins de Horizons (dev-only). Sólo lo necesario para el build final.
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    extensions: ['.jsx', '.js', '.tsx', '.ts', '.json'],
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // Función (no objeto) para manualChunks — evita TDZ circular deps.
        // Framer-motion DEBE ir en el mismo chunk que react para no tener
        // referencia cruzada de módulos sin inicializar.
        manualChunks(id) {
          if (id.includes('@supabase') || id.includes('supabase-js')) {
            return 'vendor-supabase';
          }
          if (
            id.includes('react') ||
            id.includes('framer-motion') ||
            id.includes('@emotion') ||
            id.includes('scheduler')
          ) {
            return 'vendor-react';
          }
          if (id.includes('node_modules')) {
            return 'vendor';
          }
        },
      },
    },
  },
});
