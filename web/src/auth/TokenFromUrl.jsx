import { useLayoutEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from './AuthProvider.jsx';

/**
 * @param {string} pathname
 * @returns {string | null} path segment after /token, or `null` if not a /token URL
 */
function pathAfterToken(pathname) {
  if (pathname === '/token' || pathname === '/token/') return '';
  const m = /^\/token\/(.+)$/.exec(pathname);
  return m ? m[1] : null;
}

function decodeTokenSegment(s) {
  if (!s) return '';
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * `https://<host>/token/<auth_token>` stores the read token like the login
 * form (localStorage) and immediately redirects to the
 * app root, so the token is not left in the address bar. Use a URL-encoded path segment
 * for tokens with special characters; the reserved slash is supported via
 * `…/token/<before>%2F<after>` (one path segment) or a catch-all if your host
 * allows it. Tokens containing `/` as separate path segments: use
 * percent-encoding in a single segment when possible.
 */
export function TokenFromUrl() {
  const { pathname } = useLocation();
  const { setToken } = useAuth();
  const [redirect, setRedirect] = useState(false);

  useLayoutEffect(() => {
    const raw = pathAfterToken(pathname);
    if (raw !== null && raw !== '') {
      const t = decodeTokenSegment(raw);
      if (t) {
        flushSync(() => {
          setToken(t);
        });
      }
    }
    setRedirect(true);
  }, [pathname, setToken]);

  if (!redirect) return null;
  return <Navigate to="/" replace />;
}
