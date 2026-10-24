// ── Schedule III financial ratios (Company, constitution 3) ────────────────
// Computes the 11 ratios Schedule III (Division I) requires companies to
// disclose, straight from the same processed-financials object the Balance
// Sheet and P&L screens already use (useFinancials's `data`), so a ratio
// here can never disagree with what the BS/PL face itself shows.
//
// 8 of the 11 come straight off Balance Sheet / P&L totals and are treated
// as fully auto-computed. 3 (Debt Service Coverage, Return on Capital
// Employed, Return on Investment) need a figure this app has no reliable
// source for (debt service schedule, "operating" capital employed
// conventions, true time-weighted average investments) — they get a
// best-effort default so the row isn't just blank, but are flagged as
// estimates for the CA to review, never presented as equal-confidence to
// the other 8.
//
// Reuses BS_STRUCTURE / matchToBuckets / buildUncatBuckets from
// bsStructure.js — the same Schedule III line-matching the Balance Sheet
// screen uses — rather than re-deriving group totals independently, so a
// ratio's "Current Assets" is provably the same number as the BS face's
// "Current Assets" (including uncategorised ledgers routed into that
// statutory group, exactly as the BS screen folds them into its own
// printed group totals).

import { BS_STRUCTURE, matchToBuckets, buildUncatBuckets, elGroupOf, assetGroupOf } from './bsStructure'

function groupKeysTotal(buckets, keys) {
  return {
    total: keys.reduce((s, k) => s + (buckets[k]?.total || 0), 0),
    prevTotal: keys.reduce((s, k) => s + (buckets[k]?.prevTotal || 0), 0),
  }
}

// A statutory group's total exactly as the BS face prints it: its matched
// Schedule III lines PLUS any uncategorised ledgers routed into that same
// group (BS/index.jsx's `Group` renderer does the identical addition).
function fullGroupTotal(structureGroups, buckets, uncatByGroup, groupLabel) {
  const group = structureGroups.find(g => g.label === groupLabel)
  if (!group) return { total: 0, prevTotal: 0 }
  const matched = groupKeysTotal(buckets, group.lines.map(l => l.key))
  const uncat = uncatByGroup[group.num]
  return {
    total: matched.total + (uncat ? uncat.total : 0),
    prevTotal: matched.prevTotal + (uncat ? uncat.prevTotal : 0),
  }
}

const bucket = (buckets, key) => buckets[key] || { total: 0, prevTotal: 0 }
const add = (...vals) => ({
  total: vals.reduce((s, v) => s + (v?.total || 0), 0),
  prevTotal: vals.reduce((s, v) => s + (v?.prevTotal || 0), 0),
})
const sub = (a, b) => ({ total: (a?.total || 0) - (b?.total || 0), prevTotal: (a?.prevTotal || 0) - (b?.prevTotal || 0) })
const avg = (v) => ((v?.total || 0) + (v?.prevTotal || 0)) / 2
const safeDiv = (n, d) => (d === 0 || d === null || d === undefined || isNaN(d)) ? null : n / d

function findSection(sections, rx) {
  const sec = (sections || []).find(s => rx.test(s.level1 || ''))
  return sec ? { total: sec.total || 0, prevTotal: sec.prevTotal || 0 } : { total: 0, prevTotal: 0 }
}
function sumSections(sections, rx) {
  return (sections || []).filter(s => rx.test(s.level1 || '')).reduce(
    (acc, s) => ({ total: acc.total + (s.total || 0), prevTotal: acc.prevTotal + (s.prevTotal || 0) }),
    { total: 0, prevTotal: 0 }
  )
}
// "Income generated from investments" has no dedicated Level 1 section of
// its own — interest/dividend income sit as Level 2 lines inside whichever
// "Other income" section they were mapped to. Best-effort: scan every
// income section's lines for the usual captions.
function investmentIncome(incomeSections) {
  const rx = /interest income|dividend income|income from investment/i
  let total = 0, prevTotal = 0
  for (const sec of incomeSections || []) {
    for (const line of sec.lines || []) {
      if (rx.test(line.level2 || '')) { total += line.total || 0; prevTotal += line.prevTotal || 0 }
    }
  }
  return { total, prevTotal }
}

// Fixed row order/wording — the single source of truth for both the table
// builder (GeneralNotes/index.jsx) and the Excel round-trip
// (ratioWorkbook.js), so a blank template, a filled download, and a freshly
// computed table can never drift into a different row order or wording from
// one another.
export const RATIO_ROWS_META = [
  { key: 'current', label: 'Current Ratio', numeratorLabel: 'Current Assets', denominatorLabel: 'Current Liabilities', format: 'ratio', isEstimate: false },
  { key: 'debt_equity', label: 'Debt-Equity Ratio', numeratorLabel: 'Total Debt', denominatorLabel: "Shareholder's Fund", format: 'ratio', isEstimate: false },
  { key: 'dscr', label: 'Debt Service Coverage Ratio', numeratorLabel: 'Net Operating Income', denominatorLabel: 'Total Debt Service', format: 'ratio', isEstimate: true },
  { key: 'roe', label: 'Return on Equity Ratio', numeratorLabel: 'Net Earnings', denominatorLabel: "Average Shareholder's Equity", format: 'percent', isEstimate: false },
  { key: 'inv_turnover', label: 'Inventory Turnover Ratio', numeratorLabel: 'Net Sales', denominatorLabel: 'Average Inventories', format: 'ratio', isEstimate: false },
  { key: 'tr_turnover', label: 'Trade Receivables Turnover Ratio', numeratorLabel: 'Net Credit Sales', denominatorLabel: 'Average Trade Receivable', format: 'ratio', isEstimate: false },
  { key: 'tp_turnover', label: 'Trade Payables Turnover Ratio', numeratorLabel: 'Net Credit Purchases', denominatorLabel: 'Average Trade Payables', format: 'ratio', isEstimate: false },
  { key: 'net_cap_turnover', label: 'Net Capital Turnover Ratio', numeratorLabel: 'Total Sales', denominatorLabel: 'Average Working Capital', format: 'ratio', isEstimate: false },
  { key: 'net_profit', label: 'Net Profit Ratio', numeratorLabel: 'Net Profit', denominatorLabel: 'Revenue from Operations', format: 'percent', isEstimate: false },
  { key: 'roce', label: 'Return on Capital Employed', numeratorLabel: 'Earnings before Interest and Tax', denominatorLabel: 'Capital Employed', format: 'percent', isEstimate: true },
  { key: 'roi', label: 'Return on Investment', numeratorLabel: 'Income generated from Investments', denominatorLabel: 'Time Weighted Average Investments', format: 'percent', isEstimate: true },
]

/**
 * Returns the 11 Schedule III ratios computed from `data` (the object
 * useFinancials returns), or null if there isn't enough to compute from
 * (no data / no TB loaded yet). Each row extends RATIO_ROWS_META with:
 * numeratorValue, denominatorValue (the actual rupee/count figures the
 * Current Year ratio was divided out of — for an "Average X" denominator
 * this is that average, not a bare closing balance), cy, py, variancePct.
 * `numeratorValue`/`denominatorValue`/`cy`/`py`/`variancePct` are numbers or
 * null (null = could not be computed, e.g. division by zero — the caller
 * renders that as blank, same as the original hand-typed template).
 */
export function computeRatios(data) {
  if (!data || !Array.isArray(data.elSections) || !Array.isArray(data.assetSections)) return null

  const { buckets: elBuckets, unmatched: elUnmatched } = matchToBuckets(data.elSections, BS_STRUCTURE.el)
  const { buckets: aBuckets, unmatched: aUnmatched } = matchToBuckets(data.assetSections, BS_STRUCTURE.assets, data)
  const { byGroup: elUncatByGroup } = buildUncatBuckets(elUnmatched, elGroupOf)
  const { byGroup: aUncatByGroup } = buildUncatBuckets(aUnmatched, assetGroupOf)

  const shFunds = fullGroupTotal(BS_STRUCTURE.el, elBuckets, elUncatByGroup, "Shareholders' funds")
  const currLiab = fullGroupTotal(BS_STRUCTURE.el, elBuckets, elUncatByGroup, 'Current liabilities')
  const currAssets = fullGroupTotal(BS_STRUCTURE.assets, aBuckets, aUncatByGroup, 'Current assets')

  const ltb = bucket(elBuckets, 'ltb')
  const stb = bucket(elBuckets, 'stb')
  const dtl = bucket(elBuckets, 'dtl')
  const totalDebt = add(ltb, stb)
  const inventories = bucket(aBuckets, 'inventories')
  const tradeRec = bucket(aBuckets, 'trade_rec')
  const tradePay = bucket(elBuckets, 'trade_pay')
  const currInvestments = bucket(aBuckets, 'curr_investments')
  const ncInvestments = bucket(aBuckets, 'nc_investments')
  const investments = add(currInvestments, ncInvestments)
  const workingCapital = sub(currAssets, currLiab)

  const revenue = findSection(data.incomeSections, /revenue from operation/i)
  const finance = findSection(data.expenseSections, /finance cost|finance charge/i)
  const tax = sumSections(data.expenseSections, /tax expense/i)
  const purchases = sumSections(data.expenseSections, /cost of materials consumed|purchases of stock.in.trade/i)
  const invIncome = investmentIncome(data.incomeSections)

  const netProfit = { total: data.netProfit || 0, prevTotal: data.prevNetProfit || 0 }
  const ebit = add(netProfit, finance, tax)
  const capitalEmployed = add(shFunds, ltb, dtl)
  // Best-effort "debt service": interest paid, plus any net reduction in
  // total debt during the year (a proxy for principal repaid) — there is
  // no repayment-schedule figure elsewhere in the app to draw on.
  const debtService = {
    total: (finance.total || 0) + Math.max(0, (totalDebt.prevTotal || 0) - (totalDebt.total || 0)),
    prevTotal: null, // no PPY (year before the comparative) data exists to compute a PY figure
  }

  // cyN/cyD are also exposed as numeratorValue/denominatorValue on the row
  // (the figures actually behind the printed Current Year ratio).
  const ratio = (cyN, cyD, pyN, pyD) => {
    const cy = safeDiv(cyN, cyD)
    const py = safeDiv(pyN, pyD)
    const variancePct = (cy !== null && py !== null && py !== 0) ? ((cy - py) / Math.abs(py)) * 100 : null
    return { numeratorValue: cyN, denominatorValue: cyD, cy, py, variancePct }
  }
  const single = (n, d) => ({ numeratorValue: n, denominatorValue: d, cy: safeDiv(n, d), py: null, variancePct: null })

  const byKey = {
    current: ratio(currAssets.total, currLiab.total, currAssets.prevTotal, currLiab.prevTotal),
    debt_equity: ratio(totalDebt.total, shFunds.total, totalDebt.prevTotal, shFunds.prevTotal),
    dscr: single(ebit.total, debtService.total),
    roe: single(netProfit.total, avg(shFunds)),
    inv_turnover: single(revenue.total, avg(inventories)),
    tr_turnover: single(revenue.total, avg(tradeRec)),
    tp_turnover: single(purchases.total, avg(tradePay)),
    net_cap_turnover: single(revenue.total, avg(workingCapital)),
    net_profit: ratio(netProfit.total, revenue.total, netProfit.prevTotal, revenue.prevTotal),
    roce: ratio(ebit.total, capitalEmployed.total, ebit.prevTotal, capitalEmployed.prevTotal),
    roi: single(invIncome.total, avg(investments)),
  }

  // "Average"-denominator rows only have one year's worth of a ratio (the
  // average itself straddles CY and PY), so `py`/`variancePct` are
  // deliberately left null for those — the table shows the average basis
  // explicitly instead of an unlabelled PY figure that isn't really the
  // previous year's own ratio.
  return RATIO_ROWS_META.map(meta => ({ ...meta, ...byKey[meta.key] }))
}

/** "2.35" / "" for a plain multiple/ratio figure. */
export function fmtRatioNum(n) {
  if (n === null || n === undefined || isNaN(n)) return ''
  return n.toFixed(2)
}

/** "18.42%" / "" for a percentage figure. `n` is the raw ratio (e.g. 0.1842
 *  for 18.42%), same units as computeRatios stores internally for
 *  format:'percent' rows — this is the only place that multiplies by 100. */
export function fmtRatioPct(n) {
  if (n === null || n === undefined || isNaN(n)) return ''
  return (n * 100).toFixed(2) + '%'
}

export function fmtRatioCell(n, format) {
  return format === 'percent' ? fmtRatioPct(n) : fmtRatioNum(n)
}

export function fmtVariance(n) {
  if (n === null || n === undefined || isNaN(n)) return ''
  return n.toFixed(2) + '%'
}

/** "1,23,456.00" / "" — for the raw rupee Numerator/Denominator Value
 *  columns (never a percentage, regardless of the ratio's own format). */
export function fmtRatioAmount(n) {
  if (n === null || n === undefined || isNaN(n)) return ''
  const abs = Math.abs(n)
  const str = abs.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return n < 0 ? `(${str})` : str
}

/**
 * The working behind the Trade Payables Turnover Ratio's numerator, "Net Credit Purchases", for the Annexures (screen, PDF, Excel).
 * The ratio takes it as the total of the Profit & Loss captions "Cost of materials consumed" and "Purchases of Stock-in-Trade" - this
 * lists what is in each (its lines, Current and Previous Year) and the denominator (average Trade Payables), so the figure can be
 * checked. Same sections and same totals as computeRatios(); null when neither caption is in the statements.
 *   { rows: [{ kind: 'head' | 'line' | 'sub' | 'total' | 'note', label, cy, py }], numerator: {cy, py}, average, ratio }
 */
export function netCreditPurchasesWorking(data) {
  if (!data || !Array.isArray(data.expenseSections)) return null
  const secs = data.expenseSections.filter(s => /cost of materials consumed|purchases of stock.in.trade/i.test(s.level1 || ''))
  if (!secs.length) return null
  const rows = []
  let cy = 0, py = 0
  for (const sec of secs) {
    rows.push({ kind: 'head', label: sec.level1 })
    let lc = 0, lp = 0
    for (const l of (sec.lines || [])) {
      const c = l.total || 0, p = l.prevTotal || 0
      if (Math.abs(c) < 0.005 && Math.abs(p) < 0.005) continue
      rows.push({ kind: 'line', label: l.level2 || sec.level1, cy: c, py: p })
      lc += c; lp += p
    }
    const rc = (sec.total || 0) - lc, rp = (sec.prevTotal || 0) - lp
    if (Math.abs(rc) >= 0.5 || Math.abs(rp) >= 0.5) rows.push({ kind: 'line', label: 'Other ledgers under this caption', cy: rc, py: rp })
    rows.push({ kind: 'sub', label: `Total - ${sec.level1}`, cy: sec.total || 0, py: sec.prevTotal || 0 })
    cy += sec.total || 0; py += sec.prevTotal || 0
  }
  rows.push({ kind: 'total', label: 'Net Credit Purchases taken for the ratio', cy, py })
  const row = (computeRatios(data) || []).find(r => r.key === 'tp_turnover')
  const tp = Object.values(data.notes || {}).find(n => !n.isPL && /^trade\s+payables?$/i.test(n.title || ''))
  const avgV = row ? row.denominatorValue : null
  let components = null
  if (tp && avgV !== null && Math.abs(((tp.total || 0) + (tp.prevTotal || 0)) / 2 - avgV) < 0.5) components = { closing: tp.total || 0, opening: tp.prevTotal || 0 }
  return { rows, numerator: { cy, py }, average: avgV, components, ratio: row ? row.cy : null }
}
