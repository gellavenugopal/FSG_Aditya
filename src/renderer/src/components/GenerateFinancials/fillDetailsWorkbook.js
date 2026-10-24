// ── Consolidated Fill Details Excel — one sheet per note ────────────────────
// Downloadable template pre-filled with each note's currently-saved Fill
// Details data (or blank rows if none saved yet), editable in Excel, and
// re-uploadable to bulk-save Fill Details without opening each note's form
// individually. Driven entirely by utils/fillDetailsRegistry.js — add an
// entry there for a new note type and it appears here automatically.
import * as XLSX from 'xlsx-js-style'
import { FILL_DETAILS_REGISTRY } from '../../utils/fillDetailsRegistry'
import { appendDepITTemplateSheets } from '../DepreciationIT/depITWorkbook'
import { appendDepCompTemplateSheets } from '../DepreciationComp/depCompWorkbook'
import { buildStockBlankTemplate, buildStockFilledWorkbook, parseStockWorkbook } from '../Stock/stockWorkbook'
import { appendShareCapitalDetailsSheet } from '../Notes/shareCapitalDetailsWorkbook'
import { appendCfsSheet } from '../CFS/cfsWorkbook'

// Cell-by-cell equality (stringified, trimmed, blank/0 treated the same) used
// to detect an untouched sheet — compares uploaded rows against the exact
// blank baseline that entry.toRows(null) itself produces, so a form's own
// default placeholder values (e.g. Share Capital's "Equity Shares" name,
// face value 10) are correctly still "blank" rather than false-positiving as
// filled-in data.
const cellStr = (c) => {
  const s = (c ?? '').toString().trim()
  return (s === '0' || s === '0.00') ? '' : s
}
function rowsEqual(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const ra = a[i] || [], rb = b[i] || []
    const len = Math.max(ra.length, rb.length)
    for (let j = 0; j < len; j++) {
      if (cellStr(ra[j]) !== cellStr(rb[j])) return false
    }
  }
  return true
}

// Row 1: note number (parsed back on import so re-ordering/renaming a sheet
// tab doesn't break the round-trip). Row 2: note title (human reference
// only). Row 3: blank. Row 4: column header. Row 5+: data.
const NOTE_NUM_ROW = 0
const TITLE_ROW = 1
const HEADER_ROW = 3
const DATA_START_ROW = 4

// Sheets with their OWN dedicated parser (parseFillDetailsStockSheet,
// parseDepITWorkbook, parseDepCompWorkbook, parseShareCapitalDetailsSheet)
// must be excluded from the generic per-registry-entry loop below. Most
// bolted-on sheets (Stock, Dep (IT)/(Comp) templates) don't carry a "Note N"
// row-1 anchor at all, so they already fail that check harmlessly — but
// "Share Capital - Details" DOES (for renumbering resilience, same as every
// registry sheet) AND its title contains "share capital", which the
// share-capital registry entry's own match() also accepts. Left unexcluded,
// the generic loop would ALSO "recognise" it as a second Classes sheet and
// mis-map every shareholder row as a class (Sl No → class name, Folio No →
// face value, etc.), then overwrite the real Classes data since this sheet
// is always appended after it. Name-prefix exclusion, not content-based,
// since content-based (e.g. "does the title also match a registry entry")
// is exactly the ambiguity that caused this.
const BOLT_ON_SHEET_PREFIXES = ['Share Capital - Details', 'CFS']

function safeSheetName(name, used) {
  let base = (name || 'Sheet').replace(/[\\/*?:[\]]/g, ' ').slice(0, 28).trim() || 'Sheet'
  let candidate = base
  let i = 2
  while (used.has(candidate.toLowerCase())) { candidate = `${base} (${i++})`.slice(0, 31) }
  used.add(candidate.toLowerCase())
  return candidate
}

/**
 * @param {object[]} activeNotes - data.activeNotes from useFinancials
 * @param {Map<number, object>} noteDetailsMap - note_num -> saved Fill Details data (may be missing/empty)
 * @param {object[]} [depITBlocks] - current IT Act blocks (master+custom); when
 *   provided, a Dep (IT) template + Block reference sheet is appended too
 * @param {object} [opts]
 * @param {boolean} [opts.blank] - ignore noteDetailsMap/stockData entirely and
 *   emit every sheet with default/empty rows, regardless of what's saved —
 *   for a guaranteed pristine template independent of current progress.
 * @param {object} [opts.stockData] - {opening, closing, pyOpening, pyClosing}
 *   from the Stock tab; when provided (and not blank) a "Stock" sheet is
 *   appended too, in the same layout Stock's own standalone Excel uses.
 * @param {object[]} [opts.depCompScheduleII] - Schedule II category-name
 *   reference list (from dep:scheduleII); when provided, a Dep (Comp)
 *   fillable-form template + reference sheet is appended too.
 * @returns {XLSX.WorkBook}
 */
export function buildFillDetailsWorkbook(activeNotes, noteDetailsMap, depITBlocks = null, opts = {}) {
  const { blank = false, stockData = null, depCompScheduleII = null, constitution = null, cfsRows = null, cfsCc = null } = opts
  const wb = XLSX.utils.book_new()
  const used = new Set()
  let anySheet = false

  for (const note of activeNotes || []) {
    // constitution picks between entries for the same note title — Trade
    // Receivables is Company's Schedule III schedule, or the simpler ageing
    // table of a Proprietorship / Partnership / LLP.
    const entry = FILL_DETAILS_REGISTRY.find(e => e.match((note.title || '').toLowerCase(), constitution))
    if (!entry) continue
    const details = blank ? null : (noteDetailsMap.get(Number(note.num)) || null)
    // The live note goes along (never for the blank template) so a sheet can show
    // what the app itself shows before anything is saved — see the ageing entry.
    const dataRows = entry.toRows(details, blank ? null : note)
    if (!dataRows.length) continue  // e.g. LLP capital account: registry opts out

    const aoa = []
    aoa[NOTE_NUM_ROW] = [`Note ${note.num}`]
    aoa[TITLE_ROW] = [note.title]
    aoa[2] = []
    aoa[HEADER_ROW] = entry.headerRow
    for (const r of dataRows) aoa.push(r)

    const ws = XLSX.utils.aoa_to_sheet(aoa)
    // Column 0 (name/label) always wide; others size to fit their own header
    // text (capped at 40) so a long clarifying header — e.g. "CY Issued This
    // Year Only (not cumulative)" — isn't visually truncated at a flat 16.
    ws['!cols'] = entry.headerRow.map((h, i) => ({ wch: i === 0 ? 32 : Math.min(40, Math.max(16, (h || '').length + 2)) }))
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(`N${note.num} ${entry.sheetName}`, used))
    anySheet = true

    // Share Capital carries more than the Classes table this registry entry
    // round-trips (5% Shareholders, Promoters, Rights, Footnotes — see
    // ShareCapitalForm.jsx's other tabs) — bolted on as its own sheet right
    // after the Classes one, keyed to the same note number.
    if (entry.key === 'share-capital') {
      appendShareCapitalDetailsSheet(wb, note.num, details, used)
      anySheet = true
    }
  }

  // Stock — bolted on as an additional sheet (not registry-driven, since it
  // has no "Note {num}" anchor). Stock's OWN standalone Excel in the Stock
  // tab is untouched; this just embeds the same layout here too so one
  // consolidated file covers everything. Sheet name is "Stock"-prefixed so
  // parseStockWorkbook (reused on upload) finds it.
  if (!blank && stockData) {
    const { opening, closing, pyOpening, pyClosing, heads } = stockData
    const srcWb = buildStockFilledWorkbook(opening, closing, pyOpening, pyClosing, true, heads || {})
    const srcName = srcWb.SheetNames[0]
    XLSX.utils.book_append_sheet(wb, srcWb.Sheets[srcName], safeSheetName('Stock', used))
    anySheet = true
  } else if (blank) {
    const srcWb = buildStockBlankTemplate()
    const srcName = srcWb.SheetNames[0]
    XLSX.utils.book_append_sheet(wb, srcWb.Sheets[srcName], safeSheetName('Stock', used))
    anySheet = true
  }

  // Cash Flow Statement (CFS tab): the figures as the tab shows them, to fill in or correct here and upload again (see CFS/cfsWorkbook.js)
  if (cfsRows && cfsRows.length) {
    appendCfsSheet(wb, cfsRows, { blank, cc: cfsCc })
    anySheet = true
  }

  if (!anySheet) {
    const ws = XLSX.utils.aoa_to_sheet([['No Fill Details forms are registered for the notes in this Trial Balance yet.']])
    XLSX.utils.book_append_sheet(wb, ws, 'Info')
  }

  if (depITBlocks) appendDepITTemplateSheets(wb, depITBlocks, used)
  if (depCompScheduleII) appendDepCompTemplateSheets(wb, depCompScheduleII, used)

  return wb
}

/**
 * @param {XLSX.WorkBook} wb
 * @returns {{noteNum:number, noteTitle:string, data:object}[], skippedBlank:number}}
 */
export function parseFillDetailsWorkbook(wb, { constitution = null } = {}) {
  const results = []
  let skippedBlank = 0
  for (const sheetName of wb.SheetNames) {
    if (BOLT_ON_SHEET_PREFIXES.some(p => sheetName.startsWith(p))) continue
    const ws = wb.Sheets[sheetName]
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
    if (!aoa.length) continue
    const noteNumCell = (aoa[NOTE_NUM_ROW]?.[0] || '').toString()
    const m = noteNumCell.match(/note\s*(\d+)/i)
    if (!m) continue  // not a recognised Fill Details sheet (e.g. the Info sheet)
    const noteNum = parseInt(m[1], 10)
    const noteTitle = (aoa[TITLE_ROW]?.[0] || '').toString()
    const dataRows = aoa.slice(DATA_START_ROW).filter(r => r.some(c => (c ?? '') !== ''))

    const entry = FILL_DETAILS_REGISTRY.find(e => e.match(noteTitle.toLowerCase(), constitution))
    if (!entry) continue

    // Blank sheet → not filled → skip entirely, don't touch whatever's
    // already saved for this note. Compared against the exact blank
    // baseline this same entry would emit, not just "every cell empty",
    // since some forms default a placeholder row (e.g. Share Capital).
    const blankRows = entry.toRows(null)
    if (rowsEqual(dataRows, blankRows)) { skippedBlank++; continue }

    try {
      const data = entry.fromRows(dataRows)
      results.push({ noteNum, noteTitle, data })
    } catch (e) {
      console.error(`Failed to parse Fill Details sheet "${sheetName}":`, e)
    }
  }
  return { results, skippedBlank }
}

/**
 * Parses the bolted-on "Stock"-prefixed sheet, if present, applying the same
 * blank-sheet-means-not-filled rule as parseFillDetailsWorkbook. Returns
 * null if no Stock sheet exists, or if it's present but entirely blank.
 */
export function parseFillDetailsStockSheet(wb) {
  if (!wb.SheetNames.some(n => n.startsWith('Stock'))) return null
  const parsed = parseStockWorkbook(wb)
  if (!parsed) return null
  const isBlank = (obj) => Object.values(obj || {}).every(v => !parseFloat(v))
  if (isBlank(parsed.opening) && isBlank(parsed.closing) && isBlank(parsed.pyOpening) && isBlank(parsed.pyClosing)) return null
  return parsed
}
