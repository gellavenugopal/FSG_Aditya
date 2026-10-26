import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')
const home = path.resolve(process.env.FSG_DEMO_HOME || path.join(os.homedir(), 'FSG-Aditya-engagement-demo'))
const target = JSON.parse(fs.readFileSync(path.join(home, 'target.json'), 'utf8'))
const currentPeriod = '2025-26'
const priorPeriod = '2024-25'
const workbookHeaders = [
  'Period', 'Branch', 'Ledger Code', 'Name', 'OpeningBalance', 'Debit', 'Credit', 'ClosingBalance',
  'IsRevenue', 'IsDeemedPositive', 'TrailBalance', 'Parent', 'Group.$Parent',
]

const priorRows = [
  ['3100', 'Share Capital', 0, 0, 100000, 100000, false, false, 'Capital', 'Capital'],
  ['3200', 'Retained Earnings', 0, 0, 0, 0, false, false, 'Reserves & Surplus', 'Reserves & Surplus'],
  ['1500', 'Office Equipment', 0, 80000, 0, -80000, false, true, 'Fixed Assets', 'Fixed Assets'],
  ['1590', 'Accumulated Depreciation - Office Equipment', 0, 0, 15000, 15000, false, false, 'Fixed Assets', 'Fixed Assets'],
  ['1100', 'Main Bank Account', 0, 60000, 0, -60000, false, true, 'Bank Accounts', 'Bank Accounts'],
  ['1200', 'Trade Receivables', 0, 30000, 0, -30000, false, true, 'Sundry Debtors', 'Current Assets'],
  ['2100', 'Trade Payables', 0, 0, 15000, 15000, false, false, 'Sundry Creditors', 'Current Liabilities'],
  ['4100', 'Product Revenue', 0, 0, 100000, 100000, true, false, 'Sales Accounts', 'Sales Accounts'],
  ['5100', 'Operating Expenses', 0, 50000, 0, -50000, false, true, 'Indirect Expenses', 'Indirect Expenses'],
  ['5200', 'Depreciation Expense', 0, 5000, 0, -5000, false, true, 'Indirect Expenses', 'Indirect Expenses'],
  ['5300', 'Current Tax Expense', 0, 5000, 0, -5000, false, true, 'Indirect Expenses', 'Indirect Expenses'],
]
const currentRows = [
  ['3100', 'Share Capital', 100000, 0, 0, 100000, false, false, 'Capital', 'Capital'],
  ['3200', 'Retained Earnings', 40000, 0, 0, 40000, false, false, 'Reserves & Surplus', 'Reserves & Surplus'],
  ['1500', 'Office Equipment', -80000, 0, 0, -80000, false, true, 'Fixed Assets', 'Fixed Assets'],
  ['1590', 'Accumulated Depreciation - Office Equipment', 15000, 0, 0, 15000, false, false, 'Fixed Assets', 'Fixed Assets'],
  ['1100', 'Main Bank Account', -60000, 27000, 0, -87000, false, true, 'Bank Accounts', 'Bank Accounts'],
  ['1200', 'Trade Receivables', -30000, 0, 0, -30000, false, true, 'Sundry Debtors', 'Current Assets'],
  ['2100', 'Trade Payables', 15000, 0, 0, 15000, false, false, 'Sundry Creditors', 'Current Liabilities'],
  ['4100', 'Product Revenue', 0, 0, 100000, 100000, true, false, 'Sales Accounts', 'Sales Accounts'],
  ['5100', 'Operating Expenses', 0, 65000, 0, -65000, false, true, 'Indirect Expenses', 'Indirect Expenses'],
  ['5200', 'Depreciation Expense', 0, 8000, 0, -8000, false, true, 'Indirect Expenses', 'Indirect Expenses'],
  ['5300', 'Current Tax Expense', 0, 6000, 0, -6000, false, true, 'Indirect Expenses', 'Indirect Expenses'],
  ['2200', 'Income Tax Payable', 0, 0, 6000, 6000, false, false, 'Duties & Taxes', 'Current Liabilities'],
]

function buildWorkbook(rows, period) {
  const sheetRows = [workbookHeaders, ...rows.map((row, index) => {
    const [code, name, opening, debit, credit, closing, revenue, deemedPositive, parent, groupParent] = row
    return [
      period, '', code, name, opening, debit, credit, closing,
      revenue, deemedPositive, closing, parent, groupParent,
    ]
  })]
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sheetRows), 'Trial Balance')
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
}

function sumClosing(rows) {
  return rows.reduce((total, row) => total + Number(row[5]), 0)
}
if (Math.abs(sumClosing(priorRows)) > 0.005 || Math.abs(sumClosing(currentRows)) > 0.005) {
  throw new Error(`Synthetic fixture does not balance: prior=${sumClosing(priorRows)}, current=${sumClosing(currentRows)}`)
}

const files = {
  current: path.join(home, 'FSG-Demo-Current-2025-26.xlsx'),
  prior: path.join(home, 'FSG-Demo-Prior-2024-25.xlsx'),
}
for (const filename of Object.values(files)) {
  if (fs.existsSync(filename)) throw new Error(`Refusing to overwrite an existing sample workbook: ${filename}`)
}
fs.writeFileSync(files.current, buildWorkbook(currentRows, currentPeriod), { flag: 'wx' })
fs.writeFileSync(files.prior, buildWorkbook(priorRows, priorPeriod), { flag: 'wx' })
console.info(JSON.stringify({
  current: files.current,
  prior: files.prior,
  currentBalance: sumClosing(currentRows),
  priorBalance: sumClosing(priorRows),
  rows: { current: currentRows.length, prior: priorRows.length },
  target: `${target.host}:${target.port}/${target.database}`,
}, null, 2))
