// ── Corporate / LLP (constitution=3 / constitution=2) Statement of Profit
// and Loss structure — Schedule III fixed expense-line order. Single source
// of truth for the fixed 7-line expense bucketing ("Cost of materials
// consumed" ... "Other expenses") shared by the live PL screen
// (components/PL/index.jsx), the Excel exporter (buildExcel.js), and — via
// corpPLSectionOrder() below — useFinancials.js's note-numbering pass.
//
// Mirrors the fix already applied to Company's Balance Sheet
// (bsStructure.js's companyBSLineOrder()) and to non-corporate P&L
// (plStructureNonCorp.js's nonCorpPLSectionOrder()): raw expenseSections/
// incomeSections array order can't be trusted for note numbering, because
// sectionSortKey() in useFinancials.js sorts anything that doesn't match a
// named EXPENSE_ORDER term (e.g. "Exceptional items", "Extraordinary items")
// to the *back* of the list — after "Tax Expense" — even though Schedule III
// always shows Exceptional/Extraordinary items BEFORE the tax-expense block.

export const EXPENSE_LINES = [
  { key: 'cost_materials',  label: 'Cost of materials consumed',                                    match: /cost of material/i },
  { key: 'purchases',       label: 'Purchases of Stock-in-Trade',                                    match: /purchase/i },
  { key: 'inv_changes',     label: 'Changes in inventories of finished goods, WIP and Stock-in-Trade', match: null }, // computed
  // 'Cost of stores and spares consumed' deliberately has NO fixed face
  // line — per the CA's rule it's folded into "Other expenses" (with its
  // own Opening/Closing stock adjustment) same as Loose Tools, never shown
  // as its own line. See useFinancials.js's merge pass.
  { key: 'employee',        label: 'Employee benefits expense',                                      match: /employee benefit/i },
  { key: 'finance',         label: 'Finance costs',                                                  match: /finance cost|finance charge/i },
  { key: 'depreciation',    label: 'Depreciation and amortization expense',                          match: /depreciation|amortis/i },
  { key: 'other_expenses',  label: 'Other expenses',                                                 match: null }, // catch-all
]

// Trims + drops a trailing colon before testing — see plStructureNonCorp.js's
// findSec for why: an exact-anchored regex against a raw, unresolved
// mapping1_resultant fallback (which can carry a stray trailing colon, e.g.
// "Tax expense:") would otherwise silently fail to match and make a whole
// PL section vanish with no error.
const normalizeLabel = (s) => (s || '').trim().replace(/:\s*$/, '')
const findSec = (sections, rx) => sections.find(s => rx.test(normalizeLabel(s.level1)))

// ── The P&L below the seven expense lines — one source for the screen, PDF and Excel ──
// Until 1 Oct 2026 each of the three worked this out for itself, and they disagreed:
// "Profit for period from discontinuing operations" fell into Other expenses (with the
// wrong sign), "Tax expense of discontinuing operations" was counted as ordinary tax,
// the screen and Excel printed Extraordinary items as a fixed 0 (screen: folded into
// Exceptional), and the PDF stopped at one "Profit for the period" with no
// continuing / discontinuing lines at all.
const DISC_PROFIT_RX = /profit.*discontinuing operation/i
const DISC_TAX_RX = /tax expense of discontinuing/i
/** The ordinary Tax expense section(s) — not the discontinuing operations' own tax. */
export const TAX_SECTION_RX = /^tax expense:?\s*$/i
export const isDiscontinuingSection = (s) => {
  const l1 = normalizeLabel(s?.level1)
  return DISC_PROFIT_RX.test(l1) || DISC_TAX_RX.test(l1)
}

/**
 * Exceptional items, Extraordinary items and the discontinuing operations, each
 * with its Current / Previous Year figure and note number, plus the after-tax figure.
 * Expense sections carry expenses as positive numbers, so a discontinuing PROFIT
 * (a credit) arrives negative: it is turned round here, so a profit prints as a
 * profit and a loss as a loss, and the face foots to the net profit the Balance
 * Sheet takes (processRows' netProfit).
 */
export function corpFaceTail(expSections) {
  const sec = (rx) => (expSections || []).find(s => rx.test(normalizeLabel(s.level1)))
  const val = (s, sign = 1) => ({ cy: sign * (s?.total || 0), py: sign * (s?.prevTotal || 0), noteNum: s?.noteNum || null })
  const exceptional = val(sec(/^exceptional item/i))
  const extraordinary = val(sec(/^extraordinary item/i))
  const discProfit = val(sec(DISC_PROFIT_RX), -1)
  const discTax = val(sec(DISC_TAX_RX))
  const discAfterTax = { cy: discProfit.cy - discTax.cy, py: discProfit.py - discTax.py }
  return { exceptional, extraordinary, discProfit, discTax, discAfterTax }
}

/**
 * "Profit / (Loss) for the period" exactly as the Statement of Profit and Loss face computes it (PL screen, PDF and Excel all follow
 * this): income without the Closing Stock section and the exceptional / extraordinary lines, less every expense section but the
 * stock movement lines (which sit in "Changes in inventories"), tax, exceptional / extraordinary and discontinuing operations,
 * less the exceptional / extraordinary items and tax, plus the discontinuing operations after tax. EPS divides THIS profit - the
 * data-level netProfit adds up the sections differently and could differ from the face (even in sign).
 * @returns {{cy:number, py:number}}
 */
export function corpFaceNetProfit(data) {
  const exp = data?.expenseSections || []
  const inc = data?.incomeSections || []
  const openSec = exp.find(s => /opening stock/i.test(s.level1))
  const closeSec = inc.find(s => /closing stock/i.test(s.level1))
  const changesSec = exp.find(s => /changes in inventor/i.test(s.level1))
  const skip = new Set([openSec?.level1, closeSec?.level1, changesSec?.level1].filter(Boolean))
  const add = (arr, k) => arr.reduce((t, x) => t + (Number(x[k]) || 0), 0)
  const mainExp = exp.filter(sec => !skip.has(sec.level1) && !/tax expense/i.test(sec.level1) && !/exceptional|extraordinary/i.test(sec.level1) && !/discontinuing/i.test(sec.level1))
  const pureInc = inc.filter(sec => !/closing stock/i.test(sec.level1) && !/exceptional|extraordinary/i.test(sec.level1))
  const tail = corpFaceTail(exp)
  const taxSecs = exp.filter(sec => TAX_SECTION_RX.test((sec.level1 || '').trim()))
  const side = (k, tk, ik) => add(pureInc, k) - (add(mainExp, k) + (Number(changesSec?.[k]) || 0))
    - tail.exceptional[ik] - tail.extraordinary[ik] - add(taxSecs, k) + tail.discAfterTax[ik]
  return { cy: side('total', 'total', 'cy'), py: side('prevTotal', 'prevTotal', 'py') }
}

/**
 * Returns income/expense SECTIONS in the exact face order used by the live
 * PL screen / Excel for Company (constitution=3) and LLP (constitution=2):
 *   Revenue from operations, Other income section(s), Uncategorised income,
 *   Cost of materials consumed, Purchases of Stock-in-Trade,
 *   Changes in inventories, Employee benefits, Finance costs, Depreciation,
 *   any other unmatched expense sections ("Other expenses" catch-all),
 *   Uncategorised expenses, Exceptional items, Extraordinary items, Tax expense.
 *
 * Used by useFinancials.js's renumberNotesInPresentationOrder() so a PL
 * note's number always matches where its line physically sits on the face —
 * raw array order cannot be trusted (see module doc comment above).
 *
 * @param {object} data - output of processRows() (incomeSections, expenseSections)
 * @returns {object[]} sections in face order (duplicates removed, missing ones skipped)
 */
// A fixed Schedule III line (unlike Exceptional/Extraordinary items, which
// are genuinely optional and correctly omitted when not applicable) must
// always appear on the face — even at zero — the same guarantee BS already
// has via bsStructure.js's injectZeroSkeletonLines/hardcoded BS_STRUCTURE.
// Without this, an entity with nothing yet mapped into e.g. "Employee
// benefits expense" would simply have that line vanish instead of showing
// zero, which is wrong both for real filings and for using the app to
// verify the prescribed format against a near-empty Trial Balance.
const zeroPlaceholder = (label) => ({ level1: label, lines: [], total: 0, prevTotal: 0, noteNum: null })
const findSecOrZero = (sections, rx, label) => findSec(sections, rx) || zeroPlaceholder(label)

export function corpPLSectionOrder(data) {
  const inc = data.incomeSections || []
  const exp = data.expenseSections || []

  const revOpsSec = findSecOrZero(inc, /revenue from operation/i, 'Revenue from operations')
  const closingStockSec = findSec(inc, /^closing stock/i) // legacy shape only
  const otherIncSecs = inc.filter(s => s !== revOpsSec && s !== closingStockSec && !/uncategorised/i.test(s.level1 || ''))
  const uncatIncSecs = inc.filter(s => /uncategorised/i.test(s.level1 || ''))

  const materialsSec = findSecOrZero(exp, /^cost of materials consumed/i, 'Cost of materials consumed')
  const purchasesSec = findSecOrZero(exp, /^purchases of stock-in-trade/i, 'Purchases of Stock-in-Trade')
  const changesSec = findSecOrZero(exp, /changes in inventor/i, 'Changes in inventories of finished goods, WIP and Stock-in-Trade')
  const legacyOpenSec = findSec(exp, /^opening stock/i)
  const employeeSec = findSecOrZero(exp, /employee benefit/i, 'Employee benefits expense')
  const financeSec = findSecOrZero(exp, /finance cost|finance charge/i, 'Finance costs')
  const depSec = findSecOrZero(exp, /depreciation|amortis/i, 'Depreciation and amortization expense')
  const exceptionalSec = findSec(exp, /^exceptional item/i)
  const extraordinarySec = findSec(exp, /^extraordinary item/i)
  const taxSec = findSecOrZero(exp, /^tax expense$/i, 'Tax expense')
  const discProfitSec = findSec(exp, DISC_PROFIT_RX)
  const discTaxSec = findSec(exp, DISC_TAX_RX)

  const fixedMatched = new Set([
    materialsSec, purchasesSec, changesSec, legacyOpenSec, employeeSec, financeSec, depSec,
    exceptionalSec, extraordinarySec, taxSec, discProfitSec, discTaxSec,
  ].filter(Boolean))
  const uncatExpSecs = exp.filter(s => /uncategorised/i.test(s.level1 || ''))
  const otherExpSecs = exp.filter(s => !fixedMatched.has(s) && !uncatExpSecs.includes(s))

  return [
    revOpsSec, ...otherIncSecs, ...uncatIncSecs,
    materialsSec, purchasesSec, changesSec, legacyOpenSec, employeeSec, financeSec, depSec,
    ...otherExpSecs, ...uncatExpSecs,
    exceptionalSec, extraordinarySec,
    taxSec, discProfitSec, discTaxSec,
  ].filter(Boolean)
}
