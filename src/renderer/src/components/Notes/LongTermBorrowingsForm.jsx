/**
 * Long Term Borrowings Note Form
 * Sections:
 *   A. Summary table (auto-computed from B, consolidated by nature × secured/unsecured)
 *   B. Loan-level details (loaded from mapped TB, user fills lender/current maturity)
 *   C. Repayment details (tabular or paragraph)
 *   D. Security details (tabular or paragraph)
 *   E. Reconciliation (gross → current maturity → net long-term, per lender)
 *
 * Printing: multiple TB ledgers with same Lender Print Name are consolidated.
 * Annexure: shows individual ledger breakdown.
 */
import React, { useState, useEffect, useMemo } from 'react'

// ── Constants ─────────────────────────────────────────────────────────────────
const NATURE_OPTIONS = [
  'Bonds / Debentures',
  'Term Loans from Banks',
  'Term Loans from Other Parties',
  'Deferred Payment Liabilities',
  'Deposits',
  'Loans and Advances from Related Parties',
  'Long-term Maturities of Finance Lease Obligations',
  'Other Loans and Advances',
]

const FREQUENCY_OPTIONS = ['Monthly', 'Quarterly', 'Half-Yearly', 'Yearly', 'Bullet', 'Irregular']

const INP = 'w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white'
const NUM = INP + ' text-right font-mono'
const LABEL = 'block text-[10px] text-gray-500 mb-0.5 font-medium'
const TH = 'border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-700 bg-gray-50 text-right whitespace-nowrap'
const THL = 'border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-700 bg-gray-50 text-left whitespace-nowrap'
const TD = 'border border-gray-200 px-1 py-0.5 text-right'
const TDL = 'border border-gray-200 px-1 py-0.5'

const num = (v) => parseFloat(v) || 0
function fmtN(n) { return n != null && n !== '' && !isNaN(n) ? Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—' }

// ── Default empty loan entry ───────────────────────────────────────────────────
function emptyLoan(tbLedger = '', grossCY = 0, grossPY = 0) {
  return {
    id: Math.random().toString(36).slice(2),
    tbLedger,
    lenderPrintName: '',
    nature: 'Term Loans from Banks',
    securedUnsecured: 'Secured',
    grossCY, grossPY,
    currentMaturityCY: '',
    currentMaturityPY: '',
    // Repayment
    roi: '', emi: '', frequency: 'Monthly', remainingInstalments: '', finalMaturityDate: '', repaymentRemarks: '',
    repaymentFormat: 'tabular', repaymentParagraph: '',
    // Security
    natureOfSecurity: '', guarantee: '', chargeRanking: '',
    securityFormat: 'tabular', securityParagraph: '',
  }
}

// ── Section A: Summary (nature × secured/unsecured) ───────────────────────────
function SectionA({ loans }) {
  const summary = useMemo(() => {
    return NATURE_OPTIONS.map(nature => {
      const matching = loans.filter(l => l.nature === nature)
      const cy_secured   = matching.filter(l => l.securedUnsecured === 'Secured').reduce((s, l) => s + num(l.grossCY) - num(l.currentMaturityCY), 0)
      const cy_unsecured = matching.filter(l => l.securedUnsecured === 'Unsecured').reduce((s, l) => s + num(l.grossCY) - num(l.currentMaturityCY), 0)
      const py_secured   = matching.filter(l => l.securedUnsecured === 'Secured').reduce((s, l) => s + num(l.grossPY) - num(l.currentMaturityPY), 0)
      const py_unsecured = matching.filter(l => l.securedUnsecured === 'Unsecured').reduce((s, l) => s + num(l.grossPY) - num(l.currentMaturityPY), 0)
      return { nature, cy_secured, cy_unsecured, py_secured, py_unsecured }
    }).filter(r => r.cy_secured || r.cy_unsecured || r.py_secured || r.py_unsecured)
  }, [loans])

  const totalCY = summary.reduce((s, r) => s + r.cy_secured + r.cy_unsecured, 0)
  const totalPY = summary.reduce((s, r) => s + r.py_secured + r.py_unsecured, 0)

  return (
    <div>
      <p className="text-xs font-semibold text-gray-700 mb-1">A. Long-Term Borrowings — Summary by Nature (Net of Current Maturities)</p>
      <p className="text-[10px] text-gray-400 mb-2">Auto-computed from Section B. Net = Gross − Current Maturities, grouped by Nature × Secured/Unsecured.</p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs mb-2">
          <thead>
            <tr>
              <th className={THL} rowSpan={2}>Nature of Loan</th>
              <th className={TH} colSpan={2}>Current Year</th>
              <th className={TH} colSpan={2}>Previous Year</th>
            </tr>
            <tr>
              <th className={TH}>Secured</th><th className={TH}>Unsecured</th>
              <th className={TH}>Secured</th><th className={TH}>Unsecured</th>
            </tr>
          </thead>
          <tbody>
            {summary.length === 0 && (
              <tr><td colSpan={5} className={TDL + ' text-center text-gray-400 italic'}>Fill Section B to auto-populate</td></tr>
            )}
            {summary.map(r => (
              <tr key={r.nature}>
                <td className={TDL}>{r.nature}</td>
                <td className={TD}>{r.cy_secured ? fmtN(r.cy_secured) : '—'}</td>
                <td className={TD}>{r.cy_unsecured ? fmtN(r.cy_unsecured) : '—'}</td>
                <td className={TD}>{r.py_secured ? fmtN(r.py_secured) : '—'}</td>
                <td className={TD}>{r.py_unsecured ? fmtN(r.py_unsecured) : '—'}</td>
              </tr>
            ))}
            <tr className="font-bold bg-blue-50">
              <td className={TDL}>Total Net LT Borrowings</td>
              <td colSpan={2} className={TD}>{fmtN(totalCY)}</td>
              <td colSpan={2} className={TD}>{fmtN(totalPY)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Section R: TB Reconciliation ──────────────────────────────────────────────
// Compares per-ledger form values against the Mapped TB rows.
// Highlights any difference as "Unreconciled Long Term Borrowings".
function SectionReconciliation({ loans, tbRows, tbRawLTB }) {
  const tbRaw = num(tbRawLTB)

  // Build a map of TB value per ledger name
  const tbByLedger = useMemo(() => {
    const m = {}
    for (const r of (tbRows || [])) {
      const name = (r.name || r.ledger_name || '').trim()
      if (name) m[name] = Math.abs(parseFloat(r.closing_balance) || 0)
    }
    return m
  }, [tbRows])

  // Per-loan reconciliation rows
  const rows = useMemo(() => loans.map(l => {
    const tbVal   = tbByLedger[l.tbLedger] ?? 0
    const formVal = num(l.grossCY)
    const cm      = num(l.currentMaturityCY)
    const netLT   = formVal - cm
    const diff    = formVal - tbVal          // +ve means form > TB; -ve means TB > form
    return { ...l, tbVal, formVal, cm, netLT, diff }
  }), [loans, tbByLedger])

  // Manually added loans (no tbLedger match in TB)
  const manualLoans = rows.filter(r => !r.tbLedger || !(r.tbLedger in tbByLedger))

  const totalTB     = tbRaw || Object.values(tbByLedger).reduce((s, v) => s + v, 0)
  const totalForm   = rows.reduce((s, r) => s + r.formVal, 0)
  const totalCM     = rows.reduce((s, r) => s + r.cm,      0)
  const totalNetLT  = totalForm - totalCM
  const totalDiff   = totalForm - totalTB
  const reconciled  = Math.abs(totalDiff) < 1

  return (
    <div>
      {/* ── Level 1: Summary reconciliation ── */}
      <p className="text-xs font-semibold text-gray-700 mb-2">Reconciliation with Mapped Trial Balance</p>
      <table className="w-full border-collapse text-xs mb-4">
        <tbody>
          <tr className="border border-gray-200">
            <td className={TDL + ' w-2/3 font-medium'}>Mapped TB — Long Term Borrowings (A)</td>
            <td className={TD + ' font-mono'}>{fmtN(totalTB)}</td>
          </tr>
          <tr className="border border-gray-200">
            <td className={TDL}>As per Fill Details Form — Gross Total (B)</td>
            <td className={TD + ' font-mono'}>{fmtN(totalForm)}</td>
          </tr>
          <tr className={`border border-gray-200 font-bold ${reconciled ? 'bg-green-50' : 'bg-red-50'}`}>
            <td className={TDL + (reconciled ? ' text-green-700' : ' text-red-700')}>
              {reconciled ? '✓ Reconciled (A − B = 0)' : '⚠ Unreconciled Long Term Borrowings (A − B)'}
            </td>
            <td className={TD + (reconciled ? ' text-green-700' : ' text-red-700 font-mono')}>
              {reconciled ? '—' : fmtN(Math.abs(totalTB - totalForm))}
            </td>
          </tr>
          <tr className="border border-gray-200 border-t-2">
            <td className={TDL + ' pl-6 text-gray-500'}>Less: Current Maturities (→ Short-term Borrowings) (C)</td>
            <td className={TD + ' text-orange-700 font-mono'}>{totalCM ? fmtN(totalCM) : '—'}</td>
          </tr>
          <tr className="border border-gray-200 font-bold bg-blue-50">
            <td className={TDL + ' text-blue-800'}>Net Long-Term Borrowings shown on Balance Sheet (B − C)</td>
            <td className={TD + ' text-blue-900 font-mono'}>{fmtN(totalNetLT)}</td>
          </tr>
        </tbody>
      </table>

      {/* ── Level 2: Per-ledger reconciliation ── */}
      {!reconciled && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded">
          <p className="text-[11px] font-semibold text-red-700 mb-2">
            Unreconciled amount of ₹{fmtN(Math.abs(totalTB - totalForm))} — details below.
            Correct the gross amounts in Section B to match the TB.
          </p>
        </div>
      )}

      <p className="text-xs font-semibold text-gray-700 mb-1">Per-Ledger Detail</p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className={THL}>Lender / TB Ledger</th>
              <th className={TH}>TB Value (Mapped)</th>
              <th className={TH}>Form Gross (CY)</th>
              <th className={TH}>Difference</th>
              <th className={TH}>Current Maturity</th>
              <th className={TH}>Net LT Borrowing</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const hasDiff = Math.abs(r.diff) >= 1
              return (
                <tr key={r.id} className={hasDiff ? 'bg-red-50/60' : ''}>
                  <td className={TDL}>{r.lenderPrintName || r.tbLedger || <span className="italic text-gray-400">Manual</span>}</td>
                  <td className={TD}>{r.tbVal ? fmtN(r.tbVal) : '—'}</td>
                  <td className={TD}>{fmtN(r.formVal)}</td>
                  <td className={TD + (hasDiff ? ' text-red-600 font-semibold' : ' text-green-600')}>
                    {hasDiff ? fmtN(r.diff) : '✓'}
                  </td>
                  <td className={TD + ' text-orange-700'}>{r.cm ? fmtN(r.cm) : '—'}</td>
                  <td className={TD + ' font-semibold'}>{fmtN(r.netLT)}</td>
                </tr>
              )
            })}
            {/* TB ledgers not covered by any loan in the form */}
            {Object.entries(tbByLedger).filter(([name]) => !loans.some(l => l.tbLedger === name)).map(([name, val]) => (
              <tr key={'tb-' + name} className="bg-amber-50">
                <td className={TDL + ' text-amber-700'}>{name} <span className="text-[10px] italic">(in TB, not in form)</span></td>
                <td className={TD + ' text-amber-700'}>{fmtN(val)}</td>
                <td className={TD + ' text-red-500'}>—</td>
                <td className={TD + ' text-red-600 font-semibold'}>{fmtN(-val)}</td>
                <td className={TD}>—</td>
                <td className={TD}>—</td>
              </tr>
            ))}
            <tr className="font-bold bg-blue-50">
              <td className={TDL}>Total</td>
              <td className={TD}>{fmtN(totalTB)}</td>
              <td className={TD}>{fmtN(totalForm)}</td>
              <td className={TD + (reconciled ? ' text-green-700' : ' text-red-600')}>{reconciled ? '✓' : fmtN(totalDiff)}</td>
              <td className={TD + ' text-orange-700'}>{totalCM ? fmtN(totalCM) : '—'}</td>
              <td className={TD}>{fmtN(totalNetLT)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-gray-400 mt-2">
        Difference = Form Gross − TB Value. Positive = Form exceeds TB; Negative = TB exceeds Form. Both must be investigated and corrected.
      </p>
    </div>
  )
}

// ── Single Loan Editor ─────────────────────────────────────────────────────────
function LoanEditor({ loan, onChange, onRemove, lenderNames }) {
  const set = (field, val) => onChange({ ...loan, [field]: val })
  const netCY = num(loan.grossCY) - num(loan.currentMaturityCY)
  const netPY = num(loan.grossPY) - num(loan.currentMaturityPY)

  return (
    <div className="border border-gray-200 rounded-lg p-3 mb-3 bg-white">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5">{loan.tbLedger || 'Manual entry'}</span>
        </div>
        <button onClick={onRemove} className="text-red-400 hover:text-red-600 text-xs ml-2 shrink-0">✕</button>
      </div>

      {/* Core fields */}
      <div className="grid grid-cols-3 gap-2 mb-2">
        <div className="col-span-1">
          <label className={LABEL}>Lender Print Name *</label>
          <input className={INP} value={loan.lenderPrintName} onChange={e => set('lenderPrintName', e.target.value)}
            placeholder="e.g. HDFC Bank" list={`lenders-${loan.id}`} />
          <datalist id={`lenders-${loan.id}`}>
            {lenderNames.map(n => <option key={n} value={n} />)}
          </datalist>
        </div>
        <div>
          <label className={LABEL}>Nature of Loan</label>
          <select className={INP} value={loan.nature} onChange={e => set('nature', e.target.value)}>
            {NATURE_OPTIONS.map(n => <option key={n}>{n}</option>)}
          </select>
        </div>
        <div>
          <label className={LABEL}>Secured / Unsecured</label>
          <select className={INP} value={loan.securedUnsecured} onChange={e => set('securedUnsecured', e.target.value)}>
            <option>Secured</option><option>Unsecured</option>
          </select>
        </div>
      </div>

      {/* Amounts */}
      <div className="overflow-x-auto mb-2">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className={THL}>Particulars</th>
              <th className={TH}>CY Gross</th>
              <th className={TH}>CY Current Maturity</th>
              <th className={TH}>CY Net LT</th>
              <th className={TH}>PY Gross</th>
              <th className={TH}>PY Current Maturity</th>
              <th className={TH}>PY Net LT</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={TDL + ' font-medium'}>{loan.lenderPrintName || loan.tbLedger || '—'}</td>
              <td className={TD + ' text-gray-500'}>{fmtN(loan.grossCY)}</td>
              <td className="border border-gray-200 px-1 py-0.5">
                <input className={NUM} type="number" value={loan.currentMaturityCY}
                  onChange={e => set('currentMaturityCY', e.target.value)} placeholder="0" />
              </td>
              <td className={TD + ' font-semibold ' + (netCY < 0 ? 'text-red-600' : '')}>{fmtN(netCY)}</td>
              <td className={TD + ' text-gray-500'}>{fmtN(loan.grossPY)}</td>
              <td className="border border-gray-200 px-1 py-0.5">
                <input className={NUM} type="number" value={loan.currentMaturityPY}
                  onChange={e => set('currentMaturityPY', e.target.value)} placeholder="0" />
              </td>
              <td className={TD + ' font-semibold ' + (netPY < 0 ? 'text-red-600' : '')}>{fmtN(netPY)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Repayment */}
      <details className="mb-2">
        <summary className="text-[10px] font-semibold text-gray-600 cursor-pointer hover:text-gray-800">▶ Repayment Details</summary>
        <div className="mt-2">
          <div className="flex items-center gap-2 mb-2">
            <label className="text-[10px] text-gray-500">Format:</label>
            <button onClick={() => set('repaymentFormat', 'tabular')}
              className={`text-[10px] px-2 py-0.5 rounded border ${loan.repaymentFormat === 'tabular' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'}`}>
              Tabular
            </button>
            <button onClick={() => set('repaymentFormat', 'paragraph')}
              className={`text-[10px] px-2 py-0.5 rounded border ${loan.repaymentFormat === 'paragraph' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'}`}>
              Paragraph
            </button>
          </div>
          {loan.repaymentFormat === 'tabular' ? (
            <div className="grid grid-cols-3 gap-2">
              <div><label className={LABEL}>Rate of Interest</label>
                <input className={INP} value={loan.roi} onChange={e => set('roi', e.target.value)} placeholder="e.g. MCLR+2% / 12%" /></div>
              <div><label className={LABEL}>EMI / Instalment Amount</label>
                <input className={NUM} type="number" value={loan.emi} onChange={e => set('emi', e.target.value)} /></div>
              <div><label className={LABEL}>Frequency</label>
                <select className={INP} value={loan.frequency} onChange={e => set('frequency', e.target.value)}>
                  {FREQUENCY_OPTIONS.map(f => <option key={f}>{f}</option>)}
                </select></div>
              <div><label className={LABEL}>Remaining Instalments</label>
                <input className={NUM} type="number" value={loan.remainingInstalments} onChange={e => set('remainingInstalments', e.target.value)} /></div>
              <div><label className={LABEL}>Final Maturity Date</label>
                <input className={INP} type="date" value={loan.finalMaturityDate} onChange={e => set('finalMaturityDate', e.target.value)} /></div>
              <div><label className={LABEL}>Remarks</label>
                <input className={INP} value={loan.repaymentRemarks} onChange={e => set('repaymentRemarks', e.target.value)} /></div>
            </div>
          ) : (
            <textarea className={INP + ' resize-y'} rows={3} value={loan.repaymentParagraph}
              onChange={e => set('repaymentParagraph', e.target.value)}
              placeholder="Describe repayment terms in paragraph form..." />
          )}
        </div>
      </details>

      {/* Security */}
      <details>
        <summary className="text-[10px] font-semibold text-gray-600 cursor-pointer hover:text-gray-800">▶ Security Details</summary>
        <div className="mt-2">
          <div className="flex items-center gap-2 mb-2">
            <label className="text-[10px] text-gray-500">Format:</label>
            <button onClick={() => set('securityFormat', 'tabular')}
              className={`text-[10px] px-2 py-0.5 rounded border ${loan.securityFormat === 'tabular' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'}`}>
              Tabular
            </button>
            <button onClick={() => set('securityFormat', 'paragraph')}
              className={`text-[10px] px-2 py-0.5 rounded border ${loan.securityFormat === 'paragraph' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'}`}>
              Paragraph
            </button>
          </div>
          {loan.securityFormat === 'tabular' ? (
            <div className="grid grid-cols-3 gap-2">
              <div><label className={LABEL}>Nature of Security</label>
                <input className={INP} value={loan.natureOfSecurity} onChange={e => set('natureOfSecurity', e.target.value)}
                  placeholder="e.g. Hypothecation of Plant & Machinery" /></div>
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
              placeholder="Describe security details in paragraph form..." />
          )}
        </div>
      </details>
    </div>
  )
}

// ── Section E: Reconciliation ─────────────────────────────────────────────────
function SectionE({ loans }) {
  // Group by Lender Print Name
  const grouped = useMemo(() => {
    const map = {}
    for (const l of loans) {
      const key = l.lenderPrintName || l.tbLedger || 'Unknown'
      if (!map[key]) map[key] = { grossCY: 0, grossPY: 0, cmCY: 0, cmPY: 0 }
      map[key].grossCY += num(l.grossCY)
      map[key].grossPY += num(l.grossPY)
      map[key].cmCY    += num(l.currentMaturityCY)
      map[key].cmPY    += num(l.currentMaturityPY)
    }
    return Object.entries(map).map(([lender, v]) => ({
      lender, ...v,
      netCY: v.grossCY - v.cmCY,
      netPY: v.grossPY - v.cmPY,
    }))
  }, [loans])

  const totals = grouped.reduce((s, r) => ({
    grossCY: s.grossCY + r.grossCY, grossPY: s.grossPY + r.grossPY,
    cmCY: s.cmCY + r.cmCY, cmPY: s.cmPY + r.cmPY,
    netCY: s.netCY + r.netCY, netPY: s.netPY + r.netPY,
  }), { grossCY: 0, grossPY: 0, cmCY: 0, cmPY: 0, netCY: 0, netPY: 0 })

  return (
    <div>
      <p className="text-xs font-semibold text-gray-700 mb-2">E. Reconciliation — Gross Outstanding → Current Maturities → Net Long-Term</p>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            <th className={THL} rowSpan={2}>Lender</th>
            <th className={TH} colSpan={3}>Current Year</th>
            <th className={TH} colSpan={3}>Previous Year</th>
          </tr>
          <tr>
            <th className={TH}>Gross Outstanding</th>
            <th className={TH}>Current Maturity</th>
            <th className={TH}>Net Long-Term</th>
            <th className={TH}>Gross Outstanding</th>
            <th className={TH}>Current Maturity</th>
            <th className={TH}>Net Long-Term</th>
          </tr>
        </thead>
        <tbody>
          {grouped.map(r => (
            <tr key={r.lender}>
              <td className={TDL}>{r.lender}</td>
              <td className={TD}>{fmtN(r.grossCY)}</td>
              <td className={TD + ' text-orange-700'}>{r.cmCY ? fmtN(r.cmCY) : '—'}</td>
              <td className={TD + ' font-semibold'}>{fmtN(r.netCY)}</td>
              <td className={TD}>{fmtN(r.grossPY)}</td>
              <td className={TD + ' text-orange-700'}>{r.cmPY ? fmtN(r.cmPY) : '—'}</td>
              <td className={TD + ' font-semibold'}>{fmtN(r.netPY)}</td>
            </tr>
          ))}
          <tr className="font-bold bg-blue-50">
            <td className={TDL}>Total</td>
            <td className={TD}>{fmtN(totals.grossCY)}</td>
            <td className={TD}>{fmtN(totals.cmCY)}</td>
            <td className={TD}>{fmtN(totals.netCY)}</td>
            <td className={TD}>{fmtN(totals.grossPY)}</td>
            <td className={TD}>{fmtN(totals.cmPY)}</td>
            <td className={TD}>{fmtN(totals.netPY)}</td>
          </tr>
          {totals.cmCY > 0 && (
            <tr className="bg-orange-50 text-orange-800">
              <td colSpan={7} className="px-2 py-1 text-[10px] border border-orange-200">
                ℹ Current Maturities of ₹{fmtN(totals.cmCY)} (CY) / ₹{fmtN(totals.cmPY)} (PY) will appear under Short-term borrowings (Current maturities of long-term borrowings).
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ── Main Form ─────────────────────────────────────────────────────────────────
export default function LongTermBorrowingsForm({ tbId, entityId, useEntityLevel, noteNum, noteTitle, bsLTB, tbRawLTB, onClose, onSaved }) {
  const [loans, setLoans] = useState([])
  const [tbRows, setTbRows] = useState([])
  const [printRepayment, setPrintRepayment] = useState(true)
  const [printSecurity, setPrintSecurity] = useState(true)
  const [printReconciliation, setPrintReconciliation] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [activeSection, setActiveSection] = useState('B')

  // Load saved data + TB rows for this note
  useEffect(() => {
    if (!tbId && !entityId) return
    const fetchSaved = useEntityLevel
      ? window.api?.getEntityNoteDetails(entityId, noteNum, noteTitle)
      : window.api?.getNoteDetails(tbId, noteNum, noteTitle)
    Promise.all([
      fetchSaved,
      tbId ? window.api?.findMappedByFilter(tbId, {
        mapping2_resultant: 'Long-term borrowings',
      }).catch(() => []) : Promise.resolve([]),
    ]).then(([saved, rows]) => {
      const tbRowsLoaded = rows || []
      setTbRows(tbRowsLoaded)
      if (saved) {
        setLoans(saved.loans || [])
        setPrintRepayment(saved.printRepayment !== false)
        setPrintSecurity(saved.printSecurity !== false)
        setPrintReconciliation(saved.printReconciliation !== false)
      } else if (tbRowsLoaded.length) {
        // Auto-populate from TB rows
        const mapped = tbRowsLoaded.map(r => emptyLoan(
          r.name,
          Math.abs(num(r.closing_balance)),
          Math.abs(num(r.opening_balance)),
        ))
        setLoans(mapped)
      }
    }).finally(() => setLoading(false))
  }, [tbId, entityId, noteNum, useEntityLevel])

  // Collect all unique lender names for datalist autocomplete
  const lenderNames = useMemo(() =>
    [...new Set(loans.map(l => l.lenderPrintName).filter(Boolean))], [loans])

  const totalGrossCY = loans.reduce((s, l) => s + num(l.grossCY), 0)
  const totalGrossPY = loans.reduce((s, l) => s + num(l.grossPY), 0)

  const save = async () => {
    setSaving(true)
    try {
      if (useEntityLevel) {
        await window.api?.saveEntityNoteDetails({
          entityId, noteNum, noteTitle,
          data: { loans, printRepayment, printSecurity, printReconciliation }
        })
      } else {
        await window.api?.saveNoteDetails({
          tbId, noteNum, noteTitle,
          data: { loans, printRepayment, printSecurity, printReconciliation }
        })
      }
      onSaved?.()
      onClose()
    } finally { setSaving(false) }
  }

  // Quick check: is there an unreconciled difference?
  const totalGrossForm = loans.reduce((s, l) => s + num(l.grossCY), 0)
  const tbRaw = num(tbRawLTB)
  const hasUnrecon = tbRaw > 0 && Math.abs(totalGrossForm - tbRaw) >= 1

  const SECTIONS = [
    { key: 'R', label: hasUnrecon ? '⚠ Reconciliation' : 'Reconciliation' },
    { key: 'A', label: 'A. Summary' },
    { key: 'B', label: 'B. Loan Details' },
    { key: 'E', label: 'E. Lender Reconciliation' },
    { key: 'options', label: 'Print Options' },
  ]

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 9999 }}>
      <div className="modal-box overflow-hidden flex flex-col"
        style={{ maxWidth: '1200px', width: '97vw', maxHeight: '95vh' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 pb-3 mb-3 shrink-0">
          <div>
            <h2 className="text-base font-bold" style={{ color: 'var(--color-primary)' }}>
              Note {noteNum}: {noteTitle} — Details
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Section B loads TB ledgers. Multiple ledgers → same Lender Print Name = consolidated in final print.
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
            {loans.length} loan{loans.length !== 1 ? 's' : ''} · Gross CY ₹{fmtN(totalGrossCY)}
          </span>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading && <div className="text-gray-500 text-sm p-4">Loading TB data...</div>}

          {!loading && activeSection === 'R' && (
            <SectionReconciliation loans={loans} tbRows={tbRows} tbRawLTB={tbRawLTB} />
          )}

          {!loading && activeSection === 'A' && (
            <SectionA loans={loans} />
          )}

          {!loading && activeSection === 'B' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-gray-600">
                  TB ledgers auto-loaded. Fill <strong>Lender Print Name</strong> (multiple ledgers → same name = consolidated),
                  <strong> Nature</strong>, <strong>Current Maturity</strong>. Expand each row for Repayment & Security.
                </p>
                <button onClick={() => setLoans([...loans, emptyLoan()])}
                  className="text-xs text-blue-600 hover:underline shrink-0 ml-3">+ Add Manual Loan</button>
              </div>

              {loans.length === 0 && (
                <div className="text-center text-gray-400 text-sm py-8 border-2 border-dashed border-gray-200 rounded">
                  No Long-term borrowings found in the mapped TB.<br />
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

          {!loading && activeSection === 'E' && (
            <SectionE loans={loans} />
          )}

          {!loading && activeSection === 'options' && (
            <div className="space-y-4">
              <p className="text-xs text-gray-600">Choose which sections to include in the printed PDF and Excel output.</p>
              {[
                ['printRepayment', printRepayment, setPrintRepayment, 'Print Repayment Details (C)', 'Tabular or paragraph repayment schedule per lender'],
                ['printSecurity', printSecurity, setPrintSecurity, 'Print Security Details (D)', 'Nature of security, guarantee and charge ranking'],
                ['printReconciliation', printReconciliation, setPrintReconciliation, 'Print Reconciliation (E)', 'Gross outstanding → current maturities → net long-term'],
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
        <div className="flex items-center justify-between border-t border-gray-200 pt-3 mt-3 shrink-0">
          <p className="text-[10px] text-gray-400">
            Current Maturities total (CY ₹{fmtN(loans.reduce((s, l) => s + num(l.currentMaturityCY), 0))}) goes to Short-term borrowings (Current maturities of long-term borrowings).
          </p>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-1.5 border border-gray-300 text-gray-600 rounded text-sm hover:bg-gray-50">Cancel</button>
            <button onClick={save} disabled={saving}
              className="px-4 py-1.5 text-white rounded text-sm font-medium disabled:opacity-40"
              style={{ background: 'var(--color-primary)' }}>
              {saving ? 'Saving…' : 'Save Note Details'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
