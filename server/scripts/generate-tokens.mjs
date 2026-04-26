#!/usr/bin/env node
/**
 * Generate random read/write tokens, store SHA-256 fingerprints in .env, and
 * print the plaintext secrets once (for HA integration + web UI).
 *
 * Usage:
 *   cd server && npm run generate-tokens
 *   node scripts/generate-tokens.mjs --env /path/to/.env
 *
 * Options:
 *   --env <path>   Target file (default: server/.env)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

import { fingerprintTokenSha256 } from '../src/tokenCredential.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  let envPath = path.join(SERVER_ROOT, '.env');
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--env' && argv[i + 1]) {
      envPath = path.resolve(argv[++i]);
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log(
        'Usage: node scripts/generate-tokens.mjs [--env PATH]\n' +
          '  Writes sha256$… fingerprints to HA_EXPORTER_READ_TOKEN / HA_EXPORTER_WRITE_TOKEN.\n' +
          '  Prints plaintext secrets once to stdout.',
      );
      process.exit(0);
    }
  }
  return { envPath };
}

/**
 * @param {string} value
 */
function formatEnvValue(value) {
  const needsQuotes =
    /[\s#"'\\]/.test(value) ||
    value.includes('$') ||
    value.startsWith('`');
  if (!needsQuotes) return value;
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
  return `"${escaped}"`;
}

/**
 * @param {string} raw
 * @param {Record<string, string>} upserts
 */
function upsertDotEnv(raw, upserts) {
  const pending = { ...upserts };
  const lines = raw.length ? raw.split(/\r?\n/) : [];
  const out = [];

  const lineKey = (line) => {
    const m = /^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=/.exec(line);
    return m ? m[1] : null;
  };

  for (const line of lines) {
    const key = lineKey(line);
    if (key && Object.prototype.hasOwnProperty.call(pending, key)) {
      out.push(`${key}=${formatEnvValue(pending[key])}`);
      delete pending[key];
    } else {
      out.push(line);
    }
  }

  for (const [key, val] of Object.entries(pending)) {
    out.push(`${key}=${formatEnvValue(val)}`);
  }

  if (out.length && out[out.length - 1] !== '') out.push('');
  return out.join('\n');
}

function main() {
  const { envPath } = parseArgs(process.argv);

  const readPlain = crypto.randomBytes(32).toString('hex');
  const writePlain = crypto.randomBytes(32).toString('hex');

  const readStored = fingerprintTokenSha256(readPlain);
  const writeStored = fingerprintTokenSha256(writePlain);

  let previous = '';
  try {
    previous = fs.readFileSync(envPath, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const next = upsertDotEnv(previous, {
    HA_EXPORTER_READ_TOKEN: readStored,
    HA_EXPORTER_WRITE_TOKEN: writeStored,
  });

  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.writeFileSync(envPath, next, 'utf8');

  console.log(`Updated ${envPath} with SHA-256 fingerprints (sha256$…).\n`);
  console.log('--- Plaintext (copy now; they are not stored in .env) ---\n');
  console.log(`HA_EXPORTER_READ_TOKEN (web UI / invite links):\n${readPlain}\n`);
  console.log(`HA_EXPORTER_WRITE_TOKEN (Home Assistant integration):\n${writePlain}\n`);
  console.log('---\n');
  console.log(
    'Clients send these values as Authorization: Bearer …; the server compares SHA-256 of the bearer string to the stored fingerprint.',
  );
}

main();
