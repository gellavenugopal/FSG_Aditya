import React, { useState } from 'react'
import OverrideModal from './OverrideModal'
import { useModalKeys } from '../../hooks/useModalKeys'

/**
 * BulkOverrideModal
 * Step 1: Ask user — same mapping for all, or one by one
 * Step 2a (same): Single OverrideModal → apply to all selected ids
 * Step 2b (one-by-one): OverrideModal per row, with progress indicator
 */
export default function BulkOverrideModal({ selectedRows, entity, rsId = null, onDone, onClose }) {
  const [mode, setMode]       = useState(null)     // null | 'same' | 'onebyone'
  const [index, setIndex]     = useState(0)        // for one-by-one
  const [saving, setSaving]   = useState(false)
  const [progress, setProgress] = useState(0)

  const count = selectedRows.length

  // ── Step 1: Mode selection ────────────────────────────────────────────────
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const step1Ref = useModalKeys({ onClose })

  if (!mode) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal-box max-w-md" ref={step1Ref} onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-blue-900">Override {count} Selected Ledger{count > 1 ? 's' : ''}</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
          </div>

          <p className="text-sm text-gray-600 mb-5">How would you like to override the selected ledgers?</p>

          <div className="space-y-3">
            <button
              onClick={() => setMode('same')}
              className="w-full text-left border-2 border-gray-200 hover:border-blue-500 hover:bg-blue-50 rounded-lg px-4 py-4 transition"
            >
              <div className="font-semibold text-gray-900 text-sm mb-1">
                Apply same mapping to all {count} ledger{count > 1 ? 's' : ''}
              </div>
              <div className="text-xs text-gray-500">
                One mapping selection — applied identically to every selected ledger. Faster for batch corrections.
              </div>
            </button>

            <button
              onClick={() => setMode('onebyone')}
              className="w-full text-left border-2 border-gray-200 hover:border-blue-500 hover:bg-blue-50 rounded-lg px-4 py-4 transition"
            >
              <div className="font-semibold text-gray-900 text-sm mb-1">
                Override one by one ({count} ledger{count > 1 ? 's' : ''})
              </div>
              <div className="text-xs text-gray-500">
                Review and assign a different mapping for each ledger individually.
              </div>
            </button>
          </div>

          <button
            onClick={onClose}
            className="w-full mt-3 py-2 border border-gray-300 text-gray-600 rounded text-sm hover:bg-gray-50 transition"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  // ── Step 2a: Same mapping for all ────────────────────────────────────────
  if (mode === 'same') {
    return (
      <OverrideModal
        row={{ ...selectedRows[0], name: `${count} selected ledgers` }}
        entity={entity}
        rsId={rsId}
        headerNote={`This mapping will be applied to all ${count} selected ledgers.`}
        onSave={async (_, data) => {
          setSaving(true)
          const ids = selectedRows.map(r => r.id)
          await window.api?.overrideMany(ids, data)
          onDone()
        }}
        onClose={onClose}
        saving={saving}
      />
    )
  }

  // ── Step 2b: One by one ───────────────────────────────────────────────────
  if (mode === 'onebyone') {
    if (index >= count) {
      // All done
      return (
        <div className="modal-backdrop">
          <div className="modal-box max-w-sm text-center">
            <div className="text-green-600 text-4xl mb-3">✓</div>
            <h2 className="text-base font-bold text-gray-900 mb-2">All {count} ledgers overridden</h2>
            <button
              onClick={onDone}
              className="w-full py-2 text-white rounded text-sm font-medium hover:opacity-90 transition" style={{ background: 'var(--color-primary)' }}
            >
              Done
            </button>
          </div>
        </div>
      )
    }

    const currentRow = selectedRows[index]

    return (
      <OverrideModal
        row={currentRow}
        entity={entity}
        rsId={rsId}
        headerNote={
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span>Ledger {index + 1} of {count}</span>
            <div className="flex-1 bg-gray-200 rounded-full h-1.5">
              <div
                className="bg-blue-600 h-1.5 rounded-full transition-all"
                style={{ width: `${((index) / count) * 100}%` }}
              />
            </div>
          </div>
        }
        onSave={async (id, data) => {
          setSaving(true)
          await window.api?.overrideRow(id, data)
          setSaving(false)
          setIndex(i => i + 1)
        }}
        onClose={() => {
          // Skip current, go to next
          if (index + 1 >= count) onDone()
          else setIndex(i => i + 1)
        }}
        closeLabel="Skip"
        saving={saving}
      />
    )
  }

  return null
}
