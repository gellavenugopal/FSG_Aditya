/**
 * Pre-release self-test: a Previous Year ledger the CA rectified must STAY
 * rectified — across an app relaunch, a later save of the same ledger in the
 * Current Year, "Apply learned rules", and a re-run of Auto-Mapping on the PY
 * TB itself. Reported in the field (Company, 0.1.70): PY rectification looked
 * saved, but on reopening the app the default mapping was back — the startup
 * "Patch 7" copied the Current Year's categorisation (often the bulk-approved
 * default) over every earlier period on every launch.
 *
 * Runs the REAL main-process code (db/schema.js ensureSchema, ipc/mapped-tb.js
 * handlers, ipc/mapping.js applyMappingPatches) against a throw-away
 * PostgreSQL cluster created in the temp folder and deleted afterwards — the
 * live database is never touched.
 *
 * FSG_SRC_ROOT=<folder holding another src/> runs the same checks against that
 * source to prove they fail there.
 *
 * Run by tools\Release.ps1 before packaging. A failure aborts the release.
 *   node tools/selftest-py-mapping-persists.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawnSync } from 'node:child_process'
import { register } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const srcRoot = process.env.FSG_SRC_ROOT ? path.resolve(process.env.FSG_SRC_ROOT) : root
// `import ... from 'electron'` -> a plain-Node stand-in (ipcMain.handle records handlers).
register(pathToFileURL(path.join(root, 'tools', 'e2e-learned-rules', 'hooks.mjs')).href)

let fails = 0
const ok = (what, cond, detail = '') => {
  if (!cond) fails++
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond || !detail ? '' : '  -- ' + detail}`)
}
const finish = () => { console.log(fails ? `\n${fails} FAILURE(S) — release aborted\n` : '\nAll checks passed\n') }

// ── Throw-away PostgreSQL ───────────────────────────────────────────────────
const pgRoot = 'C:\\Program Files\\PostgreSQL'
const ver = fs.existsSync(pgRoot) ? fs.readdirSync(pgRoot).filter(d => fs.existsSync(path.join(pgRoot, d, 'bin', 'initdb.exe'))).sort((a, b) => parseFloat(b) - parseFloat(a))[0] : null
if (!ver) { ok('PostgreSQL binaries found (C:\\Program Files\\PostgreSQL\\<ver>\\bin)', false); finish(); process.exit(1) }
const bin = (x) => path.join(pgRoot, ver, 'bin', x)
const port = await new Promise(res => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)) }) })
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fsg-selftest-pg-'))
// pg_ctl start: the server it launches inherits stdout/stderr, so a piped
// spawnSync would wait on it forever — discard its output instead.
const run = (exe, args, quiet = false) => spawnSync(bin(exe), args, quiet ? { stdio: 'ignore', timeout: 60000 } : { encoding: 'utf8', timeout: 120000 })
let started = false
const cleanup = () => {
  if (started) run('pg_ctl.exe', ['-D', dataDir, '-m', 'immediate', '-w', 'stop'], true)
  fs.rmSync(dataDir, { recursive: true, force: true })
}

try {
  let r = run('initdb.exe', ['-D', dataDir, '-U', 'selftest', '-A', 'trust', '-E', 'UTF8'])
  if (r.status !== 0) throw new Error('initdb failed: ' + (r.stderr || r.stdout))
  r = run('pg_ctl.exe', ['-D', dataDir, '-o', `-p ${port}`, '-l', path.join(dataDir, 'log.txt'), '-w', 'start'], true)
  if (r.status !== 0) throw new Error('pg_ctl start failed (status ' + r.status + ')')
  started = true

  const imp = (rel) => import(pathToFileURL(path.join(srcRoot, 'src', 'main', ...rel.split('/'))).href)
  const { initDB, query } = await imp('db/client.js')
  const { ensureSchema } = await imp('db/schema.js')
  const { registerMappedTBHandlers } = await imp('ipc/mapped-tb.js')
  const { applyMappingPatches } = await imp('ipc/mapping.js')
  await initDB({ host: 'localhost', port, database: 'postgres', user: 'selftest', password: '' })
  await ensureSchema()
  registerMappedTBHandlers()
  const ipc = (name, ...args) => globalThis.__ipc[name](null, ...args)

  // One Company, FY 2024-25 (PY) and FY 2025-26 (CY), same ledgers in both.
  const one = async (sql, p) => (await query(sql, p)).rows[0]
  const ent = (await one(`INSERT INTO entities (name, constitution, constitution_display) VALUES ('ZZ Selftest Co', 3, 'Company') RETURNING id`)).id
  const rs = (await one(`INSERT INTO mapping_rule_sets (name, is_default, entity_id) VALUES ('selftest rules', FALSE, $1) RETURNING id`, [ent])).id
  const tbFor = async (label, from, till) => {
    const fp = (await one(`SELECT id FROM financial_periods WHERE date_from=$1 AND date_till=$2`, [from, till]))?.id
      || (await one(`INSERT INTO financial_periods (year_label, date_from, date_till) VALUES ($1,$2,$3) RETURNING id`, [label, from, till])).id
    const ep = (await one(`INSERT INTO entity_periods (entity_id, financial_period_id) VALUES ($1,$2) RETURNING id`, [ent, fp])).id
    return (await one(`INSERT INTO trial_balances (entity_id, period, entity_period_id) VALUES ($1,$2,$3) RETURNING id`, [ent, label, ep])).id
  }
  const PY = await tbFor('2024-25', '2024-04-01', '2025-03-31')
  const CY = await tbFor('2025-26', '2025-04-01', '2026-03-31')
  const ALIE = 'INCOME AND EXPENSES'
  const ledger = async (tb, name, m1, m2, status) => {
    const tr = (await one(`INSERT INTO tb_rows (tb_id, name, closing_balance, opening_balance) VALUES ($1,$2,100,0) RETURNING id`, [tb, name])).id
    return (await one(`INSERT INTO mapped_tb (tb_id, tb_row_id, rule_set_id, alie, mapping1_resultant, mapping2_resultant, status, confidence)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,'high') RETURNING id`, [tb, tr, rs, ALIE, m1, m2, status])).id
  }
  // Both years start on the engine default, bulk-approved in the Current Year.
  const cyTax = await ledger(CY, 'Provision for Tax', 'Other expenses', 'Rates and taxes', 'user_approved')
  const pyTax = await ledger(PY, 'Provision for Tax', 'Other expenses', 'Rates and taxes', 'auto_high')
  const cyAudit = await ledger(CY, 'Audit Fees', 'Other expenses', 'Miscellaneous expenses', 'user_approved')
  const pyAudit = await ledger(PY, 'Audit Fees', 'Other expenses', 'Miscellaneous expenses', 'auto_high')

  const get = async (id) => one(`SELECT mapping1_resultant AS m1, mapping2_resultant AS m2, to_jsonb(mt)->>'hand_fixed' AS hf FROM mapped_tb mt WHERE id = $1`, [id])
  const isFix = (row) => row && row.m1 === 'Tax expense:' && row.m2 === 'Current tax'
  const show = (row) => `${row?.m1} / ${row?.m2}`

  console.log('\nCompany: a Previous Year rectification must persist')
  // The CA rectifies the PY ledger (Rectification / Fix / Exceptions all save this way).
  await ipc('mappedTB:override', pyTax, { mapping1_resultant: 'Tax expense:', mapping2_resultant: 'Current tax', mapping3_resultant: null })
  ok('PY rectification saved', isFix(await get(pyTax)), show(await get(pyTax)))

  await applyMappingPatches()   // what every app launch (on any PC) runs
  ok('...still there after the app is reopened', isFix(await get(pyTax)), show(await get(pyTax)))

  await ipc('mappedTB:override', cyTax, { mapping1_resultant: 'Other expenses', mapping2_resultant: 'Legal and professional charges', mapping3_resultant: null })
  ok('...still there after the same ledger is re-saved in the Current Year', isFix(await get(pyTax)), show(await get(pyTax)))

  await ipc('learnedRules:apply', ent)
  ok('...still there after "Apply learned rules"', isFix(await get(pyTax)), show(await get(pyTax)))

  let reran = true
  try { await ipc('mappedTB:run', PY, rs, {}) } catch (e) { reran = false; ok('Auto-Mapping re-run on the PY TB completes', false, e.message) }
  if (reran) {
    const { rows: [again] } = await query(`SELECT mt.id FROM mapped_tb mt JOIN tb_rows tr ON tr.id = mt.tb_row_id WHERE mt.tb_id = $1 AND tr.name = 'Provision for Tax'`, [PY])
    ok('...still there after Run Auto-Mapping on the PY TB', isFix(await get(again?.id)), show(await get(again?.id)))
    await applyMappingPatches()
    await ipc('mappedTB:override', cyTax, { mapping1_resultant: 'Other expenses', mapping2_resultant: 'Rates and taxes', mapping3_resultant: null })
    ok('...and still protected after that re-run (relaunch + CY re-save)', isFix(await get(again?.id)), show(await get(again?.id)))
  }

  console.log('\nA Current Year fix still reaches a PY ledger the CA did NOT fix there')
  await ipc('mappedTB:override', cyAudit, { mapping1_resultant: 'Other expenses', mapping2_resultant: 'Payments to the auditor', mapping3_resultant: null })
  const { rows: [pa] } = await query(`SELECT mt.mapping2_resultant AS m2 FROM mapped_tb mt JOIN tb_rows tr ON tr.id = mt.tb_row_id WHERE mt.tb_id = $1 AND tr.name = 'Audit Fees'`, [PY])
  ok('PY "Audit Fees" follows the Current Year fix', pa?.m2 === 'Payments to the auditor', String(pa?.m2))
  ok('the CY row itself holds the fix', (await get(cyAudit))?.m2 === 'Payments to the auditor')
  void pyAudit
} catch (e) {
  ok('harness ran', false, e.stack || e.message)
} finally {
  cleanup()
}
finish()
process.exit(fails ? 1 : 0)
