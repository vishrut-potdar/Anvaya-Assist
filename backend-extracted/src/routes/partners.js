import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { config } from '../config.js';
import { HttpError } from '../errors.js';
import { generateApiKey, generateKeyPair, sha256 } from '../crypto.js';

const router = Router();

// Onboard a partner (admin only). If no publicKey is supplied we generate a keypair for convenience
// (demo mode) and return the private key ONCE. In production partners keep their own key.
router.post('/', async (req, res) => {
  if (req.header('x-admin-key') !== config.adminKey) throw new HttpError(401, 'ADMIN_ONLY', 'Invalid admin key');
  const body = z.object({
    name: z.string().min(1),
    role: z.enum(['manufacturer', 'logistics', 'distributor', 'retailer']),
    publicKey: z.string().optional(),
  }).parse(req.body);

  let { publicKey } = body, privateKey;
  if (!publicKey) ({ publicKey, privateKey } = generateKeyPair());
  const apiKey = generateApiKey();

  const { rows: [partner] } = await pool.query(
    'INSERT INTO partners (name, role, public_key, api_key_hash) VALUES ($1,$2,$3,$4) RETURNING id, name, role, created_at',
    [body.name, body.role, publicKey, sha256(apiKey)]);
  res.status(201).json({ partner, apiKey, ...(privateKey && { privateKey }) });
});

export default router;
