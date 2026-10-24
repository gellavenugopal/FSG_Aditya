// Parser for a Zoho Books "Trial Balance" Excel export (single file — Zoho has
// no separate chart-of-accounts export the way Tally / Real Books do).
//
// What the export looks like (verified against a real Zoho Books file):
//   row 1   "<Entity>\n Trial Balance\n Basis: Accrual\n From dd/mm/yyyy To dd/mm/yyyy"
//   row 2   Account | Account Code | Opening Balance | Net Debit | Net Credit | Closing Balance
//   then five section headings (merged across the number columns, no figures):
//           Assets · Liabilities · Equities · Income · Expense
//   under each heading the accounts are listed alphabetically. An account that
//   has sub-accounts is followed by its children (indented one level deeper) and
//   then a "Total for <account>" row that repeats parent + children.
//   last    "Total for Trial Balance" (Net Debit / Net Credit control totals)
//
// SIGN CONVENTION — Zoho is Debit = POSITIVE, Credit = NEGATIVE, in every
// section and every column of balance (closing = opening + net debit - net
// credit; Assets/Expense normally +, Liabilities/Equities/Income normally -).
// FSG Bharat stores the opposite: Dr NEGATIVE / Cr POSITIVE (tb_rows.closing_
// balance), with is_deemed_positive = true for Dr-natured ledgers (Assets,
// Expenses). buildTBRowsFromZoho() therefore flips opening/closing, exactly as
// buildTBRowsFromRealBooks() does for Real Books (also Dr-positive). Nature is a
// property of the Zoho SECTION the account sits in, never of the sign of today's
// balance, so a creditor showing a debit balance stays a (Cr-natured) liability.
//
// Zoho has no Tally-style group tree, so buildTBRowsFromZoho() synthesises one
// from what the file does carry — the section, the parent account, and the
// account name — using the same group names Map1 already knows ('Current
// Assets', 'Indirect Expenses', 'Sales Accounts', ...). That lets the ordinary
// 3-stage mapping engine run unchanged.

import * as XLSX from 'xlsx'

const SECTION_DEFS = [
  { rx: /^assets?$/i,                                   key: 'Assets',      type: 'Assets',      drNatured: true  },
  { rx: /^liabilit(y|ies)$/i,                           key: 'Liabilities', type: 'Liabilities', drNatured: false },
  { rx: /^(equit(y|ies)|owners?'?s? equity|capital)$/i, key: 'Equities',    type: 'Liabilities', drNatured: false },
  { rx: /^(other\s+)?income$|^revenue$/i,               key: 'Income',      type: 'Income',      drNatured: false },
  { rx: /^(other\s+)?expenses?$|^cost of goods sold$/i, key: 'Expense',     type: 'Expenses',    drNatured: true  },
]
const sectionOf = (name) => SECTION_DEFS.find(s => s.rx.test(name)) || null

const isBlank = (v) => v === null || v === undefined || String(v).trim() === ''

// Tolerant number reader: real numbers, "1,23,456.78", "(1,000)", "500 Cr", "500 Dr".
function num(v) {
  if (isBlank(v)) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  let s = String(v).trim()
  let neg = false
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1) }
  const cr = /\bcr\.?$/i.test(s)
  const dr = /\bdr\.?$/i.test(s)
  s = s.replace(/\b(dr|cr)\.?$/i, '').replace(/[₹,\s]/g, '')
  let n = parseFloat(s)
  if (!Number.isFinite(n)) return 0
  if (neg) n = -n
  if (cr) n = -Math.abs(n)
  if (dr) n = Math.abs(n)
  return n
}
const r2 = (n) => Math.round(n * 100) / 100

const cleanName = (s) => String(s).replace(/[\s\u00a0]+/g, ' ').trim()
const leadingSpaces = (s) => (String(s).match(/^[\s\u00a0]*/) || [''])[0].length

function ddmmyyyyToIso(s) {
  const m = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(s || '')
  if (!m) return null
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
}

/**
 * Parses a Zoho Books Trial Balance workbook.
 * @param {ArrayBuffer|Buffer} buffer
 * @returns {{
 *   format: 'zoho', entityName: string, from: string|null, to: string|null, periodLabel: string,
 *   rows: Array, stats: object, warnings: string[]
 * }}
 *   rows are in ZOHO's own signs (Dr +, Cr -): { name, code, section, sectionType, drNatured,
 *   parents:[root-first], depth, opening, debit, credit, closing }.
 */
export function parseZohoTB(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' })

  // The first sheet that carries Zoho's header row (some clients keep a "Raw" and
  // a "Worked" copy of the same report in one workbook — the first is used).
  let aoa = null, hdrIdx = -1, col = null
  for (const sn of wb.SheetNames) {
    const cand = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: null, raw: true })
    for (let i = 0; i < Math.min(cand.length, 30); i++) {
      const cells = (cand[i] || []).map(c => (c == null ? '' : String(c).trim().toLowerCase()))
      const iAcc = cells.findIndex(c => c === 'account' || c === 'account name')
      if (iAcc < 0) continue
      const pick = (...names) => cells.findIndex(c => names.includes(c))
      const c = {
        name: iAcc,
        code: pick('account code', 'code'),
        opening: pick('opening balance', 'opening'),
        debit: pick('net debit', 'debit'),
        credit: pick('net credit', 'credit'),
        closing: pick('closing balance', 'closing'),
      }
      if (c.debit >= 0 && c.credit >= 0) { aoa = cand; hdrIdx = i; col = c; break }
    }
    if (aoa) break
  }
  if (!aoa) {
    throw new Error('This does not look like a Zoho Books Trial Balance. Expected a header row with Account, Opening Balance, Net Debit, Net Credit and Closing Balance.')
  }

  // Title block (row above the header) → entity, period.
  let entityName = '', from = null, to = null, periodLabel = ''
  const title = String((aoa[0] && aoa[0][0]) || (aoa[hdrIdx - 1] && aoa[hdrIdx - 1][0]) || '')
  if (title) {
    const lines = title.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    entityName = lines[0] || ''
    const m = /from\s+(\d{1,2}[/.-]\d{1,2}[/.-]\d{4})\s+to\s+(\d{1,2}[/.-]\d{1,2}[/.-]\d{4})/i.exec(title)
    if (m) { from = ddmmyyyyToIso(m[1]); to = ddmmyyyyToIso(m[2]); periodLabel = `${m[1]} To ${m[2]}` }
  }

  const warnings = []
  const rows = []
  const totalRows = []          // "Total for X" rows, for the cross-check below
  let grand = null              // "Total for Trial Balance"
  let section = null
  let stack = []                // [{ indent, name }] — the open parent accounts
  let zeroSkipped = 0

  for (let i = hdrIdx + 1; i < aoa.length; i++) {
    const row = aoa[i] || []
    const rawName = row[col.name]
    if (isBlank(rawName)) continue
    const indent = leadingSpaces(rawName)
    const name = cleanName(rawName)
    const hasFigures = [col.opening, col.debit, col.credit, col.closing].some(c => c >= 0 && !isBlank(row[c]))

    // Section heading: no figures at all (Zoho merges the number cells).
    if (!hasFigures) {
      const sec = sectionOf(name)
      if (!sec) {
        throw new Error(`Row ${i + 1}: unrecognised section heading "${name}". Expected Assets, Liabilities, Equities, Income or Expense.`)
      }
      section = sec; stack = []
      continue
    }

    if (/^total\s+for\s+trial\s+balance$/i.test(name) || /^(grand\s+)?total$/i.test(name)) {
      grand = { debit: num(row[col.debit]), credit: num(row[col.credit]) }
      continue
    }
    if (/^total\s+for\s+/i.test(name)) {
      totalRows.push({ label: cleanName(name.replace(/^total\s+for\s+/i, '')), closing: num(row[col.closing]), section, atIndex: rows.length, r: i + 1 })
      continue
    }
    if (!section) {
      throw new Error(`Row ${i + 1}: account "${name}" appears before any section heading (Assets / Liabilities / Equities / Income / Expense).`)
    }

    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()
    const parents = stack.map(s => s.name)
    stack.push({ indent, name })

    const debit = num(row[col.debit]), credit = num(row[col.credit])
    const opening = col.opening >= 0 ? num(row[col.opening]) : 0
    // No Closing column (Zoho's plain period TB): closing is derived, and there is no opening.
    const closing = col.closing >= 0 ? num(row[col.closing]) : opening + debit - credit

    rows.push({
      name, code: col.code >= 0 && !isBlank(row[col.code]) ? String(row[col.code]).trim() : '',
      section: section.key, sectionType: section.type, drNatured: section.drNatured,
      parents, depth: parents.length, opening, debit, credit, closing, _r: i + 1,
    })
  }

  if (!rows.length) throw new Error('No account rows were found under the Zoho section headings.')
  if (col.closing < 0) warnings.push('The file has no "Closing Balance" column — closing was computed as Net Debit − Net Credit and opening taken as 0.')

  // ── Integrity checks — a mis-read must never slip through silently ─────────
  const badIdentity = rows.filter(r => Math.abs(r.opening + r.debit - r.credit - r.closing) > 0.01)
  if (badIdentity.length) {
    warnings.push(`${badIdentity.length} account(s) do not satisfy Closing = Opening + Net Debit − Net Credit (e.g. "${badIdentity[0].name}", row ${badIdentity[0]._r}) — check the sign convention of the file.`)
  }
  for (const t of totalRows) {
    // parent = the last row in this section with the same label, then everything after it
    let p = -1
    for (let k = t.atIndex - 1; k >= 0; k--) { if (rows[k].section === t.section.key && rows[k].name.toLowerCase() === t.label.toLowerCase()) { p = k; break } }
    if (p < 0) continue
    const sum = rows.slice(p, t.atIndex).reduce((s, r) => s + r.closing, 0)
    if (Math.abs(sum - t.closing) > 0.01) {
      warnings.push(`"Total for ${t.label}" (row ${t.r}) is ${t.closing.toFixed(2)} but the account and its sub-accounts add up to ${sum.toFixed(2)}.`)
    }
  }

  const sum = (k) => r2(rows.reduce((s, r) => s + r[k], 0))
  const stats = {
    ledgerRows: rows.length,
    sumOpening: sum('opening'), sumDebit: sum('debit'), sumCredit: sum('credit'), sumClosing: sum('closing'),
    grandDebit: grand ? r2(grand.debit) : null, grandCredit: grand ? r2(grand.credit) : null,
    sections: {},
  }
  for (const s of SECTION_DEFS) {
    const inS = rows.filter(r => r.section === s.key)
    stats.sections[s.key] = { count: inS.length, closing: r2(inS.reduce((a, r) => a + r.closing, 0)), drNatured: s.drNatured }
  }
  if (Math.abs(stats.sumClosing) > 0.01) warnings.push(`The Trial Balance does not balance: closing balances add up to ${stats.sumClosing.toFixed(2)} (Dr + / Cr −), expected 0.`)
  if (col.opening >= 0 && Math.abs(stats.sumOpening) > 0.01) warnings.push(`Opening balances add up to ${stats.sumOpening.toFixed(2)}, expected 0.`)
  if (grand) {
    if (Math.abs(stats.sumDebit - grand.debit) > 0.01) warnings.push(`Net Debit of the accounts read (${stats.sumDebit.toFixed(2)}) differs from the file's "Total for Trial Balance" (${r2(grand.debit).toFixed(2)}).`)
    if (Math.abs(stats.sumCredit - grand.credit) > 0.01) warnings.push(`Net Credit of the accounts read (${stats.sumCredit.toFixed(2)}) differs from the file's "Total for Trial Balance" (${r2(grand.credit).toFixed(2)}).`)
  }

  // Accounts with no opening, no movement and no closing carry nothing into the
  // financials; they are kept out of the upload (the parents' NAMES still feed the
  // hierarchy of their children, which is computed above from every row).
  const kept = rows.filter(r => {
    const any = [r.opening, r.debit, r.credit, r.closing].some(v => Math.abs(v) > 0.004)
    if (!any) zeroSkipped++
    return any
  })
  stats.zeroSkipped = zeroSkipped
  stats.imported = kept.length

  return { format: 'zoho', entityName, from, to, periodLabel, rows: kept, allRowCount: rows.length, stats, warnings }
}

// ── Synthetic Tally-style group for a Zoho account ───────────────────────────
// Only ever a FIRST GUESS for Stage 1 of the mapping engine — anything wrong is
// corrected the usual way (Mapped TB grid / learned ledger rules). Group names
// are the ones Map1 keys on. Fixed-word matches use the name with separators
// ('_', '-', ':', '/') turned into spaces so "Pramod Pachisia_Loan" reads as words.
const words = (name) => name.replace(/[_\-/:]+/g, ' ')
const FIXED_ASSET_RX = /\b(computers?|laptops?|furniture|fixtures?|office equipment|equipments?|plant|machinery|vehicles?|building|land|intangible|software|goodwill|patents?|trademarks?|copyrights?|leasehold)\b/i
const NOT_FIXED_ASSET_RX = /\b(prepaid|advance|deposit|receivable|subscription|accrued|loan)\b/i
const LOAN_RX = /\b(loans?|mortgages?|debentures?|borrowings?)\b/i
const NOT_LOAN_RX = /\b(interest|payable|reimbursement|repayment|emi)\b/i
const RESERVE_RX = /\b(retained|earnings?|surplus|reserves?|profit|loss)\b/i

export function zohoGroupFor(section, name, constitution) {
  const n = words(name)
  switch (section) {
    case 'Assets':
      if (/^accounts?\s+receivable$/i.test(n.trim()) || /^(sundry\s+)?debtors?$/i.test(n.trim())) return 'Sundry Debtors'
      if (FIXED_ASSET_RX.test(n) && !NOT_FIXED_ASSET_RX.test(n)) return 'Fixed Assets'
      if (/\bbank\b/i.test(n) && !/\b(fees?|charges?|deposit|loan|interest)\b/i.test(n)) return 'Bank Accounts'
      if (/\bpetty cash\b|^cash( in hand)?$/i.test(n.trim())) return 'Cash-in-Hand'
      return 'Current Assets'
    case 'Liabilities':
      if (/^accounts?\s+payable$/i.test(n.trim()) || /^(sundry\s+)?creditors?$/i.test(n.trim())) return 'Sundry Creditors'
      if (LOAN_RX.test(n) && !NOT_LOAN_RX.test(n)) return 'Loans (Liability)'
      return 'Current Liabilities'
    case 'Equities':
      // Reserve-type accounts must NOT sit under the plain capital group: the engine
      // matches group words before ledger names, so "Retained Earnings" under
      // 'Capital' came out as Share capital.
      if (RESERVE_RX.test(n)) return 'Reserves & Surplus'
      return Number(constitution) === 3 ? 'Capital' : 'Capital Account'
    case 'Income':
      if (/^(sales?|revenue|turnover|services?|professional\s+(fees?|income|charges)|consult\w*)\b/i.test(n.trim())) return 'Sales Accounts'
      return 'Indirect Incomes'
    case 'Expense':
      if (/^(purchases?|cost of goods sold|raw materials?)\b/i.test(n.trim())) return 'Purchase Accounts'
      return 'Indirect Expenses'
    default:
      return ''
  }
}

/**
 * Turns parsed Zoho rows into rows for the standard `tb_rows` table.
 * opts.constitution — Auditee's constitution code (1 / 2 / 3); selects 'Capital' vs 'Capital Account'.
 *
 * Hierarchy stored deepest-first (parent → group_parent → …), ending in 'Primary',
 * the same shape buildTBRowsFromTally()/buildTBRowsFromRealBooks() produce:
 *   top-level account  → [ <synthetic group>, 'Primary' ]
 *   sub-account        → [ <parent account>, <synthetic group>, 'Primary' ]
 */
export function buildTBRowsFromZoho(parsed, opts = {}) {
  return (parsed.rows || []).map(r => {
    const group = zohoGroupFor(r.section, r.name, opts.constitution)
    // Zoho lists parents root-first; the engine wants deepest-first, with the group after them.
    const chain = [...[...r.parents].reverse(), group, 'Primary'].filter(Boolean)
    return {
      period:             '',
      branch:             '',
      ledger_code:        r.code || '',
      name:               r.name,
      // Zoho Dr+/Cr−  →  FSG Dr−/Cr+ : every balance flips; movements are unsigned and unchanged.
      opening_balance:    r.opening === 0 ? 0 : -r.opening,
      debit:              r.debit,
      credit:             r.credit,
      closing_balance:    r.closing === 0 ? 0 : -r.closing,
      is_revenue:         null,
      is_deemed_positive: r.drNatured,
      trail_balance:      0,
      trial_balance_type: r.sectionType,
      parent:             chain[0] || '',
      group_parent:       chain[1] || '',
      group_parent_1:     chain[2] || '',
      group_parent_2:     chain[3] || '',
      group_parent_3:     chain[4] || '',
      group_parent_4:     chain[5] || '',
      group_parent_5:     chain[6] || '',
      group_parent_6:     '',
      group_parent_7:     chain[chain.length - 1] || '',
    }
  })
}
