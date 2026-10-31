import { Router } from 'express';
import { asPartner } from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();

router.get('/', requireAuth, async (req, res) => {
  const rows = await asPartner(req.partner.id, async (db) =>
    (await db.query(
      'SELECT id, type, severity, batch_id, unit_id, event_id, details, created_at FROM alerts ORDER BY id DESC LIMIT 100')).rows);
  res.json({ alerts: rows });
});

export default router;
