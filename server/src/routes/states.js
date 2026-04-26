import { Router } from 'express';
import {
  clampInt,
  optionalIsoDate,
  requireString,
} from '../util/query.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export function statesRouter(db) {
  const router = Router();

  // `/states/latest` — the current snapshot of every tracked entity for an
  // instance, used by the live-flow UI. This MUST be registered before the
  // generic `/` handler because Express matches routes in order.
  router.get('/latest', (req, res, next) => {
    try {
      const instanceId = requireString(req.query.instance_id, 'instance_id');
      const rows = db.queryLatestStates(instanceId);
      res.json({
        instance_id: instanceId,
        count: rows.length,
        states: rows,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/', (req, res, next) => {
    try {
      const instanceId = requireString(req.query.instance_id, 'instance_id');
      const entityId = requireString(req.query.entity_id, 'entity_id');
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

      const rows = db.queryStates({
        instance_id: instanceId,
        entity_id: entityId,
        start,
        end,
        limit,
      });
      res.json({
        instance_id: instanceId,
        entity_id: entityId,
        start,
        end,
        count: rows.length,
        states: rows,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
