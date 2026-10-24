import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { AgGridReact } from 'ag-grid-react'
import OverrideModal from './OverrideModal'
import ConflictModal from './ConflictModal'
import DiscrepancyModal from './DiscrepancyModal'
import BulkOverrideModal from './BulkOverrideModal'
import PYTBSelector from '../shared/PYTBSelector'
import { DENOMINATIONS as VERA_DENOMINATIONS } from '../../hooks/useFinancials'
import RemarkCell, { useRemarks } from '../shared/RemarkCell'
import LockBanner from '../shared/LockBanner'
import { mergeMappingEdit } from '../../utils/mappingEdit'
import { agAmountFilter, AMOUNT_FILTER_HELP } from '../../utils/amountFilter'
import LoadingNote from '../shared/LoadingNote'

// ── Constants ─────────────────────────────────────────────────────────────────
const STATUS_LABEL = {
  auto_high:     'Auto — High',
  auto_medium:   'Auto — Medium',
  auto_low:      'Auto — Low',
  unmapped:      'Unmapped',
  conflict:      'Conflict',
  discrepancy:   'Discrepancy',
  user_approved: 'Approved',
  user_override: 'Overridden',
  needs_review:  'Needs Review',
}

const ROW_CLASS = {
  auto_high:     'row-high',
  auto_medium:   'row-medium',
  auto_low:      'row-low',
  unmapped:      'row-unmapped',
  conflict:      'row-conflict',
  discrepancy:   'row-discrepancy',
  user_approved: 'row-approved',
  user_override: 'row-approved',
  needs_review:  'row-review',
}

// Number format options (alias for DENOMINATIONS imported at top)
const NUM_FORMATS = VERA_DENOMINATIONS

let _numFormatKey = 'as_is'
function setNumFormatKey(k) { _numFormatKey = k }

// The Mapped TB opens with the ledger, the closing balance as imported, the Adjustments, the revised
// closing balance and Status / Actions (plus the tick box). Every other column is one click away in
// "Columns"; what is picked there is remembered, and "Default view" brings this one back.
const DEFAULT_VISIBLE_COLS = ['name', 'clos_bal_debit', 'clos_bal_credit', 'adj_debit', 'adj_credit', 'rev_clos_debit', 'rev_clos_credit', 'status']
const COLS_STORAGE_KEY = 'fsg-mappedtb-columns'
// Columns holding amounts: each is sized to its own figures (the ledger name takes the width that is left).
const AMOUNT_COL_IDS = ['opening_balance', 'debit', 'credit', 'closing_balance', 'py_closing_balance', 'opn_bal_debit', 'opn_bal_credit',
  'clos_bal_debit', 'clos_bal_credit', 'adj_debit', 'adj_credit', 'rev_clos_debit', 'rev_clos_credit']
function loadVisibleCols() {
  try {
    const saved = JSON.parse(localStorage.getItem(COLS_STORAGE_KEY) || 'null')
    if (Array.isArray(saved) && saved.length) return new Set(saved)
  } catch { /* storage not available - open with the default view */ }
  return new Set(DEFAULT_VISIBLE_COLS)
}

// Adjustment amount as a number (0 when blank); keepNull returns null when blank.
function adjAmt(v, keepNull = false) {
  if (v === null || v === undefined || v === '') return keepNull ? null : 0
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : (keepNull ? null : 0)
}

// Closing balance as imported / as revised by the Adjustments. Balances are stored Cr positive,
// Dr negative; the revised one (what every statement reads) is imported + Adj (Credit) - Adj (Debit),
// kept exact by the database. A ledger never adjusted has no separate imported figure.
const importedOf = (r) => parseFloat(r.imported_closing_balance ?? r.closing_balance ?? 0) || 0
const revisedOf = (r) => parseFloat(r.closing_balance ?? 0) || 0
// Rows the Stock tab owns - never adjusted here.
const STOCK_TAB_ROWS = ['Stock Entry', 'Stock Entry PY', 'Opening Stock (Manual)']
const inr = (n) => (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function numFmt(p) {
  if (p.value === null || p.value === undefined) return ''
  const fmt = NUM_FORMATS[_numFormatKey] || NUM_FORMATS['as_is']
  const val = Number(p.value) / fmt.divisor
  return val.toLocaleString('en-IN', { minimumFractionDigits: fmt.decimals, maximumFractionDigits: fmt.decimals })
}

// ── Location map builder ──────────────────────────────────────────────────────
// Mirrors the note-assignment logic in useFinancials to compute per-row location.
// Returns Map<rowId, locationAbbr string>
function buildLocationMap(rows) {
  const BUCKETS   = ['EQUITY AND LIABILITIES', 'ASSETS', 'Income', 'Expenses']
  const BS_BUCKETS = new Set(['EQUITY AND LIABILITIES', 'ASSETS'])
  const PL_BUCKETS = new Set(['Income', 'Expenses'])

  // Collect ordered unique keys per bucket
  const l2NoteMap  = new Map() // key `${alie}|${l1}|${l2}` → noteNum  (BS items, by level2)
  const l1NoteMap  = new Map() // key `${alie}|${l1}` → noteNum          (PL items, by level1)

  let noteNum = 1

  // BS: note per unique level2 (E&L first, then Assets)
  for (const alie of ['EQUITY AND LIABILITIES', 'ASSETS']) {
    const seenL2 = new Set()
    for (const row of rows) {
      if ((row.alie || '') !== alie) continue
      const l1  = row.level1 || 'Uncategorised'
      const l2  = row.mapping2_resultant || row.level2 || ''
      if (!l2) continue
      const key = `${alie}|${l1}|${l2}`
      if (!seenL2.has(key)) { seenL2.add(key); l2NoteMap.set(key, noteNum++) }
    }
  }

  // PL: note per unique level1 (Income first, then Expenses)
  for (const alie of ['Income', 'Expenses']) {
    const seenL1 = new Set()
    for (const row of rows) {
      if ((row.alie || '') !== alie) continue
      const l1  = row.level1 || 'Uncategorised'
      const key = `${alie}|${l1}`
      if (!seenL1.has(key)) { seenL1.add(key); l1NoteMap.set(key, noteNum++) }
    }
  }

  const locMap = new Map()
  for (const row of rows) {
    const alie = row.alie || ''
    const l1   = row.level1 || 'Uncategorised'
    const l2   = row.mapping2_resultant || row.level2 || ''
    let   loc  = '—'

    if (alie === 'EQUITY AND LIABILITIES') {
      const n = l2NoteMap.get(`${alie}|${l1}|${l2}`)
      loc = n ? `BS·E&L N${n}` : 'BS·E&L'
    } else if (alie === 'ASSETS') {
      const n = l2NoteMap.get(`${alie}|${l1}|${l2}`)
      loc = n ? `BS·Ast N${n}` : 'BS·Ast'
    } else if (alie === 'Income') {
      const n = l1NoteMap.get(`${alie}|${l1}`)
      loc = n ? `P&L·Inc N${n}` : 'P&L·Inc'
    } else if (alie === 'Expenses') {
      const n = l1NoteMap.get(`${alie}|${l1}`)
      loc = n ? `P&L·Exp N${n}` : 'P&L·Exp'
    }

    locMap.set(row.id, loc)
  }
  return locMap
}

// ── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const cls = {
    auto_high:     'bg-green-100 text-green-800',
    auto_medium:   'bg-yellow-100 text-yellow-800',
    auto_low:      'bg-orange-100 text-orange-800',
    unmapped:      'bg-red-100 text-red-800',
    conflict:      'bg-purple-100 text-purple-800',
    discrepancy:   'bg-amber-100 text-amber-800',
    user_approved: 'bg-blue-100 text-blue-800',
    user_override: 'bg-blue-100 text-blue-800',
    needs_review:  'bg-gray-100 text-gray-700',
  }[status] || 'bg-gray-100 text-gray-600'
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>
      {STATUS_LABEL[status] || status}
    </span>
  )
}

// ── Slash-option helper ──────────────────────────────────────────────────────
function parseSlashOptions(val) {
  if (!val) return null
  if (val.includes('/')) return val.split('/').map(s => s.trim()).filter(Boolean)
  return null
}

// ── Main component ────────────────────────────────────────────────────────────
export default function MappedTB({ entity, activeTB, prevTB, onPrevTBChange, activeRsId, numFormat: propNumFormat, onNumFormatChange, onOpenMappingRules }) {
  const [rows, setRows]               = useState([])
  const [adjTick, setAdjTick]         = useState(0)   // bumps when an Adjustment is typed, to refresh the pinned totals
  const [adjSummary, setAdjSummary]   = useState(null) // what the Adjustments do to the Trial Balance (mappedTB:adjustmentSummary)
  const [adjNotice, setAdjNotice]     = useState('')
  const [prevRowMap, setPrevRowMap]   = useState(new Map())
  const [loading, setLoading]         = useState(false)
  const [running, setRunning]         = useState(false)
  const [summary, setSummary]         = useState(null)
  const [quickFilter, setQuickFilter] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [selectedRows, setSelectedRows] = useState([])
  const [overrideRow, setOverrideRow]         = useState(null)
  const [addLedgerOpen, setAddLedgerOpen]     = useState(false)   // + Add Ledger (a ledger not in the imported Trial Balance)
  const [conflictRow, setConflictRow]         = useState(null)
  const [discrepancyRow, setDiscrepancyRow]   = useState(null)
  const [showBulkOverride, setShowBulkOverride] = useState(false)
  const [confirmClear, setConfirmClear]       = useState(false)
  const [clearing, setClearing]               = useState(false)
  const [downloading, setDownloading]         = useState(false)
  const [visibleCols, setVisibleCols]         = useState(loadVisibleCols)
  useEffect(() => { try { localStorage.setItem(COLS_STORAGE_KEY, JSON.stringify([...visibleCols])) } catch { /* not remembered */ } }, [visibleCols])
  const [amountWidths, setAmountWidths]     = useState({})   // width each amount column was fitted to (kept, so a re-render does not undo it)
  const [gridWidth, setGridWidth]           = useState(1400)
  const [showColPanel, setShowColPanel]       = useState(false)
  const [excludedZero, setExcludedZero]       = useState(false)
  const [levelFormat, setLevelFormat]         = useState([])
  const numFormat = propNumFormat || 'as_is'
  const setNumFormat = onNumFormatChange || (() => {})
  // Remarks lookup (for TB remark column)
  const { get: getRemark, set: setRemark } = useRemarks(activeTB?.id)
  const onRemarkSaved = (scope, key, value) => setRemark(scope, key, value)
  // Sync module-level format key when prop changes
  useEffect(() => {
    setNumFormatKey(numFormat)
    gridRef.current?.api?.refreshCells({ force: true })
  }, [numFormat])
  const [error, setError]             = useState('')
  const gridRef   = useRef()
  const searchRef = useRef()

  // ── Add conflict row CSS to document once ────────────────────────────────
  useEffect(() => {
    const style = document.createElement('style')
    style.textContent = `
      .row-conflict { background: #f5f3ff !important; }
      .row-review   { background: #f9fafb !important; }
      .pinned-total-row { background: #eff6ff !important; font-weight: 700 !important; }
      .pinned-total-row .ag-cell { font-weight: 700 !important; color: #1e40af !important; }
      /* Compact grid: smaller type and tighter columns so the default columns fit one screen, headers wrap onto 2-3 lines */
      .mtb-compact { --ag-font-size: 10.5px; --ag-grid-size: 4px; --ag-cell-horizontal-padding: 6px; }
      .mtb-compact .ag-cell { font-size: 11.5px; }
      .mtb-compact .ag-header-cell, .mtb-compact .ag-header-group-cell { padding-left: 6px; padding-right: 6px; }
      .mtb-compact .ag-header-cell-text { white-space: normal; line-height: 1.2; font-size: 11px; }
      .mtb-compact .ag-floating-filter-input input { font-size: 11px; padding-left: 4px; padding-right: 4px; }
    `
    document.head.appendChild(style)
    return () => style.remove()
  }, [])

  // ── Keyboard shortcuts (only when no modal is open) ───────────────────────
  useEffect(() => {
    const noModalOpen = !overrideRow && !conflictRow && !discrepancyRow && !showBulkOverride && !confirmClear
    if (!noModalOpen) return

    const handler = (e) => {
      const tag = document.activeElement?.tagName
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'

      // Ctrl+R — Run Mapping
      if ((e.ctrlKey || e.metaKey) && e.key === 'r' && !e.altKey) {
        e.preventDefault()
        handleRunMapping()
        return
      }
      // Ctrl+F — Focus search
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
        return
      }
      // Escape — clear search if focused, otherwise ignore
      if (e.key === 'Escape' && inInput) {
        setQuickFilter('')
        searchRef.current?.blur()
        return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [overrideRow, conflictRow, discrepancyRow, showBulkOverride, confirmClear, activeTB, activeRsId])

  // ── Escape closes inline confirmClear ────────────────────────────────────
  useEffect(() => {
    if (!confirmClear) return
    const handler = (e) => { if (e.key === 'Escape') setConfirmClear(false) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [confirmClear])

  const loadRows = useCallback(async (tbId) => {
    setLoading(true)
    try {
      const data = await window.api?.getMappedRows(tbId)
      setRows(data || [])
      setSelectedRows([])
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    if (activeTB?.id) loadRows(activeTB.id)
    else setRows([])
  }, [activeTB])

  // Previous Year ledger-level lookup for the "PY Closing Bal." column —
  // matched by ledger_code (falling back to name), an actual identity match
  // across the two TBs (same convention as buildPrevRowsByLedger in
  // useFinancials.js used for Annexures' per-ledger PY figures).
  useEffect(() => {
    if (!prevTB?.id) { setPrevRowMap(new Map()); return }
    window.api?.getMappedRows(prevTB.id).then(data => {
      const map = new Map()
      for (const r of (data || [])) {
        const key = (r.ledger_code || r.name || '').trim().toLowerCase()
        if (!key) continue
        map.set(key, (map.get(key) || 0) + parseFloat(r.closing_balance || 0))
      }
      setPrevRowMap(map)
    }).catch(() => setPrevRowMap(new Map()))
  }, [prevTB?.id])

  // Load LevelFormat for inline dropdown options
  useEffect(() => {
    if (!entity?.constitution) return
    window.api?.getLevelFormat(entity.constitution, activeRsId || null)
      .then(data => setLevelFormat(data || []))
      .catch(() => {})
  }, [entity?.constitution, activeRsId])

  // ── LevelFormat lookup helpers for inline dropdowns ───────────────────────
  const lfUnique = (arr) => [...new Set(arr.filter(Boolean))]
  const lfM1Options = useMemo(() => {
    const set = new Set()
    for (const r of levelFormat) {
      if (!r.level1) continue
      const opts = parseSlashOptions(r.level1)
      if (opts) opts.forEach(o => set.add(o)); else set.add(r.level1)
    }
    return [...set]
  }, [levelFormat])
  const lfM2ByM1 = useMemo(() => {
    const map = {}
    for (const r of levelFormat) {
      if (!r.level1 || !r.level2) continue
      if (!map[r.level1]) map[r.level1] = new Set()
      const opts = parseSlashOptions(r.level2)
      if (opts) opts.forEach(o => map[r.level1].add(o)); else map[r.level1].add(r.level2)
    }
    return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, [...v]]))
  }, [levelFormat])
  const lfM3ByM1M2 = useMemo(() => {
    const map = {}
    for (const r of levelFormat) {
      if (!r.level1 || !r.level2 || !r.level3) continue
      const key = `${r.level1}||${r.level2}`
      if (!map[key]) map[key] = new Set()
      // If the L3 cell holds slash-separated alternates (e.g.
      // "Due to MSME / Due to Creditors other than MSME" or
      // "Secured, considered good / Unsecured, considered good / Doubtful"),
      // expose each alternate as its own dropdown option — matching the way
      // Model Format renders these cells.
      const opts = parseSlashOptions(r.level3)
      if (opts) {
        for (const o of opts) map[key].add(o)
      } else {
        map[key].add(r.level3)
      }
    }
    return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, [...v]]))
  }, [levelFormat])

  // ── Inline save helper (local update, no full reload) ──────────────────
  const inlineSaveMapping = useCallback(async (rowData, updates) => {
    // Fields the edit sets to null are cleared, not kept (utils/mappingEdit.js).
    const merged = mergeMappingEdit(rowData, updates)
    // Update locally first (instant UI feedback)
    setRows(prev => prev.map(r => r.id === rowData.id
      ? { ...r, ...merged, status: 'user_override', confidence: 'high' }
      : r
    ))
    // Save to DB in background
    try { await window.api?.overrideRow(rowData.id, merged) } catch {}
  }, [])

  // ── Apply mapping to all selected rows (bulk inline) ──────────────────────
  const applyToSelected = useCallback(async (updates) => {
    const sel = gridRef.current?.api?.getSelectedRows() || []
    if (sel.length === 0) return
    const ids = sel.map(r => r.id)
    // Update locally first
    setRows(prev => prev.map(r => ids.includes(r.id)
      ? { ...r, ...updates, status: 'user_override', confidence: 'high' }
      : r
    ))
    // Save to DB
    const payload = {
      mapping1_resultant: updates.mapping1_resultant || null,
      mapping2_resultant: updates.mapping2_resultant || null,
      mapping3_resultant: updates.mapping3_resultant || null,
      level_format_id: updates.level_format_id || null,
      level4_value: updates.level4_value || null,
      level5_value: updates.level5_value || null,
      level6_value: updates.level6_value || null,
      level7_value: updates.level7_value || null,
      override_note: null,
    }
    try { await window.api?.overrideMany(ids, payload) } catch {}
  }, [])

  // ── Run mapping ───────────────────────────────────────────────────────────
  // Zero-balance ledgers (zero in BOTH Opening and Closing — i.e. zero in
  // Current Year AND Previous Year) are excluded by default: classifying
  // them ledger-by-ledger is pure overhead since they never move a figure
  // anywhere. No blocking prompt each run — "Include Zero Balance" below
  // stays available for whoever actually wants them mapped too.
  const handleRunMapping = () => {
    if (!activeTB)    { setError('Load a Trial Balance first (Actual TB tab).'); return }
    if (!activeRsId)  { setError('No mapping rule set selected (Mapping Rules tab).'); return }
    executeMapping(true)
  }

  const executeMapping = async (excludeZero) => {
    setRunning(true); setError('')
    try {
      const s = await window.api?.runMapping(activeTB.id, activeRsId, { excludeZero })
      setSummary(s)
      setExcludedZero(excludeZero)
      await loadRows(activeTB.id)
    } catch (err) { setError(err.message || 'Mapping failed.') }
    finally { setRunning(false) }
  }

  // ── Include zero-balance ledgers (re-run without exclusion) ───────────────
  const handleIncludeZeroBalance = async () => {
    if (!activeTB || !activeRsId) return
    setRunning(true); setError('')
    try {
      const s = await window.api?.runMapping(activeTB.id, activeRsId, { excludeZero: false })
      setSummary(s)
      setExcludedZero(false)
      await loadRows(activeTB.id)
    } catch (err) { setError(err.message || 'Mapping failed.') }
    finally { setRunning(false) }
  }

  // ── Single approve ────────────────────────────────────────────────────────
  const handleApprove = async (rowData) => {
    await window.api?.approveRow(rowData.id)
    setRows(prev => prev.map(r => r.id === rowData.id ? { ...r, status: 'user_approved' } : r))
  }

  // ── Override save ─────────────────────────────────────────────────────────
  const handleOverrideSave = async (id, data) => {
    await window.api?.overrideRow(id, data)
    await loadRows(activeTB.id)
    setOverrideRow(null)
  }

  // ── Conflict resolve ──────────────────────────────────────────────────────
  // ── A ledger added at the end of the Trial Balance, and its removal ──────
  const handleAddLedgerSave = async (_id, data) => {
    await window.api.addManualLedger(activeTB.id, data)    // refused with a message (shown in the dialog) if anything is wrong
    setAddLedgerOpen(false)
    await loadRows(activeTB.id)
    await refreshAdjSummary()
  }
  const handleRemoveManualLedger = async (r) => {
    if (!window.confirm(`Remove the ledger "${r.name}" that was added here?\n\nIts adjustment goes with it, and the Balance Sheet, Profit & Loss, Notes and Annexures lose it.`)) return
    try { await window.api.deleteManualLedger(r.id) }
    catch (e) { window.alert(String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); return }
    await loadRows(activeTB.id)
    await refreshAdjSummary()
  }

  const handleConflictResolve = async (id, chosen) => {
    await window.api?.resolveConflict(id, chosen)
    await loadRows(activeTB.id)
    setConflictRow(null)
  }

  // ── Discrepancy resolve ───────────────────────────────────────────────────
  const handleDiscrepancyResolve = async (id, action, option) => {
    await window.api?.resolveDiscrepancy(id, action, option)
    await loadRows(activeTB.id)
    setDiscrepancyRow(null)
  }

  // ── Bulk actions ──────────────────────────────────────────────────────────
  const handleBulkApprove = async () => {
    const ids = selectedRows.map(r => r.id)
    await window.api?.approveMany(ids)
    await loadRows(activeTB.id)
  }

  const handleMarkReview = async () => {
    const ids = selectedRows.map(r => r.id)
    await window.api?.markReview(ids)
    await loadRows(activeTB.id)
  }

  const handleBulkDone = async () => {
    setShowBulkOverride(false)
    await loadRows(activeTB.id)
  }

  const handleDownloadExcel = async () => {
    if (!activeTB) return
    setDownloading(true); setError('')
    try {
      const buf = await window.api?.downloadMappedTB(activeTB.id)
      const branchTag = activeTB.branch_name ? `_${activeTB.branch_name.replace(/[\\/:*?"<>|]/g, '')}` : ''
      const result = await window.api?.saveFileDialog({
        defaultPath: `MappedTB${branchTag}_${activeTB.period || 'export'}.xlsx`,
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      })
      if (result?.filePath && buf) await window.api?.writeFile(result.filePath, buf)
    } catch (err) { setError(err.message || 'Download failed.') }
    finally { setDownloading(false) }
  }

  const handleClearMappings = async () => {
    setClearing(true); setError('')
    try {
      await window.api?.clearAllMappings(activeTB.id)
      setRows([]); setSummary(null); setSelectedRows([])
    } catch (err) { setError(err.message || 'Clear failed.') }
    finally { setClearing(false); setConfirmClear(false) }
  }

  // ── Grid selection change ─────────────────────────────────────────────────
  const onSelectionChanged = useCallback(() => {
    if (!gridRef.current?.api) return
    setSelectedRows(gridRef.current.api.getSelectedRows())
  }, [])

  const handleSelectAll = () => {
    gridRef.current?.api?.selectAll()
  }

  const handleDeselectAll = () => {
    gridRef.current?.api?.deselectAll()
    setSelectedRows([])
  }

  // ── Location map (mirrors note-assignment in useFinancials) ──────────────
  const locationMap = useMemo(() => buildLocationMap(rows), [rows])

  // ── Filtered rows ─────────────────────────────────────────────────────────
  const filteredRows = filterStatus === 'all'
    ? rows
    : rows.filter(r =>
        filterStatus === 'conflict'      ? r.status === 'conflict' :
        filterStatus === 'discrepancy'   ? r.status === 'discrepancy' :
        filterStatus === 'unmapped'      ? r.status === 'unmapped' :
        filterStatus === 'needs_review'  ? r.status === 'needs_review' :
        filterStatus === 'approved'      ? (r.status === 'user_approved' || r.status === 'user_override') :
        r.confidence === filterStatus
      )

  // ── Pinned bottom totals row ──────────────────────────────────────────────
  const pinnedBottomRowData = useMemo(() => {
    if (filteredRows.length === 0) return []
    const sum = (fn) => filteredRows.reduce((s, r) => s + (fn(r) || 0), 0)
    // Clos Bal = as imported; Revised Clos Bal = after the Adjustments (what the statements use).
    return [{
      name: 'TOTAL',
      opening_balance: sum(r => parseFloat(r.opening_balance)),
      debit: sum(r => parseFloat(r.debit)),
      credit: sum(r => parseFloat(r.credit)),
      closing_balance: sum(importedOf),
      is_deemed_positive: null,
      _isTotal: true,
      _opnBalDebit:  sum(r => r.is_deemed_positive ? parseFloat(r.opening_balance || 0) * -1 : 0),
      _opnBalCredit: sum(r => !r.is_deemed_positive ? parseFloat(r.opening_balance || 0) : 0),
      _closBalDebit: sum(r => r.is_deemed_positive ? importedOf(r) * -1 : 0),
      _closBalCredit: sum(r => !r.is_deemed_positive ? importedOf(r) : 0),
      _adjDebit:  sum(r => adjAmt(r.adj_debit)),
      _adjCredit: sum(r => adjAmt(r.adj_credit)),
      _revDebit:  sum(r => r.is_deemed_positive ? revisedOf(r) * -1 : 0),
      _revCredit: sum(r => !r.is_deemed_positive ? revisedOf(r) : 0),
    }]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredRows, adjTick])

  // ── Adjustments (typed by the CA after the import) ───────────────────────
  // The closing balance is the one figure every statement, note, ratio and check
  // reads, and the database keeps it equal to  imported + Adj (Credit) - Adj (Debit)
  // (Cr positive, Dr negative) - so Revised (Debit) = Clos (Debit) + Adj (Debit) - Adj (Credit)
  // and Revised (Credit) = Clos (Credit) + Adj (Credit) - Adj (Debit). The screen shows the
  // figure it saved: what comes back replaces what was shown while the save ran.
  const refreshAdjSummary = useCallback(async () => {
    if (!activeTB?.id) { setAdjSummary(null); return }
    try { setAdjSummary(await window.api?.getAdjustmentSummary(activeTB.id)) } catch { setAdjSummary(null) }
  }, [activeTB?.id])
  useEffect(() => { setAdjNotice(''); refreshAdjSummary() }, [refreshAdjSummary])

  // Saves run one after the other, so two quick edits on one ledger cannot answer out of order.
  const adjQueue = useRef(Promise.resolve())
  const saveAdjustment = (data, key, value, old) => {
    const field = key === 'debit' ? 'adj_debit' : 'adj_credit'
    const before = revisedOf(data)
    data[field] = value
    data.imported_closing_balance = String(importedOf(data))
    data.closing_balance = String(importedOf(data) + adjAmt(data.adj_credit) - adjAmt(data.adj_debit))
    setAdjTick(t => t + 1)
    adjQueue.current = adjQueue.current.then(async () => {
      try {
        const res = await window.api?.setAdjustment(data.id, { [key]: value })
        if (res) {
          data.adj_debit = res.adj_debit; data.adj_credit = res.adj_credit
          data.closing_balance = res.closing_balance; data.imported_closing_balance = res.imported_closing_balance
        }
        const after = revisedOf(data)
        // Auto-Mapping classified this ledger on the sign of its balance as imported.
        setAdjNotice(before !== 0 && after !== 0 && (before < 0) !== (after < 0)
          ? `"${data.name}" now carries a ${after < 0 ? 'debit' : 'credit'} balance (was ${before < 0 ? 'debit' : 'credit'}). Its categorisation does not change by itself - check it in Rectification / Recategorisation, or run Auto-Mapping again.`
          : '')
        setAdjTick(t => t + 1)
        gridRef.current?.api?.refreshCells({ force: true })
        refreshAdjSummary()
      } catch (e) {
        data[field] = old
        data.closing_balance = String(importedOf(data) + adjAmt(data.adj_credit) - adjAmt(data.adj_debit))
        setAdjTick(t => t + 1)
        gridRef.current?.api?.refreshCells({ force: true })
        window.alert(String(e?.message || e).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''))
      }
    })
  }
  // Typed in rupees: with the figures shown in Hundreds / Lakhs / Crores a typed 5 would be read as 5 rupees,
  // not 5 of the unit on screen - so editing waits for As Is / No Decimals.
  const adjEditable = ((NUM_FORMATS[numFormat] || NUM_FORMATS['as_is']).divisor || 1) === 1
  const adjCol = (key, headerName) => {
    const field = key === 'debit' ? 'adj_debit' : 'adj_credit'
    const color = key === 'debit' ? '#1e40af' : '#065f46'
    const canEdit = (p) => adjEditable && !!p.data && !p.node?.rowPinned && !p.data._isTotal && !STOCK_TAB_ROWS.includes(p.data.upload_nature)
    return {
      colId: 'adj_' + key,
      headerName,
      width: 140,
      type: 'numericColumn',
      sortable: true,
      singleClickEdit: true,
      editable: canEdit,
      headerTooltip: adjEditable
        ? 'Type an amount in rupees. Revised Clos Bal = Clos Bal + Adjustments on the same side - Adjustments on the other side.'
        : 'Switch the number format to "As Is" or "No Decimals" to type adjustments (they are entered in rupees).',
      valueGetter: (p) => {
        if (!p.data) return null
        if (p.data._isTotal) return key === 'debit' ? p.data._adjDebit : p.data._adjCredit
        return adjAmt(p.data[field], true)
      },
      valueParser: (p) => {
        const s = String(p.newValue ?? '').replace(/,/g, '').trim()
        if (s === '') return null
        const n = Number(s)
        if (!Number.isFinite(n)) { setAdjNotice(`"${p.newValue}" is not an amount - nothing was changed.`); return undefined }
        if (n < 0) { setAdjNotice('An adjustment cannot be negative - to reduce a balance, enter the amount in the other Adjustments column.'); return undefined }
        return n
      },
      valueSetter: (p) => {
        if (p.newValue === undefined) return false            // not an amount - the old value stays
        const old = p.data[field] === undefined ? null : p.data[field]
        if (adjAmt(old) === adjAmt(p.newValue)) return false
        saveAdjustment(p.data, key, p.newValue, old)
        return true
      },
      valueFormatter: (p) => p.value == null ? '' : numFmt(p),
      cellStyle: (p) => p.node?.rowPinned ? { color } : { color, background: canEdit(p) ? '#fffbeb' : '#f9fafb' },
    }
  }
  const revCol = (key, headerName) => ({
    colId: 'rev_clos_' + key,
    headerName,
    width: 150,
    type: 'numericColumn',
    sortable: true,
    valueGetter: (p) => {
      if (!p.data) return null
      if (p.data._isTotal) return key === 'debit' ? p.data._revDebit : p.data._revCredit
      // Shown on the side the ledger sits on, as the Clos Bal columns do: a debit ledger in the
      // Debit column (balances stored negative, so x -1), the rest in the Credit column.
      if (key === 'debit') return p.data.is_deemed_positive ? revisedOf(p.data) * -1 : null
      return p.data.is_deemed_positive ? null : revisedOf(p.data)
    },
    valueFormatter: (p) => p.value == null ? '' : numFmt(p),
    cellStyle: { color: key === 'debit' ? '#1e40af' : '#065f46', fontWeight: 600 },
  })

  const handleClearAdjustments = async () => {
    if (!activeTB?.id || !adjSummary?.rows_adjusted) return
    const n = adjSummary.rows_adjusted
    if (!window.confirm(`Remove all ${n} adjustment${n === 1 ? '' : 's'} on this Trial Balance and go back to the imported closing balances? The Balance Sheet, P&L and notes will use the imported figures again.`)) return
    try {
      await window.api?.clearAdjustments(activeTB.id)
      setAdjNotice('')
      await loadRows(activeTB.id)
      await refreshAdjSummary()
    } catch (e) {
      window.alert(String(e?.message || e).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''))
    }
  }

  // ── Level cell renderer factory (for Level 5/6/7 slash-option dropdowns) ─
  const makeLevelRenderer = (field, lfField) => (p) => {
    if (!p.data || p.data._isTotal) return p.value || ''
    const val = p.value
    const lfVal = p.data[lfField] || ''
    const opts = parseSlashOptions(lfVal) || parseSlashOptions(val)
    if (opts) {
      return (
        <select
          className="border border-blue-200 rounded text-xs px-1 py-0.5 bg-white text-blue-800 w-full"
          value={val || ''}
          onChange={async (e) => {
            e.stopPropagation()
            const newVal = e.target.value
            try {
              await window.api?.overrideRow(p.data.id, {
                mapping1_resultant: p.data.mapping1_resultant,
                mapping2_resultant: p.data.mapping2_resultant,
                mapping3_resultant: p.data.mapping3_resultant,
                level_format_id: p.data.level_format_id,
                level4_value: field === 'level4_value' ? newVal : (p.data.level4_value || null),
                level5_value: field === 'level5_value' ? newVal : (p.data.level5_value || null),
                level6_value: field === 'level6_value' ? newVal : (p.data.level6_value || null),
                level7_value: field === 'level7_value' ? newVal : (p.data.level7_value || null),
                override_note: p.data.override_note || null,
              })
              p.node.setDataValue(field, newVal)
            } catch {}
          }}
          onClick={e => e.stopPropagation()}
        >
          <option value="">Select...</option>
          {opts.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      )
    }
    return <span className="text-xs text-gray-700">{val || ''}</span>
  }

  // ── Column definitions ────────────────────────────────────────────────────
  const allColDefs = [
    // Checkbox selection column
    {
      headerName: '',
      checkboxSelection: true,
      headerCheckboxSelection: true,
      headerCheckboxSelectionFilteredOnly: true,
      pinned: 'left',
      width: 38,
      sortable: false,
      filter: false,
      resizable: false,
      suppressMenu: true,
    },
    // TB columns
    { colId: 'ledger_code', field: 'ledger_code', headerName: 'Ledger Code', pinned: 'left', width: 100 },
    { colId: 'name', field: 'name', headerName: 'Ledger Name', pinned: 'left', width: 240, minWidth: 170, tooltipField: 'name' },
    { colId: 'opening_balance', field: 'opening_balance', headerName: 'Opening Bal.', width: 120, type: 'numericColumn', valueFormatter: numFmt },
    { colId: 'debit', field: 'debit', headerName: 'Debit', width: 120, type: 'numericColumn', valueFormatter: numFmt },
    { colId: 'credit', field: 'credit', headerName: 'Credit', width: 120, type: 'numericColumn', valueFormatter: numFmt },
    { colId: 'closing_balance', headerName: 'Closing Bal.', width: 120, type: 'numericColumn',
      valueGetter: (p) => !p.data ? null : p.data._isTotal ? p.data.closing_balance : importedOf(p.data),
      valueFormatter: numFmt },
    { colId: 'py_closing_balance', headerName: 'PY Closing Bal.', width: 130, type: 'numericColumn',
      valueGetter: p => {
        const key = (p.data?.ledger_code || p.data?.name || '').trim().toLowerCase()
        return key ? (prevRowMap.get(key) ?? null) : null
      },
      valueFormatter: numFmt,
    },
    {
      colId: 'opn_bal_debit',
      headerName: 'Opn Bal (Debit)',
      width: 130,
      type: 'numericColumn',
      sortable: true,
      filter: 'agNumberColumnFilter',
      valueGetter: (p) => {
        if (!p.data) return null
        if (p.data._isTotal) return p.data._opnBalDebit
        return p.data.is_deemed_positive ? p.data.opening_balance * -1 : null
      },
      valueFormatter: (p) => p.value == null ? '' : numFmt(p),
      cellStyle: { color: '#1e40af' },
    },
    {
      colId: 'opn_bal_credit',
      headerName: 'Opn Bal (Credit)',
      width: 130,
      type: 'numericColumn',
      sortable: true,
      filter: 'agNumberColumnFilter',
      valueGetter: (p) => {
        if (!p.data) return null
        if (p.data._isTotal) return p.data._opnBalCredit
        return p.data.is_deemed_positive ? null : p.data.opening_balance
      },
      valueFormatter: (p) => p.value == null ? '' : numFmt(p),
      cellStyle: { color: '#065f46' },
    },
    {
      colId: 'clos_bal_debit',
      headerName: 'Clos Bal (Debit)',
      width: 130,
      type: 'numericColumn',
      sortable: true,
      filter: 'agNumberColumnFilter',
      valueGetter: (p) => {
        if (!p.data) return null
        if (p.data._isTotal) return p.data._closBalDebit
        return p.data.is_deemed_positive ? importedOf(p.data) * -1 : null
      },
      valueFormatter: (p) => p.value == null ? '' : numFmt(p),
      cellStyle: { color: '#1e40af' },
    },
    {
      colId: 'clos_bal_credit',
      headerName: 'Clos Bal (Credit)',
      width: 130,
      type: 'numericColumn',
      sortable: true,
      filter: 'agNumberColumnFilter',
      valueGetter: (p) => {
        if (!p.data) return null
        if (p.data._isTotal) return p.data._closBalCredit
        return p.data.is_deemed_positive ? null : importedOf(p.data)
      },
      valueFormatter: (p) => p.value == null ? '' : numFmt(p),
      cellStyle: { color: '#065f46' },
    },
    adjCol('debit',  'Adjustments (Debit)'),
    adjCol('credit', 'Adjustments (Credit)'),
    revCol('debit',  'Revised Clos Bal (Debit)'),
    revCol('credit', 'Revised Clos Bal (Credit)'),
    { colId: 'group_parent', field: 'group_parent', headerName: 'Tally Group', width: 160 },
    // ALIE column before Mapping columns
    { colId: 'alie', field: 'alie', headerName: 'ALIE', width: 180,
      cellStyle: (p) => {
        const v = (p.value || '').toLowerCase()
        if (v.includes('asset'))     return { color: '#1e40af', fontWeight: 500 }
        if (v.includes('liabilit') || v.includes('equity')) return { color: '#065f46', fontWeight: 500 }
        if (v.includes('income'))    return { color: '#15803d', fontWeight: 500 }
        if (v.includes('expense'))   return { color: '#b45309', fontWeight: 500 }
        return { color: '#6b7280' }
      }
    },
    // Mapping columns — inline dropdown editing with multi-row apply
    { colId: 'mapping1', field: 'mapping1_resultant', headerName: 'Mapping 1 (Broad)', width: 220,
      cellRenderer: (p) => {
        if (!p.data || p.data._isTotal) return p.value || ''
        return (
          <select
            className="border border-blue-200 rounded text-xs px-1 py-0.5 bg-white text-blue-800 w-full font-medium"
            value={p.value || ''}
            onChange={(e) => {
              e.stopPropagation()
              const val = e.target.value
              const updates = {
                mapping1_resultant: val,
                mapping2_resultant: null, mapping3_resultant: null,
                level_format_id: null,
                level4_value: null, level5_value: null, level6_value: null, level7_value: null,
              }
              const sel = gridRef.current?.api?.getSelectedRows() || []
              if (sel.length > 1 && sel.some(r => r.id === p.data.id)) {
                applyToSelected(updates)
              } else {
                inlineSaveMapping(p.data, updates)
              }
            }}
            onClick={e => e.stopPropagation()}
          >
            <option value="">—</option>
            {lfM1Options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        )
      }
    },
    { colId: 'mapping2', field: 'mapping2_resultant', headerName: 'Mapping 2 (Category)', width: 250,
      cellRenderer: (p) => {
        if (!p.data || p.data._isTotal) return p.value || ''
        const m1 = p.data.mapping1_resultant || ''
        const opts = lfM2ByM1[m1] || []
        return (
          <select
            className="border border-blue-200 rounded text-xs px-1 py-0.5 bg-white text-blue-800 w-full"
            value={p.value || ''}
            onChange={(e) => {
              e.stopPropagation()
              const val = e.target.value
              const updates = {
                mapping1_resultant: m1,
                mapping2_resultant: val, mapping3_resultant: null,
                level_format_id: null,
                level4_value: null, level5_value: null, level6_value: null, level7_value: null,
              }
              const sel = gridRef.current?.api?.getSelectedRows() || []
              if (sel.length > 1 && sel.some(r => r.id === p.data.id)) {
                applyToSelected(updates)
              } else {
                inlineSaveMapping(p.data, updates)
              }
            }}
            onClick={e => e.stopPropagation()}
          >
            <option value="">—</option>
            {opts.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        )
      }
    },
    { colId: 'mapping3', field: 'mapping3_resultant', headerName: 'Mapping 3 (Specific)', width: 250,
      cellRenderer: (p) => {
        if (!p.data || p.data._isTotal) return p.value || ''
        const m1 = p.data.mapping1_resultant || ''
        const m2 = p.data.mapping2_resultant || ''
        const opts = lfM3ByM1M2[`${m1}||${m2}`] || []
        return (
          <select
            className="border border-blue-200 rounded text-xs px-1 py-0.5 bg-white text-blue-800 w-full"
            value={p.value || ''}
            onChange={(e) => {
              e.stopPropagation()
              const val = e.target.value
              const updates = {
                mapping1_resultant: m1, mapping2_resultant: m2,
                mapping3_resultant: val,
                level_format_id: null,
                level4_value: null, level5_value: null, level6_value: null, level7_value: null,
              }
              const sel = gridRef.current?.api?.getSelectedRows() || []
              if (sel.length > 1 && sel.some(r => r.id === p.data.id)) {
                applyToSelected(updates)
              } else {
                inlineSaveMapping(p.data, updates)
              }
            }}
            onClick={e => e.stopPropagation()}
          >
            <option value="">—</option>
            {opts.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        )
      }
    },
    { colId: 'level4', field: 'level4_value', headerName: 'Level 4', width: 180, cellRenderer: makeLevelRenderer('level4_value', 'lf_level4') },
    { colId: 'level5', field: 'level5_value', headerName: 'Level 5', width: 180, cellRenderer: makeLevelRenderer('level5_value', 'lf_level5') },
    { colId: 'level6', field: 'level6_value', headerName: 'Level 6', width: 180, cellRenderer: makeLevelRenderer('level6_value', 'lf_level6') },
    { colId: 'level7', field: 'level7_value', headerName: 'Level 7', width: 180, cellRenderer: makeLevelRenderer('level7_value', 'lf_level7') },
    // TB Remark column
    {
      colId: 'tb_remark', headerName: 'Remark', width: 160,
      cellRenderer: (p) => {
        if (!p.data || p.data._isTotal) return ''
        if (!activeTB?.id) return <span className="text-gray-300 text-xs">—</span>
        // Fall back to ledger name when code is missing (many TBs don't carry codes)
        const code = p.data.ledger_code || p.data.name
        if (!code) return <span className="text-gray-300 text-xs">—</span>
        return (
          <RemarkCell
            tbId={activeTB.id} scope="tb" scopeKey={code}
            initialValue={getRemark('tb', code)}
            onSaved={onRemarkSaved}
            label={p.data.name || code}
          />
        )
      },
      sortable: false, filter: false,
    },
    // Location abbreviation
    {
      colId: 'location',
      headerName: 'Location',
      width: 130,
      sortable: true,
      filter: 'agTextColumnFilter',
      valueGetter: (p) => locationMap.get(p.data?.id) || '—',
      cellStyle: (p) => {
        const v = p.value || ''
        if (v.startsWith('BS'))  return { color: '#1e40af', fontWeight: 500, fontSize: '11px' }
        if (v.startsWith('P&L')) return { color: '#065f46', fontWeight: 500, fontSize: '11px' }
        return { color: '#6b7280', fontSize: '11px' }
      },
    },
    // Status — pinned right
    {
      colId: 'status', headerName: 'Status', field: 'status', width: 106, pinned: 'right',
      sortable: true, filter: false,
      cellRenderer: (p) => p.data ? <StatusBadge status={p.data.status} /> : null,
    },
    // Actions — pinned right
    {
      headerName: 'Actions', width: 158, pinned: 'right',
      sortable: false, filter: false, resizable: false,
      cellRenderer: (p) => {
        const r = p.data
        if (!r) return null
        const isApproved     = r.status === 'user_approved' || r.status === 'user_override'
        const isConflict     = r.status === 'conflict'
        const isDiscrepancy  = r.status === 'discrepancy'
        return (
          <div className="flex items-center gap-1 h-full">
            {isConflict ? (
              <button
                onClick={() => setConflictRow(r)}
                className="px-2 py-0.5 text-xs bg-purple-600 text-white rounded hover:bg-purple-700"
              >
                Resolve
              </button>
            ) : isDiscrepancy ? (
              <button
                onClick={() => setDiscrepancyRow(r)}
                className="px-2 py-0.5 text-xs bg-amber-600 text-white rounded hover:bg-amber-700"
              >
                Review
              </button>
            ) : !isApproved ? (
              <button
                onClick={() => handleApprove(r)}
                className="px-2 py-0.5 text-xs bg-green-600 text-white rounded hover:bg-green-700"
              >
                Approve
              </button>
            ) : null}
            <button
              onClick={() => setOverrideRow(r)}
              className="px-2 py-0.5 text-xs border border-blue-600 text-blue-700 rounded hover:bg-blue-50"
            >
              Override
            </button>
            {r.upload_nature === 'Manual Ledger' && (
              <button
                onClick={() => handleRemoveManualLedger(r)}
                title="Remove this ledger (it was added here, not imported)"
                className="px-1.5 py-0.5 text-xs border border-red-300 text-red-600 rounded hover:bg-red-50"
              >
                &#10005;
              </button>
            )}
          </div>
        )
      }
    }
  ]

  // Toggleable columns (all that have colId, excluding checkbox)
  const toggleableCols = allColDefs.filter(c => c.colId)
  // Every amount column filters by typed amount — >100000, <500, 1000-5000 —
  // read as displayed (Lakhs / Crores included), utils/amountFilter.js.
  const amountFilter = agAmountFilter(() => (NUM_FORMATS[_numFormatKey] || NUM_FORMATS['as_is']).divisor)
  // Amount columns are fitted to their figures (autoFitAmounts); the ledger name - which can be long, and
  // shows in full in its tooltip - takes the width that is left. With only the default columns showing there
  // is nothing to scroll sideways, unless the window is too narrow to hold them.
  const onlyDefaultCols = [...visibleCols].every(id => DEFAULT_VISIBLE_COLS.includes(id))
  // Width left for the ledger name once the tick box, Status, Actions and the fitted amount columns have theirs.
  const amountsWidth = AMOUNT_COL_IDS.filter(id => visibleCols.has(id)).reduce((sum, id) => sum + (amountWidths[id] ?? 104), 0)
  const nameFill = gridWidth - (38 + 106 + 158 + 6) - amountsWidth
  const defaultsFit = onlyDefaultCols && nameFill >= 170      // the default columns hold on one screen: nothing to scroll
  const colDefs = allColDefs.filter(c => !c.colId || visibleCols.has(c.colId))
    .map(c => {
      if (c.type === 'numericColumn') {
        return { ...c, width: amountWidths[c.colId] ?? c.width, minWidth: 100, maxWidth: 220, ...amountFilter, ...(c.headerTooltip ? { headerTooltip: c.headerTooltip } : {}) }
      }
      if (c.colId === 'name' && onlyDefaultCols) return { ...c, width: Math.max(170, Math.floor(nameFill)) }
      return c
    })
  const hiddenCount = toggleableCols.filter(c => !visibleCols.has(c.colId)).length

  const autoFitAmounts = useCallback(() => {
    const api = gridRef.current?.api
    if (!api) return
    const ids = AMOUNT_COL_IDS.filter(id => visibleCols.has(id))
    if (!ids.length) return
    api.autoSizeColumns(ids, true)
    const widths = {}
    for (const id of ids) { const col = api.getColumn(id); if (col) widths[id] = Math.ceil(col.getActualWidth()) + 4 }
    setAmountWidths(prev => (ids.every(id => prev[id] === widths[id]) ? prev : { ...prev, ...widths }))
  }, [visibleCols])
  // Re-fit when the figures change (a new load, an Adjustment typed, another number format) or other columns are shown.
  useEffect(() => {
    const t = setTimeout(autoFitAmounts, 80)
    return () => clearTimeout(t)
  }, [autoFitAmounts, numFormat, adjTick, rows.length, filterStatus, loading])

  const toggleColumn = (colId) => {
    setVisibleCols(prev => {
      const next = new Set(prev)
      if (next.has(colId)) next.delete(colId)
      else next.add(colId)
      return next
    })
  }

  const colPanelRef = useRef(null)
  useEffect(() => {
    if (!showColPanel) return
    const handler = (e) => {
      if (colPanelRef.current && !colPanelRef.current.contains(e.target)) setShowColPanel(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showColPanel])

  const getRowClass = (p) => ROW_CLASS[p.data?.status] || ''

  // ── Status filter chips data ──────────────────────────────────────────────
  const counts = {
    all:          rows.length,
    high:         rows.filter(r => r.confidence === 'high'   && r.status !== 'conflict').length,
    medium:       rows.filter(r => r.confidence === 'medium' && r.status !== 'conflict').length,
    low:          rows.filter(r => r.confidence === 'low').length,
    conflict:     rows.filter(r => r.status === 'conflict').length,
    discrepancy:  rows.filter(r => r.status === 'discrepancy').length,
    unmapped:     rows.filter(r => r.status === 'unmapped').length,
    approved:     rows.filter(r => r.status === 'user_approved' || r.status === 'user_override').length,
    needs_review: rows.filter(r => r.status === 'needs_review').length,
  }

  const chips = [
    { key: 'all',          label: `All (${counts.all})`,                       cls: 'bg-gray-100 text-gray-700' },
    { key: 'high',         label: `High (${counts.high})`,                     cls: 'bg-green-100 text-green-800' },
    { key: 'medium',       label: `Medium (${counts.medium})`,                 cls: 'bg-yellow-100 text-yellow-800' },
    { key: 'low',          label: `Low (${counts.low})`,                       cls: 'bg-orange-100 text-orange-800' },
    { key: 'conflict',     label: `Conflict (${counts.conflict})`,             cls: 'bg-purple-100 text-purple-800' },
    { key: 'discrepancy',  label: `Discrepancy (${counts.discrepancy})`,       cls: 'bg-amber-100 text-amber-800' },
    { key: 'unmapped',     label: `Unmapped (${counts.unmapped})`,             cls: 'bg-red-100 text-red-800' },
    { key: 'approved',     label: `Approved (${counts.approved})`,             cls: 'bg-blue-100 text-blue-800' },
    { key: 'needs_review', label: `Needs Review (${counts.needs_review})`,     cls: 'bg-gray-100 text-gray-600' },
  ]

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full gap-3">
      <LockBanner entity={entity} activeTB={activeTB} onUnlocked={() => activeTB?.id && loadRows(activeTB.id)} />
      <div className="flex flex-col p-4 pt-0 gap-3 flex-1 overflow-hidden">

      {/* ── Top toolbar ── */}
      <div className="flex items-center gap-3 flex-wrap shrink-0">
        <button
          onClick={handleRunMapping}
          disabled={running || !activeTB}
          title="Run Auto-Mapping (Ctrl+R)"
          className="flex items-center gap-2 px-4 py-1.5 bg-blue-700 text-white text-sm rounded font-medium hover:bg-blue-800 disabled:opacity-40 transition"
        >
          {running
            ? <><svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg> Running…</>
            : '▶ Run Auto-Mapping'
          }
        </button>

        {onOpenMappingRules && (
          <button
            onClick={onOpenMappingRules}
            title="Open Mapping Rules (Alt+P, then U)"
            className="px-3 py-1.5 border border-blue-300 text-blue-700 text-sm rounded font-medium hover:bg-blue-50 transition"
          >⚙ Mapping Rules</button>
        )}

        {rows.length > 0 && (
          <>
            <button
              onClick={handleDownloadExcel}
              disabled={downloading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white text-sm rounded font-medium hover:bg-green-700 disabled:opacity-40 transition"
              title="Download Mapped Trial Balance as Excel"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17v3a2 2 0 002 2h14a2 2 0 002-2v-3" />
              </svg>
              {downloading ? 'Exporting…' : 'Download Excel'}
            </button>
            <button
              onClick={() => setConfirmClear(true)}
              disabled={clearing}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-red-300 text-red-600 text-sm rounded hover:bg-red-50 disabled:opacity-40 transition"
              title="Clear all mapping results for this Trial Balance"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12l6.414 6.414a2 2 0 001.414.586H19a2 2 0 002-2V7a2 2 0 00-2-2h-8.172a2 2 0 00-1.414.586L3 12z" />
              </svg>
              Clear Mappings
            </button>
            {excludedZero ? (
              <button
                onClick={handleIncludeZeroBalance}
                disabled={running}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-amber-400 text-amber-700 text-sm rounded hover:bg-amber-50 disabled:opacity-40 transition font-medium"
                title="Re-run mapping including ledgers with zero Opening and Closing Balance"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                Include Zero Balance
              </button>
            ) : (
              <button
                onClick={() => executeMapping(true)}
                disabled={running}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-amber-400 text-amber-700 text-sm rounded hover:bg-amber-50 disabled:opacity-40 transition font-medium"
                title="Re-run mapping excluding ledgers with zero Opening and Closing Balance"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 12H6" />
                </svg>
                Exclude Zero Balance
              </button>
            )}
          </>
        )}

        <PYTBSelector entity={entity} currentTBId={activeTB?.id} prevTB={prevTB} onChange={onPrevTBChange} />

        <div className="ml-auto flex items-center gap-2">
          {/* Number format selector */}
          <select
            value={numFormat}
            onChange={e => {
              const key = e.target.value
              setNumFormat(key)
              setNumFormatKey(key)
              gridRef.current?.api?.refreshCells({ force: true })
            }}
            className="border border-gray-300 rounded px-2 py-1.5 text-xs text-gray-700 focus:ring-2 focus:ring-blue-400 focus:outline-none"
            title="Number display format"
          >
            {Object.entries(NUM_FORMATS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
          {/* Column visibility toggle */}
          <div className="relative" ref={colPanelRef}>
            <button
              onClick={() => setShowColPanel(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-700 text-sm rounded hover:bg-gray-50 transition"
              title="Show / Hide Columns"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" />
              </svg>
              Columns{hiddenCount > 0 ? ` (${hiddenCount} hidden)` : ''}
            </button>
            {showColPanel && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 w-56 max-h-96 overflow-y-auto py-1">
                <div className="flex items-center justify-between px-3 py-1 border-b border-gray-100 mb-1 text-xs">
                  <button onClick={() => setVisibleCols(new Set(toggleableCols.map(c => c.colId)))} className="text-blue-600 hover:underline font-medium">Select all</button>
                  <button onClick={() => setVisibleCols(new Set(DEFAULT_VISIBLE_COLS))} className="text-blue-600 hover:underline font-medium" title="The columns the screen opens with">Default view</button>
                </div>
                {toggleableCols.map(c => (
                  <label
                    key={c.colId}
                    className="flex items-center gap-2 px-3 py-1 hover:bg-gray-50 cursor-pointer text-xs text-gray-700"
                  >
                    <input
                      type="checkbox"
                      checked={visibleCols.has(c.colId)}
                      onChange={() => toggleColumn(c.colId)}
                      className="rounded border-gray-300"
                    />
                    {c.headerName}
                  </label>
                ))}
              </div>
            )}
          </div>
          <input
            ref={searchRef}
            type="text"
            placeholder="Search… (Ctrl+F)"
            value={quickFilter}
            onChange={e => setQuickFilter(e.target.value)}
            onKeyDown={e => e.key === 'Escape' && (setQuickFilter(''), e.target.blur())}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm w-48 text-gray-900 bg-white focus:ring-2 focus:ring-blue-400 focus:outline-none"
          />
          {quickFilter && <button onClick={() => setQuickFilter('')} className="text-gray-400 text-sm">✕</button>}
          <span className="text-[10px] text-gray-400" title={AMOUNT_FILTER_HELP}>Amount filter: &gt;1000 · &lt;500 · 1000-5000</span>
        </div>
      </div>

      {/* ── Trial Balance adjustments: what they do to the statements ── */}
      {adjSummary?.rows_adjusted > 0 && (
        <div className={`flex items-center gap-x-4 gap-y-1 flex-wrap shrink-0 px-3 py-1.5 rounded border text-xs ${adjSummary.revised_balanced ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-red-50 border-red-300 text-red-900'}`}>
          <span className="font-semibold">Adjustments are applied to the Balance Sheet, P&amp;L, notes and ratios</span>
          <span>{adjSummary.rows_adjusted} ledger{adjSummary.rows_adjusted === 1 ? '' : 's'}</span>
          <span>Adjustments: Dr {inr(adjSummary.total_debit)} · Cr {inr(adjSummary.total_credit)}</span>
          <span>Revised Trial Balance: Dr {inr(adjSummary.revised_dr)} · Cr {inr(adjSummary.revised_cr)}</span>
          {!adjSummary.revised_balanced && (
            <span className="font-semibold">⚠ Out of balance by {inr(Math.abs(adjSummary.revised_sum))} — the Balance Sheet will not tally until Debit equals Credit.</span>
          )}
          {adjSummary.revised_balanced && !adjSummary.adjustments_balanced && (
            <span>Adjustments Dr and Cr differ by {inr(Math.abs(adjSummary.difference))}, but the imported Trial Balance was out by the same amount — the revised one balances.</span>
          )}
          <button onClick={handleClearAdjustments} className="ml-auto px-2 py-0.5 border border-current rounded hover:bg-white/60" title="Remove every adjustment on this Trial Balance">Clear all adjustments</button>
        </div>
      )}
      {adjNotice && (
        <div className="flex items-start gap-2 shrink-0 px-3 py-1.5 rounded border border-amber-300 bg-amber-50 text-xs text-amber-900">
          <span>{adjNotice}</span>
          <button onClick={() => setAdjNotice('')} className="ml-auto text-amber-700 hover:text-amber-900" title="Dismiss">✕</button>
        </div>
      )}

      {/* ── Status filter chips ── */}
      <div className="flex items-center gap-1.5 flex-wrap shrink-0">
        {chips.map(({ key, label, cls }) => (
          <button
            key={key}
            onClick={() => setFilterStatus(key)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition ${cls} hover:opacity-80
              ${filterStatus === key ? 'ring-2 ring-offset-1 ring-blue-500' : ''}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Bulk action bar (visible only when rows selected) ── */}
      {selectedRows.length > 0 && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 shrink-0">
          <span className="text-sm font-semibold text-blue-800 mr-2">
            {selectedRows.length} ledger{selectedRows.length > 1 ? 's' : ''} selected
          </span>
          <span className="text-xs text-blue-600 mr-2">
            Change any dropdown to apply to all selected rows
          </span>

          <button
            onClick={handleBulkApprove}
            className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 transition font-medium"
          >
            ✓ Approve Selected
          </button>

          <button
            onClick={() => setShowBulkOverride(true)}
            className="px-3 py-1 text-xs bg-blue-700 text-white rounded hover:bg-blue-800 transition font-medium"
          >
            Override Selected
          </button>

          <button
            onClick={handleMarkReview}
            className="px-3 py-1 text-xs border border-gray-400 text-gray-700 rounded hover:bg-gray-100 transition font-medium"
          >
            Mark Needs Review
          </button>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={handleSelectAll}
              className="text-xs text-blue-600 hover:underline"
            >
              Select All ({filteredRows.length})
            </button>
            <span className="text-gray-300">|</span>
            <button
              onClick={handleDeselectAll}
              className="text-xs text-gray-500 hover:underline"
            >
              Deselect All
            </button>
          </div>
        </div>
      )}

      {/* ── Alerts ── */}
      {!activeTB && (
        <div className="text-amber-700 text-sm bg-amber-50 border border-amber-200 rounded px-3 py-2 shrink-0">
          Load a Trial Balance in the Actual TB tab first, then click Run Auto-Mapping.
        </div>
      )}
      {error && (
        <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded px-3 py-2 shrink-0">
          {error}
        </div>
      )}

      {/* ── Summary cards ── */}
      {summary && (
        <div className="flex gap-2 shrink-0 flex-wrap">
          {[
            { label: 'Total',       value: summary.total,       cls: 'text-blue-800' },
            { label: 'High',        value: summary.high,        cls: 'text-green-700' },
            { label: 'Medium',      value: summary.medium,      cls: 'text-yellow-700' },
            { label: 'Low',         value: summary.low,         cls: 'text-orange-700' },
            { label: 'Conflict',    value: summary.conflict,    cls: 'text-purple-700' },
            { label: 'Discrepancy', value: summary.discrepancy, cls: 'text-amber-700' },
            { label: 'Unmapped',    value: summary.unmapped,    cls: 'text-red-700' },
          ].map(({ label, value, cls }) => (
            <div key={label} className="summary-card">
              <div className="text-xs text-gray-500">{label}</div>
              <div className={`font-bold text-sm ${cls}`}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Grid ── */}
      <div className="flex-1 ag-theme-alpine mtb-compact overflow-hidden rounded border border-blue-100">
        {loading ? (
          <div className="flex items-center justify-center h-full"><LoadingNote /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2">
            <p className="text-sm">Run Auto-Mapping to populate this view</p>
          </div>
        ) : (
          <AgGridReact
            ref={gridRef}
            rowData={filteredRows}
            columnDefs={colDefs}
            quickFilterText={quickFilter}
            getRowClass={(p) => {
              if (p.node?.rowPinned) return 'pinned-total-row'
              return ROW_CLASS[p.data?.status] || ''
            }}
            rowSelection="multiple"
            suppressRowClickSelection={true}
            onSelectionChanged={onSelectionChanged}
            pinnedBottomRowData={pinnedBottomRowData}
            pagination={true}
            paginationPageSize={100}
            defaultColDef={{
              resizable: true, sortable: true, wrapHeaderText: true,
              filter: 'agTextColumnFilter', floatingFilter: true
            }}
            rowHeight={28}
            headerHeight={52}
            floatingFiltersHeight={30}
            suppressHorizontalScroll={defaultsFit}
            onGridSizeChanged={(e) => setGridWidth(e.clientWidth)}
            onFirstDataRendered={autoFitAmounts}
            tooltipShowDelay={300}
          />
        )}
      </div>

      {/* ── End of the Trial Balance: add a ledger that is not in it ── */}
      {Number.isInteger(Number(activeTB?.id)) && (
        <div className="shrink-0 flex items-center gap-3 px-3 py-2 rounded border border-dashed border-blue-300 bg-blue-50/40 text-xs text-gray-700">
          <button onClick={() => setAddLedgerOpen(true)}
            className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 transition whitespace-nowrap"
            title="Add a ledger that is not in the imported Trial Balance">&#65291; Add Ledger</button>
          <span>
            End of the Trial Balance: add a ledger that is not in the imported Trial Balance. Give it a name, map it at every level, and enter its Adjustment
            (Debit) / (Credit) &mdash; the Revised Closing Balance, Balance Sheet, Profit &amp; Loss, Notes and Annexures follow, like any other ledger.
          </span>
        </div>
      )}

      {/* ── Modals ── */}
      {addLedgerOpen && (
        <OverrideModal
          askLedger
          row={{ id: null, name: '' }}
          entity={entity}
          rsId={activeRsId || null}
          onSave={handleAddLedgerSave}
          onClose={() => setAddLedgerOpen(false)}
        />
      )}
      {overrideRow && (
        <OverrideModal
          row={overrideRow}
          entity={entity}
          rsId={activeRsId || null}
          onSave={handleOverrideSave}
          onClose={() => setOverrideRow(null)}
        />
      )}

      {conflictRow && (
        <ConflictModal
          row={conflictRow}
          onResolve={handleConflictResolve}
          onClose={() => setConflictRow(null)}
        />
      )}

      {discrepancyRow && (
        <DiscrepancyModal
          row={discrepancyRow}
          onResolve={handleDiscrepancyResolve}
          onClose={() => setDiscrepancyRow(null)}
        />
      )}

      {showBulkOverride && (
        <BulkOverrideModal
          selectedRows={selectedRows}
          entity={entity}
          rsId={activeRsId || null}
          onDone={handleBulkDone}
          onClose={() => setShowBulkOverride(false)}
        />
      )}

      {confirmClear && (
        <div className="modal-backdrop" onClick={() => setConfirmClear(false)}>
          <div className="modal-box max-w-sm" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold text-red-700 mb-2">Clear All Mappings?</h2>
            <p className="text-sm text-gray-600 mb-3">
              This will delete all <span className="font-semibold">{rows.length}</span> mapping
              results for this Trial Balance. The TB rows themselves will not be affected.
            </p>
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1 mb-4">
              All approvals, overrides and conflict resolutions will be lost. This cannot be undone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmClear(false)}
                className="flex-1 py-2 border border-gray-300 text-gray-600 rounded text-sm hover:bg-gray-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleClearMappings}
                disabled={clearing}
                className="flex-1 py-2 bg-red-600 text-white rounded text-sm font-medium hover:bg-red-700 disabled:opacity-40 transition"
              >
                {clearing ? 'Clearing…' : 'Yes, Clear'}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  )
}
