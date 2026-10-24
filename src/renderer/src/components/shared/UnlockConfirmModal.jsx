import React, { useState } from 'react'
import { useModalKeys } from '../../hooks/useModalKeys'

/**
 * Two-step "stricter" confirmation for unlocking a Financial Period.
 * Step 1: standard confirm. Step 2: type the exact confirmation word to enable Unlock.
 */
export default function UnlockConfirmModal({ periodLabel, onConfirm, onClose }) {
  const [step, setStep] = useState(1)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const CONFIRM_WORD = 'UNLOCK'

  const doConfirm = async () => {
    if (step === 1) { setStep(2); return }
    if (typed.trim().toUpperCase() !== CONFIRM_WORD) return
    setBusy(true)
    try { await onConfirm() } finally { setBusy(false) }
  }
  const containerRef = useModalKeys({ onClose, onConfirm: doConfirm })

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box max-w-md" ref={containerRef} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-red-700">⚠ Unlock Financial Period</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>

        {step === 1 ? (
          <>
            <p className="text-sm text-gray-700 mb-4">
              You are about to unlock <strong>{periodLabel}</strong>. This will allow Categorisation and Mapping
              changes to be made again for this Financial Period. Any changes you make afterward will not affect
              other, still-locked periods.
            </p>
            <div className="flex gap-2">
              <button onClick={onClose} className="flex-1 py-2 border border-gray-300 text-gray-600 rounded text-sm hover:bg-gray-50">Cancel</button>
              <button onClick={doConfirm} className="flex-1 py-2 bg-red-600 text-white rounded text-sm font-medium hover:bg-red-700">Continue</button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-700 mb-2">
              This is a finalized, locked period. To confirm, type <strong>{CONFIRM_WORD}</strong> below.
            </p>
            <input
              type="text"
              autoFocus
              value={typed}
              onChange={e => setTyped(e.target.value)}
              placeholder={CONFIRM_WORD}
              className="w-full border border-red-300 rounded px-3 py-2 text-sm mb-4 text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-red-400"
            />
            <div className="flex gap-2">
              <button onClick={onClose} className="flex-1 py-2 border border-gray-300 text-gray-600 rounded text-sm hover:bg-gray-50">Cancel</button>
              <button
                onClick={doConfirm}
                disabled={busy || typed.trim().toUpperCase() !== CONFIRM_WORD}
                className="flex-1 py-2 bg-red-600 text-white rounded text-sm font-medium hover:bg-red-700 disabled:opacity-40"
              >
                {busy ? 'Unlocking...' : 'Unlock Period'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
