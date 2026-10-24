/**
 * Pre-release self-test: the Cash Flow Statement (0.1.95) - AS 3, indirect method.
 * Runs the app's real processRows on a Current Year and a Previous Year Trial Balance and builds the CFS from the resulting
 * Balance Sheet / P&L (src/renderer/src/utils/cashFlow.js): the Current Year column must come out right line by line and must
 * agree with the Balance Sheet's own cash (nothing left in "Difference to be explained"), for a Company and for a Proprietorship;
 * a typed Current Year figure replaces the drawn one and the difference row takes up the slack; the Previous Year column is
 * exactly what was typed and adds up; first-year entities (no Previous Year balances) are told so.
 * FSG_SRC_ROOT=<folder holding another src/> runs the same checks against that source.
 *   node tools/selftest-cashflow.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const srcRoot = process.env.FSG_SRC_ROOT ? path.resolve(process.env.FSG_SRC_ROOT) : root
const require = createRequire(import.meta.url)
const esbuild = require(path.join(root, 'node_modules', 'esbuild'))
let fails = 0
const ok = (what, cond, detail = '') => { if (!cond) fails++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond || !detail ? '' : '  -- ' + String(detail).slice(0, 500)}`) }
const near = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.5
console.log(`\nCash Flow Statement${srcRoot !== root ? `  (source: ${srcRoot})` : ''}`)

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
let mod
try {
  const out = await esbuild.build({
    stdin: { contents: `export { processRows, buildPrevMap } from ${S('hooks', 'useFinancials.js')}\nexport { buildCashFlow, CFS_LAYOUT } from ${S('utils', 'cashFlow.js')}\nexport { buildCfsWorkbook, parseCfsSheet, applyCfsUpload } from ${S('components', 'CFS', 'cfsWorkbook.js')}\nexport { buildFillDetailsWorkbook } from ${S('components', 'GenerateFinancials', 'fillDetailsWorkbook.js')}`, resolveDir: root, loader: 'js' },
    bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent', loader: { '.js': 'jsx', '.jsx': 'jsx' }, nodePaths: [path.join(root, 'node_modules')],
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" }, plugins: [reactShim],
  })
  const tmp = path.join(os.tmpdir(), `fsg-selftest-cfs-${process.pid}.mjs`)
  fs.writeFileSync(tmp, out.outputFiles[0].text)
  try { mod = await import(pathToFileURL(tmp).href) } finally { fs.rmSync(tmp, { force: true }) }
} catch (e) { ok('the Cash Flow code builds and loads', false, e && e.message); console.log('\n1 FAILURE(S) - release aborted\n'); process.exit(1) }
const { processRows, buildPrevMap, buildCashFlow } = mod
const { buildCfsWorkbook, parseCfsSheet, applyCfsUpload, buildFillDetailsWorkbook } = mod

function row(alie, level1, level2, closing, name) {
  return { alie, level1, mapping1_resultant: level1, level2, mapping2_resultant: level2, level3: null, mapping3_resultant: null, name, ledger_name: name, ledger_code: '',
    closing_balance: String(closing), opening_balance: '0', upload_nature: null, level5_value: null, stock_head: null, sort_order: 9999, status: 'auto_high', is_deemed_positive: closing < 0 }
}
// Dr negative / Cr positive, as stored. The bank balances the Trial Balance.
function tb(C, v) {
  const rows = [
    row('Income', 'Revenue from operations', 'Sale of products', v.sales, 'Sales'),
    row('Expenses', 'Other expenses', 'Rent', -v.rent, 'Rent'),
    row('Expenses', 'Depreciation and amortization expense', 'Depreciation', -v.dep, 'Depreciation'),
    row('Expenses', 'Finance costs', 'Interest expense', -v.fin, 'Interest on term loan'),
    row('Expenses', 'Tax expense', 'Current tax', -v.tax, 'Income tax'),
    row('Income', 'Other income', 'Interest income', v.interest, 'Interest on FD'),
    row('EQUITY AND LIABILITIES', C === 3 ? "Shareholders' funds" : "Owner's Fund", C === 3 ? 'Share capital' : "Owner's Capital", v.capital, 'Capital'),
    row('EQUITY AND LIABILITIES', 'Non-current liabilities', 'Long-term borrowings', v.ltb, 'Term loan'),
    row('EQUITY AND LIABILITIES', 'Current liabilities', 'Trade payables', v.tp, 'Creditors'),
    row('EQUITY AND LIABILITIES', 'Current liabilities', 'Other current liabilities', v.ocl, 'Statutory dues'),
    row('ASSETS', 'Non-current assets', 'Property, Plant and Equipment', -v.ppe, 'Plant and machinery'),
    row('ASSETS', 'Current assets', 'Inventories', -v.inv, 'Stock'),
    row('ASSETS', 'Current assets', 'Trade receivables', -v.tr, 'Debtors'),
    row('ASSETS', 'Current assets', 'Other current assets', -v.oca, 'Advances'),
  ]
  if (C === 3) rows.push(row('EQUITY AND LIABILITIES', "Shareholders' funds", 'Reserves and Surplus', v.reserves, 'Retained earnings'))
  let cr = 0, dr = 0
  for (const r of rows) { const n = parseFloat(r.closing_balance); if (n > 0) cr += n; else dr -= n }
  rows.push(row('ASSETS', 'Current assets', 'Cash and bank balances', -(cr - dr), 'Bank'))
  return rows
}
const PYv = { sales: 800000, rent: 300000, dep: 50000, fin: 20000, tax: 30000, interest: 10000, capital: 500000, reserves: 100000, ltb: 300000, tp: 120000, ocl: 40000, ppe: 700000, inv: 150000, tr: 200000, oca: 30000 }
const pyProfit = 800000 - 300000 - 50000 - 20000 - 30000 + 10000   // 410,000
const CYv = { sales: 1200000, rent: 400000, dep: 60000, fin: 25000, tax: 90000, interest: 15000, capital: 600000, reserves: 100000 + pyProfit - 50000, ltb: 250000, tp: 150000, ocl: 60000, ppe: 820000, inv: 190000, tr: 260000, oca: 45000 }
const cyProfit = 1200000 - 400000 - 60000 - 25000 - 90000 + 15000   // 640,000

for (const C of [3, 1]) {
  const label = C === 3 ? 'Company' : 'Proprietorship'
  console.log(`\n${label}`)
  // Non-corporate: the owner's capital carries the profit and the withdrawals; no reserves row
  const py = { ...PYv, capital: C === 3 ? PYv.capital : PYv.capital + PYv.reserves }
  const cy = { ...CYv, capital: C === 3 ? CYv.capital : CYv.capital + CYv.reserves }
  const data = processRows(tb(C, cy), buildPrevMap(tb(C, py)), C, [], 'Trader', false, false, null, [], null)
  ok('the P&L profit is what was set up', near(data.netProfit, cyProfit), data.netProfit)
  const r = buildCashFlow(data, {})
  const g = (id) => r.cy[id]
  ok('profit before tax = profit + tax', near(g('a_pbt'), cyProfit + 90000), g('a_pbt'))
  ok('depreciation, finance costs and interest income are adjusted', near(g('a_dep'), 60000) && near(g('a_fin'), 25000) && near(g('a_int'), -15000), JSON.stringify([g('a_dep'), g('a_fin'), g('a_int')]))
  ok('working capital: inventories, receivables, other assets, payables, other liabilities', near(g('w_inv'), -40000) && near(g('w_tr'), -60000) && near(g('w_oa'), -15000) && near(g('w_tp'), 30000) && near(g('w_ol'), 20000), JSON.stringify(['w_inv', 'w_tr', 'w_oa', 'w_tp', 'w_ol'].map(g)))
  ok('direct taxes paid', near(g('a_tax'), -90000), g('a_tax'))
  ok('net cash from operating activities = 6,45,000', near(g('t_op'), 645000), g('t_op'))
  ok('investing: fixed assets bought (net of depreciation) and interest received', near(g('b_ppe'), -180000) && near(g('b_int'), 15000) && near(g('t_inv'), -165000), JSON.stringify([g('b_ppe'), g('b_int'), g('t_inv')]))
  if (C === 3) ok('financing: share capital issued 1,00,000; dividend / other movement in reserves -50,000', near(g('c_sh'), 100000) && near(g('c_eq'), -50000), JSON.stringify([g('c_sh'), g('c_eq')]))
  else ok('financing: capital introduced 1,00,000 less drawings 50,000 in the owner capital = +50,000', near(g('c_eq'), 50000), g('c_eq'))
  ok('financing: borrowings repaid 50,000, finance costs paid 25,000', near(g('c_ltb'), -50000) && near(g('c_fin'), -25000), JSON.stringify([g('c_ltb'), g('c_fin')]))
  ok('net increase in cash = 4,55,000', near(g('t_net'), 455000), g('t_net'))
  ok('nothing is left in "Difference to be explained"', near(g('x_diff'), 0) && !r.rows.some(x => x.id === 'x_diff'), g('x_diff'))
  ok('cash at the end agrees with the Balance Sheet cash', r.checks.agrees && near(g('cash_close'), r.checks.closingCashBS), JSON.stringify(r.checks))
  ok('cash at the beginning is the Balance Sheet Previous Year cash', near(g('cash_open'), g('cash_close') - 455000), g('cash_open'))
  ok('the Previous Year column is empty until typed', r.rows.filter(x => x.kind === 'item').every(x => x.py === 0) && near(r.py.cash_close, 0))

  // a typed Current Year figure replaces the drawn one; the difference row picks up the slack
  const typed = buildCashFlow(data, { cy: { b_ppe: -200000 } })
  const tp = typed.rows.find(x => x.id === 'b_ppe')
  ok('a typed Current Year figure replaces the drawn one', near(typed.cy.b_ppe, -200000) && tp.typed === true && tp.drawn === -180000, JSON.stringify(tp))
  ok('...the totals follow and the difference is shown, so the cash still agrees with the Balance Sheet', near(typed.cy.t_inv, -185000) && near(typed.cy.x_diff, 20000) && typed.checks.agrees && typed.rows.some(x => x.id === 'x_diff'), JSON.stringify([typed.cy.t_inv, typed.cy.x_diff]))

  // the Previous Year column is what was typed
  const withPY = buildCashFlow(data, { py: { a_pbt: 500000, a_dep: 50000, w_inv: -20000, a_tax: -30000, b_ppe: -100000, c_ltb: 40000, cash_open: 10000 } })
  ok('Previous Year: operating = 500,000 + 50,000 - 20,000 - 30,000 = 5,00,000', near(withPY.py.t_op, 500000), withPY.py.t_op)
  ok('Previous Year: investing -1,00,000, financing 40,000, net 4,40,000, closing 4,50,000 (with 10,000 at the start)', near(withPY.py.t_inv, -100000) && near(withPY.py.t_fin, 40000) && near(withPY.py.t_net, 440000) && near(withPY.py.cash_close, 450000), JSON.stringify([withPY.py.t_inv, withPY.py.t_fin, withPY.py.t_net, withPY.py.cash_close]))
  ok('...and the Current Year column is unchanged by it', near(withPY.cy.t_net, 455000))
  ok('headings, captions and totals are not editable; every figure row is', withPY.rows.filter(x => x.kind !== 'item').every(x => !x.pyEditable && !x.cyEditable) && withPY.rows.filter(x => x.kind === 'item' && x.id !== 'x_diff').every(x => x.pyEditable))
}

console.log('\nRows added by the CA to an activity')
{
  const data = processRows(tb(3, CYv), buildPrevMap(tb(3, PYv)), 3, [], 'Trader', false, false, null, [], null)
  const base = buildCashFlow(data, {})
  const custom = [
    { id: 'a1', section: 'A', label: 'Advance written off', cy: -5000, py: 2000 },
    { id: 'b1', section: 'B', label: 'Loan given to director', cy: -20000, py: 0 },
    { id: 'c1', section: 'C', label: 'Security deposit received', cy: 7000, py: 1000 },
    { id: 'x1', section: 'Z', label: 'ignored: no such activity', cy: 999, py: 999 },
  ]
  const r = buildCashFlow(data, { custom })
  const ids = r.rows.map(x => x.id)
  ok('each added row sits in its own activity, just above that activity total', ids.indexOf('u_a1') === ids.indexOf('t_op') - 1 && ids.indexOf('u_b1') === ids.indexOf('t_inv') - 1 && ids.indexOf('u_c1') === ids.indexOf('t_fin') - 1, ids.join(','))
  ok('an added row for an activity that does not exist is ignored', !ids.includes('u_x1'))
  ok('operating, investing and financing totals take the added figures (Current Year)', near(r.cy.t_op, base.cy.t_op - 5000) && near(r.cy.t_inv, base.cy.t_inv - 20000) && near(r.cy.t_fin, base.cy.t_fin + 7000), JSON.stringify([r.cy.t_op, r.cy.t_inv, r.cy.t_fin]))
  ok('...and so does the net increase in cash: 4,55,000 - 5,000 - 20,000 + 7,000 = 4,37,000', near(r.cy.t_net, 437000), r.cy.t_net)
  ok('...the closing cash moves with them (18,000 less) and the statement flags that it no longer agrees with the Balance Sheet; no difference line is invented', near(r.cy.cash_close, base.cy.cash_close - 18000) && r.checks.agrees === false && near(r.cy.x_diff, 0) && !r.rows.some(x => x.id === 'x_diff'), JSON.stringify([r.cy.x_diff, r.cy.cash_close, base.cy.cash_close, r.checks.agrees]))
  ok('Previous Year totals take them too', near(r.py.t_op, 2000) && near(r.py.t_fin, 1000) && near(r.py.t_net, 3000), JSON.stringify([r.py.t_op, r.py.t_fin, r.py.t_net]))
  const row = r.rows.find(x => x.id === 'u_a1')
  ok('an added row is editable in both years, carries its label, and is marked as added', row.custom === true && row.cyEditable && row.pyEditable && row.label === 'Advance written off' && row.cy === -5000 && row.py === 2000)
  ok('a row with no description reads "Other (specify)"', buildCashFlow(data, { custom: [{ id: 'q', section: 'A', label: '  ', cy: 1, py: 0 }] }).rows.find(x => x.id === 'u_q').label === 'Other (specify)')
  const gone = buildCashFlow(data, { custom: [] })
  ok('removing the rows takes the figures out again', near(gone.cy.t_net, base.cy.t_net) && near(gone.cy.x_diff, 0) && !gone.rows.some(x => x.custom))
  ok('a Current Year figure typed over a drawn line and an added row work together', (() => { const m = buildCashFlow(data, { cy: { b_ppe: -200000 }, custom: [custom[1]] }); return near(m.cy.t_inv, base.cy.t_inv - 20000 - 20000) && near(m.cy.x_diff, 20000) && near(m.cy.cash_close, base.cy.cash_close - 20000) })())
}

console.log('\nCFS in Excel (the CFS tab Filled Excel and the Fill Details workbook of the Notes tab)')
try {
  const XLSXR = require(path.join(root, 'node_modules', 'xlsx-js-style'))
  const data = processRows(tb(3, CYv), buildPrevMap(tb(3, PYv)), 3, [], 'Trader', false, false, null, [], null)
  const savedIn = { cy: { b_ppe: -200000 }, py: { a_dep: 12500, cash_open: 4000 }, custom: [{ id: 'k1', section: 'A', label: 'Advance written off', cy: -5000, py: 2000 }], include: true }
  const rowsIn = buildCashFlow(data, savedIn).rows
  const wb = buildCfsWorkbook(rowsIn)
  const aoa = XLSXR.utils.sheet_to_json(wb.Sheets['CFS'], { header: 1, defval: '' })
  const find = (id) => aoa.findIndex(r => r[3] === id)
  ok('the sheet has the headings, a Row ID on every figure row, and none on totals', /Row ID/.test(aoa[3][3]) && find('a_dep') > 3 && find('w_inv') > 3 && find('u_k1') > 3 && !aoa.some(r => /^Net cash from/.test(r[0]) && r[3]))
  ok('it carries the Current Year as the app shows it (typed over, drawn) and the typed Previous Year', aoa[find('b_ppe')][1] === -200000 && aoa[find('a_dep')][1] === 60000 && aoa[find('a_dep')][2] === 12500 && aoa[find('u_k1')][1] === -5000 && aoa[find('u_k1')][2] === 2000, JSON.stringify([aoa[find('b_ppe')], aoa[find('a_dep')], aoa[find('u_k1')]]))
  ok('one "New row" line per activity', ['new:A', 'new:B', 'new:C'].every(id => find(id) > 3))

  const parsed = parseCfsSheet(wb)
  const again = applyCfsUpload(parsed, rowsIn, savedIn)
  ok('uploading it unchanged changes nothing', again.changed === 0 && JSON.stringify(again.saved.cy) === JSON.stringify(savedIn.cy) && JSON.stringify(again.saved.py) === JSON.stringify(savedIn.py) && again.saved.custom.length === 1 && again.saved.custom[0].id === 'k1' && again.saved.custom[0].cy === -5000, JSON.stringify(again))

  // edit the sheet as a person would
  const ws = wb.Sheets['CFS']
  const cell = (id, col) => XLSXR.utils.encode_cell({ r: find(id), c: col })
  ws[cell('w_inv', 1)] = { t: 'n', v: -77777 }      // overwrite a Current Year figure
  ws[cell('w_inv', 2)] = { t: 'n', v: 300 }         // Previous Year
  ws[cell('a_dep', 2)] = { t: 's', v: '' }          // clear a Previous Year figure
  ws[cell('b_ppe', 1)] = { t: 'n', v: -180000 }     // back to the drawn figure: the overwrite goes
  ws[cell('new:B', 0)] = { t: 's', v: 'FD interest accrued' }; ws[cell('new:B', 1)] = { t: 'n', v: 1000 }; ws[cell('new:B', 2)] = { t: 's', v: '(500)' }
  ws[cell('u_k1', 0)] = { t: 's', v: 'Advance written off (edited)' }; ws[cell('u_k1', 1)] = { t: 'n', v: -6000 }
  const edited = applyCfsUpload(parseCfsSheet(wb), rowsIn, savedIn)
  const sv = edited.saved
  ok('Current Year: a figure that differs from the drawn one is saved as an overwrite; one set back to the drawn figure clears it', sv.cy.w_inv === -77777 && !('b_ppe' in sv.cy), JSON.stringify(sv.cy))
  ok('Previous Year: typed figures are saved, a cleared cell clears it', sv.py.w_inv === 300 && !('a_dep' in sv.py) && sv.py.cash_open === 4000, JSON.stringify(sv.py))
  ok('rows: a "New row" line becomes a row of that activity (brackets read as negative); an edited added row keeps its place', sv.custom.length === 2 && sv.custom.some(c => c.section === 'B' && c.label === 'FD interest accrued' && c.cy === 1000 && c.py === -500) && sv.custom.some(c => c.id === 'k1' && c.label === 'Advance written off (edited)' && c.cy === -6000), JSON.stringify(sv.custom))
  ok('...and the statement drawn from what was uploaded shows it', (() => { const r = buildCashFlow(data, sv); return near(r.cy.w_inv, -77777) && r.rows.some(x => x.label === 'FD interest accrued' && x.cy === 1000) })())
  // delete the added row: blank its Row ID
  const del = XLSXR.utils.sheet_to_json(wb.Sheets['CFS'], { header: 1, defval: '' }); void del
  ws[cell('u_k1', 3)] = { t: 's', v: '' }
  ok('an added row left out of the sheet is removed', !applyCfsUpload(parseCfsSheet(wb), rowsIn, savedIn).saved.custom.some(c => c.id === 'k1'))

  const blank = buildCfsWorkbook(buildCashFlow(data, {}).rows, { blank: true })
  ok('a blank template has the layout and no figures, and uploading it changes nothing', parseCfsSheet(blank).any === false && parseCfsSheet(blank).entries.length > 20)
  ok('a workbook without a CFS sheet is not touched', parseCfsSheet(XLSXR.utils.book_new()) === null)

  const fd = buildFillDetailsWorkbook([], new Map(), null, { constitution: 3, cfsRows: rowsIn })
  ok('the Fill Details workbook (Notes tab Filled Template) carries the CFS sheet', fd.SheetNames.includes('CFS') && parseCfsSheet(fd).entries.some(e => e.id === 'u_k1'), JSON.stringify(fd.SheetNames))
  const fdb = buildFillDetailsWorkbook([], new Map(), null, { constitution: 3, blank: true, cfsRows: buildCashFlow(data, {}).rows })
  ok('...and the Blank Template carries it empty', fdb.SheetNames.includes('CFS') && parseCfsSheet(fdb).any === false)
  const notes = fs.readFileSync(path.join(srcRoot, 'src', 'renderer', 'src', 'components', 'Notes', 'index.jsx'), 'utf8')
  ok('the Notes tab downloads it (Blank and Filled) and applies it on upload', (notes.match(/cfsRows/g) || []).length >= 4 && /applyCfsUpload\(/.test(notes) && /saveCfs\??\.?\(/.test(notes))
  const cfsTab = fs.readFileSync(path.join(srcRoot, 'src', 'renderer', 'src', 'components', 'CFS', 'index.jsx'), 'utf8')
  ok('the CFS tab has its own Filled Excel download and Upload', /Filled Excel/.test(cfsTab) && /Upload Excel/.test(cfsTab) && /applyCfsUpload\(/.test(cfsTab))
  ok('the CFS tab can recompute: typed Current Year figures are discarded, Previous Year kept, added rows kept unless asked', /Recompute/.test(cfsTab) && /persist\(\{ \.\.\.saved, cy: \{\}, custom: alsoRows \? \[\] : \(saved\.custom \|\| \[\]\), hidden: alsoRows \? \[\] : \(saved\.hidden \|\| \[\]\) \}\)/.test(cfsTab))
  // what recomputing does to the figures: drawn again, typed Previous Year and added rows untouched
  const rc = buildCashFlow(data, { ...savedIn, cy: {} })
  ok('...and the statement then shows the drawn figures again (no overwrite left), with the Previous Year and the added row as typed', rc.rows.find(x => x.id === 'b_ppe').typed === false && near(rc.cy.b_ppe, -180000) && rc.py.a_dep === 12500 && rc.rows.some(x => x.id === 'u_k1'))

  // Rows added inside the sub-segments of operating activities, and rows deleted
  console.log('\nRows inside "Adjustments for:" / working capital, and deleted rows')
  const base = buildCashFlow(data, savedIn)
  const idx = (r, id) => r.rows.findIndex(x => x.id === id)
  const sub = buildCashFlow(data, { ...savedIn, custom: [...(savedIn.custom || []), { id: 'z1', section: 'A1', label: 'Provision written back', cy: 7000, py: 3000 }, { id: 'z2', section: 'A2', label: 'Change in deposits', cy: -2000, py: 500 }] })
  ok('a row under "Adjustments for:" sits above Operating profit before working capital changes, and is counted in it', idx(sub, 'u_z1') >= 0 && idx(sub, 'u_z1') < idx(sub, 's_opbwc') && idx(sub, 'u_z1') > idx(sub, 'h_adj') && near(sub.cy.s_opbwc - base.cy.s_opbwc, 7000) && near(sub.py.s_opbwc - base.py.s_opbwc, 3000))
  ok('a row under working capital sits above Cash generated from operations, and is counted in it', idx(sub, 'u_z2') >= 0 && idx(sub, 'u_z2') < idx(sub, 's_cgo') && idx(sub, 'u_z2') > idx(sub, 'h_wc') && near(sub.cy.s_cgo - base.cy.s_cgo, 5000) && near(sub.py.s_cgo - base.py.s_cgo, 3500))
  ok('both flow to the operating total and the net cash; the closing cash moves with them', near(sub.cy.t_op - base.cy.t_op, 5000) && near(sub.cy.t_net - base.cy.t_net, 5000) && near(sub.cy.cash_close - base.cy.cash_close, 5000))
  ok('the difference line is not changed by rows added (they are not absorbed)', near((sub.cy.x_diff || 0), (base.cy.x_diff || 0)))
  const hid = buildCashFlow(data, { ...savedIn, hidden: ['w_tr'] })
  ok('a deleted row is not in the statement and its figure leaves every total', idx(hid, 'w_tr') < 0 && near(base.cy.s_cgo - hid.cy.s_cgo, base.cy.w_tr) && hid.hiddenRows.length === 1 && hid.hiddenRows[0].id === 'w_tr')
  ok('deleting a row does not turn its figure into a "difference"', near(hid.cy.x_diff || 0, base.cy.x_diff || 0))
  const hidPy = buildCashFlow(data, { ...savedIn, py: { ...(savedIn.py || {}), w_tr: 9999 }, hidden: ['w_tr'] })
  ok('its Previous Year figure leaves the totals too', near(hidPy.py.s_cgo, hid.py.s_cgo))
  const repl = buildCashFlow(data, { ...savedIn, hidden: ['w_tr'], custom: [...(savedIn.custom || []), { id: 'z3', section: 'A2', label: 'Increase in debtors (net of provisions)', cy: base.cy.w_tr, py: base.py.w_tr }] })
  ok('the same item put in a row of the CA\'s own, with the default row deleted, gives the same totals as before', near(repl.cy.t_op, base.cy.t_op) && near(repl.cy.t_net, base.cy.t_net) && near(repl.py.t_op, base.py.t_op))
  const bad = buildCashFlow(data, { ...savedIn, hidden: ['a_pbt', 'cash_open', 'x_diff', 't_op', 'nonsense'] })
  ok('only a figure row can be deleted - not profit before tax, opening cash, the difference line or a total', bad.hiddenRows.length === 0 && idx(bad, 'a_pbt') >= 0 && idx(bad, 'cash_open') >= 0 && idx(bad, 't_op') >= 0)
  ok('un-deleting brings the row and its figures back', near(buildCashFlow(data, { ...savedIn, hidden: [] }).cy.s_cgo, base.cy.s_cgo))
  const cfsIpc = fs.readFileSync(path.join(srcRoot, 'src', 'main', 'ipc', 'cfs.js'), 'utf8')
  ok('the save keeps the sub-segment rows and the deleted-row list', /\(A1\|A2\|A\|B\|C\)/.test(cfsIpc) && /hidden: \[\]/.test(cfsIpc) && /clean\.hidden\.push/.test(cfsIpc))
  ok('the CFS tab has Add-a-row buttons for both sub-segments, a delete on rows, and a restore list', /s_opbwc: \['A1'/.test(cfsTab) && /s_cgo: \['A2'/.test(cfsTab) && /deleteRow\(r\.id\)/.test(cfsTab) && /restoreRow/.test(cfsTab))
  const wbk = fs.readFileSync(path.join(srcRoot, 'src', 'renderer', 'src', 'components', 'CFS', 'cfsWorkbook.js'), 'utf8')
  ok('the Excel upload knows the sub-segment rows and keeps the deleted list', /s_opbwc: 'A1'/.test(wbk) && /\(A1\|A2\|A\|B\|C\)/.test(wbk) && /hidden: \[\.\.\.\(saved\?\.hidden/.test(wbk))
} catch (e) {
  ok('the CFS Excel checks ran', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e))
}

console.log('\nComponents of cash and cash equivalents (AS 3)')
try {
  // the Balance Sheet cash made of four ledgers: cash in hand, a bank current account, a fixed deposit, cheques in hand
  const mkRows = () => {
    const rows = tb(3, CYv)
    const bank = rows.find(r => r.name === 'Bank')
    const total = -parseFloat(bank.closing_balance)
    const mk = (name, amt) => ({ ...bank, name, ledger_name: name, closing_balance: String(-amt) })
    rows.splice(rows.indexOf(bank), 1, mk('Cash in hand', 20000), mk('HDFC Bank current account', total - 125000), mk('SBI Fixed Deposit (3 months)', 100000), mk('Cheques in hand', 5000))
    return rows
  }
  const data = processRows(mkRows(), buildPrevMap(tb(3, PYv)), 3, [], 'Trader', false, false, null, [], null)
  const r = buildCashFlow(data, {})
  const cc = r.cc, by = (id) => cc.rows.find(x => x.id === id)
  ok('the components are drawn from the ledgers of the Cash and cash equivalents line', near(by('cc_cash').cy, 20000) && near(by('cc_dep').cy, 100000) && near(by('cc_oth').cy, 5000) && near(by('cc_bank').cy, cc.bsCY - 125000), JSON.stringify(cc.items.map(x => [x.id, x.cy])))
  ok('they add up to the Balance Sheet cash: no difference', near(cc.totalCY, cc.bsCY) && near(cc.diffCY, 0) && near(cc.bsCY, r.checks.closingCashBS))
  ok('the Previous Year is empty until typed, and then no difference is claimed', cc.rows.every(x => x.py === 0) && near(cc.diffPY, 0))
  const typed = buildCashFlow(data, { cy: { cc_cash: 30000 }, py: { cc_cash: 10000, cc_bank: 50000 }, ccNote: 'FD of 50,000 under lien' })
  ok('a figure typed over a component replaces the drawn one and is marked; the difference to the Balance Sheet is shown', typed.cc.rows.find(x => x.id === 'cc_cash').typed === true && near(typed.cc.totalCY, cc.bsCY + 10000) && near(typed.cc.diffCY, 10000), JSON.stringify([typed.cc.totalCY, typed.cc.diffCY]))
  ok('Previous Year components are the typed ones, reconciled to the Balance Sheet Previous Year cash', near(typed.cc.totalPY, 60000) && near(typed.cc.diffPY, 60000 - typed.cc.bsPY))
  ok('the note on balances not available for use is carried', typed.cc.note === 'FD of 50,000 under lien' && typed.cc.restricted.id === 'cc_restricted')

  // PDF and Excel
  const XLSXR = require(path.join(root, 'node_modules', 'xlsx'))
  const wbLF = XLSXR.readFile(path.join(srcRoot, 'Mapping_v2.xlsx'))
  const LF = XLSXR.utils.sheet_to_json(wbLF.Sheets.LevelFormat, { defval: null }).map((q, i) => ({
    id: i + 1, constitution: parseInt(q['Constitution']), alie: q['ALIE'], level1: q['Level 1'], level2: q['Level 2'], level3: q['Level 3'],
    level4: q['Level 4'], level5: q['Level 5'], level6: q['Level 6'], level7: q['Level 7'], sort_order: i,
  })).filter(q => q.constitution === 3)
  const o = await esbuild.build({
    stdin: { contents: `export { fetchFinancialsData } from ${S('hooks', 'useFinancials.js')}\nexport { buildFinancialsHTML } from ${S('components', 'GenerateFinancials', 'buildHTML.js')}\nexport { buildFinancialsWorkbook } from ${S('components', 'GenerateFinancials', 'buildExcel.js')}`, resolveDir: root, loader: 'js' },
    bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent', loader: { '.js': 'jsx', '.jsx': 'jsx' }, nodePaths: [path.join(root, 'node_modules')],
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" }, plugins: [reactShim],
  })
  const f = path.join(os.tmpdir(), `fsg-selftest-cc-${process.pid}.mjs`)
  fs.writeFileSync(f, o.outputFiles[0].text)
  let B; try { B = await import(pathToFileURL(f).href) } finally { fs.rmSync(f, { force: true }) }
  const full = (q) => ({ ...q, level4_value: null, level5_value: null, level6_value: null, level7_value: null, status: 'user_approved' })
  const entity = { id: 1, name: 'Cash Flow Test Pvt Ltd', constitution: 3, constitution_display: 'Company', business_type: 'Trader' }
  const activeTB = { id: 1, period: '2025-04-01 To 2026-03-31', entity_period_id: 5 }, prevTB = { id: 2, period: '2024-04-01 To 2025-03-31' }
  globalThis.window = { api: {
    getFinancialData: async (id) => (id === 1 ? mkRows().map(full) : id === 2 ? tb(3, PYv).map(full) : []), getLevelFormat: async () => LF.map(q => ({ ...q })),
    listNoteDetails: async () => [], depGet: async () => null, depITGet: async () => null, depCompGet: async () => null,
    getManualPY: async () => false, listManualPyEntries: async () => [], getPlClosedToCapital: async () => false, getGeneralNotes: async () => null, getEps: async () => null,
    getCfs: async () => ({ cy: {}, py: { cc_cash: 12000, cc_bank: 40000 }, custom: [], include: true, ccNote: 'FD under lien' }),
  } }
  const d2 = await B.fetchFinancialsData(activeTB, prevTB, entity, null)
  const pdf = B.buildFinancialsHTML({ entity, activeTB, prevTB, data: d2, auditor: null, signatories: [], signPlace: 'X', signDate: '2026-10-05' }).replace(/<template[\s\S]*?<\/template>/g, '')
  if (process.env.FSG_DUMP_PDF) fs.writeFileSync(process.env.FSG_DUMP_PDF, pdf)   // for looking at the page layout
  const t = pdf.replace(/<[^>]+>/g, '\n').replace(/&amp;/g, '&').split('\n').map(x => x.trim()).filter(Boolean)
  const iC = t.findIndex(x => x === 'Cash on hand'), iD = t.findIndex(x => /^Deposits with banks with an original maturity/.test(x))
  ok('PDF: the components are printed under the Cash Flow Statement with their figures (Current Year and typed Previous Year)', iC > 0 && t[iC + 1] === '20,000.00' && t[iC + 2] === '12,000.00' && iD > iC && t[iD + 1] === '1,00,000.00', JSON.stringify(t.slice(iC - 1, iC + 3)))
  const iT = t.findIndex((x, i) => i > iC && x === 'Cash and cash equivalents as per the Balance Sheet')
  ok('PDF: followed by the total, and the note on balances not available for use', iT > iC && /FD under lien/.test(pdf), JSON.stringify(t.slice(iT, iT + 3)))
  const wb = B.buildFinancialsWorkbook({ entity, activeTB, prevTB, data: d2, levelFormat: LF, auditor: null, signatories: [], signPlace: 'X', signDate: '2026-10-05' })
  const grid = XLSXR.utils.sheet_to_json(wb.Sheets['Cash Flow'], { header: 1, defval: '' })
  const gh = grid.findIndex(x => /^Components of cash and cash equivalents/.test(String(x[0])))
  const gt = grid.findIndex((x, i) => i > gh && /as per the Balance Sheet/.test(String(x[0])))
  ok('Excel: the components table is on the Cash Flow sheet, its total a live SUM that agrees with the figures', gh > 0 && gt > gh && near(grid[gt][1], d2.assetSections.flatMap(s => s.lines).filter(l => /cash/i.test(l.level2)).reduce((a, l) => a + l.total, 0)) && !!wb.Sheets['Cash Flow'][XLSXR.utils.encode_cell({ r: gt, c: 1 })].f, JSON.stringify([grid[gh], grid[gt]]))
  ok('Excel: its own link check finds nothing to repair', Array.isArray(wb.linkRepairs) && wb.linkRepairs.length === 0, JSON.stringify(wb.linkRepairs))

  // the Excel round trip (CFS sheet) carries the components
  const { buildCfsWorkbook, parseCfsSheet, applyCfsUpload } = mod
  const wbc = buildCfsWorkbook(r.rows, { cc: r.cc })
  const pc = parseCfsSheet(wbc)
  ok('the CFS sheet in Excel carries the component rows with Row IDs', ['cc_cash', 'cc_bank', 'cc_dep', 'cc_oth', 'cc_restricted'].every(id => pc.entries.some(e => e.id === id)))
  const up = applyCfsUpload(pc, [...r.rows, ...r.cc.rows], { cy: {}, py: {}, custom: [] })
  ok('...and uploading it unchanged saves nothing new', up.changed === 0 && Object.keys(up.saved.cy).length === 0, JSON.stringify(up))
  const ws2 = wbc.Sheets['CFS']
  const rowOf = (id) => XLSXR.utils.sheet_to_json(ws2, { header: 1, defval: '' }).findIndex(x => x[3] === id)
  ws2[XLSXR.utils.encode_cell({ r: rowOf('cc_cash'), c: 1 })] = { t: 'n', v: 25000 }
  ws2[XLSXR.utils.encode_cell({ r: rowOf('cc_cash'), c: 2 })] = { t: 'n', v: 11000 }
  const up2 = applyCfsUpload(parseCfsSheet(wbc), [...r.rows, ...r.cc.rows], { cy: {}, py: {}, custom: [] })
  ok('...and a component edited in Excel is saved (Current Year as an overwrite, Previous Year as typed)', up2.saved.cy.cc_cash === 25000 && up2.saved.py.cc_cash === 11000, JSON.stringify(up2.saved))
  const tab = fs.readFileSync(path.join(srcRoot, 'src', 'renderer', 'src', 'components', 'CFS', 'index.jsx'), 'utf8')
  ok('the CFS tab shows the components table under the statement, with the reconciliation to the Balance Sheet', /Components of cash and cash equivalents \(AS 3\)/.test(tab) && /as per the Balance Sheet/.test(tab) && /Difference to be explained/.test(tab))
} catch (e) {
  ok('the component checks ran', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e))
}

console.log('\nFirst year (no Previous Year balances)')
{
  const first = processRows(tb(3, CYv), null, 3, [], 'Trader', false, false, null, [], null)
  const r = buildCashFlow(first, {})
  ok('the statement says no Previous Year balances were available', r.checks.noPreviousBalances === true)
  ok('it still builds, and its cash agrees with the Balance Sheet', r.checks.agrees, JSON.stringify(r.checks))
}
console.log('\nNo data')
ok('an empty set of statements gives an all-zero statement, not an error', (() => { try { const r = buildCashFlow({}, null); return r.rows.length > 20 && near(r.cy.t_net, 0) } catch (e) { return false } })())

console.log('\nPDF and Excel (the real fetchFinancialsData, buildFinancialsHTML and buildFinancialsWorkbook)')
try {
  const XLSXR = require(path.join(root, 'node_modules', 'xlsx'))
  const XLSXS = require(path.join(root, 'node_modules', 'xlsx-js-style'))
  const load = async (rel) => {
    const o = await esbuild.build({
      stdin: { contents: `export * from ${JSON.stringify(path.join(srcRoot, ...rel.split('/')))}`, resolveDir: root, loader: 'js' },
      bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent', loader: { '.js': 'jsx', '.jsx': 'jsx' }, nodePaths: [path.join(root, 'node_modules')],
      banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" }, plugins: [reactShim],
    })
    const f = path.join(os.tmpdir(), `fsg-selftest-cfs-x-${process.pid}-${Math.random().toString(36).slice(2, 6)}.mjs`)
    fs.writeFileSync(f, o.outputFiles[0].text)
    try { return await import(pathToFileURL(f).href) } finally { fs.rmSync(f, { force: true }) }
  }
  const wbLF = XLSXR.readFile(path.join(srcRoot, 'Mapping_v2.xlsx'))
  const LF = XLSXR.utils.sheet_to_json(wbLF.Sheets.LevelFormat, { defval: null }).map((r, i) => ({
    id: i + 1, constitution: parseInt(r['Constitution']), alie: r['ALIE'], level1: r['Level 1'], level2: r['Level 2'], level3: r['Level 3'],
    level4: r['Level 4'], level5: r['Level 5'], level6: r['Level 6'], level7: r['Level 7'], sort_order: i,
  })).filter(r => r.constitution === 3)
  const full = (r) => ({ ...r, level4_value: null, level5_value: null, level6_value: null, level7_value: null, status: 'user_approved' })
  const fin = await load('src/renderer/src/hooks/useFinancials.js')
  const htmlM = await load('src/renderer/src/components/GenerateFinancials/buildHTML.js')
  const xl = await load('src/renderer/src/components/GenerateFinancials/buildExcel.js')
  const entity = { id: 1, name: 'Cash Flow Test Pvt Ltd', constitution: 3, constitution_display: 'Company', business_type: 'Trader' }
  const activeTB = { id: 1, period: '2025-04-01 To 2026-03-31', entity_period_id: 5 }, prevTB = { id: 2, period: '2024-04-01 To 2025-03-31' }
  const run = async (cfsSaved) => {
    globalThis.window = { api: {
      getFinancialData: async (id) => (id === 1 ? tb(3, CYv).map(full) : id === 2 ? tb(3, PYv).map(full) : []), getLevelFormat: async () => LF.map(r => ({ ...r })),
      listNoteDetails: async () => [], depGet: async () => null, depITGet: async () => null, depCompGet: async () => null,
      getManualPY: async () => false, listManualPyEntries: async () => [], getPlClosedToCapital: async () => false, getGeneralNotes: async () => null, getEps: async () => null,
      getCfs: async () => cfsSaved,
    } }
    const data = await fin.fetchFinancialsData(activeTB, prevTB, entity, null)
    const pdf = htmlM.buildFinancialsHTML({ entity, activeTB, prevTB, data, auditor: null, signatories: [], signPlace: 'X', signDate: '2026-10-05' }).replace(/<template[\s\S]*?<\/template>/g, '')
    const wb = xl.buildFinancialsWorkbook({ entity, activeTB, prevTB, data, levelFormat: LF, auditor: null, signatories: [], signPlace: 'X', signDate: '2026-10-05' })
    return { data, pdf, wb, text: pdf.replace(/<[^>]+>/g, '\n').replace(/&amp;/g, '&').split('\n').map(s => s.trim()).filter(Boolean) }
  }
  const off = await run(null)
  ok('not ticked: no Cash Flow page in the PDF and no sheet in the Excel', !/Cash Flow Statement/.test(off.pdf) && !off.wb.SheetNames.includes('Cash Flow'), JSON.stringify(off.wb.SheetNames))
  const on = await run({ cy: {}, py: { a_pbt: 500000, a_dep: 50000, cash_open: 10000 }, include: true })
  const t = on.text
  const at = t.findIndex(s => /^Net cash from \/ \(used in\) operating activities \(A\)$/.test(s))
  ok('ticked: the PDF has the Cash Flow Statement page, with operating cash 6,45,000 in the Current Year column and 5,50,000 typed for the Previous Year', /Cash Flow Statement/.test(on.pdf) && at >= 0 && t[at + 1] === '6,45,000.00' && t[at + 2] === '5,50,000.00', JSON.stringify(t.slice(Math.max(0, at - 1), at + 4)))
  const iCF = on.pdf.indexOf('Cash Flow Statement'), iPL = on.pdf.search(/Statement of Profit and Loss/), iNotes = on.pdf.search(/NOTES TO FINANCIAL STATEMENTS|Notes to Financial Statements/)
  ok('...placed after the Profit & Loss', iPL >= 0 && iCF > iPL, JSON.stringify([iPL, iCF]))
  const endAt = t.findIndex(s => /^Cash and cash equivalents at the end of the year$/.test(s))
  ok('...and ending at the Balance Sheet cash', endAt >= 0 && t[endAt + 1] === on.data.assetSections.flatMap(s => s.lines).filter(l => /cash/i.test(l.level2)).map(l => Math.round(l.total)).map(n => n.toLocaleString('en-IN') + '.00')[0], JSON.stringify(t.slice(endAt, endAt + 3)))
  ok('Excel: a Cash Flow sheet after Profit & Loss', on.wb.SheetNames.indexOf('Cash Flow') === on.wb.SheetNames.indexOf('Profit & Loss') + 1, JSON.stringify(on.wb.SheetNames))
  const ws = on.wb.Sheets['Cash Flow']
  const grid = XLSXR.utils.sheet_to_json(ws, { header: 1, defval: '' })
  const r = (rx) => grid.find(x => rx.test(String(x[0]).trim()))
  ok('Excel: operating cash 6,45,000 (Current Year) and 5,50,000 (Previous Year)', near((r(/operating activities \(A\)/) || [])[1], 645000) && near((r(/operating activities \(A\)/) || [])[2], 550000), JSON.stringify(r(/operating activities \(A\)/)))
  const fcells = Object.keys(ws).filter(k => /^[BC]\d+$/.test(k) && ws[k].f)
  ok('Excel: the subtotals are live formulas', fcells.length >= 10 && fcells.every(k => /^([BC]\d+(\+[BC]\d+)*|SUM\([BC]\d+:[BC]\d+\))$/.test(ws[k].f)), JSON.stringify(fcells.slice(0, 4).map(k => [k, ws[k].f])))
  ok('Excel: its own link check finds nothing to repair', Array.isArray(on.wb.linkRepairs) && on.wb.linkRepairs.length === 0, JSON.stringify(on.wb.linkRepairs))
  const wr = await run({ cy: {}, py: {}, custom: [{ id: 'z1', section: 'A', label: 'Advance written off', cy: -5000, py: 2000 }], include: true })
  const wt = wr.text, wat = wt.findIndex(s => /^Net cash from \/ \(used in\) operating activities \(A\)$/.test(s)), wrow = wt.findIndex(s => s === 'Advance written off')
  ok('an added row is printed in the PDF, in its activity, and the activity total includes it (6,40,000 / 2,000)', wrow >= 0 && wrow < wat && wt[wat + 1] === '6,40,000.00' && wt[wat + 2] === '2,000.00', JSON.stringify([wt[wrow + 1], wt[wat + 1], wt[wat + 2]]))
  const wgrid = XLSXR.utils.sheet_to_json(wr.wb.Sheets['Cash Flow'], { header: 1, defval: '' })
  const wx = wgrid.find(x => String(x[0]).trim() === 'Advance written off'), wtot = wgrid.find(x => /operating activities \(A\)/.test(String(x[0])))
  ok('Excel: the added row is there, the total is a live formula that includes it, and the link check is clean', !!wx && near(wx[1], -5000) && near(wtot[1], 640000) && Array.isArray(wr.wb.linkRepairs) && wr.wb.linkRepairs.length === 0, JSON.stringify([wx, wtot, wr.wb.linkRepairs]))
  void XLSXS
} catch (e) {
  ok('the PDF / Excel checks ran', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e))
}

console.log(fails ? `\n${fails} FAILURE(S) - release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
