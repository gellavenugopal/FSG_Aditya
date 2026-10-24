import { useState, useEffect, useCallback } from 'react'

const CONSOLIDATED_TB_ID = '__consolidated__'

/**
 * Manual Previous Year entry — one flag + one set of lines per TB, shared by
 * the BS, PL, and Notes screens. All three read/write the exact same
 * underlying value (trial_balances.manual_py / manual_py_lines), so ticking
 * it on in any one screen is reflected in the other two the next time they
 * read it (each screen re-fetches via useFinancials, which reads the same
 * flag — see fetchFinancialsData in useFinancials.js).
 *
 * `entityId`: required only when `tbId` is the virtual Consolidated TB
 * ('__consolidated__', not a real trial_balances id) — a branch entity's
 * Consolidated view. There is no real TB row to hang manual_py off there, so
 * this routes to the entity-scoped mirror table instead (see schema.js's
 * entity_manual_py_entries). Every caller (ManualPYButton, Notes' inline PY
 * cells) already receives `entity` as a prop, so this needs no plumbing
 * beyond passing entity?.id through.
 */
export function useManualPY(tbId, entityId) {
  const isConsolidated = tbId === CONSOLIDATED_TB_ID
  const [enabled, setEnabledState] = useState(false)
  const [lines, setLines] = useState([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(() => {
    if (isConsolidated ? !entityId : !tbId) { setEnabledState(false); setLines([]); return }
    setLoading(true)
    const getEnabled = isConsolidated ? window.api?.getEntityManualPY?.(entityId) : window.api?.getManualPY?.(tbId)
    Promise.all([
      getEnabled ?? false,
    ]).then(([en]) => {
      setEnabledState(!!en)
    }).finally(() => setLoading(false))
  }, [tbId, entityId, isConsolidated])

  useEffect(() => { refresh() }, [refresh])

  const setEnabled = useCallback(async (next) => {
    if (isConsolidated ? !entityId : !tbId) return
    setEnabledState(next)
    if (isConsolidated) await window.api?.setEntityManualPY?.(entityId, next)
    else await window.api?.setManualPY?.(tbId, next)
  }, [tbId, entityId, isConsolidated])

  return { enabled, setEnabled, lines, loading, refresh }
}
