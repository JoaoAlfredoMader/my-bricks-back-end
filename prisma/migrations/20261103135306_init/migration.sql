-- CreateEnum
CREATE TYPE "invitation_status" AS ENUM ('pending', 'accepted', 'rejected', 'canceled');

-- CreateEnum
CREATE TYPE "person_type" AS ENUM ('individual', 'company');

-- CreateEnum
CREATE TYPE "property_type" AS ENUM ('residential', 'commercial', 'land', 'logistics', 'rural', 'parking');

-- CreateEnum
CREATE TYPE "usage_type" AS ENUM ('rental', 'short_stay', 'agricultural_lease', 'concession', 'own_use', 'loan_for_use');

-- CreateEnum
CREATE TYPE "conservation_state" AS ENUM ('degraded', 'poor', 'regular', 'good', 'excellent');

-- CreateEnum
CREATE TYPE "rental_mode" AS ENUM ('manual', 'contract');

-- CreateEnum
CREATE TYPE "acquisition_type" AS ENUM ('purchase', 'construction', 'inheritance', 'other');

-- CreateEnum
CREATE TYPE "amortization_system" AS ENUM ('sac', 'price');

-- CreateEnum
CREATE TYPE "registration_status" AS ENUM ('regular', 'irregular');

-- CreateEnum
CREATE TYPE "proposal_type" AS ENUM ('purchase', 'sale', 'rental', 'linked', 'informal');

-- CreateEnum
CREATE TYPE "contract_type" AS ENUM ('conventional', 'short_stay');

-- CreateEnum
CREATE TYPE "contract_status" AS ENUM ('active', 'ended', 'cancelled');

-- CreateEnum
CREATE TYPE "adjustment_index" AS ENUM ('igpm', 'ipca', 'inpc', 'igpdi', 'other');

-- CreateEnum
CREATE TYPE "reservation_status" AS ENUM ('confirmed', 'cancelled');

-- CreateEnum
CREATE TYPE "transaction_type" AS ENUM ('revenue', 'expense');

-- CreateEnum
CREATE TYPE "feedback_status" AS ENUM ('open', 'resolved');

-- CreateEnum
CREATE TYPE "audit_action" AS ENUM ('login', 'logout', 'create', 'update', 'delete', 'view', 'upload', 'end_contract', 'cancel', 'generate_pdf', 'generate_report', 'invite_member', 'remove_member', 'impersonate_start', 'impersonate_end', 'unauthorized_access');

-- CreateEnum
CREATE TYPE "audit_entity_type" AS ENUM ('property', 'client', 'transaction', 'document', 'photo', 'contract', 'reservation', 'occupant', 'member', 'organization', 'report', 'feedback');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(255) NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "is_anonymous" BOOLEAN NOT NULL DEFAULT false,
    "role" VARCHAR(100) NOT NULL DEFAULT 'user',
    "banned" BOOLEAN NOT NULL DEFAULT false,
    "ban_reason" TEXT,
    "ban_expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "token" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "user_id" UUID NOT NULL,
    "active_organization_id" UUID,
    "impersonated_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "account_id" VARCHAR(255) NOT NULL,
    "provider_id" VARCHAR(100) NOT NULL,
    "user_id" UUID NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "id_token" TEXT,
    "access_token_expires_at" TIMESTAMPTZ(6),
    "refresh_token_expires_at" TIMESTAMPTZ(6),
    "scope" TEXT,
    "password" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "identifier" VARCHAR(320) NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "logo" TEXT,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "demo_expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" VARCHAR(100) NOT NULL DEFAULT 'member',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "role" VARCHAR(100) NOT NULL DEFAULT 'member',
    "status" "invitation_status" NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "inviter_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "person_type" "person_type" NOT NULL DEFAULT 'individual',
    "document" VARCHAR(20),
    "email" VARCHAR(320),
    "whatsapp" VARCHAR(30),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "occupants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "document" VARCHAR(20),
    "email" VARCHAR(320),
    "phone" VARCHAR(30),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "occupants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agencies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,

    CONSTRAINT "agencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cities" (
    "ibge_code" INTEGER NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "state" CHAR(2) NOT NULL,

    CONSTRAINT "cities_pkey" PRIMARY KEY ("ibge_code")
);

-- CreateTable
CREATE TABLE "property_subtypes" (
    "id" SERIAL NOT NULL,
    "property_type" "property_type" NOT NULL,
    "name" VARCHAR(100) NOT NULL,

    CONSTRAINT "property_subtypes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_type_usages" (
    "property_type" "property_type" NOT NULL,
    "usage_type" "usage_type" NOT NULL,

    CONSTRAINT "property_type_usages_pkey" PRIMARY KEY ("property_type","usage_type")
);

-- CreateTable
CREATE TABLE "transaction_categories" (
    "id" SERIAL NOT NULL,
    "transaction_type" "transaction_type" NOT NULL,
    "name" VARCHAR(100) NOT NULL,

    CONSTRAINT "transaction_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "properties" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "client_id" UUID,
    "agency_id" UUID,
    "name" VARCHAR(255) NOT NULL,
    "property_type" "property_type" NOT NULL,
    "subtype_id" INTEGER,
    "usage_type" "usage_type" NOT NULL,
    "ownership_percentage" DECIMAL(5,2) NOT NULL DEFAULT 100,
    "total_area" DECIMAL(12,2),
    "private_area" DECIMAL(12,2),
    "bedrooms" SMALLINT,
    "suites" SMALLINT,
    "bathrooms" SMALLINT,
    "parking_spaces" SMALLINT,
    "parking_spot_label" VARCHAR(50),
    "built_year" SMALLINT,
    "conservation_state" "conservation_state",
    "estimated_value_cents" BIGINT,
    "annual_expenses_cents" BIGINT NOT NULL DEFAULT 0,
    "occupancy_rate" DECIMAL(5,2) NOT NULL DEFAULT 90,
    "rental_mode" "rental_mode" NOT NULL DEFAULT 'manual',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_manual_rentals" (
    "property_id" UUID NOT NULL,
    "tenant_name" VARCHAR(255),
    "monthly_rent_cents" BIGINT NOT NULL DEFAULT 0,
    "due_day" SMALLINT,

    CONSTRAINT "property_manual_rentals_pkey" PRIMARY KEY ("property_id")
);

-- CreateTable
CREATE TABLE "property_addresses" (
    "property_id" UUID NOT NULL,
    "city_id" INTEGER NOT NULL,
    "postal_code" VARCHAR(9),
    "street" VARCHAR(255) NOT NULL,
    "number" VARCHAR(20),
    "complement" VARCHAR(100),
    "neighborhood" VARCHAR(100),
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),

    CONSTRAINT "property_addresses_pkey" PRIMARY KEY ("property_id")
);

-- CreateTable
CREATE TABLE "property_acquisitions" (
    "property_id" UUID NOT NULL,
    "acquisition_type" "acquisition_type" NOT NULL,
    "acquired_on" DATE,
    "cost_cents" BIGINT,

    CONSTRAINT "property_acquisitions_pkey" PRIMARY KEY ("property_id")
);

-- CreateTable
CREATE TABLE "property_financings" (
    "property_id" UUID NOT NULL,
    "acquisition_type" "acquisition_type" NOT NULL,
    "lender" VARCHAR(255),
    "financed_amount_cents" BIGINT NOT NULL,
    "term_months" SMALLINT NOT NULL,
    "annual_interest_rate" DECIMAL(7,4) NOT NULL,
    "amortization_system" "amortization_system" NOT NULL,
    "first_installment_on" DATE NOT NULL,

    CONSTRAINT "property_financings_pkey" PRIMARY KEY ("property_id")
);

-- CreateTable
CREATE TABLE "property_legal_records" (
    "property_id" UUID NOT NULL,
    "registration_status" "registration_status" NOT NULL DEFAULT 'regular',
    "irregularity_description" TEXT,
    "registry_number" VARCHAR(50),
    "registry_office" VARCHAR(255),
    "notes" TEXT,

    CONSTRAINT "property_legal_records_pkey" PRIMARY KEY ("property_id")
);

-- CreateTable
CREATE TABLE "property_insurances" (
    "property_id" UUID NOT NULL,
    "description" TEXT,

    CONSTRAINT "property_insurances_pkey" PRIMARY KEY ("property_id")
);

-- CreateTable
CREATE TABLE "property_proposals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "property_id" UUID NOT NULL,
    "proposal_type" "proposal_type" NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "proposal_date" DATE NOT NULL,
    "contact" VARCHAR(255),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stored_files" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "storage_key" VARCHAR(500) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stored_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_photos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "position" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "category" VARCHAR(50),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "occupant_id" UUID NOT NULL,
    "contract_type" "contract_type" NOT NULL,
    "status" "contract_status" NOT NULL DEFAULT 'active',
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "notes" TEXT,
    "pdf_file_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_rent_terms" (
    "contract_id" UUID NOT NULL,
    "contract_type" "contract_type" NOT NULL,
    "monthly_rent_cents" BIGINT NOT NULL,
    "due_day" SMALLINT NOT NULL,
    "adjustment_index" "adjustment_index",

    CONSTRAINT "contract_rent_terms_pkey" PRIMARY KEY ("contract_id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "contract_id" UUID,
    "occupant_id" UUID NOT NULL,
    "check_in" DATE NOT NULL,
    "check_out" DATE NOT NULL,
    "total_amount_cents" BIGINT NOT NULL DEFAULT 0,
    "status" "reservation_status" NOT NULL DEFAULT 'confirmed',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "category_id" INTEGER NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "occurred_on" DATE NOT NULL,
    "description" VARCHAR(500),
    "is_recurring" BOOLEAN NOT NULL DEFAULT false,
    "recurrence_ends_on" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_templates" (
    "organization_id" UUID NOT NULL,
    "header" TEXT NOT NULL,
    "clauses" TEXT NOT NULL,
    "footer" TEXT NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_templates_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "feedbacks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "message" TEXT NOT NULL,
    "attachment_file_id" UUID,
    "status" "feedback_status" NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedbacks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "organization_id" UUID,
    "actor_user_id" UUID,
    "actor_name" VARCHAR(255),
    "actor_email" VARCHAR(320),
    "actor_role" VARCHAR(100),
    "impersonated_by_id" UUID,
    "action" "audit_action" NOT NULL,
    "entity_type" "audit_entity_type",
    "entity_id" UUID,
    "details" TEXT,
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "sessions_active_organization_id_idx" ON "sessions"("active_organization_id");

-- CreateIndex
CREATE INDEX "sessions_impersonated_by_id_idx" ON "sessions"("impersonated_by_id");

-- CreateIndex
CREATE INDEX "accounts_user_id_idx" ON "accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_id_account_id_key" ON "accounts"("provider_id", "account_id");

-- CreateIndex
CREATE INDEX "verifications_identifier_idx" ON "verifications"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "organizations_is_demo_demo_expires_at_idx" ON "organizations"("is_demo", "demo_expires_at");

-- CreateIndex
CREATE INDEX "members_user_id_idx" ON "members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "members_organization_id_user_id_key" ON "members"("organization_id", "user_id");

-- CreateIndex
CREATE INDEX "invitations_organization_id_email_idx" ON "invitations"("organization_id", "email");

-- CreateIndex
CREATE INDEX "invitations_inviter_id_idx" ON "invitations"("inviter_id");

-- CreateIndex
CREATE INDEX "clients_organization_id_created_by_id_idx" ON "clients"("organization_id", "created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "clients_id_organization_id_key" ON "clients"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "clients_organization_id_document_key" ON "clients"("organization_id", "document");

-- CreateIndex
CREATE UNIQUE INDEX "occupants_id_organization_id_key" ON "occupants"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "occupants_organization_id_document_key" ON "occupants"("organization_id", "document");

-- CreateIndex
CREATE UNIQUE INDEX "agencies_id_organization_id_key" ON "agencies"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "agencies_organization_id_name_key" ON "agencies"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "cities_state_name_key" ON "cities"("state", "name");

-- CreateIndex
CREATE UNIQUE INDEX "property_subtypes_property_type_name_key" ON "property_subtypes"("property_type", "name");

-- CreateIndex
CREATE UNIQUE INDEX "property_subtypes_id_property_type_key" ON "property_subtypes"("id", "property_type");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_categories_transaction_type_name_key" ON "transaction_categories"("transaction_type", "name");

-- CreateIndex
CREATE INDEX "properties_organization_id_created_by_id_idx" ON "properties"("organization_id", "created_by_id");

-- CreateIndex
CREATE INDEX "properties_organization_id_client_id_idx" ON "properties"("organization_id", "client_id");

-- CreateIndex
CREATE INDEX "properties_organization_id_agency_id_idx" ON "properties"("organization_id", "agency_id");

-- CreateIndex
CREATE INDEX "properties_organization_id_property_type_idx" ON "properties"("organization_id", "property_type");

-- CreateIndex
CREATE INDEX "properties_subtype_id_idx" ON "properties"("subtype_id");

-- CreateIndex
CREATE UNIQUE INDEX "properties_id_organization_id_key" ON "properties"("id", "organization_id");

-- CreateIndex
CREATE INDEX "property_addresses_city_id_idx" ON "property_addresses"("city_id");

-- CreateIndex
CREATE UNIQUE INDEX "property_acquisitions_property_id_acquisition_type_key" ON "property_acquisitions"("property_id", "acquisition_type");

-- CreateIndex
CREATE UNIQUE INDEX "property_financings_property_id_acquisition_type_key" ON "property_financings"("property_id", "acquisition_type");

-- CreateIndex
CREATE INDEX "property_proposals_property_id_proposal_date_idx" ON "property_proposals"("property_id", "proposal_date");

-- CreateIndex
CREATE UNIQUE INDEX "stored_files_storage_key_key" ON "stored_files"("storage_key");

-- CreateIndex
CREATE INDEX "stored_files_organization_id_uploaded_by_id_idx" ON "stored_files"("organization_id", "uploaded_by_id");

-- CreateIndex
CREATE INDEX "stored_files_created_at_idx" ON "stored_files"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "stored_files_id_organization_id_key" ON "stored_files"("id", "organization_id");

-- CreateIndex
CREATE INDEX "property_photos_property_id_position_idx" ON "property_photos"("property_id", "position");

-- CreateIndex
CREATE INDEX "property_photos_file_id_organization_id_idx" ON "property_photos"("file_id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "property_photos_property_id_file_id_key" ON "property_photos"("property_id", "file_id");

-- CreateIndex
CREATE UNIQUE INDEX "property_documents_file_id_key" ON "property_documents"("file_id");

-- CreateIndex
CREATE INDEX "property_documents_property_id_idx" ON "property_documents"("property_id");

-- CreateIndex
CREATE INDEX "contracts_property_id_status_idx" ON "contracts"("property_id", "status");

-- CreateIndex
CREATE INDEX "contracts_organization_id_status_idx" ON "contracts"("organization_id", "status");

-- CreateIndex
CREATE INDEX "contracts_occupant_id_organization_id_idx" ON "contracts"("occupant_id", "organization_id");

-- CreateIndex
CREATE INDEX "contracts_pdf_file_id_organization_id_idx" ON "contracts"("pdf_file_id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_id_organization_id_key" ON "contracts"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_id_property_id_key" ON "contracts"("id", "property_id");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_id_contract_type_key" ON "contracts"("id", "contract_type");

-- CreateIndex
CREATE UNIQUE INDEX "contract_rent_terms_contract_id_contract_type_key" ON "contract_rent_terms"("contract_id", "contract_type");

-- CreateIndex
CREATE INDEX "reservations_property_id_check_in_idx" ON "reservations"("property_id", "check_in");

-- CreateIndex
CREATE INDEX "reservations_organization_id_check_in_idx" ON "reservations"("organization_id", "check_in");

-- CreateIndex
CREATE INDEX "reservations_contract_id_property_id_idx" ON "reservations"("contract_id", "property_id");

-- CreateIndex
CREATE INDEX "reservations_occupant_id_organization_id_idx" ON "reservations"("occupant_id", "organization_id");

-- CreateIndex
CREATE INDEX "transactions_property_id_occurred_on_idx" ON "transactions"("property_id", "occurred_on");

-- CreateIndex
CREATE INDEX "transactions_organization_id_occurred_on_idx" ON "transactions"("organization_id", "occurred_on");

-- CreateIndex
CREATE INDEX "transactions_category_id_idx" ON "transactions"("category_id");

-- CreateIndex
CREATE INDEX "feedbacks_status_created_at_idx" ON "feedbacks"("status", "created_at");

-- CreateIndex
CREATE INDEX "feedbacks_user_id_idx" ON "feedbacks"("user_id");

-- CreateIndex
CREATE INDEX "feedbacks_attachment_file_id_organization_id_idx" ON "feedbacks"("attachment_file_id", "organization_id");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_created_at_idx" ON "audit_logs"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_impersonated_by_id_idx" ON "audit_logs"("impersonated_by_id");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_active_organization_id_fkey" FOREIGN KEY ("active_organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_impersonated_by_id_fkey" FOREIGN KEY ("impersonated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_inviter_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_organization_id_created_by_id_fkey" FOREIGN KEY ("organization_id", "created_by_id") REFERENCES "members"("organization_id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "occupants" ADD CONSTRAINT "occupants_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agencies" ADD CONSTRAINT "agencies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_organization_id_created_by_id_fkey" FOREIGN KEY ("organization_id", "created_by_id") REFERENCES "members"("organization_id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_client_id_organization_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_agency_id_organization_id_fkey" FOREIGN KEY ("agency_id", "organization_id") REFERENCES "agencies"("id", "organization_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_subtype_id_property_type_fkey" FOREIGN KEY ("subtype_id", "property_type") REFERENCES "property_subtypes"("id", "property_type") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_property_type_usage_type_fkey" FOREIGN KEY ("property_type", "usage_type") REFERENCES "property_type_usages"("property_type", "usage_type") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_manual_rentals" ADD CONSTRAINT "property_manual_rentals_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_addresses" ADD CONSTRAINT "property_addresses_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_addresses" ADD CONSTRAINT "property_addresses_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("ibge_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_acquisitions" ADD CONSTRAINT "property_acquisitions_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_financings" ADD CONSTRAINT "property_financings_property_id_acquisition_type_fkey" FOREIGN KEY ("property_id", "acquisition_type") REFERENCES "property_acquisitions"("property_id", "acquisition_type") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_legal_records" ADD CONSTRAINT "property_legal_records_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_insurances" ADD CONSTRAINT "property_insurances_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_proposals" ADD CONSTRAINT "property_proposals_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_organization_id_uploaded_by_id_fkey" FOREIGN KEY ("organization_id", "uploaded_by_id") REFERENCES "members"("organization_id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_photos" ADD CONSTRAINT "property_photos_property_id_organization_id_fkey" FOREIGN KEY ("property_id", "organization_id") REFERENCES "properties"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_photos" ADD CONSTRAINT "property_photos_file_id_organization_id_fkey" FOREIGN KEY ("file_id", "organization_id") REFERENCES "stored_files"("id", "organization_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_documents" ADD CONSTRAINT "property_documents_property_id_organization_id_fkey" FOREIGN KEY ("property_id", "organization_id") REFERENCES "properties"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_documents" ADD CONSTRAINT "property_documents_file_id_organization_id_fkey" FOREIGN KEY ("file_id", "organization_id") REFERENCES "stored_files"("id", "organization_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_property_id_organization_id_fkey" FOREIGN KEY ("property_id", "organization_id") REFERENCES "properties"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_occupant_id_organization_id_fkey" FOREIGN KEY ("occupant_id", "organization_id") REFERENCES "occupants"("id", "organization_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_pdf_file_id_organization_id_fkey" FOREIGN KEY ("pdf_file_id", "organization_id") REFERENCES "stored_files"("id", "organization_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_rent_terms" ADD CONSTRAINT "contract_rent_terms_contract_id_contract_type_fkey" FOREIGN KEY ("contract_id", "contract_type") REFERENCES "contracts"("id", "contract_type") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_property_id_organization_id_fkey" FOREIGN KEY ("property_id", "organization_id") REFERENCES "properties"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_occupant_id_organization_id_fkey" FOREIGN KEY ("occupant_id", "organization_id") REFERENCES "occupants"("id", "organization_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_contract_id_property_id_fkey" FOREIGN KEY ("contract_id", "property_id") REFERENCES "contracts"("id", "property_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_property_id_organization_id_fkey" FOREIGN KEY ("property_id", "organization_id") REFERENCES "properties"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "transaction_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_templates" ADD CONSTRAINT "contract_templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_templates" ADD CONSTRAINT "contract_templates_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_attachment_file_id_organization_id_fkey" FOREIGN KEY ("attachment_file_id", "organization_id") REFERENCES "stored_files"("id", "organization_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_impersonated_by_id_fkey" FOREIGN KEY ("impersonated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
