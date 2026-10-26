import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { buildEngagementFinancials } from '../../hooks/useFinancials'
import { buildFinancialsHTML } from '../GenerateFinancials/buildHTML'
import { formatPeriodDate, formatPeriodRange } from '../../utils/financialPeriodDisplay'
import { makeAuditReportPage, prependAuditReport } from './engagementReportHtml'
import {
  buildUaeDemoFinancials,
  buildUaeDemoFinancialsHtml,
  suggestUaeDemoAccountLine,
  UAE_DEMO_ACCOUNT_LINES,
} from './uaeDemoReporting'

const EMPTY_ENTRY = () => ({ ledgerName: '', ledgerCode: '', side: 'Dr', amount: '' })
const EMPTY_SHARE_CLASS = () => ({
  name: 'Equity Shares',
  type: 'Equity',
  faceValue: 10,
  cy: { authorised: '', issued: '', subscribed: '', paidUp: '', openingShares: '', issuedDuringYear: '', deletedDuringYear: '' },
  py: { authorised: '', issued: '', subscribed: '', paidUp: '', openingShares: '', issuedDuringYear: '', deletedDuringYear: '' },
})
const EMPTY_SHARE_DETAILS = () => ({
  classes: [EMPTY_SHARE_CLASS()],
  shareholders5pctEquity: [],
  shareholders5pctPreference: [],
  promoters: [],
  rights: '',
  footnotes: Array(10).fill(''),
})
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

function TextArea({ label, value, onChange, rows = 3, ...props }) {
  return <label className="block">
    <span className="mb-1 block text-xs font-medium text-gray-700">{label}</span>
    <textarea {...props} value={value} rows={rows} onChange={event => onChange(event.target.value)}
      className="w-full rounded-md border border-gray-300 px-2.5 py-2 text-sm focus:border-blue-500 focus:outline-none" />
  </label>
}

export default function EngagementReportingPanel({ engagement, user, trialBalanceRefresh = 0 }) {
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
  const [selections, setSelections] = useState({
    responsibleAuditorFirmId: '',
    responsibleOfficeId: '',
    brandingAuditorFirmId: '',
    managementSignatoryIds: [],
  })
  const [entries, setEntries] = useState([EMPTY_ENTRY(), EMPTY_ENTRY()])
  const [journal, setJournal] = useState({ date: '', narration: '' })
  const [disclosures, setDisclosures] = useState({})
  const [structuredDetails, setStructuredDetails] = useState({})
  const [comparativeId, setComparativeId] = useState('')
  const [mappingSelections, setMappingSelections] = useState({})
  const [signatory, setSignatory] = useState({ name: '', designation: '', din: '' })
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const isUaeDemo = engagement.reporting_pack_id === 'AE_UAE_DEMO'
    && engagement.trial_balance_currency === 'AED'
    && engagement.presentation_currency === 'AED'
  const supported = (engagement.reporting_pack_id === 'IN_SCHEDULE_III_LEGACY'
    && engagement.trial_balance_currency === 'INR'
    && engagement.presentation_currency === 'INR') || isUaeDemo
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
  }, [engagement.id, trialBalanceRefresh])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const snapshot = snapshots.find(item => String(item.id) === String(finalId))
    if (!snapshot) return
    const savedOutput = outputs.find(item => Number(item.final_tb_version) === Number(snapshot.version))
    if (!savedOutput) return
    setApproval(current => ({
      ...current,
      approvalDate: savedOutput.approval_date || '',
      approvalPlace: savedOutput.approval_place || '',
      signatoryIds: Array.isArray(savedOutput.approval_signatory_ids)
        ? savedOutput.approval_signatory_ids.map(Number)
        : current.signatoryIds,
    }))
  }, [finalId, outputs, snapshots])

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
      setSelections(reportingData.reportingSelections || {
        responsibleAuditorFirmId: '',
        responsibleOfficeId: '',
        brandingAuditorFirmId: '',
        managementSignatoryIds: [],
      })
      setApproval(current => ({
        ...current,
        signatoryIds: reportingData.reportingSelections?.managementSignatoryIds || [],
      }))
      setDisclosures(Object.fromEntries((reportingData.noteDisclosures || []).map(note => [note.note_title, note.text])))
      setStructuredDetails(Object.fromEntries((reportingData.noteDetails || []).map(note => [note.note_title, note.data])))
      setComparativeId(String(reportingData.comparativeTrialBalance?.id || ''))
      setMappingSelections(Object.fromEntries((reportingData.uaeMappings || []).map(item => [
        String(item.trialBalanceRowId), item.lineKey,
      ])))
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

  const financialData = useMemo(() => {
    if (!bundle) return null
    if (isUaeDemo) {
      try {
        return buildUaeDemoFinancials({
          currentRows: bundle.currentRows || [],
          comparativeRows: bundle.comparativeRows || [],
          mappings: mappingSelections,
          periodEnd: bundle.engagement.periodEnd,
          comparativePeriodEnd: bundle.comparativeTrialBalance?.dateTill,
        })
      } catch (reportingError) {
        return { reportingError: reportingError.message || 'UAE demonstration figures are not reconciled.' }
      }
    }
    return buildEngagementFinancials({
      ...bundle,
      generalNotes: bundle.generalNotes,
    })
  }, [bundle, isUaeDemo, mappingSelections])

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
    setMessage(isUaeDemo
      ? `UAE final Trial Balance v${result.version} created. Review and save the UAE statement mappings below.`
      : `Final Trial Balance v${result.version} created and mapped. Balance difference: ${Number(result.balanceDifference).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`)
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
      text: disclosures[note.title] || '',
    })
    setMessage(`Note ${note.num} disclosure saved separately from the Trial Balance and journals.`)
  })

  const importComparativeTrialBalance = () => run(async () => {
    const imported = await window.api.importEngagementTrialBalance({ engagementId: engagement.id, comparative: true })
    if (imported?.cancelled) return
    setComparativeId(String(imported.trialBalance.id))
    setMessage(`Prior-year Trial Balance ${imported.trialBalance.period} imported and selected. Its closing balances will be used for comparatives.`)
    if (finalId) {
      const [updated, rows] = await Promise.all([
        window.api.getEngagementReportingData({ engagementId: engagement.id, trialBalanceId: Number(finalId) }),
        window.api.getEngagementFinalTrialBalanceRows({ engagementId: engagement.id, trialBalanceId: Number(finalId) }),
      ])
      setBundle(updated)
      setFinalRows(rows)
      setStructuredDetails(Object.fromEntries((updated.noteDetails || []).map(note => [note.note_title, note.data])))
    }
    return imported
  })

  const selectComparativeTrialBalance = () => run(async () => {
    await window.api.selectEngagementComparativeTrialBalance({
      engagementId: engagement.id,
      trialBalanceId: comparativeId ? Number(comparativeId) : null,
    })
    if (finalId) {
      const updated = await window.api.getEngagementReportingData({ engagementId: engagement.id, trialBalanceId: Number(finalId) })
      setBundle(updated)
    }
    setMessage('Prior-year comparative selection saved.')
  })

  const saveStructuredDetails = note => run(async () => {
    const data = structuredDetails[note.title] || EMPTY_SHARE_DETAILS()
    await window.api.saveEngagementNoteDetails({
      engagementId: engagement.id,
      trialBalanceId: Number(finalId),
      noteNum: Number(note.num),
      noteTitle: note.title,
      data,
    })
    const updated = await window.api.getEngagementReportingData({ engagementId: engagement.id, trialBalanceId: Number(finalId) })
    setBundle(updated)
    setStructuredDetails(Object.fromEntries((updated.noteDetails || []).map(item => [item.note_title, item.data])))
    setMessage(`Structured details for ${note.title} saved by stable note identity.`)
  })

  const correctMapping = row => run(async () => {
    if (isUaeDemo) {
      const lineKey = mappingSelections[row.id] || suggestUaeDemoAccountLine(row.name)
      if (!lineKey) throw new Error(`Choose a UAE statement line for ${row.name}.`)
      const nextMappings = { ...mappingSelections, [row.id]: lineKey }
      const allMappings = finalRows
        .filter(item => Math.abs(Number(item.closing_balance || 0)) >= 0.005)
        .map(item => ({
          tbRowId: Number(item.id),
          lineKey: String(nextMappings[item.id] || suggestUaeDemoAccountLine(item.name) || ''),
        }))
      if (allMappings.some(item => !item.lineKey)) throw new Error('Choose a UAE statement line for every non-zero account before saving mappings.')
      await window.api.saveEngagementUaeDemoMappings({
        engagementId: engagement.id,
        trialBalanceId: Number(finalId),
        mappings: allMappings,
      })
      setMappingSelections(nextMappings)
      const updated = await window.api.getEngagementReportingData({ engagementId: engagement.id, trialBalanceId: Number(finalId) })
      setBundle(updated)
      setMessage(`UAE statement mapping saved for ${row.name}.`)
      return
    }
    const levelFormatId = Number(mappingSelections[row.id] || row.lf_id)
    if (!Number.isInteger(levelFormatId)) throw new Error('Choose a valid statement mapping.')
    await window.api.correctEngagementMapping({
      engagementId: engagement.id,
      trialBalanceId: Number(finalId),
      trialBalanceRowId: Number(row.id),
      levelFormatId,
    })
    const [updated, rows] = await Promise.all([
      window.api.getEngagementReportingData({ engagementId: engagement.id, trialBalanceId: Number(finalId) }),
      window.api.getEngagementFinalTrialBalanceRows({ engagementId: engagement.id, trialBalanceId: Number(finalId) }),
    ])
    setBundle(updated)
    setFinalRows(rows)
    setMessage(`Mapping correction saved for ${row.name}.`)
  })

  const changeShareDetail = (noteTitle, periodKey, field, value) => {
    setStructuredDetails(current => {
      const existing = current[noteTitle] || EMPTY_SHARE_DETAILS()
      const classes = existing.classes?.length ? [...existing.classes] : [EMPTY_SHARE_CLASS()]
      const shareClass = classes[0]
      classes[0] = periodKey === 'faceValue'
        ? { ...shareClass, faceValue: value }
        : { ...shareClass, [periodKey]: { ...shareClass[periodKey], [field]: value } }
      return { ...current, [noteTitle]: { ...existing, classes } }
    })
  }

  const saveReportSettings = async () => {
    const result = await window.api.saveEngagementAuditReportSettings({ engagementId: engagement.id, fields })
    setBundle(current => current ? { ...current, auditReport: result } : current)
    setFields(current => ({ ...current, ...(result.fields || {}) }))
    return result
  }

  const saveSelections = async () => {
    await window.api.saveEngagementReportingSelections({
      engagementId: engagement.id,
      ...selections,
      managementSignatoryIds: approval.signatoryIds,
    })
    setSelections(current => ({ ...current, managementSignatoryIds: approval.signatoryIds }))
  }

  const moveSignatory = (index, direction) => setApproval(current => {
    const next = [...current.signatoryIds]
    const target = index + direction
    if (target < 0 || target >= next.length) return current
    ;[next[index], next[target]] = [next[target], next[index]]
    return { ...current, signatoryIds: next }
  })

  const generateReport = () => run(async () => {
    if (financialData?.reportingError) throw new Error(financialData.reportingError)
    if (!bundle || !financialData) throw new Error(isUaeDemo
      ? 'UAE demonstration financial data is not ready.'
      : 'Mapped India financial data is not ready.')
    if (!approval.approvalDate || !approval.approvalPlace.trim()) throw new Error('Enter the financial-statement approval date and place.')
    if (!approval.signatoryIds.length) throw new Error('Select at least one active client signatory.')
    if (isUaeDemo && !bundle.comparativeTrialBalance) throw new Error('Import and select the prior-year comparative Trial Balance before generating the UAE demonstration.')
    await saveSelections()
    const savedSettings = await window.api.saveEngagementAuditReportSettings({ engagementId: engagement.id, fields })
    const currentFields = { ...fields, ...(savedSettings.fields || {}) }
    setFields(currentFields)
    const reportBundle = await window.api.getEngagementReportingData({ engagementId: engagement.id, trialBalanceId: Number(finalId) })
    setBundle(reportBundle)
    const signatories = approval.signatoryIds.map(id => bundle.signatories.find(item => Number(item.id) === Number(id))).filter(Boolean)
    if (signatories.length !== approval.signatoryIds.length) throw new Error('A selected client signatory is no longer available.')
    if (isUaeDemo) {
      const currentMappings = finalRows
        .filter(row => Math.abs(Number(row.closing_balance || 0)) >= 0.005)
        .map(row => ({
          tbRowId: Number(row.id),
          lineKey: String(mappingSelections[row.id] || suggestUaeDemoAccountLine(row.name) || ''),
        }))
      if (currentMappings.some(item => !item.lineKey)) throw new Error('Map every non-zero account to a UAE statement line before generating the PDF.')
      await window.api.saveEngagementUaeDemoMappings({
        engagementId: engagement.id,
        trialBalanceId: Number(finalId),
        mappings: currentMappings,
      })
      const mappedBundle = await window.api.getEngagementReportingData({
        engagementId: engagement.id,
        trialBalanceId: Number(finalId),
      })
      const uaeFinancials = buildUaeDemoFinancials({
        currentRows: mappedBundle.currentRows || [],
        comparativeRows: mappedBundle.comparativeRows || [],
        mappings: Object.fromEntries(currentMappings.map(item => [String(item.tbRowId), item.lineKey])),
        periodEnd: mappedBundle.engagement.periodEnd,
        comparativePeriodEnd: mappedBundle.comparativeTrialBalance?.dateTill,
      })
      const html = buildUaeDemoFinancialsHtml({
        financials: uaeFinancials,
        entity: mappedBundle.entity,
        engagement: mappedBundle.engagement,
        bundle: {
          ...mappedBundle,
          approvalDate: approval.approvalDate,
          approvalPlace: approval.approvalPlace,
          approvalSignatories: signatories,
        },
      })
      const pdfBytes = new Uint8Array(await window.api.renderEngagementPDF(html))
      const saved = await window.api.saveEngagementReportOutput({
        engagementId: engagement.id,
        trialBalanceId: Number(finalId),
        pdfContentBase64: bytesToBase64(pdfBytes),
        signingDetails: approval,
        auditReportFields: currentFields,
        reportIdentitySnapshot: mappedBundle.reportIdentitySnapshot,
      })
      await load()
      setMessage(`${engagement.name} combined PDF v${saved.version} saved as a draft for demonstration.`)
      return saved
    }
    const auditor = {
      name: currentFields.auditorName,
      membership_number: currentFields.auditorMembershipNumber,
      designation: currentFields.auditorDesignation,
      firm_name: currentFields.firmName,
      frn: currentFields.firmRegistrationNumber,
      firm_address: currentFields.firmAddress,
    }
    const detailsByTitle = new Map((bundle.noteDetails || []).map(note => [String(note.note_title || '').trim().toLocaleLowerCase(), note.data]))
    const detailsMap = Object.fromEntries(notes.map(note => {
      const saved = detailsByTitle.get(String(note.title || '').trim().toLocaleLowerCase())
      return saved ? [note.num, saved] : null
    }).filter(Boolean))
    const disclosureMap = Object.fromEntries(notes.map(note => [note.num, disclosures[note.title] || '']))
    const financialsHtml = buildFinancialsHTML({
      entity: bundle.entity,
      activeTB: bundle.activeTB,
      prevTB: bundle.comparativeTrialBalance,
      data: financialData,
      auditor,
      signatories,
      includeSigningPage: true,
      noteDetailsMap: detailsMap,
      noteDisclosureMap: disclosureMap,
      signPlace: approval.approvalPlace,
      signDate: approval.approvalDate,
    })
    const html = prependAuditReport(financialsHtml, makeAuditReportPage(
      currentFields, bundle.entity, bundle.engagement, reportBundle.firmSettings?.branding
    ))
    const pdfBytes = new Uint8Array(await window.api.renderEngagementPDF(html))
    const saved = await window.api.saveEngagementReportOutput({
      engagementId: engagement.id,
      trialBalanceId: Number(finalId),
      pdfContentBase64: bytesToBase64(pdfBytes),
      signingDetails: approval,
      auditReportFields: currentFields,
      reportIdentitySnapshot: reportBundle.reportIdentitySnapshot,
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
  const notes = isUaeDemo
    ? (financialData?.notes || []).map(note => ({ num: note.number, title: note.title, displayTitle: note.title }))
    : financialData?.activeNotes || Object.values(financialData?.notes || {})

  return (
    <section className="mt-5 rounded-xl border border-indigo-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{isUaeDemo ? 'UAE reporting demonstration' : 'India reporting pack'}</h3>
          <p className="mt-1 max-w-3xl text-sm text-gray-600">{isUaeDemo
            ? 'Synthetic UAE LLC · AED source balances · 2025 with 2024 comparatives. This limited demonstration is not a validated IFRS reporting pack.'
            : 'Import → post journals → create an immutable final Trial Balance → map → generate one audit report, financial statements and notes PDF.'}</p>
          <p className="mt-1 max-w-3xl text-xs text-gray-500">Generation saves a draft PDF. The assigned partner or authorised substitute must explicitly finalise it. Finalised engagements are never reopened automatically.</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${supported ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-900'}`}>
          {isUaeDemo ? 'Draft for demonstration · AED' : supported ? 'India legacy · INR' : 'Processing unavailable'}
        </span>
      </div>
      {!supported && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">This reporting workflow is not implemented for the selected basis and currencies.</p>}
      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {message && <p role="status" className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-800">{message}</p>}
      {isUaeDemo && financialData?.reportingError && <p role="alert" className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{financialData.reportingError}</p>}
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
          {editable && <button disabled={busy || !supported} onClick={importComparativeTrialBalance}
            className="mt-3 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-800 disabled:opacity-40">
            Import prior-year Trial Balance
          </button>}
          {bundle?.comparativeTrialBalances?.length > 0 && <div className="mt-3 rounded-md border border-indigo-100 bg-indigo-50/60 p-3">
            <label className="block text-xs font-medium text-gray-700">Comparative Trial Balance
              <select value={comparativeId} onChange={event => setComparativeId(event.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2.5 py-2 text-sm">
                <option value="">No prior-year comparative selected</option>
                {bundle.comparativeTrialBalances.map(row => <option key={row.id} value={row.id}>
                  {row.period} · {row.filename} · {row.row_count} rows
                </option>)}
              </select>
            </label>
            <button disabled={!editable || busy} onClick={selectComparativeTrialBalance}
              className="mt-2 rounded-md border border-indigo-300 bg-white px-3 py-1.5 text-xs font-medium text-indigo-900 disabled:opacity-40">
              Save comparative selection
            </button>
            {bundle.comparativeTrialBalance && <p className="mt-2 text-xs text-indigo-900">
              Comparatives use prior-year closing balances for {bundle.comparativeTrialBalance.dateFrom} to {bundle.comparativeTrialBalance.dateTill}; current-year opening balances are not substituted.
            </p>}
          </div>}
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
          <h4 className="font-semibold text-gray-900">{isUaeDemo ? '2. Final Trial Balance &amp; UAE statement mapping' : '2. Final Trial Balance &amp; mapping'}</h4>
          <p className="mt-1 text-xs text-gray-500">{isUaeDemo
            ? 'Source debit balances are stored negative and credits positive. Each UAE line mapping is saved separately from the imported Trial Balance.'
            : 'Each version is a separate snapshot of the selected import plus posted journals through its recorded journal watermark.'}</p>
          <label className="mt-3 block text-xs font-medium text-gray-700">Final Trial Balance
            <select value={finalId} onChange={event => setFinalId(event.target.value)} className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-2 text-sm" disabled={!snapshots.length}>
              {!snapshots.length && <option value="">No final Trial Balance yet</option>}
              {snapshots.map(row => <option key={row.id} value={row.id}>v{row.version} · {row.filename} · {row.row_count} rows</option>)}
            </select>
          </label>
          {selectedFinal && <div className="mt-3 rounded-md bg-gray-50 p-3 text-sm">
            <div className="font-medium text-gray-800">{isUaeDemo
              ? `Version ${selectedFinal.version} · ${finalRows.length} final rows · ${bundle?.uaeMappings?.length || 0} saved UAE mappings`
              : `Version ${selectedFinal.version} · ${selectedFinal.mapped_count} mapped rows · ${selectedFinal.unmapped_count} unmapped`}</div>
            <div className="mt-1 text-xs text-gray-500">Created {new Date(selectedFinal.created_at).toLocaleString()} · journal watermark {selectedFinal.journal_watermark}</div>
          </div>}
          {!!finalRows.length && <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium text-gray-700">{isUaeDemo ? 'Inspect and map UAE statement accounts' : `Inspect mapped rows (${finalRows.length})`}</summary>
            <div className="mt-2 max-h-64 overflow-auto rounded border">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-gray-50"><tr><th className="p-2">Ledger</th><th className="p-2">Mapping</th><th className="p-2 text-right">Closing</th></tr></thead>
                <tbody className="divide-y">{finalRows.map(row => <tr key={row.id}>
                  <td className="p-2">{row.name}</td>
                  <td className="p-2">
                    {isUaeDemo
                      ? <div>{UAE_DEMO_ACCOUNT_LINES.find(item => item.id === (mappingSelections[row.id] || suggestUaeDemoAccountLine(row.name)))?.label || 'Choose a line'}</div>
                      : <div>{[row.mapping1_resultant, row.mapping2_resultant, row.mapping3_resultant].filter(Boolean).join(' · ') || row.status || 'Unmapped'}</div>}
                    {isUaeDemo && editable && <div className="mt-1 flex gap-1">
                      <select aria-label={`Correct mapping for ${row.name}`} value={mappingSelections[row.id] || suggestUaeDemoAccountLine(row.name) || ''}
                        onChange={event => setMappingSelections(current => ({ ...current, [row.id]: event.target.value }))}
                        className="min-w-0 flex-1 rounded border border-gray-300 px-1 py-1 text-[10px]">
                        <option value="">Select UAE statement line…</option>
                        {UAE_DEMO_ACCOUNT_LINES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                      </select>
                      <button disabled={busy || !(mappingSelections[row.id] || suggestUaeDemoAccountLine(row.name))} onClick={() => correctMapping(row)}
                        className="rounded border px-2 py-1 text-[10px] disabled:opacity-40">Save</button>
                    </div>}
                    {!isUaeDemo && editable && bundle?.levelFormat?.length > 0 && <div className="mt-1 flex gap-1">
                      <select aria-label={`Correct mapping for ${row.name}`} value={mappingSelections[row.id] || row.level_format_id || ''}
                        onChange={event => setMappingSelections(current => ({ ...current, [row.id]: event.target.value }))}
                        className="min-w-0 flex-1 rounded border border-gray-300 px-1 py-1 text-[10px]">
                        <option value="">Select mapping…</option>
                        {bundle.levelFormat.filter(item => item.alie).map(item => <option key={item.id} value={item.id}>
                          {[item.alie, item.level1, item.level2, item.level3].filter(Boolean).join(' · ')}
                        </option>)}
                      </select>
                      <button disabled={busy || !(mappingSelections[row.id] || row.level_format_id)} onClick={() => correctMapping(row)}
                        className="rounded border px-2 py-1 text-[10px] disabled:opacity-40">Save</button>
                    </div>}
                  </td>
                  <td className="p-2 text-right">{isUaeDemo ? 'AED ' : ''}{Number(row.closing_balance || 0).toLocaleString(isUaeDemo ? 'en-AE' : 'en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
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
          <section className="mt-4 rounded-md border border-gray-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h5 className="text-sm font-semibold text-gray-800">Firm, office and branding selections</h5>
                <p className="mt-1 text-xs text-gray-500">Selections come from Firm Settings and the assigned engagement partner; generated PDFs retain a snapshot.</p>
              </div>
              <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700">Partner · {engagement.partner_name || 'Not assigned'}</span>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-700">Responsible firm</span>
                <select disabled={!editable} value={selections.responsibleAuditorFirmId || ''} onChange={event => setSelections(current => ({
                  ...current,
                  responsibleAuditorFirmId: event.target.value,
                  responsibleOfficeId: '',
                  brandingAuditorFirmId: current.brandingAuditorFirmId || event.target.value,
                }))} className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-2 text-sm">
                  <option value="">Select a firm…</option>
                  {(bundle.firmSettings?.professionalFirms || []).filter(item => item.is_active).map(item =>
                    <option key={item.id} value={item.id}>{item.firm_name} · {item.frn || 'No FRN'}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-700">Responsible office</span>
                <select disabled={!editable || !selections.responsibleAuditorFirmId} value={selections.responsibleOfficeId || ''} onChange={event => setSelections(current => ({ ...current, responsibleOfficeId: event.target.value }))}
                  className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-2 text-sm">
                  <option value="">Use firm main address</option>
                  {(bundle.firmSettings?.offices || []).filter(item => item.is_active && String(item.auditor_firm_id) === String(selections.responsibleAuditorFirmId)).map(item =>
                    <option key={item.id} value={item.id}>{item.office_name} · {item.address}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-700">Branding profile</span>
                <select disabled={!editable} value={selections.brandingAuditorFirmId || ''} onChange={event => setSelections(current => ({ ...current, brandingAuditorFirmId: event.target.value }))}
                  className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-2 text-sm">
                  <option value="">Use responsible firm</option>
                  {(bundle.firmSettings?.professionalFirms || []).filter(item => item.is_active).map(item =>
                    <option key={item.id} value={item.id}>{item.firm_name} · {item.frn || 'No FRN'}</option>)}
                </select>
              </label>
            </div>
            {bundle.firmSettings?.branding?.logoBase64 && <div className="mt-3 flex items-center gap-3 text-xs text-gray-600">
              <img alt="Selected report branding" src={`data:${bundle.firmSettings.branding.logoMimeType};base64,${bundle.firmSettings.branding.logoBase64}`} className="h-20 w-64 object-contain" />
              <span>{bundle.firmSettings.branding.name} logo</span>
            </div>}
            {editable && <button type="button" disabled={busy} onClick={() => run(async () => {
              await saveSelections()
              const updated = await window.api.getEngagementReportingData({ engagementId: engagement.id, trialBalanceId: Number(finalId) })
              setBundle(updated)
              setFields({ ...EMPTY_FIELDS, ...(updated.auditReport?.fields || {}) })
              setMessage('Firm, office, branding and ordered signatory selections saved.')
            })} className="mt-3 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-800 disabled:opacity-40">Save engagement selections</button>}
          </section>
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
            <Input label="Audit firm name" value={fields.firmName} readOnly onChange={() => {}} />
            <Input label="Firm registration number (FRN)" value={fields.firmRegistrationNumber} readOnly onChange={() => {}} />
            <Input label="Auditor name" value={fields.auditorName} readOnly onChange={() => {}} />
            <Input label="Auditor membership / registration number" value={fields.auditorMembershipNumber} readOnly onChange={() => {}} />
            <Input label="Auditor designation / qualification" value={fields.auditorDesignation} readOnly onChange={() => {}} />
            <TextArea label="Selected office address" value={fields.firmAddress} readOnly onChange={() => {}} />
          </div>

          <div className="mt-4 rounded-md border border-gray-200 bg-white p-3">
            <h5 className="text-sm font-semibold text-gray-800">Ordered management signatories for financial-statement approval</h5>
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
            {!!approval.signatoryIds.length && <ol className="mt-3 space-y-1 border-t border-gray-100 pt-2">
              {approval.signatoryIds.map((id, index) => {
                const item = bundle.signatories.find(signatoryItem => Number(signatoryItem.id) === Number(id))
                return <li key={id} className="flex items-center gap-2 text-xs text-gray-700">
                  <span className="w-5 text-right font-semibold text-gray-500">{index + 1}.</span>
                  <span className="min-w-0 flex-1">{item?.name || 'Inactive signatory'}{item?.designation ? ` · ${item.designation}` : ''}</span>
                  <button type="button" aria-label={`Move ${item?.name || 'signatory'} up`} disabled={!editable || index === 0}
                    onClick={() => moveSignatory(index, -1)} className="rounded border px-2 py-1 disabled:opacity-40">↑</button>
                  <button type="button" aria-label={`Move ${item?.name || 'signatory'} down`} disabled={!editable || index === approval.signatoryIds.length - 1}
                    onClick={() => moveSignatory(index, 1)} className="rounded border px-2 py-1 disabled:opacity-40">↓</button>
                </li>
              })}
            </ol>}
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
              {notes.map(note => <div key={note.title} className="border-t pt-3">
                <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                  <TextArea label={`Note ${note.num}: ${note.displayTitle || note.title}`} rows={2} value={disclosures[note.title] || ''} onChange={value => setDisclosures(current => ({ ...current, [note.title]: value }))} />
                  <button disabled={!editable || busy} onClick={() => saveDisclosure(note)} className="self-end rounded-md border px-3 py-2 text-sm disabled:opacity-40">Save note text</button>
                </div>
                {/share capital/i.test(note.title || '') && <details className="mt-3 rounded border border-gray-200 p-3">
                  <summary className="cursor-pointer text-xs font-semibold text-gray-700">Structured share-capital details</summary>
                  {(() => {
                    const shareClass = (structuredDetails[note.title]?.classes || EMPTY_SHARE_DETAILS().classes)[0]
                    const fieldsToEdit = [
                      ['authorised', 'Authorised shares'],
                      ['issued', 'Issued shares'],
                      ['subscribed', 'Subscribed shares'],
                      ['paidUp', 'Paid-up shares'],
                      ['openingShares', 'Opening shares'],
                      ['issuedDuringYear', 'Issued during year'],
                      ['deletedDuringYear', 'Shares cancelled during year'],
                    ]
                    return <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <Input label="Share class" value={shareClass.name || 'Equity Shares'} onChange={value => {
                        const current = structuredDetails[note.title] || EMPTY_SHARE_DETAILS()
                        const classes = current.classes?.length ? [...current.classes] : [EMPTY_SHARE_CLASS()]
                        classes[0] = { ...classes[0], name: value }
                        setStructuredDetails(details => ({ ...details, [note.title]: { ...current, classes } }))
                      }} />
                      <Input label="Face value per share" type="number" value={shareClass.faceValue ?? 10} onChange={value => changeShareDetail(note.title, 'faceValue', '', value)} />
                      {['cy', 'py'].flatMap(periodKey => fieldsToEdit.map(([field, label]) => (
                        <Input key={`${periodKey}-${field}`} label={`${label} · ${periodKey === 'cy' ? 'Current year' : 'Prior year'}`}
                          type="number" value={shareClass[periodKey]?.[field] ?? ''}
                          onChange={value => changeShareDetail(note.title, periodKey, field, value)} />
                      )))}
                      <button disabled={!editable || busy} onClick={() => saveStructuredDetails(note)}
                        className="justify-self-start rounded-md border border-indigo-300 px-3 py-2 text-xs font-medium text-indigo-900 disabled:opacity-40">Save structured details</button>
                    </div>
                  })()}
                </details>}
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
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <span>Version {output.version} · Final TB v{output.final_tb_version}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${output.finalised_at ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}>
              {output.finalised_at ? 'Finalised' : 'Draft · not finalised'}
            </span>
          </div>
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
