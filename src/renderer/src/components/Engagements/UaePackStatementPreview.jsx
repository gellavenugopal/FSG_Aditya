import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { buildStatementPreview, compareWithReference, REFERENCE_2024 } from '../../../../shared/uae-pack-statement-preview.mjs'

const money = value => Number(value || 0).toLocaleString('en-AE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

function LineRow({ line, open, onToggle }) {
  return <>
    <tr className="border-t">
      <td className="py-1.5 pr-2">
        {line.members.length
          ? <button type="button" className="text-left text-indigo-700 hover:underline" aria-expanded={open} onClick={onToggle}>{open ? '▾' : '▸'} {line.label}</button>
          : <span className="text-gray-400">{line.label}</span>}
        {line.members.length > 0 && <span className="ml-2 text-[11px] text-gray-500">{line.members.length} ledger{line.members.length === 1 ? '' : 's'}{line.suggestedCount ? ` · ${line.suggestedCount} suggested` : ''}{line.confirmedCount ? ` · ${line.confirmedCount} confirmed` : ''}</span>}
      </td>
      <td className="py-1.5 text-right tabular-nums">{line.members.length ? money(line.amount) : '–'}</td>
    </tr>
    {open && <tr><td colSpan={2} className="bg-gray-50 px-2 pb-2">
      <table className="w-full text-[11px]">
        <thead><tr className="text-left text-gray-500"><th className="py-1">Code</th><th>Ledger</th><th className="text-right">Final TB balance (Cr +, Dr -)</th><th className="pl-3">Mapping status</th></tr></thead>
        <tbody>{line.members.map(row => <tr key={row.id} className="border-t border-gray-200">
          <td className="py-0.5 pr-2 font-mono">{row.code || '(no code)'}</td>
          <td className="pr-2">{row.name}</td>
          <td className="text-right tabular-nums">{money(row.balance)}</td>
          <td className="pl-3">{row.basis === 'confirmed' ? <span className="rounded bg-green-100 px-1.5 text-green-800">Confirmed (saved mapping)</span> : <span className="rounded bg-amber-100 px-1.5 text-amber-900">Suggested - not confirmed</span>}</td>
        </tr>)}</tbody>
      </table>
    </td></tr>}
  </>
}

function Section({ title, lines, total, totalLabel, openKeys, toggle, derived }) {
  return <div className="mb-3">
    <div className="text-xs font-semibold uppercase tracking-wide text-gray-600">{title}</div>
    <table className="w-full text-sm"><tbody>
      {lines.map(line => <LineRow key={line.key} line={line} open={openKeys.has(line.key)} onToggle={() => toggle(line.key)} />)}
      {derived && <tr className="border-t bg-indigo-50/50" data-testid="bs-derived-profit"><td className="py-1.5 pr-2">{derived.label} <span className="text-[11px] text-gray-600">(derived from the P&amp;L lines, not a ledger or a mapping)</span></td><td className="py-1.5 text-right tabular-nums">{money(derived.amount)}</td></tr>}
      {total !== undefined && <tr className="border-t-2 font-semibold"><td className="py-1.5">{totalLabel} <span className="text-[11px] font-normal text-amber-800">(provisional)</span></td><td className="py-1.5 text-right tabular-nums">{money(total)}</td></tr>}
    </tbody></table>
  </div>
}

export default function UaePackStatementPreview({ engagement, trialBalanceId, view }) {
  const [review, setReview] = useState(null)
  const [error, setError] = useState('')
  const [openKeys, setOpenKeys] = useState(new Set())

  const load = useCallback(async () => {
    if (!engagement?.id || !trialBalanceId) return
    try {
      setError('')
      setReview(await window.api.getEngagementPackMappingReview({ engagementId: engagement.id, trialBalanceId: Number(trialBalanceId) }))
    } catch (err) {
      setReview(null)
      setError(err.message || String(err))
    }
  }, [engagement?.id, trialBalanceId])
  useEffect(() => { load() }, [load])

  const preview = useMemo(() => (review ? buildStatementPreview(review) : null), [review])
  const comparison = useMemo(() => (preview ? compareWithReference(preview).filter(item => item.statement === (view === 'profit' ? 'PL' : 'SFP')) : []), [preview, view])
  const toggle = key => setOpenKeys(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next })

  if (error) return <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>
  if (!preview) return <p className="text-sm text-gray-500">Loading the provisional statement preview…</p>
  const { totals, coverage, exceptions } = preview
  const isPL = view === 'profit'
  const sectionsOf = statement => [...preview.sections[statement].entries()]
  const periodStart = engagement.period_start || engagement.periodStart
  const periodEnd = engagement.period_end || engagement.periodEnd
  const periodText = periodEnd ? `${periodStart ? String(periodStart).slice(0, 10) + ' to ' : 'year ended '}${String(periodEnd).slice(0, 10)}` : engagement.period_label || 'period not set'

  return <div data-testid="uae-pack-statement-preview" className="space-y-4">
    <div className="rounded-lg border-2 border-amber-400 bg-amber-50 p-3 text-sm text-amber-950">
      <div className="font-semibold">PROVISIONAL PREVIEW - not reviewed, not confirmed, not for issue</div>
      <p className="mt-1 text-xs">Calculated from the saved final Trial Balance and the draft pack using {coverage.suggestedCount} suggested and {coverage.confirmedCount} confirmed ledger mappings. Suggestions are not saved or confirmed by this screen; a saved manual or accepted mapping always takes precedence. {coverage.unresolvedCount} unresolved accounts are excluded and shown below, so every total may be incomplete. No comparative figures are shown until a prior-year comparative is verified.</p>
    </div>
    <dl className="grid gap-x-6 gap-y-1 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
      <div><dt className="inline font-semibold">Engagement: </dt><dd className="inline">{engagement.name}{engagement.reference ? ` (${engagement.reference})` : ''}</dd></div>
      <div><dt className="inline font-semibold">Reporting period: </dt><dd className="inline">{periodText}</dd></div>
      <div><dt className="inline font-semibold">Currency: </dt><dd className="inline">AED (assumed - unconfirmed)</dd></div>
      <div><dt className="inline font-semibold">Final TB: </dt><dd className="inline">version {review.finalVersion} (TB #{review.trialBalanceId})</dd></div>
      <div><dt className="inline font-semibold">Reporting pack: </dt><dd className="inline">{review.pack.id} v{review.pack.version} ({review.pack.status})</dd></div>
      <div><dt className="inline font-semibold">Comparatives: </dt><dd className="inline">none - not verified</dd></div>
    </dl>
    <ul className="space-y-1 rounded-lg border border-gray-200 p-3 text-xs text-gray-700">
      {review.pack.metadata.filter(item => !item.confirmed).map(item => <li key={item.key}><strong>Unconfirmed - {item.label}:</strong> {item.value}</li>)}
    </ul>

    {!isPL && <section className="rounded-lg border border-gray-200 bg-white p-4" aria-label="Provisional statement of financial position">
      <h4 className="font-semibold text-gray-900">Statement of financial position - provisional, potentially incomplete</h4>
      <p className="mb-2 text-xs text-gray-500">AED, {periodText}. Select a line to inspect its ledgers.</p>
      {sectionsOf('SFP').map(([title, lines]) => <Section key={title} title={title} lines={lines} openKeys={openKeys} toggle={toggle}
        derived={title === 'Equity' ? { label: 'Profit / (loss) for the year (provisional)', amount: totals.profit } : undefined}
        total={title === 'Non-current assets' ? totals.totalNonCurrent : title === 'Current assets' ? totals.totalCurrent : title === 'Equity' ? totals.totalEquity : totals.totalLiabilities}
        totalLabel={`Total ${title.toLowerCase()}`} />)}
      <table className="w-full text-sm"><tbody>
        <tr className="border-t-2 font-semibold"><td className="py-1">Total assets (provisional)</td><td className="py-1 text-right tabular-nums">{money(totals.totalAssets)}</td></tr>
        <tr className="font-semibold"><td className="py-1">Total equity and liabilities (provisional)</td><td className="py-1 text-right tabular-nums">{money(totals.totalEquityAndLiabilities)}</td></tr>
        <tr className={Math.abs(totals.difference) < 0.005 ? 'text-green-800' : 'font-semibold text-red-700'} data-testid="bs-difference"><td className="py-1">Balance Sheet difference (assets less equity and liabilities)</td><td className="py-1 text-right tabular-nums">{money(totals.difference)}</td></tr>
      </tbody></table>
      <p className="mt-2 rounded bg-gray-50 p-2 text-xs text-gray-700">The source Trial Balance net is {money(preview.tbNet)}. The final TB is pre-closing: Retained earnings b/fwd holds only the opening balance, so the P&amp;L profit of {money(totals.profit)} is added to equity once (it is not in any ledger). The remaining difference equals the net of the {coverage.unresolvedCount} unresolved accounts ({money(coverage.unresolvedNet)}) that are excluded; this explains the difference but does not reconcile it. Nothing has been inserted to balance it.</p>
    </section>}

    {isPL && <section className="rounded-lg border border-gray-200 bg-white p-4" aria-label="Provisional statement of profit or loss">
      <h4 className="font-semibold text-gray-900">Statement of profit or loss - provisional, potentially incomplete</h4>
      <p className="mb-2 text-xs text-gray-500">AED, {periodText}. Income positive, costs negative. Select a line to inspect its ledgers.</p>
      {sectionsOf('PL').map(([title, lines]) => <Section key={title} title={title} lines={lines} openKeys={openKeys} toggle={toggle} />)}
      <table className="w-full text-sm"><tbody><tr className="border-t-2 font-semibold" data-testid="pl-profit"><td className="py-1">Profit / (loss) for the year (provisional, potentially incomplete)</td><td className="py-1 text-right tabular-nums">{money(totals.profit)}</td></tr></tbody></table>
      <p className="mt-2 rounded bg-gray-50 p-2 text-xs text-gray-700">No gross profit or operating subtotals are shown: this draft pack does not yet define them, and unresolved cost ledgers could change them. The two documented AED 1 rounding differences remain unresolved.</p>
    </section>}

    <section className="rounded-lg border border-red-300 bg-red-50 p-4" aria-label="Unresolved accounts" data-testid="unresolved-exceptions">
      <h4 className="font-semibold text-red-900">Exceptions - {coverage.unresolvedCount} unresolved accounts excluded from both statements</h4>
      <p className="mt-1 text-xs text-red-900">Signed net {money(coverage.unresolvedNet)} · Sum of absolute balances {money(coverage.unresolvedAbsolute)} of {money(coverage.totalAbsolute)} total ({coverage.unresolvedAbsolutePercent}% by absolute value). Not forced into any line.</p>
      <table className="mt-2 w-full text-xs"><thead><tr className="text-left text-red-800"><th>Code</th><th>Ledger</th><th className="text-right">Balance (Cr +, Dr -)</th><th className="pl-3">Reason</th></tr></thead>
        <tbody>{exceptions.map(row => <tr key={row.id} className="border-t border-red-200"><td className="py-0.5 pr-2 font-mono">{row.code || '(no code)'}</td><td className="pr-2">{row.name}</td><td className="text-right tabular-nums">{money(row.balance)}</td><td className="pl-3">{row.issue || row.status}</td></tr>)}</tbody></table>
    </section>

    <section className="rounded-lg border border-gray-200 bg-white p-4" aria-label="Calculation checks">
      <h4 className="font-semibold text-gray-900">Calculation checks (omitted / double-counted accounts)</h4>
      <ul className="mt-1 space-y-1 text-xs">{preview.checks.map(check => <li key={check.label} className={check.passed ? 'text-green-800' : 'font-semibold text-red-700'}>{check.passed ? 'Passed' : 'FAILED'} - {check.label} <span className="text-gray-500">({check.detail})</span></li>)}</ul>
    </section>

    <section className="rounded-lg border border-indigo-200 bg-white p-4" aria-label="Reference validation evidence" data-testid="reference-validation">
      <h4 className="font-semibold text-gray-900">Reference comparison - validation evidence only</h4>
      <p className="text-xs text-gray-500">{REFERENCE_2024.source}. Calculated figures above are never adjusted to these values.</p>
      <table className="mt-2 w-full text-xs"><thead><tr className="text-left text-gray-500"><th>Caption</th><th className="text-right">Calculated (provisional)</th><th className="text-right">Reference 2024</th><th className="text-right">Difference</th><th className="pl-3">Explanation</th></tr></thead>
        <tbody>{comparison.map(item => <tr key={item.label} className="border-t align-top">
          <td className="py-1 pr-2">{item.label}</td>
          <td className="text-right tabular-nums">{item.populated ? money(item.calculated) : 'no mapped ledgers'}</td>
          <td className="text-right tabular-nums">{money(item.reference)}</td>
          <td className={`text-right tabular-nums ${Math.abs(item.difference) < 0.005 ? 'text-green-800' : 'font-semibold text-red-700'}`}>{Math.abs(item.difference) < 0.005 ? 'agrees' : money(item.difference)}</td>
          <td className="pl-3 text-gray-700">{Math.abs(item.difference) < 0.005 ? '' : (item.note || 'Not explained yet: the mapping is a suggestion or the account classification differs from the reference caption. Investigate before reliance.')}</td>
        </tr>)}</tbody></table>
      {!isPL && <p className="mt-2 text-[11px] text-gray-500">Not compared: {REFERENCE_2024.notCompared.join(' ')}</p>}
    </section>
  </div>
}
