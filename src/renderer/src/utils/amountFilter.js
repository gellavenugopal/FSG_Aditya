// ── Amount filter typed into a column's filter box ─────────────────────────
// One syntax for every amount column (Rectification CY / PY, Mapped TB, Mapped
// TB with Remarks), asked for by the CA on 30 Sep 2026:
//
//   >100000   <500   >=1000   <=1000   =224  (or just 224)
//   1000-5000   1000 to 5000   between 1000 and 5000   (both ends included)
//   <0        balances shown negative (the other side from normal)
//
// Figures are compared as the column shows them (sign included); commas, ₹ and
// spaces are ignored, so "1,00,000" works. An equality match allows for paise
// rounding (half a paisa).
const NUM = '(-?\\d*\\.?\\d+)'
const clean = (s) => String(s || '').replace(/[,₹\s]/g, '').toLowerCase()

/**
 * @returns null when the box is empty, { invalid: true } when it can't be
 *   read, else { test(value) → boolean, label }.
 */
export function parseAmountFilter(text) {
  const raw = String(text || '').trim()
  if (!raw) return null
  const t = clean(raw).replace(/^between/, '')
  let m = t.match(new RegExp(`^(>=|<=|>|<|=)?${NUM}$`))
  if (m) {
    const op = m[1] || '=', v = parseFloat(m[2])
    const test = {
      '>': (n) => n > v + 0.005, '<': (n) => n < v - 0.005,
      '>=': (n) => n >= v - 0.005, '<=': (n) => n <= v + 0.005,
      '=': (n) => Math.abs(n - v) < 0.005,
    }[op]
    return { test, label: `${op} ${v}` }
  }
  m = t.match(new RegExp(`^${NUM}(?:to|and|\\.\\.|–|-)${NUM}$`))
  if (m) {
    const a = parseFloat(m[1]), b = parseFloat(m[2])
    const lo = Math.min(a, b), hi = Math.max(a, b)
    return { test: (n) => n >= lo - 0.005 && n <= hi + 0.005, label: `${lo} to ${hi}` }
  }
  return { invalid: true }
}

/** true when `value` passes the filter typed as `text` (an empty or unreadable box passes everything). */
export function amountPasses(text, value) {
  const f = parseAmountFilter(text)
  if (!f || f.invalid) return true
  const n = typeof value === 'number' ? value : parseFloat(value)
  return Number.isFinite(n) && f.test(n)
}

export const AMOUNT_FILTER_HELP = 'Type >100000, <500, >=1000, =224, 1000-5000 or 1000 to 5000; <0 for negative figures'

/**
 * ag-grid column settings giving an amount column this filter in its floating
 * filter box. `divisor` returns what the column's figures are shown divided by
 * (Lakhs / Crores), so the filter reads the figure as displayed.
 */
export function agAmountFilter(divisor = () => 1) {
  return {
    filter: 'agTextColumnFilter',
    filterParams: {
      filterOptions: ['contains'],
      maxNumConditions: 1,
      trimInput: true,
      debounceMs: 250,
      textFormatter: (v) => (v == null ? '' : String(v)),
      textMatcher: ({ value, filterText }) => {
        const f = parseAmountFilter(filterText)
        if (!f || f.invalid) return true
        const n = parseFloat(value)
        return Number.isFinite(n) && f.test(n / (divisor() || 1))
      },
    },
    suppressFloatingFilterButton: true,
    headerTooltip: AMOUNT_FILTER_HELP,
  }
}
