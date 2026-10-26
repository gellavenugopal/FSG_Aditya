import fs from 'node:fs'
import path from 'node:path'
import * as XLSX from 'xlsx'
import { resolveDisposableTestTarget } from '../src/main/test-isolation.mjs'

if (process.env.FSG_TEST_MODE !== 'true') {
  throw new Error('Generate UAE Sample 01 source balances only inside the isolated engagement demo.')
}

const { target } = resolveDisposableTestTarget()
const demoHome = path.dirname(process.env.FSG_TEST_TARGET_FILE)
const outputDirectory = path.join(demoHome, 'inputs')
const sourceDescription = 'Synthetic UAE Sample 01 LLC trial balance; AED; not client accounts.'

function normaliseSourceBalance(sourceDebit, sourceCredit) {
  if (!Number.isFinite(sourceDebit) || !Number.isFinite(sourceCredit) || sourceDebit < 0 || sourceCredit < 0) {
    throw new Error('Synthetic source balances must be non-negative debit/credit amounts.')
  }
  if (sourceDebit > 0 && sourceCredit > 0) {
    throw new Error('A synthetic trial-balance row cannot have both debit and credit closing balances.')
  }
  return round(sourceCredit - sourceDebit)
}

function round(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function makeRow(code, name, openingSigned, closingSigned, isRevenue = false) {
  const openingDebit = Math.max(0, -openingSigned)
  const openingCredit = Math.max(0, openingSigned)
  const closingDebit = Math.max(0, -closingSigned)
  const closingCredit = Math.max(0, closingSigned)
  const movement = round(closingSigned - openingSigned)
  const debitMovement = Math.max(0, -movement)
  const creditMovement = Math.max(0, movement)
  return {
    Period: '',
    Branch: '',
    'Ledger Code': code,
    Name: name,
    OpeningBalance: normaliseSourceBalance(openingDebit, openingCredit),
    Debit: debitMovement,
    Credit: creditMovement,
    ClosingBalance: normaliseSourceBalance(closingDebit, closingCredit),
    IsRevenue: isRevenue,
    IsDeemedPositive: closingSigned <= 0,
    TrailBalance: normaliseSourceBalance(closingDebit, closingCredit),
    Parent: '',
    'Source Closing Debit AED': closingDebit,
    'Source Closing Credit AED': closingCredit,
    'Sign Normalisation': 'FSG convention: debit balance stored negative; credit balance stored positive',
  }
}

const priorAccounts = [
  ['1000', 'Cash and cash equivalents', -96000, -100000, false],
  ['1100', 'Trade receivables', -15000, -20000, false],
  ['1200', 'Inventories', -12000, -15000, false],
  ['1500', 'Property and equipment - cost', -50000, -60000, false],
  ['1590', 'Accumulated depreciation', 5000, 10000, false],
  ['2000', 'Trade payables', 8000, 12000, false],
  ['2100', 'Borrowings', 25000, 20000, false],
  ['3000', 'Share capital', 50000, 50000, false],
  ['3100', 'Retained earnings brought forward', 85000, 85000, false],
  ['4000', 'Revenue', 0, 160000, true],
  ['5000', 'Cost of sales', 0, -60000, false],
  ['6000', 'Operating expenses', 0, -50000, false],
  ['6100', 'Depreciation expense', 0, -5000, false],
  ['6200', 'Income tax expense', 0, -7000, false],
  ['3200', 'Dividends', 0, -20000, false],
]
const currentAccounts = [
  ['1000', 'Cash and cash equivalents', -100000, -133000, false],
  ['1100', 'Trade receivables', -20000, -30000, false],
  ['1200', 'Inventories', -15000, -20000, false],
  ['1500', 'Property and equipment - cost', -60000, -80000, false],
  ['1590', 'Accumulated depreciation', 10000, 20000, false],
  ['2000', 'Trade payables', 12000, 20000, false],
  ['2100', 'Borrowings', 20000, 37000, false],
  ['3000', 'Share capital', 50000, 68000, false],
  ['3100', 'Retained earnings brought forward', 103000, 103000, false],
  ['4000', 'Revenue', 0, 200000, true],
  ['5000', 'Cost of sales', 0, -80000, false],
  ['6000', 'Operating expenses', 0, -60000, false],
  ['6100', 'Depreciation expense', 0, -10000, false],
  ['6200', 'Income tax expense', 0, -10000, false],
  ['3200', 'Dividends', 0, -25000, false],
]

function buildWorkbook(filename, period, accounts) {
  const rows = accounts.map(([code, name, opening, closing, isRevenue]) =>
    makeRow(code, name, opening, closing, isRevenue))
  const total = round(rows.reduce((sum, row) => sum + row.ClosingBalance, 0))
  if (Math.abs(total) > 0.01) throw new Error(`${filename} synthetic Trial Balance does not balance: AED ${total}.`)
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.json_to_sheet(rows)
  XLSX.utils.book_append_sheet(workbook, sheet, 'Trial Balance')
  const basis = XLSX.utils.aoa_to_sheet([
    ['UAE Sample 01 - synthetic data only'],
    [sourceDescription],
    ['Reporting currency', 'AED'],
    ['Reporting period', period],
    ['Source convention', 'Source debit and credit closing balances are shown in separate columns.'],
    ['Imported closing-balance convention', 'ClosingBalance = source credit - source debit; debit-natured balances are negative and credit-natured balances are positive.'],
    ['No currency translation', 'All figures are generated directly in AED.'],
  ])
  XLSX.utils.book_append_sheet(workbook, basis, 'Basis')
  const filePath = path.join(outputDirectory, filename)
  fs.writeFileSync(filePath, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
  return { filePath, rowCount: rows.length, normalizedTrialBalance: total }
}

fs.mkdirSync(outputDirectory, { recursive: true })
const results = [
  buildWorkbook('UAE-Sample-01-2025.xlsx', '01-Jan-2025 to 31-Dec-2025', currentAccounts),
  buildWorkbook('UAE-Sample-01-2024.xlsx', '01-Jan-2024 to 31-Dec-2024', priorAccounts),
]

console.info(JSON.stringify({
  result: 'synthetic AED source Trial Balances generated',
  target: `${target.host}:${target.port}/${target.database}`,
  sourceDescription,
  files: results,
}, null, 2))
