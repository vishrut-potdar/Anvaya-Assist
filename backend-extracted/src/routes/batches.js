import { Router } from 'express';
import { z } from 'zod';
import { asPartner, asSystem } from '../db.js';
import { config } from '../config.js';
import { requireAuth, requireRole } from '../auth.js';
import { HttpError } from '../errors.js';
import { unitToken } from '../crypto.js';

const router = Router();
router.use(requireAuth);

// create a batch + its units (manufacturer)
router.post('/', requireRole('manufacturer'), async (req, res) => {
  const { batchCode, productName, quantity } = z.object({
    batchCode: z.string().min(1),
    productName: z.string().min(1),
    quantity: z.number().int().min(1).max(100000),
  }).parse(req.body);

  const batch = await asSystem(async (db) => {
    const { rows: [b] } = await db.query(
      `INSERT INTO batches (batch_code, product_name, quantity, manufacturer_id, current_holder_id)
       VALUES ($1,$2,$3,$4,$4) RETURNING *`, [batchCode, productName, quantity, req.partner.id]);
    await db.query('INSERT INTO units (batch_id, serial) SELECT $1::uuid, generate_series(1, $2::int)', [b.id, quantity]);
    await db.query('INSERT INTO batch_participants VALUES ($1, $2)', [b.id, req.partner.id]);
    return b;
  });
  res.status(201).json({ batch });
});

// batches this partner can see (RLS does the filtering)
router.get('/', async (req, res) => {
  const rows = await asPartner(req.partner.id, async (db) =>
    (await db.query(
      'SELECT id, batch_code, product_name, quantity, state, current_holder_id, created_at FROM batches ORDER BY created_at DESC')).rows);
  res.json({ batches: rows });
});

// one batch + its full event trail
router.get('/:id', async (req, res) => {
  const out = await asPartner(req.partner.id, async (db) => {
    const { rows: [batch] } = await db.query('SELECT * FROM batches WHERE id = $1', [req.params.id]);
    if (!batch) return null;
    const { rows: events } = await db.query(
      `SELECT id, type, actor_id, to_partner_id, quantity, lat, lng, occurred_at, prev_hash, hash
       FROM events WHERE batch_id = $1 ORDER BY id`, [req.params.id]);
    return { batch, events };
  });
  if (!out) throw new HttpError(404, 'NOT_FOUND', 'Batch not found (or not visible to you)');
  res.json(out);
});

async function ownBatch(req) {
  const batch = await asPartner(req.partner.id, async (db) =>
    (await db.query('SELECT * FROM batches WHERE id = $1', [req.params.id])).rows[0]);
  if (!batch || batch.manufacturer_id !== req.partner.id) throw new HttpError(404, 'NOT_FOUND', 'Batch not found');
  return batch;
}

// unit ids + signed QR tokens (manufacturer only), paginated
router.get('/:id/units', requireRole('manufacturer'), async (req, res) => {
  const batch = await ownBatch(req);
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  const offset = Number(req.query.offset) || 0;
  const rows = await asSystem(async (db) =>
    (await db.query('SELECT id, serial FROM units WHERE batch_id = $1 ORDER BY serial LIMIT $2 OFFSET $3', [batch.id, limit, offset])).rows);
  res.json({
    units: rows.map((u) => {
      const token = unitToken(u.id);
      return { serial: u.serial, unitId: u.id, token, verifyUrl: `${config.publicVerifyUrl}/${token}`, qrPng: `/api/qr/${token}` };
    }),
  });
});

// recall trace (manufacturer): the batch + every descendant batch (splits/repackaging),
// where each one is now, and which partners handled them. Recursive CTE.
router.get('/:id/recall', requireRole('manufacturer'), async (req, res) => {
  const batch = await ownBatch(req);
  const out = await asSystem(async (db) => {
    const { rows: affected } = await db.query(
      `WITH RECURSIVE tree AS (
         SELECT id, 0 AS depth FROM batches WHERE id = $1
         UNION ALL
         SELECT b.id, t.depth + 1 FROM batches b JOIN tree t ON b.parent_batch_id = t.id
       )
       SELECT b.id, b.batch_code, b.product_name, b.quantity, b.state, t.depth,
              p.name AS holder, p.role AS holder_role
       FROM tree t JOIN batches b ON b.id = t.id JOIN partners p ON p.id = b.current_holder_id
       ORDER BY t.depth, b.created_at`, [batch.id]);
    const { rows: partners } = await db.query(
      `SELECT DISTINCT p.id, p.name, p.role FROM batch_participants bp
       JOIN partners p ON p.id = bp.partner_id WHERE bp.batch_id = ANY($1::uuid[])`, [affected.map((a) => a.id)]);
    return { affected, partners, totalUnits: affected.reduce((s, a) => s + a.quantity, 0) };
  });
  res.json(out);
});

export default router;
