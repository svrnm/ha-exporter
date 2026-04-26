import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';

import i18n from './i18n.js';
import { ColorSchemeProvider } from './ColorSchemeProvider.jsx';
import { AuthProvider } from './auth/AuthProvider.jsx';
import { ApiProvider } from './api/ApiContext.jsx';
import { App } from './App.jsx';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, err) => {
        if (err?.status === 401 || err?.status === 404) return false;
        return failureCount < 2;
      },
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <ColorSchemeProvider>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <AuthProvider>
              <ApiProvider>
                <App />
              </ApiProvider>
            </AuthProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </ColorSchemeProvider>
    </I18nextProvider>
  </StrictMode>,
);
