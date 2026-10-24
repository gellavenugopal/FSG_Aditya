/**
 * Depreciation — Companies Act 2013, Schedule II
 *   + IT Act 1961 Block-wise WDV Statement
 *   + DTL/DTA on Depreciation (IND AS 12)
 *
 * Data model change: each row is either 'opening' or 'addition'.
 * Opening row: grossOpen + accumDepOpen fields (date optional).
 * Addition row: additions + date (date mandatory).
 * Same ledger can have one opening row AND one addition row.
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { fmtINR } from '../../hooks/useFinancials'

// ── Style constants ────────────────────────────────────────────────────────────
const INP  = 'w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white'
const NINP = INP + ' text-right font-mono'
const DINP = 'w-full border border-gray-200 rounded px-1.5 py-0.5 text-xs bg-gray-100 text-gray-400 text-right font-mono cursor-not-allowed'
const TH   = 'border border-gray-200 px-2 py-1.5 text-[10px] font-semibold text-gray-700 bg-gray-50 text-right whitespace-nowrap'
const THL  = 'border border-gray-200 px-2 py-1.5 text-[10px] font-semibold text-gray-700 bg-gray-50 text-left whitespace-nowrap'
const TD   = 'border border-gray-200 px-1 py-0.5 text-right text-xs font-mono'
const TDI  = 'border border-gray-200 px-1 py-0.5'

// ── Math helpers ───────────────────────────────────────────────────────────────
const num    = v => parseFloat(v) || 0
const RESID  = 0.05

function slmRate(life) { return ((1 - RESID) / life) * 100 }
function wdvRate(life) { return (1 - Math.pow(RESID, 1 / life)) * 100 }

function parseYearEnd(period) {
  if (!period) return null
  // Direct ISO date
  let d = new Date(period)
  if (!isNaN(d)) return d
  // DD/MM/YYYY or DD-MM-YYYY
  const m = period.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/)
  if (m) return new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]))
  // Indian FY format: "FY 2024-25" or "2024-25" → March 31 of the end year
  const fy = period.match(/(?:FY\s*)?(\d{4})[\/\-](\d{2,4})/i)
  if (fy) {
    const startYear  = parseInt(fy[1])
    const endSuffix  = fy[2]
    const endYear    = endSuffix.length === 2
      ? Math.floor(startYear / 100) * 100 + parseInt(endSuffix)
      : parseInt(endSuffix)
    return new Date(endYear, 2, 31) // March 31 of FY end year
  }
  return null
}

function proRataMonths(dateStr, yearEndDate) {
  if (!dateStr || !yearEndDate) return null
  const d = new Date(dateStr)
  if (isNaN(d)) return null
  const months = (yearEndDate.getFullYear() - d.getFullYear()) * 12 +
                 (yearEndDate.getMonth()    - d.getMonth())
  return Math.max(0, Math.min(12, months))
}

// >180 days from capitalisation date to year end → full IT dep
function isMoreThan180Days(dateStr, yearEndDate) {
  if (!dateStr || !yearEndDate) return true
  const d = new Date(dateStr)
  if (isNaN(d)) return true
  return Math.floor((yearEndDate - d) / 86400000) > 180
}

// ── IT Act 1961 — WDV Blocks ───────────────────────────────────────────────────
export const IT_BLOCKS = [
  { id: 'B1',  name: 'Buildings — Residential',                  rate: 5  },
  { id: 'B2',  name: 'Buildings — Non-Residential / Commercial', rate: 10 },
  { id: 'B3',  name: 'Buildings — Factory',                      rate: 10 },
  { id: 'F1',  name: 'Furniture & Fittings',                     rate: 10 },
  { id: 'PM1', name: 'Plant & Machinery — General',              rate: 15 },
  { id: 'PM2', name: 'Motor Cars (excluding hire/taxi)',          rate: 15 },
  { id: 'PM3', name: 'Motor Vehicles — Heavy (Hire/Taxi)',        rate: 30 },
  { id: 'PM4', name: 'Computers & Software',                     rate: 60 },
  { id: 'PM5', name: 'Ships',                                    rate: 20 },
  { id: 'PM6', name: 'Aircraft / Helicopters',                   rate: 40 },
  { id: 'IA1', name: 'Intangible Assets (Know-how / Patents)',    rate: 25 },
]

// ── computeRow: per-row dep for editor ────────────────────────────────────────
function computeRow(r, yearEnd) {
  const life       = num(r.usefulLife) || 15
  const rate       = r.customRate !== '' && !isNaN(parseFloat(r.customRate))
    ? parseFloat(r.customRate)
    : (r.method === 'SLM' ? slmRate(life) : wdvRate(life))
  const rateDisplay = +rate.toFixed(2)
  const deductions  = num(r.deductions)
  const depDisp     = num(r.depDisposals)

  if (r.rowType === 'addition') {
    const additions  = num(r.additions)
    const dateReq    = additions > 0 && !r.date
    const addMonths  = proRataMonths(r.date, yearEnd)
    const addFactor  = (additions > 0 && addMonths === null) ? 0 : (addMonths ?? 12) / 12
    const grossClose = additions - deductions
    const depYear    = Math.max(0, additions * (rate / 100) * addFactor)
    const accumClose = Math.max(0, depYear - depDisp)
    return {
      ...r, grossClose, depYear: +depYear.toFixed(2),
      accumDepOpen: 0, accumClose: +accumClose.toFixed(2),
      nbOpen: 0, nbClose: +(grossClose - accumClose).toFixed(2),
      rateDisplay, addMonths, dateRequired: dateReq,
    }
  } else {
    // Opening row — full year on net opening WDV
    const grossOpen  = num(r.grossOpen)
    const accumOpen  = num(r.accumDepOpen)
    const grossClose = grossOpen - deductions
    const wdvOpen    = Math.max(0, grossOpen - accumOpen)
    let depYear = 0
    if (r.method === 'SLM') {
      depYear = wdvOpen > 0 ? Math.min(grossOpen * (rate / 100), wdvOpen) : 0
    } else {
      depYear = wdvOpen > 0 ? wdvOpen * (rate / 100) : 0
    }
    depYear = Math.max(0, depYear)
    const accumClose = Math.max(0, accumOpen + depYear - depDisp)
    return {
      ...r, grossClose: +grossClose.toFixed(2), depYear: +depYear.toFixed(2),
      accumClose: +accumClose.toFixed(2),
      nbOpen:  +(grossOpen - accumOpen).toFixed(2),
      nbClose: +(grossClose - accumClose).toFixed(2),
      rateDisplay, addMonths: 12, dateRequired: false,
    }
  }
}

// ── Aggregate rows by category for Fixed Assets Schedule ──────────────────────
function aggregateByCategory(rows, yearEnd) {
  const catMap = {}
  for (const row of rows) {
    const cat = row.category || '— Uncategorized —'
    if (!catMap[cat]) {
      catMap[cat] = { category: cat, rows: [], method: row.method, usefulLife: row.usefulLife, customRate: row.customRate }
    }
    catMap[cat].rows.push(row)
  }
  return Object.values(catMap).map(g => {
    const computed    = g.rows.map(r => computeRow(r, yearEnd))
    const openRows    = computed.filter(r => r.rowType === 'opening')
    const addRows     = computed.filter(r => r.rowType === 'addition')
    const grossOpen   = openRows.reduce((s, r) => s + num(r.grossOpen), 0)
    const additions   = addRows.reduce((s, r) => s + num(r.additions), 0)
    const deductions  = computed.reduce((s, r) => s + num(r.deductions), 0)
    const grossClose  = grossOpen + additions - deductions
    const accumOpen   = openRows.reduce((s, r) => s + num(r.accumDepOpen), 0)
    const depYear     = computed.reduce((s, r) => s + r.depYear, 0)
    const depDisp     = computed.reduce((s, r) => s + num(r.depDisposals), 0)
    const accumClose  = Math.max(0, accumOpen + depYear - depDisp)
    const nbOpen      = grossOpen - accumOpen
    const nbClose     = grossClose - accumClose
    const sample      = g.rows[0]
    const life        = num(sample?.usefulLife) || 15
    const rate        = sample?.customRate !== '' && !isNaN(parseFloat(sample?.customRate))
      ? parseFloat(sample.customRate)
      : (sample?.method === 'SLM' ? slmRate(life) : wdvRate(life))
    return { category: g.category, grossOpen, additions, deductions, grossClose, accumDepOpen: accumOpen, depYear, depDisposals: depDisp, accumClose, nbOpen, nbClose, method: sample?.method || 'WDV', rateDisplay: +rate.toFixed(2) }
  })
}

// ── Empty row factories ────────────────────────────────────────────────────────
function emptyRow(type = 'opening') {
  return {
    id: Math.random().toString(36).slice(2),
    rowType: type,
    date: '',
    ledgerName: '',
    category: '',
    itBlock: '',
    method: 'WDV',
    usefulLife: '',
    customRate: '',
    grossOpen: '',
    accumDepOpen: '',
    additions: '',
    deductions: '',
    depDisposals: '',
  }
}

// Migrate legacy rows (pre-split) that had both grossOpen + additions in one row
function migrateRows(rows) {
  return rows.map(r => {
    if (r.rowType) return r  // already new format
    // Old format: had additionDate, now we need rowType + date
    const base = { ...r, date: r.additionDate || r.date || '', itBlock: r.itBlock || '' }
    return { ...base, rowType: 'opening' }  // treat old rows as opening
  })
}

// ── AssetRow component ─────────────────────────────────────────────────────────
function AssetRow({ row, scheduleII, yearEnd, onChange, onDelete }) {
  const computed = computeRow(row, yearEnd)

  // Derive FY start (April 1) and format both as YYYY-MM-DD for min/max
  const fyDateRange = useMemo(() => {
    if (!yearEnd) return {}
    const fyYear = yearEnd.getMonth() < 3 ? yearEnd.getFullYear() - 1 : yearEnd.getFullYear()
    const start = new Date(fyYear, 3, 1)  // April 1
    const fmt = d => d.toISOString().slice(0, 10)
    return { min: fmt(start), max: fmt(yearEnd) }
  }, [yearEnd])

  // Auto-determine type from which field has a value
  const openFilled = num(row.grossOpen) > 0 || num(row.accumDepOpen) > 0
  const addFilled  = num(row.additions) > 0
  // Effective type shown as badge (use stored rowType as tiebreaker when both empty)
  const isAdd  = addFilled || (!openFilled && row.rowType === 'addition')
  const isOpen = !isAdd

  const fillFromSchedule = (cat) => {
    const entry = scheduleII.find(s => s.category === cat)
    if (entry) onChange({ ...row, category: cat, usefulLife: String(entry.life), customRate: '' })
    else onChange({ ...row, category: cat })
  }

  // When opening fields get a value → clear additions and lock type to opening
  const setGrossOpen = (val) => onChange({ ...row, grossOpen: val, additions: '', rowType: 'opening' })
  const setAccumDep  = (val) => onChange({ ...row, accumDepOpen: val, additions: '', rowType: 'opening' })
  // When additions gets a value → clear opening fields and lock type to addition
  const setAdditions = (val) => onChange({ ...row, additions: val, grossOpen: '', accumDepOpen: '', rowType: 'addition' })

  const dateBorderCls = computed.dateRequired
    ? 'border-red-500 bg-red-50'
    : (isAdd && row.date ? 'border-green-400' : '')

  return (
    <tr className={`hover:bg-blue-50/20 ${isAdd ? 'bg-green-50/20' : 'bg-blue-50/10'}`}>
      {/* Date — FIRST COLUMN, mandatory for Addition */}
      <td className={TDI} style={{ minWidth: 115 }}>
        <input
          className={`${INP} ${dateBorderCls}`}
          type="date"
          value={row.date || (isAdd && fyDateRange.min ? fyDateRange.min : '')}
          min={isAdd ? fyDateRange.min : undefined}
          max={isAdd ? fyDateRange.max : undefined}
          onChange={e => onChange({ ...row, date: e.target.value })}
          onFocus={e => {
            if (isAdd && !row.date && fyDateRange.min) {
              e.target.value = fyDateRange.min
              onChange({ ...row, date: fyDateRange.min })
            }
          }}
          title={isAdd ? `Capitalisation date (required) — pick a date between ${fyDateRange.min || 'FY start'} and ${fyDateRange.max || 'FY end'}` : 'Purchase date (optional)'}
          placeholder={isAdd ? 'Select date within FY' : 'Optional'}
        />
        {computed.dateRequired && (
          <div className="text-[9px] text-red-600 font-semibold text-center mt-0.5">⚠ Pick a date</div>
        )}
        {isAdd && !computed.dateRequired && computed.addMonths !== null && (
          <div className="text-[9px] text-blue-600 text-center mt-0.5">{computed.addMonths} mo</div>
        )}
      </td>
      {/* Auto badge — no dropdown */}
      <td className="border border-gray-200 px-1 py-0.5 text-center" style={{ minWidth: 68 }}>
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold select-none ${isAdd ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
          {isAdd ? 'Addition' : 'Opening'}
        </span>
      </td>
      {/* Ledger Name — optional */}
      <td className={TDI} style={{ minWidth: 140 }}>
        <input className={INP} value={row.ledgerName || ''} onChange={e => onChange({ ...row, ledgerName: e.target.value })} placeholder="Ledger (optional)" />
      </td>
      {/* Asset Category */}
      <td className={TDI} style={{ minWidth: 190 }}>
        <select className={INP} value={row.category || ''} onChange={e => fillFromSchedule(e.target.value)}>
          <option value="">-- Select Asset Category --</option>
          {scheduleII.map(s => (
            <option key={s.category} value={s.category}>{s.category}</option>
          ))}
        </select>
      </td>
      {/* Method */}
      <td className={TDI} style={{ minWidth: 60 }}>
        <select className={INP} value={row.method} onChange={e => onChange({ ...row, method: e.target.value })}>
          <option value="WDV">WDV</option>
          <option value="SLM">SLM</option>
        </select>
      </td>
      {/* Useful Life */}
      <td className={TDI} style={{ minWidth: 55 }}>
        <input className={NINP} type="number" min="1" max="99" value={row.usefulLife}
          onChange={e => onChange({ ...row, usefulLife: e.target.value })} placeholder="Yrs" />
      </td>
      {/* Dep Rate */}
      <td className={TDI} style={{ minWidth: 60 }}>
        <input className={NINP} type="number" step="0.01" value={row.customRate}
          onChange={e => onChange({ ...row, customRate: e.target.value })}
          placeholder={computed.rateDisplay.toFixed(2)} title="Leave blank to auto-compute" />
      </td>
      {/* IT Block */}
      <td className={TDI} style={{ minWidth: 110 }}>
        <select className={INP} value={row.itBlock || ''} onChange={e => onChange({ ...row, itBlock: e.target.value })}>
          <option value="">— None —</option>
          {IT_BLOCKS.map(b => <option key={b.id} value={b.id}>{b.id}: {b.name.slice(0, 22)}</option>)}
        </select>
      </td>
      {/* Gross Opening — disabled when additions filled */}
      <td className={TDI} style={{ minWidth: 95 }}>
        {addFilled
          ? <input className={DINP} disabled value="—" title="Clear Additions first to enter Opening Balance" />
          : <input className={NINP} type="number" value={row.grossOpen} onChange={e => setGrossOpen(e.target.value)} />}
      </td>
      {/* Accum Dep Opening — disabled when additions filled */}
      <td className={TDI} style={{ minWidth: 95 }}>
        {addFilled
          ? <input className={DINP} disabled value="—" title="Clear Additions first to enter Opening Balance" />
          : <input className={NINP} type="number" value={row.accumDepOpen} onChange={e => setAccumDep(e.target.value)} />}
      </td>
      {/* Additions — disabled when opening fields filled */}
      <td className={TDI} style={{ minWidth: 95 }}>
        {openFilled
          ? <input className={DINP} disabled value="—" title="Clear Opening Balance first to enter Additions" />
          : <input className={NINP} type="number" value={row.additions} onChange={e => setAdditions(e.target.value)} />}
      </td>
      {/* Deductions */}
      <td className={TDI} style={{ minWidth: 90 }}><input className={NINP} type="number" value={row.deductions} onChange={e => onChange({ ...row, deductions: e.target.value })} /></td>
      {/* Dep on Disposals */}
      <td className={TDI} style={{ minWidth: 90 }}><input className={NINP} type="number" value={row.depDisposals} onChange={e => onChange({ ...row, depDisposals: e.target.value })} /></td>
      {/* Computed columns */}
      <td className={TD + ' bg-blue-50 font-semibold text-blue-900'}>{fmtINR(computed.grossClose)}</td>
      <td className={TD + ' bg-green-50 font-semibold text-green-800'}>{fmtINR(computed.depYear)}</td>
      <td className={TD + ' bg-blue-50 font-semibold text-blue-900'}>{fmtINR(computed.accumClose)}</td>
      <td className={TD + ' bg-gray-50'}>{fmtINR(computed.nbOpen)}</td>
      <td className={TD + ' bg-orange-50 font-semibold text-orange-900'}>{fmtINR(computed.nbClose)}</td>
      {/* Delete */}
      <td className="border border-gray-200 px-1 text-center">
        <button onClick={onDelete} className="text-red-400 hover:text-red-600 text-sm leading-none">✕</button>
      </td>
    </tr>
  )
}

// ── Totals row ─────────────────────────────────────────────────────────────────
function TotalsRow({ rows, yearEnd }) {
  const computed = rows.map(r => computeRow(r, yearEnd))
  const sum = f => computed.reduce((s, r) => s + (num(r[f]) || 0), 0)
  const missingDates = computed.filter(r => r.dateRequired).length
  return (
    <>
      {missingDates > 0 && (
        <tr>
          <td colSpan={20} className="px-3 py-1 text-[10px] text-red-700 bg-red-50 border border-red-200 font-medium">
            ⚠ {missingDates} addition row{missingDates > 1 ? 's' : ''} missing a Date — depreciation on those additions is excluded until date is entered.
          </td>
        </tr>
      )}
      <tr className="bg-blue-800 text-white font-bold text-xs">
        <td colSpan={8} className="border border-blue-700 px-2 py-1.5 text-left">TOTAL</td>
        <td className="border border-blue-700 px-2 py-1 text-right font-mono">{fmtINR(sum('grossOpen'))}</td>
        <td className="border border-blue-700 px-2 py-1 text-right font-mono">{fmtINR(sum('accumDepOpen'))}</td>
        <td className="border border-blue-700 px-2 py-1 text-right font-mono">{fmtINR(sum('additions'))}</td>
        <td className="border border-blue-700 px-2 py-1 text-right font-mono">{fmtINR(sum('deductions'))}</td>
        <td className="border border-blue-700 px-2 py-1 text-right font-mono">{fmtINR(sum('depDisposals'))}</td>
        <td className="border border-blue-700 px-2 py-1 text-right font-mono">{fmtINR(sum('grossClose'))}</td>
        <td className="border border-blue-700 px-2 py-1 text-right font-mono">{fmtINR(sum('depYear'))}</td>
        <td className="border border-blue-700 px-2 py-1 text-right font-mono">{fmtINR(sum('accumClose'))}</td>
        <td className="border border-blue-700 px-2 py-1 text-right font-mono">{fmtINR(sum('nbOpen'))}</td>
        <td className="border border-blue-700 px-2 py-1 text-right font-mono">{fmtINR(sum('nbClose'))}</td>
        <td className="border border-blue-700" />
      </tr>
    </>
  )
}

// ── Fixed Assets Schedule (aggregated by category) ────────────────────────────
function ScheduleView({ rows, entity, period, yearEnd }) {
  const cats = useMemo(() => aggregateByCategory(rows, yearEnd), [rows, yearEnd])
  const sum  = f => cats.reduce((s, r) => s + (r[f] || 0), 0)
  return (
    <div className="p-4 bg-white text-xs">
      <div className="text-center mb-4 pb-2 border-b-2 border-blue-800">
        <h1 className="text-sm font-bold text-blue-900 uppercase">{entity?.name || 'Entity Name'}</h1>
        <h2 className="text-sm font-bold text-gray-700 mt-1">Fixed Assets Schedule — Property, Plant & Equipment (Tangible)</h2>
        {period && <p className="text-xs text-gray-500">For the year ended {period}</p>}
        <p className="text-[10px] text-gray-400">As per Companies Act 2013, Schedule II</p>
      </div>
      <table className="w-full border-collapse text-[11px] mb-4">
        <thead>
          <tr className="bg-blue-800 text-white">
            <th className="border border-blue-700 px-2 py-1.5 text-left" rowSpan={2}>Asset Category</th>
            <th className="border border-blue-700 px-2 py-1 text-center" colSpan={4}>Gross Block (₹)</th>
            <th className="border border-blue-700 px-2 py-1 text-center" colSpan={4}>Depreciation (₹)</th>
            <th className="border border-blue-700 px-2 py-1 text-center" colSpan={2}>Net Block (₹)</th>
            <th className="border border-blue-700 px-2 py-1 text-center" rowSpan={2}>Method</th>
            <th className="border border-blue-700 px-2 py-1 text-center" rowSpan={2}>Rate %</th>
          </tr>
          <tr className="bg-blue-700 text-white text-[10px]">
            {['Opening','Additions','Deductions','Closing','Opening','For Year','On Disposal','Closing','Opening','Closing'].map((h,i) => (
              <th key={i} className="border border-blue-600 px-2 py-1 text-right">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cats.map((r, i) => (
            <tr key={i} className="border-b border-gray-200 hover:bg-gray-50">
              <td className="border border-gray-200 px-2 py-1 font-medium">{r.category}</td>
              {[r.grossOpen, r.additions, r.deductions, r.grossClose,
                r.accumDepOpen, r.depYear, r.depDisposals, r.accumClose,
                r.nbOpen, r.nbClose].map((v, j) => (
                <td key={j} className="border border-gray-200 px-2 py-1 text-right font-mono">{fmtINR(num(v))}</td>
              ))}
              <td className="border border-gray-200 px-2 py-1 text-center">{r.method}</td>
              <td className="border border-gray-200 px-2 py-1 text-right">{r.rateDisplay}%</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-blue-800 text-white font-bold text-[11px]">
            <td className="border border-blue-700 px-2 py-1.5">TOTAL</td>
            {['grossOpen','additions','deductions','grossClose','accumDepOpen','depYear','depDisposals','accumClose','nbOpen','nbClose'].map((f,i) => (
              <td key={i} className="border border-blue-700 px-2 py-1 text-right font-mono">{fmtINR(sum(f))}</td>
            ))}
            <td colSpan={2} className="border border-blue-700" />
          </tr>
        </tfoot>
      </table>
      <p className="text-[10px] text-gray-400">
        Depreciation computed as per Schedule II, Companies Act 2013 (5% residual).
        WDV rate = 1 − (0.05)^(1/Life) × 100; SLM rate = 95% ÷ Life.
      </p>
    </div>
  )
}

// ── Reconciliation Tab ─────────────────────────────────────────────────────────
function ReconciliationTab({ rows, yearEnd, tbId }) {
  const [ledgers, setLedgers]   = useState([])
  const [filter, setFilter]     = useState('')
  const [loading, setLoading]   = useState(false)

  useEffect(() => {
    if (!tbId) return
    setLoading(true)
    window.api?.depGetMappedLedgers(tbId)
      .then(data => setLedgers(data || []))
      .catch(() => setLedgers([]))
      .finally(() => setLoading(false))
  }, [tbId])

  const cats = useMemo(() => aggregateByCategory(rows, yearEnd), [rows, yearEnd])
  const totalNetWDV = cats.reduce((s, r) => s + r.nbClose, 0)

  // Filter to PPE-relevant ledgers
  const ppeKeywords = ['tangible', 'property', 'plant', 'equipment', 'fixed asset', 'ppe', 'furniture', 'vehicle', 'machinery', 'building', 'computer']
  const filtered = ledgers.filter(l => {
    const m3 = (l.m3_name || '').toLowerCase()
    const m2 = (l.m2_name || '').toLowerCase()
    const m1 = (l.m1_name || '').toLowerCase()
    const hasKeyword = ppeKeywords.some(k => m3.includes(k) || m2.includes(k) || m1.includes(k))
    const matchesFilter = !filter || m3.includes(filter.toLowerCase()) || (l.ledger_name || '').toLowerCase().includes(filter.toLowerCase())
    return hasKeyword && matchesFilter
  })

  // Mapped TB balance for assets stored as negative in DB, is_deemed_positive=true → display as positive
  const getDisplayBalance = l => {
    const bal = parseFloat(l.balance) || 0
    return l.is_deemed_positive ? -bal : bal
  }

  const totalMappedTB = filtered.reduce((s, l) => s + getDisplayBalance(l), 0)
  const diff = totalNetWDV - totalMappedTB

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h3 className="text-sm font-bold text-gray-700">PPE Reconciliation — Net WDV vs Mapped TB</h3>
        <input
          className="border border-gray-300 rounded px-2 py-1 text-xs w-52"
          placeholder="Filter by ledger name or M3 category..."
          value={filter} onChange={e => setFilter(e.target.value)}
        />
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Net WDV (Dep Schedule)', value: totalNetWDV, cls: 'bg-orange-50 border-orange-200' },
          { label: 'Mapped TB — PPE Ledgers', value: totalMappedTB, cls: 'bg-blue-50 border-blue-200' },
          { label: 'Difference', value: diff, cls: Math.abs(diff) < 1 ? 'bg-green-50 border-green-300' : 'bg-red-50 border-red-300' },
        ].map((c, i) => (
          <div key={i} className={`border rounded-lg p-3 ${c.cls}`}>
            <p className="text-[10px] text-gray-500 uppercase font-semibold">{c.label}</p>
            <p className={`text-base font-bold font-mono mt-1 ${Math.abs(diff) < 1 && i === 2 ? 'text-green-700' : i === 2 && Math.abs(diff) >= 1 ? 'text-red-700' : 'text-gray-800'}`}>
              {fmtINR(c.value)}
            </p>
          </div>
        ))}
      </div>

      {Math.abs(diff) < 1 && (
        <div className="bg-green-100 border border-green-300 rounded p-2 text-xs text-green-800 font-semibold">
          ✓ Net WDV reconciles with Mapped TB balances (difference &lt; ₹1).
        </div>
      )}
      {Math.abs(diff) >= 1 && (
        <div className="bg-amber-50 border border-amber-300 rounded p-2 text-xs text-amber-800">
          ⚠ Difference of {fmtINR(Math.abs(diff))} — check if all PPE ledgers are captured in the depreciation schedule, or if the M3 filter below misses some categories.
        </div>
      )}

      {/* Dep Schedule by category */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <h4 className="text-xs font-semibold text-gray-600 mb-1">From Depreciation Schedule (Net WDV)</h4>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-orange-600 text-white text-[10px]">
                <th className="px-2 py-1 text-left border border-orange-500">Category</th>
                <th className="px-2 py-1 text-right border border-orange-500">Net WDV</th>
              </tr>
            </thead>
            <tbody>
              {cats.map((r, i) => (
                <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-orange-50/40'}>
                  <td className="px-2 py-0.5 border border-gray-200">{r.category}</td>
                  <td className="px-2 py-0.5 text-right font-mono border border-gray-200">{fmtINR(r.nbClose)}</td>
                </tr>
              ))}
              <tr className="bg-orange-700 text-white font-bold text-[10px]">
                <td className="px-2 py-1 border border-orange-600">TOTAL</td>
                <td className="px-2 py-1 text-right font-mono border border-orange-600">{fmtINR(totalNetWDV)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div>
          <h4 className="text-xs font-semibold text-gray-600 mb-1">From Mapped TB (PPE Ledgers)</h4>
          {loading ? (
            <p className="text-xs text-gray-400 italic">Loading mapped ledgers...</p>
          ) : (
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-blue-700 text-white text-[10px]">
                  <th className="px-2 py-1 text-left border border-blue-600">Ledger</th>
                  <th className="px-2 py-1 text-left border border-blue-600">M3</th>
                  <th className="px-2 py-1 text-right border border-blue-600">Balance</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={3} className="px-2 py-3 text-center text-gray-400 italic border border-gray-200">
                    No PPE ledgers found in Mapped TB. Check mapping or adjust filter.
                  </td></tr>
                )}
                {filtered.map((l, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-blue-50/40'}>
                    <td className="px-2 py-0.5 border border-gray-200">{l.ledger_name}</td>
                    <td className="px-2 py-0.5 border border-gray-200 text-[10px] text-gray-500">{l.m3_name}</td>
                    <td className="px-2 py-0.5 text-right font-mono border border-gray-200">{fmtINR(getDisplayBalance(l))}</td>
                  </tr>
                ))}
                {filtered.length > 0 && (
                  <tr className="bg-blue-700 text-white font-bold text-[10px]">
                    <td colSpan={2} className="px-2 py-1 border border-blue-600">TOTAL</td>
                    <td className="px-2 py-1 text-right font-mono border border-blue-600">{fmtINR(totalMappedTB)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

// ── IT Act Block-wise WDV Tab ──────────────────────────────────────────────────
function ITActTab({ rows, yearEnd, itState, setItState }) {
  const updateBlock = (id, field, val) => {
    setItState(prev => ({
      ...prev,
      blocks: prev.blocks.map(b => b.id === id ? { ...b, [field]: val } : b),
    }))
  }

  // Group addition rows by IT block
  const additionsByBlock = useMemo(() => {
    const map = {}
    for (const row of rows) {
      if (row.rowType !== 'addition') continue
      const blockId = row.itBlock || ''
      if (!blockId) continue
      if (!map[blockId]) map[blockId] = { full: 0, half: 0 }
      const addAmt = num(row.additions)
      if (addAmt <= 0) continue
      if (isMoreThan180Days(row.date, yearEnd)) {
        map[blockId].full += addAmt
      } else {
        map[blockId].half += addAmt
      }
    }
    return map
  }, [rows, yearEnd])

  const computedBlocks = itState.blocks.map(b => {
    const openWDV    = num(b.openWDV)
    const deductions = num(b.deductions)
    const addFull    = additionsByBlock[b.id]?.full || 0
    const addHalf    = additionsByBlock[b.id]?.half || 0
    const totalAdds  = addFull + addHalf
    // IT Dep: full rate on opening + add>180; half rate on add≤180
    const itDep      = Math.max(0,
      (openWDV + addFull) * (b.rate / 100) +
      addHalf * (b.rate / 100) * 0.5
    )
    const closeWDV   = Math.max(0, openWDV + totalAdds - deductions - itDep)
    return { ...b, openWDV, addFull, addHalf, totalAdds, deductions, itDep: +itDep.toFixed(2), closeWDV: +closeWDV.toFixed(2) }
  })

  const totalOpen  = computedBlocks.reduce((s, b) => s + b.openWDV, 0)
  const totalAdds  = computedBlocks.reduce((s, b) => s + b.totalAdds, 0)
  const totalDed   = computedBlocks.reduce((s, b) => s + b.deductions, 0)
  const totalDep   = computedBlocks.reduce((s, b) => s + b.itDep, 0)
  const totalClose = computedBlocks.reduce((s, b) => s + b.closeWDV, 0)

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-bold text-gray-700">Block-wise WDV Statement — Income Tax Act, 1961</h3>
        <span className="text-xs text-gray-400">Section 32 | WDV Method</span>
      </div>
      <div className="bg-blue-50 border border-blue-200 rounded p-2 text-[11px] text-blue-700">
        <strong>Note:</strong> Additions are auto-pulled from the Editor (Addition rows with IT Block assigned).
        Bifurcation: assets put to use &gt; 180 days before year-end get full depreciation; ≤ 180 days get 50%.
        Opening WDV and Deductions must be entered manually.
      </div>

      <div className="overflow-x-auto">
        <table className="border-collapse text-xs w-full" style={{ minWidth: 1000 }}>
          <thead>
            <tr className="bg-blue-800 text-white text-[10px]">
              <th className="border border-blue-700 px-2 py-1.5 text-left" style={{ minWidth: 220 }}>Block of Assets</th>
              <th className="border border-blue-700 px-2 py-1 text-right" style={{ minWidth: 60 }}>Rate %</th>
              <th className="border border-blue-700 px-2 py-1 text-right" style={{ minWidth: 95 }}>Opening WDV</th>
              <th className="border border-blue-700 px-2 py-1 text-right" style={{ minWidth: 90 }}>Add. &gt;180 Days</th>
              <th className="border border-blue-700 px-2 py-1 text-right" style={{ minWidth: 90 }}>Add. ≤180 Days</th>
              <th className="border border-blue-700 px-2 py-1 text-right" style={{ minWidth: 90 }}>Total Additions</th>
              <th className="border border-blue-700 px-2 py-1 text-right" style={{ minWidth: 90 }}>Deductions</th>
              <th className="border border-blue-700 px-2 py-1 text-right" style={{ minWidth: 90 }}>IT Depreciation</th>
              <th className="border border-blue-700 px-2 py-1 text-right" style={{ minWidth: 90 }}>Closing WDV</th>
            </tr>
          </thead>
          <tbody>
            {computedBlocks.map((b, i) => (
              <tr key={b.id} className={i % 2 === 0 ? 'bg-white' : 'bg-blue-50/30'}>
                <td className={TDI}>
                  <span className="text-[10px] text-gray-500 font-mono mr-1">{b.id}</span>
                  {b.name}
                </td>
                <td className={TD + ' text-gray-600'}>{b.rate}%</td>
                {/* Opening WDV — manual */}
                <td className={TDI}>
                  <input className={NINP} type="number" value={b.openWDV || ''}
                    onChange={e => updateBlock(b.id, 'openWDV', e.target.value)}
                    placeholder="Enter manually" />
                </td>
                {/* Additions auto-pulled */}
                <td className={TD + ' bg-green-50 text-green-800'}>{fmtINR(b.addFull)}</td>
                <td className={TD + ' bg-yellow-50 text-yellow-800'}>{fmtINR(b.addHalf)}</td>
                <td className={TD + ' bg-green-50 font-semibold'}>{fmtINR(b.totalAdds)}</td>
                {/* Deductions — manual */}
                <td className={TDI}>
                  <input className={NINP} type="number" value={b.deductions || ''}
                    onChange={e => updateBlock(b.id, 'deductions', e.target.value)}
                    placeholder="0" />
                </td>
                {/* Computed */}
                <td className={TD + ' bg-red-50 font-semibold text-red-800'}>{fmtINR(b.itDep)}</td>
                <td className={TD + ' bg-orange-50 font-semibold text-orange-900'}>{fmtINR(b.closeWDV)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-blue-800 text-white font-bold text-xs">
              <td colSpan={2} className="border border-blue-700 px-2 py-1.5">TOTAL</td>
              <td className="border border-blue-700 px-2 py-1 text-right font-mono">{fmtINR(totalOpen)}</td>
              <td className="border border-blue-700 px-2 py-1 text-right font-mono">{fmtINR(computedBlocks.reduce((s,b)=>s+b.addFull,0))}</td>
              <td className="border border-blue-700 px-2 py-1 text-right font-mono">{fmtINR(computedBlocks.reduce((s,b)=>s+b.addHalf,0))}</td>
              <td className="border border-blue-700 px-2 py-1 text-right font-mono">{fmtINR(totalAdds)}</td>
              <td className="border border-blue-700 px-2 py-1 text-right font-mono">{fmtINR(totalDed)}</td>
              <td className="border border-blue-700 px-2 py-1 text-right font-mono">{fmtINR(totalDep)}</td>
              <td className="border border-blue-700 px-2 py-1 text-right font-mono">{fmtINR(totalClose)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Unassigned additions warning */}
      {(() => {
        const unassigned = rows.filter(r => r.rowType === 'addition' && !r.itBlock && num(r.additions) > 0)
        if (!unassigned.length) return null
        return (
          <div className="bg-amber-50 border border-amber-300 rounded p-2 text-xs text-amber-800">
            ⚠ {unassigned.length} addition row(s) have no IT Block assigned — they are excluded from this statement.
            Assign an IT Block in the Editor to include them.
          </div>
        )
      })()}
    </div>
  )
}

// ── DTL/DTA Tab ───────────────────────────────────────────────────────────────
function DTLDTATab({ rows, yearEnd, itState, setItState }) {
  const cats   = useMemo(() => aggregateByCategory(rows, yearEnd), [rows, yearEnd])

  const additionsByBlock = useMemo(() => {
    const map = {}
    for (const row of rows) {
      if (row.rowType !== 'addition') continue
      const blockId = row.itBlock || ''
      if (!blockId) continue
      if (!map[blockId]) map[blockId] = { full: 0, half: 0 }
      const addAmt = num(row.additions)
      if (addAmt <= 0) continue
      isMoreThan180Days(row.date, yearEnd) ? (map[blockId].full += addAmt) : (map[blockId].half += addAmt)
    }
    return map
  }, [rows, yearEnd])

  // Compute IT WDV per block (same as IT Act tab)
  const itBlocks = itState.blocks.map(b => {
    const openWDV  = num(b.openWDV)
    const deduc    = num(b.deductions)
    const addFull  = additionsByBlock[b.id]?.full || 0
    const addHalf  = additionsByBlock[b.id]?.half || 0
    const itDep    = Math.max(0, (openWDV + addFull) * (b.rate / 100) + addHalf * (b.rate / 100) * 0.5)
    const closeWDV = Math.max(0, openWDV + addFull + addHalf - deduc - itDep)
    return { ...b, closeWDV, itDep }
  })

  // CA WDV per IT block (sum categories mapped to that block via itBlock field on rows)
  const caWDVByBlock = useMemo(() => {
    const map = {}
    for (const row of rows) {
      if (!row.itBlock) continue
      const c = computeRow(row, yearEnd)
      map[row.itBlock] = (map[row.itBlock] || 0) + c.nbClose
    }
    return map
  }, [rows, yearEnd])

  const taxRate = parseFloat(itState.taxRate) || 25.168

  const dtlRows = itBlocks.map(b => {
    const caWDV       = caWDVByBlock[b.id] || 0
    const itWDV       = b.closeWDV
    const timingDiff  = itWDV - caWDV     // IT WDV > CA WDV → DTL; < → DTA
    const amount      = timingDiff * (taxRate / 100)
    const type        = Math.abs(timingDiff) < 1 ? 'Nil' : (timingDiff > 0 ? 'DTL' : 'DTA')
    return { ...b, caWDV, itWDV, timingDiff, amount, type }
  }).filter(b => b.caWDV !== 0 || b.itWDV !== 0)

  const totalDTL = dtlRows.filter(r => r.type === 'DTL').reduce((s, r) => s + r.amount, 0)
  const totalDTA = dtlRows.filter(r => r.type === 'DTA').reduce((s, r) => s + Math.abs(r.amount), 0)
  const net      = totalDTL - totalDTA

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-bold text-gray-700">Deferred Tax — Depreciation (IND AS 12)</h3>
        <div className="flex items-center gap-1.5 ml-auto">
          <label className="text-xs text-gray-500">Effective Tax Rate (%):</label>
          <input className="border border-gray-300 rounded px-2 py-1 text-xs w-20 text-right font-mono"
            type="number" step="0.001" value={itState.taxRate}
            onChange={e => setItState(prev => ({ ...prev, taxRate: e.target.value }))} />
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded p-2 text-[11px] text-blue-700">
        <strong>IND AS 12 approach:</strong> IT WDV &gt; CA WDV → taxable temporary difference → <strong>DTL</strong>.
        IT WDV &lt; CA WDV → deductible temporary difference → <strong>DTA</strong>.
        (CA WDV = Net Block as per Companies Act; IT WDV = WDV as per IT Act from the IT Act tab.)
      </div>

      {dtlRows.length === 0 ? (
        <div className="text-xs text-gray-400 italic p-4 text-center">
          Assign IT Blocks to rows in the Editor and enter Opening WDV in the IT Act tab to see DTL/DTA.
        </div>
      ) : (
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-purple-800 text-white text-[10px]">
              <th className="border border-purple-700 px-2 py-1.5 text-left" style={{ minWidth: 220 }}>Block of Assets</th>
              <th className="border border-purple-700 px-2 py-1 text-right" style={{ minWidth: 90 }}>CA Net WDV</th>
              <th className="border border-purple-700 px-2 py-1 text-right" style={{ minWidth: 90 }}>IT WDV</th>
              <th className="border border-purple-700 px-2 py-1 text-right" style={{ minWidth: 100 }}>Timing Difference</th>
              <th className="border border-purple-700 px-2 py-1 text-center" style={{ minWidth: 60 }}>Type</th>
              <th className="border border-purple-700 px-2 py-1 text-right" style={{ minWidth: 100 }}>DTL / DTA Amount</th>
            </tr>
          </thead>
          <tbody>
            {dtlRows.map((r, i) => (
              <tr key={r.id} className={i % 2 === 0 ? 'bg-white' : 'bg-purple-50/30'}>
                <td className="border border-gray-200 px-2 py-1">
                  <span className="text-[10px] font-mono text-gray-400 mr-1">{r.id}</span>{r.name}
                </td>
                <td className="border border-gray-200 px-2 py-1 text-right font-mono">{fmtINR(r.caWDV)}</td>
                <td className="border border-gray-200 px-2 py-1 text-right font-mono">{fmtINR(r.itWDV)}</td>
                <td className={`border border-gray-200 px-2 py-1 text-right font-mono ${r.timingDiff > 1 ? 'text-red-700' : r.timingDiff < -1 ? 'text-green-700' : 'text-gray-400'}`}>
                  {fmtINR(r.timingDiff)}
                </td>
                <td className="border border-gray-200 px-2 py-1 text-center">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${r.type === 'DTL' ? 'bg-red-100 text-red-700' : r.type === 'DTA' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
                    {r.type}
                  </span>
                </td>
                <td className={`border border-gray-200 px-2 py-1 text-right font-mono font-semibold ${r.type === 'DTL' ? 'text-red-700' : r.type === 'DTA' ? 'text-green-700' : 'text-gray-400'}`}>
                  {r.type === 'Nil' ? '—' : fmtINR(Math.abs(r.amount))}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-purple-800 text-white font-bold text-xs">
              <td colSpan={5} className="border border-purple-700 px-2 py-1.5 text-right">Net DTL / (DTA):</td>
              <td className={`border border-purple-700 px-2 py-1 text-right font-mono text-base ${net >= 0 ? 'text-red-200' : 'text-green-200'}`}>
                {net >= 0 ? 'DTL ' : 'DTA '}{fmtINR(Math.abs(net))}
              </td>
            </tr>
          </tfoot>
        </table>
      )}

      {/* Summary */}
      {dtlRows.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Deferred Tax Liability (DTL)', value: totalDTL, cls: 'bg-red-50 border-red-200 text-red-800' },
            { label: 'Deferred Tax Asset (DTA)',     value: totalDTA, cls: 'bg-green-50 border-green-200 text-green-800' },
            { label: `Net ${net >= 0 ? 'DTL' : 'DTA'}`, value: Math.abs(net), cls: 'bg-purple-50 border-purple-200 text-purple-800' },
          ].map((c, i) => (
            <div key={i} className={`border rounded-lg p-3 ${c.cls}`}>
              <p className="text-[10px] uppercase font-semibold opacity-70">{c.label}</p>
              <p className="text-base font-bold font-mono mt-1">{fmtINR(c.value)}</p>
            </div>
          ))}
        </div>
      )}

      <p className="text-[10px] text-gray-400">
        Tax rate used: {taxRate}% | DTL = Deferred Tax Liability | DTA = Deferred Tax Asset.
        Opening DTL/DTA balances not included — add manually for movement analysis.
      </p>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function Depreciation({ entity, activeTB }) {
  const [rows, setRows]         = useState([])
  const [scheduleII, setScheduleII] = useState([])
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [activeTab, setActiveTab] = useState('editor')
  const [toast, setToast]       = useState('')
  const [itState, setItState]   = useState({
    blocks: IT_BLOCKS.map(b => ({ ...b, openWDV: '', deductions: '' })),
    taxRate: '25.168',
  })

  const tbId  = activeTB?.id
  const period = activeTB?.period || ''
  const yearEnd = useMemo(() => parseYearEnd(period), [period])

  const showToast = msg => { setToast(msg); setTimeout(() => setToast(''), 3500) }

  useEffect(() => {
    window.api?.depScheduleII().then(s => setScheduleII(s || []))
    if (!tbId) { setLoading(false); return }
    setLoading(true)
    window.api?.depGet(tbId).then(saved => {
      if (saved?.rows?.length) setRows(migrateRows(saved.rows))
      if (saved?.itBlocks) {
        setItState(prev => ({
          ...prev,
          taxRate: saved.taxRate || prev.taxRate,
          blocks: prev.blocks.map(b => ({ ...b, ...(saved.itBlocks[b.id] || {}) })),
        }))
      }
    }).catch(() => {}).finally(() => setLoading(false))
  }, [tbId])

  const updateRow = useCallback((idx, updated) => setRows(rs => rs.map((r, i) => i === idx ? updated : r)), [])
  const deleteRow = useCallback(idx => setRows(rs => rs.filter((_, i) => i !== idx)), [])
  const addRow    = type => setRows(rs => [...rs, emptyRow(type)])

  const save = async () => {
    if (!tbId) return showToast('Load a Trial Balance first.')
    setSaving(true)
    // Serialise itBlocks as { [id]: { openWDV, deductions } }
    const itBlocks = {}
    itState.blocks.forEach(b => { itBlocks[b.id] = { openWDV: b.openWDV, deductions: b.deductions } })
    try {
      await window.api?.depSave({ tbId, data: { rows, itBlocks, taxRate: itState.taxRate } })
      showToast('Saved successfully.')
    } catch (e) {
      showToast('Save failed: ' + (e?.message || 'unknown error'))
    } finally { setSaving(false) }
  }

  const downloadTemplate = async () => {
    try {
      const buf = await window.api?.depDownloadTemplate()
      const result = await window.api?.saveFileDialog({
        title: 'Save Depreciation Template',
        defaultPath: 'FSG_Bharat_Depreciation_Template.xlsx',
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      })
      if (result?.filePath) {
        await window.api?.writeFile(result.filePath, Array.from(new Uint8Array(buf)))
        showToast('Template saved.')
      }
    } catch (e) { showToast('Download failed: ' + (e?.message || '')) }
  }

  const uploadExcel = async () => {
    try {
      const filePaths = await window.api?.openFileDialog({
        title: 'Select Depreciation Excel',
        filters: [{ name: 'Excel', extensions: ['xlsx', 'xls'] }],
        properties: ['openFile'],
      })
      const filePath = Array.isArray(filePaths) ? filePaths[0] : filePaths
      if (!filePath) return
      const result = await window.api?.depParseExcel(filePath)
      if (result?.length) {
        setRows(result)
        showToast(`Loaded ${result.length} row(s) from Excel.`)
      } else {
        showToast('No data found in Excel file.')
      }
    } catch (e) { showToast('Upload failed: ' + (e?.message || '')) }
  }

  const computed   = useMemo(() => rows.map(r => computeRow(r, yearEnd)), [rows, yearEnd])
  const totalDepYear = computed.reduce((s, r) => s + r.depYear, 0)
  const totalNetWDV  = computed.reduce((s, r) => s + r.nbClose, 0)

  const TABS = [
    { id: 'editor',    label: 'Editor' },
    { id: 'schedule',  label: 'Fixed Assets Schedule' },
    { id: 'recon',     label: 'Reconciliation' },
    { id: 'it-act',    label: 'IT Act WDV' },
    { id: 'dtl-dta',   label: 'DTL / DTA' },
  ]

  if (!activeTB) return (
    <div className="flex items-center justify-center h-full text-gray-400 text-sm">
      Load a Trial Balance in the Actual TB tab first.
    </div>
  )

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-5 py-2 border-b border-blue-100 bg-gray-50 shrink-0 flex-wrap">
        <span className="text-xs text-gray-500 font-medium">Depreciation Calculator</span>
        <span className="text-xs text-gray-400">| Companies Act 2013 Schedule II + IT Act 1961</span>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <button onClick={downloadTemplate}
            className="px-3 py-1.5 text-xs border border-gray-300 rounded text-gray-600 hover:bg-gray-100 transition">
            ↓ Excel Template
          </button>
          <button onClick={uploadExcel}
            className="px-3 py-1.5 text-xs border border-blue-300 rounded text-blue-700 hover:bg-blue-50 transition">
            ↑ Upload Excel
          </button>
          <button onClick={save} disabled={saving}
            className="px-3 py-1.5 text-xs text-white rounded font-medium disabled:opacity-40 transition"
            style={{ background: 'var(--color-primary)' }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Summary strip */}
      <div className="flex items-center gap-6 px-5 py-1.5 bg-white border-b border-gray-100 shrink-0 text-xs text-gray-500">
        <span><span className="font-semibold text-gray-800">{rows.length}</span> row{rows.length !== 1 ? 's' : ''}</span>
        <span>Dep for Year: <span className="font-bold text-green-700 font-mono">{fmtINR(totalDepYear)}</span></span>
        <span>Net WDV (Closing): <span className="font-bold text-orange-700 font-mono">{fmtINR(totalNetWDV)}</span></span>
        {period && <span className="text-gray-400">Period: {period}</span>}
      </div>

      {/* Tab strip */}
      <div className="flex border-b border-gray-200 bg-white shrink-0 px-4">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2 text-xs font-medium border-b-2 transition -mb-px ${activeTab === t.id ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* datalist for schedule II */}

      {/* Content */}
      <div className="flex-1 overflow-auto bg-white">
        {loading && <div className="p-8 text-gray-400 text-sm text-center">Loading...</div>}

        {/* ── EDITOR ── */}
        {!loading && activeTab === 'editor' && (
          <div className="p-4">
            <div className="overflow-x-auto">
              <table className="border-collapse text-xs" style={{ minWidth: 1600 }}>
                <thead>
                  <tr>
                    <th className={THL} rowSpan={2} style={{ minWidth: 115 }}>Date</th>
                    <th className={THL} rowSpan={2} style={{ minWidth: 68 }}>Type</th>
                    <th className={THL} rowSpan={2} style={{ minWidth: 140 }}>Ledger Name</th>
                    <th className={THL} rowSpan={2} style={{ minWidth: 190 }}>Asset Category</th>
                    <th className={TH}  rowSpan={2} style={{ minWidth: 60 }}>Method</th>
                    <th className={TH}  rowSpan={2} style={{ minWidth: 55 }}>Life</th>
                    <th className={TH}  rowSpan={2} style={{ minWidth: 60 }}>Rate %</th>
                    <th className={THL} rowSpan={2} style={{ minWidth: 110 }}>IT Block</th>
                    <th className={TH} colSpan={3} style={{ background: '#dbeafe' }}>Gross Block (₹)</th>
                    <th className={TH} colSpan={2} style={{ background: '#dbeafe' }}>Disposals</th>
                    <th className={TH} colSpan={5} style={{ background: '#dcfce7' }}>Depreciation (₹)</th>
                    <th className={TH} rowSpan={2}></th>
                  </tr>
                  <tr>
                    {[
                      ['Gross Opening','#dbeafe',95],['Accum Dep Open','#dbeafe',95],['Additions','#dbeafe',95],
                      ['Deductions','#dbeafe',90],['Dep on Disp.','#dbeafe',90],
                      ['Gross Close ▶','#bfdbfe',90],['Dep for Year ▶','#bbf7d0',90],
                      ['Accum Close ▶','#bfdbfe',90],['NB Opening ▶','#ffedd5',90],['NB Closing ▶','#fed7aa',90],
                    ].map(([h, bg, w], i) => (
                      <th key={i} className={TH} style={{ background: bg, minWidth: w }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={20} className="py-8 text-center text-gray-400 italic border border-gray-200">
                        No rows yet. Click "+ Opening Row" or "+ Addition Row" below.
                      </td>
                    </tr>
                  )}
                  {rows.map((row, idx) => (
                    <AssetRow key={row.id} row={row} scheduleII={scheduleII} yearEnd={yearEnd}
                      onChange={updated => updateRow(idx, updated)}
                      onDelete={() => deleteRow(idx)} />
                  ))}
                </tbody>
                {rows.length > 0 && <tfoot><TotalsRow rows={rows} yearEnd={yearEnd} /></tfoot>}
              </table>
            </div>

            <div className="flex items-center justify-between mt-3 flex-wrap gap-2">
              <div className="flex gap-2">
                <button onClick={() => addRow('opening')}
                  className="px-3 py-1.5 text-xs border border-blue-400 text-blue-700 rounded hover:bg-blue-50 transition">
                  + Opening Row
                </button>
                <button onClick={() => addRow('addition')}
                  className="px-3 py-1.5 text-xs border border-green-400 text-green-700 rounded hover:bg-green-50 transition">
                  + Addition Row
                </button>
              </div>
              <p className="text-[10px] text-gray-400">
                Type is auto-detected: fill Opening Balance → locks Additions; fill Additions → locks Opening Balance.
                Date optional for Opening, mandatory for Addition. ▶ = computed. Assign IT Block for IT Act WDV &amp; DTL/DTA.
              </p>
            </div>

            {/* Schedule II reference */}
            {scheduleII.length > 0 && (
              <details className="mt-5 border border-gray-200 rounded-lg overflow-hidden">
                <summary className="bg-gray-50 px-4 py-2 text-xs font-semibold text-gray-700 cursor-pointer hover:bg-gray-100">
                  Schedule II — Useful Life Reference (Companies Act 2013)
                </summary>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="bg-blue-700 text-white text-[10px]">
                        {['Asset Category','Life (Yrs)','SLM Rate (%)','WDV Rate (%)'].map((h,i) => (
                          <th key={i} className={`px-3 py-1.5 border border-blue-600 ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {scheduleII.map((s, i) => (
                        <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                          <td className="px-3 py-1 border border-gray-200">{s.category}</td>
                          <td className="px-3 py-1 text-right border border-gray-200 font-mono">{s.life}</td>
                          <td className="px-3 py-1 text-right border border-gray-200 font-mono">{s.slmRate.toFixed(2)}%</td>
                          <td className="px-3 py-1 text-right border border-gray-200 font-mono">{s.wdvRate.toFixed(2)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </div>
        )}

        {/* ── SCHEDULE ── */}
        {!loading && activeTab === 'schedule' && (
          <ScheduleView rows={rows} entity={entity} period={period} yearEnd={yearEnd} />
        )}

        {/* ── RECONCILIATION ── */}
        {!loading && activeTab === 'recon' && (
          <ReconciliationTab rows={rows} yearEnd={yearEnd} tbId={tbId} />
        )}

        {/* ── IT ACT WDV ── */}
        {!loading && activeTab === 'it-act' && (
          <ITActTab rows={rows} yearEnd={yearEnd} itState={itState} setItState={setItState} />
        )}

        {/* ── DTL/DTA ── */}
        {!loading && activeTab === 'dtl-dta' && (
          <DTLDTATab rows={rows} yearEnd={yearEnd} itState={itState} setItState={setItState} />
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 px-4 py-2 rounded shadow-lg bg-blue-700 text-white text-xs font-medium z-50">
          {toast}
        </div>
      )}
    </div>
  )
}
