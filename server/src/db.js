import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Same contract as better-sqlite3 `db.transaction(fn)`: returns a function that
 * runs `fn` inside BEGIN / COMMIT, or ROLLBACK on throw.
 * @param {import('node:sqlite').DatabaseSync} db
 */
function wrapTransaction(db) {
  return (fn) =>
    (...args) => {
      db.exec('BEGIN');
      try {
        const out = fn(...args);
        db.exec('COMMIT');
        return out;
      } catch (e) {
        try {
          db.exec('ROLLBACK');
        } catch {
          /* ignore secondary failure */
        }
        throw e;
      }
    };
}

/** Parse any ISO-like timestamp to canonical UTC `…Z` for storage and joins. */
function toIsoUtc(iso) {
  if (iso == null || iso === '') return null;
  const t = Date.parse(String(iso));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

// --------------------------------------------------------------------------- //
// Schema
//
// Statistics rows come in two flavours now:
//   - period='hour'     → HA's long-term statistics, 1 row per hour.
//   - period='5minute'  → HA's short-term statistics, 1 row per 5 min. HA
//                          itself only retains these for ~10 days, so we
//                          mirror that window on our side.
//
// The UNIQUE key must include `period` so a 10:00 hourly bucket and a 10:00
// 5-min bucket don't fight for the same row. Fresh installs get the new
// schema straight away; existing installs are migrated below.
// --------------------------------------------------------------------------- //

// Bare table definitions only — indexes live in `INDEXES` below and are
// applied *after* migrations, so they can safely reference new columns.
const TABLES = `
CREATE TABLE IF NOT EXISTS statistics (
  id            INTEGER PRIMARY KEY,
  instance_id   TEXT NOT NULL,
  statistic_id  TEXT NOT NULL,
  period        TEXT NOT NULL DEFAULT 'hour',
  period_start  TEXT NOT NULL,
  sum           REAL,
  state         REAL,
  mean          REAL,
  min           REAL,
  max           REAL,
  unit          TEXT,
  received_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (instance_id, statistic_id, period, period_start)
);

CREATE TABLE IF NOT EXISTS states (
  id            INTEGER PRIMARY KEY,
  instance_id   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  state         TEXT NOT NULL,
  attributes    TEXT,
  last_updated  TEXT,
  last_changed  TEXT,
  received_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS energy_prefs (
  instance_id   TEXT PRIMARY KEY,
  prefs         TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS instances (
  instance_id   TEXT PRIMARY KEY,
  ha_version    TEXT,
  last_seen     TEXT,
  location_name TEXT
);
`;

const INDEXES = `
CREATE INDEX IF NOT EXISTS idx_statistics_lookup
  ON statistics (instance_id, statistic_id, period, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_statistics_retention
  ON statistics (period, period_start);
CREATE INDEX IF NOT EXISTS idx_states_lookup
  ON states (instance_id, entity_id, last_updated DESC);
CREATE INDEX IF NOT EXISTS idx_states_retention
  ON states (last_updated);
`;

/**
 * Handle one-shot schema migrations. We only need this for existing installs
 * created before `period` existed — fresh databases already get the right
 * shape from `SCHEMA` above.
 *
 * SQLite can't retroactively change a table's inline UNIQUE constraint, so
 * the migration rebuilds the table in a transaction and copies data across.
 */
function migrate(db, tx) {
  const cols = db.prepare('PRAGMA table_info(statistics)').all();
  const hasPeriod = cols.some((c) => c.name === 'period');
  if (hasPeriod) return;

  // Rebuild `statistics` with the new UNIQUE constraint and a default
  // `period='hour'` for everything we migrate over.
  tx(() => {
    db.exec(`
      CREATE TABLE statistics_new (
        id            INTEGER PRIMARY KEY,
        instance_id   TEXT NOT NULL,
        statistic_id  TEXT NOT NULL,
        period        TEXT NOT NULL DEFAULT 'hour',
        period_start  TEXT NOT NULL,
        sum           REAL,
        state         REAL,
        mean          REAL,
        min           REAL,
        max           REAL,
        unit          TEXT,
        received_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE (instance_id, statistic_id, period, period_start)
      );
      INSERT INTO statistics_new
        (id, instance_id, statistic_id, period, period_start,
         sum, state, mean, min, max, unit, received_at)
      SELECT id, instance_id, statistic_id, 'hour', period_start,
             sum, state, mean, min, max, unit, received_at
        FROM statistics;
      DROP TABLE statistics;
      ALTER TABLE statistics_new RENAME TO statistics;
      CREATE INDEX idx_statistics_lookup
        ON statistics (instance_id, statistic_id, period, period_start DESC);
      CREATE INDEX idx_statistics_retention
        ON statistics (period, period_start);
    `);
  })();
}

/** Add `location_name` for Home Assistant "home" display name (HA Settings → System). */
function migrateInstanceLocationName(db) {
  const cols = db.prepare('PRAGMA table_info(instances)').all();
  if (cols.some((c) => c.name === 'location_name')) return;
  db.exec('ALTER TABLE instances ADD COLUMN location_name TEXT');
}

/**
 * @typedef {ReturnType<typeof openDatabase>} DB
 */

export function openDatabase(dbPath) {
  const absPath = path.resolve(dbPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });

  const db = new DatabaseSync(absPath);
  const tx = wrapTransaction(db);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  // Order matters: ensure the tables exist (with whatever shape they already
  // have from a prior install), run the migration to add `period` if needed,
  // and only then create indexes that reference columns that may not have
  // existed before the migration.
  db.exec(TABLES);
  migrate(db, tx);
  migrateInstanceLocationName(db);
  db.exec(INDEXES);

  const stmts = {
    upsertStat: db.prepare(`
      INSERT INTO statistics
        (instance_id, statistic_id, period, period_start,
         sum, state, mean, min, max, unit)
      VALUES
        (@instance_id, @statistic_id, @period, @period_start,
         @sum, @state, @mean, @min, @max, @unit)
      ON CONFLICT (instance_id, statistic_id, period, period_start) DO UPDATE SET
        sum   = excluded.sum,
        state = excluded.state,
        mean  = excluded.mean,
        min   = excluded.min,
        max   = excluded.max,
        unit  = excluded.unit
    `),
    insertState: db.prepare(`
      INSERT INTO states
        (instance_id, entity_id, state, attributes, last_updated, last_changed)
      VALUES
        (@instance_id, @entity_id, @state, @attributes, @last_updated, @last_changed)
    `),
    upsertPrefs: db.prepare(`
      INSERT INTO energy_prefs (instance_id, prefs, updated_at)
      VALUES (@instance_id, @prefs, @updated_at)
      ON CONFLICT (instance_id) DO UPDATE SET
        prefs      = excluded.prefs,
        updated_at = excluded.updated_at
    `),
    upsertInstance: db.prepare(`
      INSERT INTO instances (instance_id, ha_version, last_seen, location_name)
      VALUES (@instance_id, @ha_version, @last_seen, @location_name)
      ON CONFLICT (instance_id) DO UPDATE SET
        ha_version    = COALESCE(excluded.ha_version, instances.ha_version),
        last_seen     = excluded.last_seen,
        location_name = COALESCE(
          NULLIF(TRIM(COALESCE(excluded.location_name, '')), ''),
          instances.location_name
        )
    `),

    listInstances: db.prepare(`
      SELECT instance_id, ha_version, last_seen, location_name
      FROM instances
      ORDER BY last_seen DESC
    `),
    getInstance: db.prepare(`
      SELECT instance_id, ha_version, last_seen, location_name
      FROM instances
      WHERE instance_id = ?
    `),
    listStatisticIds: db.prepare(`
      SELECT DISTINCT statistic_id
      FROM statistics
      WHERE instance_id = ?
      ORDER BY statistic_id
    `),
    listEntityIds: db.prepare(`
      SELECT DISTINCT entity_id
      FROM states
      WHERE instance_id = ?
      ORDER BY entity_id
    `),
    prefsFor: db.prepare(`
      SELECT prefs, updated_at
      FROM energy_prefs
      WHERE instance_id = ?
    `),

    // Use unixepoch(...) for bounds and ORDER BY — TEXT compare on ISO
    // timestamps is wrong when the DB has `...+00:00` (Python) and the API
    // passes `....000Z` (browser): `+` sorts before `.`, so the first bucket
    // of every window was dropped for some series while the anchor query
    // mis-aligned. Grid totals could still look "close"; solar / battery /
    // CO₂ diverged from HA the most.
    // Newest N buckets in the window (not oldest). A global [2000, now) query
    // with ASC+LIMIT was returning data from 2000 only, so "All data" window
    // totals and CO₂ could be *lower* than single-day results from recent full
    // windows. Charts still want time order — `queryStatistics` reverses to ASC.
    statsRange: db.prepare(`
      SELECT period_start, period, sum, state, mean, min, max, unit
      FROM statistics
      WHERE instance_id = ?
        AND statistic_id = ?
        AND period = ?
        AND unixepoch(period_start) >= unixepoch(?)
        AND unixepoch(period_start) < unixepoch(?)
      ORDER BY unixepoch(period_start) DESC
      LIMIT ?
    `),
    // Boundaries for cumulative totals: skip leading/trailing buckets with no
    // `sum` (common for some series) so "last" is not confused with the last
    // point in a chart series that may omit null-sum hours.
    statsFirstInWindow: db.prepare(`
      SELECT period_start, period, sum, state, mean, min, max, unit
      FROM statistics
      WHERE instance_id = ?
        AND statistic_id = ?
        AND period = ?
        AND unixepoch(period_start) >= unixepoch(?)
        AND unixepoch(period_start) < unixepoch(?)
        AND sum IS NOT NULL
      ORDER BY unixepoch(period_start) ASC
      LIMIT 1
    `),
    statsLastInWindow: db.prepare(`
      SELECT period_start, period, sum, state, mean, min, max, unit
      FROM statistics
      WHERE instance_id = ?
        AND statistic_id = ?
        AND period = ?
        AND unixepoch(period_start) >= unixepoch(?)
        AND unixepoch(period_start) < unixepoch(?)
        AND sum IS NOT NULL
      ORDER BY unixepoch(period_start) DESC
      LIMIT 1
    `),
    // Anchor row: the most recent bucket starting BEFORE the requested
    // window. Its `sum` is the cumulative reading at the start of the
    // first in-range bucket, which is what HA itself uses to compute
    // daily/period totals. Without it, delta-based totals always lose
    // the first bucket of the window (the off-by-one that makes our
    // numbers run a hair below HA's). We require `sum` so anchors only
    // exist for proper accumulating sensors.
    statsAnchor: db.prepare(`
      SELECT period_start, period, sum, state, mean, min, max, unit
      FROM statistics
      WHERE instance_id = ?
        AND statistic_id = ?
        AND period = ?
        AND unixepoch(period_start) < unixepoch(?)
        AND sum IS NOT NULL
      ORDER BY unixepoch(period_start) DESC
      LIMIT 1
    `),
    statsLatest: db.prepare(`
      SELECT s.statistic_id, s.period, s.period_start, s.sum, s.state, s.mean, s.min, s.max, s.unit
      FROM statistics s
      JOIN (
        SELECT statistic_id, period, MAX(unixepoch(period_start)) AS mx
        FROM statistics
        WHERE instance_id = ?
          AND period = ?
        GROUP BY statistic_id, period
      ) latest
        ON latest.statistic_id = s.statistic_id
       AND latest.period       = s.period
       AND unixepoch(s.period_start) = latest.mx
      WHERE s.instance_id = ?
      ORDER BY s.statistic_id
    `),
    statesRange: db.prepare(`
      SELECT entity_id, state, attributes, last_updated, last_changed, received_at
      FROM states
      WHERE instance_id = ?
        AND entity_id = ?
        AND last_updated IS NOT NULL
        AND unixepoch(last_updated) >= unixepoch(?)
        AND unixepoch(last_updated) < unixepoch(?)
      ORDER BY unixepoch(last_updated) ASC
      LIMIT ?
    `),
    latestStates: db.prepare(`
      SELECT s.entity_id, s.state, s.attributes, s.last_updated, s.last_changed
      FROM states s
      JOIN (
        SELECT entity_id, MAX(unixepoch(last_updated)) AS mx
        FROM states
        WHERE instance_id = ?
          AND last_updated IS NOT NULL
        GROUP BY entity_id
      ) latest
        ON latest.entity_id = s.entity_id
       AND unixepoch(s.last_updated) = latest.mx
      WHERE s.instance_id = ?
      ORDER BY s.entity_id
    `),

    deleteStats: db.prepare('DELETE FROM statistics WHERE instance_id = ?'),
    deleteStates: db.prepare('DELETE FROM states WHERE instance_id = ?'),
    deletePrefs: db.prepare('DELETE FROM energy_prefs WHERE instance_id = ?'),
    deleteInstance: db.prepare('DELETE FROM instances WHERE instance_id = ?'),

    retainShortStats: db.prepare(`
      DELETE FROM statistics
      WHERE period = '5minute'
        AND unixepoch(period_start) < unixepoch(?)
    `),
    // Drop state *history* older than the cutoff, but never remove the newest
    // row for each (instance_id, entity_id). Constant tariff / input_number
    // entities rarely get a new `last_updated`; the old DELETE removed their
    // only row after N days and broke /states/latest + cost inference.
    retainStates: db.prepare(`
      DELETE FROM states
      WHERE id IN (
        SELECT s.id
        FROM states s
        WHERE s.last_updated IS NOT NULL
          AND unixepoch(s.last_updated) < unixepoch(?)
          AND EXISTS (
            SELECT 1
            FROM states s2
            WHERE s2.instance_id = s.instance_id
              AND s2.entity_id = s.entity_id
              AND s2.last_updated IS NOT NULL
              AND unixepoch(s2.last_updated) > unixepoch(s.last_updated)
          )
      )
    `),
  };

  /**
   * Wipe stored time-series for an instance. When `full` is true the energy
   * prefs blob and the instance record itself are also removed — handy for
   * "I want to forget this HA ever existed" scenarios. Otherwise we keep the
   * prefs so a re-hydrate from HA still has context on the remote side if
   * something goes wrong mid-flight.
   *
   * Runs inside a single transaction so readers never see a half-wiped DB.
   */
  const clearInstanceData = tx((instanceId, { full = false } = {}) => {
    const stats = stmts.deleteStats.run(instanceId).changes;
    const states = stmts.deleteStates.run(instanceId).changes;
    let prefs = 0;
    let instance = 0;
    if (full) {
      prefs = stmts.deletePrefs.run(instanceId).changes;
      instance = stmts.deleteInstance.run(instanceId).changes;
    }
    return { statistics: stats, states, energy_prefs: prefs, instances: instance };
  });

  /**
   * Atomically apply the entire incoming envelope.
   * @param {object} env - parsed JSON envelope from the HA exporter integration.
   * @returns {{ statistics: number, states: number }}
   */
  const ingest = tx((env) => {
    const instanceId = String(env.instance_id ?? 'unknown');
    const sentAt = typeof env.sent_at === 'string' ? env.sent_at : new Date().toISOString();

    let statCount = 0;
    let stateCount = 0;

    for (const batch of Array.isArray(env.statistics) ? env.statistics : []) {
      const statId = batch?.statistic_id;
      if (!statId) continue;
      // Default to hourly so older integrations that don't send a period
      // still round-trip cleanly.
      const period = batch.period === '5minute' ? '5minute' : 'hour';
      const unit = batch.unit_of_measurement ?? null;
      for (const point of Array.isArray(batch.points) ? batch.points : []) {
        if (!point?.start) continue;
        stmts.upsertStat.run({
          instance_id: instanceId,
          statistic_id: statId,
          period,
          period_start: toIsoUtc(point.start) ?? String(point.start),
          sum: nullableNum(point.sum),
          state: nullableNum(point.state),
          mean: nullableNum(point.mean),
          min: nullableNum(point.min),
          max: nullableNum(point.max),
          unit,
        });
        statCount++;
      }
    }

    for (const rec of Array.isArray(env.states) ? env.states : []) {
      if (!rec?.entity_id || rec.state == null) continue;
      stmts.insertState.run({
        instance_id: instanceId,
        entity_id: String(rec.entity_id),
        state: String(rec.state),
        attributes: rec.attributes != null ? JSON.stringify(rec.attributes) : null,
        last_updated: toIsoUtc(rec.last_updated) ?? rec.last_updated ?? null,
        last_changed: toIsoUtc(rec.last_changed) ?? rec.last_changed ?? null,
      });
      stateCount++;
    }

    if (env.energy_prefs && typeof env.energy_prefs === 'object') {
      stmts.upsertPrefs.run({
        instance_id: instanceId,
        prefs: JSON.stringify(env.energy_prefs),
        updated_at: sentAt,
      });
    }

    const locRaw = env.location_name;
    const locationName =
      typeof locRaw === 'string' && locRaw.trim() !== '' ? locRaw.trim() : null;
    stmts.upsertInstance.run({
      instance_id: instanceId,
      ha_version: env.ha_version ?? null,
      last_seen: sentAt,
      location_name: locationName,
    });

    return { statistics: statCount, states: stateCount };
  });

  /**
   * Apply retention. Runs in a single transaction per table so we don't
   * hold a big lock. Returns how many rows each sweep removed.
   * A non-positive window skips that sweep (`STATES_RETENTION_DAYS=0` disables
   * state pruning entirely instead of using a zero-length window).
   */
  const applyRetention = ({ shortStatsDays = 10, statesDays = 10 } = {}) => {
    const now = Date.now();
    const shortStats =
      shortStatsDays > 0
        ? stmts.retainShortStats.run(
            new Date(now - shortStatsDays * 86_400_000).toISOString(),
          ).changes
        : 0;
    const states =
      statesDays > 0
        ? stmts.retainStates.run(
            new Date(now - statesDays * 86_400_000).toISOString(),
          ).changes
        : 0;
    return { shortStats, states };
  };

  return {
    raw: db,
    ingest,
    clearInstanceData,
    applyRetention,

    listInstances: () => stmts.listInstances.all(),
    getInstance: (instanceId) => stmts.getInstance.get(instanceId) ?? null,
    listEntities: (instanceId) => ({
      statistic_ids: stmts.listStatisticIds.all(instanceId).map((r) => r.statistic_id),
      entity_ids: stmts.listEntityIds.all(instanceId).map((r) => r.entity_id),
    }),
    getPrefs: (instanceId) => {
      const row = stmts.prefsFor.get(instanceId);
      if (!row) return null;
      return { prefs: JSON.parse(row.prefs), updated_at: row.updated_at };
    },
    queryStatistics: ({ instance_id, statistic_id, period = 'hour', start, end, limit }) => {
      const pointsDesc = stmts.statsRange.all(
        instance_id, statistic_id, period, start, end, limit,
      );
      const points = pointsDesc.length > 0 ? pointsDesc.slice().reverse() : [];
      const anchor = stmts.statsAnchor.get(
        instance_id, statistic_id, period, start,
      );
      const first = stmts.statsFirstInWindow.get(
        instance_id, statistic_id, period, start, end,
      );
      const last = stmts.statsLastInWindow.get(
        instance_id, statistic_id, period, start, end,
      );
      return { points, anchor: anchor ?? null, first: first ?? null, last: last ?? null };
    },
    queryLatestStatistics: (instance_id, period = 'hour') =>
      stmts.statsLatest.all(instance_id, period, instance_id),
    queryStates: ({ instance_id, entity_id, start, end, limit }) =>
      stmts.statesRange.all(instance_id, entity_id, start, end, limit).map((row) => ({
        ...row,
        attributes: row.attributes ? JSON.parse(row.attributes) : null,
      })),
    queryLatestStates: (instance_id) =>
      stmts.latestStates.all(instance_id, instance_id).map((row) => ({
        ...row,
        attributes: row.attributes ? JSON.parse(row.attributes) : null,
      })),

    close: () => db.close(),
  };
}

function nullableNum(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
