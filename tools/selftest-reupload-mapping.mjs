/**
 * Pre-release self-test: re-uploading a Trial Balance keeps the CA's
 * categorisation — Secured / Unsecured (Level 4-7) and GST ledgers included —
 * and the entity's Learned Ledger Rules are not overwritten by an older year.
 * Reported in the field (26 Sep 2026): "mapping changes on re-uploading a TB,
 * with the learned rules; Secured / Unsecured ledgers, most of all GST".
 *
 *  1. A 2025-26 loan marked Secured stays Secured when the 2025-26 TB is
 *     uploaded again — even after the 2024-25 TB marks the same ledger
 *     Unsecured (true last year). Learned rules used to take whichever year
 *     was SAVED last, so the re-upload came back Unsecured.
 *  2. Reopening the app does not rewrite the learned rules from whichever
 *     mapped row was touched last (a "one-time" backfill ran every launch).
 *  3. A GST-named ledger the CA deliberately placed elsewhere stays there
 *     after a re-upload (carried rows came back 'user_approved', and GST
 *     netting only respects 'user_override').
 *  4. GST netting gives each ledger the Level 4/5 its new home needs —
 *     Statutory dues payable is split at Level 4 (GST payable ...), Balances
 *     with government authorities at Level 5 (Secured / Unsecured ...) — so
 *     GST ledgers never show as Unclassified when the net flips side.
 *
 * Runs the REAL main-process code (startup sequence with the Mapping_v2.xlsx
 * seed, TB upload, Auto-Mapping, override) on a throw-away PostgreSQL cluster
 * in the temp folder, deleted afterwards — the live database is never touched.
 * GST netting is the renderer's own netGstRows.
 *
 * FSG_SRC_ROOT=<folder holding another src/> runs the same checks against that
 * source to prove they fail there.
 *
 * Run by tools\Release.ps1 before packaging. A failure aborts the release.
 *   node tools/selftest-reupload-mapping.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawnSync } from 'node:child_process'
import { register, createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const srcRoot = process.env.FSG_SRC_ROOT ? path.resolve(process.env.FSG_SRC_ROOT) : root
register(pathToFileURL(path.join(root, 'tools', 'e2e-learned-rules', 'hooks.mjs')).href)
// The main process's `import * as XLSX from 'xlsx'` is bundled by Vite in the
// app; under plain Node that namespace lacks readFile — hand it the CommonJS
// module itself.
const xlsxShim = path.join(os.tmpdir(), `fsg-selftest-xlsx-${process.pid}.mjs`)
fs.writeFileSync(xlsxShim, `import { createRequire } from 'node:module'
const X = createRequire(${JSON.stringify(pathToFileURL(path.join(root, 'package.json')).href)})('xlsx')
export const { read, readFile, utils, write, writeFile } = X
export default X
`)
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier === 'xlsx') return { url: ${JSON.stringify(pathToFileURL(xlsxShim).href)}, shortCircuit: true }
  return next(specifier, context)
}`))
const require = createRequire(import.meta.url)
const esbuild = require(path.join(root, 'node_modules', 'esbuild'))

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
// pg_ctl start: the server inherits stdout/stderr, so a piped spawnSync would wait forever.
const run = (exe, args, quiet = false) => spawnSync(bin(exe), args, quiet ? { stdio: 'ignore', timeout: 60000 } : { encoding: 'utf8', timeout: 120000 })
let started = false
const cleanup = () => {
  if (started) run('pg_ctl.exe', ['-D', dataDir, '-m', 'immediate', '-w', 'stop'], true)
  fs.rmSync(dataDir, { recursive: true, force: true })
}

// The renderer's GST netting, bundled on its own.
async function loadNetGst() {
  const file = path.join(srcRoot, 'src', 'renderer', 'src', 'hooks', 'useFinancials.js')
  const built = await esbuild.build({
    stdin: { contents: `export { netGstRows } from ${JSON.stringify(file)}\n`, resolveDir: srcRoot, loader: 'js' },
    bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
    loader: { '.js': 'jsx', '.jsx': 'jsx' }, nodePaths: [path.join(root, 'node_modules')],
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    plugins: [{ name: 'shims', setup(b) {
      b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'shim' }))
      b.onLoad({ filter: /^react$/, namespace: 'shim' }, () => ({ contents: 'const R={createElement:()=>null};export default R;export const useState=()=>[];export const useEffect=()=>{};export const useRef=()=>({});export const useMemo=(f)=>f();export const useCallback=(f)=>f;', loader: 'js' }))
    } }],
  })
  const tmp = path.join(os.tmpdir(), `fsg-selftest-gst-${process.pid}.mjs`)
  fs.writeFileSync(tmp, built.outputFiles[0].text)
  try { return (await import(pathToFileURL(tmp).href)).netGstRows } finally { fs.rmSync(tmp, { force: true }) }
}

try {
  let r = run('initdb.exe', ['-D', dataDir, '-U', 'selftest', '-A', 'trust', '-E', 'UTF8'])
  if (r.status !== 0) throw new Error('initdb failed: ' + (r.stderr || r.stdout))
  r = run('pg_ctl.exe', ['-D', dataDir, '-o', `-p ${port}`, '-l', path.join(dataDir, 'log.txt'), '-w', 'start'], true)
  if (r.status !== 0) throw new Error('pg_ctl start failed (status ' + r.status + ')')
  started = true

  process.chdir(srcRoot)   // excel.js finds Mapping_v2.xlsx beside the app
  const imp = (rel) => import(pathToFileURL(path.join(srcRoot, 'src', 'main', ...rel.split('/'))).href)
  const { initDB, query } = await imp('db/client.js')
  const { ensureSchema } = await imp('db/schema.js')
  const { seedDefaultMapping, ensureStockCategories } = await imp('services/excel.js')
  const mig = await imp('db/mapping-v3-migration.js')
  const { applyMappingPatches } = await imp('ipc/mapping.js')
  const { registerTBHandlers } = await imp('ipc/tb.js')
  const { registerMappedTBHandlers } = await imp('ipc/mapped-tb.js')
  const netGstRows = await loadNetGst()
  await initDB({ host: 'localhost', port, database: 'postgres', user: 'selftest', password: '' })
  // What every app launch runs (index.js).
  const launch = async () => {
    await ensureSchema(); await seedDefaultMapping(); await ensureStockCategories()
    await mig.migrateMappingV3Captions(); await mig.migrateMappingV3CaptionsPass2(); await applyMappingPatches()
  }
  await launch()
  registerTBHandlers(); registerMappedTBHandlers()
  const ipc = (name, ...args) => globalThis.__ipc[name](null, ...args)
  const one = async (sql, p) => (await query(sql, p)).rows[0]

  const rs = (await one(`SELECT id FROM mapping_rule_sets WHERE is_default LIMIT 1`)).id
  const ent = (await one(`INSERT INTO entities (name, constitution, constitution_display, business_type) VALUES ('ZZ Reupload Co', 3, 'Company', 'Trader') RETURNING id`)).id
  const period = async (label, from, till) => {
    const fp = (await one(`INSERT INTO financial_periods (year_label, date_from, date_till) VALUES ($1,$2,$3) RETURNING id`, [label, from, till])).id
    return (await one(`INSERT INTO entity_periods (entity_id, financial_period_id) VALUES ($1,$2) RETURNING id`, [ent, fp])).id
  }
  const epPY = await period('2024-25', '2024-04-01', '2025-03-31')
  const epCY = await period('2025-26', '2025-04-01', '2026-03-31')

  // Tally-shaped rows (Cr positive, Dr negative).
  const L = (name, parent, gp, closing) => ({
    period: '', branch: '', ledger_code: '', name, opening_balance: 0, debit: 0, credit: 0, closing_balance: closing,
    is_revenue: false, is_deemed_positive: false, trail_balance: closing, parent, group_parent: gp,
    group_parent_1: '', group_parent_2: '', group_parent_3: '', group_parent_4: '', group_parent_5: '', group_parent_6: '', group_parent_7: '',
  })
  const ledgers = (outIgst, inIgst) => [
    L('HDFC Car Loan', 'Secured Loans', 'Loans (Liability)', 400000),
    L('Output IGST', 'Duties & Taxes', 'Current Liabilities', outIgst),
    L('Input IGST', 'Duties & Taxes', 'Current Liabilities', inIgst),
    L('GST Refund Claim', 'Duties & Taxes', 'Current Liabilities', -12000),
    L('Capital', 'Capital Account', 'Capital Account', 100000),
  ]
  const upload = async (ep, rows, file) => {
    const up = await ipc('tb:uploadRealBooks', { entityId: ent, period: ep === epCY ? '2025-26' : '2024-25', fileName: file, tbRows: rows, branchName: '', entityPeriodId: ep })
    await ipc('mappedTB:run', up.tb.id, rs, { excludeZero: true })
    return up.tb.id
  }
  const rowOf = async (tb, name) => one(
    `SELECT mt.*, tr.name AS ledger_name, tr.closing_balance FROM mapped_tb mt JOIN tb_rows tr ON tr.id = mt.tb_row_id WHERE mt.tb_id = $1 AND tr.name = $2`, [tb, name])
  const override = async (tb, name, data) => ipc('mappedTB:override', (await rowOf(tb, name)).id, { mapping3_resultant: null, level4_value: null, level5_value: null, level6_value: null, level7_value: null, ...data })
  const show = (x) => x ? `${x.mapping2_resultant} > ${x.mapping3_resultant} | L4 ${x.level4_value} L5 ${x.level5_value} L6 ${x.level6_value} (${x.status})` : 'missing'

  const LOAN_CY = { mapping1_resultant: 'Non-current liabilities', mapping2_resultant: 'Long-term borrowings', mapping3_resultant: 'Term loans', level5_value: 'from banks', level6_value: 'Secured' }
  const LOAN_PY = { ...LOAN_CY, level6_value: 'Unsecured' }
  const REFUND = { mapping1_resultant: 'Current assets', mapping2_resultant: 'Short-term loans and advances', mapping3_resultant: 'Others', level5_value: 'Unsecured, considered good' }

  // 2025-26 uploaded and rectified; then 2024-25 uploaded and rectified (as the CA now does).
  const cy1 = await upload(epCY, ledgers(50000, -80000), 'cy.xlsx')
  await override(cy1, 'HDFC Car Loan', LOAN_CY)
  await override(cy1, 'GST Refund Claim', REFUND)
  const py = await upload(epPY, ledgers(90000, -30000), 'py.xlsx')
  await override(py, 'HDFC Car Loan', LOAN_PY)

  console.log('\n1. Re-uploading the 2025-26 TB keeps its Secured / Unsecured')
  const cy2 = await upload(epCY, ledgers(50000, -80000), 'cy (1).xlsx')
  const loan2 = await rowOf(cy2, 'HDFC Car Loan')
  ok('HDFC Car Loan is still Term loans / from banks / Secured', loan2?.mapping3_resultant === 'Term loans' && loan2?.level5_value === 'from banks' && loan2?.level6_value === 'Secured', show(loan2))
  const loanPY = await rowOf(py, 'HDFC Car Loan')
  ok('...and the 2024-25 TB keeps its own Unsecured', loanPY?.level6_value === 'Unsecured', show(loanPY))

  console.log('\n2. Reopening the app keeps the learned rules')
  await launch()
  const rule = await one(`SELECT * FROM learned_ledger_rules WHERE entity_id = $1 AND ledger_name_key = 'hdfc car loan'`, [ent])
  ok('the learned rule for HDFC Car Loan is the 2025-26 decision (Secured)', rule?.level6_value === 'Secured', rule ? `L6 ${rule.level6_value}` : 'no rule')
  // A database already polluted before 0.1.72 (an older year's save wrote the
  // rule): the first 0.1.72 launch rebuilds it from the latest year.
  await query(`UPDATE learned_ledger_rules SET level6_value = 'Unsecured' WHERE entity_id = $1 AND ledger_name_key = 'hdfc car loan'`, [ent])
  await query(`DELETE FROM schema_migrations WHERE key LIKE 'learned_rules_backfill%'`).catch(() => {})
  await launch()
  const repaired = await one(`SELECT * FROM learned_ledger_rules WHERE entity_id = $1 AND ledger_name_key = 'hdfc car loan'`, [ent])
  ok('a rule an older year had overwritten is repaired on the first launch (Secured again)', repaired?.level6_value === 'Secured', repaired ? `L6 ${repaired.level6_value}` : 'no rule')
  await launch()
  const again = await one(`SELECT * FROM learned_ledger_rules WHERE entity_id = $1 AND ledger_name_key = 'hdfc car loan'`, [ent])
  ok('...and later launches leave the rules alone', again?.updated_at?.getTime?.() === repaired?.updated_at?.getTime?.(), `${repaired?.updated_at} -> ${again?.updated_at}`)
  await ipc('tb:delete', cy1); await ipc('tb:delete', cy2)
  const cy3 = await upload(epCY, ledgers(50000, -80000), 'cy (2).xlsx')
  const loan3 = await rowOf(cy3, 'HDFC Car Loan')
  ok('the 2025-26 TB deleted and uploaded afresh: still Secured (from the learned rule)', loan3?.level6_value === 'Secured' && loan3?.level5_value === 'from banks', show(loan3))

  console.log('\n3. A GST ledger the CA placed deliberately stays there after a re-upload')
  const refund3 = await rowOf(cy3, 'GST Refund Claim')
  ok('saved: Short-term loans and advances > Others', refund3?.mapping3_resultant === 'Others', show(refund3))
  const asRow = (x) => ({ ...x, name: x.ledger_name, level1: x.mapping1_resultant, level2: x.mapping2_resultant, level3: x.mapping3_resultant })
  const cyRows = await Promise.all(['Output IGST', 'Input IGST', 'GST Refund Claim', 'HDFC Car Loan'].map(n => rowOf(cy3, n).then(asRow)))
  const netted = netGstRows(cyRows).rows
  const nRefund = netted.find(x => x.name === 'GST Refund Claim')
  ok('the statements still show it under Others (not pulled into GST netting)', nRefund?.mapping3_resultant === 'Others' && !nRefund?.gst_netted, show(nRefund))

  console.log('\n4. GST netting gives each ledger the Level 4 / 5 its home needs')
  const hasOpt = (lf, level, v) => !!v && String(lf?.[level] || '').split('/').map(s => s.trim()).includes(v)
  const lfOf = async (l3) => one(`SELECT * FROM level_format WHERE rule_set_id = $1 AND constitution = 3 AND level3 = $2 LIMIT 1`, [rs, l3])
  const nOut = netted.find(x => x.name === 'Output IGST'), nIn = netted.find(x => x.name === 'Input IGST')
  const drLf = await lfOf(nIn?.mapping3_resultant)
  ok('net debit (2025-26): both GST ledgers on Balances with government authorities', /balances with government/i.test(nOut?.mapping3_resultant || '') && /balances with government/i.test(nIn?.mapping3_resultant || ''), `${show(nOut)} ; ${show(nIn)}`)
  ok('...each with a Level 5 that line offers (Secured / Unsecured ...), no stray Level 4',
    hasOpt(drLf, 'level5', nOut?.level5_value) && hasOpt(drLf, 'level5', nIn?.level5_value) && !nOut?.level4_value && !nIn?.level4_value, `${show(nOut)} ; ${show(nIn)}`)
  const pyRows = await Promise.all(['Output IGST', 'Input IGST'].map(n => rowOf(py, n).then(asRow)))
  const pyNet = netGstRows(pyRows).rows
  const pOut = pyNet.find(x => x.name === 'Output IGST'), pIn = pyNet.find(x => x.name === 'Input IGST')
  const crLf = await lfOf('Statutory dues payable')
  ok('net credit (2024-25): both on Statutory dues payable with Level 4 "GST payable", no Secured / Unsecured',
    pOut?.mapping3_resultant === 'Statutory dues payable' && pIn?.mapping3_resultant === 'Statutory dues payable' &&
    hasOpt(crLf, 'level4', pOut?.level4_value) && pOut?.level4_value === 'GST payable' && pIn?.level4_value === 'GST payable' && !pOut?.level5_value && !pIn?.level5_value,
    `${show(pOut)} ; ${show(pIn)}`)
} catch (e) {
  ok('harness ran', false, e.stack || e.message)
} finally {
  process.chdir(root)
  cleanup()
  fs.rmSync(xlsxShim, { force: true })
}
finish()
process.exit(fails ? 1 : 0)
