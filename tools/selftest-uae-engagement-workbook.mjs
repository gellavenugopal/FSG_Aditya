import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import ExcelJS from 'exceljs'
import {
  buildUaeDemoComparativeMappings,
  buildUaeDemoFinancials,
  getUaeDemoAccountLine,
  getUaeDemoReportingBalance,
  UAE_DEMO_ACCOUNT_LINES,
} from '../src/renderer/src/components/Engagements/uaeDemoReporting.js'
import { buildUaeEngagementWorkbook } from '../src/main/services/uae-engagement-workbook.js'
import {
  applyUaeIfrsFixtureJournals,
  createUaeIfrsTestBedFixtures,
} from './uae-ifrs-testbed-fixtures.mjs'

const fixture = createUaeIfrsTestBedFixtures()[0]
const comparativeMappings = buildUaeDemoComparativeMappings(
  [{ id: 1, ledger_code: 'AR-100', name: 'Current customer balances' }],
  { '1': 'trade_receivables' },
)
assert.equal(getUaeDemoAccountLine(
  { id: 2, ledger_code: 'AR-100', name: 'Legacy ledger title' }, comparativeMappings,
), 'trade_receivables', 'comparatives reuse the selected current mapping by ledger code')
const finalRows = applyUaeIfrsFixtureJournals(fixture).map((row, index) => ({
  ...row,
  debit: Number(fixture.currentTrialBalance.rows[index].debit || 0) + Number(row.debit || 0),
  credit: Number(fixture.currentTrialBalance.rows[index].credit || 0) + Number(row.credit || 0),
}))
const uaeMappings = finalRows.map(row => ({
  trialBalanceRowId: row.id,
  lineKey: fixture.currentTrialBalance.mappings[String(row.id)],
}))
const financials = buildUaeDemoFinancials({
  currentRows: finalRows,
  comparativeRows: fixture.comparativeTrialBalance.rows,
  mappings: fixture.currentTrialBalance.mappings,
  periodEnd: fixture.engagement.settings.currentPeriodEnd,
  comparativePeriodEnd: fixture.engagement.settings.comparativePeriodEnd,
})
const finalReportingBalances = finalRows.map(row => getUaeDemoReportingBalance(
  row, fixture.currentTrialBalance.mappings[String(row.id)],
))
const finalReportingByLine = {}
for (const [index, row] of finalRows.entries()) {
  const key = fixture.currentTrialBalance.mappings[String(row.id)]
  finalReportingByLine[key] = (finalReportingByLine[key] || 0) + finalReportingBalances[index]
}
const originalPriorRows = fixture.comparativeTrialBalance.rows.map(row => {
  const lineKey = fixture.comparativeTrialBalance.mappings[String(row.id)]
  return {
    ...row,
    debit: Number(row.debit || 0),
    credit: Number(row.credit || 0),
    lineKey,
    reportingBalance: getUaeDemoReportingBalance(row, lineKey),
  }
})
const priorReportingByLine = {}
for (const row of originalPriorRows) {
  priorReportingByLine[row.lineKey] = (priorReportingByLine[row.lineKey] || 0) + row.reportingBalance
}
const snapshot = { id: 7001, version: 1, journal_watermark: 2, source_trial_balance_id: 100000 }
const hashRows = finalRows.map(row => ({
  id: row.id,
  name: row.name,
  ledger_code: row.ledger_code,
  opening_balance: row.opening_balance,
  closing_balance: row.closing_balance,
  line_key: fixture.currentTrialBalance.mappings[String(row.id)] || null,
}))
const financialDataSha256 = createHash('sha256').update(JSON.stringify({
  snapshotId: snapshot.id,
  version: snapshot.version,
  journalWatermark: snapshot.journal_watermark,
  rows: hashRows,
})).digest('hex')
const source = {
  engagement: {
    reference: 'UAE-SAMPLE-01-2025',
    name: fixture.engagement.name,
    clientName: fixture.entity.name,
    jurisdiction: 'United Arab Emirates',
    legalForm: 'LLC',
    periodStart: '2025-01-01',
    periodEnd: '2025-12-31',
    trialBalanceCurrency: 'AED',
    presentationCurrency: 'AED',
  },
  snapshot,
  reportOutput: {
    id: 91,
    version: 7,
    final_tb_snapshot_id: snapshot.id,
    final_tb_version: snapshot.version,
    template_id: 'uae-demo-v1',
    template_revision: 4,
    financial_data_sha256: financialDataSha256,
    audit_report_fields: {
      opinion: 'Synthetic demonstration opinion.',
      basisForOpinion: 'Synthetic basis.',
      managementResponsibilities: 'Synthetic management responsibilities.',
      auditorResponsibilities: 'Synthetic auditor responsibilities.',
      otherMatters: 'Synthetic other matters.',
      reportDate: '2026-10-27',
      reportPlace: 'Dubai',
      firmName: 'Synthetic UAE Test Firm',
      auditorName: 'Synthetic Test Partner',
      auditorMembershipNumber: 'DEMO-01',
    },
    signing_details: {
      approvalDate: '2026-10-27',
      approvalPlace: 'Dubai',
      signatories: [{ id: 1, name: 'Synthetic Managing Member', designation: 'Managing Member' }],
      identitySnapshot: {},
    },
  },
  currentTrialBalance: { id: 100000, filename: 'Synthetic current TB.xlsx' },
  comparativeTrialBalance: { id: 110000, filename: 'Synthetic comparative TB.xlsx', dateFrom: '2024-01-01', dateTill: '2024-12-31' },
  originalCurrentRows: fixture.currentTrialBalance.rows.map(row => ({
    ...row, debit: Number(row.debit || 0), credit: Number(row.credit || 0),
  })),
  originalPriorRows,
  journals: fixture.journals.map((journal, index) => ({
    id: index + 1,
    source_trial_balance_id: 100000,
    entry_number: index + 1,
    journal_date: journal.date,
    narration: journal.description,
    posted_by: 'Synthetic reviewer',
    lines: journal.entries.map((entry, lineNumber) => ({
      ...entry,
      lineNumber: lineNumber + 1,
      ledgerCode: '',
    })),
  })),
  finalRows,
  finalReportingBalances,
  finalReportingByLine,
  priorReportingByLine,
  uaeMappings,
  accountLines: UAE_DEMO_ACCOUNT_LINES,
  noteDisclosures: fixture.disclosures.narrative,
  financials,
}

const buffer = await buildUaeEngagementWorkbook(source)
assert.ok(buffer.byteLength > 5000, 'workbook has substantive content')
const workbook = new ExcelJS.Workbook()
await workbook.xlsx.load(buffer)

const expectedSheets = [
  'Revision & Guide', 'Report & Signatures', 'Original Current TB', 'Original Prior TB',
  'Posted Journals', 'Review Adjustments', 'Final TB', 'Statements & Schedules',
  'Movement Schedules', 'Notes', 'Reconciliation Checks',
]
for (const sheetName of expectedSheets) {
  assert.ok(workbook.getWorksheet(sheetName), `includes ${sheetName}`)
}

const statements = workbook.getWorksheet('Statements & Schedules')
assert.equal(statements.getCell('B8').value.result, 239250, 'SFP assets cache matches the shared reporting calculation')
assert.equal(statements.getCell('B27').value.result, 36250, 'profit cache matches the shared reporting calculation')
assert.match(statements.getCell('B28').value.formula, /other_comprehensive_income/, 'OCI has its own formula row')
assert.equal(statements.getCell('B29').value.result, 36250, 'comprehensive income reconciles')
assert.equal(statements.getCell('B17').value.result || 0, 0, 'SFP difference is zero')
assert.equal(statements.getCell('B43').value.result || 0, 0, 'equity movement difference is zero')
assert.equal(statements.getCell('B61').value.result || 0, 0, 'cash flow difference is zero')
assert.match(statements.getCell('B8').value.formula, /SUM/)
assert.match(statements.getCell('B4').value.formula, /Final TB/, 'statement line formulas link through the Final TB sheet')

const reviewAdjustments = workbook.getWorksheet('Review Adjustments')
assert.equal(reviewAdjustments.getCell('B56').value.formula, 'ROUND(B54-B55,2)', 'review adjustment balance check is explicit')
assert.ok(Object.keys(reviewAdjustments.dataValidations.model).includes('C3')
  && Object.keys(reviewAdjustments.dataValidations.model).includes('C52'), 'review adjustment row ID selection is constrained')
const finalTB = workbook.getWorksheet('Final TB')
assert.match(finalTB.getCell('M3').value.formula, /G3-K3\+L3/, 'review inputs flow into adjusted Trial Balance')
assert.match(finalTB.getCell('N3').value.formula, /M3/, 'reporting amount links to adjusted balance')
assert.ok(Object.keys(finalTB.dataValidations.model).includes('I3')
  && Object.keys(finalTB.dataValidations.model).some(range => range.startsWith('I')), 'mapping override has a constrained list')
assert.equal(finalTB.views[0].ySplit, 2, 'final Trial Balance headings remain frozen')
assert.ok(finalTB.pageSetup.printArea, 'final Trial Balance has an explicit print area')

const notes = workbook.getWorksheet('Notes')
assert.ok(notes.getCell('E3').value.formula.includes('Final TB'), 'note balances use formulas linked to final Trial Balance')
assert.equal(notes.pageSetup.printArea, `A1:G${notes.rowCount}`,
  'the notes print area includes all account rows and note-total rows')
assert.ok(notes.getColumn(7).values.some(value => String(value || '').includes('Synthetic')),
  'saved narrative disclosure is included')
const checks = workbook.getWorksheet('Reconciliation Checks')
const movements = workbook.getWorksheet('Movement Schedules')
assert.ok(movements.getCell('B3').value.formula.includes('Original Prior TB'),
  'supporting PPE movement schedule links to the comparative Trial Balance')
assert.ok(movements.getCell('E4').value.includes('Non-cash'),
  'non-cash revaluation is distinguished from cash movement')
assert.ok([...checks.getRows(3, checks.rowCount - 2)].some(row => String(row.getCell(1).value).includes('Note 1 Current reconciliation')),
  'note-to-statement reconciliation checks are present')

for (const sheet of workbook.worksheets) {
  sheet.eachRow({ includeEmpty: false }, row => {
    row.eachCell({ includeEmpty: false }, cell => {
      if (cell.value && typeof cell.value === 'object' && 'formula' in cell.value) {
        assert.ok(!cell.value.formula.includes('#REF!'), `${sheet.name}!${cell.address} has no broken formula reference`)
        assert.ok(typeof cell.value.result !== 'object', `${sheet.name}!${cell.address} has a scalar cached result`)
      }
    })
  })
}

const mismatchedSource = { ...source, reportOutput: { ...source.reportOutput, financial_data_sha256: '0'.repeat(64) } }
await assert.rejects(() => buildUaeEngagementWorkbook(mismatchedSource), /data hash does not match/,
  'an edited source cannot be presented as the saved PDF revision')

console.log(`UAE workbook self-test passed: ${expectedSheets.length} visible sheets, formulas, source-hash guard, and shared totals (assets ${statements.getCell('B8').value.result}; profit ${statements.getCell('B27').value.result}).`)
