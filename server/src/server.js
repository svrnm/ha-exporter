import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import dotenv from 'dotenv';
import express from 'express';

import { bearerAuth } from './auth.js';
import { openDatabase } from './db.js';
import { ingestRouter } from './routes/ingest.js';
import {
  entitiesRouter,
  instancesRouter,
} from './routes/instances.js';
import { prefsRouter } from './routes/prefs.js';
import { statesRouter } from './routes/states.js';
import { statisticsRouter } from './routes/statistics.js';

// Default DB location is anchored to the source tree (one level up from src/),
// not the process CWD, so `node src/server.js` and systemd both put the file
// in server/data/ regardless of where they were launched from.
const SERVER_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
// Node does not load `.env` automatically; read server/.env before process.env.
dotenv.config({ path: path.join(SERVER_ROOT, '.env') });

const DEFAULT_DB_PATH = path.join(SERVER_ROOT, 'data', 'ha-exporter.sqlite');
// The React UI lives in a sibling folder; after `npm run build` its static
// output is in web/dist. If the bundle isn't present we just boot API-only.
const DEFAULT_WEB_ROOT = path.resolve(SERVER_ROOT, '..', 'web', 'dist');

// API prefixes that must NOT be swallowed by the SPA fallback. Any GET to
// anything else that accepts HTML will be served index.html so client-side
// routing works on reload.
const API_PREFIXES = [
  '/health',
  '/ingest',
  '/instances',
  '/entities',
  '/statistics',
  '/states',
  '/energy',
];

const PORT = parseInt(process.env.PORT ?? '8080', 10);
const HOST = process.env.HOST ?? '0.0.0.0';
const TOKEN = process.env.HA_EXPORTER_TOKEN;
const DB_PATH = process.env.DATABASE_PATH ?? DEFAULT_DB_PATH;
const BODY_LIMIT = process.env.BODY_LIMIT ?? '50mb';
const WEB_ROOT = process.env.WEB_ROOT ?? DEFAULT_WEB_ROOT;
// Retention windows, in days. Defaults mirror Home Assistant's own recorder
// (10 days for short-term stats and states). Set to 0 to disable a sweep.
const SHORT_STATS_RETENTION_DAYS = parseInt(
  process.env.SHORT_STATS_RETENTION_DAYS ?? '10',
  10,
);
const STATES_RETENTION_DAYS = parseInt(
  process.env.STATES_RETENTION_DAYS ?? '10',
  10,
);
const RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000;

function buildApp(db, token) {
  const app = express();
  app.disable('x-powered-by');

  // Tiny request logger (keeps us dep-free beyond express + sqlite).
  // Logs once per response with method, path, status, duration, and any
  // per-route extras attached to `res.locals.logExtra`.
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const extra = res.locals?.logExtra
        ? ' ' +
          Object.entries(res.locals.logExtra)
            .map(([k, v]) => `${k}=${v}`)
            .join(' ')
        : '';
      console.log(
        `${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms${extra}`,
      );
    });
    next();
  });

  // Unauthenticated probe.
  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Serve the built React UI *before* the bearer middleware so the browser
  // can load HTML, JS and CSS without a token (it needs the bundle to show
  // the login screen). The API itself stays protected below.
  const webRootExists = WEB_ROOT && fs.existsSync(path.join(WEB_ROOT, 'index.html'));
  if (webRootExists) {
    app.use(
      express.static(WEB_ROOT, {
        index: false,
        maxAge: '1h',
        setHeaders(res, filePath) {
          if (filePath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      }),
    );
    // SPA fallback: deep-link reloads like /electricity serve index.html so
    // the React router can take over. This has to happen *before* the bearer
    // middleware otherwise hitting the route directly returns 401 HTML.
    app.get(/.*/, (req, res, next) => {
      if (req.method !== 'GET') return next();
      if (API_PREFIXES.some((p) => req.path === p || req.path.startsWith(`${p}/`))) {
        return next();
      }
      const accept = req.headers.accept || '';
      if (!accept.includes('text/html')) return next();
      res.sendFile(path.join(WEB_ROOT, 'index.html'));
    });
    console.log(`[server] serving web UI from ${WEB_ROOT}`);
  } else {
    console.log(`[server] no web UI bundle at ${WEB_ROOT} (API-only)`);
  }

  // Everything below requires a valid bearer token.
  app.use(bearerAuth(token));

  // `express.json()` already inflates gzip bodies automatically when
  // Content-Encoding: gzip is set (it uses raw-body + iconv-lite internally).
  app.use(
    express.json({
      limit: BODY_LIMIT,
      inflate: true,
      strict: false,
    }),
  );

  app.use('/ingest', ingestRouter(db));
  app.use('/instances', instancesRouter(db));
  app.use('/entities', entitiesRouter(db));
  app.use('/statistics', statisticsRouter(db));
  app.use('/states', statesRouter(db));
  app.use('/energy/prefs', prefsRouter(db));

  // Error handler: maps thrown-with-statusCode errors, logs the rest.
  app.use((err, _req, res, _next) => {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error('[server] unhandled error:', err);
    res.status(500).json({ error: 'internal_error' });
  });

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  return app;
}

function main() {
  if (!TOKEN) {
    console.error(
      'HA_EXPORTER_TOKEN is not set. Refusing to start. ' +
        'Copy .env.example to .env and set a token, or export it inline.',
    );
    process.exit(1);
  }

  const db = openDatabase(DB_PATH);
  console.log(`[server] opened sqlite at ${DB_PATH}`);

  const retentionEnabled =
    SHORT_STATS_RETENTION_DAYS > 0 || STATES_RETENTION_DAYS > 0;
  const runRetention = () => {
    try {
      const res = db.applyRetention({
        shortStatsDays: SHORT_STATS_RETENTION_DAYS,
        statesDays: STATES_RETENTION_DAYS,
      });
      if (res.shortStats || res.states) {
        console.log(
          `[retention] dropped short_stats=${res.shortStats} states=${res.states}`,
        );
      }
    } catch (err) {
      console.error('[retention] sweep failed:', err);
    }
  };
  let retentionTimer;
  if (retentionEnabled) {
    // Run once at boot so a freshly-started server with a stale DB catches
    // up immediately, then on a 6-hour interval afterwards.
    runRetention();
    retentionTimer = setInterval(runRetention, RETENTION_INTERVAL_MS);
    retentionTimer.unref?.();
    console.log(
      `[server] retention: short_stats=${SHORT_STATS_RETENTION_DAYS}d, states=${STATES_RETENTION_DAYS}d`,
    );
  }

  const app = buildApp(db, TOKEN);
  const httpServer = app.listen(PORT, HOST, () => {
    console.log(`[server] listening on http://${HOST}:${PORT}`);
  });

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] ${signal} received, shutting down...`);
    if (retentionTimer) clearInterval(retentionTimer);
    httpServer.close((err) => {
      if (err) console.error('[server] http close error:', err);
      try {
        db.close();
      } catch (closeErr) {
        console.error('[server] db close error:', closeErr);
      }
      process.exit(err ? 1 : 0);
    });
    // Force-exit if close hangs.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
