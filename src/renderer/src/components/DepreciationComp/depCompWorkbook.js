// ── Dep (Comp) Excel round-trip — category-level fillable-form template ─────
// One row per Asset Category (not per ledger) — every figure is a plain
// typed value, nothing computed (see DepreciationComp/index.jsx's file
// header comment). "Blank" is a generic, reusable template (headers + a
// Schedule II category-name reference sheet). "Filled" is a snapshot of the
// CURRENT category rows, for backup/restore across a Trial Balance
// re-upload (dep_comp_schedules is keyed by tb_id, so a fresh TB starts
// empty) — rows are matched back by Asset Category name.
import * as XLSX from 'xlsx-js-style'

const HEADER_ROW = [
  'Asset Category', 'Gross Opening', 'Additions', 'Deductions', 'Gross Closing',
  'Depreciation Opening', 'Depreciation For Year', 'Depreciation On Disposal', 'Depreciation Closing',
  'Net Block Opening', 'Net Block Closing',
]
const COL_WIDTHS = [
  { wch: 40 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 16 },
  { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 16 }, { wch: 16 },
]
const FIELDS = ['grossOpen', 'additions', 'deductions', 'grossClose', 'depOpen', 'depForYear', 'depOnDisposal', 'depClose', 'netBlockOpen', 'netBlockClose']

function scheduleIIReferenceSheet(scheduleII) {
  const aoa = [['Asset Category (type exactly as shown here into the "Asset Category" column)']]
  for (const r of scheduleII || []) aoa.push([r.category])
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 55 }]
  return ws
}

export function buildDepCompBlankTemplate(scheduleII) {
  const wb = XLSX.utils.book_new()
  const aoa = [HEADER_ROW, Array(HEADER_ROW.length).fill('')]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = COL_WIDTHS
  XLSX.utils.book_append_sheet(wb, ws, 'Dep (Comp) Template')
  XLSX.utils.book_append_sheet(wb, scheduleIIReferenceSheet(scheduleII), 'Schedule II Reference')
  return wb
}

export function buildDepCompFilledWorkbook(categoryRows, scheduleII) {
  const wb = XLSX.utils.book_new()
  const aoa = [HEADER_ROW]
  for (const r of categoryRows || []) {
    aoa.push([r.category || '', ...FIELDS.map(f => r[f] || '')])
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = COL_WIDTHS
  XLSX.utils.book_append_sheet(wb, ws, 'Dep (Comp) Filled')
  XLSX.utils.book_append_sheet(wb, scheduleIIReferenceSheet(scheduleII), 'Schedule II Reference')
  return wb
}

// Appends a blank Dep (Comp) template sheet + Schedule II reference sheet
// onto an already-built workbook — used to merge the template into the
// Notes tab's consolidated Fill Details download, mirroring
// appendDepITTemplateSheets in ../DepreciationIT/depITWorkbook.js.
export function appendDepCompTemplateSheets(wb, scheduleII, usedNames) {
  const safeName = (name) => {
    let base = name.slice(0, 28)
    let candidate = base, i = 2
    while (usedNames.has(candidate.toLowerCase())) candidate = `${base} (${i++})`.slice(0, 31)
    usedNames.add(candidate.toLowerCase())
    return candidate
  }
  const aoa = [HEADER_ROW, Array(HEADER_ROW.length).fill('')]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = COL_WIDTHS
  XLSX.utils.book_append_sheet(wb, ws, safeName('Dep (Comp) Template'))
  XLSX.utils.book_append_sheet(wb, scheduleIIReferenceSheet(scheduleII), safeName('Schedule II Reference'))
}

/**
 * @param {XLSX.WorkBook} wb
 * @returns {{ rows: object[], matched: number }}
 */
export function parseDepCompWorkbook(wb) {
  const sheetName = wb.SheetNames.find(n => n.startsWith('Dep (Comp)')) || wb.SheetNames[0]
  const ws = wb.Sheets[sheetName]
  if (!ws) return { rows: [], matched: 0 }
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  const dataRows = aoa.slice(1).filter(r => (r[0] || '').toString().trim())

  const rows = dataRows.map(r => {
    const row = { category: (r[0] || '').toString().trim() }
    FIELDS.forEach((f, i) => { row[f] = r[i + 1] !== '' ? String(r[i + 1]) : '' })
    return row
  })
  return { rows, matched: rows.length }
}
