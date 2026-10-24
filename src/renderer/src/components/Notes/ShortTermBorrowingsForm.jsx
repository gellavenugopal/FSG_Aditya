/**
 * Short-Term Borrowings Note Form
 * Sections:
 *   A. Summary table (auto-computed from B, by nature × secured/unsecured)
 *   B. Loan-level details (loaded from mapped TB)
 *   C. Repayment & Security details (optional print)
 *
 * No "Current Maturities" concept — short-term borrowings are current by nature.
 */
import React, { useState, useEffect, useMemo } from 'react'

const NATURE_OPTIONS = [
  'Cash Credit / Overdraft from Banks',
  'Short-Term Loans from Banks',
  'Short-Term Loans from Other Parties',
  'Commercial Paper',
  'Deposits',
  'Loans and Advances from Related Parties',
  'Bills Discounted / Bills Payable',
  'Other Short-Term Borrowings',
]

const FREQUENCY_OPTIONS = ['Monthly', 'Quarterly', 'Half-Yearly', 'Yearly', 'At Call', 'On Demand']

const INP  = 'w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white'
const NUM  = INP + ' text-right font-mono'
const LABEL = 'block text-[10px] text-gray-500 mb-0.5 font-medium'
const TH   = 'border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-700 bg-gray-50 text-right whitespace-nowrap'
const THL  = 'border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-700 bg-gray-50 text-left whitespace-nowrap'
const TD   = 'border border-gray-200 px-1 py-0.5 text-right'
const TDL  = 'border border-gray-200 px-1 py-0.5'

const num  = (v) => parseFloat(v) || 0
function fmtN(n) { return n != null && n !== '' && !isNaN(n) ? Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—' }

function emptyLoan(tbLedger = '', grossCY = 0, grossPY = 0) {
  return {
    id: Math.random().toString(36).slice(2),
    tbLedger,
    lenderPrintName: '',
    nature: 'Cash Credit / Overdraft from Banks',
    securedUnsecured: 'Secured',
    grossCY, grossPY,
    roi: '', repaymentRemarks: '',
    repaymentFormat: 'tabular', repaymentParagraph: '',
    natureOfSecurity: '', guarantee: '', chargeRanking: '',
    securityFormat: 'tabular', securityParagraph: '',
  }
}

// ── Section A: Summary ────────────────────────────────────────────────────────
function SectionA({ loans, bsSTB }) {
  const summary = useMemo(() => {
    return NATURE_OPTIONS.map(nature => {
      const matching = loans.filter(l => l.nature === nature)
      const cy_sec = matching.filter(l => l.securedUnsecured === 'Secured').reduce((s, l) => s + num(l.grossCY), 0)
      const cy_uns = matching.filter(l => l.securedUnsecured === 'Unsecured').reduce((s, l) => s + num(l.grossCY), 0)
      const py_sec = matching.filter(l => l.securedUnsecured === 'Secured').reduce((s, l) => s + num(l.grossPY), 0)
      const py_uns = matching.filter(l => l.securedUnsecured === 'Unsecured').reduce((s, l) => s + num(l.grossPY), 0)
      return { nature, cy_sec, cy_uns, py_sec, py_uns }
    }).filter(r => r.cy_sec || r.cy_uns || r.py_sec || r.py_uns)
  }, [loans])

  const totalCY = summary.reduce((s, r) => s + r.cy_sec + r.cy_uns, 0)
  const totalPY = summary.reduce((s, r) => s + r.py_sec + r.py_uns, 0)
  const bsAmt   = bsSTB != null ? Math.abs(bsSTB) : null
  const tallies = bsAmt != null && Math.abs(totalCY - bsAmt) < 1

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <span className="text-xs font-semibold text-gray-700">A. Short-Term Borrowings Summary</span>
        {bsAmt != null && (
          <span className={`text-[10px] px-2 py-0.5 rounded border font-medium ${tallies ? 'bg-green-50 border-green-300 text-green-700' : 'bg-red-50 border-red-300 text-red-700'}`}>
            {tallies ? '✓ Matches BS' : `⚠ BS ₹${fmtN(bsAmt)} vs Note ₹${fmtN(totalCY)}`}
          </span>
        )}
      </div>
      <p className="text-[10px] text-gray-400 mb-2">Auto-computed from Section B. Grouped by Nature × Secured/Unsecured.</p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs mb-2">
          <thead>
            <tr>
              <th className={THL} rowSpan={2}>Nature of Loan</th>
              <th className={TH} colSpan={2}>Current Year</th>
              <th className={TH} colSpan={2}>Previous Year</th>
            </tr>
            <tr>
              <th className={TH}>Secured</th>
              <th className={TH}>Unsecured</th>
              <th className={TH}>Secured</th>
              <th className={TH}>Unsecured</th>
            </tr>
          </thead>
          <tbody>
            {summary.length === 0 && (
              <tr><td colSpan={5} className={TDL + ' text-center text-gray-400 italic'}>Fill Section B to auto-populate</td></tr>
            )}
            {summary.map(r => (
              <tr key={r.nature}>
                <td className={TDL}>{r.nature}</td>
                <td className={TD}>{r.cy_sec  ? fmtN(r.cy_sec)  : '—'}</td>
                <td className={TD}>{r.cy_uns  ? fmtN(r.cy_uns)  : '—'}</td>
                <td className={TD}>{r.py_sec  ? fmtN(r.py_sec)  : '—'}</td>
                <td className={TD}>{r.py_uns  ? fmtN(r.py_uns)  : '—'}</td>
              </tr>
            ))}
            <tr className="font-bold bg-blue-50">
              <td className={TDL}>Total</td>
              <td colSpan={2} className={TD}>{fmtN(totalCY)}</td>
              <td colSpan={2} className={TD}>{fmtN(totalPY)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Single Loan Editor ─────────────────────────────────────────────────────────
function LoanEditor({ loan, onChange, onRemove, lenderNames }) {
  const set = (field, val) => onChange({ ...loan, [field]: val })

  return (
    <div className="border border-gray-200 rounded-lg p-3 mb-3 bg-white">
      <div className="flex items-start justify-between mb-2">
        <span className="text-[10px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5">
          {loan.tbLedger || 'Manual entry'}
        </span>
        <button onClick={onRemove} className="text-red-400 hover:text-red-600 text-xs ml-2">✕</button>
      </div>

      {/* Core fields */}
      <div className="grid grid-cols-3 gap-2 mb-2">
        <div>
          <label className={LABEL}>Lender Print Name *</label>
          <input className={INP} value={loan.lenderPrintName} onChange={e => set('lenderPrintName', e.target.value)}
            placeholder="e.g. HDFC Bank CC A/c" list={`stb-lenders-${loan.id}`} />
          <datalist id={`stb-lenders-${loan.id}`}>
            {lenderNames.map(n => <option key={n} value={n} />)}
          </datalist>
        </div>
        <div>
          <label className={LABEL}>Nature of Borrowing</label>
          <select className={INP} value={loan.nature} onChange={e => set('nature', e.target.value)}>
            {NATURE_OPTIONS.map(n => <option key={n}>{n}</option>)}
          </select>
        </div>
        <div>
          <label className={LABEL}>Secured / Unsecured</label>
          <select className={INP} value={loan.securedUnsecured} onChange={e => set('securedUnsecured', e.target.value)}>
            <option>Secured</option>
            <option>Unsecured</option>
          </select>
        </div>
      </div>

      {/* Amounts */}
      <div className="overflow-x-auto mb-2">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className={THL}>Lender / Facility</th>
              <th className={TH}>Current Year (₹)</th>
              <th className={TH}>Previous Year (₹)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={TDL + ' font-medium'}>{loan.lenderPrintName || loan.tbLedger || '—'}</td>
              <td className={TD + ' text-gray-600'}>{fmtN(loan.grossCY)}</td>
              <td className={TD + ' text-gray-600'}>{fmtN(loan.grossPY)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Rate of Interest */}
      <div className="mb-2">
        <label className={LABEL}>Rate of Interest / Terms</label>
        <input className={INP} value={loan.roi} onChange={e => set('roi', e.target.value)}
          placeholder="e.g. MCLR+1.5% p.a., repayable on demand" />
      </div>

      {/* Repayment & Terms */}
      <details className="mb-2">
        <summary className="text-[10px] font-semibold text-gray-600 cursor-pointer hover:text-gray-800">▶ Repayment & Terms</summary>
        <div className="mt-2">
          <div className="flex items-center gap-2 mb-2">
            <label className="text-[10px] text-gray-500">Format:</label>
            {['tabular','paragraph'].map(f => (
              <button key={f} onClick={() => set('repaymentFormat', f)}
                className={`text-[10px] px-2 py-0.5 rounded border ${loan.repaymentFormat === f ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'}`}>
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          {loan.repaymentFormat === 'tabular' ? (
            <div className="grid grid-cols-2 gap-2">
              <div><label className={LABEL}>Repayment Frequency</label>
                <select className={INP} value={loan.frequency} onChange={e => set('frequency', e.target.value)}>
                  {FREQUENCY_OPTIONS.map(f => <option key={f}>{f}</option>)}
                </select>
              </div>
              <div><label className={LABEL}>Remarks</label>
                <input className={INP} value={loan.repaymentRemarks} onChange={e => set('repaymentRemarks', e.target.value)} />
              </div>
            </div>
          ) : (
            <textarea className={INP + ' resize-y'} rows={3} value={loan.repaymentParagraph}
              onChange={e => set('repaymentParagraph', e.target.value)}
              placeholder="Describe repayment terms..." />
          )}
        </div>
      </details>

      {/* Security */}
      <details>
        <summary className="text-[10px] font-semibold text-gray-600 cursor-pointer hover:text-gray-800">▶ Security Details</summary>
        <div className="mt-2">
          <div className="flex items-center gap-2 mb-2">
            <label className="text-[10px] text-gray-500">Format:</label>
            {['tabular','paragraph'].map(f => (
              <button key={f} onClick={() => set('securityFormat', f)}
                className={`text-[10px] px-2 py-0.5 rounded border ${loan.securityFormat === f ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'}`}>
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          {loan.securityFormat === 'tabular' ? (
            <div className="grid grid-cols-3 gap-2">
              <div><label className={LABEL}>Nature of Security</label>
                <input className={INP} value={loan.natureOfSecurity} onChange={e => set('natureOfSecurity', e.target.value)}
                  placeholder="e.g. Hypothecation of Stock & Book Debts" /></div>
              <div><label className={LABEL}>Guarantee</label>
                <input className={INP} value={loan.guarantee} onChange={e => set('guarantee', e.target.value)}
                  placeholder="e.g. Personal Guarantee of Directors" /></div>
              <div><label className={LABEL}>Charge Ranking</label>
                <input className={INP} value={loan.chargeRanking} onChange={e => set('chargeRanking', e.target.value)}
                  placeholder="e.g. First Charge / Pari-Passu" /></div>
            </div>
          ) : (
            <textarea className={INP + ' resize-y'} rows={3} value={loan.securityParagraph}
              onChange={e => set('securityParagraph', e.target.value)}
              placeholder="Describe security details..." />
          )}
        </div>
      </details>
    </div>
  )
}

// ── Main Form ─────────────────────────────────────────────────────────────────
export default function ShortTermBorrowingsForm({ tbId, entityId, useEntityLevel, noteNum, noteTitle, bsSTB, onClose, onSaved }) {
  const [loans, setLoans]           = useState([])
  const [printRepayment, setPrintRepayment] = useState(true)
  const [printSecurity, setPrintSecurity]   = useState(true)
  const [saving, setSaving]         = useState(false)
  const [loading, setLoading]       = useState(true)
  const [activeSection, setActiveSection] = useState('B')

  useEffect(() => {
    if (!tbId && !entityId) return
    const fetchSaved = useEntityLevel
      ? window.api?.getEntityNoteDetails(entityId, noteNum, noteTitle)
      : window.api?.getNoteDetails(tbId, noteNum, noteTitle)
    Promise.all([
      fetchSaved,
      tbId ? window.api?.findMappedByFilter(tbId, {
        mapping2_resultant: 'Short-term borrowings',
      }).catch(() => []) : Promise.resolve([]),
    ]).then(([saved, tbRows]) => {
      if (saved) {
        setLoans(saved.loans || [])
        setPrintRepayment(saved.printRepayment !== false)
        setPrintSecurity(saved.printSecurity !== false)
      } else if (tbRows?.length) {
        const mapped = tbRows.map(r => emptyLoan(
          r.name,
          Math.abs(parseFloat(r.closing_balance) || 0),
          Math.abs(parseFloat(r.opening_balance) || 0),
        ))
        setLoans(mapped)
      }
    }).finally(() => setLoading(false))
  }, [tbId, entityId, noteNum, useEntityLevel])

  const lenderNames = useMemo(() =>
    [...new Set(loans.map(l => l.lenderPrintName).filter(Boolean))], [loans])

  const totalCY = loans.reduce((s, l) => s + num(l.grossCY), 0)
  const totalPY = loans.reduce((s, l) => s + num(l.grossPY), 0)

  const save = async () => {
    setSaving(true)
    try {
      if (useEntityLevel) {
        await window.api?.saveEntityNoteDetails({
          entityId, noteNum, noteTitle,
          data: { loans, printRepayment, printSecurity }
        })
      } else {
        await window.api?.saveNoteDetails({
          tbId, noteNum, noteTitle,
          data: { loans, printRepayment, printSecurity }
        })
      }
      onSaved?.()
      onClose()
    } finally { setSaving(false) }
  }

  const SECTIONS = [
    { key: 'A', label: 'A. Summary' },
    { key: 'B', label: 'B. Borrowing Details' },
    { key: 'options', label: 'Print Options' },
  ]

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 9999 }}>
      <div className="modal-box overflow-hidden flex flex-col"
        style={{ maxWidth: '1000px', width: '95vw', maxHeight: '92vh' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 pb-3 mb-3 shrink-0">
          <div>
            <h2 className="text-base font-bold" style={{ color: 'var(--color-primary)' }}>
              Note {noteNum}: {noteTitle} — Details
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              TB ledgers auto-loaded. Multiple ledgers with same Lender Print Name are consolidated in output.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl ml-4">&times;</button>
        </div>

        {/* Section tabs */}
        <div className="flex gap-1 mb-3 shrink-0 flex-wrap">
          {SECTIONS.map(s => (
            <button key={s.key} onClick={() => setActiveSection(s.key)}
              className={`px-3 py-1 text-xs rounded-full font-medium transition ${activeSection === s.key ? 'text-white' : 'text-gray-600 bg-gray-100 hover:bg-gray-200'}`}
              style={activeSection === s.key ? { background: 'var(--color-primary)' } : {}}>
              {s.label}
            </button>
          ))}
          <span className="ml-auto text-[10px] text-gray-400 self-center">
            {loans.length} borrowing{loans.length !== 1 ? 's' : ''} · Total CY ₹{fmtN(totalCY)}
          </span>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading && <div className="text-gray-500 text-sm p-4">Loading TB data...</div>}

          {!loading && activeSection === 'A' && (
            <SectionA loans={loans} bsSTB={bsSTB} />
          )}

          {!loading && activeSection === 'B' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-gray-600">
                  TB ledgers auto-loaded. Fill <strong>Lender Print Name</strong>, <strong>Nature</strong>,
                  and <strong>Secured/Unsecured</strong>. Expand each row for terms and security.
                </p>
                <button onClick={() => setLoans([...loans, emptyLoan()])}
                  className="text-xs text-blue-600 hover:underline shrink-0 ml-3">+ Add Manually</button>
              </div>

              {loans.length === 0 && (
                <div className="text-center text-gray-400 text-sm py-8 border-2 border-dashed border-gray-200 rounded">
                  No Short-term borrowings found in the mapped TB.<br />
                  <button onClick={() => setLoans([emptyLoan()])} className="text-blue-600 hover:underline text-sm mt-2">+ Add manually</button>
                </div>
              )}

              {loans.map((loan, i) => (
                <LoanEditor key={loan.id} loan={loan} lenderNames={lenderNames}
                  onChange={updated => setLoans(loans.map((l, li) => li === i ? updated : l))}
                  onRemove={() => setLoans(loans.filter((_, li) => li !== i))}
                />
              ))}
            </div>
          )}

          {!loading && activeSection === 'options' && (
            <div className="space-y-4 p-2">
              <p className="text-xs text-gray-600">Choose which sections to include in printed output.</p>
              {[
                ['printRepayment', printRepayment, setPrintRepayment, 'Print Repayment & Terms', 'Rate of interest, frequency and repayment terms per lender'],
                ['printSecurity',  printSecurity,  setPrintSecurity,  'Print Security Details',  'Nature of security, guarantee and charge ranking'],
              ].map(([key, val, setVal, label, desc]) => (
                <label key={key} className="flex items-start gap-3 cursor-pointer p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
                  <input type="checkbox" checked={val} onChange={e => setVal(e.target.checked)} className="mt-0.5" />
                  <div>
                    <div className="text-sm font-medium text-gray-800">{label}</div>
                    <div className="text-xs text-gray-500">{desc}</div>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-gray-200 pt-3 mt-3 shrink-0">
          <button onClick={onClose} className="px-4 py-1.5 border border-gray-300 text-gray-600 rounded text-sm hover:bg-gray-50">Cancel</button>
          <button onClick={save} disabled={saving}
            className="px-4 py-1.5 text-white rounded text-sm font-medium disabled:opacity-40"
            style={{ background: 'var(--color-primary)' }}>
            {saving ? 'Saving…' : 'Save Note Details'}
          </button>
        </div>
      </div>
    </div>
  )
}
