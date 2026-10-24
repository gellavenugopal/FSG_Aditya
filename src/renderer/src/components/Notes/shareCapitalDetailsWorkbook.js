// ── Share Capital "Details" sheet — Shareholders / Rights / Footnotes ───────
// Bolted onto the consolidated Fill Details workbook alongside the existing
// per-note "Share Capital" (Classes) sheet built from fillDetailsRegistry.js
// (that registry entry only round-trips data.classes).
//
// The shareholder table uses the EXACT same flat layout as
// ShareCapitalForm.jsx's own "Shareholder_Template.xlsx" (downloadShareholderTemplate/
// importShareholdersFromExcel) — Sl No / Name / Folio No / PY Shares / CY
// Shares / Category(Promoter|Non-Promoter) — so a preparer sees one
// consistent format whether downloading it standalone from the form or
// bundled here. % holding and the ">=5%" shareholders list are NOT entered —
// they're auto-derived on parse from total CY/PY shares, mirroring
// importShareholdersFromExcel's own calculation exactly.
import * as XLSX from 'xlsx-js-style'
import { SC_DISCLOSURES, disclosureTexts, defaultDisclosureText } from '../../utils/shareCapitalDisclosures'

const SHEET_PREFIX = 'Share Capital - Details'
const SHAREHOLDER_HEADER = ['Sl No', 'Name of Shareholder', 'Folio No (Optional)', 'No. of Shares at Beginning (PY)', 'No. of Shares at End (CY)', 'Category']
const COL_WIDTHS = [{ wch: 6 }, { wch: 40 }, { wch: 18 }, { wch: 30 }, { wch: 28 }, { wch: 18 }]
const FOOTNOTE_COUNT = 10
const DEFAULT_ROWS = 5

// Best-effort reconstruction for the "Filled" download — the live form only
// PERSISTS the disclosure-relevant subset (>=5% holders + Promoters, per
// Schedule III — everyone else genuinely isn't required to be listed), so a
// shareholder once below 5% and not a Promoter was never saved and can't be
// recovered here. Dedup by name; Promoter status (and its own Category tag)
// wins over a plain >=5% entry for the same person.
function reconstructShareholderRows(details) {
  const byName = new Map()
  for (const r of details?.shareholders5pctEquity || []) {
    byName.set(r.name, { name: r.name, folioNo: r.folioNo || '', pyShares: r.pyShares || '', cyShares: r.cyShares || '', category: 'Non-Promoter' })
  }
  for (const r of details?.shareholders5pctPreference || []) {
    byName.set(r.name, { name: r.name, folioNo: r.folioNo || '', pyShares: r.pyShares || '', cyShares: r.cyShares || '', category: 'Non-Promoter' })
  }
  for (const r of details?.promoters || []) {
    const existing = byName.get(r.name)
    byName.set(r.name, { name: r.name, folioNo: existing?.folioNo || '', pyShares: existing?.pyShares || '', cyShares: r.shares || existing?.cyShares || '', category: 'Promoter' })
  }
  return [...byName.values()]
}

function buildAoa(details) {
  const rows = [SHAREHOLDER_HEADER]
  const shRows = details ? reconstructShareholderRows(details) : []
  if (shRows.length) {
    shRows.forEach((r, i) => rows.push([i + 1, r.name, r.folioNo, r.pyShares, r.cyShares, r.category]))
  } else {
    for (let i = 1; i <= DEFAULT_ROWS; i++) rows.push([i, '', '', '', '', 'Non-Promoter'])
  }
  rows.push([]) // blank separator before Rights/Footnotes
  rows.push(['Rights, Preferences and Restrictions attached to shares'])
  rows.push([(details?.rights ?? '') || ''])
  rows.push([])
  // Company disclosures 1(e)-(l): text in column C (blank = left out).
  rows.push(['Disclosures (Company) — text in column C; clear it to leave the item out'])
  const texts = disclosureTexts(details || {})
  for (const s of SC_DISCLOSURES) rows.push([`(${s.key})`, s.heading, texts[s.key] || ''])
  rows.push([])
  rows.push(['Footnotes'])
  const footnotes = details?.footnotes?.length ? details.footnotes : Array(FOOTNOTE_COUNT).fill('')
  footnotes.forEach((fn, i) => rows.push([i + 1, fn || '']))
  return rows
}

/**
 * Appends the Share Capital Details sheet to `wb`. `details` is the note's
 * currently-saved Fill Details data (or null for a blank template).
 */
export function appendShareCapitalDetailsSheet(wb, noteNum, details, usedNames) {
  const aoa = buildAoa(details)
  // Row 1 carries the note number so the sheet survives renumbering/renaming
  // the same way the main registry-driven sheets do (see NOTE_NUM_ROW in
  // fillDetailsWorkbook.js) — inserted above the header.
  aoa.unshift([`Note ${noteNum}`], ['Share Capital — Shareholders, Rights & Footnotes'], [])
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = COL_WIDTHS
  ws['!dataValidation'] = [{
    sqref: 'F5:F500',
    type: 'list',
    formula1: '"Promoter,Non-Promoter"',
    showDropDown: false,
    showErrorMessage: true,
    errorTitle: 'Invalid',
    error: 'Please select Promoter or Non-Promoter',
  }]
  let base = SHEET_PREFIX.slice(0, 28)
  let candidate = base, i = 2
  while (usedNames.has(candidate.toLowerCase())) candidate = `${base} (${i++})`.slice(0, 31)
  usedNames.add(candidate.toLowerCase())
  XLSX.utils.book_append_sheet(wb, ws, candidate)
}

/**
 * @param {XLSX.WorkBook} wb
 * @param {number|string} totalSharesCY - current closing shares (first share
 *   class) — the denominator for auto-computing % holding, same figure
 *   ShareCapitalForm.jsx passes into importShareholdersFromExcel.
 * @param {number|string} totalSharesPY - previous-year closing shares
 * @returns {{ noteNum: number, data: object } | null} - null if the sheet
 *   isn't present, or present but entirely blank.
 */
export function parseShareCapitalDetailsSheet(wb, totalSharesCY, totalSharesPY) {
  const sheetName = wb.SheetNames.find(n => n.startsWith(SHEET_PREFIX))
  if (!sheetName) return null
  const ws = wb.Sheets[sheetName]
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  const noteNumCell = (aoa[0]?.[0] || '').toString()
  const m = noteNumCell.match(/note\s*(\d+)/i)
  const noteNum = m ? parseInt(m[1], 10) : null

  // Shareholder rows: from row 4 (0-indexed) up to the first fully-blank
  // row, which marks the start of the Rights/Footnotes block.
  let i = 4
  const shareholderRows = []
  while (i < aoa.length && aoa[i].some(c => (c ?? '') !== '')) { shareholderRows.push(aoa[i]); i++ }

  // Same derivation as ShareCapitalForm.jsx's importShareholdersFromExcel —
  // % holding and the ">=5% in CY or PY" list are computed, never typed. The
  // denominator is total shares OUTSTANDING (every shareholder, including
  // the below-5% ones this sheet doesn't list) — normally the Classes
  // sheet's own closing-share figure (passed in by the caller). If that's
  // unavailable/zero (e.g. Classes wasn't filled in this same upload), fall
  // back to the sum of whatever's actually listed here, so % still comes out
  // sane rather than 0/blank — an approximation, since it can't see holders
  // below 5% that were never listed either way.
  const rawTotalCY = parseFloat(totalSharesCY) || 0
  const rawTotalPY = parseFloat(totalSharesPY) || 0
  const listedCYSum = shareholderRows.reduce((s, r) => s + (parseFloat(r[4]) || 0), 0)
  const listedPYSum = shareholderRows.reduce((s, r) => s + (parseFloat(r[3]) || 0), 0)
  const totalCY = rawTotalCY || listedCYSum || 1
  const totalPY = rawTotalPY || listedPYSum || 1
  const all = shareholderRows.filter(r => (r[1] || '').toString().trim()).map(r => {
    const pyShares = parseFloat(r[3]) || 0
    const cyShares = parseFloat(r[4]) || 0
    const cyPct = totalCY ? (cyShares / totalCY) * 100 : 0
    const pyPct = totalPY ? (pyShares / totalPY) * 100 : 0
    return {
      name: (r[1] || '').toString().trim(),
      folioNo: (r[2] || '').toString().trim(),
      cyShares, cyPct: cyPct.toFixed(2), pyShares, pyPct: pyPct.toFixed(2),
      category: (r[5] || 'Non-Promoter').toString().trim(),
      _cyPct: cyPct, _pyPct: pyPct,
    }
  })
  const fivePct = all.filter(r => r._cyPct >= 5 || r._pyPct >= 5)
  const promoters = all.filter(r => r.category.toLowerCase() === 'promoter')

  // Rights + Footnotes, after the blank separator row.
  let rights = ''
  const footnotes = Array(FOOTNOTE_COUNT).fill('')
  // Only text that differs from the standard wording is kept as the CA's own
  // (the face value in (e)'s standard text is whatever the classes say).
  const disclosures = {}
  const std = (s) => String(s || '').trim().replace(/₹\s*[\d,.]+/g, '₹#')
  for (; i < aoa.length; i++) {
    const label = (aoa[i][0] || '').toString().trim().toLowerCase()
    if (label.startsWith('rights')) { rights = (aoa[i + 1]?.[0] || '').toString(); i++; continue }
    const dm = label.match(/^\(([e-l])\)$/)
    if (dm) {
      const text = (aoa[i][2] ?? '').toString()
      if (std(text) !== std(defaultDisclosureText(dm[1], null))) disclosures[dm[1]] = text
      continue
    }
    const idx = parseInt(aoa[i][0], 10)
    if (idx >= 1 && idx <= FOOTNOTE_COUNT) footnotes[idx - 1] = (aoa[i][1] || '').toString()
  }

  if (!all.length && !rights.trim() && !footnotes.some(f => f.trim())) return null
  return {
    noteNum,
    data: {
      shareholders5pctEquity: fivePct
        .filter(r => !r.category?.toLowerCase().includes('prefer'))
        .map(r => ({ name: r.name, folioNo: r.folioNo, cyShares: r.cyShares, cyPct: r.cyPct, pyShares: r.pyShares, pyPct: r.pyPct })),
      // The flat template has no Equity/Preference distinction (same as the
      // live form's own import — everything lands in the Equity list).
      shareholders5pctPreference: [],
      promoters: promoters.map(r => ({ name: r.name, class: 'Equity', shares: r.cyShares, pctTotal: r.cyPct, pctChange: '' })),
      rights, footnotes,
      ...(Object.keys(disclosures).length ? { disclosures } : {}),
    },
  }
}
