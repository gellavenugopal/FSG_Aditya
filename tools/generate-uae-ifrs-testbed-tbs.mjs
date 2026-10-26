import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import * as XLSX from 'xlsx'
import { resolveDisposableTestTarget } from '../src/main/test-isolation.mjs'
import {
  applyUaeIfrsFixtureJournals,
  createUaeIfrsTestBedFixtures,
} from './uae-ifrs-testbed-fixtures.mjs'

if (process.env.FSG_TEST_MODE !== 'true') {
  throw new Error('Generate UAE IFRS test-bed Trial Balances only inside the existing isolated engagement demo.')
}

const { target } = resolveDisposableTestTarget()
const demoHome = path.dirname(process.env.FSG_TEST_TARGET_FILE)
const outputDirectory = path.join(demoHome, 'inputs', 'UAE-IFRS-Testbed')
const sourceConvention = 'Signed source debit balances are negative and credit balances are positive; all amounts are AED.'

function buildRows(trialBalance, isCurrent, fixture) {
  if (isCurrent) applyUaeIfrsFixtureJournals(fixture)
  const rows = trialBalance.rows.map(row => {
    const opening = Number(row.opening_balance || 0)
    const closing = Number(row.closing_balance || 0)
    const movement = closing - opening
    return {
      Period: '',
      Branch: '',
      'Ledger Code': row.ledger_code,
      Name: row.name,
      OpeningBalance: opening,
      Debit: Math.max(0, -movement),
      Credit: Math.max(0, movement),
      ClosingBalance: closing,
      IsRevenue: fixture.currentTrialBalance.mappings[String(row.id)] === 'revenue',
      IsDeemedPositive: closing <= 0,
      TrailBalance: closing,
      Parent: '',
    }
  })
  const balance = rows.reduce((total, row) => total + Number(row.ClosingBalance), 0)
  if (Math.round(balance * 100) !== 0) {
    throw new Error(`${fixture.id} ${isCurrent ? 'current' : 'comparative'} source TB does not balance: AED ${balance}.`)
  }
  return rows
}

function writeWorkbook(fixture, trialBalance, period, suffix, isCurrent) {
  const rows = buildRows(trialBalance, isCurrent, fixture)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Trial Balance')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    [`${fixture.id} - synthetic data only`],
    ['This workbook is a reusable IFRS test-bed fixture, not client accounts.'],
    ['Entity', fixture.entity.name],
    ['Legal form', fixture.entity.legalForm],
    ['Jurisdiction', fixture.engagement.settings.jurisdiction],
    ['Reporting currency', fixture.engagement.settings.sourceCurrency],
    ['Reporting period', period],
    ['Source convention', sourceConvention],
    ['Final TB adjustments', isCurrent
      ? 'Post the balanced journals in the matching fixture before creating the final Trial Balance.'
      : 'No comparative-period journals are applied.'],
    ['Currency translation', 'None; source balances are already AED.'],
  ]), 'Basis')

  const filename = `${fixture.id}-${suffix}.xlsx`
  const outputPath = path.join(outputDirectory, filename)
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
  fs.writeFileSync(outputPath, buffer)
  return {
    filename,
    outputPath,
    rows: rows.length,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
  }
}

fs.mkdirSync(outputDirectory, { recursive: true })
const files = []
for (const fixture of createUaeIfrsTestBedFixtures().filter(item => item.id.startsWith('B-') || item.id.startsWith('C-'))) {
  files.push(
    writeWorkbook(
      fixture,
      fixture.currentTrialBalance,
      '01-Jan-2025 to 31-Dec-2025',
      '2025',
      true,
    ),
    writeWorkbook(
      fixture,
      fixture.comparativeTrialBalance,
      '01-Jan-2024 to 31-Dec-2024',
      '2024',
      false,
    ),
  )
}

console.info(JSON.stringify({
  result: 'synthetic UAE IFRS test-bed source Trial Balances generated',
  target: `${target.host}:${target.port}/${target.database}`,
  outputDirectory,
  sourceConvention,
  files,
}, null, 2))
