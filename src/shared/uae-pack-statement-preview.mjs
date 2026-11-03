// Provisional Balance Sheet / P&L preview derived only from final-TB ledger balances and the
// pack's line assignments. Reference statement figures are validation evidence, never inputs.
const round2 = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100
const ASSET_SECTIONS = new Set(['Non-current assets', 'Current assets'])

// Confirmed mapping first; otherwise the reviewed-pending suggestion; otherwise an exception.
function effectiveLine(row) {
  if (row.status === 'confirmed' && row.lineKey) return { lineKey: row.lineKey, basis: 'confirmed' }
  if (row.suggestedLineKey) return { lineKey: row.suggestedLineKey, basis: 'suggested' }
  return null
}

function buildStatementPreview(review) {
  const lines = review.pack.lines
  const lineByKey = new Map(lines.map(line => [line.key, line]))
  const byLine = new Map(lines.map(line => [line.key, []]))
  const exceptions = []
  const seen = new Set()
  let duplicateRows = 0
  let tbNet = 0
  for (const row of review.rows) {
    if (seen.has(row.id)) duplicateRows += 1
    seen.add(row.id)
    tbNet += row.balance
    const effective = effectiveLine(row)
    if (effective && lineByKey.has(effective.lineKey)) byLine.get(effective.lineKey).push({ ...row, basis: effective.basis })
    else exceptions.push(row)
  }
  const sections = { SFP: new Map(), PL: new Map() }
  const lineRows = []
  for (const line of lines) {
    const members = byLine.get(line.key)
    const net = members.reduce((sum, row) => sum + row.balance, 0)
    // Final-TB balances are credit-positive (debits negative): assets are shown negated, everything else as stored.
    const amount = round2(line.statement === 'SFP' && ASSET_SECTIONS.has(line.section) ? -net : net)
    const suggestedCount = members.filter(row => row.basis === 'suggested').length
    const entry = { ...line, amount, net: round2(net), members, suggestedCount, confirmedCount: members.length - suggestedCount }
    lineRows.push(entry)
    if (!sections[line.statement].has(line.section)) sections[line.statement].set(line.section, [])
    sections[line.statement].get(line.section).push(entry)
  }
  const sectionTotal = (statement, section) => round2((sections[statement].get(section) || []).reduce((sum, line) => sum + line.amount, 0))
  // Accounts awaiting classification are presentation placeholders only: debit balances sit under assets and
  // credit balances under liabilities so every non-zero ledger appears once. Nothing is saved or journalled.
  const debitExceptions = exceptions.filter(row => row.balance < 0)
  const creditExceptions = exceptions.filter(row => row.balance > 0)
  const unclassified = {
    debit: { rows: debitExceptions, count: debitExceptions.length, amount: round2(-debitExceptions.reduce((sum, row) => sum + row.balance, 0)) },
    credit: { rows: creditExceptions, count: creditExceptions.length, amount: round2(creditExceptions.reduce((sum, row) => sum + row.balance, 0)) },
  }
  const totalNonCurrent = sectionTotal('SFP', 'Non-current assets')
  const totalCurrent = sectionTotal('SFP', 'Current assets')
  const totalAssets = round2(totalNonCurrent + totalCurrent + unclassified.debit.amount)
  const totalEquityBeforeProfit = sectionTotal('SFP', 'Equity')
  const totalClassifiedLiabilities = sectionTotal('SFP', 'Liabilities')
  const totalLiabilities = round2(totalClassifiedLiabilities + unclassified.credit.amount)
  const plLines = lineRows.filter(line => line.statement === 'PL')
  const profit = round2(plLines.reduce((sum, line) => sum + line.amount, 0))
  // Profit is always derived from the classified P&L ledgers present in the TB. A pre-closing TB carries
  // P&L balances and a retained-earnings balance that excludes them, so profit is added to equity once. An
  // already-closed TB carries no P&L balances (profit already sits in retained earnings), so nothing is added.
  const plLedgerCount = plLines.reduce((sum, line) => sum + line.members.length, 0)
  const closing = plLedgerCount
    ? { treatment: 'pre-closing', plLedgerCount, note: `${plLedgerCount} classified P&L ledgers carry balances, so the TB is pre-closing and profit is added to equity once.` }
    : { treatment: 'closed-or-no-pl', plLedgerCount, note: 'No classified P&L ledger carries a balance: either the TB is already closed (profit is in retained earnings) or P&L ledgers are still unclassified. Nothing is added to equity.' }
  const totalEquity = round2(totalEquityBeforeProfit + profit)
  const totalEquityAndLiabilities = round2(totalEquity + totalLiabilities)
  const unresolvedNet = round2(exceptions.reduce((sum, row) => sum + row.balance, 0))
  const unresolvedAbsolute = round2(exceptions.reduce((sum, row) => sum + Math.abs(row.balance), 0))
  const totalAbsolute = round2(review.rows.reduce((sum, row) => sum + Math.abs(row.balance), 0))
  const difference = round2(totalAssets - totalEquityAndLiabilities)
  const placed = lineRows.reduce((sum, line) => sum + line.members.length, 0)
  const placedNet = lineRows.reduce((sum, line) => sum + line.net, 0)
  // Every non-zero ledger is in exactly one line or one unclassified placeholder. With credit-positive balances
  // assets = -(asset net) - (debit placeholder net), equity+liabilities = (equity net) + (liability net) +
  // (credit placeholder net) + profit, so difference = -(source TB net): zero for a balanced TB. Profit counted
  // twice (or omitted) would break that identity.
  const arithmetic = [
    { kind: 'arithmetic', label: 'Every non-zero ledger appears exactly once (statement lines + unclassified lines = review rows)', passed: placed + exceptions.length === review.rows.length && duplicateRows === 0, detail: `${placed} placed + ${exceptions.length} unclassified = ${review.rows.length} accounts; ${duplicateRows} duplicates` },
    { kind: 'arithmetic', label: 'Sum of statement-line ledger balances + unclassified balances equals the source TB net', passed: Math.abs(placedNet + unresolvedNet - tbNet) < 0.01, detail: `${round2(placedNet)} + ${unresolvedNet} vs ${round2(tbNet)}` },
    { kind: 'arithmetic', label: 'Source final TB net is zero (otherwise the TB itself is out of balance, or profit is already in retained earnings while P&L ledgers still carry balances)', passed: Math.abs(tbNet) < 0.01, detail: `source TB net ${round2(tbNet)}` },
    { kind: 'arithmetic', label: 'Balance Sheet difference equals minus the source TB net (profit closed into equity once)', passed: Math.abs(difference + tbNet) < 0.01, detail: `difference ${difference}; source TB net ${round2(tbNet)}; profit ${profit} added to equity once (${closing.treatment})` },
  ]
  const classification = {
    kind: 'classification', complete: exceptions.length === 0,
    label: exceptions.length === 0 ? 'Classification complete: every non-zero ledger has a line' : `Classification incomplete: ${exceptions.length} accounts await classification (finalisation blocked)`,
    detail: `${unclassified.debit.count} debit (${unclassified.debit.amount}) and ${unclassified.credit.count} credit (${unclassified.credit.amount}) placeholders`,
  }
  const checks = [...arithmetic, { ...classification, passed: classification.complete }]
  return {
    sections, lineRows, exceptions, checks, unclassified, closing, classification, tbNet: round2(tbNet),
    arithmeticReconciled: arithmetic.every(check => check.passed),
    totals: { totalNonCurrent, totalCurrent, totalAssets, totalAssetsClassified: round2(totalNonCurrent + totalCurrent), totalEquity, totalEquityBeforeProfit, totalClassifiedLiabilities, totalLiabilities, totalEquityAndLiabilities, difference, profit },
    coverage: {
      accounts: review.rows.length, unresolvedCount: exceptions.length, unresolvedNet, unresolvedAbsolute, totalAbsolute,
      unresolvedAbsolutePercent: totalAbsolute ? round2((unresolvedAbsolute / totalAbsolute) * 100) : 0,
      suggestedCount: lineRows.reduce((sum, line) => sum + line.suggestedCount, 0),
      confirmedCount: lineRows.reduce((sum, line) => sum + line.confirmedCount, 0),
    },
  }
}

// 31.12.2024 column of the supplied reference statements (Schedules & PL.xlsx, BS and P&L sheets).
// Grouped by the pack lines that correspond to each reference caption. Validation evidence only.
const REFERENCE_2024 = {
  source: 'Schedules & PL.xlsx - BS and P&L sheets, 31.12.2024 column (reference only, not an input)',
  items: [
    { statement: 'SFP', label: 'Property and equipment', reference: 3116834, lines: ['ppe_cost', 'ppe_accumulated_depreciation'] },
    { statement: 'SFP', label: 'Right-of-use asset', reference: 2369559, lines: ['rou_asset_cost', 'rou_asset_accumulated_depreciation'] },
    { statement: 'SFP', label: 'Investment in subsidiary', reference: 49000, lines: ['investment_in_subsidiary'], note: 'Unresolved journal-created ledger "Investment in Subsidiary" (49,000, no code) is excluded and equals this difference. Not classified from its name.' },
    { statement: 'SFP', label: 'Advance for capital expenditure', reference: 82881, lines: ['advance_capital_expenditure'] },
    { statement: 'SFP', label: 'Contract and other receivables', reference: 58066770, lines: ['contract_receivables', 'retentions_receivable', 'contract_assets', 'allowance_credit_losses', 'other_receivables_prepayments'], note: 'Known open receivables difference of 43,160 (reference 58,066,770 against the final TB 58,023,610); unresolved, never used as a balancing input.' },
    { statement: 'SFP', label: 'Due from related parties', reference: 8662392, lines: ['due_from_related_parties'] },
    { statement: 'SFP', label: 'Other current financial assets', reference: 5320289, lines: ['other_current_financial_assets'] },
    { statement: 'SFP', label: 'Cash and cash equivalents', reference: 7344711, lines: ['cash_and_bank'] },
    { statement: 'SFP', label: 'Total assets', reference: 85012436, total: 'totalAssetsClassified', note: 'Classified lines only (the unclassified debit placeholder is excluded from this comparison). Difference 92,160 = 49,000 excluded subsidiary-investment ledger + 43,160 receivables difference.' },
    { statement: 'SFP', label: 'Share capital', reference: 300000, lines: ['share_capital'] },
    { statement: 'SFP', label: 'Statutory reserve', reference: 150000, lines: ['statutory_reserve'] },
    { statement: 'SFP', label: "Provision for employees' end of service benefits", reference: 3820456, lines: ['employee_end_of_service'] },
    { statement: 'SFP', label: 'Lease liabilities (non-current + current)', reference: 2478470, lines: ['lease_liabilities'], note: 'Reference splits 1,623,930 non-current and 854,540 current; the draft pack has one line.' },
    { statement: 'SFP', label: 'Borrowings (non-current + current)', reference: 763114, lines: ['borrowings'], note: 'Reference also shows a separate 534,618 loan from a third party that the draft pack has no line for.' },
    { statement: 'SFP', label: 'Trade and other payables', reference: 65984831, lines: ['trade_payables', 'contract_liabilities', 'retentions_payable', 'other_payables'], note: 'Unresolved "Due to customers on contracts" (2,536,794) is excluded and, with the 43,160 receivables difference, equals this difference exactly (2,536,794 + 43,160 = 2,579,954). The reference MMTB shows 2,536,794 as "Unearned revenue" (journal-created). Evidence only; classification awaiting decision.' },
    { statement: 'SFP', label: 'Loans from related parties (non-current + current)', reference: 8269372, lines: ['loans_from_related_parties'] },
    { statement: 'SFP', label: 'Due to related parties', reference: 49000, lines: ['due_to_related_parties'], note: 'No mapped ledger carries 49,000 for this caption. The unresolved ledgers "Smart Option - SC" (24,990) and "Andrew - SC" (24,010) total exactly 49,000 (amount match only; names do not state the nature). Not classified; decision required.' },
    { statement: 'SFP', label: 'Provision for tax', reference: 1662826, lines: ['tax_payable'], note: 'Unresolved journal-created "Provision for corporate tax" (1,662,826) is excluded and equals this difference.' },
    { statement: 'PL', label: 'Revenue', reference: 193529582, lines: ['revenue'] },
    { statement: 'PL', label: 'Contract costs', reference: -151281564, lines: ['contract_costs', 'contract_costs_employee'], note: 'All differences are calculated minus reference. Combined with administrative expenses: calculated costs 186,613,341 vs reference 186,862,060 = +248,719 (calculated costs are lower; unexplained). This line is -1,258,427 (calculated costs higher) and administrative is +1,507,146 (calculated costs lower), so -1,258,427 + 1,507,146 = +248,719. The split differs because suggested mappings come from 2025 classifications while the reference groups 2024 costs differently (reference MMTB: cost of contracts 149,534,066). Unresolved cost ledgers also excluded. Account-level reference grouping (SCH sheet) not yet reconciled.' },
    { statement: 'PL', label: 'Contract costs + administrative expenses (combined)', reference: -186862060, lines: ['contract_costs', 'contract_costs_employee', 'administrative_selling_expenses', 'employee_costs', 'directors_remuneration'], note: 'Calculated minus reference = +248,719 (calculated costs are lower than the reference). Unexplained: unresolved cost ledgers are excluded and the reference grouping at account level (SCH sheet) is not yet reconciled.' },
    { statement: 'PL', label: 'Other income', reference: 12275964, lines: ['other_income'], note: 'Unresolved "Royalty fee" (7,974,343) is excluded and equals this difference exactly. Not classified from its name.' },
    { statement: 'PL', label: 'Administrative and selling expenses', reference: -35580496, lines: ['administrative_selling_expenses', 'employee_costs', 'directors_remuneration'], note: 'Calculated minus reference = +1,507,146 (calculated costs lower): it offsets the -1,258,427 contract-cost difference (+1,258,427 reclassification) plus the +248,719 aggregate residual. Unresolved ROU depreciation (848,256) and consultancy (1,107,847) are excluded. Unresolved; not a balancing input.' },
    { statement: 'PL', label: 'Finance costs', reference: -647988, lines: ['finance_costs', 'finance_costs_lease'], note: 'Three unresolved interest ledgers (115,965 + 375,096 + 91,347 = 582,408) are excluded and equal this difference.' },
    { statement: 'PL', label: 'Tax expense', reference: -1662826, lines: ['tax_expense'] },
    { statement: 'PL', label: 'Profit for the year', reference: 16632672, total: 'profit', note: 'Excludes the unresolved income and expense ledgers in the exception panel (for example royalty fee, rebate received, interest, ROU depreciation, consultancy); the two documented AED 1 rounding differences are unresolved.' },
  ],
  notCompared: ['Retained earnings and Shareholders\' current account: the TB holds retained earnings b/fwd (4502, 2,721,906 debit, equal to the reference MMTB 2024 retained earnings) and an unresolved dividends/current-account ledger 4503 (12,911,017 debit, equal to the reference "Shareholders\' current account"); their statement placement is an open decision.'],
}

function compareWithReference(preview) {
  const byKey = new Map(preview.lineRows.map(line => [line.key, line]))
  return REFERENCE_2024.items.map(item => {
    const calculated = item.total
      ? preview.totals[item.total]
      : round2(item.lines.reduce((sum, key) => sum + (byKey.get(key)?.amount || 0), 0))
    // Reference liabilities are positive; reference costs are negative, matching the preview sign.
    const difference = round2(calculated - item.reference)
    const populated = item.total ? true : item.lines.some(key => byKey.get(key)?.members.length)
    return { ...item, calculated, difference, populated }
  })
}

export { buildStatementPreview, compareWithReference, REFERENCE_2024, effectiveLine }
