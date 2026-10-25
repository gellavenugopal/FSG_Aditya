import React, { useState, useEffect } from 'react'
import { formatPeriodRange } from '../../utils/financialPeriodDisplay'

/**
 * Dropdown to pick one of the active entity's attached Financial Periods.
 * Modeled on PYTBSelector's fetch pattern. Used by TB upload modals to
 * replace the old free-text "Period" input, auto-deriving the period string
 * as "{date_from} To {date_till}". The stored value remains ISO; only labels
 * shown to the user use the unambiguous DD-MMM-YY format.
 */
export default function FinancialPeriodPicker({ entity, value, onChange, allowCustom = true }) {
  const [periods, setPeriods] = useState([])
  const [loading, setLoading] = useState(false)
  const [customMode, setCustomMode] = useState(false)

  useEffect(() => {
    if (!entity?.id) { setPeriods([]); return }
    setLoading(true)
    window.api?.listEntityPeriods(entity.id)
      .then(list => setPeriods(list || []))
      .catch(() => setPeriods([]))
      .finally(() => setLoading(false))
  }, [entity?.id])

  if (loading) return <div className="text-xs text-gray-400">Loading periods...</div>

  if (customMode || (periods.length === 0 && allowCustom)) {
    return (
      <div>
        <label className="block text-xs text-gray-500 mb-1">Period <span className="text-gray-400">(e.g. FY 2024-25)</span></label>
        <input
          type="text"
          value={value?.customText || ''}
          onChange={e => onChange({ customText: e.target.value })}
          placeholder="FY 2024-25"
          className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        {periods.length > 0 && (
          <button
            type="button"
            onClick={() => setCustomMode(false)}
            className="text-xs text-blue-600 hover:underline mt-1"
          >
            ← Choose from Financial Periods list
          </button>
        )}
      </div>
    )
  }

  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">Financial Period</label>
      <select
        value={value?.entityPeriodId || ''}
        onChange={e => {
          const id = parseInt(e.target.value)
          const ep = periods.find(p => p.id === id)
          onChange(ep ? { entityPeriodId: ep.id, periodText: `${ep.date_from} To ${ep.date_till}` } : null)
        }}
        className="w-full border border-gray-300 rounded px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
      >
        <option value="">— Select a Financial Period —</option>
        {periods.map(p => (
          <option key={p.id} value={p.id} disabled={!!p.locked}>
            {p.year_label} ({formatPeriodRange(p.date_from, p.date_till, ' to ')}){p.locked ? ' — Locked' : ''}
          </option>
        ))}
      </select>
      {periods.length === 0 && !allowCustom && (
        <p className="text-[10px] text-amber-600 mt-1">
          No Financial Periods set up for this Auditee yet — go to Master → Financial Period to create one first.
        </p>
      )}
      {allowCustom && (
        <button
          type="button"
          onClick={() => setCustomMode(true)}
          className="text-xs text-blue-600 hover:underline mt-1"
        >
          Use a custom / one-off period label instead
        </button>
      )}
    </div>
  )
}
