import React, { useState, useEffect, useMemo } from 'react'
import { useModalKeys } from '../../hooks/useModalKeys'
import RowActionButton from './RowActionButton'

/**
 * "Select" / "Delete" flyout action — a compact, alphabetical, searchable
 * list of all Auditees, smaller than the viewport.
 */
export default function AuditeeListModal({ mode = 'select', onSelect, onDeleted, onEdit, onDetails, onClose, embedded = false, selectedId }) {
  const [entities, setEntities] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [deletingId, setDeletingId] = useState(null)

  const load = () => {
    setLoading(true)
    window.api?.getEntities()
      .then(list => setEntities((list || []).slice().sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => setError('Failed to load Auditees.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const containerRef = useModalKeys({ onClose, enabled: !embedded })

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return entities
    return entities.filter(e => e.name.toLowerCase().includes(q))
  }, [entities, search])

  const handleDelete = async (e) => {
    const ok = window.confirm(
      `Delete Auditee "${e.name}"?\n\nThis will delete its trial balances, mappings, notes, remarks, depreciation schedules, auditors, signatories, and Financial Period attachments. This action cannot be undone.`
    )
    if (!ok) return
    setDeletingId(e.id)
    setError('')
    try {
      await window.api?.deleteEntity(e.id)
      setEntities(prev => prev.filter(x => x.id !== e.id))
      onDeleted?.(e)
    } catch (err) {
      setError(err.message || 'Failed to delete.')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className={embedded ? 'w-full' : 'modal-backdrop'} onClick={embedded ? undefined : onClose}>
      <div
        className={embedded
          ? 'flex min-h-[220px] flex-col rounded-xl border border-gray-200 bg-white p-4 sm:p-5'
          : 'bg-white rounded-xl shadow-2xl p-6 flex flex-col'}
        style={embedded ? undefined : { width: '520px', maxWidth: '90vw', maxHeight: '80vh' }}
        ref={containerRef}
        onClick={embedded ? undefined : e => e.stopPropagation()}
      >
        {!embedded && (
          <div className="flex items-center justify-between mb-4 shrink-0">
            <h2 className="text-base font-bold text-blue-900">
              {mode === 'delete' ? 'Delete an Auditee' : 'Select Auditee'}
            </h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
          </div>
        )}

        <div className="mb-3 flex shrink-0 items-center gap-3">
          <input
            type="text"
            autoFocus={!embedded}
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search auditees..."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          {embedded && <span className="whitespace-nowrap text-xs text-gray-500">{entities.length} {entities.length === 1 ? 'auditee' : 'auditees'}</span>}
        </div>

        {error && <p className="text-red-500 text-xs mb-2 shrink-0">{error}</p>}

        <div className={`${embedded ? 'flex-1' : 'flex-1 overflow-y-auto -mx-2 px-2'}`}>
          {loading ? (
            <p className="text-gray-400 text-sm py-6 text-center">Loading auditees...</p>
          ) : visible.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-200 py-10 text-center">
              <p className="text-sm font-medium text-gray-700">{entities.length === 0 ? 'No auditees yet' : 'No matching auditees'}</p>
              <p className="mt-1 text-xs text-gray-500">{entities.length === 0 ? 'Use + above to create an auditee.' : 'Try a different search.'}</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {visible.map(e => (
                <li key={e.id} className={`flex items-center justify-between gap-3 rounded-lg px-2 py-3 transition ${selectedId === e.id ? 'bg-blue-50/70' : 'hover:bg-gray-50'}`}>
                  {embedded ? (
                    <button
                      type="button"
                      onClick={() => onSelect?.(e)}
                      aria-current={selectedId === e.id ? 'true' : undefined}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate text-sm font-semibold text-gray-900">{e.name}</span>
                      <span className="mt-0.5 block truncate text-xs text-gray-500">
                        {[e.constitution_display, e.business_type, e.has_branches ? 'Branches' : null].filter(Boolean).join(' · ')}
                      </span>
                    </button>
                  ) : (
                    <div>
                      <div className="text-sm font-medium text-gray-800">{e.name}</div>
                      <div className="text-xs text-gray-400">{e.constitution_display}{e.business_type ? ` · ${e.business_type}` : ''}</div>
                    </div>
                  )}
                  <div className="flex shrink-0 items-center">
                    {!embedded && mode === 'delete' ? (
                      <button
                        onClick={() => handleDelete(e)}
                        disabled={deletingId === e.id}
                        className="px-3 py-1 text-xs border border-red-300 text-red-700 rounded hover:bg-red-50 disabled:opacity-40"
                      >
                        {deletingId === e.id ? 'Deleting...' : 'Delete'}
                      </button>
                    ) : !embedded ? (
                      <button
                        onClick={() => onSelect?.(e)}
                        className="px-3 py-1 text-xs bg-blue-700 text-white rounded hover:bg-blue-800"
                      >
                        Select
                      </button>
                    ) : (
                      <>
                        {selectedId === e.id && <span className="mr-2 rounded-full bg-blue-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-blue-800">Selected</span>}
                        <RowActionButton action="edit" onClick={() => onEdit?.(e)} />
                        <RowActionButton action="info" onClick={() => onDetails?.(e)} />
                        <RowActionButton action="delete" onClick={() => handleDelete(e)} disabled={deletingId === e.id} />
                      </>
                    )}
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
