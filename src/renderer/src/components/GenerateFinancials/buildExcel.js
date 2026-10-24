import { auditorForDenomination } from '../../utils/signingRules'
import * as XLSX from 'xlsx-js-style'  // fork of xlsx that preserves cell styles
import { netCreditPurchasesWorking } from '../../utils/ratios'
import { DENOMINATIONS, displayAmt, processRows } from '../../hooks/useFinancials'
import { TP_AGEING_ROWS, TP_AGEING_BUCKETS } from '../Notes/TradePayablesDisclosureForm'
import { TR_AGEING_ROWS, TR_AGEING_BUCKETS, trComputedCell } from '../Notes/TradeReceivablesAgingForm'
// Single source of truth for the Schedule III BS layout — shared with the
// live BS screen so Excel always matches the UI exactly (numbering,
// zero-value uncategorised suppression, everything).
import { computeCompanyBSLayout, computeDynamicBSLayout } from '../../utils/bsStructure'
// Single source of truth for the Company/LLP PL expense-line bucketing —
// shared with the live PL screen so Excel always matches the UI exactly.
import { EXPENSE_LINES, corpFaceTail, TAX_SECTION_RX } from '../../utils/plStructureCorp'
// Single source of truth for the non-corporate (constitution=1: Individual/
// Proprietorship/Partnership) PL sequence — shared with the live PL screen
// and the PDF exporter.
import { computeNonCorpPLLayout } from '../../utils/plStructureNonCorp'
import { NC_AGEING_TITLE, NC_AGEING_BLOCKS, NC_AGEING_CATEGORIES, ncAgeingResolve } from '../../utils/tradeReceivablesNonCorp'
import { getSubnoteGroups, UNCLASSIFIED_LABEL, plNoteLines, subnoteGroupFigures, bsNoteFallbackLines, pyOnlySubnoteLines, annexureDisplayLabels } from '../../utils/annexureGrouping'
import { signatoryIdText, signedOnBehalfOf } from '../../utils/signatoryFormat'
import { CASH_BANK_ITEMS } from '../Notes/CashBankDetailsForm'
import { printedDisclosures, disclosureParagraphs } from '../../utils/shareCapitalDisclosures'
import { scaleRatioAmounts } from '../../utils/ratioTable'
import { buildCashFlow } from '../../utils/cashFlow'
import { pointBodyHtml } from '../../utils/generalNotePoint'
import { pointLabel } from '../../utils/pointLabel'
import { withStbCurrentMaturities } from '../../utils/stbCurrentMaturities'
import { printNoteRows } from '../../utils/noteRowHeaders'

// Normalizes any date string this app produces to DD-MM-YYYY for display —
// upload paths disagree on period format (some store "DD-MM-YYYY To
// DD-MM-YYYY", others "YYYY-MM-DD To YYYY-MM-DD"), so every date shown in
// the generated workbook goes through this single point of truth.
function toDDMMYYYY(dateStr) {
  if (!dateStr) return ''
  const s = dateStr.trim()
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)          // YYYY-MM-DD
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)     // DD-MM-YYYY or DD/MM/YYYY
  if (m) return `${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}-${m[3]}`
  return s
}

/** Extract year-end date from a period range, normalized to DD-MM-YYYY. */
function yearEnd(period) {
  if (!period) return ''
  const toIdx = period.toLowerCase().indexOf(' to ')
  const raw = toIdx !== -1 ? period.slice(toIdx + 4).trim() : period.trim()
  return toDDMMYYYY(raw)
}

/** Extract year-start date from a period range, normalized to DD-MM-YYYY. */
function yearStart(period) {
  if (!period) return ''
  const toIdx = period.toLowerCase().indexOf(' to ')
  const raw = toIdx !== -1 ? period.slice(0, toIdx).trim() : ''
  return toDDMMYYYY(raw)
}

/** DD-MM-YYYY → DD-MM-(YYYY-1), for a fallback PY column heading when no separate PY TB is selected. */
function yearBefore(ddmmyyyy) {
  const m = (ddmmyyyy || '').match(/^(\d{2})-(\d{2})-(\d{4})$/)
  if (!m) return ''
  return `${m[1]}-${m[2]}-${parseInt(m[3], 10) - 1}`
}

const _MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
function _ordinal(n) {
  const s = ['th','st','nd','rd'], v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
/** "01-04-2025" → "1st April 2025" (falls back to the raw string if unparsable) */
function fmtOrdinalDate(ddmmyyyy) {
  if (!ddmmyyyy) return ''
  const m = ddmmyyyy.trim().match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
  if (!m) return ddmmyyyy
  const [, d, mo, y] = m
  const mi = parseInt(mo, 10) - 1
  if (mi < 0 || mi > 11) return ddmmyyyy
  return `${_ordinal(parseInt(d, 10))} ${_MONTHS[mi]} ${y}`
}

const ALPHA = 'abcdefghijklmnopqrstuvwxyz'
const ROMAN = ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX']

// Was a local is_deemed_positive-based sign flip, diverging from the
// alie-based convention every other screen uses (see displayAmt() in
// useFinancials.js) — most visible on Trade Payables/Receivables rows
// reclassified to Advance to Suppliers/Advance from Customers, which showed
// negative here even after the live Notes/BS/PL screens were fixed to show
// them positive. Delegate to the single shared implementation instead.
const rowAmt = displayAmt

// Denomination scaler
// A face cell (Balance Sheet / P&L amount) becomes a live link to a note's
// Total only when that note's own figures are the ones printed on the face.
// A link to the wrong note — or to a note that also holds other lines — shows
// different figures in Excel than in the app and the PDF; that is how a
// mis-numbered note once reached a client's Excel file. Otherwise the cell
// keeps the static figure the app shows.
function patchNoteFormulaCells(ws, formulaCells, notesCyTotalMap, notes, scale, numFmt) {
  if (!notesCyTotalMap) return
  const tolerance = Math.abs(scale(0.5) || 0)
  const sameAs = (cell, amount) => {
    const shown = typeof cell?.v === 'number' ? cell.v : 0
    return Math.abs(shown - (scale(amount || 0) || 0)) <= tolerance
  }
  for (const { rowIdx, noteNum } of formulaCells) {
    const info = notesCyTotalMap.get(noteNum)
    const note = notes?.[noteNum]
    if (info == null || !note) continue
    const cyAddr = XLSX.utils.encode_cell({ c: 2, r: rowIdx })
    const pyAddr = XLSX.utils.encode_cell({ c: 3, r: rowIdx })
    if (!sameAs(ws[cyAddr], note.total) || !sameAs(ws[pyAddr], note.prevTotal)) continue
    ws[cyAddr] = { t: 'n', f: `Notes!C${info.cyRow + 1}`, z: numFmt }
    ws[pyAddr] = { t: 'n', f: `Notes!D${info.pyRow + 1}`, z: numFmt }
    expectFigure(ws, cyAddr, scale(note.total))
    expectFigure(ws, pyAddr, scale(note.prevTotal))
  }
}

// ── Cross-sheet link safety net ─────────────────────────────────────────────
// A cell holding a formula that reaches into another sheet (a note's total
// linking to Annexures, a face line linking to a note) is recorded here next
// to the figure it is SUPPOSED to show — the same figure the app itself
// computed. keepLinksTrue() below evaluates every one and corrects any that
// would show something else.
export function expectFigure(ws, cellAddr, expected) {
  if (!ws['!linkExpectations']) ws['!linkExpectations'] = []
  ws['!linkExpectations'].push({ cell: cellAddr, expected: Number(expected) || 0 })
}

// Evaluates the formula shapes this file writes (cell and cross-sheet
// references, ranges, SUM, + - * /, unary minus) — the way Excel would.
function evalWorkbookFormulas(wb) {
  const memo = new Map()
  const value = (sheet, addr) => {
    const key = `${sheet}!${addr}`
    if (memo.has(key)) return memo.get(key)
    memo.set(key, 0)
    const cell = wb?.Sheets?.[sheet]?.[addr]
    const v = !cell ? 0 : cell.f ? evalFormula(cell.f, sheet) : (typeof cell.v === 'number' ? cell.v : 0)
    memo.set(key, v)
    return v
  }
  const tokenize = (src) => {
    const out = []
    let i = 0
    while (i < src.length) {
      const rest = src.slice(i)
      let m
      if (rest[0] === ' ') { i++; continue }
      if ('+-*/(),:'.includes(rest[0])) { out.push({ t: rest[0] }); i++; continue }
      if ((m = /^'([^']+)'!\$?([A-Z]{1,3})\$?(\d+)/.exec(rest)) || (m = /^([A-Za-z_][A-Za-z0-9_]*)!\$?([A-Z]{1,3})\$?(\d+)/.exec(rest))) {
        out.push({ t: 'ref', sheet: m[1], col: m[2], row: Number(m[3]) }); i += m[0].length; continue
      }
      if ((m = /^([A-Z]+)\(/.exec(rest))) { out.push({ t: 'fn', name: m[1] }); i += m[1].length; continue }
      if ((m = /^\$?([A-Z]{1,3})\$?(\d+)/.exec(rest))) { out.push({ t: 'ref', sheet: null, col: m[1], row: Number(m[2]) }); i += m[0].length; continue }
      if ((m = /^\d+(\.\d+)?/.exec(rest))) { out.push({ t: 'num', v: Number(m[0]) }); i += m[0].length; continue }
      throw new Error(`cannot read formula "${src}" at "${rest}"`)
    }
    return out
  }
  function evalFormula(formula, sheet) {
    const tokens = tokenize(String(formula).replace(/^=/, ''))
    let p = 0
    const peek = () => tokens[p]
    const next = () => tokens[p++]
    const rangeSum = (a, b) => {
      let s = 0
      const c0 = XLSX.utils.decode_col(a.col), c1 = XLSX.utils.decode_col(b.col)
      for (let r = Math.min(a.row, b.row); r <= Math.max(a.row, b.row); r++) {
        for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) s += value(a.sheet || sheet, `${XLSX.utils.encode_col(c)}${r}`)
      }
      return s
    }
    const factor = () => {
      const tk = next()
      if (!tk) throw new Error(`unexpected end of "${formula}"`)
      if (tk.t === '-') return -factor()
      if (tk.t === '+') return factor()
      if (tk.t === 'num') return tk.v
      if (tk.t === '(') { const v = expr(); next(); return v }
      if (tk.t === 'ref') {
        if (peek()?.t === ':') { next(); return rangeSum(tk, next()) }
        return value(tk.sheet || sheet, `${tk.col}${tk.row}`)
      }
      if (tk.t === 'fn') {
        if (tk.name !== 'SUM') throw new Error(`unsupported function ${tk.name} in "${formula}"`)
        next()
        let total = 0
        if (peek()?.t !== ')') {
          for (;;) {
            total += expr()
            if (peek()?.t === ',') { next(); continue }
            break
          }
        }
        next()
        return total
      }
      throw new Error(`unexpected "${tk.t}" in "${formula}"`)
    }
    const term = () => { let v = factor(); while (peek() && (peek().t === '*' || peek().t === '/')) { const op = next().t; const r = factor(); v = op === '*' ? v * r : v / r } return v }
    const expr = () => { let v = term(); while (peek() && (peek().t === '+' || peek().t === '-')) { const op = next().t; const r = term(); v = op === '+' ? v + r : v - r } return v }
    return expr()
  }
  return value
}

// Checks every expectFigure() recorded across the workbook; a formula that
// would show something other than the expected figure is replaced with that
// figure as a plain value (never left as a broken or misleading link).
// Returns the list of repairs made.
// A face line links to a note, and a note's line links to Annexures — a
// two-hop chain. Fixing a wrong cell changes what anything reading THROUGH it
// evaluates to, so this repeats with a fresh evaluator (no stale memo of the
// cells just fixed) until a pass finds nothing left to fix — a cell only one
// hop removed from the actual error is then re-checked once its dependency
// is already correct, instead of being flagged from a now-stale read and
// turned into a static value it never needed to become.
export function keepLinksTrue(wb, tolerance = 0.5, maxPasses = 6) {
  const allRepairs = []
  for (let pass = 0; pass < maxPasses; pass++) {
    const evaluate = evalWorkbookFormulas(wb)
    const passRepairs = []
    for (const sheetName of wb.SheetNames || []) {
      const ws = wb.Sheets[sheetName]
      for (const { cell, expected } of ws?.['!linkExpectations'] || []) {
        const existing = ws[cell]
        if (!existing || !existing.f) continue
        let gave
        try { gave = evaluate(sheetName, cell) } catch { gave = NaN }
        if (Number.isNaN(gave) || Math.abs(gave - expected) > tolerance) {
          passRepairs.push({ sheet: sheetName, cell, formula: existing.f, gave, figure: expected })
          ws[cell] = { t: 'n', v: expected, z: existing.z, s: existing.s }
        }
      }
    }
    allRepairs.push(...passRepairs)
    if (passRepairs.length === 0) break
  }
  for (const sheetName of wb.SheetNames || []) delete wb.Sheets[sheetName]?.['!linkExpectations']
  return allRepairs
}

function scaleFn(denom) {
  const d = DENOMINATIONS[denom] || DENOMINATIONS['as_is']
  return (n) => {
    if (n == null || isNaN(Number(n))) return null
    const v = parseFloat(n) / d.divisor
    return v
  }
}

// Indian numbering system (lakh/crore grouping) — the repeated 2-digit comma
// groups after the first 3 digits are a literal pattern Excel follows as
// written (not a locale setting), so "##,##,##0.00" renders 123456789.00 as
// 12,34,56,789.00 in any locale.
function numFormatString(denom) {
  const d = DENOMINATIONS[denom] || DENOMINATIONS['as_is']
  if (d.decimals === 0) return '##,##,##0;(##,##,##0);"-"'
  return '##,##,##0.00;(##,##,##0.00);"-"'
}

// ── Style constants ───────────────────────────────────────────────────────────
// CY column: very light grey fill — only CY cells coloured, PY column plain white
const FILL_CY    = { patternType: 'solid', fgColor: { rgb: 'F3F4F6' } }  // very light grey
const FILL_HDR   = { patternType: 'solid', fgColor: { rgb: 'FFFFFF' } }  // white (no colour)
const FILL_TOT   = { patternType: 'solid', fgColor: { rgb: 'FFFFFF' } }  // white
const FILL_NONE  = { patternType: 'none' }

// Borders — thin outer border; double bottom on totals
const BDR_THIN = { style: 'thin', color: { rgb: 'AAAAAA' } }
const BDR_MED  = { style: 'medium', color: { rgb: '555555' } }
const BDR_DBL  = { style: 'double', color: { rgb: '000000' } }

const BORDER_OUTER = { left: BDR_THIN, right: BDR_THIN, top: BDR_THIN, bottom: BDR_THIN }
const BORDER_BOTTOM_THIN = { bottom: BDR_THIN }
const BORDER_BOTTOM_DOUBLE = { top: BDR_THIN, bottom: BDR_DBL }  // double underline for totals
const BORDER_HEADER = { bottom: BDR_MED }

// Deprecated aliases kept for existing usages below
const BORDER_BOTTOM = BORDER_BOTTOM_THIN
const BORDER_ALL = BORDER_OUTER
const FILL_SUB = FILL_NONE

// ── Page setup helper (A4, portrait, fit to 1 page wide) ─────────────────────
function applyPrintSetup(ws) {
  ws['!printOptions'] = { gridLines: false, headings: false }
  ws['!pageSetup'] = {
    paperSize: 9,        // A4
    orientation: 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,      // allow as many pages as needed vertically
    scale: 100,
    margins: { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
  }
  ws['!headerFooter'] = {
    oddHeader: '&C&"Arial,Bold"&14&A',
    oddFooter: '&CPage &P of &N',
  }
}

function setCellStyle(ws, addr, style) {
  if (!ws[addr]) return
  ws[addr].s = { ...(ws[addr].s || {}), ...style }
}

function setRowStyle(ws, rowIdx, cols, style) {
  for (const c of cols) {
    const addr = XLSX.utils.encode_cell({ c, r: rowIdx })
    if (ws[addr]) setCellStyle(ws, addr, style)
  }
}

// Create the cell if missing so fills/borders span the full row width
// (aoa_to_sheet skips empty/null cells, which made bands stop at column A).
function ensureCell(ws, c, r) {
  const addr = XLSX.utils.encode_cell({ c, r })
  if (!ws[addr]) ws[addr] = { t: 's', v: '' }
  return addr
}

// Style a full row, creating missing cells first
function styleRowFull(ws, rowIdx, cols, style) {
  for (const c of cols) setCellStyle(ws, ensureCell(ws, c, rowIdx), style)
}

// Merge a heading row (entity name, constitution, statement title, unit)
// across the full table width and center it both horizontally and
// vertically within the merged block — real cell merges, not just visual
// overflow into empty neighbour columns.
function styleHeadingRow(ws, rowIdx, numCols, style) {
  if (numCols > 1) {
    if (!ws['!merges']) ws['!merges'] = []
    ws['!merges'].push({ s: { r: rowIdx, c: 0 }, e: { r: rowIdx, c: numCols - 1 } })
  }
  setCellStyle(ws, ensureCell(ws, 0, rowIdx), {
    ...style,
    alignment: { horizontal: 'center', vertical: 'center', ...(style.alignment || {}) },
  })
}

// Center (horizontally + vertically) every cell in one column over a row
// range — used for the "Note No." column so numbers/labels don't sit
// left- or right-hugging their neighbours.
function centerColumn(ws, colIdx, rowStart, rowEnd) {
  for (let r = rowStart; r <= rowEnd; r++) {
    const addr = ws[XLSX.utils.encode_cell({ c: colIdx, r })]
    if (!addr) continue
    const prev = addr.s || {}
    addr.s = { ...prev, alignment: { ...(prev.alignment || {}), horizontal: 'center', vertical: 'center' } }
  }
}

function isBlankRow(r) {
  return !r || r.length === 0 || r.every(v => v === null || v === undefined || v === '')
}

// Collapses whatever blank-row gap already sits at the end of `rows` down to
// exactly one — so consecutive notes/sections are always separated by a
// single blank row, never zero and never a stack of several.
function trimToOneBlankRow(rows) {
  while (rows.length >= 2 && isBlankRow(rows[rows.length - 1]) && isBlankRow(rows[rows.length - 2])) {
    rows.pop()
  }
  if (rows.length >= 1 && !isBlankRow(rows[rows.length - 1])) {
    rows.push([])
  }
}

// Pushes entity name / constitution (or CIN, for Companies) / address /
// statement-title / unit rows onto `rows`, recording each one's index + kind
// for styleTitleRows() below. Companies show CIN in place of the
// constitution line (per Schedule III header convention); other
// constitutions keep the "(Partnership)" etc. sub-line. Registered/business
// address, when captured on the Auditee record, always follows.
function pushTitleRows(rows, entity, statementTitle, unit) {
  const titleRows = []
  const isCompany = parseInt(entity?.constitution) === 3
  titleRows.push({ row: rows.length, kind: 'name' }); rows.push([entity?.name || 'Entity Name'])
  if (isCompany) {
    if (entity?.cin) { titleRows.push({ row: rows.length, kind: 'sub' }); rows.push([`CIN: ${entity.cin}`]) }
  } else if (entity?.constitution_display) {
    titleRows.push({ row: rows.length, kind: 'sub' }); rows.push([`(${entity.constitution_display})`])
  }
  if (entity?.address) { titleRows.push({ row: rows.length, kind: 'sub' }); rows.push([entity.address]) }
  titleRows.push({ row: rows.length, kind: 'title' }); rows.push([statementTitle])
  if (unit) { titleRows.push({ row: rows.length, kind: 'sub' }); rows.push([unit]) }
  return titleRows
}

// Merges + centers (horizontal & vertical) each title row across the full
// table width — real merged cells, consistent bold/size per kind.
function styleTitleRows(ws, titleRows, numCols) {
  for (const { row, kind } of titleRows) {
    const style = kind === 'name' ? { font: { bold: true, sz: 14, color: { rgb: '1E3A8A' } } }
      : kind === 'title' ? { font: { bold: true, sz: 12 } }
      : { font: { sz: 11 } }
    styleHeadingRow(ws, row, numCols, style)
  }
}

// Merge one border side into a cell without clobbering its other borders
function mergeBorder(ws, c, r, borderPart) {
  const addr = ensureCell(ws, c, r)
  const prev = ws[addr].s || {}
  ws[addr].s = { ...prev, border: { ...(prev.border || {}), ...borderPart } }
}

// Draw an outline box (side lines + top/bottom) around a cell block
function applyBoxBorder(ws, r1, r2, c1, c2, style = BDR_THIN) {
  for (let r = r1; r <= r2; r++) {
    mergeBorder(ws, c1, r, { left: style })
    mergeBorder(ws, c2, r, { right: style })
  }
  for (let c = c1; c <= c2; c++) {
    mergeBorder(ws, c, r1, { top: style })
    mergeBorder(ws, c, r2, { bottom: style })
  }
}

function applyCYColumnStyle(ws, range, cyCol) {
  for (let r = range.s.r; r <= range.e.r; r++) {
    const addr = XLSX.utils.encode_cell({ c: cyCol, r })
    if (ws[addr]) setCellStyle(ws, addr, { fill: FILL_CY })
  }
}

// Hyperlink a cell to another sheet. Preserves existing font sz/bold.
function linkTo(ws, addr, sheet, targetAddr, tooltip) {
  if (!ws[addr]) ws[addr] = { t: 's', v: '' }
  ws[addr].l = { Target: `#'${sheet}'!${targetAddr}`, Tooltip: tooltip || `Go to ${sheet}` }
  const prev = ws[addr].s || {}
  const prevFont = prev.font || {}
  ws[addr].s = {
    ...prev,
    font: {
      ...prevFont,
      color: { rgb: '1D4ED8' },
      underline: true,
    },
  }
}

// ── Signature block (rendered at the bottom of each sheet) ──────────────────
function addSignatureBlock(ws, rows, entity, auditor, signatories, signPlace = '', signDate = '') {
  const startRow = rows.length
  rows.push([])
  rows.push([])
  if (auditor) rows.push(['As per our report of even date attached.'])   // no auditor (a Company in absolute figures): directors only
  rows.push([])

  const dateText = `Date: ${signDate ? toDDMMYYYY(signDate) : ''}`
  const placeText = `Place: ${signPlace || ''}`

  // Auditor (col 1-2) vs Management (col 3-4)
  const ab = []
  if (auditor) {
    if (auditor.firm_name) ab.push(`For ${auditor.firm_name}`)
    ab.push(auditor.firm_name ? 'Chartered Accountants' : 'Chartered Accountant')
    if (auditor.frn) ab.push(`Firm Registration No.: ${auditor.frn}`)
    ab.push('')  // gap
    ab.push('')
    ab.push('')
    ab.push(auditor.name || '')
    if (auditor.designation) ab.push(auditor.designation)
    ab.push(`Membership No.: ${auditor.membership_number || ''}`)
    ab.push(dateText)
    ab.push(placeText)
  }
  const mgmt = []
  if (signatories && signatories.length > 0) {
    // Same row, e.g. "For Ganesh Plastic Centre" — matches the auditor block's
    // "For {firm name}" single line, instead of splitting across two rows.
    mgmt.push(`${signedOnBehalfOf(entity?.constitution)} ${(entity?.name || '').toUpperCase()}`.trim())
    mgmt.push('')
    mgmt.push('')
    for (const s of signatories) {
      mgmt.push(s.name || '')
      const sub = [s.designation, signatoryIdText(entity?.constitution, s)].filter(Boolean).join(' — ')
      if (sub) mgmt.push(sub)
      mgmt.push('')
    }
    if (!auditor) { mgmt.push(dateText); mgmt.push(placeText) }   // Place and Date go under the directors
  }

  const maxLen = Math.max(ab.length, mgmt.length)
  for (let i = 0; i < maxLen; i++) {
    rows.push([ab[i] || '', '', '', mgmt[i] || ''])
  }
  return startRow
}

// ── Pad BS/PL sections with zero-value rows from LevelFormat ─────────────────
// Ensures all Schedule III line items appear even when they have no mapped data.
function padSections(actualSections, lfRows) {
  if (!lfRows || lfRows.length === 0) return actualSections

  // Build LF map: l1_lower → { display, l2s: Map<l2_lower, display> }
  const lfL1 = new Map()
  for (const lf of lfRows) {
    if (!lf.level1) continue
    const l1k = lf.level1.trim().toLowerCase()
    if (!lfL1.has(l1k)) lfL1.set(l1k, { display: lf.level1.trim(), l2s: new Map() })
    if (lf.level2) {
      const l2k = lf.level2.trim().toLowerCase()
      if (!lfL1.get(l1k).l2s.has(l2k)) lfL1.get(l1k).l2s.set(l2k, lf.level2.trim())
    }
  }

  // Existing keys from actual data
  const existingL1 = new Set(actualSections.map(s => s.level1.trim().toLowerCase()))

  // Step 1: pad L2 lines within existing L1 sections
  const padded = actualSections.map(sec => {
    const l1k = sec.level1.trim().toLowerCase()
    const lfEntry = lfL1.get(l1k)
    if (!lfEntry || lfEntry.l2s.size === 0) return sec
    const existingL2 = new Set(sec.lines.map(l => (l.level2 || '').trim().toLowerCase()))
    const extraLines = []
    for (const [l2k, l2display] of lfEntry.l2s) {
      if (!existingL2.has(l2k)) {
        extraLines.push({ level2: l2display, total: 0, prevTotal: 0, noteNum: '', minSortOrder: 9999 })
      }
    }
    return extraLines.length ? { ...sec, lines: [...sec.lines, ...extraLines] } : sec
  })

  // Step 2: add entirely missing L1 sections from LF
  for (const [l1k, { display: l1, l2s }] of lfL1) {
    if (existingL1.has(l1k)) continue
    const lines = [...l2s.values()].map(l2 => ({
      level2: l2, total: 0, prevTotal: 0, noteNum: '', minSortOrder: 9999,
    }))
    padded.push({ level1: l1, total: 0, prevTotal: 0, lines: lines.length ? lines : [{ level2: l1, total: 0, prevTotal: 0, noteNum: '' }] })
  }

  return padded
}

// ── Build Balance Sheet sheet ───────────────────────────────────────────────
function buildBSSheet(entity, activeTB, prevTB, data, { denomination, auditor, signatories, noteStartRows, notesCyTotalMap, levelFormat, signPlace, signDate }) {
  const scale = scaleFn(denomination)
  const numFmt = numFormatString(denomination)
  const d = DENOMINATIONS[denomination] || DENOMINATIONS['as_is']
  const cyDate = yearEnd(activeTB?.period || '')
  const cyLabel = cyDate || 'Current Year'
  const pyLabel = (prevTB?.period ? yearEnd(prevTB.period) : yearBefore(cyDate)) || 'Previous Year'
  const rows = []
  const noteLinks = []
  const formulaCells = []        // { rowIdx, noteNum } — patch with Notes formula after aoa_to_sheet
  const sectionTitleRows = []    // "EQUITY AND LIABILITIES" / "ASSETS"
  const sectionHeaderRows = []   // "(1) Shareholders' funds" etc.
  const grandTotalRows = []      // TOTAL EQUITY AND LIABILITIES / TOTAL ASSETS

  const titleRows = pushTitleRows(rows, entity, `Balance Sheet as at ${cyDate}`, d.unit)
  rows.push([])
  const headerRow = rows.length
  rows.push(['Particulars', 'Note No.', cyLabel, pyLabel])
  rows.push([])

  const isCompany = parseInt(entity?.constitution) === 3
  const pushLine = (label, noteNum, total, prevTotal) => {
    const rowIdx = rows.length
    rows.push([label, noteNum || '', scale(total), scale(prevTotal)])
    if (noteNum) {
      noteLinks.push({ row: rowIdx, col: 1, noteNum })
      formulaCells.push({ rowIdx, noteNum })
    }
  }

  let elFirstLineRow, elLastLineRow, elTotalRow, asFirstLineRow, asLastLineRow, asTotalRow
  let totalEL, prevEL, totalAsset, prevAsset

  if (isCompany) {
    // ── Fixed Schedule III numbered structure — same layout the live BS
    // screen uses (computeCompanyBSLayout), so Excel always matches the UI.
    const layout = computeCompanyBSLayout(data)
    totalEL = layout.totalEL; prevEL = layout.prevEL
    totalAsset = layout.totalAsset; prevAsset = layout.prevAsset

    sectionTitleRows.push(rows.length)
    rows.push(['EQUITY AND LIABILITIES'])
    elFirstLineRow = rows.length
    for (const grp of layout.el.groups) {
      sectionHeaderRows.push(rows.length)
      rows.push([`(${grp.num}) ${grp.label}`])
      for (const line of grp.lines) {
        if (line.subLines) {
          // Trade payables: a caption (note number, no amount — the section
          // SUM below must not count it twice) over (A) MSME / (B) others.
          if (line.noteNum) noteLinks.push({ row: rows.length, col: 1, noteNum: line.noteNum })
          rows.push([`  ${line.alpha ? `(${line.alpha}) ` : ''}${line.label}`, line.noteNum || '', '', ''])
          for (const s of line.subLines) rows.push([`      ${s.label}`, '', scale(s.total), scale(s.prevTotal)])
          continue
        }
        pushLine(`  ${line.alpha ? `(${line.alpha}) ` : ''}${line.label}`, line.noteNum, line.total, line.prevTotal)
      }
      if (grp.uncat) pushLine(`  ${grp.uncat.alpha ? `(${grp.uncat.alpha}) ` : ''}${grp.uncat.label}`, grp.uncat.noteNum, grp.uncat.total, grp.uncat.prevTotal)
      rows.push([])
    }
    if (layout.el.uncatTop) {
      sectionHeaderRows.push(rows.length)
      pushLine(layout.el.uncatTop.label, layout.el.uncatTop.noteNum, layout.el.uncatTop.total, layout.el.uncatTop.prevTotal)
      rows.push([])
    }
    elLastLineRow = rows.length - 1
    grandTotalRows.push(rows.length)
    elTotalRow = rows.length
    rows.push(['TOTAL EQUITY AND LIABILITIES', '', scale(totalEL), scale(prevEL)])
    rows.push([])
    rows.push([])

    sectionTitleRows.push(rows.length)
    rows.push(['ASSETS'])
    asFirstLineRow = rows.length
    for (const grp of layout.assets.groups) {
      sectionHeaderRows.push(rows.length)
      rows.push([`(${grp.num}) ${grp.label}`])
      for (const line of grp.lines) {
        // (a) Property, Plant and Equipment and Intangible assets: a caption (no figure) over (i)-(iv).
        if (line.heading) { rows.push([`  (${line.alpha}) ${line.label}`, '', '', '']); continue }
        pushLine(`${line.sub ? '      ' : '  '}${line.alpha ? `(${line.alpha}) ` : ''}${line.label}`, line.noteNum, line.total, line.prevTotal)
      }
      if (grp.uncat) pushLine(`  ${grp.uncat.alpha ? `(${grp.uncat.alpha}) ` : ''}${grp.uncat.label}`, grp.uncat.noteNum, grp.uncat.total, grp.uncat.prevTotal)
      rows.push([])
    }
    if (layout.assets.uncatTop) {
      sectionHeaderRows.push(rows.length)
      pushLine(layout.assets.uncatTop.label, layout.assets.uncatTop.noteNum, layout.assets.uncatTop.total, layout.assets.uncatTop.prevTotal)
      rows.push([])
    }
    asLastLineRow = rows.length - 1
    grandTotalRows.push(rows.length)
    asTotalRow = rows.length
    rows.push(['TOTAL ASSETS', '', scale(totalAsset), scale(prevAsset)])
  } else {
    // ── Non-corporate: dynamic sections, zero-value uncategorised suppressed
    // (computeDynamicBSLayout mirrors DynamicBS in the live BS screen).
    const layout = computeDynamicBSLayout(data, entity?.constitution)
    totalEL = layout.totalEL; prevEL = layout.prevEL
    totalAsset = layout.totalAsset; prevAsset = layout.prevAsset

    sectionTitleRows.push(rows.length)
    rows.push(['EQUITY AND LIABILITIES'])
    elFirstLineRow = rows.length
    layout.el.forEach((sec, si) => {
      sectionHeaderRows.push(rows.length)
      rows.push([`(${si + 1}) ${sec.level1 || 'Uncategorised'}`])
      sec.lines.forEach((line, li) => {
        pushLine(`  (${ALPHA[li] || li}) ${line.level2 || 'Uncategorised'}`, line.noteNum, line.total, line.prevTotal)
      })
      rows.push([])
    })
    elLastLineRow = rows.length - 1
    grandTotalRows.push(rows.length)
    elTotalRow = rows.length
    rows.push(['TOTAL EQUITY AND LIABILITIES', '', scale(totalEL), scale(prevEL)])
    rows.push([])
    rows.push([])

    sectionTitleRows.push(rows.length)
    rows.push(['ASSETS'])
    asFirstLineRow = rows.length
    layout.assets.forEach((sec, si) => {
      sectionHeaderRows.push(rows.length)
      rows.push([`(${si + 1}) ${sec.level1 || 'Uncategorised'}`])
      sec.lines.forEach((line, li) => {
        pushLine(`  (${ALPHA[li] || li}) ${line.level2 || 'Uncategorised'}`, line.noteNum, line.total, line.prevTotal)
      })
      rows.push([])
    })
    asLastLineRow = rows.length - 1
    grandTotalRows.push(rows.length)
    asTotalRow = rows.length
    rows.push(['TOTAL ASSETS', '', scale(totalAsset), scale(prevAsset)])
  }

  addSignatureBlock(rows, rows, entity, auditor, signatories, signPlace, signDate)

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 55 }, { wch: 10 }, { wch: 22 }, { wch: 22 }]
  const range = XLSX.utils.decode_range(ws['!ref'])

  for (const addr in ws) {
    if (typeof addr !== 'string' || addr.startsWith('!')) continue
    const cell = ws[addr]
    if (!cell || typeof cell !== 'object') continue
    if (addr.match(/^[CD]\d+$/) && typeof cell.v === 'number') cell.z = numFmt
  }
  // Entity name / constitution / statement title / unit — merged + centered
  styleTitleRows(ws, titleRows, 4)
  // Column header — "Note No." centered, amounts right-aligned
  for (let c = 0; c <= 3; c++) {
    setCellStyle(ws, ensureCell(ws, c, headerRow), {
      font: { bold: true, sz: 11 },
      fill: FILL_HDR,
      border: {
        top: { style: 'thin', color: { rgb: '000000' } },
        bottom: { style: 'thin', color: { rgb: '000000' } },
      },
      alignment: { vertical: 'center', horizontal: c === 1 ? 'center' : (c >= 2 ? 'right' : 'left') },
    })
  }
  // Note No. data column — centered for every line item
  centerColumn(ws, 1, headerRow + 1, asTotalRow)
  // Section titles "EQUITY AND LIABILITIES" / "ASSETS" — bold uppercase
  for (const str of sectionTitleRows) {
    styleRowFull(ws, str, [0, 1, 2, 3], {
      font: { bold: true, sz: 11, color: { rgb: '1E40AF' } },
      fill: { fgColor: { rgb: 'DBEAFE' } },
      border: { top: { style: 'thin', color: { rgb: '000000' } }, bottom: { style: 'thin', color: { rgb: '000000' } } },
    })
  }
  // Section headers "(1) Shareholders' funds" — bold, subtle fill
  for (const shr of sectionHeaderRows) {
    styleRowFull(ws, shr, [0, 1, 2, 3], { font: { bold: true }, fill: FILL_SUB })
  }
  // Grand totals — clean with double underline, no background colour
  for (const gtr of grandTotalRows) {
    styleRowFull(ws, gtr, [0, 1, 2, 3], {
      font: { bold: true, sz: 11 },
      fill: FILL_NONE,
      border: BORDER_BOTTOM_DOUBLE,
    })
  }
  // Patch BS/PL line amount cells with formula references into Notes sheet
  patchNoteFormulaCells(ws, formulaCells, notesCyTotalMap, data.notes, scale, numFmt)
  // Grand totals as live SUM formulas over their section blocks
  // (section header / blank rows carry no numbers, so a range SUM is safe)
  const patchSum = (totRow, firstRow, lastRow) => {
    for (const [c, col] of [[2, 'C'], [3, 'D']]) {
      const prev = ws[XLSX.utils.encode_cell({ c, r: totRow })]
      ws[XLSX.utils.encode_cell({ c, r: totRow })] = {
        t: 'n', f: `SUM(${col}${firstRow + 1}:${col}${lastRow + 1})`, z: numFmt,
        s: prev?.s,
      }
    }
  }
  patchSum(elTotalRow, elFirstLineRow, elLastLineRow)
  patchSum(asTotalRow, asFirstLineRow, asLastLineRow)
  // Outline box around the statement (side lines)
  applyBoxBorder(ws, headerRow, asTotalRow, 0, 3)
  // Keep the double underline on the closing TOTAL row (box drew a thin bottom)
  for (let c = 0; c <= 3; c++) mergeBorder(ws, c, asTotalRow, { bottom: BDR_DBL })
  // Hyperlinks for note numbers
  for (const link of noteLinks) {
    const noteRow = noteStartRows.get(link.noteNum)
    if (noteRow != null) {
      const cellAddr = XLSX.utils.encode_cell({ c: link.col, r: link.row })
      linkTo(ws, cellAddr, 'Notes', XLSX.utils.encode_cell({ c: 0, r: noteRow }), `Go to Note ${link.noteNum}`)
    }
  }
  applyPrintSetup(ws)
  return ws
}

// ── Build Profit & Loss sheet ───────────────────────────────────────────────
// ── Non-corporate (constitution=1) PL sheet — driven by the shared
// computeNonCorpPLLayout(), so Excel always matches the live PL screen and
// the PDF exactly (sequence, roman numerals, zero-value suppression).
function buildNonCorpPLSheet(entity, activeTB, prevTB, data, { denomination, auditor, signatories, noteStartRows, notesCyTotalMap, signPlace, signDate }) {
  const scale = scaleFn(denomination)
  const numFmt = numFormatString(denomination)
  const d = DENOMINATIONS[denomination] || DENOMINATIONS['as_is']
  const cyDate = yearEnd(activeTB?.period || '')
  const cyLabel = cyDate || 'Current Year'
  const pyLabel = (prevTB?.period ? yearEnd(prevTB.period) : yearBefore(cyDate)) || 'Previous Year'
  const title = 'Profit and Loss Account'
  const rows = []
  const noteLinks = []
  const formulaCells = []
  const sectionTitleRows = []
  const subtotalRows = []
  const netProfitRow = { row: -1 }

  const titleRows = pushTitleRows(rows, entity, `${title} for year ended ${cyDate}`, d.unit)
  rows.push([])
  const headerRow = rows.length
  rows.push(['Particulars', 'Note No.', cyLabel, pyLabel])
  rows.push([])

  const layout = computeNonCorpPLLayout(data, entity?.constitution_display, data?.manualTaxLines || [])
  for (const item of layout.items) {
    const rowIdx = rows.length
    switch (item.kind) {
      case 'manual':
        rows.push([`   (${item.alpha}) ${item.label}`, '', scale(item.cy), scale(item.py)])
        break
      case 'addline':
        break
      case 'row': {
        rows.push([`${item.roman}. ${item.label}`, item.noteNum || '', scale(item.cy), scale(item.py)])
        if (item.noteNum) { noteLinks.push({ row: rowIdx, col: 1, noteNum: item.noteNum }); formulaCells.push({ rowIdx, noteNum: item.noteNum }) }
        break
      }
      case 'uncat':
        rows.push([`   ${item.label}`, '', scale(item.cy), scale(item.py)])
        break
      case 'sub': {
        rows.push([`   (${item.alpha}) ${item.label}`, item.noteNum || '', scale(item.cy), scale(item.py)])
        if (item.noteNum) { noteLinks.push({ row: rowIdx, col: 1, noteNum: item.noteNum }); formulaCells.push({ rowIdx, noteNum: item.noteNum }) }
        break
      }
      case 'subtotal':
        subtotalRows.push(rowIdx)
        rows.push([`   ${item.label}`, '', scale(item.cy), scale(item.py)])
        rows.push([])
        break
      case 'header':
        sectionTitleRows.push(rowIdx)
        rows.push([`${item.roman}. ${item.label}`])
        break
      case 'total':
        subtotalRows.push(rowIdx)
        rows.push([`${item.roman}. ${item.label}`, '', scale(item.cy), scale(item.py)])
        break
      case 'grandtotal':
        netProfitRow.row = rowIdx
        rows.push([`${item.roman}. ${item.label}`, '', scale(item.cy), scale(item.py)])
        rows.push([])
        break
    }
  }
  const lastRow = rows.length - 1

  addSignatureBlock(rows, rows, entity, auditor, signatories, signPlace, signDate)

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 55 }, { wch: 10 }, { wch: 22 }, { wch: 22 }]

  for (const addr in ws) {
    if (typeof addr !== 'string' || addr.startsWith('!')) continue
    const cell = ws[addr]
    if (!cell || typeof cell !== 'object') continue
    if (addr.match(/^[CD]\d+$/) && typeof cell.v === 'number') cell.z = numFmt
  }
  styleTitleRows(ws, titleRows, 4)
  for (let c = 0; c <= 3; c++) {
    setCellStyle(ws, ensureCell(ws, c, headerRow), {
      font: { bold: true, sz: 11 }, fill: FILL_HDR,
      border: { top: { style: 'thin', color: { rgb: '000000' } }, bottom: { style: 'thin', color: { rgb: '000000' } } },
      alignment: { vertical: 'center', horizontal: c === 1 ? 'center' : (c >= 2 ? 'right' : 'left') },
    })
  }
  centerColumn(ws, 1, headerRow + 1, lastRow)
  for (const str of sectionTitleRows) {
    styleRowFull(ws, str, [0, 1, 2, 3], {
      font: { bold: true, sz: 11, color: { rgb: '1E40AF' } },
      fill: { fgColor: { rgb: 'DBEAFE' } },
      border: { top: { style: 'thin', color: { rgb: '000000' } }, bottom: { style: 'thin', color: { rgb: '000000' } } },
    })
  }
  for (const sr of subtotalRows) {
    styleRowFull(ws, sr, [0, 1, 2, 3], {
      font: { bold: true, color: { rgb: '1E40AF' } },
      fill: FILL_SUB,
      border: { top: { style: 'thin', color: { rgb: '94A3B8' } } },
    })
  }
  if (netProfitRow.row >= 0) {
    styleRowFull(ws, netProfitRow.row, [0, 1, 2, 3], {
      font: { bold: true, sz: 11 },
      fill: FILL_NONE,
      border: BORDER_BOTTOM_DOUBLE,
    })
  }

  patchNoteFormulaCells(ws, formulaCells, notesCyTotalMap, data.notes, scale, numFmt)

  applyBoxBorder(ws, headerRow, lastRow, 0, 3)
  for (const link of noteLinks) {
    const noteRow = noteStartRows.get(link.noteNum)
    if (noteRow != null) {
      const cellAddr = XLSX.utils.encode_cell({ c: link.col, r: link.row })
      linkTo(ws, cellAddr, 'Notes', XLSX.utils.encode_cell({ c: 0, r: noteRow }), `Go to Note ${link.noteNum}`)
    }
  }
  applyPrintSetup(ws)
  return ws
}

function buildPLSheet(entity, activeTB, prevTB, data, { denomination, auditor, signatories, noteStartRows, notesCyTotalMap, levelFormat, signPlace, signDate }) {
  const constitution = entity?.constitution
  // Individual/Proprietorship/Partnership: fixed ICAI non-corporate PL sequence.
  // Company and LLP keep the dynamic Schedule III rendering below, untouched.
  if (parseInt(constitution) === 1) {
    return buildNonCorpPLSheet(entity, activeTB, prevTB, data, { denomination, auditor, signatories, noteStartRows, notesCyTotalMap, signPlace, signDate })
  }

  const scale = scaleFn(denomination)
  const numFmt = numFormatString(denomination)
  const d = DENOMINATIONS[denomination] || DENOMINATIONS['as_is']
  const cyDate = yearEnd(activeTB?.period || '')
  const cyLabel = cyDate || 'Current Year'
  const pyLabel = (prevTB?.period ? yearEnd(prevTB.period) : yearBefore(cyDate)) || 'Previous Year'
  const title = constitution === 1 ? 'Profit and Loss Account' : 'Statement of Profit and Loss'
  const rows = []
  const noteLinks = []
  const formulaCells = []
  const sectionTitleRows = []
  const subtotalRows = []
  const netProfitRow = { row: -1 }
  const epsRedCells = []   // {r, c} — a Basic/Diluted EPS cell with no override and missing Share Capital shares
  const epsWarnRows = []   // row index of the "Fill in Share Capital" caution line, if shown

  const titleRows = pushTitleRows(rows, entity, `${title} for year ended ${cyDate}`, d.unit)
  rows.push([])
  const headerRow = rows.length
  rows.push(['Particulars', 'Note No.', cyLabel, pyLabel])
  rows.push([])

  // ── Mirror PL component exactly: use the shared EXPENSE_LINES buckets ──────
  const expSections = data.expenseSections || []
  const incSections = data.incomeSections  || []

  // Build expense buckets (same logic as PL component)
  const buckets = {}
  EXPENSE_LINES.forEach(el => { buckets[el.key] = { total: 0, prevTotal: 0, noteNum: null } })

  // useFinancials.js's processRows() already splits stock movement into
  // "Cost of materials consumed" vs "Changes in inventories" (see
  // utils/inventorySplit.js) and folds legacy Opening/Closing Stock (PL)
  // buckets into that corrected total — don't recompute Opening − Closing
  // here too, or legacy-structure entities would double-count it.
  const openSec    = expSections.find(s => /opening stock/i.test(s.level1))
  const closeSec   = incSections.find(s => /closing stock/i.test(s.level1))
  const changesSec = expSections.find(s => /changes in inventor/i.test(s.level1))
  buckets['inv_changes'].total     = changesSec?.total     || 0
  buckets['inv_changes'].prevTotal = changesSec?.prevTotal || 0
  buckets['inv_changes'].noteNum   = changesSec?.noteNum || openSec?.noteNum || closeSec?.noteNum || null

  const skipL1 = new Set([openSec?.level1, closeSec?.level1, changesSec?.level1].filter(Boolean))
  const uncatExpSecs = []
  for (const sec of expSections) {
    if (skipL1.has(sec.level1)) continue
    if (/tax expense/i.test(sec.level1) || /exceptional|extraordinary/i.test(sec.level1) || /discontinuing/i.test(sec.level1)) continue   // own lines below
    if (/uncategorised/i.test(sec.level1)) { uncatExpSecs.push(sec); continue }
    let matched = false
    for (const el of EXPENSE_LINES) {
      if (el.match && el.match.test(sec.level1)) {
        buckets[el.key].total     += sec.total
        buckets[el.key].prevTotal += sec.prevTotal
        if (!buckets[el.key].noteNum) buckets[el.key].noteNum = sec.noteNum
        matched = true; break
      }
    }
    if (!matched) {
      buckets['other_expenses'].total     += sec.total
      buckets['other_expenses'].prevTotal += sec.prevTotal
      if (!buckets['other_expenses'].noteNum) buckets['other_expenses'].noteNum = sec.noteNum
    }
  }

  // Build income values (same logic as PL component)
  const pureIncome   = incSections.filter(s => !/closing stock/i.test(s.level1) && !/exceptional|extraordinary/i.test(s.level1))
  const revSec       = pureIncome.find(s => /revenue from operation/i.test(s.level1))
  const uncatIncSecs = pureIncome.filter(s => /uncategorised/i.test(s.level1))
  const otherInc     = pureIncome.filter(s => !/revenue from operation/i.test(s.level1) && !/uncategorised/i.test(s.level1))

  const totalRevCY   = revSec?.total    || 0
  const totalRevPY   = revSec?.prevTotal || 0
  const otherIncCY   = otherInc.reduce((s, x) => s + x.total,     0)
  const otherIncPY   = otherInc.reduce((s, x) => s + x.prevTotal, 0)
  const uncatIncCY   = uncatIncSecs.reduce((s, x) => s + x.total,     0)
  const uncatIncPY   = uncatIncSecs.reduce((s, x) => s + x.prevTotal, 0)
  const totalIncomeCY = totalRevCY + otherIncCY + uncatIncCY
  const totalIncomePY = totalRevPY + otherIncPY + uncatIncPY

  const uncatExpCY = uncatExpSecs.reduce((s, x) => s + x.total,     0)
  const uncatExpPY = uncatExpSecs.reduce((s, x) => s + x.prevTotal, 0)
  const mainExpCY  = EXPENSE_LINES.reduce((s, el) => s + (buckets[el.key]?.total     || 0), 0) + uncatExpCY
  const mainExpPY  = EXPENSE_LINES.reduce((s, el) => s + (buckets[el.key]?.prevTotal || 0), 0) + uncatExpPY

  // Ordinary tax only — the discontinuing operations' own tax is its own line (XIII).
  const taxSecs    = expSections.filter(s => TAX_SECTION_RX.test((s.level1 || '').trim()))
  const tail       = corpFaceTail(expSections)   // Exceptional, Extraordinary, discontinuing operations — shared with the screen and PDF
  const taxCY    = taxSecs.reduce((s, x) => s + x.total,     0)
  const taxPY    = taxSecs.reduce((s, x) => s + x.prevTotal, 0)
  const exceptCY = tail.exceptional.cy,   exceptPY = tail.exceptional.py
  const extraCY  = tail.extraordinary.cy, extraPY  = tail.extraordinary.py

  const pbt     = totalIncomeCY - mainExpCY - exceptCY - extraCY
  const prevPBT = totalIncomePY - mainExpPY - exceptPY - extraPY
  const pat     = pbt - taxCY
  const prevPAT = prevPBT - taxPY

  // ── Build rows (I–XVI, matching PL component structure) ──────────────────
  // Row positions recorded for live formulas (patched after aoa_to_sheet)
  const pos = {}
  let rn = 0

  // I. Revenue from operations
  rn++
  let rowIdx = rows.length
  pos.rev = rowIdx
  rows.push([`${ROMAN[rn-1]}. Revenue from operations`, revSec?.noteNum || '', scale(totalRevCY), scale(totalRevPY)])
  if (revSec?.noteNum) { noteLinks.push({ row: rowIdx, col: 1, noteNum: revSec.noteNum }); formulaCells.push({ rowIdx, noteNum: revSec.noteNum }) }

  // II. Other income
  rn++
  rowIdx = rows.length
  rows.push([`${ROMAN[rn-1]}. Other income`, otherInc[0]?.noteNum || '', scale(otherIncCY), scale(otherIncPY)])
  if (otherInc[0]?.noteNum) { noteLinks.push({ row: rowIdx, col: 1, noteNum: otherInc[0].noteNum }); formulaCells.push({ rowIdx, noteNum: otherInc[0].noteNum }) }

  // Uncategorised income (only if non-zero)
  if (uncatIncCY || uncatIncPY) {
    rows.push([`   Uncategorised Income`, uncatIncSecs[0]?.noteNum || '', scale(uncatIncCY), scale(uncatIncPY)])
  }
  pos.incLast = rows.length - 1
  rows.push([])

  // III. Total Revenue
  rn++
  subtotalRows.push(rows.length)
  pos.totalRev = rows.length
  rows.push([`${ROMAN[rn-1]}. Total Revenue (I + II)`, '', scale(totalIncomeCY), scale(totalIncomePY)])
  rows.push([])

  // IV. Expenses
  rn++
  sectionTitleRows.push(rows.length)
  rows.push([`${ROMAN[rn-1]}. Expenses`])
  pos.expFirst = rows.length
  for (const el of EXPENSE_LINES) {
    const b = buckets[el.key]
    const noteNum = b?.noteNum || ''
    rowIdx = rows.length
    rows.push([`   ${el.label}`, noteNum, scale(b?.total || 0), scale(b?.prevTotal || 0)])
    if (noteNum) { noteLinks.push({ row: rowIdx, col: 1, noteNum }); formulaCells.push({ rowIdx, noteNum }) }
  }
  if (uncatExpCY || uncatExpPY) {
    rows.push([`   Uncategorised Expenses`, uncatExpSecs[0]?.noteNum || '', scale(uncatExpCY), scale(uncatExpPY)])
  }
  pos.expLast = rows.length - 1
  rows.push([])
  subtotalRows.push(rows.length)
  pos.totalExp = rows.length
  rows.push([`   Total expenses`, '', scale(mainExpCY), scale(mainExpPY)])
  rows.push([])

  // V. Profit before exceptional and extraordinary items and tax
  rn++
  subtotalRows.push(rows.length)
  pos.pbeet = rows.length
  rows.push([`${ROMAN[rn-1]}. Profit before exceptional and extraordinary items and tax (III - IV)`, '', scale(totalIncomeCY - mainExpCY), scale(totalIncomePY - mainExpPY)])

  // VI. Exceptional items
  rn++
  pos.except = rows.length
  rows.push([`${ROMAN[rn-1]}. Exceptional items`, tail.exceptional.noteNum || '', scale(exceptCY), scale(exceptPY)])

  // VII. Profit before extraordinary items and tax
  rn++
  subtotalRows.push(rows.length)
  pos.pbet = rows.length
  rows.push([`${ROMAN[rn-1]}. Profit before extraordinary items and tax (${ROMAN[rn-3]} - ${ROMAN[rn-2]})`, '', scale(totalIncomeCY - mainExpCY - exceptCY), scale(totalIncomePY - mainExpPY - exceptPY)])

  // VIII. Extraordinary items
  rn++
  pos.extra = rows.length
  rows.push([`${ROMAN[rn-1]}. Extraordinary Items`, tail.extraordinary.noteNum || '', scale(extraCY), scale(extraPY)])
  rows.push([])

  // IX. Profit before tax
  rn++
  subtotalRows.push(rows.length)
  pos.pbt = rows.length
  rows.push([`${ROMAN[rn-1]}. Profit before tax (${ROMAN[rn-3]} - ${ROMAN[rn-2]})`, '', scale(pbt), scale(prevPBT)])
  rows.push([])

  // X. Tax expense
  rn++
  sectionTitleRows.push(rows.length)
  rows.push([`${ROMAN[rn-1]}. Tax expense:`])
  pos.taxFirst = rows.length
  if (taxSecs.length > 0) {
    taxSecs.forEach(sec => sec.lines.forEach(line => {
      rowIdx = rows.length
      rows.push([`   ${line.level2 || sec.level1}`, line.noteNum || sec.noteNum || '', scale(line.total), scale(line.prevTotal)])
      const nn = line.noteNum || sec.noteNum
      if (nn) { noteLinks.push({ row: rowIdx, col: 1, noteNum: nn }); formulaCells.push({ rowIdx, noteNum: nn }) }
    }))
  } else {
    rows.push([`   (1) Current tax`, '', scale(0), scale(0)])
    rows.push([`   (2) Deferred tax`, '', scale(0), scale(0)])
  }
  pos.taxLast = rows.length - 1
  rows.push([])

  // XI. Profit for period from continuing operations
  rn++
  subtotalRows.push(rows.length)
  pos.patCont = rows.length
  rows.push([`${ROMAN[rn-1]}. Profit (Loss) for the period from continuing operations (${ROMAN[rn-3]}-${ROMAN[rn-2]})`, '', scale(pat), scale(prevPAT)])

  // XII. Profit/(loss) from discontinuing operations
  rn++
  pos.disc = rows.length
  rows.push([`${ROMAN[rn-1]}. Profit/(loss) from discontinuing operations`, tail.discProfit.noteNum || '', scale(tail.discProfit.cy), scale(tail.discProfit.py)])

  // XIII. Tax expense of discontinuing operations
  rn++
  pos.discTax = rows.length
  rows.push([`${ROMAN[rn-1]}. Tax expense of discontinuing operations`, tail.discTax.noteNum || '', scale(tail.discTax.cy), scale(tail.discTax.py)])

  // XIV. Profit/(loss) from Discontinuing operations after tax
  rn++
  pos.discPat = rows.length
  rows.push([`${ROMAN[rn-1]}. Profit/(loss) from Discontinuing operations after tax (${ROMAN[rn-3]}-${ROMAN[rn-2]})`, '', scale(tail.discAfterTax.cy), scale(tail.discAfterTax.py)])
  rows.push([])

  // XV. Profit (Loss) for the period
  rn++
  netProfitRow.row = rows.length
  pos.netProfit = rows.length
  rows.push([`${ROMAN[rn-1]}. Profit (Loss) for the period (${ROMAN[rn-5]} + ${ROMAN[rn-2]})`, '', scale(pat + tail.discAfterTax.cy), scale(prevPAT + tail.discAfterTax.py)])
  rows.push([])

  // XVI. Earnings per equity share — Company only (Schedule III)
  if (parseInt(constitution) === 3 && data.eps) {
    const fmtEps = (n) => (n === null || n === undefined || isNaN(n)) ? '' : Number(n).toFixed(2)
    const ov = data.eps.overrides || {}
    const basicCY = ov.basicCY ?? data.eps.autoBasicCY
    const basicPY = ov.basicPY ?? data.eps.autoBasicPY
    const dilutedCY = ov.dilutedCY ?? data.eps.autoDilutedCY
    const dilutedPY = ov.dilutedPY ?? data.eps.autoDilutedPY
    const cyRed = data.eps.sharesMissingCY
    const pyRed = data.eps.sharesMissingPY
    // No Previous Year at all (a first year of operation, or switched off): a dash, like every other line.
    const pyEps = (v, overridden) => fmtEps(v) || (data.eps.pyNotApplicable && !overridden ? '—' : '')

    rn++
    sectionTitleRows.push(rows.length)
    rows.push([`${ROMAN[rn-1]}. Earnings per equity share:`])

    const basicRow = rows.length
    rows.push([`   (1) Basic`, '', fmtEps(basicCY), pyEps(basicPY, ov.basicPY != null)])
    if (cyRed && ov.basicCY == null) epsRedCells.push({ r: basicRow, c: 2 })
    if (pyRed && ov.basicPY == null) epsRedCells.push({ r: basicRow, c: 3 })

    const dilutedRow = rows.length
    rows.push([`   (2) Diluted`, '', fmtEps(dilutedCY), pyEps(dilutedPY, ov.dilutedPY != null)])
    if (cyRed && ov.dilutedCY == null) epsRedCells.push({ r: dilutedRow, c: 2 })
    if (pyRed && ov.dilutedPY == null) epsRedCells.push({ r: dilutedRow, c: 3 })

    if (cyRed || pyRed) {
      epsWarnRows.push(rows.length)
      rows.push([`   ⚠ Number of Equity Shares Issued & Subscribed not found in the Share Capital note's Fill Details — EPS shown in red above until it is filled in.`])
    }
  }
  pos.epsEnd = rows.length - 1

  addSignatureBlock(rows, rows, entity, auditor, signatories, signPlace, signDate)

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 55 }, { wch: 10 }, { wch: 22 }, { wch: 22 }]
  const range = XLSX.utils.decode_range(ws['!ref'])

  for (const addr in ws) {
    if (typeof addr !== 'string' || addr.startsWith('!')) continue
    const cell = ws[addr]
    if (!cell || typeof cell !== 'object') continue
    if (addr.match(/^[CD]\d+$/) && typeof cell.v === 'number') cell.z = numFmt
  }
  // Titles
  styleTitleRows(ws, titleRows, 4)
  // Column header
  for (let c = 0; c <= 3; c++) {
    setCellStyle(ws, ensureCell(ws, c, headerRow), {
      font: { bold: true, sz: 11 }, fill: FILL_HDR,
      border: { top: { style: 'thin', color: { rgb: '000000' } }, bottom: { style: 'thin', color: { rgb: '000000' } } },
      alignment: { vertical: 'center', horizontal: c === 1 ? 'center' : (c >= 2 ? 'right' : 'left') },
    })
  }
  centerColumn(ws, 1, headerRow + 1, pos.epsEnd)
  // Section titles (Income, Expenses, Tax expense) — bold blue band
  for (const str of sectionTitleRows) {
    styleRowFull(ws, str, [0, 1, 2, 3], {
      font: { bold: true, sz: 11, color: { rgb: '1E40AF' } },
      fill: { fgColor: { rgb: 'DBEAFE' } },
      border: { top: { style: 'thin', color: { rgb: '000000' } }, bottom: { style: 'thin', color: { rgb: '000000' } } },
    })
  }
  // Subtotal rows — bold with top border
  for (const sr of subtotalRows) {
    styleRowFull(ws, sr, [0, 1, 2, 3], {
      font: { bold: true, color: { rgb: '1E40AF' } },
      fill: FILL_SUB,
      border: { top: { style: 'thin', color: { rgb: '94A3B8' } } },
    })
  }
  // Net Profit — clean double-bottom border, no background
  if (netProfitRow.row >= 0) {
    styleRowFull(ws, netProfitRow.row, [0, 1, 2, 3], {
      font: { bold: true, sz: 11 },
      fill: FILL_NONE,
      border: BORDER_BOTTOM_DOUBLE,
    })
  }
  // EPS — a cell with no CA override and no Share Capital share count to
  // auto-compute from is left blank AND flagged red, matching the PDF/UI.
  for (const { r, c } of epsRedCells) {
    setCellStyle(ws, ensureCell(ws, c, r), { font: { bold: true, color: { rgb: 'DC2626' } } })
  }
  for (const r of epsWarnRows) {
    styleRowFull(ws, r, [0, 1, 2, 3], { font: { italic: true, color: { rgb: 'DC2626' } } })
  }

  // Patch PL line amount cells with Notes formula references
  patchNoteFormulaCells(ws, formulaCells, notesCyTotalMap, data.notes, scale, numFmt)
  // Subtotal / profit rows as live formulas (I–XVI chain)
  {
    const setF = (r, fC, fD) => {
      for (const [c, f] of [[2, fC], [3, fD]]) {
        const addr = XLSX.utils.encode_cell({ c, r })
        const prev = ws[addr]
        ws[addr] = { t: 'n', f, z: numFmt, s: prev?.s }
      }
    }
    const R = (r) => r + 1  // 0-indexed → Excel row
    setF(pos.totalRev, `SUM(C${R(pos.rev)}:C${R(pos.incLast)})`, `SUM(D${R(pos.rev)}:D${R(pos.incLast)})`)
    setF(pos.totalExp, `SUM(C${R(pos.expFirst)}:C${R(pos.expLast)})`, `SUM(D${R(pos.expFirst)}:D${R(pos.expLast)})`)
    setF(pos.pbeet,   `C${R(pos.totalRev)}-C${R(pos.totalExp)}`, `D${R(pos.totalRev)}-D${R(pos.totalExp)}`)
    setF(pos.pbet,    `C${R(pos.pbeet)}-C${R(pos.except)}`,      `D${R(pos.pbeet)}-D${R(pos.except)}`)
    setF(pos.pbt,     `C${R(pos.pbet)}-C${R(pos.extra)}`,        `D${R(pos.pbet)}-D${R(pos.extra)}`)
    setF(pos.patCont, `C${R(pos.pbt)}-SUM(C${R(pos.taxFirst)}:C${R(pos.taxLast)})`, `D${R(pos.pbt)}-SUM(D${R(pos.taxFirst)}:D${R(pos.taxLast)})`)
    setF(pos.discPat, `C${R(pos.disc)}-C${R(pos.discTax)}`,      `D${R(pos.disc)}-D${R(pos.discTax)}`)
    setF(pos.netProfit, `C${R(pos.patCont)}+C${R(pos.discPat)}`, `D${R(pos.patCont)}+D${R(pos.discPat)}`)
  }
  // Outline box around the statement (side lines), through the EPS rows
  applyBoxBorder(ws, headerRow, pos.epsEnd, 0, 3)
  for (const link of noteLinks) {
    const noteRow = noteStartRows.get(link.noteNum)
    if (noteRow != null) {
      const cellAddr = XLSX.utils.encode_cell({ c: link.col, r: link.row })
      linkTo(ws, cellAddr, 'Notes', XLSX.utils.encode_cell({ c: 0, r: noteRow }), `Go to Note ${link.noteNum}`)
    }
  }
  applyPrintSetup(ws)
  return ws
}

// Notes rendered as their own detail table (auto-derived sub-rows suppressed;
// see buildNotesSheet's _hasFormDetails gate).
// "Cost of Materials Consumed" / "Changes in Inventories" are deliberately
// NOT matched here — they're auto-computed from the Stock tab (see
// utils/inventorySplit.js) and no longer have a Fill Details override, so
// they must always fall through to the normal auto-computed row rendering,
// even if a note_details row for them still exists from before this change.
const isFormDetailNoteTitle = (t) =>
  t.includes('share capital') || t.includes('long-term borrow') || t.includes('long term borrow') ||
  t.includes('short-term borrow') || t.includes('short term borrow') ||
  t.includes("owners' capital") || t.includes('owners capital') || t.includes("partners' capital") || t.includes('partners capital')

function closingOfAcct(f) {
  const n = (v) => parseFloat(v) || 0
  return n(f?.opening) + n(f?.introduced) + n(f?.remuneration) + n(f?.interest) - n(f?.withdrawals) + n(f?.shareOfProfit)
}

// ── Note detail rows for Excel (Share Capital, LTB, Owners'/Partners' Capital) ─
function buildNoteDetailRows(noteTitle, details, noteNum, scale, cyTotal, periodStartStr, periodEndStr, isCompany = false, isNonCorp = false) {
  if (!details) return { rows: [], sectionHdrs: [], colHdrs: [], classHdrs: [], totals: [], errorRows: [], integerCells: [], centerCells: [] }
  const t = (noteTitle || '').toLowerCase()
  const sectionHdrs = [], colHdrs = [], classHdrs = [], totals = [], errorRows = []
  // Cells that must stay whole numbers regardless of the sheet's usual money
  // format — Number of Shares, never "1,00,000.00". {r,c} relative to `rows`;
  // the caller offsets r by baseRow and applies an integer numFmt after the
  // general money-format sweep. Money cells in the same tables (Amount, %)
  // are untouched and keep the sheet's normal 2-decimal format.
  const integerCells = []
  // Cells that must be centered rather than the sheet's usual right-aligned
  // money layout — the Owners'/Partners' Capital table's Share of profit (%)
  // column. Same {r,c}-relative-to-`rows` convention as integerCells above.
  const centerCells = []
  // Paragraph rows — { r, bullet, text } relative to `rows`: merged across the
  // note's columns, wrapped and justified by the caller (Share Capital 1(e)-(l)).
  const paraRows = []
  const rows = []
  const num = (v) => parseFloat(v) || 0
  const fmtAmt = (n) => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  // ── Share Capital ──────────────────────────────────────────────────────────
  if (t.includes('share capital')) {
    if (!details.classes?.length) return { rows, sectionHdrs, colHdrs, classHdrs, totals, errorRows, integerCells, centerCells }
    const fv = (cls) => num(cls.faceValue)
    // Both share-count columns of a Share Capital table sit at col 1 (CY) and
    // col 3 (PY) — 'Particulars', CY Shares, CY Amount, PY Shares, PY Amount.
    const markShareCols = () => { integerCells.push({ r: rows.length - 1, c: 1 }, { r: rows.length - 1, c: 3 }) }

    rows.push([])  // spacer
    // (a) Details
    sectionHdrs.push(rows.length)
    rows.push([`${noteNum}(a)  Details of Share Capital`])
    colHdrs.push(rows.length)
    rows.push(['Particulars', 'CY — No. of Shares', 'CY — Amount (₹)', 'PY — No. of Shares', 'PY — Amount (₹)'])
    for (const cls of details.classes) {
      classHdrs.push(rows.length)
      rows.push([`${cls.name}  (Face Value ₹${cls.faceValue})`, '', '', '', ''])
      for (const [label, field] of [['Authorised','authorised'],['Issued','issued'],['Subscribed','subscribed'],['Subscribed & Fully Paid-up','paidUp']]) {
        const cyS = num(cls.cy?.[field]), pyS = num(cls.py?.[field])
        rows.push([`  ${label}`, cyS || null, cyS ? scale(cyS * fv(cls)) : null, pyS || null, pyS ? scale(pyS * fv(cls)) : null])
        markShareCols()
      }
    }
    rows.push([])

    // ── BS tally check after 1(a) ──────────────────────────────────────────
    if (cyTotal != null) {
      const formCY = details.classes.reduce((s, cls) => s + num(cls.cy?.paidUp) * num(cls.faceValue), 0)
      const mappedCY = Math.abs(cyTotal)
      const diff = Math.abs(Math.abs(formCY) - mappedCY)
      if (diff > 1) {
        errorRows.push(rows.length)
        rows.push([
          `⚠  Balance Sheet Tally Mismatch — Subscribed & Fully Paid-up as per form: ₹${fmtAmt(formCY)}` +
          `  |  As per Mapped Trial Balance: ₹${fmtAmt(mappedCY)}  |  Difference: ₹${fmtAmt(diff)}`
        ])
        rows.push([])
      }
    }

    // (b) Reconciliation
    sectionHdrs.push(rows.length)
    rows.push([`${noteNum}(b)  Reconciliation of Number of Shares`])
    for (const cls of details.classes) {
      colHdrs.push(rows.length)
      rows.push([cls.name, 'CY Shares', 'CY Amount (₹)', 'PY Shares', 'PY Amount (₹)'])
      for (const [label, field] of [['Opening Balance','openingShares'],['Issued during the year','issuedDuringYear'],['Deleted / Bought back','deletedDuringYear']]) {
        const cs = num(cls.cy?.[field]), ps = num(cls.py?.[field])
        rows.push([label, cs || null, cs ? scale(cs * fv(cls)) : null, ps || null, ps ? scale(ps * fv(cls)) : null])
        markShareCols()
      }
      const cyC = num(cls.cy?.openingShares) + num(cls.cy?.issuedDuringYear) - num(cls.cy?.deletedDuringYear)
      const pyC = num(cls.py?.openingShares) + num(cls.py?.issuedDuringYear) - num(cls.py?.deletedDuringYear)
      totals.push(rows.length)
      rows.push(['Closing Balance', cyC || null, cyC ? scale(cyC * fv(cls)) : null, pyC || null, pyC ? scale(pyC * fv(cls)) : null])
      markShareCols()
    }
    rows.push([])

    // (c) 5% shareholders
    if (details.shareholders5pctEquity?.length) {
      sectionHdrs.push(rows.length)
      rows.push([`${noteNum}(c)  Equity Shareholders holding more than 5%`])
      colHdrs.push(rows.length)
      rows.push(['Name of Shareholder', 'CY — No. of Shares', 'CY — % Holding', 'PY — No. of Shares', 'PY — % Holding'])
      for (const s of details.shareholders5pctEquity) {
        rows.push([s.name, s.cyShares || null, s.cyPct != null ? `${s.cyPct}%` : null, s.pyShares || null, s.pyPct != null ? `${s.pyPct}%` : null])
        markShareCols()
      }
      rows.push([])
    }

    // (d) Promoters
    if (details.promoters?.length) {
      sectionHdrs.push(rows.length)
      rows.push([`${noteNum}(d)  Shares held by Promoters`])
      colHdrs.push(rows.length)
      rows.push(['Name of Promoter', 'Class', 'No. of Shares', '% of Total', '% Change'])
      for (const p of details.promoters) {
        rows.push([p.name, p.class, p.shares || null, p.pctTotal != null ? `${p.pctTotal}%` : null, p.pctChange || '—'])
        integerCells.push({ r: rows.length - 1, c: 2 })
      }
      rows.push([])
    }

    // Company: disclosures (e) to (l) (utils/shareCapitalDisclosures.js),
    // each heading followed by its paragraphs; otherwise the old (e) Rights.
    const pushPara = (text, bullet = false) => { paraRows.push({ r: rows.length, bullet, text }); rows.push([bullet ? `•  ${text}` : text]) }
    if (isCompany) {
      const secs = printedDisclosures(details)
      for (const s of secs) {
        sectionHdrs.push(rows.length)
        rows.push([`${noteNum}(${s.key})  ${s.heading}`])
        for (const para of disclosureParagraphs(s.text)) pushPara(para.text, para.bullet)
      }
      if (secs.length) rows.push([])
    } else if (details.rights) {
      sectionHdrs.push(rows.length)
      rows.push([`${noteNum}(e)  Rights, Preferences and Restrictions`])
      pushPara(details.rights)
      rows.push([])
    }

    // Footnotes
    const fns = (details.footnotes || []).filter(f => f?.trim())
    if (fns.length) {
      sectionHdrs.push(rows.length)
      rows.push(['Notes:'])
      fns.forEach((f, i) => pushPara(`${i + 1}. ${f}`))
      rows.push([])
    }

    return { rows, sectionHdrs, colHdrs, classHdrs, totals, errorRows, integerCells, centerCells, paraRows }
  }

  // ── Owners'/Partners' Capital Account ──────────────────────────────────────
  // Individual/Proprietorship/Partnership: single roll-forward table.
  // LLP: two sub-tables — (a) Contribution Account, (b) Current Account.
  if (t.includes("owners' capital") || t.includes('owners capital') || t.includes("partners' capital") || t.includes('partners capital')) {
    if (!details.rows?.length) return { rows, sectionHdrs, colHdrs, classHdrs, totals, errorRows }
    const openLabel = `As at ${fmtOrdinalDate(periodStartStr) || '1st April 20XX'} (Opening Balance)`
    const closeLabel = `As at ${fmtOrdinalDate(periodEndStr) || '31st March 20XX'} (Closing Balance)`
    const partyLabel = details.variant === 'llp' ? 'Partner' : (details.partyLabel || 'Owner')

    // Sole owner (Individual/Proprietorship): Share%, Remuneration and Interest
    // columns are omitted — a single owner takes 100% of the PL net profit directly.
    const isSingleOwner = !!details.isSingleOwner
    const pushAcctTable = (label, acctRows, py, showAgreed) => {
      // 'Sr.', 'Name', [Agreed contribution], Share of profit (%), ... — the
      // same column position this function's own header/data rows below use.
      const sharePctCol = 2 + (showAgreed ? 1 : 0)
      if (label) { sectionHdrs.push(rows.length); rows.push([label]) }
      colHdrs.push(rows.length)
      rows.push([
        'Sr.', `Name of ${partyLabel}`,
        ...(showAgreed ? ['Agreed contribution'] : []),
        ...(isSingleOwner ? [] : ['Share of profit/(loss) (%)']), openLabel, 'Introduced/contributed during the year',
        ...(isSingleOwner ? [] : ['Remuneration for the year', 'Interest for the year']), 'Withdrawals during the year',
        `Share of Profit/Loss for the year${isSingleOwner ? ' (from P&L)' : ''}`, closeLabel,
      ])
      acctRows.forEach((r, i) => {
        rows.push([
          i + 1, r.name || '',
          ...(showAgreed ? [num(r.agreedContribution) || null] : []),
          ...(isSingleOwner ? [] : [r.sharePct !== '' && r.sharePct != null ? num(r.sharePct) : null]),
          scale(num(r.opening)) || null, scale(num(r.introduced)) || null,
          ...(isSingleOwner ? [] : [scale(num(r.remuneration)) || null, scale(num(r.interest)) || null]),
          scale(num(r.withdrawals)) || null, scale(num(r.shareOfProfit)) || null,
          scale(closingOfAcct(r)),
        ])
        if (!isSingleOwner) centerCells.push({ r: rows.length - 1, c: sharePctCol })
      })
      totals.push(rows.length)
      const sum = (f) => acctRows.reduce((s, r) => s + num(r[f]), 0)
      rows.push([
        '', 'Total',
        ...(showAgreed ? [scale(acctRows.reduce((s, r) => s + num(r.agreedContribution), 0)) || null] : []),
        ...(isSingleOwner ? [] : [null]), scale(sum('opening')), scale(sum('introduced')),
        ...(isSingleOwner ? [] : [scale(sum('remuneration')), scale(sum('interest'))]),
        scale(sum('withdrawals')), scale(sum('shareOfProfit')),
        scale(acctRows.reduce((s, r) => s + closingOfAcct(r), 0)),
      ])
      classHdrs.push(rows.length)
      rows.push([
        '', 'Previous Year (PY)',
        ...(showAgreed ? [null] : []),
        ...(isSingleOwner ? [] : [null]), scale(num(py?.opening)), scale(num(py?.introduced)),
        ...(isSingleOwner ? [] : [scale(num(py?.remuneration)), scale(num(py?.interest))]),
        scale(num(py?.withdrawals)), scale(num(py?.shareOfProfit)),
        scale(closingOfAcct(py)),
      ])
      rows.push([])
    }

    rows.push([])
    if (details.variant === 'llp') {
      pushAcctTable(`${noteNum}(a)  Partners Contribution Account`,
        details.rows.map(r => ({ name: r.name, agreedContribution: r.agreedContribution, ...r.contrib })),
        details.pyContrib, true)
      pushAcctTable(`${noteNum}(b)  Partners Current Account`,
        details.rows.map(r => ({ name: r.name, ...r.current })),
        details.pyCurrent, false)

      if (cyTotal != null) {
        const formCY = details.rows.reduce((s, r) => s + closingOfAcct(r.contrib) + closingOfAcct(r.current), 0)
        const mappedCY = Math.abs(cyTotal)
        const diff = Math.abs(Math.abs(formCY) - mappedCY)
        if (diff > 1) {
          errorRows.push(rows.length)
          rows.push([`⚠  Balance Sheet Tally Mismatch — Contribution + Current Account as per form: ₹${fmtAmt(formCY)}` +
            `  |  As per Mapped Trial Balance: ₹${fmtAmt(mappedCY)}  |  Difference: ₹${fmtAmt(diff)}`])
          rows.push([])
        }
      }
    } else {
      pushAcctTable(null, details.rows, details.py, false)

      if (cyTotal != null) {
        const formCY = details.rows.reduce((s, r) => s + closingOfAcct(r), 0)
        const mappedCY = Math.abs(cyTotal)
        const diff = Math.abs(Math.abs(formCY) - mappedCY)
        if (diff > 1) {
          errorRows.push(rows.length)
          rows.push([`⚠  Balance Sheet Tally Mismatch — Closing Balance as per form: ₹${fmtAmt(formCY)}` +
            `  |  As per Mapped Trial Balance: ₹${fmtAmt(mappedCY)}  |  Difference: ₹${fmtAmt(diff)}`])
          rows.push([])
        }
      }
    }

    return { rows, sectionHdrs, colHdrs, classHdrs, totals, errorRows, centerCells }
  }

  // ── Long-Term Borrowings ───────────────────────────────────────────────────
  if (t.includes('long-term borrow') || t.includes('long term borrow')) {
    const loans = details.loans || []
    if (!loans.length) return { rows, sectionHdrs, colHdrs, classHdrs, totals }

    // Group by lender
    const byLender = {}
    for (const l of loans) {
      const key = l.lenderPrintName || l.tbLedger || 'Unknown'
      if (!byLender[key]) byLender[key] = { nature: l.nature, su: l.securedUnsecured, grossCY: 0, cmCY: 0, grossPY: 0, cmPY: 0 }
      byLender[key].grossCY += num(l.grossCY)
      byLender[key].cmCY   += num(l.currentMaturityCY)
      byLender[key].grossPY += num(l.grossPY)
      byLender[key].cmPY   += num(l.currentMaturityPY)
    }

    rows.push([])
    sectionHdrs.push(rows.length)
    rows.push([`${noteNum}.  Details of Long-Term Borrowings`])
    colHdrs.push(rows.length)
    rows.push(['Lender', 'Nature', 'Sec / Unsec', 'Current Year — Net Long-Term', 'Previous Year — Net Long-Term'])

    let totNetCY = 0, totNetPY = 0
    for (const [lender, g] of Object.entries(byLender)) {
      const netCY = g.grossCY - g.cmCY, netPY = g.grossPY - g.cmPY
      totNetCY += netCY; totNetPY += netPY
      rows.push([lender, g.nature, g.su, scale(netCY), scale(netPY)])
    }
    totals.push(rows.length)
    rows.push(['Total', '', '', scale(totNetCY), scale(totNetPY)])
    rows.push([])

    // Repayment
    const tabRepay = loans.filter(l => l.repaymentFormat !== 'paragraph' && (l.roi || l.emi || l.frequency))
    const paraRepay = loans.filter(l => l.repaymentFormat === 'paragraph' && l.repaymentParagraph)
    if ((tabRepay.length || paraRepay.length) && details.printRepayment !== false) {
      sectionHdrs.push(rows.length)
      rows.push(['Terms of Repayment'])
      if (tabRepay.length) {
        colHdrs.push(rows.length)
        rows.push(['Lender', 'Rate of Interest', 'Instalment Amount', 'Frequency', 'Final Maturity Date'])
        for (const l of tabRepay) {
          rows.push([l.lenderPrintName || l.tbLedger, l.roi || '—', l.emi ? scale(l.emi) : null, l.frequency || '—', toDDMMYYYY(l.finalMaturityDate) || '—'])
        }
      }
      for (const l of paraRepay) {
        rows.push([`${l.lenderPrintName || l.tbLedger}: ${l.repaymentParagraph}`])
      }
      rows.push([])
    }

    // Security
    const tabSec = loans.filter(l => l.securityFormat !== 'paragraph' && (l.natureOfSecurity || l.guarantee))
    const paraSec = loans.filter(l => l.securityFormat === 'paragraph' && l.securityParagraph)
    if ((tabSec.length || paraSec.length) && details.printSecurity !== false) {
      sectionHdrs.push(rows.length)
      rows.push(['Security Details'])
      if (tabSec.length) {
        colHdrs.push(rows.length)
        rows.push(['Lender', 'Sec / Unsec', 'Nature of Security', 'Guarantee', 'Charge Ranking'])
        for (const l of tabSec) {
          rows.push([l.lenderPrintName || l.tbLedger, l.su, l.natureOfSecurity || '—', l.guarantee || '—', l.chargeRanking || '—'])
        }
      }
      for (const l of paraSec) {
        rows.push([`${l.lenderPrintName || l.tbLedger}: ${l.securityParagraph}`])
      }
      rows.push([])
    }

    return { rows, sectionHdrs, colHdrs, classHdrs, totals, errorRows }
  }

  // ── Short-Term Borrowings ──────────────────────────────────────────────────
  // No "Current Maturities" concept — short-term borrowings are current by
  // nature (see Notes/ShortTermBorrowingsForm.jsx's header comment) — trimmed
  // mirror of the Long-Term Borrowings block above without the gross/
  // current-maturity/net-LT split or the instalment-schedule columns.
  if (t.includes('short-term borrow') || t.includes('short term borrow')) {
    const loans = details.loans || []
    if (!loans.length) return { rows, sectionHdrs, colHdrs, classHdrs, totals }

    const byLender = {}
    for (const l of loans) {
      const key = l.lenderPrintName || l.tbLedger || 'Unknown'
      if (!byLender[key]) byLender[key] = { nature: l.nature, su: l.securedUnsecured, grossCY: 0, grossPY: 0 }
      byLender[key].grossCY += num(l.grossCY)
      byLender[key].grossPY += num(l.grossPY)
    }

    rows.push([])
    sectionHdrs.push(rows.length)
    rows.push([`${noteNum}.  Details of Short-Term Borrowings`])
    colHdrs.push(rows.length)
    rows.push(['Lender', 'Nature', 'Sec / Unsec', 'Current Year', 'Previous Year'])

    let totCY = 0, totPY = 0
    for (const [lender, g] of Object.entries(byLender)) {
      totCY += g.grossCY; totPY += g.grossPY
      rows.push([lender, g.nature, g.su, scale(g.grossCY), scale(g.grossPY)])
    }
    totals.push(rows.length)
    rows.push(['Total', '', '', scale(totCY), scale(totPY)])
    rows.push([])

    // Repayment
    const tabRepay = loans.filter(l => l.repaymentFormat !== 'paragraph' && (l.roi || l.frequency || l.repaymentRemarks))
    const paraRepay = loans.filter(l => l.repaymentFormat === 'paragraph' && l.repaymentParagraph)
    if ((tabRepay.length || paraRepay.length) && details.printRepayment !== false) {
      sectionHdrs.push(rows.length)
      rows.push(['Terms of Repayment'])
      if (tabRepay.length) {
        colHdrs.push(rows.length)
        rows.push(['Lender', 'Rate of Interest', 'Frequency', 'Remarks'])
        for (const l of tabRepay) {
          rows.push([l.lenderPrintName || l.tbLedger, l.roi || '—', l.frequency || '—', l.repaymentRemarks || ''])
        }
      }
      for (const l of paraRepay) {
        rows.push([`${l.lenderPrintName || l.tbLedger}: ${l.repaymentParagraph}`])
      }
      rows.push([])
    }

    // Security
    const tabSec = loans.filter(l => l.securityFormat !== 'paragraph' && (l.natureOfSecurity || l.guarantee))
    const paraSec = loans.filter(l => l.securityFormat === 'paragraph' && l.securityParagraph)
    if ((tabSec.length || paraSec.length) && details.printSecurity !== false) {
      sectionHdrs.push(rows.length)
      rows.push(['Security Details'])
      if (tabSec.length) {
        colHdrs.push(rows.length)
        rows.push(['Lender', 'Sec / Unsec', 'Nature of Security', 'Guarantee', 'Charge Ranking'])
        for (const l of tabSec) {
          rows.push([l.lenderPrintName || l.tbLedger, l.securedUnsecured, l.natureOfSecurity || '—', l.guarantee || '—', l.chargeRanking || '—'])
        }
      }
      for (const l of paraSec) {
        rows.push([`${l.lenderPrintName || l.tbLedger}: ${l.securityParagraph}`])
      }
      rows.push([])
    }

    return { rows, sectionHdrs, colHdrs, classHdrs, totals, errorRows }
  }

  // ── Cash & Bank Balances — supplementary disclosure ────────────────────────
  // Only emitted when there's actually something to say — either the CA
  // ticked "Always include" or at least one item has a non-zero CY/PY
  // amount (same gate as the PDF renderer / the form's own "Default
  // behavior" copy). Unlike Share Capital/LTB/STB, this note is NOT in
  // isFormDetailNoteTitle — it's a supplementary table below the note's
  // normal auto-computed rows, not a replacement for them (see
  // CashBankDetailsForm.jsx's own "included above" subtitle).
  if (t.includes('cash') && t.includes('bank')) {
    if (!details.items) return { rows, sectionHdrs, colHdrs, classHdrs, totals }
    const hasCY = CASH_BANK_ITEMS.some(item => num(details.items[item.key]?.amount) !== 0)
    // Previous Year is a later addition to this form — the column is only
    // added at all when at least one item actually carries a PY figure,
    // rather than always printing an empty PY column.
    const hasPY = CASH_BANK_ITEMS.some(item => num(details.items[item.key]?.amountPY) !== 0)
    if (!hasCY && !hasPY && !details.blankFormat) return { rows, sectionHdrs, colHdrs, classHdrs, totals }   // blankFormat: Features > Format shows the empty table

    // Part of the Cash and Bank Balances note — no note number of its own.
    rows.push([])
    sectionHdrs.push(rows.length)
    rows.push(['    Other Details relating to Cash and Bank Balances included above'])
    // Particulars across the wide columns A:B (wrapped), the amounts under
    // the note's own Current Year / Previous Year columns, Remarks last. The
    // particulars used to sit in narrow column B and were cut off.
    colHdrs.push(rows.length)
    rows.push(['Particulars', '', hasPY ? 'Amount (CY)' : 'Amount', hasPY ? 'Amount (PY)' : '', 'Remarks'])
    for (const item of CASH_BANK_ITEMS) {
      const row = details.items[item.key] || {}
      const label = `(${item.key})  ${item.label}`
      paraRows.push({ r: rows.length, text: label, lastCol: 1, align: 'left' })
      rows.push([label, '', scale(num(row.amount)) || null, hasPY ? (scale(num(row.amountPY)) || null) : '', row.remarks || ''])
    }
    rows.push([])

    return { rows, sectionHdrs, colHdrs, classHdrs, totals, errorRows, paraRows }
  }

  // ── Trade Receivables ageing table — Proprietorship / Partnership / LLP ────
  // Always emitted beneath the note (Company has its own schedule below).
  // Defaults to everything in "less than 6 months / Unsecured, considered good"
  // until edited in Fill Details — see utils/tradeReceivablesNonCorp.js. Laid
  // out stacked (ageing heading, then its three categories) so the Amount
  // column lines up with the note's own Current Year column.
  if (t.includes('trade receivable') && isNonCorp) {
    const { values, total } = ncAgeingResolve(details?.ncAgeing, cyTotal)
    rows.push([])
    colHdrs.push(rows.length)
    rows.push([NC_AGEING_TITLE, '', 'Amount'])
    for (const b of NC_AGEING_BLOCKS) {
      classHdrs.push(rows.length)
      rows.push([b.label])
      for (const c of NC_AGEING_CATEGORIES) {
        const v = values[b.key][c.key]
        rows.push([`   ${c.label}`, '', v ? scale(v) : null])
      }
    }
    totals.push(rows.length)
    rows.push(['Total', '', scale(total)])
    rows.push([])
    return { rows, sectionHdrs, colHdrs, classHdrs, totals, errorRows, integerCells, centerCells }
  }

  // ── Trade Payables / Trade Receivables ageing schedules ────────────────────
  // Company-only disclosure requirement — see Notes/index.jsx's Fill Details
  // gating; kept here too so stale ageing data saved before that rule
  // existed doesn't still surface for LLP/Partnership/Proprietorship.
  const isTP = t.includes('trade payable')
  const isTR = t.includes('trade receivable')
  if ((isTP || isTR) && isCompany) {
    // TP saves under details.ageing (combined with MSME); TR saves at top level
    const ag = isTP ? details.ageing : (details.cy ? details : null)
    if (ag && ag.cy) {
      const AG_ROWS = isTP ? TP_AGEING_ROWS : TR_AGEING_ROWS
      const AG_BUCKETS = isTP ? TP_AGEING_BUCKETS : TR_AGEING_BUCKETS
      const cellVal = (pd, row, bKey) =>
        row.computed ? trComputedCell(pd, row.computed, bKey) : num(pd?.[row.key]?.[bKey])
      const buildPeriod = (pd, heading) => {
        if (!pd) return
        const any = AG_ROWS.some(r => AG_BUCKETS.some(b => Math.abs(cellVal(pd, r, b.key)) > 0.005))
        if (!any && !ag.includeInOutput && !details.includeInOutput) return
        rows.push([])
        sectionHdrs.push(rows.length)
        rows.push([`${isTP ? 'Trade Payables' : 'Trade Receivables'} ageing schedule (${heading}) — Outstanding for following periods from due date of payment`])
        colHdrs.push(rows.length)
        rows.push(['Particulars', ...AG_BUCKETS.map(b => b.label), 'Total'])
        for (const r of AG_ROWS) {
          const vals = AG_BUCKETS.map(b => cellVal(pd, r, b.key))
          const tot = vals.reduce((s, v) => s + v, 0)
          if (r.isTotal) totals.push(rows.length)
          rows.push([r.label, ...vals.map(v => (v ? scale(v) : null)), tot ? scale(tot) : null])
        }
      }
      buildPeriod(ag.cy, 'Current Year')
      buildPeriod(ag.py, 'Previous Year')
      if (rows.length) rows.push([])
    }
    return { rows, sectionHdrs, colHdrs, classHdrs, totals, errorRows }
  }

  // "Cost of Materials Consumed" / "Changes in Inventories" are deliberately
  // NOT dispatched here any more — they're auto-computed from the Stock tab
  // (see utils/inventorySplit.js); rendering old saved note_details for them
  // would show stale, possibly-divergent figures alongside the correct
  // auto-computed table.

  return { rows, sectionHdrs, colHdrs, classHdrs, totals, errorRows }
}

// ── Build Notes sheet + track note start rows for linking ──────────────────
// Returns { ws, notesCyTotalMap: Map<noteNum, { cyRow, pyRow }> }
// Each sub-note LINE (Level 2 for PL notes) links straight to its Annexures
// sub-note subtotal cell (annexSubnoteTotalMap) instead of carrying a static
// value — the note's own Total is then a SUM() of those line cells, computed
// HERE in the Notes sheet, not a link to Annexures' total row. That's the
// chain the CA asked for: edit a ledger in Annexures → its group's SUM
// recalculates → the Notes line (a direct reference) updates → the Notes
// Total (a SUM of its own lines) updates → BS/PL (already linked to Notes
// totals) updates.
function buildNotesSheet(entity, activeTB, prevTB, data, { denomination, auditor, signatories, annexStartRows, annexTotalMap, annexSubnoteTotalMap = new Map(), noteStartRows, noteDetailsMap = {}, noteDisclosureMap = {}, signPlace, signDate }) {
  const scale = scaleFn(denomination)
  const numFmt = numFormatString(denomination)
  const isCompany = parseInt(entity?.constitution) === 3
  const isNonCorp12 = [1, 2].includes(parseInt(entity?.constitution))
  const d = DENOMINATIONS[denomination] || DENOMINATIONS['as_is']
  const rows = []
  const titleLinks = []   // { row, col, noteNum }  — title linked to annexure
  const totalLinks = []   // same — total amount cell linked to annexure
  const noteTitleRows = [] // for bold styling
  const totalRows = []     // for bold+border styling
  const subtotalRows = []  // L3 rows in BS notes
  const underlineRows = []  // "Less: Closing …" PL lines — Opening minus this = the subtotal below it
  const disclosureRows = []  // optional free-text disclosure rows — italic, muted
  const lineFormulaPatches = []  // { r, col, formula } — sub-note lines linked to Annexures subtotal cells
  const notesCyTotalMap = new Map()  // noteNum → { cyRow, pyRow } in this Notes sheet

  const cyDate = yearEnd(activeTB?.period || '')
  const titleRows = pushTitleRows(rows, entity, `Notes to Financial Statements for the year ended ${cyDate}`, d.unit)
  rows.push([])

  // Single column header for the whole sheet
  const mainHeaderRow = rows.length
  const cyColLabel = cyDate || 'Current Year'
  const pyColLabel = (prevTB?.period ? yearEnd(prevTB.period) : yearBefore(cyDate)) || 'Previous Year'
  rows.push(['Particulars', '', cyColLabel, pyColLabel])
  rows.push([])

  // Per-note detail styling trackers (for Share Capital / LTB sub-tables)
  const detailSectionHdrRows = []  // bold blue, light fill
  const detailColHdrRows = []      // bold, bottom border
  const detailClassHdrRows = []    // bold, very light fill
  const detailTotalRows = []       // bold, double bottom border
  const detailErrorRows = []       // red bg, bold — tally mismatch warning
  const detailIntegerCells = []    // { row, col } — Number of Shares etc.; whole numbers, never the sheet's usual 2-decimal money format
  const detailCenterCells = []     // { row, col } — Share of profit (%) etc.; centered instead of the sheet's usual right-aligned money layout
  const detailParaRows = []        // { row, bullet, text } — paragraphs merged A:E, wrapped and justified

  // IT Act Block-wise WDV Summary (opt-in from Dep (IT) → Block Summary)
  const itBlockSummaryColHdrRows = []
  const itBlockSummaryTotalRows = []
  const itBlockSummaryPyRows = []

  // Dep (Comp) category-level Schedule II schedule (opt-in from Dep (Comp))
  const compScheduleColHdrRows = []
  const compScheduleTotalRows = []
  const compSchedulePyRows = []
  const compScheduleRecoRows = []

  const periodStartStr = yearStart(activeTB?.period || '')
  const periodEndStr = yearEnd(activeTB?.period || '')

  const notes = data.activeNotes || Object.values(data.notes)
  const noteBlocks = []  // { start, end, lastCol } — for outline box borders per note
  for (const note of notes) {
    trimToOneBlankRow(rows)
    const noteTitleRow = rows.length
    noteStartRows.set(note.num, noteTitleRow)
    rows.push([`Note ${note.num}: ${note.displayTitle || note.title}`])
    noteTitleRows.push(noteTitleRow)
    titleLinks.push({ row: noteTitleRow, col: 0, noteNum: note.num })

    // For notes with filled form details, skip auto-derived sub-rows (details appear below Total)
    const _noteTitle = (note.title || '').toLowerCase()
    const _hasFormDetails = noteDetailsMap[note.num] && isFormDetailNoteTitle(_noteTitle)
    // Row indices of this note's own sub-note lines — if populated, the Total
    // row below sums THESE (a formula within this sheet) instead of linking
    // to Annexures' total row. Left empty falls back to the old behaviour
    // (link to Annexures total, or a static value if Annexures has neither).
    const noteLineRows = []
    const subnoteMap = annexSubnoteTotalMap.get(note.num)
    // PPE note: when the IT Act Block-wise WDV Summary or the Dep (Comp)
    // category-level schedule is present (mutually exclusive by
    // construction), it supersedes the plain "Property, Plant & Equipment /
    // Total" sub-row — same suppression as the live Notes screen. Total row
    // is left to fall back to Annexures' own link (noteLineRows stays
    // empty), so the BS sheet's cross-sheet reference to this note's total
    // is unaffected.
    const isPPEWithITBlock = note.itBlockSummaryData && note.itBlockSummaryData.length > 0
    const isPPEWithCompSchedule = note.compScheduleData && note.compScheduleData.length > 0
    const isPPEWithSchedule = isPPEWithITBlock || isPPEWithCompSchedule

    if (_hasFormDetails) {
      // No sub-rows — form detail tables will be appended after Total
    } else if (note.isPL) {
      // Same lines as the Notes screen and the PDF (plNoteLines) — including
      // a line with no Level 2, under its fallback label; leaving it out made
      // this note's Total, and the P&L cell linked to it, wrong.
      // Rows accumulated since the last subtotal (or the start of this
      // note) — a `isSubtotal` line (e.g. "Change in Inventory of …") sums
      // THESE, as a local in-sheet formula, then resets. It is NOT its own
      // Annexures-linked sub-note (see annexureGrouping.js) and is NOT
      // added to noteLineRows, so the note's own Total doesn't double it.
      let sinceSubtotal = []
      for (const { line, label } of plNoteLines(note)) {
        if (/^less:\s*closing/i.test(label)) underlineRows.push(rows.length)
        const lineRow = rows.length
        rows.push([`  ${label}`, '', scale(line.total), scale(line.prevTotal)])
        if (line.isSubtotal) {
          if (sinceSubtotal.length > 0) {
            lineFormulaPatches.push({ r: lineRow, col: 2, formula: `SUM(${sinceSubtotal.map(r => `C${r + 1}`).join(',')})` })
            lineFormulaPatches.push({ r: lineRow, col: 3, formula: `SUM(${sinceSubtotal.map(r => `D${r + 1}`).join(',')})` })
          }
          sinceSubtotal = []
          // Not pushed to noteLineRows — it's a derived figure, already
          // counted via the lines it sums; including it too would double it.
        } else {
          const annexLine = subnoteMap?.get(label)
          if (annexLine) {
            // Annexures always shows a sub-note's natural positive ledger
            // magnitude; a "Less: …" line needs that SUBTRACTED here —
            // same sign rule as the Annexures Total formula above.
            const sign = /^less:/i.test(label) ? '-' : ''
            lineFormulaPatches.push({ r: lineRow, col: 2, formula: `${sign}Annexures!E${annexLine.cyRow + 1}`, expect: scale(line.total) })
            lineFormulaPatches.push({ r: lineRow, col: 3, formula: `${sign}Annexures!G${annexLine.pyRow + 1}`, expect: scale(line.prevTotal) })
          }
          sinceSubtotal.push(lineRow)
          noteLineRows.push(lineRow)
        }
      }
    } else if (isPPEWithSchedule) {
      // Rows intentionally skipped — see isPPEWithSchedule above.
    } else {
      if (note.templateRows && note.templateRows.length > 0) {
        // Most recently emitted L3 row's Annexures link — an 'l4' row with a
        // fixed (non-slash) label repeats its parent L3's own figure, so it
        // reuses that same reference rather than being its own sub-note group.
        let lastL3Annex = null
        // printNoteRows (same layout as the PDF): a Level 3 whose breakdown
        // adds up to it prints as a header with blank cells, and those lines
        // carry the figures and make up the note's Total; a repeat breakdown
        // of the same figure is dropped. Otherwise the Level 3 keeps its
        // amount and its lines are an analysis of it, not added again.
        for (const r of printNoteRows(note.templateRows.filter(r => !r.screenOnly))) {   // Level 4 / 6 flags are screen-only
          const lineRow = rows.length
          if (r.type === 'l3') {
            subtotalRows.push(lineRow)
            const annexLine = subnoteMap?.get((r.label || '').trim())
            lastL3Annex = annexLine || null
            if (r.header) {
              rows.push([`  ${r.displayLabel || r.label}`, '', '', ''])
              continue
            }
            rows.push([`  ${r.displayLabel || r.label}`, '', scale(r.cy), scale(r.py)])
            if (annexLine) {
              lineFormulaPatches.push({ r: lineRow, col: 2, formula: `Annexures!E${annexLine.cyRow + 1}`, expect: scale(r.cy) })
              lineFormulaPatches.push({ r: lineRow, col: 3, formula: `Annexures!G${annexLine.pyRow + 1}`, expect: scale(r.py) })
            }
            noteLineRows.push(lineRow)
          } else if (r.type === 'l4') {
            // A fixed-label Level 4 repeats its Level 3's own figure, so it
            // reuses that Level 3's Annexures reference.
            rows.push([`    ${r.label}`, '', scale(r.cy), scale(r.py)])
            if (lastL3Annex) {
              lineFormulaPatches.push({ r: lineRow, col: 2, formula: `Annexures!E${lastL3Annex.cyRow + 1}` })
              lineFormulaPatches.push({ r: lineRow, col: 3, formula: `Annexures!G${lastL3Annex.pyRow + 1}` })
            }
            if (r.underHeader) noteLineRows.push(lineRow)
          } else if (r.type === 'option') {
            // Options (Level 4/5/6 splits) aren't their own Annexures group —
            // Annexures only groups down to L3 for BS notes (see
            // utils/annexureGrouping.js) — so they stay static.
            rows.push([r.unclassified ? '      Unclassified' : `      ${r.label}`, '', scale(r.cy), scale(r.py)])
            if (r.underHeader) noteLineRows.push(lineRow)
          }
        }
      } else {
        // Same lines the Notes screen and the PDF show (bsNoteFallbackLines)
        // — a ledger with no Level 3 forms no line.
        for (const l of bsNoteFallbackLines(note, rowAmt)) {
          subtotalRows.push(rows.length)
          const lineRow = rows.length
          const annexLine = subnoteMap?.get(l.label)
          rows.push([`  ${l.label}`, '', scale(l.cy), scale(l.py)])
          if (annexLine) {
            lineFormulaPatches.push({ r: lineRow, col: 2, formula: `Annexures!E${annexLine.cyRow + 1}`, expect: scale(l.cy) })
            lineFormulaPatches.push({ r: lineRow, col: 3, formula: `Annexures!G${annexLine.pyRow + 1}`, expect: scale(l.py) })
          }
          noteLineRows.push(lineRow)
        }
      }
    } // end else (non-form BS note)

    if (_hasFormDetails) {
      // Skip Particulars/Total row — detail tables (1(a), 1(b)…) carry their own totals.
      // Append detail tables directly after the note title row.
      const savedDetails = withStbCurrentMaturities(noteDetailsMap[note.num], note)
      const baseRow = rows.length
      const det = buildNoteDetailRows(note.title, savedDetails, note.num, scale, note.total, periodStartStr, periodEndStr, isCompany, isNonCorp12)
      if (det.rows.length > 0) {
        for (const dr of det.rows) rows.push(dr)
        for (const r of det.sectionHdrs) detailSectionHdrRows.push(baseRow + r)
        for (const r of det.colHdrs)     detailColHdrRows.push(baseRow + r)
        for (const r of det.classHdrs)   detailClassHdrRows.push(baseRow + r)
        for (const r of det.totals)      detailTotalRows.push(baseRow + r)
        for (const r of (det.errorRows || [])) detailErrorRows.push(baseRow + r)
        for (const ic of (det.integerCells || [])) detailIntegerCells.push({ row: baseRow + ic.r, col: ic.c })
        for (const cc of (det.centerCells || [])) detailCenterCells.push({ row: baseRow + cc.r, col: cc.c })
        for (const p of (det.paraRows || [])) detailParaRows.push({ ...p, row: baseRow + p.r })
      }
    } else {
      // Normal note: push Total row + hyperlink, then optional extra detail
      const totalRowIdx = rows.length
      totalRows.push(totalRowIdx)
      notesCyTotalMap.set(note.num, { cyRow: totalRowIdx, pyRow: totalRowIdx })
      // Prefer summing THIS note's own sub-note lines (a formula within this
      // sheet — see noteLineRows above); fall back to linking Annexures'
      // note-level total, then to a static value if neither is available.
      const annexInfo = annexTotalMap?.get(note.num)
      let cyCell, pyCell
      if (noteLineRows.length > 0) {
        const cySum = `SUM(${noteLineRows.map(r => `C${r + 1}`).join(',')})`
        const pySum = `SUM(${noteLineRows.map(r => `D${r + 1}`).join(',')})`
        cyCell = { t: 'n', f: cySum, z: numFmt }
        pyCell = { t: 'n', f: pySum, z: numFmt }
      } else if (annexInfo) {
        cyCell = { t: 'n', f: `Annexures!E${annexInfo.cyRow + 1}`, z: numFmt, expect: scale(note.total) }
        pyCell = { t: 'n', f: `Annexures!G${annexInfo.pyRow + 1}`, z: numFmt, expect: scale(note.prevTotal) }
      } else {
        cyCell = { t: 'n', v: scale(note.total), z: numFmt }
        pyCell = { t: 'n', v: scale(note.prevTotal), z: numFmt }
      }
      rows.push(['Total', '', null, null])  // placeholders; real cells set below
      // Override the last two cells with formula cells
      const lastRowIdx = rows.length - 1
      // We'll patch these after aoa_to_sheet by using a post-processing step.
      // Store instructions for patching:
      totalLinks.push({ row: totalRowIdx, col: 2, noteNum: note.num, cyCell, pyCell,
        cyExpect: cyCell?.expect, pyExpect: pyCell?.expect })

      // Other note types with extra detail (future extensibility)
      const savedDetails = withStbCurrentMaturities(noteDetailsMap[note.num], note)
      // Trade receivables of a Proprietorship / Partnership / LLP always carries
      // its ageing table (defaulting to Unsecured, considered good), saved or not.
      const isNcTradeReceivables = isNonCorp12 && /trade.*receivable/i.test(note.title || '')
      if (savedDetails || isNcTradeReceivables) {
        const baseRow = rows.length
        const det = buildNoteDetailRows(note.title, savedDetails || {}, note.num, scale, note.total, periodStartStr, periodEndStr, isCompany, isNonCorp12)
        if (det.rows.length > 0) {
          for (const dr of det.rows) rows.push(dr)
          for (const r of det.sectionHdrs) detailSectionHdrRows.push(baseRow + r)
          for (const r of det.colHdrs)     detailColHdrRows.push(baseRow + r)
          for (const r of det.classHdrs)   detailClassHdrRows.push(baseRow + r)
          for (const r of det.totals)      detailTotalRows.push(baseRow + r)
          for (const r of (det.errorRows || [])) detailErrorRows.push(baseRow + r)
          for (const ic of (det.integerCells || [])) detailIntegerCells.push({ row: baseRow + ic.r, col: ic.c })
          for (const cc of (det.centerCells || [])) detailCenterCells.push({ row: baseRow + cc.r, col: cc.c })
          for (const p of (det.paraRows || [])) detailParaRows.push({ ...p, row: baseRow + p.r })
        }
      }

      // IT Act Block-wise WDV Summary — opt-in from Dep (IT) → Block Summary.
      // Sourced from note.itBlockSummaryData (attached in useFinancials.js),
      // not noteDetailsMap, so it's independent of the Fill-Details mechanism.
      if (note.itBlockSummaryData && note.itBlockSummaryData.length > 0) {
        const num = v => parseFloat(v) || 0
        rows.push([])
        itBlockSummaryColHdrRows.push(rows.length)
        rows.push(['Particulars', 'Rate', 'Opening WDV', 'Additions', 'Deduction', 'Depreciation', 'Closing WDV'])
        const itTotals = { openingWDV: 0, additions: 0, deduction: 0, depreciation: 0, closingWDV: 0 }
        for (const b of note.itBlockSummaryData) {
          const additions = num(b.addBefore180) + num(b.addAfter180)
          itTotals.openingWDV += num(b.openingWDV); itTotals.additions += additions
          itTotals.deduction += num(b.deduction); itTotals.depreciation += num(b.depreciation); itTotals.closingWDV += num(b.closingWDV)
          rows.push([
            b.block, `${b.rate}%`,
            scale(num(b.openingWDV)), scale(additions),
            scale(num(b.deduction)), scale(num(b.depreciation)), scale(num(b.closingWDV)),
          ])
        }
        itBlockSummaryTotalRows.push(rows.length)
        rows.push([
          'Total', '',
          scale(itTotals.openingWDV), scale(itTotals.additions),
          scale(itTotals.deduction), scale(itTotals.depreciation), scale(itTotals.closingWDV),
        ])
        const py = note.itBlockSummaryPyTotals
        if (py && Object.values(py).some(v => num(v))) {
          itBlockSummaryPyRows.push(rows.length)
          rows.push([
            'Previous Year', '',
            scale(num(py.openingWDV)), scale(num(py.addBefore180) + num(py.addAfter180)),
            scale(num(py.deduction)), scale(num(py.depreciation)), scale(num(py.closingWDV)),
          ])
        }
        // Capital WIP / Intangible WIP — no depreciation is charged on assets
        // still under construction/development, so these are manually entered
        // on the Dep (IT) screen rather than derived from a Block. Left out of
        // the sheet entirely (these rows and the combined grand total) whenever
        // nothing was actually entered.
        const wip = note.itWip
        const wipCapital = num(wip?.capitalCY), wipIntangible = num(wip?.intangibleCY), wipPY = num(wip?.prevYearTotal)
        if (wipCapital || wipIntangible || wipPY) {
          rows.push(['Capital Work in Progress', '', '', '', '', '', scale(wipCapital)])
          rows.push(['Intangible Work in Progress', '', '', '', '', '', scale(wipIntangible)])
          itBlockSummaryTotalRows.push(rows.length)
          rows.push(['Total (Work in Progress)', '', '', '', '', '', scale(wipCapital + wipIntangible)])
          itBlockSummaryPyRows.push(rows.length)
          rows.push(['Previous Year (Work in Progress)', '', '', '', '', '', scale(wipPY)])
          itBlockSummaryTotalRows.push(rows.length)
          rows.push(['Total PPE & Intangible Assets including work in progress', '', '', '', '', '', scale(itTotals.closingWDV + wipCapital + wipIntangible)])
          itBlockSummaryPyRows.push(rows.length)
          rows.push(['Previous Year', '', '', '', '', '', scale((py ? num(py.closingWDV) : 0) + wipPY)])
        }
      }

      // Dep (Comp) category-level Schedule II schedule — opt-in from Dep
      // (Comp). Sourced from note.compScheduleData (attached in
      // useFinancials.js), not noteDetailsMap. Mutually exclusive with the IT
      // Block Summary above (both are gated on isPPEWithSchedule so this
      // block never runs alongside it), matches the same Gross Block /
      // Depreciation / Net Block column groups shown on the live Dep (Comp)
      // screen, plus a Trial-Balance reconciliation footer.
      if (note.compScheduleData && note.compScheduleData.length > 0) {
        const num = v => parseFloat(v) || 0
        rows.push([])
        compScheduleColHdrRows.push(rows.length)
        rows.push(['Asset Category', 'Gross Opening', 'Additions', 'Deductions', 'Gross Closing', 'Dep. Opening', 'Dep. For Year', 'Dep. On Disposal', 'Dep. Closing', 'Net Block Opening', 'Net Block Closing'])
        const ct = { grossOpen: 0, additions: 0, deductions: 0, grossClose: 0, depOpen: 0, depForYear: 0, depOnDisposal: 0, depClose: 0, netBlockOpen: 0, netBlockClose: 0 }
        for (const r of note.compScheduleData) {
          ct.grossOpen += num(r.grossOpen); ct.additions += num(r.additions); ct.deductions += num(r.deductions)
          ct.grossClose += num(r.grossClose); ct.depOpen += num(r.depOpen); ct.depForYear += num(r.depForYear)
          ct.depOnDisposal += num(r.depOnDisposal); ct.depClose += num(r.depClose)
          ct.netBlockOpen += num(r.netBlockOpen); ct.netBlockClose += num(r.netBlockClose)
          rows.push([
            r.category || '', scale(num(r.grossOpen)), scale(num(r.additions)), scale(num(r.deductions)), scale(num(r.grossClose)),
            scale(num(r.depOpen)), scale(num(r.depForYear)), scale(num(r.depOnDisposal)), scale(num(r.depClose)),
            scale(num(r.netBlockOpen)), scale(num(r.netBlockClose)),
          ])
        }
        compScheduleTotalRows.push(rows.length)
        rows.push([
          'Total', scale(ct.grossOpen), scale(ct.additions), scale(ct.deductions), scale(ct.grossClose),
          scale(ct.depOpen), scale(ct.depForYear), scale(ct.depOnDisposal), scale(ct.depClose),
          scale(ct.netBlockOpen), scale(ct.netBlockClose),
        ])
        // Manually-entered Previous Year totals — mirrors the IT Block
        // Summary's own PY row (there's no separate PY schedule).
        const compPy = note.compSchedulePyTotals
        if (compPy && Object.values(compPy).some(v => num(v))) {
          compSchedulePyRows.push(rows.length)
          rows.push([
            'Previous Year', scale(num(compPy.grossOpen)), scale(num(compPy.additions)),
            scale(num(compPy.deductions)), scale(num(compPy.grossClose)), scale(num(compPy.depOpen)),
            scale(num(compPy.depForYear)), scale(num(compPy.depOnDisposal)), scale(num(compPy.depClose)),
            scale(num(compPy.netBlockOpen)), scale(num(compPy.netBlockClose)),
          ])
        }
        const tbCY = num(note.compScheduleTbCY), tbPY = num(note.compScheduleTbPY)
        compScheduleRecoRows.push({ row: rows.length, isDifference: false })
        rows.push(['Total as per Trial Balance', '', '', '', '', '', '', '', '', scale(tbPY), scale(tbCY)])
        const diffPY = ct.netBlockOpen - tbPY, diffCY = ct.netBlockClose - tbCY
        compScheduleRecoRows.push({ row: rows.length, isDifference: true, diffPY, diffCY })
        rows.push(['Difference', '', '', '', '', '', '', '', '', scale(diffPY), scale(diffCY)])
      }
    }

    // Optional disclosure note — plain text row, included only when filled in
    const disclosureText = noteDisclosureMap[note.num]
    if (disclosureText && disclosureText.trim()) {
      disclosureRows.push(rows.length)
      rows.push([`  ${disclosureText.trim()}`])
    }

    // Trim trailing spacer rows from the block, then record its extent for borders
    let blockEnd = rows.length - 1
    while (blockEnd > noteTitleRow && (!rows[blockEnd] || rows[blockEnd].length === 0)) blockEnd--
    let lastCol = 3
    for (let r = noteTitleRow; r <= blockEnd; r++) {
      if (rows[r] && rows[r].length - 1 > lastCol) lastCol = rows[r].length - 1
    }
    noteBlocks.push({ start: noteTitleRow, end: blockEnd, lastCol })

    rows.push([])
  }

  addSignatureBlock(rows, rows, entity, auditor, signatories, signPlace, signDate)

  const ws = XLSX.utils.aoa_to_sheet(rows)
  // A=Particulars, B-E=CY/PY note columns; F-K accommodate the widest detail
  // sub-tables (Owners'/Partners' Capital movement, IT Block Summary, ageing).
  ws['!cols'] = [{ wch: 44 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 18 }]
  const range = XLSX.utils.decode_range(ws['!ref'])

  for (const addr in ws) {
    if (typeof addr !== 'string' || addr.startsWith('!')) continue
    const cell = ws[addr]
    if (!cell || typeof cell !== 'object') continue
    // Apply number format to every CY/PY amount column across the widest
    // detail tables (Owners'/Partners' Capital movement can run to column J;
    // IT Block Summary / ageing schedules use various columns up to K; the
    // Dep (Comp) schedule's "Gross Opening" column starts at B).
    if (addr.match(/^[B-K]\d+$/) && typeof cell.v === 'number') cell.z = numFmt
  }
  // Override: Number of Shares (and similar counts) must never carry paise —
  // applied AFTER the general money sweep above, which would otherwise stamp
  // the sheet's usual 2-decimal money format onto every numeric cell,
  // decimals included, in these same detail tables' share-count columns.
  const INTEGER_FMT = '##,##,##0;(##,##,##0);"-"'
  for (const ic of detailIntegerCells) {
    const addr = XLSX.utils.encode_cell({ c: ic.col, r: ic.row })
    if (ws[addr] && typeof ws[addr].v === 'number') ws[addr].z = INTEGER_FMT
  }
  for (const cc of detailCenterCells) {
    const addr = XLSX.utils.encode_cell({ c: cc.col, r: cc.row })
    const cell = ws[addr]
    if (!cell) continue
    cell.s = { ...(cell.s || {}), alignment: { ...((cell.s || {}).alignment || {}), horizontal: 'center' } }
  }
  // Single main header row — bold + coloured
  for (let c = 0; c <= 3; c++) {
    setCellStyle(ws, ensureCell(ws, c, mainHeaderRow), { font: { bold: true, sz: 11 }, fill: FILL_HDR, border: BORDER_BOTTOM, alignment: { vertical: 'center', horizontal: c >= 2 ? 'right' : 'left' } })
  }
  // Entity name + statement title rows
  styleTitleRows(ws, titleRows, 4)
  // Note title rows — bold band across all columns, underlined
  for (const ntr of noteTitleRows) {
    styleRowFull(ws, ntr, [0, 1, 2, 3], {
      font: { bold: true, color: { rgb: '1E40AF' } },
      fill: { patternType: 'solid', fgColor: { rgb: 'EFF6FF' } },
      border: { bottom: { style: 'thin', color: { rgb: '93C5FD' } } },
    })
  }
  // Note sub-section rows (l3) — subtle hair-line separator across all columns
  for (const sr of subtotalRows) {
    styleRowFull(ws, sr, [0, 1, 2, 3], { border: { top: { style: 'hair', color: { rgb: 'D1D5DB' } } } })
  }
  // "Less: Closing …" PL lines — underlined (Opening minus this = the subtotal below it)
  for (const ur of underlineRows) {
    styleRowFull(ws, ur, [0, 2, 3], { font: { underline: true } })
  }
  // Disclosure note rows — italic, muted
  for (const dr of disclosureRows) {
    styleRowFull(ws, dr, [0, 1, 2, 3], { font: { italic: true, color: { rgb: '4B5563' }, sz: 9 } })
  }
  // Total rows — bold, top+double-bottom borders across all columns
  for (const tr of totalRows) {
    styleRowFull(ws, tr, [0, 1, 2, 3], {
      font: { bold: true },
      fill: FILL_NONE,
      border: BORDER_BOTTOM_DOUBLE,
    })
  }
  // ── Detail table styling (Share Capital / LTB sub-tables) ─────────────────
  // Section header rows — bold, blue text, light blue fill
  for (const r of detailSectionHdrRows) {
    for (let c = 0; c <= 9; c++) {
      const addr = XLSX.utils.encode_cell({ c, r })
      if (ws[addr]) setCellStyle(ws, addr, {
        font: { bold: true, color: { rgb: '1E40AF' } },
        fill: { patternType: 'solid', fgColor: { rgb: 'EFF6FF' } },
        border: { top: { style: 'thin', color: { rgb: '93C5FD' } } },
      })
    }
  }
  // Column header rows — bold, bottom border, right-aligned amounts
  for (const r of detailColHdrRows) {
    for (let c = 0; c <= 9; c++) {
      const addr = XLSX.utils.encode_cell({ c, r })
      if (ws[addr]) setCellStyle(ws, addr, {
        font: { bold: true, sz: 9 },
        fill: { patternType: 'solid', fgColor: { rgb: 'F8FAFC' } },
        border: { bottom: { style: 'thin', color: { rgb: '94A3B8' } } },
        alignment: { horizontal: c === 0 ? 'left' : 'right', wrapText: true },
      })
    }
  }
  // Class header rows — bold, very light fill
  for (const r of detailClassHdrRows) {
    for (let c = 0; c <= 9; c++) {
      const addr = XLSX.utils.encode_cell({ c, r })
      if (ws[addr]) setCellStyle(ws, addr, {
        font: { bold: true },
        fill: { patternType: 'solid', fgColor: { rgb: 'F1F5F9' } },
      })
    }
  }
  // Detail total rows — bold, double bottom border
  for (const r of detailTotalRows) {
    for (let c = 0; c <= 9; c++) {
      const addr = XLSX.utils.encode_cell({ c, r })
      if (ws[addr]) setCellStyle(ws, addr, {
        font: { bold: true },
        fill: FILL_NONE,
        border: BORDER_BOTTOM_DOUBLE,
      })
    }
  }
  // Paragraph rows (Share Capital 1(e)-(l), footnotes: merged across A:E and
  // justified, bullets with a deeper indent; Cash & Bank particulars: A:B,
  // left) — wrapped. Excel never grows a merged row to fit its text, so the
  // height is set from the text length against the merged width (a little
  // under one character per column-width unit, to be safe).
  if (detailParaRows.length) {
    if (!ws['!merges']) ws['!merges'] = []
    if (!ws['!rows']) ws['!rows'] = []
    for (const p of detailParaRows) {
      const lastCol = p.lastCol ?? 4
      if (lastCol > 0) ws['!merges'].push({ s: { r: p.row, c: 0 }, e: { r: p.row, c: lastCol } })
      for (let c = 0; c <= lastCol; c++) ensureCell(ws, c, p.row)
      setCellStyle(ws, XLSX.utils.encode_cell({ c: 0, r: p.row }), {
        alignment: { horizontal: p.align || 'justify', vertical: 'top', wrapText: true, indent: p.bullet ? 3 : 1 },
      })
      const width = (ws['!cols'] || []).slice(0, lastCol + 1).reduce((s, c) => s + (c?.wch || 10), 0)
      const lines = Math.max(1, Math.ceil((String(p.text || '').length + (p.bullet ? 8 : 3)) / (width * 0.95)))
      ws['!rows'][p.row] = { hpt: lines * 15 + 3 }
    }
  }
  // Error rows — red background, bold red text, full width (col A only, text wraps)
  for (const r of detailErrorRows) {
    const addr = XLSX.utils.encode_cell({ c: 0, r })
    if (ws[addr]) setCellStyle(ws, addr, {
      font: { bold: true, color: { rgb: 'B91C1C' } },
      fill: { patternType: 'solid', fgColor: { rgb: 'FEF2F2' } },
      border: { top: { style: 'thin', color: { rgb: 'FECACA' } }, bottom: { style: 'thin', color: { rgb: 'FECACA' } } },
      alignment: { wrapText: true },
    })
  }
  // IT Block Summary — column header row (bold, underline) + Total row (bold,
  // double border). Was orange (FFF7ED/FDBA74), inconsistent with the blue
  // used for every other note table in this workbook (EFF6FF/93C5FD/1E40AF)
  // — same fix already applied to the live Notes screen's Dep (IT) block.
  for (const r of itBlockSummaryColHdrRows) {
    for (let c = 0; c <= 6; c++) {
      const addr = XLSX.utils.encode_cell({ c, r })
      if (ws[addr]) setCellStyle(ws, addr, {
        font: { bold: true, sz: 9, color: { rgb: '1E40AF' } },
        fill: { patternType: 'solid', fgColor: { rgb: 'EFF6FF' } },
        border: { bottom: { style: 'thin', color: { rgb: '93C5FD' } } },
        alignment: { horizontal: c === 0 ? 'left' : 'right' },
      })
    }
  }
  for (const r of itBlockSummaryTotalRows) {
    for (let c = 0; c <= 6; c++) {
      const addr = XLSX.utils.encode_cell({ c, r })
      if (ws[addr]) setCellStyle(ws, addr, {
        font: { bold: true },
        fill: { patternType: 'solid', fgColor: { rgb: 'EFF6FF' } },
        border: BORDER_BOTTOM_DOUBLE,
      })
    }
  }
  for (const r of itBlockSummaryPyRows) {
    for (let c = 0; c <= 6; c++) {
      const addr = XLSX.utils.encode_cell({ c, r })
      if (ws[addr]) setCellStyle(ws, addr, {
        font: { italic: true, color: { rgb: '666666' } },
        alignment: { horizontal: c === 0 ? 'left' : 'right' },
      })
    }
  }
  // Dep (Comp) schedule — column header row + Total row, same blue theme as
  // the IT Block Summary above; reconciliation rows (Total as per TB /
  // Difference) styled last, with Difference colour-coded green/red.
  for (const r of compScheduleColHdrRows) {
    for (let c = 0; c <= 10; c++) {
      const addr = XLSX.utils.encode_cell({ c, r })
      if (ws[addr]) setCellStyle(ws, addr, {
        font: { bold: true, sz: 9, color: { rgb: '1E40AF' } },
        fill: { patternType: 'solid', fgColor: { rgb: 'EFF6FF' } },
        border: { bottom: { style: 'thin', color: { rgb: '93C5FD' } } },
        alignment: { horizontal: c === 0 ? 'left' : 'right' },
      })
    }
  }
  for (const r of compScheduleTotalRows) {
    for (let c = 0; c <= 10; c++) {
      const addr = XLSX.utils.encode_cell({ c, r })
      if (ws[addr]) setCellStyle(ws, addr, {
        font: { bold: true },
        fill: { patternType: 'solid', fgColor: { rgb: 'EFF6FF' } },
        border: BORDER_BOTTOM_DOUBLE,
      })
    }
  }
  for (const r of compSchedulePyRows) {
    for (let c = 0; c <= 10; c++) {
      const addr = XLSX.utils.encode_cell({ c, r })
      if (ws[addr]) setCellStyle(ws, addr, {
        font: { italic: true, color: { rgb: '666666' } },
        alignment: { horizontal: c === 0 ? 'left' : 'right' },
      })
    }
  }
  for (const { row: r, isDifference, diffPY, diffCY } of compScheduleRecoRows) {
    for (let c = 0; c <= 10; c++) {
      const addr = XLSX.utils.encode_cell({ c, r })
      if (!ws[addr]) continue
      // Colour-code on the UNSCALED rupee difference (diffPY/diffCY), not the
      // display-scaled cell value — a real ₹50,000 gap would otherwise read
      // as "reconciled" once shown in lakhs/crores.
      if (isDifference && (c === 9 || c === 10)) {
        const v = c === 9 ? diffPY : diffCY
        setCellStyle(ws, addr, {
          font: { bold: true, color: { rgb: Math.abs(v) < 1 ? '15803D' : 'B91C1C' } },
          alignment: { horizontal: c === 0 ? 'left' : 'right' },
        })
      } else {
        setCellStyle(ws, addr, {
          font: { color: { rgb: '555555' } },
          alignment: { horizontal: c === 0 ? 'left' : 'right' },
        })
      }
    }
  }

  // Patch formula cells for note totals (Annexures → Notes), keeping the Total row styling
  for (const link of totalLinks) {
    if (link.cyCell) {
      const cAddr = XLSX.utils.encode_cell({ c: 2, r: link.row })
      const dAddr = XLSX.utils.encode_cell({ c: 3, r: link.row })
      ws[cAddr] = { ...link.cyCell, s: ws[cAddr]?.s }
      ws[dAddr] = { ...link.pyCell, s: ws[dAddr]?.s }
      if (link.cyExpect !== undefined) expectFigure(ws, cAddr, link.cyExpect)
      if (link.pyExpect !== undefined) expectFigure(ws, dAddr, link.pyExpect)
    }
  }
  // Patch sub-note LINE cells that link straight to their Annexures subtotal
  // (the note's Total above already sums these rows — see noteLineRows)
  for (const p of lineFormulaPatches) {
    const addr = XLSX.utils.encode_cell({ c: p.col, r: p.r })
    ws[addr] = { t: 'n', f: p.formula, z: numFmt, s: ws[addr]?.s }
    if (p.expect !== undefined) expectFigure(ws, addr, p.expect)
  }

  // Hyperlinks: title → annexure row
  for (const link of titleLinks) {
    const annexRow = annexStartRows.get(link.noteNum)
    if (annexRow != null) {
      const cellAddr = XLSX.utils.encode_cell({ c: link.col, r: link.row })
      linkTo(ws, cellAddr, 'Annexures', XLSX.utils.encode_cell({ c: 0, r: annexRow }), `Open Annexure for Note ${link.noteNum}`)
    }
  }
  // Hyperlinks: total cell → annexure row (only if no formula, so they don't conflict with formula styling)
  for (const link of totalLinks) {
    const annexRow = annexStartRows.get(link.noteNum)
    if (annexRow != null && !link.cyCell) {
      const cellAddr = XLSX.utils.encode_cell({ c: link.col, r: link.row })
      linkTo(ws, cellAddr, 'Annexures', XLSX.utils.encode_cell({ c: 0, r: annexRow }), `Open Annexure for Note ${link.noteNum}`)
    }
  }
  // Outline box (side lines) around each note block — after formula patching
  // so borders merge onto the patched Total cells too
  const totalRowSet = new Set(totalRows)
  for (const blk of noteBlocks) {
    const lastCol = Math.max(3, blk.lastCol)
    applyBoxBorder(ws, blk.start, blk.end, 0, lastCol)
    // Keep the double underline when the block closes on its Total row
    if (totalRowSet.has(blk.end)) {
      for (let c = 0; c <= lastCol; c++) mergeBorder(ws, c, blk.end, { bottom: BDR_DBL })
    }
  }
  applyPrintSetup(ws)
  return { ws, notesCyTotalMap }
}

// ── Build Annexures sheet ───────────────────────────────────────────────────
// Returns { ws, annexTotalMap: Map<noteNum, { cyRow, pyRow }> }
// Columns: A=Ledger Name, B=Sub-note, C=Code, D=CY Ledger, E=CY Sub-note Total, F=PY Ledger, G=PY Sub-note Total.
// Ledgers are grouped by sub-note (Level 2 for PL / Level 3 for BS — see
// utils/annexureGrouping.js, the SAME helper the live Annexures UI uses so
// both always agree). Each group's subtotal (SUM formula) lands on its LAST
// ledger row, underlined — that cell is what the Notes sheet's matching
// sub-note LINE links to (see annexSubnoteTotalMap), not the note's grand
// total. PY columns are populated only when PY is TB-derived; for
// manually-typed PY (Fill Details forms) they stay blank — no fabricated link.
function buildAnnexuresSheet(entity, activeTB, prevTB, data, { denomination, auditor, signatories, annexStartRows, signPlace, signDate }) {
  const scale = scaleFn(denomination)
  const numFmt = numFormatString(denomination)
  const d = DENOMINATIONS[denomination] || DENOMINATIONS['as_is']
  const rows = []
  const noteTitleRows = []
  const subtotalRows = []  // last-ledger-row per sub-note group — underlined, SUM formula
  const totalRows = []
  const annexTotalMap = new Map()         // noteNum → { cyRow, pyRow } (note Total row)
  const annexSubnoteTotalMap = new Map()  // noteNum → Map(subnoteLabel → { cyRow, pyRow })

  const titleRows = pushTitleRows(rows, entity, `Annexures — Ledger-Level Details for the year ended ${yearEnd(activeTB?.period || '')}`, d.unit)
  rows.push([])

  const mainHeaderRow = rows.length
  // "IT Block" is appended as a trailing column (not inserted between
  // existing ones) so every formula elsewhere referencing this sheet's A–G
  // columns by letter (see formulaPatches below, and buildBSSheet/
  // buildNotesSheet's cross-sheet links via annexTotalMap/
  // annexSubnoteTotalMap) stays valid unchanged. Populated only on PPE note
  // rows — blank for every other note.
  rows.push(['Ledger Name', 'Sub-note', 'Code', 'CY Ledger', 'CY Sub-note Total', 'PY Ledger', 'PY Sub-note Total', 'IT Block'])
  rows.push([])

  const isZeroRow = r => Math.abs(rowAmt(r, 'closing_balance')) < 0.005 && Math.abs(rowAmt(r, 'opening_balance')) < 0.005
  const notes = data.activeNotes || Object.values(data.notes)
  const noteBlocks = []     // { start, end } — for outline box borders per note
  const formulaPatches = [] // { r, col, formula }
  const uncatRows = []      // "Unclassified" sub-note rows — flagged red

  for (const note of notes) {
    trimToOneBlankRow(rows)
    const startRow = rows.length
    annexStartRows.set(note.num, startRow)
    noteTitleRows.push(startRow)
    rows.push([`Note ${note.num}: ${note.displayTitle || note.title}`])

    const subnoteMap = new Map()
    const shown = annexureDisplayLabels(note)   // print text only - subnoteMap and the links keep the real labels
    const groups = getSubnoteGroups(note, data.levelFormat)
      .map(g => ({ ...g, rows: g.rows.filter(r => !isZeroRow(r)) }))
      .filter(g => g.rows.length > 0)

    const totalChildRows = [] // { row, negate } — E/G cells that sum to the note total
    const hasSeparatePYTB = !!prevTB?.id

    for (const g of groups) {
      const groupStart = rows.length
      for (const row of g.rows) {
        if (g.label === UNCLASSIFIED_LABEL) uncatRows.push(rows.length)
        // Per-ledger PY: a real identity match against the separate PY TB
        // (via data.prevRowsByLedger — ledger_code, or name when no code),
        // not each row's own opening_balance which belongs to THIS TB, not
        // the other one. Matches the live Annexures screen.
        const pyLedgerKey = (row.ledger_code || row.ledger_name || row.name || '').trim().toLowerCase()
        const pyLedgerVal = hasSeparatePYTB
          ? (pyLedgerKey ? data.prevRowsByLedger?.get(pyLedgerKey) : undefined)
          : rowAmt(row, 'opening_balance')
        const ledgerName = row.ledger_name || row.name || ''
        rows.push([
          shown(ledgerName), shown(g.label), row.ledger_code || '',
          scale(rowAmt(row, 'closing_balance')), '',
          pyLedgerVal !== undefined ? scale(pyLedgerVal) : '', '',
          note.itBlockByLedger?.[ledgerName]?.block || '',
        ])
      }
      const lastRow = rows.length - 1
      subtotalRows.push(lastRow)
      formulaPatches.push({ r: lastRow, col: 4, formula: `SUM(D${groupStart + 1}:D${lastRow + 1})` })
      // Sub-note PY total: the SAME figure the live Annexures screen and the
      // PDF show (subnoteGroupFigures) — a "Less: …" group (e.g. Less:
      // Closing Stock) shown as the stock itself, not already negated, so
      // the Notes sheet's own sign flip (see lineFormulaPatches below) is
      // the only place that subtracts it; storing it pre-negated here made
      // Excel's Changes in inventories ADD last year's closing stock instead
      // of subtracting it (Santosh Kumar Gupta, 0.1.35).
      const groupPY = subnoteGroupFigures(note, g, { amount: rowAmt, hasSeparatePYTB, prevMapL3: data.prevMapL3 }).py
      if (g.linePrevTotal !== undefined || (hasSeparatePYTB && groupPY !== null)) {
        rows[lastRow][6] = scale(groupPY)
        // else: no reliable PY figure available for this group — leave blank.
      } else if (!hasSeparatePYTB) {
        formulaPatches.push({ r: lastRow, col: 6, formula: `SUM(F${groupStart + 1}:F${lastRow + 1})` })
      }
      subnoteMap.set(g.label, { cyRow: lastRow, pyRow: lastRow })
      // Sub-note groups are always displayed as their natural positive ledger
      // magnitude (matches the Notes screen/PDF), but a "Less: …" group (per
      // Schedule III convention — e.g. "Less: Closing Stock of Raw
      // Materials") must be SUBTRACTED when rolling up into the note's own
      // Total, same sign rule useFinancials.js already applies when building
      // that line's `.total`.
      totalChildRows.push({ row: lastRow, negate: /^less:/i.test(g.label) })
    }
    // A sub-note only last year had: one line of its own, so the Total's
    // Previous Year SUM includes it (see pyOnlySubnoteLines).
    if (hasSeparatePYTB) {
      for (const l of pyOnlySubnoteLines(note, groups, data.levelFormat)) {
        const r = rows.length
        rows.push(['(Previous Year only)', l.label, '', '', '', scale(l.py), scale(l.py), ''])
        subtotalRows.push(r)
        totalChildRows.push({ row: r, negate: /^less:/i.test(l.label) })
      }
    }
    annexSubnoteTotalMap.set(note.num, subnoteMap)

    const totRowIdx = rows.length
    totalRows.push(totRowIdx)
    annexTotalMap.set(note.num, { cyRow: totRowIdx, pyRow: totRowIdx })
    rows.push(['Total', '', '', '', scale(note.total), '', scale(note.prevTotal)])
    if (totalChildRows.length > 0) {
      // SUM() accepts a comma-separated argument list, each of which can
      // itself carry a sign — same result as chained addition, but reads
      // cleanly and works correctly even though these rows aren't contiguous.
      const ref = (col, c) => `${c.negate ? '-' : ''}${col}${c.row + 1}`
      formulaPatches.push({ r: totRowIdx, col: 4, formula: `SUM(${totalChildRows.map(c => ref('E', c)).join(',')})` })
      formulaPatches.push({ r: totRowIdx, col: 6, formula: `SUM(${totalChildRows.map(c => ref('G', c)).join(',')})` })
    }
    noteBlocks.push({ start: startRow, end: totRowIdx })
    rows.push([])
  }

  // Working of the ratio figure the General Notes use (Net Credit Purchases), below the annexures
  const ncpHeadRows = [], ncpTotalRows = []
  const ncp = data.generalNotes?.points?.length ? netCreditPurchasesWorking(data) : null
  if (ncp && (Math.abs(ncp.numerator.cy) > 0.005 || Math.abs(ncp.numerator.py) > 0.005)) {
    rows.push([])
    ncpHeadRows.push(rows.length)
    rows.push(['Workings of Ratios - Net Credit Purchases', '', '', '', 'Current Year', '', 'Previous Year'])
    for (const r of ncp.rows) {
      if (r.kind === 'head') { ncpHeadRows.push(rows.length); rows.push([r.label]); continue }
      if (r.kind === 'sub' || r.kind === 'total') ncpTotalRows.push(rows.length)
      rows.push([(r.kind === 'line' ? '  ' : '') + r.label, '', '', '', scale(r.cy), '', scale(r.py)])
    }
    if (ncp.average !== null) {
      if (ncp.components) {
        rows.push(['  Trade Payables at the end of the year', '', '', '', scale(ncp.components.closing), '', ''])
        rows.push(['  Trade Payables at the beginning of the year', '', '', '', scale(ncp.components.opening), '', ''])
      }
      ncpTotalRows.push(rows.length)
      rows.push(['Average Trade Payables', '', '', '', scale(ncp.average), '', ''])
    }
    if (ncp.ratio !== null) { ncpTotalRows.push(rows.length); rows.push(['Trade Payables Turnover Ratio (times)', '', '', '', Number(Number(ncp.ratio).toFixed(2)), '', '']) }
    rows.push(['Net Credit Purchases is taken as the total of the Profit & Loss captions above; cash purchases and purchase returns are not separately identified.'])
    rows.push([])
  }

  addSignatureBlock(rows, rows, entity, auditor, signatories, signPlace, signDate)

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 34 }, { wch: 20 }, { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }]
  const range = XLSX.utils.decode_range(ws['!ref'])

  for (const addr in ws) {
    if (typeof addr !== 'string' || addr.startsWith('!')) continue
    const cell = ws[addr]
    if (!cell || typeof cell !== 'object') continue
    if (addr.match(/^[DEFG]\d+$/) && typeof cell.v === 'number') cell.z = numFmt
  }
  // Title rows
  styleTitleRows(ws, titleRows, 7)
  // Main header
  for (let c = 0; c <= 6; c++) {
    setCellStyle(ws, ensureCell(ws, c, mainHeaderRow), {
      font: { bold: true, sz: 11 }, fill: FILL_HDR,
      border: { top: { style: 'thin', color: { rgb: '000000' } }, bottom: { style: 'thin', color: { rgb: '000000' } } },
      alignment: { vertical: 'center', horizontal: c >= 3 ? 'right' : 'left' },
    })
  }
  // Note title rows — bold, blue, full-width band
  for (const ntr of noteTitleRows) {
    styleRowFull(ws, ntr, [0, 1, 2, 3, 4, 5, 6], {
      font: { bold: true, sz: 11, color: { rgb: '1E40AF' } },
      fill: { patternType: 'solid', fgColor: { rgb: 'EFF6FF' } },
      border: { bottom: { style: 'thin', color: { rgb: '93C5FD' } } },
    })
  }
  // "Unclassified" sub-note rows — flagged red, same convention as Notes/BS
  for (const ur of uncatRows) {
    styleRowFull(ws, ur, [1], { font: { color: { rgb: 'B91C1C' }, bold: true } })
  }
  // Sub-note group's last row — underlined ledger + subtotal cells
  for (const sr of subtotalRows) {
    styleRowFull(ws, sr, [3, 4, 5, 6], { font: { underline: true, bold: true } })
  }
  // Total rows — clean double-bottom border, no background, full width
  for (const tr of totalRows) {
    styleRowFull(ws, tr, [0, 1, 2, 3, 4, 5, 6], {
      font: { bold: true },
      fill: FILL_NONE,
      border: BORDER_BOTTOM_DOUBLE,
    })
  }
  // Patch subtotal / total cells with live SUM formulas (styles preserved)
  for (const p of formulaPatches) {
    const addr = XLSX.utils.encode_cell({ c: p.col, r: p.r })
    ws[addr] = { t: 'n', f: p.formula, z: numFmt, s: ws[addr]?.s }
  }
  // Outline box (side lines) around each note block
  for (const blk of noteBlocks) {
    applyBoxBorder(ws, blk.start, blk.end, 0, 6)
    // Keep the double underline on the Total row (box drew a thin bottom over it)
    for (let c = 0; c <= 6; c++) mergeBorder(ws, c, blk.end, { bottom: BDR_DBL })
  }
  for (const hr of ncpHeadRows) styleRowFull(ws, hr, [0, 1, 2, 3, 4, 5, 6], { font: { bold: true, color: { rgb: '1E40AF' } }, fill: { patternType: 'solid', fgColor: { rgb: 'EFF6FF' } } })
  for (const tr of ncpTotalRows) styleRowFull(ws, tr, [0, 4], { font: { bold: true } })
  applyPrintSetup(ws)
  return { ws, annexTotalMap, annexSubnoteTotalMap }
}

// ── General Notes sheet ──────────────────────────────────────────────────────
// The single freeform narrative note (e.g. "Significant Accounting
// Policies", always Note 1 — see components/GeneralNotes), made up of
// internally-numbered points, rendered as a dedicated sheet. Content is
// arbitrary HTML authored in a WYSIWYG editor, not the structured row/table
// shape the rest of this file works with, so it's flattened here via the DOM
// (paragraphs → text rows, lists → bulleted/numbered lines, tables → real
// grid rows) rather than reusing any of the BS/PL/Notes/Annexures
// row-building machinery above.
// Returns { rows, boldOffsets } for one point — boldOffsets are indices into
// `rows` (the point's own header line, and each table's header row).
function pointToRows(pt, idx) {
  const rows = []
  const boldOffsets = []

  boldOffsets.push(rows.length)
  rows.push([`${pointLabel(idx)} ${pt.header || ''}`])

  const container = document.createElement('div')
  container.innerHTML = pointBodyHtml(pt)   // body + Financial Ratios comment paragraphs
  container.childNodes.forEach(child => {
    const tag = child.tagName?.toLowerCase()
    if (tag === 'p') {
      const text = (child.textContent || '').trim()
      if (text) rows.push([text])
    } else if (tag === 'ul' || tag === 'ol') {
      Array.from(child.children).forEach((li, i) => {
        const prefix = tag === 'ol' ? `${i + 1}. ` : '• '
        rows.push([prefix + (li.textContent || '').trim()])
      })
    } else if (tag === 'table') {
      boldOffsets.push(rows.length)
      Array.from(child.querySelectorAll('tr')).forEach(tr => {
        rows.push(Array.from(tr.children).map(td => (td.textContent || '').trim()))
      })
    } else {
      const text = (child.textContent || '').trim()
      if (text) rows.push([text])
    }
  })
  rows.push([]) // spacer between points
  return { rows, boldOffsets }
}

// Ends with the signature block once, after the last policy — as the PDF
// does, and as every other sheet of this workbook ends.
export function buildGeneralNotesSheet(data, { entity, auditor, signatories, signPlace = '', signDate = '' } = {}) {
  const gn = data.generalNotes
  const rows = []
  const boldRowIdxs = []

  if (gn?.points?.length) {
    boldRowIdxs.push(rows.length)
    rows.push([`Note ${data.generalNoteNum}: ${gn.title || ''}`])
    rows.push([])
    for (const [idx, pt] of gn.points.entries()) {
      const { rows: ptRows, boldOffsets } = pointToRows(pt, idx)
      const base = rows.length
      boldOffsets.forEach(off => boldRowIdxs.push(base + off))
      rows.push(...ptRows)
    }
    addSignatureBlock(rows, rows, entity, auditor, signatories, signPlace, signDate)
  }

  const ws = XLSX.utils.aoa_to_sheet(rows.length ? rows : [['No General Notes added yet.']])
  ws['!cols'] = [{ wch: 100 }, { wch: 30 }, { wch: 30 }, { wch: 30 }]
  for (const rowIdx of boldRowIdxs) {
    const addr = XLSX.utils.encode_cell({ r: rowIdx, c: 0 })
    if (ws[addr]) ws[addr].s = { font: { bold: true, sz: 11 } }
  }
  return ws
}

// Cash Flow Statement (AS 3, indirect method): one sheet after the Profit & Loss, when the CFS tab has "Include in PDF / Excel" ticked.
// Subtotals are live SUM formulas over the figure rows.
function buildCFSSheet(entity, activeTB, prevTB, data, { denomination, auditor, signatories, signPlace, signDate }) {
  const scale = scaleFn(denomination)
  const numFmt = numFormatString(denomination)
  const d = DENOMINATIONS[denomination] || DENOMINATIONS['as_is']
  const cyDate = yearEnd(activeTB?.period || '')
  const cyLabel = cyDate || 'Current Year'
  const pyLabel = (prevTB?.period ? yearEnd(prevTB.period) : yearBefore(cyDate)) || 'Previous Year'
  const cf = buildCashFlow(data, data.cfsSaved)
  const rows = []
  const titleRows = pushTitleRows(rows, entity, `Cash Flow Statement for year ended ${cyDate}`, d.unit)
  rows.push([])
  const headerRow = rows.length
  rows.push(['Particulars', cyLabel, pyLabel])
  rows.push([])
  const at = {}, heads = [], strongs = []
  for (const r of cf.rows) {
    at[r.id] = rows.length
    if (r.kind === 'head') { heads.push(rows.length); rows.push([r.label, '', '']); continue }
    if (r.kind === 'caption') { rows.push([r.label, '', '']); continue }
    if (r.kind === 'sub' || r.kind === 'total') strongs.push(rows.length)
    rows.push([(r.kind === 'item' ? '   ' : '') + r.label, scale(r.cy), scale(r.py)])
  }
  // Components of cash and cash equivalents (AS 3), reconciled to the Balance Sheet
  const cc = cf.cc
  rows.push([])
  const ccHead = rows.length
  rows.push(['Components of cash and cash equivalents (AS 3)', '', ''])
  const ccFirst = rows.length
  for (const r of cc.items) rows.push(['   ' + r.label, scale(r.cy), scale(r.py)])
  const ccLast = rows.length - 1
  const ccTotal = rows.length
  rows.push(['Cash and cash equivalents as per the Balance Sheet', scale(cc.totalCY), scale(cc.totalPY)])
  if (Math.abs(cc.restricted.cy) > 0.005 || Math.abs(cc.restricted.py) > 0.005) rows.push(['   ' + cc.restricted.label, scale(cc.restricted.cy), scale(cc.restricted.py)])
  if (cc.note) rows.push([cc.note])
  addSignatureBlock(rows, rows, entity, auditor, signatories, signPlace, signDate)

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 70 }, { wch: 22 }, { wch: 22 }]
  for (const r of cf.rows) {
    if (!r.of) continue
    for (const col of ['B', 'C']) {
      const refs = r.of.filter(id => at[id] !== undefined).map(id => `${col}${at[id] + 1}`)
      if (!refs.length) continue
      const val = scale(col === 'B' ? r.cy : r.py)
      ws[`${col}${at[r.id] + 1}`] = { t: 'n', f: refs.join('+'), v: val, z: numFmt }
    }
  }
  for (const col of ['B', 'C']) ws[`${col}${ccTotal + 1}`] = { t: 'n', f: `SUM(${col}${ccFirst + 1}:${col}${ccLast + 1})`, v: scale(col === 'B' ? cc.totalCY : cc.totalPY), z: numFmt }
  for (const addr in ws) {
    if (typeof addr !== 'string' || addr.startsWith('!')) continue
    const cell = ws[addr]
    if (cell && typeof cell === 'object' && /^[BC]\d+$/.test(addr) && cell.t === 'n') cell.z = numFmt
  }
  styleRowFull(ws, ccHead, [0, 1, 2], { font: { bold: true, sz: 11, color: { rgb: '1E40AF' } }, fill: { fgColor: { rgb: 'DBEAFE' } }, border: { top: { style: 'thin', color: { rgb: '000000' } }, bottom: { style: 'thin', color: { rgb: '000000' } } } })
  styleRowFull(ws, ccTotal, [0, 1, 2], { font: { bold: true }, fill: FILL_SUB, border: { top: { style: 'thin', color: { rgb: '94A3B8' } } } })
  styleTitleRows(ws, titleRows, 3)
  for (let c = 0; c <= 2; c++) {
    setCellStyle(ws, ensureCell(ws, c, headerRow), {
      font: { bold: true, sz: 11 }, fill: FILL_HDR,
      border: { top: { style: 'thin', color: { rgb: '000000' } }, bottom: { style: 'thin', color: { rgb: '000000' } } },
      alignment: { vertical: 'center', horizontal: c >= 1 ? 'right' : 'left' },
    })
  }
  for (const hr of heads) {
    styleRowFull(ws, hr, [0, 1, 2], {
      font: { bold: true, sz: 11, color: { rgb: '1E40AF' } },
      fill: { fgColor: { rgb: 'DBEAFE' } },
      border: { top: { style: 'thin', color: { rgb: '000000' } }, bottom: { style: 'thin', color: { rgb: '000000' } } },
    })
  }
  for (const sr of strongs) {
    styleRowFull(ws, sr, [0, 1, 2], { font: { bold: true }, fill: FILL_SUB, border: { top: { style: 'thin', color: { rgb: '94A3B8' } } } })
  }
  return ws
}

export function buildFinancialsWorkbook({ entity, activeTB, prevTB, data, levelFormat, auditor: auditorGiven, signatories, denomination = 'as_is', noteDetailsMap = {}, noteDisclosureMap = {}, signPlace = '', signDate = '' }) {
  const wb = XLSX.utils.book_new()
  // A Company in absolute figures is signed by the directors only (utils/signingRules.js)
  const auditor = auditorForDenomination(entity, auditorGiven, denomination)
  // The Financial Ratios table's amounts follow the statements' denomination.
  data = { ...data, generalNotes: scaleRatioAmounts(data.generalNotes, (DENOMINATIONS[denomination] || DENOMINATIONS.as_is).divisor, (DENOMINATIONS[denomination] || DENOMINATIONS.as_is).decimals) }

  // ① Build Annexures first → get note total row positions AND per-sub-note
  // subtotal row positions (each note's individual Level-2/Level-3 lines)
  const annexStartRows = new Map()
  const { ws: annexWs, annexTotalMap, annexSubnoteTotalMap } = buildAnnexuresSheet(
    entity, activeTB, prevTB, data, { denomination, auditor, signatories, annexStartRows, signPlace, signDate }
  )

  // ② Build Notes → each sub-note LINE links to its Annexures subtotal cell;
  // the note's own Total is a SUM of those lines (not a link to Annexures'
  // total) — see buildNotesSheet's doc comment.
  const noteStartRows = new Map()
  const { ws: notesWs, notesCyTotalMap } = buildNotesSheet(
    entity, activeTB, prevTB, data,
    { denomination, auditor, signatories, annexStartRows, annexTotalMap, annexSubnoteTotalMap, noteStartRows, noteDetailsMap, noteDisclosureMap, signPlace, signDate }
  )

  // ③ Build BS & PL → use Notes total positions to write formula cells
  const bsSheet = buildBSSheet(entity, activeTB, prevTB, data,
    { denomination, auditor, signatories, noteStartRows, notesCyTotalMap, levelFormat, signPlace, signDate })
  const plSheet = buildPLSheet(entity, activeTB, prevTB, data,
    { denomination, auditor, signatories, noteStartRows, notesCyTotalMap, levelFormat, signPlace, signDate })

  XLSX.utils.book_append_sheet(wb, bsSheet,  'Balance Sheet')
  XLSX.utils.book_append_sheet(wb, plSheet,  'Profit & Loss')
  if (data.cfsSaved?.include) XLSX.utils.book_append_sheet(wb, buildCFSSheet(entity, activeTB, prevTB, data, { denomination, auditor, signatories, signPlace, signDate }), 'Cash Flow')
  // General Notes tab position mirrors the PDF's "Notes Last" choice (see
  // buildHTML.js's buildNotesPages): "first" sheets it before Notes, "last"
  // sheets it after Annexures — this used to always sheet it between Notes
  // and Annexures regardless of the setting.
  const generalNotesLast = data.generalNotes?.position === 'last'
  const generalNotesSheet = data.generalNotes?.points?.length
    ? buildGeneralNotesSheet(data, { entity, auditor, signatories, signPlace, signDate })
    : null
  if (generalNotesSheet && !generalNotesLast) {
    XLSX.utils.book_append_sheet(wb, generalNotesSheet, 'General Notes')
  }
  XLSX.utils.book_append_sheet(wb, notesWs,  'Notes')
  XLSX.utils.book_append_sheet(wb, annexWs,  'Annexures')
  if (generalNotesSheet && generalNotesLast) {
    XLSX.utils.book_append_sheet(wb, generalNotesSheet, 'General Notes')
  }
  // Previous Year not required, column left out: hidden (not deleted) on the sheets whose Previous Year sits in
  // columns of its own - so every formula and link keeps working. The Notes sheet stacks tables of different
  // shapes in the same columns, so its Previous Year cells stay (all dashes).
  if (data?.pyMode === 'none_hide') {
    const hide = (ws, cols) => {
      ws['!cols'] = ws['!cols'] || []
      for (const c of cols) ws['!cols'][c] = { ...(ws['!cols'][c] || {}), hidden: true }
    }
    hide(bsSheet, [3]); hide(plSheet, [3]); hide(annexWs, [5, 6])
  }
  // A link that would show anything other than the app's own figure is
  // replaced with that figure — never shipped as a wrong or broken formula.
  wb.linkRepairs = keepLinksTrue(wb)
  return wb
}

// ── Branch-wise Columnar Workbook ─────────────────────────────────────────────
// branchTBsData: [{ tbId, branchName, period, rows }]
// Sheets: "BS (Columnar)", "PL (Columnar)", "Annexures - <Branch>" per branch
export function buildColumnarWorkbook({ entity, branchTBsData, denomination = 'as_is', levelFormat = [], generalData = null, auditor = null, signatories = [], signPlace = '', signDate = '' }) {
  const scale = scaleFn(denomination)
  const numFmt = numFormatString(denomination)
  const wb = XLSX.utils.book_new()

  // ── Helper: derive net amount from a single DB row ──────────────────────
  // Same alie-based convention as displayAmt() everywhere else — was
  // is_deemed_positive-based here, diverging on any reclassified row.
  const net = displayAmt

  // ── Group rows by L2 for a given ALIE ──────────────────────────────────
  function groupByL2(rows, alie) {
    const map = new Map()
    for (const r of rows) {
      const rAlie = r.alie || ''
      const isMatch = alie === 'EL'
        ? (rAlie === 'EQUITY AND LIABILITIES' || rAlie === 'Equity and Liabilities')
        : alie === 'ASSETS'
        ? rAlie === 'ASSETS'
        : alie === 'Income'
        ? rAlie === 'Income'
        : rAlie === 'Expenses'
      if (!isMatch) continue
      const l1 = r.level1 || 'Other'
      const l2 = r.level2 || l1
      const key = `${l1}|||${l2}`
      if (!map.has(key)) map.set(key, { l1, l2, rows: [] })
      map.get(key).rows.push(r)
    }
    return [...map.values()]
  }

  function sumRows(rows, field) {
    return rows.reduce((s, r) => s + net(r, field), 0)
  }

  // ── Branch data summary ─────────────────────────────────────────────────
  const branches = branchTBsData.map(b => ({
    name: b.branchName || `Branch ${b.tbId}`,
    rows: b.rows || [],
  }))
  const N = branches.length

  // ── Style helpers ────────────────────────────────────────────────────────
  const HDR_STYLE = { font: { bold: true, sz: 10 }, fill: { patternType: 'solid', fgColor: { rgb: 'DBEAFE' } }, border: BORDER_HEADER }
  const TITLE_STYLE = { font: { bold: true, sz: 10, color: { rgb: '1E3A5F' } }, fill: { patternType: 'solid', fgColor: { rgb: 'EFF6FF' } } }
  const TOT_STYLE  = { font: { bold: true }, border: BORDER_BOTTOM_DOUBLE }
  const SEC_STYLE  = { font: { bold: true, sz: 9 }, fill: { patternType: 'solid', fgColor: { rgb: 'F0F4FF' } } }
  const L1_STYLE   = { font: { bold: true, sz: 9 }, fill: { patternType: 'solid', fgColor: { rgb: 'F8FAFF' } } }
  const NUM_STYLE  = (isTot) => ({ font: { bold: isTot }, numFmt, alignment: { horizontal: 'right' }, border: isTot ? BORDER_BOTTOM_DOUBLE : {} })
  const TOTAL_COL_FILL = { patternType: 'solid', fgColor: { rgb: 'F3F4F6' } }

  function makeSheet(title, buildRows) {
    const rows = []
    // Entity header
    rows.push([entity?.name || ''])
    rows.push([title])
    rows.push([`(${denomination === 'as_is' ? 'As Is' : denomination})`])
    rows.push([])
    // Column headers: Particulars | Branch1 | Branch2 | ... | Total
    const hdr = ['Particulars', ...branches.map(b => b.name), 'Total']
    rows.push(hdr)
    buildRows(rows)

    const ws = XLSX.utils.aoa_to_sheet(rows)
    const range = XLSX.utils.decode_range(ws['!ref'])

    // Widths: particulars=40, each branch=18, total=18
    ws['!cols'] = [
      { wch: 40 },
      ...branches.map(() => ({ wch: 18 })),
      { wch: 18 },
    ]

    // Style header rows
    for (let c = 0; c <= N + 1; c++) {
      // Entity name row (row 0) — bold large
      const a0 = XLSX.utils.encode_cell({ c, r: 0 })
      if (ws[a0]) ws[a0].s = { font: { bold: true, sz: 13 } }
      // Title row (row 1)
      const a1 = XLSX.utils.encode_cell({ c, r: 1 })
      if (ws[a1]) ws[a1].s = TITLE_STYLE
      // Column header row (row 4)
      const a4 = XLSX.utils.encode_cell({ c, r: 4 })
      if (ws[a4]) ws[a4].s = HDR_STYLE
    }

    // Style data rows
    for (let r = 5; r <= range.e.r; r++) {
      const partCell = ws[XLSX.utils.encode_cell({ c: 0, r })]
      if (!partCell) continue
      const v = partCell.v || ''
      const isSectionTitle = v.toString().startsWith('──')
      const isL1 = v.toString().startsWith('  ►')
      const isTotal = v.toString().startsWith('TOTAL')
      const isGrandTotal = v.toString().startsWith('Profit') || v.toString().startsWith('GRAND')

      for (let c = 0; c <= N + 1; c++) {
        const addr = XLSX.utils.encode_cell({ c, r })
        if (!ws[addr]) continue
        if (isSectionTitle) ws[addr].s = SEC_STYLE
        else if (isL1) ws[addr].s = L1_STYLE
        else if (isTotal || isGrandTotal) {
          ws[addr].s = TOT_STYLE
          if (c > 0) ws[addr].s = { ...TOT_STYLE, ...NUM_STYLE(true) }
        } else {
          if (c > 0 && c <= N) ws[addr].s = NUM_STYLE(false)
          if (c === N + 1) ws[addr].s = { ...NUM_STYLE(false), fill: TOTAL_COL_FILL }
        }
      }
    }

    applyPrintSetup(ws)
    ws['!pageSetup'] = { ...ws['!pageSetup'], orientation: N > 3 ? 'landscape' : 'portrait' }
    return ws
  }

  // ── BS Sheet ────────────────────────────────────────────────────────────
  function buildBSRows(rows) {
    const renderSection = (sectionTitle, alieKey) => {
      rows.push([`── ${sectionTitle} ──`])
      // Collect all unique L1+L2 combinations across branches in order
      const seen = new Set(); const l2keys = []
      for (const br of branches) {
        for (const { l1, l2 } of groupByL2(br.rows, alieKey)) {
          const k = `${l1}|||${l2}`
          if (!seen.has(k)) { seen.add(k); l2keys.push({ l1, l2 }) }
        }
      }
      // Group by L1
      const l1Groups = new Map()
      for (const { l1, l2 } of l2keys) {
        if (!l1Groups.has(l1)) l1Groups.set(l1, [])
        l1Groups.get(l1).push(l2)
      }
      for (const [l1, l2list] of l1Groups) {
        rows.push([`  ► ${l1}`])
        for (const l2 of l2list) {
          const vals = branches.map(br => {
            const grp = groupByL2(br.rows, alieKey).find(g => g.l1 === l1 && g.l2 === l2)
            return scale(grp ? sumRows(grp.rows, 'closing_balance') : 0)
          })
          const tot = vals.reduce((s, v) => s + (v || 0), 0)
          rows.push([`    ${l2}`, ...vals, scale(tot)])
        }
      }
      // Section total
      const secTotals = branches.map(br =>
        scale(groupByL2(br.rows, alieKey).reduce((s, g) => s + sumRows(g.rows, 'closing_balance'), 0))
      )
      const secGrand = secTotals.reduce((s, v) => s + (v || 0), 0)
      rows.push([`TOTAL ${sectionTitle}`, ...secTotals, scale(secGrand)])
      rows.push([])
    }

    renderSection('EQUITY AND LIABILITIES', 'EL')
    renderSection('ASSETS', 'ASSETS')
  }

  // ── PL Sheet ────────────────────────────────────────────────────────────
  function buildPLRows(rows) {
    const renderSection = (sectionTitle, alieKey) => {
      rows.push([`── ${sectionTitle} ──`])
      const seen = new Set(); const l1keys = []
      for (const br of branches) {
        for (const { l1 } of groupByL2(br.rows, alieKey)) {
          if (!seen.has(l1)) { seen.add(l1); l1keys.push(l1) }
        }
      }
      for (const l1 of l1keys) {
        rows.push([`  ► ${l1}`])
        // L2 lines
        const l2seen = new Set(); const l2list = []
        for (const br of branches) {
          for (const { l1: rl1, l2 } of groupByL2(br.rows, alieKey)) {
            if (rl1 === l1 && !l2seen.has(l2)) { l2seen.add(l2); l2list.push(l2) }
          }
        }
        for (const l2 of l2list) {
          const vals = branches.map(br => {
            const grp = groupByL2(br.rows, alieKey).find(g => g.l1 === l1 && g.l2 === l2)
            return scale(grp ? sumRows(grp.rows, 'closing_balance') : 0)
          })
          rows.push([`    ${l2}`, ...vals, scale(vals.reduce((s, v) => s + (v || 0), 0))])
        }
        // L1 subtotal
        const l1tots = branches.map(br => {
          const grps = groupByL2(br.rows, alieKey).filter(g => g.l1 === l1)
          return scale(grps.reduce((s, g) => s + sumRows(g.rows, 'closing_balance'), 0))
        })
        rows.push([`TOTAL ${l1}`, ...l1tots, scale(l1tots.reduce((s, v) => s + (v || 0), 0))])
      }
      // Section grand total
      const secTots = branches.map(br =>
        scale(groupByL2(br.rows, alieKey).reduce((s, g) => s + sumRows(g.rows, 'closing_balance'), 0))
      )
      rows.push([`TOTAL ${sectionTitle}`, ...secTots, scale(secTots.reduce((s, v) => s + (v || 0), 0))])
      rows.push([])
    }

    renderSection('INCOME', 'Income')
    renderSection('EXPENSES', 'Expenses')

    // PAT
    const incTots = branches.map(br =>
      scale(groupByL2(br.rows, 'Income').reduce((s, g) => s + sumRows(g.rows, 'closing_balance'), 0))
    )
    const expTots = branches.map(br =>
      scale(groupByL2(br.rows, 'Expenses').reduce((s, g) => s + sumRows(g.rows, 'closing_balance'), 0))
    )
    const patTots = branches.map((_, i) => (incTots[i] || 0) - (expTots[i] || 0))
    const patGrand = patTots.reduce((s, v) => s + (v || 0), 0)
    rows.push(['Profit / (Loss) for the Year', ...patTots, scale(patGrand)])
  }

  const bsWs = makeSheet('Balance Sheet — Branch-wise Columnar', buildBSRows)
  const plWs = makeSheet('Profit & Loss — Branch-wise Columnar', buildPLRows)
  XLSX.utils.book_append_sheet(wb, bsWs, 'BS (Columnar)')
  XLSX.utils.book_append_sheet(wb, plWs, 'PL (Columnar)')

  // ── Notes (Columnar) & Annexures (Columnar) ─────────────────────────────
  // Full per-branch note/ledger detail — same processRows()/getSubnoteGroups()
  // pipeline every other export uses, so this always agrees with the live
  // Notes/Annexures screens and the single-TB/consolidated exports.
  const branchProcessed = branches.map(br => ({
    ...br,
    data: processRows(br.rows, null, entity?.constitution, [], entity?.business_type),
  }))
  const titleKey = (t) => (t || '').trim().toLowerCase()
  // Union of every branch's active note titles, in the order each first
  // appears (branches walked in their given order, each branch's own notes
  // already in statutory presentation order) — a reasonable, stable order
  // without pretending note NUMBERS line up across branches, which they don't.
  const allNoteTitles = []
  {
    const seen = new Set()
    for (const br of branchProcessed) {
      for (const note of (br.data.activeNotes || [])) {
        const k = titleKey(note.title)
        if (!seen.has(k)) { seen.add(k); allNoteTitles.push({ title: note.title, isPL: !!note.isPL }) }
      }
    }
  }
  const findNote = (br, title) => (br.data.activeNotes || []).find(n => titleKey(n.title) === titleKey(title))

  // ── Notes (Columnar) sheet — same "Particulars | Branch1 | … | Total"
  // layout as BS (Columnar)/PL (Columnar) above, one row per note title. ───
  function buildNotesColumnarRows(rows) {
    const renderGroup = (sectionTitle, isPL) => {
      const titles = allNoteTitles.filter(t => t.isPL === isPL)
      if (!titles.length) return
      rows.push([`── ${sectionTitle} ──`])
      for (const { title } of titles) {
        const vals = branchProcessed.map(br => scale(findNote(br, title)?.total || 0))
        rows.push([title, ...vals, scale(vals.reduce((s, v) => s + (v || 0), 0))])
      }
      rows.push([])
    }
    renderGroup('Balance Sheet Notes', false)
    renderGroup('Profit & Loss Notes', true)
  }
  const notesColWs = makeSheet('Notes — Branch-wise Columnar', buildNotesColumnarRows)
  XLSX.utils.book_append_sheet(wb, notesColWs, 'Notes (Columnar)')

  // ── Annexures (Columnar) sheet — SAME "Particulars | Branch1 | … | Total"
  // grid as BS/PL/Notes (Columnar) above, built with the same makeSheet()
  // helper. Grouped by Note (── … ──), then by sub-note (  ► …  — via
  // getSubnoteGroups, the same grouping the live Annexures screen uses, so
  // common sub-note labels like MSME/Unclassified line up as one row each
  // across branches). Each sub-note's branch SUBTOTAL row comes first —
  // dense, every branch column a real figure, same feel as BS/PL (Columnar)
  // — followed by the full one-row-per-ledger detail indented beneath it.
  // A ledger doesn't recur by name across branches, so its own row carries
  // a value in only its OWN branch's column (blank elsewhere).
  const uncatSubnoteRows = []
  const subnoteTotalRows = []   // rows carrying a dense branch-subtotal, not a per-ledger figure
  function buildAnnexuresColumnarRows(rows) {
    const isZeroRow = r => Math.abs(net(r, 'closing_balance')) < 0.005
    for (const { title } of allNoteTitles) {
      const perBranch = branchProcessed.map(br => {
        const note = findNote(br, title)
        const groups = note
          ? getSubnoteGroups(note, br.data.levelFormat || levelFormat || [])
              .map(g => ({ ...g, rows: (g.rows || []).filter(r => !isZeroRow(r)) }))
              .filter(g => g.rows.length > 0)
          : []
        return { br, groups }
      })
      if (!perBranch.some(x => x.groups.length > 0)) continue

      rows.push([`── ${title} ──`])

      const subnoteLabels = []
      const seenLabels = new Set()
      for (const { groups } of perBranch) {
        for (const g of groups) {
          if (!seenLabels.has(g.label)) { seenLabels.add(g.label); subnoteLabels.push(g.label) }
        }
      }

      for (const label of subnoteLabels) {
        const subVals = perBranch.map(({ groups }) => {
          const g = groups.find(x => x.label === label)
          return scale(g ? g.rows.reduce((s, r) => s + net(r, 'closing_balance'), 0) : 0)
        })
        rows.push([`  ► ${label}`, ...subVals, scale(subVals.reduce((s, v) => s + (v || 0), 0))])
        subnoteTotalRows.push(rows.length - 1)
        if (label === UNCLASSIFIED_LABEL) uncatSubnoteRows.push(rows.length - 1)
        for (const { br, groups } of perBranch) {
          const g = groups.find(x => x.label === label)
          if (!g) continue
          for (const ledgerRow of g.rows) {
            const amt = net(ledgerRow, 'closing_balance')
            const vals = branches.map(b => b.name === br.name ? scale(amt) : 0)
            const ledgerName = ledgerRow.ledger_name || ledgerRow.name || ''
            rows.push([`      ${ledgerName} (${br.name})`, ...vals, scale(amt)])
          }
        }
      }

      const noteVals = perBranch.map(({ groups }) =>
        scale(groups.reduce((s, g) => s + g.rows.reduce((s2, r) => s2 + net(r, 'closing_balance'), 0), 0))
      )
      rows.push([`TOTAL ${title}`, ...noteVals, scale(noteVals.reduce((s, v) => s + (v || 0), 0))])
      rows.push([])
    }
  }
  const annexColWs = makeSheet('Annexures — Branch-wise Columnar', buildAnnexuresColumnarRows)
  // makeSheet()'s generic styling gives a "  ► " row L1_STYLE only (no
  // number format/alignment — that's reserved for its "else" branch). These
  // rows now carry real branch-subtotal figures, so format/right-align them
  // like every other numeric cell, on top of the L1 fill/bold it already got.
  for (const r of subnoteTotalRows) {
    for (let c = 1; c <= N + 1; c++) {
      const addr = XLSX.utils.encode_cell({ c, r })
      if (annexColWs[addr] && typeof annexColWs[addr].v === 'number') {
        annexColWs[addr].s = { ...(annexColWs[addr].s || {}), numFmt, alignment: { horizontal: 'right' } }
      }
    }
  }
  for (const r of uncatSubnoteRows) {
    for (let c = 0; c <= N + 1; c++) {
      const addr = XLSX.utils.encode_cell({ c, r })
      if (annexColWs[addr]) annexColWs[addr].s = { ...(annexColWs[addr].s || {}), font: { ...((annexColWs[addr].s || {}).font || {}), color: { rgb: 'B91C1C' } } }
    }
  }
  XLSX.utils.book_append_sheet(wb, annexColWs, 'Annexures (Columnar)')

  // ── Per-branch Annexure sheets ──────────────────────────────────────────
  for (const br of branches) {
    const rows = []
    rows.push([entity?.name || ''])
    rows.push([`Annexures — ${br.name}`])
    rows.push([])

    // Group by L2 key for all ALIE types
    const noteMap = new Map()
    for (const r of br.rows) {
      const l2 = r.level2 || r.level1 || 'Other'
      const l3 = r.level3 || r.mapping3_resultant || ''
      const key = `${l2}|||${l3}`
      if (!noteMap.has(key)) noteMap.set(key, { l2, l3, rows: [] })
      noteMap.get(key).rows.push(r)
    }

    rows.push(['Ledger / Particulars', 'Amount'])
    let curL2 = null
    for (const { l2, l3, rows: grpRows } of noteMap.values()) {
      if (l2 !== curL2) {
        rows.push([l2])
        curL2 = l2
      }
      if (l3) rows.push([`  ${l3}`])
      for (const r of grpRows) {
        rows.push([`    ${r.name || r.ledger_name || ''}`, scale(net(r, 'closing_balance'))])
      }
    }

    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = [{ wch: 50 }, { wch: 18 }]
    // Style header
    ;[0, 1].forEach(r => {
      const a = XLSX.utils.encode_cell({ c: 0, r })
      if (ws[a]) ws[a].s = { font: { bold: true, sz: r === 0 ? 13 : 11 } }
    })
    applyPrintSetup(ws)

    // Sheet name max 31 chars
    const sheetName = `Annex - ${br.name}`.slice(0, 31)
    XLSX.utils.book_append_sheet(wb, ws, sheetName)
  }

  // General Notes (Significant Accounting Policies ...) of the Auditee as a whole - not a branch's, so one sheet
  if (generalData?.generalNotes?.points?.length) {
    XLSX.utils.book_append_sheet(wb, buildGeneralNotesSheet(generalData, { entity, auditor, signatories, signPlace, signDate }), 'General Notes')
  }

  return wb
}
