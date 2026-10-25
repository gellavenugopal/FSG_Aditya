import React, { useState, useEffect, useRef } from 'react'
import { formatPeriodText } from '../../utils/financialPeriodDisplay'
import { useFinancials, fmtINR, displayAmt as rowAmt } from '../../hooks/useFinancials'
import { mapSavedRowsToLiveNotes } from '../../utils/savedNoteData'
import { pointLabel } from '../../utils/pointLabel'
import PYTBSelector from '../shared/PYTBSelector'
import ManualPYButton from '../shared/ManualPYButton'
import PYModeSelect from '../shared/PYModeSelect'
import * as XLSX from 'xlsx-js-style'
import { buildManualPyFilledWorkbook, parseManualPyWorkbook } from './manualPyWorkbook'
import { buildFillDetailsWorkbook, parseFillDetailsWorkbook, parseFillDetailsStockSheet } from '../GenerateFinancials/fillDetailsWorkbook'
import { loadStockMaps } from '../Stock/StockPage'
import { buildCashFlow } from '../../utils/cashFlow'
import { parseCfsSheet, applyCfsUpload } from '../CFS/cfsWorkbook'
import { parseDepITWorkbook } from '../DepreciationIT/depITWorkbook'
import { parseDepCompWorkbook } from '../DepreciationComp/depCompWorkbook'
import { parseShareCapitalDetailsSheet } from './shareCapitalDetailsWorkbook'
import { FILL_DETAILS_REGISTRY } from '../../utils/fillDetailsRegistry'
import RemarkCell, { useRemarks } from '../shared/RemarkCell'
import ShareCapitalForm from './ShareCapitalForm'
import LongTermBorrowingsForm from './LongTermBorrowingsForm'
import ShortTermBorrowingsForm from './ShortTermBorrowingsForm'
import TradePayablesDisclosureForm, { TP_AGEING_ROWS, TP_AGEING_BUCKETS } from './TradePayablesDisclosureForm'
import CashBankDetailsForm from './CashBankDetailsForm'
import TradeReceivablesAgingForm, { TR_AGEING_ROWS, TR_AGEING_BUCKETS, trComputedCell } from './TradeReceivablesAgingForm'
import TradeReceivablesAgeingNonCorpForm, { NcAgeingDisplayTable } from './TradeReceivablesAgeingNonCorpForm'
import { isNonCorpTradeReceivables } from '../../utils/tradeReceivablesNonCorp'
import { fixFilterWith, fixFilterWithIds } from '../../utils/fixTargets'
import OwnersCapitalAccountForm from './OwnersCapitalAccountForm'
import { NoteFormatRefButton } from '../shared/FormatReference'
import { depStoreFor, isConsolidatedTB } from '../../utils/depStore'
import { withNet } from '../../utils/depCompNet'
import { plNoteShowsLines, plNoteLineLabel, isPrintedPlNoteLine, bsNoteFallbackLines } from '../../utils/annexureGrouping'
import { unsplitSaleLine } from '../../utils/revenueLines'

function Guard({ activeTB, loading, hasData, error, children }) {
  if (!activeTB) return <div className="flex items-center justify-center h-full text-gray-400 text-sm">Load a Trial Balance in the Actual TB tab first.</div>
  // Only block on the FIRST load (or after switching to a different TB,
  // which useFinancials.js clears data for). A background refresh of the
  // same TB — e.g. after saving one Manual PY figure — keeps rendering the
  // already-loaded notes instead of unmounting the whole list.
  if (loading && !hasData) return <div className="flex items-center justify-center h-full text-gray-400">Loading financial data...</div>
  if (error) return <div className="flex items-center justify-center h-full text-red-500 text-sm px-8 text-center">{error}</div>
  return children
}

// "+ Add PY-only Major Head" — a Balance Sheet major head with no Current
// Year balance at all (so it has no note today — see useFinancials.js's
// manualPyOnlyTitles/forceInclude) but a Previous Year figure the CA wants
// on record. Lists every BS-side title from the entity's own LevelFormat
// that doesn't already have a note this year; saving just writes a normal
// Manual PY entry under that title — useFinancials.js does the rest
// (synthesizes the note, in its correct statutory position, next refresh).
function AddPyOnlyMajorHeadModal({ availableMajorHeads, subHeadsFor, onSave, onClose }) {
  const [choice, setChoice] = useState('')
  const [amount, setAmount] = useState('')
  const [subAmounts, setSubAmounts] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // A head whose P&L face shows its own sub-lines (Tax expense: Current tax /
  // Excess-Short provision / Deferred tax) is entered line by line — a single
  // lump sum would have no face row to land on.
  const subHeads = choice ? (subHeadsFor?.(choice) || []) : []

  const save = async () => {
    if (!choice) { setError('Pick a major head first.'); return }
    let toSave
    if (subHeads.length) {
      toSave = {}
      for (const cap of subHeads) {
        const v = subAmounts[cap]
        if (v === undefined || v === '') continue
        if (isNaN(parseFloat(v))) { setError(`"${cap}" is not a number.`); return }
        toSave[cap] = parseFloat(v)
      }
      if (!Object.keys(toSave).length) { setError('Enter a Previous Year amount for at least one line.'); return }
    } else {
      if (amount === '' || isNaN(parseFloat(amount))) { setError('Enter a Previous Year amount.'); return }
      toSave = parseFloat(amount)
    }
    setSaving(true); setError('')
    try {
      await onSave(choice, toSave)
      onClose()
    } catch (err) {
      setError(err?.message || 'Failed to save.')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-md">
        <div className="bg-blue-600 text-white px-5 py-3 rounded-t-lg">
          <h2 className="text-sm font-bold">Add a Previous-Year-only Major Head</h2>
          <p className="text-xs text-blue-100 mt-1">For a Balance Sheet or P&amp;L major head with no balance this year, but a Previous Year figure to record. A P&amp;L head is entered as one combined figure for the whole note; Tax expense is entered line by line (Current tax, Excess/Short provision, Deferred tax).</p>
        </div>
        <div className="p-5 space-y-3">
          {availableMajorHeads.length === 0 ? (
            <p className="text-xs text-gray-500">Every major head already has a note this year — there's nothing left to add.</p>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Major Head</label>
                <select value={choice} onChange={e => setChoice(e.target.value)}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs text-gray-900 bg-white focus:ring-2 focus:ring-blue-400 focus:outline-none">
                  <option value="">Select…</option>
                  {availableMajorHeads.map(h => (
                    <option key={h.level2} value={h.level2}>{h.level1} — {h.level2}</option>
                  ))}
                </select>
              </div>
              {subHeads.length > 0 ? (
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-gray-700">Previous Year Amount — leave a line blank if it has none</label>
                  {subHeads.map(cap => (
                    <div key={cap} className="flex items-center gap-2">
                      <span className="flex-1 text-xs text-gray-700">{cap}</span>
                      <input type="number" step="0.01" value={subAmounts[cap] ?? ''}
                        onChange={e => setSubAmounts(prev => ({ ...prev, [cap]: e.target.value }))}
                        className="w-36 border border-gray-300 rounded px-2 py-1.5 text-xs text-right font-mono text-gray-900 bg-white focus:ring-2 focus:ring-blue-400 focus:outline-none"
                        placeholder="0.00" />
                    </div>
                  ))}
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Previous Year Amount</label>
                  <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs text-right font-mono text-gray-900 bg-white focus:ring-2 focus:ring-blue-400 focus:outline-none"
                    placeholder="0.00" />
                </div>
              )}
            </>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-200">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
          <button onClick={save} disabled={saving || availableMajorHeads.length === 0}
            className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Add Note'}
          </button>
        </div>
      </div>
    </div>
  )
}

function groupByL3(rows) {
  const map = new Map()
  for (const row of rows) {
    const l3 = row.mapping3_resultant || row.level3 || ''
    if (!map.has(l3)) map.set(l3, [])
    map.get(l3).push(row)
  }
  return [...map.entries()]
}

function groupByL4(rows) {
  const map = new Map()
  for (const row of rows) {
    const l4 = row.level4 || ''
    if (!map.has(l4)) map.set(l4, [])
    map.get(l4).push(row)
  }
  return [...map.entries()]
}

const num = (v) => parseFloat(v) || 0

// Owners'/Partners' Capital Account note face: a party's balance EXCLUDING the
// year's share of profit. The note already carries "Profit and Loss for the
// Year" as its own line (it comes straight off the mapped TB), so showing the
// full closing balance here would count the P&L twice and break the note total.
//   party balance (ex-P&L) + P&L line = note total = closing balance
function capPartyExPL(f) {
  if (!f) return 0
  return num(f.opening) + num(f.introduced) + num(f.remuneration) + num(f.interest) - num(f.withdrawals)
}
function capRowExPL(row, variant) {
  if (!row) return 0
  return variant === 'llp'
    ? capPartyExPL(row.contrib) + capPartyExPL(row.current)
    : capPartyExPL(row)
}
function capPyExPL(saved) {
  if (!saved) return 0
  return saved.variant === 'llp'
    ? capPartyExPL(saved.pyContrib) + capPartyExPL(saved.pyCurrent)
    : capPartyExPL(saved.py)
}

/**
 * Read-only ageing schedule table shown below a note.
 * `rows`/`buckets` come from the form modules so labels always match the fill form.
 * `computeCell(periodData, computedType, bucketKey)` derives computed rows (e.g. Total Due).
 */
function AgeingDisplayTable({ heading, periodData, rows, buckets, computeCell }) {
  if (!periodData || Object.keys(periodData).length === 0) return null
  const cell = (row, bKey) => {
    if (row.computed && computeCell) return computeCell(periodData, row.computed, bKey)
    return num(periodData?.[row.key]?.[bKey])
  }
  const rowTotal = (row) => buckets.reduce((s, b) => s + cell(row, b.key), 0)
  // Skip the table entirely if every cell is zero
  const hasValue = rows.some(r => Math.abs(rowTotal(r)) > 0.005)
  if (!hasValue) return null
  return (
    <div className="mb-4">
      <p className="text-xs font-semibold text-gray-700 mb-2">{heading}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px] border-collapse">
          <thead>
            <tr className="bg-indigo-50">
              <th rowSpan={2} className="border border-indigo-200 px-2 py-1 text-left font-semibold text-indigo-900 align-bottom w-[26%]">Particulars</th>
              <th colSpan={buckets.length} className="border border-indigo-200 px-2 py-1 text-center font-semibold text-indigo-900">Outstanding for following periods from due date of payment</th>
              <th rowSpan={2} className="border border-indigo-200 px-2 py-1 text-right font-semibold text-indigo-900 align-bottom">Total</th>
            </tr>
            <tr className="bg-indigo-50">
              {buckets.map(b => (
                <th key={b.key} className="border border-indigo-200 px-2 py-1 text-right font-semibold text-indigo-900">{b.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.key} className={`border-b border-indigo-100 ${row.isTotal ? 'bg-indigo-50 font-semibold' : 'bg-indigo-50/30 hover:bg-indigo-50'}`}>
                <td className="border border-indigo-200 px-2 py-1 text-left text-gray-700 text-[11px]">{row.label}</td>
                {buckets.map(b => (
                  <td key={b.key} className="border border-indigo-200 px-2 py-1 text-right font-mono text-gray-800">{fmtINR(cell(row, b.key))}</td>
                ))}
                <td className="border border-indigo-200 px-2 py-1 text-right font-mono font-semibold text-gray-800">{fmtINR(rowTotal(row))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Inline Manual PY cell — editable Previous Year figure, saved on blur ────
// tbId === '__consolidated__' (Consolidated view of a branch entity, no real
// Trial Balance to save against) routes to the entity-scoped mirror instead
// — see useManualPY.js's comment on why this exists.
function ManualPyCell({ tbId, entityId, noteNum, noteTitle, label, value, onSaved, isCustom = false, entryId = null }) {
  const [val, setVal] = useState(value ?? 0)
  const [deleting, setDeleting] = useState(false)
  useEffect(() => { setVal(value ?? 0) }, [value])
  const save = () => {
    if (parseFloat(val || 0) === parseFloat(value || 0)) return
    const p = tbId === '__consolidated__'
      ? window.api?.upsertEntityManualPyEntry({ entityId, noteNum, noteTitle, particularLabel: label, py_amount: val || 0, is_custom: false })
      : window.api?.upsertManualPyEntry({ tbId, noteNum, noteTitle, particularLabel: label, py_amount: val || 0, is_custom: false })
    p?.then(() => onSaved?.())
  }
  // Only a row the CA added themselves via "+ Add Row" can be deleted — a
  // template-driven line (Share Capital, Statutory dues payable, etc.) is a
  // structural fact of the Schedule III format, not something to remove;
  // clearing its figure is done by blanking the input, not deleting the row.
  const del = () => {
    if (!entryId || deleting) return
    if (!window.confirm(`Remove "${label}"? This deletes the row, not just its figure.`)) return
    setDeleting(true)
    const p = tbId === '__consolidated__'
      ? window.api?.deleteEntityManualPyEntry(entryId)
      : window.api?.deleteManualPyEntry(entryId)
    p?.then(() => onSaved?.()).finally(() => setDeleting(false))
  }
  return (
    <div className="flex items-center gap-1 justify-end">
      <input
        type="number"
        value={val}
        onChange={e => setVal(e.target.value)}
        onBlur={save}
        onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
        onClick={e => e.stopPropagation()}
        className="w-full text-right font-mono text-xs border border-amber-300 rounded px-1.5 py-0.5 bg-amber-50 focus:outline-none focus:ring-1 focus:ring-amber-400"
        placeholder="0"
      />
      {isCustom && entryId && (
        <button onClick={e => { e.stopPropagation(); del() }} disabled={deleting}
          title="Remove this custom row" tabIndex={-1}
          className="shrink-0 text-[11px] text-red-400 hover:text-red-600 disabled:opacity-40 px-0.5">✕</button>
      )}
    </div>
  )
}

// ── Inline "+ Add Row" — a brand-new particular with no existing CY ledger,
// purely to record a Previous Year figure (e.g. a PY-only sub-head).
function AddManualPyRow({ tbId, entityId, noteNum, noteTitle, onSaved }) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!label.trim()) return
    setSaving(true)
    try {
      if (tbId === '__consolidated__') {
        await window.api?.upsertEntityManualPyEntry({ entityId, noteNum, noteTitle, particularLabel: label.trim(), py_amount: amount || 0, is_custom: true })
      } else {
        await window.api?.upsertManualPyEntry({ tbId, noteNum, noteTitle, particularLabel: label.trim(), py_amount: amount || 0, is_custom: true })
      }
      setLabel(''); setAmount(''); setOpen(false)
      onSaved?.()
    } finally { setSaving(false) }
  }

  if (!open) {
    return (
      <tr>
        <td colSpan={3} className="py-1 px-4">
          <button onClick={() => setOpen(true)} className="text-[11px] text-amber-700 hover:underline">+ Add Row (Previous Year sub-head)</button>
        </td>
      </tr>
    )
  }
  return (
    <tr className="bg-amber-50/60">
      <td className="py-1 pl-4 pr-2">
        <input autoFocus value={label} onChange={e => setLabel(e.target.value)} placeholder="Particular name"
          className="w-full border border-amber-300 rounded px-1.5 py-0.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-400" />
      </td>
      <td className="py-1 pr-3 text-right text-gray-300">—</td>
      <td className="py-1 pr-3">
        <div className="flex items-center gap-1">
          <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0"
            className="w-full text-right font-mono border border-amber-300 rounded px-1.5 py-0.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-400"
            onKeyDown={e => { if (e.key === 'Enter') save() }} />
          <button onClick={save} disabled={saving || !label.trim()} className="text-[11px] text-white bg-amber-600 rounded px-1.5 py-0.5 disabled:opacity-40 shrink-0">Save</button>
          <button onClick={() => { setOpen(false); setLabel(''); setAmount('') }} className="text-[11px] text-gray-400 hover:text-gray-600 shrink-0">✕</button>
        </div>
      </td>
    </tr>
  )
}

function NoteBlock({ note, entity, isHighlighted, tbId, getRemark, onRemarkSaved, showZeroRows = false, onFix, onFillDetails, expandSignal, manualPyEnabled, onManualPySaved, onGoToAnnexure, onGoToStock }) {
  // Manual PY is turned on specifically to type figures into lines that are
  // CURRENTLY zero (e.g. "Statutory dues payable" and its GST/TDS/etc. sub-
  // options, nil this year but not last year) — without this, such a line
  // has total=0 and prevTotal=0 in BOTH years before anything is typed, so
  // the ordinary zero-row filter hides it, and there is no cell to type
  // into at all unless "Show zero rows" also happens to be ticked. Root
  // cause of "the option of filling the value is not coming" — most visible
  // in Consolidated (many sub-lines nil across every branch at once) but not
  // actually specific to it; any note whose relevant line is nil in both
  // years hits this the same way in Branch mode.
  const allRows = (showZeroRows || manualPyEnabled) ? (note.templateRowsAll || note.templateRows || []) : (note.templateRows || [])
  // Separate MSME and Cash & Bank rows from regular rows
  const msmeHeaderRow = allRows.find(r => r.isMSMEHeader)
  const msmeRows = msmeHeaderRow ? allRows.filter(r => r.isMSME) : []
  const cashBankHeaderRow = allRows.find(r => r.isCashBankHeader)
  const cashBankRows = cashBankHeaderRow ? allRows.filter(r => r.isCashBank) : []
  const noteRows = allRows.filter(r => !r.isMSME && !r.isMSMEHeader && !r.isCashBank && !r.isCashBankHeader)
  const [expanded, setExpanded] = useState(true)
  const [expandedLines, setExpandedLines] = useState(new Set())
  const [ownerDetails, setOwnerDetails] = useState(null)

  // Fetch owner details for Owners' Capital Account notes (to display proprietor name)
  const isOwnersCapitalNote = (note.title || '').toLowerCase().includes("owners' capital") || (note.title || '').toLowerCase().includes('owners capital') || (note.title || '').toLowerCase().includes("partners' capital") || (note.title || '').toLowerCase().includes('partners capital')
  useEffect(() => {
    if (!isOwnersCapitalNote || !entity?.id || !note.num) return
    const fetch = entity?.has_branches
      ? window.api?.getEntityNoteDetails(entity.id, note.num, note.title)
      : window.api?.getNoteDetails(tbId, note.num, note.title)
    fetch?.then(saved => { if (saved && saved.rows && saved.rows.length > 0) setOwnerDetails(saved) }).catch(() => {})
  }, [isOwnersCapitalNote, entity?.id, note.num, note.title, tbId, entity?.has_branches])
  const toggleLine = (key) => setExpandedLines(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })
  const blockRef = useRef(null)

  useEffect(() => {
    if (!isHighlighted) return
    setExpanded(true)
    const t = setTimeout(() => blockRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
    return () => clearTimeout(t)
  }, [isHighlighted])

  // Global Expand All / Collapse All — follows the toolbar signal, per-note toggle still works
  useEffect(() => {
    if (expandSignal && expandSignal.n > 0) setExpanded(expandSignal.v)
  }, [expandSignal])

  // Toggling "Include Dep(IT) Block Summary in this note" straight from the
  // PPE note itself, mirroring the same checkbox on Dep (IT) → Block Summary
  // — saves a trip back to that menu. Fetches the full saved Dep(IT) payload
  // first and patches just includeInPPENote, since depITSave overwrites the
  // whole record (rows/blockSummary/pyTotals must round-trip unchanged).
  // Mutually exclusive with Dep (Comp)'s own toggle below — turning this on
  // clears that one, since only one schedule can show on the note face.
  const [togglingITBlock, setTogglingITBlock] = useState(false)
  const handleToggleITBlockSummary = async (checked) => {
    if (!tbId || togglingITBlock) return
    setTogglingITBlock(true)
    try {
      // depStoreFor routes to the entity-level Consolidated schedule when
      // tbId is the virtual '__consolidated__' TB, the per-TB one otherwise
      // — same dispatch the Dep (IT)/Dep (Comp) screens' own checkboxes use.
      const shimTB = { id: tbId, entity_id: entity?.id }
      const itStore = depStoreFor(shimTB, entity, 'it')
      const saved = await itStore.get() || {}
      await itStore.save({ ...saved, includeInPPENote: checked })
      if (checked) {
        const compStore = depStoreFor(shimTB, entity, 'comp')
        const compSaved = await compStore.get()
        if (compSaved?.includeInPPENote) {
          await compStore.save({ ...compSaved, includeInPPENote: false })
        }
      }
      onManualPySaved?.()
    } finally { setTogglingITBlock(false) }
  }

  // Toggling "Include Dep (Comp) Fixed Assets Schedule in this note" — mirrors
  // handleToggleITBlockSummary above, symmetric mutual-exclusivity guard.
  const [togglingCompSchedule, setTogglingCompSchedule] = useState(false)
  const handleToggleCompSchedule = async (checked) => {
    if (!tbId || togglingCompSchedule) return
    setTogglingCompSchedule(true)
    try {
      const shimTB = { id: tbId, entity_id: entity?.id }
      const compStore = depStoreFor(shimTB, entity, 'comp')
      const saved = await compStore.get() || {}
      await compStore.save({ ...saved, includeInPPENote: checked })
      if (checked) {
        const itStore = depStoreFor(shimTB, entity, 'it')
        const itSaved = await itStore.get()
        if (itSaved?.includeInPPENote) {
          await itStore.save({ ...itSaved, includeInPPENote: false })
        }
      }
      onManualPySaved?.()
    } finally { setTogglingCompSchedule(false) }
  }

  const hasL2Lines = plNoteShowsLines(note)
  // PPE note: when the IT Act Block-wise WDV Summary or the Dep (Comp)
  // category-level schedule is present (opt-in, mutually exclusive), it
  // supersedes the plain "Property, Plant & Equipment / Total" one-row
  // summary table above it — showing both is redundant, so the summary table
  // is skipped in favour of the more detailed one. Falls back to the summary
  // table when neither schedule has been opted in yet.
  const hasITBlock = !note.isPL && note.itBlockSummaryData && note.itBlockSummaryData.length > 0
  const hasCompSchedule = !note.isPL && note.compScheduleData && note.compScheduleData.length > 0
  const hasDepSchedule = hasITBlock || hasCompSchedule

  return (
    <div ref={blockRef} id={`note-${note.num}`}
      className={`mb-6 border rounded-lg overflow-hidden shadow-sm transition-all ${isHighlighted ? 'border-blue-400 ring-2 ring-blue-300' : 'border-blue-100'}`}>

      <div className={`w-full flex items-center justify-between px-4 py-2.5 text-white transition-colors ${isHighlighted ? 'bg-blue-600' : 'bg-blue-800'}`}>
        <button className="flex-1 text-left flex items-center gap-2"
          onClick={() => setExpanded(e => !e)}>
          <span className="font-bold text-sm flex items-center gap-2">
            Note {note.num}: {note.displayTitle || note.title}
          </span>
        </button>
        <div className="flex items-center gap-2">
          <span onClick={e => e.stopPropagation()}>
            <NoteFormatRefButton entity={entity} noteTitle={note.title} />
          </span>
          {onFix && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                // PL notes are per L1 (note.title === L1); BS notes are per L2.
                const filter = note.isPL
                  ? { alie: note.alie, mapping1_resultant: note.title }
                  : { alie: note.alie, mapping1_resultant: note.level1, mapping2_resultant: note.title }
                onFix(fixFilterWith(filter, note.rows), `Fix: ${note.title}`)
              }}
              className={`px-2 py-0.5 text-[10px] rounded font-medium border ${
                (note.title || '').toLowerCase().includes('uncategorised')
                  ? 'bg-red-100 text-red-800 border-red-300 hover:bg-red-200'
                  : 'bg-white text-blue-700 border-blue-300 hover:bg-blue-50'
              }`}
            >
              {(note.title || '').toLowerCase().includes('uncategorised') ? 'Fix Categorisation' : 'Re-categorise'}
            </button>
          )}
          {tbId && (
            <span onClick={e => e.stopPropagation()}>
              <RemarkCell tbId={tbId} scope="notes" scopeKey={note.title}
                initialValue={getRemark?.('notes', note.title) || ''}
                onSaved={onRemarkSaved} compact />
            </span>
          )}
          {tbId && onFillDetails && (
            <button
              onClick={(e) => { e.stopPropagation(); onFillDetails(note) }}
              className="px-2 py-0.5 text-[10px] rounded font-medium border bg-white border-purple-400 text-purple-700 hover:bg-purple-50"
              title="Fill note details (Share Capital, shareholders etc.)"
            >
              ✏ Fill Details
            </button>
          )}
          {tbId && onGoToStock && /changes in inventor|cost of materials consumed/i.test(note.title || '') && (
            <button
              onClick={(e) => { e.stopPropagation(); onGoToStock() }}
              className="px-2 py-0.5 text-[10px] rounded font-medium border bg-white border-green-400 text-green-700 hover:bg-green-50"
              title="This note is computed automatically from the Stock tab's category entries — edit it there"
            >
              📦 Edit in Stock Menu
            </button>
          )}
          <button className="text-blue-200 text-xs" onClick={() => setExpanded(e => !e)}>
            {expanded ? 'collapse' : 'expand'}
          </button>
        </div>
      </div>

      {expanded && (
        <>
        {!hasDepSchedule && (
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-blue-50 border-b border-blue-200">
              <th className="text-left py-1.5 px-4 font-semibold text-blue-900 w-[55%]">Particulars</th>
              <th className="text-right py-1.5 px-3 font-semibold text-blue-900 w-[22%]">Current Year</th>
              <th className="text-right py-1.5 px-3 font-semibold text-blue-900 w-[22%]">Previous Year</th>
            </tr>
          </thead>
          <tbody>
            {/* Owners'/Partners' Capital Account: one line per party, carrying that
                party's balance BEFORE the year's share of profit — the "Profit and
                Loss for the Year" line below adds it, so the note still totals to
                the closing balance. PY is a single figure in the saved form, so it
                sits on the first party's line only. */}
            {isOwnersCapitalNote && (ownerDetails?.rows || []).map((r, oi) => r?.name ? (
              <tr key={`owner-${oi}`} className="border-b border-gray-200 bg-yellow-50">
                <td className="py-1 pl-4 pr-2 font-semibold text-gray-800">
                  {r.name}
                  {tbId && (
                    <span className="ml-1 align-middle">
                      <RemarkCell tbId={tbId} scope="notes" scopeKey={`${note.title}::${r.name}`}
                        initialValue={getRemark?.('notes', `${note.title}::${r.name}`) || ''}
                        onSaved={onRemarkSaved} compact />
                    </span>
                  )}
                </td>
                <td className="py-1 text-right font-mono pr-3 font-semibold">
                  {fmtINR(capRowExPL(r, ownerDetails.variant))}
                </td>
                <td className="py-1 text-right font-mono pr-3 text-gray-400">
                  {oi === 0 ? fmtINR(capPyExPL(ownerDetails)) : ''}
                </td>
              </tr>
            ) : null)}
            {/* PL note: Level 2 breakdown only (no ledger rows) */}
            {note.isPL && hasL2Lines && note.lines.map((line, li) => {
              // Revenue's sales ledgers not yet split into Sale of Goods / Sale
              // of Services (utils/revenueLines.js) are flagged like an
              // uncategorised line, and Fix asks for the split (their Level 3).
              const toSplit = unsplitSaleLine(note) === line
              const l2Uncat = (line.level2 || '').toLowerCase().includes('uncategorised') || toSplit
              // A ledger mapped straight to this note's Level 1 with no Level
              // 2 at all (e.g. Purchase Accounts under "Cost of materials
              // consumed" — see mapping-engine.js's applyPurchaseAccountsOverride)
              // is real and already counted in the note's total; it used to
              // vanish from this screen entirely because the render guard
              // below required a truthy level2. Same fallback label the
              // Annexures use (utils/annexureGrouping.js) so "→ Annexure"
              // still lands on the matching group there.
              const l2Label = plNoteLineLabel(note, line)
              const lineKey = l2Label + li
              // PL notes' ledger breakdown never went through
              // buildNoteTemplateRows/filterZeroNoteRows (that pipeline is
              // BS-only) — filter zero-balance ledgers here directly so
              // "Show zero-balance rows" actually governs this list too,
              // same as it does for BS notes.
              const visibleBreakdownRows = showZeroRows
                ? (line.rows || [])
                : (line.rows || []).filter(r =>
                    Math.abs(rowAmt(r, 'closing_balance')) >= 0.005 || Math.abs(rowAmt(r, 'opening_balance')) >= 0.005
                  )
              const hasBreakdown = visibleBreakdownRows.length > 0
              const lineExpanded = expandedLines.has(lineKey)
              // "Less: Closing …" is underlined — Opening minus this = the
              // Change in Inventory subtotal directly below it, same
              // convention as a manual worksheet.
              const isClosingLine = /^less:\s*closing/i.test(line.level2 || '')
              // Same lines the PDF and Excel print (utils/annexureGrouping.js plNoteLines).
              return isPrintedPlNoteLine(line) ? (
                <React.Fragment key={lineKey}>
                <tr className={`border-b border-gray-100 hover:bg-gray-50 ${l2Uncat ? 'bg-red-50' : ''}`}>
                  <td className={`py-1 pl-5 pr-2 font-medium ${l2Uncat ? 'text-red-700' : 'text-gray-800'} ${isClosingLine ? 'underline' : ''}`}>
                    {hasBreakdown && (
                      <button
                        onClick={() => toggleLine(lineKey)}
                        title={`Show the ${line.rows.length} ledger row(s) behind this figure`}
                        className="text-blue-500 hover:text-blue-700 mr-1 text-[10px] align-middle"
                      >{lineExpanded ? '▾' : '▸'}</button>
                    )}
                    {l2Label}
                    {toSplit && (
                      <span className="ml-1 text-[10px] font-normal text-red-600">— bifurcate into Sale of Goods / Sale of Services (Level 3)</span>
                    )}
                    {l2Uncat && onFix && (
                      <button
                        onClick={() => onFix(
                          fixFilterWith({ alie: note.alie, mapping1_resultant: note.title, mapping2_resultant: toSplit ? 'Sale' : line.level2 }, line.rows),
                          toSplit ? 'Bifurcate: Sale of Goods / Sale of Services' : `Fix: ${line.level2}`
                        )}
                        className="ml-2 px-1.5 py-0.5 text-[10px] rounded border border-red-400 text-red-700 bg-white hover:bg-red-100 transition font-normal"
                      >{toSplit ? 'Bifurcate' : 'Fix'}</button>
                    )}
                    {tbId && (
                      <span className="ml-1 align-middle">
                        <RemarkCell tbId={tbId} scope="notes" scopeKey={`${note.title}::${l2Label}`}
                          initialValue={getRemark?.('notes', `${note.title}::${l2Label}`) || ''}
                          onSaved={onRemarkSaved} compact />
                      </span>
                    )}
                    {onGoToAnnexure && !line.isSubtotal && (
                      <button
                        onClick={() => onGoToAnnexure(note.num, l2Label)}
                        title="Open this sub-note's ledger detail in Annexures"
                        className="ml-1 text-[10px] text-blue-500 hover:text-blue-700 hover:underline align-middle"
                      >→ Annexure</button>
                    )}
                  </td>
                  <td className={`py-1 text-right font-mono pr-3 ${isClosingLine ? 'underline' : ''}`}>{fmtINR(line.total)}</td>
                  <td className="py-1 pr-3">
                    {manualPyEnabled && line.manualPyEditable ? (
                      <ManualPyCell tbId={tbId} entityId={entity?.id} noteNum={note.num} noteTitle={note.title} label={l2Label} value={line.prevTotal} onSaved={onManualPySaved} isCustom={!!line.isCustomManual} entryId={line.manualPyEntryId ?? null} />
                    ) : (
                      <div className={`text-right font-mono text-gray-400 ${isClosingLine ? 'underline' : ''}`}>{fmtINR(line.prevTotal)}</div>
                    )}
                  </td>
                </tr>
                {hasBreakdown && lineExpanded && visibleBreakdownRows.map((row, ri) => (
                  <tr key={`${lineKey}-row-${ri}`} className="border-b border-gray-50 bg-blue-50/40">
                    <td className="py-0.5 pl-10 pr-2 text-gray-500 italic">{row.name || '(unnamed ledger)'}</td>
                    <td className="py-0.5 text-right font-mono pr-3 text-gray-500">{fmtINR(rowAmt(row, 'closing_balance'))}</td>
                    <td className="py-0.5 text-right font-mono pr-3 text-gray-500">{fmtINR(rowAmt(row, 'opening_balance'))}</td>
                  </tr>
                ))}
                </React.Fragment>
              ) : null
            })}
            {note.isPL && manualPyEnabled && (
              <AddManualPyRow tbId={tbId} entityId={entity?.id} noteNum={note.num} noteTitle={note.title} onSaved={onManualPySaved} />
            )}

            {/* BS note: LevelFormat template rows (L3 → options from L5/L6 "/" ) */}
            {!note.isPL && noteRows.map((r, ri) => {
              if (r.type === 'l3') {
                const l3Uncat = (r.label || '').toLowerCase().includes('uncategorised')
                const isHighlight = r.isHighlight
                return (
                  <tr key={ri} className={`border-b border-gray-200 ${
                    isHighlight      ? 'border-t border-t-red-300 bg-red-50'
                    : r.isSubtotal   ? 'border-t-2 border-t-gray-500 bg-blue-50'
                    : l3Uncat        ? 'bg-red-50'
                    :                  'bg-gray-50'
                  }`}>
                    <td className={`py-1 pl-4 pr-2 ${
                      isHighlight      ? 'font-semibold text-red-700'
                      : r.isSubtotal   ? 'font-bold text-gray-900'
                      : l3Uncat        ? 'font-semibold text-red-700'
                      :                  'font-semibold text-gray-700'
                    }`}>
                      {r.displayLabel || r.label}
                      {l3Uncat && onFix && (
                        <button
                          onClick={() => {
                            const filter = note.isPL
                              ? { alie: note.alie, mapping1_resultant: note.title, mapping3_resultant: r.label }
                              : { alie: note.alie, mapping1_resultant: note.level1, mapping2_resultant: note.title, mapping3_resultant: r.label }
                            onFix(fixFilterWithIds(filter, r.ledgerIds, r.pyLedgerIds), `Fix: ${r.label}`)
                          }}
                          className="ml-2 px-1.5 py-0.5 text-[10px] rounded border border-red-400 text-red-700 bg-white hover:bg-red-100 transition font-normal"
                        >Fix</button>
                      )}
                      {tbId && (
                        <span className="ml-1 align-middle">
                          <RemarkCell tbId={tbId} scope="notes" scopeKey={`${note.title}::${r.label}`}
                            initialValue={getRemark?.('notes', `${note.title}::${r.label}`) || ''}
                            onSaved={onRemarkSaved} compact />
                        </span>
                      )}
                      {onGoToAnnexure && !r.isSubtotal && !isHighlight && (
                        <button
                          onClick={() => onGoToAnnexure(note.num, r.label)}
                          title="Open this sub-note's ledger detail in Annexures"
                          className="ml-1 text-[10px] text-blue-500 hover:text-blue-700 hover:underline align-middle font-normal"
                        >→ Annexure</button>
                      )}
                    </td>
                    <td className={`py-1 text-right font-mono pr-3 ${isHighlight ? 'font-bold text-red-600' : r.isSubtotal ? 'font-bold' : 'font-semibold'}`}>{fmtINR(r.cy)}</td>
                    <td className="py-1 pr-3">
                      {manualPyEnabled && r.manualPyEditable ? (
                        <ManualPyCell tbId={tbId} entityId={entity?.id} noteNum={note.num} noteTitle={note.title} label={r.manualPyKey ?? r.label} value={r.py} onSaved={onManualPySaved} isCustom={!!r.isCustomManual} entryId={r.manualPyEntryId ?? null} />
                      ) : (
                        <div className={`text-right font-mono ${isHighlight ? 'font-bold text-red-600' : r.isSubtotal ? 'font-bold text-gray-600' : 'text-gray-400'}`}>{fmtINR(r.py)}</div>
                      )}
                    </td>
                  </tr>
                )
              }
              if (r.type === 'l4') {
                return (
                  <tr key={ri} className="border-b border-gray-100">
                    <td className="py-1 pl-8 text-gray-700 pr-2 font-medium">
                      {r.label}
                      {tbId && (
                        <span className="ml-1 align-middle">
                          <RemarkCell tbId={tbId} scope="notes" scopeKey={`${note.title}::${r.label}`}
                            initialValue={getRemark?.('notes', `${note.title}::${r.label}`) || ''}
                            onSaved={onRemarkSaved} compact />
                        </span>
                      )}
                    </td>
                    <td className="py-1 text-right font-mono pr-3">{fmtINR(r.cy)}</td>
                    <td className="py-1 text-right font-mono pr-3 text-gray-400">{fmtINR(r.py)}</td>
                  </tr>
                )
              }
              // option (from "/" splits)
              return (
                <tr key={ri} className={`border-b border-gray-50 ${r.unclassified ? 'bg-red-50' : ''}`}>
                  <td className={`py-0.5 pl-10 pr-2 italic ${r.unclassified ? 'text-red-600' : 'text-gray-600'}`}>
                    {r.unclassified ? `Unclassified${r.natureLevel ? ` — Level ${r.natureLevel}` : ''}` : r.label}
                    {r.unclassified && onFix && (
                      <button
                        onClick={() => onFix(
                          fixFilterWithIds(note.isPL
                            ? {
                                alie: note.alie,
                                mapping1_resultant: note.title,
                                mapping3_resultant: r.parentL3,
                                level5_unclassified: true,
                              }
                            : {
                                alie: note.alie,
                                mapping1_resultant: note.level1,
                                mapping2_resultant: note.title,
                                mapping3_resultant: r.parentL3,
                                level5_unclassified: true,
                              }, r.ledgerIds, r.pyLedgerIds, r.natureLevel),
                          `Fix Unclassified (Level ${r.natureLevel || 5}) — ${r.parentL3 || note.title}`
                        )}
                        className="ml-2 px-1.5 py-0.5 text-[10px] rounded border border-red-400 text-red-700 bg-white hover:bg-red-100 transition not-italic"
                      >
                        Fix
                      </button>
                    )}
                    {tbId && !r.unclassified && (
                      <span className="ml-1 align-middle not-italic">
                        <RemarkCell tbId={tbId} scope="notes" scopeKey={`${note.title}::${r.parentL3 || note.title}::${r.label}`}
                          initialValue={getRemark?.('notes', `${note.title}::${r.parentL3 || note.title}::${r.label}`) || ''}
                          onSaved={onRemarkSaved} compact />
                      </span>
                    )}
                  </td>
                  <td className="py-0.5 text-right font-mono pr-3 text-gray-700">{fmtINR(r.cy)}</td>
                  <td className="py-0.5 pr-3">
                    {manualPyEnabled && r.manualPyEditable ? (
                      <ManualPyCell tbId={tbId} entityId={entity?.id} noteNum={note.num} noteTitle={note.title} label={r.manualPyKey ?? `${r.parentL3} > ${r.label}`} value={r.py} onSaved={onManualPySaved} isCustom={!!r.isCustomManual} entryId={r.manualPyEntryId ?? null} />
                    ) : (
                      <div className="text-right font-mono text-gray-400">{fmtINR(r.py)}</div>
                    )}
                  </td>
                </tr>
              )
            })}
            {/* Fallback: no template rows (e.g. note title doesn't match any L2) —
                same lines the PDF and Excel print (bsNoteFallbackLines). */}
            {!note.isPL && (!noteRows || noteRows.length === 0) && bsNoteFallbackLines(note, rowAmt).map((l, gi) => (
              <tr key={l.label + gi} className={`border-b border-gray-200 ${l.isSubtotal ? 'border-t-2 border-t-gray-500 bg-blue-50' : 'bg-gray-50'}`}>
                <td className={`py-1 pl-4 pr-2 ${l.isSubtotal ? 'font-bold text-gray-900' : 'font-semibold text-gray-700'}`}>
                  {l.label}
                  {tbId && (
                    <span className="ml-1 align-middle">
                      <RemarkCell tbId={tbId} scope="notes" scopeKey={`${note.title}::${l.label}`}
                        initialValue={getRemark?.('notes', `${note.title}::${l.label}`) || ''}
                        onSaved={onRemarkSaved} compact />
                    </span>
                  )}
                </td>
                <td className={`py-1 text-right font-mono pr-3 ${l.isSubtotal ? 'font-bold' : 'font-semibold'}`}>{fmtINR(l.cy)}</td>
                <td className={`py-1 text-right font-mono pr-3 ${l.isSubtotal ? 'font-bold text-gray-600' : 'text-gray-400'}`}>{fmtINR(l.py)}</td>
              </tr>
            ))}
            {!note.isPL && manualPyEnabled && (
              <AddManualPyRow tbId={tbId} entityId={entity?.id} noteNum={note.num} noteTitle={note.title} onSaved={onManualPySaved} />
            )}
          </tbody>
          <tfoot>
            <tr className="bg-blue-50 border-t-2 border-blue-300">
              <td className="py-1.5 px-4 font-bold text-blue-800 text-xs">Total</td>
              <td className="py-1.5 text-right font-mono font-bold text-blue-800 pr-3">{fmtINR(note.total)}</td>
              <td className="py-1.5 pr-3">
                {manualPyEnabled && 'manualPyFlatEntry' in note ? (
                  <ManualPyCell tbId={tbId} entityId={entity?.id} noteNum={note.num} noteTitle={note.title} label="" value={note.prevTotal} onSaved={onManualPySaved} />
                ) : (
                  <div className="text-right font-mono font-bold text-blue-800">{fmtINR(note.prevTotal)}</div>
                )}
              </td>
            </tr>
          </tfoot>
        </table>
        )}

        {/* MSME Disclosure Table (separate section) */}
        {msmeHeaderRow && msmeRows.length > 0 && (
          <div className="mt-6 pt-6 border-t-2 border-blue-300">
            <h3 className="text-sm font-bold text-blue-900 mb-3 px-4">{msmeHeaderRow.label}</h3>
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-amber-50 border-b border-amber-200">
                  <th className="text-left py-1.5 px-4 font-semibold text-amber-900 w-[55%]">Particulars</th>
                  <th className="text-right py-1.5 px-3 font-semibold text-amber-900 w-[22%]">Current Year</th>
                  <th className="text-right py-1.5 px-3 font-semibold text-amber-900 w-[22%]">Previous Year</th>
                </tr>
              </thead>
              <tbody>
                {msmeRows.map((r, ri) => (
                  <tr key={ri} className="border-b border-amber-100 hover:bg-amber-50/50 bg-amber-50/30">
                    <td className="py-1 pl-5 pr-2 text-gray-700 text-[11px] leading-relaxed">{r.label}</td>
                    <td className="py-1 text-right font-mono pr-3 text-gray-800 font-medium">{fmtINR(r.cy)}</td>
                    <td className="py-1 pr-3">
                      {manualPyEnabled && r.manualPyEditable ? (
                        <ManualPyCell tbId={tbId} entityId={entity?.id} noteNum={note.num} noteTitle={note.title} label={r.manualPyKey ?? `${r.parentL3} > ${r.label}`} value={r.py} onSaved={onManualPySaved} isCustom={!!r.isCustomManual} entryId={r.manualPyEntryId ?? null} />
                      ) : (
                        <div className="text-right font-mono text-gray-500 font-medium">{fmtINR(r.py)}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[10px] text-gray-400 mt-2 px-4 pb-2">
              Source: Micro, Small and Medium Enterprises Development Act, 2006
            </p>
          </div>
        )}

        {/* Cash & Bank Details Table (separate section) */}
        {cashBankHeaderRow && cashBankRows.length > 0 && (
          <div className="mt-6 pt-6 border-t-2 border-green-300">
            <h3 className="text-sm font-bold text-green-900 mb-3 px-4">{cashBankHeaderRow.label}</h3>
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-green-50 border-b border-green-200">
                  <th className="text-left py-1.5 px-4 font-semibold text-green-900 w-[55%]">Particulars</th>
                  <th className="text-right py-1.5 px-3 font-semibold text-green-900 w-[22%]">{cashBankRows.some(r => Number(r.py)) ? 'Amount — CY (₹)' : 'Amount (₹)'}</th>
                  {cashBankRows.some(r => Number(r.py)) && <th className="text-right py-1.5 px-3 font-semibold text-green-900 w-[18%]">Amount — PY (₹)</th>}
                  <th className="text-left py-1.5 px-3 font-semibold text-green-900 w-[23%]">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {cashBankRows.map((r, ri) => {
                  // Extract remarks from label if present
                  const labelMatch = r.label.match(/^\(.\)\s(.+?)\s—\s(.+)$/)
                  const mainLabel = labelMatch ? labelMatch[1] : r.label
                  const remarks = labelMatch ? labelMatch[2] : ''
                  return (
                    <tr key={ri} className="border-b border-green-100 hover:bg-green-50/50 bg-green-50/30">
                      <td className="py-1 pl-5 pr-2 text-gray-700 text-[11px] leading-relaxed">{mainLabel}</td>
                      <td className="py-1 text-right font-mono pr-3 text-gray-800 font-medium">{fmtINR(r.cy)}</td>
                      {cashBankRows.some(x => Number(x.py)) && <td className="py-1 text-right font-mono pr-3 text-gray-500">{fmtINR(r.py)}</td>}
                      <td className="py-1 pl-3 pr-3 text-gray-600 text-[10px]">{remarks}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="text-[10px] text-gray-400 mt-2 px-4 pb-2">
              Source: IND AS 7 (Cash Flow Statements) and Schedule III, Companies Act, 2013
            </p>
          </div>
        )}

        {/* Trade Payables Ageing Schedule (separate section) */}
        {note.trPayablesAgingData && (note.trPayablesAgingData.cy || note.trPayablesAgingData.py) && (
          <div className="mt-6 pt-6 border-t-2 border-indigo-300 px-4 pb-4">
            <h3 className="text-sm font-bold text-indigo-900 mb-3">Trade Payables ageing schedule</h3>
            <AgeingDisplayTable heading="Current Year" periodData={note.trPayablesAgingData.cy} rows={TP_AGEING_ROWS} buckets={TP_AGEING_BUCKETS} />
            <AgeingDisplayTable heading="Previous Year" periodData={note.trPayablesAgingData.py} rows={TP_AGEING_ROWS} buckets={TP_AGEING_BUCKETS} />
          </div>
        )}

        {/* Trade Receivables Ageing Schedule (separate section) */}
        {note.trReceivablesAgingData && (note.trReceivablesAgingData.cy || note.trReceivablesAgingData.py) && (
          <div className="mt-6 pt-6 border-t-2 border-indigo-300 px-4 pb-4">
            <h3 className="text-sm font-bold text-indigo-900 mb-3">Trade Receivables ageing schedule</h3>
            <AgeingDisplayTable heading="Current Year" periodData={note.trReceivablesAgingData.cy} rows={TR_AGEING_ROWS} buckets={TR_AGEING_BUCKETS} computeCell={trComputedCell} />
            <AgeingDisplayTable heading="Previous Year" periodData={note.trReceivablesAgingData.py} rows={TR_AGEING_ROWS} buckets={TR_AGEING_BUCKETS} computeCell={trComputedCell} />
          </div>
        )}

        {/* Trade Receivables ageing table — Proprietorship / Partnership / LLP (Company has its own schedule above). Always shown; defaults to Unsecured, considered good. */}
        {note.ncTradeReceivables && (
          <div className="mt-6 pt-6 border-t-2 border-indigo-300 px-4 pb-4">
            <NcAgeingDisplayTable saved={note.ncTradeReceivables.saved} noteTotal={note.total} fmtAmount={fmtINR} />
          </div>
        )}

        {/* Include Dep(IT) Block Summary toggle — mirrors the same checkbox on
            Dep (IT) → Block Summary, right here so no trip back is needed. */}
        {note.itBlockSummaryAvailable && (
          <label className="flex items-center gap-2 mx-4 mt-4 text-[11px] text-orange-900 cursor-pointer select-none">
            <input type="checkbox" checked={!!note.itBlockSummaryIncluded} disabled={togglingITBlock}
              onChange={e => handleToggleITBlockSummary(e.target.checked)} />
            Include Dep (IT) Block Summary in this note
          </label>
        )}

        {/* Include Dep (Comp) Fixed Assets Schedule toggle — mirrors the same
            checkbox on the Dep (Comp) screen. Mutually exclusive with Dep (IT)
            above (checking one clears the other via the handlers). */}
        {note.compScheduleAvailable && (
          <label className="flex items-center gap-2 mx-4 mt-4 text-[11px] text-orange-900 cursor-pointer select-none">
            <input type="checkbox" checked={!!note.compScheduleIncluded} disabled={togglingCompSchedule}
              onChange={e => handleToggleCompSchedule(e.target.checked)} />
            Include Dep (Comp) Fixed Assets Schedule in this note
          </label>
        )}

        {/* IT Act Block-wise WDV Summary (opt-in from Dep (IT) → Block Summary) */}
        {note.itBlockSummaryData && note.itBlockSummaryData.length > 0 && (() => {
          const totals = note.itBlockSummaryData.reduce((s, b) => ({
            openingWDV: s.openingWDV + (b.openingWDV || 0),
            additions: s.additions + (b.addBefore180 || 0) + (b.addAfter180 || 0),
            deduction: s.deduction + (b.deduction || 0),
            depreciation: s.depreciation + (b.depreciation || 0),
            closingWDV: s.closingWDV + (b.closingWDV || 0),
          }), { openingWDV: 0, additions: 0, deduction: 0, depreciation: 0, closingWDV: 0 })
          return (
            <div className={hasITBlock ? 'px-4 pb-4' : 'mt-6 pt-6 border-t-2 border-blue-300 px-4 pb-4'}>
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-blue-50 border-b border-blue-200">
                    <th className="text-left py-1.5 px-4 font-semibold text-blue-900">Particulars</th>
                    <th className="text-right py-1.5 px-3 font-semibold text-blue-900">Rate</th>
                    <th className="text-right py-1.5 px-3 font-semibold text-blue-900">Opening WDV</th>
                    <th className="text-right py-1.5 px-3 font-semibold text-blue-900">Additions</th>
                    <th className="text-right py-1.5 px-3 font-semibold text-blue-900">Deduction</th>
                    <th className="text-right py-1.5 px-3 font-semibold text-blue-900">Depreciation</th>
                    <th className="text-right py-1.5 px-3 font-semibold text-blue-900">Closing WDV</th>
                  </tr>
                </thead>
                <tbody>
                  {note.itBlockSummaryData.map((b, i) => (
                    <tr key={i} className="border-b border-gray-100 hover:bg-blue-50/40">
                      <td className="py-1 px-4 text-gray-700">{b.block}</td>
                      <td className="py-1 text-right font-mono px-3 text-gray-600">{b.rate}%</td>
                      <td className="py-1 text-right font-mono px-3 text-gray-800">{fmtINR(b.openingWDV)}</td>
                      <td className="py-1 text-right font-mono px-3 text-gray-800">{fmtINR((b.addBefore180 || 0) + (b.addAfter180 || 0))}</td>
                      <td className="py-1 text-right font-mono px-3 text-gray-800">{fmtINR(b.deduction)}</td>
                      <td className="py-1 text-right font-mono px-3 text-gray-800">{fmtINR(b.depreciation)}</td>
                      <td className="py-1 text-right font-mono px-3 text-gray-900 font-semibold">{fmtINR(b.closingWDV)}</td>
                    </tr>
                  ))}
                  <tr className="bg-blue-50 border-t-2 border-blue-300 font-bold">
                    <td className="py-1.5 px-4 text-blue-900">Total</td>
                    <td className="py-1.5 text-right font-mono px-3"></td>
                    <td className="py-1.5 text-right font-mono px-3 text-blue-900">{fmtINR(totals.openingWDV)}</td>
                    <td className="py-1.5 text-right font-mono px-3 text-blue-900">{fmtINR(totals.additions)}</td>
                    <td className="py-1.5 text-right font-mono px-3 text-blue-900">{fmtINR(totals.deduction)}</td>
                    <td className="py-1.5 text-right font-mono px-3 text-blue-900">{fmtINR(totals.depreciation)}</td>
                    <td className="py-1.5 text-right font-mono px-3 text-blue-900">{fmtINR(totals.closingWDV)}</td>
                  </tr>
                  {note.itBlockSummaryPyTotals && (
                    <tr className="bg-gray-50">
                      <td className="py-1 px-4 text-gray-500 text-[11px] italic">Previous Year</td>
                      <td className="py-1 text-right font-mono px-3"></td>
                      <td className="py-1 text-right font-mono px-3 text-gray-700">{fmtINR(note.itBlockSummaryPyTotals.openingWDV)}</td>
                      <td className="py-1 text-right font-mono px-3 text-gray-700">{fmtINR((note.itBlockSummaryPyTotals.addBefore180 || 0) + (note.itBlockSummaryPyTotals.addAfter180 || 0))}</td>
                      <td className="py-1 text-right font-mono px-3 text-gray-700">{fmtINR(note.itBlockSummaryPyTotals.deduction)}</td>
                      <td className="py-1 text-right font-mono px-3 text-gray-700">{fmtINR(note.itBlockSummaryPyTotals.depreciation)}</td>
                      <td className="py-1 text-right font-mono px-3 text-gray-700">{fmtINR(note.itBlockSummaryPyTotals.closingWDV)}</td>
                    </tr>
                  )}
                  {/* Capital WIP / Intangible WIP — no depreciation is charged on assets
                      still under construction/development, so these are manually entered
                      on the Dep (IT) screen. Hidden entirely, along with the combined
                      grand total below, whenever nothing has been entered. */}
                  {note.itWip && (note.itWip.capitalCY || note.itWip.intangibleCY || note.itWip.prevYearTotal) && (
                    <>
                      <tr className="border-b border-gray-100">
                        <td className="py-1 px-4 text-gray-700">Capital Work in Progress</td>
                        <td className="py-1 text-right font-mono px-3"></td>
                        <td className="py-1 text-right font-mono px-3"></td>
                        <td className="py-1 text-right font-mono px-3"></td>
                        <td className="py-1 text-right font-mono px-3"></td>
                        <td className="py-1 text-right font-mono px-3"></td>
                        <td className="py-1 text-right font-mono px-3 text-gray-800">{fmtINR(note.itWip.capitalCY)}</td>
                      </tr>
                      <tr className="border-b border-gray-100">
                        <td className="py-1 px-4 text-gray-700">Intangible Work in Progress</td>
                        <td className="py-1 text-right font-mono px-3"></td>
                        <td className="py-1 text-right font-mono px-3"></td>
                        <td className="py-1 text-right font-mono px-3"></td>
                        <td className="py-1 text-right font-mono px-3"></td>
                        <td className="py-1 text-right font-mono px-3"></td>
                        <td className="py-1 text-right font-mono px-3 text-gray-800">{fmtINR(note.itWip.intangibleCY)}</td>
                      </tr>
                      <tr className="bg-blue-50 border-t border-blue-200 font-semibold">
                        <td className="py-1.5 px-4 text-blue-900">Total (Work in Progress)</td>
                        <td className="py-1.5 text-right font-mono px-3"></td>
                        <td className="py-1.5 text-right font-mono px-3"></td>
                        <td className="py-1.5 text-right font-mono px-3"></td>
                        <td className="py-1.5 text-right font-mono px-3"></td>
                        <td className="py-1.5 text-right font-mono px-3"></td>
                        <td className="py-1.5 text-right font-mono px-3 text-blue-900">{fmtINR((parseFloat(note.itWip.capitalCY) || 0) + (parseFloat(note.itWip.intangibleCY) || 0))}</td>
                      </tr>
                      <tr className="bg-gray-50">
                        <td className="py-1 px-4 text-gray-500 text-[11px] italic">Previous Year (Work in Progress)</td>
                        <td className="py-1 text-right font-mono px-3"></td>
                        <td className="py-1 text-right font-mono px-3"></td>
                        <td className="py-1 text-right font-mono px-3"></td>
                        <td className="py-1 text-right font-mono px-3"></td>
                        <td className="py-1 text-right font-mono px-3"></td>
                        <td className="py-1 text-right font-mono px-3 text-gray-700">{fmtINR(note.itWip.prevYearTotal)}</td>
                      </tr>
                      <tr className="bg-blue-100 border-t-2 border-blue-300 font-bold">
                        <td className="py-1.5 px-4 text-blue-900">Total PPE &amp; Intangible Assets including work in progress</td>
                        <td className="py-1.5 text-right font-mono px-3"></td>
                        <td className="py-1.5 text-right font-mono px-3"></td>
                        <td className="py-1.5 text-right font-mono px-3"></td>
                        <td className="py-1.5 text-right font-mono px-3"></td>
                        <td className="py-1.5 text-right font-mono px-3"></td>
                        <td className="py-1.5 text-right font-mono px-3 text-blue-900">{fmtINR(totals.closingWDV + (parseFloat(note.itWip.capitalCY) || 0) + (parseFloat(note.itWip.intangibleCY) || 0))}</td>
                      </tr>
                      <tr className="bg-gray-50">
                        <td className="py-1 px-4 text-gray-500 text-[11px] italic">Previous Year</td>
                        <td className="py-1 text-right font-mono px-3"></td>
                        <td className="py-1 text-right font-mono px-3"></td>
                        <td className="py-1 text-right font-mono px-3"></td>
                        <td className="py-1 text-right font-mono px-3"></td>
                        <td className="py-1 text-right font-mono px-3"></td>
                        <td className="py-1 text-right font-mono px-3 text-gray-700">{fmtINR((note.itBlockSummaryPyTotals ? (parseFloat(note.itBlockSummaryPyTotals.closingWDV) || 0) : 0) + (parseFloat(note.itWip.prevYearTotal) || 0))}</td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>
          )
        })()}

        {/* Dep (Comp) category-level Schedule II schedule (opt-in from Dep (Comp)) */}
        {note.compScheduleData && note.compScheduleData.length > 0 && (() => {
          const num = (v) => parseFloat(v) || 0
          const totals = note.compScheduleData.reduce((s, r) => ({
            grossOpen: s.grossOpen + num(r.grossOpen),
            additions: s.additions + num(r.additions),
            deductions: s.deductions + num(r.deductions),
            grossClose: s.grossClose + num(r.grossClose),
            depOpen: s.depOpen + num(r.depOpen),
            depForYear: s.depForYear + num(r.depForYear),
            depOnDisposal: s.depOnDisposal + num(r.depOnDisposal),
            depClose: s.depClose + num(r.depClose),
            netBlockOpen: s.netBlockOpen + num(r.netBlockOpen),
            netBlockClose: s.netBlockClose + num(r.netBlockClose),
          }), { grossOpen: 0, additions: 0, deductions: 0, grossClose: 0, depOpen: 0, depForYear: 0, depOnDisposal: 0, depClose: 0, netBlockOpen: 0, netBlockClose: 0 })
          const tbCY = num(note.compScheduleTbCY), tbPY = num(note.compScheduleTbPY)
          const diffCY = totals.netBlockClose - tbCY, diffPY = totals.netBlockOpen - tbPY
          return (
            <div className={hasCompSchedule ? 'px-4 pb-4' : 'mt-6 pt-6 border-t-2 border-blue-300 px-4 pb-4'}>
              <div className="overflow-x-auto">
                <table className="text-xs" style={{ minWidth: 900 }}>
                  <thead>
                    <tr className="bg-blue-50 border-b border-blue-200">
                      <th rowSpan={2} className="text-left py-1.5 px-3 font-semibold text-blue-900 align-bottom">Asset Category</th>
                      <th colSpan={4} className="text-center py-1 px-3 font-semibold text-blue-900 border-l border-blue-200">Gross Block</th>
                      <th colSpan={4} className="text-center py-1 px-3 font-semibold text-blue-900 border-l border-blue-200">Depreciation</th>
                      <th colSpan={2} className="text-center py-1 px-3 font-semibold text-blue-900 border-l border-blue-200">Net Block</th>
                    </tr>
                    <tr className="bg-blue-50 border-b border-blue-200">
                      <th className="text-right py-1 px-3 font-medium text-blue-800 border-l border-blue-200">Opening</th>
                      <th className="text-right py-1 px-3 font-medium text-blue-800">Additions</th>
                      <th className="text-right py-1 px-3 font-medium text-blue-800">Deductions</th>
                      <th className="text-right py-1 px-3 font-medium text-blue-800">Closing</th>
                      <th className="text-right py-1 px-3 font-medium text-blue-800 border-l border-blue-200">Opening</th>
                      <th className="text-right py-1 px-3 font-medium text-blue-800">For Year</th>
                      <th className="text-right py-1 px-3 font-medium text-blue-800">On Disposal</th>
                      <th className="text-right py-1 px-3 font-medium text-blue-800">Closing</th>
                      <th className="text-right py-1 px-3 font-medium text-blue-800 border-l border-blue-200">Opening</th>
                      <th className="text-right py-1 px-3 font-medium text-blue-800">Closing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {note.compScheduleData.map((r, i) => (
                      <tr key={i} className="border-b border-gray-100 hover:bg-blue-50/40">
                        <td className="py-1 px-3 text-gray-700">{r.category}</td>
                        <td className="py-1 text-right font-mono px-3 text-gray-800 border-l border-gray-100">{fmtINR(r.grossOpen)}</td>
                        <td className="py-1 text-right font-mono px-3 text-gray-800">{fmtINR(r.additions)}</td>
                        <td className="py-1 text-right font-mono px-3 text-gray-800">{fmtINR(r.deductions)}</td>
                        <td className="py-1 text-right font-mono px-3 text-gray-900 font-semibold">{fmtINR(r.grossClose)}</td>
                        <td className="py-1 text-right font-mono px-3 text-gray-800 border-l border-gray-100">{fmtINR(r.depOpen)}</td>
                        <td className="py-1 text-right font-mono px-3 text-red-700">{fmtINR(r.depForYear)}</td>
                        <td className="py-1 text-right font-mono px-3 text-gray-800">{fmtINR(r.depOnDisposal)}</td>
                        <td className="py-1 text-right font-mono px-3 text-gray-900 font-semibold">{fmtINR(r.depClose)}</td>
                        <td className="py-1 text-right font-mono px-3 text-orange-800 border-l border-gray-100">{fmtINR(r.netBlockOpen)}</td>
                        <td className="py-1 text-right font-mono px-3 text-orange-800 font-semibold">{fmtINR(r.netBlockClose)}</td>
                      </tr>
                    ))}
                    <tr className="bg-blue-50 border-t-2 border-blue-300 font-bold">
                      <td className="py-1.5 px-3 text-blue-900">Total</td>
                      <td className="py-1.5 text-right font-mono px-3 text-blue-900 border-l border-blue-200">{fmtINR(totals.grossOpen)}</td>
                      <td className="py-1.5 text-right font-mono px-3 text-blue-900">{fmtINR(totals.additions)}</td>
                      <td className="py-1.5 text-right font-mono px-3 text-blue-900">{fmtINR(totals.deductions)}</td>
                      <td className="py-1.5 text-right font-mono px-3 text-blue-900">{fmtINR(totals.grossClose)}</td>
                      <td className="py-1.5 text-right font-mono px-3 text-blue-900 border-l border-blue-200">{fmtINR(totals.depOpen)}</td>
                      <td className="py-1.5 text-right font-mono px-3 text-blue-900">{fmtINR(totals.depForYear)}</td>
                      <td className="py-1.5 text-right font-mono px-3 text-blue-900">{fmtINR(totals.depOnDisposal)}</td>
                      <td className="py-1.5 text-right font-mono px-3 text-blue-900">{fmtINR(totals.depClose)}</td>
                      <td className="py-1.5 text-right font-mono px-3 text-blue-900 border-l border-blue-200">{fmtINR(totals.netBlockOpen)}</td>
                      <td className="py-1.5 text-right font-mono px-3 text-blue-900">{fmtINR(totals.netBlockClose)}</td>
                    </tr>
                    {note.compSchedulePyTotals && (
                      <tr className="bg-gray-50">
                        <td className="py-1 px-3 text-gray-500 text-[11px] italic">Previous Year</td>
                        <td className="py-1 text-right font-mono px-3 text-gray-700 border-l border-gray-200">{fmtINR(note.compSchedulePyTotals.grossOpen)}</td>
                        <td className="py-1 text-right font-mono px-3 text-gray-700">{fmtINR(note.compSchedulePyTotals.additions)}</td>
                        <td className="py-1 text-right font-mono px-3 text-gray-700">{fmtINR(note.compSchedulePyTotals.deductions)}</td>
                        <td className="py-1 text-right font-mono px-3 text-gray-700">{fmtINR(note.compSchedulePyTotals.grossClose)}</td>
                        <td className="py-1 text-right font-mono px-3 text-gray-700 border-l border-gray-200">{fmtINR(note.compSchedulePyTotals.depOpen)}</td>
                        <td className="py-1 text-right font-mono px-3 text-gray-700">{fmtINR(note.compSchedulePyTotals.depForYear)}</td>
                        <td className="py-1 text-right font-mono px-3 text-gray-700">{fmtINR(note.compSchedulePyTotals.depOnDisposal)}</td>
                        <td className="py-1 text-right font-mono px-3 text-gray-700">{fmtINR(note.compSchedulePyTotals.depClose)}</td>
                        <td className="py-1 text-right font-mono px-3 text-gray-700 border-l border-gray-200">{fmtINR(note.compSchedulePyTotals.netBlockOpen)}</td>
                        <td className="py-1 text-right font-mono px-3 text-gray-700">{fmtINR(note.compSchedulePyTotals.netBlockClose)}</td>
                      </tr>
                    )}
                    <tr className="bg-gray-50">
                      <td className="py-1 px-3 text-gray-500 text-[11px]" colSpan={9}>Total as per Trial Balance</td>
                      <td className="py-1 text-right font-mono px-3 text-gray-700 border-l border-gray-200">{fmtINR(tbPY)}</td>
                      <td className="py-1 text-right font-mono px-3 text-gray-700">{fmtINR(tbCY)}</td>
                    </tr>
                    <tr className="bg-gray-50">
                      <td className="py-1 px-3 text-gray-500 text-[11px]" colSpan={9}>Difference</td>
                      <td className={`py-1 text-right font-mono px-3 font-semibold border-l border-gray-200 ${Math.abs(diffPY) < 1 ? 'text-green-700' : 'text-red-700'}`}>{fmtINR(diffPY)}</td>
                      <td className={`py-1 text-right font-mono px-3 font-semibold ${Math.abs(diffCY) < 1 ? 'text-green-700' : 'text-red-700'}`}>{fmtINR(diffCY)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )
        })()}

        {/* Optional free-text disclosure — shown in PDF/Excel exports when filled */}
        <DisclosureNote tbId={tbId} entityId={entity?.id} note={note} />
        </>
      )}
    </div>
  )
}

// ── Optional disclosure note — free text shown below a note's table, saved
// against the note's title (see src/main/db/noteStore.js), included in PDF/Excel
// exports only when non-empty.
function DisclosureNote({ tbId, entityId, note }) {
  const [text, setText] = useState('')
  const [saved, setSaved] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // The Consolidated view of a branch entity is not a Trial Balance: its notes are saved against the Auditee
  const entityLevel = tbId === '__consolidated__'
  const scopeId = entityLevel ? entityId : tbId

  useEffect(() => {
    if (!scopeId || !note?.num) { setLoading(false); return }
    setLoading(true)
    const read = entityLevel ? window.api?.getEntityNoteDisclosure(scopeId, note.num, note.title) : window.api?.getNoteDisclosure(scopeId, note.num, note.title)
    Promise.resolve(read)
      .then(t => { setText(t || ''); setSaved(t || '') })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [scopeId, entityLevel, note?.num, note?.title])

  const dirty = text !== saved
  const save = async () => {
    if (!scopeId || !note?.num || !dirty) return
    setSaving(true); setError('')
    try {
      if (entityLevel) await window.api?.saveEntityNoteDisclosure({ entityId: scopeId, noteNum: note.num, noteTitle: note.title, text })
      else await window.api?.saveNoteDisclosure({ tbId: scopeId, noteNum: note.num, noteTitle: note.title, text })
      setSaved(text)
    } catch (e) {
      setError('Could not save this disclosure: ' + (e?.message || e))   // never lost silently
    } finally {
      setSaving(false)
    }
  }

  if (!scopeId || loading) return null
  return (
    <div className="mt-4 pt-4 border-t border-gray-200 px-4 pb-4">
      <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
        Disclosure Note <span className="normal-case font-normal text-gray-400">(optional — included in PDF/Excel when filled in)</span>
      </label>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        onBlur={save}
        rows={4}
        placeholder="Add any additional disclosure for this note…"
        className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs text-gray-700 focus:ring-2 focus:ring-blue-400 focus:outline-none resize-y max-h-[240px] overflow-y-auto"
      />
      {saving && <span className="text-[10px] text-gray-400">Saving…</span>}
      {!saving && !error && text && text === saved && <span className="text-[10px] text-green-600">Saved - printed below this note in the PDF and Excel</span>}
      {error && <span className="text-[10px] text-red-600">{error}</span>}
    </div>
  )
}

// ── Default nature assignments for key BS notes ───────────────────────────────
const NATURE_DEFAULTS = [
  {
    pattern: /trade\s+receivab/i,
    searchKey: 'trade receivab',   // plain substring sent to bulkSetNature LIKE filter
    label: 'Trade Receivables',
    defaultNature: 'Unsecured, Considered Good',
    options: ['Secured, Considered Good', 'Unsecured, Considered Good', 'Doubtful'],
  },
  {
    pattern: /trade\s+payab/i,
    searchKey: 'trade payab',
    label: 'Trade Payables',
    defaultNature: 'Due to Creditors other than MSME',
    options: ['Due to Creditors other than MSME', 'Due to Micro and Small Enterprises (MSME)'],
  },
]

function NatureAssignModal({ items, onApply, onCancel }) {
  const [values, setValues] = useState(() => items.map(i => i.defaultNature))
  const [confirmed, setConfirmed] = useState(false)

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-box max-w-lg" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-blue-900">Auto-Assign Nature of Balances</h2>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>
        <p className="text-xs text-gray-600 mb-4 leading-relaxed">
          The following notes have ledgers whose <strong>nature of balance</strong> has not yet been classified.
          The system has suggested a default classification for each. Please review and adjust if required,
          then confirm to apply the assignment. Only ledgers without an existing nature will be updated.
        </p>
        <div className="space-y-3 mb-4">
          {items.map((item, i) => (
            <div key={item.label} className="border border-blue-100 rounded-lg p-3 bg-blue-50/40">
              <div className="text-xs font-semibold text-blue-900 mb-1">{item.label}</div>
              <div className="text-xs text-gray-500 mb-2">Select the nature that applies to the majority of balances under this head:</div>
              <select
                value={values[i]}
                onChange={e => setValues(v => v.map((x, j) => j === i ? e.target.value : x))}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white focus:ring-2 focus:ring-blue-400 focus:outline-none"
              >
                {item.options.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          ))}
        </div>
        <label className="flex items-start gap-2 text-xs text-gray-700 cursor-pointer mb-4">
          <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}
            className="mt-0.5 rounded border-gray-400" />
          <span>I have reviewed the above nature assignments and confirm they are correct for this entity.</span>
        </label>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel}
            className="px-4 py-2 border border-gray-300 text-gray-600 rounded text-xs hover:bg-gray-50 transition">
            Skip for Now
          </button>
          <button
            disabled={!confirmed}
            onClick={() => onApply(items.map((item, i) => ({ ...item, chosenNature: values[i] })))}
            className="px-4 py-2 text-white rounded text-xs font-medium transition disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'var(--color-primary)' }}
          >
            Apply Auto-Assignment
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Assumption disclosure popup ──────────────────────────────────────────────
// mapping-engine.js's applyTradeAssumption() tags a ledger's override_note as
// 'On assumption' whenever Trade Payables (MSME) / Trade Receivables
// (Secured/Unsecured/Doubtful) nature couldn't be conclusively determined
// from the ledger name or group hierarchy, and a safe default was picked
// instead. This surfaces those ledgers for review — same mechanism for
// Company, LLP, and non-corporate entities alike.
// Only the first rows are drawn. A branch of tens of thousands of customer and supplier ledgers can have most of them "on assumption", and
// this dialog opens by itself when Notes loads: drawing every one froze the window. The Rectification / Recategorisation screen lists
// them all, a page at a time.
const ASSUMPTION_ROWS_SHOWN = 300
export function AssumptionDisclosureModal({ items, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box max-w-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-blue-900">Assumption Followed in Categorisation</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>
        <p className="text-xs text-gray-600 mb-4 leading-relaxed">
          The following ledgers could not be conclusively classified from their name or books hierarchy, so a
          default nature was assumed. Please review and correct via the Categorisation tab (Mapping 3 / Level 3)
          if any of these are wrong for this entity.
        </p>
        <div className="max-h-80 overflow-y-auto border border-gray-200 rounded mb-4">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="text-left px-2 py-1.5 border-b border-gray-200">Ledger</th>
                <th className="text-left px-2 py-1.5 border-b border-gray-200">Note</th>
                <th className="text-left px-2 py-1.5 border-b border-gray-200">Assumed As</th>
                <th className="text-right px-2 py-1.5 border-b border-gray-200">CY Balance</th>
              </tr>
            </thead>
            <tbody>
              {items.slice(0, ASSUMPTION_ROWS_SHOWN).map((r, i) => (
                <tr key={i} className="border-t border-gray-100">
                  <td className="px-2 py-1">{r.name}</td>
                  <td className="px-2 py-1 text-gray-500">{r.noteTitle}</td>
                  <td className="px-2 py-1 font-medium text-amber-700">{r.assumedAs}</td>
                  <td className="px-2 py-1 text-right font-mono text-gray-700">{fmtINR(r.cy)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {items.length > ASSUMPTION_ROWS_SHOWN && (
          <p className="text-xs text-gray-500 mb-4" data-testid="assumption-cap">
            Showing the first {ASSUMPTION_ROWS_SHOWN} of {items.length.toLocaleString('en-IN')} ledgers. The Rectification / Recategorisation screen lists all of them, a page at a time.
          </p>
        )}
        <div className="flex justify-end">
          <button onClick={onClose}
            className="px-4 py-2 text-white rounded text-xs font-medium transition"
            style={{ background: 'var(--color-primary)' }}>
            Reviewed, Close
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Notes({ entity, activeTB, prevTB, activeRsId, onPrevTBChange, highlightNote, onHighlightClear, onGoToAnnexure, onGoToStock, onFixNavigate }) {
  const { data, loading, error, refresh } = useFinancials(activeTB, prevTB, entity, activeRsId)
  const [search, setSearch] = useState('')
  const [showEmpty, setShowEmpty] = useState(false)
  const [showZeroRows, setShowZeroRows] = useState(false)
  // "Fix" jumps to the full Rectification / Recategorisation screen, scoped
  // to just the clicked category — same screen/features as the Mapping menu.
  const openFix = (filter, title) => onFixNavigate?.(filter, title)
  // Branch entities: Manual PY and a real Previous Year TB selection are
  // mutually exclusive — see BS/index.jsx for the full rationale.
  const isBranchEntity = !!entity?.has_branches
  // Fill Details (Share Capital, Owners' Capital, LTB, STB, Trade
  // Payables/Receivables, Cash & Bank) are entity-wide facts for a branch
  // entity — one Share Capital, one set of partners, not one per branch —
  // exactly like noteDetailsModal's own commonProps below (useEntityLevel).
  // The bulk "Download/Upload Fill Details" workbook used to skip that and
  // always call the per-TB API with activeTB.id: on a real branch TB that
  // silently wrote into a table nothing else reads from, and in Consolidated
  // mode (activeTB.id === '__consolidated__', not a number) note_details.tb_id
  // is INTEGER NOT NULL, so the write failed outright — "the excel being
  // uploaded is not working." These two helpers are the single place that
  // decides where a note detail record lives, reused by every save/get below.
  const noteDetailsGet = (noteNum, noteTitle) => isBranchEntity
    ? window.api?.getEntityNoteDetails(entity.id, noteNum, noteTitle)
    : window.api?.getNoteDetails(activeTB.id, noteNum, noteTitle)
  const noteDetailsSave = ({ noteNum, noteTitle, data }) => isBranchEntity
    ? window.api?.saveEntityNoteDetails({ entityId: entity.id, noteNum, noteTitle, data })
    : window.api?.saveNoteDetails({ tbId: activeTB.id, noteNum, noteTitle, data })
  const noteDetailsList = () => isBranchEntity
    ? window.api?.listEntityNoteDetails(entity.id)
    : window.api?.listNoteDetails(activeTB.id)
  const [manualPyOn, setManualPyOn] = useState(false)
  const [addMajorHeadModal, setAddMajorHeadModal] = useState(false)
  const [noteDetailsModal, setNoteDetailsModal] = useState(null) // { noteNum, noteTitle, bsTotal }
  const [expandSignal, setExpandSignal] = useState({ v: true, n: 0 }) // global expand/collapse broadcast
  const [natureModal, setNatureModal] = useState(null)           // items[] for NatureAssignModal
  const [natureAppliedFor, setNatureAppliedFor] = useState(null) // tbId last applied for
  const [assumptionModal, setAssumptionModal] = useState(null)         // items[] for AssumptionDisclosureModal
  const [assumptionCheckedFor, setAssumptionCheckedFor] = useState(null) // tbId last checked for
  const { get: getRemark, set: setRemark } = useRemarks(activeTB?.id)
  const onRemarkSaved = (scope, key, value) => setRemark(scope, key, value)
  const [fillDetailsStatus, setFillDetailsStatus] = useState('')

  // ── Consolidated Fill Details Excel — one sheet per note, driven by
  // utils/fillDetailsRegistry.js, plus a bolted-on Stock sheet. Download →
  // edit in Excel → Upload to bulk-save without opening each note's form
  // individually.
  const STOCK_INVENTORY_TYPES = [
    'Raw Materials', 'Work in Progress', 'Finished Goods', 'Stock-in-Trade',
    'Stores & Spares', 'Loose Tools', 'Others', 'Uncategorised Stock',
  ]
  const pickStock = (obj) => Object.fromEntries(STOCK_INVENTORY_TYPES.map(t => [t, obj[t] ?? '']).filter(([, v]) => v !== ''))

  const saveFillDetailsWorkbook = async (wb, suffix) => {
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    const eName = (entity?.name || 'FS').replace(/[^A-Za-z0-9]+/g, '_')
    const result = await window.api?.saveFileDialog({
      defaultPath: `${eName}_FillDetails_${suffix}.xlsx`,
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
    })
    if (result?.filePath && buf) {
      await window.api?.writeFile(result.filePath, Array.from(new Uint8Array(buf)))
      setFillDetailsStatus(`${suffix} template saved: ${result.filePath}`)
    }
  }

  const loadDepITBlocks = async () => {
    const [masterBlocks, customBlocks] = await Promise.all([
      window.api?.depITBlocksMaster().catch(() => []),
      entity?.id ? window.api?.depITBlocksCustom(entity.id).catch(() => []) : Promise.resolve([]),
    ])
    return [...(masterBlocks || []), ...(customBlocks || [])]
  }

  // Always blank — every sheet emitted with default/empty rows, ignoring
  // whatever's already saved. For someone who wants a pristine template
  // regardless of current progress (e.g. to hand to someone else to fill).
  const downloadFillDetailsBlank = async () => {
    if (!activeTB?.id || !data) return
    const [depITBlocks, depCompScheduleII] = await Promise.all([
      loadDepITBlocks(),
      window.api?.depScheduleII().catch(() => []),
    ])
    const cfsAll = (!isConsolidatedTB(activeTB) && activeTB?.entity_period_id) ? buildCashFlow(data, {}) : null
    const cfsRows = cfsAll ? cfsAll.rows : null
    const wb = buildFillDetailsWorkbook(data.activeNotes || [], new Map(), depITBlocks, { blank: true, depCompScheduleII, constitution: entity?.constitution, cfsRows, cfsCc: cfsAll ? cfsAll.cc : null })
    await saveFillDetailsWorkbook(wb, 'Blank')
  }

  // Current saved state — filled where data exists, blank rows where it
  // doesn't. Doubles as a backup/reference download of everything entered
  // so far (Fill Details forms + Stock), independent of re-opening each form.
  const downloadFillDetailsFilled = async () => {
    if (!activeTB?.id || !data) return
    // Stock is a physical, per-branch fact — there is no single "consolidated
    // stock" to fill in, only branch stock summed. Leave it out of the
    // Consolidated download rather than reading against a TB id that doesn't
    // exist (loadStockMaps expects a real trial_balances.id).
    const consolidated = isConsolidatedTB(activeTB)
    const [ndList, depITBlocks, stockMaps, depCompScheduleII] = await Promise.all([
      noteDetailsList().catch(() => []),
      loadDepITBlocks(),
      consolidated ? Promise.resolve(null) : loadStockMaps(activeTB.id).catch(() => null),
      window.api?.depScheduleII().catch(() => []),
    ])
    const ndByNote = mapSavedRowsToLiveNotes(ndList, data.activeNotes || [], nd => nd.data)
    const ndMap = new Map(Object.entries(ndByNote).map(([num, d]) => [Number(num), d]))
    const stockData = stockMaps ? { opening: stockMaps.op, closing: stockMaps.cl, pyOpening: stockMaps.pyOp, pyClosing: stockMaps.pyCl, heads: stockMaps.heads } : null
    // Cash Flow Statement: as the CFS tab shows it, with what has been typed there
    const cfsSaved = (!consolidated && entity?.id && activeTB.entity_period_id) ? await window.api?.getCfs?.(entity.id, activeTB.entity_period_id).catch(() => null) : null
    const cfsAll = (!consolidated && activeTB.entity_period_id) ? buildCashFlow(data, cfsSaved || {}) : null
    const cfsRows = cfsAll ? cfsAll.rows : null
    const wb = buildFillDetailsWorkbook(data.activeNotes || [], ndMap, depITBlocks, { stockData, depCompScheduleII, constitution: entity?.constitution, cfsRows, cfsCc: cfsAll ? cfsAll.cc : null })
    await saveFillDetailsWorkbook(wb, 'Filled')
  }

  const uploadFillDetails = async () => {
    if (!activeTB?.id) return
    const result = await window.api?.openFileDialog({
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx', 'xls'] }],
      properties: ['openFile'],
    })
    const filePath = result?.filePaths?.[0]
    if (!filePath) return
    const bytes = await window.api?.readFile(filePath)
    const wb = XLSX.read(new Uint8Array(bytes), { type: 'array' })
    const { results: parsed, skippedBlank } = parseFillDetailsWorkbook(wb, { constitution: entity?.constitution })
    // Note numbers can shift between download and upload (renumbering runs
    // live — e.g. a note that was zero-value at download time, and so had no
    // number, can pick one up once other data changes). Trusting the stale
    // number baked into the downloaded sheet would silently save against the
    // WRONG note. Re-resolve each sheet's note by TITLE against the current
    // note list instead — same registry match the sheet was built with.
    const liveNotes = data?.activeNotes || []
    let staleCount = 0
    for (const { noteNum, noteTitle, data: noteData } of parsed) {
      const entry = FILL_DETAILS_REGISTRY.find(e => e.match((noteTitle || '').toLowerCase(), entity?.constitution))
      const liveNote = entry
        ? liveNotes.find(n => entry.match((n.title || '').toLowerCase(), entity?.constitution))
        : liveNotes.find(n => n.num === noteNum)
      const resolvedNum = liveNote ? liveNote.num : noteNum
      if (liveNote && liveNote.num !== noteNum) staleCount++
      // saveNoteDetails overwrites the WHOLE saved record for this note, not
      // just the fields on this sheet — a note can carry data this registry
      // entry's toRows/fromRows doesn't round-trip (e.g. Share Capital's
      // shareholders/promoters/rights/footnotes, which live in a separate
      // bolted-on sheet — see below). Merge onto whatever's already saved so
      // uploading just the Classes sheet doesn't silently wipe those out.
      const liveTitle = liveNote?.title || noteTitle
      const existing = await noteDetailsGet(resolvedNum, liveTitle).catch(() => null)
      await noteDetailsSave({ noteNum: resolvedNum, noteTitle: liveTitle, data: { ...(existing || {}), ...noteData } }).catch(() => {})
    }

    // Bolted-on "Stock" sheet — saved only when it actually carries real
    // figures (parseFillDetailsStockSheet already applies the same
    // blank-means-not-filled rule Fill Details sheets get). Stock is a
    // physical, per-branch fact — nothing to save it against in Consolidated
    // mode (no real Trial Balance there), so skip it with a clear message
    // instead of failing silently against a non-existent TB id.
    const isConsolidated = isConsolidatedTB(activeTB)
    let stockMsg = ''
    const stockParsedRaw = parseFillDetailsStockSheet(wb)
    const stockParsed = isConsolidated ? null : stockParsedRaw
    if (isConsolidated && stockParsedRaw) {
      stockMsg = ' Stock sheet skipped - enter stock on each branch\'s own Trial Balance, not Consolidated.'
    }
    if (stockParsed) {
      await window.api?.saveStock({
        tbId: activeTB.id,
        stockData: {
          opening: pickStock(stockParsed.opening), closing: pickStock(stockParsed.closing),
          pyOpening: pickStock(stockParsed.pyOpening), pyClosing: pickStock(stockParsed.pyClosing),
          // Heads named in the sheet's last column; a sheet that names none leaves the Trial Balance's own heads as they are.
          ...(Object.keys(stockParsed.heads || {}).length ? { heads: stockParsed.heads } : {}),
        },
      }).catch(() => {})
      stockMsg = ' Stock entries updated — re-run mapping to include them.'
    }

    // Cash Flow Statement sheet: Current Year overwrites, Previous Year figures and added rows go to the CFS tab's own saved entries
    let cfsMsg = ''
    if (wb.SheetNames.some(n => n === 'CFS' || n.startsWith('CFS '))) {
      if (isConsolidated || !entity?.id || !activeTB.entity_period_id) {
        cfsMsg = ' CFS sheet skipped - the Cash Flow Statement is kept on each Financial Year\'s own Trial Balance, not Consolidated.'
      } else {
        const parsedCfs = parseCfsSheet(wb)
        if (parsedCfs && parsedCfs.any) {
          const savedNow = (await window.api?.getCfs?.(entity.id, activeTB.entity_period_id).catch(() => null)) || { cy: {}, py: {}, custom: [], include: false }
          const { saved: nextCfs, changed } = applyCfsUpload(parsedCfs, (() => { const c = buildCashFlow(data, savedNow); return [...c.rows, ...c.cc.rows] })(), savedNow)
          await window.api?.saveCfs?.(entity.id, activeTB.entity_period_id, nextCfs).catch(() => {})
          cfsMsg = ` CFS: ${changed} figure${changed !== 1 ? 's' : ''} updated.`
        }
      }
    }

    // The consolidated workbook also carries a "Dep (IT) Template" sheet
    // (see downloadFillDetailsFilled/Blank) — parse and save that too, so
    // filling it in from this one workbook actually persists, not just the
    // sheet downloaded/uploaded directly from the Dep (IT) tab. This sheet is
    // matched against real ledgers on a Trial Balance, which the Consolidated
    // view has none of (its schedule is entered manually, ledger-free — see
    // DepreciationIT/index.jsx) — use that tab's own Upload there instead.
    let depITMsg = ''
    if (isConsolidated && wb.SheetNames.some(n => n.startsWith('Dep (IT)'))) {
      depITMsg = ' Dep (IT) sheet skipped - use the Upload button on the Dep (IT) tab itself for the Consolidated schedule.'
    }
    if (!isConsolidated && wb.SheetNames.some(n => n.startsWith('Dep (IT)'))) {
      const [masterBlocks, customBlocks, existingIT] = await Promise.all([
        window.api?.depITBlocksMaster().catch(() => []),
        entity?.id ? window.api?.depITBlocksCustom(entity.id).catch(() => []) : Promise.resolve([]),
        window.api?.depITGet(activeTB.id).catch(() => null),
      ])
      const depITBlocks = [...(masterBlocks || []), ...(customBlocks || [])]
      const { rows: parsedITRows, matched } = parseDepITWorkbook(wb, depITBlocks)
      if (Object.keys(parsedITRows).length > 0) {
        const ledgerNames = new Set((await window.api?.depITGetLedgers(activeTB.id).catch(() => []) || []).map(l => l.ledger_name))
        const mergedRows = { ...(existingIT?.rows || {}) }
        let applied = 0
        for (const [ledgerName, val] of Object.entries(parsedITRows)) {
          // A company's Dep (IT) rows are typed in, not tied to ledgers.
          if (parseInt(entity?.constitution) !== 3 && !ledgerNames.has(ledgerName)) continue
          mergedRows[ledgerName] = val
          applied++
        }
        await window.api?.depITSave({
          tbId: activeTB.id,
          data: { ...(existingIT || {}), rows: mergedRows },
        }).catch(() => {})
        depITMsg = ` Dep (IT): restored ${applied} ledger${applied !== 1 ? 's' : ''}.`
      }
    }

    // The consolidated workbook also carries a "Dep (Comp) Template" sheet
    // (see downloadFillDetailsFilled/Blank) — parse and save that too, so
    // filling it in from this one workbook actually persists, not just the
    // sheet downloaded/uploaded directly from the Dep (Comp) tab. Rows are
    // keyed by Asset Category (not ledger, unlike Dep (IT)), and merged into
    // whatever's already saved — an uploaded row replaces its category's
    // existing figures, categories not present in the sheet are left alone.
    let depCompMsg = ''
    if (isConsolidated && wb.SheetNames.some(n => n.startsWith('Dep (Comp)'))) {
      depCompMsg = ' Dep (Comp) sheet skipped - use the Upload button on the Dep (Comp) tab itself for the Consolidated schedule.'
    }
    if (!isConsolidated && wb.SheetNames.some(n => n.startsWith('Dep (Comp)'))) {
      const existingComp = await window.api?.depCompGet(activeTB.id).catch(() => null)
      const { rows: parsedCompRows } = parseDepCompWorkbook(wb)
      if (parsedCompRows.length > 0) {
        const mergedByCategory = new Map((existingComp?.categoryRows || []).map(r => [r.category, r]))
        for (const row of parsedCompRows) mergedByCategory.set(row.category, row)
        const mergedRows = [...mergedByCategory.values()].map(withNet)
        const totals = mergedRows.reduce((s, r) => {
          const out = { ...s }
          for (const f of ['grossOpen', 'additions', 'deductions', 'grossClose', 'depOpen', 'depForYear', 'depOnDisposal', 'depClose', 'netBlockOpen', 'netBlockClose']) {
            out[f] = s[f] + (parseFloat(r[f]) || 0)
          }
          return out
        }, { grossOpen: 0, additions: 0, deductions: 0, grossClose: 0, depOpen: 0, depForYear: 0, depOnDisposal: 0, depClose: 0, netBlockOpen: 0, netBlockClose: 0 })
        await window.api?.depCompSave({
          tbId: activeTB.id,
          data: { ...(existingComp || {}), categoryRows: mergedRows, totals },
        }).catch(() => {})
        depCompMsg = ` Dep (Comp): restored ${parsedCompRows.length} categor${parsedCompRows.length !== 1 ? 'ies' : 'y'}.`
      }
    }

    // Bolted-on "Share Capital - Details" sheet (Shareholders, Rights,
    // Footnotes — see fillDetailsWorkbook.js's per-note loop). % holding and
    // the ">=5%"/Promoter split are auto-derived from total CY/PY shares —
    // never typed — same as ShareCapitalForm.jsx's own import, so the total
    // is read from the Classes sheet's just-merged (or otherwise
    // currently-saved) figures before parsing. Merged onto whatever the
    // Classes sheet above just saved for that note, so this genuinely adds
    // to it rather than clobbering the classes just written.
    let shareCapMsg = ''
    if (wb.SheetNames.some(n => n.startsWith('Share Capital - Details'))) {
      const scEntry = FILL_DETAILS_REGISTRY.find(e => e.key === 'share-capital')
      const scLiveNote = scEntry ? liveNotes.find(n => scEntry.match((n.title || '').toLowerCase())) : null
      const existingSc = scLiveNote ? await noteDetailsGet(scLiveNote.num, scLiveNote.title).catch(() => null) : null
      const resolvedNum = scLiveNote?.num
      if (resolvedNum) {
        const cls0 = existingSc?.classes?.[0]
        const num = v => parseFloat(v) || 0
        const totalCY = num(cls0?.cy?.openingShares) + num(cls0?.cy?.issuedDuringYear) - num(cls0?.cy?.deletedDuringYear) || num(cls0?.cy?.paidUp) || num(cls0?.cy?.issued)
        const totalPY = num(cls0?.py?.openingShares) + num(cls0?.py?.issuedDuringYear) - num(cls0?.py?.deletedDuringYear) || num(cls0?.py?.paidUp) || num(cls0?.py?.issued)
        const shareCapParsed = parseShareCapitalDetailsSheet(wb, totalCY, totalPY)
        if (shareCapParsed) {
          await noteDetailsSave({
            noteNum: resolvedNum, noteTitle: scLiveNote.title,
            data: { ...(existingSc || {}), ...shareCapParsed.data },
          }).catch(() => {})
          shareCapMsg = ' Share Capital: shareholders/rights/footnotes updated.'
        }
      }
    }

    if (!parsed.length && !depITMsg && !depCompMsg && !shareCapMsg && !stockMsg && !cfsMsg) {
      setFillDetailsStatus(skippedBlank > 0
        ? `Every recognised sheet was blank — nothing updated (${skippedBlank} sheet${skippedBlank !== 1 ? 's' : ''} skipped).`
        : 'No recognised Fill Details, Stock, Dep (IT), or Dep (Comp) sheets found in that file.')
      return
    }
    const staleMsg = staleCount > 0 ? ` (${staleCount} note${staleCount !== 1 ? 's had' : ' had'} renumbered since download — resolved by title.)` : ''
    const blankMsg = skippedBlank > 0 ? ` ${skippedBlank} blank sheet${skippedBlank !== 1 ? 's' : ''} left untouched.` : ''
    setFillDetailsStatus(`Uploaded Fill Details for ${parsed.length} note${parsed.length !== 1 ? 's' : ''}.${staleMsg}${blankMsg}${stockMsg}${cfsMsg}${depITMsg}${depCompMsg}${shareCapMsg}`)
    refresh()
  }

  // ── Manual PY backup/restore — see manualPyWorkbook.js for why this is
  // needed: manual_py_entries is keyed by tb_id, and a Trial Balance
  // re-upload always gets a fresh tb_id (plain INSERT, never the same row
  // reused — see tb.js), so a branch's own Manual PY figures do NOT survive
  // re-uploading that branch's Trial Balance unless backed up first. The
  // Consolidated view's entries (entityManualPyEntries) are entity-scoped
  // instead, so they already survive any one branch's re-upload — this
  // still offers a download/restore round-trip for them for the same reason
  // Fill Details and Stock offer one: a portable backup, and a faster way to
  // bulk-enter many figures from Excel than clicking through each cell.
  const isConsolidatedManualPy = activeTB?.id === '__consolidated__'

  const downloadManualPyFilled = async () => {
    if (!activeTB?.id) return
    const entries = isConsolidatedManualPy
      ? await window.api?.listEntityManualPyEntries(entity.id).catch(() => [])
      : await window.api?.listManualPyEntries(activeTB.id).catch(() => [])
    const eName = (entity?.name || 'FS').replace(/[^A-Za-z0-9]+/g, '_')
    const scopeName = (isConsolidatedManualPy ? 'Consolidated' : (activeTB?.branch_name || activeTB?.period || 'TB')).replace(/[^A-Za-z0-9]+/g, '_')
    const wb = buildManualPyFilledWorkbook(entries || [], { sheetLabel: 'Manual PY' })
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    const result = await window.api?.saveFileDialog({
      defaultPath: `${eName}_ManualPY_${scopeName}.xlsx`,
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
    })
    if (result?.filePath && buf) {
      await window.api?.writeFile(result.filePath, Array.from(new Uint8Array(buf)))
      setFillDetailsStatus(`Manual PY entries saved — keep this safe before re-uploading a Trial Balance: ${result.filePath}`)
    }
  }

  const uploadManualPyFilled = async () => {
    if (!activeTB?.id) return
    const result = await window.api?.openFileDialog({
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx', 'xls'] }],
      properties: ['openFile'],
    })
    const filePath = result?.filePaths?.[0]
    if (!filePath) return
    const bytes = await window.api?.readFile(filePath)
    const wb = XLSX.read(new Uint8Array(bytes), { type: 'array' })
    const { entries } = parseManualPyWorkbook(wb)
    if (!entries.length) { setFillDetailsStatus('No Manual PY rows found in that file (rows with a blank amount are skipped).'); return }
    // Re-resolve each row's note by TITLE against the CURRENT note list, same
    // principle as uploadFillDetails above — a note's number is only a
    // recomputed position (see allocNoteNum in useFinancials.js), never a
    // stable identity, and note_num is written here only for the legacy
    // ON CONFLICT target (manualPyEntries:upsert matches by title first).
    const liveNotes = data ? Object.values(data.notes || {}) : []
    for (const e of entries) {
      const liveNote = liveNotes.find(n => (n.title || '').trim().toLowerCase() === e.note_title.toLowerCase())
      const payload = { noteNum: liveNote ? liveNote.num : 0, noteTitle: e.note_title, particularLabel: e.particular_label, py_amount: e.py_amount, is_custom: e.is_custom }
      if (isConsolidatedManualPy) {
        await window.api?.upsertEntityManualPyEntry({ ...payload, entityId: entity.id }).catch(() => {})
      } else {
        await window.api?.upsertManualPyEntry({ ...payload, tbId: activeTB.id }).catch(() => {})
      }
    }
    setFillDetailsStatus(`Restored ${entries.length} Manual PY figure${entries.length !== 1 ? 's' : ''} from Excel.`)
    refresh()
  }

  // pyAmount is a number (whole-note figure), or { "<line caption>": number } for a
  // head entered line by line (Tax expense) — one NAMED entry per line, so each
  // becomes a real line of the note and reaches its own row on the P&L face.
  // Saved one after another: each upsert picks its own note_num.
  const saveAddMajorHead = async (level2, pyAmount) => {
    const saveOne = (label, amount) => {
      const payload = { noteNum: 0, noteTitle: level2, particularLabel: label, py_amount: amount, is_custom: false }
      return isConsolidatedManualPy
        ? window.api?.upsertEntityManualPyEntry({ ...payload, entityId: entity.id })
        : window.api?.upsertManualPyEntry({ ...payload, tbId: activeTB.id })
    }
    if (pyAmount && typeof pyAmount === 'object') {
      for (const [label, amount] of Object.entries(pyAmount)) await saveOne(label, amount)
    } else {
      await saveOne('', pyAmount)
    }
    refresh()
  }

  // Captions of the lines a line-by-line head is entered as: the entity's own
  // LevelFormat Level 2s under it (spelled exactly as the mapping engine spells
  // them, so next year's real ledgers land on the same lines), Current tax first.
  const subHeadsFor = (head) => {
    if (!/^tax expense:?$/i.test((head || '').trim())) return []
    const want = head.trim().toLowerCase()
    const caps = []
    for (const lf of data?.levelFormat || []) {
      if (lf.alie !== 'Expenses' || (lf.level1 || '').trim().toLowerCase() !== want) continue
      const l2 = (lf.level2 || '').trim()
      if (!l2 || /^uncategorised/i.test(l2) || caps.includes(l2)) continue
      caps.push(l2)
    }
    const rank = (c) => /^current tax$/i.test(c) ? 0 : /excess|short/i.test(c) ? 1 : /deferred/i.test(c) ? 2 : 3
    return caps.sort((a, b) => rank(a) - rank(b))
  }

  // Auto-detect notes with unclassified nature and show prompt (once per TB).
  // Trade Payables (MSME) / Trade Receivables (Secured/Unsecured/Doubtful)
  // nature lives at Level 3 for every constitution (see schema.js's Level
  // 5→3 migration) — check mapping3_resultant/level3, not level5_value.
  useEffect(() => {
    if (!data || !activeTB?.id || natureAppliedFor === activeTB.id) return
    const notes = Object.values(data.notes || {})
    const items = NATURE_DEFAULTS.flatMap(def => {
      const matching = notes.filter(n => def.pattern.test(n.title || ''))
      const hasUnclassified = matching.some(n => {
        // Check non-zero ledgers without a nature assignment
        const nonZeroUnclassified = (n.rows || []).some(r =>
          !(r.mapping3_resultant || r.level3 || '').trim() &&
          (Math.abs(r.closing_balance || 0) > 0.005 || Math.abs(r.opening_balance || 0) > 0.005)
        )
        return nonZeroUnclassified ||
          (n.templateRows || []).some(r => r.unclassified && !r.screenOnly) ||
          (n.templateRowsAll || []).some(r => r.unclassified && !r.screenOnly)
      })
      return hasUnclassified ? [{ ...def }] : []
    })
    if (items.length > 0) setNatureModal(items)
  }, [data, activeTB?.id])

  // Auto-detect ledgers classified "On assumption" (mapping-engine.js's
  // applyTradeAssumption) and show a review popup, once per TB.
  useEffect(() => {
    if (!data || !activeTB?.id || assumptionCheckedFor === activeTB.id) return
    const notes = Object.values(data.notes || {})
    const items = []
    for (const note of notes) {
      if (!NATURE_DEFAULTS.some(def => def.pattern.test(note.title || ''))) continue
      for (const r of note.rows || []) {
        if (r.override_note === 'On assumption') {
          items.push({
            name: r.name || r.ledger_name || '',
            noteTitle: note.title,
            assumedAs: r.mapping3_resultant || r.level3 || r.level5_value || '',
            cy: rowAmt(r, 'closing_balance'),
          })
        }
      }
    }
    if (items.length > 0) setAssumptionModal(items)
    setAssumptionCheckedFor(activeTB.id)
  }, [data, activeTB?.id])

  const applyNatureAssignment = async (items) => {
    setNatureModal(null)
    const tbId = activeTB?.id
    if (!tbId) return
    for (const item of items) {
      await window.api?.bulkSetNatureL3(tbId, item.searchKey, item.chosenNature).catch(() => {})
    }
    setNatureAppliedFor(tbId)
    refresh()
  }

  // Jump to the note a Balance Sheet / Profit & Loss note number points at. The request stays alive while the notes are still
  // loading; the list is widened (empty notes shown, search cleared) when the note is not on it; the note is scrolled to once it is
  // on the screen (and again after the page has settled), and the highlight is released only after that. A number the notes do
  // not carry says so, instead of leaving the CA to scroll up and down looking for it.
  const [jumpMsg, setJumpMsg] = useState('')
  useEffect(() => {
    if (highlightNote === null || highlightNote === undefined || highlightNote === '') return
    if (!data) return
    const wanted = String(highlightNote).trim()
    const isGeneral = data.generalNoteNum !== null && data.generalNoteNum !== undefined && String(data.generalNoteNum).trim() === wanted
    const target = Object.values(data.notes || {}).find(n => String(n.num).trim() === wanted)
    if (!target && !isGeneral) {
      setJumpMsg(`Note ${wanted} is not among the notes of this view - the Balance Sheet / Profit & Loss and the Notes are showing different views (a branch against the Consolidated), or the note is a sub-note of another note.`)
      onHighlightClear?.()
      return
    }
    setJumpMsg('')
    if (search) setSearch('')
    if (target && !(data.activeNotes || []).some(n => String(n.num).trim() === wanted)) setShowEmpty(true)
    let tries = 0, settled = null
    const timer = setInterval(() => {
      const el = document.getElementById(`note-${wanted}`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        clearInterval(timer)
        settled = setTimeout(() => { document.getElementById(`note-${wanted}`)?.scrollIntoView({ behavior: 'auto', block: 'start' }) }, 450)
        setTimeout(() => onHighlightClear?.(), 3000)
      } else if (++tries > 50) { clearInterval(timer); onHighlightClear?.() }
    }, 100)
    return () => { clearInterval(timer); if (settled) clearTimeout(settled) }
  }, [highlightNote, data])
  const isHl = (num) => highlightNote !== null && highlightNote !== undefined && highlightNote !== '' && String(num).trim() === String(highlightNote).trim()

  const noteList = data
    ? (showEmpty ? Object.values(data.notes) : (data.activeNotes || []))
        .filter(n => !search || n.title.toLowerCase().includes(search.toLowerCase()))
    : []

  // Every Balance Sheet OR P&L major head from the entity's own LevelFormat
  // that does not already have a note this year — see AddPyOnlyMajorHeadModal.
  // A BS major head is identified by Level 2 (e.g. "Trade Payables"); a P&L
  // one by Level 1 instead (e.g. "Partners' Remuneration", "Tax expense" —
  // see useFinancials.js's manualPyOnlyTitles injection, which matches the
  // same way). {level1, level2} here is just "grouping label, value to
  // submit" for the picker below, not literally BS's Level1/Level2 for a
  // P&L entry — same shape either way so the modal needs no change.
  const BS_SIDES = ['EQUITY AND LIABILITIES', 'ASSETS']
  const PL_SIDES = ['Income', 'Expenses']
  const existingNoteTitles = new Set(Object.values(data?.notes || {}).map(n => (n.title || '').trim().toLowerCase()))
  const seenMajorHeads = new Set()
  const availableMajorHeads = []
  for (const lf of data?.levelFormat || []) {
    if (!BS_SIDES.includes(lf.alie) || !lf.level2 || /^uncategorised/i.test(lf.level2.trim())) continue   // a catch-all, never a head to add
    const key = lf.level2.trim().toLowerCase()
    if (existingNoteTitles.has(key) || seenMajorHeads.has(key)) continue
    seenMajorHeads.add(key)
    availableMajorHeads.push({ level1: lf.level1 || '', level2: lf.level2 })
  }
  for (const lf of data?.levelFormat || []) {
    if (!PL_SIDES.includes(lf.alie) || !lf.level1 || /^uncategorised/i.test(lf.level1.trim())) continue
    const key = lf.level1.trim().toLowerCase()
    if (existingNoteTitles.has(key) || seenMajorHeads.has(key)) continue
    seenMajorHeads.add(key)
    availableMajorHeads.push({ level1: lf.alie, level2: lf.level1 })
  }
  availableMajorHeads.sort((a, b) => a.level1.localeCompare(b.level1) || a.level2.localeCompare(b.level2))

  const generalNoteNum = data?.generalNoteNum
  const generalNoteBlock = (data?.generalNotes?.points?.length > 0 && !search) ? (
    <div id={`note-${generalNoteNum}`}
      className={`mb-6 border rounded-lg overflow-hidden shadow-sm transition-all ${isHl(generalNoteNum) ? 'border-blue-400 ring-2 ring-blue-300' : 'border-blue-100'}`}>
      <div className={`w-full flex items-center gap-2 px-4 py-2.5 text-white ${isHl(generalNoteNum) ? 'bg-blue-600' : 'bg-blue-800'}`}>
        <span className="font-semibold text-sm">Note {generalNoteNum}: {data.generalNotes.title || '(untitled)'}</span>
      </div>
      <div className="px-4 py-3 bg-white divide-y divide-gray-100">
        {data.generalNotes.points.map((pt, idx) => (
          <div key={pt.id || idx} className="py-2.5">
            <div className="text-xs font-bold text-gray-800 mb-1">{pointLabel(idx)} {pt.header || '(untitled)'}</div>
            <div className="max-h-[360px] overflow-y-auto overflow-x-auto tiptap-editor pl-4">
              <div className="prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: pt.contentHtml || '' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  ) : null

  const period = formatPeriodText(activeTB?.period)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Guard activeTB={activeTB} loading={loading} hasData={!!data} error={error}>
        <div className="flex items-center gap-3 px-5 py-3 border-b border-blue-100 shrink-0 bg-white flex-wrap">
          <div>
            <h2 className="font-bold text-blue-900 text-sm">Notes to Financial Statements</h2>
            {entity && <p className="text-xs text-gray-500">{entity.name}{period ? ` | ${period}` : ''}</p>}
          </div>
          <div className="ml-auto flex items-center gap-3 flex-wrap">
            <PYModeSelect activeTB={activeTB} onChanged={refresh} />
            <ManualPYButton tbId={activeTB?.id} entityId={entity?.id} data={data} onChanged={refresh}
              onEnabledChange={isBranchEntity ? setManualPyOn : undefined}
              disabled={(isBranchEntity && !!prevTB?.id) || (!!data?.pyMode && data.pyMode !== 'required')}
              disabledTitle={(!!data?.pyMode && data.pyMode !== 'required') ? 'Previous Year figures are switched off for this Financial Year (Previous Year figures: Required).' : 'A Previous Year Trial Balance is already selected for this branch — clear it below to use Manual PY instead.'} />
            {isBranchEntity && (
              <PYTBSelector entity={entity} currentTBId={activeTB?.id} prevTB={prevTB} onChange={onPrevTBChange}
                disabled={manualPyOn || (!!data?.pyMode && data.pyMode !== 'required')}
                disabledTitle={(!!data?.pyMode && data.pyMode !== 'required') ? 'Previous Year figures are switched off for this Financial Year (Previous Year figures: Required).' : 'Manual PY is ON for this branch — turn it off to select a Previous Year Trial Balance instead.'} />
            )}
            <div className="flex items-center rounded border border-gray-300 overflow-hidden">
              <button onClick={downloadManualPyFilled}
                className="px-2 py-1 text-xs text-gray-700 hover:bg-amber-50 border-r border-gray-300"
                title="Download every Manual PY figure currently saved here — keep this safe before re-uploading a Trial Balance, since Manual PY figures do not carry over automatically">
                ⬇ Manual PY
              </button>
              <button onClick={uploadManualPyFilled}
                className="px-2 py-1 text-xs text-gray-700 hover:bg-amber-50"
                title="Restore Manual PY figures from a previously-downloaded file — matched back by note title, rows with a blank amount are left untouched">
                ⬆ Manual PY
              </button>
            </div>
            {data?.manualPyEnabled && (
              <button onClick={() => setAddMajorHeadModal(true)}
                className="px-2 py-1 text-xs border border-amber-300 rounded text-amber-700 hover:bg-amber-50"
                title="Add a Balance Sheet or P&L major head that has no balance this year, purely to record a Previous Year figure">
                + Add PY-only Major Head
              </button>
            )}
            <div className="flex items-center rounded border border-gray-300 overflow-hidden">
              <button onClick={downloadFillDetailsBlank}
                className="px-2 py-1 text-xs text-gray-700 hover:bg-blue-50 border-r border-gray-300"
                title="Download a pristine consolidated Excel template — one sheet per Fill Details note plus Stock, ignoring anything already saved">
                ⬇ Blank Template
              </button>
              <button onClick={downloadFillDetailsFilled}
                className="px-2 py-1 text-xs text-gray-700 hover:bg-blue-50 border-r border-gray-300"
                title="Download everything currently saved (Fill Details forms + Stock) — a backup/reference of your progress so far">
                ⬇ Filled Template
              </button>
              <button onClick={uploadFillDetails}
                className="px-2 py-1 text-xs text-gray-700 hover:bg-blue-50"
                title="Upload a filled-in template — every non-blank sheet is saved at once, blank sheets are left untouched">
                ⬆ Upload Fill Details
              </button>
            </div>
            <PYTBSelector entity={entity} currentTBId={activeTB?.id} prevTB={prevTB} onChange={onPrevTBChange}
              disabled={!!data?.pyMode && data.pyMode !== 'required'}
              disabledTitle="Previous Year figures are switched off for this Financial Year (Previous Year figures: Required)." />
            <span className="text-xs text-gray-400">{noteList.length + (data?.generalNotes?.points?.length ? 1 : 0)} note{(noteList.length + (data?.generalNotes?.points?.length ? 1 : 0)) !== 1 ? 's' : ''}</span>
            <div className="flex items-center rounded border border-gray-300 overflow-hidden">
              <button
                onClick={() => setExpandSignal(s => ({ v: true, n: s.n + 1 }))}
                className="px-2 py-1 text-xs text-gray-700 hover:bg-blue-50 border-r border-gray-300"
                title="Expand all notes"
              >Expand All</button>
              <button
                onClick={() => setExpandSignal(s => ({ v: false, n: s.n + 1 }))}
                className="px-2 py-1 text-xs text-gray-700 hover:bg-blue-50"
                title="Collapse all notes"
              >Collapse All</button>
            </div>
            <label className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer">
              <input type="checkbox" checked={showEmpty} onChange={e => setShowEmpty(e.target.checked)}
                className="rounded border-gray-300" />
              Show empty notes
            </label>
            <label className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer">
              <input type="checkbox" checked={showZeroRows} onChange={e => setShowZeroRows(e.target.checked)}
                className="rounded border-gray-300" />
              Show zero-balance rows
            </label>
            <input type="text" placeholder="Search notes..." value={search} onChange={e => setSearch(e.target.value)}
              className="border border-gray-300 rounded px-3 py-1.5 text-xs w-40 text-gray-900 bg-white focus:ring-2 focus:ring-blue-400 focus:outline-none" />
            {search && <button onClick={() => setSearch('')} className="text-gray-400 text-xs">X</button>}
          </div>
        </div>

        {fillDetailsStatus && (
          <div className="px-5 py-1.5 text-[11px] text-blue-700 bg-blue-50 border-b border-blue-100 flex items-center justify-between shrink-0">
            <span>{fillDetailsStatus}</span>
            <button onClick={() => setFillDetailsStatus('')} className="text-blue-400 hover:text-blue-700">✕</button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-5">
          {data && noteList.length === 0 && (
            <div className="text-center text-gray-400 text-sm mt-10">
              {search ? 'No notes match your search.' : 'No notes to display. Run mapping first.'}
            </div>
          )}
          {jumpMsg && <div className="mb-3 px-3 py-2 text-xs rounded border border-amber-300 bg-amber-50 text-amber-900 flex items-start gap-2"><span>{jumpMsg}</span><button onClick={() => setJumpMsg('')} className="ml-auto text-amber-700">✕</button></div>}
          {generalNoteBlock && data?.generalNotes?.position !== 'last' && generalNoteBlock}
          {noteList.map(note => {
            // Only show "Fill Details" button for notes that have a dedicated form
            const t = (note.title || '').toLowerCase()
            // Trade Payables: MSME disclosure applies to every constitution;
            // its Ageing Schedule sub-tab is Company-only (gated inside the
            // form itself). Trade Receivables has no MSME-equivalent concern
            // — its Fill Details form is pure ageing: Company's Schedule III
            // schedule, or (Proprietorship / Partnership / LLP) the simpler
            // 6-month ageing table.
            const isCompanyEntity = parseInt(entity?.constitution) === 3
            const isNonCorpEntity = [1, 2].includes(parseInt(entity?.constitution))
            // "Cost of Materials Consumed" / "Changes in Inventories" are
            // deliberately NOT here — they're auto-computed from the Stock
            // tab's category entries (see utils/inventorySplit.js) and are
            // no longer independently Fill-Details-editable, to avoid the
            // two sources silently drifting apart. See the "Edit in Stock
            // Menu" button below instead.
            const hasForm = t.includes('share capital') ||
                            t.includes('long-term borrow') || t.includes('long term borrow') ||
                            t.includes('short-term borrow') || t.includes('short term borrow') ||
                            t.includes('trade payable') ||
                            (t.includes('cash') && t.includes('bank')) ||
                            (t.includes('trade receivable') && (isCompanyEntity || isNonCorpEntity)) ||
                            t.includes("owners' capital") || t.includes('owners capital') ||
                            t.includes("partners' capital") || t.includes('partners capital')
            const isLTB = t.includes('long-term borrow') || t.includes('long term borrow')
            const ltbV = note.ltbValidation
            return (
              <React.Fragment key={note.num}>
                <NoteBlock note={note} entity={entity} isHighlighted={isHl(note.num)}
                  tbId={activeTB?.id} getRemark={getRemark} onRemarkSaved={onRemarkSaved}
                  showZeroRows={showZeroRows} onFix={openFix} expandSignal={expandSignal}
                  manualPyEnabled={data?.manualPyEnabled} onManualPySaved={refresh}
                  onGoToAnnexure={onGoToAnnexure}
                  onGoToStock={onGoToStock}
                  onFillDetails={hasForm ? (n) => setNoteDetailsModal({
                    noteNum:      n.num,
                    noteTitle:    n.title,
                    noteTotal:    n.total,
                    notePrevTotal: n.prevTotal,
                    // For LTB: pass the ORIGINAL TB value (before Fix #4 deducted CM)
                    // ltbValidation.tbRawCY is set by Fix #4 after the form is first saved.
                    // Before first save, note.total IS the TB value.
                    noteTBRaw: n.ltbValidation?.tbRawCY ?? n.total,
                  }) : null}
                />
                {isLTB && ltbV?.mismatchGross && (
                  <div className="-mt-5 mb-6 mx-0 px-4 py-2 bg-red-50 border border-red-300 rounded-b-lg text-xs text-red-700 flex items-start gap-2">
                    <span className="shrink-0 font-bold">⚠</span>
                    <span>
                      Gross Long-Term Borrowings in the filled form (₹{fmtINR(ltbV.formGrossCY)}) does not match the Trial Balance figure (₹{fmtINR(ltbV.tbRawCY)}).
                      Please open <strong>Fill Details → Section B</strong> and verify the gross amounts.
                    </span>
                  </div>
                )}
              </React.Fragment>
            )
          })}
          {generalNoteBlock && data?.generalNotes?.position === 'last' && generalNoteBlock}
          {data && noteList.length > 0 && (
            <div className="text-xs text-gray-400 text-right mt-2">All figures derived from Mapped Trial Balance</div>
          )}
        </div>
      </Guard>

      {/* Note Details Form — each note title maps to its own specific form.
          For branch entities, statutory forms (Share Capital, Borrowings) are
          saved at entity level (shared across all branches). */}
      {noteDetailsModal && (() => {
        const title = (noteDetailsModal.noteTitle || '').toLowerCase()
        const isBranchEntity = !!entity?.has_branches
        const commonProps = isBranchEntity
          ? {
              entityId: entity.id,
              noteNum: noteDetailsModal.noteNum,
              noteTitle: noteDetailsModal.noteTitle,
              noteTotal: noteDetailsModal.noteTotal,
              notePrevTotal: noteDetailsModal.notePrevTotal,
              onClose: () => setNoteDetailsModal(null),
              // Reload so what was just saved shows under the note at once.
              onSaved: () => { setNoteDetailsModal(null); refresh() },
              useEntityLevel: true,
            }
          : {
              entityId: entity.id,
              tbId: activeTB?.id,
              noteNum: noteDetailsModal.noteNum,
              noteTitle: noteDetailsModal.noteTitle,
              noteTotal: noteDetailsModal.noteTotal,
              notePrevTotal: noteDetailsModal.notePrevTotal,
              onClose: () => setNoteDetailsModal(null),
              // Reload so what was just saved shows under the note at once.
              onSaved: () => { setNoteDetailsModal(null); refresh() },
            }
        if (title.includes('share capital')) {
          return <ShareCapitalForm {...commonProps} bsShareCapital={noteDetailsModal.noteTotal} isCompany={parseInt(entity?.constitution) === 3} />
        }
        if (title.includes('long-term borrow') || title.includes('long term borrow')) {
          return <LongTermBorrowingsForm {...commonProps}
            bsLTB={noteDetailsModal.noteTotal}
            tbRawLTB={noteDetailsModal.noteTBRaw}
          />
        }
        if (title.includes('short-term borrow') || title.includes('short term borrow')) {
          return <ShortTermBorrowingsForm {...commonProps} bsSTB={noteDetailsModal.noteTotal} />
        }
        // Trade Payables: MSME disclosure (all constitutions) + Ageing Schedule (Company only)
        if (title.includes('trade payable')) {
          return <TradePayablesDisclosureForm {...commonProps} constitution={entity?.constitution} />
        }
        // Trade Receivables: Ageing Schedule — Company only (hasForm above already gates the button)
        if (title.includes('trade receivable') && parseInt(entity?.constitution) === 3) {
          return <TradeReceivablesAgingForm {...commonProps} />
        }
        // ...Proprietorship / Partnership / LLP: the simpler 6-month ageing table
        if (isNonCorpTradeReceivables(entity?.constitution, noteDetailsModal.noteTitle)) {
          return <TradeReceivablesAgeingNonCorpForm {...commonProps} />
        }
        if (title.includes('cash') && title.includes('bank')) {
          return <CashBankDetailsForm {...commonProps} />
        }
        if (title.includes("owners' capital") || title.includes('owners capital') ||
            title.includes("partners' capital") || title.includes('partners capital')) {
          return <OwnersCapitalAccountForm {...commonProps}
            constitution={entity?.constitution}
            constitutionDisplay={entity?.constitution_display}
            period={activeTB?.period}
            plNetProfit={data?.netProfit}
            plPrevNetProfit={data?.prevNetProfit}
          />
        }
        return null  // no form registered for this note yet
      })()}

      {natureModal && (
        <NatureAssignModal
          items={natureModal}
          onApply={applyNatureAssignment}
          onCancel={() => { setNatureModal(null); setNatureAppliedFor(activeTB?.id) }}
        />
      )}

      {assumptionModal && (
        <AssumptionDisclosureModal
          items={assumptionModal}
          onClose={() => setAssumptionModal(null)}
        />
      )}

      {addMajorHeadModal && (
        <AddPyOnlyMajorHeadModal
          availableMajorHeads={availableMajorHeads}
          subHeadsFor={subHeadsFor}
          onSave={saveAddMajorHead}
          onClose={() => setAddMajorHeadModal(false)}
        />
      )}
    </div>
  )
}
