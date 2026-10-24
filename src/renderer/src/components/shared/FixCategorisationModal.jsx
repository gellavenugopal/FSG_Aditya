import React, { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { fmtINR, parseSlashOptions, displayAmt } from '../../hooks/useFinancials'
import { pushAction, snapshotMapping } from '../../utils/undoManager'
import HierarchyPopup from './HierarchyPopup'

const CUSTOM_VALUE = '__custom__'

// Column order/labels/widths mirror Exceptions/index.jsx's Categorisation
// screen exactly (same table, just scoped to `filter`) — Save sits right
// after the CY figure, not buried after the mapping columns.
const COLUMNS = [
  { key: 'select',             label: '',             width: 36,  filterable: false },
  { key: 'name',               label: 'Ledger',       width: 260, filterable: true  },
  { key: 'closing_balance',    label: 'CY',           width: 120, filterable: false },
  { key: 'save',               label: 'Save',         width: 80,  filterable: false },
  { key: 'mapping1_resultant', label: 'Mapping 1',    width: 210, filterable: true  },
  { key: 'mapping2_resultant', label: 'Mapping 2',    width: 210, filterable: true  },
  { key: 'mapping3_resultant', label: 'Mapping 3',    width: 210, filterable: true  },
  { key: 'level5_value',       label: 'L5 Nature',    width: 170, filterable: false },
  { key: 'status',             label: 'Status',       width: 120, filterable: true  },
  { key: 'book_alie',          label: 'Books ALIE',   width: 130, filterable: true  },
  { key: 'parent',             label: 'Books Parent', width: 180, filterable: true  },
  { key: 'group_parent',       label: 'Group',        width: 180, filterable: true  },
  { key: 'group_parent_1',     label: 'Subgroup 1',   width: 180, filterable: true  },
  { key: 'group_parent_2',     label: 'Subgroup 2',   width: 180, filterable: true  },
  { key: 'group_parent_3',     label: 'Subgroup 3',   width: 180, filterable: true  },
]

const STICKY_LEFT = { select: 0, name: 36, closing_balance: 296, save: 416 }
const totalWidth = COLUMNS.reduce((s, c) => s + c.width, 0)

function getBookAlie(row) {
  return row.trial_balance_type || row.alie || ''
}

function textValue(row, key) {
  if (key === 'book_alie') return getBookAlie(row)
  return row[key] ?? ''
}

export default function FixCategorisationModal({
  tbId, entity, activeRsId, filter, title, onClose, onSaved,
}) {
  const [ledgers, setLedgers]             = useState([])
  const [dropdownSource, setDropdownSource] = useState([])
  const [levelFormat, setLevelFormat]     = useState([])
  const [loading, setLoading]             = useState(true)
  const [saving, setSaving]               = useState(false)
  const [error, setError]                 = useState('')
  const [originalById, setOriginalById]   = useState({})
  const [selected, setSelected]           = useState(new Set())
  const [columnFilters, setColumnFilters] = useState({})
  const [search, setSearch]               = useState('')
  const [customEditor, setCustomEditor]   = useState(null)
  const [focusedRow, setFocusedRow]       = useState(null)
  const [showHierarchy, setShowHierarchy] = useState(false)

  const contextM1 = filter?.mapping1_resultant && !String(filter.mapping1_resultant).startsWith('Uncategorised')
    ? filter.mapping1_resultant : ''
  const contextM2 = filter?.mapping2_resultant && !String(filter.mapping2_resultant).startsWith('Uncategorised')
    ? filter.mapping2_resultant : ''

  const [bulkM1, setBulkM1] = useState(contextM1)
  const [bulkM2, setBulkM2] = useState(contextM2)
  const [bulkM3, setBulkM3] = useState('')
  const [bulkL5, setBulkL5] = useState('')

  useEffect(() => {
    if (!tbId) return
    setLoading(true)
    Promise.all([
      window.api?.findMappedByFilter(tbId, filter) || [],
      entity?.constitution
        ? (window.api?.getLevelFormat(entity.constitution, activeRsId || null) || [])
        : [],
      // Load all mapped rows for dropdown custom-value population
      window.api?.findMappedByFilter(tbId, {}) || [],
    ]).then(([rows, lf, allRows]) => {
      setLedgers(rows || [])
      setLevelFormat(lf || [])
      setDropdownSource(allRows || [])
      setSelected(new Set())
      const snaps = {}
      for (const r of (rows || [])) snaps[r.id] = snapshotMapping(r)
      setOriginalById(snaps)
    }).catch(e => setError(e?.message || 'Failed to load')).finally(() => setLoading(false))
  }, [tbId, JSON.stringify(filter)])

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
    setBulkM1(prev => prev === nextM1 ? prev : nextM1)
    setBulkM2(prev => prev === nextM2 ? prev : nextM2)
    setBulkM3(prev => prev === nextM3 ? prev : nextM3)
    setBulkL5(prev => prev === nextL5 ? prev : nextL5)
  }, [selected, ledgers])

  // ── LevelFormat lookup maps (merged with custom values from existing TB data) ──
  const lfM1 = useMemo(() => {
    const set = new Set()
    for (const r of levelFormat) {
      if (!r.level1) continue
      const opts = parseSlashOptions(r.level1)
      if (opts) opts.forEach(o => set.add(o)); else set.add(r.level1)
    }
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
    // Add custom M2 values from existing TB data
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
    // Add custom M3 values from existing TB data
    for (const r of dropdownSource) {
      if (!r.mapping1_resultant || !r.mapping2_resultant || !r.mapping3_resultant) continue
      const key = `${r.mapping1_resultant}||${r.mapping2_resultant}`
      if (!m[key]) m[key] = new Set()
      m[key].add(r.mapping3_resultant)
    }
    return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, [...v].sort((a, b) => a.localeCompare(b))]))
  }, [levelFormat, dropdownSource])

  const findLfRow = (m1, m2, m3) => {
    if (!m1 || !m2) return null
    const strip = s => (s || '').replace(/\s*\(specify nature\)/gi, '').trim()
    return levelFormat.find(r =>
      strip(r.level1) === strip(m1) &&
      strip(r.level2) === strip(m2) &&
      (!m3 || strip(r.level3) === strip(m3))
    )
  }

  const bulkLfRow = useMemo(() => findLfRow(bulkM1, bulkM2, bulkM3), [bulkM1, bulkM2, bulkM3, levelFormat])
  const bulkL5Opts = bulkLfRow?.level5 ? parseSlashOptions(bulkLfRow.level5) : null

  // ── Filtered rows ─────────────────────────────────────────────────────────
  const visibleLedgers = useMemo(() => {
    const q = search.trim().toLowerCase()
    return ledgers.filter(r => {
      if (q) {
        const hay = [
          r.name, r.ledger_code, getBookAlie(r), r.parent,
          r.group_parent, r.group_parent_1, r.group_parent_2, r.group_parent_3,
          r.mapping1_resultant, r.mapping2_resultant, r.mapping3_resultant, r.status,
        ].join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      for (const col of COLUMNS) {
        if (!col.filterable) continue
        const fv = (columnFilters[col.key] || '').trim().toLowerCase()
        if (!fv) continue
        if (!String(textValue(r, col.key)).toLowerCase().includes(fv)) return false
      }
      return true
    })
  }, [ledgers, search, columnFilters])

  const selectedVisibleCount = visibleLedgers.filter(r => selected.has(r.id)).length
  const allChecked = visibleLedgers.length > 0 && selectedVisibleCount === visibleLedgers.length
  const someChecked = selectedVisibleCount > 0 && !allChecked

  const toggleAll = () => {
    setSelected(prev => {
      const next = new Set(prev)
      if (allChecked) visibleLedgers.forEach(r => next.delete(r.id))
      else visibleLedgers.forEach(r => next.add(r.id))
      return next
    })
  }
  const toggleRow = id => setSelected(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  const stickyStyle = (key, isHeader = false) => {
    if (!(key in STICKY_LEFT)) return undefined
    return { position: 'sticky', left: STICKY_LEFT[key], zIndex: isHeader ? 35 : 15 }
  }
  const stickyBg = (key, checked) => (key in STICKY_LEFT) ? (checked ? 'bg-blue-50' : 'bg-white') : ''

  const clearFilters = () => { setSearch(''); setColumnFilters({}) }

  // ── Custom editor ─────────────────────────────────────────────────────────
  const openCustomEditor = (label, current, onSubmit) => setCustomEditor({ label, value: current || '', onSubmit })
  const closeCustomEditor = () => setCustomEditor(null)
  const submitCustomEditor = () => {
    const clean = (customEditor?.value || '').trim()
    if (!clean) return
    customEditor.onSubmit(clean)
    setCustomEditor(null)
  }

  // ── Save helpers ──────────────────────────────────────────────────────────
  const saveRow = async row => {
    const lfRow = findLfRow(row.mapping1_resultant, row.mapping2_resultant, row.mapping3_resultant)
    await window.api?.overrideRow(row.id, {
      mapping1_resultant: row.mapping1_resultant || null,
      mapping2_resultant: row.mapping2_resultant || null,
      mapping3_resultant: row.mapping3_resultant || null,
      level_format_id:    lfRow?.id || null,
      level4_value:       row.level4_value || null,
      level5_value:       row.level5_value || null,
      level6_value:       row.level6_value || null,
      level7_value:       row.level7_value || null,
      override_note:      row.override_note || null,
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
        onSaved?.()
      } catch (e) { setError(e?.message || 'Mirror-save failed') }
    }
  }

  // Custom-line entry ("+ Custom line...") is a deliberate one-off action —
  // unlike picking from the dropdown (which the CA might adjust a few times
  // before clicking the row's own Save button), it must commit immediately.
  // updateLedgerLocal() only persists when the row is part of a multi-select
  // mirror action; for a single row it only updates local grid state, so a
  // typed custom value would appear to "take" but silently never reach the
  // DB until the CA also clicked Save. This saves it explicitly right away.
  const updateLedgerAndSave = async (id, patch) => {
    const isChecked = selected.has(id)
    const shouldMirror = isChecked && selected.size > 1
    await updateLedgerLocal(id, patch)
    if (shouldMirror) return  // already persisted by the mirror path above
    const row = ledgers.find(r => r.id === id)
    const merged = { ...(row || {}), ...patch }
    try {
      await saveRow(merged)
      pushAction({
        label: `Custom line (${merged.name || id})`,
        changes: [{ id, before: originalById[id] || snapshotMapping(row || merged), after: snapshotMapping(merged) }],
      })
      onSaved?.()
    } catch (e) { setError(e?.message || 'Save failed') }
  }

  const saveOne = async row => {
    setError('')
    try {
      await saveRow(row)
      pushAction({
        label: `Save row (${row.name})`,
        changes: [{ id: row.id, before: originalById[row.id] || snapshotMapping(row), after: snapshotMapping(row) }],
      })
      onSaved?.()
    } catch (e) { setError(e?.message || 'Save failed') }
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
        level5_value:       bulkL5 || null,
        level4_value: null, level6_value: null, level7_value: null,
      }
      const updated = ledgers.map(r => ids.includes(r.id) ? { ...r, ...patch } : r)
      setLedgers(updated)
      const impacted = updated.filter(r => ids.includes(r.id))
      for (const r of impacted) await saveRow(r)
      pushAction({
        label: `Bulk apply (${impacted.length} rows)`,
        changes: impacted.map(r => ({
          id: r.id,
          before: originalById[r.id] || snapshotMapping(r),
          after: snapshotMapping(r),
        })),
      })
      onSaved?.()
    } catch (e) { setError(e?.message || 'Bulk save failed') }
    finally { setSaving(false) }
  }

  // ── Mapping select renderer ───────────────────────────────────────────────
  const renderMappingSelect = (row, level) => {
    if (level === 1) {
      return (
        <select value={row.mapping1_resultant || ''}
          onChange={e => updateLedgerLocal(row.id, {
            mapping1_resultant: e.target.value,
            mapping2_resultant: null, mapping3_resultant: null,
            level4_value: null, level5_value: null, level6_value: null, level7_value: null,
          })}
          className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs">
          <option value="">-</option>
          {lfM1.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      )
    }
    if (level === 2) {
      const opts = lfM2[row.mapping1_resultant] || []
      const cur = row.mapping2_resultant
      const allOpts = cur && !opts.includes(cur) ? [cur, ...opts] : opts
      return (
        <select value={cur || ''}
          onChange={e => {
            let value = e.target.value
            if (value === CUSTOM_VALUE) {
              openCustomEditor('custom face line / Mapping 2', cur, clean =>
                updateLedgerAndSave(row.id, {
                  mapping2_resultant: clean, mapping3_resultant: null,
                  level4_value: null, level5_value: null, level6_value: null, level7_value: null,
                })
              ); return
            }
            updateLedgerLocal(row.id, {
              mapping2_resultant: value, mapping3_resultant: null,
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
    const opts = lfM3[`${row.mapping1_resultant}||${row.mapping2_resultant}`] || []
    const cur = row.mapping3_resultant
    const allOpts = cur && !opts.includes(cur) ? [cur, ...opts] : opts
    return (
      <select value={cur || ''}
        onChange={e => {
          let value = e.target.value
          if (value === CUSTOM_VALUE) {
            openCustomEditor('custom note line / Mapping 3', cur, clean =>
              updateLedgerAndSave(row.id, {
                mapping3_resultant: clean,
                level4_value: null, level5_value: null, level6_value: null, level7_value: null,
              })
            ); return
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

  // ── Render ────────────────────────────────────────────────────────────────
  const content = (
    <div className="modal-backdrop" style={{ zIndex: 9990 }}
      onClick={onClose} onMouseDown={e => e.stopPropagation()}>
      <div
        className="modal-box flex flex-col"
        style={{ maxWidth: '1380px', width: '97vw', maxHeight: '94vh', padding: 0 }}
        onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}
      >
        {/* ── Header toolbar (mirrors Exception Menu) ── */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-blue-100 shrink-0 bg-white flex-wrap">
          <div>
            <h2 className="font-bold text-blue-900 text-sm">{title || 'Fix Categorisation'}</h2>
            <p className="text-xs text-gray-500">
              Filter by books hierarchy, select similar ledgers, and apply Schedule III mappings in bulk.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-3 flex-wrap">
            <input type="text" placeholder="Search all visible fields..."
              value={search} onChange={e => setSearch(e.target.value)}
              className="border border-gray-300 rounded px-3 py-1.5 text-xs w-56 focus:ring-2 focus:ring-blue-400 focus:outline-none" />
            <button onClick={clearFilters}
              className="px-2 py-1.5 text-xs border border-gray-300 rounded text-gray-600 hover:bg-gray-50">
              Clear filters
            </button>
            <button onClick={onClose}
              className="text-gray-400 hover:text-gray-700 text-xl leading-none ml-1">×</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && (
            <div className="text-red-600 text-xs bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>
          )}

          {loading && <div className="text-gray-500 text-sm py-4">Loading...</div>}

          {!loading && ledgers.length === 0 && (
            <div className="text-center text-green-700 bg-green-50 border border-green-200 rounded px-4 py-6 text-sm">
              No exceptions — every ledger in this category is fully categorised.
            </div>
          )}

          {!loading && ledgers.length > 0 && (
            <>
              {/* ── Bulk apply panel ── */}
              <div className="bg-blue-50 border border-blue-200 rounded p-3">
                <div className="flex items-center justify-between mb-2 gap-2">
                  <span className="text-xs font-semibold text-blue-900">
                    Bulk apply to <span className="font-bold">{selected.size}</span> selected ledger{selected.size !== 1 ? 's' : ''}
                  </span>
                  <span className="text-[10px] text-blue-600">
                    Filter the table, tick matching book groups/subgroups, then apply mapping.
                  </span>
                </div>
                <div className="grid grid-cols-5 gap-2 text-xs">
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-0.5">Mapping 1</label>
                    <select value={bulkM1}
                      onChange={e => { setBulkM1(e.target.value); setBulkM2(''); setBulkM3(''); setBulkL5('') }}
                      className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs bg-white">
                      <option value="">-</option>
                      {lfM1.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-0.5">Mapping 2</label>
                    <select value={bulkM2}
                      onChange={e => {
                        let value = e.target.value
                        if (value === CUSTOM_VALUE) {
                          openCustomEditor('custom face line / Mapping 2', bulkM2, clean => {
                            setBulkM2(clean); setBulkM3(''); setBulkL5('')
                          }); return
                        }
                        setBulkM2(value); setBulkM3(''); setBulkL5('')
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
                    <select value={bulkM3}
                      onChange={e => {
                        let value = e.target.value
                        if (value === CUSTOM_VALUE) {
                          openCustomEditor('custom note line / Mapping 3', bulkM3, clean => {
                            setBulkM3(clean); setBulkL5('')
                          }); return
                        }
                        setBulkM3(value); setBulkL5('')
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
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-0.5">Level 5 (Nature)</label>
                    {bulkL5Opts ? (
                      <select value={bulkL5} onChange={e => setBulkL5(e.target.value)}
                        className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs bg-white">
                        <option value="">-</option>
                        {bulkL5Opts.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input type="text" value={bulkL5} onChange={e => setBulkL5(e.target.value)}
                        disabled={!bulkM3}
                        className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs bg-white disabled:bg-gray-100" />
                    )}
                  </div>
                  <div className="flex items-end">
                    <button onClick={applyBulk} disabled={saving || selected.size === 0 || !bulkM1}
                      className="w-full py-1 rounded text-white text-xs font-medium transition disabled:opacity-40"
                      style={{ background: 'var(--color-primary)' }}>
                      {saving ? 'Applying...' : `Apply to ${selected.size}`}
                    </button>
                  </div>
                </div>
              </div>

              {/* ── Row count ── */}
              <div className="flex items-center justify-between text-xs text-gray-500">
                <div>
                  Showing <span className="font-bold">{visibleLedgers.length}</span> of {ledgers.length} rows.
                  <span className="ml-2 font-semibold text-blue-700">{selectedVisibleCount}</span> selected in current view.
                </div>
                <div className="text-[10px] text-gray-400">
                  Click a ledger name then press <kbd className="px-1 py-0.5 bg-gray-100 border border-gray-300 rounded text-[10px]">Ctrl+G</kbd> to view full hierarchy.
                  Scroll right → books hierarchy.
                </div>
              </div>

              {/* ── Table ── */}
              <div className="border border-gray-200 rounded overflow-auto bg-white"
                style={{ maxHeight: 'calc(94vh - 360px)' }}>
                <table className="text-xs table-fixed" style={{ width: totalWidth, minWidth: totalWidth }}>
                  <colgroup>
                    {COLUMNS.map(col => <col key={col.key} style={{ width: col.width }} />)}
                  </colgroup>
                  <thead className="bg-blue-50 border-b border-blue-200 sticky top-0 z-20">
                    <tr>
                      {COLUMNS.map(col => (
                        <th key={col.key}
                          style={stickyStyle(col.key, true)}
                          className={`px-2 py-1.5 font-semibold text-blue-900 border-r border-blue-100 bg-blue-50
                            ${col.key === 'closing_balance' ? 'text-right'
                              : col.key === 'select' || col.key === 'save' ? 'text-center'
                              : 'text-left'}`}>
                          {col.key === 'select' ? (
                            <input type="checkbox" checked={allChecked}
                              ref={el => { if (el) el.indeterminate = someChecked }}
                              onChange={toggleAll} className="rounded border-gray-300" />
                          ) : col.label}
                        </th>
                      ))}
                    </tr>
                    <tr className="bg-white">
                      {COLUMNS.map(col => (
                        <th key={`${col.key}-filter`}
                          style={stickyStyle(col.key, true)}
                          className="px-2 py-1 border-r border-blue-100 border-t border-blue-100 bg-white">
                          {col.filterable ? (
                            <input
                              value={columnFilters[col.key] || ''}
                              onChange={e => setColumnFilters(prev => ({ ...prev, [col.key]: e.target.value }))}
                              placeholder="Filter"
                              className="w-full h-7 border border-blue-100 rounded px-1.5 text-[11px] bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                            />
                          ) : null}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleLedgers.length === 0 && (
                      <tr>
                        <td colSpan={COLUMNS.length} className="text-center text-gray-400 py-4">
                          No rows match the current filters.
                        </td>
                      </tr>
                    )}
                    {visibleLedgers.map(row => {
                      const lfRow  = findLfRow(row.mapping1_resultant, row.mapping2_resultant, row.mapping3_resultant)
                      const l5Opts = lfRow?.level5 ? parseSlashOptions(lfRow.level5) : null
                      const isChecked = selected.has(row.id)
                      return (
                        <tr key={row.id} className={`border-b border-gray-100 ${isChecked ? 'bg-blue-50/70' : 'hover:bg-blue-50/30'}`}>
                          <td style={stickyStyle('select')}
                            className={`px-2 py-1 text-center border-r border-gray-100 ${stickyBg('select', isChecked)}`}>
                            <input type="checkbox" checked={isChecked} onChange={() => toggleRow(row.id)}
                              className="rounded border-gray-300" />
                          </td>
                          <td style={stickyStyle('name')}
                            className={`px-2 py-1 border-r border-gray-100 font-medium truncate cursor-pointer select-none
                              ${focusedRow?.id === row.id ? 'text-blue-700 underline decoration-dotted' : 'text-gray-800'}
                              ${stickyBg('name', isChecked)}`}
                            title={`${row.name || ''} — click then Ctrl+G for hierarchy`}
                            onClick={() => setFocusedRow(row)}>
                            {row.name}
                            {row.ledger_code && <span className="text-gray-400 text-[10px] ml-1">({row.ledger_code})</span>}
                          </td>
                          <td style={stickyStyle('closing_balance')}
                            className={`px-2 py-1 text-right font-mono text-gray-700 border-r border-gray-100 shadow-[2px_0_0_rgba(191,219,254,0.75)] ${stickyBg('closing_balance', isChecked)}`}>
                            {fmtINR(displayAmt(row, 'closing_balance'))}
                          </td>
                          <td style={stickyStyle('save')}
                            className={`px-2 py-1 text-center border-r border-gray-100 ${stickyBg('save', isChecked)}`}>
                            <button onClick={() => saveOne(row)}
                              className="px-2 py-0.5 text-[10px] rounded text-white font-medium transition"
                              style={{ background: 'var(--color-primary)' }}>Save</button>
                          </td>
                          <td className="px-2 py-1 border-r border-gray-100">{renderMappingSelect(row, 1)}</td>
                          <td className="px-2 py-1 border-r border-gray-100">{renderMappingSelect(row, 2)}</td>
                          <td className="px-2 py-1 border-r border-gray-100">{renderMappingSelect(row, 3)}</td>
                          <td className="px-2 py-1 border-r border-gray-100">
                            {l5Opts ? (
                              <select value={row.level5_value || ''}
                                onChange={e => updateLedgerLocal(row.id, { level5_value: e.target.value })}
                                className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs">
                                <option value="">-</option>
                                {l5Opts.map(o => <option key={o} value={o}>{o}</option>)}
                              </select>
                            ) : <span className="text-gray-300 text-xs">-</span>}
                          </td>
                          <td className="px-2 py-1 border-r border-gray-100 text-gray-500 truncate"
                            title={row.status || ''}>{row.status || '-'}</td>
                          <td className="px-2 py-1 border-r border-gray-100 text-gray-600 truncate" title={getBookAlie(row)}>{getBookAlie(row) || '-'}</td>
                          <td className="px-2 py-1 border-r border-gray-100 text-gray-600 truncate" title={row.parent || ''}>{row.parent || '-'}</td>
                          <td className="px-2 py-1 border-r border-gray-100 text-gray-600 truncate" title={row.group_parent || ''}>{row.group_parent || '-'}</td>
                          <td className="px-2 py-1 border-r border-gray-100 text-gray-600 truncate" title={row.group_parent_1 || ''}>{row.group_parent_1 || '-'}</td>
                          <td className="px-2 py-1 border-r border-gray-100 text-gray-600 truncate" title={row.group_parent_2 || ''}>{row.group_parent_2 || '-'}</td>
                          <td className="px-2 py-1 border-r border-gray-100 text-gray-600 truncate" title={row.group_parent_3 || ''}>{row.group_parent_3 || '-'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className="text-[10px] text-gray-400">
                Ctrl+Z undoes the last categorisation action; Ctrl+Y redoes it.
              </div>
            </>
          )}
        </div>

        {/* ── Footer ── */}
        {!loading && (
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100 shrink-0 bg-white">
            <button onClick={onClose}
              className="px-4 py-1.5 border border-gray-300 text-gray-600 rounded text-sm hover:bg-gray-50 transition">
              Close
            </button>
          </div>
        )}
      </div>

      {showHierarchy && focusedRow && (
        <HierarchyPopup row={focusedRow} onClose={() => setShowHierarchy(false)} />
      )}

      {/* ── Custom label editor ── */}
      {customEditor && (
        <div className="fixed inset-0 bg-black/35 flex items-center justify-center z-[10000]"
          onMouseDown={closeCustomEditor}>
          <div className="bg-white rounded border border-blue-200 shadow-xl w-[420px] p-4"
            onMouseDown={e => e.stopPropagation()}>
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

  return createPortal(content, document.body)
}
