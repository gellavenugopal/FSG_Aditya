import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { formatPeriodText } from '../../utils/financialPeriodDisplay'
import { useFinancials } from '../../hooks/useFinancials'
import { DEFAULT_RATES } from '../../utils/taxComputation'
import { resolveGroup, figuresOf } from '../../utils/taxComputationIO'
import { computeDeferredTax } from '../../utils/deferredTax'
import { loadDepSources, bsDeferredTax, buildDeferredInput } from '../../utils/deferredTaxIO'

// Features > Deferred Tax: Approach 1 (timing difference of the year) and Approach 2 (WDV approach, cumulative), each reconciled with
// the Deferred Tax of the Profit & Loss account (and, for Approach 2, with the Balance Sheet). Every figure drawn from the statements
// can be typed over (the ↺ puts the drawn figure back); what is typed is saved against the Auditee and Financial Year.

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

const Band = ({ children, tone = 'bg-gray-100 text-gray-700' }) => (
  <tr><td colSpan={2} className={`px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider ${tone}`}>{children}</td></tr>
)

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
      className="w-20 text-right font-mono text-[13px] px-1.5 py-0.5 rounded border border-amber-200 bg-amber-50/60 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-300 mx-1" />
  )
}

const kindName = (k) => (k === 'DTA' ? 'Deferred Tax Asset (DTA)' : k === 'DTL' ? 'Deferred Tax Liability (DTL)' : 'nil')

const emptySaved = () => ({ ov: {}, other1: [], other2: [], rate: null, surcharge: null, cess: null })

export default function DeferredTax({ entity, activeTB, prevTB, activeRsId }) {
  const { data, loading, error } = useFinancials(activeTB, prevTB, entity, activeRsId)
  const group = resolveGroup(entity)
  const periodId = activeTB?.entity_period_id
  const [saved, setSaved] = useState(emptySaved())
  const [status, setStatus] = useState('')
  const [src, setSrc] = useState({ itDep: 0, itWdv: 0, bookWdv: 0 })
  const [ready, setReady] = useState(false)
  const saveTimer = useRef(null)

  useEffect(() => {
    let dead = false
    setReady(false)
    if (!entity?.id || !periodId) { setSaved(emptySaved()); setReady(true); return }
    Promise.resolve(window.api?.getDeferredTax?.(entity.id, periodId)).then(d => {
      if (!dead) { setSaved({ ...emptySaved(), ...(d || {}) }); setReady(true) }
    }).catch(() => { if (!dead) { setSaved(emptySaved()); setReady(true) } })
    return () => { dead = true }
  }, [entity?.id, periodId])

  useEffect(() => {
    let dead = false
    loadDepSources(entity, activeTB).then(v => { if (!dead) setSrc(v) })
    return () => { dead = true }
  }, [activeTB?.id, entity?.id])

  const fig = useMemo(() => figuresOf(data), [data])
  const bs = useMemo(() => bsDeferredTax(data), [data])
  const input = useMemo(() => buildDeferredInput(group, fig, src, bs), [group, fig, src, bs])
  const m = useMemo(() => computeDeferredTax(input, saved), [input, saved])

  const flash = (msg) => { setStatus(msg); setTimeout(() => setStatus(''), 4000) }
  const persist = useCallback((next) => {
    setSaved(next)
    if (!entity?.id || !periodId) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try { await window.api?.saveDeferredTax?.(entity.id, periodId, next); flash('Saved') }
      catch (e) { flash('Could not save: ' + (e?.message || e)) }
    }, 400)
  }, [entity?.id, periodId])
  const patch = (p) => persist({ ...saved, ...p })
  const setOv = (k, v) => persist({ ...saved, ov: { ...(saved.ov || {}), [k]: v } })
  const newId = () => 'r' + Math.random().toString(36).slice(2, 9)
  const addRow = (side) => persist({ ...saved, [side]: [...(saved[side] || []), { id: newId(), label: '', amount: 0 }] })
  const setRow = (side, id, p) => persist({ ...saved, [side]: (saved[side] || []).map(r => (r.id === id ? { ...r, ...p } : r)) })
  const delRow = (side, id) => persist({ ...saved, [side]: (saved[side] || []).filter(r => r.id !== id) })

  const label = group === 'company' ? 'Company' : group === 'partnership' ? 'Partnership / LLP' : 'Proprietorship / Individual'
  const title = 'Computation of Deferred Tax (DTA / DTL)'

  const savePdf = async () => {
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    const L = []
    const add = (a, b, bold) => L.push(`<tr><td style="padding:3px 6px;${bold ? 'font-weight:bold;' : ''}">${esc(a)}</td><td style="padding:3px 6px;text-align:right;${bold ? 'font-weight:bold;' : ''}">${b == null ? '' : esc(fmt(b))}</td></tr>`)
    const head = (t) => L.push(`<tr><td colspan="2" style="background:#eee;font-weight:bold;padding:4px 6px">${esc(t)}</td></tr>`)
    head(`Net tax rate: ${m.rate}% + surcharge ${m.surcharge}% + cess ${m.cess}% = ${m.netRate.toFixed(3)}%`)
    head('Approach 1 - timing difference of the year')
    add('Depreciation as per Profit & Loss account (A)', m.a1.bookDep)
    add('Depreciation as per Income Tax Act - WDV (IT) (B)', m.a1.itDep)
    add('Timing difference (A) - (B)', m.a1.depTD, true)
    m.a1.other.forEach(r => add('  ' + r.label, r.amount))
    add('Net timing difference', m.a1.netTD, true)
    add(`${kindName(m.a1.kind)} created @ ${m.netRate.toFixed(3)}%`, m.a1.amount, true)
    add('Deferred tax charge / (credit) as per computation', m.a1.charge)
    add(`Deferred tax as per Profit & Loss account${m.a1.plKind ? ' (' + m.a1.plKind + ')' : ''}`, m.a1.plDeferred)
    add('Difference', m.a1.difference, true)
    head('Approach 2 - WDV approach')
    add('WDV as per books - Dep (Comp) (A)', m.a2.bookWdv)
    add('WDV as per Income Tax Act - Dep (IT) (B)', m.a2.itWdv)
    add('Cumulative timing difference (B) - (A)', m.a2.wdvTD, true)
    m.a2.other.forEach(r => add('  ' + r.label, r.amount))
    add('Net cumulative timing difference', m.a2.cumTD, true)
    add('Closing DTA', m.a2.closingDTA); add('Closing DTL', m.a2.closingDTL)
    add('Opening DTA', m.a2.openDTA); add('Opening DTL', m.a2.openDTL)
    add('DTA created / (reversed)', m.a2.moveDTA); add('DTL created / (reversed)', m.a2.moveDTL)
    add('Deferred tax charge / (credit) to Profit & Loss', m.a2.charge, true)
    add('Deferred tax as per Profit & Loss account', m.a2.plDeferred)
    add('Difference', m.a2.difference, true)
    const html = `<html><head><meta charset="utf-8"><style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;margin:18mm}table{width:100%;border-collapse:collapse}td{border-bottom:1px solid #ddd}h2,h3,p{text-align:center;margin:2px}</style></head><body>
      <h2>${esc((entity?.name || '').toUpperCase())}</h2><h3>${esc(title)}</h3><p>${esc(label)}</p><br/><table><tbody>${L.join('')}</tbody></table></body></html>`
    const buffer = await window.api?.renderPDF(html)
    const eName = (entity?.name || 'Entity').replace(/[^A-Za-z0-9]+/g, '_')
    const r = await window.api?.saveFileDialog({ defaultPath: `${eName}_Deferred_Tax.pdf`, filters: [{ name: 'PDF Document', extensions: ['pdf'] }] })
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
  const diffTone = (d) => (Math.abs(d) < 1 ? 'text-green-700' : 'text-red-700')

  const rowEditor = (side, r) => (
    <tr key={r.id} className="border-t border-gray-100">
      <td className="py-1.5 pr-3" style={{ paddingLeft: 36 }}>
        <span className="flex items-center gap-2">
          <input value={r.label} onChange={e => setRow(side, r.id, { label: e.target.value })} placeholder="Other timing difference (+ gives DTA, - gives DTL)"
            className="flex-1 text-[13px] px-2 py-1 rounded border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-300" />
          <button onClick={() => delRow(side, r.id)} title="Remove this row" className="text-red-400 hover:text-red-600 text-sm">✕</button>
        </span>
      </td>
      <td className="py-1.5 pr-3 text-right"><Amt value={r.amount} onCommit={v => setRow(side, r.id, { amount: v == null ? 0 : v })} /></td>
    </tr>
  )
  const addLink = (side) => (
    <tr><td colSpan={2} className="py-1" style={{ paddingLeft: 36 }}><button onClick={() => addRow(side)} className="text-xs text-blue-700 hover:underline">+ Add a row (other timing difference)</button></td></tr>
  )

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-100">
      <div className="flex items-center gap-3 px-6 py-2.5 bg-white border-b border-gray-200 shrink-0 flex-wrap">
        <span className="text-xs text-gray-500">{label}{entity?.has_branches ? ' · Consolidated' : ''}{activeTB?.period ? ` · ${formatPeriodText(activeTB.period)}` : ''}</span>
        {status && <span className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-0.5">{status}</span>}
        <span className="ml-auto">
          <button onClick={savePdf} className="px-3 py-1.5 text-xs rounded text-white" style={{ background: 'var(--color-primary)' }}>⬇ PDF</button>
        </span>
      </div>

      <div className="flex-1 overflow-auto px-4 py-5">
        <div className="max-w-4xl mx-auto bg-white rounded-lg shadow border border-gray-200">
          <div className="text-center pt-5 pb-3 border-b-2 border-gray-800 mx-6">
            <div className="text-lg font-bold tracking-wide text-gray-900">{(entity?.name || '').toUpperCase()}</div>
            <div className="text-sm font-semibold text-gray-800">{title}</div>
            <div className="text-xs text-gray-500">{label} · figures in rupees</div>
          </div>

          <table className="w-full mt-2">
            <tbody>
              <Band tone="bg-amber-50 text-amber-900">Latest available tax rate</Band>
              <Row indent label={<span>Tax rate @<PctInput value={rateVal} onCommit={v => patch({ rate: v })} />%{group === 'individual' && saved.rate == null && <span className="text-[11px] text-amber-700"> enter the rate applicable</span>}</span>}><Num v={m.rate} /></Row>
              <Row indent label={<span>Surcharge @<PctInput value={surVal} onCommit={v => patch({ surcharge: v })} />% of tax</span>}><Num v={m.surcharge} /></Row>
              <Row indent label={<span>Health and Education Cess @<PctInput value={cessVal} onCommit={v => patch({ cess: v })} />% of tax and surcharge</span>}><Num v={m.cess} /></Row>
              <Row label="Net tax rate" sub="tax rate x (1 + surcharge) x (1 + cess)" total shade="bg-amber-50"><span className="font-mono text-[13px] font-bold pr-2">{m.netRate.toFixed(3)} %</span></Row>

              <Band tone="bg-blue-50 text-blue-900">Approach 1 - timing difference of the year (depreciation)</Band>
              <Row indent label="Depreciation as per Profit & Loss account (A)" sub="drawn from the Profit & Loss account">
                <Amt value={m.a1.bookDep} auto={input.bookDep} onCommit={v => setOv('bookDep', v)} />
              </Row>
              <Row indent label="Depreciation as per Income Tax Act (B)" sub="drawn from WDV (IT) - Dep (IT)">
                <Amt value={m.a1.itDep} auto={input.itDep} onCommit={v => setOv('itDep', v)} />
              </Row>
              <Row label="Timing difference on depreciation  (A) - (B)" bold><Num v={m.a1.depTD} bold /></Row>
              {(saved.other1 || []).map(r => rowEditor('other1', r))}
              {addLink('other1')}
              <Row label="Net timing difference" sub={m.a1.netTD > 0 ? 'positive: Deferred Tax Asset' : m.a1.netTD < 0 ? 'negative: Deferred Tax Liability' : ''} total shade="bg-blue-50"><Num v={m.a1.netTD} bold /></Row>
              <Row indent label={`${kindName(m.a1.kind)} created, at ${m.netRate.toFixed(3)}%`}><Num v={m.a1.amount} bold tone={m.a1.kind === 'DTA' ? 'text-green-700' : 'text-red-700'} /></Row>
              <Row indent label="Deferred tax charge / (credit) as per computation" sub="a DTL is a charge, a DTA a credit"><Num v={m.a1.charge} /></Row>
              <Row indent label={`Deferred tax as per Profit & Loss account${m.a1.plKind ? ` (${m.a1.plKind})` : ''}`} sub="positive: DTL, otherwise DTA"><Num v={m.a1.plDeferred} /></Row>
              <Row label="Difference (Approach 1 reconciliation)" sub="shown in the Exception Report" total shade="bg-gray-100"><Num v={m.a1.difference} bold tone={diffTone(m.a1.difference)} /></Row>

              <Band tone="bg-purple-50 text-purple-900">Approach 2 - WDV approach (cumulative)</Band>
              <Row indent label="WDV of PPE as per books (A)" sub={`drawn from Dep (Comp): closing net block${src.bookWdvExcluded ? ` - excluding land / capital work-in-progress of ${fmt(src.bookWdvExcluded)}, which carry no timing difference` : ''}`}>
                <Amt value={m.a2.bookWdv} auto={input.bookWdv} onCommit={v => setOv('bookWdv', v)} />
              </Row>
              <Row indent label="WDV as per Income Tax Act (B)" sub="drawn from Dep (IT): closing WDV of the blocks">
                <Amt value={m.a2.itWdv} auto={input.itWdv} onCommit={v => setOv('itWdv', v)} />
              </Row>
              <Row label="Cumulative timing difference  (B) - (A)" bold><Num v={m.a2.wdvTD} bold /></Row>
              {(saved.other2 || []).map(r => rowEditor('other2', r))}
              {addLink('other2')}
              <Row label="Net cumulative timing difference" sub={m.a2.cumTD > 0 ? 'positive: closing DTA' : m.a2.cumTD < 0 ? 'negative: closing DTL' : ''} total shade="bg-purple-50"><Num v={m.a2.cumTD} bold /></Row>
              <Row indent label={`Closing DTA, at ${m.netRate.toFixed(3)}%`}><Num v={m.a2.closingDTA} bold tone="text-green-700" /></Row>
              <Row indent label={`Closing DTL, at ${m.netRate.toFixed(3)}%`}><Num v={m.a2.closingDTL} bold tone="text-red-700" /></Row>
              <Row indent label="Opening DTA" sub="drawn from the previous year's Balance Sheet">
                <Amt value={m.a2.openDTA} auto={input.openDTA} onCommit={v => setOv('openDTA', v)} />
              </Row>
              <Row indent label="Opening DTL" sub="drawn from the previous year's Balance Sheet">
                <Amt value={m.a2.openDTL} auto={input.openDTL} onCommit={v => setOv('openDTL', v)} />
              </Row>
              <Row indent label="DTA to be created / (reversed)  = closing - opening"><Num v={m.a2.moveDTA} tone={m.a2.moveDTA < 0 ? 'text-red-700' : ''} /></Row>
              <Row indent label="DTL to be created / (reversed)  = closing - opening"><Num v={m.a2.moveDTL} tone={m.a2.moveDTL < 0 ? 'text-red-700' : ''} /></Row>
              <Row label="Deferred tax charge / (credit) to Profit & Loss account" sub="DTL created or DTA reversed: charge; DTA created or DTL reversed: credit" total shade="bg-purple-50"><Num v={m.a2.charge} bold /></Row>
              <Row indent label={`Deferred tax as per Profit & Loss account${m.a2.plKind ? ` (${m.a2.plKind})` : ''}`}><Num v={m.a2.plDeferred} /></Row>
              <Row label="Difference (Approach 2 reconciliation)" sub="shown in the Exception Report" total shade="bg-gray-100"><Num v={m.a2.difference} bold tone={diffTone(m.a2.difference)} /></Row>
              <Row indent label="Closing DTA as per computation less DTA as per Balance Sheet" sub={`Balance Sheet: ${fmt(m.a2.bsDTA)}`}><Num v={m.a2.bsDifferenceDTA} tone={diffTone(m.a2.bsDifferenceDTA)} /></Row>
              <Row indent label="Closing DTL as per computation less DTL as per Balance Sheet" sub={`Balance Sheet: ${fmt(m.a2.bsDTL)}`}><Num v={m.a2.bsDifferenceDTL} tone={diffTone(m.a2.bsDifferenceDTL)} /></Row>
            </tbody>
          </table>
          <p className="mx-6 my-4 text-[10px] text-gray-500 leading-snug">
            Timing difference on depreciation is books depreciation less depreciation as per the Income Tax Act: when it is positive the books have charged more
            than the Act allowed and a Deferred Tax Asset arises; when negative, a Deferred Tax Liability. On the WDV approach the difference is
            WDV as per the Act less WDV as per books, so a positive figure is again a DTA. Where the closing DTA / DTL of Approach 2 differs from the
            Balance Sheet, the creation or reversal needed to bring the opening to the ideal closing is the net charge or credit shown above.
          </p>
        </div>
      </div>
    </div>
  )
}
