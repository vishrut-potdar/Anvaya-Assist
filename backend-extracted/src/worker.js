import { Worker } from 'bullmq';
import { redis } from './redis.js';
import { asSystem } from './db.js';
import { config } from './config.js';
import { GENESIS, eventHash } from './crypto.js';
import { haversineKm } from './geo.js';

const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

export async function analyzeEvent(eventId) {
  await asSystem(async (db) => {
    const { rows: [ev] } = await db.query(
      'SELECT e.*, b.quantity AS batch_quantity FROM events e JOIN batches b ON b.id = e.batch_id WHERE e.id = $1', [eventId]);
    if (!ev) return;
    const { rows: [prev] } = await db.query(
      'SELECT * FROM events WHERE batch_id = $1 AND id < $2 ORDER BY id DESC LIMIT 1', [ev.batch_id, ev.id]);

    const found = []; // [type, severity, details]

    // 1. chain integrity
    const expectedPrev = prev ? prev.hash : GENESIS;
    if (ev.prev_hash !== expectedPrev || ev.hash !== eventHash(ev.prev_hash, ev.body, ev.signature, ev.actor_id)) {
      found.push(['BROKEN_CHAIN', 'high', { expectedPrev, got: ev.prev_hash }]);
    }

    // 2. quantity can never exceed what the batch was created with
    if (ev.quantity > ev.batch_quantity) {
      found.push(['QUANTITY_EXCEEDS_BATCH', 'high', { batchQuantity: ev.batch_quantity, reported: ev.quantity }]);
    }

    // 3. time + travel plausibility vs the previous event
    if (prev) {
      const hours = (ev.occurred_at - prev.occurred_at) / 36e5;
      if (hours < 0) found.push(['TIMESTAMP_REGRESSION', 'medium', { hours: round(hours, 2) }]);
      if (prev.lat != null && ev.lat != null) {
        const km = haversineKm({ lat: prev.lat, lng: prev.lng }, { lat: ev.lat, lng: ev.lng });
        const kmh = hours > 0 ? km / hours : km > 1 ? Infinity : 0;
        if (kmh > config.maxTravelKmh) {
          found.push(['IMPOSSIBLE_TRAVEL', 'high', { km: round(km), hours: round(hours, 2), kmh: Number.isFinite(kmh) ? round(kmh) : null }]);
        }
      }
    }

    // 4. dispatch/receipt reconciliation
    if (ev.type === 'RECEIVED') {
      const { rows: [disp] } = await db.query(
        "SELECT * FROM events WHERE batch_id = $1 AND type = 'DISPATCHED' AND id < $2 ORDER BY id DESC LIMIT 1", [ev.batch_id, ev.id]);
      if (disp) {
        if (disp.quantity !== ev.quantity) {
          found.push(['QUANTITY_MISMATCH', 'high', { dispatched: disp.quantity, received: ev.quantity }]);
        }
        if (disp.to_partner_id !== ev.actor_id) {
          found.push(['ROUTE_MISMATCH', 'high', { expectedRecipient: disp.to_partner_id, actualReceiver: ev.actor_id }]);
        }
      }
    }

    for (const [type, severity, details] of found) {
      await db.query(
        'INSERT INTO alerts (type, severity, batch_id, event_id, details) VALUES ($1,$2,$3,$4,$5)',
        [type, severity, ev.batch_id, ev.id, details]);
    }
  });
}

export function startWorker() {
  const worker = new Worker('events', (job) => analyzeEvent(job.data.eventId), {
    connection: redis.duplicate(),
    concurrency: 5,
  });
  worker.on('failed', (job, err) => console.error('analyze failed', job?.data, err.message));
  return worker;
}
