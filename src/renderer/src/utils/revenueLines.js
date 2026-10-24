// ── Revenue from operations: "Sale" printed as Sale of Goods / Sale of Services ─
// Mapping_v2 files every sales ledger under one Level 2, "Sale", with the
// nature at Level 3 ("Sale of Products" / "Sale of Services" / "Uncategorised
// Sale"). A P&L note prints one line per Level 2, so the Revenue note showed a
// single "Sale" line where the CA needs Sale of Goods and Sale of Services
// (all constitutions, asked 30 Sep 2026). The split is made where the P&L
// lines are built (useFinancials.js buildSections / buildPrevMap), so the Notes
// screen, PDF, Excel, Annexures and Manual PY all see the same lines.
//
// A sales ledger whose Level 3 is neither stays on a line still captioned
// "Sale" — never guessed into Goods — and the Notes screen asks for it to be
// bifurcated (unsplitSaleLine).
export const SALE_OF_GOODS = 'Sale of Goods'
export const SALE_OF_SERVICES = 'Sale of Services'
export const SALE_UNSPLIT = 'Sale'

const clean = (s) => String(s || '').replace(/\(specify nature\)/i, '').trim()

export function isRevenueFromOperations(level1) {
  return /^revenue from operations?$/i.test(clean(level1))
}

/** The Level 2 a P&L line is built under — `level2` itself for everything but Revenue's "Sale". */
export function revenueLevel2(level1, level2, level3) {
  if (!/^sales?$/i.test(clean(level2)) || !isRevenueFromOperations(level1)) return level2
  const l3 = clean(level3)
  if (/^sale of (products?|goods)$/i.test(l3)) return SALE_OF_GOODS
  if (/^sale of services?$/i.test(l3)) return SALE_OF_SERVICES
  return SALE_UNSPLIT
}

/** Order of the three lines within Revenue from operations (null = not one of them). */
export function revenueLineRank(level2) {
  const i = [SALE_OF_GOODS, SALE_OF_SERVICES, SALE_UNSPLIT].indexOf(String(level2 || '').trim())
  return i < 0 ? null : i
}

/** The Revenue note line still holding sales ledgers not split into Goods / Services, or null. */
export function unsplitSaleLine(note) {
  if (!note || !note.isPL || !isRevenueFromOperations(note.title)) return null
  return (note.lines || []).find(l => l.level2 === SALE_UNSPLIT && (l.rows || []).length > 0) || null
}
