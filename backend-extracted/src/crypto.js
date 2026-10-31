import crypto from 'node:crypto';
import { config } from './config.js';

export const GENESIS = 'GENESIS';

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Deterministic JSON (sorted keys) so signer and verifier hash the exact same string.
export function canonicalize(v) {
  if (Array.isArray(v)) return '[' + v.map(canonicalize).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonicalize(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

// ---- partner keys (ed25519) ----
export function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}
export const sign = (privateKeyPem, message) =>
  crypto.sign(null, Buffer.from(message), privateKeyPem).toString('base64');

export function verifySig(publicKeyPem, message, sigB64) {
  try {
    return crypto.verify(null, Buffer.from(message), publicKeyPem, Buffer.from(sigB64, 'base64'));
  } catch {
    return false;
  }
}
export const generateApiKey = () => 'sk_' + crypto.randomBytes(24).toString('hex');

// ---- hash chain ----
export const eventHash = (prevHash, body, signature, actorId) =>
  sha256([prevHash, canonicalize(body), signature, actorId].join('|'));

// events must be ordered by id and carry body, signature, prev_hash, hash, actor_id, public_key
export function verifyChain(events) {
  let prev = GENESIS;
  for (const e of events) {
    if (e.prev_hash !== prev) return { ok: false, brokenAt: e.id, reason: 'prev_hash mismatch' };
    if (e.hash !== eventHash(e.prev_hash, e.body, e.signature, e.actor_id)) return { ok: false, brokenAt: e.id, reason: 'hash mismatch' };
    if (e.public_key && !verifySig(e.public_key, canonicalize(e.body), e.signature)) return { ok: false, brokenAt: e.id, reason: 'bad signature' };
    prev = e.hash;
  }
  return { ok: true };
}

// ---- unit QR tokens: "<unitId>.<hmac>" — can't be forged without QR_SECRET ----
const mac = (unitId) => crypto.createHmac('sha256', config.qrSecret).update(unitId).digest('hex').slice(0, 32);
export const unitToken = (unitId) => `${unitId}.${mac(unitId)}`;

export function parseUnitToken(token) {
  const [unitId, given] = String(token).split('.');
  if (!unitId || !given || !/^[0-9a-f-]{36}$/.test(unitId)) return null;
  const a = Buffer.from(given), b = Buffer.from(mac(unitId));
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? unitId : null;
}
