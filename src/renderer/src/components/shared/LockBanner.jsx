import React, { useState, useEffect } from 'react'
import UnlockConfirmModal from './UnlockConfirmModal'

/**
 * Shows a "this Financial Period is locked" banner with an Unlock action,
 * when the active TB's entity_period is locked. Renders nothing otherwise.
 * Used in Categorisation and Mapped TB toolbars (per user's "both places" —
 * the other trigger point is the Master tab itself).
 */
export default function LockBanner({ entity, activeTB, onUnlocked }) {
  const [period, setPeriod] = useState(null)
  const [showUnlock, setShowUnlock] = useState(false)

  useEffect(() => {
    if (!entity?.id || !activeTB?.entity_period_id) { setPeriod(null); return }
    window.api?.listEntityPeriods(entity.id)
      .then(list => setPeriod((list || []).find(p => p.id === activeTB.entity_period_id) || null))
      .catch(() => setPeriod(null))
  }, [entity?.id, activeTB?.entity_period_id, activeTB?.id])

  if (!period?.locked) return null

  const doUnlock = async () => {
    await window.api?.unlockEntityPeriod(period.id)
    setPeriod(p => ({ ...p, locked: 0 }))
    setShowUnlock(false)
    onUnlocked?.()
  }

  return (
    <>
      <div className="flex items-center gap-3 px-4 py-2 bg-red-50 border-b border-red-200 text-xs shrink-0">
        <span className="text-red-700 font-semibold">
          🔒 Locked — {period.year_label} ({period.date_from} To {period.date_till}) is locked. No Categorisation or Mapping changes are allowed.
        </span>
        <button onClick={() => setShowUnlock(true)} className="ml-auto px-2.5 py-1 text-xs border border-red-400 text-red-700 rounded hover:bg-red-100 font-medium">
          Unlock
        </button>
      </div>
      {showUnlock && (
        <UnlockConfirmModal
          periodLabel={`${period.year_label} (${period.date_from} To ${period.date_till})`}
          onConfirm={doUnlock}
          onClose={() => setShowUnlock(false)}
        />
      )}
    </>
  )
}
