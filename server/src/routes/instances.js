import { Router } from 'express';
import { requireString } from '../util/query.js';

export function instancesRouter(db) {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({ instances: db.listInstances() });
  });

  // Wipe stored time-series data for a single instance. By default the
  // energy_prefs blob and the instance record itself are kept so a subsequent
  // hydrate from HA can proceed without the UI losing its dashboard config.
  // Pass `?full=1` to also remove those records — useful in tests.
  router.delete('/:instance_id', (req, res, next) => {
    try {
      const instanceId = requireString(req.params.instance_id, 'instance_id');
      const full = req.query.full === '1' || req.query.full === 'true';
      const counts = db.clearInstanceData(instanceId, { full });
      res.locals.logExtra = {
        instance_id: instanceId,
        full: full ? '1' : '0',
        ...counts,
      };
      res.json({ instance_id: instanceId, full, deleted: counts });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export function entitiesRouter(db) {
  const router = Router();

  router.get('/', (req, res, next) => {
    try {
      const instanceId = requireString(req.query.instance_id, 'instance_id');
      res.json(db.listEntities(instanceId));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
