import { withDb } from './db.ts';
import { config } from './config.ts';
import { GENESIS, eventHash } from './crypto.ts';
import { haversineKm, calculateVelocityKmh } from './geo.ts';
import { RULES } from './rules.ts';
import { broadcastAlert } from './sse.ts';

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

export async function analyzeEvent(eventId: number | string): Promise<void> {
  await withDb(async (db) => {
    const { rows: [ev] } = await db.query(
      `SELECT e.*, b.quantity AS batch_quantity, b.batch_code, b.is_recalled, b.recalled_at, b.state AS batch_state
       FROM events e
       JOIN batches b ON b.id = e.batch_id
       WHERE e.id = $1`,
      [eventId]
    );

    if (!ev) return;

    const { rows: [prev] } = await db.query(
      `SELECT * FROM events
       WHERE batch_id = $1 AND id < $2
       ORDER BY id DESC LIMIT 1`,
      [ev.batch_id, ev.id]
    );

    const anomalies: Array<{
      ruleCode: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
      score: number;
      details: Record<string, any>;
      explanation: string;
    }> = [];

    // 1. Cryptographic chain integrity
    const expectedPrev = prev ? prev.hash : GENESIS;
    const expectedHash = eventHash(ev.prev_hash, ev.body, ev.signature, ev.actor_id);

    if (ev.prev_hash !== expectedPrev || ev.hash !== expectedHash) {
      const rule = RULES.R6;
      anomalies.push({
        ruleCode: rule.code,
        severity: 'high',
        score: rule.weight,
        details: { expectedPrev, got: ev.prev_hash, expectedHash, gotHash: ev.hash },
        explanation: 'The cryptographic hash chain was broken or tampered with.',
      });
    }

    // 2. Quantity bounds against batch commissioning size
    if (ev.quantity > ev.batch_quantity) {
      const rule = RULES.R7;
      anomalies.push({
        ruleCode: rule.code,
        severity: 'high',
        score: rule.weight,
        details: { batchQuantity: ev.batch_quantity, reported: ev.quantity, delta: ev.quantity - ev.batch_quantity },
        explanation: `Reported event quantity (${ev.quantity}) exceeds commissioned batch capacity (${ev.batch_quantity}).`,
      });
    }

    // 3. Travel velocity and timestamp checks against previous event
    if (prev) {
      const t1 = new Date(prev.occurred_at).getTime();
      const t2 = new Date(ev.occurred_at).getTime();
      const hours = (t2 - t1) / 36e5;

      if (hours < 0) {
        anomalies.push({
          ruleCode: 'TIMESTAMP_REGRESSION',
          severity: 'medium',
          score: 0.4,
          details: { hours: round(hours, 2), prevOccurred: prev.occurred_at, currOccurred: ev.occurred_at },
          explanation: `Chronological violation: Event timestamp (${ev.occurred_at}) precedes previous event (${prev.occurred_at}).`,
        });
      }

      if (prev.lat != null && ev.lat != null && prev.lng != null && ev.lng != null) {
        const vel = calculateVelocityKmh(
          { lat: prev.lat, lng: prev.lng },
          t1,
          { lat: ev.lat, lng: ev.lng },
          t2
        );

        const limit = config.maxTravelKmh;
        if (vel.kmh > limit) {
          const rule = RULES.R4;
          anomalies.push({
            ruleCode: rule.code,
            severity: 'high',
            score: rule.weight,
            details: {
              km: vel.km,
              hours: vel.hours,
              kmh: vel.kmh,
              maxKmh: limit,
              from: { lat: prev.lat, lng: prev.lng },
              to: { lat: ev.lat, lng: ev.lng },
            },
            explanation: rule.explanationTemplate({
              km: vel.km,
              hours: vel.hours,
              kmh: vel.kmh,
              maxKmh: limit,
            }),
          });
        }
      }
    }

    // 4. Dispatch vs Receipt reconciliation
    if (ev.type === 'RECEIVED') {
      const { rows: [disp] } = await db.query(
        `SELECT * FROM events
         WHERE batch_id = $1 AND type = 'DISPATCHED' AND id < $2
         ORDER BY id DESC LIMIT 1`,
        [ev.batch_id, ev.id]
      );

      if (disp) {
        if (disp.quantity !== ev.quantity) {
          const delta = disp.quantity - ev.quantity;
          const rule = RULES.R7;
          anomalies.push({
            ruleCode: rule.code,
            severity: 'high',
            score: rule.weight,
            details: { dispatched: disp.quantity, received: ev.quantity, delta },
            explanation: rule.explanationTemplate({
              dispatched: disp.quantity,
              received: ev.quantity,
              delta,
            }),
          });
        }

        if (disp.to_partner_id && disp.to_partner_id !== ev.actor_id) {
          const rule = RULES.R8;
          anomalies.push({
            ruleCode: rule.code,
            severity: 'medium',
            score: rule.weight,
            details: { expectedReceiver: disp.to_partner_id, actualReceiver: ev.actor_id },
            explanation: rule.explanationTemplate({
              expectedReceiver: disp.to_partner_id,
              actualReceiver: ev.actor_id,
            }),
          });
        }
      }
    }

    // 5. Post-Recall Movement check
    if (ev.is_recalled && ev.type !== 'RECALLED' && ev.type !== 'DESTROYED') {
      const rule = RULES.R9;
      anomalies.push({
        ruleCode: rule.code,
        severity: 'critical',
        score: rule.weight,
        details: { batchCode: ev.batch_code, type: ev.type, recalledAt: ev.recalled_at },
        explanation: rule.explanationTemplate({
          batchCode: ev.batch_code,
          type: ev.type,
          recalledAt: ev.recalled_at,
        }),
      });
    }

    // Persist anomalies into DB & broadcast via SSE
    for (const anom of anomalies) {
      const res = await db.query(
        `INSERT INTO alerts (rule_code, severity, score, batch_id, event_id, details, explanation)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [anom.ruleCode, anom.severity, anom.score, ev.batch_id, ev.id, JSON.stringify(anom.details), anom.explanation]
      );
      if (res.rows[0]) {
        broadcastAlert(res.rows[0]);
      }
    }
  });
}
