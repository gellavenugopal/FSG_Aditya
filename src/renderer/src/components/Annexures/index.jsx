import React, { useState, useRef, useEffect } from 'react'
import { netCreditPurchasesWorking } from '../../utils/ratios'
import { useFinancials, fmtINR, displayAmt } from '../../hooks/useFinancials'
import PYTBSelector from '../shared/PYTBSelector'
import PYModeSelect from '../shared/PYModeSelect'
import RemarkCell, { useRemarks } from '../shared/RemarkCell'
import { getSubnoteGroups, UNCLASSIFIED_LABEL, subnoteGroupFigures, pyOnlySubnoteLines, annexureDisplayLabels } from '../../utils/annexureGrouping'

function Guard({ activeTB, loading, error, children }) {
  if (!activeTB) return <div className="flex items-center justify-center h-full text-gray-400 text-sm">Load a Trial Balance in the Actual TB tab first.</div>
  if (loading) return <div className="flex items-center justify-center h-full text-gray-400">Loading financial data...</div>
  if (error) return <div className="flex items-center justify-center h-full text-red-500 text-sm px-8 text-center">{error}</div>
  return children
}

function FixedAssetsSchedule({ data }) {
  const faNote = Object.values(data.notes).find(n =>
    !n.isPL && /property|plant|equipment|intangible|fixed asset/i.test(n.title)
  )
  if (!faNote) return null

  const byL3 = new Map()
  for (const row of faNote.rows) {
    const l3 = row.level3 || 'Other'
    if (!byL3.has(l3)) byL3.set(l3, [])
    byL3.get(l3).push(row)
  }

  return (
    <div className="mb-8">
      <h3 className="font-bold text-blue-800 text-sm mb-3 uppercase tracking-wide">Fixed Assets Schedule - Property, Plant and Equipment</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border border-blue-100 rounded" style={{ minWidth: 800 }}>
          <thead>
            <tr className="bg-blue-800 text-white">
              <th className="py-1.5 px-3 text-left font-semibold w-[35%]">Particulars</th>
              <th className="py-1.5 px-2 text-right font-semibold w-[20%]">Opening Value</th>
              <th className="py-1.5 px-2 text-right font-semibold w-[20%]">Net Movement</th>
              <th className="py-1.5 px-2 text-right font-semibold w-[20%]">Closing Value</th>
            </tr>
          </thead>
          <tbody>
            {[...byL3.entries()].map(([l3, rows], gi) => {
              const l3Total = rows.reduce((s, r) => s + displayAmt(r, 'closing_balance'), 0)
              const l3Opening = rows.reduce((s, r) => s + displayAmt(r, 'opening_balance'), 0)
              const l3Mv = l3Total - l3Opening
              return (
                <React.Fragment key={l3 + gi}>
                  <tr className="bg-blue-50 border-b border-blue-100">
                    <td className="py-1.5 px-3 font-bold text-blue-800">{l3}</td>
                    <td className="py-1 px-2 text-right font-mono font-semibold text-blue-700">{fmtINR(l3Opening)}</td>
                    <td className={`py-1 px-2 text-right font-mono font-semibold ${l3Mv >= 0 ? 'text-green-700' : 'text-red-700'}`}>{fmtINR(l3Mv)}</td>
                    <td className="py-1 px-2 text-right font-mono font-bold text-blue-800">{fmtINR(l3Total)}</td>
                  </tr>
                  {rows.map((row, ri) => {
                    const cb = displayAmt(row, 'closing_balance')
                    const ob = displayAmt(row, 'opening_balance')
                    const mv = cb - ob
                    return (
                      <tr key={row.ledger_code || ri} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-0.5 pl-6 pr-2 text-gray-600 italic">{row.ledger_name || row.name || ''}</td>
                        <td className="py-0.5 px-2 text-right font-mono text-gray-500">{fmtINR(ob)}</td>
                        <td className={`py-0.5 px-2 text-right font-mono ${mv >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmtINR(mv)}</td>
                        <td className="py-0.5 px-2 text-right font-mono text-gray-800">{fmtINR(cb)}</td>
                      </tr>
                    )
                  })}
                </React.Fragment>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="bg-blue-800 text-white">
              <td className="py-2 px-3 font-bold text-xs">Total</td>
              <td className="py-2 px-2 text-right font-mono font-bold">{fmtINR(faNote.rows.reduce((s, r) => s + displayAmt(r, 'opening_balance'), 0))}</td>
              <td className="py-2 px-2 text-right font-mono font-bold">-</td>
              <td className="py-2 px-2 text-right font-mono font-bold">{fmtINR(faNote.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

// ── Trade Payables / Trade Receivables reconciliation ───────────────────────
// Books vs BS: some ledgers grouped under Trade Payables/Receivables in the
// books carry an abnormal sign (a supplier ledger in debit, a customer
// ledger in credit) and get reclassified at mapping time — a Dr-balance
// Payables ledger moves to Other current assets/Advance to Suppliers, a
// Cr-balance Receivables ledger moves to Other current liabilities/Advance
// from Customers (see mapping-engine.js's post-pass, tagged via
// override_note). This reconciliation makes every such move visible and
// traceable back to the original ledger, across every constitution and
// upload path.
const rawBal = (row) => parseFloat(row.closing_balance || 0)

// Same reclassification RULE mapping-engine.js applies at mapping time for
// CY (see its "Trade Payables/Receivables reconciliation" pass) — reused
// here to independently ask the identical question of PY: does THIS
// ledger's balance sign, for THAT year on its own, warrant sitting under
// the Advance-to/from bucket instead? A ledger can genuinely be a Trade
// Receivable in CY (customer owes us — Dr) and an Advance from Customer in
// PY (we owed the customer — Cr) purely because its balance flipped sign
// year over year; the two years are never forced to agree.
function isAbnormalForAlie(displayAmount) {
  return Math.abs(displayAmount) >= 0.005 && displayAmount < 0
}

function TradeReconTable({ title, bookRows, normalNoteTitle, reclassNoteTitle, reclassSign, tbId, getRemark, onRemarkSaved, hasSeparatePYTB, showZero }) {
  const [expanded, setExpanded] = useState(false)
  // "As per Books" always uses the natural convention of the ORIGINAL group
  // (Payables = credit-positive, Receivables = debit-positive), via the RAW
  // universal-convention balance (Cr+/Dr-) — NOT row.alie, which for a row
  // already reclassified (pulled in from ocaNote/oclNote) reflects its NEW
  // classification, not the original group. reclassSign alone (fixed per
  // table, +1 Payables / -1 Receivables) is what mapping-engine.js's own
  // reclassification check effectively reduces to as well: for Payables,
  // "raw balance < 0" (Dr, abnormal) ⟺ "reclassSign*raw < 0"; for
  // Receivables, "raw balance > 0" (Cr, abnormal) ⟺ "reclassSign*raw < 0"
  // too (reclassSign=-1 flips it). So "bookAmt < 0" is the reclassification
  // trigger in both cases, independent of the row's current alie.
  const bookAmtCY = (row) => reclassSign * rawBal(row)
  // PY, via the same "this year's opening = last year's closing" figure
  // already carried on each CY row — unreliable once a separate PY TB is
  // selected (that row belongs to a different TB entirely), same caveat as
  // the rest of Annexures.
  const bookAmtPY = (row) => hasSeparatePYTB ? null : reclassSign * parseFloat(row.opening_balance || 0)
  const isReclassifiedCY = (row) => !!(row.override_note || '').toLowerCase().includes('reclassified from')
  const isReclassifiedPY = (row) => hasSeparatePYTB ? null : isAbnormalForAlie(bookAmtPY(row))

  const isZero = (row) => {
    const cy = Math.abs(bookAmtCY(row)) < 0.005
    const py = hasSeparatePYTB ? true : Math.abs(bookAmtPY(row)) < 0.005
    return cy && py
  }
  const visibleRows = showZero ? bookRows : bookRows.filter(r => !isZero(r))

  const retained = visibleRows.filter(r => !isReclassifiedCY(r))
  const reclassified = visibleRows.filter(r => isReclassifiedCY(r))
  const bookTotal = visibleRows.reduce((s, r) => s + bookAmtCY(r), 0)
  const retainedTotal = retained.reduce((s, r) => s + bookAmtCY(r), 0)
  const reclassTotal = reclassified.reduce((s, r) => s + bookAmtCY(r), 0)

  // PY split independently by isReclassifiedPY — NOT the same retained/
  // reclassified grouping as CY, since a ledger can be retained in CY but
  // reclassified in PY (or vice versa); reusing the CY grouping would
  // silently misfile a ledger's PY amount under the wrong PY bucket.
  const retainedPY = visibleRows.filter(r => !isReclassifiedPY(r))
  const reclassifiedPY = visibleRows.filter(r => isReclassifiedPY(r))
  const bookTotalPY = hasSeparatePYTB ? null : visibleRows.reduce((s, r) => s + bookAmtPY(r), 0)
  const retainedTotalPY = hasSeparatePYTB ? null : retainedPY.reduce((s, r) => s + bookAmtPY(r), 0)
  const reclassTotalPY = hasSeparatePYTB ? null : reclassifiedPY.reduce((s, r) => s + bookAmtPY(r), 0)

  if (visibleRows.length === 0) return null

  return (
    <div className="mb-4 border border-blue-100 rounded overflow-hidden">
      <div className="w-full flex items-center justify-between px-4 py-2 bg-blue-50 hover:bg-blue-100 transition">
        <button className="flex-1 text-left" onClick={() => setExpanded(e => !e)}>
          <span className="font-bold text-blue-800 text-sm uppercase tracking-wide">{title}</span>
        </button>
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-blue-700" title="Current Year total">CY {fmtINR(bookTotal)}</span>
          <span className="text-xs font-mono text-gray-500" title="Previous Year total">PY {bookTotalPY === null ? '—' : fmtINR(bookTotalPY)}</span>
          <span className="text-xs text-gray-400">{visibleRows.length} of {bookRows.length} ledger{bookRows.length !== 1 ? 's' : ''}</span>
          <button className="text-xs text-gray-400" onClick={() => setExpanded(e => !e)}>{expanded ? 'collapse' : 'expand'}</button>
        </div>
      </div>
      {expanded && (
        <>
          <p className="text-xs text-gray-400 px-4 pt-2">
            Reconciles every ledger booked under {normalNoteTitle} against where it actually sits on the Balance Sheet
            after sign-based reclassification — evaluated independently for Current Year and Previous Year, since the
            same ledger can genuinely flip sides between the two years.
          </p>
          <div className="overflow-x-auto px-4 pb-3">
            <table className="w-full text-xs border border-blue-100 rounded mt-2" style={{ minWidth: 1000 }}>
              <thead>
                <tr className="bg-blue-800 text-white">
                  <th className="py-1.5 px-3 text-left font-semibold">Code</th>
                  <th className="py-1.5 px-3 text-left font-semibold">Ledger Name</th>
                  <th className="py-1.5 px-2 text-right font-semibold">As per Books ({normalNoteTitle}) CY</th>
                  <th className="py-1.5 px-3 text-left font-semibold">As per BS (CY)</th>
                  <th className="py-1.5 px-2 text-right font-semibold">As per Books PY</th>
                  <th className="py-1.5 px-3 text-left font-semibold">As per BS (PY)</th>
                  <th className="py-1.5 px-2 text-left font-semibold">Remark</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, ri) => {
                  const reclassCY = isReclassifiedCY(row)
                  const reclassPY = isReclassifiedPY(row)
                  const remarkKey = row.ledger_code || row.ledger_name || row.name || String(ri)
                  return (
                    <tr key={row.ledger_code || ri} className={`border-b border-gray-100 hover:bg-gray-50 ${reclassCY || reclassPY ? 'bg-amber-50/60' : ''}`}>
                      <td className="py-0.5 px-3 text-gray-500">{row.ledger_code || '-'}</td>
                      <td className="py-0.5 px-3 text-gray-800">{row.ledger_name || row.name || ''}</td>
                      <td className="py-0.5 px-2 text-right font-mono text-gray-900">{fmtINR(bookAmtCY(row))}</td>
                      <td className={`py-0.5 px-3 ${reclassCY ? 'text-amber-700 font-medium' : 'text-gray-600'}`}>
                        {reclassCY ? reclassNoteTitle : normalNoteTitle}
                        {reclassCY && <div className="text-[10px] text-amber-600 italic">{row.override_note}</div>}
                      </td>
                      <td className="py-0.5 px-2 text-right font-mono text-gray-900">
                        {hasSeparatePYTB ? '—' : fmtINR(bookAmtPY(row))}
                      </td>
                      <td className={`py-0.5 px-3 ${reclassPY ? 'text-amber-700 font-medium' : 'text-gray-600'}`}>
                        {hasSeparatePYTB ? '—' : (reclassPY ? reclassNoteTitle : normalNoteTitle)}
                      </td>
                      <td className="py-0.5 px-2">
                        {tbId && (
                          <RemarkCell tbId={tbId} scope="annexure" scopeKey={remarkKey}
                            initialValue={getRemark?.('annexure', remarkKey) || ''}
                            onSaved={onRemarkSaved} compact />
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-blue-50 border-t border-blue-200">
                  <td colSpan={2} className="py-1 px-3 font-bold text-blue-800">Total as per Books</td>
                  <td className="py-1 px-2 text-right font-mono font-bold text-blue-800">{fmtINR(bookTotal)}</td>
                  <td className="py-1 px-3 text-gray-500 text-[11px]">
                    Retained in {normalNoteTitle}: {fmtINR(retainedTotal)}<br />
                    Reclassified to {reclassNoteTitle}: {fmtINR(reclassTotal)}
                  </td>
                  <td className="py-1 px-2 text-right font-mono font-bold text-gray-700">
                    {bookTotalPY === null ? '—' : fmtINR(bookTotalPY)}
                  </td>
                  <td className="py-1 px-3 text-gray-500 text-[11px]">
                    {bookTotalPY === null ? '—' : (
                      <>Retained in {normalNoteTitle}: {fmtINR(retainedTotalPY)}<br />
                      Reclassified to {reclassNoteTitle}: {fmtINR(reclassTotalPY)}</>
                    )}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// The working behind "Net Credit Purchases" of the Trade Payables Turnover Ratio (General Notes), kept here with the other workings
// rather than on the face of the Notes.
function NetCreditPurchasesWorking({ data }) {
  const w = netCreditPurchasesWorking(data)
  if (!w) return null
  const fmt = (n) => (Math.abs(n) < 0.005 ? '-' : fmtINR(n))
  return (
    <div className="mt-8 mb-6">
      <h3 className="font-bold text-blue-900 text-base mb-1 uppercase tracking-wide border-t-2 border-blue-800 pt-4">Workings of Ratios — Net Credit Purchases</h3>
      <p className="text-xs text-gray-400 mb-3">Trade Payables Turnover Ratio = Net Credit Purchases / Average Trade Payables. Net Credit Purchases is taken as the total of the
        Profit &amp; Loss captions below; cash purchases and purchase returns are not separately identified.</p>
      <table className="w-full max-w-3xl text-xs">
        <thead>
          <tr className="border-b-2 border-blue-800">
            <th className="text-left py-1.5 font-semibold text-blue-900 w-[60%]">Particulars</th>
            <th className="text-right py-1.5 font-semibold text-blue-900 pr-2">Current Year</th>
            <th className="text-right py-1.5 font-semibold text-blue-900 pr-2">Previous Year</th>
          </tr>
        </thead>
        <tbody>
          {w.rows.map((r, i) => r.kind === 'head' ? (
            <tr key={i} className="bg-blue-50"><td colSpan={3} className="py-1 pl-2 font-semibold text-blue-900">{r.label}</td></tr>
          ) : (
            <tr key={i} className={`border-b border-gray-100 ${r.kind === 'sub' ? 'font-semibold bg-gray-50' : r.kind === 'total' ? 'font-bold bg-blue-50 border-blue-200' : ''}`}>
              <td className={`py-1 ${r.kind === 'line' ? 'pl-6' : 'pl-2'}`}>{r.label}</td>
              <td className="py-1 text-right font-mono pr-2">{fmt(r.cy)}</td>
              <td className="py-1 text-right font-mono pr-2 text-gray-500">{fmt(r.py)}</td>
            </tr>
          ))}
          {w.average !== null && (
            <>
              {w.components && (
                <>
                  <tr className="border-b border-gray-100"><td className="py-1 pl-6">Trade Payables at the end of the year</td><td className="py-1 text-right font-mono pr-2">{fmt(w.components.closing)}</td><td></td></tr>
                  <tr className="border-b border-gray-100"><td className="py-1 pl-6">Trade Payables at the beginning of the year</td><td className="py-1 text-right font-mono pr-2">{fmt(w.components.opening)}</td><td></td></tr>
                </>
              )}
              <tr className="border-b border-gray-100 font-semibold"><td className="py-1 pl-2">Average Trade Payables</td><td className="py-1 text-right font-mono pr-2">{fmt(w.average)}</td><td></td></tr>
            </>
          )}
          {w.ratio !== null && (
            <tr className="font-bold bg-blue-50 border-b border-blue-200"><td className="py-1 pl-2">Trade Payables Turnover Ratio (times)</td><td className="py-1 text-right font-mono pr-2">{Number(w.ratio).toFixed(2)}</td><td></td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function TradePayablesReceivablesReconciliation({ data, tbId, getRemark, onRemarkSaved, hasSeparatePYTB, showZero }) {
  const notes = Object.values(data.notes || {})
  const payablesNote = notes.find(n => !n.isPL && /^trade\s+payables?$/i.test(n.title || ''))
  const receivablesNote = notes.find(n => !n.isPL && /^trade\s+receivables?$/i.test(n.title || ''))
  const ocaNote = notes.find(n => !n.isPL && /^other current assets$/i.test(n.title || ''))   // where they sat until 0.1.102 (still so in a locked year)
  const stlNote = notes.find(n => !n.isPL && /^short.term loans( and advances)?$/i.test(n.title || ''))
  const oclNote = notes.find(n => !n.isPL && /^other current liabilities$/i.test(n.title || ''))

  const reclassifiedFromPayables = [...(stlNote?.rows || []), ...(ocaNote?.rows || [])].filter(r => /reclassified from trade payables/i.test(r.override_note || ''))
  const reclassifiedFromReceivables = (oclNote?.rows || []).filter(r => /reclassified from trade receivables/i.test(r.override_note || ''))

  const payablesBookRows = [...(payablesNote?.rows || []), ...reclassifiedFromPayables]
  const receivablesBookRows = [...(receivablesNote?.rows || []), ...reclassifiedFromReceivables]

  if (payablesBookRows.length === 0 && receivablesBookRows.length === 0) return null

  return (
    <div className="mt-8">
      <h3 className="font-bold text-blue-900 text-base mb-1 uppercase tracking-wide border-t-2 border-blue-800 pt-4">Reconciliation</h3>
      <p className="text-xs text-gray-400 mb-4">Books vs Balance Sheet placement for Trade Payables and Trade Receivables, Current Year and Previous Year alike.</p>
      <TradeReconTable title="Trade Payables — Books vs Balance Sheet Reconciliation"
        bookRows={payablesBookRows} normalNoteTitle="Trade Payables" reclassNoteTitle="Short-term Loans and Advances (Advance to Suppliers)"
        reclassSign={1} tbId={tbId} getRemark={getRemark} onRemarkSaved={onRemarkSaved}
        hasSeparatePYTB={hasSeparatePYTB} showZero={showZero} />
      <TradeReconTable title="Trade Receivables — Books vs Balance Sheet Reconciliation"
        bookRows={receivablesBookRows} normalNoteTitle="Trade Receivables" reclassNoteTitle="Other Current Liabilities (Advance from Customers)"
        reclassSign={-1} tbId={tbId} getRemark={getRemark} onRemarkSaved={onRemarkSaved}
        hasSeparatePYTB={hasSeparatePYTB} showZero={showZero} />
    </div>
  )
}

function NoteAnnexure({ note, tbId, getRemark, onRemarkSaved, showZero = false, onFix, jumpTarget, onJumpHandled, hasSeparatePYTB = false, prevMapL3 = null, prevRowsByLedger = null, showBranchCol = false, levelFormat = [] }) {
  const [expanded, setExpanded] = useState(false)
  const blockRef = useRef(null)
  const isZeroRow = (r) => {
    const cb = displayAmt(r, 'closing_balance')
    const ob = displayAmt(r, 'opening_balance')
    return Math.abs(cb) < 0.005 && Math.abs(ob) < 0.005
  }

  // Auto-expand + scroll into view when navigated here from a Notes
  // sub-note's "→ Annexure" link (see App.jsx's annexureTarget state).
  const isJumpTarget = jumpTarget && jumpTarget.noteNum === note.num
  useEffect(() => {
    if (!isJumpTarget) return
    setExpanded(true)
    const t = setTimeout(() => {
      blockRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      onJumpHandled?.()
    }, 80)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTarget?.key])

  // Group ledgers by sub-note (Level 2 for PL / Level 3 for BS — see
  // utils/annexureGrouping.js), then filter zero-balance ledgers per group
  // (unless showZero) and drop any group left empty by that filter.
  const shown = annexureDisplayLabels(note)   // print text only - keys below keep the real labels
  const groups = getSubnoteGroups(note, levelFormat)
    .map(g => ({ ...g, rows: showZero ? g.rows : g.rows.filter(r => !isZeroRow(r)) }))
    .filter(g => g.rows.length > 0)
  const totalLedgers = getSubnoteGroups(note, levelFormat).reduce((s, g) => s + g.rows.length, 0)
  const visibleLedgers = groups.reduce((s, g) => s + g.rows.length, 0)

  // PPE only: which Income Tax Act, 1961 block each ledger was assigned to
  // (see Dep (IT) tab) — shown as an extra transparency column, additional
  // to the existing Sub-note (asset-category) breakdown, never replacing it.
  const itBlockByLedger = note.itBlockByLedger
  const showBlockCol = itBlockByLedger && Object.keys(itBlockByLedger).length > 0

  return (
    <div ref={blockRef} className={`mb-4 border rounded overflow-hidden transition-colors ${isJumpTarget ? 'border-blue-400 ring-2 ring-blue-300' : 'border-gray-200'}`}>
      {/* Column widths deliberately mirror the expanded table's <th> widths
          below (22/16/8/11/11/11/11/10%) so the CY/PY totals here sit
          directly above their matching "CY/PY Sub-note Total" columns,
          instead of floating unaligned in a plain flex row. */}
      <button
        className="w-full flex items-center px-4 py-2 bg-gray-50 hover:bg-gray-100 transition text-left"
        onClick={() => setExpanded(e => !e)}
      >
        <span className={`font-semibold text-sm truncate w-[46%] pr-2 ${(note.title || '').toLowerCase().includes('uncategorised') ? 'text-red-600' : 'text-blue-900'}`}>
          Note {note.num}: {note.displayTitle || note.title}
        </span>
        <span className="w-[11%]" />
        <span className="w-[11%] text-right text-xs font-mono font-semibold text-blue-800" title="Current Year total">{fmtINR(note.total)}</span>
        <span className="w-[11%]" />
        <span className="w-[11%] text-right text-xs font-mono font-semibold text-gray-600" title="Previous Year total">{fmtINR(note.prevTotal)}</span>
        <span className="w-[10%] flex items-center justify-end gap-2 pl-2">
          {(note.title || '').toLowerCase().includes('uncategorised') && onFix && (
            <button
              onClick={(e) => { e.stopPropagation(); onFix({
                alie: note.alie, mapping2_resultant: note.title,
              }, `Fix: ${note.title}`) }}
              className="px-2 py-0.5 text-[10px] rounded border border-red-400 text-red-700 bg-red-50 hover:bg-red-100 transition font-medium"
            >Fix</button>
          )}
          <span className="text-[10px] text-gray-400 whitespace-nowrap">{visibleLedgers}/{totalLedgers}</span>
          <span className="text-xs text-gray-400">{expanded ? '▴' : '▾'}</span>
        </span>
      </button>
      {expanded && (
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-blue-50 border-b border-blue-200">
              <th className="text-left py-1 px-4 font-semibold text-blue-900 w-[22%]">Ledger Name</th>
              {showBranchCol && <th className="text-left py-1 px-3 font-semibold text-blue-900 w-[12%]">Branch</th>}
              <th className="text-left py-1 px-3 font-semibold text-blue-900 w-[16%]">Sub-note</th>
              {showBlockCol && <th className="text-left py-1 px-3 font-semibold text-blue-900 w-[13%]">IT Block</th>}
              <th className="text-left py-1 px-2 font-semibold text-blue-900 w-[8%]">Code</th>
              <th className="text-right py-1 px-3 font-semibold text-blue-900 w-[11%]">CY Ledger</th>
              <th className="text-right py-1 px-3 font-semibold text-blue-900 w-[11%]">CY Sub-note Total</th>
              <th className="text-right py-1 px-3 font-semibold text-blue-900 w-[11%]">PY Ledger</th>
              <th className="text-right py-1 px-3 font-semibold text-blue-900 w-[11%]">PY Sub-note Total</th>
              <th className="text-left py-1 px-2 font-semibold text-blue-900 w-[10%]">Remark</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g, gi) => {
              // Same figures the PDF and the Excel export show
              // (subnoteGroupFigures) — each used to keep its own copy, and
              // they could disagree (Santosh Kumar Gupta, 0.1.34/0.1.35).
              const { cy: groupCY, py: groupPY } = subnoteGroupFigures(note, g, { amount: displayAmt, hasSeparatePYTB, prevMapL3 })
              const isUncat = g.label === UNCLASSIFIED_LABEL
              const isTargetGroup = isJumpTarget && jumpTarget.subnote === g.label
              return g.rows.map((row, ri) => {
                const code = row.ledger_code || ''
                const ledgerName = row.ledger_name || row.name || ''
                const isLastInGroup = ri === g.rows.length - 1
                const remarkKey = code || ledgerName
                return (
                  <tr key={`${gi}-${row.ledger_code || ri}`} className={`border-b border-gray-100 hover:bg-gray-50 ${isUncat ? 'bg-red-50/40' : ''} ${isTargetGroup ? 'bg-amber-50' : ''}`}>
                    <td className={`py-0.5 px-4 ${isUncat ? 'text-red-700' : 'text-gray-800'}`}>{shown(ledgerName)}</td>
                    {showBranchCol && <td className="py-0.5 px-3 text-gray-600">{row.branch_name || ''}</td>}
                    <td className={`py-0.5 px-3 ${isUncat ? 'text-red-700 font-medium' : 'text-gray-600'}`}>
                      {ri === 0 ? shown(g.label) : ''}
                      {ri === 0 && isUncat && onFix && (
                        <button
                          onClick={() => onFix({
                            alie: row.alie || note.alie,
                            mapping1_resultant: row.mapping1_resultant || note.level1,
                            mapping2_resultant: row.mapping2_resultant || note.title,
                            mapping3_resultant: g.label,
                          }, `Fix: ${g.label}`)}
                          className="ml-1 px-1 py-0 text-[9px] rounded border border-red-400 text-red-700 bg-white hover:bg-red-100"
                        >Fix</button>
                      )}
                    </td>
                    {showBlockCol && (
                      <td className="py-0.5 px-3 text-gray-600">{itBlockByLedger[ledgerName]?.block || '—'}</td>
                    )}
                    <td className="py-0.5 px-2 text-gray-500">{code || '-'}</td>
                    <td className={`py-0.5 px-3 text-right font-mono text-gray-900 ${isLastInGroup ? 'underline' : ''}`}>{fmtINR(displayAmt(row, 'closing_balance'))}</td>
                    <td className={`py-0.5 px-3 text-right font-mono font-semibold text-blue-800 ${isLastInGroup ? 'underline' : ''}`}>{isLastInGroup ? fmtINR(groupCY) : ''}</td>
                    <td className={`py-0.5 px-3 text-right font-mono text-gray-400 ${isLastInGroup ? 'underline' : ''}`}>
                      {hasSeparatePYTB
                        ? (() => {
                            const pyLedgerKey = (code || ledgerName || '').trim().toLowerCase()
                            const pyVal = pyLedgerKey ? prevRowsByLedger?.get(pyLedgerKey) : undefined
                            return pyVal !== undefined ? fmtINR(pyVal) : '—'
                          })()
                        : fmtINR(displayAmt(row, 'opening_balance'))}
                    </td>
                    <td className={`py-0.5 px-3 text-right font-mono font-semibold text-gray-500 ${isLastInGroup ? 'underline' : ''}`}>
                      {isLastInGroup ? (groupPY === null ? '—' : fmtINR(groupPY)) : ''}
                    </td>
                    <td className="py-0.5 px-2">
                      {tbId && remarkKey && (
                        <RemarkCell tbId={tbId} scope="annexure" scopeKey={remarkKey}
                          initialValue={getRemark?.('annexure', remarkKey) || ''}
                          onSaved={onRemarkSaved} compact />
                      )}
                    </td>
                  </tr>
                )
              })
            })}
            {/* A sub-note only last year had — same line the PDF and Excel print
                (pyOnlySubnoteLines), so the groups add up to the Previous Year total. */}
            {hasSeparatePYTB && pyOnlySubnoteLines(note, groups, levelFormat).map((l, li) => (
              <tr key={`pyonly-${li}`} className="border-b border-gray-100">
                <td className="py-0.5 px-4 text-gray-500 italic">(Previous Year only)</td>
                {showBranchCol && <td />}
                <td className="py-0.5 px-3 text-gray-600">{l.label}</td>
                {showBlockCol && <td className="py-0.5 px-3 text-gray-600">—</td>}
                <td className="py-0.5 px-2 text-gray-500">-</td>
                <td className="py-0.5 px-3 text-right font-mono text-gray-900 underline">—</td>
                <td className="py-0.5 px-3 text-right font-mono font-semibold text-blue-800 underline" />
                <td className="py-0.5 px-3 text-right font-mono text-gray-400 underline">{fmtINR(l.py)}</td>
                <td className="py-0.5 px-3 text-right font-mono font-semibold text-gray-500 underline">{fmtINR(l.py)}</td>
                <td />
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-blue-50 border-t border-blue-200">
              <td colSpan={(showBranchCol ? 5 : 4) + (showBlockCol ? 1 : 0)} className="py-1 px-4 font-bold text-blue-800">Total</td>
              <td className="py-1 px-3 text-right font-mono font-bold text-blue-800">{fmtINR(note.total)}</td>
              <td />
              <td className="py-1 px-3 text-right font-mono font-bold text-gray-500">{fmtINR(note.prevTotal)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  )
}

export default function Annexures({ entity, activeTB, prevTB, activeRsId, onPrevTBChange, jumpTarget, onJumpHandled, onFixNavigate }) {
  const { data, loading, error, refresh } = useFinancials(activeTB, prevTB, entity, activeRsId)
  const period = activeTB?.period || ''
  // Consolidated view merges every branch's ledgers into one set — show
  // which branch each ledger came from so a CA can trace it back.
  const isConsolidated = activeTB?.id === '__consolidated__'
  const [search, setSearch] = useState('')
  const [showZero, setShowZero] = useState(false)
  const [showEmptyAnnex, setShowEmptyAnnex] = useState(false)
  // "Fix" jumps to the full Rectification / Recategorisation screen, scoped
  // to just the clicked category — same screen/features as the Mapping menu.
  const openFix = (filter, title) => onFixNavigate?.(filter, title)
  const { get: getRemark, set: setRemark } = useRemarks(activeTB?.id)
  const onRemarkSaved = (scope, key, value) => setRemark(scope, key, value)

  // A jump from a Notes "→ Annexure" link must always land on a visible
  // note — clear any active search that could be hiding it.
  useEffect(() => {
    if (jumpTarget) setSearch('')
  }, [jumpTarget?.key])

  // Filter: hide annexures whose every ledger has zero CY+PY (default).
  const noteList = data
    ? (showEmptyAnnex ? Object.values(data.notes) : (data.activeNotes || []))
        .filter(n => !search || n.title.toLowerCase().includes(search.toLowerCase()))
    : []

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Guard activeTB={activeTB} loading={loading} error={error}>
        <div className="flex items-center gap-3 px-5 py-3 border-b border-blue-100 shrink-0 bg-white flex-wrap">
          <div>
            <h2 className="font-bold text-blue-900 text-sm">Annexures &amp; Reconciliation to Financial Statements</h2>
            {entity && <p className="text-xs text-gray-500">{entity.name}{period ? ` | ${period}` : ''}</p>}
          </div>
          <div className="ml-auto flex items-center gap-3 flex-wrap">
            <PYModeSelect activeTB={activeTB} onChanged={refresh} />
            <PYTBSelector entity={entity} currentTBId={activeTB?.id} prevTB={prevTB} onChange={onPrevTBChange}
              disabled={!!data?.pyMode && data.pyMode !== 'required'}
              disabledTitle="Previous Year figures are switched off for this Financial Year (Previous Year figures: Required)." />
            <label className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer">
              <input type="checkbox" checked={showEmptyAnnex} onChange={e => setShowEmptyAnnex(e.target.checked)}
                className="rounded border-gray-300" />
              Show empty annexures
            </label>
            <label className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer">
              <input type="checkbox" checked={showZero} onChange={e => setShowZero(e.target.checked)}
                className="rounded border-gray-300" />
              Show zero-balance ledgers
            </label>
            <input type="text" placeholder="Search annexures..." value={search} onChange={e => setSearch(e.target.value)}
              className="border border-gray-300 rounded px-3 py-1.5 text-xs w-40 text-gray-900 bg-white focus:ring-2 focus:ring-blue-400 focus:outline-none" />
            {search && <button onClick={() => setSearch('')} className="text-gray-400 text-xs">X</button>}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {data && (
            <>
              <h3 className="font-bold text-blue-800 text-sm mb-3 uppercase tracking-wide">Detailed Annexures by Note</h3>
              <p className="text-xs text-gray-400 mb-4">Each note with its individual ledger details, amounts, and classification.</p>

              {noteList.length === 0 && (
                <div className="text-center text-gray-400 text-sm mt-10">
                  {search ? 'No annexures match your search.' : 'No annexures to display. Run mapping first.'}
                </div>
              )}

              {noteList.map(note => (
                <NoteAnnexure key={note.num} note={note} showZero={showZero}
                  tbId={activeTB?.id} getRemark={getRemark} onRemarkSaved={onRemarkSaved}
                  onFix={openFix} jumpTarget={jumpTarget} onJumpHandled={onJumpHandled}
                  hasSeparatePYTB={!!prevTB?.id} prevMapL3={data.prevMapL3} prevRowsByLedger={data.prevRowsByLedger}
                  showBranchCol={isConsolidated} levelFormat={data.levelFormat} />
              ))}

              {noteList.length > 0 && (
                <div className="text-xs text-gray-400 text-right mt-4">All figures derived from Mapped Trial Balance</div>
              )}

              <TradePayablesReceivablesReconciliation data={data} tbId={activeTB?.id} getRemark={getRemark} onRemarkSaved={onRemarkSaved}
                hasSeparatePYTB={!!prevTB?.id} showZero={showZero} />

              <NetCreditPurchasesWorking data={data} />
            </>
          )}
        </div>
      </Guard>
    </div>
  )
}
