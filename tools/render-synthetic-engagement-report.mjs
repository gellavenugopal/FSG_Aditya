import { app, BrowserWindow } from 'electron'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFDocument } from 'pdf-lib'
import XLSX from 'xlsx'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.resolve(root, 'artifacts', 'Synthetic-Engagement-India-Reporting-Pack.pdf')
const workbookOutput = path.resolve(root, 'artifacts', 'Synthetic-Engagement-TB.xlsx')

const entity = {
  id: 1,
  name: 'Synthetic Sample Private Limited',
  constitution: 3,
  constitution_display: 'Company',
  business_type: 'Trader',
  cin: 'U00000IN2025PTC000001',
  address: '1 Sample Street, Sample City, India',
}
const engagement = {
  id: 1,
  reference: 'SYN-2026-001',
  name: 'Synthetic statutory audit',
  periodStart: '2025-04-01',
  periodEnd: '2026-03-31',
}
const activeTB = {
  id: 2,
  entity_id: entity.id,
  entity_period_id: 1,
  period: '2025-04-01 To 2026-03-31',
  filename: 'Synthetic Final TB v2',
}
const levelFormat = [
  { id: 1, rule_set_id: 1, constitution: 3, alie: 'ASSETS', level1: 'Current assets', level2: 'Cash and cash equivalents', level3: null, sort_order: 1 },
  { id: 2, rule_set_id: 1, constitution: 3, alie: 'EQUITY AND LIABILITIES', level1: 'Equity', level2: 'Share capital', level3: null, sort_order: 2 },
  { id: 3, rule_set_id: 1, constitution: 3, alie: 'Expenses', level1: 'Expenses', level2: 'Other expenses', level3: null, sort_order: 3 },
]
const financialRows = [
  {
    id: 1, mapped_id: 1, tb_row_id: 1, tb_id: activeTB.id, ledger_name: 'Synthetic Cash', name: 'Synthetic Cash',
    ledger_code: '1001', opening_balance: '-100', closing_balance: '-80', trail_balance: '-80',
    is_deemed_positive: true, upload_nature: 'Engagement Final TB', status: 'auto_medium',
    mapping1_resultant: 'Current assets', mapping2_resultant: 'Cash and cash equivalents',
    mapping3_resultant: null, level4_value: null, level5_value: null, level6_value: null, level7_value: null,
    lf_id: 1, alie: 'ASSETS', level1: 'Current assets', level2: 'Cash and cash equivalents',
    level3: null, level4: null, lf_level5: null, lf_level6: null, lf_level7: null, sort_order: 1,
  },
  {
    id: 2, mapped_id: 2, tb_row_id: 2, tb_id: activeTB.id, ledger_name: 'Synthetic Capital', name: 'Synthetic Capital',
    ledger_code: '3001', opening_balance: '100', closing_balance: '120', trail_balance: '120',
    is_deemed_positive: false, upload_nature: 'Engagement Final TB', status: 'auto_medium',
    mapping1_resultant: 'Equity', mapping2_resultant: 'Share capital',
    mapping3_resultant: null, level4_value: null, level5_value: null, level6_value: null, level7_value: null,
    lf_id: 2, alie: 'EQUITY AND LIABILITIES', level1: 'Equity', level2: 'Share capital',
    level3: null, level4: null, lf_level5: null, lf_level6: null, lf_level7: null, sort_order: 2,
  },
  {
    id: 3, mapped_id: 3, tb_row_id: 3, tb_id: activeTB.id, ledger_name: 'Synthetic Expense', name: 'Synthetic Expense',
    ledger_code: '2001', opening_balance: '-20', closing_balance: '-40', trail_balance: '-40',
    is_deemed_positive: true, upload_nature: 'Engagement Final TB', status: 'auto_medium',
    mapping1_resultant: 'Expenses', mapping2_resultant: 'Other expenses',
    mapping3_resultant: null, level4_value: null, level5_value: null, level6_value: null, level7_value: null,
    lf_id: 3, alie: 'Expenses', level1: 'Expenses', level2: 'Other expenses',
    level3: null, level4: null, lf_level5: null, lf_level6: null, lf_level7: null, sort_order: 3,
  },
]

const reportFields = {
  addressee: 'To the Members of Synthetic Sample Private Limited',
  opinion: 'In our opinion, the accompanying financial statements present fairly, in all material respects, the financial position of the Company as at 31 March 2026 and its financial performance for the year then ended.',
  basisForOpinion: 'We conducted our audit in accordance with the applicable auditing standards. This synthetic sample is for workflow review only and is not an audit opinion for a real entity.',
  managementResponsibilities: 'Management is responsible for the preparation of these financial statements and for maintaining internal controls relevant to their preparation.',
  auditorResponsibilities: 'Our responsibility is to express an opinion based on an audit of the financial statements.',
  otherMatters: '',
  reportDate: '2026-05-01',
  reportPlace: 'Sample City',
  firmName: 'Synthetic Audit LLP',
  firmAddress: '1 Sample Street, Sample City, India',
  firmRegistrationNumber: 'FRN-SYN-0001',
  auditorName: 'A. Sample',
  auditorMembershipNumber: 'M-1001',
  auditorDesignation: 'Partner',
}
const signatories = [
  { id: 1, name: 'R. Example', designation: 'Director', din: '00000001', id_type: 'DIN' },
]

const vite = await createServer({
  configFile: false,
  root,
  plugins: [react()],
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
})

try {
  const [{ buildEngagementFinancials }, { buildFinancialsHTML }, reportHtml] = await Promise.all([
    vite.ssrLoadModule('/src/renderer/src/hooks/useFinancials.js'),
    vite.ssrLoadModule('/src/renderer/src/components/GenerateFinancials/buildHTML.js'),
    vite.ssrLoadModule('/src/renderer/src/components/Engagements/engagementReportHtml.js'),
  ])
  const financialData = buildEngagementFinancials({
    entity,
    financialRows,
    levelFormat,
    noteDetails: [],
    generalNotes: null,
  })
  const reportSections = [
    ...(financialData.elSections || []),
    ...(financialData.assetSections || []),
    ...(financialData.incomeSections || []),
    ...(financialData.expenseSections || []),
  ]
  if (reportSections.some(section => Math.abs(Number(section.prevTotal || 0)) >= 0.005)) {
    throw new Error('A comparative Trial Balance is not selected, but previous-year statement figures were calculated.')
  }
  const financialsHtml = buildFinancialsHTML({
    entity,
    activeTB,
    prevTB: null,
    data: financialData,
    auditor: {
      name: reportFields.auditorName,
      membership_number: reportFields.auditorMembershipNumber,
      designation: reportFields.auditorDesignation,
      firm_name: reportFields.firmName,
      frn: reportFields.firmRegistrationNumber,
      firm_address: reportFields.firmAddress,
    },
    signatories,
    includeSigningPage: true,
    noteDetailsMap: {},
    noteDisclosureMap: { 1: 'This disclosure is synthetic and demonstrates a separately maintained note narrative.' },
    signPlace: 'Sample City',
    signDate: '2026-04-30',
  })
  const html = reportHtml.prependAuditReport(
    financialsHtml,
    reportHtml.makeAuditReportPage(reportFields, entity, engagement),
  )

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Period', 'Ledger Code', 'Name', 'OpeningBalance', 'Debit', 'Credit', 'ClosingBalance', 'Parent', 'Group.$Parent'],
    ['2025-26', '1001', 'Synthetic Cash', -100, 20, 0, -80, 'Current Assets', 'Current Assets'],
    ['2025-26', '2001', 'Synthetic Expense', -20, 0, 0, -20, 'Expenses', 'Expenses'],
    ['2025-26', '3001', 'Synthetic Capital', 100, 0, 0, 100, 'Equity', 'Equity'],
  ]), 'Trial Balance')

  await app.whenReady()
  const pdfWindow = new BrowserWindow({
    show: false,
    width: 794,
    height: 1123,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  try {
    await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    await new Promise(resolve => setTimeout(resolve, 500))
    const pdfBytes = await pdfWindow.webContents.printToPDF({
      pageSize: 'A4',
      margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 },
      printBackground: true,
      landscape: false,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
    })
    const document = await PDFDocument.load(pdfBytes)
    if (document.getPageCount() < 3) throw new Error('The combined sample report did not render the audit report, statements, and notes pages.')
    await mkdir(path.dirname(output), { recursive: true })
    await writeFile(output, pdfBytes)
    XLSX.writeFile(workbook, workbookOutput)
    console.info(`Generated ${document.getPageCount()}-page synthetic report: ${output}`)
    console.info(`Generated synthetic import workbook: ${workbookOutput}`)
  } finally {
    pdfWindow.close()
  }
} finally {
  await vite.close()
  app.quit()
}
