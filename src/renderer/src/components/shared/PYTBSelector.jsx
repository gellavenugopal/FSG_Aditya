import React, { useState, useEffect } from 'react'
import { formatPeriodText } from '../../utils/financialPeriodDisplay'

/**
 * Dropdown to pick a Previous Year Trial Balance.
 * Fetches the entity's TB list, excludes the current TB.
 */
export default function PYTBSelector({ entity, currentTBId, prevTB, onChange, disabled = false, disabledTitle }) {
  const [tbList, setTbList] = useState([])

  useEffect(() => {
    if (!entity?.id) { setTbList([]); return }
    window.api?.getTBList(entity.id).then(setTbList).catch(() => {})
  }, [entity?.id])

  const options = tbList.filter(t => t.id !== currentTBId)
  if (options.length === 0) return null

  return (
    <div className="flex items-center gap-2 shrink-0" title={disabled ? disabledTitle : undefined}>
      <label className="text-xs text-gray-500 whitespace-nowrap">Previous Year TB:</label>
      <select
        value={prevTB?.id || ''}
        disabled={disabled}
        onChange={e => {
          const id = parseInt(e.target.value)
          onChange(options.find(t => t.id === id) || null)
        }}
        className="border border-gray-300 rounded px-2 py-1 text-xs bg-white text-gray-900 focus:ring-2 focus:ring-blue-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
      >
        <option value="">— None (use opening balances) —</option>
        {options.map(t => (
          <option key={t.id} value={t.id}>
            {formatPeriodText(t.period) || t.filename} ({t.row_count} rows)
          </option>
        ))}
      </select>
      {prevTB && (
        <span className="text-xs text-green-700 font-medium">✓ PY mapped</span>
      )}
    </div>
  )
}
