import { Router } from 'express';
import { z } from 'zod';
import { withDb } from '../db.ts';
import { canonicalize, sign } from '../crypto.ts';
import { submitEvent } from '../services/events.ts';
import { CITIES } from '../geo.ts';
import { HttpError } from '../errors.ts';
import { findOrCreateSigner, signerFor, Signer } from '../signing.ts';

// Lets the signed-in UI enter its own data. The browser has no partner keys (auth is fake),
// so the server signs each ledger event as the partner who owns that step.
const router = Router();

const NETWORK = {
  manufacturer: { name: 'My Manufacturing Unit', role: 'manufacturer' },
  logistics: { name: 'My Logistics Fleet', role: 'logistics' },
  distributor: { name: 'My Distributor', role: 'distributor' },
  retailer: { name: 'My Retail Store', role: 'retailer' },
} as const;

const cityKey = z.enum(Object.keys(CITIES) as [string, ...string[]]);

async function record(signer: Signer, batchId: string, type: string, city: string, quantity: number, extra: { to?: string; destination?: string } = {}) {
  const at = CITIES[city];
  const body = {
    batchId,
    type: type as any,
    toPartnerId: extra.to || null,
    quantity,
    lat: at.lat,
    lng: at.lng,
    occurredAt: new Date().toISOString(),
    payload: { note: `${type} at ${at.name}`, ...(extra.destination ? { destination: extra.destination } : {}) },
  };
  return submitEvent(signer, body, sign(signer.privateKey, canonicalize(body)));
}

// Create a batch (and its units), then sign its MANUFACTURED event
router.post('/batches', async (req, res, next) => {
  try {
    const body = z.object({
      productName: z.string().trim().min(1).max(120),
      quantity: z.number().int().min(1).max(5000),
      city: cityKey,
      expiryDate: z.string().optional(),
    }).parse(req.body);

    const { batch, maker } = await withDb(async (db) => {
      const maker = await findOrCreateSigner(db, NETWORK.manufacturer);
      const { rows: [batch] } = await db.query(
        `INSERT INTO batches (batch_code, product_name, quantity, manufacturer_id, current_holder_id, expiry_date)
         VALUES ($1, $2, $3, $4, $4, $5)
         RETURNING *`,
        [
          `LOT-${Date.now().toString(36).toUpperCase()}`,
          body.productName,
          body.quantity,
          maker.id,
          body.expiryDate ? new Date(body.expiryDate) : new Date(Date.now() + 365 * 86400 * 1000),
        ]
      );
      await db.query(
        `INSERT INTO units (batch_id, serial, state, current_custodian_id)
         SELECT $1::uuid, s, 'CREATED', $2::uuid FROM generate_series(1, $3::int) AS s`,
        [batch.id, maker.id, body.quantity]
      );
      await db.query(`INSERT INTO batch_participants (batch_id, partner_id) VALUES ($1, $2)`, [batch.id, maker.id]);
      return { batch, maker };
    });

    await record(maker, batch.id, 'MANUFACTURED', body.city, body.quantity);
    res.status(201).json({ ok: true, batch });
  } catch (err) {
    next(err);
  }
});

// Record the next lifecycle step for a batch
router.post('/batches/:id/events', async (req, res, next) => {
  try {
    const body = z.object({
      type: z.enum(['INSPECTED', 'PACKAGED', 'DISPATCHED', 'RECEIVED', 'SOLD']),
      city: cityKey,
      quantity: z.number().int().min(0).optional(),
      to: z.enum(['logistics', 'distributor', 'retailer']).optional(),
      destination: cityKey.optional(),
    }).parse(req.body);

    const { signer, batch, recipient } = await withDb(async (db) => {
      const { rows: [batch] } = await db.query('SELECT * FROM batches WHERE id = $1', [req.params.id]);
      if (!batch) throw new HttpError(404, 'BATCH_NOT_FOUND', 'Batch not found');

      // RECEIVED is signed by whoever it was dispatched to; every other step by the current holder
      const actorId = body.type === 'RECEIVED' ? batch.pending_recipient_id : batch.current_holder_id;
      if (!actorId) throw new HttpError(409, 'NOTHING_TO_RECEIVE', 'This batch has not been dispatched to anyone.');
      const { rows: [actor] } = await db.query('SELECT * FROM partners WHERE id = $1', [actorId]);

      let recipient: Signer | undefined;
      if (body.type === 'DISPATCHED') {
        if (!body.to || !body.destination) throw new HttpError(400, 'MISSING_RECIPIENT', 'Choose who receives it and the destination city.');
        recipient = await findOrCreateSigner(db, NETWORK[body.to]);
      }
      return { signer: await signerFor(db, actor), batch, recipient };
    });

    const result = await record(signer, batch.id, body.type, body.city, body.quantity ?? batch.quantity, {
      to: recipient?.id,
      destination: body.destination,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
