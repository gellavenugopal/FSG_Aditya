/**
 * Depreciation — Companies Act 2013, Schedule II (Category-level) — "Dep (Comp)"
 *
 * Separate module from "Dep (Old)" (the pre-existing ledger-level Editor,
 * left untouched) and from "Dep (IT)" (Income Tax Act block-wise WDV). One
 * row per Asset Category (not per ledger) — a plain FILLABLE FORM: every
 * figure (Gross Block, Depreciation, Net Block — Opening/Additions/
 * Deductions/Closing) is typed directly by the preparer. Nothing is computed
 * from a rate/useful-life formula — the app only sums each column into a
 * TOTAL row across categories.
 *
 * An opt-in checkbox surfaces this schedule inside the PPE Note — see
 * note.compScheduleData wiring in useFinancials.js / Notes / buildHTML /
 * buildExcel. Mutually exclusive with Dep (IT)'s own "Include in PPE Note"
 * checkbox — turning one on turns the other off, since only one schedule can
 * appear on the note face at a time.
 */
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import * as XLSX from 'xlsx-js-style'
import { fmtINR, displayAmt, fetchFinancialsData } from '../../hooks/useFinancials'
import { depStoreFor } from '../../utils/depStore'
import { joinDepCompSchedules } from '../../utils/depJoin'
import { withNet, isDerivedField } from '../../utils/depCompNet'
import { buildDepCompBlankTemplate, buildDepCompFilledWorkbook, parseDepCompWorkbook } from './depCompWorkbook'

const INP  = 'w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white'
const NINP = INP + ' text-right font-mono'
const TDI  = 'border border-gray-200 px-1 py-0.5'

const num = v => parseFloat(String(v ?? '').replace(/,/g, '')) || 0
const PPE_NOTE_RX = /property.*plant.*equipment|PPE|fixed assets/i
const ADD_NEW = '__add_new__'

// Every field here is a plain typed number — no computation, no formula.
function emptyCategoryRow(category = '') {
  return {
    category,
    grossOpen: '', additions: '', deductions: '', grossClose: '',
    depOpen: '', depForYear: '', depOnDisposal: '', depClose: '',
    netBlockOpen: '', netBlockClose: '',
  }
}

// One field per data column, same order as the table header — all directly
// fillable, matching the CY row shape (see emptyCategoryRow).
const CATEGORY_ROW_FIELDS = ['grossOpen', 'additions', 'deductions', 'grossClose', 'depOpen', 'depForYear', 'depOnDisposal', 'depClose', 'netBlockOpen', 'netBlockClose']

// Manually-entered Previous Year totals — Total only, not per-Category —
// mirroring Dep (IT)'s own PY totals row (there's no separate PY schedule,
// so the preparer types in whatever comparative figures they have).
const EMPTY_PY_TOTALS = Object.fromEntries(CATEGORY_ROW_FIELDS.map(f => [f, '']))
const pyTotalsNonZero = (py) => !!py && Object.values(py).some(v => num(v) !== 0)

const thGrp = 'border border-blue-700 px-2 py-1 text-center bg-blue-900'
const th = 'border border-blue-700 px-1.5 py-1.5 text-right'

function CategoryRow({ row, scheduleII, onChange, onDelete }) {
  // Custom mode: either explicitly requested (+ Custom Category…), or the
  // saved category doesn't match any Schedule II entry (a custom value
  // loaded back from a previous save) — in both cases show a free-text input
  // instead of the dropdown. scheduleII loads async and is still [] on first
  // mount, so re-sync once it actually arrives — otherwise every saved row
  // would incorrectly stick in custom-input mode (nothing matches an empty
  // list yet) even for genuine Schedule II categories.
  const isKnownCategory = !row.category || scheduleII.some(s => s.category === row.category)
  const [customMode, setCustomMode] = useState(!isKnownCategory)
  useEffect(() => {
    if (scheduleII.length === 0 || !row.category) return
    setCustomMode(!scheduleII.some(s => s.category === row.category))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleII.length > 0])
  return (
    <tr className="hover:bg-blue-50/20">
      <td className={TDI} style={{ minWidth: 200 }}>
        {customMode ? (
          <div className="flex items-center gap-1">
            <input className={INP} type="text" placeholder="Type custom category"
              value={row.category} onChange={e => onChange({ ...row, category: e.target.value })} />
            <button type="button" onClick={() => setCustomMode(false)}
              className="text-[10px] text-blue-600 hover:underline whitespace-nowrap" title="Pick from Schedule II list instead">↩ list</button>
          </div>
        ) : (
          <select className={INP} value={row.category} onChange={e => {
            if (e.target.value === ADD_NEW) { setCustomMode(true); onChange({ ...row, category: '' }); return }
            onChange({ ...row, category: e.target.value })
          }}>
            <option value="">— Select Category —</option>
            {scheduleII.map(s => <option key={s.category} value={s.category}>{s.category}</option>)}
            <option value={ADD_NEW}>+ Custom Category…</option>
          </select>
        )}
      </td>
      {CATEGORY_ROW_FIELDS.map(field => {
        // Net Block (WDV) = Gross Block - Depreciation: a formula, shown not typed
        const derived = isDerivedField(field, row)
        return (
          <td key={field} className={TDI}>
            {derived
              ? <div className={NINP + ' bg-gray-50 text-gray-800'} title="Calculated (formula)">{fmtINR(withNet(row)[field])}</div>
              : <input className={NINP} type="number" value={row[field]} onChange={e => onChange({ ...row, [field]: e.target.value })} />}
          </td>
        )
      })}
      <td className={TDI + ' text-center'}>
        <button onClick={onDelete} className="text-red-500 hover:text-red-700 text-xs font-bold px-1" title="Delete row">✕</button>
      </td>
    </tr>
  )
}

export default function DepreciationComp({ entity, activeTB }) {
  // Per-branch schedule (keyed by TB) or the entity-wide "Consolidated" one
  // (stored as an entity note detail) — see utils/depStore.js.
  const store = depStoreFor(activeTB, entity, 'comp')
  const [scheduleII, setScheduleII] = useState([])
  const [categoryRows, setCategoryRows] = useState([])
  const [includeInPPENote, setIncludeInPPENote] = useState(false)
  const [pyTotals, setPyTotals] = useState({ ...EMPTY_PY_TOTALS })
  const [tbTotals, setTbTotals] = useState({ cy: 0, py: 0, loaded: false })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [toast, setToast] = useState('')
  const pendingAutoSaveRef = useRef(false)
  // What has been typed is kept without pressing Save (the Previous Year row used to be written only by an explicit Save and was
  // lost on leaving the screen): a short pause after the last keystroke, and when the screen is left.
  const loadedRef = useRef(false)
  const unsavedRef = useRef(null)    // { store, data } waiting to be written
  const flushUnsaved = () => {
    const u = unsavedRef.current
    if (!u) return
    unsavedRef.current = null
    Promise.resolve(u.store.save(u.data)).catch(() => {})
  }

  const tbId = activeTB?.id
  const showToast = msg => { setToast(msg); setTimeout(() => setToast(''), 3500) }

  useEffect(() => {
    window.api?.depScheduleII().then(list => setScheduleII(list || [])).catch(() => {})
  }, [])

  useEffect(() => {
    flushUnsaved()
    loadedRef.current = false
    if (!tbId) { setLoading(false); return }
    setLoading(true)
    store.get().then(saved => {
      // Start with one blank row by default — nothing saved yet shouldn't
      // mean an empty table; the preparer can delete it if truly not needed.
      setCategoryRows(saved?.categoryRows?.length ? saved.categoryRows : [emptyCategoryRow()])
      setIncludeInPPENote(!!saved?.includeInPPENote)
      setPyTotals({ ...EMPTY_PY_TOTALS, ...(saved?.pyTotals || {}) })
    }).catch(() => {
      setCategoryRows([emptyCategoryRow()]); setIncludeInPPENote(false)
      setPyTotals({ ...EMPTY_PY_TOTALS })
    }).finally(() => { setLoading(false); setTimeout(() => { loadedRef.current = true }, 0) })
    return () => { flushUnsaved() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tbId])

  useEffect(() => {
    if (!loadedRef.current || !tbId) return
    unsavedRef.current = { store, data: { categoryRows: categoryRows.map(withNet), includeInPPENote, totals, pyTotals: withNet(pyTotals) } }
    const t = setTimeout(flushUnsaved, 1200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryRows, pyTotals, includeInPPENote])

  // Reconciliation: the PPE Note's own mapped-TB total — the same figure the
  // generic note-builder computes from note.rows, so this on-screen check
  // and the reconciliation footer in the exported note never disagree (see
  // attachNoteExtras() in useFinancials.js, which sources note.compScheduleTbCY/PY
  // the same way).
  useEffect(() => {
    if (!activeTB?.id) { setTbTotals({ cy: 0, py: 0, loaded: false }); return }
    let cancelled = false
    fetchFinancialsData(activeTB, null, entity, null).then(data => {
      if (cancelled || !data) return
      const ppeNote = Object.values(data.notes || {}).find(n => PPE_NOTE_RX.test(n.title || ''))
      const cy = ppeNote?.rows?.reduce((s, r) => s + displayAmt(r, 'closing_balance'), 0) || 0
      const py = ppeNote?.rows?.reduce((s, r) => s + displayAmt(r, 'opening_balance'), 0) || 0
      setTbTotals({ cy, py, loaded: true })
    }).catch(() => setTbTotals({ cy: 0, py: 0, loaded: false }))
    return () => { cancelled = true }
  }, [activeTB?.id, entity?.id])

  const updateRow = useCallback((idx, val) => {
    setCategoryRows(prev => prev.map((r, i) => i === idx ? val : r))
  }, [])
  const deleteRow = useCallback((idx) => {
    setCategoryRows(prev => prev.filter((_, i) => i !== idx))
  }, [])
  const addRow = useCallback(() => {
    setCategoryRows(prev => [...prev, emptyCategoryRow()])
  }, [])

  // Consolidated only: sum every branch's own category rows into this table,
  // matched by Asset Category name — so this schedule (and Include in PPE
  // Note, built from it) reflects the branches' actual entries instead of
  // needing to be retyped from scratch.
  const pullFromBranches = async () => {
    if (!store.consolidated || pulling || !entity?.id) return
    if (!window.confirm('This refreshes any category below that matches a branch\'s own category with its current branch total. A category that only exists here (not in any branch) is left as it is. Continue?')) return
    setPulling(true)
    try {
      const branches = await window.api?.getBranches(entity.id) || []
      const branchSchedules = await Promise.all(branches.map(b => window.api?.depCompGet(b.id).catch(() => null)))
      const { byCategory, pyAgg } = joinDepCompSchedules(branchSchedules, CATEGORY_ROW_FIELDS, CATEGORY_ROW_FIELDS)
      const pulledRows = [...byCategory.values()].map(r => ({
        category: r.category,
        ...Object.fromEntries(CATEGORY_ROW_FIELDS.map(f => [f, String(r[f])])),
      }))
      const pulledKeys = new Set(byCategory.keys())
      setCategoryRows(prev => {
        const kept = prev.filter(r => {
          const key = (r.category || '').trim().toLowerCase()
          if (pulledKeys.has(key)) return false   // superseded by the fresh branch total
          const blank = !r.category && CATEGORY_ROW_FIELDS.every(f => !r[f])
          return !blank   // drop the default empty starter row once real rows exist
        })
        return [...pulledRows, ...kept]
      })
      if (pyAgg) setPyTotals(pyAgg)
      showToast(`Pulled ${pulledRows.length} categor${pulledRows.length !== 1 ? 'ies' : 'y'} from ${branches.length} branch${branches.length !== 1 ? 'es' : ''}. Review below, then Save.`)
    } catch (e) {
      showToast('Pull failed: ' + (e?.message || ''))
    } finally { setPulling(false) }
  }

  // Pure aggregation — sum each column down across categories. No per-row
  // computation of any kind (see file header comment).
  const totals = useMemo(() => categoryRows.map(withNet).reduce((s, r) => {
    const out = { ...s }
    for (const f of CATEGORY_ROW_FIELDS) out[f] = s[f] + num(r[f])
    return out
  }, Object.fromEntries(CATEGORY_ROW_FIELDS.map(f => [f, 0]))),
  [categoryRows])
  const pyShown = useMemo(() => withNet(pyTotals), [pyTotals])

  const diffCY = totals.netBlockClose - tbTotals.cy
  const diffPY = totals.netBlockOpen - tbTotals.py

  const save = async (opts = {}) => {
    if (!tbId) return showToast('Load a Trial Balance first.')
    setSaving(true)
    try {
      // totals is a precomputed column-sum snapshot — saved alongside the raw
      // editable categoryRows so the PPE-note renderers (useFinancials.js,
      // buildHTML.js, buildExcel.js) can read it directly, mirroring Dep
      // (IT)'s blockSummary.
      await store.save({ categoryRows: categoryRows.map(withNet), includeInPPENote, totals, pyTotals: withNet(pyTotals) })
      if (!opts.silent) showToast('Saved successfully.')
    } catch (e) {
      showToast('Save failed: ' + (e?.message || 'unknown error'))
    } finally { setSaving(false) }
  }

  // Mirrors DepreciationIT's auto-save-on-toggle pattern — fires once
  // categoryRows/includeInPPENote have actually updated for the render this
  // effect runs in. Previous Year totals are NOT auto-saved on every
  // keystroke (same as Dep (IT)) — they go out with the next manual Save.
  useEffect(() => {
    if (!pendingAutoSaveRef.current) return
    pendingAutoSaveRef.current = false
    save({ silent: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryRows, includeInPPENote])

  // Mutual exclusivity: turning this on clears Dep (IT)'s own "Include in
  // PPE Note" flag, since only one schedule can appear on the note face.
  const handleToggleInclude = async (v) => {
    setIncludeInPPENote(v)
    pendingAutoSaveRef.current = true
    if (v && tbId) {
      try {
        const itStore = depStoreFor(activeTB, entity, 'it')
        const itSaved = await itStore.get()
        if (itSaved?.includeInPPENote) {
          await itStore.save({ ...itSaved, includeInPPENote: false })
          showToast('Included in PPE Note. Dep (IT)\'s inclusion was turned off — only one schedule can show in the note.')
        }
      } catch (_) {}
    }
  }

  const saveWorkbook = async (wb, defaultPath) => {
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    const result = await window.api?.saveFileDialog({
      defaultPath, filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
    })
    if (result?.filePath && buf) {
      await window.api?.writeFile(result.filePath, Array.from(new Uint8Array(buf)))
      return result.filePath
    }
    return null
  }

  const downloadBlankTemplate = async () => {
    try {
      const path = await saveWorkbook(buildDepCompBlankTemplate(scheduleII), 'Dep_Comp_Template.xlsx')
      if (path) showToast('Blank template saved.')
    } catch (e) { showToast('Download failed: ' + (e?.message || '')) }
  }

  const downloadFilled = async () => {
    try {
      const eName = (entity?.name || 'Entity').replace(/[^A-Za-z0-9]+/g, '_')
      const path = await saveWorkbook(buildDepCompFilledWorkbook(categoryRows, scheduleII), `${eName}_Dep_Comp_Filled.xlsx`)
      if (path) showToast('Filled schedule saved — keep this safe before re-uploading a Trial Balance.')
    } catch (e) { showToast('Download failed: ' + (e?.message || '')) }
  }

  const uploadFilled = async () => {
    try {
      const result = await window.api?.openFileDialog({
        filters: [{ name: 'Excel Workbook', extensions: ['xlsx', 'xls'] }],
        properties: ['openFile'],
      })
      const filePath = result?.filePaths?.[0]
      if (!filePath) return
      const bytes = await window.api?.readFile(filePath)
      const wb = XLSX.read(new Uint8Array(bytes), { type: 'array' })
      const { rows: parsedRows } = parseDepCompWorkbook(wb)
      setCategoryRows(parsedRows)
      pendingAutoSaveRef.current = true
      showToast(`Restored ${parsedRows.length} category row${parsedRows.length !== 1 ? 's' : ''} from the uploaded schedule and saved.`)
    } catch (e) { showToast('Upload failed: ' + (e?.message || '')) }
  }

  if (!activeTB) return (
    <div className="flex items-center justify-center h-full text-gray-400 text-sm">
      Load a Trial Balance in the Actual TB tab first.
    </div>
  )

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-5 py-2 border-b border-blue-100 bg-gray-50 shrink-0 flex-wrap">
        <span className="text-xs text-gray-500 font-medium">Fixed Assets Schedule — Companies Act 2013 (Category-wise, fillable)</span>
        {store.consolidated && (
          <span className="text-[11px] px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300" title="One schedule for all branches. 'Total as per Trial Balance' below is the sum of every branch's PPE; the Exception Report (Consolidated mode) carries the same check.">
            Consolidated — all branches
          </span>
        )}
        <div className="ml-auto flex items-center gap-3">
          {store.consolidated && (
            <button onClick={pullFromBranches} disabled={pulling}
              className="px-3 py-1.5 text-xs border border-amber-400 rounded text-amber-800 bg-amber-50 hover:bg-amber-100 transition disabled:opacity-40"
              title="Sum every branch's own category rows into this Consolidated schedule, matched by Asset Category">
              {pulling ? 'Pulling…' : '⇩ Pull from Branches'}
            </button>
          )}
          <button onClick={addRow}
            className="px-3 py-1.5 text-xs border border-gray-300 rounded text-gray-600 hover:bg-gray-100 transition">
            + Add Category Row
          </button>
          <button onClick={downloadBlankTemplate}
            className="px-3 py-1.5 text-xs border border-gray-300 rounded text-gray-600 hover:bg-gray-100 transition">
            ↓ Blank Template
          </button>
          <button onClick={downloadFilled}
            className="px-3 py-1.5 text-xs border border-green-300 rounded text-green-700 hover:bg-green-50 transition"
            title="Download the current entries — keep this before re-uploading a fresh Trial Balance">
            ↓ Download Filled
          </button>
          <button onClick={uploadFilled}
            className="px-3 py-1.5 text-xs border border-blue-300 rounded text-blue-700 hover:bg-blue-50 transition"
            title="Restore entries from a previously downloaded Filled schedule, matched by Asset Category">
            ↑ Upload Filled
          </button>
          <button onClick={() => save()} disabled={saving}
            className="px-3 py-1.5 text-xs text-white rounded font-medium disabled:opacity-40 transition"
            style={{ background: 'var(--color-primary)' }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Reconciliation strip */}
      <div className="flex items-center gap-6 px-5 py-1.5 bg-white border-b border-gray-100 shrink-0 text-xs text-gray-500">
        <span><span className="font-semibold text-gray-800">{categoryRows.length}</span> categor{categoryRows.length !== 1 ? 'ies' : 'y'}</span>
        <span>Net Block Closing (Table): <span className="font-bold text-orange-700 font-mono">{fmtINR(totals.netBlockClose)}</span></span>
        <span>Total as per Trial Balance (PPE Note): <span className="font-bold text-gray-800 font-mono">{tbTotals.loaded ? fmtINR(tbTotals.cy) : '…'}</span></span>
        <span>Difference: <span className={`font-bold font-mono ${Math.abs(diffCY) < 1 ? 'text-green-700' : 'text-red-700'}`}>{tbTotals.loaded ? fmtINR(diffCY) : '…'}</span></span>
      </div>

      <div className="flex-1 overflow-auto bg-white">
        {loading && <div className="p-8 text-gray-400 text-sm text-center">Loading...</div>}

        {!loading && (
          <div className="p-4">
            {categoryRows.length === 0 ? (
              <div className="p-8 text-center text-gray-400 italic">
                No Asset Categories yet — click "+ Add Category Row" to start the Fixed Assets Schedule.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="border-collapse text-xs w-full" style={{ minWidth: 1150 }}>
                  <thead>
                    <tr className="bg-blue-900 text-white text-[10px]">
                      <th className={thGrp} rowSpan={2} style={{ minWidth: 190 }}>Asset Category</th>
                      <th className={thGrp} colSpan={4}>Gross Block (₹)</th>
                      <th className={thGrp} colSpan={4}>Depreciation (₹)</th>
                      <th className={thGrp} colSpan={2}>Net Block (₹)</th>
                      <th className={thGrp} rowSpan={2}></th>
                    </tr>
                    <tr className="bg-blue-800 text-white text-[10px]">
                      <th className={th}>Opening</th>
                      <th className={th}>Additions</th>
                      <th className={th}>Deductions</th>
                      <th className={th}>Closing</th>
                      <th className={th}>Opening</th>
                      <th className={th}>For Year</th>
                      <th className={th}>On Disposal</th>
                      <th className={th}>Closing</th>
                      <th className={th}>Opening</th>
                      <th className={th}>Closing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categoryRows.map((row, idx) => (
                      <CategoryRow key={idx} row={row} scheduleII={scheduleII}
                        onChange={val => updateRow(idx, val)}
                        onDelete={() => deleteRow(idx)} />
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-blue-950 text-white font-bold text-xs">
                      <td className="border border-blue-800 px-2 py-1.5">TOTAL</td>
                      {CATEGORY_ROW_FIELDS.map(field => (
                        <td key={field} className="border border-blue-800 px-1.5 py-1 text-right font-mono">{fmtINR(totals[field])}</td>
                      ))}
                      <td className="border border-blue-800 px-1.5 py-1"></td>
                    </tr>
                    {/* Manually-entered Previous Year totals — mirrors Dep (IT)'s own
                        blank PY row below its Grand Total; there's no separate PY
                        schedule here, so the preparer types in whatever comparative
                        figures they have (e.g. from last year's audited schedule). */}
                    <tr className="bg-gray-50 text-xs">
                      <td className="border border-gray-300 px-2 py-1.5 font-semibold text-gray-600">Previous Year</td>
                      {CATEGORY_ROW_FIELDS.map(field => {
                        const derived = isDerivedField(field, pyTotals)
                        return (
                          <td key={field} className="border border-gray-300 px-1 py-0.5">
                            {derived
                              ? <div className={NINP + ' bg-gray-50 text-gray-800'} title="Calculated (formula)">{fmtINR(pyShown[field])}</div>
                              : <input className={NINP} value={pyTotals[field]}
                                  onChange={e => setPyTotals(prev => ({ ...prev, [field]: e.target.value }))}
                                  placeholder="0.00" />}
                          </td>
                        )
                      })}
                      <td className="border border-gray-300 px-1.5 py-1"></td>
                    </tr>
                    <tr className="bg-gray-100 text-xs">
                      <td colSpan={12} className="border border-gray-300 px-2 py-1.5">
                        <div className="flex flex-wrap gap-x-6 gap-y-1">
                          <span className="text-gray-600">Total as per Trial Balance — CY: <span className="font-mono font-semibold text-gray-800">{tbTotals.loaded ? fmtINR(tbTotals.cy) : '…'}</span></span>
                          <span className="text-gray-600">PY: <span className="font-mono font-semibold text-gray-800">{tbTotals.loaded ? fmtINR(tbTotals.py) : '…'}</span></span>
                          <span className="text-gray-600">Difference — CY: <span className={`font-mono font-semibold ${Math.abs(diffCY) < 1 ? 'text-green-700' : 'text-red-700'}`}>{tbTotals.loaded ? fmtINR(diffCY) : '…'}</span></span>
                          <span className="text-gray-600">PY: <span className={`font-mono font-semibold ${Math.abs(diffPY) < 1 ? 'text-green-700' : 'text-red-700'}`}>{tbTotals.loaded ? fmtINR(diffPY) : '…'}</span></span>
                        </div>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            <p className="text-[10px] text-gray-400 mt-3">
              Enter the Opening Gross Block, Additions, Deductions, Opening Depreciation, Depreciation for the year and on disposal of each Asset Category. Closing Gross Block (Opening + Additions − Deductions), Closing Depreciation (Opening + For Year − On Disposal), the Net Block Opening / Closing (Gross Block − Depreciation) and the Total are calculated. Add one row per Asset Category.
            </p>

            <label className="flex items-start gap-2 bg-orange-50 border border-orange-200 rounded p-3 text-xs text-orange-900 cursor-pointer max-w-2xl mt-4">
              <input type="checkbox" className="mt-0.5" checked={includeInPPENote} onChange={e => handleToggleInclude(e.target.checked)} />
              <span>
                <strong>Include this Fixed Assets Schedule in the PPE Note disclosure.</strong> When checked and saved, this
                table appears inside the "Property, Plant & Equipment" note — in the Notes tab, the Excel export, and the
                PDF export. Only one of Dep (Comp) or Dep (IT) can be included at a time — checking this turns off Dep (IT)'s
                inclusion if it was on. Uncheck and save to remove it again.
              </span>
            </label>
          </div>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-4 right-4 px-4 py-2 rounded shadow-lg bg-blue-700 text-white text-xs font-medium z-50">
          {toast}
        </div>
      )}
    </div>
  )
}
