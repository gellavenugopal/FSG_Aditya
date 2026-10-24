import { ConsolidationContext } from '../../utils/consolidationSelection'
import React, { useState, useEffect, useRef, useContext } from 'react'
import { buildFsSnapshotPayload } from '../../utils/fsSnapshot'
import * as XLSX from 'xlsx-js-style'
import { useFinancials, useConsolidatedFinancials, fetchFinancialsData, fmtINR, DENOMINATIONS } from '../../hooks/useFinancials'
import { unsplitSaleLine } from '../../utils/revenueLines'
import { mapSavedRowsToLiveNotes, parsedNoteData } from '../../utils/savedNoteData'
import { buildFinancialsHTML, buildColumnarHTML } from './buildHTML'
import { buildFinancialsWorkbook, buildColumnarWorkbook } from './buildExcel'
import BranchModeBar from '../shared/BranchModeBar'
import PYModeSelect from '../shared/PYModeSelect'
import { FormatRefButton, SCHEDULE3_SECTIONS } from '../shared/FormatReference'
import { consolidatedPeriodOf } from '../../utils/consolidatedPeriod'

export default function GenerateFinancials({
  entity, activeTB, prevTB, activeRsId, numFormat = 'as_is', onNumFormatChange,
  // Branch mode props — lifted from App.jsx (for view tab sync only)
  fsMode: fsModeFromApp, onFsModeChange, branchTBList = [], selectedBranchTBId, onBranchSelect,
}) {
  const consCtx = useContext(ConsolidationContext)
  const isBranchEntity = !!entity?.has_branches
  const mode    = isBranchEntity ? (fsModeFromApp || 'single') : 'single'
  const setMode = onFsModeChange || (() => {})

  // Always load consolidated data for branch entities (both export options always available)
  const consolidatedFinancials = useConsolidatedFinancials(isBranchEntity ? entity : null, activeRsId, consCtx?.entityPeriodId ?? activeTB?.entity_period_id ?? null, consCtx?.consKey ?? 0)

  // Single-TB financials — uses the currently selected branch TB in branch mode
  const singleTBForExport = isBranchEntity
    ? (branchTBList.find(t => t.id === selectedBranchTBId) || activeTB)
    : activeTB
  const singleFinancials = useFinancials(
    isBranchEntity ? singleTBForExport : activeTB,
    prevTB, entity, activeRsId
  )

  // Summary card shows consolidated data for branch entities (always most useful overview)
  const summaryFinancials = isBranchEntity ? consolidatedFinancials : singleFinancials
  const { data: summaryData, loading: summaryLoading, error: summaryError } = summaryFinancials

  // pendingExport: 'excel'|'pdf'|'cons-excel'|'cons-pdf'|'col-excel'|'col-pdf'
  const [exportingExcel, setExportingExcel] = useState(false)
  const [exportingPDF, setExportingPDF]     = useState(false)
  const [exportingConsExcel, setExportingConsExcel] = useState(false)
  const [exportingConsPDF, setExportingConsPDF]     = useState(false)
  const [exportingColExcel, setExportingColExcel]   = useState(false)
  const [exportingColPDF, setExportingColPDF]       = useState(false)
  const [status, setStatus]                 = useState('')

  const [auditors, setAuditors]             = useState([])
  const [globalAuditors, setGlobalAuditors] = useState([])
  const [signatories, setSignatories]       = useState([])
  // Keyed 'e:<id>' (this auditee) or 'g:<id>' (firm master) — the two sources
  // have independent id sequences, so a bare id would be ambiguous.
  const [selectedAuditorKey, setSelectedAuditorKey] = useState('')
  const [selectedSig1Id, setSelectedSig1Id] = useState('')
  const [selectedSig2Id, setSelectedSig2Id] = useState('')
  const [signNotes, setSignNotes]           = useState(false)
  const [signAnnex, setSignAnnex]           = useState(false)
  const [includeSigningPage, setIncludeSigningPage] = useState(false)
  const [pendingExport, setPendingExport] = useState(null)  // 'excel' | 'pdf' | null
  const [confirmDenom, setConfirmDenom]     = useState(numFormat)
  // Place/Date of signing — asked once in the export-confirmation modal and
  // reused for both Excel and PDF (and every export kind), so they never
  // drift out of sync between the two output formats.
  // Place of signing is the same for almost every engagement, so it is
  // pre-filled rather than retyped each time. The last value used is remembered,
  // so changing it for one client makes that the new default instead of
  // reverting. Falls back to the firm's own place on a fresh install.
  const DEFAULT_SIGN_PLACE = 'Siliguri'
  const [signPlace, setSignPlace] = useState(() => {
    try { return localStorage.getItem('fsg.signPlace') || DEFAULT_SIGN_PLACE }
    catch (_) { return DEFAULT_SIGN_PLACE }
  })
  useEffect(() => {
    try { if (signPlace.trim()) localStorage.setItem('fsg.signPlace', signPlace.trim()) } catch (_) {}
  }, [signPlace])
  const [signDate, setSignDate]             = useState(() => new Date().toISOString().slice(0, 10))
  // Final copy: once the Financial Year is marked Final its Place and Date of Signing are the ones saved in the database
  // (and the year is locked); the boxes below then show them and cannot be edited.
  const epId = singleTBForExport?.entity_period_id ?? activeTB?.entity_period_id
  const [finalInfo, setFinalInfo] = useState(null)
  const [markFinal, setMarkFinal] = useState(false)
  useEffect(() => {
    if (pendingExport) setMarkFinal(false)
    if (!epId) { setFinalInfo(null); return }
    window.api?.getEntityPeriod?.(epId)
      .then(ep => setFinalInfo(ep && ep.is_final ? { place: ep.final_sign_place || '', date: ep.final_sign_date || '', at: ep.finalised_at } : null))
      .catch(() => setFinalInfo(null))
  }, [epId, pendingExport])
  const isFinal = !!finalInfo
  const effSignPlace = isFinal ? finalInfo.place : signPlace
  const effSignDate = isFinal ? finalInfo.date : signDate
  // Snapshot of the finalised figures for Cloudtail MCA (the DR / MCA forms tool): published when the CA marks the year Final at export,
  // and on demand from the Cloudtail card below.
  const publishNext = useRef(false)
  const [snapshotMsg, setSnapshotMsg] = useState('')
  const [snapshots, setSnapshots] = useState([])
  const [publishing, setPublishing] = useState(false)
  const isCompany = parseInt(entity?.constitution) === 3 && !isBranchEntity
  const refreshSnapshots = () => {
    if (!epId) { setSnapshots([]); return }
    window.api?.listFsSnapshots?.(epId).then(l => setSnapshots(l || [])).catch(() => setSnapshots([]))
  }
  const publishSnapshot = async (data, noteDetailsMap) => {
    // the Financial Year's own dates (Master), not the text of the Trial Balance's period
    const eps = await (window.api?.listEntityPeriods?.(entity.id).catch(() => []) || [])
    const ep = (eps || []).find(e => e.id === epId)
    const payload = buildFsSnapshotPayload({
      entity, activeTB: singleTBForExport, data, periodInfo: ep ? { year_label: ep.year_label, date_from: ep.date_from, date_till: ep.date_till } : null, auditor: selectedAuditor, signatories: chosenSignatories,
      signPlace: effSignPlace, signDate: effSignDate, noteDetailsMap, denomination: numFormat,
    })
    const res = await window.api.publishFsSnapshot(entity.id, epId, payload)
    setSnapshotMsg(`Published to Cloudtail: snapshot version ${res.version} of ${payload.period.year_label || 'this year'}.`)
    refreshSnapshots()
    return res
  }
  const publishSnapshotIfAsked = async (data, noteDetailsMap) => {
    if (!publishNext.current) return
    publishNext.current = false
    try { await publishSnapshot(data, noteDetailsMap) }
    catch (err) { setSnapshotMsg(`Error: the figures could not be published to Cloudtail (${err.message || err}). The export itself is not affected - publish again from the Cloudtail card.`) }
  }
  const publishNow = async () => {
    if (!singleTBForExport?.id || !epId) return
    setPublishing(true); setSnapshotMsg('')
    try {
      const data = await fetchFinancialsData(singleTBForExport, prevTB, entity, activeRsId)
      if (!data) throw new Error('No financial data available.')
      const ndList = await (window.api?.listNoteDetails(singleTBForExport?.id).catch(() => []) || [])
      const noteDetailsMap = mapSavedRowsToLiveNotes(ndList, Object.values(data.notes || {}), parsedNoteData)
      await publishSnapshot(data, noteDetailsMap)
    } catch (err) { setSnapshotMsg(`Error: ${err.message || 'Could not publish.'}`) }
    finally { setPublishing(false) }
  }
  useEffect(() => { refreshSnapshots() }, [epId])
  const [sigRefreshTick, setSigRefreshTick] = useState(0)
  const [levelFormat, setLevelFormat]       = useState([])

  useEffect(() => {
    if (!entity?.constitution) return
    window.api?.getLevelFormat(entity.constitution, activeRsId || null)
      .then(lf => setLevelFormat(lf || []))
      .catch(() => {})
  }, [entity?.constitution, activeRsId])

  // Load masters when entity changes or sigRefreshTick increments
  // Auditors + Signatories → entity-scoped Master records (Master tab → Auditor / Signatory)
  useEffect(() => {
    if (!entity?.id) return
    Promise.all([
      window.api?.listAuditors(entity.id) || [],       // entity Auditors
      window.api?.listSignatories(entity.id) || [],    // entity signing authorities
      // The firm master, shared by every auditee — the same two or three firms
      // sign most engagements, so they are offered here rather than being
      // re-entered against each new auditee.
      window.api?.listGlobalAuditors?.().catch(() => []) || [],
    ]).then(([a, s, g]) => {
      setAuditors(a || [])
      setSignatories(s || [])
      setGlobalAuditors(g || [])
      // Pre-select first auditor & first 2 signatories. An auditor recorded
      // against this auditee wins; otherwise fall back to the firm master, so a
      // brand-new auditee still opens with a usable auditor already chosen.
      if (!selectedAuditorKey) {
        if (a?.length) setSelectedAuditorKey(`e:${a[0].id}`)
        else if (g?.length) setSelectedAuditorKey(`g:${g[0].id}`)
      }
      if (s?.length >= 1 && !selectedSig1Id) setSelectedSig1Id(s[0].id)
      if (s?.length >= 2 && !selectedSig2Id) setSelectedSig2Id(s[1].id)
    }).catch(() => {})
  }, [entity?.id, sigRefreshTick])

  const period = isBranchEntity
    ? 'Consolidated'
    : (activeTB?.period || '')
  const prevPeriod = prevTB?.period || ''
  // Heading date for the Consolidated exports (see utils/consolidatedPeriod.js).
  const consolidatedPeriod = consolidatedPeriodOf(branchTBList, consCtx?.entityPeriodId ?? activeTB?.entity_period_id ?? null)

  // selectedAuditor comes from global_signatories; attach firm info for PDF/HTML
  const auditorOptions = [
    ...auditors.map(a => ({ ...a, key: `e:${a.id}`, source: 'entity' })),
    ...globalAuditors.map(a => ({ ...a, key: `g:${a.id}`, source: 'global' })),
  ]
  const selectedAuditor = auditorOptions.find(a => a.key === selectedAuditorKey) || null
  const selectedSig1 = signatories.find(s => s.id === parseInt(selectedSig1Id)) || null
  const selectedSig2 = signatories.find(s => s.id === parseInt(selectedSig2Id)) || null
  const chosenSignatories = [selectedSig1, selectedSig2].filter(Boolean)

  // pendingExport encodes both format and target: 'excel'|'pdf'|'cons-excel'|'cons-pdf'|'col-excel'|'col-pdf'
  const openDenomConfirm = (kind) => {
    setConfirmDenom(numFormat)
    setPendingExport(kind)
  }

  // ── Generic save helper ────────────────────────────────────────────────────
  const saveExcel = async (wb, suffix) => {
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    const eName = (entity?.name || 'FS').replace(/[^A-Za-z0-9]+/g, '_')
    const result = await window.api?.saveFileDialog({
      defaultPath: `${eName}_${suffix}.xlsx`,
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
    })
    if (result?.filePath && buf) {
      await window.api?.writeFile(result.filePath, Array.from(new Uint8Array(buf)))
      setStatus(`Excel saved: ${result.filePath}`)
    }
  }

  const savePDF = async (html, suffix) => {
    const buffer = await window.api?.renderPDF(html)
    const eName = (entity?.name || 'FS').replace(/[^A-Za-z0-9]+/g, '_')
    const result = await window.api?.saveFileDialog({
      defaultPath: `${eName}_${suffix}.pdf`,
      filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
    })
    if (result?.filePath && buffer) {
      const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(Object.values(buffer))
      await window.api?.writeFile(result.filePath, Array.from(bytes))
      setStatus(`PDF saved: ${result.filePath}`)
    }
  }

  // One click, TWO PDFs. The chosen file gets the full document exactly as
  // before (Index page, Balance Sheet, P&L, Notes, Annexures, signing page).
  // A second PDF — without the Index page and without the Annexures, so it opens
  // on the Balance Sheet and ends with the last Note — is written beside it, in
  // the same folder, named "<chosen name>_Without_Index_and_Annexures.pdf".
  // Both are rendered BEFORE the dialog opens, as the single PDF always was, so
  // cancelling the dialog saves neither.
  const savePDFPair = async (htmlFull, htmlBare, suffix) => {
    setStatus('Preparing the full PDF…')
    const full = await window.api?.renderPDF(htmlFull)
    setStatus('Preparing the PDF without Index and Annexures…')
    const bare = await window.api?.renderPDF(htmlBare)
    const eName = (entity?.name || 'FS').replace(/[^A-Za-z0-9]+/g, '_')
    const result = await window.api?.saveFileDialog({
      title: 'Save PDF — the copy without Index and Annexures is saved beside it',
      defaultPath: `${eName}_${suffix}.pdf`,
      filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
    })
    if (!result?.filePath || !full || !bare) { setStatus(''); return }
    const toBytes = (b) => Array.from(b instanceof Uint8Array ? b : new Uint8Array(Object.values(b)))
    const fullPath = /\.pdf$/i.test(result.filePath) ? result.filePath : `${result.filePath}.pdf`
    const barePath = `${fullPath.replace(/\.pdf$/i, '')}_Without_Index_and_Annexures.pdf`
    await window.api?.writeFile(fullPath, toBytes(full))
    try {
      await window.api?.writeFile(barePath, toBytes(bare))
    } catch (err) {
      setStatus(`PDF saved: ${fullPath}. The copy without Index and Annexures could NOT be saved (${err?.message || 'write failed'}) — is a file of that name open in a PDF viewer?`)
      return
    }
    setStatus(`2 PDFs saved: ${fullPath}  and  ${barePath}`)
  }

  // ── Single-TB export (original behaviour) ──────────────────────────────────
  // Fetches a FRESH snapshot at click-time rather than reusing the hook's
  // cached `data` — that cache only refetches on mount / explicit refresh(),
  // so if categorisation changed on another tab since this one was mounted,
  // the export would otherwise silently use stale data (wrong note numbers,
  // wrong totals).
  const runExcelExport = async (denom) => {
    if (!singleTBForExport?.id) return
    setStatus(''); setExportingExcel(true)
    try {
      const data = await fetchFinancialsData(singleTBForExport, prevTB, entity, activeRsId)
      if (!data) throw new Error('No financial data available.')
      const ndList = await (window.api?.listNoteDetails(singleTBForExport?.id).catch(() => []) || [])
      const liveNotes = Object.values(data.notes || {})
      const noteDetailsMap = mapSavedRowsToLiveNotes(ndList, liveNotes, parsedNoteData)
      const ndiscList = await (window.api?.listNoteDisclosures(singleTBForExport?.id).catch(() => []) || [])
      const noteDisclosureMap = mapSavedRowsToLiveNotes(ndiscList, liveNotes, n => n.text)
      // Manual custom face lines (e.g. Tax Expense "+ Add Line", non-corp only)
      data.manualTaxLines = await (window.api?.listManualFaceLines(singleTBForExport?.id, 'tax-expense-noncorp').catch(() => []) || [])
      await publishSnapshotIfAsked(data, noteDetailsMap)
      const wb = buildFinancialsWorkbook({
        entity, activeTB: singleTBForExport, prevTB, data, levelFormat,
        auditor: selectedAuditor, signatories: chosenSignatories,
        denomination: denom, noteDetailsMap, noteDisclosureMap,
        signPlace: effSignPlace, signDate: effSignDate,
      })
      await saveExcel(wb, `Financials_${(singleTBForExport?.period || 'export').replace(/\s+/g, '_')}`)
    } catch (err) { setStatus(`Error: ${err.message || 'Excel export failed'}`) }
    finally { setExportingExcel(false) }
  }

  // ── Single-TB PDF ─────────────────────────────────────────────────────────
  const runPDFExport = async (denom) => {
    if (!singleTBForExport?.id) return
    setStatus(''); setExportingPDF(true)
    try {
      const data = await fetchFinancialsData(singleTBForExport, prevTB, entity, activeRsId)
      if (!data) throw new Error('No financial data available.')
      const ndList = await (window.api?.listNoteDetails(singleTBForExport?.id).catch(() => []) || [])
      const liveNotes = Object.values(data.notes || {})
      const noteDetailsMap = mapSavedRowsToLiveNotes(ndList, liveNotes, parsedNoteData)
      const ndiscList = await (window.api?.listNoteDisclosures(singleTBForExport?.id).catch(() => []) || [])
      const noteDisclosureMap = mapSavedRowsToLiveNotes(ndiscList, liveNotes, n => n.text)
      data.manualTaxLines = await (window.api?.listManualFaceLines(singleTBForExport?.id, 'tax-expense-noncorp').catch(() => []) || [])
      await publishSnapshotIfAsked(data, noteDetailsMap)
      const docOpts = {
        entity, activeTB: singleTBForExport, prevTB, data,
        auditor: selectedAuditor, signatories: chosenSignatories,
        signNotes, signAnnex,
        denomination: denom, noteDetailsMap, noteDisclosureMap,
        signPlace: effSignPlace, signDate: effSignDate,
      }
      const html = buildFinancialsHTML({ ...docOpts, includeSigningPage })
      const htmlBare = buildFinancialsHTML({ ...docOpts, includeSigningPage: false, includeIndex: false, includeAnnexures: false })
      await savePDFPair(html, htmlBare, `Financials_${(singleTBForExport?.period || 'export').replace(/\s+/g, '_')}`)
    } catch (err) { setStatus(`Error: ${err.message || 'PDF export failed'}`) }
    finally { setExportingPDF(false) }
  }

  // ── Consolidated Excel ────────────────────────────────────────────────────
  const runConsExcelExport = async (denom) => {
    if (!entity?.id) return
    setStatus(''); setExportingConsExcel(true)
    try {
      const data = await fetchFinancialsData({ id: '__consolidated__', entity_id: entity.id, entity_period_id: consCtx?.entityPeriodId ?? singleTBForExport?.entity_period_id ?? activeTB?.entity_period_id }, null, entity, activeRsId)
      if (!data) throw new Error('No financial data available.')
      const ndList = await (window.api?.listEntityNoteDetails(entity.id).catch(() => []) || [])
      const noteDetailsMap = mapSavedRowsToLiveNotes(ndList, Object.values(data.notes || {}), parsedNoteData)
      const ndiscList = await (window.api?.listEntityNoteDisclosures?.(entity.id).catch(() => []) || [])
      const noteDisclosureMap = mapSavedRowsToLiveNotes(ndiscList, Object.values(data.notes || {}), n => n.text)
      const tbLabel = { period: consolidatedPeriod }
      const wb = buildFinancialsWorkbook({
        entity, activeTB: tbLabel, prevTB: null, data, levelFormat,
        auditor: selectedAuditor, signatories: chosenSignatories,
        denomination: denom, noteDetailsMap, noteDisclosureMap,
        signPlace: effSignPlace, signDate: effSignDate,
      })
      await saveExcel(wb, 'Consolidated')
    } catch (err) { setStatus(`Error: ${err.message || 'Excel export failed'}`) }
    finally { setExportingConsExcel(false) }
  }

  // ── Consolidated PDF ──────────────────────────────────────────────────────
  const runConsPDFExport = async (denom) => {
    if (!entity?.id) return
    setStatus(''); setExportingConsPDF(true)
    try {
      const data = await fetchFinancialsData({ id: '__consolidated__', entity_id: entity.id, entity_period_id: consCtx?.entityPeriodId ?? singleTBForExport?.entity_period_id ?? activeTB?.entity_period_id }, null, entity, activeRsId)
      if (!data) throw new Error('No financial data available.')
      const ndList = await (window.api?.listEntityNoteDetails(entity.id).catch(() => []) || [])
      const noteDetailsMap = mapSavedRowsToLiveNotes(ndList, Object.values(data.notes || {}), parsedNoteData)
      const ndiscList = await (window.api?.listEntityNoteDisclosures?.(entity.id).catch(() => []) || [])
      const noteDisclosureMap = mapSavedRowsToLiveNotes(ndiscList, Object.values(data.notes || {}), n => n.text)
      const tbLabel = { period: consolidatedPeriod }
      const docOpts = {
        entity, activeTB: tbLabel, prevTB: null, data,
        auditor: selectedAuditor, signatories: chosenSignatories,
        signNotes, signAnnex,
        denomination: denom, noteDetailsMap, noteDisclosureMap,
        signPlace: effSignPlace, signDate: effSignDate,
      }
      const html = buildFinancialsHTML({ ...docOpts, includeSigningPage })
      const htmlBare = buildFinancialsHTML({ ...docOpts, includeSigningPage: false, includeIndex: false, includeAnnexures: false })
      await savePDFPair(html, htmlBare, 'Consolidated')
    } catch (err) { setStatus(`Error: ${err.message || 'PDF export failed'}`) }
    finally { setExportingConsPDF(false) }
  }

  // ── Columnar Excel ────────────────────────────────────────────────────────
  const runColExcelExport = async (denom) => {
    setStatus(''); setExportingColExcel(true)
    try {
      const branchTBsData = await window.api?.getBranchTBsData(entity.id)
      if (!branchTBsData?.length) throw new Error('No branch Trial Balances found. Please upload and map TBs for each branch first.')
      // the Auditee's General Notes (Significant Accounting Policies ...), as the Consolidated statements carry them
      const gdata = await fetchFinancialsData({ id: '__consolidated__', entity_id: entity.id, entity_period_id: consCtx?.entityPeriodId ?? activeTB?.entity_period_id }, null, entity, activeRsId).catch(() => null)
      const wb = buildColumnarWorkbook({ entity, branchTBsData, denomination: denom, levelFormat, generalData: gdata,
        auditor: selectedAuditor, signatories: chosenSignatories, signPlace: effSignPlace, signDate: effSignDate })
      await saveExcel(wb, 'Branch_Columnar')
    } catch (err) { setStatus(`Error: ${err.message || 'Excel export failed'}`) }
    finally { setExportingColExcel(false) }
  }

  // ── Columnar PDF ──────────────────────────────────────────────────────────
  const runColPDFExport = async (denom) => {
    setStatus(''); setExportingColPDF(true)
    try {
      const branchTBsData = await window.api?.getBranchTBsData(entity.id)
      if (!branchTBsData?.length) throw new Error('No branch Trial Balances found. Please upload and map TBs for each branch first.')
      const entityNDList = await (window.api?.listEntityNoteDetails(entity.id).catch(() => []) || [])
      const noteDetailsMap = {}
      ;(entityNDList).forEach(n => {
        let d = n.data; if (typeof d === 'string') { try { d = JSON.parse(d) } catch (_) {} }
        noteDetailsMap[Number(n.note_num)] = d
      })
      const gdata = await fetchFinancialsData({ id: '__consolidated__', entity_id: entity.id, entity_period_id: consCtx?.entityPeriodId ?? activeTB?.entity_period_id }, null, entity, activeRsId).catch(() => null)
      const html = buildColumnarHTML({
        entity, branchTBsData,
        auditor: selectedAuditor, signatories: chosenSignatories,
        denomination: denom, noteDetailsMap,
        generalNotes: gdata?.generalNotes || null, signPlace: effSignPlace, signDate: effSignDate,
      })
      await savePDF(html, 'Branch_Columnar')
    } catch (err) { setStatus(`Error: ${err.message || 'PDF export failed'}`) }
    finally { setExportingColPDF(false) }
  }

  if (!isBranchEntity && !activeTB) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        Load a Trial Balance in the Actual TB tab first.
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full p-6 gap-4 overflow-y-auto" style={{ background: 'var(--color-primary-50)' }}>
      <div>
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold" style={{ color: 'var(--color-primary-dark)' }}>Generate Financial Statements</h2>
          <FormatRefButton entity={entity} url={SCHEDULE3_SECTIONS.FULL.url}
            label={SCHEDULE3_SECTIONS.FULL.label} title="Schedule III Format" />
        </div>
        <p className="text-sm text-gray-600 mt-1">
          Export Balance Sheet, Profit & Loss, Notes, and Annexures as a multi-sheet Excel workbook or a print-ready A4 PDF.
        </p>
      </div>

      {/* Mode selector — only visible for branch entities */}
      {isBranchEntity && (
        <div className="bg-white rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border-soft)' }}>
          <div className="px-4 pt-3 pb-1">
            <h3 className="text-sm font-bold" style={{ color: 'var(--color-primary)' }}>Report Mode</h3>
            <p className="text-xs text-gray-500 mt-1 mb-2">
              This entity has branches. The mode selected here is synced with the BS / PL / Notes / Annexures tabs.
            </p>
          </div>
          <BranchModeBar
            fsMode={mode} onFsModeChange={setMode}
            branchTBList={branchTBList}
            selectedBranchTBId={selectedBranchTBId}
            onBranchSelect={onBranchSelect}
          />
        </div>
      )}

      {/* Summary card */}
      <div className="bg-white rounded-lg border p-4" style={{ borderColor: 'var(--color-border-soft)' }}>
        <h3 className="text-sm font-bold mb-2" style={{ color: 'var(--color-primary)' }}>Summary</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div><div className="text-xs text-gray-500">Entity</div><div className="font-semibold text-gray-800">{entity?.name || '—'}</div></div>
          <div><div className="text-xs text-gray-500">{isBranchEntity ? 'Branches' : 'Period (CY)'}</div><div className="font-semibold text-gray-800">{isBranchEntity ? (branchTBList.length || '—') : (activeTB?.period || '—')}</div></div>
          <div>
            <div className="text-xs text-gray-500">Period (PY)</div>
            <div className="font-semibold text-gray-800">{(singleFinancials.data?.pyMode && singleFinancials.data.pyMode !== 'required') ? 'Not required' : (prevPeriod || 'Not selected')}</div>
            <PYModeSelect activeTB={isBranchEntity ? singleTBForExport : activeTB} onChanged={() => singleFinancials.refresh?.()} className="mt-1" />
          </div>
          <div><div className="text-xs text-gray-500">Notes (Consolidated)</div><div className="font-semibold text-gray-800">{summaryData ? Object.keys(summaryData.notes).length : 0}</div></div>
        </div>
        {summaryData && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mt-3 pt-3 border-t" style={{ borderColor: 'var(--color-border-soft)' }}>
            <div><div className="text-xs text-gray-500">Total E&L</div><div className="font-mono font-semibold text-gray-800">{fmtINR(summaryData.totalEL)}</div></div>
            <div><div className="text-xs text-gray-500">Total Assets</div><div className="font-mono font-semibold text-gray-800">{fmtINR(summaryData.totalAssets)}</div></div>
            <div><div className="text-xs text-gray-500">Total Income</div><div className="font-mono font-semibold text-gray-800">{fmtINR(summaryData.totalIncome)}</div></div>
            <div><div className="text-xs text-gray-500">Total Expenses</div><div className="font-mono font-semibold text-gray-800">{fmtINR(summaryData.totalExpenses)}</div></div>
          </div>
        )}
        {summaryData && Object.values(summaryData.notes || {}).some(n => unsplitSaleLine(n)) && (
          <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
            ⚠ Revenue from Operations has sales ledgers not yet bifurcated into Sale of Goods / Sale of Services — they print on a line captioned "Sale". Bifurcate them from Notes → Revenue from Operations → Bifurcate.
          </p>
        )}
      </div>

      {/* Signatory selector (only affects PDF) */}
      <div className="bg-white rounded-lg border p-4" style={{ borderColor: 'var(--color-border-soft)' }}>
        <h3 className="text-sm font-bold mb-2" style={{ color: 'var(--color-primary)' }}>Signatures (PDF)</h3>
        <div className="flex items-center justify-between mb-3">
          <div className="flex-1">
            <p className="text-xs text-gray-500 mb-1">
              Balance Sheet and Profit &amp; Loss will always carry a signature footer on every page.
            </p>
            {(auditorOptions.length === 0 || signatories.length === 0) ? (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 inline-block">
                ⚠ No auditors/signatories found. Add them via the <strong>Masters</strong> icon, then click Refresh.
              </p>
            ) : (
              <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1 inline-block">
                ✓ Auditor &amp; signatories auto-loaded from Masters. Modify below if needed.
              </p>
            )}
          </div>
          <button
            onClick={() => setSigRefreshTick(t => t + 1)}
            className="ml-4 shrink-0 px-2.5 py-1 text-xs border border-gray-300 rounded text-gray-600 hover:bg-gray-50 transition"
            title="Reload auditors and signatories from Masters"
          >↺ Refresh</button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Auditor</label>
            <select
              value={selectedAuditorKey}
              onChange={e => setSelectedAuditorKey(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none"
            >
              <option value="">— None —</option>
              {auditors.length > 0 && (
                <optgroup label="This auditee">
                  {auditors.map(a => (
                    <option key={`e:${a.id}`} value={`e:${a.id}`}>
                      {a.name}{a.designation ? `, ${a.designation}` : ''}{a.membership_number ? ` (M.No. ${a.membership_number})` : ''}
                    </option>
                  ))}
                </optgroup>
              )}
              {globalAuditors.length > 0 && (
                <optgroup label="Audit firm master (all auditees)">
                  {globalAuditors.map(a => (
                    <option key={`g:${a.id}`} value={`g:${a.id}`}>
                      {a.firm_name ? `${a.firm_name} — ` : ''}{a.name}{a.designation ? `, ${a.designation}` : ''}{a.membership_number ? ` (M.No. ${a.membership_number})` : ''}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Signatory 1</label>
            <select
              value={selectedSig1Id}
              onChange={e => setSelectedSig1Id(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none"
            >
              <option value="">— None —</option>
              {signatories.filter(s => s.id !== parseInt(selectedSig2Id)).map(s => (
                <option key={s.id} value={s.id}>{s.name}{s.designation ? ` (${s.designation})` : ''}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Signatory 2</label>
            <select
              value={selectedSig2Id}
              onChange={e => setSelectedSig2Id(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none"
            >
              <option value="">— None —</option>
              {signatories.filter(s => s.id !== parseInt(selectedSig1Id)).map(s => (
                <option key={s.id} value={s.id}>{s.name}{s.designation ? ` (${s.designation})` : ''}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Per-page signature toggles */}
        <div className="mt-4 pt-3 border-t" style={{ borderColor: 'var(--color-border-soft)' }}>
          <div className="text-xs font-semibold text-gray-700 mb-2">Include signature footer on every page of:</div>
          <div className="flex flex-wrap items-center gap-5">
            <label className="flex items-center gap-2 text-sm text-gray-500 cursor-not-allowed">
              <input type="checkbox" checked disabled className="rounded border-gray-300" />
              Balance Sheet <span className="text-xs text-gray-400">(always on)</span>
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-500 cursor-not-allowed">
              <input type="checkbox" checked disabled className="rounded border-gray-300" />
              Profit &amp; Loss <span className="text-xs text-gray-400">(always on)</span>
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={signNotes}
                onChange={e => setSignNotes(e.target.checked)}
                className="rounded border-gray-300"
              />
              Notes
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={signAnnex}
                onChange={e => setSignAnnex(e.target.checked)}
                className="rounded border-gray-300"
              />
              Annexures
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer ml-auto">
              <input
                type="checkbox"
                checked={includeSigningPage}
                onChange={e => setIncludeSigningPage(e.target.checked)}
                className="rounded border-gray-300"
              />
              Also include a dedicated final signing page
            </label>
          </div>
        </div>
      </div>

      {summaryLoading && <div className="text-gray-500 text-sm">Loading financial data...</div>}
      {summaryError && <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded px-3 py-2">{summaryError}</div>}

      {/* ── Export buttons: branch entities get two separate sections ── */}
      {isBranchEntity ? (
        <div className="flex flex-col gap-4">

          {/* Consolidated section */}
          <div className="bg-white rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border-soft)' }}>
            <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: 'var(--color-border-soft)', background: 'var(--color-primary-50)' }}>
              <span className="text-base">🔀</span>
              <div>
                <h3 className="text-sm font-bold" style={{ color: 'var(--color-primary-dark)' }}>Consolidated Financial Statements</h3>
                <p className="text-xs text-gray-500">All branches summed — single BS, PL, Notes, Annexures</p>
              </div>
            </div>
            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <div className="text-xs text-gray-600 font-medium">📊 Excel workbook</div>
                <ul className="text-xs text-gray-500 list-disc pl-4 space-y-0.5 mb-3">
                  <li>Balance Sheet · Profit &amp; Loss · Notes · Annexures</li>
                  <li>All branches combined into one set of figures</li>
                </ul>
                <button
                  onClick={() => openDenomConfirm('cons-excel')}
                  disabled={!consolidatedFinancials.data || exportingConsExcel}
                  className="py-2 rounded text-white text-sm font-medium transition disabled:opacity-40"
                  style={{ background: 'var(--color-primary)' }}
                >
                  {exportingConsExcel ? 'Generating…' : 'Download Consolidated Excel (.xlsx)'}
                </button>
              </div>
              <div className="flex flex-col gap-2">
                <div className="text-xs text-gray-600 font-medium">📄 PDF (A4 portrait)</div>
                <ul className="text-xs text-gray-500 list-disc pl-4 space-y-0.5 mb-3">
                  <li>Cover page, BS, PL, Notes, Annexures</li>
                  <li>Signing page with auditor &amp; signatories</li>
                  <li>Saves <strong>two PDFs</strong> in the folder you choose: the full document, and a copy without the Index and Annexures</li>
                </ul>
                <button
                  onClick={() => openDenomConfirm('cons-pdf')}
                  disabled={!consolidatedFinancials.data || exportingConsPDF}
                  className="py-2 rounded text-white text-sm font-medium transition disabled:opacity-40"
                  style={{ background: 'var(--color-primary)' }}
                >
                  {exportingConsPDF ? 'Generating…' : 'Download Consolidated PDF'}
                </button>
              </div>
            </div>
          </div>

          {/* Branch-wise Columnar section */}
          <div className="bg-white rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border-soft)' }}>
            <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: 'var(--color-border-soft)', background: '#f0fdf4' }}>
              <span className="text-base">📊</span>
              <div>
                <h3 className="text-sm font-bold text-green-800">Branch-wise Columnar Financial Statements</h3>
                <p className="text-xs text-gray-500">Each branch as a column, with a Total column — BS and PL side-by-side, Annexures per branch</p>
              </div>
            </div>
            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <div className="text-xs text-gray-600 font-medium">📊 Excel workbook</div>
                <ul className="text-xs text-gray-500 list-disc pl-4 space-y-0.5 mb-3">
                  <li>Sheet "BS (Columnar)" — branches side-by-side + Total</li>
                  <li>Sheet "PL (Columnar)" — branches side-by-side + Total</li>
                  <li>One "Annex - Branch" sheet per branch</li>
                </ul>
                <button
                  onClick={() => openDenomConfirm('col-excel')}
                  disabled={exportingColExcel}
                  className="py-2 rounded text-sm font-medium transition disabled:opacity-40 text-white"
                  style={{ background: '#16a34a' }}
                >
                  {exportingColExcel ? 'Generating…' : 'Download Columnar Excel (.xlsx)'}
                </button>
              </div>
              <div className="flex flex-col gap-2">
                <div className="text-xs text-gray-600 font-medium">📄 PDF (A4 landscape)</div>
                <ul className="text-xs text-gray-500 list-disc pl-4 space-y-0.5 mb-3">
                  <li>BS and PL in landscape columnar layout</li>
                  <li>Annexures per branch with branch name header</li>
                </ul>
                <button
                  onClick={() => openDenomConfirm('col-pdf')}
                  disabled={exportingColPDF}
                  className="py-2 rounded text-sm font-medium transition disabled:opacity-40 text-white"
                  style={{ background: '#16a34a' }}
                >
                  {exportingColPDF ? 'Generating…' : 'Download Columnar PDF'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* ── Single-entity export (original layout) ── */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white rounded-lg border p-5 flex flex-col" style={{ borderColor: 'var(--color-border-soft)' }}>
            <div className="flex items-start gap-3 mb-3">
              <div className="text-3xl">📊</div>
              <div>
                <h3 className="text-sm font-bold text-gray-800">Export to Excel</h3>
                <p className="text-xs text-gray-500 mt-1">Multi-sheet workbook with BS, P&amp;L, Notes, and Annexures.</p>
              </div>
            </div>
            <ul className="text-xs text-gray-600 list-disc pl-5 mb-4 space-y-0.5">
              <li>Sheet 1: Balance Sheet</li>
              <li>Sheet 2: Profit &amp; Loss</li>
              <li>Sheet 3: Notes (group totals)</li>
              <li>Sheet 4: Annexures (ledger-level detail)</li>
            </ul>
            <button
              onClick={() => openDenomConfirm('excel')}
              disabled={!singleFinancials.data || exportingExcel}
              className="mt-auto py-2 rounded text-white text-sm font-medium transition disabled:opacity-40"
              style={{ background: 'var(--color-primary)' }}
            >
              {exportingExcel ? 'Generating Excel...' : 'Download Excel (.xlsx)'}
            </button>
          </div>
          <div className="bg-white rounded-lg border p-5 flex flex-col" style={{ borderColor: 'var(--color-border-soft)' }}>
            <div className="flex items-start gap-3 mb-3">
              <div className="text-3xl">📄</div>
              <div>
                <h3 className="text-sm font-bold text-gray-800">Export to PDF (A4)</h3>
                <p className="text-xs text-gray-500 mt-1">Print-ready A4 PDF with BS, PL, Notes, Annexures, signing page — plus a second PDF without the Index and Annexures.</p>
              </div>
            </div>
            <ul className="text-xs text-gray-600 list-disc pl-5 mb-4 space-y-0.5">
              <li>Cover / Balance Sheet / P&amp;L / Notes</li>
              <li>Annexures with ledger-level details</li>
              <li>Signing page — Auditor (left) / Management (right)</li>
              <li>Saves <strong>two PDFs</strong> in the folder you choose: the full document, and a copy that starts at the Balance Sheet and ends with the last Note (no Index, no Annexures)</li>
            </ul>
            <button
              onClick={() => openDenomConfirm('pdf')}
              disabled={!singleFinancials.data || exportingPDF}
              className="mt-auto py-2 rounded text-white text-sm font-medium transition disabled:opacity-40"
              style={{ background: 'var(--color-primary)' }}
            >
              {exportingPDF ? 'Generating PDF...' : 'Download PDF'}
            </button>
          </div>
        </div>
      )}

      {/* Cloudtail MCA: the finalised figures, published as a snapshot (Companies) */}
      {isCompany && epId && (
        <div className="rounded border border-gray-200 bg-white px-4 py-3 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[260px]">
            <div className="text-sm font-semibold text-gray-800">Cloudtail MCA - publish figures</div>
            <div className="text-xs text-gray-500">
              Cloudtail (Directors' Report, AOC-4, MGT-7) takes every figure from a snapshot of these statements, never from the Trial Balance.
              Ticking Final when you generate the PDF / Excel publishes one automatically; publish again here after any later change.
              {snapshots.length > 0
                ? <span> Last published: version {snapshots[0].version}, {new Date(snapshots[0].created_at).toLocaleString('en-GB')} (v{snapshots[0].app_version || '?'}).</span>
                : <span> Nothing published yet for this year.</span>}
            </div>
          </div>
          <button onClick={publishNow} disabled={publishing || !singleFinancials.data}
            className="py-2 px-4 rounded text-white text-sm font-medium transition disabled:opacity-40" style={{ background: 'var(--color-primary)' }}>
            {publishing ? 'Publishing...' : 'Publish to Cloudtail'}
          </button>
        </div>
      )}
      {snapshotMsg && (
        <div className={`text-sm rounded px-3 py-2 border ${snapshotMsg.startsWith('Error') ? 'bg-red-50 border-red-200 text-red-700' : 'bg-green-50 border-green-200 text-green-700'}`}>
          {snapshotMsg}
        </div>
      )}

      {/* Denomination + Place/Date confirmation modal — shared by every export
          kind (single/consolidated × Excel/PDF) so Place & Date are asked
          exactly once and stay identical across both output formats. */}
      {pendingExport && (
        <div className="modal-backdrop" onClick={() => setPendingExport(null)}>
          <div className="modal-box max-w-md" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold mb-2" style={{ color: 'var(--color-primary)' }}>Confirm Export Details</h2>
            <p className="text-xs text-gray-500 mb-3">
              Figures will be displayed using the denomination below.
            </p>
            <div className="space-y-2 mb-4">
              {Object.entries(DENOMINATIONS).map(([key, cfg]) => (
                <label key={key} className="flex items-start gap-2 p-2 rounded border border-gray-200 cursor-pointer hover:bg-gray-50">
                  <input type="radio" name="denom" checked={confirmDenom === key}
                    onChange={() => setConfirmDenom(key)} className="mt-0.5" />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-800">{cfg.label}</div>
                    {cfg.unit && <div className="text-xs text-gray-500 italic">{cfg.unit}</div>}
                  </div>
                </label>
              ))}
            </div>

            {/* Columnar exports carry no signature block, so Place/Date don't apply */}
            {!['col-excel', 'col-pdf'].includes(pendingExport) && (
              <div className="border-t pt-3 mb-4" style={{ borderColor: 'var(--color-border-soft)' }}>
                <div className="text-xs font-semibold text-gray-700 mb-1">Place &amp; Date of Signing</div>
                <p className="text-xs text-gray-500 mb-2">
                  Printed below the auditor's and directors' signatures — same value used in both Excel and PDF.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Place</label>
                    <input
                      type="text" value={effSignPlace} disabled={isFinal} onChange={e => setSignPlace(e.target.value)}
                      placeholder="e.g. Siliguri"
                      className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Date</label>
                    <input
                      type="date" value={effSignDate} disabled={isFinal} onChange={e => setSignDate(e.target.value)}
                      className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Final copy: fixes Place / Date of Signing in the database and locks the Financial Year */}
            {!['col-excel', 'col-pdf'].includes(pendingExport) && (isFinal ? (
              <div className="mb-4 rounded border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
                <div className="font-semibold">🔒 Final</div>
                Place and Date of Signing are locked and this Financial Year is locked
                {finalInfo.at ? ` (marked Final on ${new Date(finalInfo.at).toLocaleDateString('en-GB')})` : ''}.
                To change them, unlock the Financial Year in Master → Auditee (Edit).
              </div>
            ) : (
              <label className="mb-4 flex items-start gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 cursor-pointer">
                <input type="checkbox" className="mt-0.5" checked={markFinal} onChange={e => setMarkFinal(e.target.checked)} />
                <span className="text-xs text-amber-900">
                  <span className="font-semibold">This is the final copy.</span> Save this Place and Date of Signing in the database, lock them,
                  and lock this Financial Year (no further changes to its Trial Balance, mapping or figures until it is unlocked in Master).
                </span>
              </label>
            ))}

            <div className="flex gap-2">
              <button onClick={() => setPendingExport(null)}
                className="flex-1 py-2 border border-gray-300 text-gray-600 rounded text-sm hover:bg-gray-50 transition">
                Cancel
              </button>
              <button
                disabled={!['col-excel', 'col-pdf'].includes(pendingExport) && (!effSignPlace.trim() || (markFinal && !isFinal && !signDate))}
                onClick={async () => {
                  if (markFinal && !isFinal && !['col-excel', 'col-pdf'].includes(pendingExport)) {
                    if (!epId) { setPendingExport(null); setStatus('Error: this Trial Balance is not tied to a Financial Year, so it cannot be marked Final.'); return }
                    try { await window.api.finaliseEntityPeriod(epId, signPlace.trim(), signDate) }
                    catch (err) { setPendingExport(null); setStatus(`Error: ${err.message || 'Could not mark the Financial Year Final.'}`); return }
                    setMarkFinal(false)
                    // marking the year Final also publishes its figures to Cloudtail (single-entity exports of a Company)
                    if (isCompany && ['excel', 'pdf'].includes(pendingExport)) publishNext.current = true
                  }
                  onNumFormatChange?.(confirmDenom)
                  const kind = pendingExport
                  setPendingExport(null)
                  const d = confirmDenom
                  if (kind === 'excel')      runExcelExport(d)
                  else if (kind === 'pdf')   runPDFExport(d)
                  else if (kind === 'cons-excel') runConsExcelExport(d)
                  else if (kind === 'cons-pdf')   runConsPDFExport(d)
                  else if (kind === 'col-excel')  runColExcelExport(d)
                  else if (kind === 'col-pdf')    runColPDFExport(d)
                }}
                className="flex-1 py-2 rounded text-white text-sm font-medium transition disabled:opacity-40"
                style={{ background: 'var(--color-primary)' }}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {status && (
        <div className={`text-sm rounded px-3 py-2 border ${
          status.startsWith('Error') ? 'bg-red-50 border-red-200 text-red-700' : 'bg-green-50 border-green-200 text-green-700'
        }`}>
          {status}
        </div>
      )}
    </div>
  )
}
