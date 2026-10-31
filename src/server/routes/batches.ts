import { Router } from 'express';
import { z } from 'zod';
import { withDb } from '../db.ts';
import { requireAuth, requireRole } from '../auth.ts';
import { HttpError } from '../errors.ts';
import { gs1HmacToken, unitToken } from '../crypto.ts';
import { config } from '../config.ts';
import { CITIES, nearestCity } from '../geo.ts';

const router = Router();

// Create a batch + units (Manufacturer only)
router.post('/', requireAuth, requireRole('manufacturer'), async (req, res, next) => {
  try {
    const body = z.object({
      batchCode: z.string().min(1),
      productName: z.string().min(1),
      quantity: z.number().int().min(1).max(10000),
      gtin: z.string().default('09506000134352'),
      expiryDate: z.string().optional(),
      parentBatchId: z.string().uuid().optional(),
    }).parse(req.body);

    const partner = req.partner!;

    const batch = await withDb(async (db) => {
      const { rows: [b] } = await db.query(
        `INSERT INTO batches (
          batch_code, gtin, product_name, quantity, manufacturer_id, current_holder_id, expiry_date, parent_batch_id
        ) VALUES ($1, $2, $3, $4, $5, $5, $6, $7)
        RETURNING *`,
        [
          body.batchCode,
          body.gtin,
          body.productName,
          body.quantity,
          partner.id,
          body.expiryDate ? new Date(body.expiryDate) : new Date(Date.now() + 365 * 86400 * 1000),
          body.parentBatchId || null,
        ]
      );

      // Create units
      await db.query(
        `INSERT INTO units (batch_id, serial, state, current_custodian_id)
         SELECT $1::uuid, s, 'CREATED', $2::uuid
         FROM generate_series(1, $3::int) AS s`,
        [b.id, partner.id, body.quantity]
      );

      // Record lineage if split from parent
      if (body.parentBatchId) {
        await db.query(
          `INSERT INTO batch_lineage (parent_batch_id, child_batch_id, relation)
           VALUES ($1, $2, 'split')`,
          [body.parentBatchId, b.id]
        );
      }

      await db.query(
        `INSERT INTO batch_participants (batch_id, partner_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [b.id, partner.id]
      );

      return b;
    });

    res.status(201).json({ ok: true, batch });
  } catch (err) {
    next(err);
  }
});

// List all batches
router.get('/', async (_req, res, next) => {
  try {
    const batches = await withDb(async (db) => {
      const { rows } = await db.query(
        `SELECT b.*,
                m.name AS manufacturer_name,
                h.name AS current_holder_name,
                h.role AS current_holder_role,
                r.role AS pending_recipient_role,
                (SELECT json_build_object('lat', e.lat, 'lng', e.lng) FROM events e
                  WHERE e.batch_id = b.id AND e.lat IS NOT NULL ORDER BY e.id ASC LIMIT 1) AS first_point,
                (SELECT json_build_object('lat', e.lat, 'lng', e.lng, 'destination', e.body->'payload'->>'destination') FROM events e
                  WHERE e.batch_id = b.id AND e.lat IS NOT NULL ORDER BY e.id DESC LIMIT 1) AS last_point,
                (SELECT COUNT(*) FROM events e WHERE e.batch_id = b.id) AS event_count,
                (SELECT COUNT(*) FROM alerts a WHERE a.batch_id = b.id) AS alert_count
         FROM batches b
         JOIN partners m ON m.id = b.manufacturer_id
         JOIN partners h ON h.id = b.current_holder_id
         LEFT JOIN partners r ON r.id = b.pending_recipient_id
         ORDER BY b.created_at DESC`
      );
      return rows.map(({ first_point, last_point, ...b }: any) => ({
        ...b,
        origin_city: first_point ? nearestCity(first_point) : null,
        current_city: last_point ? nearestCity(last_point) : null,
        destination_city: b.state === 'IN_TRANSIT' ? CITIES[last_point?.destination]?.name ?? null : null,
      }));
    });
    res.json({ ok: true, batches });
  } catch (err) {
    next(err);
  }
});

// Single batch + full cryptographic event trail
router.get('/:id', async (req, res, next) => {
  try {
    const out = await withDb(async (db) => {
      const { rows: [batch] } = await db.query(
        `SELECT b.*, m.name AS manufacturer_name, h.name AS current_holder_name
         FROM batches b
         JOIN partners m ON m.id = b.manufacturer_id
         JOIN partners h ON h.id = b.current_holder_id
         WHERE b.id = $1`,
        [req.params.id]
      );
      if (!batch) return null;

      const { rows: events } = await db.query(
        `SELECT e.*, p.name AS actor_name, p.role AS actor_role, p.public_key,
                tp.name AS to_partner_name, tp.role AS to_partner_role
         FROM events e
         JOIN partners p ON p.id = e.actor_id
         LEFT JOIN partners tp ON tp.id = e.to_partner_id
         WHERE e.batch_id = $1
         ORDER BY e.id ASC`,
        [req.params.id]
      );

      const { rows: alerts } = await db.query(
        `SELECT * FROM alerts WHERE batch_id = $1 ORDER BY id DESC`,
        [req.params.id]
      );

      return { batch, events, alerts };
    });

    if (!out) {
      throw new HttpError(404, 'NOT_FOUND', 'Batch not found');
    }

    res.json({ ok: true, ...out });
  } catch (err) {
    next(err);
  }
});

// Unit tokens + GS1 Digital Link URLs for printing QR labels
router.get('/:id/units', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 500);
    const offset = Number(req.query.offset) || 0;

    const out = await withDb(async (db) => {
      const { rows: [batch] } = await db.query(
        'SELECT * FROM batches WHERE id = $1',
        [req.params.id]
      );
      if (!batch) return null;

      const { rows: units } = await db.query(
        `SELECT id, serial, state, sold_region FROM units
         WHERE batch_id = $1 ORDER BY serial ASC LIMIT $2 OFFSET $3`,
        [batch.id, limit, offset]
      );

      const items = units.map((u) => {
        const token = unitToken(u.id);
        const gs1Token = gs1HmacToken(batch.gtin || '09506000134352', batch.batch_code, u.serial);
        const gs1Url = `/api/01/${batch.gtin || '09506000134352'}/10/${batch.batch_code}/21/${u.serial}?t=${gs1Token}`;
        const verifyUrl = `/verify/${token}`;
        return {
          id: u.id,
          serial: u.serial,
          state: u.state,
          soldRegion: u.sold_region,
          token,
          gs1Token,
          gs1Url,
          verifyUrl,
          qrApi: `/api/qr/${token}`,
        };
      });

      return { batch, units: items };
    });

    if (!out) {
      throw new HttpError(404, 'NOT_FOUND', 'Batch not found');
    }

    res.json({ ok: true, ...out });
  } catch (err) {
    next(err);
  }
});

// Recursive CTE Recall Trace (traces batch + all child splits/merges in under 1 second)
router.get('/:id/recall', async (req, res, next) => {
  try {
    const startTime = Date.now();
    const result = await withDb(async (db) => {
      const { rows: [root] } = await db.query('SELECT * FROM batches WHERE id = $1', [req.params.id]);
      if (!root) return null;

      const { rows: affected } = await db.query(
        `WITH RECURSIVE tree AS (
           SELECT id, 0 AS depth FROM batches WHERE id = $1
           UNION
           SELECT bl.child_batch_id, t.depth + 1
           FROM batch_lineage bl
           JOIN tree t ON bl.parent_batch_id = t.id
           WHERE t.depth < 10
         )
         SELECT b.id, b.batch_code, b.product_name, b.quantity, b.state, b.is_recalled, b.recalled_at, t.depth,
                p.id AS holder_id, p.name AS holder, p.role AS holder_role, p.country AS holder_country,
                COUNT(u.id) FILTER (WHERE u.state = 'SOLD') AS units_sold,
                COUNT(u.id) FILTER (WHERE u.state <> 'SOLD') AS units_in_stock
         FROM tree t
         JOIN batches b ON b.id = t.id
         JOIN partners p ON p.id = b.current_holder_id
         LEFT JOIN units u ON u.batch_id = b.id
         GROUP BY b.id, b.batch_code, b.product_name, b.quantity, b.state, b.is_recalled, b.recalled_at, t.depth,
                  p.id, p.name, p.role, p.country
         ORDER BY t.depth ASC, b.created_at ASC`,
        [root.id]
      );

      const batchIds = affected.map((a) => a.id);
      const { rows: partners } = await db.query(
        `SELECT DISTINCT p.id, p.name, p.role, p.country
         FROM batch_participants bp
         JOIN partners p ON p.id = bp.partner_id
         WHERE bp.batch_id = ANY($1::uuid[])`,
        [batchIds]
      );

      return {
        rootBatch: root,
        affectedBatches: affected,
        affectedPartners: partners,
        totalUnits: affected.reduce((sum, b) => sum + Number(b.quantity), 0),
        totalUnitsInStock: affected.reduce((sum, b) => sum + Number(b.units_in_stock || 0), 0),
        totalUnitsSold: affected.reduce((sum, b) => sum + Number(b.units_sold || 0), 0),
      };
    });

    if (!result) {
      throw new HttpError(404, 'NOT_FOUND', 'Batch not found');
    }

    const durationMs = Date.now() - startTime;
    res.json({
      ok: true,
      ...result,
      executionDurationMs: durationMs,
    });
  } catch (err) {
    next(err);
  }
});

// Trigger recall on a batch
router.post('/:id/recall', requireAuth, requireRole('manufacturer', 'regulator'), async (req, res, next) => {
  try {
    const { reason } = z.object({ reason: z.string().min(1) }).parse(req.body);

    const batch = await withDb(async (db) => {
      const { rows: [b] } = await db.query(
        `UPDATE batches
         SET is_recalled = true, recalled_at = now(), recall_reason = $1, state = 'RECALLED'
         WHERE id = $2
         RETURNING *`,
        [reason, req.params.id]
      );
      if (!b) return null;

      await db.query(
        `UPDATE units SET state = 'RECALLED' WHERE batch_id = $1`,
        [b.id]
      );

      return b;
    });

    if (!batch) {
      throw new HttpError(404, 'NOT_FOUND', 'Batch not found');
    }

    res.json({ ok: true, batch, message: 'Batch successfully marked as RECALLED' });
  } catch (err) {
    next(err);
  }
});

export default router;
