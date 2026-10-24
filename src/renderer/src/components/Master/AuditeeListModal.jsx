import React, { useState, useEffect, useMemo } from 'react'
import { useModalKeys } from '../../hooks/useModalKeys'

/**
 * "Select" / "Delete" flyout action — a compact, alphabetical, searchable
 * list of all Auditees, smaller than the viewport.
 */
export default function AuditeeListModal({ mode = 'select', onSelect, onDeleted, onClose }) {
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

  const containerRef = useModalKeys({ onClose })

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
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl p-6 flex flex-col"
        style={{ width: '520px', maxWidth: '90vw', maxHeight: '80vh' }}
        ref={containerRef}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4 shrink-0">
          <h2 className="text-base font-bold text-blue-900">
            {mode === 'delete' ? 'Delete an Auditee' : 'Select Auditee'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        <input
          type="text"
          autoFocus
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search Auditees..."
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm mb-3 text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 shrink-0"
        />

        {error && <p className="text-red-500 text-xs mb-2 shrink-0">{error}</p>}

        <div className="flex-1 overflow-y-auto -mx-2 px-2">
          {loading ? (
            <p className="text-gray-400 text-sm py-6 text-center">Loading...</p>
          ) : visible.length === 0 ? (
            <p className="text-gray-400 text-sm py-6 text-center">
              {entities.length === 0 ? 'No Auditees yet. Create one first.' : 'No Auditees match your search.'}
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {visible.map(e => (
                <li key={e.id} className="flex items-center justify-between py-2.5 px-1 hover:bg-gray-50 rounded">
                  <div>
                    <div className="text-sm font-medium text-gray-800">{e.name}</div>
                    <div className="text-xs text-gray-400">{e.constitution_display}{e.business_type ? ` · ${e.business_type}` : ''}</div>
                  </div>
                  {mode === 'delete' ? (
                    <button
                      onClick={() => handleDelete(e)}
                      disabled={deletingId === e.id}
                      className="px-3 py-1 text-xs border border-red-300 text-red-700 rounded hover:bg-red-50 disabled:opacity-40"
                    >
                      {deletingId === e.id ? 'Deleting...' : 'Delete'}
                    </button>
                  ) : (
                    <button
                      onClick={() => onSelect?.(e)}
                      className="px-3 py-1 text-xs bg-blue-700 text-white rounded hover:bg-blue-800"
                    >
                      Select
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="text-xs text-gray-400 text-center mt-3 shrink-0">Esc to close</p>
      </div>
    </div>
  )
}
