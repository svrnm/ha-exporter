import { verifyStoredToken } from './tokenCredential.js';

/**
 * @param {import('express').Response} res
 * @param {string} code
 * @param {string} message
 */
function rejectAuth(req, res, code, message) {
  res.locals.logExtra = { ...(res.locals.logExtra ?? {}), auth: code };
  console.warn(`[server] auth: ${message} (${req.method} ${req.originalUrl})`);
  return res.status(401).json({ error: code });
}

/**
 * @param {import('express').Request} req
 * @returns {Buffer | null}
 */
function bearerPayload(req) {
  const header = req.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return null;
  return Buffer.from(match[1].trim(), 'utf8');
}

/**
 * Write-only operations. The write token may also access read routes.
 *
 * @param {import('express').Request} req
 */
export function isWriteOperation(req) {
  const m = req.method.toUpperCase();
  if (m === 'POST' && req.path.startsWith('/ingest')) return true;
  if (m === 'DELETE' && req.path.startsWith('/instances/')) return true;
  return false;
}

/**
 * `readToken` / `writeToken` are env values: plaintext or `sha256$…` fingerprint.
 * Clients always send the plaintext bearer secret.
 *
 * @param {{ readToken: string, writeToken: string }} opts
 */
export function bearerAuthSplit({ readToken, writeToken }) {
  if (!readToken || !writeToken) {
    throw new Error(
      'Both HA_EXPORTER_READ_TOKEN and HA_EXPORTER_WRITE_TOKEN must be non-empty.',
    );
  }

  return function authMiddleware(req, res, next) {
    const provided = bearerPayload(req);
    if (!provided) {
      return rejectAuth(
        req,
        res,
        'missing_bearer',
        'rejected (no Authorization: Bearer header)',
      );
    }

    if (isWriteOperation(req)) {
      if (verifyStoredToken(writeToken, provided)) return next();
      return rejectAuth(
        req,
        res,
        'invalid_token',
        'rejected write request (bearer does not match HA_EXPORTER_WRITE_TOKEN)',
      );
    }

    if (verifyStoredToken(readToken, provided)) return next();
    if (verifyStoredToken(writeToken, provided)) return next();
    return rejectAuth(
      req,
      res,
      'invalid_token',
      'rejected (bearer does not match HA_EXPORTER_READ_TOKEN or HA_EXPORTER_WRITE_TOKEN)',
    );
  };
}

/**
 * @returns {import('express').RequestHandler}
 */
export function createAuthMiddlewareFromEnv() {
  const read = (process.env.HA_EXPORTER_READ_TOKEN ?? '').trim();
  const write = (process.env.HA_EXPORTER_WRITE_TOKEN ?? '').trim();

  if (!read || !write) {
    throw new Error(
      'Set HA_EXPORTER_READ_TOKEN and HA_EXPORTER_WRITE_TOKEN (both required).',
    );
  }
  if (read === write) {
    console.warn(
      '[server] HA_EXPORTER_READ_TOKEN and HA_EXPORTER_WRITE_TOKEN are identical; use two different secrets.',
    );
  }

  return bearerAuthSplit({ readToken: read, writeToken: write });
}
