import React, { useState, useEffect } from 'react'
import { withCurrentTitleDeedsText } from '../utils/generalNoteText'
import { resolveConsolidationSelection } from '../utils/consolidationSelection'
// Schedule III presentation order for company (constitution=3) note numbering,
// so a note's number matches where its line appears on the face of the BS.
// bsStructure.js has no imports of its own — no circular dependency.
// EL_ORDER_CORP/NONCORP, ASSET_ORDER, elOrderFor, nonCorpSectionSortKey and
// sectionSortKey are also defined there (not here) so that bsStructure.js's
// own computeDynamicBSLayout can reuse the identical order lists/sort-key
// logic used below to sort elSections/assetSections, when it places a
// newly-injected zero-skeleton section into its correct statutory position.
import {
  companyBSLineOrder, elOrderFor, nonCorpSectionSortKey, sectionSortKey, ASSET_ORDER,
} from '../utils/bsStructure'
// Raw-Material vs WIP/Finished Goods/Stock-in-Trade split for Cost of
// materials consumed vs Changes in inventories (see utils/inventorySplit.js).
import { computeInventorySplit, headKey } from '../utils/inventorySplit'
// Non-corporate PL presentation order, for the same note-numbering fix as
// companyBSLineOrder — see nonCorpPLSectionOrder's own doc comment.
import { nonCorpPLSectionOrder } from '../utils/plStructureNonCorp'
import { ledgerIdsOf } from '../utils/fixTargets'
import { buildInventoriesRows } from '../utils/inventoriesNote'
// Company/LLP PL presentation order — same note-numbering fix, for the two
// constitutions that render the fixed 7-line EXPENSE_LINES bucketing.
import { consolidatedDepFromNoteDetails } from '../utils/depStore'
import { corpPLSectionOrder, corpFaceNetProfit } from '../utils/plStructureCorp'
import { fallbackSubnoteLabel } from '../utils/annexureGrouping'
import { revenueLevel2, revenueLineRank } from '../utils/revenueLines'
import { withoutRatioIntro } from '../utils/ratioNoteIntro'
import { refreshRatiosInNote } from '../utils/ratioTable'
// Saved Fill Details are matched to notes by title, not number.
import { indexSavedNoteRows, parsedNoteData } from '../utils/savedNoteData'

// ── Formatting ────────────────────────────────────────────────────────────────

// Strips thousands separators before parseFloat — a manually-typed figure
// like "12,288" or lakh-grouped "1,98,174" is natural Indian-style entry
// (nothing stops a user typing it into any plain text amount field), but
// parseFloat stops at the first comma and silently truncates to "12"/"1".
// Safe on already-numeric input too: String(123.45) has no commas to strip.
function parseAmt(n) {
  return parseFloat(String(n ?? '').replace(/,/g, ''))
}

/** Indian number format. Negative → parentheses. Zero → '—'. */
export function fmtINR(n) {
  // Number('') is 0 (not NaN), but parseFloat('') IS NaN — checking the
  // guard with Number() while formatting with parseFloat() let a blank
  // string slip past this early return and reach abs.toLocaleString() as
  // NaN.toLocaleString(), which renders the literal text "NaN" instead of
  // the intended blank dash. Guard with the same function used below.
  if (n === null || n === undefined || n === '') return '—'
  const num = parseAmt(n)
  if (isNaN(num) || num === 0) return '—'
  const abs = Math.abs(num)
  const str = abs.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return num < 0 ? `(${str})` : str
}

/** Denomination presets used across Mapped TB, PDF, and Excel exports. */
export const DENOMINATIONS = {
  'as_is':    { label: 'As Is (with decimals)', divisor: 1,        decimals: 2, unit: '' },
  'no_dec':   { label: 'No Decimals',           divisor: 1,        decimals: 0, unit: '' },
  'hundreds': { label: 'In Hundreds',           divisor: 100,      decimals: 2, unit: '(Amount in ` Hundreds)' },
  'lakhs':    { label: 'In Lakhs',              divisor: 100000,   decimals: 2, unit: '(Amount in ` Lakhs)' },
  'crores':   { label: 'In Crores',             divisor: 10000000, decimals: 2, unit: '(Amount in ` Crores)' },
}

/** Apply denomination then format as Indian-style string with parentheses for negatives. */
export function fmtDenom(n, key = 'as_is') {
  // Same NaN-guard mismatch as fmtINR above (Number('') is 0, parseFloat('')
  // is NaN) — guard with parseFloat directly so a blank value can't reach
  // toLocaleString() as NaN and render the literal text "NaN".
  if (n === null || n === undefined || n === '') return '—'
  const parsed = parseAmt(n)
  if (isNaN(parsed)) return '—'
  const d = DENOMINATIONS[key] || DENOMINATIONS['as_is']
  const scaled = parsed / d.divisor
  if (scaled === 0) return '—'
  const abs = Math.abs(scaled)
  const str = abs.toLocaleString('en-IN', { minimumFractionDigits: d.decimals, maximumFractionDigits: d.decimals })
  return scaled < 0 ? `(${str})` : str
}

/** Apply denomination (returns a number; for Excel cells). */
export function scaleDenom(n, key = 'as_is') {
  // Same NaN-guard mismatch as fmtINR/fmtDenom above — guard with parseFloat
  // directly so a blank value returns null (an empty Excel cell) instead of
  // a raw NaN (which Excel renders as a #NUM!/error value in the cell).
  if (n === null || n === undefined || n === '') return null
  const parsed = parseAmt(n)
  if (isNaN(parsed)) return null
  const d = DENOMINATIONS[key] || DENOMINATIONS['as_is']
  return parsed / d.divisor
}

// ── Amount extraction (uses bifurcated debit/credit columns) ────────────────

/**
 * Derive the display amount from a mapped TB row using debit/credit bifurcation.
 *
 * For Closing Balance (CY figures):
 *   - is_deemed_positive=true  → Clos Bal (Debit) = closing_balance × -1
 *   - is_deemed_positive=false → Clos Bal (Credit) = closing_balance
 *
 * For BS/PL placement:
 *   - Assets & Expenses      → use Debit balance (positive = normal)
 *   - E&L & Income           → use Credit balance (positive = normal)
 *
 * The sign convention: Debit balances are positive for Assets/Expenses,
 * Credit balances are positive for E&L/Income.
 */
// Inter-branch / Head Office current accounts (R7, 0.1.13). See the same
// constant in mapping-engine.js. The engine seeds these rows with ALIE =
// ASSETS (the Level Format side); processRows() below re-sides each ledger
// from its actual balance, and eliminateInterBranch() nets them across
// branches for the Consolidated view.
export const INTERBRANCH_RX = /inter[\s-]?branch|head office/i
const isInterBranchRow = (row) => INTERBRANCH_RX.test((row.level1 || row.mapping1_resultant || '') + '')

/**
 * Consolidated view: the Head Office's "Branch X A/c" (Dr) and Branch X's
 * "Head Office A/c" (Cr) are the same money seen from both ends. Ledgers are
 * grouped by the same caption the Notes screen groups notes by (Level 2,
 * falling back to Level 1 — ordinarily just the one shared "Inter-branch and
 * Head Office account" heading); each group's Current Year AND Previous Year
 * balances are netted separately. A group whose net is ~0 in BOTH years is
 * dropped from the Balance Sheet entirely — never even a zero line. A group
 * with a genuine residue (a branch TB missing, an unposted inter-branch
 * transfer, a transit item) collapses to ONE synthetic row carrying the net
 * figure, so the face and Notes show a single net balance instead of every
 * branch's raw, un-netted figure — the residue is still reported for the CA
 * to investigate (Exception Report → "Consolidation"). Sign convention is the
 * one displayAmt() documents: Dr balances stored negative, Cr positive.
 */
export function eliminateInterBranch(rows) {
  const ibRows = (rows || []).filter(isInterBranchRow)
  if (!ibRows.length) return { rows, summary: null }
  const bal  = (r) => parseFloat(r.closing_balance || 0)
  const pbal = (r) => parseFloat(r.opening_balance || 0)
  const net = ibRows.reduce((s, r) => s + bal(r), 0)
  const dr  = ibRows.reduce((s, r) => s + (bal(r) < 0 ? -bal(r) : 0), 0)
  const cr  = ibRows.reduce((s, r) => s + (bal(r) > 0 ?  bal(r) : 0), 0)
  const byBranch = {}
  for (const r of ibRows) {
    const k = r.branch_name || '(no branch name)'
    if (!byBranch[k]) byBranch[k] = { branch: k, net: 0, ledgers: [] }
    byBranch[k].net += bal(r)
    byBranch[k].ledgers.push({ name: r.ledger_name || r.name, amount: bal(r) })
  }
  const groups = new Map()
  for (const r of ibRows) {
    const key = ((r.level2 || r.mapping2_resultant || r.level1 || r.mapping1_resultant || '') + '').trim().toLowerCase()
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }
  const kept = []
  for (const groupRows of groups.values()) {
    const groupCY = groupRows.reduce((s, r) => s + bal(r), 0)
    const groupPY = groupRows.reduce((s, r) => s + pbal(r), 0)
    if (Math.abs(groupCY) < 0.005 && Math.abs(groupPY) < 0.005) continue   // this group fully eliminated
    kept.push({
      ...groupRows[0],
      branch_name: null,
      ledger_name: 'Inter-branch / Head Office balances (net)',
      name: 'Inter-branch / Head Office balances (net)',
      closing_balance: String(groupCY),
      opening_balance: String(groupPY),
    })
  }
  const eliminated = kept.length === 0
  return {
    rows: [...rows.filter(r => !isInterBranchRow(r)), ...kept],
    summary: { eliminated, net, dr, cr, count: ibRows.length, byBranch: Object.values(byBranch) },
  }
}

// ── Nothing that nets to nil is shown in the Consolidated statements ──────────────────────────────────────────────
// A branch's sale to another branch is that branch's purchase: each is a figure in its own Profit & Loss, and together they are nil. In
// the Consolidated statements such a caption is not shown at all - not as a line of Revenue from operations, not as a purchase line, not
// as a row of a note. Not by its name only: ANY caption (the same Level 1 / 2 / 3 on the same side) that is carried by two or more
// branches and nets to nil is left out, on the Balance Sheet and the Profit & Loss alike. Each year is judged on its own: a year whose net
// is nil is left out (its ledgers' figures for that year are removed), a year with a residue keeps its figures. A caption of one branch
// only, and the statements of a single branch, are never touched (the ledgers stay as in the Trial Balance).
export const BRANCH_TRADING_RX = /branch\s*(sales?|purchases?|transfers?)|(sales?|purchases?)\s*(to|from|of)?\s*(the\s*)?branch|inter.?branch\s*(sales?|purchases?|transfers?)/i
export function eliminateNilBranchTrading(rows) {
  const FIELDS = ['mapping3_resultant', 'level3', 'mapping2_resultant', 'level2', 'mapping1_resultant', 'level1', 'level4_value', 'level5_value', 'level6_value', 'level7_value']
  const captionOf = (r) => {
    for (const f of FIELDS) { const v = String(r[f] == null ? '' : r[f]).trim(); if (v && BRANCH_TRADING_RX.test(v)) return v }
    return null
  }
  const bal = (r) => parseFloat(r.closing_balance || 0) || 0
  const pbal = (r) => parseFloat(r.opening_balance || 0) || 0
  const dropped = new Set(), noCY = new Set(), noPY = new Set()
  const summary = []
  const judge = (key, g, { needBranches }) => {
    if (needBranches && new Set(g.map(r => r.branch_name).filter(Boolean)).size < 2) return
    const cy = g.reduce((s, r) => s + bal(r), 0), py = g.reduce((s, r) => s + pbal(r), 0)
    const cyNil = Math.abs(cy) < 0.005, pyNil = Math.abs(py) < 0.005
    const anyCY = g.some(r => Math.abs(bal(r)) >= 0.005), anyPY = g.some(r => Math.abs(pbal(r)) >= 0.005)
    if (!((cyNil && anyCY) || (pyNil && anyPY))) return   // nothing to take out
    summary.push({ caption: key, cy, py, eliminatedCY: cyNil, eliminatedPY: pyNil, count: g.length })
    for (const r of g) {
      if (cyNil && pyNil) dropped.add(r)
      else if (cyNil) noCY.add(r)
      else if (pyNil) noPY.add(r)
    }
  }
  // 1. a caption named like trading between branches - Profit & Loss only, whether one or several branches carry it
  const named = new Map()
  for (const r of (rows || [])) {
    if (r.alie && !/^(income|expenses)$/i.test(String(r.alie))) continue
    const cap = captionOf(r)
    if (!cap) continue
    const key = cap.toLowerCase().replace(/\s+/g, ' ')
    if (!named.has(key)) named.set(key, [])
    named.get(key).push(r)
  }
  for (const [key, g] of named) judge(key, g, { needBranches: false })
  // 2. any other caption carried by two or more branches (the inter-branch / Head Office accounts have their own elimination)
  const taken = new Set([...named.values()].flat())
  const generic = new Map()
  for (const r of (rows || [])) {
    if (taken.has(r) || isInterBranchRow(r)) continue
    const m1 = String(r.mapping1_resultant || r.level1 || '').trim()
    const m2 = String(r.mapping2_resultant || r.level2 || '').trim()
    const m3 = String(r.mapping3_resultant || r.level3 || '').trim()
    if (!m1 || /uncategori[sz]ed/i.test(`${m1} ${m2} ${m3}`)) continue   // an unfinished mapping stays visible, to be fixed
    const key = [String(r.alie || ''), m1, m2, m3].join('|').toLowerCase().replace(/\s+/g, ' ')
    if (!generic.has(key)) generic.set(key, [])
    generic.get(key).push(r)
  }
  for (const [key, g] of generic) judge(key, g, { needBranches: true })

  if (!dropped.size && !noCY.size && !noPY.size) return { rows, summary: summary.length ? summary : null }
  const out = []
  for (const r of rows) {
    if (dropped.has(r)) continue
    if (noCY.has(r)) { out.push({ ...r, closing_balance: '0' }); continue }
    if (noPY.has(r)) { out.push({ ...r, opening_balance: '0' }); continue }
    out.push(r)
  }
  return { rows: out, summary }
}

// ── GST: one NET balance per Balance Sheet (0.1.14) ──────────────────────────
// Tally keeps Output CGST/SGST/IGST (credits) and Input CGST/SGST/IGST (debits)
// side by side under 'Duties & Taxes'. They are settled against each other in
// the electronic ledgers, so Schedule III shows ONE figure: a liability
// (Statutory dues payable) when the net is a credit, an asset (Balances with
// government authorities) when the net is a debit. Every GST balance-sheet
// ledger is therefore re-sided onto the side of the NET — the BS shows one
// line, and the note still lists each ledger so the netting is auditable.
// Ledgers that are GST *costs* (expense, late fee, interest, penalty, RCM
// expense) are not balances and are left alone.
export const GST_LEDGER_RX = /\b(c|s|i|ut)?gst\b|\bgst\s*cess\b|goods\s*(and|&)\s*services?\s*tax|electronic\s*(credit|cash)\s*ledger|input\s*tax\s*credit|\bitc\b/i
const GST_NOT_BALANCE_RX = /expense|\bexp\b|late\s*fee|interest|penalt|fine|written\s*off|reversal\s*exp|paid\s*on\b/i
const GST_HOME = {
  cr: { alie: 'EQUITY AND LIABILITIES', level1: 'Current liabilities', level2: 'Other current liabilities', level3: 'Statutory dues payable' },
  dr: { alie: 'ASSETS', level1: 'Current assets', level2: 'Short-term loans and advances', level3: 'Balances with government authorities (GST input credit and other tax credits)' },
}
const GST_HOME_L3 = new Set([GST_HOME.cr.level3.toLowerCase(), GST_HOME.dr.level3.toLowerCase()])
const GST_DR_L5 = new Set(['Secured, considered good', 'Unsecured, considered good', 'Doubtful'])
const isGstBalanceRow = (row) => {
  const a = row.alie
  if (a === 'Income' || a === 'Expenses') return false
  const name = (row.ledger_name || row.name || '') + ''
  if (!(GST_LEDGER_RX.test(name) && !GST_NOT_BALANCE_RX.test(name))) return false
  // A CA can deliberately move a GST-named ledger (e.g. "GST NETT", an annual
  // refund) somewhere other than the two GST-net homes via Fix Categorisation
  // - mappedTB:override marks that row status='user_override'. Without this
  // check this function silently forced it straight back to Balances with
  // government authorities / Statutory dues payable on every render, no
  // matter what was saved, since it matches purely on ledger NAME. Only
  // overriding a fresh/auto row (or one a human approved while it was
  // still sitting at a GST home) preserves the intended netting for the
  // normal case.
  if (row.status === 'user_override') {
    const l3 = ((row.mapping3_resultant || row.level3 || '') + '').trim().toLowerCase()
    if (!GST_HOME_L3.has(l3)) return false
  }
  return true
}
export function netGstRows(rows) {
  const gst = (rows || []).filter(isGstBalanceRow)
  if (!gst.length) return { rows, summary: null }
  const bal = (r) => parseFloat(r.closing_balance || 0)          // Dr negative, Cr positive
  const net = gst.reduce((s, r) => s + bal(r), 0)
  const dr  = gst.reduce((s, r) => s + (bal(r) < 0 ? -bal(r) : 0), 0)
  const cr  = gst.reduce((s, r) => s + (bal(r) > 0 ?  bal(r) : 0), 0)
  const home = net >= 0 ? GST_HOME.cr : GST_HOME.dr
  // The two homes are split at different levels (Mapping_v2.xlsx): Statutory
  // dues payable at Level 4 (GST payable / TDS payable / ...), Balances with
  // government authorities at Level 5 (Secured, considered good / Unsecured,
  // considered good / Doubtful). A ledger kept the Level 4-7 of wherever it
  // was mapped, so whenever the net fell on the other side it had none of its
  // new home's — "Unclassified" in the note, fixed by hand, broken again when
  // the net flipped (26 Sep 2026). It gets its home's own.
  const levelsFor = (r) => net >= 0
    ? { level4_value: 'GST payable', level5_value: null, level6_value: null, level7_value: null }
    : { level4_value: null, level6_value: null, level7_value: null,
        level5_value: GST_DR_L5.has(String(r.level5_value || '').trim()) ? String(r.level5_value).trim() : 'Unsecured, considered good' }
  const out = rows.map(r => isGstBalanceRow(r)
    ? { ...r, alie: home.alie, level1: home.level1, mapping1_resultant: home.level1, level2: home.level2, mapping2_resultant: home.level2,
        level3: home.level3, mapping3_resultant: home.level3, ...levelsFor(r), gst_netted: true }
    : r)
  return { rows: out, summary: { net, dr, cr, count: gst.length, side: net >= 0 ? 'liability' : 'asset', ledgers: gst.map(r => ({ name: r.ledger_name || r.name, branch: r.branch_name || null, amount: bal(r) })) } }
}

// ── A Level 2 from the other statement is not presented (0.1.34) ────────────
// Santosh Kumar Gupta's "Purchase Gst 5%" was saved as Purchases of
// Stock-in-Trade (a P&L head) with Level 2 still "Short-term loans and
// advances" (a Balance Sheet heading) — likewise "IGST SALES" and "SALE GST
// NIL" under Revenue from operations — and the P&L notes printed that Balance
// Sheet heading as one of their lines. The Mapped TB grid had kept the old
// Level 2 and 3 when the ledgers were moved off the GST balance head (fixed
// there too), but rows already saved that way must not keep printing wrong.
// Such a Level 2 cannot belong to the ledger's Level 1, so it is ignored, with
// the Level 3 under it: the ledger shows under its note's own fallback line
// ("Purchases" / "Unclassified"), and the Exception Report and the
// Rectification queue list it until the CA corrects it. Only a caption the
// Level Format places solely on the OTHER statement counts — a custom line the
// CA typed is never second-guessed. Applied to Previous Year rows as well, so
// their figures still land on the same line.
const statementOf = (alie) => (alie === 'Income' || alie === 'Expenses') ? 'P&L'
  : (alie === 'ASSETS' || alie === 'EQUITY AND LIABILITIES') ? 'Balance Sheet' : null
export function ignoreForeignLevel2(rows, levelFormat) {
  if (!rows?.length || !levelFormat?.length) return { rows: rows || [], flagged: [] }
  const norm = (v) => String(v || '').replace(/\(specify nature\)/gi, '').trim().toLowerCase()
  const level2Statements = new Map()   // Level 2 caption -> the statement(s) the format puts it on
  const level1Statement = new Map()    // Level 1 caption -> its statement
  for (const lf of levelFormat) {
    const st = statementOf(lf.alie)
    if (!st) continue
    if (lf.level2) {
      const k = norm(lf.level2)
      if (!level2Statements.has(k)) level2Statements.set(k, new Set())
      level2Statements.get(k).add(st)
    }
    if (lf.level1 && !level1Statement.has(norm(lf.level1))) level1Statement.set(norm(lf.level1), st)
  }
  const flagged = []
  const out = rows.map(row => {
    const level2 = row.mapping2_resultant || row.level2
    if (!level2) return row
    const homes = level2Statements.get(norm(level2))
    if (!homes) return row
    const level1 = row.level1 || row.mapping1_resultant || ''
    const own = level1Statement.get(norm(level1)) || statementOf(row.alie)
    if (!own || homes.has(own)) return row
    flagged.push({
      ledger: row.ledger_name || row.name || '', branch: row.branch_name || null,
      level1, level2, statement: own, otherStatement: [...homes][0],
      closing: displayAmt(row, 'closing_balance'), opening: displayAmt(row, 'opening_balance'),
    })
    return { ...row, level2: null, mapping2_resultant: null, level3: null, mapping3_resultant: null, ignored_level2: level2 }
  })
  return { rows: out, flagged }
}

// One Exception Report line per ledger: CY from the current rows, PY from the
// separate comparative TB's rows when there is one, else the opening balance.
function foreignLevel2Report(cyFlagged, pyFlagged, hasPrevTB) {
  const key = (f) => [f.ledger, f.branch || '', f.level1, f.level2].map(v => String(v).toLowerCase()).join('|')
  const byKey = new Map()
  for (const f of cyFlagged) byKey.set(key(f), { ...f, cy: f.closing, py: hasPrevTB ? 0 : f.opening })
  for (const f of pyFlagged) {
    const k = key(f)
    if (byKey.has(k)) byKey.get(k).py = f.closing
    else byKey.set(k, { ...f, cy: 0, py: f.closing })
  }
  return [...byKey.values()]
}

/** Closing / opening WDV of the entity-wide schedules, for the Exception Report. */
export function consolidatedDepSummary(depITData, depCompData) {
  const n = (v) => parseFloat(v) || 0
  const comp = Array.isArray(depCompData?.categoryRows) && depCompData.categoryRows.length
    ? { close: depCompData.categoryRows.reduce((s, r) => s + n(r.netBlockClose), 0), open: depCompData.categoryRows.reduce((s, r) => s + n(r.netBlockOpen), 0), included: !!depCompData.includeInPPENote }
    : null
  const it = Array.isArray(depITData?.blockSummary) && depITData.blockSummary.length
    ? { close: depITData.blockSummary.reduce((s, b) => s + n(b.closingWDV), 0), open: depITData.blockSummary.reduce((s, b) => s + n(b.openingWDV), 0), included: !!depITData.includeInPPENote }
    : null
  return (comp || it) ? { comp, it } : null
}

export function displayAmt(row, field = 'closing_balance') {
  const bal = parseFloat(row[field] || 0)
  let alie = row.alie || ''
  // Advance to Suppliers / Advance from Customers: mapped_tb.alie can go
  // stale here. mapping-engine.js's reclassification pass sets alie AND
  // mapping1/2/3 together, but a LATER manual re-categorisation (Fix
  // Categorisation) can change mapping1/2/3 without ever touching alie —
  // there is no code path that keeps them in sync after the first move.
  // The L3 caption (whichever field actually carries it — mapping3_resultant
  // is mapped_tb's own value, level3 is what LevelFormat/grouping code
  // elsewhere falls back to) is what the note/BS grouping and the user's own
  // Fix screen actually treat as authoritative (confirmed against a real
  // case: alie sat at "ASSETS" while mapping1/2/3 correctly pointed to
  // Liabilities → Other current liabilities → Advance from Customers) — so
  // for these two specific captions, trust the caption over alie rather than
  // requiring alie to already agree with it. Matched loosely (trimmed,
  // case-insensitive, either field) so stray whitespace/casing from a
  // manually-typed override can't silently defeat this.
  const l3Caption = ((row.mapping3_resultant || row.level3 || '') + '').trim().toLowerCase()
  if (l3Caption === 'advance from customers') alie = 'EQUITY AND LIABILITIES'
  else if (l3Caption === 'advance to suppliers') alie = 'ASSETS'
  // Sign convention is driven by the SIDE of the statement, not by the
  // ledger's individual is_deemed_positive flag. This way a Cr-natured row
  // sitting on the Assets side correctly shows as negative (e.g. an
  // overdraft), and a Dr-natured row on the E&L side shows as negative
  // (e.g. a partner with drawings exceeding capital).
  //   Dr-side (ASSETS, Expenses): Dr balances stored negative, flip → positive.
  //                               Cr balances stored positive → negative on display.
  //   Cr-side (EQUITY AND LIABILITIES, Income): Cr stored positive → positive on display.
  //                                             Dr stored negative → negative on display.
  const isDrSide = (alie === 'ASSETS' || alie === 'Expenses')
  return isDrSide ? -bal : bal
}

// ── PY map builder ─────────────────────────────────────────────────────────────

/**
 * Build a lookup map from Previous Year TB rows.
 * Key: `${alie}|${level1}|${mapping2_resultant}`
 * Value: total display amount (CY of prevTB = PY figures)
 */
function buildPrevMap(prevRows) {
  // Same "Stock tab bifurcation supersedes the raw ledger it replaces" rule
  // already applied to the CURRENT year in inventorySplit.js's
  // computeInventorySplit (pickAuthoritative) — without it here too, a PY TB
  // that has BOTH an auto-embedded "Opening Stock" ledger (e.g. from Tally's
  // aggregate stock value — see getTallyStockTotals) AND a manually-entered
  // Stock Entry bifurcation of that same figure double-counts the Previous
  // Year comparative, since both land under the identical
  // alie|level1|level2 key below.
  // Revenue's "Sale" is keyed by Sale of Goods / Sale of Services, as
  // buildSections builds its lines (utils/revenueLines.js).
  const l2Of = (row) => revenueLevel2(row.level1, row.mapping2_resultant || row.level2 || '', row.mapping3_resultant || row.level3)
  const keyOf = (row) => {
    const alie = row.alie || ''
    const l1   = (row.level1 || 'Uncategorised').trim().toLowerCase()
    const l2   = (l2Of(row) || '').trim().toLowerCase()
    return `${alie}|${l1}|${l2}`
  }
  const stockEntryKeys = new Set(
    prevRows.filter(r => r.upload_nature === 'Stock Entry').map(keyOf)
  )
  const map = new Map()
  // Original-cased (level1, level2) per key — reconcilePrevTotals() below
  // needs these to route an unmatched PY figure back to its OWN category
  // instead of a generic catch-all note; the key itself is lower-cased.
  const labels = new Map()
  for (const row of prevRows) {
    const key = keyOf(row)
    // A raw ledger row (e.g. 'Opening Stock (Tally)'/'Opening Stock (Manual)')
    // sharing a key with a real Stock Entry row IS that same figure, already
    // bifurcated by the CA — it supersedes the raw ledger, not adds to it.
    if (stockEntryKeys.has(key) && row.upload_nature !== 'Stock Entry') continue
    const amt = displayAmt(row, 'closing_balance')
    map.set(key, (map.get(key) || 0) + amt)
    if (!labels.has(key)) {
      labels.set(key, {
        level1: row.level1 || 'Uncategorised',
        level2: l2Of(row) || '',
      })
    }
  }
  map.labels = labels
  // The prior TB's raw rows, carried alongside the aggregated map: the
  // inventory split needs row-level access (level5_value category, Stock-Entry
  // provenance) to give the PY column the same treatment as the CY column, and
  // an (alie|level1|level2) aggregate can't provide that.
  map.rows = prevRows
  return map
}

/**
 * Same as buildPrevMap, one level finer: keyed by
 * `${alie}|${level1}|${level2}|${level3}`. Annexures groups Balance-Sheet
 * notes by Level 3 (see annexureGrouping.js — Trade Payables/Receivables
 * sub-groups, Inventories categories, Fixed Assets classes, etc.), and those
 * groups have no equivalent of a P&L note's pre-built `.lines[].prevTotal`
 * (buildSections only aggregates to Level 2) — without this, every such
 * BS-side sub-note group falls back to showing nothing for Previous Year
 * once a separate comparative TB is selected, even though P&L notes with
 * real Level-2 lines show PY correctly via buildPrevMap above. This closes
 * that gap so PY is available consistently, not just for P&L notes.
 */
function buildPrevMapL3(prevRows) {
  const keyOf = (row) => {
    const alie = row.alie || ''
    const l1   = (row.level1 || 'Uncategorised').trim().toLowerCase()
    const l2   = (row.mapping2_resultant || row.level2 || '').trim().toLowerCase()
    const l3   = (row.mapping3_resultant || row.level3 || '').trim().toLowerCase()
    return `${alie}|${l1}|${l2}|${l3}`
  }
  const stockEntryKeys = new Set(
    prevRows.filter(r => r.upload_nature === 'Stock Entry').map(keyOf)
  )
  const map = new Map()
  for (const row of prevRows) {
    const key = keyOf(row)
    if (stockEntryKeys.has(key) && row.upload_nature !== 'Stock Entry') continue
    const amt = displayAmt(row, 'closing_balance')
    map.set(key, (map.get(key) || 0) + amt)
  }
  return map
}

/**
 * Per-LEDGER PY lookup, keyed by ledger_code (falling back to lower-cased
 * ledger name when a ledger has no code) — an actual identity match across
 * the two separate TBs, unlike buildPrevMap/buildPrevMapL3 above which only
 * aggregate to a classification bucket. This is what lets Annexures show a
 * genuine Previous Year figure per individual ledger row (e.g. each ledger
 * inside "Other Expenses") instead of leaving every row blank just because
 * a bucket-level total can't be broken back down to its constituent
 * ledgers. Ledgers renamed between years, or genuinely new/dropped ones,
 * simply won't match — that's correct, not a bug: there's nothing to show.
 */
function buildPrevRowsByLedger(prevRows) {
  const keyOf = (row) => (row.ledger_code || row.name || '').trim().toLowerCase()
  const map = new Map()
  for (const row of prevRows) {
    const key = keyOf(row)
    if (!key) continue
    const amt = displayAmt(row, 'closing_balance')
    map.set(key, (map.get(key) || 0) + amt)
  }
  return map
}

// ── Manual Previous Year entry ───────────────────────────────────────────────
// See applyManualPyOverrides() further below (applied after Notes/templateRows
// are built) — entered inline per note/particular in the Notes screen, not
// injected at the raw-TB-row stage.

// Normalises Dep(IT)'s manually-entered PY totals (all Editor/Block Summary
// columns except Amt-as-per-TB/Difference — CY-TB-specific/derived, N/A to a
// manual PY figure) into numbers, or null if every field is blank/zero.
function extractItBlockSummaryPyTotals(py) {
  if (!py) return null
  const num = v => parseAmt(v) || 0
  const out = {
    openingWDV: num(py.openingWDV), addBefore180: num(py.addBefore180), addAfter180: num(py.addAfter180),
    deduction: num(py.deduction), stclStcg: num(py.stclStcg),
    depreciation: num(py.depreciation), closingWDV: num(py.closingWDV),
  }
  return Object.values(out).some(v => v !== 0) ? out : null
}

// Capital WIP / Intangible WIP (Dep (IT) only, manually entered — see
// utils/depStore.js's wipHasFigures doc comment). Returned only when at
// least one figure was actually entered, same gating as the PY helper above.
function extractItWip(wip) {
  if (!wip) return null
  const num = v => parseAmt(v) || 0
  const out = { capitalCY: num(wip.capitalCY), intangibleCY: num(wip.intangibleCY), prevYearTotal: num(wip.prevYearTotal) }
  return Object.values(out).some(v => v !== 0) ? out : null
}

// Same idea as extractItBlockSummaryPyTotals, for Dep (Comp)'s own manually-
// entered PY totals row (one field per Gross Block/Depreciation/Net Block
// column — see DepreciationComp/index.jsx's PY_TOTALS_FIELDS).
function extractCompSchedulePyTotals(py) {
  if (!py) return null
  const num = v => parseAmt(v) || 0
  const out = {
    grossOpen: num(py.grossOpen), additions: num(py.additions), deductions: num(py.deductions), grossClose: num(py.grossClose),
    depOpen: num(py.depOpen), depForYear: num(py.depForYear), depOnDisposal: num(py.depOnDisposal), depClose: num(py.depClose),
    netBlockOpen: num(py.netBlockOpen), netBlockClose: num(py.netBlockClose),
  }
  return Object.values(out).some(v => v !== 0) ? out : null
}

// ── Section ordering (matches Schedule III corporate format) ────────────────
// EL_ORDER_CORP/NONCORP, elOrderFor, nonCorpSectionSortKey, ASSET_ORDER now
// live in bsStructure.js (imported above) — see that file's comment for why.
const INCOME_ORDER = [
  "Revenue from operations", "Closing Stock (PL)", "Other income",
]
const EXPENSE_ORDER = [
  "Cost of materials consumed", "Purchase Accounts", "Opening Stock (PL)",
  "Changes in inventories", "Employee benefits expense", "Finance Costs",
  "Depreciation & Amortisation Expenses", "Other expenses",
  "Tax Expense",
]

// ── Level 2 ordering WITHIN a Balance Sheet section (Schedule III / the ICAI
// non-corporate Form) ────────────────────────────────────────────────────
// Applies inside every E&L/Assets L1 section identically regardless of
// constitution — "Current liabilities" always presents Short-term
// borrowings → Trade payables → Other current liabilities → Short-term
// provisions, "Current assets" always presents Current investments →
// Inventories → Trade receivables → Cash and bank balances → Short-term
// loans and advances → Other current assets, etc. Without this, L2 lines
// fall back to LevelFormat's sort_order (often unset/tied) then alphabetical
// — which is how "Other current liabilities"/"Other current assets" was
// ending up ahead of Trade payables/Trade receivables (an "O" sorting before
// a "T" alphabetically has nothing to do with Schedule III's actual order).
// This is also what the live BS screen renders from for non-corporate
// entities (computeDynamicBSLayout just passes elSections/assetSections
// through as-is) — so fixing the sort here fixes the face of the BS and the
// note numbering in the same stroke; Company already has its own
// independent, always-correct ordering via bsStructure.js's BS_STRUCTURE.
const BS_L2_ORDER = [
  // Equity / Owners' Fund
  'share capital', "owners' capital account", "partners' capital account", 'capital account', 'share warrant',
  'share application money',
  'reserves and surplus',
  // Non-current liabilities
  'long-term borrowings', 'long term borrowings',
  'deferred tax liabilities',
  'other long-term liabilities', 'other long term liabilities',
  'long-term provisions', 'long term provisions',
  // Current liabilities
  'short-term borrowings', 'short term borrowings',
  'trade payables',
  'other current liabilities',
  'short-term provisions', 'short term provisions',
  // Non-current assets
  'property, plant and equipment', 'tangible assets', 'intangible assets',
  'capital work-in-progress', 'intangible assets under development',
  'non-current investments', 'non current investments',
  'deferred tax assets',
  'long-term loans and advances', 'long term loans and advances',
  'other non-current assets', 'other non current assets',
  // Current assets
  'current investments',
  'inventories',
  'trade receivables',
  'cash and bank balances', 'cash and cash equivalents',
  'short-term loans and advances', 'short term loans and advances',
  'other current assets',
]
function bsL2SortKey(level2) {
  const lower = (level2 || '').trim().toLowerCase()
  for (let i = 0; i < BS_L2_ORDER.length; i++) {
    if (lower.includes(BS_L2_ORDER[i])) return i
  }
  return null  // not a recognised BS sub-head — fall back to sort_order/alphabetical
}

// sectionSortKey now lives in bsStructure.js (imported above).

// ── Section builder ───────────────────────────────────────────────────────────

// Canonical form: trim whitespace only. Preserve original capitalisation for
// display; the dedup in note assignment handles case variations at note level.
function canonL(s) { return (s || '').trim() }

function buildSections(alieRows, alie, prevMap) {
  // l1Map: canonical-l1 → { display: string, l2Map: canonical-l2 → { display, rows[] } }
  const l1Map = new Map()
  for (const row of alieRows) {
    const l1raw  = row.level1 || 'Uncategorised'
    const l1key  = canonL(l1raw).toLowerCase()
    if (!l1Map.has(l1key)) l1Map.set(l1key, { display: l1raw, l2Map: new Map() })
    const entry = l1Map.get(l1key)
    // If current display is still the Uncategorised fallback but this row has a real name, upgrade it
    if (/uncategorised/i.test(entry.display) && !/uncategorised/i.test(l1raw)) {
      entry.display = l1raw
    }

    // Revenue from operations' "Sale" becomes Sale of Goods / Sale of
    // Services by its Level 3 (utils/revenueLines.js); every other line is
    // its Level 2 as mapped.
    const l2raw  = revenueLevel2(l1raw, row.mapping2_resultant || row.level2 || '', row.mapping3_resultant || row.level3) || ''
    const l2key  = canonL(l2raw).toLowerCase()
    if (!entry.l2Map.has(l2key)) entry.l2Map.set(l2key, { display: l2raw, rows: [] })
    const l2entry = entry.l2Map.get(l2key)
    // Prefer the "proper" title (non-empty, non-uncategorised)
    if (!l2entry.display && l2raw) l2entry.display = l2raw
    l2entry.rows.push(row)
  }

  return [...l1Map.entries()].map(([_l1key, { display: l1, l2Map }]) => {
    const lines = [...l2Map.entries()].map(([_l2key, { display: l2, rows }]) => {
      const total = rows.reduce((s, r) => s + displayAmt(r, 'closing_balance'), 0)
      // Manual PY mode overrides this at the note/particular level afterwards
      // (see applyManualPyOverrides) — this is just the auto-derived default.
      const prevTotal = prevMap
        ? (prevMap.get(`${alie}|${l1.trim().toLowerCase()}|${l2.trim().toLowerCase()}`) || 0)
        : rows.reduce((s, r) => s + displayAmt(r, 'opening_balance'), 0)
      // Use minimum sort_order of rows to preserve Schedule III ordering
      const minSortOrder = rows.reduce((m, r) => Math.min(m, r.sort_order ?? 9999), 9999)
      const forceInclude = rows.some(r => r.forceInclude)
      return { level2: l2, total, prevTotal, rows, minSortOrder, forceInclude }
    }).sort((a, b) => {
      // Uncategorised always last
      const aU = /uncategorised/i.test(a.level2 || '')
      const bU = /uncategorised/i.test(b.level2 || '')
      if (aU !== bU) return aU ? 1 : -1
      // Primary (BS sides only): fixed Schedule III sub-head order — see
      // BS_L2_ORDER's doc comment for why this has to outrank sort_order.
      if (alie === 'EQUITY AND LIABILITIES' || alie === 'ASSETS') {
        const aBs = bsL2SortKey(a.level2)
        const bBs = bsL2SortKey(b.level2)
        if (aBs !== null && bBs !== null && aBs !== bBs) return aBs - bBs
        if (aBs !== null && bBs === null) return -1
        if (aBs === null && bBs !== null) return 1
      }
      // Revenue: Sale of Goods, Sale of Services, then any sale still to be
      // bifurcated, ahead of the other Level 2 lines.
      if (alie === 'Income') {
        const aR = revenueLineRank(a.level2), bR = revenueLineRank(b.level2)
        if (aR !== null || bR !== null) return (aR ?? 99) - (bR ?? 99)
      }
      // Next: sort_order from LevelFormat
      if (a.minSortOrder !== b.minSortOrder) return a.minSortOrder - b.minSortOrder
      // Last: alphabetical by level2 label
      return (a.level2 || '').localeCompare(b.level2 || '')
    })
    return {
      level1:       l1,
      total:        lines.reduce((s, l) => s + l.total,     0),
      prevTotal:    lines.reduce((s, l) => s + l.prevTotal, 0),
      lines,
      forceInclude: lines.some(l => l.forceInclude),
    }
  })
}

// ── Core processor ────────────────────────────────────────────────────────────

export function processRows(rows, prevMap, constitution = null, noteDetailsList = [], businessType = null, skipProfitInjectionCY = false, skipProfitInjectionPY = false, generalNotesMode = null, lfRows = [], manualPyOnlyTitles = null) {
  // ── Stock tab bifurcation supersedes the raw ledger it replaces (CURRENT YEAR) ──
  // The same rule already applied to the P&L side by inventorySplit.js's
  // pickAuthoritative(), and to the Previous Year by buildPrevMap() above —
  // but NOT, until now, to the current-year BALANCE SHEET, which is where it
  // matters most.
  //
  // The double-count it fixes: a client who sets F11 "Integrate Accounts and
  // Inventory" to No keeps a real Stock-in-Hand LEDGER in Tally carrying the
  // closing stock. That ledger imports like any other and maps to
  // ASSETS > Current assets > Inventories. When the CA then bifurcates the
  // same closing stock in the Stock tab (Raw Material / Stock in Trade / …),
  // saveStockEntries writes 'Closing Stock - BS - <type>' rows that map to the
  // *identical* key — so Inventories showed BOTH, exactly doubling closing
  // stock and throwing the Balance Sheet out by that amount.
  //
  // Stock tab entries are a bifurcation of the figure the TB already carries,
  // never an addition to it. So when a Stock Entry row exists for a given
  // alie|level1|level2, it is authoritative for that key and the raw rows it
  // replaces are dropped. With the Stock tab empty there are no Stock Entry
  // rows, nothing collides, and the raw ledger stands alone exactly as before.
  // level1 falls back to mapping1_resultant (and level2 to mapping2_resultant,
  // as buildPrevMap already does): a Stock Entry row only gets level1/level2
  // populated if saveStockEntries found a matching level_format row for its
  // exact Level-3 caption. When that lookup misses, level_format_id is null and
  // level1 arrives empty — the key would then read 'Uncategorised' and quietly
  // fail to collide with the raw ledger it is supposed to supersede, leaving
  // the double-count in place. mapping1_resultant is always set on these rows
  // (saveStockEntries writes it, and schema.js's repair migration re-asserts
  // it), so it is the reliable fallback.
  const stockKeyOf = (row) => {
    const alie = row.alie || ''
    const l1   = (row.level1 || row.mapping1_resultant || 'Uncategorised').trim().toLowerCase()
    const l2   = (row.mapping2_resultant || row.level2 || '').trim().toLowerCase()
    return `${alie}|${l1}|${l2}`
  }
  const stockEntryKeysCY = new Set(
    (rows || []).filter(r => r.upload_nature === 'Stock Entry').map(stockKeyOf)
  )
  if (stockEntryKeysCY.size) {
    rows = (rows || []).filter(r =>
      r.upload_nature === 'Stock Entry' || !stockEntryKeysCY.has(stockKeyOf(r))
    )
  }

  // GST: one net balance (see netGstRows) — applies to single-branch and
  // consolidated alike; the summary is surfaced in the Exception Report.
  const gstNet = netGstRows(rows)
  rows = gstNet.rows

  const byAlie = {}
  // BS-side balancing: rows with no usable classification are invisible to
  // BS but still carry real balances → BS won't tally against a matched TB.
  // Route them into a clearly-flagged "Uncategorised Assets" / "Uncategorised
  // Liabilities" bucket instead of dropping/mislabelling them, so nothing
  // silently falls out of the Balance Sheet. Two cases:
  //   (a) ALIE itself is unknown → pick a side from the ledger's natural
  //       balance (is_deemed_positive=true → Dr-natured → ASSETS).
  //   (b) ALIE is known (a BS side) but Level 1 never resolved (a stray /
  //       conflicting mapping) → keep it on its known side, just label it.
  // This only ever affects the *label*; the Dr/Cr sign placement itself is
  // unchanged — still driven entirely by displayAmt() below, same as today.
  // Hard guard: "Tax expense" (Schedule III) is unconditionally a P&L-only
  // caption — it must NEVER render on the Balance Sheet, full stop. This is
  // deliberately unconditional on HOW alie/level1 got set (a mapping-engine
  // bug, a bad level_format row, a wrong manual Categorisation approval) —
  // no matter the upstream cause, a row captioned this way is being placed
  // in P&L Expenses, not left to whatever alie it arrived with.
  const isTaxExpenseCaption = (row) =>
    /^tax\s*expense\b/i.test((row.level1 || row.mapping1_resultant || '').trim())

  for (let row of rows) {
    let a = row.alie
    if (isTaxExpenseCaption(row) && a !== 'Expenses' && a !== 'Income') {
      a = 'Expenses'
      row = { ...row, alie: a }
    }
    // Inter-branch / HO account: sits on the side of its balance (a branch's
    // HO account is normally a Cr → Equity & Liabilities; the HO's branch
    // account a Dr → Assets), so a single-branch Balance Sheet shows it as a
    // positive line on the right side instead of a negative asset.
    if (isInterBranchRow(row) && a !== 'Income' && a !== 'Expenses') {
      a = parseFloat(row.closing_balance || 0) > 0 ? 'EQUITY AND LIABILITIES' : 'ASSETS'
      row = { ...row, alie: a }
    }
    if (!a) {
      a = row.is_deemed_positive ? 'ASSETS' : 'EQUITY AND LIABILITIES'
      const label = a === 'ASSETS' ? 'Uncategorised Assets' : 'Uncategorised Liabilities'
      // ALIE was never determined for this row, so any level1/mapping1_resultant
      // already sitting on it is orphaned — computed by some earlier mapping
      // stage without a confirmed ALIE behind it (e.g. a Level-1 caption
      // guessed from the ledger's name/text alone). That stray caption can be
      // a P&L-only label like "Tax expense:", and trusting it here would put
      // it straight onto the Balance Sheet. Always force the Uncategorised
      // label instead of falling back to whatever was already on the row.
      row = { ...row, alie: a, level1: label, mapping1_resultant: label }
    } else if ((a === 'ASSETS' || a === 'EQUITY AND LIABILITIES') && !row.level1) {
      const label = a === 'ASSETS' ? 'Uncategorised Assets' : 'Uncategorised Liabilities'
      row = { ...row, level1: label, mapping1_resultant: row.mapping1_resultant || label }
    }
    if (!byAlie[a]) byAlie[a] = []
    byAlie[a].push(row)
  }

  // ── A Balance Sheet major head with a Manual PY figure but NO real Current
  // Year ledger at all ("insert a Note purely for a Previous Year figure",
  // e.g. a head that had a balance last year and none this year) — see
  // Notes/index.jsx's "+ Add PY-only Major Head". Without this, such a title
  // never enters notes{} at all (the zero-CY/zero-PY skip in the loops
  // below), so applyManualPyOverrides() — which only overlays onto EXISTING
  // notes — has nothing to attach the saved figure to; it sits in the
  // database, invisible. A single synthetic zero-value row, sourced from the
  // entity's OWN LevelFormat (the same master data both the Company's fixed
  // Schedule III layout and every other constitution's dynamic layout
  // already derive alie/level1/sort_order from), lets that title flow
  // through buildSections()/EL_ORDER exactly like a real ledger row — same
  // section, same statutory position, same note-numbering pass — so nothing
  // downstream (face rendering, PDF, Excel) needs a special case for it. Its
  // real Previous Year figure is overlaid afterwards by
  // applyManualPyOverrides(), same as any other note's Manual PY entry.
  if (manualPyOnlyTitles && manualPyOnlyTitles.size) {
    const bsSides = ['EQUITY AND LIABILITIES', 'ASSETS']
    const plSides = ['Income', 'Expenses']
    // A head is "already present" only when its Current Year ledgers add up
    // to a figure. Ledgers mapped to it with a nil balance — or balances that
    // cancel out, e.g. GST ledgers netted onto Statutory dues payable — make
    // no note of their own, so treating the head as present left the
    // PY-only figure with no note to land on: the BS face showed the note
    // number with a blank Previous Year and the Notes screen skipped it
    // (Other current liabilities, Proprietorship, 27 Sep 2026).
    const cyByTitle = new Map()
    const addCY = (t, row) => { if (t) cyByTitle.set(t, (cyByTitle.get(t) || 0) + (parseFloat(row.closing_balance) || 0)) }
    for (const side of bsSides) {
      for (const row of byAlie[side] || []) addCY((row.mapping2_resultant || row.level2 || '').trim().toLowerCase(), row)
    }
    // A P&L note is identified by Level 1, not Level 2 (see the PL note-
    // assignment loop below, "one note per Level1 section").
    for (const side of plSides) {
      for (const row of byAlie[side] || []) addCY((row.mapping1_resultant || row.level1 || '').trim().toLowerCase(), row)
    }
    const present = new Set([...cyByTitle].filter(([, v]) => Math.abs(v) >= 0.005).map(([t]) => t))
    for (const title of manualPyOnlyTitles) {
      if (!title || present.has(title)) continue
      const bsLf = (lfRows || []).find(l =>
        bsSides.includes(l.alie) && (l.level2 || '').trim().toLowerCase() === title)
      if (bsLf) {
        const side = bsLf.alie
        if (!byAlie[side]) byAlie[side] = []
        byAlie[side].push({
          level1: bsLf.level1, mapping1_resultant: bsLf.level1,
          level2: bsLf.level2, mapping2_resultant: bsLf.level2,
          level3: null, mapping3_resultant: null,
          alie: side, sort_order: bsLf.sort_order,
          closing_balance: '0', opening_balance: '0', trail_balance: '0',
          is_deemed_positive: side === 'ASSETS',
          ledger_name: '(Previous Year only)', name: '(Previous Year only)',
          forceInclude: true,
        })
        present.add(title)
        continue
      }
      // Not a known BS major head by that exact title — try a P&L major
      // head instead (e.g. "Partners' Remuneration", "Tax expense"),
      // matched against Level 1. Injected flat (no Level 2): one combined
      // figure for the whole note, same shape "Partners' Remuneration"
      // already has naturally — see Notes/index.jsx's
      // "+ Add PY-only Major Head".
      const plLf = (lfRows || []).find(l =>
        plSides.includes(l.alie) && (l.level1 || '').trim().toLowerCase() === title)
      if (!plLf) continue   // no known major head with this exact title on either statement — leave the entry orphaned, as before
      const side = plLf.alie
      if (!byAlie[side]) byAlie[side] = []
      byAlie[side].push({
        level1: plLf.level1, mapping1_resultant: plLf.level1,
        level2: null, mapping2_resultant: null,
        level3: null, mapping3_resultant: null,
        alie: side, sort_order: plLf.sort_order,
        closing_balance: '0', opening_balance: '0', trail_balance: '0',
        is_deemed_positive: side === 'Income',
        ledger_name: '(Previous Year only)', name: '(Previous Year only)',
        forceInclude: true,
      })
      present.add(title)
    }
  }

  // NOTE: Sign-based Trade Payables/Receivables reclassification (moving a
  // debit-balance Payables ledger to Assets, or a credit-balance Receivables
  // ledger to Liabilities) was attempted here and reverted — it relied on
  // displayAmt()'s alie-driven sign convention (Dr stored negative / Cr
  // stored positive, universally), which holds for TBs uploaded via the
  // Tally dual-file and Real Books paths (both explicitly normalize to it),
  // but is NOT guaranteed for the ODBC/Excel upload path (services/excel.js
  // parseTBExcel), which stores closing_balance and is_deemed_positive
  // exactly as given in the source file — i.e. whatever sign convention the
  // exporting system used, which may be relative to IsDeemedPositive rather
  // than an absolute Dr/Cr sign. Re-implement only after confirming the
  // actual sign convention for ODBC-sourced abnormal-balance rows (ideally
  // against real data), since a wrong assumption here silently corrupts the
  // Balance Sheet rather than just mislabelling it.

  const EL_ORDER = elOrderFor(constitution)
  const isNonCorp = parseInt(constitution) !== 3
  const elSortKey = isNonCorp ? nonCorpSectionSortKey : sectionSortKey

  // Build raw sections
  let elSectionsRaw   = buildSections(byAlie['EQUITY AND LIABILITIES'] || [], 'EQUITY AND LIABILITIES', prevMap)
  let assetSectionsRaw = buildSections(byAlie['ASSETS'] || [], 'ASSETS', prevMap)

  // ── Fix #3: Guard against mis-routed sections ─────────────────────────────
  // If an Asset-typed section ended up in E&L or vice-versa, re-route it.
  // Safe merge: if the destination already has a section with the same level1,
  // merge the lines into it rather than creating a duplicate.
  const isAssetLevel1 = (l1) => {
    const lower = (l1 || '').toLowerCase()
    return ASSET_ORDER.some(a => lower.includes(a.toLowerCase()))
  }
  const isELLevel1 = (l1) => {
    const lower = (l1 || '').toLowerCase()
    return EL_ORDER.some(e => lower.includes(e.toLowerCase()))
  }

  // Helper: merge srcSections into destSections (by level1 key, case-insensitive).
  // Sections in src that already exist in dest are merged (lines combined); new ones are appended.
  function mergeSections(dest, src) {
    const result = dest.map(s => ({ ...s, lines: [...s.lines] }))
    for (const stray of src) {
      const existing = result.find(s => s.level1.toLowerCase() === stray.level1.toLowerCase())
      if (existing) {
        existing.lines.push(...stray.lines)
        existing.total     = existing.lines.reduce((s, l) => s + l.total,     0)
        existing.prevTotal = existing.lines.reduce((s, l) => s + l.prevTotal, 0)
      } else {
        result.push(stray)
      }
    }
    return result
  }

  const elStray    = elSectionsRaw.filter(s => isAssetLevel1(s.level1) && !isELLevel1(s.level1))
  const assetStray = assetSectionsRaw.filter(s => isELLevel1(s.level1) && !isAssetLevel1(s.level1))

  const elSections    = mergeSections(
    elSectionsRaw.filter(s => !isAssetLevel1(s.level1) || isELLevel1(s.level1)),
    assetStray
  ).sort((a, b) => elSortKey(a.level1, EL_ORDER) - elSortKey(b.level1, EL_ORDER))

  const assetSections = mergeSections(
    assetSectionsRaw.filter(s => !isELLevel1(s.level1) || isAssetLevel1(s.level1)),
    elStray
  ).sort((a, b) => sectionSortKey(a.level1, ASSET_ORDER) - sectionSortKey(b.level1, ASSET_ORDER))
  const incomeSections  = buildSections(byAlie['Income'] || [], 'Income', prevMap)
    .sort((a, b) => sectionSortKey(a.level1, INCOME_ORDER) - sectionSortKey(b.level1, INCOME_ORDER))
  const expenseSections = buildSections(byAlie['Expenses'] || [], 'Expenses', prevMap)
    .sort((a, b) => sectionSortKey(a.level1, EXPENSE_ORDER) - sectionSortKey(b.level1, EXPENSE_ORDER))

  // ── Note assignment ─────────────────────────────────────────────────────────
  // Rule: a note is allocated ONLY when the item has a non-zero figure in the
  // current year OR the previous year. Uncategorised items never get a note
  // (they are handled by the Fix button in BS/PL instead).
  // This guarantees sequential, gap-free numbering: 1, 2, 3, 4 …
  //
  // BS notes:  one note per Level2 item (E&L first, then Assets).
  //            Deduplicate by title (case-insensitive): same L2 name across
  //            sections shares one note number; totals are merged.
  // PL notes:  one note per Level1 section (Income first, then Expenses).
  let noteNum = 1
  const notes = {}
  const noteByTitle = new Map()   // canonical title → note object
  // Every note number handed out below comes from here, and it never reuses
  // a number or lands on one already taken. Two schemes used to coexist — a
  // running counter and "highest existing + 1" — and neither knew about the
  // other, so a note created one way could be silently overwritten by the
  // other's `notes[n] = …`. Seen live: a Previous-Year-only "Other current
  // liabilities" balance overwrote the "Changes in inventories" note, so the
  // P&L kept printing note 7 (Other current liabilities) against Changes in
  // inventories and its own note vanished from Notes, PDF and Excel.
  const allocNoteNum = () => {
    let n = noteNum
    while (notes[n]) n++
    noteNum = n + 1
    return n
  }

  for (const section of [...elSections, ...assetSections]) {
    for (const line of section.lines) {
      if (!line.level2) continue
      // Skip items with no figures in either year — unless a Manual PY entry
      // for this exact title forced it in above (see the injection block).
      if (!line.forceInclude && Math.abs(line.total) < 0.005 && Math.abs(line.prevTotal) < 0.005) continue
      // Skip uncategorised buckets — user must fix them via the Fix button
      if (/uncategorised/i.test(line.level2)) continue

      const canonical = (line.level2 || '').trim().toLowerCase()
      const existing  = noteByTitle.get(canonical)
      if (existing) {
        // Merge into the existing note — same note number
        line.noteNum = existing.num
        existing.rows      = [...existing.rows, ...line.rows]
        existing.total     += line.total
        existing.prevTotal += line.prevTotal
      } else {
        const num = allocNoteNum()
        line.noteNum = num
        const note = {
          num:       num,
          title:     line.level2,
          level1:    section.level1,
          alie:      line.rows[0]?.alie || '',
          isPL:      false,
          rows:      line.rows,
          total:     line.total,
          prevTotal: line.prevTotal,
        }
        notes[num] = note
        noteByTitle.set(canonical, note)
      }
    }
  }

  for (const section of [...incomeSections, ...expenseSections]) {
    // Skip PL sections with no figures in either year — unless a Manual PY
    // entry for this exact title forced it in above (see the injection block).
    if (!section.forceInclude && Math.abs(section.total) < 0.005 && Math.abs(section.prevTotal) < 0.005) continue
    // Skip uncategorised PL sections
    if (/uncategorised/i.test(section.level1 || '')) continue

    const num = allocNoteNum()
    section.noteNum = num
    const plRows = section.lines.flatMap(l => l.rows)
    notes[num] = {
      num:       num,
      title:     section.level1,
      alie:      plRows[0]?.alie || '',
      isPL:      true,
      lines:     section.lines,
      rows:      plRows,
      total:     section.total,
      prevTotal: section.prevTotal,
    }
  }

  // ── Non-corporate (constitution=1) PL: "Purchases of Stock-in-Trade" shares
  // its note with "Cost of materials consumed" (per the ICAI non-corporate PL
  // format — both appear as separate face lines (a)/(b) but reference one
  // combined note; "Changes in inventories" keeps its own separate note).
  // Sections themselves stay distinct so the face can still show two lines —
  // only the note assignment is merged.
  if (parseInt(constitution) === 1) {
    const materialsSec = expenseSections.find(s => /^cost of materials consumed/i.test(s.level1 || ''))
    const purchasesSec = expenseSections.find(s => /^purchases of stock-in-trade/i.test(s.level1 || ''))
    if (materialsSec?.noteNum && purchasesSec?.noteNum && materialsSec.noteNum !== purchasesSec.noteNum) {
      const materialsNote = notes[materialsSec.noteNum]
      const purchasesNote = notes[purchasesSec.noteNum]
      if (materialsNote && purchasesNote) {
        materialsNote.lines = [...materialsNote.lines, ...purchasesNote.lines]
        materialsNote.rows = [...materialsNote.rows, ...purchasesNote.rows]
        materialsNote.total += purchasesNote.total
        materialsNote.prevTotal += purchasesNote.prevTotal
        delete notes[purchasesSec.noteNum]
        purchasesSec.noteNum = materialsSec.noteNum
      }
    }
  }

  // ── Raw-Material vs Others inventory split ──────────────────────────────
  // "Cost of materials consumed" = Opening RM + Purchases − Closing RM.
  // "Changes in inventories" should only cover WIP/Finished Goods/Stock-in-
  // Trade movement. All three constitutions currently lump every stock type
  // together into "Changes in inventories" — split it here, once, so the
  // live UI, PDF, and Excel (which all read section/note totals from this
  // shared processRows() output) agree automatically. See utils/inventorySplit.js.
  {
    const materialsSec = expenseSections.find(s => /^cost of materials consumed/i.test(s.level1 || ''))
    let changesSec = expenseSections.find(s => /changes in inventor/i.test(s.level1 || ''))
    const legacyOpenSec = expenseSections.find(s => /^opening stock/i.test(s.level1 || ''))
    const legacyCloseSec = incomeSections.find(s => /^closing stock/i.test(s.level1 || ''))
    // legacyOpenSec/legacyCloseSec are guaranteed present whenever ANY Stock
    // Entry exists (src/main/ipc/tb.js's saveStock always uses these two L1
    // titles regardless of category) — gate on them too, not just
    // materialsSec/changesSec, so a Trader-only entity (whose stock is all
    // "change"/"otherExpense" — never "raw" — and may have neither a
    // materialsSec from Purchases routing nor a pre-existing changesSec) still
    // gets its Changes-in-Inventories / Other-Expenses split computed instead
    // of the whole block being skipped.
    if (materialsSec || changesSec || legacyOpenSec || legacyCloseSec) {
      // Raw Materials stock is adjusted in "Cost of materials consumed". An entity with no such line (a Service Provider; a Manufacturer
      // with no purchase ledger mapped there) has nowhere to put it, so it is adjusted in "Changes in inventories" with the other stock -
      // it used to be left out of the P&L altogether, and profit and the Balance Sheet were both out by the year's movement.
      const split = computeInventorySplit({ expenseSections, incomeSections }, businessType, !!prevMap, prevMap?.rows, { rawToChange: !materialsSec })

      // Legacy "Opening Stock (PL)" / "Closing Stock (PL)" buckets (older
      // rule sets only): their full value is now folded into materialsSec/
      // changesSec above — zero them out here so nothing downstream (Total
      // Income/Expenses, generic PL renderers that iterate all sections
      // without knowing about this split) double-counts or leaks them as
      // stray face lines. Their notes are deleted outright (not just zeroed)
      // — the note-assignment loop above never creates zero-value notes in
      // the first place, and renumberNotesInPresentationOrder()'s fallback
      // pass has no zero-check, so a merely-zeroed note would still consume
      // a sequential number nothing ever displays, reintroducing exactly the
      // note-numbering gap bug fixed earlier this session.
      for (const sec of [legacyOpenSec, legacyCloseSec]) {
        if (!sec) continue
        sec.total = 0
        sec.prevTotal = 0
        sec.lines = []
        if (sec.noteNum && notes[sec.noteNum]) {
          delete notes[sec.noteNum]
        }
        sec.noteNum = null
      }

      // prevRawMaterialRows keeps the comparative alive when the CURRENT year
      // happens to carry no raw-material stock rows but the previous one did —
      // otherwise the PY adjustment would be computed and then thrown away.
      if (materialsSec && (split.rawMaterialOpeningRows.length || split.rawMaterialClosingRows.length
                           || split.prevRawMaterialRows.length)) {
        materialsSec.total += split.rawMaterialDelta.cy
        materialsSec.prevTotal += split.rawMaterialDelta.py
        const openLine = {
          level2: 'Opening Stock of Raw Materials',
          total: split.rawMaterialOpening.cy, prevTotal: split.rawMaterialOpening.py,
          rows: split.rawMaterialOpeningRows, minSortOrder: 9990,
        }
        const closeLine = {
          level2: 'Less: Closing Stock of Raw Materials',
          total: -split.rawMaterialClosing.cy, prevTotal: -split.rawMaterialClosing.py,
          rows: split.rawMaterialClosingRows, minSortOrder: 9991,
        }
        // notes[materialsSec.noteNum].lines sometimes ALIASES the same array
        // as materialsSec.lines (when no Purchases-of-Stock-in-Trade merge
        // ran above) and sometimes doesn't (when it did — that merge
        // reassigns the note's lines to a new spread array). Snapshot the
        // note's lines BEFORE mutating materialsSec.lines so openLine/
        // closeLine end up in the note exactly once either way.
        const noteLinesSnapshot = materialsSec.noteNum && notes[materialsSec.noteNum]
          ? [...notes[materialsSec.noteNum].lines] : null
        materialsSec.lines.push(openLine, closeLine)
        if (noteLinesSnapshot) {
          const n = notes[materialsSec.noteNum]
          n.total += split.rawMaterialDelta.cy
          n.prevTotal += split.rawMaterialDelta.py
          n.lines = [...noteLinesSnapshot, openLine, closeLine]
          n.rows = [...n.rows, ...split.rawMaterialOpeningRows, ...split.rawMaterialClosingRows]
        }
      }

      const hasChangeData = split.otherStockOpeningRows.length || split.otherStockClosingRows.length
        || split.otherStockNetRows.length || split.prevOtherStockRows.length
      if (changesSec || hasChangeData) {
        const CHANGES_TITLE = 'Changes in inventories of finished goods, WIP and Stock-in-Trade'
        const isNewChangesSec = !changesSec
        if (isNewChangesSec) {
          changesSec = { level1: CHANGES_TITLE, lines: [], total: 0, prevTotal: 0, noteNum: null }
          expenseSections.push(changesSec)
        }
        changesSec.total = split.otherStockDelta.cy
        changesSec.prevTotal = split.otherStockDelta.py
        // Two fixed rows (not per-category) — Opening / Less: Closing; their
        // sum is the note's Total — covering Work-in-Progress, Finished Goods and
        // Stock-in-Trade together, per the CA's exact wording. Plus any
        // genuine net "change in inventory" ledger entries as a trailing line.
        const WIP_LABEL = split.changeIncludesRaw
          ? 'Raw Materials, Work in Progress, Finished Goods and Stock-in-Trade'
          : 'Work in Progress, Finished Goods and Stock-in-Trade'
        changesSec.lines = [
          { level2: `Opening Value of ${WIP_LABEL}`,
            total: split.otherStockOpening.cy, prevTotal: split.otherStockOpening.py,
            rows: split.otherStockOpeningRows, minSortOrder: 0 },
          { level2: `Less: Closing Value of ${WIP_LABEL}`,
            total: -split.otherStockClosing.cy, prevTotal: -split.otherStockClosing.py,
            rows: split.otherStockClosingRows, minSortOrder: 1 },
          // (no "Change in Inventory of ..." row: it repeated the Total, and the Total is that figure)
          ...(split.otherStockNetRows.length ? [{
            level2: 'Net Change in Inventory', total: split.otherStockNet.cy, prevTotal: split.otherStockNet.py,
            rows: split.otherStockNetRows, minSortOrder: 9989,
          }] : []),
        ]
        if (changesSec.noteNum && notes[changesSec.noteNum]) {
          const n = notes[changesSec.noteNum]
          n.total = split.otherStockDelta.cy
          n.prevTotal = split.otherStockDelta.py
          n.lines = changesSec.lines
          n.rows = split.otherStockRows
        } else if (isNewChangesSec) {
          // Freshly-created section (no pre-existing note from the earlier
          // note-assignment loop) — create the note directly here, same
          // pattern as the "Other Expenses" catch-all below.
          const canonical = CHANGES_TITLE.trim().toLowerCase()
          const newNum = allocNoteNum()
          const note = {
            num: newNum, title: CHANGES_TITLE, level1: CHANGES_TITLE, alie: 'Expenses', isPL: true,
            lines: changesSec.lines, rows: split.otherStockRows,
            total: split.otherStockDelta.cy, prevTotal: split.otherStockDelta.py,
          }
          notes[newNum] = note
          noteByTitle.set(canonical, note)
          changesSec.noteNum = newNum
        }
      }

      // ── Loose Tools / Stores & Spares / Others → "Other Expenses" ─────────
      // Each of these categories is adjusted (Opening − Closing) in the Other-
      // expenses HEAD the Stock tab asked for - a line of the Other-expenses
      // note such as "Consumption of stores and spare parts". The adjustment is
      // added into that head's own line (a new line is made when the note has
      // none of that name), so the note reads as a CA would write it, with no
      // separate stock lines. A category with no head named (stock saved before
      // the Stock tab asked, a Fill Details figure) keeps three fixed rows -
      // Opening / Less: Closing / Change - covering Stores & Spares, Loose Tools
      // and Others together. Unlike materialsSec/changesSec, this section has no
      // guaranteed pre-existing home (no ordinary ledger is required to map
      // there), so it's created here if missing — pushed into expenseSections
      // and noteByTitle so renumberNotesInPresentationOrder()'s catch-all
      // "otherExpSecs" pass (see plStructureCorp.js) picks it up and gives it a
      // proper sequential note number.
      if (split.otherExpenseOpeningRows.length || split.otherExpenseClosingRows.length
          || split.prevOtherExpenseRows.length) {
        const OTHER_EXP_TITLE = 'Other Expenses'
        const STORES_LABEL = 'Stores & Spares, Loose Tools and Others'
        // Find whatever section ALREADY plays the role of the organic "Other
        // Expenses" catch-all (i.e. ordinary sundry-expense ledgers that
        // don't match any of the fixed named PL lines — see EXPENSE_LINES in
        // plStructureCorp.js / plStructureNonCorp.js) and append into THAT,
        // instead of always creating a brand-new section titled literally
        // "Other Expenses" — otherwise an entity that already has a real
        // Other Expenses note (e.g. Rent, Printing & Stationery, etc.) ends
        // up with the Stores & Spares/Loose Tools movement showing as a
        // second, separate note instead of extra rows in the existing one.
        const FIXED_PL_LINE_MATCHERS = [
          /^cost of materials consumed/i, /^purchases of stock-in-trade/i, /changes in inventor/i,
          /employee benefit/i, /finance cost|finance charge/i, /depreciation|amortis/i,
          /^exceptional item/i, /^extraordinary item/i, /^tax expense:?\s*$/i,
          /profit.*discontinuing operation/i, /tax expense of discontinuing/i, /partners.{0,3}remuneration/i,
        ]
        const isOtherExpCatchAll = (s) =>
          s !== legacyOpenSec && s !== legacyCloseSec && s !== changesSec &&
          !/uncategorised/i.test(s.level1 || '') &&
          !FIXED_PL_LINE_MATCHERS.some(rx => rx.test(s.level1 || ''))
        // The section actually titled "Other expenses" when there is one, else whichever other section plays the catch-all.
        let otherExpSec = expenseSections.find(s => isOtherExpCatchAll(s) && /^other expenses$/i.test((s.level1 || '').trim()))
          || expenseSections.find(isOtherExpCatchAll)
        const canonical = (otherExpSec?.level1 || OTHER_EXP_TITLE).trim().toLowerCase()
        if (!otherExpSec) {
          otherExpSec = { level1: OTHER_EXP_TITLE, lines: [], total: 0, prevTotal: 0, noteNum: null }
          expenseSections.push(otherExpSec)
        }
        // Its note. A P&L note is registered on its section (section.noteNum, set by the note-assignment loop above); only the notes this
        // pass and its neighbours create are in noteByTitle. Looking there alone missed the real note, built a second one holding just the
        // stock lines and pointed the P&L face at it: the face showed the full figure, the note it named only the stock lines, and the
        // ordinary note (Rent, ...) became a stray extra note nothing referred to (0.1.92 and before).
        const existingNote = (otherExpSec.noteNum && notes[otherExpSec.noteNum]) || noteByTitle.get(canonical) || null

        // The lines. A named head is added into the line of that name (matched without regard to capitals or spacing); when the note has
        // none, a new line is made and put where the Level Format puts that caption (a head of the CA's own goes after the standard ones).
        const lfOtherExp = (lfRows || []).filter(l => /^other expenses$/i.test((l.level1 || '').trim()) && (l.level2 || '').trim())
        const standardOrder = (head) => {
          const hit = lfOtherExp.find(l => headKey(l.level2) === headKey(head))
          return hit && hit.sort_order != null && Number.isFinite(Number(hit.sort_order)) ? Number(hit.sort_order) : null
        }
        // A standard caption goes where the Level Format puts it; a head of the CA's own goes after the standard ones (before any "Uncategorised" line).
        const place = (lines, line, order) => {
          const at = order != null
            ? lines.findIndex(l => (l.minSortOrder ?? 9999) > order)
            : lines.findIndex(l => /uncategorised/i.test(l.level2 || ''))
          return at < 0 ? [...lines, line] : [...lines.slice(0, at), line, ...lines.slice(at)]
        }
        const isHeadLine = (l, key) => !l.isSubtotal && headKey(l.level2) === key
        const bump = (line, cy, py, rows) => { line.total += cy; line.prevTotal += py; line.rows = [...(line.rows || []), ...rows] }
        let secLines = [...otherExpSec.lines]
        let noteLines = existingNote ? [...(existingNote.lines || [])] : null
        let carriedPY = 0   // last year's ordinary figure for a head that is new to this year's note (see below)
        for (const g of split.otherExpenseHeads) {
          let secLine = secLines.find(l => isHeadLine(l, g.key))
          if (!secLine) {
            // A head the note has no line for yet. If last year's Trial Balance has ordinary ledgers under that caption, that figure is
            // carried on the new line: the Previous Year reconciliation below counts a caption that already has a line as matched, and
            // would otherwise never add it.
            const pyBase = prevMap ? (prevMap.get(`Expenses|${(otherExpSec.level1 || '').trim().toLowerCase()}|${g.head.trim().toLowerCase()}`) || 0) : 0
            const order = standardOrder(g.head)
            secLine = { level2: g.head, total: 0, prevTotal: pyBase, rows: [], minSortOrder: order != null ? order : 9970 }
            carriedPY += pyBase
            secLines = place(secLines, secLine, order)
          }
          bump(secLine, g.deltaCY, g.deltaPY, g.entryRows)
          if (noteLines) {
            const noteLine = noteLines.find(l => isHeadLine(l, g.key))
            if (!noteLine) noteLines = place(noteLines, secLine, standardOrder(g.head))          // the note shares the section's line
            else if (noteLine !== secLine) bump(noteLine, g.deltaCY, g.deltaPY, g.entryRows)    // a separate copy of it: keep it in step
          }
        }
        // Stock with no head named: the three fixed rows.
        const un = split.otherExpenseUnnamed
        if (un) {
          const storesLines = [
            { level2: `Opening Value of ${STORES_LABEL}`,
              total: un.openingCY, prevTotal: un.openingPY,
              rows: un.openRows, minSortOrder: 9980 },
            { level2: `Less: Closing Value of ${STORES_LABEL}`,
              total: -un.closingCY, prevTotal: -un.closingPY,
              rows: un.closeRows, minSortOrder: 9981 },
            { level2: `Change in ${STORES_LABEL}`,
              total: un.openingCY - un.closingCY,
              prevTotal: un.openingPY - un.closingPY,
              rows: [...un.openRows, ...un.closeRows], minSortOrder: 9982, isSubtotal: true },
          ]
          secLines = [...secLines, ...storesLines]
          if (noteLines) noteLines = [...noteLines, ...storesLines]
        }
        otherExpSec.lines = secLines
        otherExpSec.total += split.otherExpenseDelta.cy
        otherExpSec.prevTotal += split.otherExpenseDelta.py + carriedPY
        const entryRows = [
          ...split.otherExpenseHeads.flatMap(g => g.entryRows),
          ...(un ? [...un.openRows, ...un.closeRows] : []),
        ]

        if (existingNote) {
          existingNote.lines = noteLines
          existingNote.rows = [...existingNote.rows, ...entryRows]
          existingNote.total += split.otherExpenseDelta.cy
          existingNote.prevTotal += split.otherExpenseDelta.py + carriedPY
          otherExpSec.noteNum = existingNote.num
        } else {
          const newNum = allocNoteNum()
          const title = otherExpSec.level1 || OTHER_EXP_TITLE
          const note = {
            num: newNum, title, level1: title, alie: 'Expenses', isPL: true,
            lines: secLines, rows: [...new Set([...secLines.flatMap(l => l.rows || []), ...entryRows])],
            total: otherExpSec.total, prevTotal: otherExpSec.prevTotal,
          }
          notes[newNum] = note
          noteByTitle.set(canonical, note)
          otherExpSec.noteNum = newNum
        }
      }
    }
  }

  // ── "Cost of stores and spares consumed" → fold into Other Expenses ───────
  // Per the CA's rule, Stores & Spares (and, per the block above, Loose
  // Tools) never get their own dedicated P&L face line — they sit inside
  // Other Expenses with the same Opening/Closing stock adjustment treatment
  // as everything else there. A ledger classified with this exact Level 1
  // (a standard Schedule III catalog entry some rule sets carry) would
  // otherwise render as its own separate face line via EXPENSE_LINES in
  // plStructureCorp.js/plStructureNonCorp.js — merged away here instead, at
  // the data level, so every consumer (live PL, Excel export, filed
  // document) sees the same corrected structure without each needing its
  // own special case.
  {
    const storesConsumedIdx = expenseSections.findIndex(s => /cost of stores.*spares.*consumed/i.test(s.level1 || ''))
    if (storesConsumedIdx !== -1) {
      const storesConsumedSec = expenseSections[storesConsumedIdx]
      expenseSections.splice(storesConsumedIdx, 1)
      const movedRows = storesConsumedSec.lines.flatMap(l => l.rows || [])

      let otherExpSec = expenseSections.find(s => /^other expenses$/i.test((s.level1 || '').trim()))
      if (!otherExpSec) {
        otherExpSec = { level1: 'Other Expenses', lines: [], total: 0, prevTotal: 0, noteNum: null }
        expenseSections.push(otherExpSec)
      }
      otherExpSec.lines = [...otherExpSec.lines, ...storesConsumedSec.lines]
      otherExpSec.total += storesConsumedSec.total
      otherExpSec.prevTotal += storesConsumedSec.prevTotal

      const canonical = (otherExpSec.level1 || 'Other Expenses').trim().toLowerCase()
      // The section's own note first: an ordinary P&L note is registered on its section, not in noteByTitle (see the stock block above).
      const existingOtherExpNote = (otherExpSec.noteNum && notes[otherExpSec.noteNum]) || noteByTitle.get(canonical)
      if (existingOtherExpNote) {
        existingOtherExpNote.lines = [...existingOtherExpNote.lines, ...storesConsumedSec.lines]
        existingOtherExpNote.rows = [...existingOtherExpNote.rows, ...movedRows]
        existingOtherExpNote.total += storesConsumedSec.total
        existingOtherExpNote.prevTotal += storesConsumedSec.prevTotal
        otherExpSec.noteNum = existingOtherExpNote.num
      } else {
        const newNum = allocNoteNum()
        const note = {
          num: newNum, title: 'Other Expenses', level1: 'Other Expenses', alie: 'Expenses', isPL: true,
          lines: otherExpSec.lines, rows: movedRows,
          total: otherExpSec.total, prevTotal: otherExpSec.prevTotal,
        }
        notes[newNum] = note
        noteByTitle.set(canonical, note)
        otherExpSec.noteNum = newNum
      }
      // The stores-consumed section's own note (if the earlier note-
      // assignment loop gave it one) no longer has anything to show.
      if (storesConsumedSec.noteNum && notes[storesConsumedSec.noteNum] && storesConsumedSec.noteNum !== otherExpSec.noteNum) {
        delete notes[storesConsumedSec.noteNum]
      }
    }
  }

  // ── Reconcile Previous-Year totals so no prevMap entry is silently dropped ──
  // buildSections() looks up prevMap by the CURRENT year's own (alie, level1,
  // level2) keys. A Previous-Year TB that was itself mapped under a
  // different rule set / re-categorisation for a given ledger (e.g.
  // "Interest Income" or "Tax expense" landing under a different Level 1/2
  // caption than in the CY TB) produces a prevMap key that never matches
  // anything built from the CY rows — so that PY amount would silently
  // vanish from every downstream total (prevIncome_/prevExpenses_/
  // prevNetProfit_ and the BS-side comparatives) instead of being included,
  // even though buildPrevMap() already summed it correctly. This is why the
  // very same TB's net profit could differ depending on whether it's viewed
  // as the base year (nothing to look up — every row trivially "matches"
  // itself) or as a Previous Year comparative (lookup can miss).
  //
  // Routed PER (level1, level2) group — using buildPrevMap()'s original-cased
  // labels — rather than as one lump "Previous Year — unmatched ledgers" sum
  // folded into whichever note happened to be first: a PY-only "Tax expense
  // → Current tax" figure (e.g. this year's Trial Balance has no ledger
  // categorised there yet, but last year's did) now lands back under its own
  // Tax expense/Current tax line instead of silently inflating an unrelated
  // note like Revenue from operations. Still guarantees the TB's PY total
  // always equals what it showed as its own base-year total.
  // Opening/Closing Stock and Cost of materials consumed/Changes in
  // inventories are exclusively handled by the dedicated computeInventorySplit
  // pass above, which already folds PY-side stock movement into
  // materialsSec.prevTotal / changesSec.prevTotal using its own hasPrevMap-
  // aware logic (it reads the CY rows' own opening_balance/prevTotal, not a
  // prevMap key match). A PY-only leftover for one of these labels is not a
  // genuine gap — it's the same figure computeInventorySplit already placed
  // elsewhere, just also sitting in prevMap under its raw, un-split legacy
  // key. Reviving/creating a standalone section for it here would double-count
  // it, and — since non-corporate PL layout (plStructureNonCorp.js) has no
  // dedicated "Closing Stock" face line — silently dump it into the generic
  // "Other income" bucket instead. Skip these labels entirely.
  const STOCK_SECTION_RX = [
    /^cost of materials consumed/i,
    /changes in inventor/i,
    /^opening stock/i,
    /^closing stock/i,
    /cost of stores.*spares.*consumed/i,
  ]
  function reconcilePrevTotals(sections, alie, catchAllTitle) {
    if (!prevMap) return
    const matchedKeys = new Set()
    for (const sec of sections) {
      const l1key = (sec.level1 || '').trim().toLowerCase()
      for (const line of sec.lines) {
        matchedKeys.add(`${alie}|${l1key}|${(line.level2 || '').trim().toLowerCase()}`)
      }
    }
    for (const [key, val] of prevMap.entries()) {
      if (!key.startsWith(`${alie}|`)) continue
      if (matchedKeys.has(key)) continue
      if (Math.abs(val) < 0.005) continue

      const label = prevMap.labels?.get(key)
      const l1Display = label?.level1 || catchAllTitle
      if (STOCK_SECTION_RX.some(rx => rx.test(l1Display))) continue
      const l2Display = label?.level2 || 'Previous Year — unmatched ledgers'
      const l1keyLower = l1Display.trim().toLowerCase()
      const reconLine = { level2: l2Display, total: 0, prevTotal: val, rows: [], minSortOrder: 9999 }

      const target = sections.find(s => (s.level1 || '').trim().toLowerCase() === l1keyLower)
      if (target) {
        const note = target.noteNum ? notes[target.noteNum] : null
        // note.lines often ALIASES the same array as target.lines (assigned
        // directly, not spread, when the note was first created) — pushing
        // onto target.lines already mutates note.lines too in that case, so
        // spreading it again afterwards would add reconLine a second time.
        const aliased = note && note.lines === target.lines
        target.lines.push(reconLine)
        target.prevTotal += val
        if (note) {
          if (!aliased) note.lines = [...note.lines, reconLine]
          note.prevTotal += val
        }
        continue
      }
      // No existing section for this Level 1 at all this year — create one,
      // named after the PY category itself (not a generic catch-all), so the
      // figure still shows under something meaningful even with zero CY-side
      // ledgers mapped to it.
      const newSection = { level1: l1Display, lines: [reconLine], total: 0, prevTotal: val, noteNum: null }
      sections.push(newSection)
      const newNum = allocNoteNum()
      const isPL = alie === 'Income' || alie === 'Expenses'
      notes[newNum] = {
        num: newNum, title: l1Display, level1: l1Display, alie,
        isPL, lines: [reconLine], rows: [], total: 0, prevTotal: val,
      }
      newSection.noteNum = newNum
    }
  }

  reconcilePrevTotals(incomeSections, 'Income', 'Other Income')
  reconcilePrevTotals(expenseSections, 'Expenses', 'Other Expenses')
  reconcilePrevTotals(elSections, 'EQUITY AND LIABILITIES', 'Uncategorised Liabilities')
  reconcilePrevTotals(assetSections, 'ASSETS', 'Uncategorised Assets')

  // ── Calculate Net Profit and inject into Reserves & Surplus note ──────────
  // CY and PY are gated INDEPENDENTLY (skipProfitInjectionCY / ...PY —
  // trial_balances.pl_closed_to_capital, read from the CY TB and the
  // separate comparative PY TB respectively, since a client may have closed
  // P&L to Capital in Tally for one year's books but not the other's). Only
  // skipped entirely when BOTH are set; otherwise the note/row still needs
  // to exist so whichever side DOES need injection has somewhere to land —
  // the skipped side's own contribution is simply zeroed below rather than
  // omitted, since the client's own Capital ledger already carries it.
  if (!skipProfitInjectionCY || !skipProfitInjectionPY) {
  const totalIncome_   = incomeSections.reduce( (s, s2) => s + s2.total, 0)
  const totalExpenses_ = expenseSections.reduce((s, s2) => s + s2.total, 0)
  const netProfit_     = skipProfitInjectionCY ? 0 : (totalIncome_ - totalExpenses_)
  const prevIncome_    = incomeSections.reduce( (s, s2) => s + s2.prevTotal, 0)
  const prevExpenses_  = expenseSections.reduce((s, s2) => s + s2.prevTotal, 0)
  const prevNetProfit_ = skipProfitInjectionPY ? 0 : (prevIncome_ - prevExpenses_)

  // Pick the BS note that should absorb Net Profit/(Loss) for the year.
  //
  //   • Corporate (constitution=3): "Reserves and Surplus" L2 under
  //     Shareholders' funds.
  //   • Partnership (2) / Proprietorship (1): there is no Reserves & Surplus
  //     L2 — the equity block is "Partners' Funds" / "Owner's Fund" with L2
  //     items like Capital Account / Current Account / Drawings. We pick
  //     either an existing "Profit and Loss" / "Current Account" / "P&L"
  //     L2, or, failing that, fall back to the first L2 of the first
  //     non-liability section. The injected line is labelled
  //     "Profit and Loss for the Year" so it's unmistakable on the face.
  const isNonCorpEntity = parseInt(constitution) !== 3
  const NONCORP_TARGET_RX = /(profit\s*(&|and)\s*loss|^p[\s./&]*l|current\s*account|drawings)/i
  const isLiabSection = (lvl1) => {
    const l = (lvl1 || '').toLowerCase()
    return l.includes('liabilities') || l.includes('liability')
  }
  let profitNote = null
  if (isNonCorpEntity) {
    // Try by note title first
    for (const note of Object.values(notes)) {
      if (note.isPL) continue
      if (NONCORP_TARGET_RX.test(note.title || '')) { profitNote = note; break }
    }
    // Fallback: first L2 in first non-liability E&L section
    if (!profitNote) {
      const equitySection = elSections.find(s => !isLiabSection(s.level1) &&
        !/uncategorised/i.test(s.level1 || ''))
      const firstLine = equitySection?.lines?.[0]
      if (firstLine?.noteNum) profitNote = notes[firstLine.noteNum]
    }
  } else {
    for (const note of Object.values(notes)) {
      if (!note.isPL && /reserves? (and|&) surplus/i.test(note.title)) {
        profitNote = note; break
      }
    }
    if (!profitNote) {
      let shareholders = elSections.find(s => /shareholders'? funds/i.test(s.level1 || ''))
      if (!shareholders) {
        shareholders = { level1: "Shareholders' funds", total: 0, prevTotal: 0, lines: [] }
        elSections.unshift(shareholders)
      }
      const rsNum = allocNoteNum()
      const line = {
        level2: 'Reserves and surplus',
        total: 0,
        prevTotal: 0,
        rows: [],
        minSortOrder: 1,
        noteNum: rsNum,
      }
      shareholders.lines.push(line)
      const note = {
        num: rsNum,
        title: 'Reserves and surplus',
        level1: shareholders.level1,
        alie: 'EQUITY AND LIABILITIES',
        isPL: false,
        rows: [],
        total: 0,
        prevTotal: 0,
      }
      notes[rsNum] = note
      noteByTitle.set('reserves and surplus', note)
      profitNote = note
    }
  }

  if (profitNote) {
    const rowLabel = isNonCorpEntity ? 'Profit and Loss for the Year' : 'Add: Surplus / (Deficit) during the year'
    const profitRow = {
      ledger_name: rowLabel,
      name: rowLabel,
      ledger_code: '',
      closing_balance: netProfit_,
      opening_balance: prevNetProfit_,
      is_deemed_positive: false,
      mapping3_resultant: rowLabel,
      level3: rowLabel,
      level5_value: null, level6_value: null, level7_value: null,
      // Added here, not a ledger: its Previous Year is its own (see previousYearEntries).
      injected: 'profit',
    }
    profitNote.rows = [...profitNote.rows, profitRow]
    profitNote.total += netProfit_
    profitNote.prevTotal += prevNetProfit_

    // For corporate entities: if an Opening Profit & Loss row exists, add a
    // synthetic Closing Profit & Loss subtotal row = Opening + Current Year PL.
    if (!isNonCorpEntity) {
      const openingRow = profitNote.rows.find(r =>
        /^(opening profit\s*&?\s*loss|opening balance)$/i.test((r.mapping3_resultant || r.level3 || '').trim())
      )
      if (openingRow) {
        // Balances arrive from PostgreSQL as text ("89671455.47"): added to the year's
        // profit as-is they were GLUED ("89671455.474122319.8"), which then read back
        // as just the opening figure — Closing P&L showed Opening, Total was right.
        // Every Opening P&L ledger counts, not only the first, and all as numbers.
        const openingRows = profitNote.rows.filter(r =>
          /^(opening profit\s*&?\s*loss|opening balance)$/i.test((r.mapping3_resultant || r.level3 || '').trim()))
        const sumOf = (field) => openingRows.reduce((s, r) => s + (parseFloat(r[field]) || 0), 0)
        const closingCY = sumOf('closing_balance') + netProfit_
        const closingPY = sumOf('opening_balance') + prevNetProfit_
        const closingRow = {
          ledger_name: 'Closing Profit & Loss',
          name: 'Closing Profit & Loss',
          ledger_code: '',
          closing_balance: closingCY,
          opening_balance: closingPY,
          is_deemed_positive: false,
          mapping3_resultant: 'Closing Profit & Loss',
          level3: 'Closing Profit & Loss',
          isSubtotal: true,
          level5_value: null, level6_value: null, level7_value: null,
          injected: 'closing', openingL3: (openingRow.mapping3_resultant || openingRow.level3 || '').trim(),
        }
        // Add to rows for display only — do NOT add to note.total (already = Opening + Profit)
        profitNote.rows = [...profitNote.rows, closingRow]
      }
    }

    // Also update the parent section's line and totals
    for (const sec of elSections) {
      for (const line of sec.lines) {
        if (line.noteNum === profitNote.num) {
          line.total += netProfit_
          line.prevTotal += prevNetProfit_
        }
      }
      sec.total = sec.lines.reduce((s, l) => s + l.total, 0)
      sec.prevTotal = sec.lines.reduce((s, l) => s + l.prevTotal, 0)
    }
  }
  } // end if (!skipProfitInjectionCY || !skipProfitInjectionPY)

  // ── Fix #4: LTB Current Maturities → deduct from LTB, inject into Short-term borrowings ──
  // Read saved note_details for the LTB note; deduct currentMaturity from the
  // LTB line in E&L sections and add a synthetic "Current maturities of long-term
  // borrowings" sub head under "Short-term borrowings" (it was Other current liabilities until 0.1.102).
  if (noteDetailsList && noteDetailsList.length > 0) {
    const ltbNd = noteDetailsList.find(nd =>
      /long.term borrow/i.test(nd.note_title || '')
    )
    if (ltbNd?.data?.loans) {
      const loans = ltbNd.data.loans
      const numF  = v => parseFloat(v) || 0
      const cmCY  = loans.reduce((s, l) => s + numF(l.currentMaturityCY), 0)
      const cmPY  = loans.reduce((s, l) => s + numF(l.currentMaturityPY), 0)
      const formGrossCY = loans.reduce((s, l) => s + numF(l.grossCY), 0)
      const formGrossPY = loans.reduce((s, l) => s + numF(l.grossPY), 0)

      // 1. Deduct Current Maturities from the LTB line — but net it off the
      // TRUE Mapped-TB total (tbRawCY/PY), not the Fill-Details form's own
      // "gross" total. The form only exists to capture the per-loan
      // current-maturity split; it is not the source of truth for how much
      // is actually mapped to Long-Term Borrowings. If a ledger gets mapped
      // (or re-mapped) to LTB after the form was last filled in, the form's
      // loans list won't include it — replacing the line's total with the
      // form's total would then silently drop that ledger's money from the
      // whole statement (BS mismatch) instead of just leaving its current
      // maturity un-split (correctly staying under LTB in full).
      for (const sec of elSections) {
        for (const line of sec.lines) {
          if (/long.term borrow/i.test(line.level2 || '')) {
            const tbRawCY = line.total
            const tbRawPY = line.prevTotal
            const netCY = tbRawCY - cmCY
            const netPY = tbRawPY - cmPY
            line.total     = netCY
            line.prevTotal = netPY
            const n = notes[line.noteNum]
            if (n) {
              n.ltbValidation = {
                tbRawCY, tbRawPY, formGrossCY, formGrossPY, cmCY, cmPY,
                mismatchGross: Math.abs(formGrossCY - tbRawCY) > 0.5,
              }
              n.total     = netCY
              n.prevTotal = netPY
            }
          }
        }
        sec.total     = sec.lines.reduce((s, l) => s + l.total,     0)
        sec.prevTotal = sec.lines.reduce((s, l) => s + l.prevTotal, 0)
      }

      // 2. Inject current maturities into SHORT-TERM BORROWINGS (Schedule III: the current maturities of long-term borrowings are
      //    part of short-term borrowings, not of other current liabilities), as their own sub head. Only when cmCY > 0.
      if (cmCY > 0 || cmPY > 0) {
        const CM_LABEL  = 'Current maturities of long-term borrowings'
        const STB_LABEL = 'Short-term borrowings'
        // closing_balance/opening_balance stored POSITIVE, as every Cr-natured E&L ledger (displayAmt() does not sign-flip the E&L side)
        const cmRow = {
          name: CM_LABEL, ledger_name: CM_LABEL, ledger_code: '',
          closing_balance: cmCY, opening_balance: cmPY,
          is_deemed_positive: false, alie: 'EQUITY AND LIABILITIES',
          mapping3_resultant: CM_LABEL, level3: CM_LABEL,
          level5_value: null, level6_value: null, level7_value: null,
          injected: 'current-maturities',
        }
        let stbLine = null, stbSec = null
        for (const sec of elSections) {
          const l = sec.lines.find(x => /short.term borrow/i.test(x.level2 || ''))
          if (l) { stbLine = l; stbSec = sec; break }
        }
        const retotal = (sec) => {
          sec.total     = sec.lines.reduce((t, l) => t + l.total,     0)
          sec.prevTotal = sec.lines.reduce((t, l) => t + l.prevTotal, 0)
        }
        if (stbLine) {
          stbLine.total     += cmCY
          stbLine.prevTotal += cmPY
          stbLine.rows = [...(stbLine.rows || []), cmRow]
          const n = notes[stbLine.noteNum]
          if (n) { n.total += cmCY; n.prevTotal += cmPY; n.rows = [...n.rows, cmRow] }
          retotal(stbSec)
        } else {
          // no Short-term borrowings in the Trial Balance: a new line in Current liabilities (its note is created below)
          const newLine = { level2: STB_LABEL, total: cmCY, prevTotal: cmPY, rows: [cmRow], minSortOrder: 9998 }
          const clSec = elSections.find(s2 => /^current liabilit/i.test(s2.level1))
          if (clSec) { clSec.lines.push(newLine); retotal(clSec) }
          else elSections.push({ level1: 'Current liabilities', total: cmCY, prevTotal: cmPY, lines: [newLine] })
        }
      }
    }
  }

  const totalEL       = elSections.reduce(     (s, s2) => s + s2.total, 0)
  const totalAssets   = assetSections.reduce(  (s, s2) => s + s2.total, 0)
  const totalIncome   = incomeSections.reduce( (s, s2) => s + s2.total, 0)
  const totalExpenses = expenseSections.reduce((s, s2) => s + s2.total, 0)
  const netProfit     = totalIncome - totalExpenses
  const prevTotalIncome   = incomeSections.reduce( (s, s2) => s + s2.prevTotal, 0)
  const prevTotalExpenses = expenseSections.reduce((s, s2) => s + s2.prevTotal, 0)
  const prevNetProfit     = prevTotalIncome - prevTotalExpenses

  // ── Late-bind notes for lines that gained data after Fix #4 ────────────────
  // e.g. "Other Current Liabilities" that was ₹0 in TB but had Current Maturities
  // injected by Fix #4. Note assignment ran earlier (before Fix #4) so those lines
  // have no noteNum yet. We scan all sections and assign notes now.
  for (const sec of [...elSections, ...assetSections]) {
    for (const line of sec.lines) {
      if (!line.level2 || line.noteNum) continue          // skip if already has note
      if (Math.abs(line.total) < 0.005 && Math.abs(line.prevTotal) < 0.005) continue
      if (/uncategorised/i.test(line.level2)) continue
      const canonical = (line.level2 || '').trim().toLowerCase()
      const existing  = noteByTitle.get(canonical)
      if (existing) {
        line.noteNum       = existing.num
        existing.total    += line.total
        existing.prevTotal += line.prevTotal
      } else {
        const num = allocNoteNum()
        line.noteNum = num
        const note = {
          num, title: line.level2,
          level1: sec.level1,
          alie: (line.rows && line.rows[0]) ? line.rows[0].alie : sec.level1,
          isPL: false, rows: line.rows || [],
          total: line.total, prevTotal: line.prevTotal,
        }
        notes[num] = note
        noteByTitle.set(canonical, note)
      }
    }
  }

  // ── Build activeNotes — sorted by note number ────────────────────────────
  // Notes are already allocated only to items with figures and non-uncategorised
  // titles (see note assignment above). We still tag isEmpty/isUncategorised for
  // safety (e.g. a note whose total became zero after Fix #4 adjustments) and
  // sort by num so the list is always sequential 1, 2, 3 …
  // Re-number notes after all BS adjustments/injections have run. This keeps
  // note numbers tied to Schedule III presentation order instead of creation
  // time; e.g. a late-created Reserves and surplus note still appears beside
  // Share Capital, not after all PL notes.
  const renumberNotesInPresentationOrder = () => {
    const oldNotes = Object.values(notes)
    const kindKey = (isPL, title) => `${isPL ? 'pl' : 'bs'}|${(title || '').trim().toLowerCase()}`
    const byTitle = new Map()
    const byOldNum = new Map()
    for (const note of oldNotes) {
      if (note?.title) byTitle.set(kindKey(note.isPL, note.title), note)
      if (note?.num != null) byOldNum.set(note.num, note)
    }
    // A face line's note is found by its own title first. Its old number is
    // only a fallback (the non-corporate Purchases line deliberately shares
    // the Cost of materials consumed note), and only when that number still
    // holds a note of the same kind — a P&L line must never pick up a Balance
    // Sheet note's number, or vice versa. If neither works the line gets a
    // note of its own rather than keeping a stale number that now belongs to
    // something else.
    const resolveNote = (isPL, title, oldNum) => {
      const byName = byTitle.get(kindKey(isPL, title))
      if (byName) return byName
      const byNum = byOldNum.get(oldNum)
      return byNum && !!byNum.isPL === isPL ? byNum : null
    }

    const ordered = []
    const picked = new Set()
    // General Notes (the single narrative note — Significant Accounting
    // Policies, etc.) — when mode is 'first', it occupies Note 1 and every
    // auto-numbered note here counts after it. When 'last' (or none), every
    // auto-numbered note here keeps its normal 1..N numbering, and General
    // Notes' own number is resolved afterwards, below. See GeneralNotes/index.jsx.
    let nextNum = generalNotesMode === 'first' ? 2 : 1

    const pickNote = (note) => {
      if (!note || picked.has(note)) return note
      picked.add(note)
      note.num = nextNum++
      ordered.push(note)
      return note
    }

    // Company (constitution=3): number BS notes in Schedule III presentation
    // order (the same fixed order the BS screen / Excel / PDF render), so a
    // note's number always matches where its line physically sits on the face
    // of the Balance Sheet — e.g. Trade Payables (shown above Other current
    // liabilities) never ends up with a higher number than a line below it.
    // Other constitutions keep the raw elSections order, which already equals
    // their dynamic BS render order.
    const bsLinesInOrder = parseInt(constitution) === 3
      ? companyBSLineOrder({ elSections, assetSections })
      : [...elSections, ...assetSections].flatMap(s => s.lines)
    for (const line of bsLinesInOrder) {
      if (!line.level2) continue
      if (!line.forceInclude && Math.abs(line.total) < 0.005 && Math.abs(line.prevTotal) < 0.005) continue
      if (/uncategorised/i.test(line.level2)) continue
      let note = resolveNote(false, line.level2, line.noteNum)
      if (!note) {
        const sec = [...elSections, ...assetSections].find(s => s.lines.includes(line))
        note = {
          title: line.level2, level1: sec?.level1 || '', alie: line.rows?.[0]?.alie || '', isPL: false,
          rows: line.rows || [], total: line.total, prevTotal: line.prevTotal,
        }
        byTitle.set(kindKey(false, line.level2), note)
        console.warn(`[notes] "${line.level2}" had no note of its own (was pointing at ${line.noteNum}); created one`)
      }
      pickNote(note)
      line.noteNum = note.num
    }

    // Non-corporate (constitution=1): number PL notes in the fixed ICAI
    // presentation order (plStructureNonCorp.js), same reasoning as the BS
    // fix above — raw expenseSections/incomeSections order doesn't list
    // Exceptional/Extraordinary/Remuneration/discontinuing-operations at all,
    // so their relative order there is arbitrary.
    // Company (3) and LLP (2): same reasoning — corpPLSectionOrder() mirrors
    // the fixed EXPENSE_LINES bucket order the PL screen/Excel actually
    // render (see plStructureCorp.js), instead of the raw sectionSortKey()
    // order above, which sorts Exceptional/Extraordinary items *after* Tax
    // Expense even though they always appear before it on the face.
    const plSectionsInOrder = parseInt(constitution) === 1
      ? nonCorpPLSectionOrder({ incomeSections, expenseSections }, null)
      : corpPLSectionOrder({ incomeSections, expenseSections })
    for (const section of plSectionsInOrder) {
      if (!section.forceInclude && Math.abs(section.total) < 0.005 && Math.abs(section.prevTotal) < 0.005) continue
      if (/uncategorised/i.test(section.level1 || '')) continue
      let note = resolveNote(true, section.level1, section.noteNum)
      if (!note) {
        const rows = [...new Set(section.lines.flatMap(l => l.rows || []))]
        note = {
          title: section.level1, level1: section.level1, alie: rows[0]?.alie || '', isPL: true,
          lines: section.lines, rows, total: section.total, prevTotal: section.prevTotal,
        }
        byTitle.set(kindKey(true, section.level1), note)
        console.warn(`[notes] "${section.level1}" had no note of its own (was pointing at ${section.noteNum}); created one`)
      }
      pickNote(note)
      section.noteNum = note.num
    }

    for (const note of oldNotes) pickNote(note)
    for (const key of Object.keys(notes)) delete notes[key]
    for (const note of ordered) notes[note.num] = note
  }

  renumberNotesInPresentationOrder()

  const activeNotes = []
  for (const note of Object.values(notes)) {
    const cy = parseFloat(note.total || 0)
    const py = parseFloat(note.prevTotal || 0)
    note.isEmpty         = Math.abs(cy) < 0.005 && Math.abs(py) < 0.005
    note.isUncategorised = /uncategorised/i.test(note.title || '')
    // Schedule III captions the Company's Balance Sheet line "Cash and cash equivalents". The note keeps its
    // stored title (saved Fill Details and Manual PY are matched to a note by it) and only PRINTS under the
    // face caption — note.displayTitle, used wherever a note's heading is shown.
    if (parseInt(constitution) === 3 && /^cash and bank balances$/i.test((note.title || '').trim())) note.displayTitle = 'Cash and cash equivalents'
    if (!note.isEmpty && !note.isUncategorised) activeNotes.push(note)
  }
  activeNotes.sort((a, b) => a.num - b.num)

  // Resolve General Notes' own Note Number: fixed at 1 when it's first
  // (every other note above was already numbered starting from 2 to make
  // room for it); otherwise one past whatever the highest auto-numbered
  // note turned out to be, so it always lands after everything else.
  const generalNoteNum = generalNotesMode === 'first'
    ? 1
    : generalNotesMode === 'last'
      ? Math.max(0, ...Object.keys(notes).map(Number)) + 1
      : null

  return {
    gstNet: gstNet.summary,
    elSections, assetSections, incomeSections, expenseSections,
    totalEL, totalAssets, totalIncome, totalExpenses, netProfit, prevNetProfit,
    notes,
    activeNotes,
    generalNoteNum,
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Parse "a / b / c" into array of trimmed options (or null).
 */
export function parseSlashOptions(val) {
  if (!val) return null
  if (!val.includes('/')) return null
  return val.split('/').map(s => s.trim()).filter(Boolean)
}

/**
 * Build template-style rows for a single note using LevelFormat structure.
 * Each item is { type: 'l3'|'l4'|'option', label, cy, py, indent, meta? }.
 *
 * If a LF row has "/" options in L5 (or L6/L7), we expand those into per-option
 * sub-rows whose amount is the sum of ledgers that have level5_value (etc.) == option.
 */
// Depreciation rate helpers (from Depreciation component)
const RESID_PCT = 0.05
function slmRate(life) { return ((1 - RESID_PCT) / life) * 100 }
function wdvRate(life) { return (1 - Math.pow(RESID_PCT, 1 / life)) * 100 }

// Compute depreciation for a single row (mirroring Depreciation component logic)
function computeDepreciationRow(r, yearEnd) {
  const num = v => parseFloat(v) || 0

  if (r.rowType === 'addition') {
    const additions = num(r.additions)
    if (additions <= 0) return 0

    const life = num(r.usefulLife) || 15
    const rate = r.customRate !== '' && !isNaN(parseFloat(r.customRate))
      ? parseFloat(r.customRate)
      : (r.method === 'SLM' ? slmRate(life) : wdvRate(life))

    // Pro-rata calculation for additions
    if (!r.date || !yearEnd) return additions * (rate / 100)
    const d = new Date(r.date)
    if (isNaN(d)) return additions * (rate / 100)
    const months = (yearEnd.getFullYear() - d.getFullYear()) * 12 + (yearEnd.getMonth() - d.getMonth())
    const factor = Math.max(0, Math.min(12, months)) / 12
    return additions * (rate / 100) * factor
  } else {
    // Opening row
    const grossOpen = num(r.grossOpen)
    const accumOpen = num(r.accumDepOpen)
    const wdvOpen = Math.max(0, grossOpen - accumOpen)
    if (wdvOpen <= 0) return 0

    const life = num(r.usefulLife) || 15
    const rate = r.customRate !== '' && !isNaN(parseFloat(r.customRate))
      ? parseFloat(r.customRate)
      : (r.method === 'SLM' ? slmRate(life) : wdvRate(life))

    // Apply correct formula based on method
    if (r.method === 'SLM') {
      return wdvOpen > 0 ? Math.min(grossOpen * (rate / 100), wdvOpen) : 0
    } else {
      // WDV method
      return wdvOpen > 0 ? wdvOpen * (rate / 100) : 0
    }
  }
}

// Build PPE note directly from Depreciation sheet data
function buildPPENoteFromDepreciation(depData, note) {
  const rows = []
  if (!depData?.rows || depData.rows.length === 0) return rows

  // Parse year-end date
  let yearEnd = null
  if (typeof depData === 'object' && depData.yearEndDate) {
    yearEnd = new Date(depData.yearEndDate)
  }
  if (!yearEnd) {
    const now = new Date()
    yearEnd = new Date(now.getFullYear(), 2, 31) // Default: March 31
  }

  // Group by Asset Category
  const byCategory = new Map()
  for (const row of depData.rows) {
    const cat = row.category || 'Uncategorised'
    if (!byCategory.has(cat)) byCategory.set(cat, [])
    byCategory.get(cat).push(row)
  }

  // Add row for each category
  for (const [category, catRows] of byCategory) {
    // Opening Position
    const grossOpening = catRows.reduce((s, r) => s + (parseFloat(r.grossOpen) || 0), 0)
    const accumDepOpening = catRows.reduce((s, r) => s + (parseFloat(r.accumDepOpen) || 0), 0)
    const netBlockOpening = grossOpening - accumDepOpening

    // Movements during the year
    const additions = catRows.reduce((s, r) => s + (parseFloat(r.additions) || 0), 0)
    const deductions = catRows.reduce((s, r) => s + (parseFloat(r.deductions) || 0), 0)

    // Compute depreciation for each row and sum
    const depYear = catRows.reduce((s, r) => s + computeDepreciationRow(r, yearEnd), 0)

    // Current Year WDV = Opening WDV + Additions - Deductions - Depreciation for Year
    const netBlockClosing = netBlockOpening + additions - deductions - depYear

    rows.push({
      type: 'l3',
      label: category,
      total: netBlockClosing,
      cy: netBlockClosing,
      py: netBlockOpening,
      isSubtotal: false
    })
  }

  // Add Totals row
  if (rows.length > 0) {
    const totalCY = rows.reduce((s, r) => s + (r.cy || 0), 0)
    const totalPY = rows.reduce((s, r) => s + (r.py || 0), 0)
    rows.push({
      type: 'l3',
      label: 'Total',
      total: totalCY,
      cy: totalCY,
      py: totalPY,
      isSubtotal: true
    })

    // Add reconciliation rows showing TB-derived values vs Depreciation values
    // Calculate TB-derived WDV from the original note rows
    const tbCY = depData.rows
      ? depData.rows.reduce((s, r) => s + rowAmt(r, 'closing_balance'), 0)
      : 0
    const tbPY = depData.rows
      ? depData.rows.reduce((s, r) => s + rowAmt(r, 'opening_balance'), 0)
      : 0

    rows.push({
      type: 'l3',
      label: 'WDV per Trial Balance',
      total: tbCY,
      cy: tbCY,
      py: tbPY,
      isSubtotal: false
    })

    rows.push({
      type: 'l3',
      label: 'Difference (TB less Depreciation)',
      total: tbCY - totalCY,
      cy: tbCY - totalCY,
      py: tbPY - totalPY,
      isSubtotal: false,
      isHighlight: true  // Flag for red styling in rendering
    })
  }

  return rows
}

// Build Cash & Bank disclosure rows
function buildCashBankRows(cashBankData) {
  if (!cashBankData) return []

  const items = [
    { key: 'a', label: 'Earmarked balances with banks' },
    { key: 'b', label: 'Balances with banks to the extent held as margin money or security against the borrowings, guarantees, other commitments' },
    { key: 'c', label: 'Repatriation restrictions, if any, in respect of cash and bank balances' },
  ]

  // Shown only when some item carries a figure (Current or Previous Year) —
  // the CA's rule (30 Sep 2026); the old "Always include" tick no longer
  // forces an all-nil table out.
  const hasAnyValue = items.some(item =>
    parseFloat(cashBankData.items?.[item.key]?.amount || 0) !== 0 ||
    parseFloat(cashBankData.items?.[item.key]?.amountPY || 0) !== 0)
  if (!hasAnyValue && !cashBankData.blankFormat) return []   // blankFormat: Features > Format shows the empty table

  const rows = []

  // Add table header row
  rows.push({
    type: 'l3',
    label: 'Other Details relating to Cash & Bank Balances included above',
    cy: 0,
    py: 0,
    isCashBankHeader: true,
    isSubtotal: true,
  })

  // Add all 3 items regardless of values (if any value is non-zero or includeInOutput is true)
  for (const item of items) {
    const amount = parseFloat(cashBankData.items?.[item.key]?.amount || 0)
    const remarks = cashBankData.items?.[item.key]?.remarks || ''
    rows.push({
      type: 'option',
      label: `(${item.key}) ${item.label}${remarks ? ` — ${remarks}` : ''}`,
      cy: amount,
      py: parseFloat(cashBankData.items?.[item.key]?.amountPY || 0),
      isCashBank: true,
      parentL3: 'Other Details relating to Cash & Bank Balances included above',
    })
  }

  return rows
}

// Build MSME disclosure rows for Trade Payables notes
function buildMSMERows(msmeData) {
  if (!msmeData) return []
  // Unwrap combined Trade Payables structure {msme: {...}, ageing: {...}}
  if (msmeData.msme) msmeData = msmeData.msme
  if (!msmeData.cy && !msmeData.py) return []

  const items = [
    { key: 'a', label: 'Amount remaining unpaid to any supplier at the end of each accounting year', isPrincipalInterest: true },
    { key: 'b', label: 'The amount of interest paid by the buyer in terms of section 16 of the Micro, Small and Medium Enterprises Development Act, 2006 (7 of 2006), along with the amount of the payment made to the supplier beyond the appointed day during each accounting year' },
    { key: 'c', label: 'The amount of interest due and payable for the period of delay in making payment (which have been paid but beyond the appointed day during the year) but without adding the interest specified under the Micro, Small and Medium Enterprises Development Act, 2006' },
    { key: 'd', label: 'The amount of interest accrued and remaining unpaid at the end of each accounting year' },
    { key: 'e', label: 'The amount of further interest remaining due and payable even in the succeeding years, until such date when the interest dues above are actually paid to the small enterprise, for the purpose of disallowance of a deductible expenditure under section 23 of the Micro, Small and Medium Enterprises Development Act, 2006' },
  ]

  // Check if any value is non-zero
  const hasAnyValue = items.some(item => {
    if (item.isPrincipalInterest) {
      const cy = parseFloat(msmeData.cy?.[item.key]?.principal || 0) + parseFloat(msmeData.cy?.[item.key]?.interest || 0)
      const py = parseFloat(msmeData.py?.[item.key]?.principal || 0) + parseFloat(msmeData.py?.[item.key]?.interest || 0)
      return cy !== 0 || py !== 0
    }
    const cy = parseFloat(msmeData.cy?.[item.key] || 0)
    const py = parseFloat(msmeData.py?.[item.key] || 0)
    return cy !== 0 || py !== 0
  })

  // If all values are zero and includeInOutput is not set, don't show table
  if (!hasAnyValue && !msmeData.includeInOutput) return []

  const rows = []

  // Add table header row
  rows.push({
    type: 'l3',
    label: 'Details of Amount relating to MSME as per MSME Act, 2006',
    cy: 0,
    py: 0,
    isMSMEHeader: true,
    isSubtotal: true,
  })

  // Add all 5 items regardless of values (if any value is non-zero or includeInOutput is true)
  for (const item of items) {
    if (item.isPrincipalInterest) {
      const pCY = parseFloat(msmeData.cy?.[item.key]?.principal || 0)
      const pPY = parseFloat(msmeData.py?.[item.key]?.principal || 0)
      const iCY = parseFloat(msmeData.cy?.[item.key]?.interest || 0)
      const iPY = parseFloat(msmeData.py?.[item.key]?.interest || 0)
      const base = `(${item.key}) ${item.label}`
      rows.push({ type: 'option', label: `${base} — Principal`, cy: pCY, py: pPY, isMSME: true, parentL3: 'Details of Amount relating to MSME as per MSME Act, 2006' })
      rows.push({ type: 'option', label: `${base} — Interest`, cy: iCY, py: iPY, isMSME: true, parentL3: 'Details of Amount relating to MSME as per MSME Act, 2006' })
      rows.push({ type: 'option', label: `${base} — Total`, cy: pCY + iCY, py: pPY + iPY, isMSME: true, isSubtotal: true, parentL3: 'Details of Amount relating to MSME as per MSME Act, 2006' })
      continue
    }
    const cy = parseFloat(msmeData.cy?.[item.key] || 0)
    const py = parseFloat(msmeData.py?.[item.key] || 0)
    rows.push({
      type: 'option',
      label: `(${item.key}) ${item.label}`,
      cy,
      py,
      isMSME: true,
      parentL3: 'Details of Amount relating to MSME as per MSME Act, 2006',
    })
  }

  return rows
}

// ── Previous Year for a Balance Sheet note's lines ──────────────────────────
// With a separate comparative Trial Balance selected, a line's Previous Year is
// that Trial Balance's own figure under the note's heading — the figure the
// note's total already uses (buildPrevMap). This Trial Balance's opening
// balances are last year's figures under THIS year's headings: a creditor in
// debit last year was an Advance to Suppliers then, a customer in credit an
// Advance from Customers, so the lines stopped adding up to their totals —
// Trade payables 92,785.00 against a total of 2,76,416.00, Advance to Suppliers
// nil (Santosh Kumar Gupta, 0.1.35). Lines this app adds itself (the year's
// profit, current maturities) keep their own Previous Year, and Closing Profit
// & Loss is the comparative opening balance plus the year's profit. With no
// comparative Trial Balance: the opening balances, as before.
export function comparativeRowsForNote(note, prevRows) {
  const BS_SIDES = new Set(['ASSETS', 'EQUITY AND LIABILITIES'])
  const title = (note?.title || '').trim().toLowerCase()
  const keyOf = (row) => `${row.alie || ''}|${(row.level1 || 'Uncategorised').trim().toLowerCase()}|${(row.mapping2_resultant || row.level2 || '').trim().toLowerCase()}`
  // A raw stock ledger superseded by that Trial Balance's Stock tab entries — as buildPrevMap.
  const stockEntryKeys = new Set((prevRows || []).filter(r => r.upload_nature === 'Stock Entry').map(keyOf))
  return (prevRows || []).filter(r =>
    BS_SIDES.has(r.alie) &&
    (r.mapping2_resultant || r.level2 || '').trim().toLowerCase() === title &&
    !(stockEntryKeys.has(keyOf(r)) && r.upload_nature !== 'Stock Entry'))
}
function previousYearEntries(note, comparativeRows) {
  const own = note?.rows || []
  if (!comparativeRows) return own.map(row => ({ row, amt: rowAmt(row, 'opening_balance') }))
  const entries = comparativeRows.map(row => ({ row, amt: rowAmt(row, 'closing_balance') }))
  const l3Of = (row) => (row.mapping3_resultant || row.level3 || '').trim().toLowerCase()
  const comparativeL3 = (label) => entries.filter(e => l3Of(e.row) === (label || '').trim().toLowerCase()).reduce((s, e) => s + e.amt, 0)
  const profitPY = own.filter(r => r.injected === 'profit').reduce((s, r) => s + rowAmt(r, 'opening_balance'), 0)
  for (const row of own) {
    if (!row.injected) continue
    entries.push({ row, amt: row.injected === 'closing' ? comparativeL3(row.openingL3) + profitPY : rowAmt(row, 'opening_balance') })
  }
  return entries
}

// Reserves and surplus: the year's surplus is "Add: Surplus / (Deficit) during the year" because it is added to an
// opening Profit & Loss balance. A first-year company has none, so there is nothing to add to and the line reads
// without "Add:". DISPLAY only: the row keeps its own label, which Manual PY entries, saved remarks and the
// Annexures link are keyed on.
const SURPLUS_NO_OPENING_LABEL = 'Surplus / (Deficit) during the year'
const hasOpeningBalance = (cy, py) => Math.abs(Number(cy) || 0) >= 0.005 || Math.abs(Number(py) || 0) >= 0.005

export function buildNoteTemplateRows(note, lfRows, depData, msmeData = null, cashBankData = null, comparativeRows = null) {
  const rows = []
  if (!note || note.isPL) return rows

  // Special handling for Property, Plant & Equipment — use Depreciation sheet data
  const isPPE = /property.*plant.*equipment|PPE|fixed assets/i.test(note.title || '')
  if (isPPE && depData?.rows && depData.rows.length > 0) {
    return buildPPENoteFromDepreciation(depData, note)
  }

  const isReservesSurplus = /reserves?\s*(and|&)\s*surplus/i.test(note.title || '')

  // Previous Year of every line below, grouped by Level 3 like the ledgers —
  // see previousYearEntries.
  const pyEntries = previousYearEntries(note, comparativeRows)

  // Inventories (every constitution): "Closing Stock (BS)" with Raw Materials, Work-in-Progress, Finished Goods, Stock-in-Trade and
  // Stores and Spares under it, each with its figure - from the Stock menu (utils/inventoriesNote.js). The Level Format differs by
  // constitution (Level 5 list on Company / Proprietorship, Level 3 lines on Partnership / LLP) and neither used to give the split.
  if (/^inventories$/i.test((note.title || '').trim())) {
    return buildInventoriesRows(
      (note.rows || []).map(r => ({ row: r, amt: rowAmt(r, 'closing_balance') })), pyEntries, ledgerIdsOf)
  }
  const pyByL3 = new Map()
  for (const e of pyEntries) {
    const l3 = (e.row.mapping3_resultant || e.row.level3 || '').trim()
    if (!pyByL3.has(l3)) pyByL3.set(l3, [])
    pyByL3.get(l3).push(e)
  }
  const pySum = (entries) => entries.reduce((s, e) => s + e.amt, 0)
  const pyOfL3 = (l3) => pyByL3.get(l3) || []

  const buildSyntheticProfitRows = () => {
    if (!isReservesSurplus) return []
    const wanted = [
      /^opening profit\s*&?\s*loss$/i,
      /^add:\s*surplus\s*\/\s*\(deficit\)\s*during\s*the\s*year$/i,
      /^closing profit\s*&?\s*loss$/i,
    ]
    const labelOf = (r) => (r.mapping3_resultant || r.level3 || r.name || '').trim()
    const openingCY = (note.rows || []).filter(r => wanted[0].test(labelOf(r))).reduce((s, r) => s + rowAmt(r, 'closing_balance'), 0)
    const openingPY = pySum(pyEntries.filter(e => wanted[0].test(labelOf(e.row))))
    return wanted.map((rx, idx) => {
      const matched = (note.rows || []).filter(r => rx.test(labelOf(r)))
      const pyMatched = pyEntries.filter(e => rx.test(labelOf(e.row)))
      if (!matched.length && !pyMatched.length) return null
      const first = matched[0] || pyMatched[0].row
      return {
        type: 'l3',
        label: first.mapping3_resultant || first.level3 || first.name,
        // the year's surplus, with no opening balance in either year to add it to
        ...(idx === 1 && !hasOpeningBalance(openingCY, openingPY) ? { displayLabel: SURPLUS_NO_OPENING_LABEL } : {}),
        cy: matched.reduce((s, r) => s + rowAmt(r, 'closing_balance'), 0),
        py: pySum(pyMatched),
        isSubtotal: matched.some(r => r.isSubtotal),
        syntheticProfitLoss: true,
      }
    }).filter(Boolean)
  }
  const syntheticProfitRows = buildSyntheticProfitRows()
  let insertedSyntheticProfitRows = false

  // Filter LF rows to those whose level2 matches the note title
  const matchingLF = (lfRows || []).filter(lf =>
    (lf.level2 || '').replace(/\s*\(specify nature\)/gi, '').trim().toLowerCase()
      === (note.title || '').replace(/\s*\(specify nature\)/gi, '').trim().toLowerCase()
  )

  // Index ledgers by their L3
  const ledgersByL3 = new Map()
  for (const r of note.rows) {
    const l3 = (r.mapping3_resultant || r.level3 || '').trim()
    if (!ledgersByL3.has(l3)) ledgersByL3.set(l3, [])
    ledgersByL3.get(l3).push(r)
  }

  // Track which L3 labels we've emitted so we don't duplicate
  const emittedL3 = new Set()

  for (const lf of matchingLF) {
    const l3Label = (lf.level3 || '').trim()
    if (!l3Label || emittedL3.has(l3Label)) continue
    emittedL3.add(l3Label)

    const l3Ledgers = ledgersByL3.get(l3Label) || []
    const l3PYEntries = pyOfL3(l3Label)
    const l3CY = l3Ledgers.reduce((s, r) => s + rowAmt(r, 'closing_balance'), 0)
    const l3PY = pySum(l3PYEntries)
    rows.push({ type: 'l3', label: l3Label, cy: l3CY, py: l3PY, lf,
      // the ledgers behind this line (Current / Previous Year) — what its "Fix" opens
      ledgerIds: ledgerIdsOf(l3Ledgers), pyLedgerIds: ledgerIdsOf(l3PYEntries.map(e => e.row)) })

    if (isReservesSurplus && !insertedSyntheticProfitRows && /securities premium/i.test(l3Label)) {
      // Some of these labels (e.g. "Opening Profit & Loss") may already have
      // been emitted a few lines above by the ordinary per-LevelFormat-row
      // loop, if the entity's template also defines an explicit L3 row for
      // them — skip those so the note doesn't show the same line twice.
      const toInsert = syntheticProfitRows.filter(r => !emittedL3.has((r.label || '').trim()))
      rows.push(...toInsert)
      syntheticProfitRows.forEach(r => emittedL3.add((r.label || '').trim()))
      insertedSyntheticProfitRows = true
    }

    // Handle L4 (template-defined)
    if (lf.level4) {
      const l4Opts = parseSlashOptions(lf.level4)
      if (l4Opts) {
        for (const opt of l4Opts) {
          const matched = l3Ledgers.filter(r => (r.level4_value || '').trim() === opt)
          rows.push({
            type: 'option',
            label: opt,
            cy: matched.reduce((s, r) => s + rowAmt(r, 'closing_balance'), 0),
            py: pySum(l3PYEntries.filter(e => (e.row.level4_value || '').trim() === opt)),
            fieldKey: 'level4_value',
            parentL3: l3Label,
          })
        }
        // Ledgers with no Level 4 sub-head (or an outdated one): flagged like Level 5 so Fix can open
        // them — ON SCREEN ONLY (screenOnly): Level 4 is optional sub-analysis, never printed as
        // "Unclassified" in the PDF / Excel.
        const isUnmatched4 = (r) => { const v = (r.level4_value || '').trim(); return !v || !l4Opts.includes(v) }
        const unmatched4 = l3Ledgers.filter(isUnmatched4)
        const pyUnmatched4 = l3PYEntries.filter(e => isUnmatched4(e.row))
        if (unmatched4.length > 0 || pyUnmatched4.length > 0) {
          rows.push({
            type: 'option', label: 'Unclassified',
            cy: unmatched4.reduce((s, r) => s + rowAmt(r, 'closing_balance'), 0),
            py: pySum(pyUnmatched4),
            fieldKey: 'level4_value', unclassified: true, screenOnly: true, natureLevel: 4, parentL3: l3Label,
            ledgerIds: ledgerIdsOf(unmatched4), pyLedgerIds: ledgerIdsOf(pyUnmatched4.map(e => e.row)),
          })
        }
      } else {
        // Fixed L4 label
        rows.push({
          type: 'l4', label: lf.level4,
          cy: l3CY, py: l3PY,
        })
      }
    }

    // Handle L5
    if (lf.level5) {
      const opts = parseSlashOptions(lf.level5)
      if (opts) {
        for (const opt of opts) {
          const matched = l3Ledgers.filter(r => (r.level5_value || '').trim() === opt)
          rows.push({
            type: 'option',
            label: opt,
            cy: matched.reduce((s, r) => s + rowAmt(r, 'closing_balance'), 0),
            py: pySum(l3PYEntries.filter(e => (e.row.level5_value || '').trim() === opt)),
            fieldKey: 'level5_value',
            parentL3: l3Label,
          })
        }
        // Also show unclassified (ledgers without any of these options)
        const isUnmatched = (r) => {
          const v = (r.level5_value || '').trim()
          return !v || !opts.includes(v)
        }
        const unmatched = l3Ledgers.filter(isUnmatched)
        const pyUnmatched = l3PYEntries.filter(e => isUnmatched(e.row))
        if (unmatched.length > 0 || pyUnmatched.length > 0) {
          rows.push({
            type: 'option',
            label: 'Unclassified',
            cy: unmatched.reduce((s, r) => s + rowAmt(r, 'closing_balance'), 0),
            py: pySum(pyUnmatched),
            fieldKey: 'level5_value',
            unclassified: true, natureLevel: 5,
            parentL3: l3Label,
            // exactly the ledgers counted here — Current Year, and Previous Year (a flag can
            // exist only because of a Previous Year ledger) — so Fix opens THEM
            ledgerIds: ledgerIdsOf(unmatched), pyLedgerIds: ledgerIdsOf(pyUnmatched.map(e => e.row)),
          })
        }
      }
    }

    // Dynamic L5 grouping: when lf.level5 not defined but ledgers have level5_value set
    if (!lf.level5) {
      const l5Values = [...new Set([...l3Ledgers, ...l3PYEntries.map(e => e.row)].map(r => (r.level5_value || '').trim()).filter(Boolean))].sort()
      if (l5Values.length > 0) {
        for (const val of l5Values) {
          const matched = l3Ledgers.filter(r => (r.level5_value || '').trim() === val)
          rows.push({
            type: 'option', label: val,
            cy: matched.reduce((s, r) => s + rowAmt(r, 'closing_balance'), 0),
            py: pySum(l3PYEntries.filter(e => (e.row.level5_value || '').trim() === val)),
            fieldKey: 'level5_value', parentL3: l3Label,
          })
        }
        const unmatched = l3Ledgers.filter(r => !(r.level5_value || '').trim())
        const pyUnmatched = l3PYEntries.filter(e => !(e.row.level5_value || '').trim())
        if (unmatched.length > 0 || pyUnmatched.length > 0) {
          rows.push({
            type: 'option', label: 'Unclassified',
            cy: unmatched.reduce((s, r) => s + rowAmt(r, 'closing_balance'), 0),
            py: pySum(pyUnmatched),
            fieldKey: 'level5_value', unclassified: true, natureLevel: 5, parentL3: l3Label,
            ledgerIds: ledgerIdsOf(unmatched), pyLedgerIds: ledgerIdsOf(pyUnmatched.map(e => e.row)),
          })
        }
      }
    }

    // Handle L6
    if (lf.level6) {
      const opts = parseSlashOptions(lf.level6)
      if (opts) {
        for (const opt of opts) {
          const matched = l3Ledgers.filter(r => (r.level6_value || '').trim() === opt)
          rows.push({
            type: 'option',
            label: opt,
            cy: matched.reduce((s, r) => s + rowAmt(r, 'closing_balance'), 0),
            py: pySum(l3PYEntries.filter(e => (e.row.level6_value || '').trim() === opt)),
            fieldKey: 'level6_value',
            parentL3: l3Label,
          })
        }
        const isUnmatched6 = (r) => { const v = (r.level6_value || '').trim(); return !v || !opts.includes(v) }
        const unmatched6 = l3Ledgers.filter(isUnmatched6)
        const pyUnmatched6 = l3PYEntries.filter(e => isUnmatched6(e.row))
        if (unmatched6.length > 0 || pyUnmatched6.length > 0) {
          rows.push({
            type: 'option', label: 'Unclassified',
            cy: unmatched6.reduce((s, r) => s + rowAmt(r, 'closing_balance'), 0),
            py: pySum(pyUnmatched6),
            fieldKey: 'level6_value', unclassified: true, screenOnly: true, natureLevel: 6, parentL3: l3Label,
            ledgerIds: ledgerIdsOf(unmatched6), pyLedgerIds: ledgerIdsOf(pyUnmatched6.map(e => e.row)),
          })
        }
      }
    }
  }

  // Add any L3 groups from ledgers that didn't match a LF row — this year's,
  // and a Level 3 only the comparative year has. A ledger with no Level 3 AT
  // ALL is real and deliberate here too — e.g. "Owners' Capital Account" is
  // structurally flat, with no Level 3 ever defined for it — and used to be
  // dropped from the visible breakdown entirely (though the note's own Total
  // still counted it), the same gap already fixed for a P&L note's Level-2-
  // less lines (see annexureGrouping.js's fallbackSubnoteLabel). Shown under
  // the note's own title, the same convention.
  // Includes synthetic rows like "Opening Balance", "Add: Profit/(Loss)", "Closing Balance".
  for (const l3 of new Set([...ledgersByL3.keys(), ...pyByL3.keys()])) {
    if (emittedL3.has(l3)) continue
    const label = l3 || note.title
    if (syntheticProfitRows.some(r => r.label === label)) continue
    const ledgers = ledgersByL3.get(l3) || []
    const cy = ledgers.reduce((s, r) => s + rowAmt(r, 'closing_balance'), 0)
    const py = pySum(pyOfL3(l3))
    const isSubtotal = [...ledgers, ...pyOfL3(l3).map(e => e.row)].some(r => r.isSubtotal)
    rows.push({ type: 'l3', label, cy, py, isSubtotal })
  }

  if (isReservesSurplus && !insertedSyntheticProfitRows && syntheticProfitRows.length) {
    const toInsert = syntheticProfitRows.filter(r => !emittedL3.has((r.label || '').trim()))
    rows.push(...toInsert)
  }

  // Add MSME disclosure rows for Trade Payables notes
  const isTradePayables = /trade.*payable/i.test(note.title || '')
  if (isTradePayables && msmeData) {
    const msmeRows = buildMSMERows(msmeData)
    if (msmeRows.length > 0) {
      rows.push(...msmeRows)
    }
  }

  // Add Cash & Bank disclosure rows for Cash & Bank Balances notes
  const isCashBank = /cash.*bank|bank.*balance/i.test(note.title || '')
  if (isCashBank && cashBankData) {
    const cashBankRows = buildCashBankRows(cashBankData)
    if (cashBankRows.length > 0) {
      rows.push(...cashBankRows)
    }
  }

  // Long-term borrowings: the current maturities shown under Short-term borrowings are taken off as a line of their own, so the note's
  // lines add up to its total (the Notes screen, the PDF and the Excel total all follow). Fix #4 in processRows sets ltbValidation.
  const cmv = note.ltbValidation
  if (cmv && (cmv.cmCY > 0 || cmv.cmPY > 0)) {
    rows.push({ type: 'l3', label: 'Less: Current maturities of long-term borrowings (shown under Short-term borrowings)', cy: -cmv.cmCY, py: -cmv.cmPY, isCmDeduction: true })
  }

  return rows
}

// Filter out rows whose CY and PY are both effectively zero. Preserves an
// "Unclassified" option row only if it has a non-zero value.
// Also preserves MSME and Cash & Bank header and all rows even if values are zero.
export function filterZeroNoteRows(rows) {
  if (!rows) return []
  const isZero = (n) => Math.abs(parseFloat(n || 0)) < 0.005

  // Check if there are MSME rows with any non-zero values
  const hasMSMEHeader = rows.some(r => r.isMSMEHeader)
  const msmeRowsWithValues = rows.filter(r => r.isMSME && (Math.abs(parseFloat(r.cy || 0)) >= 0.005 || Math.abs(parseFloat(r.py || 0)) >= 0.005))
  const shouldKeepMSME = hasMSMEHeader && (msmeRowsWithValues.length > 0 || rows.some(r => r.isMSMEHeader && r.label))

  // Check if there are Cash & Bank rows with any non-zero values
  const hasCashBankHeader = rows.some(r => r.isCashBankHeader)
  const cashBankRowsWithValues = rows.filter(r => r.isCashBank && (Math.abs(parseFloat(r.cy || 0)) >= 0.005 || Math.abs(parseFloat(r.py || 0)) >= 0.005))
  const shouldKeepCashBank = hasCashBankHeader && (cashBankRowsWithValues.length > 0 || rows.some(r => r.isCashBankHeader && r.label))

  return rows.filter(r => {
    // A line the statement must always carry (Inventories: the five stock categories) stays at nil
    if (r.keepZero) return true
    // Always keep MSME rows if any MSME value is non-zero
    if (shouldKeepMSME && (r.isMSMEHeader || r.isMSME)) return true
    // Always keep Cash & Bank rows if any value is non-zero
    if (shouldKeepCashBank && (r.isCashBankHeader || r.isCashBank)) return true
    // Remove zero rows for regular items
    return !(isZero(r.cy) && isZero(r.py))
  })
}

// This used to be a SEPARATE is_deemed_positive-based implementation,
// completely disconnected from displayAmt() above despite the near-identical
// name — buildNoteTemplateRows() (used for every BS note's L3 template rows,
// including the Advance to Suppliers/Advance from Customers reclassification
// targets) called THIS one, silently bypassing every alie/mapping3-based fix
// applied to displayAmt(). Delegate to the single shared implementation.
export const rowAmt = displayAmt

/**
 * @param {object} activeTB  - current year TB object (must have .id)
 * @param {object} prevTB    - optional previous year TB object (must have .id)
 * @param {object} entity    - optional — used to load LevelFormat template
 * @param {number} activeRsId- optional rule set id
 */
// Attaches per-note extras (Fill Details template rows, ageing schedules) —
// shared by every fetch path below so they all stay in sync.
export function attachNoteExtras(processed, ndList, lfRows, depData, constitution = null, depITData = null, depCompData = null, prevRows = null) {
  const savedDataFor = indexSavedNoteRows(ndList, parsedNoteData)
  // Ageing schedules (Trade Payables/Receivables) are a Company-only
  // disclosure requirement — see Notes/index.jsx's Fill Details gating. MSME
  // Act disclosure (handled inside buildNoteTemplateRows via msmeData) stays
  // constitution-agnostic. Gated here too so stale ageing data saved before
  // this rule existed doesn't still surface for LLP/Partnership/Proprietorship.
  const isCompany = parseInt(constitution) === 3
  for (const note of Object.values(processed.notes)) {
    if (!note.isPL) {
      const noteData = savedDataFor(note)
      // A comparative Trial Balance gives every line its Previous Year (see
      // comparativeRowsForNote); its Level 3 figures also serve the note's
      // annexure and a note with no template lines (utils/annexureGrouping.js).
      const comparativeRows = prevRows ? comparativeRowsForNote(note, prevRows) : null
      if (comparativeRows) {
        note.pyByL3 = new Map()
        for (const e of previousYearEntries(note, comparativeRows)) {
          const l3 = (e.row.mapping3_resultant || e.row.level3 || '').trim()
          note.pyByL3.set(l3, (note.pyByL3.get(l3) || 0) + e.amt)
        }
      }
      const allRows = buildNoteTemplateRows(note, lfRows || [], depData, noteData, noteData, comparativeRows)
      note.templateRowsAll = allRows
      note.templateRows    = filterZeroNoteRows(allRows)
      // Attach Trade Payables ageing data if applicable (Company only)
      const isTradePayables = /trade.*payable/i.test(note.title || '')
      if (isTradePayables && noteData && isCompany && noteData.ageing) {
        note.trPayablesAgingData = noteData.ageing
      }
      // Attach Trade Receivables ageing data if applicable (Company only)
      const isTradeReceivables = /trade.*receivable/i.test(note.title || '')
      if (isTradeReceivables && noteData && isCompany && (noteData.cy || noteData.py)) {
        note.trReceivablesAgingData = noteData
      }
      // Proprietorship / Partnership / LLP: the simpler 6-month ageing table
      // (utils/tradeReceivablesNonCorp.js) is ALWAYS shown beneath Trade
      // receivables — the saved figures if the preparer entered any, else null
      // (the display then defaults everything to "Unsecured, considered good").
      if (isTradeReceivables && [1, 2].includes(parseInt(constitution))) {
        note.ncTradeReceivables = { saved: noteData?.ncAgeing || null }
      }
      // Attach the IT Act Block-wise WDV summary to the PPE note — opt-in
      // only (checked on the Dep (IT) → Block Summary tab), so it shows in
      // Notes UI/Excel/PDF exactly when the preparer asked for it there.
      const isPPE = /property.*plant.*equipment|PPE|fixed assets/i.test(note.title || '')
      if (isPPE) {
        // Available regardless of the includeInPPENote flag, so the Notes
        // screen itself can offer the "Include in this note" toggle even
        // when it's currently off (see the Dep (IT) checkbox rendered
        // directly on the PPE note in Notes/index.jsx).
        note.itBlockSummaryAvailable = Array.isArray(depITData?.blockSummary) && depITData.blockSummary.length > 0
        note.itBlockSummaryIncluded  = !!depITData?.includeInPPENote
        if (depITData?.includeInPPENote && note.itBlockSummaryAvailable) {
          note.itBlockSummaryData = depITData.blockSummary
          // Manually-entered Previous Year totals for the block summary (Total
          // only, not per-Block) — see the blank "Previous Year" row under the
          // Dep (IT) → Editor/Block Summary Grand Total.
          const pyTotals = extractItBlockSummaryPyTotals(depITData.pyTotals)
          if (pyTotals) note.itBlockSummaryPyTotals = pyTotals
          const wip = extractItWip(depITData.wip)
          if (wip) note.itWip = wip
        }
        // Per-ledger IT Block assignment (ledger name → { block, rate }) — for
        // Annexures transparency: which block each individual fixed-asset
        // ledger was classified into. Independent of includeInPPENote (that
        // toggle only controls whether the aggregated summary table shows on
        // the note face itself; the CA may still want per-ledger visibility
        // in Annexures without turning that on). Resolved via blockSummary
        // (already carries the human-readable block name/rate per blockId)
        // rather than a second lookup against the blocks master/custom list.
        if (depITData?.rows && Array.isArray(depITData.blockSummary)) {
          const blockInfoById = new Map(depITData.blockSummary.map(b => [b.blockId, { block: b.block, rate: b.rate }]))
          const byLedger = {}
          for (const [ledgerName, input] of Object.entries(depITData.rows)) {
            if (!input?.block) continue
            const info = blockInfoById.get(input.block)
            if (info) byLedger[ledgerName] = info
          }
          if (Object.keys(byLedger).length) note.itBlockByLedger = byLedger
        }
        // Attach the Dep (Comp) category-level Schedule II schedule to the PPE
        // note — opt-in only (checked on the Dep (Comp) screen), mirroring the
        // Dep (IT) block summary above. Mutually exclusive with it by
        // construction (only one of the two "includeInPPENote" flags is ever
        // true at a time — see the toggle handlers in DepreciationComp/
        // DepreciationIT, which clear the other's flag on check).
        note.compScheduleAvailable = Array.isArray(depCompData?.categoryRows) && depCompData.categoryRows.length > 0
        note.compScheduleIncluded  = !!depCompData?.includeInPPENote
        if (depCompData?.includeInPPENote && note.compScheduleAvailable) {
          note.compScheduleData = depCompData.categoryRows
          // "Total as per Trial Balance" — the PPE note's OWN mapped-TB total
          // (note.rows, the same ledgers the generic note-builder above just
          // used), not a re-derivation from the schedule's own asset rows —
          // so this reconciliation and the Dep (Comp) screen's own on-screen
          // reconciliation (which sources the same figure via
          // fetchFinancialsData) never disagree.
          note.compScheduleTbCY = (note.rows || []).reduce((s, r) => s + rowAmt(r, 'closing_balance'), 0)
          note.compScheduleTbPY = (note.rows || []).reduce((s, r) => s + rowAmt(r, 'opening_balance'), 0)
          // Manually-entered Previous Year totals (Total only, not per-Category)
          // — see the blank "Previous Year" row under the Dep (Comp) Grand Total.
          const compPyTotals = extractCompSchedulePyTotals(depCompData.pyTotals)
          if (compPyTotals) note.compSchedulePyTotals = compPyTotals
        }
      }
    }
  }
}

// ── Manual PY overlay — applied inline on the Notes screen's own rows ───────
// Entered directly against each note's particular/sub-heading row rather than
// at the whole-note level or in a separate entry screen — see Notes/index.jsx's
// inline editable Previous Year cells + "+ Add Row".
//
// Scope: EVERY leaf figure in a note is editable when Manual PY is on. This
// used to be restricted to "simple" top-level particulars only — any Level 3
// with sub-rows (Reserves & Surplus's opening/additions breakdown, Secured/
// Unsecured options, MSME principal/interest) kept its auto-computed PY, so a
// CA could enter Share Capital's previous year but not Reserves & Surplus's,
// and the Balance Sheet comparative could never be completed by hand. Now:
//
//   leaf rows      editable — a top-level L3 with no sub-rows, every option
//                  row (L4/L5/L6 choices, dynamic L5, "Unclassified"), MSME
//                  principal/interest lines, and the Reserves & Surplus
//                  "Opening"/"Add: Surplus" lines
//   parent rows    computed — an L3 with sub-rows is the SUM of its sub-rows
//   mirror rows    computed — a fixed L4 label repeats its L3's figure
//   subtotal rows  computed — MSME "— Total" = Principal + Interest; Reserves
//                  "Closing Profit & Loss" = Opening + Surplus
//   cash & bank    untouched — that disclosure renders no Previous Year column
//
// The note total is the sum of its top-level rows (parents already rolled up,
// subtotals and supplementary MSME/cash-bank sections excluded), and flows
// into the BS/PL line for that note through updateParent() below — so the
// statements' comparative column is DERIVED from the notes, never typed twice.
//
// Storage key (manual_py_entries.particular_label): a top-level row keeps its
// bare label, exactly as before, so every entry saved by the earlier version
// still applies. A sub-row is keyed "<parent L3> > <label>" — labels such as
// "Unclassified" or "Secured, considered good" recur under several L3s inside
// one note, and a bare label would make them collide.
function applyManualPyOverrides(processed, manualPyEnabled, manualPyEntries) {
  processed.manualPyEnabled = !!manualPyEnabled
  if (!manualPyEnabled) return

  // Matched by TITLE, not note_num — note_num is a raw sequential position
  // recomputed fresh every time notes are built (a section only gets a
  // number once processRows() has iterated that far AND found it non-zero
  // in either year), so it is NOT a stable identity. Entering a manual PY
  // figure for a currently-empty note can itself flip that note from
  // skipped to included, shifting every later note's number — an entry
  // saved under note_num=21 can, moments later, find note_num=21 pointing
  // at a DIFFERENT note and get silently applied there. Confirmed in the
  // field: Consolidated mode's dynamic per-render numbering made this show
  // up as Employee-benefits figures under Finance Costs, Finance-Cost
  // figures under Depreciation, Other-Expenses figures under Tax expense —
  // each note picking up whatever an EARLIER note's shift left behind.
  // Rows saved before note_title existed have '' there and are skipped
  // below rather than matched by their old (unsafe) note_num — see
  // schema.js's note_title comment; such rows need re-entering once, not
  // "recovered" onto a number that was never trustworthy to begin with.
  const normTitle = (t) => (t || '').trim().toLowerCase()
  const byNote = new Map()
  for (const e of manualPyEntries || []) {
    const key = normTitle(e.note_title)
    if (!key) continue
    if (!byNote.has(key)) byNote.set(key, new Map())
    byNote.get(key).set((e.particular_label || '').trim(), e)
  }
  // "Tax expense": its Current tax / Excess-Short / Deferred lines are the P&L
  // face's own fixed rows, so a whole-note (blank-labelled) figure on it has no
  // row to land on. "+ Add PY-only Major Head -> Tax expense" saved exactly that
  // (one lump sum), and a CA typing one lump sum under Tax expense means the
  // Current tax figure -- read it as the 'Current tax' particular, unless one
  // was entered by name (a named entry always wins; the blank one is then
  // ignored, never double-counted).
  for (const [key, m] of byNote) {
    if (!/^tax expense:?$/.test(key) || !m.has('')) continue
    if (!m.has('Current tax')) m.set('Current tax', { ...m.get(''), particular_label: 'Current tax' })
    m.delete('')
  }
  const amountOf = (entries, key) => {
    const entry = entries?.get((key || '').trim())
    return entry ? (parseFloat(entry.py_amount) || 0) : 0
  }
  const childKey = (parentLabel, label) => `${(parentLabel || '').trim()} > ${(label || '').trim()}`

  const updateParent = (note) => {
    if (note.isPL) {
      // PL sections never carry a per-line noteNum -- only the whole
      // section does (section.noteNum, assigned in the note-allocation pass
      // above) -- a note IS its section, one-for-one, in every case except
      // the non-corporate "Purchases of Stock-in-Trade" note merged into
      // "Cost of materials consumed" (see the constitution=1 merge above),
      // where TWO sections share one note.num. Matching on line.noteNum (as
      // the BS branch below does) silently never fired for PL, so a note
      // with no Level 2 breakdown at all -- the common shape for a plain
      // "Purchases" note, every line's level2 blank -- would save and
      // display correctly inside its own note (note.prevTotal, set
      // directly below) but never reach the P&L face's sec.prevTotal,
      // which stayed at its stale pre-override value forever.
      const sections = [...(processed.incomeSections || []), ...(processed.expenseSections || [])]
        .filter(sec => sec.noteNum === note.num)
      if (sections.length === 1) {
        sections[0].prevTotal = note.prevTotal
      } else {
        // Two sections sharing one note (the merge above): note.prevTotal is
        // their COMBINED total, not either one's own share. Each section's
        // own lines already carry the correct per-line Manual PY figure
        // (set above -- those line objects are shared by reference with
        // note.lines even after the merge), so re-summing each section's
        // OWN lines recovers its own share instead of duplicating the full
        // combined total onto both.
        for (const sec of sections) {
          sec.prevTotal = sec.lines.reduce((s, l) => s + (l.prevTotal || 0), 0)
        }
      }
      return
    }
    const sections = [...(processed.elSections || []), ...(processed.assetSections || [])]
    for (const sec of sections) {
      for (const line of sec.lines) {
        if (line.noteNum === note.num) line.prevTotal = note.prevTotal
      }
      sec.prevTotal = sec.lines.reduce((s, l) => s + l.prevTotal, 0)
    }
  }

  for (const note of Object.values(processed.notes)) {
    const entries = byNote.get(normTitle(note.title))

    // ── PL notes: one note per Level 1 section, particulars = note.lines
    // (keyed by level2) — the exact same idea as BS's templateRows, just a
    // different underlying shape (PL notes were never run through
    // buildNoteTemplateRows). ────────────────────────────────────────────
    if (note.isPL) {
      const lines = note.lines || []
      // Revenue from operations used to have one line, "Sale"; since 0.1.78 it has
      // "Sale of Goods" / "Sale of Services". A Previous Year typed against "Sale"
      // would no longer match either line: it printed on an orphan "Sale" line and
      // left Goods / Services blank (so the CA typed it again and it counted twice).
      // It is carried over to Sale of Goods (else Services) while neither line has a
      // figure of its own; once one has, the old one is dropped, not added on top.
      if (entries && entries.has('Sale') && /^revenue from operations?$/i.test((note.title || '').replace(/\(specify nature\)/i, '').trim())) {
        const goods = lines.find(l => (l.level2 || '').trim() === 'Sale of Goods')
        const services = lines.find(l => (l.level2 || '').trim() === 'Sale of Services')
        const heldOver = entries.get('Sale')
        const typedNew = [goods, services].some(l => l && entries.has(l.level2.trim()))
        const home = typedNew ? null : (goods || services)
        if (!lines.some(l => (l.level2 || '').trim() === 'Sale')) {
          if (home) entries.set(home.level2.trim(), heldOver)
          if (home || goods || services) entries.delete('Sale')
        }
      }
      // A NAMED (non-blank-label) Manual PY entry always wants its own line
      // — e.g. "Current tax" against a "Tax expense" note that currently
      // has no Level 2 breakdown at all (every "+ Add PY-only Major Head"
      // note starts this way). Only when there's NEITHER real Level 2 data
      // NOR any named entry does the note stay "flat" (one blank-labelled
      // figure for the whole note, entries.get('')).
      const hasNamedEntry = entries && [...entries.keys()].some(k => k)
      const hasL2 = lines.some(l => l.level2) || hasNamedEntry
      if (hasNamedEntry) {
        // The '(Previous Year only)' placeholder line of a "+ Add PY-only Major
        // Head" note exists only so the note survives with no Current Year
        // balance. Once the figure lives in named particulars it is dead
        // weight -- and on the LLP/Company face, which prints every line of the
        // Tax expense block, it would print as a stray "Tax expense  0  0" row.
        // Removed IN PLACE: note.lines and its section's lines are one array.
        const dead = new Set(lines.filter(l => l.forceInclude && !l.level2 && (l.rows || []).every(r => r.forceInclude)))
        if (dead.size) {
          const dropFrom = (arr) => { for (let i = arr.length - 1; i >= 0; i--) if (dead.has(arr[i])) arr.splice(i, 1) }
          dropFrom(lines)
          for (const sec of [...(processed.incomeSections || []), ...(processed.expenseSections || [])]) {
            if (sec.noteNum === note.num && sec.lines !== lines) dropFrom(sec.lines)
          }
        }
      }
      if (hasL2) {
        let total = 0
        for (const line of lines) {
          if (!line.level2) {
            // A ledger mapped straight to this note's Level 1 with no Level 2
            // at all (e.g. Purchase Accounts under "Cost of materials
            // consumed" — see mapping-engine.js's applyPurchaseAccountsOverride)
            // still needs a PY figure to be enterable when Manual PY is on,
            // same as every other line — this used to be skipped entirely,
            // exactly the same root cause already fixed for its DISPLAY in
            // Notes/index.jsx and utils/annexureGrouping.js (a falsy level2
            // treated as "nothing here" instead of "no sub-classification,
            // but real ledgers"). Keyed by fallbackSubnoteLabel(note.title)
            // — the same fallback label the display layer already uses
            // (e.g. "Purchases" for Cost of materials consumed) — and NOT
            // by '' (that empty key is reserved below for a note with no
            // breakdown AT ALL, a different, mutually exclusive case).
            if ((line.rows || []).length > 0) {
              line.prevTotal = amountOf(entries, fallbackSubnoteLabel(note.title))
              line.manualPyEditable = true
              total += line.prevTotal
            } else {
              total += line.prevTotal || 0
            }
            continue
          }
          line.prevTotal = amountOf(entries, line.level2)
          line.manualPyEditable = true
          total += line.prevTotal
        }
        if (entries) {
          const existingLabels = new Set(lines.map(l => (l.level2 || '').trim()))
          // The fallback line above (if any) already consumed the
          // fallbackSubnoteLabel(note.title) entry — its own level2 is '',
          // not that label, so it wouldn't otherwise be recognised here and
          // would get a second, duplicate synthetic line for the same entry.
          if (lines.some(l => !l.level2 && (l.rows || []).length > 0)) existingLabels.add(fallbackSubnoteLabel(note.title))
          for (const [label, entry] of entries.entries()) {
            if (!label || existingLabels.has(label)) continue
            const newLine = { level2: label, total: 0, prevTotal: parseFloat(entry.py_amount) || 0, rows: [], manualPyEditable: true, isCustomManual: true, manualPyEntryId: entry.id }
            lines.push(newLine)
            total += newLine.prevTotal
          }
        }
        note.prevTotal = total
        note.manualPyEditable = true
      } else {
        const entry = entries?.get('')
        note.prevTotal = entry ? (parseFloat(entry.py_amount) || 0) : 0
        note.manualPyEditable = true
        note.manualPyFlatEntry = entry || null
      }
      updateParent(note)
      continue
    }

    // ── BS notes: LevelFormat template rows ─────────────────────────────
    const allRows = note.templateRowsAll || note.templateRows || []

    if (allRows.length) {
      // Sub-rows are linked to their Level 3 by parentL3. Fixed L4 labels
      // carry no link and simply repeat the figure of the L3 emitted just
      // before them, so they are assigned positionally.
      const childrenOf = new Map()
      for (const r of allRows) {
        if (!r.parentL3 || r.isMSME || r.isCashBank) continue
        if (!childrenOf.has(r.parentL3)) childrenOf.set(r.parentL3, [])
        childrenOf.get(r.parentL3).push(r)
      }

      const makeLeaf = (row, key) => {
        row.manualPyKey = key
        row.py = amountOf(entries, key)
        row.manualPyEditable = true
      }

      const topLevel = []
      let currentL3 = null
      for (const row of allRows) {
        // Cash & Bank "other details" show CY + remarks only — no PY column
        // exists to edit, and they are not part of the note total.
        if (row.isCashBankHeader || row.isCashBank) continue

        // MSME disclosure: a supplementary schedule, not part of the note
        // total. Principal / Interest are entered; "— Total" is derived below.
        if (row.isMSMEHeader) { currentL3 = null; row.manualPyEditable = false; continue }
        if (row.isMSME) {
          if (row.isSubtotal) { row.manualPyEditable = false; continue }
          makeLeaf(row, childKey(row.parentL3, row.label))
          continue
        }

        if (row.type === 'l3' && !row.parentL3) {
          currentL3 = row
          if (row.isSubtotal) { row.manualPyEditable = false; continue }   // computed line (e.g. Closing P&L)
          const kids = childrenOf.get(row.label) || []
          if (kids.length) {
            for (const k of kids) makeLeaf(k, childKey(row.label, k.label))
            row.py = kids.reduce((s, k) => s + (k.py || 0), 0)
            row.manualPyEditable = false
          } else {
            makeLeaf(row, (row.label || '').trim())
          }
          topLevel.push(row)
          continue
        }

        if (row.type === 'l4' && !row.parentL3) {                  // mirror of its L3
          row.py = currentL3 ? (currentL3.py || 0) : 0
          row.manualPyEditable = false
          continue
        }

        // An option row whose parent was not a top-level L3 seen above
        // (defensive — should not happen, but never leave a figure uneditable).
        if (row.parentL3 && !row.manualPyEditable) makeLeaf(row, childKey(row.parentL3, row.label))
      }

      // MSME "— Total" = Principal + Interest of the same item.
      for (const row of allRows) {
        if (!(row.isMSME && row.isSubtotal)) continue
        const base = (row.label || '').replace(/\s*—\s*Total$/, '')
        const find = (suffix) => allRows.find(r => r.isMSME && (r.label || '') === `${base} — ${suffix}`)
        row.py = (find('Principal')?.py || 0) + (find('Interest')?.py || 0)
      }

      // Reserves & Surplus: Closing Profit & Loss = Opening + Surplus/(Deficit).
      const synth = allRows.filter(r => r.syntheticProfitLoss)
      if (synth.length) {
        const opening = synth.find(r => /^opening profit/i.test(r.label || ''))
        const surplus = synth.find(r => /^add:/i.test(r.label || ''))
        const closing = synth.find(r => /^closing profit/i.test(r.label || ''))
        if (closing && closing.isSubtotal && (opening || surplus)) {
          closing.py = (opening?.py || 0) + (surplus?.py || 0)
        }
        if (surplus) {
          // Inline (selftest-manualpy.mjs extracts this function by its source text): the same rule and wording as
          // hasOpeningBalance / SURPLUS_NO_OPENING_LABEL above buildNoteTemplateRows.
          const openingExists = Math.abs(Number(opening?.cy) || 0) >= 0.005 || Math.abs(Number(opening?.py) || 0) >= 0.005
          if (openingExists) delete surplus.displayLabel
          else surplus.displayLabel = 'Surplus / (Deficit) during the year'
        }
      }

      // A "+ Add PY-only Major Head" note (every real row is the synthetic
      // '(Previous Year only)' placeholder — see processRows's
      // manualPyOnlyTitles injection) is saved as ONE whole-note figure (blank
      // label). When its title has LevelFormat Level 3 rows, this template
      // branch runs instead of the flat one below and, matching only LABELLED
      // entries, would drop that figure — the note stayed empty, the BS face
      // showed no Previous Year, and the note vanished from the Notes list.
      // Land it on one row of its own, keyed '' so editing it inline writes
      // the same whole-note entry back. Scoped to PY-only notes (those carrying
      // the placeholder — a head with no Current Year figure; nil-balance
      // ledgers may sit beside it) so a stale blank-label entry on a note with
      // real figures is not newly revived.
      if (entries?.has('') && (note.rows || []).some(r => r.forceInclude)) {
        const wholeEntry = entries.get('')
        const wholeRow = { type: 'l3', label: note.title, cy: 0, py: parseFloat(wholeEntry.py_amount) || 0,
                           manualPyKey: '', manualPyEditable: true, manualPyEntryId: wholeEntry.id }
        allRows.push(wholeRow)
        topLevel.push(wholeRow)
      }

      // Custom particulars the CA added that match no existing row.
      if (entries) {
        const existingKeys = new Set(allRows.map(r => (r.manualPyKey || r.label || '').trim()))
        for (const [label, entry] of entries.entries()) {
          if (!label || existingKeys.has(label)) continue
          const newRow = { type: 'l3', label, cy: 0, py: parseFloat(entry.py_amount) || 0,
                           manualPyKey: label, manualPyEditable: true, isCustomManual: true, manualPyEntryId: entry.id }
          allRows.push(newRow)
          topLevel.push(newRow)
        }
      }

      note.prevTotal = topLevel.reduce((s, r) => s + (r.py || 0), 0)
      note.manualPyEditable = true
      // Re-derive the displayed rows AFTER the manual figures are in place, so
      // a sub-head with no current-year ledger but a previous-year entry shows
      // without the CA having to tick "show zero rows" to find it.
      note.templateRowsAll = allRows
      note.templateRows = filterZeroNoteRows(allRows)
    } else {
      // Flat note, no template rows — the whole note is the one particular.
      const entry = entries?.get('')
      note.prevTotal = entry ? (parseFloat(entry.py_amount) || 0) : 0
      note.manualPyEditable = true
      note.manualPyFlatEntry = entry || null
    }
    updateParent(note)
  }

  const active = []
  for (const note of Object.values(processed.notes)) {
    note.isEmpty = Math.abs(parseFloat(note.total || 0)) < 0.005 && Math.abs(parseFloat(note.prevTotal || 0)) < 0.005
    if (!note.isEmpty && !note.isUncategorised) active.push(note)
  }
  active.sort((a, b) => a.num - b.num)
  processed.activeNotes = active

  // The Previous Year figures typed in the notes now stand in the sections - the Previous Year profit is re-derived from them. It was
  // left at the figure computed before they were applied, so everything that reads it (EPS, ratios, the Exception Report) used the
  // old Previous Year profit.
  const sumPrev = (secs) => (secs || []).reduce((s, sec) => s + (Number(sec.prevTotal) || 0), 0)
  processed.prevNetProfit = sumPrev(processed.incomeSections) - sumPrev(processed.expenseSections)
}

// ── Basic/Diluted EPS (Company only, Schedule III) ─────────────────────────
// Firm's own convention (not Ind AS 33's full dilution mechanics): EPS = PAT
// / Number of Equity Shares Issued and Subscribed, as entered on the Share
// Capital note's Fill Details form — the SAME formula for Basic and Diluted,
// no separate dilution adjustment. Matched by note TITLE (not note_num,
// which is a recomputed position — see applyManualPyOverrides's comment
// above for why that's unsafe), same as every other note_details lookup in
// this file.
//
// Attaches processed.eps = {
//   sharesCY, sharesPY,                       // summed 'subscribed' count, equity classes only
//   sharesMissingCY, sharesMissingPY,          // true when Share Capital Fill Details has no
//                                              // equity class with a non-zero count for that year
//                                              // (Previous Year: only when last year exists - see pyNotApplicable)
//   pyNotApplicable,                           // no Previous Year at all (first year of operation, or switched off
//                                              // by the CA): its EPS prints "-", never "Fill Share Capital"
//   autoBasicCY, autoBasicPY, autoDilutedCY, autoDilutedPY,  // null when shares missing
//   overrides: { basicCY, basicPY, dilutedCY, dilutedPY },   // CA-typed values, null = "use auto"
// }
// The 4 auto* figures are always PAT/shares (Basic === Diluted, per the
// formula above) — kept as 4 separate fields (rather than 2) purely so the
// override object below has one matching key per displayed cell.
function computeEpsData(processed, ndList, epsOverrides) {
  const num = (v) => parseFloat(v) || 0
  const scNd = (ndList || []).find(nd => /share capital/i.test(nd.note_title || ''))
  const classes = scNd?.data?.classes || []
  const equityClasses = classes.filter(c => (c.type || 'Equity').trim().toLowerCase() === 'equity')
  const sharesCY = equityClasses.reduce((s, c) => s + num(c.cy?.subscribed), 0)
  const sharesPY = equityClasses.reduce((s, c) => s + num(c.py?.subscribed), 0)
  const sharesMissingCY = sharesCY <= 0
  // Last year has nothing at all when the CA switched it off, or when every Previous Year total is nil and no share
  // count was entered for it - a first year of operation. There is nothing to fill in then: EPS shows "-". A year
  // that does have figures, but no share count, is still asked for it.
  const pyTotal = (secs) => (secs || []).reduce((s, sec) => s + Math.abs(num(sec.prevTotal)), 0)
  const pyHasFigures = pyTotal(processed.elSections) + pyTotal(processed.assetSections) + pyTotal(processed.incomeSections) + pyTotal(processed.expenseSections) + Math.abs(num(processed.prevNetProfit)) >= 0.005
  const sharesMissingPYRaw = sharesPY <= 0
  const pyNotApplicable = (!!processed.pyMode && processed.pyMode !== 'required') || (!pyHasFigures && sharesMissingPYRaw)
  const sharesMissingPY = sharesMissingPYRaw && !pyNotApplicable
  // The profit the Statement of Profit and Loss itself shows for the period (not the data-level total, which adds the sections up
  // differently - it came out negative for a company whose face showed a profit).
  const face = corpFaceNetProfit(processed)
  const autoBasicCY = sharesMissingCY ? null : num(face.cy) / sharesCY
  const autoBasicPY = (sharesMissingPYRaw || (!!processed.pyMode && processed.pyMode !== 'required')) ? null : num(face.py) / sharesPY
  processed.eps = {
    sharesCY, sharesPY, sharesMissingCY, sharesMissingPY, pyNotApplicable,
    autoBasicCY, autoBasicPY, autoDilutedCY: autoBasicCY, autoDilutedPY: autoBasicPY,
    overrides: {
      basicCY: epsOverrides?.basicCY ?? null, basicPY: epsOverrides?.basicPY ?? null,
      dilutedCY: epsOverrides?.dilutedCY ?? null, dilutedPY: epsOverrides?.dilutedPY ?? null,
    },
  }
}

// ── Previous Year switched off ───────────────────────────────────────────────
// entity_periods.py_mode (chosen by the CA, per Auditee<->FY): 'required' (the default, how the app has always
// worked), 'none_show' (Previous Year not required - the column stays, all dashes) or 'none_hide' (not required -
// the column is left out of the statements). A first-year entity has no Previous Year; some years it is simply not wanted.
async function readPYMode(tb) {
  if (!tb?.entity_period_id) return 'required'
  try {
    const ep = await window.api?.getEntityPeriod?.(tb.entity_period_id)
    return (ep?.py_mode === 'none_show' || ep?.py_mode === 'none_hide') ? ep.py_mode : 'required'
  } catch { return 'required' }
}
// With Previous Year off nothing from last year may reach a statement: not a Previous Year TB, not Manual PY, and not
// this TB's own opening balances either (that is where the Previous Year comes from when no PY TB is picked).
const withoutPreviousYear = (rows) => (rows || []).map(r => ({ ...r, opening_balance: '0' }))

// ── One-shot financials fetch (no React state) ───────────────────────────────
// Extracted from useFinancials() so callers that need a GUARANTEED fresh
// snapshot — e.g. Generate Financials, right before building an export — can
// await this directly instead of reading a hook's possibly-stale cached
// `data` (which only refetches on mount / explicit refresh(), not on every
// mapped_tb change made from a different tab). The hook below is now just a
// thin React wrapper around this same function, so both stay in sync.
export async function fetchFinancialsData(activeTB, prevTB, entity = null, activeRsId = null) {
  if (!activeTB?.id) return null

  // ── Virtual Consolidated TB ──────────────────────────────────────────────
  if (activeTB.id === '__consolidated__') {
    const entityId = activeTB.entity_id
    const fetchLF  = entity?.constitution
      ? (window.api?.getLevelFormat(entity.constitution, activeRsId || null) || Promise.resolve([]))
      : Promise.resolve([])
    // The consolidated view has no TB of its own: the depreciation schedules
    // are the entity-level "Consolidated" ones (utils/depStore.js), read off
    // the note-details list below. (Earlier code called depGet(entityId) —
    // an entity id is not a TB id, so that read a random branch's schedule.)
    const fetchDep = Promise.resolve(null)
    const fetchDepIT = Promise.resolve(null)
    const fetchDepComp = Promise.resolve(null)
    // Manual PY for the Consolidated view — entity-scoped mirror of the
    // per-TB flag/entries (see schema.js's entity_manual_py_entries). There
    // is no separate "Consolidated PY Trial Balance" to prefer over it (the
    // real path's `!prevMap &&` guard doesn't apply here), so it's used
    // whenever it's turned on.
    const fetchManualPyEnabled = (window.api?.getEntityManualPY?.(entityId) || Promise.resolve(false)).catch(() => false)
    const fetchManualPyEntries = (window.api?.listEntityManualPyEntries?.(entityId) || Promise.resolve([])).catch(() => [])
    // 'P&L already closed to Capital in Tally' for the Consolidated view —
    // entity-scoped mirror of the per-TB flag. See usePlClosedToCapital.js's
    // doc comment for why '__consolidated__' cannot use the per-TB flag.
    const fetchPlClosedToCapital = (window.api?.getEntityPlClosedToCapital?.(entityId) || Promise.resolve(false)).catch(() => false)
    // Basic/Diluted EPS overrides — Company only, see computeEpsData's comment.
    const fetchEps = (parseInt(entity?.constitution) === 3)
      ? (window.api?.getEntityEps?.(entityId) || Promise.resolve(null)).catch(() => null)
      : Promise.resolve(null)

    // General Notes (Significant Accounting Policies, Financial Ratios) and the Cash Flow Statement are statements of the Auditee as a
    // whole - they belong to the Consolidated statements. The consolidated path used to leave them out altogether.
    const epId = activeTB.entity_period_id
    const generalNotesRaw = (entityId && epId) ? await Promise.resolve(window.api?.getGeneralNotes?.(entityId, epId)).catch(() => null) : null
    const cfsSavedC = (entityId && epId) ? await Promise.resolve(window.api?.getCfs?.(entityId, epId)).catch(() => null) : null
    const generalNotesModeC = generalNotesRaw?.points?.length ? (generalNotesRaw.position === 'last' ? 'last' : 'first') : null

    // Which Trial Balances are consolidated: this Financial Year's for the current year, the year before's for the previous year
    // (or the CA's own ticks - see utils/consolidationSelection.js).
    const sel = await resolveConsolidationSelection(entityId, activeTB.entity_period_id)
    let [cyRows, lfRows, ndList, depData, depITData, depCompData, manualPyEnabled, manualPyEntries, plClosedToCapital, epsOverrides, pyMode] = await Promise.all([
      window.api?.getConsolidatedData(entityId, sel.cyIds),
      fetchLF,
      window.api?.listEntityNoteDetails(entityId).catch(() => []),
      fetchDep,
      fetchDepIT,
      fetchDepComp,
      fetchManualPyEnabled,
      fetchManualPyEntries,
      fetchPlClosedToCapital,
      fetchEps,
      readPYMode(activeTB),
    ])
    ;({ depITData, depCompData } = consolidatedDepFromNoteDetails(ndList))
    const pyOff = pyMode !== 'required'
    if (pyOff) { cyRows = withoutPreviousYear(cyRows); manualPyEnabled = false; manualPyEntries = [] }
    const cyGuard = ignoreForeignLevel2(cyRows, lfRows)
    const bt = eliminateNilBranchTrading(cyGuard.rows)
    const ib = eliminateInterBranch(bt.rows)
    // Previous year: the consolidation of the previous year's Trial Balances (closing balances), handled exactly as the current year
    // is. With none to consolidate the opening balances of the current year's ledgers stay the Previous Year, as before.
    let pyRows = [], pyFlagged = []
    if (!pyOff && sel.pyIds.length) {
      const pyRaw = (await window.api?.getConsolidatedData(entityId, sel.pyIds)) || []
      const pyGuard = ignoreForeignLevel2(pyRaw, lfRows)
      pyFlagged = pyGuard.flagged
      pyRows = eliminateInterBranch(eliminateNilBranchTrading(pyGuard.rows).rows).rows
    }
    const prevMap = pyRows.length > 0 ? buildPrevMap(pyRows) : null
    const processed = processRows(ib.rows, prevMap, entity?.constitution, ndList || [], entity?.business_type, plClosedToCapital, plClosedToCapital, generalNotesModeC, lfRows || [], ((!prevMap && manualPyEnabled) ? new Set((manualPyEntries || []).map(e => (e.note_title || '').trim().toLowerCase()).filter(Boolean)) : null))
    processed.levelFormat = lfRows || []
    processed.pyMode = pyMode
    processed.cfsSaved = cfsSavedC || { cy: {}, py: {}, include: false }
    processed.generalNotes = withoutRatioIntro(generalNotesRaw) || { title: '', points: [] }
    if (parseInt(entity?.constitution) === 3) processed.generalNotes = withCurrentTitleDeedsText(processed.generalNotes)
    processed.consolidationBasis = { cyIds: sel.cyIds, pyIds: sel.pyIds }
    processed.prevMapL3 = pyRows.length > 0 ? buildPrevMapL3(pyRows) : null
    processed.prevRowsByLedger = pyRows.length > 0 ? buildPrevRowsByLedger(pyRows) : null
    processed.foreignLevel2 = foreignLevel2Report(cyGuard.flagged, pyFlagged, pyRows.length > 0)
    processed.interBranch = ib.summary
    processed.branchTrading = bt.summary
    processed.consolidatedDep = consolidatedDepSummary(depITData, depCompData)
    attachNoteExtras(processed, ndList, lfRows, depData, entity?.constitution, depITData, depCompData, pyRows.length > 0 ? pyRows : null)
    applyManualPyOverrides(processed, !prevMap && manualPyEnabled, manualPyEntries)
    if (parseInt(entity?.constitution) === 3) computeEpsData(processed, ndList, epsOverrides)
    processed.generalNotes = refreshRatiosInNote(processed.generalNotes, processed)
    return processed
  }

  const fetchCY = window.api?.getFinancialData(activeTB.id)
  const fetchPY = prevTB?.id
    ? window.api?.getFinancialData(prevTB.id)
    : Promise.resolve([])
  const fetchLF = entity?.constitution
    ? (window.api?.getLevelFormat(entity.constitution, activeRsId || null) || Promise.resolve([]))
    : Promise.resolve([])
  const fetchND = window.api?.listNoteDetails(activeTB.id).catch(() => [])
  const fetchDep = (window.api?.depGet?.(activeTB.id) || Promise.resolve(null)).catch(() => null)
  const fetchDepIT = (window.api?.depITGet?.(activeTB.id) || Promise.resolve(null)).catch(() => null)
  const fetchDepComp = (window.api?.depCompGet?.(activeTB.id) || Promise.resolve(null)).catch(() => null)
  const fetchManualPyEnabled = (window.api?.getManualPY?.(activeTB.id) || Promise.resolve(false)).catch(() => false)
  const fetchManualPyEntries = (window.api?.listManualPyEntries?.(activeTB.id) || Promise.resolve([])).catch(() => [])
  // Fetched fresh via IPC (not read off the activeTB/prevTB prop objects,
  // which can be stale — they're only re-fetched by the parent on its own
  // schedule, not necessarily right after this flag was just toggled).
  const fetchPlClosedCY = (window.api?.getPlClosedToCapital?.(activeTB.id) || Promise.resolve(false)).catch(() => false)
  const fetchPlClosedPY = prevTB?.id
    ? (window.api?.getPlClosedToCapital?.(prevTB.id) || Promise.resolve(false)).catch(() => false)
    : Promise.resolve(null) // no separate PY TB — resolved below from the CY flag instead
  // Basic/Diluted EPS overrides — Company only, see computeEpsData's comment.
  const fetchEps = (parseInt(entity?.constitution) === 3)
    ? (window.api?.getEps?.(activeTB.id) || Promise.resolve(null)).catch(() => null)
    : Promise.resolve(null)
  // General Notes (narrative note — see GeneralNotes/index.jsx) is always
  // exactly one note (Note 1) when it has any points; every auto-numbered
  // BS/PL note counts after it. Only resolvable when this TB is tied to a
  // real Auditee↔FY (entity_period_id) — untied/legacy TBs just get no
  // offset (0), same as having no General Notes yet.
  // For an Auditee with branches, General Notes (and its Financial Ratios) and the Cash Flow Statement are statements of the entity as a
  // whole: they appear on the Consolidated statements only, not on a single branch's.
  const entityLevelHere = !(entity?.has_branches && activeTB.id !== '__consolidated__')
  const fetchGeneralNotes = (entityLevelHere && entity?.id && activeTB.entity_period_id)
    ? (window.api?.getGeneralNotes?.(entity.id, activeTB.entity_period_id) || Promise.resolve(null)).catch(() => null)
    : Promise.resolve(null)

  const [cyRowsRaw, pyRowsRaw, lfRows, ndList, depData, depITData, depCompData, manualPyEnabledRaw, manualPyEntries, plClosedCY, plClosedPYRaw, generalNotes, epsOverrides, pyMode] =
    await Promise.all([fetchCY, fetchPY, fetchLF, fetchND, fetchDep, fetchDepIT, fetchDepComp, fetchManualPyEnabled, fetchManualPyEntries, fetchPlClosedCY, fetchPlClosedPY, fetchGeneralNotes, fetchEps, readPYMode(activeTB)])
  const pyOff = pyMode !== 'required'
  const manualPyEnabled = !pyOff && manualPyEnabledRaw
  // Cash Flow Statement (CFS tab): the Previous Year figures typed by the CA, and whether it goes into the PDF / Excel
  const cfsSaved = (entityLevelHere && entity?.id && activeTB.entity_period_id) ? await Promise.resolve(window.api?.getCfs?.(entity.id, activeTB.entity_period_id)).catch(() => null) : null
  // A Level 2 from the other statement is left out — both years alike (see ignoreForeignLevel2).
  const cyGuard = ignoreForeignLevel2(pyOff ? withoutPreviousYear(cyRowsRaw) : (cyRowsRaw || []), lfRows)
  const pyGuard = ignoreForeignLevel2(pyOff ? [] : (pyRowsRaw || []), lfRows)
  const cyRows = cyGuard.rows
  const pyRows = pyGuard.rows
  const prevMap = pyRows.length > 0 ? buildPrevMap(pyRows) : null
  // PY's own flag comes from the separate comparative TB when one is
  // selected (prevTB) — a client can close P&L to Capital in Tally for one
  // year's books without having done the same for another. With no separate
  // PY TB selected, PY is just an approximation from this same TB's own
  // opening_balance column, so it shares the CY TB's own flag.
  const skipPY = plClosedPYRaw !== null ? plClosedPYRaw : plClosedCY
  // General Notes is always exactly ONE note ("Significant Accounting
  // Policies" etc.) no matter how many internal points it has — those points
  // are lettered (a), (b), (c)... WITHIN that single note, not separate
  // top-level notes. Its own Note Number is either 1 (pushing every other
  // note down) or last (after every other note), per the CA's choice on the
  // General Notes tab. See GeneralNotes/index.jsx.
  const generalNotesMode = generalNotes?.points?.length ? (generalNotes.position === 'last' ? 'last' : 'first') : null
  const processed = processRows(cyRows, prevMap, entity?.constitution, ndList || [], entity?.business_type, plClosedCY, skipPY, generalNotesMode, lfRows || [], ((!prevMap && manualPyEnabled) ? new Set((manualPyEntries || []).map(e => (e.note_title || '').trim().toLowerCase()).filter(Boolean)) : null))
  processed.levelFormat = lfRows || []
  processed.pyMode = pyMode
  processed.cfsSaved = cfsSaved || { cy: {}, py: {}, include: false }
  processed.foreignLevel2 = foreignLevel2Report(cyGuard.flagged, pyGuard.flagged, !!prevTB?.id && !pyOff)
  processed.generalNotes = withoutRatioIntro(generalNotes) || { title: '', points: [] }
  if (parseInt(entity?.constitution) === 3) processed.generalNotes = withCurrentTitleDeedsText(processed.generalNotes)
  // Level-3 granularity PY lookup for Annexures' Balance-Sheet-side sub-note
  // groups — see buildPrevMapL3's doc comment.
  processed.prevMapL3 = pyRows.length > 0 ? buildPrevMapL3(pyRows) : null
  // Per-ledger PY lookup (real identity match, not a bucket total) — see
  // buildPrevRowsByLedger's doc comment.
  processed.prevRowsByLedger = pyRows.length > 0 ? buildPrevRowsByLedger(pyRows) : null
  attachNoteExtras(processed, ndList, lfRows, depData, entity?.constitution, depITData, depCompData, pyRows.length > 0 ? pyRows : null)
  // A separately-uploaded PY TB always wins over Manual PY — manual entries
  // only apply when there's no real prevMap to source PY figures from.
  applyManualPyOverrides(processed, !prevMap && manualPyEnabled, manualPyEntries)
  if (parseInt(entity?.constitution) === 3) computeEpsData(processed, ndList, epsOverrides)
  // The Financial Ratios table in General Notes, as of these figures — so the
  // PDF / Excel never print ratios from when the note was first created.
  processed.generalNotes = refreshRatiosInNote(processed.generalNotes, processed)
  return processed
}

export function buildEngagementFinancials(bundle) {
  if (!bundle?.entity || !Array.isArray(bundle.financialRows) || !Array.isArray(bundle.levelFormat)) {
    throw new Error('The engagement reporting data is incomplete.')
  }
  const { entity, financialRows, levelFormat, comparativeRows = [], noteDetails = [], generalNotes = null } = bundle
  const guarded = ignoreForeignLevel2(financialRows, levelFormat)
  const comparativeGuarded = ignoreForeignLevel2(comparativeRows, levelFormat)
  const prevMap = comparativeGuarded.rows.length ? buildPrevMap(comparativeGuarded.rows) : null
  const processed = processRows(
    withoutPreviousYear(guarded.rows),
    prevMap,
    entity.constitution,
    noteDetails,
    entity.business_type,
    false,
    false,
    null,
    levelFormat,
    null,
  )
  processed.levelFormat = levelFormat
  processed.pyMode = prevMap ? 'auto' : 'none_show'
  processed.cfsSaved = { cy: {}, py: {}, include: false }
  processed.foreignLevel2 = foreignLevel2Report(guarded.flagged, comparativeGuarded.flagged, Boolean(prevMap))
  processed.generalNotes = withoutRatioIntro(generalNotes) || { title: '', points: [] }
  if (parseInt(entity.constitution) === 3) processed.generalNotes = withCurrentTitleDeedsText(processed.generalNotes)
  processed.prevMapL3 = prevMap ? buildPrevMapL3(comparativeGuarded.rows) : null
  processed.prevRowsByLedger = prevMap ? buildPrevRowsByLedger(comparativeGuarded.rows) : null
  attachNoteExtras(processed, noteDetails, levelFormat, null, entity.constitution, null, null, null)
  applyManualPyOverrides(processed, !prevMap, [])
  if (parseInt(entity.constitution) === 3) computeEpsData(processed, noteDetails, comparativeGuarded.rows)
  processed.generalNotes = refreshRatiosInNote(processed.generalNotes, processed)
  return processed
}

export function useFinancials(activeTB, prevTB, entity = null, activeRsId = null) {
  const [data, setData]         = useState(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  // Bumping refreshTick re-runs the fetch effect — used after any mapping
  // change so BS/PL/Notes/Annexures reflect the latest DB state instantly.
  const [refreshTick, setRefreshTick] = useState(0)
  const refresh = React.useCallback(() => setRefreshTick(t => t + 1), [])
  // Only clear the already-loaded `data` (which is what makes callers show a
  // blocking "Loading..." placeholder — see Notes/index.jsx's Guard) when the
  // TB/entity/rule-set itself changed. A refresh() of the SAME one — e.g.
  // after saving a single Manual PY figure — keeps the current data on
  // screen while reloading in the background, instead of unmounting the
  // whole notes list (and losing scroll position / expanded state) on every
  // single-field save.
  const identityKey = `${activeTB?.id ?? ''}|${prevTB?.id ?? ''}|${entity?.constitution ?? ''}|${activeRsId ?? ''}|${activeTB?.consKey ?? ''}`
  const lastIdentityRef = React.useRef(identityKey)

  useEffect(() => {
    if (!activeTB?.id) { setData(null); lastIdentityRef.current = identityKey; return }
    if (lastIdentityRef.current !== identityKey) { setData(null); lastIdentityRef.current = identityKey }
    setLoading(true); setError('')
    fetchFinancialsData(activeTB, prevTB, entity, activeRsId)
      .then(setData)
      .catch(err => setError(err?.message || 'Failed to load financial data.'))
      .finally(() => setLoading(false))
  }, [activeTB?.id, activeTB?.entity_period_id, activeTB?.consKey, prevTB?.id, entity?.constitution, activeRsId, refreshTick])

  return { data, loading, error, refresh }
}

// ── Consolidated financials hook (all branch TBs for an entity) ───────────────
export function useConsolidatedFinancials(entity, activeRsId, entityPeriodId = null, consKey = 0) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  useEffect(() => {
    if (!entity?.id) { setData(null); return }
    setLoading(true); setError('')

    // Same Trial Balances as fetchFinancialsData's Consolidated path (current Financial Year's; previous year's for the Previous Year)
    const fetchCY = resolveConsolidationSelection(entity.id, entityPeriodId).then(async (sel) => {
      const cur = (await window.api?.getConsolidatedData(entity.id, sel.cyIds)) || []
      const prev = sel.pyIds.length ? ((await window.api?.getConsolidatedData(entity.id, sel.pyIds)) || []) : []
      return { cur, prev }
    })
    const fetchLF = entity?.constitution
      ? (window.api?.getLevelFormat(entity.constitution, activeRsId || null) || Promise.resolve([]))
      : Promise.resolve([])
    const fetchND = window.api?.listEntityNoteDetails(entity.id).catch(() => [])
    const fetchDep = Promise.resolve(null)
    const fetchDepIT = Promise.resolve(null)
    const fetchDepComp = Promise.resolve(null)
    // Manual PY for the Consolidated view — entity-scoped mirror of the
    // per-TB flag/entries (see schema.js's entity_manual_py_entries). There
    // is no separate "Consolidated PY Trial Balance" concept, so unlike
    // fetchFinancialsData's `!prevMap &&` guard, this applies whenever it's
    // turned on — nothing else could source Consolidated PY figures anyway.
    const fetchManualPyEnabled = (window.api?.getEntityManualPY?.(entity.id) || Promise.resolve(false)).catch(() => false)
    const fetchManualPyEntries = (window.api?.listEntityManualPyEntries?.(entity.id) || Promise.resolve([])).catch(() => [])
    const fetchPlClosedToCapital = (window.api?.getEntityPlClosedToCapital?.(entity.id) || Promise.resolve(false)).catch(() => false)
    // Basic/Diluted EPS overrides — Company only, see computeEpsData's comment.
    const fetchEps = (parseInt(entity?.constitution) === 3)
      ? (window.api?.getEntityEps?.(entity.id) || Promise.resolve(null)).catch(() => null)
      : Promise.resolve(null)

    const fetchGN = (entity.id && entityPeriodId) ? Promise.resolve(window.api?.getGeneralNotes?.(entity.id, entityPeriodId)).catch(() => null) : Promise.resolve(null)
    const fetchCfsC = (entity.id && entityPeriodId) ? Promise.resolve(window.api?.getCfs?.(entity.id, entityPeriodId)).catch(() => null) : Promise.resolve(null)

    Promise.all([fetchCY, fetchLF, fetchND, fetchDep, fetchDepIT, fetchDepComp, fetchManualPyEnabled, fetchManualPyEntries, fetchPlClosedToCapital, fetchEps, fetchGN, fetchCfsC])
      .then(([cyBoth, lfRows, ndList, depData, depITData, depCompData, manualPyEnabled, manualPyEntries, plClosedToCapital, epsOverrides, generalNotesRaw, cfsSavedC]) => {
        ;({ depITData, depCompData } = consolidatedDepFromNoteDetails(ndList))   // entity-level schedules
        const cyRows = cyBoth.cur
        const cyGuard = ignoreForeignLevel2(cyRows, lfRows)
        const bt = eliminateNilBranchTrading(cyGuard.rows)
        const ib = eliminateInterBranch(bt.rows)
        const pyGuard = ignoreForeignLevel2(cyBoth.prev, lfRows)
        const pyRows = cyBoth.prev.length ? eliminateInterBranch(eliminateNilBranchTrading(pyGuard.rows).rows).rows : []
        const prevMap = pyRows.length > 0 ? buildPrevMap(pyRows) : null
        const generalNotesModeC = generalNotesRaw?.points?.length ? (generalNotesRaw.position === 'last' ? 'last' : 'first') : null
        const processed = processRows(ib.rows, prevMap, entity?.constitution, ndList || [], entity?.business_type, plClosedToCapital, plClosedToCapital, generalNotesModeC, lfRows || [], ((!prevMap && manualPyEnabled) ? new Set((manualPyEntries || []).map(e => (e.note_title || '').trim().toLowerCase()).filter(Boolean)) : null))
        processed.levelFormat = lfRows || []
        processed.cfsSaved = cfsSavedC || { cy: {}, py: {}, include: false }
        processed.generalNotes = withoutRatioIntro(generalNotesRaw) || { title: '', points: [] }
        if (parseInt(entity?.constitution) === 3) processed.generalNotes = withCurrentTitleDeedsText(processed.generalNotes)
        processed.foreignLevel2 = foreignLevel2Report(cyGuard.flagged, pyGuard.flagged, pyRows.length > 0)
        processed.prevMapL3 = pyRows.length > 0 ? buildPrevMapL3(pyRows) : null
        processed.prevRowsByLedger = pyRows.length > 0 ? buildPrevRowsByLedger(pyRows) : null
        processed.interBranch = ib.summary
        processed.branchTrading = bt.summary
        processed.consolidatedDep = consolidatedDepSummary(depITData, depCompData)
        const savedDataFor = indexSavedNoteRows(ndList, parsedNoteData)
        for (const note of Object.values(processed.notes)) {
          if (!note.isPL) {
            const noteData = savedDataFor(note)
            const allRows = buildNoteTemplateRows(note, lfRows || [], depData, noteData, noteData)
            note.templateRowsAll = allRows
            note.templateRows    = allRows.filter(r => r.total !== 0 || r.prevTotal !== 0)
            const isPPE = /property.*plant.*equipment|PPE|fixed assets/i.test(note.title || '')
            if (isPPE && depITData?.includeInPPENote && Array.isArray(depITData.blockSummary) && depITData.blockSummary.length) {
              note.itBlockSummaryData = depITData.blockSummary
              const pyTotals = extractItBlockSummaryPyTotals(depITData.pyTotals)
              if (pyTotals) {
                note.itBlockSummaryPyTotals = pyTotals
              }
              const wip = extractItWip(depITData.wip)
              if (wip) note.itWip = wip
            }
            if (isPPE && depCompData?.includeInPPENote && Array.isArray(depCompData.categoryRows) && depCompData.categoryRows.length) {
              note.compScheduleData = depCompData.categoryRows
              const compPyTotals = extractCompSchedulePyTotals(depCompData.pyTotals)
              if (compPyTotals) {
                note.compSchedulePyTotals = compPyTotals
              }
            }
          }
        }
        // Must run AFTER templateRows are built above (same ordering
        // fetchFinancialsData uses: attachNoteExtras then this) — it
        // overlays onto those row objects (manualPyEditable/py), which don't
        // exist until the loop above has run.
        applyManualPyOverrides(processed, !prevMap && manualPyEnabled, manualPyEntries)
        if (parseInt(entity?.constitution) === 3) computeEpsData(processed, ndList, epsOverrides)
        processed.generalNotes = refreshRatiosInNote(processed.generalNotes, processed)
        setData(processed)
      })
      .catch(err => setError(err?.message || 'Failed to load consolidated financial data.'))
      .finally(() => setLoading(false))
  }, [entity?.id, entity?.constitution, activeRsId, entityPeriodId, consKey])

  return { data, loading, error }
}
