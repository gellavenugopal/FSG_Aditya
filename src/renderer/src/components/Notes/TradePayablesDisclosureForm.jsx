import React, { useState, useEffect } from 'react'

// Row keys and Schedule III labels for Trade Payables ageing
export const TP_AGEING_ROWS = [
  { key: 'msme',            label: '(i) MSME' },
  { key: 'others',          label: '(ii) Others' },
  { key: 'disputed_msme',   label: '(iii) Disputed dues- MSME' },
  { key: 'disputed_others', label: '(iv) Disputed dues- Others' },
  { key: 'total_due',       label: 'Total Due', isTotal: true },
  { key: 'msme_undue',      label: 'MSME - Undue' },
  { key: 'others_undue',    label: 'Others - Undue' },
  { key: 'msme_unbilled',   label: 'MSME - Unbilled dues' },
  { key: 'others_unbilled', label: 'Others - Unbilled dues' },
  { key: 'total',           label: 'Total', isTotal: true },
]

export const TP_AGEING_BUCKETS = [
  { key: 'less1y', label: 'Less than 1 yr.' },
  { key: '1y2y',   label: '1-2 yrs.' },
  { key: '2y3y',   label: '2-3 yrs.' },
  { key: 'more3y', label: 'More than 3 yrs.' },
]
const BUCKETS = TP_AGEING_BUCKETS

// Rows that make up the MSME / Others categories for the Check
export const TP_MSME_ROWS   = ['msme', 'disputed_msme', 'msme_undue', 'msme_unbilled']
export const TP_OTHERS_ROWS = ['others', 'disputed_others', 'others_undue', 'others_unbilled']
const MSME_ROWS   = TP_MSME_ROWS
const OTHERS_ROWS = TP_OTHERS_ROWS
const ROWS = TP_AGEING_ROWS

// ── MSME Act, 2006 disclosure items ─────────────────────────────────────────
// Item (a) is a Principal/Interest/Total break-up (per the Schedule III
// illustrative format), not a single combined figure.
const MSME_ITEMS = [
  { key: 'a', label: 'Amount remaining unpaid to any supplier at the end of each accounting year', isPrincipalInterest: true },
  { key: 'b', label: 'The amount of interest paid by the buyer in terms of section 16 of the Micro, Small and Medium Enterprises Development Act, 2006 (7 of 2006), along with the amount of the payment made to the supplier beyond the appointed day during each accounting year' },
  { key: 'c', label: 'The amount of interest due and payable for the period of delay in making payment (which have been paid but beyond the appointed day during the year) but without adding the interest specified under the Micro, Small and Medium Enterprises Development Act, 2006' },
  { key: 'd', label: 'The amount of interest accrued and remaining unpaid at the end of each accounting year' },
  { key: 'e', label: 'The amount of further interest remaining due and payable even in the succeeding years, until such date when the interest dues above are actually paid to the small enterprise, for the purpose of disallowance of a deductible expenditure under section 23 of the Micro, Small and Medium Enterprises Development Act, 2006' },
]

const num = (v) => parseFloat(v) || 0
const fmt = (n) => {
  const v = parseFloat(n)
  if (!v || isNaN(v)) return '—'
  const abs = Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return v < 0 ? `(${abs})` : abs
}

function emptyPeriod() {
  const p = {}
  for (const r of ROWS) {
    p[r.key] = { less1y: '', '1y2y': '', '2y3y': '', more3y: '' }
  }
  return p
}

function emptyAgeingData() {
  return {
    cy: emptyPeriod(),
    py: emptyPeriod(),
    tbCY: { msme: '', others: '' },
    tbPY: { msme: '', others: '' },
    includeInOutput: false,
  }
}

function emptyMSMEData() {
  return {
    cy: { a: { principal: '', interest: '' }, b: '', c: '', d: '', e: '' },
    py: { a: { principal: '', interest: '' }, b: '', c: '', d: '', e: '' },
    includeInOutput: false,
  }
}

const INP = 'w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white'
const NUM = INP + ' text-right font-mono'
const THL = 'border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-700 bg-gray-50 text-left whitespace-nowrap'
const TH = 'border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-700 bg-gray-50 text-right whitespace-nowrap'
const TDL = 'border border-gray-200 px-2 py-1 text-left'
const TD = 'border border-gray-200 px-2 py-1 text-right'

// ── Ageing Schedule tab (Company only — see constitution gate in the main form) ──
function AgeingTab({ ageing, setAgeing, noteTotal, notePrevTotal }) {
  const setCell = (period, rowKey, bucketKey, val) => {
    setAgeing(prev => ({
      ...prev,
      [period]: { ...prev[period], [rowKey]: { ...prev[period][rowKey], [bucketKey]: val } },
    }))
  }
  const rowTotal = (period, rowKey) => BUCKETS.reduce((s, b) => s + num(ageing[period]?.[rowKey]?.[b.key]), 0)
  const categoryTotal = (period, rowKeys) => rowKeys.reduce((s, rk) => s + rowTotal(period, rk), 0)

  const renderTable = (period, heading) => (
    <div className="mb-4">
      <p className="text-sm font-bold text-blue-900 mb-2">Trade Payables ageing schedule ({heading})</p>
      <div className="overflow-x-auto border border-gray-200 rounded">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-blue-50">
              <th rowSpan={2} className="border border-gray-300 px-2 py-1 text-left font-semibold align-bottom w-[28%]">Particulars</th>
              <th colSpan={4} className="border border-gray-300 px-2 py-1 text-center font-semibold">Outstanding for following periods from due date of payment</th>
              <th rowSpan={2} className="border border-gray-300 px-2 py-1 text-right font-semibold align-bottom">Total</th>
            </tr>
            <tr className="bg-blue-50">
              {BUCKETS.map(b => <th key={b.key} className="border border-gray-300 px-2 py-1 text-right font-semibold">{b.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {ROWS.map(row => (
              <tr key={row.key} className={`border-b ${row.isTotal ? 'bg-blue-50 font-semibold' : 'hover:bg-gray-50'}`}>
                <td className="border border-gray-200 px-2 py-1">{row.label}</td>
                {BUCKETS.map(b => (
                  <td key={b.key} className="border border-gray-200 px-1 py-0.5">
                    <input type="number" className={NUM}
                      value={ageing[period]?.[row.key]?.[b.key] || ''}
                      onChange={e => setCell(period, row.key, b.key, e.target.value)}
                      placeholder="0" step="0.01" />
                  </td>
                ))}
                <td className="border border-gray-200 px-2 py-1 text-right font-mono font-semibold">{fmt(rowTotal(period, row.key))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )

  const renderCheck = (period, tbKey, tbNoteTotal) => {
    const schedMsme   = categoryTotal(period, MSME_ROWS)
    const schedOthers = categoryTotal(period, OTHERS_ROWS)
    const schedTotal  = schedMsme + schedOthers
    const tbMsme   = num(ageing[tbKey]?.msme)
    const tbOthers = num(ageing[tbKey]?.others)
    const tbTotal  = num(tbNoteTotal)
    const diffCell = (d) => (
      <td className={`border border-gray-300 px-2 py-1 text-right font-mono font-semibold ${Math.abs(d) < 0.005 ? 'text-green-600' : 'text-red-600'}`}>{fmt(d)}</td>
    )
    return (
      <div className="mb-8">
        <p className="text-xs font-bold text-gray-800 mb-2 underline">Check</p>
        <table className="w-auto min-w-[60%] text-xs border-collapse">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 px-2 py-1 text-left font-semibold w-[35%]"></th>
              <th className="border border-gray-300 px-2 py-1 text-right font-semibold w-[20%]">MSME</th>
              <th className="border border-gray-300 px-2 py-1 text-right font-semibold w-[20%]">Others</th>
              <th className="border border-gray-300 px-2 py-1 text-right font-semibold w-[20%]">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border border-gray-300 px-2 py-1">As per Above Schedule</td>
              <td className="border border-gray-300 px-2 py-1 text-right font-mono">{fmt(schedMsme)}</td>
              <td className="border border-gray-300 px-2 py-1 text-right font-mono">{fmt(schedOthers)}</td>
              <td className="border border-gray-300 px-2 py-1 text-right font-mono">{fmt(schedTotal)}</td>
            </tr>
            <tr>
              <td className="border border-gray-300 px-2 py-1">As per Trial Balance</td>
              <td className="border border-gray-300 px-1 py-0.5">
                <input type="number" className={NUM} value={ageing[tbKey]?.msme || ''}
                  onChange={e => setAgeing(prev => ({ ...prev, [tbKey]: { ...prev[tbKey], msme: e.target.value } }))}
                  placeholder="0" step="0.01" />
              </td>
              <td className="border border-gray-300 px-1 py-0.5">
                <input type="number" className={NUM} value={ageing[tbKey]?.others || ''}
                  onChange={e => setAgeing(prev => ({ ...prev, [tbKey]: { ...prev[tbKey], others: e.target.value } }))}
                  placeholder="0" step="0.01" />
              </td>
              <td className="border border-gray-300 px-2 py-1 text-right font-mono bg-gray-50" title="Auto-pulled from Trial Balance note total">{fmt(tbTotal)}</td>
            </tr>
            <tr className="bg-gray-50 font-semibold">
              <td className="border border-gray-300 px-2 py-1">Difference</td>
              {diffCell(tbMsme - schedMsme)}
              {diffCell(tbOthers - schedOthers)}
              {diffCell(tbTotal - schedTotal)}
            </tr>
          </tbody>
        </table>
        <p className="text-[10px] text-gray-400 mt-1">Total as per Trial Balance is auto-pulled from the note. Enter MSME / Others break-up manually.</p>
      </div>
    )
  }

  return (
    <>
      {renderTable('cy', 'Current Year')}
      {renderCheck('cy', 'tbCY', noteTotal)}
      {renderTable('py', 'Previous Year')}
      {renderCheck('py', 'tbPY', notePrevTotal)}
      <div className="p-3 bg-blue-50 border border-blue-200 rounded">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={ageing.includeInOutput || false}
            onChange={e => setAgeing(prev => ({ ...prev, includeInOutput: e.target.checked }))}
            className="rounded border-gray-300" />
          <span className="text-xs font-medium text-gray-700">Always include in PDF & Excel (even if all zeros)</span>
        </label>
      </div>
    </>
  )
}

// ── MSME Disclosure tab (all constitutions) ─────────────────────────────────
function MSMETab({ msme, setMsme }) {
  const setA = (period, field, val) => setMsme(prev => ({ ...prev, [period]: { ...prev[period], a: { ...prev[period].a, [field]: val } } }))
  const setPlain = (period, key, val) => setMsme(prev => ({ ...prev, [period]: { ...prev[period], [key]: val } }))
  const totalA = (period) => num(msme[period]?.a?.principal) + num(msme[period]?.a?.interest)

  return (
    <>
      <p className="text-xs text-gray-600 mb-4">
        Fill in the amounts relating to Micro, Small and Medium Enterprises as per the Micro, Small and Medium Enterprises Development Act, 2006.
      </p>
      <div className="overflow-x-auto mb-4">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className={THL + ' w-[5%]'}>Sl No.</th>
              <th className={THL + ' w-[55%]'}>Particulars</th>
              <th className={TH + ' w-[20%]'}>Current Year (₹)</th>
              <th className={TH + ' w-[20%]'}>Previous Year (₹)</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-gray-200 bg-gray-50">
              <td className={TDL + ' font-semibold text-center'}>(a)</td>
              <td className={TDL} colSpan={3}>{MSME_ITEMS[0].label}:</td>
            </tr>
            <tr className="hover:bg-gray-50 border-b border-gray-200">
              <td className={TDL}></td>
              <td className={TDL + ' pl-6'}>Principal</td>
              <td className="border border-gray-200 px-1 py-0.5"><input type="number" className={NUM} value={msme.cy?.a?.principal || ''} onChange={e => setA('cy', 'principal', e.target.value)} placeholder="0" step="0.01" /></td>
              <td className="border border-gray-200 px-1 py-0.5"><input type="number" className={NUM} value={msme.py?.a?.principal || ''} onChange={e => setA('py', 'principal', e.target.value)} placeholder="0" step="0.01" /></td>
            </tr>
            <tr className="hover:bg-gray-50 border-b border-gray-200">
              <td className={TDL}></td>
              <td className={TDL + ' pl-6'}>Interest</td>
              <td className="border border-gray-200 px-1 py-0.5"><input type="number" className={NUM} value={msme.cy?.a?.interest || ''} onChange={e => setA('cy', 'interest', e.target.value)} placeholder="0" step="0.01" /></td>
              <td className="border border-gray-200 px-1 py-0.5"><input type="number" className={NUM} value={msme.py?.a?.interest || ''} onChange={e => setA('py', 'interest', e.target.value)} placeholder="0" step="0.01" /></td>
            </tr>
            <tr className="border-b border-gray-200 font-semibold bg-gray-50">
              <td className={TDL}></td>
              <td className={TDL + ' pl-6'}>Total</td>
              <td className={TD + ' font-mono'}>{fmt(totalA('cy'))}</td>
              <td className={TD + ' font-mono'}>{fmt(totalA('py'))}</td>
            </tr>
            {MSME_ITEMS.slice(1).map(item => (
              <tr key={item.key} className="hover:bg-gray-50 border-b border-gray-200">
                <td className={TDL + ' font-semibold text-center'}>({item.key})</td>
                <td className={TDL}>{item.label}</td>
                <td className="border border-gray-200 px-1 py-0.5"><input type="number" className={NUM} value={msme.cy?.[item.key] || ''} onChange={e => setPlain('cy', item.key, e.target.value)} placeholder="0" step="0.01" /></td>
                <td className="border border-gray-200 px-1 py-0.5"><input type="number" className={NUM} value={msme.py?.[item.key] || ''} onChange={e => setPlain('py', item.key, e.target.value)} placeholder="0" step="0.01" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="p-3 bg-blue-50 border border-blue-200 rounded mb-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={msme.includeInOutput || false}
            onChange={e => setMsme(prev => ({ ...prev, includeInOutput: e.target.checked }))}
            className="rounded border-gray-300" />
          <span className="text-xs text-gray-700 font-medium">Always include MSME details in PDF & Excel (even if all values are zero)</span>
        </label>
      </div>
      <p className="text-[10px] text-gray-400">Source: Micro, Small and Medium Enterprises Development Act, 2006 (Act No. 7 of 2006)</p>
    </>
  )
}

export default function TradePayablesDisclosureForm({ tbId, entityId, useEntityLevel, noteNum, noteTitle, noteTotal = 0, notePrevTotal = 0, constitution, onClose, onSaved }) {
  // Branch entities keep this disclosure once for the whole entity.
  const scopeId = useEntityLevel ? entityId : tbId
  const isCompany = parseInt(constitution) === 3
  const [activeTab, setActiveTab] = useState(isCompany ? 'ageing' : 'msme')
  const [ageing, setAgeing] = useState(emptyAgeingData())
  const [msme, setMsme] = useState(emptyMSMEData())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!scopeId || !noteNum) return
    setLoading(true)
    Promise.resolve(useEntityLevel
      ? window.api?.getEntityNoteDetails?.(entityId, noteNum, noteTitle)
      : window.api?.notesGetTradePayablesAging?.(tbId, noteNum, noteTitle))
      .then(d => {
        if (!d) return
        // Combined shape: { ageing: {...}, msme: {...} }. Legacy rows (saved
        // before MSME/ageing were split into one blob) store the ageing data
        // directly at the top level instead of under .ageing.
        const ag = d.ageing || (d.cy ? d : null)
        if (ag && ag.cy) {
          setAgeing(prev => ({
            ...prev, ...ag,
            cy: { ...emptyPeriod(), ...ag.cy }, py: { ...emptyPeriod(), ...ag.py },
            tbCY: ag.tbCY || { msme: '', others: '' }, tbPY: ag.tbPY || { msme: '', others: '' },
          }))
        }
        if (d.msme) {
          setMsme(prev => ({
            ...prev, ...d.msme,
            cy: { ...emptyMSMEData().cy, ...d.msme.cy, a: { ...emptyMSMEData().cy.a, ...(d.msme.cy?.a || {}) } },
            py: { ...emptyMSMEData().py, ...d.msme.py, a: { ...emptyMSMEData().py.a, ...(d.msme.py?.a || {}) } },
          }))
        }
      })
      .catch(err => console.error('Load Trade Payables disclosure failed:', err))
      .finally(() => setLoading(false))
  }, [scopeId, useEntityLevel, noteNum, noteTitle])

  const handleSave = async () => {
    if (!scopeId || !noteNum || !noteTitle) { setError('Missing note or TB information'); return }
    try {
      setLoading(true)
      setError('')
      if (useEntityLevel) {
        // One record holds both parts, as on the Trial Balance side.
        const existing = await Promise.resolve(window.api?.getEntityNoteDetails?.(entityId, noteNum, noteTitle)).catch(() => null)
        const next = { ...(existing || {}), msme }
        if (isCompany) next.ageing = ageing
        await window.api?.saveEntityNoteDetails?.({ entityId, noteNum, noteTitle, data: next })
      } else {
        if (isCompany) await window.api?.notesSaveTradePayablesAging?.(tbId, noteNum, noteTitle, ageing)
        await window.api?.notesSaveMSME?.(tbId, noteNum, noteTitle, msme)
      }
      setSaved(true)
      onSaved?.()
    } catch (err) {
      setError(err.message || 'Failed to save')
    } finally {
      setLoading(false)
    }
  }

  const TABS = [
    ...(isCompany ? [{ key: 'ageing', label: 'Ageing Schedule' }] : []),
    { key: 'msme', label: 'MSME Disclosure' },
  ]

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-6xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 z-10 bg-blue-600 text-white px-6 py-3">
          <h2 className="text-base font-bold">Note {noteNum}: {noteTitle}</h2>
          <p className="text-xs text-blue-100 mt-0.5">
            {isCompany ? 'Ageing schedule and MSME Act disclosure' : 'MSME Act disclosure'}
          </p>
        </div>

        {TABS.length > 1 && (
          <div className="flex gap-1 px-6 pt-3 border-b border-gray-200 shrink-0">
            {TABS.map(t => (
              <button key={t.key} onClick={() => setActiveTab(t.key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-t border-b-2 transition ${
                  activeTab === t.key ? 'border-blue-600 text-blue-700 bg-blue-50' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                {t.label}
              </button>
            ))}
          </div>
        )}

        <div className="p-6">
          {error && <div className="mb-4 p-3 bg-red-50 border border-red-300 rounded text-xs text-red-700">{error}</div>}
          {saved && <div className="mb-4 p-3 bg-green-50 border border-green-300 rounded text-xs text-green-700">Saved successfully.</div>}

          {loading ? (
            <p className="text-center text-gray-400 py-8">Loading...</p>
          ) : (
            <>
              {activeTab === 'ageing' && isCompany && (
                <AgeingTab ageing={ageing} setAgeing={setAgeing} noteTotal={noteTotal} notePrevTotal={notePrevTotal} />
              )}
              {activeTab === 'msme' && (
                <MSMETab msme={msme} setMsme={setMsme} />
              )}
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
