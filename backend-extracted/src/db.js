import pg from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({ connectionString: config.databaseUrl });

// Runs fn inside a transaction with the RLS context set (per-transaction settings).
async function withContext({ role, partnerId = '' }, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.role', $1, true), set_config('app.partner_id', $2, true)", [role, partnerId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Partner context: Postgres RLS limits every read to batches this partner took part in.
export const asPartner = (partnerId, fn) => withContext({ role: 'partner', partnerId }, fn);
// System context: for writes (after signature checks), the worker, and the public verify endpoint.
export const asSystem = (fn) => withContext({ role: 'system' }, fn);
