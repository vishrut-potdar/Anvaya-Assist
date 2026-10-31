# ProvChain backend (Hacknova PS-05)

Node.js + Express, PostgreSQL 16 (RLS, triggers, recursive CTE), Redis + BullMQ, ed25519 signatures.

## Run
```bash
cp .env.example .env
docker compose up -d        # postgres (schema auto-loads on first start) + redis
npm install
npm run dev                 # API on :4000
npm run demo                # in a second terminal: full flow + anomalies
```
If you change `db/schema.sql`: `docker compose down -v && docker compose up -d`.

## Flow
1. `POST /api/partners` (header `x-admin-key`) → partner + `apiKey` (+ `privateKey` once, demo mode)
2. `POST /api/batches` (manufacturer) → batch + units
3. `GET /api/batches/:id/units` → signed QR tokens; `GET /api/qr/:token` → PNG
4. `POST /api/events` → `{ event, signature }`; signature = ed25519 over `canonicalize(event)`
   (all event fields required, use `null` when empty)
5. Worker flags: QUANTITY_MISMATCH, ROUTE_MISMATCH, IMPOSSIBLE_TRAVEL, QUANTITY_EXCEEDS_BATCH, BROKEN_CHAIN
6. `GET /api/verify/:token?lat=&lng=` (public) → GENUINE / SUSPICIOUS / PENDING / INVALID
7. `GET /api/batches/:id/recall` (manufacturer) → affected batches, holders, partners
8. `GET /api/alerts` (RLS-scoped)

## Where the rules live
- State machine + custody: `state_transitions` table + `apply_event()` trigger in `db/schema.sql`
- Visibility: RLS policies on batches/events/alerts, driven by `batch_participants`
- Tamper evidence: hash chain per batch (`src/crypto.js`) + per-event signatures
