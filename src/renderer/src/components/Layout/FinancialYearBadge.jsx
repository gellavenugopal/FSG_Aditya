import React, { useState } from 'react'
import { formatPeriodRange } from '../../utils/financialPeriodDisplay'

/**
 * Financial Year / Period badge — shown in the TopBar immediately before the
 * DB Connected pill, so the CA always has a clear, at-a-glance view of which
 * FY they're currently working on, with a one-click way to switch it.
 *
 * Controlled component: `entityPeriods`/`selectedId` come from App.jsx (which
 * owns the actual Auditee↔FY state), and `onSelect` is how a pick here
 * propagates back up. App.jsx resolves whatever Trial Balance belongs to the
 * newly-selected period (auto-loads it if there's exactly one, prompts if
 * there's more than one or none) — this component itself only presents the
 * period list and reports a selection, it doesn't touch TB state directly.
 */
export default function FinancialYearBadge({ entity, entityPeriods = [], selectedId, onSelect, onManage }) {
  const [open, setOpen] = useState(false)

  if (!entity) return null

  const selected = entityPeriods.find(p => p.id === selectedId)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-white/15 hover:bg-white/25 transition text-white"
        title="Financial Year / Period you're working on — click to change"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        {selected ? selected.year_label : (entityPeriods.length ? 'Select FY' : 'No FY set')}
        <span className="text-[9px] opacity-70">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 w-64 py-1">
            <div className="px-3 py-1.5 text-xs text-gray-500 border-b border-gray-100 font-semibold uppercase">
              Financial Year / Period
            </div>
            {entityPeriods.length === 0 && (
              <div className="px-3 py-2 text-xs text-gray-500">No financial periods set up for this Auditee yet.</div>
            )}
            {entityPeriods.map(p => (
              <button
                key={p.id}
                onClick={() => { onSelect?.(p.id); setOpen(false) }}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 ${
                  selectedId === p.id ? 'bg-blue-50 font-semibold text-blue-800' : 'text-gray-800'
                }`}
              >
                {p.year_label} <span className="text-gray-400">({formatPeriodRange(p.date_from, p.date_till)})</span>{p.locked ? ' 🔒' : ''}
              </button>
            ))}
            <div className="border-t border-gray-100 mt-1 pt-1">
              <button
                onClick={() => { setOpen(false); onManage?.() }}
                className="w-full text-left px-3 py-1.5 text-xs text-blue-600 hover:bg-blue-50"
              >
                ⚙ Manage Financial Periods →
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
