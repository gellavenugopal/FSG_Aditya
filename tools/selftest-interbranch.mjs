// Inter-branch / Head Office elimination (eliminateInterBranch in
// src/renderer/src/hooks/useFinancials.js) — runs the real function against
// the row shape financials:getConsolidatedData returns.
//   node tools/selftest-interbranch.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const src = fs.readFileSync(path.join(root, 'src/renderer/src/hooks/useFinancials.js'), 'utf8')
function grab(name) {
  const m = new RegExp('(?:export )?function ' + name + '\\b').exec(src)
  if (!m) throw new Error('cannot find ' + name)
  const rest = src.slice(m.index)
  const end = /\r?\n\}(?=\r?\n)/g; end.lastIndex = 0
  const e = end.exec(rest)
  return rest.slice(0, e.index + e[0].length).replace(/^export /, '')
}
const rxLine = src.match(/^export const INTERBRANCH_RX = .*$/m)[0].replace(/^export /, '')
const helper = src.match(/^const isInterBranchRow = .*$/m)[0]
const eliminateInterBranch = new Function(rxLine + '\n' + helper + '\n' + grab('eliminateInterBranch') + '\nreturn eliminateInterBranch')()

let fails = 0
const check = (what, got, want) => { const ok = Math.abs(got - want) < 0.005 || got === want; if (!ok) fails++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}: ${got}${ok ? '' : '  (expected ' + want + ')'}`) }
const L1 = 'Inter-branch and Head Office account'
// Dr stored negative, Cr positive (displayAmt convention)
const rows = [
  { level1: L1, mapping1_resultant: L1, alie: 'ASSETS', branch_name: 'HO',       ledger_name: 'Mumbai Branch A/c', closing_balance: '-500000' },
  { level1: L1, mapping1_resultant: L1, alie: 'ASSETS', branch_name: 'Mumbai',   ledger_name: 'Head Office A/c',   closing_balance: '500000' },
  { level1: 'Current assets', mapping1_resultant: 'Current assets', alie: 'ASSETS', branch_name: 'HO', ledger_name: 'Cash', closing_balance: '-1000' },
]
console.log('\nInter-branch elimination self-test')
let r = eliminateInterBranch(rows)
check('exact offset: both ledgers dropped, not even a zero line', r.rows.length, 1)
check('summary.eliminated', r.summary.eliminated, true)
check('Dr side total', r.summary.dr, 500000)
check('Cr side total', r.summary.cr, 500000)
check('two branches reported', r.summary.byBranch.length, 2)

// Reported by Santosh Kumar Gupta 14 Sep 2026: an exact offset still showed as
// a face line, and a genuine residue (Cr 1,10,000 vs Dr 1,00,000) showed BOTH
// branches' raw figures instead of one net Cr 10,000 line — and the Notes
// screen's own caption-based note-merge summed (not netted) the two sides.
// Traced to INTERBRANCH_RX requiring a hyphen ('inter-branch') or nothing
// ('interbranch') but never a plain space, so a ledger captioned the natural
// way — "Inter Branch ..." — was never even recognised as an inter-branch
// account; elimination silently never ran for it.
const L1_SPACED = 'Inter Branch Balances'
const spacedExact = [
  { level1: L1_SPACED, mapping1_resultant: L1_SPACED, alie: 'ASSETS', branch_name: 'Branch 2', ledger_name: 'Head Office A/c', closing_balance: '-100' },
  { level1: L1_SPACED, mapping1_resultant: L1_SPACED, alie: 'ASSETS', branch_name: 'Branch 1', ledger_name: 'Branch 2 A/c',    closing_balance: '100' },
]
r = eliminateInterBranch(spacedExact)
check('space-separated caption is recognised as inter-branch at all', r.summary !== null, true)
check('space-separated caption, exact offset: dropped entirely', r.rows.length, 0)

const spacedResidue = [
  { level1: L1_SPACED, mapping1_resultant: L1_SPACED, alie: 'ASSETS', branch_name: 'Branch 1', ledger_name: 'Branch 2 A/c',    closing_balance: '110', opening_balance: '90' },
  { level1: L1_SPACED, mapping1_resultant: L1_SPACED, alie: 'ASSETS', branch_name: 'Branch 2', ledger_name: 'Head Office A/c', closing_balance: '-100', opening_balance: '-90' },
]
r = eliminateInterBranch(spacedResidue)
check("residue: collapses to a SINGLE net row, not both branches' raw figures", r.rows.length, 1)
check('residue: net CY figure is the difference (Cr 10)', parseFloat(r.rows[0].closing_balance), 10)
check('residue: PY nets independently too (cancels to 0)', parseFloat(r.rows[0].opening_balance), 0)
check('summary.eliminated false', r.summary.eliminated, false)
check('net residue reported (Cr 10)', r.summary.net, 10)

const rows2 = [...rows, { level1: L1, mapping1_resultant: L1, alie: 'ASSETS', branch_name: 'Pune', ledger_name: 'Head Office A/c', closing_balance: '120000' }]
r = eliminateInterBranch(rows2)
check('residue → Cash + ONE net row (not 4 raw rows)', r.rows.length, 2)
const ibRow2 = r.rows.find(x => x.ledger_name === 'Inter-branch / Head Office balances (net)')
check('residue net figure', parseFloat(ibRow2.closing_balance), 120000)
check('summary.eliminated false', r.summary.eliminated, false)
check('net residue reported (Cr 1,20,000)', r.summary.net, 120000)

r = eliminateInterBranch([rows[2]])
check('no inter-branch rows → summary null', r.summary, null)
check('…and rows untouched', r.rows.length, 1)

// "Branch Sale & Purchase" between the branches (eliminateNilBranchTrading): nil on consolidation -> not shown at all.
console.log('\nBranch Sale & Purchase in the Consolidated view')
const btRx = src.match(/^export const BRANCH_TRADING_RX = .*$/m)[0].replace(/^export /, '')
const eliminateNilBranchTrading = new Function(rxLine + '\n' + helper + '\n' + btRx + '\n' + grab('eliminateNilBranchTrading') + '\nreturn eliminateNilBranchTrading')()
const BS_CAP = 'Branch Sale & Purchase'
const sale = (branch, cr, py = '0') => ({ alie: 'Income', mapping1_resultant: 'Revenue from operations', level1: 'Revenue from operations', mapping2_resultant: 'Sale of products', mapping3_resultant: BS_CAP, branch_name: branch, ledger_name: 'Branch Sales', closing_balance: String(cr), opening_balance: py })
const purchase = (branch, dr, py = '0') => ({ alie: 'Expenses', mapping1_resultant: 'Purchases of Stock-in-Trade', level1: 'Purchases of Stock-in-Trade', mapping3_resultant: BS_CAP, branch_name: branch, ledger_name: 'Branch Purchases', closing_balance: String(-dr), opening_balance: String(-py) })
const ordinary = { alie: 'Income', mapping1_resultant: 'Revenue from operations', level1: 'Revenue from operations', mapping2_resultant: 'Sale of products', mapping3_resultant: 'Sale of Goods', branch_name: 'A', ledger_name: 'Sales', closing_balance: '900000', opening_balance: '800000' }
let bt = eliminateNilBranchTrading([ordinary, sale('A', 100000), purchase('B', 100000)])
check('a nil net: both ledgers leave the statements', bt.rows.length, 1)
check('...the ordinary sale stays', bt.rows[0].ledger_name, 'Sales')
check('...and the summary says it was eliminated', bt.summary[0].eliminatedCY, true)
bt = eliminateNilBranchTrading([ordinary, sale('A', 100000), purchase('B', 60000)])
check('a residue: the ledgers stay with their figures', bt.rows.length, 3)
bt = eliminateNilBranchTrading([sale('A', 100000, '50000'), purchase('B', 100000, '30000')])
check('nil this year but not last year: kept, with this year\'s figures removed', bt.rows.length, 2)
check('...Current Year figures are nil', bt.rows.every(r => parseFloat(r.closing_balance) === 0), true)
check('...Previous Year figures remain', parseFloat(bt.rows[0].opening_balance), 50000)
bt = eliminateNilBranchTrading([sale('A', 100000, '50000'), purchase('B', 70000, '50000')])
check('nil last year but not this year: Previous Year figures removed, Current Year kept', bt.rows.every(r => parseFloat(r.opening_balance) === 0) && parseFloat(bt.rows[0].closing_balance) === 100000, true)
bt = eliminateNilBranchTrading([ordinary])
check('no such caption: rows untouched, no summary', bt.summary, null)
const bsSide = { ...sale('A', 100), alie: 'ASSETS' }
bt = eliminateNilBranchTrading([bsSide, { ...bsSide, closing_balance: '-100' }])
check('only the Profit & Loss is considered', bt.rows.length, 2)
bt = eliminateNilBranchTrading([{ ...sale('A', 100000), mapping3_resultant: null, level5_value: 'Branch Sale & Purchase' }, { ...purchase('B', 100000), mapping3_resultant: null, level5_value: 'Branch Sale & Purchase' }])
check('a caption at Level 5 is recognised too', bt.rows.length, 0)
// any other caption carried by two or more branches that nets to nil
const gen = (branch, amt, py = '0', over = {}) => ({ alie: 'ASSETS', mapping1_resultant: 'Current assets', level1: 'Current assets', mapping2_resultant: 'Other current assets', mapping3_resultant: null, branch_name: branch, ledger_name: 'Receivable ' + branch, closing_balance: String(-amt), opening_balance: String(-py), ...over })
bt = eliminateNilBranchTrading([gen('A', 5000, '700'), gen('B', -5000, '-700')])
check('any caption that nets to nil across two branches leaves the statements (both years)', bt.rows.length, 0)
bt = eliminateNilBranchTrading([gen('A', 5000), gen('B', -3000)])
check('...a residue keeps its ledgers', bt.rows.length, 2)
bt = eliminateNilBranchTrading([gen('A', 5000, '100'), gen('A', -5000, '100', { ledger_name: 'Second ledger of A' })])
check('...but not when one branch alone carries it (a single branch\'s ledgers stay as in its Trial Balance)', bt.rows.length, 2)
bt = eliminateNilBranchTrading([gen('A', 5000, '0', { mapping2_resultant: 'Uncategorised' }), gen('B', -5000, '0', { mapping2_resultant: 'Uncategorised' })])
check('...an unfinished (uncategorised) mapping is never hidden', bt.rows.length, 2)
bt = eliminateNilBranchTrading([gen('A', 5000), gen('B', -5000, '0', { alie: 'EQUITY AND LIABILITIES' })])
check('...the same caption on the two sides of the statement is not netted', bt.rows.length, 2)
const IBRANCH = { alie: 'ASSETS', mapping1_resultant: 'Inter-branch and Head Office account', level1: 'Inter-branch and Head Office account', branch_name: 'A', closing_balance: '-100', opening_balance: '0' }
bt = eliminateNilBranchTrading([IBRANCH, { ...IBRANCH, branch_name: 'B', closing_balance: '100' }])
check('...the inter-branch account is left to its own elimination', bt.rows.length, 2)
const uf = src
check('both Consolidated paths use it, before the inter-branch elimination', (uf.match(/const bt = eliminateNilBranchTrading\(cyGuard\.rows\)\s*\n\s*const ib = eliminateInterBranch\(bt\.rows\)/g) || []).length, 2)
// the definition + the two Consolidated paths, each for the current year and for the consolidated previous year (0.1.118)
check('only the two Consolidated paths call it (current and previous year each) - a single branch statements do not', (uf.match(/eliminateNilBranchTrading\(/g) || []).length, 5)

// Consolidated statements' heading date (utils/consolidatedPeriod.js): the
// branches' common year, never the word "Consolidated" where a date belongs.
console.log('\nConsolidated heading date')
const cpSrc = fs.readFileSync(path.join(root, 'src/renderer/src/utils/consolidatedPeriod.js'), 'utf8')
const consolidatedPeriodOf = new Function(cpSrc.replace(/^export /m, '') + '\nreturn consolidatedPeriodOf')()
const FY = '2025-04-01 To 2026-03-31'
check('two branches, one year -> that year', consolidatedPeriodOf([{ period: FY }, { period: FY }]), FY)
check('a branch TB without a period is ignored', consolidatedPeriodOf([{ period: FY }, { period: null }]), FY)
check('branches in different years -> no single date', consolidatedPeriodOf([{ period: FY }, { period: '2024-04-01 To 2025-03-31' }]), 'Consolidated')
check('no branch TBs -> no date', consolidatedPeriodOf([]), 'Consolidated')
// last year's Trial Balances beside this year's must not make the heading "as at Consolidated" (0.1.121)
const PYP = '2024-04-01 To 2025-03-31'
const tbsTwoYears = [{ period: FY, entity_period_id: 20 }, { period: FY, entity_period_id: 20 }, { period: PYP, entity_period_id: 10 }, { period: PYP, entity_period_id: 10 }]
check('two years of Trial Balances: the Financial Year on screen gives the date', consolidatedPeriodOf(tbsTwoYears, 20), FY)
check('...and the earlier year gives its own', consolidatedPeriodOf(tbsTwoYears, 10), PYP)
const appSrc = fs.readFileSync(path.join(root, 'src/renderer/src/App.jsx'), 'utf8')
check('the on-screen Consolidated BS / PL heading takes that date', appSrc.includes('period: consolidatedPeriodOf(branchTBList, currentEntityPeriodId)'), true)
// the Owners' Capital tally check compares amounts, not signs (a debit capital is shown in brackets in the form)
for (const f of ['buildHTML.js', 'buildExcel.js']) {
  const t = fs.readFileSync(path.join(root, 'src/renderer/src/components/GenerateFinancials', f), 'utf8')
  check(f + ': the capital tally check ignores the sign', /Math\.abs\(formCY - mappedCY\)/.test(t), false)
}
const gfSrc = fs.readFileSync(path.join(root, 'src/renderer/src/components/GenerateFinancials/index.jsx'), 'utf8')
check('Consolidated PDF and Excel exports both take that date', (gfSrc.match(/const tbLabel = \{ period: consolidatedPeriod \}/g) || []).length, 2)
check('no export hard-codes the period "Consolidated"', /period: [`'"]Consolidated[`'"]/.test(gfSrc), false)

console.log(fails ? `\n${fails} FAILURE(S) — release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
