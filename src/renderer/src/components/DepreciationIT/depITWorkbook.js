// ── Dep (IT) Excel round-trip — blank template + filled snapshot ────────────
// "Blank" is a generic, reusable template (headers + a Block reference sheet)
// with no TB-specific data — safe to hand out once and reuse for any entity.
// "Filled" is a snapshot of the CURRENT ledgers/inputs, meant purely as a
// backup/restore mechanism: since a fresh Trial Balance upload gets a new
// tb_id (and dep_it_schedules is keyed by tb_id), a re-upload otherwise loses
// every Block assignment and figure entered here. Download Filled before
// re-uploading a TB, then Upload Filled afterwards to restore — rows are
// matched back onto the new TB's ledger list by ledger name.
import * as XLSX from 'xlsx-js-style'

const HEADER_ROW = ['Ledger / Asset Name', 'Asset Block', 'Opening WDV', 'Addition <180 Days', 'Addition >=180 Days', 'Deduction']
const COL_WIDTHS = [{ wch: 40 }, { wch: 40 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }]

function blockReferenceSheet(blocks) {
  const aoa = [['Major Category', 'Block Name (type exactly as shown here into the "Asset Block" column)', 'Rate %']]
  for (const b of blocks || []) aoa.push([b.majorCategory, b.block, b.rate])
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 28 }, { wch: 70 }, { wch: 10 }]
  return ws
}

// ── Capital WIP / Intangible WIP — a fixed 3-row mini-table, separate from
// the ledger rows above (no depreciation, no Block) so it needs its own
// sheet: mixing it into the ledger sheet would make parseDepITWorkbook treat
// "Capital Work in Progress" as a stray unmatched ledger name. Leave every
// cell blank if the entity has no CWIP/Intangible-under-development at all —
// the app already hides these rows everywhere nothing was entered.
const WIP_SHEET = 'Dep (IT) - WIP'
const WIP_ROW_LABELS = ['Capital Work in Progress', 'Intangible Work in Progress', 'Total (Work in Progress) - Previous Year']

function wipSheet(wip) {
  const aoa = [
    ['Particulars', 'Amount'],
    [WIP_ROW_LABELS[0], wip?.capitalCY || ''],
    [WIP_ROW_LABELS[1], wip?.intangibleCY || ''],
    [WIP_ROW_LABELS[2], wip?.prevYearTotal || ''],
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 45 }, { wch: 16 }]
  return ws
}

/** @returns {{capitalCY:string, intangibleCY:string, prevYearTotal:string}|null} */
export function parseDepITWipSheet(wb) {
  const ws = wb.Sheets[WIP_SHEET]
  if (!ws) return null
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  const byLabel = {}
  for (const r of aoa.slice(1)) {
    const label = (r[0] || '').toString().trim()
    if (label) byLabel[label] = r[1] !== '' && r[1] != null ? String(r[1]) : ''
  }
  return {
    capitalCY: byLabel[WIP_ROW_LABELS[0]] || '',
    intangibleCY: byLabel[WIP_ROW_LABELS[1]] || '',
    prevYearTotal: byLabel[WIP_ROW_LABELS[2]] || '',
  }
}

export function buildDepITBlankTemplate(blocks) {
  const wb = XLSX.utils.book_new()
  const aoa = [HEADER_ROW, ['', '', '', '', '', '']]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = COL_WIDTHS
  XLSX.utils.book_append_sheet(wb, ws, 'Dep (IT) Template')
  XLSX.utils.book_append_sheet(wb, wipSheet(null), WIP_SHEET)
  XLSX.utils.book_append_sheet(wb, blockReferenceSheet(blocks), 'IT Blocks Reference')
  return wb
}

export function buildDepITFilledWorkbook(ledgers, inputs, blocks, wip) {
  const wb = XLSX.utils.book_new()
  const aoa = [HEADER_ROW]
  for (const l of ledgers || []) {
    const inp = inputs[l.ledger_name] || {}
    const block = blocks.find(b => b.id === inp.block)
    aoa.push([
      (inp.label || '').trim() || l.ledger_name,   // a company's hand-added row: its description
      block ? block.block : '',
      inp.openingWDV || '', inp.addBefore180 || '', inp.addAfter180 || '', inp.deduction || '',
    ])
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = COL_WIDTHS
  XLSX.utils.book_append_sheet(wb, ws, 'Dep (IT) Filled')
  XLSX.utils.book_append_sheet(wb, wipSheet(wip), WIP_SHEET)
  XLSX.utils.book_append_sheet(wb, blockReferenceSheet(blocks), 'IT Blocks Reference')
  return wb
}

// Appends a blank Dep (IT) template sheet + Block reference sheet onto an
// already-built workbook — used to merge the template into the Notes tab's
// consolidated Fill Details download.
export function appendDepITTemplateSheets(wb, blocks, usedNames) {
  const safeName = (name) => {
    let base = name.slice(0, 28)
    let candidate = base, i = 2
    while (usedNames.has(candidate.toLowerCase())) candidate = `${base} (${i++})`.slice(0, 31)
    usedNames.add(candidate.toLowerCase())
    return candidate
  }
  const aoa = [HEADER_ROW, ['', '', '', '', '', '']]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = COL_WIDTHS
  XLSX.utils.book_append_sheet(wb, ws, safeName('Dep (IT) Template'))
  XLSX.utils.book_append_sheet(wb, wipSheet(null), safeName(WIP_SHEET))
  XLSX.utils.book_append_sheet(wb, blockReferenceSheet(blocks), safeName('IT Blocks Reference'))
}

/**
 * @param {XLSX.WorkBook} wb
 * @param {object[]} blocks - current master+custom blocks, to resolve block name -> id
 * @returns {{ rows: Record<string, {block:string, openingWDV:string, addBefore180:string, addAfter180:string, deduction:string}>, matched: number, unmatched: string[] }}
 */
export function parseDepITWorkbook(wb, blocks) {
  const sheetName = wb.SheetNames.find(n => n.startsWith('Dep (IT)')) || wb.SheetNames[0]
  const ws = wb.Sheets[sheetName]
  if (!ws) return { rows: {}, matched: 0, unmatched: [] }
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  const dataRows = aoa.slice(1).filter(r => (r[0] || '').toString().trim())

  const blockByName = new Map((blocks || []).map(b => [b.block.trim().toLowerCase(), b.id]))
  const rows = {}
  const unmatched = []
  for (const r of dataRows) {
    const ledgerName = (r[0] || '').toString().trim()
    const blockName = (r[1] || '').toString().trim()
    const blockId = blockName ? (blockByName.get(blockName.toLowerCase()) || '') : ''
    if (blockName && !blockId) unmatched.push(`${ledgerName} (block "${blockName}" not found)`)
    rows[ledgerName] = {
      block: blockId,
      openingWDV: r[2] !== '' ? String(r[2]) : '',
      addBefore180: r[3] !== '' ? String(r[3]) : '',
      addAfter180: r[4] !== '' ? String(r[4]) : '',
      deduction: r[5] !== '' ? String(r[5]) : '',
    }
  }
  return { rows, matched: dataRows.length - unmatched.length, unmatched, wip: parseDepITWipSheet(wb) }
}
