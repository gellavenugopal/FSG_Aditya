import React, { useState, useEffect, useRef } from 'react'
import { useModalKeys } from '../../hooks/useModalKeys'

export default function OverrideModal({
  row, entity, rsId = null, onSave, onClose,
  headerNote = null,
  closeLabel = 'Cancel',
  askLedger = false,   // adding a ledger: also asks its name and adjustment (Mapped TB > Add Ledger)
  saving: externalSaving = false,
}) {
  const [lf, setLf]         = useState([])
  const [m1, setM1]         = useState(row.mapping1_resultant || '')
  const [m2, setM2]         = useState(row.mapping2_resultant || '')
  const [m3, setM3]         = useState(row.mapping3_resultant || '')
  const [lfId, setLfId]     = useState(row.level_format_id || '')
  const [l4, setL4]         = useState(row.level4_value || '')
  const [l5, setL5]         = useState(row.level5_value || '')
  const [l6, setL6]         = useState(row.level6_value || '')
  const [l7, setL7]         = useState(row.level7_value || '')
  const [note, setNote]     = useState(row.override_note || '')
  const [internalSaving, setInternalSaving] = useState(false)
  const [ledgerName, setLedgerName] = useState('')
  const [ledgerCode, setLedgerCode] = useState('')
  const [adjD, setAdjD] = useState('')
  const [adjC, setAdjC] = useState('')
  const [error, setError] = useState('')

  const saving = externalSaving || internalSaving

  const containerRef = useModalKeys({ onClose, onConfirm: handleSave })

  useEffect(() => {
    if (!entity) return
    window.api?.getLevelFormat(entity.constitution, rsId)
      .then(data => setLf(data || []))
      .catch(() => {})
  }, [entity, rsId])

  const unique = (arr) => [...new Set(arr.filter(Boolean))]
  // A Level Format cell holding alternates ("Secured, considered good / Unsecured, considered good / Doubtful") is offered as one choice
  // per alternate - exactly one is the ledger's - as the Mapped TB grid does.
  const alts = (val) => {
    if (!val) return []
    const parts = String(val).includes('/') ? String(val).split('/').map(s => s.trim()).filter(Boolean) : null
    return parts && parts.length ? parts : [val]
  }
  const has = (cell, v) => !!v && alts(cell).includes(v)
  const m1Options = unique(lf.flatMap(r => alts(r.level1)))
  const m2Options = unique(lf.filter(r => !m1 || has(r.level1, m1)).flatMap(r => alts(r.level2)))
  const m3Options = unique(lf.filter(r => (!m1 || has(r.level1, m1)) && (!m2 || has(r.level2, m2))).flatMap(r => alts(r.level3)))
  const lfOptions = lf.filter(r =>
    (!m1 || has(r.level1, m1)) && (!m2 || has(r.level2, m2)) && (!m3 || has(r.level3, m3))
  )

  // Get selected LevelFormat row to determine if level5/6/7 have "/" options
  const selectedLf = lfId ? lf.find(r => r.id === parseInt(lfId)) : null
  // Auto-detect LF row when m1+m2 are set but lfId is empty
  const inferredLf = (!lfId && m1 && m2)
    ? lf.find(r => has(r.level1, m1) && has(r.level2, m2) && (!m3 || has(r.level3, m3)))
    : null
  const activeLf = selectedLf || inferredLf
  const parseSlash = (val) => {
    if (!val) return null
    if (val.includes('/')) return val.split('/').map(s => s.trim()).filter(Boolean)
    return null
  }
  const l4Options = parseSlash(activeLf?.level4)
  const l5Options = parseSlash(activeLf?.level5)
  const l6Options = parseSlash(activeLf?.level6)
  const l7Options = parseSlash(activeLf?.level7)

  // A choice among Secured / Unsecured / Doubtful opens on "Unsecured, considered good" (once per mapping chosen; the CA can change it)
  const defaultsFor = useRef('')
  useEffect(() => {
    const key = `${m1}|${m2}|${activeLf ? activeLf.id : ''}`
    if (!lf.length || defaultsFor.current === key) return
    defaultsFor.current = key
    const unsec = (opts) => (opts || []).find(o => /unsecured.*considered\s*good/i.test(o)) || null
    if (!m3) { const d = unsec(m3Options); if (d && m3Options.length > 1) setM3(d) }
    if (!l4) { const d = unsec(l4Options); if (d) setL4(d) }
    if (!l5) { const d = unsec(l5Options); if (d) setL5(d) }
    if (!l6) { const d = unsec(l6Options); if (d) setL6(d) }
    if (!l7) { const d = unsec(l7Options); if (d) setL7(d) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lf, m1, m2, activeLf && activeLf.id])

  async function handleSave() {
    if (saving) return
    setError('')
    if (askLedger) {
      if (!ledgerName.trim()) { setError('Enter the name of the ledger.'); return }
      if (!m1) { setError('Choose the mapping - at least Mapping 1.'); return }
    }
    setInternalSaving(true)
    try {
      await onSave(row.id, {
        ...(askLedger ? { ledger_name: ledgerName, ledger_code: ledgerCode, adj_debit: adjD, adj_credit: adjC } : {}),
        mapping1_resultant: m1 || null,
        mapping2_resultant: m2 || null,
        mapping3_resultant: m3 || null,
        level_format_id:    lfId ? parseInt(lfId) : null,
        level4_value:       l4 || null,
        level5_value:       l5 || null,
        level6_value:       l6 || null,
        level7_value:       l7 || null,
        override_note:      note || null,
      })
    } catch (e) {
      if (!askLedger) throw e
      setError(String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setInternalSaving(false)
    }
  }

  const sel = (label, value, onChange, options) => (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
      >
        <option value="">—</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box max-w-2xl overflow-y-auto max-h-[90vh]" ref={containerRef} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-blue-900">{askLedger ? 'Add Ledger' : 'Override Mapping'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>

        {headerNote && (
          <div className="mb-3">
            {typeof headerNote === 'string'
              ? <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">{headerNote}</p>
              : headerNote
            }
          </div>
        )}

        {askLedger ? (
          <div className="mb-4">
            <p className="text-xs text-gray-600 bg-blue-50 border border-blue-100 rounded px-3 py-2 mb-3">
              A ledger that is not in the imported Trial Balance. Name it, map it at every level, and enter its Adjustment (Debit) or (Credit): the Revised
              Closing Balance, the Balance Sheet, Profit &amp; Loss, Notes and Annexures follow, like any other ledger.
            </p>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Ledger name *</label>
                <input type="text" value={ledgerName} onChange={e => setLedgerName(e.target.value)} maxLength={200} autoFocus placeholder="e.g. Provision for audit fees"
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Ledger code (optional)</label>
                <input type="text" value={ledgerCode} onChange={e => setLedgerCode(e.target.value)} maxLength={60}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
            </div>
          </div>
        ) : (
        <div className="bg-blue-50 rounded px-3 py-2 mb-4 text-sm">
          <span className="text-gray-500">Ledger: </span>
          <span className="font-semibold text-blue-900">{row.name}</span>
          {row.ledger_code && <span className="text-gray-400 ml-2">({row.ledger_code})</span>}
        </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          {sel('Mapping 1 (broad bucket)',      m1, v => { setM1(v); setM2(''); setM3(''); setLfId('') }, m1Options)}
          {sel('Mapping 2 (category)',           m2, v => { setM2(v); setM3(''); setLfId('') },           m2Options)}
          {sel('Mapping 3 (specific line item)', m3, v => { setM3(v); setLfId('') },                      m3Options)}
          <div>
            <label className="block text-xs text-gray-500 mb-1">LevelFormat Row</label>
            <select
              value={lfId}
              onChange={e => setLfId(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              <option value="">—</option>
              {lfOptions.map(r => (
                <option key={r.id} value={r.id}>
                  {[r.level1, r.level2, r.level3, r.level4].filter(Boolean).join(' › ')}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-3 mt-3">
          {[['Level 4', l4, setL4, l4Options], ['Level 5', l5, setL5, l5Options], ['Level 6', l6, setL6, l6Options], ['Level 7 (Nature)', l7, setL7, l7Options]].map(([label, val, setter, opts]) => (
            <div key={label}>
              <label className="block text-xs text-gray-500 mb-1">{label}</label>
              {opts ? (
                <select
                  value={val}
                  onChange={e => setter(e.target.value)}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  <option value="">—</option>
                  {opts.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input
                  type="text" value={val} onChange={e => setter(e.target.value)}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              )}
            </div>
          ))}
        </div>

        <div className="mt-3">
          <label className="block text-xs text-gray-500 mb-1">Override Note (reason)</label>
          <textarea
            value={note} onChange={e => setNote(e.target.value)} rows={2}
            placeholder="Optional — reason for override"
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
          />
        </div>

        {askLedger && (
          <div className="mt-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Adjustments (Debit)</label>
                <input type="number" min="0" step="0.01" value={adjD} onChange={e => setAdjD(e.target.value)}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm text-right text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Adjustments (Credit)</label>
                <input type="number" min="0" step="0.01" value={adjC} onChange={e => setAdjC(e.target.value)}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm text-right text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
            </div>
            <p className="text-[11px] text-gray-400 mt-1">Leave both blank to add the ledger now and adjust it later in the Adjustments columns. Balance the entry with the Adjustments of another ledger.</p>
          </div>
        )}

        {error && <p className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}

        <div className="flex gap-2 mt-4">
          <button
            onClick={onClose}
            className="flex-1 py-2 border border-gray-300 text-gray-600 rounded text-sm hover:bg-gray-50 transition"
          >
            {closeLabel}
          </button>
          <button
            onClick={handleSave} disabled={saving}
            className="flex-1 py-2 text-white rounded text-sm font-medium hover:opacity-90 disabled:opacity-40 transition" style={{ background: 'var(--color-primary)' }}
            title={askLedger ? 'Add Ledger (Ctrl+Enter)' : 'Save Override (Ctrl+Enter)'}
          >
            {saving ? 'Saving…' : (askLedger ? 'Add Ledger' : 'Save Override')}
          </button>
        </div>
        <p className="text-xs text-gray-400 text-center mt-2">Ctrl+Enter to save · Esc to cancel</p>
      </div>
    </div>
  )
}
