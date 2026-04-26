import crypto from 'node:crypto';

const SHA256_PREFIX = 'sha256$';

/**
 * @param {string} s
 */
function isSha256Fingerprint(s) {
  if (!s.startsWith(SHA256_PREFIX)) return false;
  const hex = s.slice(SHA256_PREFIX.length);
  return /^[a-f0-9]{64}$/i.test(hex);
}

/**
 * One-way SHA-256 fingerprint for .env (fast verify; use with high-entropy random tokens).
 *
 * @param {string} plainToken
 */
export function fingerprintTokenSha256(plainToken) {
  const d = crypto.createHash('sha256').update(plainToken, 'utf8').digest('hex');
  return `${SHA256_PREFIX}${d}`;
}

/**
 * Plaintext timing-safe compare, or SHA-256 fingerprint (`sha256$` + 64 hex).
 *
 * @param {string} stored From env (trimmed).
 * @param {Buffer} providedBuf Raw bearer secret bytes (UTF-8).
 */
export function verifyStoredToken(stored, providedBuf) {
  if (!stored) return false;

  if (isSha256Fingerprint(stored)) {
    const hex = stored.slice(SHA256_PREFIX.length).toLowerCase();
    const expected = Buffer.from(hex, 'hex');
    const digest = crypto.createHash('sha256').update(providedBuf).digest();
    if (digest.length !== expected.length) return false;
    return crypto.timingSafeEqual(digest, expected);
  }

  const expected = Buffer.from(stored, 'utf8');
  if (providedBuf.length !== expected.length) return false;
  return crypto.timingSafeEqual(providedBuf, expected);
}
