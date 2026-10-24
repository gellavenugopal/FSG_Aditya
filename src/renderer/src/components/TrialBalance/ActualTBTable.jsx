import React, { useState, useEffect, useRef } from 'react'
import { AgGridReact } from 'ag-grid-react'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import RemarkCell, { useRemarks } from '../shared/RemarkCell'

const TB_COLUMNS = [
  { field: 'period',            headerName: 'Period',          pinned: 'left', width: 90 },
  { field: 'branch',            headerName: 'Branch',          width: 110 },
  { field: 'ledger_code',       headerName: 'Ledger Code',     width: 120 },
  { field: 'name',              headerName: 'Name',            pinned: 'left', width: 240, tooltipField: 'name' },
  { field: 'opening_balance',   headerName: 'Opening Bal.',    width: 130, type: 'numericColumn', valueFormatter: numFmt },
  { field: 'debit',             headerName: 'Debit',           width: 130, type: 'numericColumn', valueFormatter: numFmt },
  { field: 'credit',            headerName: 'Credit',          width: 130, type: 'numericColumn', valueFormatter: numFmt },
  { field: 'closing_balance',   headerName: 'Closing Bal.',    width: 130, type: 'numericColumn', valueFormatter: numFmt },
  { field: 'is_revenue',        headerName: 'Is Revenue',      width: 100 },
  { field: 'is_deemed_positive',headerName: 'Deemed +ve',      width: 100 },
  { field: 'trail_balance',     headerName: 'Trail Balance',   width: 130, type: 'numericColumn', valueFormatter: numFmt },
  { field: 'parent',            headerName: 'Parent',          width: 200 },
  { field: 'group_parent',      headerName: 'Group.$Parent',   width: 200 },
  { field: 'group_parent_1',    headerName: 'Group.$Parent.1', width: 200 },
  { field: 'group_parent_2',    headerName: 'Group.$Parent.2', width: 200 },
  { field: 'group_parent_3',    headerName: 'Group.$Parent.3', width: 200 },
  { field: 'group_parent_4',    headerName: 'Group.$Parent.4', width: 180 },
  { field: 'group_parent_5',    headerName: 'Group.$Parent.5', width: 180 },
  { field: 'group_parent_6',    headerName: 'Group.$Parent.6', width: 180 },
  { field: 'group_parent_7',    headerName: 'Group.$Parent.7', width: 180 },
  { field: 'group_parent_8',    headerName: 'Group.$Parent.8', width: 180 },
  { field: 'upload_nature',     headerName: 'Nature of Upload', width: 140 },
]

function numFmt(p) {
  if (p.value === null || p.value === undefined) return ''
  return Number(p.value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const NUM_FIELDS = ['opening_balance','debit','credit','closing_balance','trail_balance']

export default function ActualTBTable({ entity, activeTB }) {
  const [rows, setRows]             = useState([])
  const [loading, setLoading]       = useState(false)
  const [quickFilter, setQuickFilter] = useState('')
  const [error, setError]           = useState('')
  const [showAddRow, setShowAddRow] = useState(false)
  const [addRowData, setAddRowData] = useState({ name: '', ledger_code: '', opening_balance: '', debit: '', credit: '', closing_balance: '' })
  const [rowToDelete, setRowToDelete] = useState(null)
  const [deletingRow, setDeletingRow] = useState(false)
  const { get: getRemark, set: setRemark } = useRemarks(activeTB?.id)
  const onRemarkSaved = (scope, key, value) => setRemark(scope, key, value)
  const gridRef = useRef()

  const totals = React.useMemo(() => {
    const sum = (field) => rows.reduce((acc, r) => acc + (parseFloat(r[field]) || 0), 0)
    return {
      opening_balance: sum('opening_balance'),
      debit:           sum('debit'),
      credit:          sum('credit'),
      closing_balance: sum('closing_balance'),
    }
  }, [rows])

  const loadRows = async (tbId) => {
    setLoading(true)
    try {
      const data = await window.api?.getTBRows(tbId)
      setRows(data || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!activeTB) { setRows([]); return }
    loadRows(activeTB.id)
  }, [activeTB])

  const handleInsertRow = async () => {
    if (!activeTB || !addRowData.name) return
    setError('')
    try {
      await window.api?.insertManualRow({ tbId: activeTB.id, rowData: addRowData })
      await loadRows(activeTB.id)
      setShowAddRow(false)
      setAddRowData({ name: '', ledger_code: '', opening_balance: '', debit: '', credit: '', closing_balance: '' })
    } catch (err) { setError(err.message || 'Failed to add row.') }
  }

  const handleDeleteRow = async () => {
    if (!activeTB || !rowToDelete) return
    setDeletingRow(true)
    setError('')
    try {
      await window.api?.deleteTBRow({ tbId: activeTB.id, rowId: rowToDelete.id })
      await loadRows(activeTB.id)
      setRowToDelete(null)
    } catch (err) {
      setError(err.message || 'Failed to delete row.')
    } finally {
      setDeletingRow(false)
    }
  }

  const colDefs = [
    ...TB_COLUMNS.map(c => ({
      ...c,
      filter: NUM_FIELDS.includes(c.field) ? 'agNumberColumnFilter' : 'agTextColumnFilter',
      floatingFilter: true,
      resizable: true,
      sortable: true,
    })),
    {
      headerName: 'Remark', width: 180, pinned: 'right',
      cellRenderer: (p) => {
        if (!p.data || !activeTB?.id) return ''
        // Fall back to ledger name when ledger_code is missing
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
      sortable: false, filter: false, resizable: true,
    },
    {
      headerName: '', width: 44, pinned: 'right',
      cellRenderer: (p) => {
        if (!p.data) return ''
        return (
          <button
            onClick={() => setRowToDelete(p.data)}
            title="Delete this row"
            className="text-red-400 hover:text-red-600 text-sm"
          >
            🗑
          </button>
        )
      },
      sortable: false, filter: false, resizable: false,
    },
  ]

  const fmt = (n) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  // The Trial Balance as uploaded is shown here. Adjustments typed on the Mapped TB revise the
  // closing balance everywhere else (statements, notes, ratios, checks).
  const adjustedCount = rows.filter(r => r.adj_debit != null || r.adj_credit != null).length

  return (
    <div className="flex flex-col h-full p-4 gap-3">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap shrink-0">
        {activeTB && (
          <button
            onClick={() => setShowAddRow(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-green-400 text-green-700 text-sm rounded hover:bg-green-50 transition font-medium"
            title="Manually insert a new row"
          >
            + Add Row
          </button>
        )}

        {/* Global search */}
        <div className="ml-auto flex items-center gap-2">
          <input
            type="text"
            placeholder="Global Search…"
            value={quickFilter}
            onChange={e => setQuickFilter(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm w-56 focus:ring-2 focus:ring-blue-400 focus:outline-none"
          />
          {quickFilter && (
            <button onClick={() => setQuickFilter('')} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
          )}
        </div>
      </div>

      {!activeTB && (
        <div className="text-amber-600 text-sm bg-amber-50 border border-amber-200 rounded px-3 py-2">
          No Trial Balance selected — go to Trial Balance → Upload TB to upload or select one.
        </div>
      )}

      {error && <div className="text-red-500 text-sm bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

      {adjustedCount > 0 && (
        <div className="text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded px-3 py-2 shrink-0">
          This is the Trial Balance <strong>as uploaded</strong>. {adjustedCount} ledger{adjustedCount === 1 ? ' carries' : 's carry'} adjustments
          typed on the Mapped TB — the Balance Sheet, P&amp;L, notes and ratios use the revised closing balances (Mapped TB → Revised Clos Bal).
        </div>
      )}

      {/* Summary totals */}
      {rows.length > 0 && (
        <div className="flex gap-3 shrink-0">
          {[
            { label: 'Opening Balance', value: totals.opening_balance },
            { label: 'Total Debit',     value: totals.debit },
            { label: 'Total Credit',    value: totals.credit },
            { label: 'Closing Balance', value: totals.closing_balance },
          ].map(({ label, value }) => (
            <div key={label} className="summary-card flex-1 min-w-0">
              <div className="text-xs text-gray-500">{label}</div>
              <div className={`text-sm font-bold mt-0.5 ${value < 0 ? 'text-red-600' : 'text-blue-800'}`}>
                {fmt(value)}
              </div>
            </div>
          ))}
          <div className="summary-card flex-1 min-w-0">
            <div className="text-xs text-gray-500">Total Rows</div>
            <div className="text-sm font-bold mt-0.5 text-blue-800">{rows.length.toLocaleString()}</div>
          </div>
        </div>
      )}

      {/* Grid */}
      <div className="flex-1 ag-theme-alpine overflow-hidden rounded border border-blue-100">
        {loading ? (
          <div className="flex items-center justify-center h-full text-gray-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2">
            <svg className="w-12 h-12 text-blue-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-sm">Upload a Trial Balance to view data here</p>
          </div>
        ) : (
          <AgGridReact
            ref={gridRef}
            rowData={rows}
            columnDefs={colDefs}
            quickFilterText={quickFilter}
            pagination={true}
            paginationPageSize={100}
            suppressMovableColumns={false}
            defaultColDef={{ resizable: true, sortable: true, filter: true, floatingFilter: true }}
            rowHeight={28}
            headerHeight={36}
            floatingFiltersHeight={32}
            suppressCellFocus={false}
            tooltipShowDelay={300}
          />
        )}
      </div>

      {/* Add Row modal */}
      {showAddRow && (
        <div className="modal-backdrop" onClick={() => setShowAddRow(false)}>
          <div className="modal-box max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-bold text-blue-900">Add Manual Row</h2>
              <button onClick={() => setShowAddRow(false)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Ledger Name *</label>
                <input type="text" value={addRowData.name} onChange={e => setAddRowData(p => ({ ...p, name: e.target.value }))}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none" autoFocus />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Ledger Code</label>
                <input type="text" value={addRowData.ledger_code} onChange={e => setAddRowData(p => ({ ...p, ledger_code: e.target.value }))}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Opening Balance</label>
                <input type="number" step="0.01" value={addRowData.opening_balance} onChange={e => setAddRowData(p => ({ ...p, opening_balance: e.target.value }))}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm text-right font-mono focus:ring-2 focus:ring-blue-400 focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Debit</label>
                <input type="number" step="0.01" value={addRowData.debit} onChange={e => setAddRowData(p => ({ ...p, debit: e.target.value }))}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm text-right font-mono focus:ring-2 focus:ring-blue-400 focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Credit</label>
                <input type="number" step="0.01" value={addRowData.credit} onChange={e => setAddRowData(p => ({ ...p, credit: e.target.value }))}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm text-right font-mono focus:ring-2 focus:ring-blue-400 focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Closing Balance</label>
                <input type="number" step="0.01" value={addRowData.closing_balance} onChange={e => setAddRowData(p => ({ ...p, closing_balance: e.target.value }))}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm text-right font-mono focus:ring-2 focus:ring-blue-400 focus:outline-none" />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowAddRow(false)} className="flex-1 py-2 border border-gray-300 text-gray-600 rounded text-sm hover:bg-gray-50 transition">Cancel</button>
              <button onClick={handleInsertRow} disabled={!addRowData.name} className="flex-1 py-2 text-white rounded text-sm font-medium hover:opacity-90 disabled:opacity-40 transition" style={{ background: 'var(--color-primary)' }}>
                Add Row
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete row confirmation */}
      {rowToDelete && (
        <div className="modal-backdrop" onClick={() => setRowToDelete(null)}>
          <div className="modal-box max-w-sm" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold text-red-700 mb-2">Delete Row?</h2>
            <p className="text-sm text-gray-600 mb-3">This will permanently delete this row from the Trial Balance:</p>
            <div className="bg-gray-50 border border-gray-200 rounded px-3 py-2 mb-4 text-sm space-y-0.5">
              <div><span className="text-gray-500">Name:</span> <span className="font-semibold">{rowToDelete.name}</span></div>
              <div><span className="text-gray-500">Opening:</span> {numFmt({ value: rowToDelete.opening_balance })}</div>
              <div><span className="text-gray-500">Closing:</span> {numFmt({ value: rowToDelete.closing_balance })}</div>
            </div>
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1 mb-4">This action cannot be undone.</p>
            <div className="flex gap-2">
              <button onClick={() => setRowToDelete(null)} className="flex-1 py-2 border border-gray-300 text-gray-600 rounded text-sm hover:bg-gray-50 transition">Cancel</button>
              <button onClick={handleDeleteRow} disabled={deletingRow} className="flex-1 py-2 bg-red-600 text-white rounded text-sm font-medium hover:bg-red-700 disabled:opacity-40 transition">
                {deletingRow ? 'Deleting…' : 'Yes, Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
