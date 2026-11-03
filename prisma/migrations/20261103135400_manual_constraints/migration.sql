-- ═══════════════════════════════════════════════════════════════════════════
-- MyBricks — manual constraints (PostgreSQL)
-- ═══════════════════════════════════════════════════════════════════════════
-- Rules the DBML / Prisma schema cannot express.
-- Apply AFTER the Prisma migration that creates the tables:
--   npx prisma migrate dev --create-only --name manual_constraints
--   -> paste this file into the generated migration.sql, then: npx prisma migrate dev
--
-- Organization cleanup (demo TTL, account removal) must delete IN ORDER inside one
-- transaction, because Postgres checks each cascade step separately:
--   1. delete storage objects (MinIO) for the organization's stored_files
--   2. DELETE FROM properties       WHERE organization_id = :org;   -- cascades contracts,
--                                                                   -- reservations, photos, ...
--   3. DELETE FROM stored_files     WHERE organization_id = :org;
--   4. DELETE FROM clients          WHERE organization_id = :org;
--   5. DELETE FROM occupants        WHERE organization_id = :org;
--   6. DELETE FROM agencies         WHERE organization_id = :org;
--   7. DELETE FROM organizations    WHERE id = :org;                -- cascades members, audit_logs
--
-- Orphan-file sweep (job, files older than 1 hour referenced by nothing):
--   SELECT f.id, f.storage_key FROM stored_files f
--   WHERE f.created_at < now() - interval '1 hour'
--     AND NOT EXISTS (SELECT 1 FROM property_photos     p WHERE p.file_id = f.id)
--     AND NOT EXISTS (SELECT 1 FROM property_documents  d WHERE d.file_id = f.id)
--     AND NOT EXISTS (SELECT 1 FROM contracts           c WHERE c.pdf_file_id = f.id)
--     AND NOT EXISTS (SELECT 1 FROM feedbacks           b WHERE b.attachment_file_id = f.id);
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ── users ───────────────────────────────────────────────────────────────────
-- Case-insensitive e-mail uniqueness (Better Auth keeps its own unique(email)).
CREATE UNIQUE INDEX uq_users_email_lower ON users (lower(email));

-- ── properties ──────────────────────────────────────────────────────────────
ALTER TABLE properties ADD CONSTRAINT ck_properties_ownership
  CHECK (ownership_percentage > 0 AND ownership_percentage <= 100);
ALTER TABLE properties ADD CONSTRAINT ck_properties_occupancy
  CHECK (occupancy_rate >= 0 AND occupancy_rate <= 100);
ALTER TABLE properties ADD CONSTRAINT ck_properties_parking_spot
  CHECK (parking_spot_label IS NULL OR property_type = 'parking');
ALTER TABLE properties ADD CONSTRAINT ck_properties_values
  CHECK (COALESCE(estimated_value_cents, 0) >= 0 AND annual_expenses_cents >= 0);
ALTER TABLE properties ADD CONSTRAINT ck_properties_areas
  CHECK (COALESCE(total_area, 0) >= 0 AND COALESCE(private_area, 0) >= 0);

ALTER TABLE property_manual_rentals ADD CONSTRAINT ck_manual_rentals_values
  CHECK (monthly_rent_cents >= 0 AND (due_day IS NULL OR due_day BETWEEN 1 AND 31));

-- ── acquisition, financing, legal, proposals ────────────────────────────────
ALTER TABLE property_acquisitions ADD CONSTRAINT ck_acquisitions_cost
  CHECK (cost_cents IS NULL OR cost_cents >= 0);

-- No financing for inheritance/other (acquisition_type is kept in sync by the composite FK).
ALTER TABLE property_financings ADD CONSTRAINT ck_financings_acquisition_type
  CHECK (acquisition_type IN ('purchase', 'construction'));
ALTER TABLE property_financings ADD CONSTRAINT ck_financings_values
  CHECK (financed_amount_cents > 0 AND term_months > 0 AND annual_interest_rate >= 0);

ALTER TABLE property_legal_records ADD CONSTRAINT ck_legal_irregularity
  CHECK (irregularity_description IS NULL OR registration_status = 'irregular');

ALTER TABLE property_proposals ADD CONSTRAINT ck_proposals_amount
  CHECK (amount_cents > 0);

-- ── files ───────────────────────────────────────────────────────────────────
ALTER TABLE stored_files ADD CONSTRAINT ck_stored_files_size CHECK (size_bytes >= 0);

-- ── contracts ───────────────────────────────────────────────────────────────
-- At most ONE active contract per property (history of ended/cancelled is kept).
CREATE UNIQUE INDEX uq_contracts_one_active_per_property
  ON contracts (property_id) WHERE status = 'active';

ALTER TABLE contracts ADD CONSTRAINT ck_contracts_dates
  CHECK (end_date IS NULL OR end_date > start_date);

-- Only conventional contracts have rent terms.
ALTER TABLE contract_rent_terms ADD CONSTRAINT ck_rent_terms_type
  CHECK (contract_type = 'conventional');
ALTER TABLE contract_rent_terms ADD CONSTRAINT ck_rent_terms_values
  CHECK (monthly_rent_cents > 0 AND due_day BETWEEN 1 AND 31);

-- ── reservations ────────────────────────────────────────────────────────────
ALTER TABLE reservations ADD CONSTRAINT ck_reservations_dates
  CHECK (check_out > check_in);
ALTER TABLE reservations ADD CONSTRAINT ck_reservations_total
  CHECK (total_amount_cents >= 0);

-- No overlap between CONFIRMED reservations of the same property.
-- Half-open range [check_in, check_out): same-day turnover is allowed.
ALTER TABLE reservations ADD CONSTRAINT ex_reservations_no_overlap
  EXCLUDE USING gist (property_id WITH =, daterange(check_in, check_out) WITH &&)
  WHERE (status = 'confirmed');

-- ── transactions ────────────────────────────────────────────────────────────
ALTER TABLE transactions ADD CONSTRAINT ck_transactions_amount
  CHECK (amount_cents > 0);
ALTER TABLE transactions ADD CONSTRAINT ck_transactions_recurrence
  CHECK (recurrence_ends_on IS NULL OR (is_recurring AND recurrence_ends_on >= occurred_on));
