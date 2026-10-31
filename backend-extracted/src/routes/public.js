import { Router } from 'express';
import QRCode from 'qrcode';
import { asSystem } from '../db.js';
import { redis } from '../redis.js';
import { config } from '../config.js';
import { haversineKm } from '../geo.js';
import { HttpError } from '../errors.js';
import { parseUnitToken, verifyChain } from '../crypto.js';

const router = Router();

const REASONS = {
  QUANTITY_MISMATCH: 'Shipment quantities in the records do not reconcile.',
  ROUTE_MISMATCH: 'This product was received by someone other than the intended recipient.',
  IMPOSSIBLE_TRAVEL: 'Movement records show an impossible travel time.',
  QUANTITY_EXCEEDS_BATCH: 'Recorded quantities exceed the original batch size.',
  BROKEN_CHAIN: 'The product history failed an integrity check.',
  TIMESTAMP_REGRESSION: 'Event timestamps are out of order.',
  DUPLICATE_SCAN: 'This code has been scanned unusually many times.',
  SCAN_IMPOSSIBLE_TRAVEL: 'This code was scanned in far-apart places in a short time.',
};

// scan counters + velocity checks live in Redis (fast, no DB write per scan)
async function trackScan(unitId, lat, lng) {
  const count = await redis.incr(`scan:${unitId}`);
  const flags = [];
  if (count > config.scanThreshold) flags.push(['DUPLICATE_SCAN', 'high', { count }]);
  if (lat != null && lng != null) {
    const prevRaw = await redis.get(`lastscan:${unitId}`);
    await redis.set(`lastscan:${unitId}`, JSON.stringify({ lat, lng, t: Date.now() }));
    if (prevRaw) {
      const p = JSON.parse(prevRaw);
      const km = haversineKm(p, { lat, lng });
      const hours = Math.max((Date.now() - p.t) / 36e5, 1 / 3600);
      if (km > 1 && km / hours > config.maxTravelKmh) flags.push(['SCAN_IMPOSSIBLE_TRAVEL', 'high', { km: Math.round(km) }]);
    }
  }
  return { count, flags };
}

// Buyer-facing check. Public, but exposes only a verdict + a coarse trail (no partner names/quantities).
router.get('/verify/:token', async (req, res) => {
  const unitId = parseUnitToken(req.params.token);
  if (!unitId) return res.json({ verdict: 'INVALID', reasons: ['This code was not issued by the system.'] });

  const lat = req.query.lat != null ? Number(req.query.lat) : null;
  const lng = req.query.lng != null ? Number(req.query.lng) : null;

  const unit = await asSystem(async (db) => (await db.query(
    `SELECT u.id, u.serial, b.id AS batch_id, b.product_name, b.state, m.name AS manufacturer
     FROM units u JOIN batches b ON b.id = u.batch_id JOIN partners m ON m.id = b.manufacturer_id
     WHERE u.id = $1`, [unitId])).rows[0]);
  if (!unit) return res.json({ verdict: 'INVALID', reasons: ['This code is not registered.'] });

  const scan = await trackScan(unitId, Number.isFinite(lat) ? lat : null, Number.isFinite(lng) ? lng : null);

  const { events, alerts } = await asSystem(async (db) => {
    // persist each new scan anomaly once per day per unit
    for (const [type, severity, details] of scan.flags) {
      const first = await redis.set(`alertflag:${type}:${unitId}`, '1', 'EX', 86400, 'NX');
      if (first) {
        await db.query('INSERT INTO alerts (type, severity, batch_id, unit_id, details) VALUES ($1,$2,$3,$4,$5)',
          [type, severity, unit.batch_id, unitId, details]);
      }
    }
    const events = (await db.query(
      `SELECT e.id, e.type, e.actor_id, e.body, e.signature, e.prev_hash, e.hash, e.occurred_at,
              p.role AS actor_role, p.public_key
       FROM events e JOIN partners p ON p.id = e.actor_id WHERE e.batch_id = $1 ORDER BY e.id`, [unit.batch_id])).rows;
    const alerts = (await db.query(
      `SELECT DISTINCT type FROM alerts WHERE severity = 'high' AND batch_id = $1 AND (unit_id IS NULL OR unit_id = $2)`,
      [unit.batch_id, unitId])).rows;
    return { events, alerts };
  });

  const reasons = alerts.map((a) => REASONS[a.type] ?? 'A supply-chain anomaly was detected.');
  if (!verifyChain(events).ok) reasons.push(REASONS.BROKEN_CHAIN);

  const verdict = reasons.length ? 'SUSPICIOUS' : unit.state === 'CREATED' ? 'PENDING' : 'GENUINE';
  res.json({
    verdict,
    reasons: [...new Set(reasons)],
    product: { name: unit.product_name, manufacturer: unit.manufacturer, serial: unit.serial },
    scanCount: scan.count,
    trail: events.map((e) => ({ step: e.type, by: e.actor_role, at: e.occurred_at })),
  });
});

// QR image that encodes the buyer-facing verify URL
router.get('/qr/:token', async (req, res) => {
  if (!parseUnitToken(req.params.token)) throw new HttpError(404, 'NOT_FOUND', 'Invalid code');
  const png = await QRCode.toBuffer(`${config.publicVerifyUrl}/${req.params.token}`, { width: 400, margin: 1 });
  res.type('png').send(png);
});

export default router;
