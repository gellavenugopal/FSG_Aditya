import { useState, useEffect, useCallback } from 'react'

const CONSOLIDATED_TB_ID = '__consolidated__'

/**
 * "P&L already closed to Capital in Tally" — one flag per TB (see
 * schema.js's trial_balances.pl_closed_to_capital), editable after import
 * too, not just at Tally-connect time. Read by useFinancials.js's
 * fetchFinancialsData to decide whether to skip the automatic Net Profit →
 * Reserves & Surplus/Capital injection (processRows's skipProfitInjection).
 *
 * `entityId`: required only when `tbId` is the virtual Consolidated TB
 * ('__consolidated__', not a real trial_balances id) — a branch entity's
 * Consolidated view. There is no real TB row to hang pl_closed_to_capital off
 * there (plClosedToCapital:get/set run `WHERE id=$1` against an INTEGER
 * column, so '__consolidated__' silently failed every read and write — the
 * toggle looked like it "sometimes did nothing" and never stayed stuck). This
 * routes to the entity-scoped mirror instead — same fix as useManualPY.js.
 */
export function usePlClosedToCapital(tbId, entityId) {
  const isConsolidated = tbId === CONSOLIDATED_TB_ID
  const [enabled, setEnabledState] = useState(false)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(() => {
    if (isConsolidated ? !entityId : !tbId) { setEnabledState(false); return }
    setLoading(true)
    const getEnabled = isConsolidated ? window.api?.getEntityPlClosedToCapital?.(entityId) : window.api?.getPlClosedToCapital?.(tbId)
    Promise.resolve(getEnabled)
      .then(en => setEnabledState(!!en))
      .finally(() => setLoading(false))
  }, [tbId, entityId, isConsolidated])

  useEffect(() => { refresh() }, [refresh])

  const setEnabled = useCallback(async (next) => {
    if (isConsolidated ? !entityId : !tbId) return
    setEnabledState(next)
    if (isConsolidated) await window.api?.setEntityPlClosedToCapital?.(entityId, next)
    else await window.api?.setPlClosedToCapital?.(tbId, next)
  }, [tbId, entityId, isConsolidated])

  return { enabled, setEnabled, loading, refresh }
}
