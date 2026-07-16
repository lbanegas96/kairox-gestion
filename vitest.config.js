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
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
