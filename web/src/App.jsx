import { Routes, Route, Navigate } from 'react-router';

import { Login } from './auth/Login.jsx';
import { RequireAuth } from './auth/RequireAuth.jsx';
import { TokenFromUrl } from './auth/TokenFromUrl.jsx';
import { AppShell } from './layout/AppShell.jsx';
import { Summary } from './pages/Summary.jsx';
import { Electricity } from './pages/Electricity.jsx';
import { Gas } from './pages/Gas.jsx';
import { Now } from './pages/Now.jsx';

export function App() {
  return (
    <Routes>
      <Route path="/token" element={<TokenFromUrl />} />
      <Route path="/token/*" element={<TokenFromUrl />} />
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<Summary />} />
        <Route path="electricity" element={<Electricity />} />
        <Route path="gas" element={<Gas />} />
        <Route path="now" element={<Now />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
