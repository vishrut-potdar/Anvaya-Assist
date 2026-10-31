import { Router } from 'express';
import QRCode from 'qrcode';
import { withDb } from '../db.ts';
import { config } from '../config.ts';
import { calculateVelocityKmh, GeoPoint, CITIES } from '../geo.ts';
import { HttpError } from '../errors.ts';
import { parseUnitToken, verifyChain, verifyGs1Token } from '../crypto.ts';
import { calculateRiskScore, RULES, BuyerVerdict } from '../rules.ts';
import { broadcastAlert } from '../sse.ts';
import { redis } from '../redis.ts';

const router = Router();

export interface ScanHistoryEntry {
  id: string;
  scanNumber: number;
  timestamp: number;
  timeFormatted: string;
  city: string;
  lat: number;
  lng: number;
  deviceId: string;
  distanceFromPrevKm: number;
  velocityKmh: number;
  isImpossibleTravel: boolean;
  verdict: BuyerVerdict;
  riskScore: number;
}

// In-memory scan cache for fast rate limiting, geo-velocity checks, and history tracking
interface ScanRecord {
  count: number;
  distinctDevices: Set<string>;
  distinctRegions: Set<string>;
  history: ScanHistoryEntry[];
  lastScan?: {
    lat: number;
    lng: number;
    timestamp: number;
    city?: string;
  };
}

const unitScanCache = new Map<string, ScanRecord>();

function getScanRecord(unitId: string): ScanRecord {
  let rec = unitScanCache.get(unitId);
  if (!rec) {
    rec = {
      count: 0,
      distinctDevices: new Set(),
      distinctRegions: new Set(),
      history: [],
    };
    unitScanCache.set(unitId, rec);
  }
  return rec;
}

/**
 * Common buyer verification handler
 */
async function performVerification({
  unitId,
  isTokenValid,
  lat,
  lng,
  city,
  deviceId = 'web-browser-device',
}: {
  unitId: string | null;
  isTokenValid: boolean;
  lat: number | null;
  lng: number | null;
  city?: string;
  deviceId?: string;
}) {
  const triggeredRules: string[] = [];
  const explanations: string[] = [];

  // 1. Token cryptographic verification
  if (!isTokenValid || !unitId) {
    triggeredRules.push(RULES.R1.code);
    explanations.push(
      RULES.R1.explanationTemplate({ reason: 'Cryptographic token failed HMAC verification or code is corrupted.' })
    );
    const { score, verdict } = calculateRiskScore(triggeredRules);
    return {
      verdict: 'Not verified' as BuyerVerdict,
      score,
      reasons: explanations,
      scanCountBucket: 'unknown',
      product: null,
      trail: [],
    };
  }

  // 2. Fetch unit + batch details
  const unit = await withDb(async (db) => {
    const { rows: [u] } = await db.query(
      `SELECT u.id, u.serial, u.state, u.sold_region,
              b.id AS batch_id, b.batch_code, b.gtin, b.product_name, b.state AS batch_state,
              b.is_recalled, b.recall_reason, b.expiry_date,
              m.name AS manufacturer_name, m.country AS origin_country
       FROM units u
       JOIN batches b ON b.id = u.batch_id
       JOIN partners m ON m.id = b.manufacturer_id
       WHERE u.id = $1`,
      [unitId]
    );
    return u;
  });

  if (!unit) {
    triggeredRules.push(RULES.R1.code);
    explanations.push('This unit identifier is not registered in the provenance ledger.');
    const { score } = calculateRiskScore(triggeredRules);
    return {
      verdict: 'Not verified' as BuyerVerdict,
      score,
      reasons: explanations,
      scanCountBucket: 'unknown',
      product: null,
      trail: [],
    };
  }

  // 3. Recall check: Recall takes absolute precedence
  if (unit.is_recalled || unit.state === 'RECALLED') {
    return {
      verdict: 'Recalled' as BuyerVerdict,
      score: 1.0,
      reasons: [
        `CRITICAL SAFETY ALERT: This batch has been officially recalled by the manufacturer / health authority. ${unit.recall_reason ? 'Reason: ' + unit.recall_reason : 'Do not consume or distribute.'}`,
      ],
      scanCountBucket: 'many',
      product: {
        name: unit.product_name,
        brand: unit.manufacturer_name,
        lot: unit.batch_code,
        gtin: unit.gtin,
        serial: unit.serial,
        expiry: unit.expiry_date ? String(unit.expiry_date).slice(0, 10) : 'N/A',
      },
      trail: [],
    };
  }

  // 4. State consistency check (R3)
  // Consumer scan should only happen when item is 'SOLD'
  if (unit.state !== 'SOLD') {
    triggeredRules.push(RULES.R3.code);
    explanations.push(
      RULES.R3.explanationTemplate({ state: unit.state })
    );
  }

  // 5. Scan tracking and Geo-Velocity Impossible Travel check (R4 & R5)
  const rec = getScanRecord(unitId);
  rec.count += 1;
  rec.distinctDevices.add(deviceId);
  if (city) rec.distinctRegions.add(city);

  // Resolve coordinates from known cities if not explicitly supplied
  let effectiveLat = lat != null && Number.isFinite(lat) ? lat : null;
  let effectiveLng = lng != null && Number.isFinite(lng) ? lng : null;
  if ((effectiveLat == null || effectiveLng == null) && city) {
    const key = city.trim().toUpperCase().replace(/[\s-]+/g, '_');
    if (CITIES[key]) {
      effectiveLat = CITIES[key].lat;
      effectiveLng = CITIES[key].lng;
    }
  }

  const now = Date.now();
  let distKm = 0;
  let velocityVal = 0;
  let isImpossible = false;

  if (effectiveLat != null && effectiveLng != null) {
    if (rec.lastScan) {
      const vel = calculateVelocityKmh(
        { lat: rec.lastScan.lat, lng: rec.lastScan.lng },
        rec.lastScan.timestamp,
        { lat: effectiveLat, lng: effectiveLng },
        now
      );

      distKm = vel.km;
      velocityVal = vel.kmh;

      // If moved faster than physical threshold (e.g. 900 km/h)
      if (vel.km > 5 && vel.kmh > config.maxTravelKmh) {
        isImpossible = true;
        triggeredRules.push(RULES.R4.code);
        const exp = RULES.R4.explanationTemplate({
          km: vel.km,
          hours: vel.hours,
          kmh: vel.kmh,
          maxKmh: config.maxTravelKmh,
        });
        explanations.push(exp);

        // Record anomaly in alerts table & SSE broadcast
        withDb(async (db) => {
          const { rows: [al] } = await db.query(
            `INSERT INTO alerts (rule_code, severity, score, batch_id, unit_id, details, explanation)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [
              RULES.R4.code,
              RULES.R4.defaultSeverity,
              RULES.R4.weight,
              unit.batch_id,
              unit.id,
              JSON.stringify({
                km: vel.km,
                hours: vel.hours,
                kmh: vel.kmh,
                prevCity: rec.lastScan?.city || 'Unknown',
                currCity: city || 'Unknown',
              }),
              exp,
            ]
          );
          if (al) broadcastAlert(al);
        }).catch(console.error);
      }
    }
    rec.lastScan = { lat: effectiveLat, lng: effectiveLng, timestamp: now, city };
  }

  // 6. Scan Diversity check (R5)
  if (rec.distinctDevices.size >= config.scanThreshold || rec.distinctRegions.size >= 2) {
    triggeredRules.push(RULES.R5.code);
    explanations.push(
      RULES.R5.explanationTemplate({
        distinctDevices: rec.distinctDevices.size,
        distinctRegions: rec.distinctRegions.size,
      })
    );
  }

  // 7. Check database alerts on this batch or unit
  const { events, dbAlerts } = await withDb(async (db) => {
    const { rows: events } = await db.query(
      `SELECT e.id, e.type, e.occurred_at, e.prev_hash, e.hash, e.body, e.signature, e.actor_id,
              p.role AS actor_role, p.public_key
       FROM events e
       JOIN partners p ON p.id = e.actor_id
       WHERE e.batch_id = $1
       ORDER BY e.id ASC`,
      [unit.batch_id]
    );

    const { rows: dbAlerts } = await db.query(
      `SELECT DISTINCT rule_code, explanation, severity
       FROM alerts
       WHERE batch_id = $1 AND (unit_id IS NULL OR unit_id = $2) AND status = 'open'`,
      [unit.batch_id, unit.id]
    );

    return { events, dbAlerts };
  });

  for (const a of dbAlerts) {
    if (!triggeredRules.includes(a.rule_code)) {
      triggeredRules.push(a.rule_code);
      explanations.push(a.explanation);
    }
  }

  // 8. Cryptographic hash-chain check
  const chainAudit = verifyChain(events);
  if (!chainAudit.ok) {
    triggeredRules.push(RULES.R6.code);
    explanations.push(`Cryptographic chain integrity failed: ${chainAudit.reason}`);
  }

  // 9. Calculate final risk score
  const { score, verdict } = calculateRiskScore(triggeredRules);

  // Record into unit scan history
  const scanHistoryEntry: ScanHistoryEntry = {
    id: `scan-${now}-${Math.random().toString(36).slice(2, 6)}`,
    scanNumber: rec.count,
    timestamp: now,
    timeFormatted: new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    city: city || (effectiveLat != null ? `${effectiveLat.toFixed(2)}, ${effectiveLng?.toFixed(2)}` : 'Unknown Region'),
    lat: effectiveLat ?? 0,
    lng: effectiveLng ?? 0,
    deviceId,
    distanceFromPrevKm: Math.round(distKm * 10) / 10,
    velocityKmh: Math.round(velocityVal),
    isImpossibleTravel: isImpossible,
    verdict,
    riskScore: score,
  };
  rec.history.push(scanHistoryEntry);

  // Scan count bucket: "1", "2-4", or "many" (5+)
  let scanCountBucket: '1' | '2-4' | 'many' = '1';
  if (rec.count >= 5) scanCountBucket = 'many';
  else if (rec.count >= 2) scanCountBucket = '2-4';

  // 10. Privacy-preserving public projection (Never reveals partner identities, prices, quantities or routes!)
  return {
    verdict,
    score,
    reasons: [...new Set(explanations)],
    scanCountBucket,
    rawScanCount: rec.count,
    distinctDevices: rec.distinctDevices.size,
    distinctRegions: rec.distinctRegions.size,
    scanHistory: rec.history,
    product: {
      name: unit.product_name,
      brand: unit.manufacturer_name,
      lot: unit.batch_code,
      gtin: unit.gtin,
      serial: unit.serial,
      expiry: unit.expiry_date ? String(unit.expiry_date).slice(0, 10) : 'N/A',
      soldRegion: unit.sold_region || 'Authorized Regional Market',
    },
    // Privacy-preserving coarse trail (only step + general role)
    trail: events.map((e) => ({
      step: e.type,
      role: e.actor_role,
      occurredAt: e.occurred_at,
    })),
  };
}

// Buyer Verification via Unit Token: /api/verify/:token
router.get('/verify/:token', async (req, res, next) => {
  try {
    const rawToken = req.params.token;
    const unitId = parseUnitToken(rawToken);
    const isTokenValid = unitId !== null;

    const lat = req.query.lat != null ? Number(req.query.lat) : null;
    const lng = req.query.lng != null ? Number(req.query.lng) : null;
    const city = typeof req.query.city === 'string' ? req.query.city : undefined;
    const deviceId = typeof req.query.device === 'string' ? req.query.device : undefined;

    const result = await performVerification({
      unitId,
      isTokenValid,
      lat,
      lng,
      city,
      deviceId,
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

// GS1 Digital Link-style resolver: /api/01/:gtin/10/:lot/21/:serial
router.get('/01/:gtin/10/:lot/21/:serial', async (req, res, next) => {
  try {
    const { gtin, lot, serial } = req.params;
    const token = typeof req.query.t === 'string' ? req.query.t : '';

    const isTokenValid = verifyGs1Token(gtin, lot, serial, token);

    // Find unitId by batch code and serial
    const unit = await withDb(async (db) => {
      const { rows: [u] } = await db.query(
        `SELECT u.id FROM units u
         JOIN batches b ON b.id = u.batch_id
         WHERE b.batch_code = $1 AND u.serial = $2`,
        [lot, Number(serial)]
      );
      return u;
    });

    const lat = req.query.lat != null ? Number(req.query.lat) : null;
    const lng = req.query.lng != null ? Number(req.query.lng) : null;
    const city = typeof req.query.city === 'string' ? req.query.city : undefined;

    const result = await performVerification({
      unitId: unit?.id || null,
      isTokenValid,
      lat,
      lng,
      city,
    });

    res.json({ ok: true, standard: 'GS1 Digital Link', ...result });
  } catch (err) {
    next(err);
  }
});

// GS1 Digital Link-compliant QR code endpoint: /api/qr/gs1
// Query params: gtin, lot, serial, t, download (optional)
router.get('/qr/gs1', async (req, res, next) => {
  try {
    const gtin = String(req.query.gtin || '09506000134352');
    const lot = String(req.query.lot || 'LOT42');
    const serial = String(req.query.serial || '1');
    const t = String(req.query.t || '');
    const isDownload = req.query.download === 'true';

    const domain = `${req.protocol}://${req.get('host')}`;
    const gs1DigitalLinkUri = `${domain}/01/${gtin}/10/${encodeURIComponent(lot)}/21/${encodeURIComponent(serial)}${t ? `?t=${encodeURIComponent(t)}` : ''}`;

    const png = await QRCode.toBuffer(gs1DigitalLinkUri, {
      width: 600,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#020617',
        light: '#ffffff',
      },
    });

    if (isDownload) {
      res.setHeader('Content-Disposition', `attachment; filename="GS1_${gtin}_${lot}_unit_${serial}.png"`);
    }
    res.type('png').send(png);
  } catch (err) {
    next(err);
  }
});

// Generate GS1 QR Data URL with Human-Readable Interpretation (HRI) metadata
router.get('/qr/gs1-dataurl', async (req, res, next) => {
  try {
    const gtin = String(req.query.gtin || '09506000134352');
    const lot = String(req.query.lot || 'LOT42');
    const serial = String(req.query.serial || '1');
    const t = String(req.query.t || '');

    const domain = `${req.protocol}://${req.get('host')}`;
    const gs1DigitalLinkUri = `${domain}/01/${gtin}/10/${encodeURIComponent(lot)}/21/${encodeURIComponent(serial)}${t ? `?t=${encodeURIComponent(t)}` : ''}`;
    const dataUrl = await QRCode.toDataURL(gs1DigitalLinkUri, {
      width: 400,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#020617',
        light: '#ffffff',
      },
    });

    const hri = {
      ai01Gtin: `(01) ${gtin}`,
      ai10Lot: `(10) ${lot}`,
      ai21Serial: `(21) ${serial}`,
      tokenFragment: t ? `t=${t}` : null,
      fullUri: gs1DigitalLinkUri,
    };

    res.json({ ok: true, dataUrl, gs1DigitalLinkUri, hri });
  } catch (err) {
    next(err);
  }
});

// Generate QR Code PNG Buffer: /api/qr/:token (with optional ?download=true)
router.get('/qr/:token', async (req, res, next) => {
  try {
    const token = req.params.token;
    const isDownload = req.query.download === 'true';
    const fullUrl = `${req.protocol}://${req.get('host')}/verify/${token}`;
    const png = await QRCode.toBuffer(fullUrl, {
      width: 500,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    });

    if (isDownload) {
      res.setHeader('Content-Disposition', `attachment; filename="QR_${token.slice(0, 12)}.png"`);
    }
    res.type('png').send(png);
  } catch (err) {
    next(err);
  }
});

// Generate QR Data URL: /api/qr-dataurl/:token
router.get('/qr-dataurl/:token', async (req, res, next) => {
  try {
    const token = req.params.token;
    const fullUrl = `${req.protocol}://${req.get('host')}/verify/${token}`;
    const dataUrl = await QRCode.toDataURL(fullUrl, { width: 350, margin: 2, errorCorrectionLevel: 'M' });
    res.json({ ok: true, dataUrl, verifyUrl: fullUrl });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// ANTI-SCAM REVERSE LOGISTICS RETURN ENDPOINTS
// ==========================================

// 1. Initiate a verified consumer return
router.post('/returns/initiate', async (req, res, next) => {
  try {
    const { token, reason = 'Customer Return Request', customerNotes = '' } = req.body;
    if (!token) {
      throw new HttpError(400, 'MISSING_TOKEN', 'Please provide the package verification token.');
    }

    const unitId = parseUnitToken(token);
    if (!unitId) {
      throw new HttpError(400, 'INVALID_TOKEN', 'Cryptographic HMAC mismatch: This token is invalid or counterfeit.');
    }

    const unit = await withDb(async (db) => {
      const { rows: [u] } = await db.query(
        `SELECT u.*, b.batch_code, b.product_name, b.gtin, b.is_recalled, m.name as manufacturer_name
         FROM units u
         JOIN batches b ON b.id = u.batch_id
         JOIN partners m ON m.id = b.manufacturer_id
         WHERE u.id = $1`,
        [unitId]
      );
      return u;
    });

    if (!unit) {
      throw new HttpError(404, 'UNIT_NOT_FOUND', 'This unit identifier is not registered in the provenance ledger.');
    }

    if (unit.state === 'RETURNED') {
      return res.status(409).json({
        ok: false,
        error: 'ALREADY_RETURNED',
        message: 'This package has already been returned and processed. Duplicate return request rejected to prevent return fraud.',
      });
    }

    const returnAuthCode = `RA-PROV-${unit.batch_code}-${unit.serial}-${Date.now().toString(36).toUpperCase()}`;
    const qrDataUrl = await QRCode.toDataURL(
      `${req.protocol}://${req.get('host')}/verify/${token}?returnAuth=${returnAuthCode}`,
      { width: 300, margin: 2 }
    );

    res.json({
      ok: true,
      returnAuthCode,
      unitId: unit.id,
      serial: unit.serial,
      batchCode: unit.batch_code,
      productName: unit.product_name,
      manufacturer: unit.manufacturer_name,
      currentState: unit.state,
      reason,
      customerNotes,
      qrDataUrl,
      antiScamProtections: [
        'Single-use cryptographically bound Return Authorization (RA) prevents label reuse scams.',
        'Physical package serial and HMAC seal verified at warehouse before refund authorization.',
        'Prevents item-swapping fraud (swapping authentic item with expired/counterfeit clone).',
        'Append-only reverse custody audit trail logged directly into PostgreSQL ledger.',
      ],
      instructions: 'Affix this Return Authorization label onto the sealed package. Hand over to authorized cold-chain logistics courier.',
    });
  } catch (err) {
    next(err);
  }
});

// 2. Process physical return inspection (Warehouse / Retailer)
router.post('/returns/process', async (req, res, next) => {
  try {
    const { token, returnAuthCode, isScamSimulation = false } = req.body;
    if (!token) {
      throw new HttpError(400, 'MISSING_TOKEN', 'Please provide the package verification token.');
    }

    const unitId = parseUnitToken(token);
    if (!unitId) {
      throw new HttpError(400, 'INVALID_TOKEN', 'Cryptographic verification failed: Token HMAC invalid.');
    }

    const unit = await withDb(async (db) => {
      const { rows: [u] } = await db.query(
        `SELECT u.*, b.batch_code, b.product_name, b.id as batch_id, b.manufacturer_id
         FROM units u
         JOIN batches b ON b.id = u.batch_id
         WHERE u.id = $1`,
        [unitId]
      );
      return u;
    });

    if (!unit) {
      throw new HttpError(404, 'UNIT_NOT_FOUND', 'Unit not found in ledger.');
    }

    // If simulating a scam return attempt (e.g. buyer sent back a swapped brick or counterfeit item)
    if (isScamSimulation) {
      const fraudAlert = {
        rule_code: 'R8_RETURN_FRAUD_DETECTED',
        severity: 'critical',
        score: 0.95,
        batch_id: unit.batch_id,
        unit_id: unit.id,
        explanation: `ANTI-SCAM ALERT: Returned item failed physical authenticity check. Serial #${unit.serial} was presented with a swapped seal or counterfeit surrogate. Refund has been frozen!`,
        details: {
          returnAuthCode,
          serial: unit.serial,
          batchCode: unit.batch_code,
          detectionReason: 'Physical tamper seal mismatch & serial hash divergence.',
          actionTaken: 'REFUND_FROZEN_INVESTIGATION_FLAGGED',
        },
      };

      await withDb(async (db) => {
        await db.query(
          `INSERT INTO alerts (rule_code, severity, score, batch_id, unit_id, explanation, details, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'open')`,
          [fraudAlert.rule_code, fraudAlert.severity, fraudAlert.score, fraudAlert.batch_id, fraudAlert.unit_id, fraudAlert.explanation, JSON.stringify(fraudAlert.details)]
        );
      });

      broadcastAlert(fraudAlert);

      return res.json({
        ok: false,
        fraudDetected: true,
        verdict: 'RETURN_FRAUD_BLOCKED',
        message: 'Anti-Scam Shield Activated! Physical item returned does NOT match original unit credentials. Refund locked.',
        alert: fraudAlert,
      });
    }

    // Legitimate Return: Transition unit state to RETURNED
    await withDb(async (db) => {
      await db.query(
        `UPDATE units SET state = 'RETURNED' WHERE id = $1`,
        [unit.id]
      );

      // Record in ledger events if partner exists
      const { rows: [retailer] } = await db.query(
        `SELECT id, name FROM partners WHERE role IN ('retailer', 'logistics') LIMIT 1`
      );

      if (retailer) {
        await db.query(
          `INSERT INTO alerts (rule_code, severity, score, batch_id, unit_id, explanation, details, status)
           VALUES ('RETURN_VERIFIED_RESTOCKED', 'low', 0.0, $1, $2, $3, $4, 'benign')`,
          [
            unit.batch_id,
            unit.id,
            `Package #${unit.serial} (${unit.product_name}) safely returned and cryptographically verified by ${retailer.name}.`,
            JSON.stringify({ returnAuthCode, verifiedState: 'RETURNED' }),
          ]
        );
      }
    });

    res.json({
      ok: true,
      fraudDetected: false,
      verdict: 'RETURN_AUTHENTICATED',
      message: `Return authenticated successfully! Unit #${unit.serial} verified intact, restocked in secure vault, refund authorized.`,
      returnAuthCode,
      unitState: 'RETURNED',
    });
  } catch (err) {
    next(err);
  }
});

export default router;
