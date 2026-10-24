/**
 * Trade Receivables Ageing Schedule Form (Schedule III)
 * Outstanding for following periods from due date of payment
 */
import React, { useState, useEffect } from 'react'

export const TR_AGEING_BUCKETS = [
  { key: 'less6m', label: 'Less than 6 months' },
  { key: '6m1y',   label: '6 months - 1 year' },
  { key: '1y2y',   label: '1-2 yrs.' },
  { key: '2y3y',   label: '2-3 yrs.' },
  { key: 'more3y', label: 'More than 3 yrs.' },
]

// Input rows + computed rows. Computed rows derive per-bucket values dynamically.
export const TR_AGEING_ROWS = [
  { key: 'undis_good',         label: '(i) Undisputed Trade receivables - considered good' },
  { key: 'undis_doubtful',     label: '(ii) Undisputed Trade Receivables - considered doubtful' },
  { key: 'dis_good',           label: '(iii) Disputed Trade Receivables considered good' },
  { key: 'dis_doubtful',       label: '(iv) Disputed Trade Receivables considered doubtful' },
  { key: 'total_due',          label: 'Total Due', computed: 'due', isTotal: true },
  { key: 'unbilled_good',      label: 'Unbilled Dues - considered good' },
  { key: 'unbilled_doubtful',  label: 'Unbilled Dues - considered doubtful' },
  { key: 'provision_doubtful', label: 'Less: Provision for doubtful debts', deduct: true },
  { key: 'total_tr',           label: 'Total Trade Receivable', computed: 'grand', isTotal: true },
]

// Rows summed into "Total Due" and into the grand total
export const TR_DUE_ROWS = ['undis_good', 'undis_doubtful', 'dis_good', 'dis_doubtful']
export const TR_ADD_ROWS = ['unbilled_good', 'unbilled_doubtful']   // added after Total Due
export const TR_DEDUCT_ROWS = ['provision_doubtful']                 // deducted from grand total

const num = (v) => parseFloat(v) || 0
const fmt = (n) => {
  const v = parseFloat(n)
  if (!v || isNaN(v)) return '—'
  const abs = Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return v < 0 ? `(${abs})` : abs
}

/** Per-bucket value of a computed row, derived from the input rows. */
export function trComputedCell(periodData, computedType, bucketKey) {
  const cell = (rk) => num(periodData?.[rk]?.[bucketKey])
  const due = TR_DUE_ROWS.reduce((s, rk) => s + cell(rk), 0)
  if (computedType === 'due') return due
  return due + TR_ADD_ROWS.reduce((s, rk) => s + cell(rk), 0)
           - TR_DEDUCT_ROWS.reduce((s, rk) => s + cell(rk), 0)
}

function emptyPeriod() {
  const p = {}
  for (const r of TR_AGEING_ROWS) {
    if (!r.computed) p[r.key] = { less6m: '', '6m1y': '', '1y2y': '', '2y3y': '', more3y: '' }
  }
  return p
}

export default function TradeReceivablesAgingForm({ tbId, entityId, useEntityLevel, noteNum, noteTitle, noteTotal = 0, notePrevTotal = 0, onClose, onSaved }) {
  // A branch entity keeps this schedule once for the whole entity (like the
  // other statutory forms), so it has no Trial Balance id to save against.
  const scopeId = useEntityLevel ? entityId : tbId
  const [data, setData] = useState({
    cy: emptyPeriod(),
    py: emptyPeriod(),
    includeInOutput: false,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!scopeId || !noteNum) return
    setLoading(true)
    Promise.resolve(useEntityLevel
      ? window.api?.getEntityNoteDetails?.(entityId, noteNum, noteTitle)
      : window.api?.notesGetTradeReceivablesAging?.(tbId, noteNum, noteTitle))
      .then(d => {
        if (!d || !d.cy) return
        setData(prev => ({
          ...prev,
          ...d,
          cy: { ...emptyPeriod(), ...d.cy },
          py: { ...emptyPeriod(), ...d.py },
        }))
      })
      .catch(err => console.error('Load Trade Receivables ageing failed:', err))
      .finally(() => setLoading(false))
  }, [scopeId, useEntityLevel, noteNum, noteTitle])

  const setCell = (period, rowKey, bucketKey, val) => {
    setSaved(false)
    setData(prev => ({
      ...prev,
      [period]: {
        ...prev[period],
        [rowKey]: { ...prev[period]?.[rowKey], [bucketKey]: val }
      }
    }))
  }

  // Value of one bucket cell for a row (input rows read state; computed rows derive)
  const cellValue = (period, row, bucketKey) =>
    row.computed ? trComputedCell(data[period], row.computed, bucketKey) : num(data[period]?.[row.key]?.[bucketKey])

  const rowTotal = (period, row) =>
    TR_AGEING_BUCKETS.reduce((s, b) => s + cellValue(period, row, b.key), 0)

  const grandTotal = (period) =>
    rowTotal(period, TR_AGEING_ROWS.find(r => r.key === 'total_tr'))

  const handleSave = async () => {
    if (!scopeId || !noteNum || !noteTitle) {
      setError('Missing note or TB information')
      return
    }
    try {
      setLoading(true)
      setError('')
      if (useEntityLevel) await window.api?.saveEntityNoteDetails?.({ entityId, noteNum, noteTitle, data })
      else await window.api?.notesSaveTradeReceivablesAging?.(tbId, noteNum, noteTitle, data)
      setSaved(true)
      onSaved?.()
    } catch (err) {
      setError(err.message || 'Failed to save')
    } finally {
      setLoading(false)
    }
  }

  const renderTable = (period, heading) => (
    <div className="mb-4">
      <p className="text-sm font-bold text-blue-900 mb-2">Trade Receivables ageing schedule ({heading})</p>
      <div className="overflow-x-auto border border-gray-200 rounded">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-blue-50">
              <th rowSpan={2} className="border border-gray-300 px-2 py-1 text-left font-semibold align-bottom w-[26%]">Particulars</th>
              <th colSpan={5} className="border border-gray-300 px-2 py-1 text-center font-semibold">Outstanding for following periods from due date of payment</th>
              <th rowSpan={2} className="border border-gray-300 px-2 py-1 text-right font-semibold align-bottom">Total</th>
            </tr>
            <tr className="bg-blue-50">
              {TR_AGEING_BUCKETS.map(b => (
                <th key={b.key} className="border border-gray-300 px-2 py-1 text-right font-semibold">{b.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TR_AGEING_ROWS.map(row => (
              <tr key={row.key} className={`border-b ${row.isTotal ? 'bg-blue-50 font-semibold' : 'hover:bg-gray-50'}`}>
                <td className="border border-gray-200 px-2 py-1">{row.label}</td>
                {TR_AGEING_BUCKETS.map(b => (
                  <td key={b.key} className="border border-gray-200 px-1 py-0.5">
                    {row.computed ? (
                      <div className="w-full px-1.5 py-0.5 text-xs text-right font-mono bg-gray-50 text-gray-800">
                        {fmt(trComputedCell(data[period], row.computed, b.key))}
                      </div>
                    ) : (
                      <input
                        type="number"
                        className="w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs text-right font-mono bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                        value={data[period]?.[row.key]?.[b.key] || ''}
                        onChange={e => setCell(period, row.key, b.key, e.target.value)}
                        placeholder="0"
                        step="0.01"
                      />
                    )}
                  </td>
                ))}
                <td className="border border-gray-200 px-2 py-1 text-right font-mono font-semibold">{fmt(rowTotal(period, row))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-gray-400 mt-1">Total Due and Total Trade Receivable are auto-calculated. Provision for doubtful debts is deducted from the Total (enter as a positive amount).</p>
    </div>
  )

  const renderCheck = (period, tbNoteTotal) => {
    const sched = grandTotal(period)
    const tb = num(tbNoteTotal)
    const diff = tb - sched
    return (
      <div className="mb-8">
        <p className="text-xs font-bold text-gray-800 mb-2 underline">Check</p>
        <table className="w-auto min-w-[45%] text-xs border-collapse">
          <tbody>
            <tr>
              <td className="border border-gray-300 px-2 py-1 w-[55%]">As per Above Schedule</td>
              <td className="border border-gray-300 px-2 py-1 text-right font-mono">{fmt(sched)}</td>
            </tr>
            <tr>
              <td className="border border-gray-300 px-2 py-1">As per Trial Balance</td>
              <td className="border border-gray-300 px-2 py-1 text-right font-mono bg-gray-50" title="Auto-pulled from the Trial Balance note total">{fmt(tb)}</td>
            </tr>
            <tr className="bg-gray-50 font-semibold">
              <td className="border border-gray-300 px-2 py-1">Difference</td>
              <td className={`border border-gray-300 px-2 py-1 text-right font-mono ${Math.abs(diff) < 0.005 ? 'text-green-600' : 'text-red-600'}`}>{fmt(diff)}</td>
            </tr>
          </tbody>
        </table>
        <p className="text-[10px] text-gray-400 mt-1">Trial Balance figure is auto-pulled from the note total.</p>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-6xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 z-10 bg-blue-600 text-white px-6 py-3">
          <h2 className="text-base font-bold">Note {noteNum}: {noteTitle}</h2>
          <p className="text-xs text-blue-100 mt-0.5">Trade Receivables ageing schedule — Outstanding for following periods from due date of payment</p>
        </div>

        <div className="p-6">
          {error && <div className="mb-4 p-3 bg-red-50 border border-red-300 rounded text-xs text-red-700">{error}</div>}
          {saved && <div className="mb-4 p-3 bg-green-50 border border-green-300 rounded text-xs text-green-700">Saved successfully.</div>}

          {loading ? (
            <p className="text-center text-gray-400 py-8">Loading...</p>
          ) : (
            <>
              {renderTable('cy', 'Current Year')}
              {renderCheck('cy', noteTotal)}

              {renderTable('py', 'Previous Year')}
              {renderCheck('py', notePrevTotal)}

              <div className="p-3 bg-blue-50 border border-blue-200 rounded">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={data.includeInOutput || false}
                    onChange={e => { setSaved(false); setData(prev => ({ ...prev, includeInOutput: e.target.checked })) }}
                    className="rounded border-gray-300"
                  />
                  <span className="text-xs font-medium text-gray-700">Always include in PDF & Excel (even if all zeros)</span>
                </label>
              </div>
            </>
          )}
        </div>

        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-3 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-xs rounded border border-gray-300 text-gray-700 hover:bg-gray-100 font-medium">Close</button>
          <button onClick={handleSave} disabled={loading} className="px-4 py-2 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 font-medium disabled:bg-gray-400">
            {loading ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
