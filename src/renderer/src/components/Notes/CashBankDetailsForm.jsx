/**
 * Cash & Bank Balances Disclosure Form
 * Other Details relating to Cash & Bank Balances
 */
import React, { useState, useEffect } from 'react'

const INP = 'w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white'
const NUM = INP + ' text-right font-mono'
const LABEL = 'block text-[10px] text-gray-500 mb-0.5 font-medium'
const TH = 'border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-700 bg-gray-50 text-right whitespace-nowrap'
const THL = 'border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-700 bg-gray-50 text-left whitespace-nowrap'
const TD = 'border border-gray-200 px-2 py-1 text-right'
const TDL = 'border border-gray-200 px-2 py-1 text-left'

const num = (v) => parseFloat(v) || 0
function fmtN(n) { return n != null && n !== '' && !isNaN(n) ? Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—' }

// Cash & Bank disclosure items — exported so the PDF/Excel exporters
// (buildHTML.js / buildExcel.js) print the exact same labels/order as this
// form, single source of truth.
export const CASH_BANK_ITEMS = [
  {
    key: 'a',
    label: 'Earmarked balances with banks'
  },
  {
    key: 'b',
    label: 'Balances with banks to the extent held as margin money or security against the borrowings, guarantees, other commitments'
  },
  {
    key: 'c',
    label: 'Repatriation restrictions, if any, in respect of cash and bank balances'
  },
]

function emptyDisclosure() {
  return {
    items: {
      a: { amount: '', amountPY: '', remarks: '' },
      b: { amount: '', amountPY: '', remarks: '' },
      c: { amount: '', amountPY: '', remarks: '' },
    },
    includeInOutput: false,
  }
}

export default function CashBankDetailsForm({ tbId, entityId, useEntityLevel, noteNum, noteTitle, onClose, onSaved }) {
  // Branch entities keep this disclosure once for the whole entity.
  const scopeId = useEntityLevel ? entityId : tbId
  const [data, setData] = useState(emptyDisclosure())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Load existing data when form opens
  useEffect(() => {
    if (!scopeId || !noteNum) return
    setLoading(true)
    setError('')

    Promise.resolve(useEntityLevel
      ? window.api?.getEntityNoteDetails?.(entityId, noteNum, noteTitle)
      : window.api?.notesGetCashBank?.(tbId, noteNum, noteTitle))
      .then(d => {
        if (d) setData(d)
      })
      .catch(err => {
        console.error('Failed to load Cash & Bank data:', err)
      })
      .finally(() => setLoading(false))
  }, [scopeId, useEntityLevel, noteNum, noteTitle])

  const handleChange = (key, field, val) => {
    setData({
      ...data,
      items: {
        ...data.items,
        [key]: { ...data.items[key], [field]: val }
      }
    })
  }

  const handleSave = async () => {
    if (!scopeId || !noteNum || !noteTitle) {
      setError('Missing note or TB information')
      return
    }

    try {
      setLoading(true)
      setError('')
      if (useEntityLevel) await window.api?.saveEntityNoteDetails?.({ entityId, noteNum, noteTitle, data })
      else await window.api?.notesSaveCashBank?.(tbId, noteNum, noteTitle, data)
      onSaved?.()
    } catch (err) {
      setError(err.message || 'Failed to save Cash & Bank details')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-5xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-blue-600 text-white px-6 py-3 border-b border-blue-700">
          <h2 className="text-base font-bold">Note {noteNum}: {noteTitle}</h2>
          <p className="text-xs text-blue-100 mt-1">Other Details relating to Cash & Bank Balances included above</p>
        </div>

        {loading && (
          <div className="p-6 text-center text-gray-400">Loading Cash & Bank details...</div>
        )}

        {!loading && (
          <div className="p-6">
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-300 rounded text-xs text-red-700">
                {error}
              </div>
            )}

            <p className="text-xs text-gray-600 mb-4">
              Enter details relating to Cash and Bank Balances. Amount (Current Year), Amount (Previous Year) and Remarks fields can be filled.
            </p>

            {/* Disclosure Table */}
            <div className="overflow-x-auto mb-6">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>
                    <th className={THL + ' w-[5%]'}>Sl No.</th>
                    <th className={THL + ' w-[35%]'}>Particulars</th>
                    <th className={TH + ' w-[15%]'}>Amount — CY (₹)</th>
                    <th className={TH + ' w-[15%]'}>Amount — PY (₹)</th>
                    <th className={THL + ' w-[30%]'}>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {CASH_BANK_ITEMS.map((item) => (
                    <tr key={item.key} className="hover:bg-gray-50 border-b border-gray-200">
                      <td className={TDL + ' font-semibold text-center'}>({item.key})</td>
                      <td className={TDL}>{item.label}</td>
                      <td className="border border-gray-200 px-1 py-0.5">
                        <input
                          type="number"
                          className={NUM}
                          value={data.items[item.key].amount || ''}
                          onChange={e => handleChange(item.key, 'amount', e.target.value)}
                          placeholder="0"
                          step="0.01"
                        />
                      </td>
                      <td className="border border-gray-200 px-1 py-0.5">
                        <input
                          type="number"
                          className={NUM}
                          value={data.items[item.key].amountPY || ''}
                          onChange={e => handleChange(item.key, 'amountPY', e.target.value)}
                          placeholder="0"
                          step="0.01"
                        />
                      </td>
                      <td className="border border-gray-200 px-2 py-0.5">
                        <input
                          type="text"
                          className={INP}
                          value={data.items[item.key].remarks || ''}
                          onChange={e => handleChange(item.key, 'remarks', e.target.value)}
                          placeholder="Enter remarks (if any)"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mb-6 text-[10px] text-gray-500">
              The table prints under Cash and Bank Balances only when at least one Current Year or Previous Year amount is filled in. The Previous Year column prints only when some item has a Previous Year figure.
            </p>

            <p className="text-[10px] text-gray-400">
              As per IND AS 7 (Cash Flow Statements) and Schedule III of Companies Act, 2013.
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-3 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs rounded border border-gray-300 text-gray-700 hover:bg-gray-100 font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="px-4 py-2 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 font-medium disabled:bg-gray-400"
          >
            {loading ? 'Saving...' : 'Save & Close'}
          </button>
        </div>
      </div>
    </div>
  )
}
