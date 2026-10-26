export const UAE_DEMO_ACCOUNT_LINES = [
  { id: 'cash', label: 'Cash and cash equivalents', note: 1 },
  { id: 'trade_receivables', label: 'Trade receivables', note: 2 },
  { id: 'inventory', label: 'Inventories', note: 3 },
  { id: 'property_plant_equipment', label: 'Property and equipment - cost', note: 4 },
  { id: 'ppe_revaluation_adjustment', label: 'PPE revaluation adjustment', note: 4 },
  { id: 'accumulated_depreciation', label: 'Accumulated depreciation', note: 4 },
  { id: 'trade_payables', label: 'Trade payables', note: 5 },
  { id: 'borrowings', label: 'Borrowings', note: 6 },
  { id: 'share_capital', label: 'Share capital', note: 7 },
  { id: 'retained_earnings', label: 'Retained earnings brought forward', note: 7 },
  { id: 'revenue', label: 'Revenue', note: 8 },
  { id: 'other_income', label: 'Other income', note: 8 },
  { id: 'cost_of_sales', label: 'Cost of sales', note: 9 },
  { id: 'operating_expenses', label: 'Operating expenses', note: 9 },
  { id: 'depreciation_expense', label: 'Depreciation expense', note: 9 },
  { id: 'income_tax_expense', label: 'Income tax expense', note: 10 },
  { id: 'other_comprehensive_income', label: 'Other comprehensive income - revaluation', note: 11 },
  { id: 'revaluation_surplus', label: 'Revaluation surplus', note: 7 },
  { id: 'dividends', label: 'Dividends', note: 7 },
]

const LINE_BY_ID = new Map(UAE_DEMO_ACCOUNT_LINES.map(line => [line.id, line]))
const DEBIT_NATURED = new Set([
  'cash', 'trade_receivables', 'inventory', 'property_plant_equipment', 'ppe_revaluation_adjustment',
  'cost_of_sales', 'operating_expenses', 'depreciation_expense', 'income_tax_expense', 'dividends',
])

function roundAmount(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function suggestUaeDemoAccountLine(accountName) {
  const name = String(accountName || '').toLowerCase()
  const rules = [
    [/cash|bank/, 'cash'],
    [/receivable|accounts receivable|debtor/, 'trade_receivables'],
    [/inventory|inventories|stock/, 'inventory'],
    [/accumulated depreciation|accumulated amortisation/, 'accumulated_depreciation'],
    [/revaluation.*(?:ppe|property|plant|equipment)|(?:ppe|property|plant|equipment).*revaluation/, 'ppe_revaluation_adjustment'],
    [/property|plant|equipment|fixed asset|\bppe\b/, 'property_plant_equipment'],
    [/payable|accounts payable|creditor/, 'trade_payables'],
    [/borrow|loan|bank facility/, 'borrowings'],
    [/share capital|capital stock/, 'share_capital'],
    [/retained earning|opening reserve/, 'retained_earnings'],
    [/cost of sales|cost of goods|direct cost/, 'cost_of_sales'],
    [/revenue|sales|service income/, 'revenue'],
    [/other income|interest income/, 'other_income'],
    [/depreciation|amortisation expense/, 'depreciation_expense'],
    [/other comprehensive income|oci.*revaluation|revaluation.*oci/, 'other_comprehensive_income'],
    [/revaluation surplus|revaluation reserve/, 'revaluation_surplus'],
    [/income tax|corporate tax/, 'income_tax_expense'],
    [/dividend/, 'dividends'],
    [/expense|salary|rent|utilities|insurance|professional fee/, 'operating_expenses'],
  ]
  return rules.find(([pattern]) => pattern.test(name))?.[1] || null
}

function rowLine(row, mappings) {
  const nameKey = String(row.name || '').trim().toLowerCase()
  const explicit = mappings instanceof Map
    ? mappings.get(String(row.id)) || mappings.get(String(row.ledger_code || '').trim().toLowerCase()) || mappings.get(nameKey)
    : mappings?.[String(row.id)] || mappings?.[String(row.ledger_code || '').trim().toLowerCase()] || mappings?.[nameKey]
  return explicit || suggestUaeDemoAccountLine(row.name)
}

function normalisedBalance(row, lineId, field = 'closing_balance') {
  const balance = Number(row[field] || 0)
  if (!Number.isFinite(balance)) throw new Error(`Trial balance row "${row.name}" has a non-numeric ${field}.`)
  if (Math.abs(balance) < 0.005) return 0
  const expectedDebitNature = DEBIT_NATURED.has(lineId)
  if (expectedDebitNature ? balance > 0 : balance < 0) {
    throw new Error(`Trial balance sign for "${row.name}" conflicts with its ${LINE_BY_ID.get(lineId)?.label || lineId} classification.`)
  }
  return roundAmount(expectedDebitNature ? -balance : balance)
}

function mappedRows(rows, mappings, periodName) {
  const result = []
  const unmapped = []
  for (const row of rows || []) {
    const lineId = rowLine(row, mappings)
    if (!lineId) {
      if (Math.abs(Number(row.closing_balance || 0)) >= 0.005) unmapped.push(row.name)
      continue
    }
    if (!LINE_BY_ID.has(lineId)) throw new Error(`Unsupported UAE demonstration mapping "${lineId}".`)
    result.push({
      ...row,
      lineId,
      amount: normalisedBalance(row, lineId),
      openingAmount: normalisedBalance(row, lineId, 'opening_balance'),
      periodName,
    })
  }
  if (unmapped.length) throw new Error(`Map every non-zero ledger before generating statements: ${unmapped.join(', ')}.`)
  return result
}

function sumLine(rows, lineId, field = 'amount') {
  return roundAmount(rows.filter(row => row.lineId === lineId).reduce((sum, row) => sum + Number(row[field] || 0), 0))
}

function getComparativeBalance(rows, lineId) {
  return roundAmount(rows.filter(row => row.lineId === lineId).reduce((sum, row) => sum + row.amount, 0))
}

function profitAndLoss(rows) {
  const revenue = sumLine(rows, 'revenue') + sumLine(rows, 'other_income')
  const costOfSales = sumLine(rows, 'cost_of_sales')
  const operatingExpenses = sumLine(rows, 'operating_expenses')
  const depreciation = sumLine(rows, 'depreciation_expense')
  const profitBeforeTax = roundAmount(revenue - costOfSales - operatingExpenses - depreciation)
  const tax = sumLine(rows, 'income_tax_expense')
  const otherComprehensiveIncome = sumLine(rows, 'other_comprehensive_income')
  const profitForYear = roundAmount(profitBeforeTax - tax)
  return {
    revenue: roundAmount(sumLine(rows, 'revenue')),
    otherIncome: roundAmount(sumLine(rows, 'other_income')),
    costOfSales,
    operatingExpenses,
    depreciation,
    profitBeforeTax,
    tax,
    profitForYear,
    otherComprehensiveIncome,
    totalComprehensiveIncome: roundAmount(profitForYear + otherComprehensiveIncome),
  }
}

function statementOfFinancialPosition(rows, profit) {
  const cash = sumLine(rows, 'cash')
  const receivables = sumLine(rows, 'trade_receivables')
  const inventory = sumLine(rows, 'inventory')
  const ppeCost = sumLine(rows, 'property_plant_equipment')
  const ppeRevaluationAdjustment = sumLine(rows, 'ppe_revaluation_adjustment')
  const accumulatedDepreciation = sumLine(rows, 'accumulated_depreciation')
  const ppeNet = roundAmount(ppeCost + ppeRevaluationAdjustment - accumulatedDepreciation)
  const assets = roundAmount(cash + receivables + inventory + ppeNet)
  const payables = sumLine(rows, 'trade_payables')
  const borrowings = sumLine(rows, 'borrowings')
  const liabilities = roundAmount(payables + borrowings)
  const shareCapital = sumLine(rows, 'share_capital')
  const retainedBroughtForward = sumLine(rows, 'retained_earnings')
  const dividends = sumLine(rows, 'dividends')
  const retainedClosing = roundAmount(retainedBroughtForward + profit.profitForYear - dividends)
  const revaluationSurplus = roundAmount(sumLine(rows, 'revaluation_surplus') + profit.otherComprehensiveIncome)
  const equity = roundAmount(shareCapital + retainedClosing + revaluationSurplus)
  const totalLiabilitiesAndEquity = roundAmount(liabilities + equity)
  return {
    cash, receivables, inventory, ppeCost, ppeRevaluationAdjustment, accumulatedDepreciation, ppeNet, assets,
    payables, borrowings, liabilities, shareCapital, retainedBroughtForward,
    retainedClosing, revaluationSurplus, equity, totalLiabilitiesAndEquity,
    difference: roundAmount(assets - totalLiabilitiesAndEquity),
  }
}

function changeInLine(rows, previousRows, lineId) {
  return roundAmount(sumLine(rows, lineId) - getComparativeBalance(previousRows, lineId))
}

function cashFlowStatement(rows, previousRows, profit) {
  const depreciation = sumLine(rows, 'depreciation_expense')
  const receivablesChange = changeInLine(rows, previousRows, 'trade_receivables')
  const inventoryChange = changeInLine(rows, previousRows, 'inventory')
  const payablesChange = changeInLine(rows, previousRows, 'trade_payables')
  const operating = roundAmount(profit.profitForYear + depreciation - receivablesChange - inventoryChange + payablesChange)
  const ppeAdditions = changeInLine(rows, previousRows, 'property_plant_equipment')
  const investing = roundAmount(-ppeAdditions)
  const borrowingChange = changeInLine(rows, previousRows, 'borrowings')
  const shareCapitalChange = changeInLine(rows, previousRows, 'share_capital')
  const dividends = sumLine(rows, 'dividends')
  const financing = roundAmount(borrowingChange + shareCapitalChange - dividends)
  const netMovement = roundAmount(operating + investing + financing)
  const openingCash = getComparativeBalance(previousRows, 'cash')
  const closingCash = sumLine(rows, 'cash')
  const difference = roundAmount(openingCash + netMovement - closingCash)
  return {
    operating, investing, financing, netMovement, openingCash, closingCash, difference,
    details: {
      profitForYear: profit.profitForYear,
      depreciation,
      receivablesChange,
      inventoryChange,
      payablesChange,
      ppeAdditions,
      noncashPpeRevaluation: changeInLine(rows, previousRows, 'ppe_revaluation_adjustment'),
      borrowingChange,
      shareCapitalChange,
      dividends,
    },
  }
}

function equityMovement(rows, profit, position) {
  const shareOpening = sumLine(rows, 'share_capital', 'openingAmount')
  const shareClosing = position.shareCapital
  const retainedOpening = sumLine(rows, 'retained_earnings', 'openingAmount')
  const retainedRawClosing = sumLine(rows, 'retained_earnings')
  const otherRetainedMovement = roundAmount(retainedRawClosing - retainedOpening)
  const dividends = sumLine(rows, 'dividends')
  const retainedClosing = roundAmount(retainedOpening + otherRetainedMovement + profit.profitForYear - dividends)
  const revaluationSurplusOpening = sumLine(rows, 'revaluation_surplus', 'openingAmount')
  const revaluationSurplusAccountMovement = roundAmount(
    sumLine(rows, 'revaluation_surplus') - revaluationSurplusOpening
  )
  const revaluationSurplusMovement = roundAmount(
    revaluationSurplusAccountMovement + profit.otherComprehensiveIncome
  )
  const revaluationSurplusClosing = roundAmount(revaluationSurplusOpening + revaluationSurplusMovement)
  return {
    shareOpening,
    shareMovement: roundAmount(shareClosing - shareOpening),
    shareClosing,
    retainedOpening,
    otherRetainedMovement,
    profitForYear: profit.profitForYear,
    dividends,
    retainedClosing,
    revaluationSurplusOpening,
    revaluationSurplusMovement,
    revaluationSurplusClosing,
    totalClosing: roundAmount(shareClosing + retainedClosing + revaluationSurplusClosing),
    difference: roundAmount(position.equity - (shareClosing + retainedClosing + revaluationSurplusClosing)),
  }
}

function noteTotal(number, profit, position) {
  switch (number) {
    case 1: return position.cash
    case 2: return position.receivables
    case 3: return position.inventory
    case 4: return position.ppeNet
    case 5: return position.payables
    case 6: return position.borrowings
    case 7: return position.equity
    case 8: return roundAmount(profit.revenue + profit.otherIncome)
    case 9: return roundAmount(profit.costOfSales + profit.operatingExpenses + profit.depreciation)
    case 10: return profit.tax
    case 11: return profit.otherComprehensiveIncome
    default: return 0
  }
}

export function validateUaeDemoDisclosureTotals(financials, disclosureTotals) {
  for (const disclosure of disclosureTotals || []) {
    const noteNumber = Number(disclosure.noteNumber)
    const note = financials.notes.find(item => item.number === noteNumber)
    if (!note) throw new Error(`Disclosure total refers to missing UAE Note ${noteNumber}.`)
    for (const [period, supplied, statementTotal] of [
      ['current', disclosure.currentTotal, note.currentTotal],
      ['comparative', disclosure.comparativeTotal, note.comparativeTotal],
    ]) {
      if (supplied === undefined) continue
      const amount = Number(supplied)
      if (!Number.isFinite(amount)) {
        throw new Error(`Enter a numeric ${period} total for UAE Note ${noteNumber}.`)
      }
      const difference = roundAmount(amount - statementTotal)
      if (Math.abs(difference) > 0.01) {
        throw new Error(
          `UAE Note ${noteNumber} ${period} disclosure total differs from its statement balance by AED ${difference.toFixed(2)}. Reconcile the supporting schedule before reporting.`
        )
      }
    }
  }
  return true
}

export function buildUaeDemoFinancials({
  currentRows,
  comparativeRows,
  mappings,
  periodEnd,
  comparativePeriodEnd,
  disclosureTotals,
}) {
  if (!Array.isArray(comparativeRows) || comparativeRows.length === 0 || !comparativePeriodEnd) {
    throw new Error('Import and select a prior-year comparative Trial Balance before generating UAE statements.')
  }
  const current = mappedRows(currentRows, mappings, periodEnd)
  const comparativeMappings = mappings instanceof Map ? new Map(mappings) : new Map(Object.entries(mappings || {}))
  for (const row of current) {
    if (row.ledger_code) comparativeMappings.set(String(row.ledger_code).trim().toLowerCase(), row.lineId)
    comparativeMappings.set(String(row.name || '').trim().toLowerCase(), row.lineId)
  }
  const comparative = mappedRows(comparativeRows, comparativeMappings, comparativePeriodEnd)
  const sourceBalance = roundAmount(current.reduce((sum, row) => sum + Number(row.closing_balance || 0), 0))
  const comparativeSourceBalance = roundAmount(comparative.reduce((sum, row) => sum + Number(row.closing_balance || 0), 0))
  if (Math.abs(sourceBalance) > 0.01) throw new Error(`Final Trial Balance does not balance: AED ${sourceBalance.toFixed(2)}.`)
  if (Math.abs(comparativeSourceBalance) > 0.01) throw new Error(`Comparative Trial Balance does not balance: AED ${comparativeSourceBalance.toFixed(2)}.`)

  const currentProfit = profitAndLoss(current)
  const priorProfit = profitAndLoss(comparative)
  const currentPosition = statementOfFinancialPosition(current, currentProfit)
  const priorPosition = statementOfFinancialPosition(comparative, priorProfit)
  const currentEquity = equityMovement(current, currentProfit, currentPosition)
  const priorEquity = equityMovement(comparative, priorProfit, priorPosition)
  const openingComparative = comparative.map(row => ({
    ...row,
    amount: row.openingAmount,
  }))
  const currentCashFlow = cashFlowStatement(current, comparative, currentProfit)
  const comparativeCashFlow = cashFlowStatement(comparative, openingComparative, priorProfit)

  for (const [name, difference] of [
    ['current financial position', currentPosition.difference],
    ['comparative financial position', priorPosition.difference],
    ['current changes in equity', currentEquity.difference],
    ['comparative changes in equity', priorEquity.difference],
    ['current cash flow', currentCashFlow.difference],
    ['comparative cash flow', comparativeCashFlow.difference],
  ]) {
    if (Math.abs(difference) > 0.01) throw new Error(`${name} does not reconcile: AED ${difference.toFixed(2)}.`)
  }

  const noteData = new Map()
  for (const line of UAE_DEMO_ACCOUNT_LINES) {
    const currentRowsForLine = current.filter(row => row.lineId === line.id)
    const priorRowsForLine = comparative.filter(row => row.lineId === line.id)
    if (!currentRowsForLine.length && !priorRowsForLine.length) continue
    const existing = noteData.get(line.note) || { number: line.note, title: `Note ${line.note}`, accounts: [] }
    for (const row of currentRowsForLine) {
      const currentAmount = row.lineId === 'accumulated_depreciation' ? -row.amount : row.amount
      existing.accounts.push({
        name: row.name,
        current: currentAmount,
        comparative: roundAmount(priorRowsForLine
          .filter(prior => (row.ledger_code && row.ledger_code === prior.ledger_code) || row.name === prior.name)
          .reduce((sum, prior) => sum + (row.lineId === 'accumulated_depreciation' ? -prior.amount : prior.amount), 0)),
      })
    }
    noteData.set(line.note, existing)
  }

  const equityNote = noteData.get(7)
  if (equityNote) {
    equityNote.accounts = [
      { name: 'Share capital at year end', current: currentEquity.shareClosing, comparative: priorEquity.shareClosing },
      { name: 'Retained earnings at start of year', current: currentEquity.retainedOpening, comparative: priorEquity.retainedOpening },
      { name: 'Other retained earnings movements', current: currentEquity.otherRetainedMovement, comparative: priorEquity.otherRetainedMovement },
      { name: 'Profit for the year', current: currentEquity.profitForYear, comparative: priorEquity.profitForYear },
      { name: 'Dividends', current: -currentEquity.dividends, comparative: -priorEquity.dividends },
      { name: 'Revaluation surplus at start of year', current: currentEquity.revaluationSurplusOpening, comparative: priorEquity.revaluationSurplusOpening },
      { name: 'Other comprehensive income - revaluation', current: currentEquity.revaluationSurplusMovement, comparative: priorEquity.revaluationSurplusMovement },
    ]
  }

  for (const note of noteData.values()) {
    note.currentTotal = noteTotal(note.number, currentProfit, currentPosition)
    note.comparativeTotal = noteTotal(note.number, priorProfit, priorPosition)
  }

  const financials = {
    sourceBalance,
    comparativeSourceBalance,
    current: {
      profit: currentProfit,
      position: currentPosition,
      equity: currentEquity,
      cashFlow: currentCashFlow,
    },
    comparative: {
      profit: priorProfit,
      position: priorPosition,
      equity: priorEquity,
      cashFlow: comparativeCashFlow,
    },
    notes: [...noteData.values()].sort((left, right) => left.number - right.number),
    periods: { current: periodEnd, comparative: comparativePeriodEnd },
  }
  validateUaeDemoDisclosureTotals(financials, disclosureTotals)
  return financials
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

function amount(value) {
  const absolute = Math.abs(Number(value || 0))
  const formatted = absolute.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return Number(value || 0) < 0 ? `(${formatted})` : formatted
}

function statementTable(rows, currentLabel, priorLabel) {
  return `<table><thead><tr><th>Account</th><th>${escapeHtml(currentLabel)}</th><th>${escapeHtml(priorLabel)}</th></tr></thead><tbody>${rows
    .map(row => `<tr class="${row.total ? 'total' : ''}"><td>${escapeHtml(row.label)}</td><td>${amount(row.current)}</td><td>${amount(row.comparative)}</td></tr>`)
    .join('')}</tbody></table>`
}

function page(title, content, number, totalPages, engagementName) {
  return `<section class="report-page"><div class="draft">DRAFT FOR DEMONSTRATION</div><h1>${escapeHtml(title)}</h1>${content}<footer>${escapeHtml(engagementName)} · AED · Draft for demonstration · Page ${number} of ${totalPages}</footer></section>`
}

export function buildUaeDemoFinancialsHtml({ financials, entity, engagement, bundle }) {
  const currentLabel = `31 December ${String(financials.periods.current).slice(0, 4)}`
  const priorLabel = `31 December ${String(financials.periods.comparative).slice(0, 4)}`
  const current = financials.current
  const prior = financials.comparative
  const statementPages = [
    {
      title: 'Statement of financial position',
      rows: [
        { label: 'Cash and cash equivalents · Note 1', current: current.position.cash, comparative: prior.position.cash },
        { label: 'Trade receivables · Note 2', current: current.position.receivables, comparative: prior.position.receivables },
        { label: 'Inventories · Note 3', current: current.position.inventory, comparative: prior.position.inventory },
        { label: 'Property and equipment, net · Note 4', current: current.position.ppeNet, comparative: prior.position.ppeNet },
        { label: 'Total assets', current: current.position.assets, comparative: prior.position.assets, total: true },
        { label: 'Trade payables · Note 5', current: current.position.payables, comparative: prior.position.payables },
        { label: 'Borrowings · Note 6', current: current.position.borrowings, comparative: prior.position.borrowings },
        { label: 'Total liabilities', current: current.position.liabilities, comparative: prior.position.liabilities, total: true },
        { label: 'Share capital · Note 7', current: current.position.shareCapital, comparative: prior.position.shareCapital },
        { label: 'Retained earnings · Note 7', current: current.position.retainedClosing, comparative: prior.position.retainedClosing },
        { label: 'Total equity', current: current.position.equity, comparative: prior.position.equity, total: true },
        { label: 'Total liabilities and equity', current: current.position.totalLiabilitiesAndEquity, comparative: prior.position.totalLiabilitiesAndEquity, total: true },
      ],
    },
    {
      title: 'Statement of profit or loss and other comprehensive income',
      rows: [
        { label: 'Revenue · Note 8', current: current.profit.revenue, comparative: prior.profit.revenue },
        { label: 'Other income · Note 8', current: current.profit.otherIncome, comparative: prior.profit.otherIncome },
        { label: 'Cost of sales · Note 9', current: -current.profit.costOfSales, comparative: -prior.profit.costOfSales },
        { label: 'Operating expenses · Note 9', current: -current.profit.operatingExpenses, comparative: -prior.profit.operatingExpenses },
        { label: 'Depreciation · Note 9', current: -current.profit.depreciation, comparative: -prior.profit.depreciation },
        { label: 'Profit before tax', current: current.profit.profitBeforeTax, comparative: prior.profit.profitBeforeTax, total: true },
        { label: 'Income tax expense · Note 10', current: -current.profit.tax, comparative: -prior.profit.tax },
        { label: 'Profit for the year', current: current.profit.profitForYear, comparative: prior.profit.profitForYear, total: true },
        { label: 'Other comprehensive income · Note 11', current: current.profit.otherComprehensiveIncome, comparative: prior.profit.otherComprehensiveIncome },
        { label: 'Total comprehensive income', current: current.profit.totalComprehensiveIncome, comparative: prior.profit.totalComprehensiveIncome, total: true },
      ],
    },
    {
      title: 'Statement of changes in equity',
      rows: [
        { label: 'Share capital at start of year', current: current.equity.shareOpening, comparative: prior.equity.shareOpening },
        { label: 'Share capital movements', current: current.equity.shareMovement, comparative: prior.equity.shareMovement },
        { label: 'Share capital at year end', current: current.equity.shareClosing, comparative: prior.equity.shareClosing, total: true },
        { label: 'Retained earnings at start of year', current: current.equity.retainedOpening, comparative: prior.equity.retainedOpening },
        { label: 'Other retained earnings movements', current: current.equity.otherRetainedMovement, comparative: prior.equity.otherRetainedMovement },
        { label: 'Profit for the year', current: current.equity.profitForYear, comparative: prior.equity.profitForYear },
        { label: 'Dividends', current: -current.equity.dividends, comparative: -prior.equity.dividends },
        { label: 'Retained earnings at year end', current: current.equity.retainedClosing, comparative: prior.equity.retainedClosing, total: true },
        { label: 'Revaluation surplus at start of year', current: current.equity.revaluationSurplusOpening, comparative: prior.equity.revaluationSurplusOpening },
        { label: 'Other comprehensive income - revaluation', current: current.equity.revaluationSurplusMovement, comparative: prior.equity.revaluationSurplusMovement },
        { label: 'Revaluation surplus at year end', current: current.equity.revaluationSurplusClosing, comparative: prior.equity.revaluationSurplusClosing, total: true },
        { label: 'Total equity at year end', current: current.equity.totalClosing, comparative: prior.equity.totalClosing, total: true },
      ],
    },
    {
      title: 'Statement of cash flows',
      rows: [
        { label: 'Profit for the year', current: current.cashFlow.details.profitForYear, comparative: prior.cashFlow.details.profitForYear },
        { label: 'Depreciation adjustment', current: current.cashFlow.details.depreciation, comparative: prior.cashFlow.details.depreciation },
        { label: 'Increase in trade receivables', current: -current.cashFlow.details.receivablesChange, comparative: -prior.cashFlow.details.receivablesChange },
        { label: 'Increase in inventories', current: -current.cashFlow.details.inventoryChange, comparative: -prior.cashFlow.details.inventoryChange },
        { label: 'Movement in trade payables', current: current.cashFlow.details.payablesChange, comparative: prior.cashFlow.details.payablesChange },
        { label: 'Net cash from operating activities', current: current.cashFlow.operating, comparative: prior.cashFlow.operating, total: true },
        { label: 'Property and equipment additions / disposals', current: current.cashFlow.investing, comparative: prior.cashFlow.investing },
        { label: 'Net cash used in investing activities', current: current.cashFlow.investing, comparative: prior.cashFlow.investing, total: true },
        { label: 'Borrowings and share capital movements', current: current.cashFlow.details.borrowingChange + current.cashFlow.details.shareCapitalChange, comparative: prior.cashFlow.details.borrowingChange + prior.cashFlow.details.shareCapitalChange },
        { label: 'Dividends paid', current: -current.cashFlow.details.dividends, comparative: -prior.cashFlow.details.dividends },
        { label: 'Net cash from financing activities', current: current.cashFlow.financing, comparative: prior.cashFlow.financing, total: true },
        { label: 'Non-cash PPE revaluation (excluded from cash flows)', current: current.cashFlow.details.noncashPpeRevaluation, comparative: prior.cashFlow.details.noncashPpeRevaluation },
        { label: 'Net increase in cash', current: current.cashFlow.netMovement, comparative: prior.cashFlow.netMovement, total: true },
        { label: 'Cash at start of year', current: current.cashFlow.openingCash, comparative: prior.cashFlow.openingCash },
        { label: 'Cash at end of year', current: current.cashFlow.closingCash, comparative: prior.cashFlow.closingCash, total: true },
      ],
    },
  ]
  const notePages = financials.notes.map(note => {
    const narrative = bundle.noteDisclosures?.find(item => Number(item.note_num) === note.number)?.text || ''
    const accounts = note.accounts
    return {
      title: `Note ${note.number} - ${note.title}`,
      html: `<p>${escapeHtml(narrative || 'Supporting account balances derived from the saved final Trial Balance.')}</p>${statementTable([
        ...accounts.map(account => ({ label: account.name, current: account.current, comparative: account.comparative })),
        { label: 'Note total', current: note.currentTotal, comparative: note.comparativeTotal, total: true },
      ], currentLabel, priorLabel)}`,
    }
  })
  const contents = [
    'Auditor-entered report',
    ...statementPages.map(item => item.title),
    ...notePages.map(item => item.title),
    'Financial statement approval',
  ]
  const reportFields = bundle.auditReport?.fields || {}
  const branding = bundle.firmSettings?.branding
  const logo = branding?.logoBase64 && ['image/png', 'image/jpeg'].includes(branding.logoMimeType)
    ? `<img class="logo" alt="" src="data:${branding.logoMimeType};base64,${branding.logoBase64}">`
    : ''
  const auditSections = [
    ['Opinion', reportFields.opinion],
    ['Basis for opinion', reportFields.basisForOpinion],
    ['Management responsibilities', reportFields.managementResponsibilities],
    ['Auditor responsibilities', reportFields.auditorResponsibilities],
    ['Other matters', reportFields.otherMatters],
  ].filter(([, text]) => String(text || '').trim())
    .map(([title, text]) => `<h2>${escapeHtml(title)}</h2><p>${escapeHtml(text).replace(/\r?\n/g, '<br>')}</p>`).join('')
  const auditContent = `
    <header>${logo}<h2>${escapeHtml(entity.name)}</h2><p>Year ended ${escapeHtml(currentLabel)}</p></header>
    <p><strong>${escapeHtml(reportFields.addressee)}</strong></p>${auditSections}
    <div class="signature"><p>${escapeHtml(reportFields.reportPlace)} · ${escapeHtml(reportFields.reportDate)}</p>
    <strong>${escapeHtml(reportFields.auditorName)}</strong><p>${escapeHtml(reportFields.auditorDesignation)}</p>
    <p>${escapeHtml(reportFields.firmName)} · ${escapeHtml(reportFields.firmRegistrationNumber)}</p>
    <p>${escapeHtml(reportFields.firmAddress)}</p></div>`
  const pages = [
    {
      title: 'Contents',
      content: `<p>${escapeHtml(entity.name)} · ${escapeHtml(engagement.name)} · ${escapeHtml(currentLabel)} · AED</p>
        <table><tbody>${contents.map((title, index) => `<tr><td>${escapeHtml(title)}</td><td>${index + 2}</td></tr>`).join('')}</tbody></table>`,
    },
    { title: 'Auditor-entered report', content: auditContent },
    ...statementPages.map(item => ({
      title: item.title,
      content: `<p>${escapeHtml(entity.name)} · AED</p>${statementTable(item.rows, currentLabel, priorLabel)}`,
    })),
    ...notePages.map(item => ({ title: item.title, content: item.html })),
    { title: 'Financial statement approval', content: `
      <p>The financial statements were approved on ${escapeHtml(bundle.approvalDate)} at ${escapeHtml(bundle.approvalPlace)}.</p>
      <ol>${(bundle.approvalSignatories || []).map(item => `<li><strong>${escapeHtml(item.name)}</strong>${item.designation ? ` · ${escapeHtml(item.designation)}` : ''}</li>`).join('')}</ol>
    ` },
  ]
  const styles = `
    <style>
      @page{size:A4;margin:15mm}
      *{box-sizing:border-box}
      html,body{margin:0}
      body{font-family:Arial,sans-serif;color:#17202a;font-size:10pt}
      .report-page{position:relative;min-height:260mm;padding:6mm 4mm 14mm;page-break-after:always}
      .report-page:last-child{page-break-after:auto}
      .draft{position:absolute;top:0;right:0;color:#9a3412;border:1px solid #c2410c;padding:3px 8px;font-size:8pt;font-weight:700;letter-spacing:.08em}
      h1{font-size:17pt;margin:13mm 0 8mm;border-bottom:1px solid #334155;padding-bottom:3mm}
      h2{font-size:12pt;margin:3mm 0}
      p{line-height:1.45;white-space:pre-wrap}
      table{width:100%;border-collapse:collapse;margin-top:5mm}
      th,td{padding:2.2mm 2mm;border-bottom:1px solid #cbd5e1;text-align:right}
      th:first-child,td:first-child{text-align:left}
      th{background:#f1f5f9}
      tr.total{font-weight:700;border-top:1px solid #334155}
      .signature{margin-top:12mm}
      .logo{display:block;width:60mm;height:15mm;object-fit:contain;margin:0 auto 4mm}
      header{text-align:center;margin-bottom:8mm}
      footer{position:absolute;bottom:4mm;left:4mm;right:4mm;border-top:1px solid #cbd5e1;padding-top:2mm;color:#7c2d12;font-size:8pt}
    </style>`
  const engagementName = engagement.name || 'UAE synthetic engagement'
  const renderedPages = pages.map((item, index) => page(item.title, item.content, index + 1, pages.length, engagementName)).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(engagementName)} - Draft for demonstration</title>${styles}</head><body>${renderedPages}</body></html>`
}
