import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '@/App';
import '@/index.css';
import { AuthProvider } from '@/contexts/SupabaseAuthContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { ConfigProvider } from '@/contexts/ConfigContext';
import { Toaster } from '@/components/ui/toaster';

ReactDOM.createRoot(document.getElementById('root')).render(
  <>
    <AuthProvider>
      <ConfigProvider>
        <ThemeProvider>
          <App />
          <Toaster />
        </ThemeProvider>
      </ConfigProvider>
    </AuthProvider>
  </>
);