import { useState, useEffect, useCallback } from 'react'

const CONSOLIDATED_TB_ID = '__consolidated__'

/**
 * Basic/Diluted EPS overrides — 4 numbers per TB (see schema.js's
 * eps_basic_cy comment), one per Current Year / Previous Year x Basic /
 * Diluted cell. Each is independently NULL ("use the auto-computed figure")
 * or a CA-typed override that always wins. Read by PL/index.jsx (Company
 * only) to decide, per cell, whether to show the auto-computed value or the
 * saved override.
 *
 * `entityId`: required only when `tbId` is the virtual Consolidated TB
 * ('__consolidated__') — same entity-scoped-mirror routing as
 * usePlClosedToCapital.js, for the same reason (no real trial_balances row
 * exists for the Consolidated view).
 */
export function useEps(tbId, entityId) {
  const isConsolidated = tbId === CONSOLIDATED_TB_ID
  const [values, setValuesState] = useState({ basicCY: null, basicPY: null, dilutedCY: null, dilutedPY: null })
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(() => {
    if (isConsolidated ? !entityId : !tbId) { setValuesState({ basicCY: null, basicPY: null, dilutedCY: null, dilutedPY: null }); return }
    setLoading(true)
    const getVals = isConsolidated ? window.api?.getEntityEps?.(entityId) : window.api?.getEps?.(tbId)
    Promise.resolve(getVals)
      .then(v => setValuesState({
        basicCY: v?.basicCY ?? null, basicPY: v?.basicPY ?? null,
        dilutedCY: v?.dilutedCY ?? null, dilutedPY: v?.dilutedPY ?? null,
      }))
      .finally(() => setLoading(false))
  }, [tbId, entityId, isConsolidated])

  useEffect(() => { refresh() }, [refresh])

  // `field` is one of 'basicCY'/'basicPY'/'dilutedCY'/'dilutedPY'. `value`
  // null/'' clears the override (reverts that cell to the auto-computed
  // figure); any other value is saved as a permanent override until cleared.
  const setField = useCallback(async (field, value) => {
    if (isConsolidated ? !entityId : !tbId) return
    const parsed = value === '' || value === null || value === undefined ? null : parseFloat(value)
    setValuesState(prev => ({ ...prev, [field]: (parsed === null || isNaN(parsed)) ? null : parsed }))
    if (isConsolidated) await window.api?.setEntityEps?.(entityId, field, parsed === null || isNaN(parsed) ? null : parsed)
    else await window.api?.setEps?.(tbId, field, parsed === null || isNaN(parsed) ? null : parsed)
  }, [tbId, entityId, isConsolidated])

  return { values, setField, loading, refresh }
}
