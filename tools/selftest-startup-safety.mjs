// Startup-safety self-test. Runs under Electron (tools/run-electron-selftest.cjs) against DISPOSABLE PostgreSQL only.
// It never connects to the normal database and only reads (never changes) the normal backup and profile files.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import net from 'node:net'
import path from 'node:path'
import { createHash } from 'node:crypto'
import pg from 'pg'
import { spawnSync } from 'node:child_process'
import { initDB, query, getDB } from '../src/main/db/client.js'
import { runLegacyStartupSetup } from '../src/main/db/startup.js'
import { ensureSchema } from '../src/main/db/schema.js'

const { Pool } = pg
const root = process.cwd()
const backupFolder = 'D:\\Programs\\FinancialStatements\\AdityaTool\\FSG-normal-backups'
const normalProfileConfig = path.join(process.env.APPDATA || '', 'fsg-bharat', 'db-config.json')
const pgRoot = 'C:\\Program Files\\PostgreSQL'
const version = fs.readdirSync(pgRoot).filter(v => fs.existsSync(path.join(pgRoot, v, 'bin', 'initdb.exe')))
  .sort((a, b) => parseFloat(b) - parseFloat(a))[0]
const pgBin = path.join(pgRoot, version, 'bin')
let checks = 0
const check = (condition, message) => { assert.ok(condition, message); checks++; console.info(`PASS ${message}`) }
const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const run = (exe, args, options = {}) => spawnSync(exe, args, { encoding: 'utf8', timeout: 180000, ...options })
const freePort = () => new Promise((resolve, reject) => {
  const l = net.createServer()
  l.once('error', reject)
  l.listen(0, '127.0.0.1', () => { const p = l.address().port; l.close(e => e ? reject(e) : resolve(p)) })
})

const newestBackup = fs.readdirSync(backupFolder).filter(f => /^vera_financial-.*\.dump$/.test(f))
  .map(f => path.join(backupFolder, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]
const fingerprint = file => { const s = fs.statSync(file); return `${sha256(file)}:${s.size}:${s.mtimeMs}` }
const backupBefore = fingerprint(newestBackup)
const profileBefore = fs.existsSync(normalProfileConfig) ? fingerprint(normalProfileConfig) : 'absent'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fsg-startup-safety-'))
const dataDirectory = path.join(tempRoot, 'pg')
const port = await freePort()
let clusterStarted = false
let admin = null

try {
  // ---- Normal launcher: missing / stale / corrupt / inherited-variable rejection (read-only) ----
  const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(FSG_TEST_|FSG_DEMO_|ENGAGEMENT_SERVICE_|FSG_STARTUP_)/.test(k)))
  const launcher = (dir, env = cleanEnv) => run('powershell', ['-NoProfile', '-File', path.join(root, 'tools', 'engagement-normal.ps1'), '-CheckOnly', '-BackupFolder', dir], { env })
  const caseDir = name => { const d = path.join(tempRoot, name); fs.mkdirSync(d); return d }
  const output = r => `${r.stdout}\n${r.stderr}`

  let r = launcher(caseDir('empty'))
  check(r.status !== 0 && /No normal-database backup was found/.test(output(r)), 'launcher rejects a missing backup')
  const zeroDir = caseDir('zero'); fs.writeFileSync(path.join(zeroDir, 'vera_financial-zero.dump'), '')
  r = launcher(zeroDir)
  check(r.status !== 0 && /No normal-database backup was found/.test(output(r)), 'launcher rejects an empty backup file')
  const staleDir = caseDir('stale'); const stale = path.join(staleDir, 'vera_financial-stale.dump')
  fs.copyFileSync(newestBackup, stale); const old = new Date(Date.now() - 72 * 3600 * 1000); fs.utimesSync(stale, old, old)
  r = launcher(staleDir)
  check(r.status !== 0 && /older than 24 hours/.test(output(r)), 'launcher rejects a stale backup (copy aged 72 h)')
  const badDir = caseDir('corrupt'); fs.writeFileSync(path.join(badDir, 'vera_financial-bad.dump'), Buffer.from('not a dump '.repeat(50)))
  r = launcher(badDir)
  check(r.status !== 0 && /could not be listed by pg_restore/.test(output(r)), 'launcher rejects a corrupt backup')
  r = launcher(caseDir('inherited'), { ...cleanEnv, FSG_TEST_MODE: 'true' })
  check(r.status !== 0 && /Refusing to launch the normal profile/.test(output(r)), 'launcher rejects inherited UAT variables')
  const goodDir = caseDir('good'); fs.copyFileSync(newestBackup, path.join(goodDir, 'vera_financial-good.dump'))
  r = launcher(goodDir)
  check(!/backup|pg_restore/i.test(output(r).replace(/Backup\s+:.*/g, '')) || r.status === 0,
    'a fresh valid backup copy passes the backup checks')
  check(r.status === 0 || /Another FSG window is running/.test(output(r)),
    'with a valid backup the only remaining stop is a running FSG window (expected while a session is open)')

  // ---- Disposable cluster ----
  let x = run(path.join(pgBin, 'initdb.exe'), ['-D', dataDirectory, '-U', 'selftest', '-A', 'trust', '-E', 'UTF8', '-N'])
  assert.equal(x.status, 0, x.stderr)
  x = run(path.join(pgBin, 'pg_ctl.exe'), ['-D', dataDirectory, '-o', `-h 127.0.0.1 -p ${port}`, '-l', path.join(tempRoot, 'pg.log'), '-w', 'start'], { stdio: 'ignore' })
  assert.equal(x.status, 0, 'disposable PostgreSQL failed to start')
  clusterStarted = true
  admin = new Pool({ host: '127.0.0.1', port, database: 'postgres', user: 'selftest' })
  const connect = database => initDB({ host: '127.0.0.1', port, database, user: 'selftest', password: '' })

  // ---- Restore the real backup into a separate disposable database ----
  await admin.query('CREATE DATABASE restore_check')
  x = run(path.join(pgBin, 'pg_restore.exe'), ['--no-owner', '--no-privileges', '--exit-on-error', '-h', '127.0.0.1', '-p', String(port), '-U', 'selftest', '-d', 'restore_check', newestBackup])
  check(x.status === 0, `pg_restore restored ${path.basename(newestBackup)} into a disposable database (exit ${x.status})`)
  await connect('restore_check')
  const count = async t => Number((await query(`SELECT count(*) n FROM ${t}`)).rows[0].n)
  check(await count('firms') === 1 && await count('firm_users') === 1 && await count('engagements') === 1, 'restored copy holds 1 firm, 1 user and 1 engagement')
  check(await count('trial_balances') === 1 && await count('mapped_tb') === 1120, 'restored copy holds 1 trial balance and 1,120 mapped ledgers')
  check((await query(`SELECT 1 FROM firm_users WHERE lower(email)='venu@vnv.ca' AND active`)).rowCount === 1, 'restored copy contains the active administrator account')

  // ---- Rehearsal on the restored copy: rewrites OFF must leave all mapping data byte-identical ----
  const snapshot = async () => {
    const out = {}
    for (const t of ['mapped_tb', 'map1', 'map2', 'map3', 'level_format', 'mapping_rule_sets', 'schema_migrations']) {
      out[t] = (await query(`SELECT count(*) n, coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), '') h FROM ${t} x`)).rows[0]
    }
    return out
  }
  const before = await snapshot()
  process.env.FSG_STARTUP_DATA_REWRITES = 'off'
  await runLegacyStartupSetup()
  await runLegacyStartupSetup()
  const afterOff = await snapshot()
  for (const t of Object.keys(before)) check(before[t].h === afterOff[t].h && before[t].n === afterOff[t].n, `restored copy: ${t} unchanged by two startups with rewrites off`)
  const reviewedHash = async () => (await query(`SELECT md5(string_agg(x::text, '|' ORDER BY id)) h FROM mapped_tb x WHERE status IN ('user_override','user_approved') OR hand_fixed`)).rows[0].h
  const reviewedBefore = await reviewedHash()
  delete process.env.FSG_STARTUP_DATA_REWRITES
  await runLegacyStartupSetup()
  const afterOn = await snapshot()
  check(await reviewedHash() === reviewedBefore, 'restored copy: reviewed and hand-fixed mappings unchanged by a startup with rewrites enabled')
  console.info(`INFO restored copy, rewrites enabled: mapped_tb ${before.mapped_tb.n}->${afterOn.mapped_tb.n} rows, changed=${before.mapped_tb.h !== afterOn.mapped_tb.h}; map2 changed=${before.map2.h !== afterOn.map2.h}; map3 changed=${before.map3.h !== afterOn.map3.h}; markers ${before.schema_migrations.n}->${afterOn.schema_migrations.n}`)
  await getDB().end()

  // ---- Fixture database: reviewed / hand-fixed / unreviewed rows, one-time claims, rollback on failure ----
  await admin.query('CREATE DATABASE fixture_check')
  await connect('fixture_check')
  await runLegacyStartupSetup()
  const keys = ['partners_remuneration_rule_cleanup_once', 'trade_payables_receivables_sign_reclassify_once', 'advance_to_suppliers_to_short_term_loans_once']
  const marker = async k => (await query('SELECT 1 FROM schema_migrations WHERE key=$1', [k])).rowCount === 1
  const rs = (await query('SELECT id FROM mapping_rule_sets WHERE is_default LIMIT 1')).rows[0].id
  const lf = (await query('SELECT id FROM level_format WHERE rule_set_id=$1 AND constitution=1 LIMIT 1', [rs])).rows[0].id
  const l3 = (await query(`SELECT level3 FROM level_format WHERE rule_set_id=$1 AND level2='Trade payables' AND level3 IS NOT NULL LIMIT 1`, [rs])).rows[0]?.level3 || 'Trade payables - others'
  const entity = (await query(`INSERT INTO entities (name, constitution, constitution_display) VALUES ('Synthetic Startup Co', 1, 'Partnership') RETURNING id`)).rows[0].id
  const tb = (await query(`INSERT INTO trial_balances (entity_id, period, filename) VALUES ($1, '2025-26', 'synthetic.xlsx') RETURNING id`, [entity])).rows[0].id
  let seq = 0
  const addRow = async ({ status, handFixed = false, m1, m2, m3 = null, l5 = null, alie }) => {
    const row = (await query(`INSERT INTO tb_rows (tb_id, name, closing_balance) VALUES ($1, $2, 100) RETURNING id`, [tb, `Synthetic ledger ${++seq}`])).rows[0].id
    return (await query(
      `INSERT INTO mapped_tb (tb_id, tb_row_id, rule_set_id, mapping1_resultant, mapping2_resultant, mapping3_resultant, level5_value, level_format_id, alie, status, hand_fixed)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`, [tb, row, rs, m1, m2, m3, l5, lf, alie, status, handFixed])).rows[0].id
  }
  const rowText = async id => (await query('SELECT x::text t FROM mapped_tb x WHERE id=$1', [id])).rows[0].t
  const field = async (id, col) => (await query(`SELECT ${col} v FROM mapped_tb WHERE id=$1`, [id])).rows[0].v
  const PR = "Partners' Remuneration"
  const addFixtures = async () => ({
    reviewed: await addRow({ status: 'user_override', m1: 'Other expenses', m2: PR, alie: 'Expenses' }),
    handFixed: await addRow({ status: 'auto_high', handFixed: true, m1: 'Other expenses', m2: PR, alie: 'Expenses' }),
    unreviewed: await addRow({ status: 'auto_high', m1: 'Other expenses', m2: PR, alie: 'Expenses' }),
    l5Reviewed: await addRow({ status: 'user_approved', m1: 'Current liabilities', m2: 'Trade payables', l5: l3, alie: 'EQUITY AND LIABILITIES' }),
    l5Unreviewed: await addRow({ status: 'auto_high', m1: 'Current liabilities', m2: 'Trade payables', l5: l3, alie: 'EQUITY AND LIABILITIES' }),
  })
  const addRules = async () => {
    await query(`INSERT INTO map2 (rule_set_id, constitution, keywords, mapping2_resultant, mapping1_resultant, priority) VALUES ($1,1,'synthetic stale rule',$2,'Other expenses',1)`, [rs, PR])
    await query(`INSERT INTO map3 (rule_set_id, constitution, keywords, mapping1_resultant, mapping2_resultant, mapping3_resultant, priority) VALUES ($1,1,'synthetic stale rule','Employee benefits expense',NULL,$2,1)`, [rs, PR])
  }
  const staleRules = async () => Number((await query(`SELECT (SELECT count(*) FROM map2 WHERE keywords='synthetic stale rule') + (SELECT count(*) FROM map3 WHERE keywords='synthetic stale rule') n`)).rows[0].n)
  const release = async () => { for (const k of keys) await query('DELETE FROM schema_migrations WHERE key=$1', [k]) }

  // S1: rewrites off
  await release(); const f1 = await addFixtures(); await addRules()
  const s1 = { reviewed: await rowText(f1.reviewed), handFixed: await rowText(f1.handFixed), unreviewed: await rowText(f1.unreviewed), l5r: await rowText(f1.l5Reviewed), l5u: await rowText(f1.l5Unreviewed) }
  process.env.FSG_STARTUP_DATA_REWRITES = 'off'
  await runLegacyStartupSetup()
  check(await rowText(f1.reviewed) === s1.reviewed && await rowText(f1.handFixed) === s1.handFixed, 'off: reviewed and hand-fixed mappings unchanged')
  check(await rowText(f1.unreviewed) === s1.unreviewed && await rowText(f1.l5Unreviewed) === s1.l5u, 'off: unreviewed mappings are not rewritten either')
  check(await staleRules() === 2, 'off: map2/map3 rules are not deleted')
  check(!(await marker(keys[0])) && !(await marker(keys[1])) && !(await marker(keys[2])), 'off: one-time migrations stay unclaimed, so they can run later')

  // S2: rewrites on
  delete process.env.FSG_STARTUP_DATA_REWRITES
  await ensureSchema()
  check(await rowText(f1.reviewed) === s1.reviewed && await rowText(f1.handFixed) === s1.handFixed && await rowText(f1.l5Reviewed) === s1.l5r, 'on: reviewed and hand-fixed mappings unchanged')
  check(await field(f1.unreviewed, 'mapping1_resultant') === PR && await field(f1.unreviewed, 'mapping2_resultant') === null, 'on: the unreviewed Partners\' Remuneration ledger is reclassified once')
  check(await field(f1.l5Unreviewed, 'mapping3_resultant') === l3 && await field(f1.l5Reviewed, 'mapping3_resultant') === null, 'on: level-5 value carried to level 3 only for the unreviewed ledger')
  check(await staleRules() === 0, 'on: the stale Partners\' Remuneration rules are removed')
  check(await marker(keys[0]) && await marker(keys[1]) && await marker(keys[2]), 'on: all three one-time migrations are claimed')

  // S3: claimed migrations do not run again
  const again = await addRow({ status: 'auto_high', m1: 'Other expenses', m2: PR, alie: 'Expenses' }); await addRules()
  const againText = await rowText(again)
  await runLegacyStartupSetup()
  check(await rowText(again) === againText && await staleRules() === 2, 'one-time: a second startup does not repeat the claimed Partners\' Remuneration cleanup')
  await query(`DELETE FROM map2 WHERE keywords='synthetic stale rule'`); await query(`DELETE FROM map3 WHERE keywords='synthetic stale rule'`)

  // S4: a failure after the claim rolls everything back
  await query('DELETE FROM schema_migrations WHERE key=$1', [keys[0]]); await addRules()
  const victim = await addRow({ status: 'auto_high', m1: 'Other expenses', m2: PR, alie: 'Expenses' })
  const victimText = await rowText(victim)
  await query(`CREATE FUNCTION fsg_test_fail() RETURNS trigger AS $$ BEGIN
      IF OLD.mapping2_resultant = 'Partners'' Remuneration' AND NEW.mapping1_resultant IS DISTINCT FROM OLD.mapping1_resultant THEN RAISE EXCEPTION 'injected failure'; END IF;
      RETURN NEW; END $$ LANGUAGE plpgsql`)
  await query('CREATE TRIGGER fsg_test_fail BEFORE UPDATE ON mapped_tb FOR EACH ROW EXECUTE FUNCTION fsg_test_fail()')
  let failed = null
  try { await ensureSchema() } catch (error) { failed = error }
  check(failed && /injected failure/.test(failed.message), 'failure: the injected mid-migration error is reported, not swallowed')
  check(await staleRules() === 2 && await rowText(victim) === victimText && !(await marker(keys[0])), 'failure: rules and ledgers are unchanged and the migration is not marked done (no partial change)')
  await query('DROP TRIGGER fsg_test_fail ON mapped_tb'); await query('DROP FUNCTION fsg_test_fail()')
  await ensureSchema()
  check(await staleRules() === 0 && await field(victim, 'mapping1_resultant') === PR && await marker(keys[0]), 'failure: after the cause is removed the retry applies the migration completely')
  await getDB().end()
} finally {
  try { if (admin) await admin.end() } catch { /* closing */ }
  if (clusterStarted) run(path.join(pgBin, 'pg_ctl.exe'), ['-D', dataDirectory, '-m', 'immediate', '-w', 'stop'], { stdio: 'ignore' })
}

check(fingerprint(newestBackup) === backupBefore, 'the normal backup file (hash, size, time) was not changed')
check((fs.existsSync(normalProfileConfig) ? fingerprint(normalProfileConfig) : 'absent') === profileBefore, 'the normal profile configuration was not changed')
fs.rmSync(tempRoot, { recursive: true, force: true })
check(!fs.existsSync(tempRoot), 'temporary clusters and files were removed')
console.info(`Startup safety self-test passed (${checks} checks).`)
