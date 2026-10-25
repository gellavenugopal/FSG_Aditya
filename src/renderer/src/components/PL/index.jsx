import React, { useState, useEffect } from 'react'
import { formatPeriodText } from '../../utils/financialPeriodDisplay'
import { useFinancials, fmtINR } from '../../hooks/useFinancials'
import { useEps } from '../../hooks/useEps'
import PYTBSelector from '../shared/PYTBSelector'
import ManualPYButton from '../shared/ManualPYButton'
import PYModeSelect from '../shared/PYModeSelect'
import RemarkCell, { useRemarks } from '../shared/RemarkCell'
import { FormatRefButton, SCHEDULE3_SECTIONS } from '../shared/FormatReference'
import { computeNonCorpPLLayout } from '../../utils/plStructureNonCorp'
import { fixFilterWith } from '../../utils/fixTargets'
import { EXPENSE_LINES, corpFaceTail, TAX_SECTION_RX } from '../../utils/plStructureCorp'

const ROMAN = ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX']

function Guard({ activeTB, loading, error, children }) {
  if (!activeTB) return <div className="flex items-center justify-center h-full text-gray-400 text-sm">Load a Trial Balance in the Actual TB tab first.</div>
  if (loading)   return <div className="flex items-center justify-center h-full text-gray-400">Loading financial data...</div>
  if (error)     return <div className="flex items-center justify-center h-full text-red-500 text-sm px-8 text-center">{error}</div>
  return children
}

// EPS is a per-share Rupee figure — unlike every other PL line, it must
// NEVER be run through fmtINR's denomination scaling (Lacs/Crores would
// turn "₹12.35 per share" into a meaningless fraction). Editable: it starts
// out showing the auto-computed PAT/shares figure, and committing a typed
// value here persists it as a permanent override (see useEps.js) until the
// CA clears the field back to blank.
function EpsCell({ value, isRed, dash = false, onCommit }) {
  const fmt = (v) => (v === null || v === undefined || isNaN(v)) ? '' : Number(v).toFixed(2)
  const [text, setText] = useState(fmt(value))
  useEffect(() => { setText(fmt(value)) }, [value])
  return (
    <input
      type="number" step="0.01"
      value={text}
      placeholder={dash ? '—' : isRed ? 'Fill Share Capital' : '0.00'}
      onChange={e => setText(e.target.value)}
      onBlur={() => onCommit(text)}
      className={`w-full bg-transparent text-right font-mono text-xs pr-2 py-1 border-b focus:outline-none focus:border-blue-400 ${
        isRed ? 'text-red-600 border-red-300 placeholder:text-red-300 placeholder:italic' : 'text-gray-900 border-transparent'}`}
    />
  )
}

function EpsRow({ label, indent, cyValue, pyValue, cyRed, pyRed, pyDash = false, onCommitCY, onCommitPY }) {
  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50">
      <td className={`py-1.5 text-xs ${indent ? 'pl-10' : 'pl-6'} text-gray-800`}>{label}</td>
      <td className="py-1.5 text-center text-xs"></td>
      <td className="py-1 text-xs"><EpsCell value={cyValue} isRed={cyRed} onCommit={onCommitCY} /></td>
      <td className="py-1 text-xs py-col"><EpsCell value={pyValue} isRed={pyRed} dash={pyDash && (pyValue === null || pyValue === undefined)} onCommit={onCommitPY} /></td>
    </tr>
  )
}

function Row({ roman, label, noteNum, amount, prevAmount, bold, dark, red, indent, sub, onNoteClick, tbId, remarkKey, getRemark, onRemarkSaved, onFix, fixFilter, fixLabel, fixButtonLabel }) {
  const cls = dark  ? 'bg-blue-800 text-white'
    : bold  ? 'bg-blue-50 font-semibold border-b border-blue-200'
    : red   ? 'bg-red-50/60 border-b border-gray-100 hover:bg-red-100/60'
    : sub   ? 'bg-gray-50 border-b border-gray-100'
    : 'border-b border-gray-100 hover:bg-gray-50'

  const indentClass = indent ? 'pl-10' : roman ? 'pl-3' : sub ? 'pl-14' : 'pl-6'

  return (
    <tr className={cls}>
      <td className={`py-1.5 text-xs ${indentClass} ${dark ? '' : bold ? 'text-blue-800' : red ? 'text-red-700' : sub ? 'text-gray-600 italic' : 'text-gray-800'}`}>
        {roman && <span className="inline-block w-10 font-semibold">{roman}.</span>}
        {label}
        {tbId && onFix && fixFilter && (
          <button onClick={() => onFix(fixFilter, fixLabel || `Fix: ${label}`)}
            className={`ml-2 px-1.5 py-0.5 text-[10px] rounded border transition font-medium ${
              red ? 'border-red-400 text-red-700 bg-white hover:bg-red-100'
                  : 'border-blue-300 text-blue-700 bg-white hover:bg-blue-50'}`}>
            {fixButtonLabel || 'Fix'}
          </button>
        )}
        {tbId && (remarkKey || label) && (
          <span className="ml-1 align-middle">
            <RemarkCell tbId={tbId} scope="pl" scopeKey={remarkKey || label}
              initialValue={getRemark?.('pl', remarkKey || label) || ''}
              onSaved={onRemarkSaved} compact />
          </span>
        )}
      </td>
      <td className="py-1.5 text-center text-xs">
        {noteNum ? (
          <button onClick={() => onNoteClick?.(noteNum)}
            className={`font-semibold hover:underline ${dark ? 'text-blue-200' : 'text-blue-600'}`}>
            {noteNum}
          </button>
        ) : ''}
      </td>
      <td className={`py-1.5 text-right font-mono text-xs pr-2 ${dark ? 'font-bold' : bold ? 'text-blue-900 font-bold border-t-2 border-blue-400' : red ? 'text-red-600' : sub ? 'text-gray-700' : 'text-gray-900'}`}>
        {amount !== undefined ? fmtINR(amount) : ''}
      </td>
      <td className={`py-col py-1.5 text-right font-mono text-xs pr-2 ${dark ? 'opacity-70' : bold ? 'text-gray-400 border-t-2 border-blue-400' : 'text-gray-400'}`}>
        {prevAmount !== undefined ? fmtINR(prevAmount) : ''}
      </td>
    </tr>
  )
}

function Spacer() { return <tr><td colSpan={4} className="py-1" /></tr> }
function SectionHead({ label }) {
  return <tr className="bg-blue-50"><td colSpan={4} className="py-1.5 px-3 font-bold text-blue-800 border-b border-blue-100 text-xs uppercase">{label}</td></tr>
}

// ── Bucket mapper ────────────────────────────────────────────────────────────
// Returns buckets map + uncatExpSections + uncatIncSections
// buckets: { [key]: { total, prevTotal, noteNum, sections } }
function buildExpenseBuckets(expSections, incSections) {
  const buckets = {}
  EXPENSE_LINES.forEach(el => { buckets[el.key] = { total: 0, prevTotal: 0, noteNum: null, sections: [] } })

  // Inventory: useFinancials.js's processRows() already splits stock movement
  // into "Cost of materials consumed" (Raw Materials) vs "Changes in
  // inventories" (WIP/Finished Goods/Stock-in-Trade) — see
  // utils/inventorySplit.js — and folds any legacy separate "Opening Stock
  // (PL)"/"Closing Stock (PL)" buckets into that same corrected total. Don't
  // recompute Opening − Closing here too, or legacy-structure entities would
  // double-count it.
  const openSec    = expSections.find(s => /opening stock/i.test(s.level1))
  const closeSec   = incSections.find(s => /closing stock/i.test(s.level1))
  const changesSec = expSections.find(s => /changes in inventor/i.test(s.level1))

  buckets['inv_changes'].total     = changesSec ? changesSec.total     : 0
  buckets['inv_changes'].prevTotal = changesSec ? changesSec.prevTotal : 0
  buckets['inv_changes'].noteNum   = changesSec?.noteNum || openSec?.noteNum || closeSec?.noteNum || null

  const skipSections  = new Set([openSec?.level1, closeSec?.level1, changesSec?.level1].filter(Boolean))
  // discontinuing operations have their own lines (XII-XIV) — see corpFaceTail
  const skipPatterns  = [/tax expense/i, /exceptional|extraordinary/i, /discontinuing/i]
  const uncatExpSections = []   // sections that couldn't be matched to any known line

  for (const sec of expSections) {
    if (skipSections.has(sec.level1)) continue
    if (skipPatterns.some(rx => rx.test(sec.level1))) continue

    // Uncategorised sections shown separately — not folded into "Other expenses"
    if (/uncategorised/i.test(sec.level1)) {
      uncatExpSections.push(sec)
      continue
    }

    let matched = false
    for (const el of EXPENSE_LINES) {
      if (!el.match) continue
      if (el.match.test(sec.level1)) {
        buckets[el.key].total     += sec.total
        buckets[el.key].prevTotal += sec.prevTotal
        if (!buckets[el.key].noteNum) buckets[el.key].noteNum = sec.noteNum
        buckets[el.key].sections.push(sec)
        matched = true
        break
      }
    }
    if (!matched) {
      buckets['other_expenses'].total     += sec.total
      buckets['other_expenses'].prevTotal += sec.prevTotal
      if (!buckets['other_expenses'].noteNum) buckets['other_expenses'].noteNum = sec.noteNum
      buckets['other_expenses'].sections.push(sec)
    }
  }

  // Exact L1 title of the "Changes in inventories" section, as it exists on
  // this entity's mapped ledgers (wording varies slightly by constitution —
  // see Mapping_v2.xlsx's LevelFormat sheet) — used to scope the "Categorise
  // Stock" Fix button to just this bucket's ledgers.
  const changesSecLevel1 = changesSec?.level1 || null

  return { buckets, uncatExpSections, changesSecLevel1 }
}

// ── Non-corporate (constitution=1) PL body — driven entirely by the shared
// computeNonCorpPLLayout() so this screen, the PDF, and the Excel export
// always render the identical sequence and roman-numeral numbering.
// Inline "+ Add Line" for a manual custom face line (no backing TB ledger) —
// currently used only under non-corp Tax expense, see computeNonCorpPLLayout.
function AddFaceLineRow({ tbId, section, onAdded }) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [cy, setCy] = useState('')
  const [py, setPy] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!label.trim() || !tbId) return
    setSaving(true)
    try {
      await window.api?.addManualFaceLine({ tbId, section, label: label.trim(), cy_amount: cy || 0, py_amount: py || 0 })
      setLabel(''); setCy(''); setPy(''); setOpen(false)
      onAdded?.()
    } finally { setSaving(false) }
  }

  if (!open) {
    return (
      <tr>
        <td colSpan={4} className="py-1 pl-10">
          <button onClick={() => setOpen(true)} className="text-[11px] text-blue-600 hover:underline">+ Add Line</button>
        </td>
      </tr>
    )
  }
  return (
    <tr className="bg-blue-50/50">
      <td className="py-1 pl-10 pr-2">
        <input autoFocus value={label} onChange={e => setLabel(e.target.value)} placeholder="Particular name"
          className="w-full border border-blue-300 rounded px-1.5 py-0.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-400" />
      </td>
      <td />
      <td className="py-1 pr-2">
        <input type="number" value={cy} onChange={e => setCy(e.target.value)} placeholder="CY amount"
          className="w-full text-right font-mono border border-blue-300 rounded px-1.5 py-0.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-400" />
      </td>
      <td className="py-1 pr-2">
        <div className="flex items-center gap-1">
          <input type="number" value={py} onChange={e => setPy(e.target.value)} placeholder="PY amount"
            className="w-full text-right font-mono border border-blue-300 rounded px-1.5 py-0.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
            onKeyDown={e => { if (e.key === 'Enter') save() }} />
          <button onClick={save} disabled={saving || !label.trim()} className="text-[11px] text-white bg-blue-600 rounded px-1.5 py-0.5 disabled:opacity-40 shrink-0">Save</button>
          <button onClick={() => { setOpen(false); setLabel(''); setCy(''); setPy('') }} className="text-[11px] text-gray-400 hover:text-gray-600 shrink-0">✕</button>
        </div>
      </td>
    </tr>
  )
}

function NonCorpPLTable({ layout, onNoteClick, tbId, getRemark, onRemarkSaved, openFix, businessType, onFaceLineChanged }) {
  return (
    <>
      {layout.items.map((item, i) => {
        switch (item.kind) {
          case 'manual':
            return (
              <tr key={i} className="border-b border-gray-100">
                <td className="py-1.5 text-xs pl-10 text-gray-800">
                  ({item.alpha}) {item.label}
                  <button onClick={async () => { await window.api?.deleteManualFaceLine(item.id); onFaceLineChanged?.() }}
                    className="ml-2 text-[10px] text-red-400 hover:text-red-600" title="Remove this line">✕</button>
                </td>
                <td />
                <td className="py-1.5 text-right font-mono text-xs pr-2 text-gray-900">{fmtINR(item.cy)}</td>
                <td className="py-1.5 text-right font-mono text-xs pr-2 text-gray-400">{fmtINR(item.py)}</td>
              </tr>
            )
          case 'addline':
            return <AddFaceLineRow key={i} tbId={tbId} section={item.section} onAdded={onFaceLineChanged} />
          case 'row':
            return (
              <Row key={i} roman={item.roman} label={item.label}
                noteNum={item.noteNum} amount={item.cy || undefined} prevAmount={item.py || undefined}
                onNoteClick={onNoteClick} tbId={tbId} remarkKey={item.label}
                getRemark={getRemark} onRemarkSaved={onRemarkSaved} />
            )
          case 'uncat':
            return (
              <Row key={i} label={item.label} amount={item.cy} prevAmount={item.py}
                red indent onNoteClick={onNoteClick} tbId={tbId} getRemark={getRemark} onRemarkSaved={onRemarkSaved}
                onFix={openFix} fixFilter={{ alie: item.label.includes('Income') ? 'Income' : 'Expenses', uncategorised: true }} />
            )
          case 'sub': {
            // "Changes in inventories" mixes Raw Materials in with WIP/Finished
            // Goods/Stock-in-Trade until each stock ledger is sub-categorised
            // (Level 5 "Nature") — Trader entities are presumed entirely
            // Stock-in-Trade so there's nothing to ask. See utils/inventorySplit.js.
            const showStockFix = /changes in inventor/i.test(item.label) && item.level1 && businessType !== 'Trader'
            return (
              <Row key={i} label={`(${item.alpha}) ${item.label}`} noteNum={item.noteNum}
                amount={item.cy || undefined} prevAmount={item.py || undefined}
                indent onNoteClick={onNoteClick} tbId={tbId} remarkKey={item.label}
                getRemark={getRemark} onRemarkSaved={onRemarkSaved}
                onFix={showStockFix ? openFix : undefined}
                fixFilter={showStockFix ? { mapping1_resultant: item.level1, level5_unclassified: true } : undefined}
                fixLabel="Categorise Stock (Raw Material / Other)"
                fixButtonLabel="Categorise Stock" />
            )
          }
          case 'subtotal':
            return <React.Fragment key={i}><Row label={item.label} amount={item.cy} prevAmount={item.py} bold tbId={tbId} getRemark={getRemark} onRemarkSaved={onRemarkSaved} /><Spacer /></React.Fragment>
          case 'header':
            return <SectionHead key={i} label={`${item.roman}. ${item.label}`} />
          case 'total':
            return <React.Fragment key={i}><Row roman={item.roman} label={item.label} amount={item.cy} prevAmount={item.py} bold tbId={tbId} getRemark={getRemark} onRemarkSaved={onRemarkSaved} /><Spacer /></React.Fragment>
          case 'grandtotal':
            return <Row key={i} roman={item.roman} label={item.label} amount={item.cy} prevAmount={item.py} dark tbId={tbId} getRemark={getRemark} onRemarkSaved={onRemarkSaved} />
          default:
            return null
        }
      })}
    </>
  )
}

export default function PL({ entity, activeTB, prevTB, activeRsId, onPrevTBChange, onNoteClick, onFixNavigate }) {
  const { data, loading, error, refresh } = useFinancials(activeTB, prevTB, entity, activeRsId)
  const { get: getRemark, set: setRemark } = useRemarks(activeTB?.id)
  const onRemarkSaved = (scope, key, value) => setRemark(scope, key, value)
  const tbId = activeTB?.id
  const eps = useEps(tbId, entity?.id)
  // "Fix" jumps to the full Rectification / Recategorisation screen, scoped
  // to just the clicked category — same screen/features as the Mapping menu.
  const openFix = (filter, title) => onFixNavigate?.(filter, title)

  // Branch entities: Manual PY and a real Previous Year TB selection are
  // mutually exclusive — see BS/index.jsx for the full rationale.
  const isBranchEntity = !!entity?.has_branches
  const [manualPyOn, setManualPyOn] = useState(false)

  const constitution = entity?.constitution
  const plTitle = constitution === 1 ? 'PROFIT AND LOSS ACCOUNT' : 'STATEMENT OF PROFIT AND LOSS'
  // Individual/Proprietorship/Partnership: fixed ICAI non-corporate PL sequence
  // (Cost of goods sold collapsed to one line, Exceptional/Extraordinary items,
  // Partners' remuneration, discontinuing operations). Company and LLP keep
  // the existing dynamic Schedule III rendering below, untouched.
  const isNonCorp1 = parseInt(constitution) === 1
  const [manualTaxLines, setManualTaxLines] = useState([])
  const [manualTaxTick, setManualTaxTick] = useState(0)
  useEffect(() => {
    if (!isNonCorp1 || !tbId) { setManualTaxLines([]); return }
    window.api?.listManualFaceLines(tbId, 'tax-expense-noncorp').then(rows => setManualTaxLines(rows || [])).catch(() => setManualTaxLines([]))
  }, [isNonCorp1, tbId, manualTaxTick])
  const nonCorpLayout = isNonCorp1 && data ? computeNonCorpPLLayout(data, entity?.constitution_display, manualTaxLines) : null
  const period = formatPeriodText(activeTB?.period)
  const subtitle = period ? `for the year ended ${period}` : ''
  // Previous Year not required for this Financial Year (PYModeSelect) - see BS/index.jsx.
  const pyOff = !!data?.pyMode && data.pyMode !== 'required'
  const pyOffTitle = 'Previous Year figures are switched off for this Financial Year (Previous Year figures: Required).'
  const cyLabel = 'Current Year'
  const pyLabel = 'Previous Year'

  const incSections = data?.incomeSections || []
  const expSections = data?.expenseSections || []

  // Income: exclude Closing Stock (moved to inventories line)
  const pureIncome     = incSections.filter(s => !/closing stock/i.test(s.level1) && !/exceptional|extraordinary/i.test(s.level1))
  // Ordinary tax only — the discontinuing operations' own tax is line XIII, not part of X.
  const taxSections    = expSections.filter(s => TAX_SECTION_RX.test((s.level1 || '').trim()))
  const tail           = corpFaceTail(expSections)   // Exceptional, Extraordinary, discontinuing operations

  // Revenue from operations, classified Other income, and uncategorised income
  const revSec        = pureIncome.find(s => /revenue from operation/i.test(s.level1))
  const uncatIncSecs  = pureIncome.filter(s => /uncategorised/i.test(s.level1))
  const otherInc      = pureIncome.filter(s =>
    !/revenue from operation/i.test(s.level1) && !/uncategorised/i.test(s.level1)
  )

  const totalRevCY   = revSec ? revSec.total    : 0
  const totalRevPY   = revSec ? revSec.prevTotal : 0
  const otherIncCY   = otherInc.reduce((s, x) => s + x.total,     0)
  const otherIncPY   = otherInc.reduce((s, x) => s + x.prevTotal, 0)
  const uncatIncCY   = uncatIncSecs.reduce((s, x) => s + x.total,     0)
  const uncatIncPY   = uncatIncSecs.reduce((s, x) => s + x.prevTotal, 0)
  const totalIncomeCY = totalRevCY + otherIncCY + uncatIncCY
  const totalIncomePY = totalRevPY + otherIncPY + uncatIncPY

  // Expense buckets
  const { buckets, uncatExpSections, changesSecLevel1 } = data
    ? buildExpenseBuckets(expSections, incSections)
    : { buckets: {}, uncatExpSections: [], changesSecLevel1: null }

  const uncatExpCY = uncatExpSections.reduce((s, x) => s + x.total,     0)
  const uncatExpPY = uncatExpSections.reduce((s, x) => s + x.prevTotal, 0)

  const mainExpCY = EXPENSE_LINES.reduce((s, el) => s + (buckets[el.key]?.total || 0), 0) + uncatExpCY
  const mainExpPY = EXPENSE_LINES.reduce((s, el) => s + (buckets[el.key]?.prevTotal || 0), 0) + uncatExpPY

  const taxCY   = taxSections.reduce((s, x) => s + x.total,     0)
  const taxPY   = taxSections.reduce((s, x) => s + x.prevTotal, 0)
  const exceptCY = tail.exceptional.cy,   exceptPY = tail.exceptional.py
  const extraCY  = tail.extraordinary.cy, extraPY  = tail.extraordinary.py

  const pbt    = totalIncomeCY - mainExpCY - exceptCY - extraCY
  const prevPBT = totalIncomePY - mainExpPY - exceptPY - extraPY
  const pat    = pbt - taxCY               // from continuing operations (XI)
  const prevPAT = prevPBT - taxPY
  const netCY  = pat + tail.discAfterTax.cy  // for the period (XV)
  const netPY  = prevPAT + tail.discAfterTax.py

  let rn = 0

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-4 px-5 py-2 border-b border-blue-100 bg-gray-50 shrink-0">
        <span className="text-xs text-gray-500 font-medium">Profit & Loss</span>
        <FormatRefButton entity={entity} url={SCHEDULE3_SECTIONS.PL.url} label={SCHEDULE3_SECTIONS.PL.label} />
        <div className="ml-auto flex items-center gap-2">
          <PYModeSelect activeTB={activeTB} onChanged={refresh} />
          <ManualPYButton tbId={activeTB?.id} entityId={entity?.id} data={data} onChanged={refresh}
            onEnabledChange={isBranchEntity ? setManualPyOn : undefined}
            disabled={(isBranchEntity && !!prevTB?.id) || pyOff}
            disabledTitle={pyOff ? pyOffTitle : 'A Previous Year Trial Balance is already selected for this branch — clear it below to use Manual PY instead.'} />
          <PYTBSelector entity={entity} currentTBId={activeTB?.id} prevTB={prevTB} onChange={onPrevTBChange}
            disabled={(isBranchEntity && manualPyOn) || pyOff}
            disabledTitle={pyOff ? pyOffTitle : 'Manual PY is ON for this branch — turn it off to select a Previous Year Trial Balance instead.'} />
        </div>
      </div>

      <div className={`flex-1 overflow-y-auto p-5 bg-white ${data?.pyMode === 'none_hide' ? 'hide-py' : ''}`}>
        <Guard activeTB={activeTB} loading={loading} error={error}>
          {data && (
            <>
              <div className="text-center mb-5 pb-3 border-b-2 border-blue-800">
                <h1 className="text-lg font-bold text-blue-900 uppercase tracking-wide">{entity?.name || 'Entity Name'}</h1>
                {entity?.constitution_display && <p className="text-xs text-gray-500 mt-0.5">({entity.constitution_display})</p>}
                <h2 className="text-sm font-bold text-gray-800 mt-2 uppercase tracking-wide">{plTitle}</h2>
                {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
                <p className="text-xs text-gray-400 mt-0.5">(Amount in ₹)</p>
              </div>

              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b-2 border-blue-800">
                    <th className="text-left py-1.5 font-semibold text-blue-900 w-[52%]">Particulars</th>
                    <th className="text-center py-1.5 font-semibold text-blue-900 w-[8%]">Note No.</th>
                    <th className="text-right py-1.5 font-semibold text-blue-900 w-[20%] pr-2">{cyLabel}</th>
                    <th className="py-col text-right py-1.5 font-semibold text-blue-900 w-[20%] pr-2">{pyLabel}</th>
                  </tr>
                </thead>
                <tbody>
                {isNonCorp1 && nonCorpLayout ? (
                  <NonCorpPLTable layout={nonCorpLayout} onNoteClick={onNoteClick} tbId={tbId}
                    getRemark={getRemark} onRemarkSaved={onRemarkSaved} openFix={openFix}
                    businessType={entity?.business_type} onFaceLineChanged={() => setManualTaxTick(t => t + 1)} />
                ) : (
                <>
                  {/* ── I. Revenue from operations ── */}
                  {(() => { rn++; return null })()}
                  <Row roman={ROMAN[rn-1]} label="Revenue from operations"
                    noteNum={revSec?.noteNum} amount={totalRevCY} prevAmount={totalRevPY}
                    onNoteClick={onNoteClick}
                    tbId={tbId} remarkKey="Revenue from operations" getRemark={getRemark} onRemarkSaved={onRemarkSaved} />

                  {/* ── II. Other income ── */}
                  {(() => { rn++; return null })()}
                  <Row roman={ROMAN[rn-1]} label="Other income"
                    noteNum={otherInc[0]?.noteNum} amount={otherIncCY || undefined} prevAmount={otherIncPY || undefined}
                    onNoteClick={onNoteClick}
                    tbId={tbId} remarkKey="Other income" getRemark={getRemark} onRemarkSaved={onRemarkSaved} />

                  {/* Uncategorised income — shown with Fix button */}
                  {uncatIncCY || uncatIncPY ? (
                    <Row label="Uncategorised Income"
                      noteNum={uncatIncSecs[0]?.noteNum}
                      amount={uncatIncCY} prevAmount={uncatIncPY}
                      red indent
                      onNoteClick={onNoteClick}
                      onFix={openFix} fixFilter={fixFilterWith({ alie: 'Income', uncategorised: true }, uncatIncSecs.flatMap(s => s.lines.flatMap(l => l.rows || [])))}
                      tbId={tbId} getRemark={getRemark} onRemarkSaved={onRemarkSaved}
                    />
                  ) : null}

                  <Spacer />

                  {/* ── III. Total Revenue ── */}
                  {(() => { rn++; return null })()}
                  <Row roman={ROMAN[rn-1]}
                    label={`Total Revenue (I + II)`}
                    amount={totalIncomeCY} prevAmount={totalIncomePY} bold
                    tbId={tbId} getRemark={getRemark} onRemarkSaved={onRemarkSaved} />

                  <Spacer />

                  {/* ── IV. Expenses ── */}
                  {(() => { rn++; return null })()}
                  <SectionHead label={`${ROMAN[rn-1]}. Expenses`} />

                  {EXPENSE_LINES.map(el => {
                    const b = buckets[el.key]
                    if (!b) return null
                    // "Changes in inventories" mixes Raw Materials in with WIP/
                    // Finished Goods/Stock-in-Trade until each stock ledger is
                    // sub-categorised (Level 5 "Nature") — Trader entities are
                    // presumed entirely Stock-in-Trade so there's nothing to
                    // ask. See utils/inventorySplit.js.
                    const showStockFix = el.key === 'inv_changes' && changesSecLevel1 && entity?.business_type !== 'Trader'
                    return (
                      <Row key={el.key}
                        label={el.label}
                        noteNum={b.noteNum}
                        amount={b.total || undefined}
                        prevAmount={b.prevTotal || undefined}
                        indent
                        onNoteClick={onNoteClick}
                        tbId={tbId} remarkKey={el.label}
                        getRemark={getRemark} onRemarkSaved={onRemarkSaved}
                        onFix={showStockFix ? openFix : undefined}
                        fixFilter={showStockFix ? { mapping1_resultant: changesSecLevel1, level5_unclassified: true } : undefined}
                        fixLabel="Categorise Stock (Raw Material / Other)"
                        fixButtonLabel="Categorise Stock"
                      />
                    )
                  })}
                  {/* Uncategorised expenses — shown with Fix button, separate from Other expenses */}
                  {(uncatExpCY || uncatExpPY) ? (
                    <Row
                      label="Uncategorised Expenses"
                      noteNum={uncatExpSections[0]?.noteNum}
                      amount={uncatExpCY} prevAmount={uncatExpPY}
                      indent red
                      onNoteClick={onNoteClick}
                      onFix={openFix} fixFilter={fixFilterWith({ alie: 'Expenses', uncategorised: true }, uncatExpSections.flatMap(s => s.lines.flatMap(l => l.rows || [])))}
                      tbId={tbId} getRemark={getRemark} onRemarkSaved={onRemarkSaved}
                    />
                  ) : null}
                  <Spacer />
                  <Row label="Total expenses" amount={mainExpCY} prevAmount={mainExpPY} bold
                    tbId={tbId} getRemark={getRemark} onRemarkSaved={onRemarkSaved} />

                  <Spacer />

                  {/* ── V. Profit before exceptional and extraordinary items and tax ── */}
                  {(() => { rn++; return null })()}
                  <Row roman={ROMAN[rn-1]}
                    label="Profit before exceptional and extraordinary items and tax (III - IV)"
                    amount={totalIncomeCY - mainExpCY} prevAmount={totalIncomePY - mainExpPY} bold
                    tbId={tbId} getRemark={getRemark} onRemarkSaved={onRemarkSaved} />

                  {/* ── VI. Exceptional items ── */}
                  {(() => { rn++; return null })()}
                  <Row roman={ROMAN[rn-1]} label="Exceptional items"
                    noteNum={tail.exceptional.noteNum} onNoteClick={onNoteClick}
                    amount={exceptCY || exceptPY ? exceptCY : undefined} prevAmount={exceptCY || exceptPY ? exceptPY : undefined}
                    tbId={tbId} getRemark={getRemark} onRemarkSaved={onRemarkSaved} />

                  {/* ── VII. Profit before extraordinary items and tax ── */}
                  {(() => { rn++; return null })()}
                  <Row roman={ROMAN[rn-1]}
                    label={`Profit before extraordinary items and tax (${ROMAN[rn-3]} - ${ROMAN[rn-2]})`}
                    amount={totalIncomeCY - mainExpCY - exceptCY}
                    prevAmount={totalIncomePY - mainExpPY - exceptPY} bold
                    tbId={tbId} getRemark={getRemark} onRemarkSaved={onRemarkSaved} />

                  {/* ── VIII. Extraordinary Items ── */}
                  {(() => { rn++; return null })()}
                  <Row roman={ROMAN[rn-1]} label="Extraordinary Items"
                    noteNum={tail.extraordinary.noteNum} onNoteClick={onNoteClick}
                    amount={extraCY || extraPY ? extraCY : undefined} prevAmount={extraCY || extraPY ? extraPY : undefined}
                    tbId={tbId} getRemark={getRemark} onRemarkSaved={onRemarkSaved} />

                  <Spacer />

                  {/* ── IX. Profit before tax ── */}
                  {(() => { rn++; return null })()}
                  <Row roman={ROMAN[rn-1]} label={`Profit before tax (${ROMAN[rn-3]} - ${ROMAN[rn-2]})`}
                    amount={pbt} prevAmount={prevPBT} bold
                    tbId={tbId} getRemark={getRemark} onRemarkSaved={onRemarkSaved} />

                  <Spacer />

                  {/* ── X. Tax expense ── */}
                  {(() => { rn++; return null })()}
                  <SectionHead label={`${ROMAN[rn-1]}. Tax expense:`} />
                  {taxSections.length > 0 ? taxSections.map(sec =>
                    sec.lines.map(line => (
                      <Row key={line.level2 || sec.level1}
                        label={line.level2 || sec.level1}
                        noteNum={line.noteNum || sec.noteNum}
                        amount={line.total} prevAmount={line.prevTotal}
                        indent onNoteClick={onNoteClick}
                        tbId={tbId} getRemark={getRemark} onRemarkSaved={onRemarkSaved} />
                    ))
                  ) : (
                    <>
                      <Row label="(1) Current tax"  amount={0} prevAmount={0} indent tbId={tbId} getRemark={getRemark} onRemarkSaved={onRemarkSaved} />
                      <Row label="(2) Deferred tax" amount={0} prevAmount={0} indent tbId={tbId} getRemark={getRemark} onRemarkSaved={onRemarkSaved} />
                    </>
                  )}

                  <Spacer />

                  {/* ── XI. Profit for period from continuing operations ── */}
                  {(() => { rn++; return null })()}
                  <Row roman={ROMAN[rn-1]}
                    label={`Profit (Loss) for the period from continuing operations (${ROMAN[rn-3]}-${ROMAN[rn-2]})`}
                    amount={pat} prevAmount={prevPAT} bold
                    tbId={tbId} getRemark={getRemark} onRemarkSaved={onRemarkSaved} />

                  {/* ── XII. Profit from discontinuing operations ── */}
                  {(() => { rn++; return null })()}
                  <Row roman={ROMAN[rn-1]} label="Profit/(loss) from discontinuing operations"
                    noteNum={tail.discProfit.noteNum} onNoteClick={onNoteClick}
                    amount={tail.discProfit.cy} prevAmount={tail.discProfit.py}
                    tbId={tbId} getRemark={getRemark} onRemarkSaved={onRemarkSaved} />

                  {/* ── XIII. Tax of discontinuing operations ── */}
                  {(() => { rn++; return null })()}
                  <Row roman={ROMAN[rn-1]} label="Tax expense of discontinuing operations"
                    noteNum={tail.discTax.noteNum} onNoteClick={onNoteClick}
                    amount={tail.discTax.cy} prevAmount={tail.discTax.py}
                    tbId={tbId} getRemark={getRemark} onRemarkSaved={onRemarkSaved} />

                  {/* ── XIV. Profit from discontinuing operations after tax ── */}
                  {(() => { rn++; return null })()}
                  <Row roman={ROMAN[rn-1]}
                    label={`Profit/(loss) from Discontinuing operations after tax (${ROMAN[rn-3]}-${ROMAN[rn-2]})`}
                    amount={tail.discAfterTax.cy} prevAmount={tail.discAfterTax.py}
                    tbId={tbId} getRemark={getRemark} onRemarkSaved={onRemarkSaved} />

                  <Spacer />

                  {/* ── XV. Profit for period ── */}
                  {(() => { rn++; return null })()}
                  <Row roman={ROMAN[rn-1]}
                    label={`Profit (Loss) for the period (${ROMAN[rn-5]} + ${ROMAN[rn-2]})`}
                    amount={netCY} prevAmount={netPY} dark
                    tbId={tbId} getRemark={getRemark} onRemarkSaved={onRemarkSaved} />

                  <Spacer />

                  {/* ── XVI. EPS — Company only (Schedule III) ── */}
                  {parseInt(constitution) === 3 && (() => {
                    rn++
                    const epsData = data.eps || {}
                    const commit = (field) => (text) => { eps.setField(field, text); refresh() }
                    const cyMissing = !!epsData.sharesMissingCY
                    const pyMissing = !!epsData.sharesMissingPY
                    return (
                      <>
                        <SectionHead label={`${ROMAN[rn-1]}. Earnings per equity share:`} />
                        <EpsRow label="(1) Basic" indent
                          cyValue={eps.values.basicCY ?? epsData.autoBasicCY} pyValue={eps.values.basicPY ?? epsData.autoBasicPY}
                          cyRed={cyMissing && eps.values.basicCY == null} pyRed={pyMissing && eps.values.basicPY == null} pyDash={!!epsData.pyNotApplicable}
                          onCommitCY={commit('basicCY')} onCommitPY={commit('basicPY')} />
                        <EpsRow label="(2) Diluted" indent
                          cyValue={eps.values.dilutedCY ?? epsData.autoDilutedCY} pyValue={eps.values.dilutedPY ?? epsData.autoDilutedPY}
                          cyRed={cyMissing && eps.values.dilutedCY == null} pyRed={pyMissing && eps.values.dilutedPY == null} pyDash={!!epsData.pyNotApplicable}
                          onCommitCY={commit('dilutedCY')} onCommitPY={commit('dilutedPY')} />
                        {(cyMissing || pyMissing) && (
                          <tr>
                            <td colSpan={4} className="py-1 pl-10 pr-2 text-[11px] text-red-600 italic">
                              ⚠ Number of Equity Shares Issued &amp; Subscribed not found in the Share Capital note's Fill Details — EPS shown in red until it's filled in, or type the figures directly above.
                            </td>
                          </tr>
                        )}
                      </>
                    )
                  })()}
                </>
                )}
                </tbody>
              </table>

              {/* Key metrics */}
              {(() => {
                const kmIncome = isNonCorp1 && nonCorpLayout ? nonCorpLayout.totalIncome : totalIncomeCY
                const kmExpense = isNonCorp1 && nonCorpLayout ? nonCorpLayout.totalExpenses : mainExpCY
                const kmProfit = isNonCorp1 && nonCorpLayout ? nonCorpLayout.netProfit : netCY
                return (
              <div className="mt-4 grid grid-cols-3 gap-3">
                {[
                  { label: 'Total Revenue',   value: kmIncome,  cls: 'text-green-700' },
                  { label: 'Total Expenses',  value: kmExpense, cls: 'text-orange-700' },
                  { label: kmProfit >= 0 ? 'Net Profit' : 'Net Loss',
                    value: Math.abs(kmProfit),
                    cls: kmProfit >= 0 ? 'text-blue-800' : 'text-red-700' },
                ].map(({ label, value, cls }) => (
                  <div key={label} className="summary-card text-center">
                    <div className="text-xs text-gray-500 mb-0.5">{label}</div>
                    <div className={`font-bold text-sm font-mono ${cls}`}>{fmtINR(value)}</div>
                  </div>
                ))}
              </div>
                )
              })()}

              <div className="mt-4 pt-3 border-t border-gray-200 text-xs text-gray-400">
                The accompanying notes form an integral part of the financial statements.
              </div>
            </>
          )}
        </Guard>
      </div>
    </div>
  )
}
