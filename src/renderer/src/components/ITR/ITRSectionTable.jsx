import React from 'react'
import { fmtINR } from '../../hooks/useFinancials'

// Fixed outline width matching the reference workbook's own column layout
// (index letters live in columns A..G, one nesting level per column, with
// the label always sitting in the column right after the deepest index used).
const INDEX_COLS = 7

const isTotalRow = (label) => /^total\b|^net current assets|^cost of goods produced|^gross profit|^profit (before|after)|^balance (brought|carried|available)/i.test(label || '')

export default function ITRSectionTable({ title, rows, values, formValues, onChange }) {
  return (
    <div className="border border-gray-200 rounded-md overflow-hidden mb-4">
      {title && (
        <div className="px-3 py-1.5 bg-gray-100 border-b border-gray-200 text-xs font-semibold text-gray-700">{title}</div>
      )}
      <table className="w-full text-xs border-collapse">
        <tbody>
          {rows.map((row, i) => {
            const total = isTotalRow(row.label)
            const rowClass = total ? 'bg-blue-50 font-semibold' : ''
            const depth = row.depth || 1
            const indexByCol = {}
            for (const c of row.index || []) indexByCol[c.col] = c.value
            const labelSpan = INDEX_COLS - depth + 1

            const indexCells = []
            for (let c = 1; c < depth; c++) {
              indexCells.push(
                <td
                  key={c}
                  className="px-1 py-1 w-6 text-center align-top text-gray-400 border-r border-gray-100"
                >
                  {indexByCol[c] || ''}
                </td>
              )
            }

            return (
              <tr key={i} className={`${rowClass} border-b border-gray-100 last:border-b-0`}>
                {indexCells}
                <td className="px-2 py-1 align-top text-gray-800" colSpan={labelSpan}>
                  {row.label}
                </td>
                <td className="px-2 py-1 w-40 text-right align-top whitespace-nowrap border-l border-gray-100">
                  {row.id && row.editable && (
                    <input
                      type="number"
                      className="w-full border border-orange-300 bg-orange-50 rounded px-1.5 py-0.5 text-right font-mono text-xs focus:outline-none focus:ring-1 focus:ring-orange-400"
                      value={formValues?.[row.id] ?? ''}
                      onChange={(e) => onChange(row.id, e.target.value)}
                      placeholder="0.00"
                    />
                  )}
                  {row.id && !row.editable && (
                    <span className="font-mono text-gray-700">{fmtINR(values?.[row.id])}</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
