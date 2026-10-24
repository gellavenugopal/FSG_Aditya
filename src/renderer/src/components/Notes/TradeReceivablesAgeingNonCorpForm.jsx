/**
 * Trade Receivables ageing — Fill Details for Proprietorship / Partnership / LLP.
 * (Company keeps TradeReceivablesAgingForm.jsx, its Schedule III ageing schedule.)
 * One table; see utils/tradeReceivablesNonCorp.js for the layout, the default
 * (everything in "less than 6 months / Unsecured, considered good") and the
 * saved shape.
 */
import React, { useState, useEffect } from 'react'
import { NC_AGEING_TITLE, NC_AGEING_BLOCKS, NC_AGEING_CATEGORIES, ncAgeingResolve, ncAgeingTotal } from '../../utils/tradeReceivablesNonCorp'

const fmt = (n) => {
  const v = parseFloat(n)
  if (!v || isNaN(v)) return '—'
  const abs = Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return v < 0 ? `(${abs})` : abs
}

/** Read-only copy of the table, shown beneath the Trade receivables note (values already resolved). */
export function NcAgeingDisplayTable({ saved, noteTotal, fmtAmount = fmt }) {
  const { values, total } = ncAgeingResolve(saved, noteTotal)
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr className="bg-indigo-50">
            <th className="border border-indigo-200 px-2 py-1 text-left font-semibold text-indigo-900 w-[46%]">{NC_AGEING_TITLE}</th>
            <th className="border border-indigo-200 px-2 py-1 text-center font-semibold text-indigo-900 w-[30%]">Category</th>
            <th className="border border-indigo-200 px-2 py-1 text-right font-semibold text-indigo-900">Amount</th>
          </tr>
        </thead>
        <tbody>
          {NC_AGEING_BLOCKS.map(b => NC_AGEING_CATEGORIES.map((c, i) => (
            <tr key={`${b.key}-${c.key}`} className="bg-indigo-50/30">
              {i === 0 && <td rowSpan={NC_AGEING_CATEGORIES.length} className="border border-indigo-200 px-2 py-1 text-left text-gray-700 align-middle">{b.label}</td>}
              <td className="border border-indigo-200 px-2 py-1 text-left text-gray-700">{c.label}</td>
              <td className="border border-indigo-200 px-2 py-1 text-right font-mono text-gray-800">{fmtAmount(values[b.key][c.key])}</td>
            </tr>
          )))}
          <tr className="bg-indigo-50 font-semibold">
            <td colSpan={2} className="border border-indigo-200 px-2 py-1 text-center text-gray-800">Total</td>
            <td className="border border-indigo-200 px-2 py-1 text-right font-mono text-gray-800">{fmtAmount(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

export default function TradeReceivablesAgeingNonCorpForm({ tbId, entityId, useEntityLevel, noteNum, noteTitle, noteTotal = 0, onClose, onSaved }) {
  // A branch entity keeps this once for the whole entity (like the other
  // statutory forms), so it has no Trial Balance id to save against.
  const scopeId = useEntityLevel ? entityId : tbId
  const [existing, setExisting] = useState({})          // the note's whole saved JSON — kept so saving never drops other keys
  const [cells, setCells] = useState(() => ncAgeingResolve(null, noteTotal).values)
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
        setExisting(d && typeof d === 'object' ? d : {})
        setCells(ncAgeingResolve(d?.ncAgeing, noteTotal).values)
      })
      .catch(err => console.error('Load Trade Receivables ageing failed:', err))
      .finally(() => setLoading(false))
  }, [scopeId, useEntityLevel, noteNum, noteTitle])

  const setCell = (blockKey, catKey, val) => {
    setSaved(false)
    setCells(prev => ({ ...prev, [blockKey]: { ...prev[blockKey], [catKey]: val } }))
  }
  const total = ncAgeingTotal(cells)
  const tb = parseFloat(noteTotal) || 0
  const diff = tb - total

  const handleSave = async () => {
    if (!scopeId || !noteNum || !noteTitle) { setError('Missing note or TB information'); return }
    // Saved as plain numbers (blank cells as 0) — merged into whatever else the note already holds.
    const ncAgeing = {}
    for (const b of NC_AGEING_BLOCKS) {
      ncAgeing[b.key] = {}
      for (const c of NC_AGEING_CATEGORIES) ncAgeing[b.key][c.key] = parseFloat(cells[b.key]?.[c.key]) || 0
    }
    const data = { ...existing, ncAgeing }
    try {
      setLoading(true); setError('')
      if (useEntityLevel) await window.api?.saveEntityNoteDetails?.({ entityId, noteNum, noteTitle, data })
      else await window.api?.notesSaveTradeReceivablesAging?.(tbId, noteNum, noteTitle, data)
      setExisting(data)
      setSaved(true)
      onSaved?.()
    } catch (err) {
      setError(err.message || 'Failed to save')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-3xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 z-10 bg-blue-600 text-white px-6 py-3">
          <h2 className="text-base font-bold">Note {noteNum}: {noteTitle}</h2>
          <p className="text-xs text-blue-100 mt-0.5">{NC_AGEING_TITLE}</p>
        </div>

        <div className="p-6">
          {error && <div className="mb-4 p-3 bg-red-50 border border-red-300 rounded text-xs text-red-700">{error}</div>}
          {saved && <div className="mb-4 p-3 bg-green-50 border border-green-300 rounded text-xs text-green-700">Saved successfully.</div>}

          {loading ? (
            <p className="text-center text-gray-400 py-8">Loading...</p>
          ) : (
            <>
              <div className="overflow-x-auto border border-gray-200 rounded">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-blue-50">
                      <th className="border border-gray-300 px-2 py-1.5 text-left font-semibold w-[44%]">{NC_AGEING_TITLE}</th>
                      <th className="border border-gray-300 px-2 py-1.5 text-center font-semibold w-[28%]">Category</th>
                      <th className="border border-gray-300 px-2 py-1.5 text-right font-semibold">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {NC_AGEING_BLOCKS.map(b => NC_AGEING_CATEGORIES.map((c, i) => (
                      <tr key={`${b.key}-${c.key}`}>
                        {i === 0 && <td rowSpan={NC_AGEING_CATEGORIES.length} className="border border-gray-300 px-2 py-1 text-left align-middle">{b.label}</td>}
                        <td className="border border-gray-300 px-2 py-1 text-left">{c.label}</td>
                        <td className="border border-gray-300 px-1 py-0.5">
                          <input
                            type="number" step="0.01" placeholder="0"
                            className="w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs text-right font-mono bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                            value={cells[b.key]?.[c.key] === 0 || cells[b.key]?.[c.key] === '' ? '' : cells[b.key]?.[c.key]}
                            onChange={e => setCell(b.key, c.key, e.target.value)}
                          />
                        </td>
                      </tr>
                    )))}
                    <tr className="bg-blue-50 font-semibold">
                      <td colSpan={2} className="border border-gray-300 px-2 py-1.5 text-center">Total</td>
                      <td className="border border-gray-300 px-2 py-1.5 text-right font-mono">{fmt(total)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between mt-1">
                <p className="text-[10px] text-gray-400">Until edited, the whole figure is taken as “less than 6 months — Unsecured, considered good”. Enter each ageing figure; the total must equal the Trial Balance.</p>
                <button onClick={() => { setSaved(false); setCells(ncAgeingResolve(null, noteTotal).values) }}
                  className="text-[11px] text-blue-700 hover:underline shrink-0 ml-3">Reset to default</button>
              </div>

              <div className="mt-5">
                <p className="text-xs font-bold text-gray-800 mb-2 underline">Check</p>
                <table className="w-auto min-w-[45%] text-xs border-collapse">
                  <tbody>
                    <tr>
                      <td className="border border-gray-300 px-2 py-1 w-[55%]">As per Above Table</td>
                      <td className="border border-gray-300 px-2 py-1 text-right font-mono">{fmt(total)}</td>
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
                <p className="text-[10px] text-gray-400 mt-1">A difference is also reported in the Exception tab.</p>
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
