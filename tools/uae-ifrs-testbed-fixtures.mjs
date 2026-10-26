const period = {
  jurisdiction: 'AE',
  legalForm: 'LLC',
  functionalCurrency: 'AED',
  sourceCurrency: 'AED',
  presentationCurrency: 'AED',
  reportingPackId: 'AE_UAE_DEMO',
  currentPeriodStart: '2025-01-01',
  currentPeriodEnd: '2025-12-31',
  comparativePeriodStart: '2024-01-01',
  comparativePeriodEnd: '2024-12-31',
  synthetic: true,
}

const sample01PriorAccounts = [
  ['1000', 'Cash and cash equivalents', 'cash', -96000, -100000],
  ['1100', 'Trade receivables', 'trade_receivables', -15000, -20000],
  ['1200', 'Inventories', 'inventory', -12000, -15000],
  ['1500', 'Property and equipment - cost', 'property_plant_equipment', -50000, -60000],
  ['1590', 'Accumulated depreciation', 'accumulated_depreciation', 5000, 10000],
  ['2000', 'Trade payables', 'trade_payables', 8000, 12000],
  ['2100', 'Borrowings', 'borrowings', 25000, 20000],
  ['3000', 'Share capital', 'share_capital', 50000, 50000],
  ['3100', 'Retained earnings brought forward', 'retained_earnings', 85000, 85000],
  ['4000', 'Revenue', 'revenue', 0, 160000],
  ['5000', 'Cost of sales', 'cost_of_sales', 0, -60000],
  ['6000', 'Operating expenses', 'operating_expenses', 0, -50000],
  ['6100', 'Depreciation expense', 'depreciation_expense', 0, -5000],
  ['6200', 'Income tax expense', 'income_tax_expense', 0, -7000],
  ['3200', 'Dividends', 'dividends', 0, -20000],
]

const sample01CurrentAccounts = [
  ['1000', 'Cash and cash equivalents', 'cash', -100000, -133000],
  ['1100', 'Trade receivables', 'trade_receivables', -20000, -30000],
  ['1200', 'Inventories', 'inventory', -15000, -20000],
  ['1500', 'Property and equipment - cost', 'property_plant_equipment', -60000, -80000],
  ['1590', 'Accumulated depreciation', 'accumulated_depreciation', 10000, 20000],
  ['2000', 'Trade payables', 'trade_payables', 12000, 20000],
  ['2100', 'Borrowings', 'borrowings', 20000, 37000],
  ['3000', 'Share capital', 'share_capital', 50000, 68000],
  ['3100', 'Retained earnings brought forward', 'retained_earnings', 103000, 103000],
  ['4000', 'Revenue', 'revenue', 0, 200000],
  ['5000', 'Cost of sales', 'cost_of_sales', 0, -80000],
  ['6000', 'Operating expenses', 'operating_expenses', 0, -60000],
  ['6100', 'Depreciation expense', 'depreciation_expense', 0, -10000],
  ['6200', 'Income tax expense', 'income_tax_expense', 0, -10000],
  ['3200', 'Dividends', 'dividends', 0, -25000],
]

const tradingPriorAccounts = [
  ['1000', 'Cash and cash equivalents', 'cash', -25000, -32000],
  ['1100', 'Trade receivables', 'trade_receivables', -10000, -12000],
  ['1200', 'Inventories', 'inventory', -15000, -18000],
  ['1500', 'Property and equipment - cost', 'property_plant_equipment', -35000, -40000],
  ['1590', 'Accumulated depreciation', 'accumulated_depreciation', 5000, 10000],
  ['2000', 'Trade payables', 'trade_payables', 10000, 12000],
  ['2100', 'Borrowings', 'borrowings', 0, 0],
  ['3000', 'Share capital', 'share_capital', 40000, 40000],
  ['3100', 'Retained earnings brought forward', 'retained_earnings', 30000, 30000],
  ['4000', 'Revenue', 'revenue', 0, 150000],
  ['5000', 'Cost of sales', 'cost_of_sales', 0, -80000],
  ['6000', 'Operating expenses', 'operating_expenses', 0, -30000],
  ['6100', 'Depreciation expense', 'depreciation_expense', 0, -5000],
  ['6200', 'Income tax expense', 'income_tax_expense', 0, -5000],
  ['3200', 'Dividends', 'dividends', 0, -20000],
]

const tradingCurrentAccounts = [
  ['1000', 'Cash and cash equivalents', 'cash', -32000, -77000],
  ['1100', 'Trade receivables', 'trade_receivables', -12000, -15000],
  ['1200', 'Inventories', 'inventory', -18000, -22000],
  ['1500', 'Property and equipment - cost', 'property_plant_equipment', -40000, -60000],
  ['1590', 'Accumulated depreciation', 'accumulated_depreciation', 10000, 17000],
  ['2000', 'Trade payables', 'trade_payables', 12000, 16000],
  ['2100', 'Borrowings', 'borrowings', 0, 20000],
  ['3000', 'Share capital', 'share_capital', 40000, 40000],
  ['3100', 'Retained earnings brought forward', 'retained_earnings', 40000, 40000],
  ['4000', 'Revenue', 'revenue', 0, 220000],
  ['5000', 'Cost of sales', 'cost_of_sales', 0, -120000],
  ['6000', 'Operating expenses', 'operating_expenses', 0, -39000],
  ['6100', 'Depreciation expense', 'depreciation_expense', 0, -7000],
  ['6200', 'Income tax expense', 'income_tax_expense', 0, -8000],
  ['3200', 'Dividends', 'dividends', 0, -5000],
]

function trialBalance(idStart, accounts) {
  const mappings = {}
  const rows = accounts.map(([ledger_code, name, lineId, opening_balance, closing_balance], index) => {
    const id = idStart + index
    mappings[String(id)] = lineId
    return { id, ledger_code, name, opening_balance, closing_balance }
  })
  return { rows, mappings }
}

function journal(id, date, description, debitLedger, creditLedger, amount) {
  return {
    id,
    date,
    description,
    currency: 'AED',
    entries: [
      { ledgerName: debitLedger, side: 'Dr', amount },
      { ledgerName: creditLedger, side: 'Cr', amount },
    ],
  }
}

function makeCase({
  id, name, entityName, currentAccounts, priorAccounts, currentId, priorId, journals, narrative,
  narrativeNoteNum = 3, narrativeNoteTitle = 'Inventories', expected, noteTotals,
}) {
  const currentTrialBalance = trialBalance(currentId, currentAccounts)
  const comparativeTrialBalance = trialBalance(priorId, priorAccounts)
  return {
    id,
    name,
    entity: { name: entityName, legalForm: 'LLC', jurisdiction: 'AE' },
    engagement: {
      name,
      reportingPackId: period.reportingPackId,
      settings: { ...period },
      selectedComparative: '2024-12-31',
      firm: 'Synthetic UAE Test Firm',
      office: 'Synthetic Dubai Office',
      partner: 'Synthetic Test Partner',
      managementSignatories: ['Synthetic Managing Member'],
      brandingProfile: 'Synthetic UAE Test Brand',
      reportDate: '2026-10-27',
      approvalDate: '2026-10-27',
      approvalPlace: 'Dubai',
    },
    currentTrialBalance,
    comparativeTrialBalance,
    journals,
    disclosures: {
      narrative: [{ note_num: narrativeNoteNum, note_title: narrativeNoteTitle, text: narrative }],
      expectedTotals: noteTotals,
    },
    expected,
  }
}

const scenarioA = makeCase({
  id: 'A-UAE-SAMPLE-01-BASELINE',
  name: 'UAE Sample 01 baseline recalculation',
  entityName: 'Synthetic UAE Sample 01 LLC',
  currentAccounts: sample01CurrentAccounts,
  priorAccounts: sample01PriorAccounts,
  currentId: 100000,
  priorId: 110000,
  journals: [
    journal('A-JE-01', '2025-06-30', 'Synthetic operating expense adjustment', 'Operating expenses', 'Cash and cash equivalents', 2500),
    journal('A-JE-02', '2025-12-31', 'Synthetic year-end operating expense adjustment', 'Operating expenses', 'Cash and cash equivalents', 1250),
  ],
  narrative: 'Synthetic inventory disclosure; the demonstration baseline contains no client records.',
  expected: {
    sourceBalance: 0,
    comparativeSourceBalance: 0,
    current: {
      assets: 239250, liabilitiesAndEquity: 239250, profit: 36250, oci: 0, comprehensiveIncome: 36250,
      equity: 182250, cashOpening: 100000, cashClosing: 129250, cashMovement: 29250,
    },
    comparative: {
      assets: 185000, liabilitiesAndEquity: 185000, profit: 38000, oci: 0, comprehensiveIncome: 38000,
      equity: 153000, cashOpening: 96000, cashClosing: 100000, cashMovement: 4000,
    },
    noteTotals: [
      { noteNumber: 1, currentTotal: 129250, comparativeTotal: 100000 },
      { noteNumber: 3, currentTotal: 20000, comparativeTotal: 15000 },
      { noteNumber: 4, currentTotal: 60000, comparativeTotal: 50000 },
      { noteNumber: 7, currentTotal: 182250, comparativeTotal: 153000 },
      { noteNumber: 8, currentTotal: 200000, comparativeTotal: 160000 },
      { noteNumber: 9, currentTotal: 153750, comparativeTotal: 115000 },
      { noteNumber: 10, currentTotal: 10000, comparativeTotal: 7000 },
    ],
  },
  noteTotals: [
    { noteNumber: 1, currentTotal: 129250, comparativeTotal: 100000 },
    { noteNumber: 3, currentTotal: 20000, comparativeTotal: 15000 },
    { noteNumber: 4, currentTotal: 60000, comparativeTotal: 50000 },
    { noteNumber: 7, currentTotal: 182250, comparativeTotal: 153000 },
    { noteNumber: 8, currentTotal: 200000, comparativeTotal: 160000 },
    { noteNumber: 9, currentTotal: 153750, comparativeTotal: 115000 },
    { noteNumber: 10, currentTotal: 10000, comparativeTotal: 7000 },
  ],
})

const scenarioB = makeCase({
  id: 'B-SIMPLE-TRADING-LLC',
  name: 'Simple trading LLC',
  entityName: 'Synthetic simple trading LLC',
  currentAccounts: tradingCurrentAccounts,
  priorAccounts: tradingPriorAccounts,
  currentId: 200000,
  priorId: 210000,
  journals: [
    journal('B-JE-01', '2025-12-31', 'Synthetic accrued operating expense', 'Operating expenses', 'Trade payables', 1000),
  ],
  narrative: 'Synthetic inventory schedule reconciles to the saved final Trial Balance.',
  expected: {
    sourceBalance: 0,
    comparativeSourceBalance: 0,
    current: {
      assets: 157000, liabilitiesAndEquity: 157000, profit: 45000, oci: 0, comprehensiveIncome: 45000,
      equity: 120000, cashOpening: 32000, cashClosing: 77000, cashMovement: 45000,
    },
    comparative: {
      assets: 92000, liabilitiesAndEquity: 92000, profit: 30000, oci: 0, comprehensiveIncome: 30000,
      equity: 80000, cashOpening: 25000, cashClosing: 32000, cashMovement: 7000,
    },
    noteTotals: [
      { noteNumber: 1, currentTotal: 77000, comparativeTotal: 32000 },
      { noteNumber: 2, currentTotal: 15000, comparativeTotal: 12000 },
      { noteNumber: 3, currentTotal: 22000, comparativeTotal: 18000 },
      { noteNumber: 4, currentTotal: 43000, comparativeTotal: 30000 },
      { noteNumber: 5, currentTotal: 17000, comparativeTotal: 12000 },
      { noteNumber: 6, currentTotal: 20000, comparativeTotal: 0 },
      { noteNumber: 7, currentTotal: 120000, comparativeTotal: 80000 },
      { noteNumber: 8, currentTotal: 220000, comparativeTotal: 150000 },
      { noteNumber: 9, currentTotal: 167000, comparativeTotal: 115000 },
      { noteNumber: 10, currentTotal: 8000, comparativeTotal: 5000 },
    ],
  },
  noteTotals: [
    { noteNumber: 1, currentTotal: 77000, comparativeTotal: 32000 },
    { noteNumber: 2, currentTotal: 15000, comparativeTotal: 12000 },
    { noteNumber: 3, currentTotal: 22000, comparativeTotal: 18000 },
    { noteNumber: 4, currentTotal: 43000, comparativeTotal: 30000 },
    { noteNumber: 5, currentTotal: 17000, comparativeTotal: 12000 },
    { noteNumber: 6, currentTotal: 20000, comparativeTotal: 0 },
    { noteNumber: 7, currentTotal: 120000, comparativeTotal: 80000 },
    { noteNumber: 8, currentTotal: 220000, comparativeTotal: 150000 },
    { noteNumber: 9, currentTotal: 167000, comparativeTotal: 115000 },
    { noteNumber: 10, currentTotal: 8000, comparativeTotal: 5000 },
  ],
})

const revaluationAccounts = [
  ['1515', 'PPE revaluation adjustment', 'ppe_revaluation_adjustment', 0, 0],
  ['4190', 'Other comprehensive income - IAS 16 revaluation', 'other_comprehensive_income', 0, 0],
  ['3205', 'Revaluation surplus reserve', 'revaluation_surplus', 0, 0],
]
const scenarioC = makeCase({
  id: 'C-IAS16-REVALUATION-OCI',
  name: 'Controlled IAS 16 OCI LLC',
  entityName: 'Synthetic controlled IAS 16 OCI LLC',
  currentAccounts: [...tradingCurrentAccounts, ...revaluationAccounts],
  priorAccounts: tradingPriorAccounts,
  currentId: 300000,
  priorId: 310000,
  journals: [
    ...scenarioB.journals,
    journal('C-JE-OCI-01', '2025-12-31', 'Synthetic PPE class revaluation; OCI treatment per fixture assumptions', 'PPE revaluation adjustment', 'Other comprehensive income - IAS 16 revaluation', 10000),
  ],
  narrative: 'Test-only IAS 16 assumption: a revaluation increase for an entire PPE class is recognised in OCI and the revaluation surplus; the AED 10,000 movement is non-cash.',
  narrativeNoteNum: 11,
  narrativeNoteTitle: 'Other comprehensive income',
  expected: {
    sourceBalance: 0,
    comparativeSourceBalance: 0,
    current: {
      assets: 167000, liabilitiesAndEquity: 167000, profit: 45000, oci: 10000, comprehensiveIncome: 55000,
      equity: 130000, cashOpening: 32000, cashClosing: 77000, cashMovement: 45000,
      ppeNet: 53000, revaluationSurplus: 10000,
    },
    comparative: {
      assets: 92000, liabilitiesAndEquity: 92000, profit: 30000, oci: 0, comprehensiveIncome: 30000,
      equity: 80000, cashOpening: 25000, cashClosing: 32000, cashMovement: 7000,
    },
    noteTotals: [
      { noteNumber: 4, currentTotal: 53000, comparativeTotal: 30000 },
      { noteNumber: 7, currentTotal: 130000, comparativeTotal: 80000 },
      { noteNumber: 11, currentTotal: 10000, comparativeTotal: 0 },
    ],
  },
  noteTotals: [
    { noteNumber: 1, currentTotal: 77000, comparativeTotal: 32000 },
    { noteNumber: 2, currentTotal: 15000, comparativeTotal: 12000 },
    { noteNumber: 3, currentTotal: 22000, comparativeTotal: 18000 },
    { noteNumber: 4, currentTotal: 53000, comparativeTotal: 30000 },
    { noteNumber: 5, currentTotal: 17000, comparativeTotal: 12000 },
    { noteNumber: 6, currentTotal: 20000, comparativeTotal: 0 },
    { noteNumber: 7, currentTotal: 130000, comparativeTotal: 80000 },
    { noteNumber: 8, currentTotal: 220000, comparativeTotal: 150000 },
    { noteNumber: 9, currentTotal: 167000, comparativeTotal: 115000 },
    { noteNumber: 10, currentTotal: 8000, comparativeTotal: 5000 },
    { noteNumber: 11, currentTotal: 10000, comparativeTotal: 0 },
  ],
})

export function createUaeIfrsTestBedFixtures() {
  return [scenarioA, scenarioB, scenarioC].map(fixture => structuredClone(fixture))
}

export function applyUaeIfrsFixtureJournals(fixture) {
  const rows = structuredClone(fixture.currentTrialBalance.rows)
  for (const journal of fixture.journals) {
    for (const entry of journal.entries) {
      const amount = Number(entry.amount)
      if (!Number.isFinite(amount) || amount <= 0 || !['Dr', 'Cr'].includes(entry.side)) {
        throw new Error(`${journal.id} contains an invalid ${entry.side} journal amount.`)
      }
      const name = String(entry.ledgerName || '').trim().toLocaleLowerCase()
      const code = String(entry.ledgerCode || '').trim().toLocaleLowerCase()
      const matches = rows.filter(row => code
        ? String(row.ledger_code || '').trim().toLocaleLowerCase() === code
        : String(row.name || '').trim().toLocaleLowerCase() === name)
      if (matches.length !== 1) {
        throw new Error(`${journal.id} must resolve "${entry.ledgerName}" to exactly one source Trial Balance row.`)
      }
      const row = matches[0]
      const signedDelta = entry.side === 'Dr' ? -amount : amount
      row.closing_balance = Math.round((Number(row.closing_balance || 0) + signedDelta + Number.EPSILON) * 100) / 100
      row.trail_balance = row.closing_balance
      row.debit = Math.round((Number(row.debit || 0) + (entry.side === 'Dr' ? amount : 0) + Number.EPSILON) * 100) / 100
      row.credit = Math.round((Number(row.credit || 0) + (entry.side === 'Cr' ? amount : 0) + Number.EPSILON) * 100) / 100
    }
  }
  return rows
}
