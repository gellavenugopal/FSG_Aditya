import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import https from 'node:https'
import net from 'node:net'
import * as XLSX from 'xlsx'
import { PDFDocument } from 'pdf-lib'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { startLocalEngagementService } from '../src/server/dev-engagement-service.js'
import { DEFAULT_FINANCIAL_PERIODS, financialPeriodLabel } from '../src/shared/financial-periods.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const require = createRequire(import.meta.url)
const { Pool } = require('pg')
const pgRoot = 'C:\\Program Files\\PostgreSQL'
const versions = fs.existsSync(pgRoot)
  ? fs.readdirSync(pgRoot).filter(version => fs.existsSync(path.join(pgRoot, version, 'bin', 'initdb.exe')))
      .sort((left, right) => parseFloat(right) - parseFloat(left))
  : []
const version = versions[0]
const pgBin = version && path.join(pgRoot, version, 'bin')
if (!pgBin) throw new Error('PostgreSQL initdb.exe was not found under C:\\Program Files\\PostgreSQL.')

const run = (exe, args, timeout = 120000) => {
  const result = spawnSync(exe, args, { encoding: 'utf8', timeout })
  if (result.error || result.status !== 0) {
    throw new Error(`${path.basename(exe)} failed: ${result.error?.message || result.stderr || result.stdout || result.status}`)
  }
  return result.stdout
}
const runQuiet = (exe, args, timeout = 120000) => {
  const result = spawnSync(exe, args, { stdio: 'ignore', timeout })
  if (result.error || result.status !== 0) {
    throw new Error(`${path.basename(exe)} failed: ${result.error?.message || result.status}`)
  }
}
const freePort = async () => new Promise((resolvePort, reject) => {
  const listener = net.createServer()
  listener.once('error', reject)
  listener.listen(0, '127.0.0.1', () => {
    const port = listener.address().port
    listener.close(error => error ? reject(error) : resolvePort(port))
  })
})
const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'fsg-engagement-service-'))
const dataDirectory = path.join(rootDirectory, 'postgres')
const pgPort = await freePort()
let servicePort
let serviceCa = null
let postgresStarted = false
let service = null
let pool = null
let checks = 0

function check(condition, message) {
  checks++
  assert.ok(condition, message)
}

function api(pathname, body = {}, token = null, setupAuthorization = null) {
  const serialized = JSON.stringify(body)
  return new Promise((resolveRequest, reject) => {
    const request = https.request(`https://127.0.0.1:${servicePort}/v1/engagement/${pathname}`, {
      method: 'POST',
      ca: serviceCa,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(serialized),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(setupAuthorization ? { 'x-engagement-setup-token': setupAuthorization } : {}),
      },
      timeout: 10000,
    }, response => {
      let text = ''
      response.setEncoding('utf8')
      response.on('data', chunk => { text += chunk })
      response.on('end', () => {
        try {
          resolveRequest({ status: response.statusCode, body: JSON.parse(text) })
        } catch (error) {
          reject(error)
        }
      })
    })
    request.once('timeout', () => request.destroy(new Error('Test request timed out.')))
    request.once('error', reject)
    request.end(serialized)
  })
}

async function ok(pathname, body = {}, token = null, setupAuthorization = null) {
  const result = await api(pathname, body, token, setupAuthorization)
  assert.ok(result.status >= 200 && result.status < 300, `${pathname}: ${result.status} ${result.body.error || ''}`)
  return result.body
}

async function fails(pathname, body = {}, token = null, pattern = null, setupAuthorization = null) {
  const result = await api(pathname, body, token, setupAuthorization)
  assert.ok(result.status >= 400, `${pathname} unexpectedly returned ${result.status}`)
  if (pattern) assert.match(result.body.error || '', pattern)
  return result
}

async function login(email, password, newPassword = `Changed-${Buffer.from(email).toString('hex').slice(0, 12)}-Pass!`) {
  const result = await ok('auth/login', { email, password })
  if (result.user.mustChangePassword) {
    const denied = await fails('options', {}, result.sessionToken, /temporary password/i)
    check(denied.status === 400, 'temporary password blocks protected operations')
    await ok('auth/change-password', { password: newPassword }, result.sessionToken)
    return { ...result, user: { ...result.user, mustChangePassword: false }, password: newPassword }
  }
  return { ...result, password }
}

function newDraft(entityId, periodStart, periodEnd, additions = {}) {
  return {
    entityId,
    name: `Synthetic audit ${periodStart}`,
    serviceScope: ['statutory_audit'],
    periodStart,
    periodEnd,
    jurisdiction: 'IN',
    framework: 'India legacy Schedule III',
    reportingPackId: 'IN_SCHEDULE_III_LEGACY',
    trialBalanceCurrency: 'INR',
    presentationCurrency: 'INR',
    displayScale: 'units',
    decimalPlaces: 2,
    status: 'draft',
    ...additions,
  }
}

function syntheticTBFile(closingBalance = -80) {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Period', 'Ledger Code', 'Name', 'OpeningBalance', 'Debit', 'Credit', 'ClosingBalance', 'Parent', 'Group.$Parent'],
    ['2025-26', '1001', 'Synthetic Cash', -100, 20, 0, closingBalance, 'Current Assets', 'Current Assets'],
    ['2025-26', '2001', 'Synthetic Expense', -20, 0, 0, -20, 'Expenses', 'Expenses'],
    ['2025-26', '3001', 'Synthetic Capital', 100, 0, 0, 100, 'Equity', 'Equity'],
  ]), 'Trial Balance')
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
}

try {
  run(path.join(pgBin, 'initdb.exe'), ['-D', dataDirectory, '-U', 'selftest', '-A', 'trust', '-E', 'UTF8', '-N'])
  postgresStarted = true
  runQuiet(path.join(pgBin, 'pg_ctl.exe'), [
    '-D', dataDirectory, '-o', `-h 127.0.0.1 -p ${pgPort}`, '-l', path.join(rootDirectory, 'postgres.log'), '-w', 'start',
  ])
  console.info('Disposable PostgreSQL started.')

  pool = new Pool({ host: '127.0.0.1', port: pgPort, database: 'postgres', user: 'selftest' })
  await pool.query(`
    CREATE TABLE entities (
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, constitution INTEGER NOT NULL,
      constitution_display TEXT, business_type TEXT, address TEXT, cin TEXT, pan TEXT,
      jurisdiction TEXT, legal_form TEXT
    );
    CREATE TABLE global_signatories (id SERIAL PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE financial_periods (
      id SERIAL PRIMARY KEY, year_label TEXT NOT NULL, date_from DATE NOT NULL, date_till DATE NOT NULL,
      UNIQUE (date_from, date_till)
    );
    CREATE TABLE mapping_rule_sets (
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, is_default BOOLEAN DEFAULT FALSE,
      entity_id INTEGER REFERENCES entities(id), created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE level_format (
      id SERIAL PRIMARY KEY, rule_set_id INTEGER NOT NULL REFERENCES mapping_rule_sets(id),
      constitution INTEGER NOT NULL, alie TEXT, level1 TEXT, level2 TEXT, level3 TEXT,
      level4 TEXT, level5 TEXT, level6 TEXT, level7 TEXT, sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE map1 (
      id SERIAL PRIMARY KEY, rule_set_id INTEGER NOT NULL REFERENCES mapping_rule_sets(id),
      constitution INTEGER NOT NULL, tally_pre_primary TEXT, mapping1_resultant TEXT
    );
    CREATE TABLE map2 (
      id SERIAL PRIMARY KEY, rule_set_id INTEGER NOT NULL REFERENCES mapping_rule_sets(id),
      constitution INTEGER NOT NULL, keywords TEXT, mapping2_resultant TEXT,
      mapping1_resultant TEXT, priority INTEGER DEFAULT 1, notes TEXT
    );
    CREATE TABLE map3 (
      id SERIAL PRIMARY KEY, rule_set_id INTEGER NOT NULL REFERENCES mapping_rule_sets(id),
      constitution INTEGER NOT NULL, keywords TEXT, mapping1_resultant TEXT,
      mapping2_resultant TEXT, mapping3_resultant TEXT, priority INTEGER DEFAULT 1, notes TEXT
    );
    CREATE TABLE entity_periods (
      id SERIAL PRIMARY KEY, entity_id INTEGER NOT NULL REFERENCES entities(id),
      financial_period_id INTEGER NOT NULL REFERENCES financial_periods(id),
      locked BOOLEAN NOT NULL DEFAULT FALSE, locked_at TIMESTAMPTZ,
      is_final BOOLEAN NOT NULL DEFAULT FALSE, finalised_at TIMESTAMPTZ,
      final_sign_place TEXT, final_sign_date TEXT, UNIQUE (entity_id, financial_period_id)
    );
    CREATE TABLE trial_balances (
      id SERIAL PRIMARY KEY, entity_id INTEGER NOT NULL REFERENCES entities(id),
      entity_period_id INTEGER REFERENCES entity_periods(id), period TEXT NOT NULL,
      filename TEXT NOT NULL, row_count INTEGER NOT NULL, uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      branch_name TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE tb_rows (
      id SERIAL PRIMARY KEY, tb_id INTEGER NOT NULL REFERENCES trial_balances(id),
      ledger_name TEXT, alie TEXT, level1 TEXT, level2 TEXT, level3 TEXT,
      closing_balance NUMERIC NOT NULL, opening_balance NUMERIC NOT NULL,
      period TEXT, branch TEXT, ledger_code TEXT, name TEXT, debit NUMERIC NOT NULL DEFAULT 0,
      credit NUMERIC NOT NULL DEFAULT 0, is_revenue BOOLEAN, is_deemed_positive BOOLEAN,
      trail_balance NUMERIC NOT NULL DEFAULT 0, parent TEXT, group_parent TEXT, group_parent_1 TEXT,
      group_parent_2 TEXT, group_parent_3 TEXT, group_parent_4 TEXT, group_parent_5 TEXT,
      group_parent_6 TEXT, group_parent_7 TEXT, group_parent_8 TEXT, trial_balance_type TEXT,
      upload_nature TEXT, stock_head TEXT
    );
    CREATE TABLE mapped_tb (
      id SERIAL PRIMARY KEY, tb_id INTEGER NOT NULL REFERENCES trial_balances(id),
      tb_row_id INTEGER REFERENCES tb_rows(id), rule_set_id INTEGER REFERENCES mapping_rule_sets(id),
      ledger_name TEXT, mapped_head TEXT, amount NUMERIC
      ,mapping1_resultant TEXT, mapping2_resultant TEXT, mapping3_resultant TEXT,
      level_format_id INTEGER REFERENCES level_format(id), level4_value TEXT, level5_value TEXT,
      level6_value TEXT, level7_value TEXT, alie TEXT, status TEXT DEFAULT 'auto_high',
      confidence TEXT DEFAULT 'high', conflict_candidates TEXT, conflict_stage INTEGER,
      discrepancy_suggestion TEXT, override_note TEXT, mapped_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(tb_id,tb_row_id)
    );
    CREATE TABLE note_details (
      id SERIAL PRIMARY KEY, tb_id INTEGER NOT NULL REFERENCES trial_balances(id),
      note_num INTEGER NOT NULL, note_title TEXT NOT NULL DEFAULT '', data TEXT NOT NULL DEFAULT '{}',
      details JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(tb_id,note_num)
    );
    CREATE TABLE note_disclosures (
      id SERIAL PRIMARY KEY, tb_id INTEGER NOT NULL REFERENCES trial_balances(id),
      note_num INTEGER NOT NULL, note_title TEXT NOT NULL, text TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ DEFAULT now(), UNIQUE(tb_id,note_num)
    );
    CREATE TABLE general_notes (
      id SERIAL PRIMARY KEY, entity_id INTEGER NOT NULL REFERENCES entities(id),
      entity_period_id INTEGER NOT NULL REFERENCES entity_periods(id),
      segments JSONB NOT NULL DEFAULT '[]', updated_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(entity_id,entity_period_id)
    );
    CREATE TABLE auditors (
      id SERIAL PRIMARY KEY, entity_id INTEGER NOT NULL REFERENCES entities(id),
      firm_name TEXT, frn TEXT, name TEXT NOT NULL, designation TEXT, membership_number TEXT NOT NULL,
      pan TEXT, membership_category TEXT, is_active BOOLEAN NOT NULL DEFAULT TRUE
    );
    CREATE TABLE signatories (
      id SERIAL PRIMARY KEY, entity_id INTEGER NOT NULL REFERENCES entities(id),
      name TEXT NOT NULL, designation TEXT NOT NULL, din TEXT, id_type TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE
    );
    INSERT INTO mapping_rule_sets(name,is_default) VALUES ('Synthetic default',TRUE);
    INSERT INTO level_format(rule_set_id,constitution,alie,level1,level2,sort_order)
      VALUES
        (1,3,'ASSETS','Current assets','Cash and cash equivalents',1),
        (1,3,'EQUITY AND LIABILITIES','Equity','Share capital',2),
        (1,3,'Expenses','Expenses','Other expenses',3);
    INSERT INTO map1(rule_set_id,constitution,tally_pre_primary,mapping1_resultant)
      VALUES
        (1,3,'Current Assets','Current assets'),
        (1,3,'Expenses','Expenses'),
        (1,3,'Equity','Equity');
    INSERT INTO map2(rule_set_id,constitution,keywords,mapping1_resultant,mapping2_resultant)
      VALUES
        (1,3,'Cash|Bank','Current assets','Cash and cash equivalents'),
        (1,3,'Synthetic Expense','Expenses','Other expenses'),
        (1,3,'Synthetic Capital','Equity','Share capital');
    INSERT INTO entities(name,constitution,constitution_display,business_type)
      VALUES ('Synthetic legacy client',3,'Company','Trader');
    INSERT INTO trial_balances(entity_id,period,filename,row_count)
      VALUES (1,'2025-26','synthetic.xlsx',1);
    INSERT INTO tb_rows(tb_id,ledger_name,alie,level1,level2,level3,closing_balance,opening_balance)
      VALUES (1,'Synthetic Sales','Income','Revenue from operations','Sale',NULL,125000,100000);
    INSERT INTO mapped_tb(tb_id,ledger_name,mapped_head,amount)
      VALUES (1,'Synthetic Sales','Revenue from operations',125000);
    INSERT INTO note_details(tb_id,note_num,note_title,data,details) VALUES (1,4,'Synthetic note','{"line":"synthetic disclosure"}','{"line":"synthetic disclosure"}');
    INSERT INTO global_signatories(name) VALUES ('Synthetic Auditor');
    INSERT INTO signatories(entity_id,name,designation) VALUES (1,'Synthetic Director','Director');
  `)
  console.info('Synthetic legacy database fixture created.')
  const beforeLegacy = await pool.query(`
    SELECT e.name AS client_name,t.period,t.filename,t.row_count,r.ledger_name,r.alie,r.level1,r.level2,r.level3,
           r.closing_balance::text,r.opening_balance::text,m.mapped_head,m.amount::text AS mapped_amount,
           n.note_num,n.details::text,s.name AS signatory_name,s.designation
    FROM entities e JOIN trial_balances t ON t.entity_id=e.id
    JOIN tb_rows r ON r.tb_id=t.id JOIN mapped_tb m ON m.tb_id=t.id
    JOIN note_details n ON n.tb_id=t.id JOIN signatories s ON s.entity_id=e.id WHERE e.id=1
  `)
  check(beforeLegacy.rowCount === 1, 'representative legacy fixture created')
  const legacyPeriod = await pool.query(
    `INSERT INTO financial_periods(year_label,date_from,date_till)
     VALUES ('Legacy FY label','2026-01-01','2026-12-31') RETURNING id`
  )
  const legacyPeriodId = legacyPeriod.rows[0].id
  const legacyEntityPeriod = await pool.query(
    `INSERT INTO entity_periods(entity_id,financial_period_id) VALUES (1,$1) RETURNING id`,
    [legacyPeriodId]
  )
  const legacyEntityPeriodId = legacyEntityPeriod.rows[0].id

  check(financialPeriodLabel('2026-12-31') === 'Dec2026'
    && financialPeriodLabel('2026-02-29') === null
    && DEFAULT_FINANCIAL_PERIODS.length === 10,
  'period labels use the validated closing month and year, with ten reusable default ranges')
  const expectedPeriodRanges = [
    ['2024-01-01', '2024-12-31'],
    ['2025-01-01', '2025-12-31'],
    ['2026-01-01', '2026-12-31'],
    ['2026-01-01', '2026-03-31'],
    ['2026-04-01', '2026-06-30'],
    ['2026-07-01', '2026-09-30'],
    ['2026-10-01', '2026-12-31'],
    ['2024-04-01', '2025-03-31'],
    ['2025-04-01', '2026-03-31'],
    ['2026-04-01', '2027-03-31'],
  ]
  check(DEFAULT_FINANCIAL_PERIODS.every((period, index) =>
    period.date_from === expectedPeriodRanges[index][0]
    && period.date_till === expectedPeriodRanges[index][1]),
  'default period masters match the requested date ranges in order')

  service = await startLocalEngagementService({
    host: '127.0.0.1', port: pgPort, database: 'postgres', user: 'selftest', password: '',
  })
  const address = new URL(service.clientOptions.serviceUrl)
  servicePort = Number(address.port)
  serviceCa = service.clientOptions.ca
  const boundAddress = service.service.server.address()
  check(address.protocol === 'https:' && address.hostname === '127.0.0.1' && boundAddress.address === '127.0.0.1',
    'local development service uses HTTPS and binds only to loopback')
  check(Buffer.isBuffer(serviceCa) && service.clientOptions.setupToken.length >= 64,
    'local development creates a private setup authorization and trusted local CA')
  console.info('Local HTTPS engagement service started.')
  const periodMasters = await pool.query(`
    SELECT date_from::text,date_till::text,year_label,id
    FROM financial_periods ORDER BY date_from,date_till
  `)
  const seededRanges = periodMasters.rows.map(({ date_from, date_till, year_label }) => ({
    date_from, date_till, year_label,
  }))
  const duplicateLabels = await pool.query(
    `SELECT COUNT(*)::int AS count FROM financial_periods WHERE year_label='Dec2026'`
  )
  const preservedPeriod = await pool.query(`
    SELECT fp.id,fp.year_label,ep.id AS entity_period_id
    FROM financial_periods fp JOIN entity_periods ep ON ep.financial_period_id=fp.id
    WHERE fp.id=$1
  `, [legacyPeriodId])
  const attachedCount = await pool.query(`SELECT COUNT(*)::int AS count FROM entity_periods`)
  check(periodMasters.rowCount === DEFAULT_FINANCIAL_PERIODS.length
    && seededRanges.every(period => DEFAULT_FINANCIAL_PERIODS.some(expected =>
      expected.date_from === period.date_from && expected.date_till === period.date_till && expected.year_label === period.year_label))
    && duplicateLabels.rows[0].count === 2,
  'service startup seeds the exact calendar, quarterly and April-to-March masters including duplicate display labels')
  check(preservedPeriod.rows[0]?.id === legacyPeriodId
    && preservedPeriod.rows[0]?.entity_period_id === legacyEntityPeriodId
    && preservedPeriod.rows[0]?.year_label === 'Dec2026'
    && attachedCount.rows[0].count === 1,
  'existing period IDs and client relationships survive label normalization, and defaults are not attached to clients')
  const status = await ok('auth/status')
  check(status.data.setupRequired && !status.data.user, 'fresh service reports administrator setup required')
  const unauthorizedSetup = await api('auth/setup', {
    email: 'admin@example.test', firmName: 'Synthetic Firm', displayName: 'Synthetic Admin',
    password: 'Synthetic-Admin-Password!',
  }, null, 'incorrect-server-token')
  check(unauthorizedSetup.status === 403, 'remote setup without server setup authorization is rejected')
  const migrationState = await pool.query(`
    SELECT to_regclass('public.firms') IS NOT NULL AS firms,
           to_regclass('public.engagements') IS NOT NULL AS engagements,
           to_regclass('public.engagement_audit_log') IS NOT NULL AS audit_log,
           (SELECT jurisdiction IS NULL FROM entities WHERE id=1) AS legacy_jurisdiction_preserved
  `)
  check(Object.values(migrationState.rows[0]).every(Boolean), 'additive migration creates service tables and preserves existing entity values')
  const afterMigration = await pool.query(`
    SELECT e.name AS client_name,t.period,t.filename,t.row_count,r.ledger_name,r.alie,r.level1,r.level2,r.level3,
           r.closing_balance::text,r.opening_balance::text,m.mapped_head,m.amount::text AS mapped_amount,
           n.note_num,n.details::text,s.name AS signatory_name,s.designation
    FROM entities e JOIN trial_balances t ON t.entity_id=e.id
    JOIN tb_rows r ON r.tb_id=t.id JOIN mapped_tb m ON m.tb_id=t.id
    JOIN note_details n ON n.tb_id=t.id JOIN signatories s ON s.entity_id=e.id WHERE e.id=1
  `)
  assert.deepEqual(afterMigration.rows, beforeLegacy.rows)
  check(true, 'legacy trial balance figures, classifications, comparative balances, note link, and signing selection are unchanged by migration')
  console.info('Additive migration and legacy preservation verified.')

  const setup = await ok('auth/setup', {
    email: 'admin@example.test', firmName: 'Synthetic Firm', displayName: 'Synthetic Admin',
    password: 'Synthetic-Admin-Password!',
  }, null, service.clientOptions.setupToken)
  check(!!setup.user && !!setup.sessionToken, 'server-authorized first administrator setup creates the initial account')
  await ok('auth/logout', {}, setup.sessionToken)
  const adminLogin = await login('admin@example.test', 'Synthetic-Admin-Password!')
  const adminToken = adminLogin.sessionToken
  check(!!adminToken && adminLogin.user.role === 'administrator', 'first administrator can sign in after setup')
  const statusAfterLogin = await ok('auth/status', {}, adminToken)
  check(statusAfterLogin.data.user?.id === adminLogin.user.id, 'status refresh preserves the authenticated user session')
  await fails('auth/setup', {
    email: 'second@example.test', firmName: 'Another Firm', displayName: 'Second Admin',
    password: 'Synthetic-Admin-Password!',
  }, null, /already been completed/i, service.clientOptions.setupToken)

  const createUser = async (email, role) => {
    const jobTitle = role === 'partner' ? 'partner' : 'employee'
    const created = await ok('admin/users/create', { email, displayName: email.split('@')[0], jobTitle }, adminToken)
    check(created.data.user.mustChangePassword && created.data.initialPassword.length >= 12, `${role} user receives a one-time password`)
    check(created.data.user.jobTitle === jobTitle && created.data.user.role === role,
      `${jobTitle} position maps to the expected directory label and permission role`)
    return login(email, created.data.initialPassword)
  }
  const owner = await createUser('owner@example.test', 'staff')
  const reader = await createUser('reader@example.test', 'staff')
  const editor = await createUser('editor@example.test', 'staff')
  const stranger = await createUser('stranger@example.test', 'staff')
  const outsider = await createUser('outsider@example.test', 'staff')
  const partner = await createUser('partner@example.test', 'partner')
  const substitute = await createUser('substitute@example.test', 'partner')
  const ownerToken = owner.sessionToken
  const readerToken = reader.sessionToken
  const editorToken = editor.sessionToken
  const strangerToken = stranger.sessionToken
  const outsiderToken = outsider.sessionToken
  const partnerToken = partner.sessionToken
  const substituteToken = substitute.sessionToken
  await fails('admin/users/create', {
    email: 'forbidden-admin@example.test', displayName: 'Forbidden', jobTitle: 'administrator',
  }, adminToken, /valid team position/i)

  await fails('list', {
    scope: 'all', userId: 1, role: 'administrator',
  }, strangerToken, /partners and administrators/i)

  await fails('create', newDraft(1, '2028-04-01', '2029-03-31', {
    status: 'active',
    ownerUserId: owner.user.id,
    partnerUserId: partner.user.id,
    compatibilityConfirmed: true,
    jurisdiction: 'AE',
    framework: 'IFRS',
    reportingPackId: 'AE_IFRS',
    trialBalanceCurrency: 'AED',
    presentationCurrency: 'AED',
  }), adminToken, /not implemented/i)

  const created = await ok('create', newDraft(1, '2025-04-01', '2026-03-31', {
    ownerUserId: owner.user.id,
    partnerUserId: partner.user.id,
    substituteUserId: substitute.user.id,
    participants: [
      { userId: reader.user.id, accessLevel: 'read' },
      { userId: editor.user.id, accessLevel: 'edit' },
    ],
    userId: stranger.user.id,
    role: 'administrator',
  }), adminToken)
  const engagementId = created.data.id
  const adminMy = await ok('list', { scope: 'my' }, adminToken)
  const adminAll = await ok('list', { scope: 'all' }, adminToken)
  const partnerMy = await ok('list', { scope: 'my' }, partnerToken)
  check(!adminMy.data.some(item => Number(item.id) === engagementId)
    && adminAll.data.some(item => Number(item.id) === engagementId),
  'administrator My Engagements stays scoped while All Engagements has firm-wide visibility')
  check(partnerMy.data.some(item => Number(item.id) === engagementId),
    'assigned partner sees their engagement in My Engagements')
  const ownerView = await ok('overview', { engagementId }, ownerToken)
  check(ownerView.data.unlinkedTrialBalances.length === 1, 'owner sees unlinked legacy work before explicit linking')
  check(ownerView.data.legacyLink.confirmation_status === 'needs_confirmation', 'legacy compatibility requires confirmation')
  check(!ownerView.data.engagement.compatibility_confirmed, 'unconfirmed legacy data cannot be processed')

  const hiddenView = await fails('overview', { engagementId }, strangerToken, /not found|access/i)
  check(hiddenView.status >= 400, 'uninvited firm user cannot read engagement details')
  const hiddenDuplicates = await ok('duplicates', {
    entityId: 1, periodStart: '2025-04-01', periodEnd: '2026-03-31',
  }, strangerToken)
  check(hiddenDuplicates.data.visibleMatches.length === 0 && hiddenDuplicates.data.restrictedMatch, 'duplicate warning reveals only a restricted-match flag')
  check(!JSON.stringify(hiddenDuplicates).includes('Synthetic audit') && !JSON.stringify(hiddenDuplicates).includes('owner@example.test'),
    'restricted duplicate response contains no engagement or owner details')
  const accessRequest = await ok('access-requests', {
    entityId: 1, periodStart: '2025-04-01', periodEnd: '2026-03-31',
  }, strangerToken)
  check(!JSON.stringify(accessRequest).includes(String(engagementId)), 'access request response does not reveal matching engagement identifiers')

  const ownerOptions = await ok('options', {}, ownerToken)
  check(ownerOptions.data.users.every(user => !user.password_hash && !user.password_salt), 'firm user options never expose password hashes or salts')
  check(ownerOptions.data.users.every(user => typeof user.displayName === 'string' && typeof user.jobTitle === 'string'
    && user.display_name === undefined && user.job_title === undefined),
  'firm user options use the desktop public-user field names')
  const readerView = await ok('overview', { engagementId }, readerToken)
  check(readerView.data.engagement.accessLevel === 'read' && !readerView.data.engagement.canEdit, 'reader can view but cannot edit')
  const editorView = await ok('overview', { engagementId }, editorToken)
  check(editorView.data.engagement.canEdit, 'explicit edit membership grants edit access')
  await fails('draft/update', {
    engagementId, name: 'Unauthorized edit', serviceScope: ['statutory_audit'], participants: [],
  }, readerToken, /edit access/i)
  const partnerView = await ok('overview', { engagementId }, partnerToken)
  check(['read', 'view-only'].includes(partnerView.data.engagement.accessLevel)
    && !partnerView.data.engagement.canEdit && partnerView.data.engagement.canFinalise,
  'assigned partner visibility does not grant edit access but preserves finalisation authority')
  await fails('draft/update', { engagementId }, partnerToken, /edit access/i)
  const adminView = await ok('overview', { engagementId }, adminToken)
  check(!adminView.data.engagement.canEdit && !adminView.data.engagement.canFinalise,
    'administrator visibility does not grant editing or finalisation authority')

  const ownerAfterRequest = await ok('overview', { engagementId }, ownerToken)
  const accessRequests = ownerAfterRequest.data.requests
  const requestId = accessRequests.find(request => Number(request.user_id) === stranger.user.id)?.id
  check(!!requestId, 'owner can review a pending access request without exposing it to other users')
  await ok('access-requests/resolve', { engagementId, requestId, decision: 'approved', accessLevel: 'read' }, ownerToken)
  const grantedView = await ok('overview', { engagementId }, strangerToken)
  check(grantedView.data.engagement.accessLevel === 'read', 'owner can grant an existing firm user read access')

  const editDraft = newDraft(1, '2025-04-01', '2026-03-31', {
    engagementId,
    name: 'Synthetic audit updated',
    reference: ownerView.data.engagement.reference,
    ownerUserId: owner.user.id,
    partnerUserId: partner.user.id,
    substituteUserId: substitute.user.id,
    participants: [
      { userId: reader.user.id, accessLevel: 'read' },
      { userId: editor.user.id, accessLevel: 'edit' },
      { userId: stranger.user.id, accessLevel: 'read' },
    ],
    compatibilityConfirmed: false,
  })
  await ok('draft/update', editDraft, editorToken)
  check(true, 'editor can persist a draft update')

  const trialBalanceSnapshot = await pool.query(`
    SELECT tb.id,tb.entity_id,tb.period,tb.filename,tb.row_count,r.ledger_name,r.alie,r.level1,r.level2,r.level3,
           r.closing_balance::text,r.opening_balance::text,m.mapped_head,m.amount::text AS mapped_amount,
           n.note_num,n.details::text,s.name AS signatory_name,s.designation
    FROM trial_balances tb JOIN tb_rows r ON r.tb_id=tb.id
    JOIN mapped_tb m ON m.tb_id=tb.id JOIN note_details n ON n.tb_id=tb.id
    JOIN signatories s ON s.entity_id=tb.entity_id WHERE tb.id=1
  `)
  await ok('legacy/trial-balances/link', {
    engagementId, trialBalanceIds: [1], note: 'Synthetic fixture belongs to this reporting period.',
  }, ownerToken)
  const linkedBalance = await pool.query(`SELECT entity_period_id FROM trial_balances WHERE id=1`)
  check(!!linkedBalance.rows[0].entity_period_id, 'explicit legacy link associates the selected trial balance with its period')
  const afterLink = await pool.query(`
    SELECT tb.id,tb.entity_id,tb.period,tb.filename,tb.row_count,r.ledger_name,r.alie,r.level1,r.level2,r.level3,
           r.closing_balance::text,r.opening_balance::text,m.mapped_head,m.amount::text AS mapped_amount,
           n.note_num,n.details::text,s.name AS signatory_name,s.designation
    FROM trial_balances tb JOIN tb_rows r ON r.tb_id=tb.id
    JOIN mapped_tb m ON m.tb_id=tb.id JOIN note_details n ON n.tb_id=tb.id
    JOIN signatories s ON s.entity_id=tb.entity_id WHERE tb.id=1
  `)
  assert.deepEqual(afterLink.rows, trialBalanceSnapshot.rows)
  check(true, 'legacy trial-balance figures, classifications, comparative balances, note link, and signing selection are unchanged by linking')
  await ok('legacy/confirm', {
    engagementId, note: 'Synthetic legacy reporting parameters checked by the test owner.',
  }, ownerToken)
  await ok('activate', { engagementId }, ownerToken)
  check((await ok('overview', { engagementId }, ownerToken)).data.engagement.status === 'active',
    'confirmed draft transitions to active')
  await fails('activate', { engagementId }, ownerToken, /only a Draft/i)

  const originalFile = syntheticTBFile()
  const originalUpload = {
    engagementId,
    fileName: 'synthetic-protected.xlsx',
    fileContentBase64: originalFile.toString('base64'),
  }
  await fails('trial-balance/import', originalUpload, readerToken, /edit access/i)
  await fails('trial-balance/import', originalUpload, partnerToken, /edit access/i)
  await fails('trial-balance/import', originalUpload, adminToken, /edit access/i)
  await fails('trial-balances', { engagementId }, outsiderToken, /not found|access/i)
  const invalidBefore = await pool.query(`SELECT COUNT(*)::int AS count FROM trial_balances`)
  await fails('trial-balance/import', {
    ...originalUpload, fileName: 'broken.xlsx', fileContentBase64: Buffer.from('not an Excel workbook').toString('base64'),
  }, ownerToken, /Excel workbook/i)
  const invalidAfter = await pool.query(`SELECT COUNT(*)::int AS count FROM trial_balances`)
  check(invalidAfter.rows[0].count === invalidBefore.rows[0].count, 'invalid workbook creates no trial balance records')

  const imported = await ok('trial-balance/import', originalUpload, ownerToken)
  const importedTBId = Number(imported.data.trialBalance.id)
  check(imported.data.rowCount === 3 && imported.data.source.fileName === originalUpload.fileName
    && imported.data.source.sha256.length === 64, 'owner imports validated Excel rows with retained source metadata')
  const listedTBs = await ok('trial-balances', { engagementId }, readerToken)
  check(listedTBs.data.some(tb => Number(tb.id) === importedTBId && tb.source_type === 'service_import'
    && tb.source_filename === originalUpload.fileName), 'reader can inspect only trial balances linked to the engagement')
  const inspectedRows = await ok('trial-balance/rows', {
    engagementId, trialBalanceId: importedTBId, offset: 0, limit: 10,
  }, readerToken)
  check(inspectedRows.data.totalRows === 3 && inspectedRows.data.rows[0].name === 'Synthetic Cash'
    && Number(inspectedRows.data.rows[0].closing_balance) === -80,
  'reader can inspect imported ledger values through the protected paginated API')
  await fails('trial-balance/import', originalUpload, editorToken, /already been imported/i)
  const unrelatedEngagement = await ok('create', newDraft(1, '2024-04-01', '2025-03-31', {
    ownerUserId: owner.user.id,
    partnerUserId: partner.user.id,
  }), adminToken)
  await fails('trial-balance/rows', {
    engagementId: unrelatedEngagement.data.id, trialBalanceId: importedTBId, offset: 0, limit: 10,
  }, ownerToken, /not found in this engagement/i)

  const journalInput = {
    engagementId,
    sourceTrialBalanceId: importedTBId,
    date: '2025-06-10',
    narration: 'Synthetic year-end adjustment',
    entries: [
      { ledgerName: 'Synthetic Expense', side: 'Dr', amount: '15.00' },
      { ledgerName: 'Synthetic Capital', side: 'Cr', amount: '15.00' },
    ],
  }
  await fails('journal/post', journalInput, readerToken, /edit access/i)
  await fails('journal/post', journalInput, partnerToken, /edit access/i)
  await fails('journal/post', journalInput, adminToken, /edit access/i)
  await fails('journal/post', journalInput, outsiderToken, /not found|access/i)
  await fails('journal/post', { ...journalInput, entries: [{ ...journalInput.entries[0], amount: '15.00' }, { ...journalInput.entries[1], amount: '14.99' }] }, ownerToken, /balance exactly/i)
  const postedJournal = await ok('journal/post', journalInput, ownerToken)
  check(postedJournal.data.entryNumber === 1, 'engagement owner can post a balanced journal without approval')
  const journalHistory = await ok('journals', { engagementId }, readerToken)
  check(journalHistory.data.length === 1 && journalHistory.data[0].lines.length === 2,
    'reader can inspect immutable posted journal history')
  const sourceAfterJournal = await pool.query(
    `SELECT COUNT(*)::integer AS count,
            (SELECT closing_balance::text FROM tb_rows WHERE tb_id=$1 ORDER BY id LIMIT 1) AS closing_balance
     FROM tb_rows WHERE tb_id=$1`,
    [importedTBId]
  )
  check(sourceAfterJournal.rows[0].count === 3 && Number(sourceAfterJournal.rows[0].closing_balance) === -80,
    'posting journals leaves the imported Trial Balance rows unchanged')
  const finalSnapshot1 = await ok('final-trial-balance/create', {
    engagementId, sourceTrialBalanceId: importedTBId,
  }, ownerToken)
  check(finalSnapshot1.data.version === 1 && finalSnapshot1.data.mappedRows === 3
    && finalSnapshot1.data.balanceDifference === 0,
  'final TB snapshot applies posted journals, records its balance difference, and reuses India mapping')
  const finalRows1 = await ok('final-trial-balance/rows', {
    engagementId, trialBalanceId: finalSnapshot1.data.trialBalance.id,
  }, readerToken)
  check(finalRows1.data.length === 3
    && finalRows1.data.some(row => row.name === 'Synthetic Expense' && row.mapping1_resultant === 'Expenses')
    && finalRows1.data.some(row => row.name === 'Synthetic Capital' && row.mapping1_resultant === 'Equity'),
  'final TB rows include posted journals and India auto-mapping classifications')
  await fails('final-trial-balance/rows', {
    engagementId: unrelatedEngagement.data.id, trialBalanceId: finalSnapshot1.data.trialBalance.id,
  }, ownerToken, /not found in this engagement/i)

  const secondJournal = await ok('journal/post', {
    ...journalInput,
    date: '2025-06-11',
    narration: 'Synthetic second adjustment',
    entries: [
      { ledgerName: 'Synthetic Expense', side: 'Dr', amount: '5.00' },
      { ledgerName: 'Synthetic Capital', side: 'Cr', amount: '5.00' },
    ],
  }, editorToken)
  check(secondJournal.data.entryNumber === 2, 'engagement editor can post without an approval queue')
  const finalSnapshot2 = await ok('final-trial-balance/create', {
    engagementId, sourceTrialBalanceId: importedTBId,
  }, ownerToken)
  const finalSnapshotList = await ok('final-trial-balances', { engagementId }, readerToken)
  check(finalSnapshot2.data.version === 2 && finalSnapshotList.data.length === 2
    && finalSnapshotList.data[0].journal_watermark > finalSnapshotList.data[1].journal_watermark,
  'each journal cut produces a new immutable final TB version with a journal watermark')

  const reportingData = await ok('reporting/data', {
    engagementId, trialBalanceId: finalSnapshot2.data.trialBalance.id,
  }, readerToken)
  check(reportingData.data.financialRows.length === 3 && reportingData.data.levelFormat.length === 3,
    'reader can view India statement inputs for an authorized final TB')
  await fails('reporting/data', {
    engagementId: unrelatedEngagement.data.id, trialBalanceId: finalSnapshot2.data.trialBalance.id,
  }, ownerToken, /not found in this engagement/i)
  const emptyOpinion = {
    addressee: 'To the Members of Synthetic legacy client',
    opinion: '',
    basisForOpinion: 'Synthetic basis text',
    managementResponsibilities: 'Synthetic management responsibility text',
    auditorResponsibilities: 'Synthetic auditor responsibility text',
    otherMatters: '',
    reportDate: '2026-05-01',
    reportPlace: 'Synthetic City',
    firmName: 'Synthetic Audit LLP',
    firmAddress: '1 Synthetic Street',
    firmRegistrationNumber: 'FRN-0001',
    auditorName: 'Synthetic Auditor',
    auditorMembershipNumber: 'M-1001',
    auditorDesignation: 'Partner',
  }
  await fails('reporting/settings/save', { engagementId, fields: emptyOpinion }, readerToken, /edit access/i)
  await ok('reporting/settings/save', { engagementId, fields: emptyOpinion }, ownerToken)
  const testPdf = await PDFDocument.create()
  testPdf.addPage().drawText('Synthetic combined reporting pack')
  const pdfBase64 = Buffer.from(await testPdf.save()).toString('base64')
  const reportPayload = {
    engagementId,
    trialBalanceId: finalSnapshot2.data.trialBalance.id,
    pdfContentBase64: pdfBase64,
    signingDetails: { approvalDate: '2026-04-30', approvalPlace: 'Approval City', signatoryIds: [1] },
  }
  await fails('reporting/output/save', reportPayload, ownerToken, /auditor-entered opinion/i)
  const completedFields = { ...emptyOpinion, opinion: 'Synthetic auditor-entered opinion text.' }
  await ok('reporting/settings/save', { engagementId, fields: completedFields }, ownerToken)
  const savedOutput = await ok('reporting/output/save', reportPayload, ownerToken)
  check(savedOutput.data.version === 1 && savedOutput.data.template_revision === 2
    && savedOutput.data.financial_data_sha256.length === 64,
  'combined PDF output is versioned with the exact template revision and final-TB data hash')
  const storedOutput = await ok('reporting/output/read', { outputId: savedOutput.data.id }, readerToken)
  const storedPdf = Buffer.from(storedOutput.data.pdfContentBase64, 'base64')
  const parsedPdf = await PDFDocument.load(storedPdf)
  check(parsedPdf.getPageCount() === 1, 'saved report PDF bytes survive a protected read and remain a valid PDF')
  const savedDetails = await pool.query(
    `SELECT audit_report_fields->>'reportDate' AS report_date,
            signing_details->>'approvalDate' AS approval_date,
            signing_details->>'auditReportDate' AS retained_report_date,
            signing_details->>'approvalPlace' AS approval_place
     FROM engagement_report_outputs WHERE id=$1`,
    [savedOutput.data.id]
  )
  check(savedDetails.rows[0].report_date === '2026-05-01'
    && savedDetails.rows[0].approval_date === '2026-04-30'
    && savedDetails.rows[0].retained_report_date === '2026-05-01'
    && savedDetails.rows[0].approval_place === 'Approval City',
  'audit report date/place are separately retained from financial-statement approval date/place')
  await fails('reporting/output/finalise', { outputId: savedOutput.data.id }, ownerToken, /assigned engagement partner/i)
  const finalisedOutput = await ok('reporting/output/finalise', { outputId: savedOutput.data.id }, substituteToken)
  check(!!finalisedOutput.data.finalised_at, 'authorised substitute finalises an immutable report output')
  await fails('reporting/output/finalise', { outputId: savedOutput.data.id }, partnerToken, /already finalised/i)

  const concurrentUploads = [
    { ...originalUpload, fileName: 'concurrent-a.xlsx', fileContentBase64: syntheticTBFile(-81).toString('base64') },
    { ...originalUpload, fileName: 'concurrent-b.xlsx', fileContentBase64: syntheticTBFile(-82).toString('base64') },
  ]
  const concurrentImports = await Promise.all([
    api('trial-balance/import', concurrentUploads[0], ownerToken),
    api('trial-balance/import', concurrentUploads[1], editorToken),
  ])
  check(concurrentImports.every(response => response.status >= 200 && response.status < 300),
    'concurrent different imports both complete without overwriting each other')
  const parallelImports = await pool.query(
    `SELECT i.trial_balance_id,t.filename,r.closing_balance::text
     FROM engagement_trial_balance_imports i
     JOIN trial_balances t ON t.id=i.trial_balance_id
     JOIN tb_rows r ON r.tb_id=t.id
     WHERE i.engagement_id=$1 AND i.source_filename IN ('concurrent-a.xlsx','concurrent-b.xlsx')
       AND r.name='Synthetic Cash'
     ORDER BY i.source_filename`,
    [engagementId]
  )
  check(parallelImports.rowCount === 2
    && parallelImports.rows[0].trial_balance_id !== parallelImports.rows[1].trial_balance_id
    && new Set(parallelImports.rows.map(row => row.closing_balance)).size === 2,
  'concurrent imports persist distinct trial balances and ledger values')

  const duplicateRaceFile = syntheticTBFile(-83).toString('base64')
  const duplicateRace = await Promise.all([
    api('trial-balance/import', { ...originalUpload, fileName: 'race-a.xlsx', fileContentBase64: duplicateRaceFile }, ownerToken),
    api('trial-balance/import', { ...originalUpload, fileName: 'race-b.xlsx', fileContentBase64: duplicateRaceFile }, editorToken),
  ])
  check(duplicateRace.filter(response => response.status >= 200 && response.status < 300).length === 1
    && duplicateRace.filter(response => response.status >= 400).length === 1,
  'concurrent duplicate source uploads create exactly one import and reject the other')

  await pool.query(`UPDATE entity_periods SET locked=TRUE WHERE id=(
    SELECT entity_period_id FROM engagement_reporting_sets WHERE engagement_id=$1 LIMIT 1
  )`, [engagementId])
  await fails('trial-balance/import', {
    ...originalUpload, fileName: 'locked-period.xlsx', fileContentBase64: syntheticTBFile(-84).toString('base64'),
  }, ownerToken, /locked or finalised/i)
  await pool.query(`UPDATE entity_periods SET locked=FALSE WHERE id=(
    SELECT entity_period_id FROM engagement_reporting_sets WHERE engagement_id=$1 LIMIT 1
  )`, [engagementId])

  await pool.query(`
    CREATE FUNCTION reject_trial_balance_import_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.action='trial_balance.imported' THEN RAISE EXCEPTION 'synthetic TB audit failure'; END IF;
      RETURN NEW;
    END
    $$;
    CREATE TRIGGER reject_trial_balance_import_audit
      BEFORE INSERT ON engagement_audit_log FOR EACH ROW EXECUTE FUNCTION reject_trial_balance_import_audit();
  `)
  const beforeTBRollback = await pool.query(`
    SELECT (SELECT COUNT(*)::int FROM trial_balances) AS tb_count,
           (SELECT COUNT(*)::int FROM tb_rows) AS row_count,
           (SELECT COUNT(*)::int FROM engagement_trial_balance_imports) AS import_count,
           (SELECT COUNT(*)::int FROM engagement_audit_log WHERE action='trial_balance.imported') AS audit_count
  `)
  const failedAuditImport = await api('trial-balance/import', {
    ...originalUpload, fileName: 'audit-failure.xlsx', fileContentBase64: syntheticTBFile(-85).toString('base64'),
  }, ownerToken)
  check(failedAuditImport.status >= 500, 'trial-balance audit insertion failure is reported as a server failure')
  const afterTBRollback = await pool.query(`
    SELECT (SELECT COUNT(*)::int FROM trial_balances) AS tb_count,
           (SELECT COUNT(*)::int FROM tb_rows) AS row_count,
           (SELECT COUNT(*)::int FROM engagement_trial_balance_imports) AS import_count,
           (SELECT COUNT(*)::int FROM engagement_audit_log WHERE action='trial_balance.imported') AS audit_count
  `)
  assert.deepEqual(afterTBRollback.rows, beforeTBRollback.rows)
  check(true, 'trial balance, ledger rows, source metadata and audit record roll back atomically')
  await pool.query('DROP TRIGGER reject_trial_balance_import_audit ON engagement_audit_log; DROP FUNCTION reject_trial_balance_import_audit()')

  await fails('finalise', { engagementId, place: 'Test City', date: '2026-03-31' }, adminToken, /assigned engagement partner/i)
  await fails('finalise', { engagementId, place: 'Test City', date: '2026-03-31' }, ownerToken, /assigned engagement partner/i)
  await ok('finalise', { engagementId, place: 'Test City', date: '2026-03-31' }, substituteToken)
  await fails('trial-balance/import', {
    ...originalUpload, fileName: 'finalised.xlsx', fileContentBase64: syntheticTBFile(-86).toString('base64'),
  }, ownerToken, /locked or finalised/i)
  const finalised = await pool.query(`SELECT status FROM engagements WHERE id=$1`, [engagementId])
  check(finalised.rows[0].status === 'finalised', 'authorised substitute finalises the active engagement')
  await ok('reopen', { engagementId }, partnerToken)
  const reopened = await pool.query(`SELECT status FROM engagements WHERE id=$1`, [engagementId])
  check(reopened.rows[0].status === 'active', 'assigned partner reopens the finalised engagement')

  await ok('access/update', { engagementId, userId: editor.user.id, remove: true }, ownerToken)
  await fails('overview', { engagementId }, editorToken, /not found|access/i)
  await fails('trial-balances', { engagementId }, editorToken, /not found|access/i)
  await fails('access/update', { engagementId, userId: stranger.user.id, accessLevel: 'administrator' }, ownerToken, /valid user and access level/i)
  await ok('access/update', { engagementId, userId: stranger.user.id, remove: true }, ownerToken)
  await fails('overview', { engagementId }, strangerToken, /not found|access/i)
  await fails('access/update', { engagementId, userId: adminView.data.engagement.owner_user_id, accessLevel: 'administrator' }, ownerToken)

  await fails('create', newDraft(1, '2025-04-01', '2026-03-31', {
    ownerUserId: owner.user.id, partnerUserId: partner.user.id,
  }), adminToken, /matching engagement/i)
  const separate = await ok('create', newDraft(1, '2025-04-01', '2026-03-31', {
    ownerUserId: owner.user.id, partnerUserId: partner.user.id,
    separateReason: 'Separate synthetic assurance scope.',
  }), adminToken)
  const separateReason = await pool.query(`SELECT separate_reason FROM engagements WHERE id=$1`, [separate.data.id])
  check(separateReason.rows[0].separate_reason === 'Separate synthetic assurance scope.',
    'legitimate duplicate engagement stores its separate reason')

  const concurrentDraft = newDraft(1, '2026-04-01', '2027-03-31', {
    ownerUserId: owner.user.id, partnerUserId: partner.user.id,
  })
  const concurrent = await Promise.all([
    api('create', concurrentDraft, adminToken),
    api('create', concurrentDraft, adminToken),
  ])
  check(concurrent.filter(result => result.status >= 200 && result.status < 300).length === 1,
    'concurrent duplicate requests create exactly one engagement')
  check(concurrent.filter(result => result.status >= 400).length === 1
    && concurrent.some(result => /matching engagement/i.test(result.body.error || '')),
  'the concurrent loser receives the duplicate warning')

  await pool.query(`
    CREATE FUNCTION reject_engagement_created_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.action='engagement.created' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF;
      RETURN NEW;
    END
    $$;
    CREATE TRIGGER reject_engagement_created_audit
      BEFORE INSERT ON engagement_audit_log FOR EACH ROW EXECUTE FUNCTION reject_engagement_created_audit();
  `)
  const beforeRollback = await pool.query(`
    SELECT (SELECT COUNT(*)::int FROM engagement_audit_log WHERE action='engagement.created') AS audit_count,
           (SELECT COUNT(*)::int FROM financial_periods WHERE date_from='2027-04-01') AS period_count
  `)
  const atomicFailure = await api('create', newDraft(1, '2027-04-01', '2028-03-31', {
    name: 'Synthetic rollback engagement',
    ownerUserId: owner.user.id, partnerUserId: partner.user.id,
  }), adminToken)
  check(atomicFailure.status >= 500, 'audit-history failure is returned as a service failure')
  const rolledBack = await pool.query(`
    SELECT (SELECT COUNT(*)::int FROM engagements WHERE name='Synthetic rollback engagement') AS engagement_count,
           (SELECT COUNT(*)::int FROM engagement_audit_log WHERE action='engagement.created') AS audit_count,
           (SELECT COUNT(*)::int FROM financial_periods WHERE date_from='2027-04-01') AS period_count
  `)
  check(rolledBack.rows[0].engagement_count === 0
    && rolledBack.rows[0].audit_count === beforeRollback.rows[0].audit_count
    && rolledBack.rows[0].period_count === beforeRollback.rows[0].period_count,
  'engagement, period, and audit data roll back atomically when audit insertion fails')
  await pool.query('DROP TRIGGER reject_engagement_created_audit ON engagement_audit_log; DROP FUNCTION reject_engagement_created_audit()')

  await pool.query(`UPDATE firm_users SET active=FALSE WHERE id=$1`, [reader.user.id])
  await fails('overview', { engagementId }, readerToken, /disabled/i)

  const oldToken = adminToken
  await pool.query(`ALTER TABLE firm_users DROP COLUMN job_title`)
  await service.close()
  service = null
  service = await startLocalEngagementService({
    host: '127.0.0.1', port: pgPort, database: 'postgres', user: 'selftest', password: '',
  })
  servicePort = Number(new URL(service.clientOptions.serviceUrl).port)
  serviceCa = service.clientOptions.ca
  await fails('list', { scope: 'all' }, oldToken, /sign in/i)
  const loggedBackIn = await login('admin@example.test', 'Synthetic-Admin-Password!')
  const persistent = await ok('list', { scope: 'all' }, loggedBackIn.sessionToken)
  check(persistent.data.some(item => Number(item.id) === engagementId), 'saved engagement survives service restart and schema migration is repeatable')
  const persistedImports = await ok('trial-balances', { engagementId }, loggedBackIn.sessionToken)
  const persistedRows = await ok('trial-balance/rows', {
    engagementId, trialBalanceId: importedTBId, offset: 0, limit: 10,
  }, loggedBackIn.sessionToken)
  check(persistedImports.data.some(tb => Number(tb.id) === importedTBId)
    && persistedRows.data.rows[0]?.name === 'Synthetic Cash',
  'import source metadata and ledger rows survive service restart')
  const migratedPositions = (await pool.query(`SELECT role,job_title FROM firm_users WHERE id=ANY($1::int[])`, [[adminLogin.user.id, partner.user.id, owner.user.id]])).rows
  check(migratedPositions.length === 3
    && migratedPositions.filter(row => row.role === 'partner').every(row => row.job_title === 'partner')
    && migratedPositions.find(row => row.role === 'staff')?.job_title === 'employee',
  'additive team-position migration backfills older partner and staff accounts safely')

  console.log(`Engagement service integration self-test passed (${checks} assertions, PostgreSQL ${version}).`)
} finally {
  if (service) await service.close().catch(() => {})
  if (pool) await pool.end().catch(() => {})
  if (postgresStarted) {
    runQuiet(path.join(pgBin, 'pg_ctl.exe'), ['-D', dataDirectory, '-m', 'immediate', '-w', 'stop'], 30000)
  }
  fs.rmSync(rootDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
}
