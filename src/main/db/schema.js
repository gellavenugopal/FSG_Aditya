import { query } from './client.js'

// One-time migration marker. Used to gate work that must run exactly once
// against the shared database (not once per client boot) — e.g. reseeding
// the default mapping from Mapping_v2.xlsx. Plain idempotent statements
// below (CREATE TABLE IF NOT EXISTS, guarded UPDATE/INSERT...WHERE NOT
// EXISTS) don't need this: they're safe to run on every boot, and
// index.js's withStartupLock() serializes concurrent clients so there's no
// race even during first-ever setup.
export async function tryClaimMigration(key) {
  const { rows } = await query(
    `INSERT INTO schema_migrations (key) VALUES ($1) ON CONFLICT (key) DO NOTHING RETURNING key`,
    [key]
  )
  return rows.length > 0
}

export async function ensureSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      key        TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT now()
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS entities (
      id                   SERIAL PRIMARY KEY,
      name                 TEXT NOT NULL,
      constitution         INTEGER NOT NULL CHECK (constitution IN (1,2,3)),
      constitution_display TEXT NOT NULL,
      business_type        TEXT,
      created_at           TIMESTAMPTZ DEFAULT now(),
      updated_at           TIMESTAMPTZ DEFAULT now()
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS mapping_rule_sets (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL,
      is_default BOOLEAN DEFAULT FALSE,
      entity_id  INTEGER REFERENCES entities(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS level_format (
      id          SERIAL PRIMARY KEY,
      rule_set_id INTEGER NOT NULL REFERENCES mapping_rule_sets(id) ON DELETE CASCADE,
      constitution INTEGER NOT NULL,
      alie        TEXT,
      level1      TEXT,
      level2      TEXT,
      level3      TEXT,
      level4      TEXT,
      level5      TEXT,
      level6      TEXT,
      level7      TEXT,
      sort_order  INTEGER DEFAULT 0
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS map1 (
      id                 SERIAL PRIMARY KEY,
      rule_set_id        INTEGER NOT NULL REFERENCES mapping_rule_sets(id) ON DELETE CASCADE,
      constitution       INTEGER NOT NULL,
      tally_pre_primary  TEXT,
      mapping1_resultant TEXT
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS map2 (
      id                 SERIAL PRIMARY KEY,
      rule_set_id        INTEGER NOT NULL REFERENCES mapping_rule_sets(id) ON DELETE CASCADE,
      constitution       INTEGER NOT NULL,
      keywords           TEXT,
      mapping2_resultant TEXT,
      mapping1_resultant TEXT,
      priority           INTEGER DEFAULT 1,
      notes              TEXT
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS map3 (
      id                 SERIAL PRIMARY KEY,
      rule_set_id        INTEGER NOT NULL REFERENCES mapping_rule_sets(id) ON DELETE CASCADE,
      constitution       INTEGER NOT NULL,
      keywords           TEXT,
      mapping1_resultant TEXT,
      mapping2_resultant TEXT,
      mapping3_resultant TEXT,
      priority           INTEGER DEFAULT 1,
      notes              TEXT
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS trial_balances (
      id          SERIAL PRIMARY KEY,
      entity_id   INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      period      TEXT,
      filename    TEXT,
      uploaded_at TIMESTAMPTZ DEFAULT now(),
      row_count   INTEGER DEFAULT 0
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS tb_rows (
      id                 SERIAL PRIMARY KEY,
      tb_id              INTEGER NOT NULL REFERENCES trial_balances(id) ON DELETE CASCADE,
      period             TEXT,
      branch             TEXT,
      ledger_code        TEXT,
      name               TEXT,
      opening_balance    NUMERIC DEFAULT 0,
      debit              NUMERIC DEFAULT 0,
      credit             NUMERIC DEFAULT 0,
      closing_balance    NUMERIC DEFAULT 0,
      is_revenue         BOOLEAN,
      is_deemed_positive BOOLEAN,
      trail_balance      NUMERIC DEFAULT 0,
      parent             TEXT,
      group_parent       TEXT,
      group_parent_1     TEXT,
      group_parent_2     TEXT,
      group_parent_3     TEXT,
      group_parent_4     TEXT,
      group_parent_5     TEXT,
      group_parent_6     TEXT,
      group_parent_7     TEXT,
      group_parent_8     TEXT,
      trial_balance_type TEXT,
      upload_nature      TEXT DEFAULT 'Excel Upload'
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS mapped_tb (
      id                     SERIAL PRIMARY KEY,
      tb_id                  INTEGER NOT NULL REFERENCES trial_balances(id) ON DELETE CASCADE,
      tb_row_id              INTEGER NOT NULL REFERENCES tb_rows(id) ON DELETE CASCADE,
      rule_set_id            INTEGER REFERENCES mapping_rule_sets(id),
      mapping1_resultant     TEXT,
      mapping2_resultant     TEXT,
      mapping3_resultant     TEXT,
      level_format_id        INTEGER REFERENCES level_format(id),
      level4_value           TEXT,
      level5_value           TEXT,
      level6_value           TEXT,
      level7_value           TEXT,
      alie                   TEXT,
      status                 TEXT DEFAULT 'auto_high',
      confidence             TEXT DEFAULT 'high',
      conflict_candidates    TEXT,
      conflict_stage         INTEGER,
      discrepancy_suggestion TEXT,
      override_note          TEXT,
      mapped_at              TIMESTAMPTZ DEFAULT now(),
      UNIQUE(tb_id, tb_row_id)
    )
  `)

  await query(`CREATE INDEX IF NOT EXISTS idx_tb_rows_tb_id      ON tb_rows(tb_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_mapped_tb_tb_id    ON mapped_tb(tb_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_level_format_const ON level_format(rule_set_id, constitution)`)
  // Expression indexes for the (specify nature) fuzzy-match correlated subquery in mappedTB:rows
  await query(`CREATE INDEX IF NOT EXISTS idx_lf_level2_clean ON level_format(rule_set_id, LOWER(TRIM(REPLACE(level2,'(specify nature)',''))))`)
  await query(`CREATE INDEX IF NOT EXISTS idx_lf_level3_clean ON level_format(rule_set_id, LOWER(TRIM(REPLACE(level3,'(specify nature)',''))))`)
  await query(`CREATE INDEX IF NOT EXISTS idx_map2_const         ON map2(rule_set_id, constitution)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_map3_const         ON map3(rule_set_id, constitution)`)

  // ── Auditor master (per entity) ─────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS auditors (
      id                SERIAL PRIMARY KEY,
      entity_id         INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      firm_name         TEXT,
      frn               TEXT,
      name              TEXT NOT NULL,
      designation       TEXT,
      membership_number TEXT NOT NULL,
      is_active         BOOLEAN DEFAULT TRUE,
      created_at        TIMESTAMPTZ DEFAULT now()
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_auditors_entity ON auditors(entity_id)`)

  // ── Signatory master ────────────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS signatories (
      id          SERIAL PRIMARY KEY,
      entity_id   INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      din         TEXT,
      designation TEXT,
      is_active   BOOLEAN DEFAULT TRUE,
      created_at  TIMESTAMPTZ DEFAULT now()
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_signatories_entity ON signatories(entity_id)`)

  // ── Global Auditor Firms (shared across all entities) ────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS auditor_firms (
      id         SERIAL PRIMARY KEY,
      firm_name  TEXT NOT NULL,
      frn        TEXT,
      is_active  BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `)
  // ── Global Signatories (belong to an auditor firm, shared across entities) ──
  await query(`
    CREATE TABLE IF NOT EXISTS global_signatories (
      id          SERIAL PRIMARY KEY,
      firm_id     INTEGER REFERENCES auditor_firms(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      din         TEXT,
      designation TEXT,
      membership_number TEXT,
      is_active   BOOLEAN DEFAULT TRUE,
      created_at  TIMESTAMPTZ DEFAULT now()
    )
  `)

  // Both global tables' is_active must be BOOLEAN (masters.js queries it as one);
  // a database set up differently gets converted once, 1 / 0 kept as true / false.
  for (const t of ['auditor_firms', 'global_signatories']) {
    const { rows: [c] } = await query(
      `SELECT data_type FROM information_schema.columns WHERE table_name = $1 AND column_name = 'is_active'`, [t])
    if (c && c.data_type !== 'boolean') {
      await query(`ALTER TABLE ${t} ALTER COLUMN is_active DROP DEFAULT`)
      await query(`ALTER TABLE ${t} ALTER COLUMN is_active TYPE BOOLEAN USING (COALESCE(is_active::text, '1') NOT IN ('0', 'false', 'f'))`)
      await query(`ALTER TABLE ${t} ALTER COLUMN is_active SET DEFAULT TRUE`)
    }
  }

  // ── Note Details (supplementary data for financial statement notes) ─────────
  // Stores structured JSON data entered manually for each note (e.g. Share Capital details)
  await query(`
    CREATE TABLE IF NOT EXISTS note_details (
      id         SERIAL PRIMARY KEY,
      tb_id      INTEGER NOT NULL REFERENCES trial_balances(id) ON DELETE CASCADE,
      note_num   INTEGER NOT NULL,
      note_title TEXT NOT NULL,
      data       TEXT NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(tb_id, note_num)
    )
  `)

  // ── ITR Details (BS/PL editable-form data for the current year) ─────────────
  // Stores the orange-cell entries + dynamic "Other Details" tables for the
  // ITR-format Balance Sheet / P&L schedule form, keyed per TB (current year only).
  await query(`
    CREATE TABLE IF NOT EXISTS itr_details (
      id         SERIAL PRIMARY KEY,
      tb_id      INTEGER NOT NULL REFERENCES trial_balances(id) ON DELETE CASCADE,
      data       TEXT NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(tb_id)
    )
  `)

  // ── Note Disclosures ──────────────────────────────────────────────────────
  // Optional free-text disclosure shown below a note's table (UI, PDF, Excel)
  // when non-empty. Separate from note_details (which stores structured
  // per-note form data, e.g. Share Capital / Changes-in-Inventory categories)
  // since a note can have BOTH a structured form and a disclosure note.
  await query(`
    CREATE TABLE IF NOT EXISTS note_disclosures (
      id         SERIAL PRIMARY KEY,
      tb_id      INTEGER NOT NULL REFERENCES trial_balances(id) ON DELETE CASCADE,
      note_num   INTEGER NOT NULL,
      note_title TEXT NOT NULL,
      text       TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(tb_id, note_num)
    )
  `)

  // Disclosure notes of the Consolidated view of an Auditee with branches (no Trial Balance of its own): saved against the Auditee,
  // by note title, like note_disclosures is saved against a Trial Balance.
  await query(`
    CREATE TABLE IF NOT EXISTS entity_note_disclosures (
      id         SERIAL PRIMARY KEY,
      entity_id  INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      note_num   INTEGER NOT NULL,
      note_title TEXT NOT NULL,
      text       TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(entity_id, note_num)
    )
  `)

  // ── Remarks ─────────────────────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS remarks (
      id         SERIAL PRIMARY KEY,
      tb_id      INTEGER NOT NULL REFERENCES trial_balances(id) ON DELETE CASCADE,
      scope      TEXT NOT NULL,
      scope_key  TEXT NOT NULL,
      remark     TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(tb_id, scope, scope_key)
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_remarks_tb    ON remarks(tb_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_remarks_scope ON remarks(tb_id, scope, scope_key)`)

  // ── Backfill ALIE for rows that are missing it ───────────────────────────────
  await query(`
    UPDATE mapped_tb SET alie = (
      SELECT lf.alie FROM level_format lf
      WHERE lf.level1 = mapped_tb.mapping1_resultant
        AND lf.rule_set_id = mapped_tb.rule_set_id
        AND lf.alie IS NOT NULL
      LIMIT 1
    )
    WHERE alie IS NULL AND mapping1_resultant IS NOT NULL
  `)

  // ── Repair stock row mappings ────────────────────────────────────────────────
  // Guarded like the other backfills below: skip rows the user has already
  // reviewed/overridden, so this doesn't silently revert manual reclassification
  // of stock ledgers on every app boot.
  await query(`
    UPDATE mapped_tb SET
      alie = 'Expenses',
      mapping1_resultant = 'Opening Stock (PL)',
      mapping2_resultant = 'Opening Stock',
      mapping3_resultant = 'Opening Stock'
    WHERE status NOT IN ('user_override', 'user_approved')
      AND tb_row_id IN (
      SELECT id FROM tb_rows
      WHERE upload_nature = 'Stock Entry' AND name LIKE 'Opening Stock -%'
    )
  `)
  await query(`
    UPDATE mapped_tb SET
      alie = 'Income',
      mapping1_resultant = 'Closing Stock (PL)',
      mapping2_resultant = 'Closing Stock',
      mapping3_resultant = 'Closing Stock'
    WHERE status NOT IN ('user_override', 'user_approved')
      AND tb_row_id IN (
      SELECT id FROM tb_rows
      WHERE upload_nature = 'Stock Entry' AND name LIKE 'Closing Stock - PL -%'
    )
  `)
  await query(`
    UPDATE mapped_tb SET
      alie = 'ASSETS',
      mapping1_resultant = 'Current assets',
      mapping2_resultant = 'Inventories',
      mapping3_resultant = 'Closing Stock (BS)'
    WHERE status NOT IN ('user_override', 'user_approved')
      AND tb_row_id IN (
      SELECT id FROM tb_rows
      WHERE upload_nature = 'Stock Entry' AND name LIKE 'Closing Stock - BS -%'
    )
  `)

  // ── Backfill level_format_id on user-decided rows ────────────────────────────
  // Every categorisation screen used to send level_format_id = NULL whenever
  // its client-side lookup missed — always, for a terminal Level 1 such as
  // Finance Costs — so 827 of 1,381 user-decided rows on the dev database had
  // no format row and rendered with blank Level columns. mappedTB:override now
  // resolves the id server-side; this fills the gap for rows saved before that.
  // Strictly NULL -> id: rows that already carry an id are untouched, and rows
  // with no matching format row stay NULL. Preference: exact Level 3 > the
  // Level-2 row > the terminal Level-1 row, mirroring RESOLVE_LF_SQL.
  await query(`
    UPDATE mapped_tb mt SET level_format_id = (
      SELECT lf.id FROM level_format lf
      WHERE lf.rule_set_id = mt.rule_set_id
        AND LOWER(TRIM(REPLACE(lf.level1, '(specify nature)', ''))) = LOWER(TRIM(REPLACE(mt.mapping1_resultant, '(specify nature)', '')))
        AND (
          (mt.mapping2_resultant IS NULL AND lf.level2 IS NULL)
          OR (mt.mapping2_resultant IS NOT NULL AND lf.level2 IS NOT NULL
              AND LOWER(TRIM(REPLACE(lf.level2, '(specify nature)', ''))) = LOWER(TRIM(REPLACE(mt.mapping2_resultant, '(specify nature)', ''))))
        )
      ORDER BY
        CASE WHEN mt.mapping3_resultant IS NOT NULL AND lf.level3 IS NOT NULL
                  AND LOWER(TRIM(REPLACE(lf.level3, '(specify nature)', ''))) = LOWER(TRIM(REPLACE(mt.mapping3_resultant, '(specify nature)', ''))) THEN 0
             WHEN lf.level3 IS NULL THEN 1
             ELSE 2 END,
        lf.id
      LIMIT 1
    )
    WHERE mt.level_format_id IS NULL
      AND mt.status IN ('user_override', 'user_approved')
      AND mt.mapping1_resultant IS NOT NULL
      AND mt.rule_set_id IS NOT NULL
  `)

  // ── Ensure Sale of Products / Sale of Services L3 entries exist ──────────────
  await query(`
    INSERT INTO level_format (rule_set_id, constitution, alie, level1, level2, level3, sort_order)
    SELECT DISTINCT lf.rule_set_id, lf.constitution, lf.alie, lf.level1, lf.level2,
                    'Sale of Products', lf.sort_order
    FROM level_format lf
    WHERE lf.level1 = 'Revenue from operations'
      AND lf.level2 = 'Sale'
      AND (lf.level3 IS NULL OR TRIM(lf.level3) = '')
      AND NOT EXISTS (
        SELECT 1 FROM level_format lf2
        WHERE lf2.rule_set_id = lf.rule_set_id
          AND lf2.constitution = lf.constitution
          AND lf2.level1 = lf.level1
          AND lf2.level2 = lf.level2
          AND lf2.level3 = 'Sale of Products'
      )
  `)
  await query(`
    INSERT INTO level_format (rule_set_id, constitution, alie, level1, level2, level3, sort_order)
    SELECT DISTINCT lf.rule_set_id, lf.constitution, lf.alie, lf.level1, lf.level2,
                    'Sale of Services', lf.sort_order
    FROM level_format lf
    WHERE lf.level1 = 'Revenue from operations'
      AND lf.level2 = 'Sale'
      AND (lf.level3 IS NULL OR TRIM(lf.level3) = '')
      AND NOT EXISTS (
        SELECT 1 FROM level_format lf2
        WHERE lf2.rule_set_id = lf.rule_set_id
          AND lf2.constitution = lf.constitution
          AND lf2.level1 = lf.level1
          AND lf2.level2 = lf.level2
          AND lf2.level3 = 'Sale of Services'
      )
  `)

  // ── Backfill Uncategorised Sale mapping3 ─────────────────────────────────────
  await query(`
    UPDATE mapped_tb
    SET mapping3_resultant = 'Uncategorised Sale'
    WHERE mapping1_resultant = 'Revenue from operations'
      AND mapping2_resultant = 'Sale'
      AND (mapping3_resultant IS NULL OR mapping3_resultant = '')
      AND status NOT IN ('user_override', 'user_approved')
  `)

  // ── Clear phantom Uncategorised L3 where L2 is terminal ──────────────────────
  await query(`
    UPDATE mapped_tb
    SET mapping3_resultant = NULL
    WHERE mapping3_resultant LIKE 'Uncategorised %'
      AND status NOT IN ('user_override', 'user_approved')
      AND NOT EXISTS (
        SELECT 1 FROM level_format lf
        WHERE lf.rule_set_id = mapped_tb.rule_set_id
          AND lf.level1 = mapped_tb.mapping1_resultant
          AND lf.level2 = mapped_tb.mapping2_resultant
          AND lf.level3 IS NOT NULL
          AND TRIM(lf.level3) <> ''
          AND LOWER(lf.level3) NOT LIKE 'uncategorised%'
      )
  `)

  // ── Depreciation Schedules ────────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS dep_schedules (
      id         SERIAL PRIMARY KEY,
      tb_id      INTEGER NOT NULL REFERENCES trial_balances(id) ON DELETE CASCADE,
      data       TEXT NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(tb_id)
    )
  `)

  // ── Depreciation — Income Tax Act, 1961 block-wise schedule ("Dep (IT)") ─────
  // Separate from dep_schedules (the Useful-Life/Schedule II module, left
  // untouched) — one row per TB, holding per-ledger inputs (block assignment,
  // Opening WDV, Additions, Deduction, STCL/STCG override) as JSON, keyed by
  // ledger name so edits survive a re-run of the mapping engine.
  await query(`
    CREATE TABLE IF NOT EXISTS dep_it_schedules (
      id         SERIAL PRIMARY KEY,
      tb_id      INTEGER NOT NULL REFERENCES trial_balances(id) ON DELETE CASCADE,
      data       TEXT NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(tb_id)
    )
  `)

  // ── Custom IT Act blocks — entity-level master, additive to the built-in
  // 12-block table so a block defined once (via "+ Add New Block" in Dep (IT))
  // is reusable across every TB/year for that entity.
  await query(`
    CREATE TABLE IF NOT EXISTS it_blocks_custom (
      id             SERIAL PRIMARY KEY,
      entity_id      INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      major_category TEXT NOT NULL,
      block_name     TEXT NOT NULL,
      rate           REAL NOT NULL,
      created_at     TIMESTAMPTZ DEFAULT now(),
      UNIQUE(entity_id, block_name)
    )
  `)

  // ── Depreciation — "Dep (Comp)" category-level Schedule II schedule ─────────
  // Separate from dep_schedules (the ledger-level "Dep (Old)" module, left
  // untouched) — one row per TB, holding one entry per Asset Category (not
  // per ledger) as JSON: { categoryRows: [...], includeInPPENote, pyTotals }.
  await query(`
    CREATE TABLE IF NOT EXISTS dep_comp_schedules (
      id         SERIAL PRIMARY KEY,
      tb_id      INTEGER NOT NULL REFERENCES trial_balances(id) ON DELETE CASCADE,
      data       TEXT NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(tb_id)
    )
  `)

  // ── Branch support: safe column additions ────────────────────────────────────
  // Which statutory identifier the signatory's number is: DIN, LLPIN or PAN.
  // The column has always held whatever was typed and the exporters assumed DIN,
  // so a partner's PAN printed as "DIN: ...". NULL means "treat as DIN", which
  // keeps every existing company signatory rendering exactly as before.
  await query(`ALTER TABLE signatories ADD COLUMN IF NOT EXISTS id_type TEXT`)
  await query(`ALTER TABLE entities ADD COLUMN IF NOT EXISTS has_branches BOOLEAN NOT NULL DEFAULT FALSE`)
  await query(`ALTER TABLE entities ADD COLUMN IF NOT EXISTS business_type TEXT`)
  await query(`ALTER TABLE trial_balances ADD COLUMN IF NOT EXISTS branch_name TEXT NOT NULL DEFAULT ''`)
  await query(`ALTER TABLE entities ADD COLUMN IF NOT EXISTS address TEXT`)
  await query(`ALTER TABLE entities ADD COLUMN IF NOT EXISTS cin TEXT`)
  // PAN of the auditee - optional, five letters + four digits + one letter (checked on save)
  await query(`ALTER TABLE entities ADD COLUMN IF NOT EXISTS pan TEXT`)
  // Optional details of the global Auditor master (0.1.136): the firm's PAN / address / e-mail and the signing partner's address / e-mail
  await query(`ALTER TABLE auditor_firms ADD COLUMN IF NOT EXISTS pan TEXT`)
  await query(`ALTER TABLE auditor_firms ADD COLUMN IF NOT EXISTS address TEXT`)
  await query(`ALTER TABLE auditor_firms ADD COLUMN IF NOT EXISTS email TEXT`)
  await query(`ALTER TABLE global_signatories ADD COLUMN IF NOT EXISTS address TEXT`)
  await query(`ALTER TABLE global_signatories ADD COLUMN IF NOT EXISTS email TEXT`)
  // Category of the auditor's membership of the Institute: 'Associate' (ACA) or 'Fellow' (FCA) - 0.1.137
  await query(`ALTER TABLE global_signatories ADD COLUMN IF NOT EXISTS membership_category TEXT`)
  await query(`ALTER TABLE auditors ADD COLUMN IF NOT EXISTS membership_category TEXT`)
  await query(`ALTER TABLE auditors ADD COLUMN IF NOT EXISTS pan TEXT`)

  // ── Financial Period master (global, reusable across all Auditees) ──────────
  await query(`
    CREATE TABLE IF NOT EXISTS financial_periods (
      id         SERIAL PRIMARY KEY,
      year_label TEXT NOT NULL,
      date_from  TEXT NOT NULL,
      date_till  TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(date_from, date_till)
    )
  `)

  // ── Entity ↔ Financial Period attachment (this Auditee is being audited for
  // this FY). Locking lives here — per Auditee-per-FY, not per individual TB
  // upload, since an Auditee may re-upload a TB multiple times within one FY.
  await query(`
    CREATE TABLE IF NOT EXISTS entity_periods (
      id                  SERIAL PRIMARY KEY,
      entity_id           INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      financial_period_id INTEGER NOT NULL REFERENCES financial_periods(id),
      locked              BOOLEAN NOT NULL DEFAULT FALSE,
      locked_at           TIMESTAMPTZ,
      created_at          TIMESTAMPTZ DEFAULT now(),
      UNIQUE(entity_id, financial_period_id)
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_entity_periods_entity ON entity_periods(entity_id)`)

  // trial_balances links to the Auditee↔FY it was uploaded against. Nullable
  // for backward compatibility — TBs uploaded before this feature stay
  // unlinked (unlockable) rather than being retroactively guessed at.
  await query(`ALTER TABLE trial_balances ADD COLUMN IF NOT EXISTS entity_period_id INTEGER REFERENCES entity_periods(id)`)

  // Remembers which TB the user picked as "Previous Year" comparative the
  // last time this Auditee↔FY was open, so switching the FY badge away and
  // back restores it instead of forcing a re-pick every time.
  try { await query(`ALTER TABLE entity_periods ADD COLUMN prev_tb_id INTEGER REFERENCES trial_balances(id)`) } catch (_) {}

  // Previous Year figures for this Auditee↔FY. 'required' (the default) is how the app has always worked.
  // A first-year entity - or any year where the comparative is not wanted - sets 'none_show' (the Previous Year
  // column stays, all dashes) or 'none_hide' (the column is left out). Chosen by the CA, never inferred.
  await query(`ALTER TABLE entity_periods ADD COLUMN IF NOT EXISTS py_mode TEXT NOT NULL DEFAULT 'required'`)

  // Final copy: when the CA ticks "Final" while generating the PDF / Excel, the Place and Date of Signing are fixed here and the
  // Financial Year is locked (locked / locked_at above). Unlocking the year in Master clears is_final; the place and date stay as the last values.
  await query(`ALTER TABLE entity_periods ADD COLUMN IF NOT EXISTS is_final BOOLEAN NOT NULL DEFAULT FALSE`)
  await query(`ALTER TABLE entity_periods ADD COLUMN IF NOT EXISTS final_sign_place TEXT`)
  await query(`ALTER TABLE entity_periods ADD COLUMN IF NOT EXISTS final_sign_date TEXT`)
  await query(`ALTER TABLE entity_periods ADD COLUMN IF NOT EXISTS finalised_at TIMESTAMPTZ`)

  // ── Entity-level note details (statutory forms shared across all branches) ───
  await query(`
    CREATE TABLE IF NOT EXISTS entity_note_details (
      id         SERIAL PRIMARY KEY,
      entity_id  INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      note_num   INTEGER NOT NULL,
      note_title TEXT NOT NULL,
      data       TEXT NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(entity_id, note_num)
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_entity_note_details ON entity_note_details(entity_id)`)

  // ── Manual Previous Year entry ───────────────────────────────────────────────
  // manual_py on trial_balances: when set, PY figures for this TB are sourced
  // from manual_py_entries instead of the TB's own opening_balance column. A
  // separately-uploaded PY TB (prevMap) always takes priority over both.
  // Toggled from BS/PL/Notes screens alike — it's one flag per TB, so ticking
  // it in any one screen is automatically reflected in the other two.
  await query(`ALTER TABLE trial_balances ADD COLUMN IF NOT EXISTS manual_py BOOLEAN NOT NULL DEFAULT FALSE`)

  // Aggregate Closing Stock value pulled directly from Tally's Stock Items
  // at import time (see tally-odbc.js getTallyStockTotals). Deliberately
  // NOT a tb_rows ledger line — Closing Stock is never a real TB entry (Tally
  // computes it internally, not via a ledger), so making it one would risk
  // it being picked up by the mapping engine and double-counted into the
  // financial statements. Kept as plain reference data purely for the Stock
  // form's "Total as per Trial Balance" column; nullable, ODBC-import-only.
  await query(`ALTER TABLE trial_balances ADD COLUMN IF NOT EXISTS tally_closing_stock_total REAL`)

  // Aggregate OPENING Stock value, resolved at import time across Tally's P&L /
  // Stock-in-Hand ledger / Inventory Register (see tally-odbc.js
  // resolveStockFigures). Stored as reference data for exactly the same reason
  // the closing figure above is — a Stock value embedded as a real tb_rows
  // ledger line gets picked up by the mapping engine and double-counted.
  //
  // Opening Stock used to be handled the opposite way, embedded as a synthetic
  // ledger row by UploadTB.jsx, and it produced precisely the double-count this
  // comment warns about: on a Tally TB whose opening balances already netted to
  // zero, the injected row unbalanced the TB, saveStockEntries then added its
  // own reconciling row, and the Stock form displayed 2x the real figure.
  await query(`ALTER TABLE trial_balances ADD COLUMN IF NOT EXISTS tally_opening_stock_total REAL`)

  // Which Tally COMPANY this TB was actually exported from, recorded at import.
  // Purely evidential, but it closes a real hole: Tally can hold several
  // companies open at once, and a multi-branch import gave every branch the
  // same stock figures because different requests resolved to different
  // companies. The import now pins one company explicitly — this column lets
  // you SEE which, so "Branch 2's TB says Branch 1 Co" is caught immediately
  // instead of surfacing later as a wrong branch profit.
  await query(`ALTER TABLE trial_balances ADD COLUMN IF NOT EXISTS tally_company TEXT`)

  // pl_closed_to_capital on trial_balances: set when the client has ALREADY
  // passed a real journal entry in Tally closing this year's Profit & Loss
  // into Capital, before this TB was extracted — as opposed to the normal
  // case, where Tally's "Profit & Loss A/c" ledger merely auto-displays the
  // running current-year profit for the TB view, never actually posted
  // anywhere. These two situations are indistinguishable from ledger
  // NAMES alone and depend entirely on the client's own bookkeeping habit,
  // so this is a manual per-TB flag, not something auto-detected. When set:
  // (a) the Tally import no longer drops the "Profit & Loss A/c" ledger
  // (whatever balance remains there, if any, is genuine and should flow
  // through like any other ledger), and (b) useFinancials.js's automatic
  // Net Profit → Reserves & Surplus/Capital injection is skipped, since the
  // profit is already baked into Capital via the real entry — injecting it
  // again would double-count it and throw off the Balance Sheet.
  try { await query(`ALTER TABLE trial_balances ADD COLUMN pl_closed_to_capital INTEGER NOT NULL DEFAULT 0`) } catch (_) {}

  // Per-particular (sub-heading) manual PY entries — entered inline in the
  // Notes screen against each note's own breakdown row (e.g. "Advance Income
  // Tax" under Note 8, "Balances with banks" under Note 10), not at the whole
  // -note level. particular_label='' represents a note with no sub-heading
  // breakdown (the whole note is a single line). is_custom flags a label that
  // didn't already exist as a template/ledger row — a sub-head the CA added
  // purely to record a PY-only figure (see Notes UI's "+ Add Row").
  await query(`
    CREATE TABLE IF NOT EXISTS manual_py_entries (
      id               SERIAL PRIMARY KEY,
      tb_id            INTEGER NOT NULL REFERENCES trial_balances(id) ON DELETE CASCADE,
      note_num         INTEGER NOT NULL,
      particular_label TEXT NOT NULL DEFAULT '',
      py_amount        NUMERIC NOT NULL DEFAULT 0,
      is_custom        BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at       TIMESTAMPTZ DEFAULT now(),
      UNIQUE(tb_id, note_num, particular_label)
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_manual_py_entries_tb ON manual_py_entries(tb_id)`)

  // Manual PY for the Consolidated view of a branch entity — the exact same
  // mechanism as manual_py/manual_py_entries above, but entity-scoped instead
  // of TB-scoped, because the Consolidated view has no Trial Balance row of
  // its own to hang a flag or an entry off (its id is the string
  // '__consolidated__', not a real trial_balances.id). For a CA who only has
  // Previous Year figures already combined across branches — not broken out
  // per branch — this lets them type the consolidated PY directly here
  // instead of splitting it across branches or zeroing every branch but one.
  // Read/written by useConsolidatedFinancials / ManualPYButton / the Notes
  // screen's inline PY cells, the same components that already handle the
  // per-TB case, routed here whenever the active "TB" is the consolidated one.
  await query(`ALTER TABLE entities ADD COLUMN IF NOT EXISTS consolidated_manual_py BOOLEAN NOT NULL DEFAULT FALSE`)
  // consolidated_pl_closed_to_capital: the Consolidated-view mirror of
  // trial_balances.pl_closed_to_capital above. The Consolidated BS/PL has no
  // real trial_balances row of its own (its "tbId" is the virtual string
  // '__consolidated__') — plClosedToCapital:get/set run `WHERE id=$1` against
  // trial_balances.id, an INTEGER column, so passing '__consolidated__' there
  // always fails silently (no .catch on the toggle's own write), which is why
  // the toggle looked flaky and never stuck while in Consolidated mode. Same
  // fix as consolidated_manual_py: an entity-scoped column, routed to by
  // tbId === '__consolidated__' in usePlClosedToCapital.js.
  await query(`ALTER TABLE entities ADD COLUMN IF NOT EXISTS consolidated_pl_closed_to_capital BOOLEAN NOT NULL DEFAULT FALSE`)

  // Basic/Diluted EPS (Company only, Schedule III) — Note formula per the
  // firm's own convention: PAT / Number of Equity Shares Issued and
  // Subscribed (from the Share Capital note's Fill Details), used for BOTH
  // Basic and Diluted (no separate dilution adjustment). Auto-computed on
  // every load from data.netProfit/prevNetProfit and the Share Capital
  // note's saved 'subscribed' share counts — these 4 columns hold a CA
  // OVERRIDE only; NULL means "use the auto-computed figure", a non-NULL
  // value means the CA typed something different and it should always win
  // (see useEps.js / PL/index.jsx's EPS row). Same entity-scoped-mirror
  // need as consolidated_pl_closed_to_capital above, for the same reason
  // (Consolidated view has no real trial_balances row).
  try {
    await query(`ALTER TABLE trial_balances ADD COLUMN eps_basic_cy NUMERIC`)
    await query(`ALTER TABLE trial_balances ADD COLUMN eps_basic_py NUMERIC`)
    await query(`ALTER TABLE trial_balances ADD COLUMN eps_diluted_cy NUMERIC`)
    await query(`ALTER TABLE trial_balances ADD COLUMN eps_diluted_py NUMERIC`)
  } catch (_) {}
  // ── Trial Balance adjustments (Mapped TB: Adjustments (Debit) / (Credit)) ──
  // Typed by the CA after the import. Kept on tb_rows, not mapped_tb, so a re-run
  // of the auto-mapping (which rebuilds mapped_tb) does not lose them.
  //
  // tb_rows.closing_balance is the single source of truth for every statement,
  // note, ratio, EPS and check, so it carries the REVISED balance:
  //     closing_balance = imported_closing_balance + adj_credit - adj_debit
  // (Cr positive / Dr negative). imported_closing_balance is what the upload brought
  // in - NULL until a ledger is first adjusted, when it takes the then-current
  // closing balance. Everything that reads closing_balance therefore sees the
  // revised figure with no change of its own; only the Mapped TB (and the Actual TB)
  // read the imported one, on purpose. The CHECK below refuses any write that
  // breaks the identity, so a future code path cannot quietly drift the two apart.
  await query(`ALTER TABLE tb_rows ADD COLUMN IF NOT EXISTS adj_debit NUMERIC`)
  await query(`ALTER TABLE tb_rows ADD COLUMN IF NOT EXISTS adj_credit NUMERIC`)
  await query(`ALTER TABLE tb_rows ADD COLUMN IF NOT EXISTS imported_closing_balance NUMERIC`)
  // Stock tab (0.1.93): the Other-expenses head that a Stores & Spares / Loose Tools / Others stock row is adjusted in. It lives on the stock
  // ledger row itself, not on mapped_tb (which a re-run of mapping rebuilds), so it survives re-mapping. NULL on every ordinary ledger.
  // Nullable and without a default: PostgreSQL adds it instantly, without touching any existing row.
  await query(`ALTER TABLE tb_rows ADD COLUMN IF NOT EXISTS stock_head TEXT`)
  await query(`
    CREATE TABLE IF NOT EXISTS tb_adjustment_log (
      id             SERIAL PRIMARY KEY,
      tb_id          INTEGER NOT NULL REFERENCES trial_balances(id) ON DELETE CASCADE,
      tb_row_id      INTEGER,
      ledger_name    TEXT,
      ledger_code    TEXT,
      old_adj_debit  NUMERIC,
      old_adj_credit NUMERIC,
      new_adj_debit  NUMERIC,
      new_adj_credit NUMERIC,
      closing_before NUMERIC,
      closing_after  NUMERIC,
      changed_at     TIMESTAMPTZ DEFAULT now()
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_tb_adjustment_log_tb ON tb_adjustment_log(tb_id)`)
  // Adjustments saved by 0.1.89 sat beside an UNTOUCHED closing balance. Fold them
  // in once (idempotent: it only ever matches rows that have not been folded in).
  await query(`
    UPDATE tb_rows
       SET imported_closing_balance = COALESCE(closing_balance, 0),
           closing_balance = COALESCE(closing_balance, 0) + COALESCE(adj_credit, 0) - COALESCE(adj_debit, 0)
     WHERE imported_closing_balance IS NULL AND (adj_debit IS NOT NULL OR adj_credit IS NOT NULL)
  `)
  try {
    const { rows: [hasChk] } = await query(
      `SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
        WHERE c.conname = 'tb_rows_adjusted_closing_chk' AND t.relname = 'tb_rows'`)
    if (!hasChk) {
      await query(`
        ALTER TABLE tb_rows ADD CONSTRAINT tb_rows_adjusted_closing_chk CHECK (
          closing_balance = COALESCE(imported_closing_balance, closing_balance) + COALESCE(adj_credit, 0) - COALESCE(adj_debit, 0))
      `)
    }
  } catch (e) {
    // Never stop the app from starting - the next launch folds in whatever blocked it and adds the check.
    console.error('[schema] tb_rows_adjusted_closing_chk not added:', e.message)
  }
  await query(`ALTER TABLE entities ADD COLUMN IF NOT EXISTS consolidated_eps_basic_cy NUMERIC`)
  await query(`ALTER TABLE entities ADD COLUMN IF NOT EXISTS consolidated_eps_basic_py NUMERIC`)
  await query(`ALTER TABLE entities ADD COLUMN IF NOT EXISTS consolidated_eps_diluted_cy NUMERIC`)
  await query(`ALTER TABLE entities ADD COLUMN IF NOT EXISTS consolidated_eps_diluted_py NUMERIC`)
  // A row the CA rectified directly on THIS Trial Balance (Rectification /
  // Fix / Exceptions all save through mappedTB:override). Another period's
  // categorisation is never copied over it (propagateToOtherTBs, learned-rules
  // apply) — so a Previous Year fix stays put instead of reverting to the
  // Current Year's mapping. Backfilled once, when the column is first added:
  // every user_override row not written by one of the automatic copy paths.
  {
    const { rows: [has] } = await query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'mapped_tb' AND column_name = 'hand_fixed'`)
    if (!has) {
      await query(`ALTER TABLE mapped_tb ADD COLUMN IF NOT EXISTS hand_fixed BOOLEAN NOT NULL DEFAULT FALSE`)
      await query(`UPDATE mapped_tb SET hand_fixed = TRUE
        WHERE status = 'user_override'
          AND COALESCE(override_note, '') NOT IN (
            'Propagated from categorisation made on a later period',
            'Propagated from categorisation made on another period',
            'Carried forward from earlier categorisation',
            'Applied from Learned Ledger Rules')`)
    }
  }
  await query(`
    CREATE TABLE IF NOT EXISTS entity_manual_py_entries (
      id               SERIAL PRIMARY KEY,
      entity_id        INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      note_num         INTEGER NOT NULL,
      particular_label TEXT NOT NULL DEFAULT '',
      py_amount        NUMERIC NOT NULL DEFAULT 0,
      is_custom        BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at       TIMESTAMPTZ DEFAULT now(),
      UNIQUE(entity_id, note_num, particular_label)
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_entity_manual_py_entries_entity ON entity_manual_py_entries(entity_id)`)

  // note_title alongside note_num on both Manual PY tables -- note_num is a
  // raw SEQUENTIAL POSITION recomputed fresh every time notes are built
  // (processRows() only assigns a number to a section once it has iterated
  // that far and the section turns out non-zero in either year), not a
  // stable identity. Entering a manual PY figure for a currently-EMPTY note
  // can itself flip that note from "skipped" to "included", shifting every
  // later note's number -- so an entry saved under note_num=21 can, days or
  // even seconds later, find note_num=21 pointing at a completely different
  // note, and get silently applied there instead. Matching by TITLE (added
  // 0.1.30) is what actually stays stable; note_num is kept only as
  // informational metadata and for the legacy ON CONFLICT target on rows
  // saved before this column existed. See applyManualPyOverrides() in
  // useFinancials.js and manualPyEntries:upsert / entityManualPyEntries:upsert
  // in ipc/masters.js.
  await query(`ALTER TABLE manual_py_entries ADD COLUMN IF NOT EXISTS note_title TEXT NOT NULL DEFAULT ''`)
  await query(`ALTER TABLE entity_manual_py_entries ADD COLUMN IF NOT EXISTS note_title TEXT NOT NULL DEFAULT ''`)

  // ── Standardize Secured/Unsecured/Doubtful template ──────────────────────────
  await query(`
    UPDATE level_format
    SET level5 = 'Secured, considered good / Unsecured, considered good / Doubtful'
    WHERE (
            LOWER(level2) LIKE '%loans and advances%'
         OR LOWER(level2) LIKE '%loan and advances%'
         OR level2 = 'Other non-current Assets'
         OR level2 = 'Trade receivables'
        )
      AND level5 IS NOT NULL
      AND level5 IN (
        'Secured / Unsecured',
        'Secured / Unsecured, considered good / Doubtful',
        'Secured considered good/ Unsecured/Doubtful'
      )
  `)

  // ── Trade Payables/Receivables nature: move Level 5 → Level 3 for non-corp
  // (constitution=1) and LLP (constitution=2), matching Company's
  // (constitution=3) structure exactly. The Notes screen's
  // buildNoteTemplateRows() groups ledgers by Level 3 (mapping3_resultant) to
  // build sub-line breakdowns — for Company, "Due to MSME" / "Due to
  // Creditors other than MSME" (and Trade Receivables' Secured/Unsecured/
  // Doubtful) already lives there and shows up automatically. For non-corp/
  // LLP it lived at Level 5 instead, so the exact same ledgers never
  // surfaced as a Notes sub-line breakdown even though every ledger was
  // still being classified (mapping-engine.js's applyTradeAssumption()
  // already handles both Level 3 and Level 5 generically at mapping time).
  // Runs after the Secured/Unsecured wording-standardization above so the
  // copied text is already canonical. Every rule set (not just the default)
  // is fixed in one pass since this only keys off constitution/level2.
  await query(`
    UPDATE level_format
    SET level3 = level5, level5 = NULL
    WHERE constitution IN (1, 2)
      AND level2 IN ('Trade payables', 'Trade receivables')
      AND level3 IS NULL
      AND level5 IS NOT NULL
  `)

  // Retroactively migrate already-mapped ledgers for entities mapped before
  // this fix: carry the classification value from level5_value over to
  // mapping3_resultant (now the correct field), and re-point level_format_id
  // at the corrected row so sort_order/alie stay right. Only touches rows
  // that haven't already been classified at Level 3.
  await query(`
    UPDATE mapped_tb
    SET mapping3_resultant = level5_value,
        level5_value = NULL,
        level_format_id = COALESCE(
          (SELECT lf.id FROM level_format lf
           WHERE lf.rule_set_id = mapped_tb.rule_set_id
             AND lf.level2 = mapped_tb.mapping2_resultant
             AND lf.level3 = mapped_tb.level5_value
           LIMIT 1),
          level_format_id
        )
    WHERE mapping2_resultant IN ('Trade payables', 'Trade receivables')
      AND level5_value IS NOT NULL
      AND (mapping3_resultant IS NULL OR mapping3_resultant = '')
  `)

  // ── Partners' Remuneration: give it its own terminal Level 1 (not nested
  // under Employee benefits expense / Other expenses) for Partnership
  // (constitution=1) and LLP (constitution=2) ──────────────────────────────
  // Previously: a Map2 rule (constitution=1) nested "Salary to Partner"-style
  // ledgers under Level 1 "Other expenses", and Map3 rules (constitution=1
  // and 2) routed the same keywords to Level 1 "Employee benefits expense" —
  // both wrong; Partners'/LLP members' remuneration is its own P&L face line
  // (see plStructureNonCorp.js's "Partners' remuneration" row), and
  // constitution=2 already had the correct terminal LevelFormat entry.
  // Mapping_v2.xlsx has been corrected the same way (Map1 refinement keyword
  // row added, the two wrong Map2/Map3 rules removed) so the default rule set
  // (id via seedDefaultMapping) gets this from the next reseed — this
  // migration additionally fixes any OTHER already-seeded rule set and any
  // ledger mapped before the fix.
  await query(`
    INSERT INTO level_format (rule_set_id, constitution, alie, level1)
    SELECT DISTINCT lf.rule_set_id, 1, 'Expenses', 'Partners'' Remuneration'
    FROM level_format lf
    WHERE lf.constitution = 1
      AND NOT EXISTS (
        SELECT 1 FROM level_format lf2
        WHERE lf2.rule_set_id = lf.rule_set_id AND lf2.constitution = 1 AND lf2.level1 = 'Partners'' Remuneration'
      )
  `)

  await query(`
    INSERT INTO map1 (rule_set_id, constitution, tally_pre_primary, mapping1_resultant)
    SELECT DISTINCT m.rule_set_id, c.constitution,
      'Rem to Partners | Rem to Partner | Remuneration to Partners | Remuneration to Partner | ' ||
      'Partners Remuneration | Partners'' Remuneration | Partner Remuneration | ' ||
      'Salary to Partner | Salary to Partners | Partners Salary | Partner Salary',
      'Partners'' Remuneration'
    FROM map1 m, (SELECT 1 AS constitution UNION ALL SELECT 2) c
    WHERE m.constitution = c.constitution
      AND NOT EXISTS (
        SELECT 1 FROM map1 m2
        WHERE m2.rule_set_id = m.rule_set_id AND m2.constitution = c.constitution
          AND m2.mapping1_resultant = 'Partners'' Remuneration'
      )
  `)

  // Guard Map2 rule scoped to the new terminal L1, so Stage 2 finds a hit and
  // never falls into the cross-Level-1 discrepancy check — which would
  // otherwise find the generic Employee-benefits "Salary" keyword rule as a
  // competing candidate for a ledger literally named "Salary to Partner" and
  // silently revert it back to Employee benefits expense.
  await query(`
    INSERT INTO map2 (rule_set_id, constitution, keywords, mapping2_resultant, mapping1_resultant, priority)
    SELECT DISTINCT m.rule_set_id, c.constitution,
      'Rem to Partners | Rem to Partner | Remuneration to Partners | Remuneration to Partner | ' ||
      'Partners Remuneration | Partners'' Remuneration | Partner Remuneration | ' ||
      'Salary to Partner | Salary to Partners | Partners Salary | Partner Salary',
      NULL, 'Partners'' Remuneration', 1
    FROM map2 m, (SELECT 1 AS constitution UNION ALL SELECT 2) c
    WHERE m.constitution = c.constitution
      AND NOT EXISTS (
        SELECT 1 FROM map2 m2
        WHERE m2.rule_set_id = m.rule_set_id AND m2.constitution = c.constitution
          AND m2.mapping1_resultant = 'Partners'' Remuneration'
      )
  `)

  // Remove the old, wrong Map2/Map3 rules from every rule set (the ones that
  // sent these same keywords to Other expenses / Employee benefits expense).
  await query(`
    DELETE FROM map2
    WHERE constitution = 1 AND mapping2_resultant = 'Partners'' Remuneration' AND mapping1_resultant = 'Other expenses'
  `)
  await query(`
    DELETE FROM map3
    WHERE constitution IN (1, 2)
      AND mapping1_resultant = 'Employee benefits expense'
      AND mapping3_resultant = 'Partners'' Remuneration'
  `)

  // Retroactively fix ledgers mapped before this fix.
  await query(`
    UPDATE mapped_tb
    SET mapping1_resultant = 'Partners'' Remuneration',
        mapping2_resultant = NULL,
        mapping3_resultant = NULL,
        level_format_id = COALESCE(
          (SELECT lf.id FROM level_format lf
           WHERE lf.rule_set_id = mapped_tb.rule_set_id AND lf.level1 = 'Partners'' Remuneration'
           LIMIT 1),
          level_format_id
        )
    WHERE (mapping1_resultant = 'Employee benefits expense' AND mapping3_resultant = 'Partners'' Remuneration')
       OR (mapping1_resultant = 'Other expenses' AND mapping2_resultant = 'Partners'' Remuneration')
  `)

  // ── Trade Payables/Receivables sign-based reclassification ──────────────
  // See mapping-engine.js's post-pass (applies to every future mapping run,
  // any upload path, any constitution). LevelFormat needs the two new
  // sub-heads first: "Other current assets" currently has NO Level 3
  // breakdown at all in any constitution, so this also gives it one.
  await query(`
    INSERT INTO level_format (rule_set_id, constitution, alie, level1, level2, level3, sort_order)
    SELECT lf.rule_set_id, lf.constitution, 'ASSETS', lf.level1, 'Other current assets', 'Advance to Suppliers', MAX(lf.sort_order)
    FROM level_format lf
    WHERE lf.level2 = 'Other current assets'
      AND NOT EXISTS (
        SELECT 1 FROM level_format lf2
        WHERE lf2.rule_set_id = lf.rule_set_id AND lf2.level2 = 'Other current assets' AND lf2.level3 = 'Advance to Suppliers'
      )
    GROUP BY lf.rule_set_id, lf.constitution, lf.level1
  `)
  await query(`
    INSERT INTO level_format (rule_set_id, constitution, alie, level1, level2, level3, sort_order)
    SELECT lf.rule_set_id, lf.constitution, 'EQUITY AND LIABILITIES', lf.level1, 'Other current liabilities', 'Advance from Customers', MAX(lf.sort_order)
    FROM level_format lf
    WHERE lf.level2 = 'Other current liabilities'
      AND NOT EXISTS (
        SELECT 1 FROM level_format lf2
        WHERE lf2.rule_set_id = lf.rule_set_id AND lf2.level2 = 'Other current liabilities' AND lf2.level3 = 'Advance from Customers'
      )
    GROUP BY lf.rule_set_id, lf.constitution, lf.level1
  `)

  // Retroactively reclassify already-mapped ledgers sitting under Trade
  // Payables/Receivables with the abnormal sign, for entities mapped before
  // this fix. Sign check mirrors displayAmt(): Trade Payables (Cr-natured,
  // ALIE = EQUITY AND LIABILITIES) displays as its own raw closing_balance,
  // so a negative raw balance is the abnormal (debit) case; Trade
  // Receivables (Dr-natured, ALIE = ASSETS) displays as -closing_balance, so
  // a *positive* raw balance is the abnormal (credit) case.
  //
  // This is a one-time historical backfill (hence tryClaimMigration below) —
  // the ongoing version of this same reclassification, for every FRESH
  // mapping run, already lives in mapping-engine.js's runMappingEngine(),
  // which mappedTB:run protects with a snapshot-then-restore around manual
  // overrides. Before this guard, this block ran unconditionally on every
  // app launch (ensureSchema() is called from index.js on every
  // app.whenReady(), and again from settings:save) with no status check at
  // all — so it kept silently re-flipping a credit-balance Trade Receivable
  // (or debit-balance Trade Payable) a CA had deliberately re-categorised,
  // or that an uploaded/applied learned ledger rule had just set (both
  // correctly persist status='user_override') back to Advance from
  // Customers/Suppliers the next time the app happened to restart. The
  // status guard below is kept even now, as defense in depth — this one
  // remaining run must never touch a row already decided on.
  if (await tryClaimMigration('trade_payables_receivables_sign_reclassify_once')) {
    await query(`
      UPDATE mapped_tb
      SET alie = 'ASSETS',
          mapping1_resultant = (SELECT level1 FROM level_format WHERE rule_set_id = mapped_tb.rule_set_id AND level2 = 'Other current assets' AND level3 = 'Advance to Suppliers' LIMIT 1),
          mapping2_resultant = 'Other current assets',
          mapping3_resultant = 'Advance to Suppliers',
          level4_value = NULL, level5_value = NULL, level6_value = NULL, level7_value = NULL,
          level_format_id = (SELECT id FROM level_format WHERE rule_set_id = mapped_tb.rule_set_id AND level2 = 'Other current assets' AND level3 = 'Advance to Suppliers' LIMIT 1),
          override_note = 'Reclassified from Trade Payables (Dr balance — advance to supplier)'
      WHERE alie = 'EQUITY AND LIABILITIES' AND mapping2_resultant = 'Trade payables'
        AND status NOT IN ('user_override', 'user_approved')
        AND EXISTS (SELECT 1 FROM level_format WHERE rule_set_id = mapped_tb.rule_set_id AND level2 = 'Other current assets' AND level3 = 'Advance to Suppliers')
        AND tb_row_id IN (SELECT id FROM tb_rows WHERE closing_balance < 0)
    `)
    await query(`
      UPDATE mapped_tb
      SET alie = 'EQUITY AND LIABILITIES',
          mapping1_resultant = (SELECT level1 FROM level_format WHERE rule_set_id = mapped_tb.rule_set_id AND level2 = 'Other current liabilities' AND level3 = 'Advance from Customers' LIMIT 1),
          mapping2_resultant = 'Other current liabilities',
          mapping3_resultant = 'Advance from Customers',
          level4_value = NULL, level5_value = NULL, level6_value = NULL, level7_value = NULL,
          level_format_id = (SELECT id FROM level_format WHERE rule_set_id = mapped_tb.rule_set_id AND level2 = 'Other current liabilities' AND level3 = 'Advance from Customers' LIMIT 1),
          override_note = 'Reclassified from Trade Receivables (Cr balance — advance from customer)'
      WHERE alie = 'ASSETS' AND mapping2_resultant = 'Trade receivables'
        AND status NOT IN ('user_override', 'user_approved')
        AND EXISTS (SELECT 1 FROM level_format WHERE rule_set_id = mapped_tb.rule_set_id AND level2 = 'Other current liabilities' AND level3 = 'Advance from Customers')
        AND tb_row_id IN (SELECT id FROM tb_rows WHERE closing_balance > 0)
    `)
  }

  // ── Advance to Suppliers now sits under Short-term loans and advances (0.1.102) ──
  // The sub head is added to every rule set / constitution that has Short-term loans and advances ...
  await query(`
    INSERT INTO level_format (rule_set_id, constitution, alie, level1, level2, level3, sort_order)
    SELECT lf.rule_set_id, lf.constitution, 'ASSETS', lf.level1, 'Short-term loans and advances', 'Advance to Suppliers', MAX(lf.sort_order)
    FROM level_format lf
    WHERE lf.level2 = 'Short-term loans and advances'
      AND NOT EXISTS (
        SELECT 1 FROM level_format lf2
        WHERE lf2.rule_set_id = lf.rule_set_id AND lf2.constitution = lf.constitution
          AND lf2.level2 = 'Short-term loans and advances' AND lf2.level3 = 'Advance to Suppliers'
      )
    GROUP BY lf.rule_set_id, lf.constitution, lf.level1
  `)
  // Sub heads added by earlier patches were inserted with sort_order 0, which put their Level 1 ("Current assets" / "Current liabilities")
  // AHEAD of Non-current assets / liabilities in the statutory order the Balance Sheet follows. Put each at its siblings' position.
  // Idempotent: only rows still at 0 whose siblings have a position.
  await query(`
    UPDATE level_format lf
       SET sort_order = s.mx
      FROM (SELECT rule_set_id, constitution, level1, level2, MAX(sort_order) AS mx
              FROM level_format WHERE sort_order > 0 GROUP BY rule_set_id, constitution, level1, level2) s
     WHERE lf.sort_order = 0
       AND lf.level3 IN ('Advance to Suppliers', 'Advance from Customers')
       AND s.rule_set_id = lf.rule_set_id AND s.constitution = lf.constitution AND s.level1 = lf.level1 AND s.level2 = lf.level2
  `)
  // ... and the ledgers the system itself had moved from Trade Payables (a debit balance) are moved with it, once. Not touched: a ledger the
  // CA decided or fixed by hand, and any Financial Year that is locked (a locked year is immutable); mapping the Trial Balance again
  // after unlocking applies the new place.
  if (await tryClaimMigration('advance_to_suppliers_to_short_term_loans_once')) {
    await query(`
      UPDATE mapped_tb m
      SET mapping1_resultant = nf.level1, mapping2_resultant = 'Short-term loans and advances', mapping3_resultant = 'Advance to Suppliers',
          level_format_id = nf.id
      FROM level_format nf
      WHERE nf.rule_set_id = m.rule_set_id AND nf.level2 = 'Short-term loans and advances' AND nf.level3 = 'Advance to Suppliers'
        AND nf.constitution = (SELECT e.constitution FROM trial_balances t JOIN entities e ON e.id = t.entity_id WHERE t.id = m.tb_id)
        AND m.mapping2_resultant = 'Other current assets' AND m.mapping3_resultant = 'Advance to Suppliers'
        AND m.override_note LIKE 'Reclassified from Trade Payables%'
        AND m.status NOT IN ('user_override', 'user_approved')
        AND m.hand_fixed IS NOT TRUE
        AND m.tb_id NOT IN (SELECT t.id FROM trial_balances t JOIN entity_periods ep ON ep.id = t.entity_period_id WHERE ep.locked)
    `)
  }

  // ── Manual custom face lines ──────────────────────────────────────────────
  // A line item on a statement face with no backing TB ledger — e.g. a
  // one-off Tax Expense adjustment for Individual/Proprietorship/Partnership
  // entities. Scoped to a fixed statement "section" key so it can extend to
  // other faces later without a schema change; only "tax-expense-noncorp" is
  // wired up today (see plStructureNonCorp.js's computeNonCorpPLLayout).
  await query(`
    CREATE TABLE IF NOT EXISTS manual_face_lines (
      id         SERIAL PRIMARY KEY,
      tb_id      INTEGER NOT NULL REFERENCES trial_balances(id) ON DELETE CASCADE,
      section    TEXT NOT NULL,
      label      TEXT NOT NULL DEFAULT '',
      cy_amount  NUMERIC NOT NULL DEFAULT 0,
      py_amount  NUMERIC NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_manual_face_lines_tb ON manual_face_lines(tb_id, section)`)

  // ── Learned ledger rules — per-entity, durable, TB-independent ───────────
  // A ledger's finalised classification (status user_approved/user_override),
  // keyed by (entity_id, normalised ledger name) rather than tb_id. Existing
  // carry-forward (applyCarryForward in mapped-tb.js) reads other TBs'
  // mapped_tb rows directly, which are wiped the moment their TB is deleted —
  // "the rules once set even if overridden should prevail" isn't true today.
  // This table is written every time a ledger is approved/overridden
  // (mapped-tb.js's recordLearnedRules), survives TB deletion (no FK to
  // trial_balances at all), and is downloadable/uploadable — an uploaded
  // file only carries ledger-name-based rules, no entity identity, so it can
  // be applied to any entity (a different company, or a fresh duplicate of
  // the same one) exactly like the existing Map1/2/3 rules download/upload.
  await query(`
    CREATE TABLE IF NOT EXISTS learned_ledger_rules (
      id                 SERIAL PRIMARY KEY,
      entity_id          INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      ledger_name_key    TEXT NOT NULL,
      ledger_name        TEXT NOT NULL DEFAULT '',
      mapping1_resultant TEXT,
      mapping2_resultant TEXT,
      mapping3_resultant TEXT,
      level4_value       TEXT,
      level5_value       TEXT,
      level6_value       TEXT,
      level7_value       TEXT,
      alie               TEXT,
      updated_at         TIMESTAMPTZ DEFAULT now(),
      UNIQUE(entity_id, ledger_name_key)
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_learned_ledger_rules_entity ON learned_ledger_rules(entity_id)`)

  // Backfill from finalised mapped_tb rows. It was meant to run once but ran
  // on EVERY launch, rewriting each rule from whichever row was saved last
  // (carry-forward, propagation and bulk approve all touch mapped_at) — a
  // 2024-25 fix or a stale default replaced the rule a CA had just set, and
  // the next re-upload applied it. Now it runs once (0.1.72) and takes each
  // ledger's decision from its LATEST year, as recordLearnedRules does,
  // which also repairs rules an older year's save had overwritten.
  if (await tryClaimMigration('learned_rules_backfill_latest_year_0172')) await query(`
    INSERT INTO learned_ledger_rules
      (entity_id, ledger_name_key, ledger_name, mapping1_resultant, mapping2_resultant, mapping3_resultant,
       level4_value, level5_value, level6_value, level7_value, alie, updated_at)
    SELECT DISTINCT ON (tb.entity_id, LOWER(TRIM(tr.name)))
           tb.entity_id, LOWER(TRIM(tr.name)), tr.name,
           mt.mapping1_resultant, mt.mapping2_resultant, mt.mapping3_resultant,
           mt.level4_value, mt.level5_value, mt.level6_value, mt.level7_value, mt.alie, mt.mapped_at
    FROM mapped_tb mt
    JOIN tb_rows tr ON tr.id = mt.tb_row_id
    JOIN trial_balances tb ON tb.id = mt.tb_id
    LEFT JOIN entity_periods ep ON ep.id = tb.entity_period_id
    LEFT JOIN financial_periods fp ON fp.id = ep.financial_period_id
    WHERE mt.status IN ('user_approved', 'user_override')
      AND TRIM(tr.name) <> ''
    ORDER BY tb.entity_id, LOWER(TRIM(tr.name)), fp.date_from DESC NULLS LAST, mt.mapped_at DESC
    ON CONFLICT(entity_id, ledger_name_key) DO UPDATE SET
      ledger_name = excluded.ledger_name,
      mapping1_resultant = excluded.mapping1_resultant,
      mapping2_resultant = excluded.mapping2_resultant,
      mapping3_resultant = excluded.mapping3_resultant,
      level4_value = excluded.level4_value,
      level5_value = excluded.level5_value,
      level6_value = excluded.level6_value,
      level7_value = excluded.level7_value,
      alie = excluded.alie,
      updated_at = excluded.updated_at
  `)

  // Form 3CD: Details regarding turnover, gross profit, etc.
  await query(`
    CREATE TABLE IF NOT EXISTS form_3cd (
      id                SERIAL PRIMARY KEY,
      entity_id         INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      entity_period_id  INTEGER NOT NULL REFERENCES entity_periods(id) ON DELETE CASCADE,

      -- Current Year (Previous Year in terminology)
      cy_turnover       REAL,
      cy_gross_profit   REAL,
      cy_net_profit     REAL,
      cy_stock_in_trade REAL,
      cy_material_consumed REAL,
      cy_finished_goods REAL,

      -- Previous Year (Preceding Previous Year in terminology)
      py_turnover       REAL,
      py_gross_profit   REAL,
      py_net_profit     REAL,
      py_stock_in_trade REAL,
      py_material_consumed REAL,
      py_finished_goods REAL,

      updated_at        TIMESTAMPTZ DEFAULT now(),
      UNIQUE(entity_id, entity_period_id)
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_form_3cd_entity_period ON form_3cd(entity_id, entity_period_id)`)

  // PPE (Property, Plant & Equipment) - Fixed Assets from Tally
  await query(`
    CREATE TABLE IF NOT EXISTS ppe_ledgers (
      id                  SERIAL PRIMARY KEY,
      entity_id           INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      entity_period_id    INTEGER NOT NULL REFERENCES entity_periods(id) ON DELETE CASCADE,

      ledger_name         TEXT NOT NULL,
      ledger_group        TEXT,
      opening_balance     REAL DEFAULT 0,
      additions_debit     REAL DEFAULT 0,
      credits             REAL DEFAULT 0,
      closing_balance     REAL DEFAULT 0,

      updated_at          TIMESTAMPTZ DEFAULT now(),
      UNIQUE(entity_id, entity_period_id, ledger_name)
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_ppe_ledgers_entity_period ON ppe_ledgers(entity_id, entity_period_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_ppe_ledgers_group ON ppe_ledgers(ledger_group)`)

  // Ratio tab — Gross Profit Trading-Account item selection: which P&L note
  // sub-items the user has ticked as belonging to the GP computation. Keyed
  // by (entity_id, entity_period_id) like form_3cd, not tb_id, so re-
  // uploading a TB within the same period doesn't reset the picks. One JSON
  // blob: { income: [key,...], expense: [key,...] } where
  // key = `${section.level1}|||${line.level2}`. Opening/Closing Stock are
  // NOT stored here — always auto-derived from the same P&L inventory-split
  // lines (see Ratio/Form3CD.jsx), never user-selected.
  await query(`
    CREATE TABLE IF NOT EXISTS ratio_gp_selection (
      id                SERIAL PRIMARY KEY,
      entity_id         INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      entity_period_id  INTEGER NOT NULL REFERENCES entity_periods(id) ON DELETE CASCADE,
      data              JSONB NOT NULL DEFAULT '{}',
      updated_at        TIMESTAMPTZ DEFAULT now(),
      UNIQUE(entity_id, entity_period_id)
    )
  `)
  // Snapshots of the finalised statements for Cloudtail MCA (the DR and MCA forms tool), which reads figures only from here and never
  // recalculates them. FSG Bharat is the only writer; one row per publish, versioned per Financial Year. See ipc/fs-snapshot.js.
  await query(`
    CREATE TABLE IF NOT EXISTS fs_snapshots (
      id                SERIAL PRIMARY KEY,
      entity_id         INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      entity_period_id  INTEGER NOT NULL REFERENCES entity_periods(id) ON DELETE CASCADE,
      version           INTEGER NOT NULL,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      app_version       TEXT,
      created_by        TEXT,
      payload           JSONB NOT NULL,
      UNIQUE(entity_period_id, version)
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_ratio_gp_selection_entity_period ON ratio_gp_selection(entity_id, entity_period_id)`)

  // General Notes — free-form narrative notes (e.g. Corporate Information,
  // Significant Accounting Policies) that form part of the financial
  // statements: each segment carries its own Note Number and rich-text
  // (HTML) body, and is rendered into the PDF/Excel Notes output alongside
  // the auto-numbered BS/PL notes. Segments stored as one ordered JSONB
  // array per (entity, period) — [{ id, noteNum, header, contentHtml }, ...].
  // Keyed like form_3cd/ratio_gp_selection so re-uploading a TB within the
  // same period doesn't reset what's been written.
  await query(`
    CREATE TABLE IF NOT EXISTS general_notes (
      id                SERIAL PRIMARY KEY,
      entity_id         INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      entity_period_id  INTEGER NOT NULL REFERENCES entity_periods(id) ON DELETE CASCADE,
      segments          JSONB NOT NULL DEFAULT '[]',
      updated_at        TIMESTAMPTZ DEFAULT now(),
      UNIQUE(entity_id, entity_period_id)
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_general_notes_entity_period ON general_notes(entity_id, entity_period_id)`)

  // learned_ledger_rules is entity-scoped, not branch/TB-scoped (a rule is
  // meant to carry across every branch of the entity) — but for a branch
  // entity the CA reviewing the downloaded file has no way to tell WHICH
  // branch's TB a given ledger came from. This column is purely informational:
  // it records the branch_name of the trial balance whose decision last wrote
  // or confirmed the rule (see recordLearnedRules in ipc/mapped-tb.js), and is
  // shown as a "Branch" column on download. It plays no part in matching —
  // upload still keys by ledger name only, same as before.
  await query(`ALTER TABLE learned_ledger_rules ADD COLUMN IF NOT EXISTS source_branch_name TEXT`)

  // Deferred Tax (Features > Deferred Tax): the figures typed over, the other timing differences added, the rates. One JSONB document per
  // (entity, period).
  await query(`
    CREATE TABLE IF NOT EXISTS deferred_tax_computations (
      id                SERIAL PRIMARY KEY,
      entity_id         INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      entity_period_id  INTEGER NOT NULL REFERENCES entity_periods(id) ON DELETE CASCADE,
      data              JSONB NOT NULL DEFAULT '{}',
      updated_at        TIMESTAMPTZ DEFAULT now(),
      UNIQUE(entity_id, entity_period_id)
    )
  `)

  // Tax Computation (Features > Tax Computation): the additions / deductions the CA added, the rates, taxes paid and dates typed.
  // One JSONB document per (entity, period).
  await query(`
    CREATE TABLE IF NOT EXISTS tax_computations (
      id                SERIAL PRIMARY KEY,
      entity_id         INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      entity_period_id  INTEGER NOT NULL REFERENCES entity_periods(id) ON DELETE CASCADE,
      data              JSONB NOT NULL DEFAULT '{}',
      updated_at        TIMESTAMPTZ DEFAULT now(),
      UNIQUE(entity_id, entity_period_id)
    )
  `)

  // Cash Flow Statement (CFS tab): what the CA types - the Previous Year column, any Current Year figure replaced by hand, and
  // whether the statement is included in the PDF / Excel. One JSONB document per (entity, period): { cy: {rowId: n}, py: {rowId: n}, include }.
  await query(`
    CREATE TABLE IF NOT EXISTS cash_flow_entries (
      id                SERIAL PRIMARY KEY,
      entity_id         INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      entity_period_id  INTEGER NOT NULL REFERENCES entity_periods(id) ON DELETE CASCADE,
      data              JSONB NOT NULL DEFAULT '{}',
      updated_at        TIMESTAMPTZ DEFAULT now(),
      UNIQUE(entity_id, entity_period_id)
    )
  `)
}
