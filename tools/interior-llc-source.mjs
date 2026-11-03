import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

export const INTERIOR_SOURCE_FILE = 'D:\\Programs\\FinancialStatements\\AdityaTool\\client-uat\\TB 2024.xlsx'

const norm = value => String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
const num = value => (typeof value === 'number' ? value : 0)

// Journal-sheet spellings that differ from the Trial Balance ledger names (confirmed by the workbook's own JV column).
export const JOURNAL_NAME_ALIASES = new Map([
  ['shareholders current account', 'SHARE HOLDERS DIVIDENDS'],
  ['retained earnings', 'Retained Earnings B/Fwd'],
  ['retained earning', 'Retained Earnings B/Fwd'],
  ['round off', 'TB round off'],
  ['lease liability', 'Lease Liabilities'],
  ['lease liabitity', 'Lease Liabilities'],
  ['rent', 'Rent & Rates - Dubai'],
  ['accumulated depreciation rou', 'Right of Use Asset Lease Hold - Accured Depreciation'],
  ['accumualated depreciation rou', 'Right of Use Asset Lease Hold - Accured Depreciation'],
  ['right of use asset', 'Right of Use Asset Lease Hold'],
  ['interest', 'Interest on lease liability'],
  ['interest on loan from rp', 'Interest on SH loan'],
  ['interest on loan from tp', 'Interest on third party'],
  ['interest on vehicle loan', 'Interest Expenses -Dubai'],
  ['other income', 'Other Income'],
  ['corporate tax expnse', 'Corporation Tax - Dubai'],
  ['smart option', 'Smart Option - SC'],
  ['andrew', 'Andrew - SC'],
  ['due from contract customers', 'Billing Clearing Account'],
  ['due to contract customers', 'Due to customers on contracts'],
  ['accrued exp others', 'ACCRUED EXP OTHERS'],
  ['project expense', 'Project Expense - COS - Dubai'],
  ['refundable deposits', 'Deposits-Security Deposit'],
  ['project consultant fees', 'Consultancy fees'],
  ['professional fees', 'Professional Fees - Dubai'],
  ['intercompany inc ksa', 'Intercompany INC KSA'],
  ['unbilled revenue', 'Unbilled Revenue'],
])

// The workbook's own JV column and Final column exclude these two journals; both are labelled as 2023 reclassifications.
export const isPriorYearJournal = journal => /for (?:the year )?2023/i.test(journal.narration)

export function readInteriorWorkbook(filePath = INTERIOR_SOURCE_FILE) {
  const workbook = XLSX.readFile(filePath)
  const tbRows = XLSX.utils.sheet_to_json(workbook.Sheets['TB 24'], { header: 1, defval: '' }).slice(9)
  const accounts = []
  for (const row of tbRows) {
    const name = String(row[1] ?? '').trim()
    if (!name || name === 'TOTAL' || name === 'NET PROFIT') continue
    accounts.push({
      code: String(row[0] ?? '').trim(),
      name,
      clientCategory: String(row[2] ?? '').trim(),
      openingDebit: num(row[3]),
      openingCredit: num(row[4]),
      netChange: num(row[5]),
      original: num(row[8]),
      journalColumn: num(row[9]),
      final: num(row[10]),
      originalIsBlank: row[8] === '',
    })
  }
  const journalRows = XLSX.utils.sheet_to_json(workbook.Sheets['JV 24'], { header: 1, defval: '' })
  const journals = []
  let current = { lines: [], narration: '' }
  const flush = () => {
    if (current.lines.length) journals.push(current)
    current = { lines: [], narration: '' }
  }
  journalRows.forEach((row, index) => {
    const name = String(row[0] ?? '').trim()
    const amountCell = row.slice(1, 9).find(value => typeof value === 'number')
    if (!name) { flush(); return }
    if (amountCell === undefined && /^\(.*\)$/.test(name)) { current.narration = name.replace(/^\(|\)$/g, '').trim(); return }
    if (amountCell === undefined) throw new Error(`JV 24 row ${index + 2} has no amount.`)
    current.lines.push({ sourceName: name, amount: amountCell, sheetRow: index + 2 })
  })
  flush()
  return { accounts, journals }
}

export function resolveJournalAccount(sourceName, accountsByName) {
  const key = norm(sourceName)
  const direct = accountsByName.get(key)
  if (direct) return direct
  const alias = JOURNAL_NAME_ALIASES.get(key)
  if (alias) return accountsByName.get(norm(alias)) || null
  return null
}

export function indexAccounts(accounts) {
  return new Map(accounts.map(account => [norm(account.name), account]))
}
