import React, { useState, useEffect } from 'react'
import { useModalKeys } from '../../hooks/useModalKeys'
import UnlockConfirmModal from '../shared/UnlockConfirmModal'
import GlobalAuditorPicker from '../shared/GlobalAuditorPicker'
import { isValidPan, normalizePan } from '../../utils/pan'
import { formatPeriodMasterOption } from '../../utils/financialPeriodDisplay'
import { financialPeriodLabel } from '../../../../shared/financial-periods.mjs'

const CONSTITUTION_OPTIONS = [
  { label: 'Individual', value: 'Individual', code: 1 },
  { label: 'Proprietorship', value: 'Proprietorship', code: 1 },
  { label: 'Partnership', value: 'Partnership', code: 1 },
  { label: 'LLP', value: 'LLP', code: 2 },
  { label: 'Company', value: 'Company', code: 3 },
]

const BUSINESS_TYPE_OPTIONS = ['Manufacturer', 'Trader', 'Service Provider', 'Mixed']

function fmtPeriod(p) {
  return formatPeriodMasterOption(p.year_label, p.date_from, p.date_till)
}

// One row for picking/creating a Financial Period to attach.
function PeriodPickRow({ globalPeriods, alreadyAttachedIds, value, onChange, onRemove }) {
  const [creatingNew, setCreatingNew] = useState(false)
  const [newFrom, setNewFrom] = useState('')
  const [newTill, setNewTill] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const available = globalPeriods.filter(p => !alreadyAttachedIds.includes(p.id) || p.id === value?.id)

  const createNew = async () => {
    setErr('')
    if (!newFrom || !newTill) { setErr('Date From and Date Till are required.'); return }
    setSaving(true)
    try {
      const created = await window.api?.saveFinancialPeriod({ date_from: newFrom, date_till: newTill })
      onChange(created)
      setCreatingNew(false)
    } catch (e) {
      setErr(e.message || 'Failed to create period.')
    } finally {
      setSaving(false)
    }
  }

  if (creatingNew) {
    return (
      <div className="border border-blue-200 rounded p-3 bg-blue-50/50 mb-2">
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div>
            <label className="block text-[10px] text-gray-500 mb-0.5">Date From</label>
            <input type="date" value={newFrom} onChange={e => setNewFrom(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white" />
          </div>
          <div>
            <label className="block text-[10px] text-gray-500 mb-0.5">Date Till</label>
            <input type="date" value={newTill} onChange={e => setNewTill(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white" />
          </div>
        </div>
        <p className="mb-2 text-[11px] text-gray-500">
          Period label: <span className="font-semibold text-gray-700">{financialPeriodLabel(newTill) || 'set a valid closing date'}</span>
        </p>
        {err && <p className="text-red-500 text-xs mb-2">{err}</p>}
        <div className="flex gap-2">
          <button onClick={() => setCreatingNew(false)} className="px-2 py-1 text-xs border border-gray-300 rounded text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={createNew} disabled={saving} className="px-2 py-1 text-xs bg-blue-700 text-white rounded hover:bg-blue-800 disabled:opacity-40">
            {saving ? 'Saving...' : 'Create & Use'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 mb-2">
      <select
        value={value?.id || ''}
        onChange={e => {
          const id = parseInt(e.target.value)
          onChange(globalPeriods.find(p => p.id === id) || null)
        }}
        className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-xs bg-white"
      >
        <option value="">— Select existing Financial Period —</option>
        {available.map(p => <option key={p.id} value={p.id}>{fmtPeriod(p)}</option>)}
      </select>
      <button onClick={() => setCreatingNew(true)} className="text-xs text-blue-600 hover:underline whitespace-nowrap">+ New</button>
      {onRemove && <button onClick={onRemove} className="text-xs text-red-500 hover:underline">Remove</button>}
    </div>
  )
}

export default function AuditeeFormModal({ mode, editing, onSaved, onClose }) {
  const [name, setName] = useState(editing?.name || '')
  const [constitutionDisplay, setConstitutionDisplay] = useState(editing?.constitution_display || 'Company')
  const [businessType, setBusinessType] = useState(editing?.business_type || 'Trader')
  const [hasBranches, setHasBranches] = useState(!!editing?.has_branches)
  const [address, setAddress] = useState(editing?.address || '')
  const [cin, setCin] = useState(editing?.cin || '')
  const [pan, setPan] = useState(editing?.pan || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [globalPeriods, setGlobalPeriods] = useState([])
  const [newPicks, setNewPicks] = useState([null])       // periods being newly attached
  const [attached, setAttached] = useState([])            // existing entity_periods (edit mode)
  const [unlockTarget, setUnlockTarget] = useState(null)  // entity_period row pending unlock confirm
  // Auditor picked from the Global list (firm → partner / proprietor), saved on the auditee.
  const [pickedAuditor, setPickedAuditor] = useState(null)
  const [currentAuditors, setCurrentAuditors] = useState([])

  const selectedConst = CONSTITUTION_OPTIONS.find(o => o.value === constitutionDisplay)

  useEffect(() => {
    window.api?.listFinancialPeriods().then(list => setGlobalPeriods(list || [])).catch(() => {})
    if (mode === 'edit' && editing?.id) {
      window.api?.listEntityPeriods(editing.id).then(list => setAttached(list || [])).catch(() => {})
      window.api?.listAuditors(editing.id).then(list => setCurrentAuditors(list || [])).catch(() => {})
    }
  }, [mode, editing?.id])

  const containerRef = useModalKeys({ onClose, onConfirm: () => handleSave() })

  const attachedIds = attached.map(a => a.financial_period_id)
  const pickedIds = newPicks.filter(Boolean).map(p => p.id)

  const handleSave = async () => {
    if (!name.trim()) { setError('Auditee name is required.'); return }
    if (!isValidPan(pan)) { setError('PAN must be 10 characters: 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F) - or leave it blank.'); return }
    if (mode === 'create' && newPicks.filter(Boolean).length === 0) {
      setError('At least one Financial Period is required.')
      return
    }
    setSaving(true); setError('')
    try {
      const saved = await window.api.saveEntity({
        id: mode === 'edit' ? editing?.id : undefined,
        name: name.trim(),
        constitution: selectedConst?.code || 3,
        constitution_display: constitutionDisplay,
        business_type: businessType,
        has_branches: hasBranches ? 1 : 0,
        address: address.trim(),
        cin: constitutionDisplay === 'Company' ? cin.trim() : '',
        pan: normalizePan(pan),
      })
      for (const p of newPicks.filter(Boolean)) {
        await window.api?.attachEntityPeriod(saved.id, p.id)
      }
      // The auditor chosen from the Global list — added unless this auditee already has that person.
      if (pickedAuditor?.name && pickedAuditor?.membership_number &&
          !currentAuditors.some(a => (a.membership_number || '').trim() === pickedAuditor.membership_number.trim())) {
        await window.api?.saveAuditor({ entity_id: saved.id, ...pickedAuditor })
      }
      onSaved?.(saved)
    } catch (err) {
      setError(err.message || 'Failed to save Auditee.')
    } finally {
      setSaving(false)
    }
  }

  const doLock = async (ep) => {
    await window.api?.lockEntityPeriod(ep.id)
    setAttached(prev => prev.map(a => a.id === ep.id ? { ...a, locked: 1 } : a))
  }
  const doUnlock = async (ep) => {
    await window.api?.unlockEntityPeriod(ep.id)
    setAttached(prev => prev.map(a => a.id === ep.id ? { ...a, locked: 0, is_final: false } : a))
    setUnlockTarget(null)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box max-w-lg max-h-[88vh] overflow-y-auto" ref={containerRef} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-blue-900">{mode === 'edit' ? 'Edit Auditee' : 'Create Auditee'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Auditee / Client Name</label>
            <input
              type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. ABC Pvt Ltd"
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Constitution of Entity</label>
            <select
              value={constitutionDisplay} onChange={e => setConstitutionDisplay(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              {CONSTITUTION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Nature of Business</label>
            <select
              value={businessType} onChange={e => setBusinessType(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              {BUSINESS_TYPE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Address</label>
            <textarea
              value={address} onChange={e => setAddress(e.target.value)}
              placeholder="Registered / business address"
              rows={2}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">PAN <span className="text-gray-400">(optional)</span></label>
            <input
              type="text" value={pan} onChange={e => setPan(normalizePan(e.target.value))} maxLength={10}
              placeholder="e.g. ABCDE1234F"
              className={`w-full border rounded px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 uppercase ${isValidPan(pan) || pan.length < 10 ? 'border-gray-300 focus:ring-blue-400' : 'border-red-400 focus:ring-red-300'}`}
            />
            {pan.length === 10 && !isValidPan(pan) && <p className="text-xs text-red-600 mt-1">5 letters, then 4 digits, then 1 letter.</p>}
          </div>
          {constitutionDisplay === 'Company' && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">CIN</label>
              <input
                type="text" value={cin} onChange={e => setCin(e.target.value)}
                placeholder="e.g. U12345MH2020PTC123456"
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          )}
          <div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={hasBranches} onChange={e => setHasBranches(e.target.checked)} className="rounded border-gray-300" />
              <span className="text-sm text-gray-700">Has Branches</span>
            </label>
          </div>

          {/* ── Auditor, from the Global list ── */}
          <div className="border-t border-gray-200 pt-3">
            <label className="block text-xs font-semibold text-gray-700 mb-2">Auditor</label>
            {currentAuditors.length > 0 && (
              <p className="text-xs text-gray-600 mb-2">
                Current: {currentAuditors.map(a => `${a.name}${a.firm_name ? ` (${a.firm_name})` : ''}`).join('; ')}
                <span className="text-gray-400"> — pick below to add another; manage in Master → Auditor.</span>
              </p>
            )}
            <GlobalAuditorPicker onPick={setPickedAuditor} />
            {pickedAuditor && (
              <p className="text-[11px] text-gray-500 mt-1.5">
                {pickedAuditor.name}{pickedAuditor.designation ? `, ${pickedAuditor.designation}` : ''} · M.No. {pickedAuditor.membership_number || '—'} · {pickedAuditor.firm_name}{pickedAuditor.frn ? ` · FRN ${pickedAuditor.frn}` : ''}
              </p>
            )}
          </div>

          {/* ── Financial Periods ── */}
          <div className="border-t border-gray-200 pt-3">
            <label className="block text-xs font-semibold text-gray-700 mb-2">Financial Period{mode === 'create' ? ' (required)' : ''}</label>

            {mode === 'edit' && attached.length > 0 && (
              <ul className="space-y-1.5 mb-3">
                {attached.map(ep => (
                  <li key={ep.id} className="flex items-center justify-between text-xs bg-gray-50 border border-gray-200 rounded px-2.5 py-1.5">
                    <span className="text-gray-700">{formatPeriodMasterOption(ep.year_label, ep.date_from, ep.date_till)}</span>
                    {ep.locked ? (
                      <div className="flex items-center gap-2">
                        <span className="text-red-600 font-medium" title={ep.is_final ? 'Marked Final when the PDF / Excel was generated: Place and Date of Signing are fixed' : undefined}>🔒 Locked{ep.is_final ? ` · Final (signed at ${ep.final_sign_place || ''} on ${ep.final_sign_date || ''})` : ''}</span>
                        <button onClick={() => setUnlockTarget(ep)} className="text-blue-600 hover:underline">Unlock</button>
                      </div>
                    ) : (
                      <button onClick={() => doLock(ep)} className="text-gray-500 hover:underline">Lock</button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {newPicks.map((pick, i) => (
              <PeriodPickRow
                key={i}
                globalPeriods={globalPeriods}
                alreadyAttachedIds={[...attachedIds, ...pickedIds.filter((_, j) => j !== i)]}
                value={pick}
                onChange={p => setNewPicks(prev => prev.map((x, j) => j === i ? p : x))}
                onRemove={newPicks.length > 1 ? () => setNewPicks(prev => prev.filter((_, j) => j !== i)) : null}
              />
            ))}
            <button
              onClick={() => setNewPicks(prev => [...prev, null])}
              className="text-xs text-blue-600 hover:underline"
            >
              + Additional Period
            </button>
          </div>

          {error && <p className="text-red-500 text-xs">{error}</p>}
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-2 bg-blue-700 text-white rounded font-medium text-sm disabled:opacity-40 hover:bg-blue-800 transition"
            title="Save (Ctrl+Enter)"
          >
            {saving ? 'Saving...' : mode === 'edit' ? 'Save Changes' : 'Create Auditee'}
          </button>
        </div>
        <p className="text-xs text-gray-400 text-center mt-3">Ctrl+Enter to confirm | Esc to close</p>
      </div>

      {unlockTarget && (
        <UnlockConfirmModal
          periodLabel={formatPeriodMasterOption(unlockTarget.year_label, unlockTarget.date_from, unlockTarget.date_till)}
          onConfirm={() => doUnlock(unlockTarget)}
          onClose={() => setUnlockTarget(null)}
        />
      )}
    </div>
  )
}
