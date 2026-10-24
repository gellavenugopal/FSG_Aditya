import React from 'react'
import { usePYMode } from '../../hooks/usePYMode'

/**
 * "Previous Year figures" choice for the Financial Year the screen is showing - Required (the default), or not
 * required with the column kept (dashes) or left out. Shown on the statement screens and in Generate Financials,
 * so a first-year entity is a one-click choice wherever the CA is working. Changing it re-reads the statements
 * (`onChanged`); a locked Financial Year refuses, with the usual message.
 */
export default function PYModeSelect({ activeTB, onChanged, className = '' }) {
  const epId = activeTB?.entity_period_id
  const { mode, setMode } = usePYMode(epId)
  if (!epId) return null

  const change = async (e) => {
    try {
      await setMode(e.target.value)
      onChanged?.()
    } catch (err) {
      window.alert(String(err?.message || err).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''))
    }
  }
  const off = mode !== 'required'
  return (
    <div className={`flex items-center gap-1.5 shrink-0 ${className}`}
      title="Required (the default): Previous Year figures are shown. Choose 'Not required' for a first year of operation, or when no comparative is wanted - the column then shows a dash, or is left out altogether.">
      <label className="text-xs text-gray-500 whitespace-nowrap">Previous Year figures:</label>
      <select value={mode} onChange={change}
        className={`border rounded px-2 py-1 text-xs focus:ring-2 focus:ring-blue-400 focus:outline-none ${off ? 'border-amber-400 bg-amber-50 text-amber-900' : 'border-gray-300 bg-white text-gray-900'}`}>
        <option value="required">Required</option>
        <option value="none_show">Not required — column shows “—”</option>
        <option value="none_hide">Not required — column left out</option>
      </select>
    </div>
  )
}
