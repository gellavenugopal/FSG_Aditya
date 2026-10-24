import React, { useEffect } from 'react'
import { useManualPY } from '../../hooks/useManualPY'

/**
 * Manual PY on/off toggle for BS/PL/Notes headers — one flag per TB (see
 * useManualPY.js), so ticking it in any one screen is reflected in the
 * other two. The actual PY figures are entered inline in the Notes screen's
 * own table (editable Previous Year cells + "+ Add Row" per note), not here.
 *
 * `disabled`/`disabledTitle`: used for branch entities to enforce "either a
 * real Previous Year Trial Balance is selected, or Manual PY is on — not
 * both" (see BS/PL/Notes' `isBranchEntity` gating).
 * `onEnabledChange`: reports the current enabled flag upward so a parent can
 * gate its own PYTBSelector without needing a second useManualPY instance.
 * `entityId`: only needed when `tbId` is the virtual Consolidated TB
 * ('__consolidated__') — see useManualPY.js.
 */
export default function ManualPYButton({ tbId, entityId, onChanged, disabled = false, disabledTitle, onEnabledChange }) {
  const manualPY = useManualPY(tbId, entityId)

  useEffect(() => {
    onEnabledChange?.(manualPY.enabled)
  }, [manualPY.enabled, onEnabledChange])

  if (!tbId) return null

  const toggle = async () => {
    if (disabled) return
    await manualPY.setEnabled(!manualPY.enabled)
    onChanged?.()
  }

  return (
    <button onClick={toggle}
      disabled={disabled}
      title={disabled
        ? disabledTitle
        : (manualPY.enabled
          ? 'Manual Previous Year entry is ON — edit PY figures inline in the Notes screen'
          : 'Turn on to enter Previous Year figures manually in the Notes screen instead of auto-filling from Opening Balance')}
      className={`text-xs px-2.5 py-1 rounded-full font-medium border transition ${
        disabled ? 'bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed'
        : manualPY.enabled ? 'bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-200'
                          : 'bg-gray-100 text-gray-600 border-gray-300 hover:bg-gray-200'}`}>
      {manualPY.enabled ? '✓ Manual PY' : 'Manual PY'}
    </button>
  )
}
