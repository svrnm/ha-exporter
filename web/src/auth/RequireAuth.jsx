import { Navigate, useLocation } from 'react-router';
import { useAuth } from './AuthProvider.jsx';

export function RequireAuth({ children }) {
  const { isAuthed } = useAuth();
  const location = useLocation();
  if (!isAuthed) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return children;
}
