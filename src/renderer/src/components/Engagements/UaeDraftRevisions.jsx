import React, { useCallback, useEffect, useState } from 'react'
import { formatAmount } from '../../../../shared/uae-draft-report-model.mjs'

const FORMATS = [['pdf', 'PDF', 'application/pdf'], ['docx', 'Word', ''], ['xlsx', 'Excel', '']]

function StatementTable({ title, rows, testId }) {
  return <section aria-label={title} data-testid={testId} className="rounded-lg border border-gray-200 bg-white p-3">
    <h5 className="font-semibold text-gray-900">{title}</h5>
    <table className="mt-1 w-full text-sm"><tbody>
      {rows.map((row, index) => {
        if (row.kind === 'section') return <tr key={index} className="bg-gray-100"><td colSpan={2} className="px-1 py-1 text-xs font-semibold uppercase text-gray-600">{row.label}</td></tr>
        const placeholder = row.kind === 'placeholder'
        return <tr key={index} data-kind={row.kind} className={`border-t ${placeholder ? 'bg-red-50 font-semibold text-red-800' : row.kind === 'total' || row.kind === 'difference' ? 'font-semibold' : ''}`}>
          <td className="px-1 py-1">
            {row.label}
            {placeholder && <span className="ml-2 rounded bg-red-700 px-1.5 text-[11px] text-white">{row.badge}</span>}
            {row.accounts && <span className="ml-2 text-[11px] font-normal text-gray-500">{row.accounts.length} ledger{row.accounts.length === 1 ? '' : 's'}</span>}
            {row.accounts?.length > 0 && <details className="text-[11px] font-normal text-gray-700">
              <summary className="cursor-pointer">Contributing ledgers</summary>
              <table className="mt-1 w-full"><tbody>{row.accounts.map(account => <tr key={account.id} className="border-t border-gray-200">
                <td className="pr-2 font-mono">{account.code || '(no code)'}</td><td className="pr-2">{account.name}</td>
                <td className="pr-2 text-right tabular-nums">{formatAmount(account.balance)}</td><td>{account.source}</td>
              </tr>)}</tbody></table>
            </details>}
          </td>
          <td className="px-1 py-1 text-right tabular-nums align-top">{formatAmount(row.amount)}</td>
        </tr>
      })}
    </tbody></table>
  </section>
}

// Read-only view of a saved revision: rendered only from the stored model, never recalculated.
function SavedRevisionView({ revision, onClose }) {
  const { model } = revision
  return <div data-testid="draft-saved-view" className="mt-3 space-y-3 rounded-lg border-2 border-indigo-300 bg-indigo-50/40 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="text-sm font-semibold text-indigo-950">Saved draft revision {revision.revision} (reopened from saved source; later mapping or wording changes do not alter it)</div>
      <button type="button" onClick={onClose} className="rounded border border-indigo-300 bg-white px-2 py-1 text-xs">Close revision view</button>
    </div>
    <div className="rounded border-2 border-amber-400 bg-amber-50 p-2 text-xs text-amber-950">{model.warnings.map((warning, index) => <div key={index} className={index === 0 || warning.startsWith('ACTION') ? 'font-semibold' : ''}>{warning}</div>)}</div>
    <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2" data-testid="draft-saved-identity">
      <div><dt className="inline font-semibold">Engagement: </dt><dd className="inline">{model.identity.name} ({model.identity.reference})</dd></div>
      <div><dt className="inline font-semibold">Period: </dt><dd className="inline">{model.identity.periodStart ? `${model.identity.periodStart} to ` : 'year ended '}{model.identity.periodEnd}</dd></div>
      <div><dt className="inline font-semibold">Currency: </dt><dd className="inline">{model.identity.currencyNote}</dd></div>
      <div><dt className="inline font-semibold">Final TB: </dt><dd className="inline">version {model.source.finalTbVersion} (TB #{model.source.trialBalanceId})</dd></div>
      <div><dt className="inline font-semibold">Reporting pack: </dt><dd className="inline">{model.source.packId} v{model.source.packVersion} ({model.source.packStatus})</dd></div>
      <div><dt className="inline font-semibold">Model hash: </dt><dd className="inline font-mono">{revision.modelSha256.slice(0, 16)}…</dd></div>
    </dl>
    <StatementTable title="Statement of financial position (saved)" rows={model.sfp} testId="draft-saved-sfp" />
    <StatementTable title="Statement of profit or loss (saved)" rows={model.pl} testId="draft-saved-pl" />
    <section className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-900" data-testid="draft-saved-unresolved">
      <div className="font-semibold">Action required - {model.coverage.unresolvedCount} accounts awaiting classification (net {formatAmount(model.coverage.unresolvedNet)}; {formatAmount(model.coverage.unresolvedAbsolute)} of {formatAmount(model.coverage.totalAbsolute)} absolute)</div>
    </section>
    <section className="rounded border border-gray-200 bg-white p-2 text-xs">
      <div className="font-semibold">Pending - not in this draft</div>
      <ul className="list-disc pl-4">{model.pending.map(item => <li key={item.item}><strong>{item.item}:</strong> {item.status}. {item.detail}</li>)}</ul>
    </section>
  </div>
}

export default function UaeDraftRevisions({ engagement, trialBalanceId, editable, onStatus = () => {}, showGenerate = true }) {
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [viewing, setViewing] = useState(null)

  const load = useCallback(async () => {
    try {
      const result = await window.api.listEngagementDraftRevisions({ engagementId: engagement.id })
      setData(result)
      onStatus(result)
    } catch (err) {
      setError(err.message || String(err))
    }
  }, [engagement.id, onStatus])
  useEffect(() => { load() }, [load])

  const run = async task => {
    setBusy(true); setError(''); setMessage('')
    try { await task() } catch (err) { setError(err.message || String(err)) } finally { setBusy(false) }
  }

  const generate = () => run(async () => {
    const prepared = await window.api.prepareEngagementDraftReport({ engagementId: engagement.id, trialBalanceId: Number(trialBalanceId) })
    const files = await window.api.buildEngagementDraftFiles(prepared.model)
    const saved = await window.api.saveEngagementDraftRevision({
      engagementId: engagement.id, trialBalanceId: Number(trialBalanceId), modelSha256: prepared.modelSha256, ...files,
    })
    setMessage(`Draft revision ${saved.revision} saved (PDF, Word and Excel from one calculation, hash ${saved.modelSha256.slice(0, 12)}…). Earlier revisions are kept.`)
    await load()
  })

  const open = revision => run(async () => {
    setViewing(await window.api.readEngagementDraftRevision({ revisionId: revision.id }))
  })

  const download = (revision, format) => run(async () => {
    const result = await window.api.readEngagementDraftRevision({ revisionId: revision.id, format })
    const saved = await window.api.saveEngagementDraftFile({
      format, contentBase64: result.fileBase64,
      defaultName: `${engagement.reference || 'engagement'}-draft-r${revision.revision}.${format}`,
    })
    if (!saved.cancelled) setMessage(`Saved draft revision ${revision.revision} ${format.toUpperCase()} to ${saved.filePath}.`)
  })

  if (!data) return error ? <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null
  return <section data-testid="draft-revisions" className="mt-4 rounded-lg border border-indigo-200 bg-white p-4">
    <h4 className="font-semibold text-gray-900">Draft reporting revisions · separate-FS pack</h4>
    <p className="mt-1 text-xs text-gray-600">PDF, Word and Excel are generated from one calculation of the saved final TB and the current mapping state, with the red unclassified lines, account detail and provisional warnings. Each revision keeps its source so it can be reopened exactly; earlier revisions are never replaced. Comparatives, cash flow, changes in equity, notes, policies and the audit report are pending and are listed as such.</p>
    {error && <p role="alert" className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">{error}</p>}
    {message && <p role="status" className="mt-2 rounded bg-green-50 p-2 text-xs text-green-800">{message}</p>}
    {showGenerate && <div className="mt-3 flex flex-wrap items-center gap-2">
      <button type="button" data-testid="draft-generate" disabled={busy || !editable || !trialBalanceId} onClick={generate}
        className="rounded-md bg-[var(--color-primary)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy ? 'Working…' : 'Generate draft revision (PDF, Word, Excel)'}</button>
      {!editable && <span className="text-xs text-gray-500">Read-only: you cannot create revisions for this engagement.</span>}
    </div>}
    <div className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-900" data-testid="draft-finalisation-blockers">
      <div className="font-semibold">Finalisation blocked</div>
      <ul className="list-disc pl-4">{data.finalisationBlockers.map((item, index) => <li key={index}>{item}</li>)}</ul>
    </div>
    {!data.revisions.length && <p className="mt-3 text-xs text-gray-600">No draft revision has been saved yet.</p>}
    <div className="mt-3 divide-y">
      {data.revisions.map(revision => <div key={revision.id} data-testid={`draft-revision-${revision.revision}`} className="flex flex-wrap items-center gap-2 py-2">
        <div className="min-w-[240px] flex-1 text-sm">
          <span className="font-medium">Revision {revision.revision}</span>
          <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900">Draft · provisional</span>
          <div className="text-xs text-gray-500">Final TB v{revision.finalTbVersion} · {revision.packId} v{revision.packVersion} · {revision.unresolvedCount} unclassified · hash {revision.modelSha256.slice(0, 12)}… · {revision.createdByName} · {new Date(revision.createdAt).toLocaleString()}</div>
        </div>
        <button type="button" disabled={busy} onClick={() => open(revision)} data-testid={`draft-view-${revision.revision}`} className="rounded-md border border-indigo-300 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-900 disabled:opacity-40">View saved</button>
        {FORMATS.map(([format, label]) => <button key={format} type="button" disabled={busy} onClick={() => download(revision, format)} data-testid={`draft-download-${revision.revision}-${format}`} className="rounded-md border px-2.5 py-1 text-xs disabled:opacity-40">Download {label}</button>)}
      </div>)}
    </div>
    {viewing && <SavedRevisionView revision={viewing} onClose={() => setViewing(null)} />}
  </section>
}
