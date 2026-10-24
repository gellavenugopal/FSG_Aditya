/**
 * Pre-release self-test: Trial Balance adjustments (Mapped TB: Adjustments
 * (Debit) / (Credit) -> Revised Clos Bal) reach EVERYTHING that reads the
 * closing balance, and cannot corrupt it.
 *
 * The closing balance (tb_rows.closing_balance) is the single source of truth
 * for the Balance Sheet, P&L, notes, ratios, EPS, annexures, depreciation
 * reconciliations, exception checks and the previous-year comparatives. An
 * adjustment therefore revises THAT figure - in one statement, keeping the
 * imported figure beside it - rather than being added by each consumer.
 *
 *  1. Arithmetic: Revised Dr = Clos Dr + Adj Dr - Adj Cr, Revised Cr = Clos Cr
 *     + Adj Cr - Adj Dr, on whichever side the ledger sits; stored exactly.
 *  2. The statements (the app's real builder, fetchFinancialsData) built from a
 *     Trial Balance with adjustments are IDENTICAL, figure for figure, to those
 *     built from a Trial Balance imported with the revised balances - Balance
 *     Sheet, P&L, every note, previous year, EPS - and differ from the
 *     unadjusted ones by exactly the adjustments.
 *  3. Every other reader sees the revised figure: the consolidated and branch
 *     queries, Dep (Comp) / Dep (IT) ledger lists, Exceptions / Fix lists, Mapped
 *     TB with Remarks, the Exception Report's inputs, and a PY Trial Balance's
 *     own adjustments in the comparatives.
 *  4. The imported figure is still there: Mapped TB rows, Actual TB, Excel.
 *  5. Controls: a locked period refuses; negative / non-numeric / Stock rows
 *     refused; a write that would break the identity is refused by the database;
 *     0.1.89's un-folded adjustments are folded in once; Clear restores the
 *     imported figures; every change is logged; a re-run of the mapping keeps the
 *     adjustments, even on a ledger the adjustment nets to nil.
 *
 * Runs the REAL main-process code and the REAL renderer builder on a throw-away
 * PostgreSQL cluster in the temp folder (deleted afterwards) - the live
 * database is never touched.
 *
 * FSG_SRC_ROOT=<folder holding another src/> runs the same checks against that
 * source to prove they fail there.
 *
 * Run by tools\Release.ps1 before packaging. A failure aborts the release.
 *   node tools/selftest-tb-adjustments.mjs
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
const xlsxShim = path.join(os.tmpdir(), `fsg-selftest-xlsx-adj-${process.pid}.mjs`)
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
const XLSX = require(path.join(root, 'node_modules', 'xlsx'))

let fails = 0
const ok = (what, cond, detail = '') => {
  if (!cond) fails++
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond || !detail ? '' : '  -- ' + detail}`)
}
const finish = () => { console.log(fails ? `\n${fails} FAILURE(S) — release aborted\n` : '\nAll checks passed\n') }
const near = (a, b, tol = 0.005) => Math.abs((Number(a) || 0) - (Number(b) || 0)) <= tol
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100

// ── Throw-away PostgreSQL ───────────────────────────────────────────────────
const pgRoot = 'C:\\Program Files\\PostgreSQL'
const ver = fs.existsSync(pgRoot) ? fs.readdirSync(pgRoot).filter(d => fs.existsSync(path.join(pgRoot, d, 'bin', 'initdb.exe'))).sort((a, b) => parseFloat(b) - parseFloat(a))[0] : null
if (!ver) { ok('PostgreSQL binaries found (C:\\Program Files\\PostgreSQL\\<ver>\\bin)', false); finish(); process.exit(1) }
const bin = (x) => path.join(pgRoot, ver, 'bin', x)
const port = await new Promise(res => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)) }) })
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fsg-selftest-pg-adj-'))
const run = (exe, args, quiet = false) => spawnSync(bin(exe), args, quiet ? { stdio: 'ignore', timeout: 60000 } : { encoding: 'utf8', timeout: 120000 })
let started = false
const cleanup = () => {
  if (started) run('pg_ctl.exe', ['-D', dataDir, '-m', 'immediate', '-w', 'stop'], true)
  fs.rmSync(dataDir, { recursive: true, force: true })
}

// The renderer's own statement builder (what every screen, the PDF and the Excel are made from).
async function loadBuilder() {
  const file = path.join(srcRoot, 'src', 'renderer', 'src', 'hooks', 'useFinancials.js')
  const built = await esbuild.build({
    stdin: { contents: `export { fetchFinancialsData, displayAmt } from ${JSON.stringify(file)}\nexport { computeRatios } from ${JSON.stringify(path.join(srcRoot, 'src', 'renderer', 'src', 'utils', 'ratios.js'))}\n`, resolveDir: srcRoot, loader: 'js' },
    bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
    loader: { '.js': 'jsx', '.jsx': 'jsx' }, nodePaths: [path.join(root, 'node_modules')],
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    plugins: [{ name: 'shims', setup(b) {
      b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'shim' }))
      b.onLoad({ filter: /^react$/, namespace: 'shim' }, () => ({ contents: 'const R={createElement:()=>null};export default R;export const useState=()=>[];export const useEffect=()=>{};export const useRef=()=>({});export const useMemo=(f)=>f();export const useCallback=(f)=>f;', loader: 'js' }))
    } }],
  })
  const tmp = path.join(os.tmpdir(), `fsg-selftest-adj-builder-${process.pid}.mjs`)
  fs.writeFileSync(tmp, built.outputFiles[0].text)
  try { return await import(pathToFileURL(tmp).href) } finally { fs.rmSync(tmp, { force: true }) }
}

try {
  let r = run('initdb.exe', ['-D', dataDir, '-U', 'selftest', '-A', 'trust', '-E', 'UTF8'])
  if (r.status !== 0) throw new Error('initdb failed: ' + (r.stderr || r.stdout))
  r = run('pg_ctl.exe', ['-D', dataDir, '-o', `-p ${port}`, '-l', path.join(dataDir, 'log.txt'), '-w', 'start'], true)
  if (r.status !== 0) throw new Error('pg_ctl start failed (status ' + r.status + ')')
  started = true

  process.chdir(srcRoot)
  const imp = (rel) => import(pathToFileURL(path.join(srcRoot, 'src', 'main', ...rel.split('/'))).href)
  const { initDB, query } = await imp('db/client.js')
  const { ensureSchema } = await imp('db/schema.js')
  const { seedDefaultMapping, ensureStockCategories } = await imp('services/excel.js')
  const mig = await imp('db/mapping-v3-migration.js')
  const { applyMappingPatches, registerMappingHandlers } = await imp('ipc/mapping.js')
  const { registerTBHandlers } = await imp('ipc/tb.js')
  const { registerMappedTBHandlers } = await imp('ipc/mapped-tb.js')
  const { registerFinancialHandlers } = await imp('ipc/financials.js')
  const { registerDepreciationHandlers } = await imp('ipc/depreciation.js')
  const { registerMastersHandlers } = await imp('ipc/masters.js')
  const { registerFinancialPeriodHandlers } = await imp('ipc/financial-periods.js')
  const fin = await loadBuilder()
  await initDB({ host: 'localhost', port, database: 'postgres', user: 'selftest', password: '' })
  const launch = async () => {
    await ensureSchema(); await seedDefaultMapping(); await ensureStockCategories()
    await mig.migrateMappingV3Captions(); await mig.migrateMappingV3CaptionsPass2(); await applyMappingPatches()
  }
  await launch()
  registerTBHandlers(); registerMappedTBHandlers(); registerFinancialHandlers(); registerDepreciationHandlers()
  registerMastersHandlers(); registerFinancialPeriodHandlers(); registerMappingHandlers()
  const ipc = (name, ...args) => globalThis.__ipc[name](null, ...args)
  const one = async (sql, p) => (await query(sql, p)).rows[0]
  const all = async (sql, p) => (await query(sql, p)).rows

  // window.api exactly as the preload builds it (name -> channel), so the real
  // renderer builder talks to the real handlers. Channels with no handler here
  // answer "nothing saved" the way an empty database would.
  const preloadText = fs.readFileSync(path.join(srcRoot, 'src', 'preload', 'index.js'), 'utf8')
  const api = {}
  for (const m of preloadText.matchAll(/(\w+):\s*\(([^)]*)\)\s*=>\s*(?:ipcRenderer\.invoke|inv)\('([^']+)'/g)) {
    const [, name, , channel] = m
    api[name] = (...args) => globalThis.__ipc[channel] ? globalThis.__ipc[channel](null, ...args) : Promise.resolve(/^list|Rows$|^get(Level|Rule)/.test(name) ? [] : null)
  }
  globalThis.window = { api }

  const rs = (await one(`SELECT id FROM mapping_rule_sets WHERE is_default LIMIT 1`)).id
  const mkEntity = async (name) => (await one(`INSERT INTO entities (name, constitution, constitution_display, business_type) VALUES ($1, 3, 'Company', 'Trader') RETURNING *`, [name]))
  const mkPeriod = async (ent, label, from, till) => {
    const fp = (await one(`SELECT id FROM financial_periods WHERE date_from = $1 AND date_till = $2`, [from, till]))?.id
      || (await one(`INSERT INTO financial_periods (year_label, date_from, date_till) VALUES ($1,$2,$3) RETURNING id`, [label, from, till])).id
    return (await one(`INSERT INTO entity_periods (entity_id, financial_period_id) VALUES ($1,$2) RETURNING id`, [ent, fp])).id
  }

  // Tally-shaped rows: Cr positive / Dr negative; nature from the ledger master.
  const L = (name, parent, gp, closing, opening, deemed) => ({
    period: '', branch: '', ledger_code: '', name, opening_balance: opening, debit: 0, credit: 0, closing_balance: closing,
    is_revenue: null, is_deemed_positive: deemed, trail_balance: 0, parent, group_parent: gp,
    group_parent_1: '', group_parent_2: '', group_parent_3: '', group_parent_4: '', group_parent_5: '', group_parent_6: '', group_parent_7: gp,
  })
  // CY, as imported. Dr = Cr = 1,702,000.
  const cyLedgers = () => [
    L('Equity Share Capital', 'Capital Account', 'Capital Account', 1000000, 900000, false),
    L('Sales - Goods', 'Sales Accounts', 'Sales Accounts', 500000, 0, false),
    L('Other Income', 'Indirect Incomes', 'Indirect Incomes', 2000, 0, false),
    L('ABC Suppliers', 'Sundry Creditors', 'Current Liabilities', 200000, 150000, false),
    L('Purchases', 'Purchase Accounts', 'Purchase Accounts', -300000, 0, true),
    L('Salary', 'Indirect Expenses', 'Indirect Expenses', -100000, 0, true),
    L('Office Rent', 'Indirect Expenses', 'Indirect Expenses', -50000, 0, true),
    L('HDFC Bank', 'Bank Accounts', 'Current Assets', -500000, -450000, true),
    L('XYZ Customer', 'Sundry Debtors', 'Current Assets', -350000, -300000, true),
    L('Office Building', 'Fixed Assets', 'Fixed Assets', -400000, -300000, true),
    L('Sundry Deposit', 'Deposits (Asset)', 'Current Assets', -2000, 0, true),
  ]
  // The same year as it stands AFTER the adjustments below - imported as it is.
  const ADJ = [   // ledger, adj Dr, adj Cr
    ['Office Rent', 10000, null], ['ABC Suppliers', null, 10000],                 // rent accrued
    ['Office Building', 25000, null], ['HDFC Bank', null, 25000],                 // capitalised, paid from bank
    ['Sales - Goods', 5000, null], ['XYZ Customer', null, 5000],                  // credit note
    ['Sundry Deposit', null, 2000], ['Other Income', 2000, null],                 // each netted to nil
  ]
  const revisedLedgers = () => cyLedgers().map(l => {
    const a = ADJ.find(x => x[0] === l.name)
    return a ? { ...l, closing_balance: l.closing_balance + (a[2] || 0) - (a[1] || 0) } : l
  })
  const pyLedgers = () => [
    L('Equity Share Capital', 'Capital Account', 'Capital Account', 900000, 0, false),
    L('Sales - Goods', 'Sales Accounts', 'Sales Accounts', 400000, 0, false),
    L('ABC Suppliers', 'Sundry Creditors', 'Current Liabilities', 150000, 0, false),
    L('Purchases', 'Purchase Accounts', 'Purchase Accounts', -250000, 0, true),
    L('Salary', 'Indirect Expenses', 'Indirect Expenses', -80000, 0, true),
    L('Office Rent', 'Indirect Expenses', 'Indirect Expenses', -40000, 0, true),
    L('HDFC Bank', 'Bank Accounts', 'Current Assets', -480000, 0, true),
    L('XYZ Customer', 'Sundry Debtors', 'Current Assets', -300000, 0, true),
    L('Office Building', 'Fixed Assets', 'Fixed Assets', -300000, 0, true),
  ]
  const upload = async (ent, ep, label, rows, file) => {
    const up = await ipc('tb:uploadRealBooks', { entityId: ent.id, period: label, fileName: file, tbRows: rows, branchName: '', entityPeriodId: ep })
    await ipc('mappedTB:run', up.tb.id, rs, { excludeZero: true })
    return up.tb
  }
  const mappedRow = async (tbId, name) => one(`SELECT mt.id AS mid, mt.status, mt.alie, mt.mapping1_resultant, mt.mapping2_resultant, mt.mapping3_resultant, tr.* FROM mapped_tb mt JOIN tb_rows tr ON tr.id = mt.tb_row_id WHERE mt.tb_id = $1 AND tr.name = $2`, [tbId, name])
  const rowNow = async (tbId, name) => one(`SELECT * FROM tb_rows WHERE tb_id = $1 AND name = $2`, [tbId, name])

  // ── Two Auditees: A gets the adjustments; B is imported with the revised balances. ──
  const entA = await mkEntity('ZZ Adjusted Co'), entB = await mkEntity('ZZ Revised-Import Co')
  const epA_PY = await mkPeriod(entA.id, '2024-25', '2024-04-01', '2025-03-31'), epA_CY = await mkPeriod(entA.id, '2025-26', '2025-04-01', '2026-03-31')
  const epB_PY = await mkPeriod(entB.id, '2024-25', '2024-04-01', '2025-03-31'), epB_CY = await mkPeriod(entB.id, '2025-26', '2025-04-01', '2026-03-31')
  const tbA_PY = await upload(entA, epA_PY, '2024-25', pyLedgers(), 'py-a.xlsx')
  const tbA = await upload(entA, epA_CY, '2025-26', cyLedgers(), 'cy-a.xlsx')
  const tbB_PY = await upload(entB, epB_PY, '2024-25', pyLedgers(), 'py-b.xlsx')
  const tbB = await upload(entB, epB_CY, '2025-26', revisedLedgers(), 'cy-b.xlsx')

  console.log('\n0. Fixture')
  const nm = async (tb, n) => { const x = await mappedRow(tb.id, n); return x ? `${x.alie} > ${x.mapping1_resultant} > ${x.mapping2_resultant}` : 'missing' }
  for (const n of ['Sales - Goods', 'Office Rent', 'ABC Suppliers', 'HDFC Bank', 'Office Building', 'XYZ Customer', 'Equity Share Capital']) console.log('   ' + n.padEnd(22) + await nm(tbA, n))
  // Share Capital Fill Details (100,000 equity shares) so EPS is a real figure - with no shares it is blank on both sides.
  for (const tb of [tbA, tbB]) {
    await ipc('noteDetails:save', { tbId: tb.id, noteNum: 1, noteTitle: 'Share capital', data: { classes: [{ type: 'Equity', faceValue: 10, cy: { subscribed: 100000, paidUp: 100000 }, py: { subscribed: 100000, paidUp: 100000 } }] } })
  }
  const baseline = await fin.fetchFinancialsData(tbA, tbA_PY, entA, rs)
  const throws = async (fn, rx) => { try { await fn(); return false } catch (e) { return rx ? rx.test(String(e.message)) : true } }
  const note = (d, rx) => Object.values(d.notes || {}).find(n => rx.test(n.title || ''))
  const orig = Object.fromEntries(cyLedgers().map(l => [l.name, l.closing_balance]))

  // Everything a statement prints, as numbers: totals, sections, lines, every note's total and
  // ledger lines (name + CY + opening), EPS. Lines at nil in both years are left out - they print
  // nothing, and a ledger the adjustments net to nil is on one side only.
  const nz = (x) => Math.abs(Number(x) || 0) >= 0.005
  const figures = (d) => {
    const sections = (k) => (d[k] || []).map(s => ({
      title: s.title, total: r2(s.total), prev: r2(s.prevTotal),
      lines: (s.lines || []).filter(l => nz(l.total) || nz(l.prevTotal)).map(l => [l.label || l.title || l.name || '', r2(l.total), r2(l.prevTotal), l.noteNum ?? null]),
    }))
    const notes = Object.values(d.notes || {}).map(n => ({
      title: n.title, total: r2(n.total), prev: r2(n.prevTotal),
      rows: (n.rows || []).map(x => [x.ledger_name || x.name || '', r2(fin.displayAmt(x, 'closing_balance')), r2(fin.displayAmt(x, 'opening_balance'))])
        .filter(x => nz(x[1]) || nz(x[2])).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
    })).sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0))
    const ratios = (fin.computeRatios(d) || []).map(r => [r.key, r2(r.numeratorValue), r2(r.denominatorValue), r.cy == null ? null : Math.round(r.cy * 1e6) / 1e6, r.py == null ? null : Math.round(r.py * 1e6) / 1e6])
    return { totals: [d.totalEL, d.totalAssets, d.totalIncome, d.totalExpenses, d.netProfit, d.prevNetProfit].map(r2), ratios,
             el: sections('elSections'), assets: sections('assetSections'), income: sections('incomeSections'), expenses: sections('expenseSections'),
             notes, eps: d.eps ? JSON.stringify(d.eps) : null }
  }
  const firstDiff = (a, b, p = '') => {
    if (JSON.stringify(a) === JSON.stringify(b)) return ''
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = firstDiff(a[k], b[k], p + '/' + k); if (d) return d }
    }
    return `${p}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`
  }

  // The identity check exists from the first launch.
  const chk = async () => !!(await one(`SELECT 1 AS x FROM pg_constraint WHERE conname = 'tb_rows_adjusted_closing_chk'`))
  console.log('\n1. Arithmetic')
  ok('the database carries the identity check (closing = imported + Adj Cr - Adj Dr)', await chk())
  for (const [name, dr, cr] of ADJ) {
    const m = await mappedRow(tbA.id, name)
    await ipc('mappedTB:setAdjustment', m.mid, { ...(dr ? { debit: dr } : {}), ...(cr ? { credit: cr } : {}) })
  }
  let exact = true, why = ''
  for (const [name, dr, cr] of ADJ) {
    const t = await rowNow(tbA.id, name)
    const want = orig[name] + (cr || 0) - (dr || 0)
    if (!(Number(t.closing_balance) === want && Number(t.imported_closing_balance) === orig[name] && Number(t.adj_debit || 0) === (dr || 0) && Number(t.adj_credit || 0) === (cr || 0))) {
      exact = false; why += `${name}: closing ${t.closing_balance} (want ${want}), imported ${t.imported_closing_balance}, Dr ${t.adj_debit}, Cr ${t.adj_credit}; `
    }
  }
  ok('every adjusted ledger: closing = imported + Adj Cr - Adj Dr, exactly; the imported figure is kept', exact, why)
  // Dr / Cr columns exactly as the Mapped TB shows them (Dr column for Dr-natured ledgers, Cr for the rest)
  const drOf = (t) => t.is_deemed_positive ? -Number(t.closing_balance) : null
  const crOf = (t) => t.is_deemed_positive ? null : Number(t.closing_balance)
  const rent = await rowNow(tbA.id, 'Office Rent'), sup = await rowNow(tbA.id, 'ABC Suppliers'), sales = await rowNow(tbA.id, 'Sales - Goods')
  const cust = await rowNow(tbA.id, 'XYZ Customer'), bank = await rowNow(tbA.id, 'HDFC Bank')
  ok('Dr ledger + Adj Dr: Office Rent Revised Dr = 50,000 + 10,000 - 0 = 60,000 (Revised Cr blank)', drOf(rent) === 60000 && crOf(rent) === null)
  ok('Cr ledger + Adj Cr: ABC Suppliers Revised Cr = 200,000 + 10,000 - 0 = 210,000', crOf(sup) === 210000 && drOf(sup) === null)
  ok('Cr ledger + Adj Dr: Sales Revised Cr = 500,000 + 0 - 5,000 = 495,000', crOf(sales) === 495000)
  ok('Dr ledger + Adj Cr: XYZ Customer Revised Dr = 350,000 + 0 - 5,000 = 345,000; HDFC Bank 500,000 - 25,000 = 475,000', drOf(cust) === 345000 && drOf(bank) === 475000)
  const dep0 = await rowNow(tbA.id, 'Sundry Deposit')
  ok('an adjustment that nets a ledger to nil leaves it at 0.00 (imported -2,000 kept)', Number(dep0.closing_balance) === 0 && Number(dep0.imported_closing_balance) === -2000)

  console.log('\n2. Statements from an adjusted TB = statements from a TB imported with the revised balances')
  // B is mapped with the zero ledgers INCLUDED, as A (where the adjusted ledger exists) has them.
  await ipc('mappedTB:run', tbB.id, rs, { excludeZero: false })
  const dA = await fin.fetchFinancialsData(tbA, tbA_PY, entA, rs)
  const dB = await fin.fetchFinancialsData(tbB, tbB_PY, entB, rs)
  const fA = figures(dA), fB = figures(dB)
  ok('Balance Sheet, P&L, every note, previous year and EPS agree figure for figure', JSON.stringify(fA) === JSON.stringify(fB), firstDiff(fA, fB))
  ok('the comparison covers the statements: every section and the notes are in it', fA.notes.length >= 8 && fA.el.length > 0 && fA.assets.length > 0 && fA.income.length > 0 && fA.expenses.length > 0, `${fA.notes.length} notes`)
  ok('...and they are not the unadjusted figures', JSON.stringify(fA) !== JSON.stringify(figures(baseline)))
  ok('net profit 52,000 -> 35,000 (rent +10,000, sales -5,000, other income -2,000)', near(baseline.netProfit, 52000) && near(dA.netProfit, 35000), `${baseline.netProfit} -> ${dA.netProfit}`)
  ok('the Balance Sheet still balances: Equity & Liabilities = Assets = 1,245,000', near(dA.totalEL, 1245000) && near(dA.totalAssets, 1245000), `${dA.totalEL} / ${dA.totalAssets}`)
  const tot = (d, rx, f = 'total') => Number(note(d, rx)?.[f])
  ok('Trade payables 200,000 -> 210,000', near(tot(baseline, /trade\s*payable/i), 200000) && near(tot(dA, /trade\s*payable/i), 210000), `${tot(baseline, /trade\s*payable/i)} -> ${tot(dA, /trade\s*payable/i)}`)
  ok('Trade receivables 350,000 -> 345,000', near(tot(baseline, /trade\s*receivable/i), 350000) && near(tot(dA, /trade\s*receivable/i), 345000))
  ok('Property, Plant and Equipment 400,000 -> 425,000', near(tot(baseline, /property.*plant/i), 400000) && near(tot(dA, /property.*plant/i), 425000), `${tot(baseline, /property.*plant/i)} -> ${tot(dA, /property.*plant/i)}`)
  ok('Cash and bank 500,000 -> 475,000', near(tot(baseline, /cash/i), 500000) && near(tot(dA, /cash/i), 475000), `${tot(baseline, /cash/i)} -> ${tot(dA, /cash/i)}`)
  ok('EPS follows the adjusted profit: 52,000 / 100,000 shares = 0.52 -> 35,000 / 100,000 = 0.35', near(baseline.eps?.autoBasicCY, 0.52, 1e-9) && near(dA.eps?.autoBasicCY, 0.35, 1e-9), `${baseline.eps?.autoBasicCY} -> ${dA.eps?.autoBasicCY}`)
  const rat = (d, key) => (fin.computeRatios(d) || []).find(r => r.key === key)
  ok('the ratios follow: Net profit ratio 52,000 / 500,000 = 0.1040 -> 35,000 / 495,000 = 0.0707', near(rat(baseline, 'net_profit')?.cy, 0.104, 1e-6) && near(rat(dA, 'net_profit')?.cy, 35000 / 495000, 1e-6), `${rat(baseline, 'net_profit')?.cy} -> ${rat(dA, 'net_profit')?.cy}`)
  ok('...and the Current ratio uses the revised current liabilities (+10,000) and current assets', near((rat(dA, 'current')?.denominatorValue || 0) - (rat(baseline, 'current')?.denominatorValue || 0), 10000) && !near(rat(dA, 'current')?.numeratorValue, rat(baseline, 'current')?.numeratorValue, 1), `${rat(baseline, 'current')?.numeratorValue}/${rat(baseline, 'current')?.denominatorValue} -> ${rat(dA, 'current')?.numeratorValue}/${rat(dA, 'current')?.denominatorValue}`)
  ok('Current Year adjustments leave the Previous Year comparatives alone', near(dA.prevNetProfit, baseline.prevNetProfit) && near(tot(dA, /trade\s*payable/i, 'prevTotal'), tot(baseline, /trade\s*payable/i, 'prevTotal')))

  console.log('\n3. Every other reader sees the revised balance')
  const fd = await ipc('financials:getData', tbA.id)
  ok('financials:getData (what every statement, note, ratio and EPS is built from)', near(fd.find(x => x.ledger_name === 'Office Rent')?.closing_balance, -60000))
  const cons = await ipc('financials:getConsolidatedData', entA.id)
  ok('the consolidated query', near(cons.find(x => x.ledger_name === 'Office Rent' && x.tb_id === tbA.id)?.closing_balance, -60000))
  const brs = await ipc('financials:getBranchTBsData', entA.id)
  ok('the per-branch (columnar) query', near(brs.find(b => b.tbId === tbA.id)?.rows.find(x => x.ledger_name === 'Office Rent')?.closing_balance, -60000))
  const dl = await ipc('dep:getMappedLedgers', tbA.id)
  ok('Dep (Comp) reconciliation: Office Building -425,000', near(dl.find(x => x.ledger_name === 'Office Building')?.balance, -425000))
  const dit = await ipc('dep:getITLedgers', tbA.id)
  ok('Dep (IT) ledger list: Office Building -425,000', near(dit.find(x => x.ledger_name === 'Office Building')?.balance, -425000), JSON.stringify(dit.map(x => x.ledger_name)))
  const fb = await ipc('mappedTB:findByFilter', tbA.id, {})
  ok('Exceptions / Rectification / Fix lists: Office Rent -60,000', near(fb.find(x => x.name === 'Office Rent')?.closing_balance, -60000))
  const fbExp = await ipc('mappedTB:findByFilter', tbA.id, { alie: 'Expenses' })
  ok('...also when filtered by head', near(fbExp.find(x => x.name === 'Office Rent')?.closing_balance, -60000))
  const rem = await ipc('remarks:consolidated', tbA.id, tbA_PY.id)
  const remRent = rem.find(x => x.ledger_name === 'Office Rent')
  ok('Mapped TB with Remarks: CY -60,000 against PY -40,000', near(remRent?.closing_balance, -60000) && near(remRent?.py_closing_balance, -40000), JSON.stringify(remRent))

  if (process.env.FSG_DUMP_ROWS) {   // fixture for the screen render checks done by hand (Electron); never set by Release.ps1
    fs.writeFileSync(process.env.FSG_DUMP_ROWS, JSON.stringify({ cy: fd, py: await ipc('financials:getData', tbA_PY.id), lf: await ipc('mapping:levelFormat', 3, rs), summary: await ipc('mappedTB:adjustmentSummary', tbA.id) }))
  }

  console.log('\n3b. A Previous Year Trial Balance carries its own adjustments into the comparatives')
  const pyRent = await mappedRow(tbA_PY.id, 'Office Rent'), pySup = await mappedRow(tbA_PY.id, 'ABC Suppliers')
  await ipc('mappedTB:setAdjustment', pyRent.mid, { debit: 5000 }); await ipc('mappedTB:setAdjustment', pySup.mid, { credit: 5000 })
  const dA2 = await fin.fetchFinancialsData(tbA, tbA_PY, entA, rs)
  ok('PY profit 30,000 -> 25,000 and PY Trade payables 150,000 -> 155,000', near(dA2.prevNetProfit, 25000) && near(tot(dA2, /trade\s*payable/i, 'prevTotal'), 155000), `${dA2.prevNetProfit} / ${tot(dA2, /trade\s*payable/i, 'prevTotal')}`)
  ok('...with the Current Year untouched', near(dA2.netProfit, dA.netProfit) && near(tot(dA2, /trade\s*payable/i), 210000))
  const rem2 = (await ipc('remarks:consolidated', tbA.id, tbA_PY.id)).find(x => x.ledger_name === 'Office Rent')
  ok('Mapped TB with Remarks: PY now -45,000', near(rem2?.py_closing_balance, -45000))

  console.log('\n4. The imported figure is still shown where it should be')
  const mrows = await ipc('mappedTB:rows', tbA.id)
  const mr = mrows.find(x => x.name === 'Office Rent')
  ok('Mapped TB rows: imported -50,000, Adj Dr 10,000, revised (closing_balance) -60,000', near(mr?.imported_closing_balance, -50000) && near(mr?.adj_debit, 10000) && near(mr?.closing_balance, -60000), JSON.stringify(mr && { i: mr.imported_closing_balance, d: mr.adj_debit, c: mr.closing_balance }))
  ok('a ledger never adjusted: imported = closing', (() => { const p = mrows.find(x => x.name === 'Purchases'); return near(p?.imported_closing_balance, -300000) && near(p?.closing_balance, -300000) && p?.adj_debit == null })())
  const actual = await ipc('tb:rows', tbA.id)
  const ar = actual.find(x => x.name === 'Office Rent')
  ok('Actual TB: closing as uploaded -50,000, revised -60,000 beside it', near(ar?.closing_balance, -50000) && near(ar?.revised_closing_balance, -60000))
  const book = XLSX.read(await ipc('mappedTB:downloadExcel', tbA.id), { type: 'buffer' })
  const sheet = XLSX.utils.sheet_to_json(book.Sheets['Mapped TB'])
  const heads = XLSX.utils.sheet_to_json(book.Sheets['Mapped TB'], { header: 1 })[0] || []   // the header row (a row object leaves out its blank cells)
  const at = heads.indexOf('Clos Bal (Credit)')
  ok('Excel download: Clos Bal (Credit), Adjustments (Debit), Adjustments (Credit), Revised Clos Bal (Debit), Revised Clos Bal (Credit), in that order',
    at >= 0 && heads.slice(at, at + 5).join('|') === 'Clos Bal (Credit)|Adjustments (Debit)|Adjustments (Credit)|Revised Clos Bal (Debit)|Revised Clos Bal (Credit)', heads.join(', '))
  const xr = sheet.find(x => x['Ledger Name'] === 'Office Rent')
  ok('Excel download, Office Rent: Clos Dr 50,000 | Adj Dr 10,000 | Revised Dr 60,000', near(xr?.['Clos Bal (Debit)'], 50000) && near(xr?.['Adjustments (Debit)'], 10000) && near(xr?.['Revised Clos Bal (Debit)'], 60000), JSON.stringify(xr))

  console.log('\n5. Controls')
  const rentM = await mappedRow(tbA.id, 'Office Rent'), salM = await mappedRow(tbA.id, 'Salary')
  ok('a negative amount is refused', await throws(() => ipc('mappedTB:setAdjustment', rentM.mid, { debit: -1 }), /negative/i))
  ok('a non-numeric amount is refused', await throws(() => ipc('mappedTB:setAdjustment', rentM.mid, { credit: 'abc' }), /number/i))
  ok('an empty request is refused', await throws(() => ipc('mappedTB:setAdjustment', rentM.mid, {}), /nothing/i))
  ok('...and none of them changed anything', near((await rowNow(tbA.id, 'Office Rent')).closing_balance, -60000) && (await rowNow(tbA.id, 'Office Rent')).adj_credit == null)
  const stockRow = await one(`INSERT INTO tb_rows (tb_id, name, opening_balance, closing_balance, upload_nature, is_deemed_positive) VALUES ($1, 'Closing Stock - PL - Test', 0, -5000, 'Stock Entry', true) RETURNING id`, [tbA.id])
  const stockMt = await one(`INSERT INTO mapped_tb (tb_id, tb_row_id, rule_set_id, alie, mapping1_resultant, status) VALUES ($1, $2, $3, 'Income', 'Closing Stock (PL)', 'user_approved') RETURNING id`, [tbA.id, stockRow.id, rs])
  ok('Opening / Closing Stock rows (owned by the Stock tab) are refused', await throws(() => ipc('mappedTB:setAdjustment', stockMt.id, { debit: 100 }), /Stock tab/i))
  await query(`DELETE FROM tb_rows WHERE id = $1`, [stockRow.id])
  ok('the database refuses a write that breaks closing = imported + Adj Cr - Adj Dr', await throws(() => query(`UPDATE tb_rows SET closing_balance = closing_balance + 1 WHERE id = $1`, [rentM.id]), /check|violat/i))
  const purch = await rowNow(tbA.id, 'Purchases')
  ok('...while a never-adjusted ledger is not constrained (an import path may value it)', !(await throws(() => query(`UPDATE tb_rows SET closing_balance = closing_balance - 1 WHERE id = $1`, [purch.id]))))
  await query(`UPDATE tb_rows SET closing_balance = closing_balance + 1 WHERE id = $1`, [purch.id])

  await ipc('entityPeriod:lock', epA_CY)
  ok('a locked Financial Period refuses an adjustment', await throws(() => ipc('mappedTB:setAdjustment', rentM.mid, { debit: 11000 }), /locked/i))
  ok('...and Clear', await throws(() => ipc('mappedTB:clearAdjustments', tbA.id), /locked/i))
  ok('...and nothing moved', near((await rowNow(tbA.id, 'Office Rent')).closing_balance, -60000))
  await ipc('entityPeriod:unlock', epA_CY)

  // commas, paise, both columns on one ledger, zero clears
  await ipc('mappedTB:setAdjustment', salM.mid, { debit: '1,234.567', credit: 234.57 })
  let sal = await rowNow(tbA.id, 'Salary')
  ok('"1,234.567" is taken as 1,234.57; Dr and Cr on one ledger net: -100,000 - 1,234.57 + 234.57 = -101,000', Number(sal.adj_debit) === 1234.57 && Number(sal.closing_balance) === -101000, `${sal.adj_debit} / ${sal.closing_balance}`)
  await ipc('mappedTB:setAdjustment', salM.mid, { debit: 0, credit: '' })
  sal = await rowNow(tbA.id, 'Salary')
  ok('0 and blank clear both amounts; the closing balance is the imported one again', sal.adj_debit == null && sal.adj_credit == null && Number(sal.closing_balance) === -100000)
  // an adjustment that carries a Dr ledger across to Cr: stored as a negative debit, as the Clos Bal columns show it
  await ipc('mappedTB:setAdjustment', rentM.mid, { credit: 70000 })
  const rentX = await rowNow(tbA.id, 'Office Rent')
  ok('Office Rent crossing to Cr: closing +10,000; Revised Dr = 50,000 + 10,000 - 70,000 = -10,000 (negative debit)', Number(rentX.closing_balance) === 10000 && drOf(rentX) === -10000, `${rentX.closing_balance}`)
  await ipc('mappedTB:setAdjustment', rentM.mid, { credit: null })

  console.log('\n6. Adjustments saved by 0.1.89 (beside an untouched closing balance) are folded in, once')
  const salRow = await rowNow(tbA.id, 'Salary')
  await query(`ALTER TABLE tb_rows DROP CONSTRAINT tb_rows_adjusted_closing_chk`)
  await query(`UPDATE tb_rows SET adj_debit = 1000, imported_closing_balance = NULL WHERE id = $1`, [salRow.id])   // exactly as 0.1.89 left it
  await launch()
  let fold = await rowNow(tbA.id, 'Salary')
  ok('the next launch folds it in: imported -100,000, closing -101,000, Adj Dr 1,000', Number(fold.imported_closing_balance) === -100000 && Number(fold.closing_balance) === -101000 && Number(fold.adj_debit) === 1000, JSON.stringify({ i: fold.imported_closing_balance, c: fold.closing_balance }))
  ok('...and the identity check is back', await chk())
  await launch()
  fold = await rowNow(tbA.id, 'Salary')
  ok('a later launch folds nothing again', Number(fold.closing_balance) === -101000 && Number(fold.imported_closing_balance) === -100000)
  await ipc('mappedTB:setAdjustment', salM.mid, { debit: null })

  console.log('\n7. The Trial Balance after the adjustments')
  let sm = await ipc('mappedTB:adjustmentSummary', tbA.id)
  ok('8 ledgers adjusted; Dr 42,000 = Cr 42,000; the adjustments balance', sm.rows_adjusted === 8 && near(sm.total_debit, 42000) && near(sm.total_credit, 42000) && sm.adjustments_balanced && near(sm.difference, 0), JSON.stringify(sm))
  ok('the revised Trial Balance balances: Dr = Cr = 1,705,000 (imported 1,702,000)', sm.revised_balanced && near(sm.revised_dr, 1705000) && near(sm.revised_cr, 1705000) && near(sm.imported_dr, 1702000), JSON.stringify(sm))
  await ipc('mappedTB:setAdjustment', rentM.mid, { debit: 11000 })
  sm = await ipc('mappedTB:adjustmentSummary', tbA.id)
  ok('an unbalanced set is reported: Dr 43,000 v Cr 42,000, difference 1,000, revised TB out by 1,000', !sm.adjustments_balanced && near(sm.difference, 1000) && !sm.revised_balanced && near(sm.revised_sum, -1000), JSON.stringify(sm))
  await ipc('mappedTB:setAdjustment', rentM.mid, { debit: 10000 })
  sm = await ipc('mappedTB:adjustmentSummary', { entityId: entA.id })
  ok('the whole Auditee (consolidated view) counts the PY Trial Balance too: 10 ledgers, Dr 47,000', sm.rows_adjusted === 10 && near(sm.total_debit, 47000) && near(sm.total_credit, 47000), JSON.stringify(sm))

  console.log('\n8. Re-running the mapping keeps the adjustments')
  await ipc('mappedTB:run', tbA.id, rs, { excludeZero: true })
  let rr = await ipc('mappedTB:rows', tbA.id)
  const rDep = rr.find(x => x.name === 'Sundry Deposit'), rInc = rr.find(x => x.name === 'Other Income')
  ok('ledgers the adjustments net to nil stay on the Mapped TB (not dropped as zero balances)', !!rDep && !!rInc && near(rDep.closing_balance, 0) && near(rDep.adj_credit, 2000) && near(rInc.adj_debit, 2000), `${!!rDep} ${!!rInc}`)
  ok('every adjustment is still in place and the statements are unchanged',
    (await ipc('mappedTB:adjustmentSummary', tbA.id)).rows_adjusted === 8 && JSON.stringify(figures(await fin.fetchFinancialsData(tbA, tbA_PY, entA, rs))) === JSON.stringify(figures(dA2)) )
  // the engine reads the revised sign: a creditor adjusted into a debit balance is an advance on the next run
  const supM = await mappedRow(tbA.id, 'ABC Suppliers')
  await ipc('mappedTB:setAdjustment', supM.mid, { debit: 250000 })
  await ipc('mappedTB:run', tbA.id, rs, { excludeZero: true })
  const supFlip = await mappedRow(tbA.id, 'ABC Suppliers')
  ok('ABC Suppliers adjusted to a debit balance (-40,000) is re-classified as an advance on the next run', Number(supFlip.closing_balance) === -40000 && /short-term loans and advances/i.test(supFlip.mapping2_resultant || ''), `${supFlip.closing_balance} ${supFlip.mapping2_resultant}`)
  await ipc('mappedTB:setAdjustment', (await mappedRow(tbA.id, 'ABC Suppliers')).mid, { debit: null })
  await ipc('mappedTB:run', tbA.id, rs, { excludeZero: true })
  const supBack = await mappedRow(tbA.id, 'ABC Suppliers')
  ok('...and back to Trade payables once the adjustment is removed', Number(supBack.closing_balance) === 210000 && /trade payables/i.test(supBack.mapping2_resultant || ''), `${supBack.closing_balance} ${supBack.mapping2_resultant}`)

  console.log('\n9. Log, then Clear restores the imported figures')
  const log = await ipc('mappedTB:adjustmentLog', tbA.id)
  ok('every change is logged with the old and new amounts and the balance before / after',
    log.length >= 8 && log.some(x => x.ledger_name === 'Office Rent' && near(x.new_adj_debit, 10000) && near(x.closing_before, -50000) && near(x.closing_after, -60000)), `${log.length} entries`)
  const cleared = await ipc('mappedTB:clearAdjustments', tbA.id)
  ok('Clear removes all 8', cleared.cleared === 8, JSON.stringify(cleared))
  const clearedPY = await ipc('mappedTB:clearAdjustments', tbA_PY.id)
  ok('...and the PY Trial Balance\'s 2', clearedPY.cleared === 2, JSON.stringify(clearedPY))
  let back = true, backWhy = ''
  for (const l of cyLedgers()) { const t = await rowNow(tbA.id, l.name); if (Number(t.closing_balance) !== l.closing_balance || t.adj_debit != null || t.adj_credit != null) { back = false; backWhy += l.name + ' ' } }
  ok('every ledger is back to its imported closing balance', back, backWhy)
  const dBack = await fin.fetchFinancialsData(tbA, tbA_PY, entA, rs)
  ok('the statements are exactly the unadjusted ones again', JSON.stringify(figures(dBack)) === JSON.stringify(figures(baseline)), firstDiff(figures(dBack), figures(baseline)))
  ok('nothing is left to report', (await ipc('mappedTB:adjustmentSummary', tbA.id)).rows_adjusted === 0)
  const log2 = await ipc('mappedTB:adjustmentLog', tbA.id)
  ok('Clear is logged too', log2.length > log.length && log2.some(x => x.new_adj_debit == null && x.old_adj_debit != null))
} catch (e) {
  ok('harness ran', false, e.stack || e.message)
} finally {
  process.chdir(root)
  cleanup()
  fs.rmSync(xlsxShim, { force: true })
}
// Adjustments are typed in rupees only: the cells are locked while the figures are shown in Hundreds / Lakhs / Crores (kept on purpose)
{
  const mtb = fs.readFileSync(path.join(root, 'src/renderer/src/components/MappedTB/index.jsx'), 'utf8')
  ok('Adjustments cells stay locked while the figures are not in rupees', mtb.includes('const adjEditable = ((NUM_FORMATS[numFormat]') && mtb.includes('editing waits for As Is'))
}
finish()
process.exit(fails ? 1 : 0)
