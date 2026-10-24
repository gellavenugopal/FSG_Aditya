// ── Fill Details Excel registry ─────────────────────────────────────────────
// Single source of truth mapping a note title to how its Fill Details data
// round-trips through one sheet of the consolidated Fill Details workbook
// (see components/GenerateFinancials/fillDetailsWorkbook.js).
//
// To add Excel support for another Fill Details form later: add one entry
// here with { match, sheetName, toRows, fromRows } — the workbook builder and
// importer both iterate this registry, so nothing else needs to change.
// This is the "dynamically change the template as Fill Details forms are
// added" mechanism.

import { TP_AGEING_ROWS, TP_AGEING_BUCKETS } from '../components/Notes/TradePayablesDisclosureForm'
import { TR_AGEING_ROWS, TR_AGEING_BUCKETS } from '../components/Notes/TradeReceivablesAgingForm'
import { NC_AGEING_TITLE, NC_AGEING_BLOCKS, NC_AGEING_CATEGORIES, ncAgeingResolve } from './tradeReceivablesNonCorp'

const num = (v) => parseFloat(v) || 0
// An entry's match(title, constitution) may also depend on the Auditee's constitution
// (1 Proprietorship/Partnership, 2 LLP, 3 Company); entries that don't care ignore it.
const isNonCorp = (c) => [1, 2].includes(parseInt(c))
const yn = (v) => v ? 'Yes' : 'No'
const isYes = (v) => /^y/i.test((v || '').toString().trim())

// A "date" cell in the Fill Details Excel template (e.g. Final Maturity
// Date) comes back from the xlsx parser as a raw Excel serial number, not a
// formatted date — left as-is it round-trips as a plain number (e.g.
// "47573") into the PDF/Excel exports instead of an actual date. Converts to
// ISO YYYY-MM-DD (what the in-app <input type="date"> also expects), so it
// both displays correctly and re-populates the form correctly on reload.
// Non-numeric values (already a date string, or blank) pass through unchanged.
function excelSerialToISODate(v) {
  const raw = (v ?? '').toString().trim()
  if (!raw || !/^\d+(\.\d+)?$/.test(raw)) return raw
  const serial = parseFloat(raw)
  if (serial < 1) return raw
  // Excel's day-0 is 1899-12-30 (accounting for its spurious 1900 leap day)
  const ms = Math.round((serial - 25569) * 86400000)
  const d = new Date(ms)
  if (isNaN(d.getTime())) return raw
  const yyyy = d.getUTCFullYear(), mm = String(d.getUTCMonth() + 1).padStart(2, '0'), dd = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export const FILL_DETAILS_REGISTRY = [
  // "Cost of Materials Consumed" and "Changes in Inventories" are
  // deliberately NOT here — they're auto-computed from the Stock tab's
  // category entries (see utils/inventorySplit.js), not independently
  // Fill-Details-editable, so a separate Excel round-trip for them here
  // would let a re-upload silently diverge from the Stock tab's own numbers.
  // Edit stock categories in the Stock tab — its own Excel round-trip is a
  // separate concern from this workbook.

  // ── Share Capital — Share Classes ───────────────────────────────────────
  // Column design (per explicit user spec): "Issued" is split into two
  // UNAMBIGUOUS columns — the cumulative/closing total ("Including...
  // Issued") and just this year's movement ("Only issued during the
  // year") — instead of asking for a separately-typed Opening Balance that
  // has to reconcile with it by hand. Opening Balance is therefore DERIVED
  // (Closing − This Year's Issued + This Year's Bought Back) in fromRows()
  // below, never typed here, which removes the exact double-entry mistake
  // that used to double the Classes total (Opening + Issued Including...
  // Issued both holding the full share count) and silently halve every
  // Shareholders-tab % holding computed from it.
  {
    key: 'share-capital',
    match: (t) => t.includes('share capital'),
    sheetName: 'Share Capital',
    headerRow: [
      'Class', 'Type', 'Face Value',
      'CY Authorised', 'CY Issued (Including Current Year Issued)', 'CY Subscribed', 'CY Issued (Only issued during the year)', 'CY Bought Back During the Year',
      'PY Authorised', 'PY Issued (Including Previous Year Issued)', 'PY Subscribed', 'PY Issued (Only issued during the year)', 'PY Bought Back During the Year',
    ],
    toRows(details) {
      const classes = details?.classes?.length ? details.classes : [{ name: 'Equity Shares', type: 'Equity', faceValue: 10, cy: {}, py: {} }]
      // Same "best available total" fallback used everywhere else this is
      // computed (ShareCapitalForm.jsx's cyClosed/pyClosed) — shown as the
      // cumulative "Including..." figure so the downloaded template starts
      // from whatever the app already treats as the authoritative total.
      const closingOf = (c, period) => {
        const p = c[period] || {}
        return num(p.openingShares) + num(p.issuedDuringYear) - num(p.deletedDuringYear) || num(p.paidUp) || num(p.issued)
      }
      return classes.map(c => [
        c.name || '', c.type || 'Equity', num(c.faceValue) || 10,
        num(c.cy?.authorised) || '', closingOf(c, 'cy') || '', num(c.cy?.subscribed) || '', num(c.cy?.issuedDuringYear) || '', num(c.cy?.deletedDuringYear) || '',
        num(c.py?.authorised) || '', closingOf(c, 'py') || '', num(c.py?.subscribed) || '', num(c.py?.issuedDuringYear) || '', num(c.py?.deletedDuringYear) || '',
      ])
    },
    fromRows(rows) {
      const classes = rows.filter(r => (r[0] || '').toString().trim()).map(r => {
        const cyIssuedTotal = num(r[4]), cyIssuedYear = num(r[6]), cyBoughtBack = num(r[7])
        const pyIssuedTotal = num(r[9]), pyIssuedYear = num(r[11]), pyBoughtBack = num(r[12])
        const cySubscribed = num(r[5]), pySubscribed = num(r[10])
        return {
          name: (r[0] || '').toString().trim(), type: (r[1] || '').toString().trim() || 'Equity', faceValue: num(r[2]) || 10,
          cy: {
            authorised: num(r[3]), issued: cyIssuedTotal, subscribed: cySubscribed, paidUp: cySubscribed,
            openingShares: cyIssuedTotal - cyIssuedYear + cyBoughtBack,
            issuedDuringYear: cyIssuedYear, deletedDuringYear: cyBoughtBack,
          },
          py: {
            authorised: num(r[8]), issued: pyIssuedTotal, subscribed: pySubscribed, paidUp: pySubscribed,
            openingShares: pyIssuedTotal - pyIssuedYear + pyBoughtBack,
            issuedDuringYear: pyIssuedYear, deletedDuringYear: pyBoughtBack,
          },
        }
      })
      return { classes }
    },
  },

  // ── Owners'/Partners' Capital Account (single-owner variant only — the
  // LLP dual-table variant is more structurally complex and not yet
  // supported by this workbook; use the in-app form for LLP entities) ──────
  {
    key: 'owners-capital-account',
    match: (t) => t.includes("owners' capital") || t.includes('owners capital') || t.includes("partners' capital") || t.includes('partners capital'),
    sheetName: "Owners-Partners Capital Account",
    headerRow: ['Name', 'Share %', 'Opening', 'Introduced', 'Remuneration', 'Interest', 'Withdrawals', 'Share of Profit'],
    toRows(details) {
      if (details?.variant === 'llp') return []  // LLP: use the in-app form, not this sheet
      const rows = details?.rows?.length ? details.rows : [{ name: '' }]
      const out = rows.map(r => [r.name || '', r.sharePct ?? '', num(r.opening) || '', num(r.introduced) || '', num(r.remuneration) || '', num(r.interest) || '', num(r.withdrawals) || '', num(r.shareOfProfit) || ''])
      const py = details?.py || {}
      out.push(['Previous Year (PY)', py.sharePct ?? '', num(py.opening) || '', num(py.introduced) || '', num(py.remuneration) || '', num(py.interest) || '', num(py.withdrawals) || '', num(py.shareOfProfit) || ''])
      return out
    },
    fromRows(rows) {
      const pyRow = rows.find(r => (r[0] || '').toString().trim().toLowerCase().startsWith('previous year'))
      const cyRows = rows.filter(r => r !== pyRow && (r[0] || '').toString().trim())
      const toFields = (r) => ({ name: (r[0] || '').toString(), sharePct: r[1] ?? '', opening: num(r[2]), introduced: num(r[3]), remuneration: num(r[4]), interest: num(r[5]), withdrawals: num(r[6]), shareOfProfit: num(r[7]) })
      return {
        variant: 'single',
        rows: cyRows.map(toFields),
        py: pyRow ? toFields(pyRow) : { sharePct: '', opening: '', introduced: '', remuneration: '', interest: '', withdrawals: '', shareOfProfit: '' },
      }
    },
  },

  // ── Long-Term Borrowings ─────────────────────────────────────────────────
  // Loans are auto-listed per ledger (tbLedger) — matched back by that same
  // ledger name on import, so this round-trips correctly even after a fresh
  // TB re-upload as long as ledger names stay the same in Tally.
  {
    key: 'long-term-borrowings',
    match: (t) => t.includes('long-term borrow') || t.includes('long term borrow'),
    sheetName: 'Long-Term Borrowings',
    headerRow: ['TB Ledger', 'Lender Name', 'Nature', 'Secured/Unsecured', 'Gross CY', 'Gross PY',
      'Current Maturity CY', 'Current Maturity PY', 'ROI %', 'EMI', 'Frequency', 'Remaining Instalments',
      'Final Maturity Date', 'Repayment Remarks', 'Nature of Security', 'Guarantee', 'Charge Ranking', 'Security Paragraph'],
    toRows(details) {
      const loans = details?.loans?.length ? details.loans : [{}]
      return loans.map(l => [
        l.tbLedger || '', l.lenderPrintName || '', l.nature || '', l.securedUnsecured || 'Secured',
        num(l.grossCY) || '', num(l.grossPY) || '', num(l.currentMaturityCY) || '', num(l.currentMaturityPY) || '',
        l.roi || '', l.emi || '', l.frequency || '', l.remainingInstalments || '', l.finalMaturityDate || '',
        l.repaymentRemarks || '', l.natureOfSecurity || '', l.guarantee || '', l.chargeRanking || '', l.securityParagraph || '',
      ])
    },
    fromRows(rows) {
      const loans = rows.filter(r => (r[0] || r[1] || '').toString().trim()).map(r => ({
        id: Math.random().toString(36).slice(2),
        tbLedger: (r[0] || '').toString(), lenderPrintName: (r[1] || '').toString(),
        nature: (r[2] || '').toString() || 'Term Loans from Banks',
        securedUnsecured: (r[3] || '').toString() || 'Secured',
        grossCY: num(r[4]), grossPY: num(r[5]), currentMaturityCY: num(r[6]), currentMaturityPY: num(r[7]),
        roi: (r[8] ?? '').toString(), emi: (r[9] ?? '').toString(), frequency: (r[10] || 'Monthly').toString(),
        remainingInstalments: (r[11] ?? '').toString(), finalMaturityDate: excelSerialToISODate(r[12]),
        repaymentRemarks: (r[13] || '').toString(), repaymentFormat: 'tabular',
        natureOfSecurity: (r[14] || '').toString(), guarantee: (r[15] || '').toString(),
        chargeRanking: (r[16] || '').toString(), securityFormat: 'tabular', securityParagraph: (r[17] || '').toString(),
      }))
      return { loans, printRepayment: true, printSecurity: true, printReconciliation: true }
    },
  },

  // ── Short-Term Borrowings ────────────────────────────────────────────────
  {
    key: 'short-term-borrowings',
    match: (t) => t.includes('short-term borrow') || t.includes('short term borrow'),
    sheetName: 'Short-Term Borrowings',
    headerRow: ['TB Ledger', 'Lender Name', 'Nature', 'Secured/Unsecured', 'Gross CY', 'Gross PY',
      'ROI %', 'Repayment Remarks', 'Nature of Security', 'Guarantee', 'Charge Ranking', 'Security Paragraph'],
    toRows(details) {
      const loans = details?.loans?.length ? details.loans : [{}]
      return loans.map(l => [
        l.tbLedger || '', l.lenderPrintName || '', l.nature || '', l.securedUnsecured || 'Secured',
        num(l.grossCY) || '', num(l.grossPY) || '', l.roi || '', l.repaymentRemarks || '',
        l.natureOfSecurity || '', l.guarantee || '', l.chargeRanking || '', l.securityParagraph || '',
      ])
    },
    fromRows(rows) {
      const loans = rows.filter(r => (r[0] || r[1] || '').toString().trim()).map(r => ({
        id: Math.random().toString(36).slice(2),
        tbLedger: (r[0] || '').toString(), lenderPrintName: (r[1] || '').toString(),
        nature: (r[2] || '').toString() || 'Cash Credit / Overdraft from Banks',
        securedUnsecured: (r[3] || '').toString() || 'Secured',
        grossCY: num(r[4]), grossPY: num(r[5]), roi: (r[6] ?? '').toString(),
        repaymentRemarks: (r[7] || '').toString(), repaymentFormat: 'tabular',
        natureOfSecurity: (r[8] || '').toString(), guarantee: (r[9] || '').toString(),
        chargeRanking: (r[10] || '').toString(), securityFormat: 'tabular', securityParagraph: (r[11] || '').toString(),
      }))
      return { loans, printRepayment: true, printSecurity: true }
    },
  },

  // ── Cash & Bank Balances — "Other Details" disclosure (fixed 3 items) ─────
  {
    key: 'cash-bank-details',
    match: (t) => t.includes('cash') && t.includes('bank'),
    sheetName: 'Cash & Bank Details',
    headerRow: ['Item', 'Amount', 'Remarks'],
    toRows(details) {
      const items = details?.items || {}
      const CASH_BANK_ITEMS = [
        { key: 'a', label: 'Earmarked balances with banks' },
        { key: 'b', label: 'Balances with banks to the extent held as margin money or security against the borrowings, guarantees, other commitments' },
        { key: 'c', label: 'Repatriation restrictions, if any, in respect of cash and bank balances' },
      ]
      return CASH_BANK_ITEMS.map(it => [it.label, num(items[it.key]?.amount) || '', items[it.key]?.remarks || ''])
    },
    fromRows(rows) {
      const keys = ['a', 'b', 'c']
      const items = {}
      rows.forEach((r, i) => {
        if (i >= keys.length) return
        items[keys[i]] = { amount: num(r[1]), remarks: (r[2] || '').toString() }
      })
      return { items, includeInOutput: true }
    },
  },

  // ── Trade Receivables Ageing Schedule (Company) ──────────────────────────
  // Only the editable input rows round-trip (TR_AGEING_ROWS' `computed:`
  // rows — Total Due / Total Trade Receivable — are derived, never stored).
  {
    key: 'trade-receivables-aging',
    match: (t, c) => t.includes('trade receivable') && !isNonCorp(c),
    sheetName: 'Trade Receivables Ageing',
    headerRow: ['Period', 'Particulars', ...TR_AGEING_BUCKETS.map(b => b.label)],
    toRows(details) {
      const inputRows = TR_AGEING_ROWS.filter(r => !r.computed)
      const rows = []
      for (const period of ['cy', 'py']) {
        for (const r of inputRows) {
          rows.push([period.toUpperCase(), r.label, ...TR_AGEING_BUCKETS.map(b => num(details?.[period]?.[r.key]?.[b.key]) || '')])
        }
      }
      rows.push(['', 'Include in Output (Yes/No)', yn(details?.includeInOutput), '', '', '', ''])
      return rows
    },
    fromRows(rows) {
      const inputRows = TR_AGEING_ROWS.filter(r => !r.computed)
      const labelToKey = new Map(inputRows.map(r => [r.label.trim().toLowerCase(), r.key]))
      const out = { cy: {}, py: {}, includeInOutput: false }
      for (const r of rows) {
        const period = (r[0] || '').toString().trim().toLowerCase()
        const label = (r[1] || '').toString().trim().toLowerCase()
        if (label === 'include in output (yes/no)') { out.includeInOutput = isYes(r[2]); continue }
        const key = labelToKey.get(label)
        if (!key || (period !== 'cy' && period !== 'py')) continue
        out[period][key] = Object.fromEntries(TR_AGEING_BUCKETS.map((b, i) => [b.key, num(r[2 + i])]))
      }
      return out
    },
  },

  // ── Trade Receivables ageing table (Proprietorship / Partnership / LLP) ──
  // The Notes screen's own table (utils/tradeReceivablesNonCorp.js): two ageing
  // blocks x Secured / Unsecured / Doubtful, one Amount column. Every row names
  // its block and category, so the sheet reads the same wherever it is sorted or
  // pasted. Downloaded WITH data it carries what the app shows: the saved
  // figures, or (nothing saved yet) the default — the whole Trade Receivables
  // figure in "less than 6 months / Unsecured, considered good" — plus the Trial
  // Balance figure as a reference row. The blank template carries no amounts.
  // Saved under note_details.ncAgeing, merged onto the note's other data.
  {
    key: 'trade-receivables-ageing-noncorp',
    match: (t, c) => t.includes('trade receivable') && isNonCorp(c),
    sheetName: 'Trade Receivables Ageing',
    headerRow: [NC_AGEING_TITLE, 'Category', 'Amount'],
    toRows(details, note) {
      const values = details?.ncAgeing ? ncAgeingResolve(details.ncAgeing, 0).values
        : note ? ncAgeingResolve(null, note.total).values
        : null
      const rows = []
      for (const b of NC_AGEING_BLOCKS) {
        for (const c of NC_AGEING_CATEGORIES) rows.push([b.label, c.label, values ? (values[b.key][c.key] || '') : ''])
      }
      rows.push(['', 'Trade Receivables as per Trial Balance (for reference - do not change)', note ? (num(note.total) || '') : ''])
      return rows
    },
    fromRows(rows) {
      const catKey = new Map(NC_AGEING_CATEGORIES.map(c => [c.label.trim().toLowerCase(), c.key]))
      const blockOf = (label) => /less\s+than\s+6/i.test(label) ? 'lt6' : /more\s+than\s+6/i.test(label) ? 'gt6' : null
      const ncAgeing = {}
      for (const b of NC_AGEING_BLOCKS) { ncAgeing[b.key] = {}; for (const c of NC_AGEING_CATEGORIES) ncAgeing[b.key][c.key] = 0 }
      let any = false
      for (const r of rows) {
        const block = blockOf((r[0] || '').toString())
        const cat = catKey.get((r[1] || '').toString().trim().toLowerCase())
        if (!block || !cat) continue
        ncAgeing[block][cat] = num((r[2] ?? '').toString().replace(/,/g, ''))
        any = true
      }
      // A sheet with none of the six lines (e.g. a Company-format sheet uploaded to a Partnership) changes nothing.
      return any ? { ncAgeing } : {}
    },
  },

  // ── Trade Payables — Ageing Schedule + MSME Disclosure combined ─────────
  // Mirrors the live form's combined { ageing, msme } shape (both saved via
  // dedicated IPC there, but both persist to the same note_details row, so
  // a single generic saveNoteDetails overwrite here is equivalent).
  {
    key: 'trade-payables-disclosure',
    match: (t) => t.includes('trade payable'),
    sheetName: 'Trade Payables',
    headerRow: ['Section', 'Period', 'Particulars', ...TP_AGEING_BUCKETS.map(b => b.label)],
    toRows(details) {
      const ag = details?.ageing || {}
      const msme = details?.msme || {}
      const rows = []
      for (const period of ['cy', 'py']) {
        for (const r of TP_AGEING_ROWS) {
          rows.push(['AGEING', period.toUpperCase(), r.label, ...TP_AGEING_BUCKETS.map(b => num(ag?.[period]?.[r.key]?.[b.key]) || '')])
        }
      }
      rows.push(['RECON', 'CY', 'MSME (as per TB)', num(ag?.tbCY?.msme) || ''])
      rows.push(['RECON', 'CY', 'Others (as per TB)', num(ag?.tbCY?.others) || ''])
      rows.push(['RECON', 'PY', 'MSME (as per TB)', num(ag?.tbPY?.msme) || ''])
      rows.push(['RECON', 'PY', 'Others (as per TB)', num(ag?.tbPY?.others) || ''])
      for (const period of ['cy', 'py']) {
        rows.push(['MSME', period.toUpperCase(), '(a) Principal', num(msme?.[period]?.a?.principal) || ''])
        rows.push(['MSME', period.toUpperCase(), '(a) Interest', num(msme?.[period]?.a?.interest) || ''])
        for (const k of ['b', 'c', 'd', 'e']) {
          rows.push(['MSME', period.toUpperCase(), `(${k})`, num(msme?.[period]?.[k]) || ''])
        }
      }
      rows.push(['FLAGS', '', 'Include Ageing in Output (Yes/No)', yn(ag?.includeInOutput)])
      rows.push(['FLAGS', '', 'Include MSME in Output (Yes/No)', yn(msme?.includeInOutput)])
      return rows
    },
    fromRows(rows) {
      const labelToKey = new Map(TP_AGEING_ROWS.map(r => [r.label.trim().toLowerCase(), r.key]))
      const ageing = { cy: {}, py: {}, tbCY: { msme: '', others: '' }, tbPY: { msme: '', others: '' }, includeInOutput: false }
      const msme = { cy: { a: { principal: '', interest: '' }, b: '', c: '', d: '', e: '' },
                     py: { a: { principal: '', interest: '' }, b: '', c: '', d: '', e: '' },
                     includeInOutput: false }
      for (const r of rows) {
        const section = (r[0] || '').toString().trim().toUpperCase()
        const period = (r[1] || '').toString().trim().toLowerCase()
        const label = (r[2] || '').toString().trim()
        const labelLower = label.toLowerCase()
        if (section === 'AGEING') {
          const key = labelToKey.get(labelLower)
          if (!key || (period !== 'cy' && period !== 'py')) continue
          ageing[period][key] = Object.fromEntries(TP_AGEING_BUCKETS.map((b, i) => [b.key, num(r[3 + i])]))
        } else if (section === 'RECON') {
          if (period !== 'cy' && period !== 'py') continue
          const target = period === 'cy' ? ageing.tbCY : ageing.tbPY
          if (labelLower.startsWith('msme')) target.msme = num(r[3])
          else if (labelLower.startsWith('others')) target.others = num(r[3])
        } else if (section === 'MSME') {
          if (period !== 'cy' && period !== 'py') continue
          const target = msme[period]
          if (labelLower === '(a) principal') target.a.principal = num(r[3])
          else if (labelLower === '(a) interest') target.a.interest = num(r[3])
          else if (/^\([b-e]\)$/.test(labelLower)) target[labelLower.replace(/[()]/g, '')] = num(r[3])
        } else if (section === 'FLAGS') {
          if (labelLower.startsWith('include ageing')) ageing.includeInOutput = isYes(r[3])
          else if (labelLower.startsWith('include msme')) msme.includeInOutput = isYes(r[3])
        }
      }
      return { ageing, msme }
    },
  },
]

export function findRegistryEntry(noteTitle, constitution = null) {
  const t = (noteTitle || '').toLowerCase()
  return FILL_DETAILS_REGISTRY.find(e => e.match(t, constitution)) || null
}
