import { DbClient } from './db.ts';
import { generateApiKey, generateKeyPair, keyFingerprint, sha256 } from './crypto.ts';

// Private keys for partners the server signs on behalf of (demo + workspace), keyed by public key.
// Persisted in custodial_keys so every serverless instance signs as the same partner; cached per process.
const keyCache = new Map<string, string>();

async function saveKey(db: DbClient, publicKey: string, privateKey: string) {
  keyCache.set(publicKey, privateKey);
  await db.query(
    'INSERT INTO custodial_keys (public_key, private_key) VALUES ($1, $2) ON CONFLICT (public_key) DO NOTHING',
    [publicKey, privateKey]
  );
}

async function loadKey(db: DbClient, publicKey: string): Promise<string | undefined> {
  if (keyCache.has(publicKey)) return keyCache.get(publicKey);
  const { rows: [row] } = await db.query('SELECT private_key FROM custodial_keys WHERE public_key = $1', [publicKey]);
  if (row) keyCache.set(publicKey, row.private_key);
  return row?.private_key;
}

export interface Signer {
  id: string;
  name: string;
  role: string;
  public_key: string;
  privateKey: string;
}

export async function insertPartner(
  db: DbClient,
  def: { name: string; role: string; country?: string }
): Promise<Signer & Record<string, any>> {
  const keys = generateKeyPair();
  const { rows: [p] } = await db.query(
    `INSERT INTO partners (name, role, country, public_key, api_key_hash)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [def.name, def.role, def.country || 'IN', keys.publicKey, sha256(generateApiKey())]
  );
  await db.query(
    `INSERT INTO partner_keys (partner_id, public_key, fingerprint) VALUES ($1, $2, $3)`,
    [p.id, keys.publicKey, keyFingerprint(keys.publicKey)]
  );
  await saveKey(db, keys.publicKey, keys.privateKey);
  return { ...p, privateKey: keys.privateKey };
}

/** Return a signer for an existing partner row. */
export async function signerFor(db: DbClient, partner: any): Promise<Signer> {
  const known = await loadKey(db, partner.public_key);
  if (known) return { ...partner, privateKey: known };

  // Partner the server never held a key for (e.g. onboarded via the admin API): rotate to a custodial key.
  // Older events by this partner will then fail the chain audit.
  const keys = generateKeyPair();
  await db.query('UPDATE partners SET public_key = $1 WHERE id = $2', [keys.publicKey, partner.id]);
  await db.query(
    `INSERT INTO partner_keys (partner_id, public_key, fingerprint) VALUES ($1, $2, $3)`,
    [partner.id, keys.publicKey, keyFingerprint(keys.publicKey)]
  );
  await saveKey(db, keys.publicKey, keys.privateKey);
  return { ...partner, public_key: keys.publicKey, privateKey: keys.privateKey };
}

/** Find a partner by name (creating it if missing) and return a signer for it. */
export async function findOrCreateSigner(
  db: DbClient,
  def: { name: string; role: string; country?: string }
): Promise<Signer> {
  const { rows: [existing] } = await db.query('SELECT * FROM partners WHERE name = $1', [def.name]);
  return existing ? signerFor(db, existing) : insertPartner(db, def);
}
