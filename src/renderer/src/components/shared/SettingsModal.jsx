import React, { useState, useEffect } from 'react'
import { useModalKeys } from '../../hooks/useModalKeys'

export default function SettingsModal({ onClose, onConnected }) {
  const [cfg, setCfg] = useState({ host: 'localhost', port: 5432, database: 'vera_financial', user: 'postgres', password: '' })
  const [testing, setTesting]   = useState(false)
  const [saving, setSaving]     = useState(false)
  const [status, setStatus]     = useState(null)
  const [msg, setMsg]           = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportMsg, setExportMsg] = useState('')
  const [refExporting, setRefExporting] = useState(false)
  const [refExportMsg, setRefExportMsg] = useState('')

  const containerRef = useModalKeys({ onClose, onConfirm: handleSave })

  useEffect(() => {
    window.api?.getSettings().then(s => {
      if (s) setCfg(prev => ({ ...prev, ...s, password: '' }))
    }).catch(() => {})
  }, [])

  const set = (k, v) => setCfg(prev => ({ ...prev, [k]: v }))

  const handleTest = async () => {
    setTesting(true); setStatus(null); setMsg('')
    const r = await window.api?.testConnection(cfg)
    setTesting(false)
    setStatus(r?.ok ? 'ok' : 'error')
    setMsg(r?.ok ? 'Connection successful!' : r?.error || 'Connection failed.')
  }

  async function handleSave() {
    setSaving(true); setStatus(null); setMsg('')
    const r = await window.api?.saveSettings(cfg)
    setSaving(false)
    if (r?.ok) {
      setStatus('ok'); setMsg('Saved and connected.')
      setTimeout(onConnected, 800)
    } else {
      setStatus('error'); setMsg(r?.error || 'Failed to connect.')
    }
  }

  // Every table's raw data, one sheet per table — a full snapshot of the
  // database for backup/audit/debugging. The main process asks for the file,
  // reads the tables and writes the workbook itself (services/dbExport.js): the
  // file is never sent back through IPC, which is what used to fail with
  // "Invalid array length" once it passed ~134 MB. A very large database becomes
  // several files (<name>_part1.xlsx, _part2.xlsx, ...).
  const handleExportAllTables = async () => {
    setExporting(true); setExportMsg('')
    try {
      const stamp = new Date().toISOString().slice(0, 10)
      const r = await window.api?.exportAllTablesToFile({ defaultPath: `FSG_Bharat_Database_Export_${stamp}.xlsx` })
      if (!r) { setExportMsg('Export failed: no response from the application.'); return }
      if (r.canceled) return
      if (!r.ok) { setExportMsg('Export failed: ' + r.error); return }
      if (!r.tables) { setExportMsg('No tables found.'); return }
      const where = r.files.length === 1
        ? `to ${r.files[0]}`
        : `to ${r.files.length} files (too large for one workbook): ${r.files.join(', ')}`
      const cut = r.cutCells ? ` ${r.cutCells} cell(s) longer than Excel allows were shortened and marked "[cut …]".` : ''
      setExportMsg(`Exported ${r.tables} tables (${r.rows.toLocaleString('en-IN')} rows) ${where}.${cut}`)
    } catch (err) {
      setExportMsg('Export failed: ' + (err?.message || err))
    } finally {
      setExporting(false)
    }
  }

  // Bundled statutory reference: blank BS/PL/Notes shape for all three
  // constitutions plus every Fill-Details form shown as if completed —
  // ships alongside the app so it's available without network access.
  const handleDownloadFormatReference = async () => {
    setRefExporting(true); setRefExportMsg('')
    try {
      const r = await window.api?.getFormatReference()
      if (!r?.ok) { setRefExportMsg(r?.error || 'Reference file not found.'); return }
      const result = await window.api?.saveFileDialog({
        defaultPath: 'FSG_Bharat_Prescribed_Format_Reference.html',
        filters: [{ name: 'HTML Document', extensions: ['html'] }],
      })
      if (result?.filePath) {
        const bytes = Array.from(new TextEncoder().encode(r.html))
        await window.api?.writeFile(result.filePath, bytes)
        setRefExportMsg(`Saved to ${result.filePath}`)
      }
    } catch (err) {
      setRefExportMsg('Download failed: ' + (err?.message || err))
    } finally {
      setRefExporting(false)
    }
  }

  const field = (label, key, type='text', placeholder='') => (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <input
        type={type}
        value={cfg[key]}
        onChange={e => set(key, type === 'number' ? parseInt(e.target.value) : e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handleSave()}
        placeholder={placeholder}
        className="w-full border border-gray-300 rounded px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
      />
    </div>
  )

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box max-w-md" ref={containerRef} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-blue-900">PostgreSQL Connection</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>
        <div className="space-y-3">
          {field('Host', 'host', 'text', 'localhost or server IP')}
          {field('Port', 'port', 'number', '5432')}
          {field('Database Name', 'database', 'text', 'vera_financial')}
          {field('Username', 'user', 'text', 'postgres')}
          {field('Password', 'password', 'password', '')}
        </div>

        {status && (
          <p className={`mt-3 text-sm ${status === 'ok' ? 'text-green-600' : 'text-red-500'}`}>{msg}</p>
        )}

        <div className="flex gap-2 mt-5">
          <button
            onClick={handleTest}
            disabled={testing}
            className="flex-1 py-2 border border-blue-600 text-blue-700 rounded font-medium text-sm hover:bg-blue-50 transition disabled:opacity-40"
          >
            {testing ? 'Testing…' : 'Test Connection'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-2 bg-blue-700 text-white rounded font-medium text-sm hover:bg-blue-800 transition disabled:opacity-40"
            title="Save & Connect (Ctrl+Enter)"
          >
            {saving ? 'Connecting…' : 'Save & Connect'}
          </button>
        </div>
        <p className="text-xs text-gray-400 text-center mt-2">Ctrl+Enter to save · Esc to close</p>

        <div className="mt-5 pt-4 border-t border-gray-200">
          <div className="text-xs font-semibold text-gray-600 uppercase mb-1">Database Export</div>
          <p className="text-xs text-gray-400 mb-2">
            Downloads every table in the local database as one Excel workbook, one sheet per table — a full
            snapshot for backup, audit, or debugging.
          </p>
          <button
            onClick={handleExportAllTables}
            disabled={exporting}
            className="w-full py-2 border border-gray-300 text-gray-700 rounded font-medium text-sm hover:bg-gray-50 transition disabled:opacity-40"
          >
            {exporting ? 'Exporting…' : '↓ Download All Tables (Excel)'}
          </button>
          {exportMsg && <p className="text-xs text-gray-500 mt-2 break-words">{exportMsg}</p>}
        </div>

        <div className="mt-5 pt-4 border-t border-gray-200">
          <div className="text-xs font-semibold text-gray-600 uppercase mb-1">Prescribed Format Reference</div>
          <p className="text-xs text-gray-400 mb-2">
            Blank BS, PL and Notes shape for all three constitutions, plus every Fill-Details form shown as if
            completed — a statutory-format checklist to verify saved output against.
          </p>
          <button
            onClick={handleDownloadFormatReference}
            disabled={refExporting}
            className="w-full py-2 border border-gray-300 text-gray-700 rounded font-medium text-sm hover:bg-gray-50 transition disabled:opacity-40"
          >
            {refExporting ? 'Preparing…' : '↓ Download Format Reference (HTML)'}
          </button>
          {refExportMsg && <p className="text-xs text-gray-500 mt-2 break-words">{refExportMsg}</p>}
        </div>
      </div>
    </div>
  )
}
