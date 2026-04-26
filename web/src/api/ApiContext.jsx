import { createContext, useContext, useMemo } from 'react';
import { createClient } from './client.js';
import { useAuth } from '../auth/AuthProvider.jsx';

const ApiContext = createContext(null);

export function ApiProvider({ children }) {
  const { token, clearToken } = useAuth();

  const api = useMemo(
    () =>
      createClient({
        getToken: () => token,
        onUnauthorized: () => clearToken(),
      }),
    [token, clearToken],
  );

  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}

export function useApi() {
  const api = useContext(ApiContext);
  if (!api) throw new Error('useApi must be used inside <ApiProvider>');
  return api;
}
