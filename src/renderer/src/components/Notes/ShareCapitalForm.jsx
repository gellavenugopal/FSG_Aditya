import React, { useState, useEffect, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { SC_DISCLOSURES, disclosureTexts, defaultDisclosureText } from '../../utils/shareCapitalDisclosures'

const INP = 'w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white'
const NUM = INP + ' text-right font-mono'
const LABEL = 'block text-[10px] text-gray-500 mb-0.5 font-medium'

// Money: always 2 decimals ("34.00", not "34"). Shares: a count, never
// fractional — no decimals, ever ("1,00,000", not "1,00,000.00").
function fmtN(n) { return n != null && n !== '' && !isNaN(n) ? Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '' }
function fmtShares(n) { return n != null && n !== '' && !isNaN(n) ? Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '' }
function num(v) { return parseFloat(v) || 0 }

// ── Empty share class template ────────────────────────────────────────────────
function emptyClass(name = '', type = 'Equity') {
  return {
    name, type,
    faceValue: 10,
    cy: { authorised: '', issued: '', subscribed: '', paidUp: '', openingShares: '', issuedDuringYear: '', deletedDuringYear: '' },
    py: { authorised: '', issued: '', subscribed: '', paidUp: '', openingShares: '', issuedDuringYear: '', deletedDuringYear: '' },
  }
}

// ── Single share class editor ─────────────────────────────────────────────────
function ClassEditor({ cls, onChange, onRemove, bsAmount, idx }) {
  const set = (period, field, val) => onChange({ ...cls, [period]: { ...cls[period], [field]: val } })
  const setTop = (field, val) => onChange({ ...cls, [field]: val })

  // When Issued changes, auto-cascade the same value to Subscribed and Paid-up (all remain editable)
  const setIssued = (period, val) => onChange({
    ...cls,
    [period]: { ...cls[period], issued: val, subscribed: val, paidUp: val }
  })

  const cyClosing = num(cls.cy.openingShares) + num(cls.cy.issuedDuringYear) - num(cls.cy.deletedDuringYear)
  const pyClosing = num(cls.py.openingShares) + num(cls.py.issuedDuringYear) - num(cls.py.deletedDuringYear)
  const cyAmount = cyClosing * num(cls.faceValue)
  const pyAmount = pyClosing * num(cls.faceValue)

  const isMismatch = bsAmount != null && Math.abs(cyAmount - bsAmount) > 1

  return (
    <div className="border border-gray-200 rounded-lg p-3 mb-4 bg-white">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-blue-800">Class {idx + 1}</span>
          {isMismatch && (
            <span className="text-[10px] bg-red-100 text-red-700 border border-red-300 rounded px-1.5 py-0.5">
              ⚠ CY Amount ₹{fmtN(cyAmount)} ≠ BS ₹{fmtN(bsAmount)}
            </span>
          )}
          {!isMismatch && bsAmount != null && (
            <span className="text-[10px] bg-green-100 text-green-700 border border-green-300 rounded px-1.5 py-0.5">✓ Tallies with BS</span>
          )}
        </div>
        <button onClick={onRemove} className="text-red-400 hover:text-red-600 text-xs">✕ Remove</button>
      </div>

      {/* Class name + type + face value */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div>
          <label className={LABEL}>Class Name *</label>
          <input className={INP} value={cls.name} onChange={e => setTop('name', e.target.value)} placeholder="e.g. Equity Shares" />
        </div>
        <div>
          <label className={LABEL}>Type</label>
          <select className={INP} value={cls.type} onChange={e => setTop('type', e.target.value)}>
            <option>Equity</option>
            <option>Preference</option>
          </select>
        </div>
        <div>
          <label className={LABEL}>Face Value (₹) *</label>
          <input className={NUM} type="number" value={cls.faceValue} onChange={e => setTop('faceValue', e.target.value)} placeholder="10" />
        </div>
      </div>

      {/* Authorised / Issued / Subscribed / Paid-up — No. of Shares */}
      <div className="overflow-x-auto mb-3">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-gray-50">
              <th className="text-left px-2 py-1 border border-gray-200 w-[40%]">Particulars</th>
              <th className="text-right px-2 py-1 border border-gray-200">CY — No. of Shares</th>
              <th className="text-right px-2 py-1 border border-gray-200">CY — Amount (₹)</th>
              <th className="text-right px-2 py-1 border border-gray-200">PY — No. of Shares</th>
              <th className="text-right px-2 py-1 border border-gray-200">PY — Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['Authorised', 'authorised'],
              ['Issued', 'issued'],
              ['Subscribed', 'subscribed'],
              ['Subscribed & Fully Paid-up', 'paidUp'],
            ].map(([label, field]) => (
              <tr key={field}>
                <td className="px-2 py-1 border border-gray-200">
                  {label}
                  {field === 'issued' && (
                    <span className="ml-1 text-[9px] text-blue-400 italic">(auto-fills Subscribed & Paid-up)</span>
                  )}
                </td>
                <td className="px-1 py-0.5 border border-gray-200">
                  <input
                    className={NUM} type="number" value={cls.cy[field]}
                    onChange={e => field === 'issued' ? setIssued('cy', e.target.value) : set('cy', field, e.target.value)}
                  />
                </td>
                <td className="px-2 py-1 border border-gray-200 text-right font-mono text-gray-600 text-[11px]">
                  {num(cls.cy[field]) && num(cls.faceValue) ? fmtN(num(cls.cy[field]) * num(cls.faceValue)) : ''}
                </td>
                <td className="px-1 py-0.5 border border-gray-200">
                  <input
                    className={NUM} type="number" value={cls.py[field]}
                    onChange={e => field === 'issued' ? setIssued('py', e.target.value) : set('py', field, e.target.value)}
                  />
                </td>
                <td className="px-2 py-1 border border-gray-200 text-right font-mono text-gray-600 text-[11px]">
                  {num(cls.py[field]) && num(cls.faceValue) ? fmtN(num(cls.py[field]) * num(cls.faceValue)) : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Reconciliation */}
      <div className="text-[10px] font-semibold text-gray-600 mb-1 uppercase tracking-wide">Reconciliation of No. of Shares</div>
      <div className="overflow-x-auto mb-3">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-gray-50">
              <th className="text-left px-2 py-1 border border-gray-200 w-[40%]">Movement</th>
              <th className="text-right px-2 py-1 border border-gray-200">CY Shares</th>
              <th className="text-right px-2 py-1 border border-gray-200">CY Amount (₹)</th>
              <th className="text-right px-2 py-1 border border-gray-200">PY Shares</th>
              <th className="text-right px-2 py-1 border border-gray-200">PY Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['Opening Balance', 'openingShares'],
              ['Issued during the year', 'issuedDuringYear'],
              ['Deleted / Bought back', 'deletedDuringYear'],
            ].map(([label, field]) => (
              <tr key={field}>
                <td className="px-2 py-1 border border-gray-200">
                  {label}
                  {field === 'issuedDuringYear' && (
                    <span className="ml-1 text-[9px] text-red-500 italic">
                      (new shares issued THIS year only — not the cumulative/total shares issued)
                    </span>
                  )}
                </td>
                <td className="px-1 py-0.5 border border-gray-200">
                  <input className={NUM} type="number" value={cls.cy[field]} onChange={e => set('cy', field, e.target.value)} />
                </td>
                <td className="px-2 py-1 border border-gray-200 text-right font-mono text-[11px] text-gray-600">
                  {num(cls.cy[field]) && num(cls.faceValue) ? fmtN(num(cls.cy[field]) * num(cls.faceValue)) : ''}
                </td>
                <td className="px-1 py-0.5 border border-gray-200">
                  <input className={NUM} type="number" value={cls.py[field]} onChange={e => set('py', field, e.target.value)} />
                </td>
                <td className="px-2 py-1 border border-gray-200 text-right font-mono text-[11px] text-gray-600">
                  {num(cls.py[field]) && num(cls.faceValue) ? fmtN(num(cls.py[field]) * num(cls.faceValue)) : ''}
                </td>
              </tr>
            ))}
            <tr className="bg-blue-50 font-semibold">
              <td className="px-2 py-1 border border-gray-200">Closing Balance (auto)</td>
              <td className="px-2 py-1 border border-gray-200 text-right font-mono">{fmtShares(cyClosing)}</td>
              <td className="px-2 py-1 border border-gray-200 text-right font-mono text-[11px]">{fmtN(cyAmount)}</td>
              <td className="px-2 py-1 border border-gray-200 text-right font-mono">{fmtShares(pyClosing)}</td>
              <td className="px-2 py-1 border border-gray-200 text-right font-mono text-[11px]">{fmtN(pyAmount)}</td>
            </tr>
          </tbody>
        </table>
      </div>

    </div>
  )
}

// ── 5% Shareholders table ─────────────────────────────────────────────────────
function ShareholderTable({ title, rows, onChange }) {
  const setRow = (i, field, val) => {
    const next = rows.map((r, ri) => ri === i ? { ...r, [field]: val } : r)
    onChange(next)
  }
  const addRow = () => onChange([...rows, { name: '', cyShares: '', cyPct: '', pyShares: '', pyPct: '' }])
  const removeRow = (i) => onChange(rows.filter((_, ri) => ri !== i))

  return (
    <div className="mb-4">
      <div className="text-xs font-semibold text-gray-700 mb-1">{title}</div>
      <table className="w-full text-xs border-collapse mb-1">
        <thead>
          <tr className="bg-gray-50">
            <th className="text-left px-2 py-1 border border-gray-200 w-[30%]">Name of Shareholder</th>
            <th className="text-right px-2 py-1 border border-gray-200">CY — No. of Shares</th>
            <th className="text-right px-2 py-1 border border-gray-200">CY — % Holding</th>
            <th className="text-right px-2 py-1 border border-gray-200">PY — No. of Shares</th>
            <th className="text-right px-2 py-1 border border-gray-200">PY — % Holding</th>
            <th className="px-1 border border-gray-200 w-6"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="px-1 py-0.5 border border-gray-200"><input className={INP} value={r.name} onChange={e => setRow(i, 'name', e.target.value)} placeholder="Name" /></td>
              <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={r.cyShares} onChange={e => setRow(i, 'cyShares', e.target.value)} /></td>
              <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={r.cyPct} onChange={e => setRow(i, 'cyPct', e.target.value)} placeholder="%" /></td>
              <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={r.pyShares} onChange={e => setRow(i, 'pyShares', e.target.value)} /></td>
              <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={r.pyPct} onChange={e => setRow(i, 'pyPct', e.target.value)} placeholder="%" /></td>
              <td className="px-1 py-0.5 border border-gray-200 text-center">
                <button onClick={() => removeRow(i)} className="text-red-400 hover:text-red-600 text-[10px]">✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={addRow} className="text-xs text-blue-600 hover:underline">+ Add row</button>
    </div>
  )
}

// ── Promoter table ────────────────────────────────────────────────────────────
function PromoterTable({ rows, onChange }) {
  const setRow = (i, field, val) => onChange(rows.map((r, ri) => ri === i ? { ...r, [field]: val } : r))
  const addRow = () => onChange([...rows, { name: '', class: 'Equity', shares: '', pctTotal: '', pctChange: '' }])
  const removeRow = (i) => onChange(rows.filter((_, ri) => ri !== i))

  return (
    <div className="mb-4">
      <div className="text-xs font-semibold text-gray-700 mb-1">Shares held by Promoters at the end of the year</div>
      <table className="w-full text-xs border-collapse mb-1">
        <thead>
          <tr className="bg-gray-50">
            <th className="text-left px-2 py-1 border border-gray-200 w-[25%]">Name of Promoter</th>
            <th className="text-center px-2 py-1 border border-gray-200">Class</th>
            <th className="text-right px-2 py-1 border border-gray-200">No. of Shares</th>
            <th className="text-right px-2 py-1 border border-gray-200">% of Total</th>
            <th className="text-right px-2 py-1 border border-gray-200">% Change</th>
            <th className="px-1 border border-gray-200 w-6"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="px-1 py-0.5 border border-gray-200"><input className={INP} value={r.name} onChange={e => setRow(i, 'name', e.target.value)} /></td>
              <td className="px-1 py-0.5 border border-gray-200">
                <select className={INP} value={r.class} onChange={e => setRow(i, 'class', e.target.value)}>
                  <option>Equity</option><option>Preference</option>
                </select>
              </td>
              <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={r.shares} onChange={e => setRow(i, 'shares', e.target.value)} /></td>
              <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={r.pctTotal} onChange={e => setRow(i, 'pctTotal', e.target.value)} placeholder="%" /></td>
              <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={r.pctChange} onChange={e => setRow(i, 'pctChange', e.target.value)} placeholder="%" /></td>
              <td className="px-1 py-0.5 border border-gray-200 text-center">
                <button onClick={() => removeRow(i)} className="text-red-400 hover:text-red-600 text-[10px]">✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={addRow} className="text-xs text-blue-600 hover:underline">+ Add row</button>
    </div>
  )
}

// ── Shareholder Excel template download (with dropdown validation) ────────────
function downloadShareholderTemplate() {
  const wb = XLSX.utils.book_new()
  // Data sheet
  const ws = XLSX.utils.aoa_to_sheet([
    ['Sl No', 'Name of Shareholder', 'Folio No (Optional)', 'No. of Shares at Beginning (PY)', 'No. of Shares at End (CY)', 'Category'],
    [1, '', '', '', '', 'Non-Promoter'],
    [2, '', '', '', '', 'Non-Promoter'],
    [3, '', '', '', '', 'Non-Promoter'],
    [4, '', '', '', '', 'Non-Promoter'],
    [5, '', '', '', '', 'Non-Promoter'],
  ])
  ws['!cols'] = [{ wch: 6 }, { wch: 40 }, { wch: 18 }, { wch: 30 }, { wch: 28 }, { wch: 18 }]
  // Add data validation for Category dropdown (rows 2-500, column F = col 6)
  ws['!dataValidation'] = [{
    sqref: 'F2:F500',
    type: 'list',
    formula1: '"Promoter,Non-Promoter"',
    showDropDown: false,
    showErrorMessage: true,
    errorTitle: 'Invalid',
    error: 'Please select Promoter or Non-Promoter',
  }]
  XLSX.utils.book_append_sheet(wb, ws, 'Shareholders')
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'Shareholder_Template.xlsx'; a.click()
}

// ── Import shareholders from Excel ────────────────────────────────────────────
// Rules per item 3: only include shareholders with ≥5% holding in EITHER CY or PY
// Rules per item 5: promoters table only shows Category = "Promoter"
function importShareholdersFromExcel(file, totalSharesCY, totalSharesPY, onImport) {
  const reader = new FileReader()
  reader.onload = (e) => {
    const wb = XLSX.read(e.target.result, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
    const totalCY = parseFloat(totalSharesCY) || 1
    const totalPY = parseFloat(totalSharesPY) || 1

    const all = rows.slice(1).filter(r => r[1]).map(r => {
      const cyShares = parseFloat(r[4]) || 0
      const pyShares = parseFloat(r[3]) || 0
      const cyPct = totalCY ? (cyShares / totalCY) * 100 : 0
      const pyPct = totalPY ? (pyShares / totalPY) * 100 : 0
      return {
        name: String(r[1] || '').trim(),
        folioNo: String(r[2] || '').trim(),
        cyShares,
        cyPct: cyPct.toFixed(2),
        pyShares,
        pyPct: pyPct.toFixed(2),
        category: String(r[5] || 'Non-Promoter').trim(),
        _cyPct: cyPct,
        _pyPct: pyPct,
      }
    })

    // Item 3: 5% list = only ≥5% in CY OR PY
    const fivePct = all.filter(r => r._cyPct >= 5 || r._pyPct >= 5)
    // Item 5: promoters = only Category = "Promoter"
    const promoters = all.filter(r => r.category.toLowerCase() === 'promoter')

    onImport({ fivePct, promoters, all })
  }
  reader.readAsArrayBuffer(file)
}

// ── Main Share Capital Form ───────────────────────────────────────────────────
export default function ShareCapitalForm({ tbId, entityId, useEntityLevel, noteNum, noteTitle, bsShareCapital, onClose, onSaved, isCompany = false }) {
  const [data, setData] = useState({
    classes: [emptyClass('Equity Shares', 'Equity')],
    shareholders5pctEquity: [],
    shareholders5pctPreference: [],
    promoters: [],
    rights: 'The Company has one class of equity shares having a par value of ₹10 per share. Each holder is eligible for one vote per share held.',
    footnotes: Array(10).fill(''),
  })
  const [saving, setSaving] = useState(false)
  const [activeSection, setActiveSection] = useState('classes')

  useEffect(() => {
    if (!noteNum) return
    const fetch = useEntityLevel
      ? window.api?.getEntityNoteDetails(entityId, noteNum, noteTitle)
      : window.api?.getNoteDetails(tbId, noteNum, noteTitle)
    fetch?.then(saved => { if (saved) setData(d => ({ ...d, ...saved })) }).catch(() => {})
  }, [tbId, entityId, noteNum, useEntityLevel])

  // Total CY paid-up amount across all classes
  const totalCYAmount = useMemo(() =>
    data.classes.reduce((s, cls) => {
      const closing = num(cls.cy.openingShares) + num(cls.cy.issuedDuringYear) - num(cls.cy.deletedDuringYear)
      return s + closing * num(cls.faceValue)
    }, 0), [data.classes])

  const bsAmt = bsShareCapital != null ? Math.abs(bsShareCapital) : null
  const tallies = bsAmt != null && Math.abs(totalCYAmount - bsAmt) < 1

  const save = async () => {
    setSaving(true)
    try {
      if (useEntityLevel) {
        await window.api?.saveEntityNoteDetails({ entityId, noteNum, noteTitle, data })
      } else {
        await window.api?.saveNoteDetails({ tbId, noteNum, noteTitle, data })
      }
      onSaved?.()
      onClose()
    } finally { setSaving(false) }
  }

  const setClasses = (cls) => setData(d => ({ ...d, classes: cls }))
  const update5pctEquity = (rows) => setData(d => ({ ...d, shareholders5pctEquity: rows }))
  const update5pctPref = (rows) => setData(d => ({ ...d, shareholders5pctPreference: rows }))
  const updatePromoters = (rows) => setData(d => ({ ...d, promoters: rows }))

  // Company: the single "Rights & Restrictions" box is replaced by the eight
  // disclosures 1(e)-(l) (utils/shareCapitalDisclosures.js).
  const SECTIONS = ['classes', 'shareholders', isCompany ? 'disclosures' : 'rights', 'footnotes']
  const SECTION_LABELS = { classes: 'Share Classes', shareholders: '5% Shareholders & Promoters', rights: 'Rights & Restrictions', disclosures: 'Disclosures (e)–(l)', footnotes: 'Footnotes' }
  const discTexts = disclosureTexts(data)
  // Only the edited section is stored; the rest keep following their default
  // (e.g. (e) picks up a changed face value). A customised old Rights text
  // already shown in (e) is kept as (e) once anything is edited.
  const setDisclosure = (key, val) => setData(d => {
    const base = d.disclosures || (discTexts.e !== defaultDisclosureText('e', d) ? { e: discTexts.e } : {})
    const next = { ...base }
    if (val === null) delete next[key]; else next[key] = val
    return { ...d, disclosures: next }
  })

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 9999 }}>
      <div className="modal-box overflow-hidden flex flex-col" style={{ maxWidth: '1100px', width: '96vw', maxHeight: '94vh' }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 pb-3 mb-3 shrink-0">
          <div>
            <h2 className="text-base font-bold" style={{ color: 'var(--color-primary)' }}>
              Note {noteNum}: {noteTitle} — Details
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">Fill details as per Schedule III. Data is saved separately and included in the generated financials.</p>
          </div>
          <div className="flex items-center gap-3">
            {bsAmt != null && (
              <div className={`text-xs px-2 py-1 rounded border ${tallies ? 'bg-green-50 border-green-300 text-green-700' : 'bg-red-50 border-red-300 text-red-700'}`}>
                {tallies ? '✓ Tallies with BS' : `⚠ BS ₹${fmtN(bsAmt)} vs Note ₹${fmtN(totalCYAmount)}`}
              </div>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
          </div>
        </div>

        {/* Section tabs */}
        <div className="flex gap-1 mb-3 shrink-0">
          {SECTIONS.map(s => (
            <button key={s} onClick={() => setActiveSection(s)}
              className={`px-3 py-1 text-xs rounded-full font-medium transition ${activeSection === s ? 'text-white' : 'text-gray-600 bg-gray-100 hover:bg-gray-200'}`}
              style={activeSection === s ? { background: 'var(--color-primary)' } : {}}>
              {SECTION_LABELS[s]}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">

          {/* Share Classes */}
          {activeSection === 'classes' && (
            <div>
              {data.classes.map((cls, i) => (
                <ClassEditor key={i} idx={i} cls={cls}
                  bsAmount={i === 0 ? bsAmt : null}
                  onChange={updated => setClasses(data.classes.map((c, ci) => ci === i ? updated : c))}
                  onRemove={() => setClasses(data.classes.filter((_, ci) => ci !== i))}
                />
              ))}
              <button onClick={() => setClasses([...data.classes, emptyClass()])}
                className="text-sm text-blue-600 hover:underline">+ Add Share Class</button>

              {data.classes.length > 1 && (
                <div className="mt-3 p-2 bg-blue-50 border border-blue-200 rounded text-xs">
                  <span className="font-semibold">Total CY Paid-up (all classes): </span>
                  <span className="font-mono">₹{fmtN(totalCYAmount)}</span>
                  {bsAmt != null && <span className={`ml-3 ${tallies ? 'text-green-600' : 'text-red-600'}`}>
                    {tallies ? '✓ Matches BS' : `BS = ₹${fmtN(bsAmt)}`}
                  </span>}
                </div>
              )}
            </div>
          )}

          {/* Shareholders */}
          {activeSection === 'shareholders' && (
            <div>
              <div className="flex items-center gap-3 mb-4 p-2 bg-gray-50 border border-gray-200 rounded flex-wrap">
                <span className="text-xs text-gray-600">Import from Excel template:</span>
                <button onClick={downloadShareholderTemplate}
                  className="text-xs px-2 py-1 border border-blue-400 text-blue-600 rounded hover:bg-blue-50">
                  ⬇ Download Template
                </button>
                <label className="text-xs px-2 py-1 border border-green-400 text-green-700 rounded hover:bg-green-50 cursor-pointer">
                  ⬆ Import Excel
                  <input type="file" accept=".xlsx,.xls" className="hidden" onChange={e => {
                    const file = e.target.files?.[0]; if (!file) return
                    // Use paidUp shares as total; fallback to issued
                    const cls0 = data.classes[0]
                    const cyClosed = num(cls0?.cy.openingShares) + num(cls0?.cy.issuedDuringYear) - num(cls0?.cy.deletedDuringYear) || num(cls0?.cy.paidUp) || num(cls0?.cy.issued)
                    const pyClosed = num(cls0?.py.openingShares) + num(cls0?.py.issuedDuringYear) - num(cls0?.py.deletedDuringYear) || num(cls0?.py.paidUp) || num(cls0?.py.issued)
                    importShareholdersFromExcel(file, cyClosed, pyClosed, ({ fivePct, promoters }) => {
                      // 5% equity holders (non-preference)
                      update5pctEquity(fivePct.filter(r => !r.category?.toLowerCase().includes('prefer')))
                      // Promoters list — only those marked "Promoter"
                      updatePromoters(promoters.map(r => ({
                        name: r.name, class: 'Equity', shares: r.cyShares,
                        pctTotal: r.cyPct, pctChange: ''
                      })))
                    })
                    e.target.value = ''
                  }} />
                </label>
                <button onClick={() => {
                  // % is computed once (at Import, or typed by hand) and then
                  // just sits there as static data — correcting a mistake in
                  // the Classes tab's Opening/Issued/Deleted figures does NOT
                  // by itself touch these already-saved rows. This re-derives
                  // every %, in place, from each row's own shares figure ÷
                  // the CURRENT Classes total — same formula as Import Excel
                  // above — without needing to re-upload the file (so any
                  // manual name/folio edits already made here are kept).
                  const cls0 = data.classes[0]
                  const cyClosed = num(cls0?.cy.openingShares) + num(cls0?.cy.issuedDuringYear) - num(cls0?.cy.deletedDuringYear) || num(cls0?.cy.paidUp) || num(cls0?.cy.issued)
                  const pyClosed = num(cls0?.py.openingShares) + num(cls0?.py.issuedDuringYear) - num(cls0?.py.deletedDuringYear) || num(cls0?.py.paidUp) || num(cls0?.py.issued)
                  const totalCY = cyClosed || 1
                  const totalPY = pyClosed || 1
                  const recalcRows = (rows) => rows.map(r => ({
                    ...r,
                    cyPct: (num(r.cyShares) / totalCY * 100).toFixed(2),
                    pyPct: (num(r.pyShares) / totalPY * 100).toFixed(2),
                  }))
                  update5pctEquity(recalcRows(data.shareholders5pctEquity))
                  update5pctPref(recalcRows(data.shareholders5pctPreference))
                  updatePromoters(data.promoters.map(r => ({
                    ...r,
                    pctTotal: (num(r.shares) / totalCY * 100).toFixed(2),
                  })))
                }}
                  title="Re-derive every % below from each row's shares ÷ the current Classes total — use this after correcting Opening/Issued/Deleted on the Classes tab"
                  className="text-xs px-2 py-1 border border-amber-400 text-amber-700 rounded hover:bg-amber-50">
                  ↻ Recalculate %
                </button>
                <span className="text-[10px] text-gray-400">Face Value col auto-calculates amounts</span>
              </div>

              <ShareholderTable title="Equity Shareholders holding more than 5%"
                rows={data.shareholders5pctEquity} onChange={update5pctEquity} />
              <ShareholderTable title="Preference Shareholders holding more than 5%"
                rows={data.shareholders5pctPreference} onChange={update5pctPref} />
              <PromoterTable rows={data.promoters} onChange={updatePromoters} />
            </div>
          )}

          {/* Rights & Restrictions */}
          {activeSection === 'rights' && (
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Rights, Preferences and Restrictions attached to shares
              </label>
              <textarea
                value={data.rights}
                onChange={e => setData(d => ({ ...d, rights: e.target.value }))}
                rows={6}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 resize-y"
              />
              <p className="text-[10px] text-gray-400 mt-1">Describe voting rights, dividend preferences, liquidation preferences etc. per class.</p>
            </div>
          )}

          {/* Disclosures (e)-(l) — Company */}
          {activeSection === 'disclosures' && (
            <div>
              <p className="text-[10px] text-gray-500 mb-3">
                Printed as {noteNum}(e) to {noteNum}(l) in the PDF and Excel, justified. Edit any text to suit the company; start a line with • for a bullet point. Clear a box to leave that item out.
              </p>
              {SC_DISCLOSURES.map(s => {
                const isDefault = discTexts[s.key] === defaultDisclosureText(s.key, data)
                return (
                  <div key={s.key} className="mb-3">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-semibold text-gray-700">{noteNum}({s.key}) {s.heading}</label>
                      {!isDefault && (
                        <button onClick={() => setDisclosure(s.key, null)} className="text-[10px] text-blue-600 hover:underline">↺ Standard text</button>
                      )}
                    </div>
                    <textarea
                      value={discTexts[s.key]}
                      onChange={e => setDisclosure(s.key, e.target.value)}
                      rows={s.key === 'i' ? 5 : 3}
                      className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs text-justify focus:outline-none focus:ring-1 focus:ring-blue-400 resize-y"
                    />
                  </div>
                )
              })}
            </div>
          )}

          {/* Footnotes */}
          {activeSection === 'footnotes' && (
            <div>
              <div className="text-xs font-semibold text-gray-700 mb-2">Footnotes for Share Capital</div>
              {data.footnotes.map((fn, i) => (
                <div key={i} className="flex items-start gap-2 mb-2">
                  <span className="text-xs text-gray-400 pt-1 w-5 shrink-0">{i + 1}.</span>
                  <input className={INP + ' flex-1'}
                    value={fn}
                    onChange={e => setData(d => ({
                      ...d, footnotes: d.footnotes.map((f, fi) => fi === i ? e.target.value : f)
                    }))}
                    placeholder={`Footnote ${i + 1}`}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-gray-200 pt-3 mt-3 shrink-0">
          <p className="text-[10px] text-gray-400">Data is saved per TB and included in generated PDF/Excel.</p>
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
