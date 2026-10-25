import React, { useState, useEffect } from 'react'
import { useModalKeys } from '../../hooks/useModalKeys'
import RowActionButton from './RowActionButton'
import { formatPeriodRange } from '../../utils/financialPeriodDisplay'

function PeriodForm({ editing, onSaved, onCancel }) {
  const [yearLabel, setYearLabel] = useState(editing?.year_label || '')
  const [dateFrom, setDateFrom] = useState(editing?.date_from || '')
  const [dateTill, setDateTill] = useState(editing?.date_till || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const submit = async () => {
    setErr('')
    if (!yearLabel.trim() || !dateFrom || !dateTill) { setErr('All fields are required.'); return }
    setSaving(true)
    try {
      const saved = await window.api?.saveFinancialPeriod({
        id: editing?.id, year_label: yearLabel.trim(), date_from: dateFrom, date_till: dateTill,
      })
      onSaved(saved)
    } catch (e) {
      setErr(e.message || 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border border-blue-200 rounded-lg p-3 mb-3 bg-blue-50/40">
      <div className="text-xs font-semibold text-blue-900 mb-2">{editing ? 'Edit Financial Period' : 'New Financial Period'}</div>
      <div className="grid grid-cols-3 gap-2 mb-2">
        <input value={yearLabel} onChange={e => setYearLabel(e.target.value)} placeholder="Year label e.g. FY 2025-26"
          className="col-span-3 border border-gray-300 rounded px-2 py-1.5 text-xs bg-white" autoFocus />
        <div>
          <label className="block text-[10px] text-gray-500 mb-0.5">Date From</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white" />
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 mb-0.5">Date Till</label>
          <input type="date" value={dateTill} onChange={e => setDateTill(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white" />
        </div>
      </div>
      {err && <p className="text-red-500 text-xs mb-2">{err}</p>}
      <div className="flex gap-2">
        <button onClick={onCancel} className="px-3 py-1.5 border border-gray-300 text-gray-600 rounded text-xs hover:bg-gray-50">Cancel</button>
        <button onClick={submit} disabled={saving} className="px-3 py-1.5 bg-blue-700 text-white rounded text-xs font-medium hover:bg-blue-800 disabled:opacity-40">
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  )
}

export default function FinancialPeriodManageModal({ startInCreate = false, onClose, embedded = false }) {
  const [periods, setPeriods] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null)     // period being edited, or {} for new
  const [error, setError] = useState('')
  const containerRef = useModalKeys({ onClose, enabled: !embedded })

  const load = () => {
    setLoading(true)
    window.api?.listFinancialPeriods()
      .then(list => setPeriods(list || []))
      .catch(() => setError('Failed to load Financial Periods.'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])
  useEffect(() => { if (startInCreate) setEditing({}) }, [startInCreate])

  const visible = periods.filter(p => !search.trim() || p.year_label.toLowerCase().includes(search.trim().toLowerCase()))

  const handleDelete = async (p) => {
    if (!window.confirm(`Delete Financial Period "${p.year_label}"?`)) return
    setError('')
    try {
      await window.api?.deleteFinancialPeriod(p.id)
      setPeriods(prev => prev.filter(x => x.id !== p.id))
    } catch (e) {
      setError(e.message || 'Failed to delete.')
    }
  }

  return (
    <div className={embedded ? 'w-full' : 'modal-backdrop'} onClick={embedded ? undefined : onClose}>
      <div
        className={embedded
          ? 'flex min-h-[220px] flex-col rounded-xl border border-gray-200 bg-white p-4 sm:p-5'
          : 'bg-white rounded-xl shadow-2xl p-6 flex flex-col'}
        style={embedded ? undefined : { width: '560px', maxWidth: '90vw', maxHeight: '82vh' }}
        ref={containerRef}
        onClick={embedded ? undefined : e => e.stopPropagation()}
      >
        {!embedded && (
          <div className="flex items-center justify-between mb-4 shrink-0">
            <h2 className="text-base font-bold text-blue-900">Financial Periods</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
          </div>
        )}

        {editing ? (
          <PeriodForm
            editing={editing.id ? editing : null}
            onSaved={() => { setEditing(null); load(); if (embedded) onClose?.() }}
            onCancel={() => { setEditing(null); if (embedded) onClose?.() }}
          />
        ) : (
          <div className="mb-3 flex shrink-0 items-center gap-2">
            {embedded && <p className="text-sm font-medium text-gray-700">{visible.length} {visible.length === 1 ? 'period' : 'periods'}</p>}
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search financial periods..."
              className="ml-auto max-w-sm flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            {!embedded && (
              <button
                onClick={() => setEditing({})}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-800 whitespace-nowrap"
              >
                <span aria-hidden="true" className="text-lg leading-none">+</span> Add period
              </button>
            )}
          </div>
        )}

        {error && <p className="text-red-500 text-xs mb-2 shrink-0">{error}</p>}

        <div className={`${embedded ? 'flex-1' : 'flex-1 overflow-y-auto -mx-2 px-2'}`}>
          {loading ? (
            <p className="text-gray-400 text-sm py-6 text-center">Loading financial periods...</p>
          ) : visible.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-200 py-10 text-center">
              <p className="text-sm font-medium text-gray-700">{search ? 'No matching financial periods' : 'No financial periods yet'}</p>
              <p className="mt-1 text-xs text-gray-500">{search ? 'Try a different search.' : 'Add a period to make it available for reporting.'}</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {visible.map(p => (
                <li key={p.id} className="flex items-center justify-between py-2.5 px-1 hover:bg-gray-50 rounded">
                  <div>
                    <div className="text-sm font-medium text-gray-800">{p.year_label}</div>
                    <div className="text-xs text-gray-400">{formatPeriodRange(p.date_from, p.date_till, ' to ')}</div>
                  </div>
                  <div className="flex items-center">
                    <RowActionButton action="edit" onClick={() => setEditing(p)} />
                    <RowActionButton action="delete" onClick={() => handleDelete(p)} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {!embedded && <p className="text-xs text-gray-400 text-center mt-3 shrink-0">Esc to close</p>}
      </div>
    </div>
  )
}
