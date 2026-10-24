import React, { useState, useEffect } from 'react'
import { useModalKeys } from '../../hooks/useModalKeys'
import GlobalAuditorPicker from '../shared/GlobalAuditorPicker'

function AuditorForm({ entityId, editing, onSaved, onCancel }) {
  const [firmName, setFirmName] = useState(editing?.firm_name || '')
  const [name, setName] = useState(editing?.name || '')
  const [designation, setDesignation] = useState(editing?.designation || 'Partner')
  const [membershipNumber, setMembershipNumber] = useState(editing?.membership_number || '')
  const [frn, setFrn] = useState(editing?.frn || '')
  const [pan, setPan] = useState(editing?.pan || '')
  const [category, setCategory] = useState(editing?.membership_category || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  // Picked from the Global Auditor list: fills every field (still editable).
  const fromGlobal = (g) => {
    if (!g) return
    setFirmName(g.firm_name); setFrn(g.frn); setName(g.name)
    setDesignation(g.designation || 'Partner'); setMembershipNumber(g.membership_number); setCategory(g.membership_category || '')
  }

  const submit = async () => {
    setErr('')
    if (!name.trim() || !membershipNumber.trim()) { setErr('Auditor Name and Membership Number are required.'); return }
    setSaving(true)
    try {
      const saved = await window.api?.saveAuditor({
        id: editing?.id, entity_id: entityId,
        firm_name: firmName.trim(), name: name.trim(),
        designation: designation.trim(), membership_number: membershipNumber.trim(),
        frn: frn.trim(), pan: pan.trim(), membership_category: category || null,
      })
      onSaved(saved)
    } catch (e) {
      setErr(e.message || 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border border-blue-200 rounded-lg p-3 mb-3 bg-blue-50/40">
      <div className="text-xs font-semibold text-blue-900 mb-2">{editing ? 'Edit Auditor' : 'New Auditor'}</div>
      {!editing && (
        <div className="mb-3 pb-3 border-b border-blue-100">
          <GlobalAuditorPicker compact onPick={fromGlobal} />
          <p className="text-[10px] text-gray-400 mt-1">Pick from the Global list — or type below for an auditor not in it.</p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 mb-2">
        <div className="col-span-2">
          <label className="block text-[10px] text-gray-500 mb-0.5">Firm Name</label>
          <input value={firmName} onChange={e => setFirmName(e.target.value)} placeholder="e.g. ABC & Co., Chartered Accountants"
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white" />
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 mb-0.5">Auditor Name *</label>
          <input value={name} onChange={e => setName(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white" />
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 mb-0.5">Designation</label>
          <input value={designation} onChange={e => setDesignation(e.target.value)} placeholder="e.g. Partner / Proprietor"
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white" />
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 mb-0.5">Membership No. *</label>
          <input value={membershipNumber} onChange={e => setMembershipNumber(e.target.value)} placeholder="e.g. 123456"
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white" />
        </div>
        <div className="col-span-2">
          <label className="block text-[10px] text-gray-500 mb-0.5">Category of membership</label>
          <div className="flex items-center gap-6 text-xs">
            {[['Associate', 'Associate (ACA)'], ['Fellow', 'Fellow (FCA)']].map(([v, l]) => (
              <label key={v} className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name="auditor_membership_category" checked={category === v} onChange={() => setCategory(v)} />
                {l}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 mb-0.5">FRN</label>
          <input value={frn} onChange={e => setFrn(e.target.value)} placeholder="e.g. 123456W"
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white" />
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 mb-0.5">PAN (optional)</label>
          <input value={pan} onChange={e => setPan(e.target.value)} placeholder="e.g. ABCDE1234F"
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white" />
        </div>
      </div>
      {err && <p className="text-red-500 text-xs mb-2">{err}</p>}
      <div className="flex gap-2">
        <button onClick={onCancel} className="px-3 py-1.5 border border-gray-300 text-gray-600 rounded text-xs hover:bg-gray-50">Cancel</button>
        <button onClick={submit} disabled={saving} className="px-3 py-1.5 bg-blue-700 text-white rounded text-xs font-medium hover:bg-blue-800 disabled:opacity-40">
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  )
}

export default function AuditorManageModal({ entity, startInCreate = false, onClose }) {
  const [auditors, setAuditors] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')
  const containerRef = useModalKeys({ onClose })

  const load = () => {
    if (!entity?.id) { setLoading(false); return }
    setLoading(true)
    window.api?.listAuditors(entity.id)
      .then(list => setAuditors(list || []))
      .catch(() => setError('Failed to load Auditors.'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [entity?.id])
  useEffect(() => { if (startInCreate) setEditing({}) }, [startInCreate])

  const handleDelete = async (a) => {
    if (!window.confirm(`Remove Auditor "${a.name}"?`)) return
    setError('')
    try {
      await window.api?.deleteAuditor(a.id)
      setAuditors(prev => prev.filter(x => x.id !== a.id))
    } catch (e) {
      setError(e.message || 'Failed to delete.')
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl p-6 flex flex-col"
        style={{ width: '620px', maxWidth: '92vw', maxHeight: '82vh' }}
        ref={containerRef}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4 shrink-0">
          <h2 className="text-base font-bold text-blue-900">Auditors{entity ? ` — ${entity.name}` : ''}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        {!entity && <p className="text-gray-400 text-sm py-6 text-center">Select an Auditee first.</p>}

        {entity && (editing ? (
          <AuditorForm
            entityId={entity.id}
            editing={editing.id ? editing : null}
            onSaved={() => { setEditing(null); load() }}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <div className="flex items-center justify-end mb-3 shrink-0">
            <button
              onClick={() => setEditing({})}
              className="px-3 py-2 bg-blue-700 text-white rounded text-sm font-medium hover:bg-blue-800 whitespace-nowrap"
            >
              + Add Auditor
            </button>
          </div>
        ))}

        {error && <p className="text-red-500 text-xs mb-2 shrink-0">{error}</p>}

        {entity && (
          <div className="flex-1 overflow-y-auto -mx-2 px-2">
            {loading ? (
              <p className="text-gray-400 text-sm py-6 text-center">Loading...</p>
            ) : auditors.length === 0 ? (
              <p className="text-gray-400 text-sm py-6 text-center">No Auditors added yet.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {auditors.map(a => (
                  <li key={a.id} className="flex items-center justify-between py-2.5 px-1 hover:bg-gray-50 rounded">
                    <div>
                      <div className="text-sm font-medium text-gray-800">{a.name}{a.designation ? `, ${a.designation}` : ''}</div>
                      <div className="text-xs text-gray-400">
                        {a.firm_name ? `${a.firm_name} · ` : ''}M.No. {a.membership_number}{a.membership_category ? ` (${a.membership_category === 'Fellow' ? 'FCA' : 'ACA'})` : ''}{a.frn ? ` · FRN ${a.frn}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setEditing(a)} className="px-2 py-1 text-xs border border-gray-300 rounded text-gray-600 hover:bg-gray-50">Edit</button>
                      <button onClick={() => handleDelete(a)} className="px-2 py-1 text-xs border border-red-300 rounded text-red-700 hover:bg-red-50">Delete</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <p className="text-xs text-gray-400 text-center mt-3 shrink-0">Esc to close</p>
      </div>
    </div>
  )
}
