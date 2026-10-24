// ── Manual Previous Year entries Excel round-trip — backup/restore across a
// Trial Balance re-upload ────────────────────────────────────────────────
// manual_py_entries is looked up by TITLE (see schema.js's note_title
// comment), but the table itself is keyed by tb_id, and every TB upload is a
// plain INSERT (see tb.js's tb:upload/tb:uploadTally) — a fresh tb_id, never
// the same row reused. So a branch's own Manual PY entries do NOT survive
// that branch's own Trial Balance being re-uploaded, unlike
// entity_manual_py_entries (the Consolidated view's entries — entity-scoped,
// unaffected by any one branch's re-upload). Same round-trip pattern as
// Stock/Dep (IT)/Dep (Comp): download a snapshot of what's currently saved
// before re-uploading, then Upload Filled afterwards to restore it — matched
// back by NOTE TITLE + PARTICULAR, never by the note number (which is only a
// recomputed position, not a stable identity — see allocNoteNum in
// useFinancials.js).
import * as XLSX from 'xlsx-js-style'

const HEADER_ROW = ['Note Title', 'Particular', 'Previous Year Amount', 'Custom Row (Y/N)']
const COL_WIDTHS = [{ wch: 42 }, { wch: 32 }, { wch: 20 }, { wch: 14 }]

export function buildManualPyFilledWorkbook(entries, { sheetLabel = 'Manual PY' } = {}) {
  const wb = XLSX.utils.book_new()
  const aoa = [HEADER_ROW, ...(entries || []).map(e => [
    e.note_title || '', e.particular_label || '', e.py_amount ?? '', e.is_custom ? 'Y' : '',
  ])]
  if (aoa.length === 1) aoa.push(['(nothing saved yet)'])
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = COL_WIDTHS
  XLSX.utils.book_append_sheet(wb, ws, sheetLabel.slice(0, 31))
  return wb
}

/**
 * @param {XLSX.WorkBook} wb
 * @returns {{ entries: Array<{note_title: string, particular_label: string, py_amount: number, is_custom: boolean}> }}
 */
export function parseManualPyWorkbook(wb) {
  const sheetName = wb.SheetNames.find(n => n.startsWith('Manual PY')) || wb.SheetNames[0]
  const ws = wb.Sheets[sheetName]
  const entries = []
  if (!ws) return { entries }
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  for (const r of aoa.slice(1)) {
    const noteTitle = (r[0] || '').toString().trim()
    if (!noteTitle) continue
    const pyAmountRaw = r[2]
    // A blank amount is left untouched, not treated as "restore to zero" —
    // same "blank means not filled" convention as Fill Details/Stock uploads.
    if (pyAmountRaw === '' || pyAmountRaw == null) continue
    const particularLabel = (r[1] || '').toString().trim()
    const isCustom = /^y/i.test((r[3] || '').toString().trim())
    entries.push({ note_title: noteTitle, particular_label: particularLabel, py_amount: parseFloat(pyAmountRaw) || 0, is_custom: isCustom })
  }
  return { entries }
}
