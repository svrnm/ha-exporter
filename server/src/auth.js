import crypto from 'node:crypto';

/**
 * Build a bearer-token middleware. The token is read from the environment at
 * factory time so tests and `server.js` can swap it out cleanly.
 *
 * @param {string} token
 */
export function bearerAuth(token) {
  if (!token) {
    throw new Error(
      'HA_EXPORTER_TOKEN is not set. Refusing to start without an auth token.',
    );
  }
  const expected = Buffer.from(token, 'utf8');

  return function authMiddleware(req, res, next) {
    const header = req.get('authorization') ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) {
      return res.status(401).json({ error: 'missing_bearer' });
    }
    const provided = Buffer.from(match[1].trim(), 'utf8');
    if (
      provided.length !== expected.length ||
      !crypto.timingSafeEqual(provided, expected)
    ) {
      return res.status(401).json({ error: 'invalid_token' });
    }
    next();
  };
}
