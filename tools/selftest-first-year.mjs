/**
 * Pre-release self-test: a FIRST YEAR OF OPERATION, and "Previous Year not required".
 *
 * Reported 4 Oct 2026:
 *  1. With nothing entered for last year (a company in its first year), the Previous Year EPS - Basic and Diluted
 *     - showed "Fill Share Capital" on the face of the Statement of Profit and Loss, and the same message came out
 *     in the PDF (and the Excel). It should read "-" like every other line, and no message.
 *  2. Reserves and surplus: a new company has no opening Profit & Loss balance, so the year's surplus printed as
 *     "Add: Surplus / (Deficit) during the year" with nothing to add it to. Without an opening balance it reads
 *     "Surplus / (Deficit) during the year"; with one, "Add:" stays.
 *  3. The CA can say, per Financial Year, that Previous Year figures are not required - and whether the column
 *     stays (dashes) or is left out. By default they ARE required.
 *
 * Runs the REAL main-process code and the REAL renderer builders (statements, PDF, Excel) on a throw-away
 * PostgreSQL cluster in the temp folder, deleted afterwards - the live database is never touched.
 *
 * FSG_SRC_ROOT=<folder holding another src/> runs the same checks against that source to prove they fail there.
 *
 * Run by tools\Release.ps1 before packaging. A failure aborts the release.
 *   node tools/selftest-first-year.mjs
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
const xlsxShim = path.join(os.tmpdir(), `fsg-selftest-xlsx-fy-${process.pid}.mjs`)
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
const near = (a, b, tol = 0.005) => Math.abs((Number(a) || 0) - (Number(b) || 0)) <= tol

// ── Throw-away PostgreSQL ───────────────────────────────────────────────────
const pgRoot = 'C:\\Program Files\\PostgreSQL'
const ver = fs.existsSync(pgRoot) ? fs.readdirSync(pgRoot).filter(d => fs.existsSync(path.join(pgRoot, d, 'bin', 'initdb.exe'))).sort((a, b) => parseFloat(b) - parseFloat(a))[0] : null
if (!ver) { ok('PostgreSQL binaries found (C:\\Program Files\\PostgreSQL\\<ver>\\bin)', false); finish(); process.exit(1) }
const bin = (x) => path.join(pgRoot, ver, 'bin', x)
const port = await new Promise(res => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)) }) })
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fsg-selftest-pg-fy-'))
const run = (exe, args, quiet = false) => spawnSync(bin(exe), args, quiet ? { stdio: 'ignore', timeout: 60000 } : { encoding: 'utf8', timeout: 120000 })
let started = false
const cleanup = () => {
  if (started) run('pg_ctl.exe', ['-D', dataDir, '-m', 'immediate', '-w', 'stop'], true)
  fs.rmSync(dataDir, { recursive: true, force: true })
}

// The renderer's own builders: the statements, the PDF document and the Excel workbook.
async function loadBuilders() {
  const rd = (...p) => JSON.stringify(path.join(srcRoot, 'src', 'renderer', 'src', ...p))
  const built = await esbuild.build({
    stdin: { contents: `export { fetchFinancialsData, displayAmt } from ${rd('hooks', 'useFinancials.js')}\nexport { buildFinancialsHTML } from ${rd('components', 'GenerateFinancials', 'buildHTML.js')}\nexport { buildFinancialsWorkbook } from ${rd('components', 'GenerateFinancials', 'buildExcel.js')}\n`, resolveDir: srcRoot, loader: 'js' },
    bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
    loader: { '.js': 'jsx', '.jsx': 'jsx' }, nodePaths: [path.join(root, 'node_modules')],
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    plugins: [{ name: 'shims', setup(b) {
      b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'shim' }))
      b.onLoad({ filter: /^react$/, namespace: 'shim' }, () => ({ contents: 'const R={createElement:()=>null};export default R;export const useState=()=>[];export const useEffect=()=>{};export const useRef=()=>({});export const useMemo=(f)=>f();export const useCallback=(f)=>f;', loader: 'js' }))
    } }],
  })
  const tmp = path.join(os.tmpdir(), `fsg-selftest-fy-builders-${process.pid}.mjs`)
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
  const { registerMastersHandlers } = await imp('ipc/masters.js')
  const { registerFinancialPeriodHandlers } = await imp('ipc/financial-periods.js')
  const B = await loadBuilders()
  await initDB({ host: 'localhost', port, database: 'postgres', user: 'selftest', password: '' })
  await ensureSchema(); await seedDefaultMapping(); await ensureStockCategories()
  await mig.migrateMappingV3Captions(); await mig.migrateMappingV3CaptionsPass2(); await applyMappingPatches()
  registerTBHandlers(); registerMappedTBHandlers(); registerFinancialHandlers(); registerMastersHandlers(); registerFinancialPeriodHandlers(); registerMappingHandlers()
  const ipc = (name, ...args) => globalThis.__ipc[name](null, ...args)
  const one = async (sql, p) => (await query(sql, p)).rows[0]

  // window.api exactly as the preload builds it (name -> channel).
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
  const L = (name, parent, gp, closing, opening, deemed) => ({
    period: '', branch: '', ledger_code: '', name, opening_balance: opening, debit: 0, credit: 0, closing_balance: closing,
    is_revenue: null, is_deemed_positive: deemed, trail_balance: 0, parent, group_parent: gp,
    group_parent_1: '', group_parent_2: '', group_parent_3: '', group_parent_4: '', group_parent_5: '', group_parent_6: '', group_parent_7: gp,
  })
  const upload = async (ent, ep, label, rows, file) => {
    const up = await ipc('tb:uploadRealBooks', { entityId: ent.id, period: label, fileName: file, tbRows: rows, branchName: '', entityPeriodId: ep })
    await ipc('mappedTB:run', up.tb.id, rs, { excludeZero: true })
    return (await one(`SELECT * FROM trial_balances WHERE id = $1`, [up.tb.id]))
  }
  const saveShares = (tb, cy, py) => ipc('noteDetails:save', { tbId: tb.id, noteNum: 1, noteTitle: 'Share capital', data: { classes: [{ type: 'Equity', faceValue: 10, cy: { subscribed: cy }, py: { subscribed: py } }] } })

  // First year: nothing was owed or owned at the start. Dr = Cr = 1,500,000.
  const firstYear = () => [
    L('Equity Share Capital', 'Capital Account', 'Capital Account', 1000000, 0, false),
    L('Sales - Goods', 'Sales Accounts', 'Sales Accounts', 500000, 0, false),
    L('Purchases', 'Purchase Accounts', 'Purchase Accounts', -300000, 0, true),
    L('Salary', 'Indirect Expenses', 'Indirect Expenses', -100000, 0, true),
    L('HDFC Bank', 'Bank Accounts', 'Current Assets', -1100000, 0, true),
  ]
  // Second year: capital 800,000 and a Profit & Loss balance of 200,000 brought forward. Opening: capital 800,000,
  // P&L 150,000, bank 950,000. Dr = Cr = 1,500,000.
  const secondYear = () => [
    L('Equity Share Capital', 'Capital Account', 'Capital Account', 800000, 800000, false),
    L('Profit & Loss A/c', 'Reserves & Surplus', 'Reserves & Surplus', 200000, 150000, false),
    L('Sales - Goods', 'Sales Accounts', 'Sales Accounts', 500000, 0, false),
    L('Purchases', 'Purchase Accounts', 'Purchase Accounts', -300000, 0, true),
    L('Salary', 'Indirect Expenses', 'Indirect Expenses', -100000, 0, true),
    L('HDFC Bank', 'Bank Accounts', 'Current Assets', -1100000, -950000, true),
  ]
  const entFirst = await mkEntity('ZZ First Year Co'), entSecond = await mkEntity('ZZ Second Year Co')
  const epFirst = await mkPeriod(entFirst.id, '2025-26', '2025-04-01', '2026-03-31'), epSecond = await mkPeriod(entSecond.id, '2025-26', '2025-04-01', '2026-03-31')
  const tbFirst = await upload(entFirst, epFirst, '2025-26', firstYear(), 'first.xlsx')
  const tbSecond = await upload(entSecond, epSecond, '2025-26', secondYear(), 'second.xlsx')
  await saveShares(tbFirst, 100000, 0)           // this year's share count entered; last year there was nothing
  await saveShares(tbSecond, 100000, 0)

  const docs = async (ent, tb) => {
    const data = await B.fetchFinancialsData(tb, null, ent, rs)
    const pdf = B.buildFinancialsHTML({ entity: ent, activeTB: tb, prevTB: null, data, auditor: null, signatories: [], signPlace: 'X', signDate: '2026-09-30' })
    const wb = B.buildFinancialsWorkbook({ entity: ent, activeTB: tb, prevTB: null, data, levelFormat: [], auditor: null, signatories: [], signPlace: 'X', signDate: '2026-09-30' })
    return { data, pdf, wb }
  }
  const sheetText = (wb, name) => {
    const ws = wb.Sheets[name]
    return Object.entries(ws || {}).filter(([k]) => !k.startsWith('!')).map(([, c]) => String(c?.v ?? '')).join(' | ')
  }
  const epsRows = (wb) => {
    const ws = wb.Sheets['Profit & Loss']
    const out = {}
    for (const [k, c] of Object.entries(ws)) {
      if (k.startsWith('!')) continue
      const v = String(c?.v ?? '')
      if (/\(1\) Basic/.test(v)) out.basic = k
      if (/\(2\) Diluted/.test(v)) out.diluted = k
    }
    const at = (a, col) => ws[col + a.replace(/^[A-Z]+/, '')]
    return { basicCY: at(out.basic, 'C')?.v, basicPY: at(out.basic, 'D')?.v, dilutedCY: at(out.diluted, 'C')?.v, dilutedPY: at(out.diluted, 'D')?.v }
  }
  const epsCells = (pdf) => {
    const m = /\(1\) Basic<\/td>\s*<td><\/td>\s*<td class="right"[^>]*>([\s\S]*?)<\/td>\s*<td class="right"[^>]*>([\s\S]*?)<\/td>[\s\S]*?\(2\) Diluted<\/td>\s*<td><\/td>\s*<td class="right"[^>]*>([\s\S]*?)<\/td>\s*<td class="right"[^>]*>([\s\S]*?)<\/td>/.exec(pdf)
    const t = (s) => String(s || '').replace(/<[^>]*>/g, '').trim()
    return m ? { basicCY: t(m[1]), basicPY: t(m[2]), dilutedCY: t(m[3]), dilutedPY: t(m[4]) } : null
  }

  console.log('\n1. A first year of operation: Previous Year EPS is a dash, with no message')
  const A = await docs(entFirst, tbFirst)
  ok('last year has nothing: the EPS data says so (pyNotApplicable), and does not ask for last year\'s shares', A.data.eps?.pyNotApplicable === true && A.data.eps?.sharesMissingPY === false && A.data.eps?.sharesMissingCY === false, JSON.stringify(A.data.eps))
  ok('this year\'s EPS is still worked out: 100,000 shares, profit 100,000 -> 1.00', near(A.data.eps?.autoBasicCY, 1, 1e-9), String(A.data.eps?.autoBasicCY))
  const aPdf = epsCells(A.pdf)
  ok('PDF: Previous Year EPS (Basic and Diluted) prints "—"', aPdf && aPdf.basicPY === '—' && aPdf.dilutedPY === '—', JSON.stringify(aPdf))
  ok('PDF: no "Fill Share Capital" and no shares-missing warning anywhere', !/Fill Share Capital/i.test(A.pdf) && !/Number of Equity Shares Issued/i.test(A.pdf))
  ok('PDF: this year\'s EPS prints as before (1.00)', aPdf && aPdf.basicCY === '1.00' && aPdf.dilutedCY === '1.00', JSON.stringify(aPdf))
  const aXl = epsRows(A.wb)
  ok('Excel: Previous Year EPS cells are "—"; this year 1.00', aXl.basicPY === '—' && aXl.dilutedPY === '—' && aXl.basicCY === '1.00', JSON.stringify(aXl))
  ok('Excel: no shares-missing warning line, no red EPS cell', !/Number of Equity Shares Issued/i.test(sheetText(A.wb, 'Profit & Loss')))

  console.log('\n2. Last year has figures but no share count: still asked for (a real omission)')
  const B2 = await docs(entSecond, tbSecond)
  ok('second year, no shares entered for last year: sharesMissingPY stays true', B2.data.eps?.pyNotApplicable === false && B2.data.eps?.sharesMissingPY === true, JSON.stringify(B2.data.eps))
  ok('...and the PDF still says "Fill Share Capital" for it', /Fill Share Capital/i.test(B2.pdf) && /Number of Equity Shares Issued/i.test(B2.pdf))
  await saveShares(tbSecond, 100000, 100000)
  const B3 = await docs(entSecond, tbSecond)
  ok('once last year\'s shares are entered the Previous Year EPS is a figure, with no message', B3.data.eps?.sharesMissingPY === false && B3.data.eps?.pyNotApplicable === false && !/Fill Share Capital/i.test(B3.pdf), JSON.stringify(B3.data.eps))

  console.log('\n3. Reserves and surplus: "Add:" only when there is an opening balance to add to')
  const noteRs = (d) => Object.values(d.notes || {}).find(n => /reserves/i.test(n.title || ''))
  const surplusRow = (d) => (noteRs(d)?.templateRows || []).find(r => r.syntheticProfitLoss && /surplus/i.test(r.label || ''))
  ok('first year: the row is shown as "Surplus / (Deficit) during the year"', surplusRow(A.data)?.displayLabel === 'Surplus / (Deficit) during the year', JSON.stringify(surplusRow(A.data)?.displayLabel))
  ok('...but keeps its own label as its key (Manual PY, remarks and the Annexures link are keyed on it)', surplusRow(A.data)?.label === 'Add: Surplus / (Deficit) during the year', String(surplusRow(A.data)?.label))
  ok('first year, PDF note: the line prints without "Add:"', A.pdf.includes('>Surplus / (Deficit) during the year</td>') && !A.pdf.includes('>Add: Surplus / (Deficit) during the year</td>'))
  ok('first year, Excel notes sheet: the line prints without "Add:"', /\|\s*  Surplus \/ \(Deficit\) during the year|^  Surplus \/ \(Deficit\) during the year/m.test(sheetText(A.wb, 'Notes').replace(/ \| /g, '\n')) && !/Add: Surplus/.test(sheetText(A.wb, 'Notes')), sheetText(A.wb, 'Notes').slice(0, 200))
  ok('a company with an opening balance: "Add:" stays', surplusRow(B2.data)?.displayLabel === undefined && B2.pdf.includes('>Add: Surplus / (Deficit) during the year</td>'), JSON.stringify(surplusRow(B2.data)?.displayLabel))

  // With Manual PY on, last year's figures are typed by hand: the same rule is applied again on those figures.
  await ipc('manualPY:set', tbFirst.id, true); await ipc('manualPY:set', tbSecond.id, true)
  const M1 = await B.fetchFinancialsData(tbFirst, null, entFirst, rs), M2 = await B.fetchFinancialsData(tbSecond, null, entSecond, rs)
  ok('Manual PY on, first year: still "Surplus / (Deficit) during the year"; second year (opening balance): "Add:" stays', surplusRow(M1)?.displayLabel === 'Surplus / (Deficit) during the year' && surplusRow(M2)?.displayLabel === undefined, `${surplusRow(M1)?.displayLabel} / ${surplusRow(M2)?.displayLabel}`)
  await ipc('manualPY:set', tbFirst.id, false); await ipc('manualPY:set', tbSecond.id, false)

  console.log('\n4. Previous Year not required (per Financial Year) - and required by default')
  const ep0 = await ipc('entityPeriod:get', epSecond)
  ok('the default is "required"', ep0.py_mode === 'required', ep0.py_mode)
  ok('...with last year\'s figures as before: the Previous Year Balance Sheet totals are there', B3.data.elSections.some(s => Math.abs(s.prevTotal) > 0) && B3.data.assetSections.some(s => Math.abs(s.prevTotal) > 0), JSON.stringify(B3.data.elSections.map(s => s.prevTotal)))
  const listed = (await ipc('entityPeriod:list', entSecond.id))[0]
  ok('the Financial Year list carries the choice', listed.py_mode === 'required')
  ok('an unknown choice is refused', await ipc('entityPeriod:setPYMode', epSecond, 'whatever').then(() => false, e => /unknown/i.test(e.message)))
  await ipc('entityPeriod:setPYMode', epSecond, 'none_show')
  const C = await docs(entSecond, tbSecond)
  const pyTotals = (d) => [...(d.elSections || []), ...(d.assetSections || []), ...(d.incomeSections || []), ...(d.expenseSections || [])].reduce((s, x) => s + Math.abs(x.prevTotal || 0), 0) + Math.abs(d.prevNetProfit || 0)
  ok('not required: nothing from last year reaches the statements (every Previous Year total and the profit are nil)', pyTotals(C.data) < 0.005 && C.data.pyMode === 'none_show', String(pyTotals(C.data)))
  ok('...Current Year figures are untouched', near(C.data.netProfit, B3.data.netProfit) && near(C.data.totalAssets, B3.data.totalAssets) && near(C.data.totalEL, B3.data.totalEL))
  ok('...every note\'s Previous Year total is nil', Object.values(C.data.notes || {}).every(n => Math.abs(n.prevTotal || 0) < 0.005))
  ok('...Previous Year EPS is a dash (not asked for), in the PDF and the Excel', C.data.eps?.pyNotApplicable === true && epsCells(C.pdf)?.basicPY === '—' && epsRows(C.wb).basicPY === '—' && !/Fill Share Capital/i.test(C.pdf))
  ok('...the Current Year EPS is as before', near(C.data.eps?.autoBasicCY, B3.data.eps?.autoBasicCY, 1e-9))
  ok('...and a Previous Year TB picked for comparison is ignored too', await (async () => {
    const tbPy = await upload(entSecond, await mkPeriod(entSecond.id, '2024-25', '2024-04-01', '2025-03-31'), '2024-25', secondYear(), 'second-py.xlsx')
    const d = await B.fetchFinancialsData(tbSecond, tbPy, entSecond, rs)
    return pyTotals(d) < 0.005
  })())
  await ipc('entityPeriod:setPYMode', epSecond, 'none_hide')
  const D = await docs(entSecond, tbSecond)
  ok('"not required - hide the column" gives the same nil figures and tells the builders to leave the column out', pyTotals(D.data) < 0.005 && D.data.pyMode === 'none_hide')
  console.log('\n5. "Not required - column left out": the Balance Sheet, Profit and Loss, notes and annexures print without the Previous Year column')
  const headCounts = (pdf) => {
    const tables = [...pdf.matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table>/g)]
    const thCount = (t) => ((/<thead[\s\S]*?<\/thead>/.exec(t[2]) || [''])[0].match(/<th\b/g) || []).length
    return {
      face: tables.filter(t => /compact-table/.test(t[1])).map(thCount),
      notes: tables.filter(t => /fs-table"/.test(t[1]) && /data-flow-table/.test(t[1]) && !/annex-table/.test(t[1])).map(thCount),
      annex: tables.filter(t => /annex-table/.test(t[1])).map(thCount),
    }
  }
  const hasHidden = (wb, name, col) => !!(wb.Sheets[name]['!cols'] || [])[col]?.hidden
  const hidePdf = D.pdf
  const hc = headCounts(hidePdf)
  ok('hide: the Balance Sheet and the Profit and Loss have 3 header cells (label, Note, Current Year)', hc.face.length >= 2 && hc.face.every(n => n === 3), JSON.stringify(hc.face))
  ok('hide: every note table has 3 header cells', hc.notes.length > 0 && hc.notes.every(n => n === 3), JSON.stringify(hc.notes))
  ok('hide: every annexure table has 5 header cells (the two Previous Year columns gone from 7)', hc.annex.length > 0 && hc.annex.every(n => n === 5), JSON.stringify(hc.annex))
  ok('hide: no mark is left in the document and no Previous Year header text on the faces', !/data-py-col/.test(hidePdf) && !/>Previous Year</.test(hidePdf))
  ok('hide: the Current Year figures are all still there (Total Assets and Total Equity and Liabilities, 11,00,000.00)', (hidePdf.match(/11,00,000\.00/g) || []).length >= 2, String((hidePdf.match(/11,00,000\.00/g) || []).length))
  const faceCells = (pdf) => { const t = [...pdf.matchAll(/<table\b[^>]*compact-table[^>]*>([\s\S]*?)<\/table>/g)][1]; return t ? [...t[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(r => (r[1].match(/<t[dh]\b/g) || []).length) : [] }
  ok('hide: every Profit and Loss row has 3 cells or fewer (no stray Previous Year cell, EPS rows included)', faceCells(hidePdf).length > 5 && faceCells(hidePdf).every(n => n <= 3), JSON.stringify(faceCells(hidePdf)))
  ok('hide: the carried-forward rows kept for the page layout lost their Previous Year cell too', (hidePdf.match(/<template data-flow-cf>[\s\S]*?<\/template>/g) || []).every(t => !/{PY}/.test(t)) && (hidePdf.match(/{CY}/g) || []).length > 0)
  ok('hide: Excel - the Previous Year column of the Balance Sheet, Profit and Loss and Annexures is hidden (not deleted)', hasHidden(D.wb, 'Balance Sheet', 3) && hasHidden(D.wb, 'Profit & Loss', 3) && hasHidden(D.wb, 'Annexures', 5) && hasHidden(D.wb, 'Annexures', 6) && D.wb.Sheets['Balance Sheet']['D5'] !== undefined)
  ok('hide: Excel - the Notes sheet is left as it is', !hasHidden(D.wb, 'Notes', 3))
  await ipc('entityPeriod:setPYMode', epSecond, 'none_show')
  const S2 = await docs(entSecond, tbSecond)
  const hcShow = headCounts(S2.pdf)
  ok('show (not required, column kept): every table keeps 4 header cells and nothing is hidden in Excel', hcShow.face.every(n => n === 4) && hcShow.notes.every(n => n === 4) && !hasHidden(S2.wb, 'Balance Sheet', 3))
  await ipc('entityPeriod:setPYMode', epSecond, 'required')
  const R2 = await docs(entSecond, tbSecond)
  const hcReq = headCounts(R2.pdf)
  ok('required (the default): untouched - 4 header cells, no hidden column', hcReq.face.every(n => n === 4) && hcReq.notes.every(n => n === 4) && hcReq.annex.every(n => n === 7) && !hasHidden(R2.wb, 'Balance Sheet', 3), JSON.stringify(hcReq))

  if (process.env.FSG_DUMP_PDF_DIR) {   // the documents, for the page-by-page look done by hand (Electron print + pypdfium2); never set by Release.ps1
    fs.mkdirSync(process.env.FSG_DUMP_PDF_DIR, { recursive: true })
    for (const [n, html] of [['required', R2.pdf], ['show', S2.pdf], ['hide', hidePdf], ['firstyear', A.pdf]]) fs.writeFileSync(path.join(process.env.FSG_DUMP_PDF_DIR, n + '.html'), html)
  }
  await ipc('entityPeriod:setPYMode', epSecond, 'required')
  const E = await B.fetchFinancialsData(tbSecond, null, entSecond, rs)
  ok('back to "required": last year\'s figures are back, exactly as before', near(E.prevNetProfit, B3.data.prevNetProfit) && near(pyTotals(E), pyTotals(B3.data)))
  await ipc('entityPeriod:lock', epSecond)
  ok('a locked Financial Year refuses a change', await ipc('entityPeriod:setPYMode', epSecond, 'none_show').then(() => false, e => /locked/i.test(e.message)))
  await ipc('entityPeriod:unlock', epSecond)
} catch (e) {
  ok('harness ran', false, e.stack || e.message)
} finally {
  process.chdir(root)
  cleanup()
  fs.rmSync(xlsxShim, { force: true })
}
finish()
process.exit(fails ? 1 : 0)
