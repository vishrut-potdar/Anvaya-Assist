import { DbClient } from './db.ts';
import { generateApiKey, generateKeyPair, keyFingerprint, sha256 } from './crypto.ts';

// Private keys for partners the server signs on behalf of (demo + workspace), keyed by public key.
// Kept in memory so later requests in this process can keep signing as the same partner.
export const serverPrivateKeys = new Map<string, string>();

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
  serverPrivateKeys.set(keys.publicKey, keys.privateKey);
  return { ...p, privateKey: keys.privateKey };
}

/** Return a signer for an existing partner row. */
export async function signerFor(db: DbClient, partner: any): Promise<Signer> {
  const known = serverPrivateKeys.get(partner.public_key);
  if (known) return { ...partner, privateKey: known };

  // ponytail: key unknown to this process (e.g. a new serverless instance against an external DB), so rotate it.
  // Older events by this partner will then fail the chain audit; clear and reload data to recover.
  const keys = generateKeyPair();
  await db.query('UPDATE partners SET public_key = $1 WHERE id = $2', [keys.publicKey, partner.id]);
  await db.query(
    `INSERT INTO partner_keys (partner_id, public_key, fingerprint) VALUES ($1, $2, $3)`,
    [partner.id, keys.publicKey, keyFingerprint(keys.publicKey)]
  );
  serverPrivateKeys.set(keys.publicKey, keys.privateKey);
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
