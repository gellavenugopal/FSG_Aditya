import React from 'react'
import { usePlClosedToCapital } from '../../hooks/usePlClosedToCapital'

/**
 * "P&L already closed to Capital in Tally" toggle for BS/PL headers — one
 * flag per TB, editable here even for a TB imported before this toggle
 * existed, or where it only became clear afterward. When ON, the app skips
 * its own automatic Net Profit → Reserves & Surplus/Capital injection, since
 * the profit is already baked into Capital via a real Tally journal entry.
 */
export default function PlClosedToCapitalButton({ tbId, entityId, onChanged, label = '' }) {
  const plClosed = usePlClosedToCapital(tbId, entityId)
  if (!tbId) return null

  const toggle = async () => {
    await plClosed.setEnabled(!plClosed.enabled)
    onChanged?.()
  }
  const suffix = label ? ` (${label})` : ''

  return (
    <button onClick={toggle}
      title={plClosed.enabled
        ? `P&L already closed to Capital in Tally${suffix} — the app's own Net Profit calculation is NOT added to Capital/Reserves for this TB`
        : `Turn on if this year's P&L has already been journal-transferred to Capital inside Tally itself${suffix} — otherwise leave off`}
      className={`text-xs px-2.5 py-1 rounded-full font-medium border transition ${
        plClosed.enabled ? 'bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-200'
                          : 'bg-gray-100 text-gray-600 border-gray-300 hover:bg-gray-200'}`}>
      {plClosed.enabled ? `✓ P&L Closed to Capital${suffix}` : `P&L Closed to Capital${suffix}`}
    </button>
  )
}
