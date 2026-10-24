import React, { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx-js-style'
import { FORMAT_KINDS, FORMAT_PERIOD, FORMAT_PREV_PERIOD, blankFormatData, blankFormatEntity, blankNoteDetails } from '../../utils/blankFormat'
import { buildFinancialsHTML } from '../GenerateFinancials/buildHTML'
import { buildFinancialsWorkbook } from '../GenerateFinancials/buildExcel'

/**
 * Features > Format > Proprietorship / Partnership / LLP / Company.
 *
 * The Balance Sheet, Statement of Profit and Loss and every note — Fill Details
 * tables included — as the tool lays them out for that constitution, with no
 * figures: the reference for what the tool does, and a way to spot a layout
 * error before it reaches a client. Built from the mapping rules by the same
 * code that builds a real set of financials (see utils/blankFormat.js).
 * Nothing is read from or saved to any entity.
 */
export default function Format({ kind }) {
  const [lfRows, setLfRows] = useState(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState('')
  const k = FORMAT_KINDS[kind]

  useEffect(() => {
    let live = true
    setLfRows(null); setError(''); setStatus('')
    Promise.resolve(window.api?.getLevelFormat?.(k.constitution, null))
      .then(rows => { if (live) setLfRows(rows || []) })
      .catch(err => { if (live) setError(err?.message || 'Could not read the mapping rules.') })
    return () => { live = false }
  }, [kind])

  const built = useMemo(() => {
    if (!lfRows) return null
    if (!lfRows.length) return { empty: true }
    try {
      const data = blankFormatData(lfRows, kind)
      const { noteDetailsMap } = blankNoteDetails(kind, data.activeNotes)
      const entity = blankFormatEntity(kind)
      const docOpts = {
        entity, activeTB: { id: 0, period: FORMAT_PERIOD }, prevTB: { id: 0, period: FORMAT_PREV_PERIOD },
        data, auditor: null, signatories: [], noteDetailsMap, noteDisclosureMap: {}, signPlace: '', signDate: '',
      }
      // The cover's index also lists Annexures (ledger-level, none here) and Signatures.
      const html = buildFinancialsHTML({ ...docOpts, includeAnnexures: false, includeSigningPage: false })
        .replace(/<div class="cover-index-item"><span>(?:Annexures[^<]*|Signatures)<\/span><span>[^<]*<\/span><\/div>/g, '')
      return { data, entity, docOpts, html, notes: data.activeNotes.length }
    } catch (err) {
      return { failed: err?.message || String(err) }
    }
  }, [lfRows, kind])

  const stem = `Format_${k.label}_Blank`
  const savePDF = async () => {
    setBusy('pdf'); setStatus('')
    try {
      const buffer = await window.api?.renderPDF(built.html)
      const result = await window.api?.saveFileDialog({ defaultPath: `${stem}.pdf`, filters: [{ name: 'PDF Document', extensions: ['pdf'] }] })
      if (result?.filePath && buffer) {
        const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(Object.values(buffer))
        await window.api?.writeFile(result.filePath, Array.from(bytes))
        setStatus(`PDF saved: ${result.filePath}`)
      }
    } catch (err) { setStatus(`Error: ${err?.message || 'PDF could not be created'}`) } finally { setBusy('') }
  }
  const saveExcel = async () => {
    setBusy('excel'); setStatus('')
    try {
      const wb = buildFinancialsWorkbook({ ...built.docOpts, levelFormat: built.data.levelFormat })
      // Annexures list ledgers; a format has none.
      const at = wb.SheetNames.indexOf('Annexures')
      if (at >= 0) { wb.SheetNames.splice(at, 1); delete wb.Sheets.Annexures }
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
      const result = await window.api?.saveFileDialog({ defaultPath: `${stem}.xlsx`, filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }] })
      if (result?.filePath && buf) {
        await window.api?.writeFile(result.filePath, Array.from(new Uint8Array(buf)))
        setStatus(`Excel saved: ${result.filePath}`)
      }
    } catch (err) { setStatus(`Error: ${err?.message || 'Excel could not be created'}`) } finally { setBusy('') }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-white shrink-0 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-gray-800">Format — {k.label}</h2>
          <p className="text-xs text-gray-500">
            Balance Sheet, Statement of Profit and Loss and all notes with blank Fill Details, exactly as the tool lays them out for a {k.label}. Nothing here is saved or linked to any auditee.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {status && <span className={`text-xs ${status.startsWith('Error') ? 'text-red-600' : 'text-gray-500'}`}>{status}</span>}
          <button disabled={!built?.html || !!busy} onClick={savePDF}
            className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">
            {busy === 'pdf' ? 'Preparing…' : 'Download PDF'}
          </button>
          <button disabled={!built?.html || !!busy} onClick={saveExcel}
            className="px-3 py-1.5 text-sm rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-40">
            {busy === 'excel' ? 'Preparing…' : 'Download Excel'}
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 bg-gray-100">
        {error && <p className="p-4 text-sm text-red-600">{error}</p>}
        {!error && !built && <p className="p-4 text-sm text-gray-500">Building the format…</p>}
        {built?.empty && <p className="p-4 text-sm text-amber-700">No mapping rules were found for this constitution, so there is nothing to lay out.</p>}
        {built?.failed && <p className="p-4 text-sm text-red-600">The format could not be built: {built.failed}</p>}
        {built?.html && (
          <iframe title={`Format — ${k.label}`} srcDoc={built.html} className="w-full h-full border-0 bg-white" />
        )}
      </div>
    </div>
  )
}
