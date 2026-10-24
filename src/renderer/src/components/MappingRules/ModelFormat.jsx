import React, { useState, useEffect, useRef } from 'react'
import { AgGridReact } from 'ag-grid-react'
import MappingEntryTable from './MappingEntryTable'

const CONSTITUTION_MAP = { 1: 'Individual/Prop./Partnership', 2: 'LLP', 3: 'Company' }

function parseSlashOptions(val) {
  if (!val) return null
  if (val.includes('/')) return val.split('/').map(s => s.trim()).filter(Boolean)
  return null
}

function CellRenderer(p) {
  const val = p.value
  if (!val) return <span className="text-gray-300">—</span>
  const opts = parseSlashOptions(val)
  if (opts) {
    return (
      <select className="border border-blue-200 rounded text-xs px-1 py-0.5 bg-white text-blue-800 max-w-full">
        <option value="">Select…</option>
        {opts.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  }
  if (val.toLowerCase().includes('specify nature')) {
    return <span className="text-xs text-gray-400 italic">Specify nature…</span>
  }
  return <span className="text-xs text-gray-700">{val}</span>
}

const LEVEL_COLS = ['alie', 'level1', 'level2', 'level3', 'level4', 'level5', 'level6', 'level7']
const LEVEL_HEADERS = ['ALIE', 'Level 1', 'Level 2', 'Level 3', 'Level 4', 'Level 5', 'Level 6', 'Level 7']

export default function ModelFormat({ entity, activeRsId, onRsChange }) {
  const [constitution, setConstitution] = useState(entity?.constitution || 3)
  const [lf, setLf]                     = useState([])
  const [rsId, setRsId]                 = useState(activeRsId)
  const [ruleSets, setRuleSets]         = useState([])
  const [loading, setLoading]           = useState(false)
  const [globalFilter, setGlobalFilter] = useState('')
  const [uploading, setUploading]       = useState(false)
  const [learnedBusy, setLearnedBusy]   = useState(false)
  const [learnedMsg, setLearnedMsg]     = useState('')
  const [showEntryTable, setShowEntryTable] = useState(false)
  const [hiddenCols, setHiddenCols]     = useState(new Set())
  const [showColPanel, setShowColPanel] = useState(false)
  const colPanelRef = useRef(null)
  const gridRef = useRef()

  useEffect(() => {
    if (entity?.constitution) setConstitution(entity.constitution)
  }, [entity])

  useEffect(() => {
    if (!entity) return
    window.api?.getRuleSets(entity.id).then(rs => {
      setRuleSets(rs)
      if (!rsId && rs.length) {
        const def = rs.find(r => r.is_default) || rs[0]
        setRsId(def.id)
        onRsChange?.(def.id)
      }
    }).catch(() => {})
  }, [entity])

  useEffect(() => {
    if (!rsId) return
    setLoading(true)
    window.api?.getLevelFormat(constitution, rsId).then(data => {
      setLf(data || [])
    }).catch(() => {}).finally(() => setLoading(false))
  }, [constitution, rsId])

  // Close column panel on outside click
  useEffect(() => {
    if (!showColPanel) return
    const handler = (e) => {
      if (colPanelRef.current && !colPanelRef.current.contains(e.target)) setShowColPanel(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showColPanel])

  const handleDownload = async () => {
    if (!rsId) return
    const buf = await window.api?.downloadMapping(rsId)
    const result = await window.api?.saveFileDialog({
      defaultPath: 'Mapping_Rules.xlsx',
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    })
    if (!result?.canceled && result?.filePath) {
      await window.api?.writeFile(result.filePath, buf)
    }
  }

  const handleUpload = async () => {
    if (!entity) return
    const result = await window.api?.openFileDialog({
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      properties: ['openFile'],
      title: 'Upload Mapping Excel'
    })
    if (result?.canceled || !result?.filePaths?.length) return
    setUploading(true)
    try {
      const { rsId: newRsId, skippedRows } = await window.api?.uploadMapping({
        entityId: entity.id,
        filePath: result.filePaths[0],
        name: `Custom Mapping — ${new Date().toLocaleDateString()}`
      })
      const rs = await window.api?.getRuleSets(entity.id)
      setRuleSets(rs)
      setRsId(newRsId)
      onRsChange?.(newRsId)
      if (skippedRows) {
        alert(`Mapping uploaded. ${skippedRows} row(s) with a blank/invalid Constitution column were skipped.`)
      }
    } catch (err) {
      alert('Upload failed: ' + err.message)
    } finally {
      setUploading(false)
    }
  }

  const handleRevert = async () => {
    if (!entity) return
    const { defaultRsId } = await window.api?.revertToDefault(entity.id)
    if (defaultRsId) { setRsId(defaultRsId); onRsChange?.(defaultRsId) }
  }

  // ── Learned Ledger Rules — download/upload ─────────────────────────────────
  // Distinct from "Download/Upload Mapping" above (which is the static
  // Map1/2/3/LevelFormat keyword rules). This is the entity's actual learned
  // per-ledger decisions (every ledger you've approved/fixed in
  // Categorisation) — durable and TB-independent (see schema.js's
  // learned_ledger_rules), so it survives deleting every Trial Balance for
  // this entity, and can be uploaded into a different entity (a genuinely
  // different company, or a fresh duplicate of this one) since the file
  // carries no entity identity, only ledger name + mapping.
  const handleDownloadLearned = async () => {
    if (!entity) return
    setLearnedBusy(true); setLearnedMsg('')
    try {
      const { buffer, count } = await window.api?.downloadLearnedRules(entity.id)
      const result = await window.api?.saveFileDialog({
        defaultPath: `${(entity.name || 'Entity').replace(/[^A-Za-z0-9]+/g, '_')}_Learned_Ledger_Rules.xlsx`,
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      })
      if (!result?.canceled && result?.filePath) {
        await window.api?.writeFile(result.filePath, Array.from(new Uint8Array(buffer)))
        setLearnedMsg(`Downloaded ${count} learned ledger rule${count !== 1 ? 's' : ''}.`)
      }
    } catch (err) {
      setLearnedMsg('Download failed: ' + (err?.message || err))
    } finally {
      setLearnedBusy(false)
    }
  }

  const handleUploadLearned = async () => {
    if (!entity) return
    const result = await window.api?.openFileDialog({
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      properties: ['openFile'],
      title: 'Upload Learned Ledger Rules',
    })
    if (result?.canceled || !result?.filePaths?.length) return
    setLearnedBusy(true); setLearnedMsg('')
    try {
      const bytes = await window.api?.readFile(result.filePaths[0])
      const { applied, skipped, rowsApplied = 0, tbsTouched, tbsLocked, unmatched = [], customCaptions = [] } = await window.api?.uploadLearnedRules(entity.id, bytes)
      const list = (arr, n = 8) => arr.slice(0, n).join(', ') + (arr.length > n ? ` … (+${arr.length - n} more)` : '')
      setLearnedMsg(
        `Imported ${applied} rule${applied !== 1 ? 's' : ''}` +
        `${skipped ? `, skipped ${skipped} blank/duplicate row(s)` : ''}. ` +
        (tbsTouched
          ? `Applied to ${rowsApplied} ledger${rowsApplied !== 1 ? 's' : ''} on ${tbsTouched} Trial Balance${tbsTouched !== 1 ? 's' : ''} straight away.`
          : `Stored. No mapped ledger matched by name yet — they apply automatically on the next Auto-Mapping run (or as soon as a matching ledger appears).`) +
        (tbsLocked ? ` ${tbsLocked} locked period(s) were left untouched.` : '') +
        (customCaptions.length ? ` ${customCaptions.length} custom caption(s) kept as-is: ${list(customCaptions, 6)}.` : '') +
        (unmatched.length ? ` ${unmatched.length} rule(s) name a ledger that is on none of this entity's Trial Balances (named differently here?): ${list(unmatched)}.` : '')
      )
    } catch (err) {
      setLearnedMsg('Upload failed: ' + (err?.message || err))
    } finally {
      setLearnedBusy(false)
    }
  }

  const toggleColumn = (colId) => {
    setHiddenCols(prev => {
      const next = new Set(prev)
      if (next.has(colId)) next.delete(colId)
      else next.add(colId)
      return next
    })
  }

  // AG Grid column definitions
  const allColDefs = [
    { colId: '_row', headerName: '#', valueGetter: 'node.rowIndex + 1', width: 60, pinned: 'left', sortable: false, filter: false },
    ...LEVEL_COLS.map((col, i) => ({
      colId: col,
      field: col,
      headerName: LEVEL_HEADERS[i],
      width: 160,
      resizable: true,
      sortable: true,
      filter: 'agTextColumnFilter',
      cellRenderer: CellRenderer,
    }))
  ]

  const toggleableCols = allColDefs.filter(c => c.colId && c.colId !== '_row')
  const colDefs = allColDefs.filter(c => !c.colId || c.colId === '_row' || !hiddenCols.has(c.colId))

  return (
    <div className="flex flex-col h-full p-4 gap-3">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap shrink-0">
        {/* Constitution filter */}
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 whitespace-nowrap">Constitution:</label>
          <select
            value={constitution}
            onChange={e => setConstitution(parseInt(e.target.value))}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none"
          >
            <option value={1}>1 — Individual / Prop. / Partnership</option>
            <option value={2}>2 — LLP</option>
            <option value={3}>3 — Company</option>
          </select>
        </div>

        {/* Rule set selector */}
        {ruleSets.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">Rule Set:</label>
            <select
              value={rsId || ''}
              onChange={e => { setRsId(parseInt(e.target.value)); onRsChange?.(parseInt(e.target.value)) }}
              className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none"
            >
              {ruleSets.map(rs => (
                <option key={rs.id} value={rs.id}>
                  {rs.name}{rs.is_default ? ' (Default)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        <button onClick={handleDownload} className="px-3 py-1.5 border border-blue-600 text-blue-700 text-sm rounded hover:bg-blue-50 transition">
          Download Mapping
        </button>
        <button onClick={handleUpload} disabled={uploading} className="px-3 py-1.5 bg-blue-700 text-white text-sm rounded hover:bg-blue-800 disabled:opacity-40 transition">
          {uploading ? 'Uploading…' : 'Upload User Mapping'}
        </button>
        <button onClick={handleRevert} className="px-3 py-1.5 border border-gray-300 text-gray-600 text-sm rounded hover:bg-gray-50 transition">
          Revert to Default
        </button>

        <div className="flex items-center rounded border border-amber-300 overflow-hidden">
          <button onClick={handleDownloadLearned} disabled={learnedBusy}
            className="px-3 py-1.5 text-sm text-amber-800 hover:bg-amber-50 border-r border-amber-300 disabled:opacity-40 transition"
            title="Download every ledger you've approved/fixed for this entity — durable, survives deleting all its Trial Balances">
            ↓ Learned Ledger Rules
          </button>
          <button onClick={handleUploadLearned} disabled={learnedBusy}
            className="px-3 py-1.5 text-sm text-amber-800 hover:bg-amber-50 disabled:opacity-40 transition"
            title="Apply a Learned Ledger Rules file to this entity — works even across a different or freshly-created entity">
            {learnedBusy ? '…' : '↑ Learned Ledger Rules'}
          </button>
        </div>

        <div className="ml-auto flex items-center gap-2">
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
              Columns{hiddenCols.size > 0 ? ` (${hiddenCols.size} hidden)` : ''}
            </button>
            {showColPanel && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 w-48 max-h-72 overflow-y-auto py-1">
                {toggleableCols.map(c => (
                  <label key={c.colId} className="flex items-center gap-2 px-3 py-1 hover:bg-gray-50 cursor-pointer text-xs text-gray-700">
                    <input
                      type="checkbox"
                      checked={!hiddenCols.has(c.colId)}
                      onChange={() => toggleColumn(c.colId)}
                      className="rounded border-gray-300"
                    />
                    {c.headerName}
                  </label>
                ))}
                {hiddenCols.size > 0 && (
                  <button
                    onClick={() => setHiddenCols(new Set())}
                    className="w-full text-left px-3 py-1.5 text-xs text-blue-600 hover:bg-blue-50 border-t border-gray-100 mt-1"
                  >
                    Show All Columns
                  </button>
                )}
              </div>
            )}
          </div>
          <input
            type="text"
            placeholder="Search model format…"
            value={globalFilter}
            onChange={e => setGlobalFilter(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm w-52 focus:ring-2 focus:ring-blue-400 focus:outline-none"
          />
          {globalFilter && <button onClick={() => setGlobalFilter('')} className="text-gray-400 text-sm">✕</button>}
        </div>
      </div>

      {learnedMsg && (
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 shrink-0">{learnedMsg}</div>
      )}

      {/* Row count */}
      <div className="text-xs text-gray-400 shrink-0">
        Showing {lf.length} rows for constitution: <strong>{CONSTITUTION_MAP[constitution]}</strong>
      </div>

      {/* AG Grid table */}
      <div className="flex-1 ag-theme-alpine overflow-hidden rounded border border-blue-100">
        {loading ? (
          <div className="flex items-center justify-center h-full text-gray-400">Loading…</div>
        ) : (
          <AgGridReact
            ref={gridRef}
            rowData={lf}
            columnDefs={colDefs}
            quickFilterText={globalFilter}
            defaultColDef={{
              resizable: true, sortable: true,
              filter: 'agTextColumnFilter', floatingFilter: true,
            }}
            rowHeight={30}
            headerHeight={36}
            floatingFiltersHeight={32}
            pagination={true}
            paginationPageSize={100}
            tooltipShowDelay={300}
          />
        )}
      </div>

      {/* Entry table toggle */}
      <div className="shrink-0">
        <button
          onClick={() => setShowEntryTable(p => !p)}
          className="flex items-center gap-2 text-sm text-blue-700 font-medium hover:text-blue-900 transition"
        >
          <svg className={`w-4 h-4 transition-transform ${showEntryTable ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
          {showEntryTable ? 'Hide' : 'Show'} Custom Mapping Entry Table
        </button>

        {showEntryTable && (
          <div className="mt-3 border border-blue-100 rounded overflow-hidden">
            <MappingEntryTable
              entity={entity}
              rsId={rsId}
              constitution={constitution}
              levelFormatData={lf}
            />
          </div>
        )}
      </div>
    </div>
  )
}
