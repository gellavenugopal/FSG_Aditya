/**
 * Pre-release self-test: the snapshot FSG Bharat publishes for Cloudtail MCA (0.1.101).
 * Cloudtail (Directors' Report, AOC-4, MGT-7) reads every figure from the table fs_snapshots and never recalculates them; until now nothing
 * wrote that table, so Cloudtail printed SAMPLE figures. This checks, with the app's real code:
 *   1. the snapshot built from the statements (utils/fsSnapshot.js): the layout of Cloudtail_MCA/docs/PLAN.md section 7, a stable code on
 *      every face line, figures that agree with the Balance Sheet and Profit and Loss, the key figures, the notes, share capital,
 *      the auditor and signatories as printed;
 *   2. the table and the publish handler on a throw-away PostgreSQL cluster: versions count up per Financial Year, Cloudtail's own read
 *      query returns the newest, a bad snapshot is refused and writes nothing.
 * FSG_SRC_ROOT=<folder holding another src/> runs the same checks against that source.
 *   node tools/selftest-fs-snapshot.mjs
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
const xlsxShim = path.join(os.tmpdir(), `fsg-selftest-xlsx-snap-${process.pid}.mjs`)
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
const ok = (what, cond, detail = '') => { if (!cond) fails++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond || !detail ? '' : '  -- ' + String(detail).slice(0, 500)}`) }
const finish = () => { console.log(fails ? `\n${fails} FAILURE(S) - release aborted\n` : '\nAll checks passed\n') }
const near = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.5
console.log(`\nSnapshot for Cloudtail MCA${srcRoot !== root ? `  (source: ${srcRoot})` : ''}`)

const reactShim = {
  name: 'react-shim',
  setup(b) {
    b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'shim' }))
    b.onLoad({ filter: /.*/, namespace: 'shim' }, () => ({
      contents: 'const React = { createElement: () => null }; export default React; export const useState = () => []; export const useEffect = () => {}; export const useRef = () => ({}); export const useMemo = (f) => f(); export const useCallback = (f) => f; export const useContext = () => ({}); export const createContext = () => ({});', loader: 'js',
    }))
    b.onLoad({ filter: /useFinancials\.js$/ }, (args) => ({ contents: fs.readFileSync(args.path, 'utf8') + '\nexport { buildPrevMap }\n', loader: 'jsx', resolveDir: path.dirname(args.path) }))
  },
}
const S = (...p) => JSON.stringify(path.join(srcRoot, 'src', 'renderer', 'src', ...p))
let mod = null
try {
  const out = await esbuild.build({
    stdin: { contents: `export { processRows, buildPrevMap } from ${S('hooks', 'useFinancials.js')}\nexport { buildFsSnapshotPayload } from ${S('utils', 'fsSnapshot.js')}\nexport { fetchFinancialsData } from ${S('hooks', 'useFinancials.js')}`, resolveDir: root, loader: 'js' },
    bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent', loader: { '.js': 'jsx', '.jsx': 'jsx' }, nodePaths: [path.join(root, 'node_modules')],
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" }, plugins: [reactShim],
  })
  const tmp = path.join(os.tmpdir(), `fsg-selftest-snap-${process.pid}.mjs`)
  fs.writeFileSync(tmp, out.outputFiles[0].text)
  try { mod = await import(pathToFileURL(tmp).href) } finally { fs.rmSync(tmp, { force: true }) }
} catch (e) { ok('the snapshot builder exists and loads (utils/fsSnapshot.js)', false, e && e.message) }

function row(alie, level1, level2, closing, name) {
  return { alie, level1, mapping1_resultant: level1, level2, mapping2_resultant: level2, level3: null, mapping3_resultant: null, name, ledger_name: name, ledger_code: '',
    closing_balance: String(closing), opening_balance: '0', upload_nature: null, level5_value: null, stock_head: null, sort_order: 9999, status: 'auto_high', is_deemed_positive: closing < 0 }
}
function tb(v) {
  const rows = [
    row('Income', 'Revenue from operations', 'Sale of products', v.sales, 'Sales'),
    row('Expenses', 'Other expenses', 'Rent', -v.rent, 'Rent'),
    row('Expenses', 'Employee benefits expense', 'Salaries and wages', -v.salary, 'Salary'),
    row('Expenses', 'Depreciation and amortization expense', 'Depreciation', -v.dep, 'Depreciation'),
    row('Expenses', 'Finance costs', 'Interest expense', -v.fin, 'Interest on term loan'),
    row('Expenses', 'Tax expense', 'Current tax', -v.tax, 'Income tax'),
    row('Income', 'Other income', 'Interest income', v.interest, 'Interest on FD'),
    row('EQUITY AND LIABILITIES', "Shareholders' funds", 'Share capital', v.capital, 'Capital'),
    row('EQUITY AND LIABILITIES', "Shareholders' funds", 'Reserves and Surplus', v.reserves, 'Retained earnings'),
    row('EQUITY AND LIABILITIES', 'Non-current liabilities', 'Long-term borrowings', v.ltb, 'Term loan'),
    row('EQUITY AND LIABILITIES', 'Current liabilities', 'Trade payables', v.tp, 'Creditors'),
    row('ASSETS', 'Non-current assets', 'Property, Plant and Equipment', -v.ppe, 'Plant and machinery'),
    row('ASSETS', 'Current assets', 'Inventories', -v.inv, 'Stock'),
    row('ASSETS', 'Current assets', 'Trade receivables', -v.tr, 'Debtors'),
  ]
  let cr = 0, dr = 0
  for (const r of rows) { const n = parseFloat(r.closing_balance); if (n > 0) cr += n; else dr -= n }
  rows.push(row('ASSETS', 'Current assets', 'Cash and bank balances', -(cr - dr), 'Bank'))
  return rows
}
const PYv = { sales: 800000, rent: 300000, salary: 100000, dep: 50000, fin: 20000, tax: 30000, interest: 10000, capital: 500000, reserves: 100000, ltb: 300000, tp: 120000, ppe: 700000, inv: 150000, tr: 200000 }
const pyProfit = 800000 - 300000 - 100000 - 50000 - 20000 - 30000 + 10000
const CYv = { sales: 1200000, rent: 400000, salary: 150000, dep: 60000, fin: 25000, tax: 90000, interest: 15000, capital: 600000, reserves: 100000 + pyProfit - 50000, ltb: 250000, tp: 150000, ppe: 820000, inv: 190000, tr: 260000 }
const cyProfit = 1200000 - 400000 - 150000 - 60000 - 25000 - 90000 + 15000

let goodPayload = null
if (mod) try {
  const { processRows, buildPrevMap, buildFsSnapshotPayload } = mod
  const data = processRows(tb(CYv), buildPrevMap(tb(PYv)), 3, [], 'Trader', false, false, null, [], null)
  const shareNote = (data.activeNotes || []).find(n => /share capital/i.test(n.title || ''))
  const details = new Map()
  if (shareNote) details.set(Number(shareNote.num), { classes: [{ type: 'Equity', faceValue: 10, cy: { subscribed: 60000 } }], promoters: [{ name: 'A Director', shares: 40000 }], shareholders5pctEquity: [{ name: 'A Director', shares: 40000 }], rights: 'One vote per share', footnotes: ['x'] })
  const auditor = { firm_name: 'Aditya Maheshwari & Co.', frn: '123456E', name: 'Aditya Maheshwari', membership_number: '654321' }
  const sigs = [{ name: 'Shourav Agrawal', din: '01234567', designation: 'Director' }, { name: 'Second Director', din: '07654321', designation: 'Director' }]
  const p = buildFsSnapshotPayload({ entity: { id: 7, name: 'Snapshot Test Pvt Ltd', constitution: 3, cin: 'U12345WB2020PTC123456', address: 'Siliguri' }, activeTB: { id: 1, period: '2025-04-01 To 2026-03-31', entity_period_id: 12 }, data, auditor, signatories: sigs, signPlace: 'Siliguri', signDate: '2026-09-30', noteDetailsMap: details })
  goodPayload = p
  const J = JSON.parse(JSON.stringify(p))
  ok('it follows the layout of Cloudtail PLAN section 7 (schema_version 1 and every top-level key)', J.schema_version === 1 && ['entity', 'period', 'basis', 'balance_sheet', 'profit_and_loss', 'notes', 'key_figures', 'share_capital', 'signatories_as_printed', 'auditor_as_printed'].every(k => J[k] !== undefined))
  ok('entity and period: name, CIN, reporting dates and closing-month label', J.entity.name === 'Snapshot Test Pvt Ltd' && J.entity.cin === 'U12345WB2020PTC123456' && J.entity.constitution === 3 && J.period.date_from === '2025-04-01' && J.period.date_till === '2026-03-31' && J.period.year_label === 'Mar2026' && J.period.entity_period_id === 12, JSON.stringify(J.period))
  const viaMaster = buildFsSnapshotPayload({ entity: { id: 7, name: 'X', constitution: 3 }, activeTB: { id: 1, period: '2025-26', entity_period_id: 12 }, data, periodInfo: { year_label: '2025-26', date_from: '2025-04-01', date_till: '2026-03-31' } })
  ok('reporting dates come from the Auditee\'s master period, and the displayed period label is generated from its close date', viaMaster.period.date_from === '2025-04-01' && viaMaster.period.date_till === '2026-03-31' && viaMaster.period.year_label === 'Mar2026', JSON.stringify(viaMaster.period))
  ok('the basis says absolute rupees, not consolidated', J.basis.rounding === 'rupees' && J.basis.consolidated === false)
  const codes = [...J.balance_sheet, ...J.profit_and_loss].map(l => l.code)
  ok('every face line has a code and a label; codes are unique, so Cloudtail never matches on a label or note number', codes.every(Boolean) && new Set(codes).size === codes.length && [...J.balance_sheet, ...J.profit_and_loss].every(l => l.label && Number.isFinite(l.cy) && Number.isFinite(l.py)), codes.join(','))
  const bs = (code) => J.balance_sheet.find(l => l.code === code), pl = (code) => J.profit_and_loss.find(l => l.code === code)
  ok('Balance Sheet: total equity and liabilities = total assets = the statements totals (Current and Previous Year)', near(bs('BS.EL.TOTAL').cy, bs('BS.AS.TOTAL').cy) && near(bs('BS.EL.TOTAL').cy, data.totalEL) && near(bs('BS.EL.TOTAL').py, bs('BS.AS.TOTAL').py) && bs('BS.EL.TOTAL').py > 0, JSON.stringify([bs('BS.EL.TOTAL'), bs('BS.AS.TOTAL')]))
  ok('Balance Sheet lines carry their stable codes (share capital BS.EL.1.a, reserves BS.EL.1.b, long-term borrowings BS.EL.3.a, trade payables BS.EL.4.b, inventories BS.AS.2.b)', bs('BS.EL.1.a') && /share capital/i.test(bs('BS.EL.1.a').label) && near(bs('BS.EL.1.a').cy, 600000) && bs('BS.EL.1.b') && /reserves/i.test(bs('BS.EL.1.b').label) && near(bs('BS.EL.3.a').cy, 250000) && near(bs('BS.EL.4.b').cy, 150000) && near(bs('BS.AS.2.b').cy, 190000), JSON.stringify(['BS.EL.1.a', 'BS.EL.1.b', 'BS.EL.3.a', 'BS.EL.4.b', 'BS.AS.2.b'].map(c => bs(c))))
  ok('Profit and Loss: revenue 12,00,000, profit for the period = the statements net profit, both years', near(pl('PL.I').cy, 1200000) && near(pl('PL.I').py, 800000) && near(pl('PL.PAT').cy, data.netProfit) && near(pl('PL.PAT').cy, cyProfit) && near(pl('PL.PAT').py, pyProfit), JSON.stringify([pl('PL.I'), pl('PL.PAT')]))
  ok('...and its subtotals add up (total revenue, total expenses, profit before tax, tax)', near(pl('PL.III').cy, 1215000) && near(pl('PL.IV').cy, 635000) && near(pl('PL.IX').cy, 580000) && near(pl('PL.X').cy, 90000) && near(pl('PL.IX').cy - pl('PL.X').cy, pl('PL.XI').cy))
  const kf = J.key_figures
  ok('key figures: turnover, other income, PBT, tax, PAT', near(kf.turnover.cy, 1200000) && near(kf.turnover.py, 800000) && near(kf.other_income.cy, 15000) && near(kf.pbt.cy, 580000) && near(kf.tax_current.cy, 90000) && near(kf.pat.cy, cyProfit) && near(kf.pat.py, pyProfit), JSON.stringify(kf))
  ok('key figures: paid-up capital, reserves and surplus (with the year profit), net worth, borrowings', near(kf.paid_up_capital.cy, 600000) && near(kf.reserves_and_surplus.cy, 100000 + pyProfit - 50000 + cyProfit) && near(kf.net_worth.cy, kf.paid_up_capital.cy + kf.reserves_and_surplus.cy) && near(kf.long_term_borrowings.cy, 250000) && near(kf.short_term_borrowings.cy, 0), JSON.stringify(kf))
  ok('the definitions of turnover and net worth are stated', /s\.2\(91\)/.test(J.definitions.turnover) && /BS\.EL\.1\.a/.test(J.definitions.net_worth))
  ok('notes: every note with its number, title and rows array, the Fill Details saved against them carried', J.notes.length >= 3 && J.notes.every(n => n.num && n.title && Array.isArray(n.rows)) && J.notes.some(n => n.fill_details && Array.isArray(n.fill_details.classes)))
  ok('share capital: classes, promoters, 5% holders and rights from the share capital note\'s Fill Details', !!shareNote && J.share_capital.classes.length === 1 && J.share_capital.promoters[0].name === 'A Director' && J.share_capital.shareholders5pctEquity.length === 1 && J.share_capital.rights === 'One vote per share')
  ok('auditor as printed: firm, FRN, partner, membership number, place and date', J.auditor_as_printed.firm_name === 'Aditya Maheshwari & Co.' && J.auditor_as_printed.frn === '123456E' && J.auditor_as_printed.partner === 'Aditya Maheshwari' && J.auditor_as_printed.membership_number === '654321' && J.auditor_as_printed.place === 'Siliguri' && J.auditor_as_printed.date === '2026-09-30')
  ok('signatories as printed: name, DIN, designation', J.signatories_as_printed.length === 2 && J.signatories_as_printed[0].name === 'Shourav Agrawal' && J.signatories_as_printed[0].id_type === 'DIN' && J.signatories_as_printed[0].id === '01234567' && J.signatories_as_printed[0].designation === 'Director')
  // the notes as the app prints them: the real fetchFinancialsData attaches each note's printed rows
  const XLSXR = require(path.join(root, 'node_modules', 'xlsx'))
  const wbLF = XLSXR.readFile(path.join(srcRoot, 'Mapping_v2.xlsx'))
  const LF = XLSXR.utils.sheet_to_json(wbLF.Sheets.LevelFormat, { defval: null }).map((q, i) => ({
    id: i + 1, constitution: parseInt(q['Constitution']), alie: q['ALIE'], level1: q['Level 1'], level2: q['Level 2'], level3: q['Level 3'],
    level4: q['Level 4'], level5: q['Level 5'], level6: q['Level 6'], level7: q['Level 7'], sort_order: i,
  })).filter(q => q.constitution === 3)
  const full = (q) => ({ ...q, level4_value: null, level5_value: null, level6_value: null, level7_value: null, status: 'user_approved' })
  globalThis.window = { api: {
    getFinancialData: async (id) => (id === 1 ? tb(CYv).map(full) : id === 2 ? tb(PYv).map(full) : []), getLevelFormat: async () => LF.map(q => ({ ...q })),
    listNoteDetails: async () => [], depGet: async () => null, depITGet: async () => null, depCompGet: async () => null,
    getManualPY: async () => false, listManualPyEntries: async () => [], getPlClosedToCapital: async () => false, getGeneralNotes: async () => null, getEps: async () => null, getCfs: async () => null,
  } }
  const real = await mod.fetchFinancialsData({ id: 1, period: '2025-04-01 To 2026-03-31', entity_period_id: 12 }, { id: 2, period: '2024-04-01 To 2025-03-31' }, { id: 7, name: 'X', constitution: 3, constitution_display: 'Company', business_type: 'Trader' }, null)
  const pr = buildFsSnapshotPayload({ entity: { id: 7, name: 'X', constitution: 3 }, activeTB: { id: 1, period: '2025-04-01 To 2026-03-31', entity_period_id: 12 }, data: real })
  const withRows = pr.notes.filter(n => n.rows.length > 0)
  ok('notes as printed: the rows of each note (label, Current and Previous Year, depth), taken from the same rows the PDF prints', withRows.length >= 3 && withRows.every(n => n.rows.every(x => 'label' in x && 'cy' in x && 'py' in x && 'depth' in x)), JSON.stringify(pr.notes.map(n => [n.num, n.title, n.rows.length])))
  ok('...and the face notes agree with the figures: the Trade payables note total equals the Balance Sheet line', near((pr.notes.find(n => /trade payable/i.test(n.title)) || {}).total, pr.balance_sheet.find(l => l.code === 'BS.EL.4.b').cy))
  const first = buildFsSnapshotPayload({ entity: { id: 7, name: 'X', constitution: 3 }, activeTB: { id: 1, period: '2025-04-01 To 2026-03-31', entity_period_id: 12 }, data: processRows(tb(CYv), null, 3, [], 'Trader', false, false, null, [], null) })
  ok('a first-year entity (no Previous Year) still publishes, with nil Previous Year figures and no auditor', first.balance_sheet.every(l => l.py === 0) && first.auditor_as_printed.firm_name === '' && near(first.key_figures.turnover.cy, 1200000))
} catch (e) { ok('the snapshot checks ran', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e)) }

// ═════ the table and the publish handler ═════
console.log('\nThe fs_snapshots table and publishing (real handlers, throw-away PostgreSQL)')
const pgRoot = 'C:\\Program Files\\PostgreSQL'
const ver = fs.existsSync(pgRoot) ? fs.readdirSync(pgRoot).filter(d => fs.existsSync(path.join(pgRoot, d, 'bin', 'initdb.exe'))).sort((a, b) => parseFloat(b) - parseFloat(a))[0] : null
if (!ver) { ok('PostgreSQL binaries found (C:\\Program Files\\PostgreSQL\\<ver>\\bin)', false); finish(); process.exit(1) }
const bin = (x) => path.join(pgRoot, ver, 'bin', x)
const port = await new Promise(res => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)) }) })
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fsg-selftest-pg-snap-'))
const run = (exe, args, quiet = false) => spawnSync(bin(exe), args, quiet ? { stdio: 'ignore', timeout: 60000 } : { encoding: 'utf8', timeout: 120000 })
let started = false
const cleanup = () => { if (started) run('pg_ctl.exe', ['-D', dataDir, '-m', 'immediate', '-w', 'stop'], true); fs.rmSync(dataDir, { recursive: true, force: true }) }
try {
  let r = run('initdb.exe', ['-D', dataDir, '-U', 'selftest', '-A', 'trust', '-E', 'UTF8', '-N'])
  if (r.status !== 0) throw new Error('initdb failed: ' + (r.stderr || r.stdout))
  r = run('pg_ctl.exe', ['-D', dataDir, '-o', `-p ${port}`, '-l', path.join(dataDir, 'log.txt'), '-w', 'start'], true)
  if (r.status !== 0) throw new Error('pg_ctl start failed (status ' + r.status + ')')
  started = true
  process.chdir(srcRoot)
  const imp = (rel) => import(pathToFileURL(path.join(srcRoot, 'src', 'main', ...rel.split('/'))).href)
  const { initDB, query } = await imp('db/client.js')
  const { ensureSchema } = await imp('db/schema.js')
  await initDB({ host: 'localhost', port, database: 'postgres', user: 'selftest', password: '' })
  await ensureSchema()
  let H = null
  try { H = await imp('ipc/fs-snapshot.js') } catch (e) { ok('the publish handler exists (ipc/fs-snapshot.js)', false, e && e.message) }
  const cols = (await query(`SELECT column_name FROM information_schema.columns WHERE table_name='fs_snapshots'`)).rows.map(x => x.column_name)
  ok('the table has the columns Cloudtail reads: entity_id, entity_period_id, version, created_at, app_version, payload', ['entity_id', 'entity_period_id', 'version', 'created_at', 'app_version', 'payload'].every(c => cols.includes(c)), cols.join(','))
  if (H) {
    H.registerFsSnapshotHandlers()
    const ipc = (name, ...args) => globalThis.__ipc[name](null, ...args)
    const one = async (sql, p) => (await query(sql, p)).rows[0]
    const ent = await one(`INSERT INTO entities (name, constitution, constitution_display, business_type) VALUES ('ZZ Snap Co', 3, 'Company', 'Trader') RETURNING *`)
    const mkEp = async (label, from, till) => {
      const fp = (await one(`SELECT id FROM financial_periods WHERE date_from=$1 AND date_till=$2`, [from, till]))?.id
        || (await one(`INSERT INTO financial_periods (year_label, date_from, date_till) VALUES ($1,$2,$3) RETURNING id`, [label, from, till])).id
      return (await one(`INSERT INTO entity_periods (entity_id, financial_period_id) VALUES ($1,$2) RETURNING id`, [ent.id, fp])).id
    }
    const ep1 = await mkEp('2025-26', '2025-04-01', '2026-03-31'), ep2 = await mkEp('2024-25', '2024-04-01', '2025-03-31')
    const payload = goodPayload || { schema_version: 1, entity: {}, period: { date_from: '2025-04-01', date_till: '2026-03-31' }, balance_sheet: [{ code: 'BS.EL.TOTAL', label: 'x', cy: 1, py: 0 }], profit_and_loss: [{ code: 'PL.PAT', label: 'x', cy: 1, py: 0 }], notes: [], key_figures: {}, auditor_as_printed: {} }
    const v1 = await ipc('fsSnapshot:publish', ent.id, ep1, payload)
    const v2 = await ipc('fsSnapshot:publish', ent.id, ep1, { ...payload, share_capital: { classes: [{ marker: 'second' }] } })
    ok('publishing twice gives versions 1 and 2 for the same Financial Year', v1.version === 1 && v2.version === 2, JSON.stringify([v1, v2]))
    const other = await ipc('fsSnapshot:publish', ent.id, ep2, payload)
    ok('another Financial Year numbers its own versions from 1', other.version === 1)
    // Cloudtail's own read query (src/main/fsg/reader.js)
    const read = await one(`SELECT version, created_at, app_version, payload FROM fs_snapshots WHERE entity_period_id = $1 ORDER BY version DESC LIMIT 1`, [ep1])
    ok('Cloudtail\'s query returns the newest version, with the payload as a document', read.version === 2 && read.payload.schema_version === 1 && read.payload.share_capital.classes[0].marker === 'second' && Array.isArray(read.payload.balance_sheet) && !!read.created_at)
    const first = await one(`SELECT payload, created_by FROM fs_snapshots WHERE entity_period_id=$1 AND version=1`, [ep1])
    ok('the earlier version is kept unchanged, and who published it is recorded', !!first.payload.share_capital.classes[0] && first.payload.share_capital.classes[0].marker === undefined && !!first.created_by, first.created_by)
    const list = await ipc('fsSnapshot:list', ep1)
    ok('the list shows both versions, newest first', list.length === 2 && list[0].version === 2 && list[1].version === 1)
    const bad = async (p, id = ep1, e = ent.id) => { try { await ipc('fsSnapshot:publish', e, id, p); return null } catch (x) { return String(x.message || x) } }
    const eNoBs = await bad({ ...payload, balance_sheet: [] }), eNoKey = await bad({ ...payload, key_figures: undefined }), eVer = await bad({ ...payload, schema_version: 2 }), eNoPeriod = await bad(payload, null), eNothing = await bad(null)
    ok('a snapshot without Balance Sheet lines, without key figures, of an unknown layout, without a Financial Year, or empty is refused', [eNoBs, eNoKey, eVer, eNoPeriod, eNothing].every(Boolean), JSON.stringify([eNoBs, eNoKey, eVer, eNoPeriod, eNothing]))
    ok('...and nothing was written by the refused ones', (await one(`SELECT count(*)::int AS n FROM fs_snapshots`)).n === 3)
    await query(`DELETE FROM entities WHERE id=$1`, [ent.id])
    ok('deleting the auditee removes its snapshots', (await one(`SELECT count(*)::int AS n FROM fs_snapshots`)).n === 0)
  }
  const gf = fs.readFileSync(path.join(srcRoot, 'src', 'renderer', 'src', 'components', 'GenerateFinancials', 'index.jsx'), 'utf8')
  const pre = fs.readFileSync(path.join(srcRoot, 'src', 'preload', 'index.js'), 'utf8')
  ok('the preload exposes publishFsSnapshot and listFsSnapshots', /publishFsSnapshot:.*fsSnapshot:publish/.test(pre) && /listFsSnapshots:.*fsSnapshot:list/.test(pre))
  ok('Generate Financials: marking the year Final publishes the snapshot with the export, and a Publish to Cloudtail button publishes on demand', /publishNext\.current = true/.test(gf) && (gf.match(/publishSnapshotIfAsked\(data, noteDetailsMap\)/g) || []).length === 2 && /Publish to Cloudtail/.test(gf) && /buildFsSnapshotPayload\(/.test(gf) && /listEntityPeriods/.test(gf) && /periodInfo/.test(gf))
} catch (e) {
  ok('the checks ran to the end', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e))
} finally {
  cleanup()
  try { fs.rmSync(xlsxShim, { force: true }) } catch (_) {}
}
finish()
process.exit(fails ? 1 : 0)
