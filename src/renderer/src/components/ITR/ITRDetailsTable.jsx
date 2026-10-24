import React from 'react'
import { fmtINR } from '../../hooks/useFinancials'

export default function ITRDetailsTable({ block, rows, onChange }) {
  const list = rows && rows.length ? rows : []

  const setCell = (idx, key, val) => {
    const next = list.slice()
    next[idx] = { ...next[idx], [key]: val }
    onChange(next)
  }

  const addRow = () => {
    const blank = {}
    block.columns.forEach((c) => { blank[c.key] = '' })
    onChange([...list, blank])
  }

  const removeRow = (idx) => {
    onChange(list.filter((_, i) => i !== idx))
  }

  const total = list.reduce((acc, r) => acc + (parseFloat(r?.[block.amountKey]) || 0), 0)

  return (
    <div className="border border-gray-200 rounded-md overflow-hidden mb-4">
      <div className="px-3 py-1.5 bg-gray-100 border-b border-gray-200 text-xs font-semibold text-gray-700 flex items-center justify-between">
        <span>{block.title}</span>
        <button
          onClick={addRow}
          className="text-[11px] px-2 py-0.5 rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-600"
        >+ Add row</button>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-gray-50 text-gray-500">
            {block.columns.map((c) => (
              <th key={c.key} className={`px-2 py-1 font-medium ${c.type === 'number' ? 'text-right' : 'text-left'}`}>{c.label}</th>
            ))}
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {list.length === 0 && (
            <tr><td colSpan={block.columns.length + 1} className="px-2 py-2 text-gray-400 italic text-center">No entries</td></tr>
          )}
          {list.map((r, idx) => (
            <tr key={idx} className="border-t border-gray-100">
              {block.columns.map((c) => (
                <td key={c.key} className="px-2 py-1">
                  <input
                    type={c.type === 'number' ? 'number' : 'text'}
                    className={`w-full border border-orange-300 bg-orange-50 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-orange-400 ${c.type === 'number' ? 'text-right font-mono' : ''}`}
                    value={r?.[c.key] ?? ''}
                    onChange={(e) => setCell(idx, c.key, e.target.value)}
                  />
                </td>
              ))}
              <td className="px-1 py-1 text-center">
                <button onClick={() => removeRow(idx)} className="text-gray-400 hover:text-red-500" title="Remove">✕</button>
              </td>
            </tr>
          ))}
          <tr className="border-t border-gray-200 bg-blue-50 font-semibold">
            <td className="px-2 py-1" colSpan={block.columns.length - 1}>Total</td>
            <td className="px-2 py-1 text-right font-mono">{fmtINR(total)}</td>
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  )
}
