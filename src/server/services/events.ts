import { z } from 'zod';
import { withDb } from '../db.ts';
import { GENESIS, canonicalize, eventHash, verifySig } from '../crypto.ts';
import { HttpError } from '../errors.ts';
import { analyzeEvent } from '../worker.ts';
import { broadcastEvent } from '../sse.ts';

export const EVENT_TYPES = [
  'MANUFACTURED',
  'INSPECTED',
  'PACKAGED',
  'DISPATCHED',
  'RECEIVED',
  'SOLD',
  'RECALLED',
  'DESTROYED',
  'RETURNED',
] as const;

export const ROLE_EVENTS: Record<string, string[]> = {
  manufacturer: ['MANUFACTURED', 'INSPECTED', 'PACKAGED', 'DISPATCHED', 'RECALLED'],
  logistics: ['RECEIVED', 'DISPATCHED'],
  distributor: ['RECEIVED', 'DISPATCHED'],
  retailer: ['RECEIVED', 'SOLD', 'RETURNED'],
  regulator: ['RECALLED', 'DESTROYED'],
};

export const eventBodySchema = z.object({
  batchId: z.string().uuid(),
  type: z.enum(EVENT_TYPES),
  toPartnerId: z.string().uuid().nullable().optional(),
  quantity: z.number().int().nonnegative(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  occurredAt: z.string().datetime({ offset: true }),
  payload: z.record(z.string(), z.any()).default({}),
});

export type EventBody = z.infer<typeof eventBodySchema>;

export async function submitEvent(
  partner: { id: string; name: string; role: string; public_key: string },
  body: EventBody,
  signature: string
) {
  // 1. Role permission check
  const allowed = ROLE_EVENTS[partner.role] || [];
  if (!allowed.includes(body.type)) {
    throw new HttpError(
      403,
      'ROLE_NOT_ALLOWED',
      `Partner with role '${partner.role}' is not authorized to submit '${body.type}' events.`
    );
  }

  // 2. Cryptographic signature check (Ed25519 over RFC 8785 canonical JSON)
  const canonicalBody = canonicalize(body);
  const isSigValid = verifySig(partner.public_key, canonicalBody, signature);
  if (!isSigValid) {
    throw new HttpError(
      401,
      'BAD_SIGNATURE',
      'Ed25519 signature is invalid. It does not match the canonical event body and your registered public key.'
    );
  }

  const saved = await withDb(async (db) => {
    // 3. Fetch current batch state
    const { rows: [batch] } = await db.query(
      'SELECT * FROM batches WHERE id = $1',
      [body.batchId]
    );
    if (!batch) {
      throw new HttpError(404, 'BATCH_NOT_FOUND', `Batch ${body.batchId} does not exist`);
    }

    // 4. Validate state machine transition
    const { rows: [transition] } = await db.query(
      'SELECT to_state FROM state_transitions WHERE from_state = $1 AND on_event = $2',
      [batch.state, body.type]
    );

    if (!transition && body.type !== 'RECALLED') {
      throw new HttpError(
        409,
        'ILLEGAL_TRANSITION',
        `Illegal state transition: Cannot transition from '${batch.state}' via event '${body.type}'`
      );
    }

    // 5. Custody check
    if (body.type !== 'RECEIVED' && body.type !== 'RECALLED' && batch.current_holder_id !== partner.id) {
      throw new HttpError(
        403,
        'NOT_CUSTODIAN',
        `Custody check failed: Only current holder (${batch.current_holder_id}) can record '${body.type}' events, not ${partner.name} (${partner.id}).`
      );
    }

    if (body.type === 'DISPATCHED' && !body.toPartnerId) {
      throw new HttpError(
        400,
        'MISSING_RECIPIENT',
        `DISPATCHED events require a valid toPartnerId recipient.`
      );
    }

    // 6. Compute hash chain
    const { rows: [lastEvent] } = await db.query(
      'SELECT hash FROM events WHERE batch_id = $1 ORDER BY id DESC LIMIT 1',
      [body.batchId]
    );
    const prevHash = lastEvent ? lastEvent.hash : GENESIS;
    const hash = eventHash(prevHash, body, signature, partner.id);

    // 7. Insert event into append-only log
    const { rows: [eventRow] } = await db.query(
      `INSERT INTO events (
        batch_id, type, actor_id, to_partner_id, quantity, lat, lng, occurred_at, body, signature, prev_hash, hash
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, type, batch_id, actor_id, to_partner_id, quantity, lat, lng, occurred_at, prev_hash, hash, created_at`,
      [
        body.batchId,
        body.type,
        partner.id,
        body.toPartnerId || null,
        body.quantity,
        body.lat ?? null,
        body.lng ?? null,
        body.occurredAt,
        JSON.stringify(body),
        signature,
        prevHash,
        hash,
      ]
    );

    // 8. Update batch state and custody
    const nextState = body.type === 'RECALLED' ? 'RECALLED' : transition?.to_state || batch.state;
    const newHolderId = body.type === 'RECEIVED' ? partner.id : batch.current_holder_id;
    const pendingRecipient = body.type === 'DISPATCHED' ? body.toPartnerId : null;
    const isRecalled = body.type === 'RECALLED' || batch.is_recalled;

    await db.query(
      `UPDATE batches SET
        state = $1,
        current_holder_id = $2,
        pending_recipient_id = $3,
        is_recalled = $4,
        recalled_at = CASE WHEN $4 AND recalled_at IS NULL THEN now() ELSE recalled_at END
       WHERE id = $5`,
      [nextState, newHolderId, pendingRecipient, isRecalled, batch.id]
    );

    // Update batch units state
    await db.query(
      `UPDATE units SET state = $1, current_custodian_id = $2 WHERE batch_id = $3`,
      [nextState, newHolderId, batch.id]
    );

    // Register participants
    await db.query(
      `INSERT INTO batch_participants (batch_id, partner_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [batch.id, partner.id]
    );
    if (body.toPartnerId) {
      await db.query(
        `INSERT INTO batch_participants (batch_id, partner_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [batch.id, body.toPartnerId]
      );
    }

    return eventRow;
  });

  // 9. Run asynchronous anomaly inspection & broadcast
  setTimeout(() => {
    analyzeEvent(saved.id).catch((err) => console.error('Anomaly worker error:', err));
  }, 10);

  broadcastEvent(saved);

  return {
    ok: true,
    eventId: saved.id,
    hash: saved.hash,
    prevHash: saved.prev_hash,
  };
}
