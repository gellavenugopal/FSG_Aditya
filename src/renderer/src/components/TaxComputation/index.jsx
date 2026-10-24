import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import * as XLSX from 'xlsx-js-style'
import { useFinancials } from '../../hooks/useFinancials'
import { computeTax, DEFAULT_RATES } from '../../utils/taxComputation'
import {
  resolveGroup, todayLocal, figuresOf, buildTaxInput, loadDepIT, loadTaxComputationSaved,
  buildSavedWorkbook, parseSavedWorkbook, computationLines,
} from '../../utils/taxComputationIO'

// Features > Tax Computation: Profit before tax -> Total Income -> Tax, Surcharge, Cess -> Net tax payable / (refundable), with
// interest u/s 234A / 234B / 234C. Every figure drawn from the statements can be typed over (the ↺ puts the drawn figure back);
// what is typed is saved against the Auditee and Financial Year (the Consolidated figures for an Auditee with branches).
// "Save Excel" keeps the typed figures in the workbook; "Upload saved Excel" puts them back (e.g. after a fresh Trial Balance upload).

const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmt = (n) => {
  const v = Number(n) || 0
  if (Math.abs(v) < 0.005) return '0.00'
  return v < 0 ? `(${inr.format(-v)})` : inr.format(v)
}
const parseAmt = (text) => {
  const t = String(text ?? '').trim()
  if (!t) return null
  const neg = /^\(.*\)$/.test(t) || /^-/.test(t)
  const n = parseFloat(t.replace(/[(),\s₹-]/g, ''))
  return Number.isFinite(n) ? (neg ? -n : n) : null
}

// ── small parts (outside the screen so typing never loses its place) ──────────────────────────────
function Amt({ value, onCommit, auto = null, strong = false, width = 'w-40' }) {
  const [text, setText] = useState(null)
  const shown = text !== null ? text : fmt(value)
  const changed = auto != null && Math.abs((Number(value) || 0) - (Number(auto) || 0)) > 0.005
  return (
    <span className="inline-flex items-center justify-end gap-1">
      {changed && <button title="Put back the figure drawn from the statements" onClick={() => onCommit(null)} className="text-xs text-blue-600 hover:text-blue-800">↺</button>}
      <input
        value={shown}
        onFocus={e => { setText(Math.abs(Number(value) || 0) < 0.005 ? '' : String(Number(value))); e.target.select() }}
        onChange={e => setText(e.target.value)}
        onBlur={() => { const v = parseAmt(text); setText(null); onCommit(v) }}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
        className={`${width} text-right font-mono text-[13px] px-2 py-1 rounded border bg-amber-50/60 hover:bg-amber-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-300 ${changed ? 'border-blue-400 text-blue-800' : 'border-amber-200'} ${strong ? 'font-bold' : ''}`}
      />
    </span>
  )
}

const Num = ({ v, bold, tone = '' }) => <span className={`font-mono text-[13px] pr-2 ${bold ? 'font-bold' : ''} ${tone}`}>{fmt(v)}</span>

// a band that opens a section of the statement
const Band = ({ children, tone = 'bg-gray-100 text-gray-700' }) => (
  <tr><td colSpan={2} className={`px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider ${tone}`}>{children}</td></tr>
)

// one line of the statement
const Row = ({ label, sub, children, bold, total, indent, shade }) => (
  <tr className={`${shade || ''} ${total ? 'border-t border-gray-400' : 'border-t border-gray-100'}`}>
    <td className={`py-2 pr-3 text-[13px] ${bold || total ? 'font-semibold text-gray-900' : 'text-gray-700'}`} style={{ paddingLeft: indent ? 36 : 16 }}>
      {label}
      {sub && <div className="text-[11px] font-normal text-gray-500">{sub}</div>}
    </td>
    <td className="py-1.5 pr-3 text-right align-middle whitespace-nowrap">{children}</td>
  </tr>
)

function PctInput({ value, onCommit }) {
  return (
    <input type="number" step="0.01" value={value} onChange={e => onCommit(e.target.value === '' ? null : parseFloat(e.target.value))}
      className="w-16 text-right font-mono text-[13px] px-1.5 py-0.5 rounded border border-amber-200 bg-amber-50/60 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-300 mx-1" />
  )
}

const emptySaved = () => ({ ov: {}, additions: [], deductions: [], rate: null, surcharge: null, cess: null, advance: [null, null, null, null], advanceTotal: null, tds: null, tcs: null, dueDate: '', filingDate: '', presumptive: false })

export default function TaxComputation({ entity, activeTB, prevTB, activeRsId }) {
  const { data, loading, error } = useFinancials(activeTB, prevTB, entity, activeRsId)
  const group = resolveGroup(entity)
  const periodId = activeTB?.entity_period_id
  const [saved, setSaved] = useState(emptySaved())
  const [status, setStatus] = useState('')
  const [depIT, setDepIT] = useState(0)
  const [ready, setReady] = useState(false)
  const saveTimer = useRef(null)
  const today = useMemo(() => todayLocal(), [])

  useEffect(() => {
    let dead = false
    setReady(false)
    loadTaxComputationSaved(entity?.id, periodId).then(d => { if (!dead) { setSaved({ ...emptySaved(), ...(d || {}) }); setReady(true) } })
    return () => { dead = true }
  }, [entity?.id, periodId])

  useEffect(() => {
    let dead = false
    loadDepIT(entity, activeTB).then(v => { if (!dead) setDepIT(v) })
    return () => { dead = true }
  }, [activeTB?.id, entity?.id])

  const fig = useMemo(() => figuresOf(data), [data])
  const input = useMemo(() => buildTaxInput(group, fig, depIT, activeTB?.period, today), [group, fig, depIT, activeTB?.period, today])
  const m = useMemo(() => computeTax(input, saved), [input, saved])

  const flash = (msg) => { setStatus(msg); setTimeout(() => setStatus(''), 5000) }
  const persist = useCallback((next) => {
    setSaved(next)
    if (!entity?.id || !periodId) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try { await window.api?.saveTaxComputation?.(entity.id, periodId, next); flash('Saved') }
      catch (e) { flash('Could not save: ' + (e?.message || e)) }
    }, 400)
  }, [entity?.id, periodId])
  const patch = (p) => persist({ ...saved, ...p })
  const setOv = (k, v) => persist({ ...saved, ov: { ...(saved.ov || {}), [k]: v } })
  const newId = () => 'r' + Math.random().toString(36).slice(2, 9)
  const addRow = (side) => persist({ ...saved, [side]: [...(saved[side] || []), { id: newId(), label: '', amount: 0 }] })
  const setRow = (side, id, p) => persist({ ...saved, [side]: (saved[side] || []).map(r => (r.id === id ? { ...r, ...p } : r)) })
  const delRow = (side, id) => persist({ ...saved, [side]: (saved[side] || []).filter(r => r.id !== id) })
  const setAdv = (i, v) => { const a = [...(saved.advance || [null, null, null, null])]; a[i] = v; patch({ advance: a }) }

  const label = group === 'company' ? 'Company' : group === 'partnership' ? 'Partnership / LLP' : 'Proprietorship / Individual'
  const AY = m.dates?.ayLabel
  const title = `Computation of Total Income and Tax${AY ? ' - Assessment Year ' + AY : ''}`

  // ── Excel save / upload, PDF ─────────────────────────────────────────────
  const saveExcel = async () => {
    const wb = buildSavedWorkbook({ entityName: entity?.name, title, subtitle: `${label} - Profit before tax taken from the Profit & Loss account`, lines: computationLines(m), saved })
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    const eName = (entity?.name || 'Entity').replace(/[^A-Za-z0-9]+/g, '_')
    const r = await window.api?.saveFileDialog({ defaultPath: `${eName}_Tax_Computation.xlsx`, filters: [{ name: 'Excel', extensions: ['xlsx'] }] })
    if (r?.filePath) { await window.api?.writeFile(r.filePath, Array.from(new Uint8Array(buf))); flash('Excel saved - keep it to restore the figures with "Upload saved Excel"') }
  }
  const uploadExcel = async () => {
    if (!entity?.id || !periodId) return
    const r = await window.api?.openFileDialog({ filters: [{ name: 'Excel Workbook', extensions: ['xlsx', 'xls'] }], properties: ['openFile'] })
    const filePath = r?.filePaths?.[0]
    if (!filePath) return
    try {
      const bytes = await window.api?.readFile(filePath)
      const parsed = parseSavedWorkbook(XLSX.read(new Uint8Array(bytes), { type: 'array' }))
      if (!parsed) { flash('That file is not a saved Tax Computation (no inputs sheet found).'); return }
      persist({ ...emptySaved(), ...parsed })
      flash('Uploaded: the saved figures are back')
    } catch (e) { flash('Could not read that file: ' + (e?.message || e)) }
  }
  const savePdf = async () => {
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    const rows = computationLines(m).map(r => `<tr><td style="padding:3px 6px;${r.bold ? 'font-weight:bold;' : ''}">${esc(r.a).replace(/ /g, '&nbsp;')}</td><td style="padding:3px 6px;text-align:right;${r.bold ? 'font-weight:bold;' : ''}">${r.b == null ? '' : esc(fmt(r.b))}</td></tr>`).join('')
    const html = `<html><head><meta charset="utf-8"><style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;margin:18mm}table{width:100%;border-collapse:collapse}td{border-bottom:1px solid #ddd}h2,h3,p{text-align:center;margin:2px}</style></head><body>
      <h2>${esc((entity?.name || '').toUpperCase())}</h2><h3>${esc(title)}</h3><p>${esc(label)}</p><br/>
      <table><thead><tr><th style="text-align:left;border-bottom:2px solid #000;padding:3px 6px">Particulars</th><th style="text-align:right;border-bottom:2px solid #000;padding:3px 6px">Amount (Rs.)</th></tr></thead><tbody>${rows}</tbody></table>
      <p style="margin-top:8mm;font-size:8pt;text-align:left">Interest u/s 234A, 234B and 234C is indicative; it is worked out on the dates and instalments entered.</p></body></html>`
    const buffer = await window.api?.renderPDF(html)
    const eName = (entity?.name || 'Entity').replace(/[^A-Za-z0-9]+/g, '_')
    const r = await window.api?.saveFileDialog({ defaultPath: `${eName}_Tax_Computation.pdf`, filters: [{ name: 'PDF Document', extensions: ['pdf'] }] })
    if (r?.filePath && buffer) {
      const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(Object.values(buffer))
      await window.api?.writeFile(r.filePath, Array.from(bytes)); flash('PDF saved')
    }
  }

  if (!activeTB) return <div className="flex items-center justify-center h-full text-gray-400 text-sm">Load a Trial Balance in the Actual TB tab first.</div>
  if (loading || !ready) return <div className="flex items-center justify-center h-full text-gray-400">Loading financial data...</div>
  if (error) return <div className="flex items-center justify-center h-full text-red-500 text-sm px-8 text-center">{error}</div>

  const dflt = DEFAULT_RATES[group]
  const rateVal = saved.rate != null ? saved.rate : (dflt.rate == null ? '' : dflt.rate)
  const surVal = saved.surcharge != null ? saved.surcharge : dflt.surcharge
  const cessVal = saved.cess != null ? saved.cess : dflt.cess
  const refund = m.netPayable < 0
  const plTax = input.currentTaxPL
  const taxDiff = m.totalTax - plTax

  const rowEditor = (side, r, placeholder) => (
    <tr key={r.id} className="border-t border-gray-100">
      <td className="py-1.5 pr-3" style={{ paddingLeft: 36 }}>
        <span className="flex items-center gap-2">
          <input value={r.label} onChange={e => setRow(side, r.id, { label: e.target.value })} placeholder={placeholder}
            className="flex-1 text-[13px] px-2 py-1 rounded border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-300" />
          <button onClick={() => delRow(side, r.id)} title="Remove this row" className="text-red-400 hover:text-red-600 text-sm">✕</button>
        </span>
      </td>
      <td className="py-1.5 pr-3 text-right"><Amt value={r.amount} onCommit={v => setRow(side, r.id, { amount: v == null ? 0 : v })} /></td>
    </tr>
  )
  const addLink = (side) => (
    <tr><td colSpan={2} className="py-1" style={{ paddingLeft: 36 }}><button onClick={() => addRow(side)} className="text-xs text-blue-700 hover:underline">+ Add a row</button></td></tr>
  )

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-100">
      <div className="flex items-center gap-3 px-6 py-2.5 bg-white border-b border-gray-200 shrink-0 flex-wrap">
        <span className="text-xs text-gray-500">{label}{entity?.has_branches ? ' · Consolidated' : ''}{AY ? ` · A.Y. ${AY}` : ''}</span>
        {status && <span className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-0.5">{status}</span>}
        <span className="ml-auto flex items-center gap-2">
          <button onClick={uploadExcel} title="Put back the figures saved in an Excel of this computation (e.g. after a fresh Trial Balance upload)" className="px-3 py-1.5 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50">⬆ Upload saved Excel</button>
          <button onClick={saveExcel} className="px-3 py-1.5 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50">⬇ Save Excel</button>
          <button onClick={savePdf} className="px-3 py-1.5 text-xs rounded text-white" style={{ background: 'var(--color-primary)' }}>⬇ PDF</button>
        </span>
      </div>

      <div className="flex-1 overflow-auto px-4 py-5">
        <div className="max-w-4xl mx-auto bg-white rounded-lg shadow border border-gray-200">
          <div className="text-center pt-5 pb-3 border-b-2 border-gray-800 mx-6">
            <div className="text-lg font-bold tracking-wide text-gray-900">{(entity?.name || '').toUpperCase()}</div>
            <div className="text-sm font-semibold text-gray-800">Computation of Total Income{AY ? ` for the Assessment Year ${AY}` : ''}</div>
            <div className="text-xs text-gray-500">{label} · figures in rupees</div>
          </div>

          <table className="w-full mt-2">
            <tbody>
              <Band tone="bg-blue-50 text-blue-900">Profit before tax</Band>
              <Row label="Profit before tax as per Profit & Loss account" bold><Amt value={m.pbt} auto={input.pbt} strong onCommit={v => setOv('pbt', v)} /></Row>

              <Band tone="bg-green-50 text-green-900">Add: additions to income</Band>
              {m.additions.filter(r => r.fixed).map(r => (
                <Row key={r.id} indent label={r.label} sub={r.id === 'dep_co' ? 'drawn from the Profit & Loss account' : "drawn from the Profit & Loss account (Partners' remuneration)"}>
                  <Amt value={r.amount} auto={r.auto} onCommit={v => setOv(r.id, v)} />
                </Row>
              ))}
              {(saved.additions || []).map(r => rowEditor('additions', r, 'Particulars of the addition'))}
              {addLink('additions')}
              <Row label="Total additions" total><Num v={m.addTotal} bold /></Row>

              <Band tone="bg-red-50 text-red-900">Less: deductions from income</Band>
              {m.deductions.filter(r => r.fixed).map(r => (
                <Row key={r.id} indent label={r.label} sub="drawn from the Dep (IT) block summary">
                  <Amt value={r.amount} auto={r.auto} onCommit={v => setOv(r.id, v)} />
                </Row>
              ))}
              {(saved.deductions || []).map(r => rowEditor('deductions', r, 'Particulars of the deduction'))}
              {addLink('deductions')}
              <Row label="Total deductions" total><Num v={m.dedTotal} bold /></Row>

              {m.group === 'partnership' && (
                <>
                  <Band tone="bg-purple-50 text-purple-900">Partners' remuneration (s.40(b))</Band>
                  <Row label="Book Profit" sub="Profit before tax + additions - deductions" bold><Num v={m.bookProfit} bold /></Row>
                  <Row indent label="Less: allowable remuneration" sub="First ₹6,00,000 of Book Profit: higher of ₹3,00,000 or 90%; balance: 60% - limited to the remuneration paid">
                    <Amt value={m.allowable} auto={m.allowableAuto} onCommit={v => setOv('allowable', v)} />
                  </Row>
                </>
              )}

              <Row label="Total Income" sub="rounded off to ₹10 (s.288A)" total shade="bg-blue-50"><Num v={m.totalIncome} bold /></Row>

              <Band tone="bg-amber-50 text-amber-900">Tax on Total Income</Band>
              <Row indent label={<span>Income tax @<PctInput value={rateVal} onCommit={v => patch({ rate: v })} />%{group === 'individual' && saved.rate == null && <span className="text-[11px] text-amber-700"> enter the rate applicable</span>}</span>}><Num v={m.tax} /></Row>
              <Row indent label={<span>Add: Surcharge @<PctInput value={surVal} onCommit={v => patch({ surcharge: v })} />% of tax</span>}><Num v={m.surcharge} /></Row>
              <Row indent label={<span>Add: Health and Education Cess @<PctInput value={cessVal} onCommit={v => patch({ cess: v })} />% of tax and surcharge</span>}><Num v={m.cess} /></Row>
              <Row label="Total tax" sub="rounded off to ₹1 (s.288B)" total shade="bg-blue-50"><Num v={m.totalTax} bold /></Row>

              <Band tone="bg-teal-50 text-teal-900">Less: taxes paid (filled by you)</Band>
              <Row indent label="Advance tax" sub={m.advanceInstalments ? 'taken from the instalments below unless typed here' : ''}>
                <Amt value={m.advanceTotal} auto={m.advanceInstalments} onCommit={v => patch({ advanceTotal: v })} />
              </Row>
              <Row indent label="Tax deducted at source (TDS)"><Amt value={m.tds} onCommit={v => patch({ tds: v })} /></Row>
              <Row indent label="Tax collected at source (TCS)"><Amt value={m.tcs} onCommit={v => patch({ tcs: v })} /></Row>
              <Row label={refund ? 'Net tax refundable' : 'Net tax payable'} total shade={refund ? 'bg-green-50' : 'bg-red-50'}>
                <Num v={m.netPayable} bold tone={refund ? 'text-green-700' : 'text-red-700'} />
              </Row>

              <Band tone="bg-orange-50 text-orange-900">Interest (indicative)</Band>
              <Row indent label={`Interest u/s 234A - late filing${m.interest.aMonths ? ` (${m.interest.aMonths} month${m.interest.aMonths === 1 ? '' : 's'} @ 1%)` : ''}`}><Num v={m.interest.a} /></Row>
              <Row indent label={`Interest u/s 234B - advance tax below 90%${m.interest.bMonths ? ` (${m.interest.bMonths} month${m.interest.bMonths === 1 ? '' : 's'} @ 1%)` : ''}`}><Num v={m.interest.b} /></Row>
              <Row indent label="Interest u/s 234C - deferment of advance tax"><Num v={m.interest.c} /></Row>
              <Row label={m.grandPayable < 0 ? 'Total refundable including interest' : 'Total payable including interest'} total shade="bg-gray-100"><Num v={m.grandPayable} bold /></Row>

              <Band>Reconciliation with the books</Band>
              <Row indent label="Current tax as per Profit & Loss account" sub="the Current Tax line only (not deferred tax)"><Num v={plTax} /></Row>
              <Row indent label="Difference: Total tax as per computation less current tax as per P&L" sub="shown in the Exception Report">
                <Num v={taxDiff} bold tone={Math.abs(taxDiff) < 1 ? 'text-green-700' : 'text-red-700'} />
              </Row>
            </tbody>
          </table>

          {/* interest workings */}
          <div className="mx-6 mt-4 mb-5 border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-4 py-2 bg-gray-50 text-xs font-semibold text-gray-700">Workings for interest u/s 234A, 234B and 234C</div>
            <div className="px-4 py-3">
              <div className="flex flex-wrap items-end gap-4 text-xs mb-3">
                <label className="flex flex-col gap-0.5 text-gray-600">Due date of the return
                  <input type="date" value={saved.dueDate || (m.dates ? m.dates.defaultDueDate : '')} onChange={e => patch({ dueDate: e.target.value })} className="border border-amber-200 rounded px-2 py-1 bg-amber-50/60" />
                </label>
                <label className="flex flex-col gap-0.5 text-gray-600">Date of filing the return
                  <input type="date" value={saved.filingDate || today} onChange={e => patch({ filingDate: e.target.value })} className="border border-amber-200 rounded px-2 py-1 bg-amber-50/60" />
                  {!saved.filingDate && <span className="text-[10px] text-gray-400">today - change to the actual date</span>}
                </label>
                {group !== 'company' && (
                  <label className="flex items-center gap-2 text-gray-700 pb-1" title="Section 44AD / 44ADA: the whole advance tax is due in one instalment, by 15 March">
                    <input type="checkbox" checked={!!saved.presumptive} onChange={e => patch({ presumptive: e.target.checked })} />
                    Presumptive taxation (s.44AD / 44ADA): advance tax in one instalment by 15 March
                  </label>
                )}
              </div>
              <table className="w-full text-xs">
                <thead><tr className="text-gray-500 border-b border-gray-200"><th className="text-left py-1 font-medium">Advance tax instalment</th><th className="text-right font-medium">Paid in the instalment</th><th className="text-right font-medium">Required (cumulative)</th><th className="text-right font-medium">Shortfall</th><th className="text-right font-medium pr-2">Interest u/s 234C</th></tr></thead>
                <tbody>
                  {['15 June (15%)', '15 September (45%)', '15 December (75%)', '15 March (100%)'].map((d, i) => {
                    const det = m.interest.cDetail[i]
                    return (
                      <tr key={d} className="border-b border-gray-100">
                        <td className="py-1">Up to {d}</td>
                        <td className="text-right"><Amt width="w-32" value={saved.advance?.[i] ?? 0} onCommit={v => setAdv(i, v)} /></td>
                        <td className="text-right font-mono">{det ? fmt(det.required) : '-'}</td>
                        <td className="text-right font-mono">{det ? fmt(det.shortfall) : '-'}</td>
                        <td className="text-right font-mono pr-2">{det ? fmt(det.interest) : '-'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {m.interest.notes.length > 0 && <ul className="mt-2 text-[11px] text-amber-800 list-disc pl-5">{m.interest.notes.map(n => <li key={n}>{n}</li>)}</ul>}
              <p className="mt-2 text-[10px] text-gray-500 leading-snug">
                234A: 1% a month or part on the tax unpaid, from the day after the due date. 234B: advance tax below 90% of the assessed tax (₹10,000 or more) - 1% a month or part from 1 April of the assessment year to the date of filing.
                234C: shortfall against 15% / 45% / 75% / 100% by 15 June / 15 September / 15 December / 15 March, 1% for 3 months (1 for March); none if 12% / 36% was paid by the first two dates.
                Capital-gains and other relaxations are not applied.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
