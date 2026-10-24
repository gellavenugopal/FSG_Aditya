/**
 * Fill Details forms for the two inventory-driven PL schedules (all
 * constitutions — Proprietorship/Partnership/LLP/Company):
 *   - CostOfMaterialsConsumedForm: Opening Stock of Raw Materials + Purchases
 *     of Raw Materials − Closing Stock of Raw Materials = Cost of Materials
 *     Consumed. See utils/inventorySplit.js for the auto-computed figures
 *     this reconciles against.
 *   - ChangesInInventoryForm: category-wise (Work-in-Progress / Finished
 *     Goods / Stock-in-Trade, extendable) Opening/Closing breakdown of the
 *     "Changes in inventories" note.
 * Both are optional disclosure detail — the note's face total is always the
 * TB-derived figure; this form lets the CA record the category-wise
 * break-up behind it and flags if the form's total drifts from the TB.
 */
import React, { useState, useEffect, useMemo } from 'react'

const INP = 'w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white'
const NUM = INP + ' text-right font-mono'

const num = (v) => parseFloat(v) || 0
function fmtN(n) { return n != null && n !== '' && !isNaN(n) ? Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—' }

function TallyBadge({ formTotal, bsTotal, label }) {
  if (bsTotal == null) return null
  const tallies = Math.abs(formTotal - Math.abs(bsTotal)) < 1
  return (
    <div className={`text-xs px-2 py-1 rounded border ${tallies ? 'bg-green-50 border-green-300 text-green-700' : 'bg-red-50 border-red-300 text-red-700'}`}>
      {label}: {tallies ? '✓ Tallies with TB' : `⚠ TB ₹${fmtN(Math.abs(bsTotal))} vs Form ₹${fmtN(formTotal)}`}
    </div>
  )
}

async function loadSaved({ tbId, entityId, noteNum, noteTitle, useEntityLevel }) {
  if (!noteNum) return null
  const fetch = useEntityLevel
    ? window.api?.getEntityNoteDetails(entityId, noteNum, noteTitle)
    : window.api?.getNoteDetails(tbId, noteNum, noteTitle)
  try { return await fetch } catch { return null }
}

async function persist({ tbId, entityId, noteNum, noteTitle, useEntityLevel, data }) {
  if (useEntityLevel) {
    await window.api?.saveEntityNoteDetails({ entityId, noteNum, noteTitle, data })
  } else {
    await window.api?.saveNoteDetails({ tbId, noteNum, noteTitle, data })
  }
}

// ── Cost of Materials Consumed ──────────────────────────────────────────────
export function CostOfMaterialsConsumedForm({
  tbId, entityId, useEntityLevel, noteNum, noteTitle, noteTotal, notePrevTotal, onClose, onSaved,
}) {
  const [data, setData] = useState({
    opening: { cy: '', py: '' }, purchases: { cy: '', py: '' }, closing: { cy: '', py: '' }, remarks: '',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadSaved({ tbId, entityId, noteNum, noteTitle, useEntityLevel }).then(saved => {
      if (saved && saved.opening) setData(saved)
    }).finally(() => setLoading(false))
  }, [tbId, entityId, noteNum, useEntityLevel])

  const totalCY = num(data.opening.cy) + num(data.purchases.cy) - num(data.closing.cy)
  const totalPY = num(data.opening.py) + num(data.purchases.py) - num(data.closing.py)

  const setField = (row, period, val) => setData(d => ({ ...d, [row]: { ...d[row], [period]: val } }))

  const save = async () => {
    setSaving(true)
    try {
      await persist({ tbId, entityId, noteNum, noteTitle, useEntityLevel, data })
      onSaved?.(); onClose()
    } finally { setSaving(false) }
  }

  const ROWS = [
    { key: 'opening', label: 'Opening Stock of Raw Materials', sign: 1 },
    { key: 'purchases', label: 'Add: Purchases of Raw Materials', sign: 1 },
    { key: 'closing', label: 'Less: Closing Stock of Raw Materials', sign: -1 },
  ]

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 9999 }}>
      <div className="modal-box overflow-hidden flex flex-col" style={{ maxWidth: '760px', width: '95vw', maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-200 pb-3 mb-3 shrink-0">
          <div>
            <h2 className="text-base font-bold" style={{ color: 'var(--color-primary)' }}>Note {noteNum}: {noteTitle} — Details</h2>
            <p className="text-xs text-gray-500 mt-0.5">Opening + Purchases − Closing should equal the Cost of Materials Consumed shown on the face.</p>
          </div>
          <div className="flex items-center gap-2">
            <TallyBadge formTotal={totalCY} bsTotal={noteTotal} label="CY" />
            <TallyBadge formTotal={totalPY} bsTotal={notePrevTotal} label="PY" />
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl ml-2">&times;</button>
          </div>
        </div>

        {loading ? <div className="text-gray-500 text-sm p-4">Loading...</div> : (
          <div className="flex-1 overflow-y-auto">
            <table className="w-full border-collapse text-xs mb-4">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left px-2 py-1.5 border border-gray-200">Particulars</th>
                  <th className="text-right px-2 py-1.5 border border-gray-200 w-36">Current Year</th>
                  <th className="text-right px-2 py-1.5 border border-gray-200 w-36">Previous Year</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map(r => (
                  <tr key={r.key}>
                    <td className="px-2 py-1 border border-gray-200">{r.label}</td>
                    <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={data[r.key].cy} onChange={e => setField(r.key, 'cy', e.target.value)} /></td>
                    <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={data[r.key].py} onChange={e => setField(r.key, 'py', e.target.value)} /></td>
                  </tr>
                ))}
                <tr className="font-bold bg-blue-50">
                  <td className="px-2 py-1 border border-gray-200">Cost of Materials Consumed</td>
                  <td className="px-2 py-1 border border-gray-200 text-right font-mono">{fmtN(totalCY)}</td>
                  <td className="px-2 py-1 border border-gray-200 text-right font-mono">{fmtN(totalPY)}</td>
                </tr>
              </tbody>
            </table>
            <label className="block text-[10px] text-gray-500 mb-1">Remarks (optional)</label>
            <textarea className={INP + ' resize-y'} rows={2} value={data.remarks || ''} onChange={e => setData(d => ({ ...d, remarks: e.target.value }))} />
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-gray-200 pt-3 mt-3 shrink-0">
          <button onClick={onClose} className="px-4 py-1.5 border border-gray-300 text-gray-600 rounded text-sm hover:bg-gray-50">Cancel</button>
          <button onClick={save} disabled={saving} className="px-4 py-1.5 text-white rounded text-sm font-medium disabled:opacity-40" style={{ background: 'var(--color-primary)' }}>
            {saving ? 'Saving…' : 'Save Note Details'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Changes in Inventories (and, reused below, Cost of Stores & Spares
// Consumed — structurally identical category-wise Opening/Closing form) ────
const DEFAULT_CATEGORIES = ['Work-in-Progress', 'Finished Goods', 'Stock-in-Trade']
const STORES_CATEGORIES = ['Stores and Consumables', 'Loose Tools', 'Others']

function emptyCategory(label = '') {
  return { id: Math.random().toString(36).slice(2), label, openingCY: '', closingCY: '', openingPY: '', closingPY: '' }
}

export function ChangesInInventoryForm({
  tbId, entityId, useEntityLevel, noteNum, noteTitle, noteTotal, notePrevTotal, onClose, onSaved,
  defaultCategories = DEFAULT_CATEGORIES,
  helpText = 'Category-wise break-up of Work-in-Progress / Finished Goods / Stock-in-Trade. Raw Materials are excluded — those move through Cost of Materials Consumed.',
}) {
  const [categories, setCategories] = useState(() => defaultCategories.map(emptyCategory))
  const [remarks, setRemarks] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadSaved({ tbId, entityId, noteNum, noteTitle, useEntityLevel }).then(saved => {
      if (saved?.categories?.length) { setCategories(saved.categories); setRemarks(saved.remarks || '') }
    }).finally(() => setLoading(false))
  }, [tbId, entityId, noteNum, useEntityLevel])

  const setCat = (i, field, val) => setCategories(cs => cs.map((c, ci) => ci === i ? { ...c, [field]: val } : c))
  const addCat = () => setCategories(cs => [...cs, emptyCategory()])
  const removeCat = (i) => setCategories(cs => cs.filter((_, ci) => ci !== i))

  const rows = useMemo(() => categories.map(c => ({
    ...c,
    changeCY: num(c.openingCY) - num(c.closingCY),
    changePY: num(c.openingPY) - num(c.closingPY),
  })), [categories])
  const totalCY = rows.reduce((s, r) => s + r.changeCY, 0)
  const totalPY = rows.reduce((s, r) => s + r.changePY, 0)

  const save = async () => {
    setSaving(true)
    try {
      await persist({ tbId, entityId, noteNum, noteTitle, useEntityLevel, data: { categories, remarks } })
      onSaved?.(); onClose()
    } finally { setSaving(false) }
  }

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 9999 }}>
      <div className="modal-box overflow-hidden flex flex-col" style={{ maxWidth: '900px', width: '96vw', maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-200 pb-3 mb-3 shrink-0">
          <div>
            <h2 className="text-base font-bold" style={{ color: 'var(--color-primary)' }}>Note {noteNum}: {noteTitle} — Details</h2>
            <p className="text-xs text-gray-500 mt-0.5">{helpText}</p>
          </div>
          <div className="flex items-center gap-2">
            <TallyBadge formTotal={totalCY} bsTotal={noteTotal} label="CY" />
            <TallyBadge formTotal={totalPY} bsTotal={notePrevTotal} label="PY" />
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl ml-2">&times;</button>
          </div>
        </div>

        {loading ? <div className="text-gray-500 text-sm p-4">Loading...</div> : (
          <div className="flex-1 overflow-y-auto">
            <div className="overflow-x-auto mb-3">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left px-2 py-1.5 border border-gray-200">Category</th>
                    <th className="text-right px-2 py-1.5 border border-gray-200">Opening (CY)</th>
                    <th className="text-right px-2 py-1.5 border border-gray-200">Closing (CY)</th>
                    <th className="text-right px-2 py-1.5 border border-gray-200">Increase/(Decrease) CY</th>
                    <th className="text-right px-2 py-1.5 border border-gray-200">Opening (PY)</th>
                    <th className="text-right px-2 py-1.5 border border-gray-200">Closing (PY)</th>
                    <th className="text-right px-2 py-1.5 border border-gray-200">Increase/(Decrease) PY</th>
                    <th className="border border-gray-200 w-6"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.id}>
                      <td className="px-1 py-0.5 border border-gray-200">
                        <input className={INP} value={r.label} onChange={e => setCat(i, 'label', e.target.value)} placeholder="Category" />
                      </td>
                      <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={r.openingCY} onChange={e => setCat(i, 'openingCY', e.target.value)} /></td>
                      <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={r.closingCY} onChange={e => setCat(i, 'closingCY', e.target.value)} /></td>
                      <td className="px-2 py-1 border border-gray-200 text-right font-mono bg-gray-50">{fmtN(r.changeCY)}</td>
                      <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={r.openingPY} onChange={e => setCat(i, 'openingPY', e.target.value)} /></td>
                      <td className="px-1 py-0.5 border border-gray-200"><input className={NUM} type="number" value={r.closingPY} onChange={e => setCat(i, 'closingPY', e.target.value)} /></td>
                      <td className="px-2 py-1 border border-gray-200 text-right font-mono bg-gray-50">{fmtN(r.changePY)}</td>
                      <td className="px-1 py-0.5 border border-gray-200 text-center">
                        <button onClick={() => removeCat(i)} className="text-red-400 hover:text-red-600 text-[10px]">✕</button>
                      </td>
                    </tr>
                  ))}
                  <tr className="font-bold bg-blue-50">
                    <td className="px-2 py-1 border border-gray-200" colSpan={3}>Total Increase/(Decrease) in Inventories</td>
                    <td className="px-2 py-1 border border-gray-200 text-right font-mono">{fmtN(totalCY)}</td>
                    <td className="border border-gray-200" colSpan={2}></td>
                    <td className="px-2 py-1 border border-gray-200 text-right font-mono">{fmtN(totalPY)}</td>
                    <td className="border border-gray-200"></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <button onClick={addCat} className="text-xs text-blue-600 hover:underline mb-3">+ Add Category</button>

            <label className="block text-[10px] text-gray-500 mb-1">Remarks (optional)</label>
            <textarea className={INP + ' resize-y'} rows={2} value={remarks} onChange={e => setRemarks(e.target.value)} />
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-gray-200 pt-3 mt-3 shrink-0">
          <button onClick={onClose} className="px-4 py-1.5 border border-gray-300 text-gray-600 rounded text-sm hover:bg-gray-50">Cancel</button>
          <button onClick={save} disabled={saving} className="px-4 py-1.5 text-white rounded text-sm font-medium disabled:opacity-40" style={{ background: 'var(--color-primary)' }}>
            {saving ? 'Saving…' : 'Save Note Details'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Cost of Stores and Spares Consumed ──────────────────────────────────────
// Same category-wise Opening/Closing schedule as ChangesInInventoryForm, just
// scoped to Stores and Consumables / Loose Tools / Others instead of
// WIP/Finished Goods/Stock-in-Trade — see utils/inventorySplit.js for the
// auto-computed figures this reconciles against.
export function CostOfStoresConsumedForm(props) {
  return (
    <ChangesInInventoryForm
      {...props}
      defaultCategories={STORES_CATEGORIES}
      helpText="Category-wise break-up of Stores and Consumables / Loose Tools / Others. Raw Materials and Work-in-Progress/Finished Goods/Stock-in-Trade are excluded — those move through Cost of Materials Consumed and Changes in Inventories respectively."
    />
  )
}
