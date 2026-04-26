import { Router } from 'express';
import { requireString } from '../util/query.js';

export function prefsRouter(db) {
  const router = Router();

  router.get('/', (req, res, next) => {
    try {
      const instanceId = requireString(req.query.instance_id, 'instance_id');
      const found = db.getPrefs(instanceId);
      if (found) {
        return res.json({ instance_id: instanceId, ...found });
      }
      // Ingest can create `instances` before `energy_prefs` (e.g. stats-only
      // first push). Treat as "not configured yet" instead of 404.
      if (db.getInstance(instanceId)) {
        return res.json({
          instance_id: instanceId,
          prefs: null,
          updated_at: null,
        });
      }
      return res.status(404).json({ error: 'no_prefs_for_instance' });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
