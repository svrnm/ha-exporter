import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';

import { createAppTheme } from './theme.js';

const STORAGE_KEY = 'ha-exporter-color-scheme';

const ColorSchemeContext = createContext({
  preference: 'system',
  setPreference: () => {},
  resolvedMode: 'dark',
});

function readStoredPreference() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* ignore */
  }
  return 'system';
}

function readSystemIsDark() {
  if (typeof window === 'undefined') return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function ColorSchemeProvider({ children }) {
  const [preference, setPreferenceState] = useState(() => readStoredPreference());
  const [systemIsDark, setSystemIsDark] = useState(() => readSystemIsDark());

  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemIsDark(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  const setPreference = (v) => {
    setPreferenceState(v);
    try {
      localStorage.setItem(STORAGE_KEY, v);
    } catch {
      /* ignore */
    }
  };

  const resolvedMode =
    preference === 'system' ? (systemIsDark ? 'dark' : 'light') : preference;

  const theme = useMemo(() => createAppTheme(resolvedMode), [resolvedMode]);

  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', resolvedMode === 'dark' ? '#111418' : '#f5f6fa');
    }
  }, [resolvedMode]);

  const value = useMemo(
    () => ({ preference, setPreference, resolvedMode }),
    [preference, resolvedMode],
  );

  return (
    <ColorSchemeContext.Provider value={value}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ColorSchemeContext.Provider>
  );
}

export function useColorSchemePreference() {
  return useContext(ColorSchemeContext);
}
