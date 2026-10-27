import { createRequire } from 'node:module'
import { calculateUaeReportDataHash } from './uae-report-data-hash.mjs'

const {
  AlignmentType,
  Document,
  Footer,
  HeadingLevel,
  ImageRun,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
} = createRequire(import.meta.url)('docx')

const TABLE_WIDTH = 9000
const TABLE_COLUMNS = [5400, 1800, 1800]
const ZERO_BORDER = { style: 'single', size: 0, color: 'FFFFFF' }

function safeText(value, maxLength = 4000) {
  return String(value ?? '').slice(0, maxLength)
}

function amount(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) throw new Error('Word report source contains a non-numeric statement balance.')
  return new Intl.NumberFormat('en-AE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(number)
}

function paragraph(text, options = {}) {
  const { bold = false, ...paragraphOptions } = options
  const value = safeText(text)
  return new Paragraph({
    ...paragraphOptions,
    children: value.split(/\r?\n/).flatMap((line, index) => (
      index === 0
        ? [new TextRun({ text: line, bold })]
        : [new TextRun({ break: 1 }), new TextRun(line)]
    )),
  })
}

function heading(text, level = HeadingLevel.HEADING_1) {
  return new Paragraph({ heading: level, children: [new TextRun(safeText(text))], keepNext: true })
}

function cell(text, { header = false, right = false, bold = false } = {}) {
  return new TableCell({
    shading: header ? { type: ShadingType.CLEAR, fill: '17365D' } : undefined,
    children: [new Paragraph({
      alignment: right ? AlignmentType.RIGHT : AlignmentType.LEFT,
      children: [new TextRun({
        text: safeText(text),
        bold: header || bold,
        color: header ? 'FFFFFF' : '17202A',
        size: 18,
      })],
    })],
  })
}

function reportTable(rows, currentLabel, comparativeLabel) {
  const tableRows = [
    new TableRow({
      tableHeader: true,
      cantSplit: true,
      children: [
        cell('Description', { header: true }),
        cell(currentLabel, { header: true, right: true }),
        cell(comparativeLabel, { header: true, right: true }),
      ],
    }),
    ...rows.map(item => new TableRow({
      cantSplit: true,
      children: [
        cell(item.label, { bold: !!item.total }),
        cell(amount(item.current), { right: true, bold: !!item.total }),
        cell(amount(item.comparative), { right: true, bold: !!item.total }),
      ],
    })),
  ]
  return new Table({
    rows: tableRows,
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    columnWidths: TABLE_COLUMNS,
    margins: { top: 90, bottom: 90, left: 110, right: 110 },
    borders: {
      top: { style: 'single', size: 4, color: '17365D' },
      bottom: { style: 'single', size: 4, color: '17365D' },
      insideHorizontal: { style: 'single', size: 2, color: 'CBD5E1' },
      insideVertical: ZERO_BORDER,
      left: ZERO_BORDER,
      right: ZERO_BORDER,
    },
  })
}

function noteAccounts(note) {
  if (Number(note.number) !== 9) return note.accounts || []
  const grouped = new Map()
  for (const account of note.accounts || []) {
    const key = account.lineId || account.name
    const row = grouped.get(key) || { name: account.displayName || account.name, current: 0, comparative: 0 }
    row.current += Number(account.current || 0)
    row.comparative += Number(account.comparative || 0)
    grouped.set(key, row)
  }
  return [...grouped.values()]
}

function imageBuffer(branding) {
  if (!branding?.logoBase64 || !['image/png', 'image/jpeg'].includes(branding.logoMimeType)) return null
  const encoded = String(branding.logoBase64)
  if (encoded.length > 1024 * 1024 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error('The saved firm logo is not a valid image or exceeds the Word export limit.')
  }
  const buffer = Buffer.from(encoded, 'base64')
  if (buffer.toString('base64') !== encoded || buffer.length > 750 * 1024) {
    throw new Error('The saved firm logo is not a valid image or exceeds the Word export limit.')
  }
  const png = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  if ((branding.logoMimeType === 'image/png' && !png) || (branding.logoMimeType === 'image/jpeg' && !jpeg)) {
    throw new Error('The saved firm logo content does not match its recorded image format.')
  }
  let width
  let height
  if (png && buffer.length >= 24) {
    width = buffer.readUInt32BE(16)
    height = buffer.readUInt32BE(20)
  } else if (jpeg) {
    for (let offset = 2; offset + 9 < buffer.length;) {
      if (buffer[offset] !== 0xff) break
      const marker = buffer[offset + 1]
      const segmentLength = buffer.readUInt16BE(offset + 2)
      if (segmentLength < 2 || offset + 2 + segmentLength > buffer.length) break
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        height = buffer.readUInt16BE(offset + 5)
        width = buffer.readUInt16BE(offset + 7)
        break
      }
      offset += 2 + segmentLength
    }
  }
  if (!width || !height) throw new Error('The saved firm logo dimensions could not be read.')
  const scale = Math.min(360 / width, 80 / height, 1)
  return { buffer, width: Math.round(width * scale), height: Math.round(height * scale) }
}

function buildStatements(financials) {
  const current = financials.current
  const comparative = financials.comparative
  const noteNumbers = new Set((financials.notes || []).map(note => Number(note.number)))
  const note = (label, number) => noteNumbers.has(number) ? `${label} - Note ${number}` : label
  return [
    {
      title: 'Statement of financial position',
      rows: [
        { label: note('Cash and cash equivalents', 1), current: current.position.cash, comparative: comparative.position.cash },
        { label: note('Trade receivables', 2), current: current.position.receivables, comparative: comparative.position.receivables },
        { label: note('Inventories', 3), current: current.position.inventory, comparative: comparative.position.inventory },
        { label: note('Property and equipment, net', 4), current: current.position.ppeNet, comparative: comparative.position.ppeNet },
        { label: 'Total assets', current: current.position.assets, comparative: comparative.position.assets, total: true },
        { label: note('Trade payables', 5), current: current.position.payables, comparative: comparative.position.payables },
        { label: note('Borrowings', 6), current: current.position.borrowings, comparative: comparative.position.borrowings },
        { label: 'Total liabilities', current: current.position.liabilities, comparative: comparative.position.liabilities, total: true },
        { label: note('Share capital', 7), current: current.position.shareCapital, comparative: comparative.position.shareCapital },
        { label: note('Retained earnings', 7), current: current.position.retainedClosing, comparative: comparative.position.retainedClosing },
        { label: 'Total equity', current: current.position.equity, comparative: comparative.position.equity, total: true },
        { label: 'Total liabilities and equity', current: current.position.totalLiabilitiesAndEquity, comparative: comparative.position.totalLiabilitiesAndEquity, total: true },
      ],
    },
    {
      title: 'Statement of profit or loss and other comprehensive income',
      rows: [
        { label: note('Revenue', 8), current: current.profit.revenue, comparative: comparative.profit.revenue },
        { label: note('Other income', 8), current: current.profit.otherIncome, comparative: comparative.profit.otherIncome },
        { label: note('Cost of sales', 9), current: -current.profit.costOfSales, comparative: -comparative.profit.costOfSales },
        { label: note('Operating expenses', 9), current: -current.profit.operatingExpenses, comparative: -comparative.profit.operatingExpenses },
        { label: note('Depreciation', 9), current: -current.profit.depreciation, comparative: -comparative.profit.depreciation },
        { label: 'Profit before tax', current: current.profit.profitBeforeTax, comparative: comparative.profit.profitBeforeTax, total: true },
        { label: note('Income tax expense', 10), current: -current.profit.tax, comparative: -comparative.profit.tax },
        { label: 'Profit for the year', current: current.profit.profitForYear, comparative: comparative.profit.profitForYear, total: true },
        { label: note('Other comprehensive income', 11), current: current.profit.otherComprehensiveIncome, comparative: comparative.profit.otherComprehensiveIncome },
        { label: 'Total comprehensive income', current: current.profit.totalComprehensiveIncome, comparative: comparative.profit.totalComprehensiveIncome, total: true },
      ],
    },
    {
      title: 'Statement of changes in equity',
      rows: [
        { label: 'Share capital at start of year', current: current.equity.shareOpening, comparative: comparative.equity.shareOpening },
        { label: 'Share capital movements', current: current.equity.shareMovement, comparative: comparative.equity.shareMovement },
        { label: 'Share capital at year end', current: current.equity.shareClosing, comparative: comparative.equity.shareClosing, total: true },
        { label: 'Retained earnings at start of year', current: current.equity.retainedOpening, comparative: comparative.equity.retainedOpening },
        { label: 'Other retained earnings movements', current: current.equity.otherRetainedMovement, comparative: comparative.equity.otherRetainedMovement },
        { label: 'Profit for the year', current: current.equity.profitForYear, comparative: comparative.equity.profitForYear },
        { label: 'Dividends', current: -current.equity.dividends, comparative: -comparative.equity.dividends },
        { label: 'Retained earnings at year end', current: current.equity.retainedClosing, comparative: comparative.equity.retainedClosing, total: true },
        { label: 'Revaluation surplus at start of year', current: current.equity.revaluationSurplusOpening, comparative: comparative.equity.revaluationSurplusOpening },
        { label: 'Other comprehensive income - revaluation', current: current.equity.revaluationSurplusMovement, comparative: comparative.equity.revaluationSurplusMovement },
        { label: 'Revaluation surplus at year end', current: current.equity.revaluationSurplusClosing, comparative: comparative.equity.revaluationSurplusClosing, total: true },
        { label: 'Total equity at year end', current: current.equity.totalClosing, comparative: comparative.equity.totalClosing, total: true },
      ],
    },
    {
      title: 'Statement of cash flows',
      rows: [
        { label: 'Profit for the year', current: current.cashFlow.details.profitForYear, comparative: comparative.cashFlow.details.profitForYear },
        { label: 'Depreciation adjustment', current: current.cashFlow.details.depreciation, comparative: comparative.cashFlow.details.depreciation },
        { label: 'Increase in trade receivables', current: -current.cashFlow.details.receivablesChange, comparative: -comparative.cashFlow.details.receivablesChange },
        { label: 'Increase in inventories', current: -current.cashFlow.details.inventoryChange, comparative: -comparative.cashFlow.details.inventoryChange },
        { label: 'Movement in trade payables', current: current.cashFlow.details.payablesChange, comparative: comparative.cashFlow.details.payablesChange },
        { label: 'Net cash from operating activities', current: current.cashFlow.operating, comparative: comparative.cashFlow.operating, total: true },
        { label: 'Property and equipment additions / disposals', current: current.cashFlow.investing, comparative: comparative.cashFlow.investing },
        { label: 'Net cash used in investing activities', current: current.cashFlow.investing, comparative: comparative.cashFlow.investing, total: true },
        { label: 'Borrowings and share capital movements', current: current.cashFlow.details.borrowingChange + current.cashFlow.details.shareCapitalChange, comparative: comparative.cashFlow.details.borrowingChange + comparative.cashFlow.details.shareCapitalChange },
        { label: 'Dividends paid', current: -current.cashFlow.details.dividends, comparative: -comparative.cashFlow.details.dividends },
        { label: 'Net cash from financing activities', current: current.cashFlow.financing, comparative: comparative.cashFlow.financing, total: true },
        { label: 'Non-cash PPE revaluation (excluded from cash flows)', current: current.cashFlow.details.noncashPpeRevaluation, comparative: comparative.cashFlow.details.noncashPpeRevaluation },
        { label: 'Net increase in cash', current: current.cashFlow.netMovement, comparative: comparative.cashFlow.netMovement, total: true },
        { label: 'Cash at start of year', current: current.cashFlow.openingCash, comparative: comparative.cashFlow.openingCash },
        { label: 'Cash at end of year', current: current.cashFlow.closingCash, comparative: comparative.cashFlow.closingCash, total: true },
      ],
    },
  ]
}

export async function buildUaeEngagementWordDocument(source = {}) {
  const engagement = source.engagement || {}
  const output = source.reportOutput || {}
  const financials = source.financials
  if (engagement.reportingPackId !== 'AE_UAE_DEMO'
    || engagement.trialBalanceCurrency !== 'AED'
    || engagement.presentationCurrency !== 'AED') {
    throw new Error('Editable Word export is available only for the AED UAE demonstration reporting pack.')
  }
  if (!financials?.current || !financials?.comparative || !Array.isArray(financials.notes)) {
    throw new Error('Select a comparative Trial Balance and load reconciled UAE reporting data before exporting Word.')
  }
  if (!Number.isSafeInteger(Number(output.id)) || Number(output.id) <= 0
    || !Number.isSafeInteger(Number(output.version)) || Number(output.version) <= 0
    || !Number.isSafeInteger(Number(output.final_tb_version)) || Number(output.final_tb_version) <= 0) {
    throw new Error('A saved UAE PDF output and final Trial Balance revision are required for Word export.')
  }
  if (!source.snapshot || !Array.isArray(source.finalRows) || !Array.isArray(source.uaeMappings)) {
    throw new Error('The saved final Trial Balance rows and UAE mappings are required for Word export.')
  }
  if (Number(output.final_tb_version) !== Number(source.snapshot.version)
    || Number(output.final_tb_snapshot_id) !== Number(source.snapshot.id)) {
    throw new Error('The saved PDF and final Trial Balance versions do not match.')
  }
  if (output.financial_data_sha256 !== calculateUaeReportDataHash(source)) {
    throw new Error('The saved PDF data hash does not match the selected Trial Balance and mappings. Generate a new PDF version before exporting.')
  }

  const fields = output.audit_report_fields || {}
  const signing = output.signing_details || {}
  const identity = signing.identitySnapshot || {}
  const branding = identity.branding || {}
  const logo = imageBuffer(branding)
  const periodEnd = safeText(engagement.periodEnd || financials.periods?.current)
  const currentYear = String(financials.periods?.current || periodEnd).slice(0, 4)
  const comparativeYear = String(financials.periods?.comparative || source.comparativeTrialBalance?.dateTill || '').slice(0, 4)
  if (!currentYear || !comparativeYear) throw new Error('Current and comparative reporting periods are required for Word export.')

  const content = []
  content.push(new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, children: [new TextRun('Financial Reporting Pack')] }))
  if (logo) {
    content.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new ImageRun({
        data: logo.buffer,
        transformation: { width: logo.width, height: logo.height },
        altText: {
          name: safeText(branding.name, 250) || 'Firm logo',
          title: safeText(branding.name, 250) || 'Firm logo',
          description: 'Saved firm logo',
        },
      })],
    }))
  }
  content.push(
    paragraph(engagement.clientName || engagement.name, { alignment: AlignmentType.CENTER, spacing: { after: 100 } }),
    paragraph(safeText(branding.name || identity.responsibleFirm?.name || fields.firmName), { alignment: AlignmentType.CENTER }),
    paragraph('DRAFT FOR DEMONSTRATION', { alignment: AlignmentType.CENTER, spacing: { before: 600, after: 250 } }),
    paragraph(`Year ended 31 December ${currentYear}`, { alignment: AlignmentType.CENTER }),
    paragraph('United Arab Emirates | AED functional, source and presentation currency', { alignment: AlignmentType.CENTER }),
    paragraph(`Comparative year ended 31 December ${comparativeYear}`, { alignment: AlignmentType.CENTER }),
    paragraph(`Saved PDF version ${output.version} | Final Trial Balance version ${output.final_tb_version}`, {
      alignment: AlignmentType.CENTER, spacing: { before: 300 },
    }),
    paragraph('This editable document is a limited synthetic UAE demonstration, not a validated IFRS reporting pack. Edits made here remain in this Word file and do not update the engagement, Trial Balance, saved PDF, or Excel workbook.', {
      alignment: AlignmentType.CENTER, spacing: { before: 500 },
    }),
    paragraph('Source limitation: the saved output record identifies the final Trial Balance and report/signing snapshot, but does not snapshot the comparative selection or narrative disclosures. Those inputs are shown as currently saved for the selected reporting set.', {
      alignment: AlignmentType.CENTER, spacing: { before: 150 },
    }),
    new Paragraph({ children: [new PageBreak()] }),
    heading('Contents', HeadingLevel.TITLE),
    new TableOfContents('Contents', { headingStyleRange: '1-2', hyperlink: true }),
    new Paragraph({ children: [new PageBreak()] }),
    heading('Auditor-entered report'),
  )

  const auditSections = [
    ['Addressee', fields.addressee],
    ['Opinion', fields.opinion],
    ['Basis for opinion', fields.basisForOpinion],
    ['Management responsibilities', fields.managementResponsibilities],
    ['Auditor responsibilities', fields.auditorResponsibilities],
    ['Other matters', fields.otherMatters],
  ]
  for (const [label, text] of auditSections) {
    if (!String(text || '').trim()) continue
    if (label !== 'Addressee') content.push(heading(label, HeadingLevel.HEADING_2))
    content.push(paragraph(text))
  }
  content.push(
    paragraph(`${safeText(fields.reportPlace)} - ${safeText(fields.reportDate)}`, { spacing: { before: 300 } }),
    paragraph(safeText(fields.auditorName), { bold: true }),
    paragraph(`${safeText(fields.auditorDesignation)}${fields.auditorMembershipNumber ? ` - ${safeText(fields.auditorMembershipNumber)}` : ''}`),
    paragraph(`${safeText(fields.firmName)}${fields.firmRegistrationNumber ? ` - ${safeText(fields.firmRegistrationNumber)}` : ''}`),
    paragraph(fields.firmAddress),
  )

  const currentLabel = `${currentYear} (${engagement.trialBalanceCurrency})`
  const comparativeLabel = `${comparativeYear} (${engagement.presentationCurrency})`
  for (const statement of buildStatements(financials)) {
    content.push(new Paragraph({ children: [new PageBreak()] }))
    content.push(heading(statement.title))
    content.push(paragraph(`${safeText(engagement.clientName || engagement.name)} - ${statement.title === 'Statement of financial position'
      ? `As at 31 December ${currentYear}`
      : `Year ended 31 December ${currentYear}`}`, {
      spacing: { after: 160 },
    }))
    content.push(reportTable(statement.rows, currentLabel, comparativeLabel))
  }

  content.push(new Paragraph({ children: [new PageBreak()] }), heading('Notes to the financial statements'))
  const narratives = new Map((source.noteDisclosures || []).map(item => [Number(item.note_num), safeText(item.text)]))
  for (const note of [...financials.notes].sort((a, b) => Number(a.number) - Number(b.number))) {
    content.push(heading(`Note ${note.number} - ${note.title}`, HeadingLevel.HEADING_2))
    content.push(paragraph(narratives.get(Number(note.number))
      || 'Supporting account balances derived from the saved final Trial Balance.'))
    const rows = noteAccounts(note).map(account => ({
      label: account.displayName || account.name,
      current: account.current,
      comparative: account.comparative,
    }))
    rows.push({
      label: 'Note total',
      current: note.currentTotal,
      comparative: note.comparativeTotal,
      total: true,
    })
    content.push(reportTable(rows, currentLabel, comparativeLabel))
  }

  content.push(new Paragraph({ children: [new PageBreak()] }), heading('Financial statement approval'))
  content.push(paragraph(`Approved on ${safeText(signing.approvalDate)} at ${safeText(signing.approvalPlace)}.`))
  for (const signatory of signing.signatories || []) {
    content.push(paragraph(`${safeText(signatory.name)}${signatory.designation ? ` - ${safeText(signatory.designation)}` : ''}`, { spacing: { before: 200 } }))
  }
  content.push(
    paragraph(`Report date and place: ${safeText(fields.reportDate)} - ${safeText(fields.reportPlace)}`, { spacing: { before: 300 } }),
    paragraph(`Saved PDF output ID: ${output.id}; PDF version: ${output.version}; report template: ${safeText(output.template_id)} r${safeText(output.template_revision)}.`),
    paragraph(`Final Trial Balance snapshot: ${safeText(output.final_tb_snapshot_id)}; version: ${safeText(output.final_tb_version)}.`),
    paragraph(`Final Trial Balance data SHA-256: ${safeText(output.financial_data_sha256, 128)}.`),
    paragraph(`Comparative Trial Balance: ${safeText(source.comparativeTrialBalance?.id)} - ${safeText(source.comparativeTrialBalance?.filename || source.comparativeTrialBalance?.sourceFilename)}.`),
  )

  const footer = new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: 'Draft for demonstration  |  Page ' }),
        new TextRun({ children: [PageNumber.CURRENT] }),
        new TextRun({ text: ' of ' }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES] }),
      ],
    })],
  })
  const document = new Document({
    title: `${safeText(engagement.clientName || engagement.name)} - UAE demonstration reporting pack`,
    subject: `Saved PDF v${output.version}; final Trial Balance v${output.final_tb_version}`,
    creator: safeText(fields.firmName || 'FSG Bharat'),
    description: 'Editable synthetic UAE demonstration reporting pack; external edits do not update engagement data.',
    features: { updateFields: true },
    styles: {
      default: {
        document: { run: { font: 'Arial', size: 20, color: '17202A' } },
        heading1: { run: { font: 'Arial', size: 30, bold: true, color: '17365D' }, paragraph: { spacing: { before: 300, after: 150 } } },
        heading2: { run: { font: 'Arial', size: 24, bold: true, color: '365F91' }, paragraph: { spacing: { before: 240, after: 100 } } },
        title: { run: { font: 'Arial', size: 40, bold: true, color: '17365D' }, paragraph: { spacing: { after: 300 } } },
      },
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1200, right: 1450, bottom: 1200, left: 1450 },
        },
      },
      footers: { default: footer },
      children: content,
    }],
  })
  return Packer.toBuffer(document)
}
