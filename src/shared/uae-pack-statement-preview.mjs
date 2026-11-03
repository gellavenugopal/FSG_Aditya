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
  const totalNonCurrent = sectionTotal('SFP', 'Non-current assets')
  const totalCurrent = sectionTotal('SFP', 'Current assets')
  const totalAssets = round2(totalNonCurrent + totalCurrent)
  const totalEquity = sectionTotal('SFP', 'Equity')
  const totalLiabilities = sectionTotal('SFP', 'Liabilities')
  const totalEquityAndLiabilities = round2(totalEquity + totalLiabilities)
  const profit = round2(lineRows.filter(line => line.statement === 'PL').reduce((sum, line) => sum + line.amount, 0))
  const unresolvedNet = round2(exceptions.reduce((sum, row) => sum + row.balance, 0))
  const unresolvedAbsolute = round2(exceptions.reduce((sum, row) => sum + Math.abs(row.balance), 0))
  const totalAbsolute = round2(review.rows.reduce((sum, row) => sum + Math.abs(row.balance), 0))
  const difference = round2(totalAssets - totalEquityAndLiabilities)
  const placed = lineRows.reduce((sum, line) => sum + line.members.length, 0)
  const placedNet = lineRows.reduce((sum, line) => sum + line.net, 0)
  // Every non-zero ledger must be in exactly one line or in the exception list. With credit-positive
  // balances: assets = -A, E+L = E+L, profit = P, so difference = -(A) - (E+L) = -(tbNet - P - unresolved).
  const checks = [
    { label: 'Every non-zero ledger appears exactly once (statement lines + exceptions = review rows)', passed: placed + exceptions.length === review.rows.length && duplicateRows === 0, detail: `${placed} placed + ${exceptions.length} exceptions = ${review.rows.length} accounts; ${duplicateRows} duplicates` },
    { label: 'Sum of statement-line ledger balances + exceptions equals the source TB net', passed: Math.abs(placedNet + unresolvedNet - tbNet) < 0.01, detail: `${round2(placedNet)} + ${unresolvedNet} vs ${round2(tbNet)}` },
    { label: 'Balance Sheet difference is explained by TB net, unclosed profit and unresolved net', passed: Math.abs(difference - (profit + unresolvedNet - tbNet)) < 0.01, detail: `difference ${difference} = profit ${profit} + unresolved net ${unresolvedNet} - TB net ${round2(tbNet)}` },
  ]
  return {
    sections, lineRows, exceptions, checks, tbNet: round2(tbNet),
    totals: { totalNonCurrent, totalCurrent, totalAssets, totalEquity, totalLiabilities, totalEquityAndLiabilities, difference, profit },
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
    { statement: 'SFP', label: 'Total assets', reference: 85012436, total: 'totalAssets', note: 'Difference 92,160 = 49,000 excluded subsidiary-investment ledger + 43,160 receivables difference.' },
    { statement: 'SFP', label: 'Share capital', reference: 300000, lines: ['share_capital'] },
    { statement: 'SFP', label: 'Statutory reserve', reference: 150000, lines: ['statutory_reserve'] },
    { statement: 'SFP', label: "Provision for employees' end of service benefits", reference: 3820456, lines: ['employee_end_of_service'] },
    { statement: 'SFP', label: 'Lease liabilities (non-current + current)', reference: 2478470, lines: ['lease_liabilities'], note: 'Reference splits 1,623,930 non-current and 854,540 current; the draft pack has one line.' },
    { statement: 'SFP', label: 'Borrowings (non-current + current)', reference: 763114, lines: ['borrowings'], note: 'Reference also shows a separate 534,618 loan from a third party that the draft pack has no line for.' },
    { statement: 'SFP', label: 'Trade and other payables', reference: 65984831, lines: ['trade_payables', 'contract_liabilities', 'retentions_payable', 'other_payables'], note: 'Unresolved "Due to customers on contracts" (2,536,794) is excluded; the remaining 43,160 equals the open receivables difference. Observation only, not applied.' },
    { statement: 'SFP', label: 'Loans from related parties (non-current + current)', reference: 8269372, lines: ['loans_from_related_parties'] },
    { statement: 'SFP', label: 'Due to related parties', reference: 49000, lines: ['due_to_related_parties'], note: 'No unresolved or mapped ledger carries 49,000 for this caption; unexplained.' },
    { statement: 'SFP', label: 'Provision for tax', reference: 1662826, lines: ['tax_payable'], note: 'Unresolved journal-created "Provision for corporate tax" (1,662,826) is excluded and equals this difference.' },
    { statement: 'PL', label: 'Revenue', reference: 193529582, lines: ['revenue'] },
    { statement: 'PL', label: 'Contract costs', reference: -151281564, lines: ['contract_costs', 'contract_costs_employee'], note: 'Earlier inspection found contract costs not comparable; unresolved. Unclassified cost ledgers may explain part of it.' },
    { statement: 'PL', label: 'Other income', reference: 12275964, lines: ['other_income'], note: 'Unresolved "Royalty fee" (7,974,343) is excluded and equals this difference exactly. Not classified from its name.' },
    { statement: 'PL', label: 'Administrative and selling expenses', reference: -35580496, lines: ['administrative_selling_expenses', 'employee_costs', 'directors_remuneration'], note: 'Unexplained: the split between contract costs and administrative expenses differs from the reference; unresolved cost ledgers (for example consultancy, ROU depreciation) are also excluded.' },
    { statement: 'PL', label: 'Finance costs', reference: -647988, lines: ['finance_costs', 'finance_costs_lease'], note: 'Three unresolved interest ledgers (115,965 + 375,096 + 91,347 = 582,408) are excluded and equal this difference.' },
    { statement: 'PL', label: 'Tax expense', reference: -1662826, lines: ['tax_expense'] },
    { statement: 'PL', label: 'Profit for the year', reference: 16632672, total: 'profit', note: 'Excludes the unresolved income and expense ledgers in the exception panel (for example royalty fee, rebate received, interest, ROU depreciation, consultancy); the two documented AED 1 rounding differences are unresolved.' },
  ],
  notCompared: ['Retained earnings and Shareholders\' current account (reference retained earnings includes current-year profit; the TB equity split is not yet confirmed).'],
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
