import React, { useState, useEffect, useMemo, useRef } from 'react'
import { fmtINR, parseSlashOptions } from '../../hooks/useFinancials'
import { pushAction, snapshotMapping } from '../../utils/undoManager'
import { resolveFixScope, fixOpensPreviousYear, natureLevelsFor, ledgerNeeds, isComplete, bulkNaturePlan } from '../../utils/fixTargets'
import HierarchyPopup from '../shared/HierarchyPopup'
import LockBanner from '../shared/LockBanner'
import PYTBSelector from '../shared/PYTBSelector'
import LoadingNote from '../shared/LoadingNote'
import { amountPasses, parseAmountFilter, AMOUNT_FILTER_HELP } from '../../utils/amountFilter'

const TEXT_FILTERS = [
  'name',
  'ledger_code',
  'book_alie',
  'parent',
  'group_parent',
  'group_parent_1',
  'group_parent_2',
  'group_parent_3',
  'mapping1_resultant',
  'mapping2_resultant',
  'mapping3_resultant',
  'status',
]

const COLUMNS = [
  { key: 'select', label: '', width: 44 },
  { key: 'name', label: 'Ledger in Books', width: 260 },
  { key: 'closing_balance', label: 'CY', width: 120 },
  { key: 'save', label: 'Save', width: 80 },
  { key: 'needs', label: 'To fix', width: 230 },
  { key: 'mapping1_resultant', label: 'Mapping 1', width: 210 },
  { key: 'mapping2_resultant', label: 'Mapping 2', width: 210 },
  { key: 'mapping3_resultant', label: 'Mapping 3', width: 210 },
  { key: 'status', label: 'Status', width: 120 },
  { key: 'book_alie', label: 'Books ALIE', width: 130 },
  { key: 'parent', label: 'Books Parent', width: 180 },
  { key: 'group_parent', label: 'Group', width: 180 },
  { key: 'group_parent_1', label: 'Subgroup 1', width: 180 },
  { key: 'group_parent_2', label: 'Subgroup 2', width: 180 },
  { key: 'group_parent_3', label: 'Subgroup 3', width: 180 },
]

const CUSTOM_VALUE = '__custom__'

// Level 4-7 classifications a ledger can need beyond Mapping 1/2/3 (utils/fixTargets.js). Their columns
// appear, right after Mapping 3, only where a ledger on screen needs them (Level 5 always).
const NATURE_COLUMNS = {
  4: { key: 'level4_value', label: 'Level 4 (sub-head)', width: 200, level: 4 },
  5: { key: 'level5_value', label: 'Level 5 (nature)', width: 190, level: 5 },
  6: { key: 'level6_value', label: 'Level 6 (Secured / Unsecured)', width: 170, level: 6 },
  7: { key: 'level7_value', label: 'Level 7 (specify nature)', width: 200, level: 7 },
}
const columnsWith = (levels) => {
  const out = []
  for (const c of COLUMNS) {
    out.push(c)
    if (c.key === 'mapping3_resultant') for (const l of levels) out.push(NATURE_COLUMNS[l])
  }
  return out
}

function getBookAlie(row) {
  return row.trial_balance_type || row.alie || ''
}

function textValue(row, key) {
  if (key === 'book_alie') return getBookAlie(row)
  return row[key] ?? ''
}

// The CY / PY figure as the column shows it (Dr-side heads shown positive) —
// what the amount filter compares against.
function shownAmount(row) {
  const bal = parseFloat(row.closing_balance || 0)
  return (row.alie === 'ASSETS' || row.alie === 'Expenses') ? -bal : bal
}

// "To fix" filter: anything still to fix, complete, or one particular need.
const NEEDS_ANY = '__any__', NEEDS_NONE = '__none__'

// The list is drawn a page at a time. A branch with tens of thousands of ledgers used to be drawn all at once - a dropdown or
// three in every row, millions of page elements - which froze the window for minutes and then ran the screen out of memory,
// leaving a blank white window. Paging changes only what is DRAWN: the filters, the counts, "select all" and the bulk bar
// still work on every ledger in the view.
const PAGE_SIZES = [100, 200, 500]

export default function Exceptions({ entity, activeTB, activeRsId, prevTB, onPrevTBChange, initialFilter }) {
  const [ledgers, setLedgers] = useState([])
  const [dropdownSource, setDropdownSource] = useState([])
  const [levelFormat, setLevelFormat] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [originalById, setOriginalById] = useState({})
  // Rows edited locally (via a single-row field change, not the checkbox-mirror
  // or bulk-apply paths, both of which persist immediately) but not yet written
  // to the DB. Any refresh() — triggered by saving a DIFFERENT row — used to
  // overwrite the whole `ledgers` array from a fresh DB fetch and silently drop
  // these in-progress edits; the fetch effect below now re-overlays them instead.
  const [dirtyIds, setDirtyIds] = useState(new Set())
  const dirtyIdsRef = useRef(new Set())
  useEffect(() => { dirtyIdsRef.current = dirtyIds }, [dirtyIds])
  const [search, setSearch] = useState('')
  const [columnFilters, setColumnFilters] = useState({})
  const [refreshTick, setRefreshTick] = useState(0)
  const [diagnostics, setDiagnostics] = useState(null)
  const [showAll, setShowAll] = useState(false)
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0])
  const [page, setPage] = useState(0)
  // Ledgers with zero balance in BOTH Current Year and Previous Year add no
  // figure anywhere and are hidden by default — classifying them is pure
  // overhead. Opt in here if a genuine reason exists to review them anyway.
  const [showZero, setShowZero] = useState(false)
  const [focusedRow, setFocusedRow] = useState(null)
  const [showHierarchy, setShowHierarchy] = useState(false)
  const [runningAutoMap, setRunningAutoMap] = useState(false)

  const [bulkM1, setBulkM1] = useState('')
  const [bulkM2, setBulkM2] = useState('')
  const [bulkM3, setBulkM3] = useState('')
  const [bulkL5, setBulkL5] = useState('')
  // Ledgers the default list was handed although nothing is left to fix on them (worked out once, when the list loads,
  // so a row does not vanish mid-edit); they are held back, counted, and can be shown with one click.
  const [hiddenComplete, setHiddenComplete] = useState(new Set())
  const [showHidden, setShowHidden] = useState(false)
  const [bulkL4, setBulkL4] = useState('')
  const [bulkL6, setBulkL6] = useState('')
  const [bulkL7, setBulkL7] = useState('')
  const resetBulkNature = () => { setBulkL4(''); setBulkL5(''); setBulkL6(''); setBulkL7('') }
  // "Level 4-7 only" bulk values, keyed by level (see bulkNaturePlan)
  const [levelOnly, setLevelOnly] = useState({})
  const [customEditor, setCustomEditor] = useState(null)
  // Which TB is actually being categorised right now — CY by default, or
  // the comparative PY TB. PY ledgers need the exact same mapping pass as
  // CY: an un-mapped PY TB is exactly why a Previous Year figure comes out
  // blank in Notes/Annexures/BS/PL, no matter how correct THIS year's own
  // mapping is (see buildPrevMap — it can only aggregate rows that already
  // have a real alie/level1/level2, i.e. rows that have actually been
  // categorised).
  const [categorisePY, setCategorisePY] = useState(false)

  // Scoping filter — set when this screen is opened via a "Fix" button from
  // BS/PL/Notes/Annexures (see App.jsx's handleFixClick), so only ledgers
  // relevant to whichever category was clicked are shown. Kept as its own
  // state (rather than using `initialFilter` directly) so the CA can clear
  // the scope from inside this screen without needing to go back and forth.
  const [scopeFilter, setScopeFilter] = useState(initialFilter || null)
  useEffect(() => {
    if (initialFilter) setScopeFilter(initialFilter)
    // A flag that exists only because of a Previous Year ledger opens the Previous Year
    // Trial Balance (it used to open this year's, find nothing and say "No exceptions").
    if (initialFilter) setCategorisePY(fixOpensPreviousYear(initialFilter, !!prevTB?.id))
  }, [initialFilter?.key])

  const targetTB = categorisePY ? prevTB : activeTB
  const tbId = targetTB?.id

  // A scoped Fix click always wins over "Show all mapped rows" — the CA
  // navigated here to fix exactly this category, not to browse everything.
  // A Fix from Notes / BS / P&L carries the ids of the ledgers behind the flagged line;
  // those are opened as they are, whatever captions they carry (see utils/fixTargets.js).
  const fixScope = resolveFixScope(scopeFilter, categorisePY)
  const activeFilter = scopeFilter
    ? (fixScope.idScoped ? { mappedIds: fixScope.ids } : fixScope.filter)
    : (showAll ? {} : { uncategorised: true })

  useEffect(() => {
    if (!tbId) return
    setLoading(true)
    setError('')
    Promise.all([
      // ids scope with nothing for this year = nothing to show (NOT "no filter" = everything)
      (fixScope.idScoped && !fixScope.ids.length) ? [] : (window.api?.findMappedByFilter(tbId, activeFilter) || []),
      entity?.constitution
        ? (window.api?.getLevelFormat(entity.constitution, activeRsId || null) || [])
        : [],
      // The "+ Custom line…" dropdowns offer every caption already used anywhere in this TB, even when the list is scoped
      // to one category. Only the DISTINCT Mapping 1/2/3 captions are needed, not every ledger (for a branch of 67,000
      // that was 76 MB of rows fetched to read a few hundred captions).
      (window.api?.listMappedCaptions ? window.api.listMappedCaptions(tbId) : window.api?.findMappedByFilter(tbId, {})) || [],
      // Custom captions the entity has finalised on ANY Trial Balance, past or
      // present. Without these the dropdowns are built from the current TB's
      // rows alone, so every custom line created earlier vanished from the list
      // as soon as a fresh TB was uploaded — the rule survived in
      // learned_ledger_rules, but there was no way to pick the caption again.
      entity?.id ? (window.api?.listLearnedRules(entity.id).catch(() => []) || []) : [],
    ]).then(([rows, lf, allRows, learned]) => {
      setLedgers(prev => {
        const fresh = rows || []
        if (!dirtyIdsRef.current.size) return fresh
        const dirtyMap = new Map(prev.filter(r => dirtyIdsRef.current.has(r.id)).map(r => [r.id, r]))
        return fresh.map(r => dirtyMap.has(r.id) ? dirtyMap.get(r.id) : r)
      })
      setLevelFormat(lf || [])
      const queueView = !scopeFilter && !showAll
      setHiddenComplete(queueView && (lf || []).length ? new Set((rows || []).filter(r => r.upload_nature !== 'Manual Ledger' && isComplete(lf, r)).map(r => r.id)) : new Set())
      setShowHidden(false)
      setDropdownSource([...(allRows || []), ...(learned || [])])
      setSelected(new Set())
      const snaps = {}
      for (const r of (rows || [])) snaps[r.id] = snapshotMapping(r)
      setOriginalById(snaps)
    }).catch(e => setError(e?.message || 'Failed to load')).finally(() => setLoading(false))
  }, [tbId, refreshTick, showAll, entity?.id, entity?.constitution, activeRsId, scopeFilter])

  const refresh = () => setRefreshTick(t => t + 1)

  // Bulk auto-map a TB — for Previous Year this is what actually carries
  // Current Year's classification across: runMapping's engine (see
  // mapped-tb.js's applyCarryForward) re-applies any user_override/
  // user_approved decision already made for a same-named ledger anywhere
  // else in this entity, CY included, onto the fresh PY rows automatically
  // — so a PY ledger that's already been classified in CY needs no separate
  // manual re-classification. A locked Previous Year period simply fails
  // this call (assertPeriodUnlockedForTB) and is left exactly as it was.
  const handleRunAutoMap = async () => {
    if (!tbId || !activeRsId) return
    setRunningAutoMap(true)
    setError('')
    try {
      // Zero-in-both-years ledgers excluded by default — see showZero above.
      await window.api?.runMapping(tbId, activeRsId, { excludeZero: !showZero })
      refresh()
    } catch (e) {
      setError(e?.message || 'Auto-mapping failed')
    } finally {
      setRunningAutoMap(false)
    }
  }

  // A Previous Year TB that has NEVER been mapped (no mapped_tb rows at all
  // yet) is auto-mapped the first time it's opened here — no manual "Run
  // Auto-Mapping (PY)" click needed. Carry-forward (see handleRunAutoMap's
  // comment above) then means every ledger already classified under Current
  // Year just inherits that same classification for free; only genuinely
  // PY-only/new ledgers are left needing attention. One-shot per TB per
  // session (autoRanRef) so this never fights a user's own "Clear All
  // Mappings" on the same TB, and silently no-ops if the period is locked.
  const autoRanRef = useRef(new Set())
  useEffect(() => {
    if (!categorisePY || !tbId || loading || runningAutoMap) return
    if (dropdownSource.length > 0) return
    if (autoRanRef.current.has(tbId)) return
    autoRanRef.current.add(tbId)
    handleRunAutoMap()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categorisePY, tbId, loading, dropdownSource])

  // If the comparative PY TB gets cleared elsewhere while it's the active
  // categorisation target here, fall back to CY rather than being stuck
  // pointed at nothing.
  useEffect(() => {
    if (categorisePY && !prevTB?.id) setCategorisePY(false)
  }, [categorisePY, prevTB?.id])

  // Ctrl+G: show hierarchy popup for focused row
  useEffect(() => {
    const handler = (e) => {
      if (e.ctrlKey && (e.key === 'g' || e.key === 'G') && focusedRow) {
        e.preventDefault()
        setShowHierarchy(true)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [focusedRow])

  // ── LevelFormat lookup maps (merged with custom values from existing data) ──
  const lfM1 = useMemo(() => {
    const set = new Set()
    for (const r of levelFormat) {
      if (!r.level1) continue
      const opts = parseSlashOptions(r.level1)
      if (opts) opts.forEach(o => set.add(o)); else set.add(r.level1)
    }
    // Add any custom M1 values already present in the TB data
    for (const r of dropdownSource) {
      if (r.mapping1_resultant) set.add(r.mapping1_resultant)
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [levelFormat, dropdownSource])

  const lfM2 = useMemo(() => {
    const m = {}
    for (const r of levelFormat) {
      if (!r.level1 || !r.level2) continue
      if (!m[r.level1]) m[r.level1] = new Set()
      const opts = parseSlashOptions(r.level2)
      if (opts) opts.forEach(o => m[r.level1].add(o)); else m[r.level1].add(r.level2)
    }
    // Add custom M2 values from TB data (e.g. previously typed custom face lines)
    for (const r of dropdownSource) {
      if (!r.mapping1_resultant || !r.mapping2_resultant) continue
      if (!m[r.mapping1_resultant]) m[r.mapping1_resultant] = new Set()
      m[r.mapping1_resultant].add(r.mapping2_resultant)
    }
    return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, [...v].sort((a, b) => a.localeCompare(b))]))
  }, [levelFormat, dropdownSource])

  const lfM3 = useMemo(() => {
    const m = {}
    for (const r of levelFormat) {
      if (!r.level1 || !r.level2 || !r.level3) continue
      const key = `${r.level1}||${r.level2}`
      if (!m[key]) m[key] = new Set()
      const opts = parseSlashOptions(r.level3)
      if (opts) opts.forEach(o => m[key].add(o)); else m[key].add(r.level3)
    }
    // Add custom M3 values from TB data (e.g. previously typed custom note lines)
    for (const r of dropdownSource) {
      if (!r.mapping1_resultant || !r.mapping2_resultant || !r.mapping3_resultant) continue
      const key = `${r.mapping1_resultant}||${r.mapping2_resultant}`
      if (!m[key]) m[key] = new Set()
      m[key].add(r.mapping3_resultant)
    }
    return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, [...v].sort((a, b) => a.localeCompare(b))]))
  }, [levelFormat, dropdownSource])

  const findLfRow = (m1, m2, m3) => {
    if (!m1) return null
    const stripSpec = (s) => (s || '').replace(/\s*\(specify nature\)/gi, '').trim().toLowerCase()
    // No Mapping 2 = the terminal Level-1 row (level2 empty), e.g. Finance
    // Costs. This used to return null, so every such save went out with
    // level_format_id = null and the row rendered with blank Level columns.
    // The server now resolves the id itself anyway (mappedTB:override), but
    // sending the right one keeps the optimistic local row correct too.
    if (!m2) {
      return levelFormat.find(r => stripSpec(r.level1) === stripSpec(m1) && !stripSpec(r.level2)) || null
    }
    return levelFormat.find(r =>
      stripSpec(r.level1) === stripSpec(m1) &&
      stripSpec(r.level2) === stripSpec(m2) &&
      (!m3 || stripSpec(r.level3) === stripSpec(m3))
    )
  }

  const bulkLfRow = useMemo(() => findLfRow(bulkM1, bulkM2, bulkM3), [bulkM1, bulkM2, bulkM3, levelFormat])
  const bulkL5Opts = bulkLfRow?.level5 ? parseSlashOptions(bulkLfRow.level5) : null
  // every Level 4-7 classification the chosen Mapping 1/2/3 calls for
  const bulkNatures = useMemo(
    () => natureLevelsFor(levelFormat, { mapping1_resultant: bulkM1, mapping2_resultant: bulkM2, mapping3_resultant: bulkM3 }),
    [levelFormat, bulkM1, bulkM2, bulkM3])
  const bulkNatureValue = { 4: bulkL4, 5: bulkL5, 6: bulkL6, 7: bulkL7 }
  const setBulkNature = (level, v) => ({ 4: setBulkL4, 5: setBulkL5, 6: setBulkL6, 7: setBulkL7 })[level](v)

  const openCustomEditor = (label, current, onSubmit) => {
    setCustomEditor({ label, value: current || '', onSubmit })
  }

  const closeCustomEditor = () => setCustomEditor(null)

  const submitCustomEditor = () => {
    const clean = (customEditor?.value || '').trim()
    if (!clean) return
    customEditor.onSubmit(clean)
    setCustomEditor(null)
  }

  const visibleLedgers = useMemo(() => {
    const q = search.trim().toLowerCase()
    return ledgers.filter(r => {
      if (!showHidden && hiddenComplete.has(r.id)) return false
      if (!showZero) {
        const cb = Math.abs(parseFloat(r.closing_balance) || 0)
        const ob = Math.abs(parseFloat(r.opening_balance) || 0)
        if (cb < 0.005 && ob < 0.005) return false
      }
      if (q) {
        const haystack = [
          r.name, r.ledger_code, getBookAlie(r), r.parent, r.group_parent,
          r.group_parent_1, r.group_parent_2, r.group_parent_3,
          r.mapping1_resultant, r.mapping2_resultant, r.mapping3_resultant,
          r.status,
        ].join(' ').toLowerCase()
        if (!haystack.includes(q)) return false
      }
      for (const key of TEXT_FILTERS) {
        const filter = (columnFilters[key] || '').trim().toLowerCase()
        if (!filter) continue
        if (!String(textValue(r, key)).toLowerCase().includes(filter)) return false
      }
      // Amount: >100000, <500, 1000-5000 … (utils/amountFilter.js)
      if (columnFilters.closing_balance && !amountPasses(columnFilters.closing_balance, shownAmount(r))) return false
      const nf = columnFilters.needs
      if (nf) {
        const needs = ledgerNeeds(levelFormat, r)
        if (nf === NEEDS_ANY ? !needs.length : nf === NEEDS_NONE ? needs.length > 0 : !needs.some(n => n.what === nf)) return false
      }
      return true
    })
  }, [ledgers, search, columnFilters, showZero, hiddenComplete, showHidden, levelFormat])

  // The kinds of fix the ledgers on screen still need, for the "To fix" filter.
  const needKinds = useMemo(() => {
    const kinds = new Set()
    for (const r of ledgers) for (const n of ledgerNeeds(levelFormat, r)) kinds.add(n.what)
    return [...kinds].sort()
  }, [ledgers, levelFormat])

  // Which of Level 4-7 the ledgers on screen call for (Level 5 always; the level a Fix was about too).
  const natureLevels = useMemo(() => {
    const used = new Set([5])
    for (const r of ledgers) for (const n of natureLevelsFor(levelFormat, r)) used.add(n.level)
    const focus = Number(scopeFilter?.focusLevel)
    if (focus >= 4 && focus <= 7) used.add(focus)
    return [4, 5, 6, 7].filter(l => used.has(l))
  }, [ledgers, levelFormat, scopeFilter?.focusLevel])
  const columns = useMemo(() => columnsWith(natureLevels), [natureLevels])
  const needFixCount = useMemo(() => visibleLedgers.filter(r => ledgerNeeds(levelFormat, r).length > 0).length, [visibleLedgers, levelFormat])

  // The page being drawn. Back to the first page whenever the list itself changes (another search, filter, tick box or
  // Trial Balance) - never on an edit, so saving a row on page 3 leaves you on page 3.
  useEffect(() => { setPage(0) }, [search, columnFilters, showHidden, showZero, showAll, tbId, scopeFilter, categorisePY])
  const pageCount = Math.max(1, Math.ceil(visibleLedgers.length / pageSize))
  const curPage = Math.min(page, pageCount - 1)
  const pageStart = curPage * pageSize
  const pagedLedgers = visibleLedgers.length > pageSize ? visibleLedgers.slice(pageStart, pageStart + pageSize) : visibleLedgers

  const selectedVisibleCount = visibleLedgers.filter(r => selected.has(r.id)).length
  const allChecked = visibleLedgers.length > 0 && selectedVisibleCount === visibleLedgers.length
  const someChecked = selectedVisibleCount > 0 && !allChecked
  const totalWidth = columns.reduce((s, c) => s + c.width, 0)
  const stickyLeft = { select: 0, name: 44, closing_balance: 304, save: 424 }

  // Auto-populate bulk pickers from selected rows (common values)
  useEffect(() => {
    if (selected.size === 0) return
    const rows = ledgers.filter(r => selected.has(r.id))
    if (!rows.length) return
    const common = (key) => {
      const vals = [...new Set(rows.map(r => (r[key] || '').trim()).filter(Boolean))]
      return vals.length === 1 ? vals[0] : ''
    }
    const nextM1 = common('mapping1_resultant')
    const nextM2 = nextM1 ? common('mapping2_resultant') : ''
    const nextM3 = nextM2 ? common('mapping3_resultant') : ''
    const nextL5 = nextM2 ? common('level5_value') : ''
    const nextL4 = nextM2 ? common('level4_value') : ''
    const nextL6 = nextM2 ? common('level6_value') : ''
    const nextL7 = nextM2 ? common('level7_value') : ''
    setBulkM1(prev => prev === nextM1 ? prev : nextM1)
    setBulkM2(prev => prev === nextM2 ? prev : nextM2)
    setBulkM3(prev => prev === nextM3 ? prev : nextM3)
    setBulkL5(prev => prev === nextL5 ? prev : nextL5)
    setBulkL4(prev => prev === nextL4 ? prev : nextL4)
    setBulkL6(prev => prev === nextL6 ? prev : nextL6)
    setBulkL7(prev => prev === nextL7 ? prev : nextL7)
  }, [selected, ledgers])

  const stickyStyle = (key, isHeader = false) => {
    if (!(key in stickyLeft)) return undefined
    return {
      position: 'sticky',
      left: stickyLeft[key],
      zIndex: isHeader ? 35 : 15,
    }
  }

  const stickyBg = (key, isChecked) => {
    if (!(key in stickyLeft)) return ''
    return isChecked ? 'bg-blue-50' : 'bg-white'
  }

  const setFilter = (key, value) => {
    setColumnFilters(prev => ({ ...prev, [key]: value }))
  }

  const clearFilters = () => {
    setSearch('')
    setColumnFilters({})
  }

  const toggleAll = () => {
    setSelected(prev => {
      const next = new Set(prev)
      if (allChecked) visibleLedgers.forEach(r => next.delete(r.id))
      else visibleLedgers.forEach(r => next.add(r.id))
      return next
    })
  }

  const toggleRow = (id) => {
    setSelected(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  // Mirrors displayAmt() in useFinancials.js (used by BS/PL) so the sign shown
  // here while reviewing categorisation matches what the financial statements
  // will actually show. Deliberately alie-driven, NOT is_deemed_positive-driven:
  // is_deemed_positive is inherited from the source Ledger Master's "Nature"
  // column, which can disagree with the ledger's actual resolved group/mapping
  // (e.g. a ledger grouped under Current Assets but whose Master Nature was
  // mistakenly left as "Liability") — using alie keeps this consistent with
  // where the ledger has actually been classified, not a possibly-stale flag.
  const rowAmt = (r, field) => {
    const bal = parseFloat(r[field] || 0)
    const isDrSide = (r.alie === 'ASSETS' || r.alie === 'Expenses')
    return isDrSide ? -bal : bal
  }

  // Total CY amount across ALL selected ledgers (not just the current filtered view).
  const selectedTotal = ledgers.reduce((s, r) => selected.has(r.id) ? s + rowAmt(r, 'closing_balance') : s, 0)

  const saveRow = async (row) => {
    const lfRow = findLfRow(row.mapping1_resultant, row.mapping2_resultant, row.mapping3_resultant)
    await window.api?.overrideRow(row.id, {
      mapping1_resultant: row.mapping1_resultant || null,
      mapping2_resultant: row.mapping2_resultant || null,
      mapping3_resultant: row.mapping3_resultant || null,
      level_format_id: lfRow?.id || null,
      level4_value: row.level4_value || null,
      level5_value: row.level5_value || null,
      level6_value: row.level6_value || null,
      level7_value: row.level7_value || null,
      override_note: row.override_note || null,
    })
  }

  const updateLedgerLocal = async (id, patch) => {
    const isChecked = selected.has(id)
    const shouldMirror = isChecked && selected.size > 1
    const targetIds = shouldMirror ? new Set(selected) : new Set([id])
    let updated = []
    setLedgers(prev => prev.map(r => {
      if (!targetIds.has(r.id)) return r
      const merged = { ...r, ...patch }
      updated.push(merged)
      return merged
    }))
    if (shouldMirror) {
      try {
        for (const r of updated) await saveRow(r)
        pushAction({
          label: `Mirror update (${updated.length} rows)`,
          changes: updated.map(r => ({
            id: r.id,
            before: originalById[r.id] || snapshotMapping(r),
            after: snapshotMapping(r),
          })),
        })
        setDirtyIds(prev => {
          const n = new Set(prev)
          for (const r of updated) n.delete(r.id)
          return n
        })
        refresh()
      } catch (e) { setError(e?.message || 'Mirror-save failed') }
    } else {
      setDirtyIds(prev => new Set(prev).add(id))
    }
  }

  const saveOne = async (row) => {
    setError('')
    try {
      await saveRow(row)
      pushAction({
        label: `Save row (${row.name})`,
        changes: [{
          id: row.id,
          before: originalById[row.id] || snapshotMapping(row),
          after: snapshotMapping(row),
        }],
      })
      setDirtyIds(prev => { const n = new Set(prev); n.delete(row.id); return n })
      refresh()
    } catch (e) { setError(e?.message || 'Save failed') }
  }

  // Persists every row currently edited-but-unsaved (dirtyIds) in one action —
  // for making several different, unrelated categorisation changes across rows
  // and then saving them all together, instead of one row at a time.
  const saveAllChanges = async () => {
    const ids = [...dirtyIds]
    if (!ids.length) return
    setSaving(true); setError('')
    try {
      const rows = ledgers.filter(r => ids.includes(r.id))
      for (const r of rows) await saveRow(r)
      pushAction({
        label: `Save all changes (${rows.length} rows)`,
        changes: rows.map(r => ({
          id: r.id,
          before: originalById[r.id] || snapshotMapping(r),
          after: snapshotMapping(r),
        })),
      })
      setDirtyIds(new Set())
      refresh()
    } catch (e) { setError(e?.message || 'Save all failed') }
    finally { setSaving(false) }
  }

  // Ticked ledgers: which Level 4-7 each still needs, and the options common to all of them.
  const levelOnlyPlan = useMemo(
    () => bulkNaturePlan(levelFormat, ledgers.filter(r => selected.has(r.id))),
    [levelFormat, ledgers, selected])

  // Sets ONE Level 4-7 on the ticked ledgers that call for it — their Mapping 1/2/3
  // and other levels are left exactly as they are.
  const applyLevelOnly = async (p) => {
    const value = (levelOnly[p.level] || '').trim()
    if (!value || !p.ids.length) return
    setSaving(true); setError('')
    try {
      const ids = new Set(p.ids)
      const updated = ledgers.map(r => ids.has(r.id) ? { ...r, [p.key]: value } : r)
      setLedgers(updated)
      const impacted = updated.filter(r => ids.has(r.id))
      for (const r of impacted) await saveRow(r)
      setDirtyIds(prev => {
        const n = new Set(prev)
        for (const r of impacted) n.delete(r.id)
        return n
      })
      pushAction({
        label: `Bulk Level ${p.level} (${impacted.length} rows)`,
        changes: impacted.map(r => ({
          id: r.id,
          before: originalById[r.id] || snapshotMapping(r),
          after: snapshotMapping(r),
        })),
      })
      setLevelOnly(prev => ({ ...prev, [p.level]: '' }))
      refresh()
    } catch (err) { setError(err?.message || 'Bulk save failed') }
    finally { setSaving(false) }
  }

  const applyBulk = async () => {
    if (!bulkM1 || selected.size === 0) {
      setError('Pick at least Mapping 1 and select one or more ledgers.')
      return
    }
    setSaving(true); setError('')
    try {
      const ids = [...selected]
      const patch = {
        mapping1_resultant: bulkM1,
        mapping2_resultant: bulkM2 || null,
        mapping3_resultant: bulkM3 || null,
        level4_value: bulkL4 || null,
        level5_value: bulkL5 || null,
        level6_value: bulkL6 || null,
        level7_value: bulkL7 || null,
      }
      const updated = ledgers.map(r => ids.includes(r.id) ? { ...r, ...patch } : r)
      setLedgers(updated)
      const impacted = updated.filter(r => ids.includes(r.id))
      for (const r of impacted) await saveRow(r)
      setDirtyIds(prev => {
        const n = new Set(prev)
        for (const r of impacted) n.delete(r.id)
        return n
      })
      pushAction({
        label: `Bulk apply (${impacted.length} rows)`,
        changes: impacted.map(r => ({
          id: r.id,
          before: originalById[r.id] || snapshotMapping(r),
          after: snapshotMapping(r),
        })),
      })
      refresh()
    } catch (e) { setError(e?.message || 'Bulk save failed') }
    finally { setSaving(false) }
  }

  if (!activeTB) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        Load a Trial Balance in the Actual TB tab first.
      </div>
    )
  }

  // One Level 4-7 cell of a ledger: a drop-down of its options where a choice must be made (red, "Choose…",
  // until it is), free text for "Specify nature", the fixed label where the format gives just one, a dash where
  // the level does not apply. A value that is not one of the options stays visible, marked, so it can be replaced.
  const renderNatureCell = (row, n) => {
    if (!n) return <span className="text-gray-300 text-xs">—</span>
    if (n.freeText) {
      return <input type="text" value={n.value} placeholder="Specify nature"
        onChange={e => updateLedgerLocal(row.id, { [n.key]: e.target.value })}
        className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs bg-white" />
    }
    if (!n.required) return <span className="text-gray-500 text-xs" title="Fixed by the Level Format">{n.fixed}</span>
    const opts = n.outdated ? [n.value, ...n.options] : n.options
    return (
      <select value={n.value} onChange={e => updateLedgerLocal(row.id, { [n.key]: e.target.value })}
        className={`w-full rounded px-1 py-0.5 text-xs bg-white border ${n.ok ? 'border-gray-300' : 'border-red-400 ring-1 ring-red-200'}`}>
        <option value="">{n.ok ? '-' : 'Choose…'}</option>
        {opts.map(o => <option key={o} value={o}>{o}{n.outdated && o === n.value ? '  (not an option)' : ''}</option>)}
      </select>
    )
  }

  const renderFilterCell = (key) => {
    if (key === 'closing_balance') {
      const f = parseAmountFilter(columnFilters.closing_balance)
      return (
        <input
          value={columnFilters.closing_balance || ''}
          onChange={e => setFilter('closing_balance', e.target.value)}
          placeholder=">1000, <500, 1-5000"
          title={AMOUNT_FILTER_HELP}
          className={`w-full h-7 border rounded px-1.5 text-[11px] text-right bg-white focus:outline-none focus:ring-1 ${f?.invalid ? 'border-red-400 focus:ring-red-400' : 'border-blue-100 focus:ring-blue-400'}`}
        />
      )
    }
    if (key === 'needs') {
      return (
        <select
          value={columnFilters.needs || ''}
          onChange={e => setFilter('needs', e.target.value)}
          className="w-full h-7 border border-blue-100 rounded px-1 text-[11px] bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
        >
          <option value="">All</option>
          <option value={NEEDS_ANY}>To fix (anything)</option>
          <option value={NEEDS_NONE}>✓ Complete</option>
          {needKinds.map(k => <option key={k} value={k}>Needs: {k}</option>)}
        </select>
      )
    }
    if (!TEXT_FILTERS.includes(key)) return null
    return (
      <input
        value={columnFilters[key] || ''}
        onChange={e => setFilter(key, e.target.value)}
        placeholder="Filter"
        className="w-full h-7 border border-blue-100 rounded px-1.5 text-[11px] bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
      />
    )
  }

  const renderMappingSelect = (row, level) => {
    if (level === 1) {
      // Mapping 1 gets the same "+ Custom line..." escape hatch as Mapping 2/3
      // did. A custom Level 1 finds no level_format row, so the override handler's
      // `alie=COALESCE($11, alie)` leaves the ledger's existing side untouched —
      // it appears under the new caption without dropping out of the BS/PL.
      const cur = row.mapping1_resultant
      const allOpts = (cur && !lfM1.includes(cur)) ? [cur, ...lfM1] : lfM1
      return (
        <select value={cur || ''}
          onChange={e => {
            const value = e.target.value
            if (value === CUSTOM_VALUE) {
              openCustomEditor('custom face head / Mapping 1', cur, clean => {
                updateLedgerLocal(row.id, {
                  mapping1_resultant: clean,
                  mapping2_resultant: null, mapping3_resultant: null,
                  level4_value: null, level5_value: null, level6_value: null, level7_value: null,
                })
                setDropdownSource(prev =>
                  prev.some(r => r.mapping1_resultant === clean)
                    ? prev
                    : [...prev, { mapping1_resultant: clean }]
                )
              })
              return
            }
            updateLedgerLocal(row.id, {
              mapping1_resultant: value,
              mapping2_resultant: null, mapping3_resultant: null,
              level4_value: null, level5_value: null, level6_value: null, level7_value: null,
            })
          }}
          className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs">
          <option value="">-</option>
          {allOpts.map(o => <option key={o} value={o}>{o}</option>)}
          <option value={CUSTOM_VALUE} className="font-bold text-blue-700">+ Custom line...</option>
        </select>
      )
    }
    if (level === 2) {
      const opts = (lfM2[row.mapping1_resultant] || [])
      const cur = row.mapping2_resultant
      const allOpts = (cur && !opts.includes(cur)) ? [cur, ...opts] : opts
      return (
        <select value={row.mapping2_resultant || ''}
          onChange={e => {
            let value = e.target.value
            if (value === CUSTOM_VALUE) {
              openCustomEditor('custom face line / Mapping 2', row.mapping2_resultant, clean => {
                updateLedgerLocal(row.id, {
                  mapping2_resultant: clean,
                  mapping3_resultant: null,
                  level4_value: null, level5_value: null, level6_value: null, level7_value: null,
                })
                setDropdownSource(prev =>
                  prev.some(r => r.mapping1_resultant === row.mapping1_resultant && r.mapping2_resultant === clean)
                    ? prev
                    : [...prev, { mapping1_resultant: row.mapping1_resultant, mapping2_resultant: clean }]
                )
              })
              return
            }
            updateLedgerLocal(row.id, {
              mapping2_resultant: value,
              mapping3_resultant: null,
              level4_value: null, level5_value: null, level6_value: null, level7_value: null,
            })
          }}
          disabled={!row.mapping1_resultant}
          className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs disabled:bg-gray-100">
          <option value="">-</option>
          {allOpts.map(o => <option key={o} value={o}>{o}</option>)}
          <option value={CUSTOM_VALUE} className="font-bold text-blue-700">+ Custom line...</option>
        </select>
      )
    }
    const opts = (lfM3[`${row.mapping1_resultant}||${row.mapping2_resultant}`] || [])
    const cur = row.mapping3_resultant
    const allOpts = (cur && !opts.includes(cur)) ? [cur, ...opts] : opts
    return (
      <select value={cur || ''}
        onChange={e => {
          let value = e.target.value
          if (value === CUSTOM_VALUE) {
            openCustomEditor('custom note line / Mapping 3', row.mapping3_resultant, clean => {
              updateLedgerLocal(row.id, {
                mapping3_resultant: clean,
                level4_value: null, level5_value: null, level6_value: null, level7_value: null,
              })
              setDropdownSource(prev =>
                prev.some(r => r.mapping1_resultant === row.mapping1_resultant && r.mapping2_resultant === row.mapping2_resultant && r.mapping3_resultant === clean)
                  ? prev
                  : [...prev, { mapping1_resultant: row.mapping1_resultant, mapping2_resultant: row.mapping2_resultant, mapping3_resultant: clean }]
              )
            })
            return
          }
          updateLedgerLocal(row.id, {
            mapping3_resultant: value || null,
            level4_value: null, level5_value: null, level6_value: null, level7_value: null,
          })
        }}
        disabled={!row.mapping2_resultant}
        className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs disabled:bg-gray-100">
        <option value="">-</option>
        {allOpts.map(o => <option key={o} value={o}>{o}</option>)}
        <option value={CUSTOM_VALUE} className="font-bold text-blue-700">+ Custom note line...</option>
      </select>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <LockBanner entity={entity} activeTB={targetTB} onUnlocked={refresh} />
      {scopeFilter && (
        <div className="flex items-center gap-3 px-5 py-1.5 bg-red-50 border-b border-red-200 text-xs text-red-800 shrink-0">
          <span>Scoped to: <strong>{scopeFilter.title || 'selected category'}</strong> — only the ledgers behind it are shown.</span>
          {(scopeFilter.mappedIds?.length || scopeFilter.pyMappedIds?.length) ? (
            <span className="ml-3 inline-flex rounded border border-red-300 overflow-hidden bg-white text-xs">
              <button onClick={() => setCategorisePY(false)}
                className={`px-2 py-0.5 ${!categorisePY ? 'bg-blue-700 text-white font-medium' : 'text-gray-700 hover:bg-gray-50'}`}>
                Current Year ({scopeFilter.mappedIds?.length || 0})
              </button>
              <button onClick={() => prevTB?.id && setCategorisePY(true)} disabled={!prevTB?.id}
                title={prevTB?.id ? `Previous Year Trial Balance (${prevTB.period || ''})` : 'Select a Previous Year Trial Balance first'}
                className={`px-2 py-0.5 border-l border-red-300 disabled:opacity-40 ${categorisePY ? 'bg-amber-600 text-white font-medium' : 'text-gray-700 hover:bg-gray-50'}`}>
                Previous Year ({scopeFilter.pyMappedIds?.length || 0})
              </button>
            </span>
          ) : null}
          {scopeFilter.focusLevel ? (
            <span className="ml-3 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 text-xs">
              Fix is about Level {scopeFilter.focusLevel} — that column is highlighted
            </span>
          ) : null}
          <button onClick={() => setScopeFilter(null)}
            className="ml-auto px-2 py-0.5 rounded border border-red-300 bg-white hover:bg-red-100 text-red-700 font-medium">
            Clear scope — show default view
          </button>
        </div>
      )}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-blue-100 shrink-0 bg-white flex-wrap">
        <div>
          <h2 className="font-bold text-blue-900 text-sm">
            Rectification / Recategorisation - Fix Unmapped Ledgers
            {categorisePY && <span className="ml-2 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-semibold align-middle">PREVIOUS YEAR</span>}
          </h2>
          <p className="text-xs text-gray-500">
            {categorisePY
              ? `Categorising the comparative Previous Year Trial Balance (${prevTB?.period || ''}) — an un-mapped ledger here is exactly why its figure comes out blank in Notes/Annexures.`
              : 'Filter by books hierarchy, select similar ledgers, and apply Schedule III mappings in bulk.'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded border border-gray-300 overflow-hidden text-xs">
            <button
              onClick={() => setCategorisePY(false)}
              className={`px-3 py-1.5 transition ${!categorisePY ? 'bg-blue-700 text-white font-medium' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >Current Year</button>
            <button
              onClick={() => prevTB?.id && setCategorisePY(true)}
              disabled={!prevTB?.id}
              title={!prevTB?.id ? 'Select a Previous Year Trial Balance first' : 'Categorise the comparative Previous Year Trial Balance'}
              className={`px-3 py-1.5 border-l border-gray-300 transition disabled:opacity-40 disabled:cursor-not-allowed ${categorisePY ? 'bg-amber-600 text-white font-medium' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >Previous Year</button>
          </div>
          <PYTBSelector entity={entity} currentTBId={activeTB?.id} prevTB={prevTB} onChange={onPrevTBChange} />
          {categorisePY && (
            <button
              onClick={handleRunAutoMap}
              disabled={runningAutoMap || !tbId}
              className="px-3 py-1.5 text-xs rounded bg-amber-600 text-white font-medium hover:bg-amber-700 disabled:opacity-40 transition"
              title="Bulk-classify this Previous Year TB's ledgers, same as Mapped TB's Run Auto-Mapping does for Current Year"
            >
              {runningAutoMap ? 'Running…' : '▶ Run Auto-Mapping (PY)'}
            </button>
          )}
        </div>
        <div className="ml-auto flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            <input type="checkbox" checked={showAll} onChange={e => { setShowAll(e.target.checked); if (e.target.checked) setScopeFilter(null) }} className="rounded border-gray-300" />
            Show all mapped rows
          </label>
          <label className="flex items-center gap-1.5 text-xs text-gray-600" title="Ledgers with zero balance in both Current Year and Previous Year are hidden by default">
            <input type="checkbox" checked={showZero} onChange={e => setShowZero(e.target.checked)} className="rounded border-gray-300" />
            Include zero-balance ledgers
          </label>
          <button onClick={refresh}
            className="px-3 py-1.5 text-xs border border-gray-300 text-gray-700 rounded hover:bg-gray-50 transition">
            Refresh
          </button>
          <button
            onClick={async () => {
              if (!tbId) return
              const d = await window.api?.exceptionsDiagnostics(tbId)
              setDiagnostics(d)
            }}
            className="px-3 py-1.5 text-xs border border-amber-400 text-amber-700 rounded hover:bg-amber-50 transition">
            Diagnose
          </button>
          <input type="text" placeholder="Search all visible fields..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-xs w-56 focus:ring-2 focus:ring-blue-400 focus:outline-none" />
          <button onClick={clearFilters} className="px-2 py-1.5 text-xs border border-gray-300 rounded text-gray-600 hover:bg-gray-50">
            Clear filters
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {diagnostics && (
          <div className="mb-3 bg-amber-50 border border-amber-200 rounded p-3 text-xs font-mono">
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-amber-900">Diagnostic snapshot</span>
              <button onClick={() => setDiagnostics(null)} className="text-amber-700 hover:text-amber-900">close</button>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-2">
              <pre className="bg-white border border-amber-100 rounded p-2 text-[11px] whitespace-pre">{JSON.stringify(diagnostics.counts, null, 2)}</pre>
              <pre className="bg-white border border-amber-100 rounded p-2 text-[11px] whitespace-pre">{JSON.stringify(diagnostics.byStatus, null, 2)}</pre>
              <pre className="bg-white border border-amber-100 rounded p-2 text-[11px] whitespace-pre overflow-auto" style={{ maxHeight: '220px' }}>{JSON.stringify(diagnostics.sample, null, 2)}</pre>
            </div>
          </div>
        )}
        {loading && <LoadingNote className="py-4" />}
        {error && <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded px-3 py-2 mb-3">{error}</div>}

        {!loading && ledgers.length === 0 && (scopeFilter ? (
          // Opened by a Fix, and nothing to show: never claim "every ledger is categorised" —
          // that is exactly what hid the problem.
          <div className="text-amber-800 bg-amber-50 border border-amber-200 rounded px-4 py-5 text-sm">
            <p className="font-semibold mb-1">No ledgers to open for “{scopeFilter.title || 'this Fix'}”{categorisePY ? ' in the Previous Year Trial Balance' : ''}.</p>
            <p className="text-xs mb-3">
              The line is flagged, but no ledger of {categorisePY ? 'the Previous Year' : 'this year’s'} Trial Balance is behind it — for instance a row built from a
              depreciation schedule (fix it on the Dep tab), or ledgers of the {categorisePY ? 'current' : 'previous'} year.
            </p>
            <div className="flex gap-2">
              {prevTB?.id && (
                <button onClick={() => setCategorisePY(v => !v)} className="px-2 py-1 text-xs rounded border border-amber-400 bg-white hover:bg-amber-100">
                  Look in the {categorisePY ? 'Current' : 'Previous'} Year instead
                </button>
              )}
              <button onClick={() => setScopeFilter(null)} className="px-2 py-1 text-xs rounded border border-amber-400 bg-white hover:bg-amber-100">
                Clear scope — show all exceptions
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center text-green-700 bg-green-50 border border-green-200 rounded px-4 py-6 text-sm">
            No exceptions - every ledger is fully categorised.
          </div>
        ))}

        {!loading && ledgers.length > 0 && (
          <>
            <div className="bg-blue-50 border border-blue-200 rounded p-3 mb-3">
              <div className="flex items-center justify-between mb-2 gap-2">
                <span className="text-xs font-semibold text-blue-900">
                  Bulk apply to <span className="font-bold">{selected.size}</span> selected ledger{selected.size !== 1 ? 's' : ''}
                </span>
                <span className="text-[10px] text-blue-600">
                  Filter the table, tick matching book groups/subgroups, then apply mapping.
                </span>
              </div>
              <div className="grid gap-2 text-xs" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
                <div>
                  <label className="block text-[10px] text-gray-500 mb-0.5">Mapping 1</label>
                  <select value={bulkM1} onChange={e => {
                    const value = e.target.value
                    if (value === CUSTOM_VALUE) {
                      openCustomEditor('custom face head / Mapping 1', bulkM1, clean => {
                        setBulkM1(clean); setBulkM2(''); setBulkM3(''); resetBulkNature()
                        setDropdownSource(prev =>
                          prev.some(r => r.mapping1_resultant === clean)
                            ? prev
                            : [...prev, { mapping1_resultant: clean }]
                        )
                      })
                      return
                    }
                    setBulkM1(value); setBulkM2(''); setBulkM3(''); resetBulkNature()
                  }}
                    className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs bg-white">
                    <option value="">-</option>
                    {(bulkM1 && !lfM1.includes(bulkM1) ? [bulkM1, ...lfM1] : lfM1).map(o => <option key={o} value={o}>{o}</option>)}
                    <option value={CUSTOM_VALUE} className="font-bold text-blue-700">+ Custom line...</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-gray-500 mb-0.5">Mapping 2</label>
                  <select value={bulkM2} onChange={e => {
                    let value = e.target.value
                    if (value === CUSTOM_VALUE) {
                      openCustomEditor('custom face line / Mapping 2', bulkM2, clean => {
                        setBulkM2(clean); setBulkM3(''); resetBulkNature()
                        setDropdownSource(prev =>
                          !bulkM1 || prev.some(r => r.mapping1_resultant === bulkM1 && r.mapping2_resultant === clean)
                            ? prev
                            : [...prev, { mapping1_resultant: bulkM1, mapping2_resultant: clean }]
                        )
                      })
                      return
                    }
                    setBulkM2(value); setBulkM3(''); resetBulkNature()
                  }}
                    disabled={!bulkM1}
                    className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs bg-white disabled:bg-gray-100">
                    <option value="">-</option>
                    {[
                      ...(bulkM2 && !(lfM2[bulkM1] || []).includes(bulkM2) ? [bulkM2] : []),
                      ...(lfM2[bulkM1] || [])
                    ].map(o => <option key={o} value={o}>{o}</option>)}
                    <option value={CUSTOM_VALUE} className="font-bold text-blue-700">+ Custom line...</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-gray-500 mb-0.5">Mapping 3</label>
                  <select value={bulkM3} onChange={e => {
                    let value = e.target.value
                    if (value === CUSTOM_VALUE) {
                      openCustomEditor('custom note line / Mapping 3', bulkM3, clean => {
                        setBulkM3(clean); resetBulkNature()
                        setDropdownSource(prev =>
                          !bulkM1 || !bulkM2 || prev.some(r => r.mapping1_resultant === bulkM1 && r.mapping2_resultant === bulkM2 && r.mapping3_resultant === clean)
                            ? prev
                            : [...prev, { mapping1_resultant: bulkM1, mapping2_resultant: bulkM2, mapping3_resultant: clean }]
                        )
                      })
                      return
                    }
                    setBulkM3(value); resetBulkNature()
                  }}
                    disabled={!bulkM2}
                    className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs bg-white disabled:bg-gray-100">
                    <option value="">-</option>
                    {[
                      ...(bulkM3 && !(lfM3[`${bulkM1}||${bulkM2}`] || []).includes(bulkM3) ? [bulkM3] : []),
                      ...(lfM3[`${bulkM1}||${bulkM2}`] || [])
                    ].map(o => <option key={o} value={o}>{o}</option>)}
                    <option value={CUSTOM_VALUE} className="font-bold text-blue-700">+ Custom note line...</option>
                  </select>
                </div>
                {bulkNatures.map(n => (
                  <div key={n.level}>
                    <label className="block text-[10px] text-gray-500 mb-0.5">
                      Level {n.level} {n.level === 4 ? '(Sub-head)' : n.level === 7 ? '(Specify nature)' : '(Nature)'}
                    </label>
                    {n.freeText ? (
                      <input type="text" value={bulkNatureValue[n.level]} onChange={e => setBulkNature(n.level, e.target.value)}
                        placeholder="Specify nature"
                        className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs bg-white" />
                    ) : !n.required ? (
                      <span className="text-gray-500" title="Fixed by the Level Format">{n.fixed}</span>
                    ) : (
                      <select value={bulkNatureValue[n.level]} onChange={e => setBulkNature(n.level, e.target.value)}
                        className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs bg-white">
                        <option value="">-</option>
                        {n.options.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    )}
                  </div>
                ))}
                {/* a custom note line has no Level Format row — Level 5 stays a free-text field for it, as before */}
                {!bulkNatures.some(n => n.level === 5) && (
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-0.5">Level 5 (Nature)</label>
                    <input type="text" value={bulkL5} onChange={e => setBulkL5(e.target.value)}
                      disabled={!bulkM3}
                      className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs bg-white disabled:bg-gray-100" />
                  </div>
                )}
                <div className="flex items-end">
                  <button onClick={applyBulk} disabled={saving || selected.size === 0 || !bulkM1}
                    className="w-full py-1 rounded text-white text-xs font-medium transition disabled:opacity-40"
                    style={{ background: 'var(--color-primary)' }}>
                    {saving ? 'Applying...' : `Apply to ${selected.size}`}
                  </button>
                </div>
              </div>
              {levelOnlyPlan.length > 0 && (
                <div className="mt-3 pt-2 border-t border-blue-200">
                  <div className="text-[10px] text-blue-700 mb-1.5">
                    <span className="font-semibold">Level 4–7 only</span> — sets just that level on the ticked ledgers that need it.
                    Their Mapping 1 / 2 / 3 and other levels stay as they are, so ledgers under different lines can be fixed together.
                  </div>
                  <div className="grid gap-2 text-xs" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                    {levelOnlyPlan.map(p => (
                      <div key={p.level} className="bg-white border border-blue-100 rounded p-2">
                        <label className="block text-[10px] text-gray-500 mb-0.5">
                          Level {p.level} {p.level === 4 ? '(Sub-head)' : p.level === 7 ? '(Specify nature)' : '(Nature)'} — {p.ids.length} ledger{p.ids.length !== 1 ? 's' : ''}
                          {p.missing > 0 && <span className="text-red-600"> ({p.missing} not set)</span>}
                        </label>
                        <div className="flex gap-1">
                          {p.freeText ? (
                            <input type="text" value={levelOnly[p.level] || ''} placeholder="Specify nature"
                              onChange={ev => setLevelOnly(prev => ({ ...prev, [p.level]: ev.target.value }))}
                              className="flex-1 min-w-0 border border-gray-300 rounded px-1 py-0.5 text-xs bg-white" />
                          ) : p.options.length ? (
                            <select value={levelOnly[p.level] || ''} onChange={ev => setLevelOnly(prev => ({ ...prev, [p.level]: ev.target.value }))}
                              className="flex-1 min-w-0 border border-gray-300 rounded px-1 py-0.5 text-xs bg-white">
                              <option value="">Choose…</option>
                              {p.options.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                          ) : (
                            <span className="flex-1 text-[10px] text-amber-700">No option is common to all of them — tick ledgers under similar lines.</span>
                          )}
                          <button onClick={() => applyLevelOnly(p)} disabled={saving || !(levelOnly[p.level] || '').trim()}
                            className="px-2 py-0.5 rounded text-white text-xs font-medium transition disabled:opacity-40 whitespace-nowrap"
                            style={{ background: 'var(--color-primary)' }}>
                            Set on {p.ids.length}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
              <div>
                Showing <span className="font-bold">{visibleLedgers.length}</span> of {ledgers.length - (showHidden ? 0 : hiddenComplete.size)} rows.
                {hiddenComplete.size > 0 && (
                  <span className="ml-2 text-gray-500">
                    {hiddenComplete.size} listed ledger{hiddenComplete.size !== 1 ? 's are' : ' is'} already complete and {showHidden ? 'shown' : 'held back'} —{' '}
                    <button onClick={() => setShowHidden(v => !v)} className="underline text-blue-700">{showHidden ? 'hide them' : 'show them'}</button>
                  </span>
                )}
                {needFixCount > 0
                  ? <span className="ml-2 font-semibold text-red-700">{needFixCount} still need fixing (see “To fix”)</span>
                  : <span className="ml-2 font-semibold text-green-700">✓ every ledger shown is complete</span>}
                <span className="ml-2 font-semibold text-blue-700">{selectedVisibleCount}</span> selected in current view.
                {dirtyIds.size > 0 && (
                  <button onClick={saveAllChanges} disabled={saving}
                    title="Persist every row you've edited but not yet saved, in one go"
                    className="ml-3 px-2 py-1 rounded text-white text-[11px] font-semibold transition disabled:opacity-40"
                    style={{ background: 'var(--color-primary)' }}>
                    {saving ? 'Saving...' : `Save All Changes (${dirtyIds.size})`}
                  </button>
                )}
              </div>
              <div className="text-[10px] text-gray-400">
                Click a ledger name then press <kbd className="px-1 py-0.5 bg-gray-100 border border-gray-300 rounded text-[10px]">Ctrl+G</kbd> to view full hierarchy.
              </div>
            </div>

            {visibleLedgers.length > PAGE_SIZES[0] && (
              <div className="flex items-center flex-wrap gap-2 text-xs text-gray-600 mb-2" data-testid="rect-pager">
                <button onClick={() => setPage(curPage - 1)} disabled={curPage === 0}
                  className="px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40">◀ Previous</button>
                <span>
                  Rows <span className="font-bold">{(pageStart + 1).toLocaleString('en-IN')}–{Math.min(pageStart + pageSize, visibleLedgers.length).toLocaleString('en-IN')}</span> of{' '}
                  <span className="font-bold">{visibleLedgers.length.toLocaleString('en-IN')}</span> · page {curPage + 1} of {pageCount.toLocaleString('en-IN')}
                </span>
                <button onClick={() => setPage(curPage + 1)} disabled={curPage >= pageCount - 1}
                  className="px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40">Next ▶</button>
                <label className="flex items-center gap-1 ml-2">
                  Rows per page
                  <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(0) }}
                    className="border border-gray-300 rounded px-1 py-0.5 bg-white">
                    {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <span className="text-gray-400">The tick box in the heading selects all {visibleLedgers.length.toLocaleString('en-IN')} rows, not only this page.</span>
              </div>
            )}

            <div className="border border-gray-200 rounded overflow-auto max-h-[calc(100vh-360px)] bg-white">
              <table className="text-xs table-fixed" style={{ width: totalWidth, minWidth: totalWidth }}>
                <colgroup>
                  {columns.map(col => <col key={col.key} style={{ width: col.width }} />)}
                </colgroup>
                <thead className="bg-blue-50 border-b border-blue-200 sticky top-0 z-20">
                  <tr>
                    {columns.map(col => (
                      <th
                        key={col.key}
                        style={stickyStyle(col.key, true)}
                        className={`px-2 py-1.5 font-semibold text-blue-900 border-r border-blue-100 bg-blue-50 ${col.key === 'closing_balance' ? 'text-right' : col.key === 'select' || col.key === 'save' ? 'text-center' : 'text-left'} ${col.level && Number(scopeFilter?.focusLevel) === col.level ? 'ring-2 ring-inset ring-amber-400 !bg-amber-100' : ''} ${col.key === 'needs' ? 'text-red-800' : ''}`}
                      >
                        {col.key === 'select' ? (
                          <input type="checkbox" checked={allChecked} ref={el => { if (el) el.indeterminate = someChecked }}
                            onChange={toggleAll} className="rounded border-gray-300" />
                        ) : col.key === 'closing_balance' ? (categorisePY ? 'PY' : 'CY') : col.label}
                      </th>
                    ))}
                  </tr>
                  <tr className="bg-white">
                    {columns.map(col => (
                      <th
                        key={`${col.key}-filter`}
                        style={stickyStyle(col.key, true)}
                        className="px-2 py-1 border-r border-blue-100 border-t border-blue-100 bg-white"
                      >
                        {renderFilterCell(col.key)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pagedLedgers.map(row => {
                    // What this ledger still lacks, from its own Level Format row(s) — found by captions, or,
                    // when those lead nowhere (old wording, blank Level 3), by its own level_format_id:
                    // Mapping 2 / 3 and every Level 4-7 classification it must be given (utils/fixTargets.js).
                    const needs = ledgerNeeds(levelFormat, row)
                    const natureOf = Object.fromEntries(natureLevelsFor(levelFormat, row).map(n => [n.level, n]))
                    const isChecked = selected.has(row.id)
                    const isFocused = focusedRow?.id === row.id
                    return (
                      <tr key={row.id} className={`border-b border-gray-100 ${isChecked ? 'bg-blue-50/70' : needs.length ? 'bg-red-50/40 hover:bg-red-50' : 'hover:bg-blue-50/30'}`}>
                        <td
                          style={stickyStyle('select')}
                          className={`px-2 py-1 text-center border-r border-gray-100 ${stickyBg('select', isChecked)}`}
                        >
                          <input type="checkbox" checked={isChecked} onChange={() => toggleRow(row.id)}
                            className="rounded border-gray-300" />
                        </td>
                        <td
                          style={stickyStyle('name')}
                          className={`px-2 py-1 border-r border-gray-100 font-medium truncate cursor-pointer select-none
                            ${isFocused ? 'text-blue-700 underline decoration-dotted' : 'text-gray-800'}
                            ${stickyBg('name', isChecked)}`}
                          title={`${row.name || ''} — click then Ctrl+G for hierarchy`}
                          onClick={() => setFocusedRow(row)}
                        >
                          {row.name}
                          {row.ledger_code && <span className="text-gray-400 text-[10px] ml-1">({row.ledger_code})</span>}
                        </td>
                        <td
                          style={stickyStyle('closing_balance')}
                          className={`px-2 py-1 text-right font-mono text-gray-700 border-r border-gray-100 ${stickyBg('closing_balance', isChecked)}`}
                        >
                          {fmtINR(rowAmt(row, 'closing_balance'))}
                        </td>
                        <td
                          style={stickyStyle('save')}
                          className={`px-2 py-1 text-center border-r border-gray-100 shadow-[2px_0_0_rgba(191,219,254,0.75)] ${stickyBg('save', isChecked)}`}
                        >
                          <button onClick={() => saveOne(row)}
                            title={dirtyIds.has(row.id) ? 'Unsaved changes' : undefined}
                            className={`px-2 py-0.5 text-[10px] rounded text-white font-medium transition ${dirtyIds.has(row.id) ? 'ring-2 ring-amber-400' : ''}`}
                            style={{ background: 'var(--color-primary)' }}>Save{dirtyIds.has(row.id) ? ' ●' : ''}</button>
                        </td>
                        <td className="px-2 py-1 border-r border-gray-100">
                          {needs.length === 0
                            ? <span className="text-green-700 text-[11px]">✓ complete</span>
                            : (
                              <div className="flex flex-wrap gap-1">
                                {needs.map(n => (
                                  <span key={n.what} title={n.hint || ''}
                                    className="px-1.5 py-0.5 rounded bg-red-100 text-red-800 border border-red-200 text-[10px] font-medium">
                                    {n.what}{n.hint ? ` · ${n.hint}` : ''}
                                  </span>
                                ))}
                              </div>
                            )}
                        </td>
                        <td className="px-2 py-1 border-r border-gray-100">{renderMappingSelect(row, 1)}</td>
                        <td className="px-2 py-1 border-r border-gray-100">{renderMappingSelect(row, 2)}</td>
                        <td className="px-2 py-1 border-r border-gray-100">{renderMappingSelect(row, 3)}</td>
                        {natureLevels.map(level => (
                          <td key={level} className="px-2 py-1 border-r border-gray-100">{renderNatureCell(row, natureOf[level])}</td>
                        ))}
                        <td className="px-2 py-1 border-r border-gray-100 text-gray-500 truncate" title={row.status || ''}>{row.status || '-'}</td>
                        <td className="px-2 py-1 border-r border-gray-100 text-gray-600 truncate" title={getBookAlie(row)}>{getBookAlie(row) || '-'}</td>
                        <td className="px-2 py-1 border-r border-gray-100 text-gray-600 truncate" title={row.parent || ''}>{row.parent || '-'}</td>
                        <td className="px-2 py-1 border-r border-gray-100 text-gray-600 truncate" title={row.group_parent || ''}>{row.group_parent || '-'}</td>
                        <td className="px-2 py-1 border-r border-gray-100 text-gray-600 truncate" title={row.group_parent_1 || ''}>{row.group_parent_1 || '-'}</td>
                        <td className="px-2 py-1 border-r border-gray-100 text-gray-600 truncate" title={row.group_parent_2 || ''}>{row.group_parent_2 || '-'}</td>
                        <td className="px-2 py-1 border-r border-gray-100 text-gray-600 truncate" title={row.group_parent_3 || ''}>{row.group_parent_3 || '-'}</td>
                      </tr>
                    )
                  })}
                  {visibleLedgers.length === 0 && (
                    <tr><td colSpan={columns.length} className="text-center text-gray-400 py-4">{hiddenComplete.size > 0 && !showHidden && visibleLedgers.length === 0 && !search.trim() ? 'Every ledger in this list is already complete.' : 'No rows match the current filters.'}</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="text-[10px] text-gray-400 mt-2">
              Ctrl+Z undoes the last categorisation action; Ctrl+Y redoes it.
            </div>
          </>
        )}
      </div>

      {!loading && ledgers.length > 0 && selected.size > 0 && (
        <div className="shrink-0 flex items-center gap-4 px-5 py-2 border-t border-blue-200 bg-blue-50 text-xs">
          <span className="font-semibold text-blue-900">
            {selected.size} ledger{selected.size !== 1 ? 's' : ''} selected
          </span>
          <span className="text-gray-600">
            Total CY: <span className="font-mono font-semibold text-blue-900">{fmtINR(selectedTotal)}</span>
          </span>
        </div>
      )}

      {showHierarchy && focusedRow && (
        <HierarchyPopup
          row={focusedRow}
          onClose={() => setShowHierarchy(false)}
        />
      )}

      {customEditor && (
        <div className="fixed inset-0 bg-black/35 flex items-center justify-center z-[9999]" onMouseDown={closeCustomEditor}>
          <div className="bg-white rounded border border-blue-200 shadow-xl w-[420px] p-4" onMouseDown={e => e.stopPropagation()}>
            <div className="text-sm font-bold text-blue-900 mb-1">Create {customEditor.label}</div>
            <div className="text-xs text-gray-500 mb-3">
              This will be saved as a user override for the selected ledger(s), not added to Mapping_v2.
            </div>
            <input
              autoFocus
              value={customEditor.value}
              onChange={e => setCustomEditor(prev => ({ ...prev, value: e.target.value }))}
              onKeyDown={e => {
                if (e.key === 'Enter') submitCustomEditor()
                if (e.key === 'Escape') closeCustomEditor()
              }}
              placeholder="Example: GST Payable"
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={closeCustomEditor}
                className="px-3 py-1.5 text-xs border border-gray-300 rounded text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={submitCustomEditor} disabled={!customEditor.value.trim()}
                className="px-3 py-1.5 text-xs rounded text-white font-medium disabled:opacity-40"
                style={{ background: 'var(--color-primary)' }}>
                Use Custom Line
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
