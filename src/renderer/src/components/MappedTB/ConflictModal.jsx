import React, { useState } from 'react'
import { useModalKeys } from '../../hooks/useModalKeys'

export default function ConflictModal({ row, onResolve, onClose }) {
  const candidates = row.conflict_candidates || []
  const stage = row.conflict_stage || 2
  const [selected, setSelected] = useState(null)
  const [saving, setSaving] = useState(false)

  const handleResolve = async () => {
    if (!selected || saving) return
    setSaving(true)
    try { await onResolve(row.id, selected) }
    finally { setSaving(false) }
  }

  const containerRef = useModalKeys({ onClose, onConfirm: handleResolve })

  // Arrow up/down to move selection within candidates
  const handleKeyDown = (e, candidate) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setSelected(candidate)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box max-w-2xl" ref={containerRef} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="bg-purple-100 text-purple-800 text-xs font-semibold px-2 py-0.5 rounded-full">
              Stage {stage} Conflict
            </span>
            <h2 className="text-base font-bold text-gray-900">Resolve Mapping Conflict</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>

        {/* Ledger info */}
        <div className="bg-blue-50 rounded-lg px-4 py-3 mb-4">
          <div className="text-xs text-gray-500 mb-0.5">Ledger</div>
          <div className="font-semibold text-blue-900">{row.name}</div>
          {row.ledger_code && <div className="text-xs text-gray-400 mt-0.5">Code: {row.ledger_code}</div>}
          <div className="flex gap-4 mt-2 text-xs text-gray-500">
            <span>Group: <strong>{row.group_parent || '—'}</strong></span>
            <span>Mapping 1: <strong className="text-blue-700">{row.mapping1_resultant || '—'}</strong></span>
            {row.mapping2_resultant && (
              <span>Mapping 2: <strong className="text-blue-700">{row.mapping2_resultant}</strong></span>
            )}
          </div>
        </div>

        <p className="text-sm text-gray-600 mb-3">
          {stage === 2
            ? `The ledger name matches ${candidates.length} different categories. Select the correct one:`
            : `Within ${row.mapping2_resultant}, the ledger matches ${candidates.length} specific line items. Select the correct one:`
          }
        </p>

        {/* Candidate options */}
        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {candidates.map((c, i) => {
            const isSelected = selected === c
            const label = stage === 2 ? c.mapping2_resultant : c.mapping3_resultant
            return (
              <button
                key={i}
                onClick={() => setSelected(c)}
                onKeyDown={(e) => handleKeyDown(e, c)}
                className={`w-full text-left rounded-lg border-2 px-4 py-3 transition focus:outline-none focus:ring-2 focus:ring-blue-400 ${
                  isSelected
                    ? 'border-blue-600 bg-blue-50'
                    : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                    isSelected ? 'border-blue-600 bg-blue-600' : 'border-gray-400'
                  }`}>
                    {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-gray-900 text-sm">{label}</div>
                    {stage === 2 && (
                      <div className="text-xs text-gray-500 mt-0.5">
                        Under: <span className="text-blue-700">{c.mapping1_resultant}</span>
                      </div>
                    )}
                    {c.matched_keywords?.length > 0 && (
                      <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                        <span className="text-xs text-gray-400">Matched:</span>
                        {c.matched_keywords.map(kw => (
                          <span key={kw} className="text-xs bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-medium">
                            {kw}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        {/* Actions */}
        <div className="flex gap-2 mt-4">
          <button
            onClick={onClose}
            className="flex-1 py-2 border border-gray-300 text-gray-600 rounded text-sm hover:bg-gray-50 transition"
          >
            Cancel
          </button>
          <button
            onClick={handleResolve}
            disabled={!selected || saving}
            className="flex-1 py-2 text-white rounded text-sm font-medium hover:opacity-90 disabled:opacity-40 transition" style={{ background: 'var(--color-primary)' }}
            title="Confirm Selection (Ctrl+Enter)"
          >
            {saving ? 'Resolving…' : 'Confirm Selection'}
          </button>
        </div>
        <p className="text-xs text-gray-400 text-center mt-2">Ctrl+Enter to confirm · Esc to cancel</p>
      </div>
    </div>
  )
}
