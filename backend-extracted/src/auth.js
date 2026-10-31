import { pool } from './db.js';
import { sha256 } from './crypto.js';
import { HttpError } from './errors.js';

export async function requireAuth(req, _res, next) {
  const key = req.header('x-api-key');
  if (!key) throw new HttpError(401, 'NO_API_KEY', 'Send your key in the x-api-key header');
  const { rows: [p] } = await pool.query(
    'SELECT id, name, role, public_key FROM partners WHERE api_key_hash = $1', [sha256(key)]);
  if (!p) throw new HttpError(401, 'BAD_API_KEY', 'Unknown API key');
  req.partner = p;
  next();
}

export const requireRole = (...roles) => (req, _res, next) => {
  if (!roles.includes(req.partner.role)) throw new HttpError(403, 'FORBIDDEN', `Requires role: ${roles.join(', ')}`);
  next();
};
