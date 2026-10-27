import ExcelJS from 'exceljs'
import { calculateUaeReportDataHash } from './uae-report-data-hash.mjs'

const DEBIT_NATURED = new Set([
  'cash', 'trade_receivables', 'inventory', 'property_plant_equipment',
  'ppe_revaluation_adjustment', 'cost_of_sales', 'operating_expenses',
  'depreciation_expense', 'income_tax_expense', 'dividends',
])

const MAPPING_KEYS = [
  'cash', 'trade_receivables', 'inventory', 'property_plant_equipment',
  'ppe_revaluation_adjustment', 'accumulated_depreciation', 'trade_payables',
  'borrowings', 'share_capital', 'retained_earnings', 'revenue', 'other_income',
  'cost_of_sales', 'operating_expenses', 'depreciation_expense',
  'income_tax_expense', 'other_comprehensive_income', 'revaluation_surplus',
  'dividends',
]

const NOTE_BY_LINE = {
  cash: 1,
  trade_receivables: 2,
  inventory: 3,
  property_plant_equipment: 4,
  ppe_revaluation_adjustment: 4,
  accumulated_depreciation: 4,
  trade_payables: 5,
  borrowings: 6,
  share_capital: 7,
  retained_earnings: 7,
  revaluation_surplus: 7,
  dividends: 7,
  revenue: 8,
  other_income: 8,
  cost_of_sales: 9,
  operating_expenses: 9,
  depreciation_expense: 9,
  income_tax_expense: 10,
  other_comprehensive_income: 11,
}

const NOTE_TITLES = [
  'Cash and cash equivalents',
  'Trade receivables',
  'Inventories',
  'Property and equipment',
  'Trade payables',
  'Borrowings',
  'Equity',
  'Revenue and other income',
  'Expenses',
  'Income tax',
  'Other comprehensive income',
]

function safeNumber(value) {
  const number = Number(value || 0)
  if (!Number.isFinite(number)) throw new Error('Workbook source contains a non-numeric balance.')
  return number
}

function safeText(value, maxLength = 1000) {
  return String(value ?? '').slice(0, maxLength)
}

function styleSheet(sheet, headerRow = 2) {
  sheet.views = [{ state: 'frozen', ySplit: headerRow }]
  sheet.properties.defaultRowHeight = 18
  sheet.getRow(1).height = 26
  sheet.getRow(1).font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } }
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF17365D' } }
  sheet.getRow(headerRow).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  sheet.getRow(headerRow).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF365F91' } }
  sheet.getRow(headerRow).alignment = { vertical: 'middle', wrapText: true }
  sheet.getRow(headerRow).height = 32
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > headerRow) row.alignment = { vertical: 'top', wrapText: false }
  })
  sheet.pageSetup = {
    paperSize: 9,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: `1:${headerRow}`,
    margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
  }
  sheet.pageSetup.printArea = `A1:${sheet.getColumn(sheet.columnCount || 1).letter}${sheet.rowCount || 1}`
  sheet.headerFooter.oddFooter = '&L&D&CPage &P of &N&RConfidential'
}

function addFormula(cell, formula, result) {
  cell.value = { formula, result: safeNumber(result) }
  cell.numFmt = '#,##0.00;[Red](#,##0.00);-'
}

function sumByLine(sheetName, lineColumn, amountColumn, lastRow, line) {
  return `SUMIF('${sheetName}'!$${lineColumn}$3:$${lineColumn}$${lastRow},"${line}",'${sheetName}'!$${amountColumn}$3:$${amountColumn}$${lastRow})`
}

function normalisedFormula(rawReference, mappingReference) {
  const debitKeys = [...DEBIT_NATURED].map(key => `"${key}"`).join(',')
  return `IF(OR(${debitKeys.split(',').map(key => `${mappingReference}=${key}`).join(',')}),-${rawReference},${rawReference})`
}

function setWidths(sheet, widths) {
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width })
}

function addTable(sheet, title, columns, rows, widths) {
  sheet.addRow([title])
  sheet.mergeCells(1, 1, 1, columns.length)
  sheet.addRow(columns)
  rows.forEach(row => sheet.addRow(row))
  styleSheet(sheet)
  setWidths(sheet, widths)
  if (rows.length) sheet.autoFilter = { from: 'A2', to: `${sheet.getColumn(columns.length).letter}${rows.length + 2}` }
}

function buildCover(workbook, source) {
  const sheet = workbook.addWorksheet('Revision & Guide')
  sheet.addRow(['UAE reporting workbook · Draft for demonstration'])
  sheet.mergeCells('A1:B1')
  sheet.addRows([
    ['Engagement', safeText(source.engagement?.name)],
    ['Client', safeText(source.engagement?.clientName)],
    ['Reference', safeText(source.engagement?.reference)],
    ['Jurisdiction / legal form', `${safeText(source.engagement?.jurisdiction)} / ${safeText(source.engagement?.legalForm)}`],
    ['Functional / source / presentation currency', 'AED / AED / AED'],
    ['Reporting period', `${safeText(source.engagement?.periodStart)} to ${safeText(source.engagement?.periodEnd)}`],
    ['Comparative period', `${safeText(source.comparativeTrialBalance?.dateFrom)} to ${safeText(source.comparativeTrialBalance?.dateTill)}`],
    ['Current source Trial Balance', `#${safeText(source.currentTrialBalance?.id)} · ${safeText(source.currentTrialBalance?.source_filename || source.currentTrialBalance?.filename)}`],
    ['Current source SHA-256', safeText(source.currentTrialBalance?.source_sha256)],
    ['Comparative source Trial Balance', `#${safeText(source.comparativeTrialBalance?.id)} · ${safeText(source.comparativeTrialBalance?.sourceFilename || source.comparativeTrialBalance?.filename)}`],
    ['Comparative source SHA-256', safeText(source.comparativeTrialBalance?.sourceSha256)],
    ['Saved PDF revision', `v${safeText(source.reportOutput?.version)}`],
    ['Saved PDF output ID', safeText(source.reportOutput?.id)],
    ['Saved PDF template revision', `${safeText(source.reportOutput?.template_id)} · ${safeText(source.reportOutput?.template_revision)}`],
    ['Final Trial Balance snapshot', `v${safeText(source.snapshot?.version)} · ${safeText(source.snapshot?.id)}`],
    ['Saved PDF financial data SHA-256', safeText(source.reportOutput?.financial_data_sha256)],
    ['Comparative Trial Balance source', safeText(source.comparativeTrialBalance?.filename)],
    ['Current source Trial Balance', safeText(source.currentTrialBalance?.filename)],
    ['Workbook adjustments', 'No review adjustments are included in this exported copy. Enter balanced Dr/Cr lines on Review Adjustments.'],
    ['External workbook changes', 'Edits in this workbook do not update the engagement, its saved Trial Balance, or the saved PDF.'],
    ['Reporting limitation', 'Limited synthetic UAE demonstration only. This workbook is not a validated IFRS reporting pack.'],
    ['Use', 'Review inputs and formulas in this self-contained workbook. No external workbook links or database connection are used.'],
  ])
  styleSheet(sheet, 1)
  sheet.getRow(1).font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } }
  sheet.getColumn(1).width = 38
  sheet.getColumn(2).width = 100
  sheet.getColumn(2).alignment = { wrapText: true, vertical: 'top' }
  sheet.getRow(15).height = 36
  sheet.getRow(16).height = 36
  sheet.getRow(17).height = 36

  const identity = source.reportOutput?.signing_details?.identitySnapshot || {}
  const fields = source.reportOutput?.audit_report_fields || {}
  const narrative = workbook.addWorksheet('Report & Signatures')
  narrative.addRow(['Saved report narrative and approval details'])
  narrative.addRows([
    ['Audit opinion', safeText(fields.opinion)],
    ['Basis for opinion', safeText(fields.basisForOpinion)],
    ['Management responsibilities', safeText(fields.managementResponsibilities)],
    ['Auditor responsibilities', safeText(fields.auditorResponsibilities)],
    ['Other matters', safeText(fields.otherMatters)],
    ['Audit report date / place', `${safeText(fields.reportDate)} / ${safeText(fields.reportPlace)}`],
    ['Responsible firm', safeText(fields.firmName || identity.responsibleFirmName)],
    ['Auditor', safeText(fields.auditorName)],
    ['Auditor registration', safeText(fields.auditorMembershipNumber)],
    ['Financial statement approval date / place', `${safeText(source.reportOutput?.signing_details?.approvalDate)} / ${safeText(source.reportOutput?.signing_details?.approvalPlace)}`],
    ['Management signatories', safeText((source.reportOutput?.signing_details?.signatories || []).map(item => item.name).join('; '))],
  ])
  narrative.getColumn(1).width = 38
  narrative.getColumn(2).width = 100
  narrative.getColumn(2).alignment = { wrapText: true, vertical: 'top' }
  narrative.pageSetup = {
    paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    printArea: `A1:B${narrative.rowCount}`, printTitlesRow: '1:1',
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
  }
  narrative.views = [{ state: 'frozen', ySplit: 1 }]
  narrative.getRow(1).font = { bold: true, size: 14, color: { argb: 'FF17365D' } }
  narrative.getRow(1).height = 26
  for (let row = 2; row <= narrative.rowCount; row += 1) narrative.getRow(row).height = 42
  return sheet
}

function buildSourceSheets(workbook, source) {
  const current = workbook.addWorksheet('Original Current TB')
  const sourceColumns = ['Source row ID', 'Ledger code', 'Ledger name', 'Opening balance', 'Debit', 'Credit', 'Closing balance']
  addTable(current, 'Imported current-year Trial Balance · original values', sourceColumns,
    (source.originalCurrentRows || []).map(row => [
      row.id, safeText(row.ledger_code), safeText(row.name), safeNumber(row.opening_balance),
      safeNumber(row.debit), safeNumber(row.credit), safeNumber(row.closing_balance),
    ]),
    [14, 18, 38, 18, 18, 18, 18])
  for (let row = 3; row <= current.rowCount; row += 1) {
    for (let col = 4; col <= 7; col += 1) current.getCell(row, col).numFmt = '#,##0.00;[Red](#,##0.00);-'
  }

  const prior = workbook.addWorksheet('Original Prior TB')
  addTable(prior, 'Imported comparative Trial Balance · original values', [...sourceColumns, 'UAE mapping', 'Reporting balance'],
    (source.originalPriorRows || []).map(row => [
      row.id, safeText(row.ledger_code), safeText(row.name), safeNumber(row.opening_balance),
      safeNumber(row.debit), safeNumber(row.credit), safeNumber(row.closing_balance),
      safeText(row.lineKey), null,
    ]),
    [14, 18, 38, 18, 18, 18, 18, 28, 20])
  const priorLast = Math.max(3, prior.rowCount)
  for (let row = 3; row <= prior.rowCount; row += 1) {
    prior.getCell(row, 9).value = {
      formula: normalisedFormula(`G${row}`, `H${row}`),
      result: safeNumber(source.originalPriorRows[row - 3]?.reportingBalance),
    }
    for (let col = 4; col <= 7; col += 1) prior.getCell(row, col).numFmt = '#,##0.00;[Red](#,##0.00);-'
    prior.getCell(row, 9).numFmt = '#,##0.00;[Red](#,##0.00);-'
  }
  return { current, prior, priorLast }
}

function buildJournalSheet(workbook, journals) {
  const sheet = workbook.addWorksheet('Posted Journals')
  const lines = []
  for (const journal of journals || []) {
    for (const line of journal.lines || []) {
      lines.push([
        journal.id, journal.entry_number, safeText(journal.journal_date), safeText(journal.narration),
        line.lineNumber, safeText(line.ledgerCode), safeText(line.ledgerName), line.side,
        safeNumber(line.amount), null, null, safeText(journal.posted_by),
      ])
    }
  }
  addTable(sheet, 'Posted audit journal lines included in the selected Trial Balance snapshot',
    ['Journal ID', 'Entry no.', 'Date', 'Narration', 'Line', 'Ledger code', 'Ledger name', 'Side', 'Amount', 'Debit', 'Credit', 'Posted by'],
    lines, [14, 12, 14, 42, 10, 18, 32, 12, 18, 18, 18, 24])
  for (let row = 3; row <= sheet.rowCount; row += 1) {
    sheet.getCell(row, 10).value = { formula: `IF(H${row}="Dr",I${row},0)`, result: safeNumber(lines[row - 3][7] === 'Dr' ? lines[row - 3][8] : 0) }
    sheet.getCell(row, 11).value = { formula: `IF(H${row}="Cr",I${row},0)`, result: safeNumber(lines[row - 3][7] === 'Cr' ? lines[row - 3][8] : 0) }
  }
  return sheet
}

function buildReviewInputs(workbook) {
  const sheet = workbook.addWorksheet('Review Adjustments')
  sheet.addRow(['Review adjustments · external to the saved engagement'])
  sheet.addRow(['ID', 'Date', 'Final TB row ID', 'Ledger code', 'Ledger name', 'Side', 'Amount', 'Debit', 'Credit', 'Narration'])
  for (let row = 3; row <= 52; row += 1) {
    sheet.addRow([
      row - 2, '', '', '', '', '', '',
      { formula: `IF(F${row}="Dr",G${row},0)`, result: 0 },
      { formula: `IF(F${row}="Cr",G${row},0)`, result: 0 },
      '',
    ])
  }
  styleSheet(sheet)
  setWidths(sheet, [10, 14, 18, 18, 32, 12, 18, 18, 18, 42])
  sheet.autoFilter = { from: 'A2', to: 'J52' }
  sheet.dataValidations.add('F3:F52', {
    type: 'list', allowBlank: true, formulae: ['"Dr,Cr"'], showErrorMessage: true,
    errorTitle: 'Choose a journal side', error: 'Select Dr or Cr.',
  })
  sheet.dataValidations.add('G3:G52', {
    type: 'decimal', operator: 'greaterThan', allowBlank: true, formulae: ['0'],
    showErrorMessage: true, errorTitle: 'Enter a positive amount', error: 'Adjustment amounts must be greater than zero.',
  })
  for (let row = 3; row <= 52; row += 1) {
    for (const column of [3, 6, 7, 10]) {
      sheet.getCell(row, column).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } }
    }
  }
  sheet.getColumn(7).numFmt = '#,##0.00;[Red](#,##0.00);-'
  sheet.getColumn(8).numFmt = '#,##0.00;[Red](#,##0.00);-'
  sheet.getColumn(9).numFmt = '#,##0.00;[Red](#,##0.00);-'
  sheet.getCell('A54').value = 'Total debit'
  sheet.getCell('B54').value = { formula: 'SUM(H3:H52)', result: 0 }
  sheet.getCell('A55').value = 'Total credit'
  sheet.getCell('B55').value = { formula: 'SUM(I3:I52)', result: 0 }
  sheet.getCell('A56').value = 'Balance difference (must be zero)'
  sheet.getCell('B56').value = { formula: 'ROUND(B54-B55,2)', result: 0 }
  sheet.getCell('A54').font = { bold: true }
  sheet.getCell('A55').font = { bold: true }
  sheet.getCell('A56').font = { bold: true }
  for (const row of [54, 55, 56]) sheet.getCell(`B${row}`).numFmt = '#,##0.00;[Red](#,##0.00);-'
  sheet.getCell('A58').value = 'Enter a Final TB row ID, side, positive amount and narration. The matching ledger details fill automatically. Keep total debits equal to total credits.'
  sheet.mergeCells('A58:J58')
  sheet.getCell('A58').alignment = { wrapText: true, vertical: 'top' }
  sheet.getRow(58).height = 36
  sheet.pageSetup.printArea = 'A1:J58'
  return sheet
}

function buildFinalTB(workbook, source) {
  const sheet = workbook.addWorksheet('Final TB')
  const mappingById = new Map((source.uaeMappings || []).map(item => [String(item.trialBalanceRowId), item.lineKey]))
  const rows = (source.finalRows || []).map(row => [
    row.id, safeText(row.ledger_code), safeText(row.name), safeNumber(row.opening_balance),
    safeNumber(row.debit), safeNumber(row.credit), safeNumber(row.closing_balance),
    safeText(mappingById.get(String(row.id)) || ''), '', null, null, null, null, null,
  ])
  addTable(sheet, 'Immutable final Trial Balance snapshot with editable review mapping and adjustments',
    ['Snapshot row ID', 'Ledger code', 'Ledger name', 'Opening balance', 'Snapshot debit', 'Snapshot credit', 'Snapshot closing balance', 'Saved UAE mapping', 'Review mapping override', 'Effective mapping', 'Review debit', 'Review credit', 'Adjusted signed balance', 'Reporting balance'],
    rows, [14, 18, 36, 18, 18, 18, 20, 28, 28, 28, 18, 18, 22, 20])
  const last = Math.max(3, sheet.rowCount)
  const adjustmentsLast = 52
  for (let row = 3; row <= sheet.rowCount; row += 1) {
    const data = rows[row - 3]
    sheet.getCell(row, 10).value = { formula: `IF(I${row}<>"",I${row},H${row})`, result: 0 }
    sheet.getCell(row, 11).value = {
      formula: `SUMIFS('Review Adjustments'!$H$3:$H$${adjustmentsLast},'Review Adjustments'!$C$3:$C$${adjustmentsLast},A${row})`,
      result: 0,
    }
    sheet.getCell(row, 12).value = {
      formula: `SUMIFS('Review Adjustments'!$I$3:$I$${adjustmentsLast},'Review Adjustments'!$C$3:$C$${adjustmentsLast},A${row})`,
      result: 0,
    }
    sheet.getCell(row, 13).value = { formula: `ROUND(G${row}-K${row}+L${row},2)`, result: safeNumber(data[6]) }
    sheet.getCell(row, 14).value = {
      formula: normalisedFormula(`M${row}`, `J${row}`),
      result: safeNumber(source.finalReportingBalances?.[row - 3]),
    }
    sheet.getCell(row, 9).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } }
    for (let col = 4; col <= 7; col += 1) sheet.getCell(row, col).numFmt = '#,##0.00;[Red](#,##0.00);-'
    for (let col = 11; col <= 14; col += 1) sheet.getCell(row, col).numFmt = '#,##0.00;[Red](#,##0.00);-'
  }
  const listSheet = workbook.addWorksheet('Validation Lists')
  listSheet.addRows([['UAE mapping keys'], ...MAPPING_KEYS.map(key => [key]), ['Final TB row IDs'], ...(source.finalRows || []).map(row => [String(row.id)])])
  listSheet.state = 'veryHidden'
  const rowIdsStart = MAPPING_KEYS.length + 3
  const rowIdsEnd = Math.max(rowIdsStart, rowIdsStart + (source.finalRows || []).length - 1)
  sheet.dataValidations.add(`I3:I${last}`, {
    type: 'list', allowBlank: true, formulae: [`'Validation Lists'!$A$2:$A$${MAPPING_KEYS.length + 1}`],
    showErrorMessage: true, errorTitle: 'Choose a supported UAE line',
    error: 'Select a mapping from the validation list.',
  })
  for (let row = 3; row <= last; row += 1) {
    sheet.getCell(row, 9).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } }
  }
  const adjustments = workbook.getWorksheet('Review Adjustments')
  if ((source.finalRows || []).length) {
    adjustments.dataValidations.add(`C3:C52`, {
      type: 'list', allowBlank: true, formulae: [`'Validation Lists'!$A$${rowIdsStart}:$A$${rowIdsEnd}`],
    })
  }
  for (let row = 3; row <= adjustments.rowCount; row += 1) {
    adjustments.getCell(row, 4).value = { formula: `IFERROR(INDEX('Final TB'!$B$3:$B$${last},MATCH(C${row},'Final TB'!$A$3:$A$${last},0)),"")`, result: '' }
    adjustments.getCell(row, 5).value = { formula: `IFERROR(INDEX('Final TB'!$C$3:$C$${last},MATCH(C${row},'Final TB'!$A$3:$A$${last},0)),"")`, result: '' }
  }
  return { sheet, last }
}

function buildStatements(workbook, source, finalTBLast, priorLast) {
  const sheet = workbook.addWorksheet('Statements & Schedules')
  sheet.addRow(['UAE Sample 01 · financial statements and supporting schedules · AED'])
  sheet.mergeCells('A1:D1')
  sheet.addRow(['Statement line', 'Current year', 'Comparative', 'Reference'])
  const current = key => sumByLine('Final TB', 'J', 'N', finalTBLast, key)
  const prior = key => sumByLine('Original Prior TB', 'H', 'I', priorLast, key)
  const out = (label, currentFormula, currentResult, priorFormula = null, priorResult = 0, reference = '') => {
    const row = sheet.addRow([label, null, null, reference])
    if (currentFormula) addFormula(row.getCell(2), currentFormula, currentResult)
    if (priorFormula) addFormula(row.getCell(3), priorFormula, priorResult)
    return row.number
  }
  const section = label => {
    const row = sheet.addRow([label])
    row.getCell(1).font = { bold: true, color: { argb: 'FF17365D' } }
    row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EAF7' } }
    return row.number
  }
  const baseCurrent = source.financials.current
  const basePrior = source.financials.comparative
  section('Statement of financial position')
  out('Cash and cash equivalents', `=${current('cash')}`, baseCurrent.position.cash, `=${prior('cash')}`, basePrior.position.cash, 'Note 1')
  out('Trade receivables', `=${current('trade_receivables')}`, baseCurrent.position.receivables, `=${prior('trade_receivables')}`, basePrior.position.receivables, 'Note 2')
  out('Inventories', `=${current('inventory')}`, baseCurrent.position.inventory, `=${prior('inventory')}`, basePrior.position.inventory, 'Note 3')
  out('Property and equipment - net', `=${current('property_plant_equipment')}+${current('ppe_revaluation_adjustment')}-${current('accumulated_depreciation')}`,
    baseCurrent.position.ppeNet, `=${prior('property_plant_equipment')}+${prior('ppe_revaluation_adjustment')}-${prior('accumulated_depreciation')}`, basePrior.position.ppeNet, 'Note 4')
  out('Total assets', '=SUM(B4:B7)', baseCurrent.position.assets, '=SUM(C4:C7)', basePrior.position.assets)
  out('Trade payables', `=${current('trade_payables')}`, baseCurrent.position.payables, `=${prior('trade_payables')}`, basePrior.position.payables, 'Note 5')
  out('Borrowings', `=${current('borrowings')}`, baseCurrent.position.borrowings, `=${prior('borrowings')}`, basePrior.position.borrowings, 'Note 6')
  out('Total liabilities', '=SUM(B9:B10)', baseCurrent.position.liabilities, '=SUM(C9:C10)', basePrior.position.liabilities)
  out('Share capital', `=${current('share_capital')}`, baseCurrent.position.shareCapital, `=${prior('share_capital')}`, basePrior.position.shareCapital, 'Note 7')
  out('Retained earnings', `=${current('retained_earnings')}+B27-${current('dividends')}`, baseCurrent.position.retainedClosing, `=${prior('retained_earnings')}+C27-${prior('dividends')}`, basePrior.position.retainedClosing, 'Note 7')
  out('Revaluation surplus', `=${current('revaluation_surplus')}+B28`, baseCurrent.position.revaluationSurplus, `=${prior('revaluation_surplus')}+C28`, basePrior.position.revaluationSurplus, 'Note 7')
  out('Total equity', '=SUM(B12:B14)', baseCurrent.position.equity, '=SUM(C12:C14)', basePrior.position.equity)
  out('Total liabilities and equity', '=B11+B15', baseCurrent.position.totalLiabilitiesAndEquity, '=C11+C15', basePrior.position.totalLiabilitiesAndEquity)
  out('Statement of financial position difference', '=ROUND(B8-B16,2)', baseCurrent.position.difference, '=ROUND(C8-C16,2)', basePrior.position.difference)

  section('Profit or loss and other comprehensive income')
  out('Revenue', `=${current('revenue')}`, baseCurrent.profit.revenue, `=${prior('revenue')}`, basePrior.profit.revenue, 'Note 8')
  out('Other income', `=${current('other_income')}`, baseCurrent.profit.otherIncome, `=${prior('other_income')}`, basePrior.profit.otherIncome, 'Note 8')
  out('Total revenue and other income', '=SUM(B19:B20)', baseCurrent.profit.revenue + baseCurrent.profit.otherIncome, '=SUM(C19:C20)', basePrior.profit.revenue + basePrior.profit.otherIncome)
  out('Cost of sales', `=${current('cost_of_sales')}`, baseCurrent.profit.costOfSales, `=${prior('cost_of_sales')}`, basePrior.profit.costOfSales, 'Note 9')
  out('Operating expenses', `=${current('operating_expenses')}`, baseCurrent.profit.operatingExpenses, `=${prior('operating_expenses')}`, basePrior.profit.operatingExpenses, 'Note 9')
  out('Depreciation expense', `=${current('depreciation_expense')}`, baseCurrent.profit.depreciation, `=${prior('depreciation_expense')}`, basePrior.profit.depreciation, 'Note 9')
  out('Profit before tax', '=B21-SUM(B22:B24)', baseCurrent.profit.profitBeforeTax, '=C21-SUM(C22:C24)', basePrior.profit.profitBeforeTax)
  out('Income tax expense', `=${current('income_tax_expense')}`, baseCurrent.profit.tax, `=${prior('income_tax_expense')}`, basePrior.profit.tax, 'Note 10')
  out('Profit for the year', '=B25-B26', baseCurrent.profit.profitForYear, '=C25-C26', basePrior.profit.profitForYear)
  out('Other comprehensive income', `=${current('other_comprehensive_income')}`, baseCurrent.profit.otherComprehensiveIncome, `=${prior('other_comprehensive_income')}`, basePrior.profit.otherComprehensiveIncome, 'Note 11')
  out('Total comprehensive income', '=B27+B28', baseCurrent.profit.totalComprehensiveIncome, '=C27+C28', basePrior.profit.totalComprehensiveIncome)

  section('Changes in equity')
  out('Opening share capital', `=SUMIF('Final TB'!$J$3:$J$${finalTBLast},"share_capital",'Final TB'!$D$3:$D$${finalTBLast})`, baseCurrent.equity.shareOpening)
  out('Share capital movement', '=B12-B31', baseCurrent.equity.shareMovement)
  out('Closing share capital', '=B31+B32', baseCurrent.equity.shareClosing)
  out('Opening retained earnings', `=SUMIF('Final TB'!$J$3:$J$${finalTBLast},"retained_earnings",'Final TB'!$D$3:$D$${finalTBLast})`, baseCurrent.equity.retainedOpening)
  out('Other retained earnings movement', `=${current('retained_earnings')}-B34`, baseCurrent.equity.otherRetainedMovement)
  out('Profit for the year', '=B27', baseCurrent.equity.profitForYear)
  out('Dividends / distributions', `=-${current('dividends')}`, -baseCurrent.equity.dividends)
  out('Closing retained earnings', '=SUM(B34:B37)', baseCurrent.equity.retainedClosing)
  out('Opening revaluation surplus', `=SUMIF('Final TB'!$J$3:$J$${finalTBLast},"revaluation_surplus",'Final TB'!$D$3:$D$${finalTBLast})`, baseCurrent.equity.revaluationSurplusOpening)
  out('Revaluation surplus movement including OCI', `=${current('revaluation_surplus')}-B39+B28`, baseCurrent.equity.revaluationSurplusMovement)
  out('Closing revaluation surplus', '=SUM(B39:B40)', baseCurrent.equity.revaluationSurplusClosing)
  out('Total closing equity', '=SUM(B33,B38,B41)', baseCurrent.equity.totalClosing)
  out('Equity movement difference', '=ROUND(B15-B42,2)', baseCurrent.equity.difference)

  section('Cash flows')
  out('Profit for the year', '=B27', baseCurrent.cashFlow.details.profitForYear)
  out('Add back: depreciation', `=${current('depreciation_expense')}`, baseCurrent.cashFlow.details.depreciation)
  out('Change in trade receivables', `=${current('trade_receivables')}-${prior('trade_receivables')}`, baseCurrent.cashFlow.details.receivablesChange)
  out('Change in inventories', `=${current('inventory')}-${prior('inventory')}`, baseCurrent.cashFlow.details.inventoryChange)
  out('Change in trade payables', `=${current('trade_payables')}-${prior('trade_payables')}`, baseCurrent.cashFlow.details.payablesChange)
  out('Net operating cash flow', '=B45+B46-B47-B48+B49', baseCurrent.cashFlow.operating)
  out('PPE additions (gross movement)', `=-(${current('property_plant_equipment')}-${prior('property_plant_equipment')})`, baseCurrent.cashFlow.details.ppeAdditions * -1)
  out('Non-cash PPE revaluation movement', `=${current('ppe_revaluation_adjustment')}-${prior('ppe_revaluation_adjustment')}`, baseCurrent.cashFlow.details.noncashPpeRevaluation)
  out('Net investing cash flow', '=B51', baseCurrent.cashFlow.investing)
  out('Change in borrowings', `=${current('borrowings')}-${prior('borrowings')}`, baseCurrent.cashFlow.details.borrowingChange)
  out('Change in share capital', `=${current('share_capital')}-${prior('share_capital')}`, baseCurrent.cashFlow.details.shareCapitalChange)
  out('Dividends / distributions', `=-${current('dividends')}`, -baseCurrent.cashFlow.details.dividends)
  out('Net financing cash flow', '=SUM(B54:B56)', baseCurrent.cashFlow.financing)
  out('Net movement in cash', '=SUM(B50,B53,B57)', baseCurrent.cashFlow.netMovement)
  out('Opening cash', `=${prior('cash')}`, baseCurrent.cashFlow.openingCash)
  out('Closing cash', `=${current('cash')}`, baseCurrent.cashFlow.closingCash)
  out('Cash flow reconciliation difference', '=ROUND(B59+B58-B60,2)', baseCurrent.cashFlow.difference)

  for (let row = 1; row <= sheet.rowCount; row += 1) {
    const label = String(sheet.getCell(row, 1).value || '')
    if (['Total assets', 'Total liabilities', 'Total equity', 'Total liabilities and equity', 'Statement of financial position difference',
      'Total revenue and other income', 'Profit for the year', 'Total comprehensive income', 'Total closing equity',
      'Equity movement difference', 'Net operating cash flow', 'Net investing cash flow', 'Net financing cash flow',
      'Net movement in cash', 'Cash flow reconciliation difference'].includes(label)) {
      sheet.getRow(row).font = { bold: true }
      sheet.getRow(row).getCell(1).border = { top: { style: 'thin', color: { argb: 'FF17365D' } } }
    }
  }
  sheet.getColumn(1).width = 43
  sheet.getColumn(2).width = 20
  sheet.getColumn(3).width = 20
  sheet.getColumn(4).width = 20
  sheet.views = [{ state: 'frozen', ySplit: 2 }]
  sheet.pageSetup = {
    paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    printTitlesRow: '1:2', printArea: `A1:D${sheet.rowCount}`,
  }
  return sheet
}

function buildMovementSchedules(workbook, source, finalTBLast, priorLast) {
  const sheet = workbook.addWorksheet('Movement Schedules')
  sheet.addRow(['Supporting movements · AED · cash and non-cash movements shown separately'])
  sheet.mergeCells('A1:E1')
  sheet.addRow(['Schedule', 'Opening / comparative', 'Movement', 'Closing / current', 'Treatment'])
  const current = key => sumByLine('Final TB', 'J', 'N', finalTBLast, key)
  const prior = key => sumByLine('Original Prior TB', 'H', 'I', priorLast, key)
  const add = (label, openingFormula, openingResult, movementFormula, movementResult, closingFormula, closingResult, note) => {
    const row = sheet.addRow([label, null, null, null, note])
    addFormula(row.getCell(2), openingFormula, openingResult)
    addFormula(row.getCell(3), movementFormula, movementResult)
    addFormula(row.getCell(4), closingFormula, closingResult)
    return row
  }
  const currentPPE = source.financials.current.position
  const currentEquity = source.financials.current.equity
  const currentCash = source.financials.current.cashFlow
  const priorPPE = source.financials.comparative.position
  const cashOpening = currentCash.openingCash
  add('Property and equipment · gross cost', `=${prior('property_plant_equipment')}`, priorPPE.ppeCost,
    `=${current('property_plant_equipment')}-B3`, currentPPE.ppeCost - priorPPE.ppeCost,
    `=${current('property_plant_equipment')}`, currentPPE.ppeCost, 'Gross carrying amount; movement is not automatically cash.')
  add('PPE revaluation adjustment', `=${prior('ppe_revaluation_adjustment')}`, priorPPE.ppeRevaluationAdjustment,
    `=${current('ppe_revaluation_adjustment')}-B4`, currentPPE.ppeRevaluationAdjustment - priorPPE.ppeRevaluationAdjustment,
    `=${current('ppe_revaluation_adjustment')}`, currentPPE.ppeRevaluationAdjustment, 'Non-cash movement; excluded from investing cash flow.')
  add('Accumulated depreciation', `=${prior('accumulated_depreciation')}`, priorPPE.accumulatedDepreciation,
    `=${current('accumulated_depreciation')}-B5`, currentPPE.accumulatedDepreciation - priorPPE.accumulatedDepreciation,
    `=${current('accumulated_depreciation')}`, currentPPE.accumulatedDepreciation, 'Accumulated balance; depreciation expense is separately shown below.')
  add('Property and equipment · net carrying amount', '=B3+B4-B5', priorPPE.ppeNet,
    `='Statements & Schedules'!B7-B6`, currentPPE.ppeNet - priorPPE.ppeNet,
    `='Statements & Schedules'!B7`, currentPPE.ppeNet, 'Net statement carrying amount.')
  add('Depreciation expense', `=${prior('depreciation_expense')}`, safeNumber(source.priorReportingByLine?.depreciation_expense),
    `='Statements & Schedules'!B24-C7`, source.financials.current.profit.depreciation - safeNumber(source.priorReportingByLine?.depreciation_expense),
    `='Statements & Schedules'!B24`, source.financials.current.profit.depreciation, 'Expense in profit or loss; non-cash add-back in operating cash flow.')
  add('Cash and cash equivalents', `=${prior('cash')}`, cashOpening,
    `='Statements & Schedules'!B58`, currentCash.netMovement,
    `=${current('cash')}`, currentCash.closingCash, 'Opening cash plus net movement reconciles to closing cash.')
  add('Review adjustments · Dr / Cr balance', "='Review Adjustments'!B54", 0,
    "='Review Adjustments'!B56", 0,
    "='Review Adjustments'!B55", 0, 'External workbook inputs; must remain balanced.')
  sheet.getColumn(1).width = 45
  sheet.getColumn(2).width = 23
  sheet.getColumn(3).width = 23
  sheet.getColumn(4).width = 23
  sheet.getColumn(5).width = 76
  sheet.getColumn(5).alignment = { wrapText: true, vertical: 'top' }
  sheet.views = [{ state: 'frozen', ySplit: 2 }]
  sheet.pageSetup = {
    paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    printTitlesRow: '1:2', printArea: `A1:E${sheet.rowCount}`,
  }
  return sheet
}

function buildNotes(workbook, source, finalTBLast, priorLast) {
  const sheet = workbook.addWorksheet('Notes')
  const rows = []
  const disclosureByNumber = new Map((source.noteDisclosures || []).map(note => [Number(note.note_num), safeText(note.text)]))
  for (const [lineKey, noteNumber] of Object.entries(NOTE_BY_LINE)) {
    const title = source.accountLines?.find(item => item.id === lineKey)?.label || lineKey.replaceAll('_', ' ')
    rows.push([
      noteNumber, NOTE_TITLES[noteNumber - 1], title, lineKey,
      `=${sumByLine('Final TB', 'J', 'N', finalTBLast, lineKey)}`,
      `=${sumByLine('Original Prior TB', 'H', 'I', priorLast, lineKey)}`,
      disclosureByNumber.get(noteNumber) || '',
    ])
  }
  addTable(sheet, 'Supporting notes · account balances link to the current and comparative Trial Balances',
    ['Note', 'Title', 'Ledger', 'UAE mapping', 'Current AED', 'Comparative AED', 'Saved narrative disclosure'],
    rows, [10, 32, 36, 30, 20, 20, 80])
  for (let row = 3; row <= sheet.rowCount; row += 1) {
    const lineKey = String(sheet.getCell(row, 4).value || '')
    const currentResult = safeNumber((source.finalReportingByLine || {})[lineKey])
    const priorResult = safeNumber((source.priorReportingByLine || {})[lineKey])
    addFormula(sheet.getCell(row, 5), String(sheet.getCell(row, 5).value).slice(1), currentResult)
    addFormula(sheet.getCell(row, 6), String(sheet.getCell(row, 6).value).slice(1), priorResult)
    sheet.getCell(row, 7).alignment = { wrapText: true, vertical: 'top' }
    sheet.getRow(row).height = 36
  }
  const noteTotalRows = {}
  for (let note = 1; note <= NOTE_TITLES.length; note += 1) {
    const next = sheet.addRow([note, NOTE_TITLES[note - 1], 'Note total', '', null, null, disclosureByNumber.get(note) || ''])
    const row = next.number
    const noteFormula = {
      1: ["'Statements & Schedules'!B4", "'Statements & Schedules'!C4"],
      2: ["'Statements & Schedules'!B5", "'Statements & Schedules'!C5"],
      3: ["'Statements & Schedules'!B6", "'Statements & Schedules'!C6"],
      4: ["'Statements & Schedules'!B7", "'Statements & Schedules'!C7"],
      5: ["'Statements & Schedules'!B9", "'Statements & Schedules'!C9"],
      6: ["'Statements & Schedules'!B10", "'Statements & Schedules'!C10"],
      7: ["'Statements & Schedules'!B15", "'Statements & Schedules'!C15"],
      8: ["'Statements & Schedules'!B21", "'Statements & Schedules'!C21"],
      9: ["SUM('Statements & Schedules'!B22:B24)", "SUM('Statements & Schedules'!C22:C24)"],
      10: ["'Statements & Schedules'!B26", "'Statements & Schedules'!C26"],
      11: ["'Statements & Schedules'!B28", "'Statements & Schedules'!C28"],
    }[note]
    addFormula(next.getCell(5), `=${noteFormula[0]}`,
      safeNumber(source.financials.notes.find(item => Number(item.number) === note)?.currentTotal))
    addFormula(next.getCell(6), `=${noteFormula[1]}`,
      safeNumber(source.financials.notes.find(item => Number(item.number) === note)?.comparativeTotal))
    next.font = { bold: true }
    noteTotalRows[note] = row
  }
  sheet.autoFilter = { from: 'A2', to: `G${Math.max(2, rows.length + 2)}` }
  sheet.getColumn(7).alignment = { wrapText: true, vertical: 'top' }
  sheet.pageSetup.printArea = `A1:G${sheet.rowCount}`
  return { sheet, noteTotalRows }
}

function buildChecks(workbook, source, finalTBLast, noteTotalRows) {
  const sheet = workbook.addWorksheet('Reconciliation Checks')
  sheet.addRow(['Reconciliation checks · no unexplained balancing amounts'])
  sheet.addRow(['Check', 'Actual difference', 'Expected', 'Status'])
  const checks = [
    ['Final TB balances', `SUM('Final TB'!$M$3:$M$${finalTBLast})`, 0, 'Final TB signed balances should sum to zero.'],
    ['Review adjustments balance', "'Review Adjustments'!$B$56", 0, 'All review debits must equal review credits.'],
    ['Statement of financial position', "'Statements & Schedules'!$B$17", 0, 'Assets less liabilities and equity.'],
    ['Profit, OCI and comprehensive income', "'Statements & Schedules'!$B$29-'Statements & Schedules'!$B$27-'Statements & Schedules'!$B$28", 0, 'Profit plus OCI less total comprehensive income.'],
    ['Equity movement', "'Statements & Schedules'!$B$43", 0, 'Closing equity less statement equity.'],
    ['Cash flow', "'Statements & Schedules'!$B$59", 0, 'Opening cash plus net movement less closing cash.'],
  ]
  checks[5][1] = "'Statements & Schedules'!$B$61"
  checks.forEach(([label, formula, expected, description], index) => {
    const row = index + 3
    const sourceResult = [
      0, 0, source.financials.current.position.difference,
      0, source.financials.current.equity.difference, source.financials.current.cashFlow.difference,
    ][index]
    sheet.addRow([label, null, expected, null, description])
    addFormula(sheet.getCell(row, 2), `=${formula}`, sourceResult)
    sheet.getCell(row, 4).value = { formula: `IF(ABS(B${row}-C${row})<0.005,"PASS","FAIL")`, result: 'PASS' }
  })
  const journalIds = [...new Set((source.journals || []).map(item => Number(item.id)))]
  journalIds.forEach((id, index) => {
    const row = sheet.addRow([`Posted journal ${id}`, null, 0, null, 'Posted debit total less posted credit total.'])
    const rowNumber = row.number
    addFormula(row.getCell(2), `=SUMIF('Posted Journals'!$A$3:$A$10000,${id},'Posted Journals'!$J$3:$J$10000)-SUMIF('Posted Journals'!$A$3:$A$10000,${id},'Posted Journals'!$K$3:$K$10000)`, 0)
    sheet.getCell(rowNumber, 4).value = { formula: `IF(ABS(B${rowNumber})<0.005,"PASS","FAIL")`, result: 'PASS' }
  })
  const noteStatementRows = {
    1: [4, 4], 2: [5, 5], 3: [6, 6], 4: [7, 7], 5: [9, 9], 6: [10, 10],
    7: [15, 15], 8: [21, 21], 9: [null, null], 10: [26, 26], 11: [28, 28],
  }
  for (let note = 1; note <= NOTE_TITLES.length; note += 1) {
    const statementRow = noteStatementRows[note][0]
    const currentCell = note === 9 ? "'Statements & Schedules'!B22+'Statements & Schedules'!B23+'Statements & Schedules'!B24"
      : `'Statements & Schedules'!B${statementRow}`
    const priorCell = note === 9 ? "'Statements & Schedules'!C22+'Statements & Schedules'!C23+'Statements & Schedules'!C24"
      : `'Statements & Schedules'!C${noteStatementRows[note][1]}`
    for (const [period, column, statementRef] of [['Current', 'E', currentCell], ['Comparative', 'F', priorCell]]) {
      const row = sheet.addRow([`Note ${note} ${period} reconciliation`, null, 0, null, 'Note total less the corresponding statement amount.'])
      const rowNumber = row.number
      addFormula(row.getCell(2), `='Notes'!${column}${noteTotalRows[note]}-(${statementRef})`,
        0)
      sheet.getCell(rowNumber, 4).value = { formula: `IF(ABS(B${rowNumber})<0.005,"PASS","FAIL")`, result: 'PASS' }
    }
  }
  styleSheet(sheet)
  setWidths(sheet, [40, 22, 18, 14, 72])
  for (let row = 3; row <= sheet.rowCount; row += 1) sheet.getCell(row, 2).numFmt = '#,##0.00;[Red](#,##0.00);-'
  return sheet
}

export async function buildUaeEngagementWorkbook(source) {
  if (!source || !source.engagement || !source.snapshot || !source.reportOutput || !source.financials) {
    throw new Error('A saved UAE report revision and its verified reporting data are required.')
  }
  const computedHash = calculateUaeReportDataHash(source)
  if (source.reportOutput.financial_data_sha256 !== computedHash) {
    throw new Error('The saved PDF data hash does not match the selected Trial Balance and mappings. Generate a new PDF version before exporting.')
  }
  if (Number(source.reportOutput.final_tb_version) !== Number(source.snapshot.version)
    || Number(source.reportOutput.final_tb_snapshot_id) !== Number(source.snapshot.id)) {
    throw new Error('The selected saved PDF and final Trial Balance versions do not match.')
  }
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'FSG Aditya'
  workbook.subject = `UAE reporting demonstration · ${safeText(source.engagement.reference)}`
  workbook.title = `${safeText(source.engagement.name)} · UAE reporting workbook`
  workbook.company = safeText(source.reportOutput.audit_report_fields?.firmName || '')
  workbook.calcProperties.fullCalcOnLoad = true
  workbook.calcProperties.forceFullCalc = true
  buildCover(workbook, source)
  buildSourceSheets(workbook, source)
  buildJournalSheet(workbook, source.journals)
  buildReviewInputs(workbook)
  const { last: finalTBLast } = buildFinalTB(workbook, source)
  const priorLast = Math.max(3, (source.originalPriorRows || []).length + 2)
  buildStatements(workbook, source, finalTBLast, priorLast)
  buildMovementSchedules(workbook, source, finalTBLast, priorLast)
  const { noteTotalRows } = buildNotes(workbook, source, finalTBLast, priorLast)
  buildChecks(workbook, source, finalTBLast, noteTotalRows)
  return workbook.xlsx.writeBuffer()
}
