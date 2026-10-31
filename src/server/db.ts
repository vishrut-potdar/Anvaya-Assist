import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { config } from './config.ts';

export interface QueryResult<T = any> {
  rows: T[];
  rowCount?: number;
}

export interface DbClient {
  query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>>;
  exec(sql: string): Promise<any>;
}

let pgPool: pg.Pool | null = null;
let pgliteInstance: PGlite | null = null;
let isInitialized = false;

class PgliteWrapper implements DbClient {
  pglite: PGlite;
  constructor(pglite: PGlite) {
    this.pglite = pglite;
  }
  async query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>> {
    const res = await this.pglite.query<T>(sql, params);
    return { rows: res.rows, rowCount: res.rowCount ?? res.rows.length };
  }
  async exec(sql: string): Promise<any> {
    return this.pglite.exec(sql);
  }
}

class PgPoolWrapper implements DbClient {
  pool: pg.Pool;
  constructor(pool: pg.Pool) {
    this.pool = pool;
  }
  async query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>> {
    const res = await (this.pool as any).query(sql, params);
    return { rows: res.rows, rowCount: res.rowCount ?? res.rows.length };
  }
  async exec(sql: string): Promise<any> {
    return this.pool.query(sql);
  }
}

export async function getDb(): Promise<DbClient> {
  if (config.databaseUrl) {
    if (!pgPool) {
      pgPool = new pg.Pool({ connectionString: config.databaseUrl });
    }
    return new PgPoolWrapper(pgPool);
  }

  if (!pgliteInstance) {
    pgliteInstance = new PGlite();
  }
  return new PgliteWrapper(pgliteInstance);
}

export const SCHEMA_SQL = `
-- ============ Enums ============
DO $$ BEGIN
  CREATE TYPE partner_role AS ENUM ('manufacturer', 'logistics', 'distributor', 'retailer', 'regulator');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE event_type AS ENUM ('MANUFACTURED', 'INSPECTED', 'PACKAGED', 'DISPATCHED', 'RECEIVED', 'SOLD', 'RECALLED', 'DESTROYED', 'RETURNED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE batch_state AS ENUM ('CREATED', 'MANUFACTURED', 'INSPECTED', 'PACKAGED', 'IN_TRANSIT', 'RECEIVED', 'SOLD', 'RECALLED', 'DESTROYED', 'RETURNED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ============ Tables ============
CREATE TABLE IF NOT EXISTS partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  role partner_role NOT NULL,
  public_key text NOT NULL,
  api_key_hash text NOT NULL UNIQUE,
  country text DEFAULT 'IN',
  status text DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS partner_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES partners(id),
  public_key text NOT NULL,
  fingerprint text NOT NULL,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  gtin text PRIMARY KEY,
  brand_partner_id uuid NOT NULL REFERENCES partners(id),
  name text NOT NULL,
  description text,
  public_attributes jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_code text NOT NULL UNIQUE,
  gtin text DEFAULT '09506000134352',
  product_name text NOT NULL,
  quantity int NOT NULL CHECK (quantity > 0),
  manufacturer_id uuid NOT NULL REFERENCES partners(id),
  parent_batch_id uuid REFERENCES batches(id),
  state batch_state NOT NULL DEFAULT 'CREATED',
  is_recalled boolean NOT NULL DEFAULT false,
  recalled_at timestamptz,
  recall_reason text,
  expiry_date date,
  current_holder_id uuid NOT NULL REFERENCES partners(id),
  pending_recipient_id uuid REFERENCES partners(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS batch_lineage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_batch_id uuid NOT NULL REFERENCES batches(id),
  child_batch_id uuid NOT NULL REFERENCES batches(id),
  relation text NOT NULL DEFAULT 'split',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS batch_participants (
  batch_id uuid NOT NULL REFERENCES batches(id),
  partner_id uuid NOT NULL REFERENCES partners(id),
  PRIMARY KEY (batch_id, partner_id)
);

CREATE TABLE IF NOT EXISTS units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES batches(id),
  serial int NOT NULL,
  token_hash text,
  state batch_state NOT NULL DEFAULT 'CREATED',
  current_custodian_id uuid REFERENCES partners(id),
  sold_at timestamptz,
  sold_region text,
  first_consumer_scan_at timestamptz,
  UNIQUE (batch_id, serial)
);

CREATE TABLE IF NOT EXISTS state_transitions (
  from_state batch_state NOT NULL,
  on_event event_type NOT NULL,
  to_state batch_state NOT NULL,
  PRIMARY KEY (from_state, on_event)
);

INSERT INTO state_transitions (from_state, on_event, to_state) VALUES
  ('CREATED',      'MANUFACTURED', 'MANUFACTURED'),
  ('MANUFACTURED', 'INSPECTED',    'INSPECTED'),
  ('INSPECTED',    'PACKAGED',     'PACKAGED'),
  ('PACKAGED',     'DISPATCHED',   'IN_TRANSIT'),
  ('IN_TRANSIT',   'RECEIVED',     'RECEIVED'),
  ('RECEIVED',     'DISPATCHED',   'IN_TRANSIT'),
  ('RECEIVED',     'SOLD',         'SOLD'),
  ('SOLD',         'RETURNED',     'RETURNED'),
  ('MANUFACTURED', 'RECALLED',     'RECALLED'),
  ('INSPECTED',    'RECALLED',     'RECALLED'),
  ('PACKAGED',     'RECALLED',     'RECALLED'),
  ('IN_TRANSIT',   'RECALLED',     'RECALLED'),
  ('RECEIVED',     'RECALLED',     'RECALLED'),
  ('SOLD',         'RECALLED',     'RECALLED')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS events (
  id bigserial PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES batches(id),
  type event_type NOT NULL,
  actor_id uuid NOT NULL REFERENCES partners(id),
  to_partner_id uuid REFERENCES partners(id),
  quantity int NOT NULL CHECK (quantity >= 0),
  lat double precision,
  lng double precision,
  occurred_at timestamptz NOT NULL,
  body jsonb NOT NULL,
  signature text NOT NULL UNIQUE,
  prev_hash text NOT NULL,
  hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_batch_idx ON events (batch_id, id);

CREATE TABLE IF NOT EXISTS alerts (
  id bigserial PRIMARY KEY,
  rule_code text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  score double precision DEFAULT 0.0,
  batch_id uuid REFERENCES batches(id),
  unit_id uuid REFERENCES units(id),
  event_id bigint REFERENCES events(id),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  explanation text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS alerts_batch_idx ON alerts (batch_id);

-- Private keys of partners the server signs for (demo + workspace). Stored so every
-- serverless instance can sign as the same partner; never exposed by any route.
CREATE TABLE IF NOT EXISTS custodial_keys (
  public_key text PRIMARY KEY,
  private_key text NOT NULL
);

CREATE TABLE IF NOT EXISTS scans (
  id bigserial PRIMARY KEY,
  unit_id uuid NOT NULL REFERENCES units(id),
  device_id text,
  ip text,
  lat double precision,
  lng double precision,
  city text,
  result text,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

export async function initDatabase(): Promise<void> {
  if (isInitialized) return;
  const db = await getDb();
  await db.exec(SCHEMA_SQL);
  isInitialized = true;
  console.log('PostgreSQL schema initialized successfully!');
}

/**
 * Execute in context
 */
export async function withDb<T>(fn: (db: DbClient) => Promise<T>): Promise<T> {
  await initDatabase();
  const db = await getDb();
  return fn(db);
}

export const asSystem = withDb;
export const asPartner = async <T>(_partnerId: string, fn: (db: DbClient) => Promise<T>): Promise<T> => {
  return withDb(fn);
};
