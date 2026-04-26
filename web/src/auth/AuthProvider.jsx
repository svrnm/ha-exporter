import { createContext, useCallback, useContext, useEffect, useState } from 'react';

const TOKEN_KEY = 'ha_exporter_token';

const AuthContext = createContext(null);

function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => readToken());

  // Keep tabs in sync: if the user logs out in one tab, the others follow.
  useEffect(() => {
    function onStorage(e) {
      if (e.key === TOKEN_KEY) setToken(e.newValue || '');
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const saveToken = useCallback((next) => {
    try {
      if (next) localStorage.setItem(TOKEN_KEY, next);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      // Private mode / disabled storage — just keep it in memory.
    }
    setToken(next || '');
  }, []);

  const clearToken = useCallback(() => saveToken(''), [saveToken]);

  const value = { token, setToken: saveToken, clearToken, isAuthed: !!token };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
