/**
 * Depreciation — Income Tax Act, 1961 (Block-wise WDV) — "Dep (IT)"
 *
 * Separate module from the existing "Dep" tab (Useful Life / Schedule II
 * basis, left untouched). Every ledger mapped to Property, Plant & Equipment
 * or Intangible Assets in the Mapped TB is auto-listed as a row here; the
 * preparer assigns each ledger to an IT Act Block (rate auto-fills) and
 * enters Opening WDV / Additions / Deduction per ledger. Depreciation is a
 * BLOCK concept under Section 32 — not a per-asset one — so Depreciation,
 * Closing WDV, STCL/STCG and the reconciliation Difference are computed and
 * shown on each Block's subtotal row, aggregating its ledger rows.
 *
 * COMPANIES (constitution 3): a company already maps its fixed-asset ledgers
 * for the Companies Act schedule (Dep (Comp)), and mapping every ledger a second
 * time for the Income Tax blocks is impracticable. So for a company this screen
 * lists NO ledgers: the preparer adds blank rows and fills each in, choosing the
 * Block from a drop-down of every block (1 Oct 2026). The Block / Opening WDV /
 * Additions / Deduction maths and the Block Summary are the same.
 *
 * A second tab ("Block Summary") shows just the block-level totals, with an
 * opt-in checkbox to surface that same summary inside the PPE Note — see
 * note.itBlockSummaryData wiring in useFinancials.js / Notes / buildHTML /
 * buildExcel.
 */
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import * as XLSX from 'xlsx-js-style'
import { fmtINR } from '../../hooks/useFinancials'
import { depStoreFor, EMPTY_WIP, wipHasFigures, wipCYTotal } from '../../utils/depStore'
import { joinDepITSchedules } from '../../utils/depJoin'
import { buildDepITBlankTemplate, buildDepITFilledWorkbook, parseDepITWorkbook } from './depITWorkbook'

// ── Style constants (matches Depreciation/index.jsx) ─────────────────────────
const INP  = 'w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white'
const NINP = INP + ' text-right font-mono'
const DINP = 'w-full border border-gray-200 rounded px-1.5 py-0.5 text-xs bg-gray-100 text-gray-500 text-right font-mono cursor-not-allowed'
const TDI  = 'border border-gray-200 px-1 py-0.5'
const TD   = 'border border-gray-200 px-1.5 py-1 text-right text-xs font-mono'

// The Previous Year row's 7 inputs (unlike the per-ledger cells elsewhere in
// this screen) are plain text fields with no browser-level numeric
// restriction, so typing an Indian-grouped figure like "12,288" is natural
// and unblocked — but parseFloat("12,288") stops at the first comma and
// returns 12, silently truncating every comma-containing entry to just its
// leading digits. Strip thousands separators before parsing so both
// "12288" and "12,288" (and "1,98,174" lakh-style grouping) parse the same.
const num = v => parseFloat(String(v ?? '').replace(/,/g, '')) || 0
const ADD_NEW = '__add_new__'
const ZERO_TOL = 0.005
// Rows synthesized by "Pull from Branches" (Consolidated only) carry this
// prefix, so a later pull can refresh just them without touching a row the
// preparer typed by hand via "+ Add asset row".
const BRANCH_PULL_PREFIX = '[Branch Total] '

// Rows a company adds by hand are keyed "Row 1", "Row 2" … and carry an optional
// description (inputs[key].label). A saved row shows its label, else its key unless
// the key is one of those automatic ones.
const AUTO_ROW = /^Row \d+$/
const rowHasData = (inp) => !!inp && !!(inp.block || num(inp.openingWDV) || num(inp.addBefore180) || num(inp.addAfter180) || num(inp.deduction) || (inp.label || '').trim())
const displayName = (name, inp) => (inp && inp.label != null) ? inp.label : (AUTO_ROW.test(name) ? '' : name)

function emptyLedgerInput() {
  return { block: '', openingWDV: '', addBefore180: '', addAfter180: '', deduction: '' }
}

// Manual Previous Year totals shape — every enterable Editor/Block Summary
// column except Amt-as-per-TB/Difference (CY-TB-specific/derived, N/A to a
// manually-entered PY figure).
const EMPTY_PY_TOTALS = {
  openingWDV: '', addBefore180: '', addAfter180: '', deduction: '',
  stclStcg: '', depreciation: '', closingWDV: '',
}
const pyTotalsNonZero = (py) => !!py && Object.values(py).some(v => num(v) !== 0)

// A ledger is safe to hide behind "Hide zero-balance ledgers" only if it has
// BOTH a nil Trial Balance amount AND no entered data of its own — never hide
// a row the preparer has already worked on, even if its book balance is nil
// (e.g. a fully-depreciated/sold asset that still needs block-level entries).
function isEffectivelyEmpty(ledger, inputs) {
  const inp = inputs[ledger.ledger_name]
  const hasData = inp && (inp.block || num(inp.openingWDV) || num(inp.addBefore180) || num(inp.addAfter180) || num(inp.deduction))
  return Math.abs(ledger.tbAmount) < ZERO_TOL && !hasData
}

// ── Block-level WDV computation (Section 32) ──────────────────────────────────
// Sec. 32(1), second proviso: an asset used for 180 days or more in the year
// of acquisition gets the FULL rate; one used for LESS than 180 days gets
// only HALF the rate. (Bug fixed here: this used to be backwards — the
// <180-day bucket was pooled at full rate and the >=180-day bucket at half
// rate, the opposite of the law and of the footnote this screen already
// printed. Column labels/headers and the stored field names were always
// correct — addBefore180 genuinely means "additions used <180 days" and
// addAfter180 "additions used >=180 days" — only which rate pool each fed
// into was swapped. Deliberately NOT renaming the fields: they are the
// stored JSON keys for every already-entered dep_it_schedules row, and
// renaming would silently orphan a client's existing Opening WDV/Additions
// entries on upgrade.)
//
// Deduction offsets Opening + Additions>=180-days (full-rate bucket) first;
// any deduction left over after that then offsets Additions<180-days
// (half-rate bucket). If total block value before depreciation goes negative,
// the block has been over-sold relative to its WDV — that shortfall is a
// short-term capital gain (STCG) under Sec. 50, depreciation is Nil, and
// Closing WDV is floored at 0.
//
// NOTE: a block can also generate an STCL, but only when EVERY asset in the
// block has been sold/discarded (the block "ceases to exist") even though
// its WDV was still positive — that fact can't be inferred from ledger data
// alone, so STCL/STCG is auto-suggested only for the unambiguous STCG case
// above and is otherwise left to the preparer to enter/override.
function computeBlockTotals(block, agg) {
  const rate = num(block.rate)
  const { openingWDV, addBefore180, addAfter180, deduction } = agg
  const fullRatePool = openingWDV + addAfter180
  const fullRateBase = Math.max(0, fullRatePool - deduction)
  const remainingDeduction = Math.max(0, deduction - fullRatePool)
  const halfRateBase = Math.max(0, addBefore180 - remainingDeduction)
  const blockValueBeforeDep = openingWDV + addBefore180 + addAfter180 - deduction

  if (blockValueBeforeDep < 0) {
    return { depreciation: 0, closingWDV: 0, autoStclStcg: blockValueBeforeDep /* negative = STCG */ }
  }
  const depreciation = fullRateBase * (rate / 100) + halfRateBase * (rate / 100) * 0.5
  // Rounded off to the nearest rupee — no paise carried in the Depreciation
  // (or the Closing WDV derived from it); fmtINR still prints it as "45,000.00"
  // for the usual two-decimal look of every other figure on the statements.
  const roundedDep = Math.round(depreciation)
  const closingWDV = Math.max(0, Math.round(blockValueBeforeDep - roundedDep))
  return { depreciation: roundedDep, closingWDV, autoStclStcg: 0 }
}

// ── Add Block inline form ──────────────────────────────────────────────────
function AddBlockForm({ majorCategories, onSave, onCancel }) {
  const [majorCategory, setMajorCategory] = useState(majorCategories[0] || '')
  const [customCategory, setCustomCategory] = useState('')
  const [blockName, setBlockName] = useState('')
  const [rate, setRate] = useState('')
  const [err, setErr] = useState('')

  const submit = () => {
    const cat = majorCategory === ADD_NEW ? customCategory.trim() : majorCategory
    if (!cat) return setErr('Pick or enter a Major Category.')
    if (!blockName.trim()) return setErr('Enter a Block name.')
    const r = parseFloat(rate)
    if (isNaN(r) || r < 0 || r > 100) return setErr('Rate must be between 0 and 100.')
    setErr('')
    onSave({ majorCategory: cat, blockName: blockName.trim(), rate: r })
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-5 w-96 space-y-3">
        <h3 className="text-sm font-bold text-gray-800">Add New IT Block</h3>
        <div>
          <label className="text-[11px] text-gray-500 font-medium">Major Category</label>
          <select className={INP} value={majorCategory} onChange={e => setMajorCategory(e.target.value)}>
            {majorCategories.map(c => <option key={c} value={c}>{c}</option>)}
            <option value={ADD_NEW}>+ New Major Category…</option>
          </select>
          {majorCategory === ADD_NEW && (
            <input className={INP + ' mt-1.5'} value={customCategory}
              onChange={e => setCustomCategory(e.target.value)}
              placeholder="e.g. V. AIRCRAFT" />
          )}
        </div>
        <div>
          <label className="text-[11px] text-gray-500 font-medium">Block Name</label>
          <input className={INP} value={blockName} onChange={e => setBlockName(e.target.value)}
            placeholder="e.g. Aircraft / Helicopters" />
        </div>
        <div>
          <label className="text-[11px] text-gray-500 font-medium">Rate of Depreciation (WDV) %</label>
          <input className={NINP} type="number" step="0.01" value={rate} onChange={e => setRate(e.target.value)} />
        </div>
        {err && <p className="text-[11px] text-red-600 font-medium">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onCancel} className="px-3 py-1.5 text-xs border border-gray-300 rounded text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={submit} className="px-3 py-1.5 text-xs text-white rounded font-medium" style={{ background: 'var(--color-primary)' }}>Save Block</button>
        </div>
      </div>
    </div>
  )
}

// ── Ledger row ─────────────────────────────────────────────────────────────
function LedgerRow({ ledger, input, blocks, onChange, onAddBlockRequested, company = false, onRemove = null }) {
  const block = blocks.find(b => b.id === input.block)
  const majorCats = company ? [...new Set(blocks.map(b => b.majorCategory))] : []
  const handleBlockSelect = (val) => {
    if (val === ADD_NEW) { onAddBlockRequested(ledger.ledger_name); return }
    onChange({ ...input, block: val })
  }
  return (
    <tr className="hover:bg-blue-50/20">
      <td className={TDI}>
        {company ? (
          <div className="flex items-center gap-1">
            <input className={INP} value={displayName(ledger.ledger_name, input)} placeholder="Description (optional)"
              onChange={e => onChange({ ...input, label: e.target.value })} />
            {onRemove && <button type="button" onClick={onRemove} title="Remove this row" className="text-red-400 hover:text-red-600 text-xs px-1">✕</button>}
          </div>
        ) : <span className="text-xs text-gray-700">{ledger.ledger_name}</span>}
      </td>
      <td className={TDI} style={{ minWidth: 220 }}>
        <select className={INP} value={input.block} onChange={e => handleBlockSelect(e.target.value)}>
          <option value="">— Select Block —</option>
          {company
            ? majorCats.map(c => (
                <optgroup key={c} label={c}>
                  {blocks.filter(b => b.majorCategory === c).map(b => <option key={b.id} value={b.id}>{b.block}</option>)}
                </optgroup>
              ))
            : blocks.map(b => <option key={b.id} value={b.id}>{b.block}</option>)}
          <option value={ADD_NEW}>+ Add New Block…</option>
        </select>
      </td>
      <td className={TD + ' text-gray-500'}>{block ? `${block.rate}%` : '—'}</td>
      <td className={TDI}><input className={NINP} type="number" value={input.openingWDV} onChange={e => onChange({ ...input, openingWDV: e.target.value })} /></td>
      <td className={TDI}><input className={NINP} type="number" value={input.addBefore180} onChange={e => onChange({ ...input, addBefore180: e.target.value })} /></td>
      <td className={TDI}><input className={NINP} type="number" value={input.addAfter180} onChange={e => onChange({ ...input, addAfter180: e.target.value })} /></td>
      <td className={TDI}><input className={NINP} type="number" value={input.deduction} onChange={e => onChange({ ...input, deduction: e.target.value })} /></td>
      <td className={TD + ' text-gray-300'}>—</td>
      <td className={TD + ' text-gray-300'}>—</td>
      <td className={TD + ' text-gray-300'}>—</td>
      <td className={TD + (company ? ' text-gray-300' : ' bg-gray-50')}>{company ? '—' : fmtINR(ledger.tbAmount)}</td>
      <td className={TD + ' text-gray-300'}>—</td>
    </tr>
  )
}

// ── Block subtotal row (Editor tab — reads live inputs directly) ───────────
function BlockTotalRow({ block, ledgerRows, inputs, stclOverride, onStclChange, company = false }) {
  const agg = ledgerRows.reduce((s, l) => {
    const inp = inputs[l.ledger_name] || emptyLedgerInput()
    return {
      openingWDV:   s.openingWDV   + num(inp.openingWDV),
      addBefore180: s.addBefore180 + num(inp.addBefore180),
      addAfter180:  s.addAfter180  + num(inp.addAfter180),
      deduction:    s.deduction    + num(inp.deduction),
      tbAmount:     s.tbAmount     + num(l.tbAmount),
    }
  }, { openingWDV: 0, addBefore180: 0, addAfter180: 0, deduction: 0, tbAmount: 0 })

  const { depreciation, closingWDV, autoStclStcg } = computeBlockTotals(block, agg)
  const stclStcg = stclOverride !== undefined && stclOverride !== '' ? num(stclOverride) : autoStclStcg
  const difference = closingWDV - agg.tbAmount

  return (
    <tr className="bg-indigo-50 font-semibold text-xs">
      <td colSpan={2} className="border border-indigo-200 px-2 py-1.5 text-indigo-900">{block.block} — Total</td>
      <td className="border border-indigo-200 px-1.5 py-1 text-right font-mono text-indigo-700">{block.rate}%</td>
      <td className="border border-indigo-200 px-1.5 py-1 text-right font-mono">{fmtINR(agg.openingWDV)}</td>
      <td className="border border-indigo-200 px-1.5 py-1 text-right font-mono">{fmtINR(agg.addBefore180)}</td>
      <td className="border border-indigo-200 px-1.5 py-1 text-right font-mono">{fmtINR(agg.addAfter180)}</td>
      <td className="border border-indigo-200 px-1.5 py-1 text-right font-mono">{fmtINR(agg.deduction)}</td>
      <td className="border border-indigo-200 px-1 py-0.5">
        <input className={NINP} type="number" value={stclOverride ?? (autoStclStcg ? autoStclStcg.toFixed(2) : '')}
          onChange={e => onStclChange(e.target.value)}
          title="Negative = STCG (auto-suggested when block value goes negative on sale). Positive = STCL — only valid if the whole block ceased to exist; enter manually." />
      </td>
      <td className="border border-indigo-200 px-1.5 py-1 text-right font-mono text-red-700">{fmtINR(depreciation)}</td>
      <td className="border border-indigo-200 px-1.5 py-1 text-right font-mono text-orange-800">{fmtINR(closingWDV)}</td>
      {/* A company's IT blocks are entered on their own — nothing in the books to reconcile against. */}
      <td className="border border-indigo-200 px-1.5 py-1 text-right font-mono">{company ? '—' : fmtINR(agg.tbAmount)}</td>
      <td className={`border border-indigo-200 px-1.5 py-1 text-right font-mono ${company ? 'text-gray-300' : Math.abs(difference) < 1 ? 'text-green-700' : 'text-red-700'}`}>
        {company ? '—' : fmtINR(difference)}
      </td>
    </tr>
  )
}

// ── Block Summary tab — read-only, one row per block, plus PPE-note opt-in ──
function BlockSummaryTab({ summaryRows, includeInPPENote, onToggleInclude, entity, pyTotals, wip, company = false }) {
  const totals = summaryRows.reduce((s, b) => ({
    openingWDV: s.openingWDV + b.openingWDV,
    additions: s.additions + b.addBefore180 + b.addAfter180,
    deduction: s.deduction + b.deduction,
    depreciation: s.depreciation + b.depreciation,
    closingWDV: s.closingWDV + b.closingWDV,
    tbAmount: s.tbAmount + b.tbAmount,
  }), { openingWDV: 0, additions: 0, deduction: 0, depreciation: 0, closingWDV: 0, tbAmount: 0 })
  const totalDiff = totals.closingWDV - totals.tbAmount

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-bold text-gray-700">Block-wise Summary — Income Tax Act, 1961</h3>
      </div>

      {summaryRows.length === 0 ? (
        <div className="p-8 text-center text-gray-400 italic">
          No Blocks assigned yet — go to the Editor tab and {company ? 'add a row and choose its Block' : 'assign at least one ledger to a Block'}.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="border-collapse text-xs w-full">
              <thead>
                <tr className="bg-indigo-800 text-white text-[10px]">
                  <th className="border border-indigo-700 px-2 py-1.5 text-left">Major Category</th>
                  <th className="border border-indigo-700 px-2 py-1.5 text-left">Block of Assets</th>
                  <th className="border border-indigo-700 px-2 py-1.5 text-right">Rate</th>
                  <th className="border border-indigo-700 px-2 py-1.5 text-right">Opening WDV</th>
                  <th className="border border-indigo-700 px-2 py-1.5 text-right">Additions</th>
                  <th className="border border-indigo-700 px-2 py-1.5 text-right">Deduction</th>
                  <th className="border border-indigo-700 px-2 py-1.5 text-right">STCL/(STCG)</th>
                  <th className="border border-indigo-700 px-2 py-1.5 text-right">Depreciation</th>
                  <th className="border border-indigo-700 px-2 py-1.5 text-right">Closing WDV</th>
                  <th className="border border-indigo-700 px-2 py-1.5 text-right">Amt as per TB</th>
                  <th className="border border-indigo-700 px-2 py-1.5 text-right">Difference</th>
                </tr>
              </thead>
              <tbody>
                {summaryRows.map((b, i) => (
                  <tr key={b.blockId} className={i % 2 === 0 ? 'bg-white' : 'bg-indigo-50/30'}>
                    <td className="border border-gray-200 px-2 py-1 text-[10px] text-gray-500">{b.majorCategory}</td>
                    <td className="border border-gray-200 px-2 py-1">{b.block}</td>
                    <td className={TD + ' text-gray-600'}>{b.rate}%</td>
                    <td className={TD}>{fmtINR(b.openingWDV)}</td>
                    <td className={TD}>{fmtINR(b.addBefore180 + b.addAfter180)}</td>
                    <td className={TD}>{fmtINR(b.deduction)}</td>
                    <td className={TD}>{fmtINR(b.stclStcg)}</td>
                    <td className={TD + ' text-red-700 font-medium'}>{fmtINR(b.depreciation)}</td>
                    <td className={TD + ' text-orange-800 font-semibold'}>{fmtINR(b.closingWDV)}</td>
                    <td className={TD}>{company ? '—' : fmtINR(b.tbAmount)}</td>
                    <td className={`${TD} ${company ? 'text-gray-300' : Math.abs(b.difference) < 1 ? 'text-green-700' : 'text-red-700'}`}>{company ? '—' : fmtINR(b.difference)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-indigo-900 text-white font-bold text-xs">
                  <td colSpan={3} className="border border-indigo-800 px-2 py-1.5">GRAND TOTAL</td>
                  <td className="border border-indigo-800 px-2 py-1 text-right font-mono">{fmtINR(totals.openingWDV)}</td>
                  <td className="border border-indigo-800 px-2 py-1 text-right font-mono">{fmtINR(totals.additions)}</td>
                  <td className="border border-indigo-800 px-2 py-1 text-right font-mono">{fmtINR(totals.deduction)}</td>
                  <td className="border border-indigo-800 px-2 py-1"></td>
                  <td className="border border-indigo-800 px-2 py-1 text-right font-mono">{fmtINR(totals.depreciation)}</td>
                  <td className="border border-indigo-800 px-2 py-1 text-right font-mono">{fmtINR(totals.closingWDV)}</td>
                  <td className="border border-indigo-800 px-2 py-1 text-right font-mono">{company ? '—' : fmtINR(totals.tbAmount)}</td>
                  <td className="border border-indigo-800 px-2 py-1 text-right font-mono">{company ? '—' : fmtINR(totalDiff)}</td>
                </tr>
                {pyTotalsNonZero(pyTotals) && (
                  <tr className="bg-gray-100 text-xs">
                    <td colSpan={3} className="border border-gray-300 px-2 py-1.5 font-semibold text-gray-600">Previous Year</td>
                    <td className="border border-gray-300 px-2 py-1 text-right font-mono">{fmtINR(pyTotals.openingWDV)}</td>
                    <td className="border border-gray-300 px-2 py-1 text-right font-mono">{fmtINR(num(pyTotals.addBefore180) + num(pyTotals.addAfter180))}</td>
                    <td className="border border-gray-300 px-2 py-1 text-right font-mono">{fmtINR(pyTotals.deduction)}</td>
                    <td className="border border-gray-300 px-2 py-1 text-right font-mono">{fmtINR(pyTotals.stclStcg)}</td>
                    <td className="border border-gray-300 px-2 py-1 text-right font-mono">{fmtINR(pyTotals.depreciation)}</td>
                    <td className="border border-gray-300 px-2 py-1 text-right font-mono">{fmtINR(pyTotals.closingWDV)}</td>
                    <td className="border border-gray-300 px-2 py-1"></td>
                    <td className="border border-gray-300 px-2 py-1"></td>
                  </tr>
                )}
                {/* Capital WIP / Intangible WIP — no depreciation is charged on assets
                    still under construction/development, so these are manually entered
                    (Editor tab) rather than derived from a Block. Hidden entirely, along
                    with the combined grand total below, whenever nothing has been entered. */}
                {wipHasFigures(wip) && (
                  <>
                    <tr className="bg-amber-50 text-xs">
                      <td colSpan={8} className="border border-gray-300 px-2 py-1.5 text-gray-600">Capital Work in Progress</td>
                      <td className="border border-gray-300 px-2 py-1 text-right font-mono">{fmtINR(wip.capitalCY)}</td>
                      <td className="border border-gray-300 px-2 py-1" colSpan={2}></td>
                    </tr>
                    <tr className="bg-amber-50 text-xs">
                      <td colSpan={8} className="border border-gray-300 px-2 py-1.5 text-gray-600">Intangible Work in Progress</td>
                      <td className="border border-gray-300 px-2 py-1 text-right font-mono">{fmtINR(wip.intangibleCY)}</td>
                      <td className="border border-gray-300 px-2 py-1" colSpan={2}></td>
                    </tr>
                    <tr className="bg-amber-100 text-xs font-semibold">
                      <td colSpan={8} className="border border-gray-300 px-2 py-1.5 text-gray-700">Total (Work in Progress)</td>
                      <td className="border border-gray-300 px-2 py-1 text-right font-mono">{fmtINR(wipCYTotal(wip))}</td>
                      <td className="border border-gray-300 px-2 py-1" colSpan={2}></td>
                    </tr>
                    <tr className="bg-gray-100 text-xs">
                      <td colSpan={8} className="border border-gray-300 px-2 py-1.5 font-semibold text-gray-600">Previous Year (Work in Progress)</td>
                      <td className="border border-gray-300 px-2 py-1 text-right font-mono">{fmtINR(wip.prevYearTotal)}</td>
                      <td className="border border-gray-300 px-2 py-1" colSpan={2}></td>
                    </tr>
                    <tr className="bg-indigo-900 text-white font-bold text-xs">
                      <td colSpan={8} className="border border-indigo-800 px-2 py-1.5">Total PPE &amp; Intangible Assets including work in progress</td>
                      <td className="border border-indigo-800 px-2 py-1 text-right font-mono">{fmtINR(totals.closingWDV + wipCYTotal(wip))}</td>
                      <td className="border border-indigo-800 px-2 py-1" colSpan={2}></td>
                    </tr>
                    <tr className="bg-gray-100 text-xs italic">
                      <td colSpan={8} className="border border-gray-300 px-2 py-1.5 text-gray-600">Previous Year</td>
                      <td className="border border-gray-300 px-2 py-1 text-right font-mono text-gray-700">{fmtINR(num(pyTotals.closingWDV) + num(wip.prevYearTotal))}</td>
                      <td className="border border-gray-300 px-2 py-1" colSpan={2}></td>
                    </tr>
                  </>
                )}
              </tfoot>
            </table>
          </div>

          <label className="flex items-start gap-2 bg-orange-50 border border-orange-200 rounded p-3 text-xs text-orange-900 cursor-pointer max-w-2xl">
            <input type="checkbox" className="mt-0.5" checked={includeInPPENote} onChange={e => onToggleInclude(e.target.checked)} />
            <span>
              <strong>Include this Block Summary in the PPE Note disclosure.</strong> When checked and saved, this
              table appears inside the "Property, Plant & Equipment and Intangible Assets" note — in the Notes tab,
              the Excel export, and the PDF export. Uncheck and save to remove it again.
            </span>
          </label>
        </>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────
export default function DepreciationIT({ entity, activeTB }) {
  // Per-branch schedule (keyed by TB) or the entity-wide "Consolidated" one —
  // see utils/depStore.js. Consolidated mode has no Mapped-TB ledgers to link:
  // the preparer adds named asset rows (or uploads the Filled form) instead.
  const store = depStoreFor(activeTB, entity, 'it')
  // A company enters its IT blocks by hand — no ledger mapping (see the header comment).
  const isCompany = parseInt(entity?.constitution) === 3 && !store.consolidated
  const manualRows = store.consolidated || isCompany   // rows are typed in, not taken from the Mapped TB
  const [masterBlocks, setMasterBlocks] = useState([])
  const [customBlocks, setCustomBlocks] = useState([])
  const [ledgers, setLedgers]     = useState([])
  const [inputs, setInputs]       = useState({})   // ledgerName → { block, openingWDV, addBefore180, addAfter180, deduction }
  const [stclOverrides, setStclOverrides] = useState({}) // blockId → string
  const [includeInPPENote, setIncludeInPPENote] = useState(false)
  // Manually-entered Previous Year totals (Total only — not per-Block), shown
  // as one blank row below the Grand Total in both the Editor and Block
  // Summary tabs, and flowed into the PPE note alongside the CY block summary.
  const [pyTotals, setPyTotals] = useState({ ...EMPTY_PY_TOTALS })
  // Manual Capital WIP / Intangible WIP figures — see utils/depStore.js's
  // wipHasFigures doc comment. wipOpen is UI-only (not persisted): it just
  // reveals the entry rows in the Editor tab before anything's been typed,
  // so the section isn't permanently invisible with no way to start filling it.
  const [wip, setWip] = useState({ ...EMPTY_WIP })
  const [wipOpen, setWipOpen] = useState(false)
  const [hideZeroBalance, setHideZeroBalance] = useState(true)
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [toast, setToast]         = useState('')
  const [activeTab, setActiveTab] = useState('editor')
  const [addBlockFor, setAddBlockFor] = useState(null) // ledgerName pending block assignment, or 'menu' for no target
  const [pulling, setPulling] = useState(false)
  // Set by uploadFilled() / handleToggleInclude() to trigger an auto-save on
  // the next render once `inputs`/`includeInPPENote` (and the blockSummaryRows
  // memo derived from them) have actually updated — see the effect below.
  const pendingAutoSaveRef = useRef(false)

  const tbId = activeTB?.id
  const showToast = msg => { setToast(msg); setTimeout(() => setToast(''), 3500) }

  const blocks = useMemo(() => [...masterBlocks, ...customBlocks], [masterBlocks, customBlocks])
  const majorCategories = useMemo(
    () => [...new Set(blocks.map(b => b.majorCategory))],
    [blocks]
  )

  // Custom block ids come back from SQLite as numbers, but <select> option
  // values are always strings — normalise to string so `id === input.block`
  // comparisons never silently fail after a fresh page load.
  const loadBlocks = useCallback(async () => {
    const [master, custom] = await Promise.all([
      window.api?.depITBlocksMaster() || [],
      entity?.id ? window.api?.depITBlocksCustom(entity.id) : [],
    ])
    setMasterBlocks(master || [])
    setCustomBlocks((custom || []).map(b => ({ ...b, id: String(b.id) })))
  }, [entity?.id])

  useEffect(() => { loadBlocks() }, [loadBlocks])

  useEffect(() => {
    if (!tbId) { setLoading(false); return }
    setLoading(true)
    Promise.all([
      manualRows ? Promise.resolve([]) : window.api?.depITGetLedgers(tbId),
      store.get(),
    ]).then(([ledgerRows, saved]) => {
      // A company's old saved rows are its former mapped ledgers: the ones with
      // something entered stay (nothing is lost), the empty ones are dropped.
      const mapped = manualRows
        ? Object.keys(saved?.rows || {}).filter(name => !isCompany || rowHasData(saved.rows[name])).map(name => ({ ledger_name: name, m3_name: '', tbAmount: 0 }))
        : (ledgerRows || []).map(l => ({
            ledger_name: l.ledger_name,
            m3_name: l.m3_name,
            tbAmount: l.is_deemed_positive ? -(parseFloat(l.balance) || 0) : (parseFloat(l.balance) || 0),
          }))
      setLedgers(mapped)
      const savedRows = saved?.rows || {}
      const merged = {}
      for (const l of mapped) merged[l.ledger_name] = { ...emptyLedgerInput(), ...(savedRows[l.ledger_name] || {}) }
      setInputs(merged)
      setStclOverrides(saved?.stclOverrides || {})
      setIncludeInPPENote(!!saved?.includeInPPENote)
      setPyTotals({ ...EMPTY_PY_TOTALS, ...(saved?.pyTotals || {}) })
      const savedWip = { ...EMPTY_WIP, ...(saved?.wip || {}) }
      setWip(savedWip)
      setWipOpen(wipHasFigures(savedWip))
    }).catch(() => {
      setLedgers([]); setInputs({}); setStclOverrides({}); setIncludeInPPENote(false)
      setPyTotals({ ...EMPTY_PY_TOTALS })
      setWip({ ...EMPTY_WIP }); setWipOpen(false)
    }).finally(() => setLoading(false))
  }, [tbId, isCompany])

  const addManualRow = () => {
    if (isCompany) {
      // A blank row, ready to fill: pick its Block and type the figures.
      let n = 1
      while (ledgers.some(l => l.ledger_name === `Row ${n}`)) n++
      const name = `Row ${n}`
      setLedgers(prev => [...prev, { ledger_name: name, m3_name: '', tbAmount: 0 }])
      setInputs(prev => ({ ...prev, [name]: emptyLedgerInput() }))
      return
    }
    const name = (window.prompt('Asset row name (e.g. "Plant & Machinery — all branches")') || '').trim()
    if (!name) return
    if (ledgers.some(l => l.ledger_name === name)) return showToast('A row with that name already exists.')
    setLedgers(prev => [...prev, { ledger_name: name, m3_name: '', tbAmount: 0 }])
    setInputs(prev => ({ ...prev, [name]: emptyLedgerInput() }))
  }

  const removeRow = (name) => {
    const inp = inputs[name]
    if (rowHasData(inp) && !window.confirm('Remove this row and what is entered in it?')) return
    setLedgers(prev => prev.filter(l => l.ledger_name !== name))
    setInputs(prev => { const next = { ...prev }; delete next[name]; return next })
  }

  // Consolidated only: sum every branch's own Dep (IT) figures block-by-block
  // into synthetic rows here, so this table (and everything derived from it —
  // Block Summary, Closing WDV, Include in PPE Note) reflects the branches'
  // actual entries instead of needing to be retyped from scratch.
  const pullFromBranches = async () => {
    if (!store.consolidated || pulling || !entity?.id) return
    if (!window.confirm('This refreshes the branch-total rows below with each branch\'s current Dep (IT) figures. Any other row you\'ve added yourself is left as it is. Continue?')) return
    setPulling(true)
    try {
      const branches = await window.api?.getBranches(entity.id) || []
      const branchSchedules = await Promise.all(branches.map(b => window.api?.depITGet(b.id).catch(() => null)))
      const { byBlock, pyAgg } = joinDepITSchedules(branchSchedules, Object.keys(EMPTY_PY_TOTALS))
      const newLedgers = []
      const newInputs = {}
      for (const [blockId, agg] of byBlock) {
        const block = blocks.find(bl => bl.id === blockId)
        const name = `${BRANCH_PULL_PREFIX}${block ? block.block : blockId}`
        newLedgers.push({ ledger_name: name, m3_name: '', tbAmount: 0 })
        newInputs[name] = {
          block: blockId,
          openingWDV: String(agg.openingWDV), addBefore180: String(agg.addBefore180),
          addAfter180: String(agg.addAfter180), deduction: String(agg.deduction),
        }
      }
      setLedgers(prev => [...prev.filter(l => !l.ledger_name.startsWith(BRANCH_PULL_PREFIX)), ...newLedgers])
      setInputs(prev => {
        const next = {}
        for (const [k, v] of Object.entries(prev)) if (!k.startsWith(BRANCH_PULL_PREFIX)) next[k] = v
        return { ...next, ...newInputs }
      })
      if (pyAgg) setPyTotals(pyAgg)
      showToast(`Pulled ${newLedgers.length} block${newLedgers.length !== 1 ? 's' : ''} from ${branches.length} branch${branches.length !== 1 ? 'es' : ''}. Review below, then Save.`)
    } catch (e) {
      showToast('Pull failed: ' + (e?.message || ''))
    } finally { setPulling(false) }
  }

  const updateInput = useCallback((ledgerName, val) => {
    setInputs(prev => ({ ...prev, [ledgerName]: val }))
  }, [])

  const updateStcl = useCallback((blockId, val) => {
    setStclOverrides(prev => ({ ...prev, [blockId]: val }))
  }, [])

  const handleSaveBlock = async ({ majorCategory, blockName, rate }) => {
    try {
      await window.api?.depITSaveCustomBlock({ entityId: entity.id, majorCategory, blockName, rate })
      // Assign to the ledger that requested it (if any)
      if (addBlockFor && addBlockFor !== 'menu') {
        const custom = await window.api?.depITBlocksCustom(entity.id)
        const created = (custom || []).find(b => b.block === blockName.trim())
        if (created) updateInput(addBlockFor, { ...(inputs[addBlockFor] || emptyLedgerInput()), block: String(created.id) })
      }
      await loadBlocks()
      setAddBlockFor(null)
      showToast('Block added.')
    } catch (e) {
      showToast('Failed to save block: ' + (e?.message || ''))
    }
  }

  // Group ledgers by assigned block — derived from the FULL ledger list
  // (unfiltered by "hide zero balance"), so totals stay correct regardless
  // of what's currently hidden from view.
  const byBlock = useMemo(() => {
    const map = new Map()
    for (const l of ledgers) {
      const blockId = inputs[l.ledger_name]?.block || ''
      if (!blockId) continue
      if (!map.has(blockId)) map.set(blockId, [])
      map.get(blockId).push(l)
    }
    return map
  }, [ledgers, inputs])

  const unassigned = ledgers.filter(l => !inputs[l.ledger_name]?.block)
  const visible = l => isCompany || !hideZeroBalance || !isEffectivelyEmpty(l, inputs)   // a company's rows have no TB amount to hide by

  // One row per assigned Block — the single source of truth for the Block
  // Summary tab, the grand-total strip, and the PPE-note save payload.
  const blockSummaryRows = useMemo(() => {
    const result = []
    for (const [blockId, ledgerRows] of byBlock.entries()) {
      const block = blocks.find(b => b.id === blockId)
      if (!block) continue
      const agg = ledgerRows.reduce((s, l) => {
        const inp = inputs[l.ledger_name] || emptyLedgerInput()
        return {
          openingWDV:   s.openingWDV   + num(inp.openingWDV),
          addBefore180: s.addBefore180 + num(inp.addBefore180),
          addAfter180:  s.addAfter180  + num(inp.addAfter180),
          deduction:    s.deduction    + num(inp.deduction),
          tbAmount:     s.tbAmount     + num(l.tbAmount),
        }
      }, { openingWDV: 0, addBefore180: 0, addAfter180: 0, deduction: 0, tbAmount: 0 })
      const { depreciation, closingWDV, autoStclStcg } = computeBlockTotals(block, agg)
      const overrideVal = stclOverrides[blockId]
      const stclStcg = overrideVal !== undefined && overrideVal !== '' ? num(overrideVal) : autoStclStcg
      result.push({
        blockId, majorCategory: block.majorCategory, block: block.block, rate: block.rate,
        openingWDV: agg.openingWDV, addBefore180: agg.addBefore180, addAfter180: agg.addAfter180,
        deduction: agg.deduction, stclStcg, depreciation, closingWDV,
        tbAmount: agg.tbAmount, difference: closingWDV - agg.tbAmount,
      })
    }
    return result
  }, [byBlock, blocks, inputs, stclOverrides])

  const grandTotals = useMemo(() => {
    const dep = blockSummaryRows.reduce((s, b) => s + b.depreciation, 0)
    const closing = blockSummaryRows.reduce((s, b) => s + b.closingWDV, 0)
    const tbAmt = blockSummaryRows.reduce((s, b) => s + b.tbAmount, 0)
    return { dep, closing, tbAmt, diff: closing - tbAmt }
  }, [blockSummaryRows])

  const save = async (opts = {}) => {
    if (!tbId) return showToast('Load a Trial Balance first.')
    setSaving(true)
    try {
      await store.save({ rows: inputs, stclOverrides, includeInPPENote, blockSummary: blockSummaryRows, pyTotals, wip })
      if (!opts.silent) showToast('Saved successfully.')
    } catch (e) {
      showToast('Save failed: ' + (e?.message || 'unknown error'))
    } finally { setSaving(false) }
  }

  // Auto-persist after an Excel import (uploadFilled) or toggling "Include in
  // PPE Note" (handleToggleInclude) — both used to only update local state,
  // requiring a separate manual "Save" click that's easy to forget, leaving
  // the PPE note showing stale/no Dep(IT) data even though the Editor/Block
  // Summary UI already reflected the fresh figures. Fires once inputs/
  // includeInPPENote (and the blockSummaryRows memo derived from them) have
  // actually updated for the render this effect runs in.
  useEffect(() => {
    if (!pendingAutoSaveRef.current) return
    pendingAutoSaveRef.current = false
    save({ silent: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs, includeInPPENote])

  // Mutual exclusivity: turning this on clears Dep (Comp)'s own "Include in
  // PPE Note" flag, since only one schedule can appear on the note face.
  const handleToggleInclude = async (v) => {
    setIncludeInPPENote(v)
    pendingAutoSaveRef.current = true
    if (v && tbId) {
      try {
        const compStore = depStoreFor(activeTB, entity, 'comp')
        const compSaved = await compStore.get()
        if (compSaved?.includeInPPENote) {
          await compStore.save({ ...compSaved, includeInPPENote: false })
          showToast('Included in PPE Note. Dep (Comp)\'s inclusion was turned off — only one schedule can show in the note.')
        }
      } catch (_) {}
    }
  }

  const saveWorkbook = async (wb, defaultPath) => {
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    const result = await window.api?.saveFileDialog({
      defaultPath, filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
    })
    if (result?.filePath && buf) {
      await window.api?.writeFile(result.filePath, Array.from(new Uint8Array(buf)))
      return result.filePath
    }
    return null
  }

  const downloadBlankTemplate = async () => {
    try {
      const path = await saveWorkbook(buildDepITBlankTemplate(blocks), 'Dep_IT_Template.xlsx')
      if (path) showToast('Blank template saved.')
    } catch (e) { showToast('Download failed: ' + (e?.message || '')) }
  }

  const downloadFilled = async () => {
    try {
      const eName = (entity?.name || 'Entity').replace(/[^A-Za-z0-9]+/g, '_')
      const path = await saveWorkbook(buildDepITFilledWorkbook(ledgers, inputs, blocks, wip), `${eName}_Dep_IT_Filled.xlsx`)
      if (path) showToast('Filled form saved — keep this safe before re-uploading a Trial Balance.')
    } catch (e) { showToast('Download failed: ' + (e?.message || '')) }
  }

  const uploadFilled = async () => {
    try {
      const result = await window.api?.openFileDialog({
        filters: [{ name: 'Excel Workbook', extensions: ['xlsx', 'xls'] }],
        properties: ['openFile'],
      })
      const filePath = result?.filePaths?.[0]
      if (!filePath) return
      const bytes = await window.api?.readFile(filePath)
      const wb = XLSX.read(new Uint8Array(bytes), { type: 'array' })
      const { rows: parsedRows, matched, unmatched, wip: parsedWip } = parseDepITWorkbook(wb, blocks)

      const ledgerNames = new Set(ledgers.map(l => l.ledger_name))
      let applied = 0
      setInputs(prev => {
        const next = { ...prev }
        for (const [ledgerName, val] of Object.entries(parsedRows)) {
          if (!ledgerNames.has(ledgerName)) {
            if (!manualRows) continue // not in the current TB — skip
            setLedgers(l => l.some(x => x.ledger_name === ledgerName) ? l : [...l, { ledger_name: ledgerName, m3_name: '', tbAmount: 0 }])
          }
          next[ledgerName] = { ...emptyLedgerInput(), ...val }
          applied++
        }
        return next
      })

      if (parsedWip && wipHasFigures(parsedWip)) {
        setWip(parsedWip)
        setWipOpen(true)
      }

      pendingAutoSaveRef.current = true

      const skippedForCurrentTB = Object.keys(parsedRows).length - applied
      let msg = `Restored ${applied} ledger${applied !== 1 ? 's' : ''} from the uploaded form and saved.`
      if (skippedForCurrentTB > 0) msg += ` ${skippedForCurrentTB} row(s) didn't match any ledger in this Trial Balance.`
      if (unmatched.length > 0) msg += ` ${unmatched.length} Block name(s) not recognised — check the "IT Blocks Reference" sheet.`
      showToast(msg)
    } catch (e) { showToast('Upload failed: ' + (e?.message || '')) }
  }

  if (!activeTB) return (
    <div className="flex items-center justify-center h-full text-gray-400 text-sm">
      Load a Trial Balance in the Actual TB tab first.
    </div>
  )

  const TABS = [
    { id: 'editor',  label: 'Editor' },
    { id: 'summary', label: 'Block Summary' },
  ]

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-5 py-2 border-b border-blue-100 bg-gray-50 shrink-0 flex-wrap">
        <span className="text-xs text-gray-500 font-medium">Depreciation — Income Tax Act, 1961 (Block-wise WDV)</span>
        <div className="ml-auto flex items-center gap-3">
          {!isCompany && (
            <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
              <input type="checkbox" checked={hideZeroBalance} onChange={e => setHideZeroBalance(e.target.checked)} />
              Hide zero-balance ledgers
            </label>
          )}
          {isCompany && (
            <button onClick={addManualRow}
              className="px-3 py-1.5 text-xs text-white rounded font-medium transition" style={{ background: 'var(--color-primary)' }}
              title="Add a blank row, then choose its Block and enter the figures">
              + Add Row
            </button>
          )}
          <button onClick={() => setAddBlockFor('menu')}
            className="px-3 py-1.5 text-xs border border-gray-300 rounded text-gray-600 hover:bg-gray-100 transition">
            + Add New Block
          </button>
          <button onClick={downloadBlankTemplate}
            className="px-3 py-1.5 text-xs border border-gray-300 rounded text-gray-600 hover:bg-gray-100 transition">
            ↓ Blank Template
          </button>
          <button onClick={downloadFilled}
            className="px-3 py-1.5 text-xs border border-green-300 rounded text-green-700 hover:bg-green-50 transition"
            title="Download the current entries — keep this before re-uploading a fresh Trial Balance">
            ↓ Download Filled
          </button>
          <button onClick={uploadFilled}
            className="px-3 py-1.5 text-xs border border-blue-300 rounded text-blue-700 hover:bg-blue-50 transition"
            title="Restore entries from a previously downloaded Filled form, matched by ledger name">
            ↑ Upload Filled
          </button>
          {store.consolidated && (
            <button onClick={pullFromBranches} disabled={pulling}
              className="px-3 py-1.5 text-xs border border-amber-400 rounded text-amber-800 bg-amber-50 hover:bg-amber-100 transition disabled:opacity-40"
              title="Sum every branch's own Dep (IT) figures, block by block, into this Consolidated schedule">
              {pulling ? 'Pulling…' : '⇩ Pull from Branches'}
            </button>
          )}
          {store.consolidated && (
            <button onClick={addManualRow}
              className="px-3 py-1.5 text-xs border border-amber-400 rounded text-amber-800 bg-amber-50 hover:bg-amber-100 transition"
              title="Consolidated schedule has no ledgers to link — add a named asset row (e.g. 'Plant & Machinery — all branches')">
              + Add asset row
            </button>
          )}
          <button onClick={save} disabled={saving}
            className="px-3 py-1.5 text-xs text-white rounded font-medium disabled:opacity-40 transition"
            style={{ background: 'var(--color-primary)' }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      {isCompany && (
        <div className="px-5 py-1 bg-blue-50 border-b border-blue-200 text-[11px] text-blue-800 shrink-0">
          Company — fill the Income Tax block schedule yourself: <strong>+ Add Row</strong>, choose the Block, enter Opening WDV, Additions and Deduction. Fixed-asset ledgers are not mapped here (Dep (Comp) is separate). Use ↓ Blank Template / ↑ Upload Filled to fill it in Excel.
        </div>
      )}
      {store.consolidated && (
        <div className="px-5 py-1 bg-amber-50 border-b border-amber-200 text-[11px] text-amber-800 shrink-0">
          Consolidated — all branches: one schedule for the whole entity, no ledger linking. Its Closing WDV is reconciled against the sum of every branch's PPE in the Exception Report (Consolidated mode).
        </div>
      )}

      {/* Summary strip */}
      <div className="flex items-center gap-6 px-5 py-1.5 bg-white border-b border-gray-100 shrink-0 text-xs text-gray-500">
        <span><span className="font-semibold text-gray-800">{ledgers.length}</span> {isCompany ? 'row' : 'ledger'}{ledgers.length !== 1 ? 's' : ''}</span>
        <span>Depreciation: <span className="font-bold text-red-700 font-mono">{fmtINR(grandTotals.dep)}</span></span>
        <span>Closing WDV: <span className="font-bold text-orange-700 font-mono">{fmtINR(grandTotals.closing)}</span></span>
        {!isCompany && <span>Difference: <span className={`font-bold font-mono ${Math.abs(grandTotals.diff) < 1 ? 'text-green-700' : 'text-red-700'}`}>{fmtINR(grandTotals.diff)}</span></span>}
      </div>

      {/* Tab strip */}
      <div className="flex border-b border-gray-200 bg-white shrink-0 px-4">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2 text-xs font-medium border-b-2 transition -mb-px ${activeTab === t.id ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto bg-white">
        {loading && <div className="p-8 text-gray-400 text-sm text-center">Loading...</div>}

        {!loading && ledgers.length === 0 && (
          <div className="p-8 text-center text-gray-400 italic">
            {isCompany
              ? 'Click "+ Add Row" (top right) to start — then choose the Block from the drop-down and enter the figures.'
              : store.consolidated
              ? 'Consolidated schedule — click "+ Add asset row" to add rows (one per block or asset group), or "↑ Upload Filled".'
              : 'No ledgers found under "Property, Plant & Equipment" or "Intangible Assets" in the Mapped TB. Categorise fixed asset ledgers first in Categorisation / Mapped TB.'}
          </div>
        )}

        {!loading && (ledgers.length > 0 || isCompany) && activeTab === 'editor' && (
          <div className="p-4">
            {unassigned.length > 0 && (
              <div className="bg-amber-50 border border-amber-300 rounded p-2 text-xs text-amber-800 mb-3">
                ⚠ {unassigned.length} ledger{unassigned.length > 1 ? 's have' : ' has'} no Block assigned — excluded from depreciation until a Block is selected.
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="border-collapse text-xs w-full" style={{ minWidth: 1300 }}>
                <thead>
                  <tr className="bg-blue-800 text-white text-[10px]">
                    <th className="border border-blue-700 px-2 py-1.5 text-left" style={{ minWidth: 180 }}>Name of Assets</th>
                    <th className="border border-blue-700 px-2 py-1.5 text-left" style={{ minWidth: 220 }}>Asset Block</th>
                    <th className="border border-blue-700 px-2 py-1.5 text-right" style={{ minWidth: 55 }}>Rate</th>
                    <th className="border border-blue-700 px-2 py-1.5 text-right" style={{ minWidth: 100 }}>Opening WDV</th>
                    <th className="border border-blue-700 px-2 py-1.5 text-right" style={{ minWidth: 95 }}>Addn &lt;180 Days</th>
                    <th className="border border-blue-700 px-2 py-1.5 text-right" style={{ minWidth: 95 }}>Addn ≥180 Days</th>
                    <th className="border border-blue-700 px-2 py-1.5 text-right" style={{ minWidth: 90 }}>Deduction</th>
                    <th className="border border-blue-700 px-2 py-1.5 text-right" style={{ minWidth: 90 }}>STCL / (STCG)</th>
                    <th className="border border-blue-700 px-2 py-1.5 text-right" style={{ minWidth: 95 }}>Depreciation</th>
                    <th className="border border-blue-700 px-2 py-1.5 text-right" style={{ minWidth: 95 }}>Closing WDV</th>
                    <th className="border border-blue-700 px-2 py-1.5 text-right" style={{ minWidth: 100 }}>Amt as per TB</th>
                    <th className="border border-blue-700 px-2 py-1.5 text-right" style={{ minWidth: 90 }}>Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {[...byBlock.keys()].map(blockId => {
                    const block = blocks.find(b => b.id === blockId)
                    if (!block) return null
                    const ledgerRows = byBlock.get(blockId)
                    const shownRows = ledgerRows.filter(visible)
                    return (
                      <React.Fragment key={blockId}>
                        {shownRows.map(l => (
                          <LedgerRow key={l.ledger_name} ledger={l}
                            input={inputs[l.ledger_name] || emptyLedgerInput()}
                            blocks={blocks} company={isCompany} onRemove={isCompany ? () => removeRow(l.ledger_name) : null}
                            onChange={val => updateInput(l.ledger_name, val)}
                            onAddBlockRequested={ledgerName => setAddBlockFor(ledgerName)} />
                        ))}
                        {shownRows.length < ledgerRows.length && (
                          <tr><td colSpan={11} className="border border-gray-100 px-2 py-0.5 text-[10px] text-gray-400 italic">
                            {ledgerRows.length - shownRows.length} zero-balance ledger(s) hidden
                          </td></tr>
                        )}
                        <BlockTotalRow block={block} ledgerRows={ledgerRows} inputs={inputs} company={isCompany}
                          stclOverride={stclOverrides[blockId]}
                          onStclChange={val => updateStcl(blockId, val)} />
                      </React.Fragment>
                    )
                  })}
                  {unassigned.filter(visible).map(l => (
                    <LedgerRow key={l.ledger_name} ledger={l}
                      input={inputs[l.ledger_name] || emptyLedgerInput()}
                      blocks={blocks} company={isCompany} onRemove={isCompany ? () => removeRow(l.ledger_name) : null}
                      onChange={val => updateInput(l.ledger_name, val)}
                      onAddBlockRequested={ledgerName => setAddBlockFor(ledgerName)} />
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-blue-900 text-white font-bold text-xs">
                    <td colSpan={8} className="border border-blue-800 px-2 py-1.5">GRAND TOTAL</td>
                    <td className="border border-blue-800 px-2 py-1 text-right font-mono">{fmtINR(grandTotals.dep)}</td>
                    <td className="border border-blue-800 px-2 py-1 text-right font-mono">{fmtINR(grandTotals.closing)}</td>
                    <td className="border border-blue-800 px-2 py-1 text-right font-mono">{isCompany ? '—' : fmtINR(grandTotals.tbAmt)}</td>
                    <td className="border border-blue-800 px-2 py-1 text-right font-mono">{isCompany ? '—' : fmtINR(grandTotals.diff)}</td>
                  </tr>
                  <tr className="bg-gray-100 text-xs">
                    <td colSpan={3} className="border border-gray-300 px-2 py-1.5 font-semibold text-gray-600">Previous Year</td>
                    {['openingWDV', 'addBefore180', 'addAfter180', 'deduction', 'stclStcg', 'depreciation', 'closingWDV'].map(field => (
                      <td key={field} className="border border-gray-300 px-1 py-0.5">
                        <input className={NINP} value={pyTotals[field]}
                          onChange={e => setPyTotals(prev => ({ ...prev, [field]: e.target.value }))}
                          placeholder="0.00" />
                      </td>
                    ))}
                    <td className="border border-gray-300 px-2 py-1" colSpan={2}></td>
                  </tr>
                  {/* Capital WIP / Intangible WIP — manual entry, no depreciation. Hidden
                      behind a "+ Add" link until opened or something's already saved, and
                      the combined grand total further below only when a figure exists. */}
                  {!wipOpen && !wipHasFigures(wip) && (
                    <tr className="bg-white text-xs">
                      <td colSpan={12} className="border border-gray-200 px-2 py-1">
                        <button type="button" onClick={() => setWipOpen(true)} className="text-blue-700 hover:underline">
                          + Add Capital Work in Progress / Intangible Work in Progress
                        </button>
                      </td>
                    </tr>
                  )}
                  {(wipOpen || wipHasFigures(wip)) && (
                    <>
                      <tr className="bg-amber-50 text-xs">
                        <td colSpan={9} className="border border-gray-300 px-2 py-1.5 text-gray-600">Capital Work in Progress</td>
                        <td className="border border-gray-300 px-1 py-0.5">
                          <input className={NINP} value={wip.capitalCY}
                            onChange={e => setWip(prev => ({ ...prev, capitalCY: e.target.value }))}
                            placeholder="0.00" />
                        </td>
                        <td className="border border-gray-300 px-2 py-1" colSpan={2}></td>
                      </tr>
                      <tr className="bg-amber-50 text-xs">
                        <td colSpan={9} className="border border-gray-300 px-2 py-1.5 text-gray-600">Intangible Work in Progress</td>
                        <td className="border border-gray-300 px-1 py-0.5">
                          <input className={NINP} value={wip.intangibleCY}
                            onChange={e => setWip(prev => ({ ...prev, intangibleCY: e.target.value }))}
                            placeholder="0.00" />
                        </td>
                        <td className="border border-gray-300 px-2 py-1" colSpan={2}></td>
                      </tr>
                      <tr className="bg-amber-100 text-xs font-semibold">
                        <td colSpan={9} className="border border-gray-300 px-2 py-1.5 text-gray-700">Total (Work in Progress)</td>
                        <td className="border border-gray-300 px-2 py-1 text-right font-mono">{fmtINR(wipCYTotal(wip))}</td>
                        <td className="border border-gray-300 px-2 py-1" colSpan={2}></td>
                      </tr>
                      <tr className="bg-gray-100 text-xs">
                        <td colSpan={9} className="border border-gray-300 px-2 py-1.5 font-semibold text-gray-600">Previous Year (Work in Progress)</td>
                        <td className="border border-gray-300 px-1 py-0.5">
                          <input className={NINP} value={wip.prevYearTotal}
                            onChange={e => setWip(prev => ({ ...prev, prevYearTotal: e.target.value }))}
                            placeholder="0.00" />
                        </td>
                        <td className="border border-gray-300 px-2 py-1" colSpan={2}></td>
                      </tr>
                    </>
                  )}
                  {wipHasFigures(wip) && (
                    <>
                      <tr className="bg-blue-900 text-white font-bold text-xs">
                        <td colSpan={9} className="border border-blue-800 px-2 py-1.5">Total PPE &amp; Intangible Assets including work in progress</td>
                        <td className="border border-blue-800 px-2 py-1 text-right font-mono">{fmtINR(grandTotals.closing + wipCYTotal(wip))}</td>
                        <td className="border border-blue-800 px-2 py-1" colSpan={2}></td>
                      </tr>
                      <tr className="bg-gray-100 text-xs italic">
                        <td colSpan={9} className="border border-gray-300 px-2 py-1.5 text-gray-600">Previous Year</td>
                        <td className="border border-gray-300 px-2 py-1 text-right font-mono text-gray-700">{fmtINR(num(pyTotals.closingWDV) + num(wip.prevYearTotal))}</td>
                        <td className="border border-gray-300 px-2 py-1" colSpan={2}></td>
                      </tr>
                    </>
                  )}
                </tfoot>
              </table>
            </div>

            <p className="text-[10px] text-gray-400 mt-3">
              Depreciation is computed per Block (Section 32, IT Act 1961) — full rate on Opening WDV + Additions held
              ≥180 days, half rate on Additions held &lt;180 days, after netting off Deductions. STCL/(STCG) is
              auto-suggested only when a Block's value goes negative on sale (Sec. 50 short-term capital gain);
              a short-term capital loss requires the entire Block to have ceased — enter that manually if applicable.
            </p>
          </div>
        )}

        {!loading && (ledgers.length > 0 || isCompany) && activeTab === 'summary' && (
          <BlockSummaryTab summaryRows={blockSummaryRows} includeInPPENote={includeInPPENote}
            onToggleInclude={handleToggleInclude} entity={entity} pyTotals={pyTotals} wip={wip} company={isCompany} />
        )}
      </div>

      {addBlockFor !== null && (
        <AddBlockForm
          majorCategories={majorCategories.length ? majorCategories : ['I. BUILDING', 'II. FURNITURE AND FITTINGS', 'III. MACHINERY AND PLANT', 'IV. SHIPS', 'INTANGIBLE ASSETS']}
          onSave={handleSaveBlock}
          onCancel={() => setAddBlockFor(null)}
        />
      )}

      {toast && (
        <div className="fixed bottom-4 right-4 px-4 py-2 rounded shadow-lg bg-blue-700 text-white text-xs font-medium z-50">
          {toast}
        </div>
      )}
    </div>
  )
}
