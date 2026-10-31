// End-to-end demo against a running server: node --env-file=.env scripts/demo.js
import { canonicalize, sign } from '../src/crypto.js';

const API = `http://localhost:${process.env.PORT || 4000}/api`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, { key, admin, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(key && { 'x-api-key': key }),
      ...(admin && { 'x-admin-key': process.env.ADMIN_KEY }),
    },
    body: body && JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}

async function register(name, role) {
  const { json } = await call('POST', '/partners', { admin: true, body: { name, role } });
  return { ...json.partner, apiKey: json.apiKey, privateKey: json.privateKey };
}

let clock = Date.parse('2026-11-01T06:00:00Z');
async function submit(actor, batchId, type, { to = null, quantity = 100, at = null, hours = 1 } = {}) {
  clock += hours * 36e5;
  const event = {
    batchId, type, toPartnerId: to?.id ?? null, quantity,
    lat: at?.[0] ?? null, lng: at?.[1] ?? null,
    occurredAt: new Date(clock).toISOString(), payload: {},
  };
  const signature = sign(actor.privateKey, canonicalize(event));
  const r = await call('POST', '/events', { key: actor.apiKey, body: { event, signature } });
  console.log(`${type.padEnd(13)} ${actor.name.padEnd(12)} ${r.ok ? 'accepted' : `REJECTED ${r.json.error}: ${r.json.message}`}`);
  return r;
}

const NAGPUR = [21.1458, 79.0882], MUMBAI = [19.076, 72.8777], PUNE = [18.5204, 73.8567];

const maker = await register('AcmePharma', 'manufacturer');
const dist = await register('MediDist', 'distributor');
const shop = await register('CityPharmacy', 'retailer');

const { json: { batch } } = await call('POST', '/batches', {
  key: maker.apiKey, body: { batchCode: `B-${Date.now()}`, productName: 'Paracetamol 500mg', quantity: 100 },
});
console.log('batch', batch.batch_code, '\n');

await submit(maker, batch.id, 'MANUFACTURED', { at: NAGPUR });
await submit(maker, batch.id, 'INSPECTED', { at: NAGPUR });
await submit(maker, batch.id, 'PACKAGED', { at: NAGPUR });
await submit(maker, batch.id, 'DISPATCHED', { to: dist, at: NAGPUR });
await submit(dist, batch.id, 'RECEIVED', { quantity: 95, at: MUMBAI, hours: 20 }); // 5 units missing -> QUANTITY_MISMATCH
await submit(dist, batch.id, 'DISPATCHED', { to: shop, quantity: 95, at: MUMBAI });
await submit(shop, batch.id, 'RECEIVED', { quantity: 95, at: PUNE, hours: 6 });
await submit(shop, batch.id, 'SOLD', { quantity: 95, at: PUNE });
await submit(shop, batch.id, 'SOLD', { quantity: 95, at: PUNE }); // invalid: already SOLD

await sleep(1500); // let the worker run
const alerts = await call('GET', '/alerts', { key: maker.apiKey });
console.log('\nalerts:', alerts.json.alerts.map((a) => `${a.type} (${a.severity})`));

// RLS check: a partner outside the chain sees nothing
const outsider = await register('Outsider', 'retailer');
const hidden = await call('GET', `/batches/${batch.id}`, { key: outsider.apiKey });
console.log('outsider sees batch?', hidden.status, hidden.json.error);

const { json: { units } } = await call('GET', `/batches/${batch.id}/units?limit=1`, { key: maker.apiKey });
const token = units[0].token;
for (let i = 1; i <= 6; i++) {
  const v = await call('GET', `/verify/${token}`);
  console.log(`scan ${i}:`, v.json.verdict, v.json.reasons);
}
console.log('forged code:', (await call('GET', `/verify/${units[0].unitId}.deadbeef`)).json.verdict);

const recall = await call('GET', `/batches/${batch.id}/recall`, { key: maker.apiKey });
console.log('recall:', recall.json.affected.map((a) => `${a.batch_code} @ ${a.holder} (${a.state})`));
process.exit(0);
