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
        // Un solo chunk vendor para TODOS los node_modules.
        // Evita tanto TDZ cross-chunk como múltiples instancias de React.
        //
        // Excepción: exceljs (18/09, export de Estado de Resultados/Balance
        // General) — es una librería hoja, sin dependencia de React, que solo
        // se importa dinámicamente (`await import('exceljs')`) desde 2
        // pantallas puntuales. Meterla en "vendor" la volvía elegible para
        // ese chunk igual, así que se descargaba entera (~940KB) en CADA
        // carga de la app para TODOS los usuarios, no solo al exportar.
        // Separarla en su propio chunk no reintroduce el problema de TDZ/
        // múltiples instancias de React que motivó la regla de arriba,
        // porque no es React ni tiene ciclos con el resto del vendor.
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('exceljs')) return 'exceljs';
            return 'vendor';
          }
        },
      },
    },
  },
});
