// ── The Financial Ratios table inside Significant Accounting Policies ──────
// The table used to be written into the note once — when the note was first
// created — and then sat there, so the printed ratios disagreed with the
// Balance Sheet (CA, 30 Sep 2026). It is brought up to date from the
// financial statements every time the note is opened and every time the PDF /
// Excel is generated (refreshRatiosInNote). Only the table in the "Financial
// Ratios" point is touched; every other point, any text around the table and
// the Comments on Ratios paragraphs are left exactly as written.
//
// Whatever the CA types into a figure cell is theirs and is kept — Numerator
// Value, Denominator Value, Current Year, Previous Year or Variance % (1 Oct
// 2026: a typed Previous Year ratio, or a corrected Current Year one, was
// overwritten by the next refresh and never reached the PDF). A cell counts as
// typed when it no longer holds what the tool last wrote there
// (note.ratioAutoSnapshot[key].cells). Typed cells show violet; a Current Year
// ratio is worked out from typed Numerator / Denominator Values, and Variance
// from the Current and Previous Year figures in the row, unless typed too.
//
// No DOM here, so the PDF / Excel path can use it under Node as well.
import { computeRatios, fmtRatioCell, fmtVariance, fmtRatioAmount, RATIO_ROWS_META } from './ratios'

// Blue = read straight off the Balance Sheet / P&L. Amber = a best-effort
// default (no reliable source for part of the figure). Violet = typed by the CA.
export const RATIO_AUTO_STYLE = 'background-color:#eff6ff'
export const RATIO_ESTIMATE_STYLE = 'background-color:#fffbeb'
export const RATIO_OVERRIDE_STYLE = 'background-color:#f5f3ff'

export const RATIOS_TABLE_HEADERS = ['Particulars', 'Numerator', 'Numerator Value', 'Denominator', 'Denominator Value', 'Current Year', 'Previous Year', 'Variance %']
// The figure cells, by column position in the table.
const FIGS = [['num', 2], ['den', 4], ['cy', 5], ['py', 6], ['var', 7]]

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const thCell = (text) => `<th><p><strong>${text}</strong></p></th>`
const tdCell = (text, style) => `<td${style ? ` style="${style}"` : ''}><p>${text}</p></td>`
const trRow = (cells) => `<tr>${cells.join('')}</tr>`

/** The figure texts a ratio row prints, as the tool computes them. */
function autoCells(r) {
  return {
    num: fmtRatioAmount(r.numeratorValue), den: fmtRatioAmount(r.denominatorValue),
    cy: fmtRatioCell(r.cy, r.format), py: fmtRatioCell(r.py, r.format), var: fmtVariance(r.variancePct),
  }
}

/**
 * `ratios`: computeRatios() rows, optionally carrying `cells` (the texts to
 * print, see mergeRatios) and `typed` (which of them the CA typed). null = the
 * blank hand-fillable template.
 */
export function buildRatiosTableHtml(ratios) {
  if (!ratios) {
    return `<table><tbody>${trRow(RATIOS_TABLE_HEADERS.map(thCell))}${RATIO_ROWS_META.map(m =>
      trRow([m.label, m.numeratorLabel, '', m.denominatorLabel, '', '', '', ''].map(c => tdCell(c)))).join('')}</tbody></table>`
  }
  const rows = ratios.map(r => {
    const cells = r.cells || autoCells(r)
    const typed = r.typed || {}
    const base = r.isEstimate ? RATIO_ESTIMATE_STYLE : RATIO_AUTO_STYLE
    const st = (k) => ((typed[k] || (r.isOverride && (k === 'num' || k === 'den'))) ? RATIO_OVERRIDE_STYLE : base)
    return [
      tdCell(esc(r.label)), tdCell(esc(r.numeratorLabel)),
      tdCell(esc(cells.num), st('num')),
      tdCell(esc(r.denominatorLabel)),
      tdCell(esc(cells.den), st('den')),
      tdCell(esc(cells.cy), st('cy')), tdCell(esc(cells.py), st('py')), tdCell(esc(cells.var), st('var')),
    ]
  })
  return `<table><tbody>${trRow(RATIOS_TABLE_HEADERS.map(thCell))}${rows.map(r => trRow(r)).join('')}</tbody></table>`
}

// "1,23,456.00" / "(1,23,456.00)" / "—" -> number|null (inverse of fmtRatioAmount).
export function parseAmountCell(text) {
  const t = (text || '').trim()
  if (!t || t === '—') return null
  const neg = /^\(.*\)$/.test(t)
  const n = parseFloat(t.replace(/[(),]/g, ''))
  if (isNaN(n)) return null
  return neg ? -n : n
}
// "18.42%" -> 0.1842 for a percent ratio, "2.35" -> 2.35 otherwise; null if not a figure.
function parseRatioCell(text, format) {
  const t = String(text || '').trim()
  if (!t) return null
  const n = parseFloat(t.replace(/[%,\s]/g, ''))
  if (isNaN(n)) return null
  return format === 'percent' || /%$/.test(t) ? n / 100 : n
}

const cellText = (html) => String(html || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim()

// Each data row's figure texts, row by row (header row skipped), read
// positionally — same column order as above. null when there is no table.
export function parseRatiosTableFromHtml(html) {
  const table = String(html || '').match(/<table[\s\S]*?<\/table>/)
  if (!table) return null
  const rows = [...table[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].slice(1)
  if (!rows.length) return null
  return rows.map(m => {
    const cells = [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(c => cellText(c[1]))
    const texts = Object.fromEntries(FIGS.map(([k, i]) => [k, cells[i] ?? '']))
    return { texts, numeratorValue: parseAmountCell(texts.num), denominatorValue: parseAmountCell(texts.den) }
  })
}

export function buildRatioSnapshot(ratios) {
  const snap = {}
  for (const r of ratios || []) snap[r.key] = { numeratorValue: r.numeratorValue, denominatorValue: r.denominatorValue, cells: r.cells || autoCells(r) }
  return snap
}

const numsDiffer = (a, b) => Math.abs((a || 0) - (b || 0)) > 0.5
const safeDiv = (n, d) => (!d ? null : n / d)

/**
 * Fresh ratios merged with what the table holds. Each figure cell the CA
 * typed is kept as typed; the rest take the fresh figures (Current Year from
 * typed Numerator / Denominator Values when those were typed; Variance from
 * the row's Current / Previous Year). Snapshots saved before 1 Oct 2026 carry
 * no cell texts: there a cell counts as typed when it holds a figure other
 * than the fresh one (Numerator / Denominator by the old numeric snapshot).
 * @returns {{ ratios, snapshot }}
 */
export function mergeRatios(fresh, currentRows, snapshot = {}) {
  const next = {}
  const ratios = fresh.map((f, i) => {
    const cur = currentRows?.[i]
    const snap = snapshot[f.key]
    const auto = autoCells(f)
    const typed = {}
    if (cur) {
      for (const [k] of FIGS) {
        const now = (cur.texts?.[k] ?? '').trim()
        if (snap?.cells) typed[k] = now !== String(snap.cells[k] ?? '').trim()
        else if (k === 'num' || k === 'den') {
          const v = k === 'num' ? cur.numeratorValue : cur.denominatorValue
          const s = k === 'num' ? snap?.numeratorValue : snap?.denominatorValue
          typed[k] = !!(snap && numsDiffer(v, s))
        } else if (k === 'cy') {
          // The tool wrote Numerator ÷ Denominator here — the row's own, or
          // (Numerator / Denominator typed since) the ones it last filled in.
          const wrote = [fmtRatioCell(safeDiv(cur.numeratorValue, cur.denominatorValue), f.format)]
          if (snap) wrote.push(fmtRatioCell(safeDiv(snap.numeratorValue, snap.denominatorValue), f.format))
          typed.cy = !!now && !wrote.includes(now)
        } else if (k === 'py') typed.py = !!now && now !== auto.py
        else typed.var = false   // worked out from the row; recomputed
      }
    }
    const cells = { ...auto }
    let numV = f.numeratorValue, denV = f.denominatorValue
    if (typed.num) { cells.num = cur.texts.num; numV = cur.numeratorValue }
    if (typed.den) { cells.den = cur.texts.den; denV = cur.denominatorValue }
    let cyV = f.cy
    if (typed.cy) { cells.cy = cur.texts.cy; cyV = parseRatioCell(cur.texts.cy, f.format) }
    else if (typed.num || typed.den) { cyV = safeDiv(numV, denV); cells.cy = fmtRatioCell(cyV, f.format) }
    let pyV = f.py
    if (typed.py) { cells.py = cur.texts.py; pyV = parseRatioCell(cur.texts.py, f.format) }
    if (typed.var) cells.var = cur.texts.var
    else cells.var = fmtVariance((cyV !== null && pyV !== null && pyV !== 0) ? ((cyV - pyV) / Math.abs(pyV)) * 100 : null)
    // What the tool itself would print here — the baseline the next refresh
    // compares against (a typed cell keeps differing from it, so stays typed).
    const autoNow = { ...auto, cy: (typed.num || typed.den) && !typed.cy ? cells.cy : auto.cy, var: typed.var ? auto.var : cells.var }
    next[f.key] = { numeratorValue: f.numeratorValue, denominatorValue: f.denominatorValue, cells: autoNow }
    const anyTyped = Object.values(typed).some(Boolean)
    return { ...f, numeratorValue: numV, denominatorValue: denV, cy: cyV, py: pyV, cells, typed, isOverride: anyTyped }
  })
  return { ratios, snapshot: next }
}

/**
 * The General Notes object with its "Financial Ratios" table brought up to
 * date from `data` (useFinancials' processed financials). The same object is
 * returned when there is no such point, nothing to compute from, or nothing
 * changed.
 */
export function refreshRatiosInNote(note, data) {
  if (!note || !Array.isArray(note.points)) return note
  const idx = note.points.findIndex(pt => (pt?.header || '').trim().toLowerCase() === 'financial ratios')
  if (idx < 0) return note
  const fresh = computeRatios(data)
  if (!fresh) return note
  const html = note.points[idx].contentHtml || ''
  const { ratios, snapshot } = mergeRatios(fresh, parseRatiosTableFromHtml(html), note.ratioAutoSnapshot || {})
  const table = buildRatiosTableHtml(ratios)
  const nextHtml = /<table[\s\S]*?<\/table>/.test(html) ? html.replace(/<table[\s\S]*?<\/table>/, () => table) : html + table
  const sameSnap = JSON.stringify(snapshot) === JSON.stringify(note.ratioAutoSnapshot || {})
  if (nextHtml === html && sameSnap) return note
  return { ...note, points: note.points.map((pt, i) => (i === idx ? { ...pt, contentHtml: nextHtml } : pt)), ratioAutoSnapshot: snapshot }
}

/**
 * The Numerator Value / Denominator Value amounts of the Financial Ratios table,
 * in the denomination the statements are printed in (1 Oct 2026: the heading said
 * "Figures in Hundreds" while these printed whole rupees). Done on the way out to
 * PDF / Excel only — the saved note keeps whole rupees, so changing the
 * denomination later needs nothing re-typed. A figure the CA typed (violet) is
 * printed as typed. The ratios themselves (x, %) are unitless and unchanged.
 */
export function scaleRatioAmounts(note, divisor = 1, decimals = 2) {
  if (!note || !Array.isArray(note.points) || !(divisor > 0) || (divisor === 1 && decimals === 2)) return note
  const idx = note.points.findIndex(pt => (pt?.header || '').trim().toLowerCase() === 'financial ratios')
  if (idx < 0) return note
  const html = note.points[idx].contentHtml || ''
  const fmt = (n) => {
    const str = Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    return n < 0 ? `(${str})` : str
  }
  const AMOUNT_COLS = new Set([2, 4])
  let first = true
  const next = html.replace(/<table[\s\S]*?<\/table>/, (table) => table.replace(/<tr[^>]*>[\s\S]*?<\/tr>/g, (tr) => {
    if (first) { first = false; return tr }   // the header row
    let col = -1
    return tr.replace(/(<td([^>]*)>)([\s\S]*?)(<\/td>)/g, (whole, open, attrs, inner, close) => {
      col++
      if (!AMOUNT_COLS.has(col) || attrs.includes(RATIO_OVERRIDE_STYLE.split(':')[1])) return whole
      const n = parseAmountCell(cellText(inner))
      return n === null ? whole : `${open}<p>${esc(fmt(n / divisor))}</p>${close}`
    })
  }))
  if (next === html) return note
  return { ...note, points: note.points.map((pt, i) => (i === idx ? { ...pt, contentHtml: next } : pt)) }
}
