-- ============ types ============
CREATE TYPE partner_role AS ENUM ('manufacturer','logistics','distributor','retailer');
CREATE TYPE event_type   AS ENUM ('MANUFACTURED','INSPECTED','PACKAGED','DISPATCHED','RECEIVED','SOLD');
CREATE TYPE batch_state  AS ENUM ('CREATED','MANUFACTURED','INSPECTED','PACKAGED','IN_TRANSIT','RECEIVED','SOLD');

-- ============ tables ============
CREATE TABLE partners (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  role          partner_role NOT NULL,
  public_key    text NOT NULL,                 -- ed25519, PEM
  api_key_hash  text NOT NULL UNIQUE,          -- sha256 hex of the API key
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE batches (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_code           text NOT NULL UNIQUE,
  product_name         text NOT NULL,
  quantity             int  NOT NULL CHECK (quantity > 0),
  manufacturer_id      uuid NOT NULL REFERENCES partners(id),
  parent_batch_id      uuid REFERENCES batches(id),     -- set when a batch is split/repackaged
  state                batch_state NOT NULL DEFAULT 'CREATED',
  current_holder_id    uuid NOT NULL REFERENCES partners(id),
  pending_recipient_id uuid REFERENCES partners(id),
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- who has touched a batch; drives row-level security (avoids policy recursion)
CREATE TABLE batch_participants (
  batch_id   uuid NOT NULL REFERENCES batches(id),
  partner_id uuid NOT NULL REFERENCES partners(id),
  PRIMARY KEY (batch_id, partner_id)
);

CREATE TABLE units (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES batches(id),
  serial   int  NOT NULL,
  UNIQUE (batch_id, serial)
);

-- single source of truth for the state machine
CREATE TABLE state_transitions (
  from_state batch_state NOT NULL,
  on_event   event_type  NOT NULL,
  to_state   batch_state NOT NULL,
  PRIMARY KEY (from_state, on_event)
);
INSERT INTO state_transitions VALUES
  ('CREATED',      'MANUFACTURED', 'MANUFACTURED'),
  ('MANUFACTURED', 'INSPECTED',    'INSPECTED'),
  ('INSPECTED',    'PACKAGED',     'PACKAGED'),
  ('PACKAGED',     'DISPATCHED',   'IN_TRANSIT'),
  ('IN_TRANSIT',   'RECEIVED',     'RECEIVED'),
  ('RECEIVED',     'DISPATCHED',   'IN_TRANSIT'),
  ('RECEIVED',     'SOLD',         'SOLD');

CREATE TABLE events (
  id            bigserial PRIMARY KEY,
  batch_id      uuid NOT NULL REFERENCES batches(id),
  type          event_type NOT NULL,
  actor_id      uuid NOT NULL REFERENCES partners(id),
  to_partner_id uuid REFERENCES partners(id),
  quantity      int NOT NULL CHECK (quantity >= 0),
  lat           double precision,
  lng           double precision,
  occurred_at   timestamptz NOT NULL,
  body          jsonb NOT NULL,                 -- exact signed payload
  signature     text NOT NULL UNIQUE,           -- UNIQUE = exact replays are rejected
  prev_hash     text NOT NULL,
  hash          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_batch_idx ON events (batch_id, id);

CREATE TABLE alerts (
  id         bigserial PRIMARY KEY,
  type       text NOT NULL,
  severity   text NOT NULL CHECK (severity IN ('low','medium','high')),
  batch_id   uuid REFERENCES batches(id),
  unit_id    uuid REFERENCES units(id),
  event_id   bigint REFERENCES events(id),
  details    jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alerts_batch_idx ON alerts (batch_id);

-- ============ triggers ============
-- events are append-only
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'IMMUTABLE: events are append-only'; END $$;
CREATE TRIGGER events_immutable BEFORE UPDATE OR DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- validates the state transition + custody, then moves the batch forward
CREATE FUNCTION apply_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b batches%ROWTYPE; nxt batch_state;
BEGIN
  SELECT * INTO b FROM batches WHERE id = NEW.batch_id FOR UPDATE;

  SELECT to_state INTO nxt FROM state_transitions
   WHERE from_state = b.state AND on_event = NEW.type;
  IF nxt IS NULL THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: % is not allowed while batch is %', NEW.type, b.state;
  END IF;

  -- RECEIVED is recorded even if the receiver is not the expected one (reality happened);
  -- the anomaly worker flags it as ROUTE_MISMATCH.
  IF NEW.type <> 'RECEIVED' AND b.current_holder_id <> NEW.actor_id THEN
    RAISE EXCEPTION 'NOT_CUSTODIAN: only the current holder can record %', NEW.type;
  END IF;
  IF NEW.type = 'DISPATCHED' AND NEW.to_partner_id IS NULL THEN
    RAISE EXCEPTION 'MISSING_RECIPIENT: DISPATCHED needs toPartnerId';
  END IF;

  UPDATE batches SET
    state = nxt,
    current_holder_id    = CASE WHEN NEW.type = 'RECEIVED'   THEN NEW.actor_id      ELSE current_holder_id END,
    pending_recipient_id = CASE WHEN NEW.type = 'DISPATCHED' THEN NEW.to_partner_id ELSE NULL END
  WHERE id = b.id;

  INSERT INTO batch_participants VALUES (b.id, NEW.actor_id) ON CONFLICT DO NOTHING;
  IF NEW.to_partner_id IS NOT NULL THEN
    INSERT INTO batch_participants VALUES (b.id, NEW.to_partner_id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER events_apply BEFORE INSERT ON events
  FOR EACH ROW EXECUTE FUNCTION apply_event();

-- ============ row-level security ============
-- The app sets two per-transaction settings: app.role ('system' | 'partner') and app.partner_id.
CREATE FUNCTION app_is_system() RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT coalesce(current_setting('app.role', true), '') = 'system' $$;
CREATE FUNCTION app_partner() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.partner_id', true), '')::uuid $$;

ALTER TABLE batches ENABLE ROW LEVEL SECURITY;  ALTER TABLE batches FORCE ROW LEVEL SECURITY;
ALTER TABLE events  ENABLE ROW LEVEL SECURITY;  ALTER TABLE events  FORCE ROW LEVEL SECURITY;
ALTER TABLE alerts  ENABLE ROW LEVEL SECURITY;  ALTER TABLE alerts  FORCE ROW LEVEL SECURITY;

CREATE POLICY batches_system ON batches USING (app_is_system()) WITH CHECK (app_is_system());
CREATE POLICY batches_member ON batches FOR SELECT
  USING (id IN (SELECT batch_id FROM batch_participants WHERE partner_id = app_partner()));

CREATE POLICY events_system ON events USING (app_is_system()) WITH CHECK (app_is_system());
CREATE POLICY events_member ON events FOR SELECT
  USING (batch_id IN (SELECT batch_id FROM batch_participants WHERE partner_id = app_partner()));

CREATE POLICY alerts_system ON alerts USING (app_is_system()) WITH CHECK (app_is_system());
CREATE POLICY alerts_member ON alerts FOR SELECT
  USING (batch_id IN (SELECT batch_id FROM batch_participants WHERE partner_id = app_partner()));

-- ============ app role (not a superuser, so RLS applies) ============
CREATE ROLE app_user LOGIN PASSWORD 'app_pass';
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
