import { useState, useEffect, useCallback } from 'react'

/**
 * Previous Year figures for one Auditee<->Financial Year (entity_periods.py_mode):
 *   'required'  - the default: how the app has always worked
 *   'none_show' - not required; the Previous Year column stays, all dashes
 *   'none_hide' - not required; the Previous Year column is left out
 * A first-year entity has no Previous Year; some years the comparative is simply not wanted.
 * Read and written through the entity period, so every statement of that year follows it.
 */
export function usePYMode(entityPeriodId) {
  const [mode, setModeState] = useState('required')

  useEffect(() => {
    let alive = true
    if (!entityPeriodId) { setModeState('required'); return undefined }
    Promise.resolve(window.api?.getEntityPeriod?.(entityPeriodId))
      .then(ep => { if (alive) setModeState(ep?.py_mode === 'none_show' || ep?.py_mode === 'none_hide' ? ep.py_mode : 'required') })
      .catch(() => {})
    return () => { alive = false }
  }, [entityPeriodId])

  // Throws (the caller tells the user) when the year is locked.
  const setMode = useCallback(async (next) => {
    if (!entityPeriodId) return
    await window.api?.setEntityPeriodPYMode(entityPeriodId, next)
    setModeState(next)
  }, [entityPeriodId])

  return { mode, setMode }
}
