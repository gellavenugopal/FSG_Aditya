import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import https from 'node:https'
import net from 'node:net'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { startLocalEngagementService } from '../src/server/dev-engagement-service.js'

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
      constitution_display TEXT, business_type TEXT
    );
    CREATE TABLE global_signatories (id SERIAL PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE financial_periods (
      id SERIAL PRIMARY KEY, year_label TEXT NOT NULL, date_from DATE NOT NULL, date_till DATE NOT NULL,
      UNIQUE (date_from, date_till)
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
      filename TEXT NOT NULL, row_count INTEGER NOT NULL, uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE tb_rows (
      id SERIAL PRIMARY KEY, tb_id INTEGER NOT NULL REFERENCES trial_balances(id),
      ledger_name TEXT NOT NULL, alie TEXT NOT NULL, level1 TEXT, level2 TEXT, level3 TEXT,
      closing_balance NUMERIC NOT NULL, opening_balance NUMERIC NOT NULL
    );
    CREATE TABLE mapped_tb (
      id SERIAL PRIMARY KEY, tb_id INTEGER NOT NULL REFERENCES trial_balances(id),
      ledger_name TEXT NOT NULL, mapped_head TEXT NOT NULL, amount NUMERIC NOT NULL
    );
    CREATE TABLE note_details (
      id SERIAL PRIMARY KEY, tb_id INTEGER NOT NULL REFERENCES trial_balances(id),
      note_num INTEGER NOT NULL, details JSONB NOT NULL
    );
    CREATE TABLE signatories (
      id SERIAL PRIMARY KEY, entity_id INTEGER NOT NULL REFERENCES entities(id),
      name TEXT NOT NULL, designation TEXT NOT NULL
    );
    INSERT INTO entities(name,constitution,constitution_display,business_type)
      VALUES ('Synthetic legacy client',3,'Company','Trader');
    INSERT INTO trial_balances(entity_id,period,filename,row_count)
      VALUES (1,'2025-26','synthetic.xlsx',1);
    INSERT INTO tb_rows(tb_id,ledger_name,alie,level1,level2,level3,closing_balance,opening_balance)
      VALUES (1,'Synthetic Sales','Income','Revenue from operations','Sale',NULL,125000,100000);
    INSERT INTO mapped_tb(tb_id,ledger_name,mapped_head,amount)
      VALUES (1,'Synthetic Sales','Revenue from operations',125000);
    INSERT INTO note_details(tb_id,note_num,details) VALUES (1,4,'{"line":"synthetic disclosure"}');
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
  const partner = await createUser('partner@example.test', 'partner')
  const substitute = await createUser('substitute@example.test', 'partner')
  const ownerToken = owner.sessionToken
  const readerToken = reader.sessionToken
  const editorToken = editor.sessionToken
  const strangerToken = stranger.sessionToken
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

  await fails('finalise', { engagementId, place: 'Test City', date: '2026-03-31' }, adminToken, /assigned engagement partner/i)
  await fails('finalise', { engagementId, place: 'Test City', date: '2026-03-31' }, ownerToken, /assigned engagement partner/i)
  await ok('finalise', { engagementId, place: 'Test City', date: '2026-03-31' }, substituteToken)
  const finalised = await pool.query(`SELECT status FROM engagements WHERE id=$1`, [engagementId])
  check(finalised.rows[0].status === 'finalised', 'authorised substitute finalises the active engagement')
  await ok('reopen', { engagementId }, partnerToken)
  const reopened = await pool.query(`SELECT status FROM engagements WHERE id=$1`, [engagementId])
  check(reopened.rows[0].status === 'active', 'assigned partner reopens the finalised engagement')

  await ok('access/update', { engagementId, userId: editor.user.id, remove: true }, ownerToken)
  await fails('overview', { engagementId }, editorToken, /not found|access/i)
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
