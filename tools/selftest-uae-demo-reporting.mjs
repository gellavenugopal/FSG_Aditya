import assert from 'node:assert/strict'
import {
  buildUaeDemoFinancials,
  buildUaeDemoFinancialsHtml,
  suggestUaeDemoAccountLine,
} from '../src/renderer/src/components/Engagements/uaeDemoReporting.js'

function makeRows(baseId, balances) {
  return balances.map(([name, lineKey, opening, closing], index) => ({
    id: baseId + index,
    name,
    ledger_code: `UAE-${index + 1}`,
    opening_balance: opening,
    closing_balance: closing,
  })).reduce((result, row, index) => {
    result.rows.push(row)
    result.mappings[String(row.id)] = balances[index][1]
    return result
  }, { rows: [], mappings: {} })
}

const priorData = makeRows(100, [
  ['Cash and cash equivalents', 'cash', -96000, -100000],
  ['Trade receivables', 'trade_receivables', -15000, -20000],
  ['Inventories', 'inventory', -12000, -15000],
  ['Property and equipment - cost', 'property_plant_equipment', -50000, -60000],
  ['Accumulated depreciation', 'accumulated_depreciation', 5000, 10000],
  ['Trade payables', 'trade_payables', 8000, 12000],
  ['Borrowings', 'borrowings', 25000, 20000],
  ['Share capital', 'share_capital', 50000, 50000],
  ['Retained earnings brought forward', 'retained_earnings', 85000, 85000],
  ['Revenue', 'revenue', 0, 160000],
  ['Cost of sales', 'cost_of_sales', 0, -60000],
  ['Operating expenses', 'operating_expenses', 0, -50000],
  ['Depreciation expense', 'depreciation_expense', 0, -5000],
  ['Income tax expense', 'income_tax_expense', 0, -7000],
  ['Dividends', 'dividends', 0, -20000],
])
const currentData = makeRows(200, [
  ['Cash and cash equivalents', 'cash', -100000, -133000],
  ['Trade receivables', 'trade_receivables', -20000, -30000],
  ['Inventories', 'inventory', -15000, -20000],
  ['Property and equipment - cost', 'property_plant_equipment', -60000, -80000],
  ['Accumulated depreciation', 'accumulated_depreciation', 10000, 20000],
  ['Trade payables', 'trade_payables', 12000, 20000],
  ['Borrowings', 'borrowings', 20000, 37000],
  ['Share capital', 'share_capital', 50000, 68000],
  ['Retained earnings brought forward', 'retained_earnings', 103000, 103000],
  ['Revenue', 'revenue', 0, 200000],
  ['Cost of sales', 'cost_of_sales', 0, -80000],
  ['Operating expenses', 'operating_expenses', 0, -60000],
  ['Depreciation expense', 'depreciation_expense', 0, -10000],
  ['Income tax expense', 'income_tax_expense', 0, -10000],
  ['Dividends', 'dividends', 0, -25000],
])

const mappings = { ...priorData.mappings, ...currentData.mappings }
const financials = buildUaeDemoFinancials({
  currentRows: currentData.rows,
  comparativeRows: priorData.rows,
  mappings,
  periodEnd: '2025-12-31',
  comparativePeriodEnd: '2024-12-31',
})

assert.equal(financials.sourceBalance, 0)
assert.equal(financials.comparativeSourceBalance, 0)
assert.equal(financials.current.profit.profitForYear, 40000)
assert.equal(financials.comparative.profit.profitForYear, 38000)
assert.equal(financials.current.position.assets, 243000)
assert.equal(financials.current.position.totalLiabilitiesAndEquity, 243000)
assert.equal(financials.comparative.position.assets, 185000)
assert.equal(financials.comparative.position.totalLiabilitiesAndEquity, 185000)
assert.equal(financials.current.equity.totalClosing, 186000)
assert.equal(financials.current.cashFlow.netMovement, 33000)
assert.equal(financials.current.cashFlow.closingCash, 133000)
assert.equal(financials.comparative.cashFlow.netMovement, 4000)
assert.equal(financials.comparative.cashFlow.closingCash, 100000)
assert.ok(financials.notes.some(note => note.number === 1 && note.title === 'Note 1'))
assert.equal(suggestUaeDemoAccountLine('Cost of sales'), 'cost_of_sales')
assert.equal(suggestUaeDemoAccountLine('Sales revenue'), 'revenue')
const equityNote = financials.notes.find(note => note.number === 7)
assert.equal(equityNote.accounts.reduce((sum, account) => sum + account.current, 0), equityNote.currentTotal)
assert.equal(equityNote.accounts.reduce((sum, account) => sum + account.comparative, 0), equityNote.comparativeTotal)

assert.throws(() => buildUaeDemoFinancials({
  currentRows: [{ id: 1, name: 'Unmapped account', closing_balance: -1, opening_balance: 0 }],
  comparativeRows: [{ id: 2, name: 'Comparative cash', closing_balance: -1, opening_balance: -1 }],
  mappings: {},
  periodEnd: '2025-12-31',
  comparativePeriodEnd: '2024-12-31',
}), /Map every non-zero ledger/)

assert.throws(() => buildUaeDemoFinancials({
  currentRows: [{ id: 1, name: 'Cash', closing_balance: 100, opening_balance: 0 }],
  comparativeRows: [{ id: 2, name: 'Cash', closing_balance: 0, opening_balance: 0 }],
  mappings: { 1: 'cash' },
  periodEnd: '2025-12-31',
  comparativePeriodEnd: '2024-12-31',
}), /sign.*conflicts/i)

const html = buildUaeDemoFinancialsHtml({
  financials,
  entity: { name: 'Synthetic UAE Sample LLC' },
  engagement: { name: 'UAE Sample 01' },
  bundle: {
    auditReport: { fields: { opinion: 'Synthetic demonstration wording.' } },
    noteDisclosures: [],
    approvalDate: '2026-03-15',
    approvalPlace: 'Dubai',
    approvalSignatories: [{ name: 'Synthetic Director', designation: 'Director' }],
  },
})
assert.match(html, /DRAFT FOR DEMONSTRATION/)
assert.match(html, /Statement of financial position/)
assert.match(html, /Statement of changes in equity/)
assert.match(html, /Statement of cash flows/)
assert.match(html, /html,body\{margin:0\}/)
assert.match(html, /\.report-page\{position:relative;min-height:260mm/)
assert.match(html, /\.logo\{display:block;width:60mm;height:15mm;object-fit:contain/)
assert.doesNotMatch(html, /Schedule III|Companies Act|INR|India/i)
assert.equal((html.match(/class="report-page"/g) || []).length, financials.notes.length + 7)

console.info('UAE demonstration reporting reconciliation passed: AED 2025/2024 statements, equity, cash flows, mapping and draft-only HTML.')
