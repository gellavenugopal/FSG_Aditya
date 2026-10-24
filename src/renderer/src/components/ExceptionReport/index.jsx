/**
 * Exception Report — all Check variances in one place:
 *   • Balance Sheet difference (Equity & Liabilities vs Assets)
 *   • Share Capital: TB vs Fill Details (paid-up)
 *   • Trade Payables: TB vs Ageing Schedule
 *   • Trade Receivables: TB vs Ageing Schedule
 *   • Property, Plant & Equipment: TB vs Depreciation sheet WDV
 */
import React, { useState, useEffect, useMemo } from 'react'
import { useFinancials, fmtINR, displayAmt } from '../../hooks/useFinancials'
import { indexSavedNoteRows, parsedNoteData } from '../../utils/savedNoteData'
import PYTBSelector from '../shared/PYTBSelector'
import { TP_AGEING_BUCKETS, TP_MSME_ROWS, TP_OTHERS_ROWS } from '../Notes/TradePayablesDisclosureForm'
import { TR_AGEING_BUCKETS, trComputedCell } from '../Notes/TradeReceivablesAgingForm'
import { ncAgeingResolve } from '../../utils/tradeReceivablesNonCorp'
import { computeTax } from '../../utils/taxComputation'
import { resolveGroup, todayLocal, figuresOf, buildTaxInput, loadDepIT, loadTaxComputationSaved } from '../../utils/taxComputationIO'
import { computeDeferredTax } from '../../utils/deferredTax'
import { loadDepSources, bsDeferredTax, buildDeferredInput } from '../../utils/deferredTaxIO'

const num = (v) => parseFloat(v) || 0
// A figure that is missing (a row with no Previous Year comparison) is nil, not a difference.
const isZero = (v) => !(Math.abs(Number(v)) >= 0.005)

function Guard({ activeTB, loading, error, children }) {
  if (!activeTB) return <div className="flex items-center justify-center h-full text-gray-400 text-sm">Load a Trial Balance in the Actual TB tab first.</div>
  if (loading) return <div className="flex items-center justify-center h-full text-gray-400">Loading financial data...</div>
  if (error) return <div className="flex items-center justify-center h-full text-red-500 text-sm px-8 text-center">{error}</div>
  return children
}

// Sum an ageing period (cy/py object) over the given row keys and buckets
function sumAgeing(periodData, rowKeys, buckets) {
  if (!periodData) return 0
  let s = 0
  for (const rk of rowKeys) {
    for (const b of buckets) s += num(periodData?.[rk]?.[b.key])
  }
  return s
}

function DiffCell({ value, notFilled }) {
  if (notFilled) return <td className="py-1.5 px-3 text-right text-xs text-gray-400 italic">Not filled</td>
  return (
    <td className={`py-1.5 px-3 text-right font-mono text-xs font-semibold ${isZero(value) ? 'text-green-600' : 'text-red-600'}`}>
      {isZero(value) ? '—' : fmtINR(value)}
    </td>
  )
}

function AmtCell({ value, notFilled }) {
  if (notFilled) return <td className="py-1.5 px-3 text-right text-xs text-gray-400">—</td>
  return <td className="py-1.5 px-3 text-right font-mono text-xs text-gray-800">{fmtINR(value)}</td>
}

export default function ExceptionReport({ entity, activeTB, prevTB, activeRsId, onPrevTBChange }) {
  const { data, loading, error } = useFinancials(activeTB, prevTB, entity, activeRsId)
  // noteDetails(note) → that note's saved Fill Details, matched by title
  const [noteDetails, setNoteDetails] = useState(() => () => undefined)
  const [stockCheck, setStockCheck] = useState(null) // { check, openTotal, closeTotal } from the Stock tab
  // What the Mapped TB's Adjustments do to the Trial Balance (mappedTB:adjustmentSummary).
  const [adjSummary, setAdjSummary] = useState(null)
  // Features > Tax Computation: what was saved (null = not prepared yet) and the Dep (IT) depreciation it draws
  const [taxComp, setTaxComp] = useState({ saved: null, depIT: 0, loaded: false })
  // Features > Deferred Tax: what was saved (null = not prepared yet) and the depreciation schedules it draws
  const [defTax, setDefTax] = useState({ saved: null, src: null, loaded: false })

  useEffect(() => {
    let dead = false
    setDefTax({ saved: null, src: null, loaded: false })
    if (!entity?.id || !activeTB?.entity_period_id) { setDefTax({ saved: null, src: null, loaded: true }); return }
    Promise.all([
      Promise.resolve(window.api?.getDeferredTax?.(entity.id, activeTB.entity_period_id)).catch(() => null),
      loadDepSources(entity, activeTB),
    ]).then(([saved, src]) => { if (!dead) setDefTax({ saved: saved || null, src, loaded: true }) })
    return () => { dead = true }
  }, [entity?.id, activeTB?.id, activeTB?.entity_period_id])

  useEffect(() => {
    let dead = false
    setTaxComp({ saved: null, depIT: 0, loaded: false })
    if (!entity?.id || !activeTB?.entity_period_id) { setTaxComp({ saved: null, depIT: 0, loaded: true }); return }
    Promise.all([loadTaxComputationSaved(entity.id, activeTB.entity_period_id), loadDepIT(entity, activeTB)])
      .then(([saved, depIT]) => { if (!dead) setTaxComp({ saved, depIT, loaded: true }) })
    return () => { dead = true }
  }, [entity?.id, activeTB?.id, activeTB?.entity_period_id])

  useEffect(() => {
    if (!activeTB?.id) { setNoteDetails(() => () => undefined); return }
    window.api?.listNoteDetails?.(activeTB.id)
      .then(list => setNoteDetails(() => indexSavedNoteRows(list, parsedNoteData)))
      .catch(() => setNoteDetails(() => () => undefined))
  }, [activeTB?.id])

  useEffect(() => {
    if (!activeTB?.id) { setAdjSummary(null); return }
    const arg = activeTB.id === '__consolidated__' ? { entityId: activeTB.entity_id ?? entity?.id } : activeTB.id
    Promise.resolve(window.api?.getAdjustmentSummary?.(arg)).then(s => setAdjSummary(s || null)).catch(() => setAdjSummary(null))
  }, [activeTB?.id, entity?.id])

  // Opening/Closing Stock: TB litmus-test value vs Stock tab's own category totals
  useEffect(() => {
    if (!activeTB?.id) { setStockCheck(null); return }
    Promise.all([
      window.api?.getOpeningStockCheck(activeTB.id).catch(() => null),
      window.api?.getStockRows(activeTB.id).catch(() => []),
    ]).then(([check, rows]) => {
      let openTotal = 0, closeTotal = 0
      for (const r of (rows || [])) {
        if (r.name.startsWith('Opening Stock - ')) openTotal += Math.abs(parseFloat(r.closing_balance) || 0)
        else if (r.name.startsWith('Closing Stock - PL - ')) closeTotal += Math.abs(parseFloat(r.closing_balance) || 0)
      }
      setStockCheck(check ? { check, openTotal, closeTotal } : null)
    }).catch(() => setStockCheck(null))
  }, [activeTB?.id])

  const exceptions = useMemo(() => {
    if (!data) return []
    const notes = Object.values(data.notes || {})
    const findNote = (rx) => notes.find(n => !n.isPL && rx.test(n.title || ''))
    const rows = []

    // ── 1. Balance Sheet difference ─────────────────────────────────────────
    {
      const elCY = num(data.totalEL), asCY = num(data.totalAssets)
      const elPY = (data.elSections || []).reduce((s, sec) => s + num(sec.prevTotal), 0)
      const asPY = (data.assetSections || []).reduce((s, sec) => s + num(sec.prevTotal), 0)
      rows.push({
        area: 'Balance Sheet',
        check: 'Equity & Liabilities vs Assets',
        aLabel: 'Equity & Liabilities', bLabel: 'Assets',
        cyA: elCY, cyB: asCY, cyDiff: elCY - asCY,
        pyA: elPY, pyB: asPY, pyDiff: elPY - asPY,
      })
    }

    // ── 1b. Trial Balance adjustments (Mapped TB: Adjustments (Debit) / (Credit)) ──
    // Every figure in the statements is the REVISED closing balance, so the revised
    // Trial Balance must still balance - and a set of adjustments should itself
    // balance (Debit = Credit). Shown only when the Trial Balance carries any.
    if (adjSummary?.rows_adjusted > 0) {
      const n = adjSummary.rows_adjusted
      rows.push({
        area: `Trial Balance adjustments (${n} ledger${n === 1 ? '' : 's'})`,
        check: 'Adjustments (Debit) vs Adjustments (Credit), typed on the Mapped TB',
        aLabel: 'Adjustments (Debit)', bLabel: 'Adjustments (Credit)',
        cyA: adjSummary.total_debit, cyB: adjSummary.total_credit, cyDiff: adjSummary.difference,
        pyA: 0, pyB: 0, pyDiff: 0,
      })
      rows.push({
        area: 'Trial Balance after adjustments',
        check: 'Total Debit balances vs total Credit balances - the revised Trial Balance every statement is built from',
        aLabel: 'Revised Debit balances', bLabel: 'Revised Credit balances',
        cyA: adjSummary.revised_dr, cyB: adjSummary.revised_cr, cyDiff: adjSummary.revised_dr - adjSummary.revised_cr,
        pyA: 0, pyB: 0, pyDiff: 0,
      })
    }

    // ── 1c. Total Tax as per the Tax Computation vs Current Tax as per the Profit & Loss account ──
    if (taxComp.loaded) {
      const fig = figuresOf(data)
      const plTax = fig ? num(fig.taxCurrentOnly) : 0   // the Current Tax line only (not deferred tax, not the whole tax expense)
      if (taxComp.saved) {
        const inp = buildTaxInput(resolveGroup(entity), fig, taxComp.depIT, activeTB?.period, todayLocal())
        const tc = computeTax(inp, taxComp.saved)
        rows.push({
          area: 'Income Tax',
          check: 'Total Tax as per Tax Computation (Features > Tax Computation) vs Current Tax as per the Profit & Loss account',
          aLabel: 'Total Tax as per Computation', bLabel: 'Current Tax as per P&L',
          cyA: tc.totalTax, cyB: plTax, cyDiff: tc.totalTax - plTax,
          pyA: 0, pyB: 0, pyDiff: 0,
        })
      } else {
        rows.push({
          area: 'Income Tax',
          check: 'Tax Computation not prepared yet (Features > Tax Computation) - Current Tax as per the Profit & Loss account is shown',
          aLabel: 'Total Tax as per Computation', bLabel: 'Current Tax as per P&L',
          cyA: plTax, cyB: plTax, cyDiff: 0, pyA: 0, pyB: 0, pyDiff: 0, notFilled: true,
        })
      }
    }

    // ── 1d. Deferred Tax: as per the Deferred Tax computation (both approaches) vs Deferred Tax as per the Profit & Loss account ──
    if (defTax.loaded) {
      const fig = figuresOf(data)
      const plDef = fig ? num(fig.taxDeferred) : 0
      const mk = (area, check, charge, notFilled) => rows.push({
        area, check,
        aLabel: 'Deferred tax as per Computation', bLabel: 'Deferred tax as per P&L',
        cyA: notFilled ? plDef : charge, cyB: plDef, cyDiff: notFilled ? 0 : charge - plDef,
        pyA: 0, pyB: 0, pyDiff: 0, notFilled: !!notFilled,
      })
      if (defTax.saved) {
        const dt = computeDeferredTax(buildDeferredInput(resolveGroup(entity), fig, defTax.src, bsDeferredTax(data)), defTax.saved)
        mk('Deferred Tax - Approach 1', 'Timing difference of the year x net tax rate (Features > Deferred Tax) vs Deferred Tax as per the Profit & Loss account (charge positive = DTL, credit = DTA)', dt.a1.charge, false)
        mk('Deferred Tax - Approach 2', 'WDV approach: closing DTA / DTL less opening (Features > Deferred Tax) vs Deferred Tax as per the Profit & Loss account', dt.a2.charge, false)
      } else {
        mk('Deferred Tax', 'Deferred Tax computation not prepared yet (Features > Deferred Tax) - Deferred Tax as per the Profit & Loss account is shown', 0, true)
      }
    }

    // ── 2. Share Capital: TB vs Fill Details paid-up ────────────────────────
    {
      const note = findNote(/share\s*capital/i)
      if (note) {
        const det = noteDetails(note)
        const classes = det?.classes
        if (classes?.length) {
          const formCY = classes.reduce((s, c) => s + num(c.cy?.paidUp) * num(c.faceValue), 0)
          const formPY = classes.reduce((s, c) => s + num(c.py?.paidUp) * num(c.faceValue), 0)
          rows.push({
            area: `Share Capital (Note ${note.num})`,
            check: 'TB vs Fill Details (Subscribed & Paid-up)',
            aLabel: 'As per TB', bLabel: 'As per Fill Details',
            cyA: num(note.total), cyB: formCY, cyDiff: num(note.total) - formCY,
            pyA: num(note.prevTotal), pyB: formPY, pyDiff: num(note.prevTotal) - formPY,
          })
        } else {
          rows.push({
            area: `Share Capital (Note ${note.num})`,
            check: 'TB vs Fill Details (Subscribed & Paid-up)',
            aLabel: 'As per TB', bLabel: 'As per Fill Details',
            cyA: num(note.total), pyA: num(note.prevTotal), notFilled: true,
          })
        }
      }
    }

    // ── 3. Trade Payables: TB vs Ageing Schedule ────────────────────────────
    {
      const note = findNote(/trade\s*payable/i)
      if (note) {
        const det = noteDetails(note)
        const ageing = det?.ageing
        const allRows = [...TP_MSME_ROWS, ...TP_OTHERS_ROWS]
        if (ageing?.cy) {
          const schedCY = sumAgeing(ageing.cy, allRows, TP_AGEING_BUCKETS)
          const schedPY = sumAgeing(ageing.py, allRows, TP_AGEING_BUCKETS)
          rows.push({
            area: `Trade Payables (Note ${note.num})`,
            check: 'TB vs Ageing Schedule',
            aLabel: 'As per TB', bLabel: 'As per Ageing Schedule',
            cyA: num(note.total), cyB: schedCY, cyDiff: num(note.total) - schedCY,
            pyA: num(note.prevTotal), pyB: schedPY, pyDiff: num(note.prevTotal) - schedPY,
          })
        } else {
          rows.push({
            area: `Trade Payables (Note ${note.num})`,
            check: 'TB vs Ageing Schedule',
            aLabel: 'As per TB', bLabel: 'As per Ageing Schedule',
            cyA: num(note.total), pyA: num(note.prevTotal), notFilled: true,
          })
        }
      }
    }

    // ── 4. Trade Receivables: TB vs Ageing Schedule ─────────────────────────
    {
      const note = findNote(/trade\s*receivable/i)
      if (note && [1, 2].includes(parseInt(entity?.constitution))) {
        // Proprietorship / Partnership / LLP: the 6-month ageing table's total
        // vs the Trial Balance figure. Untouched, the table IS the TB figure
        // (everything defaults to Unsecured, considered good), so a difference
        // only ever appears once the preparer has edited it. A branch entity
        // keeps it at entity level, which this per-TB report cannot see.
        if (entity?.has_branches) {
          rows.push({
            area: `Trade Receivables (Note ${note.num})`,
            check: 'TB vs Ageing table',
            aLabel: 'As per TB', bLabel: 'As per Ageing table',
            cyA: num(note.total), pyA: 0, notFilled: true,
          })
        } else {
          const { total } = ncAgeingResolve(noteDetails(note)?.ncAgeing, note.total)
          rows.push({
            area: `Trade Receivables (Note ${note.num})`,
            check: 'TB vs Ageing table (Fill Details)',
            aLabel: 'As per TB', bLabel: 'As per Ageing table',
            cyA: num(note.total), cyB: total, cyDiff: num(note.total) - total,
            pyA: 0, pyB: 0, pyDiff: 0,
          })
        }
      } else if (note) {
        const det = noteDetails(note)
        const grand = (pd) => TR_AGEING_BUCKETS.reduce((s, b) => s + trComputedCell(pd, 'grand', b.key), 0)
        if (det?.cy) {
          const schedCY = grand(det.cy)
          const schedPY = grand(det.py)
          rows.push({
            area: `Trade Receivables (Note ${note.num})`,
            check: 'TB vs Ageing Schedule',
            aLabel: 'As per TB', bLabel: 'As per Ageing Schedule',
            cyA: num(note.total), cyB: schedCY, cyDiff: num(note.total) - schedCY,
            pyA: num(note.prevTotal), pyB: schedPY, pyDiff: num(note.prevTotal) - schedPY,
          })
        } else {
          rows.push({
            area: `Trade Receivables (Note ${note.num})`,
            check: 'TB vs Ageing Schedule',
            aLabel: 'As per TB', bLabel: 'As per Ageing Schedule',
            cyA: num(note.total), pyA: num(note.prevTotal), notFilled: true,
          })
        }
      }
    }

    // ── 5. PPE: TB vs Depreciation sheet WDV ────────────────────────────────
    {
      const note = findNote(/property.*plant.*equipment|fixed\s*assets/i)
      if (note) {
        // Depreciation-derived rows carry a 'Total' subtotal in templateRows
        const tRows = note.templateRowsAll || note.templateRows || []
        const totalRow = tRows.find(r => r.isSubtotal && /^total$/i.test(r.label || ''))
        if (totalRow) {
          const depCY = num(totalRow.cy), depPY = num(totalRow.py)
          rows.push({
            area: `Property, Plant & Equipment (Note ${note.num})`,
            check: 'TB vs Depreciation Sheet (WDV)',
            aLabel: 'As per TB', bLabel: 'As per Depreciation Sheet',
            cyA: num(note.total), cyB: depCY, cyDiff: num(note.total) - depCY,
            pyA: num(note.prevTotal), pyB: depPY, pyDiff: num(note.prevTotal) - depPY,
          })
        } else {
          rows.push({
            area: `Property, Plant & Equipment (Note ${note.num})`,
            check: 'TB vs Depreciation Sheet (WDV)',
            aLabel: 'As per TB', bLabel: 'As per Depreciation Sheet',
            cyA: num(note.total), pyA: num(note.prevTotal), notFilled: true,
          })
        }
      }
    }

    // ── 5b. Opening/Closing Stock: As per Trial Balance vs As per Category
    // Total (Stock tab) — the same reconciliation shown in the Stock tab's
    // own "Difference" row, surfaced here too.
    if (stockCheck?.check) {
      const { check, openTotal, closeTotal } = stockCheck
      if (check.isBalanced && (check.embeddedOpening !== 0 || openTotal !== 0)) {
        rows.push({
          area: 'Opening Stock',
          check: 'As per Trial Balance vs As per Category Total (Stock tab)',
          aLabel: 'As per Trial Balance', bLabel: 'As per Category Total',
          cyA: check.embeddedOpening, cyB: openTotal, cyDiff: check.embeddedOpening - openTotal,
        })
      }
      if (check.embeddedClosing !== 0 || closeTotal !== 0) {
        rows.push({
          area: 'Closing Stock',
          check: 'As per Trial Balance vs As per Category Total (Stock tab)',
          aLabel: 'As per Trial Balance', bLabel: 'As per Category Total',
          cyA: check.embeddedClosing, cyB: closeTotal, cyDiff: check.embeddedClosing - closeTotal,
        })
      }
    }

    // ── 6. Inventories: PY Closing Stock (per BS) vs CY Opening Stock (per TB) ──
    // Only checkable when a separate previous-year TB was uploaded — otherwise
    // note.prevTotal is itself just derived from this same TB's opening_balance
    // (see buildSections() in useFinancials.js), so the two figures can never
    // disagree and the check would be meaningless.
    if (prevTB) {
      const note = findNote(/inventor/i)
      if (note) {
        const cyOpening = (note.rows || []).reduce((s, r) => s + displayAmt(r, 'opening_balance'), 0)
        const pyClosingPerBS = num(note.prevTotal)
        rows.push({
          area: `Inventories (Note ${note.num})`,
          check: 'PY Closing Stock (per BS) vs CY Opening Stock (per TB)',
          aLabel: 'PY Closing Stock (as per BS)', bLabel: 'CY Opening Stock (as per TB)',
          cyA: pyClosingPerBS, cyB: cyOpening, cyDiff: pyClosingPerBS - cyOpening,
        })
      }
    }

    // ── 7. Owners'/Partners' Capital Account & Share Capital: PY Closing
    // (per BS) vs Opening Balance entered in Fill Details ──────────────────
    {
      const capNote = findNote(/owners?['’]?\s*capital|partners?['’]?\s*capital/i)
      if (capNote) {
        const det = noteDetails(capNote)
        if (det?.rows) {
          const openingOf = (r) => det.variant === 'llp'
            ? num(r?.contrib?.opening) + num(r?.current?.opening)
            : num(r?.opening)
          const formOpening = det.rows.reduce((s, r) => s + openingOf(r), 0)
          rows.push({
            area: `${capNote.title} (Note ${capNote.num})`,
            check: 'PY Closing Balance (per BS) vs Opening Balance (Fill Details)',
            aLabel: 'PY Closing (as per BS)', bLabel: 'CY Opening (Fill Details)',
            cyA: num(capNote.prevTotal), cyB: formOpening, cyDiff: num(capNote.prevTotal) - formOpening,
          })
        } else {
          rows.push({
            area: `${capNote.title} (Note ${capNote.num})`,
            check: 'PY Closing Balance (per BS) vs Opening Balance (Fill Details)',
            aLabel: 'PY Closing (as per BS)', bLabel: 'CY Opening (Fill Details)',
            cyA: num(capNote.prevTotal), notFilled: true,
          })
        }
      }

      const shareNote = findNote(/share\s*capital/i)
      if (shareNote) {
        const det = noteDetails(shareNote)
        const classes = det?.classes
        if (classes?.length) {
          const formOpening = classes.reduce((s, c) => s + num(c.cy?.openingShares) * num(c.faceValue), 0)
          rows.push({
            area: `${shareNote.title} (Note ${shareNote.num})`,
            check: 'PY Closing Balance (per BS) vs Opening Balance (Fill Details)',
            aLabel: 'PY Closing (as per BS)', bLabel: 'CY Opening (Fill Details)',
            cyA: num(shareNote.prevTotal), cyB: formOpening, cyDiff: num(shareNote.prevTotal) - formOpening,
          })
        }
      }

      // ── 8. Net Profit (P&L) vs Sum of Partners'/Members' Share of Profit
      // (Fill Details) ── For a sole owner (Individual/Proprietorship) the
      // form auto-takes 100% of net profit (see OwnersCapitalAccountForm's
      // plNetProfit sync), so the two can never disagree — only check for
      // Partnership/LLP, where each partner's share is entered manually.
      if (capNote) {
        const det = noteDetails(capNote)
        if (det?.rows && !det.isSingleOwner) {
          const shareOf = (r) => det.variant === 'llp' ? num(r?.current?.shareOfProfit) : num(r?.shareOfProfit)
          const formProfitCY = det.rows.reduce((s, r) => s + shareOf(r), 0)
          const pyShareOf = det.variant === 'llp' ? num(det.pyCurrent?.shareOfProfit) : num(det.py?.shareOfProfit)
          rows.push({
            area: `${capNote.title} (Note ${capNote.num})`,
            check: "Net Profit (P&L) vs Sum of Partners' Share of Profit (Fill Details)",
            aLabel: 'Net Profit (as per P&L)', bLabel: 'Share of Profit (Fill Details)',
            cyA: num(data.netProfit), cyB: formProfitCY, cyDiff: num(data.netProfit) - formProfitCY,
            pyA: num(data.prevNetProfit), pyB: pyShareOf, pyDiff: num(data.prevNetProfit) - pyShareOf,
          })
        }
      }
    }

    // ── 5c. Consolidated view: PPE of ALL branches vs the entity-wide
    // depreciation schedule (Dep (Comp) / Dep (IT) "Consolidated" pill).
    // The schedule is not linked to ledgers, so this is the only place the
    // two are reconciled: sum of every branch's PPE (as per TB) must equal the
    // schedule's closing WDV.
    if (data.consolidatedDep) {
      const ppe = findNote(/property.*plant.*equipment|fixed\s*assets/i)
      const tbCY = num(ppe?.total), tbPY = num(ppe?.prevTotal)
      for (const [label, sch] of [['Dep (Comp) — Companies Act schedule', data.consolidatedDep.comp], ['Dep (IT) — Income-tax blocks', data.consolidatedDep.it]]) {
        if (!sch) continue
        rows.push({
          area: `PPE — all branches${ppe ? ` (Note ${ppe.num})` : ''}`,
          check: `Sum of branches' PPE (TB) vs Consolidated ${label} closing WDV${sch.included ? ' [attached to Note]' : ''}`,
          aLabel: 'As per TB (all branches)', bLabel: 'Closing WDV (consolidated schedule)',
          cyA: tbCY, cyB: sch.close, cyDiff: tbCY - sch.close,
          pyA: tbPY, pyB: sch.open, pyDiff: tbPY - sch.open,
        })
      }
    }

    // ── 8b. GST: every GST balance-sheet ledger presented as ONE net figure ──
    // (see netGstRows in useFinancials.js). Informational: Dr = input credit /
    // cash-ledger balances, Cr = output tax payable; the net decides the side.
    if (data.gstNet) {
      const g = data.gstNet
      rows.push({
        area: 'GST (net)',
        check: `${g.count} GST ledgers netted into one ${g.side} of ${fmtINR(Math.abs(g.net))} (${g.side === 'liability' ? 'Statutory dues payable' : 'Balances with government authorities'})`,
        aLabel: 'Input credit / cash ledger (Dr)', bLabel: 'Output tax payable (Cr)',
        cyA: g.dr, cyB: g.cr, cyDiff: 0,
        pyA: 0, pyB: 0, pyDiff: 0, info: true,
      })
    }

    // ── 9. Consolidation: inter-branch / Head Office accounts must net to zero ──
    // Only present on the virtual Consolidated TB (see eliminateInterBranch in
    // useFinancials.js). Dr side = HO's "Branch X A/c" ledgers, Cr side = the
    // branches' "Head Office A/c" ledgers. A residue means a branch TB is
    // missing or an inter-branch transfer is unposted / in transit; the
    // consolidated Balance Sheet shows ONE net line for it (never each
    // branch's raw figure) while the residue is flagged here for the CA to
    // investigate.
    if (data.interBranch) {
      const ib = data.interBranch
      const byBranch = (ib.byBranch || []).map(b => `${b.branch}: ${fmtINR(b.net)}`).join('; ')
      rows.push({
        area: 'Consolidation',
        check: ib.eliminated
          ? `Inter-branch / Head Office accounts eliminated (${ib.count} ledgers net to zero)`
          : `Inter-branch / Head Office accounts do NOT net to zero — shown as a single net balance on the Balance Sheet (${byBranch})`,
        aLabel: 'Dr balances (branch accounts)', bLabel: 'Cr balances (Head Office accounts)',
        cyA: ib.dr, cyB: ib.cr, cyDiff: ib.dr - ib.cr,
        pyA: 0, pyB: 0, pyDiff: 0,
      })
    }

    // ── 10. Categorisation: a Level 2 heading from the other statement ──────
    // e.g. a ledger under "Purchases of Stock-in-Trade" whose Level 2 is still
    // "Short-term loans and advances". The statements already leave that
    // heading out (see ignoreForeignLevel2 in useFinancials.js); the ledger is
    // listed here — and in the Rectification queue — until it is corrected.
    for (const f of data.foreignLevel2 || []) {
      rows.push({
        area: `Categorisation — ${f.ledger}${f.branch ? ` (${f.branch})` : ''}`,
        check: `Under ${f.statement} head "${f.level1}", but its Level 2 "${f.level2}" is a ${f.otherStatement} heading. Shown under "${f.level1}" without that heading; set the right Level 2 in Rectification / Recategorisation`,
        aLabel: 'Ledger balance', bLabel: 'Correctly categorised',
        cyA: num(f.cy), cyB: 0, cyDiff: num(f.cy),
        pyA: num(f.py), pyB: 0, pyDiff: num(f.py),
      })
    }

    return rows
  }, [data, noteDetails, prevTB, stockCheck, adjSummary, taxComp, defTax, entity, activeTB?.period])

  const issueCount = exceptions.filter(r => !r.notFilled && (!isZero(r.cyDiff) || !isZero(r.pyDiff))).length
  const period = activeTB?.period || ''

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Guard activeTB={activeTB} loading={loading} error={error}>
        <div className="flex items-center gap-3 px-5 py-3 border-b border-blue-100 shrink-0 bg-white flex-wrap">
          <div>
            <h2 className="font-bold text-blue-900 text-sm">Exception Report</h2>
            {entity && <p className="text-xs text-gray-500">{entity.name}{period ? ` | ${period}` : ''}</p>}
          </div>
          <div className="ml-auto flex items-center gap-3">
            <PYTBSelector entity={entity} currentTBId={activeTB?.id} prevTB={prevTB} onChange={onPrevTBChange} />
            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
              issueCount === 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
            }`}>
              {issueCount === 0 ? '✓ No differences' : `${issueCount} difference${issueCount > 1 ? 's' : ''} found`}
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <p className="text-xs text-gray-500 mb-4">
            All Check variances at one place. Green means the figures agree; red shows the difference to be resolved.
            "Not filled" means the related Fill Details / Depreciation data has not been entered yet.
          </p>

          <div className="border border-blue-100 rounded-lg overflow-hidden shadow-sm">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-blue-800 text-white">
                  <th rowSpan={2} className="text-left py-2 px-4 font-semibold align-bottom w-[24%]">Area</th>
                  <th colSpan={3} className="text-center py-1.5 px-3 font-semibold border-b border-blue-600">Current Year</th>
                  <th colSpan={3} className="text-center py-1.5 px-3 font-semibold border-b border-blue-600 border-l border-l-blue-600">Previous Year</th>
                </tr>
                <tr className="bg-blue-800 text-white">
                  <th className="text-right py-1.5 px-3 font-medium">Amount A</th>
                  <th className="text-right py-1.5 px-3 font-medium">Amount B</th>
                  <th className="text-right py-1.5 px-3 font-medium">Difference</th>
                  <th className="text-right py-1.5 px-3 font-medium border-l border-l-blue-600">Amount A</th>
                  <th className="text-right py-1.5 px-3 font-medium">Amount B</th>
                  <th className="text-right py-1.5 px-3 font-medium">Difference</th>
                </tr>
              </thead>
              <tbody>
                {exceptions.map((r, i) => (
                  <tr key={i} className={`border-b border-gray-100 ${
                    r.notFilled ? 'bg-gray-50/50' : (!isZero(r.cyDiff) || !isZero(r.pyDiff)) ? 'bg-red-50/50' : 'bg-green-50/30'
                  }`}>
                    <td className="py-1.5 px-4">
                      <div className="font-semibold text-gray-800">{r.area}</div>
                      <div className="text-[10px] text-gray-500">{r.check} <span className="text-gray-400">(A = {r.aLabel}, B = {r.bLabel})</span></div>
                    </td>
                    <AmtCell value={r.cyA} />
                    <AmtCell value={r.cyB} notFilled={r.notFilled} />
                    <DiffCell value={r.cyDiff} notFilled={r.notFilled} />
                    <AmtCell value={r.pyA} />
                    <AmtCell value={r.pyB} notFilled={r.notFilled} />
                    <DiffCell value={r.pyDiff} notFilled={r.notFilled} />
                  </tr>
                ))}
                {exceptions.length === 0 && (
                  <tr><td colSpan={7} className="py-6 text-center text-gray-400">No checkable areas found. Run mapping first.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Guard>
    </div>
  )
}
