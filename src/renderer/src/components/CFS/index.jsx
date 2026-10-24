import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useFinancials } from '../../hooks/useFinancials'
import PYTBSelector from '../shared/PYTBSelector'
import ManualPYButton from '../shared/ManualPYButton'
import PYModeSelect from '../shared/PYModeSelect'
import { buildCashFlow } from '../../utils/cashFlow'
import * as XLSX from 'xlsx-js-style'
import { buildCfsWorkbook, parseCfsSheet, applyCfsUpload } from './cfsWorkbook'

// Cash Flow Statement as per AS 3 (indirect method). The Current Year column is drawn from the Balance Sheet and
// Profit & Loss shown in the other tabs (any figure can be typed over - click the figure; the small arrow puts the drawn
// figure back). The Previous Year column is typed: the Trial Balance of the year before it is not in the tool.
const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const fmtCfs = (n) => {
  const v = Number(n) || 0
  if (Math.abs(v) < 0.005) return '-'
  return v < 0 ? `(${inr.format(-v)})` : inr.format(v)
}
// "(1,25,000)", "-125000", "1,25,000.50" -> number; '' -> null
export function parseCfsInput(text) {
  const t = String(text ?? '').trim()
  if (!t) return null
  const neg = /^\(.*\)$/.test(t) || /^-/.test(t)
  const n = parseFloat(t.replace(/[(),\s₹-]/g, ''))
  return Number.isFinite(n) ? (neg ? -n : n) : null
}

function Guard({ activeTB, loading, error, children }) {
  if (!activeTB) return <div className="flex items-center justify-center h-full text-gray-400 text-sm">Load a Trial Balance in the Actual TB tab first.</div>
  if (loading)   return <div className="flex items-center justify-center h-full text-gray-400">Loading financial data...</div>
  if (error)     return <div className="flex items-center justify-center h-full text-red-500 text-sm px-8 text-center">{error}</div>
  return children
}

// A figure the CA can type over: shows the number, becomes a box on focus
function FigureCell({ value, onCommit, tone = '', title = '', placeholder = '' }) {
  const [text, setText] = useState(null)   // null = not editing
  const shown = text !== null ? text : (Math.abs(Number(value) || 0) < 0.005 ? '' : fmtCfs(value))
  return (
    <input
      value={shown}
      title={title}
      placeholder={placeholder || '-'}
      onFocus={() => setText(Math.abs(Number(value) || 0) < 0.005 ? '' : String(Number(value)))}
      onChange={e => setText(e.target.value)}
      onBlur={() => { const v = parseCfsInput(text); setText(null); onCommit(v) }}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
      className={`w-full bg-transparent text-right font-mono text-xs pr-2 py-1 border-b border-transparent hover:border-gray-300 focus:outline-none focus:border-blue-400 ${tone}`}
    />
  )
}

export default function CFS({ entity, activeTB, prevTB, activeRsId, onPrevTBChange }) {
  const { data, loading, error, refresh } = useFinancials(activeTB, prevTB, entity, activeRsId)
  const periodId = activeTB?.entity_period_id
  const [saved, setSaved] = useState({ cy: {}, py: {}, custom: [], hidden: [], include: false, ccNote: '' })
  const [status, setStatus] = useState('')
  const [askRecompute, setAskRecompute] = useState(false)
  const [alsoRows, setAlsoRows] = useState(false)
  const loadedFor = useRef(null)
  const isBranchEntity = !!entity?.has_branches
  const [manualPyOn, setManualPyOn] = useState(false)
  const pyOff = !!data?.pyMode && data.pyMode !== 'required'

  // What was saved comes with the statements (data.cfsSaved); keep editing a local copy
  useEffect(() => {
    if (!data) return
    const key = `${entity?.id}|${periodId}|${activeTB?.id}`
    if (loadedFor.current === key) return
    loadedFor.current = key
    const s = data.cfsSaved || {}
    setSaved({ cy: { ...(s.cy || {}) }, py: { ...(s.py || {}) }, custom: Array.isArray(s.custom) ? s.custom.map(c => ({ ...c })) : [], hidden: Array.isArray(s.hidden) ? [...s.hidden] : [], include: !!s.include, ccNote: s.ccNote || '' })
  }, [data, entity?.id, periodId, activeTB?.id])

  const persist = useCallback(async (next) => {
    setSaved(next)
    if (!entity?.id || !periodId) return
    try { await window.api?.saveCfs?.(entity.id, periodId, next); setStatus('Saved'); setTimeout(() => setStatus(''), 1500) }
    catch (e) { setStatus('Could not save: ' + (e?.message || e)) }
  }, [entity?.id, periodId])
  const setSide = (side, id, v) => {
    const next = { ...saved, [side]: { ...saved[side] } }
    if (v === null) delete next[side][id]; else next[side][id] = v
    persist(next)
  }

  // Rows added by the CA to Operating (A), Investing (B) or Financing (C) activities
  const addRow = (section) => persist({ ...saved, custom: [...(saved.custom || []), { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), section, label: '', cy: 0, py: 0 }] })
  const setCustom = (id, field, v) => persist({ ...saved, custom: (saved.custom || []).map(c => c.id === id ? { ...c, [field]: v } : c) })
  const removeCustom = (id) => persist({ ...saved, custom: (saved.custom || []).filter(c => c.id !== id) })
  // The row ahead of which a CA's own rows of an activity sit, and the wording of the button that adds one
  const SECTION_OF_TOTAL = {
    s_opbwc: ['A1', 'under "Adjustments for:"'],
    s_cgo: ['A2', 'under "Adjustments for changes in working capital:"'],
    t_op: ['A', 'to operating activities'],
    t_inv: ['B', 'to investing activities'],
    t_fin: ['C', 'to financing activities'],
  }
  // Delete a row of the statement (e.g. the same item is put in a row of one's own, with another heading); it can be brought back
  const deleteRow = (id) => persist({ ...saved, hidden: [...(saved.hidden || []).filter(h => h !== id), id] })
  const restoreRow = (id) => persist({ ...saved, hidden: (saved.hidden || []).filter(h => h !== id) })

  // The same sheet as the Fill Details workbook's CFS sheet (Notes tab -> Filled Template), on its own
  const flash = (msg) => { setStatus(msg); setTimeout(() => setStatus(''), 7000) }
  const downloadExcel = async () => {
    if (!cf) return
    const buf = XLSX.write(buildCfsWorkbook(cf.rows, { cc: cf.cc }), { type: 'buffer', bookType: 'xlsx' })
    const eName = (entity?.name || 'FS').replace(/[^A-Za-z0-9]+/g, '_')
    const result = await window.api?.saveFileDialog({ defaultPath: `${eName}_CFS_Filled.xlsx`, filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }] })
    if (result?.filePath && buf) { await window.api?.writeFile(result.filePath, Array.from(new Uint8Array(buf))); flash(`Saved: ${result.filePath}`) }
  }
  const uploadExcel = async () => {
    if (!cf || !periodId) return
    const result = await window.api?.openFileDialog({ filters: [{ name: 'Excel Workbook', extensions: ['xlsx', 'xls'] }], properties: ['openFile'] })
    const filePath = result?.filePaths?.[0]
    if (!filePath) return
    const bytes = await window.api?.readFile(filePath)
    const parsed = parseCfsSheet(XLSX.read(new Uint8Array(bytes), { type: 'array' }))
    if (!parsed) { flash('No CFS sheet found in that file.'); return }
    if (!parsed.any) { flash('The CFS sheet has no figures - nothing updated.'); return }
    const { saved: next, changed } = applyCfsUpload(parsed, [...cf.rows, ...cf.cc.rows], saved)
    await persist(next)
    flash(`Uploaded: ${changed} figure${changed !== 1 ? 's' : ''} updated.`)
  }

  // Recompute: put back the figures drawn from the Balance Sheet and Profit & Loss in place of the ones typed over them.
  // The Previous Year figures are kept; the rows added by the CA are kept unless asked for.
  const overrideCount = Object.keys(saved.cy || {}).length
  const customCount = (saved.custom || []).length
  const hiddenCount = (saved.hidden || []).length
  const recompute = async () => {
    await persist({ ...saved, cy: {}, custom: alsoRows ? [] : (saved.custom || []), hidden: alsoRows ? [] : (saved.hidden || []) })
    setAskRecompute(false); setAlsoRows(false)
    flash(`Recomputed: ${overrideCount} Current Year figure${overrideCount !== 1 ? 's' : ''} drawn again from the Balance Sheet and Profit & Loss${alsoRows && customCount ? `, ${customCount} added row${customCount !== 1 ? 's' : ''} removed` : ''}${alsoRows && hiddenCount ? `, ${hiddenCount} deleted row${hiddenCount !== 1 ? 's' : ''} brought back` : ''}.`)
  }

  const cf = useMemo(() => (data ? buildCashFlow(data, saved) : null), [data, saved])
  const period = activeTB?.period || ''
  const hasPY = cf ? cf.rows.some(r => r.kind === 'item' && Math.abs(r.py) > 0.005) : false

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-4 px-5 py-2 border-b border-blue-100 bg-gray-50 shrink-0">
        <span className="text-xs text-gray-500 font-medium">Cash Flow Statement (AS 3 - indirect method)</span>
        <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer" title="Print the Cash Flow Statement after the Profit & Loss in the PDF and add it to the Excel">
          <input type="checkbox" checked={!!saved.include} onChange={e => persist({ ...saved, include: e.target.checked })} />
          Include in PDF / Excel
        </label>
        <button onClick={() => { setAlsoRows(false); setAskRecompute(v => !v) }} disabled={!cf || (!overrideCount && !customCount && !hiddenCount)} className="text-xs border border-gray-300 rounded px-2 py-1 hover:bg-white disabled:opacity-40" title="Discard the Current Year figures you typed over and draw them again from the Balance Sheet and Profit & Loss">↺ Recompute</button>
        <button onClick={downloadExcel} disabled={!cf} className="text-xs border border-gray-300 rounded px-2 py-1 hover:bg-white disabled:opacity-40" title="Download the statement as Excel (the same CFS sheet as the Notes tab's Filled Template), fill it in and upload it again">⬇ Filled Excel</button>
        <button onClick={uploadExcel} disabled={!cf || !periodId} className="text-xs border border-gray-300 rounded px-2 py-1 hover:bg-white disabled:opacity-40" title="Upload a filled CFS sheet: Current Year overwrites, Previous Year figures and added rows are saved">⬆ Upload Excel</button>
        {status && <span className="text-xs text-green-700">{status}</span>}
        <div className="ml-auto flex items-center gap-2">
          <PYModeSelect activeTB={activeTB} onChanged={refresh} />
          <ManualPYButton tbId={activeTB?.id} entityId={entity?.id} data={data} onChanged={refresh}
            onEnabledChange={isBranchEntity ? setManualPyOn : undefined}
            disabled={(isBranchEntity && !!prevTB?.id) || pyOff}
            disabledTitle="Previous Year balances for the Balance Sheet movements" />
          <PYTBSelector entity={entity} currentTBId={activeTB?.id} prevTB={prevTB} onChange={onPrevTBChange}
            disabled={(isBranchEntity && manualPyOn) || pyOff}
            disabledTitle="Previous Year figures are switched off for this Financial Year." />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 bg-white">
        <Guard activeTB={activeTB} loading={loading} error={error}>
          {data && cf && (
            <>
              <div className="text-center mb-4 pb-3 border-b-2 border-blue-800">
                <h1 className="text-lg font-bold text-blue-900 uppercase tracking-wide">{entity?.name || 'Entity Name'}</h1>
                {entity?.constitution_display && <p className="text-xs text-gray-500 mt-0.5">({entity.constitution_display})</p>}
                <h2 className="text-sm font-bold text-gray-800 mt-2 uppercase tracking-wide">Cash Flow Statement</h2>
                {period && <p className="text-xs text-gray-500 mt-0.5">for the year ended {period}</p>}
                <p className="text-xs text-gray-400 mt-0.5">(Amount in ₹)</p>
              </div>

              <div className="max-w-5xl mx-auto mb-3 space-y-1.5">
                {askRecompute && (
                  <div className="text-xs bg-amber-50 border border-amber-300 text-amber-900 rounded px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span>
                      Draw the Current Year again from the Balance Sheet and Profit &amp; Loss{overrideCount ? `, discarding the ${overrideCount} figure${overrideCount !== 1 ? 's' : ''} you typed over` : ''}? Previous Year figures are kept.
                    </span>
                    {(customCount > 0 || hiddenCount > 0) && (
                      <label className="flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={alsoRows} onChange={e => setAlsoRows(e.target.checked)} />
                        {' '}Also {[customCount > 0 ? `remove the ${customCount} row${customCount !== 1 ? 's' : ''} I added` : '', hiddenCount > 0 ? `bring back the ${hiddenCount} row${hiddenCount !== 1 ? 's' : ''} I deleted` : ''].filter(Boolean).join(' and ')}
                      </label>
                    )}
                    <span className="ml-auto flex gap-2">
                      <button onClick={recompute} className="px-2 py-0.5 rounded bg-amber-600 text-white hover:bg-amber-700">Recompute</button>
                      <button onClick={() => { setAskRecompute(false); setAlsoRows(false) }} className="px-2 py-0.5 rounded border border-amber-400 hover:bg-amber-100">Cancel</button>
                    </span>
                  </div>
                )}
                {cf.hiddenRows && cf.hiddenRows.length > 0 && (
                  <div className="text-xs bg-gray-50 border border-gray-200 text-gray-700 rounded px-3 py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-semibold">Deleted rows:</span>
                    {cf.hiddenRows.map(h => (
                      <span key={h.id} className="inline-flex items-center gap-1">
                        {h.label}
                        <button onClick={() => restoreRow(h.id)} className="text-blue-700 hover:underline" title="Bring this row back">↺ restore</button>
                      </span>
                    ))}
                  </div>
                )}
                {!periodId && <div className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded px-3 py-1.5">This Trial Balance is not tied to a Financial Year, so what you type here cannot be saved.</div>}
                {cf.checks.noPreviousBalances && <div className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded px-3 py-1.5">No Previous Year balances are loaded (pick a Previous Year Trial Balance above, or use Manual PY). Without them the opening cash and every movement in working capital, borrowings, assets and funds are drawn against nil.</div>}
                {cf.checks.agrees
                  ? <div className="text-xs bg-green-50 border border-green-200 text-green-800 rounded px-3 py-1.5">Closing cash agrees with the Balance Sheet ({fmtCfs(cf.checks.closingCashBS)}).</div>
                  : <div className="text-xs bg-red-50 border border-red-200 text-red-700 rounded px-3 py-1.5">Closing cash per this statement ({fmtCfs(cf.checks.closingCashCFS)}) differs from the Balance Sheet ({fmtCfs(cf.checks.closingCashBS)}).{(saved.custom || []).length > 0 && ' Rows you added are counted in their activity totals, so the closing cash moves with them; the Balance Sheet figure does not.'}</div>}
                {cf.rows.some(r => r.id === 'x_diff') && <div className="text-xs bg-red-50 border border-red-200 text-red-700 rounded px-3 py-1.5">The lines above do not fully explain the Balance Sheet's own movement in cash. This follows from a figure typed over, from Previous Year balances that do not match last year's closing balances, or from a Balance Sheet that does not tally. The difference is shown on its own line so the statement still ends at the Balance Sheet figure.</div>}
                {hasPY && Math.abs(cf.checks.pyClosingVsCyOpening) >= 1 && <div className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded px-3 py-1.5">Closing cash of the Previous Year as typed ({fmtCfs(cf.py.cash_close)}) differs from the Current Year opening cash per the Balance Sheet ({fmtCfs(cf.cy.cash_open)}).</div>}
              </div>

              <table className="w-full max-w-5xl mx-auto text-xs">
                <thead>
                  <tr className="border-b-2 border-blue-800">
                    <th className="text-left py-1.5 font-semibold text-blue-900 w-[56%]">Particulars</th>
                    <th className="text-right py-1.5 font-semibold text-blue-900 w-[22%] pr-2">Current Year</th>
                    <th className="text-right py-1.5 font-semibold text-blue-900 w-[22%] pr-2">Previous Year <span className="font-normal text-gray-400">(type)</span></th>
                  </tr>
                </thead>
                <tbody>
                  {cf.rows.map(r => {
                    if (r.kind === 'head') return <tr key={r.id} className="bg-blue-800 text-white"><td colSpan={3} className="py-1.5 pl-2 font-semibold">{r.label}</td></tr>
                    if (r.kind === 'caption') return <tr key={r.id}><td colSpan={3} className="py-1 pl-2 italic text-gray-600">{r.label}</td></tr>
                    const strong = r.kind === 'sub' || r.kind === 'total'
                    const addBtn = SECTION_OF_TOTAL[r.id] ? (
                      <tr key={'add_' + r.id}>
                        <td colSpan={3} className="py-1 pl-6">
                          <button onClick={() => addRow(SECTION_OF_TOTAL[r.id][0])} className="text-[11px] text-blue-700 hover:underline" title="Add a line of your own here; what you type is counted in the total below it">+ Add a row {SECTION_OF_TOTAL[r.id][1]}</button>
                        </td>
                      </tr>
                    ) : null
                    const rowCls = r.kind === 'total' ? 'bg-blue-50 font-semibold border-b border-blue-200' : r.kind === 'sub' ? 'bg-gray-50 font-semibold border-b border-gray-200' : r.id === 'x_diff' ? 'bg-red-50/60 border-b border-gray-100' : 'border-b border-gray-100 hover:bg-gray-50'
                    if (r.custom) return (
                      <tr key={r.id} className="border-b border-gray-100 bg-blue-50/30">
                        <td className="py-0.5 pl-6">
                          <div className="flex items-center gap-1">
                            <input value={saved.custom.find(c => c.id === r.customId)?.label || ''} placeholder="Describe the item (e.g. Loan given to director)"
                              onChange={e => setSaved({ ...saved, custom: saved.custom.map(c => c.id === r.customId ? { ...c, label: e.target.value } : c) })}
                              onBlur={() => persist(saved)}
                              className="flex-1 bg-transparent text-xs text-gray-800 border-b border-transparent hover:border-gray-300 focus:outline-none focus:border-blue-400 py-1" />
                            <button onClick={() => removeCustom(r.customId)} className="text-gray-400 hover:text-red-600 px-1" title="Remove this row">×</button>
                          </div>
                        </td>
                        <td className="py-0.5"><FigureCell value={r.cy} onCommit={v => setCustom(r.customId, 'cy', v === null ? 0 : v)} tone="text-blue-700 font-semibold" title="Type the Current Year figure (outflows in brackets or with a minus)" /></td>
                        <td className="py-0.5"><FigureCell value={r.py} onCommit={v => setCustom(r.customId, 'py', v === null ? 0 : v)} tone="text-gray-900" title="Type the Previous Year figure" /></td>
                      </tr>
                    )
                    const mainRow = (
                      <tr key={r.id} className={rowCls}>
                        <td className={`py-1.5 ${strong ? 'pl-2' : 'pl-6'} text-gray-800`}>
                          <div className="flex items-center gap-1">
                            <span className="flex-1">{r.label}</span>
                            {r.deletable && <button onClick={() => deleteRow(r.id)} className="text-gray-300 hover:text-red-600 px-1" title="Delete this row (for example because you have put the same item in a row of your own). It leaves the statement and its total; it can be brought back above the table.">×</button>}
                          </div>
                        </td>
                        <td className="py-0.5">
                          {r.cyEditable ? (
                            <div className="flex items-center justify-end">
                              {r.typed && <button className="text-[10px] text-blue-600 mr-1 hover:underline" title={`Use the figure drawn from the statements (${fmtCfs(r.drawn)})`} onClick={() => setSide('cy', r.id, null)}>↺ {fmtCfs(r.drawn)}</button>}
                              <FigureCell value={r.cy} onCommit={v => setSide('cy', r.id, v)} tone={r.typed ? 'text-blue-700 font-semibold' : 'text-gray-900'} title={r.typed ? 'Typed by you' : 'Drawn from the Balance Sheet and Profit & Loss - click to type over it'} />
                            </div>
                          ) : <div className={`text-right font-mono pr-2 py-1 ${r.id === 'x_diff' ? 'text-red-600' : ''}`}>{fmtCfs(r.cy)}</div>}
                        </td>
                        <td className="py-0.5">
                          {r.pyEditable
                            ? <FigureCell value={r.py} onCommit={v => setSide('py', r.id, v)} tone="text-gray-900" title="Type the Previous Year figure (outflows in brackets or with a minus)" />
                            : <div className="text-right font-mono pr-2 py-1">{r.id === 'x_diff' ? '' : fmtCfs(r.py)}</div>}
                        </td>
                      </tr>
                    )
                    return addBtn ? [addBtn, mainRow] : mainRow
                  })}
                </tbody>
              </table>

              {/* AS 3 paras 45-48: components of cash and cash equivalents, reconciled to the Balance Sheet */}
              <div className="max-w-5xl mx-auto mt-6">
                <h3 className="text-xs font-bold text-blue-900 uppercase tracking-wide mb-1">Components of cash and cash equivalents (AS 3)</h3>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b-2 border-blue-800">
                      <th className="text-left py-1.5 font-semibold text-blue-900 w-[56%]">Particulars</th>
                      <th className="text-right py-1.5 font-semibold text-blue-900 w-[22%] pr-2">Current Year</th>
                      <th className="text-right py-1.5 font-semibold text-blue-900 w-[22%] pr-2">Previous Year <span className="font-normal text-gray-400">(type)</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cf.cc.items.map(r => (
                      <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-1.5 pl-6 text-gray-800">{r.label}</td>
                        <td className="py-0.5">
                          <div className="flex items-center justify-end">
                            {r.typed && <button className="text-[10px] text-blue-600 mr-1 hover:underline" title={`Use the figure drawn from the Balance Sheet (${fmtCfs(r.drawn)})`} onClick={() => setSide('cy', r.id, null)}>↺ {fmtCfs(r.drawn)}</button>}
                            <FigureCell value={r.cy} onCommit={v => setSide('cy', r.id, v)} tone={r.typed ? 'text-blue-700 font-semibold' : 'text-gray-900'} title={r.typed ? 'Typed by you' : 'Drawn from the ledgers of the Cash and cash equivalents line - click to type over it'} />
                          </div>
                        </td>
                        <td className="py-0.5"><FigureCell value={r.py} onCommit={v => setSide('py', r.id, v)} tone="text-gray-900" title="Type the Previous Year figure" /></td>
                      </tr>
                    ))}
                    <tr className="bg-blue-50 font-semibold border-b border-blue-200">
                      <td className="py-1.5 pl-2">Cash and cash equivalents as above</td>
                      <td className="text-right font-mono pr-2 py-1">{fmtCfs(cf.cc.totalCY)}</td>
                      <td className="text-right font-mono pr-2 py-1">{fmtCfs(cf.cc.totalPY)}</td>
                    </tr>
                    <tr className="border-b border-gray-100">
                      <td className="py-1.5 pl-6 text-gray-800">Cash and cash equivalents as per the Balance Sheet</td>
                      <td className="text-right font-mono pr-2 py-1">{fmtCfs(cf.cc.bsCY)}</td>
                      <td className="text-right font-mono pr-2 py-1">{fmtCfs(cf.cc.bsPY)}</td>
                    </tr>
                    {(Math.abs(cf.cc.diffCY) > 0.5 || Math.abs(cf.cc.diffPY) > 0.5) && (
                      <tr className="bg-red-50/60 border-b border-gray-100">
                        <td className="py-1.5 pl-6 text-red-700">Difference to be explained</td>
                        <td className="text-right font-mono pr-2 py-1 text-red-600">{fmtCfs(cf.cc.diffCY)}</td>
                        <td className="text-right font-mono pr-2 py-1 text-red-600">{fmtCfs(cf.cc.diffPY)}</td>
                      </tr>
                    )}
                    <tr className="border-b border-gray-100">
                      <td className="py-1.5 pl-6 text-gray-800">{cf.cc.restricted.label}</td>
                      <td className="py-0.5"><FigureCell value={cf.cc.restricted.cy} onCommit={v => setSide('cy', cf.cc.restricted.id, v)} tone="text-gray-900" title="Significant cash and bank balances not available for use (AS 3 para 48)" /></td>
                      <td className="py-0.5"><FigureCell value={cf.cc.restricted.py} onCommit={v => setSide('py', cf.cc.restricted.id, v)} tone="text-gray-900" /></td>
                    </tr>
                    <tr>
                      <td colSpan={3} className="py-1 pl-6">
                        <input value={saved.ccNote || ''} placeholder="Explanation of the balances not available for use, if any (printed under the table)"
                          onChange={e => setSaved({ ...saved, ccNote: e.target.value })} onBlur={() => persist(saved)}
                          className="w-full bg-transparent text-xs text-gray-800 border-b border-transparent hover:border-gray-300 focus:outline-none focus:border-blue-400 py-1" />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="max-w-5xl mx-auto mt-4 text-[11px] text-gray-500 leading-relaxed space-y-1">
                <p>Cash and cash equivalents comprise the "Cash and cash equivalents" line of the Balance Sheet. Bank deposits shown separately on the Balance Sheet are treated as investing.</p>
                <p>Current Year: working-capital, borrowing and fund movements are the difference between the Balance Sheet's Current Year and Previous Year balances; depreciation, finance costs, interest and dividend income and profit / loss on sale are taken from the Profit & Loss ledgers by name. Taxes paid is the tax expense for the year, the movement in tax balances sits in the working-capital lines. Type over any figure that is not right for this entity.</p>
                <p>Previous Year: not drawn, because the Trial Balance of the year before it is not in the tool. Type the figures from last year's Cash Flow Statement; outflows in brackets or with a minus.</p>
              </div>
            </>
          )}
        </Guard>
      </div>
    </div>
  )
}
