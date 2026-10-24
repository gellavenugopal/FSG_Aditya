// ── Financial Ratios Excel round-trip — blank template + filled snapshot ───
// Same pattern as DepreciationIT/depITWorkbook.js: "Blank" is a generic,
// reusable template with just the fixed Particulars/Numerator/Denominator
// wording and no figures — safe to hand out for any Company. "Filled" is
// a snapshot of whatever the Financial Ratios point currently shows
// (computed or hand-typed), so a CA can review/adjust the Numerator Value,
// Denominator Value, Current Year, Previous Year and Variance % figures in
// Excel rather than in the table's small cells, then upload the edited file
// back — only the Financial Ratios point is rebuilt from it, nothing else
// in the note is touched.
import * as XLSX from 'xlsx-js-style'
import { RATIO_ROWS_META } from '../../utils/ratios'

const HEADER_ROW = ['Particulars', 'Numerator', 'Numerator Value', 'Denominator', 'Denominator Value', 'Current Year', 'Previous Year', 'Variance %']
const COL_WIDTHS = [{ wch: 34 }, { wch: 30 }, { wch: 16 }, { wch: 34 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 12 }]
const NOTE_TEXT =
  'Note: Current Year / Previous Year for a ratio, and turnover ratios, are decimal multiples (e.g. 1.81), not percentages. ' +
  'Rows for percentage ratios (Return on Equity, Net Profit, Return on Capital Employed, Return on Investment) should be entered as a plain number, ' +
  'e.g. 9.13 for 9.13% — leave the Variance % column blank to have it recomputed from Current Year and Previous Year on upload, or fill it in to override.'

// `ratios` is computeRatios()'s output, or null for a fully blank template.
function rowsFromRatios(ratios) {
  return RATIO_ROWS_META.map(m => {
    const r = ratios ? ratios.find(x => x.key === m.key) : null
    if (!r) return [m.label, m.numeratorLabel, '', m.denominatorLabel, '', '', '', '']
    const pct = (v) => (v === null || v === undefined) ? '' : (m.format === 'percent' ? v * 100 : v)
    return [
      m.label, m.numeratorLabel, r.numeratorValue ?? '',
      m.denominatorLabel, r.denominatorValue ?? '',
      pct(r.cy), pct(r.py), r.variancePct ?? '',
    ]
  })
}

function buildWorkbook(ratios, sheetName) {
  const wb = XLSX.utils.book_new()
  const aoa = [HEADER_ROW, ...rowsFromRatios(ratios), [], [NOTE_TEXT]]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = COL_WIDTHS
  ws['!merges'] = [{ s: { r: aoa.length - 1, c: 0 }, e: { r: aoa.length - 1, c: 7 } }]
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  return wb
}

export function buildRatioBlankTemplate() {
  return buildWorkbook(null, 'Financial Ratios')
}

export function buildRatioFilledWorkbook(ratios) {
  return buildWorkbook(ratios, 'Financial Ratios')
}

// A blank/unreadable/missing cell -> null (rendered blank, same as an
// un-computed ratio); a plain number passes through; an Indian-grouped
// string ("1,23,456.00") or a percentage string ("9.13%") is stripped down
// to its number first.
function parseNum(v) {
  if (v === '' || v === null || v === undefined) return null
  if (typeof v === 'number') return isNaN(v) ? null : v
  const s = String(v).trim().replace(/,/g, '').replace(/%$/, '')
  if (s === '') return null
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

/**
 * Reads an uploaded Financial Ratios workbook back into the same row shape
 * computeRatios() returns, keyed off RATIO_ROWS_META so the result always
 * has all 11 rows in the fixed order — a row not found in the file (e.g.
 * its Particulars cell was renamed or deleted) comes back blank rather
 * than dropped, and is listed in `unmatched` so the caller can warn about
 * it. Rows matched by the Particulars column, case-insensitive/trimmed —
 * reordering rows in Excel is fine; renaming one is not.
 */
export function parseRatioWorkbook(wb) {
  const sheetName = wb.SheetNames.find(n => n.startsWith('Financial Ratios')) || wb.SheetNames[0]
  const ws = wb.Sheets[sheetName]
  if (!ws) return { rows: RATIO_ROWS_META.map(m => ({ ...m, numeratorValue: null, denominatorValue: null, cy: null, py: null, variancePct: null })), matched: 0, unmatched: RATIO_ROWS_META.map(m => m.label), extraRows: [] }

  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  const dataRows = aoa.slice(1).filter(r => (r[0] || '').toString().trim() && !/^note:/i.test((r[0] || '').toString().trim()))
  const byLabel = new Map(dataRows.map(r => [(r[0] || '').toString().trim().toLowerCase(), r]))

  const unmatched = []
  const rows = RATIO_ROWS_META.map(m => {
    const r = byLabel.get(m.label.toLowerCase())
    if (!r) {
      unmatched.push(m.label)
      return { ...m, numeratorValue: null, denominatorValue: null, cy: null, py: null, variancePct: null }
    }
    const cyRaw = parseNum(r[5])
    const pyRaw = parseNum(r[6])
    const cy = cyRaw === null ? null : (m.format === 'percent' ? cyRaw / 100 : cyRaw)
    const py = pyRaw === null ? null : (m.format === 'percent' ? pyRaw / 100 : pyRaw)
    const variancePctFromFile = parseNum(r[7])
    const variancePct = variancePctFromFile !== null
      ? variancePctFromFile
      : (cy !== null && py !== null && py !== 0) ? ((cy - py) / Math.abs(py)) * 100 : null
    return { ...m, numeratorValue: parseNum(r[2]), denominatorValue: parseNum(r[4]), cy, py, variancePct }
  })

  const knownLabels = new Set(RATIO_ROWS_META.map(m => m.label.toLowerCase()))
  const extraRows = dataRows
    .map(r => (r[0] || '').toString().trim())
    .filter(name => name && !knownLabels.has(name.toLowerCase()))

  return { rows, matched: RATIO_ROWS_META.length - unmatched.length, unmatched, extraRows }
}
