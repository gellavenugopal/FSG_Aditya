/**
 * Pre-release self-test (0.1.115): the ITR BS / Manufacturing / Trading / P&L and their Details are filled from the financial statements for
 * every constitution (Individual / Proprietorship, Partnership / LLP, Company).
 *   node tools/selftest-itr-pull.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const require = createRequire(import.meta.url)
const esbuild = require(path.join(root, 'node_modules', 'esbuild'))
let fails = 0
const ok = (what, cond, d = '') => { if (!cond) fails++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond ? '' : '  -- ' + d}`) }
const near = (a, b) => Math.abs(a - b) < 0.01
console.log('\nITR pull from the financial statements')

const S = (...p) => JSON.stringify(path.join(root, 'src/renderer/src', ...p).replace(/\\/g, '/'))
const reactShim = { name: 'react-shim', setup(b) { b.onResolve({ filter: /^react(\/.*)?$/ }, () => ({ path: 'react', namespace: 'shim' })); b.onLoad({ filter: /.*/, namespace: 'shim' }, () => ({ contents: 'export default {}; export const useState = () => []; export const useEffect = () => {}; export const useMemo = (f) => f(); export const useCallback = (f) => f; export const useRef = () => ({ current: null })', loader: 'js' })) } }
const r = await esbuild.build({
  stdin: { contents: `
    export { pullITRFromFinancials, resolvePlacements, PLACE } from ${S('utils', 'itrPull.js')}
    export { buildRowIndex, computeITRValues } from ${S('utils', 'itrFormula.js')}
    export * as individual from ${S('utils', 'itrStructure', 'individual.js')}
    export * as partnership from ${S('utils', 'itrStructure', 'partnership.js')}
    export * as company from ${S('utils', 'itrStructure', 'company.js')}`, resolveDir: root, loader: 'js' },
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent', loader: { '.js': 'jsx', '.jsx': 'jsx' },
  nodePaths: [path.join(root, 'node_modules')], plugins: [reactShim],
})
const f = path.join(os.tmpdir(), `fsg-selftest-itr-${process.pid}.mjs`)
fs.writeFileSync(f, r.outputFiles[0].text)
let M; try { M = await import(pathToFileURL(f).href) } finally { fs.rmSync(f, { force: true }) }

const SCHEMAS = {
  individual: { bs: M.individual.individualBS, mfg: M.individual.individualManufacturing, trading: M.individual.individualTrading, pl: M.individual.individualPL },
  partnership: { bs: M.partnership.partnershipBS, mfg: M.partnership.partnershipManufacturing, trading: M.partnership.partnershipTrading, pl: M.partnership.partnershipPL },
  company: { bs: M.company.companyBS, mfg: M.company.companyManufacturing, trading: M.company.companyTrading, pl: M.company.companyPL },
}

// 1. every rule that applies to a constitution finds exactly one row on its form, and no two rules write the same cell
for (const g of ['individual', 'partnership', 'company']) {
  const res = M.resolvePlacements(g, SCHEMAS[g])
  const bad = res.filter(x => x.ids.length !== 1)
  ok(`${g}: every placement rule finds exactly one row of the form (${res.length} rules)`, bad.length === 0, bad.map(b => `${b.sheet}:${b.label}=${b.ids.length}`).join(' | '))
  const seen = {}; const dup = []
  for (const x of res) for (const id of x.ids) { if (seen[id] !== undefined) dup.push(`${id}: ${seen[id]} / ${x.label}`); else seen[id] = x.label }
  ok(`${g}: no two rules write the same cell`, dup.length === 0, dup.join(' | '))
}

// 2. a worked set of statements
const row = (name, bal, alie, extra = {}) => ({ name, ledger_name: name, closing_balance: String(bal), opening_balance: '0', alie, ...extra })
const E = (name, amt, extra) => row(name, -amt, 'Expenses', extra), I = (name, amt, extra) => row(name, amt, 'Income', extra)
const L = (name, amt, extra) => row(name, amt, 'EQUITY AND LIABILITIES', extra), A = (name, amt, extra) => row(name, -amt, 'ASSETS', extra)
const line = (level2, rows) => ({ level2, rows, total: rows.reduce((s, x) => s + Math.abs(parseFloat(x.closing_balance)), 0), prevTotal: 0 })
const sec = (level1, lines) => ({ level1, lines, total: lines.reduce((s, l) => s + l.total, 0), prevTotal: 0 })
const note = (title, rows, extra = {}) => ({ title, rows, total: rows.reduce((s, x) => s + Math.abs(parseFloat(x.closing_balance)), 0), prevTotal: 0, ...extra })
const incomeSections = [
  sec('Revenue from operations', [line('Sale of products', [I('Sales - Goods', 1000000)])]),
  sec('Other income', [line('Interest income', [I('Bank interest', 20000)]), line('Rent received', [I('Rent income', 10000)]), line('Miscellaneous income', [I('Sundry receipts', 5000)])]),
]
const expenseSections = [
  sec('Purchases of Stock-in-Trade', [line('Purchases', [E('Purchases', 600000)])]),
  sec('Employee benefits expense', [line('Salaries and wages', [E('Salary', 100000)])]),
  sec('Finance costs', [line('Interest expense', [E('Interest on loan', 15000)])]),
  sec('Depreciation and amortisation expense', [line('Depreciation', [E('Depreciation', 30000)])]),
  sec('Other expenses', [line('Rent', [E('Office rent', 20000)]), line('Telephone expenses', [E('Telephone', 5000)]), line('Miscellaneous expenses', [E('Sundry expenses', 7000)])]),
  sec('Tax expense', [line('Current tax', [E('Income tax', 40000)])]),
]
const changes = note('Changes in inventories of finished goods, WIP and Stock-in-Trade', [], {
  lines: [{ level2: 'Opening Value of Work in Progress, Finished Goods and Stock-in-Trade', total: 50000 }, { level2: 'Less: Closing Value of Work in Progress, Finished Goods and Stock-in-Trade', total: -80000 }], total: -30000 })
const notes = [
  note('Share capital', [L('Equity share capital', 500000)]),
  note('Reserves and surplus', [L('Securities Premium', 100000), L('Surplus in P&L', 248000)]),
  note('Long-term borrowings', [L('HDFC Bank term loan', 300000)]),
  note('Short-term borrowings', [L('Axis Bank OD', 50000), L('Current maturities of long-term borrowings', 40000, { injected: 'current-maturities' })]),
  note('Trade payables', [L('Suppliers', 120000)]),
  note('Other current liabilities', [L('Interest accrued but not due on loans', 5000), L('Statutory dues', 10000)]),
  note('Short-term provisions', [L('Provision for income tax', 40000), L('Provision for gratuity', 8000)]),
  note('Property, Plant and Equipment', [A('Plant and machinery', 400000)]),
  note('Inventories', [A('Finished goods stock', 80000)]),
  note('Trade receivables', [A('Debtors', 200000)]),
  note('Cash and bank balances', [A('HDFC current account', 90000), A('Cash in hand', 10000)]),
  note('Other current assets', [A('Prepaid expenses', 12000)]),
  note('Short-term loans and advances', [A('Advance to suppliers', 20000)]),
  changes,
]
const data = { elSections: [], assetSections: [], incomeSections, expenseSections, netProfit: 248000, notes: Object.fromEntries(notes.map((n, i) => [i + 1, n])) }
// capital for the non-corporate forms
const nonCorp = { ...data, elSections: [{ level1: "Partners' funds", total: 848000, prevTotal: 0, lines: [] }] }

const compute = (g, d) => {
  const sc = SCHEMAS[g]
  const pulled = M.pullITRFromFinancials(g, sc, d)
  const idx = M.buildRowIndex([sc.bs, sc.mfg, sc.trading, sc.pl])
  const vals = M.computeITRValues(idx, pulled.values, pulled.details)
  const pbt = sc.pl.rows.find(x => /^profit before taxes/i.test(x.label || ''))
  return { pulled, vals, pbt: pbt ? vals[pbt.id] : null, sc }
}
const cell = (sc, g, sheet, labelRx, pathRx) => {
  const rows = sc[sheet].rows
  const stack = []; let found = null
  for (const rw of rows) {
    while (stack.length && stack[stack.length - 1].depth >= rw.depth) stack.pop()
    if (rw.editable && labelRx.test(rw.label) && (!pathRx || pathRx.test(stack.map(s => s.label.toLowerCase()).join(' > ')))) { found = rw.id; break }
    stack.push({ depth: rw.depth, label: rw.label || '' })
  }
  return found
}
if (process.env.ITR_DEBUG) { for (const g of ['company', 'partnership', 'individual']) console.log(g, JSON.stringify(compute(g, g === 'company' ? data : nonCorp).pulled.values)) }
for (const g of ['individual', 'partnership', 'company']) {
  const c = compute(g, g === 'company' ? data : nonCorp)
  ok(`${g}: profit before tax on the form agrees with the statements (2,88,000)`, near(c.pbt, 288000), String(c.pbt))
  ok(`${g}: the unmatched income and expense lines went to the "specify nature" Details tables`, (c.pulled.details.plAnyOtherIncome || []).some(x => /miscellaneous income/i.test(x.particulars)) && (c.pulled.details.plOtherExpenses || []).some(x => /miscellaneous expenses/i.test(x.particulars)), JSON.stringify(c.pulled.details))
  const v = (sheet, lrx, prx) => parseFloat(c.pulled.values[cell(c.sc, g, sheet, lrx, prx)] || 0)
  ok(`${g}: sales, purchases, closing and opening stock in the Trading Account`, near(v('trading', /^sale of goods$/i), 1000000) && near(v('trading', /^purchases \(net/i), 600000) && near(v('trading', /^closing stock of finished/i), 80000) && near(v('trading', /^opening stock of finished/i), 50000))
  ok(`${g}: interest, rent, salaries and depreciation in the P&L`, near(v('pl', /^interest income$/i), 20000) && near(v('pl', /^rent$/i, /other income/), 10000) && near(v('pl', /^salaries and wages$/i), 100000))
}
{
  const g = 'company'
  const c = compute(g, data); const v = (sheet, lrx, prx) => parseFloat(c.pulled.values[cell(c.sc, g, sheet, lrx, prx)] || 0)
  ok('company: share capital, securities premium, surplus', near(v('bs', /^issued, subscribed/i), 500000) && near(v('bs', /^securities premium reserve$/i), 100000) && near(v('bs', /^surplus i\.e\./i), 248000))
  ok('company: bank term loan; short-term bank loan', near(v('bs', /^from banks$/i, /term loans/), 300000) && near(v('bs', /^from banks$/i, /loans repayable on demand/), 50000))
  ok('company: current maturities sit in other current liabilities, not in short-term borrowings', near(v('bs', /^current maturities of long-term debt$/i), 40000))
  ok('company: trade payables, interest accrued, other payables', near(v('bs', /^others$/i, /trade payables/), 120000) && near(v('bs', /^interest accrued but not due/i), 5000) && near(v('bs', /^other payables$/i), 10000))
  ok('company: provisions', near(v('bs', /^provision for income-tax$/i), 40000) && near(v('bs', /^provision for employee benefit$/i, /short-term provisions/), 8000))
  ok('company: fixed assets, stock, debtors, cash, other current assets, loans and advances', near(v('bs', /^gross block$/i, /> tangible assets/), 400000) && near(v('bs', /^finished goods$/i), 80000) && near(v('bs', /^others$/i, /trade receivables/), 200000) && near(v('bs', /^balance with banks$/i), 90000) && near(v('bs', /^cash in hand$/i), 10000) && near(v('bs', /^other current assets$/i), 12000) && near(v('bs', /^others$/i, /short-term loans and advances/), 20000))
}
{
  const g = 'partnership'
  const c = compute(g, nonCorp); const v = (sheet, lrx, prx) => parseFloat(c.pulled.values[cell(c.sc, g, sheet, lrx, prx)] || 0)
  ok('partnership: capital; bank loans secured (long-term + short-term + current maturities)', near(v('bs', /partners.*capital/i), 848000) && near(v('bs', /^from banks$/i, /^(?!.*unsecured).*secured loans/), 390000))
  ok('partnership: other current liabilities land in Other payables (not in leased assets)', near(v('bs', /^other payables$/i), 10000) && near(v('bs', /^interest accrued but not due on borrowings$/i), 5000))
  ok('partnership: creditors, debtors, fixed assets', near(v('bs', /^others$/i, /sundry creditors/), 120000) && near(v('bs', /^others$/i, /sundry debtors/), 200000) && near(v('bs', /^gross: block$/i), 400000))
}
{
  const g = 'individual'
  const c = compute(g, nonCorp); const v = (sheet, lrx, prx) => parseFloat(c.pulled.values[cell(c.sc, g, sheet, lrx, prx)] || 0)
  ok('individual: capital, secured bank loans, creditors, debtors, stock, fixed assets', near(v('bs', /proprietor.?s capital/i), 848000) && near(v('bs', /^from banks$/i, /^(?!.*unsecured).*secured loans/), 390000) && near(v('bs', /^sundry creditors$/i), 120000) && near(v('bs', /^sundry debtors$/i), 200000) && near(v('bs', /^finished goods\/traded goods$/i), 80000) && near(v('bs', /^gross: block$/i), 400000))
}
const ui = fs.readFileSync(path.join(root, 'src/renderer/src/components/ITR/index.jsx'), 'utf8')
ok('the Pull button works for every constitution (no "only Partnership" stop) and shows the profit check', !/only Partnership is supported/.test(ui) && ui.includes('pullITRFromFinancials(group, schema, data)') && ui.includes('Profit before tax on the form'))

const appSrc = fs.readFileSync(path.join(root, 'src/renderer/src/App.jsx'), 'utf8')
ok('an Auditee with branches pulls the ITR from the Consolidated statements, not from a branch', /entity\?\.has_branches\s*\?\s*\{ id: '__consolidated__'/.test(ui) && ui.includes('fetchFinancialsData(source,'))
ok('the ITR form of a branch Auditee is kept against one Trial Balance whichever branch pill was last used', appSrc.includes('ITR_TABS.has(activeTab) ? branchTBList[0]'))

console.log(fails ? `\n${fails} FAILURE(S) - release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
