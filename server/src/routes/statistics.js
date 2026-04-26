import { Router } from 'express';
import {
  clampInt,
  oneOf,
  optionalIsoDate,
  requireString,
} from '../util/query.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const PERIODS = ['hour', '5minute'];

export function statisticsRouter(db) {
  const router = Router();

  router.get('/', (req, res, next) => {
    try {
      const instanceId = requireString(req.query.instance_id, 'instance_id');
      const statisticId = requireString(req.query.statistic_id, 'statistic_id');
      const period = oneOf(req.query.period, PERIODS, { fallback: 'hour' });
      const now = Date.now();
      const start = optionalIsoDate(
        req.query.start,
        new Date(now - DAY_MS).toISOString(),
      );
      const end = optionalIsoDate(req.query.end, new Date(now).toISOString());
      const limit = clampInt(req.query.limit, {
        min: 1,
        max: 10000,
        fallback: 1000,
      });

      const { points, anchor, first, last } = db.queryStatistics({
        instance_id: instanceId,
        statistic_id: statisticId,
        period,
        start,
        end,
        limit,
      });
      res.json({
        instance_id: instanceId,
        statistic_id: statisticId,
        period,
        start,
        end,
        count: points.length,
        // Anchor is the bucket immediately preceding the requested
        // window. Clients use its `sum` to compute correct deltas and
        // period totals (HA's own dashboard does the same — without an
        // anchor, the first bucket of every window gets dropped from
        // delta-based totals).
        anchor,
        // Earliest in-range bucket: when the window has no row before
        // `start`, clients use `last.sum − first.sum` for full-range totals
        // (see queryStatistics: points are the newest N rows only).
        first,
        last,
        points,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/latest', (req, res, next) => {
    try {
      const instanceId = requireString(req.query.instance_id, 'instance_id');
      const period = oneOf(req.query.period, PERIODS, { fallback: 'hour' });
      res.json({
        instance_id: instanceId,
        period,
        statistics: db.queryLatestStatistics(instanceId, period),
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
