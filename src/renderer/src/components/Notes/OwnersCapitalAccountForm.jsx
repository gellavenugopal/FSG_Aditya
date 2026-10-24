import React, { useState, useEffect, useMemo } from 'react'

const INP = 'w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white'
const NUM = INP + ' text-right font-mono'

function num(v) { return parseFloat(v) || 0 }
function fmtN(n) { return n != null && n !== '' && !isNaN(n) ? Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—' }

// ── Period date formatting: "01-04-2025" → "1st April 2025" ────────────────
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
function ordinal(n) {
  const s = ['th','st','nd','rd'], v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
function fmtDateStr(ddmmyyyy) {
  if (!ddmmyyyy) return ''
  const m = ddmmyyyy.trim().match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
  if (!m) return ddmmyyyy
  const [, d, mo, y] = m
  const mi = parseInt(mo, 10) - 1
  if (mi < 0 || mi > 11) return ddmmyyyy
  return `${ordinal(parseInt(d, 10))} ${MONTHS[mi]} ${y}`
}
export function periodStartRaw(period) {
  if (!period) return ''
  const toIdx = period.toLowerCase().indexOf(' to ')
  return toIdx !== -1 ? period.slice(0, toIdx).trim() : ''
}
export function periodEndRaw(period) {
  if (!period) return ''
  const toIdx = period.toLowerCase().indexOf(' to ')
  return toIdx !== -1 ? period.slice(toIdx + 4).trim() : period.trim()
}

// ── Party label by constitution ─────────────────────────────────────────────
export function partyLabelFor(constitutionDisplay, isLLP) {
  if (isLLP) return 'Partner'
  const cd = (constitutionDisplay || '').toLowerCase()
  if (cd.includes('proprietor')) return 'Proprietor'
  if (cd.includes('partnership')) return 'Partner'
  return 'Owner'
}

function emptyPartyFields() {
  return { sharePct: '', opening: '', introduced: '', remuneration: '', interest: '', withdrawals: '', shareOfProfit: '' }
}
function emptyRow(isLLP) {
  return isLLP
    ? { name: '', agreedContribution: '', contrib: emptyPartyFields(), current: emptyPartyFields() }
    : { name: '', ...emptyPartyFields() }
}
function closingOf(f) {
  return num(f.opening) + num(f.introduced) + num(f.remuneration) + num(f.interest) - num(f.withdrawals) + num(f.shareOfProfit)
}
function sumField(rows, field, get = (r) => r) {
  return rows.reduce((s, r) => s + num(get(r)[field]), 0)
}

// ── Sole owner's Share of Profit cell ───────────────────────────────────────
// Seeded from the P&L, but always editable. The P&L's own bottom line is not
// automatically what belongs in the capital account — tax and other
// below-the-line items may be settled outside it, in which case the figure that
// makes the account tally with the Balance Sheet is a different one, and only
// the preparer can say which. Once edited the cell is marked manual and the
// auto-fill leaves it alone; ↺ puts the P&L figure back.
function ProfitCell({ value, manual, onEdit, onReset }) {
  return (
    <div className="flex items-center gap-1">
      <input
        className={NUM} type="number" value={value ?? ''}
        onChange={e => onEdit?.(e.target.value)}
        title={manual ? 'Entered manually — the P&L figure will not overwrite this'
                      : 'Taken from the P&L. Type here to override.'}
      />
      {manual && (
        <button onClick={onReset} title="Restore the figure from the P&L"
          className="shrink-0 text-[10px] text-blue-500 hover:text-blue-700 leading-none px-0.5">↺</button>
      )}
    </div>
  )
}

// ── Single-table editor (Individual / Proprietorship / Partnership) ────────
// For a single owner (Individual/Proprietorship), Remuneration and Interest
// don't apply (there's no one to pay them to), and Share of Profit is not a
// manual split — the sole owner takes 100% of the PL net profit automatically.
function SingleAccountTable({ rows, py, onRowsChange, onPyChange, partyLabel, allowAddRemove, isSingleOwner, openLabel, closeLabel, plManual = {}, onProfitEdit, onProfitReset }) {
  const setRow = (i, field, val) => onRowsChange(rows.map((r, ri) => ri === i ? { ...r, [field]: val } : r))
  const addRow = () => onRowsChange([...rows, emptyRow(false)])
  const removeRow = (i) => onRowsChange(rows.filter((_, ri) => ri !== i))

  const totals = useMemo(() => ({
    opening: sumField(rows, 'opening'), introduced: sumField(rows, 'introduced'),
    remuneration: sumField(rows, 'remuneration'), interest: sumField(rows, 'interest'),
    withdrawals: sumField(rows, 'withdrawals'), shareOfProfit: sumField(rows, 'shareOfProfit'),
    closing: rows.reduce((s, r) => s + closingOf(r), 0),
  }), [rows])
  const pyClosing = closingOf(py)

  return (
    <div className="mb-4">
      <div className="text-[10px] text-gray-400 text-right mb-1">(Amount in Rs.)</div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-1 py-1 border border-gray-200 w-6">Sr.</th>
              <th className="text-left px-2 py-1 border border-gray-200">Name of {partyLabel}</th>
              {!isSingleOwner && <th className="px-2 py-1 border border-gray-200">Share of profit/(loss) (%)</th>}
              <th className="px-2 py-1 border border-gray-200">{openLabel}<br/>(Opening Balance)</th>
              <th className="px-2 py-1 border border-gray-200">Capital Introduced/contributed during the year</th>
              {!isSingleOwner && <th className="px-2 py-1 border border-gray-200">Remuneration for the year</th>}
              {!isSingleOwner && <th className="px-2 py-1 border border-gray-200">Interest for the year</th>}
              <th className="px-2 py-1 border border-gray-200">Withdrawals during the year</th>
              <th className="px-2 py-1 border border-gray-200">Share of Profit / Loss for the year{isSingleOwner ? ' (from P&L)' : ''}</th>
              <th className="px-2 py-1 border border-gray-200">{closeLabel}<br/>(Closing Balance)</th>
              {allowAddRemove && <th className="px-1 border border-gray-200 w-6"></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="px-1 py-0.5 border border-gray-200 text-center text-gray-500">{i + 1}</td>
                <td className="px-1 py-0.5 border border-gray-200"><input className={INP} value={r.name} onChange={e => setRow(i, 'name', e.target.value)} placeholder={`Name of ${partyLabel}`} /></td>
                {!isSingleOwner && <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={r.sharePct} onChange={e => setRow(i, 'sharePct', e.target.value)} /></td>}
                <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={r.opening} onChange={e => setRow(i, 'opening', e.target.value)} /></td>
                <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={r.introduced} onChange={e => setRow(i, 'introduced', e.target.value)} /></td>
                {!isSingleOwner && <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={r.remuneration} onChange={e => setRow(i, 'remuneration', e.target.value)} /></td>}
                {!isSingleOwner && <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={r.interest} onChange={e => setRow(i, 'interest', e.target.value)} /></td>}
                <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={r.withdrawals} onChange={e => setRow(i, 'withdrawals', e.target.value)} /></td>
                <td className="px-2 py-1 border border-gray-200 text-right font-mono bg-gray-50">
                  {isSingleOwner && i === 0 ? (
                    <ProfitCell value={r.shareOfProfit} manual={!!plManual.cy}
                      onEdit={v => onProfitEdit?.('cy', v)} onReset={() => onProfitReset?.('cy')} />
                  ) : (
                    <input className={NUM} type="number" value={r.shareOfProfit} onChange={e => setRow(i, 'shareOfProfit', e.target.value)} />
                  )}
                </td>
                <td className="px-2 py-1 border border-gray-200 text-right font-mono font-semibold bg-blue-50">{fmtN(closingOf(r))}</td>
                {allowAddRemove && (
                  <td className="px-1 py-0.5 border border-gray-200 text-center">
                    <button onClick={() => removeRow(i)} className="text-red-400 hover:text-red-600 text-[10px]">✕</button>
                  </td>
                )}
              </tr>
            ))}
            <tr className="font-semibold bg-gray-50">
              <td className="border border-gray-200" colSpan={isSingleOwner ? 2 : 3}></td>
              <td className="px-2 py-1 border border-gray-200 text-right font-mono">{fmtN(totals.opening)}</td>
              <td className="px-2 py-1 border border-gray-200 text-right font-mono">{fmtN(totals.introduced)}</td>
              {!isSingleOwner && <td className="px-2 py-1 border border-gray-200 text-right font-mono">{fmtN(totals.remuneration)}</td>}
              {!isSingleOwner && <td className="px-2 py-1 border border-gray-200 text-right font-mono">{fmtN(totals.interest)}</td>}
              <td className="px-2 py-1 border border-gray-200 text-right font-mono">{fmtN(totals.withdrawals)}</td>
              <td className="px-2 py-1 border border-gray-200 text-right font-mono">{fmtN(totals.shareOfProfit)}</td>
              <td className="px-2 py-1 border border-gray-200 text-right font-mono bg-blue-100">{fmtN(totals.closing)}</td>
              {allowAddRemove && <td className="border border-gray-200"></td>}
            </tr>
            <tr className="bg-gray-100">
              <td className="px-2 py-1 border border-gray-200 font-semibold" colSpan={isSingleOwner ? 2 : 3}>Previous Year (PY)</td>
              <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={py.opening} onChange={e => onPyChange({ ...py, opening: e.target.value })} /></td>
              <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={py.introduced} onChange={e => onPyChange({ ...py, introduced: e.target.value })} /></td>
              {!isSingleOwner && <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={py.remuneration} onChange={e => onPyChange({ ...py, remuneration: e.target.value })} /></td>}
              {!isSingleOwner && <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={py.interest} onChange={e => onPyChange({ ...py, interest: e.target.value })} /></td>}
              <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={py.withdrawals} onChange={e => onPyChange({ ...py, withdrawals: e.target.value })} /></td>
              <td className="px-2 py-1 border border-gray-200 text-right font-mono bg-gray-50">
                {isSingleOwner ? (
                  <ProfitCell value={py.shareOfProfit} manual={!!plManual.py}
                    onEdit={v => onProfitEdit?.('py', v)} onReset={() => onProfitReset?.('py')} />
                ) : (
                  <input className={NUM} type="number" value={py.shareOfProfit} onChange={e => onPyChange({ ...py, shareOfProfit: e.target.value })} />
                )}
              </td>
              <td className="px-2 py-1 border border-gray-200 text-right font-mono font-semibold">{fmtN(pyClosing)}</td>
              {allowAddRemove && <td className="border border-gray-200"></td>}
            </tr>
          </tbody>
        </table>
      </div>
      {allowAddRemove && (
        <button onClick={addRow} className="mt-2 text-xs text-blue-600 hover:underline">+ Add {partyLabel}</button>
      )}
    </div>
  )
}

// ── LLP dual-table editor (3a Contribution + 3b Current) ────────────────────
function LLPAccountTables({ rows, pyContrib, pyCurrent, onRowsChange, onPyContribChange, onPyCurrentChange, noteNum, openLabel, closeLabel }) {
  const setRowTop = (i, field, val) => onRowsChange(rows.map((r, ri) => ri === i ? { ...r, [field]: val } : r))
  const setRowSub = (i, key, field, val) => onRowsChange(rows.map((r, ri) => ri === i ? { ...r, [key]: { ...r[key], [field]: val } } : r))
  const addRow = () => onRowsChange([...rows, emptyRow(true)])
  const removeRow = (i) => onRowsChange(rows.filter((_, ri) => ri !== i))

  const contribTotals = useMemo(() => ({
    agreedContribution: rows.reduce((s, r) => s + num(r.agreedContribution), 0),
    opening: sumField(rows, 'opening', r => r.contrib), introduced: sumField(rows, 'introduced', r => r.contrib),
    remuneration: sumField(rows, 'remuneration', r => r.contrib), interest: sumField(rows, 'interest', r => r.contrib),
    withdrawals: sumField(rows, 'withdrawals', r => r.contrib), shareOfProfit: sumField(rows, 'shareOfProfit', r => r.contrib),
    closing: rows.reduce((s, r) => s + closingOf(r.contrib), 0),
  }), [rows])
  const currentTotals = useMemo(() => ({
    opening: sumField(rows, 'opening', r => r.current), introduced: sumField(rows, 'introduced', r => r.current),
    remuneration: sumField(rows, 'remuneration', r => r.current), interest: sumField(rows, 'interest', r => r.current),
    withdrawals: sumField(rows, 'withdrawals', r => r.current), shareOfProfit: sumField(rows, 'shareOfProfit', r => r.current),
    closing: rows.reduce((s, r) => s + closingOf(r.current), 0),
  }), [rows])
  const pyContribClosing = closingOf(pyContrib)
  const pyCurrentClosing = closingOf(pyCurrent)

  return (
    <div>
      {/* 3a — Partners Contribution Account */}
      <div className="mb-6">
        <div className="text-sm font-bold mb-1" style={{ color: 'var(--color-primary)' }}>Note {noteNum}(a): Partners Contribution Account</div>
        <div className="text-[10px] text-gray-400 text-right mb-1">(Amount in Rs.)</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-1 py-1 border border-gray-200 w-6">Sr.</th>
                <th className="text-left px-2 py-1 border border-gray-200">Name of Partner</th>
                <th className="px-2 py-1 border border-gray-200">Agreed contribution</th>
                <th className="px-2 py-1 border border-gray-200">Share of profit/(loss) (%)</th>
                <th className="px-2 py-1 border border-gray-200">{openLabel}<br/>(Opening Balance)</th>
                <th className="px-2 py-1 border border-gray-200">Introduced/contributed during the year</th>
                <th className="px-2 py-1 border border-gray-200">Remuneration for the year</th>
                <th className="px-2 py-1 border border-gray-200">Interest for the year</th>
                <th className="px-2 py-1 border border-gray-200">Withdrawals during the year</th>
                <th className="px-2 py-1 border border-gray-200">Share of Profit / Loss for the year</th>
                <th className="px-2 py-1 border border-gray-200">{closeLabel}<br/>(Closing Balance)</th>
                <th className="px-1 border border-gray-200 w-6"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="px-1 py-0.5 border border-gray-200 text-center text-gray-500">{i + 1}</td>
                  <td className="px-1 py-0.5 border border-gray-200"><input className={INP} value={r.name} onChange={e => setRowTop(i, 'name', e.target.value)} placeholder="Name of Partner" /></td>
                  <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={r.agreedContribution} onChange={e => setRowTop(i, 'agreedContribution', e.target.value)} /></td>
                  <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={r.contrib.sharePct} onChange={e => setRowSub(i, 'contrib', 'sharePct', e.target.value)} /></td>
                  <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={r.contrib.opening} onChange={e => setRowSub(i, 'contrib', 'opening', e.target.value)} /></td>
                  <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={r.contrib.introduced} onChange={e => setRowSub(i, 'contrib', 'introduced', e.target.value)} /></td>
                  <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={r.contrib.remuneration} onChange={e => setRowSub(i, 'contrib', 'remuneration', e.target.value)} /></td>
                  <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={r.contrib.interest} onChange={e => setRowSub(i, 'contrib', 'interest', e.target.value)} /></td>
                  <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={r.contrib.withdrawals} onChange={e => setRowSub(i, 'contrib', 'withdrawals', e.target.value)} /></td>
                  <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={r.contrib.shareOfProfit} onChange={e => setRowSub(i, 'contrib', 'shareOfProfit', e.target.value)} /></td>
                  <td className="px-2 py-1 border border-gray-200 text-right font-mono font-semibold bg-blue-50">{fmtN(closingOf(r.contrib))}</td>
                  <td className="px-1 py-0.5 border border-gray-200 text-center">
                    <button onClick={() => removeRow(i)} className="text-red-400 hover:text-red-600 text-[10px]">✕</button>
                  </td>
                </tr>
              ))}
              <tr className="font-semibold bg-gray-50">
                <td className="border border-gray-200" colSpan={2}></td>
                <td className="px-2 py-1 border border-gray-200 text-right font-mono">{fmtN(contribTotals.agreedContribution)}</td>
                <td className="border border-gray-200"></td>
                <td className="px-2 py-1 border border-gray-200 text-right font-mono">{fmtN(contribTotals.opening)}</td>
                <td className="px-2 py-1 border border-gray-200 text-right font-mono">{fmtN(contribTotals.introduced)}</td>
                <td className="px-2 py-1 border border-gray-200 text-right font-mono">{fmtN(contribTotals.remuneration)}</td>
                <td className="px-2 py-1 border border-gray-200 text-right font-mono">{fmtN(contribTotals.interest)}</td>
                <td className="px-2 py-1 border border-gray-200 text-right font-mono">{fmtN(contribTotals.withdrawals)}</td>
                <td className="px-2 py-1 border border-gray-200 text-right font-mono">{fmtN(contribTotals.shareOfProfit)}</td>
                <td className="px-2 py-1 border border-gray-200 text-right font-mono bg-blue-100">{fmtN(contribTotals.closing)}</td>
                <td className="border border-gray-200"></td>
              </tr>
              <tr className="bg-gray-100">
                <td className="px-2 py-1 border border-gray-200 font-semibold" colSpan={4}>Previous Year (PY)</td>
                <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={pyContrib.opening} onChange={e => onPyContribChange({ ...pyContrib, opening: e.target.value })} /></td>
                <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={pyContrib.introduced} onChange={e => onPyContribChange({ ...pyContrib, introduced: e.target.value })} /></td>
                <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={pyContrib.remuneration} onChange={e => onPyContribChange({ ...pyContrib, remuneration: e.target.value })} /></td>
                <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={pyContrib.interest} onChange={e => onPyContribChange({ ...pyContrib, interest: e.target.value })} /></td>
                <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={pyContrib.withdrawals} onChange={e => onPyContribChange({ ...pyContrib, withdrawals: e.target.value })} /></td>
                <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={pyContrib.shareOfProfit} onChange={e => onPyContribChange({ ...pyContrib, shareOfProfit: e.target.value })} /></td>
                <td className="px-2 py-1 border border-gray-200 text-right font-mono font-semibold">{fmtN(pyContribClosing)}</td>
                <td className="border border-gray-200"></td>
              </tr>
            </tbody>
          </table>
        </div>
        <button onClick={addRow} className="mt-2 text-xs text-blue-600 hover:underline">+ Add Partner</button>
      </div>

      {/* 3b — Partners Current Account */}
      <div>
        <div className="text-sm font-bold mb-1" style={{ color: 'var(--color-primary)' }}>Note {noteNum}(b): Partners Current Account</div>
        <div className="text-[10px] text-gray-400 text-right mb-1">(Amount in Rs.)</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-1 py-1 border border-gray-200 w-6">Sr.</th>
                <th className="text-left px-2 py-1 border border-gray-200">Name of Partner</th>
                <th className="px-2 py-1 border border-gray-200">Share of profit/(loss) (%)</th>
                <th className="px-2 py-1 border border-gray-200">{openLabel}<br/>(Opening Balance)</th>
                <th className="px-2 py-1 border border-gray-200">Introduced/contributed during the year</th>
                <th className="px-2 py-1 border border-gray-200">Remuneration for the year</th>
                <th className="px-2 py-1 border border-gray-200">Interest for the year</th>
                <th className="px-2 py-1 border border-gray-200">Withdrawals during the year</th>
                <th className="px-2 py-1 border border-gray-200">Share of Profit / Loss for the year</th>
                <th className="px-2 py-1 border border-gray-200">{closeLabel}<br/>(Closing Balance)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="px-1 py-0.5 border border-gray-200 text-center text-gray-500">{i + 1}</td>
                  <td className="px-2 py-1 border border-gray-200 text-gray-700">{r.name || <span className="text-gray-300 italic">(unnamed)</span>}</td>
                  <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={r.current.sharePct} onChange={e => setRowSub(i, 'current', 'sharePct', e.target.value)} /></td>
                  <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={r.current.opening} onChange={e => setRowSub(i, 'current', 'opening', e.target.value)} /></td>
                  <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={r.current.introduced} onChange={e => setRowSub(i, 'current', 'introduced', e.target.value)} /></td>
                  <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={r.current.remuneration} onChange={e => setRowSub(i, 'current', 'remuneration', e.target.value)} /></td>
                  <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={r.current.interest} onChange={e => setRowSub(i, 'current', 'interest', e.target.value)} /></td>
                  <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={r.current.withdrawals} onChange={e => setRowSub(i, 'current', 'withdrawals', e.target.value)} /></td>
                  <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={r.current.shareOfProfit} onChange={e => setRowSub(i, 'current', 'shareOfProfit', e.target.value)} /></td>
                  <td className="px-2 py-1 border border-gray-200 text-right font-mono font-semibold bg-blue-50">{fmtN(closingOf(r.current))}</td>
                </tr>
              ))}
              <tr className="font-semibold bg-gray-50">
                <td className="border border-gray-200" colSpan={3}></td>
                <td className="px-2 py-1 border border-gray-200 text-right font-mono">{fmtN(currentTotals.opening)}</td>
                <td className="px-2 py-1 border border-gray-200 text-right font-mono">{fmtN(currentTotals.introduced)}</td>
                <td className="px-2 py-1 border border-gray-200 text-right font-mono">{fmtN(currentTotals.remuneration)}</td>
                <td className="px-2 py-1 border border-gray-200 text-right font-mono">{fmtN(currentTotals.interest)}</td>
                <td className="px-2 py-1 border border-gray-200 text-right font-mono">{fmtN(currentTotals.withdrawals)}</td>
                <td className="px-2 py-1 border border-gray-200 text-right font-mono">{fmtN(currentTotals.shareOfProfit)}</td>
                <td className="px-2 py-1 border border-gray-200 text-right font-mono bg-blue-100">{fmtN(currentTotals.closing)}</td>
              </tr>
              <tr className="bg-gray-100">
                <td className="px-2 py-1 border border-gray-200 font-semibold" colSpan={3}>Previous Year (PY)</td>
                <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={pyCurrent.opening} onChange={e => onPyCurrentChange({ ...pyCurrent, opening: e.target.value })} /></td>
                <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={pyCurrent.introduced} onChange={e => onPyCurrentChange({ ...pyCurrent, introduced: e.target.value })} /></td>
                <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={pyCurrent.remuneration} onChange={e => onPyCurrentChange({ ...pyCurrent, remuneration: e.target.value })} /></td>
                <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={pyCurrent.interest} onChange={e => onPyCurrentChange({ ...pyCurrent, interest: e.target.value })} /></td>
                <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={pyCurrent.withdrawals} onChange={e => onPyCurrentChange({ ...pyCurrent, withdrawals: e.target.value })} /></td>
                <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={pyCurrent.shareOfProfit} onChange={e => onPyCurrentChange({ ...pyCurrent, shareOfProfit: e.target.value })} /></td>
                <td className="px-2 py-1 border border-gray-200 text-right font-mono font-semibold">{fmtN(pyCurrentClosing)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Main form ────────────────────────────────────────────────────────────────
export default function OwnersCapitalAccountForm({
  tbId, entityId, useEntityLevel, noteNum, noteTitle, noteTotal, notePrevTotal,
  constitution, constitutionDisplay, period, onClose, onSaved,
  plNetProfit, plPrevNetProfit,
}) {
  const isLLP = parseInt(constitution) === 2
  const cd = (constitutionDisplay || '').toLowerCase()
  const isSingleOwner = !isLLP && (cd.includes('individual') || cd.includes('proprietor'))
  const partyLabel = partyLabelFor(constitutionDisplay, isLLP)
  const initialRowCount = isSingleOwner ? 1 : 2

  const openLabel = `As at ${fmtDateStr(periodStartRaw(period)) || '1st April 20XX'}`
  const closeLabel = `As at ${fmtDateStr(periodEndRaw(period)) || '31st March 20XX'}`

  const [data, setData] = useState(() => isLLP
    ? { variant: 'llp', rows: Array.from({ length: initialRowCount }, () => emptyRow(true)), pyContrib: emptyPartyFields(), pyCurrent: emptyPartyFields() }
    : { variant: 'single', rows: Array.from({ length: initialRowCount }, () => emptyRow(false)), py: emptyPartyFields() })
  const [saving, setSaving] = useState(false)

  // Auto-populate proprietor name for single-owner entities (Proprietorship/Individual)
  useEffect(() => {
    if (!isSingleOwner || data.variant !== 'single' || data.rows[0]?.name) return
    const fetchEntityName = async () => {
      try {
        const entities = await window.api?.getEntities()
        const entity = entities?.find(e => e.id === entityId)
        if (entity?.name) {
          setData(d => ({
            ...d,
            rows: d.rows.map((r, i) => i === 0 ? { ...r, name: entity.name } : r)
          }))
        }
      } catch (_) {}
    }
    fetchEntityName()
  }, [isSingleOwner, entityId])

  const [loadTick, setLoadTick] = useState(0)
  useEffect(() => {
    if (!noteNum) return
    const fetch = useEntityLevel
      ? window.api?.getEntityNoteDetails(entityId, noteNum, noteTitle)
      : window.api?.getNoteDetails(tbId, noteNum, noteTitle)
    fetch?.then(saved => {
      if (saved && saved.rows) { setData(saved); setLoadTick(t => t + 1) }
    }).catch(() => {})
  }, [tbId, entityId, noteNum, useEntityLevel])

  // Sole owner (Individual/Proprietorship): Share of Profit is seeded from the
  // P&L rather than split by hand — but only as a seed. A side the user has
  // typed over (plManual.cy / .py) is left strictly alone.
  //
  // loadTick is a dependency because the saved payload arrives asynchronously,
  // i.e. AFTER this effect has already run. Without it the load resolves last
  // and whatever figure was saved in an earlier session silently wins forever —
  // which is how a stale Previous Year profit could sit in this form
  // indefinitely, uneditable, while the P&L itself had since been corrected.
  useEffect(() => {
    if (!isSingleOwner || data.variant !== 'single') return
    setData(d => {
      const manual = d.plManual || {}
      const cur = d.rows[0]
      const nextCy = manual.cy ? (cur?.shareOfProfit ?? '') : (plNetProfit ?? 0)
      const nextPy = manual.py ? (d.py?.shareOfProfit ?? '') : (plPrevNetProfit ?? 0)
      const same = cur
        && String(cur.shareOfProfit ?? '') === String(nextCy ?? '')
        && String(d.py?.shareOfProfit ?? '') === String(nextPy ?? '')
      if (same) return d
      return {
        ...d,
        rows: d.rows.map((r, i) => i === 0 ? { ...r, shareOfProfit: nextCy } : r),
        py: { ...d.py, shareOfProfit: nextPy },
      }
    })
  }, [isSingleOwner, data.variant, plNetProfit, plPrevNetProfit, loadTick])

  // Typing in a Share of Profit cell marks that side manual; ↺ hands it back to
  // the P&L (the auto-fill effect above then re-seeds it on the next pass).
  const editProfit = (side, value) => setData(d => ({
    ...d,
    plManual: { ...(d.plManual || {}), [side]: true },
    ...(side === 'cy'
      ? { rows: d.rows.map((r, i) => i === 0 ? { ...r, shareOfProfit: value } : r) }
      : { py: { ...d.py, shareOfProfit: value } }),
  }))
  const resetProfit = (side) => setData(d => ({
    ...d,
    plManual: { ...(d.plManual || {}), [side]: false },
    ...(side === 'cy'
      ? { rows: d.rows.map((r, i) => i === 0 ? { ...r, shareOfProfit: plNetProfit ?? 0 } : r) }
      : { py: { ...d.py, shareOfProfit: plPrevNetProfit ?? 0 } }),
  }))

  const formClosingTotal = useMemo(() => {
    if (data.variant === 'llp') {
      return data.rows.reduce((s, r) => s + closingOf(r.contrib) + closingOf(r.current), 0)
    }
    return data.rows.reduce((s, r) => s + closingOf(r), 0)
  }, [data])
  const formPYClosingTotal = useMemo(() => {
    if (data.variant === 'llp') return closingOf(data.pyContrib) + closingOf(data.pyCurrent)
    return closingOf(data.py)
  }, [data])

  const bsCY = noteTotal != null ? Math.abs(noteTotal) : null
  const bsPY = notePrevTotal != null ? Math.abs(notePrevTotal) : null
  const cyTallies = bsCY != null && Math.abs(Math.abs(formClosingTotal) - bsCY) < 1
  const pyTallies = bsPY != null && Math.abs(Math.abs(formPYClosingTotal) - bsPY) < 1

  const save = async () => {
    setSaving(true)
    try {
      // Persist isSingleOwner so the PDF/Excel renderers know to hide the
      // Share%/Remuneration/Interest columns without re-deriving constitution.
      const payload = { ...data, isSingleOwner }
      if (useEntityLevel) {
        await window.api?.saveEntityNoteDetails({ entityId, noteNum, noteTitle, data: payload })
      } else {
        await window.api?.saveNoteDetails({ tbId, noteNum, noteTitle, data: payload })
      }
      onSaved?.()
      onClose()
    } finally { setSaving(false) }
  }

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 9999 }}>
      <div className="modal-box overflow-hidden flex flex-col" style={{ maxWidth: '1400px', width: '97vw', maxHeight: '94vh' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-200 pb-3 mb-3 shrink-0">
          <div>
            <h2 className="text-base font-bold" style={{ color: 'var(--color-primary)' }}>
              Note {noteNum}: {noteTitle} — Details
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              The total of this form should match the total of the Trial Balance / Balance Sheet.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {bsCY != null && (
              <div className={`text-xs px-2 py-1 rounded border ${cyTallies ? 'bg-green-50 border-green-300 text-green-700' : 'bg-red-50 border-red-300 text-red-700'}`}>
                CY: {cyTallies ? '✓ Tallies with BS' : `⚠ BS ₹${fmtN(bsCY)} vs Form ₹${fmtN(formClosingTotal)}`}
              </div>
            )}
            {bsPY != null && (
              <div className={`text-xs px-2 py-1 rounded border ${pyTallies ? 'bg-green-50 border-green-300 text-green-700' : 'bg-red-50 border-red-300 text-red-700'}`}>
                PY: {pyTallies ? '✓ Tallies with BS' : `⚠ BS ₹${fmtN(bsPY)} vs Form ₹${fmtN(formPYClosingTotal)}`}
              </div>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {data.variant === 'llp' ? (
            <LLPAccountTables
              rows={data.rows}
              pyContrib={data.pyContrib} pyCurrent={data.pyCurrent}
              onRowsChange={rows => setData(d => ({ ...d, rows }))}
              onPyContribChange={pyContrib => setData(d => ({ ...d, pyContrib }))}
              onPyCurrentChange={pyCurrent => setData(d => ({ ...d, pyCurrent }))}
              noteNum={noteNum}
              openLabel={openLabel} closeLabel={closeLabel}
            />
          ) : (
            <SingleAccountTable
              rows={data.rows} py={data.py}
              onRowsChange={rows => setData(d => ({ ...d, rows }))}
              onPyChange={py => setData(d => ({ ...d, py }))}
              partyLabel={partyLabel}
              allowAddRemove={!isSingleOwner}
              isSingleOwner={isSingleOwner}
              openLabel={openLabel} closeLabel={closeLabel}
              plManual={data.plManual || {}}
              onProfitEdit={editProfit}
              onProfitReset={resetProfit}
            />
          )}
        </div>

        <div className="flex items-center justify-between border-t border-gray-200 pt-3 mt-3 shrink-0">
          <p className="text-[10px] text-gray-400">Data is saved per TB and included in the generated PDF/Excel, presented like the Share Capital note.</p>
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
