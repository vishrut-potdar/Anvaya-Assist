import { Router } from 'express';
import { withDb } from '../db.ts';
import { verifyChain, ChainVerificationResult } from '../crypto.ts';
import { HttpError } from '../errors.ts';

const router = Router();

// Backup for tamper restoration demo
let tamperedEventBackup: { id: number | string; originalBody: any; originalQuantity: number } | null = null;

// Audit and verify cryptographic hash chain integrity
router.get('/verify', async (req, res, next) => {
  try {
    const batchId = typeof req.query.batchId === 'string' ? req.query.batchId : undefined;

    const events = await withDb(async (db) => {
      let query = `
        SELECT e.id, e.prev_hash, e.hash, e.body, e.signature, e.actor_id,
               p.public_key, e.batch_id, e.type
        FROM events e
        JOIN partners p ON p.id = e.actor_id
      `;
      const params: any[] = [];
      if (batchId) {
        query += ` WHERE e.batch_id = $1`;
        params.push(batchId);
      }
      query += ` ORDER BY e.id ASC`;

      const { rows } = await db.query(query, params);
      return rows;
    });

    if (events.length === 0) {
      return res.json({
        ok: true,
        message: 'No events recorded in ledger yet',
        totalEventsChecked: 0,
      });
    }

    const audit: ChainVerificationResult = verifyChain(events);
    res.json({
      ...audit,
      totalEvents: events.length,
      latestHash: events[events.length - 1].hash,
      genesis: events[0].prev_hash,
    });
  } catch (err) {
    next(err);
  }
});

// Tamper demonstration endpoint (Modifies a DB record directly to simulate insider attack)
router.post('/tamper', async (req, res, next) => {
  try {
    const event = await withDb(async (db) => {
      const { rows: [target] } = await db.query(
        'SELECT * FROM events ORDER BY id ASC LIMIT 1'
      );
      if (!target) return null;

      tamperedEventBackup = {
        id: target.id,
        originalBody: target.body,
        originalQuantity: target.quantity,
      };

      // Maliciously tamper with the quantity in body without updating the cryptographic signature
      const modifiedBody = {
        ...target.body,
        quantity: target.quantity + 500, // Insider attempts to fraudulently inject 500 ghost units
        tamperedFlag: 'MALICIOUS_INSIDER_MODIFICATION',
      };

      await db.query(
        `UPDATE events
         SET body = $1, quantity = $2
         WHERE id = $3`,
        [JSON.stringify(modifiedBody), target.quantity + 500, target.id]
      );

      return target;
    });

    if (!event) {
      throw new HttpError(400, 'NO_EVENTS', 'Cannot demonstrate tamper: no events recorded yet.');
    }

    res.json({
      ok: true,
      message: `Simulated tamper on event #${event.id}: Injected +500 phantom units into event body directly in PostgreSQL. Now run chain verify to see cryptographic detection!`,
      tamperedEventId: event.id,
    });
  } catch (err) {
    next(err);
  }
});

// Restore tampered event
router.post('/restore', async (_req, res, next) => {
  try {
    if (!tamperedEventBackup) {
      return res.json({ ok: true, message: 'No active tamper to restore' });
    }

    await withDb(async (db) => {
      await db.query(
        `UPDATE events SET body = $1, quantity = $2 WHERE id = $3`,
        [JSON.stringify(tamperedEventBackup!.originalBody), tamperedEventBackup!.originalQuantity, tamperedEventBackup!.id]
      );
    });

    const restoredId = tamperedEventBackup.id;
    tamperedEventBackup = null;

    res.json({
      ok: true,
      message: `Event #${restoredId} restored to pristine cryptographic state. Chain integrity is restored!`,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
