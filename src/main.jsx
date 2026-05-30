import React from 'react';
import ReactDOM from 'react-dom/client';
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