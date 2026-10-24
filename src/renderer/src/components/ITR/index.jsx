import React, { useEffect, useMemo, useState } from 'react'
import ITRSectionTable from './ITRSectionTable'
import ITRDetailsTable from './ITRDetailsTable'
import { ITR_DETAILS_BLOCKS } from '../../utils/itrDetailsBlocks'
import { buildRowIndex, computeITRValues } from '../../utils/itrFormula'
import { individualBS, individualManufacturing, individualTrading, individualPL } from '../../utils/itrStructure/individual'
import { partnershipBS, partnershipManufacturing, partnershipTrading, partnershipPL } from '../../utils/itrStructure/partnership'
import { companyBS, companyManufacturing, companyTrading, companyPL } from '../../utils/itrStructure/company'
import { fetchFinancialsData } from '../../hooks/useFinancials'
import { pullITRFromFinancials } from '../../utils/itrPull'

function resolveGroup(entity) {
  const disp = (entity?.constitution_display || '').toLowerCase()
  if (disp.includes('company')) return 'company'
  if (disp.includes('partnership') || disp.includes('llp')) return 'partnership'
  if (disp.includes('individual') || disp.includes('huf') || disp.includes('proprietor')) return 'individual'
  const c = parseInt(entity?.constitution)
  if (c === 3) return 'company'
  if (c === 2) return 'partnership'
  return 'individual'
}

const SCHEMAS = {
  individual: { bs: individualBS, mfg: individualManufacturing, trading: individualTrading, pl: individualPL },
  partnership: { bs: partnershipBS, mfg: partnershipManufacturing, trading: partnershipTrading, pl: partnershipPL },
  company: { bs: companyBS, mfg: companyManufacturing, trading: companyTrading, pl: companyPL },
}

export default function ITR({ entity, activeTB, activeRsId, activeLeaf }) {
  const group = resolveGroup(entity)
  const schema = SCHEMAS[group]

  const [formValues, setFormValues] = useState({})
  const [detailsData, setDetailsData] = useState({})
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [pullCheck, setPullCheck] = useState(null)   // { fromStatements, onForm } profit before tax after a pull

  const tbId = activeTB?.id

  useEffect(() => {
    setLoaded(false)
    if (!tbId) { setFormValues({}); setDetailsData({}); setLoaded(true); return }
    window.api?.getItrDetails?.(tbId).then((saved) => {
      setFormValues(saved?.formValues || {})
      setDetailsData(saved?.detailsData || {})
      setDirty(false)
      setLoaded(true)
    }).catch(() => setLoaded(true))
  }, [tbId])

  const rowIndex = useMemo(() => buildRowIndex([schema.bs, schema.mfg, schema.trading, schema.pl]), [schema])
  const values = useMemo(() => computeITRValues(rowIndex, formValues, detailsData), [rowIndex, formValues, detailsData])

  const onChangeCell = (id, val) => {
    setFormValues((prev) => ({ ...prev, [id]: val }))
    setDirty(true)
  }

  const onChangeDetails = (blockKey, rows) => {
    setDetailsData((prev) => ({ ...prev, [blockKey]: rows }))
    setDirty(true)
  }

  // Populates formValues from the SAME live BS/PL/Notes data the BS/PL/Notes
  // screens read (via fetchFinancialsData — the one-shot, always-fresh
  // sibling of the useFinancials() hook), so pulled figures always match
  // what's currently on the face/notes. Best-effort: only the rows itrPull.js
  // has a reliable Schedule III source for get filled; the rest — tax-law-
  // specific fields Schedule III has no equivalent of — stay as-is for the
  // preparer to fill in by hand. Overwrites any already-pulled figures on
  // re-run, so ask first if there's unsaved manual entry that could be lost.
  const pullFromBSPL = async () => {
    if (dirty && !window.confirm('This will overwrite the figures already pulled from BS/PL, and the Details tables it fills (other manual entries are untouched). Continue?')) return
    setPulling(true)
    try {
      // An Auditee with branches files ONE return: its BS, PL and Notes are the Consolidated ones, never a branch's.
      const source = entity?.has_branches
        ? { id: '__consolidated__', entity_id: entity.id, entity_period_id: activeTB?.entity_period_id, period: 'Consolidated' }
        : activeTB
      const data = await fetchFinancialsData(source, null, entity, activeRsId)
      if (!data) throw new Error('Could not load BS/PL data for the current Trial Balance.')
      const pulled = pullITRFromFinancials(group, schema, data)
      const nextForm = { ...formValues, ...pulled.values }
      const nextDetails = { ...detailsData }
      for (const [k, rows] of Object.entries(pulled.details)) nextDetails[k] = rows   // the rows the statements supplied replace that table
      setFormValues(nextForm)
      setDetailsData(nextDetails)
      // profit before tax: the statements' against the form's own, worked out from what was just placed
      const after = computeITRValues(rowIndex, nextForm, nextDetails)
      const pbtRow = schema.pl.rows.find(r => /^profit before taxes/i.test(r.label || ''))
      setPullCheck({ fromStatements: pulled.check.profitBeforeTax, onForm: pbtRow ? Number(after[pbtRow.id]) || 0 : null, cells: Object.keys(pulled.values).length })
      setDirty(true)
    } catch (e) {
      alert('Pull from BS/PL failed: ' + (e?.message || e))
    } finally {
      setPulling(false)
    }
  }

  const save = async () => {
    if (!tbId) return
    setSaving(true)
    try {
      await window.api?.saveItrDetails?.({ tbId, data: { formValues, detailsData } })
      setDirty(false)
    } finally {
      setSaving(false)
    }
  }

  const downloadExcel = async () => {
    setExporting(true)
    try {
      const buf = await window.api?.exportItrExcel?.({ group, formValues, detailsData })
      if (!buf || !buf.length) throw new Error('Export returned no data')
      const constitutionSuffix = group.charAt(0).toUpperCase() + group.slice(1)
      const entityName = (entity?.name || 'Entity').replace(/[\\/:*?"<>|]/g, '_')
      const result = await window.api?.saveFileDialog({
        title: 'Save Filled ITR Format',
        defaultPath: `${entityName}_ITR_${constitutionSuffix}.xlsx`,
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      })
      if (result?.filePath) {
        await window.api?.writeFile(result.filePath, buf)
      }
    } catch (e) {
      alert('Excel export failed: ' + (e?.message || e))
    } finally {
      setExporting(false)
    }
  }

  if (!entity) {
    return <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">Select an entity to open the ITR form.</div>
  }
  if (!tbId) {
    return <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">No current-year Trial Balance selected. ITR figures are editable for the current year only.</div>
  }
  if (!loaded) {
    return <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">Loading…</div>
  }

  const plBlocks = ITR_DETAILS_BLOCKS.filter((b) => b.group === 'plDetails')
  const bsBlocks = ITR_DETAILS_BLOCKS.filter((b) => b.group === 'bsDetails' && (!b.companyOnly || group === 'company'))

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white shrink-0">
        <div className="text-sm text-gray-600">
          <span className="font-semibold text-gray-800">ITR — {activeLeaf?.replace('ITR: ', '')}</span>
          <span className="ml-2 text-xs text-gray-400">({entity?.constitution_display || 'Constitution not set'}, current year only)</span>
        </div>
        <div className="flex items-center gap-2">
          {dirty && <span className="text-[11px] text-amber-600">Unsaved changes</span>}
          <button
            onClick={pullFromBSPL}
            disabled={pulling}
            title="Fills the BS, Manufacturing / Trading / P&L and their Details from the Balance Sheet, Profit & Loss and Notes — tax-law-specific fields still need manual entry."
            className="px-3 py-1 text-xs rounded border border-green-300 bg-white text-green-700 font-medium hover:bg-green-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >{pulling ? 'Pulling…' : '⇩ Pull from BS/PL'}</button>
          <button
            onClick={downloadExcel}
            disabled={exporting}
            className="px-3 py-1 text-xs rounded border border-gray-300 bg-white text-gray-700 font-medium hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >{exporting ? 'Preparing…' : 'Download filled Excel'}</button>
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="px-3 py-1 text-xs rounded bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {pullCheck && (() => {
          const diff = pullCheck.onForm === null ? null : pullCheck.onForm - pullCheck.fromStatements
          const agrees = diff !== null && Math.abs(diff) < 1
          const inr = (n) => (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          return (
            <div className={`mb-3 text-xs rounded border px-3 py-2 ${agrees ? 'bg-green-50 border-green-200 text-green-800' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
              {pullCheck.cells} cells filled from the Balance Sheet, Profit &amp; Loss and Notes.{' '}
              {pullCheck.onForm === null ? '' : agrees
                ? `Profit before tax on the form agrees with the statements (₹ ${inr(pullCheck.fromStatements)}).`
                : `Profit before tax on the form is ₹ ${inr(pullCheck.onForm)}; the statements give ₹ ${inr(pullCheck.fromStatements)} (difference ₹ ${inr(diff)}). Check the Manufacturing / Trading / P&L rows and the Details tables - some ledgers may need to be placed by hand.`}
            </div>
          )
        })()}
        {activeLeaf === 'ITR: BS' && (
          <ITRSectionTable title="Balance Sheet" rows={schema.bs.rows} values={values} formValues={formValues} onChange={onChangeCell} />
        )}

        {activeLeaf === 'ITR: PL' && (
          <>
            <ITRSectionTable title="Manufacturing Account" rows={schema.mfg.rows} values={values} formValues={formValues} onChange={onChangeCell} />
            <ITRSectionTable title="Trading Account" rows={schema.trading.rows} values={values} formValues={formValues} onChange={onChangeCell} />
            <ITRSectionTable title="Profit and Loss Account" rows={schema.pl.rows} values={values} formValues={formValues} onChange={onChangeCell} />
          </>
        )}

        {activeLeaf === 'ITR: BS Details' && (
          bsBlocks.length
            ? bsBlocks.map((b) => (
                <ITRDetailsTable key={b.key} block={b} rows={detailsData[b.key]} onChange={(rows) => onChangeDetails(b.key, rows)} />
              ))
            : <div className="text-sm text-gray-400 italic">No BS Details sub-schedules apply to {entity?.constitution_display}.</div>
        )}

        {activeLeaf === 'ITR: PL Details' && (
          plBlocks.map((b) => (
            <ITRDetailsTable key={b.key} block={b} rows={detailsData[b.key]} onChange={(rows) => onChangeDetails(b.key, rows)} />
          ))
        )}
      </div>
    </div>
  )
}
