import React, { useState, useEffect, useRef } from 'react'
import { AgGridReact } from 'ag-grid-react'
import * as XLSX from 'xlsx-js-style'
import PYTBSelector from '../shared/PYTBSelector'
import { agAmountFilter, AMOUNT_FILTER_HELP } from '../../utils/amountFilter'

/**
 * Consolidated view: one row per ledger with remarks drawn from all scopes
 * (TB, BS, PL, Notes, Annexure). Remarks on aggregate scopes (BS/PL/Notes)
 * flow down to every ledger whose mapping2 matches the scope_key.
 */
export default function MappedTBWithRemarks({ entity, activeTB, prevTB, onPrevTBChange }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [quickFilter, setQuickFilter] = useState('')
  const gridRef = useRef()

  const refresh = async () => {
    if (!activeTB?.id) { setRows([]); return }
    setLoading(true)
    try {
      const data = await window.api?.remarksConsolidated(activeTB.id, prevTB?.id || null)
      setRows(data || [])
    } catch {}
    finally { setLoading(false) }
  }

  useEffect(() => { refresh() }, [activeTB?.id, prevTB?.id])

  const [downloading, setDownloading] = useState(false)
  const handleDownloadExcel = async () => {
    if (!rows.length) return
    setDownloading(true)
    try {
      // Every row belongs to the same TB, so 'Branch' repeats — that's
      // intentional: it lets a CA tell branch files apart once several are
      // open side by side, without having to check the filename.
      const branchName = activeTB?.branch_name || ''
      const header = ['Branch', 'Code', 'Ledger Name', 'ALIE', 'Mapping 1', 'Mapping 2', 'Mapping 3', 'Closing Bal. (Revised)', 'PY Closing Bal.', 'Adjustments (Debit)', 'Adjustments (Credit)', 'TB Remark', 'BS Remark', 'PL Remark', 'Notes Remark', 'Annexure Remark']
      const aoa = [header, ...rows.map(r => [
        branchName,
        r.ledger_code || '', r.ledger_name || '', r.alie || '',
        r.mapping1_resultant || '', r.mapping2_resultant || '', r.mapping3_resultant || '',
        r.closing_balance != null ? Number(r.closing_balance) : null,
        r.py_closing_balance != null ? Number(r.py_closing_balance) : null,
        r.adj_debit != null ? Number(r.adj_debit) : null,
        r.adj_credit != null ? Number(r.adj_credit) : null,
        r.tb_remark || '', r.bs_remark || '', r.pl_remark || '', r.notes_remark || '', r.annexure_remark || '',
      ])]
      const ws = XLSX.utils.aoa_to_sheet(aoa)
      ws['!cols'] = [{ wch: 16 }, { wch: 12 }, { wch: 32 }, { wch: 20 }, { wch: 22 }, { wch: 24 }, { wch: 24 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 28 }, { wch: 28 }, { wch: 28 }, { wch: 28 }, { wch: 28 }]
      for (let c = 0; c < header.length; c++) {
        const addr = XLSX.utils.encode_cell({ c, r: 0 })
        if (ws[addr]) ws[addr].s = { font: { bold: true }, border: { bottom: { style: 'thin', color: { rgb: '000000' } } } }
      }
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Mapped TB Remarks')
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
      const branchTag = branchName ? `_${branchName.replace(/[\\/:*?"<>|]/g, '')}` : ''
      const result = await window.api?.saveFileDialog({
        defaultPath: `MappedTB_Remarks${branchTag}_${activeTB?.period || 'export'}.xlsx`,
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      })
      if (result?.filePath && buf) await window.api?.writeFile(result.filePath, new Uint8Array(buf))
    } catch (err) {
      console.error('Excel download failed:', err)
    } finally {
      setDownloading(false)
    }
  }

  const colDefs = [
    { field: 'ledger_code', headerName: 'Code', width: 110, pinned: 'left' },
    { field: 'ledger_name', headerName: 'Ledger Name', width: 240, pinned: 'left', tooltipField: 'ledger_name' },
    { field: 'alie', headerName: 'ALIE', width: 170,
      cellStyle: (p) => {
        const v = (p.value || '').toLowerCase()
        if (v.includes('asset'))     return { color: '#1e40af', fontWeight: 500 }
        if (v.includes('liabilit') || v.includes('equity')) return { color: '#065f46', fontWeight: 500 }
        if (v.includes('income'))    return { color: '#15803d', fontWeight: 500 }
        if (v.includes('expense'))   return { color: '#b45309', fontWeight: 500 }
        return { color: '#6b7280' }
      }
    },
    { field: 'mapping1_resultant', headerName: 'Mapping 1', width: 180 },
    { field: 'mapping2_resultant', headerName: 'Mapping 2', width: 200 },
    { field: 'mapping3_resultant', headerName: 'Mapping 3', width: 200 },
    { field: 'closing_balance', headerName: 'Closing Bal. (Revised)', width: 150, type: 'numericColumn',
      headerTooltip: 'After the Trial Balance adjustments typed on the Mapped TB - the figure the statements use',
      valueFormatter: (p) => p.value == null ? '' : Number(p.value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    },
    { field: 'py_closing_balance', headerName: 'PY Closing Bal.', width: 130, type: 'numericColumn',
      valueFormatter: (p) => p.value == null ? '' : Number(p.value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    },
    { field: 'adj_debit', headerName: 'Adjustments (Debit)', width: 140, type: 'numericColumn',
      valueFormatter: (p) => p.value == null ? '' : Number(p.value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
    { field: 'adj_credit', headerName: 'Adjustments (Credit)', width: 140, type: 'numericColumn',
      valueFormatter: (p) => p.value == null ? '' : Number(p.value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
    { field: 'tb_remark', headerName: 'TB Remark', width: 200, wrapText: true, autoHeight: true,
      cellStyle: { whiteSpace: 'normal', fontSize: '11px' } },
    { field: 'bs_remark', headerName: 'BS Remark', width: 200, wrapText: true, autoHeight: true,
      cellStyle: { whiteSpace: 'normal', fontSize: '11px', background: '#f0fdf4' } },
    { field: 'pl_remark', headerName: 'PL Remark', width: 200, wrapText: true, autoHeight: true,
      cellStyle: { whiteSpace: 'normal', fontSize: '11px', background: '#fff7ed' } },
    { field: 'notes_remark', headerName: 'Notes Remark', width: 200, wrapText: true, autoHeight: true,
      cellStyle: { whiteSpace: 'normal', fontSize: '11px', background: '#eff6ff' } },
    { field: 'annexure_remark', headerName: 'Annexure Remark', width: 200, wrapText: true, autoHeight: true,
      cellStyle: { whiteSpace: 'normal', fontSize: '11px', background: '#fdf4ff' } },
  ]

  if (!activeTB) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        Load a Trial Balance in the Actual TB tab first.
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full p-4 gap-3">
      <div className="flex items-center gap-3 flex-wrap shrink-0">
        <div>
          <h2 className="text-sm font-bold text-gray-800">Mapped TB with Remarks</h2>
          <p className="text-xs text-gray-500">
            Consolidated view of all ledgers with remarks from TB, BS, PL, Notes, and Annexures.
            Aggregate remarks (BS/PL/Notes on a line item like "Share Capital") appear against every ledger mapped to that line item.
          </p>
        </div>
        <PYTBSelector entity={entity} currentTBId={activeTB?.id} prevTB={prevTB} onChange={onPrevTBChange} />
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={refresh}
            className="px-3 py-1.5 text-xs border border-gray-300 text-gray-600 rounded hover:bg-gray-50 transition"
            title="Reload remarks"
          >
            ↻ Refresh
          </button>
          <button
            onClick={handleDownloadExcel}
            disabled={downloading || rows.length === 0}
            className="px-3 py-1.5 text-xs border border-green-500 text-green-700 rounded hover:bg-green-50 transition disabled:opacity-40"
            title="Download this table as an Excel file"
          >
            {downloading ? 'Downloading…' : '⬇ Download Excel'}
          </button>
          <input
            type="text"
            placeholder="Search..."
            value={quickFilter}
            onChange={e => setQuickFilter(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm w-56 focus:ring-2 focus:ring-blue-400 focus:outline-none"
          />
          {quickFilter && <button onClick={() => setQuickFilter('')} className="text-gray-400 text-sm">✕</button>}
          <span className="text-[10px] text-gray-400" title={AMOUNT_FILTER_HELP}>Amount filter: &gt;1000 · &lt;500 · 1000-5000</span>
        </div>
      </div>

      <div className="flex-1 ag-theme-alpine overflow-hidden rounded border border-blue-100">
        {loading ? (
          <div className="flex items-center justify-center h-full text-gray-400">Loading...</div>
        ) : rows.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            No ledgers in this Trial Balance.
          </div>
        ) : (
          <AgGridReact
            ref={gridRef}
            rowData={rows}
            columnDefs={colDefs.map(c => (c.type === 'numericColumn' ? { ...c, ...agAmountFilter() } : c))}
            quickFilterText={quickFilter}
            defaultColDef={{ resizable: true, sortable: true, filter: 'agTextColumnFilter', floatingFilter: true }}
            rowHeight={38}
            headerHeight={36}
            floatingFiltersHeight={32}
            pagination={true}
            paginationPageSize={100}
          />
        )}
      </div>
    </div>
  )
}
