import crypto from 'node:crypto';
import { config } from './config.ts';

export const GENESIS = 'GENESIS';

export const sha256 = (s: string): string =>
  crypto.createHash('sha256').update(s, 'utf8').digest('hex');

/**
 * RFC 8785 JSON Canonicalization Scheme (JCS).
 * Keys are sorted lexicographically, whitespace is eliminated, numbers formatted per standard.
 */
export function canonicalize(val: any): string {
  if (val === null || typeof val !== 'object') {
    return JSON.stringify(val);
  }
  if (Array.isArray(val)) {
    return '[' + val.map((item) => canonicalize(item)).join(',') + ']';
  }
  const keys = Object.keys(val).sort();
  const pairs = keys.map((key) => JSON.stringify(key) + ':' + canonicalize(val[key]));
  return '{' + pairs.join(',') + '}';
}

/**
 * Ed25519 cryptographic key pair generation
 */
export function generateKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }) as string,
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
  };
}

/**
 * Key fingerprint (SHA-256 of public key PEM)
 */
export function keyFingerprint(publicKeyPem: string): string {
  return sha256(publicKeyPem.trim()).slice(0, 16);
}

/**
 * Signs canonical payload using Ed25519 private key
 */
export function sign(privateKeyPem: string, message: string): string {
  return crypto.sign(null, Buffer.from(message, 'utf8'), privateKeyPem).toString('base64');
}

/**
 * Verifies Ed25519 signature
 */
export function verifySig(publicKeyPem: string, message: string, sigB64: string): boolean {
  try {
    return crypto.verify(
      null,
      Buffer.from(message, 'utf8'),
      publicKeyPem,
      Buffer.from(sigB64, 'base64')
    );
  } catch {
    return false;
  }
}

export const generateApiKey = (): string => 'sk_' + crypto.randomBytes(24).toString('hex');

/**
 * Hash chain formula: SHA-256(prev_hash || canonical_body || signature || actor_id)
 */
export const eventHash = (prevHash: string, body: any, signature: string, actorId: string): string => {
  return sha256([prevHash, canonicalize(body), signature, actorId].join('|'));
};

export interface ChainVerificationResult {
  ok: boolean;
  brokenAt?: number | string;
  reason?: string;
  totalEventsChecked: number;
}

/**
 * Full cryptographic chain verification across all events in chronological sequence
 */
export function verifyChain(events: Array<{
  id: number | string;
  prev_hash: string;
  hash: string;
  body: any;
  signature: string;
  actor_id: string;
  public_key?: string;
}>): ChainVerificationResult {
  let prev = GENESIS;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.prev_hash !== prev) {
      return {
        ok: false,
        brokenAt: e.id,
        reason: `Previous hash mismatch: expected '${prev.slice(0, 8)}...', got '${e.prev_hash.slice(0, 8)}...'`,
        totalEventsChecked: i + 1,
      };
    }

    const calculatedHash = eventHash(e.prev_hash, e.body, e.signature, e.actor_id);
    if (e.hash !== calculatedHash) {
      return {
        ok: false,
        brokenAt: e.id,
        reason: `Cryptographic hash mismatch: row data was altered!`,
        totalEventsChecked: i + 1,
      };
    }

    if (e.public_key && !verifySig(e.public_key, canonicalize(e.body), e.signature)) {
      return {
        ok: false,
        brokenAt: e.id,
        reason: `Invalid Ed25519 signature: does not match signer public key!`,
        totalEventsChecked: i + 1,
      };
    }

    prev = e.hash;
  }
  return { ok: true, totalEventsChecked: events.length };
}

/**
 * Unit token HMAC generation for QR codes:
 * format: "<unitId>.<hmac>"
 */
export const unitHmac = (unitId: string): string =>
  crypto.createHmac('sha256', config.qrSecret).update(unitId).digest('hex').slice(0, 24);

export const unitToken = (unitId: string): string => `${unitId}.${unitHmac(unitId)}`;

export function parseUnitToken(token: string): string | null {
  const parts = String(token).split('.');
  if (parts.length !== 2) return null;
  const [unitId, given] = parts;
  if (!unitId || !given || !/^[0-9a-f-]{36}$/i.test(unitId)) return null;

  const expected = unitHmac(unitId);
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  return crypto.timingSafeEqual(a, b) ? unitId : null;
}

/**
 * GS1 Digital Link HMAC token: base64url(HMAC-SHA256(qrSecret, gtin|lot|serial))[:10]
 */
export function gs1HmacToken(gtin: string, lot: string, serial: string | number): string {
  const msg = `${gtin}|${lot}|${serial}`;
  return crypto.createHmac('sha256', config.qrSecret)
    .update(msg)
    .digest('base64url')
    .slice(0, 10);
}

export function verifyGs1Token(gtin: string, lot: string, serial: string | number, token: string): boolean {
  if (!token) return false;
  const expected = gs1HmacToken(gtin, lot, serial);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
