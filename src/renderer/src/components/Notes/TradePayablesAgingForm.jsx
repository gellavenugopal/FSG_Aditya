/**
 * Trade Payables Ageing Schedule Form
 * Outstanding for following periods from due date of payment
 */
import React, { useState, useEffect } from 'react'

const INP = 'w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white'
const NUM = INP + ' text-right font-mono'
const LABEL = 'block text-[10px] text-gray-500 mb-0.5 font-medium'
const TH = 'border border-gray-200 px-1.5 py-1 text-xs font-semibold text-gray-700 bg-gray-50 text-right whitespace-nowrap'
const THL = 'border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-700 bg-gray-50 text-left whitespace-nowrap'
const TD = 'border border-gray-200 px-1 py-1 text-right'
const TDL = 'border border-gray-200 px-2 py-1 text-left'

const num = (v) => parseFloat(v) || 0
function fmtN(n) { return n != null && n !== '' && !isNaN(n) ? Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—' }

const AGING_BUCKETS = [
  { key: 'less1y', label: 'Less than 1 yr.' },
  { key: '1y2y', label: '1-2 yrs.' },
  { key: '2y3y', label: '2-3 yrs.' },
  { key: 'more3y', label: 'More than 3 yrs.' },
]

const PAYABLES_ROWS = [
  { key: 'msme', label: '(i) MSME', category: 'msme', group: 'due' },
  { key: 'others', label: '(ii) Others', category: 'others', group: 'due' },
  { key: 'dis_msme', label: '(iii) Disputed dues - MSME', category: 'msme', group: 'due' },
  { key: 'dis_others', label: '(iv) Disputed dues - Others', category: 'others', group: 'due' },
  { key: 'total_due', label: 'Total Due', category: 'total', isSubtotal: true },
  { key: 'msme_undue', label: 'MSME - Undue', category: 'msme', group: 'undue' },
  { key: 'others_undue', label: 'Others - Undue', category: 'others', group: 'undue' },
  { key: 'msme_unbilled', label: 'MSME - Unbilled dues', category: 'msme', group: 'unbilled' },
  { key: 'others_unbilled', label: 'Others - Unbilled dues', category: 'others', group: 'unbilled' },
  { key: 'total_tp', label: 'Total', category: 'total', isTotal: true },
]

function emptyData() {
  return {
    cy: {},
    py: {},
    reconciliation: {
      cy: { msme: '', others: '', total: '' },
      py: { msme: '', others: '', total: '' },
    },
    tbAmountCY: { msme: '', others: '', total: '' },
    tbAmountPY: { msme: '', others: '', total: '' },
    includeInOutput: false,
  }
}

export default function TradePayablesAgingForm({ tbId, noteNum, noteTitle, onClose, onSaved }) {
  const [data, setData] = useState(() => {
    const initial = emptyData()
    for (const row of PAYABLES_ROWS) {
      initial.cy[row.key] = {}
      initial.py[row.key] = {}
      for (const bucket of AGING_BUCKETS) {
        initial.cy[row.key][bucket.key] = ''
        initial.py[row.key][bucket.key] = ''
      }
    }
    return initial
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!tbId || !noteNum) return
    setLoading(true)
    setError('')

    window.api?.notesGetTradePayablesAging?.(tbId, noteNum)
      .then(d => {
        if (d) {
          // Handle both old format (direct ageing data) and new format (combined with MSME)
          const ageingData = d.ageing || d
          setData(ageingData)
        }
      })
      .catch(err => {
        console.error('Failed to load Trade Payables data:', err)
      })
      .finally(() => setLoading(false))
  }, [tbId, noteNum])

  const handleChange = (period, rowKey, bucketKey, val) => {
    setData({
      ...data,
      [period]: {
        ...data[period],
        [rowKey]: { ...data[period][rowKey], [bucketKey]: val }
      }
    })
  }

  const handleTBChange = (period, category, val) => {
    setData({
      ...data,
      [period === 'cy' ? 'tbAmountCY' : 'tbAmountPY']: {
        ...data[period === 'cy' ? 'tbAmountCY' : 'tbAmountPY'],
        [category]: val
      }
    })
  }

  const calculateRowTotal = (period, rowKey) => {
    const row = data[period][rowKey] || {}
    return AGING_BUCKETS.reduce((sum, bucket) => sum + num(row[bucket.key]), 0)
  }

  const calculateCategoryTotal = (period, category) => {
    return PAYABLES_ROWS
      .filter(r => r.category === category && r.group === 'due')
      .reduce((sum, row) => sum + calculateRowTotal(period, row.key), 0)
  }

  const calculateTotal = (period) => {
    return PAYABLES_ROWS
      .filter(r => r.isTotal)
      .reduce((sum, row) => sum + calculateRowTotal(period, row.key), 0)
  }

  const handleSave = async () => {
    if (!tbId || !noteNum || !noteTitle) {
      setError('Missing note or TB information')
      return
    }

    try {
      setLoading(true)
      setError('')
      await window.api?.notesSaveTradePayablesAging?.(tbId, noteNum, noteTitle, data)
      onSaved?.()
    } catch (err) {
      setError(err.message || 'Failed to save Trade Payables Ageing Schedule')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-6xl max-h-[95vh] overflow-y-auto">
        <div className="sticky top-0 bg-blue-600 text-white px-6 py-3 border-b border-blue-700">
          <h2 className="text-base font-bold">Note {noteNum}: {noteTitle}</h2>
          <p className="text-xs text-blue-100 mt-1">Trade Payables Ageing Schedule - Outstanding for following periods from due date of payment</p>
        </div>

        {loading && <div className="p-6 text-center text-gray-400">Loading Trade Payables data...</div>}

        {!loading && (
          <div className="p-6">
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-300 rounded text-xs text-red-700">{error}</div>
            )}

            {/* Current Year Table */}
            <div className="mb-8">
              <h3 className="text-sm font-bold text-blue-900 mb-2">Current Year</h3>
              <div className="overflow-x-auto border border-gray-200 rounded mb-4">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-blue-50">
                      <th className={THL + ' w-[35%]'}>Particulars</th>
                      {AGING_BUCKETS.map(b => <th key={b.key} className={TH}>{b.label}</th>)}
                      <th className={TH}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PAYABLES_ROWS.map(row => (
                      <tr key={row.key} className={`border-b border-gray-200 ${row.isTotal ? 'bg-blue-50 font-bold' : row.isSubtotal ? 'bg-gray-50 font-semibold' : 'hover:bg-gray-50'}`}>
                        <td className={TDL}>{row.label}</td>
                        {AGING_BUCKETS.map(bucket => (
                          <td key={bucket.key} className={TD}>
                            <input
                              type="number"
                              className={NUM}
                              value={data.cy[row.key]?.[bucket.key] || ''}
                              onChange={e => handleChange('cy', row.key, bucket.key, e.target.value)}
                              placeholder="0"
                              step="0.01"
                            />
                          </td>
                        ))}
                        <td className={TD + ' font-semibold'}>{fmtN(calculateRowTotal('cy', row.key))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Previous Year Table */}
            <div className="mb-8">
              <h3 className="text-sm font-bold text-blue-900 mb-2">Previous Year</h3>
              <div className="overflow-x-auto border border-gray-200 rounded mb-4">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-blue-50">
                      <th className={THL + ' w-[35%]'}>Particulars</th>
                      {AGING_BUCKETS.map(b => <th key={b.key} className={TH}>{b.label}</th>)}
                      <th className={TH}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PAYABLES_ROWS.map(row => (
                      <tr key={row.key} className={`border-b border-gray-200 ${row.isTotal ? 'bg-blue-50 font-bold' : row.isSubtotal ? 'bg-gray-50 font-semibold' : 'hover:bg-gray-50'}`}>
                        <td className={TDL}>{row.label}</td>
                        {AGING_BUCKETS.map(bucket => (
                          <td key={bucket.key} className={TD}>
                            <input
                              type="number"
                              className={NUM}
                              value={data.py[row.key]?.[bucket.key] || ''}
                              onChange={e => handleChange('py', row.key, bucket.key, e.target.value)}
                              placeholder="0"
                              step="0.01"
                            />
                          </td>
                        ))}
                        <td className={TD + ' font-semibold'}>{fmtN(calculateRowTotal('py', row.key))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Reconciliation Check */}
            <div className="mb-8 border-t-2 border-blue-300 pt-6">
              <h3 className="text-sm font-bold text-blue-900 mb-3">Reconciliation Check</h3>
              <div className="grid grid-cols-2 gap-6">
                {/* CY Reconciliation */}
                <div className="border border-gray-200 rounded p-3 bg-blue-50">
                  <h4 className="text-xs font-semibold text-blue-900 mb-2">Current Year</h4>
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-gray-300">
                        <th className="py-1 px-2 text-left">Check</th>
                        <th className="py-1 px-2 text-right">MSME</th>
                        <th className="py-1 px-2 text-right">Others</th>
                        <th className="py-1 px-2 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-gray-200">
                        <td className="py-1 px-2 text-left text-gray-700">As per Above Schedule</td>
                        <td className="py-1 px-2 text-right font-mono">{fmtN(calculateCategoryTotal('cy', 'msme'))}</td>
                        <td className="py-1 px-2 text-right font-mono">{fmtN(calculateCategoryTotal('cy', 'others'))}</td>
                        <td className="py-1 px-2 text-right font-mono font-semibold">{fmtN(calculateTotal('cy'))}</td>
                      </tr>
                      <tr className="border-b border-gray-200">
                        <td className="py-1 px-2 text-left">As per Trial Balance</td>
                        <td className="py-1 px-2"><input type="number" className={NUM + ' w-24'} value={data.tbAmountCY.msme} onChange={e => handleTBChange('cy', 'msme', e.target.value)} placeholder="0" step="0.01" /></td>
                        <td className="py-1 px-2"><input type="number" className={NUM + ' w-24'} value={data.tbAmountCY.others} onChange={e => handleTBChange('cy', 'others', e.target.value)} placeholder="0" step="0.01" /></td>
                        <td className="py-1 px-2"><input type="number" className={NUM + ' w-24'} value={data.tbAmountCY.total} onChange={e => handleTBChange('cy', 'total', e.target.value)} placeholder="0" step="0.01" /></td>
                      </tr>
                      <tr className={Math.abs((calculateCategoryTotal('cy', 'msme') - num(data.tbAmountCY.msme)) + (calculateCategoryTotal('cy', 'others') - num(data.tbAmountCY.others)) + (calculateTotal('cy') - num(data.tbAmountCY.total))) > 0.5 ? 'bg-red-50' : ''}>
                        <td className="py-1 px-2 text-left font-semibold">Difference</td>
                        <td className={`py-1 px-2 text-right font-semibold ${Math.abs(calculateCategoryTotal('cy', 'msme') - num(data.tbAmountCY.msme)) > 0.5 ? 'text-red-600' : 'text-green-600'}`}>{fmtN(calculateCategoryTotal('cy', 'msme') - num(data.tbAmountCY.msme))}</td>
                        <td className={`py-1 px-2 text-right font-semibold ${Math.abs(calculateCategoryTotal('cy', 'others') - num(data.tbAmountCY.others)) > 0.5 ? 'text-red-600' : 'text-green-600'}`}>{fmtN(calculateCategoryTotal('cy', 'others') - num(data.tbAmountCY.others))}</td>
                        <td className={`py-1 px-2 text-right font-semibold ${Math.abs(calculateTotal('cy') - num(data.tbAmountCY.total)) > 0.5 ? 'text-red-600' : 'text-green-600'}`}>{fmtN(calculateTotal('cy') - num(data.tbAmountCY.total))}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* PY Reconciliation */}
                <div className="border border-gray-200 rounded p-3 bg-blue-50">
                  <h4 className="text-xs font-semibold text-blue-900 mb-2">Previous Year</h4>
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-gray-300">
                        <th className="py-1 px-2 text-left">Check</th>
                        <th className="py-1 px-2 text-right">MSME</th>
                        <th className="py-1 px-2 text-right">Others</th>
                        <th className="py-1 px-2 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-gray-200">
                        <td className="py-1 px-2 text-left text-gray-700">As per Above Schedule</td>
                        <td className="py-1 px-2 text-right font-mono">{fmtN(calculateCategoryTotal('py', 'msme'))}</td>
                        <td className="py-1 px-2 text-right font-mono">{fmtN(calculateCategoryTotal('py', 'others'))}</td>
                        <td className="py-1 px-2 text-right font-mono font-semibold">{fmtN(calculateTotal('py'))}</td>
                      </tr>
                      <tr className="border-b border-gray-200">
                        <td className="py-1 px-2 text-left">As per Trial Balance</td>
                        <td className="py-1 px-2"><input type="number" className={NUM + ' w-24'} value={data.tbAmountPY.msme} onChange={e => handleTBChange('py', 'msme', e.target.value)} placeholder="0" step="0.01" /></td>
                        <td className="py-1 px-2"><input type="number" className={NUM + ' w-24'} value={data.tbAmountPY.others} onChange={e => handleTBChange('py', 'others', e.target.value)} placeholder="0" step="0.01" /></td>
                        <td className="py-1 px-2"><input type="number" className={NUM + ' w-24'} value={data.tbAmountPY.total} onChange={e => handleTBChange('py', 'total', e.target.value)} placeholder="0" step="0.01" /></td>
                      </tr>
                      <tr className={Math.abs((calculateCategoryTotal('py', 'msme') - num(data.tbAmountPY.msme)) + (calculateCategoryTotal('py', 'others') - num(data.tbAmountPY.others)) + (calculateTotal('py') - num(data.tbAmountPY.total))) > 0.5 ? 'bg-red-50' : ''}>
                        <td className="py-1 px-2 text-left font-semibold">Difference</td>
                        <td className={`py-1 px-2 text-right font-semibold ${Math.abs(calculateCategoryTotal('py', 'msme') - num(data.tbAmountPY.msme)) > 0.5 ? 'text-red-600' : 'text-green-600'}`}>{fmtN(calculateCategoryTotal('py', 'msme') - num(data.tbAmountPY.msme))}</td>
                        <td className={`py-1 px-2 text-right font-semibold ${Math.abs(calculateCategoryTotal('py', 'others') - num(data.tbAmountPY.others)) > 0.5 ? 'text-red-600' : 'text-green-600'}`}>{fmtN(calculateCategoryTotal('py', 'others') - num(data.tbAmountPY.others))}</td>
                        <td className={`py-1 px-2 text-right font-semibold ${Math.abs(calculateTotal('py') - num(data.tbAmountPY.total)) > 0.5 ? 'text-red-600' : 'text-green-600'}`}>{fmtN(calculateTotal('py') - num(data.tbAmountPY.total))}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="p-3 bg-blue-50 border border-blue-200 rounded">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={data.includeInOutput || false} onChange={e => setData({ ...data, includeInOutput: e.target.checked })} className="rounded" />
                <span className="text-xs font-medium text-gray-700">Always include in PDF & Excel (even if all zeros)</span>
              </label>
            </div>
          </div>
        )}

        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-3 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-xs rounded border border-gray-300 text-gray-700 hover:bg-gray-100 font-medium">Cancel</button>
          <button onClick={handleSave} disabled={loading} className="px-4 py-2 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 font-medium disabled:bg-gray-400">
            {loading ? 'Saving...' : 'Save & Close'}
          </button>
        </div>
      </div>
    </div>
  )
}
