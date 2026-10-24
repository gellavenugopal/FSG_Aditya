// Parser for a Busy Accounting Software "Trial Balance" Excel export (one file - Busy's TB already carries its own group tree,
// shown by indentation, so no separate chart-of-accounts file is needed).
//
// What the export looks like (verified against a real Busy file):
//   rows 1-3   entity name / address
//   row 4      "Trial Balance"          row 5   "From d-m-yyyy to d-m-yyyy"
//   row 6      Account/Group Name | Opening Bal. | Debit | Credit | Closing Bal.
//   then the primary groups at the left edge (Capital Account, Current Assets, Current Liabilities, Fixed Assets, Investments,
//   Loans (Liability), Pre-Operative Expenses, Profit & Loss, Revenue Accounts, Suspense Account), each followed by its
//   sub-groups and ledgers, indented with spaces.   last row   "Total".
//   Balances are TEXT with a Dr / Cr suffix ("11,78,455.43 Cr", blank = nil); Debit / Credit are plain numbers.
//
// INDENTATION (the trap): a primary group sits at 0; every sub-group is printed at the SAME indent (4) whatever its depth, and a
// ledger is printed at 4 + 2 x (depth of the group it sits in). So a row at the base indent is either a sub-group or a ledger of
// the primary group, and a sub-group of a sub-group looks like its parent. What tells them apart is the arithmetic: a group's
// Opening / Debit / Credit / Closing are the sums of what is listed under it. resolveGroup() finds, for each base-indent row,
// whether the rows after it add up to it (then it is a group, owning exactly those rows) or not (then it is a ledger).
//
// SIGN - Busy shows Dr / Cr. This parser returns Dr = POSITIVE, Cr = NEGATIVE (like parseZohoTB); buildTBRowsFromBusy() flips to
// FSG Bharat's Dr NEGATIVE / Cr POSITIVE. Nature (asset / liability / income / expense) is a property of the PRIMARY group.
//
// Busy's TB carries no closing stock - its Stock-in-hand shows the stock value as it stands in the books - so, as for every
// non-Tally format, Opening / Closing Stock are entered in the Stock menu.

import * as XLSX from 'xlsx'

const isBlank = (v) => v === null || v === undefined || String(v).trim() === ''

// "1,23,456.78 Dr" / "500 Cr" / plain numbers -> Dr positive, Cr negative
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
const cleanName = (s) => String(s).replace(/[\s ]+/g, ' ').trim()
const leadingSpaces = (s) => (String(s).match(/^[\s ]*/) || [''])[0].length
const TOL = 0.011

function ddmmyyyyToIso(s) {
  const m = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(s || '')
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null
}

// Busy primary groups -> section of the statements and nature
const PRIMARIES = [
  { rx: /^capital account$/i,            key: 'Equities',    type: 'Liabilities', drNatured: false, tally: 'Capital Account' },
  { rx: /^profit\s*&\s*loss$/i,          key: 'Equities',    type: 'Liabilities', drNatured: false, tally: 'Reserves & Surplus' },
  { rx: /^current assets$/i,             key: 'Assets',      type: 'Assets',      drNatured: true,  tally: 'Current Assets' },
  { rx: /^fixed assets$/i,               key: 'Assets',      type: 'Assets',      drNatured: true,  tally: 'Fixed Assets' },
  { rx: /^investments?$/i,               key: 'Assets',      type: 'Assets',      drNatured: true,  tally: 'Investments' },
  { rx: /^pre-?\s*operative expenses?$/i, key: 'Assets',     type: 'Assets',      drNatured: true,  tally: 'Misc. Expenses (ASSET)' },
  { rx: /^current liabilit(y|ies)$/i,    key: 'Liabilities', type: 'Liabilities', drNatured: false, tally: 'Current Liabilities' },
  { rx: /^loans?\s*\(liabilit(y|ies)\)$/i, key: 'Liabilities', type: 'Liabilities', drNatured: false, tally: 'Loans (Liability)' },
  { rx: /^suspense( account| a\/c)?$/i,  key: 'Assets',      type: 'Assets',      drNatured: true,  tally: 'Suspense A/c' },
  { rx: /^revenue accounts?$/i,          key: null,          type: null,          drNatured: null,  tally: null },
]
const primaryOf = (name) => PRIMARIES.find(p => p.rx.test(name)) || null

// Busy sub-groups that carry meaning (the others - the user's own groups - take the nature and group of what they sit in)
const SUBGROUPS = [
  { rx: /^bank accounts?$/i,                      tally: 'Bank Accounts' },
  { rx: /^bank o\/?d( account)?s?$/i,             tally: 'Bank OD A/c' },
  { rx: /^cash[- ]in[- ]hand$/i,                  tally: 'Cash-in-Hand' },
  { rx: /^stock[- ]in[- ]hand$/i,                 tally: 'Stock-in-Hand' },
  { rx: /^sundry debtors?$/i,                     tally: 'Sundry Debtors' },
  { rx: /^sundry creditors?$/i,                   tally: 'Sundry Creditors' },
  { rx: /^duties\s*&\s*taxes$/i,                  tally: 'Duties & Taxes' },
  { rx: /^provisions?(\/expenses payable)?$|^provisions?\s*\/\s*expenses payable$/i, tally: 'Provisions' },
  { rx: /^loans\s*&\s*advances\s*\(asset\)$/i,    tally: 'Loans & Advances (Asset)' },
  { rx: /^securities\s*&\s*deposits\s*\(asset\)$/i, tally: 'Deposits (Asset)' },
  { rx: /^secured loans?$/i,                      tally: 'Secured Loans' },
  { rx: /^unsecured loans?$/i,                    tally: 'Unsecured Loans' },
  { rx: /^reserves?\s*&\s*surplus$/i,             tally: 'Reserves & Surplus' },
  { rx: /^purchase(s| accounts?)?$/i,             tally: 'Purchase Accounts', section: 'Expense' },
  { rx: /^sales?( accounts?)?$/i,                 tally: 'Sales Accounts',   section: 'Income' },
  { rx: /^expenses?\s*\(direct\/mfg\.?\)$/i,      tally: 'Direct Expenses',  section: 'Expense' },
  { rx: /^expenses?\s*\(indirect\/admn\.?\)$/i,   tally: 'Indirect Expenses', section: 'Expense' },
  { rx: /^income\s*\(direct\/opr\.?\)$/i,         tally: 'Direct Incomes',   section: 'Income' },
  { rx: /^income\s*\(indirect\)$/i,               tally: 'Indirect Incomes', section: 'Income' },
]
const subgroupOf = (name) => SUBGROUPS.find(s => s.rx.test(name)) || null

export const BUSY_SECTION_ORDER = ['Assets', 'Liabilities', 'Equities', 'Income', 'Expense']
const SECTION_META = {
  Assets:      { type: 'Assets',      drNatured: true },
  Liabilities: { type: 'Liabilities', drNatured: false },
  Equities:    { type: 'Liabilities', drNatured: false },
  Income:      { type: 'Income',      drNatured: false },
  Expense:     { type: 'Expenses',    drNatured: true },
}

/**
 * Parses a Busy Trial Balance workbook.
 * @returns {{ format:'busy', entityName, from, to, periodLabel, rows, allRowCount, stats, warnings }}
 *   rows are in BUSY's signs (Dr +, Cr -): { name, section, sectionType, drNatured, parents:[outer-first, primary first],
 *   groupTally, primary, opening, debit, credit, closing }
 */
export function parseBusyTB(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' })
  let aoa = null, hdrIdx = -1, col = null
  for (const sn of wb.SheetNames) {
    const cand = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: null, raw: true })
    for (let i = 0; i < Math.min(cand.length, 30); i++) {
      const cells = (cand[i] || []).map(c => (c == null ? '' : String(c).trim().toLowerCase()))
      const iName = cells.findIndex(c => /^account\s*\/?\s*group(\s*name)?$/.test(c) || c === 'particulars' || c === 'account name')
      if (iName < 0) continue
      const pick = (rx) => cells.findIndex(c => rx.test(c))
      const c = { name: iName, opening: pick(/^opening/), debit: pick(/^debit/), credit: pick(/^credit/), closing: pick(/^closing/) }
      if (c.debit >= 0 && c.credit >= 0) { aoa = cand; hdrIdx = i; col = c; break }
    }
    if (aoa) break
  }
  if (!aoa) {
    throw new Error('This does not look like a Busy Trial Balance. Expected a header row with Account/Group Name, Opening Bal., Debit, Credit and Closing Bal.')
  }

  let entityName = '', from = null, to = null, periodLabel = ''
  for (let i = 0; i < hdrIdx; i++) {
    for (const cell of aoa[i] || []) {
      if (isBlank(cell)) continue
      const t = String(cell)
      const m = /from\s+(\d{1,2}[/.-]\d{1,2}[/.-]\d{4})\s+to\s+(\d{1,2}[/.-]\d{1,2}[/.-]\d{4})/i.exec(t)
      if (m) { from = ddmmyyyyToIso(m[1]); to = ddmmyyyyToIso(m[2]); periodLabel = `${m[1]} To ${m[2]}` }
      else if (!entityName && !/^trial balance$/i.test(t.trim())) entityName = cleanName(t)
    }
  }

  // ── flat rows ─────────────────────────────────────────────────────────────
  const warnings = []
  const flat = []
  let grand = null
  for (let i = hdrIdx + 1; i < aoa.length; i++) {
    const row = aoa[i] || []
    if (isBlank(row[col.name])) continue
    const raw = String(row[col.name])
    const name = cleanName(raw)
    const opening = col.opening >= 0 ? num(row[col.opening]) : 0
    const debit = col.debit >= 0 ? Math.abs(num(row[col.debit])) : 0
    const credit = col.credit >= 0 ? Math.abs(num(row[col.credit])) : 0
    const closing = col.closing >= 0 ? num(row[col.closing]) : 0
    if (/^(grand\s+)?total$/i.test(name)) { grand = { debit, credit }; continue }
    flat.push({ name, indent: leadingSpaces(raw), opening, debit, credit, closing, _r: i + 1 })
  }
  if (!flat.length) throw new Error('No account rows were found in the Busy Trial Balance.')
  const base = Math.min(...flat.filter(r => r.indent > 0).map(r => r.indent), 4)
  const figs = (r) => [r.opening, r.debit, r.credit, r.closing]
  const nil = (r) => figs(r).every(v => Math.abs(v) < 0.005)

  // ── which base-indent rows are groups, and which rows each owns ───────────
  const memo = new Map()
  const resolveGroup = (i) => {
    if (memo.has(i)) return memo.get(i)
    memo.set(i, null)
    const x = flat[i]
    let found = null
    if (!nil(x)) {
      const target = figs(x)
      const sum = [0, 0, 0, 0]
      for (let j = i + 1; j < flat.length; j++) {
        const y = flat[j]
        if (y.indent === 0) break
        if (y.indent === base) {
          const g = resolveGroup(j)
          if (g) continue                                  // a nested group: its own rows follow and are counted below
        }
        const f = figs(y)
        for (let k = 0; k < 4; k++) sum[k] += f[k]
        if (sum.every((v, k) => Math.abs(v - target[k]) < TOL)) { found = { start: i, end: j }; break }
      }
    }
    memo.set(i, found)
    return found
  }

  const groups = []                                       // [{ start, end, name }] for primaries and base-indent groups
  let primaryName = null, primaryIdx = -1
  for (let i = 0; i < flat.length; i++) {
    const r = flat[i]
    if (r.indent === 0) {
      primaryName = r.name; primaryIdx = i
      // a primary owns everything up to the next primary
      let end = i
      while (end + 1 < flat.length && flat[end + 1].indent !== 0) end++
      r.kind = end > i ? 'group' : 'ledger'
      if (r.kind === 'group') groups.push({ start: i, end, name: r.name, primary: true })
      continue
    }
    if (r.indent === base) {
      const g = resolveGroup(i)
      if (g) { r.kind = 'group'; groups.push({ start: i, end: g.end, name: r.name, primary: false }) }
      else r.kind = 'ledger'
    } else r.kind = 'ledger'
    r.primaryIdx = primaryIdx
  }
  // a base-indent row that is a nil group header (e.g. an empty sub-group) is a nil ledger: dropped below with the rest.

  // ── ledgers with their chain of groups ────────────────────────────────────
  const rows = []
  const totals = { Assets: 0, Liabilities: 0, Equities: 0, Income: 0, Expense: 0 }
  flat.forEach((r, i) => {
    if (r.kind !== 'ledger') return
    const cover = groups.filter(g => g.start < i && i <= g.end).sort((a, b) => a.start - b.start)   // outer -> inner
    const chain = cover.map(g => g.name)
    const prim = chain.length ? primaryOf(chain[0]) : null
    let section = prim && prim.key
    let tally = null
    // sub-groups: the innermost meaningful one decides the group; Revenue Accounts take their nature from it
    let sub = null
    for (let k = chain.length - 1; k >= 1; k--) { const s = subgroupOf(chain[k]); if (s) { sub = s; break } }
    if (prim && prim.rx.test('Revenue Accounts')) {
      const anySub = sub || (chain[1] ? subgroupOf(chain[1]) : null)
      section = anySub && anySub.section ? anySub.section : (r.closing <= 0 && !(anySub && anySub.section) ? 'Income' : 'Expense')
      tally = anySub ? anySub.tally : (section === 'Income' ? 'Indirect Incomes' : 'Indirect Expenses')
    } else if (prim) {
      tally = sub ? sub.tally : prim.tally
    } else {
      // a ledger sitting outside every group: by the side its balance is on
      section = r.closing >= 0 ? 'Assets' : 'Liabilities'
      tally = 'Suspense A/c'
    }
    if (!section) section = r.closing >= 0 ? 'Assets' : 'Liabilities'
    const meta = SECTION_META[section]
    totals[section] += r.closing
    rows.push({
      name: r.name, section, sectionType: meta.type, drNatured: meta.drNatured,
      parents: chain, groupTally: tally, primaryTally: prim ? prim.tally : null,
      opening: r.opening, debit: r.debit, credit: r.credit, closing: r.closing, _r: r._r,
    })
  })

  // ── integrity checks - a mis-read must never slip through silently ────────
  const bad = rows.filter(r => Math.abs(r.opening + r.debit - r.credit - r.closing) > 0.02)
  if (bad.length) warnings.push(`${bad.length} account(s) do not satisfy Closing = Opening + Debit − Credit (e.g. "${bad[0].name}", row ${bad[0]._r}).`)
  for (const g of groups.filter(g => g.primary)) {
    const own = rows.filter(r => r._r >= flat[g.start]._r && r._r <= flat[g.end]._r)
    const sum = own.reduce((s, r) => s + r.closing, 0)
    if (Math.abs(sum - flat[g.start].closing) > 0.02) {
      warnings.push(`"${g.name}" shows ${r2(flat[g.start].closing).toFixed(2)} (Dr +, Cr −) but the accounts read under it add up to ${r2(sum).toFixed(2)} - check the file.`)
    }
  }
  const sum = (k) => r2(rows.reduce((s, r) => s + r[k], 0))
  const stats = {
    ledgerRows: rows.length,
    sumOpening: sum('opening'), sumDebit: sum('debit'), sumCredit: sum('credit'), sumClosing: sum('closing'),
    grandDebit: grand ? r2(grand.debit) : null, grandCredit: grand ? r2(grand.credit) : null,
    sections: {},
  }
  for (const k of BUSY_SECTION_ORDER) {
    const inS = rows.filter(r => r.section === k)
    stats.sections[k] = { count: inS.length, closing: r2(inS.reduce((a, r) => a + r.closing, 0)), drNatured: SECTION_META[k].drNatured }
  }
  if (Math.abs(stats.sumClosing) > 0.01) warnings.push(`The Trial Balance does not balance: closing balances add up to ${stats.sumClosing.toFixed(2)} (Dr + / Cr −), expected 0.`)
  if (Math.abs(stats.sumOpening) > 0.01) warnings.push(`Opening balances add up to ${stats.sumOpening.toFixed(2)}, expected 0.`)
  if (grand) {
    if (Math.abs(stats.sumDebit - grand.debit) > 0.01) warnings.push(`Debit of the accounts read (${stats.sumDebit.toFixed(2)}) differs from the file's Total (${r2(grand.debit).toFixed(2)}).`)
    if (Math.abs(stats.sumCredit - grand.credit) > 0.01) warnings.push(`Credit of the accounts read (${stats.sumCredit.toFixed(2)}) differs from the file's Total (${r2(grand.credit).toFixed(2)}).`)
  }

  let zeroSkipped = 0
  const kept = rows.filter(r => {
    const any = [r.opening, r.debit, r.credit, r.closing].some(v => Math.abs(v) > 0.004)
    if (!any) zeroSkipped++
    return any
  })
  stats.zeroSkipped = zeroSkipped
  stats.imported = kept.length
  return { format: 'busy', entityName, from, to, periodLabel, rows: kept, allRowCount: rows.length, stats, warnings }
}

/**
 * Parsed Busy rows -> rows for the standard `tb_rows` table (Dr NEGATIVE / Cr POSITIVE, hierarchy deepest-first, ending 'Primary').
 *   a ledger directly in a primary group  -> [ <Tally group>, 'Primary' ]
 *   a ledger in sub-groups                -> [ <innermost group>, ..., <Tally group>, 'Primary' ]
 */
export function buildTBRowsFromBusy(parsed, opts = {}) {
  const company = Number(opts.constitution) === 3
  return (parsed.rows || []).map(r => {
    const real = r.parents.slice(1).reverse()                  // inner -> outer, the primary left out
    let tally = r.groupTally
    if (tally === 'Capital Account' && company) tally = 'Capital'
    const prim = r.primaryTally === 'Capital Account' && company ? 'Capital' : r.primaryTally
    const chain = [...real, tally, prim, 'Primary'].filter(Boolean)
    const uniq = chain.filter((g, i) => chain.indexOf(g) === i)
    return {
      period: '', branch: '', ledger_code: '', name: r.name,
      opening_balance: r.opening === 0 ? 0 : -r.opening,
      debit: r.debit, credit: r.credit,
      closing_balance: r.closing === 0 ? 0 : -r.closing,
      is_revenue: null, is_deemed_positive: r.drNatured, trail_balance: 0, trial_balance_type: r.sectionType,
      parent: uniq[0] || '', group_parent: uniq[1] || '', group_parent_1: uniq[2] || '', group_parent_2: uniq[3] || '',
      group_parent_3: uniq[4] || '', group_parent_4: uniq[5] || '', group_parent_5: uniq[6] || '', group_parent_6: '',
      group_parent_7: uniq[uniq.length - 1] || '',
    }
  })
}
