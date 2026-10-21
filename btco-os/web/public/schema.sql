-- BTCo OS: proposed PostgreSQL production schema v0.1
-- DESIGN ARTIFACT ONLY. Not applied; no database is provisioned by this prototype.
-- Auth, roles/grants, transaction handlers, aggregate constraints, migrations,
-- API authorization and tenant-isolation tests remain implementation work.
BEGIN;
CREATE SCHEMA IF NOT EXISTS btco;
SET search_path TO btco, public;

CREATE TABLE dealers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  currency text NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  timezone text NOT NULL DEFAULT 'America/Los_Angeles',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id uuid NOT NULL REFERENCES dealers(id),
  user_subject text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner','manager','operator','viewer')),
  UNIQUE (dealer_id, user_subject), UNIQUE (dealer_id, id)
);
CREATE TABLE locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id uuid NOT NULL REFERENCES dealers(id),
  parent_id uuid,
  code text NOT NULL,
  label text NOT NULL,
  UNIQUE (dealer_id,id), UNIQUE (dealer_id,code),
  FOREIGN KEY (dealer_id,parent_id) REFERENCES locations(dealer_id,id),
  CHECK (parent_id IS DISTINCT FROM id)
);
CREATE TABLE import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id uuid NOT NULL REFERENCES dealers(id),
  source_system text NOT NULL,
  source_object_key text,
  source_sha256 text,
  status text NOT NULL CHECK (status IN ('staged','reviewed','applied','rejected')),
  mapping jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  UNIQUE (dealer_id,id)
);
CREATE TABLE acquisitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id uuid NOT NULL REFERENCES dealers(id),
  reference text NOT NULL,
  vendor text,
  purchased_on date,
  purchase_cents bigint CHECK (purchase_cents >= 0),
  inbound_shipping_cents bigint CHECK (inbound_shipping_cents >= 0),
  tax_cents bigint CHECK (tax_cents >= 0),
  other_cents bigint CHECK (other_cents >= 0),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  notes text,
  UNIQUE (dealer_id,id), UNIQUE (dealer_id,reference)
);
CREATE TABLE items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id uuid NOT NULL REFERENCES dealers(id),
  sku text NOT NULL CHECK (length(trim(sku)) > 0),
  kind text NOT NULL CHECK (kind IN ('card','comic','bulk','other')),
  title text NOT NULL,
  parent_item_id uuid,
  location_id uuid,
  physical_verification text NOT NULL DEFAULT 'unverified'
    CHECK (physical_verification IN ('unverified','verified','awaiting')),
  verified_at timestamptz,
  verified_by text,
  workflow_status text NOT NULL DEFAULT 'intake'
    CHECK (workflow_status IN ('intake','ready','hold','archived')),
  condition_notes text,
  import_batch_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dealer_id,id),
  FOREIGN KEY (dealer_id,parent_item_id) REFERENCES items(dealer_id,id),
  FOREIGN KEY (dealer_id,location_id) REFERENCES locations(dealer_id,id),
  FOREIGN KEY (dealer_id,import_batch_id) REFERENCES import_batches(dealer_id,id),
  CHECK (parent_item_id IS DISTINCT FROM id)
);
CREATE UNIQUE INDEX items_dealer_sku ON items(dealer_id,lower(trim(sku)));
CREATE TABLE collectible_details (
  dealer_id uuid NOT NULL REFERENCES dealers(id),
  item_id uuid NOT NULL,
  subject text, sport text, team text,
  release_year text, set_name text, publisher text,
  card_number_or_issue text, parallel_or_variant text,
  serial_numerator integer, serial_denominator integer,
  serial_verified boolean NOT NULL DEFAULT false,
  autograph boolean NOT NULL DEFAULT false,
  autograph_authenticator text,
  grade_company text, grade text, certification_number text,
  identity_status text NOT NULL DEFAULT 'unverified'
    CHECK (identity_status IN ('suggested','unverified','verified')),
  bulk_contents jsonb,
  extra jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (dealer_id,item_id),
  FOREIGN KEY (dealer_id,item_id) REFERENCES items(dealer_id,id),
  CHECK (serial_numerator IS NULL OR serial_numerator > 0),
  CHECK (serial_denominator IS NULL OR serial_denominator > 0),
  CHECK (serial_numerator IS NULL OR serial_denominator IS NULL OR serial_numerator <= serial_denominator)
);
CREATE TABLE cost_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id uuid NOT NULL REFERENCES dealers(id),
  acquisition_id uuid NOT NULL,
  item_id uuid NOT NULL,
  allocated_cents bigint NOT NULL CHECK (allocated_cents >= 0),
  method text NOT NULL CHECK (method IN ('direct','equal','weighted','manual')),
  rationale text,
  UNIQUE (dealer_id,id), UNIQUE (dealer_id,acquisition_id,item_id),
  FOREIGN KEY (dealer_id,acquisition_id) REFERENCES acquisitions(dealer_id,id),
  FOREIGN KEY (dealer_id,item_id) REFERENCES items(dealer_id,id)
  -- Unknown item cost = no allocation. Free item = explicit zero allocation.
);
CREATE TABLE stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id uuid NOT NULL REFERENCES dealers(id),
  item_id uuid NOT NULL,
  movement_type text NOT NULL CHECK (movement_type IN ('receive','sale','sale_void','return','adjustment','split_in','split_out','relocate')),
  quantity_delta integer NOT NULL,
  from_location_id uuid,
  to_location_id uuid,
  reference_id uuid,
  reason text NOT NULL,
  idempotency_key text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dealer_id,id), UNIQUE (dealer_id,idempotency_key),
  FOREIGN KEY (dealer_id,item_id) REFERENCES items(dealer_id,id),
  FOREIGN KEY (dealer_id,from_location_id) REFERENCES locations(dealer_id,id),
  FOREIGN KEY (dealer_id,to_location_id) REFERENCES locations(dealer_id,id)
);
CREATE TABLE integration_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id uuid NOT NULL REFERENCES dealers(id),
  provider text NOT NULL,
  external_account_id text NOT NULL,
  credential_secret_ref text NOT NULL, -- Server-side secret reference; never OAuth tokens in client storage.
  write_enabled boolean NOT NULL DEFAULT false,
  scopes text[] NOT NULL DEFAULT '{}',
  UNIQUE (dealer_id,id), UNIQUE (dealer_id,provider,external_account_id)
);
CREATE TABLE listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id uuid NOT NULL REFERENCES dealers(id),
  item_id uuid NOT NULL,
  integration_account_id uuid,
  channel text NOT NULL,
  external_listing_id text,
  status text NOT NULL CHECK (status IN ('draft','active','ended','sold','unknown')),
  asking_cents bigint CHECK (asking_cents >= 0),
  listed_quantity integer CHECK (listed_quantity >= 0),
  promotion_basis_points integer CHECK (promotion_basis_points BETWEEN 0 AND 10000),
  last_seen_at timestamptz,
  source_payload jsonb,
  UNIQUE (dealer_id,id),
  UNIQUE (dealer_id,integration_account_id,external_listing_id),
  FOREIGN KEY (dealer_id,item_id) REFERENCES items(dealer_id,id),
  FOREIGN KEY (dealer_id,integration_account_id) REFERENCES integration_accounts(dealer_id,id)
);
CREATE TABLE sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id uuid NOT NULL REFERENCES dealers(id),
  channel text NOT NULL,
  integration_account_id uuid,
  external_order_id text,
  sold_at timestamptz NOT NULL,
  shipping_collected_cents bigint NOT NULL CHECK (shipping_collected_cents >= 0),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  financial_status text NOT NULL CHECK (financial_status IN ('incomplete','reconciled')),
  fulfillment_status text NOT NULL CHECK (fulfillment_status IN ('unfulfilled','packed','shipped','returned','cancelled')),
  voided_at timestamptz,
  idempotency_key text NOT NULL,
  UNIQUE (dealer_id,id), UNIQUE (dealer_id,idempotency_key),
  UNIQUE (dealer_id,integration_account_id,external_order_id),
  FOREIGN KEY (dealer_id,integration_account_id) REFERENCES integration_accounts(dealer_id,id)
);
CREATE TABLE sale_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id uuid NOT NULL REFERENCES dealers(id),
  sale_id uuid NOT NULL,
  item_id uuid NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  item_proceeds_cents bigint NOT NULL CHECK (item_proceeds_cents >= 0),
  cogs_snapshot_cents bigint CHECK (cogs_snapshot_cents >= 0),
  allocation_method text NOT NULL,
  UNIQUE (dealer_id,id), UNIQUE (dealer_id,sale_id,item_id),
  FOREIGN KEY (dealer_id,sale_id) REFERENCES sales(dealer_id,id),
  FOREIGN KEY (dealer_id,item_id) REFERENCES items(dealer_id,id)
);
CREATE TABLE sale_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id uuid NOT NULL REFERENCES dealers(id),
  sale_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('selling_fee','promotion','postage','supplies','refund','other','fee_credit')),
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  evidence_ref text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dealer_id,id),
  FOREIGN KEY (dealer_id,sale_id) REFERENCES sales(dealer_id,id)
  -- Positive fee_credit is added back to profit; all other kinds are subtracted.
);
CREATE TABLE assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id uuid NOT NULL REFERENCES dealers(id),
  item_id uuid,
  object_key text NOT NULL,
  mime_type text NOT NULL,
  sha256 text NOT NULL,
  role text NOT NULL CHECK (role IN ('front','back','serial','cert','receipt','other')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dealer_id,id),
  FOREIGN KEY (dealer_id,item_id) REFERENCES items(dealer_id,id)
);
CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id uuid NOT NULL REFERENCES dealers(id),
  actor_subject text NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  before_data jsonb,
  after_data jsonb,
  request_id text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dealer_id,id)
);
CREATE TABLE integration_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id uuid NOT NULL REFERENCES dealers(id),
  integration_account_id uuid,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','succeeded','failed','blocked')),
  requires_write_permission boolean NOT NULL DEFAULT false,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  run_after timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dealer_id,id), UNIQUE (dealer_id,idempotency_key),
  FOREIGN KEY (dealer_id,integration_account_id) REFERENCES integration_accounts(dealer_id,id)
);

CREATE INDEX items_workflow ON items(dealer_id,workflow_status);
CREATE INDEX stock_by_item ON stock_movements(dealer_id,item_id,occurred_at);
CREATE INDEX sales_by_date ON sales(dealer_id,sold_at);
CREATE INDEX audit_by_entity ON audit_events(dealer_id,entity_type,entity_id,occurred_at);
CREATE INDEX jobs_queue ON integration_jobs(dealer_id,status,run_after);

-- Tenant policy scaffold. The backend MUST verify authenticated membership/role,
-- then set app.dealer_id with SET LOCAL inside each transaction. This setting is
-- not authentication and must never be freely supplied by a browser.
-- Use a non-owner, non-superuser runtime role without BYPASSRLS.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['memberships','locations','import_batches','acquisitions','items',
    'collectible_details','cost_allocations','stock_movements','integration_accounts','listings',
    'sales','sale_lines','sale_expenses','assets','audit_events','integration_jobs']
  LOOP
    EXECUTE format('ALTER TABLE btco.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE btco.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY dealer_scope ON btco.%I USING (dealer_id = nullif(current_setting(''app.dealer_id'', true), '''')::uuid) WITH CHECK (dealer_id = nullif(current_setting(''app.dealer_id'', true), '''')::uuid)', t);
  END LOOP;
END $$;
ALTER TABLE dealers ENABLE ROW LEVEL SECURITY;
ALTER TABLE dealers FORCE ROW LEVEL SECURITY;
CREATE POLICY dealer_scope ON dealers
  USING (id = nullif(current_setting('app.dealer_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.dealer_id', true), '')::uuid);

-- Deployment gate, not implemented here:
-- 1. Lock acquisition + item rows for allocation/sale transactions.
-- 2. Allocation totals must not exceed the known delivered acquisition total.
-- 3. Lot splits conserve quantity/value; use parent_item_id and signed movements.
-- 4. Stock cannot go negative; movement + sale + audit + outbox commit atomically.
-- 5. Reconcile costs via explicit adjustment events; do not rewrite sale snapshots.
-- 6. Limit runtime grants: audit/stock ledgers append-only; memberships owner-only;
--    integration secrets inaccessible to public APIs; business records soft archived.
-- 7. Enforce location and parent-item acyclicity in transaction handlers.
-- 8. Install and test roles, membership authorization and cross-dealer isolation.
COMMIT;
