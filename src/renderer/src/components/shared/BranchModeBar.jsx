import React, { useContext, useEffect, useState } from 'react'
import { ConsolidationContext, resolveConsolidationSelection, loadOverride, saveOverride } from '../../utils/consolidationSelection'

// Under "Consolidated": which Trial Balances are added together for the Current Year and for the Previous Year.
function ConsolidationPicker() {
  const ctx = useContext(ConsolidationContext)
  const [sel, setSel] = useState(null)
  useEffect(() => {
    let dead = false
    if (!ctx?.entityId) return
    resolveConsolidationSelection(ctx.entityId, ctx.entityPeriodId).then(s => { if (!dead) setSel(s) })
    return () => { dead = true }
  }, [ctx?.entityId, ctx?.entityPeriodId, ctx?.consKey])
  if (!ctx?.entityId || !sel || !sel.tbs.length) return null
  const label = (t) => `${t.branch_name || 'TB #' + t.id} (${t.period || 'no period'})`
  const toggle = (side, id) => {
    const cur = side === 'cy' ? sel.cyIds : sel.pyIds
    const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]
    const ov = loadOverride(sel.entityPeriodId)
    // a Trial Balance can be on one side only
    const other = side === 'cy' ? 'py' : 'cy'
    const otherIds = (other === 'cy' ? sel.cyIds : sel.pyIds).filter(x => !next.includes(x))
    saveOverride(sel.entityPeriodId, { ...ov, [side]: next, [other]: otherIds })
    ctx.bump()
  }
  const reset = () => { saveOverride(sel.entityPeriodId, null); ctx.bump() }
  const row = (title, side, ids, hint) => (
    <div className="flex items-center gap-1 px-3 pb-1.5 overflow-x-auto">
      <span className="text-[10px] text-gray-500 font-semibold mr-1 shrink-0">{title}</span>
      {sel.tbs.map(t => (
        <label key={t.id} className={`shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border cursor-pointer ${ids.includes(t.id) ? 'bg-white border-blue-400 text-blue-800' : 'bg-gray-50 border-gray-200 text-gray-400'}`}>
          <input type="checkbox" checked={ids.includes(t.id)} onChange={() => toggle(side, t.id)} />
          {label(t)}
        </label>
      ))}
      <span className="text-[10px] text-gray-400 italic shrink-0 ml-1">{hint}</span>
    </div>
  )
  return (
    <>
      {row('Consolidate Trial Balance (CY):', 'cy', sel.cyIds, 'Current Year figures')}
      {row('Consolidate Trial Balance (PY):', 'py', sel.pyIds, sel.pyIds.length ? 'Previous Year figures' : 'none ticked: opening balances of the current year are the Previous Year')}
      {(sel.customCY || sel.customPY) && (
        <div className="px-3 pb-1.5"><button onClick={reset} className="text-[10px] text-blue-700 underline">Reset to this Financial Year / the year before</button></div>
      )}
    </>
  )
}

/**
 * BranchModeBar — shown above BS / PL / Notes / Annexures / working tabs for branch entities.
 *
 * Props:
 *   fsMode            : 'single' | 'consolidated' | 'columnar'
 *   onFsModeChange    : (mode) => void
 *   branchTBList      : [{ id, branch_name, period, filename }]
 *   selectedBranchTBId: number | null
 *   onBranchSelect    : (id) => void
 *   hideModes         : boolean — when true, hides mode-switcher and only shows branch selector
 */
export default function BranchModeBar({ fsMode, onFsModeChange, branchTBList = [], selectedBranchTBId, onBranchSelect, hideModes = false, allowConsolidated = false }) {
  const MODES = [
    { key: 'single',       label: 'Single Branch',         icon: '📋' },
    { key: 'consolidated', label: 'Consolidated',           icon: '🔀' },
    { key: 'columnar',     label: 'Branch-wise (Columnar)', icon: '📊' },
  ]

  const activeBranch = branchTBList.find(t => t.id === selectedBranchTBId)
  const activeBranchLabel = activeBranch
    ? (activeBranch.branch_name || activeBranch.period || `TB #${activeBranch.id}`)
    : null

  return (
    <div className="flex flex-col shrink-0 border-b border-blue-100 bg-blue-50">
      {/* Mode selector row — hidden when hideModes=true */}
      {!hideModes && (
        <div className="flex items-center gap-1 px-3 py-1.5">
          <span className="text-[10px] text-gray-500 font-semibold mr-2 uppercase tracking-wide">View Mode:</span>
          {MODES.map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => onFsModeChange(key)}
              className={`flex items-center gap-1 px-3 py-1 rounded text-xs font-medium transition ${
                fsMode === key
                  ? 'text-white shadow-sm'
                  : 'bg-white text-gray-600 border border-gray-200 hover:border-blue-300 hover:text-blue-700'
              }`}
              style={fsMode === key ? { background: 'var(--color-primary)' } : {}}
            >
              {icon} {label}
            </button>
          ))}
          {fsMode === 'consolidated' && (
            <span className="ml-3 text-[10px] text-blue-600 bg-blue-100 border border-blue-200 rounded px-2 py-0.5">
              All ticked branches summed
            </span>
          )}
        </div>
      )}
      {!hideModes && fsMode === 'consolidated' && <ConsolidationPicker />}

      {/* Branch tab row — always shown when hideModes; otherwise only in single / columnar mode */}
      {(hideModes || fsMode === 'single' || fsMode === 'columnar') && branchTBList.length > 0 && (
        <div className="flex items-center gap-1 px-3 pb-1.5 overflow-x-auto">
          <span className="text-[10px] text-gray-400 mr-1 shrink-0">Branch:</span>
          {branchTBList.map(t => {
            const label = t.branch_name || t.period || `TB #${t.id}`
            const active = t.id === selectedBranchTBId
            return (
              <button
                key={t.id}
                onClick={() => onBranchSelect(t.id)}
                title={`${label} — ${t.period || ''}${t.filename ? ` (${t.filename})` : ''}`}
                className={`shrink-0 px-3 py-0.5 rounded-full text-xs font-medium transition border ${
                  active
                    ? 'text-white border-transparent'
                    : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400 hover:text-blue-700'
                }`}
                style={active ? { background: 'var(--color-primary)' } : {}}
              >
                {label}
              </button>
            )
          })}
          {allowConsolidated && (() => {
            const active = selectedBranchTBId === '__consolidated__'
            return (
              <button
                key="__consolidated__"
                onClick={() => onBranchSelect('__consolidated__')}
                title="One schedule for the whole entity (all branches together) — no ledger linking; reconciled against the sum of all branches' PPE in the Exception Report"
                className={`shrink-0 ml-2 px-3 py-0.5 rounded-full text-xs font-medium transition border ${
                  active ? 'text-white border-transparent' : 'bg-amber-50 text-amber-800 border-amber-300 hover:border-amber-500'
                }`}
                style={active ? { background: 'var(--color-primary)' } : {}}
              >
                🔀 Consolidated (all branches)
              </button>
            )
          })()}
          {fsMode === 'columnar' && (
            <span className="ml-2 text-[10px] text-gray-400 italic shrink-0">
              (select branch to preview · export from Generate Financials)
            </span>
          )}
        </div>
      )}
    </div>
  )
}
