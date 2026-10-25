import React, { useState, useEffect } from 'react'
import { useModalKeys } from '../../hooks/useModalKeys'
import UnlockConfirmModal from '../shared/UnlockConfirmModal'
import { formatPeriodRange } from '../../utils/financialPeriodDisplay'

export default function AuditeeReadModal({ entity, onClose }) {
  const [periods, setPeriods] = useState([])
  const [loading, setLoading] = useState(true)
  const [unlockTarget, setUnlockTarget] = useState(null)
  const containerRef = useModalKeys({ onClose })

  const load = () => {
    setLoading(true)
    window.api?.listEntityPeriods(entity.id)
      .then(list => setPeriods(list || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [entity?.id])

  const doLock = async (ep) => {
    await window.api?.lockEntityPeriod(ep.id)
    setPeriods(prev => prev.map(p => p.id === ep.id ? { ...p, locked: 1 } : p))
  }
  const doUnlock = async (ep) => {
    await window.api?.unlockEntityPeriod(ep.id)
    setPeriods(prev => prev.map(p => p.id === ep.id ? { ...p, locked: 0 } : p))
    setUnlockTarget(null)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box max-w-lg" ref={containerRef} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-blue-900">Auditee Details</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mb-5">
          <dt className="text-gray-500">Name</dt><dd className="text-gray-900 font-medium">{entity.name}</dd>
          <dt className="text-gray-500">Constitution</dt><dd className="text-gray-900">{entity.constitution_display}</dd>
          <dt className="text-gray-500">Nature of Business</dt><dd className="text-gray-900">{entity.business_type || '—'}</dd>
          <dt className="text-gray-500">Has Branches</dt><dd className="text-gray-900">{entity.has_branches ? 'Yes' : 'No'}</dd>
        </dl>

        <h3 className="text-xs font-semibold text-gray-700 mb-2 border-t border-gray-200 pt-3">Financial Periods</h3>
        {loading ? (
          <p className="text-gray-400 text-xs">Loading...</p>
        ) : periods.length === 0 ? (
          <p className="text-gray-400 text-xs">No Financial Periods attached.</p>
        ) : (
          <ul className="space-y-1.5">
            {periods.map(ep => (
              <li key={ep.id} className="flex items-center justify-between text-xs bg-gray-50 border border-gray-200 rounded px-2.5 py-1.5">
                <span className="text-gray-700">{ep.year_label} ({formatPeriodRange(ep.date_from, ep.date_till, ' to ')})</span>
                {ep.locked ? (
                  <div className="flex items-center gap-2">
                    <span className="text-red-600 font-medium">🔒 Locked</span>
                    <button onClick={() => setUnlockTarget(ep)} className="text-blue-600 hover:underline">Unlock</button>
                  </div>
                ) : (
                  <button onClick={() => doLock(ep)} className="text-gray-500 hover:underline">Lock</button>
                )}
              </li>
            ))}
          </ul>
        )}

        <p className="text-xs text-gray-400 text-center mt-4">Esc to close</p>
      </div>

      {unlockTarget && (
        <UnlockConfirmModal
          periodLabel={`${unlockTarget.year_label} (${formatPeriodRange(unlockTarget.date_from, unlockTarget.date_till, ' to ')})`}
          onConfirm={() => doUnlock(unlockTarget)}
          onClose={() => setUnlockTarget(null)}
        />
      )}
    </div>
  )
}
