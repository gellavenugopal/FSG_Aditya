// ── Opening & Closing Stock Excel round-trip — blank template + filled snapshot ──
// Same pattern as Dep (IT)'s workbook: "Blank" is a generic reusable template
// (just the 8 category rows + headers); "Filled" is a snapshot of whatever is
// currently on screen, useful as a backup before re-uploading a fresh Trial
// Balance, or simply as a faster way to fill in the Stock tab from Excel
// instead of typing into the grid directly.
//
// 0.1.93: a last column, "Adjusted in (Other Expenses head)", for Stores & Spares,
// Loose Tools and Others - the line of the Other expenses note their Opening and
// Closing stock is adjusted in. A file without that column (an older backup) still
// loads: it simply names no heads, and the Stock tab asks.
import * as XLSX from 'xlsx-js-style'
import { INVENTORY_TYPES, HEAD_TYPES, cleanHead } from './stockHeads'

const HEADER_ROW = ['Type of Inventory', 'Opening (Current Year)', 'Closing (Current Year)', 'Opening (Previous Year)', 'Closing (Previous Year)', 'Adjusted in (Other Expenses head)']
const COL_WIDTHS = [{ wch: 26 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 42 }]
const HEAD_NOTE = 'Note: for Stores & Spares, Loose Tools and Others, type in the last column the line of the Other expenses note their Opening and Closing stock is adjusted in (for example Consumption of stores and spare parts).'

export function buildStockBlankTemplate() {
  const wb = XLSX.utils.book_new()
  const aoa = [HEADER_ROW, ...INVENTORY_TYPES.map(t => [t, '', '', '', '', '']), [], [HEAD_NOTE]]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = COL_WIDTHS
  XLSX.utils.book_append_sheet(wb, ws, 'Stock Template')
  return wb
}

export function buildStockFilledWorkbook(opening, closing, pyOpening, pyClosing, pyEditable, heads = {}) {
  const wb = XLSX.utils.book_new()
  const aoa = [HEADER_ROW]
  for (const type of INVENTORY_TYPES) {
    aoa.push([
      type,
      opening[type] || '', closing[type] || '',
      pyEditable ? (pyOpening[type] || '') : '',
      pyEditable ? (pyClosing[type] || '') : '',
      HEAD_TYPES.includes(type) ? cleanHead((heads || {})[type]) : '',
    ])
  }
  aoa.push([])
  aoa.push([HEAD_NOTE])
  if (!pyEditable) {
    aoa.push(['Note: Previous Year columns are blank — a comparative Trial Balance is currently selected, so PY figures are read-only there, not editable/uploadable here.'])
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = COL_WIDTHS
  XLSX.utils.book_append_sheet(wb, ws, 'Stock Filled')
  return wb
}

/**
 * @param {XLSX.WorkBook} wb
 * @returns {{ opening: Record<string,string>, closing: Record<string,string>, pyOpening: Record<string,string>, pyClosing: Record<string,string>, heads: Record<string,string>, unrecognised: string[] }}
 */
export function parseStockWorkbook(wb) {
  const sheetName = wb.SheetNames.find(n => n.startsWith('Stock')) || wb.SheetNames[0]
  const ws = wb.Sheets[sheetName]
  const result = { opening: {}, closing: {}, pyOpening: {}, pyClosing: {}, heads: {}, unrecognised: [] }
  if (!ws) return result
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  const knownSet = new Set(INVENTORY_TYPES)
  for (const r of aoa.slice(1)) {
    const type = (r[0] || '').toString().trim()
    if (!type) continue
    if (/^note\s*:/i.test(type)) continue
    if (!knownSet.has(type)) { result.unrecognised.push(type); continue }
    if (r[1] !== '' && r[1] != null) result.opening[type] = String(r[1])
    if (r[2] !== '' && r[2] != null) result.closing[type] = String(r[2])
    if (r[3] !== '' && r[3] != null) result.pyOpening[type] = String(r[3])
    if (r[4] !== '' && r[4] != null) result.pyClosing[type] = String(r[4])
    if (HEAD_TYPES.includes(type) && r[5] !== '' && r[5] != null && cleanHead(r[5])) result.heads[type] = cleanHead(r[5])
  }
  return result
}
