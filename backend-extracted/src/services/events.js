import { z } from 'zod';
import { asSystem } from '../db.js';
import { GENESIS, canonicalize, eventHash, verifySig } from '../crypto.js';
import { eventQueue } from '../queue.js';
import { HttpError } from '../errors.js';

export const EVENT_TYPES = ['MANUFACTURED', 'INSPECTED', 'PACKAGED', 'DISPATCHED', 'RECEIVED', 'SOLD'];

// which partner role may record which event
export const ROLE_EVENTS = {
  manufacturer: ['MANUFACTURED', 'INSPECTED', 'PACKAGED', 'DISPATCHED'],
  logistics: ['RECEIVED', 'DISPATCHED'],
  distributor: ['RECEIVED', 'DISPATCHED'],
  retailer: ['RECEIVED', 'SOLD'],
};

// Every field is required (use null when empty) so the signed JSON is exactly what we store.
export const eventBodySchema = z.object({
  batchId: z.string().uuid(),
  type: z.enum(EVENT_TYPES),
  toPartnerId: z.string().uuid().nullable(),
  quantity: z.number().int().nonnegative(),
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
  occurredAt: z.string().datetime({ offset: true }),
  payload: z.record(z.string(), z.any()),
}).strict();

export async function submitEvent(partner, body, signature) {
  if (!ROLE_EVENTS[partner.role].includes(body.type)) {
    throw new HttpError(403, 'ROLE_NOT_ALLOWED', `A ${partner.role} cannot record ${body.type}`);
  }
  if (!verifySig(partner.public_key, canonicalize(body), signature)) {
    throw new HttpError(401, 'BAD_SIGNATURE', 'Signature does not match the event body and your registered key');
  }

  const saved = await asSystem(async (db) => {
    // serialize writers per batch so the hash chain never forks
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [body.batchId]);
    const { rows: [batch] } = await db.query('SELECT id FROM batches WHERE id = $1', [body.batchId]);
    if (!batch) throw new HttpError(404, 'BATCH_NOT_FOUND', 'Unknown batch');

    const { rows: [last] } = await db.query(
      'SELECT hash FROM events WHERE batch_id = $1 ORDER BY id DESC LIMIT 1', [body.batchId]);
    const prevHash = last ? last.hash : GENESIS;
    const hash = eventHash(prevHash, body, signature, partner.id);

    // the apply_event trigger validates the state machine + custody and updates the batch
    const { rows: [row] } = await db.query(
      `INSERT INTO events (batch_id, type, actor_id, to_partner_id, quantity, lat, lng, occurred_at, body, signature, prev_hash, hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id, hash, prev_hash`,
      [body.batchId, body.type, partner.id, body.toPartnerId, body.quantity, body.lat, body.lng,
       body.occurredAt, body, signature, prevHash, hash]);
    return row;
  });

  // event-driven: anomaly checks run in a worker, not in the request
  await eventQueue.add('analyze', { eventId: saved.id }, { attempts: 3, removeOnComplete: true });
  return { eventId: saved.id, hash: saved.hash, prevHash: saved.prev_hash };
}
