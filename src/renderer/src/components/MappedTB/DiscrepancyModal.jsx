import React, { useState } from 'react'
import { useModalKeys } from '../../hooks/useModalKeys'

export default function DiscrepancyModal({ row, onResolve, onClose }) {
  const suggestion = typeof row.discrepancy_suggestion === 'string'
    ? JSON.parse(row.discrepancy_suggestion)
    : row.discrepancy_suggestion

  const [selected, setSelected] = useState(0)
  const [saving, setSaving]     = useState(false)

  if (!suggestion) return null

  const { tally_level1, options } = suggestion

  const handleAccept = async () => {
    if (saving) return
    setSaving(true)
    try { await onResolve(row.id, 'accept', options[selected]) }
    finally { setSaving(false) }
  }

  const handleKeep = async () => {
    if (saving) return
    setSaving(true)
    try { await onResolve(row.id, 'keep', null) }
    finally { setSaving(false) }
  }

  const containerRef = useModalKeys({ onClose, onConfirm: handleAccept })

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box max-w-xl overflow-y-auto max-h-[90vh]" ref={containerRef} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-amber-800">Mapping Discrepancy</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>

        <div className="bg-blue-50 rounded px-3 py-2 mb-4 text-sm">
          <span className="text-gray-500">Ledger: </span>
          <span className="font-semibold text-blue-900">{row.name}</span>
          {row.ledger_code && <span className="text-gray-400 ml-2">({row.ledger_code})</span>}
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded px-3 py-3 mb-4 text-xs text-amber-800 space-y-1">
          <p>
            <strong>Tally Group</strong> places this ledger under{' '}
            <span className="font-semibold text-amber-900">"{tally_level1}"</span>.
          </p>
          <p>
            However, the ledger <strong>name</strong> matches keyword rules that suggest a different
            Level 1 classification. Please choose how to proceed.
          </p>
        </div>

        <p className="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">Name-based suggestions:</p>
        <div className="space-y-2 mb-4">
          {options.map((opt, i) => (
            <label
              key={i}
              className={`flex items-start gap-3 border-2 rounded-lg px-4 py-3 cursor-pointer transition
                ${selected === i ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-300'}`}
            >
              <input
                type="radio"
                name="discrepancy-option"
                checked={selected === i}
                onChange={() => setSelected(i)}
                className="mt-0.5 accent-blue-600"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900">
                  {opt.mapping1} → {opt.mapping2}
                </div>
                {opt.matched_keywords?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {opt.matched_keywords.map(kw => (
                      <span key={kw} className="text-xs bg-amber-100 text-amber-800 rounded px-1.5 py-0.5">
                        {kw}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </label>
          ))}
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleKeep}
            disabled={saving}
            className="flex-1 py-2 border border-gray-300 text-gray-700 rounded text-sm hover:bg-gray-50 disabled:opacity-40 transition"
          >
            Keep Tally Group
          </button>
          <button
            onClick={handleAccept}
            disabled={saving}
            className="flex-1 py-2 text-white rounded text-sm font-medium hover:opacity-90 disabled:opacity-40 transition" style={{ background: 'var(--color-primary)' }}
            title="Accept Suggestion (Ctrl+Enter)"
          >
            {saving ? 'Saving…' : 'Accept Suggestion'}
          </button>
        </div>

        <p className="text-xs text-gray-400 mt-2 text-center">
          Ctrl+Enter to accept suggestion · Esc to close · "Keep Tally Group" marks as Low confidence.
        </p>
      </div>
    </div>
  )
}
