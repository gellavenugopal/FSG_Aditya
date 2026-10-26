import { seedFinancialPeriodMasters } from '../../shared/financial-periods.mjs'

export async function ensureEngagementSchema(query) {
  if (typeof query !== 'function') throw new Error('A PostgreSQL query function is required for the engagement schema.')
  await query(`ALTER TABLE entities ADD COLUMN IF NOT EXISTS jurisdiction TEXT`)
  await query(`ALTER TABLE entities ADD COLUMN IF NOT EXISTS legal_form TEXT`)
  await query(`CREATE SEQUENCE IF NOT EXISTS engagement_reference_seq`)

  await query(`
    CREATE TABLE IF NOT EXISTS firms (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS firm_users (
      id SERIAL PRIMARY KEY,
      firm_id INTEGER NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      display_name TEXT NOT NULL,
      job_title TEXT NOT NULL DEFAULT 'employee',
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('administrator', 'partner', 'staff')),
      professional_signatory_id INTEGER REFERENCES global_signatories(id) ON DELETE SET NULL,
      must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (firm_id, email)
    )
  `)
  await query(`ALTER TABLE firm_users ADD COLUMN IF NOT EXISTS job_title TEXT`)
  await query(`
    UPDATE firm_users
    SET job_title=CASE WHEN role IN ('administrator','partner') THEN 'partner' ELSE 'employee' END
    WHERE job_title IS NULL OR btrim(job_title)=''
  `)
  await query(`ALTER TABLE firm_users ALTER COLUMN job_title SET DEFAULT 'employee'`)
  await query(`ALTER TABLE firm_users ALTER COLUMN job_title SET NOT NULL`)
  await query(`ALTER TABLE firm_users ADD COLUMN IF NOT EXISTS qualification TEXT`)
  await query(`ALTER TABLE firm_users ADD COLUMN IF NOT EXISTS registration_number TEXT`)

  await query(`
    CREATE TABLE IF NOT EXISTS auditor_firms (
      id SERIAL PRIMARY KEY,
      firm_name TEXT NOT NULL,
      frn TEXT,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT now(),
      pan TEXT,
      address TEXT,
      email TEXT
    )
  `)
  await query(`ALTER TABLE auditor_firms ADD COLUMN IF NOT EXISTS service_firm_id INTEGER REFERENCES firms(id) ON DELETE CASCADE`)
  await query(`ALTER TABLE auditor_firms ADD COLUMN IF NOT EXISTS phone TEXT`)
  await query(`ALTER TABLE auditor_firms ADD COLUMN IF NOT EXISTS logo_mime_type TEXT`)
  await query(`ALTER TABLE auditor_firms ADD COLUMN IF NOT EXISTS logo_data BYTEA`)
  await query(`CREATE INDEX IF NOT EXISTS idx_auditor_firms_service_firm ON auditor_firms(service_firm_id)`)

  await query(`
    CREATE TABLE IF NOT EXISTS auditor_firm_offices (
      id SERIAL PRIMARY KEY,
      service_firm_id INTEGER NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
      auditor_firm_id INTEGER NOT NULL REFERENCES auditor_firms(id) ON DELETE CASCADE,
      office_name TEXT NOT NULL,
      address TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_auditor_firm_offices_firm ON auditor_firm_offices(service_firm_id,auditor_firm_id,is_active)`)

  await query(`
    CREATE TABLE IF NOT EXISTS firm_entities (
      firm_id INTEGER NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
      entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      linked_by INTEGER REFERENCES firm_users(id) ON DELETE SET NULL,
      linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (firm_id, entity_id)
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS reporting_pack_catalog (
      pack_id TEXT PRIMARY KEY,
      jurisdiction TEXT NOT NULL,
      framework TEXT NOT NULL,
      pack_version TEXT NOT NULL,
      processing_status TEXT NOT NULL CHECK (processing_status IN ('implemented', 'not_implemented')),
      description TEXT NOT NULL
    )
  `)
  await query(`
    INSERT INTO reporting_pack_catalog (pack_id, jurisdiction, framework, pack_version, processing_status, description)
    VALUES
      ('IN_SCHEDULE_III_LEGACY', 'IN', 'India legacy Schedule III', 'legacy-1', 'implemented', 'Existing India workflow; compatibility is retained and must be confirmed for each engagement.'),
      ('IN_IND_AS', 'IN', 'Ind AS', 'catalog-1', 'not_implemented', 'Reporting engine not implemented.'),
      ('AE_IFRS', 'AE', 'IFRS', 'catalog-1', 'not_implemented', 'Reporting engine not implemented.'),
      ('US_GAAP', 'US', 'US GAAP', 'catalog-1', 'not_implemented', 'Reporting engine not implemented.')
    ON CONFLICT (pack_id) DO NOTHING
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS engagements (
      id BIGSERIAL PRIMARY KEY,
      firm_id INTEGER NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
      reference TEXT NOT NULL,
      name TEXT NOT NULL,
      entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE RESTRICT,
      period_start DATE,
      period_end DATE,
      owner_user_id INTEGER NOT NULL REFERENCES firm_users(id) ON DELETE RESTRICT,
      partner_user_id INTEGER REFERENCES firm_users(id) ON DELETE RESTRICT,
      substitute_user_id INTEGER REFERENCES firm_users(id) ON DELETE RESTRICT,
      service_scope TEXT[] NOT NULL DEFAULT '{}',
      status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'finalised', 'archived')),
      separate_reason TEXT,
      created_by INTEGER NOT NULL REFERENCES firm_users(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (firm_id, reference),
      CHECK (period_start IS NULL OR period_end IS NULL OR period_start < period_end)
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_engagements_firm_period ON engagements(firm_id, entity_id, period_start, period_end)`)

  await query(`
    CREATE TABLE IF NOT EXISTS engagement_reporting_sets (
      id BIGSERIAL PRIMARY KEY,
      engagement_id BIGINT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
      jurisdiction TEXT NOT NULL DEFAULT 'IN',
      accounting_framework TEXT NOT NULL DEFAULT 'India legacy Schedule III',
      reporting_pack_id TEXT REFERENCES reporting_pack_catalog(pack_id),
      reporting_pack_version TEXT,
      trial_balance_currency CHAR(3),
      presentation_currency CHAR(3),
      display_scale TEXT NOT NULL DEFAULT 'units',
      decimal_places SMALLINT NOT NULL DEFAULT 2 CHECK (decimal_places BETWEEN 0 AND 6),
      template_selections JSONB NOT NULL DEFAULT '{}',
      entity_period_id INTEGER REFERENCES entity_periods(id) ON DELETE RESTRICT,
      compatibility_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
      prior_trial_balance_id INTEGER REFERENCES trial_balances(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_reporting_sets_engagement ON engagement_reporting_sets(engagement_id)`)
  await query(`ALTER TABLE engagement_reporting_sets ADD COLUMN IF NOT EXISTS prior_entity_period_state JSONB`)
  await query(`ALTER TABLE engagement_reporting_sets ADD COLUMN IF NOT EXISTS finalisation_sign_place TEXT`)
  await query(`ALTER TABLE engagement_reporting_sets ADD COLUMN IF NOT EXISTS finalisation_sign_date TEXT`)
  await query(`ALTER TABLE engagement_reporting_sets ADD COLUMN IF NOT EXISTS engagement_finalised_at TIMESTAMPTZ`)
  await query(`ALTER TABLE engagement_reporting_sets ADD COLUMN IF NOT EXISTS prior_trial_balance_id INTEGER REFERENCES trial_balances(id) ON DELETE RESTRICT`)
  await query(`ALTER TABLE engagement_reporting_sets ADD COLUMN IF NOT EXISTS responsible_auditor_firm_id INTEGER REFERENCES auditor_firms(id) ON DELETE RESTRICT`)
  await query(`ALTER TABLE engagement_reporting_sets ADD COLUMN IF NOT EXISTS responsible_office_id INTEGER REFERENCES auditor_firm_offices(id) ON DELETE RESTRICT`)
  await query(`ALTER TABLE engagement_reporting_sets ADD COLUMN IF NOT EXISTS branding_auditor_firm_id INTEGER REFERENCES auditor_firms(id) ON DELETE RESTRICT`)
  await query(`ALTER TABLE engagement_reporting_sets ADD COLUMN IF NOT EXISTS management_signatory_ids JSONB NOT NULL DEFAULT '[]'`)

  await query(`
    CREATE TABLE IF NOT EXISTS engagement_memberships (
      id BIGSERIAL PRIMARY KEY,
      engagement_id BIGINT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES firm_users(id) ON DELETE CASCADE,
      access_level TEXT NOT NULL CHECK (access_level IN ('read', 'edit')),
      granted_by INTEGER NOT NULL REFERENCES firm_users(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (engagement_id, user_id)
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS engagement_access_requests (
      id BIGSERIAL PRIMARY KEY,
      engagement_id BIGINT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES firm_users(id) ON DELETE CASCADE,
      message TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
      resolved_by INTEGER REFERENCES firm_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      resolved_at TIMESTAMPTZ,
      UNIQUE (engagement_id, user_id)
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS engagement_legacy_links (
      id BIGSERIAL PRIMARY KEY,
      engagement_id BIGINT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
      entity_period_id INTEGER NOT NULL REFERENCES entity_periods(id) ON DELETE RESTRICT,
      confirmation_status TEXT NOT NULL CHECK (confirmation_status IN ('needs_confirmation', 'confirmed')),
      confirmation_note TEXT,
      linked_by INTEGER NOT NULL REFERENCES firm_users(id) ON DELETE RESTRICT,
      linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      confirmed_by INTEGER REFERENCES firm_users(id) ON DELETE SET NULL,
      confirmed_at TIMESTAMPTZ,
      UNIQUE (engagement_id, entity_period_id)
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS engagement_legacy_tb_links (
      id BIGSERIAL PRIMARY KEY,
      engagement_id BIGINT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
      trial_balance_id INTEGER NOT NULL REFERENCES trial_balances(id) ON DELETE RESTRICT,
      entity_period_id INTEGER NOT NULL REFERENCES entity_periods(id) ON DELETE RESTRICT,
      linked_by INTEGER NOT NULL REFERENCES firm_users(id) ON DELETE RESTRICT,
      linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      confirmation_note TEXT NOT NULL,
      UNIQUE (engagement_id, trial_balance_id)
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS engagement_trial_balance_imports (
      id BIGSERIAL PRIMARY KEY,
      engagement_id BIGINT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
      trial_balance_id INTEGER NOT NULL UNIQUE REFERENCES trial_balances(id) ON DELETE RESTRICT,
      source_filename TEXT NOT NULL,
      source_sha256 TEXT NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
      source_size_bytes BIGINT NOT NULL CHECK (source_size_bytes > 0),
      imported_by INTEGER NOT NULL REFERENCES firm_users(id) ON DELETE RESTRICT,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (engagement_id, source_sha256)
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_engagement_tb_imports_engagement ON engagement_trial_balance_imports(engagement_id, imported_at DESC)`)

  await query(`
    CREATE TABLE IF NOT EXISTS engagement_journals (
      id BIGSERIAL PRIMARY KEY,
      engagement_id BIGINT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
      source_trial_balance_id INTEGER NOT NULL REFERENCES trial_balances(id) ON DELETE RESTRICT,
      entry_number INTEGER NOT NULL,
      journal_date DATE NOT NULL,
      narration TEXT NOT NULL,
      created_by INTEGER NOT NULL REFERENCES firm_users(id) ON DELETE RESTRICT,
      posted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (engagement_id, entry_number)
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_engagement_journals_context ON engagement_journals(engagement_id, source_trial_balance_id, posted_at)`)
  await query(`
    CREATE TABLE IF NOT EXISTS engagement_journal_lines (
      id BIGSERIAL PRIMARY KEY,
      journal_id BIGINT NOT NULL REFERENCES engagement_journals(id) ON DELETE RESTRICT,
      line_number SMALLINT NOT NULL,
      ledger_name TEXT NOT NULL,
      ledger_code TEXT,
      entry_side TEXT NOT NULL CHECK (entry_side IN ('Dr', 'Cr')),
      amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (journal_id, line_number)
    )
  `)
  await query(`
    CREATE TABLE IF NOT EXISTS engagement_final_tb_snapshots (
      id BIGSERIAL PRIMARY KEY,
      engagement_id BIGINT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
      source_trial_balance_id INTEGER NOT NULL REFERENCES trial_balances(id) ON DELETE RESTRICT,
      trial_balance_id INTEGER NOT NULL UNIQUE REFERENCES trial_balances(id) ON DELETE RESTRICT,
      version INTEGER NOT NULL CHECK (version > 0),
      journal_watermark BIGINT NOT NULL DEFAULT 0,
      mapping_rule_set_id INTEGER REFERENCES mapping_rule_sets(id) ON DELETE RESTRICT,
      created_by INTEGER NOT NULL REFERENCES firm_users(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (engagement_id, version)
    )
  `)
  await query(`
    CREATE TABLE IF NOT EXISTS engagement_audit_report_settings (
      engagement_id BIGINT PRIMARY KEY REFERENCES engagements(id) ON DELETE CASCADE,
      template_id TEXT NOT NULL DEFAULT 'india-basic-v1',
      revision INTEGER NOT NULL DEFAULT 1,
      fields JSONB NOT NULL DEFAULT '{}',
      updated_by INTEGER NOT NULL REFERENCES firm_users(id) ON DELETE RESTRICT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await query(`
    CREATE TABLE IF NOT EXISTS engagement_report_outputs (
      id BIGSERIAL PRIMARY KEY,
      engagement_id BIGINT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
      final_tb_snapshot_id BIGINT NOT NULL REFERENCES engagement_final_tb_snapshots(id) ON DELETE RESTRICT,
      version INTEGER NOT NULL CHECK (version > 0),
      template_id TEXT NOT NULL,
      template_revision INTEGER NOT NULL,
      audit_report_fields JSONB NOT NULL,
      signing_details JSONB NOT NULL,
      financial_data_sha256 TEXT NOT NULL CHECK (financial_data_sha256 ~ '^[a-f0-9]{64}$'),
      pdf_content BYTEA NOT NULL,
      created_by INTEGER NOT NULL REFERENCES firm_users(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      finalised_by INTEGER REFERENCES firm_users(id) ON DELETE RESTRICT,
      finalised_at TIMESTAMPTZ,
      UNIQUE (engagement_id, version)
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_engagement_report_outputs_context ON engagement_report_outputs(engagement_id, created_at DESC)`)

  await query(`
    CREATE TABLE IF NOT EXISTS engagement_audit_log (
      id BIGSERIAL PRIMARY KEY,
      firm_id INTEGER NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
      engagement_id BIGINT REFERENCES engagements(id) ON DELETE SET NULL,
      actor_user_id INTEGER REFERENCES firm_users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      details JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_engagement_audit_history ON engagement_audit_log(firm_id, engagement_id, created_at DESC)`)
  await seedFinancialPeriodMasters(query)
}
