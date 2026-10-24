import React, { useState, useEffect, useRef } from 'react'
import * as XLSX from 'xlsx-js-style'
import PYTBSelector from '../shared/PYTBSelector'
import { buildStockBlankTemplate, buildStockFilledWorkbook, parseStockWorkbook } from './stockWorkbook'
import {
  INVENTORY_TYPES, HEAD_TYPES, cleanHead, headKey, hasFigures, typesNeedingHead, headsToSave,
  stockDestination, RAW_FALLBACK_HINT, headOptions, snapHead, filterHeadOptions,
} from './stockHeads'

// Category labels used by an earlier version of this form. Rows saved back
// then are still sitting in the database under these old names — without
// this normalisation they become invisible (no longer match any of the 8
// rows above) while still being summed into the Total, which is exactly the
// "Total has a value but every row above shows 0" bug this fixes.
const LEGACY_ALIASES = {
  'work-in-progress': 'Work in Progress',
  'stores and spares': 'Stores & Spares',
  'others (specify nature)': 'Others',
  'uncategorised inventory': 'Uncategorised Stock',
}

function normalizeCategory(raw) {
  const trimmed = (raw || '').trim()
  const lower = trimmed.toLowerCase()
  const exact = INVENTORY_TYPES.find(t => t.toLowerCase() === lower)
  if (exact) return exact
  if (LEGACY_ALIASES[lower]) return LEGACY_ALIASES[lower]
  return trimmed // genuinely unrecognised — surfaced separately, never silently folded in
}

function numFmt(v) {
  if (!v || v === 0) return ''
  return Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Loads a TB's saved stock rows into { [inventoryType]: amount } maps for
// opening/closing (current year, and — for the active TB — the manually
// typed Previous Year figures kept on this same TB, used only when there's
// no separate comparative TB to pull PY from). Legacy category labels are
// normalised to the current canonical set (see LEGACY_ALIASES) so old data
// isn't invisible. `heads` is { category: Other-expenses head } for Stores &
// Spares / Loose Tools / Others, as saved on their stock rows (0.1.93).
export async function loadStockMaps(tbId) {
  const rows = await window.api?.getStockRows(tbId)
  const op = {}, cl = {}
  const pyOp = {}, pyCl = {}
  const heads = {}
  const noteHead = (type, r) => {
    const h = cleanHead(r.stock_head)
    if (h && HEAD_TYPES.includes(type) && !heads[type]) heads[type] = h
  }
  for (const r of (rows || [])) {
    if (r.name.startsWith('Opening Stock - ')) {
      const type = normalizeCategory(r.name.replace('Opening Stock - ', ''))
      op[type] = (op[type] || 0) + Math.abs(parseFloat(r.closing_balance) || 0)
      noteHead(type, r)
    } else if (r.name.startsWith('Closing Stock - PL - ')) {
      const type = normalizeCategory(r.name.replace('Closing Stock - PL - ', ''))
      cl[type] = (cl[type] || 0) + Math.abs(parseFloat(r.closing_balance) || 0)
      noteHead(type, r)
    } else if (r.name.startsWith('Closing Stock - BS - ')) {
      noteHead(normalizeCategory(r.name.replace('Closing Stock - BS - ', '')), r)
    } else if (r.name.startsWith('PY Opening Stock - ')) {
      const type = normalizeCategory(r.name.replace('PY Opening Stock - ', ''))
      pyOp[type] = (pyOp[type] || 0) + Math.abs(parseFloat(r.closing_balance) || 0)
      noteHead(type, r)
    } else if (r.name.startsWith('PY Closing Stock - ')) {
      const type = normalizeCategory(r.name.replace('PY Closing Stock - ', ''))
      pyCl[type] = (pyCl[type] || 0) + Math.abs(parseFloat(r.closing_balance) || 0)
      noteHead(type, r)
    }
  }
  return { op, cl, pyOp, pyCl, heads }
}

// ── The box that asks which Other-expenses head a category is adjusted in ─────────
// Stores & Spares / Loose Tools / Others: the line of the Other expenses note their Opening - Closing is added into. It turns red as
// soon as the row has an amount and no head. Clicking it lists last year's head, the lines this Trial Balance's Other expenses already
// has, and the standard Other-expenses captions of the mapping; anything else typed is taken as a head of the CA's own.
export function HeadPicker({ type, value, onChange, options, needed, lastYear = '' }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(value || '')
  const [typed, setTyped] = useState(false)     // the CA is typing: filter the list by it
  const [active, setActive] = useState(-1)
  const wrapRef = useRef(null)
  const missing = !!needed && !cleanHead(value)
  const shown = typed ? filterHeadOptions(options, text) : options
  const isNew = typed && !!cleanHead(text) && !options.some(o => headKey(o.name) === headKey(text))
  // The matches first (so the first arrow-down lands on one), then what was typed, as a head of its own.
  const rows = [
    ...shown.map(o => ({ kind: 'opt', name: o.name, group: o.group })),
    ...(isNew ? [{ kind: 'new', name: cleanHead(text) }] : []),
  ]

  // The box shows what is saved, except while the CA is in it.
  useEffect(() => { if (!open) setText(value || '') }, [value, open])

  const finish = (t) => {
    const v = snapHead(t, options)
    onChange(v)
    setText(v)
    setTyped(false)
    setOpen(false)
    setActive(-1)
  }
  // A click anywhere else keeps what was typed (or just closes the list).
  useEffect(() => {
    if (!open) return undefined
    const away = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        if (typed) finish(text); else { setOpen(false); setActive(-1) }
      }
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open, typed, text, options, onChange])

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => Math.min(rows.length - 1, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(-1, a - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); finish(active >= 0 && rows[active] ? rows[active].name : text) }
    else if (e.key === 'Escape') { setOpen(false); setTyped(false); setText(value || ''); setActive(-1) }
    else if (e.key === 'Tab' && typed) finish(text)
  }

  let lastGroup = null
  return (
    <div ref={wrapRef} className="relative" data-head-picker={type}>
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={text}
          placeholder={needed ? 'Name the Other Expenses head…' : 'Needed once there is an amount'}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}   // the box keeps focus after a head is chosen, so a second click brings no focus event
          onChange={e => { setText(e.target.value); setTyped(true); setOpen(true); setActive(-1) }}
          onKeyDown={onKeyDown}
          aria-label={`Other Expenses head for ${type}`}
          aria-invalid={missing}
          className={`w-full border rounded px-2 py-1 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none ${missing ? 'border-red-400 bg-red-50' : 'border-gray-300'}`}
        />
        {cleanHead(value) && (
          <button type="button" title="Clear" aria-label={`Clear the head for ${type}`}
            onMouseDown={e => { e.preventDefault(); onChange(''); setText(''); setTyped(false) }}
            className="text-gray-400 hover:text-red-600 text-base leading-none px-1">×</button>
        )}
      </div>
      {missing && (
        <div className="text-[11px] text-red-600 mt-0.5">
          Needed: the Other expenses line its Opening and Closing stock is adjusted in.
          {lastYear && (
            <> <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => finish(lastYear)}
              className="text-blue-700 hover:underline">Use last year&apos;s: {lastYear}</button></>
          )}
        </div>
      )}
      {open && (
        <div className="absolute z-20 left-0 right-0 mt-0.5 bg-white border border-gray-300 rounded shadow-lg max-h-60 overflow-auto text-sm">
          {rows.length === 0 && <div className="px-2 py-1.5 text-xs text-gray-400">Type a name to use as the head.</div>}
          {rows.map((r, i) => {
            const header = r.kind === 'opt' && r.group !== lastGroup ? r.group : null
            if (r.kind === 'opt') lastGroup = r.group
            return (
              <React.Fragment key={`${r.kind}-${r.name}`}>
                {header && <div className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400 bg-gray-50">{header}</div>}
                <div
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={e => { e.preventDefault(); finish(r.name) }}
                  onMouseEnter={() => setActive(i)}
                  className={`px-2 py-1 cursor-pointer ${i === active ? 'bg-blue-100' : 'hover:bg-blue-50'} ${r.kind === 'new' ? 'text-blue-800' : 'text-gray-700'}`}
                >
                  {r.kind === 'new' ? <>Use &ldquo;{r.name}&rdquo; as a new head</> : r.name}
                </div>
              </React.Fragment>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── The category table ────────────────────────────────────────────────────────────
// footer (optional): the Total / Total as per Trial Balance / Difference rows.
export function StockTable({ opening, closing, pyOpening, pyClosing, heads, pyHeads, headChoices, businessType, pyLoading, onValue, onHead, footer }) {
  const maps = { opening, closing, pyOpening, pyClosing }
  const diffCell = (d) => (
    <td className={`py-1 px-2 text-right font-mono ${d === null ? 'text-gray-300' : Math.abs(d) < 0.01 ? 'text-green-700' : 'text-red-600'}`}>
      {d === null ? '—' : numFmt(d) || '0.00'}
    </td>
  )
  const amountInput = (section, value, type) => (
    <input
      type="number"
      step="0.01"
      value={value[type] || ''}
      onChange={e => onValue(section, type, e.target.value)}
      className="w-full border border-gray-300 rounded px-2 py-1 text-sm text-right font-mono focus:ring-2 focus:ring-blue-400 focus:outline-none"
      placeholder="0.00"
    />
  )
  return (
    <table className="w-full text-sm border border-gray-200 rounded mb-3">
      <thead>
        <tr className="bg-blue-50">
          <th rowSpan={2} className="text-left py-1.5 px-3 font-semibold text-blue-900 align-bottom border-b border-gray-200">Types of Inventory</th>
          <th colSpan={2} className="text-center py-1 px-2 font-semibold text-blue-900 border-b border-l border-gray-200">Current Year</th>
          <th colSpan={2} className="text-center py-1 px-2 font-semibold text-blue-900 border-b border-l border-gray-200">Previous Year</th>
          <th rowSpan={2} className="text-left py-1.5 px-3 font-semibold text-blue-900 align-bottom border-b border-l border-gray-200 w-[30%]">Adjusted in (P&amp;L)</th>
        </tr>
        <tr className="bg-blue-50">
          <th className="text-right py-1 px-2 font-semibold text-blue-900 border-l border-gray-200 w-[11%]">Opening Balance</th>
          <th className="text-right py-1 px-2 font-semibold text-blue-900 w-[11%]">Closing Balance</th>
          <th className="text-right py-1 px-2 font-semibold text-blue-900 border-l border-gray-200 w-[11%]">Opening Balance</th>
          <th className="text-right py-1 px-2 font-semibold text-blue-900 w-[11%]">Closing Balance</th>
        </tr>
      </thead>
      <tbody>
        {INVENTORY_TYPES.map((type, i) => {
          const dest = stockDestination(type, businessType)
          return (
            <tr key={type} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
              <td className="py-1 px-3 text-gray-700 align-top pt-2">{type}</td>
              <td className="py-1 px-2 border-l border-gray-100 align-top">{amountInput('opening', opening, type)}</td>
              <td className="py-1 px-2 align-top">{amountInput('closing', closing, type)}</td>
              <td className="py-1 px-2 border-l border-gray-100 align-top">
                {pyLoading ? <div className="text-right text-gray-400 text-xs py-1">…</div> : amountInput('pyOpening', pyOpening, type)}
              </td>
              <td className="py-1 px-2 align-top">
                {pyLoading ? <div className="text-right text-gray-400 text-xs py-1">…</div> : amountInput('pyClosing', pyClosing, type)}
              </td>
              {dest ? (
                <td className="py-1 px-3 border-l border-gray-100 text-xs text-gray-600 align-top pt-2">
                  {dest}
                  {type === 'Raw Materials' && dest === 'Cost of materials consumed' && (
                    <span className="block text-[10px] text-gray-400">({RAW_FALLBACK_HINT})</span>
                  )}
                </td>
              ) : (
                <td className="py-1 px-2 border-l border-gray-100 align-top">
                  <HeadPicker
                    type={type}
                    value={(heads || {})[type] || ''}
                    onChange={v => onHead(type, v)}
                    options={headOptions({ lastYear: (pyHeads || {})[type], inTB: (headChoices || {}).inTB, standard: (headChoices || {}).standard })}
                    needed={hasFigures(type, maps)}
                    lastYear={cleanHead((pyHeads || {})[type])}
                  />
                </td>
              )}
            </tr>
          )
        })}

        {footer && (
          <>
            <tr className="bg-blue-100 font-bold">
              <td className="py-1.5 px-3 text-blue-800">Total</td>
              <td className="py-1.5 px-2 text-right font-mono text-blue-800 border-l border-blue-200">{numFmt(footer.totOpening) || '0.00'}</td>
              <td className="py-1.5 px-2 text-right font-mono text-blue-800">{numFmt(footer.totClosing) || '0.00'}</td>
              <td className="py-1.5 px-3 text-right font-mono text-blue-800 border-l border-blue-200">{numFmt(footer.totPyOpening) || '0.00'}</td>
              <td className="py-1.5 px-3 text-right font-mono text-blue-800">{numFmt(footer.totPyClosing) || '0.00'}</td>
              <td className="border-l border-blue-200" />
            </tr>

            <tr className="bg-gray-100 font-bold">
              <td className="py-1.5 px-3 text-gray-800">Total as per Trial Balance</td>
              <td className="py-1.5 px-2 text-right font-mono border-l border-gray-200">
                {footer.tbCurOpening === null ? '—' : (numFmt(footer.tbCurOpening) || '0.00')}
                {footer.tbCheck?.embeddedOpeningFromTally && (
                  <span className="ml-1 text-[9px] font-normal text-blue-600 align-middle" title="Resolved from Tally at import (P&L / Stock-in-Hand ledger / Stock Items), not a TB ledger — bifurcate it into the categories above.">Tally</span>
                )}
              </td>
              <td className="py-1.5 px-2 text-right font-mono">
                {footer.tbCurClosing === null ? '—' : (numFmt(footer.tbCurClosing) || '0.00')}
                {footer.tbCheck?.embeddedClosingFromTally && (
                  <span className="ml-1 text-[9px] font-normal text-blue-600 align-middle" title="Pulled from Tally's Stock Items (aggregate value), not a TB ledger — bifurcate it into the categories above.">Tally</span>
                )}
              </td>
              <td className="py-1.5 px-2 text-right font-mono border-l border-gray-200">{footer.tbPyOpening === null ? '—' : (numFmt(footer.tbPyOpening) || '0.00')}</td>
              <td className="py-1.5 px-2 text-right font-mono">{footer.tbPyClosing === null ? '—' : (numFmt(footer.tbPyClosing) || '0.00')}</td>
              <td className="border-l border-gray-200" />
            </tr>

            <tr className="font-bold border-t-2 border-gray-300">
              <td className="py-1.5 px-3 text-gray-800">Difference</td>
              {diffCell(footer.diffCurOpening)}
              {diffCell(footer.diffCurClosing)}
              {diffCell(footer.diffPyOpening)}
              {diffCell(footer.diffPyClosing)}
              <td />
            </tr>
          </>
        )}
      </tbody>
    </table>
  )
}

export default function StockPage({ entity, activeTB, prevTB, onPrevTBChange }) {
  const tbId = activeTB?.id
  const pyTbId = prevTB?.id
  // Previous Year figures are ALWAYS editable — a TB never carries its own
  // Opening/Closing Stock bifurcation any more than the current year's does,
  // so whichever TB is playing "Previous Year" here needs the exact same
  // entry + reconciliation treatment. What differs is only the SAVE TARGET:
  //   - No separate comparative TB selected → PY is typed here and saved
  //     onto THIS TB (bundled into the main Save button, as before).
  //   - A separate comparative TB IS selected → PY here is that OTHER TB's
  //     own Stock form, edited for convenience without switching to it;
  //     saving writes to pyTbId via its own Save Previous Year button, and
  //     participates in THAT TB's own litmus reconciliation (see
  //     handleSavePY) so its own Balance Sheet can tally too.
  const [opening, setOpening] = useState({})       // current year — editable
  const [closing, setClosing] = useState({})       // current year — editable
  const [pyOpening, setPyOpening] = useState({})   // previous year — editable
  const [pyClosing, setPyClosing] = useState({})   // previous year — editable
  // The Other-expenses head each of Stores & Spares / Loose Tools / Others is adjusted in (0.1.93), the previous year's TB's heads (offered
  // first), and what the pick-list offers besides.
  const [heads, setHeads] = useState({})
  const [pyHeads, setPyHeads] = useState({})
  const [headChoices, setHeadChoices] = useState({ inTB: [], standard: [] })
  // "Total as per Trial Balance" — per the CA's litmus test, this is
  // AUTO-COMPUTED from the TB's own data (a ledger literally named "Opening
  // Stock"/"Closing Stock"), not typed in. See tb:getOpeningStockCheck.
  const [tbCheck, setTbCheck] = useState(null)     // current TB's litmus check
  const [pyTbCheck, setPyTbCheck] = useState(null) // comparative TB's litmus check
  const [saving, setSaving]   = useState(false)
  const [loading, setLoading] = useState(true)
  const [pyLoading, setPyLoading] = useState(false)
  const [success, setSuccess] = useState('')
  const [error, setError]     = useState('')

  // Load current year stock rows (and, when no comparative TB is selected,
  // this TB's own manually-typed PY figures) whenever the active TB — or
  // whether a comparative TB is selected at all — changes.
  useEffect(() => {
    if (!tbId) { setLoading(false); return }
    setLoading(true)
    Promise.all([
      loadStockMaps(tbId),
      window.api?.getOpeningStockCheck(tbId).catch(() => null),
    ]).then(([{ op, cl, pyOp, pyCl, heads: savedHeads }, check]) => {
      setOpening(op)
      setClosing(cl)
      setHeads(savedHeads || {})
      setTbCheck(check)
      if (!pyTbId) { setPyOpening(pyOp); setPyClosing(pyCl) }
    }).catch(() => {}).finally(() => setLoading(false))
  }, [tbId, pyTbId])

  // The lines this Trial Balance's Other expenses already has, and the standard Other-expenses captions of its mapping.
  useEffect(() => {
    if (!tbId) { setHeadChoices({ inTB: [], standard: [] }); return undefined }
    let alive = true
    Promise.resolve(window.api?.getOtherExpenseHeads?.(tbId))
      .then(r => { if (alive && r) setHeadChoices({ inTB: r.inTB || [], standard: r.standard || [] }) })
      .catch(() => {})
    return () => { alive = false }
  }, [tbId])

  // Load previous year stock rows (read-only comparative) whenever the PY TB changes
  useEffect(() => {
    if (!pyTbId) { setPyTbCheck(null); setPyHeads({}); return }
    setPyLoading(true)
    Promise.all([
      loadStockMaps(pyTbId),
      window.api?.getOpeningStockCheck(pyTbId).catch(() => null),
    ]).then(([{ op, cl, heads: savedHeads }, check]) => {
      setPyOpening(op)
      setPyClosing(cl)
      setPyHeads(savedHeads || {})
      setPyTbCheck(check)
    }).catch(() => {}).finally(() => setPyLoading(false))
  }, [pyTbId])

  const SETTERS = { opening: setOpening, closing: setClosing, pyOpening: setPyOpening, pyClosing: setPyClosing }
  const setVal = (section, type, val) => {
    SETTERS[section](prev => ({ ...prev, [type]: val }))
  }
  const setHead = (type, val) => setHeads(prev => ({ ...prev, [type]: val }))

  const total = (obj) => Object.values(obj).reduce((s, v) => s + (parseFloat(v) || 0), 0)

  const totOpening   = total(opening)
  const totClosing   = total(closing)
  const totPyOpening = total(pyOpening)
  const totPyClosing = total(pyClosing)

  // Entries that survived normalizeCategory() unrecognised — a genuinely
  // unknown category label sitting in the database (not one of the 8 known
  // types, and not a known legacy rename). These still count toward the
  // Total above (nothing is silently dropped from what's shown) but are
  // called out explicitly instead of being invisible, and get cleared out
  // the next time "Save Stock Entries" is clicked (handleSave only persists
  // the 8 known categories).
  const knownSet = new Set(INVENTORY_TYPES)
  const strayTypes = [...new Set([...Object.keys(opening), ...Object.keys(closing)])]
    .filter(t => !knownSet.has(t))

  const diff = (colTotal, tbVal) => {
    if (tbVal === null || tbVal === undefined) return null
    return colTotal - tbVal
  }
  const tbCurOpening = tbCheck ? tbCheck.embeddedOpening : null
  const tbCurClosing = tbCheck ? tbCheck.embeddedClosing : null
  // With no separate PY TB selected, this TB's own embedded "Opening Stock"
  // ledger IS last year's closing stock (this year's opening = last year's
  // closing) — reuse it directly as the PY-Closing reconciliation figure.
  const tbPyOpening  = pyTbCheck ? pyTbCheck.embeddedOpening : null
  const tbPyClosing  = pyTbCheck ? pyTbCheck.embeddedClosing : (tbCheck ? tbCheck.embeddedOpening : null)
  const diffCurOpening = diff(totOpening, tbCurOpening)
  const diffCurClosing = diff(totClosing, tbCurClosing)
  const diffPyOpening  = diff(totPyOpening, tbPyOpening)
  const diffPyClosing  = diff(totPyClosing, tbPyClosing)

  // Saves Current Year (always onto tbId) and, in the SAME click, Previous
  // Year too — bundled into tbId when there's no separate comparative TB
  // selected, or written directly to that comparative TB (pyTbId) otherwise.
  // Previously this required two separate buttons/clicks; one is enough.
  const handleSave = async () => {
    if (!tbId) return
    // Stores & Spares / Loose Tools / Others with an amount must say which line of the Other expenses note they are adjusted in.
    const allMaps = { opening, closing, pyOpening, pyClosing }
    const missing = typesNeedingHead(allMaps, heads)
    if (missing.length) {
      setSuccess('')
      setError(`Name the Other Expenses head for ${missing.join(' and ')} before saving: the line of the Other expenses note that its Opening and Closing stock is adjusted in (for example Consumption of stores and spare parts).`)
      return
    }
    setSaving(true)
    setError('')
    try {
      // Only the 8 known categories are ever written back — saveStock
      // replaces ALL stock rows for this TB, so any stray/legacy-labelled
      // entry still lingering (see strayTypes above) is dropped here rather
      // than being re-saved under its old, unrecognised name.
      const pick = (obj) => Object.fromEntries(INVENTORY_TYPES.map(t => [t, obj[t] ?? '']).filter(([, v]) => v !== ''))
      const stockData = { opening: pick(opening), closing: pick(closing), heads: headsToSave(allMaps, heads) }
      if (!pyTbId) {
        stockData.pyOpening = pick(pyOpening)
        stockData.pyClosing = pick(pyClosing)
      }
      const saves = [window.api?.saveStock({ tbId, stockData })]
      if (pyTbId) {
        saves.push(window.api?.saveStock({
          tbId: pyTbId,
          stockData: { opening: pick(pyOpening), closing: pick(pyClosing), heads: headsToSave({ opening: pyOpening, closing: pyClosing }, heads) },
        }))
      }
      await Promise.all(saves)
      setSuccess('Stock entries saved. Re-run mapping to include stock in financial statements.')
      const [{ op, cl, pyOp, pyCl, heads: savedHeads }, check] = await Promise.all([
        loadStockMaps(tbId),
        window.api?.getOpeningStockCheck(tbId).catch(() => null),
      ])
      setOpening(op)
      setClosing(cl)
      setHeads(savedHeads || {})
      setTbCheck(check)
      if (!pyTbId) {
        setPyOpening(pyOp); setPyClosing(pyCl)
      } else {
        const [{ op: pyOp2, cl: pyCl2, heads: pyHeads2 }, pyCheck] = await Promise.all([
          loadStockMaps(pyTbId),
          window.api?.getOpeningStockCheck(pyTbId).catch(() => null),
        ])
        setPyOpening(pyOp2)
        setPyClosing(pyCl2)
        setPyHeads(pyHeads2 || {})
        setPyTbCheck(pyCheck)
      }
    } catch (err) {
      setError('Failed to save stock: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const saveWorkbook = async (wb, defaultPath) => {
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    const result = await window.api?.saveFileDialog({
      defaultPath, filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
    })
    if (result?.filePath && buf) {
      await window.api?.writeFile(result.filePath, Array.from(new Uint8Array(buf)))
      return result.filePath
    }
    return null
  }

  const downloadBlankTemplate = async () => {
    try {
      const path = await saveWorkbook(buildStockBlankTemplate(), 'Stock_Template.xlsx')
      if (path) setSuccess('Blank template saved.')
    } catch (err) { setError('Download failed: ' + (err?.message || '')) }
  }

  const downloadFilled = async () => {
    try {
      const eName = (entity?.name || 'Entity').replace(/[^A-Za-z0-9]+/g, '_')
      const path = await saveWorkbook(
        buildStockFilledWorkbook(opening, closing, pyOpening, pyClosing, true, heads),
        `${eName}_Stock_Filled.xlsx`
      )
      if (path) setSuccess('Filled stock form saved — keep this safe before re-uploading a Trial Balance.')
    } catch (err) { setError('Download failed: ' + (err?.message || '')) }
  }

  const uploadFilled = async () => {
    try {
      const result = await window.api?.openFileDialog({
        filters: [{ name: 'Excel Workbook', extensions: ['xlsx', 'xls'] }],
        properties: ['openFile'],
      })
      const filePath = result?.filePaths?.[0]
      if (!filePath) return
      const bytes = await window.api?.readFile(filePath)
      const wb = XLSX.read(new Uint8Array(bytes), { type: 'array' })
      const parsed = parseStockWorkbook(wb)
      setOpening(prev => ({ ...prev, ...parsed.opening }))
      setClosing(prev => ({ ...prev, ...parsed.closing }))
      setPyOpening(prev => ({ ...prev, ...parsed.pyOpening }))
      setPyClosing(prev => ({ ...prev, ...parsed.pyClosing }))
      setHeads(prev => ({ ...prev, ...parsed.heads }))
      let msg = 'Loaded from Excel — review below, then click "Save Stock Entries" to persist.'
      if (parsed.unrecognised.length > 0) msg += ` Ignored unrecognised type(s): ${parsed.unrecognised.join(', ')}.`
      setSuccess(msg)
    } catch (err) { setError('Upload failed: ' + (err?.message || '')) }
  }

  useEffect(() => {
    if (!success) return
    const t = setTimeout(() => setSuccess(''), 4000)
    return () => clearTimeout(t)
  }, [success])

  if (!tbId) {
    return (
      <div className="flex flex-col h-full p-4">
        <div className="text-amber-600 text-sm bg-amber-50 border border-amber-200 rounded px-3 py-2">
          No Trial Balance selected — go to Trial Balance → Actual TB to select one before entering Stock details.
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">Loading stock data…</div>
    )
  }

  return (
    <div className="flex flex-col h-full p-4 overflow-y-auto">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2" style={{ maxWidth: '1320px' }}>
        <h2 className="text-base font-bold text-blue-900">Opening & Closing Stock</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={downloadBlankTemplate}
            className="px-3 py-1.5 text-xs border border-gray-300 rounded text-gray-600 hover:bg-gray-100 transition">
            ↓ Blank Template
          </button>
          <button onClick={downloadFilled}
            className="px-3 py-1.5 text-xs border border-green-300 rounded text-green-700 hover:bg-green-50 transition"
            title="Download the current entries — keep this before re-uploading a fresh Trial Balance">
            ↓ Download Filled
          </button>
          <button onClick={uploadFilled}
            className="px-3 py-1.5 text-xs border border-blue-300 rounded text-blue-700 hover:bg-blue-50 transition"
            title="Fill in the on-screen figures from an Excel file, then Save Stock Entries to persist">
            ↑ Upload from Excel
          </button>
          <PYTBSelector entity={entity} currentTBId={tbId} prevTB={prevTB} onChange={onPrevTBChange} />
        </div>
      </div>

      {tbCheck && !tbCheck.isBalanced && !tbCheck.hasManualOpeningStock && (
        <div className="text-amber-700 text-sm bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-4" style={{ maxWidth: '1320px' }}>
          <span className="font-semibold">Trial Balance Opening total doesn't net to zero</span> (Dr ≠ Cr by {numFmt(Math.abs(tbCheck.litmusTotal))}) —
          Opening Stock is likely missing from the uploaded Trial Balance altogether. Enter it under the categories above and
          Save — the total you enter will be pushed into the Trial Balance as an "Opening Stock" ledger row automatically.
        </div>
      )}
      {tbCheck && !tbCheck.isBalanced && tbCheck.hasManualOpeningStock && (
        <div className="text-red-700 text-sm bg-red-50 border border-red-300 rounded px-3 py-2 mb-4" style={{ maxWidth: '1320px' }}>
          <span className="font-semibold">Opening Stock was entered and pushed into the Trial Balance, but it still doesn't fully reconcile</span> —
          a difference of {numFmt(Math.abs(tbCheck.litmusTotal))} remains unexplained (Dr ≠ Cr). Verify the entered Opening
          Stock total above against your records, and check the uploaded Trial Balance for other missing/incorrect entries.
        </div>
      )}
      {tbCheck && tbCheck.isBalanced && tbCheck.embeddedOpening === 0 && tbCheck.embeddedClosing === 0 && (
        <div className="text-blue-700 text-sm bg-blue-50 border border-blue-200 rounded px-3 py-2 mb-4" style={{ maxWidth: '1320px' }}>
          Trial Balance Opening total nets to zero (Dr = Cr) but no ledger literally named "Opening Stock"/"Closing Stock"
          was found — nothing to reconcile against yet.
        </div>
      )}

      {pyTbId && pyTbCheck && !pyTbCheck.isBalanced && !pyTbCheck.hasManualOpeningStock && (
        <div className="text-amber-700 text-sm bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-4" style={{ maxWidth: '1320px' }}>
          <span className="font-semibold">Previous Year Trial Balance Opening total doesn't net to zero</span> (Dr ≠ Cr by {numFmt(Math.abs(pyTbCheck.litmusTotal))}) —
          Opening Stock is likely missing from that Trial Balance too. Enter it under the Previous Year columns above and click
          <span className="font-semibold"> Save Previous Year Stock Entries</span> — it'll be pushed into that TB the same way.
        </div>
      )}
      {pyTbId && pyTbCheck && !pyTbCheck.isBalanced && pyTbCheck.hasManualOpeningStock && (
        <div className="text-red-700 text-sm bg-red-50 border border-red-300 rounded px-3 py-2 mb-4" style={{ maxWidth: '1320px' }}>
          <span className="font-semibold">Previous Year Opening Stock was entered but that Trial Balance still doesn't fully reconcile</span> —
          a difference of {numFmt(Math.abs(pyTbCheck.litmusTotal))} remains unexplained. Verify the entered Previous Year Opening Stock total.
        </div>
      )}

      {strayTypes.length > 0 && (
        <div className="text-amber-700 text-sm bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-4" style={{ maxWidth: '1320px' }}>
          <span className="font-semibold">Unrecognised category found:</span> {strayTypes.map(t => `"${t}"`).join(', ')} —
          this is still included in the Total below but doesn't match any of the 8 rows, so it's shown here separately.
          Click <span className="font-semibold">Save Stock Entries</span> to clear it out (its value will no longer be
          included anywhere until you re-enter it under the correct category above).
        </div>
      )}

      <div style={{ maxWidth: '1320px' }}>
        <StockTable
          opening={opening} closing={closing} pyOpening={pyOpening} pyClosing={pyClosing}
          heads={heads} pyHeads={pyHeads} headChoices={headChoices}
          businessType={entity?.business_type} pyLoading={pyLoading}
          onValue={setVal} onHead={setHead}
          footer={{
            totOpening, totClosing, totPyOpening, totPyClosing,
            tbCheck, tbCurOpening, tbCurClosing, tbPyOpening, tbPyClosing,
            diffCurOpening, diffCurClosing, diffPyOpening, diffPyClosing,
          }}
        />

        <p className="text-xs text-gray-500 mb-2">
          <span className="font-semibold">Adjusted in (P&amp;L):</span> Raw Materials go to Cost of materials consumed (to Changes in
          inventories when there is no such line, and for a Trader); Work in Progress, Finished Goods, Stock-in-Trade and
          Uncategorised Stock go to Changes in inventories. For <span className="font-semibold">Stores &amp; Spares, Loose Tools and Others</span>,
          name the line of the Other expenses note that its Opening and Closing stock is adjusted in (for example Consumption of stores
          and spare parts) — Opening − Closing is added into that line, and a name not in the note yet becomes a new line.
        </p>
        <p className="text-xs text-gray-400 mb-4">
          Previous Year columns are always editable — a Trial Balance never carries its own Opening/Closing Stock split,
          whichever year it's for. With no comparative TB selected, Previous Year is typed here and saved onto this same
          TB. Select a comparative Trial Balance above to instead edit that OTHER TB's own Stock entries directly from
          here — "Save Stock Entries" below saves both Current Year and Previous Year in one click, including pushing a
          missing Opening Stock total back into whichever Trial Balance(s) need it. "Total as per Trial Balance" is
          auto-detected from a ledger literally named "Opening Stock"/"Closing Stock" (shown as "—" when none exists).
          Stock entries are appended to their Trial Balance as additional ledger rows — re-run mapping after saving.
        </p>

        {error && <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded px-3 py-2 mb-3">{error}</div>}
        {success && <div className="text-green-700 text-sm bg-green-50 border border-green-200 rounded px-3 py-2 mb-3">{success}</div>}

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 text-white rounded text-sm font-medium hover:opacity-90 disabled:opacity-40 transition" style={{ background: 'var(--color-primary)' }}
          >
            {saving ? 'Saving…' : 'Save Stock Entries'}
          </button>
        </div>
      </div>
    </div>
  )
}
