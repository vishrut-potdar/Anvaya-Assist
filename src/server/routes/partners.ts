import { Router } from 'express';
import { z } from 'zod';
import { withDb } from '../db.ts';
import { generateApiKey, generateKeyPair, keyFingerprint, sha256 } from '../crypto.ts';
import { HttpError } from '../errors.ts';
import { requireAdmin } from '../auth.ts';

const router = Router();

// Onboard partner (Admin only)
router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const body = z.object({
      name: z.string().min(1),
      role: z.enum(['manufacturer', 'logistics', 'distributor', 'retailer', 'regulator']),
      country: z.string().default('IN'),
      publicKey: z.string().optional(),
    }).parse(req.body);

    let publicKey = body.publicKey;
    let privateKey: string | undefined;

    if (!publicKey) {
      const keys = generateKeyPair();
      publicKey = keys.publicKey;
      privateKey = keys.privateKey;
    }

    const apiKey = generateApiKey();
    const apiKeyHash = sha256(apiKey);
    const fingerprint = keyFingerprint(publicKey);

    const partner = await withDb(async (db) => {
      const { rows: [p] } = await db.query(
        `INSERT INTO partners (name, role, country, public_key, api_key_hash)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, role, country, public_key, created_at`,
        [body.name, body.role, body.country, publicKey, apiKeyHash]
      );

      await db.query(
        `INSERT INTO partner_keys (partner_id, public_key, fingerprint)
         VALUES ($1, $2, $3)`,
        [p.id, publicKey, fingerprint]
      );

      return p;
    });

    res.status(201).json({
      ok: true,
      partner,
      apiKey,
      fingerprint,
      ...(privateKey && { privateKey }),
    });
  } catch (err) {
    next(err);
  }
});

// List all partners
router.get('/', async (_req, res, next) => {
  try {
    const partners = await withDb(async (db) => {
      const { rows } = await db.query(
        `SELECT p.id, p.name, p.role, p.country, p.status, p.public_key, p.created_at,
                pk.fingerprint
         FROM partners p
         LEFT JOIN partner_keys pk ON pk.partner_id = p.id AND pk.revoked_at IS NULL
         ORDER BY p.name ASC`
      );
      return rows;
    });
    res.json({ ok: true, partners });
  } catch (err) {
    next(err);
  }
});

export default router;
