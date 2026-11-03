import { createRequire } from 'node:module'
import ExcelJS from 'exceljs'
import { formatAmount } from '../../shared/uae-draft-report-model.mjs'

const {
  AlignmentType, Document, Footer, HeadingLevel, PageBreak, PageNumber, Packer, Paragraph,
  ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
} = createRequire(import.meta.url)('docx')

const RED = 'B91C1C'
const NONE = { style: 'single', size: 0, color: 'FFFFFF' }
const LIGHT = { style: 'single', size: 4, color: 'D1D5DB' }

const text = (value, options = {}) => new TextRun({ text: String(value ?? ''), ...options })
const para = (value, options = {}) => new Paragraph({ children: [text(value, options.run)], ...options.paragraph })

function cell(value, { width, bold = false, color, fill, align } = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: { top: LIGHT, bottom: LIGHT, left: NONE, right: NONE },
    shading: fill ? { type: ShadingType.CLEAR, fill, color: 'auto' } : undefined,
    children: [new Paragraph({ alignment: align, children: [text(value, { bold, color, size: 18 })] })],
  })
}

function table(widths, rows) {
  return new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: widths,
    rows,
  })
}

function statementTable(rows) {
  const widths = [7200, 1800]
  return table(widths, rows.map(row => {
    if (row.kind === 'section') {
      return new TableRow({ children: [new TableCell({ columnSpan: 2, width: { size: 9000, type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, fill: 'F3F4F6', color: 'auto' }, children: [new Paragraph({ children: [text(row.label.toUpperCase(), { bold: true, size: 16 })] })] })] })
    }
    const placeholder = row.kind === 'placeholder'
    const label = placeholder ? `${row.label}  [${row.badge}] ${row.count} account${row.count === 1 ? '' : 's'} - presentation placeholder only` : row.label + (row.accounts ? ` (${row.accounts.length} ledger${row.accounts.length === 1 ? '' : 's'})` : '')
    const bold = placeholder || row.kind === 'total' || row.kind === 'difference'
    const style = { bold, color: placeholder ? RED : undefined, fill: placeholder ? 'FEF2F2' : row.strong ? 'EEF2FF' : undefined }
    return new TableRow({ children: [cell(label, { ...style, width: widths[0] }), cell(formatAmount(row.amount), { ...style, width: widths[1], align: AlignmentType.RIGHT })] })
  }))
}

function detailBlocks(rows) {
  const blocks = []
  const widths = [1200, 3300, 1600, 2900]
  for (const row of rows.filter(item => item.accounts?.length)) {
    const red = row.kind === 'placeholder'
    blocks.push(new Paragraph({ spacing: { before: 160 }, children: [text(`${row.label} - ${formatAmount(row.amount)}`, { bold: true, color: red ? RED : undefined, size: 18 })] }))
    blocks.push(table(widths, [
      new TableRow({ tableHeader: true, children: ['Code', 'Ledger', 'Balance (Cr +, Dr -)', 'Mapping status / source'].map((label, index) => cell(label, { width: widths[index], bold: true, fill: 'F3F4F6', align: index === 2 ? AlignmentType.RIGHT : undefined })) }),
      ...row.accounts.map(account => new TableRow({ children: [
        cell(account.code || '(no code)', { width: widths[0], color: account.basis === 'unresolved' ? RED : undefined }),
        cell(account.name, { width: widths[1], color: account.basis === 'unresolved' ? RED : undefined }),
        cell(formatAmount(account.balance), { width: widths[2], align: AlignmentType.RIGHT, color: account.basis === 'unresolved' ? RED : undefined }),
        cell(account.source, { width: widths[3], color: account.basis === 'unresolved' ? RED : undefined }),
      ] })),
    ]))
  }
  return blocks
}

export async function buildDraftWordDocument(model) {
  const { identity, source } = model
  const heading = (value, color) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 100 }, children: [text(value, { color, bold: true })] })
  const children = [
    new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, children: [text(model.title)] }),
    ...model.warnings.map((warning, index) => new Paragraph({ spacing: { after: 60 }, children: [text(warning, { bold: index === 0 || warning.startsWith('ACTION'), color: index === 0 || warning.startsWith('ACTION') ? RED : undefined })] })),
    table([2200, 6800], [
      ['Engagement', `${identity.name}${identity.reference ? ` (${identity.reference})` : ''}`],
      ['Reporting period', identity.periodStart ? `${identity.periodStart} to ${identity.periodEnd}` : `year ended ${identity.periodEnd}`],
      ['Currency', identity.currencyNote],
      ['Final Trial Balance', `version ${source.finalTbVersion} (TB #${source.trialBalanceId})`],
      ['Reporting pack', `${source.packId} v${source.packVersion} (${source.packStatus})`],
      ['Comparatives', 'None - pending verification'],
    ].map(([k, v]) => new TableRow({ children: [cell(k, { width: 2200, bold: true }), cell(v, { width: 6800 })] }))),
    ...model.unconfirmedMetadata.map(item => para(`Unconfirmed - ${item.label}: ${item.value}`, { run: { size: 16 } })),
    new Paragraph({ children: [new PageBreak()] }),
    heading('Statement of financial position - provisional, potentially incomplete (AED)'),
    statementTable(model.sfp),
    para(`${model.treatment.note} Arithmetic: ${model.arithmeticReconciled ? 'every ledger counted once and the source TB net is zero' : 'NOT reconciled - investigate'}. Classification: ${model.coverage.unresolvedCount} unresolved (net ${formatAmount(model.coverage.unresolvedNet)}; ${formatAmount(model.coverage.unresolvedAbsolute)} of ${formatAmount(model.coverage.totalAbsolute)} by absolute value, ${model.coverage.unresolvedAbsolutePercent}%).`, { run: { size: 16 }, paragraph: { spacing: { before: 100 } } }),
    new Paragraph({ children: [new PageBreak()] }),
    heading('Statement of profit or loss - provisional, potentially incomplete (AED)'),
    statementTable(model.pl),
    heading('Calculation checks'),
    ...model.checks.map(check => para(`${check.kind === 'classification' ? (check.passed ? 'Classification complete' : 'Action required') : (check.passed ? 'Arithmetic passed' : 'Arithmetic FAILED')} - ${check.label} (${check.detail})`, { run: { size: 16, color: check.passed ? undefined : RED } })),
    new Paragraph({ children: [new PageBreak()] }),
    heading('Supporting detail - Statement of financial position ledgers'),
    ...detailBlocks(model.sfp),
    new Paragraph({ children: [new PageBreak()] }),
    heading('Supporting detail - Profit or loss ledgers'),
    ...detailBlocks(model.pl),
    heading(`Action required - ${model.coverage.unresolvedCount} accounts awaiting classification`, RED),
    table([1200, 3300, 1600, 2900], [
      ...model.unresolved.map(account => new TableRow({ children: [
        cell(account.code || '(no code)', { width: 1200, color: RED }), cell(account.name, { width: 3300, color: RED }),
        cell(formatAmount(account.balance), { width: 1600, color: RED, align: AlignmentType.RIGHT }), cell(account.source, { width: 2900, color: RED }),
      ] })),
    ]),
  ]
  if (model.validationEvidence.items.length) {
    children.push(heading('Reference comparison - validation evidence only'))
    children.push(para(`${model.validationEvidence.source}. ${model.validationEvidence.note} Differences are calculated minus reference.`, { run: { size: 16 } }))
    const widths = [2600, 1400, 1400, 1300, 2300]
    children.push(table(widths, [
      new TableRow({ tableHeader: true, children: ['Caption', 'Calculated', 'Reference', 'Difference', 'Explanation'].map((label, index) => cell(label, { width: widths[index], bold: true, fill: 'F3F4F6' })) }),
      ...model.validationEvidence.items.map(item => new TableRow({ children: [
        cell(item.label, { width: widths[0] }), cell(item.populated ? formatAmount(item.calculated) : 'no mapped ledgers', { width: widths[1], align: AlignmentType.RIGHT }),
        cell(formatAmount(item.reference), { width: widths[2], align: AlignmentType.RIGHT }),
        cell(Math.abs(item.difference) < 0.005 ? 'agrees' : formatAmount(item.difference), { width: widths[3], align: AlignmentType.RIGHT }),
        cell(Math.abs(item.difference) < 0.005 ? '' : (item.note || 'Not explained yet.'), { width: widths[4] }),
      ] })),
    ]))
  }
  children.push(heading('Pending - not included in this draft'))
  children.push(table([2800, 1200, 5000], model.pending.map(item => new TableRow({ children: [cell(item.item, { width: 2800, bold: true }), cell(item.status, { width: 1200 }), cell(item.detail, { width: 5000 })] }))))
  const document = new Document({
    creator: 'FSG Aditya', title: model.title,
    sections: [{
      properties: { page: { margin: { top: 900, bottom: 900, left: 1200, right: 1200 } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [text(`PROVISIONAL DRAFT - ${identity.reference || identity.name} - TB v${source.finalTbVersion} - ${source.packId} v${source.packVersion} - page `, { size: 14 }), new TextRun({ children: [PageNumber.CURRENT], size: 14 })] })] }) },
      children,
    }],
  })
  return Buffer.from(await Packer.toBuffer(document))
}

function addStatementSheet(workbook, name, title, rows, model) {
  const sheet = workbook.addWorksheet(name)
  sheet.columns = [{ width: 78 }, { width: 20 }]
  sheet.addRow([title]).font = { bold: true, size: 13 }
  sheet.addRow([`${model.identity.name} (${model.identity.reference}) - ${model.identity.periodStart ? `${model.identity.periodStart} to ` : 'year ended '}${model.identity.periodEnd} - ${model.identity.currencyNote} - TB v${model.source.finalTbVersion} - ${model.source.packId} v${model.source.packVersion}`])
  sheet.addRow(['PROVISIONAL DRAFT - not reviewed, not for issue']).font = { bold: true, color: { argb: 'FFB91C1C' } }
  sheet.addRow([])
  for (const row of rows) {
    if (row.kind === 'section') {
      const added = sheet.addRow([row.label.toUpperCase()])
      added.font = { bold: true }
      added.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } }
      continue
    }
    const label = row.kind === 'placeholder' ? `${row.label} [${row.badge}] ${row.count} account${row.count === 1 ? '' : 's'} - presentation placeholder only` : row.label
    const added = sheet.addRow([label, Math.round(Number(row.amount) * 100) / 100])
    added.getCell(2).numFmt = '#,##0.00;-#,##0.00'
    if (row.kind === 'placeholder') {
      added.font = { bold: true, color: { argb: 'FFB91C1C' } }
      added.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF2F2' } }
    } else if (row.kind === 'total' || row.kind === 'difference') added.font = { bold: true }
  }
  return sheet
}

export async function buildDraftWorkbook(model) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'FSG Aditya'
  const summary = workbook.addWorksheet('Summary')
  summary.columns = [{ width: 34 }, { width: 90 }]
  summary.addRow([model.title]).font = { bold: true, size: 14 }
  for (const warning of model.warnings) summary.addRow(['', warning])
  summary.addRow([])
  for (const [k, v] of [
    ['Engagement', `${model.identity.name} (${model.identity.reference})`],
    ['Reporting period', `${model.identity.periodStart ? `${model.identity.periodStart} to ` : 'year ended '}${model.identity.periodEnd}`],
    ['Currency', model.identity.currencyNote],
    ['Final Trial Balance', `version ${model.source.finalTbVersion} (TB #${model.source.trialBalanceId})`],
    ['Reporting pack', `${model.source.packId} v${model.source.packVersion} (${model.source.packStatus})`],
    ['Comparatives', 'None - pending verification'],
    ['Total assets (provisional)', model.totals.totalAssets],
    ['Total equity and liabilities (provisional)', model.totals.totalEquityAndLiabilities],
    ['Balance Sheet difference', model.totals.difference],
    ['Profit / (loss) (provisional)', model.totals.profit],
    ['Unresolved accounts', model.coverage.unresolvedCount],
    ['Unresolved net / absolute', `${model.coverage.unresolvedNet} / ${model.coverage.unresolvedAbsolute} of ${model.coverage.totalAbsolute} (${model.coverage.unresolvedAbsolutePercent}%)`],
  ]) summary.addRow([k, v]).getCell(1).font = { bold: true }
  summary.addRow([])
  for (const item of model.unconfirmedMetadata) summary.addRow(['Unconfirmed - ' + item.label, item.value])
  summary.addRow([])
  summary.addRow(['Pending - not included']).font = { bold: true }
  for (const item of model.pending) summary.addRow([item.item, `${item.status}: ${item.detail}`])
  addStatementSheet(workbook, 'Balance Sheet', 'Statement of financial position - provisional, potentially incomplete', model.sfp, model)
  addStatementSheet(workbook, 'P&L', 'Statement of profit or loss - provisional, potentially incomplete', model.pl, model)
  const detail = workbook.addWorksheet('Ledger detail')
  detail.columns = [{ width: 12 }, { width: 14 }, { width: 44 }, { width: 38 }, { width: 18 }, { width: 18 }, { width: 60 }]
  detail.addRow(['Statement', 'Code', 'Ledger', 'Statement line', 'Balance (Cr +, Dr -)', 'Mapping status', 'Source']).font = { bold: true }
  for (const [statement, rows] of [['SFP', model.sfp], ['P&L', model.pl]]) {
    for (const row of rows.filter(item => item.accounts?.length)) {
      for (const account of row.accounts) {
        const added = detail.addRow([statement, account.code, account.name, row.label, account.balance, account.basis, account.source])
        added.getCell(5).numFmt = '#,##0.00;-#,##0.00'
        if (account.basis === 'unresolved') added.font = { color: { argb: 'FFB91C1C' } }
      }
    }
  }
  const checks = workbook.addWorksheet('Checks')
  checks.columns = [{ width: 16 }, { width: 110 }, { width: 60 }]
  checks.addRow(['Result', 'Check', 'Detail']).font = { bold: true }
  for (const check of model.checks) {
    checks.addRow([check.kind === 'classification' ? (check.passed ? 'Complete' : 'Action required') : (check.passed ? 'Passed' : 'FAILED'), check.label, check.detail])
  }
  if (model.validationEvidence.items.length) {
    const evidence = workbook.addWorksheet('Reference evidence')
    evidence.columns = [{ width: 52 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 100 }]
    evidence.addRow([`${model.validationEvidence.source}. ${model.validationEvidence.note} Differences are calculated minus reference.`])
    evidence.addRow(['Caption', 'Calculated', 'Reference', 'Difference', 'Explanation']).font = { bold: true }
    for (const item of model.validationEvidence.items) {
      evidence.addRow([item.label, item.populated ? item.calculated : 'no mapped ledgers', item.reference, item.difference, item.note])
    }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer())
}
