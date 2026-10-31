import { Router } from 'express';
import { z } from 'zod';
import { withDb } from '../db.ts';
import { addSseClient, removeSseClient } from '../sse.ts';
import { HttpError } from '../errors.ts';

const router = Router();

// List all alerts/anomalies
router.get('/', async (req, res, next) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const alerts = await withDb(async (db) => {
      let query = `
        SELECT a.*, b.batch_code, b.product_name, e.type AS event_type, e.occurred_at AS event_time,
               p.name AS actor_name
        FROM alerts a
        LEFT JOIN batches b ON b.id = a.batch_id
        LEFT JOIN events e ON e.id = a.event_id
        LEFT JOIN partners p ON p.id = e.actor_id
      `;
      const params: any[] = [];
      if (status) {
        query += ` WHERE a.status = $1`;
        params.push(status);
      }
      query += ` ORDER BY a.id DESC LIMIT 100`;

      const { rows } = await db.query(query, params);
      return rows;
    });

    res.json({ ok: true, alerts });
  } catch (err) {
    next(err);
  }
});

// SSE Stream for live alerts dashboard
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const clientId = `client-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  addSseClient(clientId, res);

  req.on('close', () => {
    removeSseClient(clientId);
  });
});

// "Resolve as benign" workflow
router.post('/:id/resolve', async (req, res, next) => {
  try {
    const { reason } = z.object({ reason: z.string().default('Reviewed by operator - benign deviation') }).parse(req.body);

    const updated = await withDb(async (db) => {
      const { rows: [a] } = await db.query(
        `UPDATE alerts
         SET status = 'benign', details = details || $1::jsonb
         WHERE id = $2
         RETURNING *`,
        [JSON.stringify({ resolvedReason: reason, resolvedAt: new Date().toISOString() }), req.params.id]
      );
      return a;
    });

    if (!updated) {
      throw new HttpError(404, 'NOT_FOUND', 'Alert not found');
    }

    res.json({ ok: true, alert: updated, message: 'Alert resolved as benign' });
  } catch (err) {
    next(err);
  }
});

export default router;
