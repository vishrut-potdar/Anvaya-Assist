import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth.ts';
import { eventBodySchema, submitEvent } from '../services/events.ts';
import { withDb } from '../db.ts';

const router = Router();

// Submit a cryptographically signed event
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { event, signature } = z.object({
      event: eventBodySchema,
      signature: z.string().min(1),
    }).parse(req.body);

    const result = await submitEvent(req.partner!, event, signature);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// List recent events across the ledger
router.get('/', async (_req, res, next) => {
  try {
    const events = await withDb(async (db) => {
      const { rows } = await db.query(
        `SELECT e.*, b.batch_code, b.product_name,
                p.name AS actor_name, p.role AS actor_role, p.public_key,
                tp.name AS to_partner_name, tp.role AS to_partner_role
         FROM events e
         JOIN batches b ON b.id = e.batch_id
         JOIN partners p ON p.id = e.actor_id
         LEFT JOIN partners tp ON tp.id = e.to_partner_id
         ORDER BY e.id DESC
         LIMIT 100`
      );
      return rows;
    });
    res.json({ ok: true, events });
  } catch (err) {
    next(err);
  }
});

export default router;
