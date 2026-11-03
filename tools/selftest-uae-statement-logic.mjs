// Offline check of the shared statement logic with synthetic ledgers (no database, no application).
//   node tools/selftest-uae-statement-logic.mjs
import assert from 'node:assert/strict'
import { buildStatementPreview } from '../src/shared/uae-pack-statement-preview.mjs'

let passed = 0
const check = (condition, message) => { assert.ok(condition, message); passed += 1; console.log('PASS', message) }
const near = (a, b) => Math.abs(a - b) < 0.005

const pack = { lines: [
  { key: 'cash', label: 'Cash', statement: 'SFP', section: 'Current assets' },
  { key: 'capital', label: 'Share capital', statement: 'SFP', section: 'Equity' },
  { key: 're', label: 'Retained earnings', statement: 'SFP', section: 'Equity' },
  { key: 'payables', label: 'Payables', statement: 'SFP', section: 'Liabilities' },
  { key: 'revenue', label: 'Revenue', statement: 'PL', section: 'Profit or loss' },
  { key: 'costs', label: 'Costs', statement: 'PL', section: 'Profit or loss' },
] }
// Final-TB balances are credit-positive.
const row = (id, balance, extra = {}) => ({ id, code: `A${id}`, name: `Ledger ${id}`, balance, status: 'unresolved', suggestedLineKey: null, lineKey: null, ...extra })
const suggested = (id, balance, lineKey) => row(id, balance, { status: 'suggested', suggestedLineKey: lineKey })
const preview = rows => buildStatementPreview({ pack, rows })

// Pre-closing: P&L ledgers carry balances and retained earnings holds only the opening balance.
const pre = preview([suggested(1, -100, 'cash'), suggested(2, 60, 'capital'), suggested(3, 10, 're'), suggested(4, 50, 'revenue'), suggested(5, -20, 'costs')])
check(pre.closing.treatment === 'pre-closing' && near(pre.totals.profit, 30), 'pre-closing TB: treatment detected from P&L ledger balances, profit 30')
check(near(pre.totals.totalEquity, 100) && near(pre.totals.totalAssets, 100) && near(pre.totals.difference, 0), 'pre-closing TB: profit added to equity once, Balance Sheet balances')

// Already closed: no P&L ledgers, profit already inside retained earnings.
const closed = preview([suggested(1, -100, 'cash'), suggested(2, 60, 'capital'), suggested(3, 40, 're')])
check(closed.closing.treatment === 'closed-or-no-pl' && near(closed.totals.profit, 0), 'closed TB: nothing added to equity')
check(near(closed.totals.totalEquity, 100) && near(closed.totals.difference, 0), 'closed TB: Balance Sheet balances without double counting')

// Profit already in retained earnings while P&L ledgers remain: the source TB itself cannot balance and is flagged.
const doubled = preview([suggested(1, -100, 'cash'), suggested(2, 60, 'capital'), suggested(3, 40, 're'), suggested(4, 50, 'revenue'), suggested(5, -20, 'costs')])
check(!doubled.arithmeticReconciled && doubled.checks.some(item => item.kind === 'arithmetic' && !item.passed), 'profit present in both places is flagged as an arithmetic failure, not silently accepted')

// Unclassified placeholders: debit under assets, credit under liabilities, kept separate.
const open = preview([suggested(1, -100, 'cash'), suggested(2, 60, 'capital'), suggested(3, 10, 're'), suggested(4, 50, 'revenue'), suggested(5, -20, 'costs'), row(6, -5), row(7, 8), row(8, -3)])
check(open.unclassified.debit.count === 2 && near(open.unclassified.debit.amount, 8), 'two unclassified debit accounts total 8 under assets')
check(open.unclassified.credit.count === 1 && near(open.unclassified.credit.amount, 8), 'one unclassified credit account totals 8 under liabilities')
check(near(open.totals.totalAssets, 108) && near(open.totals.totalLiabilities, 8), 'placeholders enter total assets and total liabilities separately')
check(near(open.totals.difference, 0) && open.arithmeticReconciled, 'arithmetic reconciles with unclassified accounts present')
check(open.classification.complete === false && open.coverage.unresolvedCount === 3, 'classification completeness reports 3 unresolved accounts separately')
check(near(open.totals.profit, 30), 'unclassified accounts never change profit')

// Classifying an account moves it out of the placeholder and preserves the balance.
const reclassified = preview([suggested(1, -100, 'cash'), suggested(2, 60, 'capital'), suggested(3, 10, 're'), suggested(4, 50, 'revenue'), suggested(5, -20, 'costs'), row(6, -5, { status: 'confirmed', lineKey: 'cash' }), row(7, 8), row(8, -3)])
check(reclassified.unclassified.debit.count === 1 && near(reclassified.unclassified.debit.amount, 3), 'confirming one debit account removes it from the placeholder')
check(near(reclassified.totals.totalAssets, 108) && near(reclassified.totals.difference, 0), 'Balance Sheet still balances after classification')
// Classifying a P&L account recalculates profit and equity without double counting.
const plClassified = preview([suggested(1, -100, 'cash'), suggested(2, 60, 'capital'), suggested(3, 10, 're'), suggested(4, 50, 'revenue'), suggested(5, -20, 'costs'), row(6, -5, { status: 'confirmed', lineKey: 'costs' }), row(7, 8), row(8, -3)])
check(near(plClassified.totals.profit, 25) && near(plClassified.totals.difference, 0), 'classifying a cost ledger lowers profit by 5 and equity follows; still balanced')
const complete = preview([suggested(1, -100, 'cash'), suggested(2, 60, 'capital'), suggested(3, 10, 're'), suggested(4, 50, 'revenue'), suggested(5, -20, 'costs')])
check(complete.classification.complete === true, 'no unresolved accounts: classification complete')
console.log(`${passed} checks passed`)
