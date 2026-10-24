// ── Cash Flow Statement in Excel ─────────────────────────────────────────────
// The "CFS" sheet of the Fill Details workbook (Notes tab -> Filled Template / Blank Template) and the CFS tab's own Excel:
// the statement as the CFS tab shows it, to be filled in or corrected in Excel and uploaded again.
//
//   Column A  Particulars            (the description of a row you added is read from here)
//   Column B  Current Year           (a figure that differs from the one drawn from the Balance Sheet / P&L overwrites it)
//   Column C  Previous Year
//   Column D  Row ID                 (do not edit - how the upload knows which row is which)
//
// Subtotal and total rows carry no Row ID: they are worked out again, never read.
// Lines marked "New row" (one per activity) take a description and figures and become rows of that activity.
import * as XLSX from 'xlsx-js-style'

export const CFS_SHEET = 'CFS'
export const NEW_ROW_LABEL = 'New row - type the description here'
const HEADER = ['Particulars', 'Current Year', 'Previous Year', 'Row ID (do not edit)']
const SECTION_OF_TOTAL = { s_opbwc: 'A1', s_cgo: 'A2', t_op: 'A', t_inv: 'B', t_fin: 'C' }

const toNum = (v) => {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const t = String(v).trim()
  if (!t) return null
  const neg = /^\(.*\)$/.test(t) || /^-/.test(t)
  const n = parseFloat(t.replace(/[(),\s₹-]/g, ''))
  return Number.isFinite(n) ? (neg ? -n : n) : null
}

// rows: buildCashFlow(...).rows. blank: layout and Row IDs only, no figures.
export function buildCfsAoa(rows, { blank = false, cc = null } = {}) {
  const aoa = [
    ['Cash Flow Statement (AS 3, indirect method)'],
    ['Type over a Current Year figure to overwrite the one drawn from the Balance Sheet and Profit & Loss; type the Previous Year figures. Outflows negative or in brackets. Do not change column D. To add a line, use the "New row" line of that activity.'],
    [],
    HEADER,
  ]
  for (const r of rows) {
    if (r.kind === 'head' || r.kind === 'caption') { aoa.push([r.label]); continue }
    const section = SECTION_OF_TOTAL[r.id]
    if (section) aoa.push([NEW_ROW_LABEL, '', '', `new:${section}`])
    const cy = blank ? '' : (Math.abs(r.cy || 0) < 0.005 ? 0 : r.cy)
    const py = blank ? '' : (Math.abs(r.py || 0) < 0.005 ? 0 : r.py)
    if (r.kind === 'sub' || r.kind === 'total') { aoa.push([r.label, blank ? '' : cy, blank ? '' : py]); continue }
    // an item: calc rows (profit before tax) take a Previous Year figure only; the difference row is never edited
    if (r.id === 'x_diff') { aoa.push([r.label, blank ? '' : cy, '']); continue }
    aoa.push([r.label, cy, py, r.id])
  }
  // Components of cash and cash equivalents (AS 3), reconciled to the Balance Sheet
  if (cc) {
    aoa.push([])
    aoa.push(['Components of cash and cash equivalents (AS 3)'])
    for (const r of cc.rows) aoa.push([r.label, blank ? '' : r.cy, blank ? '' : r.py, r.id])
    aoa.push(['Cash and cash equivalents as above', blank ? '' : cc.totalCY, blank ? '' : cc.totalPY])
    aoa.push(['Cash and cash equivalents as per the Balance Sheet', blank ? '' : cc.bsCY, blank ? '' : cc.bsPY])
  }
  return aoa
}

function sheetFrom(rows, opts) {
  const ws = XLSX.utils.aoa_to_sheet(buildCfsAoa(rows, opts))
  ws['!cols'] = [{ wch: 70 }, { wch: 20 }, { wch: 20 }, { wch: 22 }]
  const range = XLSX.utils.decode_range(ws['!ref'])
  for (let r = 4; r <= range.e.r; r++) for (const c of [1, 2]) {
    const cell = ws[XLSX.utils.encode_cell({ r, c })]
    if (cell && cell.t === 'n') cell.z = '#,##0.00;(#,##0.00);"-"'
  }
  const bold = (addr) => { if (ws[addr]) ws[addr].s = { font: { bold: true } } }
  bold('A1')
  for (let c = 0; c < 4; c++) bold(XLSX.utils.encode_cell({ r: 3, c }))
  return ws
}

// Adds the CFS sheet to an existing workbook (the Fill Details workbook)
export function appendCfsSheet(wb, rows, opts = {}) {
  XLSX.utils.book_append_sheet(wb, sheetFrom(rows, opts), CFS_SHEET)
}
// A workbook of its own (the CFS tab)
export function buildCfsWorkbook(rows, opts = {}) {
  const wb = XLSX.utils.book_new()
  appendCfsSheet(wb, rows, opts)
  return wb
}

// Reads the CFS sheet. null when there is none. any: the sheet has at least one figure (a blank template changes nothing).
export function parseCfsSheet(wb) {
  const name = (wb.SheetNames || []).find(n => n === CFS_SHEET || n.startsWith(CFS_SHEET + ' '))
  if (!name) return null
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' })
  const hdr = aoa.findIndex(r => String(r[3] || '').toLowerCase().startsWith('row id'))
  if (hdr < 0) return null
  const entries = []
  let any = false
  for (const r of aoa.slice(hdr + 1)) {
    const id = String(r[3] == null ? '' : r[3]).trim()
    if (!id) continue
    const cy = toNum(r[1]), py = toNum(r[2])
    if (cy !== null || py !== null) any = true
    const label = String(r[0] == null ? '' : r[0]).trim()
    entries.push({ id, label: label === NEW_ROW_LABEL ? '' : label, cy, py })
  }
  return { entries, any }
}

// What the upload does to what is saved. rowsNow: buildCashFlow(data, saved).rows (they hold the drawn figures).
//   Current Year: a figure that differs from the drawn one becomes an overwrite; one equal to it clears any overwrite; an empty cell changes nothing.
//   Previous Year: the figure; an empty cell clears it.
//   Added rows: the rows in the sheet are the rows (one missing from the sheet is removed); a "New row" line with a description or figure adds one.
export function applyCfsUpload(parsed, rowsNow, saved) {
  const next = { cy: { ...(saved?.cy || {}) }, py: { ...(saved?.py || {}) }, custom: [], hidden: [...(saved?.hidden || [])], include: !!saved?.include, ccNote: saved?.ccNote || '' }
  const drawn = new Map(rowsNow.filter(r => r.drawn !== null && r.drawn !== undefined).map(r => [r.id, r.drawn]))
  const known = new Map(rowsNow.filter(r => r.kind === 'item' && !r.custom).map(r => [r.id, r]))
  const oldCustom = new Map((saved?.custom || []).map(c => [`u_${c.id}`, c]))
  let changed = 0
  const bump = () => { changed++ }
  for (const e of parsed.entries) {
    if (e.id.startsWith('new:')) {
      const section = e.id.slice(4)
      if (!/^(A1|A2|A|B|C)$/.test(section) || (!e.label && e.cy === null && e.py === null)) continue
      next.custom.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), section, label: e.label, cy: e.cy ?? 0, py: e.py ?? 0 })
      bump(); continue
    }
    if (e.id.startsWith('u_')) {
      const old = oldCustom.get(e.id)
      if (!old) continue
      const upd = { ...old, label: e.label || old.label, cy: e.cy ?? 0, py: e.py ?? 0 }
      next.custom.push(upd)
      oldCustom.delete(e.id)
      if (upd.label !== old.label || upd.cy !== old.cy || upd.py !== old.py) bump()
      continue
    }
    const row = known.get(e.id)
    if (!row) continue
    // a nil Previous Year figure that was never typed is not saved (the sheet shows every untyped figure as nil)
    if (e.py === null) { if (e.id in next.py) { delete next.py[e.id]; bump() } }
    else if (e.id in next.py ? next.py[e.id] !== e.py : e.py !== 0) { next.py[e.id] = e.py; bump() }
    if (row.calc || e.cy === null) continue
    const d = drawn.get(e.id)
    if (d !== undefined && Math.abs(e.cy - d) < 0.5) { if (e.id in next.cy) { delete next.cy[e.id]; bump() } }
    else if (next.cy[e.id] !== e.cy) { next.cy[e.id] = e.cy; bump() }
  }
  for (const left of oldCustom.values()) { void left; bump() }   // rows left out of the sheet are removed
  return { saved: next, changed }
}
