// The Short-term borrowings note carries the "Current maturities of long-term borrowings" (from the Long-term borrowings Fill Details) as
// its own line, CY and PY. The Fill Details table of that note (PDF / Excel) is built from the loans saved on its form, which may have been
// saved before - or without - the Previous Year figure, so it showed the current maturities for the Current Year only and its total fell short
// of the note. This brings the table into line with the note: a loan row that is the current maturities (same Current Year amount) gets
// the missing Previous Year / Current Year figure; if no row is, one is added.
const num = (v) => parseFloat(v) || 0
const isStbTitle = (t) => /short.term borrow/i.test(t || '')

export function withStbCurrentMaturities(details, note) {
  if (!details || !note || !isStbTitle(note.title)) return details
  const cmRow = (note.rows || []).find(r => r && r.injected === 'current-maturities')
  if (!cmRow) return details
  const cy = Math.abs(num(cmRow.closing_balance)), py = Math.abs(num(cmRow.opening_balance))
  if (cy < 0.005 && py < 0.005) return details
  const loans = Array.isArray(details.loans) ? details.loans : []
  const near = (a, b) => Math.abs(a - b) < 0.5
  const i = loans.findIndex(l => (cy > 0.005 && near(num(l.grossCY), cy)) || (py > 0.005 && near(num(l.grossPY), py)))
  if (i >= 0) {
    const l = loans[i]
    const fixed = { ...l, grossCY: num(l.grossCY) < 0.005 ? cy : l.grossCY, grossPY: num(l.grossPY) < 0.005 ? py : l.grossPY }
    if (fixed.grossCY === l.grossCY && fixed.grossPY === l.grossPY) return details
    return { ...details, loans: loans.map((x, k) => k === i ? fixed : x) }
  }
  const added = {
    id: 'current-maturities', tbLedger: 'Current maturities of long-term borrowings', lenderPrintName: 'Current maturities of long-term borrowings',
    nature: 'Current maturities of long-term borrowings', securedUnsecured: '', grossCY: cy, grossPY: py,
    repaymentFormat: 'tabular', securityFormat: 'tabular',
  }
  return { ...details, loans: [...loans, added] }
}
