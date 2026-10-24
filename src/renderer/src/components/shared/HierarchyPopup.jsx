import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'

function getBookAlie(row) {
  return row.trial_balance_type || row.alie || ''
}

export default function HierarchyPopup({ row, onClose }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  // Books chain: ledger → immediate parent → ... → top ALIE
  // group_parent_3 is closest to ledger, parent/book_alie are at the top
  const booksChain = [
    row.name,
    row.group_parent_3,
    row.group_parent_2,
    row.group_parent_1,
    row.group_parent,
    row.parent,
    getBookAlie(row),
  ].filter((v, i, a) => !!v && a.indexOf(v) === i)

  // Mapping chain: ledger → M1 → M2 → M3 → L5 Nature
  const mappingChain = [
    row.name,
    row.mapping1_resultant,
    row.mapping2_resultant,
    row.mapping3_resultant,
    row.level5_value,
  ].filter(Boolean)

  const Chain = ({ items, color }) => (
    <div className={`rounded p-3 flex flex-wrap items-center gap-1.5 border ${
      color === 'amber'
        ? 'bg-amber-50 border-amber-100'
        : 'bg-blue-50 border-blue-100'
    }`}>
      {items.length === 0 && (
        <span className="text-xs text-gray-400 italic">Not yet mapped</span>
      )}
      {items.map((label, i) => (
        <React.Fragment key={i}>
          {i > 0 && (
            <span className={`font-bold text-sm ${color === 'amber' ? 'text-amber-400' : 'text-blue-400'}`}>›</span>
          )}
          <span className={`px-2 py-1 rounded text-xs border ${
            i === 0
              ? color === 'amber'
                ? 'bg-amber-100 border-amber-300 font-semibold text-amber-900'
                : 'bg-blue-100 border-blue-300 font-semibold text-blue-900'
              : color === 'amber'
                ? 'bg-white border-amber-200 text-amber-800'
                : 'bg-white border-blue-200 text-blue-700'
          }`}>
            {label}
          </span>
        </React.Fragment>
      ))}
    </div>
  )

  return createPortal(
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[9999]"
      onClick={onClose}>
      <div className="bg-white rounded-lg border border-blue-100 shadow-2xl w-[700px] p-5"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-blue-900">Ledger Hierarchy</h3>
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-gray-400">Press Esc to close</span>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
          </div>
        </div>

        <div className="mb-4">
          <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
            Books / Tally Hierarchy
          </div>
          <Chain items={booksChain} color="amber" />
        </div>

        <div>
          <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
            Schedule III Mapping
          </div>
          <Chain items={mappingChain} color="blue" />
        </div>

        <div className="mt-4 flex justify-end">
          <button onClick={onClose}
            className="px-4 py-1.5 text-xs border border-gray-300 rounded text-gray-600 hover:bg-gray-50">
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
