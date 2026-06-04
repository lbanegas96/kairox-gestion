import React from 'react';
import ReactDOM from 'react-dom/client';

// ─── Suprimir console.* en producción para evitar fuga de datos ──────────────
if (!import.meta.env.DEV) {
  const noop = () => {};
  console.log   = noop;
  console.warn  = noop;
  console.info  = noop;
  // console.error se mantiene para monitoreo (silenciado por filtros de prod si se usa Sentry)
}
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import App from '@/App';
import '@/index.css';
import { AuthProvider } from '@/contexts/SupabaseAuthContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { ConfigProvider } from '@/contexts/ConfigContext';
import { Toaster } from '@/components/ui/toaster';
import { queryClient } from '@/lib/queryClient';

ReactDOM.createRoot(document.getElementById('root')).render(
  <>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ConfigProvider>
          <ThemeProvider>
            <App />
            <Toaster />
          </ThemeProvider>
        </ConfigProvider>
      </AuthProvider>
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  </>
);