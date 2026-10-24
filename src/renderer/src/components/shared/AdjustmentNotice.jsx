import React, { useState, useEffect } from 'react'

const inr = (n) => (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * One line above the statement / note / check screens when the Trial Balance behind them carries
 * Adjustments (Mapped TB: Adjustments (Debit) / (Credit)). Every figure those screens show is built
 * from the REVISED closing balance, so it says so - and turns red when the revised Trial Balance
 * no longer balances, since the Balance Sheet will not tally either. Renders nothing otherwise.
 *
 * `activeTB` may be the virtual Consolidated TB ('__consolidated__'): then the Auditee's Trial
 * Balances are counted together, as the Consolidated figures are built from all of them.
 */
export default function AdjustmentNotice({ entity, activeTB, prevTB, refreshKey, onOpen }) {
  const [sum, setSum] = useState(null)
  const [pySum, setPySum] = useState(null)
  const tbId = activeTB?.id
  const entityId = activeTB?.entity_id ?? entity?.id
  const pyId = prevTB?.id

  useEffect(() => {
    if (!tbId) { setSum(null); return }
    let alive = true
    const arg = tbId === '__consolidated__' ? { entityId } : tbId
    Promise.resolve(window.api?.getAdjustmentSummary?.(arg))
      .then(s => { if (alive) setSum(s || null) }).catch(() => { if (alive) setSum(null) })
    return () => { alive = false }
  }, [tbId, entityId, refreshKey])

  useEffect(() => {
    if (!pyId || tbId === '__consolidated__') { setPySum(null); return }
    let alive = true
    Promise.resolve(window.api?.getAdjustmentSummary?.(pyId))
      .then(s => { if (alive) setPySum(s || null) }).catch(() => { if (alive) setPySum(null) })
    return () => { alive = false }
  }, [pyId, tbId, refreshKey])

  const n = sum?.rows_adjusted || 0, nPy = pySum?.rows_adjusted || 0
  if (!n && !nPy) return null
  const out = (n && !sum.revised_balanced) || (nPy && !pySum.revised_balanced)

  return (
    <div className={`flex items-center gap-x-3 gap-y-1 flex-wrap px-4 py-1.5 border-b text-xs shrink-0 ${out ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
      <span className="font-semibold">{out ? '⚠' : 'ℹ'} Trial Balance adjustments are applied.</span>
      {n > 0 && (
        <span>
          Current Year: {n} ledger{n === 1 ? '' : 's'} adjusted (Dr {inr(sum.total_debit)} · Cr {inr(sum.total_credit)}) — every figure here is after them.
          {!sum.revised_balanced && <strong> The revised Trial Balance is out of balance by {inr(Math.abs(sum.revised_sum))}.</strong>}
        </span>
      )}
      {nPy > 0 && (
        <span>
          Previous Year Trial Balance: {nPy} ledger{nPy === 1 ? '' : 's'} adjusted.
          {!pySum.revised_balanced && <strong> It is out of balance by {inr(Math.abs(pySum.revised_sum))}.</strong>}
        </span>
      )}
      {onOpen && <button onClick={onOpen} className="ml-auto px-2 py-0.5 border border-current rounded hover:bg-white/60">View in Mapped TB</button>}
    </div>
  )
}
