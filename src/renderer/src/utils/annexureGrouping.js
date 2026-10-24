// ── Ledger → Sub-note grouping, shared by the live Annexures UI and the
// Excel export, so both always agree on the same groups/order/totals.
//
// "Sub-note" = the ledger's own existing mapping:
//   - PL notes:  Level 2 (mapping2_resultant / level2) — e.g. "Rent" under
//     "Other Expenses". Notes that already carry a pre-computed `.lines`
//     breakdown (ordinary PL notes with real Level-2 sub-items, and the
//     custom Cost of Materials Consumed / Changes in Inventories / Other
//     Expenses notes built in useFinancials.js) use that directly.
//   - BS notes:  Level 3 (mapping3_resultant / level3).
// Ledgers with no value fall under "Unclassified" — never silently dropped.
//
// Lines flagged `isSubtotal` (e.g. "Change in Inventory of …" — a computed
// Opening-minus-Closing figure, not its own ledger-backed sub-note) are
// EXCLUDED here. Their `.rows` deliberately re-list the same ledgers already
// counted under the Opening/Closing lines (so the live Notes screen's plain
// total display stays correct), which would double them into an Annexures
// sub-note group and inflate the Excel Total if treated as a real group —
// see useFinancials.js's Changes in Inventories / Other Expenses injection.
export const UNCLASSIFIED_LABEL = 'Unclassified'

// The text an Annexure prints for a line the Notes print under a DISPLAY label (note.templateRows[].displayLabel -
// e.g. Reserves and surplus' "Surplus / (Deficit) during the year" when there is no opening balance to add to; see
// useFinancials.js). Display only: the line keeps its own label, which every key and link is built on.
export function annexureDisplayLabels(note) {
  const shown = new Map()
  for (const r of note?.templateRowsAll || note?.templateRows || []) {
    if (r?.displayLabel) shown.set((r.label || '').trim(), r.displayLabel)
  }
  return text => shown.get((text || '').trim()) || text
}

// Purchase Accounts route straight to "Cost of materials consumed" /
// "Purchases of Stock-in-Trade" with no Level 2 at all, by deliberate design
// (mapping-engine.js's applyPurchaseAccountsOverride, chosen by Manufacturer/
// Trader) -- Schedule III shows Purchases as one combined figure there, not
// broken out by GST rate or supplier. That is NOT the same thing as a ledger
// nobody has classified yet, so calling it "Unclassified" was the wrong word
// even though the underlying mechanism (an empty-level2 line with real rows)
// is identical -- give this one specific case its own accurate label instead.
const PURCHASES_NOTE_RX = /cost of materials consumed|purchases of stock-in-trade/i
export function fallbackSubnoteLabel(noteTitle) {
  return PURCHASES_NOTE_RX.test(noteTitle || '') ? 'Purchases' : UNCLASSIFIED_LABEL
}

// ── The lines a P&L note prints ──────────────────────────────────────────────
// One definition for the Notes screen, the PDF and the Excel export. Each used
// to carry its own copy, and the PDF / Excel copies printed only lines WITH a
// Level 2: a "Purchases of Stock-in-Trade" note holding Purchase Accounts (no
// Level 2, by design) plus one other line printed just that other line while
// its total still counted everything — and Excel's Total, summing the printed
// lines, took the P&L's Purchases figure down to that one line (Santosh Kumar
// Gupta, 0.1.33). A line with no Level 2 prints under the fallback label; a
// note none of whose lines has a Level 2 prints no lines, only its total.
export function plNoteShowsLines(note) {
  return !!(note && note.isPL && (note.lines || []).some(l => l.level2))
}
export function isPrintedPlNoteLine(line) {
  const figure = (v) => Math.abs(parseFloat(v) || 0) >= 0.005
  return !!(line && (line.level2 || (line.rows || []).length > 0 || figure(line.total) || figure(line.prevTotal)))
}
export function plNoteLineLabel(note, line) {
  return (line && line.level2) || fallbackSubnoteLabel(note && note.title)
}
export function plNoteLines(note) {
  if (!plNoteShowsLines(note)) return []
  return note.lines.filter(isPrintedPlNoteLine).map(line => ({ line, label: plNoteLineLabel(note, line) }))
}

// ── A Balance Sheet note with no template lines ─────────────────────────────
// One definition for the Notes screen, the PDF and the Excel export: its
// ledgers grouped by Level 3. Ledgers with no Level 3 form no line (the note's
// total still counts them) — the screen always left them out, while the PDF
// and Excel printed them as "(Other)". Previous Year is the comparative Trial
// Balance's figure for the Level 3 (note.pyByL3, see useFinancials.js) when one
// is selected, else the ledgers' opening balances. `amount` is displayAmt.
export function bsNoteFallbackLines(note, amount) {
  const byL3 = new Map()
  for (const row of (note && note.rows) || []) {
    const l3 = String(row.mapping3_resultant || row.level3 || '').trim()
    if (!l3) continue
    if (!byL3.has(l3)) byL3.set(l3, [])
    byL3.get(l3).push(row)
  }
  return [...byL3.entries()].map(([label, rows]) => ({
    label,
    rows,
    cy: rows.reduce((s, r) => s + amount(r, 'closing_balance'), 0),
    py: note.pyByL3 ? (note.pyByL3.get(label) || 0) : rows.reduce((s, r) => s + amount(r, 'opening_balance'), 0),
    isSubtotal: rows.some(r => r.isSubtotal),
  }))
}

// ── The figures an annexure prints for one sub-note group ───────────────────
// One definition for the Annexures screen, the PDF and the Excel export (each
// had its own copy).
//   Current Year: the group's ledgers.
//   Previous Year: a P&L group's own note line (the figure the note's total
//     counts); a Balance Sheet group's figure in the comparative Trial Balance
//     when one is selected (note.pyByL3 — the figure its note line shows);
//     otherwise the ledgers' opening balances. null when there is none.
// A "Less: …" group (Less: Closing Stock) shows both years as the stock itself,
// as its ledgers do — the note subtracts it. Its Previous Year used to print
// already negated beside a positive Current Year, and Excel, subtracting the
// group again, added last year's closing stock into Changes in inventories
// (Santosh Kumar Gupta, 0.1.35). `amount` is displayAmt.
export const isLessLabel = (label) => /^less:/i.test(String(label || '').trim())
export function subnoteGroupFigures(note, group, { amount, hasSeparatePYTB = false, prevMapL3 = null } = {}) {
  const cy = group.rows.reduce((s, r) => s + amount(r, 'closing_balance'), 0)
  let py
  if (group.linePrevTotal !== undefined) {
    py = isLessLabel(group.label) ? -group.linePrevTotal : group.linePrevTotal
  } else if (hasSeparatePYTB) {
    if (note && note.pyByL3) {
      py = note.pyByL3.get(group.label === UNCLASSIFIED_LABEL ? '' : String(group.label || '').trim()) || 0
    } else {
      const l3Key = `${(note && note.alie) || ''}|${((note && note.level1) || 'Uncategorised').trim().toLowerCase()}|${((note && note.title) || '').trim().toLowerCase()}|${(group.label || '').trim().toLowerCase()}`
      py = prevMapL3?.get(l3Key) ?? null
    }
  } else {
    py = group.rows.reduce((s, r) => s + amount(r, 'opening_balance'), 0)
  }
  return { cy, py }
}

// Sub-note lines only the Previous Year Trial Balance has — no Current Year
// ledger, so no ledger group to list them under — though their figure is in
// the note's Previous Year total. The PDF and Excel annexures give each a line
// of its own so the groups add up to that total: Excel's Annexures Total is
// their SUM, and it dropped e.g. a last-year-only "Advance from Customers"
// (figures self-test, 0.1.71). Figures as subnoteGroupFigures gives them (a
// "Less: …" line shown as the stock itself). Only with a separate PY TB —
// otherwise a line's Previous Year is its own ledgers' opening balances.
export function pyOnlySubnoteLines(note, shownGroups, levelFormat = []) {
  if (!note) return []
  const keyOf = (label) => (label === UNCLASSIFIED_LABEL ? '' : String(label || '').trim())
  const shown = new Set((shownGroups || []).map(g => keyOf(g.label)))
  const out = []
  if (note.isPL) {
    for (const g of getSubnoteGroups(note, levelFormat)) {
      if (g.linePrevTotal === undefined || shown.has(keyOf(g.label))) continue
      const py = isLessLabel(g.label) ? -g.linePrevTotal : g.linePrevTotal
      if (Math.abs(Number(py) || 0) >= 0.005) out.push({ label: g.label, py })
    }
  } else if (note.pyByL3) {
    for (const [l3, py] of note.pyByL3) {
      if (shown.has(l3) || Math.abs(Number(py) || 0) < 0.005) continue
      out.push({ label: l3 || note.title, py })
    }
  }
  return out
}

export function getSubnoteGroups(note, levelFormat = []) {
  if (!note) return []

  if (note.isPL && note.lines && note.lines.some(l => l.level2)) {
    // A ledger mapped straight to this note's Level 1 with no Level 2 at all
    // is real and deliberate, not a mistake — e.g. Purchase Accounts route
    // to "Cost of materials consumed" / "Purchases of Stock-in-Trade" with
    // mapping2_resultant left NULL (see mapping-engine.js's
    // applyPurchaseAccountsOverride, chosen by Manufacturer/Trader). Such a
    // ledger still lands in one of `note.lines` (buildSections buckets it
    // under level2: '' — see useFinancials.js), and its figure is already in
    // note.total/the Annexure's own total either way. The bug this guards
    // against: `l.level2 && …` treated an empty label as "drop this line
    // entirely," so its ledger names/values silently never reached the
    // Annexure though the total already counted them — same gap the Notes
    // screen's own PL line rendering has (see Notes/index.jsx).
    return note.lines
      .filter(l => !l.isSubtotal && (l.level2 || (l.rows || []).length > 0))
      .map(line => ({
        label: line.level2 || fallbackSubnoteLabel(note.title),
        rows: line.rows || [],
        lineTotal: line.total,
        linePrevTotal: line.prevTotal,
      }))
  }

  // Some notes (e.g. Owners'/Partners' Capital Account, Purchases of
  // Stock-in-Trade, Partners' Remuneration) never have a Level 3 (BS) /
  // Level 2 (PL) sub-note option defined in Mapping Rules at all — every
  // ledger under them is structurally flat, not actually mis-mapped. Only
  // flag/label a ledger UNCLASSIFIED when a real option exists for this
  // note's Level1 (PL) / Level2 (BS) somewhere in LevelFormat and simply
  // wasn't picked for that specific ledger — a genuine gap worth fixing.
  const hasSubnoteOption = note.isPL
    ? levelFormat.some(lf => lf.level1 === note.title && (lf.level2 || '').trim())
    : levelFormat.some(lf => lf.level2 === note.title && (lf.level3 || '').trim())

  const keyOf = (row) => {
    const v = note.isPL
      ? (row.mapping2_resultant || row.level2)
      : (row.mapping3_resultant || row.level3)
    const trimmed = (v || '').trim()
    if (trimmed) return trimmed
    return hasSubnoteOption ? UNCLASSIFIED_LABEL : ''
  }

  const groups = new Map()
  for (const row of note.rows || []) {
    const key = keyOf(row)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }

  const result = [...groups.entries()]
    .map(([label, rows]) => ({ label, rows }))
    .sort((a, b) => {
      if (a.label === UNCLASSIFIED_LABEL) return 1
      if (b.label === UNCLASSIFIED_LABEL) return -1
      return a.label.localeCompare(b.label)
    })

  // A P&L note none of whose lines has a Level 2 still has its lines: each
  // group carries its line's figures, so its Previous Year is the one the
  // note's total counts. Without them the group had no Previous Year once a
  // comparative Trial Balance was selected, and Excel, adding the groups up,
  // showed last year's Purchases of Stock-in-Trade as 0.00 against 11,16,882.00
  // in the PDF (Santosh Kumar Gupta, 0.1.34).
  if (note.isPL && Array.isArray(note.lines)) {
    for (const g of result) {
      const key = g.label === UNCLASSIFIED_LABEL ? '' : g.label.trim().toLowerCase()
      const lines = note.lines.filter(l => !l.isSubtotal && (l.level2 || '').trim().toLowerCase() === key)
      if (!lines.length) continue
      g.lineTotal = lines.reduce((s, l) => s + (Number(l.total) || 0), 0)
      g.linePrevTotal = lines.reduce((s, l) => s + (Number(l.prevTotal) || 0), 0)
    }
  }
  return result
}
