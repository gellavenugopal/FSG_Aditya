import React, { useCallback, useEffect, useMemo, useState } from 'react'

const money = value => Number(value || 0).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const STATUS_STYLE = {
  confirmed: 'bg-green-100 text-green-800',
  suggested: 'bg-amber-100 text-amber-900',
  unresolved: 'bg-red-100 text-red-800',
  conflict: 'bg-red-100 text-red-800',
}
const STATUS_LABEL = {
  confirmed: 'Confirmed',
  suggested: 'Suggested - needs review',
  unresolved: 'Unresolved',
  conflict: 'Conflict',
}

function CoverageCard({ title, hint, value, tone }) {
  return <div className={`rounded-md border p-3 ${tone}`}>
    <div className="text-xs font-semibold">{title}</div>
    <div className="mt-1 text-lg font-semibold">{value.count} accounts</div>
    <div className="text-xs">Signed net {money(value.signedNet)} · Sum of absolute {money(value.absoluteTotal)}</div>
    <div className="mt-1 text-[11px] opacity-80">{hint}</div>
  </div>
}

export default function UaePackMappingReview({ engagementId, trialBalanceId, canEdit = true }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [filter, setFilter] = useState('open')
  const [search, setSearch] = useState('')
  const [picks, setPicks] = useState({})

  const load = useCallback(async () => {
    if (!engagementId || !trialBalanceId) return
    try {
      setError('')
      setData(await window.api.getEngagementPackMappingReview({ engagementId, trialBalanceId: Number(trialBalanceId) }))
    } catch (err) {
      setData(null)
      setError(err.message || String(err))
    }
  }, [engagementId, trialBalanceId])

  useEffect(() => { load() }, [load])

  const lineLabel = useMemo(() => new Map((data?.pack?.lines || []).map(line => [line.key, line.label])), [data])

  const save = async (row, lineKey, basis) => {
    setBusyId(row.id)
    try {
      setError('')
      await window.api.saveEngagementPackMappingReview({ engagementId, trialBalanceId: Number(trialBalanceId), tbRowId: row.id, lineKey, basis })
      setPicks(current => { const next = { ...current }; delete next[row.id]; return next })
      await load()
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setBusyId(null)
    }
  }

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return (data?.rows || []).filter(row => {
      if (filter === 'open' && row.status === 'confirmed') return false
      if (filter !== 'open' && filter !== 'all' && row.status !== filter) return false
      return !needle || `${row.code} ${row.name}`.toLowerCase().includes(needle)
    })
  }, [data, filter, search])

  return <section className="mb-4 rounded-lg border border-indigo-200 bg-white p-4" data-testid="uae-pack-mapping-review">
    <h4 className="font-semibold text-gray-900">UAE separate financial statements - mapping review (draft pack {data?.pack?.version || ''})</h4>
    <p className="mt-1 text-xs text-gray-600">
      Source: saved final Trial Balance{data ? ` v${data.finalVersion}` : ''} - balances are read, never changed. Suggestions come from exact account-code matches
      in the supplied reference workbook, whose classifications are for a later year (2025) and are proposals only. A suggestion is not a confirmed mapping and
      suggestion coverage is not mapping accuracy. Reference statement totals are never used as balancing inputs.
    </p>
    {error && <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-800" role="alert">{error}</p>}
    {data && <>
      <div className="mt-3 grid gap-2 md:grid-cols-3">
        <CoverageCard title="Unresolved (no usable suggestion)" value={data.coverage.unresolved} tone="border-red-200 bg-red-50 text-red-900" hint="Non-zero accounts with no mapping, no suggestion or a conflict." />
        <CoverageCard title="Suggested, awaiting review" value={data.coverage.suggestedAwaitingReview} tone="border-amber-200 bg-amber-50 text-amber-900" hint="Proposals only; not yet confirmed." />
        <CoverageCard title="Confirmed by a reviewer" value={data.coverage.confirmed} tone="border-green-200 bg-green-50 text-green-900" hint="Saved manual or accepted mappings." />
      </div>
      <p className="mt-2 text-xs text-gray-500">{data.rows.length} non-zero accounts · {data.zeroBalanceAccounts} zero-balance accounts excluded · {data.referenceRowCount} reference classification rows loaded.{data.referenceRowCount === 0 ? ' No reference classifications have been imported for this engagement.' : ''}</p>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
          <div className="text-xs font-semibold text-amber-900">Unresolved validation items (not balancing inputs)</div>
          <ul className="mt-1 space-y-1 text-xs text-amber-900">{data.pack.validationItems.map(item => <li key={item.key}><strong>{item.title}</strong> - <em>{item.status}</em>. {item.detail}</li>)}</ul>
        </div>
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
          <div className="text-xs font-semibold text-gray-800">Unconfirmed metadata assumptions</div>
          <ul className="mt-1 space-y-1 text-xs text-gray-700">{data.pack.metadata.map(item => <li key={item.key}><strong>{item.label}:</strong> {item.value} <em>({item.confirmed ? 'confirmed' : 'unconfirmed'})</em></li>)}</ul>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <label>Show <select value={filter} onChange={event => setFilter(event.target.value)} className="rounded border border-gray-300 px-2 py-1">
          <option value="open">Needs review (not confirmed)</option>
          <option value="unresolved">Unresolved</option>
          <option value="conflict">Conflicts</option>
          <option value="suggested">Suggested</option>
          <option value="confirmed">Confirmed</option>
          <option value="all">All</option>
        </select></label>
        <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search code or description" className="rounded border border-gray-300 px-2 py-1" />
        <span className="text-gray-500">{visible.length} shown</span>
      </div>
      <div className="mt-2 max-h-96 overflow-auto rounded border">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-gray-50"><tr>
            <th className="p-2">Code</th><th className="p-2">Description</th><th className="p-2 text-right">Balance</th>
            <th className="p-2">Statement line</th><th className="p-2">Classification source</th><th className="p-2">Status</th><th className="p-2">Review</th>
          </tr></thead>
          <tbody className="divide-y">{visible.map(row => {
            const current = row.lineKey || row.suggestedLineKey
            const chosen = picks[row.id] ?? ''
            return <tr key={row.id} className="align-top">
              <td className="p-2 whitespace-nowrap">{row.code}</td>
              <td className="p-2">{row.name}</td>
              <td className="p-2 text-right whitespace-nowrap">{money(row.balance)}</td>
              <td className="p-2">{current ? lineLabel.get(current) : <span className="text-gray-400">-</span>}
                {row.lineKey && row.suggestedLineKey && row.lineKey !== row.suggestedLineKey && <div className="text-[11px] text-amber-700">Reference proposes: {lineLabel.get(row.suggestedLineKey)}</div>}</td>
              <td className="p-2">{row.references.length
                ? row.references.map((ref, index) => <div key={index}>{ref.sourceLabel} ({ref.sourceYear}, proposal): {ref.main || '-'}{ref.sub ? ` / ${ref.sub}` : ''}{ref.clientMapping ? ` [client: ${ref.clientMapping}]` : ''}</div>)
                : <span className="text-gray-400">None</span>}
                {row.duplicate && <div className="text-[11px] text-red-700">Duplicate code in reference</div>}
                {row.issue && <div className="text-[11px] text-red-700">{row.issue}</div>}
              </td>
              <td className="p-2"><span className={`rounded px-1.5 py-0.5 ${STATUS_STYLE[row.status]}`}>{STATUS_LABEL[row.status]}</span>
                {row.basis && <div className="text-[11px] text-gray-500">{row.basis === 'manual' ? 'Manual' : 'Accepted suggestion'}</div>}</td>
              <td className="p-2 whitespace-nowrap">
                {canEdit && <div className="flex flex-col gap-1">
                  {!row.lineKey && row.suggestedLineKey && <button type="button" disabled={busyId === row.id} onClick={() => save(row, row.suggestedLineKey, 'accepted_suggestion')} className="rounded border border-green-600 px-2 py-0.5 text-green-700">Accept suggestion</button>}
                  <select value={chosen} onChange={event => setPicks(c => ({ ...c, [row.id]: event.target.value }))} className="max-w-[14rem] rounded border border-gray-300 px-1 py-0.5" aria-label={`Manual line for ${row.code}`}>
                    <option value="">Choose line...</option>
                    {data.pack.lines.map(line => <option key={line.key} value={line.key}>{line.label}</option>)}
                  </select>
                  <button type="button" disabled={!chosen || busyId === row.id} onClick={() => save(row, chosen, 'manual')} className="rounded border border-indigo-600 px-2 py-0.5 text-indigo-700 disabled:opacity-40">Save manual mapping</button>
                </div>}
              </td>
            </tr>
          })}</tbody>
        </table>
      </div>
    </>}
  </section>
}
