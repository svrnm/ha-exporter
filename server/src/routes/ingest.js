import { Router } from 'express';

export function ingestRouter(db) {
  const router = Router();

  router.post('/', (req, res) => {
    const env = req.body;
    if (!env || typeof env !== 'object' || Array.isArray(env)) {
      return res.status(400).json({ error: 'invalid_body' });
    }
    if (typeof env.instance_id !== 'string' || env.instance_id.trim() === '') {
      return res.status(400).json({ error: 'missing_instance_id' });
    }
    try {
      const counts = db.ingest(env);
      res.locals.logExtra = {
        instance: env.instance_id,
        stats: counts.statistics,
        states: counts.states,
      };
      return res.status(200).json({ ok: true, received: counts });
    } catch (err) {
      console.error('[ingest] failed:', err);
      return res.status(500).json({ error: 'ingest_failed' });
    }
  });

  return router;
}
