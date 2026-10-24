// ── Non-corporate (constitution=1: Individual/Proprietorship/Partnership)
// Statement of Profit and Loss structure, per the ICAI illustrative format
// for non-corporate entities. Single source of truth — used by the live PL
// screen, the Excel exporter, and the PDF exporter, so all three always
// render the identical sequence and roman-numeral numbering.
//
// Individual/Proprietorship have no "partners' remuneration" concept, so
// rows IX (Profit before partners' remuneration and tax) and X (Partners'
// remuneration) are dropped and the whole sequence renumbers with no gap.

const ROMAN = ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX']
const ZERO_EPS = 0.005
const isZero = (n) => Math.abs(n || 0) < ZERO_EPS

// Trims + drops a trailing colon before testing — a section's level1 is
// expected to already be clean, but if level_format_id resolution ever fails
// for a row and falls back to the raw mapping1_resultant text (which can
// carry stray formatting like a trailing colon, e.g. "Tax expense:"), an
// exact-anchored regex would silently fail to match and the ENTIRE section
// would compute as zero with no error. Normalizing here means a labelling
// hiccup degrades gracefully instead of making a whole PL section vanish.
const normalizeLabel = (s) => (s || '').trim().replace(/:\s*$/, '')
const findSec = (sections, rx) => sections.find(s => rx.test(normalizeLabel(s.level1)))

/**
 * Returns income/expense SECTIONS in the exact face order used by
 * computeNonCorpPLLayout()'s items list — the same order the live PL screen,
 * PDF, and Excel all render. Used by useFinancials.js's
 * renumberNotesInPresentationOrder() so a PL note's number always matches
 * where its line physically sits on the face, mirroring the fix already
 * applied to Company's Balance Sheet (see bsStructure.js's
 * companyBSLineOrder()). Raw expenseSections/incomeSections order can't be
 * trusted for this — EXPENSE_ORDER in useFinancials.js doesn't even list
 * Exceptional/Extraordinary/Remuneration/discontinuing-operations buckets,
 * so their relative order there is arbitrary (whatever the underlying TB
 * rows happened to produce).
 *
 * @param {object} data - output of processRows()
 * @param {string} constitutionDisplay
 * @returns {object[]} sections in face order (duplicates removed, missing ones skipped)
 */
export function nonCorpPLSectionOrder(data, constitutionDisplay) {
  const cd = (constitutionDisplay || '').toLowerCase()
  const isSingleOwner = cd.includes('individual') || cd.includes('proprietor')

  const inc = data.incomeSections || []
  const exp = data.expenseSections || []

  const revOpsSec = findSec(inc, /revenue from operation/i)
  const otherIncSecs = inc.filter(s => s !== revOpsSec && !/uncategorised/i.test(s.level1 || ''))
  const uncatIncSecs = inc.filter(s => /uncategorised/i.test(s.level1 || ''))

  const materialsSec = findSec(exp, /^cost of materials consumed/i)
  const purchasesSec = findSec(exp, /^purchases of stock-in-trade/i)
  const changesSec = findSec(exp, /changes in inventories/i)
  // 'Cost of stores and spares consumed' deliberately has no fixed face
  // line — folded into "Other expenses" instead. See useFinancials.js's
  // merge pass.
  const employeeSec = findSec(exp, /employee benefit/i)
  const financeSec = findSec(exp, /finance cost/i)
  const depSec = findSec(exp, /depreciation|amortis/i)
  const exceptionalSec = findSec(exp, /^exceptional item/i)
  const extraordinarySec = findSec(exp, /^extraordinary item/i)
  const taxSec = findSec(exp, /^tax expense$/i)
  const discProfitSec = findSec(exp, /profit.*discontinuing operation/i)
  const discTaxSec = findSec(exp, /tax expense of discontinuing/i)
  const remunerationSec = findSec(exp, /partners.{0,3}remuneration/i)

  const fixedMatched = new Set([
    materialsSec, purchasesSec, changesSec, employeeSec, financeSec, depSec,
    exceptionalSec, extraordinarySec, taxSec, discProfitSec, discTaxSec, remunerationSec,
  ].filter(Boolean))
  const uncatExpSecs = exp.filter(s => /uncategorised/i.test(s.level1 || ''))
  const otherExpSecs = exp.filter(s => !fixedMatched.has(s) && !uncatExpSecs.includes(s))

  return [
    revOpsSec, ...otherIncSecs, ...uncatIncSecs,
    materialsSec, purchasesSec, changesSec, employeeSec, financeSec, depSec,
    ...otherExpSecs, ...uncatExpSecs,
    exceptionalSec, extraordinarySec,
    ...(isSingleOwner ? [] : [remunerationSec]),
    taxSec, discProfitSec, discTaxSec,
  ].filter(Boolean)
}

/**
 * @param {object} data - output of processRows() (incomeSections, expenseSections, totalIncome, ...)
 * @param {string} constitutionDisplay - e.g. "Individual", "Proprietorship", "Partnership"
 * @returns {{ isSingleOwner: boolean, items: Array, totalIncome, totalExpenses, netProfit }}
 *   items: [{ kind: 'row'|'uncat'|'total'|'subtotal'|'header'|'grandtotal', roman?, alpha?, label, noteNum?, cy, py }]
 */
export function computeNonCorpPLLayout(data, constitutionDisplay, manualTaxLines = []) {
  const cd = (constitutionDisplay || '').toLowerCase()
  const isSingleOwner = cd.includes('individual') || cd.includes('proprietor')

  const inc = data.incomeSections || []
  const exp = data.expenseSections || []

  // ── Income ──────────────────────────────────────────────────────────────
  const revOpsSec = findSec(inc, /revenue from operation/i)
  const uncatIncSecs = inc.filter(s => /uncategorised/i.test(s.level1 || ''))
  const otherIncSecs = inc.filter(s => s !== revOpsSec && !/uncategorised/i.test(s.level1 || ''))
  const revOps = { cy: revOpsSec?.total || 0, py: revOpsSec?.prevTotal || 0, noteNum: revOpsSec?.noteNum || null }
  const otherInc = {
    cy: otherIncSecs.reduce((s, x) => s + x.total, 0),
    py: otherIncSecs.reduce((s, x) => s + x.prevTotal, 0),
    noteNum: otherIncSecs.find(x => x.noteNum)?.noteNum || null,
  }
  const uncatInc = {
    cy: uncatIncSecs.reduce((s, x) => s + x.total, 0),
    py: uncatIncSecs.reduce((s, x) => s + x.prevTotal, 0),
  }
  const totalIncomeCY = revOps.cy + otherInc.cy + uncatInc.cy
  const totalIncomePY = revOps.py + otherInc.py + uncatInc.py

  // ── Expenses (7 fixed face lines) ──────────────────────────────────────────
  // "Cost of materials consumed" and "Purchases of Stock-in-Trade" appear as
  // two separate face lines but share one note number (see useFinancials.js's
  // PL note-assignment step, which merges their note — not their section —
  // so noteNum is identical for both while totals stay independent).
  // "Changes in inventories" gets its own separate note.
  const materialsSec = findSec(exp, /^cost of materials consumed/i)
  const purchasesSec = findSec(exp, /^purchases of stock-in-trade/i)
  const changesSec = findSec(exp, /changes in inventories/i)
  // 'Cost of stores and spares consumed' deliberately has no fixed face
  // line — folded into "Other expenses" instead. See useFinancials.js's
  // merge pass.
  const employeeSec = findSec(exp, /employee benefit/i)
  const financeSec = findSec(exp, /finance cost/i)
  const depSec = findSec(exp, /depreciation|amortis/i)
  const exceptionalSec = findSec(exp, /^exceptional item/i)
  const extraordinarySec = findSec(exp, /^extraordinary item/i)
  const taxSec = findSec(exp, /^tax expense$/i)
  const discProfitSec = findSec(exp, /profit.*discontinuing operation/i)
  const discTaxSec = findSec(exp, /tax expense of discontinuing/i)
  const remunerationSec = findSec(exp, /partners.{0,3}remuneration/i)

  const fixedMatched = new Set([
    materialsSec, purchasesSec, changesSec, employeeSec, financeSec, depSec,
    exceptionalSec, extraordinarySec, taxSec, discProfitSec, discTaxSec, remunerationSec,
  ].filter(Boolean))
  const uncatExpSecs = exp.filter(s => /uncategorised/i.test(s.level1 || ''))
  const otherExpSecs = exp.filter(s => !fixedMatched.has(s) && !uncatExpSecs.includes(s))

  const secVal = (s) => ({ cy: s?.total || 0, py: s?.prevTotal || 0, noteNum: s?.noteNum || null, level1: s?.level1 || null })
  const materials = secVal(materialsSec)
  const purchases = secVal(purchasesSec)
  const changes = secVal(changesSec)
  const employee = secVal(employeeSec)
  const finance = secVal(financeSec)
  const depreciation = secVal(depSec)
  const otherExp = {
    cy: otherExpSecs.reduce((s, x) => s + x.total, 0),
    py: otherExpSecs.reduce((s, x) => s + x.prevTotal, 0),
    noteNum: otherExpSecs.find(x => x.noteNum)?.noteNum || null,
  }
  const uncatExp = {
    cy: uncatExpSecs.reduce((s, x) => s + x.total, 0),
    py: uncatExpSecs.reduce((s, x) => s + x.prevTotal, 0),
  }
  const totalExpensesCY = materials.cy + purchases.cy + changes.cy + employee.cy + finance.cy + depreciation.cy + otherExp.cy + uncatExp.cy
  const totalExpensesPY = materials.py + purchases.py + changes.py + employee.py + finance.py + depreciation.py + otherExp.py + uncatExp.py

  const exceptional = secVal(exceptionalSec)
  const extraordinary = secVal(extraordinarySec)
  const remuneration = secVal(remunerationSec)
  // Expense sections carry a credit (a profit) as a negative number: turn it round, so a profit
  // prints as a profit, and the face foots to the profit the Balance Sheet takes (1 Oct 2026).
  const discProfit = (() => { const v = secVal(discProfitSec); return { ...v, cy: -v.cy, py: -v.py } })()
  const discTax = secVal(discTaxSec)

  // Tax expense: 3 fixed template lines (Current tax / Excess-Short provision
  // relating to earlier years / Deferred tax charge-benefit), matched against
  // whatever L2 items exist under "Tax expense" — defaulting to 0 when a
  // matching ledger hasn't been mapped (Schedule III requires the line to
  // always be shown, even at zero).
  //
  // EVERY Tax expense line must land on exactly one face row, or the face stops
  // footing to the tax total that feeds the profit: taxL2 sums ALL lines that
  // match its row (not just the first), and any line matching none of the three
  // (AMT credit entitlement, an Uncategorised line, a CA-named particular)
  // gets a row of its own below.
  const matchedTaxLines = new Set()
  const taxL2 = (rx) => {
    let cy = 0, py = 0
    for (const x of taxSec?.lines || []) {
      if (!rx.test(normalizeLabel(x.level2))) continue
      matchedTaxLines.add(x)
      cy += x.total || 0
      py += x.prevTotal || 0
    }
    return { cy, py }
  }
  const currentTax = taxL2(/^current tax$/i)
  const excessShortTax = taxL2(/excess.*short.*provision|short.*excess.*provision/i)
  const deferredTax = taxL2(/deferred tax/i)
  const otherTaxLines = (taxSec?.lines || []).filter(l => !matchedTaxLines.has(l) && (!isZero(l.total) || !isZero(l.prevTotal)))
  // Manual custom lines (see schema.js's manual_face_lines / the PL screen's
  // "+ Add Line" under Tax expense) — one-off adjustments with no backing TB
  // ledger. Their amounts fold into the section total so Profit After Tax
  // still balances; each also renders as its own line on the face.
  const manualTaxCY = manualTaxLines.reduce((s, l) => s + (parseFloat(l.cy_amount) || 0), 0)
  const manualTaxPY = manualTaxLines.reduce((s, l) => s + (parseFloat(l.py_amount) || 0), 0)
  const taxTotalCY = (taxSec?.total || 0) + manualTaxCY
  const taxTotalPY = (taxSec?.prevTotal || 0) + manualTaxPY

  // ── Roll forward the subtotals ──────────────────────────────────────────
  const V = { cy: totalIncomeCY - totalExpensesCY, py: totalIncomePY - totalExpensesPY }
  const VII = { cy: V.cy - exceptional.cy, py: V.py - exceptional.py }
  const IXbeforeRem = { cy: VII.cy - extraordinary.cy, py: VII.py - extraordinary.py }
  const profitBeforeTax = isSingleOwner
    ? { cy: VII.cy - extraordinary.cy, py: VII.py - extraordinary.py }
    : { cy: IXbeforeRem.cy - remuneration.cy, py: IXbeforeRem.py - remuneration.py }
  const continuingAfterTax = { cy: profitBeforeTax.cy - taxTotalCY, py: profitBeforeTax.py - taxTotalPY }
  const discAfterTax = { cy: discProfit.cy - discTax.cy, py: discProfit.py - discTax.py }
  const grandTotal = { cy: continuingAfterTax.cy + discAfterTax.cy, py: continuingAfterTax.py + discAfterTax.py }

  // ── Assemble items in fixed order; roman numerals assigned sequentially ──
  const items = []
  items.push({ kind: 'row', numbered: true, label: 'Revenue from operations', ...revOps })
  items.push({ kind: 'row', numbered: true, label: 'Other income', ...otherInc })
  if (!isZero(uncatInc.cy) || !isZero(uncatInc.py)) {
    items.push({ kind: 'uncat', label: 'Uncategorised Income', ...uncatInc })
  }
  items.push({ kind: 'total', numbered: true, label: 'Total Income (I+II)', cy: totalIncomeCY, py: totalIncomePY })
  items.push({ kind: 'header', numbered: true, label: 'Expenses:' })
  items.push({ kind: 'sub', alpha: 'a', label: 'Cost of materials consumed', ...materials })
  items.push({ kind: 'sub', alpha: 'b', label: 'Purchases of Stock-in-Trade', ...purchases })
  items.push({ kind: 'sub', alpha: 'c', label: 'Changes in inventories of finished goods, work in progress and stock-in-trade', ...changes })
  items.push({ kind: 'sub', alpha: 'd', label: 'Employee benefits expense', ...employee })
  items.push({ kind: 'sub', alpha: 'e', label: 'Finance costs', ...finance })
  items.push({ kind: 'sub', alpha: 'f', label: 'Depreciation and amortization expense', ...depreciation })
  items.push({ kind: 'sub', alpha: 'g', label: 'Other expenses', ...otherExp })
  if (!isZero(uncatExp.cy) || !isZero(uncatExp.py)) {
    items.push({ kind: 'uncat', label: 'Uncategorised Expenses', ...uncatExp })
  }
  items.push({ kind: 'subtotal', label: 'Total expenses', cy: totalExpensesCY, py: totalExpensesPY })
  // "partners' remuneration" belongs in these captions only where the line exists (not a Proprietorship / Individual).
  const beforeRem = isSingleOwner ? '' : ", partners' remuneration"
  items.push({ kind: 'total', numbered: true, label: `Profit before exceptional and extraordinary items${beforeRem} and tax (III-IV)`, ...V })
  items.push({ kind: 'row', numbered: true, label: 'Exceptional items', ...exceptional })
  items.push({ kind: 'total', numbered: true, label: `Profit before extraordinary items${beforeRem} and tax (V-VI)`, ...VII })
  items.push({ kind: 'row', numbered: true, label: 'Extraordinary items', ...extraordinary })
  if (!isSingleOwner) {
    items.push({ kind: 'total', numbered: true, label: "Profit before partners' remuneration and tax (VII-VIII)", ...IXbeforeRem })
    items.push({ kind: 'row', numbered: true, label: "Partners' remuneration", ...remuneration })
    items.push({ kind: 'total', numbered: true, label: 'Profit before tax (IX-X)', ...profitBeforeTax })
  } else {
    items.push({ kind: 'total', numbered: true, label: 'Profit before tax (VII-VIII)', ...profitBeforeTax })
  }
  items.push({ kind: 'header', numbered: true, label: 'Tax expense:' })
  items.push({ kind: 'sub', alpha: 'a', label: 'Current tax', cy: currentTax.cy, py: currentTax.py })
  items.push({ kind: 'sub', alpha: 'b', label: 'Excess/ Short provision of tax relating to earlier years', cy: excessShortTax.cy, py: excessShortTax.py })
  items.push({ kind: 'sub', alpha: 'c', label: 'Deferred tax charge/ (benefit)', cy: deferredTax.cy, py: deferredTax.py })
  let alphaCode = 'd'.charCodeAt(0)
  for (const l of otherTaxLines) {
    items.push({ kind: 'sub', alpha: String.fromCharCode(alphaCode++), label: l.level2 || 'Tax expense (unclassified)', cy: l.total || 0, py: l.prevTotal || 0 })
  }
  for (const l of manualTaxLines) {
    items.push({ kind: 'manual', id: l.id, alpha: String.fromCharCode(alphaCode++), label: l.label, cy: parseFloat(l.cy_amount) || 0, py: parseFloat(l.py_amount) || 0 })
  }
  items.push({ kind: 'addline', section: 'tax-expense-noncorp' })
  items.push({ kind: 'total', numbered: true, label: 'Profit/(Loss) for the period from continuing operations', ...continuingAfterTax })
  items.push({ kind: 'row', numbered: true, label: 'Profit/(loss) from discontinuing operations', ...discProfit })
  items.push({ kind: 'row', numbered: true, label: 'Tax expense of discontinuing operations', ...discTax })
  items.push({ kind: 'total', numbered: true, label: 'Profit/(loss) from discontinuing operations (after tax)', ...discAfterTax })
  items.push({ kind: 'grandtotal', numbered: true, label: 'Profit/(Loss) for the year', ...grandTotal })

  let ridx = 0
  for (const item of items) {
    if (item.numbered) { item.roman = ROMAN[ridx]; ridx++ }
  }

  return {
    isSingleOwner, items,
    totalIncome: totalIncomeCY, prevTotalIncome: totalIncomePY,
    totalExpenses: totalExpensesCY, prevTotalExpenses: totalExpensesPY,
    netProfit: grandTotal.cy, prevNetProfit: grandTotal.py,
  }
}
