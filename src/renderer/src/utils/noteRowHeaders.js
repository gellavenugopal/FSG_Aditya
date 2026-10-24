// Print / Excel only: how a Balance Sheet note's template rows (note.templateRows
// — a Level 3 line followed by its Level 4 / 5 / 6 breakdown) are laid out, so
// a note shows NO in-note subtotals. The Notes screen keeps its own layout and
// does not use this.
//
// A Level 3 line whose breakdown adds up to it (Current AND Previous Year)
// prints as a header with a blank amount; its breakdown lines carry the
// figures, and the note's Total is the sum of those lines.
//
// A Level 3 can carry more than one breakdown of the SAME figure — e.g.
// "Statutory dues payable" split by Level 4 (GST payable / TDS payable / PF and
// ESI payable) and again by Level 5 values the ledgers still hold (EPF Payable
// / GST Payable / TDS Payable). Printed together every amount appeared two or
// three times. Only the first complete breakdown is printed (Level 4 before
// 5 before 6); the repeats are dropped.
//
// When no breakdown adds up to the Level 3 figure exactly, nothing is hidden:
// the Level 3 keeps its amount and its lines print as before, flagged
// `breakdown` (an analysis of the figure above, not added again).

const same = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.005

export function printNoteRows(rows) {
  // Cash & Bank's "Other Details … included above" rows are the Notes screen's
  // copy of that Fill Details table. Print has the table itself below the
  // note, so here they printed the same items a second time, inside the note
  // (30 Sep 2026).
  rows = (rows || []).filter(r => !r.isCashBank && !r.isCashBankHeader)
  const out = []
  let i = 0
  while (i < rows.length) {
    const r = rows[i]
    if (r.type !== 'l3') { out.push(r); i++; continue }
    let j = i + 1
    while (j < rows.length && rows[j].type !== 'l3') j++
    const kids = rows.slice(i + 1, j)
    i = j
    if (!kids.length) { out.push(r); continue }
    // MSME principal/interest tables, subtotal lines, highlighted rows: laid
    // out as their own renderers intend — left alone.
    if (r.isSubtotal || r.isHighlight || kids.some(k => k.isSubtotal || k.isMSME)) {
      out.push(r, ...kids)
      continue
    }
    // Consecutive runs of one kind = one breakdown: options by the level they
    // split on (fieldKey), each fixed-label Level 4 on its own.
    const groups = []
    for (const k of kids) {
      const key = k.type === 'l4' ? `l4:${groups.length}` : (k.fieldKey || 'option')
      const last = groups[groups.length - 1]
      if (last && last.key === key && k.type !== 'l4') last.rows.push(k)
      else groups.push({ key, rows: [k] })
    }
    const full = groups.find(g =>
      same(g.rows.reduce((s, k) => s + (Number(k.cy) || 0), 0), r.cy) &&
      same(g.rows.reduce((s, k) => s + (Number(k.py) || 0), 0), r.py))
    if (full) {
      out.push({ ...r, header: true }, ...full.rows.map(k => ({ ...k, underHeader: true })))
    } else {
      out.push(r, ...kids.map(k => ({ ...k, breakdown: true })))
    }
  }
  return out
}
