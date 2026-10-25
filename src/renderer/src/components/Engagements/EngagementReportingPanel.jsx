import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { buildEngagementFinancials } from '../../hooks/useFinancials'
import { buildFinancialsHTML } from '../GenerateFinancials/buildHTML'
import { formatPeriodDate, formatPeriodRange } from '../../utils/financialPeriodDisplay'
import { makeAuditReportPage, prependAuditReport } from './engagementReportHtml'

const EMPTY_ENTRY = () => ({ ledgerName: '', ledgerCode: '', side: 'Dr', amount: '' })
const EMPTY_FIELDS = {
  addressee: '',
  opinion: '',
  basisForOpinion: '',
  managementResponsibilities: '',
  auditorResponsibilities: '',
  otherMatters: '',
  reportDate: '',
  reportPlace: '',
  firmName: '',
  firmAddress: '',
  firmRegistrationNumber: '',
  auditorName: '',
  auditorMembershipNumber: '',
  auditorDesignation: '',
}

function bytesToBase64(bytes) {
  const chunkSize = 0x8000
  let binary = ''
  for (let start = 0; start < bytes.length; start += chunkSize) {
    const chunk = bytes.subarray(start, Math.min(start + chunkSize, bytes.length))
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

function Input({ label, value, onChange, ...props }) {
  return <label className="block">
    <span className="mb-1 block text-xs font-medium text-gray-700">{label}</span>
    <input {...props} value={value} onChange={event => onChange(event.target.value)}
      className="w-full rounded-md border border-gray-300 px-2.5 py-2 text-sm focus:border-blue-500 focus:outline-none" />
  </label>
}

function TextArea({ label, value, onChange, rows = 3 }) {
  return <label className="block">
    <span className="mb-1 block text-xs font-medium text-gray-700">{label}</span>
    <textarea value={value} rows={rows} onChange={event => onChange(event.target.value)}
      className="w-full rounded-md border border-gray-300 px-2.5 py-2 text-sm focus:border-blue-500 focus:outline-none" />
  </label>
}

export default function EngagementReportingPanel({ engagement, user }) {
  const [trialBalances, setTrialBalances] = useState([])
  const [sourceId, setSourceId] = useState('')
  const [snapshots, setSnapshots] = useState([])
  const [finalId, setFinalId] = useState('')
  const [journals, setJournals] = useState([])
  const [outputs, setOutputs] = useState([])
  const [bundle, setBundle] = useState(null)
  const [finalRows, setFinalRows] = useState([])
  const [fields, setFields] = useState(EMPTY_FIELDS)
  const [approval, setApproval] = useState({ approvalDate: '', approvalPlace: '', signatoryIds: [] })
  const [entries, setEntries] = useState([EMPTY_ENTRY(), EMPTY_ENTRY()])
  const [journal, setJournal] = useState({ date: '', narration: '' })
  const [disclosures, setDisclosures] = useState({})
  const [signatory, setSignatory] = useState({ name: '', designation: '', din: '' })
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const supported = engagement.reporting_pack_id === 'IN_SCHEDULE_III_LEGACY'
    && engagement.trial_balance_currency === 'INR'
    && engagement.presentation_currency === 'INR'
  const editable = engagement.canEdit && !['finalised', 'archived'].includes(engagement.status)
    && !engagement.locked && !engagement.is_final
  const canFinaliseOutput = Number(engagement.partner_user_id) === Number(user.id)
    || Number(engagement.substitute_user_id) === Number(user.id)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [sources, finalTrialBalances, journalRows, reportRows] = await Promise.all([
        window.api.listEngagementTrialBalances(engagement.id),
        window.api.listEngagementFinalTrialBalances(engagement.id),
        window.api.listEngagementJournals(engagement.id),
        window.api.listEngagementReportOutputs(engagement.id),
      ])
      setTrialBalances(sources)
      setSnapshots(finalTrialBalances)
      setJournals(journalRows)
      setOutputs(reportRows)
      setSourceId(current => sources.some(row => String(row.id) === current) ? current : String(sources[0]?.id || ''))
      setFinalId(current => finalTrialBalances.some(row => String(row.id) === current) ? current : String(finalTrialBalances[0]?.id || ''))
      setError('')
    } catch (loadError) {
      setError(loadError.message || 'Unable to load reporting workflow data.')
    } finally {
      setLoading(false)
    }
  }, [engagement.id])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    let cancelled = false
    if (!finalId || !supported) {
      setBundle(null)
      setFinalRows([])
      return undefined
    }
    setLoading(true)
    Promise.all([
      window.api.getEngagementReportingData({ engagementId: engagement.id, trialBalanceId: Number(finalId) }),
      window.api.getEngagementFinalTrialBalanceRows({ engagementId: engagement.id, trialBalanceId: Number(finalId) }),
    ]).then(([reportingData, rows]) => {
      if (cancelled) return
      setBundle(reportingData)
      setFinalRows(rows)
      setFields({ ...EMPTY_FIELDS, ...(reportingData.auditReport?.fields || {}) })
      setDisclosures(Object.fromEntries((reportingData.noteDisclosures || []).map(note => [note.note_num, note.text])))
      setError('')
    }).catch(fetchError => {
      if (!cancelled) {
        setBundle(null)
        setError(fetchError.message || 'Unable to load financial statement inputs.')
      }
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [engagement.id, finalId, supported])

  const financialData = useMemo(() => bundle ? buildEngagementFinancials({
    ...bundle,
    generalNotes: bundle.generalNotes,
  }) : null, [bundle])

  const changeField = (key, value) => setFields(current => ({ ...current, [key]: value }))
  const run = async operation => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await operation()
      await load()
      return result
    } catch (operationError) {
      setError(operationError.message || 'The reporting operation failed.')
      return null
    } finally {
      setBusy(false)
    }
  }

  const postJournal = () => run(async () => {
    if (!sourceId) throw new Error('Import or link a source Trial Balance first.')
    const result = await window.api.postEngagementJournal({
      engagementId: engagement.id,
      sourceTrialBalanceId: Number(sourceId),
      date: journal.date,
      narration: journal.narration,
      entries,
    })
    setMessage(`Journal #${result.entryNumber} posted. The imported Trial Balance remains unchanged.`)
    setJournal({ date: '', narration: '' })
    setEntries([EMPTY_ENTRY(), EMPTY_ENTRY()])
    return result
  })

  const createFinalTrialBalance = () => run(async () => {
    if (!sourceId) throw new Error('Import or link a source Trial Balance first.')
    const result = await window.api.createEngagementFinalTrialBalance({
      engagementId: engagement.id,
      sourceTrialBalanceId: Number(sourceId),
    })
    setFinalId(String(result.trialBalance.id))
    setMessage(`Final Trial Balance v${result.version} created and mapped. Balance difference: ${Number(result.balanceDifference).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`)
    return result
  })

  const addSignatory = () => run(async () => {
    const created = await window.api.createEngagementReportSignatory({ engagementId: engagement.id, ...signatory })
    setSignatory({ name: '', designation: '', din: '' })
    setMessage(`${created.name} added to this client's professional signatory master.`)
    const updated = await window.api.getEngagementReportingData({ engagementId: engagement.id, trialBalanceId: Number(finalId) })
    setBundle(updated)
  })

  const saveDisclosure = note => run(async () => {
    await window.api.saveEngagementNoteDisclosure({
      engagementId: engagement.id,
      trialBalanceId: Number(finalId),
      noteNum: Number(note.num),
      noteTitle: note.title,
      text: disclosures[note.num] || '',
    })
    setMessage(`Note ${note.num} disclosure saved separately from the Trial Balance and journals.`)
  })

  const saveReportSettings = async () => {
    const result = await window.api.saveEngagementAuditReportSettings({ engagementId: engagement.id, fields })
    setBundle(current => current ? { ...current, auditReport: result } : current)
    return result
  }

  const generateReport = () => run(async () => {
    if (!bundle || !financialData) throw new Error('Mapped India financial data is not ready.')
    if (!approval.approvalDate || !approval.approvalPlace.trim()) throw new Error('Enter the financial-statement approval date and place.')
    if (!approval.signatoryIds.length) throw new Error('Select at least one active client signatory.')
    await saveReportSettings()
    const signatories = bundle.signatories.filter(item => approval.signatoryIds.includes(Number(item.id)))
    if (signatories.length !== approval.signatoryIds.length) throw new Error('A selected client signatory is no longer available.')
    const auditor = {
      name: fields.auditorName,
      membership_number: fields.auditorMembershipNumber,
      designation: fields.auditorDesignation,
      firm_name: fields.firmName,
      frn: fields.firmRegistrationNumber,
      firm_address: fields.firmAddress,
    }
    const detailsMap = Object.fromEntries((bundle.noteDetails || []).map(note => [note.note_num, note.data]))
    const disclosureMap = { ...disclosures }
    const financialsHtml = buildFinancialsHTML({
      entity: bundle.entity,
      activeTB: bundle.activeTB,
      prevTB: null,
      data: financialData,
      auditor,
      signatories,
      includeSigningPage: true,
      noteDetailsMap: detailsMap,
      noteDisclosureMap: disclosureMap,
      signPlace: approval.approvalPlace,
      signDate: approval.approvalDate,
    })
    const html = prependAuditReport(financialsHtml, makeAuditReportPage(fields, bundle.entity, bundle.engagement))
    const pdfBytes = new Uint8Array(await window.api.renderEngagementPDF(html))
    const saved = await window.api.saveEngagementReportOutput({
      engagementId: engagement.id,
      trialBalanceId: Number(finalId),
      pdfContentBase64: bytesToBase64(pdfBytes),
      signingDetails: approval,
    })
    await load()
    setMessage(`Combined PDF v${saved.version} saved as an immutable engagement output. Download it below for review.`)
    return saved
  })

  const downloadOutput = output => run(async () => {
    const saved = await window.api.getEngagementReportOutput(output.id)
    const result = await window.api.saveEngagementPdfFile({
      defaultName: `${saved.engagement.reference}-reporting-pack-v${saved.version}.pdf`,
      contentBase64: saved.pdfContentBase64,
    })
    if (!result.cancelled) setMessage(`PDF v${saved.version} saved to ${result.filePath}.`)
  })

  const finaliseOutput = output => run(async () => {
    await window.api.finaliseEngagementReportOutput(output.id)
    setMessage(`Combined PDF v${output.version} finalised. Its template, data hash and signing details are retained.`)
  })

  const selectedSource = trialBalances.find(row => String(row.id) === sourceId)
  const selectedFinal = snapshots.find(row => String(row.id) === finalId)
  const notes = financialData?.activeNotes || Object.values(financialData?.notes || {})

  return (
    <section className="mt-5 rounded-xl border border-indigo-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">India reporting pack</h3>
          <p className="mt-1 max-w-3xl text-sm text-gray-600">Import → post journals → create an immutable final Trial Balance → map → generate one audit report, financial statements and notes PDF.</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${supported ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-900'}`}>
          {supported ? 'India legacy · INR' : 'Processing unavailable'}
        </span>
      </div>
      {!supported && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">This first pack supports only the existing India legacy Schedule III workflow with trial-balance and presentation currency both set to INR. No currency translation is applied.</p>}
      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {message && <p role="status" className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-800">{message}</p>}
      {loading && <p className="mt-3 text-sm text-gray-500">Loading engagement reporting data…</p>}

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <div className="rounded-lg border border-gray-200 p-4">
          <h4 className="font-semibold text-gray-900">1. Audit journals</h4>
          <p className="mt-1 text-xs text-gray-500">Posted entries are immutable history and are applied only to a later final Trial Balance snapshot. The source import is never overwritten.</p>
          <label className="mt-3 block text-xs font-medium text-gray-700">Source Trial Balance
            <select value={sourceId} onChange={event => setSourceId(event.target.value)} className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-2 text-sm" disabled={!trialBalances.length}>
              {!trialBalances.length && <option value="">Import or link a source Trial Balance</option>}
              {trialBalances.map(row => <option key={row.id} value={row.id}>{row.source_filename || row.filename} · {row.row_count} rows</option>)}
            </select>
          </label>
          {selectedSource && <p className="mt-2 text-xs text-gray-500">{selectedSource.period || engagement.period_label} · imported source retained</p>}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Input label="Journal date" type="date" value={journal.date} onChange={value => setJournal(current => ({ ...current, date: value }))} />
            <Input label="Narration" value={journal.narration} onChange={value => setJournal(current => ({ ...current, narration: value }))} />
          </div>
          <div className="mt-3 space-y-2">
            {entries.map((entry, index) => <div key={index} className="grid grid-cols-12 gap-2">
              <input aria-label={`Line ${index + 1} ledger`} placeholder="Ledger" value={entry.ledgerName} onChange={event => setEntries(current => current.map((line, lineIndex) => lineIndex === index ? { ...line, ledgerName: event.target.value } : line))} className="col-span-5 rounded-md border px-2 py-2 text-sm" />
              <input aria-label={`Line ${index + 1} code`} placeholder="Code (optional)" value={entry.ledgerCode} onChange={event => setEntries(current => current.map((line, lineIndex) => lineIndex === index ? { ...line, ledgerCode: event.target.value } : line))} className="col-span-3 rounded-md border px-2 py-2 text-sm" />
              <select aria-label={`Line ${index + 1} side`} value={entry.side} onChange={event => setEntries(current => current.map((line, lineIndex) => lineIndex === index ? { ...line, side: event.target.value } : line))} className="col-span-2 rounded-md border px-1 py-2 text-sm"><option>Dr</option><option>Cr</option></select>
              <input aria-label={`Line ${index + 1} amount`} inputMode="decimal" placeholder="0.00" value={entry.amount} onChange={event => setEntries(current => current.map((line, lineIndex) => lineIndex === index ? { ...line, amount: event.target.value } : line))} className="col-span-2 rounded-md border px-2 py-2 text-right text-sm" />
            </div>)}
          </div>
          {entries.length < 20 && <button type="button" onClick={() => setEntries(current => [...current, EMPTY_ENTRY()])} className="mt-2 text-xs font-medium text-blue-700">+ Add journal line</button>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button disabled={!editable || busy || !sourceId} onClick={postJournal} className="rounded-md bg-[var(--color-primary)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">Post journal</button>
            <button disabled={!editable || busy || !sourceId || !supported} onClick={createFinalTrialBalance} className="rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-800 disabled:opacity-40">Create &amp; map final TB</button>
          </div>
          {!!journals.length && <details className="mt-4">
            <summary className="cursor-pointer text-sm font-medium text-gray-700">Posted journal history ({journals.length})</summary>
            <div className="mt-2 max-h-48 overflow-auto divide-y rounded border">
              {journals.map(item => <div key={item.id} className="p-2 text-xs">
                <div className="font-semibold">#{item.entry_number} · {formatPeriodDate(String(item.journal_date).slice(0, 10))} · {item.narration}</div>
                <div className="mt-1 text-gray-500">{(item.lines || []).map(line => `${line.ledger_name} ${line.entry_side} ${Number(line.amount).toFixed(2)}`).join(' · ')}</div>
              </div>)}
            </div>
          </details>}
        </div>

        <div className="rounded-lg border border-gray-200 p-4">
          <h4 className="font-semibold text-gray-900">2. Final Trial Balance &amp; mapping</h4>
          <p className="mt-1 text-xs text-gray-500">Each version is a separate snapshot of the selected import plus posted journals through its recorded journal watermark.</p>
          <label className="mt-3 block text-xs font-medium text-gray-700">Final Trial Balance
            <select value={finalId} onChange={event => setFinalId(event.target.value)} className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-2 text-sm" disabled={!snapshots.length}>
              {!snapshots.length && <option value="">No final Trial Balance yet</option>}
              {snapshots.map(row => <option key={row.id} value={row.id}>v{row.version} · {row.filename} · {row.row_count} rows</option>)}
            </select>
          </label>
          {selectedFinal && <div className="mt-3 rounded-md bg-gray-50 p-3 text-sm">
            <div className="font-medium text-gray-800">Version {selectedFinal.version} · {selectedFinal.mapped_count} mapped rows · {selectedFinal.unmapped_count} unmapped</div>
            <div className="mt-1 text-xs text-gray-500">Created {new Date(selectedFinal.created_at).toLocaleString()} · journal watermark {selectedFinal.journal_watermark}</div>
          </div>}
          {!!finalRows.length && <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium text-gray-700">Inspect mapped rows ({finalRows.length})</summary>
            <div className="mt-2 max-h-64 overflow-auto rounded border">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-gray-50"><tr><th className="p-2">Ledger</th><th className="p-2">Mapping</th><th className="p-2 text-right">Closing</th></tr></thead>
                <tbody className="divide-y">{finalRows.map(row => <tr key={row.id}>
                  <td className="p-2">{row.name}</td>
                  <td className="p-2">{[row.mapping1_resultant, row.mapping2_resultant, row.mapping3_resultant].filter(Boolean).join(' · ') || row.status || 'Unmapped'}</td>
                  <td className="p-2 text-right">{Number(row.closing_balance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>)}</tbody>
              </table>
            </div>
          </details>}
        </div>
      </div>

      <div className="mt-5 rounded-lg border border-indigo-200 bg-indigo-50/40 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="font-semibold text-gray-900">3. Audit report, financial statements &amp; notes</h4>
            <p className="mt-1 text-xs text-gray-600">The audit opinion is blank until entered by the auditor. The audit report date/place and financial-statement approval date/place are separate fields.</p>
          </div>
          {selectedFinal && <span className="text-xs text-gray-500">Reporting period {formatPeriodRange(bundle?.engagement.periodStart, bundle?.engagement.periodEnd)}</span>}
        </div>
        {!bundle ? <p className="mt-3 text-sm text-gray-500">Create or select a final Trial Balance to prepare the reporting pack.</p> : <>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Input label="Addressee" value={fields.addressee} onChange={value => changeField('addressee', value)} />
            <Input label="Audit report title" value="Independent Auditor's Report" onChange={() => {}} disabled />
            <TextArea label="Opinion — entered explicitly by the auditor; never generated from balances" rows={4} value={fields.opinion} onChange={value => changeField('opinion', value)} />
            <TextArea label="Basis for opinion" value={fields.basisForOpinion} onChange={value => changeField('basisForOpinion', value)} />
            <TextArea label="Management responsibilities" value={fields.managementResponsibilities} onChange={value => changeField('managementResponsibilities', value)} />
            <TextArea label="Auditor responsibilities" value={fields.auditorResponsibilities} onChange={value => changeField('auditorResponsibilities', value)} />
            <TextArea label="Other matters (optional)" value={fields.otherMatters} onChange={value => changeField('otherMatters', value)} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Audit report date" type="date" value={fields.reportDate} onChange={value => changeField('reportDate', value)} />
              <Input label="Audit report place" value={fields.reportPlace} onChange={value => changeField('reportPlace', value)} />
              <Input label="Financial-statement approval date" type="date" value={approval.approvalDate} onChange={value => setApproval(current => ({ ...current, approvalDate: value }))} />
              <Input label="Financial-statement approval place" value={approval.approvalPlace} onChange={value => setApproval(current => ({ ...current, approvalPlace: value }))} />
            </div>
            <Input label="Audit firm name" value={fields.firmName} onChange={value => changeField('firmName', value)} />
            <Input label="Firm registration number (FRN)" value={fields.firmRegistrationNumber} onChange={value => changeField('firmRegistrationNumber', value)} />
            <Input label="Auditor name" value={fields.auditorName} onChange={value => changeField('auditorName', value)} />
            <Input label="Auditor membership number" value={fields.auditorMembershipNumber} onChange={value => changeField('auditorMembershipNumber', value)} />
            <Input label="Auditor designation" value={fields.auditorDesignation} onChange={value => changeField('auditorDesignation', value)} />
            <TextArea label="Audit firm address" value={fields.firmAddress} onChange={value => changeField('firmAddress', value)} />
          </div>

          <div className="mt-4 rounded-md border border-gray-200 bg-white p-3">
            <h5 className="text-sm font-semibold text-gray-800">Client signatories for financial-statement approval</h5>
            {bundle.signatories.length === 0 ? <p className="mt-2 text-xs text-amber-800">No signatories are set up. Add an authorised client signatory below; the system will not select one automatically.</p> : (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {bundle.signatories.map(item => <label key={item.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={approval.signatoryIds.includes(Number(item.id))}
                    onChange={event => setApproval(current => ({
                      ...current,
                      signatoryIds: event.target.checked
                        ? [...new Set([...current.signatoryIds, Number(item.id)])]
                        : current.signatoryIds.filter(id => id !== Number(item.id)),
                    }))} />
                  <span>{item.name}{item.designation ? ` · ${item.designation}` : ''}{item.din ? ` · ${item.din}` : ''}</span>
                </label>)}
              </div>
            )}
            {editable && <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
              <input placeholder="Signatory name" value={signatory.name} onChange={event => setSignatory(current => ({ ...current, name: event.target.value }))} className="rounded-md border px-2.5 py-2 text-sm" />
              <input placeholder="Designation" value={signatory.designation} onChange={event => setSignatory(current => ({ ...current, designation: event.target.value }))} className="rounded-md border px-2.5 py-2 text-sm" />
              <input placeholder="DIN / ID (optional)" value={signatory.din} onChange={event => setSignatory(current => ({ ...current, din: event.target.value }))} className="rounded-md border px-2.5 py-2 text-sm" />
              <button disabled={busy || !signatory.name.trim()} onClick={addSignatory} className="rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-40">Add signatory</button>
            </div>}
          </div>

          {notes.length > 0 && <details className="mt-4 rounded-md border border-gray-200 bg-white p-3">
            <summary className="cursor-pointer text-sm font-semibold text-gray-800">Notes to accounts — add separate narrative disclosures ({notes.length})</summary>
            <div className="mt-3 space-y-3">
              {notes.map(note => <div key={note.num} className="grid gap-2 border-t pt-3 md:grid-cols-[1fr_auto]">
                <TextArea label={`Note ${note.num}: ${note.displayTitle || note.title}`} rows={2} value={disclosures[note.num] || ''} onChange={value => setDisclosures(current => ({ ...current, [note.num]: value }))} />
                <button disabled={!editable || busy} onClick={() => saveDisclosure(note)} className="self-end rounded-md border px-3 py-2 text-sm disabled:opacity-40">Save note text</button>
              </div>)}
            </div>
          </details>}

          <div className="mt-4 flex flex-wrap gap-2">
            <button disabled={!editable || busy || !financialData} onClick={generateReport} className="rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy ? 'Generating…' : 'Generate & save combined PDF'}</button>
            <button disabled={!editable || busy} onClick={() => run(saveReportSettings)} className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium disabled:opacity-40">Save audit report edits</button>
          </div>
        </>}
      </div>

      {!!outputs.length && <div className="mt-5 rounded-lg border border-gray-200 p-4">
        <h4 className="font-semibold text-gray-900">Saved combined PDF versions</h4>
        <div className="mt-2 divide-y">
          {outputs.map(output => <div key={output.id} className="flex flex-wrap items-center gap-3 py-3">
            <div className="min-w-[200px] flex-1">
              <div className="text-sm font-medium">Version {output.version} · Final TB v{output.final_tb_version}</div>
              <div className="mt-0.5 text-xs text-gray-500">Template r{output.template_revision} · {output.created_by_name} · {new Date(output.created_at).toLocaleString()}{output.finalised_at ? ` · Finalised ${new Date(output.finalised_at).toLocaleString()}` : ''}</div>
            </div>
            <button disabled={busy} onClick={() => downloadOutput(output)} className="rounded-md border px-3 py-1.5 text-sm">Download PDF</button>
            {canFinaliseOutput && !output.finalised_at && <button disabled={busy} onClick={() => finaliseOutput(output)} className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Finalise version</button>}
          </div>)}
        </div>
      </div>}
    </section>
  )
}
