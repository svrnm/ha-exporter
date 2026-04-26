// Tiny fetch wrapper that attaches the bearer token and normalises errors.
// Kept in one place so `api/hooks.js` stays declarative.

export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export function createClient({ getToken, onUnauthorized }) {
  async function request(path, { method = 'GET', body, signal, query } = {}) {
    const headers = { Accept: 'application/json' };
    const token = getToken?.();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const url = buildUrl(path, query);

    let res;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      throw new ApiError(0, err?.message || 'network_error');
    }

    const text = await res.text();
    let parsed = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!res.ok) {
      if (res.status === 401) onUnauthorized?.();
      const message =
        (parsed && typeof parsed === 'object' && parsed.error) ||
        res.statusText ||
        `http_${res.status}`;
      throw new ApiError(res.status, message, parsed);
    }

    return parsed;
  }

  return { request };
}

function buildUrl(path, query) {
  if (!query) return path;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    qs.set(key, String(value));
  }
  const q = qs.toString();
  return q ? `${path}?${q}` : path;
}
